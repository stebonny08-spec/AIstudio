/* ============================================================
   tests/schemaStrategies.test.js
   Verifica dei comportamenti per tipo (TASK 1 + TASK 3 core).
   Eseguire con: node tests/schemaStrategies.test.js
   ============================================================ */
'use strict';
const S = require('../web_frontend/html/js/modules/schemaStrategies.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
function mkNode(id, x, y, text) {
    return { id: id, x: x, y: y, w: 170, h: 60, text: text || id };
}
function mkEdge(from, to) { return { id: from + '>' + to, from: from, to: to }; }
const TYPES = ['albero', 'mappa', 'lr', 'libero', 'riassunto'];

// ---------------------------------------------------------------
console.log('\n== 1.1/1.2 Registro strategie: struttura ==');
ok(S && typeof S.SCHEMA_STRATEGIES === 'object', 'SCHEMA_STRATEGIES esiste');
TYPES.forEach(t => {
    const s = S.SCHEMA_STRATEGIES[t];
    ok(!!s, 'strategia presente: ' + t);
    if (!s) return;
    ['initialLayout', 'autoLayout', 'placeNewNode', 'canConnect', 'edgeStyle', 'snap', 'ui']
        .forEach(m => ok(typeof s[m] === 'function', t + '.' + m + ' è funzione'));
    const es = s.edgeStyle();
    ok(['gomito', 'curva', 'dritta'].indexOf(es.forma) >= 0, t + '.edgeStyle().forma valida', es.forma);
    ok(typeof es.freccia === 'boolean', t + '.edgeStyle().freccia boolean');
    ok(typeof es.etichetta === 'boolean', t + '.edgeStyle().etichetta boolean');
    const ui = s.ui();
    ok(Array.isArray(ui.pulsanti) && ui.pulsanti.length > 0, t + '.ui().pulsanti lista');
    ok(typeof ui.pannelloTesto === 'boolean', t + '.ui().pannelloTesto boolean');
    ok(ui.guide === null || ui.guide === 'colonne' || ui.guide === 'righe', t + '.ui().guide valida');
    const sn = s.snap();
    ok(typeof sn.attivo === 'boolean', t + '.snap().attivo boolean');
});

// ---------------------------------------------------------------
console.log('\n== TASK 4/1 — Albero ==');
{
    const s = S.SCHEMA_STRATEGIES.albero;
    // 6 nodi: a (radice) -> b,c ; b -> d,e ; c -> f
    const nodes = [mkNode('a', 0, 0, 'Radice'), mkNode('b', 0, 0), mkNode('c', 0, 0),
        mkNode('d', 0, 0), mkNode('e', 0, 0), mkNode('f', 0, 0)];
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('b', 'e'), mkEdge('c', 'f')];
    const t = s.autoLayout(nodes, edges);
    const by = {}; nodes.forEach(n => by[n.id] = n);
    // layout gerarchico: righe per profondità
    ok(t['a'].y < t['b'].y && t['b'].y < t['d'].y, 'albero: profondità = righe crescenti');
    ok(t['a'].y < t['c'].y && t['c'].y < t['f'].y, 'albero: ramo c→f più in basso');
    // fratelli centrati sotto il padre (stessa x per b,c sotto a; d,e sotto b)
    const ca = t['a'].x + 85, cb = t['b'].x + 85, cc = t['c'].x + 85;
    ok(Math.abs((cb + cc) / 2 - ca) < 26, 'albero: fratelli b,c centrati sotto il padre a',
        'centro padre=' + ca.toFixed(1) + ' media figli=' + ((cb + cc) / 2).toFixed(1));
    const cd = t['d'].x + 85, ce = t['e'].x + 85;
    ok(Math.abs((cd + ce) / 2 - (cb)) < 26, 'albero: d,e centrati sotto b');
    ok(t['a'].y === Math.min.apply(null, nodes.map(n => t[n.id].y)), 'albero: radice in cima');

    // secondo padre rifiutato con motivo leggibile
    const graph = { nodes: nodes, edges: edges };
    const r1 = s.canConnect('a', 'd', graph); // d già figlio di b
    ok(!r1.ok, 'albero: secondo padre rifiutato');
    ok(!!r1.motivo && /solo padre/.test(r1.motivo), 'albero: motivo leggibile (secondo padre)', r1.motivo);
    // ciclo rifiutato (d→a: a è antenato di d)
    const r2 = s.canConnect('d', 'a', graph);
    ok(!r2.ok, 'albero: ciclo rifiutato');
    ok(!!r2.motivo && /ciclo/.test(r2.motivo), 'albero: motivo leggibile (ciclo)', r2.motivo);
    // collegamento valido: f→nuovo o a→nuovo
    ok(s.canConnect('a', 'x', graph).ok, 'albero: primo padre consentito');
    // self + dup
    ok(!s.canConnect('a', 'a', graph).ok, 'albero: self-loop rifiutato');
    ok(!s.canConnect('a', 'b', graph).ok, 'albero: duplicato rifiutato');
    // edgeStyle: gomito, freccia, NO etichetta
    const es = s.edgeStyle();
    ok(es.forma === 'gomito' && es.freccia && !es.etichetta, 'albero: archi a gomito senza etichetta');
    // pulsanti figlio/fratello
    const ids = s.ui().pulsanti.map(p => p.id);
    ok(ids.indexOf('child') >= 0 && ids.indexOf('sibling') >= 0, 'albero: pulsanti +Figlio/+Fratello');
    // placeNewNode figlio sotto il padre
    const p = s.placeNewNode(nodes[0], graph, 'figlio');
    ok(p.y > nodes[0].y + nodes[0].h, 'albero: nuovo figlio posizionato sotto il padre');
    // initialLayout
    const n2 = [mkNode('r', 0, 0), mkNode('q', 500, 400)];
    s.initialLayout(n2, [mkEdge('r', 'q')]);
    ok(n2[0].y < n2[1].y, 'albero: initialLayout gerarchico');
}

