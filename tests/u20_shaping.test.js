'use strict';
/* tests/u20_shaping.test.js - R31: suite T1 del motore ink-commit
   (PROMPT ROUND 29 / R31 NovaStudio). RISCRITTA DA ZERO.
   Copre: A geometria fine (linee/archi/shallow/S/chiuso), B esclusioni
   e flags (T06/T07/testo/hold/API/popHelp/contatori stroke), C frecce
   (stesso tratto + assorbimento F01 con positivi e negativi),
   D undo/redo/persistenza (M04/M05/snapshot durante settle/zoom),
   E contatori e log console ([ink24]/[inkV]).
   Fonti di verita': qa/_r31_probe.js (37/37), tests/_ink_env.js,
   web_frontend/html/js/modules/ink_cfg.js + ink_commit.js + notes.js
   (sezione "R31: MOTORE INK-COMMIT").
   Regole: harness SOLO via _ink_env, generatori in coordinate MONDO,
   settle=200ms -> sleep(350)+ prima di leggere il post-commit.
   Esecuzione: node tests/u20_shaping.test.js */
const env0 = require('./_ink_env');

const sleep = env0.sleep;
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else {
        fail++;
        failures.push(name + (extra ? ' - ' + extra : ''));
        console.log('  FAIL  ' + name + (extra ? ' - ' + extra : ''));
    }
}

function freshDoc(env) { env.store.items[0].content = ''; return env0.openNote(env, 'n1'); }
function strokes(env) { return env.win.__ink.objects().filter(o => o.t === 'stroke'); }
function snapC(ink) { return JSON.parse(JSON.stringify(ink.counters)); }

