const { app } = require('electron');
const path = require('path');

module.exports = {
    CHROME_HEIGHT: 38, // Height of the unified titlebar/toolbar + 2px border
    SESSION_PATH: path.join(app.getPath('userData'), 'session.json'),
    SETTINGS_PATH: path.join(app.getPath('userData'), 'settings.json'),
    SHARED_SESSION_PARTITION: 'persist:shared-data-session',
    PREDEFINED_COLORS: [
        '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
        '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
        '#aed581', '#dce775', '#fff176', '#ffd54f', '#ffb74d', '#ff8a65'
    ],
    SEARCH_ENGINES: {
        google: 'https://www.google.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q=',
        bing: 'https://www.bing.com/search?q=',
        startpage: 'https://www.startpage.com/sp/search?q=',
    },
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',

    BROWSER_VIEW_WEBCONTENTS_CONFIG: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        plugins: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        preload: path.join(__dirname, 'viewPreload.js'),
    },
};