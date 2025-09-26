import * as DOM from './dom.js';

let allTabsCache = [];

export function applyUiFont(fontFamily) {
    const font = (fontFamily === 'default' || !fontFamily) 
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif'
        : `"${fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif`;
    
    document.documentElement.style.setProperty('--ui-font-family', font);
}

// --- Find In Page ---
export function showFindBar() {
    DOM.findBar.classList.remove('hidden');
    DOM.findInput.focus();
    DOM.findInput.select();
}
function hideFindBar() {
    DOM.findBar.classList.add('hidden');
    window.electronAPI.findStop();
    DOM.findInput.value = '';
    DOM.findMatches.textContent = '';
}

// --- Tab Search (Quick Search) ---
export function showTabSearch() {
    window.electronAPI.getAllTabs().then(allTabs => {
        allTabsCache = allTabs;
        DOM.searchInput.value = '';
        renderSearchResults('');
        DOM.searchOverlay.classList.remove('hidden');
        DOM.searchInput.focus();
    });
}
function hideTabSearch() {
    DOM.searchOverlay.classList.add('hidden');
}
function renderSearchResults(query) {
    DOM.searchResults.innerHTML = '';
    const filtered = allTabsCache.filter(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query));
    
    filtered.forEach((tab, index) => {
        const li = document.createElement('li');
        li.dataset.id = tab.id;
        if(index === 0) li.classList.add('selected');
        
        const title = document.createElement('span');
        title.className = 'search-result-title';
        title.textContent = tab.title;
        const url = document.createElement('span');
        url.className = 'search-result-url';
        url.textContent = tab.url;
        
        li.append(title, url);
        li.addEventListener('click', () => {
            window.electronAPI.switchTab(tab.id);
            hideTabSearch();
        });
        DOM.searchResults.appendChild(li);
    });
}

// --- Modals ---
async function showDialog(builder) {
    try {
      await window.electronAPI.hideActiveView();
      return await new Promise(resolve => {
        const { overlay, okBtn, cancelBtn, inputEl } = builder(resolve);
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
  
        function cleanup(value) {
          window.removeEventListener('keydown', onKeyDown, true);
          overlay.classList.remove('visible');
          overlay.addEventListener('transitionend', () => {
            overlay.remove();
            resolve(value);
          }, { once: true });
        }
        function onOk() { cleanup(inputEl ? inputEl.value : true); }
        function onCancel() { cleanup(inputEl ? null : false); }
        function onKeyDown(e) {
            if (e.key === 'Enter' && inputEl) { e.preventDefault(); onOk(); }
            else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }
        okBtn.addEventListener('click', onOk, { once: true });
        cancelBtn.addEventListener('click', onCancel, { once: true });
        window.addEventListener('keydown', onKeyDown, true);
        (inputEl || okBtn).focus();
        if (inputEl) inputEl.select();
      });
    } finally {
      await window.electronAPI.showActiveView();
    }
}

function buildDialogElements(title, message) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    const titleEl = document.createElement('h3');
    titleEl.className = 'modal-title';
    titleEl.textContent = title;
    const messageEl = document.createElement('p');
    messageEl.className = 'modal-message';
    messageEl.textContent = message;
    const buttonsWrapper = document.createElement('div');
    buttonsWrapper.className = 'modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-btn';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'ok-btn';
    okBtn.textContent = 'OK';
    buttonsWrapper.append(cancelBtn, okBtn);
    dialog.append(titleEl, messageEl);
    overlay.appendChild(dialog);
    return { overlay, dialog, buttonsWrapper, okBtn, cancelBtn };
}

export async function showConfirmationDialog(title, message) {
    return showDialog(() => {
        const { overlay, dialog, buttonsWrapper, okBtn, cancelBtn } = buildDialogElements(title, message);
        dialog.appendChild(buttonsWrapper);
        return { overlay, okBtn, cancelBtn };
    });
}

export async function showPromptDialog(title, message, defaultValue = '') {
    return showDialog(() => {
        const { overlay, dialog, buttonsWrapper, okBtn, cancelBtn } = buildDialogElements(title, message);
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'modal-input';
        inputEl.value = defaultValue;
        dialog.append(inputEl, buttonsWrapper);
        return { overlay, okBtn, cancelBtn, inputEl };
    });
}

// --- Misc Features ---
const PREDEFINED_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
    '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784'
];
export function getRandomColor() {
  return PREDEFINED_COLORS[Math.floor(Math.random() * PREDEFINED_COLORS.length)];
}

export function handleCloseTab(id, { getState, persistState, fullRender }) {
    window.electronAPI.closeTab(id);
    const state = getState();
    const wasActive = state.activeTabId === id;
    
    state.tabs.delete(id);
    state.layout = state.layout.filter(itemId => itemId !== id);
    state.groups.forEach(group => {
        group.tabs = group.tabs.filter(tabId => tabId !== id);
        if(group.tabs.length === 0) {
            state.groups.delete(group.id);
            state.layout = state.layout.filter(itemId => itemId !== group.id);
        }
    });

    if (wasActive) {
        const findNextTab = () => {
            for (const itemId of state.layout) {
                if (state.tabs.has(itemId) && !isTabInAnyGroup(itemId, state)) return itemId;
                if (state.groups.has(itemId)) {
                    const group = state.groups.get(itemId);
                    if (!group.collapsed && group.tabs.length > 0) return group.tabs[0];
                }
            }
            return null;
        }
        
        let nextTabId = findNextTab();
        if (nextTabId) {
            window.electronAPI.switchTab(nextTabId);
        }
    }
    
    persistState();
    fullRender();
}
function isTabInAnyGroup(tabId, { groups }) {
    for (const group of groups.values()) {
        if (group.tabs.includes(tabId)) return true;
    }
    return false;
};

// --- Initialization ---
export function initFeatures() {
    DOM.findInput.addEventListener('input', () => {
        const query = DOM.findInput.value;
        if (query) window.electronAPI.findStart(query);
        else {
          window.electronAPI.findStop();
          DOM.findMatches.textContent = '';
        }
    });
    DOM.findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') DOM.findNextBtn.click();
        if (e.key === 'Escape') hideFindBar();
    });
    DOM.findNextBtn.addEventListener('click', () => window.electronAPI.findNext(DOM.findInput.value, true));
    DOM.findPrevBtn.addEventListener('click', () => window.electronAPI.findNext(DOM.findInput.value, false));
    DOM.findCloseBtn.addEventListener('click', hideFindBar);
    
    DOM.searchInput.addEventListener('input', () => renderSearchResults(DOM.searchInput.value.toLowerCase()));
    DOM.searchInput.addEventListener('keydown', (e) => {
        const selected = DOM.searchResults.querySelector('.selected');
        if (e.key === 'Escape') hideTabSearch();
        if (e.key === 'Enter' && selected) selected.click();
        if (e.key === 'ArrowDown' && selected?.nextElementSibling) {
            selected.classList.remove('selected');
            selected.nextElementSibling.classList.add('selected');
        }
        if (e.key === 'ArrowUp' && selected?.previousElementSibling) {
            selected.classList.remove('selected');
            selected.previousElementSibling.classList.add('selected');
        }
    });
    DOM.searchOverlay.addEventListener('click', (e) => {
        if (e.target === DOM.searchOverlay) hideTabSearch();
    });
}