/* ============================================================
   tests/qa4_relayout.js — QA-4 (T1 indipendente): CHECKLIST QA-2
   parte T1 (logica) su schema 9 nodi:
     - 1 radice con 4 figli diretti + 1 nipote (albero 6 nodi)
     - 1 coppia disconnessa dal resto (2 nodi, 1 arco)
     - 1 nodo isolato (0 archi)
     - 2 archi "violatori" per albero: d->e (2° genitore) ed
       e->r (ciclo) — devono diventare extra MAI rimossi
   Ciclo albero->mappa->lr->libero->riassunto->albero x3:
     5) nodi==9, edges invariati (stessi id), type aggiornato
     6) zero NaN dopo changeType E dopo autoLayout; targets finiti
     7) extra===true in albero, edges.length invariato, tratteggiato
     8) UN solo Ctrl+Z dopo changeType: tipo+posizioni+view in 1 passo
     9) libero: autoLayout non sposta posizioni (x/y prima/dopo)
     10) zero chiamate a confirm() (monkey-patch contatore)

   jsdom: logica/struttura, NON geometria reale. Harness copiato dal
   pattern tests/implBlock12.test.js (nessun import di file
   modificabili da altri). Prodotto in LETTURA.

   Eseguire con: node tests/qa4_relayout.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_STRAT = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemaStrategies.js'), 'utf8');
const SRC_SCHEMI = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'schemi.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------
// Ambiente DOM + stub (copia minima del pattern uiHarness/implBlock12)
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
    // PUNTO 10: confirm() monkey-patched con contatore
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

// ---- helpers ----
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function nodeGroup(env, nid) { return env.doc.querySelector('[data-nid="' + nid + '"]'); }
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function nodeCount(env) { return $$(env, 'g.sc-node[data-nid]').length; }
function edgeCount(env) { return edgeGroups(env).length; }
function stratButton(env, label) {
    return Array.from(env.doc.querySelectorAll('.sc-btnwrap button'))
        .filter(b => b.textContent.trim() === label)[0] || null;
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function worldTransform(env) { return env.doc.querySelector('.sc-world').getAttribute('transform'); }
function toastText(env) { const t = env.doc.querySelector('.sc-toast'); return t ? t.textContent : null; }
async function saveNow(env) {
    const b = Array.from(env.doc.querySelectorAll('.app-header button')).filter(x => /Salva/.test(x.textContent))[0];
    if (b) click(env, b);
    await sleep(250);
}
function docOf(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return JSON.parse(it.content);
}
async function changeType(env, v) {
    selType(env).value = v;
    selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await sleep(560);
}
function mBase(type, nodes, edges, view) {
    return {
        type: type, nodes: nodes, edges: edges,
        view: view || { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    };
}
const mkN = (id, x, y) => ({ id: id, x: x, y: y, w: 170, h: 60, text: id.toUpperCase() });
function mkEid(id, f, t) { return { id: id, from: f, to: t, label: '', color: '#8ca4ff' }; }

// posizioni dai rettangoli DOM (mondo, indipendenti dal view-transform)
function posMapDom(env) {
    const m = {};
    $$(env, 'g.sc-node[data-nid]').forEach(g => {
        const r = g.querySelector('rect');
        if (r) m[g.getAttribute('data-nid')] = { x: +r.getAttribute('x'), y: +r.getAttribute('y') };
    });
    return m;
}
function posEqual(m1, m2) {
    const k1 = Object.keys(m1), k2 = Object.keys(m2);
    if (k1.length !== k2.length) return false;
    return k1.every(k => m2[k] && m1[k].x === m2[k].x && m1[k].y === m2[k].y);
}
function domFinite(env) {
    const bad = [];
    $$(env, 'g.sc-node[data-nid]').forEach(g => {
        const r = g.querySelector('rect');
        if (!r) { bad.push(g.getAttribute('data-nid') + ':no-rect'); return; }
        const x = +r.getAttribute('x'), y = +r.getAttribute('y');
        const w = +r.getAttribute('width'), h = +r.getAttribute('height');
        if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) bad.push(g.getAttribute('data-nid'));
    });
    return bad;
}
// targets esponibili via SchemaStrategies (deep clone: mai mutare il doc)
function targetsInfo(env, t, d) {
    const s = env.win.SchemaStrategies.getStrategy(t);
    const tg = s.autoLayout(JSON.parse(JSON.stringify(d.nodes)), JSON.parse(JSON.stringify(d.edges)));
    if (tg === null) return { isNull: true, bad: [] };
    const bad = d.nodes.filter(n => !tg[n.id] || !isFinite(tg[n.id].x) || !isFinite(tg[n.id].y)).map(n => n.id);
    return { isNull: false, bad: bad };
}
function edgeIdsOf(d) { return d.edges.map(e => e.id).sort().join(','); }

// ---- fixture 9 nodi ----
const NODES = [
    mkN('r', 720, 80),          // radice
    mkN('a', 260, 300), mkN('b', 540, 300), mkN('c', 820, 300), mkN('d', 1100, 300), // 4 figli diretti
    mkN('e', 260, 520),         // nipote (a->e): 6° nodo albero => 9 totali
    mkN('p', 140, 720), mkN('q', 420, 720), // coppia disconnessa (p->q)
    mkN('z', 760, 720)          // nodo isolato
];
const EDGES = [
    mkEid('e_ra', 'r', 'a'), mkEid('e_rb', 'r', 'b'), mkEid('e_rc', 'r', 'c'), mkEid('e_rd', 'r', 'd'),
    mkEid('e_ae', 'a', 'e'),
    mkEid('e_pq', 'p', 'q'),    // coppia staccata dal resto
    mkEid('e_de', 'd', 'e'),    // VIOLAZIONE albero: 2° genitore per e
    mkEid('e_er', 'e', 'r')     // VIOLAZIONE albero: ciclo r->a->e->r
];
const BASE_IDS = EDGES.map(e => e.id).sort().join(',');
const CYCLE = ['mappa', 'lr', 'libero', 'riassunto', 'albero'];

// ===============================================================
async function main() {
    try {
        const env = makeEnv();
        // Apertura come mappa (tutti gli archi validi lì), poi il PRIMO
        // passaggio ad albero verifica il bootstrap dei vincoli.
        const id = await openSchema(env, mBase('mappa', NODES, EDGES), 'QA4-9nodi');

        // ---------- apertura ----------
        console.log('== QA4-5: apertura ==');
        let d = docOf(env, id);
        ok(d.nodes.length === 9, 'QA2.5 apertura: 9 nodi', 'n=' + d.nodes.length);
        ok(d.edges.length === 8 && edgeIdsOf(d) === BASE_IDS,
            'QA2.5 apertura: 8 archi, stessi id', 'ids=' + edgeIdsOf(d));
        ok(d.type === 'mappa' && selType(env).value === 'mappa', 'QA2.5 apertura: type=mappa');
        ok(nodeCount(env) === 9 && edgeCount(env) === 8, 'QA2.5 apertura: DOM 9 nodi / 8 archi',
            'n=' + nodeCount(env) + ' e=' + edgeCount(env));
        ok(domFinite(env).length === 0, 'QA2.6 apertura: posizioni DOM finite',
            'bad=' + domFinite(env).join(','));

        // ---------- 7) bootstrap vincoli: -> albero ----------
        console.log('== QA4-7: bootstrap vincoli (passaggio ad albero) ==');
        await changeType(env, 'albero');
        await saveNow(env);
        d = docOf(env, id);
        const extras = d.edges.filter(e => e.extra).map(e => e.id).sort();
        ok(d.type === 'albero', 'QA2.7 type=albero dopo changeType');
        ok(d.nodes.length === 9, 'QA2.7 nodi invariati (9)', 'n=' + d.nodes.length);
        ok(d.edges.length === 8 && edgeIdsOf(d) === BASE_IDS,
            'QA2.7 edges.length INVIARIATO (MAI rimossi)', 'e=' + d.edges.length + ' ids=' + edgeIdsOf(d));
        ok(extras.join(',') === 'e_de,e_er',
            'QA2.7 archi violatori marcati extra===true (2° genitore + ciclo)',
            'extras=[' + extras.join(',') + ']');
        ok(d.edges.filter(e => e.extraMotivo).length === 2,
            'QA2.7 extra con extraMotivo');
        let gExtra = $$(env, '.sc-edge-extra');
        ok(gExtra.length === 2, 'QA2.7 DOM: 2 gruppi .sc-edge-extra', 'n=' + gExtra.length);
        ok(!!env.doc.querySelector('.sc-edge-extra path[stroke-dasharray]'),
            'QA2.7 DOM: extra renderizzato TRATTEGGIATO (stroke-dasharray)');
        const strayDash = $$(env, '[stroke-dasharray]').filter(e => !(e.closest && e.closest('.sc-edge-extra')));
        ok(strayDash.length === 0, 'QA2.7 dash solo sugli extra (nessun trattino fuori)',
            'stray=' + strayDash.length);
        ok(env.win.__confirmCalls.length === 0,
            'QA2.10 bootstrap: zero confirm()', 'n=' + env.win.__confirmCalls.length);

        // ---------- ciclo x3 ----------
        console.log('== QA4-5/6/9/10: ciclo albero->mappa->lr->libero->riassunto->albero x3 ==');
        for (let c = 1; c <= 3; c++) {
            for (const t of CYCLE) {
                const tag = 'ciclo' + c + '->' + t;
                const prevDomPos = posMapDom(env); // per il confronto in libero (QA2.9)
                await changeType(env, t);
                await saveNow(env);
                d = docOf(env, id);

                // (5) type / nodi / edges invariati
                ok(d.type === t && selType(env).value === t,
                    'QA2.5 ' + tag + ': type aggiornato', 'doc=' + d.type + ' sel=' + selType(env).value);
                ok(d.nodes.length === 9,
                    'QA2.5 ' + tag + ': doc.nodes.length==9', 'n=' + d.nodes.length);
                ok(d.edges.length === 8 && edgeIdsOf(d) === BASE_IDS,
                    'QA2.5 ' + tag + ': edges invariati (stessi id)',
                    'e=' + d.edges.length + ' ids=' + edgeIdsOf(d));

                // (6) zero NaN dopo changeType (DOM) + targets finiti
                const badPos = domFinite(env);
                ok(badPos.length === 0,
                    'QA2.6 ' + tag + ': posizioni nodi FINITE dopo changeType',
                    'bad=' + badPos.join(','));
                const tr = worldTransform(env);
                ok(!!tr && tr.indexOf('NaN') < 0, 'QA2.6 ' + tag + ': view transform senza NaN', String(tr));
                ok(nodeCount(env) === 9 && edgeCount(env) === 8,
                    'QA2.6 ' + tag + ': DOM 9 nodi / 8 archi', 'n=' + nodeCount(env) + ' e=' + edgeCount(env));
                const ti = targetsInfo(env, t, d);
                if (ti.isNull) {
                    ok(t === 'libero', 'QA2.6 ' + tag + ': targets null SOLO in libero');
                } else {
                    ok(ti.bad.length === 0,
                        'QA2.6 ' + tag + ': targets autoLayout TUTTI finiti',
                        'bad=' + ti.bad.join(','));
                }

                // (7) extra SOLO in albero (mai rimossi)
                const ex = d.edges.filter(e => e.extra).map(e => e.id).sort();
                if (t === 'albero') {
                    ok(ex.join(',') === 'e_de,e_er',
                        'QA2.7 ' + tag + ': extra===true su ciclo+2° genitore', 'extras=[' + ex.join(',') + ']');
                    const gE = $$(env, '.sc-edge-extra');
                    ok(gE.length === 2 && !!env.doc.querySelector('.sc-edge-extra path[stroke-dasharray]'),
                        'QA2.7 ' + tag + ': DOM extra tratticgiato x2',
                        'gruppi=' + gE.length + ' dash=' + !!env.doc.querySelector('.sc-edge-extra path[stroke-dasharray]'));
                } else {
                    ok(ex.length === 0,
                        'QA2.7 ' + tag + ': nessun residuo extra su tipo valido',
                        'extras=[' + ex.join(',') + ']');
                }

                // (10) zero confirm a ogni passo
                ok(env.win.__confirmCalls.length === 0,
                    'QA2.10 ' + tag + ': zero confirm()', 'n=' + env.win.__confirmCalls.length);

                // auto-layout click: finite dopo (e non sposta in libero)
                const lay = stratButton(env, 'Auto-layout');
                if (t === 'libero') {
                    ok(!!lay && lay.disabled === true, 'QA2.9 ' + tag + ': pulsante Auto-layout DISABILITATO');
                    click(env, lay);
                    await sleep(320);
                    const afterPos = posMapDom(env);
                    ok(posEqual(prevDomPos, afterPos),
                        'QA2.9 ' + tag + ': autoLayout libero NON sposta posizioni (x/y prima==dopo)',
                        'prima=' + JSON.stringify(prevDomPos.r) + ' dopo=' + JSON.stringify(afterPos.r));
                } else {
                    ok(!!lay && lay.disabled === false, 'QA2.6 ' + tag + ': pulsante Auto-layout attivo');
                    if (lay) click(env, lay);
                    await sleep(560);
                    const badAfter = domFinite(env);
                    ok(badAfter.length === 0,
                        'QA2.6 ' + tag + ': posizioni FINITE dopo autoLayout',
                        'bad=' + badAfter.join(','));
                    ok(nodeCount(env) === 9 && edgeCount(env) === 8,
                        'QA2.6 ' + tag + ': nessuna perdita dopo autoLayout',
                        'n=' + nodeCount(env) + ' e=' + edgeCount(env));
                }
                console.log('    [' + tag + '] n=' + d.nodes.length + ' e=' + d.edges.length +
                    ' extra=' + ex.length + ' confirm=' + env.win.__confirmCalls.length +
                    ' DOM=' + nodeCount(env) + '/' + edgeCount(env));
            }
        }

        // badge zoom senza NaN (dopo 3 cicli, siamo ad albero)
        const badge = env.doc.querySelector('.sc-zoom');
        ok(!!badge && /^\d+%$/.test(badge.textContent) && badge.textContent.indexOf('NaN') < 0,
            'QA2.6 badge .sc-zoom valido dopo i cicli', badge ? badge.textContent : 'n/a');

        // ---------- 8) UNDO in un passo ----------
        console.log('== QA4-8: UNDO (un solo Ctrl+Z dopo changeType) ==');
        await saveNow(env);
        d = docOf(env, id);
        ok(d.type === 'albero', 'QA2.8 pre-condizione: siamo ad albero', d.type);
        const pos0 = posMapDom(env);
        const tr0 = worldTransform(env);
        const n0 = nodeCount(env), e0 = edgeCount(env);
        const ids0 = edgeIdsOf(d);
        const ex0 = d.edges.filter(x => x.extra).length;

        await changeType(env, 'mappa');
        await saveNow(env);
        d = docOf(env, id);
        ok(d.type === 'mappa' && selType(env).value === 'mappa',
            'QA2.8 changeType -> mappa applicato', 'doc=' + d.type);

        // UN SOLO Ctrl+Z
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await sleep(220);
        await saveNow(env);
        d = docOf(env, id);
        const pos1 = posMapDom(env);
        ok(selType(env).value === 'albero' && d.type === 'albero',
            'QA2.8 UN Ctrl+Z: tipo ripristinato (albero)', 'sel=' + selType(env).value + ' doc=' + d.type);
        ok(posEqual(pos0, pos1),
            'QA2.8 UN Ctrl+Z: posizioni 9 nodi ripristinate in UN passo',
            'diff=' + Object.keys(pos0).filter(k => !pos1[k] || pos0[k].x !== pos1[k].x || pos0[k].y !== pos1[k].y).join(','));
        ok(worldTransform(env) === tr0,
            'QA2.8 UN Ctrl+Z: view ripristinata in UN passo',
            worldTransform(env) + ' vs ' + tr0);
        ok(nodeCount(env) === n0 && edgeCount(env) === e0 &&
            d.nodes.length === 9 && d.edges.length === 8 && edgeIdsOf(d) === ids0,
            'QA2.8 UN Ctrl+Z: NESSUNA perdita nodi/archi',
            'n=' + d.nodes.length + ' e=' + d.edges.length);
        ok(d.edges.filter(x => x.extra).length === ex0,
            'QA2.8 UN Ctrl+Z: extra coerenti allo stato ripristinato',
            'extra=' + d.edges.filter(x => x.extra).length + ' vs ' + ex0);
        ok($$(env, '.sc-edge-extra').length === ex0,
            'QA2.8 UN Ctrl+Z: DOM extra coerente', 'dom-extra=' + $$(env, '.sc-edge-extra').length);
        ok(env.win.__confirmCalls.length === 0,
            'QA2.8 UN Ctrl+Z: zero confirm()', 'n=' + env.win.__confirmCalls.length);

        // ---------- 10) contatore confirm globale ----------
        ok(env.win.__confirmCalls.length === 0,
            'QA2.10 FINALE: NESSUNA chiamata a confirm() in 3 cicli + undo + bootstrap',
            'n=' + env.win.__confirmCalls.length + ' msgs=' + JSON.stringify(env.win.__confirmCalls));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('\n================================================');
    console.log('RISULTATI qa4_relayout: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
