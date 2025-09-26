const { app, BrowserWindow, BrowserView, Menu, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const WindowState = require('electron-window-state');
const { randomUUID } = require('crypto');

// Gracefully handle unhandled exceptions to prevent default error dialogs
process.on('uncaughtException', (error, origin) => {
  console.error(`Caught exception: ${error}\n` + `Exception origin: ${origin}`);
});

// Ensure single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow;

const tabs = new Map();
const groups = new Map();
let layout = []; // Can contain tab IDs and group IDs
let activeTabId = null;

const CHROME_HEIGHT = 39; // Height of the unified titlebar/toolbar + 1px border
const SESSION_PATH = path.join(app.getPath('userData'), 'session.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
let settings = {};
const PREDEFINED_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
  '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
  '#aed581', '#dce775', '#fff176', '#ffd54f', '#ffb74d', '#ff8a65'
];
const HIBERNATION_THRESHOLD = 5 * 60 * 1000; // 5 minutes
const HIBERNATION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

const BROWSER_VIEW_WEBCONTENTS_CONFIG = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  plugins: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  preload: path.join(__dirname, 'viewPreload.js'),
};

// --- Settings ---
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return {}; // Return empty object on failure or if file doesn't exist
}

const debouncedSaveSettings = debounce(() => {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}, 500);

async function applyFontSetting(tab, fontFamily) {
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
    const webContents = tab.view.webContents;
    const existingKey = tab.cssKeys.get('defaultFont');

    if (existingKey) {
        try {
            await webContents.removeInsertedCSS(existingKey);
        } catch (e) {
            // Ignore errors if webContents is gone
        } finally {
            tab.cssKeys.delete('defaultFont');
        }
    }

    if (fontFamily && fontFamily !== 'default') {
        const css = `* { font-family: "${fontFamily}" !important; }`;
        try {
            const newKey = await webContents.insertCSS(css);
            tab.cssKeys.set('defaultFont', newKey);
        } catch (e) {
            console.error('Failed to insert font CSS:', e);
        }
    }
}


function getRandomColor() {
  return PREDEFINED_COLORS[Math.floor(Math.random() * PREDEFINED_COLORS.length)];
}

/**
 * Creates a plain, serializable object from a tab data object,
 * suitable for sending over IPC.
 * @param {object} tab The full tab object from the `tabs` map.
 * @returns {object|null} A serializable object or null.
 */
function getSerializableTabData(tab) {
  if (!tab) return null;
  // Destructure to only include properties safe for IPC
  const { id, url, title, canGoBack, canGoForward, isLoading, isLoaded, isHibernated, color } = tab;
  return { id, url, title, canGoBack, canGoForward, isLoading, isLoaded, isHibernated, color };
}


function getActiveTab() {
  return tabs.get(activeTabId);
}

function updateViewBounds() {
  const tab = getActiveTab();
  if (!tab || !tab.view) return;
  const [width, height] = mainWindow.getContentSize();
  tab.view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: height - CHROME_HEIGHT });
}

