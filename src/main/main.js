const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const WindowState = require('electron-window-state');

const state = require('./state');
const constants = require('./constants');
const { initializeIpc } = require('./ipc');
const sessionModule = require('./session');
const settingsModule = require('./settings');
const tabsModule = require('./tabs');
const { getSerializableTabData, debounce } = require('./utils');

// Gracefully handle unhandled exceptions
process.on('uncaughtException', (error, origin) => {
  console.error(`Caught exception: ${error}\n` + `Exception origin: ${origin}`);
});

// Ensure single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow() {
  const mainWindowState = WindowState({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  const win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 13 },
    icon: path.join(__dirname, '../../appicon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Update state
  state.setMainWindow(win);
  mainWindowState.manage(win);
  state.settings = settingsModule.loadSettings();

  win.loadFile('src/renderer/index.html');
  // win.webContents.openDevTools({ mode: 'detach' });

  win.on('maximize', () => win.webContents.send('window:maximize-changed', true));
  win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false));
  win.on('blur', () => win.webContents.send('window:blurred'));
  
  const debouncedUpdateViewBounds = debounce(() => tabsModule?.updateViewBounds(), 100);
  win.on('resize', debouncedUpdateViewBounds);
  
  win.on('close', (e) => {
    if (state.tabs.size > 0) sessionModule.saveSession();
  });

  win.on('closed', () => {
    state.setMainWindow(null);
  });

  win.webContents.on('did-finish-load', async () => {
    const savedSession = sessionModule.loadSession();
    if (savedSession && savedSession.tabs.length > 0) {
      win.webContents.send('session:restore-ui', {
        tabs: savedSession.tabs,
        groups: savedSession.groups,
        layout: savedSession.layout,
        activeTabId: savedSession.activeTabId,
      });

      const createAllTabs = async () => {
        const globalZoom = 1.0;
        savedSession.tabs.forEach(t => {
          const isHibernated = t.id !== savedSession.activeTabId;
          state.tabs.set(t.id, {
            ...t,
            zoomFactor: t.zoomFactor === undefined ? globalZoom : t.zoomFactor,
            view: null, session: null,
            canGoBack: false, canGoForward: false,
            isLoading: !isHibernated, isLoaded: false,
            isHibernated,
            lastActive: Date.now(),
            cssKeys: new Map(),
          });
        });
        
        savedSession.groups.forEach(g => state.groups.set(g.id, g));
        state.layout = savedSession.layout;
        state.activeTabId = savedSession.activeTabId;
        await tabsModule.switchTab(state.activeTabId);
      };
      createAllTabs();

    } else {
      const newTab = tabsModule.createTab();
      state.layout.push(newTab.id);
      win.webContents.send('tab:created', getSerializableTabData(newTab));
      await tabsModule.switchTab(newTab.id);
    }
  });
}

app.whenReady().then(() => {
  initializeIpc();

  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'browserView') {
      contents.on('found-in-page', (event, result) => {
        if (result.finalUpdate && state.mainWindow) {
            state.mainWindow.webContents.send('find:result', {
              matches: result.matches,
              activeMatchOrdinal: result.activeMatchOrdinal
            });
        }
      });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});