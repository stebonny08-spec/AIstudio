'use strict';
/* tests/n22_fitprobe2 - (interno) confronto strategie di fit Bezier
   sui riferimenti a14-15 / u20-8. NON e' una suite: stampa diagnostiche. */
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
    let m = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i], b = poly[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
        if (d < m) m = d;
    }
    return { d: m };
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
function solve(A, b) { // gauss con pivoting
    const n = b.length;
    const M = A.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < n; i++) {
        let p = i;
        for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        const tmp = M[i]; M[i] = M[p]; M[p] = tmp;
        if (Math.abs(M[i][i]) < 1e-12) return null;
        for (let r = 0; r < n; r++) {
            if (r === i) continue;
            const f = M[r][i] / M[i][i];
            for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
        }
    }
    const x = [];
    for (let i = n - 1; i >= 0; i--) {
        let s = M[i][n];
        for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
        x[i] = s / M[i][i];
    }
    return x;
}
/* variante A: tangente fissa (unit) da run LITE, 2 unknowns */
function fitSegT(run, i0, i1, T0, T1) {
    const P0 = run[i0], P3 = run[i1];
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (let i = i0; i <= i1; i++) {
        const tt = (i1 === i0) ? 0 : (i - i0) / (i1 - i0);
        const u = 1 - tt;
        const w0 = u * u * u + 3 * u * u * tt;
        const w3 = 3 * u * tt * tt + tt * tt * tt;
        const bv1 = 3 * u * u * tt, bv2 = 3 * u * tt * tt;
        const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
        const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
        const vx1 = bv1 * T0[0], vy1 = bv1 * T0[1];
        const vx2 = -bv2 * T1[0], vy2 = -bv2 * T1[1];
        a11 += vx1 * vx1 + vy1 * vy1;
        a12 += vx1 * vx2 + vy1 * vy2;
        a22 += vx2 * vx2 + vy2 * vy2;
        b1 += vx1 * bx + vy1 * by;
        b2 += vx2 * bx + vy2 * by;
    }
    const det = a11 * a22 - a12 * a12;
    let s0 = 0, s1 = 0;
    if (Math.abs(det) > 1e-9) {
        s0 = (b1 * a22 - b2 * a12) / det;
        s1 = (a11 * b2 - a12 * b1) / det;
    }
    const Lseg = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]) || 1;
    s0 = Math.max(0.05 * Lseg, Math.min(1.8 * Lseg, s0));
    s1 = Math.max(0.05 * Lseg, Math.min(1.8 * Lseg, s1));
    return [[P0[0], P0[1]], [P0[0] + s0 * T0[0], P0[1] + s0 * T0[1]],
            [P3[0] - s1 * T1[0], P3[1] - s1 * T1[1]], [P3[0], P3[1]]];
}
/* variante B: libero (P1,P2 interi, 4 unknowns) */
function fitSegFree(run, i0, i1) {
    const P0 = run[i0], P3 = run[i1];
    // unknowns: p1x,p1y,p2x,p2y
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const b = [0, 0, 0, 0];
    for (let i = i0; i <= i1; i++) {
        const tt = (i1 === i0) ? 0 : (i - i0) / (i1 - i0);
        const u = 1 - tt;
        const w0 = u * u * u, w1 = 3 * u * u * tt, w2 = 3 * u * tt * tt, w3 = tt * tt * tt;
        const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
        const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
        const J = [w1, 0, w2, 0, 0, w1, 0, w2]; // righe per x e y
        // accumula A += Jx^T Jx separatamente per x e y
        const rows = [
            [w1, 0, w2, 0],
            [0, w1, 0, w2]
        ];
        const rhs = [bx, by];
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 4; c++) {
                for (let d2 = 0; d2 < 4; d2++) A[c][d2] += rows[r][c] * rows[r][d2];
                b[c] += rows[r][c] * rhs[r];
            }
        }
        void J;
    }
    const x = solve(A, b);
    if (!x) return null;
    return [[P0[0], P0[1]], [x[0], x[1]], [x[2], x[3]], [P3[0], P3[1]]];
}
function lite(pts) {
    const sm = pts.map(p => [p[0], p[1]]);
    const cp = pts.map(p => [p[0], p[1]]);
    for (let i = 1; i < pts.length - 1; i++) {
        sm[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
        sm[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
    }
    return sm;
}
function kinkDeg(bez) {
    let mx = 0;
    for (let i = 1; i < bez.length; i++) {
        const e = bez[i - 1], s = bez[i];
        const v1 = [e[3][0] - e[2][0], e[3][1] - e[2][1]];
        const v2 = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
        const a1 = Math.atan2(v1[1], v1[0]), a2 = Math.atan2(v2[1], v2[0]);
        let d = (a2 - a1) * 180 / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        mx = Math.max(mx, Math.abs(d));
    }
    return mx;
}
/* G1: refit con tangenti derivate dal fit LIBERO ai join + tune curvatura */
function projectG1(bez, idx, run) {
    const m = run.length;
    const dirs = [];
    for (let k = 0; k < bez.length; k++) {
        const sg = bez[k];
        dirs.push([sg[1], sg[2]]);   // [P1, P2] del segmento k
    }
    // tangenti unitarie: estremi = chord (fit libero offre direzione ma
    // usiamo chord per stabilita' agli apici), join = media mediata
    const T = [];
    for (let k = 0; k <= bez.length; k++) {
        if (k === 0) {
            const a = run[idx[0]], b = dirs[0][0];
            const v = [b[0] - a[0], b[1] - a[1]];
            const n = Math.hypot(v[0], v[1]) || 1;
            T.push([v[0] / n, v[1] / n]);
        } else if (k === bez.length) {
            const a = dirs[k - 1][1], b = run[idx[k]];
            const v = [b[0] - a[0], b[1] - a[1]];
            const n = Math.hypot(v[0], v[1]) || 1;
            T.push([v[0] / n, v[1] / n]);
        } else {
            const s = bez[k - 1], e = bez[k];
            const v1 = [s[3][0] - s[2][0], s[3][1] - s[2][1]];
            const v2 = [e[1][0] - e[0][0], e[1][1] - e[0][1]];
            const n1 = Math.hypot(v1[0], v1[1]) || 1, n2 = Math.hypot(v2[0], v2[1]) || 1;
            let a1 = Math.atan2(v1[1], v1[0]), a2 = Math.atan2(v2[1], v2[0]);
            let d = a2 - a1;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            const am = a1 + d / 2;
            void n1; void n2;
            T.push([Math.cos(am), Math.sin(am)]);
        }
    }
    const out = [];
    for (let k = 0; k < bez.length; k++) {
        out.push(fitSegT(run, idx[k], idx[k + 1], T[k], T[k + 1]));
    }
    // tune curvatura ai join (2 iterazioni)
    for (let it = 0; it < 2; it++) {
        for (let k = 1; k < out.length; k++) {
            const L = out[k - 1], R = out[k];
            const J = R[0];
            const d = T[k];
            const cL = d[0] * (L[1][1] - J[1]) - d[1] * (L[1][0] - J[0]);
            const cR = d[0] * (R[2][1] - J[1]) - d[1] * (R[2][0] - J[0]);
            if (cL * cR <= 1e-9) continue;        // inflessione al join
            const kL = cL / (1.5 * Math.pow(Math.hypot(L[3][0] - L[2][0], L[3][1] - L[2][1]), 2) || 1);
            const kR = cR / (1.5 * Math.pow(Math.hypot(R[1][0] - R[0][0], R[1][1] - R[0][1]), 2) || 1);
            const kt = (Math.abs(kL) + Math.abs(kR)) / 2 * (cL > 0 ? 1 : -1);
            if (!(Math.abs(kt) > 1e-9)) continue;
            const segL = Math.hypot(L[3][0] - L[0][0], L[3][1] - L[0][1]) || 1;
            const segR = Math.hypot(R[3][0] - R[0][0], R[3][1] - R[0][1]) || 1;
            const sL = Math.sqrt(Math.abs(cL) / (1.5 * Math.abs(kt)));
            const sR = Math.sqrt(Math.abs(cR) / (1.5 * Math.abs(kt)));
            const sLc = Math.max(0.05 * segL, Math.min(1.8 * segL, sL));
            const sRc = Math.max(0.05 * segR, Math.min(1.8 * segR, sR));
            L[2] = [J[0] - d[0] * sLc, J[1] - d[1] * sLc];
            R[1] = [J[0] + d[0] * sRc, J[1] + d[1] * sRc];
        }
    }
    return out;
}
function runFit(name, pts, Ks) {
    const rs = resample(pts, 4);
    const sm = lite(rs);
    const m = rs.length;
    const cum = cumLen(rs), total = cum[m - 1];
    console.log('== ' + name + ' (m=' + m + ') ==');
    for (const mode of ['T', 'F', 'TF']) {
        const out = [];
        for (const K of Ks) {
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
                let sg;
                if (mode === 'T') {
                    let T0, T1;
                    if (i0 === 0) T0 = [sm[2][0] - sm[0][0], sm[2][1] - sm[0][1]];
                    else T0 = [sm[i0 + 2] ? sm[i0 + 2][0] - sm[i0 - 2][0] : sm[i0 + 1][0] - sm[i0 - 1][0],
                               sm[i0 + 2] ? sm[i0 + 2][1] - sm[i0 - 2][1] : sm[i0 + 1][1] - sm[i0 - 1][1]];
                    if (i1 === m - 1) T1 = [sm[m - 1][0] - sm[m - 3][0], sm[m - 1][1] - sm[m - 3][1]];
                    else T1 = [sm[i1 + 2] ? sm[i1 + 2][0] - sm[i1 - 2][0] : sm[i1 + 1][0] - sm[i1 - 1][0],
                               sm[i1 + 2] ? sm[i1 + 2][1] - sm[i1 - 2][1] : sm[i1 + 1][1] - sm[i1 - 1][1]];
                    const n0 = Math.hypot(T0[0], T0[1]) || 1, n1 = Math.hypot(T1[0], T1[1]) || 1;
                    sg = fitSegT(rs, i0, i1, [T0[0] / n0, T0[1] / n0], [T1[0] / n1, T1[1] / n1]);
                } else {
                    sg = fitSegFree(rs, i0, i1);
                }
                if (sg) bez.push(sg);
            }
            if (mode === 'TF') {
                const free = bez.slice();
                const proj = projectG1(free, idx, rs);
                bez.length = 0;
                for (const s of proj) bez.push(s);
            }
            if (bez.length !== K) { out.push('K=' + K + ':segfail'); continue; }
            const ideal = bezPoly(bez, 8);
            let maxRes = 0;
            for (const q of rs) maxRes = Math.max(maxRes, distToPoly(q, ideal).d);
            out.push('K=' + K + ':res=' + maxRes.toFixed(2) + ' kink=' + kinkDeg(bez).toFixed(1));
        }
        console.log('  mode=' + mode + ' ' + out.join(' | '));
    }
}
// u20-8
{
    const rnd = lcg(555);
    const pts = [];
    const aX0 = 260, aW = 130, aSag = 55;
    for (let x = aX0; x <= aX0 + aW; x += 3) {
        const t = (x - aX0) / aW;
        pts.push([x + (rnd() - 0.5) * 2, 300 + aSag * Math.sin(Math.PI * t) + (rnd() - 0.5) * 2]);
    }
    runFit('u20-8', pts, [1, 2, 3, 4, 6, 8]);
}
// a14-15
{
    const rnd = lcg(2024);
    const pts = [];
    for (let x = 80; x <= 700; x += 6) pts.push([x + (rnd() - 0.5) * 2, 300 + 45 * Math.sin(x / 90) + (rnd() - 0.5) * 5]);
    runFit('a14-15', pts, [1, 2, 3, 4, 5, 6, 7, 8]);
}
