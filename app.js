
// Define global functions immediately for onclick handlers
window.toggleDropdown = function () {
    console.log('toggleDropdown called');
    const dropdown = document.getElementById('titleDropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
        console.log('Dropdown toggled, open:', dropdown.classList.contains('open'));
    } else {
        console.error('titleDropdown element not found');
    }
};

window.selectOption = function (value, text) {
    console.log('selectOption called with:', value, text);

    const titleText = document.getElementById('titleText');
    const dropdown = document.getElementById('titleDropdown');

    if (titleText && dropdown) {
        titleText.textContent = text;
        dropdown.classList.remove('open');

        // Update selected model
        selectedModel = value;
        console.log('Model changed to:', value, WORKFLOWS[value]);
        console.log('About to call updateDropdownOptionStates with:', value);

        // Update dropdown option states
        updateDropdownOptionStates(value);

        // Update submit button state for new mode
        updateSubmitButtonState();

        // If changing model, create a new chat with the new model
        if (currentChatId && chatHistory) {
            console.log('Looking for current chat:', currentChatId);
            const currentChat = chatHistory.find(c => c.id === currentChatId);
            if (currentChat) {
                const hasUserMessages = currentChat.messages && currentChat.messages.some(msg => msg.role === 'user');

                if (!hasUserMessages) {
                    // No user messages yet, safe to replace with new chat
                    console.log('No user messages found, creating new chat with model:', value);

                    // Remove the current chat
                    chatHistory = chatHistory.filter(chat => chat.id !== currentChatId);

                    // Create new chat with the selected model
                    createNewChat();
                } else {
                    // User has sent messages, just update the model for future messages
                    console.log('User messages found, updating model for future messages only');
                    currentChat.selectedModel = value;
                    saveChatHistory();
                }
            }
        }

        console.log('Option selected successfully');
    } else {
        console.error('titleDropdown elements not found:', {
            titleText: !!titleText,
            dropdown: !!dropdown
        });
    }
};

window.cancelDelete = function () {
    console.log('cancelDelete called');
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.classList.remove('show');
    }
};

window.confirmDelete = async function () {
    console.log('confirmDelete called, chatToDelete:', chatToDelete);
    if (!chatToDelete) return;

    console.log('Deleting chat:', chatToDelete);
    await deleteChatFromBackend(chatToDelete);

    console.log('Filtering chat history, before:', chatHistory.length);
    chatHistory = chatHistory.filter(chat => chat.id !== chatToDelete);
    console.log('After filtering:', chatHistory.length);

    if (currentChatId === chatToDelete) {
        console.log('Deleted chat was current, switching to another chat');
        const sessionChats = chatHistory.filter(c => c.sessionId === currentSessionId);
        if (sessionChats.length > 0) {
            loadChat(sessionChats[0].id);
        } else if (chatHistory.length > 0) {
            loadChat(chatHistory[0].id);
        } else {
            createNewChat();
        }
    }

    saveChatToLocalStorage();
    renderChatHistory();

    logSessionActivity('chat_deleted', {
        chatId: chatToDelete
    });

    console.log('Delete completed successfully');
    cancelDelete();
};

// Configuration - Multiple Workflows
const WORKFLOWS = {
    clanker5000: {
        alias: 'paidMediaStart',
        startName: 'Start Clanker 5000 conversation',
        modelId: 'clanker-5000-model-id',
        displayName: 'Clanker 5000'
    },
    clanker5000Deep: {
        alias: 'paidMediaStartDeep',
        startName: 'Start Clanker 5000 Deep Research',
        modelId: 'clanker-5000-deep-model-id',
        displayName: 'Clanker 5000 Deep Research'
    }
};

const COLLECTION_ALIAS = 'Paid Media Insight & Generation';
const USER_CHATS_COLLECTION = 'paidSearchUserChats';
const POLL_MS = 2000;
const MAX_TRIES = 90;

