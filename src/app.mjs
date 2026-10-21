import { isLocalProvider } from '../providers.mjs';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { createPlan, acceptTranslations, renderPlan, pendingBatches, previewSource, detectDirection } from './translation.mjs';
import { setupModelSettings } from './model-settings.mjs';
import { setupDeclaudish } from './declaudish-ui.mjs';
import { createProfiles } from './profiles.mjs';
import { setupWriting } from './writing-ui.mjs';
import { translateWithProvider } from './api.mjs';

const $ = id => document.getElementById(id);
let mode = 'text', view = 'preview', filename = '', plan = null, planKey = '', output = '', busy = false, complete = false;
let controller = null, startedAt = 0, toastTimer, previewTimer;
const staticApp = typeof __STATIC_APP__ !== 'undefined' && __STATIC_APP__;
let browserStorage; try { browserStorage = localStorage; } catch {}
const appPath = new URL('.', location.href).pathname;
const profiles = createProfiles(browserStorage, appPath, staticApp ? 'modelscope' : 'localai');
let settingsUI, writingBusy = false, declaudishBusy = false, activeWorkspace = 'translation';
let providerConfig = profiles.effective('translation');
function activeModel() { return providerConfig.model; }
const MAX_BYTES = 2 * 1024 * 1024;
const sampleText = 'Good translation preserves more than words. It carries meaning, tone, and the details that matter.\n\nYour documents stay in your browser. Only the text to be translated is sent to your chosen model provider.';
const sampleMarkdown = '# A quieter way to translate\n\nGood translation preserves **meaning**, not just words. Keep your notes, your links, and your structure.\n\n## Getting started\n\n1. Open this workspace in your browser.\n2. Choose a Markdown document.\n3. Download the translated version.\n\n> Your file stays in your browser. Only text for translation is sent to your chosen model provider.\n\n| Feature | Status |\n| --- | --- |\n| Automatic language detection | Ready |\n| Markdown preview | Ready |\n\nUse `hello_world()` in your code. Read the [documentation](https://example.com/docs).\n\n```python\n# This code stays unchanged.\nprint("Hello, world!")\n```\n';
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
marked.use({ renderer: {
  image({ text }) { return `<span class="image-placeholder">图片 · ${escapeHtml(text || '原图地址保留在 Markdown 中')}</span>`; },
  html({ text }) { return `<span>${escapeHtml(text)}</span>`; },
} });

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 2600); }

function languageLabels() {
  const source = $('source').value;
  let direction = detectDirection(source);
  if (mode === 'markdown' && source.length < 180000) {
    try { direction = createPlan(source, mode).detected; } catch { /* Let translation surface parse errors. */ }
  }
  const choice = $('direction').value;
  const from = choice === 'auto' ? direction.source : choice === 'en-zh' ? 'en' : 'zh';
  const target = choice === 'auto' ? direction.target : choice === 'en-zh' ? 'zh' : 'en';
  $('sourceLanguage').textContent = !source.trim() ? '自动识别' : from === 'zh' ? '中文' : from === 'en' ? '英文' : '自动识别';
  $('targetLanguage').textContent = source.trim() ? (target === 'zh' ? '简体中文' : '英文') : '等待原文';
  $('characterCount').textContent = `${source.length.toLocaleString()} 字符`;
  $('translate').disabled = busy || !source.trim();
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
  for (const id of ['source', 'direction', 'chooseFile', 'textMode', 'markdownMode', 'clear', 'sample', 'fileInput', 'settings']) $(id).disabled = value;
  $('stop').hidden = !value;
  $('translateText').textContent = value ? '翻译中…' : plan && !complete && plan.completed.size ? '继续翻译' : '开始翻译';
  $('translate').disabled = value || !$('source').value.trim();
  $('copy').disabled = !(complete || plan?.completed.size) || value;
  $('download').disabled = !(complete || plan?.completed.size) || value;
  syncSettingsBusy();
}

function syncSettingsBusy() { settingsUI?.syncBusy(); }

