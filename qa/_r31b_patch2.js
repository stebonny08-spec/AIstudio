'use strict';
/* qa/_r31b_patch2.js — applica le 4 correzioni QA rimaste aperte di R31b:
   1) Q06: penUp a fine ESTENSIONE (non a x=+60) -> commit line, endpoint ~0, Q11.2 line;
   2) G05 (Q06.11/Q07.8): latenza misurata IN-PAGINA (pointermove -> cambio
      endpoint piano ombra), non con clock nodo/CDP;
   3) Q10: asta sinusoidale "line-safe" (stazioni pixel) + flick V reale di
      4 punti (gambe >=8px, angolo >=100) entro la finestra 250ms.
   Ogni sostituzione deve avere esattamente `count` occurrence, altrimenti ABORT. */
const fs = require('fs');
const path = require('path');
const F = path.resolve(__dirname, '..', 'qa_browser', 'qaR31b_shadow.js');

const G05_HELPERS = [
'    /* G05: latenza in-page movimento -> aggiornamento piano ombra.',
'       Il clock nodo (poll CDP) misura anche la latenza CDP/headless di',
'       quel run; qui si misura performance.now() del pointermove vs il',
'       cambio di endpoint del piano (poll 10ms in pagina). */',
'    async function g05Arm() {',
'        await page.evaluate(() => {',
'            const G = window.__g05 = { tMove: 0, lats: [], armed: true, prevEnd: null, iv: 0, evN: 0 };',
'            window.__g05Move = () => { if (G.armed) { G.tMove = performance.now(); G.evN++; } };',
"            window.addEventListener('pointermove', window.__g05Move, true);",
'            G.iv = setInterval(() => {',
'                if (!G.armed) return;',
'                const sh = window.__ink.shadow ? window.__ink.shadow() : null;',
'                if (!sh || !sh.visible || !sh.pts || !sh.pts.length) return;',
'                const e = sh.pts[sh.pts.length - 1];',
"                const key = e[0].toFixed(2) + ',' + e[1].toFixed(2);",
'                if (G.prevEnd == null) { G.prevEnd = key; return; }',
'                if (key !== G.prevEnd) {',
'                    G.prevEnd = key;',
'                    if (G.tMove) G.lats.push(+(performance.now() - G.tMove).toFixed(1));',
'                }',
'            }, 10);',
'        });',
'    }',
'    async function g05Read() {',
'        return page.evaluate(() => {',
'            const G = window.__g05;',
'            if (!G) return { lats: [], evN: 0, max: null, avg: null };',
'            G.armed = false; clearInterval(G.iv);',
"            window.removeEventListener('pointermove', window.__g05Move, true);",
'            const lats = G.lats.slice();',
'            return { lats: lats, evN: G.evN,',
'                     max: lats.length ? Math.max.apply(null, lats) : null,',
'                     avg: lats.length ? +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1) : null };',
'        });',
'    }',
''
].join('\n');

