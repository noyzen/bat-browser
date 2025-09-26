const { ipcMain, Menu, clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const state = require('./state');
const tabsModule = require('./tabs');
const settingsModule = require('./settings');
const sessionModule = require('./session');
const utils = require('./utils');
const { getSerializableTabData } = require('./utils');
const { SEARCH_ENGINES } = require('./constants');

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
    ipcMain.handle('settings:set-screenshot-option', (_, { key, value }) => {
        if (['screenshotFormat', 'screenshotQuality'].includes(key)) {
            state.settings[key] = value;
            settingsModule.debouncedSaveSettings();
        }
    });

    // Screenshot
    ipcMain.handle('tab:screenshot', async (_, tabId) => {
        const tab = state.tabs.get(tabId);
        if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
            return { success: false, message: 'Tab is not available for capture.' };
        }
    
        state.mainWindow.webContents.send('screenshot:start', { tabId });
    
        const webContents = tab.view.webContents;
        const shouldAttach = !webContents.debugger.isAttached();
        let finalResult = { success: false, message: 'An unknown error occurred during screenshot.' };
    
        try {
            if (shouldAttach) {
                await webContents.debugger.attach('1.3');
            }
        
            await webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: true });
    
            const { contentSize } = await webContents.debugger.sendCommand('Page.getLayoutMetrics');
            const { width, height: viewHeight } = tab.view.getBounds();
    
            if (contentSize.height > viewHeight) {
                const scrolls = Math.ceil(contentSize.height / viewHeight);
                for (let i = 0; i < scrolls; i++) {
                    await webContents.debugger.sendCommand('Input.synthesizeScrollGesture', {
                        x: width / 2, y: viewHeight / 2, yDistance: -viewHeight, speed: 800, gestureSourceType: 'mouse',
                    });
                    // Increased wait time for lazy-loaded content
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                // Slower scroll back to top and longer wait
                await webContents.debugger.sendCommand('Input.synthesizeScrollGesture', {
                    x: width / 2, y: viewHeight / 2, yDistance: contentSize.height, speed: 800,
                });
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
    
            let format = state.settings.screenshotFormat || 'png';
            if (!['jpeg', 'png', 'webp'].includes(format)) format = 'png';
            const quality = state.settings.screenshotQuality || 90;
        
            const screenshotResult = await webContents.debugger.sendCommand('Page.captureScreenshot', {
                format: format, quality: (format === 'jpeg' || format === 'webp') ? quality : undefined, captureBeyondViewport: true, fromSurface: true,
            });
                
            const { canceled, filePath } = await dialog.showSaveDialog(state.mainWindow, {
                title: 'Save Screenshot',
                defaultPath: `screenshot-${Date.now()}.${format}`,
                filters: [{ name: 'Images', extensions: [format] }]
            });
        
            if (!canceled && filePath) {
                const buffer = Buffer.from(screenshotResult.data, 'base64');
                fs.writeFileSync(filePath, buffer);
                finalResult = { success: true };
            } else {
                finalResult = { success: false, message: 'Save dialog was canceled.' };
            }
        } catch (error) {
            console.error('Failed to capture screenshot via CDP:', error);
            finalResult = { success: false, message: `Failed to capture page. ${error.message}` };
        } finally {
            if (webContents.debugger.isAttached()) {
                await webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: false }).catch(err => console.error('Could not re-enable input events:', err));
                if (shouldAttach) {
                    await webContents.debugger.detach().catch(err => console.error('Could not detach debugger:', err));
                }
            }
            state.mainWindow.webContents.send('screenshot:end', { tabId, result: finalResult });
        }
        return finalResult;
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

    // Context Menu
    ipcMain.handle('show-context-menu', (event, menuTemplate) => {
        const buildMenu = (template) => {
            return template.map(item => {
                const menuItem = {
                    label: item.label,
                    enabled: item.enabled !== false,
                    visible: item.visible !== false,
                };
                if (item.type) menuItem.type = item.type;
                if (item.checked) menuItem.checked = item.checked;

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
        menu.popup({ window: state.mainWindow });
    });
}

module.exports = { initializeIpc };