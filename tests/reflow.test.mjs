import test from 'node:test';
import assert from 'node:assert/strict';
import { reflowSource, parseReflowCompletion, validateReflowInput } from '../reflow.mjs';
import { reflowWithProvider } from '../src/api.mjs';
import { reflowRanges, createPlan } from '../src/translation.mjs';
import { PROVIDERS } from '../providers.mjs';

const paper = `We recorded marker positions on a benchtop assembly [13] and logged the temperature in
the room every ten minutes. The first series used a rigid bracket and a strip of removable
tape. A second series used two clamps to check that the mounting did not change the readings
by more than the resolution given in the instrument manual [2, 5]. The same operator recorded
the time of each change in a separate log.
Calibration started with a reference plate at a known distance from the sensor. We moved the
plate in steps of 0.5 mm and recorded the sensor reading at each step. The reference stayed
in place while the logger collected ten values. We then calculated the mean and subtracted the
previous mean xₜ₋₁ to estimate the change between steps. The plate was moved back to the
starting position between runs to check for drift. When a reading fell outside the range on
the display, we repeated that step. Two runs used a frame with an extra mounting hole [21]
so we could replace the clamp without moving the sensor. The extra hole had no measurable
effect on the position of the reference plate.
Measurement conditions stayed within the specified range. Temperatures varied by less than 2 °C
and the logger kept the same sampling interval [7, 19]. The test stopped when any of the
markers moved beyond the camera frame. No broken mounts were observed and the display
returned to zero after the reference was removed.
This procedure makes the readings easier to compare across assemblies by using the same
reference and the same order of operations. It also leaves a record of every repeated step,
including the readings we did not include in the final averages. We recommend using two
independent fixtures when checking the effect of changing the mount.`;

const caption = `Not plotted. a Bench-top gripper at 120 V [34]: motor dimensions given; no total mass; b Inspection robot tested in
a water tank [35]: drive mass unavailable; c Two grippers in parallel [36]: onboard
high-voltage circuits; d Soft manipulator with elastic joints [37]: onboard supply; weights listed
only in an appendix; e Flexible platform [38]: five actuators at 21.3 g total; test rig excluded;
off-board supply.
Notes. Position control varied across the trials: manual, 1; open loop, 2 and 15; optically tracked, 3; external sensing and computation,
4–8; guide rails, 14; a local controller, 26; commands from a test station, 33.
aActive material only (0.6 mg); the housing (9) is heavier. cActuator mass estimated as unit mass × unit count, or
measured ratio × assembly mass. †Calculation assumes that each of the
four actuators contributes equally. Total mass for the last trial is the sum of
the measured parts (calc.).`;

const provider = { type: 'local', baseUrl: 'http://localhost:11434/v1', model: 'layout-test' };
function format(source, decide, { mode = 'text', signal = new AbortController().signal } = {}) {
  return reflowSource(source, reflowRanges(source, mode), layout => reflowWithProvider({
    provider, model: provider.model, layout, signal,
  }, async (url, options) => {
    assert.equal(url, provider.baseUrl + '/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, provider.model);
    assert.equal(body.response_format, undefined);
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input, layout);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(decide(input)) } }] });
  }), signal);
}

test('PDF example becomes four translation paragraphs with all wording, references and symbols intact', async () => {
  const text = await format(paper, ({ boundaries }) => {
    const actions = { join: [], space: [], paragraph: [] };
    for (const { id, gap, next } of boundaries) {
      if (/^(Calibration started|Measurement conditions stayed|This procedure makes)/.test(next)) actions.paragraph.push(id);
      else if (gap === 'wrap') actions.space.push(id);
    }
    return actions;
  });
  const lines = paper.split('\n');
  const expected = [[0, 5], [5, 13], [13, 17], [17, 21]].map(([from, to]) => lines.slice(from, to).join(' '));
  assert.deepEqual(text.split('\n\n'), expected);
  assert.deepEqual(createPlan(text).items.map(item => item.text), expected);
});

test('Chinese sentence boundaries, literal hyphens, CRLF, indentation and intentional whitespace', async () => {
  const source = '  中文\r\n句子。”换个话题。\t\t结果  ht−1 🙂\nencoder-\ndecoder  [13]\r\n\r\n\t1.  列表\n';
  const text = await format(source, ({ boundaries }) => {
    assert.deepEqual(boundaries.map(b => b.gap), ['wrap', 'sentence', 'sentence', 'wrap', 'wrap', 'blank']);
    return { join: [1, 5], paragraph: [2], space: [4] };
  });
  assert.equal(text, '  中文句子。”\n\n换个话题。\t\t结果  ht−1 🙂 encoder-decoder  [13]\r\n\r\n\t1.  列表\n');
});

