/* ============================================================
   tests/qaA_appunti.js — QA-A (T1 indipendente): Appunti (notes.js)
   1) popover: UNICO outside-click + Esc chiudono popColor/popHelp,
      toggle dei trigger non si incastra, mutual-exclusion intact,
      UN solo listener document-capture (nessun fantasma al close)
   2) stato strumento: dopo OGNI cambio tool (preset matita/pennarello
      attivo) ESATTAMENTE 1 bottone .active tra [data-tool]/[data-preset]
      (regola "esattamente un bottone", fix B1/B2)
   3) toggle "Migliora scrittura" = classe .mode (bordo, background
      trasparente) e NON conta come data-tool attivo (fix B5)
   4) pannello "Fonti" in pillL: apre, elenca fonti (mock StudyStore),
      ricerca filtra in tempo reale, anteprima, inserimento reversibile
      (oggetto t:'text' / t:'file' salvato nel doc), chiusura esplicita
   5) zero eccezioni console (console.error + jsdomError)

   Verifica INDIPENDENTE (jsdom: logica/struttura, NON geometria reale).
   Harness copiato dal pattern di tests/qa4_matrix.js (nessun import di
   file modificabili da altri). Prodotto in LETTURA.

   Eseguire con: node tests/qaA_appunti.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_PANEL = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const SRC_NOTES = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'notes.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------
// Ambiente DOM + stub (pattern qa4_matrix) + canvas stub + console
// ---------------------------------------------------------------
function makeCtx2d(canvas) {
    const grad = { addColorStop() { } };
    const store = { canvas: canvas };
    return new Proxy(store, {
        get(t, p) {
            if (typeof p === 'symbol') return undefined;
            if (p === 'measureText') return s => ({ width: String(s == null ? '' : s).length * 7 });
            if (p === 'getImageData' || p === 'createImageData') {
                return (x, y, w, h) => ({
                    data: new Uint8ClampedArray(Math.max(4, (w || 1) * (h || 1) * 4)),
                    width: w || 1, height: h || 1
                });
            }
            if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
            if (p === 'createPattern') return () => null;
            if (p in t) return t[p];
            return () => undefined; // metodi di disegno = no-op
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}

function makeEnv() {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    // 'warn'/'log'/'info' NON contano come eccezioni

    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
        virtualConsole: vc
    });
    const win = dom.window;
    const doc = win.document;

    // canvas: jsdom non ha il modulo canvas -> stub prima del load di notes.js
    win.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx2d) this.__ctx2d = makeCtx2d(this);
        return this.__ctx2d;
    };
    win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
    win.alert = () => { };
    win.confirm = () => false;
    // R21: backend mock per la preview .md del componente FontiPanel
    // (solo i .md: i pdf restituiscono null -> fallback del componente)
    win.pywebview = {
        api: {
            read_material_text: async p => (/\.md$/i.test(String(p || '')) ? ({
                success: true, kind: 'md', name: 'appunti-md.md',
                text: '# Titolo MD Appunti\n\nParagrafo con **grasso**.'
            }) : null)
        }
    };

    const store = {
        seq: 1,
        items: [
            { id: 'n1', kind: 'note', title: 'Nota QA-A', content: '', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' },
            { id: 'r1', kind: 'riassunto', title: 'Riassunto Alfa', content: JSON.stringify({ text: 'Contenuto riassunto alfa.' }), materia: 'Storia', tags: '', description: '', thumbnail: '', folder_id: '' },
            { id: 'd1', kind: 'documento', title: 'Documento Beta', content: 'Contenuto documento beta', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' }
        ],
        mats: [
            { name: 'Libro Gamma', path: 'C:/docs/libro-gamma.pdf', indexed_at: '2026-01-05' },
            { name: 'appunti-md.md', path: 'C:/docs/appunti-md.md', indexed_at: '2026-01-06' }
        ]
    };
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    function el(tag, cls, text) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
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
        empty: () => el('div', 'app-empty'),
        ICONS: { notes: '' },
        fmtDate: s => String(s || ''),
        go: () => { },
        registerModule: m => { win.App._mod = m; }
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) {
                const i = store.items.filter(x => x.id === p.id)[0];
                if (i) { Object.assign(i, p); return Object.assign({}, i); }
            }
            const n = Object.assign({ id: 's' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async id => { store.items = store.items.filter(i => i.id !== id); },
        renameItem: async () => { },
        listSubjects: async () => [],
        listMaterials: async () => store.mats.map(m => Object.assign({}, m)),
        hasBackend: async () => false,
        pickAsset: async () => null,
        assetUrl: s => s,
        openFilePath: async () => ({ success: true })
    };
    win.SubjectInput = {
        normalize: s => String(s || '').trim(),
        remember: () => Promise.resolve(),
        create: opts => {
            const wrap = el('div', 'subject-input');
            const inp = el('input', 'subject-field');
            wrap.appendChild(inp);
            wrap.getValue = () => inp.value;
            return wrap;
        }
    };
    win.Folders = {
        bar: () => el('div', 'folders-bar'),
        grid: () => el('div', 'folders-grid'),
        filterItems: items => items,
        moveSelect: () => el('button', 'tool-btn', 'Sposta'),
        get: () => ''
    };

    // traccia dei listener document 'click' capture (A1: 1 aperto, 0 a close)
    const live = new Set();
    const origAdd = doc.addEventListener.bind(doc);
    const origRem = doc.removeEventListener.bind(doc);
    doc.addEventListener = function (type, fn, opts) {
        if (type === 'click' && opts === true) live.add(fn);
        return origAdd(type, fn, opts);
    };
    doc.removeEventListener = function (type, fn, opts) {
        if (type === 'click' && opts === true) live.delete(fn);
        return origRem(type, fn, opts);
    };

    // R21 B1: componente FontiPanel caricato PRIMA di notes.js (stesso
    // ordine di index.html/_ink_env)
    win.eval(SRC_PANEL);
    win.eval(SRC_NOTES);
    return { dom, win, doc, store, mod: win.App._mod, live, consoleErrors };
}

async function openNote(env, id) {
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: id });
    await sleep(260); // getItem + buildChrome + rAF + setTimeout(0) listener
}

// ---- helpers ----
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function escKey(env, target) {
    (target || env.doc.body).dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}
function setInput(env, input, v) {
    input.value = v;
    input.dispatchEvent(new env.win.Event('input', { bubbles: true }));
}
function activeIds(env) {
    return $$(env, '[data-tool],[data-preset]')
        .filter(b => b.classList.contains('active'))
        .map(b => b.getAttribute('data-tool') || b.getAttribute('data-preset'))
        .join(',');
}
function fnTbActiveCount(env) { return $$(env, '.fn-tb.active').length; }
function noteObjects(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    const d = JSON.parse(it.content);
    if (Array.isArray(d.pages) && d.pages.length) return d.pages[0].objects || [];
    return d.objects || [];
}
const hasFonteText = objs => objs.some(o => o.t === 'text' && /Fonte:/.test(o.text || ''));
const hasFilePath = (objs, p) => objs.some(o => o.t === 'file' && o.path === p);

// ===============================================================
// 1) POPOVER: outside-click + Esc (A1)
// ===============================================================
async function popoverCheck(env) {
    console.log('== QA-A-1: popover outside-click / Esc / trigger ==');
    const colorBtn = $(env, '[data-color]');
    const helpBtn = $(env, '[data-help]');
    const popColor = $(env, '.fn-pop-color');
    const popHelp = $(env, '.fn-pop-help');
    const canvas = $(env, '.nt-stage canvas');
    ok(!!colorBtn && !!helpBtn && !!popColor && !!popHelp && !!canvas, '1.0 elementi base presenti');

    // outside-click chiude popColor
    click(env, colorBtn);
    ok(popColor.classList.contains('show'), '1.1 click trigger apre popColor');
    canvas.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(20);
    ok(!popColor.classList.contains('show'), '1.2 outside-click (canvas) chiude popColor');

    // Esc chiude popColor
    click(env, colorBtn);
    ok(popColor.classList.contains('show'), '1.3 popColor riaperto');
    escKey(env);
    await sleep(20);
    ok(!popColor.classList.contains('show'), '1.4 Esc (window) chiude popColor');

    // outside-click chiude popHelp
    click(env, helpBtn); // toggle ON -> apre popHelp
    await sleep(20);
    ok(popHelp.classList.contains('show'), '1.5 toggle Migliora scrittura apre popHelp');
    canvas.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(20);
    ok(!popHelp.classList.contains('show'), '1.6 outside-click chiude popHelp');
    ok(helpBtn.classList.contains('mode'), '1.7 popHelp chiuso ma toggle resta acceso (mode)');

    // toggle del trigger non si incastra (click sullo stesso bottone)
    click(env, helpBtn); // toggle OFF -> closeAllPops + mode via
    await sleep(20);
    ok(!helpBtn.classList.contains('mode'), '1.8 toggle OFF rimuove .mode e chiude');
    click(env, colorBtn);
    ok(popColor.classList.contains('show'), '1.9 trigger riapre (nessun incastramento outside-click)');
    click(env, colorBtn);
    ok(!popColor.classList.contains('show'), '1.10 secondo click sul trigger richiude');

    // mutual exclusion + Esc da input dentro il popover
    click(env, colorBtn);
    const titleBtn = $(env, '.fn-title');
    click(env, titleBtn);
    await sleep(20);
    const popMeta = $(env, '.fn-pop-meta');
    ok(popMeta.classList.contains('show') && !popColor.classList.contains('show'),
        '1.11 mutual exclusion: trigger popMeta apre meta e chiude color');
    const metaInput = popMeta.querySelector('input[type=text]');
    ok(!!metaInput, '1.12 popMeta contiene input');
    if (metaInput) {
        escKey(env, metaInput); // da dentro il popover (input) -> deve chiudere
        await sleep(20);
        ok(!popMeta.classList.contains('show'), '1.13 Esc da input del popover chiude (funziona dai popover)');
    }

    // Esc senza popover aperti: nessun errore, nessun effetto collaterale
    escKey(env);
    await sleep(10);
    ok(activeIds(env) === 'penna', '1.14 Esc senza popover non altera lo strumento', 'ids=' + activeIds(env));

    // UN solo listener document-capture, rimosso al close
    ok(env.live.size === 1, '1.15 ESATTAMENTE 1 listener document click-capture', 'n=' + env.live.size);
}

// ===============================================================
// 2) STATO STRUMENTO: regola "esattamente UN bottone" (A2/B1/B2)
// ===============================================================
async function toolStateCheck(env) {
    console.log('== QA-A-2: stato strumento (esattamente 1 attivo) ==');
    const TOOLS = ['penna', 'evidenziatore', 'gomma', 'testo', 'lazo', 'selezione'];

    ok(activeIds(env) === 'penna', '2.0 stato iniziale: solo penna attiva', 'ids=' + activeIds(env));

    // B1: preset matita attivo -> scelta strumento diverso deve lasciare 1 solo attivo
    for (const t of TOOLS) {
        click(env, $(env, '[data-preset="matita"]'));
        ok(activeIds(env) === 'matita',
            '2.1 preset matita: SOLO il preset acceso (penna NON accesa)', 'ids=' + activeIds(env));
        click(env, $(env, '[data-tool="' + t + '"]'));
        ok(activeIds(env) === t,
            '2.2 tool "' + t + '" dopo preset matita: esattamente 1 attivo', 'ids=' + activeIds(env));
        ok(fnTbActiveCount(env) === 1,
            '2.3 tool "' + t + '": esattamente 1 .fn-tb.active in TUTTI i gruppi',
            'n=' + fnTbActiveCount(env));
    }

    // preset markR (pennarello)
    click(env, $(env, '[data-preset="markR"]'));
    ok(activeIds(env) === 'markR', '2.4 preset markR: solo preset acceso', 'ids=' + activeIds(env));
    click(env, $(env, '[data-tool="gomma"]'));
    ok(activeIds(env) === 'gomma', '2.5 gomma con preset markR attivo: solo gomma', 'ids=' + activeIds(env));

    // penType dal popover colore (data-pt): B2 — il bottone penna deve spegnersi
    click(env, $(env, '[data-tool="penna"]'));
    ok(activeIds(env) === 'penna', '2.6 penna di default: solo penna', 'ids=' + activeIds(env));
    click(env, $(env, '[data-pt="pencil"]'));
    ok(activeIds(env) === 'matita', '2.7 penType=pencil via popover: SOLO preset matita (penna spenta)', 'ids=' + activeIds(env));
    click(env, $(env, '[data-pt="marker"]'));
    ok(activeIds(env) === 'markR', '2.8 penType=marker via popover: SOLO preset markR', 'ids=' + activeIds(env));
    click(env, $(env, '[data-pt="pen"]'));
    ok(activeIds(env) === 'penna', '2.9 penType=pen via popover: solo penna, preset spenti', 'ids=' + activeIds(env));

    // applyPreset via preset button con penna gia' attiva
    click(env, $(env, '[data-preset="matita"]'));
    click(env, $(env, '[data-tool="penna"]'));
    ok(activeIds(env) === 'penna', '2.10 click penna con penType pencil -> reset a penna default', 'ids=' + activeIds(env));
}

// ===============================================================
// 3) TOGGLE "Migliora scrittura" = classe .mode (A2/B5)
// ===============================================================
async function helpModeCheck(env) {
    console.log('== QA-A-3: toggle Migliora scrittura (.mode, non tool) ==');
    const helpBtn = $(env, '[data-help]');
    // porto in stato pulito: preset matita attivo
    click(env, $(env, '[data-preset="matita"]'));
    const before = activeIds(env);
    ok(before === 'matita', '3.0 precondizione: preset matita attivo', 'ids=' + before);

    click(env, helpBtn);
    await sleep(20);
    ok(helpBtn.classList.contains('mode'), '3.1 toggle acceso -> classe .mode');
    ok(!helpBtn.classList.contains('active'), '3.2 toggle acceso -> SENZA .active (no riempimento pieno)');
    ok(!helpBtn.hasAttribute('data-tool'), '3.3 toggle fuori dallo sweep data-tool');
    ok(activeIds(env) === before,
        '3.4 toggle NON conta come tool attivo (invariato)', 'ids=' + activeIds(env) + ' atteso ' + before);
    ok(fnTbActiveCount(env) === 1, '3.5 esattamente 1 .fn-tb.active anche con toggle acceso',
        'n=' + fnTbActiveCount(env));

    // regola CSS: .fn-tb.mode con bordo e background trasparente
    const css = $$env_styles(env).join('');
    const modeRule = (css.match(/\.fn-tb\.mode\{[^}]*\}/) || [''])[0];
    ok(/border:1\.5px solid/.test(modeRule), '3.6 CSS .fn-tb.mode: bordo 1.5px', modeRule);
    ok(/background:transparent/.test(modeRule), '3.7 CSS .fn-tb.mode: background trasparente', modeRule);
    ok(!/background:#f9974a/.test(modeRule), '3.8 CSS .fn-tb.mode: NESSUN riempimento pieno', modeRule);

    click(env, helpBtn);
    await sleep(20);
    ok(!helpBtn.classList.contains('mode'), '3.9 toggle spento -> .mode rimossa');
    ok(activeIds(env) === 'matita', '3.10 tool invariato dopo toggle OFF', 'ids=' + activeIds(env));
}
function $$env_styles(env) {
    return Array.from(env.doc.head.querySelectorAll('style')).map(s => s.textContent);
}

// ===============================================================
// 4) PANNELLO "FONTI" (A3)
// ===============================================================
async function fontiCheck(env) {
    console.log('== QA-A-4: pannello Fonti (R21: componente FontiPanel) ==');
    const pillL = $(env, '.fn-pill-left');
    ok(!!pillL, '4.0 pillL presente');
    const btnFonti = pillL && pillL.querySelector('[data-fonti]');
    ok(!!btnFonti, '4.1 bottone "Fonti" presente in pillL');
    if (!btnFonti) return;
    ok(btnFonti.title === 'Fonti', '4.2 title="Fonti"', 'title=' + btnFonti.title);
    ok(!$(env, '.fp21-root.show'), '4.3 pannello chiuso inizialmente');
    ok(!$(env, '.fn-side'), '4.3b nessun vecchio pannello legacy (.fn-side) montato');

    click(env, btnFonti);
    ok(!!$(env, '.fp21-root.show'), '4.4 click Fonti apre il pannello (classe .show)');
    ok(btnFonti.classList.contains('mode'), '4.5 bottone Fonti in stato .mode (aperto)');
    const fpRoot = $(env, '.fp21-root');
    ok(!!fpRoot && !!$(env, '.nt-editor .fp21-root[data-fp21="appunti"]'),
        '4.5b componente FontiPanel montato nel root dell editor');
    await sleep(240); // refresh() async del componente

    let items = $$(env, '.fp21-item');
    ok(items.length >= 4, '4.6 elenco fonti (study note/riassunto/documento + mat) con >=4 voci',
        'n=' + items.length);
    const txts = items.map(b => b.textContent);
    ok(txts.some(t => /Riassunto Alfa/.test(t)), '4.7 fonte study "Riassunto Alfa" elencata');
    ok(txts.some(t => /Documento Beta/.test(t)), '4.8 fonte study "Documento Beta" elencata');
    ok(txts.some(t => /Libro Gamma/.test(t)), '4.9 materiale "Libro Gamma" elencato');

    // ricerca COLLAPPABILE (lente) + ricerca in tempo reale
    const search = $(env, '.fp21-search');
    ok(!!search, '4.10 input di ricerca presente');
    const lens = $(env, '.fp21-lens');
    ok(!!lens && search.style.display === 'none',
        '4.10b ricerca COLLASSATA di default (lente presente)');
    click(env, lens);
    ok(search.style.display !== 'none', '4.10c click lente .fp21-lens APRE la ricerca');
    setInput(env, search, 'xyzzy-niente');
    await sleep(40);
    ok($$(env, '.fp21-item').length === 0, '4.11 ricerca senza risultati -> 0 voci',
        'n=' + $$(env, '.fp21-item').length);
    ok(!!$(env, '.fp21-list .fp21-hint'), '4.12 ricerca senza risultati -> hint');

    setInput(env, search, 'alfa');
    await sleep(40);
    items = $$(env, '.fp21-item');
    ok(items.length === 1 && /Riassunto Alfa/.test(items[0].textContent),
        '4.13 ricerca "alfa" filtra a 1 voce', 'n=' + items.length);

    setInput(env, search, 'gamma');
    await sleep(40);
    items = $$(env, '.fp21-item');
    ok(items.length === 1 && /Libro Gamma/.test(items[0].textContent),
        '4.14 ricerca "gamma" filtra al materiale mat', 'n=' + items.length);

    setInput(env, search, '');
    await sleep(40);
    items = $$(env, '.fp21-item');
    ok(items.length >= 4, '4.15 ricerca svuotata -> elenco completo', 'n=' + items.length);

    // selezione -> anteprima testo (adapter previewFonte21 del componente)
    const itemAlfa = items.filter(b => /Riassunto Alfa/.test(b.textContent))[0];
    ok(!!itemAlfa, '4.16 voce Riassunto Alfa cliccabile');
    if (itemAlfa) {
        const insertBtn = $(env, '.fp21-insert');
        ok(insertBtn.disabled === true, '4.17 inserisci DISABILITATO prima della selezione');
        click(env, itemAlfa);
        await sleep(150);
        const prev = $(env, '.fp21-preview');
        ok(/Contenuto riassunto alfa/.test(prev.textContent), '4.18 anteprima testo della fonte',
            'prev=' + prev.textContent.slice(0, 80));
        ok(insertBtn.disabled === false, '4.19 inserisci ABILITATO dopo selezione');
        ok(!!$(env, '.fp21-item.active'), '4.20 voce selezionata evidenziata (.active)');

        // inserisci riferimento -> oggetto t:'text' salvato nel doc
        click(env, insertBtn);
        await sleep(1150); // debounce salvataggio 900ms
        let objs = noteObjects(env, 'n1');
        ok(hasFonteText(objs), '4.21 riferimento "Fonte: ..." inserito e SALVATO nel doc',
            'obj=' + JSON.stringify(objs.map(o => o.t)));
        const refObj = objs.filter(o => o.t === 'text' && /Fonte:/.test(o.text || ''))[0];
        ok(!!refObj && /Riassunto Alfa/.test(refObj.text) && /r1/.test(refObj.text),
            '4.22 riferimento contiene titolo + id', refObj ? refObj.text : 'nessuno');
        /* canonico: oggetto plain t:'text', size>0, misurato (measureTextObj),
           senza geometria freehand (pts assente - un oggetto testo non ha pts) */
        ok(!!refObj && refObj.size > 0 && refObj.pts === undefined,
            '4.23 riferimento e un oggetto canonico t:text (misurato)',
            refObj ? ('size=' + refObj.size + ' pts=' + JSON.stringify(refObj.pts)) : 'refObj assente');
        // R21 B1: PROVENIENZA (campo prov + doc.fpSources serializzato)
        ok(!!refObj && !!refObj.prov && refObj.prov.titolo === 'Riassunto Alfa' &&
            refObj.prov.tipo === 'Riassunto',
            '4.23b oggetto inserito con campo prov {titolo,tipo}',
            refObj ? JSON.stringify(refObj.prov) : 'refObj assente');
        let savedDoc = null;
        try { savedDoc = JSON.parse(env.store.items.filter(x => x.id === 'n1')[0].content); }
        catch (e) { savedDoc = null; }
        const fps = (savedDoc && Array.isArray(savedDoc.fpSources)) ? savedDoc.fpSources : [];
        ok(fps.length >= 1 && fps[fps.length - 1].titolo === 'Riassunto Alfa' &&
            fps[fps.length - 1].fonteId === 'r1' && typeof fps[fps.length - 1].ts === 'number',
            '4.23c doc.fpSources serializzato con {tipo,titolo,fonteId,ts}',
            JSON.stringify(fps[fps.length - 1] || null));

        // reversibilita': undo rimuove il riferimento (meccanismo esistente)
        const undoBtn = $(env, '[title^="Annulla"]');
        ok(!!undoBtn, '4.24 bottone Annulla presente');
        if (undoBtn) {
            click(env, undoBtn);
            await sleep(1150);
            objs = noteObjects(env, 'n1');
            ok(!hasFonteText(objs), '4.25 undo rimuove il riferimento (reversibile)');
        }
    }

    // preview .md SENZA metadati (adapter renderMarkdown21 del componente)
    setInput(env, search, 'md');
    await sleep(40);
    const mdItem = $$(env, '.fp21-item').filter(b => /appunti-md/.test(b.textContent))[0];
    ok(!!mdItem, '4.25b materiale .md elencato (fonte per il test md)');
    if (mdItem) {
        click(env, mdItem);
        await sleep(200);
        const prev = $(env, '.fp21-preview');
        const pbody = $(env, '.fp21-pbody');
        const html = pbody ? pbody.innerHTML : '';
        ok(/<h1[^>]*>Titolo MD Appunti<\/h1>/.test(html),
            '4.25c md: h1 renderizzato dall adapter del componente', html.slice(0, 120));
        ok(/<strong>grasso<\/strong>/.test(html), '4.25d md: strong renderizzato');
        ok(!/Percorso:|Dimensione:|Tipo file:|Indicizzato/.test(prev.textContent),
            '4.25e preview md SENZA metadati', prev.textContent.slice(0, 80));
    }

    // materiale con percorso -> oggetto t:'file' (openFilePath esistente)
    setInput(env, search, 'gamma');
    await sleep(40);
    const matItem = $$(env, '.fp21-item')[0];
    if (matItem) {
        click(env, matItem);
        await sleep(200);
        const prev = $(env, '.fp21-preview');
        const ptitle = $(env, '.fp21-ptitle');
        /* R19 A3.4: NESSUN metadato in preview - solo titolo + badge tipo */
        const hasBadge = !!(ptitle && ptitle.querySelector('.fp21-badge'));
        ok(/Libro Gamma/.test(prev.textContent) && hasBadge && !/Percorso:/.test(prev.textContent)
            && !/Dimensione:/.test(prev.textContent) && !/Indicizzato/.test(prev.textContent),
            '4.26 anteprima materiale SOLO titolo+badge, NESSUN metadato (A3.4)',
            'prev=' + prev.textContent.slice(0, 80));
        const insertBtn = $(env, '.fp21-insert');
        click(env, insertBtn);
        await sleep(1150);
        const objs = noteObjects(env, 'n1');
        ok(hasFilePath(objs, 'C:/docs/libro-gamma.pdf'),
            '4.27 oggetto t:file con path inserito e salvato',
            'tipi=' + JSON.stringify(objs.map(o => o.t)));
        // il doc resta JSON valido (nessuna corruzione)
        let valid = true;
        try { JSON.parse(env.store.items.filter(x => x.id === 'n1')[0].content); } catch (e) { valid = false; }
        ok(valid, '4.28 content della nota resta JSON valido dopo inserimento');
    }

    // chiusura: SOLO dal bottone Fonti (niente header/X interno al componente)
    ok(!$(env, '.fn-side-head') && !$(env, '.fp21-bar .fn-tb'),
        '4.29 nessuna chiusura interna: toggle solo dal bottone Fonti');
    click(env, btnFonti);
    await sleep(40);
    ok(!$(env, '.fp21-root.show'), '4.30 pannello chiuso dal bottone Fonti');
    ok(!btnFonti.classList.contains('mode'), '4.31 bottone Fonti torna senza .mode');
    // lo stesso bottone riapre (toggle esplicito)
    click(env, btnFonti);
    await sleep(80);
    ok(!!$(env, '.fp21-root.show'), '4.32 bottone Fonti riapre il pannello');
    click(env, btnFonti);
    await sleep(40);
    ok(!$(env, '.fp21-root.show'), '4.33 secondo click richiude (toggle esplicito)');
}

