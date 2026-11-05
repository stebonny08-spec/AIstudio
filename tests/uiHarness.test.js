/* ============================================================
   tests/uiHarness.test.js — verifica UI (TASK 4) con jsdom.

   Carica i moduli REALI (schemaStrategies.js + schemi.js) in un
   DOM, con stub minimi di App/StudyStore/SubjectInput/Folders,
   e guida l'editor come farebbe l'utente: click pulsanti, drag,
   doppio click, cambio tipo.

   Eseguire con: node tests/uiHarness.test.js
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
// Ambiente DOM + stub
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
        deleteItem: async id => { store.items = store.items.filter(i => i.id !== id); },
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

    return { dom, win, doc, store, mod: win.App._mod, confirmResult: false };
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

// ---- helpers di interazione ----
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
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function edgePath(env, g) {
    const ps = g.querySelectorAll('path');
    return ps.length > 1 ? ps[1] : ps[0];
}
function guideLines(env) { return $$(env, '.sc-guide line'); }
function stratButtons(env) { return Array.from(env.doc.querySelectorAll('.sc-btnwrap button')); }
function stratButton(env, label) {
    return stratButtons(env).filter(b => b.textContent.trim() === label)[0] || null;
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function toastText(env) { const t = env.doc.querySelector('.sc-toast'); return t ? t.textContent : null; }

function connect(env, fromId, toId) {
    const cb = stratButton(env, 'Collega');
    click(env, cb);                                   // attiva modalità collega
    ptr(env, nodeGroup(env, fromId), 'pointerdown', 5, 5);
    ptr(env, nodeGroup(env, toId), 'pointerdown', 9, 9);
}
function selectNode(env, nid) {
    ptr(env, nodeGroup(env, nid), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
}
function dragNode(env, nid, dx, dy) {
    const g = nodeGroup(env, nid);
    ptr(env, g, 'pointerdown', 50, 50);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointermove', 50 + dx, 50 + dy);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 50 + dx, 50 + dy);
}
function clickAutoLayout(env) {
    const b = stratButton(env, 'Auto-layout');
    if (b) click(env, b);
    return b;
}
/* Forza il salvataggio immediato (il salvataggio automatico è debounced a 900ms) */
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

// ===============================================================
async function scenarioAlbero() {
    console.log('\n== TASK 4 — Albero ==');
    const env = makeEnv();
    // 6 nodi: a→b,a→c,b→d,b→e,c→f (posizioni iniziali "disordinate")
    const nodes = [mkNode('a', 700, 400, 'Radice'), mkNode('b', 100, 600), mkNode('c', 900, 100),
        mkNode('d', 400, 200), mkNode('e', 50, 50), mkNode('f', 800, 700)];
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('b', 'e'), mkEdge('c', 'f')];
    const id = await openSchema(env, baseDoc('albero', nodes, edges), 'Albero');

    ok(!!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello'), 'albero: pulsanti +Figlio/+Fratello visibili');
    ok(!!stratButton(env, 'Collega') && !!stratButton(env, 'Auto-layout'), 'albero: pulsanti Collega/Auto-layout');

    // auto-layout → gerarchia centrata
    clickAutoLayout(env);
    await sleep(500);
    const r = {}; ['a', 'b', 'c', 'd', 'e', 'f'].forEach(k => r[k] = nodeRect(env, k));
    ok(r.a.y < r.b.y && r.b.y < r.d.y && r.a.y < r.c.y && r.c.y < r.f.y, 'albero: layout gerarchico (righe crescenti)', JSON.stringify(Object.values(r).map(v => v && v.y)));
    const ca = r.a.x + r.a.w / 2, cb = r.b.x + r.b.w / 2, cc = r.c.x + r.c.w / 2;
    ok(Math.abs((cb + cc) / 2 - ca) < 40, 'albero: fratelli centrati sotto la radice', ((cb + cc) / 2) + ' vs ' + ca);
    const cd = r.d.x + r.d.w / 2, ce = r.e.x + r.e.w / 2;
    ok(Math.abs((cd + ce) / 2 - cb) < 40, 'albero: d,e centrati sotto b');

    // archi a gomito, senza etichetta
    const eg = edgeGroups(env);
    ok(eg.length === 5, 'albero: 5 archi renderizzati');
    const dAttr = edgePath(env, eg[0]).getAttribute('d') || '';
    const nL = (dAttr.match(/L/g) || []).length;
    ok(nL === 3, 'albero: arco a gomito (3 segmenti L)', dAttr);
    ok(!env.doc.querySelector('.sc-elabel'), 'albero: nessuna etichetta sugli archi');

    // secondo padre → toast + arco non nasce
    connect(env, 'a', 'd');
    await sleep(30);
    const t = toastText(env);
    ok(!!t && /solo padre/.test(t), 'albero: toast al tentativo di secondo padre', t);
    ok(edgeGroups(env).length === 5, 'albero: arco rifiutato non nasce');
    // escape stato collegamento pulito (il rifiuto disattiva già la modalità)

    // ciclo vietato (d → a): d ha già padre → prima il toast del padre; proviamo d→a dopo?
    // d ha padre b → motivo padre. Un ciclo senza doppio padre: radice a già padre? proviamo f→c: c ha padre a → padre.
    // ciclo puro: usiamo un nodo senza padre → crea nodo sorgente scollegata x, poi x→a ok, poi a→x: x ha padre → rifiutato.
    // Verifichiamo il motivo ciclo su un caso dove il target è antenato e senza incoming impossibile in albero:
    // ok: il secondo controllo (ciclo) e' coperto dai test di unita'; qui verifichiamo il blocco del secondo padre.

    // + Fratello su radice → toast
    selectNode(env, 'a');
    const bSib = stratButton(env, '+ Fratello');
    ok(bSib && !bSib.disabled, 'albero: +Fratello attivo con nodo selezionato');
    // BLOCCO 1.2: senza genitore il + Fratello e' un FALLBACK "+ Nodo" (nessun toast)
    const tBefore = toastText(env);
    const nNodesB = $$(env, 'g.sc-node[data-nid]').length;
    const nEdgesB = edgeGroups(env).length;
    if (bSib) { click(env, bSib); await sleep(40); }
    const t2 = toastText(env);
    ok($$(env, 'g.sc-node[data-nid]').length === nNodesB + 1 && edgeGroups(env).length === nEdgesB &&
        t2 === tBefore, 'albero: +Fratello senza genitore = fallback +Nodo (nessun toast)',
        'nodes=' + $$(env, 'g.sc-node[data-nid]').length + ' edges=' + edgeGroups(env).length +
        ' toast=' + String(t2).slice(0, 60));

    // + Figlio funziona e posiziona sotto
    const before = edgeGroups(env).length;
    selectNode(env, 'a');
    click(env, stratButton(env, '+ Figlio'));
    await sleep(60);
    ok(edgeGroups(env).length === before + 1, 'albero: +Figlio crea il collegamento figlio');
    // snap durante drag: spostamento di 37px → allineato a griglia di 10
    const anyId = 'a';
    const p0 = nodeRect(env, anyId);
    dragNode(env, anyId, 37, 0);
    const p1 = nodeRect(env, anyId);
    ok(p1 && Math.abs(p1.x - p0.x) >= 30 && p1.x % 10 === 0, 'albero: snap attivo durante il drag', 'dx=' + (p1 ? p1.x - p0.x : '?') + ' x=' + (p1 && p1.x));
    return env;
}