test('Markdown limits model decisions to plain prose and preserves structural breaks', async () => {
  const source = '# Title\n\nRead this\nparagraph.\n\n- keep\n  indentation\n\n> blocks\n> stay\n\n```txt\ncode\nhere\n```\n\nx  \ny\n\n$ht−1$ and [links](https://example.org)';
  let count = 0;
  const result = await format(source, input => {
    assert.equal(input.first, 'Read this'); count++;
    return { space: [1], join: [], paragraph: [] };
  }, { mode: 'markdown' });
  assert.equal(count, 1);
  assert.equal(result, source.replace('this\nparagraph', 'this paragraph'));
});

test('bounded batches retain their shared context and originals even for very long lines', async () => {
  const line = 'a'.repeat(14000);
  const source = Array.from({ length: 80 }, (_, i) => line + i).join('\n');
  let previous, count = 0;
  const result = await format(source, input => {
    if (count++) assert.equal(input.first, previous);
    previous = input.boundaries.at(-1).next;
    return { space: input.boundaries.map(b => b.id), join: [], paragraph: [] };
  });
  assert.ok(count > 1);
  assert.equal(result, source.replaceAll('\n', ' '));
});

test('reject prose, unknown fields, invalid decisions and conflicting IDs', () => {
  const layout = { first: 'A.', boundaries: [{ id: 1, gap: 'sentence', next: 'B' }] };
  for (const invalid of ['rewritten', 'null', '{}', '{"space":[],"join":[],"paragraph":[],"text":"replacement"}',
    '{"space":[1],"paragraph":[1]}', '{"space":[],"join":[],"paragraph":[1,1]}', '{"space":null}', '[]',
    '{"space":[],"join":[],"paragraph":[2]}', '{"space":[],"join":[],"paragraph":["1"]}']) {
    assert.throws(() => parseReflowCompletion(invalid, layout), /指令无效/);
  }
  assert.throws(() => validateReflowInput({ ...layout, boundaries: [] }), /分段无效/);
  assert.throws(() => validateReflowInput({ ...layout, first: 'x'.repeat(5000) }), /分段无效/);
});

test('omitted categories and same-paragraph decisions preserve existing English and Chinese separators', async () => {
  const source = 'The sample was\ntested.  It survived.\n\n中文。没有空格。\t保留制表符。';
  const result = await format(source, ({ boundaries }) => {
    assert.deepEqual(boundaries.map(b => b.gap), ['wrap', 'sentence', 'blank', 'sentence', 'sentence']);
    return { space: [1, 2, 4], join: [5] };
  });
  assert.equal(result, source.replace('was\ntested', 'was tested'));
});

test('DeepSeek Flash retries invalid or truncated JSON with ordered plain-text actions', async () => {
  const layout = { first: 'Some', boundaries: [{ id: 1, gap: 'wrap', next: 'text.' }] };
  const options = { provider: { type: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'test-only' }, model: 'deepseek-flash', layout };
  for (const [firstReply, finish] of [['  ', 'stop'], ['{"join":[34]}', 'stop'], ['{"actions":[]}', 'stop'], ['{"actions":["space"]}', 'length']]) {
    const requests = [];
    const result = await reflowWithProvider(options, async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'deepseek-flash');
      assert.deepEqual(body.response_format, requests.length === 0 ? { type: 'json_object' } : undefined);
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.deepEqual(JSON.parse(body.messages[1].content), { first: 'Some', boundaries: [{ gap: 'wrap', next: 'text.' }] });
      requests.push(body);
      const content = requests.length === 1 ? firstReply : 'space';
      return Response.json({ choices: [{ message: { content }, finish_reason: requests.length === 1 ? finish : 'stop' }] });
    });
    assert.deepEqual(result, { space: [1], join: [], paragraph: [] });
    assert.equal(requests.length, 2);
    assert.match(requests[1].messages[0].content, /Required number of actions, in order: 1\./);
  }
  let calls = 0;
  await assert.rejects(reflowWithProvider(options, async () => {
    calls++;
    return new Response(null, { status: 401 });
  }), /鉴权失败/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(reflowWithProvider({ ...options, signal: controller.signal }, async () => {
    calls++;
    controller.abort();
    return Response.json({ choices: [{ message: { content: ' ' } }] });
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('DeepSeek Flash reflows a citation-heavy caption while preserving references, punctuation and quantities', async () => {
  // Saved sites can reference the official endpoint through the custom provider.
  const provider = { ...PROVIDERS.deepseek, type: 'custom', apiKey: 'test-only' };
  const signal = new AbortController().signal;
  let calls = 0;
  const result = await reflowSource(caption, reflowRanges(caption, 'text'), layout =>
    reflowWithProvider({ provider, model: provider.model, layout, signal }, async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      const { boundaries } = JSON.parse(body.messages[1].content);
      assert.ok(boundaries.every(b => !Object.hasOwn(b, 'id')));
      const actions = boundaries.map(({ gap, next }) => /^(Notes\.|aActive|cActuator|†Calculation)/u.test(next)
        ? 'paragraph' : gap === 'wrap' ? 'space' : 'keep');
      assert.equal(body.response_format.type, 'json_object');
      assert.deepEqual(body.thinking, { type: 'disabled' });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ actions }) }, finish_reason: 'stop' }] });
    }), signal);
  assert.equal(calls, 1);
  const lines = caption.split('\n');
  const expected = [lines.slice(0, 5).join(' '), lines.slice(5, 7).join(' '), lines.slice(7).join(' ')]
    .join('\n\n').replace('is heavier. cActuator', 'is heavier.\n\ncActuator').replace('assembly mass. †Calculation', 'assembly mass.\n\n†Calculation');
  assert.equal(result, expected);
});

