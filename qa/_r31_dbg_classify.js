'use strict';
require('../web_frontend/html/js/modules/ink_commit.js');
const IC = globalThis.InkCommit;
function show(name, pts) {
    const plan = IC.classify(pts, {});
    const n = pts.length;
    const ch = Math.hypot(pts[n-1][0]-pts[0][0], pts[n-1][1]-pts[0][1]);
    let bez = null;
    const b = IC.tryBezArc(pts, 1e9);
    if (b) {
        let m = 0;
        for (const q of pts) m = Math.max(m, IC.distToPoly(q, b.pts));
        bez = { resid: +m.toFixed(2), ch: +ch.toFixed(1), tol05: +(0.05*ch).toFixed(1) };
    }
    console.log(name + ': cls=' + plan.cls + ' kind=' + (plan.params ? plan.params.kind : '-') + ' nf=' + IC.countFlessi(pts) + ' bez=' + JSON.stringify(bez));
}
const Cx = 800, Cy = 500;
const corner = [];
for (let x = -230; x <= -104; x += 5) corner.push([Cx + x, Cy - 120]);
for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI / 2; corner.push([Cx - 104 + 14 * (Math.cos(a) + 1), Cy - 120 + 14 * (Math.sin(a) + 1)]); }
for (let y = -106; y <= -20; y += 5) corner.push([Cx - 90, Cy + y]);
show('CORNER', corner);
const Cv = [];
for (let i = 0; i <= 70; i++) { const a = (40 + (i / 70) * 280) * Math.PI / 180; Cv.push([Cx + 140 + 45 * Math.cos(a), Cy - 80 + 45 * Math.sin(a)]); }
show('C280  ', Cv);
const S = [];
for (let x = 150; x <= 550; x += 4) S.push([x, 300 + 45 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
show('S     ', S);
const Ssmall = [];
for (let x = 150; x <= 550; x += 4) Ssmall.push([x, 300 + 6 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
show('Ssmall', Ssmall);
const U = [];
for (let i = 0; i <= 40; i++) { const a = Math.PI + (i / 40) * Math.PI; U.push([Cx + 30 + 40 * Math.cos(a), Cy - 40 + 40 * Math.sin(a)]); }
show('U     ', U);
const wline = [];
for (let x = 156; x <= 552; x += 4) wline.push([x, 250 + 4 * Math.sin(2 * Math.PI * x / 24)]);
show('WLINE ', wline);
