import * as DOM from './dom.js';
import * as Feat from './features.js';
import { showAllTabsView, hideAllTabsView } from './views.js';
import { showDownloadsView } from './downloads.js';

let getState, updateNavControls, fullRender, persistState;
let hotkeyToAction = new Map();
let wasAddressBarClicked = false;

export function updateHotkeyMappings(hotkeys) {
    hotkeyToAction.clear();
    if (hotkeys) {
        for (const [action, hotkey] of Object.entries(hotkeys)) {
            hotkeyToAction.set(hotkey, action);
        }
    }
}

async function refreshMaxButton() {
    const maximized = await window.electronAPI.isWindowMaximized();
    document.body.classList.toggle('maximized', maximized);
    const iconClass = maximized ? 'fa-regular fa-window-restore' : 'fa-regular fa-window-maximize';
    const title = maximized ? 'Restore' : 'Maximize';
    
    DOM.maxIcon.className = iconClass;
    DOM.maxBtn.title = title;
    DOM.allTabsMaxIcon.className = iconClass;
    DOM.allTabsMaxBtn.title = title;
    DOM.settingsMaxIcon.className = iconClass;
    DOM.settingsMaxBtn.title = title;
    DOM.downloadsMaxIcon.className = iconClass;
    DOM.downloadsMaxBtn.title = title;
}

function handleAddressBar(e) {
    if (e.key === 'Enter') {
        let query = DOM.addressBar.value.trim();
        if (!query) return;

        // Support Ctrl+Enter (Win/Linux) and Cmd+Enter (macOS)
        if (e.ctrlKey || e.metaKey) {
            // Avoid mangling URLs or multi-word searches.
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(query) && !query.includes(' ') && !query.includes('.')) {
                query = `www.${query}.com`;
            }
        }

        window.electronAPI.loadURL(query);
        DOM.addressBar.blur();
    }
}

function handleGlobalShortcuts(e) {
    // Always ignore key events when the hotkey recorder is active.
    if (e.target.classList && e.target.classList.contains('recording')) {
        return;
    }

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const combo = [
        e.ctrlKey ? 'Ctrl' : '',
        e.altKey ? 'Alt' : '',
        e.shiftKey ? 'Shift' : '',
        e.metaKey ? 'Meta' : '',
        // Don't add modifiers themselves as keys
        ['Control', 'Alt', 'Shift', 'Meta', 'Hyper', 'Super'].includes(key) ? '' : key
    ].filter(Boolean).join('+');

    const action = hotkeyToAction.get(combo);

    // If the key combination doesn't map to a valid action, do nothing.
    // This allows normal typing in input fields.
    if (!action) {
        return;
    }
    
    // If it is a valid action, prevent the default behavior (e.g., typing 't' in an input)
    // and execute the browser action.
    e.preventDefault();

    const state = getState();
    const activeTab = state.tabs.get(state.activeTabId);

    switch (action) {
        case 'new-tab':
            window.electronAPI.newTab();
            break;
        case 'close-tab':
            if (state.activeTabId) {
                Feat.handleCloseTab(state.activeTabId, { getState, persistState, fullRender });
            }
            break;
        case 'find-in-page':
            Feat.showFindBar();
            break;
        case 'quick-search-tabs':
            Feat.showTabSearch();
            break;
        case 'zoom-in':
            if (activeTab) {
                const newZoom = Math.min((activeTab.zoomFactor || 1.0) + 0.1, 3.0);
                window.electronAPI.updateTabZoom(activeTab.id, newZoom);
            }
            break;
        case 'zoom-out':
            if (activeTab) {
                const newZoom = Math.max((activeTab.zoomFactor || 1.0) - 0.1, 0.25);
                window.electronAPI.updateTabZoom(activeTab.id, newZoom);
            }
            break;
        case 'zoom-reset':
            if (activeTab) {
                window.electronAPI.updateTabZoom(activeTab.id, 1.0);
            }
            break;
        case 'reload':
            window.electronAPI.reload();
            break;
        case 'go-back':
            window.electronAPI.goBack();
            break;
        case 'go-forward':
            window.electronAPI.goForward();
            break;
    }
}