// State Management
const $ = id => {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with ID '${id}' not found`);
    }
    return element;
};
let currentChatId = null;
let currentSessionId = null;
let chatHistory = [];
let currentMessages = [];
let activeRequests = {};
let chatToDelete = null;
let selectedModel = 'clanker5000'; // Default to Clanker 5000

// Session Management Functions
function generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getSessionId() {
    let sessionId = sessionStorage.getItem('paidMediaSessionId');
    if (!sessionId) {
        sessionId = generateSessionId();
        sessionStorage.setItem('paidMediaSessionId', sessionId);
    }
    return sessionId;
}


// Initialize App
async function initializeApp() {
    console.log('Initializing app...');
    console.log('Initial selectedModel:', selectedModel);

    currentSessionId = getSessionId();

    await loadChatHistory();
    console.log('Chat history loaded, length:', chatHistory.length);

    // Initialize model dropdown
    console.log('Initializing dropdown with selectedModel:', selectedModel);
    updateModelDropdown(selectedModel);

    // Create a new chat if none exist
    if (chatHistory.length === 0) {
        console.log('No chat history, creating new chat');
        createNewChat();
    } else {
        // Load the most recent chat
        console.log('Loading most recent chat:', chatHistory[0].id, 'with model:', chatHistory[0].selectedModel);
        loadChat(chatHistory[0].id);
    }
}


// Storage Functions  
function saveChatToLocalStorage() {
    localStorage.setItem('paidMediaChatHistory', JSON.stringify(chatHistory));
}

function loadChatFromLocalStorage() {
    const saved = localStorage.getItem('paidMediaChatHistory');
    if (saved) {
        chatHistory = JSON.parse(saved);
        return true;
    }
    return false;
}

// Save chat to backend
async function saveChatToBackend(chat) {
    try {
        const url = `/domo/datastores/v2/collections/${USER_CHATS_COLLECTION}/documents/`;

        // Extract prompts and responses from messages
        const prompts = [];
        const responses = [];

        chat.messages.forEach((msg, index) => {
            if (msg.role === 'user') {
                prompts.push({
                    text: msg.text,
                    timestamp: msg.time,
                    index: index
                });
            } else if (msg.role === 'bot') {
                responses.push({
                    text: msg.text,
                    timestamp: msg.time,
                    index: index,
                    promptContext: msg.promptContext || null
                });
            }
        });

        const document = {
            content: {
                sessionId: chat.sessionId,
                chatId: chat.id,
                title: chat.title,
                date: chat.date,
                prompts: prompts,
                responses: responses,
                messages: chat.messages,
                metadata: chat.metadata,
                hasUnread: chat.hasUnread || false,
                lastActivity: chat.lastActivity || chat.date,
                updatedAt: new Date().toISOString()
            }
        };

        const existingDoc = await getChatDocument(chat.id);

        if (existingDoc) {
            await fetch(`${url}${existingDoc.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(document)
            });
        } else {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(document)
            });
        }
    } catch (err) {
        console.error('Error saving chat to backend:', err);
        saveChatToLocalStorage();
    }
}

// Get specific chat document
async function getChatDocument(chatId) {
    try {
        const url = `/domo/datastores/v2/collections/${USER_CHATS_COLLECTION}/documents/query`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filter: {
                    'content.sessionId': currentSessionId,
                    'content.chatId': chatId
                }
            })
        });

        if (res.ok) {
            const docs = await res.json();
            return docs.length > 0 ? docs[0] : null;
        }
        return null;
    } catch (err) {
        console.error('Error getting chat document:', err);
        return null;
    }
}

// Load all session chats from backend
async function loadSessionChatsFromBackend() {
    try {
        const url = `/domo/datastores/v2/collections/${USER_CHATS_COLLECTION}/documents/query`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filter: { 'content.sessionId': currentSessionId },
                sort: { 'content.date': -1 }
            })
        });

        if (res.ok) {
            const docs = await res.json();
            chatHistory = docs.map(doc => ({
                id: doc.content.chatId,
                sessionId: doc.content.sessionId,
                title: doc.content.title,
                date: doc.content.date,
                messages: doc.content.messages || [],
                metadata: doc.content.metadata || {},
                hasUnread: doc.content.hasUnread || false,
                lastActivity: doc.content.lastActivity || doc.content.date
            }));

            console.log(`Loaded ${chatHistory.length} chats for session ${currentSessionId}`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('Error loading chats from backend:', err);
        return false;
    }
}

// Delete chat from backend
async function deleteChatFromBackend(chatId) {
    try {
        const doc = await getChatDocument(chatId);
        if (doc) {
            const url = `/domo/datastores/v2/collections/${USER_CHATS_COLLECTION}/documents/${doc.id}`;
            await fetch(url, { method: 'DELETE' });
        }
    } catch (err) {
        console.error('Error deleting chat from backend:', err);
    }
}

