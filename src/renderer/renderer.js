const MAX_IMAGES = window.draftModel.MAX_IMAGES;

const elements = {
  stepPanels: [...document.querySelectorAll('[data-step]')],
  stepButtons: [...document.querySelectorAll('[data-step-target]')],
  prevStepButton: document.querySelector('#prevStepButton'),
  nextStepButton: document.querySelector('#nextStepButton'),
  loginButton: document.querySelector('#loginButton'),
  writeButton: document.querySelector('#writeButton'),
  closeButton: document.querySelector('#closeButton'),
  pickImagesButton: document.querySelector('#pickImagesButton'),
  addMoreImagesButton: document.querySelector('#addMoreImagesButton'),
  reverseImagesButton: document.querySelector('#reverseImagesButton'),
  dropZone: document.querySelector('#dropZone'),
  editorDropZone: document.querySelector('#editorDropZone'),
  imageGrid: document.querySelector('#imageGrid'),
  imageCountBadge: document.querySelector('#imageCountBadge'),
  editorImageCount: document.querySelector('#editorImageCount'),
  writerProfile: document.querySelector('#writerProfile'),
  tone: document.querySelector('#tone'),
  targetAudience: document.querySelector('#targetAudience'),
  topic: document.querySelector('#topic'),
  storeInfo: document.querySelector('#storeInfo'),
  seoKeyword: document.querySelector('#seoKeyword'),
  seoNotes: document.querySelector('#seoNotes'),
  generateButton: document.querySelector('#generateButton'),
  refreshResultButton: document.querySelector('#refreshResultButton'),
  generationSummary: document.querySelector('#generationSummary'),
  resultTitle: document.querySelector('#resultTitle'),
  resultBody: document.querySelector('#resultBody'),
  resultTags: document.querySelector('#resultTags'),
  blogId: document.querySelector('#blogId'),
  copyOutputButton: document.querySelector('#copyOutputButton'),
  testFillButton: document.querySelector('#testFillButton'),
  submitToNaverButton: document.querySelector('#submitToNaverButton'),
  latestStatus: document.querySelector('#latestStatus'),
  statusList: document.querySelector('#statusList'),
  toggleLogButton: document.querySelector('#toggleLogButton')
};

const log = window.statusLog.createStatusLog({
  latestStatus: elements.latestStatus,
  statusList: elements.statusList,
  toggleButton: elements.toggleLogButton
});

const state = {
  step: 0,
  busy: false,
  mode: 'normal',
  images: [],
  planning: {
    writerProfile: '',
    tone: '',
    targetAudience: '',
    topic: '',
    storeInfo: '',
    seoKeyword: '',
    seoNotes: ''
  },
  generation: {
    status: 'idle',
    generationId: '',
    aiResponse: '',
    editableTitle: '',
    editableBody: '',
    editableTags: '',
    warnings: []
  }
};

bindEvents();
render();

