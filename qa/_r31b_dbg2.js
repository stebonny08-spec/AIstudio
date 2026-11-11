'use strict';
require('../web_frontend/html/js/modules/ink_commit.js');
const IC = globalThis.InkCommit;
function show(name, pts, ts) {
    const p = IC.classify(pts, { ts: ts || null, size: 4, noSnap: false });
    const sp = IC.shadowPlan(pts, { ts: ts || null, size: 4, noSnap: false });
    console.log(name + ': classify=' + p.cls + '/' + (p.params && p.params.kind) +
        ' shadow=' + (sp ? sp.cls : null) + ' nf=' + IC.countFlessi(pts) +
        ' si=' + IC.selfInt(pts));
}
// Q06 line: span396 (V01) + estensione miratura
const line = [];
for (let x = -200; x <= 196; x += 4) line.push([x, 400 + 4 * Math.sin(2 * Math.PI * x / 24)]);
let last = line[50];
const ext6 = [];
for (let i = 1; i <= 12; i++) { last = [last[0] + 7, last[1] + 3.5]; ext6.push(last); }
const tsL = line.map((_, i) => i * 5);
show('Q06 line (half)', line.slice(0, 51), tsL.slice(0, 51));
show('Q06 line+ext   ', line.slice(0, 51).concat(ext6),
     line.slice(0, 51).map((_, i) => i * 5).concat(ext6.map((_, i) => 260 + i * 5)));
// Q07 arc: R100 sweep120 con bump mezzo-cos (0 ai bordi)
function arcGen(n) {
    const out = [];
    const R = 100, sw = Math.PI * 2 / 3;
    for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (i / n) * sw;
        const wob = 3 * (1 - Math.cos(2 * Math.PI * (i / n))) / 2;
        out.push([(R + wob) * Math.cos(a), (R + wob) * Math.sin(a)]);
    }
    return out;
}
const arc = arcGen(37);
show('Q07 arc        ', arc);
// estensione arco (i38..51)
const extA = [];
const R = 100, sw = Math.PI * 2 / 3, stepA = sw / 37;
for (let i = 38; i <= 51; i++) {
    const a = -Math.PI / 2 + (i / 37) * sw;
    const wob = 3 * (1 - Math.cos(2 * Math.PI * (i / 37))) / 2;
    extA.push([(R + wob) * Math.cos(a), (R + wob) * Math.sin(a)]);
}
show('Q07 arc+ext    ', arc.concat(extA));
// Q09
const q9 = [];
for (let x = -160; x <= 160; x += 5) q9.push([x, 400 + 3 * Math.sin(x / 18)]);
show('Q09 line       ', q9);
// Q10 line + flick
const l10 = [];
for (let i = 0; i <= 27; i++) l10.push([-150 + i * 10, 300 + Math.sin(i / 6) * 1.1]);
const e10 = l10[l10.length - 1];
const full10 = l10.concat([[e10[0] + 6, e10[1] - 4.5], [e10[0] - 15, e10[1] - 8]]);
const ts10 = full10.map((_, i) => i * 5);
show('Q10 line only  ', l10, ts10.slice(0, l10.length));
show('Q10 line+flick ', full10, ts10);
// Q08 S (atteso freeform: nessuna ombra)
const S = [];
for (let i = 0; i <= 75; i++) { const t = i / 75; S.push([-60 + 40 * Math.sin(2 * Math.PI * t), -140 + 280 * t]); }
show('Q08 S          ', S);
