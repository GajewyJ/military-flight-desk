const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSim', {
  isElectron: true,

  // Native Save File Dialog Window Popup
  saveFileDialog: (defaultFilename, content, extension = 'pln', filterName = 'MSFS Flight Plan') =>
    ipcRenderer.invoke('sim:save-file-dialog', { defaultFilename, content, extension, filterName }),

  // Native Save PDF Dialog Window Popup
  savePdfDialog: (defaultFilename, pdfBase64) =>
    ipcRenderer.invoke('sim:save-pdf-dialog', { defaultFilename, pdfBase64 }),

  // Reveal saved file in OS File Explorer / Finder
  showItemInFolder: (filePath) => ipcRenderer.invoke('sim:show-item', filePath),
});
