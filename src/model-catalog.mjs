const modelIdCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const isModelTime = value => typeof value === 'number' && value > 0 && value <= 8.64e15;
const isModelId = value => typeof value === 'string' && value.trim() && value.length <= 200 && !/[\r\n]/.test(value);

export function cleanModels(models = []) {
  return [...new Set(models.filter(isModelId).map(id => id.trim()))].slice(0, 500);
}

export function cleanModelTimes(models, modelTimes) {
  if (!modelTimes || typeof modelTimes !== 'object' || Array.isArray(modelTimes)) return {};
  return Object.fromEntries(models
    .filter(id => Object.hasOwn(modelTimes, id) && isModelTime(modelTimes[id]))
    .map(id => [id, modelTimes[id]]));
}

function parseModelTime(value) {
  if (typeof value === 'string') {
    value = value.trim();
    if (/^\d{4}-\d{2}-\d{2}(?:T|$)/i.test(value)) {
      const time = Date.parse(value);
      return isModelTime(time) ? time : 0;
    }
    if (!/^\d+(?:\.\d+)?$/.test(value)) return 0;
    value = Number(value);
  }
  if (typeof value !== 'number') return 0;
  const time = value < 1e11 ? value * 1000 : value;
  return isModelTime(time) ? time : 0;
}

export function readModelCatalog(entries) {
  const models = cleanModels(entries.map(entry => entry?.id));
  const dates = new Map(models.map(id => [id, { updated: 0, created: 0 }]));
  for (const entry of entries) {
    if (!isModelId(entry?.id)) continue;
    const date = dates.get(entry.id.trim());
    if (!date) continue;
    const updated = [entry.updated_at, entry.updatedAt, entry.updated, entry.modified_at, entry.modifiedAt, entry.last_modified, entry.lastModified]
      .map(parseModelTime).find(Boolean) || 0;
    const created = [entry.created, entry.created_at, entry.createdAt].map(parseModelTime).find(Boolean) || 0;
    date.updated = Math.max(date.updated, updated);
    date.created = Math.max(date.created, created);
  }
  const modelTimes = Object.fromEntries([...dates]
    .filter(([, date]) => date.updated || date.created)
    .map(([id, date]) => [id, date.updated || date.created]));
  return { models, modelTimes };
}

export function sortModelIds(models) {
  return [...models].sort(modelIdCollator.compare);
}
