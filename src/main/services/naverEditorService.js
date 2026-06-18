const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { getImageMimeType } = require('./naverDraftPayload');

// Debug log file so the editor trace can be inspected after a run (the console
// only goes to the npm-start terminal). Truncated at the start of each
// fillEditorDraft run, so it always holds just the latest attempt.
const LOG_FILE = path.join(process.cwd(), 'editor-debug.log');

// Per-keystroke delay for human-like typing (mirrors the reference's keyboard
// typing). The reference used 50-100ms which is very slow for long posts; 40ms
// keeps the "typed by a person" look while staying practical. Tune here.
const TYPE_DELAY_MS = 40;

// Subheading is rendered as a larger, bold text line (the reference does the
// same via font-size — there is no robust SE3 "소제목 paragraph style" button to
// click). After the heading we reset back to the body size so following text is
// normal. Sizes are Naver SE3 toolbar values (fs15 = body default, fs19 = sub).
const HEADING_FONT_SIZE = '19';
const BODY_FONT_SIZE = '15';

// Naver SE3 quotation styles, keyed by the block's quotationType. quotation1 is
// the toolbar's direct button; 2-6 live behind the "select style" dropdown.
// Mirrors cousting/Autoting (4.posting.js insertQuotation).
const QUOTATION_DATA_VALUE = {
  quotation1: 'default',
  quotation2: 'quotation_line',
  quotation3: 'quotation_bubble',
  quotation4: 'quotation_underline',
  quotation5: 'quotation_postit',
  quotation6: 'quotation_corner'
};

function log(message) {
  const stamp = new Date().toISOString().slice(11, 23);
  const line = `[naverEditor ${stamp}] ${message}`;
  console.log(line);
  try {
    fsSync.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // Logging must never break the run.
  }
}

