// Landing page: header menu, the payment route, the instruction inspector (real SDK maths),
// code tabs, and live activity read from Arc mainnet. Nothing here signs or sends anything.
import { CONFIG, SITE } from './config.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const onceVisible = (el, fn, rootMargin = '400px') => {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin });
  io.observe(el);
};

// ---------------------------------------------------------------- links that depend on the deployment
for (const a of document.querySelectorAll('#api-docs, .api-link')) a.href = `${SITE.api}/docs`;
for (const el of document.querySelectorAll('[data-api]')) el.textContent = SITE.api;

// ---------------------------------------------------------------- header: border once scrolled, mobile menu
const header = document.querySelector('.site-header');
const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
const menuBtn = $('menu-btn');
const nav = $('site-nav');
const setMenu = (open) => {
  nav.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? 'Close' : 'Menu';
};
menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setMenu(false); menuBtn.focus(); } });

// ---------------------------------------------------------------- the payment route
const track = $('track');
const token = $('token');
const route = $('route');
const chip = $('door-chip');
const nodes = { send: $('n-send'), door: $('n-door'), vault: $('n-vault'), refund: $('n-refund') };
const rails = { r1: $('r1'), r2: $('r2'), r3: $('r3') };
const CHIP = {
  waiting: 'Waiting for payment', received: 'Payment received', delivering: 'Delivering',
  delivered: 'Delivered', returning: 'Returning', returned: 'Returned',
};
let mode = 'deliver';
let timers = [];
let moving = null;

function center(el) {
  const r = el.getBoundingClientRect();
  const o = route.getBoundingClientRect();
  return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 };
}
function placeToken(at) {
  const p = center(at);
  token.style.transform = `translate(${p.x - token.offsetWidth / 2}px, ${p.y - token.offsetHeight / 2}px)`;
}
function moveToken(from, to, ms) {
  const a = center(from), b = center(to);
  const w = token.offsetWidth / 2, h = token.offsetHeight / 2;
  moving?.cancel();
  token.style.opacity = '1';
  token.style.transform = `translate(${b.x - w}px, ${b.y - h}px)`;
  moving = token.animate(
    [{ transform: `translate(${a.x - w}px, ${a.y - h}px)` }, { transform: `translate(${b.x - w}px, ${b.y - h}px)` }],
    { duration: ms, easing: 'cubic-bezier(.45,0,.2,1)' },
  );
}
function setChip(s) { chip.dataset.s = s; chip.textContent = CHIP[s]; }
function caption(n, text) { $('cap-n').textContent = n; $('cap-t').textContent = text; }
function on(...names) { for (const [k, el] of Object.entries(nodes)) el.classList.toggle('on', names.includes(k)); }
function reset() {
  timers.forEach(clearTimeout);
  timers = [];
  moving?.cancel();
  token.style.opacity = '0';
  Object.values(rails).forEach((r) => r.classList.remove('lit'));
  $('vault-result').classList.remove('show');
  $('refund-result').classList.remove('show');
  on();
  setChip('waiting');
}