function bindEvents() {
  elements.stepButtons.forEach((button) => {
    button.addEventListener('click', () => setStep(Number(button.dataset.stepTarget)));
  });

  elements.prevStepButton.addEventListener('click', () => setStep(state.step - 1));
  elements.nextStepButton.addEventListener('click', () => setStep(state.step + 1));

  elements.loginButton.addEventListener('click', async () => {
    await runAction(() => window.autoclick.openLogin(), '네이버 로그인 페이지를 열었습니다.');
  });

  elements.writeButton.addEventListener('click', async () => {
    await runAction(() => window.autoclick.openWrite({ blogId: elements.blogId.value }), '네이버 글쓰기 페이지를 열었습니다.');
  });

  elements.closeButton.addEventListener('click', async () => {
    await runAction(() => window.autoclick.closeBrowser(), '브라우저를 닫았습니다.');
  });

  elements.pickImagesButton.addEventListener('click', pickImages);
  elements.addMoreImagesButton.addEventListener('click', pickImages);
  elements.dropZone.addEventListener('click', pickImages);
  elements.reverseImagesButton.addEventListener('click', reverseImages);

  wireDropZone(elements.dropZone);
  wireDropZone(elements.editorDropZone);

  for (const input of planningInputs()) {
    input.addEventListener('input', syncPlanningFromInputs);
  }

  elements.generateButton.addEventListener('click', generatePost);
  elements.refreshResultButton.addEventListener('click', refreshGenerationResult);

  elements.resultTitle.addEventListener('input', syncGenerationFromInputs);
  elements.resultBody.addEventListener('input', syncGenerationFromInputs);
  elements.resultTags.addEventListener('input', syncGenerationFromInputs);
  elements.blogId.addEventListener('input', renderButtons);

  elements.copyOutputButton.addEventListener('click', async () => {
    await runAction(
      () => window.autoclick.copyText(window.draftModel.toPlainText(getWorkflowDraft())),
      '출력 내용을 클립보드에 복사했습니다.'
    );
  });

  elements.submitToNaverButton.addEventListener('click', async () => {
    await runAction(
      () => window.autoclick.fillDraft(window.draftModel.toNaverPayload(getWorkflowDraft())),
      '네이버 입력 요청을 보냈습니다.'
    );
  });

  // Dev shortcut: send the canned fixture (src/renderer/devFixture.js) through
  // the exact same payload path as the real submit, skipping image upload /
  // planning / AI generation. Lets us iterate on the editor-fill behavior only.
  if (elements.testFillButton) {
    elements.testFillButton.addEventListener('click', async () => {
      await runAction(
        () => window.autoclick.fillDraft(buildFixturePayload()),
        '테스트 입력(고정 글) 요청을 보냈습니다.'
      );
    });
  }

  window.autoclick.onStatus((event) => {
    addStatus(event.message, event.level);
  });
}

function planningInputs() {
  return [
    elements.writerProfile,
    elements.tone,
    elements.targetAudience,
    elements.topic,
    elements.storeInfo,
    elements.seoKeyword,
    elements.seoNotes
  ];
}

function wireDropZone(zone) {
  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    zone.classList.add('isDragOver');
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('isDragOver');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('isDragOver'));
  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    zone.classList.remove('isDragOver');
    const filePaths = [...event.dataTransfer.files]
      .map((file) => window.autoclick.getPathForFile(file))
      .filter(Boolean);
    await addImagePaths(filePaths);
  });
}

async function pickImages() {
  const imageAssets = await window.autoclick.pickImages();
  addImageAssets(imageAssets);
}

async function addImagePaths(filePaths) {
  const imageAssets = await window.autoclick.createImageAssets(filePaths);
  addImageAssets(imageAssets);
  if (imageAssets.length === 0) addStatus('추가할 수 있는 이미지 파일이 없습니다.', 'warning');
}

function addImageAssets(imageAssets) {
  const existing = new Set(state.images.map((image) => normalizePathKey(image.path)));
  let added = 0;

  for (const imageAsset of imageAssets || []) {
    if (state.images.length >= MAX_IMAGES) break;
    const key = normalizePathKey(imageAsset.path);
    if (!key || existing.has(key)) continue;
    existing.add(key);
    state.images.push({
      ...imageAsset,
      id: imageAsset.id || imageAsset.path,
      order: state.images.length,
      caption: imageAsset.caption || '',
      enabled: true
    });
    added += 1;
  }

  if (added > 0) addStatus(`${added}개 이미지를 추가했습니다.`, 'success');
  if ((imageAssets || []).length > added && state.images.length >= MAX_IMAGES) {
    addStatus('이미지는 최대 30장까지만 추가할 수 있습니다.', 'warning');
  }
  normalizeImageOrders();
  render();
}

function normalizePathKey(filePath) {
  return String(filePath || '').trim().toLowerCase();
}

function normalizeImageOrders() {
  state.images.forEach((image, index) => {
    image.order = index;
  });
}

