/* ============================================================
   tests/aiUi_smoke.test.js — H10/H11 smoke (T1)
   - monta app.js (namespace window.AIService) e verifica run()
     DEFENSIVE con pywebview assente -> {ok:false, fallback:true,
     badge:'AI non disponibile'} senza eccezioni
   - badgeEl (.ai-badge), showPreview [Accetta]/[Scarta] (Esc =
     Scarta, NESSUNA scrittura), showResult, askInputs, pending,
     registerUndo/withUndo/undo
   - 4 moduli con NUOVI bottoni H11 (notes, fogli, presentazioni,
     ripasso): bottoni/azioni esistono e click senza eccezioni
     (pywebview assente -> toast/badge 'AI non disponibile')
   Harness copiato dal pattern di tests/qaA_appunti.js (jsdom).
   Eseguire con: node tests/aiUi_smoke.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_APP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'app.js'), 'utf8');
const SRC_NOTES = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'notes.js'), 'utf8');
const SRC_FOGLI = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fogli.js'), 'utf8');
const SRC_PP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'presentazioni.js'), 'utf8');
const SRC_FP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const SRC_RIP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'ripasso.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeCtx2d(canvas) {
    const grad = { addColorStop() { } };
    const store = { canvas: canvas };
    return new Proxy(store, {
        get(t, p) {
            if (typeof p === 'symbol') return undefined;
            if (p === 'measureText') return s => ({ width: String(s == null ? '' : s).length * 7 });
            if (p === 'getImageData' || p === 'createImageData') {
                return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w || 1) * (h || 1) * 4)), width: w || 1, height: h || 1 });
            }
            if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
            if (p === 'createPattern') return () => null;
            if (p in t) return t[p];
            return () => undefined;
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}

// monta app.js SOLO per AIService (boot/router differiti con readyState=loading;
// se l'eval integrale non va a buon fine, si estrae il blocco AIService)
function makeAppEnv() {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window, doc = win.document;
    win.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx2d) this.__ctx2d = makeCtx2d(this);
        return this.__ctx2d;
    };
    win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
    win.alert = () => { }; win.confirm = () => false; win.prompt = () => null;
    let appErr = '', extracted = false;
    try {
        Object.defineProperty(win.Document.prototype, 'readyState', { configurable: true, get: function () { return 'loading'; } });
    } catch (e) { /* best effort */ }
    try { win.eval(SRC_APP); } catch (e) { appErr = String(e && e.message ? e.message : e); }
    if (!win.AIService) {
        try {
            const i = SRC_APP.indexOf('window.AIService = (function');
            if (i >= 0) { win.eval(SRC_APP.slice(i)); extracted = true; }
        } catch (e) { appErr += ' | extract: ' + String(e && e.message ? e.message : e); }
    }
    return { dom, win, doc, consoleErrors, appErr, extracted };
}

