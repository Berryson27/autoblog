const { chromium } = require('playwright');

function createBrowserSession({ userDataDir, browserWindow, notify }) {
  let context;
  let page;

  async function ensurePage() {
    if (!context) {
      notify({ level: 'info', message: 'Playwright browser is opening.' });
      context = await launchContext(userDataDir, browserWindow);
      page = context.pages()[0] || await context.newPage();
      attachPageDebugLogging(page);
    }

    if (!page || page.isClosed()) {
      page = await context.newPage();
      attachPageDebugLogging(page);
    }

    return page;
  }

  async function close() {
    if (context) await context.close();
    context = null;
    page = null;
  }

  return { ensurePage, close };
}

function attachPageDebugLogging(page) {
  if (!page || page.__debugLoggingAttached) return;
  page.__debugLoggingAttached = true;

  const stamp = () => new Date().toISOString().slice(11, 23);

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`[page ${stamp()} console:${type}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[page ${stamp()} pageerror] ${error.message}`);
  });
  page.on('crash', () => {
    console.log(`[page ${stamp()}] *** PAGE CRASHED ***`);
  });
  page.on('dialog', async (dialog) => {
    console.log(`[page ${stamp()} dialog:${dialog.type()}] "${dialog.message()}" -> dismissing`);
    await dialog.dismiss().catch(() => {});
  });
  page.on('framedetached', (frame) => {
    console.log(`[page ${stamp()}] frame detached: ${frame.name() || frame.url()}`);
  });
}

async function launchContext(userDataDir, browserWindow) {
  const baseOptions = {
    headless: false,
    viewport: null,
    args: [
      `--window-position=${browserWindow.x},${browserWindow.y}`,
      `--window-size=${browserWindow.width},${browserWindow.height}`
    ]
  };

  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...baseOptions,
      channel: 'chrome'
    });
  } catch {
    return chromium.launchPersistentContext(userDataDir, baseOptions);
  }
}

module.exports = { createBrowserSession, launchContext };
