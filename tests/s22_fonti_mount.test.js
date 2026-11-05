/* ============================================================
   tests/s22_fonti_mount.test.js - T1 R22 (FE-SCHEMI 5.1/5.2/5.3)
   Copre:
   (a) 5.1 mount-in-tab: la tab Fonti ospita ESATTAMENTE UN .fp21-root
       [data-fp21="schemi"] dentro .sc-side/.sc-body (mai un overlay
       flottante): nessun secondo mount, nessun .fp21-root con position
       inline fixed/absolute, radice sempre dentro .sc-side, sorgente
       schemi.js senza regole CSS fp21 non scoped e senza fixed/absolute
       legati a fonti; tab visibile/riattivabile con refresh;
   (b) 5.1 teardown: mod.close() distrugge il pannello (0 root in DOM),
       riapertura = 1 solo root (nessun doppio mount);
   (c) 5.1 insert: bottone "Inserisci nello schema" (FIELDS.schemi) ->
       onFontiInsert crea nodo "Fonte: <titolo> (<tipo>)" + 1 solo passo
       di undo;
   (d) 5.2 math preview: nella preview fonti degli schemi una formula
       inline $...$ e una \(...\) devono risultare renderizzate (.katex o
       fallback) e NESSUN nodo testo visibile puo contenere '\Delta',
       '\text' o '$$' non renderizzati (skip subtree .katex: KaTeX ci mette
       dentro l'annotation LaTeX). ATTENZIONE: dipende da fonti_panel.js
       (altro delegato) - se il fix per \(...\) non e' ancora arrivato le
       assert 5.2 falliscono di proposito e vanno segnalate nel report;
   (e) 5.3 verifica in LETTURA: ogni altro modulo monta con il proprio
       contesto ('documenti', 'fogli', 'appunti', 'presentazioni',
       'ripasso', 'video') e NESSUNO monta contesto 'schemi'.

   Ambiente jsdom (pattern tests/qaB_schemi.js) + fonti_panel.js reale
   + KaTeX vendored quando caricabile.
   Eseguire con: node tests/s22_fonti_mount.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_STRAT = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemaStrategies.js'), 'utf8');
const SRC_SCHEMI = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemi.js'), 'utf8');
const SRC_FP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
let SRC_KATEX = '';
try {
    SRC_KATEX = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'vendor', 'katex', 'katex.min.js'), 'utf8');
} catch (e) { SRC_KATEX = ''; }

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------
// Ambiente DOM + stub (pattern qaB_schemi, + fonti_panel reale)
// ---------------------------------------------------------------
function makeEnv() {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only'
    });
    const win = dom.window;
    const doc = win.document;
    const store = { items: [], seq: 1 };
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
            if (btns && btns.length) {
                const row = el('div', 'header-actions');
                btns.forEach(b => row.appendChild(b));
                h.appendChild(row);
            }
            return h;
        },
        empty: () => el('div', 'app-empty'),
        ICONS: { schemi: '' },
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
        hasBackend: async () => false,
        pickAsset: async () => null,
        assetUrl: s => s
    };
    win.SubjectInput = {
        normalize: s => String(s || '').trim(),
        remember: () => { },
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
    win.__confirmCalls = [];
    win.confirm = msg => { win.__confirmCalls.push(String(msg == null ? '' : msg)); return false; };
    win.eval(SRC_STRAT);
    win.eval(SRC_FP);                 // componente condiviso (invariato)
    if (SRC_KATEX) { try { win.eval(SRC_KATEX); } catch (e) { /* fallback ammesso */ } }
    win.eval(SRC_SCHEMI);
    return { dom, win, doc, store, mod: win.App._mod, katex: !!win.katex };
}