// ===============================================================
async function scenarioMappa() {
    console.log('\n== TASK 4 — Mappa concettuale ==');
    const env = makeEnv();
    const nodes = [mkNode('a', 300, 300, 'Concetto A'), mkNode('b', 650, 250, 'B'), mkNode('c', 500, 550, 'C'), mkNode('d', 150, 550, 'D')];
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'b')]; // ridondante: uno sarà marcato extra? no: duplicate check solo in canConnect, qui forzati
    const edgesOk = [mkEdge('a', 'b')];
    const id = await openSchema(env, baseDoc('mappa', nodes, edgesOk), 'Mappa');

    ok(!!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello') && !stratButton(env, '+ Nodo'),
        'mappa: matrice aggiunta (+Figlio/+Fratello, niente +Nodo)');
    const eg = edgeGroups(env);
    ok(eg.length === 1, 'mappa: 1 arco');
    const d1 = edgePath(env, eg[0]).getAttribute('d') || '';
    ok(d1.indexOf('Q') >= 0, 'mappa: arco curvo (quadratica)', d1);

    // ciclo permesso: b→c e poi c→a (a→b esiste già → c→a chiude il ciclo)
    connect(env, 'b', 'c');
    await sleep(30);
    ok(edgeGroups(env).length === 2, 'mappa: b→c creato');
    connect(env, 'c', 'a');
    await sleep(30);
    const t = toastText(env);
    const nEdges = edgeGroups(env).length;
    ok(nEdges === 3, 'mappa: ciclo c→a PERMESSO (arco nato)', 'toast=' + t + ' edges=' + nEdges);

    // etichetta editabile con doppio click
    const eg2 = edgeGroups(env)[0];
    eg2.querySelector('path[data-eid], path').dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true }));
    await sleep(120);
    let modalInput = env.doc.querySelector('.modal-overlay .modal input');
    ok(!!modalInput, 'mappa: doppio click su arco apre il campo etichetta');
    if (modalInput) {
        modalInput.value = 'parola-ponte';
        const okBtn = env.doc.querySelector('.modal-overlay .btn-accent');
        click(env, okBtn);
        await sleep(150);
        const lbl = env.doc.querySelector('.sc-elabel');
        ok(!!lbl && /parola-ponte/.test(lbl.textContent), 'mappa: etichetta salvata e renderizzata', lbl && lbl.textContent);
    }

    // auto-layout radiale
    const posBefore = {}; ['a', 'b', 'c', 'd'].forEach(k => posBefore[k] = nodeRect(env, k));
    clickAutoLayout(env);
    await sleep(550);
    const posAfter = {}; ['a', 'b', 'c', 'd'].forEach(k => posAfter[k] = nodeRect(env, k));
    const moved = ['a', 'b', 'c', 'd'].some(k => Math.abs(posAfter[k].x - posBefore[k].x) > 60 || Math.abs(posAfter[k].y - posBefore[k].y) > 60);
    ok(moved, 'mappa: auto-layout force/radiale ha ridisposto i nodi');
    // hub (grado massimo = a) al centro degli altri
    const ac = { x: posAfter.a.x + posAfter.a.w / 2, y: posAfter.a.y + posAfter.a.h / 2 };
    const dists = ['b', 'c', 'd'].map(k => Math.hypot(posAfter[k].x + posAfter[k].w / 2 - ac.x, posAfter[k].y + posAfter[k].h / 2 - ac.y));
    ok(Math.min.apply(null, dists) > 70, 'mappa: hub al centro, nodi attorno', dists.map(d => d.toFixed(0)).join(','));

    // posizionamento manuale preservato all'apertura (nessun layout forzato all'apertura)
    ok(Math.abs(posBefore.d.x - 150) < 2 && Math.abs(posBefore.d.y - 550) < 2, 'mappa: posizioni manuali preservate all’apertura');
    return env;
}

