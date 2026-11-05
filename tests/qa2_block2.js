/* ============================================================
   tests/qa2_block2.js — QA-2 (BLOCCO 2: transizione Mappa concettuale)

   Script TEMPORANEO del sub-agente QA. Non modifica prodotto.
   Copia locale dei minimi dell'harness di uiHarness.test.js per:
   1) 10 coppie X->mappa e mappa->X: guide, dash fuori extra,
      DOM==doc, data-eid, nodi invariati, nessuna conferma,
      nessuna crescita al re-render;
   2) doppio esatto A->B: secondo -> extra (sc-edge-extra), mai 2 pieni;
      con conferma=true viene rimosso;
   3) reciproco A->B + B->A: due archi distinti (libero/mappa),
      in albero il reciproco diventa extra;
   4) hub deterministico: nodo selezionato prima del cambio a mappa
      risulta al centro degli altri dopo l'animazione.

   Eseguire con: node tests/qa2_block2.js
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
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------
// Ambiente DOM + stub (copia minima da uiHarness.test.js)
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

    win.confirm = () => false; // default: non rimuovere gli extra

    win.eval(SRC_STRAT);
    win.eval(SRC_SCHEMI);

    return { dom, win, doc, store, mod: win.App._mod, confirmCalls: [] };
}

function recordConfirm(env, result) {
    env.confirmCalls = [];
    env.win.confirm = msg => { env.confirmCalls.push(String(msg == null ? '' : msg)); return result; };
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
    await sleep(140);
    return id;
}

// ---- helpers di interazione ----
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
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
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function edgePath(env, g) {
    const ps = g.querySelectorAll('path');
    return ps.length > 1 ? ps[1] : ps[0];
}
function guideLines(env) { return $$(env, '.sc-guide line'); }
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function selectNode(env, nid) {
    ptr(env, nodeGroup(env, nid), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
}
async function saveNow(env) {
    const btns = Array.from(env.doc.querySelectorAll('.app-header button'));
    const b = btns.filter(x => /Salva/.test(x.textContent))[0];
    if (b) b.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(140);
}
function docOf(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return JSON.parse(it.content);
}
async function go(env, tipo) {
    selType(env).value = tipo;
    selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await sleep(550);
    await saveNow(env);
}
function mkNode(id, x, y, text) {
    return { id: id, x: x, y: y, w: 170, h: 60, text: text || (id.toUpperCase()) };
}
function mkEdge(from, to, id) { return { id: id || ('e' + from + to), from: from, to: to, label: '', color: '#8ca4ff' }; }
function baseDoc(type, nodes, edges) {
    return {
        type: type, nodes: nodes, edges: edges,
        view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    };
}

/* Audita TUTTI gli elementi con stroke-dasharray: devono stare SOLO
   dentro un gruppo .sc-edge-extra (carve-out #1). */
function dashAudit(env) {
    const els = $$ (env, '[stroke-dasharray]');
    const bad = els.filter(e => !(e.closest && e.closest('.sc-edge-extra')));
    return { total: els.length, bad: bad.length };
}

