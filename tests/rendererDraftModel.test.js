const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDraftModel() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/renderer/draftModel.js'),
    'utf8'
  );
  const context = {
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.draftModel;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('renderer draft model builds output blocks in Naver order', () => {
  const draftModel = loadDraftModel();
  const draft = draftModel.createDraft({
    blogId: ' blog ',
    title: ' title ',
    tags: 'alpha, beta',
    blocks: [
      { type: 'text', text: 'body' },
      {
        type: 'image',
        path: 'C:\\photo.png',
        name: 'photo.png',
        caption: 'caption'
      }
    ]
  });

  assert.deepEqual(plain(draftModel.buildOutputBlocks(draft)), [
    { type: 'text', text: 'body' },
    {
      type: 'image',
      path: 'C:\\photo.png',
      name: 'photo.png',
      caption: 'caption'
    },
    { type: 'text', text: '#alpha #beta', role: 'tags' }
  ]);
});

test('renderer draft model keeps raw tags for main process normalization', () => {
  const draftModel = loadDraftModel();
  const draft = draftModel.createDraft({
    blogId: 'blog',
    title: 'title',
    tags: 'alpha,beta',
    blocks: [{ type: 'text', text: 'body' }]
  });

  assert.deepEqual(plain(draftModel.toNaverPayload(draft)), {
    blogId: 'blog',
    title: 'title',
    tags: 'alpha,beta',
    blocks: [{ type: 'text', text: 'body' }]
  });
});

test('renderer draft model creates copyable final text', () => {
  const draftModel = loadDraftModel();
  const draft = draftModel.createDraft({
    blogId: 'blog',
    title: 'title',
    tags: 'alpha',
    blocks: [
      { type: 'text', text: 'body' },
      { type: 'image', path: 'C:\\photo.png', caption: 'caption' }
    ]
  });

  assert.equal(
    draftModel.toPlainText(draft),
    'body\n\nC:\\photo.png\ncaption\n\n#alpha'
  );
});

test('renderer draft model supports image-only output', () => {
  const draftModel = loadDraftModel();
  const draft = draftModel.createDraft({
    blogId: 'blog',
    title: 'title',
    tags: '',
    blocks: [
      { type: 'image', path: 'C:\\photo.png', caption: '' }
    ]
  });

  assert.deepEqual(plain(draftModel.buildOutputBlocks(draft)), [
    { type: 'image', path: 'C:\\photo.png', caption: '' }
  ]);
});

test('renderer draft model supports empty collected output', () => {
  const draftModel = loadDraftModel();
  const draft = draftModel.createDraft({
    blogId: 'blog',
    title: 'title',
    tags: '',
    blocks: []
  });

  assert.deepEqual(plain(draftModel.buildOutputBlocks(draft)), []);
});

test('renderer workflow model maps image placeholders to image blocks', () => {
  const draftModel = loadDraftModel();
  const draft = draftModel.createWorkflowDraft({
    blogId: 'blog',
    images: [
      { id: '1', path: 'C:\\one.png', name: 'one.png', caption: 'first' },
      { id: '2', path: 'C:\\two.png', name: 'two.png', caption: 'second' }
    ],
    planning: {},
    generation: {
      editableTitle: 'title',
      editableBody: 'intro\n<img src="image_1">\nmid\n<img src="image_2">\noutro',
      editableTags: 'alpha,beta'
    }
  });

  assert.deepEqual(plain(draftModel.buildOutputBlocks(draft)), [
    { type: 'text', text: 'intro' },
    { type: 'image', path: 'C:\\one.png', name: 'one.png', mimeType: '', caption: 'first' },
    { type: 'text', text: 'mid' },
    { type: 'image', path: 'C:\\two.png', name: 'two.png', mimeType: '', caption: 'second' },
    { type: 'text', text: 'outro' },
    { type: 'text', text: '#alpha #beta', role: 'tags' }
  ]);
});

test('renderer workflow model appends unreferenced images', () => {
  const draftModel = loadDraftModel();
  const parsed = draftModel.parseGeneratedContent('body <img src="image_1">', [
    { id: '1', path: 'C:\\one.png', name: 'one.png' },
    { id: '2', path: 'C:\\two.png', name: 'two.png' }
  ]);

  assert.deepEqual(plain(parsed.blocks), [
    { type: 'text', text: 'body' },
    { type: 'image', path: 'C:\\one.png', name: 'one.png', mimeType: '', caption: '' },
    { type: 'image', path: 'C:\\two.png', name: 'two.png', mimeType: '', caption: '' }
  ]);
});

test('renderer workflow model extracts title from generated content', () => {
  const draftModel = loadDraftModel();
  const generation = draftModel.createGenerationFromResponse('## Great title\n\nbody');

  assert.equal(generation.editableTitle, 'Great title');
  assert.equal(generation.editableBody, 'body');
});

test('renderer workflow model converts rich markers to blocks', () => {
  const draftModel = loadDraftModel();
  const parsed = draftModel.parseGeneratedContent('intro\n\n[HIGHLIGHT] important\n\n---\n\noutro', []);

  assert.deepEqual(plain(parsed.blocks), [
    { type: 'text', text: 'intro' },
    { type: 'quotation', text: 'important' },
    { type: 'divider' },
    { type: 'text', text: 'outro' }
  ]);
});

test('renderer workflow model maps ### markers to heading blocks', () => {
  const draftModel = loadDraftModel();
  const parsed = draftModel.parseGeneratedContent('intro\n\n### 첫인상\n\n본문 내용', []);

  assert.deepEqual(plain(parsed.blocks), [
    { type: 'text', text: 'intro' },
    { type: 'heading', text: '첫인상' },
    { type: 'text', text: '본문 내용' }
  ]);
});

test('renderer workflow model maps numbered quotation markers to styles', () => {
  const draftModel = loadDraftModel();
  const parsed = draftModel.parseGeneratedContent('[QUOTE2] line style\n\n[QUOTE] default style', []);

  assert.deepEqual(plain(parsed.blocks), [
    { type: 'quotation', text: 'line style', quotationType: 'quotation2' },
    { type: 'quotation', text: 'default style' }
  ]);
});
