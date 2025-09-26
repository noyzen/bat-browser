import * as DOM from './dom.js';
import { state, isTabInAnyGroup } from '../renderer.js';
import { handleCloseTab } from './features.js';

let updateTabScrollButtonsCallback;
export function setUpdateTabScrollButtonsCallback(cb) {
    updateTabScrollButtonsCallback = cb;
}

function formatUrlForDisplay(url) {
    if (!url || url.startsWith('about:') || url.startsWith('file:')) {
        return url;
    }
    try {
        const urlObj = new URL(url);
        let result = urlObj.hostname.replace(/^www\./, '');
        // Append path, search, and hash, but only if they are not the root path "/" alone
        if (urlObj.pathname !== '/' || urlObj.search || urlObj.hash) {
            result += urlObj.pathname + urlObj.search + urlObj.hash;
        }
        return result;
    } catch (e) {
        // Fallback for search terms or things that aren't full URLs
        return url.replace(/^https?:\/\/(www\.)?/, '');
    }
}

function createTabElement(id) {
    const tabData = state.tabs.get(id);
    if (!tabData) return null;

    const tabEl = document.createElement('div');
    tabEl.dataset.id = id;
    tabEl.dataset.type = 'tab';
    tabEl.draggable = true;
    tabEl.className = 'tab-item';

    const iconEl = document.createElement('div');
    iconEl.className = 'tab-icon';

    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';

    const closeBtnEl = document.createElement('button');
    closeBtnEl.className = 'tab-close-btn';
    closeBtnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnEl.title = 'Close Tab';
    
    tabEl.append(iconEl, titleEl, closeBtnEl);
    updateTabElement(tabEl, tabData);
    return tabEl;
}

function updateTabElement(tabEl, tabData) {
    tabEl.title = `${tabData.title}\n${tabData.url}`;
    tabEl.classList.toggle('active', tabData.id === state.activeTabId);
    tabEl.classList.toggle('loading', tabData.isLoading);
    tabEl.classList.toggle('hibernated', !!tabData.isHibernated);
    tabEl.style.setProperty('--tab-color', tabData.color);
    
    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl.textContent !== tabData.title) {
        titleEl.textContent = tabData.title;
    }

    const iconEl = tabEl.querySelector('.tab-icon');
    let newIconHTML = '';
    // A loading tab should always show the spinner.
    if (tabData.isLoading) {
        newIconHTML = '<i class="fa-solid fa-spinner"></i>';
    } else {
        // If not loading, show a persistent state icon (shared) or another transient one (hibernated).
        if (tabData.isShared) {
            newIconHTML = '<i class="fa-solid fa-users" title="This tab shares data with other shared tabs"></i>';
        } else if (tabData.isHibernated) {
            newIconHTML = '<i class="fa-solid fa-power-off"></i>';
        }
    }

    if (iconEl.innerHTML !== newIconHTML) {
        iconEl.innerHTML = newIconHTML;
    }


    const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(tabData.id));
    if (parentGroup) {
        tabEl.classList.add('in-group');
        tabEl.style.setProperty('--tab-group-color', parentGroup.color);
    } else {
        tabEl.classList.remove('in-group');
    }
}

