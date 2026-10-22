import { setupConfigTransfer } from './config-transfer-ui.mjs';
import { PROVIDERS as presets, validateExternalProvider, isLocalProvider, modelPriceLabel, PRICING_SOURCES } from '../providers.mjs';
import { translateWithProvider, fetchModels } from './api.mjs';
import { cleanModels } from './sites.mjs';

export function setupModelSettings({ profiles, staticApp, isBusy, onChange, onWorkspace, toast }) {
  const $ = id => document.getElementById(id);
  const names = { translation: '翻译', writing: '语法与润色', declaudish: 'De-Claudish', global: '全局' };
  let scope = 'translation', controller = null, workspace = 'translation', editorModels = [];
  const option = (value, text) => { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; };
  const manualModel = '__manual_model__';
  function modelChoices(id, values, current = $(id).value) {
    const list = cleanModels([current, ...values]);
    const select = $(id + 'Choice');
    select.replaceChildren(option('', list.length ? '请选择模型' : '暂无模型列表，请获取列表或手动输入'), ...list.map(value => { const type = id === 'linkedModel' ? selectedSite()?.type : $('providerType').value; const price = modelPriceLabel(type, value); return option(value, price ? `${value} — ${price}` : value); }), option(manualModel, '手动输入模型 ID…'));
    select.value = current || '';
    $(id).value = current || ''; $(id).hidden = true;
    if (id === 'externalModel') $('modelListStatus').textContent = list.length ? `下拉菜单中有 ${list.length} 个模型，点击选择` : '获取后直接在下方选择，无需复制粘贴';
  }
  for (const id of ['externalModel', 'linkedModel', 'localSettingsModel']) {
    $(id + 'Choice').addEventListener('change', () => {
      const value = $(id + 'Choice').value;
      $(id).hidden = value !== manualModel;
      $(id).value = value === manualModel ? '' : value;
      if (value === manualModel) $(id).focus();
    });
  }
  const models = (id, values) => modelChoices(id === 'linkedModels' ? 'linkedModel' : 'externalModel', values);
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
    modelChoices('localSettingsModel', [], type === 'localai' ? config.model : '');
    $('externalUrl').value = config.baseUrl || ''; $('externalUrl').readOnly = !['local', 'custom'].includes(type);
    $('apiAddressHint').textContent = ['local', 'custom'].includes(type) ? '可直接修改地址。更改后请重新填写密钥并选择模型，再应用设置。' : '内置服务商的官方地址不可修改。如需其他地址，请点击「新建服务商」。';
    $('externalModel').value = config.model || ''; $('externalKey').value = config.apiKey || '';
    $('externalKey').type = 'password'; $('showKey').textContent = '显示';
    $('rememberKey').checked = Boolean(config.remember);
    endpointHint();
    $('pricingSource').hidden = !PRICING_SOURCES[type];
    if (PRICING_SOURCES[type]) $('pricingSource').href = PRICING_SOURCES[type];
    $('getKey').hidden = !presets[type]?.keyUrl;
    if (presets[type]?.keyUrl) $('getKey').href = presets[type].keyUrl;
    const list = config.models || presets[type]?.models || [];
    editorModels = cleanModels([config.model, ...list]); models('modelSuggestions', editorModels);
  }
  const builtin = type => Object.hasOwn(presets, type) && !['custom', 'local'].includes(type);
  function selectedSite() {
    const value = $('savedSite').value;
    return value.startsWith('preset:') ? profiles.sites.list().map(s => profiles.sites.read(s.id)).find(s => s.type === value.slice(7)) : profiles.sites.read(value);
  }
  function siteMenuValue(id) {
    const site = profiles.sites.read(id);
    return site && builtin(site.type) && profiles.sites.list().find(s => s.type === site.type)?.id === id ? 'preset:' + site.type : id;
  }
  function providerMenu() {
    const group = (label, entries) => { const el = document.createElement('optgroup'); el.label = label; el.append(...entries); return el; };
    const all = profiles.sites.list();
    const builtins = ['deepseek', 'zhipu', 'zai', 'openrouter', 'huggingface', 'modelscope', 'groq', 'siliconflow'];
    $('savedSite').replaceChildren(group('内置服务商', builtins.map(type => option('preset:' + type, presets[type].name + (all.some(s => s.type === type) ? ' · 已配置' : '')))), group('我的服务商', all.filter(s => !builtin(s.type) || all.find(x => x.type === s.type)?.id !== s.id).map(s => option(s.id, s.label))));
    if (!builtin(profiles.own(scope).type)) $('savedSite').append(option('__legacy', '当前独立配置'));
    $('savedSite').append(option('__new', '＋ 新建自定义服务商'));
    if (!staticApp) $('savedSite').append(option('localai', 'LocalAI · 局域网默认'));
  }
  function selectSite() {
    const selected = $('savedSite').value;
    const site = selectedSite();
    $('siteActions').hidden = scope !== 'global' || !site || selected.startsWith('preset:');
    $('addProvider').hidden = scope !== 'global';
    $('siteRenamePanel').hidden = true; $('siteDeletePanel').hidden = true;
    const linked = scope !== 'global' && Boolean(site);
    $('linkedSiteFields').hidden = !linked; $('siteEditor').hidden = linked;
    $('siteNameField').hidden = scope !== 'global' || Boolean(site) || selected.startsWith('preset:');
    if (linked) {
      const binding = profiles.binding(scope);
      $('linkedModel').value = binding?.siteId === site.id ? binding.model : site.model;
      models('linkedModels', site.models);
      $('linkedSiteSummary').textContent = `${site.baseUrl} · ${site.apiKey ? '已配置共享密钥' : isLocalProvider(site) ? '未设置密钥（无鉴权服务可用）' : '需要在全局模型页补充密钥'}。此处只选择模型，修改站点会同步到所有引用它的功能。`;
    } else {
      const type = selected.startsWith('preset:') ? selected.slice(7) : selected === 'localai' ? 'localai' : null;
      const config = site || (type ? (profiles.own(scope).type === type ? profiles.own(scope) : type === 'localai' ? profiles.initial(scope, type) : { type, ...presets[type], apiKey: '' }) : selected === '__new' ? { type: 'custom', ...presets.custom, apiKey: '' } : profiles.own(scope));
      fields(site && !selected.startsWith('preset:') && builtin(config.type) ? { ...config, type: 'custom' } : config); $('siteName').value = site?.label || '';
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
    providerMenu();
    const boundSite = profiles.sites.read(profiles.binding(scope)?.siteId);
    const current = profiles.own(scope);
    $('savedSite').value = boundSite ? (builtin(boundSite.type) && profiles.sites.list().find(s => s.type === boundSite.type)?.id === boundSite.id ? 'preset:' + boundSite.type : boundSite.id) : builtin(current.type) ? 'preset:' + current.type : '__legacy';
    $('savedSiteHint').textContent = scope === 'global' ? '先选服务商，再选模型。内置服务商已填写官方地址。' : '复用已配置服务商的地址、模型列表和密钥。';
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
      if (binding && profiles.sites.read(binding.siteId)) { $('savedSite').value = siteMenuValue(binding.siteId); selectSite(); }
    }
    else open(feature);
  }
  function read(listOnly = false) {
    const site = scope !== 'global' && selectedSite();
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
  $('addProvider').addEventListener('click', () => { $('savedSite').value = '__new'; selectSite(); $('siteName').focus(); });
  $('providerType').addEventListener('change', () => {
    const type = $('providerType').value;
    fields(type === 'localai' ? { type, model: profiles.initial(scope, type).model } : { type, ...presets[type], apiKey: '' });
  });
  $('externalUrl').addEventListener('input', () => {
    $('externalKey').value = ''; $('rememberKey').checked = false; editorModels = []; modelChoices('externalModel', [], '');
    const local = endpointHint();
    $('settingsStatus').textContent = local ? '地址已更改；无鉴权服务可直接获取模型列表，需要鉴权时请填写此地址的密钥。' : '地址已更改；请填写此地址的密钥并重新获取模型列表。';
  });
  $('showKey').addEventListener('click', () => { const show = $('externalKey').type === 'password'; $('externalKey').type = show ? 'text' : 'password'; $('showKey').textContent = show ? '隐藏' : '显示'; });
  $('manageSites').addEventListener('click', () => {
    const id = selectedSite()?.id; close(); switchWorkspace('global');
    if (profiles.sites.read(id)) { $('savedSite').value = siteMenuValue(id); selectSite(); }
  });
  $('renameSite').addEventListener('click', () => {
    const site = selectedSite(); if (!site) return;
    $('siteDeletePanel').hidden = true; $('siteRenamePanel').hidden = false;
    $('newSiteName').value = site.label; $('newSiteName').focus(); $('newSiteName').select();
  });
  $('cancelRenameSite').addEventListener('click', () => { $('siteRenamePanel').hidden = true; });
  $('confirmRenameSite').addEventListener('click', () => {
    if (isBusy() || controller) return;
    try {
      const id = selectedSite().id, label = $('newSiteName').value.trim();
      profiles.sites.rename(id, label);
      $('savedSite').selectedOptions[0].textContent = label; $('siteName').value = label;
      $('siteRenamePanel').hidden = true; refresh(); toast('服务商名称已修改');
    } catch (e) { error(e); }
  });
  $('deleteSite').addEventListener('click', () => {
    const site = selectedSite(), id = site?.id; if (!site) return;
    const affected = Object.keys(names).filter(s => profiles.binding(s)?.siteId === id).map(s => names[s]);
    $('siteRenamePanel').hidden = true; $('siteDeletePanel').hidden = false;
    $('siteDeleteMessage').textContent = `删除「${site.label}」及其保存的地址、模型列表和密钥？${affected.length ? '引用此站点的' + affected.join('、') + '需重新选择站点；使用全局模型的功能随全局设置生效。' : ''}不会自动切换到其他接口。`;
  });
  $('cancelDeleteSite').addEventListener('click', () => { $('siteDeletePanel').hidden = true; });
  $('confirmDeleteSite').addEventListener('click', () => {
    if (isBusy() || controller) return;
    try {
      profiles.sites.remove(selectedSite().id); load('global'); refresh();
      $('settingsStatus').textContent = '站点及保存的密钥已删除。引用此站点的配置需要重新选择站点。'; toast('站点已删除');
    } catch (e) { error(e); }
  });
  $('clearKeys').addEventListener('click', () => {
    try {
      if (selectedSite()) profiles.sites.clearKeys(selectedSite().id);
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
        if (scope !== 'global' && selectedSite()) profiles.bind(scope, selectedSite().id, $('linkedModel').value);
        else {
          const config = read();
          if (scope === 'global' && config.type !== 'localai') {
            const id = profiles.sites.save(selectedSite()?.id, config, $('siteName').value, editorModels, $('rememberKey').checked);
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
        editorModels = ids; models('modelSuggestions', ids);
        if (!$('externalModel').value) modelChoices('externalModel', ids, ids[0]);
        $('settingsStatus').textContent = `已读取 ${ids.length} 个模型，请在「选择模型」下拉菜单中选择，再应用设置。`;
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
  setupConfigTransfer({ profiles, onChange: () => { load('global'); refresh(); }, isBusy: () => isBusy() || Boolean(controller) });
  refresh();
  if (location.hash === '#global') switchWorkspace('global');
  return { open, openEffective, syncBusy, refresh, error, switchWorkspace };
}
