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

            /*
             * Revert font for elements that are very likely to be icons.
             * This is a blacklist approach to prevent the custom font from breaking icon fonts.
             * The 'i' tag is included as a broad catch-all, as it's overwhelmingly used for icons.
             * This may cause text in <i> tags intended for italics to not use the custom font,
             * which is an accepted trade-off for fixing broken icons.
             */
            i, /* Broad catch-all for icons */
            [data-icon], /* Elements with data-icon attribute */
            .fa, .fas, .far, .fal, .fab, [class^="fa-"], [class*=" fa-"], /* Font Awesome */
            .bi, [class^="bi-"], [class*=" bi-"], /* Bootstrap Icons */
            .glyphicon, [class^="glyphicon-"], /* Glyphicons */
            .material-icons, .material-symbols, .material-symbols-outlined, /* Material Design Icons */
            .icon, [class^="icon-"], [class*=" icon-"], /* Generic icon classes */
            [data-icon]::before, [data-icon]::after { /* Pseudo-elements with data-icon on parent */
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