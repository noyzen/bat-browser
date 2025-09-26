import { state, isTabInAnyGroup, persistState } from '../renderer.js';
import * as Feat from './features.js';

let fullRenderCallback;

async function handleContextMenuCommand(command, context) {
    const rerender = () => fullRenderCallback();

    switch (command) {
        case 'new-tab':
            window.electronAPI.newTab();
            break;
        case 'duplicate-tab': {
            const { tabId } = context;
            const newTabData = await window.electronAPI.duplicateTab(tabId);
            if (!newTabData) break;
            state.tabs.set(newTabData.id, newTabData);

            const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(tabId));
            if (parentGroup) {
                const originalIndex = parentGroup.tabs.indexOf(tabId);
                parentGroup.tabs.splice(originalIndex + 1, 0, newTabData.id);
            } else {
                const originalIndex = state.layout.indexOf(tabId);
                state.layout.splice(originalIndex > -1 ? originalIndex + 1 : state.layout.length, 0, newTabData.id);
            }

            persistState();
            rerender();
            await window.electronAPI.switchTab(newTabData.id);
            break;
        }
        case 'close-tab':
            Feat.handleCloseTab(context.tabId, callbacks);
            break;
        case 'add-to-new-group': {
            const { tabId } = context;
            const newGroupId = `group-${Date.now()}`;
            const newGroup = { id: newGroupId, name: "New Group", color: Feat.getRandomColor(), collapsed: false, tabs: [tabId] };
            let insertionIndex;
            const oldParentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(tabId));

            if (oldParentGroup) {
                oldParentGroup.tabs = oldParentGroup.tabs.filter(t => t !== tabId);
                insertionIndex = state.layout.indexOf(oldParentGroup.id) + 1;
                if (oldParentGroup.tabs.length === 0) {
                    state.groups.delete(oldParentGroup.id);
                    state.layout = state.layout.filter(id => id !== oldParentGroup.id);
                    insertionIndex--;
                }
            } else {
                insertionIndex = state.layout.indexOf(tabId);
                if (insertionIndex !== -1) state.layout.splice(insertionIndex, 1);
                else insertionIndex = state.layout.length;
            }
            state.groups.set(newGroupId, newGroup);
            state.layout.splice(insertionIndex, 0, newGroupId);
            persistState();
            rerender();
            break;
        }
        case 'add-to-existing-group': {
            const { tabId, groupId } = context;
            const oldParent = Array.from(state.groups.values()).find(g => g.tabs.includes(tabId));
            if (oldParent) oldParent.tabs = oldParent.tabs.filter(t => t !== tabId);
            else state.layout = state.layout.filter(id => id !== tabId);
            state.groups.get(groupId).tabs.push(tabId);
            persistState();
            rerender();
            break;
        }
        case 'remove-from-group': {
            const { tabId } = context;
            const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(tabId));
            if (!parentGroup) return;
            parentGroup.tabs = parentGroup.tabs.filter(t => t !== tabId);
            const groupIndex = state.layout.indexOf(parentGroup.id);
            if (groupIndex > -1) state.layout.splice(groupIndex + 1, 0, tabId);
            if (parentGroup.tabs.length === 0) {
                state.groups.delete(parentGroup.id);
                state.layout = state.layout.filter(id => id !== parentGroup.id);
            }
            persistState();
            rerender();
            break;
        }
        case 'rename-group': {
            const { groupId } = context;
            const group = state.groups.get(groupId);
            if (!group) return;
            const newName = await Feat.showPromptDialog('Rename Group', 'Enter new group name:', group.name);
            if (newName && newName.trim()) {
                group.name = newName.trim();
                persistState();
                rerender();
            }
            break;
        }
        case 'ungroup': {
            const { groupId } = context;
            const group = state.groups.get(groupId);
            if (!group) return;
            state.groups.delete(groupId);
            const groupIndex = state.layout.indexOf(groupId);
            if (groupIndex > -1) state.layout.splice(groupIndex, 1, ...group.tabs);
            persistState();
            rerender();
            break;
        }
        case 'close-group-tabs': {
            const { groupId } = context;
            const group = state.groups.get(groupId);
            if (!group) return;
            if (group.tabs.length > 1) {
                const confirmed = await Feat.showConfirmationDialog('Close Group?', `Are you sure you want to close all ${group.tabs.length} tabs in the "${group.name}" group?`);
                if (!confirmed) return;
            }
            [...group.tabs].forEach(tabId => Feat.handleCloseTab(tabId, callbacks));
            break;
        }
        case 'close-other-tabs': {
            const { tabId } = context;
            const otherTabs = Array.from(state.tabs.keys()).filter(id => id !== tabId);
            if (otherTabs.length > 0) {
                const confirmed = await Feat.showConfirmationDialog(
                    'Close Other Tabs?',
                    `Are you sure you want to close all ${otherTabs.length} other tabs?`
                );
                if (confirmed) {
                    otherTabs.forEach(idToClose => Feat.handleCloseTab(idToClose, callbacks));
                }
            }
            break;
        }
    }
}

let callbacks;

export function initContextMenu(cbs) {
    callbacks = cbs;
    fullRenderCallback = cbs.fullRender;
    
    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const targetTab = e.target.closest('.tab-item, .all-tabs-list-item');
        const targetGroup = e.target.closest('.group-header, .tab-group, .all-tabs-group-header');
        let menuTemplate = [];

        if (targetTab) {
            const tabId = targetTab.dataset.id;
            const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(tabId));
            const otherTabsCount = state.tabs.size - 1;

            menuTemplate = [
                { label: 'New Tab', action: { command: 'new-tab' } },
                { label: 'Duplicate', action: { command: 'duplicate-tab', context: { tabId } } },
                { type: 'separator' },
                { label: 'Add to New Group', action: { command: 'add-to-new-group', context: { tabId } } },
                {
                    label: 'Add to Group',
                    visible: state.groups.size > 0 && (!parentGroup || state.groups.size > 1),
                    submenu: Array.from(state.groups.values()).filter(g => g !== parentGroup).map(group => ({
                        label: group.name,
                        action: { command: 'add-to-existing-group', context: { tabId, groupId: group.id } }
                    }))
                },
                { type: 'separator' },
                { label: 'Remove from Group', enabled: !!parentGroup, action: { command: 'remove-from-group', context: { tabId } } },
                { type: 'separator' },
                { label: 'Close Tab', action: { command: 'close-tab', context: { tabId } } },
                { label: 'Close Other Tabs', action: { command: 'close-other-tabs', context: { tabId } }, enabled: otherTabsCount > 0 }
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

    window.electronAPI.onContextMenuCommand(handleContextMenuCommand);
}
