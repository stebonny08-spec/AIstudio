/* qa_ui/env.js — ENV STUB MINIMALE per verifica UI REALE (apertura via file://).
   - App: riduzione della API REALE di web_frontend/html/js/app.js
     (el/style/esc/header -> .mod-header, empty -> .empty-state, ICONS, registerModule, go, fmtDate)
   - StudyStore/StudyAsk/SubjectInput/Folders: copiati e ridotti da tests/*Ui.test.js
   - NESSUNA geometria simulata: tutte le misure usano getBoundingClientRect() del browser reale.
   Caricato PRIMA dei moduli reali web_frontend/html/js/modules/*.js. */
(function () {
    'use strict';
    var QA = window.__QA = { ready: false, done: false, needShot: null, errors: [], checks: [] };
    window.addEventListener('error', function (e) { QA.errors.push('error: ' + String((e && e.message) || e)); });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason; QA.errors.push('rejection: ' + String((r && r.message) || r));
    });

    /* ---------- App (riduzione identica della API reale di js/app.js) ---------- */
    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function style(css) { var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); return s; }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    var ICONS = {
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
        schemi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/></svg>'
    };
    function go() { /* stub: nessuna navigazione */ }
    function header(title, sub, actions) {
        var h = el('div', 'mod-header');
        var back = el('button', 'mod-back'); back.type = 'button'; back.innerHTML = ICONS.home + ' Home';
        back.addEventListener('click', function () { go('home'); });
        h.appendChild(back);
        var head = el('div', 'mod-heading');
        head.appendChild(el('div', 'mod-title', esc(title)));
        if (sub) head.appendChild(el('div', 'mod-sub', esc(sub)));
        h.appendChild(head);
        var act = el('div', 'mod-actions');
        (actions || []).forEach(function (a) { act.appendChild(a); });
        h.appendChild(act);
        return h;
    }
    function empty(icon, message, actionLabel, onAction) {
        var e = el('div', 'empty-state');
        e.innerHTML = (icon || ICONS.notes) + '<p>' + esc(message) + '</p>';
        if (actionLabel) {
            var b = el('button', 'btn-accent'); b.type = 'button'; b.textContent = actionLabel;
            b.addEventListener('click', onAction); e.appendChild(b);
        }
        return e;
    }
    function fmtDate(iso) {
        if (!iso) return '';
        try { var d = new Date(iso); return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('it-IT'); } catch (e) { return String(iso); }
    }
    var registered = {};
    window.App = {
        el: el, style: style, esc: esc, empty: empty, fmtDate: fmtDate, go: go,
        header: header, ICONS: ICONS,
        registerModule: function (def) { registered[def.id] = def; QA.mod = def; }
    };

    /* ---------- StudyStore in-memory (riduzione da tests/*Ui.test.js) ---------- */
    var store = { items: [], seq: 1 };
    QA.store = store;
    window.StudyStore = {
        uuid: function () { return 'id' + (store.seq++); },
        listItems: async function (kind) { return store.items.filter(function (i) { return !kind || i.kind === kind; }).map(function (i) { return Object.assign({}, i); }); },
        getItem: async function (id) { var i = store.items.filter(function (x) { return x.id === id; })[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async function (p) {
            if (p.id) { var i = store.items.filter(function (x) { return x.id === p.id; })[0]; if (i) { Object.assign(i, p); return Object.assign({}, i); } }
            var n = Object.assign({ id: 'n' + (store.seq++) }, p); store.items.push(n); return Object.assign({}, n);
        },
        deleteItem: async function (id) { store.items = store.items.filter(function (i) { return i.id !== id; }); },
        renameItem: async function (id, t) { var i = store.items.filter(function (x) { return x.id === id; })[0]; if (i) i.title = t; },
        duplicateItem: async function () { return null; },
        listSubjects: async function () { return []; },
        pickAsset: async function () { return null; },
        assetUrl: function (s) { return s; },
        hasBackend: async function () { return false; }
    };
    window.StudyAsk = function (t, v) { return Promise.resolve(v == null ? 'Voce' : v); };
    window.prompt = function () { return null; };
    window.confirm = function () { return false; };

    /* ---------- SubjectInput + Folders (riduzione da tests/schJourney.js) ---------- */
    window.SubjectInput = {
        normalize: function (s) { return String(s || '').trim(); },
        remember: function () { },
        create: function (opts) {
            var wrap = el('div', 'subject-input');
            var inp = document.createElement('input'); inp.className = 'subject-field';
            inp.value = (opts && opts.value) || '';
            if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
            wrap.appendChild(inp);
            wrap.getValue = function () { return inp.value; };
            if (opts && opts.onChange) inp.addEventListener('change', function () { opts.onChange(inp.value); });
            return wrap;
        }
    };
    window.Folders = {
        bar: function () { return el('div', 'folders-bar'); },
        grid: function () { return el('div', 'folders-grid'); },
        filterItems: function (items) { return items; },
        moveSelect: function () { return el('button', 'tool-btn', 'Sposta'); },
        get: function () { return ''; }
    };

    /* ---------- handshake con il runner puppeteer (screenshot + attese) ---------- */
    window.__qaShot = function (name) {
        return new Promise(function (res) {
            QA.needShot = name;
            var iv = setInterval(function () {
                if (window.__SHOT_OK) { clearInterval(iv); window.__SHOT_OK = false; QA.needShot = null; res(true); }
            }, 40);
        });
    };
    window.__qaUntil = async function (fn, ms, step) {
        var t0 = Date.now(); ms = ms || 8000; step = step || 60;
        while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise(function (r) { setTimeout(r, step); }); }
        return fn() ? true : false;
    };
    window.__qaRect = function (elm) { var r = elm.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    window.__qaCheck = function (id, expected, ok, evidence) {
        QA.checks.push({ id: id, expected: expected, ok: !!ok, evidence: evidence });
        return !!ok;
    };
    QA.ready = true;
})();