const SCRIPT = {
  deliver: [
    [0, () => { on('send'); placeToken(nodes.send); token.style.opacity = '1'; caption('Step 1 of 3', 'A wallet or exchange sends 25 USDC to the payer\'s Doorstep address. It\'s an ordinary transfer: no app to connect, no contract to call.'); }],
    [900, () => { rails.r1.classList.add('lit'); moveToken(nodes.send, nodes.door, 1000); }],
    [1900, () => { on('door'); setChip('received'); caption('Step 2 of 3', 'The USDC waits at the address. Its instructions say exactly where it may go: into the vault for Ada, or back to the refund wallet.'); }],
    [3600, () => { setChip('delivering'); rails.r2.classList.add('lit'); moveToken(nodes.door, nodes.vault, 1000); }],
    [4600, () => { on('vault'); setChip('delivered'); $('vault-result').classList.add('show'); token.style.opacity = '0'; caption('Step 3 of 3', 'A delivery bot calls deposit(amount, Ada) on the vault. Ada is credited 24.996 USDC; the 0.004 network fee came out of the payment. The address is empty again and can be paid again.'); }],
  ],
  refund: [
    [0, () => { on('send'); placeToken(nodes.send); token.style.opacity = '1'; caption('Step 1 of 3', 'A wallet or exchange sends 25 USDC to the payer\'s Doorstep address.'); }],
    [900, () => { rails.r1.classList.add('lit'); moveToken(nodes.send, nodes.door, 1000); }],
    [1900, () => { on('door'); setChip('received'); caption('Step 2 of 3', 'The USDC waits at the address. This time the vault refuses the deposit, or the deadline passes before it\'s delivered.'); }],
    [3600, () => { setChip('returning'); rails.r3.classList.add('lit'); moveToken(nodes.door, nodes.refund, 900); }],
    [4500, () => { on('refund'); setChip('returned'); $('refund-result').classList.add('show'); token.style.opacity = '0'; caption('Step 3 of 3', 'The money goes back to the refund wallet in the instructions, minus the network fee. Nothing is credited in the vault, and nobody else can receive it.'); }],
  ],
};
function finalState() {
  reset();
  if (mode === 'deliver') {
    rails.r1.classList.add('lit'); rails.r2.classList.add('lit'); on('vault'); setChip('delivered');
    $('vault-result').classList.add('show');
    caption('Delivered', 'Ada sent 25 USDC from an exchange. The vault was called with deposit(amount, Ada) and credited 24.996 USDC; the 0.004 network fee came out of the payment.');
  } else {
    rails.r1.classList.add('lit'); rails.r3.classList.add('lit'); on('refund'); setChip('returned');
    $('refund-result').classList.add('show');
    caption('Returned', 'The vault refused the deposit, or the deadline passed, so the payment went back to the refund wallet, minus the network fee.');
  }
}
function play() {
  reset();
  if (reduceMotion) return finalState();
  for (const [at, fn] of SCRIPT[mode]) timers.push(setTimeout(fn, at));
}
$('t-replay').addEventListener('click', play);
$('t-refund').addEventListener('click', (e) => {
  mode = mode === 'deliver' ? 'refund' : 'deliver';
  e.currentTarget.setAttribute('aria-pressed', String(mode === 'refund'));
  e.currentTarget.textContent = mode === 'refund' ? 'Show a delivery' : 'Show a refund';
  track.dataset.mode = mode;
  play();
});
for (const [k, el] of Object.entries(nodes)) {
  el.addEventListener('click', () => {
    timers.forEach(clearTimeout);
    timers = [];
    on(k);
    caption(el.querySelector('.t').textContent, el.dataset.explain);
  });
}
// The layout changes between desktop and phone widths; a token mid-flight would point at old positions.
addEventListener('resize', () => { moving?.cancel(); token.style.opacity = '0'; });
onceVisible(track, play, '0px');

