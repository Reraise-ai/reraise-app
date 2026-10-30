import json, sys, os, collections, hashlib
"""Summarises a results file: python auswerten.py [ergebnis.jsonl [zusammenfassung.json]] (working directory)."""
HERE = os.getcwd()
def load(p):
    return [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
EIN = sys.argv[1] if len(sys.argv) > 1 else 'ergebnis.jsonl'
AUS = sys.argv[2] if len(sys.argv) > 2 else 'zusammenfassung.json'
HAUPT = len(sys.argv) <= 1
R = load(os.path.join(HERE, EIN))
by = collections.defaultdict(list)
for r in R: by[r['urteil']].append(r['id'])
gr = collections.defaultdict(collections.Counter)
for r in R:
    for g in r['gruende'] or ['-']: gr[r['urteil']][g] += 1
st = collections.Counter(str(r['quelle']['status'] or r['quelle']['error'] or '').split(':')[0] for r in R)
ki = collections.Counter((r['ki'] or {}).get('verdict', 'nicht gelaufen') for r in R)
z = {'karten': len(R), 'urteile': {k: len(v) for k, v in by.items()},
     'urteil_nach_layer': {f'{l}->{u}': n for (l, u), n in collections.Counter((r['layer'], r['urteil']) for r in R).items()},
     'gruende': {k: dict(v) for k, v in gr.items()}, 'http_status_je_karte': dict(st), 'ki_verdict': dict(ki),
     'regel_b_bestanden': sum(r['regel_b_zitat']['bestanden'] for r in R),
     'regel_b_geprueft': sum(r['regel_b_zitat']['geprueft'] for r in R),
     'regel_c_bestanden': sum(r['regel_c_zahlen']['bestanden'] for r in R if r['regel_c_zahlen'].get('geprueft')),
     'regel_c_geprueft': sum(1 for r in R if r['regel_c_zahlen'].get('geprueft')),
     'urls': len(set(r['url'] for r in R)), 'ids': {k: sorted(v) for k, v in by.items()},
     'modell': next((r['modell'] for r in R if r['modell']), None), 'prompt_sha256': R[0]['prompt_sha256']}
wp = os.path.join(HERE, 'wiederholung.jsonl')
if HAUPT and os.path.exists(wp):
    W = {r['id']: r for r in load(wp)}; A = {r['id']: r for r in R}
    def key(r):
        k = r['ki'] or {}
        return json.dumps([r['regel_b_zitat'], r['regel_c_zahlen'], r['fundstelle'], k.get('roh'), k.get('verdict'), r['urteil']], sort_keys=True)
    same = [i for i in W if key(W[i]) == key(A[i])]
    same_u = [i for i in W if W[i]['urteil'] == A[i]['urteil'] and (W[i]['ki'] or {}).get('verdict') == (A[i]['ki'] or {}).get('verdict')]
    z['wiederholung'] = {'karten': sorted(W), 'n': len(W), 'identisch_vollstaendig': len(same),
                         'identisch_urteil_und_ki': len(same_u), 'prozent_vollstaendig': round(100 * len(same) / len(W), 1),
                         'abweichend': sorted(set(W) - set(same))}
ig = collections.defaultdict(list)
for r in R:
    for g in r['gruende'] or ['-']:
        ig[r['urteil'] + ' | ' + g].append(r['id'])
z['ids_nach_grund'] = {k: sorted(v) for k, v in sorted(ig.items())}
z['eingabe_sha256'] = R[0].get('eingabe_sha256')
kp = os.path.join(HERE, 'kontrolle.json')
if HAUPT and os.path.exists(kp):
    k = json.load(open(kp, encoding='utf-8')); z['kontrolle'] = {a: b for a, b in k.items() if a != 'faelle'}
json.dump(z, open(os.path.join(HERE, AUS), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in z.items() if k != 'ids'}, ensure_ascii=False, indent=1))
