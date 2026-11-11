'use strict';
/* qa/_r31b_patch3.js — correzioni finali R31b:
   1) Q06.6-06.8 / Q07.4-07.6: probe pixel DOPO la sezione G05 (getImageData
      sezza il rendering del canvas: frames 31->2/500ms, vedi _r31b_bisect.js);
   2) Q10 asta: fase nulla ai 2 estremi (span 264) + amp 3 -> T01 line anche
      col troncato da flick (dev 5.08 < 6.50) e stazioni G02 dev 2.60 >= 2.0. */
const fs = require('fs');
const path = require('path');
const F = path.resolve(__dirname, '..', 'qa_browser', 'qaR31b_shadow.js');

const Q06_PROBE = [
"        // G03 pixel: stazioni deviazione ideale-grezzo + coda bagnata esclusa",
"        const raw1 = await ap();",
"        const sts = stationsOf(s1.pts, raw1, 2.5);",
"        ok(sts.length >= 1, 'Q06.6 stazioni probe (dev>=2.5px mondo)',",
"            String(sts.length) + ' ' + JSON.stringify(sts.map(s => [s.idx, s.dev])));",
"        const gp1 = await grayProbe(sts, true);",
"        console.log('DIAG gray Q06: ' + JSON.stringify(gp1.map(g => ({ wrun: g.wrun, gray: g.gray, dark: g.dark, st: g.st }))));",
"        if (gp1[0] && gp1[0].samples) console.log('DIAG rgb Q06: ' + JSON.stringify(gp1[0].samples));",
"        Mq.liveProbe = gp1; Mq.stations = sts;",
"        ok(maxRun(gp1, 'wrun') >= 2.5, 'Q06.7 pixel OMBRA grigia in sezione >=2.5px mondo (G02)',",
"            JSON.stringify(gp1));",
"        ok(sumDark(gp1) >= 2, 'Q06.8 grezzo NERO ancora visibile sotto (G03)',",
"            JSON.stringify(gp1));",
"        // N02-bis: il grezzo non morfing durante la sosta"
].join('\n');

const Q06_PROBE_NEW = [
"        // N02-bis: il grezzo non morfing durante la sosta"
].join('\n');

const Q06_ANCHOR = [
"        const s3pts = s3 && s3.pts ? s3.pts.map(p => [p[0], p[1]]) : null;",
"        // G06: rilascio = geometria ultima ombra (endpoint <=1px)"
].join('\n');

const Q06_ANCHOR_NEW = [
"        const s3pts = s3 && s3.pts ? s3.pts.map(p => [p[0], p[1]]) : null;",
"        // G03 pixel: stazioni deviazione ideale-grezzo + coda bagnata esclusa.",
"        // DOPO la miratura: il probe getImageData sezza il rendering del",
"        // canvas per il resto della nota (frames31->2/500ms, vedi",
"        // qa/_r31b_bisect.js) -> la misura G05 deve girare PRIMA.",
"        const raw1 = await ap();",
"        const sts = stationsOf(s3pts, raw1, 2.5);",
"        ok(sts.length >= 1, 'Q06.6 stazioni probe (dev>=2.5px mondo)',",
"            String(sts.length) + ' ' + JSON.stringify(sts.map(s => [s.idx, s.dev])));",
"        const gp1 = await grayProbe(sts, true);",
"        console.log('DIAG gray Q06: ' + JSON.stringify(gp1.map(g => ({ wrun: g.wrun, gray: g.gray, dark: g.dark, st: g.st }))));",
"        if (gp1[0] && gp1[0].samples) console.log('DIAG rgb Q06: ' + JSON.stringify(gp1[0].samples));",
"        Mq.liveProbe = gp1; Mq.stations = sts;",
"        ok(maxRun(gp1, 'wrun') >= 2.5, 'Q06.7 pixel OMBRA grigia in sezione >=2.5px mondo (G02)',",
"            JSON.stringify(gp1));",
"        ok(sumDark(gp1) >= 2, 'Q06.8 grezzo NERO ancora visibile sotto (G03)',",
"            JSON.stringify(gp1));",
"        // G06: rilascio = geometria ultima ombra (endpoint <=1px)"
].join('\n');

