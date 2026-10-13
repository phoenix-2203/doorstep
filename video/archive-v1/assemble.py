"""Assemble the Doorstep demo video: scene clips with crossfades, voiceover, a chime on delivery,
burned-in captions and a 'real payment' badge during the mainnet recording."""
import json, math, struct, subprocess, wave

T = json.load(open('timeline.json'))
L = json.load(open('vo/lines.json'))
order = T['_order']
X = 0.4  # crossfade length

# Absolute start of each scene once crossfades overlap them.
at, t = {}, 0.0
for i, s in enumerate(order):
    at[s] = t
    t += T[s]['dur'] - (X if i < len(order) - 1 else 0)
total = t
print('total', round(total, 2))

# ---------------------------------------------------------------- video: crossfaded scenes
inputs, fc, prev, off = [], [], '[0:v]', 0.0
for i, s in enumerate(order):
    inputs += ['-i', f'clips/{s}.mp4']
for i in range(1, len(order)):
    off += T[order[i - 1]]['dur'] - X
    out = f'[x{i}]'
    fc.append(f'{prev}[{i}:v]xfade=transition=fade:duration={X}:offset={off:.3f}{out}')
    prev = out

# ---------------------------------------------------------------- captions (ASS)
def ts(sec):
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = sec % 60
    return f'{h}:{m:02d}:{s:05.2f}'

ass = ["""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Schibsted 600,46,&H00FFFFFF,&H00FFFFFF,&H40221A15,&H40221A15,0,0,0,0,100,100,0,0,3,14,0,2,220,220,64,1
Style: Badge,Schibsted 700,34,&H001C2410,&H001C2410,&H007CF2B9,&H007CF2B9,0,0,0,0,100,100,0,0,3,12,0,9,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"""]
vo = []  # (abs_start, file)
for l in L:
    s = l['scene']
    start = at[s] + T[s]['starts'][l['li']]
    vo.append((start, l['file']))
    if s not in ('open', 'end'):  # the cards already show their words
        end = start + l['dur'] + 0.15
        ass.append(f"Dialogue: 0,{ts(start)},{ts(end)},Cap,,0,0,0,,{l['text']}")
d0 = at['demo'] + 0.3
ass.append(f"Dialogue: 1,{ts(d0)},{ts(at['demo'] + T['demo']['dur'] - 0.5)},Badge,,0,0,0,,Real payment on Arc mainnet")
open('captions.ass', 'w').write('\n'.join(ass) + '\n')

fc.append(f"{prev}subtitles=captions.ass:fontsdir=fonts,format=yuv420p[v]")

# ---------------------------------------------------------------- audio: voiceover + chime
def chime(path, sr=22050):
    n = int(sr * 0.9); data = []
    for i in range(n):
        t = i / sr; v = 0.0
        for k, (f, t0) in enumerate([(880, 0.0), (1320, 0.12)]):
            if t >= t0:
                tt = t - t0
                env = min(1, tt / 0.015) * math.exp(-tt * 6)
                v += 0.22 * env * math.sin(2 * math.pi * f * tt)
        data.append(int(max(-1, min(1, v)) * 32767))
    w = wave.open(path, 'w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(struct.pack(f'<{n}h', *data)); w.close()
chime('chime.wav')
vo.append((at['demo'] + T['demo']['chime'], 'chime.wav'))

a_inputs, a_fc = [], []
base = len(order)
for j, (start, f) in enumerate(vo):
    a_inputs += ['-i', f]
    ms = int(start * 1000)
    a_fc.append(f'[{base + j}:a]aresample=48000,adelay={ms}|{ms}[a{j}]')
a_fc.append(''.join(f'[a{j}]' for j in range(len(vo))) + f'amix=inputs={len(vo)}:normalize=0,apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[a]')

cmd = ['ffmpeg', '-v', 'error', '-y'] + inputs + a_inputs + ['-filter_complex', ';'.join(fc + a_fc), '-map', '[v]', '-map', '[a]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
       '-movflags', '+faststart', '-t', f'{total:.3f}', 'doorstep-demo.mp4']
subprocess.run(cmd, check=True)
print('done')
