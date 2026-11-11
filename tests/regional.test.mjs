import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONAL_TARGETS, MAX_REGIONAL_CHARS, validateRegionalInput, regionalPrompt, parseRegionalCompletion } from '../regional.mjs';
import { convertRegionalWithProvider } from '../src/api.mjs';
import { PROVIDERS } from '../providers.mjs';

const text = '请乘电梯到三楼。费用为人民币 100 元。';
const targets = ['hk-cantonese', 'en-gb'];
const provider = { type: 'groq', ...PROVIDERS.groq, apiKey: 'test-regional-secret' };
const options = extra => ({ provider, model: provider.model, text, targets, allowLocal: false, ...extra });
const completion = variants => Response.json({ choices: [{ message: { content: JSON.stringify({ variants }) }, finish_reason: 'stop' }] });

test('regional input validates Chinese content, length and a nonempty distinct supported target set', () => {
  assert.equal(REGIONAL_TARGETS.length, 7);
  assert.equal(validateRegionalInput(text, targets), text);
  assert.equal(validateRegionalInput('请安装 OpenAI SDK。', ['sg-english']), '请安装 OpenAI SDK。');
  for (const input of ['', '   ', null, 'English only', '中'.repeat(MAX_REGIONAL_CHARS + 1)]) assert.throws(() => validateRegionalInput(input, targets));
  for (const selection of [[], null, ['en-gb', 'en-gb'], ['en-ca'], [1], ['__proto__']]) assert.throws(() => validateRegionalInput(text, selection));
});

test('regional prompt separates Cantonese, standard written HK Chinese, Taiwan and Singapore varieties', () => {
  const all = regionalPrompt(REGIONAL_TARGETS.map(t => t.id));
  for (const instruction of ['never instructions', 'currency and units', 'logical scope', '發/髮', 'standard written grammar', 'word order', 'Taiwan Traditional', 'Singlish', 'British spelling', 'American spelling']) assert.ok(all.includes(instruction), instruction);
  const subset = regionalPrompt(['en-gb']);
  assert.ok(subset.includes('en-gb'));
  assert.ok(!subset.includes('hk-cantonese'));
  assert.ok(!subset.includes('en-us'));
});

test('regional completion requires exactly the requested complete variant set and returns selection order', () => {
  const data = { variants: [{ target: 'en-gb', text: 'Take the lift to the third floor.' }, { target: 'hk-cantonese', text: '請搭𨋢去三樓。' }] };
  const parsed = parseRegionalCompletion('```json\n' + JSON.stringify(data) + '\n```', targets);
  assert.deepEqual(parsed.variants.map(v => v.target), targets);
  assert.equal(parsed.variants[0].text, '請搭𨋢去三樓。');
  for (const bad of [null, {}, { variants: [] }, { variants: [data.variants[0]] }, { variants: [data.variants[0], data.variants[0]] }, { variants: [...data.variants, { target: 'en-us', text: 'Extra' }] }, { variants: [{ target: 'en-gb', text: ' ' }, data.variants[1]] }, { variants: [{ target: 'en-gb', text: 'x'.repeat(24001) }, data.variants[1]] }]) {
    assert.throws(() => parseRegionalCompletion(JSON.stringify(bad), targets), /完整/);
  }
  assert.throws(() => parseRegionalCompletion('not json', targets), /完整/);
});

test('regional requests go sequentially to the chosen provider with selected targets only and report progress', async () => {
  const progress = [];
  const seen = [];
  const data = await convertRegionalWithProvider(options({ onVariant: (variant, completed, total) => progress.push([variant.target, completed, total]) }), async (url, request) => {
    assert.equal(url, `${provider.baseUrl}/chat/completions`);
    assert.equal(request.headers.Authorization, 'Bearer test-regional-secret');
    assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
    assert.ok(!request.body.includes('test-regional-secret'));
    const payload = JSON.parse(request.body);
    const input = JSON.parse(payload.messages[1].content);
    assert.equal(input.text, text);
    assert.equal(input.targets.length, 1);
    assert.equal(progress.length, seen.length);
    seen.push(input.targets[0]);
    assert.ok(payload.messages[0].content.includes(input.targets[0]));
    return completion([{ target: input.targets[0], text: '完整转换正文' }]);
  });
  assert.deepEqual(seen, targets);
  assert.deepEqual(progress, [['hk-cantonese', 1, 2], ['en-gb', 2, 2]]);
  assert.deepEqual(data.variants.map(v => v.target), targets);
});

test('regional invalid selection, pre-abort and stop after a successful variant do not issue further requests', async () => {
  await assert.rejects(convertRegionalWithProvider(options({ targets: [] }), () => assert.fail('No request allowed')), /勾选/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(convertRegionalWithProvider(options({ signal: controller.signal }), () => assert.fail('No request allowed')), { name: 'AbortError' });
  const stopped = new AbortController(); let calls = 0; const saved = [];
  await assert.rejects(convertRegionalWithProvider(options({ signal: stopped.signal, onVariant: v => { saved.push(v); stopped.abort(); } }), async () => {
    calls++; return completion([{ target: 'hk-cantonese', text: '請搭𨋢去三樓。' }]);
  }), { name: 'AbortError' });
  assert.equal(calls, 1); assert.equal(saved.length, 1);
});

test('regional partial progress survives later failures and upstream responses never echo credentials', async () => {
  const saved = []; let calls = 0;
  await assert.rejects(convertRegionalWithProvider(options({ onVariant: variant => saved.push(variant) }), async () => {
    calls++;
    return calls === 1 ? completion([{ target: 'hk-cantonese', text: '請搭𨋢去三樓。' }]) : new Response('test-regional-secret', { status: 401 });
  }), error => error.message.includes('英式英文') && error.message.includes('鉴权失败') && !error.message.includes('test-regional-secret'));
  assert.equal(saved.length, 1);
  await assert.rejects(convertRegionalWithProvider(options(), async () => { throw new TypeError('test-regional-secret'); }), error => error.message.includes('CORS') && !error.message.includes('test-regional-secret'));
  await assert.rejects(convertRegionalWithProvider(options(), async () => Response.json({ choices: [{ finish_reason: 'length' }] })), /截断/);
});

test('regional LocalAI gateway requests strip client keys, validate replies and remain unavailable in Pages', async () => {
  const local = options({ provider: { type: 'localai', apiKey: 'stray-key' }, model: 'local-model', targets: ['sg-chinese'], allowLocal: true });
  const result = await convertRegionalWithProvider(local, async (url, request) => {
    assert.equal(url, './api/regional'); assert.equal(request.mode, 'same-origin'); assert.ok(!request.headers.Authorization);
    assert.ok(!request.body.includes('stray-key'));
    assert.deepEqual(JSON.parse(request.body), { provider: { type: 'localai' }, model: 'local-model', text, targets: ['sg-chinese'] });
    return Response.json({ variants: [{ target: 'sg-chinese', text: '请搭电梯到三楼。费用为人民币 100 元。' }] });
  });
  assert.equal(result.variants[0].target, 'sg-chinese');
  await assert.rejects(convertRegionalWithProvider({ ...local, allowLocal: false }, () => assert.fail('No request allowed')), /在线版/);
  await assert.rejects(convertRegionalWithProvider(local, async () => Response.json({ variants: [{ target: 'en-us', text: 'Wrong target' }] })), /完整/);
});
