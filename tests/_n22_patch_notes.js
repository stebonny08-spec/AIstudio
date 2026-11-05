'use strict';
/* tests/n22_patch_notes.js - patch one-shot R22 su modules/notes.js
   (BLOCCO 3 rette/archi ricostruiti da zero + BLOCCO 1.1 dock pannello
   Fonti). Idempotente: se i marcatori del DOPO sono gia' presenti, esce
   senza fare nulla. NON e' una suite (viene eliminata dopo l'applicazione). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'notes.js');
let src = fs.readFileSync(FILE, 'utf8');

function fail(msg) { console.error('PATCH FAIL: ' + msg); process.exit(1); }
function once(hay, needle, label) {
    const i = hay.indexOf(needle);
    if (i < 0) fail('marker non trovato: ' + label);
    if (hay.indexOf(needle, i + 1) >= 0) fail('marker non univoco: ' + label);
    return i;
}
/* sostituzione [start,end) con replacement */
function splice(start, end, replacement, label) {
    if (end <= start) fail('range vuoto: ' + label);
    src = src.slice(0, start) + replacement + src.slice(end);
}

const DONE_MARK = '// ===== R22 BLOCCO 3:';
if (src.indexOf(DONE_MARK) >= 0) {
    console.log('PATCH gia applicata: nothing to do');
    process.exit(0);
}

