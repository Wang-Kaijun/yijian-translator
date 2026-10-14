import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialStore } from '../src/credentials.mjs';
import { PROVIDERS } from '../providers.mjs';

function localStorageMock() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}
const config = type => ({ type, ...PROVIDERS[type], apiKey: `test-only-${type}` });

test('keys are memory-only by default and disappear on a new page instance', () => {
  const storage = localStorageMock(), store = createCredentialStore(storage, '/translator/');
  store.save(config('groq'), false);
  assert.equal(store.read('groq').apiKey, 'test-only-groq');
  assert.equal(storage.values.size, 0);
  assert.equal(createCredentialStore(storage, '/translator/').read('groq'), null);
});

test('opt-in persistence is isolated by provider and app path; clear removes all app keys', () => {
  const storage = localStorageMock(), store = createCredentialStore(storage, '/translator/');
  store.save(config('groq'), true); store.save(config('modelscope'), true);
  storage.setItem('unrelated-preference', 'keep');
  const reloaded = createCredentialStore(storage, '/translator/');
  assert.equal(reloaded.read('groq').apiKey, 'test-only-groq');
  assert.equal(reloaded.read('modelscope').apiKey, 'test-only-modelscope');
  assert.equal(createCredentialStore(storage, '/another-app/').read('groq'), null);
  reloaded.clear();
  assert.equal(reloaded.read('groq'), null);
  assert.equal(reloaded.read('modelscope'), null);
  assert.deepEqual([...storage.values.keys()], ['unrelated-preference']);
});

test('unchecking remember removes a previously persisted key', () => {
  const storage = localStorageMock(), store = createCredentialStore(storage);
  store.save(config('groq'), true); store.save(config('groq'), false);
  assert.equal(createCredentialStore(storage).read('groq'), null);
  assert.equal(store.read('groq').apiKey, 'test-only-groq');
});

test('tampered endpoint or provider identity never restores a preset credential', () => {
  const storage = localStorageMock();
  storage.setItem('yijian:v2:/:groq', JSON.stringify({ ...config('groq'), baseUrl: 'https://example.com' }));
  assert.equal(createCredentialStore(storage).read('groq'), null);
  storage.setItem('yijian:v2:/:groq', JSON.stringify(config('modelscope')));
  assert.equal(createCredentialStore(storage).read('groq'), null);
});

test('unavailable storage permits memory mode but never claims persistence succeeded', () => {
  const store = createCredentialStore(null);
  store.save(config('groq'), false);
  assert.throws(() => store.save(config('groq'), true), /不允许保存/);
});

 test('new provider credentials stay isolated, persist only with opt-in, and clear together', () => {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const store = createCredentialStore(storage);
  for (const type of ['openrouter', 'siliconflow', 'zhipu']) {
    store.save(config(type), false);
    assert.equal(createCredentialStore(storage).read(type), null);
    store.save(config(type), true);
    assert.equal(createCredentialStore(storage).read(type).apiKey, `test-only-${type}`);
  }
  store.clear();
  assert.equal(values.size, 0);
});
