import json, subprocess, sys
T=json.load(open('timeline.json'))
for s in (sys.argv[1:] or T['_order']):
    if s=='demo': continue
    off=float(open(f'raw/{s}.offset').read()); d=T[s]['dur']
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(off),'-i',f'raw/{s}.webm','-vf','fps=30,scale=1920:1080,format=yuv420p,tpad=stop_mode=clone:stop_duration=1','-t',str(d),'-an','-c:v','libx264','-preset','medium','-crf','18',f'clips/{s}.mp4'],check=True)
