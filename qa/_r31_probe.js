'use strict';
/* probe rapido del motore ink-commit su jsdom (_ink_env) */
const env0 = require('../tests/_ink_env');
const sleep = env0.sleep;
let pass = 0, fail = 0;
function ok(c, n, extra) {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; console.log('  FAIL  ' + n + (extra ? ' - ' + extra : '')); }
}
function freshDoc(env) { env.store.items[0].content = ''; return env0.openNote(env, 'n1'); }
function strokes(env) { return env.win.__ink.objects().filter(o => o.t === 'stroke'); }
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
(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!env.win.InkCommit && !!env.win.InkCommit.CFG, '0.0 InkCommit + CFG caricati');
        ok(!!ink && ink.state().settleMs >= 150 && ink.state().settleMs <= 300,
            '0.1 settleMs dentro150-300', String(ink.state() && ink.state().settleMs));
        ok(ink.state().shpOn === undefined && ink.state().ghost === undefined &&
           typeof ink.setShaping === 'undefined', '0.2 flag/ghost/setShaping eliminati (M01)');

        // --- V01-like: linea ondulata ---
        const wline = [];
        for (let x = 156; x <= 552; x += 4) wline.push([x, 250 + 4 * Math.sin(2 * Math.PI * x / 24)]);
        let c0 = JSON.parse(JSON.stringify(ink.counters));
        const canvas = env0.canvasOf(env);
        const b = env0.wc(env, wline);
        env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
        for (let i = 1; i < b.length; i++) env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
        const rel = ink.trace.filter(e => e.k === 'release').length;
        env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
        await sleep(90);
        let s1 = strokes(env);
        ok(s1.length === 1 && s1[0]._wet === true,
            '1.0 durante settle: raw visibile + _wet (K01/L02)',
            JSON.stringify({ n: s1.length, wet: s1[0] && s1[0]._wet, pts: s1[0] ? s1[0].pts.length : -1 }));
        const relEv = ink.trace.filter(e => e.k === 'release');
        ok(relEv.length === rel + 1 && relEv[relEv.length - 1].cls === 'line',
            '1.1 trace release cls=line', JSON.stringify(relEv.slice(-1)));
        await sleep(350);
        s1 = strokes(env);
        const swEv = ink.trace.filter(e => e.k === 'swap');
        ok(swEv.length >= 1 && swEv[swEv.length - 1].dt >= 150 && swEv[swEv.length - 1].dt <= 320,
            '1.2 swap dopo finestra150-300ms (K01)', JSON.stringify(swEv.slice(-1)));
        ok(s1.length === 1 && s1[0].vclass === 'line' && s1[0].pts.length === 2,
            '1.3 linea commessa: vclass line +2 endpoints',
            JSON.stringify(s1.map(o => o.vclass + ':' + (o.pts || []).length)));
        ok(s1[0]._wet === undefined, '1.4 nessun _wet post-commit (L04/N08)',
            String(s1[0] && s1[0]._wet));
        if (s1[0]) {
            const a = s1[0].pts[0], e = s1[0].pts[1];
            const d0 = Math.hypot(a[0] - wline[0][0], a[1] - wline[0][1]);
            const d1 = Math.hypot(e[0] - wline[wline.length - 1][0], e[1] - wline[wline.length - 1][1]);
            ok(d0 <= 3 && d1 <= 3, '1.5 endpoint +-3px (Q01)',
                d0.toFixed(2) + '/' + d1.toFixed(2));
            let md = 0;
            for (const q of wline) {
                const dx = e[0] - a[0], dy = e[1] - a[1];
                const L = Math.hypot(dx, dy);
                const d = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L;
                if (d > md) md = d;
            }
            ok(md > 0.5, '1.6 il grezzo ondulato NON e il render (K03): dev grezzo=' + md.toFixed(2));
        }
        ok(ink.counters.classified.line === c0.classified.line + 1 &&
           ink.counters.perfected_on_release === c0.perfected_on_release + 1,
            '1.7 contatori line/perf +1', JSON.stringify(ink.counters.classified));

        // --- V03-like: semicerchio (arco) ---
        await freshDoc(env);
        const semi = [];
        for (let i = 0; i <= 60; i++) {
            const a = Math.PI * 0.05 + (i / 60) * Math.PI * 0.9;
            semi.push([400 + Math.cos(a) * 60 + Math.sin(i / 3) * 1.2,
                       300 + Math.sin(a) * 60 + Math.cos(i / 4) * 1.2]);
        }
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, semi);
        await sleep(380);
        let s2 = strokes(env);
        ok(s2.length === 1 && s2[0].vclass === 'arc' && s2[0].params &&
           s2[0].params.kind === 'circle',
            '2.0 semicerchio -> arc (kind circle)',
            JSON.stringify(s2.map(o => o.vclass + '/' + (o.params ? o.params.kind : '-'))));
        ok(ink.counters.classified.arc === c0.classified.arc + 1, '2.1 contatore arc +1');
        if (s2[0] && s2[0].params && s2[0].params.kind === 'circle') {
            const p = s2[0].params;
            const gap = Math.hypot(s2[0].pts[s2[0].pts.length - 1][0] - s2[0].pts[0][0],
                                   s2[0].pts[s2[0].pts.length - 1][1] - s2[0].pts[0][1]);
            ok(gap >= 50, '2.2 arco resta APERTO (N01)', 'gap=' + gap.toFixed(1));
            let mx = 0;
            for (const q of s2[0].pts) {
                const d = Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r);
                if (d > mx) mx = d;
            }
            ok(mx <= 0.5, '2.3 residuo render vs modello <=0.5px (Q01)', mx.toFixed(3));
            ok(Math.abs(p.sweep) * 180 / Math.PI >= 80, '2.4 ampiezza preservata (~90+gradi)',
               (Math.abs(p.sweep) * 180 / Math.PI).toFixed(1));
        }

        // --- V05-like: S con2 flessi ---
        await freshDoc(env);
        const sPts = [];
        for (let x = 150; x <= 550; x += 4) sPts.push([x, 300 + 45 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, sPts);
        await sleep(380);
        let s3 = strokes(env);
        ok(s3.length === 1 && s3[0].vclass === 'freeform',
            '3.0 S -> freeform', JSON.stringify(s3.map(o => o.vclass)));
        if (s3[0]) {
            const fIn = countFlessi(sPts), fOut = countFlessi(s3[0].pts);
            ok(fIn >= 2 && fOut >= 2, '3.1 flessi preservati (T03/V05)', fIn + '->' + fOut);
            ok(!s3[0].params || (!s3[0].params.arc && !s3[0].params.p && s3[0].params.kind === 'smooth'),
                '3.2 nessun snap parametrico (smooth only)',
                JSON.stringify(s3[0].params));
        }
        ok(ink.counters.classified.freeform === c0.classified.freeform + 1, '3.3 freeform +1');

        // --- T05: cerchio CHIUSO -> closed, MAI cerchio perfetto ---
        await freshDoc(env);
        const circ = [];
        for (let i = 0; i < 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            circ.push([400 + Math.cos(a) * (45 + Math.sin(i * 2.1) * 3),
                       300 + Math.sin(a) * (45 + Math.cos(i * 1.7) * 3)]);
        }
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, circ);
        await sleep(380);
        let s4 = strokes(env);
        ok(s4.length === 1 && s4[0].vclass === 'closed',
            '4.0 cerchio -> closed (T05)', JSON.stringify(s4.map(o => o.vclass)));
        ok(s4[0] && s4[0].params && s4[0].params.kind === 'smooth',
            '4.1 MAI conversione in cerchio/ellipse (N07)',
            s4[0] && s4[0].params ? s4[0].params.kind : 'null');
        ok(ink.counters.classified.closed === c0.classified.closed + 1, '4.2 closed +1');

        // --- T06: tap/corto -> grezzo ---
        await freshDoc(env);
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, [[200, 200], [210, 202], [216, 204]]);
        await sleep(380);
        let s5 = strokes(env);
        ok(s5.length === 1 && (!s5[0].vclass || s5[0].vclass === undefined),
            '5.0 tratto corto resta GREZZO (T06)', JSON.stringify(s5.map(o => o.vclass)));
        ok(ink.counters.discarded === c0.discarded + 1, '5.1 discarded +1');

        // --- V02-like: freccia stesso tratto (back-stroke) ---
        await freshDoc(env);
        const lineA = [];
        for (let i = 0; i <= 27; i++) lineA.push([150 + i * 10, 250 + Math.sin(i / 6) * 1.2]);
        const endA = lineA[lineA.length - 1];
        const flickA = [[endA[0] + 6, endA[1] + 4.5], [endA[0] - 15, endA[1] + 8]];
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, lineA.concat(flickA));
        await sleep(380);
        let s6 = strokes(env);
        ok(s6.length === 1 && s6[0].vclass === 'arrow',
            '6.0 retta+flick -> arrow', JSON.stringify(s6.map(o => o.vclass)));
        if (s6[0] && s6[0].vclass === 'arrow') {
            const p = s6[0].params;
            ok(!!p.head && p.shaftKind === 'line', '6.1 params.head + shaftKind=line',
                JSON.stringify({ h: !!p.head, s: p.shaftKind }));
            if (p.head) {
                const sz = s6[0].size || 2;
                ok(p.head.len >= 3 * sz && p.head.len <= 4 * sz,
                    '6.2 punta lunghezza 3-4x spessore (F03)', p.head.len.toFixed(2) + '/' + sz);
                ok(p.head.wing >= 30 && p.head.wing <= 40, '6.3 ali 30-40gradi (F03)', String(p.head.wing));
            }
        }
        ok(ink.counters.classified.arrow === c0.classified.arrow + 1, '6.4 arrow +1');

        // --- F01: secondo tratto breve assorbito ---
        await freshDoc(env);
        const ln = [];
        for (let i = 0; i <= 30; i++) ln.push([150 + i * 8, 400 + (i % 3) * 0.4]);
        await draw(env, ln);
        await sleep(240);   // commesso (settle200) e ancora entro300ms dal rilascio
        s6 = strokes(env);
        ok(s6.length === 1 && s6[0].vclass === 'line', '7.0 asta commessa prima',
            JSON.stringify(s6.map(o => o.vclass)));
        const e2 = s6[0].pts[s6[0].pts.length - 1];
        const fl2 = [[e2[0] - 30, e2[1] + 22], [e2[0] - 8, e2[1] + 15], [e2[0] + 14, e2[1] + 9]];
        await draw(env, fl2, { dt: 15 });
        await sleep(380);
        let s7 = strokes(env);
        ok(s7.length === 1 && s7[0].vclass === 'arrow' && !!s7[0].params.head,
            '7.1 secondo tratto assorbito: UN oggetto arrow (F01/F02/F04)',
            JSON.stringify(s7.map(o => o.vclass)));
        // M04: un solo undo rimuove asta+punta
        env0.undoKey(env, 1);
        ok(ink.objects().length === 0, '7.2 M04: un undo rimuove asta+punta insieme',
            'n=' + ink.objects().length);
        env0.undoKey(env, -0); // no-op
        // redo
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'y', ctrlKey: true, bubbles: true }));
        let s8 = ink.objects();
        ok(s8.length === 1 && s8[0].vclass === 'arrow' && !!s8[0].params.head,
            '7.3 redo ripristina identico (M04)', JSON.stringify(s8.map(o => o.vclass)));

        // --- N03: rilascio ISTANTANEO senza hold comunque perfeziona ---
        await freshDoc(env);
        const q = [];
        for (let x = 100; x <= 400; x += 5) q.push([x, 500 + (x % 10) * 0.2]);
        await draw(env, q);   // nessuna pausa
        await sleep(380);
        ok(strokes(env)[0] && strokes(env)[0].vclass === 'line',
            '8.0 N03: commit al rilascio senza pausa');

        // --- K04: tratti indipendenti (3 rilasci rapidi) ---
        await freshDoc(env);
        for (let k = 0; k < 3; k++) {
            const y = 150 + k * 60;
            const l = [];
            for (let x = 100; x <= 300; x += 5) l.push([x, y + Math.sin(x / 20 + k) * 2]);
            await draw(env, l);
            await sleep(30);
        }
        await sleep(500);
        const s9 = strokes(env);
        ok(s9.length === 3 && s9.every(o => o.vclass === 'line'),
            '9.0 K04:3 tratti ->3 commit indipendenti tutti line',
            JSON.stringify(s9.map(o => o.vclass)));

        // --- N05: disegnare altro NON tocca i tratti commessi ---
        const before = JSON.stringify(ink.objects());
        await draw(env, [[600, 600], [640, 640], [680, 600]]);
        await sleep(380);
        const after = JSON.parse(JSON.stringify(ink.objects()));
        const first3 = JSON.stringify(after.slice(0, 3));
        ok(first3 === before, '10.0 N05: tratti gia commessi INVIOLATI');

        console.log('\nRISULTATO r31_probe: ' + pass + ' passati, ' + fail + ' falliti');
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO r31_probe: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
