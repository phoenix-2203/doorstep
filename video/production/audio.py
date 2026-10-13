"""Music, sound effects and the final mix for the Doorstep film.

Everything here is synthesised from scratch with numpy (no samples, no third-party audio), so it
needs no licence. Reads production/timeline.json and narration/lines/*.wav; writes
  assets/audio/music.wav       the score on its own
  assets/audio/sfx.wav         the sound effects on their own
  assets/audio/voiceover.wav   the narration on its own, placed on the film's timeline
  assets/audio/mix.wav         all three mixed (narration ducks the music), before loudness normalisation
Run:  python3 production/audio.py
"""
import json, os, wave
import numpy as np
from scipy.signal import butter, sosfilt, resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = f'{ROOT}/assets/audio'
os.makedirs(OUT, exist_ok=True)
SR = 48000
T = json.load(open(f'{HERE}/timeline.json'))
DUR = T['total']
N = int(DUR * SR)
rng = np.random.default_rng(7)
start = {s['id']: s['start'] for s in T['scenes']}
local = {s['id']: [l['local'] for l in s['lines']] for s in T['scenes']}


def write(path, x):
    x = np.clip(x, -1, 1)
    st = x if x.ndim == 2 else np.stack([x, x], 1)
    with wave.open(path, 'w') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767).astype('<i2').tobytes())


def read(path):
    with wave.open(path) as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        x = np.frombuffer(w.readframes(n), '<i2').astype(np.float32) / 32768
    if ch == 2: x = x.reshape(-1, 2).mean(1)
    if sr != SR: x = resample_poly(x, SR, sr)
    return x


def lp(x, f, order=2): return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)
def hz(m): return 440 * 2 ** ((m - 69) / 12)


def smooth_curve(points):
    """Piecewise-linear control curve over the whole film, from [(time, value), ...]."""
    t = np.arange(N) / SR
    xs, ys = zip(*points)
    return np.interp(t, xs, ys)


# ------------------------------------------------------------------------------ the score
# D major, around 92 BPM. Four chords, two bars each, looping: Dmaj9 · Bm9 · Gmaj9 · A6sus.
BPM = 92; BEAT = 60 / BPM; BAR = 4 * BEAT
CHORDS = [
    (38, [62, 66, 69, 73, 76]),   # D  : D F# A C# E
    (35, [62, 66, 69, 73, 74]),   # Bm : D F# A C# D (Bm9 voicing over B)
    (31, [62, 66, 69, 71, 74]),   # G  : D F# A B D (Gmaj9 colour)
    (33, [61, 64, 66, 69, 71]),   # A  : C# E F# A B (A6sus feel)
]
CH_LEN = 2 * BAR