// Save/Load functions
async function saveChatHistory() {
    for (const chat of chatHistory) {
        await saveChatToBackend(chat);
    }
    saveChatToLocalStorage();
}

async function loadChatHistory() {
    const backendLoaded = await loadSessionChatsFromBackend();

    if (!backendLoaded) {
        loadChatFromLocalStorage();
    }

    chatHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    renderChatHistory();
}

// Create new chat
function createNewChat() {
    console.log('*** createNewChat function called ***');
    console.log('Current selectedModel:', selectedModel);
    const chatId = Date.now().toString();
    const workflow = WORKFLOWS[selectedModel];
    console.log('Creating new chat with ID:', chatId, 'and workflow:', selectedModel, 'Display name:', workflow?.displayName);
    const newChat = {
        id: chatId,
        sessionId: currentSessionId,
        title: 'New Chat',
        date: new Date().toISOString(),
        messages: [],
        selectedModel: selectedModel, // Remember which model this chat uses
        metadata: {
            userAgent: navigator.userAgent,
            timestamp: Date.now(),
            workflowType: selectedModel
        }
    };

    chatHistory.unshift(newChat);
    currentChatId = chatId;
    currentMessages = [];

    saveChatHistory();
    renderChatHistory();
    clearMessages();

    const welcomeMsg = `Hello! I'm your ${workflow.displayName} assistant. How can I help you today?`;
    console.log('Creating welcome message:', welcomeMsg);
    addMsg(welcomeMsg, 'bot', false);

    updateUIForCurrentChat();
}

// Mark chat as having unread messages
function markChatAsUnread(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (chat) {
        chat.hasUnread = true;
        renderChatHistory();
    }
}

// Load chat by ID
function loadChat(chatId) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (!chat) return;

    currentChatId = chatId;
    currentMessages = chat.messages;

    // Update selected model based on this chat's model
    const chatModel = chat.selectedModel || 'clanker5000'; // Default to clanker5000 if not set
    selectedModel = chatModel;
    console.log('Loading chat with model:', chatModel, 'Updating dropdown...');
    updateModelDropdown(chatModel);

    if (chat.hasUnread) {
        chat.hasUnread = false;
        saveChatHistory();
    }

    clearMessages();
    chat.messages.forEach(msg => {
        addMsg(msg.text, msg.role, false);
    });

    renderChatHistory();
    updateUIForCurrentChat();
}

// Update chat title based on first message
function updateChatTitle(chatId, firstMessage) {
    const chat = chatHistory.find(c => c.id === chatId);
    if (chat && chat.title === 'New Chat') {
        chat.title = firstMessage.substring(0, 50) + (firstMessage.length > 50 ? '...' : '');
        saveChatHistory();
        renderChatHistory();
    }
}

// Render chat history in sidebar
function renderChatHistory() {
    const historyEl = $('chatHistory');
    historyEl.innerHTML = '';

    const chatsBySession = {};
    chatHistory.forEach(chat => {
        const sessionId = chat.sessionId || 'legacy';
        if (!chatsBySession[sessionId]) {
            chatsBySession[sessionId] = [];
        }
        chatsBySession[sessionId].push(chat);
    });

    if (chatsBySession[currentSessionId]) {
        const sessionHeader = document.createElement('div');
        sessionHeader.className = 'session-header';
        sessionHeader.innerHTML = '<span>Current Session</span>';
        historyEl.appendChild(sessionHeader);

        chatsBySession[currentSessionId].forEach(chat => {
            renderChatItem(chat, historyEl);
        });
    }

    Object.keys(chatsBySession).forEach(sessionId => {
        if (sessionId === currentSessionId || sessionId === 'legacy') return;

        const sessionChats = chatsBySession[sessionId];
        const sessionDate = new Date(sessionChats[0].date);
        const sessionLabel = sessionDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });

        const sessionHeader = document.createElement('div');
        sessionHeader.className = 'session-header';
        sessionHeader.innerHTML = `<span>Session - ${sessionLabel}</span>`;
        historyEl.appendChild(sessionHeader);

        sessionChats.forEach(chat => {
            renderChatItem(chat, historyEl);
        });
    });

    if (chatsBySession.legacy) {
        const sessionHeader = document.createElement('div');
        sessionHeader.className = 'session-header';
        sessionHeader.innerHTML = '<span>Previous Chats</span>';
        historyEl.appendChild(sessionHeader);

        chatsBySession.legacy.forEach(chat => {
            renderChatItem(chat, historyEl);
        });
    }
}

