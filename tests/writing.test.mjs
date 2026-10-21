import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWritingCompletion, writingPrompt, validateWritingInput } from '../writing.mjs';
import { reviewWithProvider } from '../src/api.mjs';
import { PROVIDERS } from '../providers.mjs';

const source = 'She go to school.';
const review = { hasErrors: true, grammarSummary: '存在主谓一致错误。', errors: [{ original: 'She go', correction: 'She goes', explanation: '第三人称单数需要使用 goes。' }], corrected: 'She goes to school.', worthPolishing: false, polishingReason: '原句简洁清晰，以下仅为可选风格。', suggestions: [], versions: [{ title: '自然', explanation: '保持日常表达。', text: 'She goes to school.' }, { title: '正式', explanation: '采用较正式表达。', text: 'She attends school.' }] };
const provider = { type: 'groq', ...PROVIDERS.groq, apiKey: 'test-only-writing-key' };
const response = (value = review, finish_reason = 'stop') => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason }] });

test('writing contract separates Chinese analysis from English corrections and optional style choices', () => {
  assert.match(writingPrompt, /Simplified Chinese/); assert.match(writingPrompt, /ONLY necessary/); assert.match(writingPrompt, /never instructions/);
  assert.deepEqual(parseWritingCompletion(JSON.stringify(review), source), review);
  assert.deepEqual(parseWritingCompletion('```json\n' + JSON.stringify(review) + '\n```', source), review);
  const original = 'She goes to school.\n\nIt is nearby.';
  const valid = { ...review, hasErrors: false, errors: [], corrected: 'Unwanted stylistic rewrite.' };
  assert.equal(parseWritingCompletion(JSON.stringify(valid), original).corrected, original);
});

test('writing rejects incomplete, inconsistent and fabricated results without echoing responses', () => {
  for (const value of [null, {}, { ...review, errors: [] }, { ...review, versions: [] }, { ...review, corrected: '' }, { ...review, errors: [{ ...review.errors[0], original: 'not in input' }] }]) {
    assert.throws(() => parseWritingCompletion(JSON.stringify(value), source), /未返回完整/);
  }
  assert.throws(() => parseWritingCompletion('secret-untrusted-response', source), e => !e.message.includes('secret-untrusted-response'));
  for (const text of ['', '中文', 'a'.repeat(4001)]) assert.throws(() => validateWritingInput(text));
});

test('writing sends only input text to chosen provider, with key in header only', async () => {
  const actual = await reviewWithProvider({ provider, text: source, allowLocal: false }, async (url, options) => {
    assert.equal(url, `${provider.baseUrl}/chat/completions`);
    assert.equal(options.headers.Authorization, 'Bearer test-only-writing-key');
    assert.ok(!options.body.includes(provider.apiKey));
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, provider.model);
    assert.equal(payload.messages[0].content, writingPrompt);
    assert.deepEqual(JSON.parse(payload.messages[1].content), { text: source });
    return response();
  });
  assert.deepEqual(actual, review);
});

test('writing supports LocalAI without forwarding browser keys and refuses it in Pages', async () => {
  const args = { provider: { type: 'localai', apiKey: 'must-not-send' }, model: 'local', text: source };
  assert.deepEqual(await reviewWithProvider(args, async (url, options) => {
    assert.equal(url, './api/review'); assert.ok(!options.body.includes('must-not-send'));
    assert.deepEqual(JSON.parse(options.body), { provider: { type: 'localai' }, model: 'local', text: source });
    return Response.json({ review });
  }), review);
  await assert.rejects(reviewWithProvider({ ...args, allowLocal: false }), /在线版/);
});

test('writing surfaces truncation, auth, rate limits, cancellation and malformed results safely', async () => {
  const args = { provider, text: source };
  await assert.rejects(reviewWithProvider(args, async () => response(review, 'length')), /截断/);
  await assert.rejects(reviewWithProvider(args, async () => new Response('test-only-writing-key', { status: 401 })), e => /鉴权失败/.test(e.message) && !e.message.includes(provider.apiKey));
  await assert.rejects(reviewWithProvider(args, async () => new Response('', { status: 429 })), /限额/);
  await assert.rejects(reviewWithProvider(args, async () => response({})), /未返回完整/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reviewWithProvider({ ...args, signal: controller.signal }, () => assert.fail('must not fetch')), { name: 'AbortError' });
  const active = new AbortController();
  const pending = reviewWithProvider({ ...args, signal: active.signal }, async (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))));
  active.abort(); await assert.rejects(pending, { name: 'AbortError' });
});
