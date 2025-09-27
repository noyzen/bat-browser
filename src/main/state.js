const state = {
    mainWindow: null,
    tabs: new Map(),
    groups: new Map(),
    downloads: new Map(),
    layout: [],
    activeTabId: null,
    settings: {},

    getActiveTab: function() {
        return this.tabs.get(this.activeTabId);
    },
    setMainWindow: function(win) {
        this.mainWindow = win;
    },
};

module.exports = state;
