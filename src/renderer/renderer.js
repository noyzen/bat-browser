// --- DOM Elements ---
const tabsContainer = document.getElementById('tabs-container');
const tabsContainerWrapper = document.getElementById('tabs-container-wrapper');
const tabScrollLeftBtn = document.getElementById('tab-scroll-left');
const tabScrollRightBtn = document.getElementById('tab-scroll-right');
const addTabBtn = document.getElementById('add-tab-btn');
const allTabsBtn = document.getElementById('all-tabs-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const reloadIcon = document.getElementById('reload-icon');
const addressBar = document.getElementById('address-bar');
const minBtn = document.getElementById('min-btn');
const maxBtn = document.getElementById('max-btn');
const maxIcon = document.getElementById('max-icon');
const closeBtn = document.getElementById('close-btn');
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findMatches = document.getElementById('find-matches');
const findPrevBtn = document.getElementById('find-prev-btn');
const findNextBtn = document.getElementById('find-next-btn');
const findCloseBtn = document.getElementById('find-close-btn');
const searchOverlay = document.getElementById('tab-search-overlay');
const searchInput = document.getElementById('tab-search-input');
const searchResults = document.getElementById('tab-search-results');
const titlebar = document.getElementById('titlebar');
const toolbar = document.getElementById('toolbar');
const toolbarWrapper = document.getElementById('toolbar-wrapper');

// All Tabs View Elements
const allTabsView = document.getElementById('all-tabs-view');
const allTabsListContainer = document.getElementById('all-tabs-list-container');
const allTabsSearchInput = document.getElementById('all-tabs-search-input');
const backToBrowserBtn = document.getElementById('back-to-browser-btn');
const allTabsMinBtn = document.getElementById('all-tabs-min-btn');
const allTabsMaxBtn = document.getElementById('all-tabs-max-btn');
const allTabsMaxIcon = document.getElementById('all-tabs-max-icon');
const allTabsCloseBtn = document.getElementById('all-tabs-close-btn');


// --- State ---
let tabs = new Map();
let groups = new Map();
let layout = []; // An ordered array of tab IDs and group IDs
let activeTabId = null;

const isTabInAnyGroup = (tabId) => {
    for (const group of groups.values()) {
        if (group.tabs.includes(tabId)) {
            return true;
        }
    }
    return false;
};

const PREDEFINED_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
    '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784'
];

function getRandomColor() {
  return PREDEFINED_COLORS[Math.floor(Math.random() * PREDEFINED_COLORS.length)];
}

// --- NEW High-Performance Rendering System ---

/**
 * Creates and returns a DOM element for a tab.
 * @param {string} id - The ID of the tab.
 * @returns {HTMLElement} The created tab element.
 */
function createTabElement(id) {
    const tabData = tabs.get(id);
    if (!tabData) return null;

    const tabEl = document.createElement('div');
    tabEl.dataset.id = id;
    tabEl.dataset.type = 'tab';
    tabEl.draggable = true;
    tabEl.className = 'tab-item';

    const iconEl = document.createElement('div');
    iconEl.className = 'tab-icon';
    iconEl.innerHTML = '<i class="fa-solid fa-spinner"></i>';

    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';

    const closeBtnEl = document.createElement('button');
    closeBtnEl.className = 'tab-close-btn';
    closeBtnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnEl.title = 'Close Tab';
    closeBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCloseTab(id);
    });
    
    tabEl.addEventListener('click', () => {
        if (id !== activeTabId) {
            window.electronAPI.switchTab(id);
        }
    });

    tabEl.append(iconEl, titleEl, closeBtnEl);
    updateTabElement(tabEl, tabData); // Apply initial data
    return tabEl;
}

/**
 * Updates an existing tab's DOM element with new data.
 * @param {HTMLElement} tabEl - The tab element to update.
 * @param {object} tabData - The tab's data object.
 */
function updateTabElement(tabEl, tabData) {
    tabEl.title = `${tabData.title}\n${tabData.url}`;
    tabEl.classList.toggle('active', tabData.id === activeTabId);
    tabEl.classList.toggle('loading', tabData.isLoading);
    tabEl.classList.toggle('hibernated', !!tabData.isHibernated);
    tabEl.style.setProperty('--tab-color', tabData.color);
    
    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl.textContent !== tabData.title) {
        titleEl.textContent = tabData.title;
    }

    const iconEl = tabEl.querySelector('.tab-icon');
    if (tabData.isHibernated) {
      iconEl.innerHTML = '<i class="fa-solid fa-power-off"></i>';
    } else {
      iconEl.innerHTML = '<i class="fa-solid fa-spinner"></i>';
    }

    const parentGroup = Array.from(groups.values()).find(g => g.tabs.includes(tabData.id));
    if (parentGroup) {
        tabEl.classList.add('in-group');
        tabEl.style.setProperty('--tab-group-color', parentGroup.color);
    } else {
        tabEl.classList.remove('in-group');
    }
}


/**
 * Reconciles the DOM with the current state, creating, updating, and moving elements as needed.
 */
