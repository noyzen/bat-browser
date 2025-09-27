import * as DOM from './dom.js';
import { state, isTabInAnyGroup } from '../renderer.js';
import { handleCloseTab } from './features.js';

let updateTabScrollButtonsCallback;
export function setUpdateTabScrollButtonsCallback(cb) {
    updateTabScrollButtonsCallback = cb;
}

function formatUrlForDisplay(url) {
    if (!url || url.startsWith('about:') || url.startsWith('file:')) {
        return ''; // Return empty for internal pages
    }
    try {
        // For invalid URLs (like search terms), this will throw
        const urlObj = new URL(url);
        // If it's a valid URL, format it
        let result = urlObj.hostname.replace(/^www\./, '');
        if (urlObj.pathname !== '/' || urlObj.search || urlObj.hash) {
            result += urlObj.pathname + urlObj.search + urlObj.hash;
        }
        // Truncate very long URLs in the unfocused state
        if (result.length > 100) {
            result = result.substring(0, 97) + '...';
        }
        return result;
    } catch (e) {
        // If it's not a valid URL (e.g., a search query), just return it
        return url;
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

    const faviconEl = document.createElement('div');
    faviconEl.className = 'tab-favicon';

    const statusIconEl = document.createElement('div');
    statusIconEl.className = 'tab-status-icon';

    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';

    const closeBtnEl = document.createElement('button');
    closeBtnEl.className = 'tab-close-btn';
    closeBtnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnEl.title = 'Close Tab';
    
    tabEl.append(faviconEl, statusIconEl, titleEl, closeBtnEl);
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

    const faviconEl = tabEl.querySelector('.tab-favicon');
    if (tabData.url === 'about:blank') {
        faviconEl.style.backgroundImage = '';
        faviconEl.innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else if (tabData.favicon) {
        faviconEl.style.backgroundImage = `url('${tabData.favicon}')`;
        faviconEl.innerHTML = '';
    } else {
        faviconEl.style.backgroundImage = '';
        faviconEl.innerHTML = '<i class="fa-solid fa-globe"></i>';
    }


    const statusIconEl = tabEl.querySelector('.tab-status-icon');
    let newIconHTML = '';
    if (tabData.isLoading) {
        newIconHTML = '<i class="fa-solid fa-spinner"></i>';
    } else if (tabData.isShared) {
        newIconHTML = '<i class="fa-solid fa-users" title="This tab shares data with other shared tabs"></i>';
    } else if (tabData.isHibernated) {
        newIconHTML = '<i class="fa-solid fa-power-off"></i>';
    }

    if (statusIconEl.innerHTML !== newIconHTML) {
        statusIconEl.innerHTML = newIconHTML;
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
                const headerEl = element.querySelector('.group-header');
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
                        headerEl.appendChild(activeIndicatorIcon);
                    }
                } else if (indicator) {
                    indicator.remove();
                }

                let tabCountEl = element.querySelector('.group-tab-count-badge');
                if (group.collapsed) {
                    if (!tabCountEl) {
                        tabCountEl = document.createElement('span');
                        tabCountEl.className = 'group-tab-count-badge';
                        headerEl.appendChild(tabCountEl);
                    }
                    tabCountEl.textContent = group.tabs.length;
                } else if (tabCountEl) {
                    tabCountEl.remove();
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
    
    const faviconEl = document.createElement('div');
    faviconEl.className = 'tab-favicon';
    
    const titleEl = document.createElement('span');
    
    const closeBtnEl = document.createElement('button');
    closeBtnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnEl.title = 'Close Tab';

    if (context === 'main') {
       tabEl.className = 'tab-item';
       titleEl.className = 'tab-title';
       closeBtnEl.className = 'tab-close-btn';
       const statusIconEl = document.createElement('div');
       statusIconEl.className = 'tab-status-icon';
       tabEl.append(faviconEl, statusIconEl, titleEl, closeBtnEl);
       updateTabElement(tabEl, tab);

    } else { // context === 'all-tabs'
        tabEl.className = 'all-tabs-list-item';
        tabEl.title = `${tab.title}\n${tab.url}`;
        if (id === state.activeTabId) tabEl.classList.add('active');
        if (tab.isLoading) tabEl.classList.add('loading');
        
        const statusIconEl = document.createElement('div');
        statusIconEl.className = 'tab-status-icon';
        
        let statusIconHTML = '';
        if (tab.isLoading) {
            statusIconHTML = '<i class="fa-solid fa-spinner"></i>';
        } else if (tab.isShared) {
            statusIconHTML = '<i class="fa-solid fa-users" title="This tab shares data with other shared tabs"></i>';
        } else if (tab.isHibernated) {
            tabEl.classList.add('hibernated');
            statusIconHTML = '<i class="fa-solid fa-power-off"></i>';
        }
        statusIconEl.innerHTML = statusIconHTML;

        if (tab.url === 'about:blank') {
            faviconEl.innerHTML = '<i class="fa-solid fa-moon"></i>';
        } else if (tab.favicon) {
            faviconEl.style.backgroundImage = `url('${tab.favicon}')`;
        } else {
            faviconEl.innerHTML = '<i class="fa-solid fa-globe"></i>';
        }

        titleEl.className = 'tab-title';
        titleEl.textContent = tab.title;
        closeBtnEl.className = 'tab-close-btn';

        const textWrapper = document.createElement('div');
        textWrapper.className = 'all-tabs-text-wrapper';
        textWrapper.append(titleEl);
        
        tabEl.append(faviconEl, statusIconEl, textWrapper, closeBtnEl);
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

        headerEl.append(toggleIcon, titleEl);

        if (group.collapsed) {
            groupContainer.classList.add('collapsed');

            const tabCountEl = document.createElement('span');
            tabCountEl.className = 'group-tab-count-badge';
            tabCountEl.textContent = group.tabs.length;
            headerEl.appendChild(tabCountEl);

            if (group.tabs.includes(state.activeTabId)) {
                groupContainer.classList.add('active-child');
                const activeIndicatorIcon = document.createElement('i');
                activeIndicatorIcon.className = 'fa-solid fa-circle active-in-group-indicator';
                headerEl.appendChild(activeIndicatorIcon);
            }
        }

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

        const hasActiveChild = group.tabs.includes(state.activeTabId);
        if (hasActiveChild) {
            headerEl.classList.add('active-child');
        }
        
        const tabCountEl = document.createElement('span');
        tabCountEl.className = 'group-tab-count';
        tabCountEl.textContent = `${group.tabs.length} tabs`;
        
        headerEl.append(toggleIcon, titleEl);

        if (group.collapsed && hasActiveChild) {
            const activeIndicatorIcon = document.createElement('i');
            activeIndicatorIcon.className = 'fa-solid fa-circle active-in-group-indicator';
            headerEl.appendChild(activeIndicatorIcon);
        }

        headerEl.appendChild(tabCountEl);
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
    if (!tab) {
        // Clear the bar if there's no active tab
        DOM.addressBar.value = '';
        DOM.backBtn.disabled = true;
        DOM.forwardBtn.disabled = true;
        DOM.reloadIcon.className = 'fa-solid fa-rotate-right';
        DOM.reloadBtn.setAttribute('aria-label', 'Reload');
        return;
    }

    // The address bar should show the URL even if the tab is loading or hibernated.
    // `formatUrlForDisplay` will correctly handle 'about:blank' and other internal URLs.
    // When the address bar is focused, the full URL will be shown by the 'focus' event handler.
    DOM.addressBar.value = formatUrlForDisplay(tab.url);

    DOM.backBtn.disabled = !tab.canGoBack;
    DOM.forwardBtn.disabled = !tab.canGoForward;
    DOM.reloadIcon.classList.toggle('fa-xmark', tab.isLoading);
    DOM.reloadIcon.classList.toggle('fa-rotate-right', !tab.isLoading);
    DOM.reloadBtn.setAttribute('aria-label', tab.isLoading ? 'Stop' : 'Reload');
}