/* ------------------------------------------------------------------
   P1: helper R22 + NUOVO _tryCurve (sostituisce commento + funzione) */
{
    const fnIdx = once(src, 'function _tryCurve(pts, amp, raw) {', '_tryCurve');
    // retrocedi sopra il blocco commenti che precede la funzione
    const before = src.slice(0, fnIdx);
    const lines = before.split('\n');
    let cut = lines.length;
    while (cut > 0) {
        const t = lines[cut - 1].trim();
        if (t.startsWith('//') || t === '') cut--;
        else break;
    }
    const start = lines.slice(0, cut).join('\n').length > 0
        ? lines.slice(0, cut).join('\n').length + 1 : 0;
    const endMark = '    // R20 (7): spessore/pressione del tratto grezzo campionato attorno al';
    const endIdx = once(src, endMark, 'end _tryCurve');
    const NEW = String.raw`
    // ===== R22 BLOCCO 3: rette/archi ricostruiti DA ZERO ==============
    // Solo tratti APERTI: le forme chiuse (gap-closing/corner/ghost)
    // restano con le regole R20 INVARiate. Il tratto grezzo serve SOLO a
    // stimare i parametri; il rendering riparte ex novo dai parametri
    // (punti della curva parametrica, mai il grezzo smussato).
    //
    // --- 3.1 retta robusta: Theil-Sen (mediana angoli coppie) + PCA,
    // scelta sul minore residuo perpendicolare; endpoint = PROIEZIONE
    // sugli estremi reali dei punti -> segmento ideale perfetto.
    function _lineFitRobust(pts, cen0, th0) {
        const n = (pts || []).length;
        if (n < 2) return null;
        let cen = cen0, th = th0;
        if (!cen || th === undefined) {
            cen = _centroid2(pts);
            let sxx = 0, sxy = 0, syy = 0;
            for (const q of pts) {
                const dx = q[0] - cen[0], dy = q[1] - cen[1];
                sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
            }
            sxx /= n; sxy /= n; syy /= n;
            th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        }
        // Theil-Sen: mediana degli angoli (campionati a max ~48 punti)
        // rispetto alla direzione PCA con wrap +-90gradi (una retta e'
        // una direzione non orientata) -> robusto a jitter/outlier
        const idx = [];
        if (n <= 48) { for (let i = 0; i < n; i++) idx.push(i); }
        else {
            const st = (n - 1) / 47;
            for (let k = 0; k < 48; k++) idx.push(Math.round(k * st));
            if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
        }
        const deltas = [];
        for (let i = 0; i < idx.length; i++) {
            for (let j = i + 1; j < idx.length; j++) {
                const p = pts[idx[i]], q = pts[idx[j]];
                const dx = q[0] - p[0], dy = q[1] - p[1];
                if (dx * dx + dy * dy < 1e-12) continue;
                let d = Math.atan2(dy, dx) - th;
                while (d > Math.PI / 2) d -= Math.PI;
                while (d < -Math.PI / 2) d += Math.PI;
                deltas.push(d);
            }
        }
        const cands = [th];
        if (deltas.length >= 10) {
            deltas.sort((a, b) => a - b);
            cands.push(th + deltas[Math.floor(deltas.length / 2)]);
        }
        let best = null;
        for (const t of cands) {
            const ux = Math.cos(t), uy = Math.sin(t);
            let maxPerp = 0, tmin = Infinity, tmax = -Infinity;
            for (const q of pts) {
                const dx = q[0] - cen[0], dy = q[1] - cen[1];
                const perp = Math.abs(-uy * dx + ux * dy);
                if (perp > maxPerp) maxPerp = perp;
                const tt = ux * dx + uy * dy;
                if (tt < tmin) tmin = tt;
                if (tt > tmax) tmax = tt;
            }
            if (!best || maxPerp < best.maxPerp) {
                best = { a: [cen[0] + ux * tmin, cen[1] + uy * tmin],
                         b: [cen[0] + ux * tmax, cen[1] + uy * tmax],
                         th: t, maxPerp: maxPerp, tlen: tmax - tmin };
            }
        }
        return best;
    }
    // solutore lineare piccolo (gauss con pivoting)
    function _solveLin(A, b) {
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
    // campionatura densa di una lista di segmenti cubici
    function _bezDense(bez, sub) {
        const out = [];
        for (let i = 0; i < bez.length; i++) {
            const sg = bez[i];
            for (let j = (i === 0 ? 0 : 1); j <= sub; j++) out.push(_bezPt(sg, j / sub));
        }
        return out;
    }
    // residui (d, vettore corrente) dei punti run[i0..i1] vs segmento
    function _segResiduals(run, i0, i1, sg) {
        const samp = [];
        for (let j = 0; j <= 32; j++) samp.push(_bezPt(sg, j / 32));
        const out = [];
        for (let i = i0; i <= i1; i++) {
            const q = run[i];
            let m = Infinity, mx = q[0], my = q[1];
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
    // fit LSQ LIBERO del segmento cubico (P0/P3 fissati = nodi, P1/P2
    // incognite) con pesi IRLS (spinge sui residui peggiori)
    function _fitSegFree(run, i0, i1, w) {
        const P0 = run[i0], P3 = run[i1];
        const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
        const b = [0, 0, 0, 0];
        const nseg = i1 - i0;
        for (let i = i0; i <= i1; i++) {
            const wi = w ? w[i - i0] : 1;
            const t = nseg > 0 ? (i - i0) / nseg : 0;
            const u = 1 - t;
            const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
            const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
            const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
            const rows = [[w1, 0, w2, 0], [0, w1, 0, w2]];
            const rhs = [bx, by];
            for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
                for (let d2 = 0; d2 < 4; d2++) A[c][d2] += wi * rows[r][c] * rows[r][d2];
                b[c] += wi * rows[r][c] * rhs[r];
            }
        }
        const x = _solveLin(A, b);
        if (!x) return null;
        return [[P0[0], P0[1]], [x[0], x[1]], [x[2], x[3]], [P3[0], P3[1]]];
    }
    // fit con tangenti unitarie fisse ai due estremi (vincolo G1):
    // incognite lunghezze braccia s0,s1 -> sistema 2x2 lineare
    function _fitSegT(run, i0, i1, T0, T1, w) {
        const P0 = run[i0], P3 = run[i1];
        let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
        const nseg = i1 - i0;
        for (let i = i0; i <= i1; i++) {
            const wi = w ? w[i - i0] : 1;
            const t = nseg > 0 ? (i - i0) / nseg : 0;
            const u = 1 - t;
            const w0 = u * u * u + 3 * u * u * t;
            const w3 = 3 * u * t * t + t * t * t;
            const bv1 = 3 * u * u * t, bv2 = 3 * u * t * t;
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
        } else if (a11 > 1e-12) s0 = b1 / a11;
        const Lseg = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]) || 1;
        s0 = Math.max(0.05 * Lseg, Math.min(1.8 * Lseg, s0));
        s1 = Math.max(0.05 * Lseg, Math.min(1.8 * Lseg, s1));
        return [[P0[0], P0[1]], [P0[0] + s0 * T0[0], P0[1] + s0 * T0[1]],
                [P3[0] - s1 * T1[0], P3[1] - s1 * T1[1]], [P3[0], P3[1]]];
    }
    // proiezione G1 sui join (tangenti derivate dal fit libero, media
    // angolare) + tune di curvatura (allinea kappa ai join, 2 iterazioni
    // con REVERT se peggiora la fedelta' eps)
    function _projectG1(bez, idx, run, wsegs) {
        const T = [];
        for (let k = 0; k <= bez.length; k++) {
            if (k === 0) {
                const a = run[idx[0]], b = bez[0][1];
                const v = [b[0] - a[0], b[1] - a[1]];
                const n = Math.hypot(v[0], v[1]) || 1;
                T.push([v[0] / n, v[1] / n]);
            } else if (k === bez.length) {
                const s = bez[k - 1];
                const a = s[2], b = run[idx[k]];
                const v = [b[0] - a[0], b[1] - a[1]];
                const n = Math.hypot(v[0], v[1]) || 1;
                T.push([v[0] / n, v[1] / n]);
            } else {
                const s = bez[k - 1], e = bez[k];
                const v1 = [s[3][0] - s[2][0], s[3][1] - s[2][1]];
                const v2 = [e[1][0] - e[0][0], e[1][1] - e[0][1]];
                let a1 = Math.atan2(v1[1], v1[0]), a2 = Math.atan2(v2[1], v2[0]);
                let d = a2 - a1;
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                const am = a1 + d / 2;
                T.push([Math.cos(am), Math.sin(am)]);
            }
        }
        const out = [];
        for (let k = 0; k < bez.length; k++) {
            out.push(_fitSegT(run, idx[k], idx[k + 1], T[k], T[k + 1],
                              wsegs ? wsegs[k] : null));
        }
        const epsOf = (segs) => {
            const ideal = _bezDense(segs, 8);
            let e = 0;
            for (const q of run) {
                const d = _distToPoly(q, ideal).d;
                if (d > e) e = d;
            }
            return e;
        };
        const preTune = out.map(sg => sg.map(p => [p[0], p[1]]));
        const epsPre = epsOf(out);
        for (let it = 0; it < 2; it++) {
            for (let k = 1; k < out.length; k++) {
                const L = out[k - 1], R = out[k];
                const J = R[0], d = T[k];
                const cL = d[0] * (L[1][1] - J[1]) - d[1] * (L[1][0] - J[0]);
                const cR = d[0] * (R[2][1] - J[1]) - d[1] * (R[2][0] - J[0]);
                if (cL * cR <= 1e-9) continue;   // inflessione al join: skip
                const aL = Math.hypot(L[3][0] - L[2][0], L[3][1] - L[2][1]) || 1;
                const aR = Math.hypot(R[1][0] - R[0][0], R[1][1] - R[0][1]) || 1;
                const kL = cL / (1.5 * aL * aL), kR = cR / (1.5 * aR * aR);
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
        if (epsOf(out) > epsPre + 0.02) {
            for (let k = 0; k < out.length; k++) out[k] = preTune[k];
        }
        return out;
    }
    // fit Bezier cubico pezzo-pezzo: K segmenti crescenti con nodi a
    // lunghezza uniforme; per segmento LSQ libero + IRLS, poi G1+curva.
    // Accettazione: eps (ideale -> run) <= epsT E, se fornito, residuo
    // GREZZO->ideale <= rawT (il gate crudo viene rivalutato a ogni K).
    function _fitBezierRun(run, epsT, rawT, src) {
        const m = run.length;
        if (m < 4) return null;
        const cum = _cumLen(run), total = cum[m - 1];
        if (!(total > 0)) return null;
        const rawOf = (segs) => {
            if (rawT == null || !src) return 0;
            const dense = _bezDense(segs, 16);
            let mr = 0;
            for (const q of src) {
                const d = _distToPoly(q, dense).d;
                if (d > mr) mr = d;
            }
            return mr;
        };
        const Kmax = Math.max(1, Math.min(10, Math.floor(m / 3)));
        for (let K = 1; K <= Kmax; K++) {
            if (K > 1 && m < K * 3 + 2) break;
            const idx = [0];
            let bad = false;
            for (let k = 1; k < K; k++) {
                const target = total * k / K;
                let i = idx[idx.length - 1] + 1;
                while (i < m - 1 && cum[i] < target) i++;
                if (i >= m - 1) { bad = true; break; }
                idx.push(i);
            }
            if (bad || idx.length !== K) continue;
            idx.push(m - 1);
            const bez = [], wsegs = [];
            for (let k = 0; k < K; k++) {
                const i0 = idx[k], i1 = idx[k + 1];
                if (i1 <= i0) { bad = true; break; }
                let sg = _fitSegFree(run, i0, i1, null);
                let w = null;
                for (let ir = 0; ir < 2 && sg; ir++) {
                    const dv = _segResiduals(run, i0, i1, sg);
                    let dmax = 0;
                    for (const t of dv) if (t.d > dmax) dmax = t.d;
                    if (dmax < 0.05) break;
                    w = dv.map(t => {
                        const q = Math.min(1, t.d / dmax);
                        return 1 + 3 * q * q;
                    });
                    sg = _fitSegFree(run, i0, i1, w);
                }
                if (!sg) { bad = true; break; }
                bez.push(sg); wsegs.push(w);
            }
            if (bad || bez.length !== K) continue;
            const proj = _projectG1(bez, idx, run, wsegs);
            const ideal = _bezDense(proj, 8);
            let eps = 0;
            for (const q of run) {
                const d = _distToPoly(q, ideal).d;
                if (d > eps) eps = d;
            }
            if (eps <= epsT && rawOf(proj) <= rawT) {
                return { bez: proj, eps: eps, K: K };
            }
            // fallback: fit libero (senza G1) con kink <= 15gradi
            const freeIdeal = _bezDense(bez, 8);
            let epsF = 0;
            for (const q of run) {
                const d = _distToPoly(q, freeIdeal).d;
                if (d > epsF) epsF = d;
            }
            if (epsF <= epsT && rawOf(bez) <= rawT) {
                let kink = 0;
                for (let i = 1; i < bez.length; i++) {
                    const e = bez[i - 1], s = bez[i];
                    const v1 = [e[3][0] - e[2][0], e[3][1] - e[2][1]];
                    const v2 = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
                    let dd = (Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0])) * 180 / Math.PI;
                    while (dd > 180) dd -= 360;
                    while (dd < -180) dd += 360;
                    if (Math.abs(dd) > kink) kink = Math.abs(dd);
                }
                if (kink <= 15) return { bez: bez, eps: epsF, K: K };
            }
        }
        return null;
    }
    // approssimazione cubica dell'arco (segmenti <= 90gradi, k=4/3 tg/4)
    function _bezFromArc(ac) {
        const span = ac.a1 - ac.a0;
        const nSeg = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2)));
        const bez = [];
        for (let i = 0; i < nSeg; i++) {
            const s0 = ac.a0 + span * i / nSeg;
            const s1 = ac.a0 + span * (i + 1) / nSeg;
            const d = s1 - s0;
            const k = 4 / 3 * Math.tan(d / 4);
            const c0 = [ac.cx + ac.r * Math.cos(s0), ac.cy + ac.r * Math.sin(s0)];
            const c3 = [ac.cx + ac.r * Math.cos(s1), ac.cy + ac.r * Math.sin(s1)];
            bez.push([c0,
                      [c0[0] - k * ac.r * Math.sin(s0), c0[1] + k * ac.r * Math.cos(s0)],
                      [c3[0] + k * ac.r * Math.sin(s1), c3[1] - k * ac.r * Math.cos(s1)],
                      c3]);
        }
        return bez;
    }
    // --- 3.2 ARCO: fit algebrico Kasa sui parametri + coerenza della
    // curvatura (monotonia' angolare sul centro fit; gli S si invertono).
    // La curva ideale viene RICAMPIONATA dall'equazione del cerchio.
    function _tryArcFit(rs, src, epsT, rawT) {
        const m = rs.length;
        if (m < 8) return null;
        const kc = kasaCircle(rs);
        if (!kc || kc.r < 12 || kc.r > 4000) return null;
        let eps = 0;
        for (const q of rs) {
            const d = Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r);
            if (d > eps) eps = d;
        }
        if (eps > epsT) return null;
        // passata (1,2,1)/4 SOLO per la stima angolare (mai nel rendering)
        const sm = rs.map(p => [p[0], p[1]]);
        const cp = rs.map(p => [p[0], p[1]]);
        for (let i = 1; i < m - 1; i++) {
            sm[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
            sm[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
        }
        let prev = Math.atan2(sm[0][1] - kc.cy, sm[0][0] - kc.cx);
        const a0 = prev;
        let unw = prev;
        const ds = [];
        for (let i = 1; i < m; i++) {
            const a = Math.atan2(sm[i][1] - kc.cy, sm[i][0] - kc.cx);
            let d = a - prev;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            if (Math.abs(d) > Math.PI / 3) return null;   // salto angolare
            unw += d; ds.push(d);
            prev = a;
        }
        const sig = [];
        for (const d of ds) if (Math.abs(d) > 1.5 * Math.PI / 180) sig.push(d);
        if (sig.length < 4) return null;
        let nPos = 0;
        for (const d of sig) if (d > 0) nPos++;
        const frac = Math.max(nPos, sig.length - nPos) / sig.length;
        let totDeg = 0;
        for (const d of ds) totDeg += Math.abs(d) * 180 / Math.PI;
        if (frac < 0.9) return null;
        if (totDeg < 40 || totDeg > 350) return null;
        const span = Math.abs(unw - a0);
        if (span < 40 * Math.PI / 180 || span > 350 * Math.PI / 180) return null;
        // ricampionatura ideale EX NOVO dall'equazione (passo ~4px)
        const N = Math.max(6, Math.min(400, Math.round(span * kc.r / 4)));
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const a = a0 + (unw - a0) * (i / N);
            pts.push([kc.cx + kc.r * Math.cos(a), kc.cy + kc.r * Math.sin(a)]);
        }
        // gate 2: residuo GREZZO -> arco ideale
        let maxRes = 0;
        for (const q of src) {
            const d = _distToPoly(q, pts).d;
            if (d > maxRes) maxRes = d;
        }
        if (maxRes > rawT) return null;
        const arc = { cx: kc.cx, cy: kc.cy, r: kc.r,
                      a0: a0, a1: unw, ccw: (unw - a0) > 0 };
        return { arc: arc, bez: _bezFromArc(arc), pts: pts,
                 eps: eps, maxRes: maxRes };
    }
    // ===== R22: riconoscimento tratti APERTI ricostruiti DA ZERO =====
    // - rette: _lineFitRobust (da recognizeStroke/_fitShaftPre)
    // - archi coerenti: Kasa + ricampionatura circolare ex novo
    // - curve: fit Bezier cubico LSQ pezzo-pezzo (IRLS) + continuita' G1
    //   ai join + tune di curvatura (revert se peggiora la fedelta')
    // Gate R22: eps (ideale -> tracciato ripulito) <= 2.5px; residuo
    // GREZZO->ideale <= 2.5 + amp*1.5 (a amp=0 resta il gate duro R20).
    function _tryCurve(pts, amp, raw) {
        const n = (pts || []).length;
        if (n < 5) { if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'n', n: n }); return null; }
        const bb = _bbox(pts);
        if (Math.hypot(bb.w, bb.h) < 40) { if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'bb', d: +Math.hypot(bb.w, bb.h).toFixed(1) }); return null; }
        const src = (raw && raw.length === n) ? raw : pts;
        let rs = _resampleUniform(pts, 4);
        if (rs.length < 8) rs = _resampleUniform(pts, 2);
        if (rs.length < 6) { if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'rs', n: rs.length }); return null; }
        const m = rs.length;
        const epsT = 2.5;
        const rawT = 2.5 + (amp || 0) * 1.5;
        // (a) rilevamento ANGOLI: svolta su gambe 8px >= 50gradi (R20,
        //     invariato): il corner viene tagliato e i run fittati a
        //     tratti con continuita' G1 SOLO all'interno del run
        const locked = new Array(m).fill(false);
        locked[0] = true;
        locked[m - 1] = true;
        for (let i = 2; i <= m - 3; i++) {
            const a = rs[i - 2], b = rs[i], c = rs[i + 2];
            const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 1e-9 || n2 < 1e-9) continue;
            const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
            if (ang >= 50) locked[i] = true;
        }
        const cuts = [];
        for (let i = 1; i <= m - 2; i++) if (locked[i]) cuts.push(i);
        const runs = [];
        {
            let start = 0;
            for (const c of cuts) {
                if (c > start) { runs.push(rs.slice(start, c + 1)); start = c; }
            }
            runs.push(rs.slice(start));
        }
        const segs = (runs.length >= 1 && runs.every(r => r.length >= 4))
            ? runs : [rs];
        let bez = null, arc = null, ideal = null;
        // (b) ARCO: solo tratto unico (nessun angolo interno)
        if (segs.length === 1) {
            const A = _tryArcFit(segs[0], src, epsT, rawT);
            if (A) { arc = A.arc; bez = A.bez; ideal = A.pts; }
        }
        if (!bez) {
            bez = [];
            let okFit = true;
            const single = segs.length === 1;
            for (const run of segs) {
                const f = _fitBezierRun(run, epsT,
                    single ? rawT : null, single ? src : null);
                if (!f) { okFit = false; break; }
                for (const sg of f.bez) bez.push(sg);
            }
            if (!okFit) {
                if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'fit', n: n, m: m });
                return null;
            }
            ideal = _bezDense(bez, 16);
            if (ideal.length < 2) return null;
        }
        // gate: residuo GREZZO->ideale (R22: 2.5 + amp*1.5)
        let maxRes = 0, wi = 0;
        for (let i = 0; i < src.length; i++) {
            const d = _distToPoly(src[i], ideal).d;
            if (d > maxRes) { maxRes = d; wi = i; }
        }
        if (maxRes > rawT) {
            if (window.__ink) window.__ink.trace.push({ k: 'dbgC',
                g: 'res', r: +maxRes.toFixed(2), n: n, raw: raw ? 1 : 0,
                m: m, tol: +rawT.toFixed(2), wi: wi });
            return null;
        }
        if (window.__ink) {
            let maxResP = 0;
            for (const q of pts) {
                const d = _distToPoly(q, ideal).d;
                if (d > maxResP) maxResP = d;
            }
            window.__ink.trace.push({ k: 'dbgC',
                g: maxRes > 2.5 ? 'res' : 'ok', r: +maxRes.toFixed(2), n: n,
                raw: raw ? 1 : 0, m: m, rp: +maxResP.toFixed(2), wi: wi,
                arc: arc ? 1 : 0,
                e0: [+pts[0][0].toFixed(1), +pts[0][1].toFixed(1)],
                e1: [+pts[n - 1][0].toFixed(1), +pts[n - 1][1].toFixed(1)],
                r0: [+rs[0][0].toFixed(1), +rs[0][1].toFixed(1)],
                r1: [+rs[rs.length - 1][0].toFixed(1), +rs[rs.length - 1][1].toFixed(1)] });
        }
        const params = arc ? { bez: bez, arc: arc } : { bez: bez };
        return { kind: 'curve', box: _bbox(ideal), rot: 0,
                 pts: ideal, params: params };
    }
`;
    splice(start, endIdx, NEW, 'P1 tryCurve+helpers');
}