function render() {
    const fragment = document.createDocumentFragment();
    const existingElements = new Map();
    // Cache existing elements for quick lookup
    for (const child of tabsContainer.children) {
        const id = child.dataset.id || child.dataset.groupId;
        if (id) existingElements.set(id, child);
    }

    const elementOrder = [];

    // First pass: create/update and arrange elements
    layout.forEach(id => {
        let element = existingElements.get(id);
        let itemData, type;

        if (groups.has(id)) {
            itemData = groups.get(id);
            type = 'group';
        } else if (tabs.has(id)) {
            // Don't render tabs in groups at the top level. This prevents duplicate rendering.
            if (isTabInAnyGroup(id)) return;
            itemData = tabs.get(id);
            type = 'tab';
        } else {
            return; // Item not found in state, will be removed later
        }

        if (!element) {
            // Element doesn't exist, create it
            if (type === 'tab') {
                element = createTabElement(id);
            } else { // type === 'group'
                element = renderGroup(id, 'main');
            }
        } else {
            // Element exists, update it
            if (type === 'tab') {
                updateTabElement(element, itemData);
            } else { // type === 'group'
                const group = itemData;

                // Always update the core properties of the group element itself.
                element.style.setProperty('--tab-group-color', group.color);
                element.classList.toggle('collapsed', group.collapsed);
                
                const titleEl = element.querySelector('.group-title');
                if (titleEl && titleEl.textContent !== group.name) {
                    titleEl.textContent = group.name;
                }

                const toggleIcon = element.querySelector('.group-toggle-icon');
                if (toggleIcon) {
                    toggleIcon.className = `fa-solid ${group.collapsed ? 'fa-chevron-right' : 'fa-chevron-down'} group-toggle-icon`;
                }
                
                // Handle active child indicator for collapsed groups
                const hasActiveChild = group.tabs.includes(activeTabId);
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

                // Now, reconcile the child tabs DOM based on the collapsed state.
                let tabsWrapper = element.querySelector('.tab-group-tabs');
                if (group.collapsed) {
                    // If the group is collapsed, there should be no tab container.
                    if (tabsWrapper) {
                        tabsWrapper.remove();
                    }
                } else {
                    // If the group is expanded, ensure the tab container exists and has the correct tabs.
                    if (!tabsWrapper) {
                        tabsWrapper = document.createElement('div');
                        tabsWrapper.className = 'tab-group-tabs';
                        element.appendChild(tabsWrapper);
                    }
                    
                    // For simplicity and correctness, we'll re-render the children instead of diffing.
                    tabsWrapper.innerHTML = ''; 
                    group.tabs.forEach(tabId => {
                        const tabEl = renderTab(tabId, 'main');
                        if (tabEl) {
                            tabsWrapper.appendChild(tabEl);
                        }
                    });
                }
            }
        }
        
        if (element) {
            fragment.appendChild(element);
            elementOrder.push(element);
            existingElements.delete(id);
        }
    });

    // Replace container content with the ordered fragment
    tabsContainer.innerHTML = '';
    tabsContainer.appendChild(fragment);

    // Second pass: remove any elements that are no longer in the layout
    for (const [id, element] of existingElements.entries()) {
        element.remove();
    }
    
    updateTabScrollButtons();
}


function renderTab(id, context = 'main') {
    const tab = tabs.get(id);
    if (!tab) return null;

    const tabEl = document.createElement('div');
    tabEl.dataset.id = id;
    tabEl.dataset.type = 'tab';
    tabEl.draggable = true;
    
    const iconEl = document.createElement('div');
    iconEl.className = 'tab-icon';
    iconEl.innerHTML = '<i class="fa-solid fa-spinner"></i>';
    
    const titleEl = document.createElement('span');
    
    const closeBtnEl = document.createElement('button');
    closeBtnEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtnEl.title = 'Close Tab';
    closeBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        handleCloseTab(id);
    });

    if (context === 'main') {
       // This path is now handled by createTabElement and updateTabElement,
       // but we keep this for `renderGroup`'s internal use.
       tabEl.className = 'tab-item';
       titleEl.className = 'tab-title';
       closeBtnEl.className = 'tab-close-btn';
       tabEl.append(iconEl, titleEl, closeBtnEl);
       updateTabElement(tabEl, tab);

    } else { // context === 'all-tabs'
        tabEl.className = 'all-tabs-list-item';
        tabEl.title = `${tab.title}\n${tab.url}`;
        if (id === activeTabId) tabEl.classList.add('active');
        if (tab.isLoading) tabEl.classList.add('loading');
        if (tab.isHibernated) {
          tabEl.classList.add('hibernated');
          iconEl.innerHTML = '<i class="fa-solid fa-power-off"></i>';
        }

        const urlEl = document.createElement('span');
        urlEl.className = 'all-tabs-url';
        urlEl.textContent = tab.url;
        
        titleEl.className = 'tab-title';
        titleEl.textContent = tab.title;
        closeBtnEl.className = 'tab-close-btn';

        const textWrapper = document.createElement('div');
        textWrapper.className = 'all-tabs-text-wrapper';
        textWrapper.append(titleEl, urlEl);
        
        tabEl.append(iconEl, textWrapper, closeBtnEl);
    }
    
    tabEl.addEventListener('click', async () => {
      if (context === 'all-tabs') {
        if (id !== activeTabId) {
          await window.electronAPI.switchTab(id);
        }
        hideAllTabsView();
      } else if (id !== activeTabId) {
        window.electronAPI.switchTab(id);
      }
    });
    return tabEl;
}