// ---------------------------------------------------------------
console.log('\n== TASK 4/1 — Mappa concettuale ==');
{
    const s = S.SCHEMA_STRATEGIES.mappa;
    const es = s.edgeStyle();
    ok(es.forma === 'curva', 'mappa: archi curvi');
    ok(es.etichetta === true, 'mappa: etichetta presente (modificabile)');
    ok(es.freccia === true, 'mappa: frecce presenti');
    // ciclo permesso
    const nodes = [mkNode('a', 0, 0), mkNode('b', 0, 0), mkNode('c', 0, 0)];
    const edges = [mkEdge('a', 'b'), mkEdge('b', 'c')];
    const graph = { nodes: nodes, edges: edges };
    const r = s.canConnect('c', 'a', graph);
    ok(r.ok, 'mappa: ciclo permesso', r.motivo);
    ok(!s.canConnect('a', 'a', graph).ok, 'mappa: self-loop rifiutato');
    ok(!s.canConnect('a', 'b', graph).ok, 'mappa: duplicato rifiutato');
    // force/radiale: hub al centro, altri attorno
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => mkNode(id, 100 + i * 30, 100 + i * 20));
    const sixE = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('a', 'd'), mkEdge('a', 'e'), mkEdge('a', 'f')];
    s.hubId = 'a';
    const t = s.autoLayout(six, sixE);
    const hub = t['a'];
    const dHub = id => Math.hypot(t[id].x + 85 - (hub.x + 85), t[id].y + 30 - (hub.y + 30));
    const others = ['b', 'c', 'd', 'e', 'f'].map(dHub);
    ok(Math.min.apply(null, others) > 60, 'mappa: radialità (hub separato dagli altri)', 'min d=' + Math.min.apply(null, others).toFixed(0));
    ok(Math.max.apply(null, others) - Math.min.apply(null, others) < 260, 'mappa: nodi su anello (distanze simili)',
        'min=' + Math.min.apply(null, others).toFixed(0) + ' max=' + Math.max.apply(null, others).toFixed(0));
    s.hubId = null;
    // posizionamento manuale preservato da initialLayout
    const man = [mkNode('a', 333, 777)];
    s.initialLayout(man, []);
    ok(man[0].x === 333 && man[0].y === 777, 'mappa: initialLayout preserva il manuale');
    // pulsanti: niente figlio/fratello
    const ids = s.ui().pulsanti.map(p => p.id);
    ok(ids.indexOf('child') >= 0 && ids.indexOf('sibling') >= 0 && ids.indexOf('node') < 0,
        'mappa: matrice aggiunta (+Figlio/+Fratello, niente +Nodo)');
}

