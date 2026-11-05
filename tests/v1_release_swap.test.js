'use strict';
/* tests/v1_release_swap.test.js - R25 FE-INK V1: RELEASE-SWAP.
   Copre i requisiti V1.1-V1.5 + i contatori V0 richiesti dal QA reale:
   - contatori window.__ink.counters: classified {line,arc,freeform,closed,
     arrow} (chiavi ESATTE), total/n_classified (transizione dello scalare),
     strokes_live, perfected_on_release, swapped_pixels, residual_px,
     refined/discarded/byKind invariati (backward-compat R24);
   - LINEA: retta con onde piccole -> line, residuo render-vs-modello
     <=0.5px, deviazione grezzo <=3% corda (gate lasso V1.1);
   - ARCO: semicerchio -> vclass arc (params.arc Kasa), RESTA APERTO,
     residuo <=1.5px;
   - FREEFORM: S a 2 flessi -> vclass freeform, >=2 flessi PRESERVATI,
     params.freeform e NESSUN params.bez (nessun snap), topologia invariata;
   - CHIUSO: cerchio -> class closed;
   - FRECCIA: flick rapido SENZA pausa (finestra 120ms/35px, V0: 2 move)
     su retta -> UN oggetto arrow con ali 30-45gradi e 3-4x spessore,
     rilevato dal fallback back-stroke (dbgF r=-1, r2>=0);
   - OFF -> hold-still R20 (ghost al fermo, commit al rilascio);
   - undo a 2 livelli (1 = tratto grezzo, 2 = rimosso);
   - zoom 100% e 245%: stesse classi/residui (soglie in coordinate MONDO).
   Pattern deterministico u20/a14/u22/u24: dispatch dt=0, setShaping
   (true,true,900) -> holdMs clamp 800 (nessuno hold-still per tratti veloci).
   Esecuzione: node tests/v1_release_swap.test.js */
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = env0.sleep;

function freshDoc(env) {
    env.store.items[0].content = '';
    return env0.openNote(env, 'n1');
}
function shapes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'shape');
}
function strokes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'stroke');
}
function snap(o) { return JSON.parse(JSON.stringify(o)); }

/* disegna un tratto con dispatch SINCRONO (dt=0 = rilascio senza pausa) */
function drawPts(env, pts) {
    const canvas = env0.canvasOf(env);
    const b = env0.wc(env, pts);
    env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
    for (let i = 1; i < b.length; i++) {
        env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
    }
    env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
    return canvas;
}
/* conta flessi in modo INDEPENDENTE dal motore (proiezione corda +
   derivata con dead-band) - oracolo del test */
