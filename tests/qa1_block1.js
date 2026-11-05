/* ============================================================
   tests/qa1_block1.js - QA BLOCCO 1 (sub-agente QA Schemi)

   Verifica harness jsdom sui moduli REALI (schemaStrategies.js +
   schemi.js): NESSUNA modifica ai file di prodotto, solo lettura.

   Copre la CHECKLIST QA-1 punti 1-4 (il punto 5 = suite esistenti
   eseguite a parte con node --check + i 3 test di regressione).

   Eseguire con: node tests/qa1_block1.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SCHEMI_PATH = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemi.js');
const SRC_STRAT = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemaStrategies.js'), 'utf8');
const SRC_SCHEMI = fs.readFileSync(SCHEMI_PATH, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------
// Ambiente DOM + stub (stesso stile di tests/uiHarness.test.js)
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
        el: el,
        esc: esc,
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
        empty: (icon, text, btnText, onClick) => {
            const d = el('div', 'app-empty');
            d.appendChild(el('p', null, text));
            if (btnText) { const b = el('button', 'btn-accent', btnText); if (onClick) b.addEventListener('click', onClick); d.appendChild(b); }
            return d;
        },
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
        deleteItem: async id => { store.items = store.items.filter(x => x.id !== id); },
        renameItem: async (id, t) => { const i = store.items.filter(x => x.id === id)[0]; if (i) i.title = t; },
        listSubjects: async () => [],
        hasBackend: async () => false,
        pickAsset: async () => null,
        assetUrl: s => s
    };

    win.SubjectInput = {
        normalize: s => String(s || '').trim(),
        remember: () => { },
        create: opts => {
            const wrap = el('div', 'subject-input');
            const inp = doc.createElement('input');
            inp.className = 'subject-field';
            inp.value = (opts && opts.value) || '';
            if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
            wrap.appendChild(inp);
            wrap.getValue = () => inp.value;
            if (opts && opts.onChange) inp.addEventListener('change', () => opts.onChange(inp.value));
            return wrap;
        }
    };

    win.Folders = {
        bar: () => el('div', 'folders-bar'),
        grid: () => el('div', 'folders-grid'),
        filterItems: items => items,
        moveSelect: () => { const b = el('button', 'tool-btn', 'Sposta'); return b; },
        get: () => ''
    };

    win.confirm = () => false;

    win.eval(SRC_STRAT);
    win.eval(SRC_SCHEMI);

    return { dom, win, doc, store, mod: win.App._mod };
}
function setConfirm(env, v) { env.win.confirm = () => v; }

async function openSchema(env, docObj, title) {
    const id = 'x' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'schema', title: title || 'Test', content: JSON.stringify(docObj),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: id });
    await sleep(140);
    return id;
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function ptr(env, target, type, x, y) {
    target.dispatchEvent(new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}
function nodeGroup(env, nid) { return env.doc.querySelector('[data-nid="' + nid + '"]'); }
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function guideLines(env) { return $$(env, '.sc-guide line'); }
function stratButtons(env) { return Array.from(env.doc.querySelectorAll('.sc-btnwrap button')); }
function stratButton(env, label) {
    return stratButtons(env).filter(b => b.textContent.trim() === label)[0] || null;
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function guideInfo(env) {
    return guideLines(env).map(g => {
        const x1 = +g.getAttribute('x1'), y1 = +g.getAttribute('y1');
        const x2 = +g.getAttribute('x2'), y2 = +g.getAttribute('y2');
        return {
            dash: g.hasAttribute('stroke-dasharray'),
            dashVal: g.getAttribute('stroke-dasharray'),
            span: Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)),
            vert: Math.abs(x2 - x1) < 1
        };
    });
}
function connect(env, fromId, toId) {
    const cb = stratButton(env, 'Collega');
    click(env, cb);
    ptr(env, nodeGroup(env, fromId), 'pointerdown', 5, 5);
    ptr(env, nodeGroup(env, toId), 'pointerdown', 9, 9);
}
function clickAutoLayout(env) {
    const b = stratButton(env, 'Auto-layout');
    if (b) click(env, b);
    return b;
}
async function saveNow(env) {
    const btns = Array.from(env.doc.querySelectorAll('.app-header button'));
    const b = btns.filter(x => /Salva/.test(x.textContent))[0];
    if (b) click(env, b);
    await sleep(140);
}
function docOf(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return JSON.parse(it.content);
}
function mkNode(id, x, y, text) {
    return { id: id, x: x, y: y, w: 170, h: 60, text: text || (id.toUpperCase()) };
}
function mkEdge(from, to, label) { return { id: 'e' + from + to, from: from, to: to, label: label || '', color: '#8ca4ff' }; }
function baseDoc(type, nodes, edges) {
    return {
        type: type, nodes: nodes, edges: edges,
        view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    };
}
async function changeType(env, v) {
    selType(env).value = v;
    selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await sleep(550);
}

// ---------------------------------------------------------------
// Snapshot: confronta DOM vs doc.edges + stato guide
// ---------------------------------------------------------------
async function checkStage(env, id, label, exp /* null | 'colonne' | 'righe' */) {
    await saveNow(env);
    const doc = docOf(env, id);
    const eg = edgeGroups(env);
    const domIds = eg.map(g => g.getAttribute('data-eid')).sort();
    const docIds = doc.edges.map(e => e.id).sort();
    const same = domIds.length === docIds.length && domIds.every((v, i) => v === docIds[i]);
    const gi = guideInfo(env);
    console.log('    [' + label + '] type=' + selType(env).value +
        ' doc.edges=' + docIds.length + ' dom=' + domIds.length +
        ' eid_match=' + same + ' guide=' + gi.length +
        (gi.length ? ' span=' + gi.map(g => g.span).join('/') + ' dash=' + gi.some(g => g.dash) : ''));

    ok(same, 'P1 ' + label + ': DOM .sc-edge == doc.edges (stessi data-eid)',
        'dom=[' + domIds.join(',') + '] doc=[' + docIds.join(',') + ']');
    if (exp === null) {
        ok(gi.length === 0, 'P4c ' + label + ': zero linee .sc-guide residue', 'n=' + gi.length);
    } else {
        ok(gi.length >= 1, 'P4d ' + label + ': guide presenti dopo ritorno a ' + exp, 'n=' + gi.length);
        ok(gi.every(g => !g.dash), 'P2 ' + label + ': guide SENZA stroke-dasharray (continue)', 'dash=' + JSON.stringify(gi.map(g => g.dashVal)));
        ok(gi.every(g => g.span >= 10000), 'P2 ' + label + ': estensione span >= 10000', JSON.stringify(gi.map(g => g.span)));
        if (exp === 'colonne') ok(gi.every(g => g.vert), 'P4 ' + label + ': guide verticali (colonne)');
        else ok(gi.every(g => !g.vert), 'P4 ' + label + ': guide orizzontali (righe)');
    }
    return { doc: doc, domIds: domIds, docIds: docIds, same: same, gi: gi, type: selType(env).value };
}