// ambiente modulo (pattern qaA): App stub + AIService estratto da app.js + moduli
function makeEnv(modules) {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window, doc = win.document;
    win.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx2d) this.__ctx2d = makeCtx2d(this);
        return this.__ctx2d;
    };
    win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
    win.alert = () => { }; win.confirm = () => true; win.prompt = () => null;
    win.document.elementFromPoint = () => null;
    const store = { seq: 1, items: [] };
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    function el(tag, cls, html) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    win.App = {
        el: el, esc: esc,
        style: css => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); },
        header: (t, d, btns) => {
            const h = el('div', 'app-header');
            h.appendChild(el('h2', null, t));
            if (d) h.appendChild(el('p', null, d));
            if (btns && btns.length) { const row = el('div', 'header-actions'); btns.forEach(b => row.appendChild(b)); h.appendChild(row); }
            return h;
        },
        empty: (icon, text, btnText, onClick) => {
            const d = el('div', 'app-empty');
            d.appendChild(el('p', null, text));
            if (btnText) { const b = el('button', 'btn-accent', btnText); if (onClick) b.addEventListener('click', onClick); d.appendChild(b); }
            return d;
        },
        ICONS: {}, fmtDate: s => String(s || ''), go: () => { },
        registerModule: m => { win.App._mod = m; }
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) { const i = store.items.filter(x => x.id === p.id)[0]; if (i) { Object.assign(i, p); return Object.assign({}, i); } }
            const n = Object.assign({ id: 's' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async () => { }, renameItem: async () => { }, duplicateItem: async () => { },
        listSubjects: async () => [], listMaterials: async () => [],
        hasBackend: async () => false, pickAsset: async () => null, assetUrl: s => s,
        openFilePath: async () => ({ success: true })
    };
    win.SubjectInput = {
        normalize: s => String(s || '').trim(), remember: () => Promise.resolve(),
        create: opts => {
            const wrap = el('div', 'subject-input');
            const inp = el('input', 'subject-field');
            wrap.appendChild(inp);
            wrap.getValue = () => inp.value;
            wrap.getInput = () => inp;
            return wrap;
        }
    };
    win.Folders = {
        bar: () => el('div', 'folders-bar'), grid: () => el('div', 'folders-grid'),
        filterItems: items => items, moveSelect: () => el('button', 'tool-btn', 'Sposta'),
        get: () => '', list: async () => []
    };
    win.StudyAsk = () => Promise.resolve('x');
    // monta app.js (solo blocco AIService) — App resta lo stub
    try {
        const i = SRC_APP.indexOf('window.AIService = (function');
        if (i >= 0) win.eval(SRC_APP.slice(i));
    } catch (e) { consoleErrors.push('AISERVICE_EVAL: ' + String(e && e.message ? e.message : e)); }
    (modules || []).forEach(src => { win.eval(src); });
    return { dom, win, doc, store, consoleErrors, mod: win.App._mod };
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function escKey(env, target) { (target || env.doc.body).dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
function toasts(env) { return $$(env, '.ai-toast').map(t => t.textContent); }
function btnByText(env, txt) {
    return $$(env, 'button').filter(b => (b.textContent || '').trim() === txt)[0];
}

// ===============================================================
// T1) AIService (app.js): run DEFENSIVE + API
// ===============================================================
async function t1() {
    console.log('== T1: AIService (H10) su app.js ==');
    const env = makeAppEnv();
    const AI = env.win.AIService;
    ok(!!AI, 'T1.1 window.AIService definito montando app.js', env.appErr + (env.extracted ? ' (estratto)' : ''));
    if (!AI) return;
    ok(typeof AI.run === 'function' && typeof AI.runFor === 'function' &&
        typeof AI.pending === 'function' && typeof AI.withPending === 'function' &&
        typeof AI.badgeEl === 'function' && typeof AI.showPreview === 'function' &&
        typeof AI.showResult === 'function' && typeof AI.askInputs === 'function' &&
        typeof AI.toast === 'function' && typeof AI.registerUndo === 'function' &&
        typeof AI.withUndo === 'function' && typeof AI.undo === 'function' &&
        typeof AI.isFallback === 'function' && typeof AI.needsApproval === 'function' &&
        typeof AI.previewText === 'function' && Array.isArray(AI._undo),
        'T1.2 API AIService completa');

    const r1 = await AI.run('F01', { text: 'x' });
    ok(r1 && r1.ok === false && r1.fallback === true && r1.badge === 'AI non disponibile' && r1.data === null,
        'T1.3 run con pywebview assente -> fallback badge, nessuna eccezione',
        JSON.stringify(r1));

    const b1 = AI.badgeEl({ badge: 'cache esatta' });
    ok(b1 && b1.className === 'ai-badge' && b1.textContent === 'cache esatta', 'T1.4 badgeEl usa result.badge');
    ok(AI.badgeEl({}).textContent === 'generato da AI', 'T1.4b badgeEl default "generato da AI"');

    const btn = env.doc.createElement('button');
    env.doc.body.appendChild(btn);
    const r2 = await AI.runFor(btn, 'F05', {});
    ok(r2 && r2.fallback === true, 'T1.5 runFor -> fallback');
    ok(btn.disabled === false && !btn.querySelector('.ai-pending'), 'T1.5b pending ripristina pulsante/indicatore');
    ok(toasts(env).some(t => t.indexOf('AI non disponibile') >= 0), 'T1.5c toast discreto "AI non disponibile"', toasts(env).join('|'));

    env.win.pywebview = { api: {} };
    const r3 = await AI.run('F07', {});
    ok(r3 && r3.fallback === true, 'T1.6 api senza ai_run_function -> fallback');
    env.win.pywebview = { api: { ai_run_function: () => Promise.reject(new Error('boom')) } };
    const r4 = await AI.run('F07', {});
    ok(r4 && r4.fallback === true && /boom/.test(r4.error || ''), 'T1.7 api che rifiuta -> fallback catturato', JSON.stringify(r4));
    env.win.pywebview = { api: { ai_run_function: async () => JSON.stringify({ ok: true, data: { text: 'ciao' }, badge: 'cache esatta' }) } };
    const r5 = await AI.run('F07', {});
    ok(r5 && r5.ok === true && r5.badge === 'cache esatta' && r5.data && r5.data.text === 'ciao', 'T1.8 risposta JSON stringa parsata, badge preservato');
    env.win.pywebview = { api: { ai_run_function: async () => ({ ok: true, data: { outline: ['a'] }, approval_required: true, badge: 'bozza da cache (da revisionare)' }) } };
    const r6 = await AI.run('F10', {});
    ok(r6 && r6.approval_required === true && AI.needsApproval(r6) === true, 'T1.9 approval_required rispettato (solo preview)');
    ok(r6.badge === 'bozza da cache (da revisionare)', 'T1.9b badge bozza da cache preservato');
    delete env.win.pywebview;

    // showPreview: Accetta / Scarta / Esc — nessuna scrittura prima di Accetta
    let acc = 0, rej = 0;
    AI.showPreview({ ok: true, data: { text: 'OUTPUT' }, badge: 'generato da AI' }, () => acc++, () => rej++);
    let ov = $(env, '.ai-preview-ov');
    ok(!!ov && !!ov.querySelector('.ai-badge') && /OUTPUT/.test(ov.querySelector('pre').textContent),
        'T1.10 showPreview: overlay + badge + contenuto');
    click(env, ov.querySelector('.ai-pv-accept'));
    ok(acc === 1 && rej === 0 && !$(env, '.ai-preview-ov'), 'T1.11 Accetta -> onAccept, overlay chiuso');
    AI.showPreview({ ok: true, data: 'X' }, () => acc++, () => rej++);
    escKey(env);
    await sleep(20);
    ok(acc === 1 && rej === 1 && !$(env, '.ai-preview-ov'), 'T1.12 Esc -> Scarta (onReject), nessuna accettazione');

    AI.showResult({ ok: true, data: 'RIS' });
    ov = $(env, '.ai-preview-ov');
    ok(!!ov && !ov.querySelector('.ai-pv-accept') && /RIS/.test(ov.querySelector('pre').textContent), 'T1.13 showResult: sola lettura con Chiudi');
    click(env, ov.querySelector('.ai-pv-reject'));
    ok(!$(env, '.ai-preview-ov'), 'T1.13b showResult chiude');

    // askInputs: submit + Esc
    const p1 = AI.askInputs('Titolo', [{ name: 'argomento', label: 'Argomento' }, { name: 'giorni', label: 'Giorni', type: 'number', value: 7 }], 'Vai');
    ov = $(env, '.ai-preview-ov');
    ok(!!ov && ov.querySelectorAll('input').length === 2, 'T1.14 askInputs: form con 2 campi');
    const inputs = ov.querySelectorAll('input');
    inputs[0].value = 'Rivuzione Francese';
    click(env, ov.querySelector('.ai-pv-accept'));
    const v1 = await p1;
    ok(v1 && v1.argomento === 'Rivuzione Francese' && v1.giorni === 7, 'T1.14b askInputs valori (text+number)', JSON.stringify(v1));
    const p2 = AI.askInputs('Altro', [{ name: 'x', label: 'X' }]);
    escKey(env);
    const v2 = await p2;
    ok(v2 === null, 'T1.15 askInputs Esc -> null');

    // undo: hook dal modulo + stack locale
    let snap = 0;
    AI.registerUndo(() => snap++);
    AI.withUndo(() => { });
    ok(snap === 1, 'T1.16 withUndo chiama hook registerUndo dello snapshot');
    let restored = 0;
    AI.withUndo(() => { }, () => { restored++; });
    const did = AI.undo();
    ok(did === true && restored === 1, 'T1.17 undo() chiama l ultimo snapshot locale');
    ok(AI.undo() === false && restored === 1, 'T1.18 undo su stack vuoto -> false');

    ok(env.consoleErrors.length === 0, 'T1.19 zero eccezioni console in T1', env.consoleErrors.join(' | '));
}

// ===============================================================
// T2) notes.js: F01/F05 su selezione testo
// ===============================================================
async function t2() {
    console.log('== T2: notes.js — Flashcard dalla selezione / Migliora testo ==');
    const env = makeEnv([SRC_NOTES]);
    const store = env.store;
    store.items.push({ id: 'n1', kind: 'note', title: 'Nota', content: '', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' });
    const cont = $(env, '#main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: 'n1' });
    await sleep(300);

    const pill = $(env, '.fn-pill-left');
    ok(!!pill, 'T2.0 pillL presente');
    // R19 A1: il tasto si chiama "Flashcard" (titolo nuovo) e F05 e' rimosso
    const bF1 = pill && pill.querySelector('button[title^="Genera flashcard dalla nota/selezione"]');
    const bF5 = pill && pill.querySelector('button[title^="Migliora testo"]');
    ok(!!bF1, 'T2.1 bottone "Flashcard" (titolo R19) presente');
    ok(!bF5, 'T2.2 tasto "Migliora" F05 RIMOSSO dalla toolbar (R19 A1)');
    if (!bF1) { ok(env.consoleErrors.length === 0, 'T2.9 zero eccezioni console', env.consoleErrors.join(' | ')); return; }

    // nessuna selezione -> toast, nessuna eccezione
    click(env, bF1);
    await sleep(60);
    ok(toasts(env).some(t => t.indexOf('Nessun testo') >= 0), 'T2.3 nota vuota -> toast "Nessun testo", nessuna eccezione', toasts(env).join('|'));

    // selezione via textarea attiva -> run() fallback
    const ta = env.doc.createElement('textarea');
    env.doc.body.appendChild(ta);
    ta.value = 'testo di prova da migliorare';
    ta.focus();
    ta.setSelectionRange(0, 5);
    click(env, bF1);
    await sleep(150);
    ok(toasts(env).some(t => t.indexOf('AI non disponibile') >= 0), 'T2.4 F01 con pywebview assente -> badge/toast "AI non disponibile"', toasts(env).join('|'));
    ok(!$(env, '.ai-preview-ov'), 'T2.5 nessun pannello anteprima su fallback (solo toast)');

    // R19: Flashcard dalla NOTA INTERA (nessuna selezione, contenuto presente)
    // + F05 irraggiungibile dalla toolbar
    ta.blur();
    if (env.win.getSelection) env.win.getSelection().removeAllRanges();
    Array.from(env.doc.querySelectorAll('.ai-toast')).forEach(t => t.remove());
    store.items.filter(x => x.id === 'n1')[0].content = JSON.stringify({
        mode: 'quaderno', sheet: 'quadretti', w: 1600, h: 1100, page: 0,
        pages: [{ objects: [{ t: 'text', x: 60, y: 60, w: 420, h: 30,
            text: 'testo intero della nota per flashcard', size: 15, color: '#141414' }] }]
    });
    cont.innerHTML = '';
    env.mod.open(cont, { open: 'n1' });
    await sleep(300);
    const pill2 = $(env, '.fn-pill-left');
    const bF1b = pill2 && pill2.querySelector('button[title^="Genera flashcard dalla nota/selezione"]');
    ok(!!bF1b, 'T2.6 bottone Flashcard presente anche a riapertura');
    if (bF1b) {
        click(env, bF1b);
        await sleep(150);
        ok(toasts(env).some(t => t.indexOf('AI non disponibile') >= 0),
            'T2.7 senza selezione -> F01 eseguito sulla NOTA INTERA (fallback R19)',
            toasts(env).join('|'));
    }
    ok(!$(env, '.fn-pill-left button[title^="Migliora testo"]'),
        'T2.8 F05 mai raggiungibile dalla toolbar (anche a riapertura)');
    ok(env.consoleErrors.length === 0, 'T2.9 zero eccezioni console', env.consoleErrors.join(' | '));
}

// ===============================================================
// T3) fogli.js: F07 Spiega formula / F08 Descrivi -> formula
// ===============================================================
async function t3() {
    console.log('== T3: fogli.js — Spiega formula / Descrivi -> formula ==');
    const env = makeEnv([SRC_FOGLI]);
    const id = 'f' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'foglio', title: 'Foglio',
        content: JSON.stringify({ sheets: [{ cells: { 'A1': { v: '10' }, 'A2': { v: '20' }, 'D1': { f: '=SUM(A1:A2)' } } }] }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = $(env, '#main');
    cont.innerHTML = '';
    if (!env.win.StudyTools || !env.win.StudyTools.fogli) {
        ok(false, 'T3.0 StudyTools.fogli definito');
        return;
    }
    env.win.StudyTools.fogli.render(cont, { open: id });
    await sleep(700);

    const bExp = btnByText(env, 'Spiega formula');
    const bDesc = btnByText(env, 'Descrivi → formula');
    ok(!!bExp, 'T3.1 bottone "Spiega formula" presente');
    ok(!!bDesc, 'T3.2 bottone "Descrivi → formula" presente');
    if (!bExp || !bDesc) { ok(env.consoleErrors.length === 0, 'T3.7 zero eccezioni console', env.consoleErrors.join(' | ')); return; }

    const td = env.doc.querySelector('td[data-ref="D1"]');
    ok(!!td, 'T3.0b cella D1 presente');
    if (td) {
        td.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0 }));
        await sleep(60);
        click(env, bExp);
        await sleep(150);
        ok(toasts(env).some(t => t.indexOf('AI non disponibile') >= 0), 'T3.3 F07 con pywebview assente -> "AI non disponibile"', toasts(env).join('|'));
        ok(!$(env, '.ai-preview-ov'), 'T3.4 nessun pannello su fallback');
    }

    click(env, bDesc);
    await sleep(80);
    const ov = $(env, '.ai-preview-ov');
    ok(!!ov && ov.querySelector('input') != null, 'T3.5 F08 apre form descrizione');
    if (ov) {
        const bCancel = ov.querySelector('.ai-pv-reject');
        click(env, bCancel);
        await sleep(30);
        ok(!$(env, '.ai-preview-ov'), 'T3.6 Annulla chiude senza scrittura');
    }
    ok(env.consoleErrors.length === 0, 'T3.7 zero eccezioni console', env.consoleErrors.join(' | '));
}

// ===============================================================
// T4) presentazioni.js: menu AI (F10 outline / F11 bullet / F12 note)
// ===============================================================
async function t4() {
    console.log('== T4: presentazioni.js — Genera outline / bullet / note ==');
    const env = makeEnv([SRC_PP]);
    const id = 'p' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'presentazione', title: 'Presentazione',
        content: JSON.stringify({ slides: [{ id: 's1', bg: '#f7f5ef', elements: [], transition: 'none', layout: '' }] }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = $(env, '#main');
    cont.innerHTML = '';
    if (!env.win.StudyTools || !env.win.StudyTools.presentazioni) {
        ok(false, 'T4.0 StudyTools.presentazioni definito');
        return;
    }
    env.win.StudyTools.presentazioni.render(cont, { open: id });
    await sleep(350);

    const bar = $(env, '.pp-bar');
    ok(!!bar, 'T4.0b toolbar presente');
    const aiBtn = bar && bar.querySelector('button[title*="Genera outline"]');
    ok(!!aiBtn, 'T4.1 bottone AI in toolbar presente (max 1-2 per contesto)');
    if (!aiBtn) { ok(env.consoleErrors.length === 0, 'T4.7 zero eccezioni console', env.consoleErrors.join(' | ')); return; }

    const btnCount = bar.querySelectorAll('button').length;
    ok(btnCount > 0 && btnCount <= 16, 'T4.2 toolbar compatta (bottoni=' + btnCount + ')');

    click(env, aiBtn);
    await sleep(60);
    const menu = $(env, '.pp-menu');
    ok(!!menu, 'T4.3 menu contestuale AI aperto');
    if (menu) {
        const items = Array.from(menu.querySelectorAll('button')).map(b => (b.textContent || '').trim());
        ok(items.some(t => t === 'Genera outline'), 'T4.4 voce "Genera outline" (F10)');
        ok(items.some(t => t === 'Genera bullet'), 'T4.5 voce "Genera bullet" (F11)');
        ok(items.some(t => t === 'Note relatore'), 'T4.5b voce "Note relatore" (F12)');
        const bOut = Array.from(menu.querySelectorAll('button')).filter(b => (b.textContent || '').trim() === 'Genera outline')[0];
        click(env, bOut);
        await sleep(80);
        const ov = $(env, '.ai-preview-ov');
        ok(!!ov && ov.querySelector('input') != null, 'T4.6 F10 apre form argomento (placeholder)');
        if (ov) {
            ov.querySelector('input').value = 'La Prima Guerra Mondiale';
            click(env, ov.querySelector('.ai-pv-accept'));
            await sleep(150);
            ok(toasts(env).some(t => t.indexOf('AI non disponibile') >= 0), 'T4.6b F10 con pywebview assente -> "AI non disponibile"', toasts(env).join('|'));
            ok(!$(env, '.ai-preview-ov'), 'T4.6c nessuna anteprima/scrittura su fallback');
        }
    }
    ok(env.consoleErrors.length === 0, 'T4.7 zero eccezioni console', env.consoleErrors.join(' | '));
}

// ===============================================================
// T5) ripasso.js: F04 "Valuta con AI" dopo risposta
// ===============================================================
async function t5() {
    console.log('== T5: ripasso.js — Valuta con AI (tutor mode) ==');
    const env = makeEnv([SRC_RIP]);
    env.store.items.push({
        id: 'm1', kind: 'mazzo', title: 'Mazzo Test',
        content: JSON.stringify({ cards: [{ q: 'Domanda 1', a: 'Risposta 1', box: 0 }, { q: 'Domanda 2', a: 'Risposta 2', box: 0 }], color: '#f9974a' }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = $(env, '#main');
    cont.innerHTML = '';
    try { await env.mod.open(cont, {}); } catch (e) { ok(false, 'T5.0 open non lancia', String(e && e.message)); }
    await sleep(300);

    const bAvvia = btnByText(env, 'Avvia studio');
    ok(!!bAvvia, 'T5.1 mazzo con "Avvia studio" presente');
    if (!bAvvia) { ok(env.consoleErrors.length === 0, 'T5.8 zero eccezioni console', env.consoleErrors.join(' | ')); return; }
    click(env, bAvvia);
    await sleep(250);

    const fc = $(env, '.flashcard');
    ok(!!fc, 'T5.2 study: flashcard presente');
    if (fc) { click(env, fc); await sleep(150); }

    const bSo = btnByText(env, 'So');
    ok(!!bSo && !bSo.disabled, 'T5.3 bottone "So" attivo dopo reveal');
    if (bSo) { click(env, bSo); await sleep(250); }

    const bVal = btnByText(env, 'Valuta con AI');
    ok(!!bVal, 'T5.4 bottone "Valuta con AI" presente dopo la risposta');
    if (bVal) {
        ok(!bVal.disabled, 'T5.5 abilitato dopo la risposta (stato async pending)');
        click(env, bVal);
        await sleep(150);
        ok(toasts(env).some(t => t.indexOf('AI non disponibile') >= 0), 'T5.6 F04 con pywebview assente -> "AI non disponibile" (fallback backend atteso in produzione)', toasts(env).join('|'));
        ok(!$(env, '.ai-preview-ov'), 'T5.7 nessun pannello su fallback');
    }
    ok(env.consoleErrors.length === 0, 'T5.8 zero eccezioni console', env.consoleErrors.join(' | '));
}

// ===============================================================
// T5b) ripasso.js + FontiPanel (R21 B5): creazione mazzo e generazione
// ===============================================================
async function t5b() {
    console.log('== T5b: ripasso.js - FontiPanel montato (contesto ripasso) ==');
    // loader: fonti_panel deve caricare PRIMA di ripasso.js anche in index.html
    let idxHtml = '';
    try { idxHtml = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8'); } catch (e) { /* ok */ }
    const iPf = idxHtml.indexOf('js/modules/fonti_panel.js');
    const iRip = idxHtml.indexOf('js/modules/ripasso.js');
    ok(iPf >= 0 && iRip >= 0 && iPf < iRip, 'T5b.0 index.html carica fonti_panel PRIMA di ripasso.js', 'p=' + iPf + ' r=' + iRip);

    const env = makeEnv([SRC_FP, SRC_RIP]);
    ok(!!env.win.FontiPanel && typeof env.win.FontiPanel.create === 'function',
        'T5b.0b loader: FontiPanel montato PRIMA di SRC_RIP (ordine moduli)');
    env.store.items.push({
        id: 'm1', kind: 'mazzo', title: 'Mazzo Fonti',
        content: JSON.stringify({ cards: [{ q: 'Domanda 1', a: 'Risposta 1', box: 0 }], color: '#f9974a' }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    env.store.items.push({
        id: 'nf1', kind: 'note', title: 'Appunti Fotosintesi',
        content: JSON.stringify({ objects: [{ t: 'text', x: 40, y: 40, w: 300, h: 30,
            text: 'Fotosintesi: il processo con cui la pianta produce glucosio usando la luce solare.', size: 14, color: '#141414' }] }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = $(env, '#main');
    cont.innerHTML = '';
    try { await env.mod.open(cont, { open: 'm1' }); } catch (e) { ok(false, 'T5b.1 open editor non lancia', String(e && e.message)); }
    await sleep(300);

    const bFonti = btnByText(env, 'Fonti');
    ok(!!bFonti && !!$(env, '.split'), 'T5b.2 bottone "Fonti" nell editor mazzo (.split attivo)');
    if (!bFonti) { ok(env.consoleErrors.length === 0, 'T5b.16 zero eccezioni console', env.consoleErrors.join(' | ')); return; }

    click(env, bFonti);
    await sleep(120);
    const fp = $(env, '.fp21-root');
    ok(!!fp && fp.getAttribute('data-fp21') === 'ripasso', 'T5b.3 .fp21-root aperto con contesto "ripasso"');
    const bIns0 = $(env, '.fp21-insert');
    ok(!!bIns0 && (bIns0.textContent || '').trim() === 'Inserisci nel deck', 'T5b.4 label insert "Inserisci nel deck"');
    await sleep(200);   // refresh() asincrono: elenco fonti
    const item = $(env, '.fp21-item');
    ok(!!item, 'T5b.5 fonte (nota) elencata nel pannello');
    if (item) {
        click(env, item);
        await sleep(200);   // previewFonte21 async -> insert abilitato
        const bIns = $(env, '.fp21-insert');
        ok(!!bIns && !bIns.disabled, 'T5b.6 insert abilitato dopo selezione della fonte');
        if (bIns) {
            click(env, bIns);
            await sleep(250);
            const titles = $$(env, '.pane .pane-list-item .pli-title').map(x => x.textContent);
            ok(titles.length === 2 && titles[1].indexOf('Da: Appunti Fotosintesi') >= 0,
                'T5b.7 card inserita con q "Da: <titolo> (<tipo>)"', titles.join(' | '));
            let meta = null;
            try { meta = JSON.parse((env.store.items.filter(x => x.id === 'm1')[0] || {}).content || ''); } catch (e) { meta = null; }
            ok(!!meta && !!(meta.cards || [])[1] && !!meta.cards[1].fp &&
                meta.cards[1].fp.titolo === 'Appunti Fotosintesi' && meta.cards[1].fp.fonteId === 'nf1',
                'T5b.7b card.fp (provenienza) persistita nel mazzo',
                meta ? JSON.stringify(((meta.cards || [])[1] || {}).fp) : 'content non parsabile');
            ok(!!meta && Array.isArray(meta.fpSources) && meta.fpSources.length === 1 &&
                meta.fpSources[0].fonteId === 'nf1' && typeof meta.fpSources[0].ts === 'number',
                'T5b.7c deck.fpSources nei metadati (content JSON)',
                meta ? JSON.stringify(meta.fpSources) : '-');
            const bUndo = btnByText(env, 'Annulla inserimento');
            ok(!!bUndo, 'T5b.8 bottone "Annulla inserimento" presente');
            if (bUndo) {
                click(env, bUndo);
                await sleep(250);
                ok($$(env, '.pane .pane-list-item .pli-title').length === 1,
                    'T5b.8b undo: card da fonte rimossa');
                let meta2 = null;
                try { meta2 = JSON.parse((env.store.items.filter(x => x.id === 'm1')[0] || {}).content || ''); } catch (e) { meta2 = null; }
                ok(!!meta2 && (meta2.cards || []).length === 1 &&
                    (!meta2.fpSources || meta2.fpSources.length === 0),
                    'T5b.8c undo: fpSources azzerate nel salvataggio',
                    JSON.stringify(meta2 && meta2.fpSources));
            }
        }
    }

    /* --- flusso generazione: "Usa una fonte..." porta il testo al generatore --- */
    const bGen = btnByText(env, 'Genera da appunti');
    ok(!!bGen, 'T5b.9 bottone "Genera da appunti" presente');
    if (bGen) {
        click(env, bGen);
        await sleep(150);
        const bUsa = btnByText(env, 'Usa una fonte\u2026');
        ok(!!bUsa, 'T5b.10 selettore "Usa una fonte..." nel pannello generazione');
        if (bUsa) {
            click(env, bUsa);
            await sleep(250);
            ok(!!$(env, '.fp21-root'), 'T5b.11 pannello fonti aperto per la generazione');
            const it2 = $(env, '.fp21-item');
            if (it2) {
                click(env, it2);
                await sleep(200);
                const bIns2 = $(env, '.fp21-insert');
                if (bIns2) {
                    click(env, bIns2);
                    await sleep(250);
                    ok(!$(env, '.fp21-root'), 'T5b.12 onInsert genera: pannello si chiude');
                    const chip = $(env, '.rip-fp-src');
                    ok(!!chip && (chip.textContent || '').indexOf('Appunti Fotosintesi') >= 0,
                        'T5b.12b chip "Fonte: ..." nel flusso di generazione',
                        chip ? chip.textContent : 'assente');
                    ok($$(env, '.pane .pane-list-item .pli-title').length === 1,
                        'T5b.12c onInsert NON crea card: testo portato al generatore');
                    const bEst = btnByText(env, 'Estrai bozza');
                    if (bEst) {
                        click(env, bEst);
                        await sleep(300);
                        const ripT = $$(env, '.rip-toast').map(x => x.textContent || '');
                        const allT = ripT.concat(toasts(env));
                        ok(allT.some(x => x.indexOf('coppie aggiunte') >= 0),
                            'T5b.13 Estrai bozza usa il testo della fonte', allT.join('|'));
                        ok($$(env, '.pane .pane-list-item .pli-title').length === 2,
                            'T5b.13b coppie estratte aggiunte al deck');
                    }
                }
            }
        }
    }

    /* --- destroy() al teardown --- */
    const bFonti2 = btnByText(env, 'Fonti');
    if (bFonti2) {
        click(env, bFonti2);
        await sleep(100);
        ok(!!$(env, '.fp21-root'), 'T5b.14 pannello riapribile dall editor');
    }
    try { env.mod.close(); } catch (e) { ok(false, 'T5b.15 close non lancia', String(e && e.message)); }
    await sleep(60);
    ok(!$(env, '.fp21-root'), 'T5b.15b destroy() del pannello al close() del modulo');
    ok(env.consoleErrors.length === 0, 'T5b.16 zero eccezioni console', env.consoleErrors.join(' | '));
}

async function main() {
    try {
        await t1();
        await t2();
        await t3();
        await t4();
        await t5();
        await t5b();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split(String.fromCharCode(10)).slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('================================================');
    console.log('RISULTATI AIUI_SMOKE: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
