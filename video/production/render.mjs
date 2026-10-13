// Renders film.html frame by frame (deterministic: every frame is seek(t) + screenshot) and pipes
// the frames to ffmpeg. Usage:
//   node render.mjs stills 3 12.5 40      -> stills/ at those seconds
//   node render.mjs video [from] [to]     -> frames.mp4 (silent), 30 fps
import { chromium } from '/opt/node-tools/node_modules/playwright-core/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const HERE = new URL('.', import.meta.url).pathname;
const TL = JSON.parse(fs.readFileSync(HERE + 'timeline.json', 'utf8'));
const MIME = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', html: 'text/html', json: 'application/json' };
const srv = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[f.split('.').pop()] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.PORT ?? 8650));

const [mode, ...args] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.addInitScript((tl) => { window.TL = tl; }, TL);
await page.goto(`http://localhost:${process.env.PORT ?? 8650}/video/production/film.html`);
await page.evaluate(() => window.ready);
await page.waitForTimeout(500);

if (mode === 'stills') {
  fs.mkdirSync(HERE + 'stills', { recursive: true });
  for (const s of args.map(Number)) {
    await page.evaluate((t) => window.seek(t), s);
    await page.screenshot({ path: `${HERE}stills/t${String(s.toFixed(1)).padStart(6, '0')}.jpg`, type: 'jpeg', quality: 85 });
  }
} else {
  const FPS = 30;
  const from = Number(args[0] ?? 0), to = Number(args[1] ?? TL.total);
  const out = args[2] ?? HERE + 'frames.mp4';
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((to - from) * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = from + i / FPS;
    await page.evaluate(async (x) => { window.seek(x); await Promise.all([...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => {}))); }, t);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('wrote', out);
}
await b.close(); srv.close();
