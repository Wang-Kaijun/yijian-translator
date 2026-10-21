import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfiles } from '../src/profiles.mjs';
import { createCredentialStore } from '../src/credentials.mjs';
import { PROVIDERS } from '../providers.mjs';
const storage = () => { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
const config = (model, apiKey = 'test-only-key') => ({ type: 'groq', baseUrl: PROVIDERS.groq.baseUrl, model, apiKey });

test('existing global settings migrate and inherited features follow later changes', () => {
  const saved = storage(); saved.setItem('yijian:provider:/app/', 'groq');
  createCredentialStore(saved, '/app/').save(config('legacy'), true);
  const profiles = createProfiles(saved, '/app/', 'modelscope');
  assert.equal(profiles.effective('translation').model, 'legacy'); assert.equal(profiles.effective('writing').model, 'legacy');
  profiles.save('global', config('new'));
  assert.equal(profiles.effective('writing').model, 'new'); assert.equal(profiles.effective('translation').model, 'new');
});

test('independent configurations isolate same-provider models and keys, and can return to global', () => {
  const saved = storage(), profiles = createProfiles(saved, '/', 'modelscope');
  profiles.save('global', config('global', 'global-test-key'), true);
  profiles.save('translation', config('translation', 'translation-test-key'), true);
  profiles.save('writing', config('writing', 'writing-test-key'), true);
  const restored = createProfiles(saved, '/', 'modelscope');
  for (const scope of ['global', 'translation', 'writing']) { assert.equal(restored.effective(scope).model, scope); assert.equal(restored.effective(scope).apiKey, `${scope}-test-key`); }
  restored.save('writing', null);
  assert.equal(restored.effective('writing').model, 'global'); assert.equal(restored.effective('translation').model, 'translation');
  assert.equal(createProfiles(saved, '/', 'modelscope').own('writing'), null);
});

test('memory-only keys disappear on reload and clear removes all scope credentials', () => {
  const saved = storage(), profiles = createProfiles(saved, '/', 'modelscope');
  profiles.save('writing', config('memory', 'memory-test-key'));
  assert.equal(createProfiles(saved, '/', 'modelscope').effective('writing').apiKey, '');
  assert.equal(createProfiles(saved, '/', 'modelscope').effective('writing').model, 'memory');
  profiles.save('global', config('global'), true); profiles.save('translation', config('translation'), true);
  profiles.clearKeys();
  for (const current of [profiles, createProfiles(saved, '/', 'modelscope')]) {
    for (const scope of ['global', 'translation', 'writing']) assert.equal(current.effective(scope).apiKey, '');
  }
});

test('LocalAI models persist per scope and Pages ignores local-only settings', () => {
  const saved = storage(), profiles = createProfiles(saved, '/', 'localai');
  profiles.save('writing', { type: 'localai', model: 'local-editor' });
  assert.equal(createProfiles(saved, '/', 'localai').effective('writing').model, 'local-editor');
  assert.equal(createProfiles(saved, '/', 'modelscope').effective('writing').type, 'modelscope');
});
