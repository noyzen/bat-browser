// --- AI Assistant Module ---

const panel = document.getElementById('ai-panel');
const resizeHandle = document.getElementById('ai-panel-resize-handle');
const closeBtn = document.getElementById('ai-panel-close-btn');
const messagesContainer = document.getElementById('ai-panel-messages');
const input = document.getElementById('ai-panel-input');
const sendBtn = document.getElementById('ai-panel-send-btn');
const startersContainer = document.querySelector('.ai-panel-starters');

let currentTabId = null;
let currentAIMessageElement = null;
let isAwaitingResponse = false;

function appendMessage(text, sender) {
    const messageEl = document.createElement('div');
    messageEl.classList.add('ai-message', `ai-message-${sender}`);
    
    // Basic markdown for **bold** and *italic*
    let sanitizedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    let formattedText = sanitizedText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

    messageEl.innerHTML = formattedText;
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageEl;
}

export async function showAIPanel(tabId) {
    const settings = await window.electronAPI.getSettings();
    const panelWidth = settings?.ai?.panelWidth || 350;

    currentTabId = tabId;
    messagesContainer.innerHTML = '<p class="ai-welcome-message">Ask me anything about this page!</p>';
    panel.style.width = `${panelWidth}px`;
    panel.classList.remove('hidden');
    resizeHandle.classList.remove('hidden');
    input.focus();
    window.electronAPI.settingsSetAI({ panelOpen: true });
}

export function hideAIPanel() {
    panel.classList.add('hidden');
    resizeHandle.classList.add('hidden');
    currentTabId = null;
    window.electronAPI.settingsSetAI({ panelOpen: false });
}

async function handleSendMessage() {
    const prompt = input.value.trim();
    if (!prompt || !currentTabId || isAwaitingResponse) return;

    appendMessage(prompt, 'user');
    input.value = '';
    input.style.height = 'auto'; // Reset height
    input.disabled = true;
    sendBtn.disabled = true;
    isAwaitingResponse = true;

    // Create the spinner element directly to avoid sanitizing the HTML
    currentAIMessageElement = document.createElement('div');
    currentAIMessageElement.classList.add('ai-message', 'ai-message-assistant');
    currentAIMessageElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    messagesContainer.appendChild(currentAIMessageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    window.electronAPI.aiChatStream({ tabId: currentTabId, prompt });
}

function handleStreamChunk(chunk) {
    if (!currentAIMessageElement) return;

    if (currentAIMessageElement.innerHTML.includes('fa-spinner')) {
        currentAIMessageElement.innerHTML = '';
    }

    if (chunk.text) {
        // Append text chunk by chunk. Sanitize and format as it comes.
         let sanitizedText = chunk.text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        let formattedText = sanitizedText
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        currentAIMessageElement.innerHTML += formattedText;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    if (chunk.error) {
        currentAIMessageElement.innerHTML = `<span class="ai-error">${chunk.error}</span>`;
        isAwaitingResponse = false;
        input.disabled = false;
        sendBtn.disabled = false;
    }

    if (chunk.done) {
        isAwaitingResponse = false;
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    }
}

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

export function initAI() {
    closeBtn.addEventListener('click', hideAIPanel);
    sendBtn.addEventListener('click', handleSendMessage);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${input.scrollHeight}px`;
    });

    startersContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const prompt = e.target.dataset.prompt;
            input.value = prompt;
            handleSendMessage();
        }
    });

    // --- Panel Resizing Logic ---
    const throttledUpdate = throttle((width) => {
        window.electronAPI.settingsSetAI({ panelWidth: width });
    }, 50); // Update main process ~20fps for smooth BrowserView resize

    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.classList.add('resizing');

        const startX = e.clientX;
        const startWidth = panel.offsetWidth;

        const doDrag = (moveEvent) => {
            const newWidth = startWidth - (moveEvent.clientX - startX);
            const clampedWidth = Math.max(250, Math.min(newWidth, 600));
            panel.style.width = `${clampedWidth}px`;
            throttledUpdate(clampedWidth);
        };

        const stopDrag = () => {
            document.body.classList.remove('resizing');
            window.removeEventListener('mousemove', doDrag);
            window.removeEventListener('mouseup', stopDrag);
            // Final save of the width
            window.electronAPI.settingsSetAI({ panelWidth: panel.offsetWidth, panelOpen: true });
        };

        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', stopDrag);
    });

    window.electronAPI.onAIChatStreamChunk(handleStreamChunk);
}