export function render() {
    const fragment = document.createDocumentFragment();
    const existingElements = new Map();
    for (const child of DOM.tabsContainer.children) {
        const id = child.dataset.id || child.dataset.groupId;
        if (id) existingElements.set(id, child);
    }

    state.layout.forEach(id => {
        let element = existingElements.get(id);
        let itemData, type;

        if (state.groups.has(id)) {
            itemData = state.groups.get(id);
            type = 'group';
        } else if (state.tabs.has(id)) {
            if (isTabInAnyGroup(id)) return;
            itemData = state.tabs.get(id);
            type = 'tab';
        } else {
            return;
        }

        if (!element) {
            if (type === 'tab') {
                element = createTabElement(id);
            } else {
                element = renderGroup(id, 'main');
            }
        } else {
            if (type === 'tab') {
                updateTabElement(element, itemData);
            } else {
                const group = itemData;
                element.style.setProperty('--tab-group-color', group.color);
                element.classList.toggle('collapsed', group.collapsed);
                
                const titleEl = element.querySelector('.group-title');
                if (titleEl && titleEl.textContent !== group.name) titleEl.textContent = group.name;

                const toggleIcon = element.querySelector('.group-toggle-icon');
                if (toggleIcon) toggleIcon.className = `fa-solid ${group.collapsed ? 'fa-plus' : 'fa-minus'} group-toggle-icon`;
                
                const hasActiveChild = group.tabs.includes(state.activeTabId);
                element.classList.toggle('active-child', hasActiveChild);

                const indicator = element.querySelector('.active-in-group-indicator');
                if (group.collapsed && hasActiveChild) {
                    if (!indicator) {
                        const activeIndicatorIcon = document.createElement('i');
                        activeIndicatorIcon.className = 'fa-solid fa-circle active-in-group-indicator';
                        element.querySelector('.group-header').appendChild(activeIndicatorIcon);
                    }
                } else if (indicator) {
                    indicator.remove();
                }

                let tabsWrapper = element.querySelector('.tab-group-tabs');
                if (group.collapsed) {
                    if (tabsWrapper) tabsWrapper.remove();
                } else {
                    if (!tabsWrapper) {
                        tabsWrapper = document.createElement('div');
                        tabsWrapper.className = 'tab-group-tabs';
                        element.appendChild(tabsWrapper);
                    }
                    tabsWrapper.innerHTML = ''; 
                    group.tabs.forEach(tabId => {
                        const tabEl = renderTab(tabId, 'main');
                        if (tabEl) tabsWrapper.appendChild(tabEl);
                    });
                }
            }
        }
        
        if (element) {
            fragment.appendChild(element);
            existingElements.delete(id);
        }
    });

    DOM.tabsContainer.innerHTML = '';
    DOM.tabsContainer.appendChild(fragment);

    for (const [id, element] of existingElements.entries()) {
        element.remove();
    }
    
    if (updateTabScrollButtonsCallback) {
        updateTabScrollButtonsCallback();
    }
}

export function renderTab(id, context = 'main') {
    const tab = state.tabs.get(id);
    if (!tab) return null;

    const tabEl = document.createElement('div');
    tabEl.dataset.id = id;
    tabEl.dataset.type = 'tab';
    tabEl.draggable = true;
    
    const iconEl = document.createElement('div');
    iconEl.className = 'tab-icon';
    
    const titleEl = document.createElement('span');
    
    const closeBtnEl = document.createElement('button');
    closeBtnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnEl.title = 'Close Tab';

    if (context === 'main') {
       tabEl.className = 'tab-item';
       titleEl.className = 'tab-title';
       closeBtnEl.className = 'tab-close-btn';
       tabEl.append(iconEl, titleEl, closeBtnEl);
       updateTabElement(tabEl, tab);

    } else { // context === 'all-tabs'
        tabEl.className = 'all-tabs-list-item';
        tabEl.title = `${tab.title}\n${tab.url}`;
        if (id === state.activeTabId) tabEl.classList.add('active');
        if (tab.isLoading) tabEl.classList.add('loading');
        
        let iconHTML = '';
        if (tab.isLoading) {
            iconHTML = '<i class="fa-solid fa-spinner"></i>';
        } else {
            if (tab.isShared) {
                iconHTML = '<i class="fa-solid fa-users" title="This tab shares data with other shared tabs"></i>';
            } else if (tab.isHibernated) {
                tabEl.classList.add('hibernated');
                iconHTML = '<i class="fa-solid fa-power-off"></i>';
            }
        }
        iconEl.innerHTML = iconHTML;

        const urlEl = document.createElement('span');
        urlEl.className = 'all-tabs-url';
        urlEl.textContent = tab.url;
        
        titleEl.className = 'tab-title';
        titleEl.textContent = tab.title;
        closeBtnEl.className = 'tab-close-btn';

        const textWrapper = document.createElement('div');
        textWrapper.className = 'all-tabs-text-wrapper';
        textWrapper.append(urlEl, titleEl);
        
        tabEl.append(iconEl, textWrapper, closeBtnEl);
    }
    
    return tabEl;
}