function resetOutput() {
  plan = null; planKey = ''; output = ''; complete = false;
  $('result').value = ''; $('rendered').replaceChildren();
  $('emptyResult').hidden = false; $('result').hidden = true; $('rendered').hidden = true;
  $('copy').disabled = true; $('download').disabled = true;
  $('progressTrack').hidden = true; $('progressLabel').textContent = '';
  $('resultNote').textContent = '忠于原意，自然表达';
  $('translateText').textContent = '开始翻译';
  $('downloadText').textContent = mode === 'markdown' ? '下载 .md' : '下载';
}

function updateOutput() {
  if (!plan) return;
  output = renderPlan(plan);
  const haveResult = complete || plan.completed.size > 0;
  $('emptyResult').hidden = haveResult;
  $('result').hidden = !haveResult || (mode === 'markdown' && view === 'preview');
  $('rendered').hidden = !haveResult || mode !== 'markdown' || view !== 'preview';
  $('result').value = haveResult ? output : '';
  if (haveResult && mode === 'markdown') {
    const html = marked.parse(previewSource(output), { gfm: true, breaks: false });
    $('rendered').innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ['img', 'iframe', 'style', 'script', 'form', 'video', 'audio', 'source', 'object', 'embed', 'svg', 'math'], FORBID_ATTR: ['style', 'src', 'srcset'] });
    for (const a of $('rendered').querySelectorAll('a')) { a.rel = 'noopener noreferrer'; if (!a.getAttribute('href')?.startsWith('#')) a.target = '_blank'; }
    for (const input of $('rendered').querySelectorAll('input')) input.disabled = true;
  }
  const count = plan.completed.size, total = plan.items.length;
  $('progress').value = total ? Math.round(100 * count / total) : 100;
  $('progressLabel').textContent = total ? `${count} / ${total} 段` : '';
  $('resultNote').textContent = complete ? (mode === 'markdown' ? '结构已保留 · 代码与链接原样保留' : '翻译完成') : '部分译文 · 未完成的段落保留原文';
  $('downloadText').textContent = !complete ? '下载部分结果' : mode === 'markdown' ? '下载 .md' : '下载';
}

function setMode(next) {
  mode = next; filename = '';
  for (const element of document.querySelectorAll('[data-mode]')) { const selected = element.dataset.mode === mode; element.classList.toggle('selected', selected); element.setAttribute('aria-selected', String(selected)); }
  $('documentBar').hidden = mode !== 'markdown'; $('viewTabs').hidden = mode !== 'markdown';
  $('fileLabel').textContent = '拖入 .md 文件，或直接粘贴 Markdown';
  $('source').placeholder = mode === 'markdown' ? '# 在这里粘贴 Markdown\n\n也可以选择或拖入 .md 文件。\n标题、列表、表格、代码与链接结构都会保留。' : "在这里写下或粘贴文字…\n\nPaste something here. We'll find the right direction.";
  resetOutput(); languageLabels();
  status(mode === 'markdown' ? '选择 Markdown 文件，或直接粘贴内容。' : '准备就绪，输入文字即可开始。');
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('已停止', 'AbortError'));
    const abort = () => { clearTimeout(timer); reject(new DOMException('已停止', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function translateBatch(items, signal) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const translations = await translateWithProvider({ provider: providerConfig, model: activeModel(), target: plan.target, items, signal, allowLocal: !staticApp });
      acceptTranslations(plan, items, translations);
      return;
    } catch (error) {
      if (error.name === 'AbortError' || signal.aborted) throw new DOMException('已停止', 'AbortError');
      lastError = error;
      if (error.retryable === false) throw error;
      if (attempt < 2) { const seconds = Math.max(error.retryAfter || 0, 2 * (attempt + 1)); status(`当前分段暂未完成，${seconds} 秒后自动重试…`); await wait(seconds * 1000, signal); }
    }
  }
  // A malformed multi-item reply is retried as smaller batches, keeping completed work.
  if (items.length > 1 && lastError.retryable !== true && !(lastError instanceof TypeError)) {
    const middle = Math.ceil(items.length / 2);
    await translateBatch(items.slice(0, middle), signal); updateOutput();
    await translateBatch(items.slice(middle), signal); return;
  }
  throw lastError;
}

