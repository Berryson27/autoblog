const { app, BrowserWindow, clipboard, dialog, ipcMain, screen } = require('electron');
const path = require('node:path');
const { createNaverBlogService } = require('./services/naverBlogService');
const { createImageAssets } = require('./services/imageAssetService');
const { createGenerationService } = require('./services/generationService');

let mainWindow;
let blogService;
let generationService;

function fitWindowSize(preferred, minimum, available) {
  const max = Math.max(320, available - 40);
  return Math.max(Math.min(preferred, max), Math.min(minimum, max));
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const mainWidth = fitWindowSize(940, 860, workArea.width);
  const mainHeight = fitWindowSize(700, 640, workArea.height);
  const browserWidth = fitWindowSize(1040, 860, workArea.width);
  const browserHeight = fitWindowSize(760, 640, workArea.height);

  mainWindow = new BrowserWindow({
    x: workArea.x + Math.max(20, Math.floor((workArea.width - mainWidth) / 2)),
    y: workArea.y + Math.max(20, Math.floor((workArea.height - mainHeight) / 2)),
    width: mainWidth,
    height: mainHeight,
    minWidth: Math.min(860, mainWidth),
    minHeight: Math.min(640, mainHeight),
    title: 'Naver Blog Writer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  blogService = createNaverBlogService({
    userDataDir: path.join(app.getPath('userData'), 'naver-playwright-profile'),
    browserWindow: {
      x: workArea.x + Math.max(20, workArea.width - browserWidth - 20),
      y: workArea.y + 20,
      width: browserWidth,
      height: browserHeight
    },
    notify: sendStatus
  });

  generationService = createGenerationService();
}

function sendStatus(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('automation-status', event);
}

ipcMain.handle('naver:open-login', async () => {
  return blogService.openLogin();
});

ipcMain.handle('naver:open-write', async (_event, payload) => {
  return blogService.openWrite(payload);
});

ipcMain.handle('naver:fill-draft', async (_event, payload) => {
  return blogService.fillDraft(payload);
});

ipcMain.handle('generation:generate-post', async (_event, payload) => {
  return generationService.generatePost(payload);
});

ipcMain.handle('generation:get-result', async (_event, generationId) => {
  return generationService.getGenerationResult(generationId);
});

ipcMain.handle('files:pick-images', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select images',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]
  });

  if (result.canceled) return [];
  return createImageAssets(result.filePaths);
});

ipcMain.handle('files:create-image-assets', async (_event, filePaths) => {
  return createImageAssets(filePaths);
});

ipcMain.handle('naver:close-browser', async () => {
  if (!blogService) return { ok: true };
  await blogService.close();
  return { ok: true };
});

ipcMain.handle('clipboard:write-text', async (_event, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