// ===============================================================
// 5) TEARDOWN + ZERO ECCEZIONI CONSOLE
// ===============================================================
async function teardownCheck(env) {
    console.log('== QA-A-5: teardown listener + console pulita ==');
    env.mod.close();
    await sleep(150);
    ok(env.live.size === 0, '5.1 dopo close: ZERO listener document click-capture (nessun fantasma)',
        'n=' + env.live.size);
    // nessun errore residuo da click fuori dopo il close
    env.doc.body.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    ok(env.live.size === 0, '5.2 nessun listener riesumato da click residui', 'n=' + env.live.size);
    ok(env.consoleErrors.length === 0,
        '5.3 zero eccezioni console (error + jsdomError)',
        env.consoleErrors.slice(0, 5).join(' | '));
}

// ===============================================================
async function main() {
    try {
        const env = makeEnv();
        await openNote(env, 'n1');
        ok(!!$(env, '.nt-editor'), '0.0 editor Appunti aperto (baseline)');
        ok(env.live.size === 1, '0.1 listener outside-click registrato all\'apertura', 'n=' + env.live.size);
        await popoverCheck(env);
        await toolStateCheck(env);
        await helpModeCheck(env);
        await fontiCheck(env);
        await teardownCheck(env);
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('\n================================================');
    console.log('RISULTATI qaA_appunti: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
