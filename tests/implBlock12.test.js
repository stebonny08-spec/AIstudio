/* ============================================================
   tests/implBlock12.test.js — T1 IMPLementativo BLOCCHI 1+2
   (matrice pulsanti, bootstrap, fallback sibling, layout senza
   NaN, undo del cambio tipo).

   Verifica LOGICA (niente geometria reale: jsdom ha clientWidth=0).

   Eseguire con: node tests/implBlock12.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const P_STRAT = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemaStrategies.js');
const P_SCHEMI = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemi.js');
const SRC_STRAT = fs.readFileSync(P_STRAT, 'utf8');
const SRC_SCHEMI = fs.readFileSync(P_SCHEMI, 'utf8');
const S = require(P_STRAT);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===============================================================
// 1) MATRICE DEI PULSANTI PER TIPO (spec 1.1, ui() senza argomento)
// ===============================================================
console.log('\n== 1. Matrice pulsanti per tipo (schemaStrategies.ui) ==');
{
    const exp = {
        albero: ['node', 'child', 'sibling', 'del', 'connect', 'layout'],
        mappa: ['child', 'sibling', 'del', 'connect', 'layout'],
        lr: ['node', 'child', 'sibling', 'del', 'connect', 'layout'],
        libero: ['node', 'child', 'sibling', 'del', 'connect', 'layout', 'arco'],
        riassunto: ['child', 'del', 'connect', 'layout']
    };
    Object.keys(exp).forEach(t => {
        const ui = S.getStrategy(t).ui();
        const ids = ui.pulsanti.map(p => p.id);
        ok(JSON.stringify(ids) === JSON.stringify(exp[t]),
            t + ': matrice esatta [' + exp[t].join(',') + ']', ids.join(','));
    });
    const lib = S.getStrategy('libero').ui();
    const lay = lib.pulsanti.filter(p => p.id === 'layout')[0];
    ok(!!lay && lay.disabilitato === true, 'libero: auto-layout DISABILITATO in matrice');
    const arco = lib.pulsanti.filter(p => p.id === 'arco')[0];
    ok(!!arco && arco.tipo === 'select', 'libero: selettore stile arco presente');
    ok(S.getStrategy('mappa').ui().pannelloTesto === false &&
        S.getStrategy('riassunto').ui().pannelloTesto === true,
        'pannello Testo solo in riassunto');
    // fallback sibling dichiarato a livello strategia
    ok(S.getStrategy('mappa').siblingFallback === 'child', 'mappa: siblingFallback = child');
    ok(['albero', 'lr', 'libero', 'riassunto'].every(t => S.getStrategy(t).siblingFallback !== 'child'),
        'albero/lr/libero/riassunto: siblingFallback = nodo isolato (default)');
}

// ===============================================================
// 2) LAYOUT SENZA NaN / BOUNDED (spec 2.2) — input "nasty"
// ===============================================================
console.log('\n== 2. autoLayout: tutti i target finiti e contenuti ==');
{
    const nasty = [
        { id: 'n1' },                                        // nessuna geometria
        { id: 'n2', x: NaN, y: NaN, w: NaN, h: NaN },        // NaN espliciti
        { id: 'n3', x: 100, y: 100, w: 170, h: 60 },
        { id: 'n4', x: 200, y: 150, w: 170, h: 60 },
        { id: 'n5', x: 'abc', y: null, w: 170, h: 60 }       // tipi sbagliati
    ];
    const edges = [
        { id: 'e1', from: 'n3', to: 'n4' },                  // arco normale
        { id: 'e2', from: 'n4', to: 'n3' },                  // ciclo reciproco
        { id: 'e3', from: 'n1', to: 'n99' },                 // dangling (endpoint assente)
        { id: 'e4', from: 'n2', to: 'n5' }
    ];
    ['albero', 'mappa', 'lr', 'riassunto'].forEach(t => {
        const strat = S.getStrategy(t);
        const t2 = strat.autoLayout(nasty, edges);
        let allFinite = !!t2, maxAbs = 0, missing = [];
        nasty.forEach(n => {
            const p = t2 && t2[n.id];
            if (!p || !isFinite(p.x) || !isFinite(p.y)) { missing.push(n.id); allFinite = false; return; }
            maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
        });
        ok(allFinite, t + ': tutti i target finiti (niente NaN)', 'missing=' + missing.join(','));
        ok(allFinite && maxAbs < 50000, t + ': coordinate contenute (<50000, prima era +-1.5M)', 'max=' + maxAbs);
    });
    ok(S.getStrategy('libero').autoLayout(nasty, edges) === null,
        'libero: autoLayout ritorna null (nessun rilayout)');
    // mappa: nodi irraggiungibili NON devono esplodere (causa A)
    const hub = { id: 'h', x: 500, y: 500, w: 170, h: 60 };
    const far1 = { id: 'o1', x: 10, y: 10, w: 170, h: 60 };
    const far2 = { id: 'o2' };
    const tm = S.getStrategy('mappa').autoLayout([hub, far1, far2], []);
    const d1 = Math.hypot(tm.o1.x - tm.h.x, tm.o1.y - tm.h.y);
    const d2 = Math.hypot(tm.o2.x - tm.h.x, tm.o2.y - tm.h.y);
    ok(isFinite(d1) && d1 < 10000, 'mappa: orfano 1 a distanza finita contenuta', 'd=' + d1);
    ok(isFinite(d2) && d2 < 10000, 'mappa: orfano 2 (senza geometria) a distanza finita', 'd=' + d2);
}

// ===============================================================
// 3) DETERMINISMO DEL FORCE MAPPA (spec 2.2d)
// ===============================================================
console.log('\n== 3. Force mappa deterministico ==');
{
    const mk = () => ([
        { id: 'a', x: 300, y: 300, w: 170, h: 60 },
        { id: 'b', x: 650, y: 250, w: 170, h: 60 },
        { id: 'c', x: 500, y: 550, w: 170, h: 60 },
        { id: 'd' },
        { id: 'e', x: NaN, y: 50, w: 170, h: 60 }
    ]);
    const es = [
        { id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' },
        { id: 'e3', from: 'c', to: 'a' }, { id: 'e4', from: 'a', to: 'd' }
    ];
    const s = S.getStrategy('mappa');
    s.hubId = null;
    const t1 = s.autoLayout(mk(), es);
    const t2 = s.autoLayout(mk(), es);
    ok(JSON.stringify(t1) === JSON.stringify(t2),
        'stesso input -> stessi output (deep-equal)', JSON.stringify(t1).slice(0, 120));
    // seed circolare di riserva + riconversione a interi
    const allInt = Object.keys(t1).every(k => Number.isInteger(t1[k].x) && Number.isInteger(t1[k].y));
    ok(allInt, 'target arrotondati a interi (nessun residuo float)');
}

// ===============================================================
// 4) ORFANI / CASELLE SPECIALI PER TIPO (spec 2.3)
// ===============================================================
console.log('\n== 4. Orfani e righe/colonne separate ==');
{
    // albero: orfano in riga separata SOTTO l'albero
    const ta = S.getStrategy('albero').autoLayout(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        [{ id: 'e', from: 'a', to: 'b' }]);
    ok(ta.c.y > Math.max(ta.a.y, ta.b.y), 'albero: orfano in riga separata sotto la gerarchia',
        'a=' + ta.a.y + ' b=' + ta.b.y + ' c=' + ta.c.y);
    // lr: orfano in colonna propria
    const tl = S.getStrategy('lr').autoLayout(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        [{ id: 'e', from: 'a', to: 'b' }]);
    ok(tl.c.x !== tl.a.x && tl.c.x !== tl.b.x && tl.c.x > Math.max(tl.a.x, tl.b.x),
        'lr: orfano in colonna propria (dopo gli altri layer)',
        'a=' + tl.a.x + ' b=' + tl.b.x + ' c=' + tl.c.x);
    // lr con ciclo puro: cammino massimo senza loop infinito, tutti finiti
    const tlc = S.getStrategy('lr').autoLayout(
        [{ id: 'x' }, { id: 'y' }, { id: 'z' }],
        [{ id: 'e1', from: 'x', to: 'y' }, { id: 'e2', from: 'y', to: 'x' }, { id: 'e3', from: 'y', to: 'z' }]);
    ok(['x', 'y', 'z'].every(k => isFinite(tlc[k].x) && isFinite(tlc[k].y)) && tlc.x.x !== tlc.y.x,
        'lr: ciclo gestito (layer finiti, sorgente distinta dal succ.)',
        JSON.stringify(tlc));
    // riassunto: orfano accodato in fondo
    const tr = S.getStrategy('riassunto').autoLayout(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        [{ id: 'e', from: 'a', to: 'b' }]);
    ok(tr.a.y < tr.b.y && tr.b.y < tr.c.y, 'riassunto: colonna BFS con orfano accodato per ultimo',
        'a=' + tr.a.y + ' b=' + tr.b.y + ' c=' + tr.c.y);
    // albero con doppio genitore: l'extra NON influenza la gerarchia (BFS su validi)
    const t2 = S.getStrategy('albero').autoLayout(
        [{ id: 'r' }, { id: 'p' }, { id: 'q' }],
        [{ id: 'e1', from: 'r', to: 'p' }, { id: 'e2', from: 'r', to: 'q' },
        { id: 'e3', from: 'q', to: 'p', extra: true }]);
    ok(t2.p.y === t2.q.y && t2.r.y < t2.p.y && Object.keys(t2).length === 3,
        'albero: arco extra ignorato dalla gerarchia (p e q stessa riga)', JSON.stringify(t2));
}

// ===============================================================
// 5) SORGENTE schemi.js: pad/clamp, undo, bootstrap, niente confirm
// ===============================================================
console.log('\n== 5. Vincoli di sorgente (schemi.js) ==');
{
    ok(/const pad = 40;/.test(SRC_SCHEMI), 'centerView: pad 40');
    const cl = (SRC_SCHEMI.match(/0\.25, 2\.0/g) || []).length;
    ok(cl >= 2, 'clamp zoom [0.25, 2.0] in centerView E zoomAt', 'n=' + cl);
    ok(/const UNDO_CAP = 30;/.test(SRC_SCHEMI), 'undo stack capped a 30');
    ok(/pushUndoSnapshot\(\);/.test(SRC_SCHEMI), 'changeType: snapshot PRIMA della migrazione');
    const iSnap = SRC_SCHEMI.indexOf('pushUndoSnapshot();');
    const iMig = SRC_SCHEMI.indexOf('SchemaStrategies.migrateSchema(ed.doc, nuovo)');
    ok(iSnap > 0 && iMig > 0 && iSnap < iMig, 'snapshot spinto PRIMA di migrateSchema',
        'snap@' + iSnap + ' mig@' + iMig);
    ok(/String\(e\.key\)\.toLowerCase\(\) === 'z'/.test(SRC_SCHEMI) && /ctrlKey \|\| e\.metaKey/.test(SRC_SCHEMI),
        'Ctrl+Z in onKey (ctrl/meta, senza shift)');
    ok(!/OK = li rimuovo/.test(SRC_SCHEMI) && !/confirm\(one/.test(SRC_SCHEMI),
        'confirm() per gli archi extra ELIMINATO (mai rimossi)');
    ok(/doc\.nodes\.length === 0/.test(SRC_SCHEMI),
        'buildStrategyButtons legge la lunghezza di ed.doc.nodes (bootstrap)');
    ok((SRC_SCHEMI.match(/animateLayout\(targets, 200\)/g) || []).length === 2,
        'animateLayout(targets, 200) esattamente 2 (autoLayout + changeType)');
    ok(!/doc\.type === 'mappa'/.test(SRC_SCHEMI) && !/ed\.doc\.type === 'albero'/.test(SRC_SCHEMI),
        'nessuno switch hard-coded su doc.type');
}

// ===============================================================
// 6) HARNESS DOM (jsdom): bootstrap, fallback, undo, backfill
// ===============================================================
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
        empty: (icon, text, btnText, onClick) => el('div', 'app-empty'),
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
    win.__confirmCalls = [];
    win.confirm = msg => { win.__confirmCalls.push(String(msg == null ? '' : msg)); return false; };
    win.eval(SRC_STRAT);
    win.eval(SRC_SCHEMI);
    return { dom, win, doc, store, mod: win.App._mod };
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
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function ptr(env, target, type, x, y) {
    target.dispatchEvent(new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}
function nodeGroup(env, nid) { return env.doc.querySelector('[data-nid="' + nid + '"]'); }
function nodeRect(env, nid) {
    const g = nodeGroup(env, nid);
    if (!g) return null;
    const r = g.querySelector('rect');
    if (!r) return null;
    return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') };
}
function edgeCount(env) { return $$(env, '.sc-edges .sc-edge').length; }
function nodeCount(env) { return $$(env, 'g.sc-node[data-nid]').length; }
function stratButton(env, label) {
    return $$(env, '.sc-btnwrap button').filter(b => b.textContent.trim() === label)[0] || null;
}
function selectNode(env, nid) {
    ptr(env, nodeGroup(env, nid), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
}
function toastText(env) { const t = env.doc.querySelector('.sc-toast'); return t ? t.textContent : null; }
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function worldTransform(env) { return env.doc.querySelector('.sc-world').getAttribute('transform'); }
async function saveNow(env) {
    const b = Array.from(env.doc.querySelectorAll('.app-header button')).filter(x => /Salva/.test(x.textContent))[0];
    if (b) click(env, b);
    await sleep(220);
}
function docOf(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return JSON.parse(it.content);
}
const mBase = (type, nodes, edges, view) => ({
    type: type, nodes: nodes, edges: edges,
    view: view || { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
    style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
});
const mkN = (id, x, y) => ({ id: id, x: x, y: y, w: 170, h: 60, text: id.toUpperCase() });
const mkE = (f, t) => ({ id: 'e' + f + t, from: f, to: t, label: '', color: '#8ca4ff' });

(async function main() {
    // ---------- 6a) BOOTSTRAP: 0 nodi -> "+ Nodo" in mappa, poi matrice ----------
    console.log('\n== 6a. Bootstrap (0 nodi) ==');
    {
        const env = makeEnv();
        await openSchema(env, mBase('mappa', [], []), 'Bootstrap');
        ok(!!stratButton(env, '+ Nodo'), 'mappa vuota: mostra [+ Nodo] (bootstrap)');
        ok(!!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello'),
            'mappa vuota: matrice completa + Nodo');
        click(env, stratButton(env, '+ Nodo'));
        await sleep(80);
        ok(nodeCount(env) === 1, 'bootstrap: + Nodo crea il primo nodo', 'n=' + nodeCount(env));
        ok(!stratButton(env, '+ Nodo'), 'mappa con 1 nodo: + Nodo SPARISCE (torna la matrice 1.1)');
        ok(!!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello'),
            'mappa con 1 nodo: +Figlio/+Fratello presenti');
        // mappa: nessun orfano dai pulsanti di aggiunta
        selectNode(env, $$(env, 'g.sc-node[data-nid]')[0].getAttribute('data-nid'));
        await sleep(40);
        const e0 = edgeCount(env);
        click(env, stratButton(env, '+ Figlio'));
        await sleep(60);
        ok(edgeCount(env) === e0 + 1, 'mappa: + Figlio produce nodo CONNESSO', 'e=' + edgeCount(env));
        // + Fratello sul nuovo nodo (ha genitore): edge genitore->nuovo
        click(env, stratButton(env, '+ Fratello'));
        await sleep(60);
        ok(nodeCount(env) === 3 && edgeCount(env) === 2,
            'mappa: + Fratello con genitore = nodo connesso (nessun orfano)',
            'n=' + nodeCount(env) + ' e=' + edgeCount(env));
    }

    // ---------- 6b) FALLBACK + Fratello senza genitore ----------
    console.log('\n== 6b. Fallback +Fratello senza genitore ==');
    {
        const env = makeEnv();
        await openSchema(env, mBase('albero', [mkN('a', 300, 300)], []), 'FallbackAlbero');
        selectNode(env, 'a');
        await sleep(40);
        click(env, stratButton(env, '+ Fratello'));
        await sleep(60);
        ok(nodeCount(env) === 2 && edgeCount(env) === 0 && !toastText(env),
            'albero: +Fratello senza genitore = + Nodo (nodo isolato, NESSUN toast)',
            'n=' + nodeCount(env) + ' e=' + edgeCount(env) + ' toast=' + toastText(env));
    }
    {
        const env = makeEnv();
        await openSchema(env, mBase('mappa', [mkN('a', 300, 300)], []), 'FallbackMappa');
        selectNode(env, 'a');
        await sleep(40);
        click(env, stratButton(env, '+ Fratello'));
        await sleep(60);
        ok(nodeCount(env) === 2 && edgeCount(env) === 1,
            'mappa: +Fratello senza genitore = + Figlio (sempre connesso)',
            'n=' + nodeCount(env) + ' e=' + edgeCount(env));
    }

    // ---------- 6c) UNDO: il cambio tipo e' UN solo passo ----------
    console.log('\n== 6c. Undo cambio tipo (Ctrl+Z) ==');
    {
        const env = makeEnv();
        const id = await openSchema(env,
            mBase('mappa', [mkN('a', 50, 50), mkN('b', 400, 300)], [mkE('a', 'b')],
                { x: 10, y: 20, zoom: 1 }), 'Undo');
        const pos0 = { a: nodeRect(env, 'a'), b: nodeRect(env, 'b') };
        const tr0 = worldTransform(env);
        const nNodes0 = nodeCount(env), nEdges0 = edgeCount(env);

        selType(env).value = 'albero';
        selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
        await sleep(560);
        ok(selType(env).value === 'albero', 'cambio tipo: passo a albero');
        const pos1 = { a: nodeRect(env, 'a'), b: nodeRect(env, 'b') };
        ok(pos1.a.y !== pos0.a.y || pos1.b.y !== pos0.b.y, 'cambio tipo: layout albero sposta i nodi');
        ok(env.win.__confirmCalls.length === 0, 'cambio tipo: NESSUNA conferma chiamata (confirm eliminato)');
        ok(nodeCount(env) === nNodes0 && edgeCount(env) === nEdges0,
            'cambio tipo: nodi/archi invariati', 'n=' + nodeCount(env) + ' e=' + edgeCount(env));
        const badge = env.doc.querySelector('.sc-zoom').textContent;
        ok(/^\d+%$/.test(badge) && +badge.slice(0, -1) >= 25 && +badge.slice(0, -1) <= 200,
            'badge .sc-zoom valido (nessun NaN%, clamp [25,200])', badge);

        // Ctrl+Z: ripristino in UN passo di tipo + posizioni + view
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await sleep(120);
        ok(selType(env).value === 'mappa', 'undo: tipo ripristinato a mappa', selType(env).value);
        const pos2 = { a: nodeRect(env, 'a'), b: nodeRect(env, 'b') };
        ok(pos2.a.x === pos0.a.x && pos2.a.y === pos0.a.y && pos2.b.x === pos0.b.x && pos2.b.y === pos0.b.y,
            'undo: posizioni nodi ripristinate in un passo',
            JSON.stringify(pos2) + ' vs ' + JSON.stringify(pos0));
        ok(worldTransform(env) === tr0, 'undo: view ripristinata (stesso transform)',
            worldTransform(env) + ' vs ' + tr0);
        // secondo Ctrl+Z senza altri snapshot: no-op (nessun residuo, nessun errore)
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await sleep(80);
        ok(selType(env).value === 'mappa' && nodeCount(env) === nNodes0 && edgeCount(env) === nEdges0,
            'undo: secondo Ctrl+Z = no-op stabile', 'n=' + nodeCount(env) + ' e=' + edgeCount(env));
        await saveNow(env);
        const d = docOf(env, id);
        ok(d.type === 'mappa' && d.nodes.length === nNodes0 && d.edges.length === nEdges0,
            'undo: persistito tipo+grafo dopo il save', d.type + ' ' + d.nodes.length + '/' + d.edges.length);
        ok(env.win.__confirmCalls.length === 0, 'undo: nessuna conferma in tutto il flusso');
    }

    // ---------- 6d) BACKFILL normalizeDoc: nodi legacy senza geometria ----------
    console.log('\n== 6d. normalizeDoc: backfill x/y/w/h ==');
    {
        const env = makeEnv();
        const legacy = mBase('albero', [{ id: 'leg', text: 'Nodo legacy senza geometria' }], []);
        delete legacy.nodes[0].x; delete legacy.nodes[0].y;
        delete legacy.nodes[0].w; delete legacy.nodes[0].h;
        await openSchema(env, legacy, 'Legacy');
        const r = nodeRect(env, 'leg');
        ok(!!r && isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h) && r.w > 0 && r.h > 0,
            'nodo senza geometria: x/y/w/h riparati (finite, positivi)', JSON.stringify(r));
        const tr = worldTransform(env);
        ok(!!tr && tr.indexOf('NaN') < 0, 'transform globale senza NaN (canvas non svuotato)', tr);
        const badge = env.doc.querySelector('.sc-zoom').textContent;
        ok(/^\d+%$/.test(badge) && badge.indexOf('NaN') < 0, 'badge zoom senza NaN', badge);
    }

    // ---------- 6e) Cambio tipo: nessuna perdita su tutti i tipi ----------
    console.log('\n== 6e. Cambio tipo su tutti i tipi: 0 perdite ==');
    {
        const env = makeEnv();
        const id = await openSchema(env,
            mBase('mappa', [mkN('a', 300, 300), mkN('b', 650, 250), mkN('c', 500, 550)],
                [mkE('a', 'b'), mkE('b', 'c'), mkE('c', 'a')]), 'NoLoss');
        const n0 = nodeCount(env), e0 = edgeCount(env);
        for (const t of ['albero', 'lr', 'libero', 'riassunto', 'mappa']) {
            selType(env).value = t;
            selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
            await sleep(300);
            ok(nodeCount(env) === n0 && edgeCount(env) === e0 && selType(env).value === t,
                'cambio -> ' + t + ': nodi(' + n0 + ')/archi(' + e0 + ') intatti',
                'n=' + nodeCount(env) + ' e=' + edgeCount(env));
            const tr = worldTransform(env);
            ok(tr.indexOf('NaN') < 0, 'cambio -> ' + t + ': transform senza NaN', tr);
        }
        ok(env.win.__confirmCalls.length === 0, 'tutte le transizioni: zero conferme');
        // grafico con ciclo -> albero: extra marcato, MAI rimosso
        selType(env).value = 'albero';
        selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
        await sleep(320);
        await saveNow(env);
        const d = docOf(env, id);
        ok(d.edges.length === 3 && d.edges.filter(e => e.extra).length === 1,
            'ciclo -> albero: 3 archi preservati, 1 extra tratteggiato (mai rimosso)',
            'e=' + d.edges.length + ' extra=' + d.edges.filter(e => e.extra).length);
        const dash = $$(env, '.sc-edge-extra path').length > 0 &&
            env.doc.querySelector('.sc-edge-extra path[stroke-dasharray]');
        ok(!!dash, 'arco extra renderizzato tratteggiato nel DOM');
    }

    console.log('\n================================================');
    console.log('RISULTATI: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('ECCEZIONE:', e && e.stack ? e.stack : e);
    process.exit(2);
});