/* ------------------------------------------------------------------
   P2: recognizeStroke -> LINE fit robusto (Theil-Sen + PCA) */
{
    const a = once(src, '        // --- LINE (R14): fit minimi quadrati sugli endpoint + residuo', 'P2 start');
    const b = once(src, '        // --- R20 (3): CHIUSURA con gap-closing esplicito ---------------', 'P2 end');
    const NEW = `        // --- LINE (R22): fit robusto Theil-Sen + PCA con proiezione
        //     sugli endpoint reali dei punti -> segmento IDEALE esatto;
        //     residuo perpendicolare grezzo->ideale entro 2.5+amp*3
        const LF = _lineFitRobust(pts, cen, th);
        if (LF && LF.maxPerp <= tol && LF.tlen >= 40) {
            const lb = _bbox([LF.a, LF.b]);
            return { kind: 'line', box: lb, rot: LF.th * 180 / Math.PI,
                     pts: [LF.a, LF.b], params: {} };
        }
`;
    splice(a, b, NEW, 'P2 line recognize');
}

/* ------------------------------------------------------------------
   P3: _fitShaftPre -> LINE fit robusto */
{
    const a = once(src, '        // --- LINE: fit minimi quadrati (PCA) + residuo perpendicolare ---', 'P3 start');
    const b = once(src, '        // --- CURVE: fit Bezier U2 (_tryCurve) con gate residuo GREZZO->', 'P3 end');
    const NEW = `        // --- LINE (R22): fit robusto Theil-Sen + PCA, endpoint =
        //     proiezione sugli estremi reali; stesse soglie R20 F2
        const LF = _lineFitRobust(pre);
        if (LF && LF.maxPerp <= tol &&
            (LF.tlen >= 40 || (LF.tlen >= 24 && LF.maxPerp <= 1.5))) {
            let a = LF.a, b = LF.b;
            // orientamento lungo il verso di disegno (la punta va alla FINE)
            const dtx = pre[n - 1][0] - pre[0][0], dty = pre[n - 1][1] - pre[0][1];
            if ((b[0] - a[0]) * dtx + (b[1] - a[1]) * dty < 0) {
                const tmp = a; a = b; b = tmp;
            }
            if (window.__ink) window.__ink.trace.push({ k: 'dbgfS', out: 'line',
                n: n, mp: +LF.maxPerp.toFixed(2), tR: +LF.tlen.toFixed(1),
                tol: +tol.toFixed(2) });
            return { kind: 'line', pts: [a, b] };
        }
`;
    splice(a, b, NEW, 'P3 line shaft');
}

