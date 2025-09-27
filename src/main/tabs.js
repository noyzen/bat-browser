const { BrowserView, session, clipboard, Menu } = require('electron');
const path = require('path');
const { randomUUID } = require('crypto');
const state = require('./state');
const sessionModule = require('./session');
const settingsModule = require('./settings');
const { getSerializableTabData, getRandomColor } = require('./utils');
const { BROWSER_VIEW_WEBCONTENTS_CONFIG, CHROME_HEIGHT, SHARED_SESSION_PARTITION, USER_AGENTS, USER_AGENT_CLIENT_HINTS } = require('./constants');

function getUserAgentInfo() {
    const settings = state.settings.userAgent || { current: 'windows-firefox', custom: '' };
    const key = settings.current;
    let value, clientHints;

    if (key === 'custom' && settings.custom) {
        value = settings.custom;
        // For custom UAs, we cannot guess client hints, so we send none.
        clientHints = null;
    } else {
        const [os, browser] = key.split('-');
        const uaData = USER_AGENTS[os]?.[browser];
        if (uaData) {
            value = uaData.value;
            clientHints = USER_AGENT_CLIENT_HINTS[os]?.[browser] || null;
        } else {
            // Fallback to default if key is invalid
            value = USER_AGENTS.windows.firefox.value;
            clientHints = null;
        }
    }
    return { value, clientHints };
}

async function applyProxyToSession(tabSession) {
    if (!tabSession || (typeof tabSession.isDestroyed === 'function' && tabSession.isDestroyed())) {
        return;
    }

    const proxy = state.settings.proxy || { mode: 'autodetect' };
    let config = {};

    switch (proxy.mode) {
        case 'none':
            config = { mode: 'direct' };
            break;
        case 'manual':
            config = {
                mode: 'fixed_servers',
                proxyRules: proxy.rules,
                proxyBypassRules: proxy.bypass
            };
            break;
        case 'autodetect':
        default:
            config = { mode: 'auto_detect' };
            break;
    }

    try {
        await tabSession.setProxy(config);
    } catch (err) {
        console.error(`Failed to apply proxy settings:`, err);
    }
}

async function applyProxyToAllSessions() {
    for (const tab of state.tabs.values()) {
        if (tab.session && !tab.session.isDestroyed()) {
            await applyProxyToSession(tab.session);
        }
    }
}

function configureSession(tabSession) {
    const { value: userAgentString, clientHints } = getUserAgentInfo();

    // This sets the UA for the JS environment (navigator.userAgent)
    tabSession.setUserAgent(userAgentString);

    // Clear any existing listeners to prevent duplicates.
    tabSession.webRequest.onBeforeSendHeaders(null);

    // This robust, universal listener modifies headers for all network requests.
    // It correctly spoofs the selected identity by managing both the User-Agent
    // string and the Chromium-specific Client-Hint headers.
    tabSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const requestHeaders = details.requestHeaders;

        // 1. Set the primary User-Agent string for all requests.
        requestHeaders['User-Agent'] = userAgentString;

        // 2. Clean up any default Electron/Chromium client hint headers. This is
        //    CRITICAL for correctly spoofing non-Chromium browsers (like Firefox)
        //    as it prevents the underlying engine from leaking its identity.
        for (const header in requestHeaders) {
            if (header.toLowerCase().startsWith('sec-ch-')) {
                delete requestHeaders[header];
            }
        }

        // 3. If the chosen identity is a Chromium-based browser (which has hints),
        //    add its specific client hint headers to complete the disguise.
        //    If it's Firefox/Safari (no hints), this block is skipped, and the
        //    browser appears clean, just as it should.
        if (clientHints) {
            requestHeaders['sec-ch-ua'] = clientHints.brands;
            requestHeaders['sec-ch-ua-mobile'] = clientHints.mobile;
            requestHeaders['sec-ch-ua-platform'] = clientHints.platform;
        }
        
        callback({ requestHeaders });
    });
}

