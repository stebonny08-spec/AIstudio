'use strict';
/* tests/s19_routing.test.js - R19 BLOCCO S / QA-S: test geometrici T1 sul
   routing C1-C11. Verifica la BUILD (node --check), orchestra l'esecuzione
   reale qa_browser/qaS19_routing.js (Chromium/puppeteer: PRIMA con la copia
   baseline + DOPO con il codice attuale) e asserta le chiavi di
   qa/r19_s_measures.json: 0 intersezioni arco-nodo, punte freccia <=2px,
   <=4 segmenti, ortogonalita totale sulle polilinee, ancore da tabella,
   struttura C1-C11, casi tutti presenti + screenshot PRIMA/DOPO.
   Esecuzione: node tests/s19_routing.test.js */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}

/* 1) build: node --check su moduli e QA browser */
for (const f of ['web_frontend/html/js/modules/schemi.js',
    'web_frontend/html/js/modules/schemaStrategies.js',
    'qa_browser/qaS19_routing.js']) {
    const r = spawnSync('node', ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    ok(r.status === 0, '0.0 node --check ' + path.basename(f), (r.stderr || '').slice(0, 200));
}

/* 2) esecuzione misura geometrica REALE (prima baseline + dopo attuale) */
const run = spawnSync('node', [path.join(ROOT, 'qa_browser', 'qaS19_routing.js'), 'all'],
    { encoding: 'utf8', timeout: 300000, cwd: ROOT });
ok(run.status === 0, '1.0 qaS19_routing.js all eseguito',
    ((run.stdout || '') + (run.stderr || '')).slice(-500));

let m = null;
try {
    m = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa', 'r19_s_measures.json'), 'utf8'));
} catch (e) { /* sotto */ }
ok(!!m && !!m.prima && !!m.dopo, '2.0 measures PRIMA e DOPO presenti',
    m ? Object.keys(m).join(',') : 'file assente');

const KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'curva', 'real'];
const FIXED = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'curva'];

