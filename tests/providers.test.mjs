import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExternalProvider, isPublicAddress, generationOptions } from '../providers.mjs';

test('provider presets use exact origins and explicit per-request credentials', () => {
  const result = validateExternalProvider({ type: 'deepseek', baseUrl: 'https://api.deepseek.com/chat/completions', apiKey: 'test-only-key' }, 'deepseek-flash');
  assert.equal(result.baseUrl, 'https://api.deepseek.com');
  assert.equal(result.apiKey, 'test-only-key');
  assert.throws(() => validateExternalProvider({ type: 'deepseek', baseUrl: 'https://example.com', apiKey: 'test' }, 'model'));
  assert.throws(() => validateExternalProvider({ type: 'deepseek', baseUrl: 'https://api.deepseek.com' }, 'model'));
});

test('custom API cannot target private services or put credentials into a URL', () => {
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://192.168.1.2', 'https://169.254.169.254', 'https://10.0.0.1', 'https://localhost', 'https://router.local', 'https://example.com?key=secret', 'https://user:secret@example.com']) {
    assert.throws(() => validateExternalProvider({ type: 'custom', baseUrl: url, apiKey: 'test' }, 'model'), url);
  }
  assert.equal(validateExternalProvider({ type: 'custom', baseUrl: 'https://example.com/v1/', apiKey: 'test' }, 'example-model').baseUrl, 'https://example.com/v1');
});

test('literal address validation rejects IPv4 and IPv6 internal destinations', () => {
  for (const address of ['127.0.0.1', '0.0.0.0', '10.1.1.1', '172.16.1.1', '172.31.1.1', '192.168.1.2', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::', '::1', 'fe80::1', 'fd00::1', '::ffff:7f00:1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('reasoning parameters respect provider and model differences', () => {
  assert.equal(generationOptions('localai', 'qwen').reasoning_effort, 'none');
  assert.equal(generationOptions('deepseek', 'deepseek-flash').thinking.type, 'disabled');
  assert.equal(generationOptions('zai', 'glm-5.3').thinking.type, 'enabled');
  assert.equal(generationOptions('zai', 'glm-5.3').reasoning_effort, 'low');
  assert.equal(generationOptions('zai', 'glm-5').thinking.type, 'disabled');
  assert.deepEqual(generationOptions('custom', 'anything'), { max_tokens: 8192 });
});
