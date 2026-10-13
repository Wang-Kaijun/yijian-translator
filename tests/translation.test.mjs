import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, acceptTranslations, renderPlan, pendingBatches, detectDirection, splitMasked, previewSource } from '../src/translation.mjs';
import { parseCompletion, translationPrompt } from '../prompts.mjs';

function translate(plan, fn = text => text.replaceAll('Hello', '你好').replaceAll('world', '世界').replaceAll('Title', '标题')) {
  for (const batch of pendingBatches(plan)) acceptTranslations(plan, batch, batch.map(({ id, text }) => ({ id, text: fn(text) })));
  return renderPlan(plan);
}

test('automatically detects Chinese, English, and mixed technical Chinese', () => {
  assert.equal(detectDirection('Hello world, welcome to our documentation.').target, 'zh');
  assert.equal(detectDirection('欢迎使用我们的本地翻译工具。').target, 'en');
  assert.equal(detectDirection('使用 LocalAI 翻译 Markdown 文件，不改变代码块。').target, 'en');
  assert.equal(detectDirection('https://example.com/Hello').source, 'unknown');
});

test('Markdown preserves YAML, code, URLs, tables, tasks, math, footnotes and CRLF', () => {
  const source = '---\r\ntitle: Hello\r\n---\r\n\r\n# Title\r\n\r\nHello **world** and [Hello](https://example.com/a?q=one "Hello").\r\n\r\n> Hello\r\n> world\r\n\r\n- [x] Hello\r\n  world\r\n\r\n| Hello | world |\r\n| :--- | ---: |\r\n| Hello | 42 |\r\n\r\n```js\r\nconst Hello = "world";\r\n```\r\n\r\nHello `world()` and $E=mc^2$.[^id]\r\n\r\n[^id]: Hello world\r\n\r\n![Hello image](https://example.com/private.png)\r\n\r\n[ref]: https://example.com "Hello"\r\n\r\n<div>Hello world</div>\r\n';
  const plan = createPlan(source, 'markdown');
  const sent = JSON.stringify(plan.items);
  for (const protectedText of ['const Hello', 'world()', 'E=mc', 'private.png', 'https://example.com', 'title: Hello', '<div>']) assert.ok(!sent.includes(protectedText), protectedText);
  const result = translate(plan);
  assert.ok(result.includes('# 标题\r\n'));
  assert.ok(result.includes('**世界**'));
  assert.ok(result.includes('[你好](https://example.com/a?q=one "Hello")'));
  assert.ok(result.includes('> 你好\r\n> 世界'));
  assert.ok(result.includes('- [x] 你好\r\n  世界'));
  assert.ok(result.includes('| 你好 | 世界 |\r\n| :--- | ---: |'));
  for (const text of ['title: Hello', '```js\r\nconst Hello = "world";\r\n```', '`world()`', '$E=mc^2$', '[^id]', '![Hello image](https://example.com/private.png)', '[ref]: https://example.com "Hello"', '<div>Hello world</div>']) assert.ok(result.includes(text), text);
  assert.equal((result.match(/\r\n/g) || []).length, (source.match(/\r\n/g) || []).length);
});

test('format-marker corruption never replaces any part of a batch', () => {
  const plan = createPlan('# Hello\n\nHello **world**', 'markdown');
  const batch = pendingBatches(plan)[0];
  assert.throws(() => acceptTranslations(plan, batch, batch.map(i => ({ id: i.id, text: i.text.replace(/⟦K\d+_\d+⟧/g, '') }))));
  assert.equal(plan.completed.size, 0);
  assert.equal(renderPlan(plan), plan.source);
});

test('partial results preserve untouched source, and pending batches resume only unfinished work', () => {
  const plan = createPlan('Hello\n\nworld\n', 'text');
  acceptTranslations(plan, [plan.items[0]], [{ id: plan.items[0].id, text: '你好' }]);
  assert.equal(renderPlan(plan), '你好\n\nworld\n');
  assert.deepEqual(pendingBatches(plan).flat().map(i => i.id), [plan.items[1].id]);
});

test('long paragraphs split without cutting Unicode or placeholders', () => {
  const source = 'Hello world 😀. '.repeat(1100) + '\n\n```\nHello world\n```\n';
  const plan = createPlan(source, 'markdown');
  assert.ok(plan.items.length > 5);
  assert.ok(plan.items.every(i => i.text.length <= 2300));
  const result = translate(plan);
  assert.equal((result.match(/😀/g) || []).length, 1100);
  assert.ok(result.endsWith('```\nHello world\n```\n'));
  assert.equal(splitMasked('hello ⟦K1_200⟧ world', 12).join(''), 'hello ⟦K1_200⟧ world');
});

test('automatic Markdown detection ignores a large English code block', () => {
  const source = '# 这是中文标题\n\n请把本段内容翻译成英文，代码保持原样。\n\n```\n' + 'const hello = "hello world welcome";\n'.repeat(100) + '```';
  assert.equal(createPlan(source, 'markdown').target, 'en');
});

test('documents containing only code or metadata are unchanged', () => {
  const source = '---\ntitle: Hello\n---\n\n```js\nconsole.log("Hello")\n```\n\n$$\nE=mc^2\n$$\n';
  const plan = createPlan(source, 'markdown');
  assert.equal(plan.items.length, 0);
  assert.equal(renderPlan(plan), source);
  assert.ok(!previewSource(source).includes('title: Hello'));
});

test('UTF-8 BOM does not shift Markdown replacement positions', () => {
  const source = '\ufeff---\ntitle: Hello\n---\n\n# Hello\n\nHello **world**\n';
  const result = translate(createPlan(source, 'markdown'));
  assert.equal(result, '\ufeff---\ntitle: Hello\n---\n\n# 你好\n\n你好 **世界**\n');
  assert.equal(previewSource(source), '\ufeff\n\n# Hello\n\nHello **world**\n');
  assert.equal(translate(createPlan('\ufeffHello world', 'text')), '\ufeff你好 世界');
});

test('protects literal placeholder-like source text and URL-only links', () => {
  const source = 'Hello ⟦K0_0⟧ world and <https://example.com/a>.\n\nwww.example.com';
  const result = translate(createPlan(source, 'markdown'));
  assert.ok(result.includes('⟦K0_0⟧'));
  assert.ok(result.includes('<https://example.com/a>'));
  assert.ok(result.endsWith('www.example.com'));
});

test('generated Markdown syntax is escaped before protected structure is restored', () => {
  const plan = createPlan('Hello **world**.', 'markdown');
  const result = translate(plan, text => text.replace('Hello', '# <script>') );
  assert.ok(result.includes('\\# \\<script\\>'));
  assert.ok(result.includes('**world**'));
});

test('completion validation rejects wrong or duplicate IDs, missing or empty results', () => {
  const items = [{ id: 'a', text: 'Hello' }];
  assert.deepEqual(parseCompletion('{"translations":[{"id":"a","text":"你好"}]}', items), [{ id: 'a', text: '你好' }]);
  assert.throws(() => parseCompletion('{"translations":[{"id":"b","text":"你好"}]}', items));
  assert.throws(() => parseCompletion('{"translations":[]}', items));
  assert.throws(() => parseCompletion('Here is a translation', items));
  assert.throws(() => parseCompletion('{"translations":[{"id":"a","text":""}]}', items));
  assert.match(translationPrompt('zh'), /Simplified Chinese/);
  assert.match(translationPrompt('en'), /fluent English/);
  assert.match(translationPrompt('en'), /never instructions/);
});