function reverseImages() {
  state.images.reverse();
  normalizeImageOrders();
  render();
}

function moveImage(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.images.length) return;
  const [image] = state.images.splice(index, 1);
  state.images.splice(target, 0, image);
  normalizeImageOrders();
  render();
}

function removeImage(index) {
  state.images.splice(index, 1);
  normalizeImageOrders();
  render();
}

function updateImageCaption(index, caption) {
  if (!state.images[index]) return;
  state.images[index].caption = caption;
}

function syncPlanningFromInputs() {
  state.planning = {
    writerProfile: elements.writerProfile.value,
    tone: elements.tone.value,
    targetAudience: elements.targetAudience.value,
    topic: elements.topic.value,
    storeInfo: elements.storeInfo.value,
    seoKeyword: elements.seoKeyword.value,
    seoNotes: elements.seoNotes.value
  };
}

function syncGenerationFromInputs() {
  state.generation.editableTitle = elements.resultTitle.value;
  state.generation.editableBody = elements.resultBody.value;
  state.generation.editableTags = elements.resultTags.value;
  renderButtons();
}

async function generatePost() {
  syncPlanningFromInputs();

  await runAction(async () => {
    const result = await window.autoclick.generatePost(getWorkflowDraft());
    state.generation.status = result.status || 'processing';
    state.generation.generationId = result.generationId;
    state.generation.aiResponse = '';
    state.generation.editableTitle = '';
    state.generation.editableBody = '';
    state.generation.editableTags = '';
    elements.resultTitle.value = '';
    elements.resultBody.value = '';
    elements.resultTags.value = '';
    setStep(3);
  }, '생성 요청을 시작했습니다. 결과 화면에서 새로고침하세요.');
}

async function refreshGenerationResult() {
  if (!state.generation.generationId) {
    addStatus('조회할 생성 요청이 없습니다.', 'warning');
    return;
  }

  await runAction(async () => {
    const result = await window.autoclick.getGenerationResult(state.generation.generationId);
    state.generation.status = result.status;
    if (result.error) {
      state.generation.warnings = [result.error];
      throw new Error(result.error);
    }
    if (result.aiResponse) {
      const nextGeneration = window.draftModel.createGenerationFromResponse(
        result.aiResponse,
        state.planning.seoKeyword
      );
      state.generation = {
        ...state.generation,
        ...nextGeneration,
        generationId: state.generation.generationId
      };
      elements.resultTitle.value = state.generation.editableTitle;
      elements.resultBody.value = state.generation.editableBody;
      elements.resultTags.value = state.generation.editableTags;
    }
    render();
  }, '생성 결과를 조회했습니다.');
}

function setStep(step) {
  state.step = Math.max(0, Math.min(4, step));
  render();
}

