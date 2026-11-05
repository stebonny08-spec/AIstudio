/* ============================================================
   modules/chatbot.js — sezione Chatbot della suite.
   - Lista conversazioni con CARTELLE (componente globale Folders)
   - Nessun pulsante materiali in lista ( resta solo dentro la chat )
   - Nuova conversazione: UN SOLO campo argomento (SubjectInput)
   - L'argomento viene passato al backend come topic => il retrieval
     RAG viene ristretto al sottoinsieme pertinente a quell'argomento
   - La chat vera e propria e quella ESISTENTE in index.html
   ============================================================ */
(function () {
    'use strict';

    const KIND = 'chat';

    let root = null;
    let pendingMeta = null;      // { materia, attivita } per la prossima chat creata
    let topic = '';              // argomento della conversazione attiva
    const convCache = {};        // id -> conversazione (per materia/folder)

    // ---------- ponte con la chat esistente ----------
    function resetChat() {
        try { currentConversationId = null; } catch (e) { /* ok */ }
        const cv = document.getElementById('chatView');
        if (cv) cv.innerHTML = '';
        document.querySelectorAll('.history-item.active').forEach(el => el.classList.remove('active'));
        try { hideContinueButton(); } catch (e) { /* ok */ }
    }

    function openExistingConversation(id) {
        pendingMeta = null;
        App.go('chat-session');
        try { openConversation(id); } catch (e) { console.error('openConversation:', e); }
    }

    // ---------- helper ----------
    function chip(text, color) {
        if (!text) return '';
        const dot = color ? '<span class="dot" style="background:' + App.esc(color) + '"></span>' : '';
        return '<span class="chip">' + dot + App.esc(text) + '</span>';
    }

    function fmtDateTime(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) +
                ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return iso; }
    }

    function stripMd(s) {
        return String(s || '').replace(/[#*_>\`\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // ---------- LISTA CONVERSAZIONI (con cartelle) ----------
    async function renderList(container) {
        root = container;
        container.innerHTML = '';

        const btnNew = App.el('button', 'tool-btn');
        btnNew.type = 'button';
        btnNew.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Nuova conversazione';
        btnNew.addEventListener('click', renderSetup);

        container.appendChild(App.header('Chatbot', 'Le tue conversazioni con il tutor locale', [btnNew]));

        // barra cartelle: Nuova cartella + breadcrumb
        container.appendChild(Folders.bar(KIND, () => renderList(container)));

        const wrap = App.el('div');
        container.appendChild(wrap);

        let convs = [], folders = [];
        try {
            const r = await Promise.all([StudyStore.listConversations(), Folders.list(KIND)]);
            convs = r[0] || [];
            folders = r[1] || [];
        } catch (e) { console.error(e); }

        convs.forEach(c => { convCache[c.id] = c; });

        // griglia cartelle (solo se ce ne sono nella cartella corrente)
        const fgrid = Folders.grid(KIND, () => renderList(container));
        wrap.appendChild(fgrid);

        // solo le conversazioni della cartella corrente
        const cur = Folders.get(KIND);
        const visible = convs.filter(c => (c.folder_id || '') === cur);

        if (!visible.length) {
            const empty = App.empty(
                App.ICONS.chatbot,
                cur
                    ? 'Nessuna conversazione in questa cartella.'
                    : 'Nessuna conversazione ancora. Inizia la tua prima chat con il tutor locale.',
                '+ Nuova conversazione', renderSetup);
            wrap.appendChild(empty);
            return;
        }

        const grid = App.el('div', 'grid-cards');
        visible.forEach(conv => {
            const card = App.el('div', 'card clickable');
            const preview = stripMd(conv.preview).slice(0, 170);
            card.innerHTML =
                '<h4>' + App.esc(conv.title || 'Senza titolo') + '</h4>' +
                '<div class="meta">' +
                    '<span>' + App.esc(fmtDateTime(conv.date)) + '</span>' +
                    (conv.n_messages ? '<span>· ' + conv.n_messages + ' messaggi</span>' : '') +
                '</div>' +
                '<div class="meta" style="margin-top:8px">' +
                    chip(conv.materia) + chip(conv.attivita) +
                '</div>' +
                (preview ? '<div class="preview">' + App.esc(preview) + '</div>' : '');
            card.tabIndex = 0;
            card.addEventListener('click', e => {
                if (e.target.closest('.card-actions') || e.target.closest('select')) return;
                openExistingConversation(conv.id);
            });
            card.addEventListener('keydown', e => { if (e.key === 'Enter') openExistingConversation(conv.id); });

            const actions = App.el('div', 'card-actions');
            // sposta in cartella
            actions.appendChild(Folders.moveSelect(KIND, conv.folder_id || '', async folderId => {
                try { await StudyStore.moveChat(conv.id, folderId); } catch (e) { console.error('moveChat:', e); }
                renderList(container);
            }));
            const del = App.el('button', 'danger');
            del.type = 'button';
            del.textContent = 'Elimina';
            del.addEventListener('click', async () => {
                if (!confirm('Eliminare la conversazione "' + (conv.title || '') + '"?')) return;
                await StudyStore.deleteConversation(conv.id);
                try { if (typeof loadConversations === 'function') loadConversations(); } catch (e) { /* ok */ }
                renderList(container);
            });
            actions.appendChild(del);
            card.appendChild(actions);
            grid.appendChild(card);
        });
        wrap.appendChild(grid);
    }

    // ---------- NUOVA CONVERSAZIONE: solo argomento ----------
    function renderSetup() {
        if (!root) return;
        const container = root;
        container.innerHTML = '';

        container.appendChild(App.header('Nuova conversazione', "Scegli l'argomento: la ricerca nei materiali sarà limitata a lui"));

        const body = App.el('div', 'card');
        body.style.maxWidth = '620px';
        body.style.margin = '0 auto';
        body.style.padding = '26px';

        const field = App.el('div', 'field');
        field.innerHTML = '<label for="setupArgomento">Argomento</label>';
        const subject = SubjectInput.create({
            id: 'setupArgomento',
            placeholder: 'es. FOTOSINTESI CLOROFILLIANA, STORIA MODERNA…',
            label: null
        });
        field.appendChild(subject);
        const hint = App.el('div', 'hint');
        hint.style.cssText = 'font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.5';
        hint.textContent = 'Puoi scrivere liberamente: le materie usate vengono salvate e riproposte. ' +
            "L'argomento serve a restringere la ricerca ai soli materiali pertinenti, riducendo attese e allucinazioni.";
        field.appendChild(hint);
        body.appendChild(field);

        const actions = App.el('div', 'form-actions');
        const cancel = App.el('button', 'btn-secondary');
        cancel.type = 'button';
        cancel.textContent = 'Annulla';
        cancel.addEventListener('click', () => renderList(container));
        const start = App.el('button', 'btn-accent');
        start.type = 'button';
        start.textContent = 'Avvia conversazione';
        start.addEventListener('click', async () => {
            const argomento = subject.getValue();
            if (!argomento) {
                alert('Inserisci un argomento per continuare.');
                subject.getInput().focus();
                return;
            }
            // salva la materia normalizzata tra le materie usate
            try { await SubjectInput.remember(argomento); } catch (e) { /* ok */ }

            pendingMeta = { materia: argomento, attivita: '' };
            topic = argomento;
            resetChat();
            App.go('chat-session');
            const ci = document.getElementById('chatInput');
            if (ci) ci.focus();
        });
        actions.appendChild(cancel);
        actions.appendChild(start);
        body.appendChild(actions);

        container.appendChild(body);
        setTimeout(() => { const i = document.getElementById('setupArgomento'); if (i) i.focus(); }, 80);
    }

    // ---------- hook index.html: nata una conversazione ----------
    async function onConversationCreated(convId) {
        if (!pendingMeta) return;
        const meta = pendingMeta;
        pendingMeta = null;
        try { await StudyStore.saveChatMeta(convId, meta); } catch (e) { console.warn('chat_meta_save:', e); }
        convCache[convId] = Object.assign(convCache[convId] || { id: convId }, meta);
        try { if (typeof loadConversations === 'function') loadConversations(); } catch (e) { /* ok */ }
    }

    // ---------- hook index.html: aperta una conversazione esistente ----------
    function onConversationOpened(convId) {
        const c = convCache[convId];
        if (c) { topic = (c.materia || '').trim(); return; }
        // non in cache: ricarica l'elenco e riprova
        StudyStore.listConversations().then(list => {
            (list || []).forEach(x => { convCache[x.id] = x; });
            const f = convCache[convId];
            if (f) topic = (f.materia || '').trim();
        }).catch(() => { topic = ''; });
    }

    function getTopic() { return topic || ''; }

    // ---------- H11: azioni AI nella chat (#chatView, UI in index.html) ----------
    function aiChatAvailable() {
        try {
            const api = window.pywebview && window.pywebview.api;
            return !!(api && typeof api.ai_run_function === 'function');
        } catch (e) { return false; }
    }
    function aiChatMessages(limit) {
        const out = [];
        try {
            const cv = document.getElementById('chatView');
            if (!cv) return out;
            const rows = Array.prototype.slice.call(cv.querySelectorAll('.msg-row'));
            rows.slice(-(limit || 10)).forEach(function (r) {
                const role = r.classList.contains('user') ? 'user' : 'ai';
                out.push({ role: role, text: (r.textContent || '').trim() });
            });
        } catch (e) { /* ok */ }
        return out;
    }
    // ---------- F67b (R13): "Salva come nota / documento / mazzo" (AI: F17) ----------
    // 3 azioni sulla barra azioni della chat (stesso posto di "Salva come
    // flashcard", nessun restyling): payload = contenuto del messaggio +
    // meta (materia/conversazione) -> F17 via AIService.runFor (validator
    // payload) -> preview [Accetta]/[Scarta] -> StudyStore.saveItem con i
    // kind REALI dei moduli ('note' | 'documento' | 'mazzo') + toast +
    // undo (delete dell'elemento creato) + badge metadati F17.
    const F67_KINDS = [
        { which: 'nota', kind: 'note', label: 'Salva come nota', toast: 'Nota salvata in Appunti' },
        { which: 'documento', kind: 'documento', label: 'Salva come documento', toast: 'Documento salvato' },
        { which: 'mazzo', kind: 'mazzo', label: 'Salva come mazzo', toast: 'Mazzo salvato in Ripasso' }
    ];

    function f67Message() {
        const hist = aiChatMessages(10);
        if (!hist.length) return null;
        let msg = null;
        for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].role === 'ai') { msg = hist[i]; break; }
        }
        if (!msg) msg = hist[hist.length - 1];
        const text = String((msg && msg.text) || '').trim();
        return text ? { text: text, role: msg.role } : null;
    }

    function f67Title(text) {
        const first = String(text || '').split('\n')[0].replace(/\s+/g, ' ').trim();
        if (!first) return 'Salvato dalla chat';
        return first.slice(0, 56) + (first.length > 56 ? '\u2026' : '');
    }

    function f67DocFrom(text) {
        // doc compatibile notes.js: quaderno con un oggetto testo reale
        const t = String(text || '');
        const lines = Math.max(1, Math.min(30, Math.ceil(t.length / 90)));
        return {
            sheet: 'quadretti', mode: 'quaderno', w: 1600, h: 1100, page: 0,
            pages: [{
                objects: [{
                    t: 'text', x: 80, y: 80, w: 1040, h: 24 * lines + 8,
                    text: t, size: 22, color: '#141414',
                    bold: false, italic: false, underline: false
                }]
            }]
        };
    }

    function f67Cards(r, title, text) {
        // card con la forma REALE di ripasso.js ({q, a, ...}), non front/back
        const d = r && r.data;
        const mk = function (q, a) {
            return {
                id: StudyStore.uuid(), q: q, a: a,
                color: '#8ca4ff', font: 'system', image: '',
                seen: 0, yes: 0, no: 0, box: 0
            };
        };
        if (d && typeof d === 'object' && Array.isArray(d.cards) && d.cards.length) {
            return d.cards.map(function (c) {
                const q = String((c && (c.front || c.q || c.domanda)) || '').trim() || title;
                const a = String((c && (c.back || c.a || c.risposta)) || '').trim() || text;
                return mk(q, a);
            });
        }
        return [mk(title, text)];
    }

    function f67Item(kind, text, meta, title, cards) {
        const base = {
            kind: kind, title: title, materia: (meta && meta.materia) || '',
            tags: '', description: 'Salvato dalla chat (AI: F17)', thumbnail: ''
        };
        if (kind === 'documento') {
            base.content = JSON.stringify({ html: '<p>' + App.esc(text) + '</p>' });
            return base;
        }
        if (kind === 'mazzo') {
            base.content = JSON.stringify({ cards: cards || [], color: '' });
            return base;
        }
        // kind 'note' (notes.js): content = JSON del doc con oggetto testo
        base.folder_id = '';
        base.content = JSON.stringify(f67DocFrom(text));
        return base;
    }

    function f67Payload(r, fallback) {
        const d = r && r.data;
        if (typeof d === 'string' && d.trim()) return d;
        if (d && typeof d === 'object') {
            if (Array.isArray(d.cards) && d.cards.length) {
                const c = d.cards[0] || {};
                const q = String(c.front || c.q || c.domanda || '').trim();
                const a = String(c.back || c.a || c.risposta || '').trim();
                if (a) return q ? (q + '\n' + a) : a;
            }
            if (typeof d.text === 'string' && d.text.trim()) return d.text;
            if (typeof d.content === 'string' && d.content.trim()) return d.content;
            try { return JSON.stringify(d); } catch (e) { /* non serializzabile */ }
        }
        return String(fallback || '');
    }

    function f67AttachBadge(r, text, meta) {
        // badge provenienza F17 agganciato alla riga del messaggio agito
        try {
            const cv = document.getElementById('chatView');
            if (!cv) return;
            const rows = Array.prototype.slice.call(cv.querySelectorAll('.msg-row'));
            const needle = String(text || '').slice(0, 40);
            let row = null;
            for (let i = rows.length - 1; i >= 0; i--) {
                if ((rows[i].textContent || '').trim().indexOf(needle) >= 0) { row = rows[i]; break; }
            }
            if (!row) row = rows[rows.length - 1];
            if (!row) return;
            const b = window.AIService.badgeEl(r);
            b.setAttribute('data-ai-f67-badge', meta.kind);
            b.title = 'F17 \u00b7 kind=' + meta.kind + ' \u00b7 materia=' +
                (meta.materia || '-') + ' \u00b7 conversazione=' + (meta.conversazione || '-');
            row.appendChild(b);
        } catch (e) { /* badge non critico: mai eccezione */ }
    }

    async function aiChatSaveAs(btn, which) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const def = F67_KINDS.filter(function (k) { return k.which === which; })[0];
        if (!def) return;
        const msg = f67Message();
        if (!msg) { AI.toast('Nessun messaggio da salvare'); return; }
        const meta = {
            kind: def.kind,
            materia: getTopic() || '',
            conversazione: (function () {
                try {
                    return (typeof currentConversationId !== 'undefined' && currentConversationId) || '';
                } catch (e) { return ''; }
            })(),
            sorgente: 'chatbot'
        };
        // F17: payload gia generato dalla sorgente (contenuto messaggio)
        const res = await AI.runFor(btn, 'F17', { payload: msg.text, meta: meta });
        if (!res || res.fallback) return;   // toast fallback gia mostrato da runFor
        AI.showPreview(res, async function (r) {
            try {
                const text = f67Payload(r, msg.text);
                if (!text) { AI.toast('Contenuto vuoto: nessun salvataggio'); return; }
                const title = f67Title(text);
                const item = f67Item(def.kind, text, meta, title, f67Cards(r, title, text));
                item.id = StudyStore.uuid();
                const saved = await StudyStore.saveItem(item);
                const id = (saved && saved.id) ? saved.id : item.id;
                // undo del chatbot = delete dell'elemento creato (hook modulo nullo:
                // documenti ri-registra pushUndo ad ogni uso)
                AI.registerUndo(null);
                AI.withUndo(function () {
                    f67AttachBadge(r, text, meta);
                    AI.toast(def.toast + ' \u00b7 Annulla con AI.undo()');
                }, function () {
                    try {
                        StudyStore.deleteItem(id);
                        AI.toast('Annullato: elemento rimosso');
                    } catch (e) { AI.toast('Annullamento non riuscito'); }
                });
            } catch (e) { AI.toast('Salvataggio non riuscito'); }
        });
    }

    function ensureChatBar() {
        try {
            const cv = document.getElementById('chatView');
            if (!cv) return;
            let bar = document.getElementById('aiChatBar');
            if (bar && bar.parentNode !== cv) { bar.parentNode.removeChild(bar); bar = null; }
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'aiChatBar';
                bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid rgba(255,255,255,.08);background:rgba(16,20,32,.96);position:relative;z-index:4;';
                const b16 = document.createElement('button');
                b16.type = 'button';
                b16.className = 'tool-btn';
                b16.setAttribute('data-ai-f16', '1');
                b16.textContent = '3 domande successive';
                b16.title = 'Tre domande di approfondimento (AI: F16)';
                b16.addEventListener('click', function () { aiChatFollow(b16); });
                const bFw = document.createElement('button');
                bFw.type = 'button';
                bFw.className = 'tool-btn';
                bFw.setAttribute('data-ai-flagwrong', '1');
                bFw.textContent = 'Risposta sbagliata';
                bFw.title = "Segna l'ultima risposta come sbagliata: la cache non la riusera' piu'";
                bFw.addEventListener('click', function () {
                    aiChatFlagWrong(bFw);
                });
                bar.appendChild(bFw);
                const b03 = document.createElement('button');
                b03.type = 'button';
                b03.className = 'tool-btn';
                b03.textContent = 'Salva come flashcard';
                b03.title = 'Salva domanda/risposta recente come flashcard (AI: F03)';
                b03.addEventListener('click', function () { aiChatToCard(b03); });
                bar.appendChild(b16);
                bar.appendChild(b03);
                // F67b: 3 azioni cross-modulo sul messaggio (AI: F17)
                F67_KINDS.forEach(function (k) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'tool-btn';
                    b.setAttribute('data-ai-f67', k.which);
                    b.textContent = k.label;
                    b.title = k.label + ' dal messaggio della chat (AI: F17)';
                    b.addEventListener('click', function () { aiChatSaveAs(b, k.which); });
                    bar.appendChild(b);
                });
                cv.appendChild(bar);
            }
            const b16b = bar.querySelector('[data-ai-f16]');
            if (b16b) b16b.disabled = !aiChatAvailable();
        } catch (e) { /* mai eccezione */ }
    }
    async function aiChatFollow(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const hist = aiChatMessages(8);
        if (!hist.length) { AI.toast('Nessuna risposta da cui proseguire'); return; }
        const res = await AI.runFor(btn, 'F16', { ctx: hist.map(function (m) { return String((m && m.text) || ''); }).join('\n'),
            topic: getTopic(),
            messaggi: hist,
            ultima_risposta: hist[hist.length - 1].text
        });
        if (!res || res.fallback) return;
        AI.showResult(res);
    }
    // R16 follow-up: risposte CORREGGIBILI - l'utente marca la risposta
    // sbagliata -> entry di answer_cache eliminate (mai piu' riusate)
    async function aiChatFlagWrong(btn) {
        var AI = window.AIService;
        var msg = f67Message();
        if (!msg) {
            if (AI && AI.toast) AI.toast('Nessun messaggio da segnare');
            return;
        }
        try {
            var api = window.pywebview && window.pywebview.api;
            if (!api || typeof api.flag_wrong_answer !== 'function') {
                if (AI && AI.toast) AI.toast('Segnalazione non disponibile');
                return;
            }
            var res = await api.flag_wrong_answer(msg.text, getTopic() || '');
            if (AI && AI.toast) {
                AI.toast((res && res.ok)
                    ? "Risposta segnata: non sara' piu' riusata dalla cache"
                    : 'Segnalazione non riuscita');
            }
        } catch (e) {
            console.error('flag_wrong_answer:', e);
        }
    }

    async function aiChatToCard(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const hist = aiChatMessages(8);
        if (!hist.length) { AI.toast('Nessun messaggio da salvare'); return; }
        let domanda = '', risposta = '';
        for (let i = hist.length - 1; i >= 0; i--) {
            if (!risposta && hist[i].role === 'ai') risposta = hist[i].text;
            else if (risposta && hist[i].role === 'user') { domanda = hist[i].text; break; }
        }
        if (!domanda) domanda = hist[0] ? hist[0].text : '';
        if (!risposta && hist.length > 1) risposta = hist[hist.length - 1].text;
        const res = await AI.runFor(btn, 'F03', { domanda: domanda, risposta: risposta, topic: getTopic(), q: domanda, a: risposta });
        if (!res || res.fallback) return;
        AI.showPreview(res, async function (r) {
            try {
                const d = r && r.data;
                const q = String((d && (d.domanda || d.q)) || domanda);
                const a = String((d && (d.risposta || d.a)) || AI.previewText(r));
                const decks = await StudyStore.listItems('mazzo');
                let deck = (decks || []).filter(function (x) { return x.title === 'Flashcard AI'; })[0];
                let cards = [];
                if (deck) { try { const p = JSON.parse(deck.content || '{}'); cards = p.cards || []; } catch (e) { cards = []; } }
                cards.push({ q: q, a: a, box: 0, seen: 0, yes: 0, no: 0 });
                await StudyStore.saveItem({
                    id: deck ? deck.id : StudyStore.uuid(),
                    kind: 'mazzo',
                    title: 'Flashcard AI',
                    content: JSON.stringify({ cards: cards, color: '' }),
                    materia: '',
                    tags: '',
                    description: 'Flashcard salvate dalla chat (AI)',
                    thumbnail: ''
                });
                AI.toast('Flashcard salvata in Ripasso (mazzo Flashcard AI)');
            } catch (e) { AI.toast('Salvataggio non riuscito'); }
        });
    }
    let aiChatBarTimer = null;
    try {
        if (typeof MutationObserver !== 'undefined' && document.body) {
            const aiMo = new MutationObserver(function () {
                if (aiChatBarTimer) return;
                aiChatBarTimer = setTimeout(function () {
                    aiChatBarTimer = null;
                    try { ensureChatBar(); } catch (e) { /* ok */ }
                }, 150);
            });
            aiMo.observe(document.body, { childList: true, subtree: true });
        }
        window.addEventListener('pywebviewready', function () { try { ensureChatBar(); } catch (e) { /* ok */ } });
    } catch (e) { /* ok */ }

    // ---------- registrazione modulo ----------
    App.registerModule({
        id: 'chatbot',
        title: 'Chatbot',
        desc: 'Chiedi aiuto al tutor locale: riassunti, chiarimenti, esercizi e ripassi sui tuoi materiali.',
        icon: App.ICONS.chatbot,
        kinds: [],
        open(container) { root = container; renderList(container); },
        async recent() {
            const convs = await StudyStore.listConversations().catch(() => []);
            return convs && convs.length ? 'Ultima: ' + (convs[0].title || 'conversazione') : '';
        }
    });

    App.registerNewConversationFlow(() => {
        App.go('chatbot');
        setTimeout(renderSetup, 60);
    });

    window.Chatbot = {
        onConversationCreated: onConversationCreated,
        onConversationOpened: onConversationOpened,
        getTopic: getTopic
    };
})();