const Q07_PROBE = [
"        const raw1 = await ap();",
"        const sts = stationsOf(s1.pts, raw1, 1.5);",
"        const gp1 = sts.length ? await grayProbe(sts) : [];",
"        Mq.liveProbe = gp1; Mq.stations = sts;",
"        ok(sts.length >= 1, 'Q07.4 stazioni probe (dev>=1.5px)', String(sts.length));",
"        ok(gp1.length && maxRun(gp1, 'wrun') >= 1.5, 'Q07.5 pixel ombra arco >=1.5px mondo (G02)',",
"            JSON.stringify(gp1));",
"        ok(sumDark(gp1) >= 2, \"Q07.6 grezzo sotto l'ombra ancora visibile (G03)\", JSON.stringify(gp1));",
"        // miratura: estendere l'arco con penna giu"
].join('\n');

const Q07_PROBE_RM = [
"        // miratura: estendere l'arco con penna giu"
].join('\n');

const Q07_ANCHOR = [
"        const s3pts = s3 && s3.pts ? s3.pts.map(p => [p[0], p[1]]) : null;",
"        const sw1 = await traceCount('swap');",
"        await penUp(arc.concat(ext));"
].join('\n');

const Q07_ANCHOR_NEW = [
"        const s3pts = s3 && s3.pts ? s3.pts.map(p => [p[0], p[1]]) : null;",
"        // pixel probe DOPO la misura G05 (getImageData sezza il rendering:",
"        // vedi qa/_r31b_bisect.js) — stazioni sull'ideale della riconferma",
"        const raw1 = await ap();",
"        const sts = stationsOf(s3pts, raw1, 1.5);",
"        const gp1 = sts.length ? await grayProbe(sts) : [];",
"        Mq.liveProbe = gp1; Mq.stations = sts;",
"        ok(sts.length >= 1, 'Q07.4 stazioni probe (dev>=1.5px)', String(sts.length));",
"        ok(gp1.length && maxRun(gp1, 'wrun') >= 1.5, 'Q07.5 pixel ombra arco >=1.5px mondo (G02)',",
"            JSON.stringify(gp1));",
"        ok(sumDark(gp1) >= 2, \"Q07.6 grezzo sotto l'ombra ancora visibile (G03)\", JSON.stringify(gp1));",
"        const sw1 = await traceCount('swap');",
"        await penUp(arc.concat(ext));"
].join('\n');

const Q10_FIND = [
"        // asta: sinusoide \"line-safe\" di Q06 (amp 4, periodo 24, fase nulla",
"        // all'estremo) -> classifica line CON margine e dev ~3.5px mondo:",
"        // stazioni pixel G02 con devMin 2.0 raggiungibili (l'onda 1.1px",
"        // vecchia non lo era mai)",
"        for (let x = -150; x <= 120; x += 4) line.push([C.x + x, C.y - 70 + 4 * Math.sin(2 * Math.PI * x / 24)]);"
].join('\n');

const Q10_REPLACE = [
"        // asta: sinusoide \"line-safe\" a FASE NULLA ai due estremi",
"        // (span 264 = 11 periodi): dev corda ~2.6px con amp 3 -> T01 line",
"        // con margine ANCHE quando il flick taglia l'ultimo punto della",
"        // finestra (dev del troncato ~5.1 < 6.5); stazioni pixel G02 con",
"        // devMin 2.0: dev ideale-grezzo ~2.6 >= 2.0 (l'amp 4 con fase",
"        // iniziale -1 dava dev 7.9 > 6.7 -> bez 'arc' = Q10.1 FAIL)",
"        for (let x = -144; x <= 120; x += 4) line.push([C.x + x, C.y - 70 + 3 * Math.sin(2 * Math.PI * x / 24)]);"
].join('\n');

const JOBS = [
  { name: 'Q06 rimuovi probe dal posto vecchio', find: Q06_PROBE, replace: Q06_PROBE_NEW },
  { name: 'Q06 inserisci probe dopo s3pts', find: Q06_ANCHOR, replace: Q06_ANCHOR_NEW },
  { name: 'Q07 rimuovi probe dal posto vecchio', find: Q07_PROBE, replace: Q07_PROBE_RM },
  { name: 'Q07 inserisci probe dopo s3pts', find: Q07_ANCHOR, replace: Q07_ANCHOR_NEW },
  { name: 'Q10 asta fase0 amp3', find: Q10_FIND, replace: Q10_REPLACE }
];

let src = fs.readFileSync(F, 'utf8');
if (src.indexOf('\r\n') >= 0) src = src.split('\r\n').join('\n');
for (const j of JOBS) {
    const n = src.split(j.find).length - 1;
    if (n !== 1) { console.error('COUNT ' + j.name + ' got ' + n + ' want 1'); process.exit(1); }
    src = src.split(j.find).join(j.replace);
    console.log('OK ' + j.name);
}
fs.writeFileSync(F, src, 'utf8');
console.log('APPLIED ' + JOBS.length + ' jobs');