/* ------------------------------------------------------------------
   P4: buildArrowRec -> propagazione params.arc (asta circolare ideale) */
{
    const a = once(src,
        '        const shaft = { kind: fit.kind, pts: shaftPts };\n' +
        '        const params = { shaft: shaft, head: head };',
        'P4 start');
    const NEW = `        const shaft = { kind: fit.kind, pts: shaftPts };
        const params = { shaft: shaft, head: head };
        if (fit.params && fit.params.arc) {
            // R22: arco ideale condiviso fra asta e top-level (stesso
            // riferimento: move/scale lo trasformano UNA volta)
            params.arc = fit.params.arc;
            shaft.arc = fit.params.arc;
        }`;
    splice(a, a + ('        const shaft = { kind: fit.kind, pts: shaftPts };\n' +
        '        const params = { shaft: shaft, head: head };').length,
        NEW, 'P4 arrow arc');
}

/* ------------------------------------------------------------------
   P5: convertTargetToArrow -> porta params.arc del target */
{
    const a = once(src,
        "            shaft = { kind: 'curve',\n" +
        "                      pts: (tgt.pts || []).map(q => [q[0], q[1]]),\n" +
        "                      bez: tgt.params.bez };",
        'P5 start');
    const NEW = `            shaft = { kind: 'curve',
                      pts: (tgt.pts || []).map(q => [q[0], q[1]]),
                      bez: tgt.params.bez,
                      arc: tgt.params.arc };`;
    splice(a, a + ("            shaft = { kind: 'curve',\n" +
        "                      pts: (tgt.pts || []).map(q => [q[0], q[1]]),\n" +
        "                      bez: tgt.params.bez };").length, NEW, 'P5 convert arc');
    const c = once(src, '        if (shaft.bez) params.bez = shaft.bez;', 'P5 params');
    const NEW2 = `        if (shaft.bez) params.bez = shaft.bez;
        if (shaft.arc) params.arc = shaft.arc;`;
    splice(c, c + '        if (shaft.bez) params.bez = shaft.bez;'.length, NEW2, 'P5 params arc');
}

