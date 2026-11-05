'use strict';
/* tests/n22_fitprobe.js - R22 BLOCCO 3: probe del fit ricostruito
   (Theil-Sen line / Kasa arc / Bezier LSQ pezzo-pezzo) sui riferimenti
   u20 sezione 8 (arco stretto sinusoidale) e a14 15 (curva lunga con
   2 inflessioni). Stima il residuo GREZZO->ideale del gate 2.5px e la
   qualita' della curva ideale (smoothness). */
globalThis.__DBG = true;
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function cumLen(pts) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return L;
}
function resample(pts, step) {
    const cum = cumLen(pts), total = cum[cum.length - 1];
    const out = [];
    let j = 0;
    for (let d = 0; d < total; d += step) {
        while (j < cum.length - 2 && cum[j + 1] < d) j++;
        const sg = (cum[j + 1] - cum[j]) || 1;
        const t = Math.min(1, Math.max(0, (d - cum[j]) / sg));
        out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
                  pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
    }
    out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
    return out;
}
function distToPoly(q, poly) {
    let m = Infinity, bx = 0, by = 0;
    for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i], b = poly[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
        if (d < m) { m = d; bx = a[0] + t * dx; by = a[1] + t * dy; }
    }
    return { d: m, cx: bx, cy: by };
}
/* Kasa su x^2+y^2 + D x + E y + F = 0 */
function kasa(pts) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sx3 = 0, sy3 = 0, sxyy = 0, syxx = 0;
    const n = pts.length;
    for (const p of pts) {
        const x = p[0], y = p[1];
        sx += x; sy += y;
        sxx += x * x; syy += y * y; sxy += x * y;
        sx3 += x * x * x; sy3 += y * y * y;
        sxyy += x * y * y; syxx += y * x * x;
    }
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    const B = [sx3 + sxyy, sy3 + syxx, sxx + syy];
    // gauss 3x3
    const M = A.map((r, i) => r.concat([B[i]]));
    for (let i = 0; i < 3; i++) {
        let p = i;
        for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        const tmp = M[i]; M[i] = M[p]; M[p] = tmp;
        if (Math.abs(M[i][i]) < 1e-12) return null;
        for (let r = 0; r < 3; r++) {
            if (r === i) continue;
            const f = M[r][i] / M[i][i];
            for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
        }
    }
    const D = M[0][3] / M[0][0], E = M[1][3] / M[1][1], F = M[2][3] / M[2][2];
    const cx = -D / 2, cy = -E / 2;
    const r2 = cx * cx + cy * cy - F;
    if (!(r2 > 1)) return null;
    return { cx, cy, r: Math.sqrt(r2) };
}
/* passata (1,2,1)/4 per STIMA (mai per il rendering) */
function lite(pts) {
    const sm = pts.map(p => [p[0], p[1]]);
    const cp = pts.map(p => [p[0], p[1]]);
    for (let i = 1; i < pts.length - 1; i++) {
        sm[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
        sm[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
    }
    return sm;
}
/* fit arco: Kasa + monotonia' angolare + residuo raw */
function tryArc(rsRaw, raw, gate) {
    const rs = lite(rsRaw);          // solo per la STIMA dei parametri
    const m = rs.length;
    const kc = kasa(rsRaw);
    if (!kc || kc.r < 12 || kc.r > 4000) return null;
    let maxRs = 0;
    for (const q of rsRaw) maxRs = Math.max(maxRs, Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r));
    if (maxRs > gate) { if (typeof globalThis.__DBG !== 'undefined') console.log('    arc: kasa res=' + maxRs.toFixed(2) + '>' + gate); return null; }
    // monotonia' angolare sul centro fit (gli S si invertono, gli archi no)
    let prev = Math.atan2(rs[0][1] - kc.cy, rs[0][0] - kc.cx);
    let unw = prev;
    const angs = [unw], ds = [];
    for (let i = 1; i < m; i++) {
        const a = Math.atan2(rs[i][1] - kc.cy, rs[i][0] - kc.cx);
        let d = a - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) > Math.PI / 3) return null;   // salto angolare
        unw += d; ds.push(d); angs.push(unw);
        prev = a;
    }
    const sig = ds.filter(v => Math.abs(v) > (1.5 * Math.PI / 180));
    if (sig.length < 4) return null;
    const nPos = sig.filter(v => v > 0).length;
    const frac = Math.max(nPos, sig.length - nPos) / sig.length;
    const tot = ds.reduce((s, v) => s + Math.abs(v), 0) * 180 / Math.PI;
    if (typeof globalThis.__DBG !== 'undefined') console.log('    arc: frac=' + frac.toFixed(2) + ' tot=' + tot.toFixed(0) + ' maxRs=' + maxRs.toFixed(2));
    if (frac < 0.9) return null;
    if (tot < 40 || tot > 350) return null;
    const span = Math.abs(unw - angs[0]);
    if (span < 40 * Math.PI / 180 || span > 350 * Math.PI / 180) return null;
    // residuo vs raw (gate comune 2.5)
    const dense = [];
    const N = Math.max(12, Math.min(400, Math.round(span * kc.r / 4)));
    for (let i = 0; i <= N; i++) {
        const a = angs[0] + (unw - angs[0]) * (i / N);
        dense.push([kc.cx + kc.r * Math.cos(a), kc.cy + kc.r * Math.sin(a)]);
    }
    let maxRaw = 0;
    for (const q of raw) maxRaw = Math.max(maxRaw, distToPoly(q, dense).d);
    if (maxRaw > 2.5) { if (typeof globalThis.__DBG !== 'undefined') console.log('    arc: raw res=' + maxRaw.toFixed(2)); return null; }
    return { arc: { cx: kc.cx, cy: kc.cy, r: kc.r, a0: angs[0], a1: unw, ccw: (unw - angs[0]) > 0 }, dense, maxRs, maxRaw };
}
/* fit pezzo-pezzo: s0,s1 lineari (tangente unitaria centrale), K segmenti */
function fitSeg(run, i0, i1, T0, T1) {
    // P0=run[i0], P3=run[i1]; P1=P0+s0*T0, P2=P3-s1*T1 (T unit)
    const P0 = run[i0], P3 = run[i1];
    let a11 = 0, a12 = 0, b1 = 0, b2 = 0;
    for (let i = i0; i <= i1; i++) {
        const q = run[i];
        const tt = (i1 === i0) ? 0 : (i - i0) / (i1 - i0);
        // uso param t = arc-length uniforme (approssimazione del fit LSQ)
        const u = 1 - tt;
        const b1v = 3 * u * u * tt, b2v = 3 * u * tt * tt;
        // base con P0/P3 pesati (u^3+3u^2 t) e (3ut^2+t^3): P1=P0+s0*T0,
        // P2=P3-s1*T1 entrano solo negli unknowns s0,s1
        const w0 = u * u * u + 3 * u * u * tt;
        const w3 = 3 * u * tt * tt + tt * tt * tt;
        const bx = q[0] - (w0 * P0[0] + w3 * P3[0]);
        const by = q[1] - (w0 * P0[1] + w3 * P3[1]);
        const vx1 = b1v * T0[0], vy1 = b1v * T0[1];
        const vx2 = -b2v * T1[0], vy2 = -b2v * T1[1];
        a11 += vx1 * vx1 + vy1 * vy1;
        a12 += vx1 * vx2 + vy1 * vy2;
        b1 += vx1 * bx + vy1 * by;
        b2 += vx2 * bx + vy2 * by;
    }
    const det = a11 * (a11) - a12 * a12;
    // matrice simmetrica: [[a11,a12],[a12,a11]]? no: a22 = sum v2^2
    // ricostruisco a22 esplicito
    let a22 = 0;
    for (let i = i0; i <= i1; i++) {
        const tt = (i1 === i0) ? 0 : (i - i0) / (i1 - i0);
        const u = 1 - tt;
        const b1v = 3 * u * u * tt, b2v = 3 * u * tt * tt;
        const vx2 = -b2v * T1[0], vy2 = -b2v * T1[1];
        a22 += vx2 * vx2 + vy2 * vy2;
    }
    const det2 = a11 * a22 - a12 * a12;
    let s0 = 0, s1 = 0;
    if (Math.abs(det2) > 1e-9) {
        s0 = (b1 * a22 - b2 * a12) / det2;
        s1 = (a11 * b2 - a12 * b1) / det2;
    } else { s0 = b1 / (a11 || 1); s1 = 0; }
    void det;
    const Lseg = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]) || 1;
    s0 = Math.max(0.05 * Lseg, Math.min(1.6 * Lseg, s0));
    s1 = Math.max(0.05 * Lseg, Math.min(1.6 * Lseg, s1));
    return [[P0[0], P0[1]], [P0[0] + s0 * T0[0], P0[0] === undefined ? 0 : P0[1] + s0 * T0[1]],
            [P3[0] - s1 * T1[0], P3[1] - s1 * T1[1]], [P3[0], P3[1]]];
}
function bezPoly(bez, sub) {
    const out = [];
    for (let i = 0; i < bez.length; i++) {
        const sg = bez[i];
        for (let j = (i === 0 ? 0 : 1); j <= sub; j++) {
            const t = j / sub, u = 1 - t;
            out.push([u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] + 3 * u * t * t * sg[2][0] + t * t * t * sg[3][0],
                      u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] + 3 * u * t * t * sg[2][1] + t * t * t * sg[3][1]]);
        }
    }
    return out;
}
function fitBezierRun(run, gate) {
    const m = run.length;
    const cum = cumLen(run);
    const total = cum[m - 1];
    for (const K of [1, 2, 3, 4, 5, 6, 8]) {
        // indici di knot a lunghezza uniforme
        const idx = [0];
        for (let k = 1; k < K; k++) {
            const target = total * k / K;
            let i = 1;
            while (i < m - 1 && cum[i] < target) i++;
            idx.push(i);
        }
        idx.push(m - 1);
        const bez = [];
        for (let k = 0; k < K; k++) {
            const i0 = idx[k], i1 = idx[k + 1];
            if (i1 <= i0) continue;
            // tangenti centrali ai knot interni, chord agli estremi
            let T0, T1;
            if (i0 === 0) {
                T0 = [run[1][0] - run[0][0], run[1][1] - run[0][1]];
            } else {
                T0 = [run[i0 + 1][0] - run[i0 - 1][0], run[i0 + 1][1] - run[i0 - 1][1]];
            }
            if (i1 === m - 1) {
                T1 = [run[m - 1][0] - run[m - 2][0], run[m - 1][1] - run[m - 2][1]];
            } else {
                T1 = [run[i1 + 1][0] - run[i1 - 1][0], run[i1 + 1][1] - run[i1 - 1][1]];
            }
            const n0 = Math.hypot(T0[0], T0[1]) || 1, n1 = Math.hypot(T1[0], T1[1]) || 1;
            bez.push(fitSeg(run, i0, i1, [T0[0] / n0, T0[1] / n0], [T1[0] / n1, T1[1] / n1]));
        }
        if (bez.length !== K) continue;
        const ideal = bezPoly(bez, 8);
        let maxRes = 0;
        for (const q of run) maxRes = Math.max(maxRes, distToPoly(q, ideal).d);
        if (typeof globalThis.__DBG !== 'undefined') console.log('    K=' + K + ' res=' + maxRes.toFixed(3));
        if (maxRes <= gate) return { bez, maxRes, K };
    }
    return null;
}
/* ---- casi di riferimento ---- */
// u20 sezione 8: arco stretto sinusoidale + jitter lcg555
{
    const rnd = lcg(555);
    const pts = [];
    const aX0 = 260, aW = 130, aSag = 55;
    for (let x = aX0; x <= aX0 + aW; x += 3) {
        const t = (x - aX0) / aW;
        pts.push([x + (rnd() - 0.5) * 2, 300 + aSag * Math.sin(Math.PI * t) + (rnd() - 0.5) * 2]);
    }
    const rs = resample(pts, 4);
    const arc = tryArc(rs, pts, 4.3);
    const fit = arc ? null : fitBezierRun(rs, 2.5);
    console.log('u20-8: arc=' + (arc ? 'YES' : 'no') +
        ' bez=' + (fit ? ('K=' + fit.K + ' res=' + fit.maxRes.toFixed(3)) : 'NULL'));
    ok(fit && fit.maxRes <= 2.5, 'u20-8 fit bezier residuo <=2.5',
        fit ? 'res=' + fit.maxRes.toFixed(3) + ' K=' + fit.K : 'null');
}
// a14 15: sine lunga con 2 inflessioni + jitter lcg2024
{
    const rnd = lcg(2024);
    const pts = [];
    for (let x = 80; x <= 700; x += 6) pts.push([x + (rnd() - 0.5) * 2, 300 + 45 * Math.sin(x / 90) + (rnd() - 0.5) * 5]);
    const rs = resample(pts, 4);
    const arc = tryArc(rs, pts, 4.3);
    const fit = arc ? null : fitBezierRun(rs, 2.5);
    console.log('a14-15: arc=' + (arc ? 'YES' : 'no') +
        ' bez=' + (fit ? ('K=' + fit.K + ' res=' + fit.maxRes.toFixed(3)) : 'NULL'));
    ok(fit && fit.maxRes <= 2.5, 'a14-15 fit bezier residuo <=2.5 (raw gate)',
        fit ? 'res=' + fit.maxRes.toFixed(3) + ' K=' + fit.K : 'null');
    if (fit) {
        // residuo vs funzione ideale (come a14 15.1)
        const ideal = x => 300 + 45 * Math.sin(x / 90);
        let maxd = 0;
        for (const sg of fit.bez) for (let j = 0; j <= 16; j++) {
            const t = j / 16, u = 1 - t;
            const x = u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] + 3 * u * t * t * sg[2][0] + t * t * t * sg[3][0];
            const y = u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] + 3 * u * t * t * sg[2][1] + t * t * t * sg[3][1];
            maxd = Math.max(maxd, Math.abs(y - ideal(x)));
        }
        ok(maxd <= 2.5, 'a14-15 residuo vs seno ideale <=2.5', 'maxd=' + maxd.toFixed(3));
    }
}
// arco circolare "irregolare" (drift + jitter): deve cadere in ARC
{
    const rnd = lcg(31);
    const pts = [];
    const cx0 = 400, cy0 = 300, R = 70;
    for (let i = 0; i <= 60; i++) {
        const a = (-140 + (280 * i / 60)) * Math.PI / 180;
        const drift = 1.0 * (i / 60);
        const rr = R + drift + (rnd() - 0.5) * 2;
        pts.push([cx0 + Math.cos(a) * rr, cy0 + Math.sin(a) * rr]);
    }
    const rs = resample(pts, 4);
    const arc = tryArc(rs, pts, 4.3);
    console.log('irreg-arc: ' + (arc ? 'ARC res=' + arc.maxRaw.toFixed(3) : 'NULL'));
    ok(!!arc && arc.maxRaw <= 2.5, 'arco irregolare -> arc fit', arc ? 'maxRaw=' + arc.maxRaw.toFixed(3) : 'null');
}
console.log('\nRISULTATO n22_fitprobe: ' + pass + ' passati, ' + fail + ' falliti');
if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
