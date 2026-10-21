import { validateExternalProvider, generationOptions, browserNetworkOptions } from '../providers.mjs';
import { translationPrompt, parseCompletion } from '../prompts.mjs';
import { writingPrompt, validateWritingInput, parseWritingCompletion } from '../writing.mjs';
import { declaudishPrompt, validateDeclaudishInput, parseDeclaudishOutput } from '../declaudish.mjs';

function failure(message, retryable = false, retryAfter = 0) {
  return Object.assign(new Error(message), { retryable, retryAfter });
}

export function translateWithProvider(options, fetchImpl = fetch) {
  return requestWithProvider(options, fetchImpl);
}

export function reviewWithProvider(options, fetchImpl = fetch) {
  validateWritingInput(options.text);
  return requestWithProvider({ ...options, writing: true }, fetchImpl);
}

export function declaudishWithProvider(options, fetchImpl = fetch) {
  validateDeclaudishInput(options.text);
  return requestWithProvider({ ...options, declaudish: true }, fetchImpl);
}

async function requestWithProvider({ provider, model, target, items, text, writing = false, declaudish = false, signal, allowLocal = true }, fetchImpl) {
  const local = provider?.type === 'localai';
  if (local && !allowLocal) throw failure('在线版请使用外部 API；LocalAI 可在局域网版使用。');
  const config = local ? null : validateExternalProvider(provider, model);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 180000);
  try {
    // External API keys never go to our server or GitHub. LocalAI's gateway receives text only.
    const payload = local ? { provider: { type: 'localai' }, model, ...(writing || declaudish ? { text } : { target, items }) } : {
      model: config.model, temperature: 0.15, ...generationOptions(config.type, config.model), stream: false,
      messages: [
        { role: 'system', content: declaudish ? declaudishPrompt : writing ? writingPrompt : translationPrompt(target) },
        { role: 'user', content: JSON.stringify(writing || declaudish ? { text } : { items: items.map(({ id, text }) => ({ id, text })) }) },
      ],
    };
    const response = await fetchImpl(local ? (declaudish ? './api/declaudish' : writing ? './api/review' : './api/translate') : `${config.baseUrl}/chat/completions`, {
      method: 'POST', mode: local ? 'same-origin' : 'cors', credentials: 'omit', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      ...browserNetworkOptions(config?.baseUrl),
      headers: { 'Content-Type': 'application/json', ...(!local && config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      // Never render or log upstream error bodies: they can echo credentials or arbitrary HTML.
      const name = config?.name || 'LocalAI';
      const retryAfter = Math.min(60, Math.max(0, Number(response.headers?.get('retry-after')) || 0));
      const message = [401, 403].includes(response.status) ? `${name} 鉴权失败，请检查 API Key、模型权限或网络地区` : response.status === 402 ? `${name} 余额不足，请检查账户` : response.status === 429 ? `${name} 请求达到限额，请稍后继续` : `${name} 返回 HTTP ${response.status}，请检查模型 ID 或稍后重试`;
      throw failure(message, response.status === 429 || response.status >= 500, retryAfter);
    }
    let data;
    try { data = await response.json(); } catch { throw failure('接口未返回有效的 JSON，请检查 API 地址。'); }
    if (local) return declaudish ? parseDeclaudishOutput(data.output) : writing ? parseWritingCompletion(JSON.stringify(data.review), text) : parseCompletion(JSON.stringify({ translations: data.translations }), items);
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error(writing ? '模型输出被截断，请缩短英文内容或更换模型后重试。' : '模型输出被截断，请重试当前分段');
    return declaudish ? parseDeclaudishOutput(choice?.message?.content) : writing ? parseWritingCompletion(choice?.message?.content, text) : parseCompletion(choice?.message?.content, items);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    if (controller.signal.aborted) throw failure(writing ? '检查等待超时，请重试或缩短英文内容。' : '翻译等待超时，可继续未完成的分段', true);
    if (error instanceof TypeError) throw failure('浏览器无法直连接口，请检查服务是否启动、网络地址、跨域设置（CORS）及浏览器的本地网络访问权限。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function fetchModels(provider, signal, fetchImpl = fetch) {
  const config = validateExternalProvider(provider, provider.model || 'model-list');
  try {
    const response = await fetchImpl(`${config.baseUrl}/models`, {
      method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      ...browserNetworkOptions(config.baseUrl), headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
    if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}），可手动填写模型 ID。`);
    const data = await response.json();
    const ids = [...new Set((Array.isArray(data.data) ? data.data : []).map(v => v?.id).filter(v => typeof v === 'string' && v.trim() && v.length <= 200 && !/[\r\n]/.test(v)))].slice(0, 500);
    if (!ids.length) throw new Error('接口没有返回模型列表，请手动填写。');
    return ids;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接模型列表，请检查服务、CORS 和浏览器本地网络权限；也可手动填写。');
    throw error;
  }
}