// ---------------------------------------------------------------
console.log('\n== TASK 4/1 — Sinistra→destra ==');
{
    const s = S.SCHEMA_STRATEGIES.lr;
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => mkNode(id, 0, 0));
    const edges = [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd'), mkEdge('c', 'e'), mkEdge('d', 'f')];
    const t = s.autoLayout(nodes, edges);
    // colonne crescenti per layer: a=0, b/c=1, d/e=2, f=3
    ok(t['a'].x < t['b'].x && t['b'].x < t['d'].x && t['d'].x < t['f'].x, 'lr: colonne crescenti lungo il flusso');
    ok(t['b'].x === t['c'].x, 'lr: b e c impilati nella stessa colonna');
    // nodi impilati nella colonna (diverse y)
    ok(t['b'].y !== t['c'].y, 'lr: nodi della colonna impilati in y');
    // edgeStyle: dritta con freccia (l'arco indietro diventa curva nel renderer via asseFlusso)
    const es = s.edgeStyle();
    ok(es.forma === 'dritta' && es.freccia, 'lr: frecce con punta, archi dritti avanti');
    ok(s.asseFlusso === 'x', 'lr: asse flusso x (arco indietro → curva)');
    ok(s.ui().guide === 'colonne', 'lr: guide verticali colonne');
    // placeNewNode figlio → colonna successiva (nodi già come dopo l'auto-layout)
    nodes.forEach(n => { n.x = t[n.id].x; n.y = t[n.id].y; });
    const graph = { nodes: nodes, edges: edges };
    const p = s.placeNewNode(nodes[0], graph, 'figlio'); // a
    ok(p.x > t['a'].x, 'lr: nuovo figlio nella colonna successiva', p.x + ' vs ' + t['a'].x);
}

// ---------------------------------------------------------------
console.log('\n== TASK 4/1 (BLOCCO 3): Alto -> basso rimosso ==');
{
    ok(S.SCHEMA_STRATEGIES.tb === undefined, 'registro: SCHEMA_STRATEGIES.tb rimosso');
    const fb = S.getStrategy('tb');
    ok(fb === S.SCHEMA_STRATEGIES.libero, "getStrategy('tb') fallback libero");
    const restanti = ['albero', 'mappa', 'lr', 'libero', 'riassunto'];
    ok(restanti.every(t => !!S.SCHEMA_STRATEGIES[t]), '5 tipi restanti tutti presenti');
    const extra = Object.keys(S.SCHEMA_STRATEGIES).filter(t => restanti.indexOf(t) < 0);
    ok(Object.keys(S.SCHEMA_STRATEGIES).length === 5 && extra.length === 0,
        'registro: esattamente 5 tipi (nessun residuo tb)', extra.join(','));
    ok(TYPES.length === 5 && TYPES.indexOf('tb') < 0, 'TYPES test: 5 voci senza tb');
}

// ---------------------------------------------------------------
console.log('\n== TASK 4/1 — Schema libero ==');
{
    const s = S.SCHEMA_STRATEGIES.libero;
    const nodes = [mkNode('a', 111, 222), mkNode('b', 777, 55), mkNode('c', 40, 900)];
    const edges = [mkEdge('a', 'b')];
    ok(s.autoLayout(nodes, edges) === null, 'libero: auto-layout disabilitato (null)');
    const sn = s.snap();
    ok(sn.attivo === false, 'libero: snap disattivato');
    const ui = s.ui();
    ok(ui.guide === null, 'libero: nessuna guida');
    const lay = ui.pulsanti.filter(p => p.id === 'layout')[0];
    ok(lay && lay.disabilitato === true && !!lay.tooltip, 'libero: pulsante auto-layout grigio + tooltip');
    const arco = ui.pulsanti.filter(p => p.id === 'arco' && p.tipo === 'select')[0];
    ok(!!arco, 'libero: scelta forma arco (dritto/curvo/gomito)');
    // nessun vincolo topologico
    const g = { nodes: [mkNode('x', 0, 0), mkNode('y', 0, 0), mkNode('z', 0, 0)], edges: [mkEdge('x', 'y'), mkEdge('y', 'z')] };
    ok(s.canConnect('z', 'x', g).ok, 'libero: ciclo consentito');
    ok(s.canConnect('y', 'x', g).ok, 'libero: secondo padre consentito');
    // forma arco a scelta
    ok(s.edgeStyle().forma === 'dritta', 'libero: arco dritto default');
    s.opzioni = { arco: 'curva' };
    ok(s.edgeStyle().forma === 'curva', 'libero: forma arco personalizzabile');
    s.opzioni = { arco: 'gomito' };
    ok(s.edgeStyle().forma === 'gomito', 'libero: forma arco gomito');
    s.opzioni = {};
    // initialLayout preserva
    const man = [mkNode('a', 5, 9)];
    s.initialLayout(man, []);
    ok(man[0].x === 5 && man[0].y === 9, 'libero: initialLayout invariato');
}