function renderGroup(id, context = 'main', visibleTabIds = null) {
    const group = groups.get(id);
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

        headerEl.addEventListener('click', () => {
            group.collapsed = !group.collapsed;
            persistState();
            render();
            if (!allTabsView.classList.contains('hidden')) {
                renderAllTabsView();
            }
        });

        toggleIcon.className = `fa-solid ${group.collapsed ? 'fa-chevron-right' : 'fa-chevron-down'} group-toggle-icon`;

        if (group.collapsed) {
            groupContainer.classList.add('collapsed');
            if (group.tabs.includes(activeTabId)) {
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
        if (group.collapsed) {
            groupContainer.classList.add('collapsed');
        }

        headerEl.className = 'all-tabs-group-header';
        headerEl.dataset.groupId = id;
        headerEl.dataset.type = 'group';
        headerEl.draggable = true;
        
        headerEl.addEventListener('click', () => {
            group.collapsed = !group.collapsed;
            persistState();
            renderAllTabsView();
            render(); // Also update main tab bar
        });

        toggleIcon.className = 'fa-solid fa-chevron-down group-toggle-icon';
        titleEl.className = 'group-title';
        titleEl.textContent = group.name;

        if (group.tabs.includes(activeTabId)) {
            headerEl.classList.add('active-child');
        }
        const tabCountEl = document.createElement('span');
        tabCountEl.className = 'group-tab-count';
        tabCountEl.textContent = `${group.tabs.length} tabs`;
        
        headerEl.append(toggleIcon, titleEl, tabCountEl);
        groupContainer.appendChild(headerEl);
        
        const tabsWrapperWrapper = document.createElement('div');
        tabsWrapperWrapper.className = 'all-tabs-group-tabs-wrapper'; // The new grid container

        const tabsWrapper = document.createElement('div');
        tabsWrapper.className = 'all-tabs-group-tabs'; // The inner content with padding/gap
        
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

function updateNavControls(tab) {
  if (!tab) return;
  addressBar.value = (tab.isLoaded && tab.url !== 'about:blank' && !tab.isHibernated) ? tab.url : '';
  backBtn.disabled = !tab.canGoBack;
  forwardBtn.disabled = !tab.canGoForward;
  reloadIcon.classList.toggle('fa-xmark', tab.isLoading);
  reloadIcon.classList.toggle('fa-rotate-right', !tab.isLoading);
  reloadBtn.setAttribute('aria-label', tab.isLoading ? 'Stop' : 'Reload');
}

// --- State Management & Persistence ---
function persistState() {
  window.electronAPI.updateLayout(layout, Array.from(groups.values()));
}

function handleCloseTab(id) {
    window.electronAPI.closeTab(id); // Inform main process to destroy the view
    
    // Optimistically update local state for instant UI response
    const wasActive = activeTabId === id;
    
    tabs.delete(id);
    layout = layout.filter(itemId => itemId !== id);
    groups.forEach(group => {
        group.tabs = group.tabs.filter(tabId => tabId !== id);
        if(group.tabs.length === 0) {
            groups.delete(group.id);
            layout = layout.filter(itemId => itemId !== group.id);
        }
    });

    if (wasActive) {
        const findNextTab = () => {
            for (const itemId of layout) {
                if (tabs.has(itemId) && !isTabInAnyGroup(itemId)) return itemId;
                if (groups.has(itemId)) {
                    const group = groups.get(itemId);
                    if (!group.collapsed && group.tabs.length > 0) return group.tabs[0];
                }
            }
            return null;
        }
        
        let nextTabId = findNextTab();
        if (nextTabId) {
            window.electronAPI.switchTab(nextTabId); // Main will broadcast 'tab:switched'
        } else if (tabs.size === 0) {
             window.electronAPI.newTab();
        }
    }
    
    persistState();
    render();
    if (!allTabsView.classList.contains('hidden')) {
      renderAllTabsView();
    }
}

// --- Confirmation Dialog ---
async function showConfirmationDialog(title, message) {
  try {
    await window.electronAPI.hideActiveView();
    return await new Promise(resolve => {
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
      dialog.append(titleEl, messageEl, buttonsWrapper);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));

      function cleanup(result) {
        window.removeEventListener('keydown', onKeyDown, true);
        overlay.classList.remove('visible');
        overlay.addEventListener('transitionend', () => {
          overlay.remove();
          resolve(result);
        }, { once: true });
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onKeyDown(e) { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }
      okBtn.addEventListener('click', onOk, { once: true });
      cancelBtn.addEventListener('click', onCancel, { once: true });
      window.addEventListener('keydown', onKeyDown, true);
      okBtn.focus();
    });
  } finally {
    await window.electronAPI.showActiveView();
  }
}

// --- Prompt Dialog ---
async function showPromptDialog(title, message, defaultValue = '') {
  try {
    await window.electronAPI.hideActiveView();
    return await new Promise(resolve => {
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
      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'modal-input';
      inputEl.value = defaultValue;
      const buttonsWrapper = document.createElement('div');
      buttonsWrapper.className = 'modal-buttons';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'cancel-btn';
      cancelBtn.textContent = 'Cancel';
      const okBtn = document.createElement('button');
      okBtn.className = 'ok-btn';
      okBtn.textContent = 'OK';
      buttonsWrapper.append(cancelBtn, okBtn);
      dialog.append(titleEl, messageEl, inputEl, buttonsWrapper);
      overlay.appendChild(dialog);
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
      function onOk() { cleanup(inputEl.value); }
      function onCancel() { cleanup(null); }
      function onKeyDown(e) {
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }
      okBtn.addEventListener('click', onOk, { once: true });
      cancelBtn.addEventListener('click', onCancel, { once: true });
      window.addEventListener('keydown', onKeyDown, true);
      inputEl.focus();
      inputEl.select();
    });
  } finally {
    await window.electronAPI.showActiveView();
  }
}

// --- Main Process Listeners ---
window.electronAPI.onSessionRestoreUI(session => {
    session.tabs.forEach(t => {
        tabs.set(t.id, { ...t, isLoading: true, isLoaded: false, zoomFactor: 1.0 });
    });
    session.groups.forEach(g => groups.set(g.id, g));
    layout = session.layout;
    activeTabId = session.activeTabId;
    render();
    if (activeTabId) {
        updateNavControls(tabs.get(activeTabId));
        setTimeout(() => scrollToTab(activeTabId), 50);
    }
});

window.electronAPI.onTabCreated(tabData => {
  tabs.set(tabData.id, { ...tabData, zoomFactor: 1.0 });
  if (!layout.find(id => tabs.has(id) && id === tabData.id)) {
    layout.push(tabData.id);
  }
  activeTabId = tabData.id;
  persistState();
  render();
  updateNavControls(tabData);
  setTimeout(() => scrollToTab(tabData.id), 50);
});

window.electronAPI.onTabSwitched(id => {
  activeTabId = id;
  render();
  updateNavControls(tabs.get(id));
  scrollToTab(id);
});

window.electronAPI.onTabUpdated(update => {
  const tab = tabs.get(update.id);
  if (tab) {
    Object.assign(tab, update);
    const tabEl = tabsContainer.querySelector(`.tab-item[data-id="${update.id}"]`);
    if (tabEl) updateTabElement(tabEl, tab);

    if (update.id === activeTabId) {
      updateNavControls(tab);
    }
    if (!allTabsView.classList.contains('hidden')) {
        renderAllTabsView();
    }
  }
});

window.electronAPI.onTabClosed(id => {
    // This is a reconciliation step. The UI might have been updated optimistically.
    const tabExists = tabs.has(id);
    if (tabExists) {
        const wasActive = id === activeTabId;
        const parentGroup = Array.from(groups.values()).find(g => g.tabs.includes(id));

        tabs.delete(id);
        if (parentGroup) {
            parentGroup.tabs = parentGroup.tabs.filter(tabId => tabId !== id);
            if (parentGroup.tabs.length === 0) {
                groups.delete(parentGroup.id);
                layout = layout.filter(itemId => itemId !== parentGroup.id);
            }
        } else {
            layout = layout.filter(itemId => itemId !== id);
        }
        
        if (!wasActive) {
          render();
          if (!allTabsView.classList.contains('hidden')) {
            renderAllTabsView();
          }
        }
    }
});

window.electronAPI.onWindowBlurred(() => {
  if (document.activeElement === addressBar) {
    addressBar.blur();
  }
});

// --- Event Listeners ---
addTabBtn.addEventListener('click', () => window.electronAPI.newTab());

addressBar.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    let url = addressBar.value.trim();
    if (!url) return;

    if (e.ctrlKey) {
        // Ctrl+Enter for www.<input>.com
        url = `https://www.${url}.com`;
    } else {
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
            if (url.includes('.') && !url.includes(' ')) {
                // It looks like a domain, e.g., "example.com"
                url = 'http://' + url;
            } else {
                // It's a search term, e.g., "google" or "what is electron"
                url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
            }
        }
    }
    
    window.electronAPI.loadURL(url);
    addressBar.blur();
  }
});

