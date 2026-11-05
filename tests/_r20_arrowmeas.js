'use strict';
/* tests/_r20_arrowmeas.js - sonda NON-suite (underscore: esclusa da
   run_t1): genera Q5 (retta+flick) e Q6 (arco+flick) come u20_shaping e
   stampa le MISURE REALI della punta saldata per il report R20. */
const env0 = require('./_ink_env');
const sleep = env0.sleep;
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function angBetween(v1, v2) {
    const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
    const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / ((n1 * n2) || 1);
    return Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
}
async function strokePauseFlick(env, basePts, flickPts, opt) {
    opt = opt || {};
    const canvas = env0.canvasOf(env);
    const bC = env0.wc(env, basePts);
    env0.ptr(env, canvas, 'pointerdown', bC[0][0], bC[0][1]);
    for (let i = 1; i < bC.length; i++) {
        if (opt.dt) await sleep(opt.dt);
        env0.ptr(env, canvas, 'pointermove', bC[i][0], bC[i][1]);
    }
    await sleep(280);
    const fC = env0.wc(env, flickPts);
    for (let i = 0; i < fC.length; i++) { await sleep(4); env0.ptr(env, canvas, 'pointermove', fC[i][0], fC[i][1]); }
    env0.ptr(env, canvas, 'pointerup', fC[fC.length - 1][0], fC[fC.length - 1][1]);
    await sleep(120);
}
function maxPerp(pts, a, b) {
    let m = 0;
    for (const q of pts) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        const d = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L;
        if (d > m) m = d;
    }
    return m;
}
(async () => {
    const env = env0.makeEnv();
    await env0.openNote(env, 'n1');
    const ink = env.win.__ink;
    const shapes = () => ink.objects().filter(o => o.t === 'shape');

    // ---- Q5: retta + flick ----
    const rnd5 = lcg(4242);
    const lineQ = [];
    for (let i = 0; i <= 50; i++) lineQ.push([100 + i * 3 + (rnd5() - 0.5) * 2, 150 + i * 0.6 + (rnd5() - 0.5) * 2]);
    const e5 = lineQ[lineQ.length - 1];
    await strokePauseFlick(env, lineQ, [
        [e5[0], e5[1]], [e5[0] + 12, e5[1] + 4], [e5[0] + 22, e5[1] + 0],
        [e5[0] + 16, e5[1] + 8], [e5[0] + 4, e5[1] + 5], [e5[0] - 6, e5[1] + 10]
    ], { dt: 1 });
    const a5 = shapes()[0];
    if (a5 && a5.kind === 'arrow') {
        const h = a5.params.head, sp = a5.params.shaft.pts;
        const term = sp[sp.length - 1];
        const dv = [sp[1][0] - sp[0][0], sp[1][1] - sp[0][1]];
        console.log('Q5 arrow: shaakind=' + a5.params.shaft.kind +
            ' | angoloAlaDeg=' + h.angoloAlaDeg +
            ' | lunghezza=' + h.lunghezza +
            ' | size=' + a5.size +
            ' | rapporto L/size=' + (h.lunghezza / a5.size).toFixed(2) +
            ' | base->terminale=' + Math.hypot(h.base[0] - term[0], h.base[1] - term[1]).toFixed(3) + 'px' +
            ' | tangente vs asta=' + angBetween(h.tangente, dv).toFixed(2) + '°' +
            ' | residuo perp grezzo->fit=' + maxPerp(lineQ.slice(0, -1), sp[0], sp[1]).toFixed(3) + 'px');
    } else console.log('Q5: NON arrow: ' + JSON.stringify(ink.objects().map(o => o.t + ':' + (o.kind || ''))));

    // ---- Q6: arco + flick ----
    env.store.items[0].content = '';
    await env0.openNote(env, 'n1');
    const rnd6 = lcg(555);
    const arcQ = [];
    const aX = 260, aW = 130, aSag = 55;
    for (let x = aX; x <= aX + aW; x += 3) {
        const t = (x - aX) / aW;
        arcQ.push([x + (rnd6() - 0.5) * 2, 300 + aSag * Math.sin(Math.PI * t) + (rnd6() - 0.5) * 2]);
    }
    const e6 = arcQ[arcQ.length - 1];
    await strokePauseFlick(env, arcQ, [
        [e6[0], e6[1]], [e6[0] + 12, e6[1] + 4], [e6[0] + 20, e6[1] - 2],
        [e6[0] + 14, e6[1] + 7], [e6[0] + 2, e6[1] + 4], [e6[0] - 8, e6[1] + 9]
    ], { dt: 1 });
    const a6 = shapes()[0];
    if (a6 && a6.kind === 'arrow') {
        const h = a6.params.head;
        const bez = a6.params.shaft.bez;
        const sg = bez[bez.length - 1];
        const der = [3 * (sg[3][0] - sg[2][0]), 3 * (sg[3][1] - sg[2][1])];
        console.log('Q6 arrow: shaakind=' + a6.params.shaft.kind +
            ' | segbezier=' + bez.length +
            ' | angoloAlaDeg=' + h.angoloAlaDeg +
            ' | lunghezza=' + h.lunghezza +
            ' | size=' + a6.size +
            ' | rapporto L/size=' + (h.lunghezza / a6.size).toFixed(2) +
            ' | base->terminale(t=1)=' + Math.hypot(h.base[0] - sg[3][0], h.base[1] - sg[3][1]).toFixed(3) + 'px' +
            ' | tangente vs derivata Bézier=' + angBetween(h.tangente, der).toFixed(3) + '°');
    } else console.log('Q6: NON arrow: ' + JSON.stringify(ink.objects().map(o => o.t + ':' + (o.kind || ''))));
    process.exit(0);
})();
