import * as DOM from './dom.js';
import * as Feat from './features.js';
import { showAllTabsView, hideAllTabsView } from './views.js';

let getState, updateNavControls, fullRender, persistState;

function handleAddressBar(e) {
    if (e.key === 'Enter') {
        let url = DOM.addressBar.value.trim();
        if (!url) return;

        if (e.ctrlKey) {
            url = `https://www.${url}.com`;
        } else {
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
                if (url.includes('.') && !url.includes(' ')) {
                    url = 'http://' + url;
                } else {
                    url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
                }
            }
        }
        window.electronAPI.loadURL(url);
        DOM.addressBar.blur();
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
}

function handleGlobalShortcuts(e) {
    const state = getState();
    if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        Feat.showFindBar();
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        Feat.showTabSearch();
    }

    const activeTab = state.tabs.get(state.activeTabId);
    if (!activeTab) return;

    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const newZoom = Math.min((activeTab.zoomFactor || 1.0) + 0.1, 3.0);
        window.electronAPI.updateTabZoom(activeTab.id, newZoom);
    }
    if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        const newZoom = Math.max((activeTab.zoomFactor || 1.0) - 0.1, 0.25);
        window.electronAPI.updateTabZoom(activeTab.id, newZoom);
    }
    if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        window.electronAPI.updateTabZoom(activeTab.id, 1.0);
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

    return { updateTabScrollButtons: updateButtons };
}

export function scrollToTab(tabId) {
    const tabElement = DOM.tabsContainer.querySelector(`[data-id="${tabId}"]`);
    if (!tabElement) return;

    const container = DOM.tabsContainerWrapper;
    const containerWidth = container.offsetWidth;
    const tabOffsetLeft = tabElement.offsetLeft;
    const tabWidth = tabElement.offsetWidth;

    // Calculate the desired scroll position to center the tab
    let desiredScrollLeft = tabOffsetLeft + (tabWidth / 2) - (containerWidth / 2);

    // Clamp the scroll position to be within the valid range
    const maxScrollLeft = container.scrollWidth - containerWidth;
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

    // --- UI Element Listeners ---
    DOM.addTabBtn.addEventListener('click', () => window.electronAPI.newTab());
    DOM.addressBar.addEventListener('keydown', handleAddressBar);
    DOM.backBtn.addEventListener('click', () => window.electronAPI.goBack());
    DOM.forwardBtn.addEventListener('click', () => window.electronAPI.goForward());
    DOM.reloadBtn.addEventListener('click', () => window.electronAPI.reload());
    DOM.allTabsBtn.addEventListener('click', showAllTabsView);

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
    
    window.electronAPI.onMaximizeChanged(refreshMaxButton);
    document.addEventListener('DOMContentLoaded', refreshMaxButton);

    // --- Address Bar Expansion ---
    DOM.addressBar.addEventListener('focus', () => DOM.titlebar.classList.add('address-bar-expanded'));
    DOM.addressBar.addEventListener('blur', () => DOM.titlebar.classList.remove('address-bar-expanded'));

    // --- Global Shortcuts ---
    window.addEventListener('keydown', handleGlobalShortcuts);

    // --- Tab Overflow ---
    const { updateTabScrollButtons } = initTabOverflow();
    callbacks.updateTabScrollButtons = updateTabScrollButtons;

    // --- Delegated Listeners for dynamically created items ---
    initDelegatedEventListeners();
}