backBtn.addEventListener('click', () => window.electronAPI.goBack());
forwardBtn.addEventListener('click', () => window.electronAPI.goForward());
reloadBtn.addEventListener('click', () => window.electronAPI.reload());

// --- Window Controls ---
async function refreshMaxButton() {
  const maximized = await window.electronAPI.isWindowMaximized();
  document.body.classList.toggle('maximized', maximized);
  const iconClass = maximized ? 'fa-regular fa-window-restore' : 'fa-regular fa-window-maximize';
  const title = maximized ? 'Restore' : 'Maximize';
  maxIcon.className = iconClass;
  maxBtn.title = title;
  allTabsMaxIcon.className = iconClass;
  allTabsMaxBtn.title = title;
}
minBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
maxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
allTabsMinBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
allTabsMaxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
allTabsCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());
window.electronAPI.onMaximizeChanged(refreshMaxButton);
document.addEventListener('DOMContentLoaded', refreshMaxButton);


// --- Drag and Drop (NEW - Animated & Accurate) ---
let draggedElement = null;
let placeholder = null;
let autoExpandTimer = null;
let lastHoveredGroupIdForExpand = null;

/**
 * Clears any active auto-expand timer and removes its visual indicator.
 */
function clearAutoExpand() {
    clearTimeout(autoExpandTimer);
    autoExpandTimer = null;
    if (lastHoveredGroupIdForExpand) {
        const oldGroupEl = document.querySelector(`.tab-group[data-group-id="${lastHoveredGroupIdForExpand}"], .all-tabs-group-header[data-group-id="${lastHoveredGroupIdForExpand}"]`);
        oldGroupEl?.querySelector('.auto-expand-indicator')?.remove();
        lastHoveredGroupIdForExpand = null;
    }
}

// Helper to find the element to insert before
function getDragAfterElement(container, x, y) {
    // We only want to compare against direct children of the container.
    const draggableElements = [...container.children].filter(child => {
        // Exclude the placeholder and the element being dragged.
        return !child.classList.contains('placeholder') && !child.classList.contains('dragging');
    });

    // Determine orientation based on the container (vertical for 'all-tabs', horizontal for main bar)
    const isHorizontal = container.id === 'tabs-container' || container.classList.contains('tab-group-tabs');

    // Find the first child element that the cursor is positioned before its center
    for (const child of draggableElements) {
        const box = child.getBoundingClientRect();
        const cursorPosition = isHorizontal ? x : y;
        
        // Use the bounding box of the child itself, which represents its position in the layout.
        const elementMidpoint = isHorizontal ? box.left + box.width / 2 : box.top + box.height / 2;
        
        if (cursorPosition < elementMidpoint) {
            return child;
        }
    }

    // If the cursor is past the midpoint of all elements, we should append to the end.
    return null;
}

function handleDragStart(e) {
    draggedElement = e.target.closest('[draggable="true"]');
    if (!draggedElement) return;

    e.dataTransfer.effectAllowed = 'move';
    // Use a transparent image to hide the browser's default drag preview
    const empty = new Image();
    e.dataTransfer.setData('text/plain', ''); // Necessary for Firefox
    e.dataTransfer.setDragImage(empty, 0, 0);

    // Create placeholder; its appearance is now fully controlled by CSS.
    placeholder = document.createElement('div');
    placeholder.className = 'placeholder';

    setTimeout(() => {
        if (draggedElement) {
            // The dragged element itself is a group header, but the whole container is what we want to style
            const container = draggedElement.closest('.all-tabs-group-container') || draggedElement;
            container.classList.add('dragging');
        }
    }, 0);
}

function handleDragEnd() {
    clearAutoExpand();

    if (draggedElement) {
        const container = draggedElement.closest('.all-tabs-group-container') || draggedElement;
        container.classList.remove('dragging');
    }
    if (placeholder?.parentNode) {
        placeholder.remove();
    }
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedElement = null;
    placeholder = null;
}

