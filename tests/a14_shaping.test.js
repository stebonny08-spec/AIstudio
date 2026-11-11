'use strict';
/* tests/a14_shaping.test.js - T1 R31: suite ink-commit (PROMPT ROUND 29),
   RISCRITTA DA ZERO (sostituisce la vecchia suite hold-still/setShaping).
   Copertura (obiettivo >=42 assert, 0 falliti):
   - API/CFG: InkCommit + CFG presenti, settleMs 150-300, wetTailPx 20-40,
     headLenMul 3-4, headWingDeg 30-40, flick2 300/60/120, lineDevRatio
     0.025+-, gapClosedRatio 0.08, scratchDense 1.6
   - stato SENZA flag vecchi (shpOn/arrowOn/holdMs/releaseRefine/ghost),
     setShaping/setReleaseRefine undefined (M01)
   - DOM popover: slider "Intensita aiuto" e "Smussamento righe" PRESENTI,
     #fn-releaseRefine e testo "Fermo per snap" ASSENTI
   - T01 linea (ondulata orizzontale, ondulata diagonale, jitter leggero)
   - T02 arco (semicerchio, arco shallow dev>2.5%, arco 90 gradi rumoroso)
   - T03 S freeform (flessi preservati, nessun snap), T04 loop (selfInt
     invariato), T05 cerchio deformato (closed+smooth MAI circle) e
     C aperta (MAI closed, gap preservato +-4px -> N01)
   - T06 tap grezzo (raw+discarded), T07 scarabocchio denso (mode light)
   - frecce: stesso tratto con micro-V (F03) + secondo tratto assorbito
     in UN oggetto con un solo undo (F01/F02/F04/M04) e redo identico
   - N03 rilascio istantaneo comunque swappa (dt>=150), N04 post-commit
     selected/lasel false + nessun nodo releaseRefine, N05 i tratti gia
     commessi non cambiano, N06 hold 500ms senza oggetti/trace, N08 _wet
     rimosso (check pixel nel QA browser), N09 sizes===null size===base
   Pattern degli assert identico a qa/_r31_probe.js (37/37).
   Usa SOLO l harness tests/_ink_env.js. Ogni commit: sleep ~380ms
   (settle 200 + margine). Doc fresco (freshDoc) per ogni blocco.
   Esecuzione: node tests/a14_shaping.test.js */
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : ''));
           console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = env0.sleep;

