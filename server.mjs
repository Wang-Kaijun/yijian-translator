import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translationPrompt, parseCompletion } from './prompts.mjs';
import { generationOptions } from './providers.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, 'public');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8765);
const upstream = (process.env.LOCALAI_URL || 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
const defaultModel = process.env.LOCALAI_MODEL || 'qwen3.8-flash-next-strata';
let apiKey = process.env.LOCALAI_API_KEY?.trim();
if (!apiKey && process.env.CREDENTIALS_DIRECTORY) apiKey = (await readFile(resolve(process.env.CREDENTIALS_DIRECTORY, 'localai-key'), 'utf8')).trim();
if (!apiKey && process.env.LOCALAI_KEY_FILE) apiKey = (await readFile(process.env.LOCALAI_KEY_FILE, 'utf8')).trim();
if (!apiKey && process.env.LOCALAI_KEY_STDIN === '1') {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  apiKey = Buffer.concat(chunks).toString().trim();
}
if (!apiKey) { console.error('Missing LocalAI credential. Supply LOCALAI_KEY_STDIN=1, LOCALAI_KEY_FILE, or systemd LoadCredential.'); process.exit(1); }

let models = [defaultModel];
let checkedAt = 0;
let active = 0;
const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
};

function json(res, status, object, extra = {}) {
  res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(object));
}

async function modelList(signal) {
  if (Date.now() - checkedAt < 30000) return models;
  const timeout = AbortSignal.timeout(12000);
  const response = await fetch(`${upstream}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: signal || timeout });
  if (!response.ok) throw new Error(`LocalAI HTTP ${response.status}`);
  const data = await response.json();
  const available = data.data?.map(m => m.id).filter(id => typeof id === 'string' && !/asr|whisper|embed|tts|\.yaml|\.bak|before-/i.test(id)) || [];
  if (!available.includes(defaultModel)) throw new Error('默认模型未在 LocalAI 中找到');
  models = available;
  checkedAt = Date.now();
  return models;
}

async function body(req) {
  let size = 0;
  const buffers = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) { const error = new Error('单次请求过大，请缩小分段'); error.status = 413; throw error; }
    buffers.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); }
  catch { const error = new Error('请求必须是有效的 JSON'); error.status = 400; throw error; }
}

function validateRequest(data) {
  if (!data || !['zh', 'en'].includes(data.target)) throw new Error('翻译方向无效');
  if (data.provider && data.provider.type !== 'localai' || data.apiKey || data.provider?.apiKey) throw new Error('外部接口请由浏览器直连；服务器不接收用户 API Key');
  if (!models.includes(data.model)) throw new Error('LocalAI 模型无效');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 32) throw new Error('无效的文本分段数量');
  const ids = new Set();
  let size = 0;
  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim()) throw new Error('无效的文本分段');
    ids.add(item.id); size += item.text.length;
  }
  if (size > 12000) throw new Error('文本分段过长');
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const publicFiles = new Set(['/index.html', '/app.js', '/theme.js', '/style.css', '/favicon.svg', '/licenses.txt']);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok', service: 'lan-translator', version: '1.1.0' });
    if (url.pathname === '/api/status' && req.method === 'GET') {
      try {
        await modelList();
        return json(res, 200, { online: true, defaultModel, models, engine: 'LocalAI' });
      } catch { return json(res, 503, { online: false, defaultModel, models: [defaultModel], error: '暂时无法连接 LocalAI，请稍后重试' }); }
    }
    if (url.pathname === '/api/translate' || url.pathname === '/api/test-provider') {
      if (req.method !== 'POST') return json(res, 405, { error: '只支持 POST 请求' }, { Allow: 'POST' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: '拒绝跨站请求' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '拒绝跨站请求' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: '仅接受文本 JSON；不提供文件上传接口' });
      const data = await body(req);
      const testing = url.pathname === '/api/test-provider';
      if (testing && data) { data.target = 'zh'; data.items = [{ id: 'test', text: 'Hello. Welcome to the translation workspace.' }]; }
      try { validateRequest(data); } catch (error) { return json(res, 400, { error: error.message }); }
      if (active >= 2) return json(res, 429, { error: '翻译引擎正在处理其他请求，请稍候' }, { 'Retry-After': '4' });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180000);
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      active++;
      try {
        const payload = { model: data.model, temperature: 0.15, ...generationOptions('localai', data.model), stream: false, messages: [
          { role: 'system', content: translationPrompt(data.target) },
          { role: 'user', content: JSON.stringify({ items: data.items.map(({ id, text }) => ({ id, text })) }) },
        ] };
        const response = await fetch(`${upstream}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const engine = 'LocalAI';
          const status = [401, 403].includes(response.status) ? 401 : response.status === 429 || response.status === 503 ? 503 : 502;
          const message = response.status === 401 || response.status === 403 ? `${engine} 鉴权失败，请检查 API Key 或模型权限` : response.status === 402 ? `${engine} 余额不足，请检查账户` : `${engine} 返回 HTTP ${response.status}，请检查模型 ID、接口地址或稍后重试`;
          return json(res, status, { error: message, retryable: response.status === 429 || response.status >= 500 });
        }
        const completion = await response.json();
        const choice = completion?.choices?.[0];
        if (choice?.finish_reason === 'length') return json(res, 502, { error: '模型输出被截断，请重试当前分段' });
        const translations = parseCompletion(choice?.message?.content, data.items);
        return json(res, 200, testing ? { ok: true, message: '接口可用，测试翻译已完成', sample: translations[0].text } : { translations });
      } catch (error) {
        if (!res.destroyed) return json(res, error.name === 'AbortError' ? 504 : 502, { error: error.name === 'AbortError' ? '翻译等待超时，可继续未完成的分段' : error instanceof TypeError ? '无法连接翻译引擎，请稍后重试' : error.message });
      } finally { clearTimeout(timer); active--; }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不提供文件上传接口' });
    const name = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!publicFiles.has(name)) return json(res, 404, { error: '页面不存在' });
    const bytes = await readFile(resolve(publicRoot, name.slice(1)));
    res.writeHead(200, { ...baseHeaders, 'Content-Type': contentTypes[extname(name)] || 'application/octet-stream', 'Content-Length': bytes.length });
    return res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请重试' });
  }
});
server.requestTimeout = 200000;
server.headersTimeout = 10000;
server.listen(PORT, HOST, () => console.log(`LAN Translator listening on http://${HOST}:${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
