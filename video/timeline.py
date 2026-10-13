import json
lines = json.load(open('vo/lines.json'))
by = {}
for l in lines: by.setdefault(l['scene'], []).append(l)
order = ['open','problem','solution','demo','trust','devs','arc','end']
T = {}
def seq(scene, lead=0.7, gap=0.45, tail=0.9, gaps=None):
    t = lead; starts = []
    for i, l in enumerate(by[scene]):
        starts.append(round(t, 3)); t += l['dur'] + ((gaps or {}).get(i, gap))
    return starts, round(t - ((gaps or {}).get(len(by[scene])-1, gap)) + tail, 3)
for s in ['open','problem','solution','trust','devs','arc']:
    st, d = seq(s, lead=0.9 if s=='open' else 0.6, gap=0.5 if s!='open' else 0.6)
    T[s] = {'dur': d, 'starts': st}
st, d = seq('end', lead=0.8, gap=0.9, tail=3.2)
T['end'] = {'dur': d, 'starts': st}
# Demo: the user's real mainnet recording, cut and sped up. (src_start, src_end, speed)
segs = [(21.5,26.0,1.0),(31.0,35.0,1.0),(64.0,75.0,2.0),(75.0,87.0,1.6),(87.0,97.5,1.0),(97.5,105.0,1.5),(105.0,110.5,1.0)]
pos = []; t = 0
for a,b,sp in segs: pos.append(t); t += (b-a)/sp
dl = by['demo']; starts = []
anchors = [0.5, pos[1]+0.3, pos[3]+0.4, pos[4]+1.4, None, pos[5]+0.2]
prev_end = 0
for i,l in enumerate(dl):
    s = max(anchors[i] if anchors[i] is not None else 0, prev_end + 0.4)
    starts.append(round(s,3)); prev_end = s + l['dur']
T['demo'] = {'dur': round(max(t, prev_end + 0.8),3), 'starts': starts, 'segs': segs, 'chime': round(pos[4] + 1.6, 3)}
t0 = 0
for s in order: T[s]['at'] = round(t0,3); t0 += T[s]['dur']
T['_order'] = order; T['_total'] = round(t0,3)
json.dump(T, open('timeline.json','w'), indent=1)
for s in order: print(s, T[s]['at'], T[s]['dur'], T[s]['starts'])
print('total', round(t0,1))
