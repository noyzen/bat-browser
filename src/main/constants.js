const { app } = require('electron');
const path = require('path');

module.exports = {
    CHROME_HEIGHT: 37, // Height of the unified titlebar/toolbar + 1px border
    SESSION_PATH: path.join(app.getPath('userData'), 'session.json'),
    SETTINGS_PATH: path.join(app.getPath('userData'), 'settings.json'),
    DOWNLOADS_PATH: path.join(app.getPath('userData'), 'downloads.json'),
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
        windows: {
            chrome: {
                name: 'Chrome',
                value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            },
            firefox: {
                name: 'Firefox',
                value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
            },
            edge: {
                name: 'Edge',
                value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
            },
        },
        macos: {
            safari: {
                name: 'Safari',
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
            },
            chrome: {
                name: 'Chrome',
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            },
            firefox: {
                name: 'Firefox',
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0',
            },
        },
        linux: {
            chrome: {
                name: 'Chrome',
                value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
            },
            firefox: {
                name: 'Firefox',
                value: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
            },
        },
        android: {
            chrome: {
                name: 'Chrome Mobile',
                value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
            }
        },
        ios: {
            safari: {
                name: 'Safari Mobile (iPhone)',
                value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'
            }
        }
    },
    USER_AGENT_CLIENT_HINTS: {
        windows: {
            chrome: {
                brands: '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
                mobile: '?0',
                platform: '"Windows"',
            },
            edge: {
                brands: '"Not)A;Brand";v="99", "Microsoft Edge";v="127", "Chromium";v="127"',
                mobile: '?0',
                platform: '"Windows"',
            },
        },
        macos: {
            chrome: {
                brands: '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
                mobile: '?0',
                platform: '"macOS"',
            },
        },
        linux: {
            chrome: {
                brands: '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
                mobile: '?0',
                platform: '"Linux"',
            },
        },
        android: {
            chrome: {
                brands: '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
                mobile: '?1',
                platform: '"Android"',
            }
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