// ---------------------------------------------------------------
console.log('\n== TASK 4/1 — Riassunto visuale ==');
{
    const s = S.SCHEMA_STRATEGIES.riassunto;
    const ui = s.ui();
    ok(ui.pannelloTesto === true, 'riassunto: pannello testo affiancato');
    ok(s.vistaCard === true, 'riassunto: nodi come card multilinea (titolo+corpo)');
    const ns = s.nodeSize();
    ok(ns.w >= 240 && ns.h >= 80, 'riassunto: card larghe/alte', ns.w + 'x' + ns.h);
    // archi facoltativi: quasi tutto consentito
    const g = { nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0)], edges: [] };
    ok(s.canConnect('a', 'b', g).ok, 'riassunto: arco facoltativo consentito');
    // stack verticale
    const nodes = [mkNode('a', 500, 400), mkNode('b', 10, 10), mkNode('c', 99, 50)];
    const t = s.autoLayout(nodes, []);
    const ys = ['a', 'b', 'c'].map(id => t[id].y).sort((p, q) => p - q);
    const xs = [t['a'].x, t['b'].x, t['c'].x];
    ok(xs.every(x => x === xs[0]), 'riassunto: stack a colonna (stessa x)');
    ok(new Set(ys).size === 3 && ys[0] === 80 && ys[2] >= ys[1] + 60 && ys[1] >= ys[0] + 60,
        'riassunto: y crescenti senza sovrapposizioni (stack)', ys.join(','));
    ok(s.edgeStyle().freccia === false && s.edgeStyle().forma === 'dritta', 'riassunto: archi semplici senza frecce');
    // placeNewNode sotto il padre
    const p = s.placeNewNode(nodes[0], { nodes: nodes, edges: [] }, 'figlio');
    ok(p.y >= nodes[0].y + nodes[0].h, 'riassunto: nuovo nodo impilato sotto');
}

// ---------------------------------------------------------------
console.log('\n== Differenze obbligatorie tra tutti i tipi ==');
{
    const e = TYPES.map(t => S.SCHEMA_STRATEGIES[t].edgeStyle().forma);
    ok(e.length === 5 && e[0] === 'gomito' && e[1] === 'curva' && e[2] === 'dritta' && e[3] === 'dritta' && e[4] === 'dritta',
        'forme arco distinte per tipo', e.join(','));
    ok(S.SCHEMA_STRATEGIES.mappa.edgeStyle().etichetta === true, 'etichetta solo su mappa (1/1)');
    ok(TYPES.filter(t => S.SCHEMA_STRATEGIES[t].edgeStyle().etichetta).length === 1, 'etichetta solo su mappa (tot)');
    ok(TYPES.filter(t => S.SCHEMA_STRATEGIES[t].ui().pannelloTesto).length === 1, 'pannelloTesto solo riassunto');
    ok(S.SCHEMA_STRATEGIES.libero.snap().attivo === false &&
        TYPES.filter(t => !S.SCHEMA_STRATEGIES[t].snap().attivo).length === 1, 'snap attivo in tutti tranne libero');
    ok(S.SCHEMA_STRATEGIES.libero.autoLayout([mkNode('a', 0, 0)], []) === null &&
        TYPES.filter(t => S.SCHEMA_STRATEGIES[t].autoLayout([mkNode('a', 0, 0)], []) === null).length === 1,
        'auto-layout disabilitato solo per libero');
    ok(TYPES.filter(t => S.SCHEMA_STRATEGIES[t].ui().guide).length === 1 &&
        S.SCHEMA_STRATEGIES.lr.ui().guide === 'colonne', 'guide solo lr (colonne; tb rimosso)');
}