function initTabOverflow() {
    let currentScrollLeft = 0, targetScrollLeft = 0, scrollAnimationId = null;
    const DAMPING = 0.8, SCROLL_SPEED_MULTIPLIER = 1.0;

    const updateButtons = () => {
        requestAnimationFrame(() => {
            const { scrollWidth, clientWidth } = DOM.tabsContainerWrapper;
            const isOverflowing = scrollWidth > clientWidth;
            DOM.tabScrollLeftBtn.classList.toggle('hidden', !isOverflowing);
            DOM.tabScrollRightBtn.classList.toggle('hidden', !isOverflowing);
            if (!isOverflowing) return;
            const maxScrollLeft = scrollWidth - clientWidth;
            DOM.tabScrollLeftBtn.disabled = DOM.tabsContainerWrapper.scrollLeft <= 0;
            DOM.tabScrollRightBtn.disabled = DOM.tabsContainerWrapper.scrollLeft >= maxScrollLeft - 1;
        });
    };
    
    const startAnimation = () => {
        if (scrollAnimationId) return;
        const animate = () => {
            const distance = targetScrollLeft - currentScrollLeft;
            if (Math.abs(distance) < 0.5) {
                currentScrollLeft = targetScrollLeft;
                cancelAnimationFrame(scrollAnimationId);
                scrollAnimationId = null;
            } else {
                currentScrollLeft += distance * (1 - DAMPING);
                scrollAnimationId = requestAnimationFrame(animate);
            }
            DOM.tabsContainerWrapper.scrollLeft = Math.round(currentScrollLeft);
            updateButtons();
        };
        scrollAnimationId = requestAnimationFrame(animate);
    };

    DOM.tabsContainerWrapper.addEventListener('wheel', (e) => {
        if (DOM.tabsContainerWrapper.scrollWidth <= DOM.tabsContainerWrapper.clientWidth) return;
        e.preventDefault();
        let delta = (e.deltaX !== 0) ? e.deltaX : e.deltaY;
        if (e.deltaMode === 1) delta *= 15;
        else if (e.deltaMode === 2) delta *= DOM.tabsContainerWrapper.clientWidth;
        targetScrollLeft = Math.max(0, Math.min(DOM.tabsContainerWrapper.scrollWidth - DOM.tabsContainerWrapper.clientWidth, targetScrollLeft + delta * SCROLL_SPEED_MULTIPLIER));
        startAnimation();
    }, { passive: false });

    const scrollBy = (amount) => {
        targetScrollLeft = Math.max(0, Math.min(DOM.tabsContainerWrapper.scrollWidth - DOM.tabsContainerWrapper.clientWidth, targetScrollLeft + amount));
        startAnimation();
    };

    DOM.tabScrollLeftBtn.addEventListener('click', () => scrollBy(-250));
    DOM.tabScrollRightBtn.addEventListener('click', () => scrollBy(250));

    DOM.tabsContainerWrapper.addEventListener('scroll', () => {
        if (!scrollAnimationId) {
            currentScrollLeft = DOM.tabsContainerWrapper.scrollLeft;
            targetScrollLeft = DOM.tabsContainerWrapper.scrollLeft;
            updateButtons();
        }
    }, { passive: true });
    
    new ResizeObserver(() => {
        const maxScrollLeft = DOM.tabsContainerWrapper.scrollWidth - DOM.tabsContainerWrapper.clientWidth;
        if (DOM.tabsContainerWrapper.scrollLeft > maxScrollLeft) DOM.tabsContainerWrapper.scrollLeft = maxScrollLeft;
        currentScrollLeft = DOM.tabsContainerWrapper.scrollLeft;
        targetScrollLeft = DOM.tabsContainerWrapper.scrollLeft;
        updateButtons();
    }).observe(DOM.tabsContainerWrapper);

    new ResizeObserver(updateButtons).observe(DOM.tabsContainer);

    return { updateTabScrollButtons: updateButtons, scrollBy };
}