function countFlessi(pts) {
    const n = (pts || []).length;
    if (n < 6) return 0;
    const a = pts[0], b = pts[n - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 15) return 0;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const eps = Math.max(0.5, L * 0.004);
    const d = pts.map(q => -uy * (q[0] - a[0]) + ux * (q[1] - a[1]));
    let last = 0, cnt = 0;
    for (let i = 1; i < n; i++) {
        const dd = d[i] - d[i - 1];
        if (Math.abs(dd) < eps) continue;
        const sg = dd > 0 ? 1 : -1;
        if (last && sg !== last) cnt++;
        last = sg;
    }
    return cnt;
}
/* auto-intersezioni NON adiacenti (oracolo topologia) */
function segCross(a, b, c, d) {
    const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
    const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function selfInt(pts) {
    let c = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        for (let j = i + 2; j < pts.length - 1; j++) {
            if (i === 0 && j === pts.length - 2) continue;   // estremi condivisi
            if (segCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) c++;
        }
    }
    return c;
}
/* max distanza punti -> polilinea */
function maxDistToPoly(pts, poly) {
    let m = 0;
    for (const q of pts) {
        let bd = Infinity;
        for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i], b = poly[i + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
            if (d < bd) bd = d;
        }
        if (bd > m) m = bd;
    }
    return m;
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!ink, '0.0 API __ink presente');

        // spy console.info (log [ink24] backward-compat + [inkV] nuovo)
        const logs = [];
        const origInfo = env.win.console.info;
        env.win.console.info = function () {
            try { logs.push(Array.prototype.map.call(arguments, String).join(' ')); }
            catch (e) { /* noop */ }
            try { if (typeof origInfo === 'function') origInfo.apply(env.win.console, arguments); }
            catch (e) { /* noop */ }
        };

        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);   // holdMs clamp 800
        ink.setReleaseRefine(true);

        // ============ 1) struttura contatori V0 ============
        const c = ink.counters;
        ok(!!c && typeof c.classified === 'object' && c.classified !== null &&
           !Array.isArray(c.classified),
            '1.0 counters.classified e un OGGETTO (transizione dichiarata)',
            JSON.stringify(c && c.classified));
        const kexp = ['arc', 'arrow', 'closed', 'freeform', 'line'].join(',');
        ok(Object.keys(c.classified || {}).sort().join(',') === kexp,
            '1.1 classified chiavi ESATTE {line,arc,freeform,closed,arrow}',
            Object.keys(c.classified || {}).sort().join(','));
        ok(typeof c.total === 'number' && typeof c.n_classified === 'number',
            '1.2 scalare cumulato in .total / .n_classified (ex .classified)',
            'total=' + c.total);
        ok(typeof c.strokes_live === 'number' && c.strokes_live === 0,
            '1.3 strokes_live numerico e 0 a riposo', String(c.strokes_live));
        ok(typeof c.perfected_on_release === 'number',
            '1.4 perfected_on_release presente', String(c.perfected_on_release));
        ok(typeof c.swapped_pixels === 'number',
            '1.5 swapped_pixels presente', String(c.swapped_pixels));
        ok(typeof c.residual_px === 'number',
            '1.6 residual_px presente', String(c.residual_px));
        ok(c.refined !== undefined && c.discarded !== undefined &&
           !!c.byKind,
            '1.7 campi R24 mantenuti (refined/discarded/byKind)',
            JSON.stringify({ r: c.refined, d: c.discarded }));
        ok(!!c.stroke && typeof c.stroke.classified === 'object' &&
           Object.keys(c.stroke.classified).sort().join(',') === kexp &&
           typeof c.stroke.total === 'number',
            '1.8 stroke.classified oggetto per classe + stroke.total',
            JSON.stringify(c.stroke));
        ok(ink.state().releaseRefine === true, '1.9 default releaseRefine ON');
        ok(typeof ink.zoom === 'function' && typeof ink.setZoom === 'function',
            '1.10 API zoom/setZoom su __ink (V1.4)');

        // ============ 2) LINE: retta con onde piccole ============
        const wline = [];
        for (let x = 150; x <= 550; x += 5) {
            wline.push([x, 250 + 5 * Math.sin(2 * Math.PI * x / 24)]);
        }
        let c0 = snap(ink.counters);
        let canvas = env0.canvasOf(env);
        let b = env0.wc(env, wline);
        env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
        for (let i = 1; i < b.length; i++) {
            env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
        }
        ok(ink.counters.strokes_live === 1,
            '2.0 strokes_live=1 mentre il tratto e attivo', String(ink.counters.strokes_live));
        env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
        await sleep(150);
        ok(ink.counters.strokes_live === 0,
            '2.1 strokes_live=0 dopo il commit (rilascio SENZA pausa)',
            String(ink.counters.strokes_live));
        let sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line' && strokes(env).length === 0,
            '2.2 retta ondulata rilasciata -> UNA shape line, 0 stroke',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        ok(sh[0] && sh[0].vclass === 'line' && sh[0].pts.length === 2,
            '2.3 vclass=line + segmento ideale esatto (2 endpoints)',
            sh[0] ? 'vclass=' + sh[0].vclass + ' n=' + sh[0].pts.length : 'null');
        if (sh[0] && sh[0].kind === 'line') {
            const a = sh[0].pts[0], e = sh[0].pts[1];
            const ch = Math.hypot(e[0] - a[0], e[1] - a[1]);
            let dev = 0;
            for (const q of wline) {
                const dx = e[0] - a[0], dy = e[1] - a[1];
                const d = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / (ch || 1);
                if (d > dev) dev = d;
            }
            console.log('      MEASURE 2.4 dev grezzo->linea = ' + dev.toFixed(2) +
                'px su corda ' + ch.toFixed(1) + 'px (' +
                (100 * dev / ch).toFixed(2) + '%, gate 3%)');
            ok(dev <= 0.03 * ch + 1e-6,
                '2.4 deviazione grezzo <=3% della lunghezza (gate linea lasso)',
                dev.toFixed(2) + ' / ' + (0.03 * ch).toFixed(2));
        }
        ok(ink.counters.classified.line === c0.classified.line + 1 &&
           ink.counters.total === c0.total + 1 &&
           ink.counters.n_classified === c0.total + 1,
            '2.5 classified.line +1 e totale +1 (oggetto + scalare)',
            JSON.stringify(ink.counters.classified) + ' total=' + ink.counters.total);
        ok(ink.counters.perfected_on_release === c0.perfected_on_release + 1,
            '2.6 perfected_on_release +1 (retta rilasciata SENZA pausa)',
            String(ink.counters.perfected_on_release - c0.perfected_on_release));
        ok(ink.counters.swapped_pixels - c0.swapped_pixels >= 0.8 * wline.length,
            '2.7 swapped_pixels += max(n_grezzi, n_ideali) (>=80% dei grezzi)',
            String(ink.counters.swapped_pixels - c0.swapped_pixels));
        ok(ink.counters.residual_px <= 0.5,
            '2.8 residual_px (render vs modello ideale) <=0.5px',
            String(ink.counters.residual_px));
        ok(ink.counters.refined === c0.refined + 1 &&
           ink.counters.discarded === c0.discarded,
            '2.9 refined +1, discarded invariato (backward-compat R24)',
            JSON.stringify({ r: ink.counters.refined, d: ink.counters.discarded }));
        ok(ink.counters.byKind.line >= (c0.byKind.line || 0) + 1,
            '2.10 byKind.line +1 (backward-compat)', JSON.stringify(ink.counters.byKind));
        ok(ink.counters.stroke.total === 1 && ink.counters.stroke.classified.line === 1 &&
           ink.counters.stroke.perfected_on_release === 1,
            '2.11 contatori TRATTO: total=1 line=1 perf=1',
            JSON.stringify(ink.counters.stroke));
        ok(logs.some(l => /^\[ink24\] /.test(l)) &&
           logs.some(l => /\[inkV\] class=line:1 .*perf=\d+ swapPx=\d+ residuo=\d/.test(l)),
            '2.12 log [ink24] (compat) + [inkV] class=... perf= swapPx= residuo=',
            JSON.stringify(logs.slice(-3)));

        // ==== 2b) LINE con SINGOLO leggero arco (gate lasso garantito) ====
        await freshDoc(env);
        const bow = [];
        // y=350 (NON 250): il vecchio y=250 rendeva il pointerdown di bow
        // SOPRA la wline esistente -> drag della shape invece di nuovo tratto
        // (bug geometria del test, non del prodotto: la app dragga correttamente)
        for (let x = 150; x <= 550; x += 5) {
            bow.push([x, 350 + 8 * Math.sin(Math.PI * (x - 150) / 400)]);
        }
        c0 = snap(ink.counters);
        drawPts(env, bow);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line' && sh[0].vclass === 'line',
            '2b.0 retta con arco singolo (dev 8px > tol) -> line (gate 3%)',
            JSON.stringify(sh.map(s => s.kind + ':' + (s.vclass || '?'))));
        ok(ink.counters.classified.line === c0.classified.line + 1 &&
           ink.counters.residual_px <= 0.5,
            '2b.1 classified.line +1 e residuo <=0.5px',
            'res=' + ink.counters.residual_px);

        // ============ 3) ARCO SEMPLICE: semicerchio ============
        await freshDoc(env);
        const semi = [];
        for (let i = 0; i <= 60; i++) {
            const a = Math.PI + (i / 60) * Math.PI;
            semi.push([400 + Math.cos(a) * 60, 300 + Math.sin(a) * 60]);
        }
        c0 = snap(ink.counters);
        drawPts(env, semi);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'curve' && sh[0].vclass === 'arc',
            '3.0 semicerchio -> vclass arc (kind curve compat R20)',
            JSON.stringify(sh.map(s => s.kind + ':' + (s.vclass || '?'))));
        ok(sh[0] && sh[0].params && sh[0].params.arc &&
           typeof sh[0].params.arc.r === 'number',
            '3.1 params.arc (fit cerchio Kasa ex novo)',
            sh[0] ? JSON.stringify(Object.keys(sh[0].params || {})) : 'null');
        if (sh[0] && sh[0].pts.length >= 2) {
            const gap = Math.hypot(
                sh[0].pts[sh[0].pts.length - 1][0] - sh[0].pts[0][0],
                sh[0].pts[sh[0].pts.length - 1][1] - sh[0].pts[0][1]);
            ok(gap >= 100, '3.2 arco resta APERTO (gap >=100px, mai chiuso)', 'gap=' + gap.toFixed(1));
        }
        ok(ink.counters.classified.arc === c0.classified.arc + 1,
            '3.3 classified.arc +1', JSON.stringify(ink.counters.classified));
        ok(ink.counters.classified.closed === c0.classified.closed,
            '3.4 l arco NON e contato come closed', String(ink.counters.classified.closed));
        ok(ink.counters.residual_px <= 1.5,
            '3.5 residual_px arc <=1.5px (punti render vs cerchio ideale)',
            String(ink.counters.residual_px));

        // ============ 4) FREEFORM: S a 2 flessi ============
        await freshDoc(env);
        const sPts = [];
        for (let x = 150; x <= 550; x += 5) {
            sPts.push([x, 300 + 40 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
        }
        c0 = snap(ink.counters);
        drawPts(env, sPts);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'curve' && sh[0].vclass === 'freeform',
            '4.0 S a 2 flessi -> vclass freeform (kind curve compat)',
            JSON.stringify(sh.map(s => s.kind + ':' + (s.vclass || '?'))));
        ok(sh[0] && sh[0].params && sh[0].params.freeform === true &&
           sh[0].params.bez === undefined && sh[0].params.arc === undefined,
            '4.1 params.freeform=true e NESSUN bez/arc (nessun snap)',
            sh[0] ? JSON.stringify(Object.keys(sh[0].params || {})) : 'null');
        if (sh[0]) {
            const fIn = countFlessi(sPts), fOut = countFlessi(sh[0].pts);
            const siIn = selfInt(sPts), siOut = selfInt(sh[0].pts);
            console.log('      MEASURE 4.2 flessi grezzi=' + fIn +
                ' render=' + fOut + ' | auto-inters grezzi=' + siIn +
                ' render=' + siOut);
            ok(fIn >= 2 && fOut >= 2,
                '4.2 >=2 flessi PRESERVATI (grezzi=' + fIn + ', render=' + fOut + ')');
            ok(siOut <= siIn,
                '4.3 topologia invariata (auto-intersezioni non aumentate)',
                siIn + ' -> ' + siOut);
        }
        ok(ink.counters.classified.freeform === c0.classified.freeform + 1 &&
           ink.counters.classified.line === c0.classified.line &&
           ink.counters.classified.arc === c0.classified.arc,
            '4.4 classified.freeform +1 (le altre classi invariate)',
            JSON.stringify(ink.counters.classified));
        ok(ink.counters.residual_px === 0,
            '4.5 residual_px freeform = 0 dichiarato', String(ink.counters.residual_px));
        ok(ink.counters.swapped_pixels - c0.swapped_pixels >= 0.5 * sPts.length,
            '4.6 swapped_pixels incrementato sul freeform',
            String(ink.counters.swapped_pixels - c0.swapped_pixels));

        // ============ 5) CHIUSO: cerchio ============
        await freshDoc(env);
        const circ = [];
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            circ.push([400 + Math.cos(a) * 45, 300 + Math.sin(a) * 45]);
        }
        c0 = snap(ink.counters);
        drawPts(env, circ);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'circle',
            '5.0 cerchio -> kind circle', JSON.stringify(sh.map(s => s.kind)));
        ok(ink.counters.classified.closed === c0.classified.closed + 1,
            '5.1 classified.closed +1', JSON.stringify(ink.counters.classified));
        ok(ink.counters.perfected_on_release === c0.perfected_on_release + 1,
            '5.2 perfected_on_release +1 (swap chiuso al rilascio)',
            String(ink.counters.perfected_on_release - c0.perfected_on_release));

        // ============ 6) FRECCIA: flick rapido SENZA pausa (V0) ============
        await freshDoc(env);
        const lineA = [];
        for (let i = 0; i <= 27; i++) {
            lineA.push([150 + i * 10,
                        250 + Math.sin(i / 6) * 1.2 + ((i % 3) - 1) * 0.4]);
        }
        const endA = lineA[lineA.length - 1];
        // flick: 2 move (V0: 2 move a <5ms, ~26px) con inversione netta
        const flickA = [[endA[0] + 6, endA[1] + 4.5],
                        [endA[0] - 15, endA[1] + 8]];
        c0 = snap(ink.counters);
        const nTrace0 = ink.trace.length;
        drawPts(env, lineA.concat(flickA));
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'arrow' && strokes(env).length === 0,
            '6.0 retta+ flick rapido senza pausa -> UN oggetto arrow',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        const dfs = ink.trace.filter(e => e.k === 'dbgF');
        const lastF = dfs.length ? dfs[dfs.length - 1] : null;
        ok(!!lastF && lastF.d && lastF.d.r === -1 && lastF.d.r2 >= 0,
            '6.1 rilevato dal FALLBACK back-stroke (core -1, r2>=0; V0 mancava)',
            lastF ? JSON.stringify(lastF.d) : 'nessun dbgF');
        if (sh[0] && sh[0].kind === 'arrow') {
            ok(sh[0].vclass === 'arrow', '6.2 vclass=arrow', sh[0].vclass);
            const p = sh[0].params || {};
            ok(!!p.shaft && !!p.head, '6.3 params.shaft + params.head (oggetto UNICO)',
                JSON.stringify(Object.keys(p)));
            const h = p.head;
            ok(h && h.angoloAlaDeg >= 30 && h.angoloAlaDeg <= 45,
                '6.4 ali 30-45gradi', h ? String(h.angoloAlaDeg) : 'null');
            const sz = sh[0].size || 2;
            ok(h && h.lunghezza >= 3 * sz && h.lunghezza <= 4 * sz,
                '6.5 lunghezza ali 3-4x spessore',
                h ? h.lunghezza.toFixed(2) + ' vs ' + sz : 'null');
        }
        ok(ink.counters.classified.arrow === c0.classified.arrow + 1 &&
           ink.counters.total === c0.total + 1,
            '6.6 classified.arrow +1 e totale +1', JSON.stringify(ink.counters.classified));
        ok(ink.counters.perfected_on_release === c0.perfected_on_release + 1,
            '6.7 perfected_on_release +1 (arrow al rilascio)',
            String(ink.counters.perfected_on_release - c0.perfected_on_release));
        ok(ink.counters.strokes_live === 0, '6.8 strokes_live tornato a 0',
            String(ink.counters.strokes_live));

        // ============ 7) UNDO a 2 livelli ============
        await freshDoc(env);
        const lineU = [];
        for (let i = 0; i <= 30; i++) lineU.push([150 + i * 8, 250 + (i % 2) * 0.6]);
        drawPts(env, lineU);
        await sleep(150);
        ok(shapes(env).length === 1, '7.0 una shape dopo il rilascio',
            String(shapes(env).length));
        env0.undoKey(env, 1);
        let u = ink.objects();
        ok(u.length === 1 && u[0].t === 'stroke' &&
           (u[0].pts || []).length >= 25,
            '7.1 UNDO 1 -> tratto GREZZO (stroke originale) ripristinato',
            JSON.stringify(u.map(o => o.t + (o.pts ? ':' + o.pts.length : ''))));
        env0.undoKey(env, 1);
        u = ink.objects();
        ok(u.length === 0, '7.2 UNDO 2 -> oggetto rimosso', 'len=' + u.length);

        // ============ 8) OFF -> hold-still R20 ============
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);   // -> clamp 800
        ink.setReleaseRefine(false);
        ok(ink.state().releaseRefine === false, '8.0 releaseRefine OFF');
        const lineO = [];
        for (let i = 0; i <= 40; i++) {
            lineO.push([200 + i * 3 + ((i % 3) - 1) * 0.8, 250 + i * 0.4]);
        }
        c0 = snap(ink.counters);
        canvas = env0.canvasOf(env);
        b = env0.wc(env, lineO);
        env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
        for (let i = 1; i < b.length; i++) {
            env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
        }
        await sleep(950);   // quiete >= hold-still 800ms
        ok(ink.state().ghost === true,
            '8.1 OFF: tratto APERTO in hold -> GHOST (hold-still storico R20)',
            'ghost=' + ink.state().ghost);
        env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
        await sleep(150);
        sh = shapes(env);
        ok(ink.state().ghost === false && sh.length === 1 && sh[0].kind === 'line',
            '8.2 OFF: rilascio commetta segmento ideale (line), ghost consumata',
            JSON.stringify(sh.map(s => s.kind)));
        ok(ink.counters.stroke.total === 1 && ink.counters.stroke.classified.line === 1,
            '8.3 OFF: contatori tratto total=1 line=1',
            JSON.stringify(ink.counters.stroke));
        ink.setReleaseRefine(true);
        ok(ink.state().releaseRefine === true, '8.4 releaseRefine ristabilito ON');

        // ============ 9) ZOOM 100% e 245% (soglie in MONDO) ============
        await freshDoc(env);
        const z1 = ink.setZoom(1);
        ok(z1 !== null && Math.abs(z1 - 1) < 1e-6 &&
           ink.state().zoom === 1 && ink.zoom() === 1,
            '9.0 setZoom(1) -> zoom 100% leggibile da state()/zoom()',
            String(z1));
        c0 = snap(ink.counters);
        drawPts(env, wline);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line' &&
           ink.counters.classified.line === c0.classified.line + 1 &&
           ink.counters.residual_px <= 0.5,
            '9.1 zoom 100%: onda -> line, residuo <=0.5px',
            JSON.stringify(sh.map(s => s.kind)) + ' res=' + ink.counters.residual_px);
        c0 = snap(ink.counters);
        drawPts(env, bow);
        await sleep(150);
        // il doc contiene2 shape (wline di9.1 + bow): si asserta
        // sull'ULTIMA (bow) e sul delta del contatore classificato line
        const shA = shapes(env);
        ok(shA.length === 2 && shA[shA.length - 1].kind === 'line' &&
           ink.counters.classified.line === c0.classified.line + 1,
            '9.2 zoom 100%: arco singolo -> line (gate 3% MONDO) [2a shape]',
            JSON.stringify(shA.map(s => s.kind)));

        await freshDoc(env);
        const z2 = ink.setZoom(2.45);
        ok(Math.abs(z2 - 2.45) < 1e-6 && ink.state().zoom === 2.45 &&
           ink.zoom() === 2.45,
            '9.3 setZoom(2.45) -> zoom 245% (clamp 0.15..5)',
            String(z2));
        c0 = snap(ink.counters);
        drawPts(env, wline);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line' && sh[0].vclass === 'line' &&
           ink.counters.classified.line === c0.classified.line + 1 &&
           ink.counters.residual_px <= 0.5,
            '9.4 zoom 245%: stessa onda -> line, residuo <=0.5px (soglie MONDO)',
            JSON.stringify(sh.map(s => s.kind + ':' + (s.vclass || '?'))) +
            ' res=' + ink.counters.residual_px);
        c0 = snap(ink.counters);
        drawPts(env, bow);
        await sleep(150);
        const shB = shapes(env);
        ok(shB.length === 2 && shB[shB.length - 1].kind === 'line' &&
           ink.counters.classified.line === c0.classified.line + 1,
            '9.5 zoom 245%: arco singolo -> line [2a shape]',
            JSON.stringify(shB.map(s => s.kind)));
        await freshDoc(env);
        c0 = snap(ink.counters);
        drawPts(env, sPts);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].vclass === 'freeform' &&
           countFlessi(sh[0].pts) >= 2 &&
           ink.counters.classified.freeform === c0.classified.freeform + 1,
            '9.6 zoom 245%: S -> freeform con >=2 flessi (soglie MONDO)',
            JSON.stringify(sh.map(s => s.vclass)) +
            ' flessi=' + (sh[0] ? countFlessi(sh[0].pts) : -1));
        ink.setZoom(1);

        // ============ 10) riepilogo contatori/sessione ============
        const cf = ink.counters;
        ok(cf.classified.line >= 5 && cf.classified.arc >= 1 &&
           cf.classified.freeform >= 2 && cf.classified.closed >= 1 &&
           cf.classified.arrow >= 1,
            '10.0 tutte le 5 classi contate nella sessione',
            JSON.stringify(cf.classified));
        ok(cf.total >= 10 && cf.perfected_on_release >= 10 &&
           cf.swapped_pixels > 0 && typeof cf.residual_px === 'number',
            '10.1 total/perf/swapPx/residuo popolati',
            JSON.stringify({ t: cf.total, p: cf.perfected_on_release,
                             px: cf.swapped_pixels, r: cf.residual_px }));
        ok(cf.strokes_live === 0, '10.2 strokes_live==0 a fine sessione',
            String(cf.strokes_live));
        ok(logs.length > 0 &&
           logs.every(l => /^\[ink24\] /.test(l) || /^\[inkV\] /.test(l)),
            '10.3 tutti i log hanno prefisso [ink24] o [inkV]',
            JSON.stringify(logs.slice(-2)));
        console.log('      FINALI ' + JSON.stringify({
            classified: cf.classified, total: cf.total,
            refined: cf.refined, discarded: cf.discarded,
            strokes_live: cf.strokes_live, perf: cf.perfected_on_release,
            swapPx: cf.swapped_pixels, residuo: cf.residual_px }));

        console.log('\nRISULTATO v1_release_swap: ' + pass + ' passati, ' +
            fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO v1_release_swap: ' + pass + ' passati, ' +
            (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
