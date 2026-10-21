import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfiles } from '../src/profiles.mjs';
const storage = () => { const values = new Map(); return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
const config = (apiKey = 'test-site-secret') => ({ type: 'custom', baseUrl: 'https://model.example/v1', model: 'a', apiKey });

test('features reference one site and select different models; key updates and clears propagate', () => {
  const saved = storage(), p = createProfiles(saved, '/app/', 'modelscope');
  const id = p.sites.save(null, config(), 'Work', ['a', 'b'], true);
  p.bind('global', id, 'a'); p.bind('translation', id, 'b'); p.bind('writing', id, 'a'); p.bind('declaudish', id, 'b');
  assert.equal(p.effective('translation').model, 'b');
  p.sites.save(id, config('updated-secret'), 'Work', ['a', 'b', 'c'], true);
  for (const scope of ['global', 'translation', 'writing', 'declaudish']) assert.equal(p.effective(scope).apiKey, 'updated-secret');
  const reloaded = createProfiles(saved, '/app/', 'modelscope');
  assert.equal(reloaded.effective('declaudish').model, 'b'); assert.equal(reloaded.effective('declaudish').apiKey, 'updated-secret');
  reloaded.setOverride('declaudish', true); assert.equal(reloaded.effective('declaudish').model, 'a');
  reloaded.setOverride('declaudish', false); assert.equal(reloaded.effective('declaudish').model, 'b');
  reloaded.clearKeys('writing');
  for (const scope of ['translation', 'writing', 'global', 'declaudish']) assert.equal(reloaded.effective(scope).apiKey, '');
  assert.equal(createProfiles(saved, '/app/', 'modelscope').effective('translation').apiKey, '');
});

test('memory credentials stay out of storage while site/model preferences survive reload', () => {
  const saved = storage(), p = createProfiles(saved, '/', 'modelscope');
  const id = p.sites.save(null, config(), 'Temporary', ['a', 'b'], false); p.bind('writing', id, 'b');
  assert.ok(!JSON.stringify([...saved.values.values()]).includes('test-site-secret'));
  assert.equal(p.effective('writing').apiKey, 'test-site-secret');
  const reloaded = createProfiles(saved, '/', 'modelscope');
  assert.equal(reloaded.effective('writing').model, 'b'); assert.equal(reloaded.effective('writing').apiKey, '');
  assert.equal(reloaded.sites.list()[0].apiKey, undefined);
});

test('multiple custom sites keep keys isolated and local sites need no key', () => {
  const p = createProfiles(storage(), '/', 'modelscope');
  const a = p.sites.save(null, config('a-secret'), 'A', ['a'], true);
  const b = p.sites.save(null, { ...config('b-secret'), baseUrl: 'https://other.example/v1' }, 'B', ['a'], true);
  p.bind('translation', a, 'a'); p.bind('writing', b, 'a');
  p.sites.clearKeys(a); assert.equal(p.effective('writing').apiKey, 'b-secret');
  const id = p.sites.save(null, { type: 'local', baseUrl: 'http://localhost:11434/v1', model: 'local' }, 'Local', ['local']);
  p.bind('declaudish', id, 'local'); assert.equal(p.effective('declaudish').apiKey, '');
});