// ===============================================================
async function scenarioLR() {
    console.log('\n== TASK 4 — Sinistra→destra ==');
    const env = makeEnv();
    const nodes = [mkNode('a', 300, 300), mkNode('b', 100, 100), mkNode('c', 500, 500), mkNode('d', 700, 100), mkNode('e', 200, 600), mkNode('f', 900, 400)];
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('c', 'e'), mkEdge('d', 'f')];
    const id = await openSchema(env, baseDoc('lr', nodes, edges), 'LR');

    clickAutoLayout(env);
    await sleep(500);
    const r = {}; ['a', 'b', 'c', 'd', 'e', 'f'].forEach(k => r[k] = nodeRect(env, k));
    ok(r.a.x < r.b.x && r.b.x < r.d.x && r.d.x < r.f.x, 'lr: colonne crescenti (a→b→d→f)', [r.a.x, r.b.x, r.d.x, r.f.x].join(','));
    ok(r.b.x === r.c.x, 'lr: b,c impilati nella stessa colonna', r.b.x + '/' + r.c.x);
    ok(r.b.y !== r.c.y, 'lr: nodi della colonna impilati in y');

    // frecce con punta e verso destra
    const polys = $$(env, '.sc-edges polygon');
    ok(polys.length === 5, 'lr:5 frecce (archi con punta)');
    let angOk = false;
    if (polys.length) {
        const m = /rotate\(([-0-9.]+)\)/.exec(polys[0].getAttribute('transform') || '');
        if (m) {
            // BLOCCO 2.3: con lo stack VERTICALE CENTRATO nel layer l'arco a->b puo'
            // essere inclinato, ma resta orientato in avanti (verso dx): |angolo| < 90.
            let ang = (+m[1]) % 360;
            if (ang < 0) ang += 360;
            angOk = ang < 90 || ang > 270;
        }
    }
    ok(angOk, 'lr: frecce orientate in avanti (verso dx, stack di colonna centrato)');

    // guide colonne visibili e verticali
    const guides = guideLines(env);
    ok(guides.length >= 2, 'lr: guide colonne visibili', 'n=' + guides.length);
    const vert = guides.every(g => Math.abs(+g.getAttribute('y1') - +g.getAttribute('y2')) > 10 &&
        Math.abs(+g.getAttribute('x1') - +g.getAttribute('x2')) < 1);
    ok(vert, 'lr: guide verticali');
    // B1: guide continue (niente tratteggio) e estese a tutto il mondo SVG
    const lrNoDash = guides.every(g => !g.hasAttribute('stroke-dasharray'));
    ok(lrNoDash, 'B1 lr: guide SENZA stroke-dasharray (linee continue)');
    const lrWide = guides.every(g =>
        Math.max(Math.abs(+g.getAttribute('y1')), Math.abs(+g.getAttribute('y2'))) >= 10000);
    ok(lrWide, 'B1 lr: guide estese a tutto canvas (>=10000px nel mondo)');

    // niente etichette editabili: doppio click su arco non apre modale
    const eg = edgeGroups(env)[0];
    eg.querySelector('path').dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true }));
    await sleep(120);
    ok(!env.doc.querySelector('.modal-overlay'), 'lr: doppio click su arco NON apre l’etichetta');
    return env;
}