const JOBS = [
  { name: 'g05 helpers', count: 1,
    find: "    /* ---- controllo penna (coordinate mondo -> client batch) ---- */",
    replace: G05_HELPERS + "    /* ---- controllo penna (coordinate mondo -> client batch) ---- */" },

  { name: 'Q06 arm g05 prima ext', count: 1,
    find: "        const tMove0 = Date.now();",
    replace: "        await g05Arm();\n        const tMove0 = Date.now();" },

  { name: 'Q06.11 in-page', count: 1,
    find: [
"        Mq.updMs = tUpd;",
"        ok(!!(s2 && s2.visible), 'Q06.10 ombra resta visibile durante il movimento (G05/G07)',",
"            JSON.stringify({ visible: s2 && s2.visible, cls: s2 && s2.cls }));",
"        ok(tUpd !== null && tUpd <= 100,",
"            'Q06.11 ombra aggiornata entro100ms dal movimento (G05)', 'upd=' + tUpd + 'ms');"
].join('\n'),
    replace: [
"        const g05a = await g05Read();",
"        Mq.updNodeMs = tUpd;",
"        Mq.updMs = g05a.max;",
"        Mq.updLats = g05a.lats;",
"        console.log('DIAG G05 Q06: ' + JSON.stringify(g05a));",
"        ok(!!(s2 && s2.visible), 'Q06.10 ombra resta visibile durante il movimento (G05/G07)',",
"            JSON.stringify({ visible: s2 && s2.visible, cls: s2 && s2.cls }));",
"        ok(g05a.lats.length > 0 && g05a.max !== null && g05a.max <= 100,",
"            'Q06.11 ombra aggiornata entro100ms dal movimento (G05)',",
"            'max=' + g05a.max + 'ms n=' + g05a.lats.length + ' node=' + tUpd);"
].join('\n') },

  { name: 'Q06 penUp a fine ext', count: 1,
    find: "        await penUp(ptsB);",
    replace: [
"        // rilascio dove la penna e' DOVVERO (x=+164 con ext): penUp(ptsB)",
"        // scatterebbe l'ultimo punto a x=+60 (snap inkLastRaw) -> teleporto",
"        // di 104px -> nf esplode -> freeform (endpoint=104.058).",
"        await penUp(ptsB.concat(ext));"
].join('\n') },

  { name: 'Q07 arm g05 prima ext', count: 1,
    find: [
"        await penMoves(ext, 0, ext.length, 5);",
"        const tU0 = Date.now();"
].join('\n'),
    replace: [
"        await g05Arm();",
"        await penMoves(ext, 0, ext.length, 5);",
"        const tU0 = Date.now();"
].join('\n') },

  { name: 'Q07.8 in-page', count: 1,
    find: [
"        Mq.updMs = tUpd;",
"        ok(!!(s2 && s2.visible), 'Q07.7 ombra arco segue il movimento (G05)',",
"            JSON.stringify({ visible: s2 && s2.visible, cls: s2 && s2.cls }));",
"        ok(tUpd !== null && tUpd <= 100, 'Q07.8 aggiornamento <=100ms (G05)', 'upd=' + tUpd);"
].join('\n'),
    replace: [
"        const g05b = await g05Read();",
"        Mq.updNodeMs = tUpd;",
"        Mq.updMs = g05b.max;",
"        Mq.updLats = g05b.lats;",
"        console.log('DIAG G05 Q07: ' + JSON.stringify(g05b));",
"        ok(!!(s2 && s2.visible), 'Q07.7 ombra arco segue il movimento (G05)',",
"            JSON.stringify({ visible: s2 && s2.visible, cls: s2 && s2.cls }));",
"        ok(g05b.lats.length > 0 && g05b.max !== null && g05b.max <= 100,",
"            'Q07.8 aggiornamento <=100ms (G05)',",
"            'max=' + g05b.max + 'ms n=' + g05b.lats.length + ' node=' + tUpd);"
].join('\n') },

  { name: 'Q10 asta sinusoidale line-safe', count: 1,
    find: "        for (let i = 0; i <= 27; i++) line.push([C.x - 150 + i * 10, C.y - 70 + Math.sin(i / 6) * 1.1]);",
    replace: [
"        // asta: sinusoide \"line-safe\" di Q06 (amp 4, periodo 24, fase nulla",
"        // all'estremo) -> classifica line CON margine e dev ~3.5px mondo:",
"        // stazioni pixel G02 con devMin 2.0 raggiungibili (l'onda 1.1px",
"        // vecchia non lo era mai)",
"        for (let x = -150; x <= 120; x += 4) line.push([C.x + x, C.y - 70 + 4 * Math.sin(2 * Math.PI * x / 24)]);"
].join('\n') },

  { name: 'Q10 flick V 4 punti', count: 1,
    find: [
"        const flick = [[e[0] + 6, e[1] - 4.5], [e[0] - 15, e[1] - 8]];",
"        await penMoves(flick, 0, flick.length, 3);"
].join('\n'),
    replace: [
"        // F01: V reale di 4 punti dentro la finestra flick 250ms (la sosta",
"        // 280ms isola la coda: win = fine linea + 4 flick, bbox ~20px).",
"        // Gambe >= flickMinLegPx=8 e angolo ~169-172 >= flickVAngleDeg=100",
"        // in ENTRAMBI i casi di bordo finestra (vecchio V a 2 punti: gamba",
"        // 7.5px < 8 -> sotto soglia spec A01, correttamente non rilevato).",
"        const flick = [",
"            [e[0] + 2, e[1] - 2],",
"            [e[0] + 9, e[1] - 6],",
"            [e[0] + 16, e[1] - 10],",
"            [e[0] + 1, e[1] + 2]",
"        ];",
"        await penMoves(flick, 0, flick.length, 8);"
].join('\n') }
];

let src = fs.readFileSync(F, 'utf8');
let nl = '\n';
if (src.indexOf('\r\n') >= 0) src = src.split('\r\n').join('\n');   // normalizza per match

for (const j of JOBS) {
    const n = src.split(j.find).length - 1;
    if (n !== j.count) { console.error('COUNT ' + j.name + ' got ' + n + ' want ' + j.count); process.exit(1); }
    src = src.split(j.find).join(j.replace);
    console.log('OK ' + j.name);
}
fs.writeFileSync(F, src, 'utf8');
console.log('APPLIED ' + JOBS.length + ' jobs');