// Bracket a potentially-blocking step with start/done logs and a timeout, so a
// silent freeze becomes a clear "TIMEOUT at: <label>" line in the terminal.
// Playwright's frame.evaluate and keyboard.press have no built-in timeout, so
// they can otherwise hang forever.
async function withWatchdog(label, ms, action, { critical = true } = {}) {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms at: ${label}`)), ms);
  });
  log(`    > ${label}`);
  try {
    const result = await Promise.race([Promise.resolve().then(action), watchdog]);
    log(`    < ${label} ok`);
    return result;
  } catch (error) {
    log(`    ! ${label} FAILED: ${error.message}`);
    if (critical) throw error;
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Reads the body component list in document order so we can see EXACTLY what
// landed in the editor and in what sequence after each step.
async function snapshotEditorStructure(frame) {
  const evaluation = frame.evaluate(() => {
    const components = [...document.querySelectorAll('.se-component')];
    return components.map((node) => {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (node.classList.contains('se-image')) return 'IMG';
      if (node.classList.contains('se-horizontalLine')) return 'HR';
      if (node.classList.contains('se-quotation')) return `QUOTE:"${text}"`;
      if (node.classList.contains('se-text')) return `TEXT:"${text}"`;
      const kind = [...node.classList].find((c) => c.startsWith('se-')) || 'comp';
      return `${kind}:"${text}"`;
    });
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(['<snapshot timed out>']), 5000));
  return Promise.race([evaluation, timeout]).catch((error) => [`<snapshot failed: ${error.message}>`]);
}

async function logStructure(frame, label) {
  const structure = await snapshotEditorStructure(frame);
  log(`  ${label} structure (${structure.length}): [ ${structure.join('  |  ')} ]`);
}

async function fillEditorDraft(page, { title, blocks, contentStyles }) {
  try {
    fsSync.writeFileSync(LOG_FILE, '');
  } catch {
    // ignore
  }
  await withFreshEditorFrame(page, async (frame) => {
    log(`fillEditorDraft start — title=${JSON.stringify(String(title).slice(0, 40))}, blocks=${blocks.length}, contentStyles=${JSON.stringify(contentStyles || null)}`);
    await closeDraftPopup(frame);
    await fillTitleWithFallback(frame, title);
    await focusBodyWithFallback(frame);
    const stylesApplied = await applyContentStyles(frame, contentStyles);
    // Applying body styles clicks the toolbar (e.g. opens the line-height
    // dropdown), which drops the body caret — so the first typed block would be
    // lost. Re-focus the body before writing any blocks.
    if (stylesApplied) await focusBodyWithFallback(frame);
    await writeBlocks(frame, blocks);
    await logStructure(frame, 'FINAL');
    log('fillEditorDraft done');
  });
}

// Body-wide styles applied once before any block is typed, matching the
// reference's writePost contentStyles step (italic/underline/strikethrough/
// background/lineHeight). Each helper is defensive: a missing toolbar button
// logs and continues instead of aborting the whole post.
async function applyContentStyles(frame, styles) {
  if (!styles || typeof styles !== 'object') return false;
  const keys = Object.keys(styles);
  if (keys.length === 0) return false;
  log(`applyContentStyles: ${JSON.stringify(styles)}`);
  if (styles.useItalic) await toggleItalic(frame, true);
  if (styles.useUnderline) await toggleUnderline(frame, true);
  if (styles.useStrikethrough) await toggleStrikethrough(frame, true);
  if (styles.backgroundColor) await setBackgroundColor(frame, styles.backgroundColor);
  if (styles.lineHeight) await setLineHeight(frame, styles.lineHeight);
  return true;
}

async function waitForEditorFrame(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const frame = page.frames().find((candidate) => candidate.name() === 'mainFrame');
    if (frame) {
      await frame.waitForLoadState('domcontentloaded').catch(() => {});
      return frame;
    }
    await page.waitForTimeout(500);
  }

  throw new Error('Editor iframe was not found. Check login state and Blog ID.');
}

async function withFreshEditorFrame(page, task) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const frame = await waitForEditorFrame(page);
    try {
      return await task(frame);
    } catch (error) {
      lastError = error;
      if (!String(error.message || '').includes('Frame was detached')) throw error;
      await page.waitForTimeout(1200);
    }
  }

  throw lastError;
}

async function closeDraftPopup(frame) {
  // When a saved draft exists, Naver shows a "작성 중이던 글이 있습니다" restore
  // popup a moment AFTER the editor loads. If we don't cancel it, the previous
  // draft is restored and our new content gets appended on top of it (the
  // duplicated/garbled output we saw). The old code checked once immediately and
  // missed the popup because it had not rendered yet — so here we WAIT for the
  // cancel button to appear, then click it. Mirrors cousting/3.posting.js.
  const cancelSelector = [
    '.se-popup-button.se-popup-button-cancel',
    '.se-popup-button-cancel',
    'button.se-popup-button-cancel'
  ].join(', ');

  await frame.waitForTimeout(1500);
  const cancelButton = await frame
    .waitForSelector(cancelSelector, { state: 'visible', timeout: 8000 })
    .catch(() => null);

  if (!cancelButton) {
    log('closeDraftPopup: no restore popup (clean editor)');
    return;
  }

  log('closeDraftPopup: restore popup found — clicking cancel');
  await cancelButton.click().catch(() => {});
  await frame.waitForTimeout(1500);
}

async function fillTitleWithFallback(frame, title) {
  const selectors = [
    '[data-a11y-title="title"] p.se-text-paragraph',
    '[data-a11y-title="title"] .se-text-paragraph',
    '.se-title .se-text-paragraph',
    '.se-title-text p.se-text-paragraph',
    '.se-title-text .se-text-paragraph',
    '.se-title-text [contenteditable="true"]',
    '.se-placeholder'
  ];

  try {
    const target = await firstUsableLocator(frame, selectors);
    await clickEditable(frame, target);
    log('fillTitle: clicked title via selector');
  } catch {
    const box = await getEditorBox(frame);
    if (!box) throw new Error('Editor title area was not found.');
    await frame.page().mouse.click(box.x + 120, box.y + 90);
    log('fillTitle: clicked title via coordinate fallback');
  }

  await frame.page().keyboard.insertText(title);
  await frame.waitForTimeout(500);
}

async function focusBodyWithFallback(frame) {
  const selectors = [
    '.se-component-content p.se-text-paragraph',
    '.se-component-content .se-text-paragraph',
    '.se-section-text .se-module-text p.se-text-paragraph',
    '.se-section-text .se-text-paragraph',
    '.se-module-text p.se-text-paragraph',
    '.se-section-text [contenteditable="true"]',
    '.se-module-text [contenteditable="true"]',
    '.se-text-paragraph'
  ];

  try {
    const target = await firstUsableLocator(frame, selectors, 1);
    await clickEditable(frame, target);
    log('focusBody: clicked body via selector');
  } catch {
    const box = await getEditorBox(frame);
    if (!box) throw new Error('Editor body area was not found.');
    await frame.page().mouse.click(box.x + 120, box.y + 170);
    log('focusBody: clicked body via coordinate fallback');
  }

  await frame.waitForTimeout(300);
  await logStructure(frame, 'after focusBody (before any block)');
}

async function writeBlocks(frame, blocks) {
  // Reference (cousting/3.posting.js) inserts every block through the same
  // contenteditable and presses Enter exactly once afterwards, letting the SE
  // editor drop the caret into a fresh body paragraph. We mirror that here so
  // text reliably lands between images instead of images stacking up.
  // Light plan summary so the terminal shows the shape of the post up front.
  const counts = blocks.reduce((acc, b) => ({ ...acc, [b.type]: (acc[b.type] || 0) + 1 }), {});
  const plan = Object.entries(counts).map(([type, n]) => `${type}×${n}`).join(', ');
  log(`writeBlocks: ${blocks.length} block(s) — ${plan}`);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const preview = block.type === 'image'
      ? block.path
      : String(block.text || '').replace(/\s+/g, ' ').slice(0, 40);
    log(`block[${index + 1}/${blocks.length}] type=${block.type} ${JSON.stringify(preview)}`);

    if (block.type === 'image') {
      if (block.style && block.style.textAlign) await setAlignment(frame, block.style.textAlign);
      await pasteImage(frame, block.path);
      if (block.url) await addLinkToLastImage(frame, block.url).catch(() => {});
      await insertLineBreak(frame);
      if (block.caption) {
        await typeText(frame, block.caption);
        await insertLineBreak(frame);
      }
    } else if (block.type === 'heading') {
      // insertHeading sizes/bolds the line, types it, then resets to body style
      // and leaves the caret on a fresh paragraph — no extra Enter needed here.
      await insertHeading(frame, block.text);
    } else if (block.type === 'quotation') {
      // insertQuotation types the content and escapes the quote block by
      // clicking just below it (reference trick), leaving the caret in a fresh
      // body paragraph — so no extra Enter/spacer is needed here.
      await insertQuotation(frame, block.text, block.style, block.quotationType);
    } else if (block.type === 'divider') {
      await insertDivider(frame, block.style);
      await insertLineBreak(frame);
    } else {
      await applyTextStyle(frame, block.style);
      await typeText(frame, block.text);
      await insertLineBreak(frame);
    }

    await waitForEditorIdle(frame, 300);
    await logStructure(frame, `after block[${index + 1}]`);
  }
}

async function insertLineBreak(frame) {
  await withWatchdog('insertLineBreak (Enter)', 10000, () => frame.page().keyboard.press('Enter'));
  await frame.waitForTimeout(550);
}

// Human-like input: type the text key-by-key at the editor's live caret
// (mirrors the reference's typeText). This looks less like a bot than a single
// clipboard paste and avoids paste-event formatting/order glitches. Page-level
// keyboard typing lands in the focused iframe contenteditable, same as the
// Enter presses used for line breaks.
async function typeText(frame, text) {
  const value = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!value) return;

  // Preserve paragraph structure without re-introducing the old "dozens of
  // Enters" bug (keyboard typing presses Enter for each embedded newline):
  //   - blank line(s) between paragraphs -> one blank line (Enter x2), capped
  //   - a lone newline inside a paragraph -> a soft line break (Enter x1)
  // Runs of blank lines collapse to a single blank line so empty paragraphs
  // never stack up again.
  const paragraphs = value.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
  log(`      typeText: ${paragraphs.length} paragraph(s), ${value.length} chars`);

  for (let p = 0; p < paragraphs.length; p += 1) {
    const lines = paragraphs[p].split('\n').map((line) => line.trim()).filter(Boolean);
    for (let l = 0; l < lines.length; l += 1) {
      const line = lines[l];
      await withWatchdog(`type ${JSON.stringify(line.slice(0, 30))}`, Math.max(15000, line.length * TYPE_DELAY_MS + 5000), () =>
        frame.page().keyboard.type(line, { delay: TYPE_DELAY_MS }));
      if (l < lines.length - 1) await insertLineBreak(frame); // soft break within paragraph
    }
    if (p < paragraphs.length - 1) {
      await insertLineBreak(frame); // end of paragraph
      await insertLineBreak(frame); // one blank line between paragraphs
    }
  }

  await frame.waitForTimeout(200);
  await scrollEditorToBottom(frame);
}

async function pasteText(frame, text) {
  const value = String(text || '').trim();
  if (!value) return;

  // Faithful to the reference (cousting/3.posting.js): focus the first
  // contenteditable and dispatch a paste event at the editor's current caret.
  // We deliberately do NOT relocate the caret, search for the "last" editable,
  // verify insertion, or fall back to a coordinate mouse click — those were
  // what scrambled block order and made the cursor jump around the document.
  const target = await withWatchdog(`pasteText ${JSON.stringify(String(value).slice(0, 30))}`, 15000, () =>
    frame.evaluate((text) => {
      const node = document.querySelector('[contenteditable="true"]');
      if (!node) throw new Error('No contenteditable target for text paste.');
      node.focus();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      node.dispatchEvent(event);
      // Report which element we pasted into, to spot title/body mix-ups.
      const inTitle = !!node.closest('.se-title');
      return { tag: node.tagName, cls: node.className.slice(0, 60), inTitle };
    }, value));
  log(`      pasted into <${target.tag} .${target.cls}>${target.inTitle ? ' [WARNING: inside TITLE]' : ''}`);

  await frame.waitForTimeout(250);
  await scrollEditorToBottom(frame);
}

async function applyTextStyle(frame, style) {
  if (!style) return;
  if (style.fontSize) await setFontSize(frame, style.fontSize);
  if (style.fontFamily) await setFontFamily(frame, style.fontFamily);
  if (style.fontColor) await setFontColor(frame, style.fontColor);
  if (style.textAlign) await setAlignment(frame, style.textAlign);
  if (style.fontWeight) await toggleBold(frame, style.fontWeight === 'bold');
}

// Every toolbar style control shares one gesture: open a dropdown, wait for it
// to render, then click the matching option. openThenPick centralizes that so
// each setter is just its two selectors.
async function openThenPick(frame, openSelector, optionSelector) {
  const opened = await clickFirstVisible(frame, [openSelector]);
  if (!opened) return false;
  await frame.waitForTimeout(300);
  return clickFirstVisible(frame, [optionSelector]);
}

// Font color and background color share the same palette option markup.
function colorOptionSelector(color) {
  return color === 'no-color'
    ? 'button.se-color-palette-no-color'
    : `button.se-color-palette[data-color="${color}"]`;
}

function setFontSize(frame, fontSize) {
  return openThenPick(
    frame,
    'button.se-font-size-code-toolbar-button[data-name="font-size"]',
    `button.se-toolbar-option-font-size-code-fs${fontSize}-button[data-value="fs${fontSize}"]`
  );
}

function setFontFamily(frame, family) {
  return openThenPick(
    frame,
    'button.se-font-family-toolbar-button[data-name="font-family"]',
    `button[data-value="${family}"]`
  );
}

function setFontColor(frame, color) {
  return openThenPick(
    frame,
    'button.se-font-color-toolbar-button[data-name="font-color"]',
    colorOptionSelector(color)
  );
}

function setAlignment(frame, alignment) {
  return openThenPick(
    frame,
    'button.se-property-toolbar-drop-down-button[data-name="align-drop-down-with-justify"]',
    `button.se-toolbar-option-align-${alignment}-button[data-value="${alignment}"]`
  );
}

function toggleBold(frame, enable) {
  return toggleInlineStyle(frame, 'button.se-bold-toolbar-button[data-name="bold"]', enable);
}

// Italic/underline/strikethrough share the same toggle pattern as bold: the
// button carries `se-is-selected` when active, so we only click when the
// desired state differs. Selectors mirror the reference (4.posting.js).
async function toggleInlineStyle(frame, selector, enable) {
  const button = frame.locator(selector).first();
  if (!await button.isVisible().catch(() => false)) return false;
  const isActive = await button
    .evaluate((node) => node.classList.contains('se-is-selected'))
    .catch(() => false);
  if (enable !== isActive) {
    await button.click().catch(() => {});
    await frame.waitForTimeout(300);
  }
  return true;
}

async function toggleItalic(frame, enable) {
  return toggleInlineStyle(frame, 'button.se-italic-toolbar-button[data-name="italic"]', enable);
}

async function toggleUnderline(frame, enable) {
  return toggleInlineStyle(frame, 'button.se-underline-toolbar-button[data-name="underline"]', enable);
}

async function toggleStrikethrough(frame, enable) {
  return toggleInlineStyle(frame, 'button.se-strikethrough-toolbar-button[data-name="strikethrough"]', enable);
}

function setBackgroundColor(frame, color) {
  return openThenPick(
    frame,
    'button.se-background-color-toolbar-button[data-name="background-color"]',
    colorOptionSelector(color)
  );
}

function setLineHeight(frame, height) {
  return openThenPick(
    frame,
    'button.se-line-height-toolbar-button[data-name="line-height"]',
    `button.se-toolbar-option-line-height-lh${height}-button[data-value="lh${height}"]`
  );
}

async function insertHeading(frame, text) {
  const value = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!value) return;
  log(`insertHeading: ${JSON.stringify(value.slice(0, 30))}`);

  // Apply heading look (larger + bold), type it, then move to a new paragraph
  // and RESET to body size / bold-off so the following text isn't all big/bold.
  await setFontSize(frame, HEADING_FONT_SIZE);
  await toggleBold(frame, true);
  await typeText(frame, value);
  await insertLineBreak(frame);
  await toggleBold(frame, false);
  await setFontSize(frame, BODY_FONT_SIZE);
}

async function insertQuotation(frame, text, style, quotationType = 'quotation1') {
  const value = String(text || '').trim();
  const dataValue = QUOTATION_DATA_VALUE[quotationType] || 'default';
  log(`insertQuotation: type=${quotationType} dataValue=${dataValue}`);

  try {
    // 1) Insert the quotation block. quotation1 is the direct toolbar button;
    //    2-6 open the "select style" dropdown and pick the variant.
    if (dataValue === 'default') {
      const inserted = await clickFirstVisible(frame, [
        'button.se-insert-quotation-default-toolbar-button[data-name="quotation"]',
        'button[data-name="quotation"]'
      ]);
      if (!inserted) throw new Error('quotation button not found');
    } else {
      const opened = await clickFirstVisible(frame, [
        'button.se-document-toolbar-select-option-button[data-name="quotation"]'
      ]);
      if (!opened) throw new Error('quotation style dropdown not found');
      await frame.waitForTimeout(400);
      const picked = await clickFirstVisible(frame, [
        `button[data-name="quotation"][data-role="option"][data-value="${dataValue}"]`
      ]);
      if (!picked) throw new Error(`quotation option not found: ${dataValue}`);
    }
    await frame.waitForTimeout(500);

    // 2) Per-quotation style (size/color/weight), then type the content.
    await applyTextStyle(frame, style);
    await typeText(frame, value);
    await frame.waitForTimeout(300);

    // 3) Escape the quote block by clicking just below it, so the next block
    //    lands in a fresh body paragraph (reference trick — avoids the SE
    //    editor refusing a plain paragraph right after a quotation).
    await escapeQuotation(frame);
  } catch (error) {
    log(`insertQuotation fallback to plain text: ${error.message}`);
    await typeText(frame, value);
    await insertLineBreak(frame);
  }
}

async function escapeQuotation(frame) {
  await scrollEditorToBottom(frame);
  const clickPos = await frame.evaluate(() => {
    const quotes = document.querySelectorAll('.se-component.se-quotation');
    if (quotes.length === 0) return null;
    const rect = quotes[quotes.length - 1].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom + 30 };
  }).catch(() => null);

  if (!clickPos) {
    // No quote component to click below — fall back to a single Enter.
    await insertLineBreak(frame);
    return;
  }

  const frameElement = await frame.frameElement().catch(() => null);
  const frameBox = frameElement ? await frameElement.boundingBox().catch(() => null) : null;
  if (!frameBox) {
    await insertLineBreak(frame);
    return;
  }

  await frame.page().mouse.click(frameBox.x + clickPos.x, frameBox.y + clickPos.y);
  await frame.waitForTimeout(600);
}

async function insertDivider(frame, style) {
  if (style && style.textAlign) await setAlignment(frame, style.textAlign);

  const inserted = await clickFirstVisible(frame, [
    'button.se-document-toolbar-icon-select-button.se-insert-horizontal-line-default-toolbar-button[data-name="horizontal-line"][data-value="default"]',
    'button[data-name="horizontal-line"][data-value="default"]',
    'button[data-name="horizontal-line"]'
  ]);

  if (!inserted) await pasteText(frame, '---');
  await frame.waitForTimeout(350);
}

async function pasteImage(frame, imagePath) {
  await assertImagePath(imagePath);
  const imageData = await fs.readFile(imagePath);
  const beforeCount = await frame.locator('.se-section-image img.se-image-resource').count().catch(() => 0);
  const mimeType = getImageMimeType(imagePath);

  await withWatchdog(`pasteImage dispatch (${beforeCount} imgs before)`, 20000, () =>
    frame.evaluate(async ({ base64Image, mimeType }) => {
      function dataURLtoBlob(dataurl) {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], { type: mime });
      }

      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      const blob = dataURLtoBlob(dataUrl);
      const extension = mimeType.split('/')[1] || 'jpg';
      const file = new File([blob], `image.${extension}`, { type: blob.type });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const target = document.querySelector('[contenteditable="true"]');
      if (!target) throw new Error('No contenteditable target for image paste.');
      target.focus();
      const event = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      target.dispatchEvent(event);
      return true;
    }, { base64Image: imageData.toString('base64'), mimeType }));

  await withWatchdog('waitForImageInserted', 32000, () => waitForImageInserted(frame, beforeCount));
  const afterCount = await frame.locator('.se-section-image img.se-image-resource').count().catch(() => 0);
  log(`      image count ${beforeCount} -> ${afterCount}`);
  await scrollEditorToBottom(frame);
  await waitForEditorIdle(frame, 1600);
}

async function addLinkToLastImage(frame, linkUrl) {
  const url = String(linkUrl || '').trim();
  if (!url) return false;

  const imageSelector = '.se-section.se-section-image img.se-image-resource, .se-section-image img.se-image-resource';
  await frame.waitForSelector(imageSelector, { timeout: 30000 });
  const images = await frame.locator(imageSelector).all();
  const target = images[images.length - 1];
  if (!target) return false;

  await target.click();
  await frame.waitForTimeout(500);

  const linkButtonClicked = await clickFirstVisible(frame, [
    '.se-link-toolbar-button',
    '.se-toolbar-item-link button',
    'button[data-name="link"]'
  ]);
  if (!linkButtonClicked) return false;

  const input = await firstVisibleLocator(frame, [
    '.se-custom-layer-link-input',
    'input[data-role="input"][type="url"]',
    'input[type="url"]'
  ]);
  if (!input) return false;

  await input.fill(url);
  const applied = await clickFirstVisible(frame, [
    '.se-custom-layer-link-apply-button',
    'button[data-role="confirm"]'
  ]);

  await frame.waitForTimeout(500);
  return applied;
}

async function clickFirstVisible(frame, selectors) {
  const locator = await firstVisibleLocator(frame, selectors);
  if (!locator) return false;
  await locator.click().catch(() => null);
  return true;
}

async function firstVisibleLocator(frame, selectors) {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function waitForEditorIdle(frame, timeout = 800) {
  await frame.waitForTimeout(timeout);
}

// Mirror of the reference's scrollToBottom: keep the live caret area in view so
// the editor renders the next insertion point correctly.
async function scrollEditorToBottom(frame) {
  const evaluation = frame.evaluate(() => {
    const scrollTarget = document.querySelector('.se-content.__se-scroll-target');
    if (scrollTarget) scrollTarget.scrollTo(0, scrollTarget.scrollHeight);
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
  await Promise.race([evaluation, timeout]).catch(() => {});
  await frame.waitForTimeout(200);
}

async function assertImagePath(imagePath) {
  const stat = await fs.stat(imagePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error(`Image file was not found: ${imagePath}`);
}

async function waitForImageInserted(frame, beforeCount) {
  const selector = '.se-section-image img.se-image-resource';
  const inserted = await frame.waitForFunction(
    ({ selector, beforeCount }) => document.querySelectorAll(selector).length > beforeCount,
    { selector, beforeCount },
    { timeout: 30000 }
  ).then(() => true).catch(() => false);

  if (!inserted) throw new Error('Image paste did not create a Naver image block.');
}

async function firstUsableLocator(frame, selectors, preferredIndex = 0) {
  for (const selector of selectors) {
    const locators = await frame.locator(selector).all();
    if (locators.length === 0) continue;

    const ordered = [
      ...locators.slice(preferredIndex),
      ...locators.slice(0, preferredIndex)
    ];

    for (const locator of ordered) {
      if (await isUsableEditorTarget(locator).catch(() => false)) return locator;
    }
  }

  throw new Error('Editable area was not found.');
}

async function isUsableEditorTarget(locator) {
  if (!await locator.isVisible().catch(() => false)) return false;

  const box = await locator.boundingBox().catch(() => null);
  if (!box || box.width < 20 || box.height < 10) return false;
  if (box.x < 0 || box.y < 0) return false;

  return locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    if (node.getAttribute('aria-hidden') === 'true') return false;
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (rect.bottom <= 0 || rect.right <= 0) return false;
    if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
    return true;
  });
}

async function clickEditable(frame, locator) {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
    await locator.click({ timeout: 3000 });
    return;
  } catch {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Could not calculate editable area coordinates.');
    await frame.page().mouse.click(
      box.x + Math.min(box.width / 2, 80),
      box.y + Math.min(box.height / 2, 20)
    );
  }
}

async function getEditorBox(frame) {
  const selectors = [
    '.se-write-area',
    '.se-content',
    '.se-container',
    '#postWriteArea',
    'body'
  ];

  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if (!await locator.isVisible().catch(() => false)) continue;
    const box = await locator.boundingBox().catch(() => null);
    if (box && box.width > 300 && box.height > 200) return box;
  }

  return null;
}

module.exports = {
  fillEditorDraft,
  waitForEditorFrame,
  withFreshEditorFrame
};
