"""Negative control of the model stage: deliberately falsified cards must not pass.
Usage: python kontrolle.py <cards folder or json>   (reads ergebnis.jsonl in the working directory; env RR_SEED, RR_N, RR_KOUT)"""
import json, os, random, re, sys, copy
import pruefe_karten as p
HERE = os.getcwd()
R = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(HERE, 'ergebnis.jsonl'), encoding='utf-8')}
cards = {c['nb']: c for c in p.load_cards(sys.argv[1], '')}
prompt = open(p.PROMPT_FILE, encoding='utf-8').read()
minfo = p.model_info()
NUMU = re.compile(r'(?<![\d.,])(\d+(?:[.,]\d+)?)(\s?(?:µg|μg|mcg|mg|g|IU|UI|%))(?![a-zA-Z])')
cand = sorted(i for i, r in R.items() if (r['ki'] or {}).get('verdict') == 'PASS' and i in cards
              and any(NUMU.search(v) for v in cards[i]['v'].values()))
SEED = int(os.environ.get('RR_SEED', '7')); N = int(os.environ.get('RR_N', '20'))
pick = random.Random(SEED).sample(cand, N)
orgs = sorted(set(c['n'] for c in cards.values()))
out = []
for i in pick:
    c = cards[i]; r = R[i]
    mp = os.path.join(p.CACHE, p.sha(c['u']) + '.txt')
    Tb = p.base_norm(open(mp, encoding='utf-8').read())
    # A: eine Zahl der Karte, die im KI-Ausschnitt steht, wird verfaelscht (Ziffer 9 vorangestellt)
    a = copy.deepcopy(c)
    f = r['fundstelle']
    inwin = [q for q in r['regel_c_zahlen'].get('paare', []) if q.get('pos') is not None and abs(q['pos'] - f) < p.WIN - 50]
    old = (inwin[0]['zahl'] if inwin else None)
    k = None
    for kk in sorted(a['v']):
        if old and re.search(r'(?<![\d.,])' + re.escape(old) + r'(?![\d])', a['v'][kk]):
            k = kk; break
    if not k:
        k = sorted(kk for kk, v in a['v'].items() if NUMU.search(v))[0]; old = NUMU.search(a['v'][k]).group(1)
    new = '9' + old
    a['v'][k] = re.sub(r'(?<![\d.,])' + re.escape(old) + r'(?![\d])', new, a['v'][k], count=1)
    if a.get('q'):
        a['q'] = re.sub(r'(?<![\d.,])' + re.escape(old) + r'(?![\d])', new, a['q'])
    ra = p.check(a, prompt, minfo); ka = ra['ki'] or {}
    # B: Zuordnung auf andere Organisation (deterministisch: naechste in sortierter Liste, die nicht im Text vorkommt)
    b = copy.deepcopy(c)
    low = Tb.lower()
    alt = next(o for o in orgs[orgs.index(c['n']) + 1:] + orgs if o != c['n'] and o.split(' ')[0].lower() not in low)
    b['n'] = alt; b['r'] = ''
    rbb = p.check(b, prompt, minfo); kb = rbb['ki'] or {}
    ro = p.check(c, prompt, minfo); ko = ro['ki'] or {}
    out.append({'id': i, 'layer': c['_layer'], 'zahl': {'urteil': ra['urteil'], 'gruende': ra['gruende'], 'feld': k, 'alt': old, 'neu': new, 'wiedergabe': ka.get('wiedergabe'), 'verdict': ka.get('verdict'), 'reason': ka.get('reason')},
                'original': {'urteil': ro['urteil'], 'gruende': ro['gruende'], 'verdict': ko.get('verdict'), 'wiedergabe': ko.get('wiedergabe'), 'zuordnung': ko.get('zuordnung'), 'reason': ko.get('reason')},
                'zuordnung': {'urteil': rbb['urteil'], 'gruende': rbb['gruende'], 'neu': alt, 'zuordnung': kb.get('zuordnung'), 'verdict': kb.get('verdict'), 'reason': kb.get('reason')}})
    print(i, c['_layer'], 'orig', ro['urteil'], ko.get('verdict'), '| zahl', old, '->', new, ra['urteil'], ka.get('verdict'), '| org', alt[:30], rbb['urteil'], kb.get('verdict'), flush=True)
z = {'n': len(out), 'zahl_x10_erkannt_FAIL': sum(o['zahl']['verdict'] == 'FAIL' for o in out),
     'zahl_x10_nicht_PASS': sum(o['zahl']['verdict'] != 'PASS' for o in out),
     'zuordnung_falsch_erkannt_FAIL': sum(o['zuordnung']['verdict'] == 'FAIL' for o in out),
     'zuordnung_falsch_nicht_PASS': sum(o['zuordnung']['verdict'] != 'PASS' for o in out),
     'original_PASS': sum(o['original']['verdict'] == 'PASS' for o in out), 'original_FAIL': sum(o['original']['verdict'] == 'FAIL' for o in out),
     'prompt_sha256': p.sha(prompt), 'startwert': SEED,
     'system_zahl_nicht_OK': sum(o['zahl']['urteil'] != 'OK' for o in out),
     'system_zuordnung_nicht_OK': sum(o['zuordnung']['urteil'] != 'OK' for o in out),
     'system_original_OK': sum(o['original']['urteil'] == 'OK' for o in out),
     'system_zahl_nicht_OK_PROVEN': '%d/%d' % (sum(o['zahl']['urteil'] != 'OK' for o in out if o['layer'] == 'PROVEN'), sum(o['layer'] == 'PROVEN' for o in out)),
     'system_zuordnung_nicht_OK_PROVEN': '%d/%d' % (sum(o['zuordnung']['urteil'] != 'OK' for o in out if o['layer'] == 'PROVEN'), sum(o['layer'] == 'PROVEN' for o in out)), 'faelle': out}
json.dump(z, open(os.path.join(HERE, os.environ.get('RR_KOUT', 'kontrolle.json')), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print({k: v for k, v in z.items() if k != 'faelle'})
