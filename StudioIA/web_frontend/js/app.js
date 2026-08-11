// StudioIA - Frontend JavaScript
// Gestione interfaccia utente e comunicazione con backend Python

class StudioIAApp {
    constructor() {
        this.currentConversation = null;
        this.selectedFileType = 'image';
        this.selectedFile = null;
        this.sidebarOpen = false;
        this.converterOpen = false;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.loadConversations();
        this.updateSupportedFormats();
    }
    
    bindEvents() {
        // Toggle Sidebar
        document.getElementById('toggleSidebarBtn').addEventListener('click', () => this.toggleSidebar());
        
        // Toggle Converter Panel
        document.getElementById('toggleConverterBtn').addEventListener('click', () => this.toggleConverter());
        document.getElementById('closeConverterBtn').addEventListener('click', () => this.closeConverter());
        
        // New Conversation
        document.getElementById('newConversationBtn').addEventListener('click', () => this.newConversation());
        
        // Send Message
        document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('userInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Voice Input
        document.getElementById('voiceInputBtn').addEventListener('click', () => this.startVoiceInput());
        
        // File Type Selection
        document.querySelectorAll('.type-option').forEach(option => {
            option.addEventListener('click', (e) => this.selectFileType(e));
        });
        
        // File Upload
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');
        
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            this.handleFileDrop(e);
        });
        
        // Remove File
        document.getElementById('removeFileBtn').addEventListener('click', () => this.removeSelectedFile());
        