function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function distPtSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
/* distanza massima dei punti MONDO da una polilinea */
function maxDistToPoly(pts, poly) {
    let m = 0;
    for (const q of pts) {
        let bd = Infinity;
        for (let i = 0; i < poly.length - 1; i++) {
            const d = distPtSeg(q[0], q[1], poly[i], poly[i + 1]);
            if (d < bd) bd = d;
        }
        if (bd > m) m = bd;
    }
    return m;
}
/* deviazione massima dei punti GREZZI dalla segmento di render (2 pts) */
function maxDevFromRender(raw, render) {
    let m = 0;
    for (const q of raw) {
        const d = distPtSeg(q[0], q[1], render[0], render[1]);
        if (d > m) m = d;
    }
    return m;
}
/* flessi: stessa metrica di ink_commit (copiata dal probe) */
function countFlessi(pts) {
    const n = pts.length; if (n < 6) return 0;
    const a = pts[0], b = pts[n - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 15) return 0;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const W = Math.max(8, L * 0.10), eps = Math.max(0.5, L * 0.004);
    const t = [], d = [];
    for (let i = 0; i < n; i++) {
        const dx = pts[i][0] - a[0], dy = pts[i][1] - a[1];
        t.push(dx * ux + dy * uy); d.push(-uy * dx + ux * dy);
    }
    const ds = [];
    for (let i = 0; i < n; i++) {
        let s = 0, k = 0;
        for (let j = 0; j < n; j++) if (Math.abs(t[j] - t[i]) <= W) { s += d[j]; k++; }
        ds.push(k ? s / k : d[i]);
    }
    let last = 0, cnt = 0;
    for (let i = 1; i < n; i++) {
        const dd = ds[i] - ds[i - 1]; if (Math.abs(dd) < eps) continue;
        const sg = dd > 0 ? 1 : -1; if (last && sg !== last) cnt++; last = sg;
    }
    return cnt;
}
/* sweep GREZZO: unwrap degli angoli attorno al centro fit (Kasa) */
function sweepOfRaw(raw, c) {
    let s = 0;
    for (let i = 1; i < raw.length; i++) {
        const a0 = Math.atan2(raw[i - 1][1] - c.cy, raw[i - 1][0] - c.cx);
        const a1 = Math.atan2(raw[i][1] - c.cy, raw[i][0] - c.cx);
        let d = a1 - a0;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        s += d;
    }
    return s;
}
/* somma dei cross (direzione di piega) sui punti grezzi */
function sumCross(raw) {
    let sc = 0;
    for (let i = 1; i < raw.length - 1; i++) {
        const ax = raw[i][0] - raw[i - 1][0], ay = raw[i][1] - raw[i - 1][1];
        const bx = raw[i + 1][0] - raw[i][0], by = raw[i + 1][1] - raw[i][1];
        sc += ax * by - ay * bx;
    }
    return sc;
}
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
/* traccia un tratto: pts in coordinate MONDO, passa da env0.wc */
async function draw(env, pts, opts) {
    const canvas = env0.canvasOf(env);
    const b = env0.wc(env, pts);
    env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
    for (let i = 1; i < b.length; i++) {
        if (opts && opts.dt) await sleep(opts.dt);
        env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
    }
    env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
}
/* linea: disegna, aspetta il commit, verifica geometria fine */
async function lineCase(env, raw, pre, devMin) {
    await draw(env, raw);
    await sleep(380);
    const s = strokes(env);
    ok(s.length === 1 && s[0].vclass === 'line', pre + ' vclass line',
        JSON.stringify(s.map(o => o.vclass)));
    if (!s.length) return null;
    const o = s[0];
    ok(o.pts.length === 2, pre + ' pts.length===2', String(o.pts.length));
    let onSeg = 0;
    for (const q of o.pts) if (distPtSeg(q[0], q[1], o.pts[0], o.pts[1]) > 0.05) onSeg++;
    ok(onSeg === 0, pre + ' ogni punto renderizzato sulla segmento <=0.05',
        'n=' + onSeg);
    const d0 = dist(raw[0], o.pts[0]);
    const d1 = dist(raw[raw.length - 1], o.pts[o.pts.length - 1]);
    const mx = Math.max(d0, d1);
    ok(mx <= 3, pre + ' endpoint grezzo->ideale <=3px (Q01)', mx.toFixed(2));
    ok(mx > 0.2, pre + ' endpoint grezzo DIVERSO dall idele dove devia (K03)',
        mx.toFixed(2));
    const dev = maxDevFromRender(raw, o.pts);
    ok(dev >= devMin, pre + ' grezzo != render: dev=' + dev.toFixed(2),
        dev.toFixed(2));
    return o;
}
/* arco: disegna, aspetta il commit, verifica i 7 criteri */
async function arcCase(env, raw, pre) {
    await draw(env, raw);
    await sleep(380);
    const s = strokes(env);
    ok(s.length === 1 && s[0].vclass === 'arc', pre + ' vclass arc',
        JSON.stringify(s.map(o => o.vclass)));
    const o = s[0];
    const p = o ? o.params : null;
    ok(!!p && p.kind === 'circle', pre + ' params.kind circle',
        p ? p.kind : 'null');
    if (!p || p.kind !== 'circle') {
        ok(false, pre + ' residuo render vs circonferenza <=0.5', 'params mancanti');
        ok(false, pre + ' endpoint grezzo->ideale +-3px', 'params mancanti');
        ok(false, pre + ' |sweep params - sweep grezzo| <=5deg', 'params mancanti');
        ok(false, pre + ' gap aperto >=0.6*r', 'params mancanti');
        ok(false, pre + ' direzione di piega preservata', 'params mancanti');
        return o;
    }
    let mx = 0;
    for (const q of o.pts) {
        const d = Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r);
        if (d > mx) mx = d;
    }
    ok(mx <= 0.5, pre + ' residuo render vs circonferenza <=0.5 (Q01)',
        mx.toFixed(3));
    const d0 = dist(raw[0], o.pts[0]);
    const d1 = dist(raw[raw.length - 1], o.pts[o.pts.length - 1]);
    ok(d0 <= 3 && d1 <= 3, pre + ' endpoint grezzo->ideale +-3px (A02)',
        d0.toFixed(2) + '/' + d1.toFixed(2));
    const c = env.win.InkCommit.kasaCircle(raw);
    if (c) {
        const sr = sweepOfRaw(raw, c);
        const dd = Math.abs((p.sweep - sr) * 180 / Math.PI);
        ok(dd <= 5, pre + ' |sweep params - sweep grezzo| <=5deg', dd.toFixed(2));
        const sc = sumCross(raw);
        ok(sc !== 0 && ((sc > 0) === (p.sweep > 0)),
            pre + ' direzione di piega preservata (segno cross == segno sweep)',
            'cross=' + sc.toFixed(2) + ' sweep=' + p.sweep.toFixed(3));
    } else {
        ok(false, pre + ' |sweep params - sweep grezzo| <=5deg', 'kasaCircle null');
        ok(false, pre + ' direzione di piega preservata', 'kasaCircle null');
    }
    /* A03: tangente MODELLO agli endpoint vs direzione locale GREZZA.
       Replica il gate di tryCircleArc (dirIn/dirOut su k=3 passi grezzi,
       tangente circolare da a0/sweep con segno) -> deve dare <=10gradi */
    const sgP = p.sweep >= 0 ? 1 : -1;
    const nR = raw.length, kR = Math.min(3, nR - 1);
    const nrm = v => { const m = Math.hypot(v[0], v[1]) || 1; return [v[0] / m, v[1] / m]; };
    const angBt = (u, v) => {
        const c = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]));
        return Math.acos(c) * 180 / Math.PI;
    };
    const dirInA = nrm([raw[kR][0] - raw[0][0], raw[kR][1] - raw[0][1]]);
    const dirOutA = nrm([raw[nR - 1][0] - raw[nR - 1 - kR][0],
                         raw[nR - 1][1] - raw[nR - 1 - kR][1]]);
    const tan0A = nrm([-Math.sin(p.a0) * sgP, Math.cos(p.a0) * sgP]);
    const aEndA = p.a0 + p.sweep;
    const tan1A = nrm([-Math.sin(aEndA) * sgP, Math.cos(aEndA) * sgP]);
    const angInA = angBt(dirInA, tan0A), angOutA = angBt(dirOutA, tan1A);
    ok(angInA <= 10 && angOutA <= 10,
        pre + ' tangenti endpoint <=10gradi (A03)',
        angInA.toFixed(2) + '/' + angOutA.toFixed(2));
    const gap = dist(o.pts[0], o.pts[o.pts.length - 1]);
    ok(gap >= 0.6 * p.r, pre + ' arco resta APERTO: gap>=0.6r (N01)',
        gap.toFixed(1) + '/' + (0.6 * p.r).toFixed(1));
    return o;
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;

        /* spy su console.info per i log [ink24]/[inkV] (gruppo E) */
        const logLines = [];
        if (env.win.console && typeof env.win.console.info === 'function') {
            env.win.console.info = function () {
                logLines.push(Array.prototype.join.call(arguments, ' '));
            };
        }

        /* ============================================================
           A. GEOMETRIA FINE
           ============================================================ */
        console.log('--- A. GEOMETRIA FINE ---');

        /* A1: linea orizzontale ondulata (amp4/periodo24) + contratto
           settle/swap del motore (K01/K02/L02/L04) */
        await freshDoc(env);
        /* passo 1px: con passi larghi dist(media primi4, primo) > lineEndTolPx
           e fitLine cade nel fallback a endpoint GREZZI (shift==0) */
        const wline = [];
        for (let x = 160; x <= 552; x += 1) {
            wline.push([x, 250 + 2.5 * Math.sin(2 * Math.PI * (x - 160) / 24 + 0.8)]);
        }
        const canvas = env0.canvasOf(env);
        const b = env0.wc(env, wline);
        const rel0 = ink.trace.filter(e => e.k === 'release').length;
        env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
        for (let i = 1; i < b.length; i++) env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
        env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
        await sleep(60);
        let s = strokes(env);
        ok(s.length === 1 && s[0]._wet === true,
            'A1.0 durante settle: grezzo visibile con _wet (K01/L02)',
            JSON.stringify({ n: s.length, wet: s[0] && s[0]._wet }));
        const relEv = ink.trace.filter(e => e.k === 'release');
        ok(relEv.length === rel0 + 1 && relEv[relEv.length - 1].cls === 'line',
            'A1.1 trace release cls=line', JSON.stringify(relEv.slice(-1)));
        await sleep(350);
        s = strokes(env);
        const swEv = ink.trace.filter(e => e.k === 'swap');
        ok(swEv.length >= 1 && swEv[swEv.length - 1].dt >= 150 &&
           swEv[swEv.length - 1].dt <= 320,
            'A1.2 UNO swap con dt in 150-320ms (K01/K02)',
            JSON.stringify(swEv.slice(-1)));
        ok(s.length === 1 && s[0].vclass === 'line',
            'A1.3 linea commessa: vclass line', JSON.stringify(s.map(o => o.vclass)));
        ok(s[0].pts.length === 2, 'A1.4 pts.length===2', String(s[0].pts.length));
        ok(s[0]._wet === undefined, 'A1.5 _wet rimosso post-commit (L04/N08/N09)',
            String(s[0]._wet));
        let onSeg = 0;
        for (const q of s[0].pts) if (distPtSeg(q[0], q[1], s[0].pts[0], s[0].pts[1]) > 0.05) onSeg++;
        ok(onSeg === 0, 'A1.6 ogni punto renderizzato sulla segmento <=0.05',
            'n=' + onSeg);
        const A1d0 = dist(wline[0], s[0].pts[0]);
        const A1d1 = dist(wline[wline.length - 1], s[0].pts[1]);
        const A1mx = Math.max(A1d0, A1d1);
        ok(A1mx <= 3, 'A1.7 endpoint grezzo->ideale <=3px (Q01)', A1mx.toFixed(2));
        ok(A1mx > 0.2, 'A1.8 endpoint grezzo DIVERSO dall ideale dove devia (K03)',
            A1mx.toFixed(2));
        const A1dev = maxDevFromRender(wline, s[0].pts);
        ok(A1dev > 0.5, 'A1.9 il grezzo ondulato NON e il render (K03): dev=' +
            A1dev.toFixed(2), A1dev.toFixed(2));

        /* A2: linea diagonale ondulata perpendicolare (passo 1px) */
        await freshDoc(env);
        const diag = [];
        {
            const p0 = [120, 140], p1 = [520, 470];
            const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L;
            const pxv = -uy, pyv = ux, amp = 2.2, per = 24, ph = 0.775;
            const N = Math.ceil(L);
            for (let i = 0; i <= N; i++) {
                const sv = L * i / N;
                const off = amp * Math.sin(2 * Math.PI * sv / per + ph);
                diag.push([p0[0] + ux * sv + pxv * off, p0[1] + uy * sv + pyv * off]);
            }
        }
        await lineCase(env, diag, 'A2 (diagonale ondulata)', 0.5);

        /* A3: linea dritta con jitter entro +-2px (passo 1px) */
        await freshDoc(env);
        const jit = [];
        {
            const rnd = lcg(7717);
            for (let i = 0; i <= 400; i++) {
                const sg = (i % 2 === 0) ? 1 : -1;
                jit.push([140 + i, 540 + sg * (0.8 + 0.7 * rnd())]);
            }
        }
        await lineCase(env, jit, 'A3 (jitter +-2px)', 0.5);

        /* B1: arco semicerchio r60 con rumore 1.2 */
        await freshDoc(env);
        const semi = [];
        for (let i = 0; i <= 60; i++) {
            const a = Math.PI * 0.05 + (i / 60) * Math.PI * 0.9;
            semi.push([400 + Math.cos(a) * 60 + Math.sin(i / 3) * 1.2,
                       300 + Math.sin(a) * 60 + Math.cos(i / 4) * 1.2]);
        }
        await arcCase(env, semi, 'A4 (semicerchio r60)');

        /* B2: quarto arco r50 */
        await freshDoc(env);
        const quart = [];
        for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * Math.PI * 0.5;
            quart.push([330 + Math.cos(a) * 50, 230 + Math.sin(a) * 50]);
        }
        await arcCase(env, quart, 'A5 (quarto arco r50)');

        /* B3: arco 140gradi r70 */
        await freshDoc(env);
        const a140 = [];
        for (let i = 0; i <= 48; i++) {
            const a = 0.3 * Math.PI + (i / 48) * (140 * Math.PI / 180);
            a140.push([400 + Math.cos(a) * 70, 300 + Math.sin(a) * 70]);
        }
        await arcCase(env, a140, 'A6 (arco 140deg r70)');

        /* A7: arco SHALLOW - dev ~4.5% della corda (corda 250 -> 11.25px).
           Con arcLen/chord ~1.008 il gate lineStraightRatio (0.95) puo'
           vincere: si accetta line O arc e si logga il branch (MEASURE). */
        await freshDoc(env);
        const shallow = [];
        {
            const R = 700.1, cx = 275, cy = -548.7;
            const a0 = Math.atan2(140 - cy, 150 - cx);
            const a1 = Math.atan2(140 - cy, 400 - cx);
            for (let i = 0; i <= 40; i++) {
                const a = a0 + (a1 - a0) * (i / 40);
                shallow.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
            }
        }
        await draw(env, shallow);
        await sleep(380);
        s = strokes(env);
        {
            const pl = env.win.InkCommit.pathLen(shallow);
            const ch = dist(shallow[0], shallow[shallow.length - 1]);
            const dev = maxDevFromRender(shallow, s.length && s[0].pts.length === 2
                ? s[0].pts : [shallow[0], shallow[shallow.length - 1]]);
            console.log('  MEASURE A7 arco-shallow: vclass=' +
                (s[0] ? s[0].vclass : '-') + ' ratio=' + (ch / pl).toFixed(4) +
                ' dev/ch=' + (dev / ch).toFixed(4));
        }
        ok(s.length === 1 && (s[0].vclass === 'line' || s[0].vclass === 'arc'),
            'A7.0 arco-shallow (dev 4.5% chord) -> line O arc',
            JSON.stringify(s.map(o => o.vclass)));
        if (s[0] && s[0].vclass === 'arc') {
            ok(!!s[0].params && (s[0].params.kind === 'circle' || s[0].params.kind === 'bez'),
                'A7.1 shallow->arc: params.kind in {circle,bez}',
                s[0].params ? s[0].params.kind : 'null');
        } else {
            ok(s[0] && s[0].pts.length === 2,
                'A7.1 shallow->line (ratio>=0.95): pts.length===2',
                s[0] ? String(s[0].pts.length) : 'null');
        }

        /* A8: arco che fallisce il fit a cerchio -> kind in {circle,bez}
           (spirale: raggio 68->84 su 140gradi, residuo Kasa >4px) */
        await freshDoc(env);
        const spiral = [];
        for (let i = 0; i <= 48; i++) {
            const f = i / 48;
            const a = 0.3 * Math.PI + f * (140 * Math.PI / 180);
            const r = 68 + 16 * f;
            spiral.push([330 + Math.cos(a) * r, 300 + Math.sin(a) * r]);
        }
        await draw(env, spiral);
        await sleep(380);
        s = strokes(env);
        console.log('  MEASURE A8 arco-non-circolare: vclass=' +
            (s[0] ? s[0].vclass : '-') + ' kind=' +
            (s[0] && s[0].params ? s[0].params.kind : '-'));
        ok(s.length === 1 && s[0].vclass === 'arc',
            'A8.0 arco non circolare -> vclass arc',
            JSON.stringify(s.map(o => o.vclass)));
        ok(!!s[0] && !!s[0].params &&
           (s[0].params.kind === 'circle' || s[0].params.kind === 'bez'),
            'A8.1 params.kind in {circle,bez} (branch MEASURE)',
            s[0] && s[0].params ? s[0].params.kind : 'null');

        /* A9: freeform - S con 2 flessi: smoothing bounded, topologia
           invariata */
        await freshDoc(env);
        const sPts = [];
        for (let x = 150; x <= 550; x += 4) sPts.push([x, 300 + 45 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
        await draw(env, sPts);
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'freeform',
            'A9.0 S -> freeform', JSON.stringify(s.map(o => o.vclass)));
        if (s[0]) {
            const fOut = countFlessi(s[0].pts);
            ok(fOut >= 2, 'A9.1 flessi preservati: flessiOut>=2',
                countFlessi(sPts) + '->' + fOut);
            const md = maxDistToPoly(s[0].pts, sPts);
            ok(md <= 3, 'A9.2 smoothing bounded: max dist ideale->grezzo <=3px',
                md.toFixed(2));
            const IC = env.win.InkCommit;
            ok(IC.selfInt(s[0].pts) === IC.selfInt(sPts),
                'A9.3 selfIntOut == selfIntIn (topologia invariata)',
                IC.selfInt(sPts) + '->' + IC.selfInt(s[0].pts));
            ok(!!s[0].params && s[0].params.kind === 'smooth',
                'A9.4 nessun snap parametrico (kind smooth)',
                JSON.stringify(s[0].params));
        }

        /* A10: cerchio CHIUSO -> closed + kind smooth + endpoints lock */
        await freshDoc(env);
        const circ = [];
        for (let i = 0; i < 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            circ.push([400 + Math.cos(a) * (45 + Math.sin(i * 2.1) * 3),
                       300 + Math.sin(a) * (45 + Math.cos(i * 1.7) * 3)]);
        }
        await draw(env, circ);
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'closed',
            'A10.0 cerchio -> closed (T05)', JSON.stringify(s.map(o => o.vclass)));
        ok(!!s[0] && !!s[0].params && s[0].params.kind === 'smooth',
            'A10.1 MAI conversione in cerchio/ellipse (N07)',
            s[0] && s[0].params ? s[0].params.kind : 'null');
        if (s[0]) {
            const e0 = dist(circ[0], s[0].pts[0]);
            const e1 = dist(circ[71], s[0].pts[s[0].pts.length - 1]);
            ok(e0 <= 1 && e1 <= 1, 'A10.2 endpoints lock: primi/ultimi pt ideali == grezzi +-1px',
                e0.toFixed(2) + '/' + e1.toFixed(2));
        }

        /* A11: arco a BEZ (branch MEASURE) - semiangolo ellipse rx95/ry40:
           nf<2, fit a cerchio FALLITO (residuo Kasa >4px), cubica singola
           LSQ entro tol=max(4px,11% corda) -> vclass arc kind bez */
        await freshDoc(env);
        const halfEll = [];
        for (let i = 0; i <= 50; i++) {
            const a = Math.PI * i / 50;
            halfEll.push([400 + Math.cos(a) * 95, 300 + Math.sin(a) * 40]);
        }
        await draw(env, halfEll);
        await sleep(380);
        s = strokes(env);
        const IC11 = env.win.InkCommit;
        const nf11 = IC11.countFlessi(halfEll);
        const circ11 = !!IC11.tryCircleArc(halfEll);
        console.log('  MEASURE A11 branch bez: vclass=' +
            (s[0] ? s[0].vclass : '-') + ' kind=' +
            (s[0] && s[0].params ? s[0].params.kind : '-') +
            ' nf=' + nf11 + ' circFit=' + circ11);
        ok(s.length === 1 && s[0].vclass === 'arc',
            'A11.0 semiangolo ellipse -> vclass arc',
            JSON.stringify(s.map(o => o.vclass)));
        ok(!!s[0] && !!s[0].params && s[0].params.kind === 'bez',
            'A11.1 params.kind === bez (branch MEASURE)',
            s[0] && s[0].params ? s[0].params.kind : 'null');
        ok(nf11 < 2 && !circ11,
            'A11.2 branch: nf<2 E fit cerchio FALLITO (MEASURE)',
            'nf=' + nf11 + ' circFit=' + circ11);
        if (s[0] && s[0].params && s[0].params.kind === 'bez') {
            const p11 = s[0].params;
            const ch11 = dist(halfEll[0], halfEll[halfEll.length - 1]);
            const tol11 = Math.max(4, 0.11 * ch11);
            const res11 = IC11.residualOf(s[0]);
            ok(res11 <= tol11,
                'A11.3 residuo grezzo->bez <= max(4px,11% corda)',
                res11.toFixed(3) + '/' + tol11.toFixed(2));
            const dA11 = dist(halfEll[0], s[0].pts[0]);
            const dB11 = dist(halfEll[50], s[0].pts[s[0].pts.length - 1]);
            ok(dA11 <= 3 && dB11 <= 3,
                'A11.4 endpoint grezzo->ideale +-3px (A02 bez)',
                dA11.toFixed(3) + '/' + dB11.toFixed(3));
            const kk11 = Math.min(4, halfEll.length - 1);
            const dIn11 = [halfEll[kk11][0] - halfEll[0][0],
                           halfEll[kk11][1] - halfEll[0][1]];
            const dOut11 = [halfEll[50][0] - halfEll[50 - kk11][0],
                            halfEll[50][1] - halfEll[50 - kk11][1]];
            const t11a = [p11.p[1][0] - p11.p[0][0], p11.p[1][1] - p11.p[0][1]];
            const t11b = [p11.p[3][0] - p11.p[2][0], p11.p[3][1] - p11.p[2][1]];
            const ang11 = (u, v) => {
                const nu = Math.hypot(u[0], u[1]) || 1, nv = Math.hypot(v[0], v[1]) || 1;
                const c = Math.max(-1, Math.min(1,
                    (u[0] * v[0] + u[1] * v[1]) / (nu * nv)));
                return Math.acos(c) * 180 / Math.PI;
            };
            const aIn11 = ang11(dIn11, t11a), aOut11 = ang11(dOut11, t11b);
            ok(aIn11 <= 10 && aOut11 <= 10,
                'A11.5 tangenti endpoint bez <=10gradi (A03)',
                aIn11.toFixed(2) + '/' + aOut11.toFixed(2));
        } else {
            ok(false, 'A11.3 residuo grezzo->bez <= max(4px,11% corda)', 'params non bez');
            ok(false, 'A11.4 endpoint grezzo->ideale +-3px (A02 bez)', 'params non bez');
            ok(false, 'A11.5 tangenti endpoint bez <=10gradi (A03)', 'params non bez');
        }

        /* ============================================================
           B. ESCLUSIONI / FLAGS
           ============================================================ */
        console.log('--- B. ESCLUSIONI / FLAGS ---');

        /* B1: T06 tap (2 punti) -> grezzo, nessun vclass, scartato */
        await freshDoc(env);
        let c0 = snapC(ink);
        await draw(env, [[200, 200], [210, 202]]);
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && !s[0].vclass,
            'B1.0 tap 2pti resta GREZZO: nessun vclass (T06)',
            JSON.stringify(s.map(o => o.vclass)));
        ok(ink.counters.discarded === c0.discarded + 1,
            'B1.1 scartati discarded+1', String(ink.counters.discarded - c0.discarded));

        /* B2: T06 tratto 15px (<20px) -> grezzo */
        await freshDoc(env);
        c0 = snapC(ink);
        await draw(env, [[200, 200], [205, 201], [210, 203], [214, 204]]);
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && !s[0].vclass,
            'B2.0 tratto 15px resta GREZZO (T06)',
            JSON.stringify(s.map(o => o.vclass)));
        ok(ink.counters.discarded === c0.discarded + 1,
            'B2.1 scartati discarded+1', String(ink.counters.discarded - c0.discarded));

        /* B3: T07 scarabocchio denso -> freeform con mode light */
        await freshDoc(env);
        const scr = [];
        {
            const R = 35, order = [0, 2, 4, 1, 3];
            for (let st = 0; st < 3; st++) {
                for (const k of order) {
                    const a = -Math.PI / 2 + k * (4 * Math.PI / 5);
                    scr.push([300 + st * 3 + Math.cos(a) * R,
                              300 + st * 3 + Math.sin(a) * R]);
                }
            }
        }
        await draw(env, scr);
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'freeform',
            'B3.0 scarabocchio denso -> freeform (T07)',
            JSON.stringify(s.map(o => o.vclass)));
        ok(!!s[0] && !!s[0].params && s[0].params.mode === 'light',
            'B3.1 T07 -> mode light (solo smoothing leggero)',
            s[0] && s[0].params ? s[0].params.mode : 'null');

        /* B4: overlay testo aperto -> tratto successivo inkNoSnap -> raw.
           Pilotaggio: tool testo + click apre overlay; testo salvato via
           Escape; doppio-click sul testo riapre l overlay con tool penna;
           il tratto che segue cattura inkNoSnap=true -> nessun commit. */
        await freshDoc(env);
        c0 = snapC(ink);
        let textOk = false;
        const bT = env.doc.querySelector('[data-tool="testo"]');
        if (bT) bT.click();
        const cpt = env0.wc(env, [[300, 300]])[0];
        const cvT = env0.canvasOf(env);
        env0.ptr(env, cvT, 'pointerdown', cpt[0], cpt[1]);
        env0.ptr(env, cvT, 'pointerup', cpt[0], cpt[1]);
        await sleep(60);
        let ta = env.doc.querySelector('textarea');
        if (ta) {
            ta.value = 'Ciao';
            ta.dispatchEvent(new env.win.KeyboardEvent('keydown',
                { key: 'Escape', bubbles: true }));
            await sleep(40);
        }
        const bP = env.doc.querySelector('[data-tool="penna"]');
        if (bP) bP.click();
        const cvD = env0.canvasOf(env);
        env0.ptr(env, cvD, 'dblclick', cpt[0] + 4, cpt[1] + 4);
        await sleep(60);
        const ta2 = env.doc.querySelector('textarea');
        if (ta2) {
            ok(true, 'B4.0 overlay testo aperto e riaperto via doppio-click');
            textOk = true;
            await draw(env, [[150, 600], [250, 603], [350, 599], [450, 602], [550, 600]]);
            await sleep(380);
            s = strokes(env);
            ok(s.length === 1 && !s[0].vclass,
                'B4.1 tratto con overlay testo -> GREZZO (inkNoSnap/noSnap)',
                JSON.stringify(s.map(o => o.vclass)));
            ok(ink.counters.discarded === c0.discarded + 1,
                'B4.2 inkNoSnap -> discarded+1',
                String(ink.counters.discarded - c0.discarded));
        } else {
            console.log('  SOFT B4 overlay testo non pilotabile via harness: skip (3 assert)' +
                ' [diag bT=' + !!bT + ' ta=' + !!ta + ' textObj=' +
                ink.objects().filter(o => o.t === 'text').length + ' bP=' + !!bP + ']');
        }

        /* B5: nessun ghost/hold - hold 500ms durante il drag */
        await freshDoc(env);
        const relB = ink.trace.filter(e => e.k === 'release').length;
        const swB = ink.trace.filter(e => e.k === 'swap').length;
        const holdPts = env0.wc(env,
            [[150, 150], [250, 153], [350, 149], [450, 152], [550, 150]]);
        const cvH = env0.canvasOf(env);
        env0.ptr(env, cvH, 'pointerdown', holdPts[0][0], holdPts[0][1]);
        for (let i = 1; i < holdPts.length; i++) {
            env0.ptr(env, cvH, 'pointermove', holdPts[i][0], holdPts[i][1]);
        }
        await sleep(500);
        ok(ink.trace.filter(e => e.k === 'release').length === relB,
            'B5.0 hold500ms: NESSUN trace release prematuro (N03)');
        ok(ink.trace.filter(e => e.k === 'swap').length === swB,
            'B5.1 hold500ms: NESSUN trace swap durante il drag');
        ok(ink.objects().length === 0,
            'B5.2 hold500ms: oggetti doc INVIOLATI (nessun commit fantasma)',
            'n=' + ink.objects().length);
        ok(ink.state().active === true,
            'B5.3 tratto ancora attivo durante l hold', String(ink.state().active));
        env0.ptr(env, cvH, 'pointerup', holdPts[holdPts.length - 1][0],
            holdPts[holdPts.length - 1][1]);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'line',
            'B5.4 commit solo al rilascio dopo hold (N03)',
            JSON.stringify(s.map(o => o.vclass)));

        /* B6: stato API senza campi vecchi */
        const st = ink.state();
        ok(st.shpOn === undefined && st.holdMs === undefined &&
           st.releaseRefine === undefined && st.ghost === undefined,
            'B6.0 state SENZA shpOn/holdMs/releaseRefine/ghost (M01)',
            JSON.stringify(Object.keys(st)));
        ok(typeof ink.setShaping === 'undefined' &&
           typeof ink.setReleaseRefine === 'undefined',
            'B6.1 setShaping/setReleaseRefine undefined (M01)',
            typeof ink.setShaping + '/' + typeof ink.setReleaseRefine);
        ok(st.settleMs >= 150 && st.settleMs <= 300 &&
           'pending' in st && 'selected' in st && 'lasel' in st,
            'B6.2 state con settleMs/pending/selected/lasel',
            JSON.stringify({ s: st.settleMs, p: st.pending }));

        /* B7: popHelp senza #fn-releaseRefine e senza "Fermo per snap" */
        ok(env.doc.querySelector('#fn-releaseRefine') === null,
            'B7.0 nessun #fn-releaseRefine nel DOM');
        ok(env.doc.body.textContent.indexOf('Fermo per snap') < 0,
            'B7.1 nessun testo "Fermo per snap" (hold-still eliminato, N03)');
        ok(env.doc.body.textContent.indexOf('Intensita aiuto') >= 0,
            'B7.2 popHelp CON slider "Intensita aiuto" (assist live, M03)');

        /* B8: counters.stroke si azzera a ogni pointerdown */
        await freshDoc(env);
        await draw(env, [[150, 150], [250, 152], [350, 148], [450, 151], [550, 150]]);
        await sleep(400);
        ok(ink.counters.stroke.total === 1,
            'B8.0 dopo rilascio tratto1: stroke.total===1',
            String(ink.counters.stroke.total));
        const cv8 = env0.canvasOf(env);
        const p8 = env0.wc(env, [[150, 700], [250, 703], [350, 699], [450, 702], [550, 700]]);
        env0.ptr(env, cv8, 'pointerdown', p8[0][0], p8[0][1]);
        env0.ptr(env, cv8, 'pointermove', p8[1][0], p8[1][1]);
        ok(ink.counters.stroke.total === 0,
            'B8.1 stroke.total AZZERATO al pointerdown del tratto2',
            String(ink.counters.stroke.total));
        for (let i = 2; i < p8.length; i++) {
            env0.ptr(env, cv8, 'pointermove', p8[i][0], p8[i][1]);
        }
        env0.ptr(env, cv8, 'pointerup', p8[p8.length - 1][0], p8[p8.length - 1][1]);
        await sleep(400);
        ok(ink.counters.stroke.total === 1,
            'B8.2 dopo rilascio tratto2: stroke.total===1',
            String(ink.counters.stroke.total));

        /* ============================================================
           C. FRECCE
           ============================================================ */
        console.log('--- C. FRECCE ---');

        /* C1: freccia stesso tratto (linea 270px + flick V come da probe) */
        await freshDoc(env);
        c0 = snapC(ink);
        const lineA = [];
        for (let i = 0; i <= 27; i++) lineA.push([150 + i * 10, 250 + Math.sin(i / 6) * 1.2]);
        const endA = lineA[lineA.length - 1];
        lineA.push([endA[0] + 6, endA[1] + 4.5]);
        lineA.push([endA[0] - 15, endA[1] + 8]);
        await draw(env, lineA);
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'arrow',
            'C1.0 retta+flick -> arrow', JSON.stringify(s.map(o => o.vclass)));
        const arw = s[0];
        if (arw && arw.vclass === 'arrow') {
            const p = arw.params;
            ok(!!p.head && p.shaftKind === 'line',
                'C1.1 params.head + shaftKind=line',
                JSON.stringify({ h: !!p.head, s: p.shaftKind }));
            const pend = arw.pts[arw.pts.length - 1];
            ok(dist(p.head.base, pend) <= 0.05,
                'C1.2 head.base == endpoint asta (<=0.05)',
                dist(p.head.base, pend).toFixed(4));
            const sz = arw.size || 2;
            ok(p.head.len >= 3 * sz && p.head.len <= 4 * sz,
                'C1.3 punta len in [3,4]x size (F03)',
                p.head.len.toFixed(2) + '/' + sz);
            ok(p.head.wing >= 30 && p.head.wing <= 40,
                'C1.4 ali wing in [30,40]gradi (F03)', String(p.head.wing));
            const tx = arw.pts[1][0] - arw.pts[0][0];
            const ty = arw.pts[1][1] - arw.pts[0][1];
            const nT = Math.hypot(tx, ty) || 1;
            const nH = Math.hypot(p.head.dir[0], p.head.dir[1]) || 1;
            const cs = Math.max(-1, Math.min(1,
                (tx * p.head.dir[0] + ty * p.head.dir[1]) / (nT * nH)));
            const ang = Math.acos(cs) * 180 / Math.PI;
            ok(ang <= 10, 'C1.5 dir punta vs tangente asta <=10gradi (A03)',
                ang.toFixed(2));
        }
        ok(ink.counters.classified.arrow === c0.classified.arrow + 1,
            'C1.6 contatore arrow +1', String(ink.counters.classified.arrow - c0.classified.arrow));

        /* C2: arco 120gradi + flick rapido -> arrow shaftKind arc */
        await freshDoc(env);
        const arcF = [];
        {
            const cx2 = 380, cy2 = 330, R2 = 70;
            const a0 = 0.25 * Math.PI, sw = 2 * Math.PI / 3;
            for (let i = 0; i <= 40; i++) {
                const a = a0 + sw * (i / 40);
                const rr = R2 + Math.sin(i / 5) * 0.8;
                arcF.push([cx2 + Math.cos(a) * rr, cy2 + Math.sin(a) * rr]);
            }
            const eA = arcF[arcF.length - 1];
            arcF.push([eA[0] + 9, eA[1] + 7]);
            arcF.push([eA[0] + 3, eA[1] + 20]);
        }
        await draw(env, arcF);
        await sleep(380);
        s = strokes(env);
        console.log('  MEASURE C2 arco+flick: vclass=' +
            (s[0] ? s[0].vclass : '-') + ' shaftKind=' +
            (s[0] && s[0].params ? s[0].params.shaftKind : '-'));
        ok(s.length === 1 && s[0].vclass === 'arrow',
            'C2.0 arco+flick -> arrow', JSON.stringify(s.map(o => o.vclass)));
        ok(!!s[0] && !!s[0].params && s[0].params.shaftKind === 'arc' &&
           !!s[0].params.head,
            'C2.1 shaftKind=arc + head presente',
            s[0] && s[0].params ? String(s[0].params.shaftKind) : 'null');

        /* helper asta dritta commessa (F01 target): attende lo swap REALE
           (_wet sparito) come v1_release_swap F1.0 - margine sicuro per
           rilasciare il flick entro ~220ms dal rilascio dell'asta */
        async function drawShaft(env) {
            const ln = [];
            for (let i = 0; i <= 30; i++) ln.push([150 + i * 8, 400 + (i % 3) * 0.4]);
            await draw(env, ln);
            await sleep(205);
            let ss = strokes(env);
            let guard = 0;
            while (ss[0] && ss[0]._wet !== undefined && guard++ < 20) {
                await sleep(10);   // attende lo swap reale (~200ms)
                ss = strokes(env);
            }
            if (!ss.length || ss[0]._wet !== undefined) return null;
            return ss[0].pts[ss[0].pts.length - 1];
        }

        /* C3(i): assorbimento su target GIA commesso -> UN oggetto arrow */
        await freshDoc(env);
        let e2 = await drawShaft(env);
        ok(!!e2 && strokes(env).length === 1 &&
           strokes(env)[0].vclass === 'line',
            'C3.0 asta commessa prima (line)',
            JSON.stringify(strokes(env).map(o => o.vclass)));
        const fl2 = [[e2[0] - 30, e2[1] + 22], [e2[0] - 8, e2[1] + 15], [e2[0] + 14, e2[1] + 9]];
        await draw(env, fl2);   // istantaneo: rilascio a ~215ms dal rilascio asta
        await sleep(380);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'arrow' && !!s[0].params.head,
            'C3.1 target commesso: UN oggetto arrow (F01/F04)',
            JSON.stringify(s.map(o => o.vclass)));
        /* F04/M04: UN solo undo rimuove asta+punta anche nell assorbimento */
        const jsonAbs = JSON.stringify(ink.objects());
        env0.undoKey(env, 1);
        ok(ink.objects().length === 0,
            'C3.3 M04: UN solo undo rimuove asta+punta assorbita',
            'n=' + ink.objects().length);
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'y', ctrlKey: true, bubbles: true }));
        ok(JSON.stringify(ink.objects()) === jsonAbs,
            'C3.4 redo arrow assorbita IDENTICA (deep JSON)');

        /* C3(ii): target ancora PENDING (sleep 80) -> attach al pending.
           (non usa drawShaft: serve il rilascio a soli 80ms per restare
           dentro la finestra di settle del tratto1) */
        await freshDoc(env);
        {
            const ln = [];
            for (let i = 0; i <= 30; i++) ln.push([150 + i * 8, 520 + (i % 3) * 0.4]);
            await draw(env, ln);
            await sleep(80);
            const ss = strokes(env);
            e2 = ss.length ? ss[0].pts[ss[0].pts.length - 1] : null;
        }
        const fl3 = [[e2[0] - 30, e2[1] - 22], [e2[0] - 8, e2[1] - 15], [e2[0] + 14, e2[1] - 9]];
        await draw(env, fl3, { dt: 10 });
        await sleep(420);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'arrow' && !!s[0].params.head,
            'C3.2 target PENDING: attach -> 1 solo oggetto arrow',
            JSON.stringify(s.map(o => o.vclass)));

        /* C3(iii) NEGATIVI: ognuno deve dare 2 oggetti separati */
        // (a) NEG durata>=120ms: rilascio ENTRO 300ms (asta pending a
        // 60ms, flick dt70 x3=210ms) -> fallisce SOLO il gate flick2DurMs
        await freshDoc(env);
        {
            const ln = [];
            for (let i = 0; i <= 30; i++) ln.push([150 + i * 8, 400 + (i % 3) * 0.4]);
            await draw(env, ln);
            await sleep(60);   // asta ancora PENDING: finestra quasi intatta
            const ss = strokes(env);
            e2 = ss.length ? ss[0].pts[ss[0].pts.length - 1] : null;
        }
        await draw(env, [
            [e2[0] - 30, e2[1] + 20], [e2[0] - 10, e2[1] + 15],
            [e2[0] + 8, e2[1] + 10], [e2[0] + 24, e2[1] + 5]
        ], { dt: 70 });
        await sleep(450);
        s = strokes(env);
        ok(s.length === 2, 'C4.0 NEG durata>=120ms -> 2 oggetti separati',
            JSON.stringify(s.map(o => o.vclass)));
        ok(s.length === 2 && !!s[0].vclass && !!s[1].vclass,
            'C4.1 entrambi commessi (nessun assorbimento)',
            JSON.stringify(s.map(o => o.vclass)));

        // (b) start lontano 150px
        await freshDoc(env);
        e2 = await drawShaft(env);
        await draw(env, [
            [e2[0] + 150, e2[1] + 10], [e2[0] + 163, e2[1] + 10],
            [e2[0] + 177, e2[1] + 8], [e2[0] + 190, e2[1] + 8]
        ]);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 2, 'C4.2 NEG start 150px lontano -> 2 oggetti separati',
            JSON.stringify(s.map(o => o.vclass)));
        ok(s.length === 2 && !!s[0].vclass && !!s[1].vclass,
            'C4.3 entrambi commessi (nessun assorbimento)',
            JSON.stringify(s.map(o => o.vclass)));

        // (c) delay 400ms oltre la finestra flick2Ms=300
        await freshDoc(env);
        e2 = await drawShaft(env);
        await sleep(400);
        await draw(env, [
            [e2[0] - 28, e2[1] + 20], [e2[0] - 10, e2[1] + 16],
            [e2[0] + 6, e2[1] + 12], [e2[0] + 20, e2[1] + 8]
        ]);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 2, 'C4.4 NEG delay 400ms -> 2 oggetti separati',
            JSON.stringify(s.map(o => o.vclass)));
        ok(s.length === 2 && !!s[0].vclass && !!s[1].vclass,
            'C4.5 entrambi commessi (nessun assorbimento)',
            JSON.stringify(s.map(o => o.vclass)));

        // (d) len stroke2 >60px
        await freshDoc(env);
        e2 = await drawShaft(env);
        await draw(env, [
            [e2[0] - 30, e2[1] + 15], [e2[0] - 3, e2[1] + 10],
            [e2[0] + 23, e2[1] + 7], [e2[0] + 50, e2[1] + 9]
        ]);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 2, 'C4.6 NEG len stroke2 >60px -> 2 oggetti separati',
            JSON.stringify(s.map(o => o.vclass)));
        ok(s.length === 2 && !!s[0].vclass && !!s[1].vclass,
            'C4.7 entrambi commessi (nessun assorbimento)',
            JSON.stringify(s.map(o => o.vclass)));

        // (e) doppia punta: flick2 su asta GIA arrow -> non assorbito
        await freshDoc(env);
        const lineB = [];
        for (let i = 0; i <= 27; i++) lineB.push([150 + i * 10, 250 + Math.sin(i / 6) * 1.2]);
        const endB = lineB[lineB.length - 1];
        lineB.push([endB[0] + 6, endB[1] + 4.5]);
        lineB.push([endB[0] - 15, endB[1] + 8]);
        await draw(env, lineB);
        await sleep(205);
        {
            let g48 = 0;
            let saTmp = strokes(env);
            while (saTmp[0] && saTmp[0]._wet !== undefined && g48++ < 20) {
                await sleep(10);
                saTmp = strokes(env);
            }
        }
        const sArrow = strokes(env);
        ok(sArrow.length === 1 && sArrow[0].vclass === 'arrow',
            'C4.8 asta iniziale diventa arrow',
            JSON.stringify(sArrow.map(o => o.vclass)));
        const eA2 = sArrow[0].pts[sArrow[0].pts.length - 1];
        await draw(env, [
            [eA2[0] - 25, eA2[1] + 20], [eA2[0] - 5, eA2[1] + 16],
            [eA2[0] + 12, eA2[1] + 14], [eA2[0] + 28, eA2[1] + 10]
        ]);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 2, 'C4.9 NEG doppia punta (p1.head gate) -> 2 oggetti',
            JSON.stringify(s.map(o => o.vclass)));

        /* ============================================================
           D. UNDO / REDO / PERSISTENZA
           ============================================================ */
        console.log('--- D. UNDO/REDO/PERSISTENZA ---');

        /* D1: undo singolo rimuove stroke commesso + redo identico */
        await freshDoc(env);
        const ln1 = [];
        for (let x = 150; x <= 500; x += 5) ln1.push([x, 200 + (x % 10) * 0.2]);
        await draw(env, ln1);
        await sleep(400);
        s = strokes(env);
        const jsonBefore = JSON.stringify(ink.objects());
        ok(s.length === 1 && s[0].vclass === 'line',
            'D1.0 stroke commesso prima dell undo',
            JSON.stringify(s.map(o => o.vclass)));
        env0.undoKey(env, 1);
        ok(ink.objects().length === 0,
            'D1.1 M04: undo singolo rimuove lo stroke commesso',
            'n=' + ink.objects().length);
        ok(ink.state().pending === 0,
            'D1.2 nessun pending residuo dopo undo',
            String(ink.state().pending));
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'y', ctrlKey: true, bubbles: true }));
        ok(JSON.stringify(ink.objects()) === jsonBefore,
            'D1.3 redo IDENTICO al pre-undo (deep JSON)',
            'len ' + JSON.stringify(ink.objects()).length + '/' + jsonBefore.length);

        /* D2: undo DURANTE il settle -> 0 oggetti, nessun residuo */
        await freshDoc(env);
        const swC = ink.trace.filter(e => e.k === 'swap').length;
        const ln2 = [];
        for (let x = 150; x <= 500; x += 5) ln2.push([x, 300 + (x % 10) * 0.2]);
        await draw(env, ln2);
        await sleep(50);   // ancora in finestra di assestamento
        env0.undoKey(env, 1);
        await sleep(420);
        ok(ink.objects().length === 0,
            'D2.0 undo durante settle -> 0 oggetti (nessun residuo)',
            'n=' + ink.objects().length);
        ok(ink.state().pending === 0,
            'D2.1 pending==0 in state dopo il flush del timer annullato',
            String(ink.state().pending));
        ok(ink.trace.filter(e => e.k === 'swap').length === swC,
            'D2.2 NESSUN swap per lintorno annullato',
            String(ink.trace.filter(e => e.k === 'swap').length - swC));

        /* D3: undo/redo su arrow (versione propria) */
        await freshDoc(env);
        const lineC = [];
        for (let i = 0; i <= 27; i++) lineC.push([150 + i * 10, 250 + Math.sin(i / 6) * 1.2]);
        const endC = lineC[lineC.length - 1];
        lineC.push([endC[0] + 6, endC[1] + 4.5]);
        lineC.push([endC[0] - 15, endC[1] + 8]);
        await draw(env, lineC);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'arrow' && !!s[0].params.head,
            'D3.0 arrow commesso prima dell undo',
            JSON.stringify(s.map(o => o.vclass)));
        const jsonArrow = JSON.stringify(ink.objects());
        env0.undoKey(env, 1);
        ok(ink.objects().length === 0,
            'D3.1 undo rimuove l arrow intero',
            'n=' + ink.objects().length);
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'y', ctrlKey: true, bubbles: true }));
        ok(JSON.stringify(ink.objects()) === jsonArrow,
            'D3.2 redo arrow IDENTICO (deep JSON)',
            'len ' + JSON.stringify(ink.objects()).length + '/' + jsonArrow.length);

        /* D4: snapshotObjects durante settle - il PRIMO movimento del
           tratto2 fa pushUno snapshot con pending MATERIALIZZATO */
        await freshDoc(env);
        const lnA = [];
        for (let x = 150; x <= 450; x += 5) lnA.push([x, 180 + (x % 10) * 0.2]);
        await draw(env, lnA);
        await sleep(80);   // tratto1 ancora PENDING
        const lnB = [];
        for (let x = 150; x <= 450; x += 5) lnB.push([x, 620 + (x % 10) * 0.2]);
        await draw(env, lnB);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 2, 'D4.0 entti i tratti commessi (2)', 'n=' + s.length);
        env0.undoKey(env, 1);
        const sU = strokes(env);
        ok(sU.length === 1, 'D4.1 undo1 -> resta il 1 tratto',
            JSON.stringify(sU.map(o => o.vclass)));
        ok(sU.length === 1 && sU[0].vclass === 'line',
            'D4.2 snapshot materializzato: tratto1 COMMESSO, non grezzo (M05)',
            JSON.stringify(sU.map(o => o.vclass)));
        ok(sU.length === 1 && sU[0].pts.length === 2,
            'D4.3 tratto1 snapshot =2 punti ideali (non i grezzi)',
            String(sU.length ? sU[0].pts.length : -1));

        /* D5: persistenza M05 - save (debounce 900) + riapri la nota */
        await freshDoc(env);
        const lnP = [];
        for (let x = 160; x <= 552; x += 4) {
            lnP.push([x, 250 + 3 * Math.sin(2 * Math.PI * (x - 160) / 24 + 0.8)]);
        }
        await draw(env, lnP);
        await sleep(400);
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'line',
            'D5.0 tratto commesso prima del save',
            JSON.stringify(s.map(o => o.vclass)));
        const paramsP = JSON.stringify(s[0].params);
        await sleep(1400);   // save debounce 900 + doSave
        await env0.openNote(env, 'n1');
        s = strokes(env);
        ok(s.length === 1 && s[0].vclass === 'line',
            'D5.1 riapri la nota -> oggetto ancora vclass line (M05)',
            JSON.stringify(s.map(o => o.vclass)));
        ok(s.length === 1 && JSON.stringify(s[0].params) === paramsP,
            'D5.2 params IDENTICI dopo reload (JSON confronto)',
            'len ' + (s.length ? JSON.stringify(s[0].params).length : -1) +
            '/' + paramsP.length);

        /* D6: zoom non rigenera nulla (2.45 e poi 1) */
        const jsonZ = JSON.stringify(ink.objects());
        const zRet = ink.setZoom(2.45);
        await sleep(60);
        ok(zRet !== null && Math.abs(zRet - 2.45) < 0.01,
            'D6.0 setZoom(2.45) applicato', String(zRet));
        ok(JSON.stringify(ink.objects()) === jsonZ,
            'D6.1 oggetti IDENTICI a zoom 2.45 (nessuna rigenerazione)');
        ink.setZoom(1);
        await sleep(60);
        ok(JSON.stringify(ink.objects()) === jsonZ,
            'D6.2 oggetti IDENTICI a zoom 1');

        /* ============================================================
           E. CONTATORI / LOG
           ============================================================ */
        console.log('--- E. CONTATORI / LOG ---');

        await freshDoc(env);
        c0 = snapC(ink);
        const lnE = [];
        for (let x = 150; x <= 500; x += 5) lnE.push([x, 450 + Math.sin(x / 30) * 1.5]);
        await draw(env, lnE);
        await sleep(60);   // ancora grezzo: catturo nRaw
        const sE = strokes(env);
        const nRaw = sE.length ? sE[0].pts.length : 0;
        await sleep(350);
        const c1 = ink.counters;
        ok(c1.classified.line === c0.classified.line + 1,
            'E1.0 classified.line +1',
            String(c1.classified.line - c0.classified.line));
        ok(c1.total === c0.total + 1, 'E1.1 total +1',
            String(c1.total - c0.total));
        ok(c1.n_classified === c0.n_classified + 1, 'E1.2 n_classified +1',
            String(c1.n_classified - c0.n_classified));
        ok(c1.perfected_on_release === c0.perfected_on_release + 1,
            'E1.3 perfected_on_release +1',
            String(c1.perfected_on_release - c0.perfected_on_release));
        ok(c1.refined === c0.refined + 1, 'E1.4 refined +1',
            String(c1.refined - c0.refined));
        ok(c1.discarded === c0.discarded, 'E1.5 discarded INVARIATO',
            String(c1.discarded - c0.discarded));
        ok((c1.byKind.line || 0) === (c0.byKind.line || 0) + 1,
            'E1.6 byKind.line +1',
            String((c1.byKind.line || 0) - (c0.byKind.line || 0)));
        const swapDelta = c1.swapped_pixels - c0.swapped_pixels;
        ok(swapDelta >= 0.5 * nRaw,
            'E1.7 swapped_pixels >= 0.5 x nRaw',
            swapDelta + '/' + nRaw);
        ok(c1.residual_px <= 0.5, 'E1.7b residual_px <=0.5',
            String(c1.residual_px));
        ok(c1.stroke.total === 1, 'E1.8 stroke.total===1',
            String(c1.stroke.total));

        /* E2: raw -> discarded+1 e classified invariato */
        await freshDoc(env);
        c0 = snapC(ink);
        await draw(env, [[210, 210], [220, 212]]);
        await sleep(380);
        ok(ink.counters.discarded === c0.discarded + 1,
            'E2.0 raw: discarded +1',
            String(ink.counters.discarded - c0.discarded));
        ok(JSON.stringify(ink.counters.classified) === JSON.stringify(c0.classified),
            'E2.1 raw: classified INVARIATO');

        /* E3: spy console.info - righe [ink24] e [inkV] class= */
        ok(logLines.some(l => l.indexOf('[ink24] ') >= 0),
            'E3.0 log console.info con prefisso [ink24] ',
            'n=' + logLines.length);
        ok(logLines.some(l => l.indexOf('[inkV] class=') >= 0),
            'E3.1 log console.info con [inkV] class=',
            'n=' + logLines.length);

        console.log('\nRISULTATO u20_shaping: ' + pass + ' passati, ' + fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO u20_shaping: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