// ===============================================================
async function scenarioLegacyTb() {
    console.log('\n== BLOCCO 3.3 - schema legacy "Alto -> basso" (tb) migrato ad albero ==');
    const env = makeEnv();
    // Fixture legacy TB con posizioni INIZIALI SCAMBIATE: la radice "a" parte in basso
    // (y=600) mentre i figli stanno in alto -> se l'auto-layout al primo caricamento
    // non gira, la gerarchia non puo' tenere.
    const nodes = [mkNode('a', 700, 600, 'Radice'), mkNode('b', 100, 100), mkNode('c', 900, 150),
        mkNode('d', 400, 50), mkNode('e', 50, 300), mkNode('f', 800, 450)];
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('b', 'e'), mkEdge('c', 'f')];
    const id = await openSchema(env, baseDoc('tb', nodes, edges), 'TB legacy');
    // attesa >= 550ms: timer auto-layout 60ms + animazione tidy tree ~200ms
    await sleep(550);

    // 1) si e' APERTO come albero (type migrato nel selettore Tipo)
    ok(selType(env).value === 'albero', '3.3 legacy tb si apre come albero (selettore tipo)', selType(env).value);

    // 2) auto-layout al primo caricamento NONOSTANTE posizioni iniziali scambiate
    const r = {}; ['a', 'b', 'c', 'd', 'e', 'f'].forEach(k => r[k] = nodeRect(env, k));
    const ys = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => k + '=' + (r[k] ? r[k].y : 'null')).join(' ');
    ok(!!r.a && !!r.b && !!r.d && r.a.y < r.b.y && r.b.y < r.d.y,
        '3.3 auto-layout al primo caricamento: y(a)<y(b)<y(d)', ys);
    ok(!!r.a && !!r.c && !!r.f && r.a.y < r.c.y && r.c.y < r.f.y,
        '3.3 auto-layout al primo caricamento: y(a)<y(c)<y(f)', ys);
    ok(!!r.b && !!r.c && r.b.y === r.c.y, "3.3 fratelli stessa riga (tidy tree)", ys);
    ok(!!r.b && !!r.c && r.b.x !== r.c.x, "3.3 nodi della riga affiancati in x", ys);

    // 3) albero: guide = null -> nessuna riga guida nel DOM
    ok(guideLines(env).length === 0, '3.3 albero: nessuna guida riga (guide=null)', 'n=' + guideLines(env).length);

    // 4) toolbar del tipo albero montata
    ok(!!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello'),
        '3.3 toolbar albero: pulsanti +Figlio / +Fratello');

    // 5) NESSUNA PERDITA: 6 nodi e 5 archi preservati (DOM + doc salvato)
    ok(edgeGroups(env).length === 5, '3.3 nessuna perdita: DOM .sc-edge == 5', 'dom=' + edgeGroups(env).length);
    await saveNow(env);
    const d = docOf(env, id);
    ok(d.nodes.length === 6 && d.edges.length === 5,
        '3.3 nessuna perdita: doc nodi=6 / archi=5', d.nodes.length + '/' + d.edges.length);
    ok(d.type === 'albero', '3.3 salvataggio: type === albero', d.type);
    return env;
}
// ===============================================================
async function scenarioLibero() {
    console.log('\n== TASK 4 — Schema libero ==');
    const env = makeEnv();
    const nodes = [mkNode('a', 100, 100, 'Libero'), mkNode('b', 480, 320, 'Altro')];
    const edges = [mkEdge('a', 'b')];
    await openSchema(env, baseDoc('libero', nodes, edges), 'Libero');

    const bLay = stratButton(env, 'Auto-layout');
    ok(!!bLay && bLay.disabled === true, 'libero: auto-layout disabilitato (pulsante grigio)');
    ok(!!bLay && /disabilitato/.test(bLay.title || ''), 'libero: tooltip sul pulsante disabilitato', bLay && bLay.title);
    ok(guideLines(env).length === 0, 'libero: nessuna guida');

    // nessun vincolo: ciclo e secondo padre consentiti
    connect(env, 'b', 'a');
    await sleep(30);
    ok(edgeGroups(env).length === 2, 'libero: ciclo consentito (b→a)');
    // nessun vincolo topologico: trasferimento doppio padre

    // drag libero SENZA snap: +37 resta 37
    const p0 = nodeRect(env, 'a');
    dragNode(env, 'a', 37, 0);
    const p1 = nodeRect(env, 'a');
    ok(p1 && p1.x - p0.x === 37, 'libero: drag senza snap (dx esatto)', p1 && ('dx=' + (p1.x - p0.x)));

    // scelta forma arco: select presente e applicata
    const selArco = env.doc.querySelector('.sc-btnwrap select');
    ok(!!selArco, 'libero: select forma arco (scelta utente)');
    if (selArco) {
        selArco.value = 'curva';
        selArco.dispatchEvent(new env.win.Event('change', { bubbles: true }));
        await sleep(60);
        const d = edgePath(env, edgeGroups(env)[0]).getAttribute('d') || '';
        ok(d.indexOf('Q') >= 0, 'libero: arco diventa curvo dopo la scelta utente', d);
    }
    return env;
}

