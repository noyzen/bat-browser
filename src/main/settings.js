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
        // This CSS applies the selected font to all elements using the universal selector (*).
        // This selector has the lowest possible specificity (0,0,0), meaning any other
        // font-family rule from the website (e.g., on `body`, `p`, or a class like `.icon`)
        // will have higher specificity and override this rule.
        // This correctly sets a new "default" font for any text not explicitly styled by the site,
        // without breaking site-specific typography or icon fonts.
        const css = `
            * {
                font-family: "${fontFamily}", sans-serif;
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