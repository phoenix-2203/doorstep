// Builds web/dist with content-hashed bundle names, so a browser can never mix a new page with
// an old cached script (GitHub Pages lets browsers cache files for about 10 minutes).
//
//   dist/index.html       the landing page   (landing.js)
//   dist/app/index.html   the app            (app.js)
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
const result = await build({
  entryPoints: ['app.js', 'landing.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  alias: { viem: './node_modules/viem' },
  entryNames: '[name]-[hash]',
  outdir: 'dist/assets',
  metafile: true,
});
const outputs = Object.keys(result.metafile.outputs).filter((f) => f.endsWith('.js'));
const bundle = (entry) => {
  const out = outputs.find((f) => result.metafile.outputs[f].entryPoint === entry);
  if (!out) throw new Error(`no bundle for ${entry}`);
  return { file: out.split('/').pop(), kb: (fs.statSync(out).size / 1024).toFixed(0) };
};

for (const [page, entry, prefix] of [
  ['index.html', 'landing.js', './assets/'],
  ['app/index.html', 'app.js', '../assets/'],
]) {
  const html = fs.readFileSync(page, 'utf8');
  const tag = `src="./${entry}"`;
  if (!html.includes(tag)) throw new Error(`${page} must load ./${entry}`);
  const { file, kb } = bundle(entry);
  fs.mkdirSync(`dist/${page}`.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(`dist/${page}`, html.replace(tag, `src="${prefix}${file}"`));
  console.log(`dist/${page} -> ${file} (${kb} kB)`);
}
