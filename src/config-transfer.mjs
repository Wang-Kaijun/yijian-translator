import { PROVIDERS, validateExternalProvider, localAddressSpace, browserNetworkOptions, isPublicAddress } from '../providers.mjs';
import { cleanModels } from './sites.mjs';
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const SCOPES = ['global', 'translation', 'writing', 'declaudish'];
export function parseConfig(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_CONFIG_BYTES) throw new Error('配置文件最大为 1 MB。');
  let data; try { data = JSON.parse(text); } catch { throw new Error('请选择有效的 JSON 配置文件。'); }
  if (data?.format !== 'yijian-config' || data.version !== 1 || !Array.isArray(data.sites) || data.sites.length > 100) throw new Error('不支持的配置格式或版本（最多 100 个服务商）。');
  const seen = new Set();
  const sites = data.sites.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || seen.has(entry.id)) throw new Error('服务商标识无效或重复。');
    seen.add(entry.id);
    if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 80 || !Array.isArray(entry.models) || entry.models.length > 500 || entry.models.some(m => typeof m !== 'string' || !m.trim() || m.length > 200 || /[\r\n]/.test(m))) throw new Error('服务商名称或模型列表无效。');
    if (entry.apiKey !== undefined && typeof entry.apiKey !== 'string') throw new Error('API Key 格式无效。');
    const valid = validateExternalProvider({ ...entry, apiKey: entry.apiKey || 'validation-only' });
    return { ...valid, id: entry.id, label: entry.label.trim(), models: cleanModels([valid.model, ...entry.models]), ...(Object.hasOwn(entry, 'apiKey') ? { apiKey: entry.apiKey.trim() } : { apiKey: undefined }) };
  });
  const selections = {};
  if (data.selections !== undefined && (!data.selections || typeof data.selections !== 'object' || Array.isArray(data.selections))) throw new Error('功能模型选择格式无效。');
  for (const scope of SCOPES) {
    const entry = data.selections?.[scope]; if (entry === undefined) continue;
    if (!entry || !seen.has(entry.siteId) || typeof entry.model !== 'string' || !entry.model.trim() || entry.model.length > 200 || /[\r\n]/.test(entry.model) || typeof entry.useGlobal !== 'boolean') throw new Error('功能引用的服务商或模型无效。');
    selections[scope] = { siteId: entry.siteId, model: entry.model.trim(), useGlobal: entry.useGlobal };
  }
  return { format: 'yijian-config', version: 1, sites, selections };
}
export function exportConfig(profiles, includeSecrets = false) {
  const sites = profiles.sites.list().map(s => profiles.sites.read(s.id));
  const selections = {};
  for (const scope of SCOPES) {
    const own = profiles.own(scope); if (!own?.baseUrl || !own.model || own.type === 'localai') continue;
    let id = profiles.binding(scope)?.siteId;
    if (!sites.some(s => s.id === id)) {
      id = 'legacy-' + scope;
      while (sites.some(s => s.id === id)) id += '-x';
      sites.push({ ...own, id, label: own.label || own.name || PROVIDERS[own.type]?.name || scope, models: [own.model] });
    }
    selections[scope] = { siteId: id, model: own.model, useGlobal: profiles.isOverridden(scope) };
  }
  const data = { format: 'yijian-config', version: 1, sites: sites.map(s => ({ id: s.id, type: s.type, label: s.label, baseUrl: s.baseUrl, model: s.model, models: s.models, ...(includeSecrets ? { apiKey: s.apiKey || '' } : {}) })), selections };
  parseConfig(JSON.stringify(data));
  return data;
}
export function validateDavUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('请输入 WebDAV 配置文件的完整 URL。'); }
  const local = localAddressSpace(url), host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local) || url.username || url.password || url.search || url.hash || url.pathname.endsWith('/') || (!local && (host.includes(':') || /^[\d.]+$/.test(host)) && !isPublicAddress(host))) throw new Error('WebDAV 需使用 HTTPS；本机和局域网可用 HTTP。请填写文件地址，不要在 URL 中附带密码或参数。');
  return url.href;
}
export async function webdavRequest({ url, username = '', password = '', method = 'GET', data, etag, signal }, fetchImpl = fetch) {
  url = validateDavUrl(url);
  if (!['GET', 'PUT'].includes(method)) throw new Error('不支持的 WebDAV 操作。');
  if (username.includes(':') || /[\r\n]/.test(username + password)) throw new Error('WebDAV 账号格式无效。');
  const headers = {};
  if (username || password) headers.Authorization = 'Basic ' + btoa(Array.from(new TextEncoder().encode(username + ':' + password), b => String.fromCharCode(b)).join(''));
  let body;
  if (method === 'PUT') {
    body = JSON.stringify(data, null, 2); parseConfig(body);
    if (!etag || etag.startsWith('W/')) throw new Error('请先读取远程配置并获取版本号；服务器需公开 ETag 响应头。');
    headers['Content-Type'] = 'application/json'; headers[etag === '__missing__' ? 'If-None-Match' : 'If-Match'] = etag === '__missing__' ? '*' : etag;
  }
  try {
    const response = await fetchImpl(url, { method, headers, body, mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', ...browserNetworkOptions(url), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    if (method === 'GET' && response.status === 404) return { missing: true, etag: '__missing__' };
    if (response.status === 412) throw new Error('远程文件已被其他设备更新，请重新读取后再上传。');
    if (!response.ok) throw new Error(`WebDAV 返回 HTTP ${response.status}，请检查账号、文件地址和权限。`);
    if (method === 'PUT') return { etag: response.headers.get('etag') || '' };
    if (Number(response.headers.get('content-length')) > MAX_CONFIG_BYTES) throw new Error('配置文件最大为 1 MB。');
    const reader = response.body?.getReader(); let text;
    if (reader) {
      const chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_CONFIG_BYTES) { await reader.cancel(); throw new Error('配置文件最大为 1 MB。'); } chunks.push(value); }
      const buffer = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; } text = new TextDecoder().decode(buffer);
    } else text = await response.text();
    return { config: parseConfig(text), etag: response.headers.get('etag') || '' };
  } catch (e) {
    if (e instanceof TypeError) throw new Error('无法连接 WebDAV，请检查服务、CORS 和浏览器本地网络权限。');
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw new Error('WebDAV 请求已取消或超时。');
    throw e;
  }
}
