"""Writes the caption file (SRT) for the film from timeline.json. Upload it to YouTube alongside the
video. Long narration lines are split into cues of at most two lines of ~42 characters, timed in
proportion to their length. Run:  python3 production/captions.py"""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(f'{HERE}/timeline.json'))
MAXC = 42


def ts(s):
    ms = int(round(s * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); sec, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{sec:02d},{ms:03d}'


def wrap(words):
    lines, cur = [], ''
    for w in words:
        if cur and len(cur) + 1 + len(w) > MAXC: lines.append(cur); cur = w
        else: cur = (cur + ' ' + w).strip()
    if cur: lines.append(cur)
    return lines


def chunks(text):
    """Split at sentence or clause boundaries into pieces that fit two caption lines."""
    parts = re.split(r'(?<=[.:?!])\s+|(?<=,)\s+(?=\S{3,})', text)
    out, cur = [], ''
    for p in parts:
        cand = (cur + ' ' + p).strip()
        if cur and len(wrap(cand.split())) > 2: out.append(cur); cur = p
        else: cur = cand
    if cur: out.append(cur)
    final = []
    for c in out:  # a single clause still too long: split it by words
        ws = c.split()
        while len(wrap(ws)) > 2:
            k = len(ws) // 2; final.append(' '.join(ws[:k])); ws = ws[k:]
        final.append(' '.join(ws))
    return final


cues = []
for l in T['lines']:
    pieces = chunks(l['text'])
    total = sum(len(p) for p in pieces); t = l['at']
    for p in pieces:
        d = l['dur'] * len(p) / total
        cues.append((t, t + d, '\n'.join(wrap(p.split())))); t += d
# hold each cue a little after speech, never overlapping the next
srt = []
for i, (a, b, txt) in enumerate(cues):
    end = min(b + 0.35, cues[i + 1][0] - 0.05) if i + 1 < len(cues) else b + 0.8
    srt.append(f'{i + 1}\n{ts(a)} --> {ts(end)}\n{txt}\n')
path = f'{HERE}/../Doorstep_Arc_Microgrants_Master.srt'
open(path, 'w').write('\n'.join(srt))
print('wrote', os.path.normpath(path), len(cues), 'cues')