function updateViewBounds() {
    const tab = state.getActiveTab();
    if (!tab || !tab.view || !state.mainWindow) return;
    
    const [width, height] = state.mainWindow.getContentSize();
    const aiSettings = state.settings.ai || {};
    const panelWidth = aiSettings.panelOpen ? (aiSettings.panelWidth || 350) : 0;
    const handleWidth = aiSettings.panelOpen ? 8 : 0; // The resize handle is 8px wide
    
    tab.view.setBounds({ 
        x: 0, 
        y: CHROME_HEIGHT, 
        width: width - panelWidth - handleWidth, 
        height: height - CHROME_HEIGHT 
    });
}

async function openUrlInNewTab(url, fromTabId, inBackground) {
    if (!state.mainWindow || state.mainWindow.isDestroyed()) return;

    const fromTab = state.tabs.get(fromTabId);
    const newTab = await createTab(url, { fromTabId, isShared: fromTab?.isShared });

    const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(fromTabId));
    if (parentGroup) {
        const tabIndexInGroup = parentGroup.tabs.indexOf(fromTabId);
        parentGroup.tabs.splice(tabIndexInGroup + 1, 0, newTab.id);
    } else {
        let insertionIndex = state.layout.indexOf(fromTabId);
        if (insertionIndex === -1) {
            insertionIndex = state.layout.indexOf(state.activeTabId);
            if (insertionIndex === -1) {
                insertionIndex = state.layout.length - 1;
            }
        }
        state.layout.splice(insertionIndex + 1, 0, newTab.id);
    }

    state.mainWindow.webContents.send('tab:created-with-layout', {
        newTab: getSerializableTabData(newTab),
        newLayout: state.layout,
        newGroups: Array.from(state.groups.values()),
    });

    if (!inBackground) {
        await switchTab(newTab.id);
    } else {
        sessionModule.debouncedSaveSession();
    }
}

