import { PROVIDERS, validateExternalProvider } from '../providers.mjs';

// Memory by default; persistent storage requires an explicit checkbox for each provider.
// A path namespace prevents accidental reuse by sibling GitHub Pages projects, not same-origin scripts.
export function createCredentialStore(storage, path = '/') {
  const prefix = `yijian:v2:${path}:`;
  const memory = new Map();
  function read(type) {
    if (!Object.hasOwn(PROVIDERS, type)) return null;
    if (memory.has(type)) return { ...memory.get(type) };
    try {
      const saved = JSON.parse(storage?.getItem(prefix + type) || 'null');
      if (!saved || saved.type !== type) return null;
      const config = { ...validateExternalProvider(saved), remember: true };
      memory.set(type, config);
      return { ...config };
    } catch { return null; }
  }
  function save(config, remember) {
    const validated = validateExternalProvider(config);
    if (remember) {
      if (!storage) throw new Error('此浏览器不允许保存密钥，请取消“记住到此浏览器”。');
      try { storage.setItem(prefix + config.type, JSON.stringify(validated)); }
      catch { throw new Error('无法保存密钥，请取消“记住到此浏览器”后重试。'); }
    } else {
      try { storage?.removeItem(prefix + config.type); }
      catch { throw new Error('无法清除已保存的密钥，请在浏览器网站设置中清除本站数据。'); }
    }
    memory.set(config.type, { ...validated, remember: Boolean(remember) });
  }
  function clear() {
    memory.clear();
    try { for (const type of Object.keys(PROVIDERS)) storage?.removeItem(prefix + type); }
    catch { throw new Error('无法清除浏览器存储，请在浏览器网站设置中清除本站数据。'); }
  }
  return { read, save, clear };
}
