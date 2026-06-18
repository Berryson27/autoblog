(function () {
  const MAX_IMAGES = 30;

  function normalizeTags(value) {
    return String(value || '')
      .split(/[\n,]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' ');
  }

  function normalizeImages(images) {
    return [...(images || [])]
      .filter((image) => image && image.path)
      .slice(0, MAX_IMAGES)
      .map((image, index) => ({
        id: image.id || image.path,
        path: image.path,
        name: image.name || window.filePathView?.getFileName?.(image.path) || image.path,
        mimeType: image.mimeType || '',
        order: index,
        caption: image.caption || '',
        enabled: image.enabled !== false
      }));
  }

  function createWorkflowDraft({ mode, images, planning, generation, blogId }) {
    return {
      mode: mode || 'normal',
      blogId: String(blogId || '').trim(),
      images: normalizeImages(images),
      planning: {
        writerProfile: String(planning?.writerProfile || '').trim(),
        tone: String(planning?.tone || '').trim(),
        targetAudience: String(planning?.targetAudience || '').trim(),
        topic: String(planning?.topic || '').trim(),
        storeInfo: String(planning?.storeInfo || '').trim(),
        seoKeyword: String(planning?.seoKeyword || '').trim(),
        seoNotes: String(planning?.seoNotes || '').trim()
      },
      generation: {
        status: generation?.status || 'idle',
        generationId: generation?.generationId || '',
        aiResponse: generation?.aiResponse || '',
        editableTitle: String(generation?.editableTitle || '').trim(),
        editableBody: generation?.editableBody || '',
        editableTags: generation?.editableTags || '',
        warnings: generation?.warnings || []
      }
    };
  }

  function extractTitle(content) {
    const value = String(content || '');
    const htmlHeading = value.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
    if (htmlHeading?.[1]) return cleanTitle(htmlHeading[1]);

    const mdHeading = value.match(/^#{1,2}[ \t]+(.+?)\s*$/m);
    if (mdHeading?.[1]) return cleanTitle(mdHeading[1]);

    const firstLine = value
      .replace(/<[^>]+>/g, ' ')
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .find(Boolean);
    return cleanTitle(firstLine || '');
  }

  function cleanTitle(value) {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#*_`~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function stripExtractedHeading(content, title) {
    if (!title) return String(content || '').trim();
    return String(content || '')
      .replace(/^\s*<h[12][^>]*>[\s\S]*?<\/h[12]>\s*/i, '')
      .replace(/^\s*#{1,2}[ \t]+.+?\s*$/m, '')
      .trim();
  }

  function createGenerationFromResponse(aiResponse, fallbackTags = '') {
    const title = extractTitle(aiResponse);
    const bodyWithoutTitle = stripExtractedHeading(aiResponse, title);
    const tagResult = extractTrailingTags(bodyWithoutTitle);
    return {
      status: 'completed',
      aiResponse,
      editableTitle: title,
      editableBody: tagResult.body,
      editableTags: tagResult.tags || fallbackTags || ''
    };
  }

  function extractTrailingTags(content) {
    const lines = String(content || '').trim().split(/\r?\n/);
    const lastIndex = findLastNonEmptyLineIndex(lines);
    if (lastIndex < 0) return { body: String(content || '').trim(), tags: '' };

    const line = lines[lastIndex].trim();
    const withoutLabel = line.replace(/^(태그|tags?)\s*[:：-]?\s*/i, '').trim();
    const looksLikeTags =
      withoutLabel.startsWith('#') ||
      (withoutLabel.includes(',') && withoutLabel.length <= 160 && !/[.!?。]$/.test(withoutLabel));

    if (!looksLikeTags) return { body: String(content || '').trim(), tags: '' };

    lines.splice(lastIndex, 1);
    return {
      body: lines.join('\n').trim(),
      tags: withoutLabel
    };
  }

  function findLastNonEmptyLineIndex(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (String(lines[index] || '').trim()) return index;
    }
    return -1;
  }

  function buildOutputBlocks(draft) {
    if (!draft.generation) return buildLegacyOutputBlocks(draft);
    const parsed = parseGeneratedContent(draft.generation.editableBody, draft.images);
    const tags = normalizeTags(draft.generation.editableTags);
    if (tags) parsed.blocks.push({ type: 'text', text: tags, role: 'tags' });
    return parsed.blocks;
  }

  function parseGeneratedContent(content, images) {
    const sortedImages = normalizeImages(images).filter((image) => image.enabled);
    const used = new Set();
    const warnings = [];
    const blocks = [];
    const source = String(content || '');
    const imagePattern = /<img[^>]*src=["']image_(\d+)["'][^>]*>|(?:^|\s)\[?image_(\d+)\]?/gi;
    let lastIndex = 0;
    let match;

    while ((match = imagePattern.exec(source))) {
      const textBefore = source.slice(lastIndex, match.index).trim();
      pushContentBlocks(blocks, textBefore);

      const imageNumber = Number(match[1] || match[2]);
      const image = sortedImages[imageNumber - 1];
      if (image) {
        blocks.push({
          type: 'image',
          path: image.path,
          name: image.name,
          mimeType: image.mimeType,
          caption: image.caption || ''
        });
        used.add(image.id);
      } else {
        warnings.push(`image_${imageNumber}에 해당하는 이미지가 없습니다.`);
      }

      lastIndex = imagePattern.lastIndex;
    }

    pushContentBlocks(blocks, source.slice(lastIndex).trim());

    for (const image of sortedImages) {
      if (used.has(image.id)) continue;
      blocks.push({
        type: 'image',
        path: image.path,
        name: image.name,
        mimeType: image.mimeType,
        caption: image.caption || ''
      });
    }

    return { blocks, warnings };
  }

  function pushContentBlocks(blocks, text) {
    const parts = splitRichTextMarkers(text);
    for (const part of parts) {
      if (part.type === 'divider') {
        blocks.push({ type: 'divider' });
      } else if (part.type === 'heading') {
        blocks.push({ type: 'heading', text: part.text });
      } else if (part.type === 'quotation') {
        const block = { type: 'quotation', text: part.text };
        if (part.quotationType) block.quotationType = part.quotationType;
        blocks.push(block);
      } else {
        pushTextBlock(blocks, part.text);
      }
    }
  }

  function splitRichTextMarkers(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const parts = [];
    let buffer = [];

    function flushText() {
      const value = buffer.join('\n').trim();
      if (value) parts.push({ type: 'text', text: value });
      buffer = [];
    }

    for (const line of lines) {
      const trimmed = line.trim();
      // Optional trailing digit picks a Naver quotation style: [QUOTE2]..[QUOTE6]
      // map to quotation2..6. Plain [QUOTE]/[HIGHLIGHT]/[KEY] stay the default
      // style (no quotationType key).
      const quotation = trimmed.match(/^\[(HIGHLIGHT|KEY|QUOTE)([1-6])?\]\s*(.+)$/i);
      // Body subheading: "### 소제목" (## is reserved for the post title, which
      // is extracted/stripped upstream, so only ##+ left in the body are headings).
      const heading = trimmed.match(/^#{2,6}\s+(.+?)\s*#*$/);

      if (/^[-*_]{3,}$/.test(trimmed)) {
        flushText();
        parts.push({ type: 'divider' });
      } else if (heading) {
        flushText();
        parts.push({ type: 'heading', text: heading[1].trim() });
      } else if (quotation) {
        flushText();
        const part = { type: 'quotation', text: quotation[3].trim() };
        const digit = quotation[2];
        if (digit && digit >= '2' && digit <= '6') part.quotationType = `quotation${digit}`;
        parts.push(part);
      } else if (/^>\s+/.test(trimmed)) {
        flushText();
        parts.push({ type: 'quotation', text: trimmed.replace(/^>\s+/, '').trim() });
      } else {
        buffer.push(line);
      }
    }

    flushText();
    return parts;
  }

  function pushTextBlock(blocks, text) {
    const normalized = textToPlainText(text);
    if (normalized.trim()) blocks.push({ type: 'text', text: normalized });
  }

  function textToPlainText(value) {
    return String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function toNaverPayload(draft) {
    if (!draft.generation) {
      return {
        blogId: draft.blogId,
        title: draft.title,
        tags: draft.rawTags,
        blocks: draft.blocks
      };
    }

    return {
      blogId: draft.blogId,
      title: draft.generation.editableTitle,
      tags: draft.generation.editableTags,
      blocks: parseGeneratedContent(draft.generation.editableBody, draft.images).blocks
    };
  }

  function toPlainText(draft) {
    return buildOutputBlocks(draft)
      .map((block) => {
        if (block.type === 'image') return [block.path, block.caption].filter(Boolean).join('\n');
        return block.text;
      })
      .filter((value) => String(value || '').trim())
      .join('\n\n');
  }

  function createDraft({ blogId, title, tags, blocks }) {
    return {
      blogId: String(blogId || '').trim(),
      title: String(title || '').trim(),
      tags: normalizeTags(tags),
      rawTags: String(tags || ''),
      blocks: blocks || []
    };
  }

  function buildLegacyOutputBlocks(draft) {
    const outputBlocks = [...draft.blocks];
    if (draft.tags) outputBlocks.push({ type: 'text', text: draft.tags, role: 'tags' });
    return outputBlocks;
  }

  window.draftModel = {
    MAX_IMAGES,
    buildOutputBlocks,
    buildLegacyOutputBlocks,
    createDraft,
    createGenerationFromResponse,
    createWorkflowDraft,
    extractTitle,
    normalizeImages,
    normalizeTags,
    parseGeneratedContent,
    textToPlainText,
    toNaverPayload,
    toPlainText
  };
})();
