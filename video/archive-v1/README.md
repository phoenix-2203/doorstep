# Demo video

How `doorstep-demo.mp4` (2:22, 1080p) is made. The payment section is a screen recording of a real
payment on Arc mainnet through the live site; everything else is recorded from the site itself.

1. `script.json` is the voiceover, scene by scene.
2. The voice is generated offline with [Piper](https://github.com/rhasspy/piper) (voice `en-us-ryan-high`). "USDC" is spoken as "U.S.D.C.".
3. `timeline.py` lays the lines out per scene; the mainnet recording is cut and sped up (segments listed there, never altered otherwise).
4. `record.mjs` records the web scenes and the title cards (`cards/`) with Playwright at 1920×1080. The landing page's live-activity list is hidden in these shots because the recorder runs against a local copy with test data.
5. `trim.py` and `assemble.py` cut the clips, crossfade them, mix the voice and a chime on delivery, and burn in captions with ffmpeg.
