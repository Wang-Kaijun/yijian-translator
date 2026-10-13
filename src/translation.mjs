import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']).use(remarkMath);
const BLOCKS = new Set(['paragraph', 'heading', 'tableCell']);
const TOKEN = /⟦K\d+_\d+⟧/g;
const hasWords = text => /[\p{L}]/u.test(text);

export function detectDirection(text) {
  const meaningful = text.replace(/https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, '');
  const chinese = (meaningful.match(/\p{Script=Han}/gu) || []).length;
  const english = (meaningful.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
  if (!chinese && !english) return { source: 'unknown', target: 'zh', label: '自动检测 · 英文 → 中文' };
  const source = chinese >= Math.max(1, english * 1.25) ? 'zh' : 'en';
  return { source, target: source === 'zh' ? 'en' : 'zh', label: source === 'zh' ? '中文 → 英文' : '英文 → 中文' };
}

function visit(node, fn, parent) {
  if (fn(node, parent) === false) return;
  for (const child of node.children || []) visit(child, fn, node);
}

function parseDocument(source) {
  // Micromark drops a leading BOM before calculating offsets. Account for it explicitly.
  const offset = source.startsWith('\ufeff') ? 1 : 0;
  const tree = parser.parse(source.slice(offset));
  if (offset) visit(tree, node => {
    if (node.position) { node.position.start.offset += offset; node.position.end.offset += offset; }
  });
  return tree;
}

// Split only between complete Unicode characters and complete protection tokens.
export function splitMasked(text, limit = 2200) {
  const atoms = text.match(/⟦K\d+_\d+⟧|[^]/gu) || [];
  const chunks = [];
  let current = '';
  for (const atom of atoms) {
    if (current.length + atom.length > limit) {
      const boundaries = [...current.matchAll(/[。！？.!?;；]\s*|\s+/g)];
      const cut = boundaries.filter(m => m.index + m[0].length > limit * 0.55).at(-1);
      const offset = cut ? cut.index + cut[0].length : current.length;
      chunks.push(current.slice(0, offset));
      current = current.slice(offset);
    }
    current += atom;
  }
  if (current) chunks.push(current);
  return chunks;
}

function protectBlock(raw, spans, blockNumber, mode) {
  const protectedParts = [];
  const protect = value => {
    if (!value) return '';
    const token = `⟦K${blockNumber}_${protectedParts.length}⟧`;
    protectedParts.push(value);
    return token;
  };
  // Line breaks and indentation remain byte-for-byte intact, including blockquote prefixes.
  const shieldText = value => value.replace(
    /⟦K\d+_\d+⟧|(?:\r\n|\n|\r)[\t >]*|\\[^\p{L}\p{N}\s]|&(?:#\d+|#x[\da-fA-F]+|[A-Za-z]+);|https?:\/\/[^\s<>]+|\b[\w.+-]+@[\w.-]+\.[A-Za-z]+|^[\ufeff\t ]+|[\t ]+$/gu,
    protect,
  );
  let position = 0;
  let masked = '';
  for (const span of spans) {
    masked += protect(raw.slice(position, span.start));
    masked += shieldText(raw.slice(span.start, span.end));
    position = span.end;
  }
  masked += protect(raw.slice(position));
  return { masked, protectedParts, mode, blockNumber };
}

export function createPlan(source, mode = 'text', direction = 'auto') {
  const blocks = [];
  let languageText = '';
  if (mode === 'markdown') {
    const tree = parseDocument(source);
    visit(tree, node => {
      if (!BLOCKS.has(node.type)) return;
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      const spans = [];
      visit(node, (leaf, parent) => {
        if (leaf.type !== 'text' || !leaf.position) return;
        const raw = source.slice(leaf.position.start.offset, leaf.position.end.offset);
        // Autolinks have no separately editable label: changing it changes the URL.
        if (parent?.type === 'link' && (raw === parent.url || /^<?(?:https?:\/\/|www\.|mailto:)/i.test(raw))) return;
        if (hasWords(leaf.value)) {
          spans.push({ start: leaf.position.start.offset - start, end: leaf.position.end.offset - start });
          languageText += `${leaf.value}\n`;
        }
      });
      if (spans.length) blocks.push({ start, end, ...protectBlock(source.slice(start, end), spans, blocks.length, mode) });
      return false;
    });
  } else {
    const regex = /[^\r\n]+(?:\r?\n(?!\r?\n)[^\r\n]+)*/g;
    for (const match of source.matchAll(regex)) {
      if (!hasWords(match[0])) continue;
      const raw = match[0];
      blocks.push({ start: match.index, end: match.index + raw.length, ...protectBlock(raw, [{ start: 0, end: raw.length }], blocks.length, mode) });
      languageText += `${raw}\n`;
    }
  }
  const detected = detectDirection(languageText);
  const target = direction === 'auto' ? detected.target : direction === 'en-zh' ? 'zh' : 'en';
  const items = [];
  for (const block of blocks) {
    block.ids = [];
    block.pieces = splitMasked(block.masked).map((text, i) => {
      // Keep whitespace at split boundaries outside the model's response.
      const leading = text.match(/^\s*/u)[0];
      const trailing = text.match(/\s*$/u)[0];
      const content = text.slice(leading.length, text.length - trailing.length || undefined);
      if (!hasWords(content.replace(TOKEN, ''))) return { literal: text };
      const id = `b${block.blockNumber}p${i}`;
      items.push({ id, text: content });
      block.ids.push(id);
      return { id, original: content, leading, trailing };
    });
  }
  return { source, mode, blocks, items, target, detected, completed: new Map() };
}

export function validateTranslation(original, translated) {
  if (typeof translated !== 'string' || !translated.trim()) throw new Error('模型返回了空译文');
  const expected = original.match(TOKEN) || [];
  const actual = translated.match(TOKEN) || [];
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('模型改变了 Markdown 保护标记，已保留原文');
  if (translated.length > Math.max(1200, original.length * 12)) throw new Error('译文长度异常，已保留原文');
  return translated;
}

export function acceptTranslations(plan, items, translations) {
  if (!Array.isArray(translations) || translations.length !== items.length) throw new Error('模型返回的分段数量不完整');
  const mapping = new Map(translations.map(t => [t.id, t.text]));
  if (mapping.size !== items.length || items.some(item => !mapping.has(item.id))) throw new Error('模型返回的分段编号不匹配');
  for (const item of items) validateTranslation(item.text, mapping.get(item.id));
  for (const item of items) plan.completed.set(item.id, mapping.get(item.id).trim());
}

const escapeMarkdown = text => text.replace(/([\\`*_{}\[\]<>#!|~])/g, '\\$1').replace(/(^|\s)(\d+)\.(?=\s)/g, '$1$2\\.');

export function renderPlan(plan) {
  let output = '';
  let cursor = 0;
  for (const block of plan.blocks) {
    output += plan.source.slice(cursor, block.start);
    if (!block.ids.every(id => plan.completed.has(id))) {
      output += plan.source.slice(block.start, block.end);
    } else {
      let translated = block.pieces.map(piece => piece.literal ?? `${piece.leading}${plan.completed.get(piece.id)}${piece.trailing}`).join('');
      // Restore only after escaping translated prose, so generated syntax cannot corrupt the structure.
      const pieces = translated.split(/(⟦K\d+_\d+⟧)/g);
      translated = pieces.map(piece => {
        const match = piece.match(/^⟦K(\d+)_(\d+)⟧$/);
        if (match && Number(match[1]) === block.blockNumber) return block.protectedParts[Number(match[2])];
        const flat = piece.replace(/[\r\n]+/g, ' ');
        return plan.mode === 'markdown' ? escapeMarkdown(flat) : flat;
      }).join('');
      output += translated;
    }
    cursor = block.end;
  }
  return output + plan.source.slice(cursor);
}

export function pendingBatches(plan, maxChars = 4200, maxItems = 22) {
  const batches = [];
  let batch = [], size = 0;
  for (const item of plan.items.filter(item => !plan.completed.has(item.id))) {
    if (batch.length && (size + item.text.length > maxChars || batch.length >= maxItems)) {
      batches.push(batch); batch = []; size = 0;
    }
    batch.push(item); size += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function previewSource(source) {
  const tree = parseDocument(source);
  const meta = tree.children.filter(n => n.type === 'yaml' || n.type === 'toml');
  for (const node of meta.reverse()) source = source.slice(0, node.position.start.offset) + source.slice(node.position.end.offset);
  return source;
}
