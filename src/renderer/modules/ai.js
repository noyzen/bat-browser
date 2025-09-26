// --- AI Assistant Module ---

const panel = document.getElementById('ai-panel');
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

export function showAIPanel(tabId) {
    currentTabId = tabId;
    messagesContainer.innerHTML = '<p class="ai-welcome-message">Ask me anything about this page!</p>';
    panel.classList.remove('hidden');
    input.focus();
    window.electronAPI.settingsSetAI({ panelOpen: true });
}

export function hideAIPanel() {
    panel.classList.add('hidden');
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

    currentAIMessageElement = appendMessage('<i class="fa-solid fa-spinner fa-spin"></i>', 'assistant');

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

    window.electronAPI.onAIChatStreamChunk(handleStreamChunk);
}