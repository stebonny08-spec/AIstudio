'use strict';
/* tests/n22_fitprobe3 - (interno) valutazione REAL pipeline: emula
   inkEndCleanup (help 0.6) e misura il gate 2.5 vs inkRawRef per il fit
   nuovo (F/TF) e per il baseline R20 (Taubin+Catmull-Rom). */
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
function evalPolyAt(poly, cum, t) {
    const total = cum[cum.length - 1];
    if (t <= 0) return [poly[0][0], poly[0][1]];
    if (t >= total) return [poly[poly.length - 1][0], poly[poly.length - 1][1]];
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < t) i++;
    const seg = (cum[i + 1] - cum[i]) || 1;
    const f = (t - cum[i]) / seg;
    return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * f,
            poly[i][1] + (poly[i + 1][1] - poly[i][1]) * f];
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
function solve(A, b) {
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
function fitSegT(run, i0, i1, T0, T1, w) {
    const P0 = run[i0], P3 = run[i1];
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (let i = i0; i <= i1; i++) {
        const wi = w ? w[i - i0] : 1;
        const tt = (i1 === i0) ? 0 : (i - i0) / (i1 - i0);
        const u = 1 - tt;
        const w0 = u * u * u + 3 * u * u * tt;
        const w3 = 3 * u * tt * tt + tt * tt * tt;
        const bv1 = 3 * u * u * tt, bv2 = 3 * u * tt * tt;
        const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
        const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
        const vx1 = bv1 * T0[0], vy1 = bv1 * T0[1];
        const vx2 = -bv2 * T1[0], vy2 = -bv2 * T1[1];
        a11 += wi * (vx1 * vx1 + vy1 * vy1);
        a12 += wi * (vx1 * vx2 + vy1 * vy2);
        a22 += wi * (vx2 * vx2 + vy2 * vy2);
        b1 += wi * (vx1 * bx + vy1 * by);
        b2 += wi * (vx2 * bx + vy2 * by);
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
function segDist(run, i0, i1, sg) {
    // distanza (x,y) di ogni punto del segmento dalla curva (campionata)
    const samp = bezPoly([sg], 32);
    const out = [];
    for (let i = i0; i <= i1; i++) {
        const q = run[i];
        let m = Infinity, mx = 0, my = 0;
        for (let j = 0; j < samp.length - 1; j++) {
            const a = samp[j], b = samp[j + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const px = a[0] + t * dx, py = a[1] + t * dy;
            const d = Math.hypot(q[0] - px, q[1] - py);
            if (d < m) { m = d; mx = px; my = py; }
        }
        out.push({ d: m, vx: q[0] - mx, vy: q[1] - my });
    }
    return out;
}
function fitSegFree(run, i0, i1, w) {
    const P0 = run[i0], P3 = run[i1];
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const b = [0, 0, 0, 0];
    for (let i = i0; i <= i1; i++) {
        const wi = w ? w[i - i0] : 1;
        const tt = (i1 === i0) ? 0 : (i - i0) / (i1 - i0);
        const u = 1 - tt;
        const w0 = u * u * u, w1 = 3 * u * u * tt, w2 = 3 * u * tt * tt, w3 = tt * tt * tt;
        const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
        const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
        const rows = [[w1, 0, w2, 0], [0, w1, 0, w2]];
        const rhs = [bx, by];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
            for (let d2 = 0; d2 < 4; d2++) A[c][d2] += wi * rows[r][c] * rows[r][d2];
            b[c] += wi * rows[r][c] * rhs[r];
        }
    }
    const x = solve(A, b);
    if (!x) return null;
    return [[P0[0], P0[1]], [x[0], x[1]], [x[2], x[3]], [P3[0], P3[1]]];
}
function projectG1(bez, idx, run, wsegs) {
    const dirs = bez.map(sg => [sg[1], sg[2]]);
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
            void n1; void n2;
            let a1 = Math.atan2(v1[1], v1[0]), a2 = Math.atan2(v2[1], v2[0]);
            let d = a2 - a1;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            const am = a1 + d / 2;
            T.push([Math.cos(am), Math.sin(am)]);
        }
    }
    const out = [];
    for (let k = 0; k < bez.length; k++) out.push(fitSegT(run, idx[k], idx[k + 1], T[k], T[k + 1], wsegs ? wsegs[k] : null));
    // tune curvatura con REVERT se peggiora la fedelta' (epsilon)
    const preTune = out.map(sg => sg.map(p => [p[0], p[1]]));
    const epsOf = (segs) => {
        const ideal = bezPoly(segs, 8);
        let e = 0;
        for (const q of run) e = Math.max(e, distToPoly(q, ideal).d);
        return e;
    };
    const epsPre = epsOf(out);
    for (let it = 0; it < 2; it++) {
        for (let k = 1; k < out.length; k++) {
            const L = out[k - 1], R = out[k];
            const J = R[0], d = T[k];
            const cL = d[0] * (L[1][1] - J[1]) - d[1] * (L[1][0] - J[0]);
            const cR = d[0] * (R[2][1] - J[1]) - d[1] * (R[2][0] - J[0]);
            if (cL * cR <= 1e-9) continue;
            const aL = Math.hypot(L[3][0] - L[2][0], L[3][1] - L[2][1]) || 1;
            const aR = Math.hypot(R[1][0] - R[0][0], R[1][1] - R[0][1]) || 1;
            const kL = cL / (1.5 * aL * aL), kR = cR / (1.5 * aR * aR);
            const kt = (Math.abs(kL) + Math.abs(kR)) / 2 * (cL > 0 ? 1 : -1);
            if (!(Math.abs(kt) > 1e-9)) continue;
            const segL = Math.hypot(L[3][0] - L[0][0], L[3][1] - L[0][1]) || 1;
            const segR = Math.hypot(R[3][0] - R[0][0], R[3][1] - R[0][1]) || 1;
            const sLc = Math.max(0.05 * segL, Math.min(1.8 * segL, Math.sqrt(Math.abs(cL) / (1.5 * Math.abs(kt)))));
            const sRc = Math.max(0.05 * segR, Math.min(1.8 * segR, Math.sqrt(Math.abs(cR) / (1.5 * Math.abs(kt)))));
            L[2] = [J[0] - d[0] * sLc, J[1] - d[1] * sLc];
            R[1] = [J[0] + d[0] * sRc, J[1] + d[1] * sRc];
        }
    }
    if (epsOf(out) > epsPre + 0.02) {
        for (let k = 0; k < out.length; k++) out[k] = preTune[k];
    }
    return out;
}
/* emula inkEndCleanup (help 0.6): raw0 -> smoothing Catmull-Rom 5px/3iter
   + clamp 2.4 -> pts ripuliti */
function cleanupSim(raw0) {
    const rs = resample(raw0, 5);
    if (rs.length < 6) return raw0.map(p => [p[0], p[1]]);
    for (let it = 0; it < 3; it++) {
        const cp = rs.map(p => [p[0], p[1]]);
        for (let i = 1; i < rs.length - 1; i++) {
            rs[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
            rs[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
        }
    }
    const L = cumLen(raw0), LR = cumLen(rs);
    const total = L[L.length - 1] || 0, totalR = LR[LR.length - 1] || 0;
    const out = [];
    for (let i = 0; i < raw0.length; i++) {
        const f = total > 0 ? L[i] / total : 0;
        const q = evalPolyAt(rs, LR, f * totalR);
        const d = distToPoly(q, raw0);
        if (d.d > 2.4 && d.d > 0) {
            const t = (2.4 / d.d) * 0.98;
            q[0] = d.cx + (q[0] - d.cx) * t;
            q[1] = d.cy + (q[1] - d.cy) * t;
        }
        out.push(q);
    }
    out[out.length - 1] = [raw0[raw0.length - 1][0], raw0[raw0.length - 1][1]];
    return out;
}
/* baseline R20: Taubin + corner lock + Catmull-Rom -> bez */
function baselineIdeal(pts, raw) {
    let rs = resample(pts, 4);
    const m = rs.length;
    const locked = new Array(m).fill(false);
    locked[0] = true; locked[m - 1] = true;
    for (let i = 2; i <= m - 3; i++) {
        const a = rs[i - 2], b = rs[i], c = rs[i + 1 + 0];
        const c2 = rs[i + 2] || rs[m - 1];
        void c;
        const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c2[0] - b[0], c2[1] - b[1]];
        const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
        if (n1 < 1e-9 || n2 < 1e-9) continue;
        const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
        const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
        if (ang >= 50) locked[i] = true;
    }
    const lam = 0.5, mu = -0.53;
    for (let it = 0; it < 4; it++) {
        const f = (it % 2 === 0) ? lam : mu;
        const cp = rs.map(q => [q[0], q[1]]);
        for (let i = 1; i < m - 1; i++) {
            if (locked[i]) continue;
            rs[i][0] = cp[i][0] + f * ((cp[i - 1][0] + cp[i + 1][0]) / 2 - cp[i][0]);
            rs[i][1] = cp[i][1] + f * ((cp[i - 1][1] + cp[i + 1][1]) / 2 - cp[i][1]);
        }
    }
    const bez = [];
    for (let i = 0; i < m - 1; i++) {
        const p0 = rs[i], p3 = rs[i + 1];
        const pm = i > 0 ? rs[i - 1] : rs[0];
        const pp = (i + 2 < m) ? rs[i + 2] : rs[m - 1];
        bez.push([[p0[0], p0[1]],
                  [p0[0] + (p3[0] - pm[0]) / 6, p0[1] + (p3[1] - pm[1]) / 6],
                  [p3[0] - (pp[0] - p0[0]) / 6, p3[1] - (pp[1] - p0[1]) / 6],
                  [p3[0], p3[1]]]);
    }
    const ideal = [];
    for (const sg of bez) {
        for (let j = 0; j < 8; j++) {
            const ft = j / 8, u = 1 - ft;
            ideal.push([u * u * u * sg[0][0] + 3 * u * u * ft * sg[1][0] + 3 * u * ft * ft * sg[2][0] + ft * ft * ft * sg[3][0],
                        u * u * u * sg[0][1] + 3 * u * u * ft * sg[1][1] + 3 * u * ft * ft * sg[2][1] + ft * ft * ft * sg[3][1]]);
        }
    }
    ideal.push([bez[bez.length - 1][3][0], bez[bez.length - 1][3][1]]);
    let maxRaw = 0;
    for (const q of raw) maxRaw = Math.max(maxRaw, distToPoly(q, ideal).d);
    return maxRaw;
}
function kinkDeg(bez) {
    let mx = 0;
    for (let i = 1; i < bez.length; i++) {
        const e = bez[i - 1], s = bez[i];
        const v1 = [e[3][0] - e[2][0], e[3][1] - e[2][1]];
        const v2 = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
        let d = (Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0])) * 180 / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        mx = Math.max(mx, Math.abs(d));
    }
    return mx;
}
function evalCase(name, raw0, idealFn) {
    const cleaned = cleanupSim(raw0);
    const rs = resample(cleaned, 4);
    const m = rs.length;
    const cum = cumLen(rs), total = cum[m - 1];
    const baseGate = baselineIdeal(cleaned, raw0);
    console.log('== ' + name + ' (m=' + m + ') baseline maxRes/raw=' + baseGate.toFixed(3));
    const EPS_T = 2.5, RAW_GATE = 3.4;   // R22: eps<=2.5 (vs ripulito), raw<=2.5+amp*1.5
    for (const mode of ['TF', 'F']) {
        let chosen = null;
        for (const K of [1, 2, 3, 4, 5, 6, 8]) {
            const idx = [0];
            for (let k = 1; k < K; k++) {
                const target = total * k / K;
                let i = 1;
                while (i < m - 1 && cum[i] < target) i++;
                idx.push(i);
            }
            idx.push(m - 1);
            const bez = [];
            const wsegs = [];
            let okSeg = true;
            for (let k = 0; k < K; k++) {
                const i0 = idx[k], i1 = idx[k + 1];
                if (i1 <= i0) { okSeg = false; break; }
                let sg = fitSegFree(rs, i0, i1, null);
                let w = null;
                for (let ir = 0; ir < 2 && sg; ir++) {
                    const dv = segDist(rs, i0, i1, sg);
                    let dmax = 0;
                    for (const t of dv) dmax = Math.max(dmax, t.d);
                    if (dmax < 0.05) break;
                    const r01 = t => Math.min(1, t.d / dmax);
                    w = dv.map(t => 1 + 3 * r01(t) * r01(t));
                    sg = fitSegFree(rs, i0, i1, w);
                }
                if (!sg) { okSeg = false; break; }
                bez.push(sg);
                wsegs.push(w);
            }
            if (!okSeg || bez.length !== K) continue;
            if (mode === 'TF') {
                const proj = projectG1(bez, idx, rs, wsegs);
                bez.length = 0;
                for (const s of proj) bez.push(s);
            }
            const ideal = bezPoly(bez, 8);
            let maxRes = 0;
            for (const q of raw0) maxRes = Math.max(maxRes, distToPoly(q, ideal).d);
            let eps = 0;
            for (const q of cleaned) eps = Math.max(eps, distToPoly(q, ideal).d);
            let maxdFn = 0;
            if (idealFn) for (const sg of bez) for (let j = 0; j <= 16; j++) {
                const t = j / 16, u = 1 - t;
                const x = u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] + 3 * u * t * t * sg[2][0] + t * t * t * sg[3][0];
                const y = u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] + 3 * u * t * t * sg[2][1] + t * t * t * sg[3][1];
                maxdFn = Math.max(maxdFn, Math.abs(y - idealFn(x)));
            }
            console.log('    K=' + K + ' gateRaw=' + maxRes.toFixed(3) + ' eps=' + eps.toFixed(3) +
                ' kink=' + kinkDeg(bez).toFixed(1) + ' maxdFn=' + maxdFn.toFixed(2));
            if (eps <= EPS_T && maxRes <= RAW_GATE) {
                chosen = { K, maxRes, eps, kink: kinkDeg(bez), maxdFn };
                break;
            }
            if (K === 8) chosen = { K: null, maxRes, eps, kink: kinkDeg(bez), maxdFn };
        }
        console.log('  mode=' + mode + ' -> ' + (chosen && chosen.K
            ? 'K=' + chosen.K + ' gateRaw=' + chosen.maxRes.toFixed(3) + ' eps=' + chosen.eps.toFixed(3) +
              ' kink=' + chosen.kink.toFixed(1) + ' maxdFn=' + chosen.maxdFn.toFixed(2)
            : 'FAIL best=' + (chosen ? chosen.maxRes.toFixed(2) : '?')));
    }
}
function kasaC(pts) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sx3 = 0, sy3 = 0, sxyy = 0, syxx = 0;
    const n = pts.length;
    for (const p of pts) {
        const x = p[0], y = p[1];
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        sx3 += x * x * x; sy3 += y * y * y; sxyy += x * y * y; syxx += y * x * x;
    }
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
    const B = [-(sx3 + sxyy), -(sy3 + syxx), -(sxx + syy)];
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
/* gate ARCO (R22): Kasa su cleaned, eps vs cleaned, residuo vs raw */
function arcCase(name, raw0) {
    const cleaned = cleanupSim(raw0);
    const rs = resample(cleaned, 4);
    const kc = kasaC(rs);
    if (!kc) { console.log('== ' + name + ' arc: KASA NULL'); return; }
    let eps = 0;
    for (const q of rs) eps = Math.max(eps, Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r));
    let maxRaw = 0;
    for (const q of raw0) maxRaw = Math.max(maxRaw, Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r));
    console.log('== ' + name + ' arc: r=' + kc.r.toFixed(1) + ' eps=' + eps.toFixed(3) + ' raw=' + maxRaw.toFixed(3));
}
// C aperta jitter0 (u20-6) e jitter4 (qaA19)
{
    const mk = (jit, seed) => {
        const rnd = lcg(seed), p = [];
        for (let i = 0; i <= 48; i++) {
            const a = (170 + (280 * i / 48)) * Math.PI / 180;
            p.push([400 + Math.cos(a) * 55 + (rnd() - 0.5) * jit,
                    300 + Math.sin(a) * 55 + (rnd() - 0.5) * jit]);
        }
        return p;
    };
    arcCase('C0 (jit0)', mk(0, 1));
    arcCase('C4 (jit4 qaA19)', mk(4, 1000 + 0 * 7));
    evalCase('C4 bezier', mk(4, 1000 + 0 * 7));
    evalCase('C0 bezier', mk(0, 1));
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
    evalCase('u20-8', pts);
}
// a14-15
{
    const rnd = lcg(2024);
    const pts = [];
    for (let x = 80; x <= 700; x += 6) pts.push([x + (rnd() - 0.5) * 2, 300 + 45 * Math.sin(x / 90) + (rnd() - 0.5) * 5]);
    evalCase('a14-15', pts, x => 300 + 45 * Math.sin(x / 90));
}
