import { exportConfig, parseConfig, webdavRequest, validateDavUrl, MAX_CONFIG_BYTES } from './config-transfer.mjs';
export function setupConfigTransfer({ profiles, onChange, isBusy }) {
  const $ = id => document.getElementById(id);
  let pending = null, controller = null, remoteVersion = null;
  const status = (text, error = false) => { $('transferStatus').textContent = text; $('transferStatus').classList.toggle('error', error); };
  const fail = e => status(e.message, true);
  const clearPreview = () => { pending = null; $('importPreview').hidden = true; $('importEntries').replaceChildren(); };
  function preview(config) {
    pending = config; $('uploadPreview').hidden = true;
    let added = 0, updated = 0, changed = 0;
    $('importEntries').replaceChildren(...config.sites.map(site => {
      const old = profiles.sites.read(site.id); old ? updated++ : added++;
      const endpointChanged = old && (old.baseUrl !== site.baseUrl || old.type !== site.type); if (endpointChanged) changed++;
      const li = document.createElement('li'); li.textContent = `${old ? '更新' : '新增'}：${site.label} · ${site.baseUrl}${endpointChanged ? '（地址变化，不沿用旧密钥）' : ''}`; return li;
    }));
    $('importSummary').textContent = `${added} 个新增，${updated} 个更新。未列出的服务商保留。${changed ? '请核对发生变化的接口地址。' : ''} ${config.sites.some(s => s.apiKey) ? '文件包含密钥，默认只在本页暂存。' : '文件不含有效密钥；同一地址沿用已有密钥，新地址需补充。'}`;
    $('importRemember').checked = false; $('importPreview').hidden = false;
    status('已读取，请确认下方导入预览。');
  }
  $('exportConfig').addEventListener('click', () => {
    try {
      const data = exportConfig(profiles, $('exportSecrets').checked), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'yijian-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('已导出已保存的配置。' + ($('exportSecrets').checked ? '文件包含明文密钥，请妥善保存。' : '文件不包含 API Key。'));
    } catch (e) { fail(e); }
  });
  $('importConfig').addEventListener('click', () => { if (!controller && !isBusy()) $('configFile').click(); });
  $('configFile').addEventListener('change', async () => {
    const file = $('configFile').files[0]; $('configFile').value = ''; clearPreview(); if (!file) return;
    try { if (file.size > MAX_CONFIG_BYTES) throw new Error('配置文件最大为 1 MB。'); preview(parseConfig(await file.text())); } catch (e) { fail(e); }
  });
  $('cancelImport').addEventListener('click', () => { clearPreview(); status('已取消导入。'); });
  $('confirmImport').addEventListener('click', () => {
    if (!pending || controller || isBusy()) return;
    try { profiles.importConfig(pending, { selections: $('importSelections').checked, remember: $('importRemember').checked }); clearPreview(); onChange(); status('配置已导入。未导入密钥的新服务商需要补充 API Key。'); } catch (e) { fail(e); }
  });
  const connection = () => ({ url: validateDavUrl($('davUrl').value.trim()), username: $('davUser').value, password: $('davPassword').value });
  for (const id of ['davUrl', 'davUser', 'davPassword']) $(id).addEventListener('input', () => { remoteVersion = null; $('uploadPreview').hidden = true; clearPreview(); });
  async function remote(method) {
    if (controller || isBusy()) return;
    const request = new AbortController(); controller = request;
    for (const id of ['davRead', 'davWrite', 'confirmUpload', 'importConfig', 'confirmImport', 'davUrl', 'davUser', 'davPassword', 'exportSecrets']) $(id).disabled = true;
    $('davCancel').hidden = false;
    try {
      const conn = connection();
      const result = await webdavRequest({ ...conn, method, signal: request.signal, ...(method === 'PUT' ? { data: exportConfig(profiles, $('exportSecrets').checked), etag: remoteVersion?.url === conn.url ? remoteVersion.etag : null } : {}) });
      remoteVersion = { url: conn.url, etag: result.etag };
      if (method === 'GET') {
        clearPreview();
        if (result.missing) status('远程文件尚不存在，可以上传创建；请确保目录已存在。');
        else { preview(result.config); if (!result.etag) status('已读取配置，可导入。服务器未公开 ETag，暂不允许上传覆盖；请配置响应头后重试。'); }
      } else { $('uploadPreview').hidden = true; clearPreview(); status('配置已上传。再次覆盖前建议重新读取远程版本。'); }
    } catch (e) { if (method === 'GET') { remoteVersion = null; clearPreview(); } fail(e); }
    finally { controller = null; for (const id of ['davRead', 'davWrite', 'confirmUpload', 'importConfig', 'confirmImport', 'davUrl', 'davUser', 'davPassword', 'exportSecrets']) $(id).disabled = false; $('davCancel').hidden = true; }
  }
  $('davRead').addEventListener('click', () => remote('GET'));
  $('davCancel').addEventListener('click', () => controller?.abort());
  $('davWrite').addEventListener('click', () => {
    try { const conn = connection(); if (!remoteVersion?.etag || remoteVersion.url !== conn.url) throw new Error('请先点击「从远程导入 / 更新」，读取远程版本或确认文件不存在。'); $('uploadPreview').hidden = false; } catch (e) { fail(e); }
  });
  $('confirmUpload').addEventListener('click', () => remote('PUT'));
  $('cancelUpload').addEventListener('click', () => { $('uploadPreview').hidden = true; });
}
