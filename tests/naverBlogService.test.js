const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWriteUrl,
  createDraftOutput,
  getImageMimeType,
  normalizeBlocks,
  normalizeTags,
  validateDraftPayload
} = require('../src/main/services/naverBlogService');
const { createImageAssets } = require('../src/main/services/imageAssetService');

test('buildWriteUrl creates a Naver write URL', () => {
  assert.equal(
    buildWriteUrl('my-blog'),
    'https://blog.naver.com/my-blog?Redirect=Write&'
  );
});

test('normalizeTags accepts commas and line breaks', () => {
  assert.equal(normalizeTags('alpha, #beta\ngamma'), '#alpha #beta #gamma');
});

test('normalizeBlocks keeps text and image order', () => {
  assert.deepEqual(normalizeBlocks({
    tags: 'tag',
    blocks: [
      { type: 'text', text: 'first' },
      { type: 'image', path: 'C:\\image.png', caption: 'caption' },
      { type: 'text', text: 'last' }
    ]
  }), [
    { type: 'text', text: 'first' },
    { type: 'image', path: 'C:\\image.png', caption: 'caption' },
    { type: 'text', text: 'last' },
    { type: 'text', text: '#tag' }
  ]);
});

test('normalizeBlocks skips disabled image blocks', () => {
  assert.deepEqual(normalizeBlocks({
    blocks: [
      { type: 'text', text: 'first' },
      { type: 'image', path: 'C:\\image.png', enabled: false },
      { type: 'text', text: 'last' }
    ]
  }), [
    { type: 'text', text: 'first' },
    { type: 'text', text: 'last' }
  ]);
});

test('normalizeBlocks keeps rich insertion block types', () => {
  assert.deepEqual(normalizeBlocks({
    blocks: [
      { type: 'quotation', content: 'important' },
      { type: 'divider' },
      { type: 'image', path: 'C:\\image.png', url: 'https://example.com' }
    ]
  }), [
    { type: 'quotation', text: 'important' },
    { type: 'divider' },
    { type: 'image', path: 'C:\\image.png', url: 'https://example.com' }
  ]);
});

test('normalizeBlocks keeps heading blocks', () => {
  assert.deepEqual(normalizeBlocks({
    blocks: [
      { type: 'heading', text: '첫인상' },
      { type: 'text', text: 'body' },
      { type: 'heading', text: '   ' }
    ]
  }), [
    { type: 'heading', text: '첫인상' },
    { type: 'text', text: 'body' }
  ]);
});

test('normalizeBlocks carries explicit quotation style, omits the default', () => {
  assert.deepEqual(normalizeBlocks({
    blocks: [
      { type: 'quotation', content: 'styled', quotationType: 'quotation3' },
      { type: 'quotation', content: 'plain' },
      { type: 'quotation', content: 'bad', quotationType: 'quotation9' }
    ]
  }), [
    { type: 'quotation', text: 'styled', quotationType: 'quotation3' },
    { type: 'quotation', text: 'plain' },
    { type: 'quotation', text: 'bad' }
  ]);
});

test('createDraftOutput attaches contentStyles only when provided', () => {
  const withStyles = createDraftOutput({
    blogId: 'blog',
    title: 'title',
    blocks: [{ type: 'text', text: 'body' }],
    contentStyles: { lineHeight: '180', useItalic: true, backgroundColor: '' }
  });
  assert.deepEqual(withStyles.contentStyles, { useItalic: true, lineHeight: '180' });

  const withoutStyles = createDraftOutput({
    blogId: 'blog',
    title: 'title',
    blocks: [{ type: 'text', text: 'body' }]
  });
  assert.equal('contentStyles' in withoutStyles, false);
});

test('createDraftOutput mirrors final Naver insertion order', () => {
  assert.deepEqual(createDraftOutput({
    blogId: ' blog ',
    title: ' title ',
    tags: 'alpha,beta',
    blocks: [
      { type: 'image', path: 'C:\\photo.webp', caption: 'caption' },
      { type: 'text', text: 'body' }
    ]
  }), {
    blogId: 'blog',
    title: 'title',
    blocks: [
      { type: 'image', path: 'C:\\photo.webp', caption: 'caption' },
      { type: 'text', text: 'body' },
      { type: 'text', text: '#alpha #beta' }
    ]
  });
});

test('getImageMimeType maps common image extensions', () => {
  assert.equal(getImageMimeType('a.png'), 'image/png');
  assert.equal(getImageMimeType('a.webp'), 'image/webp');
  assert.equal(getImageMimeType('a.jpg'), 'image/jpeg');
});

test('createImageAssets returns local image metadata', async () => {
  const { PNG } = require('pngjs');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const imagePath = path.join(os.tmpdir(), `autoclick-${Date.now()}.png`);
  const png = new PNG({ width: 1, height: 1 });
  await fs.writeFile(imagePath, PNG.sync.write(png));

  try {
    const assets = await createImageAssets([imagePath]);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].path, imagePath);
    assert.equal(assets[0].name, path.basename(imagePath));
    assert.equal(assets[0].mimeType, 'image/png');
    assert.equal(assets[0].order, 0);
    assert.equal(assets[0].enabled, true);
  } finally {
    await fs.unlink(imagePath).catch(() => {});
  }
});

test('createImageAssets filters duplicate paths', async () => {
  const { PNG } = require('pngjs');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const imagePath = path.join(os.tmpdir(), `autoclick-duplicate-${Date.now()}.png`);
  const png = new PNG({ width: 1, height: 1 });
  await fs.writeFile(imagePath, PNG.sync.write(png));

  try {
    const assets = await createImageAssets([imagePath, imagePath]);
    assert.equal(assets.length, 1);
  } finally {
    await fs.unlink(imagePath).catch(() => {});
  }
});

test('validateDraftPayload rejects missing title', () => {
  assert.throws(() => validateDraftPayload({
    blogId: 'blog',
    title: '',
    content: 'body'
  }));
});

test('validateDraftPayload accepts image-only drafts', () => {
  assert.doesNotThrow(() => validateDraftPayload({
    blogId: 'blog',
    title: 'title',
    blocks: [
      { type: 'image', path: 'C:\\image.png' }
    ]
  }));
});