/* ------------------------------------------------------------------
   P6: drawShape -> shim arrow con arc + branch di rendering arco */
{
    const a = once(src,
        "            const shim = { t: 'shape', kind: (sf.kind === 'curve') ? 'curve' : 'line',\n" +
        "                           color: o.color, size: o.size, alpha: o.alpha,\n" +
        "                           pts: sf.pts, sizes: o.sizes,\n" +
        "                           params: (sf.bez ? { bez: sf.bez } : {}) };",
        'P6 shim');
    const NEW = `            const shim = { t: 'shape', kind: (sf.kind === 'curve') ? 'curve' : 'line',
                           color: o.color, size: o.size, alpha: o.alpha,
                           pts: sf.pts, sizes: o.sizes,
                           params: ((sf.bez || sf.arc)
                               ? { bez: sf.bez, arc: sf.arc } : {}) };`;
    splice(a, a + ("            const shim = { t: 'shape', kind: (sf.kind === 'curve') ? 'curve' : 'line',\n" +
        "                           color: o.color, size: o.size, alpha: o.alpha,\n" +
        "                           pts: sf.pts, sizes: o.sizes,\n" +
        "                           params: (sf.bez ? { bez: sf.bez } : {}) };").length,
        NEW, 'P6 shim new');

    const b = once(src, "        } else if (o.kind === 'curve' && pr.bez && pr.bez.length) {", 'P6 arc branch');
    const NEW2 = `        } else if (o.kind === 'curve' && pr.arc && pr.arc.cx !== undefined) {
            // R22 B3: arco IDEALE tracciato dall'equazione del cerchio
            // (params.arc), MAI dal grezzo; con spessore variabile si
            // sottocampiona per settori angolari fra i nodi (~4px)
            const ac = pr.arc;
            const R = Math.max(1, ac.r);
            ctx.lineWidth = Math.max(1, o.size || 2);
            if (varyPoly) {
                for (let i = 1; i < polyPts.length; i++) {
                    const a0s = Math.atan2(polyPts[i - 1][1] - ac.cy,
                                           polyPts[i - 1][0] - ac.cx);
                    const a1s = Math.atan2(polyPts[i][1] - ac.cy,
                                           polyPts[i][0] - ac.cx);
                    let dd = a1s - a0s;
                    while (dd > Math.PI) dd -= 2 * Math.PI;
                    while (dd < -Math.PI) dd += 2 * Math.PI;
                    ctx.lineWidth = Math.max(0.5, (sz[i - 1] + sz[i]) / 2);
                    ctx.beginPath();
                    ctx.ellipse(ac.cx, ac.cy, R, R, 0, a0s, a0s + dd, false);
                    ctx.stroke();
                }
            } else {
                let dd = ac.a1 - ac.a0;
                if (ac.ccw) { while (dd < 0) dd += 2 * Math.PI; }
                else { while (dd > 0) dd -= 2 * Math.PI; }
                ctx.beginPath();
                ctx.ellipse(ac.cx, ac.cy, R, R, 0, ac.a0, ac.a0 + dd, false);
                ctx.stroke();
            }
            if (o.arrow && polyPts) {
                ctx.lineWidth = Math.max(1, o.size || 2);
                drawArrowHead(ctx, polyPts[polyPts.length - 2],
                              polyPts[polyPts.length - 1],
                              Math.max(6, (o.size || 2) * 3.2));
            }
        } else if (o.kind === 'curve' && pr.bez && pr.bez.length) {`;
    splice(b, b + "        } else if (o.kind === 'curve' && pr.bez && pr.bez.length) {".length,
        NEW2, 'P6 arc render');
}

