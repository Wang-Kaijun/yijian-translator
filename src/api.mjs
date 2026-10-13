import { validateExternalProvider, generationOptions } from '../providers.mjs';
import { translationPrompt, parseCompletion } from '../prompts.mjs';

function failure(message, retryable = false, retryAfter = 0) {
  return Object.assign(new Error(message), { retryable, retryAfter });
}

export async function translateWithProvider({ provider, model, target, items, signal, allowLocal = true }, fetchImpl = fetch) {
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
    const payload = local ? { provider: { type: 'localai' }, model, target, items } : {
      model: config.model, temperature: 0.15, ...generationOptions(config.type, config.model), stream: false,
      messages: [
        { role: 'system', content: translationPrompt(target) },
        { role: 'user', content: JSON.stringify({ items: items.map(({ id, text }) => ({ id, text })) }) },
      ],
    };
    const response = await fetchImpl(local ? './api/translate' : `${config.baseUrl}/chat/completions`, {
      method: 'POST', mode: local ? 'same-origin' : 'cors', credentials: 'omit', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(local ? {} : { Authorization: `Bearer ${config.apiKey}` }) },
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
    if (local) return parseCompletion(JSON.stringify({ translations: data.translations }), items);
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('模型输出被截断，请重试当前分段');
    return parseCompletion(choice?.message?.content, items);
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已停止', 'AbortError');
    if (controller.signal.aborted) throw failure('翻译等待超时，可继续未完成的分段', true);
    if (error instanceof TypeError) throw failure('浏览器无法直连接口，请检查网络及服务商的跨域访问支持（CORS）');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
