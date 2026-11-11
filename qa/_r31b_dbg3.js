'use strict';
require('../web_frontend/html/js/modules/ink_commit.js');
const IC = globalThis.InkCommit;
function show(name, pts, ts) {
    const p = IC.classify(pts, { ts: ts || null, size: 4, noSnap: false });
    const sp = IC.shadowPlan(pts, { ts: ts || null, size: 4, noSnap: false });
    console.log(name + ': classify=' + p.cls + '/' + (p.params && p.params.kind) +
        ' shadow=' + (sp ? sp.cls : null) + ' nf=' + IC.countFlessi(pts));
}
const ptsB = [];
for (let x = -252; x <= 60; x += 4) ptsB.push([x, 400 + 4 * Math.sin(2 * Math.PI * x / 24)]);
const ext = [];
for (let x = 64; x <= 164; x += 4) ext.push([x, 400 + 4 * Math.sin(2 * Math.PI * x / 24)]);
show('Q06 pause       ', ptsB.slice(0, 61));
show('Q06 full + sineExt', ptsB.concat(ext));
show('Q12 full        ', ptsB);
const arc = [];
const R = 100, sw = Math.PI * 2 / 3, n7 = 36;
for (let i = 0; i <= n7; i++) {
    const a = -Math.PI / 2 + (i / n7) * sw;
    const wob = 4 * Math.sin((i / n7) * Math.PI * 2);
    arc.push([300 + (R + wob) * Math.cos(a), (R + wob) * Math.sin(a)]);
}
show('Q07 base        ', arc);
let aa = -Math.PI / 2 + sw;
const extA = [];
for (let i = 1; i <= 14; i++) {
    aa += 0.045;
    extA.push([300 + R * Math.cos(aa), R * Math.sin(aa)]);
}
show('Q07 +ext        ', arc.concat(extA));
