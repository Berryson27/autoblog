const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFilePathView() {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/renderer/filePathView.js'),
    'utf8'
  );
  const context = {
    window: {},
    encodeURI
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.filePathView;
}

test('filePathView extracts file names from local paths', () => {
  const filePathView = loadFilePathView();
  assert.equal(filePathView.getFileName('C:\\images\\photo.png'), 'photo.png');
});

test('filePathView creates file URLs for local preview images', () => {
  const filePathView = loadFilePathView();
  assert.equal(
    filePathView.toFileUrl('C:\\images\\photo 1.png'),
    'file:///C:/images/photo%201.png'
  );
});
