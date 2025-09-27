const { ipcMain, Menu, clipboard, shell, session, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const state = require('./state');
const tabsModule = require('./tabs');
const settingsModule = require('./settings');
const sessionModule = require('./session');
const downloadManager = require('./downloadManager');
const utils = require('./utils');
const { getSerializableTabData } = require('./utils');
const { SEARCH_ENGINES, USER_AGENTS, SESSION_PATH } = require('./constants');

// URL Loading Helper
function loadQueryOrURL(webContents, query) {
    if (!webContents || webContents.isDestroyed()) return;

    let url = query.trim();
    if (!url) return;

    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    // A string is likely a URL if it contains a dot and no spaces, is 'localhost', or 'localhost:port'.
    const isLikelyUrl = (url.includes('.') && !url.includes(' ')) || url.startsWith('localhost');

    if (hasProtocol) {
        // User provided a protocol, respect it.
        webContents.loadURL(url);
    } else if (isLikelyUrl) {
        // No protocol, default to https for domains, http for localhost.
        const protocol = url.startsWith('localhost') ? 'http://' : 'https://';
        webContents.loadURL(protocol + url);
    } else {
        // Not a URL, treat as a search query.
        const searchEngineUrl = SEARCH_ENGINES[state.settings.searchEngine] || SEARCH_ENGINES.google;
        webContents.loadURL(searchEngineUrl + encodeURIComponent(url));
    }
}


function initializeIpc() {
    // App Controls
    ipcMain.handle('app:open-external', (_, url) => {
        // Security: only allow opening http and https protocols
        const protocol = new URL(url).protocol;
        if (['http:', 'https:'].includes(protocol)) {
            shell.openExternal(url);
        }
    });

    // Window Controls
    ipcMain.handle('window:minimize', () => state.mainWindow.minimize());
    ipcMain.handle('window:maximize', () => {
        if (state.mainWindow.isMaximized()) state.mainWindow.unmaximize();
        else state.mainWindow.maximize();
    });
    ipcMain.handle('window:close', () => state.mainWindow.close());
    ipcMain.handle('window:isMaximized', () => state.mainWindow.isMaximized());

    // Input Context Menu
    ipcMain.handle('input:show-context-menu', () => {
        const template = [
            { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
            { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
            { type: 'separator' }, { role: 'selectAll' }
        ];
        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: state.mainWindow });
    });

    // Tab Controls
    ipcMain.handle('tab:new', async () => {
        const newTab = await tabsModule.createTab();
        state.layout.push(newTab.id);
        state.mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
        await tabsModule.switchTab(newTab.id);
    });

    ipcMain.handle('tab:new-with-url', async (_, url) => {
        const newTab = await tabsModule.createTab(url);
        state.layout.push(newTab.id);
        state.mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
        await tabsModule.switchTab(newTab.id);
    });

    ipcMain.handle('tab:duplicate', async (_, id) => {
        const originalTab = state.tabs.get(id);
        if (!originalTab) return null;
        const newTab = await tabsModule.createTab(originalTab.url, { fromTabId: id, isShared: originalTab.isShared, zoomFactor: originalTab.zoomFactor });
        await tabsModule.switchTab(newTab.id);
        return getSerializableTabData(newTab);
    });

    ipcMain.handle('tab:close', async (_, id) => tabsModule.closeTab(id));
    ipcMain.handle('tab:switch', async (_, id) => await tabsModule.switchTab(id));
    ipcMain.handle('tab:toggle-shared', async (_, id) => tabsModule.toggleTabSharedState(id));
    ipcMain.handle('tab:clear-cache-and-reload', async (_, id) => tabsModule.clearCacheAndReload(id));
    ipcMain.handle('tab:hibernate', async (_, id) => {
        await tabsModule.hibernateTab(id);
    });
    ipcMain.handle('group:hibernate-tabs', async (_, groupId) => {
        const group = state.groups.get(groupId);
        if (group) {
            const tabsToHibernate = [...group.tabs];
            for (const tabId of tabsToHibernate) {
                await tabsModule.hibernateTab(tabId);
            }
        }
    });

    // Active View Controls (for All Tabs page)
    ipcMain.handle('view:hide', () => {
        const tab = state.getActiveTab();
        if (tab && tab.view) {
            state.mainWindow.removeBrowserView(tab.view);
        }
    });

    ipcMain.handle('view:show', () => {
        const tab = state.getActiveTab();
        if (tab && tab.view && !state.mainWindow.getBrowserViews().includes(tab.view)) {
            state.mainWindow.addBrowserView(tab.view);
            tabsModule.updateViewBounds();
            tab.view.webContents.focus();
        }
    });

    // Layout
    ipcMain.handle('layout:update', (_, newLayout, newGroups) => {
        state.layout = newLayout;
        state.groups.clear();
        newGroups.forEach(g => state.groups.set(g.id, g));
        sessionModule.debouncedSaveSession();
    });
    ipcMain.handle('tabs:getAll', () => {
        return Array.from(state.tabs.values()).map(getSerializableTabData);
    });

    // Navigation
    ipcMain.handle('tab:loadURL', (_, query) => loadQueryOrURL(state.getActiveTab()?.view.webContents, query));
    ipcMain.handle('tab:goBack', () => {
        const tab = state.getActiveTab();
        if (tab && tab.view && tab.historyIndex > 0) {
            tab.isNavigatingHistory = true;
            tab.historyIndex--;
            tab.view.webContents.loadURL(tab.history[tab.historyIndex].url);
        }
    });
    ipcMain.handle('tab:goForward', () => {
        const tab = state.getActiveTab();
        if (tab && tab.view && tab.historyIndex < tab.history.length - 1) {
            tab.isNavigatingHistory = true;
            tab.historyIndex++;
            tab.view.webContents.loadURL(tab.history[tab.historyIndex].url);
        }
    });
    ipcMain.handle('tab:reload', () => {
        const view = state.getActiveTab()?.view;
        if (view) {
            if (view.webContents.isLoading()) view.webContents.stop();
            else view.webContents.reload();
        }
    });

    // Find in Page
    ipcMain.handle('find:start', (_, text) => {
        if (text) state.getActiveTab()?.view.webContents.findInPage(text);
    });
    ipcMain.handle('find:next', (_, text, forward) => {
        if (text) state.getActiveTab()?.view.webContents.findInPage(text, { findNext: true, forward });
    });
    ipcMain.handle('find:stop', () => state.getActiveTab()?.view.webContents.stopFindInPage('clearSelection'));

    // Zoom
    ipcMain.handle('tab:update-zoom', (_, { id, factor }) => {
        const tab = state.tabs.get(id);
        if (tab) {
            tab.zoomFactor = factor;
            if (tab.view && !tab.view.webContents.isDestroyed()) {
                tab.view.webContents.setZoomFactor(factor);
            }
            state.mainWindow.webContents.send('tab:updated', { id, zoomFactor: factor });
            sessionModule.debouncedSaveSession();
        }
    });
    
    // UI Context Menu
    ipcMain.handle('chrome:show-context-menu', (event, { template, x, y }) => {
        const buildMenuFromTemplate = (tpl) => {
            return tpl.map(item => {
                if (item.visible === false) return null;

                const { action, submenu, ...rest } = item;
                const newItem = { ...rest };
                
                if (action) {
                    newItem.click = () => {
                        state.mainWindow.webContents.send('chrome:context-menu-command', action);
                    };
                }

                if (submenu && submenu.length > 0) {
                    newItem.submenu = buildMenuFromTemplate(submenu);
                } else {
                    delete newItem.submenu;
                }
                
                return newItem;
            }).filter(item => item !== null);
        };
        
        const menuTemplate = buildMenuFromTemplate(template);
        if (menuTemplate.length === 0) return;
        
        const menu = Menu.buildFromTemplate(menuTemplate);
        menu.popup({ window: state.mainWindow, x: Math.round(x), y: Math.round(y) });
    });

    // History
    ipcMain.handle('tab:get-history', (_, id) => {
        const tab = state.tabs.get(id);
        if (!tab) return { history: [], historyIndex: -1 };
        return { history: tab.history, historyIndex: tab.historyIndex };
    });
    ipcMain.handle('tab:go-to-history-index', (_, { tabId, index }) => {
        const tab = state.tabs.get(tabId);
        if (tab && tab.view && tab.history[index]) {
            tab.isNavigatingHistory = true;
            tab.historyIndex = index;
            tab.view.webContents.loadURL(tab.history[index].url);
        }
    });
    ipcMain.handle('tab:clear-history', (_, id) => {
        const tab = state.tabs.get(id);
        if (tab) {
            if (tab.history[tab.historyIndex]) {
                tab.history = [tab.history[tab.historyIndex]];
            } else {
                tab.history = [];
            }
            tab.historyIndex = tab.history.length > 0 ? 0 : -1;
            tab.canGoBack = false;
            tab.canGoForward = false;
            state.mainWindow.webContents.send('tab:updated', { id: tab.id, canGoBack: false, canGoForward: false });
            sessionModule.debouncedSaveSession();
        }
    });

    // Settings
    ipcMain.handle('settings:get', () => state.settings);
    ipcMain.handle('settings:set-default-font', async (_, fontFamily) => {
        state.settings.defaultFont = (fontFamily === 'default') ? null : fontFamily;
        settingsModule.debouncedSaveSettings();

        for (const tab of state.tabs.values()) {
            if (tab.view && !tab.view.webContents.isDestroyed()) {
                await settingsModule.applyFontSetting(tab, state.settings.defaultFont);
            }
        }
        return true;
    });
    ipcMain.handle('settings:set-search-engine', (_, engine) => {
        if (SEARCH_ENGINES[engine]) {
            state.settings.searchEngine = engine;
            settingsModule.debouncedSaveSettings();
        }
    });
    ipcMain.handle('settings:set-user-agent', async (_, uaSettings) => {
        state.settings.userAgent = uaSettings;
        settingsModule.debouncedSaveSettings();
    
        // Apply the new User-Agent to all existing tab sessions.
        for (const tab of state.tabs.values()) {
            if (tab.session) {
                tabsModule.configureSession(tab.session);
                // Reload any active, non-hibernated tabs to immediately apply the new headers.
                if (tab.view && !tab.view.webContents.isDestroyed() && !tab.isHibernated && tab.url !== 'about:blank') {
                    tab.view.webContents.reload();
                }
            }
        }
        // Also re-configure the default session for future popups.
        tabsModule.configureSession(session.defaultSession);
    });
    ipcMain.handle('settings:get-predefined-user-agents', () => USER_AGENTS);
    ipcMain.handle('settings:set-ai', (_, settings) => {
        if (!state.settings.ai) state.settings.ai = {};
        Object.assign(state.settings.ai, settings);
        settingsModule.debouncedSaveSettings();
        tabsModule.updateViewBounds();
    });
    ipcMain.handle('settings:set-hotkeys', (_, hotkeys) => {
        state.settings.hotkeys = hotkeys;
        settingsModule.debouncedSaveSettings();
    });
    ipcMain.handle('settings:set-proxy', async (_, proxySettings) => {
        state.settings.proxy = proxySettings;
        settingsModule.debouncedSaveSettings();
        await tabsModule.applyProxyToAllSessions();
    });
    ipcMain.handle('settings:set-history-limit', (_, limit) => {
        const newLimit = parseInt(limit, 10) || 100;
        if (!state.settings.history) state.settings.history = {};
        state.settings.history.limit = newLimit;
        settingsModule.debouncedSaveSettings();

        for (const tab of state.tabs.values()) {
            if (tab.history.length > newLimit) {
                const excess = tab.history.length - newLimit;
                tab.history.splice(0, excess);
                tab.historyIndex -= excess;
                if (tab.historyIndex < 0) tab.historyIndex = 0;
            }
        }
        sessionModule.debouncedSaveSession();
    });
    ipcMain.handle('settings:clear-all-history', () => {
        for (const tab of state.tabs.values()) {
             if (tab.history.length > 1) {
                if(tab.history[tab.historyIndex]) {
                    tab.history = [tab.history[tab.historyIndex]];
                    tab.historyIndex = 0;
                } else {
                    tab.history = [];
                    tab.historyIndex = -1;
                }
            }
        }
        const activeTab = state.getActiveTab();
        if (activeTab) {
            activeTab.canGoBack = false;
            activeTab.canGoForward = false;
            state.mainWindow.webContents.send('tab:updated', { id: activeTab.id, canGoBack: false, canGoForward: false });
        }
        sessionModule.saveSession();
    });

    ipcMain.handle('settings:set-downloads', (_, settings) => {
        if (!state.settings.downloads) state.settings.downloads = {};
        Object.assign(state.settings.downloads, settings);
        settingsModule.debouncedSaveSettings();
    });
    ipcMain.handle('settings:select-download-dir', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog(state.mainWindow, {
            properties: ['openDirectory']
        });
        if (!canceled && filePaths.length > 0) {
            return filePaths[0];
        }
        return null;
    });

    // Session Backup & Restore
    ipcMain.handle('session:backup', async () => {
        const sessionData = sessionModule.getSerializableSession();
        if (!sessionData) {
            dialog.showErrorBox('Backup Failed', 'There is no session data to back up.');
            return;
        }

        const backupData = {
            backupVersion: 1,
            createdAt: new Date().toISOString(),
            session: sessionData,
        };

        const defaultPath = `bat-browser-backup-${new Date().toISOString().split('T')[0]}.json`;
        const { canceled, filePath } = await dialog.showSaveDialog(state.mainWindow, {
            title: 'Save Session Backup',
            defaultPath,
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
        });

        if (!canceled && filePath) {
            try {
                fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
                dialog.showMessageBox(state.mainWindow, {
                    type: 'info',
                    title: 'Backup Successful',
                    message: `Session has been successfully backed up to:\n${filePath}`,
                });
            } catch (e) {
                console.error('Failed to save session backup:', e);
                dialog.showErrorBox('Backup Failed', `An error occurred while saving the backup file: ${e.message}`);
            }
        }
    });

    ipcMain.handle('session:restore', async () => {
        const { response } = await dialog.showMessageBox(state.mainWindow, {
            type: 'warning',
            title: 'Confirm Restore',
            message: 'Are you sure you want to restore a session?',
            detail: 'This will overwrite your current tabs and groups and restart the browser. Make sure you have saved any important work.',
            buttons: ['Restore and Restart', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
        });

        if (response === 1) return; // User cancelled

        const { canceled, filePaths } = await dialog.showOpenDialog(state.mainWindow, {
            title: 'Select Backup File',
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
            properties: ['openFile'],
        });

        if (!canceled && filePaths.length > 0) {
            try {
                const backupContent = fs.readFileSync(filePaths[0], 'utf-8');
                const backupData = JSON.parse(backupContent);

                let sessionToRestore;
                if (backupData.backupVersion === 1 && backupData.session) {
                    sessionToRestore = backupData.session;
                } else if (backupData.tabs && backupData.groups) {
                    // Attempt to restore older, unversioned format
                    sessionToRestore = backupData;
                } else {
                    throw new Error('Invalid or unrecognized backup file format.');
                }
                
                // Validate required keys
                if (!sessionToRestore.tabs || !sessionToRestore.groups || !sessionToRestore.layout) {
                     throw new Error('Backup file is missing required session data.');
                }
                
                fs.writeFileSync(SESSION_PATH, JSON.stringify(sessionToRestore, null, 2));
                app.relaunch();
                app.quit();
            } catch (e) {
                console.error('Failed to restore session:', e);
                dialog.showErrorBox('Restore Failed', `An error occurred while restoring the session: ${e.message}`);
            }
        }
    });


    // Download Controls
    ipcMain.handle('download:pause', (_, id) => downloadManager.pause(id));
    ipcMain.handle('download:resume', (_, id) => downloadManager.resume(id));
    ipcMain.handle('download:cancel', (_, id) => downloadManager.cancel(id));
    ipcMain.handle('download:open-file', (_, id) => downloadManager.openFile(id));
    ipcMain.handle('download:show-in-folder', (_, id) => downloadManager.showInFolder(id));
    ipcMain.handle('download:remove', (_, id) => downloadManager.remove(id));
    ipcMain.handle('download:clear-all', () => downloadManager.clearAll());


    // View-specific IPC handlers
    ipcMain.on('view:reload-current', (event) => {
        const tab = utils.findTabByWebContents(event.sender);
        if (tab) {
            if (tab.url === 'about:blank') {
                tab.view.webContents.loadFile(path.join(__dirname, '../renderer/newtab.html'));
            } else {
                tab.view.webContents.loadURL(tab.url);
            }
        }
    });

    ipcMain.on('view:loadURL', (event, query) => {
        const tab = utils.findTabByWebContents(event.sender);
        if (tab && tab.view) {
            loadQueryOrURL(tab.view.webContents, query);
        }
    });

    ipcMain.on('view:close', (event) => {
        const tab = utils.findTabByWebContents(event.sender);
        if (tab) {
            state.mainWindow.webContents.send('close-tab-from-view', tab.id);
        }
    });

    // AI Chat
    ipcMain.on('ai:chat-stream', async (event, { tabId, prompt }) => {
        const { enabled, apiKeys, activeApiKeyId } = state.settings.ai;
        if (!enabled) {
            return event.sender.send('ai:chat-stream-chunk', { error: 'AI is not enabled in settings.' });
        }
        const activeKey = apiKeys.find(k => k.id === activeApiKeyId);
        if (!activeKey || !activeKey.key) {
            return event.sender.send('ai:chat-stream-chunk', { error: 'No active Gemini API key is set.' });
        }

        try {
            const { GoogleGenAI } = await import('@google/genai');
            const tab = state.tabs.get(tabId);
            if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
                return event.sender.send('ai:chat-stream-chunk', { error: 'The target tab is not available.' });
            }
            
            const ai = new GoogleGenAI({ apiKey: activeKey.key });
            const pageText = await tab.view.webContents.executeJavaScript('document.body.innerText');
            const truncatedText = pageText.substring(0, 30000);

            const fullPrompt = `You are a helpful and expertly informed web assistant called Bat AI, integrated into the Bat Browser. Your task is to analyze the text content of the current webpage and answer the user's question about it.

WEBPAGE TEXT CONTENT:
---
${truncatedText}
---

Based on the content above, please answer the following question.
USER QUESTION: ${prompt}`;

            const responseStream = await ai.models.generateContentStream({
                model: 'gemini-2.5-flash',
                contents: fullPrompt,
            });

            for await (const chunk of responseStream) {
                if (chunk.text) {
                    event.sender.send('ai:chat-stream-chunk', { text: chunk.text });
                }
            }
        } catch (e) {
            console.error("Gemini API Error:", e);
            event.sender.send('ai:chat-stream-chunk', { error: `An API error occurred: ${e.message}` });
        } finally {
            event.sender.send('ai:chat-stream-chunk', { done: true });
        }
    });
}

module.exports = { initializeIpc };