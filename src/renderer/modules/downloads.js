import * as DOM from './dom.js';
import { state } from '../renderer.js';

let fullRenderCallback;

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getFileIconClass(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    switch (extension) {
        case 'zip':
        case 'rar':
        case '7z':
        case 'tar':
        case 'gz':
            return 'fa-solid fa-file-zipper';
        case 'pdf':
            return 'fa-solid fa-file-pdf';
        case 'doc':
        case 'docx':
            return 'fa-solid fa-file-word';
        case 'xls':
        case 'xlsx':
            return 'fa-solid fa-file-excel';
        case 'ppt':
        case 'pptx':
            return 'fa-solid fa-file-powerpoint';
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'bmp':
        case 'svg':
            return 'fa-solid fa-file-image';
        case 'mp3':
        case 'wav':
        case 'ogg':
            return 'fa-solid fa-file-audio';
        case 'mp4':
        case 'mov':
        case 'avi':
        case 'mkv':
            return 'fa-solid fa-file-video';
        case 'js':
        case 'html':
        case 'css':
        case 'json':
        case 'xml':
            return 'fa-solid fa-file-code';
        case 'txt':
            return 'fa-solid fa-file-lines';
        default:
            return 'fa-solid fa-file';
    }
}

function renderDownloadItem(item) {
    const { id, filename, state: itemState, receivedBytes, totalBytes, speed } = item;
    
    let itemEl = DOM.downloadsListContainer.querySelector(`.download-item[data-id="${id}"]`);
    if (!itemEl) {
        itemEl = document.createElement('div');
        itemEl.className = 'download-item';
        itemEl.dataset.id = id;
        itemEl.innerHTML = `
            <div class="download-file-icon"><i class="${getFileIconClass(filename)}"></i></div>
            <div class="download-details">
                <div class="download-filename" title="${filename}">${filename}</div>
                <div class="download-progress-bar">
                    <div class="download-progress-bar-fill"></div>
                </div>
                <div class="download-info">
                    <span class="download-status"></span>
                    <span class="download-speed"></span>
                </div>
            </div>
            <div class="download-actions">
                <button class="download-action-pause" title="Pause"><i class="fa-solid fa-pause"></i></button>
                <button class="download-action-resume" title="Resume"><i class="fa-solid fa-play"></i></button>
                <button class="download-action-cancel" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
                <button class="download-action-open" title="Open File"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                <button class="download-action-show" title="Show in Folder"><i class="fa-solid fa-folder"></i></button>
                <button class="download-action-remove" title="Remove from List"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        // Prepend to show latest downloads at the top
        DOM.downloadsListContainer.prepend(itemEl);
    }
    
    // Update attributes and content
    itemEl.dataset.state = itemState;
    itemEl.querySelector('.download-filename').textContent = filename;
    itemEl.querySelector('.download-filename').title = filename;

    const progressFill = itemEl.querySelector('.download-progress-bar-fill');
    const statusEl = itemEl.querySelector('.download-status');
    const speedEl = itemEl.querySelector('.download-speed');

    const progress = (totalBytes > 0) ? (receivedBytes / totalBytes) * 100 : 0;
    progressFill.style.width = `${progress}%`;

    switch (itemState) {
        case 'progressing':
            statusEl.textContent = `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`;
            speedEl.textContent = `${formatBytes(speed)}/s`;
            break;
        case 'paused':
            statusEl.textContent = `Paused - ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`;
            speedEl.textContent = '';
            break;
        case 'completed':
            statusEl.textContent = `Completed - ${formatBytes(totalBytes)}`;
            speedEl.textContent = '';
            break;
        case 'cancelled':
            statusEl.textContent = 'Cancelled';
            speedEl.textContent = '';
            break;
        case 'interrupted':
            statusEl.textContent = 'Interrupted';
            speedEl.textContent = '';
            break;
    }
}

function renderAllDownloads() {
    const container = DOM.downloadsListContainer;
    if (state.downloads.size === 0) {
        container.innerHTML = `<div class="downloads-no-items">No downloads yet.</div>`;
        return;
    }
    if (container.querySelector('.downloads-no-items')) {
        container.innerHTML = '';
    }

    const sortedDownloads = Array.from(state.downloads.values()).sort((a, b) => b.startTime - a.startTime);
    sortedDownloads.forEach(renderDownloadItem);
}


export function showDownloadsView() {
    window.electronAPI.hideActiveView();
    renderAllDownloads();
    DOM.downloadsView.classList.remove('hidden');
    DOM.appChrome.classList.add('hidden');
}

export function hideDownloadsView() {
    DOM.downloadsView.classList.add('hidden');
    DOM.appChrome.classList.remove('hidden');
    if(fullRenderCallback) fullRenderCallback();
    window.electronAPI.showActiveView();
}


export function initDownloads(callbacks) {
    fullRenderCallback = callbacks.fullRender;

    DOM.downloadsBackBtn.addEventListener('click', hideDownloadsView);

    window.electronAPI.onDownloadsLoadHistory(items => {
        items.forEach(item => state.downloads.set(item.id, item));
        if (!DOM.downloadsView.classList.contains('hidden')) {
            renderAllDownloads();
        }
    });

    window.electronAPI.onDownloadStarted(item => {
        state.downloads.set(item.id, item);
        if (!DOM.downloadsView.classList.contains('hidden')) {
            renderAllDownloads();
        }
    });

    window.electronAPI.onDownloadUpdated(update => {
        const item = state.downloads.get(update.id);
        if (item) {
            Object.assign(item, update);
            if (!DOM.downloadsView.classList.contains('hidden')) {
                renderDownloadItem(item);
            }
        }
    });

    DOM.downloadsListContainer.addEventListener('click', e => {
        const button = e.target.closest('button');
        if (!button) return;
        
        const itemEl = e.target.closest('.download-item');
        const id = itemEl.dataset.id;

        if (button.matches('.download-action-pause')) window.electronAPI.downloadPause(id);
        else if (button.matches('.download-action-resume')) window.electronAPI.downloadResume(id);
        else if (button.matches('.download-action-cancel')) window.electronAPI.downloadCancel(id);
        else if (button.matches('.download-action-open')) window.electronAPI.downloadOpenFile(id);
        else if (button.matches('.download-action-show')) window.electronAPI.downloadShowInFolder(id);
        else if (button.matches('.download-action-remove')) {
            state.downloads.delete(id);
            itemEl.remove();
            if (state.downloads.size === 0) {
                 DOM.downloadsListContainer.innerHTML = `<div class="downloads-no-items">No downloads yet.</div>`;
            }
            window.electronAPI.downloadRemove(id);
        }
    });

    DOM.downloadsClearAllBtn.addEventListener('click', () => {
        const itemsToRemove = [];
        for (const [id, item] of state.downloads.entries()) {
            if (item.state !== 'progressing' && item.state !== 'paused') {
                itemsToRemove.push(id);
            }
        }
        itemsToRemove.forEach(id => {
            state.downloads.delete(id);
            DOM.downloadsListContainer.querySelector(`.download-item[data-id="${id}"]`)?.remove();
        });
        if (state.downloads.size === 0) {
             DOM.downloadsListContainer.innerHTML = `<div class="downloads-no-items">No downloads yet.</div>`;
        }
        window.electronAPI.downloadClearAll();
    });
}
