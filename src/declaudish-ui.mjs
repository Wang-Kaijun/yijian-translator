import { declaudishWithProvider } from './api.mjs';
import { pawRequest } from './paw.mjs';
import { validateDeclaudishInput } from '../declaudish.mjs';

export function setupDeclaudish({ storage, path, getProvider, allowLocal, configure, openSettings, onBusy, toast }) {
  const $ = id => document.getElementById(id);
  let controller = null;
  const key = `yijian:declaudish:${path}`;
  const status = (message, error = false) => { $('declaudishStatus').textContent = message; $('declaudishStatus').classList.toggle('error', error); };
  try {
    const saved = JSON.parse(storage?.getItem(key) || 'null');
    if (['cloud', 'self', 'model'].includes(saved?.mode)) $('declaudishMode').value = saved.mode;
    if (typeof saved?.baseUrl === 'string') $('pawUrl').value = saved.baseUrl;
  } catch {}
  function sync() {
    const mode = $('declaudishMode').value, limit = mode === 'model' ? 4000 : 1200;
    $('pawCloudSettings').hidden = mode !== 'cloud'; $('pawSelfSettings').hidden = mode !== 'self';
    $('declaudishModelNote').hidden = mode !== 'model'; $('declaudishSettings').hidden = mode !== 'model'; $('pawEngineLabel').hidden = mode === 'model';
    $('pawEngineLabel').textContent = mode === 'self' ? '自部署 · 官方 Claudish 程序' : '官方 PAW 云端 · Claudish → English';
    $('declaudishCount').textContent = `${$('declaudishSource').value.length.toLocaleString()} / ${limit.toLocaleString()} 字符`;
    $('runDeclaudish').disabled = Boolean(controller) || !$('declaudishSource').value.trim();
    for (const id of ['declaudishMode', 'declaudishSource', 'clearDeclaudish', 'declaudishSample', 'pawUrl', 'pawSelfKey', 'pawCloudKey', 'checkPaw', 'verifyPaw']) $(id).disabled = Boolean(controller);
  }
  function reset() { $('declaudishResult').value = ''; $('declaudishResult').hidden = true; $('declaudishEmpty').hidden = false; $('copyDeclaudish').disabled = true; sync(); }
  function persist() { try { storage?.setItem(key, JSON.stringify({ mode: $('declaudishMode').value, baseUrl: $('pawUrl').value })); } catch {} }
  $('declaudishMode').addEventListener('change', () => { reset(); persist(); status('已切换运行方式。点击按钮后才会发送英文。'); });
  $('pawUrl').addEventListener('input', () => { $('pawSelfKey').value = ''; $('pawHealth').textContent = '地址已修改，请重新检测；若需要鉴权，请填写此服务的密钥。'; persist(); });
  $('declaudishSource').addEventListener('input', () => { reset(); status('英文已更新，准备改写。'); });
  $('clearDeclaudish').addEventListener('click', () => { $('declaudishSource').value = ''; reset(); status('已清空。'); });
  $('declaudishSample').addEventListener('click', () => { $('declaudishSource').value = 'The key distinction is this: only owners can merge. That is the boundary.'; reset(); status('示例已就绪，点击精简英文表达。'); });
  $('declaudishSettings').addEventListener('click', () => configure('declaudish'));
  function start() { controller = new AbortController(); sync(); onBusy(true); return controller.signal; }
  function finish() { controller = null; $('stopDeclaudish').hidden = true; $('cancelPawCheck').hidden = true; sync(); onBusy(false); }
  async function run() {
    if (controller) return;
    const mode = $('declaudishMode').value, text = $('declaudishSource').value;
    try { validateDeclaudishInput(text, mode); } catch (e) { status(e.message, true); return; }
    const provider = { ...getProvider() };
    if (mode === 'model' && !['localai', 'local'].includes(provider.type) && !provider.apiKey) { openSettings('declaudish'); status('请先补充所选站点的 API Key。', true); return; }
    reset(); const signal = start(); $('stopDeclaudish').hidden = false; status('正在精简英文表达…');
    try {
      const output = mode === 'model' ? await declaudishWithProvider({ provider, model: provider.model, text, signal, allowLocal }) : await pawRequest({ mode, baseUrl: $('pawUrl').value, apiKey: mode === 'cloud' ? $('pawCloudKey').value.trim() : $('pawSelfKey').value.trim(), text, signal });
      $('declaudishResult').value = output; $('declaudishResult').hidden = false; $('declaudishEmpty').hidden = true; $('copyDeclaudish').disabled = false;
      status('改写完成。请核对事实、限制条件和语气强弱后使用。');
    } catch (e) { status(e.name === 'AbortError' ? '已停止等待。自部署服务可能仍在完成当前计算。' : e.message, e.name !== 'AbortError'); }
    finally { finish(); }
  }
  async function check(action) {
    if (controller) return;
    const signal = start(); $('cancelPawCheck').hidden = false;
    $('pawHealth').classList.remove('error');
    $('pawHealth').textContent = action === 'verify' ? '正在加载官方模型并运行固定示例。首次下载约 620MB，可能需要几分钟；可在服务终端查看进度。' : '正在检查指定地址的 PAW 服务…';
    try {
      const data = await pawRequest({ mode: 'self', baseUrl: $('pawUrl').value, apiKey: $('pawSelfKey').value.trim(), action, signal });
      $('pawHealth').textContent = !data.sdk_installed ? '连接服务已启动，但未检测到 PAW SDK。请按下方说明安装，并重启连接服务。' : data.verified ? 'PAW 已就绪：官方程序已成功运行示例，可以开始改写。' : data.model_ready ? 'PAW 模型已加载；点击「加载并验证模型」完成运行验证。' : 'PAW SDK 已安装，连接服务正常；模型尚未加载。点击「加载并验证模型」准备资源。';
    } catch (e) { $('pawHealth').textContent = e.name === 'AbortError' ? '已停止等待。模型下载或计算可能仍在服务端继续，稍后可重新检测。' : e.message; $('pawHealth').classList.toggle('error', e.name !== 'AbortError'); }
    finally { finish(); }
  }
  $('checkPaw').addEventListener('click', () => check('health')); $('verifyPaw').addEventListener('click', () => check('verify'));
  $('cancelPawCheck').addEventListener('click', () => controller?.abort()); $('stopDeclaudish').addEventListener('click', () => controller?.abort());
  $('runDeclaudish').addEventListener('click', run);
  $('declaudishSource').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(); } });
  $('copyDeclaudish').addEventListener('click', async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText($('declaudishResult').value);
      else { $('declaudishResult').select(); if (!document.execCommand('copy')) throw new Error(); }
      toast('已复制英文正文（纯文本）');
    } catch { toast('自动复制不可用，请选中正文复制。'); }
  });
  sync();
}
