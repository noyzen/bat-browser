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
    };

    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            const merged = { ...defaults, ...savedSettings };
            // Deep merge AI settings
            if (savedSettings.ai) {
                merged.ai = { ...defaults.ai, ...savedSettings.ai };
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
        // Use CSS Cascade Layers to inject a low-priority default font.
        // 1. Author origin styles (like this one) override User-Agent (browser default) styles.
        // 2. Un-layered author styles (from the website) override layered styles, regardless of specificity.
        // This ensures our font acts as a new default but never breaks a website's custom typography.
        // We target body and common form elements that don't always inherit fonts.
        const css = `
            @layer batBrowserDefaults {
                body, input, textarea, select, button {
                    font-family: "${fontFamily}", sans-serif;
                }
            }
        `;
        try {
            // Sanitize CSS for injection
            const newKey = await webContents.insertCSS(css.trim().replace(/\s+/g, ' '));
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