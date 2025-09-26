import * as DOM from './modules/dom.js';
import { initIpc } from './modules/ipc.js';
import { initEvents } from './modules/events.js';
import { initContextMenu } from './modules/context-menu.js';
import { initDragDrop } from './modules/drag-drop.js';
import { initViews, renderAllTabsView } from './modules/views.js';
import { initFeatures, applyUiFont } from './modules/features.js';
import { render, updateNavControls } from './modules/render.js';

// --- State ---
export const state = {
    tabs: new Map(),
    groups: new Map(),
    layout: [],
    activeTabId: null,
};

// --- Core Functions ---
export function isTabInAnyGroup(tabId) {
    for (const group of state.groups.values()) {
        if (group.tabs.includes(tabId)) {
            return true;
        }
    }
    return false;
}

export function persistState() {
    window.electronAPI.updateLayout(state.layout, Array.from(state.groups.values()));
}

function fullRender() {
    render();
    if (!DOM.allTabsView.classList.contains('hidden')) {
        renderAllTabsView();
    }
}

function updateStateAndRender(newState) {
    if (newState.tabs) state.tabs = newState.tabs;
    if (newState.groups) state.groups = newState.groups;
    if (newState.layout) state.layout = newState.layout;
    if (newState.activeTabId) state.activeTabId = newState.activeTabId;
    fullRender();
}

// --- Initialization ---
function initialize() {
    const callbacks = {
        getState: () => state,
        isTabInAnyGroup,
        persistState,
        fullRender,
        updateStateAndRender,
        updateNavControls,
    };

    initIpc(callbacks);
    initEvents(callbacks);
    initContextMenu(callbacks);
    initDragDrop(callbacks);
    initViews(callbacks);
    initFeatures(callbacks);

    // Apply custom UI font on startup
    window.electronAPI.getSettings().then(settings => {
        if (settings.defaultFont) {
            applyUiFont(settings.defaultFont);
        }
    });
}

initialize();