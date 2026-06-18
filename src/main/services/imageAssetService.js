const fs = require('node:fs/promises');
const path = require('node:path');

const MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp']
]);

function getImageMimeType(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  return MIME_BY_EXTENSION.get(ext) || 'image/jpeg';
}

function isSupportedImagePath(imagePath) {
  return MIME_BY_EXTENSION.has(path.extname(imagePath).toLowerCase());
}

async function createImageAssets(filePaths) {
  const assets = [];
  const seenPaths = new Set();

  for (const filePath of filePaths || []) {
    const key = normalizePathKey(filePath);
    if (!key || seenPaths.has(key)) continue;
    seenPaths.add(key);

    const asset = await createImageAsset(filePath, assets.length);
    if (asset) assets.push(asset);
  }

  return assets;
}

async function createImageAsset(filePath, order) {
  const imagePath = String(filePath || '').trim();
  if (!imagePath || !isSupportedImagePath(imagePath)) return null;

  const stat = await fs.stat(imagePath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size === 0) return null;

  return {
    id: `${order}:${imagePath}`,
    path: imagePath,
    name: path.basename(imagePath),
    mimeType: getImageMimeType(imagePath),
    order,
    caption: '',
    enabled: true
  };
}

function normalizePathKey(filePath) {
  return String(filePath || '').trim().toLowerCase();
}

module.exports = {
  createImageAsset,
  createImageAssets,
  getImageMimeType,
  isSupportedImagePath
};