if (m && m.prima && m.dopo) {
    const P = m.prima, D = m.dopo;

    /* 3) casi tutti presenti (C1-C11 + curva + reale) */
    KEYS.forEach(k => ok(!!(D.cases && D.cases[k] && !D.cases[k].error),
        '3.0 caso ' + k + ' presente in dopo',
        D.cases && D.cases[k] ? JSON.stringify(D.cases[k]).slice(0, 120) : 'assente'));

    /* 4) per-caso: ogni arco supera TUTTI gli assert geometrici */
    KEYS.forEach(k => {
        const c = D.cases[k];
        if (!c) return;
        const nEdge = (c.edges || []).length;
        ok(nEdge >= 1, '4.0 ' + k + ': archi misurati', 'n=' + nEdge);
        ok((c.coppie_violate || []).length === 0, '4.1 ' + k + ': coppie gap 32/48 violate = 0',
            JSON.stringify(c.coppie_violate || []));
        ok((c.nodi_mancanti || []).length === 0, '4.2 ' + k + ': nessun nodo mancante',
            JSON.stringify(c.nodi_mancanti || []));
        (c.edges || []).forEach(e => {
            const tag = k + '/' + e.eid;
            ok(e.anchorOk === true, '4.3 ' + tag + ': ancore da tabella (<=0.75px)',
                JSON.stringify(e.anchor));
            ok((e.inter || []).length === 0, '4.4 ' + tag + ': 0 intersezioni con nodi non-endpoint',
                JSON.stringify(e.inter));
            ok(e.tipOk === true, '4.5 ' + tag + ': punta freccia <=2px', 'dist=' + e.tipDist);
            ok(e.segsOk === true && e.segs <= 4, '4.6 ' + tag + ': segmenti <=4', 'segs=' + e.segs);
            if (!e.isQ) {
                ok(e.orthoOk === true, '4.7 ' + tag + ': tutti i segmenti ortogonali',
                    'nonOrto=' + e.nonOrto);
                ok(e.orientOk === true, '4.8 ' + tag + ': orientamento ultimo segmento coerente');
            }
            ok(e.qOk === true, '4.9 ' + tag + ': curva keep/fall coerente', 'q=' + e.qOk);
            if (FIXED.indexOf(k) >= 0) {
                ok(e.casoOk === true && e.caso === e.exp, '4.10 ' + tag + ': struttura caso',
                    'render=' + e.caso + ' exp=' + e.exp);
            } else {
                ok(e.casoOk === true, '4.10 ' + tag + ': caso nella tabella C1-C11', 'caso=' + e.caso);
            }
        });
    });

    /* 5) C8 bus: orizzontali condivisi */
    if (D.cases && D.cases.c8 && D.cases.c8.bus) {
        ok(D.cases.c8.bus.ok === true && D.cases.c8.bus.y !== null,
            '5.0 C8: bus con gapY identico per tutti i figli',
            JSON.stringify(D.cases.c8.bus));
    } else ok(false, '5.0 C8: bus rilevato');

    /* 6) curva: Q mantenuta quando libera, router ortogonale quando interseca */
    if (D.cases && D.cases.curva) {
        const eq = (D.cases.curva.edges || []).filter(e => e.eid === 'eq')[0];
        const eh = (D.cases.curva.edges || []).filter(e => e.eid === 'eh')[0];
        ok(!!eq && eq.isQ === true, '6.0 curva Q mantenuta quando libera', eq ? eq.d : 'assente');
        ok(!!eh && eh.isQ === false && eh.inter.length === 0 && eh.orthoOk === true,
            '6.1 curva intersecante caduta su router ortogonale',
            eh ? (eh.d + ' caso=' + eh.caso) : 'assente');
    }

    /* 7) totali DOPO: tutti gli zeri vincolanti */
    const t = D.totale;
    ok(t.intersezioni === 0 && t.intersezioni_tot === 0, '7.0 dopo: intersezioni arco-nodo = 0',
        'n=' + t.intersezioni);
    ok(t.punte_oltre_2px === 0 && t.punte_totali >= 20, '7.1 dopo: punte freccia oltre2px = 0',
        t.punte_oltre_2px + '/' + t.punte_totali);
    ok(t.non_ortogonali === 0, '7.2 dopo: segmenti non ortogonali = 0', 'n=' + t.non_ortogonali);
    ok(t.segmenti_oltre4 === 0, '7.3 dopo: archi con >4 segmenti = 0', 'n=' + t.segmenti_oltre4);
    ok(t.anchor_fail === 0, '7.4 dopo: ancore fuori tabella = 0', 'n=' + t.anchor_fail);
    ok(t.orient_fail === 0, '7.5 dopo: orientamento punta errato = 0', 'n=' + t.orient_fail);
    ok(t.caso_fail === 0, '7.6 dopo: struttura C1-C11 errata = 0', 'n=' + t.caso_fail);
    ok(t.q_fail === 0, '7.7 dopo: curva keep/fall errata = 0', 'n=' + t.q_fail);
    ok(t.coppie_violate === 0, '7.8 dopo: coppie nodi con gap <32/<48 = 0', 'n=' + t.coppie_violate);
    ok(t.nodi_mancanti === 0, '7.9 dopo: nodi persi = 0');
    ok(t.casi_ok === KEYS.length && t.casi >= KEYS.length,
        '7.10 dopo: tutti i casi ok (' + KEYS.length + ')', 'ok=' + t.casi_ok + '/' + t.casi);

    /* 8) PRIMA = baseline reale (misura non-zero sul codice pre-modifica) */
    const pt = P.totale;
    ok((pt.non_ortogonali + pt.intersezioni + pt.caso_fail) > 0,
        '8.0 PRIMA misurata sulla baseline (difetti > 0: la misura e reale)',
        JSON.stringify({ nonOrto: pt.non_ortogonali, inter: pt.intersezioni, caso: pt.caso_fail }));
    ok(pt.archi === t.archi, '8.1 PRIMA e DOPO misurano lo stesso numero di archi',
        pt.archi + ' vs ' + t.archi);

    /* 9) screenshot PRIMA + DOPO per ogni caso */
    let shotP = 0, shotD = 0;
    KEYS.forEach(k => {
        if (fs.existsSync(path.join(ROOT, 'qa', 'r19_s_prima_' + k + '.png'))) shotP++;
        if (fs.existsSync(path.join(ROOT, 'qa', 'r19_s_dopo_' + k + '.png'))) shotD++;
    });
    ok(shotP === KEYS.length, '9.0 screenshot PRIMA (' + KEYS.length + ')', 'n=' + shotP);
    ok(shotD === KEYS.length, '9.1 screenshot DOPO (' + KEYS.length + ')', 'n=' + shotD);
}

console.log('\nRISULTATO s19_routing: ' + pass + ' passati, ' + fail + ' falliti');
if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