// ===============================================================
// 1) Coppie X->mappa e mappa->X (sottoinsieme delle 30)
// ===============================================================
async function pairCheck(source, target) {
    const env = makeEnv();
    recordConfirm(env, false);
    const nodes = [mkNode('a', 120, 90, 'A'), mkNode('b', 430, 90, 'B'),
        mkNode('c', 740, 90, 'C'), mkNode('d', 430, 330, 'D')];
    const edges = [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'd')];
    const id = await openSchema(env, baseDoc(source, nodes, edges), 'QA2 ' + source + '>' + target);
    // baseline PRISTINA: il gruppo <g class="sc-guide"> e' scheletro statico
    // (schemi.js:2042), presente anche senza nessuna guida renderizzata.
    const pristine = { containers: $$(env, '.sc-guide').length, lines: guideLines(env).length };
    await go(env, target);
    const d = docOf(env, id);
    const tag = 'QA2[' + source + '>' + target + ']';

    // tipo + contenuto invariato
    ok(d.type === target && selType(env).value === target, tag + ' type/selettore', d.type);
    ok(d.nodes.length === 4 && d.edges.length === 3, tag + ' nodi(4)/archi(3) invariati',
        d.nodes.length + '/' + d.edges.length);

    // archi: count + set data-eid identico
    const gs = edgeGroups(env);
    const domIds = gs.map(g => g.getAttribute('data-eid')).sort().join(',');
    const docIds = d.edges.map(e => e.id).sort().join(',');
    ok(gs.length === d.edges.length && domIds === docIds, tag + ' DOM .sc-edge==doc.edges e data-eid identico',
        'dom=' + gs.length + ' ids=' + domIds + ' vs ' + docIds);

    // nessuna conferma sul path valido
    ok(env.confirmCalls.length === 0, tag + ' nessuna conferma chiamata', env.confirmCalls.length + ' call');

    // guide: zero residui dove non previsto; continue dove previsto
    const needGuide = !!env.win.SchemaStrategies.getStrategy(target).ui().guide;
    const guideContainers = $$(env, '.sc-guide').length;
    const gl = guideLines(env);
    if (needGuide) {
        const cont = gl.every(l => !l.hasAttribute('stroke-dasharray'));
        ok(gl.length >= 1 && cont && guideContainers >= 1, tag + ' guide presenti e continue',
            'n=' + gl.length + ' continue=' + cont);
    } else {
        // zero righe di guida (criterio del renderer: .sc-guide line == 0,
        // come in uiHarness) + nessuna crescita del contenitore vs PRISTINO
        ok(gl.length === 0 && guideContainers <= pristine.containers,
            tag + ' zero guide renderizzate (.sc-guide line==0, contenitore non cresciuto vs pristine)',
            'lines=' + gl.length + ' containers=' + guideContainers + ' pristine=' + pristine.containers);
    }

    // dash solo su .sc-edge-extra (con path valido: attesi 0 dash totali)
    const da = dashAudit(env);
    ok(da.bad === 0 && da.total === 0, tag + ' zero dash fuori da .sc-edge-extra (path valido: 0 dash)',
        'dash=' + da.total + ' non-extra=' + da.bad);

    // nessuna crescita al re-render (selectNode -> render)
    const before = edgeGroups(env).length;
    selectNode(env, 'a');
    await sleep(150);
    const after = edgeGroups(env).length;
    const afterIds = edgeGroups(env).map(g => g.getAttribute('data-eid')).sort().join(',');
    ok(after === before && after === d.edges.length && afterIds === docIds,
        tag + ' nessuna crescita al re-render', before + ' -> ' + after);

    console.log('    ' + tag + ' dom=' + gs.length + ' doc=' + d.edges.length +
        ' guide=' + gl.length + ' dash=' + da.total + ' confirm=' + env.confirmCalls.length +
        ' rerender=' + before + '->' + after);
}

