document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url-input');
    const closeBtn = document.getElementById('close-tab-btn');

    if (!urlInput || !closeBtn) {
        console.error('New tab page elements not found!');
        return;
    }

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = urlInput.value.trim();
            if (!query) return;

            if (window.viewAPI && window.viewAPI.loadURL) {
                window.viewAPI.loadURL(query);
            } else {
                console.error('View API not available to load URL.');
            }
        }
    });

    urlInput.addEventListener('contextmenu', () => {
        if (window.viewAPI && window.viewAPI.showInputContextMenu) {
            window.viewAPI.showInputContextMenu();
        }
    });

    closeBtn.addEventListener('click', () => {
        if (window.viewAPI && window.viewAPI.closeTab) {
            window.viewAPI.closeTab();
        } else {
            console.error('View API not available to close tab.');
        }
    });
});