// ===============================================================
async function scenarioRiassunto() {
    console.log('\n== TASK 4 — Riassunto visuale ==');
    const env = makeEnv();
    const n1 = mkNode('t1', 100, 80, 'Fotosintesi\nProduzione di glucosio\nutilizzando luce e CO2.');
    n1.w = 260; n1.h = 96;
    const n2 = mkNode('t2', 100, 240, 'Clorofilla\nPigmento che cattura la luce.\nSi trova nei cloroplasti.');
    n2.w = 260; n2.h = 96;
    const n3 = mkNode('t3', 100, 400, 'Fase luminosa\nAvviene nei tilacoidi.');
    n3.w = 260; n3.h = 96;
    await openSchema(env, baseDoc('riassunto', [n1, n2, n3], [mkEdge('t1', 't2')]), 'Riassunto');

    // pannello testo affiancato montato automaticamente
    const side = env.doc.querySelector('.sc-side');
    ok(!!side && !side.classList.contains('hidden'), 'riassunto: pannello testo affiancato montato e visibile');
    const tabs = $$(env, '.sc-side .sc-tab').filter(t => t.style.display !== 'none');
    const activeTab = $$(env, '.sc-side .sc-tab.active')[0];
    ok(!!tabs.filter(t => t.textContent === 'Testo')[0], 'riassunto: tab “Testo” presente');
    ok(!!activeTab && activeTab.textContent === 'Testo', 'riassunto: tab “Testo” attivo all’apertura', activeTab && activeTab.textContent);

    // card multilinea: titolo + corpo
    const cards = $$(env, '.sc-node.sc-card');
    ok(cards.length === 3, 'riassunto: nodi renderizzati come card');
    const texts = cards[0].querySelectorAll('text');
    ok(texts.length === 2, 'riassunto: card con testo titolo + corpo separati', 'n=' + texts.length);
    ok(/Fotosintesi/.test(texts[0].textContent), 'riassunto: prima riga = titolo');
    ok(/glucosio/.test(texts[1].textContent), 'riassunto: corpo multilinea presente');

    // sincronizzazione pannello ↔ nodo selezionato
    let ta = $$(env, '.sc-side textarea').filter(t => t.parentNode.style.display !== 'none')[0];
    ok(!!ta, 'riassunto: textarea del pannello testo visibile');
    selectNode(env, 't2');
    await sleep(60);
    ta = $$(env, '.sc-side textarea').filter(t => t.parentNode.style.display !== 'none')[0];
    ok(!!ta && /Clorofilla/.test(ta.value), 'riassunto: pannello sincronizzato col nodo selezionato', ta && ta.value.slice(0, 30));
    // modifica dal pannello → card aggiornata
    ta.value = 'Clorofilla\nAggiornato dal pannello.';
    ta.dispatchEvent(new env.win.Event('input', { bubbles: true }));
    await sleep(60);
    const card2 = nodeGroup(env, 't2');
    ok(!!card2 && /Aggiornato dal pannello/.test(card2.textContent), 'riassunto: modifica dal pannello aggiorna la card');

    // archi facoltativi: collegare funziona, ma non obbligatorio (nessuna restrizione)
    connect(env, 't2', 't3');
    await sleep(30);
    ok(edgeGroups(env).length === 2, 'riassunto: archi facoltativi (collegamento riuscito)');
    const poly = $$(env, '.sc-edges polygon');
    ok(poly.length === 0, 'riassunto: archi semplici senza frecce');

    // auto-layout stack
    clickAutoLayout(env);
    await sleep(500);
    const r1 = nodeRect(env, 't1'), r2 = nodeRect(env, 't2'), r3 = nodeRect(env, 't3');
    ok(r1.x === r2.x && r2.x === r3.x, 'riassunto: stack a colonna (stessa x)');
    ok(r1.y < r2.y && r2.y < r3.y, 'riassunto: stack verticale');
    return env;
}

