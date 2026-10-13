// Drives the live demo end to end against the simulator (no real money) and saves screenshots.
//   node test/demo-flow.mjs [outDir]
import { chromium } from '/opt/node-tools/node_modules/playwright-core/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { depositIntent, depositAddress, intentHash } from '../../sdk/src/index.js';
import { CONFIG } from '../config.js';
import { createSim } from './sim.mjs';

const out = process.argv[2] ?? 'test-shots';
fs.mkdirSync(out, { recursive: true });
const root = new URL('../dist', import.meta.url).pathname;
const T = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', html: 'text/html' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\/doorstep/, '');
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': T[f.split('.').pop()] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8620);

const owner = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const intent = depositIntent({ into: CONFIG.escrow, beneficiary: owner, refundTo: owner, minimum: '0.01', keeperFeeCap: '0.01', expires: new Date('2027-12-31T23:59:59Z'), reference: 'doorstep-savings' });
const sim = createSim({ owner, depositAddress: depositAddress(intent, CONFIG.doorstep), intentHash: intentHash(intent) });

const width = Number(process.env.W ?? 1280);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await sim.install(page);
const shot = async (n) => page.screenshot({ path: `${out}/${width}-${n}.png`, fullPage: true });
const text = (id) => page.locator('#' + id).innerText();
const step = (msg) => console.log('•', msg);

await page.goto('http://localhost:8620/doorstep/app/');
await page.waitForTimeout(800);
await shot('0-start');
await page.click('#cmp-without'); await page.waitForTimeout(200); await shot('1-without');
await page.click('#cmp-with');

await page.click('#btn-connect');
await page.waitForFunction(() => !document.querySelector('#btn-create').disabled, null, { timeout: 15000 });
step('connected; ' + await text('s2-msg'));
await page.click('#btn-create');
await page.waitForTimeout(3000); console.log('s2 after click:', await text('s2-msg'), errors);
await page.waitForFunction(() => !document.querySelector('#btn-home-pay').disabled, null, { timeout: 15000 });
step('registered; ' + await text('s2-msg'));
await page.click('summary:has-text("What is this address?")');
await shot('2-ready');

await page.click('.chip-btn[data-amt="0.25"]');
step('button: ' + await text('btn-home-pay'));
await page.click('#btn-home-pay');
await page.waitForTimeout(1500);
step('after send: ' + await text('s3-msg') + ' | ' + await text('s4-status'));
await shot('3-sent');
await page.waitForFunction(() => /Delivered/.test(document.querySelector('#home-light').textContent), null, { timeout: 25000 });
await page.waitForTimeout(500);
step('delivered: ' + await text('s4-status') + ' | balance ' + await text('home-balance') + ' | toast: ' + await text('toast') + ' | tracker: ' + await page.evaluate(() => [...document.querySelectorAll('#tracker li')].map((l) => l.className).join(',')));
await page.click('#home-activity summary');
await shot('4-delivered');

await page.fill('#home-amount', '0.005');
step('hint: ' + await text('amount-hint'));
await page.click('#btn-home-pay');
await page.waitForFunction(() => !document.querySelector('#btn-home-cancel').hidden, null, { timeout: 20000 });
step('waiting: ' + await text('s4-status'));
await shot('5-below-min');
await page.click('#btn-home-cancel');
await page.waitForFunction(() => /back in your wallet/.test(document.querySelector('#s4-msg').textContent), null, { timeout: 20000 });
step('cancelled: ' + await text('s4-msg'));

await page.fill('#home-wd-amount', '0.1');
await page.click('#btn-home-withdraw');
await page.waitForFunction(() => /Done/.test(document.querySelector('#s5-msg').textContent), null, { timeout: 20000 });
await page.waitForTimeout(9000);
step('withdrew: ' + await text('s5-msg') + ' | balance ' + await text('home-balance'));
await shot('6-end');
console.log('sim state', { wallet: sim.state.wallet, waiting: sim.state.waiting, vault: sim.state.vault });
console.log('page errors', errors);
await b.close(); srv.close();