def chord_at(t):
    return CHORDS[int(t // CH_LEN) % len(CHORDS)]


def pad():
    """Warm sustained chords: detuned sine stacks with a few harmonics, low-passed, slow attack."""
    out = np.zeros(N)
    n_ch = int(np.ceil(DUR / CH_LEN)) + 1
    for k in range(n_ch):
        t0 = k * CH_LEN
        if t0 >= DUR: break
        root, notes = CHORDS[k % len(CHORDS)]
        L = int((CH_LEN + 1.6) * SR)
        i0 = int(t0 * SR); i1 = min(N, i0 + L); L = i1 - i0
        tt = np.arange(L) / SR
        env = np.minimum(1, tt / 1.1) * np.minimum(1, np.maximum(0, (CH_LEN + 1.6 - tt) / 1.6))
        sig = np.zeros(L)
        for m in notes:
            f = hz(m)
            for det in (-0.12, 0.12):
                ff = f * 2 ** (det / 12 / 4)
                ph = rng.uniform(0, 2 * np.pi)
                sig += np.sin(2 * np.pi * ff * tt + ph) + 0.25 * np.sin(4 * np.pi * ff * tt + ph) + 0.08 * np.sin(6 * np.pi * ff * tt + ph)
        sig += 0.7 * np.sin(2 * np.pi * hz(root + 12) * tt)
        out[i0:i1] += sig * env
    out = lp(out, 2400)
    return out / np.max(np.abs(out))


def bass():
    """Round sub bass on the chord roots: a held note, re-struck on beat 1 and the 'and' of 3."""
    out = np.zeros(N)
    t = 0.0
    while t < DUR:
        root, _ = chord_at(t)
        for off, ln in ((0, 2.4 * BEAT), (2.5 * BEAT, 1.4 * BEAT)):
            i0 = int((t + off) * SR)
            if i0 >= N: break
            L = min(N - i0, int(ln * SR)); tt = np.arange(L) / SR
            env = np.minimum(1, tt / 0.02) * np.exp(-tt * 0.9) * np.minimum(1, (ln - tt) / 0.08)
            f = hz(root)
            out[i0:i0 + L] += (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)) * env
        t += BAR
    return lp(out, 300) / 1.3


def pluck_note(f, length, bright=0.5):
    L = int(length * SR); tt = np.arange(L) / SR
    env = np.minimum(1, tt / 0.004) * np.exp(-tt * 7)
    s = np.sin(2 * np.pi * f * tt) + bright * 0.5 * np.sin(4 * np.pi * f * tt) * np.exp(-tt * 10) + bright * 0.2 * np.sin(6 * np.pi * f * tt) * np.exp(-tt * 16)
    return s * env


def pulse():
    """The 'heartbeat' of the score: soft plucked 8th notes walking the chord tones."""
    out = np.zeros(N)
    step = BEAT / 2; k = 0
    while k * step < DUR:
        t = k * step
        _, notes = chord_at(t)
        pat = [0, 2, 1, 3, 0, 2, 4, 2]
        m = notes[pat[k % 8]] + (12 if k % 16 in (6, 14) else 0)
        acc = 1.0 if k % 2 == 0 else 0.65
        x = pluck_note(hz(m), 0.6) * acc
        i0 = int(t * SR); i1 = min(N, i0 + len(x)); out[i0:i1] += x[:i1 - i0]
        k += 1
    return lp(out, 3500) / 3.2


def ticks():
    """Light high clicks on the off-beats for momentum in the second half."""
    out = np.zeros(N)
    step = BEAT / 2; k = 0
    while k * step < DUR:
        t = k * step
        L = int(0.05 * SR); tt = np.arange(L) / SR
        x = rng.standard_normal(L) * np.exp(-tt * 90) * (1.0 if k % 2 else 0.4)
        i0 = int(t * SR); i1 = min(N, i0 + L); out[i0:i1] += x[:i1 - i0]
        k += 1
    return hp(out, 7000) * 0.5


def swell():
    """Reversed-cymbal style noise rise into the 'Live on Arc mainnet' moment and the ending."""
    out = np.zeros(N)
    for at, ln in ((start['product'] + 0.3, 2.2), (start['close'] + 0.2, 2.6)):
        L = int(ln * SR); tt = np.arange(L) / SR
        x = bp(rng.standard_normal(L), 2500, 9000) * (tt / ln) ** 3
        i1 = int(at * SR); i0 = max(0, i1 - L); out[i0:i1] += x[L - (i1 - i0):]
    return out * 0.35


# Section levels (linear gain), so the score builds and then resolves.
S = start
lv_pad = smooth_curve([(0, .0), (1.5, .55), (S['friction'], .5), (S['intro'], .62), (S['mechanism'], .55), (S['product'], .6), (S['arc'], .62), (S['uses'], .66), (S['close'], .7), (DUR - 5, .6), (DUR, 0)])
lv_bass = smooth_curve([(0, 0), (S['intro'] - .2, 0), (S['intro'] + 1.0, .8), (S['mechanism'], .75), (S['close'] + 3.0, .8), (DUR - 4, .5), (DUR, 0)])
lv_pulse = smooth_curve([(0, 0), (S['friction'] - 1, 0), (S['friction'] + 1, .45), (S['intro'], .5), (S['mechanism'], .75), (S['arc'], .85), (S['uses'], .95), (S['close'] + 2.5, .9), (S['close'] + 5.5, 0), (DUR, 0)])
lv_tick = smooth_curve([(0, 0), (S['product'] - .1, 0), (S['product'] + 1, .5), (S['arc'], .6), (S['security'], .4), (S['uses'], .75), (S['close'] + 2.5, .7), (S['close'] + 4, 0), (DUR, 0)])

music = 0.30 * pad() * lv_pad + 0.32 * bass() * lv_bass + 0.30 * pulse() * lv_pulse + 0.06 * ticks() * lv_tick + swell()
# gentle stereo width: pad/pulse get a short Haas delay on the right channel
right = np.concatenate([np.zeros(int(0.011 * SR)), music[:-int(0.011 * SR)]])
music_st = np.stack([music, 0.85 * right + 0.15 * music], 1)

# ------------------------------------------------------------------------------ sound effects
def place(buf, x, at, gain=1.0, pan=0.0):
    i0 = int(at * SR); i1 = min(N, i0 + len(x))
    if i0 >= N or i1 <= 0: return
    l, r = (1 - max(0, pan)), (1 + min(0, pan))
    buf[i0:i1, 0] += x[:i1 - i0] * gain * l
    buf[i0:i1, 1] += x[:i1 - i0] * gain * r


def whoosh(ln=0.9, up=True):
    L = int(ln * SR); tt = np.arange(L) / SR
    n = rng.standard_normal(L)
    lo = np.linspace(400, 2600, L) if up else np.linspace(2600, 400, L)
    # sweep a band-pass by filtering in short blocks
    out = np.zeros(L); B = 960
    for i in range(0, L, B):
        c = lo[i]; out[i:i + B] = bp(n[max(0, i - B):i + B], c * 0.7, c * 1.4)[-len(out[i:i + B]):]
    env = np.sin(np.pi * np.clip(tt / ln, 0, 1)) ** 2
    return out * env * 0.9


def blip(freqs, gap=0.06, ln=0.35):
    L = int((ln + gap * len(freqs)) * SR); out = np.zeros(L)
    for k, f in enumerate(freqs):
        x = pluck_note(f, ln, bright=0.3)
        i0 = int(k * gap * SR); out[i0:i0 + len(x)] += x[:L - i0]
    return out * 0.6


def thump():
    L = int(0.35 * SR); tt = np.arange(L) / SR
    f = 120 * np.exp(-tt * 8) + 55
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 14)