// ===============================================================
async function scenarioCambioTipo() {
    console.log('\n== TASK 4 — Cambio tipo su schema popolato ==');
    const env = makeEnv();
    const nodes = [mkNode('a', 300, 300, 'A'), mkNode('b', 650, 250, 'B'), mkNode('c', 500, 550, 'C'), mkNode('d', 150, 550, 'D')];
    const edges = [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'd')];
    const id = await openSchema(env, baseDoc('mappa', nodes, edges), 'Migrazione');

    // 1) mappa → lr: contenuto conservato, layout e vincoli nuovi applicati
    setConfirm(env, true);
    await saveNow(env); // stato iniziale persistito
    const sel = selType(env);
    sel.value = 'lr';
    sel.dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await sleep(550);
    await saveNow(env);

    let d0 = docOf(env, id);
    ok(d0.type === 'lr', 'cambio tipo: type persistito (lr)');
    ok(d0.nodes.length === 4 && d0.edges.length === 3, 'cambio tipo: nodi e archi conservati', d0.nodes.length + '/' + d0.edges.length);
    ok(selType(env).value === 'lr', 'cambio tipo: selettore aggiornato');
    ok(!!stratButton(env, '+ Nodo') && !!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello'),
        'cambio tipo: matrice lr aggiornata (+Nodo/+Figlio/+Fratello)');
    ok(guideLines(env).length >= 2, 'cambio tipo: guide colonne del nuovo tipo applicate');
    const rA = nodeRect(env, 'a'), rB = nodeRect(env, 'b'), rC = nodeRect(env, 'c'), rD = nodeRect(env, 'd');
    ok(rA && rB && rA.x < rB.x && rB.x < rC.x, 'cambio tipo: layout lr applicato con animazione', [rA && rA.x, rB && rB.x, rC && rC.x].join(','));
    ok(!!rD && rD.x > rC.x, 'cambio tipo: tutti i nodi ricollocati (D oltre C)', rD && String(rD.x));

    // 2) lr → albero: catena a→b→c→d valida anche come albero
    selType(env).value = 'albero';
    selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await sleep(550);
    await saveNow(env);
    d0 = docOf(env, id);
    ok(d0.type === 'albero' && d0.edges.length === 3, 'cambio tipo: lr→albero conserva tutto', d0.type + ' e=' + d0.edges.length);
    const tA = nodeRect(env, 'a'), tB = nodeRect(env, 'b');
    ok(tA && tB && tA.y < tB.y, 'cambio tipo: layout gerarchico applicato', tA && (tA.y + '<' + tB.y));

    // 3) albero → riassunto: pannello testo montato
    selType(env).value = 'riassunto';
    selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await sleep(550);
    const activeTab = $$(env, '.sc-side .sc-tab.active')[0];
    ok(!!activeTab && activeTab.textContent === 'Testo', 'cambio tipo → riassunto: pannello testo montato', activeTab && activeTab.textContent);
    ok($$(env, '.sc-node.sc-card').length === 4, 'cambio tipo → riassunto: nodi diventano card');

    // 4) schema con ciclo mappa → albero con conferma FALSE: il ciclo resta extra tratteggiato
    const env2 = makeEnv();
    setConfirm(env2, false);
    const nodes2 = [mkNode('a', 300, 300), mkNode('b', 650, 250), mkNode('c', 500, 550)];
    const edges2 = [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'a')];
    const id2 = await openSchema(env2, baseDoc('mappa', nodes2, edges2), 'Ciclo');
    selType(env2).value = 'albero';
    selType(env2).dispatchEvent(new env2.win.Event('change', { bubbles: true }));
    await sleep(550);
    await saveNow(env2);
    const d2 = docOf(env2, id2);
    ok(d2.type === 'albero', 'cambio tipo: mappa→albero type');
    ok(d2.edges.length === 3, 'cambio tipo: nessun arco rimosso con conferma=NO');
    const extras = d2.edges.filter(e => e.extra);
    ok(extras.length === 1 && extras[0].from === 'c', 'cambio tipo: ciclo marcato extra', JSON.stringify(extras));
    const extraEl = env2.doc.querySelector('.sc-edge-extra');
    ok(!!extraEl, 'cambio tipo: arco extra renderizzato tratteggiato');
    if (extraEl) {
        const p = edgePath(env2, extraEl);
        ok(p.hasAttribute('stroke-dasharray'), 'cambio tipo: stroke-dasharray presente sull’extra',
            'attr=' + p.getAttribute('stroke-dasharray'));
    }

    // 5) conferma = TRUE → extra rimossi
    const env3 = makeEnv();
    setConfirm(env3, true);
    const id3 = await openSchema(env3, baseDoc('mappa',
        [mkNode('a', 300, 300), mkNode('b', 650, 250), mkNode('c', 500, 550)],
        [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'a')]), 'Ciclo2');
    selType(env3).value = 'albero';
    selType(env3).dispatchEvent(new env3.win.Event('change', { bubbles: true }));
    await sleep(550);
    await saveNow(env3);
    const d3 = docOf(env3, id3);
    ok(d3.edges.length === 3 && d3.edges.filter(e => e.extra).length === 1, 'cambio tipo: NESSUNA rimozione mai (confirm eliminato: extra preservati)', 'n=' + d3.edges.length);

    // 6) riapertura: la strategia del tipo persistito si riapplica
    const env4 = makeEnv();
    const id4 = await openSchema(env4, baseDoc('lr',
        [mkNode('a', 0, 0), mkNode('b', 0, 0), mkNode('c', 0, 0)],
        [mkEdge('a', 'b'), mkEdge('b', 'c')]), 'Riapertura');
    // il salvataggio era lr → riaperto con lr: guide colonne + niente figlio
    ok(selType(env4).value === 'lr', 'riapertura: tipo persistito letto da doc.type');
    clickAutoLayout(env4);
    await sleep(500);
    ok(guideLines(env4).length >= 2, 'riapertura: strategia lr riapplicata (guide colonne)');
    ok(!!stratButton(env4, '+ Nodo') && !!stratButton(env4, '+ Figlio'), 'riapertura: pulsanti lr (+Nodo/+Figlio)');
    return env;
}

