"""Deterministic source check for Reraise Health cards.

Fetches the source page of every card, tests with fixed rules whether the quotation, every number
with a unit and the named speaker appear there, and asks a local model (Ollama, temperature 0,
fixed seed) whether the English card says what the source says. See README.md.

Usage:
  python pruefe_karten.py --karten ../../cards/health [--stufe abruf|pruefen|alles] [--ids b-1,b-2]
                          [--model NAME] [--ollama-url URL] [--cache DIR] [--out results.jsonl]
                          [--ohne-ki] [--erneut] [--neu-extrahieren] [--wiederholung 20 --startwert 7]

--karten is a folder of card files (cards/health) or a JSON file in the board export format.
The names of the result fields and of the prompt fields are German for historical reasons.
"""
import argparse, datetime, glob, hashlib, io, json, os, random, re, sys, time, unicodedata
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('RR_CACHE') or os.path.join(os.getcwd(), 'cache')
PROMPT_FILE = os.environ.get('RR_PROMPT') or os.path.join(HERE, 'prompt_v4.txt')
OLLAMA = os.environ.get('RR_OLLAMA') or 'http://127.0.0.1:11434'
MODEL = os.environ.get('RR_MODEL') or 'qwen35-fallback:latest'
THINK = os.environ.get('RR_THINK') == '1'
OPTS = {'temperature': 0, 'seed': 42, 'num_ctx': 8192, 'top_k': 1, 'top_p': 1.0, 'num_predict': 2000, 'num_gpu': 99, 'num_batch': 512, 'num_thread': 8}
INPUT_SHA = None
def reset_prompt(prompt):
    # fester Teil vor {{CARD}} + Marker: setzt den Prompt-Cache vor jedem Aufruf auf denselben Stand
    return prompt.split('{{CARD}}')[0] + '\u2400'
FUZZY_MIN = 90          # rapidfuzz partial_ratio, Schwelle fuer Regel (b)
SEG_MIN = 20            # Mindestlaenge eines Zitat-Segments bei Auslassungen
WIN = 1500              # +- Zeichen um die Fundstelle fuer die KI
HEAD = 400              # Zeichen Dokumentkopf fuer die KI
LOOSE_WIN = 300         # Zahl ohne direkt folgende Einheit: Einheit im Fenster +-300
LOOSE_MINDIG = 2        # ... nur fuer Zahlen mit >= 2 Ziffern
MIN_TEXT = 200          # weniger Text = "kein lesbarer Text"
PAUSE = 1.5
UA = ('Mozilla/5.0' + ' (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/130.0.0.0 Safari/537.36')

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

def sha(b):
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode('utf-8')).hexdigest()

# ---------------- Karten laden ----------------
VALUE_KEYS = {'context': 'contexto', 'form': 'forma', 'perDay': 'porDia', 'upperLimit': 'limiteSuperior', 'bloodTarget': 'objetivoSangre'}

def md_card_files(folder):
    out = []
    for root, _, files in os.walk(folder):
        out += [os.path.join(root, f) for f in files if f.endswith('.md') and f != 'README.md']
    return sorted(out)

def input_sha(path):
    if os.path.isdir(path):
        return sha('\n'.join(os.path.relpath(f, path).replace(os.sep, '/') + ' ' + sha(open(f, 'rb').read()) for f in md_card_files(path)))
    return sha(open(path, 'rb').read())

def read_md_cards(folder):
    import yaml
    cards = []
    for f in md_card_files(folder):
        fm = yaml.safe_load(open(f, encoding='utf-8').read().split('---\n')[1])
        ci = fm.get('citation') or {}
        q = None
        for line in open(f, encoding='utf-8').read().split('---\n', 2)[2].splitlines():
            if line.startswith('> '):
                q = (q + ' ' if q else '') + line[2:]
        c = {'nb': fm['refs'][0]['id'], 'u': fm['source'], 'n': ci.get('speaker'), 'r': ci.get('role'), 'ty': ci.get('documentType'),
             'st': ci.get('documentTitle'), 'sd': ci.get('published', ''), 'l': 'B' if fm.get('layer') == 'evidenced' else 'G',
             'v': {VALUE_KEYS.get(k, k): v for k, v in (fm.get('values') or {}).items()}, '_nut': (fm.get('tags') or [None])[-1]}
        if q:
            c['q'] = q
        if ci.get('quoteOriginal'):
            c['qo'] = ci['quoteOriginal']
        cards.append(c)
    return cards