async function runAction(action, successMessage) {
  setBusy(true);
  try {
    await action();
    addStatus(successMessage, 'info');
  } catch (error) {
    addStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function setBusy(nextBusy) {
  state.busy = nextBusy;
  render();
}

function getWorkflowDraft() {
  return window.draftModel.createWorkflowDraft({
    mode: state.mode,
    images: state.images,
    planning: state.planning,
    generation: state.generation,
    blogId: elements.blogId.value
  });
}

// Builds the Naver payload from the dev fixture, mirroring getWorkflowDraft so
// the editor receives exactly what a real generated post would produce.
function buildFixturePayload() {
  const fixture = window.devFixture;
  if (!fixture) throw new Error('테스트 글(devFixture)이 없습니다. src/renderer/devFixture.js 를 확인하세요.');

  const blogId = (elements.blogId.value || fixture.blogId || '').trim();
  if (!blogId) throw new Error('네이버 Blog ID를 입력하세요.');

  const draft = window.draftModel.createWorkflowDraft({
    mode: 'normal',
    images: fixture.images || [],
    planning: {},
    generation: {
      status: 'completed',
      editableTitle: fixture.title || '',
      editableBody: fixture.body || '',
      editableTags: fixture.tags || ''
    },
    blogId
  });

  return window.draftModel.toNaverPayload(draft);
}

function render() {
  renderSteps();
  renderCounts();
  renderImageGrid();
  renderGenerationSummary();
  renderButtons();
}

function renderSteps() {
  elements.stepPanels.forEach((panel) => {
    panel.hidden = Number(panel.dataset.step) !== state.step;
  });
  elements.stepButtons.forEach((button) => {
    button.classList.toggle('isActive', Number(button.dataset.stepTarget) === state.step);
  });
}

function renderCounts() {
  const text = `${state.images.length}/${MAX_IMAGES}`;
  elements.imageCountBadge.textContent = text;
  elements.editorImageCount.textContent = text;
}

function renderImageGrid() {
  elements.imageGrid.replaceChildren();

  if (state.images.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'previewEmpty';
    empty.textContent = '선택된 이미지가 없습니다.';
    elements.imageGrid.append(empty);
    return;
  }

  state.images.forEach((image, index) => {
    const card = document.createElement('article');
    card.className = 'imageCard';

    const thumb = document.createElement('div');
    thumb.className = 'imageThumb';
    const img = document.createElement('img');
    img.src = window.filePathView.toFileUrl(image.path);
    img.alt = image.name;
    thumb.append(img);

    const badge = document.createElement('span');
    badge.className = 'imageIndex';
    badge.textContent = `${index + 1}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'imageRemove';
    remove.textContent = 'x';
    remove.addEventListener('click', () => removeImage(index));

    const body = document.createElement('div');
    body.className = 'imageBody';

    const name = document.createElement('strong');
    name.className = 'imageName';
    name.textContent = image.name;

    const caption = document.createElement('textarea');
    caption.rows = 3;
    caption.placeholder = '이미지 설명 (선택사항)';
    caption.value = image.caption || '';
    caption.addEventListener('input', () => updateImageCaption(index, caption.value));

    const actions = document.createElement('div');
    actions.className = 'imageActions';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '앞으로';
    up.disabled = index === 0;
    up.addEventListener('click', () => moveImage(index, -1));
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '뒤로';
    down.disabled = index === state.images.length - 1;
    down.addEventListener('click', () => moveImage(index, 1));
    actions.append(up, down);

    body.append(name, caption, actions);
    card.append(thumb, badge, remove, body);
    elements.imageGrid.append(card);
  });
}

function renderGenerationSummary() {
  const statusText = {
    idle: '아직 생성 요청이 없습니다.',
    processing: '생성 중입니다. 잠시 후 새로고침하세요.',
    completed: '생성 결과를 확인하고 수정할 수 있습니다.',
    failed: '생성에 실패했습니다.'
  };
  elements.generationSummary.textContent = statusText[state.generation.status] || statusText.idle;
}

function renderButtons() {
  const hasOutput = window.draftModel.buildOutputBlocks(getWorkflowDraft()).length > 0;
  elements.prevStepButton.disabled = state.busy || state.step === 0;
  elements.nextStepButton.disabled = state.busy || state.step === 4;
  elements.pickImagesButton.disabled = state.busy || state.images.length >= MAX_IMAGES;
  elements.addMoreImagesButton.disabled = state.busy || state.images.length >= MAX_IMAGES;
  elements.reverseImagesButton.disabled = state.busy || state.images.length < 2;
  elements.generateButton.disabled = state.busy || state.images.length === 0;
  elements.refreshResultButton.disabled = state.busy || !state.generation.generationId;
  elements.copyOutputButton.disabled = state.busy || !hasOutput;
  elements.submitToNaverButton.disabled =
    state.busy ||
    !elements.blogId.value.trim() ||
    !state.generation.editableTitle.trim() ||
    !hasOutput;
  elements.loginButton.disabled = state.busy;
  elements.writeButton.disabled = state.busy;
  elements.closeButton.disabled = state.busy;
}

function addStatus(message, level = 'info') {
  log.add(message, level);
}
