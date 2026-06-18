(function () {
  function renderPreview(container, draft) {
    container.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = draft.generation?.editableTitle || '제목 없음';
    container.append(heading);

    const outputBlocks = window.draftModel.buildOutputBlocks(draft);
    if (outputBlocks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'previewEmpty';
      empty.textContent = '생성 결과가 없습니다.';
      container.append(empty);
      return;
    }

    outputBlocks.forEach((block, index) => {
      container.append(createPreviewBlock(block, index));
    });
  }

  function createPreviewBlock(block, index) {
    const item = document.createElement('section');
    item.className = `previewBlock ${block.type}`;
    if (block.role === 'tags') item.classList.add('tags');

    const badge = document.createElement('span');
    badge.className = 'previewBadge';
    badge.textContent = `${index + 1}`;
    item.append(badge);

    if (block.type === 'image') {
      const thumbnail = document.createElement('div');
      thumbnail.className = 'previewThumb';
      const image = document.createElement('img');
      image.src = window.filePathView.toFileUrl(block.path);
      image.alt = block.name || window.filePathView.getFileName(block.path);
      thumbnail.append(image);
      item.append(thumbnail);

      if (String(block.caption || '').trim()) {
        const caption = document.createElement('p');
        caption.className = 'previewCaption';
        caption.textContent = block.caption;
        item.append(caption);
      }
      return item;
    }

    const text = document.createElement('p');
    text.textContent = block.text;
    item.append(text);
    return item;
  }

  window.previewRenderer = {
    renderPreview
  };
})();
