import { isLocalProvider } from '../providers.mjs';
import { convertRegionalWithProvider } from './api.mjs';
import { REGIONAL_TARGETS, MAX_REGIONAL_CHARS, validateRegionalInput } from '../regional.mjs';

export function setupRegional({ getProvider, allowLocal, openSettings, configure = openSettings, toast, onBusy }) {
  const $ = id => document.getElementById(id);
  let controller = null;
  const status = (message, error = false) => {
    $('regionalStatus').textContent = message;
    $('regionalStatus').classList.toggle('error', error);
  };
  function node(tag, text, className) {
    const el = document.createElement(tag); el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  const choices = REGIONAL_TARGETS.map(target => {
    const label = node('label', '', 'regional-target');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'regionalTarget'; input.value = target.id; input.checked = true;
    label.append(input, node('strong', target.label)); $('regionalTargets').append(label);
    return input;
  });
  const selected = () => choices.filter(input => input.checked).map(input => input.value);
  function sync() {
    const count = selected().length, busy = Boolean(controller);
    $('regionalCount').textContent = `${$('regionalSource').value.length.toLocaleString()} / ${MAX_REGIONAL_CHARS.toLocaleString()} 字符`;
    $('regionalTargetCount').textContent = `已选 ${count} / ${REGIONAL_TARGETS.length}`;
    $('runRegional').disabled = busy || !count || !$('regionalSource').value.trim();
    $('selectAllRegional').disabled = busy || count === choices.length;
    $('clearRegionalTargets').disabled = busy || count === 0;
    for (const input of choices) input.disabled = busy;
  }
  function reset() {
    $('regionalResults').replaceChildren(); $('regionalResults').hidden = true;
    $('regionalEmpty').hidden = false; sync();
  }
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const el = node('textarea', ''); el.value = text; el.className = 'visually-hidden';
        document.body.append(el); el.select();
        try { if (!document.execCommand('copy')) throw new Error(); } finally { el.remove(); }
      }
      toast('已复制此版本正文');
    } catch { toast('自动复制不可用，请选中结果正文复制。'); }
  }
  function render(data) {
    const fragment = document.createDocumentFragment();
    for (const variant of data.variants) {
      const target = REGIONAL_TARGETS.find(item => item.id === variant.target);
      const card = node('section', '', 'writing-card regional-result-card');
      const heading = node('div', '', 'writing-card-heading');
      const copyButton = node('button', '复制正文', 'subtle-button'); copyButton.type = 'button';
      copyButton.setAttribute('aria-label', `复制${target.label}正文`);
      copyButton.addEventListener('click', () => copy(variant.text));
      heading.append(node('h3', target.label), copyButton);
      const content = node('div', variant.text, 'regional-result-text'); content.lang = target.lang; content.tabIndex = 0;
      card.append(heading, content); fragment.append(card);
    }
    $('regionalResults').replaceChildren(fragment); $('regionalResults').hidden = false; $('regionalEmpty').hidden = true;
  }
  async function convert() {
    if (controller) return;
    const text = $('regionalSource').value, targets = selected();
    try { validateRegionalInput(text, targets); } catch (error) { status(error.message, true); return; }
    const provider = { ...getProvider() };
    if (provider.type !== 'localai' && !isLocalProvider(provider) && !provider.apiKey) {
      openSettings('regional'); status('请先填写当前使用模型的 API Key。', true); return;
    }
    reset(); controller = new AbortController(); onBusy(true);
    const completed = [];
    for (const id of ['regionalSource', 'clearRegional', 'regionalSample']) $(id).disabled = true;
    $('stopRegional').hidden = false; $('runRegional').textContent = '正在转换…'; sync();
    status(`正在生成 ${targets.length} 种地区表达，保留原意并调整字形、用词和语法…`);
    try {
      const data = await convertRegionalWithProvider({ provider, model: provider.model, text, targets, signal: controller.signal, allowLocal,
        onVariant: (variant, count, total) => {
          if (controller.signal.aborted) return;
          completed.push(variant); render({ variants: completed });
          status(`已完成 ${count} / ${total} 个版本，正在继续转换…`);
        },
      });
      if (controller.signal.aborted) throw new DOMException('已停止', 'AbortError');
      render(data); status(`转换完成 · ${data.variants.length} 个版本可分别复制。`);
    } catch (error) {
      const kept = completed.length ? ` 已完成的 ${completed.length} 个版本已保留，可分别复制。` : '';
      status((error.name === 'AbortError' ? '已停止转换，可重新开始。' : error.message) + kept, error.name !== 'AbortError');
    } finally {
      controller = null; onBusy(false);
      for (const id of ['regionalSource', 'clearRegional', 'regionalSample']) $(id).disabled = false;
      $('stopRegional').hidden = true; $('runRegional').textContent = '转换地区表达'; sync();
    }
  }
  function targetsChanged() { reset(); status(selected().length ? '目标已更新，准备转换。' : '请至少勾选一种目标表达。'); }
  choices.forEach(input => input.addEventListener('change', targetsChanged));
  $('selectAllRegional').addEventListener('click', () => { choices.forEach(input => { input.checked = true; }); targetsChanged(); });
  $('clearRegionalTargets').addEventListener('click', () => { choices.forEach(input => { input.checked = false; }); targetsChanged(); });
  $('regionalSource').addEventListener('input', () => { reset(); status('原文已更新，准备转换。'); });
  $('clearRegional').addEventListener('click', () => { $('regionalSource').value = ''; reset(); status('已清空原文与结果。'); $('regionalSource').focus(); });
  $('regionalSample').addEventListener('click', () => {
    $('regionalSource').value = '您好，我想预订下周六下午三点的双人房。请问附近有地铁站和便利店吗？如果提前到达，可以先寄存行李吗？另外，请把确认信息发送到我的电子邮箱。谢谢！';
    reset(); status('示例已就绪，勾选目标后开始转换。');
  });
  $('runRegional').addEventListener('click', convert);
  $('stopRegional').addEventListener('click', () => controller?.abort());
  $('regionalSettings').addEventListener('click', () => configure('regional'));
  $('regionalSource').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); convert(); }
  });
  sync();
}