export function scrollToTab(tabId, alignment = 'center') {
    const state = getState();
    const tab = state.tabs.get(tabId);
    if (!tab) return;

    let targetElement;
    
    const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(tabId));

    if (parentGroup && parentGroup.collapsed) {
        // If tab is in a collapsed group, target the group header.
        targetElement = DOM.tabsContainer.querySelector(`.tab-group[data-group-id="${parentGroup.id}"]`);
    } else {
        // Otherwise, target the tab element itself.
        targetElement = DOM.tabsContainer.querySelector(`.tab-item[data-id="${tabId}"]`);
    }

    if (!targetElement) {
        console.warn(`scrollToTab: Could not find target element for tabId ${tabId}`);
        return;
    }

    const container = DOM.tabsContainerWrapper;
    const containerRect = container.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    
    let desiredScrollLeft;
    if (alignment === 'right') {
        // Align the right edge of the target with the right edge of the container
        desiredScrollLeft = container.scrollLeft + (targetRect.right - containerRect.right);
    } else { // default to 'center'
        // Calculate the element's center relative to the container's left edge
        const targetCenter = (targetRect.left - containerRect.left) + (targetRect.width / 2);
        // Calculate the desired scroll position to center the target element
        desiredScrollLeft = container.scrollLeft + targetCenter - (containerRect.width / 2);
    }
    
    // Clamp the scroll position to be within the valid range
    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    const finalScrollLeft = Math.max(0, Math.min(desiredScrollLeft, maxScrollLeft));

    container.scrollTo({
        left: finalScrollLeft,
        behavior: 'smooth'
    });
}


function initDelegatedEventListeners() {
    // --- Main Tab Bar ---
    DOM.tabsContainer.addEventListener('click', (e) => {
        const state = getState();

        // Close button
        const closeBtn = e.target.closest('.tab-close-btn');
        if (closeBtn) {
            e.stopPropagation();
            const tabId = e.target.closest('[data-id]').dataset.id;
            Feat.handleCloseTab(tabId, { getState, persistState, fullRender });
            return;
        }

        // Switch tab
        const tabItem = e.target.closest('.tab-item');
        if (tabItem) {
            const tabId = tabItem.dataset.id;
            if (tabId !== state.activeTabId) {
                // Explicitly blur address bar before switching to prevent focus jumps.
                DOM.addressBar.blur();
                window.electronAPI.switchTab(tabId);
            }
            return;
        }

        // Collapse/Expand group
        const groupHeader = e.target.closest('.group-header');
        if (groupHeader) {
            const groupId = groupHeader.dataset.id;
            const group = state.groups.get(groupId);
            if (group) {
                group.collapsed = !group.collapsed;
                persistState();
                fullRender();
            }
            return;
        }
    });

    // --- All Tabs View ---
    DOM.allTabsListContainer.addEventListener('click', async (e) => {
        const state = getState();

        // Close button
        const closeBtn = e.target.closest('.tab-close-btn');
        if (closeBtn) {
            e.stopPropagation();
            const tabId = e.target.closest('[data-id]').dataset.id;
            Feat.handleCloseTab(tabId, { getState, persistState, fullRender });
            return;
        }

        // Switch tab and hide view
        const tabItem = e.target.closest('.all-tabs-list-item');
        if (tabItem) {
            const tabId = tabItem.dataset.id;
            if (tabId !== state.activeTabId) {
                await window.electronAPI.switchTab(tabId);
            }
            hideAllTabsView();
            scrollToTab(tabId); // Scroll to make the tab visible after switching from All Tabs view
            return;
        }

        // Collapse/Expand group
        const groupHeader = e.target.closest('.all-tabs-group-header');
        if (groupHeader) {
            const groupId = groupHeader.dataset.groupId;
            const group = state.groups.get(groupId);
            if (group) {
                group.collapsed = !group.collapsed;
                persistState();
                fullRender(); // This will call renderAllTabsView if it's open
            }
            return;
        }
    });
}