// ===============================================================
// 2) Doppio esatto A->B due volte
// ===============================================================
async function doubleEdgeCheck() {
    console.log('\n== QA2 — doppio esatto A->B ==');
    const env = makeEnv();
    recordConfirm(env, false);
    const nodes = [mkNode('a', 120, 90, 'A'), mkNode('b', 500, 90, 'B')];
    const edges = [
        { id: 'e_ab1', from: 'a', to: 'b', label: '', color: '#8ca4ff' },
        { id: 'e_ab2', from: 'a', to: 'b', label: '', color: '#8ca4ff' }
    ];
    const id = await openSchema(env, baseDoc('albero', nodes, edges), 'QA2 Doppio');

    // transizione (flusso BLOCCO 2): albero -> lr, conferma=false (tenere extra)
    await go(env, 'lr');
    const d = docOf(env, id);
    ok(d.edges.length === 2, 'QA2 doppio: nessuna rimozione con conferma=NO', 'edges=' + d.edges.length);
    const extras = d.edges.filter(e => e.extra);
    ok(extras.length === 1 && extras[0].id === 'e_ab2' && !!extras[0].extraMotivo,
        'QA2 doppio: il SECONDO A->B risulta extra CON extraMotivo',
        JSON.stringify(extras.map(e => ({ id: e.id, extra: !!e.extra, motivo: e.extraMotivo }))));
    ok(!d.edges.filter(e => e.id === 'e_ab1')[0].extra, 'QA2 doppio: il PRIMO resta valido');

    // rendering: 1 pieno + 1 tratteggiato, MAI due pieni
    const gs = edgeGroups(env);
    const extraGs = gs.filter(g => g.classList.contains('sc-edge-extra'));
    const fullGs = gs.filter(g => !g.classList.contains('sc-edge-extra'));
    ok(gs.length === 2 && extraGs.length === 1 && fullGs.length === 1,
        'QA2 doppio: DOM 2 archi = 1 extra + 1 pieno (mai 2 pieni)',
        'dom=' + gs.length + ' extra=' + extraGs.length + ' full=' + fullGs.length);
    const pExtra = extraGs[0] ? edgePath(env, extraGs[0]) : null;
    const pFull = fullGs[0] ? edgePath(env, fullGs[0]) : null;
    ok(!!pExtra && pExtra.hasAttribute('stroke-dasharray'), 'QA2 doppio: extra tratteggiato in DOM',
        pExtra ? 'attr=' + pExtra.getAttribute('stroke-dasharray') : 'path assente');
    ok(!!pFull && !pFull.hasAttribute('stroke-dasharray'), 'QA2 doppio: arco pieno NON tratteggiato');
    const da = dashAudit(env);
    ok(da.bad === 0, 'QA2 doppio: dash solo su .sc-edge-extra', 'dash=' + da.total + ' bad=' + da.bad);
    const ids = gs.map(g => g.getAttribute('data-eid')).sort().join(',');
    ok(ids === 'e_ab1,e_ab2', 'QA2 doppio: data-eid preservati', ids);
    ok(env.confirmCalls.length === 0, 'QA2 doppio: NESSUNA conferma al cambio (solo marcatura extra)',
        env.confirmCalls.length + ' call');

    // conferma=TRUE sul cambio successivo: il doppio extra viene rimosso
    recordConfirm(env, true);
    await go(env, 'mappa');
    const d2 = docOf(env, id);
    ok(d2.edges.length === 2 && d2.edges.filter(e => e.extra).length === 1 && d2.edges[0].id === 'e_ab1',
        'QA2 doppio: NESSUNA rimozione anche con confirm=OK (doppio extra preservato)',
        'edges=' + d2.edges.length + ' ids=' + d2.edges.map(e => e.id).join(','));
    ok(edgeGroups(env).length === 2, 'QA2 doppio: DOM=2 (1 pieno + 1 extra preservato)', 'dom=' + edgeGroups(env).length);
    ok(env.confirmCalls.length === 0, 'QA2 doppio: zero conferme anche col doppio extra', env.confirmCalls.length + '');
}

// ===============================================================
// 3) Reciproco A->B + B->A = due archi distinti
// ===============================================================
async function reciprocalCheck() {
    console.log('\n== QA2 — reciproco A->B + B->A ==');
    const env = makeEnv();
    recordConfirm(env, false);
    const nodes = [mkNode('a', 120, 90, 'A'), mkNode('b', 500, 300, 'B')];
    const edges = [
        { id: 'e_ab', from: 'a', to: 'b', label: '', color: '#8ca4ff' },
        { id: 'e_ba', from: 'b', to: 'a', label: '', color: '#8ca4ff' }
    ];
    const id = await openSchema(env, baseDoc('libero', nodes, edges), 'QA2 Reciproco');

    // libero: entrambi validi e distinti
    let gs = edgeGroups(env);
    let ids = gs.map(g => g.getAttribute('data-eid')).sort().join(',');
    ok(gs.length === 2 && ids === 'e_ab,e_ba', 'QA2 reciproco: in libero entrambi presenti come archi distinti',
        'dom=' + gs.length + ' ids=' + ids);
    ok(gs.every(g => !g.classList.contains('sc-edge-extra')), 'QA2 reciproco: nessun extra in libero');

    // libero -> mappa: sempre entrambi validi (la mappa ammette i cicli)
    await go(env, 'mappa');
    let d = docOf(env, id);
    gs = edgeGroups(env);
    ids = gs.map(g => g.getAttribute('data-eid')).sort().join(',');
    ok(d.edges.length === 2 && gs.length === 2 && ids === 'e_ab,e_ba',
        'QA2 reciproco: mappa conserva entrambi gli archi distinti',
        'doc=' + d.edges.length + ' dom=' + gs.length + ' ids=' + ids);
    ok(env.confirmCalls.length === 0, 'QA2 reciproco: nessuna conferma in libero->mappa', env.confirmCalls.length + '');
    ok(gs.every(g => !g.classList.contains('sc-edge-extra')), 'QA2 reciproco: nessun extra in mappa');

    // mappa -> albero: il reciproco (ciclo) diventa extra, entrambi restano nel doc
    await go(env, 'albero');
    d = docOf(env, id);
    const extras = d.edges.filter(e => e.extra);
    gs = edgeGroups(env);
    ok(d.edges.length === 2 && extras.length === 1 && extras[0].id === 'e_ba' && !!extras[0].extraMotivo,
        'QA2 reciproco: in albero il reciproco B->A è extra (con motivo), nessuno perso',
        JSON.stringify(extras.map(e => ({ id: e.id, motivo: e.extraMotivo }))));
    ok(gs.length === 2 && gs.filter(g => g.classList.contains('sc-edge-extra')).length === 1,
        'QA2 reciproco: DOM 2 archi distinti (1 pieno + 1 extra)', 'dom=' + gs.length);
    ids = gs.map(g => g.getAttribute('data-eid')).sort().join(',');
    ok(ids === 'e_ab,e_ba', 'QA2 reciproco: data-eid preservati in albero', ids);
}