function saveSession() {
  // Don't save if there's no main window or no tabs.
  // This can prevent writing an empty session file on quit.
  if (!mainWindow || tabs.size === 0) return;

  try {
    const sessionState = {
      tabs: Array.from(tabs.values()).map(t => {
        let finalUrl = t.url;
        if (!t.isHibernated && t.view) {
          const currentWebContentsUrl = t.view.webContents.getURL();
          if (currentWebContentsUrl && currentWebContentsUrl.endsWith('newtab.html')) {
            finalUrl = 'about:blank';
          } else {
            finalUrl = currentWebContentsUrl || t.url;
          }
        }
        return {
          id: t.id,
          url: finalUrl,
          title: t.title,
          color: t.color,
          isActive: t.id === activeTabId,
        };
      }),
      groups: Array.from(groups.values()),
      layout,
      activeTabId,
    };
    const tempPath = SESSION_PATH + '.tmp';
    // Use sync writing for atomicity. Given it's debounced, the performance hit is negligible.
    fs.writeFileSync(tempPath, JSON.stringify(sessionState, null, 2));
    fs.renameSync(tempPath, SESSION_PATH);
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

function loadSession() {
  const tempPath = SESSION_PATH + '.tmp';
  let sessionFileToLoad = null;

  if (fs.existsSync(SESSION_PATH)) {
      sessionFileToLoad = SESSION_PATH;
  } else if (fs.existsSync(tempPath)) {
      // If main file is missing but temp exists, app likely crashed during save.
      console.log('Restoring session from .tmp file due to possible crash.');
      sessionFileToLoad = tempPath;
  }

  if (sessionFileToLoad) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionFileToLoad, 'utf-8'));
      // If we successfully loaded from temp, rename it to main file for consistency.
      if (sessionFileToLoad === tempPath) {
          fs.renameSync(tempPath, SESSION_PATH);
      }
      return data;
    } catch (e) {
      console.error(`Failed to load session from ${sessionFileToLoad}:`, e);
      // Corrupted file, start fresh.
      return null;
    }
  }
  return null;
}