function handleDragOver(e) {
    e.preventDefault();
    if (!draggedElement || !placeholder) return;

    e.dataTransfer.dropEffect = 'move';
    const draggedId = draggedElement.dataset.id || draggedElement.dataset.groupId;
    const draggedType = draggedElement.dataset.type;

    // --- Auto-expand group logic with progress indicator ---
    const targetGroupEl = e.target.closest('.all-tabs-group-header, .tab-group.collapsed');
    const targetGroupId = targetGroupEl?.dataset.groupId;

    // We only auto-expand when dragging a tab.
    if (draggedType === 'tab' && targetGroupEl) {
        const group = groups.get(targetGroupId);
        // If we hover a new, collapsed group, start the timer.
        if (group?.collapsed && targetGroupId !== lastHoveredGroupIdForExpand) {
            clearAutoExpand(); // Clear any previous timer/indicator.
            lastHoveredGroupIdForExpand = targetGroupId;
            
            // Create and append the progress bar indicator.
            const indicator = document.createElement('div');
            indicator.className = 'auto-expand-indicator';
            targetGroupEl.appendChild(indicator);
            // Start the CSS animation.
            indicator.style.animation = 'fill-progress 700ms linear forwards';

            autoExpandTimer = setTimeout(() => {
                // When timer finishes, check if we are still hovering the same group.
                if (draggedElement && lastHoveredGroupIdForExpand === targetGroupId) {
                    group.collapsed = false;
                    persistState();
                    render(); // Always update main tab bar
                    if (!allTabsView.classList.contains('hidden')) {
                        renderAllTabsView(); // Rerender to show expanded view if visible
                    }
                }
            }, 700);
        }
    } else if (!targetGroupEl && lastHoveredGroupIdForExpand) {
        // If we are no longer hovering ANY group header, cancel the process.
        clearAutoExpand();
    }

    // --- Placeholder positioning and group highlighting ---
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    // Priority 1: Check for a valid reordering container.
    const reorderContainer = e.target.closest('.all-tabs-group-tabs, #all-tabs-list-container, .tab-group-tabs, #tabs-container');
    if (reorderContainer) {
        // Prevent dropping a group inside another group's tab list.
        if (draggedType === 'group' && reorderContainer.matches('.all-tabs-group-tabs, .tab-group-tabs')) {
            if (placeholder.parentNode) placeholder.remove();
            return;
        }
        // Place the placeholder for reordering.
        const afterElement = getDragAfterElement(reorderContainer, e.clientX, e.clientY);
        if (afterElement) {
            reorderContainer.insertBefore(placeholder, afterElement);
        } else {
            reorderContainer.appendChild(placeholder);
        }
        return; // We've handled this, exit.
    }
    
    // Priority 2: If not in a reorder container, check if we are dropping a tab ONTO a group header/container.
    const dropIntoGroupEl = e.target.closest('.tab-group, .all-tabs-group-header, .all-tabs-group-container');
    if (draggedType === 'tab' && dropIntoGroupEl) {
        const dropIntoGroupId = dropIntoGroupEl.dataset.groupId || dropIntoGroupEl.dataset.id;
        const parentGroup = Array.from(groups.values()).find(g => g.tabs.includes(draggedId));
        // Highlight if it's a valid, different group to drop into.
        if (dropIntoGroupId && dropIntoGroupId !== parentGroup?.id) {
            dropIntoGroupEl.classList.add('drag-over');
            if (placeholder.parentNode) placeholder.remove(); // Hide placeholder when dropping into a group
            return;
        }
    }

    // Fallback: Invalid drop location, so remove the placeholder.
    if (placeholder.parentNode) placeholder.remove();
}


function handleDrop(e) {
    e.preventDefault();
    if (!draggedElement) return;

    clearAutoExpand();

    const isAllTabsView = !allTabsView.classList.contains('hidden');
    const draggedId = draggedElement.dataset.id || draggedElement.dataset.groupId;
    
    const dropTargetGroupEl = document.querySelector('.drag-over');
    
    // --- Remove item from its original position in data model ---
    layout = layout.filter(id => id !== draggedId);
    let originalGroup = null;
    groups.forEach(group => {
        const tabIndex = group.tabs.indexOf(draggedId);
        if (tabIndex > -1) {
            originalGroup = group;
            group.tabs.splice(tabIndex, 1);
        }
    });

    // --- Find drop target and insert into new position ---
    
    // Case A: Dropped into a group (using the highlight)
    if (draggedElement.dataset.type === 'tab' && dropTargetGroupEl) {
        const targetGroupId = dropTargetGroupEl.dataset.groupId || dropTargetGroupEl.dataset.id;
        const targetGroup = groups.get(targetGroupId);
        if (targetGroup) {
            targetGroup.tabs.push(draggedId); // Add to the end
            targetGroup.collapsed = false; // Ensure it's open after drop
        }
    } 
    // Case B: Reordered (placeholder was used)
    else if (placeholder?.parentElement) {
        const parent = placeholder.parentElement;
        const nextEl = placeholder.nextElementSibling;
        const nextId = nextEl ? (nextEl.dataset.id || nextEl.dataset.groupId) : null;
        
        const parentGroupEl = parent.closest('.tab-group, .all-tabs-group-container');
        
        // Reordering inside a group
        if (parentGroupEl) {
             const parentGroupId = parentGroupEl.dataset.groupId || parentGroupEl.dataset.id;
             const parentGroup = groups.get(parentGroupId);
             if (parentGroup) {
                const nextIndex = nextId ? parentGroup.tabs.indexOf(nextId) : -1;
                if (nextIndex > -1) {
                    parentGroup.tabs.splice(nextIndex, 0, draggedId);
                } else {
                    parentGroup.tabs.push(draggedId);
                }
             }
        } 
        // Reordering in the main layout
        else {
            const nextIndex = nextId ? layout.indexOf(nextId) : -1;
            if(nextIndex > -1) {
                layout.splice(nextIndex, 0, draggedId);
            } else {
                layout.push(draggedId);
            }
        }
    } 
    // Fallback: If dropped somewhere invalid, put it back where it came from or at the end.
    else {
        if (originalGroup) {
            // This is a simplification, it adds it to the end of its original group.
            originalGroup.tabs.push(draggedId);
        } else {
            layout.push(draggedId);
        }
    }
    
    // Clean up any group that is now empty
    if (originalGroup && originalGroup.tabs.length === 0) {
        groups.delete(originalGroup.id);
        layout = layout.filter(id => id !== originalGroup.id);
    }

    // Persist and re-render from the updated data model
    persistState();
    if(isAllTabsView) {
      renderAllTabsView();
      render(); // Also update main bar in background
    } else {
      render();
    }
    
    // Clean up visuals immediately after drop
    handleDragEnd();
}

