import { state, persistState } from '../renderer.js';

let draggedElement = null;
let placeholder = null;
let autoExpandTimer = null;
let lastHoveredGroupIdForExpand = null;
let fullRenderCallback;

function clearAutoExpand() {
    clearTimeout(autoExpandTimer);
    autoExpandTimer = null;
    if (lastHoveredGroupIdForExpand) {
        const oldGroupEl = document.querySelector(`.tab-group[data-group-id="${lastHoveredGroupIdForExpand}"], .all-tabs-group-header[data-group-id="${lastHoveredGroupIdForExpand}"]`);
        oldGroupEl?.querySelector('.auto-expand-indicator')?.remove();
        lastHoveredGroupIdForExpand = null;
    }
}

function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.children].filter(child => {
        return !child.classList.contains('placeholder') && !child.classList.contains('dragging');
    });
    const isHorizontal = container.id === 'tabs-container' || container.classList.contains('tab-group-tabs');

    for (const child of draggableElements) {
        const box = child.getBoundingClientRect();
        const cursorPosition = isHorizontal ? x : y;
        const elementMidpoint = isHorizontal ? box.left + box.width / 2 : box.top + box.height / 2;
        if (cursorPosition < elementMidpoint) {
            return child;
        }
    }
    return null;
}

function handleDragStart(e) {
    draggedElement = e.target.closest('[draggable="true"]');
    if (!draggedElement) return;

    e.dataTransfer.effectAllowed = 'move';
    const empty = new Image();
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.setDragImage(empty, 0, 0);

    placeholder = document.createElement('div');
    placeholder.className = 'placeholder';

    setTimeout(() => {
        if (draggedElement) {
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
    if (placeholder?.parentNode) placeholder.remove();
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
    const targetGroupEl = e.target.closest('.all-tabs-group-header, .tab-group.collapsed');
    const targetGroupId = targetGroupEl?.dataset.groupId;

    if (draggedType === 'tab' && targetGroupEl) {
        const group = state.groups.get(targetGroupId);
        if (group?.collapsed && targetGroupId !== lastHoveredGroupIdForExpand) {
            clearAutoExpand();
            lastHoveredGroupIdForExpand = targetGroupId;
            const indicator = document.createElement('div');
            indicator.className = 'auto-expand-indicator';
            targetGroupEl.appendChild(indicator);
            indicator.style.animation = 'fill-progress 700ms linear forwards';

            autoExpandTimer = setTimeout(() => {
                if (draggedElement && lastHoveredGroupIdForExpand === targetGroupId) {
                    group.collapsed = false;
                    persistState();
                    fullRenderCallback();
                }
            }, 700);
        }
    } else if (!targetGroupEl && lastHoveredGroupIdForExpand) {
        clearAutoExpand();
    }

    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    const reorderContainer = e.target.closest('.all-tabs-group-tabs, #all-tabs-list-container, .tab-group-tabs, #tabs-container');
    if (reorderContainer) {
        if (draggedType === 'group' && reorderContainer.matches('.all-tabs-group-tabs, .tab-group-tabs')) {
            if (placeholder.parentNode) placeholder.remove();
            return;
        }
        const afterElement = getDragAfterElement(reorderContainer, e.clientX, e.clientY);
        if (afterElement) {
            reorderContainer.insertBefore(placeholder, afterElement);
        } else {
            reorderContainer.appendChild(placeholder);
        }
        return;
    }
    
    const dropIntoGroupEl = e.target.closest('.tab-group, .all-tabs-group-header, .all-tabs-group-container');
    if (draggedType === 'tab' && dropIntoGroupEl) {
        const dropIntoGroupId = dropIntoGroupEl.dataset.groupId || dropIntoGroupEl.dataset.id;
        const parentGroup = Array.from(state.groups.values()).find(g => g.tabs.includes(draggedId));
        if (dropIntoGroupId && dropIntoGroupId !== parentGroup?.id) {
            dropIntoGroupEl.classList.add('drag-over');
            if (placeholder.parentNode) placeholder.remove();
            return;
        }
    }

    if (placeholder.parentNode) placeholder.remove();
}

function handleDrop(e) {
    e.preventDefault();
    if (!draggedElement) return;

    clearAutoExpand();

    const draggedId = draggedElement.dataset.id || draggedElement.dataset.groupId;
    const dropTargetGroupEl = document.querySelector('.drag-over');

    state.layout = state.layout.filter(id => id !== draggedId);
    let originalGroup = null;
    state.groups.forEach(group => {
        const tabIndex = group.tabs.indexOf(draggedId);
        if (tabIndex > -1) {
            originalGroup = group;
            group.tabs.splice(tabIndex, 1);
        }
    });

    if (draggedElement.dataset.type === 'tab' && dropTargetGroupEl) {
        const targetGroupId = dropTargetGroupEl.dataset.groupId || dropTargetGroupEl.dataset.id;
        const targetGroup = state.groups.get(targetGroupId);
        if (targetGroup) {
            targetGroup.tabs.push(draggedId);
            targetGroup.collapsed = false;
        }
    } else if (placeholder?.parentElement) {
        const parent = placeholder.parentElement;
        const nextEl = placeholder.nextElementSibling;
        const nextId = nextEl ? (nextEl.dataset.id || nextEl.dataset.groupId) : null;
        const parentGroupEl = parent.closest('.tab-group, .all-tabs-group-container');
        
        if (parentGroupEl) {
             const parentGroupId = parentGroupEl.dataset.groupId || parentGroupEl.dataset.id;
             const parentGroup = state.groups.get(parentGroupId);
             if (parentGroup) {
                const nextIndex = nextId ? parentGroup.tabs.indexOf(nextId) : -1;
                if (nextIndex > -1) parentGroup.tabs.splice(nextIndex, 0, draggedId);
                else parentGroup.tabs.push(draggedId);
             }
        } else {
            const nextIndex = nextId ? state.layout.indexOf(nextId) : -1;
            if(nextIndex > -1) state.layout.splice(nextIndex, 0, draggedId);
            else state.layout.push(draggedId);
        }
    } else {
        if (originalGroup) originalGroup.tabs.push(draggedId);
        else state.layout.push(draggedId);
    }
    
    if (originalGroup && originalGroup.tabs.length === 0) {
        state.groups.delete(originalGroup.id);
        state.layout = state.layout.filter(id => id !== originalGroup.id);
    }

    persistState();
    fullRenderCallback();
    handleDragEnd();
}

export function initDragDrop({ fullRender }) {
    fullRenderCallback = fullRender;
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
}
