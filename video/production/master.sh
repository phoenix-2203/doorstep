#!/usr/bin/env bash
# Joins the rendered picture with the mix, normalises loudness to -16 LUFS / -1.5 dBTP (two-pass),
# and writes video/Doorstep_Arc_Microgrants_Master.mp4 (H.264 1080p30 + AAC 48 kHz stereo).
# Expects production/part1.mp4 and part2.mp4 (or frames.mp4) from render.mjs, and assets/audio/mix.wav.
set -euo pipefail
cd "$(dirname "$0")"
if [ -f part1.mp4 ] && [ -f part2.mp4 ]; then
  printf "file 'part1.mp4'\nfile 'part2.mp4'\n" > parts.txt
  ffmpeg -v error -y -f concat -safe 0 -i parts.txt -c copy frames.mp4
fi
J=$(ffmpeg -hide_banner -nostats -i ../assets/audio/mix.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
M=$(echo "$J" | python3 -c "import json,sys;d=json.load(sys.stdin);print(f\"measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}:offset={d['target_offset']}\")")
ffmpeg -v error -y -i frames.mp4 -i ../assets/audio/mix.wav -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:$M:linear=true,aresample=48000" -c:a aac -b:a 256k -ar 48000 \
  -movflags +faststart -shortest ../Doorstep_Arc_Microgrants_Master.mp4
# the voiceover on its own, as a deliverable
ffmpeg -v error -y -i ../assets/audio/voiceover.wav -af loudnorm=I=-16:TP=-1.5 -ar 48000 -c:a pcm_s16le ../Doorstep_Voiceover.wav
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,sample_rate,channels:format=duration -of compact ../Doorstep_Arc_Microgrants_Master.mp4
