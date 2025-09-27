const fs = require('fs');
const state = require('./state');
const { SETTINGS_PATH } = require('./constants');
const { debounce } = require('./utils');

function loadSettings() {
    const defaults = {
        defaultFont: null,
        searchEngine: 'google',
        userAgent: {
            current: 'windows-firefox', // key from constants.USER_AGENTS
            custom: '',
        },
        ai: {
            enabled: false,
            apiKeys: [], // { id, name, key }
            activeApiKeyId: null,
            panelOpen: false,
            panelWidth: 350,
        },
        hotkeys: {
            'new-tab': 'Ctrl+T',
            'close-tab': 'Ctrl+W',
            'find-in-page': 'Ctrl+F',
            'quick-search-tabs': 'Ctrl+Shift+F',
            'zoom-in': 'Ctrl+=',
            'zoom-out': 'Ctrl+-',
            'zoom-reset': 'Ctrl+0',
            'reload': 'Ctrl+R',
            'go-back': 'Alt+ArrowLeft',
            'go-forward': 'Alt+ArrowRight',
        },
    };

    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            const merged = { ...defaults, ...savedSettings };
            // Deep merge nested objects
            if (savedSettings.userAgent) {
                merged.userAgent = { ...defaults.userAgent, ...savedSettings.userAgent };
            }
            if (savedSettings.ai) {
                merged.ai = { ...defaults.ai, ...savedSettings.ai };
            }
            if (savedSettings.hotkeys) {
                merged.hotkeys = { ...defaults.hotkeys, ...savedSettings.hotkeys };
            }
            return merged;
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return defaults;
}

const debouncedSaveSettings = debounce(() => {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(state.settings, null, 2));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}, 500);

async function applyFontSetting(tab, fontFamily) {
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
    const webContents = tab.view.webContents;
    const existingKey = tab.cssKeys.get('defaultFont');

    // Always try to remove the old CSS, in case the font is being turned off.
    if (existingKey) {
        try {
            await webContents.removeInsertedCSS(existingKey);
        } catch (e) {
            // Ignore if key not found (e.g., after a reload or if it was never inserted)
        } finally {
            tab.cssKeys.delete('defaultFont');
        }
    }

    // Only inject new CSS if a custom font is selected.
    if (fontFamily && fontFamily !== 'default') {
        const css = `
            /*
              Forcefully override the font for all common text-containing elements.
              Using a long list of selectors with '!important' ensures that the user's
              font choice overrides website-defined fonts for general content.
              This approach is powerful enough to work on complex pages like Google's.
            */
            html, body, div, p, span, a, li, td, th, h1, h2, h3, h4, h5, h6,
            input, textarea, select, button, [role="button"], [contenteditable="true"] {
                font-family: "${fontFamily}", sans-serif !important;
            }

            /*
              Specialized fonts, like icon fonts, are typically applied with more
              specific class-based selectors (e.g., '.fa', '.material-icons').
              When those selectors also use '!important', their higher specificity
              (class vs. element) allows them to win against this general override,
              thus preserving icons and other special typography.
            */
        `;
        try {
            const newKey = await webContents.insertCSS(css);
            tab.cssKeys.set('defaultFont', newKey);
        } catch (e) {
            console.error('Failed to insert font CSS:', e);
        }
    }
}


module.exports = {
    loadSettings,
    debouncedSaveSettings,
    applyFontSetting,
};