const { getImageMimeType, isSupportedImagePath } = require('./imageAssetService');

function buildWriteUrl(blogId) {
  const id = String(blogId || '').trim();
  if (!id) throw new Error('Blog ID is required.');
  return `https://blog.naver.com/${encodeURIComponent(id)}?Redirect=Write&`;
}

function normalizeTags(tags) {
  return String(tags || '')
    .split(/[\n,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ');
}

function normalizeBlocks(payload) {
  if (Array.isArray(payload.blocks)) {
    const blocks = payload.blocks.map(normalizeBlock).filter(Boolean);
    const tags = normalizeTags(payload.tags);
    if (tags) blocks.push({ type: 'text', text: tags });
    return blocks;
  }

  const fallback = [];
  if (String(payload.content || '').trim()) fallback.push({ type: 'text', text: String(payload.content) });
  const tags = normalizeTags(payload.tags);
  if (tags) fallback.push({ type: 'text', text: tags });
  return fallback;
}

function normalizeBlock(block) {
  if (!block || typeof block !== 'object') return null;

  if (block.type === 'image') {
    if (block.enabled === false) return null;
    const imagePath = String(block.path || '').trim();
    if (!imagePath) return null;
    if (!isSupportedImagePath(imagePath)) return null;
    const caption = String(block.caption || '').trim();
    const output = caption
      ? { type: 'image', path: imagePath, caption }
      : { type: 'image', path: imagePath };
    const url = String(block.url || '').trim();
    if (url) output.url = url;
    return withStyle(output, block);
  }

  if (block.type === 'divider') return withStyle({ type: 'divider' }, block);

  if (block.type === 'heading') {
    const text = String(block.text || block.content || '').trim();
    return text ? withStyle({ type: 'heading', text }, block) : null;
  }

  if (block.type === 'quotation') {
    const text = String(block.text || block.content || '').trim();
    if (!text) return null;
    const output = { type: 'quotation', text };
    const quotationType = normalizeQuotationType(block.quotationType);
    if (quotationType) output.quotationType = quotationType;
    return withStyle(output, block);
  }

  const text = String(block.text || block.content || '').trim();
  if (!text) return null;
  return withStyle({ type: 'text', text }, block);
}

// Carry an optional per-block style object (fontSize/fontFamily/fontColor/
// textAlign/fontWeight) through to the editor. Blocks without a style are left
// untouched so existing payloads stay byte-for-byte identical.
function withStyle(output, block) {
  if (block.style && typeof block.style === 'object') output.style = block.style;
  return output;
}

// Naver SE3 quotation variants. quotation1 is the plain default, so we only
// surface 2-6 as an explicit quotationType — a bare quotation block (no
// quotationType key) stays identical to the previous payload shape.
const QUOTATION_TYPES = new Set(['quotation2', 'quotation3', 'quotation4', 'quotation5', 'quotation6']);

function normalizeQuotationType(value) {
  const type = String(value || '').trim();
  return QUOTATION_TYPES.has(type) ? type : '';
}

function normalizeContentStyles(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const output = {};
  if (raw.useItalic) output.useItalic = true;
  if (raw.useUnderline) output.useUnderline = true;
  if (raw.useStrikethrough) output.useStrikethrough = true;
  const backgroundColor = String(raw.backgroundColor || '').trim();
  if (backgroundColor) output.backgroundColor = backgroundColor;
  const lineHeight = String(raw.lineHeight || '').trim();
  if (lineHeight) output.lineHeight = lineHeight;
  return Object.keys(output).length > 0 ? output : null;
}

function validateDraftPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Draft payload is required.');
  if (!String(payload.blogId || '').trim()) throw new Error('Blog ID is required.');
  if (!String(payload.title || '').trim()) throw new Error('Title is required.');
  if (normalizeBlocks(payload).length === 0) throw new Error('At least one text or image block is required.');
}

function createDraftOutput(payload) {
  const output = {
    blogId: String(payload.blogId || '').trim(),
    title: String(payload.title || '').trim(),
    blocks: normalizeBlocks(payload)
  };
  // Only attach contentStyles when the caller actually provided some, so
  // existing callers/payloads keep the same shape.
  const contentStyles = normalizeContentStyles(payload.contentStyles);
  if (contentStyles) output.contentStyles = contentStyles;
  return output;
}

module.exports = {
  buildWriteUrl,
  createDraftOutput,
  getImageMimeType,
  normalizeBlocks,
  normalizeContentStyles,
  normalizeQuotationType,
  normalizeTags,
  validateDraftPayload
};