// ---------------------------------------------------------------
console.log('\n== TASK 3 — migrateSchema ==');
{
    // 1) albero popolato → mappa: tutto conservato e valido
    const doc = {
        type: 'albero',
        nodes: [mkNode('a', 0, 0, 'A'), mkNode('b', 0, 0, 'B'), mkNode('c', 0, 0, 'C'), mkNode('d', 0, 0, 'D')],
        edges: [mkEdge('a', 'b'), mkEdge('a', 'c'), mkEdge('b', 'd')],
        riassunto: 'x'
    };
    S.migrateSchema(doc, 'mappa');
    ok(doc.type === 'mappa', 'migrate: tipo aggiornato');
    ok(doc.nodes.length === 4 && doc.edges.length === 3, 'migrate: nodi e archi conservati');
    ok(doc.edges.every(e => !e.extra), 'migrate albero→mappa: tutti gli archi validi');
    ok(doc.riassunto === 'x', 'migrate: altri campi intatti');

    // 2) mappa con ciclo → albero: il ciclo diventa extra (tratteggiato)
    const doc2 = {
        type: 'mappa',
        nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0), mkNode('c', 0, 0)],
        edges: [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'a')]
    };
    S.migrateSchema(doc2, 'albero');
    ok(doc2.type === 'albero', 'migrate: mappa→albero tipo');
    ok(doc2.nodes.length === 3 && doc2.edges.length === 3, 'migrate: contenuto conservato');
    ok(doc2.edges.filter(e => e.extra).length === 1, 'migrate: 1 arco non valido marcato extra',
        JSON.stringify(doc2.edges.map(e => ({ f: e.from, t: e.to, x: !!e.extra }))));
    ok(doc2.edges.filter(e => e.extra)[0].from === 'c', 'migrate: è il ciclo c→a a diventare extra');
    ok(!!doc2.edges.filter(e => e.extra)[0].extraMotivo, 'migrate: motivo salvato sull’arco extra');

    // 3) mappa con doppio padre → albero: solo il secondo arco diventa extra
    //    (in lr il doppio padre è legittimo: non è un vincolo di quel tipo)
    const doc3 = {
        type: 'mappa',
        nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0), mkNode('c', 0, 0), mkNode('d', 0, 0)],
        edges: [mkEdge('a', 'b'), mkEdge('c', 'b'), mkEdge('a', 'd')] // b ha due padri
    };
    S.migrateSchema(doc3, 'albero');
    ok(doc3.edges.filter(e => e.extra).length === 1, 'migrate: doppio padre → 1 extra');
    ok(doc3.edges.filter(e => !e.extra).length === 2, 'migrate: archi validi tenuti');
    const docLr = {
        type: 'albero',
        nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0), mkNode('c', 0, 0)],
        edges: [mkEdge('a', 'b'), mkEdge('c', 'b')]
    };
    S.migrateSchema(docLr, 'lr');
    ok(docLr.edges.filter(e => !e.extra).length === 2, 'migrate → lr: doppio padre ammesso (nessun extra)');

    // 4) rimpatrio albero→mappa: gli extra tornano validi
    S.migrateSchema(doc2, 'mappa');
    ok(doc2.edges.every(e => !e.extra), 'migrate: albero→mappa ripristina gli extra');

    // 5) layout della nuova strategia applicabile ai nodi conservati
    const strat = S.getStrategy(doc3.type);
    const t = strat.autoLayout(doc3.nodes, doc3.edges);
    ok(t && Object.keys(t).length === 4, 'migrate: autoLayout nuova strategia sui nodi conservati');
}

