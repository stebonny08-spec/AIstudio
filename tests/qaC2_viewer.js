/* ============================================================
   tests/qaC2_viewer.js — QA-C2 (viewer Fonti materiali/libri)
   Copre la spec C2 (IMPLEMENTER-C2, owner notes.js/schemi.js):
   (i)  notes: selectFonti su fonte `mat:` CON pywebview mock (non-md) ->
        la preview contiene il testo "CONTENUTO LIBRO XYZ", testata
        titolo+badge, NESSUN metadato (R19 A3.4) + pulsante "Carica testo
        completo" che rimuove il cap nella stessa anteprima;
   (ii) notes: SENZA pywebview (harness attuale) -> nessuna eccezione,
        fallback mostrato (testata + msg "Nessun testo raggiungibile",
        SENZA percorso - R19 A3.4);
   (iii) schemi: loadSources include >=1 voce `mat:` quando
        StudyStore.listMaterials ritorna 1 item (mock) + preview mat
        con read_material_text stub (stessa logica di notes).
   Extra: etichetta "Libro" (path preselected_books) vs "Materiale".

   Verifica INDIPENDENTE (jsdom, pattern qaA_appunti/qaB_schemi).
   Prodotto in LETTURA. Eseguire con: node tests/qaC2_viewer.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_PANEL = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const SRC_NOTES = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'notes.js'), 'utf8');
const SRC_STRAT = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemaStrategies.js'), 'utf8');
const SRC_SCHEMI = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemi.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- stub API pywebview per la API C2 (path ignorato: test di frontiera) ----
const MAT_TEXT = 'CONTENUTO LIBRO XYZ ' + 'y'.repeat(3000); // > cap 2500 -> testa il pulsante
function pywebviewStub() {
    return {
        api: {
            read_material_text: async p => ({
                success: true, name: 'libro-xyz.md', text: MAT_TEXT,
                kind: 'md', size: 2048, mtime: 1700000000, path: p
            })
        }
    };
}
/* R19 A3: NOTES usa un materiale NON-md cosi' il flusso cap 2500 +
   "Carica testo completo" resta testabile; lo stub md resta per iii
   (pannello Fonti SCHEMI, invariato in R19). */
function notesPdfStub() {
    return {
        api: {
            // R21: .md -> markdown (adapter renderMarkdown21), altro -> testo lungo
            read_material_text: async p => (/\.md$/i.test(String(p || '')) ? ({
                success: true, name: 'storia-moderna.md',
                text: '# Capitolo Uno\n\nParagrafo con **grasso**.',
                kind: 'md', size: 2048, mtime: 1700000000, path: p
            }) : ({
                success: true, name: 'libro-xyz.pdf', text: MAT_TEXT,
                kind: 'pdf', size: 2048, mtime: 1700000000, path: p
            }))
        }
    };
}

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
            return () => undefined;
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}