def chime(notes, ln=1.6):
    L = int((ln + 0.12 * len(notes)) * SR); out = np.zeros(L)
    for k, m in enumerate(notes):
        tt = np.arange(int(ln * SR)) / SR; f = hz(m)
        x = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2.76 * f * tt) * np.exp(-tt * 6) + 0.2 * np.sin(2 * np.pi * 5.4 * f * tt) * np.exp(-tt * 12)) * np.minimum(1, tt / 0.003) * np.exp(-tt * 3.2)
        i0 = int(k * 0.12 * SR); out[i0:i0 + len(x)] += x
    return out * 0.45


def scramble(ln=0.65):
    out = np.zeros(int(ln * SR)); k = 0
    while k * 0.033 < ln - 0.05:
        x = pluck_note(hz(84 + (k * 5) % 12), 0.05, bright=0.8) * 0.5
        i0 = int(k * 0.033 * SR); out[i0:i0 + len(x)] += x[:len(out) - i0]; k += 1
    return out


sfx = np.zeros((N, 2))
M = start['mechanism']; mL = local['mechanism']
Sx = [mL[1] - 0.3, mL[2] - 0.2, mL[3] - 0.2, mL[4] - 0.2]
EV = []  # (abs time, name) for the documentation
def ev(at, name, x, gain, pan=0.0): place(sfx, x, at, gain, pan); EV.append((round(at, 2), name))