// ---------------------------------------------------------------- instruction inspector (real SDK maths)
const form = $('inspector');
let sdk = null;
let lastAddr = '';
function field(name) { return form.elements[name]; }
function showChanged(id, value) {
  const dd = $(id);
  if (dd.textContent === value) return;
  dd.textContent = value;
  if (!reduceMotion && lastAddr) { dd.classList.add('changed'); setTimeout(() => dd.classList.remove('changed'), 700); }
}
function inspect() {
  if (!sdk) return;
  const v = Object.fromEntries(['beneficiary', 'refundTo', 'minimum', 'fee', 'expiry', 'reference'].map((k) => [k, field(k).value.trim()]));
  for (const k of ['beneficiary', 'refundTo']) field(k).removeAttribute('aria-invalid');
  const expiry = Math.floor(Date.parse(`${v.expiry}T00:00:00Z`) / 1000);
  showChanged('f-beneficiary', v.beneficiary);
  showChanged('f-refundTo', v.refundTo);
  showChanged('f-minimum', `${v.minimum || '0'} USDC`);
  showChanged('f-fee', `${v.fee || '0'} USDC`);
  showChanged('f-expiry', `${new Date(expiry * 1000).toISOString().slice(0, 10)} (${expiry})`);
  showChanged('f-reference', v.reference ? `"${v.reference}"` : '(none)');
  try {
    const intent = sdk.depositIntent({
      into: CONFIG.escrow, beneficiary: v.beneficiary, refundTo: v.refundTo,
      minimum: v.minimum || '0', keeperFeeCap: v.fee || '0', expires: expiry, reference: v.reference,
    });
    sdk.validateIntent(intent, CONFIG.doorstep);
    const addr = sdk.depositAddress(intent, CONFIG.doorstep);
    $('i-err').textContent = '';
    $('i-hash').textContent = `instruction hash ${sdk.intentHash(intent)}`;
    if (addr !== lastAddr) {
      $('i-addr').textContent = addr;
      if (lastAddr && !reduceMotion) { $('i-addr').classList.add('flash'); setTimeout(() => $('i-addr').classList.remove('flash'), 700); }
      lastAddr = addr;
    }
    const names = { [sdk.getAddressChecked(CONFIG.escrow)]: 'the demo savings vault' };
    $('i-plain').textContent = sdk.describe(intent, { names });
    $('i-state').className = 'chip ok';
    $('i-state').textContent = 'Address computed';
  } catch (e) {
    let msg = e.shortMessage ?? e.message ?? String(e);
    if (/must be an address/.test(msg) && /[A-F]/.test(v.beneficiary + v.refundTo)) msg += ' (an address in mixed case must have a valid checksum)';
    if (/beneficiary/i.test(msg)) field('beneficiary').setAttribute('aria-invalid', 'true');
    if (/refundTo/i.test(msg)) field('refundTo').setAttribute('aria-invalid', 'true');
    $('i-err').textContent = `${msg.replace(/^./, (c) => c.toUpperCase())}. Fix it to see the address.`;
    $('i-addr').textContent = 'No address for these instructions';
    $('i-hash').textContent = '';
    $('i-plain').textContent = '…';
    $('i-state').className = 'chip back';
    $('i-state').textContent = 'Check the fields';
    lastAddr = '';
  }
}
form.addEventListener('input', inspect);
form.addEventListener('submit', (e) => e.preventDefault());
onceVisible(form, async () => {
  try {
    const m = await import('../sdk/src/index.js');
    const { getAddress } = await import('viem');
    sdk = { ...m, getAddressChecked: getAddress };
    inspect();
  } catch {
    $('i-state').className = 'chip back';
    $('i-state').textContent = 'Could not load the SDK';
    $('i-addr').textContent = 'Reload the page to try again';
  }
}, '800px');