test('ordered actions preserve same-line spacing and reject incomplete, unknown or extra operations', () => {
  const layout = { first: 'Notes.', boundaries: [
    { id: 1, gap: 'sentence', next: 'See [34] and' },
    { id: 2, gap: 'wrap', next: '4–8.' },
    { id: 3, gap: 'wrap', next: '†Footnote.' },
  ] };
  for (const actions of [['space', 'space', 'paragraph'], ['keep', 'space', 'paragraph']]) {
    assert.deepEqual(parseReflowCompletion(JSON.stringify({ actions }), layout, 'ordered-json'), { space: [2], join: [], paragraph: [3] });
  }
  for (const actions of [['keep'], ['space', 34, 'paragraph'], ['space', 'join', 'extra'], ['keep', 'space', 'paragraph', 'join']]) {
    assert.throws(() => parseReflowCompletion(JSON.stringify({ actions }), layout, 'ordered-json'), /指令无效/);
  }
  assert.deepEqual(parseReflowCompletion('keep space paragraph', layout, 'ordered-text'), { space: [2], join: [], paragraph: [3] });
  for (const reply of ['  ', 'keep space', 'keep space 34', 'keep space paragraph join']) {
    assert.throws(() => parseReflowCompletion(reply, layout, 'ordered-text'), /指令无效/);
  }
});

// Opt in explicitly so the normal test suite never spends API credit.
test('live deepseek-flash reflows English and Chinese without changing the wording', {
  skip: process.env.YIJIAN_LIVE_DEEPSEEK !== '1', timeout: 90000,
}, async () => {
  assert.ok(process.env.DEEPSEEK_API_KEY?.trim(), 'Set DEEPSEEK_API_KEY to run the live test.');
  const provider = { ...PROVIDERS.deepseek, type: 'deepseek', model: 'deepseek-flash', apiKey: process.env.DEEPSEEK_API_KEY };
  const signal = AbortSignal.timeout(80000);
  const source = 'The train arrived at the\nstation.  It was on time.\n\n这是一段从文档中复\n制的文字。';
  const result = await reflowSource(source, reflowRanges(source, 'text'), layout =>
    reflowWithProvider({ provider, model: provider.model, layout, signal }), signal);
  assert.match(result, /at the station\.  It was on time\./);
  assert.match(result, /从文档中复制的文字。/);
  assert.equal(result.replace(/\s/gu, ''), source.replace(/\s/gu, ''));
});

test('incomplete later batch or cancellation never returns a partial document', async () => {
  const source = 'alpha\n'.repeat(81);
  let count = 0;
  await assert.rejects(format(source, ({ boundaries }) => ++count === 1 ?
    { join: [], paragraph: [], space: boundaries.map(b => b.id) } : { rewritten: 'oops' }), /指令无效/);
  assert.equal(count, 3);
  const controller = new AbortController();
  await assert.rejects(format(source, () => {
    controller.abort();
    return { space: [], join: [], paragraph: [] };
  }, { signal: controller.signal }), { name: 'AbortError' });
});

test('preprocessing in the LAN build uses the gateway and validates its response too', async () => {
  const layout = { first: 'One', boundaries: [{ id: 1, gap: 'wrap', next: 'line.' }] };
  const options = { provider: { type: 'localai', apiKey: 'test-client-only' }, model: 'test', layout };
  const decisions = { space: [1], join: [], paragraph: [] };
  assert.deepEqual(await reflowWithProvider(options, async (url, init) => {
    assert.equal(url, './api/reflow');
    assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), { provider: { type: 'localai' }, model: 'test', layout });
    return Response.json(decisions);
  }), decisions);
  await assert.rejects(reflowWithProvider(options, async () => Response.json({ rewritten: 'wrong' })), /指令无效/);
  await assert.rejects(reflowWithProvider({ ...options, allowLocal: false }), /在线版/);
});
