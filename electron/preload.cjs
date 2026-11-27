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

  // Library of saved missions and flown flights, in the application's data folder
  library: {
    list: (kind) => ipcRenderer.invoke('library:list', kind),
    read: (kind, id) => ipcRenderer.invoke('library:read', kind, id),
    write: (kind, id, meta, data) => ipcRenderer.invoke('library:write', kind, id, meta, data),
    remove: (kind, id) => ipcRenderer.invoke('library:remove', kind, id),
  },

  // Live link to the simulator (SimConnect): switch on/off, read the status, receive the aircraft data
  simLink: {
    setEnabled: (on) => ipcRenderer.invoke('sim:link-enable', Boolean(on)),
    getStatus: () => ipcRenderer.invoke('sim:link-status'),
    onSample: (callback) => {
      const handler = (_event, sample) => callback(sample);
      ipcRenderer.on('sim:link-sample', handler);
      return () => ipcRenderer.removeListener('sim:link-sample', handler);
    },
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('sim:link-status', handler);
      return () => ipcRenderer.removeListener('sim:link-status', handler);
    },
  },
});