/* ------------------------------------------------------------------
   P7: moveObj -> trasla params.arc e shaft.arc */
{
    const a = once(src, '                if (o.params.cx !== undefined) { o.params.cx += dx; o.params.cy += dy; }', 'P7 a');
    const NEW = `                if (o.params.cx !== undefined) { o.params.cx += dx; o.params.cy += dy; }
                if (o.params.arc && o.params.arc.cx !== undefined) {
                    o.params.arc.cx += dx; o.params.arc.cy += dy;
                }`;
    splice(a, a + '                if (o.params.cx !== undefined) { o.params.cx += dx; o.params.cy += dy; }'.length,
        NEW, 'P7 arc move');

    const c = once(src,
        '                    if (sf.bez && sf.bez !== o.params.bez) {\n' +
        '                        for (const sgb of sf.bez) {\n' +
        '                            for (const pb of sgb) { pb[0] += dx; pb[1] += dy; }\n' +
        '                        }\n' +
        '                    }', 'P7 c');
    const old = '                    if (sf.bez && sf.bez !== o.params.bez) {\n' +
        '                        for (const sgb of sf.bez) {\n' +
        '                            for (const pb of sgb) { pb[0] += dx; pb[1] += dy; }\n' +
        '                        }\n' +
        '                    }';
    const NEW2 = old + `
                    if (sf.arc && sf.arc !== o.params.arc &&
                        sf.arc.cx !== undefined) {
                        sf.arc.cx += dx; sf.arc.cy += dy;
                    }`;
    splice(c, c + old.length, NEW2, 'P7 shaft arc move');
}

