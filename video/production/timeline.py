"""Lay the narration out in time. Writes production/timeline.json, used by film.html, the music
and sound generator and the mixer."""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
L = json.load(open(f'{here}/../narration/lines.json'))
order = ['hook', 'friction', 'intro', 'mechanism', 'product', 'arc', 'security', 'uses', 'close']
# lead before the first line, gap between lines, tail after the last line (seconds)
P = {
    'hook':      (0.9, [0.55, 0.9], 2.1),
    'friction':  (0.5, [0.5, 0.7], 1.2),
    'intro':     (0.7, [0.6], 1.2),
    'mechanism': (0.4, [0.5, 0.9, 0.9, 0.9], 1.4),
    'product':   (0.5, [0.6, 0.9, 0.9, 0.7], 1.3),
    'arc':       (0.5, [0.6, 0.6], 1.4),
    'security':  (0.5, [0.7, 0.8], 1.3),
    'uses':      (0.4, [0.5, 0.6], 1.3),
    'close':     (0.8, [0.6], 6.0),
}
X = 0.6  # scene crossfade
T, t = {'scenes': [], 'lines': []}, 0.0
for s in order:
    lead, gaps, tail = P[s]
    lines = [l for l in L if l['scene'] == s]
    u = lead; starts = []
    for i, l in enumerate(lines):
        starts.append(round(u, 3)); u += l['dur'] + (gaps[i] if i < len(gaps) else 0)
    dur = round(u + tail, 3)
    T['scenes'].append({'id': s, 'start': round(t, 3), 'dur': dur, 'lines': [{'at': round(t + a, 3), 'local': a, 'dur': l['dur'], 'text': l['text'], 'file': l['file']} for a, l in zip(starts, lines)]})
    for a, l in zip(starts, lines): T['lines'].append({'scene': s, 'at': round(t + a, 3), 'dur': l['dur'], 'text': l['text'], 'file': l['file']})
    t += dur - X
T['total'] = round(t + X, 3)
T['crossfade'] = X
json.dump(T, open(f'{here}/timeline.json', 'w'), indent=1)
for s in T['scenes']: print(f"{s['id']:10s} start {s['start']:7.2f}  dur {s['dur']:6.2f}  lines {[round(x['local'],1) for x in s['lines']]}")
print('total', T['total'])