/* LCG deterministico per jitter riproducibile */
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function freshDoc(env) {
    env.store.items[0].content = '';
    return env0.openNote(env, 'n1');
}
function strokes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'stroke');
}
function nTrace(env, k) {
    return env.win.__ink.trace.filter(e => e.k === k).length;
}
/* traccia un tratto: pts in coordinate MONDO; opts {dt, hold} */
async function draw(env, pts, opts) {
    opts = opts || {};
    const canvas = env0.canvasOf(env);
    const b = env0.wc(env, pts);
    env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
    for (let i = 1; i < b.length; i++) {
        if (opts.dt) await sleep(opts.dt);
        env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
    }
    if (opts.hold) await sleep(opts.hold);
    env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
}
function gapOf(pts) {
    const a = pts[0], b = pts[pts.length - 1];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
function maxDevSeg(pts, a, b) {
    let m = 0;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    for (const q of pts) {
        let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
        if (d > m) m = d;
    }
    return m;
}
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

/* ---------------- generatori (coordinate MONDO) ---------------- */
function wavyH() {                       // T01 orizzontale ondulata
    const p = [];
    for (let x = 156; x <= 552; x += 4) p.push([x, 250 + 4 * Math.sin(2 * Math.PI * x / 24)]);
    return p;
}
function wavyDiag() {                    // T01 diagonale ondulata
    const a = [150, 140], b = [540, 530];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const p = [];
    for (let s = 0; s <= L; s += 4) {
        const w = 4 * Math.sin(2 * Math.PI * s / 24);
        p.push([a[0] + ux * s + nx * w, a[1] + uy * s + ny * w]);
    }
    return p;
}
function jitterLine() {                  // T01 jitter leggero +-1.5px
    const r = lcg(4242), p = [];
    for (let x = 120; x <= 620; x += 5) p.push([x, 300 + (r() * 2 - 1) * 1.5]);
    return p;
}
function semicircle() {                  // T02 semicerchio r=60
    const p = [];
    for (let i = 0; i <= 60; i++) {
        const a = Math.PI * 0.05 + (i / 60) * Math.PI * 0.9;
        p.push([400 + Math.cos(a) * 60 + Math.sin(i / 3) * 1.2,
                300 + Math.sin(a) * 60 + Math.cos(i / 4) * 1.2]);
    }
    return p;
}
function shallowArc() {                  // T02 arco shallow r=200, sweep 80
    const p = [];
    for (let i = 0; i <= 90; i++) {
        const a = (-140 + (i / 90) * 80) * Math.PI / 180;
        p.push([400 + Math.cos(a) * 200 + 0.3 * Math.sin(i / 3),
                480 + Math.sin(a) * 200 + 0.3 * Math.cos(i / 4)]);
    }
    return p;
}
function arc90() {                       // T02 arco 90 gradi con rumore
    const p = [];
    for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI / 2;
        p.push([380 + Math.cos(a) * 70 + 1.0 * Math.sin(i / 6),
                300 + Math.sin(a) * 70 + 1.0 * Math.cos(i / 7)]);
    }
    return p;
}
function sCurve() {                      // T03 S con 2 flessi
    const p = [];
    for (let x = 150; x <= 550; x += 4) p.push([x, 300 + 45 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
    return p;
}
function loopX() {                       // T04 loop: ritorno che incrocia
    const p = [];
    for (let x = 150; x <= 550; x += 4) p.push([x, 300 + 4 * Math.sin(2 * Math.PI * x / 60)]);
    // ritorno con incroci; fase con pendente ~0 in coda (evita falsi
    // back-stroke del rilevatore freccia)
    for (let x = 550; x >= 250; x -= 4) p.push([x, 315 + 25 * Math.cos(2 * Math.PI * (x - 250) / 60)]);
    return p;
}
function deformedCircle() {              // T05 cerchio deformato
    const p = [];
    for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        p.push([400 + Math.cos(a) * (45 + Math.sin(i * 2.1) * 3),
                300 + Math.sin(a) * (45 + Math.cos(i * 1.7) * 3)]);
    }
    return p;
}
function cOpen() {                       // T05 C aperta, sweep 240, gap grande
    const p = [];
    for (let i = 0; i <= 72; i++) {
        const a = (-30 + (i / 72) * 240) * Math.PI / 180;
        p.push([400 + Math.cos(a) * 70 + 1.1 * Math.sin(i / 3),
                300 + Math.sin(a) * 70 + 1.1 * Math.cos(i / 4)]);
    }
    return p;
}
function scratch() {                     // T07 scarabocchio denso (Lissajous)
    const p = [];
    for (let t = 0; t <= 5.65; t += 0.025) p.push([400 + 140 * Math.sin(4 * t), 300 + 140 * Math.sin(5 * t)]);
    return p;
}
function tapShort() {                    // T06 tap / 3 punti corti
    return [[200, 200], [210, 202], [216, 204]];
}
function instantLine() {                 // N03 rilascio istantaneo
    const p = [];
    for (let x = 100; x <= 400; x += 5) p.push([x, 500 + (x % 10) * 0.2]);
    return p;
}
function holdLine() {                    // N06 tratto con hold
    const p = [];
    for (let x = 120; x <= 520; x += 5) p.push([x, 350 + (x % 10) * 0.15]);
    return p;
}
function lineForAbsorb() {               // asta freccia (F01 secondo tratto)
    const p = [];
    for (let i = 0; i <= 30; i++) p.push([150 + i * 8, 400 + (i % 3) * 0.4]);
    return p;
}
function lineArrow() {                   // freccia stesso tratto (back-stroke)
    const p = [];
    for (let i = 0; i <= 27; i++) p.push([150 + i * 10, 250 + Math.sin(i / 6) * 1.2]);
    return p;
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;

        /* ============ A: API / CFG (ink_cfg = unico config) ============ */
        ok(!!env.win.InkCommit && !!env.win.InkCommit.CFG, 'A0.1 InkCommit + CFG caricati');
        const CFG = env.win.InkCommit.CFG;
        ok(CFG.settleMs >= 150 && CFG.settleMs <= 300, 'A0.2 settleMs in 150-300',
            String(CFG.settleMs));
        ok(CFG.wetTailPx >= 20 && CFG.wetTailPx <= 40, 'A0.3 wetTailPx in 20-40',
            String(CFG.wetTailPx));
        ok(CFG.headLenMul >= 3 && CFG.headLenMul <= 4, 'A0.4 headLenMul in 3-4',
            String(CFG.headLenMul));
        ok(CFG.headWingDeg >= 30 && CFG.headWingDeg <= 40, 'A0.5 headWingDeg in 30-40',
            String(CFG.headWingDeg));
        ok(CFG.flick2Ms === 300, 'A0.6 flick2Ms === 300', String(CFG.flick2Ms));
        ok(CFG.flick2DistPx === 60, 'A0.7 flick2DistPx === 60', String(CFG.flick2DistPx));
        ok(CFG.flick2DurMs === 120, 'A0.8 flick2DurMs === 120', String(CFG.flick2DurMs));
        ok(Math.abs(CFG.lineDevRatio - 0.025) <= 0.005, 'A0.9 lineDevRatio 0.025+-',
            String(CFG.lineDevRatio));
        ok(Math.abs(CFG.gapClosedRatio - 0.08) <= 0.005, 'A0.10 gapClosedRatio 0.08+-',
            String(CFG.gapClosedRatio));
        ok(Math.abs(CFG.scratchDenseRatio - 1.6) <= 0.05, 'A0.11 scratchDenseRatio 1.6+-',
            String(CFG.scratchDenseRatio));

        /* ============ B: stato senza flag vecchi + API ============ */
        const st = ink.state();
        ok(!!st && !('shpOn' in st) && !('arrowOn' in st) && !('holdMs' in st) &&
           !('releaseRefine' in st) && !('ghost' in st),
            'B1 flag vecchi assenti da state() (M01)', JSON.stringify(Object.keys(st)));
        ok(typeof ink.setShaping === 'undefined' &&
           typeof env.win.setShaping === 'undefined', 'B2 setShaping undefined',
            String(typeof ink.setShaping));
        ok(typeof ink.setReleaseRefine === 'undefined' &&
           typeof env.win.setReleaseRefine === 'undefined', 'B3 setReleaseRefine undefined',
            String(typeof ink.setReleaseRefine));
        ok('settleMs' in st && 'assist' in st && 'smooth' in st &&
           'pending' in st && 'zoom' in st, 'B4 state() completa (settleMs/assist/...)',
            JSON.stringify(Object.keys(st)));
        ok(typeof ink.setHelp === 'function' && typeof ink.setZoom === 'function' &&
           typeof ink.toWorld === 'function', 'B5 API setHelp/setZoom/toWorld');
        ok(Array.isArray(ink.trace) && !!ink.counters &&
           !!ink.counters.classified && !!ink.objects, 'B6 API trace/counters/objects');
        const n0 = ink.objects().length;
        const tmpObjs = ink.objects();
        tmpObjs.pop();
        ok(ink.objects().length === n0, 'B7 objects() ritorna copia JSON',
            ink.objects().length + ' vs ' + n0);

        /* ============ C: DOM popover ============ */
        const pop = env.doc.querySelector('.fn-pop-help');
        ok(!!pop && pop.textContent.indexOf('Intensita aiuto') >= 0,
            'C1 slider "Intensita aiuto" PRESENTE', pop ? 'pop ok' : 'pop assente');
        ok(!!pop && pop.textContent.indexOf('Smussamento righe') >= 0,
            'C2 slider "Smussamento righe" PRESENTE', pop ? 'pop ok' : 'pop assente');
        ok(!!pop && pop.querySelectorAll('input[type="range"]').length >= 2,
            'C3 due input range nel popover aiuto',
            pop ? String(pop.querySelectorAll('input[type="range"]').length) : 'pop assente');
        ok(!env.doc.getElementById('fn-releaseRefine'), 'C4 #fn-releaseRefine ASSENTE');
        ok(env.doc.body.textContent.indexOf('Fermo per snap') < 0,
            'C5 testo "Fermo per snap" ASSENTE dal DOM');

        /* ============ D: T01 linea (3 varianti) ============ */
        // D1: orizzontale ondulata -> line, con finestra wet + swap
        await freshDoc(env);
        const wline = wavyH();
        let c0 = JSON.parse(JSON.stringify(ink.counters));
        const rel0 = nTrace(env, 'release');
        await draw(env, wline);
        await sleep(90);
        let s1 = strokes(env);
        ok(s1.length === 1 && s1[0]._wet === true &&
           s1[0].pts.length === wline.length,
            'D1.0 durante settle: raw visibile con _wet (K01/L02)',
            JSON.stringify({ n: s1.length, wet: s1[0] && s1[0]._wet,
                             pts: s1[0] ? s1[0].pts.length : -1, raw: wline.length }));
        const relEv = ink.trace.filter(e => e.k === 'release');
        ok(relEv.length === rel0 + 1 && relEv[relEv.length - 1].cls === 'line',
            'D1.1 trace release cls=line', JSON.stringify(relEv.slice(-1)));
        await sleep(300);
        const swEv = ink.trace.filter(e => e.k === 'swap');
        ok(swEv.length >= 1 && swEv[swEv.length - 1].dt >= 150 &&
           swEv[swEv.length - 1].dt <= 320,
            'D1.2 UNO swap con dt in 150-320 (K01/K02)',
            JSON.stringify(swEv.slice(-1)));
        s1 = strokes(env);
        ok(s1.length === 1 && s1[0].vclass === 'line' && s1[0].pts.length === 2,
            'D1.3 commesso: vclass line + esattamente 2 pts',
            JSON.stringify(s1.map(o => o.vclass + ':' + (o.pts || []).length)));
        if (s1[0]) {
            const a = s1[0].pts[0], e = s1[0].pts[1];
            const d0 = dist(a, wline[0]), d1 = dist(e, wline[wline.length - 1]);
            ok(d0 <= 3 && d1 <= 3, 'D1.4 endpoint entro 3px dai grezzi (Q01/T01)',
                d0.toFixed(2) + '/' + d1.toFixed(2));
            // N08 parziale jsdom: _wet rimosso dopo il commit (il check
            // pixel del tratto live e nel QA browser)
            ok(s1[0]._wet === undefined, 'D1.5 nessun _wet post-commit (N08)',
                String(s1[0]._wet));
            // N09: spessore uniforme (sizes null) e size === base
            ok(s1[0].sizes === null, 'D1.6 sizes===null dopo commit (N09)',
                JSON.stringify(s1[0].sizes));
            ok(s1[0].size === s1[0].base, 'D1.7 size===base dopo commit (N09)',
                String(s1[0].size) + ' vs ' + String(s1[0].base));
        }
        ok(ink.counters.classified.line === c0.classified.line + 1 &&
           ink.counters.perfected_on_release === c0.perfected_on_release + 1,
            'D1.8 contatori line/perfected +1', JSON.stringify(ink.counters.classified));

        // D2: diagonale ondulata -> line
        await freshDoc(env);
        const wdiag = wavyDiag();
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, wdiag);
        await sleep(380);
        let s2 = strokes(env);
        ok(s2.length === 1 && s2[0].vclass === 'line' && s2[0].pts.length === 2,
            'D2.0 diagonale ondulata -> line + 2 pts',
            JSON.stringify(s2.map(o => o.vclass + ':' + (o.pts || []).length)));
        if (s2[0]) {
            const a = s2[0].pts[0], e = s2[0].pts[1];
            const d0 = dist(a, wdiag[0]), d1 = dist(e, wdiag[wdiag.length - 1]);
            ok(d0 <= 3 && d1 <= 3, 'D2.1 endpoint diagonale entro 3px',
                d0.toFixed(2) + '/' + d1.toFixed(2));
        }
        ok(ink.counters.classified.line === c0.classified.line + 1, 'D2.2 contatore line +1');

        // D3: jitter leggero -> line + residuo vs segmento
        await freshDoc(env);
        const jit = jitterLine();
        await draw(env, jit);
        await sleep(380);
        let s3 = strokes(env);
        ok(s3.length === 1 && s3[0].vclass === 'line' && s3[0].pts.length === 2,
            'D3.0 jitter leggero -> line + 2 pts',
            JSON.stringify(s3.map(o => o.vclass + ':' + (o.pts || []).length)));
        if (s3[0]) {
            const a = s3[0].pts[0], e = s3[0].pts[1];
            const d0 = dist(a, jit[0]), d1 = dist(e, jit[jit.length - 1]);
            ok(d0 <= 3 && d1 <= 3, 'D3.1 endpoint jitter entro 3px',
                d0.toFixed(2) + '/' + d1.toFixed(2));
            const resid = env.win.InkCommit.residualOf(s3[0]);
            console.log('      MEASURE D3.2 residuo render vs segmento = ' + resid.toFixed(3) + 'px');
            ok(resid <= 0.5, 'D3.2 residuo render vs segmento <=0.5px', resid.toFixed(3));
        }

        /* ============ E: T02 arco (3 varianti) ============ */
        // E1: semicerchio -> arc/circle APERTO
        await freshDoc(env);
        const semi = semicircle();
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, semi);
        await sleep(380);
        let s4 = strokes(env);
        ok(s4.length === 1 && s4[0].vclass === 'arc' && s4[0].params &&
           s4[0].params.kind === 'circle',
            'E1.0 semicerchio -> arc (kind circle)',
            JSON.stringify(s4.map(o => o.vclass + '/' + (o.params ? o.params.kind : '-'))));
        if (s4[0] && s4[0].params && s4[0].params.kind === 'circle') {
            const p = s4[0].params;
            const g = gapOf(s4[0].pts);
            ok(g >= 50, 'E1.1 arco resta APERTO (gap>=50, N01)', 'gap=' + g.toFixed(1));
            let mx = 0;
            for (const q of s4[0].pts) {
                const d = Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r);
                if (d > mx) mx = d;
            }
            console.log('      MEASURE E1.2 residuo render vs cerchio = ' + mx.toFixed(3) + 'px');
            ok(mx <= 0.5, 'E1.2 residuo render vs circonferenza <=0.5px (Q01)', mx.toFixed(3));
            ok(Math.abs(p.sweep) * 180 / Math.PI >= 80,
                'E1.3 ampiezza |sweep| >=80 gradi',
                (Math.abs(p.sweep) * 180 / Math.PI).toFixed(1));
        }
        ok(ink.counters.classified.arc === c0.classified.arc + 1, 'E1.4 contatore arc +1');

        // E2: arco shallow con dev dalla corda >2.5% -> arc (non line)
        await freshDoc(env);
        const sh = shallowArc();
        await draw(env, sh);
        await sleep(380);
        let s5 = strokes(env);
        const devSh = maxDevSeg(sh, sh[0], sh[sh.length - 1]);
        const chordSh = dist(sh[0], sh[sh.length - 1]);
        console.log('      MEASURE E2 dev grezzo/corda = ' + (100 * devSh / chordSh).toFixed(1) + '%');
        ok(devSh > 0.025 * chordSh, 'E2.0 generatore con dev >2.5% corda (precondizione)',
            (100 * devSh / chordSh).toFixed(1) + '%');
        ok(s5.length === 1 && s5[0].vclass === 'arc' && s5[0].params &&
           (s5[0].params.kind === 'circle' || s5[0].params.kind === 'bez'),
            'E2.1 arco shallow -> arc (nonostante dev>2.5%)',
            JSON.stringify(s5.map(o => o.vclass + '/' + (o.params ? o.params.kind : '-'))));

        // E3: arco 90 gradi con rumore -> arc + |sweep| >=80
        await freshDoc(env);
        const a90 = arc90();
        await draw(env, a90);
        await sleep(380);
        let s6 = strokes(env);
        ok(s6.length === 1 && s6[0].vclass === 'arc',
            'E3.0 arco 90 rumoroso -> arc',
            JSON.stringify(s6.map(o => o.vclass)));
        if (s6[0] && s6[0].params) {
            const deg = Math.abs(s6[0].params.sweep || 0) * 180 / Math.PI;
            console.log('      MEASURE E3.1 sweep = ' + deg.toFixed(1) + ' gradi');
            ok(deg >= 80, 'E3.1 |sweep| >=80 gradi preservato', deg.toFixed(1));
        }

        /* ============ F: T03 S -> freeform ============ */
        await freshDoc(env);
        const sp = sCurve();
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, sp);
        await sleep(380);
        let s7 = strokes(env);
        ok(s7.length === 1 && s7[0].vclass === 'freeform',
            'F0 S -> freeform', JSON.stringify(s7.map(o => o.vclass)));
        if (s7[0]) {
            const IC = env.win.InkCommit;
            const fIn = IC.countFlessi(sp), fOut = IC.countFlessi(s7[0].pts);
            console.log('      MEASURE F1 flessi grezzi=' + fIn + ' render=' + fOut);
            ok(fIn >= 2 && fOut >= 2 && fOut >= fIn,
                'F1 flessi PRESERVATI (>=2, T03/V05)', fIn + ' -> ' + fOut);
            const p = s7[0].params;
            ok(!!p && p.kind === 'smooth' && !p.p && !p.circle && !p.arc,
                'F2 nessun snap parametrico (kind smooth, senza p/circle)',
                JSON.stringify(p));
        }
        ok(ink.counters.classified.freeform === c0.classified.freeform + 1,
            'F3 contatore freeform +1');

        /* ============ G: T04 loop -> freeform, selfInt invariato ============ */
        await freshDoc(env);
        const lp = loopX();
        await draw(env, lp);
        await sleep(90);
        let s8w = strokes(env);
        const IC = env.win.InkCommit;
        const siWet = s8w[0] ? IC.selfInt(s8w[0].pts) : -1;
        await sleep(300);
        let s8 = strokes(env);
        ok(s8.length === 1 && s8[0].vclass === 'freeform',
            'G0 loop con auto-intersezione -> freeform (T04)',
            JSON.stringify(s8.map(o => o.vclass)));
        if (s8[0]) {
            const siOut = IC.selfInt(s8[0].pts);
            console.log('      MEASURE G1 selfInt grezzo=' + siWet + ' render=' + siOut);
            ok(siWet >= 1 && siOut >= 1, 'G1 selfInt >=1 (oracle del probe)',
                siWet + '/' + siOut);
            ok(siOut === siWet, 'G2 selfInt INVARIATO dopo smoothing (T04)',
                siWet + ' -> ' + siOut);
        }

        /* ============ H: T05 cerchio deformato -> closed+smooth ============ */
        await freshDoc(env);
        const dc = deformedCircle();
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, dc);
        await sleep(380);
        let s9 = strokes(env);
        ok(s9.length === 1 && s9[0].vclass === 'closed',
            'H0 cerchio deformato -> closed (T05)', JSON.stringify(s9.map(o => o.vclass)));
        ok(s9[0] && s9[0].params && s9[0].params.kind === 'smooth',
            'H1 MAI conversione circle/ellipse/rect (N07): kind smooth',
            s9[0] && s9[0].params ? s9[0].params.kind : 'null');
        ok(ink.counters.classified.closed === c0.classified.closed + 1,
            'H2 contatore closed +1');

        // H3: C aperta (gap grande) -> arc o line, MAI closed, gap +-4px (N01)
        await freshDoc(env);
        const co = cOpen();
        const gapPre = gapOf(co);
        await draw(env, co);
        await sleep(380);
        let s10 = strokes(env);
        ok(s10.length === 1 && s10[0].vclass !== 'closed' &&
           ['arc', 'line', 'freeform'].indexOf(s10[0].vclass) >= 0,
            'H3 C aperta MAI closed (N01)',
            JSON.stringify(s10.map(o => o.vclass)));
        if (s10[0]) {
            const gapPost = gapOf(s10[0].pts);
            console.log('      MEASURE H4 gap pre=' + gapPre.toFixed(1) +
                        ' post=' + gapPost.toFixed(1));
            ok(Math.abs(gapPost - gapPre) <= 4,
                'H4 gap post == gap pre +-4px (N01 aperto preservato)',
                gapPre.toFixed(1) + ' -> ' + gapPost.toFixed(1));
        }

        /* ============ I: T06 tap -> grezzo ============ */
        await freshDoc(env);
        c0 = JSON.parse(JSON.stringify(ink.counters));
        const rel1 = nTrace(env, 'release'), sw1 = nTrace(env, 'swap');
        await draw(env, tapShort());
        await sleep(380);
        let s11 = strokes(env);
        ok(s11.length === 1 && (s11[0].vclass === undefined || !s11[0].vclass),
            'I0 tap corto resta GREZZO: nessun vclass (T06)',
            JSON.stringify(s11.map(o => o.vclass)));
        ok(ink.counters.discarded === c0.discarded + 1, 'I1 discarded +1 (T06)',
            String(ink.counters.discarded - c0.discarded));
        const relEv2 = ink.trace.filter(e => e.k === 'release');
        ok(relEv2.length === rel1 + 1 && relEv2[relEv2.length - 1].cls === 'raw' &&
           nTrace(env, 'swap') === sw1,
            'I2 release cls=raw e NESSUN swap (T06)',
            JSON.stringify({ rel: relEv2.slice(-1), swap: nTrace(env, 'swap') - sw1 }));

        /* ============ J: T07 scarabocchio denso -> freeform light ============ */
        await freshDoc(env);
        const sc = scratch();
        await draw(env, sc);
        await sleep(380);
        let s12 = strokes(env);
        ok(s12.length === 1 && s12[0].vclass === 'freeform',
            'J0 scarabocchio -> freeform (T07)', JSON.stringify(s12.map(o => o.vclass)));
        if (s12[0]) {
            const p = s12[0].params;
            console.log('      MEASURE J1 params=' + JSON.stringify(p && { kind: p.kind, mode: p.mode }));
            ok(!!p && p.kind === 'smooth' && p.mode === 'light',
                'J1 params.mode===light (T07 smoothing leggero)', JSON.stringify(p));
            ok(!p.p && !p.circle, 'J2 nessun params p/circle: MAI snap (T07)',
                JSON.stringify(p));
        }

        /* ============ K: N03 rilascio istantaneo ============ */
        await freshDoc(env);
        const sw2 = nTrace(env, 'swap');
        await draw(env, instantLine());      // nessuna pausa tra i punti
        await sleep(380);
        let s13 = strokes(env);
        ok(s13.length === 1 && s13[0].vclass === 'line',
            'K0 N03: commit al rilascio SENZA pause comunque avviene',
            JSON.stringify(s13.map(o => o.vclass)));
        const swEv2 = ink.trace.filter(e => e.k === 'swap');
        ok(swEv2.length === sw2 + 1 && swEv2[swEv2.length - 1].dt >= 150 &&
           swEv2[swEv2.length - 1].dt <= 320,
            'K1 N03: swap con dt in 150-320 (finestra K01 rispettata)',
            JSON.stringify(swEv2.slice(-1)));

        /* ============ L: N06 hold 500ms ============ */
        await freshDoc(env);
        const beforeHold = JSON.stringify(ink.objects());
        const rel3 = nTrace(env, 'release'), sw3 = nTrace(env, 'swap');
        const hp = holdLine();
        {
            const canvas = env0.canvasOf(env);
            const b = env0.wc(env, hp);
            env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
            for (let i = 1; i < b.length; i++) {
                env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
            }
            ok(ink.objects().length === 0,
                'L0 tratto FUORI dal doc durante il drag (entra al rilascio)',
                'n=' + ink.objects().length);
            await sleep(500);                // penna ferma 500ms
            ok(JSON.stringify(ink.objects()) === beforeHold,
                'L1 N06: oggetti INVARIATI durante 500ms di hold',
                'len=' + ink.objects().length);
            ok(nTrace(env, 'release') === rel3 && nTrace(env, 'swap') === sw3,
                'L2 N06: NESSUN trace release/swap durante l hold',
                'rel=' + (nTrace(env, 'release') - rel3) +
                ' swap=' + (nTrace(env, 'swap') - sw3));
            env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
        }
        await sleep(380);
        const s14 = strokes(env);
        ok(s14.length === 1 && s14[0].vclass === 'line',
            'L3 commit normale al rilascio dopo l hold (N03/N06: nessun ghost)',
            JSON.stringify(s14.map(o => o.vclass)));

        /* ============ M: N04 post-commit ============ */
        const st2 = ink.state();
        ok(st2 && st2.selected === false, 'M0 state().selected===false dopo commit',
            st2 ? String(st2.selected) : 'null');
        ok(st2 && st2.lasel === false, 'M1 state().lasel===false dopo commit',
            st2 ? String(st2.lasel) : 'null');
        let badNode = false;
        const all = env.doc.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const id = (el.id || '').toLowerCase();
            let cls = '';
            if (typeof el.className === 'string') cls = el.className;
            else if (el.getAttribute) cls = el.getAttribute('class') || '';
            cls = String(cls).toLowerCase();
            if (id.indexOf('releaserefine') >= 0 || cls.indexOf('releaserefine') >= 0) {
                badNode = true;
            }
        }
        ok(!badNode, 'M2 nessun nodo con id/classe che contiene "releaseRefine"');

        /* ============ N: N05 immutabilita dei tratti commessi ============ */
        await freshDoc(env);
        const ln1 = [];
        for (let x = 120; x <= 520; x += 5) ln1.push([x, 180 + (x % 10) * 0.2]);
        await draw(env, ln1);
        await sleep(380);
        const ln2 = [];
        for (let x = 130; x <= 530; x += 5) ln2.push([x, 420 + (x % 10) * 0.2]);
        await draw(env, ln2);
        await sleep(380);
        const beforeN5 = JSON.stringify(ink.objects());
        const ln3 = [];
        for (let x = 140; x <= 540; x += 5) ln3.push([x, 560 + (x % 10) * 0.2]);
        await draw(env, ln3);
        await sleep(380);
        const afterN5 = ink.objects();
        ok(JSON.stringify(afterN5.slice(0, 2)) === beforeN5,
            'N05 disegnare un altro tratto NON cambia i JSON dei primi',
            'n=' + afterN5.length);

        /* ============ O: frecce - freccia nello STESSO tratto ============ */
        await freshDoc(env);
        const la = lineArrow();
        const endA = la[la.length - 1];
        const flickA = [[endA[0] + 6, endA[1] + 4.5], [endA[0] - 15, endA[1] + 8]];
        c0 = JSON.parse(JSON.stringify(ink.counters));
        await draw(env, la.concat(flickA));
        await sleep(380);
        let s15 = strokes(env);
        ok(s15.length === 1 && s15[0].vclass === 'arrow',
            'O0 retta+micro-V/back-stroke -> arrow (F01 stesso tratto)',
            JSON.stringify(s15.map(o => o.vclass)));
        if (s15[0] && s15[0].vclass === 'arrow') {
            const p = s15[0].params;
            ok(!!p.head && p.shaftKind === 'line',
                'O1 params.head presente + shaftKind=line',
                JSON.stringify({ h: !!p.head, s: p.shaftKind }));
            const sz = s15[0].base || s15[0].size || 3;
            if (p.head) {
                ok(p.head.len >= 3 * sz && p.head.len <= 4 * sz,
                    'O2 punta len in 3-4x spessore (F03)',
                    p.head.len.toFixed(2) + '/' + sz);
                ok(p.head.wing >= 30 && p.head.wing <= 40,
                    'O3 ali in 30-40 gradi (F03)', String(p.head.wing));
            }
        }
        ok(ink.counters.classified.arrow === c0.classified.arrow + 1, 'O4 contatore arrow +1');

        /* ============ P: frecce - SECONDO tratto assorbito (F01/M04) ============ */
        await freshDoc(env);
        await draw(env, lineForAbsorb());
        const tR1 = env.win.performance.now();
        await sleep(240);   // commesso (settle 200) e ancora entro 300ms
        let s16 = strokes(env);
        ok(s16.length === 1 && s16[0].vclass === 'line',
            'P0 asta commessa prima del trattino',
            JSON.stringify(s16.map(o => o.vclass)));
        const e2 = s16[0].pts[s16[0].pts.length - 1];
        const fl2 = [[e2[0] - 30, e2[1] + 22], [e2[0] - 8, e2[1] + 15], [e2[0] + 14, e2[1] + 9]];
        const abs0 = nTrace(env, 'absorb');
        const tD2 = env.win.performance.now();
        await draw(env, fl2, { dt: 15 });
        const tR2 = env.win.performance.now();
        console.log('      MEASURE P gap rilascio1->rilascio2 = ' +
            (tR2 - tR1).toFixed(1) + 'ms (flick2Ms=300) | sleep+P0=' +
            (tD2 - tR1).toFixed(1) + ' draw2=' + (tR2 - tD2).toFixed(1));
        await sleep(380);
        let s17 = strokes(env);
        ok(s17.length === 1 && s17[0].vclass === 'arrow' && !!s17[0].params.head,
            'P1 secondo tratto BREVE assorbito: UN solo oggetto arrow (mai 2)',
            JSON.stringify(s17.map(o => o.vclass)));
        ok(nTrace(env, 'absorb') === abs0 + 1, 'P2 trace absorb registrato',
            String(nTrace(env, 'absorb') - abs0));
        env0.undoKey(env, 1);
        ok(ink.objects().length === 0,
            'P3 M04: un SOLO undo rimuove asta+punta insieme',
            'n=' + ink.objects().length);
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'y', ctrlKey: true, bubbles: true }));
        const s18 = ink.objects();
        ok(s18.length === 1 && s18[0].vclass === 'arrow' && !!s18[0].params.head,
            'P4 redo ripristina identico (M04)', JSON.stringify(s18.map(o => o.vclass)));

        /* ============ Q: trace - sole chiavi dichiarate ============ */
        const allowed = ['release', 'swap', 'absorb', 'raw', 'evt', 'paint', 'stop'];
        const seen = {};
        for (const e of ink.trace) seen[e.k] = 1;
        const unexpected = Object.keys(seen).filter(k => allowed.indexOf(k) < 0);
        ok(unexpected.length === 0, 'Q0 trace contiene solo chiavi release/swap/absorb/raw/evt/paint/stop',
            JSON.stringify(Object.keys(seen)));

        console.log('\nRISULTATO a14_shaping: ' + pass + ' passati, ' + fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO a14_shaping: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