function baseStubs(win, doc, store) {
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
        ICONS: { notes: '', schemi: '' },
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
        normalize: s => String(s == null ? '' : s).trim(),
        remember: () => Promise.resolve(),
        create: () => {
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
    win.alert = () => { };
    win.confirm = () => false;
}

function seedStore() {
    return {
        seq: 1,
        items: [
            { id: 'n1', kind: 'note', title: 'Nota QA-C2', content: '', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' },
            { id: 'r1', kind: 'riassunto', title: 'Riassunto Alfa', content: JSON.stringify({ text: 'Contenuto riassunto alfa.' }), materia: 'Storia', tags: '', description: '', thumbnail: '', folder_id: '' },
            { id: 'd1', kind: 'documento', title: 'Documento Beta', content: 'Contenuto documento beta', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' },
            { id: 'dh1', kind: 'documento', title: 'Dispensa HTML', content: '{"html":"<h2>Capitolo Due</h2><p>Testo <b>ok</b></p><script>alert(1)</script>"}', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' },
            { id: 's1', kind: 'schema', title: 'Schema QA-C2', content: JSON.stringify({ type: 'albero', nodes: [{ id: 'a', text: 'Nodo A', x: 300, y: 300, w: 150, h: 60 }], edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [], style: {} }), materia: '', tags: '', description: '', thumbnail: '', folder_id: '' }
        ],
        mats: [
            { name: 'Libro Gamma', path: 'C:/docs/libro-gamma.pdf', indexed_at: '2026-01-05' },
            { name: 'Storia Moderna', path: 'C:/data/preselected_books/storia-moderna.md', indexed_at: '2026-02-01' }
        ]
    };
}

// ---------------------------------------------------------------
// Ambiente NOTES (pattern qaA) opzionale con pywebview mock
// ---------------------------------------------------------------
function makeNotesEnv(withPywebview) {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
        virtualConsole: vc
    });
    const win = dom.window;
    const doc = win.document;
    win.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx2d) this.__ctx2d = makeCtx2d(this);
        return this.__ctx2d;
    };
    win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
    const store = seedStore();
    baseStubs(win, doc, store);
    if (withPywebview) win.pywebview = notesPdfStub();   // R19: non-md per il flusso cap
    win.eval(SRC_PANEL);
    win.eval(SRC_NOTES);
    return { dom, win, doc, store, mod: win.App._mod, consoleErrors };
}

// ---------------------------------------------------------------
// Ambiente SCHEMI (pattern qaB) con listMaterials + pywebview mock
// ---------------------------------------------------------------
function makeSchemiEnv(withListMaterials, withPywebview) {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
        virtualConsole: vc
    });
    const win = dom.window;
    const doc = win.document;
    const store = seedStore();
    baseStubs(win, doc, store);
    if (!withListMaterials) delete win.StudyStore.listMaterials; // harness baseline qaB
    if (withPywebview) win.pywebview = pywebviewStub();
    win.eval(SRC_PANEL);
    win.eval(SRC_STRAT);
    win.eval(SRC_SCHEMI);
    return { dom, win, doc, store, mod: win.App._mod, consoleErrors };
}

async function openIn(env, item) {
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: item });
    await sleep(260);
}

// ---- helpers ----
const $ = (sel, env) => env.doc.querySelector(sel);
const $$ = (sel, env) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }

