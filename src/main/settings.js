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
            /* Apply the custom font to the body with high specificity */
            html body {
                font-family: "${fontFamily}", sans-serif !important;
            }

            /* Force inheritance for elements that might not get it from body, e.g., form elements. */
            button, input, select, textarea, code, kbd, pre, samp {
                font-family: inherit;
            }

            /* Revert font for elements that are very likely to be icons. */
            .fa, .fas, .far, .fal, .fab, [class^="fa-"], [class*=" fa-"],
            .glyphicon, [class^="glyphicon-"],
            .material-icons, .material-symbols, .material-symbols-outlined,
            .icon, [class^="icon-"], [class*=" icon-"],
            [data-icon]::before {
                font-family: revert !important;
                font-style: revert !important;
                font-weight: revert !important;
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