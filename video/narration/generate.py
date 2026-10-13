"""Generate the narration line by line with Kokoro (am_michael), then transcribe every line with
Whisper (sherpa-onnx) as an intelligibility and pronunciation check. Writes narration/lines.json.
Models: set MODELS to a folder with kokoro-v1.0.onnx, voices-v1.0.bin and sherpa-onnx-whisper-base.en/."""
import json, os, sys, re
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
import sherpa_onnx

M = os.environ.get('MODELS', 'models')
VOICE = os.environ.get('VOICE', 'am_michael')
SPEED = float(os.environ.get('SPEED', '0.94'))
here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(f'{here}/lines', exist_ok=True)
k = Kokoro(f'{M}/kokoro-v1.0.onnx', f'{M}/voices-v1.0.bin')
d = f'{M}/sherpa-onnx-whisper-base.en/'
asr = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=d + 'base.en-encoder.onnx', decoder=d + 'base.en-decoder.onnx', tokens=d + 'base.en-tokens.txt', num_threads=4)

def norm(s):
    s = s.lower().replace('u-s-d-c', 'usdc').replace('n-p-m', 'npm').replace('s-d-k', 'sdk').replace('a-p-i', 'api').replace('m-c-p', 'mcp').replace('a-i', 'ai')
    return re.sub(r'[^a-z0-9 ]', '', re.sub(r'[-—…]', ' ', s)).split()

script = json.load(open(f'{here}/script.json'))
out = []
for si, sc in enumerate(script):
    for li, line in enumerate(sc['lines']):
        samples, sr = k.create(line['say'], voice=VOICE, speed=SPEED, lang='en-us')
        # trim leading/trailing silence, keep 40 ms
        a = np.abs(samples); idx = np.where(a > 0.01)[0]
        if len(idx): samples = samples[max(0, idx[0] - int(0.04 * sr)): idx[-1] + int(0.08 * sr)]
        f = f'lines/{si:02d}_{li:02d}.wav'
        sf.write(f'{here}/{f}', samples, sr)
        st = asr.create_stream(); st.accept_waveform(sr, samples.astype(np.float32)); asr.decode_stream(st)
        heard = st.result.text.strip()
        want, got = norm(line['text']), norm(heard)
        miss = [w for w in want if w not in got]
        out.append({'scene': sc['scene'], 'si': si, 'li': li, 'text': line['text'], 'file': f, 'dur': round(len(samples) / sr, 3), 'heard': heard, 'missing': miss})
        print(f"{sc['scene']:10s} {len(samples)/sr:5.2f}s  missing={miss}  heard: {heard}", flush=True)
json.dump(out, open(f'{here}/lines.json', 'w'), indent=1)
words = sum(len(l['text'].split()) for l in out)
print('lines', len(out), 'words', words, 'speech seconds', round(sum(l['dur'] for l in out), 1))
