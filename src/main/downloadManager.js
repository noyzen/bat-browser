const { session, dialog, shell, app } = require('electron');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const https = require('https');
const state = require('./state');
const { DOWNLOADS_PATH } = require('./constants');
const { debounce } = require('./utils');

let activeDownloadItems = new Map(); // Maps download ID to Electron's DownloadItem or custom handler

function saveDownloads() {
    const serializable = Array.from(state.downloads.values()).map(d => {
        // Don't save in-progress downloads' temporary chunk data
        const { chunks, ...rest } = d;
        if (rest.state === 'progressing') {
            rest.state = 'interrupted'; // Mark as interrupted on close
        }
        return rest;
    });
    try {
        fs.writeFileSync(DOWNLOADS_PATH, JSON.stringify(serializable, null, 2));
    } catch (e) {
        console.error('Failed to save downloads:', e);
    }
}

const debouncedSaveDownloads = debounce(saveDownloads, 1000);

function loadDownloads() {
    try {
        if (fs.existsSync(DOWNLOADS_PATH)) {
            const data = JSON.parse(fs.readFileSync(DOWNLOADS_PATH, 'utf-8'));
            data.forEach(item => {
                // Ensure interrupted downloads from previous sessions are marked as such
                if (item.state === 'progressing') {
                    item.state = 'interrupted';
                }
                state.downloads.set(item.id, item);
            });
            return data;
        }
    } catch (e) {
        console.error('Failed to load downloads:', e);
    }
    return [];
}


function sendUpdate(update) {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('download:updated', update);
    }
}

const throttledSendUpdate = debounce(sendUpdate, 250);

function initialize() {
    const filter = { urls: ['*://*/*'] };

    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
        if (details.statusCode >= 200 && details.statusCode < 300 && details.responseHeaders) {
            const contentType = details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'];
            const contentDisposition = details.responseHeaders['content-disposition'] || details.responseHeaders['Content-Disposition'];

            if (contentType && contentType.some(ct => ct.includes('application/octet-stream')) ||
                (contentDisposition && contentDisposition.some(cd => cd.includes('attachment')))) {
                
                details.webContents.downloadURL(details.url);
            }
        }
        callback({ cancel: false, responseHeaders: details.responseHeaders });
    });
    
    // Attach listener to any created session
    app.on('session-created', (newSession) => {
        newSession.on('will-download', handleWillDownload);
    });
    // Attach to default session for popups etc.
    session.defaultSession.on('will-download', handleWillDownload);
}

async function handleWillDownload(event, item, webContents) {
    event.preventDefault();

    const { askBeforeSaving, location, multiConnection } = state.settings.downloads;
    let savePath = path.join(location, item.getFilename());

    if (askBeforeSaving) {
        const result = await dialog.showSaveDialog(state.mainWindow, {
            defaultPath: savePath
        });
        if (result.canceled) {
            return; // Download cancelled by user
        }
        savePath = result.filePath;
    }

    const id = `dl-${randomUUID()}`;
    const downloadData = {
        id,
        url: item.getURL(),
        filename: path.basename(savePath),
        path: savePath,
        totalBytes: item.getTotalBytes(),
        receivedBytes: 0,
        startTime: Date.now(),
        speed: 0,
        state: 'progressing', // progressing, completed, cancelled, interrupted, paused
        isMultiConnection: false,
    };
    
    state.downloads.set(id, downloadData);

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('download:started', downloadData);
    }

    item.setSavePath(savePath);
    activeDownloadItems.set(id, item);

    item.on('updated', (_, state) => {
        const now = Date.now();
        const dl = state.downloads.get(id);
        if (!dl) return;

        const elapsedTime = (now - dl.startTime) / 1000;
        dl.receivedBytes = item.getReceivedBytes();
        dl.speed = elapsedTime > 0 ? dl.receivedBytes / elapsedTime : 0;
        
        throttledSendUpdate({
            id,
            receivedBytes: dl.receivedBytes,
            speed: dl.speed,
            state: item.getState(),
        });
    });

    item.on('done', (_, itemState) => {
        const dl = state.downloads.get(id);
        if (!dl) return;

        dl.state = itemState;
        dl.receivedBytes = item.getReceivedBytes(); // Final update
        dl.totalBytes = item.getReceivedBytes(); // Ensure total is accurate on completion
        
        sendUpdate({
            id,
            state: dl.state,
            receivedBytes: dl.receivedBytes,
            totalBytes: dl.totalBytes
        });

        activeDownloadItems.delete(id);
        debouncedSaveDownloads();
    });
}

// --- Public Control Functions ---

function pause(id) {
    const item = activeDownloadItems.get(id);
    if (item && item.pause) {
        item.pause();
    }
}

function resume(id) {
    const item = activeDownloadItems.get(id);
    if (item && item.resume) {
        item.resume();
    }
}

function cancel(id) {
    const item = activeDownloadItems.get(id);
    if (item && item.cancel) {
        item.cancel();
    }
}

function openFile(id) {
    const dl = state.downloads.get(id);
    if (dl && dl.path && dl.state === 'completed') {
        shell.openPath(dl.path).catch(err => console.error(`Failed to open file ${dl.path}:`, err));
    }
}

function showInFolder(id) {
    const dl = state.downloads.get(id);
    if (dl && dl.path) {
        shell.showItemInFolder(dl.path);
    }
}

function remove(id) {
    state.downloads.delete(id);
    debouncedSaveDownloads();
}

function clearAll() {
    const downloadsToRemove = [];
    for (const [id, dl] of state.downloads.entries()) {
        if (dl.state !== 'progressing' && dl.state !== 'paused') {
            downloadsToRemove.push(id);
        }
    }
    downloadsToRemove.forEach(id => state.downloads.delete(id));
    debouncedSaveDownloads();
}

module.exports = {
    initialize,
    saveDownloads,
    loadDownloads,
    pause,
    resume,
    cancel,
    openFile,
    showInFolder,
    remove,
    clearAll,
};
