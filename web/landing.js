// Landing page: the hero scene, the code tabs, and the live deliveries feed read from Arc mainnet.
// No wallet and no libraries: plain JSON-RPC calls to Arc's public endpoint.
import { CONFIG, SITE } from './config.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- links that depend on the deployment
for (const a of document.querySelectorAll('#api-docs, .api-link')) a.href = `${SITE.api}/docs`;
for (const el of document.querySelectorAll('[data-api]')) el.textContent = SITE.api;

// ---------------------------------------------------------------- sticky nav border once scrolled
const nav = document.querySelector('header.nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------------------------------------------------------------- hero: a payment arrives and goes inside
const scene = $('scene');
const stateText = $('scene-state');
const STEPS = [
  [0, 'Waiting for payment'],
  [700, 'Waiting for payment'],
  [2100, 'Payment arrived'],
  [3900, 'Delivered'],
];
let timers = [];
function play() {
  timers.forEach(clearTimeout);
  timers = [];
  if (reduceMotion) {
    scene.dataset.step = '3';
    stateText.textContent = 'Delivered';
    return;
  }
  STEPS.forEach(([at, text], i) => {
    timers.push(setTimeout(() => { scene.dataset.step = String(i); stateText.textContent = text; }, at));
  });
}
$('replay').addEventListener('click', play);
// Start when the scene is on screen (it is, on most first loads).
new IntersectionObserver((entries, obs) => {
  if (entries.some((e) => e.isIntersecting)) { play(); obs.disconnect(); }
}, { threshold: 0.4 }).observe(scene);

// ---------------------------------------------------------------- code tabs + copy
const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
function select(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = tabs[(i + d + tabs.length) % tabs.length];
    select(next);
    next.focus();
  });
});
select(tabs[0]);
$('copy').addEventListener('click', async () => {
  const panel = document.querySelector('.code pre:not([hidden])');
  try {
    await navigator.clipboard.writeText(panel.textContent);
    $('copy').textContent = 'Copied';
  } catch {
    $('copy').textContent = 'Select the text to copy';
  }
  setTimeout(() => { $('copy').textContent = 'Copy'; }, 1800);
});

// ---------------------------------------------------------------- live deliveries from Arc mainnet
const LANDED = '0xaaa662bc83b4ce53862bd86b32c32dda6a78f91eaa2d8dff3dc1465eb70f81e8';
const BOUNCED = '0x7402dfc2169f36edbc913e11489c478366d5a50c4669d23657fc3832ae21554a';
const RANGE = 9000;      // the public RPC's largest log search
const MAX_CHUNKS = 8;    // look back at most this far before giving up
const WANT = 6;
const PAUSE = 1100;      // the public RPC allows about one request a second per visitor
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rpcId = 0;
async function rpc(method, params, tries = 3) {
  for (let i = 0; ; i++) {
    const res = await fetch(CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const body = res.ok ? await res.json() : null;
    if (body && !body.error) return body.result;
    if (i + 1 >= tries) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    await sleep(PAUSE * (i + 2)); // rate limited: wait and try again
  }
}

const hex = (n) => '0x' + n.toString(16);
const word = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
function usdc(units, decimals) {
  const v = Number(units) / 10 ** decimals;
  return v >= 1 ? String(Number(v.toFixed(3))) : String(Number(v.toPrecision(3)));
}
function refText(topic) {
  const bytes = topic.slice(2).match(/../g).map((b) => parseInt(b, 16)).filter((b) => b !== 0);
  const s = String.fromCharCode(...bytes);
  return /^[\x20-\x7e]{1,31}$/.test(s) ? s : '';
}
function label(ref, target) {
  if (ref === 'doorstep-savings') return 'Savings demo on this site';
  const where = target.toLowerCase() === CONFIG.escrow.toLowerCase() ? 'the demo savings vault' : short(target);
  return ref ? `${ref}, into ${where}` : `Into ${where}`;
}
function ago(seconds) {
  if (seconds < 90) return 'just now';
  const m = Math.round(seconds / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function parse(log) {
  const ref = refText(log.topics[2]);
  if (log.topics[0] === LANDED) {
    const target = '0x' + log.topics[3].slice(26);
    return { kind: 'landed', amount: usdc(word(log.data, 1), 6), what: label(ref, target), log };
  }
  const reason = Number(word(log.data, 1));
  const back = word(log.data, 2) + word(log.data, 3);
  const why = ['Returned after its deadline', 'Returned: the contract refused it', 'Taken back by the payer'][reason] ?? 'Returned';
  return { kind: 'back', amount: usdc(back, 18), what: ref ? `${why} (${ref})` : why, log };
}

function render(items) {
  const feed = $('feed');
  feed.replaceChildren(...items.map((it) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = it.kind === 'back' ? 'dot back' : 'dot';
    dot.title = it.kind === 'back' ? 'Returned' : 'Delivered';
    const body = document.createElement('span');
    const amt = document.createElement('span');
    amt.className = 'amt';
    amt.textContent = `${it.amount} USDC`;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = ` ${it.what}`;
    body.append(amt, what);
    const link = document.createElement('a');
    link.href = `${CONFIG.explorer}/tx/${it.log.transactionHash}`;
    link.textContent = it.when ?? 'View';
    link.setAttribute('aria-label', `View transaction on the Arc explorer${it.when ? `, ${it.when}` : ''}`);
    li.append(dot, body, link);
    return li;
  }));
}

function message(text, withLink) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.className = 'empty';
  span.textContent = text;
  if (withLink) {
    const a = document.createElement('a');
    a.href = `${SITE.repo}#mainnet-proof`;
    a.textContent = 'See every recorded mainnet transaction';
    span.append(' ', a, '.');
  }
  li.append(span);
  $('feed').replaceChildren(li);
}

async function loadFeed() {
  const head = BigInt(await rpc('eth_blockNumber', []));
  const floor = BigInt(CONFIG.deployBlock);
  const found = [];
  let to = head;
  for (let i = 0; i < MAX_CHUNKS && to >= floor && found.length < WANT; i++) {
    const from = to - BigInt(RANGE - 1) > floor ? to - BigInt(RANGE - 1) : floor;
    await sleep(PAUSE);
    const logs = await rpc('eth_getLogs', [{ address: CONFIG.doorstep, fromBlock: hex(from), toBlock: hex(to), topics: [[LANDED, BOUNCED]] }]);
    found.push(...logs.reverse());
    to = from - 1n;
  }
  const items = found.slice(0, WANT).map(parse);
  if (!items.length) {
    message('No payments in the last few hours.', true);
    return;
  }
  render(items);
  // Add times, newest first, one block lookup at a time.
  const now = Date.now() / 1000;
  try {
    for (const it of items) {
      await sleep(PAUSE);
      const block = await rpc('eth_getBlockByNumber', [it.log.blockNumber, false]);
      it.when = ago(now - Number(block.timestamp));
      render(items);
    }
  } catch {
    // Times are a nicety; the deliveries are already on screen with their links.
  }
}

// Read the chain only when the section is close to the screen.
new IntersectionObserver((entries, obs) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  obs.disconnect();
  loadFeed().catch(() => message('Arc mainnet could not be reached just now.', true));
}, { rootMargin: '600px' }).observe($('feed'));