// ===============================================================
async function main() {
    try {
        // ---------- PUNTO 2/3: ispezione codice guideHtml ----------
        console.log('== QA1 P2/P3: sorgente di guideHtml + grep ==');
        const i0 = SRC_SCHEMI.indexOf('function guideHtml');
        const i1 = SRC_SCHEMI.indexOf('function render()', i0);
        ok(i0 > 0 && i1 > i0, 'P3: funzione guideHtml trovata in schemi.js', 'i0=' + i0 + ' i1=' + i1);
        const body = SRC_SCHEMI.slice(i0, i1);
        console.log('--- estratto guideHtml ---');
        console.log(body.split('\n').map((l, k) => '  ' + (k + 1) + ': ' + l).join('\n'));
        ok(!/stroke-dasharray/.test(body), 'P2/P3 grep: guideHtml NON contiene stroke-dasharray');
        ok(!/- 18|\+ 18/.test(body), 'P3 grep: guideHtml NON contiene overshoot dai bordi nodo (-18/+18)');
        ok(/const SPAN = 50000/.test(body), 'P3 grep: estensione fissa SPAN = 50000 (nessun bordo nodo)');
        ok(/n\.x \+ n\.w \/ 2/.test(body) && /n\.y \+ n\.h \/ 2/.test(body),
            'P3 grep: posizione guide = CENTRO nodo (n.x+n.w/2, n.y+n.h/2)');
        ok(!/n\.(x|y)\s*[-+]\s*n\.(w|h)(?! \/ 2)/.test(body) && !/n\.(x|y)\s*[-+]\s*\d/.test(body),
            'P3 grep: nessun riferimento a bordi min/max dei nodi per l\'estensione');

        const dashLines = SRC_SCHEMI.split('\n')
            .map((l, k) => ({ l: l, k: k }))
            .filter(o => /stroke-dasharray/.test(o.l));
        console.log('--- tutte le occorrenze stroke-dasharray in schemi.js (carve-out attesi) ---');
        dashLines.forEach(o => console.log('  riga ' + (o.k + 1) + ': ' + o.l.trim()));
        ok(dashLines.length > 0 &&
            dashLines.every(o => /e\.extra/.test(o.l) || /const dash = from/.test(o.l) || /#f9974a/.test(o.l)),
            'P2 grep: ogni stroke residuo e\' un carve-out (edge extra / connectFrom / box disegno)');
        const o18 = SRC_SCHEMI.split('\n')
            .map((l, k) => ({ l: l, k: k }))
            .filter(o => /- 18|\+ 18/.test(o.l));
        console.log('--- occorrenze "- 18"/"+ 18" in schemi.js ---');
        o18.forEach(o => console.log('  riga ' + (o.k + 1) + ': ' + o.l.trim()));
        ok(o18.every(o => o.k + 1 > i1 || /maxChars|niente overshoot/.test(o.l)),
            'P3 grep: "- 18"/"+ 18" solo fuori da guideHtml (testo nodo / commento)');

        // ---------- PUNTI 1/2/4: harness su schema multi-tipo ----------
        console.log('\n== QA1 P1/P2/P4: harness schema multi-tipo (albero 6 nodi, lr, tb rimosso: migrato ad albero) ==');
        const env = makeEnv();
        setConfirm(env, false); // nessuna rimozione archi ai cambi tipo
        const nodes = [mkNode('a', 700, 400, 'Radice'), mkNode('b', 100, 600), mkNode('c', 900, 100),
            mkNode('d', 400, 200), mkNode('e', 50, 50), mkNode('f', 800, 700)];
        const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('b', 'e'), mkEdge('c', 'f')];
        const id = await openSchema(env, baseDoc('albero', nodes, edges), 'QA1 multi-tipo');

        // apertura + auto-layout su albero (nessuna guida attesa)
        await checkStage(env, id, 'apertura albero', null);
        clickAutoLayout(env);
        await sleep(500);
        await checkStage(env, id, 'albero dopo auto-layout', null);

        // cambio tipo -> lr
        await changeType(env, 'lr');
        await checkStage(env, id, 'lr dopo cambio tipo', 'colonne');

        // auto-layout su lr
        clickAutoLayout(env);
        await sleep(500);
        const sLay = await checkStage(env, id, 'lr dopo auto-layout', 'colonne');
        ok(sLay.doc.nodes.length === 6, 'P4: lr auto-layout non aggiunge nodi', 'n=' + sLay.doc.nodes.length);

        // aggiunta nodo con pulsante "+ Nodo" (nessun arco implicito atteso)
        const btnNodo = stratButton(env, '+ Nodo');
        ok(!!btnNodo, 'P4: pulsante "+ Nodo" presente in lr');
        const nEdgesBefore = edgeGroups(env).length;
        if (btnNodo) { click(env, btnNodo); await sleep(80); }
        const sNodo = await checkStage(env, id, 'lr dopo "+ Nodo"', 'colonne');
        ok(sNodo.doc.nodes.length === 7, 'P4b: + Nodo aggiunge esattamente 1 nodo', 'n=' + sNodo.doc.nodes.length);
        ok(sNodo.doc.edges.length === nEdgesBefore, 'P4b: + Nodo NON aggiunge archi impliciti', 'e=' + sNodo.doc.edges.length);

        const known = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
        const newId = $$(env, '.sc-nodes [data-nid]').map(e => e.getAttribute('data-nid')).filter(x => !known.has(x))[0];
        ok(!!newId, 'P1: id nuovo nodo rilevato', String(newId));

        // arco creato dall'utente con "Collega"
        if (newId) {
            connect(env, 'a', newId);
            await sleep(80);
        }
        const sConn = await checkStage(env, id, 'lr dopo arco utente (Collega)', 'colonne');
        ok(sConn.doc.edges.length === nEdgesBefore + 1, 'P1: arco creato dall\'utente presente in doc.edges', 'e=' + sConn.doc.edges.length);
        ok(sConn.domIds.length === sConn.docIds.length, 'P1: arco utente renderizzato 1:1 nel DOM');

        // BLOCCO 3.3: il tipo 'tb' ("Alto -> basso") NON esiste piu': rimosso da TYPES
        // e, all'apertura, un doc legacy 'tb' viene migrato a 'albero' (auto-layout al
        // primo caricamento). Il selettore non lo propone quindi piu': questi due step
        // ex-"tb dopo cambio tipo/auto-layout: guide righe" sono stati riallineati con
        // una transizione reale lr -> albero -> lr e la verifica che le guide lr (uniche
        // guide orizzontali rimaste) siano di nuovo presenti, continue e verticali.
        await changeType(env, 'albero');
        await changeType(env, 'lr');
        await checkStage(env, id, 'lr dopo transizione (ex tb, tipo rimosso)', 'colonne');
        clickAutoLayout(env);
        await sleep(500);
        await checkStage(env, id, 'lr dopo auto-layout (ex tb, tipo rimosso)', 'colonne');

        // -> mappa / albero / riassunto / libero: guide azzerate
        await changeType(env, 'mappa');
        const sMappa = await checkStage(env, id, 'mappa', null);
        ok(!env.doc.querySelector('.sc-edge-extra'), 'P4c mappa: nessun arco extra residuo (migrazione pulita)');
        await changeType(env, 'albero');
        await checkStage(env, id, 'albero (ritorno)', null);
        await changeType(env, 'riassunto');
        await checkStage(env, id, 'riassunto', null);
        await changeType(env, 'libero');
        await checkStage(env, id, 'libero', null);

        // ritorno finale a lr: guide continue di nuovo presenti
        await changeType(env, 'lr');
        const sFin = await checkStage(env, id, 'lr finale (ritorno)', 'colonne');
        ok(sFin.doc.edges.length === nEdgesBefore + 1, 'P1: nessun arco perso/nei aggiunti nel ciclo di tipi', 'e=' + sFin.doc.edges.length);
        ok(sFin.doc.nodes.length === 7, 'P4: nodi conservati nel ciclo di tipi', 'n=' + sFin.doc.nodes.length);
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI QA1: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}

main();
