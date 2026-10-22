import { parseConfig } from './config-transfer.mjs';
import { createCredentialStore } from './credentials.mjs';
import { PROVIDERS, validateExternalProvider } from '../providers.mjs';
import { createSiteLibrary } from './sites.mjs';

export function createProfiles(storage, path, defaultType) {
  const scopes = ['global', 'translation', 'writing', 'declaudish'];
  const features = scopes.filter(scope => scope !== 'global');
  const sites = createSiteLibrary(storage, path);
  const bindings = {};
  const bindingKey = scope => `yijian:site-binding:${path}:${scope}`;
  for (const scope of scopes) {
    try {
      const saved = JSON.parse(storage?.getItem(bindingKey(scope)) || 'null');
      if (typeof saved?.siteId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(saved.siteId) && typeof saved.model === 'string' && saved.model.length <= 200 && !/[\r\n]/.test(saved.model)) bindings[scope] = saved;
    } catch {}
  }
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
  for (const scope of features) {
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
  for (const scope of features) {
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
  const own = scope => {
    const binding = bindings[scope], site = binding && sites.read(binding.siteId);
    return site ? { ...site, model: binding.model || site.model } : binding ? { type: 'custom', baseUrl: '', model: '', apiKey: '', label: '站点已删除，请重新选择' } : configs[scope];
  };
  return {
    sites,
    importConfig(input, { selections = true, remember = false } = {}) {
      const data = parseConfig(JSON.stringify(input));
      const changes = selections ? Object.entries(data.selections) : [];
      const previous = new Map();
      try {
        for (const [scope, value] of changes) {
          for (const [k, v] of [[bindingKey(scope), JSON.stringify({ siteId: value.siteId, model: value.model })], ...(scope === 'global' ? [] : [[overrideKey(scope), String(value.useGlobal)]])]) {
            previous.set(k, storage?.getItem(k)); storage?.setItem(k, v);
          }
        }
        sites.merge(data.sites, remember);
      } catch (e) {
        for (const [k, v] of previous) { try { if (v == null) storage?.removeItem(k); else storage?.setItem(k, v); } catch {} }
        throw e;
      }
      for (const [scope, value] of changes) {
        bindings[scope] = { siteId: value.siteId, model: value.model };
        if (scope !== 'global') overrides[scope] = value.useGlobal;
      }
    },
    binding: scope => bindings[scope] ? { ...bindings[scope] } : null,
    bind(scope, siteId, model) {
      const site = sites.read(siteId);
      if (!scopes.includes(scope) || !site) throw new Error('请先在全局模型中保存站点。');
      if (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\r\n]/.test(model)) throw new Error('请选择有效的模型。');
      bindings[scope] = { siteId, model: model.trim() };
      try { storage?.setItem(bindingKey(scope), JSON.stringify(bindings[scope])); } catch {}
    },
    own,
    effective: scope => own(overrides[scope] ? 'global' : scope),
    isOverridden: scope => Boolean(overrides[scope]),
    setOverride(scope, value) {
      if (!features.includes(scope)) throw new Error('只能为功能设置全局覆盖。');
      overrides[scope] = Boolean(value);
      try { storage?.setItem(overrideKey(scope), String(overrides[scope])); } catch {}
    },
    initial,
    save(scope, config, remember = false) {
      if (!config) throw new Error('请选择此功能使用的模型。');
      if (config && config.type !== 'localai') stores[scope].save(config, remember);
      delete bindings[scope];
      try { storage?.removeItem(bindingKey(scope)); } catch {}
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
      try { sites.clearKeys(selectedScope ? bindings[selectedScope]?.siteId || '__none__' : undefined); } catch (error) { failure = error; }
      for (const scope of selectedScope ? [selectedScope] : scopes) {
        if (configs[scope]) configs[scope] = { ...configs[scope], apiKey: '', remember: false };
        try { stores[scope].clear(); } catch (error) { failure = error; }
      }
      if (failure) throw failure;
    },
  };
}