export function renderGroup(id, context = 'main', visibleTabIds = null) {
    const group = state.groups.get(id);
    if (!group) return null;

    const groupContainer = document.createElement('div');
    groupContainer.style.setProperty('--tab-group-color', group.color);
    const headerEl = document.createElement('div');
    headerEl.dataset.id = id;
    const toggleIcon = document.createElement('i');
    const titleEl = document.createElement('span');
    titleEl.textContent = group.name;

    if (context === 'main') {
        groupContainer.className = 'tab-group';
        groupContainer.dataset.groupId = id;
        groupContainer.dataset.type = 'group';
        groupContainer.draggable = true;
        headerEl.className = 'group-header';
        titleEl.className = 'group-title';

        toggleIcon.className = `fa-solid ${group.collapsed ? 'fa-plus' : 'fa-minus'} group-toggle-icon`;

        if (group.collapsed) {
            groupContainer.classList.add('collapsed');
            if (group.tabs.includes(state.activeTabId)) {
                groupContainer.classList.add('active-child');
                const activeIndicatorIcon = document.createElement('i');
                activeIndicatorIcon.className = 'fa-solid fa-circle active-in-group-indicator';
                headerEl.appendChild(activeIndicatorIcon);
            }
        }
        headerEl.append(toggleIcon, titleEl);
        groupContainer.appendChild(headerEl);
        if (!group.collapsed) {
            const tabsWrapper = document.createElement('div');
            tabsWrapper.className = 'tab-group-tabs';
            group.tabs.forEach(tabId => {
                const tabEl = renderTab(tabId, context);
                if(tabEl) tabsWrapper.appendChild(tabEl);
            });
            groupContainer.appendChild(tabsWrapper);
        }
    } else { // context === 'all-tabs'
        groupContainer.className = 'all-tabs-group-container';
        groupContainer.dataset.groupId = id;
        if (group.collapsed) groupContainer.classList.add('collapsed');

        headerEl.className = 'all-tabs-group-header';
        headerEl.dataset.groupId = id;
        headerEl.dataset.type = 'group';
        headerEl.draggable = true;
        
        toggleIcon.className = `fa-solid ${group.collapsed ? 'fa-plus' : 'fa-minus'} group-toggle-icon`;
        titleEl.className = 'group-title';
        titleEl.textContent = group.name;

        if (group.tabs.includes(state.activeTabId)) headerEl.classList.add('active-child');
        const tabCountEl = document.createElement('span');
        tabCountEl.className = 'group-tab-count';
        tabCountEl.textContent = `${group.tabs.length} tabs`;
        
        headerEl.append(toggleIcon, titleEl, tabCountEl);
        groupContainer.appendChild(headerEl);
        
        const tabsWrapperWrapper = document.createElement('div');
        tabsWrapperWrapper.className = 'all-tabs-group-tabs-wrapper';
        const tabsWrapper = document.createElement('div');
        tabsWrapper.className = 'all-tabs-group-tabs';
        
        const visibleChildTabs = group.tabs.filter(tabId => visibleTabIds && visibleTabIds.has(tabId));
        if (visibleChildTabs.length > 0) {
            visibleChildTabs.forEach(tabId => {
                const tabEl = renderTab(tabId, 'all-tabs');
                if (tabEl) tabsWrapper.appendChild(tabEl);
            });
        }
        
        tabsWrapperWrapper.appendChild(tabsWrapper);
        groupContainer.appendChild(tabsWrapperWrapper);
    }
    return groupContainer;
}

export function updateNavControls(tab) {
    if (!tab) return;
    const isFocused = document.activeElement === DOM.addressBar;
    const urlToDisplay = (tab.isLoaded && tab.url !== 'about:blank' && !tab.isHibernated) ? tab.url : '';
    
    DOM.addressBar.value = isFocused ? urlToDisplay : formatUrlForDisplay(urlToDisplay);
    DOM.backBtn.disabled = !tab.canGoBack;
    DOM.forwardBtn.disabled = !tab.canGoForward;
    DOM.reloadIcon.classList.toggle('fa-xmark', tab.isLoading);
    DOM.reloadIcon.classList.toggle('fa-rotate-right', !tab.isLoading);
    DOM.reloadBtn.setAttribute('aria-label', tab.isLoading ? 'Stop' : 'Reload');
}