def load_cards(path, voces_dir):
    cards = []
    d = [] if os.path.isdir(path) else json.load(open(path, encoding='utf-8'))
    if os.path.isdir(path):
        cards = read_md_cards(path)
    elif isinstance(d, list) and d and isinstance(d[0], dict) and 'karte' in d[0]:   # Nachrecherche-Format (quellen85)
        for x in d:
            if x.get('entscheidung') == 'VERWORFEN' or not x.get('karte'):
                continue
            c = dict(x['karte']); c['_nut'] = x.get('nutriente')
            c['_zusatz'] = [z for z in (x.get('zusatzbelege') or []) if isinstance(z, dict) and z.get('url')]
            c['_entscheidung'] = x.get('entscheidung')
            cards.append(c)
    elif isinstance(d, list) and d and 'k' in d[0]:
        for o in d:
            for c in o['k']:
                c = dict(c); c['_nut'] = o.get('s'); cards.append(c)
    else:
        cards = list(d)
    voc = {}
    if voces_dir and os.path.isdir(voces_dir):
        for f in glob.glob(os.path.join(voces_dir, 'b-*.json')):
            try:
                v = json.load(open(f, encoding='utf-8')); voc[v['id']] = v
            except Exception:
                pass
    for c in cards:
        v = voc.get(c.get('nb'))
        c['_orig_quote'] = ((v or {}).get('cita') or {}).get('texto') or c.get('qo') or c.get('q')
        c['_orig_vals'] = (v or {}).get('valor') or c.get('v') or {}
        c['_from_voces'] = bool(v)
        c['_layer'] = 'PROVEN' if c.get('l') == 'B' else 'SAID'
    return cards

# ---------------- Abruf ----------------
BLOCK_PAT = re.compile(r'recaptcha|client challenge|no eres un robot|not a robot|anubis|just a moment|checking your browser|'
                       r'revisando (tu|el) navegador|cf-chl|attention required|enable javascript and cookies|access denied', re.I)
HDR = {'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
       'Accept-Language': 'es-AR,es;q=0.9,de;q=0.8,en;q=0.7'}

def decode(raw, ctype):
    m = re.search(r'charset=([\w-]+)', ctype or '', re.I)
    enc = m.group(1) if m else None
    if not enc:
        m = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', raw[:4000], re.I)
        enc = m.group(1).decode('ascii', 'ignore') if m else 'utf-8'
    try:
        return raw.decode(enc, errors='replace')
    except LookupError:
        return raw.decode('utf-8', errors='replace')

def html_text(raw, ctype):
    import lxml.html
    s = decode(raw, ctype)
    s = re.sub(r'^\s*<\?xml[^>]*\?>', '', s)
    doc = lxml.html.fromstring(s)
    for el in doc.xpath('//script|//style|//noscript|//template'):
        el.drop_tree()
    for el in doc.xpath('//br|//p|//div|//li|//tr|//h1|//h2|//h3|//h4|//td|//th|//title'):
        el.tail = ('\n' + el.tail) if el.tail else '\n'
    return doc.text_content()

def xml_text(raw):
    from lxml import etree
    root = etree.fromstring(raw)
    return '\n'.join(t.strip() for t in root.itertext() if t.strip())

def pdf_text(raw):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(raw)
    out = []
    for i in range(len(pdf)):
        tp = pdf[i].get_textpage(); out.append(tp.get_text_range()); tp.close()
    pdf.close()
    return '\n'.join(out)

def download(url, tries=3):
    meta = {'fetched_at': now(), 'status': None, 'error': None, 'tls_unverified': False, 'versuche': 0}
    raw = None
    for t in range(tries):
        meta['versuche'] = t + 1
        verify = not meta['tls_unverified']
        try:
            r = requests.get(url, headers=HDR, timeout=(20, 120), allow_redirects=True, verify=verify)
            raw = r.content
            meta.update(status=r.status_code, final_url=r.url, content_type=r.headers.get('Content-Type', ''), bytes=len(raw), error=None)
            if r.status_code < 500:
                break
        except requests.exceptions.SSLError as e:
            import urllib3; urllib3.disable_warnings()
            meta['tls_unverified'] = True; meta['error'] = 'SSLError'
            continue
        except Exception as e:
            meta['error'] = type(e).__name__ + ': ' + str(e)[:200]
        time.sleep(10)
    return meta, raw

def extract(raw, meta, kind_hint=None):
    ct = (meta.get('content_type') or '').lower()
    if raw[:5] == b'%PDF-':
        return 'pdf', pdf_text(raw)
    if kind_hint == 'xml' or ('xml' in ct and 'html' not in ct):
        return 'xml', xml_text(raw)
    if 'html' in ct or raw.lstrip()[:1] == b'<':
        return 'html', html_text(raw, ct)
    return 'text', decode(raw, ct)

