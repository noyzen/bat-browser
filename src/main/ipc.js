const { ipcMain, Menu, clipboard, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const state = require('./state');
const tabsModule = require('./tabs');
const settingsModule = require('./settings');
const sessionModule = require('./session');
const utils = require('./utils');
const { getSerializableTabData } = require('./utils');
const { SEARCH_ENGINES, CHROME_HEIGHT } = require('./constants');

const activeCaptures = new Map();

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

    // --- Screenshot ---

    // Cancel a full-page capture
    ipcMain.handle('screenshot:cancel', (_, tabId) => {
        if (activeCaptures.has(tabId)) {
            activeCaptures.get(tabId).cancelled = true;
        }
    });

    // Capture the visible area of the page
    ipcMain.handle('screenshot:capture-visible', async () => {
        const tab = state.getActiveTab();
        if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
            return { success: false, message: 'Active tab not available for capture.' };
        }
        try {
            const image = await tab.view.webContents.capturePage();
            return { success: true, dataUrl: image.toDataURL() };
        } catch (error) {
            console.error('Visible area capture failed:', error);
            return { success: false, message: error.message };
        }
    });
    
    // Capture a specific rectangle of the page
    ipcMain.handle('screenshot:capture-rect', async (_, rect) => {
        const tab = state.getActiveTab();
        if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
            return { success: false, message: 'Active tab not available for capture.' };
        }
        try {
            // Adjust coordinates from window-relative to view-relative
            const viewRect = {
                x: Math.round(rect.x),
                y: Math.round(rect.y - CHROME_HEIGHT),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
            };
    
            // Ensure the capture rectangle is within the view bounds
            const [viewWidth, viewHeight] = state.mainWindow.getContentSize();
            if (viewRect.x < 0 || viewRect.y < 0 || viewRect.x + viewRect.width > viewWidth || viewRect.y + viewRect.height > viewHeight - CHROME_HEIGHT) {
                // This can happen if the user's selection bleeds outside the view.
                // We don't need to throw an error, capturePage will clamp it.
            }
    
            const image = await tab.view.webContents.capturePage(viewRect);
            return { success: true, dataUrl: image.toDataURL() };
        } catch (error) {
            console.error('Area capture failed:', error);
            return { success: false, message: error.message };
        }
    });

    // Capture the full scrollable page
    ipcMain.handle('screenshot:capture-full', async (_, tabId) => {
        const tab = state.tabs.get(tabId);
    
        if (!tab) return { success: false, message: 'Tab not found.' };
        if (tab.id !== state.activeTabId) return { success: false, message: 'Full page screenshot can only be taken on the active tab.' };
        if (!tab.view || tab.view.webContents.isDestroyed()) return { success: false, message: 'Tab is not available for capture.' };
        if (activeCaptures.has(tabId)) return { success: false, message: 'A capture is already in progress for this tab.' };
    
        const webContents = tab.view.webContents;
        activeCaptures.set(tabId, { cancelled: false });
        
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send('screenshot:start', { tabId });
        }
    
        let finalResult = { success: false, message: 'An unknown error occurred.' };
        let finalDataUrl = null;
        let debuggerWasAttachedByUs = false;
    
        try {
            const pageMetrics = await webContents.executeJavaScript(`Promise.resolve({ contentHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), viewHeight: window.innerHeight })`);
            const { contentHeight, viewHeight } = pageMetrics;
    
            if (contentHeight > viewHeight) {
                const scrolls = Math.ceil(contentHeight / viewHeight);
                for (let i = 0; i < scrolls; i++) {
                    if (activeCaptures.get(tabId)?.cancelled) throw new Error('CAPTURE_CANCELLED');
                    if (webContents.isDestroyed()) throw new Error('TAB_CLOSED');
    
                    await webContents.executeJavaScript(`window.scrollTo(0, ${i * viewHeight})`);
                    if (state.mainWindow) state.mainWindow.webContents.send('screenshot:progress', { tabId, percent: Math.round(((i + 1) / scrolls) * 100) });
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                if (activeCaptures.get(tabId)?.cancelled) throw new Error('CAPTURE_CANCELLED');
                if (webContents.isDestroyed()) throw new Error('TAB_CLOSED');
                await webContents.executeJavaScript(`window.scrollTo(0, 0)`);
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                if (state.mainWindow) state.mainWindow.webContents.send('screenshot:progress', { tabId, percent: 100 });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
    
            if (activeCaptures.get(tabId)?.cancelled) throw new Error('CAPTURE_CANCELLED');
            if (webContents.isDestroyed()) throw new Error('TAB_CLOSED');
    
            if (!webContents.debugger.isAttached()) {
                await webContents.debugger.attach('1.3');
                debuggerWasAttachedByUs = true;
            }
            
            const { contentSize } = await webContents.debugger.sendCommand('Page.getLayoutMetrics');
            if (contentSize.height === 0 || contentSize.width === 0) throw new Error('Page content has zero dimensions.');
    
            let format = state.settings.screenshotFormat || 'png';
            if (!['jpeg', 'png', 'webp'].includes(format)) format = 'png';
            const quality = state.settings.screenshotQuality || 90;
        
            const screenshotData = await webContents.debugger.sendCommand('Page.captureScreenshot', {
                format: format,
                quality: (format === 'jpeg' || format === 'webp') ? quality : undefined,
                captureBeyondViewport: true,
                clip: { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 }
            });
            
            finalDataUrl = `data:image/${format};base64,${screenshotData.data}`;
            finalResult = { success: true };
    
        } catch (error) {
            console.error('Full page capture error:', error);
            if (error.message === 'CAPTURE_CANCELLED' || error.message === 'TAB_CLOSED') {
                finalResult = { success: false, message: `Capture was ${error.message === 'TAB_CLOSED' ? 'aborted because tab closed' : 'cancelled'}.` };
            } else {
                finalResult = { success: false, message: `Failed to capture page: ${error.message}` };
            }
        } finally {
            try {
                if (debuggerWasAttachedByUs && webContents && !webContents.isDestroyed() && webContents.debugger.isAttached()) {
                    await webContents.debugger.detach();
                }
            } catch (detachError) {
                console.error('Non-critical error while detaching debugger:', detachError);
            } finally {
                if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                    state.mainWindow.webContents.send('screenshot:end', { tabId, result: { ...finalResult, dataUrl: finalDataUrl } });
                }
                activeCaptures.delete(tabId);
            }
        }
        return finalResult;
    });

    // Save an image from a data URL
    ipcMain.handle('screenshot:save', async (_, dataUrl) => {
        const image = nativeImage.createFromDataURL(dataUrl);
        let format = state.settings.screenshotFormat || 'png';
        if (!['jpeg', 'png', 'webp'].includes(format)) format = 'png';

        const { canceled, filePath } = await dialog.showSaveDialog(state.mainWindow, {
            title: 'Save Screenshot',
            defaultPath: `screenshot-${Date.now()}.${format}`,
            filters: [{ name: 'Images', extensions: [format] }]
        });
    
        if (!canceled && filePath) {
            try {
                let buffer;
                if (format === 'png') buffer = image.toPNG();
                else if (format === 'jpeg') buffer = image.toJPEG(state.settings.screenshotQuality || 90);
                else buffer = image.toBitmap(); // Fallback for webp etc.
                
                fs.writeFileSync(filePath, buffer);
                return { success: true };
            } catch (error) {
                console.error('Failed to save screenshot:', error);
                return { success: false, message: error.message };
            }
        }
        return { success: false, message: 'Save dialog canceled.' };
    });

    // Copy an image from a data URL to the clipboard
    ipcMain.handle('screenshot:copy', async (_, dataUrl) => {
        try {
            const image = nativeImage.createFromDataURL(dataUrl);
            clipboard.writeImage(image);
            return { success: true };
        } catch (error) {
            console.error('Failed to copy screenshot to clipboard:', error);
            return { success: false, message: error.message };
        }
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