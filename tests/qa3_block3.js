/* ============================================================
   tests/qa3_block3.js — QA-3 (BLOCCO 3: rimozione tipo "Alto → basso"

   Script TEMPORANEO del sub-agente QA. Non modifica prodotto.
   Copia locale dei minimi dell'harness di uiHarness.test.js (stessi
   stub) + sweep documentale + regressioni delle suite esistenti.

   Copre la checklist QA-3 punti 1-6:
   1) chooser "Nuovo schema": esattamente 5 .choice nell'ordine giusto;
   2) select.sc-type-sel: 5 option values (albero,mappa,lr,libero,riassunto);
   3) doc legacy type:'alto-basso' -> si apre come albero con layout
      gerarchico al primo caricamento (posizioni SCRAMBLE prima/dopo);
   4) rollback: nodi vuoti senza errore, log apertura legacy puliti,
      flag pendingLegacyLayout/legacyTb mai persistita;
   5) sweep citazioni attive del tipo rimosso (docs + testi utente);
   6) regressioni: 5 suite + node --check x2 + grep vincoli congelati.

   Eseguire con: node tests/qa3_block3.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const M = (...p) => path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', ...p);
const SRC_STRAT = fs.readFileSync(M('schemaStrategies.js'), 'utf8');
const SRC_SCHEMI = fs.readFileSync(M('schemi.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Noise jsdom NON correlata a errore reale: Not implemented (canvas/scroll…)
// e parse CSS dello stylesheet iniettato via App.style.
const NOISE = /Not implemented|Could not parse CSS/i;
const vcLogs = [];  // tutti i log catturati (anche noise, per il report)
function realLogs() { return vcLogs.filter(l => !NOISE.test(l.msg)); }

// ---------------------------------------------------------------
// Ambiente DOM + stub (copia minima da uiHarness/qa2)
// ---------------------------------------------------------------
function makeEnv() {
    const vc = new VirtualConsole();
    const push = (type) => (...a) => vcLogs.push({ type: type, msg: a.map(x => (x && x.stack) ? x.stack : String(x)).join(' ') });
    vc.on('jsdomError', push('jsdomError'));
    vc.on('error', push('error'));
    vc.on('warn', push('warn'));
    // 'log' NON catturato: i log di debug prodotto non interessano
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
        virtualConsole: vc
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

// ---- helpers di interazione (stessi di qa2) ----
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function nodeRect(env, nid) {
    const g = env.doc.querySelector('[data-nid="' + nid + '"]');
    if (!g) return null;
    const r = g.querySelector('rect');
    if (!r) return null;
    return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') };
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function guideLines(env) { return $$(env, '.sc-guide line'); }
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function baseDoc(type, nodes, edges) {
    return {
        type: type, nodes: nodes, edges: edges,
        view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' }
    };
}
function mkNode(id, x, y, text) {
    return { id: id, x: x, y: y, w: 170, h: 60, text: text || (id.toUpperCase()) };
}
function mkEdge(from, to, id) { return { id: id || ('e' + from + to), from: from, to: to, label: '', color: '#8ca4ff' }; }
function addItem(env, docObj, title) {
    const id = 'x' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'schema', title: title || 'Test', content: JSON.stringify(docObj),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    return id;
}
async function saveNow(env) {
    const btns = Array.from(env.doc.querySelectorAll('.app-header button'));
    const b = btns.filter(x => /Salva/.test(x.textContent))[0];
    if (b) b.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(160);
}
function docOf(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return JSON.parse(it.content);
}
function rawContent(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return String(it.content || '');
}
function yMap(env, ids) {
    const o = {};
    ids.forEach(k => { const r = nodeRect(env, k); o[k] = r ? r.y : null; });
    return o;
}

// ===============================================================
// PUNTO 1 — Dialog di creazione: solo 5 tipi, griglia ordinata
// ===============================================================
async function p1_chooser() {
    console.log('\n== PUNTO 1 — chooser "Nuovo schema" ==');
    const env = makeEnv();
    addItem(env, baseDoc('libero', [mkNode('a', 10, 10)], []), 'Esistente'); // elenco non vuoto
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, {});
    await sleep(120);
    const btnNew = $$(env, 'button').filter(b => /Nuovo schema/.test(b.textContent))[0];
    ok(!!btnNew, 'P1 pulsante "Nuovo schema" presente in elenco', btnNew ? 'ok' : 'assente');
    if (!btnNew) return;
    btnNew.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(180); // renderChooser async (await listSubjects)
    const choices = $$(env, '.choice');
    const labels = choices.map(c => c.textContent.trim());
    console.log('    DOM .choice [' + labels.length + ']: ' + JSON.stringify(labels));
    const expected = ['Albero', 'Mappa concettuale', 'Sinistra \u2192 destra', 'Schema libero', 'Riassunto visuale'];
    ok(choices.length === 5, 'P1 esattamente 5 bottoni .choice', 'n=' + choices.length);
    ok(labels.join('|') === expected.join('|'),
        'P1 etichette nell\'ordine esatto (Albero, Mappa concettuale, Sinistra → destra, Schema libero, Riassunto visuale)',
        JSON.stringify(labels));
    ok(!labels.some(l => /alto/i.test(l)), 'P1 ZERO opzione "Alto → basso" nella griglia', JSON.stringify(labels));
    // bonus: evidenza TYPES del modulo sorgente
    const typesBlock = /const TYPES = \[([\s\S]*?)\];/.exec(SRC_SCHEMI);
    const ids = typesBlock ? (typesBlock[1].match(/id:\s*'[^']+'/g) || []).map(s => s.slice(5, -1)) : [];
    console.log('    TYPES(sorgi' + 'ente): ' + JSON.stringify(ids));
    ok(ids.join(',') === 'albero,mappa,lr,libero,riassunto', 'P1 TYPES sorgente = 5 id ordinati', ids.join(','));
}

// ===============================================================
// PUNTO 2 — Selettore cambio tipo: solo 5 opzioni
// ===============================================================
async function p2_typeSel() {
    console.log('\n== PUNTO 2 — select.sc-type-sel ==');
    const env = makeEnv();
    const id = addItem(env, baseDoc('libero', [mkNode('a', 10, 10), mkNode('b', 300, 10)], [mkEdge('a', 'b')]), 'Sel');
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: id });
    await sleep(150);
    const sel = selType(env);
    ok(!!sel, 'P2 selettore .sc-type-sel montato', sel ? 'ok' : 'assente');
    if (!sel) return;
    const opts = Array.from(sel.options);
    const values = opts.map(o => o.value);
    const olabels = opts.map(o => o.textContent.trim());
    console.log('    DOM option values: ' + JSON.stringify(values));
    console.log('    DOM option labels : ' + JSON.stringify(olabels));
    ok(values.join(',') === 'albero,mappa,lr,libero,riassunto',
        'P2 values esattamente i 5 id (albero, mappa, lr, libero, riassunto)', values.join(','));
    ok(!values.includes('tb') && !values.includes('alto-basso'), 'P2 nessun value "tb"/"alto-basso"', values.join(','));
    ok(!olabels.some(l => /alto/i.test(l)), 'P2 nessuna label contenente "Alto"', JSON.stringify(olabels));
}

// ===============================================================
// PUNTO 3 — Doc legacy 'alto-basso' si apre come albero + layout
// ===============================================================
async function p3_legacyAltoBasso(tag, legacyType) {
    const env = makeEnv();
    // Posizioni SCRAMBLE: radice "a" parte in basso (y=600), figli/nipoti in alto
    const nodes = [mkNode('a', 700, 600, 'Radice'), mkNode('b', 100, 100), mkNode('c', 900, 150),
        mkNode('d', 400, 50), mkNode('e', 50, 300), mkNode('f', 800, 450)];
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('b', 'e'), mkEdge('c', 'f')];
    const id = addItem(env, baseDoc(legacyType, nodes, edges), 'Legacy ' + legacyType);
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    env.mod.open(cont, { open: id });

    // lettura PRIMA del timer auto-layout (60ms post-render): polling fino al mount
    let before = null, sel = null;
    for (let i = 0; i < 40 && !before; i++) {
        await sleep(10);
        sel = selType(env);
        if (sel) before = yMap(env, ids);
    }
    ok(!!sel, tag + ' editor montato (polling <60ms dal render)', sel ? 'ok' : 'mai montato');
    ok(sel && sel.value === 'albero', tag + ' selType.value===\'albero\' al PRIMO caricamento (prima dell\'auto-layout)',
        sel ? sel.value : 'n/a');
    console.log('    ' + tag + ' y PRIMA auto-layout: ' + JSON.stringify(before));
    if (before) {
        ok(before.a === 600 && before.b === 100,
            tag + ' posizioni PRIMA = SCRAMBLE non toccate dal parse (a y=600 > b y=100)',
            'a=' + before.a + ' b=' + before.b);
    }

    await sleep(560); // timer 60ms + animazione ~200ms + margine
    const after = yMap(env, ids);
    console.log('    ' + tag + ' y DOPO  auto-layout: ' + JSON.stringify(after));
    const okHier = after.a != null && after.b != null && after.c != null &&
        after.d != null && after.e != null && after.f != null &&
        after.a < after.b && after.a < after.c &&          // radice sopra i figli
        after.b === after.c &&                              // fratelli stessa riga
        after.b < after.d && after.b < after.e &&           // figli sopra i nipoti
        after.c < after.f;
    ok(okHier, tag + ' y gerarchiche dopo >=550ms: y(root)<y(figli)<y(nipoti)',
        JSON.stringify(after));
    ok(guideLines(env).length === 0, tag + ' nessuna guida (albero guide=null)', 'n=' + guideLines(env).length);
    ok(edgeGroups(env).length === 5, tag + ' DOM .sc-edge == 5 (archi invariati)', 'dom=' + edgeGroups(env).length);
    ok($$(env, '[data-nid]').length === 6, tag + ' DOM nodi == 6 (nodi invariati)', 'n=' + $$(env, '[data-nid]').length);

    await saveNow(env);
    const d = docOf(env, id);
    ok(d.type === 'albero', tag + ' dopo flush: content.type === \'albero\'', d.type);
    ok(d.nodes.length === 6 && d.edges.length === 5, tag + ' dopo flush: 6 nodi / 5 archi invariati',
        d.nodes.length + '/' + d.edges.length);
    const raw = rawContent(env, id);
    const flagHits = (raw.match(/pendingLegacyLayout|legacyTb/g) || []).length;
    ok(flagHits === 0, tag + ' flag pendingLegacyLayout/legacyTb MAI nel content salvato (grep=0)',
        'hits=' + flagHits);
    return env;
}

// ===============================================================
// PUNTO 4 — Rollback sicuro / casi limite
// ===============================================================
async function p4_edgeCases() {
    console.log('\n== PUNTO 4 — rollback sicuro / casi limite ==');
    // (a) doc legacy con nodi vuoti
    const env = makeEnv();
    const id = addItem(env, baseDoc('tb', [], []), 'Legacy vuoto');
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    let opened = false;
    try {
        env.mod.open(cont, { open: id });
        await sleep(700); // > timer 60ms + animazione
        opened = !!(selType(env));
    } catch (e) {
        ok(false, 'P4a doc legacy nodi vuoti: apertura senza eccezione', String(e));
    }
    if (opened) {
        ok(selType(env).value === 'albero', 'P4a doc legacy vuoto aperto come albero, nessun errore (autoLayout ritorna in silenzio: !nodes.length)',
            selType(env).value);
    }
    // (c) flag mai persistita anche nel caso vuoto
    await saveNow(env);
    const raw = rawContent(env, id);
    ok(!/pendingLegacyLayout|legacyTb/.test(raw), 'P4c content JSON vuoto: grep pendingLegacyLayout|legacyTb = 0',
        (raw.match(/pendingLegacyLayout|legacyTb/g) || []).length + ' hits');

    // (b) log dell'apertura legacy (tutti gli env finora): zero eccezioni non gestite
    const real = realLogs();
    ok(real.length === 0, 'P4b zero eccezioni/log errati non-filtrati durante aperture legacy',
        real.length ? JSON.stringify(real.slice(0, 5)) : '0 (noise jsdom filtrato: ' + (vcLogs.length - real.length) + ' righe)');
    console.log('    log catturati totali=' + vcLogs.length + ' reali=' + real.length +
        ' (filtrati noise css/notImplemented=' + (vcLogs.length - real.length) + ')');

    // difesa: getStrategy('tb') -> fallback libero
    const env2 = makeEnv();
    const sTb = env2.win.SchemaStrategies.getStrategy('tb');
    const sAb = env2.win.SchemaStrategies.getStrategy('alto-basso');
    ok(sTb && sTb.id === 'libero', 'P4 difesa: getStrategy(\'tb\') -> fallback libero', sTb && sTb.id);
    ok(sAb && sAb.id === 'libero', 'P4 difesa: getStrategy(\'alto-basso\') -> fallback libero', sAb && sAb.id);
    const nStrat = Object.keys(env2.win.SchemaStrategies.SCHEMA_STRATEGIES).length;
    ok(nStrat === 5, 'P4 SCHEMA_STRATEGIES = 5 tipi (registro ripulito)', 'n=' + nStrat +
        ' ids=' + Object.keys(env2.win.SchemaStrategies.SCHEMA_STRATEGIES).join(','));
}

// ===============================================================
// PUNTO 5 — Sweep citazioni residue del tipo rimosso
// ===============================================================
// copre: "Alto → basso", "alto→basso", "alto-basso", "T→B" (+ varianti ASCII "->"
// ed escape sorgente \u2192), case-insensitive.
const BAD = /alto\s*(?:\u2192|->|\\u2192)\s*basso|alto-basso|t\s*(?:\u2192|->|\\u2192)\s*b/i;
function sweepFile(rel) {
    const p = path.join(ROOT, rel);
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    const hits = [];
    lines.forEach((l, i) => { if (BAD.test(l)) hits.push({ n: i + 1, line: l.trim() }); });
    return hits;
}
function p5_sweep() {
    console.log('\n== PUNTO 5 — sweep citazioni residue ==');
    // 5a: docs che NON devono mai citare il tipo
    ['MODULI.md', 'NOTE.md', 'PIANO_INTERFACCIA.md', 'README.md'].forEach(f => {
        const hits = sweepFile(f);
        ok(hits.length === 0, 'P5 ' + f + ': zero citazioni ATTIVE del tipo rimosso',
            hits.length ? JSON.stringify(hits.slice(0, 3)) : '0 hit');
        if (hits.length) hits.forEach(h => console.log('      L' + h.n + ': ' + h.line));
    });

    // 5b: MODULI.md riporta 5 tipi
    const moduli = fs.readFileSync(path.join(ROOT, 'MODULI.md'), 'utf8');
    ok(/Tipi \(5\)/i.test(moduli) &&
        /albero/i.test(moduli) && /mappa concettuale/i.test(moduli) &&
        /sinistra/i.test(moduli) && /schema libero/i.test(moduli) && /riassunto visuale/i.test(moduli),
        'P5 MODULI.md riporta 5 tipi (albero, mappa concettuale, sinistra→destra, schema libero, riassunto visuale)');
    const moduliLine = moduli.split(/\r?\n/).filter(l => /Tipi \(5\)/i.test(l))[0];
    if (moduliLine) console.log('    MODULI.md: ' + moduliLine.trim());

    // 5c: MODIFICHE.md — storico intatto + sezione Round 5
    const mod = fs.readFileSync(path.join(ROOT, 'MODIFICHE.md'), 'utf8');
    const modLines = mod.split(/\r?\n/);
    /* Round 9+: le nuove voci si appendono IN CIMA allo storico, quindi la voce
       round 2 non e' piu' in riga 1 ma deve restare presente e prima di ROUND 3. */
    const r2line = modLines.findIndex(l => /# MODIFICHE.*round 2/i.test(l));
    /* ALLINEAMENTO R31: regex ANCORATA a inizio riga — la versione
       senza ^ combaciava "## Round 30" (voce R30 prependuta il 04/11 DOPO
       l'ultimo T1 del 02/11) e falliva il confronto con la voce round 2.
       L'intento documentato (riga 404) e' il TITOLO "# ROUND 3". */
    ok(r2line >= 0 && r2line < modLines.findIndex(l => /^# ROUND 3/i.test(l)),
        'P5 MODIFICHE.md storico preesistente: voce round 2 presente e prima della ROUND 3',
        'linea ' + (r2line + 1) + ': ' + (modLines[r2line] || ''));
    ok(modLines.some(l => /^# ROUND 3/i.test(l)), 'P5 MODIFICHE.md storico: voce ROUND 3 presente');
    ok(modLines.some(l => /## Round 4/i.test(l)), 'P5 MODIFICHE.md storico: voce Round 4 presente');
    ok(modLines.some(l => /## Round 5/i.test(l)), 'P5 MODIFICHE.md: sezione "Round 5" appendita');
    const r5 = modLines.filter(l => /## Round 5/i.test(l))[0];
    if (r5) console.log('    ' + r5.trim());
    const modHits = sweepFile('MODIFICHE.md');
    const r5start = modLines.findIndex(l => /## Round 5/i.test(l));
    const storicoHits = modHits.filter(h => h.n <= r5start);
    const round5Hits = modHits.filter(h => h.n > r5start);
    ok(storicoHits.length > 0, 'P5 MODIFICHE.md: residui AMMESSI confermati nello storico preesistente (round 2/3)',
        storicoHits.length + ' righe (es. L' + storicoHits[0].n + ')');
    console.log('    MODIFICHE.md residui storici (AMMESSI): ' + storicoHits.map(h => 'L' + h.n).join(',') +
        ' | residui dentro Round 5 (testuale/dichiarativo): ' + (round5Hits.length ? round5Hits.map(h => 'L' + h.n).join(',') : '0'));

    // 5d: schemi.js — solo commenti/id di migrazione ammessi, ZERO testi utente
    const schLines = SRC_SCHEMI.split(/\r?\n/);
    const schHits = [];
    schLines.forEach((l, i) => { if (BAD.test(l)) schHits.push({ n: i + 1, line: l.trim() }); });
    console.log('    schemi.js hit sweep:');
    schHits.forEach(h => console.log('      L' + h.n + ': ' + h.line.slice(0, 140)));
    const ACTIVE_CODE = /\/\/|\/\*|d\.type === |legacyTb|pendingLegacyLayout|BLOCCO 3\.3/;
    const active = schHits.filter(h => !ACTIVE_CODE.test(h.line));
    ok(active.length === 0, 'P5 schemi.js: nessuna citazione ATTIVA (solo commenti/id migrazione \'tb\'/\'alto-basso\' ammessi)',
        active.length ? JSON.stringify(active.slice(0, 3)) : schHits.length + ' righe, tutte commento/codice migrazione');

    // 5d-bis: testi UTENTE (hint/title/toast/placeholder/aria) -> zero
    const USER_CTX = /toast\(|placeholder|\.title\s*=|aria-|hint\.|textContent\s*=|App\.header\(/;
    const userHits = schHits.filter(h => USER_CTX.test(h.line) && !/\/\//.test(h.line));
    ok(userHits.length === 0, 'P5 schemi.js testi UTENTE (hint/title/toast/placeholder/aria): zero citazioni',
        userHits.length ? JSON.stringify(userHits.slice(0, 3)) : '0');

    // 5e: schemaStrategies.js — residui solo commento/direzione 'tb'
    const stLines = SRC_STRAT.split(/\r?\n/);
    const stHits = [];
    stLines.forEach((l, i) => { if (BAD.test(l)) stHits.push({ n: i + 1, line: l.trim() }); });
    console.log('    schemaStrategies.js hit sweep: ' + (stHits.length ? JSON.stringify(stHits.map(h => 'L' + h.n)) : '0'));
    const stActive = stHits.filter(h => !/\/\/|\/\*|tidyTreeTargets\(nodes, edges, 'tb'\)|dir === /.test(h.line));
    ok(stActive.length === 0, 'P5 schemaStrategies.js: residui solo commento/parametro direzione \'tb\' (ammesso: NON è il tipo)',
        stActive.length ? JSON.stringify(stActive.slice(0, 3)) : stHits.length + ' righe commento/direzione');

    // residui ammessi confermati — elenco esplicito
    console.log('    [residui AMMESSI confermati]: storico MODIFICHE round2/3 (L' +
        storicoHits.map(h => h.n).join(',L') + '); commenti migrazione schemi.js L' +
        schHits.map(h => h.n).join(',L') + "; direzione 'tb' schemaStrategies (parametro tidyTreeTargets); test/patch.");
}

// ===============================================================
// PUNTO 6 — Regressioni complete
// ===============================================================
function runSuite(file, expected) {
    let out = '', err = '';
    let crashed = null;
    try {
        out = execFileSync(process.execPath, [path.join(ROOT, 'tests', file)], {
            cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
        });
    } catch (e) {
        crashed = true;
        out = String(e.stdout || '');
        err = String(e.stderr || '');
    }
    const m = /RISULTATI[^:]*:\s*(\d+)\s*passati,\s*(\d+)\s*falliti/.exec(out);
    const got = m ? { p: +m[1], f: +m[2] } : null;
    const name = crashed ? (out.slice(0, 400) || err.slice(0, 400)) : '';
    ok(!!got && got.p === expected && got.f === 0,
        'P6 ' + file + ' → ' + expected + '/' + expected,
        got ? got.p + '/' + (got.p + got.f) + (got.f ? ' FALLITI=' + out.split('\n').filter(l => /FAIL|FALLITI/.test(l)).slice(0, 5).join(' | ') : '') : ('output non interpretabile: ' + name));
    if (got) console.log('    ' + file + ': ' + got.p + ' passati, ' + got.f + ' falliti');
    return out;
}
function countOcc(hay, needle) { return hay.split(needle).length - 1; }

async function p6_regression() {
    console.log('\n== PUNTO 6 — regressioni complete ==');
    // 6a suite
    runSuite('editorWiring.test.js', 49);
    runSuite('schemaStrategies.test.js', 198);
    const uiOut = runSuite('uiHarness.test.js', 197);
    // citazione esito scenarioLegacyTb (copertura caso 'tb'): tutte le
    // righe di esito che la sezione BLOCCO 3.3 emette (10 ok() nello scenario)
    const legacyLines = uiOut.split('\n').filter(l => /^\s*(PASS|FAIL)\s+3\.3/.test(l));
    console.log('    [citazione uiHarness scenarioLegacyTb/caso tb]:');
    legacyLines.forEach(l => console.log('      ' + l.trim()));
    const lPass = legacyLines.filter(l => /^\s*PASS/.test(l)).length;
    const lFail = legacyLines.filter(l => /^\s*FAIL/.test(l)).length;
    ok(lPass >= 10 && lFail === 0,
        'P6 scenarioLegacyTb (type tb) in uiHarness: tutti PASS, zero FAIL',
        lPass + ' PASS / ' + lFail + ' FAIL');
    runSuite('qa1_block1.js', 65);
    runSuite('qa2_block2.js', 79);

    // 6b node --check x2
    [['schemi.js'], ['schemaStrategies.js']].forEach(([f]) => {
        let okc = true, msg = 'OK';
        try { execFileSync(process.execPath, ['--check', M(f)], { encoding: 'utf8', stdio: 'pipe' }); }
        catch (e) { okc = false; msg = String(e.stderr || e).slice(0, 200); }
        ok(okc, 'P6 node --check ' + f, msg);
    });

    // 6c grep vincoli congelati
    const cAnim = countOcc(SRC_SCHEMI, 'animateLayout(targets, 200)');
    ok(cAnim === 2, 'P6 grep: animateLayout(targets, 200) esattamente 2 in schemi.js', 'n=' + cAnim);
    const cMig = countOcc(SRC_SCHEMI, 'migrateSchema(ed.doc, nuovo)');
    ok(cMig === 1, 'P6 grep: migrateSchema(ed.doc, nuovo) esattamente 1', 'n=' + cMig);
    const cChg = countOcc(SRC_SCHEMI, 'changeType(selType.value)');
    ok(cChg === 1, 'P6 grep: changeType(selType.value) esattamente 1', 'n=' + cChg);
    const cMappa = countOcc(SRC_SCHEMI, "doc.type === 'mappa'") + countOcc(SRC_STRAT, "doc.type === 'mappa'");
    ok(cMappa === 0, 'P6 grep: zero doc.type === \'mappa\' (schemi.js + schemaStrategies.js)', 'n=' + cMappa);
    const cDir = countOcc(SRC_STRAT, "tidyTreeTargets(nodes, edges, 'tb')");
    ok(cDir >= 1, 'P6 grep: albero usa ancora tidyTreeTargets(nodes, edges, \'tb\') come DIREZIONE (parametro intatto)',
        'n=' + cDir + ' (attese 2: initialLayout + autoLayout)');
}

// ===============================================================
async function main() {
    try {
        await p1_chooser();
        await p2_typeSel();
        console.log('\n== PUNTO 3 — doc legacy "alto-basso" (alias difensivo) ==');
        await p3_legacyAltoBasso('[alto-basso]', 'alto-basso');
        await p4_edgeCases();
        p5_sweep();
        await p6_regression();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.log('  ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    }
    console.log('\n================================================');
    console.log('RISULTATI QA3: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}

main();
