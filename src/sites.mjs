import { validateExternalProvider } from '../providers.mjs';
import { cleanModels, cleanModelTimes } from './model-catalog.mjs';

const copySite = site => ({ ...site, models: [...site.models], modelTimes: { ...site.modelTimes } });

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
        const models = cleanModels([config.model, ...(entry.models || [])]);
        sites.set(entry.id, { ...config, id: entry.id, label: String(entry.label || config.name).slice(0, 80), models, modelTimes: cleanModelTimes(models, entry.modelTimes), apiKey: entry.remember ? entry.apiKey || '' : '', remember: Boolean(entry.remember) });
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
    list: () => [...sites.values()].map(({ apiKey, ...metadata }) => copySite(metadata)),
    read: id => sites.has(id) ? copySite(sites.get(id)) : null,
    save(id, config, label, modelIds, remember = false, modelTimes) {
      const valid = validateExternalProvider(config);
      if (!id) id = crypto.randomUUID();
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('站点标识无效。');
      const models = cleanModels([valid.model, ...(modelIds || [])]);
      const site = { ...valid, id, label: String(label || valid.name).trim().slice(0, 80), models, modelTimes: cleanModelTimes(models, modelTimes), remember: Boolean(remember) };
      const next = new Map(sites); next.set(id, site); persist(next); sites.set(id, site);
      return id;
    },
    merge(entries, remember = false) {
      const next = new Map(sites);
      for (const entry of entries) {
        const old = sites.get(entry.id);
        const sameEndpoint = old?.type === entry.type && old?.baseUrl === entry.baseUrl;
        const apiKey = entry.apiKey === undefined ? (sameEndpoint ? old.apiKey : '') : entry.apiKey;
        const keep = entry.apiKey === undefined && sameEndpoint ? old.remember : Boolean(remember && apiKey);
        next.set(entry.id, { ...entry, apiKey, remember: keep });
      }
      if (next.size > 100) throw new Error('合并后超过 100 个服务商，请先删除不用的服务商。');
      persist(next); sites.clear(); for (const [id, site] of next) sites.set(id, site);
    },
    rename(id, label) {
      const site = sites.get(id);
      if (!site) throw new Error('请选择已保存的站点。');
      if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) throw new Error('请输入 1–80 个字符的站点名称。');
      const updated = { ...site, label: label.trim() };
      const next = new Map(sites); next.set(id, updated); persist(next); sites.set(id, updated);
    },
    remove(id) {
      if (!sites.has(id)) throw new Error('请选择已保存的站点。');
      const next = new Map(sites); next.delete(id); persist(next); sites.delete(id);
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
