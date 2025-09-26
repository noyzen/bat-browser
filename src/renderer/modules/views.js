import * as DOM from './dom.js';
import { state, isTabInAnyGroup } from '../renderer.js';
import { renderTab, renderGroup } from './render.js';
import { applyUiFont } from './features.js';

let fullRenderCallback;
let settingsSearchInput;

// --- All Tabs View ---
export function showAllTabsView() {
    window.electronAPI.hideActiveView();
    renderAllTabsView();
    DOM.allTabsView.classList.remove('hidden');
    DOM.appChrome.classList.add('hidden');
    DOM.allTabsSearchInput.focus();
    DOM.allTabsSearchInput.select();
}
export function hideAllTabsView() {
    DOM.allTabsView.classList.add('hidden');
    DOM.appChrome.classList.remove('hidden');
    if(fullRenderCallback) fullRenderCallback();
    window.electronAPI.showActiveView();
}

export function renderAllTabsView() {
    DOM.allTabsListContainer.innerHTML = '';
    DOM.allTabsListContainer.className = 'all-tabs-list-view';
    const fragment = document.createDocumentFragment();
    const query = DOM.allTabsSearchInput.value.toLowerCase();

    const getVisibleTabs = () => {
      if (!query) return new Set(state.tabs.keys());
      return new Set(
        Array.from(state.tabs.values())
          .filter(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
          .map(t => t.id)
      );
    };
    const visibleTabIds = getVisibleTabs();
    
    let hasVisibleItems = false;
    state.layout.forEach(id => {
        if (state.groups.has(id)) {
            const group = state.groups.get(id);
            const groupHasVisibleTabs = group.tabs.some(tid => visibleTabIds.has(tid));
            if (groupHasVisibleTabs) {
                hasVisibleItems = true;
                const groupEl = renderGroup(id, 'all-tabs', visibleTabIds);
                fragment.appendChild(groupEl);
            }
        } else if (state.tabs.has(id) && !isTabInAnyGroup(id)) {
            if (visibleTabIds.has(id)) {
                hasVisibleItems = true;
                const tabEl = renderTab(id, 'all-tabs');
                if (tabEl) fragment.appendChild(tabEl);
            }
        }
    });

    if (!hasVisibleItems && query) {
        const noResultsEl = document.createElement('div');
        noResultsEl.className = 'all-tabs-no-results';
        noResultsEl.textContent = 'No matching tabs found.';
        fragment.appendChild(noResultsEl);
    }
    DOM.allTabsListContainer.appendChild(fragment);
}

// --- Settings View ---
let fontsLoaded = false;
let currentSettings = {};
const aiSettingsContent = document.getElementById('ai-settings-content');
const aiEnableToggle = document.getElementById('ai-enable-toggle');
const apiKeyList = document.getElementById('api-key-list');
const addApiKeyBtn = document.getElementById('add-api-key-btn');
const apiKeyNameInput = document.getElementById('api-key-name-input');
const apiKeyInput = document.getElementById('api-key-input');
const getApiKeyBtn = document.getElementById('get-api-key-btn');

const hotkeyContainer = document.getElementById('hotkey-list');
let currentRecordingElement = null;

const HOTKEY_COMMANDS = {
    'new-tab': { title: 'New Tab', description: 'Open a new browser tab.' },
    'close-tab': { title: 'Close Tab', description: 'Close the current active tab.' },
    'find-in-page': { title: 'Find in Page', description: 'Show the find bar for the current page.' },
    'quick-search-tabs': { title: 'Quick Search Tabs', description: 'Open the quick tab search overlay.' },
    'zoom-in': { title: 'Zoom In', description: 'Increase the zoom level of the page.' },
    'zoom-out': { title: 'Zoom Out', description: 'Decrease the zoom level of the page.' },
    'zoom-reset': { title: 'Reset Zoom', description: 'Reset the zoom level to 100%.' },
    'reload': { title: 'Reload', description: 'Reload the current page.' },
    'go-back': { title: 'Go Back', description: 'Navigate to the previous page in history.' },
    'go-forward': { title: 'Go Forward', description: 'Navigate to the next page in history.' },
};

const DEFAULT_HOTKEYS = {
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
};

async function populateSettings() {
    currentSettings = await window.electronAPI.getSettings();

    // Appearance
    if (fontsLoaded) {
        DOM.fontSelect.value = currentSettings.defaultFont || 'default';
    } else {
        try {
            if (!window.queryLocalFonts) {
                DOM.fontLoadingIndicator.innerHTML = "Font detection not supported.";
                return;
            }
    
            const availableFonts = await window.queryLocalFonts();
            const fontFamilies = new Set(availableFonts.map(f => f.family));
    
            DOM.fontSelect.innerHTML = '<option value="default">Browser Default</option>';
            [...fontFamilies].sort((a, b) => a.localeCompare(b)).forEach(family => {
                const option = document.createElement('option');
                option.value = family;
                option.textContent = family;
                option.style.fontFamily = `"${family}"`;
                DOM.fontSelect.appendChild(option);
            });
    
            DOM.fontSelect.value = currentSettings.defaultFont || 'default';
    
            fontsLoaded = true;
            DOM.fontLoadingIndicator.style.display = 'none';
            DOM.fontSelect.style.display = 'block';
    
        } catch (err) {
            console.error("Error getting system fonts:", err);
            DOM.fontLoadingIndicator.innerHTML = "Could not load system fonts.";
        }
    }

    // Search
    const searchSelect = document.getElementById('search-engine-select');
    searchSelect.innerHTML = `
        <option value="google">Google</option>
        <option value="duckduckgo">DuckDuckGo</option>
        <option value="bing">Bing</option>
        <option value="startpage">Startpage</option>
    `;
    searchSelect.value = currentSettings.searchEngine || 'google';

    // AI
    populateAISettings();
    // Hotkeys
    populateHotkeys();
}

function populateAISettings() {
    const aiConf = currentSettings.ai || {};
    aiEnableToggle.checked = aiConf.enabled;
    aiSettingsContent.classList.toggle('hidden', !aiConf.enabled);
    renderAPIKeyList();
}

function renderAPIKeyList() {
    apiKeyList.innerHTML = '';
    const aiConf = currentSettings.ai || {};
    if (!aiConf.apiKeys || aiConf.apiKeys.length === 0) {
        apiKeyList.innerHTML = `<p class="no-keys-message">No API keys added yet.</p>`;
        return;
    }

    aiConf.apiKeys.forEach(key => {
        const keyEl = document.createElement('div');
        keyEl.className = 'api-key-item';
        const isActive = key.id === aiConf.activeApiKeyId;
        keyEl.classList.toggle('active', isActive);

        const infoWrapper = document.createElement('div');
        infoWrapper.className = 'key-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'api-key-name';
        nameEl.textContent = key.name;
        
        const partialKeyEl = document.createElement('span');
        partialKeyEl.className = 'api-key-partial';
        partialKeyEl.textContent = `(...${key.key.slice(-4)})`;

        infoWrapper.append(nameEl, partialKeyEl);
        
        const controlsEl = document.createElement('div');
        controlsEl.className = 'api-key-controls';

        if (isActive) {
            const activeBadge = document.createElement('span');
            activeBadge.className = 'api-key-active-badge';
            activeBadge.textContent = 'Active';
            controlsEl.appendChild(activeBadge);
        } else {
            const setActiveBtn = document.createElement('button');
            setActiveBtn.textContent = 'Set Active';
            setActiveBtn.addEventListener('click', () => {
                currentSettings.ai.activeApiKeyId = key.id;
                window.electronAPI.settingsSetAI(currentSettings.ai);
                renderAPIKeyList();
            });
            controlsEl.appendChild(setActiveBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-key-btn';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.title = 'Delete Key';
        deleteBtn.addEventListener('click', () => {
            currentSettings.ai.apiKeys = currentSettings.ai.apiKeys.filter(k => k.id !== key.id);
            if (currentSettings.ai.activeApiKeyId === key.id) {
                currentSettings.ai.activeApiKeyId = currentSettings.ai.apiKeys.length > 0 ? currentSettings.ai.apiKeys[0].id : null;
            }
            window.electronAPI.settingsSetAI(currentSettings.ai);
            renderAPIKeyList();
        });

        controlsEl.append(deleteBtn);
        keyEl.append(infoWrapper, controlsEl);
        apiKeyList.appendChild(keyEl);
    });
}

function populateHotkeys() {
    const hotkeys = currentSettings.hotkeys || {};
    hotkeyContainer.innerHTML = '';

    Object.entries(HOTKEY_COMMANDS).forEach(([command, { title, description }]) => {
        const hotkey = hotkeys[command] || 'Not Set';

        const item = document.createElement('div');
        item.className = 'setting-item hotkey-item';
        item.dataset.command = command;
        item.dataset.keywords = `${title.toLowerCase()} ${command.replace(/-/g, ' ')}`;

        item.innerHTML = `
            <div class="setting-label">
                <h2>${title}</h2>
                <p>${description}</p>
            </div>
            <div class="setting-control hotkey-control">
                <div class="hotkey-display" tabindex="0" role="button" aria-label="Current shortcut is ${hotkey}. Press to record a new shortcut">${hotkey}</div>
                <button class="hotkey-reset-btn" title="Reset to default"><i class="fa-solid fa-rotate-left"></i></button>
            </div>
        `;
        hotkeyContainer.appendChild(item);
    });
}

function handleSettingsSearch(e) {
    const query = e.target.value.toLowerCase().trim();

    document.querySelectorAll('#settings-main .settings-section').forEach(section => {
        const sectionKeywords = section.dataset.keywords || '';
        let sectionHasVisibleItem = false;

        section.querySelectorAll('.setting-item').forEach(item => {
            const itemKeywords = item.dataset.keywords || '';
            const matches = query === '' || sectionKeywords.includes(query) || itemKeywords.includes(query);
            item.classList.toggle('hidden-by-search', !matches);
            if (matches) {
                sectionHasVisibleItem = true;
            }
        });
        
        const sectionMatches = query === '' || sectionKeywords.includes(query) || sectionHasVisibleItem;
        const navItem = document.querySelector(`#settings-sidebar a[href="#${section.id}"]`);
        
        if (navItem) {
            navItem.parentElement.style.display = sectionMatches ? '' : 'none';
        }

        if (!sectionMatches) {
            section.style.display = 'none';
        } else if (document.querySelector('#settings-sidebar li.active a').getAttribute('href') === `#${section.id}`) {
             section.style.display = 'block';
        } else {
             section.style.display = 'none';
        }
    });

    // If a search is active and the current active tab is hidden, activate the first visible one
    if (query && document.querySelector('#settings-sidebar li.active').style.display === 'none') {
        const firstVisibleLink = document.querySelector('#settings-sidebar li:not([style*="display: none"]) a');
        if (firstVisibleLink) {
            firstVisibleLink.click();
        }
    }
}


async function showSettingsView() {
    await window.electronAPI.hideActiveView();
    populateSettings();
    DOM.settingsView.classList.remove('hidden');
    document.body.classList.add('settings-open');
    document.dispatchEvent(new Event('DOMContentLoaded')); // Refresh max button
}

async function hideSettingsView() {
    DOM.settingsView.classList.add('hidden');
    document.body.classList.remove('settings-open');
    await window.electronAPI.showActiveView();
}

function handleHotkeyRecordStart(e) {
    const target = e.target.closest('.hotkey-display');
    if (!target) return;

    if (currentRecordingElement) {
        currentRecordingElement.classList.remove('recording');
        currentRecordingElement.textContent = currentRecordingElement.dataset.originalValue;
    }
    
    currentRecordingElement = target;
    target.dataset.originalValue = target.textContent;
    target.textContent = 'Recording';
    target.classList.add('recording');

    window.addEventListener('keydown', handleHotkeyRecordEvent, { once: true, capture: true });
    window.addEventListener('mousedown', cancelRecording, { once: true, capture: true });
}

function cancelRecording(e) {
    if (currentRecordingElement && e.target !== currentRecordingElement) {
        currentRecordingElement.classList.remove('recording');
        currentRecordingElement.textContent = currentRecordingElement.dataset.originalValue;
        currentRecordingElement = null;
        window.removeEventListener('keydown', handleHotkeyRecordEvent, { once: true, capture: true });
    }
}

async function handleHotkeyRecordEvent(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!currentRecordingElement) return;

    window.removeEventListener('mousedown', cancelRecording, { once: true, capture: true });

    let combo = [];
    if (e.ctrlKey) combo.push('Ctrl');
    if (e.altKey) combo.push('Alt');
    if (e.shiftKey) combo.push('Shift');
    if (e.metaKey) combo.push('Meta');

    const key = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta', 'Hyper', 'Super'].includes(key)) {
        currentRecordingElement.textContent = currentRecordingElement.dataset.originalValue;
        currentRecordingElement.classList.remove('recording');
        currentRecordingElement = null;
        return;
    }
    
    const formattedKey = key.length === 1 ? key.toUpperCase() : key;
    combo.push(formattedKey);

    const newHotkey = combo.join('+');
    currentRecordingElement.textContent = newHotkey;
    currentRecordingElement.classList.remove('recording');

    const command = currentRecordingElement.closest('.hotkey-item').dataset.command;
    
    for (const [cmd, hk] of Object.entries(currentSettings.hotkeys)) {
        if (hk === newHotkey && cmd !== command) {
            alert(`Shortcut "${newHotkey}" is already assigned to "${HOTKEY_COMMANDS[cmd]?.title || cmd}".`);
            currentRecordingElement.textContent = currentRecordingElement.dataset.originalValue; // Revert
            currentRecordingElement = null;
            return;
        }
    }

    currentSettings.hotkeys[command] = newHotkey;
    await window.electronAPI.settingsSetHotkeys(currentSettings.hotkeys);
    document.dispatchEvent(new CustomEvent('hotkeys-updated', { detail: currentSettings.hotkeys }));

    currentRecordingElement = null;
}

async function handleHotkeyReset(e) {
    const target = e.target.closest('.hotkey-reset-btn');
    if (!target) return;
    
    const item = target.closest('.hotkey-item');
    const command = item.dataset.command;
    const defaultHotkey = DEFAULT_HOTKEYS[command];

    if (defaultHotkey) {
        for (const [cmd, hk] of Object.entries(currentSettings.hotkeys)) {
            if (hk === defaultHotkey && cmd !== command) {
                 alert(`Default shortcut "${defaultHotkey}" is currently assigned to "${HOTKEY_COMMANDS[cmd]?.title || cmd}". Please change that shortcut first before resetting this one.`);
                 return;
            }
        }

        currentSettings.hotkeys[command] = defaultHotkey;
        item.querySelector('.hotkey-display').textContent = defaultHotkey;
        await window.electronAPI.settingsSetHotkeys(currentSettings.hotkeys);
        document.dispatchEvent(new CustomEvent('hotkeys-updated', { detail: currentSettings.hotkeys }));
    }
}


export function initViews({ fullRender }) {
    fullRenderCallback = fullRender;
    settingsSearchInput = document.getElementById('settings-search-input');
    
    // All Tabs View listeners
    DOM.backToBrowserBtn.addEventListener('click', hideAllTabsView);
    DOM.allTabsSearchInput.addEventListener('input', renderAllTabsView);
    DOM.allTabsView.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideAllTabsView();
    });

    // Settings View listeners
    DOM.settingsBtn.addEventListener('click', showSettingsView);
    DOM.settingsBackBtn.addEventListener('click', hideSettingsView);
    settingsSearchInput.addEventListener('input', handleSettingsSearch);

    // -- Appearance
    DOM.fontSelect.addEventListener('change', () => {
        const fontFamily = DOM.fontSelect.value;
        window.electronAPI.setDefaultFont(fontFamily);
        applyUiFont(fontFamily);
    });

    // -- Search
    document.getElementById('search-engine-select').addEventListener('change', (e) => {
        window.electronAPI.settingsSetSearchEngine(e.target.value);
    });
    
    // -- AI
    getApiKeyBtn.addEventListener('click', () => {
        window.electronAPI.openExternal('https://aistudio.google.com/app/apikey');
    });

    aiEnableToggle.addEventListener('change', () => {
        currentSettings.ai.enabled = aiEnableToggle.checked;
        window.electronAPI.settingsSetAI({ enabled: currentSettings.ai.enabled });
        aiSettingsContent.classList.toggle('hidden', !currentSettings.ai.enabled);
    });

    addApiKeyBtn.addEventListener('click', () => {
        const name = apiKeyNameInput.value.trim();
        const key = apiKeyInput.value.trim();
        if (!name || !key) return;

        const newKey = { id: `key-${Date.now()}`, name, key };
        if (!currentSettings.ai.apiKeys) currentSettings.ai.apiKeys = [];
        currentSettings.ai.apiKeys.push(newKey);
        
        // If it's the first key, make it active
        if (currentSettings.ai.apiKeys.length === 1) {
            currentSettings.ai.activeApiKeyId = newKey.id;
        }

        window.electronAPI.settingsSetAI(currentSettings.ai);
        apiKeyNameInput.value = '';
        apiKeyInput.value = '';
        renderAPIKeyList();
    });
    
    // -- Hotkeys
    hotkeyContainer.addEventListener('click', (e) => {
      handleHotkeyRecordStart(e);
      handleHotkeyReset(e);
    });

    // -- Sidebar navigation
    document.querySelectorAll('#settings-sidebar a').forEach(link => {
      link.addEventListener('click', e => {
          e.preventDefault();
          const activeLink = document.querySelector('#settings-sidebar li.active');
          if (activeLink) activeLink.classList.remove('active');
          e.currentTarget.parentElement.classList.add('active');

          const targetId = e.currentTarget.getAttribute('href').substring(1);
          document.querySelectorAll('#settings-main .settings-section').forEach(section => {
              section.style.display = section.id === targetId ? 'block' : 'none';
          });
      });
    });

    // Set initial section visibility
    document.querySelector('#settings-main .settings-section#appearance').style.display = 'block';
}