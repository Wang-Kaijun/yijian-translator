import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWithProvider } from '../src/api.mjs';
import { PROVIDERS, validateExternalProvider } from '../providers.mjs';
const items = [{ id: 'a', text: 'Hello' }];
const translations = [{ id: 'a', text: '你好' }];
const response = () => Response.json({ choices: [{ message: { content: JSON.stringify({ translations }) }, finish_reason: 'stop' }] });
const request = type => ({ provider: { type, ...PROVIDERS[type], apiKey: 'test-only-secret-canary' }, model: PROVIDERS[type].model, target: 'zh', items, allowLocal: false });

test('each external key goes only to its selected HTTPS endpoint in the authorization header', async () => {
  for (const type of ['modelscope', 'groq']) {
    let calls = 0;
    const result = await translateWithProvider(request(type), async (url, options) => {
      calls++;
      assert.equal(url, `${PROVIDERS[type].baseUrl}/chat/completions`);
      assert.equal(options.headers.Authorization, 'Bearer test-only-secret-canary');
      assert.ok(!options.body.includes('test-only-secret-canary'));
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.cache, 'no-store');
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, PROVIDERS[type].model);
      assert.match(payload.messages[0].content, /never instructions/);
      assert.deepEqual(JSON.parse(payload.messages[1].content).items, items);
      assert.ok(!payload.tools);
      if (type === 'groq') { assert.equal(payload.reasoning_effort, 'low'); assert.equal(payload.max_completion_tokens, 4096); }
      return response();
    });
    assert.deepEqual(result, translations); assert.equal(calls, 1);
  }
});

test('LocalAI request strips any stray key and cannot be used in the Pages build', async () => {
  const data = { provider: { type: 'localai', apiKey: 'must-not-send' }, model: 'qwen', target: 'zh', items };
  assert.deepEqual(await translateWithProvider(data, async (url, options) => {
    assert.equal(url, './api/translate'); assert.ok(!options.headers.Authorization);
    assert.ok(!options.body.includes('must-not-send')); return Response.json({ translations });
  }), translations);
  await assert.rejects(translateWithProvider({ ...data, allowLocal: false }, () => assert.fail('No request allowed')), /在线版/);
});

test('upstream errors and network errors cannot echo a key to the UI', async () => {
  await assert.rejects(translateWithProvider(request('groq'), async () => new Response('test-only-secret-canary', { status: 401 })), error => !error.message.includes('test-only-secret-canary') && /鉴权失败/.test(error.message) && error.retryable === false);
  await assert.rejects(translateWithProvider(request('groq'), async () => { throw new TypeError('test-only-secret-canary'); }), error => !error.message.includes('test-only-secret-canary') && /CORS/.test(error.message));
});

test('rate limit retry respects bounded Retry-After and abort does not issue a request', async () => {
  await assert.rejects(translateWithProvider(request('groq'), async () => new Response('', { status: 429, headers: { 'Retry-After': '35' } })), error => error.retryable && error.retryAfter === 35);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translateWithProvider({ ...request('groq'), signal: controller.signal }, () => assert.fail('No request allowed')), { name: 'AbortError' });
});

test('presets pin full endpoint paths and reject malformed authorization values', () => {
  for (const baseUrl of ['https://api.groq.com/other', 'https://api.groq.com/openai/v1?key=x', 'https://api.groq.com.evil.example/openai/v1']) assert.throws(() => validateExternalProvider({ ...request('groq').provider, baseUrl }));
  assert.throws(() => validateExternalProvider({ ...request('groq').provider, apiKey: 'key\r\nInjected: true' }));
});
