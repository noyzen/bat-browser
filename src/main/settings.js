const fs = require('fs');
const state = require('./state');
const { SETTINGS_PATH } = require('./constants');
const { debounce } = require('./utils');

function loadSettings() {
    const defaults = {
        defaultFont: null,
        searchEngine: 'google',
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
            // Deep merge AI settings
            if (savedSettings.ai) {
                merged.ai = { ...defaults.ai, ...savedSettings.ai };
            }
            // Deep merge hotkeys to ensure new defaults are added for existing users
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
        // Use :where(body) to inject a zero-specificity default font.
        // This acts as a new base font but allows any website CSS to override it,
        // mimicking the behavior of browser's default font settings.
        const css = `
            :where(body) {
                font-family: "${fontFamily}", sans-serif;
            }
            /* Ensure common form elements and editable content inherit the new default font. */
            :where(input, textarea, select, button, [role="button"], [contenteditable="true"]) {
                font-family: inherit;
            }
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