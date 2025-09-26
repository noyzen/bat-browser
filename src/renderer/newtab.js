document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url-input');
    const closeBtn = document.getElementById('close-tab-btn');

    if (!urlInput || !closeBtn) {
        console.error('New tab page elements not found!');
        return;
    }

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            let url = urlInput.value.trim();
            if (!url) return;

            if (e.ctrlKey) {
                // Ctrl+Enter for www.<input>.com
                url = `https://www.${url}.com`;
            } else {
                // Simple URL detection logic, same as in renderer.js
                if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
                    if (url.includes('.') && !url.includes(' ')) {
                        url = 'http://' + url;
                    } else {
                        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
                    }
                }
            }
            
            if (window.viewAPI && window.viewAPI.loadURL) {
                window.viewAPI.loadURL(url);
            } else {
                console.error('View API not available to load URL.');
            }
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