function debounce(func, timeout = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

const debouncedSaveSession = debounce(saveSession);

function attachViewListenersToTab(tabData) {
  const { id, view } = tabData;

  view.webContents.on('did-start-loading', () => {
    tabData.isLoading = true;
    mainWindow.webContents.send('tab:updated', { id, isLoading: true });
  });

  view.webContents.on('did-stop-loading', () => {
    tabData.isLoading = false;
    tabData.isLoaded = true;
    mainWindow.webContents.send('tab:updated', { id, isLoading: false, isLoaded: true });
  });

  view.webContents.on('page-title-updated', (_, title) => {
    tabData.title = title;
    mainWindow.webContents.send('tab:updated', { id, title });
    debouncedSaveSession();
  });

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // Ignore ERR_ABORTED

    console.error(`Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    
    const errorPagePath = path.join(__dirname, '../renderer/error.html');
    const encodedURL = encodeURIComponent(validatedURL);
    const encodedDesc = encodeURIComponent(errorDescription);
    
    view.webContents.loadFile(errorPagePath, { hash: `code=${errorCode}&desc=${encodedDesc}&url=${encodedURL}` });
    
    tabData.title = 'Page Not Found';
    tabData.isLoading = false;
    mainWindow.webContents.send('tab:updated', { 
        id, 
        title: tabData.title, 
        isLoading: false 
    });
  });

  view.webContents.on('did-navigate', async (_, newUrl) => {
    if (newUrl.startsWith('file://') && newUrl.includes('error.html')) {
      tabData.canGoBack = view.webContents.canGoBack();
      tabData.canGoForward = view.webContents.canGoForward();
      mainWindow.webContents.send('tab:updated', { id, canGoBack: tabData.canGoBack, canGoForward: tabData.canGoForward });
      return;
    }

    const isNewTabPage = newUrl.endsWith('newtab.html');
    if (isNewTabPage) {
        tabData.url = 'about:blank'; // Store clean URL for session saving
        tabData.title = 'New Tab';
        tabData.canGoBack = false;
        tabData.canGoForward = false;
        mainWindow.webContents.send('tab:updated', { id, url: '', title: 'New Tab', canGoBack: false, canGoForward: false });
        // Don't apply font or save session for this transient page
        return;
    }

    tabData.url = newUrl;
    tabData.canGoBack = view.webContents.canGoBack();
    tabData.canGoForward = view.webContents.canGoForward();
    mainWindow.webContents.send('tab:updated', { id, url: newUrl, canGoBack: tabData.canGoBack, canGoForward: tabData.canGoForward });
    
    // Re-apply font on every navigation to ensure it persists.
    // applyFontSetting handles removing the old style before adding the new one.
    await applyFontSetting(tabData, settings.defaultFont);

    debouncedSaveSession();
  });
  
  view.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }; // Disallow popups
  });
}

async function createTab(url = 'about:blank', options = {}) {
  const { fromTabId, id: existingId } = options;
  const id = existingId || `tab-${randomUUID()}`;
  const partition = `persist:${id}`;
  const tabSession = session.fromPartition(partition);

  // Set a minimal user agent
  tabSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');

  const view = new BrowserView({
    webPreferences: {
      partition,
      ...BROWSER_VIEW_WEBCONTENTS_CONFIG
    },
  });

  const tabData = {
    id,
    view,
    session: tabSession,
    url,
    title: 'New Tab',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isLoaded: false,
    isHibernated: false,
    lastActive: Date.now(),
    color: fromTabId ? (tabs.get(fromTabId)?.color || getRandomColor()) : getRandomColor(),
    cssKeys: new Map(),
  };
  tabs.set(id, tabData);

  attachViewListenersToTab(tabData);

  if (url === 'about:blank') {
    await view.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
  } else {
    await view.webContents.loadURL(url);
  }
  return tabData;
}

function hibernateTab(tab) {
    if (!tab || !tab.view || tab.id === activeTabId || tab.isHibernated) return;

    console.log(`Hibernating tab ${tab.id} (${tab.title})`);
    
    const currentURL = tab.view.webContents.getURL();
    if (currentURL && !currentURL.startsWith('file://')) {
      tab.url = currentURL;
    }
    
    tab.view.webContents.destroy();
    tab.view = null;
    tab.isHibernated = true;
    
    mainWindow.webContents.send('tab:updated', { id: tab.id, isHibernated: true, url: tab.url });
    debouncedSaveSession();
}

function startHibernationTimer() {
    setInterval(() => {
        const now = Date.now();
        tabs.forEach(tab => {
            if (tab.id !== activeTabId && !tab.isHibernated && (now - tab.lastActive > HIBERNATION_THRESHOLD)) {
                hibernateTab(tab);
            }
        });
    }, HIBERNATION_CHECK_INTERVAL);
}

function createWindow() {
  const mainWindowState = WindowState({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  mainWindow = new BrowserWindow({
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

  mainWindowState.manage(mainWindow);
  settings = loadSettings();
  mainWindow.loadFile('src/renderer/index.html');
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-changed', false));
  mainWindow.on('blur', () => mainWindow.webContents.send('window:blurred'));
  
  const debouncedUpdateViewBounds = debounce(updateViewBounds, 100);
  mainWindow.on('resize', debouncedUpdateViewBounds);
  
  mainWindow.on('close', (e) => {
    // Perform a final, non-debounced save on exit.
    if (tabs.size > 0) saveSession();
  });

  mainWindow.on('closed', () => {
    // Nullify the window object when it's closed to help with garbage collection
    // and prevent potential issues with stale references.
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    const savedSession = loadSession();
    if (savedSession && savedSession.tabs.length > 0) {
      mainWindow.webContents.send('session:restore-ui', {
        tabs: savedSession.tabs,
        groups: savedSession.groups,
        layout: savedSession.layout,
        activeTabId: savedSession.activeTabId,
      });

      const createAllTabs = async () => {
        savedSession.tabs.forEach(t => {
          const isHibernated = t.id !== savedSession.activeTabId;
          tabs.set(t.id, {
            ...t,
            view: null, session: null,
            canGoBack: false, canGoForward: false,
            isLoading: !isHibernated, isLoaded: false,
            isHibernated,
            lastActive: Date.now() - (isHibernated ? HIBERNATION_THRESHOLD : 0),
            cssKeys: new Map(),
          });
        });
        
        savedSession.groups.forEach(g => groups.set(g.id, g));
        layout = savedSession.layout;
        activeTabId = savedSession.activeTabId;
        await switchTab(activeTabId);
      };
      createAllTabs();

    } else {
      const newTab = await createTab();
      layout.push(newTab.id);
      mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
      await switchTab(newTab.id);
    }
  });

  startHibernationTimer();
}

async function switchTab(id) {
  const oldTab = getActiveTab();
  if (oldTab && oldTab.view) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.removeBrowserView(oldTab.view);
  }

  const newTab = tabs.get(id);
  if (newTab) {
    // Switch active tab ID and notify renderer immediately for instant UI feedback.
    activeTabId = id;
    mainWindow.webContents.send('tab:switched', id);

    // If the tab is hibernated or doesn't have a view (e.g. from session restore), create it.
    if (newTab.isHibernated || !newTab.view) {
        console.log(`Waking up tab ${id}`);
        const partition = `persist:${id}`;
        const tabSession = session.fromPartition(partition);
        tabSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        
        const view = new BrowserView({
            webPreferences: {
                partition,
                ...BROWSER_VIEW_WEBCONTENTS_CONFIG,
            },
        });

        newTab.view = view;
        newTab.session = tabSession;
        attachViewListenersToTab(newTab);

        // Start loading the URL asynchronously. Do NOT await this call.
        // The page will load in the background after the tab switch is visible.
        if (newTab.url === 'about:blank') {
          view.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
        } else {
          view.webContents.loadURL(newTab.url);
        }
        newTab.isHibernated = false;
        
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('tab:updated', { id: newTab.id, isHibernated: false, isLoading: true });
    }
    
    newTab.lastActive = Date.now();
    
    // Attach the view, update its size, and focus it.
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.addBrowserView(newTab.view);
    updateViewBounds();
    newTab.view.webContents.focus();
    debouncedSaveSession();
  }
}

// --- IPC Handlers ---

// Window Controls
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow.close());
ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized());

// Tab Controls
ipcMain.handle('tab:new', async () => {
  const newTab = await createTab();
  layout.push(newTab.id);
  mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
  await switchTab(newTab.id);
});

ipcMain.handle('tab:duplicate', async (_, id) => {
    const originalTab = tabs.get(id);
    if (!originalTab) return null;
    const newTab = await createTab(originalTab.url, { fromTabId: id });
    await switchTab(newTab.id);
    return getSerializableTabData(newTab);
});

ipcMain.handle('tab:close', async (_, id) => {
  const tab = tabs.get(id);
  if (tab) {
    if (tab.view) {
      if (tab.view === getActiveTab()?.view) {
        mainWindow.removeBrowserView(tab.view);
      }
      tab.view.webContents.destroy();
    }
    tab.session?.clearStorageData().catch(err => console.error("Failed to clear storage:", err));
    tabs.delete(id);

    // Always notify the renderer that the tab is closed for UI cleanup.
    mainWindow.webContents.send('tab:closed', id);

    // If that was the last tab, create a new one to prevent an empty window.
    if (tabs.size === 0) {
      const newTab = await createTab();
      layout = [newTab.id]; // Reset layout in main process
      groups.clear();
      mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
      await switchTab(newTab.id);
    }
  }
});

ipcMain.handle('tab:switch', (_, id) => switchTab(id));

// Active View Controls (for All Tabs page)
ipcMain.handle('view:hide', () => {
  const tab = getActiveTab();
  if (tab && tab.view) {
    mainWindow.removeBrowserView(tab.view);
  }
});

ipcMain.handle('view:show', () => {
  const tab = getActiveTab();
  if (tab && tab.view && !mainWindow.getBrowserViews().includes(tab.view)) {
    mainWindow.addBrowserView(tab.view);
    updateViewBounds();
    tab.view.webContents.focus();
  }
});


// Layout
ipcMain.handle('layout:update', (_, newLayout, newGroups) => {
  layout = newLayout;
  groups.clear();
  newGroups.forEach(g => groups.set(g.id, g));
  debouncedSaveSession();
});
ipcMain.handle('tabs:getAll', () => {
  return Array.from(tabs.values()).map(getSerializableTabData);
});

// Navigation
ipcMain.handle('tab:loadURL', (_, url) => getActiveTab()?.view.webContents.loadURL(url));
ipcMain.handle('tab:goBack', () => getActiveTab()?.view.webContents.goBack());
ipcMain.handle('tab:goForward', () => getActiveTab()?.view.webContents.goForward());
ipcMain.handle('tab:reload', () => {
  const view = getActiveTab()?.view;
  if (view) {
    if (view.webContents.isLoading()) view.webContents.stop();
    else view.webContents.reload();
  }
});

// Find in Page
ipcMain.handle('find:start', (_, text) => {
  if (text) getActiveTab()?.view.webContents.findInPage(text);
});
ipcMain.handle('find:next', (_, text, forward) => {
  if (text) getActiveTab()?.view.webContents.findInPage(text, { findNext: true, forward });
});
ipcMain.handle('find:stop', () => getActiveTab()?.view.webContents.stopFindInPage('clearSelection'));

// Zoom
ipcMain.handle('zoom:set', (_, factor) => {
  const view = getActiveTab()?.view;
  if(view) view.webContents.setZoomFactor(factor);
});

// Settings
ipcMain.handle('settings:get-default-font', () => {
    return settings.defaultFont || 'default';
});
ipcMain.handle('settings:set-default-font', async (_, fontFamily) => {
    settings.defaultFont = (fontFamily === 'default') ? null : fontFamily;
    debouncedSaveSettings();

    // Apply to all currently active (non-hibernated) tabs
    for (const tab of tabs.values()) {
        if (tab.view && !tab.view.webContents.isDestroyed()) {
            await applyFontSetting(tab, settings.defaultFont);
        }
    }
    return true;
});


// Helper function to find a tab by its webContents
function findTabByWebContents(webContents) {
  if (!webContents || webContents.isDestroyed()) return null;
  for (const tab of tabs.values()) {
    if (tab.view && tab.view.webContents === webContents) {
      return tab;
    }
  }
  return null;
}

// View-specific IPC handlers
ipcMain.on('view:reload-current', (event) => {
  const tab = findTabByWebContents(event.sender);
  if (tab) {
    // Check if the original URL was 'about:blank' (our new tab page)
    if (tab.url === 'about:blank') {
      tab.view.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
    } else {
      tab.view.webContents.loadURL(tab.url);
    }
  }
});

ipcMain.on('view:loadURL', (event, url) => {
    const tab = findTabByWebContents(event.sender);
    if (tab && tab.view) {
        tab.view.webContents.loadURL(url);
    }
});

ipcMain.on('view:close', (event) => {
    const tab = findTabByWebContents(event.sender);
    if (tab) {
        // Forward the request to the main renderer window, which owns all the UI logic.
        mainWindow.webContents.send('close-tab-from-view', tab.id);
    }
});


// Context Menu
ipcMain.handle('show-context-menu', (event, menuTemplate) => {
    const buildMenu = (template) => {
        return template.map(item => {
            if (item.type === 'separator') return { type: 'separator' };
            
            const menuItem = {
                label: item.label,
                enabled: item.enabled !== false,
                visible: item.visible !== false,
            };

            if (item.action) {
                menuItem.click = () => event.sender.send('context-menu-command', item.action.command, item.action.context);
            }
            
            if (item.submenu) {
                menuItem.submenu = buildMenu(item.submenu);
            }
            return menuItem;
        });
    };
    const menu = Menu.buildFromTemplate(buildMenu(menuTemplate));
    menu.popup({ window: mainWindow });
});


// --- App Lifecycle ---
app.whenReady().then(() => {
  // Listen for find results
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType() === 'browserView') {
      contents.on('found-in-page', (event, result) => {
        if (result.finalUpdate) {
            mainWindow.webContents.send('find:result', {
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