// ===============================================================
// (i) NOTES + FontiPanel: adapter {"html"} + md + libro, NESSUN metadato
// ===============================================================
async function notesWithBackend() {
    console.log('== QA-C2-(i): notes + componente FontiPanel (adapter) ==');
    const env = makeNotesEnv(true);
    await openIn(env, 'n1');
    const btnFonti = env.doc.querySelector('.fn-pill-left [data-fonti]');
    ok(!!btnFonti, 'i.0 bottone Fonti presente');
    if (!btnFonti) return;
    click(env, btnFonti);
    await sleep(260); // refresh() async del componente
    let items = $$('.fp21-item', env);
    ok(items.length >= 5, 'i.1 elenco fonti con voci mat incluse (>=5)', 'n=' + items.length);

    // etichetta "Libro" per path preselected_books vs "Materiale"
    const libroKinds = $$('.fp21-item .fp21-badge', env).map(s => s.textContent);
    ok(libroKinds.some(t => /^Libro/.test(t)), 'i.2 etichetta "Libro" per path preselected_books', libroKinds.join(' | '));
    ok(libroKinds.some(t => /^Materiale/.test(t)), 'i.3 etichetta "Materiale" per path non-L2', libroKinds.join(' | '));

    // selezione fonte mat -> preview testo via fonti_panel, NESSUN metadato
    const matItem = items.filter(b => /Libro Gamma/.test(b.textContent))[0];
    ok(!!matItem, 'i.4 voce materiale "Libro Gamma" cliccabile');
    if (matItem) {
        click(env, matItem);
        await sleep(220);
        const prev = env.doc.querySelector('.fp21-preview');
        const pbody = env.doc.querySelector('.fp21-pbody');
        const txt = prev ? prev.textContent : '';
        ok(/CONTENUTO LIBRO XYZ/.test(txt), 'i.5 preview contiene "CONTENUTO LIBRO XYZ"', 'prev=' + txt.slice(0, 80));
        /* nessun metadato (A3.4/R21): solo titolo + badge + testo renderizzato */
        ok(!/Percorso:/.test(txt), 'i.6 NESSUN metadato Percorso');
        ok(!/Nome:/.test(txt), 'i.7 NESSUN metadato Nome');
        ok(!/Dimensione:/.test(txt), 'i.8 NESSUN metadato Dimensione');
        ok(!/Tipo file:/.test(txt), 'i.9 NESSUN metadato Tipo file');
        ok(!/Indicizzato/.test(txt), 'i.10 NESSUN data indicizzazione');
        const ptitle = prev ? prev.querySelector('.fp21-ptitle') : null;
        const fBadge = ptitle ? ptitle.querySelector('.fp21-badge') : null;
        ok(!!ptitle && ptitle.textContent.indexOf('Libro Gamma') >= 0 && !!fBadge,
            'i.10b testata preview = titolo + badge tipo', ptitle ? ptitle.textContent : 'assente');
        /* R21: l'adapter del componente mostra il testo pronto: niente cap
           2500 e niente pulsante legacy "Carica testo completo" */
        ok(txt.length >= MAT_TEXT.length && !/Carica testo completo/.test(txt),
            'i.11 testo integrale del libro, senza cap e senza pulsanti legacy',
            'len=' + txt.length);
        ok(!!pbody && !!pbody.querySelector('p'), 'i.12 preview VISIVA (.fp21-pbody con <p>)');

        // adapter {"html"} sanitizzato (documento con contenuto HTML)
        const htmlItem = $$('.fp21-item', env).filter(b => /Dispensa HTML/.test(b.textContent))[0];
        ok(!!htmlItem, 'i.13 documento {"html"} elencato');
        if (htmlItem) {
            click(env, htmlItem);
            await sleep(220);
            const pb = env.doc.querySelector('.fp21-pbody');
            const h = pb ? pb.innerHTML : '';
            ok(/<h2[^>]*>Capitolo Due<\/h2>/.test(h), 'i.14 {"html"}: heading renderizzato', h.slice(0, 120));
            ok(h.indexOf('<script') < 0 && h.indexOf('alert(1)') < 0,
                'i.15 {"html"}: script rimossi (sanitizeHtml)');
            ok(h.indexOf('{"html') < 0, 'i.16 nessuna stringa {"html mostrata come testo');
        }

        // adapter md (file .md della libreria) via fonti_panel
        const mdItem = $$('.fp21-item', env).filter(b => /Storia Moderna/.test(b.textContent))[0];
        ok(!!mdItem, 'i.17 materiale .md "Storia Moderna" elencato');
        if (mdItem) {
            click(env, mdItem);
            await sleep(220);
            const pb = env.doc.querySelector('.fp21-pbody');
            const h = pb ? pb.innerHTML : '';
            const prev2 = env.doc.querySelector('.fp21-preview');
            ok(/<h1[^>]*>Capitolo Uno<\/h1>/.test(h) && /<strong>grasso<\/strong>/.test(h),
                'i.18 md: h1 + strong renderizzati dall adapter', h.slice(0, 120));
            ok(!!prev2 && !/Percorso:|Indicizzato|Dimensione:/.test(prev2.textContent),
                'i.19 md: NESSUN metadato in preview', prev2 ? prev2.textContent.slice(0, 60) : '');
        }
    }
    ok(env.consoleErrors.length === 0, 'i.20 zero eccezioni console', env.consoleErrors.slice(0, 3).join(' | '));
    env.mod.close();
    await sleep(60);
}

