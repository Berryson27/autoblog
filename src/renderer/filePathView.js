(function () {
  function getFileName(filePath) {
    return String(filePath || '').split(/[\\/]/).pop() || filePath;
  }

  function toFileUrl(filePath) {
    const normalizedPath = String(filePath || '').replace(/\\/g, '/');
    return `file:///${encodeURI(normalizedPath)}`;
  }

  window.filePathView = {
    getFileName,
    toFileUrl
  };
})();