export function initEvents(callbacks) {
    getState = callbacks.getState;
    updateNavControls = callbacks.updateNavControls;
    fullRender = callbacks.fullRender;
    persistState = callbacks.persistState;
    
    // Get initial hotkeys and set them up
    window.electronAPI.getSettings().then(settings => {
        updateHotkeyMappings(settings.hotkeys);
    });
    // Listen for updates from the settings page
    document.addEventListener('hotkeys-updated', (e) => updateHotkeyMappings(e.detail));

    // --- UI Element Listeners ---
    DOM.addTabBtn.addEventListener('click', () => window.electronAPI.newTab());
    DOM.addressBar.addEventListener('keydown', handleAddressBar);
    DOM.addressBar.addEventListener('contextmenu', () => {
        window.electronAPI.showInputContextMenu();
    });
    DOM.backBtn.addEventListener('click', () => window.electronAPI.goBack());
    DOM.forwardBtn.addEventListener('click', () => window.electronAPI.goForward());
    DOM.reloadBtn.addEventListener('click', () => window.electronAPI.reload());
    DOM.allTabsBtn.addEventListener('click', showAllTabsView);
    DOM.downloadsBtn.addEventListener('click', showDownloadsView);

    // --- Window Controls ---
    DOM.minBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    DOM.maxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    DOM.closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
    DOM.allTabsMinBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    DOM.allTabsMaxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    DOM.allTabsCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());
    DOM.settingsMinBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    DOM.settingsMaxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    DOM.settingsCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());
    DOM.downloadsMinBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    DOM.downloadsMaxBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    DOM.downloadsCloseBtn.addEventListener('click', () => window.electronAPI.closeWindow());

    window.electronAPI.onMaximizeChanged(refreshMaxButton);
    document.addEventListener('DOMContentLoaded', refreshMaxButton);

    // --- Address Bar Expansion & URL Formatting ---
    DOM.addressBar.addEventListener('mousedown', () => {
        // Flag that the focus event is triggered by a click,
        // so we can select the text. But only if it's not already focused.
        if (document.activeElement !== DOM.addressBar) {
            wasAddressBarClicked = true;
        }
    });

    DOM.addressBar.addEventListener('focus', () => {
        DOM.titlebar.classList.add('address-bar-expanded');
        const state = getState();
        const tab = state.tabs.get(state.activeTabId);
        if (tab && tab.url && tab.url !== 'about:blank') {
            DOM.addressBar.value = tab.url; // Show full URL on focus
        }

        if (wasAddressBarClicked) {
            setTimeout(() => DOM.addressBar.select(), 0);
            wasAddressBarClicked = false; // Reset flag after use
        }
    });

    DOM.addressBar.addEventListener('blur', () => {
        DOM.titlebar.classList.remove('address-bar-expanded');
        // On blur, revert to the formatted URL by calling the main update function.
        const state = getState();
        const tab = state.tabs.get(state.activeTabId);
        if (updateNavControls) {
            updateNavControls(tab);
        }
        // Also reset flag on blur in case mousedown happened without focus
        wasAddressBarClicked = false;
    });

    // --- Global Shortcuts ---
    window.addEventListener('keydown', handleGlobalShortcuts);

    // --- Tab Overflow ---
    const { updateTabScrollButtons, scrollBy } = initTabOverflow();
    callbacks.updateTabScrollButtons = updateTabScrollButtons;

    // --- Tab Bar Arrow Key Scrolling ---
    window.addEventListener('keydown', (e) => {
        // Only act when in the main browser view
        if (!DOM.allTabsView.classList.contains('hidden') || !DOM.settingsView.classList.contains('hidden')) {
            return;
        }

        // Also ignore if tab search is open
        if (!DOM.searchOverlay.classList.contains('hidden')) {
            return;
        }

        const isScrollable = DOM.tabsContainerWrapper.scrollWidth > DOM.tabsContainerWrapper.clientWidth;
        if (!isScrollable) {
            return;
        }

        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable
        );

        // Don't interfere with text input in the chrome UI or find bar
        if (isInputFocused) {
            return;
        }

        // Handle arrow keys for tab scrolling
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            scrollBy(-100);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            scrollBy(100);
        }
    });

    // --- Delegated Listeners for dynamically created items ---
    initDelegatedEventListeners();
}
