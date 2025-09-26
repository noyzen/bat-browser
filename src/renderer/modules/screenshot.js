import * as DOM from './dom.js';

let getStateCallback;
let currentCapture = null; // To hold the data URL of the latest capture

export function initScreenshot(callbacks) {
    getStateCallback = callbacks.getState;

    // --- IPC Listeners for Full Page Capture Progress ---
    window.electronAPI.onScreenshotStart(({ tabId }) => {
        DOM.screenshotProgressBarValue.style.width = '0%';
        DOM.screenshotProgressPercent.textContent = '0%';
        DOM.screenshotProgressOverlay.classList.remove('hidden');

        const cancelHandler = () => window.electronAPI.cancelScreenshot(tabId);
        DOM.screenshotCancelBtn.addEventListener('click', cancelHandler, { once: true });
        DOM.screenshotCancelBtn.handler = cancelHandler;
    });

    window.electronAPI.onScreenshotProgress(({ percent }) => {
        DOM.screenshotProgressBarValue.style.width = `${percent}%`;
        DOM.screenshotProgressPercent.textContent = `${percent}%`;
    });

    window.electronAPI.onScreenshotEnd(({ result }) => {
        if (DOM.screenshotCancelBtn.handler) {
            DOM.screenshotCancelBtn.removeEventListener('click', DOM.screenshotCancelBtn.handler);
            delete DOM.screenshotCancelBtn.handler;
        }

        setTimeout(() => {
            DOM.screenshotProgressOverlay.classList.add('hidden');
            if (result.success && result.dataUrl) {
                showPreview(result.dataUrl);
            } else if (!result.success && result.message) {
                console.error('Screenshot failed or cancelled:', result.message);
                // Optionally show a notification to the user
            }
        }, 300);
    });

    // --- Preview Window Listeners ---
    DOM.screenshotSaveBtn.addEventListener('click', saveCapture);
    DOM.screenshotCopyBtn.addEventListener('click', copyCapture);
    DOM.screenshotDiscardBtn.addEventListener('click', discardCapture);
}

// --- Capture Functions ---
export async function captureVisible() {
    const result = await window.electronAPI.captureVisible();
    if (result.success) {
        showPreview(result.dataUrl);
    } else {
        console.error('Capture visible area failed:', result.message);
    }
}

export async function captureFullPage() {
    const state = getStateCallback();
    if (state.activeTabId) {
        window.electronAPI.captureFull(state.activeTabId);
    }
}

export function startAreaSelection() {
    const overlay = DOM.screenshotSelectionOverlay;
    overlay.classList.remove('hidden');
    
    const infoBox = DOM.screenshotSelectionInfo;
    let startX, startY, endX, endY;
    let isDrawing = false;
    let selectionBox = null;

    const onMouseDown = (e) => {
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
        infoBox.style.opacity = '0'; // Hide info box while drawing

        selectionBox = document.createElement('div');
        selectionBox.style.position = 'fixed';
        selectionBox.style.border = '2px dashed var(--accent-color)';
        selectionBox.style.backgroundColor = 'rgba(14, 99, 156, 0.2)';
        selectionBox.style.zIndex = '10001';
        document.body.appendChild(selectionBox);
    };

    const onMouseMove = (e) => {
        if (!isDrawing) return;
        endX = e.clientX;
        endY = e.clientY;

        const left = Math.min(startX, endX);
        const top = Math.min(startY, endY);
        const width = Math.abs(endX - startX);
        const height = Math.abs(endY - startY);

        selectionBox.style.left = `${left}px`;
        selectionBox.style.top = `${top}px`;
        selectionBox.style.width = `${width}px`;
        selectionBox.style.height = `${height}px`;
    };

    const onMouseUp = async (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        
        const rect = {
            x: Math.min(startX, endX),
            y: Math.min(startY, endY),
            width: Math.abs(endX - startX),
            height: Math.abs(endY - startY)
        };
        
        cleanup();

        // Only capture if the selection has a meaningful size
        if (rect.width > 5 && rect.height > 5) {
            const result = await window.electronAPI.captureRect(rect);
            if (result.success) {
                showPreview(result.dataUrl);
            } else {
                console.error('Capture area failed:', result.message);
            }
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            cleanup();
        }
    };
    
    const cleanup = () => {
        overlay.classList.add('hidden');
        infoBox.style.opacity = '1';
        if (selectionBox) selectionBox.remove();
        window.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('keydown', onKeyDown);
    };

    window.addEventListener('mousedown', onMouseDown, { once: true });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp, { once: true });
    window.addEventListener('keydown', onKeyDown, { once: true });
}


// --- Preview Functions ---
function showPreview(dataUrl) {
    currentCapture = dataUrl;
    DOM.screenshotPreviewImage.src = dataUrl;
    DOM.screenshotPreviewOverlay.classList.remove('hidden');

    DOM.screenshotPreviewImage.onload = () => {
        const { naturalWidth, naturalHeight } = DOM.screenshotPreviewImage;
        DOM.screenshotDimensions.textContent = `${naturalWidth} x ${naturalHeight}`;

        window.electronAPI.getSettings().then(settings => {
            const format = settings.screenshotFormat || 'png';
            DOM.screenshotFilename.textContent = `screenshot-${Date.now()}.${format}`;
        });
    };
}

async function saveCapture() {
    if (!currentCapture) return;
    const result = await window.electronAPI.saveScreenshot(currentCapture);
    if (result.success) {
        discardCapture();
    } else {
        console.error('Failed to save:', result.message);
    }
}

async function copyCapture() {
    if (!currentCapture) return;
    const result = await window.electronAPI.copyScreenshot(currentCapture);
    if (result.success) {
        // Maybe show a "Copied!" confirmation
        discardCapture();
    } else {
        console.error('Failed to copy:', result.message);
    }
}

function discardCapture() {
    DOM.screenshotPreviewOverlay.classList.add('hidden');
    DOM.screenshotPreviewImage.src = '';
    currentCapture = null;
}