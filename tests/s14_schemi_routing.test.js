'use strict';
/* tests/s14_schemi_routing.test.js - R14 BLOCCO S / QA-S: test geometrici
   automatici su TUTTI i tipi (albero, mappa, sx-dx, libero, visuale).
   I calcoli geometrici vivono su DOM SVG REALE (puppeteer:
   path.getPointAtLength, bbox nodi, translate punte): jsdom NON implementa
   getPointAtLength -> il test orchestra e assicura l'esito della misura
   reale qa_browser/qaS14_schemi.js (PRIMA -> DOPO salvati in
   qa/s14_measures.json) + screenshot qa/s14_<tipo>.png.
   Esecuzione: node tests/s14_schemi_routing.test.js */
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

// 1) moduli presenti e sintatticamente validi (node --check)
for (const f of ['web_frontend/html/js/modules/schemi.js',
                 'web_frontend/html/js/modules/schemaStrategies.js']) {
    const r = spawnSync('node', ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    ok(r.status === 0, '0.0 node --check ' + path.basename(f), (r.stderr || '').slice(0, 200));
}

// 2) esecuzione misura geometrica REALE (browser) - chiave "dopo" fresca
const run = spawnSync('node', [path.join(ROOT, 'qa_browser', 'qaS14_schemi.js'), 'dopo'],
    { encoding: 'utf8', timeout: 300000, cwd: ROOT });
ok(run.status === 0, '1.0 qaS14_schemi.js dopo eseguito',
    ((run.stdout || '') + (run.stderr || '')).slice(-400));

let m = null;
try {
    m = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa', 's14_measures.json'), 'utf8'));
} catch (e) { /* ok sotto */ }
ok(!!m && !!m.prima && !!m.dopo, '2.0 measures PRIMA e DOPO presenti',
    m ? Object.keys(m).join(',') : 'file assente');

if (m && m.prima && m.dopo) {
    const pr = m.prima.totale, po = m.dopo.totale;
    // S5(a): nessuna intersezione arco-nodo (eccetto endpoint) dopo il fix
    ok(po.archi_con_intersezione === 0,
        '3.0 archi che intersecano nodi: DOPO = 0',
        'PRIMA=' + pr.archi_con_intersezione + ' DOPO=' + po.archi_con_intersezione);
    ok(pr.archi_con_intersezione > 0,
        '3.1 PRIMA aveva intersezioni (>0): la misura e\' reale',
        'prima=' + pr.archi_con_intersezione);
    // S5(c): zero coppie di nodi sovrapposti (margini 24/40)
    ok(po.coppie_violate === 0,
        '4.0 coppie nodi sovrapposte (24/40): DOPO = 0',
        'PRIMA=' + pr.coppie_violate + ' DOPO=' + po.coppie_violate);
    ok(pr.coppie_violate > 0, '4.1 PRIMA aveva sovrapposizioni (>0)',
        'prima=' + pr.coppie_violate);
    // S5(b): punta freccia <=2px su TUTTI gli archi
    ok(po.punte_oltre_2px === 0 && po.punte_totali > 0,
        '5.0 punte freccia oltre2px: 0/' + po.punte_totali + ' (100% entro 2px)',
        'oltre=' + po.punte_oltre_2px);
    ok(po.punte_pct_oltre_2px === 0, '5.1 percentuale punte oltre2px = 0%');
    // nodi completi (layout senza perdita)
    ok(po.nodi_mancanti === 0, '6.0 nessun nodo perso nel render',
        'mancanti=' + po.nodi_mancanti);
    // 5 tipi coperti
    const ids = (m.dopo.docs || []).map(d => d.type || d.id);
    ok(ids.length >= 5, '7.0 tutti i tipi misurati (albero/mappa/lr/libero/visuale)',
        JSON.stringify(ids));
    // S5(d): dritto di default dove nessun ostacolo (>=1 doc con dritti)
    const drittiTot = (m.dopo.docs || []).reduce((a, d) => a + (d.archi_dritti || 0), 0);
    ok(drittiTot >= 1, '7.1 segmenti RETTILINEI presenti dove nessun ostacolo',
        'dritti=' + drittiTot);
    // screenshot
    const shots = ['albero', 'mappa', 'lr', 'libero', 'riassunto']
        .filter(t => fs.existsSync(path.join(ROOT, 'qa', 's14_' + t + '.png')));
    ok(shots.length >= 5, '8.0 screenshot dei 5 tipi in qa/s14_*.png',
        JSON.stringify(shots));
}

console.log('\nRISULTATO s14_schemi_routing: ' + pass + ' passati, ' + fail + ' falliti');
if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
