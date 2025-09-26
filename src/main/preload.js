const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChanged: (callback) => ipcRenderer.on('window:maximize-changed', (_e, state) => callback(state)),
  onWindowBlurred: (callback) => ipcRenderer.on('window:blurred', (_e) => callback()),

  // Tab Controls
  newTab: () => ipcRenderer.invoke('tab:new'),
  duplicateTab: (id) => ipcRenderer.invoke('tab:duplicate', id),
  closeTab: (id) => ipcRenderer.invoke('tab:close', id),
  switchTab: (id) => ipcRenderer.invoke('tab:switch', id),
  toggleTabShared: (id) => ipcRenderer.invoke('tab:toggle-shared', id),
  clearCacheAndReload: (id) => ipcRenderer.invoke('tab:clear-cache-and-reload', id),
  
  // View Controls
  hideActiveView: () => ipcRenderer.invoke('view:hide'),
  showActiveView: () => ipcRenderer.invoke('view:show'),

  // Layout & Group Management
  updateLayout: (layout, groups) => ipcRenderer.invoke('layout:update', layout, groups),
  getAllTabs: () => ipcRenderer.invoke('tabs:getAll'),

  // Navigation Controls
  loadURL: (url) => ipcRenderer.invoke('tab:loadURL', url),
  goBack: () => ipcRenderer.invoke('tab:goBack'),
  goForward: () => ipcRenderer.invoke('tab:goForward'),
  reload: () => ipcRenderer.invoke('tab:reload'),

  // Find In Page
  findStart: (text) => ipcRenderer.invoke('find:start', text),
  findNext: (text, forward) => ipcRenderer.invoke('find:next', text, forward),
  findStop: () => ipcRenderer.invoke('find:stop'),
  onFindResult: (callback) => ipcRenderer.on('find:result', (_e, result) => callback(result)),

  // Zoom
  updateTabZoom: (id, factor) => ipcRenderer.invoke('tab:update-zoom', { id, factor }),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setDefaultFont: (fontFamily) => ipcRenderer.invoke('settings:set-default-font', fontFamily),
  settingsSetSearchEngine: (engine) => ipcRenderer.invoke('settings:set-search-engine', engine),

  // Listeners from Main
  onSessionRestoreUI: (callback) => ipcRenderer.once('session:restore-ui', (_e, data) => callback(data)),
  onTabCreated: (callback) => ipcRenderer.on('tab:created', (_e, tabData) => callback(tabData)),
  onTabCreatedWithLayout: (callback) => ipcRenderer.on('tab:created-with-layout', (_e, data) => callback(data)),
  onTabSwitched: (callback) => ipcRenderer.on('tab:switched', (_e, id) => callback(id)),
  onTabUpdated: (callback) => ipcRenderer.on('tab:updated', (_e, update) => callback(update)),
  onTabClosed: (callback) => ipcRenderer.on('tab:closed', (_e, id) => callback(id)),
  onCloseTabFromView: (callback) => ipcRenderer.on('close-tab-from-view', (_e, id) => callback(id)),
});