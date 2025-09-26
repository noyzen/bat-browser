const state = {
    mainWindow: null,
    tabs: new Map(),
    groups: new Map(),
    layout: [],
    activeTabId: null,
    settings: {},

    // Modules (to avoid circular dependencies)
    constants: require('./constants'),
    utils: require('./utils'),
    sessionModule: null,
    settingsModule: null,
    tabsModule: null,

    getActiveTab: function() {
        return this.tabs.get(this.activeTabId);
    },
    setMainWindow: function(win) {
        this.mainWindow = win;
    },
};

// Lazy-load modules to break circular dependency cycles
state.sessionModule = require('./session');
state.settingsModule = require('./settings');
state.tabsModule = require('./tabs');


module.exports = state;
