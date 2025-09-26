const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewAPI', {
  // This allows the error page to request a reload of the original failed URL.
  reloadCurrentPage: () => ipcRenderer.send('view:reload-current'),
});