// ---------------------------------------------------------------
console.log('\n== BLOCCO 2 - migrateSchema pulita/idempotente ==');
{
    // (i) sentiero a->b->c->d: valido per TUTTI i tipi; doppia migrazione
    //     deve dare risultato deep-equal (idempotente per costruzione).
    function mkPath() {
        return {
            type: 'albero',
            nodes: [mkNode('a', 10, 10), mkNode('b', 20, 20), mkNode('c', 30, 30), mkNode('d', 40, 40)],
            edges: [mkEdge('a', 'b'), mkEdge('b', 'c'), mkEdge('c', 'd')]
        };
    }
    TYPES.forEach(t => {
        const doc = mkPath();
        S.migrateSchema(doc, t);
        ok(doc.type === t, 'B2 (i) ' + t + ': schema.type aggiornato');
        ok(doc.nodes.length === 4 && doc.edges.length === 3, 'B2 (i) ' + t + ': nodi(4)/archi(3) conservati');
        ok(doc.edges.every(e => !e.extra), 'B2 (i) ' + t + ': sentiero valido (nessun extra)');
        const snap1 = JSON.stringify(doc);
        S.migrateSchema(doc, t);
        ok(JSON.stringify(doc) === snap1, 'B2 (i) ' + t + ': idempotente (2a chiamata deep-equal)');
        ok(doc.extraCount === undefined, 'B2 (i) ' + t + ': schema.extraCount === undefined');
        ok(doc.edges.every(e => !e.extraMotivo), 'B2 (i) ' + t + ': nessun extraMotivo residuo');
    });

    // (ii) mappa con doppio esatto A->B (x2) + reciproco B->A:
    //     in albero il secondo A->B e il reciproco diventano extra CON motivo;
    //     migrando a libero TUTTI tornano validi (reciproco conservato, non perso).
    const dup = {
        type: 'mappa',
        nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0)],
        edges: [
            { id: 'e1', from: 'a', to: 'b' },   // primo A->B: valido
            { id: 'e2', from: 'a', to: 'b' },   // doppio esatto A->B
            { id: 'e3', from: 'b', to: 'a' }    // reciproco (legittimo in mappa)
        ]
    };
    S.migrateSchema(dup, 'albero');
    ok(dup.edges.length === 3, 'B2 (ii): nessun arco perso in migrazione');
    ok(dup.edges[0].extra === undefined && dup.edges[0].extraMotivo === undefined,
        'B2 (ii): primo A->B resta valido (senza motivo)');
    ok(dup.edges[1].extra === true && !!dup.edges[1].extraMotivo,
        'B2 (ii): doppio esatto A->B diventa extra CON extraMotivo', dup.edges[1].extraMotivo);
    ok(dup.edges[2].extra === true && !!dup.edges[2].extraMotivo,
        'B2 (ii): reciproco B->A extra in albero (con motivo)', dup.edges[2].extraMotivo);
    S.migrateSchema(dup, 'libero');
    ok(dup.edges.length === 3, 'B2 (ii) libero: nessun arco perso (reciproco conservato)');
    ok(!dup.edges[0].extra && !dup.edges[2].extra && !dup.edges[2].extraMotivo,
        'B2 (ii) libero: A->B e reciproco B->A tornano validi (no extra/motivo)');
    ok(dup.edges[1].extra === true && !!dup.edges[1].extraMotivo,
        'B2 (ii) libero: doppio esatto resta extra (nessun tipo ammette duplicati esatti, canConnect congelato)',
        dup.edges[1].extraMotivo);
    ok(dup.edges.filter(e =>
        (e.from === 'a' && e.to === 'b') || (e.from === 'b' && e.to === 'a')).length === 3,
        'B2 (ii): 3 archi distinti vivi (A->B x2 + B->A), nessuno eliminato');

    // (ii-b) coppia reciproca PURA A->B + B->A (legittima in mappa):
    //     in albero B->A diventa extra per ciclo; migrando a libero
    //     TUTTI tornano validi (no extra) -> reciproco conservato, non perso.
    const rec = {
        type: 'mappa',
        nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0)],
        edges: [{ id: 'r1', from: 'a', to: 'b' }, { id: 'r2', from: 'b', to: 'a' }]
    };
    S.migrateSchema(rec, 'albero');
    ok(rec.edges[1].extra === true && /ciclo/.test(rec.edges[1].extraMotivo || ''),
        'B2 (ii) albero: reciproco B->A extra per ciclo (con motivo)', rec.edges[1].extraMotivo);
    S.migrateSchema(rec, 'libero');
    ok(rec.edges.length === 2 && rec.edges.every(e => !e.extra && !e.extraMotivo),
        'B2 (ii) libero: TUTTI tornano validi (no extra, no extraMotivo), reciproco non perso');

    // (iii) residui di save vecchi: extraCount persistito nel doc + arco
    //     marcato extra che torna valido: pulizia completa.
    const legacy = {
        type: 'albero',
        extraCount: 5,
        nodes: [mkNode('a', 0, 0), mkNode('b', 0, 0), mkNode('c', 0, 0)],
        edges: [
            { id: 'e1', from: 'a', to: 'b' },
            { id: 'e2', from: 'b', to: 'c' },
            { id: 'e3', from: 'c', to: 'a', extra: true, extraMotivo: 'vecchio motivo' }
        ]
    };
    S.migrateSchema(legacy, 'lr');
    ok(legacy.extraCount === undefined, 'B2 (iii): extraCount assente dopo migrazione');
    ok(!('extraCount' in legacy), 'B2 (iii): chiave extraCount rimossa (non undefined)');
    ok(legacy.edges[2].extra === undefined && legacy.edges[2].extraMotivo === undefined,
        'B2 (iii): arco validato -> extra ed extraMotivo rimossi');
    ok(legacy.edges.length === 3, 'B2 (iii): archi conservati');
}

// ---------------------------------------------------------------
console.log('\n================================================');
console.log('RISULTATI: ' + pass + ' passati, ' + fail + ' falliti');
if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
