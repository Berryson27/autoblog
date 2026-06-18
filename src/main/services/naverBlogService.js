const { createBrowserSession } = require('./browserSession');
const { fillEditorDraft } = require('./naverEditorService');
const {
  buildWriteUrl,
  createDraftOutput,
  getImageMimeType,
  normalizeBlocks,
  normalizeTags,
  validateDraftPayload
} = require('./naverDraftPayload');

const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';

function createNaverBlogService({ userDataDir, browserWindow, notify }) {
  const browserSession = createBrowserSession({ userDataDir, browserWindow, notify });

  async function openLogin() {
    const activePage = await browserSession.ensurePage();
    await activePage.goto(NAVER_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    notify({ level: 'info', message: 'Naver login page opened. Log in manually.' });
    return { ok: true };
  }

  async function openWrite({ blogId }) {
    const activePage = await browserSession.ensurePage();
    await activePage.goto(buildWriteUrl(blogId), { waitUntil: 'domcontentloaded' });
    notify({ level: 'info', message: 'Naver blog write page opened.' });
    return { ok: true };
  }

  async function fillDraft(payload) {
    validateDraftPayload(payload);
    const draftOutput = createDraftOutput(payload);
    const activePage = await browserSession.ensurePage();
    await ensureWritePage(activePage, draftOutput.blogId);
    await fillEditorDraft(activePage, {
      title: draftOutput.title,
      blocks: draftOutput.blocks,
      // Optional body-wide styles (line spacing, italic, …); absent unless the
      // payload supplied its own contentStyles.
      contentStyles: draftOutput.contentStyles
    });

    notify({ level: 'success', message: 'Draft blocks were inserted. Review before publishing.' });
    return { ok: true };
  }

  async function close() {
    await browserSession.close();
    notify({ level: 'info', message: 'Playwright browser closed.' });
  }

  return { openLogin, openWrite, fillDraft, close };
}

async function ensureWritePage(page, blogId) {
  const url = page.url();
  const isWritePage = url.includes('blog.naver.com') && (url.includes('Redirect=Write') || url.includes('PostWriteForm'));
  if (!isWritePage) {
    await page.goto(buildWriteUrl(blogId), { waitUntil: 'domcontentloaded' });
  }
}

module.exports = {
  buildWriteUrl,
  createDraftOutput,
  getImageMimeType,
  normalizeBlocks,
  normalizeTags,
  validateDraftPayload,
  createNaverBlogService
};
