const container = document.getElementById('context-menu-container');

let activeMenu = null;

function hideActiveMenu() {
    if (activeMenu) {
        activeMenu.remove();
        activeMenu = null;
    }
    container.style.pointerEvents = 'none';
    window.removeEventListener('mousedown', onWindowMousedown, true);
    window.removeEventListener('keydown', onWindowKeydown, true);
}

function onWindowMousedown(e) {
    if (activeMenu && !activeMenu.contains(e.target)) {
        hideActiveMenu();
    }
}

function onWindowKeydown(e) {
    if (e.key === 'Escape') {
        hideActiveMenu();
    }
}

function buildMenu(template, onItemClick) {
    const menuEl = document.createElement('ul');
    menuEl.className = 'context-menu';

    template.forEach(item => {
        if (item.visible === false) return;

        if (item.type === 'separator') {
            const separatorEl = document.createElement('li');
            separatorEl.className = 'context-menu-separator';
            menuEl.appendChild(separatorEl);
            return;
        }

        const itemEl = document.createElement('li');
        itemEl.className = 'context-menu-item';
        itemEl.classList.toggle('disabled', item.enabled === false);

        if (item.type === 'checkbox') {
            const checkEl = document.createElement('span');
            checkEl.className = 'checkbox';
            if (item.checked) {
                checkEl.innerHTML = '<i class="fa-solid fa-check"></i>';
            }
            itemEl.appendChild(checkEl);
        }

        const labelEl = document.createElement('span');
        labelEl.className = 'label';
        labelEl.textContent = item.label;
        itemEl.appendChild(labelEl);

        if (item.submenu && item.submenu.length > 0) {
            const arrowEl = document.createElement('span');
            arrowEl.className = 'submenu-arrow';
            arrowEl.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            itemEl.appendChild(arrowEl);

            const submenuEl = buildMenu(item.submenu, onItemClick);
            submenuEl.classList.add('submenu');
            itemEl.appendChild(submenuEl);
        }

        if (item.action && item.enabled !== false) {
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                hideActiveMenu();
                onItemClick(item.action);
            });
        }
        
        menuEl.appendChild(itemEl);
    });

    return menuEl;
}

export function showCustomContextMenu(x, y, template, onItemClick) {
    hideActiveMenu();

    activeMenu = buildMenu(template, onItemClick);
    container.appendChild(activeMenu);

    // Adjust positioning of submenus that would go off-screen
    const submenus = activeMenu.querySelectorAll('.submenu');
    submenus.forEach(submenu => {
        const itemRect = submenu.parentElement.getBoundingClientRect();
        const rootMenuRect = activeMenu.getBoundingClientRect();
        
        if (itemRect.right + submenu.offsetWidth > window.innerWidth) {
            submenu.style.left = 'auto';
            submenu.style.right = '100%';
        }
        if (itemRect.top + submenu.offsetHeight > window.innerHeight) {
            submenu.style.top = 'auto';
            submenu.style.bottom = '0';
        }
    });

    const menuWidth = activeMenu.offsetWidth;
    const menuHeight = activeMenu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    if (x + menuWidth > windowWidth) {
        x = windowWidth - menuWidth;
    }
    if (y + menuHeight > windowHeight) {
        y = windowHeight - menuHeight;
    }

    activeMenu.style.left = `${x}px`;
    activeMenu.style.top = `${y}px`;
    
    container.style.pointerEvents = 'auto';

    window.addEventListener('mousedown', onWindowMousedown, true);
    window.addEventListener('keydown', onWindowKeydown, true);
}