// ===============================================================
// 4) Hub deterministico: nodo selezionato al centro in mappa
// ===============================================================
async function hubCheck() {
    console.log('\n== QA2 — hub deterministico (nodo selezionato) ==');
    const env = makeEnv();
    recordConfirm(env, false);
    const nodes = [
        mkNode('a', 120, 90, 'A'), mkNode('b', 430, 90, 'B'), mkNode('c', 740, 90, 'C'),
        mkNode('d', 260, 330, 'D'), mkNode('e', 600, 330, 'E')
    ];
    const edges = [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('a', 'd'), mkEdge('d', 'e')];
    const id = await openSchema(env, baseDoc('albero', nodes, edges), 'QA2 Hub');

    // seleziona D PRIMA del cambio a mappa: la selezione deve essere ATTIVA
    // (handle .sc-handle montato => ed.sel={t:'node',id:'d'} =>
    //  changeType imposta s.hubId='d' — schemi.js:1162)
    selectNode(env, 'd');
    await sleep(80);
    const selHandle = !!(nodeGroup(env, 'd') && nodeGroup(env, 'd').querySelector('.sc-handle'));
    ok(selHandle, 'QA2 hub: nodo d selezionato PRIMA del cambio (handle presente => ed.sel attivo)');
    await go(env, 'mappa');
    await sleep(200); // animazione 200ms già attesa in go(); margine extra

    const ids = ['a', 'b', 'c', 'd', 'e'];
    const centers = {};
    let missing = 0;
    ids.forEach(nid => {
        const r = nodeRect(env, nid);
        if (!r) { missing++; return; }
        centers[nid] = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    });
    ok(missing === 0 && !!centers.d, 'QA2 hub: tutti i nodi renderizzati dopo X->mappa', 'missing=' + missing);
    if (missing) return;

    // Metrica "al centro degli altri": in layout radiale con hub H,
    // H minimizza la distanza MEDIA agli altri nodi (anello centrato su H).
    const meanDist = {};
    ids.forEach(x => {
        const othersX = ids.filter(y => y !== x);
        meanDist[x] = othersX.reduce((s, y) =>
            s + Math.hypot(centers[x].x - centers[y].x, centers[x].y - centers[y].y), 0) / othersX.length;
    });
    console.log('    [hub] centri: ' + ids.map(n => n + '=(' + Math.round(centers[n].x) + ',' + Math.round(centers[n].y) + ')').join(' '));
    console.log('    [hub] distanza media agli altri: ' + ids.map(n => n + '=' + Math.round(meanDist[n])).join(' '));
    const minMean = ids.reduce((best, n) => meanDist[n] < meanDist[best] ? n : best, ids[0]);
    ok(minMean === 'd', 'QA2 hub: d selezionato è al centro degli altri (distanza media minima)',
        'minMean=' + minMean + ' (' + ids.map(n => n + '=' + Math.round(meanDist[n])).join(' ') + ')');
}

// ===============================================================
async function main() {
    try {
        const probe = makeEnv();
        const TYPES = Object.keys(probe.win.SchemaStrategies.SCHEMA_STRATEGIES);
        console.log('== QA2 — tipi: ' + TYPES.join(', ') + ' (n=' + TYPES.length + ') ==');
        console.log('\n== QA2 — coppie X->mappa e mappa->X ==');
        for (let i = 0; i < TYPES.length; i++) {
            if (TYPES[i] !== 'mappa') await pairCheck(TYPES[i], 'mappa');
        }
        for (let i = 0; i < TYPES.length; i++) {
            if (TYPES[i] !== 'mappa') await pairCheck('mappa', TYPES[i]);
        }
        await doubleEdgeCheck();
        await reciprocalCheck();
        await hubCheck();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI QA2: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}

main();
