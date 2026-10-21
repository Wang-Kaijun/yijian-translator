import { validateExternalProvider } from '../providers.mjs';

export function cleanModels(models = []) {
  return [...new Set(models.filter(v => typeof v === 'string' && v.trim() && v.length <= 200 && !/[\r\n]/.test(v)).map(v => v.trim()))].slice(0, 500);
}

// One credential per saved site. Features store references, never copies of its key.
export function createSiteLibrary(storage, path) {
  const key = `yijian:sites:v1:${path}`;
  const sites = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(key) || '[]');
    for (const entry of Array.isArray(saved) ? saved.slice(0, 100) : []) {
      try {
        if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id)) continue;
        const config = validateExternalProvider({ ...entry, apiKey: entry.apiKey || 'validation-only' });
        sites.set(entry.id, { ...config, id: entry.id, label: String(entry.label || config.name).slice(0, 80), models: cleanModels([config.model, ...(entry.models || [])]), apiKey: entry.remember ? entry.apiKey || '' : '', remember: Boolean(entry.remember) });
      } catch { /* Ignore invalid stored endpoints and secrets. */ }
    }
  } catch { /* Private browsing may disable storage. */ }
  function persist(next) {
    const entries = [...next.values()].map(site => ({ ...site, apiKey: site.remember ? site.apiKey : '' }));
    try {
      if (!storage && entries.some(site => site.remember)) throw new Error();
      storage?.setItem(key, JSON.stringify(entries));
    } catch { throw new Error('无法保存站点设置，请检查浏览器存储权限。'); }
  }
  return {
    list: () => [...sites.values()].map(({ apiKey, ...metadata }) => ({ ...metadata, models: [...metadata.models] })),
    read: id => sites.has(id) ? { ...sites.get(id), models: [...sites.get(id).models] } : null,
    save(id, config, label, models, remember = false) {
      const valid = validateExternalProvider(config);
      if (!id) id = crypto.randomUUID();
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('站点标识无效。');
      const site = { ...valid, id, label: String(label || valid.name).trim().slice(0, 80), models: cleanModels([valid.model, ...(models || [])]), remember: Boolean(remember) };
      const next = new Map(sites); next.set(id, site); persist(next); sites.set(id, site);
      return id;
    },
    clearKeys(id) {
      const next = new Map(sites);
      for (const [key, site] of next) if (!id || key === id) next.set(key, { ...site, apiKey: '', remember: false });
      // Remove in-memory secrets even if browser persistence fails.
      sites.clear(); for (const [key, site] of next) sites.set(key, site);
      persist(next);
    },
  };
}
