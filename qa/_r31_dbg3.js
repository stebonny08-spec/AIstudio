'use strict';
require('../web_frontend/html/js/modules/ink_commit.js');
const IC = globalThis.InkCommit;
const Cx = 800, Cy = 500;
const corner = [];
for (let x = -230; x <= -104; x += 5) corner.push([Cx + x, Cy - 120]);
for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI / 2; corner.push([Cx - 104 + 14 * (Math.cos(a) + 1), Cy - 120 + 14 * (Math.sin(a) + 1)]); }
for (let y = -106; y <= -20; y += 5) corner.push([Cx - 90, Cy + y]);
const b = IC.tryBezArc(corner, 1e9);
if (!b) { console.log('bez(1e9) -> NULL'); }
else {
  console.log('bez(1e9) -> OBJ len=' + b.pts.length + ' p0=' + JSON.stringify(b.pts[0]) + ' pmid=' + JSON.stringify(b.pts[Math.floor(b.pts.length/2)]));
  let m = 0, nan = 0;
  for (const q of corner) { const d = IC.distToPoly(q, b.pts).d; if (isNaN(d)) nan++; else if (d > m) m = d; }
  console.log('resid=' + m + ' nanCount=' + nan + ' seg=' + JSON.stringify(b.params.p));
}
