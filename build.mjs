import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { collectThirdPartyLicenses } from './scripts/third-party-licenses.mjs';
const pages = process.argv.includes('--pages');
const out = pages ? 'dist' : 'public';
await mkdir(out, { recursive: true });
await copyFile('scripts/paw-bridge.py', `${out}/paw-bridge.py`);
if (pages) {
  let html = await readFile('public/index.html', 'utf8');
  html = html.replace('<span id="hostingNote">在你的局域网中运行</span>', '<span id="hostingNote">GitHub Pages · 浏览器直连</span>')
    .replace('<option value="localai">LocalAI · 局域网默认</option>', '')
    .replace('翻译引擎 · LocalAI', '翻译引擎 · 魔搭 ModelScope')
    .replace('连接引擎中', '填写 API Key')
    .replace('仅待译文本经局域网发送至 LocalAI', '仅待译文本直接发送至所选模型服务商');
  await writeFile(`${out}/index.html`, html);
  for (const file of ['theme.js', 'style.css', 'favicon.svg']) await copyFile(`public/${file}`, `${out}/${file}`);
  await writeFile(`${out}/.nojekyll`, '');
}
const result = await build({
  entryPoints: ['src/app.mjs'], bundle: true, minify: true, sourcemap: false,
  outfile: `${out}/app.js`, target: ['es2022'], legalComments: 'external', metafile: true,
  define: { __STATIC_APP__: String(pages) },
  banner: { js: '/* Bundled and minified for 译间, including DOMPurify under Apache-2.0. Full third-party licenses and retained notices: ./licenses.txt */' },
});
const legalComments = await readFile(`${out}/app.js.LEGAL.txt`, 'utf8');
const projectNotices = await readFile('THIRD_PARTY_NOTICES.txt', 'utf8');
if (!legalComments.trim()) throw new Error('The bundled source legal notices are empty.');
if (!projectNotices.trim()) throw new Error('THIRD_PARTY_NOTICES.txt must retain the adapted material notices.');
const licenses = await collectThirdPartyLicenses({
  metafile: result.metafile,
  legalComments,
  projectNotices,
});
await writeFile(`${out}/licenses.txt`, licenses.text);
if (pages) {
  // Pages caches assets. Version references so a refreshed HTML document cannot run an older script.
  let html = await readFile(`${out}/index.html`, 'utf8');
  for (const file of ['app.js', 'style.css', 'theme.js', 'licenses.txt']) {
    const version = createHash('sha256').update(await readFile(`${out}/${file}`)).digest('hex').slice(0, 16);
    html = html.replace(`"./${file}"`, `"./${file}?v=${version}"`);
  }
  await writeFile(`${out}/index.html`, html);
}