function attachViewListenersToTab(tabData) {
    const { id, view } = tabData;

    view.webContents.on('dom-ready', () => {
        const { clientHints } = getUserAgentInfo();
        let injectionScript = `
            (() => {
                // Hide webdriver flag, a common bot detection technique.
                if (navigator.webdriver) {
                    try {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    } catch (e) {
                        console.error('Failed to hide webdriver flag:', e.message);
                    }
                }
        `;

        // If spoofing a non-Chromium browser (Firefox, Safari), remove "window.chrome"
        // which is a major fingerprinting inconsistency.
        if (!clientHints) {
            injectionScript += `
                if (window.chrome) {
                    try {
                        Object.defineProperty(window, 'chrome', {
                            value: undefined,
                            writable: false,
                            configurable: true
                        });
                    } catch (e) {
                        console.error('Failed to remove window.chrome:', e.message);
                    }
                }
            `;
        }

        injectionScript += `})();`;
        
        view.webContents.executeJavaScript(injectionScript).catch(e => {
            // This can fail on pages with strict CSP, but we try anyway.
            if (e.message.includes('Refused to execute inline script')) {
                // console.warn('CSP prevented anti-fingerprinting script injection.');
            } else {
                console.error('Failed to inject anti-fingerprinting script:', e);
            }
        });
    });
  
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && !input.isAutoRepeat) {
        const hotkeys = state.settings.hotkeys;
        if (!hotkeys) return;

        const key = input.key.length === 1 ? input.key.toUpperCase() : input.key;
        const combo = [
            input.control ? 'Ctrl' : '',
            input.alt ? 'Alt' : '',
            input.shift ? 'Shift' : '',
            input.meta ? 'Meta' : '',
            ['Control', 'Alt', 'Shift', 'Meta', 'Hyper', 'Super'].includes(key) ? '' : key
        ].filter(Boolean).join('+');
        
        if (Object.values(hotkeys).includes(combo)) {
            event.preventDefault();
            if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                state.mainWindow.webContents.send('forwarded-keydown', {
                    key: input.key,
                    code: input.code,
                    shiftKey: input.shift,
                    ctrlKey: input.control,
                    altKey: input.alt,
                    metaKey: input.meta,
                });
            }
        }
      }
    });

    view.webContents.on('did-start-loading', () => {
      tabData.isLoading = true;
      state.mainWindow.webContents.send('tab:updated', { id, isLoading: true });
    });
  
    view.webContents.on('did-stop-loading', () => {
      tabData.isLoading = false;
      tabData.isLoaded = true;
      state.mainWindow.webContents.send('tab:updated', { id, isLoading: false, isLoaded: true });
    });
  
    view.webContents.on('page-title-updated', (_, title) => {
      tabData.title = title;
      state.mainWindow.webContents.send('tab:updated', { id, title });
      sessionModule.debouncedSaveSession();
    });

    view.webContents.on('page-favicon-updated', (_, favicons) => {
      if (favicons && favicons.length > 0) {
        tabData.favicon = favicons[0]; // Take the first one
        state.mainWindow.webContents.send('tab:updated', { id, favicon: tabData.favicon });
        sessionModule.debouncedSaveSession();
      }
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
      state.mainWindow.webContents.send('tab:updated', { 
          id, 
          title: tabData.title, 
          isLoading: false 
      });
    });
  
    view.webContents.on('did-navigate', async (_, newUrl) => {
      if (newUrl.startsWith('file://') && newUrl.includes('error.html')) {
        tabData.canGoBack = view.webContents.canGoBack();
        tabData.canGoForward = view.webContents.canGoForward();
        state.mainWindow.webContents.send('tab:updated', { id, canGoBack: tabData.canGoBack, canGoForward: tabData.canGoForward });
        return;
      }
  
      const isNewTabPage = newUrl.endsWith('newtab.html');
      if (isNewTabPage) {
          tabData.url = 'about:blank';
          tabData.title = 'New Tab';
          tabData.favicon = null;
          tabData.canGoBack = false;
          tabData.canGoForward = false;
          state.mainWindow.webContents.send('tab:updated', { id, url: '', title: 'New Tab', favicon: null, canGoBack: false, canGoForward: false });
          return;
      }
  
      tabData.url = newUrl;
      tabData.canGoBack = view.webContents.canGoBack();
      tabData.canGoForward = view.webContents.canGoForward();
      state.mainWindow.webContents.send('tab:updated', { id, url: newUrl, canGoBack: tabData.canGoBack, canGoForward: tabData.canGoForward });
      
      await settingsModule.applyFontSetting(tabData, state.settings.defaultFont);
  
      sessionModule.debouncedSaveSession();
    });
    
    view.webContents.setWindowOpenHandler((details) => {
      const { url, disposition } = details;
      const fromTabId = tabData.id;
  
      if (disposition === 'new-window' || disposition === 'background-tab' || disposition === 'foreground-tab') {
        const inBackground = disposition === 'background-tab';
        openUrlInNewTab(url, fromTabId, inBackground);
        return { action: 'deny' };
      }
      return { action: 'deny' };
    });
  
    view.webContents.on('context-menu', (event, params) => {
      const menuTemplate = [];
      // ... (rest of context menu logic from original main.js)
      if (params.linkURL) {
        menuTemplate.push(
          { label: 'Open Link in New Tab', click: () => openUrlInNewTab(params.linkURL, id, true) },
          { label: 'Open Link in New Active Tab', click: () => openUrlInNewTab(params.linkURL, id, false) },
          { type: 'separator' },
          { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' }
        );
      }
      if (params.srcURL && params.mediaType === 'image') {
        menuTemplate.push(
          { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
          { type: 'separator' }
        );
      }
      const hasSelection = params.selectionText.trim().length > 0;
      if (hasSelection) {
        menuTemplate.push({ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => view.webContents.copy() });
      }
      if (params.isEditable) {
        if (menuTemplate.length > 0 && menuTemplate[menuTemplate.length - 1].type !== 'separator') {
          menuTemplate.push({ type: 'separator' });
        }
        menuTemplate.push(
          { label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => view.webContents.cut(), enabled: hasSelection },
          { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => view.webContents.paste() }
        );
      }
      if (menuTemplate.length > 0 && menuTemplate[menuTemplate.length - 1].type !== 'separator') {
        menuTemplate.push({ type: 'separator' });
      }
      menuTemplate.push(
        { label: 'Back', enabled: view.webContents.canGoBack(), click: () => view.webContents.goBack() },
        { label: 'Forward', enabled: view.webContents.canGoForward(), click: () => view.webContents.goForward() },
        { label: 'Reload', click: () => view.webContents.reload() },
        { type: 'separator' },
        { label: 'Inspect', accelerator: 'CmdOrCtrl+Shift+I', click: () => view.webContents.openDevTools({ mode: 'detach' }) }
      );
      
      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup({ window: state.mainWindow });
    });
}

async function createTab(url = 'about:blank', options = {}) {
    const { fromTabId, id: existingId } = options;
    const id = existingId || `tab-${randomUUID()}`;
    const partition = options.isShared ? SHARED_SESSION_PARTITION : `persist:${id}`;
    const tabSession = session.fromPartition(partition);

    await applyProxyToSession(tabSession);
  
    configureSession(tabSession);
  
    const { value: userAgentString } = getUserAgentInfo();
    const view = new BrowserView({
      webPreferences: {
        userAgent: userAgentString,
        partition,
        ...BROWSER_VIEW_WEBCONTENTS_CONFIG
      }
    });
  
    const tabData = {
      id, view, session: tabSession, url, title: 'New Tab', canGoBack: false,
      canGoForward: false, isLoading: true, isLoaded: false, isHibernated: false,
      isShared: !!options.isShared,
      favicon: null,
      zoomFactor: options.zoomFactor || 1.0,
      lastActive: Date.now(),
      color: fromTabId ? (state.tabs.get(fromTabId)?.color || getRandomColor()) : getRandomColor(),
      cssKeys: new Map(),
    };
    state.tabs.set(id, tabData);
  
    attachViewListenersToTab(tabData);
    
    view.webContents.on('did-finish-load', () => {
      if (tabData.zoomFactor && tabData.zoomFactor !== 1.0) {
        view.webContents.setZoomFactor(tabData.zoomFactor);
      }
    });

    if (url === 'about:blank') {
      view.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
    } else {
      view.webContents.loadURL(url).catch(e => {
        if (e.code !== 'ERR_ABORTED') {
          console.error(`Initial loadURL failed for ${url}:`, e.message);
        }
      });
    }
    return tabData;
}

async function switchTab(id) {
    const oldTab = state.getActiveTab();
    if (oldTab && oldTab.view) {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
      state.mainWindow.removeBrowserView(oldTab.view);
    }
  
    const newTab = state.tabs.get(id);
    if (newTab) {
      state.activeTabId = id;
      state.mainWindow.webContents.send('tab:switched', id);
  
      if (newTab.isHibernated || !newTab.view) {
          console.log(`Waking up tab ${id}`);
          const partition = newTab.isShared ? SHARED_SESSION_PARTITION : `persist:${id}`;
          const tabSession = session.fromPartition(partition);
          
          await applyProxyToSession(tabSession);
              
          configureSession(tabSession);
          
          const { value: userAgentString } = getUserAgentInfo();
          const view = new BrowserView({
            webPreferences: {
              userAgent: userAgentString,
              partition,
              ...BROWSER_VIEW_WEBCONTENTS_CONFIG
            }
          });
  
          newTab.view = view;
          newTab.session = tabSession;
          attachViewListenersToTab(newTab);
  
          view.webContents.on('did-finish-load', () => {
            if (newTab.zoomFactor && newTab.zoomFactor !== 1.0) {
              view.webContents.setZoomFactor(newTab.zoomFactor);
            }
          });

          if (newTab.url === 'about:blank') {
            view.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
          } else {
            view.webContents.loadURL(newTab.url).catch(e => console.error("Switch-loadURL failed for", newTab.url, e.message));
          }
          newTab.isHibernated = false;
          
          if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
          state.mainWindow.webContents.send('tab:updated', { id: newTab.id, isHibernated: false, isLoading: true });
      }
      
      newTab.lastActive = Date.now();
      
      if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
      state.mainWindow.addBrowserView(newTab.view);
      updateViewBounds();
      newTab.view.webContents.focus();
      sessionModule.debouncedSaveSession();
    }
}

async function closeTab(id) {
    const tab = state.tabs.get(id);
    if (tab) {
        if (tab.view) {
            if (tab.view === state.getActiveTab()?.view) {
                state.mainWindow.removeBrowserView(tab.view);
            }
            tab.view.webContents.destroy();
        }
        if (!tab.isShared) { // Don't clear storage for shared tabs on close
            tab.session?.clearStorageData().catch(err => console.error("Failed to clear storage:", err));
        }
        state.tabs.delete(id);

        state.mainWindow.webContents.send('tab:closed', id);

        if (state.tabs.size === 0) {
            const newTab = await createTab();
            state.layout = [newTab.id];
            state.groups.clear();
            state.mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
            await switchTab(newTab.id);
        }
    }
}

async function toggleTabSharedState(id) {
    const tab = state.tabs.get(id);
    if (!tab) return;

    const wasActive = state.activeTabId === id;
    const currentUrl = tab.isHibernated ? tab.url : tab.view.webContents.getURL();
    
    const wasShared = tab.isShared;
    tab.isShared = !tab.isShared;

    if (tab.view && !tab.view.webContents.isDestroyed()) {
        if (wasActive) state.mainWindow.removeBrowserView(tab.view);
        tab.view.webContents.destroy();
    }
    
    // If the tab was isolated and is now shared, we must clear the data
    // from its old isolated partition to prevent it from being orphaned.
    if (!wasShared) {
      const oldPartition = `persist:${id}`;
      await session.fromPartition(oldPartition).clearStorageData();
    }
    // If it was shared and is now isolated, we DO NOT clear the shared partition's
    // data, as other shared tabs may still be using it. The new isolated
    // partition will be created fresh automatically.

    const newPartition = tab.isShared ? SHARED_SESSION_PARTITION : `persist:${id}`;
    const newSession = session.fromPartition(newPartition);

    await applyProxyToSession(newSession);
    
    configureSession(newSession);

    const { value: userAgentString } = getUserAgentInfo();
    const newView = new BrowserView({
      webPreferences: {
        userAgent: userAgentString,
        partition: newPartition,
        ...BROWSER_VIEW_WEBCONTENTS_CONFIG
      }
    });

    tab.view = newView;
    tab.session = newSession;
    attachViewListenersToTab(tab);
    
    newView.webContents.on('did-finish-load', () => {
      if (tab.zoomFactor && tab.zoomFactor !== 1.0) {
        newView.webContents.setZoomFactor(tab.zoomFactor);
      }
    });

    if (currentUrl && !currentUrl.endsWith('newtab.html') && !currentUrl.startsWith('file://')) {
        newView.webContents.loadURL(currentUrl);
    } else {
        newView.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
    }

    if (wasActive) {
        state.mainWindow.addBrowserView(newView);
        updateViewBounds();
        newView.webContents.focus();
    }

    state.mainWindow.webContents.send('tab:updated', getSerializableTabData(tab));
    sessionModule.debouncedSaveSession();
}

async function clearCacheAndReload(id) {
    const tab = state.tabs.get(id);
    if (tab && tab.session) {
        // clearStorageData is more comprehensive than clearCache. It removes cookies,
        // localStorage, IndexedDB, etc., fulfilling the user's expectation of a complete data clear.
        await tab.session.clearStorageData({ storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'] });
        
        if (tab.view && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.reload();
        }
    }
}


module.exports = {
    updateViewBounds,
    openUrlInNewTab,
    createTab,
    switchTab,
    closeTab,
    toggleTabSharedState,
    clearCacheAndReload,
    configureSession,
    applyProxyToAllSessions,
};