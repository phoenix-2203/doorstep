// Read Foundry keystores (Web3 Secret Storage v3, as written by `cast wallet import`) without extra dependencies.
import crypto from 'node:crypto';
import readline from 'node:readline';
import { keccak256, concat, bytesToHex } from 'viem';

export function decryptKeystore(json, password) {
  const ks = typeof json === 'string' ? JSON.parse(json) : json;
  const c = ks.crypto ?? ks.Crypto;
  if (!c || c.cipher !== 'aes-128-ctr') throw new Error('unsupported keystore cipher');
  const salt = Buffer.from(c.kdfparams.salt, 'hex');
  let key;
  if (c.kdf === 'scrypt') {
    const { n, r, p, dklen } = c.kdfparams;
    key = crypto.scryptSync(Buffer.from(password.normalize('NFKC')), salt, dklen, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  } else if (c.kdf === 'pbkdf2') {
    const { c: iter, dklen, prf } = c.kdfparams;
    if (prf !== 'hmac-sha256') throw new Error('unsupported pbkdf2 prf');
    key = crypto.pbkdf2Sync(Buffer.from(password.normalize('NFKC')), salt, iter, dklen, 'sha256');
  } else {
    throw new Error(`unsupported kdf ${c.kdf}`);
  }
  const ct = Buffer.from(c.ciphertext, 'hex');
  const mac = keccak256(concat([bytesToHex(key.subarray(16, 32)), bytesToHex(ct)])).slice(2);
  if (mac !== c.mac.toLowerCase()) throw new Error('wrong keystore password');
  const d = crypto.createDecipheriv('aes-128-ctr', key.subarray(0, 16), Buffer.from(c.cipherparams.iv, 'hex'));
  return '0x' + Buffer.concat([d.update(ct), d.final()]).toString('hex');
}

/** Write a new Web3 Secret Storage v3 keystore (same format as `cast wallet new`). */
export function encryptKeystore(privateKey, password, address) {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const n = 8192, r = 8, p = 1, dklen = 32;
  const key = crypto.scryptSync(Buffer.from(password.normalize('NFKC')), salt, dklen, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  const c = crypto.createCipheriv('aes-128-ctr', key.subarray(0, 16), iv);
  const ct = Buffer.concat([c.update(Buffer.from(privateKey.slice(2), 'hex')), c.final()]);
  const mac = keccak256(concat([bytesToHex(key.subarray(16, 32)), bytesToHex(ct)])).slice(2);
  return {
    address: address.slice(2).toLowerCase(),
    id: crypto.randomUUID(),
    version: 3,
    crypto: {
      cipher: 'aes-128-ctr', cipherparams: { iv: iv.toString('hex') }, ciphertext: ct.toString('hex'),
      kdf: 'scrypt', kdfparams: { dklen, n, p, r, salt: salt.toString('hex') }, mac,
    },
  };
}

export function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

