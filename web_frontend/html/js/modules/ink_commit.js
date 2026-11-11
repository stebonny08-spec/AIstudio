'use strict';
/* ============================================================
   ink_commit.js — MODULO UNICO ink-commit (PROMPT ROUND 29).
   Implementa Parte 1 (L, K, T, A, F, N) dal comportamento:
   - classificazione AL RILASCIO in coordinate MONDO (zoom-invariante)
     T01 linea / T02 arco / T03 multiflessione / T04 loop /
     T05 chiuso (solo smoothing, MAI cerchio/ellisse/rett) /
     T06 troppo corto (grezzo) / T07 scarabocchio (smoothing leggero)
   - F01-F05 frecce (flick stesso tratto + secondo trattino breve,
     punta triangolare saldata sulla tangente finale dell'asta)
   - nessun ghost, nessun hold-still, nessun riconoscimento forme
     chiuse, nessuna morfosi live: il swap avviene SOLO al commit
     (K01 finestra di assestamento + K02 swap discreto) gestito
     dalla notes.js tramite scheduleCommit/applyCommit.
   Parametri: window.InkCommitCfg (ink_cfg.js, unico file config).
   ============================================================ */
(function () {
    const W = (typeof window !== 'undefined') ? window : globalThis;
    const CFG = Object.assign({
        settleMs: 200, wetTailPx: 30, wetColor: '#a8a8a8',
        shortMinLenPx: 20, shortMinPts: 3,
        lineDevRatio: 0.025, lineStraightRatio: 0.95, lineEndTolPx: 3,
        arcFitTolPx: 4.0, arcFitTolChordRatio: 0.11, arcPerfectTolPx: 1.5,
        arcEndTolPx: 3, arcAngTolDeg: 5,
        arcTanTolDeg: 10, arcMinSweepDeg: 12,
        gapClosedMinPx: 12, gapClosedRatio: 0.08,
        scratchSelfIntMin: 3, scratchDenseRatio: 1.6,
        smoothResamplePx: 4, smoothCornerDeg: 50, smoothClampPx: 1.5,
        smoothIters: 6, smoothLightIters: 3, smoothLightClampPx: 0.9,
        flickWinMs: 250, flickBboxPx: 80, flickMinLegPx: 8,
        flickVAngleDeg: 100, flickBackAngleDeg: 120,
        flickBackWinMs: 120, flickBackWinPx: 35, flickBackArcMinPx: 12,
        flickMinPre: 4, flickMinTail: 3,
        flick2Ms: 300, flick2DistPx: 60, flick2DurMs: 120, flick2LenPx: 60,
        headLenMul: 3.4, headWingDeg: 35, headRoundPx: 0.9,
        shadowHoldMs: 200, shadowOpacity: 0.40, shadowWidthDeltaPx: 0,
        sampleStepPx: 2
    }, W.InkCommitCfg || {});

    // ---------------- geometria base (MONDO) ----------------
    function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
    function pathLen(pts) {
        let L = 0;
        for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
        return L;
    }
    function bbox(pts) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of pts) {
            if (q[0] < x0) x0 = q[0];
            if (q[0] > x1) x1 = q[0];
            if (q[1] < y0) y0 = q[1];
            if (q[1] > y1) y1 = q[1];
        }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    function distPtSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    function distToPoly(p, poly) {
        let m = Infinity, cx = p[0], cy = p[1];
        for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i], b = poly[i + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const qx = a[0] + t * dx, qy = a[1] + t * dy;
            const d = Math.hypot(p[0] - qx, p[1] - qy);
            if (d < m) { m = d; cx = qx; cy = qy; }
        }
        if (!isFinite(m)) return { d: 0, cx: p[0], cy: p[1] };
        return { d: m, cx: cx, cy: cy };
    }
    // auto-intersezioni NON adiacenti (bound 8) — oracolo T04/T07
    function segCross(a, b, c, d) {
        const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
        const o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
        return (o1 * o2 < -1e-9) && (o3 * o4 < -1e-9);
    }
    function selfInt(pts) {
        const n0 = pts.length;
        if (n0 < 4) return 0;
        const stride = n0 > 500 ? Math.ceil(n0 / 400) : 1;
        const P = [];
        for (let i = 0; i < n0; i += stride) P.push(pts[i]);
        if (P[P.length - 1] !== pts[n0 - 1]) P.push(pts[n0 - 1]);
        const n = P.length;
        let cnt = 0;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 3; j < n - 1; j++) {
                if (i === 0 && j === n - 2) continue;
                if (segCross(P[i], P[i + 1], P[j], P[j + 1])) {
                    cnt++;
                    if (cnt >= 8) return cnt;
                }
            }
        }
        return cnt;
    }
    // flessi: cambi segno della derivata della distanza dalla corda con
    // smoothing box + dead-band (>=2 = S/multiflessione, T03)
    function countFlessi(pts) {
        const n = pts.length;
        if (n < 6) return 0;
        const a = pts[0], b = pts[n - 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 15) return 0;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        const Win = Math.max(8, L * 0.10);
        const eps = Math.max(0.5, L * 0.004);
        const t = [], d = [];
        for (let i = 0; i < n; i++) {
            const dx = pts[i][0] - a[0], dy = pts[i][1] - a[1];
            t.push(dx * ux + dy * uy);
            d.push(-uy * dx + ux * dy);
        }
        const ds = [];
        for (let i = 0; i < n; i++) {
            let s = 0, k = 0;
            for (let j = 0; j < n; j++) {
                if (Math.abs(t[j] - t[i]) <= Win) { s += d[j]; k++; }
            }
            ds.push(k ? s / k : d[i]);
        }
        let last = 0, cnt = 0;
        for (let i = 1; i < n; i++) {
            const dd = ds[i] - ds[i - 1];
            if (Math.abs(dd) < eps) continue;
            const sg = dd > 0 ? 1 : -1;
            if (last && sg !== last) cnt++;
            last = sg;
        }
        return cnt;
    }
    function cumLen(pts) {
        const L = [0];
        for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + dist(pts[i - 1], pts[i]));
        return L;
    }
    function resampleUniform(pts, step) {
        if (pts.length < 2 || !(step > 0)) return pts.map(p => [p[0], p[1]]);
        const cum = cumLen(pts);
        const total = cum[cum.length - 1];
        if (!(total > 0)) return [ [pts[0][0], pts[0][1]] ];
        const out = [];
        let j = 0;
        for (let s = 0; s <= total; s += step) {
            while (j < cum.length - 2 && cum[j + 1] < s) j++;
            const seg = cum[j + 1] - cum[j];
            const f = seg > 0 ? (s - cum[j]) / seg : 0;
            out.push([ pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f,
                       pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f ]);
        }
        const lastP = pts[pts.length - 1];
        const outL = out[out.length - 1];
        if (!outL || dist(outL, lastP) > 1e-6) out.push([lastP[0], lastP[1]]);
        return out;
    }
    function meanPts(pts, i0, i1) {
        let x = 0, y = 0, k = 0;
        for (let i = i0; i <= i1 && i < pts.length; i++) { x += pts[i][0]; y += pts[i][1]; k++; }
        return k ? [x / k, y / k] : [pts[0][0], pts[0][1]];
    }
    function norm(v) {
        const n = Math.hypot(v[0], v[1]);
        return n > 1e-9 ? [v[0] / n, v[1] / n] : null;
    }
    function wrapPi(a) {
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
    }
    function angDeg(u, v) {
        const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
        if (!(nu > 0) || !(nv > 0)) return 0;
        const c = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)));
        return Math.acos(c) * 180 / Math.PI;
    }

    // ---------------- T01: fit retta robusto ----------------
    // Theil-Sen (mediana angoli su punti campionati) + PCA; estremi =
    // proiezioni degli estremi STABILI (media primi/ultimi punti).
    function lineFitRobust(pts) {
        const n = pts.length;
        if (n < 2) return null;
        const cen = meanPts(pts, 0, n - 1);
        let sxx = 0, sxy = 0, syy = 0;
        for (const q of pts) {
            const dx = q[0] - cen[0], dy = q[1] - cen[1];
            sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
        }
        sxx /= n; sxy /= n; syy /= n;
        let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const idx = [];
        if (n <= 48) { for (let i = 0; i < n; i++) idx.push(i); }
        else {
            const stp = (n - 1) / 47;
            for (let k = 0; k < 48; k++) idx.push(Math.round(k * stp));
            if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
        }
        const deltas = [];
        for (let i = 0; i < idx.length; i++) {
            for (let j = i + 1; j < idx.length; j++) {
                const p = pts[idx[i]], q = pts[idx[j]];
                const dx = q[0] - p[0], dy = q[1] - p[1];
                if (dx * dx + dy * dy < 1e-12) continue;
                let dd = Math.atan2(dy, dx) - th;
                while (dd > Math.PI / 2) dd -= Math.PI;
                while (dd < -Math.PI / 2) dd += Math.PI;
                deltas.push(dd);
            }
        }
        const cands = [th];
        if (deltas.length >= 10) {
            deltas.sort((a, b) => a - b);
            cands.push(th + deltas[Math.floor(deltas.length / 2)]);
        }
        let best = null;
        for (const tt of cands) {
            const ux = Math.cos(tt), uy = Math.sin(tt);
            let maxPerp = 0, tmin = Infinity, tmax = -Infinity;
            for (const q of pts) {
                const dx = q[0] - cen[0], dy = q[1] - cen[1];
                const perp = Math.abs(-uy * dx + ux * dy);
                if (perp > maxPerp) maxPerp = perp;
                const tv = ux * dx + uy * dy;
                if (tv < tmin) tmin = tv;
                if (tv > tmax) tmax = tv;
            }
            if (!best || maxPerp < best.maxPerp) {
                best = { u: [ux, uy], cen: cen, th: tt,
                         maxPerp: maxPerp, tlen: tmax - tmin };
            }
        }
        return best;
    }
    function projOnLine(p, fit) {
        const dx = p[0] - fit.cen[0], dy = p[1] - fit.cen[1];
        const t = fit.u[0] * dx + fit.u[1] * dy;
        return [fit.cen[0] + fit.u[0] * t, fit.cen[1] + fit.u[1] * t];
    }
    function maxDevFromChord(pts) {
        const a = pts[0], b = pts[pts.length - 1];
        let m = 0;
        for (const q of pts) {
            const d = distPtSeg(q[0], q[1], a[0], a[1], b[0], b[1]);
            if (d > m) m = d;
        }
        return m;
    }
    function fitLine(pts) {
        const n = pts.length;
        const fit = lineFitRobust(pts);
        if (!fit) return null;
        const k0 = Math.min(4, n - 1);
        const k1 = Math.min(4, n - 1);
        const s0 = meanPts(pts, 0, k0);
        const s1 = meanPts(pts, n - 1 - k1, n - 1);
        let e0 = projOnLine(s0, fit);
        let e1 = projOnLine(s1, fit);
        const tol = CFG.lineEndTolPx;
        const ok = dist(e0, s0) <= tol && dist(e1, s1) <= tol &&
                   dist(s0, pts[0]) <= tol && dist(s1, pts[n - 1]) <= tol;
        if (!ok) {
            // fallback: segmento esatto sugli endpoint grezzi (0px di
            // scostamento, retta perfetta comunque garantita)
            e0 = [pts[0][0], pts[0][1]];
            e1 = [pts[n - 1][0], pts[n - 1][1]];
        }
        // orientamento lungo il verso di disegno
        const dtx = pts[n - 1][0] - pts[0][0], dty = pts[n - 1][1] - pts[0][1];
        if ((e1[0] - e0[0]) * dtx + (e1[1] - e0[1]) * dty < 0) {
            const tmp = e0; e0 = e1; e1 = tmp;
        }
        if (dist(e0, e1) < 1) return null;
        return {
            kind: 'line', pts: [e0, e1],
            params: { kind: 'line', p0: e0, p1: e1 },
            end: [e1[0], e1[1]],
            tangent: [e1[0] - e0[0], e1[1] - e0[1]]
        };
    }

    // ---------------- T02: fit cerchio (Kasa) ----------------
    function solve3(A, b) {
        const m = [A[0].slice().concat([b[0]]),
                   A[1].slice().concat([b[1]]),
                   A[2].slice().concat([b[2]])];
        for (let i = 0; i < 3; i++) {
            let piv = i;
            for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
            if (Math.abs(m[piv][i]) < 1e-12) return null;
            const tmp = m[i]; m[i] = m[piv]; m[piv] = tmp;
            for (let r = 0; r < 3; r++) {
                if (r === i) continue;
                const f = m[r][i] / m[i][i];
                for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c];
            }
        }
        return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
    }
    function kasaCircle(pts) {
        let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0,
            Sxxx = 0, Sxyy = 0, Sxxy = 0, Syyy = 0, Sz = 0;
        const n = pts.length;
        for (const q of pts) {
            const x = q[0], y = q[1], z = x * x + y * y;
            Sxx += x * x; Sxy += x * y; Syy += y * y;
            Sx += x; Sy += y; Sz += z;
            Sxxx += x * z; Sxyy += y * z;
            Sxxy += x * x * y; Syyy += y * y * y;
        }
        const sol = solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]],
                            [-Sxxx, -Sxyy, -Sz]);
        if (!sol) return null;
        const cx = -sol[0] / 2, cy = -sol[1] / 2;
        const r2 = cx * cx + cy * cy - sol[2];
        if (!(r2 > 0)) return null;
        const r = Math.sqrt(r2);
        if (!(r > 4)) return null;
        return { cx: cx, cy: cy, r: r };
    }
    function sampleArc(c, a0, sweep) {
        const R = Math.max(1, c.r);
        const step = Math.max(0.008, CFG.sampleStepPx / R); // rad passo
        const m = Math.max(8, Math.ceil(Math.abs(sweep) / step));
        const out = [];
        for (let i = 0; i <= m; i++) {
            const a = a0 + sweep * (i / m);
            out.push([c.cx + R * Math.cos(a), c.cy + R * Math.sin(a)]);
        }
        return out;
    }
    function tryCircleArc(pts, residTol) {
        const tol = (residTol > 0) ? residTol : CFG.arcFitTolPx;
        const n = pts.length;
        const c = kasaCircle(pts);
        if (!c) return null;
        // residuo radiale grezzo->modello
        let resid = 0;
        for (const q of pts) {
            const d = Math.abs(Math.hypot(q[0] - c.cx, q[1] - c.cy) - c.r);
            if (d > resid) resid = d;
        }
        if (resid > tol) return null;
        const p0 = pts[0], pn = pts[n - 1];
        const d0 = Math.abs(Math.hypot(p0[0] - c.cx, p0[1] - c.cy) - c.r);
        const dn = Math.abs(Math.hypot(pn[0] - c.cx, pn[1] - c.cy) - c.r);
        if (d0 > CFG.arcEndTolPx || dn > CFG.arcEndTolPx) return null;
        // sweep grezzo: somma dei delta angolari con unwrap
        let sweepRaw = 0;
        for (let i = 1; i < n; i++) {
            const a0 = Math.atan2(pts[i - 1][1] - c.cy, pts[i - 1][0] - c.cx);
            const a1 = Math.atan2(pts[i][1] - c.cy, pts[i][0] - c.cx);
            sweepRaw += wrapPi(a1 - a0);
        }
        const absSweep = Math.abs(sweepRaw);
        if (absSweep * 180 / Math.PI < CFG.arcMinSweepDeg) return null;
        const sign = sweepRaw >= 0 ? 1 : -1;
        const a0 = Math.atan2(p0[1] - c.cy, p0[0] - c.cx);
        // ampiezza "percepita": allineamento tra sweep grezzo e angolo
        // sotteso dagli endpoint (A02 +-5 gradi)
        let endDelta = wrapPi(Math.atan2(pn[1] - c.cy, pn[0] - c.cx) - a0);
        if (sign > 0 && endDelta < 0) endDelta += 2 * Math.PI;
        if (sign < 0 && endDelta > 0) endDelta -= 2 * Math.PI;
        if (Math.abs((endDelta - sweepRaw) * 180 / Math.PI) > CFG.arcAngTolDeg) return null;
        // tangente endpoint (A03 +-10 gradi) vs direzione locale grezza
        const k = Math.min(3, n - 1);
        const dirIn = norm([pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]]);
        const dirOut = norm([pts[n - 1][0] - pts[n - 1 - k][0],
                             pts[n - 1][1] - pts[n - 1 - k][1]]);
        const tan0 = norm([-Math.sin(a0) * sign, Math.cos(a0) * sign]);
        const aEnd = a0 + sweepRaw;
        const tan1 = norm([-Math.sin(aEnd) * sign, Math.cos(aEnd) * sign]);
        if (dirIn && tan0 && angDeg(dirIn, tan0) > CFG.arcTanTolDeg) return null;
        if (dirOut && tan1 && angDeg(dirOut, tan1) > CFG.arcTanTolDeg) return null;
        const ideal = sampleArc(c, a0, sweepRaw);
        const end = ideal[ideal.length - 1];
        return {
            kind: 'circle', pts: ideal,
            params: { kind: 'circle', cx: c.cx, cy: c.cy, r: c.r,
                      a0: a0, sweep: sweepRaw },
            end: [end[0], end[1]],
            tangent: [Math.cos(aEnd + sign * Math.PI / 2),
                      Math.sin(aEnd + sign * Math.PI / 2)]
        };
    }
    // singola cubica con vincoli di tangente agli endpoint, LSQ lineare
    // nei due parametri di lunghezza maniglia (A03: tangente = direzione
    // locale grezza per costruzione)
    function bezPt(sg, t) {
        const u = 1 - t;
        return [u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] +
                3 * u * t * t * sg[2][0] + t * t * t * sg[3][0],
                u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] +
                3 * u * t * t * sg[2][1] + t * t * t * sg[3][1]];
    }
    function tryBezArc(pts, residTol) {
        const tol = (residTol > 0) ? residTol : CFG.arcFitTolPx;
        const n = pts.length;
        if (n < 5) return null;
        const P0 = [pts[0][0], pts[0][1]];
        const P3 = [pts[n - 1][0], pts[n - 1][1]];
        const chord = dist(P0, P3);
        if (chord < CFG.shortMinLenPx * 0.8) return null;
        const k = Math.min(4, n - 1);
        const T0 = norm([pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]]);
        const T1 = norm([pts[n - 1][0] - pts[n - 1 - k][0],
                         pts[n - 1][1] - pts[n - 1 - k][1]]);
        if (!T0 || !T1) return null;
        const cum = cumLen(pts);
        const total = cum[n - 1];
        if (!(total > 0)) return null;
        // base = blend smoothstep tra P0 e P3 (senza maniglie)
        const C = [[0, 0], [0, 0], [0, 0]];  // A11 A12 / A21 A22 in righe
        const B = [0, 0];
        for (let i = 0; i < n; i++) {
            const s = Math.max(0, Math.min(1, cum[i] / total));
            const b0 = (1 - s) * (1 - s) * (1 + 2 * s);
            const b1 = s * s * (3 - 2 * s);
            const base = [P0[0] * b0 + P3[0] * b1, P0[1] * b0 + P3[1] * b1];
            const r = [pts[i][0] - base[0], pts[i][1] - base[1]];
            const a = 3 * (1 - s) * (1 - s) * s;      // coeff su T0
            const b = -3 * (1 - s) * s * s;            // coeff su T1
            const c = [a * T0[0], a * T0[1]];
            const d = [b * T1[0], b * T1[1]];
            C[0][0] += c[0] * c[0] + c[1] * c[1];
            C[0][1] += c[0] * d[0] + c[1] * d[1];
            C[1][1] += d[0] * d[0] + d[1] * d[1];
            B[0] += c[0] * r[0] + c[1] * r[1];
            B[1] += d[0] * r[0] + d[1] * r[1];
        }
        C[1][0] = C[0][1];
        const det = C[0][0] * C[1][1] - C[0][1] * C[1][0];
        if (Math.abs(det) < 1e-9) return null;
        let u = (B[0] * C[1][1] - B[1] * C[0][1]) / det;
        let v = (C[0][0] * B[1] - C[1][0] * B[0]) / det;
        const lo = 0.05 * chord, hi = 3 * chord;
        u = Math.max(lo, Math.min(hi, u));
        v = Math.max(lo, Math.min(hi, v));
        const seg = [P0, [P0[0] + T0[0] * u, P0[1] + T0[1] * u],
                     [P3[0] - T1[0] * v, P3[1] - T1[1] * v], P3];
        // campione + residuo grezzo->modello
        const dense = [];
        const m = Math.max(24, Math.ceil(total / CFG.sampleStepPx));
        for (let i = 0; i <= m; i++) dense.push(bezPt(seg, i / m));
        let resid = 0;
        for (const q of pts) {
            const d = distToPoly(q, dense).d;
            if (d > resid) resid = d;
        }
        if (resid > tol) return null;
        const tanEnd = [3 * (seg[3][0] - seg[2][0]), 3 * (seg[3][1] - seg[2][1])];
        return {
            kind: 'bez', pts: dense,
            params: { kind: 'bez', p: seg },
            end: [seg[3][0], seg[3][1]],
            tangent: tanEnd
        };
    }
    function fitArc(pts) {
        return tryCircleArc(pts) || tryBezArc(pts);
    }

    // ---------------- T03/T04/T05/T07: smoothing conservativo --------
    // Taubin corner-preserving con rollback: MAI snap, MAI cambio di
    // topologia (auto-intersezioni e flessi invariati, T03/T04).
    function taubinSmooth(pts, mode) {
        const light = (mode === 'light');
        const clampD = light ? CFG.smoothLightClampPx : CFG.smoothClampPx;
        const iters = light ? CFG.smoothLightIters : CFG.smoothIters;
        let sm = resampleUniform(pts, CFG.smoothResamplePx);
        if (sm.length < 5) sm = pts.map(p => [p[0], p[1]]);
        const n = sm.length;
        const siIn = selfInt(pts);
        const flIn = countFlessi(pts);
        const lock = new Array(n).fill(false);
        lock[0] = true;
        lock[n - 1] = true;
        for (let i = 2; i <= n - 3; i++) {
            const a = sm[i - 2], b = sm[i], c = sm[i + 2];
            const v1 = [b[0] - a[0], b[1] - a[1]];
            const v2 = [c[0] - b[0], c[1] - b[1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 1e-9 || n2 < 1e-9) continue;
            const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
            if (ang >= CFG.smoothCornerDeg) lock[i] = true;
        }
        const LAM = 0.5, MU = -0.53;
        const pass = (k) => {
            const cp = sm.map(p => [p[0], p[1]]);
            for (let i = 0; i < n; i++) {
                if (lock[i]) continue;
                let sx = 0, sy = 0, cnt = 0;
                if (i > 0) { sx += cp[i - 1][0]; sy += cp[i - 1][1]; cnt++; }
                if (i < n - 1) { sx += cp[i + 1][0]; sy += cp[i + 1][1]; cnt++; }
                if (!cnt) continue;
                sm[i][0] = cp[i][0] + k * (sx / cnt - cp[i][0]);
                sm[i][1] = cp[i][1] + k * (sy / cnt - cp[i][1]);
            }
        };
        const clampRaw = () => {
            for (let i = 1; i < n - 1; i++) {
                if (lock[i]) continue;
                const d = distToPoly(sm[i], pts);
                if (d.d > clampD && d.d > 0) {
                    const t = clampD / d.d;
                    sm[i][0] = d.cx + (sm[i][0] - d.cx) * t;
                    sm[i][1] = d.cy + (sm[i][1] - d.cy) * t;
                }
            }
        };
        for (let it = 0; it < iters; it++) {
            const before = sm.map(p => [p[0], p[1]]);
            pass(LAM); pass(MU); clampRaw();
            let mv = 0;
            for (let i = 0; i < n; i++) {
                const dd = Math.hypot(sm[i][0] - before[i][0], sm[i][1] - before[i][1]);
                if (dd > mv) mv = dd;
            }
            if (mv < 0.2) break;
        }
        // GUARD topology: auto-intersezioni esattamente invariate e
        // (se >=2) flessi invariati — altrimenti rollback completo
        const siOut = selfInt(sm);
        const flOut = countFlessi(sm);
        if (siOut !== siIn || (flIn >= 2 && flOut < flIn)) {
            return pts.map(p => [p[0], p[1]]);
        }
        return sm;
    }

    // ---------------- F01: rilevamento flick ----------------
    // micro-V finale (finestra 250ms, bbox 80px) o back-stroke
    // (120ms/35px, inversione >=100 gradi) — restituisce l'indice
    // d'inizio del flick o -1.
    function detectFlick(pts, ts) {
        const n = pts.length;
        if (n < 5) return -1;
        const tsOk = ts && ts.length === n;
        let start = 0;
        if (tsOk) {
            const endT = ts[n - 1];
            for (let i = n - 1; i >= 0; i--) {
                if (endT - ts[i] > CFG.flickWinMs) { start = i; break; }
            }
        } else {
            start = Math.max(0, n - Math.ceil(n * 0.4));
        }
        let r = -1;
        const win = pts.slice(start);
        if (win.length >= 4) {
            const bb = bbox(win);
            if (Math.hypot(bb.w, bb.h) <= CFG.flickBboxPx) {
                const defl = (k) => {
                    const v1 = [win[k][0] - win[0][0], win[k][1] - win[0][1]];
                    const v2 = [win[win.length - 1][0] - win[k][0],
                                win[win.length - 1][1] - win[k][1]];
                    const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
                    if (n1 < CFG.flickMinLegPx || n2 < CFG.flickMinLegPx) return -1;
                    const cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
                    return Math.acos(Math.max(-1, Math.min(1, cosang))) * 180 / Math.PI;
                };
                const mid = Math.floor(win.length / 2);
                if (defl(mid) >= CFG.flickVAngleDeg) r = start;
                else {
                    for (let kk = 1; kk < win.length - 1; kk++) {
                        if (kk === mid) continue;
                        if (defl(kk) >= CFG.flickBackAngleDeg) { r = start; break; }
                    }
                }
            }
        }
        if (r >= 0) return r;
        // fallback back-stroke: finestra 120ms/35px in coda
        if (n < 7) return -1;
        let s = n - 1, arc = 0;
        const endT = tsOk ? ts[n - 1] : 0;
        while (s > 0) {
            const seg = dist(pts[s], pts[s - 1]);
            if (arc + seg > CFG.flickBackWinPx) break;
            if (tsOk && endT - ts[s - 1] > CFG.flickBackWinMs) break;
            arc += seg;
            s--;
        }
        if (s < CFG.flickMinPre) return -1;
        if (n - s < CFG.flickMinTail) return -1;
        if (arc < CFG.flickBackArcMinPx) return -1;
        const i0 = Math.max(0, s - 6);
        const din = norm([pts[s][0] - pts[i0][0], pts[s][1] - pts[i0][1]]);
        const dfx = pts[n - 1][0] - pts[s][0], dfy = pts[n - 1][1] - pts[s][1];
        const df = norm([dfx, dfy]);
        const chordOk = !!(din && df && Math.hypot(dfx, dfy) >= 10 &&
            angDeg(din, df) >= CFG.flickBackAngleDeg - 20 &&
            Math.hypot(pts[s][0] - pts[i0][0], pts[s][1] - pts[i0][1]) >= 8);
        if (chordOk) return s;
        // A06 (R31): fallback a INVERSIONE LOCALIZZATA — quando il frame a
        // corda collassa (la finestra si avvolge su se stessa: arco denso +
        // flick di ritorno, ts span < flickWinMs con start=0), cerca lo
        // split con la svolta maggiore dentro [s+1, n-2]: la porzione PRE
        // resta l'asta (quasi tutto l'arco perfezionato), la coda diventa
        // la punta saldata (F02/F03). Le curve lisce non scattano (l'angolo
        // a chord-diventa locale resta piccolo; servono GAMBE reali >=8px).
        let bk = -1, ba = CFG.flickVAngleDeg;
        for (let k = s + 1; k <= n - 2; k++) {
            const v1 = [pts[k][0] - pts[s][0], pts[k][1] - pts[s][1]];
            const v2 = [pts[n - 1][0] - pts[k][0], pts[n - 1][1] - pts[k][1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < CFG.flickMinLegPx || n2 < CFG.flickMinLegPx) continue;
            const ang = angDeg(v1, v2);
            if (ang > ba && k >= CFG.flickMinPre && n - k >= CFG.flickMinTail) {
                ba = ang;
                bk = k;
            }
        }
        if (bk >= 0) return bk;
        return -1;
    }

    // ---------------- F03: punta freccia ----------------
    function planHead(base, tangent, size) {
        const t = norm(tangent);
        if (!t) return null;
        const sp = (size > 0 ? size : 2);
        const L = CFG.headLenMul * sp;
        if (!(L > 1)) return null;
        return { base: [base[0], base[1]], dir: [t[0], t[1]],
                 len: L, wing: CFG.headWingDeg };
    }
    function headPoly(head) {
        if (!head || !head.base || !head.dir) return null;
        const t = norm(head.dir);
        if (!t) return null;
        const nx = -t[1], ny = t[0];
        const a = (head.wing || CFG.headWingDeg) * Math.PI / 180;
        const L = head.len || 8;
        const w = L * Math.sin(a), d = L * Math.cos(a);
        const bx = head.base[0], by = head.base[1];
        return [[bx + w * nx, by + w * ny], [bx + d * t[0], by + d * t[1]],
                [bx - w * nx, by - w * ny]];
    }

    // ---------------- piani di commit ----------------
    function rawPlan(pts) {
        return { raw: true, cls: 'raw', pts: null, params: null,
                 nRaw: pts.length };
    }
    function smoothPlan(pts, cls, mode) {
        const ideal = taubinSmooth(pts, mode);
        const n = ideal.length;
        const end = ideal[n - 1];
        const prev = ideal[Math.max(0, n - 2)];
        return {
            raw: false, cls: cls, pts: ideal,
            params: { kind: 'smooth', mode: mode || 'full',
                      nFlessi: countFlessi(ideal), si: selfInt(ideal) },
            end: [end[0], end[1]],
            tangent: [end[0] - prev[0], end[1] - prev[1]],
            nRaw: pts.length
        };
    }
    function arrowPlan(shaft, head) {
        const params = Object.assign({}, shaft.params);
        params.cls = 'arrow';
        params.head = head;
        params.shaftKind = shaft.cls;
        return {
            raw: false, cls: 'arrow', pts: shaft.pts, params: params,
            end: shaft.end.slice(), tangent: shaft.tangent.slice(),
            nRaw: shaft.nRaw || shaft.pts.length
        };
    }
    // nucleo di classificazione (T01-T07), senza flick (il flick e'
    // gestito dal chiamante sull'intero tratto)
    function classifyCore(pts, opts) {
        const n = pts.length;
        if (n < CFG.shortMinPts || pathLen(pts) < CFG.shortMinLenPx) {
            return rawPlan(pts);
        }
        const bb = bbox(pts);
        const diag = Math.hypot(bb.w, bb.h);
        const si = selfInt(pts);
        const perim = 2 * (bb.w + bb.h);
        const dense = perim > 0 && (pathLen(pts) / perim) >= CFG.scratchDenseRatio;
        // T07: scarabocchio di riempimento — solo smoothing leggero
        if (si >= CFG.scratchSelfIntMin && dense) {
            return smoothPlan(pts, 'freeform', 'light');
        }
        // T05: chiuso — smoothing/regularization SOLO, mai shape snap
        const gap = dist(pts[0], pts[n - 1]);
        const closed = gap <= Math.max(CFG.gapClosedMinPx, CFG.gapClosedRatio * diag);
        if (closed) return smoothPlan(pts, 'closed', 'full');
        // T04: loop / auto-intersezioni — smoothing topologia-preservante
        if (si >= 1) return smoothPlan(pts, 'freeform', 'full');
        // T01/T02/T03 in quest'ordine:
        // - linea SOLO se nessuna inversione significativa (nf<2);
        // - arco: cerchio (tol assoluto) o cubica singola LSQ (tol
        //   relativo alla corda per gli angoli raccordati). Se nf>=2 la
        //   corda e' corta rispetto al percorso (artefatto anche su una
        //   "C" pulita): il cerchio deve essere PERFETTO <=arcPerfectTolPx
        //   per essere arco (A01: anche un arco di280gradi e' arco), una
        //   S reale NON entra mai in fit (T03: solo smoothing);
        // - multiflessione o fit fallito: smoothing conservativo (mai snap).
        const nf = countFlessi(pts);
        const ch = dist(pts[0], pts[n - 1]);
        if (ch >= 1 && nf < 2) {
            const dev = maxDevFromChord(pts);
            const ratio = ch / pathLen(pts);
            if (dev <= CFG.lineDevRatio * ch || ratio >= CFG.lineStraightRatio) {
                const fl = fitLine(pts);
                if (fl) {
                    fl.cls = 'line';
                    fl.nRaw = n;
                    return fl;
                }
            }
        }
        const perfectTol = (nf >= 2) ? CFG.arcPerfectTolPx : CFG.arcFitTolPx;
        let arc = tryCircleArc(pts, perfectTol);
        if (!arc && nf < 2) {
            const bezTol = Math.max(CFG.arcFitTolPx,
                CFG.arcFitTolChordRatio * ch);
            arc = tryBezArc(pts, bezTol);
        }
        if (arc) {
            arc.cls = 'arc';
            arc.nRaw = n;
            return arc;
        }
        // fallback: smoothing conservativo (mai snap)
        return smoothPlan(pts, 'freeform', 'full');
    }
    // API: classifica AL RILASCIO un tratto grezzo (MONDO)
    // opts: {ts, size, noSnap}
    function classify(pts, opts) {
        opts = opts || {};
        if (!pts || pts.length < 2) return rawPlan(pts || []);
        if (opts.noSnap) return rawPlan(pts);
        const n = pts.length;
        if (n < CFG.shortMinPts || pathLen(pts) < CFG.shortMinLenPx) {
            return rawPlan(pts);
        }
        // F01 stesso tratto: micro-V / back-stroke finale -> freccia
        const fi = detectFlick(pts, opts.ts);
        if (fi >= CFG.flickMinPre && n - fi >= CFG.flickMinTail) {
            const pre = pts.slice(0, fi);
            const shaft = classifyCore(pre, opts);
            if (!shaft.raw && shaft.cls !== 'closed') {
                const head = planHead(shaft.end, shaft.tangent,
                                      opts.size || 3);
                if (head) {
                    const ap = arrowPlan(shaft, head);
                    ap.flickFi = fi;
                    return ap;
                }
            }
            // shaft non idealizzabile: classifica il tratto intero
            // (il flick resta parte della geometria, nessuna punta)
        }
        return classifyCore(pts, opts);
    }

    // ---------------- OMBRA (PARTE 1-bis) ----------------
    // Piano dell'anteprima live: SOLO linee (T01), archi semplici (T02)
    // e frecce la cui asta e' linea/arco (G01/G08). Tutto il resto
    // (T03-T07, grezzo) -> nessuna ombra (G04). Non commetta mai (G09):
    // e' solo un piano di rendering, il commit ricalcola al rilascio.
    function shadowPlan(pts, opts) {
        const plan = classify(pts, opts);
        if (!plan || plan.raw) return null;
        if (plan.cls === 'line' || plan.cls === 'arc') return plan;
        if (plan.cls === 'arrow' && plan.params &&
            (plan.params.shaftKind === 'line' ||
             plan.params.shaftKind === 'arc')) return plan;
        return null;
    }

    // ---------------- applicazione del piano (K02/K03) ----------------
    // Applica il piano al tratto: pts -> curva ideale, params salvati
    // (M05), spessore UNIFORME al setting penna (N09), niente wet (N08).
    function applyPlan(o, plan) {
        if (!o || !plan || plan.raw || !plan.pts) {
            if (o) delete o._wet;
            return false;
        }
        o.pts = plan.pts.map(p => [p[0], p[1]]);
        o.params = plan.params;
        o.vclass = plan.cls;
        o.sizes = null;
        o.size = o.base || o.size || 2;
        delete o._wet;
        return true;
    }
    // clone con il piano applicato (snapshot undo/redo e salvataggio:
    // il documento serializzato contiene SEMPRE la versione commessa)
    function materialize(o, plan) {
        if (!o) return o;
        const c = JSON.parse(JSON.stringify(o));
        applyPlan(c, plan);
        return c;
    }
    // residuo punti renderizzati vs modello parametrico (counters/QA)
    function residualOf(o) {
        if (!o || !o.params || !o.pts || o.pts.length < 2) return 0;
        const p = o.params;
        if (p.kind === 'line' && p.p0 && p.p1) {
            let m = 0;
            for (const q of o.pts) {
                const d = distPtSeg(q[0], q[1], p.p0[0], p.p0[1], p.p1[0], p.p1[1]);
                if (d > m) m = d;
            }
            return m;
        }
        if (p.kind === 'circle') {
            let m = 0;
            for (const q of o.pts) {
                const d = Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r);
                if (d > m) m = d;
            }
            return m;
        }
        if (p.kind === 'bez' && p.p) {
            let m = 0;
            for (const q of o.pts) {
                const d = distToPoly(q, sampleBez(p.p, 16)).d;
                if (d > m) m = d;
            }
            return m;
        }
        return 0;   // smooth/freeform: i punti renderizzati SONO l'ideale
    }
    function sampleBez(seg, sub) {
        const out = [];
        for (let j = 0; j <= sub; j++) out.push(bezPt(seg, j / sub));
        return out;
    }
    // informazioni di fine asta (end + tangente) da un piano o da un
    // tratto commesso con params (usato da F01 secondo tratto)
    function endInfo(plan) {
        if (!plan) return null;
        if (plan.end && plan.tangent) {
            return { end: plan.end.slice(), tangent: plan.tangent.slice() };
        }
        return null;
    }

    W.InkCommit = {
        CFG: CFG,
        classify: classify,
        detectFlick: detectFlick,
        planHead: planHead,
        headPoly: headPoly,
        applyPlan: applyPlan,
        materialize: materialize,
        residualOf: residualOf,
        endInfo: endInfo,
        // helpers (test/QA)
        pathLen: pathLen, bbox: bbox, selfInt: selfInt,
        countFlessi: countFlessi, distToPoly: distToPoly,
        kasaCircle: kasaCircle, sampleBez: sampleBez, bezPt: bezPt,
        tryCircleArc: tryCircleArc, tryBezArc: tryBezArc,
        shadowPlan: shadowPlan
    };
})();
