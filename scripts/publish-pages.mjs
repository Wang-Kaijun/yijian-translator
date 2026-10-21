// Publish only the static build, without requiring the GitHub workflow OAuth scope.
import { execFileSync } from 'node:child_process';
import { mkdtemp, copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = (args, cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const root = process.cwd();
const remote = run(['remote', 'get-url', 'origin']);
const allowed = new Set(['index.html', 'app.js', 'app.js.LEGAL.txt', 'theme.js', 'style.css', 'favicon.svg', 'licenses.txt', '.nojekyll', 'paw-bridge.py']);
const files = await readdir(resolve(root, 'dist'));
if (files.some(name => !allowed.has(name)) || !files.includes('index.html') || !files.includes('app.js')) throw new Error('Unexpected or missing build files. Rebuild a clean dist directory before publishing.');
if (!(await readFile('dist/index.html', 'utf8')).includes('GitHub Pages · 浏览器直连')) throw new Error('Run npm run build:pages before publishing.');
const temp = await mkdtemp(join(tmpdir(), 'yijian-pages-'));
try {
  run(['init', '-b', 'gh-pages'], temp);
  run(['remote', 'add', 'origin', remote], temp);
  if (run(['ls-remote', '--heads', 'origin', 'gh-pages'], temp)) {
    run(['fetch', '--depth=1', 'origin', 'gh-pages'], temp);
    run(['checkout', '-B', 'gh-pages', 'FETCH_HEAD'], temp);
    if (run(['ls-files'], temp).split('\n').some(name => !allowed.has(name))) throw new Error('Publishing branch contains unexpected files; review it before continuing.');
    run(['rm', '-r', '--ignore-unmatch', '.'], temp);
  }
  for (const name of files) await copyFile(resolve(root, 'dist', name), join(temp, name));
  run(['add', '--all'], temp);
  const revision = run(['rev-parse', '--short', 'HEAD']);
  if (run(['diff', '--cached', '--name-only'], temp)) {
    run(['-c', `user.name=${run(['config', 'user.name'])}`, '-c', `user.email=${run(['config', 'user.email'])}`, 'commit', '-m', `Publish static app from ${revision}`], temp);
    // Fast-forward only. Concurrent publication is rejected instead of overwritten.
    run(['push', 'origin', 'gh-pages'], temp);
  }
  console.log('Static files published to gh-pages.');
} finally { await rm(temp, { recursive: true, force: true }); }
