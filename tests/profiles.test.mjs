import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfiles } from '../src/profiles.mjs';
import { createCredentialStore } from '../src/credentials.mjs';
import { PROVIDERS } from '../providers.mjs';
const storage = () => { const map = new Map(); return { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; };
const config = (model, apiKey = 'test-only-key') => ({ type: 'groq', baseUrl: PROVIDERS.groq.baseUrl, model, apiKey });

test('legacy inherited settings preserve per-feature global choices', () => {
  const saved = storage(); saved.setItem('yijian:provider:/app/', 'groq');
  createCredentialStore(saved, '/app/').save(config('legacy'), true);
  const profiles = createProfiles(saved, '/app/', 'modelscope');
  assert.equal(profiles.effective('translation').model, 'legacy'); assert.equal(profiles.effective('writing').model, 'legacy');
  profiles.save('global', config('new'));
  assert.equal(profiles.isOverridden('writing'), true); assert.equal(profiles.isOverridden('translation'), true);
  assert.equal(profiles.effective('writing').model, 'new'); assert.equal(profiles.effective('translation').model, 'new');
  profiles.setOverride('writing', false);
  assert.equal(profiles.effective('writing').model, 'legacy');
  assert.equal(profiles.effective('translation').model, 'new');
  assert.equal(createProfiles(saved, '/app/', 'modelscope').own('writing').model, 'legacy');
});

test('each feature independently selects global settings and restores its own model and key', () => {
  const saved = storage(), profiles = createProfiles(saved, '/', 'modelscope');
  profiles.save('global', config('global', 'global-test-key'), true);
  profiles.save('translation', config('translation', 'translation-test-key'), true);
  profiles.save('writing', config('writing', 'writing-test-key'), true);
  const restored = createProfiles(saved, '/', 'modelscope');
  for (const scope of ['global', 'translation', 'writing']) { assert.equal(restored.effective(scope).model, scope); assert.equal(restored.effective(scope).apiKey, `${scope}-test-key`); }
  restored.setOverride('writing', true);
  assert.equal(restored.effective('writing').model, 'global'); assert.equal(restored.effective('translation').model, 'translation');
  assert.equal(createProfiles(saved, '/', 'modelscope').isOverridden('writing'), true);
  assert.equal(createProfiles(saved, '/', 'modelscope').isOverridden('translation'), false);
  restored.save('writing', config('changed-writing', 'changed-writing-key'), true);
  assert.equal(restored.effective('writing').model, 'global');
  restored.setOverride('writing', false);
  assert.equal(restored.effective('writing').model, 'changed-writing'); assert.equal(restored.effective('translation').model, 'translation');
  assert.equal(restored.effective('writing').apiKey, 'changed-writing-key');
  assert.equal(createProfiles(saved, '/', 'modelscope').isOverridden('writing'), false);
  restored.setOverride('translation', true);
  assert.equal(restored.effective('translation').model, 'global');
  assert.equal(restored.effective('writing').model, 'changed-writing');
  restored.setOverride('writing', true);
  assert.equal(restored.effective('writing').model, 'global');
  assert.equal(restored.effective('translation').model, 'global');
});

test('clearing one feature does not clear another feature or global credentials', () => {
  const saved = storage(), profiles = createProfiles(saved, '/', 'modelscope');
  for (const scope of ['global', 'translation', 'writing']) profiles.save(scope, config(scope, scope + '-test-key'), true);
  profiles.clearKeys('writing');
  for (const current of [profiles, createProfiles(saved, '/', 'modelscope')]) {
    assert.equal(current.own('writing').apiKey, '');
    assert.equal(current.own('translation').apiKey, 'translation-test-key');
    assert.equal(current.own('global').apiKey, 'global-test-key');
  }
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

test('new regional workspace follows an existing global site without changing older feature choices', () => {
  const saved = storage(), previous = createProfiles(saved, '/', 'modelscope');
  const site = previous.sites.save(null, config('shared', 'shared-test-key'), 'Shared', ['shared'], true);
  previous.bind('global', site, 'shared');
  previous.setOverride('translation', false);
  // Simulate storage written by the version before the regional workspace existed.
  for (const key of ['yijian:profile:/:regional', 'yijian:profile:/:regional:config', 'yijian:global-override:/:regional']) saved.removeItem(key);
  const profiles = createProfiles(saved, '/', 'modelscope');
  assert.equal(profiles.isOverridden('regional'), true);
  assert.equal(profiles.effective('regional').model, 'shared');
  assert.equal(profiles.effective('regional').apiKey, 'shared-test-key');
  assert.equal(profiles.isOverridden('translation'), false);
  profiles.save('regional', config('regional', 'regional-test-key'), true);
  profiles.setOverride('regional', false);
  const restored = createProfiles(saved, '/', 'modelscope');
  assert.equal(restored.effective('regional').model, 'regional');
  assert.equal(restored.effective('regional').apiKey, 'regional-test-key');
  restored.setOverride('regional', true);
  assert.equal(restored.effective('regional').model, 'shared');
  restored.setOverride('regional', false);
  assert.equal(restored.effective('regional').model, 'regional');
  restored.clearKeys('regional');
  assert.equal(createProfiles(saved, '/', 'modelscope').own('regional').apiKey, '');
  assert.equal(restored.own('global').apiKey, 'shared-test-key');
});

test('regional shared-site credentials clear and deleted bindings stay invalid after reload', () => {
  const saved = storage(), profiles = createProfiles(saved, '/', 'modelscope');
  const regional = profiles.sites.save(null, config('regional', 'regional-site-key'), 'Regional', ['regional'], true);
  const other = profiles.sites.save(null, config('other', 'other-site-key'), 'Other', ['other'], true);
  profiles.bind('regional', regional, 'regional');
  profiles.bind('writing', regional, 'regional');
  profiles.bind('translation', other, 'other');
  profiles.clearKeys('regional');
  for (const scope of ['regional', 'writing']) assert.equal(profiles.effective(scope).apiKey, '');
  assert.equal(profiles.effective('translation').apiKey, 'other-site-key');
  profiles.sites.remove(regional);
  for (const current of [profiles, createProfiles(saved, '/', 'modelscope')]) {
    assert.equal(current.effective('regional').baseUrl, '');
    assert.equal(current.effective('regional').model, '');
    assert.equal(current.effective('regional').apiKey, '');
    assert.equal(current.effective('translation').apiKey, 'other-site-key');
  }
});
