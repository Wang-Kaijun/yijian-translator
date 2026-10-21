import { PROVIDERS as presets, validateExternalProvider, isLocalProvider } from '../providers.mjs';
import { translateWithProvider, fetchModels } from './api.mjs';
import { cleanModels } from './sites.mjs';

export function setupModelSettings({ profiles, staticApp, isBusy, onChange, onWorkspace, toast }) {
  const $ = id => document.getElementById(id);
  const names = { translation: '翻译', writing: '语法与润色', declaudish: 'De-Claudish', global: '全局' };
  let scope = 'translation', controller = null, workspace = 'translation';
  const option = (value, text) => { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; };
  const models = (id, values) => $(id).replaceChildren(...cleanModels(values).map(value => option(value, value)));
  const error = e => { $('settingsStatus').textContent = e.message; $('settingsStatus').classList.add('error'); };

  function refresh() {
    for (const [feature, label, model] of [['translation', 'engineLabel', 'modelName'], ['writing', 'writingEngine', 'writingModelName'], ['declaudish', 'declaudishEngine', 'declaudishModelName']]) {
      const config = profiles.effective(feature);
      $(label).textContent = (profiles.isOverridden(feature) ? '使用全局模型' : '本功能模型') + ' · ' + (config.label || presets[config.type]?.name || 'LocalAI');
      $(model).textContent = config.model || '请设置模型';
    }
    const destination = c => c.type === 'localai' ? 'LocalAI（局域网）' : c.baseUrl ? new URL(c.baseUrl).hostname : '所选接口';
    $('privacyDestination').textContent = '待译文本仅发送至 ' + destination(profiles.effective('translation'));
    $('writingDestination').textContent = '待检查英文仅发送至 ' + destination(profiles.effective('writing')) + '。本应用不保存英文内容或检查结果。';
    $('globalUsage').textContent = ['translation', 'writing', 'declaudish'].map(s => names[s] + '：' + (profiles.isOverridden(s) ? '使用全局模型' : '独立选择模型')).join('；');
    onChange();
  }
  function syncBusy() {
    const locked = isBusy() || Boolean(controller);
    for (const id of ['settings', 'writingSettings', 'declaudishSettings', 'deployLocalModel']) $(id).disabled = locked;
    for (const el of $('settingsForm').querySelectorAll('input, select, textarea, button')) {
      if (!['closeSettings', 'cancelSettings'].includes(el.id)) el.disabled = locked;
    }
  }
  function endpointHint() {
    const type = $('providerType').value;
    const local = isLocalProvider({ type, baseUrl: $('externalUrl').value });
    $('externalKey').placeholder = local ? '未启用鉴权可留空' : '粘贴此站点的 API Key';
    const hint = local ? '已识别为本机 / 局域网接口，支持 HTTP，未启用鉴权可留空密钥。服务需允许本站来源；按浏览器提示允许本地网络访问。' : ['local', 'custom'].includes(type) ? '本机或局域网支持 HTTP，例如 http://127.0.0.1:11434/v1 或 http://192.168.1.100:8080/v1；公网接口使用 HTTPS。' : presets[type]?.hint || (type === 'zai' ? '部分接口可能不允许浏览器跨域访问，请通过测试确认。' : '');
    $('providerHint').hidden = !hint; $('providerHint').textContent = hint;
    return local;
  }
  function fields(config) {
    const type = config.type;
    $('providerType').value = type;
    $('externalFields').hidden = type === 'localai';
    $('localSettingsNote').hidden = type !== 'localai'; $('localModelField').hidden = type !== 'localai';
    $('localSettingsModel').value = type === 'localai' ? config.model : '';
    $('externalUrl').value = config.baseUrl || ''; $('externalUrl').readOnly = !['local', 'custom'].includes(type);
    $('externalModel').value = config.model || ''; $('externalKey').value = config.apiKey || '';
    $('externalKey').type = 'password'; $('showKey').textContent = '显示';
    $('rememberKey').checked = Boolean(config.remember);
    endpointHint();
    $('getKey').hidden = !presets[type]?.keyUrl;
    if (presets[type]?.keyUrl) $('getKey').href = presets[type].keyUrl;
    const list = config.models || presets[type]?.models || [];
    $('siteModels').value = cleanModels([config.model, ...list]).join('\n'); models('modelSuggestions', list);
  }
  function selectSite() {
    const selected = $('savedSite').value;
    const site = profiles.sites.read(selected);
    const linked = scope !== 'global' && Boolean(site);
    $('linkedSiteFields').hidden = !linked; $('siteEditor').hidden = linked;
    $('siteNameField').hidden = scope !== 'global'; $('siteModelsField').hidden = scope !== 'global';
    if (linked) {
      const binding = profiles.binding(scope);
      $('linkedModel').value = binding?.siteId === selected ? binding.model : site.model;
      models('linkedModels', site.models);
      $('linkedSiteSummary').textContent = `${site.baseUrl} · ${site.apiKey ? '已配置共享密钥' : isLocalProvider(site) ? '未设置密钥（无鉴权服务可用）' : '需要在全局模型页补充密钥'}。此处只选择模型，修改站点会同步到所有引用它的功能。`;
    } else {
      const config = site || (selected === '__new' ? { type: 'modelscope', ...presets.modelscope, apiKey: '' } : profiles.own(scope));
      fields(config); $('siteName').value = site?.label || '';
    }
    $('settingsStatus').textContent = ''; $('settingsStatus').classList.remove('error');
  }
  function syncOverride() {
    const inherited = scope !== 'global' && $('featureOverride').checked;
    $('featureOverrideControl').hidden = scope === 'global'; $('profileFields').hidden = inherited;
    $('effectiveGlobalSummary').hidden = !inherited;
    const config = profiles.own('global');
    $('effectiveGlobalSummary').textContent = `当前全局模型：${config.label || presets[config.type]?.name || 'LocalAI'} · ${config.model || '尚未配置'}。`;
  }
  function load(next) {
    scope = next; $('settingsTitle').textContent = names[scope] + '模型配置';
    $('savedSite').replaceChildren(option('__legacy', scope === 'global' ? '当前配置（保存为站点）' : '当前独立配置'), ...profiles.sites.list().map(site => option(site.id, site.label)));
    if (scope === 'global') $('savedSite').append(option('__new', '＋ 添加站点'));
    $('savedSite').value = profiles.binding(scope)?.siteId || '__legacy';
    $('savedSiteHint').textContent = scope === 'global' ? '添加并保存多个站点；此处应用的模型同时成为全局默认模型。' : '选择全局已保存的站点即可复用地址、模型列表和密钥。';
    $('clearKeys').textContent = '清除此站点的密钥';
    $('featureOverride').checked = profiles.isOverridden(scope);
    selectSite(); syncOverride(); syncBusy();
  }
  function close() { controller?.abort(); $('settingsDialog').close(); $('externalKey').value = ''; }
  function switchWorkspace(next, focus = false) {
    if (!Object.hasOwn(names, next)) return;
    controller?.abort(); workspace = next; onWorkspace(next);
    for (const tab of document.querySelectorAll('[data-workspace]')) {
      const selected = tab.dataset.workspace === next;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    }
    if (next === 'global') { $('globalFormHost').append($('settingsForm')); load('global'); }
    else if ($('globalFormHost').contains($('settingsForm'))) { $('externalKey').value = ''; $('settingsDialog').append($('settingsForm')); }
    syncBusy();
  }
  function open(feature = 'translation') {
    if (isBusy() || controller) return;
    $('settingsDialog').append($('settingsForm')); load(feature); $('settingsDialog').showModal();
  }
  function openEffective(feature) {
    if (profiles.isOverridden(feature) || profiles.binding(feature)) {
      const binding = profiles.binding(profiles.isOverridden(feature) ? 'global' : feature);
      switchWorkspace('global');
      if (binding) { $('savedSite').value = binding.siteId; selectSite(); }
    }
    else open(feature);
  }
  function read(listOnly = false) {
    const site = scope !== 'global' && profiles.sites.read($('savedSite').value);
    if (site) return validateExternalProvider({ ...site, model: $('linkedModel').value });
    const type = $('providerType').value;
    if (type === 'localai' && !staticApp) {
      const model = $('localSettingsModel').value.trim();
      if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error('请填写有效的 LocalAI 模型 ID。');
      return { type, model };
    }
    return validateExternalProvider({ type, baseUrl: $('externalUrl').value.trim(), model: $('externalModel').value || (listOnly ? 'model-list' : ''), apiKey: $('externalKey').value });
  }
  for (const tab of document.querySelectorAll('[data-workspace]')) {
    tab.addEventListener('click', () => switchWorkspace(tab.dataset.workspace));
    tab.addEventListener('keydown', event => {
      const tabs = [...document.querySelectorAll('[data-workspace]')]; let index = tabs.indexOf(tab);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0; else if (event.key === 'End') index = tabs.length - 1; else return;
      event.preventDefault(); switchWorkspace(tabs[index].dataset.workspace, true);
    });
  }
  $('settings').addEventListener('click', () => open('translation'));
  $('closeSettings').addEventListener('click', close); $('cancelSettings').addEventListener('click', close);
  $('settingsDialog').addEventListener('close', () => {
    controller?.abort();
    // A manage-sites action may already have moved and loaded the shared form.
    if ($('settingsDialog').contains($('settingsForm'))) {
      $('externalKey').value = ''; $('externalKey').type = 'password';
      if (workspace === 'global') { $('globalFormHost').append($('settingsForm')); load('global'); }
    }
  });
  $('featureOverride').addEventListener('change', syncOverride);
  $('savedSite').addEventListener('change', selectSite);
  $('providerType').addEventListener('change', () => {
    const type = $('providerType').value;
    fields(type === 'localai' ? { type, model: profiles.initial(scope, type).model } : { type, ...presets[type], apiKey: '' });
  });
  $('externalUrl').addEventListener('input', () => {
    $('externalKey').value = ''; $('rememberKey').checked = false; $('siteModels').value = ''; models('modelSuggestions', []);
    const local = endpointHint();
    $('settingsStatus').textContent = local ? '地址已更改；无鉴权服务可直接获取模型列表，需要鉴权时请填写此地址的密钥。' : '地址已更改；请填写此地址的密钥并重新获取模型列表。';
  });
  $('siteModels').addEventListener('input', () => models('modelSuggestions', $('siteModels').value.split('\n')));
  $('showKey').addEventListener('click', () => { const show = $('externalKey').type === 'password'; $('externalKey').type = show ? 'text' : 'password'; $('showKey').textContent = show ? '隐藏' : '显示'; });
  $('manageSites').addEventListener('click', () => {
    const id = $('savedSite').value; close(); switchWorkspace('global');
    if (profiles.sites.read(id)) { $('savedSite').value = id; selectSite(); }
  });
  $('clearKeys').addEventListener('click', () => {
    try {
      if (profiles.sites.read($('savedSite').value)) profiles.sites.clearKeys($('savedSite').value);
      else profiles.clearKeys(scope);
      $('externalKey').value = ''; $('rememberKey').checked = false; refresh();
      $('settingsStatus').textContent = '密钥已清除。选用此站点的功能均需重新配置密钥后使用。';
    } catch (e) { refresh(); error(e); }
  });
  $('applySettings').addEventListener('click', () => {
    if (isBusy() || controller) return;
    try {
      const inherited = scope !== 'global' && $('featureOverride').checked;
      if (!inherited) {
        if (scope !== 'global' && profiles.sites.read($('savedSite').value)) profiles.bind(scope, $('savedSite').value, $('linkedModel').value);
        else {
          const config = read();
          if (scope === 'global' && config.type !== 'localai') {
            const id = profiles.sites.save(profiles.sites.read($('savedSite').value)?.id, config, $('siteName').value, $('siteModels').value.split('\n'), $('rememberKey').checked);
            profiles.bind('global', id, config.model);
          } else profiles.save(scope, config, $('rememberKey').checked);
        }
      }
      if (scope !== 'global') profiles.setOverride(scope, inherited);
      const savedScope = scope; refresh();
      if ($('settingsDialog').open) close(); else load('global');
      $('settingsStatus').classList.remove('error');
      $('settingsStatus').textContent = '设置已保存。站点密钥由引用它的功能共享；全局模型只覆盖已开启开关的功能。';
      toast(`已保存${names[savedScope]}模型设置`);
    } catch (e) { error(e); }
  });
  async function test(listOnly) {
    if (isBusy() || controller) return;
    const request = new AbortController();
    try {
      const config = read(listOnly); controller = request; syncBusy();
      $('settingsStatus').classList.remove('error'); $('settingsStatus').textContent = listOnly ? '正在获取此站点的模型列表…' : '正在用固定示例测试接口…';
      if (listOnly) {
        const ids = await fetchModels(config, request.signal);
        if (request.signal.aborted) return;
        $('siteModels').value = ids.join('\n'); models('modelSuggestions', ids);
        if (!$('externalModel').value) $('externalModel').value = ids[0];
        $('settingsStatus').textContent = `已读取 ${ids.length} 个模型，点击应用设置保存。`;
      } else {
        await translateWithProvider({ provider: config, model: config.model, target: 'zh', items: [{ id: 'test', text: 'Hello.' }], signal: request.signal, allowLocal: !staticApp });
        if (!request.signal.aborted) $('settingsStatus').textContent = '接口可用，示例翻译验证通过。';
      }
    } catch (e) { if (!request.signal.aborted) error(e); }
    finally { if (controller === request) controller = null; syncBusy(); }
  }
  $('testProvider').addEventListener('click', () => test(false)); $('fetchModels').addEventListener('click', () => test(true));
  $('deployLocalModel').addEventListener('click', () => {
    switchWorkspace('global'); $('savedSite').value = '__new'; selectSite();
    fields({ type: 'local', ...presets.local, apiKey: '' }); $('siteName').value = '本地 Ollama';
    $('localModelGuide').open = true; $('externalUrl').focus();
  });
  if (staticApp) $('providerType').querySelector('[value="localai"]')?.remove();
  refresh();
  return { open, openEffective, syncBusy, refresh, error, switchWorkspace };
}
