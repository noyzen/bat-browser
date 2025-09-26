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
async function populateSettings() {
    const settings = await window.electronAPI.getSettings();

    // Appearance
    if (fontsLoaded) {
        DOM.fontSelect.value = settings.defaultFont || 'default';
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
    
            DOM.fontSelect.value = settings.defaultFont || 'default';
    
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
    searchSelect.value = settings.searchEngine || 'google';
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
    DOM.appChrome.classList.add('hidden');
    document.dispatchEvent(new Event('DOMContentLoaded')); // Refresh max button
}

async function hideSettingsView() {
    DOM.settingsView.classList.add('hidden');
    DOM.appChrome.classList.remove('hidden');
    await window.electronAPI.showActiveView();
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