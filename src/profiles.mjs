import { createCredentialStore } from './credentials.mjs';
import { PROVIDERS, validateExternalProvider } from '../providers.mjs';

export function createProfiles(storage, path, defaultType) {
  const scopes = ['global', 'translation', 'writing'];
  const stores = Object.fromEntries(scopes.map(scope => [scope, createCredentialStore(storage, scope === 'global' ? path : `${path}:${scope}`)]));
  const key = scope => scope === 'global' ? `yijian:provider:${path}` : `yijian:profile:${path}:${scope}`;
  const configs = {};
  function initial(scope, type) {
    if (type === 'localai') return { type, model: 'qwen3.8-flash-next-strata' };
    const credential = stores[scope].read(type);
    if (credential) return credential;
    // Model preferences may persist without opting in to credential storage.
    try {
      const saved = JSON.parse(storage?.getItem(`${key(scope)}:config`) || 'null');
      if (saved?.type === type) {
        const config = validateExternalProvider({ ...saved, apiKey: 'preference-validation-only' });
        return { ...config, apiKey: '' };
      }
    } catch {}
    return { type, baseUrl: PROVIDERS[type].baseUrl, model: PROVIDERS[type].model, apiKey: '' };
  }
  for (const scope of scopes) {
    let type;
    try { type = storage?.getItem(key(scope)); } catch {}
    if (!Object.hasOwn(PROVIDERS, type) && !(defaultType === 'localai' && type === 'localai')) type = scope === 'global' ? defaultType : null;
    configs[scope] = type ? initial(scope, type) : null;
    if (type === 'localai') {
      try { configs[scope].model = storage?.getItem(`${key(scope)}:model`) || configs[scope].model; } catch {}
    }
  }
  const overrides = {};
  const overrideKey = scope => `yijian:global-override:${path}:${scope}`;
  for (const scope of ['translation', 'writing']) {
    let legacyGlobal = false;
    try { legacyGlobal = Boolean(storage?.getItem(key('global'))); } catch {}
    overrides[scope] = !configs[scope] && legacyGlobal;
    try {
      const saved = storage?.getItem(overrideKey(scope));
      if (saved !== null && saved !== undefined) overrides[scope] = saved === 'true';
      storage?.setItem(overrideKey(scope), String(overrides[scope]));
    } catch {}
  }
  // Preserve each feature's configuration independently from its global override choice.
  for (const scope of ['translation', 'writing']) {
    if (!configs[scope]) {
      configs[scope] = { ...configs.global };
      try {
        if (configs[scope].apiKey) stores[scope].save(configs[scope], Boolean(configs[scope].remember));
        storage?.setItem(key(scope), configs[scope].type);
        storage?.setItem(`${key(scope)}:config`, JSON.stringify({ type: configs[scope].type, baseUrl: configs[scope].baseUrl, model: configs[scope].model }));
        if (configs[scope].type === 'localai') storage?.setItem(`${key(scope)}:model`, configs[scope].model);
      } catch {}
    }
  }
  return {
    own: scope => configs[scope],
    effective: scope => overrides[scope] ? configs.global : configs[scope],
    isOverridden: scope => Boolean(overrides[scope]),
    setOverride(scope, value) {
      if (!['translation', 'writing'].includes(scope)) throw new Error('只能为翻译或润色设置全局覆盖。');
      overrides[scope] = Boolean(value);
      try { storage?.setItem(overrideKey(scope), String(overrides[scope])); } catch {}
    },
    initial,
    save(scope, config, remember = false) {
      if (!config) throw new Error('请选择此功能使用的模型。');
      if (config && config.type !== 'localai') stores[scope].save(config, remember);
      configs[scope] = config ? { ...config, remember: Boolean(remember) } : null;
      try {
        if (config) {
          storage?.setItem(key(scope), config.type);
          storage?.setItem(`${key(scope)}:config`, JSON.stringify({ type: config.type, baseUrl: config.baseUrl, model: config.model }));
          if (config.type === 'localai') storage?.setItem(`${key(scope)}:model`, config.model);
        } else storage?.removeItem(key(scope));
      } catch {}
    },
    clearKeys(selectedScope) {
      // Clear every scope even if a storage operation fails for another one.
      let failure;
      for (const scope of selectedScope ? [selectedScope] : scopes) {
        if (configs[scope]) configs[scope] = { ...configs[scope], apiKey: '', remember: false };
        try { stores[scope].clear(); } catch (error) { failure = error; }
      }
      if (failure) throw failure;
    },
  };
}
