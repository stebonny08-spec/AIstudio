/* ============================================================
   app.js — router leggero + home della suite studio.
   Nessuna dipendenza esterna: mostra/nasconde le viste già
   presenti in index.html e quelle dei nuovi moduli.

   Viste: 'home' | 'chat-session' | id modulo registrato
   ============================================================ */
window.App = (function () {
    const ORDER = ['chatbot', 'notes', 'schemi', 'produttivita', 'ripasso', 'biblioteca', 'calendario'];
    const modules = {};
    let current = null;
    let homeEl = null, moduleEl = null;
    let newConvFlow = null;

    // ---------- helper DOM ----------
    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    function style(css) {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
        return s;
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ---------- icone (SVG inline, locale) ----------
    const ICONS = {
        chatbot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
        schemi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/></svg>',
        produttivita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
        ripasso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h8M6 12h6"/><path d="M18 10v6"/></svg>',
        biblioteca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
        calendario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
        plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        star: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="homeStarGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#f9974a"/></linearGradient></defs><polygon fill="url(#homeStarGrad)" points="50,2 53.4,41.7 68.4,31.6 58.3,46.6 98,50 58.3,53.4 68.4,68.4 53.4,58.3 50,98 46.6,58.3 31.6,68.4 41.7,53.4 2,50 41.7,46.6 31.6,31.6 46.6,41.7"/></svg>'
    };

    // ---------- intestazione standard dei moduli ----------
    function header(title, sub, actions) {
        const h = el('div', 'mod-header');
        const back = el('button', 'mod-back');
        back.type = 'button';
        back.innerHTML = ICONS.home + ' Home';
        back.addEventListener('click', () => go('home'));
        h.appendChild(back);
        const head = el('div', 'mod-heading');
        head.appendChild(el('div', 'mod-title', esc(title)));
        if (sub) head.appendChild(el('div', 'mod-sub', esc(sub)));
        h.appendChild(head);
        const act = el('div', 'mod-actions');
        (actions || []).forEach(a => act.appendChild(a));
        h.appendChild(act);
        return h;
    }

    function empty(icon, message, actionLabel, onAction) {
        const e = el('div', 'empty-state');
        e.innerHTML = (icon || ICONS.notes) + '<p>' + esc(message) + '</p>';
        if (actionLabel) {
            const b = el('button', 'btn-accent');
            b.type = 'button';
            b.textContent = actionLabel;
            b.addEventListener('click', onAction);
            e.appendChild(b);
        }
        return e;
    }

    // ---------- registrazione moduli ----------
    function registerModule(def) {
        modules[def.id] = def;
    }

    // ---------- navigazione ----------
    function hideAll() {
        ['homeView', 'moduleView', 'welcomeView', 'chatView'].forEach(id => {
            const e = document.getElementById(id);
            if (e) e.classList.add('hidden');
        });
        const ic = document.querySelector('.input-container');
        if (ic) ic.classList.add('hidden');
        const sb = document.getElementById('scrollBottomBtn');
        if (sb) sb.classList.remove('show');
        const cb = document.getElementById('continueBtn');
        if (cb) cb.classList.remove('show');
    }

    function enterChatSession() {
        const ic = document.querySelector('.input-container');
        if (ic) ic.classList.remove('hidden');
        const chatView = document.getElementById('chatView');
        const welcome = document.getElementById('welcomeView');
        if (chatView && chatView.children.length) {
            if (welcome) welcome.classList.add('hidden');
            chatView.classList.remove('hidden');
            try { scrollChatForced(); } catch (e) { /* ok */ }
        } else {
            if (chatView) chatView.classList.add('hidden');
            if (welcome) welcome.classList.remove('hidden');
        }
    }

    function go(view, params) {
        const prev = current;
        if (prev && modules[prev] && typeof modules[prev].close === 'function') {
            try { modules[prev].close(); } catch (e) { console.error('close modulo:', e); }
        }
        hideAll();
        current = view;
        document.body.classList.toggle('view-home', view === 'home');
        document.body.classList.toggle('view-chat', view === 'chat-session');
        document.body.classList.toggle('view-module', view !== 'home' && view !== 'chat-session');
        if (view === 'home') {
            homeEl.classList.remove('hidden');
            renderHome();
        } else if (view === 'chat-session') {
            enterChatSession();
        } else if (modules[view]) {
            moduleEl.classList.remove('hidden');
            moduleEl.innerHTML = '';
            try { modules[view].open(moduleEl, params || {}); }
            catch (e) {
                console.error('Errore apertura modulo ' + view + ':', e);
                moduleEl.innerHTML = '';
                moduleEl.appendChild(empty(ICONS.notes, 'Errore durante l\'apertura del modulo. Vedi console (F12).'));
            }
        } else {
            current = 'home';
            homeEl.classList.remove('hidden');
            renderHome();
        }
        const vp = view === 'home' ? homeEl : (modules[view] ? moduleEl : homeEl);
        if (vp) vp.scrollTop = 0;
    }

    // ---------- HOME ----------
    const DESC = {
        chatbot: 'Chiedi aiuto al tutor locale: riassunti, chiarimenti, esercizi e ripassi sui tuoi materiali.',
        notes: 'Prendi appunti a mano con penna e evidenziatore, o con la tastiera.',
        schemi: 'Crea mappe concettuali, alberi e schemi visivi per organizzare gli argomenti.',
        produttivita: 'Presentazioni, documenti, video e fogli di calcolo: tutto in locale.',
        ripasso: 'Mazzi di flashcard per fissare gli argomenti con sessioni di studio veloci.',
        biblioteca: 'Tutti i tuoi elaborati e materiali in un unico posto, con ricerca e filtri.',
        calendario: 'Verifiche, compiti e sessioni di studio: organizza il tuo mese.'
    };

    async function recentLabel(id) {
        try {
            if (id === 'chatbot') {
                const convs = await StudyStore.listConversations();
                return convs && convs.length ? 'Ultima: ' + (convs[0].title || 'conversazione') : 'Nessuna conversazione';
            }
            const m = modules[id];
            if (!m) return '';
            if (typeof m.recent === 'function') return await m.recent();
            if (id === 'biblioteca') {
                const items = await StudyStore.listItems('');
                return items.length ? items.length + ' elementi in biblioteca' : 'Biblioteca vuota';
            }
            if (id === 'calendario') {
                const evs = await StudyStore.listEvents();
                const today = new Date().toISOString().slice(0, 10);
                const next = (evs || []).filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
                return next ? 'Prossimo: ' + next.title + ' (' + fmtDate(next.date) + ')' : 'Nessun evento in programma';
            }
            const kinds = m.kinds || [];
            if (kinds.length) {
                const items = await StudyStore.listItems('');
                const f = (items || []).filter(i => kinds.indexOf(i.kind) >= 0);
                return f.length ? 'Ultimo: ' + f[0].title : '';
            }
        } catch (e) { /* home degradata */ }
        return '';
    }

    function fmtDate(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso.length > 10 ? iso : iso + 'T00:00:00');
            return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) { return iso; }
    }

    function renderHome() {
        homeEl.innerHTML = '';
        const wrap = el('div', 'home-wrap');
        const hero = el('div', 'home-hero hidden');
        hero.innerHTML = '<div class="home-star">' + ICONS.star + '</div>' +
            '<h1>NovaStudio</h1>' +
            '<p>La tua suite locale per lo studio — tutto resta sul tuo computer.</p>';
        wrap.appendChild(hero);

        const grid = el('div', 'home-grid');
        ORDER.forEach(id => {
            const m = modules[id];
            if (!m) return;
            const card = el('button', 'home-card');
            card.type = 'button';
            card.setAttribute('aria-label', 'Apri ' + m.title);
            card.innerHTML =
                '<div class="icon-tile ' + (m.iconClass || '') + '">' + (m.icon || ICONS[id] || '') + '</div>' +
                '<h3>' + esc(m.title) + '</h3>' +
                '<div class="home-desc">' + esc(m.desc || DESC[id] || '') + '</div>' +
                '<div class="home-last" data-last="' + id + '"></div>';
            card.addEventListener('click', () => go(id));
            grid.appendChild(card);
            recentLabel(id).then(label => {
                const t = card.querySelector('[data-last="' + id + '"]');
                if (t && label) t.textContent = label;
            });
        });
        // 8a card: riusa il dialogo materiali esistente (#materialModal).
        const addMatCard = el('button', 'home-card');
        addMatCard.type = 'button';
        addMatCard.setAttribute('aria-label', 'Aggiungi materiali');
        addMatCard.innerHTML =
            '<div class="icon-tile">' + ICONS.plus + '</div>' +
            '<h3>Aggiungi materiali</h3>' +
            '<div class="home-desc">Carica libri e file nella Biblioteca.</div>' +
            '<div class="home-last">Apre il dialogo materiali</div>';
        addMatCard.addEventListener('click', () => {
            if (window.Materiali && typeof window.Materiali.open === 'function') {
                window.Materiali.open();
            } else {
                const mm = document.getElementById('materialModal');
                if (mm) mm.classList.add('show');
            }
        });
        grid.appendChild(addMatCard);
        wrap.appendChild(grid);
        homeEl.appendChild(wrap);
        // G7: accesso discreto alla vista "Statistiche AI" (modulo NON in
        // App.ORDER): e' un .dev-link con <a>, NON una .home-card
        // (la home resta a 8 card - qaD_home 41/41, nessuna 9a card).
        const devLink = el('div', 'dev-link');
        devLink.style.margin = '12px 4px 20px';
        devLink.innerHTML = '<a href="#" class="dev-link-a" style="font-size:12px;' +
            'color:#9db2c6;text-decoration:none;border-bottom:1px dotted #5a6b7d;">Statistiche AI</a>';
        devLink.addEventListener('click', function (e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            go('statistiche');
        });
        wrap.appendChild(devLink);
    }

    // ---------- chatbot: nuovo flusso conversazione ----------
    function registerNewConversationFlow(fn) { newConvFlow = fn; }
    function newConversationFlow() {
        if (newConvFlow) { newConvFlow(); return; }
        go('chat-session');
    }

    // ---------- apertura di un elemento dalla biblioteca/calendario ----------
    const KIND_OPEN = {
        note: 'notes',
        schema: 'schemi',
        riassunto: 'schemi',
        mazzo: 'ripasso',
        presentazione: { module: 'produttivita', params: { tool: 'presentazioni' } },
        documento: { module: 'produttivita', params: { tool: 'documenti' } },
        foglio: { module: 'produttivita', params: { tool: 'fogli' } },
        video: { module: 'produttivita', params: { tool: 'video' } }
    };
    function openItem(kind, id) {
        const target = KIND_OPEN[kind];
        if (!target) return;
        if (typeof target === 'string') go(target, { open: id });
        else go(target.module, Object.assign({}, target.params, { open: id }));
    }

    // ---------- bootstrap ----------
    function boot() {
        homeEl = el('main', 'view-page hidden');
        homeEl.id = 'homeView';
        moduleEl = el('main', 'view-page hidden');
        moduleEl.id = 'moduleView';
        const anchor = document.getElementById('welcomeView');
        document.body.insertBefore(homeEl, anchor);
        document.body.insertBefore(moduleEl, anchor);

        // logo → home
        // logo + titolo => home
        const lockup = document.getElementById('brandLockup');
        if (lockup) {
            lockup.addEventListener('click', () => go('home'));
            lockup.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('home'); } });
        }

        // ritorno da una conversazione aperta alla lista Chatbot
        const chatBack = document.getElementById('chatBackBtn');
        if (chatBack) chatBack.addEventListener('click', () => go('chatbot'));

        // impostazioni accessibili dalla home (prima erano nel menu hamburger)
        const gear = document.getElementById('headerSettingsBtn');
        if (gear) gear.addEventListener('click', () => {
            try {
                openModal(settingsModal);
                if (typeof refreshUpdateStatus === 'function') refreshUpdateStatus();
            } catch (e) {
                try { openModal(settingsModal); } catch (e2) { console.error('Impostazioni:', e2); }
            }
        });

        // voce "Home" nella sidebar (sotto il pulsante nuova chat)
        const newChatBtn = document.getElementById('newChatBtn');
        if (newChatBtn && newChatBtn.parentElement) {
            const homeBtn = el('button', 'btn-secondary btn-block');
            homeBtn.type = 'button';
            homeBtn.id = 'sidebarHomeBtn';
            homeBtn.style.marginTop = '10px';
            homeBtn.innerHTML = ICONS.home + ' Home';
            homeBtn.addEventListener('click', () => { go('home'); try { closeSidebar(); } catch (e) { /* ok */ } });
            newChatBtn.parentElement.insertBefore(homeBtn, newChatBtn.nextSibling);
        }

        go('home');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    return {
        go, boot, registerModule, registerNewConversationFlow, newConversationFlow,
        openItem, header, empty, el, esc, style, ICONS, fmtDate, ORDER,
        get current() { return current; },
        get moduleContainer() { return moduleEl; }
    };
})();