document.addEventListener('dragstart', handleDragStart);
document.addEventListener('dragend', handleDragEnd);
document.addEventListener('dragover', handleDragOver);
document.addEventListener('drop', handleDrop);


// --- Find In Page ---
function showFindBar() {
  findBar.classList.remove('hidden');
  findInput.focus();
  findInput.select();
}
function hideFindBar() {
  findBar.classList.add('hidden');
  window.electronAPI.findStop();
  findInput.value = '';
  findMatches.textContent = '';
}
findInput.addEventListener('input', () => {
  const query = findInput.value;
  if (query) window.electronAPI.findStart(query);
  else {
    window.electronAPI.findStop();
    findMatches.textContent = '';
  }
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') findNextBtn.click();
  if (e.key === 'Escape') hideFindBar();
});
findNextBtn.addEventListener('click', () => window.electronAPI.findNext(findInput.value, true));
findPrevBtn.addEventListener('click', () => window.electronAPI.findNext(findInput.value, false));
findCloseBtn.addEventListener('click', hideFindBar);
window.electronAPI.onFindResult(({ matches, activeMatchOrdinal }) => {
  findMatches.textContent = `${activeMatchOrdinal}/${matches}`;
});


// --- Tab Search (Quick Search) ---
let allTabsCache = [];
function showTabSearch() {
    window.electronAPI.getAllTabs().then(allTabs => {
        allTabsCache = allTabs;
        searchInput.value = '';
        renderSearchResults('');
        searchOverlay.classList.remove('hidden');
        searchInput.focus();
    });
}
function hideTabSearch() {
    searchOverlay.classList.add('hidden');
}
function renderSearchResults(query) {
    searchResults.innerHTML = '';
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
        searchResults.appendChild(li);
    });
}
searchInput.addEventListener('input', () => renderSearchResults(searchInput.value.toLowerCase()));
searchInput.addEventListener('keydown', (e) => {
    const selected = searchResults.querySelector('.selected');
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
searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) hideTabSearch();
});

// --- Native Context Menu ---
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const targetTab = e.target.closest('.tab-item, .all-tabs-list-item');
    const targetGroup = e.target.closest('.group-header, .tab-group, .all-tabs-group-header');

    let menuTemplate = [];
    
    if (targetTab) {
        const tabId = targetTab.dataset.id;
        const parentGroup = Array.from(groups.values()).find(g => g.tabs.includes(tabId));
        
        menuTemplate = [
            { label: 'New Tab', action: { command: 'new-tab' } },
            { label: 'Duplicate', action: { command: 'duplicate-tab', context: { tabId } } },
            { type: 'separator' },
            {
                label: 'Add to New Group',
                action: { command: 'add-to-new-group', context: { tabId } }
            },
            {
                label: 'Add to Group',
                visible: groups.size > 0 && (!parentGroup || groups.size > 1),
                submenu: Array.from(groups.values()).filter(g => g !== parentGroup).map(group => ({
                    label: group.name,
                    action: { command: 'add-to-existing-group', context: { tabId, groupId: group.id } }
                }))
            },
            { type: 'separator' },
            {
                label: 'Remove from Group',
                enabled: !!parentGroup,
                action: { command: 'remove-from-group', context: { tabId } }
            },
            { type: 'separator' },
            { label: 'Close Tab', action: { command: 'close-tab', context: { tabId } } }
        ];
    } else if (targetGroup) {
        const groupId = targetGroup.dataset.groupId || targetGroup.dataset.id;
        menuTemplate = [
            { label: 'Rename Group', action: { command: 'rename-group', context: { groupId } } },
            { label: 'Ungroup', action: { command: 'ungroup', context: { groupId } } },
            { label: 'Close all tabs in group', action: { command: 'close-group-tabs', context: { groupId } } }
        ];
    } else {
        return; 
    }
    
    if (menuTemplate.length > 0) {
        window.electronAPI.showContextMenu(menuTemplate);
    }
});

