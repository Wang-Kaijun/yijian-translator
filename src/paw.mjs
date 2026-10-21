import { localAddressSpace, browserNetworkOptions } from '../providers.mjs';
import { PAW_PROGRAM, PAW_CLOUD_URL, validateDeclaudishInput, parseDeclaudishOutput } from '../declaudish.mjs';

export function validatePawUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入 PAW 服务的完整地址，例如 http://127.0.0.1:8766。'); }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !localAddressSpace(url))) throw new Error('PAW 地址需为本机 / 局域网 HTTP 地址或 HTTPS 地址，不能含密钥或查询参数。');
  return url.href.replace(/\/+$/, '');
}

export async function pawRequest({ mode, baseUrl, apiKey = '', action = 'infer', text, signal }, fetchImpl = fetch) {
  if (!['cloud', 'self'].includes(mode) || !['health', 'verify', 'infer'].includes(action) || (mode === 'cloud' && action !== 'infer')) throw new Error('PAW 请求方式无效。');
  if (apiKey && (apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(apiKey))) throw new Error('PAW 密钥格式无效。');
  const base = mode === 'cloud' ? PAW_CLOUD_URL : validatePawUrl(baseUrl);
  if (action === 'infer') validateDeclaudishInput(text, mode);
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(action === 'health' ? 10000 : 180000)]) : AbortSignal.timeout(action === 'health' ? 10000 : 180000);
  try {
    const response = await fetchImpl(`${base}/${action}`, {
      method: action === 'health' ? 'GET' : 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      ...browserNetworkOptions(base), signal: combined,
      headers: { ...(action !== 'health' ? { 'Content-Type': 'application/json' } : {}), ...(apiKey ? { 'X-API-Key': apiKey } : {}) },
      ...(action === 'health' ? {} : { body: JSON.stringify(action === 'infer' ? { program_id: PAW_PROGRAM, input: text } : {}) }),
    });
    if (!response.ok) {
      const messages = { 401: 'PAW 服务密钥无效。', 403: 'PAW 服务拒绝访问，请检查允许的网页来源和密钥。', 409: 'PAW 正在处理其他请求，请稍后重试。', 422: 'PAW 输入超出模型上下文或格式要求，请缩短英文后重试。', 429: 'PAW 请求达到限额，请稍后重试。', 503: 'PAW 尚未就绪，请检查 SDK 安装、模型下载或服务端运行日志后重试。' };
      throw new Error(messages[response.status] || `PAW 返回 HTTP ${response.status}，请检查服务配置。`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('该地址未返回 PAW JSON 接口，请使用译间 PAW 连接服务。'); }
    if (action === 'health' || action === 'verify') {
      if (data?.service !== 'yijian-paw' || data.program_id !== PAW_PROGRAM || typeof data.sdk_installed !== 'boolean' || typeof data.model_ready !== 'boolean' || (action === 'verify' && data.verified !== true)) throw new Error('该地址不是兼容的译间 PAW 服务，请按下方说明启动连接脚本。');
      return data;
    }
    if (data.program_id && data.program_id !== PAW_PROGRAM) throw new Error('服务返回的 PAW 程序与所选程序不一致。');
    if (['length', 'max_tokens', 'context_limit'].includes(data.finish_reason)) throw new Error('PAW 输出被截断，请缩短英文后重试。');
    return parseDeclaudishOutput(data.output);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    if (combined.aborted) throw new Error('PAW 连接超时。首次验证可能仍在下载模型；请查看服务日志，稍后重新检测。');
    if (error instanceof TypeError) throw new Error('无法连接此 PAW 地址。请确认服务已启动、地址正确、允许译间跨域访问，并授予浏览器本地网络权限；这不能直接说明你未安装 PAW。');
    throw error;
  }
}