// ===============================================================
// (ii) NOTES senza pywebview: fallback senza eccezioni
// ===============================================================
async function notesWithoutBackend() {
    console.log('== QA-C2-(ii): notes FontiPanel SENZA pywebview (fallback) ==');
    const env = makeNotesEnv(false);
    await openIn(env, 'n1');
    const btnFonti = env.doc.querySelector('.fn-pill-left [data-fonti]');
    ok(!!btnFonti, 'ii.0 bottone Fonti presente');
    if (!btnFonti) return;
    click(env, btnFonti);
    await sleep(260);
    const matItem = $$('.fp21-item', env).filter(b => /Libro Gamma/.test(b.textContent))[0];
    ok(!!matItem, 'ii.1 voce materiale elencata anche senza backend');
    if (matItem) {
        click(env, matItem);
        await sleep(220);
        const prev = env.doc.querySelector('.fp21-preview');
        const txt = prev ? prev.textContent : '';
        /* fallback senza metadati (solo titolo + msg del componente) */
        ok(!/Percorso:/.test(txt), 'ii.2 fallback SENZA percorso', 'prev=' + txt.slice(0, 80));
        ok(/Nessun testo raggiungibile/.test(txt), 'ii.3 fallback msg "Nessun testo raggiungibile"', 'prev=' + txt.slice(-80));
        ok(!/Caricamento/.test(txt), 'ii.4 nessun "Caricamento" residuo (promise risolta)', txt.slice(0, 40));
        const btnFull = prev ? prev.querySelector('button') : null;
        ok(!btnFull, 'ii.5 NESSUN pulsante "testo completo" senza contenuto');
    }
    ok(env.consoleErrors.length === 0, 'ii.6 zero eccezioni console (nessuna eccezione)', env.consoleErrors.slice(0, 3).join(' | '));
    // insert (logica notes invariata): sul mat senza backend -> t:'file'
    const insertBtn = env.doc.querySelector('.fp21-insert');
    if (matItem && insertBtn && !insertBtn.disabled) {
        click(env, insertBtn);
        await sleep(1150);
        const it = env.store.items.filter(x => x.id === 'n1')[0];
        /* quaderno: serializableDoc toglie objects top-level -> oggetti in pages[].objects */
        let objs = [];
        let doc2 = null;
        try {
            doc2 = JSON.parse(it.content);
            objs = Array.isArray(doc2.objects) ? doc2.objects
                : (Array.isArray(doc2.pages)
                    ? doc2.pages.reduce((a, p) => a.concat(Array.isArray(p.objects) ? p.objects : []), [])
                    : []);
        } catch (e) { /* */ }
        ok(objs.some(o => o.t === 'file' && o.path === 'C:/docs/libro-gamma.pdf'),
            'ii.7 insertFontiRef invariato: oggetto t:file salvato (quaderno: pages[].objects)',
            JSON.stringify(objs.map(o => o.t)));
        // R21 B1: provenienza registrata nei metadati del doc
        const fps = (doc2 && Array.isArray(doc2.fpSources)) ? doc2.fpSources : [];
        ok(fps.length >= 1 && fps[fps.length - 1].titolo === 'Libro Gamma' &&
            typeof fps[fps.length - 1].ts === 'number',
            'ii.8 doc.fpSources con provenienza della fonte inserita',
            JSON.stringify(fps[fps.length - 1] || null));
    }
    env.mod.close();
    await sleep(60);
}

