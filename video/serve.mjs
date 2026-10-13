import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = '/home/claude/doorstep/web/dist';
const T = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', html: 'text/html' };
export const serve = (port) => http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\/doorstep/, '');
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': T[f.split('.').pop()] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port);
export const L = '0xaaa662bc83b4ce53862bd86b32c32dda6a78f91eaa2d8dff3dc1465eb70f81e8', B = '0x7402dfc2169f36edbc913e11489c478366d5a50c4669d23657fc3832ae21554a';
const pad = (h) => h.replace(/^0x/, '').padStart(64, '0');
const ref = (s) => '0x' + Buffer.from(s).toString('hex').padEnd(64, '0');
const esc = '0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3';
export const logs = [
  { topics: [L, '0x' + '1'.repeat(64), ref('doorstep-savings'), '0x' + pad(esc)], data: '0x' + pad('0x1234') + pad((50000).toString(16)) + pad('0') + pad('0'), blockNumber: '0x1859000', transactionHash: '0x' + 'a'.repeat(64) },
  { topics: [L, '0x' + '2'.repeat(64), ref('inv-1042'), '0x' + pad(esc)], data: '0x' + pad('0x1234') + pad((24996000).toString(16)) + pad('0') + pad('0'), blockNumber: '0x1859100', transactionHash: '0x' + 'b'.repeat(64) },
  { topics: [B, '0x' + '3'.repeat(64), ref('doorstep-cancel-demo'), '0x' + pad(esc)], data: '0x' + pad('0x1234') + pad('2') + pad((2n * 10n ** 16n).toString(16)) + pad('0') + pad('100') + pad('0'), blockNumber: '0x1859200', transactionHash: '0x' + 'c'.repeat(64) },
];
export async function mockRpc(page, { fail = false } = {}) {
  await page.route('https://rpc.mainnet.arc.io/**', async (r) => {
    if (fail) return r.fulfill({ status: 503, body: 'down', headers: { 'access-control-allow-origin': '*' } });
    const b = JSON.parse(r.request().postData());
    const result = b.method === 'eth_blockNumber' ? '0x1859300' : b.method === 'eth_getLogs' ? (b.params[0].toBlock === '0x1859300' ? logs : []) : b.method === 'eth_getBlockByNumber' ? { timestamp: '0x' + Math.floor(Date.now() / 1000 - 600).toString(16) } : null;
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: b.id, result }) });
  });
}