// ===============================================================
// BLOCCO 2 (RENDER): transizione verso Mappa concettuale.
// Misura a ogni passo: DOM .sc-edge vs doc.edges, residue .sc-guide,
// etichette (gate edgeStyle().etichetta) e tratteggi residui.
// Solo AGGIUNTE: nessuna asserzione esistente viene toccata.
// ===============================================================
async function scenarioTransizioneMappa() {
    console.log('\n== BLOCCO 2 - Transizione verso Mappa concettuale (rendering) ==');
    const env = makeEnv();
    const nodes = [
        mkNode('a', 120, 90, 'A'), mkNode('b', 430, 90, 'B'), mkNode('c', 740, 90, 'C'),
        mkNode('d', 260, 330, 'D'), mkNode('e', 600, 330, 'E')
    ];
    const edges = [
        mkEdge('a', 'b', 'va'), mkEdge('b', 'c', 'vb'),
        mkEdge('a', 'd', 'vd'), mkEdge('d', 'e', 've')
    ];
    const id = await openSchema(env, baseDoc('albero', nodes, edges), 'TransizioneMappa');

    function snap(tag) {
        const gs = edgeGroups(env);
        let dash = 0, dashExtra = 0;
        gs.forEach(g => {
            const p = edgePath(env, g);
            if (p && p.hasAttribute('stroke-dasharray')) {
                dash++;
                if (g.classList.contains('sc-edge-extra')) dashExtra++;
            }
        });
        const docLen = docOf(env, id).edges.length;
        const s = {
            dom: gs.length, doc: docLen, guide: guideLines(env).length,
            labels: $$(env, '.sc-elabel').length, dash: dash, dashExtra: dashExtra
        };
        console.log('    [' + tag + '] DOM=' + s.dom + ' doc.edges=' + s.doc +
            ' guide=' + s.guide + ' etichette=' + s.labels +
            ' dash=' + s.dash + ' (extra ' + s.dashExtra + ')');
        return s;
    }
    async function go(tipo) {
        selType(env).value = tipo;
        selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
        await sleep(550);
        await saveNow(env);
    }
    async function dblClickEdge(e2) {
        e2.dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true }));
        await sleep(120);
        const n = $$(env, '.modal-overlay').length;
        if (n) {
            const b = $$(env, '.modal-overlay button').filter(x => x.textContent.trim() === 'Annulla')[0];
            if (b) click(env, b);
            await sleep(240);
        }
        return n;
    }

    // --- fase 1: albero iniziale (5 nodi / 4 archi etichettati)
    await saveNow(env);
    const s0 = snap('albero iniziale');
    const modalAlbero = await dblClickEdge(edgeGroups(env)[0]);   // atteso 0
    console.log('    [albero dblclick arco] modale=' + modalAlbero);

    // --- fase 2: albero -> mappa concettuale (il bug riportato)
    await go('mappa');
    const s1 = snap('albero->mappa');

    // re-render (click selezione): il conteggio NON deve crescere
    selectNode(env, 'a');
    await sleep(80);
    const s1b = snap('mappa + re-render');

    const modalMappa = await dblClickEdge(edgeGroups(env)[0]);   // atteso >0
    console.log('    [mappa dblclick arco] modale=' + modalMappa);

    // --- fase 3: ulteriori transizioni multi-tipo
    await go('libero');    const s2 = snap('mappa->libero');
    await go('riassunto'); const s3 = snap('libero->riassunto');
    await go('mappa');     const s4 = snap('riassunto->mappa');

    // [A1] nessuna duplicazione/perdita: DOM == doc.edges a ogni step,
    // e il count resta identico dopo un secondo render()
    const steps = [s0, s1, s1b, s2, s3, s4];
    const countsOk = steps.every(s => s.dom === s.doc) && s1b.dom === s1.dom;
    ok(countsOk, 'B2: dopo le transizioni DOM .sc-edge == doc.edges e il conteggio non cresce al re-render',
        steps.map((s, i) => ['base', 'mappa', 'rerender', 'libero', 'riassunto', 'mappa2'][i] + '=' + s.dom + '/' + s.doc).join(' '));

    // [A2] nessuna guida residua dopo il cambio tipo
    //      (baseline: lr ha guide 'colonne' > 0; mappa/libero/riassunto = 0)
    const env2 = makeEnv();
    await openSchema(env2, baseDoc('lr',
        [mkNode('a', 100, 100, 'A'), mkNode('b', 400, 100, 'B'), mkNode('c', 700, 100, 'C')],
        [mkEdge('a', 'b', 'ab'), mkEdge('b', 'c', 'bc')]), 'GuideLR');
    await saveNow(env2);
    const gLr = guideLines(env2).length;
    selType(env2).value = 'mappa';
    selType(env2).dispatchEvent(new env2.win.Event('change', { bubbles: true }));
    await sleep(550);
    const gMappa = guideLines(env2).length;
    console.log('    [guide] lr=' + gLr + ' -> mappa=' + gMappa +
        ' | residui passi=' + [s1.guide, s2.guide, s3.guide, s4.guide].join('/'));
    ok(gLr > 0 && gMappa === 0 && s1.guide === 0 && s2.guide === 0 && s3.guide === 0 && s4.guide === 0,
        'B2: nessuna .sc-guide residua dopo il cambio tipo (lr->mappa da >0 a 0; mappa/libero/riassunto = 0)',
        'lr=' + gLr + ' mappa=' + gMappa + ' residui=' + [s1.guide, s2.guide, s3.guide, s4.guide].join(','));

    // [A3] etichetta arco editabile SOLO in mappa (gate edgeStyle().etichetta)
    ok(s0.labels === 0 && s1.labels === 4 && modalAlbero === 0 && modalMappa > 0,
        'B2: etichetta archi editabile solo in mappa (gate edgeStyle().etichetta)',
        'label albero=' + s0.labels + ' mappa=' + s1.labels +
        ' modale albero=' + modalAlbero + ' mappa=' + modalMappa);

    // residui dash: log informativo (attesi solo su .sc-edge-extra)
    const dashAnomalo = steps.filter(s => s.dash !== s.dashExtra);
    console.log('    [dash] residui non-extra: ' + (dashAnomalo.length
        ? dashAnomalo.map(s => s.dom + ':' + s.dash + '/' + s.dashExtra).join(' ')
        : 'nessuno'));
    return env;
}

