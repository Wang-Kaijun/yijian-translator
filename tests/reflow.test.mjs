import test from 'node:test';
import assert from 'node:assert/strict';
import { reflowSource, parseReflowCompletion, validateReflowInput } from '../reflow.mjs';
import { reflowWithProvider } from '../src/api.mjs';
import { reflowRanges, createPlan } from '../src/translation.mjs';

const paper = `Recurrent neural networks, long short-term memory [13] and gated recurrent [7] neural networks
in particular, have been firmly established as state of the art approaches in sequence modeling and
transduction problems such as language modeling and machine translation [35, 2, 5]. Numerous
efforts have since continued to push the boundaries of recurrent language models and encoder-decoder
architectures [38, 24, 15].
Recurrent models typically factor computation along the symbol positions of the input and output
sequences. Aligning the positions to steps in computation time, they generate a sequence of hidden
states ht, as a function of the previous hidden state ht−1 and the input for position t. This inherently
sequential nature precludes parallelization within training examples, which becomes critical at longer
sequence lengths, as memory constraints limit batching across examples. Recent work has achieved
significant improvements in computational efficiency through factorization tricks [21] and conditional
computation [32], while also improving model performance in case of the latter. The fundamental
constraint of sequential computation, however, remains.
Attention mechanisms have become an integral part of compelling sequence modeling and transduction
models in various tasks, allowing modeling of dependencies without regard to their distance in
the input or output sequences [2, 19]. In all but a few cases [27], however, such attention mechanisms
are used in conjunction with a recurrent network.
In this work we propose the Transformer, a model architecture eschewing recurrence and instead
relying entirely on an attention mechanism to draw global dependencies between input and output.
The Transformer allows for significantly more parallelization and can reach a new state of the art in
translation quality after being trained for as little as twelve hours on eight P100 GPUs.`;

const provider = { type: 'local', baseUrl: 'http://localhost:11434/v1', model: 'layout-test' };
function format(source, decide, { mode = 'text', signal = new AbortController().signal } = {}) {
  return reflowSource(source, reflowRanges(source, mode), layout => reflowWithProvider({
    provider, model: provider.model, layout, signal,
  }, async (url, options) => {
    assert.equal(url, provider.baseUrl + '/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, provider.model);
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input, layout);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(decide(input)) } }] });
  }), signal);
}

test('PDF example becomes four translation paragraphs with all wording, references and symbols intact', async () => {
  const text = await format(paper, ({ boundaries }) => {
    const actions = { join: [], space: [], paragraph: [] };
    for (const { id, gap, next } of boundaries) {
      if (/^(Recurrent models typically|Attention mechanisms have|In this work we propose)/.test(next)) actions.paragraph.push(id);
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

test('reject prose, invalid decisions, conflicting IDs, and edits inside an existing line', () => {
  const layout = { first: 'A.', boundaries: [{ id: 1, gap: 'sentence', next: 'B' }] };
  for (const invalid of ['rewritten', 'null', '{}', '{"space":[],"join":[],"paragraph":[],"text":"replacement"}',
    '{"space":[1],"join":[],"paragraph":[]}', '{"space":[],"join":[],"paragraph":[1,1]}',
    '{"space":[],"join":[],"paragraph":[2]}', '{"space":[],"join":[],"paragraph":["1"]}']) {
    assert.throws(() => parseReflowCompletion(invalid, layout), /指令无效/);
  }
  assert.throws(() => validateReflowInput({ ...layout, boundaries: [] }), /分段无效/);
  assert.throws(() => validateReflowInput({ ...layout, first: 'x'.repeat(5000) }), /分段无效/);
});

test('incomplete later batch or cancellation never returns a partial document', async () => {
  const source = 'alpha\n'.repeat(81);
  let count = 0;
  await assert.rejects(format(source, ({ boundaries }) => ++count === 2 ? { rewritten: 'oops' } :
    { join: [], paragraph: [], space: boundaries.map(b => b.id) }), /指令无效/);
  assert.equal(count, 2);
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