H0 = start['hook']; hL = local['hook']
ev(H0 + hL[1] + 1.5, 'hook: transfer travels to the app (whoosh)', whoosh(3.0), 0.25)
ev(H0 + hL[2] + 0.4, 'hook: arrives, nobody credited (dull thump)', lp(thump(), 400), 0.6)
I0 = start['intro']; iL = local['intro']
ev(I0 + iL[1] + 1.3, 'intro: transfer through Doorstep (whoosh)', whoosh(2.8), 0.25)
ev(I0 + iL[1] + 4.3, 'intro: credited (chime)', chime([78, 81]), 0.4)
ev(M + Sx[1] + 0.5, 'address calculated (rising blips)', blip([hz(m) for m in (74, 78, 81, 86)]), 0.55)
ev(M + mL[2] + 3.0, 'instructions changed: new address (scramble)', scramble(), 0.35)
ev(M + Sx[2] + 1.1, 'payment sent (whoosh)', whoosh(1.7), 0.35, -0.3)
ev(M + Sx[2] + 2.85, 'payment arrives at the address (soft thump)', thump(), 0.55)
ev(M + Sx[3] + 1.5, 'delivery (whoosh)', whoosh(1.7), 0.35, 0.3)
ev(M + Sx[3] + 3.15, 'deposit credited (chime)', chime([81, 86]), 0.5)
ev(M + mL[4] + 4.6, 'return path shown (falling two notes)', blip([hz(76), hz(69)], gap=0.11, ln=0.5), 0.45)
P0 = start['product']; pL = local['product']
ev(P0 + pL[2] + 1.4, 'real interface: delivered (chime)', chime([78, 83]), 0.4)
A0 = start['arc']; aL = local['arc']
ev(A0 + aL[1] + 0.6, 'payment into deposit() (whoosh)', whoosh(1.0), 0.28)
ev(A0 + aL[1] + 2.2, 'split: vault credited (blip)', blip([hz(81)]), 0.4)
ev(A0 + aL[1] + 3.6, 'split: capped bot fee (blip)', blip([hz(76)]), 0.3)
for i in range(3): ev(A0 + aL[2] + i * 0.75 + 0.35, f'strike-through {i + 1}', blip([hz(62)], ln=0.2), 0.25)
C0 = start['close']; cL = local['close']
ev(C0 + cL[0] + 0.6, 'trail into the door (whoosh)', whoosh(1.5), 0.3)
ev(C0 + cL[0] + 2.1, 'arrives home (chime)', chime([74, 78, 81, 86], ln=2.4), 0.5)

# ------------------------------------------------------------------------------ voiceover
vo = np.zeros(N)
for l in T['lines']:
    x = read(f'{ROOT}/narration/{l["file"]}')
    i0 = int(l['at'] * SR); i1 = min(N, i0 + len(x)); vo[i0:i1] += x[:i1 - i0]
vo = vo / np.max(np.abs(vo)) * 0.89
# a touch of warmth: gentle low-shelf lift by blending a low-passed copy, and a de-rumble high-pass
vo = hp(vo + 0.18 * lp(vo, 220), 70)
vo = vo / np.max(np.abs(vo)) * 0.89

# ------------------------------------------------------------------------------ ducking and mix
active = np.zeros(N)
for l in T['lines']:
    active[int(max(0, l['at'] - 0.15) * SR):int(min(DUR, l['at'] + l['dur'] + 0.1) * SR)] = 1
# smooth: ~250 ms attack/release via a moving average
k = int(0.25 * SR); duck = np.convolve(active, np.ones(k) / k, 'same')
music_gain = 1 - 0.72 * duck  # about -11 dB under speech
mix = music_st * music_gain[:, None] * 0.45 + 0.6 * sfx + np.stack([vo, vo], 1)
db = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
sp = active > 0
bed = music_st[:, 0] * music_gain * 0.45
print(f'levels under speech: voice {db(vo[sp]):.1f} dBFS, music {db(bed[sp]):.1f} dBFS; music between lines {db(bed[~sp]):.1f} dBFS; sfx peak {20*np.log10(np.max(np.abs(sfx))):.1f} dBFS')
peak = np.max(np.abs(mix)); mix = mix / peak * 0.9

write(f'{OUT}/music.wav', music_st / np.max(np.abs(music_st)) * 0.9)
write(f'{OUT}/sfx.wav', sfx / max(1e-9, np.max(np.abs(sfx))) * 0.9)
write(f'{OUT}/voiceover.wav', vo)
write(f'{OUT}/mix.wav', mix)
json.dump(EV, open(f'{OUT}/sfx_events.json', 'w'), indent=1)
print('wrote', OUT, 'duration', round(DUR, 2), 's;', len(EV), 'sound effects')