/* ===================== AIService (H10) =====================
   Namespace globale window.AIService — definito IN app.js (caricato da
   index.html PRIMA dei moduli) e consumato dai bottoni contestuali H11.
   - run(fid, inputs): client DEFENSIVE su pywebview.api.ai_run_function
     (API aggiunta da altro agente in backend/api.py). Se api assente /
     errore / non disponibile -> {ok:false, fallback:true, data:null,
     badge:'AI non disponibile'}. MAI eccezione non catturata.
   - badgeEl(result): micro-badge provenienza (.ai-badge) con testo da
     result.badge: 'generato da AI' | 'cache esatta' | 'bozza da cache
     (da revisionare)' | 'AI non disponibile'.
   - pending(btn, promise)/withPending: stato async -> disabilita il
     pulsante invocante + micro-indicatore, tutto con Promise.
   - undo: registerUndo(fn) hook dal modulo chiamante (notes/documenti/
     fogli pushUndo proprio); withUndo(fn, restoreFn) snapshot prima della
     scrittura (hook modulo OPPURE stack locale _undo); undo() chiama
     l'ultimo snapshot locale.
   - showPreview(result, onAccept, onReject): overlay anteprima minimale
     riusabile con [Accetta] [Scarta]; Esc/ backdrop = Scarta; NESSUNA
     scrittura prima di Accetta; approval_required -> solo preview.
   ========================================================== */
