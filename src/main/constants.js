const { app } = require('electron');
const path = require('path');

module.exports = {
    CHROME_HEIGHT: 37, // Height of the unified titlebar/toolbar + 1px border
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
    USER_AGENTS: {
        'chrome-win': {
            name: 'Chrome on Windows',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        'firefox-win': {
            name: 'Firefox on Windows',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
        },
        'edge-win': {
            name: 'Edge on Windows',
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
        },
        'safari-mac': {
            name: 'Safari on macOS',
            value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        }
    },

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