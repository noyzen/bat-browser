import * as DOM from './dom.js';
import { state, persistState } from '../renderer.js';
import * as Feat from './features.js';
import { renderAllTabsView } from './views.js';
import { scrollToTab } from './events.js';
import { updateAIPanelContext } from './ai.js';

let fullRenderCallback, updateNavControlsCallback, updateTabScrollButtons;

export function initIpc(callbacks) {
    fullRenderCallback = callbacks.fullRender;
    updateNavControlsCallback = callbacks.updateNavControls;
    updateTabScrollButtons = callbacks.updateTabScrollButtons;

    window.electronAPI.onSessionRestoreUI(session => {
        session.tabs.forEach(t => {
            state.tabs.set(t.id, { ...t, isLoading: false, isLoaded: false, aiChatHistory: [] });
        });
        session.groups.forEach(g => state.groups.set(g.id, g));
        state.layout = session.layout;
        state.activeTabId = session.activeTabId;
        fullRenderCallback();
        if (state.activeTabId) {
            updateNavControlsCallback(state.tabs.get(state.activeTabId));
            setTimeout(() => scrollToTab(state.activeTabId), 50);
        }
    });

    window.electronAPI.onTabCreated(tabData => {
        state.tabs.set(tabData.id, { ...tabData, aiChatHistory: [] });
        const existsInLayout = state.layout.includes(tabData.id);
        const existsInGroup = Array.from(state.groups.values()).some(g => g.tabs.includes(tabData.id));
        if (!existsInLayout && !existsInGroup) {
            state.layout.push(tabData.id);
        }
        fullRenderCallback();
        setTimeout(() => scrollToTab(tabData.id), 50);
    });

    window.electronAPI.onTabCreatedWithLayout(({ newTab, newLayout, newGroups }) => {
        state.tabs.set(newTab.id, { ...newTab, aiChatHistory: [] });
        state.layout = newLayout;
        state.groups.clear();
        newGroups.forEach(g => state.groups.set(g.id, g));
        fullRenderCallback();
    });

    window.electronAPI.onTabSwitched(id => {
        state.activeTabId = id;
        fullRenderCallback();
        updateNavControlsCallback(state.tabs.get(id));
        updateAIPanelContext();
        // scrollToTab(id); // Removed to prevent auto-scrolling on every tab switch
    });

    window.electronAPI.onTabUpdated(update => {
        const tab = state.tabs.get(update.id);
        if (tab) {
            Object.assign(tab, update);
            if (update.id === state.activeTabId) {
                updateNavControlsCallback(tab);
            }
            fullRenderCallback();
        }
    });

    window.electronAPI.onTabClosed(id => {
        // This is a reconciliation step from main process.
        if (state.tabs.has(id)) {
            Feat.handleCloseTab(id, callbacks);
        }
    });

    window.electronAPI.onWindowBlurred(() => {
        if (document.activeElement === DOM.addressBar) {
            DOM.addressBar.blur();
        }
    });

    window.electronAPI.onCloseTabFromView((id) => {
        Feat.handleCloseTab(id, callbacks);
    });

    window.electronAPI.onFindResult(({ matches, activeMatchOrdinal }) => {
        DOM.findMatches.textContent = `${activeMatchOrdinal}/${matches}`;
    });

    window.electronAPI.onForwardedKeydown((event) => {
        // Synthesize a KeyboardEvent and dispatch it on the window.
        // The global shortcut handler will pick it up.
        // We can't set a real target, but the handler checks for inputs
        // and our synthetic event won't have an input as a target, which is correct.
        const keyboardEvent = new KeyboardEvent('keydown', {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            bubbles: true,
            cancelable: true,
        });
        window.dispatchEvent(keyboardEvent);
    });
}