window.AIService = (function () {
    'use strict';

    var _undoStack = [];
    var _undoHook = null;
    var MAX_UNDO = 30;
    var _cssDone = false;
    var _ovFinish = null;

    var CSS = '' +
        '.ai-badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid rgba(249,151,74,.45);background:rgba(249,151,74,.14);color:#b4651f;letter-spacing:.02em}' +
        '.ai-pending{display:inline-block;width:9px;height:9px;margin-left:6px;border:2px solid rgba(249,151,74,.35);border-top-color:#f9974a;border-radius:50%;animation:ai-spin .7s linear infinite;vertical-align:middle}' +
        '@keyframes ai-spin{to{transform:rotate(360deg)}}' +
        '.ai-preview-ov{position:fixed;inset:0;z-index:99999;background:rgba(10,12,18,.55);display:flex;align-items:center;justify-content:center;padding:20px}' +
        '.ai-preview{background:#151a26;border:1px solid #2a3247;border-radius:12px;max-width:660px;width:100%;max-height:82vh;overflow:auto;padding:16px 18px;box-shadow:0 18px 48px rgba(0,0,0,.45);color:#e9edf5}' +
        '.ai-preview h3{margin:0 0 6px;font-size:15px}' +
        '.ai-preview label{display:block;font-size:12px;color:#9aa3b5;margin-top:9px}' +
        '.ai-preview input,.ai-preview select{width:100%;box-sizing:border-box;margin-top:4px;background:#0f1320;border:1px solid #232a3d;border-radius:8px;color:#e9edf5;padding:7px 10px;font:13px inherit;outline:none}' +
        '.ai-preview pre{white-space:pre-wrap;word-break:break-word;background:#0f1320;border:1px solid #232a3d;border-radius:8px;padding:10px 12px;font:12.5px/1.5 ui-monospace,Consolas,monospace;max-height:46vh;overflow:auto;margin:8px 0 0}' +
        '.ai-preview .ai-pv-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}' +
        '.ai-pv-accept{background:#f9974a;color:#141824;border:none;border-radius:8px;padding:8px 16px;font-weight:800;cursor:pointer;font:inherit;font-size:13px}' +
        '.ai-pv-reject{background:transparent;color:#9aa3b5;border:1px solid #2a3247;border-radius:8px;padding:8px 16px;cursor:pointer;font:inherit;font-size:13px}' +
        '.ai-fallback{font-size:11.5px;color:#9aa3b5}';

    function ensureCss() {
        if (_cssDone) return;
        _cssDone = true;
        try {
            if (window.App && typeof App.style === 'function') App.style(CSS);
            else if (document.head) {
                var s = document.createElement('style');
                s.textContent = CSS;
                document.head.appendChild(s);
            }
        } catch (e) { /* stili non critici */ }
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function fallbackResult(reason) {
        return {
            ok: false, fallback: true, data: null, badge: 'AI non disponibile',
            error: reason ? String((reason && reason.message) || reason) : ''
        };
    }

    function isFallback(res) { return !!(res && res.fallback); }

    /* ---- H10: run(fid, inputs) — client DEFENSIVE, mai eccezione ---- */
    async function run(fid, inputs) {
        ensureCss();
        try {
            var api = window.pywebview && window.pywebview.api;
            if (!api || typeof api.ai_run_function !== 'function') return fallbackResult('api pywebview assente');
            var raw = await api.ai_run_function(String(fid), JSON.stringify(inputs || {}));
            var res = raw;
            if (typeof raw === 'string') {
                try { res = JSON.parse(raw); } catch (e) { res = { ok: true, data: raw }; }
            }
            if (!res || typeof res !== 'object') return fallbackResult('risposta non valida');
            if (res.ok === false) {
                var out = fallbackResult(res.error || res.message || 'errore AI');
                if (res.badge) out.badge = res.badge;
                if (res.data != null) out.data = res.data;
                if (res.fallback) out.fallback = true;
                if (res.approval_required) out.approval_required = true;
                return out;
            }
            if (!res.badge) res.badge = 'generato da AI';
            return res;
        } catch (e) {
            return fallbackResult(e);
        }
    }

    /* ---- badge provenienza (.ai-badge) ---- */
    function badgeEl(result) {
        ensureCss();
        var b = el('span', 'ai-badge');
        var txt = (result && result.badge) || 'generato da AI';
        b.textContent = txt;
        b.title = 'Provenienza output: ' + txt;
        return b;
    }

    /* ---- toast discreto (nessuna eccezione) ---- */
    function toast(msg) {
        ensureCss();
        try {
            if (window.App && typeof App.notify === 'function') { App.notify(String(msg)); return; }
        } catch (e) { /* fallback sotto */ }
        try {
            var t = el('div', 'ai-toast', String(msg));
            t.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:100000;background:#151a26;color:#e9edf5;border:1px solid #2a3247;border-radius:9px;padding:7px 13px;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.35)';
            document.body.appendChild(t);
            setTimeout(function () { try { if (t.parentNode) t.parentNode.removeChild(t); } catch (e) {} }, 2600);
        } catch (e) { /* mai eccezione */ }
    }

    /* ---- stato async: pending() = disabilita pulsante + micro-indicatore ---- */
    async function pending(btn, promise) {
        var restore = null;
        if (btn && btn.nodeType === 1) {
            var prev = !!btn.disabled;
            btn.disabled = true;
            var ind = el('span', 'ai-pending');
            try { btn.appendChild(ind); } catch (e) {}
            restore = function () {
                try { if (ind.parentNode) ind.parentNode.removeChild(ind); } catch (e) {}
                try { btn.disabled = prev; } catch (e) {}
            };
        }
        try { return await promise; }
        finally { if (restore) restore(); }
    }
    var withPending = pending;

    /* ---- run + pending + toast fallback (helper bottoni H11) ---- */
    async function runFor(btn, fid, inputs) {
        var res;
        try { res = await pending(btn, run(fid, inputs)); }
        catch (e) { res = fallbackResult(e); }
        if (res && res.fallback) toast(res.badge || 'AI non disponibile');
        return res;
    }

    /* ---- undo: hook dal modulo + stack locale ---- */
    function registerUndo(fn) { _undoHook = (typeof fn === 'function') ? fn : null; }
    function withUndo(fn, restoreFn) {
        if (typeof _undoHook === 'function') { try { _undoHook(); } catch (e) { /* hook non critico */ } }
        if (typeof restoreFn === 'function') {
            _undoStack.push({ undo: restoreFn });
            if (_undoStack.length > MAX_UNDO) _undoStack.shift();
        }
        return fn();
    }
    function undo() {
        var last = _undoStack.pop();
        if (last && typeof last.undo === 'function') {
            try { last.undo(); return true; } catch (e) { return false; }
        }
        return false;
    }

    /* ---- overlay minimale riusabile (una alla volta, Esc chiude) ---- */
    function _overlay(onClose) {
        closePreview();
        ensureCss();
        var ov = el('div', 'ai-preview-ov');
        var box = el('div', 'ai-preview');
        ov.appendChild(box);
        var done = false;
        function finish(v) {
            if (done) return;
            done = true;
            try { if (ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {}
            try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
            if (_ovFinish === finish) _ovFinish = null;
            if (typeof onClose === 'function') { try { onClose(v); } catch (e) { /* mai eccezione */ } }
        }
        function onKey(e) {
            if (e && (e.key === 'Escape' || e.key === 'Esc')) {
                try { e.stopPropagation(); if (e.preventDefault) e.preventDefault(); } catch (err) {}
                finish(null);
            }
        }
        try { document.addEventListener('keydown', onKey, true); } catch (e) {}
        ov.addEventListener('click', function (e) { if (e.target === ov) finish(null); });
        _ovFinish = finish;
        return { ov: ov, box: box, finish: finish };
    }
    function closePreview() { if (_ovFinish) { try { _ovFinish(null); } catch (e) {} } }

    function previewText(result) {
        var d = result && result.data;
        if (d == null) return (result && result.badge) ? String(result.badge) : 'Nessun contenuto generato.';
        if (typeof d === 'string') return d;
        if (Array.isArray(d)) return arrText(d);
        if (typeof d === 'object') {
            var keys = ['text', 'outline', 'bullets', 'bullet', 'content', 'labels', 'tags', 'blocks',
                'items', 'questions', 'domande', 'formula', 'script', 'feedback', 'followup',
                'follow_up', 'giudizio', 'verdict', 'esito', 'value', 'result', 'risultato'];
            for (var i = 0; i < keys.length; i++) {
                var v = d[keys[i]];
                if (typeof v === 'string' && v) return v;
                if (Array.isArray(v) && v.length) return arrText(v);
            }
            try { return JSON.stringify(d, null, 2); } catch (e) { return String(d); }
        }
        return String(d);
    }
    function arrText(arr) {
        return arr.map(function (x) {
            if (x == null) return '';
            if (typeof x === 'string') return '- ' + x;
            if (typeof x === 'object') {
                if (x.title || x.text || x.label) return '- ' + (x.title || x.text || x.label) + ((x.detail || x.body || x.value) ? ': ' + (x.detail || x.body || x.value) : '');
                try { return JSON.stringify(x, null, 2); } catch (e) { return String(x); }
            }
            return String(x);
        }).join('\n');
    }

    /* ---- H10: pannello ANTEPRIMA [Accetta] [Scarta], Esc = Scarta ---- */
    /* ---- H10: pannello risultato in sola lettura (giudizi, spiegazioni) ---- */
    function showResult(result) {
        ensureCss();
        var o = _overlay(null);
        o.box.appendChild(el('h3', null, 'Risultato AI'));
        var top = el('div');
        top.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
        top.appendChild(badgeEl(result));
        if (result && result.fallback) top.appendChild(el('span', 'ai-fallback', String(result.badge || 'AI non disponibile')));
        o.box.appendChild(top);
        var pre = el('pre');
        pre.textContent = previewText(result);
        o.box.appendChild(pre);
        var acts = el('div', 'ai-pv-actions');
        var bClose = el('button', 'ai-pv-reject', 'Chiudi');
        bClose.type = 'button';
        bClose.addEventListener('click', function () { o.finish(null); });
        acts.appendChild(bClose);
        o.box.appendChild(acts);
        document.body.appendChild(o.ov);
        return { close: function () { o.finish(null); } };
    }
    function showPreview(result, onAccept, onReject) {
        ensureCss();
        var o = _overlay(function (v) {
            if (v === true) { try { if (onAccept) onAccept(result); } catch (e) { toast('Errore durante l accettazione'); } }
            else { try { if (onReject) onReject(result); } catch (e) { /* mai eccezione */ } }
        });
        o.box.appendChild(el('h3', null, 'Anteprima AI'));
        var top = el('div');
        top.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
        top.appendChild(badgeEl(result));
        if (result && result.approval_required) top.appendChild(el('span', 'ai-fallback', 'approvazione umana richiesta'));
        if (result && result.fallback) top.appendChild(el('span', 'ai-fallback', String(result.badge || 'AI non disponibile')));
        o.box.appendChild(top);
        var pre = el('pre');
        pre.textContent = previewText(result);
        o.box.appendChild(pre);
        var acts = el('div', 'ai-pv-actions');
        var bRej = el('button', 'ai-pv-reject', 'Scarta'); bRej.type = 'button';
        var bAcc = el('button', 'ai-pv-accept', 'Accetta'); bAcc.type = 'button';
        bRej.addEventListener('click', function () { o.finish(false); });
        bAcc.addEventListener('click', function () { o.finish(true); });
        acts.appendChild(bRej);
        acts.appendChild(bAcc);
        o.box.appendChild(acts);
        document.body.appendChild(o.ov);
        return { close: function () { o.finish(false); } };
    }

    /* ---- form minimale riusabile (Esc/Annulla -> null) ---- */
    function askInputs(title, fields, submitLabel) {
        ensureCss();
        return new Promise(function (resolve) {
            var o = _overlay(function (v) { resolve(v); });
            o.box.appendChild(el('h3', null, title || 'Dati per AI'));
            var inputs = [];
            (fields || []).forEach(function (f) {
                var wrap = el('div');
                wrap.appendChild(el('label', null, f.label || f.name));
                var inp;
                if (f.type === 'select') {
                    inp = el('select');
                    (f.options || []).forEach(function (op) {
                        var o2 = document.createElement('option');
                        o2.value = (op && op.value != null) ? op.value : String(op);
                        o2.textContent = (op && op.label != null) ? op.label : String(op);
                        inp.appendChild(o2);
                    });
                } else {
                    inp = el('input');
                    inp.type = (f.type === 'number') ? 'number' : 'text';
                }
                if (f.placeholder) inp.placeholder = f.placeholder;
                if (f.value != null) inp.value = f.value;
                wrap.appendChild(inp);
                inputs.push({ f: f, inp: inp });
                o.box.appendChild(wrap);
            });
            var acts = el('div', 'ai-pv-actions');
            var bCancel = el('button', 'ai-pv-reject', 'Annulla'); bCancel.type = 'button';
            var bOk = el('button', 'ai-pv-accept', submitLabel || 'Continua'); bOk.type = 'button';
            bCancel.addEventListener('click', function () { o.finish(null); });
            bOk.addEventListener('click', function () {
                var out = {};
                inputs.forEach(function (x) {
                    var v = x.inp.value;
                    out[x.f.name] = (x.f.type === 'number') ? (Number(v) || 0) : v;
                });
                o.finish(out);
            });
            acts.appendChild(bCancel);
            acts.appendChild(bOk);
            o.box.appendChild(acts);
            document.body.appendChild(o.ov);
        });
    }

    function needsApproval(res) { return !!(res && res.approval_required); }

    return {
        run: run,
        runFor: runFor,
        pending: pending,
        withPending: withPending,
        badgeEl: badgeEl,
        toast: toast,
        showPreview: showPreview,
        showResult: showResult,
        askInputs: askInputs,
        closePreview: closePreview,
        previewText: previewText,
        registerUndo: registerUndo,
        withUndo: withUndo,
        undo: undo,
        isFallback: isFallback,
        needsApproval: needsApproval,
        _undo: _undoStack
    };
})();
/* =================== fine AIService (H10) =================== */