// ---------------------------------------------------------------- code tabs + copy
const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
function select(tab) {
  for (const t of tabs) {
    const yes = t === tab;
    t.setAttribute('aria-selected', String(yes));
    t.tabIndex = yes ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !yes;
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
$('copy').addEventListener('click', async () => {
  const panel = document.querySelector('.code pre:not([hidden])');
  try {
    await navigator.clipboard.writeText(panel.textContent);
    $('copy-note').textContent = 'Copied to your clipboard.';
  } catch {
    $('copy-note').textContent = 'Copy is blocked here. Select the code instead.';
  }
  setTimeout(() => { $('copy-note').textContent = ''; }, 2200);
});

// ---------------------------------------------------------------- live activity from Arc mainnet
const LANDED = '0xaaa662bc83b4ce53862bd86b32c32dda6a78f91eaa2d8dff3dc1465eb70f81e8';
const BOUNCED = '0x7402dfc2169f36edbc913e11489c478366d5a50c4669d23657fc3832ae21554a';
const RANGE = 9000;      // the public RPC's largest log search
const MAX_CHUNKS = 8;    // look back at most this far
const WANT = 6;
const PAUSE = 1100;      // the public RPC allows about one request a second per visitor

let rpcId = 0;
async function rpc(method, params, tries = 3) {
  for (let i = 0; ; i++) {
    let body = null, status = 0;
    try {
      const res = await fetch(CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      });
      status = res.status;
      body = res.ok ? await res.json() : null;
    } catch { /* network error: retry */ }
    if (body && !body.error) return body.result;
    if (i + 1 >= tries) throw new Error(body?.error?.message ?? `HTTP ${status}`);
    await sleep(PAUSE * (i + 2));
  }
}
const hex = (n) => '0x' + n.toString(16);
const word = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
function usdc(units, decimals) {
  const v = Number(units) / 10 ** decimals;
  return v >= 1 ? String(Number(v.toFixed(3))) : String(Number(v.toPrecision(3)));
}
function refText(topic) {
  const bytes = topic.slice(2).match(/../g).map((b) => parseInt(b, 16)).filter((b) => b !== 0);
  const s = String.fromCharCode(...bytes);
  return /^[\x20-\x7e]{1,31}$/.test(s) ? s : '';
}
function target(addr) { return addr.toLowerCase() === CONFIG.escrow.toLowerCase() ? 'the demo savings vault' : short(addr); }
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
    const to = target('0x' + log.topics[3].slice(26));
    return { kind: 'ok', state: 'Delivered', amount: usdc(word(log.data, 1), 6), what: ref === 'doorstep-savings' ? `Live demo savings, into ${to}` : `${ref ? ref + ', ' : ''}into ${to}`, log };
  }
  const reason = Number(word(log.data, 1));
  const back = word(log.data, 2);
  const why = ['Deadline passed', 'Contract refused it', 'Cancelled by the refund wallet'][reason] ?? 'Returned';
  return { kind: 'back', state: 'Returned', amount: usdc(back, 18), what: `${why}${ref ? `, ${ref}` : ''}`, log };
}
function render(items) {
  $('feed').replaceChildren(...items.map((it) => {
    const li = document.createElement('li');
    const st = document.createElement('span');
    st.className = `chip ${it.kind}`;
    st.textContent = it.state;
    const body = document.createElement('span');
    const amt = document.createElement('span');
    amt.className = 'amt';
    amt.textContent = `${it.amount} USDC`;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = it.what;
    body.append(amt, what);
    const a = document.createElement('a');
    a.href = `${CONFIG.explorer}/tx/${it.log.transactionHash}`;
    a.textContent = it.when ?? 'Explorer';
    a.setAttribute('aria-label', `View this transaction on the Arc explorer${it.when ? `, ${it.when}` : ''}`);
    li.append(st, body, a);
    return li;
  }));
}
function message(text) {
  const li = document.createElement('li');
  li.className = 'msg';
  li.append(text, ' ');
  const a = document.createElement('a');
  a.href = `${SITE.repo}#mainnet-proof`;
  a.textContent = 'See the recorded mainnet transactions.';
  li.append(a);
  $('feed').replaceChildren(li);
}
let loading = false;
async function loadFeed() {
  if (loading) return;
  loading = true;
  $('feed-refresh').disabled = true;
  $('feed-when').textContent = 'Reading Arc mainnet…';
  try {
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
    const checked = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const searched = head - to;
    $('feed-when').textContent = `Checked at ${checked}, ${searched.toLocaleString()} recent blocks`;
    const items = found.slice(0, WANT).map(parse);
    if (!items.length) { message('No payments in the blocks searched.'); return; }
    render(items);
    const now = Date.now() / 1000;
    try {
      for (const it of items) {
        await sleep(PAUSE);
        const block = await rpc('eth_getBlockByNumber', [it.log.blockNumber, false]);
        it.when = ago(now - Number(block.timestamp));
        render(items);
      }
    } catch { /* times are a nicety; the links are already there */ }
  } catch {
    $('feed-when').textContent = 'Arc mainnet could not be reached';
    message('The public Arc RPC didn\'t answer just now. Try again in a minute.');
  } finally {
    loading = false;
    $('feed-refresh').disabled = false;
  }
}
$('feed-refresh').addEventListener('click', loadFeed);
onceVisible($('feed'), loadFeed, '600px');
