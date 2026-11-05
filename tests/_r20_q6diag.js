'use strict';
/* tests/_r20_q6diag.js - diagnostica NON-suite: replica Q6 x6 e stampa
   indici di variazione (pre length, bez seg, residuo, dove cade il max). */
const env0 = require('./_ink_env');
const sleep = env0.sleep;
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
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
function distToPoly(p, poly) {
    let m = Infinity, mi = -1;
    for (let i = 1; i < poly.length; i++) {
        const a = poly[i - 1], b = poly[i];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy || 1;
        let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
        if (d < m) { m = d; mi = i; }
    }
    return [m, mi];
}
function bezPoly(segs, per) {
    const out = [];
    for (const s of segs) {
        for (let i = (out.length ? 1 : 0); i <= per; i++) {
            const t = i / per, u = 1 - t;
            out.push([
                u * u * u * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t * t * t * s[3][0],
                u * u * u * s[0][1] + 3 * u * u * t * s[1][1] + 3 * u * t * t * s[2][1] + t * t * t * s[3][1]
            ]);
        }
    }
    return out;
}
(async () => {
    for (let run = 1; run <= 6; run++) {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);
        const rnd = lcg(555);
        const arcQ = [];
        const aX = 260, aW = 130, aSag = 55;
        for (let x = aX; x <= aX + aW; x += 3) {
            const t = (x - aX) / aW;
            arcQ.push([x + (rnd() - 0.5) * 2, 300 + aSag * Math.sin(Math.PI * t) + (rnd() - 0.5) * 2]);
        }
        const e6 = arcQ[arcQ.length - 1];
        await strokePauseFlick(env, arcQ, [
            [e6[0], e6[1]], [e6[0] + 12, e6[1] + 4], [e6[0] + 20, e6[1] - 2],
            [e6[0] + 14, e6[1] + 7], [e6[0] + 2, e6[1] + 4], [e6[0] - 8, e6[1] + 9]
        ], { dt: 1 });
        const objs = ink.objects();
        const a6 = objs.filter(o => o.t === 'shape').slice(-1)[0];
        const stops = ink.trace.filter(e => e.k === 'stop');
        if (!a6 || a6.kind !== 'arrow') {
            console.log('run' + run + ' NON-ARROW ' + JSON.stringify(objs.map(o => o.t + ':' + (o.kind || ''))) +
                ' stops=' + JSON.stringify(stops));
            continue;
        }
        const bez = a6.params.shaft.bez;
        const ideal = bezPoly(bez, 8);
        const pre = arcQ.slice(0, -1);
        let maxd = 0, maxAt = -1;
        pre.forEach((p, i) => { const r = distToPoly(p, ideal); if (r[0] > maxd) { maxd = r[0]; maxAt = i; } });
        console.log('run' + run + ' res=' + maxd.toFixed(3) + ' maxAt=' + maxAt + '/' + pre.length +
            ' bezSeg=' + bez.length + ' shaftPts=' + a6.params.shaft.pts.length +
            ' stopEvents=' + stops.length + ' ghost=' + ink.state().ghost);
    }
    process.exit(0);
})();