def alt_url(url):
    m = re.search(r'ncbi\.nlm\.nih\.gov/(?:pmc/)?articles/(PMC\d+)', url)
    if m:
        return ['https://www.ebi.ac.uk/europepmc/webservices/rest/%s/fullTextXML' % m.group(1),
                'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=%s' % m.group(1)[3:]]
    m = re.search(r'(10\.\d{4,9}/[^\s?#]+)', url)
    if m:
        doi = m.group(1).rstrip('/')
        try:
            j = requests.get('https://www.ebi.ac.uk/europepmc/webservices/rest/search', params={'query': 'DOI:"%s"' % doi, 'format': 'json', 'resultType': 'lite'}, timeout=30).json()
            for x in j.get('resultList', {}).get('result', []):
                if x.get('pmcid'):
                    return ['https://www.ebi.ac.uk/europepmc/webservices/rest/%s/fullTextXML' % x['pmcid'],
                            'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=%s' % x['pmcid'][3:]]
        except Exception:
            return None
    return None

def blocked(meta, text):
    st = meta.get('status')
    return st in (401, 403, 429) or (st == 200 and len(text) < 5000 and bool(BLOCK_PAT.search(text)))

def fetch(url, refetch=False, reextract=False):
    key = sha(url); mp = os.path.join(CACHE, key + '.meta.json'); rp = os.path.join(CACHE, key + '.raw')
    if os.path.exists(mp) and not refetch and not reextract:
        return json.load(open(mp, encoding='utf-8')), True
    if reextract and os.path.exists(mp):
        meta = json.load(open(mp, encoding='utf-8'))
        raw = open(rp, 'rb').read() if os.path.exists(rp) else None
        hit = True
    else:
        meta, raw = download(url); hit = False
        if raw is not None:
            open(rp, 'wb').write(raw); meta['raw_sha256'] = sha(raw)
    meta['url'] = url
    text = ''
    for k in ('extract_error', 'kind', 'blockiert'):
        meta.pop(k, None)
    if raw is not None:
        try:
            meta['kind'], text = extract(raw, meta)
        except Exception as e:
            meta['extract_error'] = type(e).__name__ + ': ' + str(e)[:300]
        meta['blockiert'] = blocked(meta, text)
        if meta['blockiert']:
            for i, au in enumerate(alt_url(url) or []):
                ap = os.path.join(CACHE, key + '.alt%d.raw' % i)
                if os.path.exists(ap):
                    am, araw = {'status': 200, 'content_type': 'application/xml'}, open(ap, 'rb').read()
                else:
                    time.sleep(PAUSE); am, araw = download(au)
                meta['alt_url'] = au; meta['alt_status'] = am.get('status')
                if araw is not None and am.get('status') == 200:
                    open(ap, 'wb').write(araw); meta['alt_raw_sha256'] = sha(araw)
                    try:
                        k2, t2 = extract(araw, am, 'xml')
                        if len(t2) >= MIN_TEXT * 10:
                            text = t2; meta['kind'] = 'alt-' + k2; meta['text_via'] = 'alt_url'
                            break
                    except Exception as e:
                        meta['alt_extract_error'] = str(e)[:200]
    open(os.path.join(CACHE, key + '.txt'), 'w', encoding='utf-8').write(text)
    meta['text_chars'] = len(text); meta['text_sha256'] = sha(text)
    json.dump(meta, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return meta, hit

def cached_text(url):
    p = os.path.join(CACHE, sha(url) + '.txt')
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''

# ---------------- Normalisierung ----------------
QUOTES = dict.fromkeys(map(ord, '\u201c\u201d\u201e\u201f\u00ab\u00bb\u2033\u301d\u301e'), '"')
QUOTES.update(dict.fromkeys(map(ord, '\u2018\u2019\u201a\u201b\u2039\u203a\u2032`\u00b4'), "'"))
QUOTES.update(dict.fromkeys(map(ord, '\u2010\u2011\u2012\u2013\u2014\u2212'), '-'))
QUOTES[0xad] = None
LC = 'a-zäöüßáéíóúñàèìòùâêîôûç'

def base_norm(t):
    t = unicodedata.normalize('NFKC', t or '').translate(QUOTES)
    t = re.sub(r'([%s])-\s*\n\s*([%s])' % (LC, LC), r'\1\2', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def low(t):
    return ''.join(c.lower() if len(c.lower()) == 1 else c for c in t)

# ---------------- Regel (b) Zitat ----------------
def rule_quote(quote, T):
    from rapidfuzz import fuzz
    if not quote:
        return {'geprueft': False, 'bestanden': False, 'grund': 'kein Zitat auf der Karte', 'score': None, 'pos': None}
    q = low(base_norm(quote))
    segs = [s.strip(' .,;:"\'') for s in re.split(r'\.\.\.|…|\[\.\.\.\]|\(\.\.\.\)', q)]
    segs = [s for s in segs if len(s) >= SEG_MIN] or [q.strip(' "\'')]
    scores = []; pos = None
    Tcmp = T
    for s in segs:
        s2 = s
        i = Tcmp.find(s2)
        if i >= 0:
            sc, st = 100.0, i
        else:
            a = fuzz.partial_ratio_alignment(s2, Tcmp, processor=None)
            sc, st = (round(a.score, 2), a.dest_start) if a else (0.0, None)
        scores.append(sc)
        if pos is None and st is not None:
            pos = st
    sc = min(scores)
    return {'geprueft': True, 'bestanden': sc >= FUZZY_MIN, 'score': sc, 'segmente': len(segs),
            'exakt': all(x == 100.0 for x in scores), 'pos': pos}

# ---------------- Regel (c) Zahlen ----------------
UNITS = [  # (Klasse, Varianten auf Karte/Text; Regex-Fragmente, kleingeschrieben)
    ('ug', [r'µg', r'μg', r'mcg', r'microg', r'ug', r'microgramos?', r'mikrogramm', r'micrograms?']),
    ('mg', [r'mg', r'miligramos?', r'milligramm', r'milligrams?']),
    ('g', [r'g', r'gramos?', r'gramm', r'grams?']),
    ('iu', [r'iu', r'ui', r'i\.e\.', r'ie', r'u\.i\.', r'i\.u\.', r'international units?', r'unidades internacionales']),
    ('ngml', [r'ng/ml']), ('nmoll', [r'nmol/l']), ('umoll', [r'µmol/l', r'μmol/l', r'umol/l']),
    ('mmoll', [r'mmol/l']), ('mgdl', [r'mg/dl']), ('pct', [r'%', r'prozent', r'por ciento', r'percent']),
    ('kcal', [r'kcal']), ('ml', [r'ml']), ('l', [r'l', r'litros?', r'liter']), ('ugl', [r'µg/l', r'μg/l']),
    ('mgkg', [r'mg/kg']), ('gkg', [r'g/kg']),
]
UNIT_RE = {k: '(?:' + '|'.join(v) + ')' for k, v in UNITS}
CARD_UNIT = '(?:' + '|'.join('(?:%s)' % '|'.join(v) for _, v in sorted(UNITS, key=lambda u: -max(len(x) for x in u[1]))) + ')'
NUM = r'\d{1,3}(?:[.,\u202f\u00a0 ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?'
PAIR_RE = re.compile(r'(?<![\w.,])(' + NUM + r')(?:\s*(?:-|–|bis|a|to|y|and|und)\s*(' + NUM + r'))?\s?(' + CARD_UNIT + r')(?![a-z0-9])', re.I)

def unit_class(u):
    u = u.lower()
    for k, v in UNITS:
        if re.fullmatch('(?:' + '|'.join(v) + ')', u):
            return k
    return None

def num_variants(s):
    s = s.replace('\u202f', ' ').replace('\u00a0', ' ')
    vals = set()
    m = re.fullmatch(r'(\d{1,3})((?:[., ]\d{3})+)(?:([.,])(\d+))?', s)
    cand = []
    if m:   # Tausendertrennzeichen (z. B. 3.000 / 3,000 / 3 000)
        intpart = m.group(1) + re.sub(r'[., ]', '', m.group(2))
        cand.append((intpart, m.group(4)))
        # Mehrdeutig: "1.500" kann auch 1,5 sein
        if len(m.group(2)) == 4 and not m.group(3) and m.group(2)[1:].strip('0'):
            cand.append((m.group(1), m.group(2)[1:].rstrip('0') or None))
    else:
        p = re.split(r'[.,]', s)
        cand.append((p[0], p[1] if len(p) > 1 else None))
    for ip, dp in cand:
        if dp and set(dp) == {'0'}:
            dp = None
        if dp:
            vals |= {ip + '.' + dp, ip + ',' + dp}
            if dp.endswith('0'):
                d2 = dp.rstrip('0'); vals |= {ip + '.' + d2, ip + ',' + d2}
        else:
            vals.add(ip)
            if len(ip) > 3:
                g = ip[:len(ip) % 3 or 3]; rest = ip[len(g):]
                parts = [g] + [rest[i:i + 3] for i in range(0, len(rest), 3)]
                for sep in ['.', ',', ' ', '\u202f', '\u00a0']:
                    vals.add(sep.join(parts))
    return sorted(vals, key=len, reverse=True)

def card_pairs(vals):
    pairs = []
    for k, txt in sorted(vals.items()):
        t = base_norm(txt).translate(QUOTES)
        for m in PAIR_RE.finditer(t):
            uc = unit_class(m.group(3))
            if not uc:
                continue
            for n in (m.group(1), m.group(2)):
                if n:
                    pairs.append({'feld': k, 'zahl': n, 'einheit': m.group(3), 'klasse': uc})
    seen = set(); out = []
    for p in pairs:
        key = (p['zahl'], p['klasse'])
        if key not in seen:
            seen.add(key); out.append(p)
    return out

def rule_numbers(vals, T):
    pairs = card_pairs(vals)
    if not pairs:
        return {'geprueft': False, 'bestanden': True, 'paare': [], 'grund': 'keine Zahl mit Einheit auf der Karte', 'pos': None}
    res = []; firstpos = None
    for p in pairs:
        vs = num_variants(p['zahl'])
        nre = r'(?<![\d.,])(?:' + '|'.join(re.escape(v) for v in vs) + r')(?![\d]|[.,]\d)'
        ure = UNIT_RE[p['klasse']]
        m = re.search(nre + r'\s?(?:-|–|bis|a|to|y|und|and)?\s?(?:' + NUM + r')?\s?' + ure + r'(?![a-z])', T)
        how = None; pos = None
        if m:
            how, pos = 'direkt', m.start()
        elif len(re.sub(r'\D', '', p['zahl'])) >= LOOSE_MINDIG:
            for mm in re.finditer(nre, T):
                a, b = max(0, mm.start() - LOOSE_WIN), mm.end() + LOOSE_WIN
                if re.search(r'(?<![a-z])' + ure + r'(?![a-z])', T[a:b]):
                    how, pos = 'fenster', mm.start(); break
        res.append({**p, 'gefunden': how, 'pos': pos})
        if pos is not None and firstpos is None:
            firstpos = pos
    return {'geprueft': True, 'bestanden': all(r['gefunden'] for r in res), 'paare': res,
            'gefunden': sum(1 for r in res if r['gefunden']), 'gesamt': len(res), 'pos': firstpos}

# ---------------- Regel (e) Urheber im Quelltext ----------------
GENERIC = {'de', 'la', 'el', 'los', 'und', 'the', 'of', 'for', 'and', 'dr', 'dr.', 'md', 'phd', 'et', 'al', 'al.', 'y',
           'für', 'der', 'die', 'das', 'institute', 'society', 'university', 'universidad'}

def fold(t):
    return ''.join(ch for ch in unicodedata.normalize('NFD', t) if unicodedata.category(ch) != 'Mn')

def name_variants(n):
    n = base_norm(n); vs = {n}
    for part in re.split(r'\s*[()\[\]]\s*|\s+-\s+|\s*/\s*|,\s*|:\s*', n):
        part = part.strip()
        if len(part) >= 4 and part.lower() not in GENERIC:
            vs.add(part)
    for t in re.findall(r'\b[A-ZÄÖÜ][A-Za-zÄÖÜ\-]*[A-Z][A-Za-z\-]*\b', n):
        if 2 <= len(t) <= 10:
            vs.add(t)
    toks = [t for t in re.findall(r"[\wÀ-ÿ'-]+", n) if t.lower() not in GENERIC]
    if toks and len(toks) <= 4 and len(toks[-1]) >= 4:
        vs.add(toks[-1])
    return sorted(vs, key=len, reverse=True)

def rule_author(c, T):
    Tf = fold(T); var = name_variants(c.get('n') or '')
    hit = None
    for v in var:
        if re.search(r'(?<![a-z0-9])' + re.escape(fold(low(v))) + r'(?![a-z0-9])', Tf):
            hit = v; break
    y = (c.get('sd') or '')[:4]
    return {'bestanden': bool(hit), 'treffer': hit, 'varianten': var,
            'jahr': y or None, 'jahr_im_text': (y in T) if re.fullmatch(r'\d{4}', y) else None}

# ---------------- KI ----------------
def model_info():
    try:
        tags = requests.get(OLLAMA + '/api/tags', timeout=10).json()['models']
        ver = requests.get(OLLAMA + '/api/version', timeout=10).json().get('version')
    except Exception as e:
        return None
    for m in tags:
        if m['name'] == MODEL:
            info = {'modell': MODEL, 'digest': m['digest'], 'ollama': ver, 'optionen': OPTS, 'think': THINK}
            try:
                info['ollama_env'] = {k: os.environ.get(k) for k in ('OLLAMA_FLASH_ATTENTION', 'OLLAMA_KV_CACHE_TYPE', 'OLLAMA_NUM_PARALLEL')}
            except Exception:
                pass
            return info
    return None

def card_text(c):
    lines = ['Named source: %s (%s)' % (c.get('n'), c.get('r')),
             'Document: %s, date %s, type %s' % (c.get('st'), c.get('sd') or 'n/a', c.get('ty'))]
    if c.get('q'):
        lines.append('Quote (English, as published): "%s"' % c['q'])
    for k, v in sorted((c.get('v') or {}).items()):
        lines.append('%s: %s' % (k, v))
    return '\n'.join(lines)

SCHEMA = {'type': 'object', 'properties': {
    'belege': {'type': 'array', 'items': {'type': 'object', 'properties': {
        'karte': {'type': 'string'}, 'auszug': {'type': 'string'},
        'match': {'type': 'string', 'enum': ['SAME', 'DIFFERENT_VALUE', 'NOT_IN_EXCERPT']}}, 'required': ['karte', 'auszug', 'match']}},
    'genannt': {'type': 'string'},
    'wiedergabe': {'type': 'string', 'enum': ['PASS', 'FAIL', 'UNCLEAR']},
    'zuordnung': {'type': 'string', 'enum': ['PASS', 'FAIL', 'UNCLEAR']},
    'reason': {'type': 'string'}}, 'required': ['belege', 'genannt', 'wiedergabe', 'zuordnung', 'reason']}

def chat(msg, opts, fmt=None):
    body = {'model': MODEL, 'stream': False, 'format': fmt if fmt is not None else SCHEMA, 'think': THINK, 'options': opts, 'keep_alive': '30m',
            'messages': [{'role': 'user', 'content': msg}]}
    return requests.post(OLLAMA + '/api/chat', json=body, timeout=600).json()

def combine(w, z):
    if 'FAIL' in (w, z):
        return 'FAIL'
    if w == 'PASS':
        return 'PASS'
    return 'UNCLEAR'

def ki(c, T, pos, prompt):
    a = max(0, pos - WIN); b = min(len(T), pos + WIN)
    exc = T[a:b]; head = T[:HEAD]
    msg = prompt.replace('{{CARD}}', card_text(c)).replace('{{HEAD}}', head).replace('{{EXCERPT}}', exc)
    t0 = time.time()
    try:
        chat(reset_prompt(prompt), {**OPTS, 'num_predict': 1}, 'json')
        r = chat(msg, OPTS)
        raw = r.get('message', {}).get('content', '')
    except Exception as e:
        return {'verdict': 'UNCLEAR', 'reason': 'Ollama-Fehler: %s' % e, 'fehler': True}
    out = {'ausschnitt_von': a, 'ausschnitt_bis': b, 'ausschnitt_sha256': sha(exc), 'eingabe_sha256': sha(msg),
           'roh': raw, 'sekunden': round(time.time() - t0, 1)}
    try:
        t = raw.strip()
        t = re.sub(r'^```(?:json)?\s*|\s*```$', '', t)
        j = json.loads(t)
        for k in ('wiedergabe', 'zuordnung'):
            v = str(j.get(k, '')).upper().strip()
            out[k] = v if v in ('PASS', 'FAIL', 'UNCLEAR') else 'UNCLEAR'
        out['reason'] = str(j.get('reason', ''))[:500]
        bl = j.get('belege') if isinstance(j.get('belege'), list) else []
        out['belege'] = bl; out['genannt'] = str(j.get('genannt', ''))[:300]
        out['wiedergabe_modell'] = out['wiedergabe']
        diff = any(isinstance(x, dict) and str(x.get('match', '')).upper() == 'DIFFERENT_VALUE' for x in bl)
        out['beleg_abweichung'] = diff
        if diff and out['wiedergabe'] == 'PASS':
            out['wiedergabe'] = 'UNCLEAR'      # Modell widerspricht sich selbst: nicht entscheidend
        elif not diff and out['wiedergabe'] == 'FAIL':
            out['wiedergabe'] = 'UNCLEAR'      # FAIL ohne benannte Abweichung: nicht entscheidend
    except Exception:
        out.update(reason='Antwort kein JSON', wiedergabe='UNCLEAR', zuordnung='UNCLEAR', json_fehler=True)
    out['verdict'] = combine(out['wiedergabe'], out['zuordnung'])
    return out

# ---------------- Urteil ----------------
def judge(c, meta, rb, rc, kr, re_=None):
    gr = []
    st = meta.get('status')
    if meta.get('error') or st is None:
        return 'RAUS', ['Quelle nicht erreichbar (%s)' % (meta.get('error') or '').split(':')[0]]
    if meta.get('blockiert') and meta.get('text_via') != 'alt_url':
        return 'RAUS', ['Abruf blockiert (Bot-Schutz/HTTP %s), Quelle nicht maschinell pruefbar' % st]
    if st >= 400:
        return 'RAUS', ['Quelle HTTP %s%s' % (st, ' (Abruf blockiert)' if st in (401, 403, 429) else '')]
    if meta.get('text_chars', 0) < MIN_TEXT:
        return 'RAUS', ['Quelle liefert keinen lesbaren Text']
    if not rb['bestanden'] and not (rc.get('geprueft') and rc.get('gefunden', 0) > 0):
        return 'RAUS', ['weder Zitat noch Zahl in der Quelle gefunden']
    if re_ is not None and not re_['bestanden']:
        return 'RAUS', ['Urheber nicht im Quelltext']
    if kr and kr.get('verdict') == 'FAIL':
        return 'RAUS', ['KI: FAIL (%s)' % ', '.join(k for k in ('wiedergabe', 'zuordnung') if kr.get(k) == 'FAIL')]
    if c['_layer'] == 'PROVEN':
        if not rb['bestanden']:
            gr.append('Zitat nicht belegt' if rb['geprueft'] else 'kein Zitat auf der Karte')
        if not rc['bestanden']:
            gr.append('Zahl nicht belegt')
        if kr and kr.get('verdict') == 'UNCLEAR':
            gr.append('KI: UNCLEAR')
        if gr:
            return 'HERABSTUFEN', gr
    else:
        if not rc['bestanden']:
            gr.append('Hinweis: Zahl nicht belegt - Zahl von der Karte nehmen')
        if kr and kr.get('verdict') == 'UNCLEAR':
            gr.append('Hinweis: KI UNCLEAR')
    return 'OK', gr

def check(c, prompt, minfo, use_ki=True):
    meta = json.load(open(os.path.join(CACHE, sha(c['u']) + '.meta.json'), encoding='utf-8'))
    raw = cached_text(c['u'])
    Tb = base_norm(raw); T = low(Tb)
    rb = rule_quote(c['_orig_quote'], T) if raw else {'geprueft': bool(c['_orig_quote']), 'bestanden': False, 'pos': None, 'score': None}
    rc = rule_numbers(c['_orig_vals'], T) if raw else {'geprueft': True, 'bestanden': False, 'paare': [], 'pos': None, 'gefunden': 0}
    zres = []
    if c.get('_zusatz'):
        Tall = T
        for z in c['_zusatz']:
            zm_p = os.path.join(CACHE, sha(z['url']) + '.meta.json')
            zm = json.load(open(zm_p, encoding='utf-8')) if os.path.exists(zm_p) else {}
            zT = low(base_norm(cached_text(z['url'])))
            zb = rule_quote(z.get('zitat'), zT) if zT else {'geprueft': bool(z.get('zitat')), 'bestanden': False, 'pos': None, 'score': None}
            zres.append({'url': z['url'], 'status': zm.get('status'), 'text_chars': zm.get('text_chars'), 'regel_b_zitat': zb})
            Tall = Tall + '\n' + zT
        rc_all = rule_numbers(c['_orig_vals'], Tall)
        if not rc['bestanden'] and rc_all['bestanden']:
            rc = dict(rc, bestanden=True, ueber_zusatzbelege=True, gefunden=max(rc.get('gefunden', 0), rc_all.get('gefunden', 0)))
        if not rb['bestanden'] and any(z['regel_b_zitat']['bestanden'] for z in zres):
            rb = dict(rb, bestanden=True, ueber_zusatzbelege=True)
    re_ = rule_author(c, T) if raw else {'bestanden': False, 'treffer': None}
    pos = rb['pos'] if rb.get('bestanden') else (rc.get('pos') if rc.get('pos') is not None else rb.get('pos'))
    kr = None
    pre, _ = judge(c, meta, rb, rc, None, re_)
    if use_ki and minfo and pos is not None and not (pre == 'RAUS'):
        kr = ki(c, Tb, pos, prompt)
    verdict, gr = judge(c, meta, rb, rc, kr, re_)
    return {'id': c.get('nb') or c.get('id'), 'nutrient': c.get('_nut'), 'layer': c['_layer'], 'url': c['u'],
            'quelle': {k: meta.get(k) for k in ('status', 'error', 'fetched_at', 'final_url', 'kind', 'text_chars', 'text_sha256', 'tls_unverified', 'blockiert', 'alt_url', 'alt_status', 'text_via', 'versuche')},
            'regel_b_zitat': rb, 'regel_c_zahlen': rc, 'regel_d_proven_erlaubt': bool(rb['bestanden'] and rc['bestanden']), 'regel_e_urheber': re_,
            'fundstelle': pos, 'ki': kr, 'zusatzbelege': zres or None, 'entscheidung_nachrecherche': c.get('_entscheidung'), 'urteil': verdict, 'gruende': gr,
            'prompt_sha256': sha(prompt), 'modell': minfo, 'zeit': now(),
            'werte_quelle': 'voces-original' if c['_from_voces'] else 'karte', 'eingabe_sha256': INPUT_SHA}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--karten', required=True)
    ap.add_argument('--voces', default='', help='optional: folder of b-*.json with the original values (default: only the card input, frozen)')
    ap.add_argument('--model', default=None, help='Ollama model name (default: env RR_MODEL or qwen35-fallback:latest)')
    ap.add_argument('--ollama-url', default=None, help='Ollama base URL (default: env RR_OLLAMA or http://127.0.0.1:11434)')
    ap.add_argument('--cache', default=None, help='folder for fetched sources (default: env RR_CACHE or ./cache)')
    ap.add_argument('--prompt', default=None, help='prompt file (default: prompt_v4.txt next to this script)')
    ap.add_argument('--stufe', default='alles', choices=['abruf', 'pruefen', 'alles'])
    ap.add_argument('--ids', default='')
    ap.add_argument('--wiederholung', type=int, default=0)
    ap.add_argument('--startwert', type=int, default=7)
    ap.add_argument('--out', default='ergebnis.jsonl')
    ap.add_argument('--ohne-ki', action='store_true')
    ap.add_argument('--erneut', action='store_true', help='Abruf wiederholen fuer Fehler/5xx/blockiert')
    ap.add_argument('--neu-extrahieren', action='store_true', help='Text aus gespeicherter Rohantwort neu erzeugen')
    a = ap.parse_args()
    global INPUT_SHA, MODEL, OLLAMA, CACHE, PROMPT_FILE
    MODEL = a.model or MODEL
    OLLAMA = (a.ollama_url or OLLAMA).rstrip('/')
    CACHE = a.cache or CACHE
    PROMPT_FILE = a.prompt or PROMPT_FILE
    os.makedirs(CACHE, exist_ok=True)
    INPUT_SHA = input_sha(a.karten)
    cards = load_cards(a.karten, a.voces)
    if a.ids:
        want = set(a.ids.split(',')); cards = [c for c in cards if (c.get('nb') or c.get('id')) in want]
    if a.wiederholung:
        ids = sorted(c.get('nb') or c.get('id') for c in cards)
        pick = set(random.Random(a.startwert).sample(ids, a.wiederholung))
        cards = [c for c in cards if (c.get('nb') or c.get('id')) in pick]
    print('Karten:', len(cards), 'Eingabe-sha256:', INPUT_SHA, flush=True)
    if a.stufe in ('abruf', 'alles'):
        urls = sorted(set(c['u'] for c in cards) | set(z['url'] for c in cards for z in c.get('_zusatz', [])))
        for i, u in enumerate(urls):
            old = None
            mp = os.path.join(CACHE, sha(u) + '.meta.json')
            if os.path.exists(mp):
                old = json.load(open(mp, encoding='utf-8'))
            re_f = bool(a.erneut and old and (old.get('error') or (old.get('status') or 0) >= 500 or (old.get('blockiert') and old.get('text_via') != 'alt_url')))
            m, hit = fetch(u, refetch=re_f, reextract=a.neu_extrahieren and not re_f)
            print('%d/%d %s %s %s' % (i + 1, len(urls), 'cache' if hit else 'neu', m.get('status') or m.get('error', '')[:40], u[:90]), flush=True)
            if not hit:
                time.sleep(PAUSE)
    if a.stufe in ('pruefen', 'alles'):
        prompt = open(PROMPT_FILE, encoding='utf-8').read()
        minfo = None if a.ohne_ki else model_info()
        if not a.ohne_ki and not minfo:
            print('WARNING: Ollama model %s not reachable, model stage skipped' % MODEL, flush=True)
        with open(a.out, 'w', encoding='utf-8') as f:
            for i, c in enumerate(cards):
                r = check(c, prompt, minfo, not a.ohne_ki)
                f.write(json.dumps(r, ensure_ascii=False) + '\n'); f.flush()
                print('%d/%d %s %s %s %s' % (i + 1, len(cards), r['id'], r['layer'], r['urteil'], (r['ki'] or {}).get('verdict')), flush=True)
    print('FERTIG', now(), flush=True)

if __name__ == '__main__':
    main()
