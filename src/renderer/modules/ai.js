// --- AI Assistant Module ---

const panel = document.getElementById('ai-panel');
const resizeHandle = document.getElementById('ai-panel-resize-handle');
const closeBtn = document.getElementById('ai-panel-close-btn');
const chatContainer = document.getElementById('ai-chat-container');
const welcomeScreen = document.getElementById('ai-welcome-screen');
const messagesContainer = document.getElementById('ai-panel-messages');
const input = document.getElementById('ai-panel-input');
const sendBtn = document.getElementById('ai-panel-send-btn');
const startersContainer = document.querySelector('.ai-panel-starters');

let currentTabId = null;
let currentAIMessageElement = null;
let currentAIResponseText = '';
let isAwaitingResponse = false;

function formatAndAppendMessage(text, sender, elementToUpdate = null) {
    if (!welcomeScreen.classList.contains('hidden')) {
        welcomeScreen.classList.add('hidden');
    }

    // Sanitize text to prevent HTML injection
    const sanitizedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Convert markdown-like syntax to HTML
    let formattedHtml = sanitizedText
        // Code blocks ```lang\ncode```
        .replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = lang || 'plaintext';
            return `<div class="code-block-wrapper">
                        <div class="code-block-header">
                            <span>${language}</span>
                            <button class="copy-code-btn" title="Copy code"><i class="fa-regular fa-copy"></i> Copy</button>
                        </div>
                        <pre><code class="language-${language}">${code.trim()}</code></pre>
                    </div>`;
        })
        // Bold **text**
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic *text*
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Newlines to <br>
        .replace(/\n/g, '<br>');

    if (elementToUpdate) {
        elementToUpdate.innerHTML = formattedHtml;
        return elementToUpdate;
    }

    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('ai-message-wrapper', `ai-message-wrapper-${sender}`);

    const avatar = document.createElement('div');
    avatar.classList.add('ai-avatar');
    avatar.innerHTML = sender === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

    const messageEl = document.createElement('div');
    messageEl.classList.add('ai-message', `ai-message-${sender}`);
    messageEl.innerHTML = formattedHtml;
    
    messageWrapper.append(avatar, messageEl);
    messagesContainer.appendChild(messageWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageEl;
}


export async function showAIPanel(tabId) {
    const settings = await window.electronAPI.getSettings();
    const panelWidth = settings?.ai?.panelWidth || 350;

    currentTabId = tabId;
    welcomeScreen.classList.remove('hidden');
    messagesContainer.innerHTML = '';
    
    panel.style.width = `${panelWidth}px`;
    document.documentElement.style.setProperty('--ai-panel-width', `${panelWidth}px`);

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

    formatAndAppendMessage(prompt, 'user');
    input.value = '';
    input.style.height = 'auto'; // Reset height
    input.disabled = true;
    sendBtn.disabled = true;
    isAwaitingResponse = true;
    currentAIResponseText = '';

    // Create the assistant's message structure for streaming
    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('ai-message-wrapper', 'ai-message-wrapper-assistant');

    const avatar = document.createElement('div');
    avatar.classList.add('ai-avatar');
    avatar.innerHTML = '<i class="fa-solid fa-robot"></i>';

    currentAIMessageElement = document.createElement('div');
    currentAIMessageElement.classList.add('ai-message', 'ai-message-assistant');
    // Use a typing indicator instead of a spinner
    currentAIMessageElement.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;

    messageWrapper.append(avatar, currentAIMessageElement);
    messagesContainer.appendChild(messageWrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    window.electronAPI.aiChatStream({ tabId: currentTabId, prompt });
}

function handleStreamChunk(chunk) {
    if (!currentAIMessageElement) return;

    // Replace typing indicator with first text chunk
    if (currentAIMessageElement.querySelector('.typing-indicator')) {
        currentAIMessageElement.innerHTML = '';
    }

    if (chunk.text) {
        currentAIResponseText += chunk.text;
        // Just append raw text during stream for performance. We'll format it once at the end.
        currentAIMessageElement.textContent = currentAIResponseText; 
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    if (chunk.error) {
        currentAIMessageElement.innerHTML = `<div class="ai-error"><strong>Error:</strong> ${chunk.error}</div>`;
        isAwaitingResponse = false;
        input.disabled = false;
        sendBtn.disabled = false;
    }

    if (chunk.done) {
        // Now that the stream is complete, format the full response
        formatAndAppendMessage(currentAIResponseText, 'assistant', currentAIMessageElement);
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
        const scrollHeight = input.scrollHeight;
        input.style.height = `${scrollHeight}px`;
    });

    startersContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const prompt = e.target.dataset.prompt;
            input.value = prompt;
            handleSendMessage();
        }
    });

    // Code block copy functionality
    messagesContainer.addEventListener('click', (e) => {
        const copyBtn = e.target.closest('.copy-code-btn');
        if (copyBtn) {
            const codeEl = copyBtn.closest('.code-block-wrapper').querySelector('code');
            if (codeEl) {
                navigator.clipboard.writeText(codeEl.textContent).then(() => {
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
                    }, 2000);
                });
            }
        }
    });

    // --- Panel Resizing Logic ---
    const throttledUpdate = throttle((width) => {
        window.electronAPI.settingsSetAI({ panelWidth: width });
    }, 16); // ~60fps for smoother BrowserView resize

    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.body.classList.add('resizing');

        const startX = e.clientX;
        const startWidth = panel.offsetWidth;

        const doDrag = (moveEvent) => {
            const newWidth = startWidth - (moveEvent.clientX - startX);
            const clampedWidth = Math.max(250, Math.min(newWidth, 800));
            panel.style.width = `${clampedWidth}px`;
            document.documentElement.style.setProperty('--ai-panel-width', `${clampedWidth}px`);
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