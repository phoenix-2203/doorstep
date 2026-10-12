// Doorstep API admin:
//   node admin.mjs new-wallet            create the wallet that registers addresses (asks for a password)
//   node admin.mjs new-key <name>        create an API key and its webhook secret (shown once)
//   node admin.mjs list-keys
//   node admin.mjs revoke-key <name>
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encryptKeystore, askHidden } from '../keeper/keystore.mjs';

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* defaults */ }
const home = (p) => p?.replace(/^~(?=\/)/, os.homedir());
const DATA_DIR = home(process.env.DATA_DIR ?? new URL('./data', import.meta.url).pathname);
const KEYS_FILE = `${DATA_DIR}/keys.json`;
fs.mkdirSync(DATA_DIR, { recursive: true });
const keys = () => { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return []; } };
const saveKeys = (k) => { fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 1)); fs.chmodSync(KEYS_FILE, 0o600); };

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'new-wallet') {
  const file = home(process.env.REGISTER_KEYSTORE ?? '~/.foundry/keystores/doorstep-api');
  if (fs.existsSync(file)) { console.log(`${file} already exists; not overwriting.`); process.exit(1); }
  const pw = await askHidden('Password for the new registration wallet: ');
  const pw2 = await askHidden('Repeat it: ');
  if (!pw || pw !== pw2) { console.log('Passwords did not match.'); process.exit(1); }
  const pk = generatePrivateKey();
  const a = privateKeyToAccount(pk);
  fs.mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(encryptKeystore(pk, pw, a.address)));
  fs.chmodSync(file, 0o600);
  const pwFile = home(process.env.REGISTER_PASSWORD_FILE ?? '~/.doorstep-api-password');
  fs.writeFileSync(pwFile, pw);
  fs.chmodSync(pwFile, 0o600);
  console.log(`Created ${file}\nPassword saved to ${pwFile} (readable only by you)\nAddress: ${a.address}\nSend it about 0.05 USDC on Arc: each registration costs roughly 0.001.`);
} else if (cmd === 'new-key') {
  if (!arg || !/^[a-z0-9_-]{2,40}$/i.test(arg)) { console.log('Usage: node admin.mjs new-key <name>   (letters, numbers, - and _)'); process.exit(1); }
  const k = keys();
  if (k.some((x) => x.name === arg)) { console.log(`A key named ${arg} exists. Revoke it first or pick another name.`); process.exit(1); }
  const key = `dk_${crypto.randomBytes(24).toString('base64url')}`;
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
  k.push({ name: arg, keyHash: crypto.createHash('sha256').update(key).digest('hex'), webhookSecret, createdAt: new Date().toISOString() });
  saveKeys(k);
  console.log(`API key for ${arg} (shown once, store it safely):\n  ${key}\nWebhook signing secret:\n  ${webhookSecret}`);
} else if (cmd === 'list-keys') {
  for (const x of keys()) console.log(`${x.name}\tcreated ${x.createdAt}${x.revoked ? '\tREVOKED' : ''}`);
} else if (cmd === 'revoke-key') {
  const k = keys();
  const x = k.find((y) => y.name === arg);
  if (!x) { console.log(`No key named ${arg}`); process.exit(1); }
  x.revoked = new Date().toISOString();
  saveKeys(k);
  console.log(`Revoked ${arg}.`);
} else {
  console.log('Commands: new-wallet | new-key <name> | list-keys | revoke-key <name>');
}
