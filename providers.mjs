// Browser-safe configuration. Never place credentials in these presets.
export const PROVIDERS = Object.freeze({
  modelscope: { name: '魔搭 ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1', model: 'Qwen/Qwen3.8-Flash-Next', models: ['Qwen/Qwen3.8-Flash-Next'], keyUrl: 'https://modelscope.cn/my/myaccesstoken' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'], keyUrl: 'https://console.groq.com/keys' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3.8-27b:free', models: ['qwen/qwen3.8-27b:free'], keyUrl: 'https://openrouter.ai/settings/keys', hint: '默认选择免费模型（:free）。免费接口有限流，模型可用性可能变化；修改为付费模型会按服务商规则计费。' },
  siliconflow: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'XingChenAGI/Xing4.0-29B', models: ['XingChenAGI/Xing4.0-29B'], keyUrl: 'https://cloud.siliconflow.cn/me/account/ak', hint: '默认模型在 2026-10-15 官方价格页标注免费。需要完成平台要求的认证，具体限速及价格以模型页面为准。' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  zai: { name: 'Z.ai', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3', models: ['glm-5.3', 'glm-5.2', 'glm-5', 'glm-4.7'] },
  zhipu: { name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash', models: ['glm-4.7-flash'], keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', hint: '默认使用免费模型 GLM-4.7-Flash。已有浏览器保存的模型设置仍会保留，可手动改为 glm-4.7-flash。免费政策及并发限制以智谱平台为准。' },
  custom: { name: '自定义接口', baseUrl: '', model: '', models: [] },
  local: { name: '本地 / 局域网模型', baseUrl: 'http://127.0.0.1:11434/v1', model: '', models: [] },
});

export function isPublicAddress(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes(':')) return /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith('2001:db8:');
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19, 51].includes(b) || a === 203 && b === 0);
}

export function validateExternalProvider(provider, model = provider?.model) {
  const preset = Object.hasOwn(PROVIDERS, provider?.type) && PROVIDERS[provider.type];
  if (!preset) throw new Error('请选择有效的服务商。');
  let url;
  try { url = new URL(provider.baseUrl); } catch { throw new Error('请输入有效的 HTTPS API 地址。'); }
  if ((provider.type === 'local' ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) throw new Error('API 地址无效：云端需使用 HTTPS，地址不能含密钥或查询参数。');
  const host = url.hostname.toLowerCase();
  if (provider.type === 'local') {
    if (!localAddressSpace(url)) throw new Error('本地模型请填写 localhost、本机回环地址、局域网 IP 或 .local/.lan 主机名。');
  } else if (host === 'localhost' || /\.(localhost|local|internal|lan)$/.test(host) || ((host.includes(':') || /^[\d.]+$/.test(host)) && !isPublicAddress(host))) throw new Error('外部接口需要使用公开的 HTTPS 地址。');
  const baseUrl = url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  // Pin the entire preset endpoint, not just its host. A saved key cannot be redirected to another path.
  if (!['custom', 'local'].includes(provider.type) && baseUrl !== preset.baseUrl) throw new Error('地址与所选服务商不符，请重新选择服务商。');
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : '';
  if ((!apiKey && provider.type !== 'local') || apiKey.length > 4096 || (apiKey && !/^[\x21-\x7e]+$/.test(apiKey))) throw new Error('请填写有效的 API Key。');
  if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\r\n]/.test(model)) throw new Error('请填写有效的模型 ID。');
  return { type: provider.type, baseUrl, apiKey, model: model.trim(), name: preset.name };
}

// Used only for explicit browser-to-device requests; never for server-side proxying.
export function localAddressSpace(value) {
  let host;
  try { host = (value instanceof URL ? value : new URL(value)).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return null; }
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || (ipv4 && /^127\./.test(host))) return 'loopback';
  if ((ipv4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) || /^(fc|fd)[a-f\d]{2}:/.test(host) || /\.(local|lan|internal)$/.test(host)) return 'local';
  return null;
}

export function browserNetworkOptions(baseUrl) {
  const targetAddressSpace = localAddressSpace(baseUrl);
  return targetAddressSpace ? { targetAddressSpace } : {};
}

export function generationOptions(type, model) {
  if (type === 'localai') return { reasoning_effort: 'none', max_tokens: 8192 };
  if (type === 'groq') return { max_completion_tokens: 4096, ...(model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low', include_reasoning: false } : {}) };
  if (type === 'modelscope') return { max_tokens: 8192, enable_thinking: false };
  if (type === 'openrouter') return { max_tokens: 8192, reasoning: { enabled: false } };
  if (type === 'deepseek') return { thinking: { type: 'disabled' }, max_tokens: 8192 };
  if (type === 'zai' || type === 'zhipu') return /^glm-5\.3/i.test(model) ? { thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 16384 } : { thinking: { type: 'disabled' }, max_tokens: 8192 };
  return { max_tokens: 8192 };
}
