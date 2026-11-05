/* ============================================================
   tests/qaB_schemi.js - T1 round B (IMPLEMENTER-SCHEMI)
   Copre minimo:
   (a) ordine DOM layer: guide -> sc-nodes (fill) -> sc-edges -> sc-draw ->
       sc-overlay; count g.sc-node[data-nid] invariato; overlay in class
       sc-label SENZA data-nid; querySelector('[data-nid]') = gruppo fill
   (b) 4 tab SEMPRE presenti in tutti i tipi + auto-apertura su riassunto +
       hint "Seleziona un nodo" senza selezione + editor titolo/corpo con
       selezione (n.text = titolo + '\n' + corpo)
   (c) undo/redo: + Nodo -> 1 Ctrl+Z lo rimuove; Ctrl+Y/redo lo rifà;
       cambio tipo -> 1 passo anche col bottone \u21B6/\u21B7 (fuori .sc-btnwrap)
   (d) bottone "Mano" assente (title e label), "Matita" presente;
       spacePan: keydown SPAZIO = preventDefault + cursor grab, keyup reset
   (e) drag nodo: snapshot pre->post = 1 solo passo di undo
   (f) autoLayout da pulsante = 1 passo; changeType = 1 passo (no doppio push,
       2° Ctrl+Z = no-op)

   Verifica INDIPENDENTE (jsdom). Harness copiato dal pattern
   tests/qa4_matrix.js. Prodotto in LETTURA.
   Eseguire con: node tests/qaB_schemi.js
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
// Ambiente DOM + stub (pattern qa4_matrix/implBlock12)
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
function ptr(env, target, type, x, y) {
    target.dispatchEvent(new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}
function key(env, opts) {
    const ev = new env.win.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, opts));
    env.win.dispatchEvent(ev);
    return ev;
}
function ctrlZ(env) { key(env, { key: 'z', ctrlKey: true }); }
function ctrlY(env) { key(env, { key: 'y', ctrlKey: true }); }
function nodeGroup(env, nid) { return env.doc.querySelector('[data-nid="' + nid + '"]'); }
function nodeCount(env) { return $$(env, 'g.sc-node[data-nid]').length; }
function nodeIds(env) { return $$(env, 'g.sc-node[data-nid]').map(g => g.getAttribute('data-nid')); }
function edgeCount(env) { return $$(env, '.sc-edges .sc-edge').length; }
function nodeRect(env, nid) {
    const g = env.doc.querySelector('g.sc-node[data-nid="' + nid + '"]');
    if (!g) return null;
    const r = g.querySelector('rect');
    if (!r) return null;
    return { x: r.getAttribute('x'), y: r.getAttribute('y') };
}
function posMap(env) {
    const m = {};
    $$(env, 'g.sc-node[data-nid]').forEach(g => {
        const r = g.querySelector('rect');
        if (r) m[g.getAttribute('data-nid')] = r.getAttribute('x') + ',' + r.getAttribute('y');
    });
    return m;
}
function samePos(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => a[k] === b[k]);
}
function stratButtons(env) { return Array.from(env.doc.querySelectorAll('.sc-btnwrap button')); }
function stratButton(env, label) {
    return stratButtons(env).filter(b => b.textContent.trim() === label)[0] || null;
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function testoTab(env) {
    return $$(env, '.sc-tab').filter(b => b.textContent.trim() === 'Testo')[0] || null;
}
function selectNode(env, nid) {
    ptr(env, nodeGroup(env, nid), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
}
function findBodyT(env) {
    return $$(env, '.sc-side .sc-body').filter(b => b.querySelector('input[type="text"]'))[0] || null;
}
function btnByTitle(env, re) {
    return $$(env, 'button').filter(b => re.test(b.title || ''))[0] || null;
}
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
const mkE = (f, t) => ({ id: 'e' + f + t, from: f, to: t, label: '', color: '#8ca4ff' });
const TYPES = ['albero', 'lr', 'libero', 'mappa', 'riassunto'];

// ===============================================================
// (a) ORDINE DOM DEI LAYER
// ===============================================================
async function layerCheck() {
    console.log('== QA-B (a): ordine DOM layer + overlay ==');
    const env = makeEnv();
    await openSchema(env, mBase('albero',
        [mkN('a', 300, 300), mkN('b', 650, 300)], [mkE('a', 'b')]), 'QA-B-layer');

    const w = $(env, '.sc-world');
    const order = Array.from(w.children).map(c => c.getAttribute('class'));
    ok(JSON.stringify(order) === JSON.stringify(['sc-guide', 'sc-nodes', 'sc-edges', 'sc-draw', 'sc-overlay']),
        'layer: ordine guide -> sc-nodes -> sc-edges -> sc-draw -> sc-overlay',
        JSON.stringify(order));
    const idx = c => order.indexOf(c);
    ok(idx('sc-guide') === 0, 'layer: sc-guide PRIMO (sotto tutto)');
    ok(idx('sc-nodes') < idx('sc-edges'), 'layer: fill nodi PRIMA degli archi (archi painted sopra)');
    ok(idx('sc-edges') < idx('sc-overlay'), 'layer: overlay DOPO sc-edges (painted sopra gli archi)');

    ok(nodeCount(env) === 2, 'count g.sc-node[data-nid] invariato (= nodi renderizzati)',
        'n=' + nodeCount(env));
    const first = env.doc.querySelector('[data-nid="a"]');
    ok(!!first && first.classList.contains('sc-node') && first.closest('.sc-nodes') !== null,
        'querySelector([data-nid]) -> PRIMO il gruppo fill (.sc-nodes), non l\'overlay',
        first ? first.getAttribute('class') : 'assente');

    const labels = $$(env, '.sc-overlay .sc-label');
    ok(labels.length === 2, 'overlay: 1 .sc-label per nodo renderizzato', 'n=' + labels.length);
    ok($$(env, '.sc-overlay [data-nid]').length === 0,
        'overlay label SENZA data-nid (non altera i conteggi [data-nid])',
        'n=' + $$(env, '.sc-overlay [data-nid]').length);
    ok($$(env, '.sc-overlay .sc-node').length === 0,
        'overlay SENZA class sc-node (i test contano solo g.sc-node[data-nid])');
    ok(labels[0] && /A/.test(labels[0].textContent),
        'overlay: label copia il testo del nodo', labels[0] ? labels[0].textContent.slice(0, 20) : 'n/a');
    ok(labels.every(l => l.getAttribute('pointer-events') === 'none'),
        'overlay: pointer-events=none (i click cadono su fill/archi sottostanti)');

    // con selezione: handle resta dentro il gruppo .sc-node, l'overlay non aggiunge data-nid
    selectNode(env, 'a');
    await sleep(60);
    ok($$(env, '[data-nid]').length === 3,
        'selezione: [data-nid] = 2 fill + 1 handle (overlay resta senza data-nid)',
        'n=' + $$(env, '[data-nid]').length);
    ok(nodeGroup(env, 'a').querySelector('.sc-handle') !== null,
        'selezione: handle .sc-handle dentro il gruppo .sc-node');
    ok(edgeCount(env) === 1, 'arco sempre renderizzato in .sc-edges', 'e=' + edgeCount(env));
}

// ===============================================================
// (b) 4 TAB SEMPRE PRESENTI + HINT + EDITORE TITOLO/CORPO
// ===============================================================
async function tabsCheck() {
    console.log('== QA-B (b): 4 tab sempre presenti + hint + editor titolo/corpo ==');
    for (const t of TYPES) {
        const env = makeEnv();
        await openSchema(env, mBase(t, [mkN('a', 300, 300)], []), 'QA-B-tabs-' + t);
        const tabs = $$(env, '.sc-side .sc-tab');
        ok(tabs.length === 4, t + ': esattamente 4 tab', 'n=' + tabs.length);
        const labels = tabs.map(x => x.textContent.trim()).join(',');
        ok(labels === 'Riassunto,Fonti,Stile,Testo', t + ': tab [Riassunto,Fonti,Stile,Testo]', labels);
        ok(tabs.every(x => x.style.display !== 'none'), t + ': tutti i tab visibili (nessun gate)');
        if (t === 'riassunto') {
            const act = $$(env, '.sc-side .sc-tab.active')[0];
            ok(!!act && act.textContent.trim() === 'Testo', t + ': auto-apertura tab Testo all\'apertura',
                act ? act.textContent : 'nessuno');
        }
        // apre il tab Testo e verifica l'hint SENZA selezione
        click(env, testoTab(env));
        await sleep(60);
        const bt = findBodyT(env);
        ok(!!bt, t + ': corpo pannello Testo montato');
        if (bt) {
            const note = bt.querySelector('.sc-note');
            const ta = bt.querySelector('textarea');
            const inp = bt.querySelector('input[type="text"]');
            ok(!!note && note.textContent.indexOf('Seleziona un nodo') >= 0,
                t + ': senza selezione hint "Seleziona un nodo" VISIBILE',
                note ? note.textContent.slice(0, 60) : 'nessuna nota');
            ok(!!ta && !!inp, t + ': editor con input Titolo + textarea Corpo');
            ok(!!ta && ta.disabled === true, t + ': senza selezione editor in attesa (disabled)');
            // con selezione -> editor attivo e sincronizzato
            selectNode(env, 'a');
            await sleep(80);
            ok(!!ta && ta.disabled === false && !!inp && inp.disabled === false,
                t + ': con selezione editor abilitato');
            ok(!!inp && inp.value === 'A', t + ': input Titolo = prima riga di n.text',
                inp ? inp.value : 'n/a');
            ok(!!ta && ta.value === 'A', t + ': textarea = testo completo', ta ? ta.value : 'n/a');
            // edit dal Titolo -> n.text = titolo (+ corpo)
            if (inp && ta) {
                inp.value = 'Titolo B';
                inp.dispatchEvent(new env.win.Event('input', { bubbles: true }));
                await sleep(80);
                const g = nodeGroup(env, 'a');
                ok(!!g && /Titolo B/.test(g.textContent), t + ': edit Titolo aggiorna il nodo in DOM',
                    g ? g.textContent.slice(0, 30) : 'n/a');
                // ora il corpo (prima riga resta il titolo)
                ta.value = 'Titolo B\nriga corpo 1';
                ta.dispatchEvent(new env.win.Event('input', { bubbles: true }));
                await sleep(80);
                ok(inp.value === 'Titolo B', t + ': textarea sincronizza l\'input Titolo', inp.value);
                await saveNow(env);
                const idIt = env.store.items.filter(x => x.title === 'QA-B-tabs-' + t)[0];
                const d = JSON.parse(idIt.content);
                ok(d.nodes[0].text === 'Titolo B\nriga corpo 1',
                    t + ': n.text = titolo + "\\n" + corpo salvato', JSON.stringify(d.nodes[0].text));
            }
        }
    }

    // nessun redirect del tab: da riassunto (tab Testo attivo) cambio tipo -> resta su Testo
    {
        const env = makeEnv();
        await openSchema(env, mBase('riassunto', [mkN('a', 300, 300)], []), 'QA-B-noredirect');
        const act0 = $$(env, '.sc-side .sc-tab.active')[0];
        ok(!!act0 && act0.textContent.trim() === 'Testo', 'pre: riassunto apre su Testo');
        await changeType(env, 'albero');
        const act1 = $$(env, '.sc-side .sc-tab.active')[0];
        ok(!!act1 && act1.textContent.trim() === 'Testo',
            'cambio tipo a albero: NESSUN redirect (l\'utente resta sul tab Testo)',
            act1 ? act1.textContent : 'nessuno');
        const tabT = testoTab(env);
        ok(!!tabT && tabT.style.display !== 'none', 'tab Testo ancora visibile dopo il cambio tipo');
    }
}

// ===============================================================
// (c) UNDO/REDO: + Nodo, Ctrl+Y, bottoni \u21B6/\u21B7
// ===============================================================
async function undoRedoCheck() {
    console.log('== QA-B (c): undo/redo (Ctrl+Z / Ctrl+Y / bottoni) ==');

    // + Nodo -> 1 Ctrl+Z lo rimuove, Ctrl+Y lo rifà
    {
        const env = makeEnv();
        await openSchema(env, mBase('albero', [mkN('a', 300, 300)], []), 'QA-B-addundo');
        click(env, stratButton(env, '+ Nodo'));
        await sleep(160);
        ok(nodeCount(env) === 2, 'setup: + Nodo -> 2 nodi', 'n=' + nodeCount(env));
        ctrlZ(env);
        await sleep(120);
        ok(nodeCount(env) === 1 && nodeIds(env).indexOf('a') >= 0,
            'undo: 1 Ctrl+Z rimuove il nodo aggiunto', 'n=' + nodeCount(env));
        ctrlY(env);
        await sleep(120);
        ok(nodeCount(env) === 2, 'redo: Ctrl+Y rifà l\'aggiunta', 'n=' + nodeCount(env));
        ctrlZ(env);
        await sleep(120);
        ok(nodeCount(env) === 1, 'undo di nuovo: 1 passo anche dopo il redo', 'n=' + nodeCount(env));
    }

    // bottoni \u21B6/\u21B7: fuori da .sc-btnwrap, cambio tipo = 1 click = 1 passo
    {
        const env = makeEnv();
        await openSchema(env, mBase('albero', [mkN('a', 300, 300)], []), 'QA-B-btns');
        const bU = btnByTitle(env, /Annulla \(Ctrl\+Z\)/);
        const bR = btnByTitle(env, /Ripristina \(Ctrl\+Y\)/);
        ok(!!bU && !!bR, 'bottoni undo/redo presenti', 'bU=' + !!bU + ' bR=' + !!bR);
        if (bU && bR) {
            ok(!bU.closest('.sc-btnwrap') && !bR.closest('.sc-btnwrap'),
                'bottoni undo/redo FUORI da .sc-btnwrap (matrice intatta)');
            ok(stratButtons(env).filter(b => /Annulla|Ripristina/.test(b.textContent)).length === 0,
                'nessun Annulla/Ripristina dentro .sc-btnwrap');
            ok(bU.disabled === true && bR.disabled === true,
                'bottoni disabilitati con stack vuoti (updateChrome)');
            const pos0 = posMap(env);
            await changeType(env, 'lr');
            ok(selType(env).value === 'lr', 'setup: cambio tipo a lr');
            ok(bU.disabled === false, 'bottone \u21B6 attivo dopo un azione');
            ok(bR.disabled === true, 'bottone \u21B7 ancora disabilitato (redo non disponibile)');
            click(env, bU);
            await sleep(160);
            ok(selType(env).value === 'albero',
                'bottone \u21B6: 1 click = 1 passo (tipo ripristinato a albero)',
                selType(env).value);
            ok(samePos(pos0, posMap(env)),
                'bottone \u21B6: posizioni ripristinate nello stesso passo',
                JSON.stringify(posMap(env)));
            ok(bR.disabled === false, 'bottone \u21B7 attivo dopo l\'undo');
            click(env, bR);
            await sleep(160);
            ok(selType(env).value === 'lr', 'bottone \u21B7: redo in 1 click', selType(env).value);
        }
    }
}

// ===============================================================
// (d) TOOL MANO ELIMINATO + spacePan in onKey
// ===============================================================
async function manoCheck() {
    console.log('== QA-B (d): tool Mano eliminato + spacePan ==');
    const env = makeEnv();
    await openSchema(env, mBase('albero', [mkN('a', 300, 300)], []), 'QA-B-mano');
    const all = $$(env, 'button');
    ok(!all.some(b => /Mano/.test(b.title || '')), 'nessun bottone con title contenente "Mano"');
    ok(!all.some(b => b.textContent.trim() === 'Mano'), 'nessun bottone con label "Mano"');
    ok(all.some(b => b.textContent.trim() === 'Matita'), 'bottone "Matita" presente (disegno preservato)');
    const bMat = all.filter(b => b.textContent.trim() === 'Matita')[0];
    ok(!!bMat && /matita/i.test(bMat.title || ''), 'Matita con title coerente',
        bMat ? bMat.title : 'n/a');
    // sorgente: nessun residuo del title Mano, Matita collegato a toggleTool('draw')
    ok(SRC_SCHEMI.indexOf("'Disegna a mano libera sullo schema'") < 0,
        'sorgente: title "Disegna a mano libera..." eliminato');
    ok(/btn\('tool-btn', 'Matita'/.test(SRC_SCHEMI) && /toggleTool\(ed && ed\.tool === 'draw' \? 'normal' : 'draw'\)/.test(SRC_SCHEMI),
        'sorgente: Matita -> toggleTool draw (disegno non reso inaccessibile)');
    ok(SRC_SCHEMI.indexOf('function onKeyUp(') >= 0 &&
        /window\.addEventListener\('keyup', onKeyUp\)/.test(SRC_SCHEMI) &&
        /window\.removeEventListener\('keyup', onKeyUp\)/.test(SRC_SCHEMI),
        'sorgente: listener keyup onKeyUp aggiunto E rimosso in teardown');
    ok(/e\.key === ' ' \|\| e\.code === 'Space'/.test(SRC_SCHEMI) &&
        /spacePan/.test(SRC_SCHEMI),
        'sorgente: onKey gestisce SPAZIO -> spacePan');

    // comportamento: keydown SPAZIO = preventDefault + cursor grab, keyup = reset
    const svg = env.doc.querySelector('.sc-stage svg');
    const kd = key(env, { key: ' ' });
    await sleep(30);
    ok(kd.defaultPrevented === true, 'SPAZIO keydown: preventDefault (nessun scroll/attivazione)');
    ok(svg.style.cursor === 'grab', 'SPAZIO keydown: cursor grab (spacePan attivo)', svg.style.cursor);
    const ku = new env.win.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    env.win.dispatchEvent(ku);
    await sleep(30);
    ok(svg.style.cursor === '', 'SPAZIO keyup: cursor ripristinato', JSON.stringify(svg.style.cursor));
    // Escape azzera comunque lo stato (coerente con Matita)
    key(env, { key: ' ' });
    await sleep(20);
    key(env, { key: 'Escape' });
    await sleep(20);
    ok(svg.style.cursor === '', 'Escape: esce dallo stato spacePan/tool', JSON.stringify(svg.style.cursor));
    // il salvataggio dei disegni non e' stato toccato
    ok(/ed\.doc\.drawings\.push\(dr\)/.test(SRC_SCHEMI) && /drawHtml/.test(SRC_SCHEMI),
        'sorgente: doc.drawings/drawHtml preservati (disegni salvati leggibili)');
}

// ===============================================================
// (e) DRAG: snapshot pre->post = 1 solo passo
// ===============================================================
async function dragCheck() {
    console.log('== QA-B (e): drag = 1 passo di undo ==');
    const env = makeEnv();
    await openSchema(env, mBase('albero',
        [mkN('a', 300, 300), mkN('b', 650, 500)], [mkE('a', 'b')]), 'QA-B-drag');
    const r0 = nodeRect(env, 'a');
    ok(!!r0, 'setup: rect nodo a', JSON.stringify(r0));
    const g = nodeGroup(env, 'a');
    ptr(env, g, 'pointerdown', 10, 10);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointermove', 130, 90);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 130, 90);
    await sleep(80);
    const r1 = nodeRect(env, 'a');
    ok(!!r1 && (r1.x !== r0.x || r1.y !== r0.y), 'drag: posizione cambiata',
        JSON.stringify({ r0: r0, r1: r1 }));
    ctrlZ(env);
    await sleep(120);
    const r2 = nodeRect(env, 'a');
    ok(!!r2 && r2.x === r0.x && r2.y === r0.y,
        'undo drag: 1 SOLO Ctrl+Z ripristina il pre-stato', JSON.stringify(r2));
    ctrlZ(env);
    await sleep(100);
    const r3 = nodeRect(env, 'a');
    ok(!!r3 && r3.x === r0.x && r3.y === r0.y && nodeCount(env) === 2 && edgeCount(env) === 1,
        '2° Ctrl+Z dopo il drag: no-op stabile',
        JSON.stringify(r3) + ' n=' + nodeCount(env) + ' e=' + edgeCount(env));
    // click fermo (senza movimento) NON deve aggiungere passi
    const before = nodeCount(env);
    ptr(env, nodeGroup(env, 'b'), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
    await sleep(60);
    ctrlZ(env);
    await sleep(100);
    ok(nodeCount(env) === before && nodeRect(env, 'b'),
        'click senza movimento: nessun passo di undo aggiunto', 'n=' + nodeCount(env));
}

// ===============================================================
// (f) autoLayout da pulsante = 1 passo; changeType = 1 passo (no doppio push)
// ===============================================================
async function layoutUndoCheck() {
    console.log('== QA-B (f): autoLayout/changeType = 1 passo ==');

    // autoLayout da pulsante
    {
        const env = makeEnv();
        await openSchema(env, mBase('albero',
            [mkN('a', 300, 300), mkN('b', 650, 250)], [mkE('a', 'b')]), 'QA-B-layout');
        const before = posMap(env);
        click(env, stratButton(env, 'Auto-layout'));
        await sleep(600);
        const mid = posMap(env);
        ok(!samePos(before, mid), 'autoLayout: nodi ridisposti', JSON.stringify({ before: before, mid: mid }));
        ctrlZ(env);
        await sleep(150);
        const after = posMap(env);
        ok(samePos(before, after),
            'autoLayout: 1 SOLO Ctrl+Z ripristina il pre-stato (1 passo)',
            'diff=' + Object.keys(before).filter(k => before[k] !== after[k]).join(','));
        ctrlZ(env);
        await sleep(100);
        ok(samePos(before, posMap(env)), 'autoLayout: 2° Ctrl+Z = no-op');
    }

    // changeType: 1 passo (nessun doppio push da animateLayout) + redo
    {
        const env = makeEnv();
        await openSchema(env, mBase('albero',
            [mkN('a', 300, 300), mkN('b', 650, 500)], [mkE('a', 'b')]), 'QA-B-changetype');
        const before = posMap(env);
        await changeType(env, 'mappa');
        ok(selType(env).value === 'mappa', 'setup: cambio tipo a mappa');
        const mid = posMap(env);
        ctrlZ(env);
        await sleep(150);
        ok(selType(env).value === 'albero',
            'changeType: 1 SOLO Ctrl+Z ripristina il tipo (no doppio push)',
            selType(env).value);
        ok(samePos(before, posMap(env)),
            'changeType: posizioni ripristinate nello stesso passo',
            'diff=' + Object.keys(before).filter(k => before[k] !== posMap(env)[k]).join(','));
        ok(nodeCount(env) === 2 && edgeCount(env) === 1,
            'changeType undo: NESSUNA perdita nodi/archi',
            'n=' + nodeCount(env) + ' e=' + edgeCount(env));
        // 2° Ctrl+Z = no-op (stack vuoto dopo l'unico snapshot del changeType)
        ctrlZ(env);
        await sleep(100);
        ok(selType(env).value === 'albero' && nodeCount(env) === 2 && samePos(before, posMap(env)),
            'changeType: 2° Ctrl+Z = no-op stabile');
        // redo del cambio tipo
        ctrlY(env);
        await sleep(150);
        ok(selType(env).value === 'mappa' && samePos(mid, posMap(env)),
            'changeType: Ctrl+Y rifà il cambio tipo in 1 passo', selType(env).value);
    }
}

// ===============================================================
async function main() {
    try {
        await layerCheck();
        await tabsCheck();
        await undoRedoCheck();
        await manoCheck();
        await dragCheck();
        await layoutUndoCheck();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('\n================================================');
    console.log('RISULTATI qaB_schemi: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
