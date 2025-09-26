const { ipcMain, Menu, clipboard, shell } = require('electron');
const path = require('path');
const state = require('./state');
const tabsModule = require('./tabs');
const settingsModule = require('./settings');
const sessionModule = require('./session');
const utils = require('./utils');
const { getSerializableTabData } = require('./utils');
const { SEARCH_ENGINES, CHROME_HEIGHT } = require('./constants');

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

    // Tab Controls
    ipcMain.handle('tab:new', async () => {
        const newTab = tabsModule.createTab();
        state.layout.push(newTab.id);
        state.mainWindow.webContents.send('tab:created', getSerializableTabData(newTab));
        await tabsModule.switchTab(newTab.id);
    });

    ipcMain.handle('tab:duplicate', async (_, id) => {
        const originalTab = state.tabs.get(id);
        if (!originalTab) return null;
        const newTab = tabsModule.createTab(originalTab.url, { fromTabId: id, isShared: originalTab.isShared, zoomFactor: originalTab.zoomFactor });
        await tabsModule.switchTab(newTab.id);
        return getSerializableTabData(newTab);
    });

    ipcMain.handle('tab:close', async (_, id) => tabsModule.closeTab(id));
    ipcMain.handle('tab:switch', (_, id) => tabsModule.switchTab(id));
    ipcMain.handle('tab:toggle-shared', async (_, id) => tabsModule.toggleTabSharedState(id));
    ipcMain.handle('tab:clear-cache-and-reload', async (_, id) => tabsModule.clearCacheAndReload(id));

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
    ipcMain.handle('tab:goBack', () => state.getActiveTab()?.view.webContents.goBack());
    ipcMain.handle('tab:goForward', () => state.getActiveTab()?.view.webContents.goForward());
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
    ipcMain.handle('settings:set-ai', (_, settings) => {
        if (!state.settings.ai) state.settings.ai = {};
        Object.assign(state.settings.ai, settings);
        settingsModule.debouncedSaveSettings();
        tabsModule.updateViewBounds();
    });

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