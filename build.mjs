import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const pages = process.argv.includes('--pages');
const out = pages ? 'dist' : 'public';
await mkdir(out, { recursive: true });
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
await build({ entryPoints: ['src/app.mjs'], bundle: true, minify: true, sourcemap: false, outfile: `${out}/app.js`, target: ['es2022'], legalComments: 'external', define: { __STATIC_APP__: String(pages) } });
const packages = ['unified', 'remark-parse', 'remark-gfm', 'remark-frontmatter', 'remark-math', 'marked', 'dompurify'];
const licenses = [];
for (const name of packages) {
  const metadata = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  let license = '';
  for (const filename of ['license', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(`node_modules/${name}/${filename}`, 'utf8'); break; } catch {}
  }
  licenses.push(`${name} ${metadata.version} (${metadata.license})\n${license}`);
}
licenses.push(await readFile(`${out}/app.js.LEGAL.txt`, 'utf8').catch(() => ''));
await writeFile(`${out}/licenses.txt`, licenses.join('\n\n--------------------\n\n'));
if (pages) {
  // Pages caches assets. Version references so a refreshed HTML document cannot run an older script.
  let html = await readFile(`${out}/index.html`, 'utf8');
  for (const file of ['app.js', 'style.css', 'theme.js']) {
    const version = createHash('sha256').update(await readFile(`${out}/${file}`)).digest('hex').slice(0, 16);
    html = html.replace(`"./${file}"`, `"./${file}?v=${version}"`);
  }
  await writeFile(`${out}/index.html`, html);
}
