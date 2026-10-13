// Records the web scenes of the demo video at 1920x1080 with Playwright.
import { chromium } from '/opt/node-tools/node_modules/playwright-core/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { mockRpc } from './serve.mjs';

const T = JSON.parse(fs.readFileSync('timeline.json', 'utf8'));
const DIST = '/home/claude/doorstep/web/dist';
const CARDS = path.resolve('cards');
const MIME = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', html: 'text/html' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]);
  let root = DIST;
  if (p.startsWith('/cards/')) { root = CARDS; p = p.slice(6); } else p = p.replace(/^\/doorstep/, '');
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[f.split('.').pop()] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8630);
const B = 'http://localhost:8630';
fs.mkdirSync('raw', { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2];

async function scene(name, url, prep, actions) {
  if (only && only !== name) return;
  const { dur, starts } = T[name];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: 'raw/tmp', size: { width: 1920, height: 1080 } }, reducedMotion: 'no-preference' });
  const t0 = Date.now();
  const page = await ctx.newPage();
  await mockRpc(page);
  page.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  page.on('requestfailed', (r) => { if (!/fonts.g|google/.test(r.url())) console.log(name, 'failed', r.url()); });
  await page.goto(B + url);
  if (url.startsWith('/doorstep')) await page.addStyleTag({ content: 'html { zoom: 1.4; } .site-header { position: static !important; }' });
  await page.evaluate(() => document.fonts.ready);
  await prep(page);
  await sleep(400);
  const mark = Date.now();
  const timers = actions.map(([at, fn]) => sleep(at * 1000).then(() => fn(page)));
  await sleep(dur * 1000 + 300);
  await Promise.all(timers);
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  fs.renameSync(src, `raw/${name}.webm`);
  fs.writeFileSync(`raw/${name}.offset`, String((mark - t0) / 1000));
  console.log(name, 'recorded, offset', ((mark - t0) / 1000).toFixed(2), 'dur', dur);
}

// scrollIntoView copes with the CSS zoom used to enlarge the site for 1080p.
const smooth = (sel, block = 'start', extra = 0) => async (p) => p.evaluate(([s, b, e]) => {
  document.querySelector(s).scrollIntoView({ behavior: 'smooth', block: b });
}, [sel, block, extra]);
const jump = (sel, extra = 0, block = 'start') => async (p) => p.evaluate(([s, e, b]) => {
  document.querySelector(s).scrollIntoView({ block: b }); scrollBy(0, e);
}, [sel, extra, block]);

// 1. Opening card
await scene('open', '/cards/open.html', async () => {}, [[0, (p) => p.evaluate((s) => window.__play(s), T.open.starts)]]);

// 2. The problem
await scene('problem', '/doorstep/', jump('#problem', -40), [
  [T.problem.starts[1] - 0.3, smooth('.versus', 'center')],
  [T.problem.starts[2] + 1.0, (p) => p.evaluate(() => { const n = document.querySelector('.versus .note a'); n.style.background = '#B9F27C'; n.style.color = '#10241C'; n.style.borderRadius = '4px'; n.style.padding = '0 4px'; })],
]);

// 3. The solution: the payment route, then a refund
await scene('solution', '/doorstep/', async (p) => { await jump('#track', 0, 'center')(p); await sleep(5200); }, [
  [T.solution.starts[0] - 0.2, (p) => p.click('#t-replay')],
  [T.solution.starts[3] - 2.4, (p) => p.click('#t-refund')],
]);

// 5. Instructions = address
await scene('trust', '/doorstep/', async (p) => { await jump('#inspect', -40)(p); await p.waitForFunction(() => /0x/.test(document.querySelector('#i-addr').textContent), null, { timeout: 15000 }); }, [
  [T.trust.starts[0] + 0.9, smooth('.result-box', 'center')],
  [T.trust.starts[1] - 0.2, async (p) => { await p.click('input[name=minimum]', { clickCount: 3 }); await p.keyboard.type('30', { delay: 180 }); }],
  [T.trust.starts[1] + 2.4, async (p) => { await p.selectOption('select[name=expiry]', '2027-07-01'); }],
  [T.trust.starts[2] - 0.2, async (p) => { await p.click('input[name=reference]', { clickCount: 3 }); await p.keyboard.type('inv-2001', { delay: 120 }); }],
]);

// 6. Developers: SDK, API, webhook, AI agent
await scene('devs', '/doorstep/', jump('#developers', -40), [
  [T.devs.starts[1] - 0.1, (p) => p.click('#tab-api')],
  [T.devs.starts[1] + 3.0, (p) => p.click('#tab-hook')],
  [T.devs.starts[2] - 0.1, (p) => p.click('#tab-agent')],
]);

// 7. Arc, then the facts (the live feed is hidden: in this recording it would be test data)
await scene('arc', '/doorstep/', async (p) => {
  await p.addStyleTag({ content: '#activity .activity > div:first-child, #activity .lead { display: none !important; } #activity .activity { grid-template-columns: 1fr !important; max-width: 1000px; }' });
  await sleep(800); await jump('#arc', -40)(p); await sleep(300);
}, [
  [T.arc.starts[1] - 0.3, smooth('#activity', 'start', -10)],
]);

// 8. Ending card
await scene('end', '/cards/end.html', async () => {}, [[0, (p) => p.evaluate((s) => window.__play(s), T.end.starts)]]);

await browser.close(); srv.close();