// Render individual chat item
function renderChatItem(chat, container) {
    const item = document.createElement('div');
    item.className = `chat-history-item ${chat.id === currentChatId ? 'active' : ''} ${chat.hasUnread ? 'unread' : ''}`;

    const date = new Date(chat.date);
    const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
    });

    item.innerHTML = `
        <div class="chat-history-title" onclick="loadChat('${chat.id}')">
            ${escapeHtml(chat.title)}
            ${chat.hasUnread ? '<span class="unread-indicator">•</span>' : ''}
        </div>
        <div class="chat-history-date" onclick="loadChat('${chat.id}')">${dateStr}</div>
        <button class="delete-chat-btn" onclick="event.stopPropagation(); showDeleteModal('${chat.id}')" title="Delete chat">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12M5 4V2.5C5 2.22386 5.22386 2 5.5 2h5c.27614 0 .5.22386.5.5V4m2 0v9.5c0 .27614-.22386.5-.5.5h-9c-.27614 0-.5-.22386-.5-.5V4h10zM6.5 7v4M9.5 7v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </button>
    `;

    container.appendChild(item);
}

// Clear messages display
function clearMessages() {
    const wrap = $('messages');
    wrap.innerHTML = '';
}

// Format time for messages
function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

// Add message to a specific chat with prompt/response tracking
function addMsgToChat(text, role, chatId, save = true, promptContext = null) {
    const wrap = $('messages');

    if (currentChatId === chatId) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;

        if (role === 'bot') {
            messageDiv.innerHTML = `
                <div class="message-avatar">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" fill="#1B8CE3"/>
                        <path d="M12 6v6l4 2" stroke="white" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="message-content">
                    <div class="message-text">${escapeHtml(text)}</div>
                    <div class="message-time">${formatTime()}</div>
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-text">${escapeHtml(text)}</div>
                    <div class="message-time">${formatTime()}</div>
                </div>
            `;
        }

        wrap.appendChild(messageDiv);

        if (role === 'bot') {
            hideTypingForChat(chatId);
        }

        requestAnimationFrame(() => {
            wrap.scrollTo({
                top: wrap.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    if (save && chatId) {
        const chat = chatHistory.find(c => c.id === chatId);
        if (chat) {
            const messageData = {
                text,
                role,
                time: new Date().toISOString(),
                sessionId: currentSessionId
            };

            if (role === 'bot' && promptContext) {
                messageData.promptContext = promptContext;
            }

            chat.messages.push(messageData);

            if (role === 'user' && chat.messages.filter(m => m.role === 'user').length === 1) {
                updateChatTitle(chatId, text);
            }

            chat.lastActivity = new Date().toISOString();

            saveChatToBackend(chat);

            if (currentChatId !== chatId && role === 'bot') {
                markChatAsUnread(chatId);
            }
        }
    }
}

// Keep the original addMsg function for backward compatibility
function addMsg(text, role, save = true) {
    addMsgToChat(text, role, currentChatId, save);
}

// Escape HTML to prevent XSS while preserving text
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Show/hide typing indicator for specific chat
function showTypingForChat(chatId) {
    if (currentChatId === chatId) {
        const indicator = $('typingIndicator');
        indicator.classList.add('show');

        const wrap = $('messages');
        requestAnimationFrame(() => {
            wrap.scrollTo({
                top: wrap.scrollHeight + 100,
                behavior: 'smooth'
            });
        });
    }
}

function hideTypingForChat(chatId) {
    if (currentChatId === chatId) {
        $('typingIndicator').classList.remove('show');
    }
}

// Update UI based on current chat state - FIXED VERSION
function updateUIForCurrentChat() {
    const submitBtn = $('submitBtn');

    if (!submitBtn) return;

    const isLoading = activeRequests[currentChatId] || false;

    if (isLoading) {
        submitBtn.classList.add('loading');
        showTypingForChat(currentChatId);
    } else {
        submitBtn.classList.remove('loading');
        hideTypingForChat(currentChatId);
    }

    // Update submit button state using the centralized function
    updateSubmitButtonState();
}

// Error handling
function showErr(msg) {
    const errorEl = $('errorMessage');
    errorEl.textContent = msg;
    errorEl.classList.add('show');

    setTimeout(() => {
        errorEl.classList.remove('show');
    }, 5000);
}

function hideErr() {
    $('errorMessage').classList.remove('show');
}

// WORKFLOW INTEGRATION

// Start the workflow with conversation history
async function startFlow(question, chatId) {
    try {
        const chat = chatHistory.find(c => c.id === chatId);
        let conversationHistory = [];

        // Get the workflow configuration for this chat
        const chatModel = chat?.selectedModel || selectedModel || 'clanker5000';
        const workflow = WORKFLOWS[chatModel];

        console.log('Using workflow:', chatModel, workflow);

        if (chat && chat.messages.length > 0) {
            // Get all messages from the current chat
            conversationHistory = chat.messages.map(msg => ({
                role: msg.role,
                content: msg.text,
                timestamp: msg.time
            }));
        }

        // Build the context string with conversation history (excluding current question)
        let contextString = "";
        if (conversationHistory.length > 0) {
            contextString = "Previous conversation:\n\n";
            conversationHistory.forEach(msg => {
                contextString += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n\n`;
            });
            contextString += `Current question: ${question}`;
        } else {
            // If no previous conversation, just send the question
            contextString = question;
        }

        // Ensure we have a valid string value
        if (!contextString || contextString.trim() === '') {
            contextString = question || `Hello, I need help with ${workflow.displayName.toLowerCase()}.`;
        }

        const payload = {
            "start": contextString.trim()  // Use aliasedName from manifest
        };

        console.log(`Sending request to ${workflow.displayName}:`, payload);
        console.log('Question received:', question);
        console.log('Context string length:', contextString.length);
        console.log('Full workflow config:', workflow);

        // Extra validation to be absolutely sure
        if (!payload.start || typeof payload.start !== 'string' || payload.start.trim().length === 0) {
            console.error('PAYLOAD VALIDATION FAILED!', payload);
            payload.start = `Hello, I need help with ${workflow.displayName.toLowerCase()}.`;
            console.log('Fixed payload:', payload);
        }

        // Try multiple URL formats that have worked before
        let res;

        // Format 1: Try with workflows (plural) instead of workflow
        console.log('Trying URL format 1 (workflows plural):', `/domo/workflows/v1/models/${workflow.alias}/start`);
        try {
            res = await fetch(`/domo/workflows/v1/models/${workflow.alias}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log('Format 1 response status:', res.status);
            if (res.ok) {
                const json = await res.json();
                return json.id;
            }
        } catch (error) {
            console.log('Format 1 failed:', error.message);
        }

        // Format 2: Try original format with alias
        console.log('Trying URL format 2 (original):', `/domo/workflow/v1/models/${workflow.alias}/start`);
        try {
            res = await fetch(`/domo/workflow/v1/models/${workflow.alias}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log('Format 2 response status:', res.status);
            if (res.ok) {
                const json = await res.json();
                return json.id;
            }
        } catch (error) {
            console.log('Format 2 failed:', error.message);
        }

        // Format 3: Try with direct model ID in workflows format
        console.log('Trying URL format 3 (workflows + modelId):', `/domo/workflows/v1/models/${workflow.modelId}/start`);
        try {
            res = await fetch(`/domo/workflows/v1/models/${workflow.modelId}/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            console.log('Format 3 response status:', res.status);
            if (res.ok) {
                const json = await res.json();
                return json.id;
            }
        } catch (error) {
            console.log('Format 3 failed:', error.message);
        }

        // If all formats failed, throw error
        const errorText = res ? await res.text() : 'No successful response';
        console.error('All workflow URL formats failed. Last response:', res?.status, errorText);
        throw new Error(`Failed to start ${workflow.displayName} workflow. All URL formats returned 404. Workflows may not be deployed or active.`);
    } catch (err) {
        console.error('Error starting workflow:', err);
        throw err;
    }
}

// Fetch all documents from collection
async function fetchAllDocs() {
    const url = `/domo/datastores/v2/collections/${COLLECTION_ALIAS}/documents/`;
    const res = await fetch(url, { method: 'GET' });

    if (!res.ok) {
        throw new Error('Failed to fetch documents');
    }

    return await res.json();
}

// Poll for result - now accepts target chat ID
async function pollForResult(instanceId, targetChatId) {
    for (let i = 0; i < MAX_TRIES; i++) {
        const docs = await fetchAllDocs();
        const hit = docs.find(d => d.content?.instanceId === instanceId);

        if (hit) {
            return hit.content.promptResult;
        }

        if (currentChatId === targetChatId && i % 5 === 0) {
            console.log(`Still waiting for response... (${i * POLL_MS / 1000}s)`);
        }

        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }

    throw new Error('Request timed out. Please try again.');
}

// MAIN SEND MESSAGE FUNCTION
async function sendMsg() {
    const chatInput = $('chatInput');
    const submitBtn = $('submitBtn');
    const text = chatInput.value.trim();

    if (!text || activeRequests[currentChatId]) return;

    const messageChatId = currentChatId;

    console.log('Sending message in chat:', messageChatId, 'Message:', text);

    activeRequests[messageChatId] = true;
    hideErr();

    addMsgToChat(text, 'user', messageChatId);

    chatInput.value = '';
    autoResizeTextarea(chatInput);  // Reset height
    chatInput.focus();
    updateUIForCurrentChat();

    showTypingForChat(messageChatId);

    const promptData = {
        prompt: text,
        chatId: messageChatId,
        timestamp: new Date().toISOString()
    };

    try {
        const instanceId = await startFlow(text, messageChatId);
        console.log('Workflow started with ID:', instanceId, 'for chat:', messageChatId);

        const answer = await pollForResult(instanceId, messageChatId);
        console.log('Received answer for chat:', messageChatId, 'Answer:', answer);

        hideTypingForChat(messageChatId);

        const responseData = {
            ...promptData,
            response: answer,
            responseTime: new Date().toISOString(),
            workflowInstanceId: instanceId
        };

        addMsgToChat(answer, 'bot', messageChatId, true, responseData);

        logSessionActivity('message_sent', {
            chatId: messageChatId,
            messageLength: text.length,
            responseLength: answer.length
        });

    } catch (err) {
        console.error('Chat error for chat:', messageChatId, err);

        if (currentChatId === messageChatId) {
            hideTypingForChat(messageChatId);
            showErr(err.message || 'Something went wrong. Please try again.');
        }

        logSessionActivity('error', {
            chatId: messageChatId,
            error: err.message,
            prompt: text
        });
    } finally {
        delete activeRequests[messageChatId];

        if (currentChatId === messageChatId) {
            updateUIForCurrentChat();
        }
    }
}

// Log session activity
function logSessionActivity(action, data = {}) {
    const activity = {
        sessionId: currentSessionId,
        action,
        timestamp: new Date().toISOString(),
        ...data
    };

    let sessionActivities = JSON.parse(localStorage.getItem('paidMediaSessionActivities') || '[]');
    sessionActivities.push(activity);

    if (sessionActivities.length > 1000) {
        sessionActivities = sessionActivities.slice(-1000);
    }

    localStorage.setItem('paidMediaSessionActivities', JSON.stringify(sessionActivities));
}

// EVENT HANDLERS

// Handle Enter key
function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey && !activeRequests[currentChatId]) {
        e.preventDefault();
        sendMsg();
    }
}

// Auto-resize textarea
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// Update submit button state based on current mode and inputs
function updateSubmitButtonState() {
    const submitBtn = $('submitBtn');
    const chatInput = $('chatInput');

    if (!submitBtn || !chatInput) return;

    const hasText = chatInput.value.trim().length > 0;
    const isLoading = activeRequests[currentChatId] || false;

    // For all models: enable only if has text and not loading
    submitBtn.disabled = !hasText || isLoading;
}

function updateDropdownOptionStates(selectedValue) {
    console.log('updateDropdownOptionStates called with:', selectedValue);
    const options = document.querySelectorAll('.title-option');
    console.log('Found options:', options.length);
    options.forEach(option => {
        const optionValue = option.dataset.value;
        console.log('Checking option:', optionValue, 'against selected:', selectedValue);
        if (optionValue === selectedValue) {
            option.classList.add('selected');
            console.log('Added selected class to:', optionValue);
        } else {
            option.classList.remove('selected');
            console.log('Removed selected class from:', optionValue);
        }
    });
}

function updateModelDropdown(modelKey) {
    console.log('updateModelDropdown called with:', modelKey);
    const workflow = WORKFLOWS[modelKey];
    if (workflow) {
        console.log('Found workflow:', workflow.displayName);
        const titleText = $('titleText');
        if (titleText) {
            console.log('Updating title text to:', workflow.displayName);
            titleText.textContent = workflow.displayName;
        } else {
            console.error('titleText element not found!');
        }
        updateDropdownOptionStates(modelKey);
        updateSubmitButtonState();
    } else {
        console.error('No workflow found for key:', modelKey);
    }
}

// Close dropdown when clicking outside
function closeDropdownOnOutsideClick(event) {
    const dropdown = $('titleDropdown');
    if (dropdown && !dropdown.contains(event.target)) {
        dropdown.classList.remove('open');
    }
}

// Toggle sidebar on mobile
function toggleSidebar() {
    const sidebar = $('sidebar');
    sidebar.classList.toggle('open');
}

// Close sidebar on mobile
function closeSidebar() {
    const sidebar = $('sidebar');
    sidebar.classList.remove('open');
}


// Delete chat functions
function showDeleteModal(chatId) {
    chatToDelete = chatId;
    $('deleteModal').classList.add('show');
}

function cancelDelete() {
    chatToDelete = null;
    $('deleteModal').classList.remove('show');
}

async function confirmDelete() {
    if (!chatToDelete) return;

    await deleteChatFromBackend(chatToDelete);

    chatHistory = chatHistory.filter(chat => chat.id !== chatToDelete);

    if (currentChatId === chatToDelete) {
        const sessionChats = chatHistory.filter(c => c.sessionId === currentSessionId);
        if (sessionChats.length > 0) {
            loadChat(sessionChats[0].id);
        } else if (chatHistory.length > 0) {
            loadChat(chatHistory[0].id);
        } else {
            createNewChat();
        }
    }

    saveChatToLocalStorage();
    renderChatHistory();

    logSessionActivity('chat_deleted', {
        chatId: chatToDelete
    });

    cancelDelete();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing app with Domo user...');

    // Initialize app immediately (no login required)
    await initializeApp();

    const chatInput = $('chatInput');
    const submitBtn = $('submitBtn');

    // Only set up chat-related event listeners if elements exist
    if (chatInput && submitBtn) {
        // Event listeners
        chatInput.addEventListener('keydown', handleKeyPress);
        submitBtn.addEventListener('click', sendMsg);

        // Auto-resize textarea on input
        chatInput.addEventListener('input', () => {
            autoResizeTextarea(chatInput);
            updateSubmitButtonState();
        });

        // Initial button state
        updateSubmitButtonState();
    }

    // Set up other event listeners
    if ($('newChatBtn')) {
        $('newChatBtn').addEventListener('click', () => {
            createNewChat();
            logSessionActivity('new_chat_created', {
                chatId: currentChatId
            });
        });
    }

    if ($('menuToggle')) {
        $('menuToggle').addEventListener('click', toggleSidebar);
    }

    if ($('closeSidebar')) {
        $('closeSidebar').addEventListener('click', closeSidebar);
    }

    // Set up outside click listener for custom dropdown
    document.addEventListener('click', closeDropdownOnOutsideClick);

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        const sidebar = $('sidebar');
        const menuToggle = $('menuToggle');
        if (window.innerWidth <= 768 &&
            sidebar &&
            menuToggle &&
            !sidebar.contains(e.target) &&
            !menuToggle.contains(e.target) &&
            sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });

    // Log page unload
    window.addEventListener('beforeunload', () => {
        logSessionActivity('session_end', {
            duration: Date.now() - performance.timing.navigationStart,
            totalChats: chatHistory.filter(c => c.sessionId === currentSessionId).length
        });
    });
});

// Handle ESC key for modal and dropdown
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (chatToDelete) {
            cancelDelete();
        }
        // Close dropdown if open
        const dropdown = $('titleDropdown');
        if (dropdown && dropdown.classList.contains('open')) {
            dropdown.classList.remove('open');
        }
    }
});

// Set up delete modal event listener
const deleteModal = $('deleteModal');
if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
            cancelDelete();
        }
    });
}

// Handle window resize for mobile keyboard
let windowHeight = window.innerHeight;
window.addEventListener('resize', () => {
    const currentHeight = window.innerHeight;
    if (currentHeight < windowHeight * 0.75) {
        document.body.classList.add('keyboard-open');
    } else {
        document.body.classList.remove('keyboard-open');
    }
});