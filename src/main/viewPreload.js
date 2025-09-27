const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewAPI', {
  // This allows the error page to request a reload of the original failed URL.
  reloadCurrentPage: () => ipcRenderer.send('view:reload-current'),

  // These allow the new tab page to interact with the main process.
  loadURL: (url) => ipcRenderer.send('view:loadURL', url),
  closeTab: () => ipcRenderer.send('view:close'),
  showInputContextMenu: () => ipcRenderer.invoke('input:show-context-menu'),
});