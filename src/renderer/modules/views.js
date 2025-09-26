import * as DOM from './dom.js';
import { state, isTabInAnyGroup } from '../renderer.js';
import { renderTab, renderGroup } from './render.js';

let fullRenderCallback;

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
async function populateFontSelector() {
    if (fontsLoaded) {
        const currentFont = await window.electronAPI.getDefaultFont();
        DOM.fontSelect.value = currentFont;
        return;
    }

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
            option.style.fontFamily = family;
            DOM.fontSelect.appendChild(option);
        });

        const currentFont = await window.electronAPI.getDefaultFont();
        DOM.fontSelect.value = currentFont;

        fontsLoaded = true;
        DOM.fontLoadingIndicator.style.display = 'none';
        DOM.fontSelect.style.display = 'block';

    } catch (err) {
        console.error("Error getting system fonts:", err);
        DOM.fontLoadingIndicator.innerHTML = "Could not load system fonts.";
    }
}

async function showSettingsView() {
    await window.electronAPI.hideActiveView();
    populateFontSelector();
    DOM.settingsView.classList.remove('hidden');
    DOM.appChrome.classList.add('hidden');
    // refreshMaxButton needs to be called from events module
    document.dispatchEvent(new Event('DOMContentLoaded'));
}

async function hideSettingsView() {
    DOM.settingsView.classList.add('hidden');
    DOM.appChrome.classList.remove('hidden');
    await window.electronAPI.showActiveView();
}

export function initViews({ fullRender }) {
    fullRenderCallback = fullRender;
    
    // All Tabs View listeners
    DOM.backToBrowserBtn.addEventListener('click', hideAllTabsView);
    DOM.allTabsSearchInput.addEventListener('input', renderAllTabsView);
    DOM.allTabsView.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideAllTabsView();
    });

    // Settings View listeners
    DOM.settingsBtn.addEventListener('click', showSettingsView);
    DOM.settingsBackBtn.addEventListener('click', hideSettingsView);
    DOM.fontSelect.addEventListener('change', () => {
        window.electronAPI.setDefaultFont(DOM.fontSelect.value);
    });
}
