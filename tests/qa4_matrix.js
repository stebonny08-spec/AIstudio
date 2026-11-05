/* ============================================================
   tests/qa4_matrix.js — QA-4 (T1 indipendente): CHECKLIST QA-1
   1) matrice pulsanti di aggiunta per tipo (DOM .sc-btnwrap)
   2) semantica +Nodo/+Figlio/+Fratello, 2° genitore rifiutato,
      fallback senza genitore (albero/lr/libero -> nodo isolato
      NESSUN toast; mappa -> sempre connesso)
   3) bootstrap: 0 nodi -> [+ Nodo] in TUTTI i tipi
   4) chrome al cambio tipo: tab Testo SEMPRE presente (4 tab in ogni
      tipo, auto-apertura sul tipo riassunto), etichetta arco editabile
      (dblclick) SOLO mappa, auto-layout disabilitato SOLO libero,
      select stile arco SOLO libero

   Verifica INDIPENDENTE (jsdom: logica/struttura, NON geometria
   reale). Harness copiato dal pattern di tests/implBlock12.test.js
   (nessun import di file modificabili da altri). Prodotto in LETTURA.

   Eseguire con: node tests/qa4_matrix.js
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
function dblclick(env, elm) {
    elm.dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
}
function nodeGroup(env, nid) { return env.doc.querySelector('[data-nid="' + nid + '"]'); }
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function edgeCount(env) { return edgeGroups(env).length; }
function nodeCount(env) { return $$(env, 'g.sc-node[data-nid]').length; }
function nodeIds(env) { return $$(env, 'g.sc-node[data-nid]').map(g => g.getAttribute('data-nid')); }
function stratButtons(env) { return Array.from(env.doc.querySelectorAll('.sc-btnwrap button')); }
function stratButton(env, label) {
    return stratButtons(env).filter(b => b.textContent.trim() === label)[0] || null;
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function selectNode(env, nid) {
    ptr(env, nodeGroup(env, nid), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
}
function toastText(env) { const t = env.doc.querySelector('.sc-toast'); return t ? t.textContent : null; }
function testoTab(env) {
    return $$(env, '.sc-tab').filter(b => b.textContent.trim() === 'Testo')[0] || null;
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

// ---- matrice attesa (spec QA-1.1) ----
const LABEL2ID = { '+ Nodo': 'node', '+ Figlio': 'child', '+ Fratello': 'sibling' };
const FULL = {
    albero: ['+ Nodo', '+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    lr: ['+ Nodo', '+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    libero: ['+ Nodo', '+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    mappa: ['+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    riassunto: ['+ Figlio', 'Cancella', 'Collega', 'Auto-layout']
};
function expectedAdds(t) {
    return FULL[t].map(l => LABEL2ID[l]).filter(Boolean).sort().join(',');
}
function actualAdds(env) {
    return stratButtons(env).map(b => LABEL2ID[b.textContent.trim()]).filter(Boolean).sort().join(',');
}

// ===============================================================
// 1) MATRICE DEI PULSANTI DI AGGIUNTA PER TIPO
// ===============================================================
async function matrixCheck() {
    console.log('== QA4-1: matrice pulsanti per tipo (doc con 1 nodo) ==');
    for (const t of ['albero', 'lr', 'libero', 'mappa', 'riassunto']) {
        const env = makeEnv();
        await openSchema(env, mBase(t, [mkN('a', 300, 300)], []), 'QA4-matrix-' + t);
        const labels = stratButtons(env).map(b => b.textContent.trim());
        ok(JSON.stringify(labels) === JSON.stringify(FULL[t]),
            'QA1.1 ' + t + ': .tool-btn completi [' + FULL[t].join(',') + ']',
            'ottenuto [' + labels.join(',') + ']');

        const adds = actualAdds(env);
        ok(adds === expectedAdds(t),
            'QA1.1 ' + t + ': matrice AGGIUNTA esatta [' + expectedAdds(t) + ']',
            'ottenuto [' + adds + ']');

        // vincoli puntuali della spec
        const hasNode = labels.indexOf('+ Nodo') >= 0;
        if (t === 'mappa') ok(!hasNode, 'QA1.1 mappa: + Nodo ABSENTE (SBAGLIATO se presente)');
        else if (t === 'riassunto') ok(!hasNode, 'QA1.1 riassunto: + Nodo ABSENTE (spec 1.1: solo + Figlio)');
        else ok(hasNode, 'QA1.1 ' + t + ': + Nodo presente');
        if (t === 'riassunto') {
            ok(labels.indexOf('+ Fratello') < 0 && labels.indexOf('+ Nodo') < 0,
                'QA1.1 riassunto: SOLO + Figlio tra i pulsanti di aggiunta');
        }

        // layout attivo / disabilitato
        const lay = stratButton(env, 'Auto-layout');
        ok(!!lay && lay.disabled === (t === 'libero'),
            'QA1.1 ' + t + ': auto-layout ' + (t === 'libero' ? 'DISABILITATO' : 'attivo'));

        // select stile arco SOLO in libero
        const sels = $$(env, '.sc-btnwrap select');
        if (t === 'libero') {
            ok(sels.length === 1, 'QA1.1 libero: select stile arco presente', 'n=' + sels.length);
            if (sels.length === 1) {
                const opts = Array.from(sels[0].options).map(o => o.textContent + '=' + o.value);
                ok(JSON.stringify(opts) === JSON.stringify(['Dritto=dritta', 'Curvo=curva', 'Gomito=gomito']),
                    'QA1.1 libero: opzioni arco [Dritto,Curvo,Gomito]', opts.join(','));
            }
        } else {
            ok(sels.length === 0, 'QA1.1 ' + t + ': NESSUN select stile arco in .sc-btnwrap', 'n=' + sels.length);
        }

        // SPEC AGGIORNATA (B2): tab Testo SEMPRE presente/visibile in OGNI tipo;
        // al tipo riassunto si apre in automatico (tab attivo all'apertura).
        const tabT = testoTab(env);
        const vis = !!tabT && tabT.style.display !== 'none';
        ok(vis, 'QA1.1 ' + t + ': tab Testo SEMPRE visibile (4 tab in ogni tipo)',
            'tabT=' + !!tabT + ' display=' + (tabT ? tabT.style.display : 'n/a'));
        if (t === 'riassunto') {
            const activeT = $$(env, '.sc-side .sc-tab.active')[0];
            ok(!!activeT && activeT.textContent.trim() === 'Testo',
                'QA1.1 riassunto: tab Testo ATTIVO in apertura (auto-apertura)',
                activeT ? activeT.textContent : 'nessun attivo');
        }
    }
}

// ===============================================================
// 2) SEMANTICA DEI PULSANTI
// ===============================================================
async function semanticsCheck() {
    console.log('== QA4-2: semantica +Nodo / +Figlio / +Fratello / fallback ==');

    // + Nodo = nodo SENZA archi (anche con selezione attiva)
    {
        const env = makeEnv();
        const id = await openSchema(env, mBase('albero', [mkN('a', 300, 300)], []), 'QA4-nodo');
        selectNode(env, 'a');
        await sleep(60);
        click(env, stratButton(env, '+ Nodo'));
        await sleep(140);
        await saveNow(env);
        const d = docOf(env, id);
        ok(d.nodes.length === 2 && d.edges.length === 0,
            'QA1.2 + Nodo: +1 nodo, ZERO archi (con selezione attiva)',
            'n=' + d.nodes.length + ' e=' + d.edges.length);
        ok(!toastText(env), 'QA1.2 + Nodo: nessun toast');
    }

    // + Figlio / + Fratello (con genitore) / 2° genitore rifiutato in albero
    {
        const env = makeEnv();
        const id = await openSchema(env, mBase('albero', [mkN('a', 300, 300)], []), 'QA4-sem');
        selectNode(env, 'a');
        await sleep(60);
        click(env, stratButton(env, '+ Figlio'));
        await sleep(140);
        await saveNow(env);
        let d = docOf(env, id);
        let ids = nodeIds(env);
        const N = ids.filter(x => x !== 'a')[0];
        ok(d.nodes.length === 2 && d.edges.length === 1,
            'QA1.2 + Figlio (albero): nodo + 1 arco',
            'n=' + d.nodes.length + ' e=' + d.edges.length);
        ok(!!N && d.edges[0] && d.edges[0].from === 'a' && d.edges[0].to === N,
            'QA1.2 + Figlio (albero): arco selezionato -> nuovo',
            JSON.stringify(d.edges[0]));

        // + Fratello su N (ha genitore a): arco GENITORE -> nuovo
        selectNode(env, N);
        await sleep(60);
        click(env, stratButton(env, '+ Fratello'));
        await sleep(140);
        await saveNow(env);
        d = docOf(env, id);
        ids = nodeIds(env);
        const S = ids.filter(x => x !== 'a' && x !== N)[0];
        const eS = d.edges.filter(e => e.to === S)[0];
        ok(d.nodes.length === 3 && d.edges.length === 2 && !!eS && eS.from === 'a',
            'QA1.2 + Fratello (albero): arco GENITORE -> nuovo (non selezionato -> nuovo)',
            'n=' + d.nodes.length + ' e=' + d.edges.length + ' from=' + (eS && eS.from));

        // + Nodo con selezione: nessun arco implicito (crea la "terza" sorgente X)
        click(env, stratButton(env, '+ Nodo'));
        await sleep(140);
        ids = nodeIds(env);
        const X = ids.filter(x => x !== 'a' && x !== N && x !== S)[0];
        ok(ids.length === 4 && edgeCount(env) === 2,
            'QA1.2 + Nodo (con selezione): nodo isolato, archi invariati',
            'n=' + ids.length + ' e=' + edgeCount(env));

        // 2° genitore rifiutato: Collega X -> N (N ha già padre a)
        const eBefore = edgeCount(env);
        click(env, stratButton(env, 'Collega'));
        ptr(env, nodeGroup(env, X), 'pointerdown', 5, 5);
        ptr(env, nodeGroup(env, N), 'pointerdown', 9, 9);
        await sleep(140);
        const t = toastText(env);
        ok(edgeCount(env) === eBefore,
            'QA1.2 albero: 2° genitore RIFIUTATO (nessun arco aggiunto)',
            'e prima=' + eBefore + ' dopo=' + edgeCount(env));
        ok(!!t && /solo padre/.test(t),
            'QA1.2 albero: toast motivato sul 2° genitore', 'toast=' + t);
    }

    // fallback senza genitore: albero/lr/libero -> come + Nodo (isolato, NESSUN toast)
    for (const t of ['albero', 'lr', 'libero']) {
        const env = makeEnv();
        const id = await openSchema(env, mBase(t, [mkN('a', 300, 300)], []), 'QA4-fb-' + t);
        selectNode(env, 'a');
        await sleep(60);
        click(env, stratButton(env, '+ Fratello'));
        await sleep(140);
        await saveNow(env);
        const d = docOf(env, id);
        ok(d.nodes.length === 2 && d.edges.length === 0 && !toastText(env),
            'QA1.2 ' + t + ': +Fratello senza genitore = + Nodo (isolato, NESSUN toast)',
            'n=' + d.nodes.length + ' e=' + d.edges.length + ' toast=' + toastText(env));
    }

    // fallback senza genitore: mappa -> come + Figlio (SEMPRE connesso)
    {
        const env = makeEnv();
        const id = await openSchema(env, mBase('mappa', [mkN('a', 300, 300)], []), 'QA4-fb-mappa');
        selectNode(env, 'a');
        await sleep(60);
        click(env, stratButton(env, '+ Fratello'));
        await sleep(140);
        await saveNow(env);
        const d = docOf(env, id);
        ok(d.nodes.length === 2 && d.edges.length === 1 && d.edges[0].from === 'a',
            'QA1.2 mappa: +Fratello senza genitore = + Figlio (SEMPRE connesso)',
            'n=' + d.nodes.length + ' e=' + d.edges.length + ' from=' + (d.edges[0] && d.edges[0].from));
    }
}

// ===============================================================
// 3) BOOTSTRAP: 0 NODI -> [+ Nodo] IN TUTTI I TIPI
// ===============================================================
async function bootstrapCheck() {
    console.log('== QA4-3: bootstrap 0 nodi ==');
    for (const t of ['albero', 'lr', 'libero', 'mappa', 'riassunto']) {
        const env = makeEnv();
        await openSchema(env, mBase(t, [], []), 'QA4-boot-' + t);
        const b = stratButton(env, '+ Nodo');
        ok(!!b, 'QA1.3 ' + t + ': 0 nodi -> [+ Nodo] visibile');
        if (b) { click(env, b); await sleep(160); }
        ok(nodeCount(env) === 1 && edgeCount(env) === 0,
            'QA1.3 ' + t + ': + Nodo crea il PRIMO nodo',
            'n=' + nodeCount(env) + ' e=' + edgeCount(env));
        const still = !!stratButton(env, '+ Nodo');
        const hasChild = !!stratButton(env, '+ Figlio');
        if (t === 'mappa' || t === 'riassunto') {
            ok(!still, 'QA1.3 ' + t + ': con 1 nodo + Nodo SPARISCE (torna la matrice)');
            ok(hasChild, 'QA1.3 ' + t + ': con 1 nodo + Figlio presente');
        } else {
            ok(still && hasChild && !!stratButton(env, '+ Fratello'),
                'QA1.3 ' + t + ': con 1 nodo matrice completa [node,child,sibling]',
                'node=' + still + ' child=' + hasChild + ' sib=' + !!stratButton(env, '+ Fratello'));
        }
        if (t === 'riassunto') ok(!stratButton(env, '+ Fratello'), 'QA1.3 riassunto: + Fratello assente (matrice [child])');
        if (t === 'mappa') ok(!!stratButton(env, '+ Fratello'), 'QA1.3 mappa: + Fratello presente (matrice [child,sibling])');
    }
}

// ===============================================================
// 4) CAMBIO TIPO AGGIORNA IL CHROME
// ===============================================================
async function chromeCheck() {
    console.log('== QA4-4: chrome al cambio tipo (tab Testo / etichetta / layout / arco) ==');
    const env = makeEnv();
    const id = await openSchema(env,
        mBase('albero', [mkN('a', 200, 200), mkN('b', 550, 200)], [mkE('a', 'b')]), 'QA4-chrome');

    for (const t of ['albero', 'lr', 'libero', 'mappa', 'riassunto']) {
        if (selType(env).value !== t) await changeType(env, t);
        const tag = 'QA1.4[' + t + ']';

        // (a) SPEC AGGIORNATA (B2): tab Testo SEMPRE visibile in tutti i tipi
        // + auto-apertura al tipo riassunto
        const tabT = testoTab(env);
        const vis = !!tabT && tabT.style.display !== 'none';
        ok(vis, tag + ': tab Testo SEMPRE visibile (4 tab in ogni tipo)',
            'tabT=' + !!tabT + ' display=' + (tabT ? tabT.style.display : 'n/a'));
        if (t === 'riassunto') {
            const actT = $$(env, '.sc-side .sc-tab.active')[0];
            ok(!!actT && actT.textContent.trim() === 'Testo',
                tag + ': tab Testo ATTIVO dopo cambio tipo (auto-apertura)',
                actT ? actT.textContent : 'nessuno');
        }

        // (b) select stile arco SOLO in libero
        const sels = $$(env, '.sc-btnwrap select');
        ok((t === 'libero') === (sels.length === 1),
            tag + ': select stile arco ' + (t === 'libero' ? 'presente' : 'assente'),
            'n=' + sels.length);

        // (c) auto-layout disabilitato SOLO in libero
        const lay = stratButton(env, 'Auto-layout');
        ok(!!lay && lay.disabled === (t === 'libero'),
            tag + ': auto-layout ' + (t === 'libero' ? 'DISABILITATO' : 'attivo'),
            lay ? 'disabled=' + lay.disabled : 'bottone mancante');

        // (d) etichetta arco editabile (dblclick) SOLO in mappa
        const eg = edgeGroups(env)[0];
        ok(!!eg, tag + ': arco renderizzato nel DOM');
        if (eg) {
            dblclick(env, eg);
            await sleep(140);
            const modal = env.doc.querySelector('.modal-overlay');
            if (t === 'mappa') {
                ok(!!modal, tag + ': dblclick arco APRE modale etichetta');
                if (modal) {
                    const inp = modal.querySelector('input');
                    inp.value = 'lbl-qa4';
                    click(env, modal.querySelector('.btn-accent'));
                    await sleep(320);
                    await saveNow(env);
                    const d = docOf(env, id);
                    ok(d.edges[0] && d.edges[0].label === 'lbl-qa4',
                        tag + ': etichetta salvata nel doc', 'label=' + (d.edges[0] && d.edges[0].label));
                }
            } else {
                ok(!modal, tag + ': dblclick arco NON apre modale (etichetta non editabile)');
                if (modal) {
                    const anc = modal.querySelector('.btn-secondary');
                    if (anc) click(env, anc);
                    await sleep(260);
                }
            }
        }
    }
    ok(env.win.__confirmCalls.length === 0,
        'QA1.4: NESSUNA chiamata a confirm() in tutto il ciclo dei tipi',
        'n=' + env.win.__confirmCalls.length);
}

// ===============================================================
async function main() {
    try {
        await matrixCheck();
        await semanticsCheck();
        await bootstrapCheck();
        await chromeCheck();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('\n================================================');
    console.log('RISULTATI qa4_matrix: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