window.electronAPI.onContextMenuCommand(async (command, context) => {
    const isAllTabsViewActive = !allTabsView.classList.contains('hidden');
    const rerender = () => {
        render();
        if (isAllTabsViewActive) renderAllTabsView();
    };

    switch(command) {
        case 'new-tab':
            window.electronAPI.newTab();
            break;
        case 'duplicate-tab': {
            const { tabId } = context;
            const newTabData = await window.electronAPI.duplicateTab(tabId);
            if (!newTabData) break;
            tabs.set(newTabData.id, newTabData);

            const parentGroup = Array.from(groups.values()).find(g => g.tabs.includes(tabId));
            if (parentGroup) {
                const originalIndex = parentGroup.tabs.indexOf(tabId);
                parentGroup.tabs.splice(originalIndex + 1, 0, newTabData.id);
            } else {
                const originalIndex = layout.indexOf(tabId);
                layout.splice(originalIndex > -1 ? originalIndex + 1 : layout.length, 0, newTabData.id);
            }
            
            persistState();
            rerender(); 
            await window.electronAPI.switchTab(newTabData.id);
            break;
        }
        case 'close-tab':
            handleCloseTab(context.tabId);
            break;
        case 'add-to-new-group': {
            const { tabId } = context;
            const newGroupId = `group-${Date.now()}`;
            const newGroup = { id: newGroupId, name: "New Group", color: getRandomColor(), collapsed: false, tabs: [tabId] };
            let insertionIndex;
            const oldParentGroup = Array.from(groups.values()).find(g => g.tabs.includes(tabId));

            if (oldParentGroup) {
                oldParentGroup.tabs = oldParentGroup.tabs.filter(t => t !== tabId);
                insertionIndex = layout.indexOf(oldParentGroup.id) + 1;
                if (oldParentGroup.tabs.length === 0) {
                    groups.delete(oldParentGroup.id);
                    layout = layout.filter(id => id !== oldParentGroup.id);
                    insertionIndex--;
                }
            } else {
                insertionIndex = layout.indexOf(tabId);
                if (insertionIndex !== -1) layout.splice(insertionIndex, 1);
                else insertionIndex = layout.length;
            }
            groups.set(newGroupId, newGroup);
            layout.splice(insertionIndex, 0, newGroupId);
            persistState();
            rerender();
            break;
        }
        case 'add-to-existing-group': {
            const { tabId, groupId } = context;
            const oldParent = Array.from(groups.values()).find(g => g.tabs.includes(tabId));
            if(oldParent) oldParent.tabs = oldParent.tabs.filter(t => t !== tabId);
            else layout = layout.filter(id => id !== tabId);
            groups.get(groupId).tabs.push(tabId);
            persistState();
            rerender();
            break;
        }
        case 'remove-from-group': {
            const { tabId } = context;
            const parentGroup = Array.from(groups.values()).find(g => g.tabs.includes(tabId));
            if(!parentGroup) return;
            parentGroup.tabs = parentGroup.tabs.filter(t => t !== tabId);
            const groupIndex = layout.indexOf(parentGroup.id);
            if(groupIndex > -1) layout.splice(groupIndex + 1, 0, tabId);
            if (parentGroup.tabs.length === 0) {
              groups.delete(parentGroup.id);
              layout = layout.filter(id => id !== parentGroup.id);
            }
            persistState();
            rerender();
            break;
        }
        case 'rename-group': {
            const { groupId } = context;
            const group = groups.get(groupId);
            if (!group) return;
            const newName = await showPromptDialog('Rename Group', 'Enter new group name:', group.name);
            if (newName && newName.trim()) {
                group.name = newName.trim();
                persistState();
                rerender();
            }
            break;
        }
        case 'ungroup': {
            const { groupId } = context;
            const group = groups.get(groupId);
            if(!group) return;
            groups.delete(groupId);
            const groupIndex = layout.indexOf(groupId);
            if(groupIndex > -1) layout.splice(groupIndex, 1, ...group.tabs);
            persistState();
            rerender();
            break;
        }
        case 'close-group-tabs': {
            const { groupId } = context;
            const group = groups.get(groupId);
            if(!group) return;
            if (group.tabs.length > 1) {
                const confirmed = await showConfirmationDialog('Close Group?', `Are you sure you want to close all ${group.tabs.length} tabs in the "${group.name}" group?`);
                if (!confirmed) return;
            }
            [...group.tabs].forEach(tabId => handleCloseTab(tabId));
            break;
        }
    }
});


// --- Global Shortcuts ---
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    showFindBar();
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    showTabSearch();
  }

  const activeTab = tabs.get(activeTabId);
  if (!activeTab) return;
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    const newZoom = Math.min((activeTab.zoomFactor || 1.0) + 0.1, 3.0);
    window.electronAPI.setZoom(newZoom);
    activeTab.zoomFactor = newZoom;
  }
  if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    const newZoom = Math.max((activeTab.zoomFactor || 1.0) - 0.1, 0.25);
    window.electronAPI.setZoom(newZoom);
    activeTab.zoomFactor = newZoom;
  }
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    window.electronAPI.setZoom(1.0);
    activeTab.zoomFactor = 1.0;
  }
});


// --- NEW Tab Overflow & Scrolling System ---

// State variables for the physics-based scroll animation
let currentScrollLeft = 0;
let targetScrollLeft = 0;
let scrollAnimationId = null;
const DAMPING = 0.8; // Lower = more friction. Higher = less. (Value between 0 and 1)
const SCROLL_SPEED_MULTIPLIER = 1.0; // Adjust for sensitivity

function updateTabScrollButtons() {
    requestAnimationFrame(() => {
        const { scrollWidth, clientWidth } = tabsContainerWrapper;
        const isOverflowing = scrollWidth > clientWidth;

        // If not overflowing, hide the buttons completely. This prevents them from showing when not needed.
        if (!isOverflowing) {
            tabScrollLeftBtn.classList.add('hidden');
            tabScrollRightBtn.classList.add('hidden');
            return;
        }

        // If overflowing, ensure the buttons are visible, removing the 'hidden' class.
        tabScrollLeftBtn.classList.remove('hidden');
        tabScrollRightBtn.classList.remove('hidden');
        
        const maxScrollLeft = scrollWidth - clientWidth;
        const scrollLeft = tabsContainerWrapper.scrollLeft;

        // Then, disable or enable them based on the scroll position.
        // A small tolerance is used for floating point inaccuracies.
        tabScrollLeftBtn.disabled = scrollLeft <= 0;
        tabScrollRightBtn.disabled = scrollLeft >= maxScrollLeft - 1;
    });
}

function scrollToTab(tabId) {
    const tabElement = tabsContainer.querySelector(`[data-id="${tabId}"]`);
    if (tabElement) {
        const wrapperRect = tabsContainerWrapper.getBoundingClientRect();
        const tabRect = tabElement.getBoundingClientRect();
        
        // Calculate the desired scroll position to center the tab
        const desiredScrollLeft = tabsContainerWrapper.scrollLeft + (tabRect.left - wrapperRect.left) + (tabRect.width / 2) - (wrapperRect.width / 2);
        
        targetScrollLeft = Math.max(0, Math.min(tabsContainerWrapper.scrollWidth - wrapperRect.width, desiredScrollLeft));
        
        startScrollAnimation();
    }
}

