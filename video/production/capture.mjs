// Captures real Doorstep interface screens at 1920x1080 from the local build (web/dist).
// Chain data comes from the in-memory test chain (web/test/sim.mjs): no real money, labelled in the film.
//   node video/production/capture.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright-core/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { depositIntent, depositAddress, intentHash, toLink } from '../../sdk/src/index.js';
import { CONFIG } from '../../web/config.js';
import { createSim } from '../../web/test/sim.mjs';

const OUT = new URL('../assets/screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const DIST = new URL('../../web/dist', import.meta.url).pathname;
const MIME = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', html: 'text/html' };
const docs = fs.readFileSync(new URL('../../api/docs.html', import.meta.url), 'utf8').replaceAll('{{BASE}}', 'https://api.arcdoorstep.duckdns.org').replaceAll('{{DOORSTEP}}', CONFIG.doorstep);
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]);
  if (p === '/docs') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(docs); }
  p = p.replace(/^\/doorstep/, '');
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[f.split('.').pop()] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8640);
const B = 'http://localhost:8640';
const ZOOM = 'html { zoom: 1.3; } .site-header { position: static !important; } .toast { zoom: 1.3; }';

const owner = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const intent = depositIntent({ into: CONFIG.escrow, beneficiary: owner, refundTo: owner, minimum: '0.01', keeperFeeCap: '0.01', expires: new Date('2027-12-31T23:59:59Z'), reference: 'doorstep-savings' });
const sim = createSim({ owner, depositAddress: depositAddress(intent, CONFIG.doorstep), intentHash: intentHash(intent) });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await sim.install(page);
const shot = async (name, sel, block = 'start', dy = 0) => {
  if (sel) await page.evaluate(([s, b2, d]) => { document.querySelector(s).scrollIntoView({ block: b2 }); scrollBy(0, d); }, [sel, block, dy]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('captured', name);
};

// Live demo
await page.goto(`${B}/doorstep/app/`);
await page.addStyleTag({ content: ZOOM });
await page.click('#btn-connect');
await page.waitForFunction(() => !document.querySelector('#btn-create').disabled);
await page.click('#btn-create');
await page.waitForFunction(() => !document.querySelector('#btn-home-pay').disabled);
await page.click('summary:has-text("What is this address?")');
await shot('demo-address', '#s2', 'start', -60);
await page.click('summary:has-text("What is this address?")');
await page.click('.chip-btn[data-amt="0.05"]');
await shot('demo-send', '#s3', 'start', -40);
await page.click('#btn-home-pay');
await page.waitForFunction(() => /arrive at your address|arrived/.test(document.querySelector('#s4-status').textContent));
await shot('demo-sent', '#s4', 'center');
await page.waitForFunction(() => /Delivered/.test(document.querySelector('#home-light').textContent), null, { timeout: 30000 });
await page.waitForTimeout(300);
await shot('demo-delivered', '#s4', 'center');
await page.click('#home-activity summary');
await shot('demo-receipt', '#act-title', 'start', -40);

// Pay page for an invoice
const inv = depositIntent({ into: CONFIG.escrow, beneficiary: owner, refundTo: owner, minimum: '25', keeperFeeCap: '0.01', expires: 1798761600, reference: 'inv-1042' });
await page.goto('about:blank');
await page.goto(`${B}/doorstep/app/${toLink(inv, { baseUrl: '', fromBlock: 25531000n, amount: '25' })}`);
await page.addStyleTag({ content: ZOOM });
await page.waitForTimeout(2500);
await shot('pay-page', '#pay-lede', 'start', -30);
await shot('pay-instructions', '#plain-pay', 'start', -120);

// Homepage inspector: the same screen before and after one change
await page.goto(`${B}/doorstep/`);
await page.addStyleTag({ content: ZOOM });
await page.evaluate(() => document.querySelector('#inspect').scrollIntoView());
await page.waitForFunction(() => /0x/.test(document.querySelector('#i-addr').textContent), null, { timeout: 20000 });
await shot('inspector-a', '.result-box', 'center', 80);
await page.fill('input[name=beneficiary]', '0xb0b0000000000000000000000000000000000002');
await page.waitForTimeout(900);
await shot('inspector-b', '.result-box', 'center', 80);

// API reference page (as served by the API)
await page.goto(`${B}/docs`);
await page.addStyleTag({ content: 'html { zoom: 1.35; }' });
await shot('api-docs', null);

await b.close(); srv.close();