// ===============================================================
// BLOCCO 2 (strategia): transizioni su TUTTE le paire ordinate
// source->target con doc a sentiero a->b->c->d (4 nodi / 3 archi,
// valido ovunque -> nessuna conferma attesa). Solo AGGIUNTE.
// ===============================================================
async function scenarioTransizioniTuttiTipi() {
    console.log('\n== BLOCCO 2 - Transizioni tutti i tipi (paire ordinate) ==');
    const probe = makeEnv();
    const TYPES = Object.keys(probe.win.SchemaStrategies.SCHEMA_STRATEGIES);
    let pairs = 0, transitions = 0;
    for (let si = 0; si < TYPES.length; si++) {
        const source = TYPES[si];
        for (let ti = 0; ti < TYPES.length; ti++) {
            const target = TYPES[ti];
            if (target === source) continue;
            pairs++;
            const tag = source + '>' + target;
            // env per coppia: la transizione misurata e' esattamente source->target
            const env = makeEnv();
            env.confirmCalls = [];
            env.win.confirm = msg => { env.confirmCalls.push(String(msg == null ? '' : msg)); return false; };
            const nodes = [mkNode('a', 120, 90, 'A'), mkNode('b', 430, 90, 'B'),
                mkNode('c', 740, 90, 'C'), mkNode('d', 430, 330, 'D')];
            const edges = [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'd')];
            const id = await openSchema(env, baseDoc(source, nodes, edges), 'T ' + tag);
            // transizione simulata come farebbe l'utente sul selettore
            selType(env).value = target;
            selType(env).dispatchEvent(new env.win.Event('change', { bubbles: true }));
            await sleep(550);
            await saveNow(env);
            transitions++;
            const d = docOf(env, id);
            ok(d.type === target && selType(env).value === target,
                'B2T[' + tag + '] type + selettore aggiornati', d.type + '/' + selType(env).value);
            ok(d.nodes.length === 4 && d.edges.length === 3,
                'B2T[' + tag + '] nodi(4)/archi(3) invariati', d.nodes.length + '/' + d.edges.length);
            const gs = edgeGroups(env);
            const domIds = gs.map(g => g.getAttribute('data-eid')).sort().join(',');
            const docIds = d.edges.map(e => e.id).sort().join(',');
            ok(gs.length === 3 && domIds === docIds,
                'B2T[' + tag + '] DOM .sc-edge==3 e data-eid == doc.edges',
                'dom=' + gs.length + ' ids=' + domIds + ' vs ' + docIds);
            ok(env.confirmCalls.length === 0,
                'B2T[' + tag + '] nessuna conferma chiamata', env.confirmCalls.length + ' call');
            const needGuide = !!env.win.SchemaStrategies.getStrategy(target).ui().guide;
            const gl = guideLines(env);
            if (needGuide) {
                const cont = gl.every(l => !l.hasAttribute('stroke-dasharray'));
                ok(gl.length >= 1 && cont,
                    'B2T[' + tag + '] guide ' + target + ' presenti e continue (no dasharray)',
                    'n=' + gl.length + ' continue=' + cont);
            } else {
                ok(gl.length === 0,
                    'B2T[' + tag + '] nessuna guida residua', 'n=' + gl.length);
            }
            if (target === 'albero') {
                ok(!!stratButton(env, '+ Figlio'),
                    'B2T[' + tag + '] pulsante "+ Figlio" presente (albero)');
            }
            if (target === 'libero') {
                const bLay = stratButton(env, 'Auto-layout');
                ok(!!bLay && bLay.disabled,
                    'B2T[' + tag + '] Auto-layout disabilitato (libero)',
                    bLay ? 'disabled=' + bLay.disabled : 'pulsante assente');
            }
        }
        console.log('    sorgente ' + source + ' completata (paire finora=' + pairs + ')');
    }
    ok(pairs === TYPES.length * (TYPES.length - 1),
        'B2T: tutte le paire ordinate coperte', pairs + ' paire, ' + transitions + ' transizioni');
    return null;
}

// ===============================================================
async function main() {
    try {
        await scenarioAlbero();
        await scenarioMappa();
        await scenarioLR();
        await scenarioLegacyTb();
        await scenarioLibero();
        await scenarioRiassunto();
        await scenarioCambioTipo();
        await scenarioTransizioneMappa();
        await scenarioTransizioniTuttiTipi();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI UI: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}

main();