        // Convert File
        document.getElementById('convertBtn').addEventListener('click', () => this.convertFile());
    }
    
    toggleSidebar() {
        this.sidebarOpen = !this.sidebarOpen;
        const sidebar = document.getElementById('sidebar');
        const btn = document.getElementById('toggleSidebarBtn');
        
        if (this.sidebarOpen) {
            sidebar.classList.add('open');
            btn.style.background = 'var(--primary-light)';
            btn.style.color = 'var(--primary-color)';
        } else {
            sidebar.classList.remove('open');
            btn.style.background = '';
            btn.style.color = '';
        }
    }
    
    toggleConverter() {
        this.converterOpen = !this.converterOpen;
        const panel = document.getElementById('converterPanel');
        const btn = document.getElementById('toggleConverterBtn');
        const icon = document.getElementById('converterIcon');
        
        if (this.converterOpen) {
            panel.classList.add('open');
            btn.classList.remove('primary');
            icon.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"></line>';
        } else {
            this.closeConverter();
        }
    }
    
    closeConverter() {
        this.converterOpen = false;
        const panel = document.getElementById('converterPanel');
        const btn = document.getElementById('toggleConverterBtn');
        const icon = document.getElementById('converterIcon');
        
        panel.classList.remove('open');
        btn.classList.add('primary');
        icon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
        
        // Reset conversion state
        this.resetConversionState();
    }
    
    resetConversionState() {
        document.getElementById('filePreview').style.display = 'none';
        document.getElementById('conversionProgress').style.display = 'none';
        document.getElementById('conversionResult').style.display = 'none';
        document.getElementById('convertBtn').disabled = true;
        this.selectedFile = null;
        document.getElementById('fileInput').value = '';
    }
    
    newConversation() {
        this.currentConversation = null;
        document.getElementById('messagesList').innerHTML = '';
        document.getElementById('welcomeMessage').style.display = 'block';
        this.updateConversationListUI();
        
        if (this.sidebarOpen) {
            this.toggleSidebar();
        }
    }
    
    async loadConversations() {
        try {
            const response = await window.pywebview.api.get_conversations();
            this.renderConversations(response);
        } catch (error) {
            console.error('Error loading conversations:', error);
            // Mock data for development
            this.renderConversations([
                { id: 1, title: 'Domande su Matematica', date: 'Oggi' },
                { id: 2, title: 'Riassunto Storia', date: 'Ieri' }
            ]);
        }
    }
    
    renderConversations(conversations) {
        const list = document.getElementById('conversationsList');
        list.innerHTML = '';
        
        conversations.forEach(conv => {
            const item = document.createElement('div');
            item.className = 'conversation-item';
            if (this.currentConversation === conv.id) {
                item.classList.add('active');
            }
            
            item.innerHTML = `
                <span class="conversation-icon">💬</span>
                <div class="conversation-info">
                    <div class="conversation-title">${conv.title}</div>
                    <div class="conversation-date">${conv.date}</div>
                </div>
            `;
            
            item.addEventListener('click', () => this.loadConversation(conv.id));
            list.appendChild(item);
        });
    }
    
    updateConversationListUI() {
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
    }
    
    async loadConversation(id) {
        this.currentConversation = id;
        document.getElementById('welcomeMessage').style.display = 'none';
        
        try {
            const messages = await window.pywebview.api.get_messages(id);
            this.renderMessages(messages);
        } catch (error) {
            console.error('Error loading conversation:', error);
        }
        
        this.updateConversationListUI();
    }
    
    sendMessage() {
        const input = document.getElementById('userInput');
        const message = input.value.trim();
        
        if (!message) return;
        
        // Hide welcome message
        document.getElementById('welcomeMessage').style.display = 'none';
        
        // Add user message
        this.addMessage(message, 'user');
        
        // Clear input
        input.value = '';
        input.style.height = 'auto';
        
        // Show typing indicator
        this.showTypingIndicator();
        
        // Send to backend
        this.sendToBackend(message);
    }
    
    addMessage(content, role) {
        const messagesList = document.getElementById('messagesList');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const avatar = role === 'user' ? '👤' : '🧠';
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">${this.formatMessage(content)}</div>
        `;
        
        messagesList.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    formatMessage(content) {
        // Simple markdown-like formatting
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }
    
    showTypingIndicator() {
        const messagesList = document.getElementById('messagesList');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message assistant';
        typingDiv.id = 'typingIndicator';
        
        typingDiv.innerHTML = `
            <div class="message-avatar">🧠</div>
            <div class="message-content">
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        
        messagesList.appendChild(typingDiv);
        this.scrollToBottom();
    }
    
    removeTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    async sendToBackend(message) {
        try {
            const response = await window.pywebview.api.send_message(message, this.currentConversation);
            this.removeTypingIndicator();
            this.addMessage(response, 'assistant');
        } catch (error) {
            console.error('Error sending message:', error);
            this.removeTypingIndicator();
            this.addMessage('Mi scuso, ma ho riscontrato un errore. Per favore riprova.', 'assistant');
        }
    }
    
    scrollToBottom() {
        const chatContainer = document.getElementById('chatContainer');
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    startVoiceInput() {
        // Voice input implementation
        alert('Funzionalità vocale in sviluppo...');
    }
    
    selectFileType(event) {
        const option = event.currentTarget;
        const type = option.dataset.type;
        
        document.querySelectorAll('.type-option').forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        
        this.selectedFileType = type;
        this.updateSupportedFormats();
        
        // Reset file selection when changing type
        this.removeSelectedFile();
    }
    
    updateSupportedFormats() {
        const formatsText = document.getElementById('supportedFormats');
        const fileInput = document.getElementById('fileInput');
        
        switch (this.selectedFileType) {
            case 'image':
                formatsText.textContent = 'Formati supportati: JPG, PNG, HEIC, WEBP';
                fileInput.accept = 'image/*';
                break;
            case 'pdf':
                formatsText.textContent = 'Formati supportati: PDF';
                fileInput.accept = '.pdf,application/pdf';
                break;
            case 'word':
                formatsText.textContent = 'Formati supportati: DOC, DOCX';
                fileInput.accept = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                break;
        }
    }
    
    handleFileSelect(event) {
        const files = event.target.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }
    
    handleFileDrop(event) {
        const files = event.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }
    
    processFile(file) {
        // Validate file type
        const validTypes = {
            image: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'],
            pdf: ['application/pdf'],
            word: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
        };
        
        const allowedTypes = validTypes[this.selectedFileType];
        if (!allowedTypes.includes(file.type)) {
            alert('Tipo di file non valido. Seleziona un file appropriato.');
            return;
        }
        
        this.selectedFile = file;
        
        // Show preview
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = this.formatFileSize(file.size);
        document.getElementById('filePreview').style.display = 'flex';
        document.getElementById('convertBtn').disabled = false;
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    removeSelectedFile() {
        this.selectedFile = null;
        document.getElementById('filePreview').style.display = 'none';
        document.getElementById('convertBtn').disabled = true;
        document.getElementById('fileInput').value = '';
    }
    
    async convertFile() {
        if (!this.selectedFile) return;
        
        const progressDiv = document.getElementById('conversionProgress');
        const resultDiv = document.getElementById('conversionResult');
        const convertBtn = document.getElementById('convertBtn');
        const progressFill = progressDiv.querySelector('.progress-fill');
        
        // Show progress
        progressDiv.style.display = 'block';
        resultDiv.style.display = 'none';
        convertBtn.disabled = true;
        
        // Simulate progress (in real implementation, this would come from backend)
        let progress = 0;
        const interval = setInterval(() => {
            progress += 5;
            progressFill.style.width = `${Math.min(progress, 90)}%`;
            if (progress >= 90) {
                clearInterval(interval);
            }
        }, 200);
        
        try {
            // Convert file using backend API
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            formData.append('type', this.selectedFileType);
            
            const result = await window.pywebview.api.convert_file(this.selectedFile, this.selectedFileType);
            
            clearInterval(interval);
            progressFill.style.width = '100%';
            
            setTimeout(() => {
                progressDiv.style.display = 'none';
                resultDiv.style.display = 'block';
            }, 500);
            
        } catch (error) {
            console.error('Conversion error:', error);
            clearInterval(interval);
            progressDiv.style.display = 'none';
            alert('Errore durante la conversione. Riprova.');
            convertBtn.disabled = false;
        }
    }
    
    startVoiceInput() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            
            recognition.lang = 'it-IT';
            recognition.continuous = false;
            recognition.interimResults = false;
            
            recognition.onstart = () => {
                document.getElementById('voiceInputBtn').style.background = 'var(--error)';
            };
            
            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                const input = document.getElementById('userInput');
                input.value = input.value ? input.value + ' ' + transcript : transcript;
                input.style.height = 'auto';
                input.style.height = input.scrollHeight + 'px';
            };
            
            recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                document.getElementById('voiceInputBtn').style.background = '';
            };
            
            recognition.onend = () => {
                document.getElementById('voiceInputBtn').style.background = '';
            };
            
            recognition.start();
        } else {
            alert('Il riconoscimento vocale non è supportato dal tuo browser.');
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new StudioIAApp();
});

// Expose API for pywebview
window.pywebviewAPI = {
    get_conversations: async () => {
        return [];
    },
    get_messages: async (id) => {
        return [];
    },
    send_message: async (message, conversationId) => {
        return 'Messaggio ricevuto. Questa è una risposta di esempio.';
    },
    convert_file: async (file, type) => {
        return { success: true, path: 'file_AIstudio/converted.md' };
    }
};
