'use strict';
/* tests/u22_reshape_r22.test.js - R31 (PROMPT ROUND 29): QUALITA' di
   rettifica del motore ink-commit (erede di R22: rette/archi ricostruiti
   DA ZERO). Copre: (a) retta jitter -> angolo/genitore <=1gradi;
   (b) arco rumoroso -> residuo render<=0.5px vs circonferenza params,
   render NON= grezzi, endpoint +-3px; (c) tangenti modello vs direzione
   locale grezza <=10gradi (A03) e sweep vs grezzo <=5gradi (A02);
   (d) arco+flick -> arrow con punta saldata (geometria F03/A06);
   (e) C irregolare resta APERTA e scarabocchio denso -> mode light
   (mai snap); (f) branch BEZ su angolo raccordato (cubica singola LSQ,
   tol=max(4px,11% corda)) con MEASURE del branch.
   Harness tests/_ink_env.js; pattern a14_shaping/probe R31.
   Esecuzione: node tests/u22_reshape_r22.test.js */
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = env0.sleep;

function freshDoc(env) { env.store.items[0].content = ''; return env0.openNote(env, 'n1'); }
function strokes(env) { return env.win.__ink.objects().filter(o => o.t === 'stroke'); }
function shapes(env) { return env.win.__ink.objects().filter(o => o.t === 'shape'); }
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function distPtSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToPoly(p, poly) {
    let m = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
        const d = distPtSeg(p[0], p[1], poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
        if (d < m) m = d;
    }
    return isFinite(m) ? m : 0;
}
function angDeg(u, v) {
    const nu = Math.hypot(u[0], u[1]), nv = Math.hypot(v[0], v[1]);
    if (!(nu > 0) || !(nv > 0)) return 0;
    const c = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv)));
    return Math.acos(c) * 180 / Math.PI;
}
function norm(v) { const n = Math.hypot(v[0], v[1]); return n > 1e-9 ? [v[0] / n, v[1] / n] : null; }
/* residuo render vs modello parametrico (Q01 <=0.5px) */
function modelResidual(o) {
    const p = (o && o.params) || {};
    const pts = (o && o.pts) || [];
    if (p.kind === 'line' && p.p0 && p.p1) {
        let m = 0;
        for (const q of pts) m = Math.max(m, distPtSeg(q[0], q[1], p.p0[0], p.p0[1], p.p1[0], p.p1[1]));
        return m;
    }
    if (p.kind === 'circle') {
        let m = 0;
        for (const q of pts) m = Math.max(m, Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r));
        return m;
    }
    if (p.kind === 'bez' && p.p) {
        const seg = p.p, dense = [];
        for (let j = 0; j <= 64; j++) {
            const s = j / 64, u = 1 - s;
            dense.push([
                u * u * u * seg[0][0] + 3 * u * u * s * seg[1][0] + 3 * u * s * s * seg[2][0] + s * s * s * seg[3][0],
                u * u * u * seg[0][1] + 3 * u * u * s * seg[1][1] + 3 * u * s * s * seg[2][1] + s * s * s * seg[3][1]]);
        }
        let m = 0;
        for (const q of pts) m = Math.max(m, distToPoly(q, dense));
        return m;
    }
    return 0;
}
function gapOf(pts) { return dist(pts[0], pts[pts.length - 1]); }
/* sweep grezzo (unwrap angoli attorno al centro fit) — oracolo indipendente */
function rawSweep(pts, cx, cy) {
    let s = 0;
    const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    for (let i = 1; i < pts.length; i++) {
        s += wrap(Math.atan2(pts[i][1] - cy, pts[i][0] - cx) -
                  Math.atan2(pts[i - 1][1] - cy, pts[i - 1][0] - cx));
    }
    return s;
}
async function draw(env, pts) {
    const canvas = env0.canvasOf(env);
    const b = env0.wc(env, pts);
    env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
    for (let i = 1; i < b.length; i++) env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
    env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!ink && !!env.win.InkCommit, '0.0 API __ink + InkCommit presenti');
        ok(ink.state().settleMs >= 150 && ink.state().settleMs <= 300,
            '0.1 settleMs in finestra 150-300ms', String(ink.state().settleMs));

        // ===== (a) RETTA jitter +-2px -> angolo vs generatore <=1gradi =====
        {
            const rnd = lcg(4242);
            const pts = [];
            for (let x = 150; x <= 550; x += 4) pts.push([x, 250 + (rnd() - 0.5) * 4]);
            const c0 = JSON.parse(JSON.stringify(ink.counters));
            await draw(env, pts);
            await sleep(360);
            const o = strokes(env)[0];
            ok(o && o.vclass === 'line', 'a1. retta jitter -> vclass line', o ? o.vclass : 'null');
            if (o && o.vclass === 'line') {
                ok(o.pts.length === 2, 'a2. esattamente2 pts renderizzati', String(o.pts.length));
                const dv = Math.atan2(o.pts[1][1] - o.pts[0][1], o.pts[1][0] - o.pts[0][0]);
                let da = Math.abs(dv - 0);
                if (da > Math.PI / 2) da = Math.PI - da;
                const deg = da * 180 / Math.PI;
                console.log('      MEASURE a3 angolo retta vs asse x = ' + deg.toFixed(3) + 'gradi');
                ok(deg <= 1, 'a3. angolo renderizzato vs generatore <=1gradi (R22a)', deg.toFixed(3));
                const e0 = dist(o.pts[0], pts[0]), e1 = dist(o.pts[1], pts[pts.length - 1]);
                ok(Math.min(e0, e1) <= 3 && Math.max(e0, e1) <= 3,
                    'a4. endpoint grezzo->ideale +-3px', e0.toFixed(2) + '/' + e1.toFixed(2));
                let col = 0;
                for (const q of o.pts) col = Math.max(col, distPtSeg(q[0], q[1],
                    o.pts[0][0], o.pts[0][1], o.pts[1][0], o.pts[1][1]));
                ok(col <= 0.05, 'a5. pts perfettamente sulla retta (collinearita <=0.05)', String(col));
                ok(ink.counters.classified.line === c0.classified.line + 1 &&
                   ink.counters.residual_px <= 0.5,
                    'a6. contatore line +1 e residual_px <=0.5',
                    String(ink.counters.residual_px));
            }
        }

        await freshDoc(env);
        // ===== (b)+(c) ARCO semicerchio rumoroso -> circonferenza ideale =====
        let arcObj = null, arcRaw = null;
        {
            const rnd = lcg(7717);
            const cx = 400, cy = 300, R = 90;
            const pts = [];
            for (let i = 0; i <= 48; i++) {
                const a = -Math.PI / 2 + (i / 48) * Math.PI;   // semicerchio destro
                pts.push([cx + R * Math.cos(a) + (rnd() - 0.5) * 1.6,
                          cy + R * Math.sin(a) + (rnd() - 0.5) * 1.6]);
            }
            arcRaw = pts;
            const c0 = JSON.parse(JSON.stringify(ink.counters));
            await draw(env, pts);
            await sleep(360);
            arcObj = strokes(env)[0];
            ok(arcObj && arcObj.vclass === 'arc' && arcObj.params &&
               arcObj.params.kind === 'circle',
                'b1. arco rumoroso -> arc + kind circle',
                arcObj ? arcObj.vclass + '/' + (arcObj.params && arcObj.params.kind) : 'null');
            if (arcObj && arcObj.params && arcObj.params.kind === 'circle') {
                const p = arcObj.params;
                const resid = modelResidual(arcObj);
                ok(resid <= 0.5, 'b2. residuo render vs circonferenza params <=0.5px (Q01)',
                    resid.toFixed(3));
                let rawResid = 0;
                for (const q of pts) rawResid = Math.max(rawResid,
                    Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r));
                ok(rawResid <= 4, 'b3. grezzo entro tolleranza fit cerchio (<=4px MEASURE)',
                    rawResid.toFixed(2));
                let maxD = 0, sumD = 0;
                for (const q of arcObj.pts) { const d = distToPoly(q, pts); maxD = Math.max(maxD, d); sumD += d; }
                const meanD = sumD / arcObj.pts.length;
                console.log('      MEASURE b4 render-vs-grezzo max=' + maxD.toFixed(2) +
                    ' mean=' + meanD.toFixed(2));
                ok(maxD >= 0.8, 'b4. i renderizzati NON sono i grezzi (max dist >=0.8px)', maxD.toFixed(2));
                const e0 = Math.min(dist(arcObj.pts[0], pts[0]),
                                    distToPoly(pts[0], arcObj.pts));
                const e1 = Math.min(dist(arcObj.pts[arcObj.pts.length - 1], pts[pts.length - 1]),
                                    distToPoly(pts[pts.length - 1], arcObj.pts));
                ok(e0 <= 3 && e1 <= 3, 'b5. endpoint arco +-3px (A02)',
                    e0.toFixed(2) + '/' + e1.toFixed(2));
                const g = gapOf(arcObj.pts);
                ok(g >= 100, 'b6. arco resta APERTO (gap ' + g.toFixed(0) + '>=100)', '');
                // A02: sweep params vs sweep grezzo (unwrap attorno al centro) <=5gradi
                const swRaw = rawSweep(pts, p.cx, p.cy);
                const dSweep = Math.abs(Math.abs(p.sweep) - Math.abs(swRaw)) * 180 / Math.PI;
                console.log('      MEASURE b7 sweep params=' + (p.sweep * 180 / Math.PI).toFixed(1) +
                    ' grezzo=' + (swRaw * 180 / Math.PI).toFixed(1));
                ok(dSweep <= 5, 'b7. ampiezza angolare |params-grezzo| <=5gradi (A02)',
                    dSweep.toFixed(2));
                ok(ink.counters.classified.arc === c0.classified.arc + 1 &&
                   ink.counters.residual_px <= 0.5,
                    'b8. contatore arc +1 e residual_px <=0.5',
                    String(ink.counters.residual_px));
                // A03: tangenti modello vs direzione locale grezza <=10gradi
                const k = 3;
                const dirIn = norm([pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]]);
                const dirOut = norm([pts[n0(pts) - 1][0] - pts[n0(pts) - 1 - k][0],
                                     pts[n0(pts) - 1][1] - pts[n0(pts) - 1 - k][1]]);
                function n0(a) { return a.length; }
                const sg = p.sweep >= 0 ? 1 : -1;
                const a0 = p.a0, aEnd = p.a0 + p.sweep;
                const t0 = norm([-Math.sin(a0) * sg, Math.cos(a0) * sg]);
                const t1 = norm([-Math.sin(aEnd) * sg, Math.cos(aEnd) * sg]);
                const angIn = dirIn && t0 ? angDeg(dirIn, t0) : 99;
                const angOut = dirOut && t1 ? angDeg(dirOut, t1) : 99;
                console.log('      MEASURE c1 tangenti in=' + angIn.toFixed(1) +
                    ' out=' + angOut.toFixed(1) + 'gradi');
                ok(angIn <= 10, 'c1. tangente iniziale modello vs grezzo <=10gradi (A03)',
                    angIn.toFixed(1));
                ok(angOut <= 10, 'c2. tangente finale modello vs grezzo <=10gradi (A03)',
                    angOut.toFixed(1));
            }
        }

        await freshDoc(env);
        // ===== (d) ARCO + FLICK -> ARROW saldata (F03/A06) =====
        {
            const cx = 400, cy = 300, R = 55;
            const arc = [];
            for (let i = 0; i <= 50; i++) {
                const a = -Math.PI / 2 + (i / 50) * Math.PI;
                arc.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
            }
            const e = arc[arc.length - 1];
            // il moto finale dell'arco e' verso -x: il flick va a rovescio (+x)
            const full = arc.concat([[e[0] + 6, e[1] - 4.5], [e[0] + 15, e[1] - 8]]);
            const c0 = JSON.parse(JSON.stringify(ink.counters));
            await draw(env, full);
            await sleep(360);
            const objsAll = strokes(env);
            const o = objsAll[0];
            ok(objsAll.length === 1 && o && o.vclass === 'arrow',
                'd1. arco+flick -> UN oggetto arrow',
                JSON.stringify(objsAll.map(x => x.vclass)));
            if (o && o.vclass === 'arrow') {
                const p = o.params;
                ok(!!p.head && p.shaftKind === 'arc',
                    'd2. params.head + shaftKind=arc (asta=arco perfezionato)',
                    JSON.stringify({ h: !!p.head, s: p.shaftKind }));
                const sz = o.size || 2;
                ok(p.head && p.head.len >= 3 * sz && p.head.len <= 4 * sz,
                    'd3. punta 3-4x spessore (F03)', p.head ? p.head.len.toFixed(2) : 'null');
                ok(p.head && p.head.wing >= 30 && p.head.wing <= 40,
                    'd4. ali 30-40gradi (F03)', p.head ? String(p.head.wing) : 'null');
                const eEnd = o.pts[o.pts.length - 1];
                ok(p.head && dist(p.head.base, eEnd) <= 0.05,
                    'd5. base punta saldata all end asta <=0.05px',
                    p.head ? dist(p.head.base, eEnd).toFixed(3) : 'null');
                // tangente fine asta dal modello circle (A06: la punta segue
                // la tangente dell'arco, non la corda)
                if (p.kind === 'circle') {
                    const sg = p.sweep >= 0 ? 1 : -1;
                    const aEnd = p.a0 + p.sweep;
                    const tan = norm([-Math.sin(aEnd) * sg, Math.cos(aEnd) * sg]);
                    const ang = tan && p.head ? angDeg(tan, norm(p.head.dir)) : 99;
                    ok(ang <= 10, 'd6. dir punta vs tangente fine arco <=10gradi (A06/F03)',
                        ang.toFixed(1));
                } else {
                    ok(p.kind === 'circle', 'd6. shaft modello circle (per tangente)', String(p.kind));
                }
                ok(ink.counters.classified.arrow === c0.classified.arrow + 1,
                    'd7. contatore arrow +1', '');
            }
        }

        await freshDoc(env);
        // ===== (e) C irregolare: MAI chiusa, gap preservato (N01/T05) =====
        {
            const rnd = lcg(999);
            const cx = 400, cy = 300;
            const pts = [];
            for (let i = 0; i <= 60; i++) {
                const a = (40 + (i / 60) * 280) * Math.PI / 180;
                pts.push([cx + 45 * Math.cos(a) + (rnd() - 0.5) * 2.4,
                          cy + 45 * Math.sin(a) + (rnd() - 0.5) * 2.4]);
            }
            await draw(env, pts);
            await sleep(360);
            const o = strokes(env)[0];
            const g0 = gapOf(pts), g1 = o ? gapOf(o.pts) : -1;
            ok(o && o.vclass !== 'closed',
                'e1. C irregolare resta della famiglia APERTA (mai closed)',
                o ? o.vclass : 'null');
            ok(g1 > 12 && Math.abs(g1 - g0) <= 6,
                'e2. gap post entro +6px di gap pre (C resta C, N01)',
                g0.toFixed(1) + '->' + g1.toFixed(1));
        }

        await freshDoc(env);
        // ===== (f) SCARABOCCHIO DENSO -> mode light (T07, mai snap) =====
        {
            const loops = [];
            const circ = (ccx, ccy) => {
                for (let i = 0; i < 48; i++) {
                    const a = (i / 48) * Math.PI * 2;
                    loops.push([ccx + 30 * Math.cos(a), ccy + 30 * Math.sin(a)]);
                }
            };
            circ(400, 300); circ(420, 306); circ(440, 300);   // transizioni = incroci
            await draw(env, loops);
            await sleep(360);
            const o = strokes(env)[0];
            ok(o && o.vclass === 'freeform',
                'f1. scarabocchio denso -> freeform (T07)', o ? o.vclass : 'null');
            ok(o && o.params && o.params.mode === 'light',
                'f2. smoothing LEGGERO (mode light)', o && o.params ? String(o.params.mode) : 'null');
            ok(o && o.params && o.params.p === undefined && o.params.cx === undefined,
                'f3. MAI snap parametrico (no p/cx)', JSON.stringify(o && o.params));
        }

        await freshDoc(env);
        // ===== (g) BRANCH BEZ: angolo raccordato (cubica singola LSQ) =====
        {
            /* angolo raccordato = generatore VERIFICATO (qaR31 V03 corner) */
            const Cx = 400, Cy = 300;
            const pts = [];
            for (let x = -230; x <= -104; x += 5) pts.push([Cx + x, Cy - 120]);
            for (let i = 0; i <= 10; i++) {
                const a = Math.PI + (i / 10) * Math.PI / 2;
                pts.push([Cx - 104 + 14 * (Math.cos(a) + 1),
                          Cy - 120 + 14 * (Math.sin(a) + 1)]);
            }
            for (let y = -106; y <= -20; y += 5) pts.push([Cx - 90, Cy + y]);
            await draw(env, pts);
            await sleep(360);
            const o = strokes(env)[0];
            ok(o && o.vclass === 'arc',
                'g1. angolo raccordato -> vclass arc (T02: curvatura a segno costante)',
                o ? o.vclass : 'null');
            if (o && o.params) {
                console.log('      MEASURE g2 branch bez: kind=' + o.params.kind +
                    ' nf=' + env.win.InkCommit.countFlessi(o.pts));
                ok(o.params.kind === 'bez',
                    'g2. branch CUBICA SINGOLA (kind bez: cerchio >4px, tol=11% corda)',
                    String(o.params.kind));
                const resid = modelResidual(o);
                ok(resid <= 0.5, 'g3. residuo render vs modello bez <=0.5px', resid.toFixed(3));
                const ch = dist(pts[0], pts[pts.length - 1]);
                const e0 = distToPoly(pts[0], o.pts), e1 = distToPoly(pts[pts.length - 1], o.pts);
                ok(e0 <= 3 && e1 <= 3,
                    'g4. endpoint +-3px su gomito (A02, cubica con endpoint fissi)',
                    e0.toFixed(2) + '/' + e1.toFixed(2));
                ok(o.params.p && o.params.p.length === 4,
                    'g5. params.p = UNA sola cubica (4 controlli)', '');
            }
        }

        // ===== finale: nessun oggetto shape mai prodotto (N04) =====
        ok(shapes(env).length === 0, 'z1. nessun t=shape prodotto in tutta la sessione (N04)',
            String(shapes(env).length));

        console.log('\nRISULTATO u22_reshape_r22: ' + pass + ' passati, ' + fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO u22_reshape_r22: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
