// Builds web/dist with a content-hashed bundle name, so a browser can never mix a new page with
// an old cached script (GitHub Pages lets browsers cache files for about 10 minutes).
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
const result = await build({
  entryPoints: ['app.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  alias: { viem: './node_modules/viem' },
  entryNames: '[name]-[hash]',
  outdir: 'dist',
  metafile: true,
});
const out = Object.keys(result.metafile.outputs).find((f) => f.endsWith('.js'));
const name = out.split('/').pop();
const html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('src="./app.js"')) throw new Error('index.html must load ./app.js');
fs.writeFileSync('dist/index.html', html.replace('src="./app.js"', `src="./${name}"`));
console.log(`dist/index.html -> ${name} (${(fs.statSync(out).size / 1024).toFixed(0)} kB)`);
