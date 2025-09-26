const { ipcMain, Menu, clipboard } = require('electron');
const path = require('path');
const state = require('./state');
const tabsModule = require('./tabs');
const settingsModule = require('./settings');
const sessionModule = require('./session');
const utils = require('./utils');
const { getSerializableTabData } = require('./utils');

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
    ipcMain.handle('tab:loadURL', (_, url) => state.getActiveTab()?.view.webContents.loadURL(url));
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

    ipcMain.on('view:loadURL', (event, url) => {
        const tab = utils.findTabByWebContents(event.sender);
        if (tab && tab.view) {
            tab.view.webContents.loadURL(url);
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