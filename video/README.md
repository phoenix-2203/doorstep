# Doorstep product film

`Doorstep_Arc_Microgrants_Master.mp4` is a 2 minute 47 second film for the Arc Microgrants submission: 1920×1080, 30 fps, H.264 with AAC 48 kHz stereo audio, loudness −16 LUFS, true peak −1.4 dBTP. Captions are in `Doorstep_Arc_Microgrants_Master.srt`; the narration alone is `Doorstep_Voiceover.m4a`.

Everything in it is generated from this folder: no screen recording, stock footage, stock music or third-party samples.

| File | What it is |
| --- | --- |
| [FACTS.md](FACTS.md) | Every claim in the film and how it was verified |
| [CAPABILITIES.md](CAPABILITIES.md) | What the product demonstrably does, and what it doesn't |
| [STORYBOARD.md](STORYBOARD.md) | Scene-by-scene plan |
| [VOICEOVER.md](VOICEOVER.md) | Script with timings and pronunciation, plus how to swap the voice |
| [SHOT_LIST.md](SHOT_LIST.md) | Shots, sound effects and screens with timecodes |
| `narration/` | Script (`script.json`), voice generator, one WAV per line |
| `production/` | Timeline, the animated film page, renderer, audio, captions, mux |
| `assets/screens/` | Real interface screens captured from `web/` |
| `archive-v1/` | The first attempt, kept for reference |

## Rebuild it

Needs Python 3 with numpy and scipy, Node 18+, Playwright with Chromium, and ffmpeg. Run from `video/`:

```bash
# 1. Voice (optional: the line WAVs are committed). Needs kokoro-onnx and sherpa-onnx plus their
#    model files in $MODELS (kokoro-v1.0.onnx, voices-v1.0.bin, sherpa-onnx-whisper-base.en/).
MODELS=/path/to/models python3 narration/generate.py

# 2. Screens (optional: committed). Builds nothing; serves web/dist with the chain simulator.
node production/capture.mjs

# 3. Timing, sound and captions
python3 production/timeline.py
python3 production/audio.py
python3 production/captions.py

# 4. Picture: two halves in parallel, then mux
cd production
PORT=8651 node render.mjs video 0 83 part1.mp4 &
PORT=8652 node render.mjs video 83 "$(python3 -c 'import json;print(json.load(open("timeline.json"))["total"])')" part2.mp4 &
wait
./master.sh
```

`node production/render.mjs stills 12 54 90` renders single frames to `production/stills/` for checking.

## How it's built

- **Timing comes from the voice.** `timeline.py` lays the narration lines out with pauses and a 0.6 s crossfade between scenes. The film page, the music, the sound effects and the captions all read `timeline.json`, so changing a line moves everything with it.
- **Picture.** `film.html` is one HTML page with nine scenes. `window.seek(t)` draws any moment exactly, and `render.mjs` screenshots every frame at 30 fps, so renders are deterministic.
- **Sound.** `audio.py` synthesises the score (warm pad, soft plucked pulse, sub bass, light ticks, D major around 92 BPM) and 20 small effects with numpy, ducks the music about 11 dB under speech, and mixes. `master.sh` normalises loudness in two passes.

## Labels and honesty

Diagrams are labelled *Illustration* or *Illustrative amounts*. Product screens are labelled *Real interface · balances shown come from a test network*. Every address and transaction on screen is real (see FACTS.md). The film states that the contract is not independently audited and that only USDC on Arc is supported.

## Licences

Narration: Kokoro-82M (Apache-2.0) voice `am_michael`. Music and effects: synthesised for this film, no licence needed. Fonts: Schibsted Grotesk and JetBrains Mono (SIL Open Font License).
