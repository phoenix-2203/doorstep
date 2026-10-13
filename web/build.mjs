// Builds web/dist with content-hashed bundle names, so a browser can never mix a new page with
// an old cached script (GitHub Pages lets browsers cache files for about 10 minutes).
//
//   dist/index.html       the landing page   (landing.js)
//   dist/app/index.html   the app            (app.js)
//   dist/assets/          hashed bundles and shared chunks
//   dist/brand/           logo files, brand.css (loaded with ?v=<hash>) and self-hosted fonts
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
const result = await build({
  entryPoints: ['app.js', 'landing.js'],
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  alias: { viem: './node_modules/viem' },
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  outdir: 'dist/assets',
  metafile: true,
});
const outputs = Object.keys(result.metafile.outputs).filter((f) => f.endsWith('.js'));
const bundle = (entry) => {
  const out = outputs.find((f) => result.metafile.outputs[f].entryPoint === entry);
  if (!out) throw new Error(`no bundle for ${entry}`);
  return { file: out.split('/').pop(), kb: (fs.statSync(out).size / 1024).toFixed(0) };
};

// Brand files and fonts.
fs.mkdirSync('dist/brand/fonts', { recursive: true });
for (const f of fs.readdirSync('brand')) {
  if (/\.(svg|png|css|js)$/.test(f)) fs.copyFileSync(`brand/${f}`, `dist/brand/${f}`);
}
for (const f of [
  'node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
  'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
]) fs.copyFileSync(f, `dist/brand/fonts/${f.split('/').pop()}`);
const themeHash = crypto.createHash('sha256').update(fs.readFileSync('brand/theme.js')).digest('hex').slice(0, 8);
const cssHash = crypto.createHash('sha256').update(fs.readFileSync('brand/brand.css')).digest('hex').slice(0, 8);

for (const [page, entry, prefix] of [
  ['index.html', 'landing.js', './assets/'],
  ['app/index.html', 'app.js', '../assets/'],
]) {
  let html = fs.readFileSync(page, 'utf8');
  const tag = `src="./${entry}"`;
  if (!html.includes(tag)) throw new Error(`${page} must load ./${entry}`);
  if (!html.includes('brand/brand.css"')) throw new Error(`${page} must link brand/brand.css`);
  const { file, kb } = bundle(entry);
  html = html.replace(tag, `src="${prefix}${file}"`).replace('brand/brand.css"', `brand/brand.css?v=${cssHash}"`).replace('brand/theme.js"', `brand/theme.js?v=${themeHash}"`);
  fs.mkdirSync(`dist/${page}`.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(`dist/${page}`, html);
  console.log(`dist/${page} -> ${file} (${kb} kB)`);
}
for (const f of outputs.filter((f) => f.includes('/chunk-'))) console.log(`shared chunk ${f.split('/').pop()} (${(fs.statSync(f).size / 1024).toFixed(0)} kB)`);
