const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('autoclick', {
  openLogin: () => ipcRenderer.invoke('naver:open-login'),
  openWrite: (payload) => ipcRenderer.invoke('naver:open-write', payload),
  fillDraft: (payload) => ipcRenderer.invoke('naver:fill-draft', payload),
  generatePost: (payload) => ipcRenderer.invoke('generation:generate-post', payload),
  getGenerationResult: (generationId) => ipcRenderer.invoke('generation:get-result', generationId),
  pickImages: () => ipcRenderer.invoke('files:pick-images'),
  createImageAssets: (filePaths) => ipcRenderer.invoke('files:create-image-assets', filePaths),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  closeBrowser: () => ipcRenderer.invoke('naver:close-browser'),
  onStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('automation-status', listener);
    return () => ipcRenderer.removeListener('automation-status', listener);
  }
});
