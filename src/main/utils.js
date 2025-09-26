const state = require('./state');
const { PREDEFINED_COLORS } = require('./constants');

function debounce(func, timeout = 500) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

function getRandomColor() {
    return PREDEFINED_COLORS[Math.floor(Math.random() * PREDEFINED_COLORS.length)];
}

function getSerializableTabData(tab) {
    if (!tab) return null;
    const { id, url, title, canGoBack, canGoForward, isLoading, isLoaded, isHibernated, color } = tab;
    return { id, url, title, canGoBack, canGoForward, isLoading, isLoaded, isHibernated, color };
}

function findTabByWebContents(webContents) {
    if (!webContents || webContents.isDestroyed()) return null;
    for (const tab of state.tabs.values()) {
        if (tab.view && tab.view.webContents === webContents) {
            return tab;
        }
    }
    return null;
}

module.exports = {
    debounce,
    getRandomColor,
    getSerializableTabData,
    findTabByWebContents,
};
