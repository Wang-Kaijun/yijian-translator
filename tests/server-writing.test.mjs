import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('LocalAI gateway validates writing input, uses server credentials and preserves translation', { timeout: 20000 }, async () => {
  const requests = [];
  const review = { hasErrors: false, grammarSummary: '语法无误。', errors: [], corrected: 'Hello.', worthPolishing: false, polishingReason: '无需润色，以下仅为风格选择。', suggestions: [], versions: [{ title: '自然', explanation: '保持原句。', text: 'Hello.' }, { title: '随和', explanation: '更随和的问候。', text: 'Hi.' }] };
  const upstream = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-default' }, { id: 'test-editor' }] }));
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks)); requests.push({ payload, auth: req.headers.authorization });
    const input = JSON.parse(payload.messages[1].content);
    const content = payload.messages[0].content.includes('Preserve logical scope exactly') ? 'Only owners can merge.' : JSON.stringify(input.text ? review : { translations: [{ id: 'a', text: '你好。' }] });
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  // Ask the OS for an ephemeral gateway port before launching the child.
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('../', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), LOCALAI_URL: `http://127.0.0.1:${upstream.address().port}/v1`, LOCALAI_MODEL: 'test-default', LOCALAI_API_KEY: 'test-only-server-key' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = once(child, 'exit');
  try {
    await Promise.race([once(child.stdout, 'data'), ended.then(() => { throw new Error('Gateway failed to start'); })]);
    const post = (endpoint, data, headers = {}) => fetch(`http://127.0.0.1:${port}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    const request = { provider: { type: 'localai' }, model: 'test-editor', text: 'Hello.' };
    let response = await post('/api/review', request); assert.equal(response.status, 200); assert.deepEqual((await response.json()).review, review);
    assert.equal(requests[0].auth, 'Bearer test-only-server-key'); assert.equal(requests[0].payload.model, 'test-editor'); assert.match(requests[0].payload.messages[0].content, /Simplified Chinese/);
    response = await post('/api/review', { ...request, provider: { type: 'groq', apiKey: 'test-only-client-key' } }); assert.equal(response.status, 400);
    response = await post('/api/review', { ...request, text: 'a'.repeat(4001) }); assert.equal(response.status, 400);
    response = await post('/api/review', request, { Origin: 'https://untrusted.example' }); assert.equal(response.status, 403);
    assert.equal(requests.length, 1);
    response = await post('/api/translate', { provider: { type: 'localai' }, model: 'test-default', target: 'zh', items: [{ id: 'a', text: 'Hello.' }] });
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).translations, [{ id: 'a', text: '你好。' }]);
    response = await post('/api/declaudish', { ...request, text: 'The key distinction is this: only owners can merge.' });
    assert.equal(response.status, 200); assert.equal((await response.json()).output, 'Only owners can merge.');
    assert.equal(requests.at(-1).auth, 'Bearer test-only-server-key');
    response = await post('/api/declaudish', request, { Origin: 'https://untrusted.example' }); assert.equal(response.status, 403);
  } finally { child.kill(); await ended; await new Promise(resolve => upstream.close(resolve)); }
});