function startScrollAnimation() {
    if (scrollAnimationId) return; // Animation is already running
    
    const animateScroll = () => {
        const distance = targetScrollLeft - currentScrollLeft;
        
        // If the distance is negligible, stop the animation
        if (Math.abs(distance) < 0.5) {
            currentScrollLeft = targetScrollLeft; // Snap to final position
            tabsContainerWrapper.scrollLeft = currentScrollLeft;
            updateTabScrollButtons();
            cancelAnimationFrame(scrollAnimationId);
            scrollAnimationId = null;
            return;
        }

        // Apply easing/damping
        currentScrollLeft += distance * (1 - DAMPING);
        tabsContainerWrapper.scrollLeft = Math.round(currentScrollLeft);
        updateTabScrollButtons();

        scrollAnimationId = requestAnimationFrame(animateScroll);
    };
    
    scrollAnimationId = requestAnimationFrame(animateScroll);
}

// Event Listeners
tabsContainerWrapper.addEventListener('wheel', (e) => {
    const isOverflowing = tabsContainerWrapper.scrollWidth > tabsContainerWrapper.clientWidth;
    if (!isOverflowing) return;

    e.preventDefault(); // Prevent vertical page scroll

    // Normalize scroll delta across different browsers and devices
    let delta = (e.deltaX !== 0) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) { // LINE mode
        delta *= 15; // Approximate line height
    } else if (e.deltaMode === 2) { // PAGE mode
        delta *= tabsContainerWrapper.clientWidth;
    }

    targetScrollLeft += delta * SCROLL_SPEED_MULTIPLIER;
    
    // Clamp the target scroll to bounds
    const maxScrollLeft = tabsContainerWrapper.scrollWidth - tabsContainerWrapper.clientWidth;
    targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));

    startScrollAnimation();
}, { passive: false });

tabScrollLeftBtn.addEventListener('click', () => {
    targetScrollLeft -= 250;
    const maxScrollLeft = tabsContainerWrapper.scrollWidth - tabsContainerWrapper.clientWidth;
    targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
    startScrollAnimation();
});
tabScrollRightBtn.addEventListener('click', () => {
    targetScrollLeft += 250;
    const maxScrollLeft = tabsContainerWrapper.scrollWidth - tabsContainerWrapper.clientWidth;
    targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
    startScrollAnimation();
});

// Add keyboard support
tabsContainerWrapper.setAttribute('tabindex', '-1'); // Make it focusable via JS/click
tabsContainerWrapper.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const direction = e.key === 'ArrowLeft' ? -1 : 1;
        targetScrollLeft += direction * 150; // Scroll amount for arrow keys
        const maxScrollLeft = tabsContainerWrapper.scrollWidth - tabsContainerWrapper.clientWidth;
        targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, targetScrollLeft));
        startScrollAnimation();
    }
});


// Sync state on direct user scroll (e.g., from a high-res touchpad)
tabsContainerWrapper.addEventListener('scroll', () => {
    // If no animation is running, it means user scrolled natively
    if (!scrollAnimationId) {
        currentScrollLeft = tabsContainerWrapper.scrollLeft;
        targetScrollLeft = tabsContainerWrapper.scrollLeft;
        updateTabScrollButtons();
    }
}, { passive: true });

// Use a single ResizeObserver for simplicity and performance
new ResizeObserver(() => {
    const maxScrollLeft = tabsContainerWrapper.scrollWidth - tabsContainerWrapper.clientWidth;
    // If the container shrinks, the current scroll might be out of bounds
    if (tabsContainerWrapper.scrollLeft > maxScrollLeft) {
        tabsContainerWrapper.scrollLeft = maxScrollLeft;
    }
    // Update our internal state to match reality after a resize
    currentScrollLeft = tabsContainerWrapper.scrollLeft;
    targetScrollLeft = tabsContainerWrapper.scrollLeft;
    updateTabScrollButtons();
}).observe(tabsContainerWrapper);

new ResizeObserver(updateTabScrollButtons).observe(tabsContainer);


// --- All Tabs View ---
function showAllTabsView() {
    window.electronAPI.hideActiveView();
    renderAllTabsView();
    allTabsView.classList.remove('hidden');
    allTabsSearchInput.focus();
    allTabsSearchInput.select();
}
function hideAllTabsView() {
    render(); // Sync main UI before switching back to it
    allTabsView.classList.add('hidden');
    window.electronAPI.showActiveView();
}

function renderAllTabsView() {
    allTabsListContainer.innerHTML = '';
    allTabsListContainer.className = 'all-tabs-list-view';
    const fragment = document.createDocumentFragment();
    const query = allTabsSearchInput.value.toLowerCase();

    const getVisibleTabs = () => {
      if (!query) return new Set(tabs.keys());
      return new Set(
        Array.from(tabs.values())
          .filter(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
          .map(t => t.id)
      );
    };
    const visibleTabIds = getVisibleTabs();
    
    let hasVisibleItems = false;
    layout.forEach(id => {
        if (groups.has(id)) {
            const group = groups.get(id);
            const groupHasVisibleTabs = group.tabs.some(tid => visibleTabIds.has(tid));
            if (groupHasVisibleTabs) {
                hasVisibleItems = true;
                const groupEl = renderGroup(id, 'all-tabs', visibleTabIds);
                fragment.appendChild(groupEl);
            }
        } else if (tabs.has(id) && !isTabInAnyGroup(id)) { // Render non-grouped tabs
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
    allTabsListContainer.appendChild(fragment);
}


allTabsBtn.addEventListener('click', showAllTabsView);
backToBrowserBtn.addEventListener('click', hideAllTabsView);
allTabsSearchInput.addEventListener('input', renderAllTabsView);
allTabsView.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideAllTabsView();
});

// --- Address Bar Expansion ---
addressBar.addEventListener('focus', () => {
  titlebar.classList.add('address-bar-expanded');
});
addressBar.addEventListener('blur', () => {
  titlebar.classList.remove('address-bar-expanded');
});