async function openSchema(env, docObj, title) {
    const id = 'x' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'schema', title: title || 'Test', content: JSON.stringify(docObj),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: id });
    await sleep(160);
    return id;
}
function seedNote(env, title, text) {
    env.store.items.push({
        id: 'n' + (env.store.seq++), kind: 'note', title: title,
        content: JSON.stringify({ objects: [{ t: 'text', x: 20, y: 20, w: 300, h: 40, text: text }] }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
}

// ---- helpers ----
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function key(env, opts) {
    const ev = new env.win.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts));
    env.win.dispatchEvent(ev);
    return ev;
}
function fontiTab(env) {
    return $$(env, '.sc-tab').filter(b => b.textContent.trim() === 'Fonti')[0] || null;
}
function roots(env) { return $$(env, '.fp21-root'); }
function nodeCount(env) { return $$(env, 'g.sc-node[data-nid]').length; }

// testo visibile: salta subtree .katex (annotation LaTeX di KaTeX contiene
// il sorgente '\Delta' ma NON e' testo renderizzato/flusso)
function visibleTexts(root) {
    const out = [];
    (function walk(n) {
        if (n.nodeType === 3) { out.push(n.nodeValue); return; }
        if (n.nodeType !== 1) return;
        const cls = n.getAttribute && n.getAttribute('class');
        if (cls && /(^|\s)katex(\s|$)/.test(cls)) return;
        for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
    })(root);
    return out;
}

const MATH_TEXT = '# Fonte R22\n\nMatematica inline $x^2 + \\Delta t$ e parentesi \\(y_i + \\text{OK}\\).';

// ===============================================================
// (a)+(b) MOUNT IN TAB / NESSUN OVERLAY / TEARDOWN
// ===============================================================
async function mountCheck() {
    console.log('== S22 (a): mount FontiPanel nel tab Fonti, nessun overlay ==');
    const env = makeEnv();
    seedNote(env, 'Nota S22', '# Nota S22\n\ntesto di prova');
    await openSchema(env, {
        type: 'albero',
        nodes: [{ id: 'a', x: 300, y: 300, w: 170, h: 60, text: 'A' }],
        edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    }, 'S22-mount');

    const tabs = $$(env, '.sc-side .sc-tab');
    ok(tabs.length === 4, '4 tab nel pannello destro', 'n=' + tabs.length);

    // mount avviene in buildSide (dentro la .sc-body del tab Fonti, hidden)
    const rs = roots(env);
    ok(rs.length === 1, 'ESATTAMENTE 1 .fp21-root montato (nessun doppio mount)', 'n=' + rs.length);
    if (rs.length === 1) {
        const r = rs[0];
        ok(r.getAttribute('data-fp21') === 'schemi', 'root ha data-fp21="schemi"',
            String(r.getAttribute('data-fp21')));
        ok(!!r.closest('.sc-side'), 'root vive dentro .sc-side (non a livello documento)');
        ok(!!r.closest('.sc-body'), 'root vive dentro il corpo (.sc-body) della tab');
        const bodyF = r.parentNode;
        ok(bodyF && bodyF.classList.contains('sc-body') && bodyF.style.display === 'none',
            'corpo tab Fonti hidden finche non selezionato',
            bodyF ? 'display=' + bodyF.style.display : 'nessun parent');
        ok(!r.style.position, 'nessuna position INLINE fixed/absolute sul root',
            JSON.stringify(r.style.position));
        let cs = '';
        try { cs = env.win.getComputedStyle(r).position; } catch (e) { cs = 'n/d'; }
        ok(cs !== 'fixed' && cs !== 'absolute',
            'computed position del root NON fixed/absolute (jsdom: best effort)', cs);
        // sorgente: nessuna regola fp21 non scoped e nessun mount extra
        ok((SRC_SCHEMI.match(/FontiPanel\.create\(/g) || []).length === 1,
            'sorgente: un solo FontiPanel.create (nessun secondo mount)');
        ok((SRC_SCHEMI.match(/mountFontiPanel\(/g) || []).length === 2,
            'sorgente: mountFontiPanel = 1 definizione + 1 chiamata',
            String((SRC_SCHEMI.match(/mountFontiPanel\(/g) || []).length));
        const totalRootRules = (SRC_SCHEMI.match(/\.fp21-root\{/g) || []).length;
        const scopedRootRules = (SRC_SCHEMI.match(/\.sc-side \.fp21-root\{/g) || []).length;
        ok(totalRootRules > 0 && totalRootRules === scopedRootRules,
            'sorgente: tutte le regole CSS .fp21-root{ sono scoped .sc-side (nessun float globale)',
            'total=' + totalRootRules + ' scoped=' + scopedRootRules);
        ok(!/\.fp21-root\s*\{[^}]*(fixed|absolute)/i.test(SRC_SCHEMI),
            'sorgente: nessuna position fixed/absolute sulla ROOT (i soli .fp21-rz interni possono essere absolute)');
    }

    // apre la tab Fonti -> pannello visibile + refresh (showTab)
    const tf = fontiTab(env);
    ok(!!tf, 'tab Fonti presente');
    click(env, tf);
    await sleep(220);
    const bodyF2 = roots(env)[0] ? roots(env)[0].parentNode : null;
    ok(!!bodyF2 && bodyF2.style.display === '',
        'tab Fonti aperto -> corpo visibile (display reset)', bodyF2 ? 'display=' + bodyF2.style.display : 'n/a');
    const items = $$(env, '.fp21-root .fp21-item');
    ok(items.length >= 1, 'refresh showTab: elenco fonti popolato nel tab', 'n=' + items.length);
    const insertBtn = $(env, '.fp21-root .fp21-insert');
    ok(!!insertBtn && insertBtn.textContent.trim() === 'Inserisci nello schema',
        'bottone "Inserisci nello schema" (FIELDS.schemi) nel pannello',
        insertBtn ? insertBtn.textContent.trim() : 'assente');
    ok(!!$(env, '.fp21-root .fp21-list') && !!$(env, '.fp21-root .fp21-preview .fp21-pbody'),
        'struttura condivisa: lista + preview dentro il pannello');

    // torna su Riassunto: pannello nascosto ma NON distrutto, poi riattivato
    click(env, $$(env, '.sc-tab')[0]);
    await sleep(80);
    ok(roots(env).length === 1 && roots(env)[0].parentNode.style.display === 'none',
        'cambio tab: pannello hidden ma vivo (1 root)', 'n=' + roots(env).length);
    click(env, fontiTab(env));
    await sleep(220);
    ok(roots(env).length === 1 && roots(env)[0].parentNode.style.display === '',
        'ritorno tab Fonti: di nuovo visibile con 1 solo root');

    // ---------- (b) TEARDOWN ----------
    console.log('== S22 (b): teardown distrugge il pannello ==');
    const rRef = roots(env)[0] || null;
    env.mod.close();
    await sleep(80);
    ok(roots(env).length === 0, 'mod.close(): 0 .fp21-root nel documento', 'n=' + roots(env).length);
    ok(!rRef || rRef.parentNode === null, 'root staccato dal DOM (destroy)');
    // riapertura: 1 solo mount, mai doppi
    await openSchema(env, {
        type: 'albero',
        nodes: [{ id: 'b', x: 300, y: 300, w: 170, h: 60, text: 'B' }],
        edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    }, 'S22-riapri');
    ok(roots(env).length === 1, 'riapertura editor: di nuovo esattamente 1 root', 'n=' + roots(env).length);
    env.mod.close();
    await sleep(60);
    ok(roots(env).length === 0, 'secondo teardown: 0 root');
}

// ===============================================================
// (c) INSERT -> onFontiInsert (nodo Fonte + 1 passo di undo)
// ===============================================================
async function insertCheck() {
    console.log('== S22 (c): insert "Inserisci nello schema" -> onFontiInsert ==');
    const env = makeEnv();
    seedNote(env, 'Fonte Insert S22', '# Fonte Insert S22\n\ncontenuto');
    await openSchema(env, {
        type: 'albero',
        nodes: [{ id: 'a', x: 300, y: 300, w: 170, h: 60, text: 'A' }],
        edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    }, 'S22-insert');
    click(env, fontiTab(env));
    await sleep(220);

    const item = $$(env, '.fp21-item').filter(b => /Fonte Insert S22/.test(b.textContent))[0];
    ok(!!item, 'fonte seedata presente nella lista del tab');
    if (item) {
        click(env, item);
        await sleep(220);
        const ins = $(env, '.fp21-root .fp21-insert');
        ok(!!ins && ins.disabled === false, 'preview caricata -> bottone insert abilitato');
        const before = nodeCount(env);
        click(env, ins);
        await sleep(120);
        const after = nodeCount(env);
        ok(after === before + 1, 'insert: +1 nodo nello schema', before + ' -> ' + after);
        const texts = $$(env, 'g.sc-node[data-nid]').map(g => g.textContent);
        // il testo nodo e' renderizzato in piu tspan: spazi tollerati
        ok(texts.some(t => /Fonte: Fonte Insert\s*S22\s*\(Appunti\)/.test(t)),
            'nodo creato con testo "Fonte: <titolo> (<tipo>)"', JSON.stringify(texts));
        // 1 solo passo di undo
        key(env, { key: 'z', ctrlKey: true });
        await sleep(120);
        ok(nodeCount(env) === before, 'undo: 1 Ctrl+Z rimuove il nodo inserito', 'n=' + nodeCount(env));
    }
}

// ===============================================================
// (d) 5.2 - MATEMATICA nella preview fonti (assert DURA)
// ===============================================================
async function mathCheck() {
    console.log('== S22 (d): 5.2 math preview ($...$ e \\(...\\)) ==');
    const env = makeEnv();
    ok(true, 'INFO katex caricato in jsdom: ' + env.katex + ' (fallback ammesso se no)');
    seedNote(env, 'Fonte Math S22', MATH_TEXT);
    await openSchema(env, {
        type: 'albero',
        nodes: [{ id: 'a', x: 300, y: 300, w: 170, h: 60, text: 'A' }],
        edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    }, 'S22-math');
    click(env, fontiTab(env));
    await sleep(220);
    const item = $$(env, '.fp21-item').filter(b => /Fonte Math S22/.test(b.textContent))[0];
    ok(!!item, 'fonte math presente nella lista');
    if (!item) return;
    click(env, item);
    await sleep(260);   // preview async

    const pb = $(env, '.fp21-root .fp21-pbody');
    ok(!!pb, 'preview .fp21-pbody renderizzata');
    if (!pb) return;
    const ptext = pb.textContent || '';
    const html = pb.innerHTML || '';
    const katexN = pb.querySelectorAll('.katex').length;
    const fb = /formula non renderizzabile/.test(ptext);

    // 1) formula inline $...$ renderizzata (.katex o fallback) e delimitatori consumati
    const dollarRendered = katexN > 0 || fb;
    ok(dollarRendered,
        '5.2 $...$: formula renderizzata (.katex o badge fallback)',
        'katex=' + katexN + ' fallback=' + fb);
    ok(ptext.indexOf('$') < 0,
        '5.2 $...$: nessun delimitatore $ residuo nel testo preview', JSON.stringify(ptext.slice(0, 120)));
    ok(html.indexOf('$$') < 0 && ptext.indexOf('$$') < 0,
        '5.2: nessun $$ non renderizzato');

    // 2) formula \(...\) renderizzata: nessun testo visibile con \( grezzo
    const texts = visibleTexts(pb);
    const parenRaw = texts.filter(t => t.indexOf('\\(') >= 0 || t.indexOf('\\)') >= 0);
    ok(parenRaw.length === 0,
        '5.2 \\(...\\): nessun delimitatore \\( grezzo nel testo visibile',
        parenRaw.length ? JSON.stringify(parenRaw[0].slice(0, 120)) : '');

    // 3) nessun token LaTeX non renderizzato nel testo visibile
    const rawTok = texts.filter(t => t.indexOf('\\Delta') >= 0 || t.indexOf('\\text') >= 0 || t.indexOf('$$') >= 0);
    ok(rawTok.length === 0,
        '5.2: nessun nodo testo visibile con \\Delta / \\text / $$ non renderizzati',
        rawTok.length ? JSON.stringify(rawTok[0].slice(0, 140)) : '');

    console.log('  INFO 5.2 stato: katex=' + katexN + ' fallback=' + fb +
        ' rawParen=' + parenRaw.length + ' rawTok=' + rawTok.length +
        (rawTok.length || parenRaw.length ? '  -> ASSERT 5.2 IN ATTESA DEL FIX MATH IN fonti_panel.js' : '  -> OK'));
}

// ===============================================================
// (e) 5.3 - verifica in lettura: contesti di mount degli altri moduli
// ===============================================================
async function contextsCheck() {
    console.log('== S22 (e): 5.3 contesti di mount (solo lettura) ==');
    const map = [
        ['documenti.js', 'documenti'],
        ['fogli.js', 'fogli'],
        ['notes.js', 'appunti'],
        ['presentazioni.js', 'presentazioni'],
        ['ripasso.js', 'ripasso'],
        ['video.js', 'video']
    ];
    for (const [file, contesto] of map) {
        const p = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', file);
        if (!fs.existsSync(p)) { ok(false, '5.3 ' + file + ' leggibile'); continue; }
        const src = fs.readFileSync(p, 'utf8');
        ok(new RegExp("contesto\\s*:\\s*'" + contesto + "'").test(src),
            '5.3 ' + file + ' monta FontiPanel con contesto \'' + contesto + '\'');
        ok(!/contesto\s*:\s*'schemi'/.test(src),
            '5.3 ' + file + ' NON monta contesto \'schemi\' (nessun mount per gli Schemi fuori da schemi.js)');
    }
    ok((SRC_SCHEMI.match(/contesto\s*:\s*'schemi'/g) || []).length === 1,
        '5.3 schemi.js: un solo create con contesto \'schemi\'');
    // nessun overlay flottante specifico per gli Schemi negli altri moduli
    for (const [file] of map) {
        const p = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', file);
        if (!fs.existsSync(p)) continue;
        const src = fs.readFileSync(p, 'utf8');
        ok(!/sc-side[\s\S]{0,200}position\s*:\s*fixed|schemi[\s\S]{0,120}position\s*:\s*fixed/i.test(src),
            '5.3 ' + file + ': nessun overlay fixed specifico per gli Schemi');
    }
}

// ===============================================================
async function main() {
    try {
        await mountCheck();
        await insertCheck();
        await mathCheck();
        await contextsCheck();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('\n================================================');
    console.log('RISULTATI s22_fonti_mount: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