/* ------------------------------------------------------------------
   P8: scaleObj -> scala params.arc e shaft.arc */
{
    const a = once(src, '                if (pr.r !== undefined) pr.r = Math.max(3, pr.r * k);', 'P8 a');
    const NEW = `                if (pr.r !== undefined) pr.r = Math.max(3, pr.r * k);
                if (pr.arc && pr.arc.cx !== undefined) {
                    pr.arc.cx = c.x + (pr.arc.cx - c.x) * k;
                    pr.arc.cy = c.y + (pr.arc.cy - c.y) * k;
                    pr.arc.r = Math.max(3, pr.arc.r * k);
                }`;
    splice(a, a + '                if (pr.r !== undefined) pr.r = Math.max(3, pr.r * k);'.length,
        NEW, 'P8 arc scale');

    const c = once(src,
        '                    if (sf.bez && sf.bez !== pr.bez) {\n' +
        '                        for (const sgb of sf.bez) {\n' +
        '                            for (const pb of sgb) {\n' +
        '                                pb[0] = c.x + (pb[0] - c.x) * k;\n' +
        '                                pb[1] = c.y + (pb[1] - c.y) * k;\n' +
        '                            }\n' +
        '                        }\n' +
        '                    }', 'P8 c');
    const old = '                    if (sf.bez && sf.bez !== pr.bez) {\n' +
        '                        for (const sgb of sf.bez) {\n' +
        '                            for (const pb of sgb) {\n' +
        '                                pb[0] = c.x + (pb[0] - c.x) * k;\n' +
        '                                pb[1] = c.y + (pb[1] - c.y) * k;\n' +
        '                            }\n' +
        '                        }\n' +
        '                    }';
    const NEW2 = old + `
                    if (sf.arc && sf.arc !== pr.arc &&
                        sf.arc.cx !== undefined) {
                        sf.arc.cx = c.x + (sf.arc.cx - c.x) * k;
                        sf.arc.cy = c.y + (sf.arc.cy - c.y) * k;
                        sf.arc.r = Math.max(3, sf.arc.r * k);
                    }`;
    splice(c, c + old.length, NEW2, 'P8 shaft arc scale');
}

