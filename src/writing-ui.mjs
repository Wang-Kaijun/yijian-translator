import { reviewWithProvider } from './api.mjs';
import { MAX_WRITING_CHARS, validateWritingInput } from '../writing.mjs';

export function setupWriting({ getProvider, allowLocal, openSettings, toast, onBusy }) {
  const $ = id => document.getElementById(id);
  let controller = null;
  const status = (message, error = false) => { $('writingStatus').textContent = message; $('writingStatus').classList.toggle('error', error); };
  function node(tag, text, className) {
    const el = document.createElement(tag); el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const el = node('textarea', ''); el.value = text; el.className = 'visually-hidden';
        document.body.append(el); el.select();
        try { if (!document.execCommand('copy')) throw new Error(); } finally { el.remove(); }
      }
      toast('已复制英文正文（纯文本）');
    } catch { toast('自动复制不可用，请选中英文正文复制。'); }
  }
  function version(title, text, explanation) {
    const card = node('section', '', 'writing-card');
    const head = node('div', '', 'writing-card-heading');
    const button = node('button', '复制英文', 'subtle-button'); button.type = 'button';
    button.setAttribute('aria-label', `复制${title}的英文正文`);
    button.addEventListener('click', () => copy(text));
    head.append(node('h3', title), button); card.append(head);
    if (explanation) card.append(node('p', explanation, 'writing-explanation'));
    const body = node('div', text, 'writing-english'); body.lang = 'en'; body.tabIndex = 0; card.append(body);
    return card;
  }
  function render(data) {
    const fragment = document.createDocumentFragment();
    fragment.append(node('h3', data.hasErrors ? '01 · 发现语法问题' : '01 · 未发现语法错误'), node('p', data.grammarSummary));
    if (data.errors.length) {
      const list = node('ol', '', 'grammar-errors');
      for (const error of data.errors) {
        const item = node('li', '');
        item.append(node('p', `${error.original} → ${error.correction}`, 'error-excerpt'), node('p', error.explanation));
        list.append(item);
      }
      fragment.append(list);
    }
    fragment.append(version('仅修正语法', data.corrected, data.hasErrors ? '只修改语法、拼写和必要标点，保留原意与表达风格。' : '语法无误，以下保留你的原文。'));
    fragment.append(node('h3', `02 · ${data.worthPolishing ? '值得润色' : '无需刻意润色'}`), node('p', data.polishingReason));
    if (data.suggestions.length) {
      const list = node('ul', '', 'polish-suggestions');
      data.suggestions.forEach(text => list.append(node('li', text))); fragment.append(list);
    }
    data.versions.forEach((v, i) => fragment.append(version(`润色版本 ${i + 1} · ${v.title}`, v.text, v.explanation)));
    $('writingResults').replaceChildren(fragment); $('writingEmpty').hidden = true; $('writingResults').hidden = false;
  }
  function sync() {
    $('writingCount').textContent = `${$('writingSource').value.length.toLocaleString()} / ${MAX_WRITING_CHARS.toLocaleString()} 字符`;
    $('reviewWriting').disabled = Boolean(controller) || !$('writingSource').value.trim();
  }
  function reset() { $('writingResults').replaceChildren(); $('writingResults').hidden = true; $('writingEmpty').hidden = false; sync(); }
  async function review() {
    if (controller) return;
    const text = $('writingSource').value;
    try { validateWritingInput(text); } catch (error) { status(error.message, true); return; }
    const provider = { ...getProvider() };
    if (provider.type !== 'localai' && !provider.apiKey) { openSettings('writing'); status('请先配置语法与润色使用的模型和 API Key，或填写全局默认设置。', true); return; }
    reset(); controller = new AbortController(); onBusy(true);
    $('writingSource').disabled = true; $('clearWriting').disabled = true; $('writingSample').disabled = true;
    $('stopWriting').hidden = false; $('reviewWriting').textContent = '正在检查…'; sync();
    status('正在检查语法并评估润色建议…');
    try {
      const data = await reviewWithProvider({ provider, model: provider.model, text, signal: controller.signal, allowLocal });
      render(data); status('检查完成 · 中文分析，英文版本可分别复制。');
    } catch (error) { status(error.name === 'AbortError' ? '已停止检查，可重新开始。' : error.message, error.name !== 'AbortError'); }
    finally {
      controller = null; onBusy(false); $('writingSource').disabled = false; $('clearWriting').disabled = false; $('writingSample').disabled = false;
      $('stopWriting').hidden = true; $('reviewWriting').textContent = '检查语法与润色'; sync();
    }
  }
  $('writingSource').addEventListener('input', () => { reset(); status('英文已更新，准备检查。'); });
  $('clearWriting').addEventListener('click', () => { $('writingSource').value = ''; reset(); status('已清空。'); $('writingSource').focus(); });
  $('writingSample').addEventListener('click', () => { $('writingSource').value = 'Yesterday I go to the library and find an interesting book. It explain how small habits can makes a big difference in our daily life.'; reset(); status('示例已就绪，点击检查语法与润色。'); });
  $('reviewWriting').addEventListener('click', review);
  $('stopWriting').addEventListener('click', () => controller?.abort());
  $('writingSettings').addEventListener('click', () => openSettings('writing'));
  $('writingSource').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); review(); }
  });
  sync();
}
