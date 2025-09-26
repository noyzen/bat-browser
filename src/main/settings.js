const fs = require('fs');
const state = require('./state');
const { SETTINGS_PATH } = require('./constants');
const { debounce } = require('./utils');

function loadSettings() {
    const defaults = {
        defaultFont: null,
        searchEngine: 'google',
    };

    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            return { ...defaults, ...savedSettings };
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

    if (existingKey) {
        try {
            await webContents.removeInsertedCSS(existingKey);
        } catch (e) {
            // Ignore if key not found (e.g., after a reload)
        } finally {
            tab.cssKeys.delete('defaultFont');
        }
    }

    if (fontFamily && fontFamily !== 'default') {
        const css = `
            /* Apply font to common text elements */
            body, p, h1, h2, h3, h4, h5, h6, a, li, span, div, td, th, button, input, select, textarea, label {
                font-family: "${fontFamily}", sans-serif !important;
            }

            /* Revert font for common icon selectors to let the page's CSS apply */
            i, [class^="fa-"], [class*=" fa-"], [class^="icon-"], [class*=" icon-"], .material-icons {
                font-family: revert !important;
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