/* ------------------------------------------------------------------
   P9: CSS BLOCCO 1.1 - z-index controlli >= pannello Fonti (11) */
{
    const subs = [
        ['border-radius:999px;padding:6px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:9;',
         'border-radius:999px;padding:6px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:12;',
         'fn-pill z'],
        ['gap:8px;padding:8px 10px;z-index:10;pointer-events:none;',
         'gap:8px;padding:8px 10px;z-index:12;pointer-events:none;',
         'fn-top z'],
        ['z-index:9;color:#e8ecf4;box-shadow:0 6px 16px rgba(0,0,0,.3);',
         'z-index:12;color:#e8ecf4;box-shadow:0 6px 16px rgba(0,0,0,.3);',
         'fn-zoom z'],
        ['transform:translateX(-50%);display:flex;align-items:center;gap:4px;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:5px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:9;',
         'transform:translateX(-50%);display:flex;align-items:center;gap:4px;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:5px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:12;',
         'fn-pages z']
    ];
    for (const [o, nw, label] of subs) {
        const i = once(src, o, label);
        if (src.indexOf(o, i + 1) >= 0) fail('marker non univoco: ' + label);
        splice(i, i + o.length, nw, label);
    }
}

/* ------------------------------------------------------------------
   P10: toggleFonti -> dock SOTTO toolbar (offset dinamico bottom pill +
   bottom zoom + 10px; fallback CSS top:152px quando i rect non sono
   misurabili, es. jsdom) */
{
    const a = once(src,
        "        const want = (force === undefined)\n" +
        "            ? !ed.fontiRoot.classList.contains('show') : !!force;\n" +
        "        ed.fontiRoot.classList.toggle('show', want);", 'P10');
    const old = "        const want = (force === undefined)\n" +
        "            ? !ed.fontiRoot.classList.contains('show') : !!force;\n" +
        "        ed.fontiRoot.classList.toggle('show', want);";
    const NEW = old + `
        if (want) {
            // R22 B1.1: dock SOTTO la toolbar sinistra = offset dinamico
            // bottom(.fn-pill-left)/bottom(.fn-zoom) + 10px (fallback CSS
            // top:152px): il pannello NON copre mai undo/redo e comandi.
            const host = ed.fontiRoot.parentElement;
            const pill = host ? host.querySelector('.fn-pill-left') : null;
            const zoom = host ? host.querySelector('.fn-zoom') : null;
            if (host && pill) {
                const hr = host.getBoundingClientRect();
                const pr = pill.getBoundingClientRect();
                const zr = zoom ? zoom.getBoundingClientRect() : null;
                const bBot = pr.bottom - hr.top;
                const zBot = zr ? (zr.bottom - hr.top) : 0;
                const top = Math.max(bBot, zBot) + 10;
                if (hr.height > 0 && pr.height > 0 && top > 0 && top < hr.height - 40) {
                    ed.fontiRoot.style.top = Math.round(top) + 'px';
                }
            }
        }`;
    splice(a, a + old.length, NEW, 'P10 dock');
}

fs.writeFileSync(FILE, src, 'utf8');
console.log('PATCH OK: ' + src.length + ' bytes');
