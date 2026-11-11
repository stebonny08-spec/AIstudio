'use strict';
/* qa/_r31b_dbg_q10shaft.js — perche' l'asta Q10 (sinusoide amp4 span270)
   classifica 'arc' e non 'line'? */
globalThis.window = globalThis;
require('../web_frontend/html/js/modules/ink_cfg.js');
require('../web_frontend/html/js/modules/ink_commit.js');
const IC = globalThis.InkCommit;
const CFG = IC.CFG;

function gen(x0, x1, step, amp, per, ph) {
    const pts = [];
    for (let x = x0; x <= x1; x += step) pts.push([x, -70 + amp * Math.sin(2 * Math.PI * (x - x0) / per + (ph || 0))]);
    return pts;
}
function pathLen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
function maxDevChord(p) {
    const a = p[0], b = p[p.length - 1];
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    let m = 0;
    for (const q of p) {
        const t = ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2;
        m = Math.max(m, Math.hypot(q[0] - (a[0] + vx * t), q[1] - (a[1] + vy * t)));
    }
    return m;
}
function report(tag, pts) {
    const n = pts.length;
    const nf = IC.countFlessi(pts);
    const ch = Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1]);
    const PL = pathLen(pts);
    const dev = maxDevChord(pts);
    const ratio = ch / PL;
    const plan = IC.classify(pts, { ts: null, size: 3, noSnap: false });
    const sp = IC.shadowPlan(pts, { ts: null, size: 3, noSnap: false });
    let cir = null;
    try {
        const c = IC.tryCircleArc ? IC.tryCircleArc(pts, 1e9) : null;
        if (c && c.pts) { let m = 0; for (const q of pts) m = Math.max(m, IC.distToPoly(q, c.pts)); cir = +m.toFixed(2); }
    } catch (e) { cir = 'ERR'; }
    console.log(tag + ': n=' + n + ' nf=' + nf + ' ch=' + ch.toFixed(1) +
        ' plen=' + PL.toFixed(1) + ' dev=' + dev.toFixed(2) +
        '/' + (CFG.lineDevRatio * ch).toFixed(2) +
        ' ratio=' + ratio.toFixed(4) + '/' + CFG.lineStraightRatio +
        ' cirResid=' + cir +
        ' -> cls=' + plan.cls + '/' + (plan.params && (plan.params.kind || plan.params.shaftKind)) +
        ' shadow=' + (sp ? sp.cls : null));
}

// asta Q10 attuale: x -150..120 step4 amp4 per24 (y=4*sin(2pi*x/24): fase start=-1)
const q10 = [];
for (let x = -150; x <= 120; x += 4) q10.push([x, -70 + 4 * Math.sin(2 * Math.PI * x / 24)]);
report('Q10-shaft ', q10);
// Q06-style: x -252..60
const q06 = [];
for (let x = -252; x <= 60; x += 4) q06.push([x, -80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
report('Q06-line  ', q06);
// variante span264 fase 0/0 (start e' multiplo di 24)
const v2 = [];
for (let x = -144; x <= 120; x += 4) v2.push([x, -70 + 4 * Math.sin(2 * Math.PI * x / 24)]);
report('span264 f0', v2);
// asta Q10 + 4 flick -> deve dare arrow
const e = q10[q10.length - 1];
const flick = [[e[0] + 2, e[1] - 2], [e[0] + 9, e[1] - 6], [e[0] + 16, e[1] - 10], [e[0] + 1, e[1] + 2]];
report('shaft+flick', q10.concat(flick));
// con ts realistico (gap linea 16.7ms, sosta 280, flick 21ms)
const T = [];
let t = 0;
for (let i = 0; i < q10.length; i++) { t += 16.7; T.push(t); }
t += 280;
for (let i = 0; i < flick.length; i++) { t += 21; T.push(t); }
const planTs = IC.classify(q10.concat(flick), { ts: T, size: 3, noSnap: false });
console.log('shaft+flick WITH ts -> cls=' + planTs.cls + ' head=' + !!(planTs.params && planTs.params.head) +
    ' shaftKind=' + (planTs.params && planTs.params.shaftKind));
// vecchia asta dritta
const straight = [];
for (let i = 0; i <= 27; i++) straight.push([-150 + i * 10, -70 + Math.sin(i / 6) * 1.1]);
report('old-straight', straight);
// v2 (span264 fase0) + flick + ts realistico
const e2 = v2[v2.length - 1];
const fl2 = [[e2[0] + 2, e2[1] - 2], [e2[0] + 9, e2[1] - 6], [e2[0] + 16, e2[1] - 10], [e2[0] + 1, e2[1] + 2]];
report('v2+flick  ', v2.concat(fl2));
const T2 = [];
let t2 = 0;
for (let i = 0; i < v2.length; i++) { t2 += 16.7; T2.push(t2); }
t2 += 280;
for (let i = 0; i < fl2.length; i++) { t2 += 21; T2.push(t2); }
const p2 = IC.classify(v2.concat(fl2), { ts: T2, size: 3, noSnap: false });
const s2 = IC.shadowPlan(v2.concat(fl2), { ts: T2, size: 3, noSnap: false });
console.log('v2+flick WITH ts -> cls=' + p2.cls + ' head=' + !!(p2.params && p2.params.head) +
    ' shaftKind=' + (p2.params && p2.params.shaftKind) + ' | shadow cls=' + (s2 ? s2.cls : null) +
    ' head=' + !!(s2 && s2.params && s2.params.head));
// Case A (win = soli 4 flick, linea fuori finestra): gap f0->f3 = 255ms
const T5 = [];
let t5 = 0;
for (let i = 0; i < v2.length; i++) { t5 += 16.7; T5.push(t5); }
t5 += 280; T5.push(t5);           // f0: eta' finale 255+ > 250
t5 += 85; T5.push(t5);            // f1
t5 += 85; T5.push(t5);            // f2
t5 += 85; T5.push(t5);            // f3
const p3 = IC.classify(v2.concat(fl2), { ts: T5, size: 3, noSnap: false });
console.log('v2+flick CaseA -> cls=' + p3.cls + ' head=' + !!(p3.params && p3.params.head) +
    ' shaftKind=' + (p3.params && p3.params.shaftKind));