// ===============================================================
// (iii) SCHEMI: loadSources con voci mat + preview mat
// ===============================================================
async function schemiWithMaterials() {
    console.log('== QA-C2-(iii): schemi + FontiPanel (R21) ==');
    const env = makeSchemiEnv(true, true);
    await openIn(env, 's1');
    const tabF = $$('.sc-tab', env).filter(b => b.textContent.trim() === 'Fonti')[0];
    ok(!!tabF, 'iii.0 tab Fonti presente');
    if (!tabF) return;
    click(env, tabF);
    await sleep(320);   // mount + refresh() asincrono del componente
    const fp = env.doc.querySelector('.fp21-root');
    ok(!!fp && fp.getAttribute('data-fp21') === 'schemi',
        'iii.1 FontiPanel montato nel tab Fonti (contesto schemi)',
        fp ? fp.getAttribute('data-fp21') : 'assente');
    const items = Array.from(fp ? fp.querySelectorAll('.fp21-item') : []);
    ok(items.length >= 5, 'iii.2 elenco fonti con voci mat incluse (>=5)', 'n=' + items.length);
    const badges = items.map(b => {
        const e = b.querySelector('.fp21-badge');
        return e ? e.textContent : '';
    });
    ok(badges.some(x => /^Libro/.test(x)), 'iii.3 etichetta "(Libro)" per preselected_books',
        badges.join(' | '));
    ok(badges.some(x => /^Materiale/.test(x)), 'iii.4 etichetta "(Materiale)" per path L1',
        badges.join(' | '));
    const matItem = items.filter(b => /Libro Gamma/.test(b.textContent))[0];
    ok(!!matItem, 'iii.4b voce "Libro Gamma" in lista');
    if (matItem) {
        click(env, matItem);
        await sleep(200);   // previewFonte21 async (read_material_text stub)
        const pb = fp.querySelector('.fp21-pbody');
        const txt = pb ? pb.textContent : '';
        ok(/CONTENUTO LIBRO XYZ/.test(txt), 'iii.5 preview mat contiene "CONTENUTO LIBRO XYZ"',
            txt.slice(0, 80));
        ok(!/Percorso:/.test(txt) && !/Nome:/.test(txt) && !/Dimensione:/.test(txt) &&
           !/Tipo file:/.test(txt) && !/Indicizzato/.test(txt),
            'iii.6 NESSUN metadato nella preview (R21 A3.4', txt.slice(0, 100));
        const ins = fp.querySelector('.fp21-insert');
        ok(!!ins && ins.disabled === false, 'iii.7 insert abilitato dopo selezione',
            ins ? 'disabled=' + ins.disabled : 'assente');
        ok(/yyyyyyyyyy/.test(txt), 'iii.8 testo integrale visibile (nessun cap 2500)',
            'len=' + txt.length);
        // select di un item study: flusso pre-C2 invariato (preview visiva)
        const stItem = items.filter(b => /Riassunto Alfa/.test(b.textContent))[0] || items[0];
        if (stItem) {
            click(env, stItem);
            await sleep(200);
            const pb2 = fp.querySelector('.fp21-pbody');
            const t2 = pb2 ? pb2.textContent : '';
            ok(t2.length > 0 && !/\{"html/.test(t2),
                'iii.9 preview item study renderizzata (nessun json crudo)', t2.slice(0, 60));
        } else ok(false, 'iii.9 nessuna item study in lista');
    }
    ok(env.consoleErrors.length === 0, 'iii.10 zero eccezioni console',
        env.consoleErrors.slice(0, 3).join(' | '));
    env.mod.close();
    await sleep(60);
}

async function schemiBaseline() {
    console.log('== QA-C2-baseline: schemi senza listMaterials (compat qaB) ==');
    const env = makeSchemiEnv(false, false);
    await openIn(env, 's1');
    const tabF = $$('.sc-tab', env).filter(b => b.textContent.trim() === 'Fonti')[0];
    if (tabF) {
        click(env, tabF);
        await sleep(160);
        const sel = env.doc.querySelector('.sc-body select');
        if (sel) {
            const matOpts = Array.from(sel.options).filter(o => o.value.indexOf('mat:') === 0);
            ok(matOpts.length === 0, 'b.1 senza listMaterials: NESSUNA voce mat (select baseline identica)', 'n=' + matOpts.length);
            ok(sel.options.length >= 1, 'b.2 opzione placeholder presente', 'n=' + sel.options.length);
        } else ok(false, 'b.1 select Fonti assente');
    } else ok(false, 'b.1 tab Fonti assente');
    ok(env.consoleErrors.length === 0, 'b.3 zero eccezioni console', env.consoleErrors.slice(0, 3).join(' | '));
    env.mod.close();
    await sleep(60);
}

// ===============================================================
async function main() {
    try {
        await notesWithBackend();
        await notesWithoutBackend();
        await schemiWithMaterials();
        await schemiBaseline();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('================================================');
    console.log('RISULTATI qaC2_viewer: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) {
        console.log('Fallimenti:');
        failures.forEach(f => console.log('  - ' + f));
    }
    process.exit(fail ? 1 : 0);
}
main();