async function translate() {
  if (busy || !$('source').value.trim()) return;
  if (providerConfig.type !== 'localai' && !isLocalProvider(providerConfig) && !providerConfig.apiKey) { openEffectiveSettings('translation'); settingsError(new Error('请先填写你自己的 API Key。')); return; }
  if (new TextEncoder().encode($('source').value).length > MAX_BYTES) { status('内容超过 2 MB，请分成较小的文档。', true); return; }
  const key = JSON.stringify([mode, $('direction').value, providerConfig.type, providerConfig.baseUrl, activeModel(), $('source').value]);
  try {
    if (!plan || planKey !== key || complete) { plan = createPlan($('source').value, mode, $('direction').value); planKey = key; }
  } catch { status('无法读取此 Markdown 内容，请检查格式后重试。', true); return; }
  controller = new AbortController(); startedAt = Date.now(); complete = false;
  setBusy(true); $('progressTrack').hidden = false;
  $('targetLanguage').textContent = plan.target === 'zh' ? '简体中文' : '英文';
  try {
    const batches = providerConfig.type === 'groq' ? pendingBatches(plan, 1800, 10) : pendingBatches(plan);
    if (!plan.items.length) { complete = true; updateOutput(); status('没有需要翻译的正文，内容已原样保留。'); return; }
    updateOutput();
    for (let i = 0; i < batches.length; i++) {
      status(`正在翻译${plan.target === 'zh' ? '为简体中文' : '为英文'} · 第 ${i + 1} / ${batches.length} 批…`);
      await translateBatch(batches[i], controller.signal); updateOutput();
    }
    complete = true; updateOutput();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    status(`翻译完成 · ${elapsed} 秒${mode === 'markdown' ? ' · 可预览或下载 Markdown' : ''}`);
  } catch (error) {
    output = plan.completed.size ? renderPlan(plan) : ''; updateOutput();
    if (error.name === 'AbortError') status('已停止。已完成的译文保留在本页，可以继续翻译。');
    else status(`${error.message}。已完成的段落已保留，可点击继续翻译。`, true);
  } finally { controller = null; setBusy(false); }
}

async function readFile(file) {
  if (!file || busy) return;
  if (!/\.(md|markdown)$/i.test(file.name)) { status('请选择 .md 或 .markdown 文件。', true); return; }
  if (file.size > MAX_BYTES) { status('文件超过 2 MB，请分成较小的文档。', true); return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    setMode('markdown'); filename = file.name; $('source').value = text;
    $('fileLabel').textContent = file.name; $('fileLabel').title = file.name;
    languageLabels(); status(`已在浏览器中读取 ${file.name} · 文件未上传`);
  } catch { status('无法读取文件。请将文件保存为 UTF-8 编码后重试。', true); }
  $('fileInput').value = '';
}

$('source').addEventListener('input', () => { resetOutput(); clearTimeout(previewTimer); previewTimer = setTimeout(languageLabels, 200); status('原文已更新，准备翻译。'); });
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
$('direction').addEventListener('change', () => { resetOutput(); languageLabels(); });
$('translate').addEventListener('click', translate);
$('stop').addEventListener('click', () => controller?.abort());
$('clear').addEventListener('click', () => { $('source').value = ''; filename = ''; $('fileLabel').textContent = '拖入 .md 文件，或直接粘贴 Markdown'; resetOutput(); languageLabels(); status('已清空。'); $('source').focus(); });
$('sample').addEventListener('click', () => { $('source').value = mode === 'markdown' ? sampleMarkdown : sampleText; filename = ''; resetOutput(); languageLabels(); status('示例已就绪，点击开始翻译。'); });
$('chooseFile').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', event => readFile(event.target.files?.[0]));
for (const name of ['dragenter', 'dragover']) $('dropArea').addEventListener(name, event => { event.preventDefault(); if (!busy) $('dropArea').classList.add('dragging'); });
$('dropArea').addEventListener('dragleave', event => { if (!$('dropArea').contains(event.relatedTarget)) $('dropArea').classList.remove('dragging'); });
$('dropArea').addEventListener('drop', event => { event.preventDefault(); $('dropArea').classList.remove('dragging'); readFile(event.dataTransfer.files?.[0]); });
document.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if (event.dataTransfer.files?.length) event.preventDefault(); });
for (const [id, next] of [['previewTab', 'preview'], ['sourceTab', 'source']]) $(id).addEventListener('click', () => {
  view = next;
  for (const [tab, name] of [['previewTab', 'preview'], ['sourceTab', 'source']]) { $(tab).classList.toggle('selected', name === view); $(tab).setAttribute('aria-selected', String(name === view)); }
  updateOutput();
});
$('copy').addEventListener('click', async () => {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(output);
    else {
      const temporary = document.createElement('textarea'); temporary.value = output; temporary.className = 'visually-hidden'; document.body.append(temporary); temporary.select();
      const ok = document.execCommand('copy'); temporary.remove(); if (!ok) throw new Error('copy failed');
    }
    toast(complete ? '已复制译文' : '已复制部分结果，包含未完成的原文');
  } catch { toast('自动复制不可用，请在源码视图中选择译文复制'); }
});
$('download').addEventListener('click', () => {
  const extension = mode === 'markdown' ? 'md' : 'txt';
  const stem = (filename || 'translation').replace(/\.(md|markdown)$/i, '').replace(/[\x00-\x1f/\\:*?"<>|]/g, '_');
  const name = `${stem}.${plan.target}${complete ? '' : '.partial'}.${extension}`;
  const blob = new Blob([output], { type: `${mode === 'markdown' ? 'text/markdown' : 'text/plain'};charset=utf-8` });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`已生成 ${name}`);
});
document.addEventListener('keydown', event => { if (activeWorkspace === 'translation' && !$('settingsDialog').open && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); translate(); } });
window.addEventListener('beforeunload', event => { if (busy || writingBusy || declaudishBusy) { event.preventDefault(); event.returnValue = ''; } });

function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('themeToggle').setAttribute('aria-pressed', String(dark));
  $('themeToggle').setAttribute('aria-label', dark ? '切换日间模式' : '切换夜间模式');
  $('themeToggle').title = dark ? '切换日间模式' : '切换夜间模式';
}
$('themeToggle').addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('yijian-theme', document.documentElement.dataset.theme); } catch {}
  syncThemeButton();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  let saved; try { saved = localStorage.getItem('yijian-theme'); } catch {}
  if (!saved) { document.documentElement.dataset.theme = event.matches ? 'dark' : 'light'; syncThemeButton(); }
});


settingsUI = setupModelSettings({ profiles, staticApp, isBusy: () => busy || writingBusy || declaudishBusy,
  onWorkspace: scope => { activeWorkspace = scope; }, toast,
  onChange: () => {
    const changed = JSON.stringify(providerConfig) !== JSON.stringify(profiles.effective('translation'));
    providerConfig = profiles.effective('translation');
    if (changed) { resetOutput(); status('翻译模型已更新，准备翻译。'); }
    languageLabels();
  } });
function openEffectiveSettings(scope) { settingsUI.openEffective(scope); }
function settingsError(error) { settingsUI.error(error); }
setupWriting({ getProvider: () => profiles.effective('writing'), allowLocal: !staticApp,
  openSettings: openEffectiveSettings, configure: scope => settingsUI.open(scope), toast,
  onBusy: value => { writingBusy = value; syncSettingsBusy(); } });
setupDeclaudish({ storage: browserStorage, path: appPath, getProvider: () => profiles.effective('declaudish'), allowLocal: !staticApp,
  openSettings: openEffectiveSettings, configure: scope => settingsUI.open(scope), toast,
  onBusy: value => { declaudishBusy = value; syncSettingsBusy(); } });
syncThemeButton(); languageLabels();
