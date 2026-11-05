'use strict';
/* tests/u20_shaping.test.js - R20 lotto 1: classi di fit con PARITA'
   (retta, curve, cerchio/ellisse con gap-closing, rettangolo/quadrato,
   triangolo) + esclusioni (bbox<40px, n<5, coloring, testo, no re-snap)
   + preservamento larghezza/pressione per punto.
   Harness tests/_ink_env.js, pattern tests/a14_shaping.test.js.
   Tolleranze DICHIARATE (R20):
     - tol fit line/rett/tri/cerchio = 2.5 + amp*3 (amp=0.6 -> 4.3px)
     - residuo GREZZO->ideale 'curve' <= 2.5px (gate durissimo)
     - gap-closing <= max(12px, 8% diagonale bbox)
     - smoothing curve: Taubin lambda=0.5, mu=-0.53, 4 iterazioni,
       resample 4px, corner-lock su svolte >=50gradi (gambe 8px)
     - esclusioni: diagonale bbox < 40px, punti < 5, auto-intersezioni >= 3,
       densita' percorso/perimetro-bbox >= 1.6, >=60% punti dentro bbox di
       uno shape esistente, tool testo / overlay testo aperto
   Esecuzione: node tests/u20_shaping.test.js */
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
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
function shapes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'shape');
}
function strokes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'stroke');
}
/* distanza perpendicolare massima dei punti MONDO dalla linea (a,b) */
function maxPerpWorld(pts, a, b) {
    let m = 0;
    for (const q of pts) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        const d = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L;
        if (d > m) m = d;
    }
    return m;
}
/* distanza massima da punti a polilinea */
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
/* campione denso dei segmenti Bezier (n nodi x sub) */
function bezPoly(bez, sub) {
    const out = [];
    for (let i = 0; i < bez.length; i++) {
        const sg = bez[i];
        for (let j = (i === 0 ? 0 : 1); j <= sub; j++) {
            const t = j / sub, u = 1 - t;
            out.push([u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] +
                      3 * u * t * t * sg[2][0] + t * t * t * sg[3][0],
                      u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] +
                      3 * u * t * t * sg[2][1] + t * t * t * sg[3][1]]);
        }
    }
    return out;
}
/* passo fisso su polilinea (incluso ultimo punto) */
function stepPoly(poly, d) {
    const out = [poly[0]];
    let acc = 0;
    for (let i = 1; i < poly.length; i++) {
        const seg = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
        acc += seg;
        if (acc >= d) { out.push(poly[i]); acc = 0; }
    }
    const last = poly[poly.length - 1];
    const l = out[out.length - 1];
    if (l[0] !== last[0] || l[1] !== last[1]) out.push(last);
    return out;
}
/* angoli di svolta (gradi) fra segmenti consecutivi */
function turnsOf(poly) {
    const out = [];
    for (let i = 1; i < poly.length - 1; i++) {
        const a1 = Math.atan2(poly[i][1] - poly[i - 1][1], poly[i][0] - poly[i - 1][0]);
        const a2 = Math.atan2(poly[i + 1][1] - poly[i][1], poly[i + 1][0] - poly[i][0]);
        let d = (a2 - a1) * 180 / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        out.push(d);
    }
    return out;
}

/* R20 F/Q5-Q7: tratto con PAUSA temporale (finestra flick 250ms <
   pausa < hold-still 350ms) + flick/back-stroke di coda */
async function strokePauseFlick(env, basePts, flickPts, opt) {
    opt = opt || {};
    const canvas = env0.canvasOf(env);
    const bC = env0.wc(env, basePts);
    env0.ptr(env, canvas, 'pointerdown', bC[0][0], bC[0][1]);
    for (let i = 1; i < bC.length; i++) {
        if (opt.dt) await sleep(opt.dt);
        env0.ptr(env, canvas, 'pointermove', bC[i][0], bC[i][1]);
    }
    await sleep(280);   // >250ms finestra flick, <350ms hold-still
    const fC = env0.wc(env, flickPts);
    for (let i = 0; i < fC.length; i++) {
        await sleep(4);
        env0.ptr(env, canvas, 'pointermove', fC[i][0], fC[i][1]);
    }
    env0.ptr(env, canvas, 'pointerup', fC[fC.length - 1][0], fC[fC.length - 1][1]);
    await sleep(120);
    return canvas;
}
/* pointer con pointerId/pointerType espliciti (gesti multi-dito jsdom) */
function ptrT(env, canvas, type, x, y, id, ptype) {
    const ev = new env.win.MouseEvent(type,
        { bubbles: true, clientX: x, clientY: y, buttons: 1 });
    Object.defineProperty(ev, 'pointerId', { value: id });
    Object.defineProperty(ev, 'pointerType', { value: ptype || 'touch' });
    canvas.dispatchEvent(ev);
}
function angBetween(v1, v2) {
    const a = Math.atan2(v1[1], v1[0]) - Math.atan2(v2[1], v2[0]);
    let d = a * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d);
}
function angAcute(v1, v2) {
    const d = angBetween(v1, v2);
    return Math.min(d, 180 - d);
}
/* ricostruzione indipendente del triangolo punta dai campi head */
function headPolyOf(head) {
    const tx = head.tangente[0], ty = head.tangente[1];
    const n = Math.hypot(tx, ty) || 1;
    const ux = tx / n, uy = ty / n, nx = -uy, ny = ux;
    const a = head.angoloAlaDeg * Math.PI / 180;
    const L = head.lunghezza;
    const w = L * Math.sin(a), d = L * Math.cos(a);
    const bx = head.base[0], by = head.base[1];
    return [[bx + w * nx, by + w * ny], [bx + d * ux, by + d * uy],
            [bx - w * nx, by - w * ny]];
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!ink, '0.0 API __ink presente');
        const TOL = 2.5 + 0.6 * 3;   // amp default 0.6 -> 4.3px
        ink.setHelp(0.6);

        // ============ 1: RETTA - LSQ endpoint + residuo grezzo->ideale ===
        await freshDoc(env);
        ink.setHelp(0.6);
        const rndL = lcg(7);
        const lineC = [];
        for (let i = 0; i <= 50; i++) {
            lineC.push([100 + i * 3 + (rndL() - 0.5) * 2,
                        150 + i * 0.6 + (rndL() - 0.5) * 2]);
        }
        await env0.stroke(env, env0.wc(env, lineC));
        let sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line', '1.0 retta riconosciuta',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0]) {
            const err = maxPerpWorld(lineC, sh[0].pts[0], sh[0].pts[1]);
            ok(err <= TOL, '1.1 residuo grezzo->ideale linea <= 2.5+amp*3',
                'perp=' + err.toFixed(2) + ' tol=' + TOL.toFixed(2));
            ok(sh[0].sizes && sh[0].sizes.length === 2,
                '1.2 sizes per punto preservate sulla linea',
                JSON.stringify(sh[0].sizes));
        }

        // ============ 2: RETTANGOLO STORTO + jitter -> rectangle 5deg =====
        await freshDoc(env);
        ink.setHelp(0.6);
        const rndR = lcg(101);
        const rW = 150, rH = 95, rotD = 7 * Math.PI / 180;
        const rcx = 300, rcy = 300;
        const rectC = [];
        const rcorn = [[0, 0], [rW, 0], [rW, rH], [0, rH]];
        for (let sIdx = 0; sIdx < 4; sIdx++) {
            const a0 = rcorn[sIdx], b0 = rcorn[(sIdx + 1) % 4];
            const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
            for (let d = 0; d < len; d += 4) {
                const f = d / len;
                const lx = a0[0] + (b0[0] - a0[0]) * f + (rndR() - 0.5) * 4;
                const ly = a0[1] + (b0[1] - a0[1]) * f + (rndR() - 0.5) * 4;
                rectC.push([rcx + lx * Math.cos(rotD) - ly * Math.sin(rotD),
                            rcy + lx * Math.sin(rotD) + ly * Math.cos(rotD)]);
            }
        }
        await env0.stroke(env, env0.wc(env, rectC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'rectangle',
            '2.0 rettangolo storto+jitter -> rectangle',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0] && sh[0].kind === 'rectangle') {
            let maxA = 0;
            for (let i = 0; i < 4; i++) {
                const pa = sh[0].pts[(i + 3) % 4], pb = sh[0].pts[i],
                      pc = sh[0].pts[(i + 1) % 4];
                const v1 = [pa[0] - pb[0], pa[1] - pb[1]];
                const v2 = [pc[0] - pb[0], pc[1] - pb[1]];
                const cs = (v1[0] * v2[0] + v1[1] * v2[1]) /
                    (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]));
                const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
                const dev = Math.abs(ang - 90);
                if (dev > maxA) maxA = dev;
            }
            ok(maxA <= 5, '2.1 angoli rettangolo entro 5 gradi', 'maxDev=' + maxA.toFixed(2));
            const bxc = sh[0].box.x + sh[0].box.w / 2;
            const byc = sh[0].box.y + sh[0].box.h / 2;
            // ASPETTATIVA CORRETTA (motivata): il generatore ANCORa il
            // rettangolo nell'angolo (rcx,rcy) con lx,ly in [0,W]x[0,H] e lo
            // ruota di rotD, quindi il centro GEOMETRICO della figura disegnata
            // e' anchor + R(rotD)*(W/2,H/2) = (368.65, 356.28), NON l'ancora
            // (300,300). Confrontare con l'ancora dava cErr=88.88px di errore
            // SPURIO (eseguita solo da quando 2.0 produce davvero un rettangolo;
            // il blocco era saltato prima). Il senso dell'assert resta lo stesso:
            // il box cade sul centro reale entro 6px (nessun displacement da
            // rifare il giro di rotazione PCA).
            const expCx = rcx + (rW / 2) * Math.cos(rotD) - (rH / 2) * Math.sin(rotD);
            const expCy = rcy + (rW / 2) * Math.sin(rotD) + (rH / 2) * Math.cos(rotD);
            const cErr = Math.hypot(bxc - expCx, byc - expCy);
            ok(cErr <= 6, '2.2 centro rettangolo al posto giusto (fix rot PCA)',
                'cErr=' + cErr.toFixed(2));
            ok(sh[0].sizes && sh[0].sizes.length === sh[0].pts.length,
                '2.3 sizes per punto preservate sul rettangolo',
                'sizes=' + (sh[0].sizes ? sh[0].sizes.length : 'null') +
                ' pts=' + sh[0].pts.length);
        }

        // ============ 3: QUADRATO -> aspect 0.9-1.1 ========================
        await freshDoc(env);
        ink.setHelp(0.6);
        const rndS = lcg(23);
        const sSide = 100, sRot = 3 * Math.PI / 180;
        const sqC = [];
        const scorn = [[0, 0], [sSide, 0], [sSide, sSide], [0, sSide]];
        for (let sIdx = 0; sIdx < 4; sIdx++) {
            const a0 = scorn[sIdx], b0 = scorn[(sIdx + 1) % 4];
            const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
            for (let d = 0; d < len; d += 4) {
                const f = d / len;
                const lx = a0[0] + (b0[0] - a0[0]) * f + (rndS() - 0.5) * 4;
                const ly = a0[1] + (b0[1] - a0[1]) * f + (rndS() - 0.5) * 4;
                sqC.push([250 + lx * Math.cos(sRot) - ly * Math.sin(sRot),
                          350 + lx * Math.sin(sRot) + ly * Math.cos(sRot)]);
            }
        }
        await env0.stroke(env, env0.wc(env, sqC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'square', '3.0 quadrato riconosciuto',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0]) {
            const aspect = sh[0].box.w / sh[0].box.h;
            ok(aspect >= 0.9 && aspect <= 1.1, '3.1 aspect quadrato 0.9-1.1',
                'aspect=' + aspect.toFixed(3));
        }

        // ============ 4: CERCHIO TREMOLANTE -> circle ======================
        await freshDoc(env);
        ink.setHelp(0.6);
        const rndC = lcg(7);
        const circC = [];
        const ccx = 300, ccy = 300, R = 45;
        for (let i = 0; i < 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            const rr = R + (rndC() - 0.5) * 3;      // jitter +-1.5px
            circC.push([ccx + Math.cos(a) * rr, ccy + Math.sin(a) * rr]);
        }
        await env0.stroke(env, env0.wc(env, circC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'circle', '4.0 cerchio tremolante -> circle',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0] && sh[0].params) {
            ok(Math.abs(sh[0].params.r - R) <= TOL, '4.1 raggio cerchio entro tolleranza',
                'rErr=' + Math.abs(sh[0].params.r - R).toFixed(2));
            ok(sh[0].sizes && sh[0].sizes.length === 48,
                '4.2 sizes perimetro cerchio (48 settori) preservate',
                'sizes=' + (sh[0].sizes ? sh[0].sizes.length : 'null'));
        }

        // ============ 5: CERCHIO CON GAP PICCOLO -> circle chiuso ==========
        await freshDoc(env);
        ink.setHelp(0.6);
        const gapC = [];
        const nG = 71;                       // 350 gradi: chord gap ~7.9px
        for (let i = 0; i <= nG; i++) {
            const a = (i / nG) * Math.PI * 2 * 0.9722;   // 350 gradi
            gapC.push([280 + Math.cos(a) * 45, 280 + Math.sin(a) * 45]);
        }
        await env0.stroke(env, env0.wc(env, gapC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'circle',
            '5.0 cerchio con gap piccolo -> circle (gap-closing esplicito)',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0] && sh[0].params) {
            ok(Math.abs(sh[0].params.r - 45) <= TOL,
                '5.1 raggio cerchio chiuso entro tolleranza',
                'rErr=' + Math.abs(sh[0].params.r - 45).toFixed(2));
            ok(Math.abs(sh[0].box.w - 90) <= TOL && Math.abs(sh[0].box.h - 90) <= TOL,
                '5.2 box cerchio chiuso = diametro pieno',
                'w=' + sh[0].box.w.toFixed(1) + ' h=' + sh[0].box.h.toFixed(1));
        }

        // ============ 6: "C" APERTA -> MAI circle/ellipse =================
        await freshDoc(env);
        ink.setHelp(0.6);
        const cOpen = [];
        for (let i = 0; i <= 55; i++) {
            const a = (40 + (i / 55) * 280) * Math.PI / 180;
            cOpen.push([320 + Math.cos(a) * 55, 320 + Math.sin(a) * 55]);
        }
        await env0.stroke(env, env0.wc(env, cOpen));
        sh = shapes(env);
        const badKinds = sh.filter(s => s.kind === 'circle' || s.kind === 'ellipse' ||
            s.kind === 'rectangle' || s.kind === 'square' || s.kind === 'triangle');
        ok(badKinds.length === 0,
            '6.0 C aperta -> MAI circle/ellipse (curve o stroke ammesse)',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        ok(sh.every(s => s.kind === 'curve') && strokes(env).length === 0,
            '6.1 C aperta di qualita\' -> curve (uscita R20, nessun blocco)',
            JSON.stringify(sh.map(s => s.kind)));

        // ============ 7: COLORING -> stroke ===============================
        await freshDoc(env);
        ink.setHelp(0.6);
        const rnd7 = lcg(77);
        const scribble = [];
        for (let row = 0; row < 8; row++) {
            const y = 300 + row * 16;
            if (row % 2 === 0) {
                for (let x = 0; x <= 220; x += 10) scribble.push([150 + x + (rnd7() - 0.5) * 6, y + (rnd7() - 0.5) * 10]);
            } else {
                for (let x = 220; x >= 0; x -= 10) scribble.push([150 + x + (rnd7() - 0.5) * 6, y + (rnd7() - 0.5) * 10]);
            }
        }
        await env0.stroke(env, env0.wc(env, scribble));
        ok(shapes(env).length === 0 && strokes(env).length === 1,
            '7.0 coloring -> resta stroke (densita\'/intersizioni)',
            JSON.stringify(shapes(env).map(s => s.kind)) + ' strokes=' + strokes(env).length);

        // ============ 8: ARCO STRETTO VERSO IL BASSO -> curve =============
        await freshDoc(env);
        ink.setHelp(0.6);
        const rndA = lcg(555);
        const arcC = [];                    // valle (arc "verso il basso")
        const aX0 = 260, aW = 130, aSag = 55;
        for (let x = aX0; x <= aX0 + aW; x += 3) {
            const t = (x - aX0) / aW;
            arcC.push([x + (rndA() - 0.5) * 2,
                       300 + aSag * Math.sin(Math.PI * t) + (rndA() - 0.5) * 2]);
        }
        await env0.stroke(env, env0.wc(env, arcC), { dt: 1, settle: 140 });
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'curve', '8.0 arco stretto -> curve',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        if (sh[0] && sh[0].params && sh[0].params.bez) {
            const idealPoly = bezPoly(sh[0].params.bez, 8);
            const res = maxDistToPoly(arcC, idealPoly);
            ok(res <= 2.5, '8.1 residuo GREZZO->ideale curve <= 2.5px (dichiarato)',
                'res=' + res.toFixed(3) + 'px');
            // curvatura: segno conservato + variazione fra campioni
            // adiacenti entro soglia (niente kink)
            const samp = stepPoly(idealPoly, 6);
            const ts = turnsOf(samp);
            // campioni con |turn| <= 5°: vicini all'inflessione, segno
            // indeterminato per definizione (rumore di campionamento)
            const sig = ts.filter(v => Math.abs(v) > 5);
            const nPos = sig.filter(v => v > 0).length;
            const frac = sig.length ? Math.max(nPos, sig.length - nPos) / sig.length : 0;
            let maxAdj = 0;
            for (let i = 1; i < ts.length; i++) {
                const d = Math.abs(ts[i] - ts[i - 1]);
                if (d > maxAdj) maxAdj = d;
            }
            // riferimento ideale (seno senza jitter), stesso campionamento
            const refC = [];
            for (let x = aX0; x <= aX0 + aW; x += 2) {
                refC.push([x, 300 + aSag * Math.sin(Math.PI * (x - aX0) / aW)]);
            }
            const rts = turnsOf(stepPoly(refC, 6));
            const rPos = rts.filter(v => v > 0).length;
            const rNeg = rts.filter(v => v < 0).length;
            const refSign = rPos >= rNeg ? 1 : -1;
            const majSign = nPos >= (sig.length - nPos) ? 1 : -1;
            console.log('  probe curve: res=' + res.toFixed(3) +
                ' maxAdj=' + maxAdj.toFixed(2) + ' signFrac=' + frac.toFixed(3) +
                ' refSign=' + refSign + ' majSign=' + majSign +
                ' maxT=' + Math.max.apply(null, ts.map(Math.abs)).toFixed(2));
            ok(frac >= 0.9, '8.2 segno curvatura conservato (>=90%)',
                'frac=' + frac.toFixed(3));
            ok(refSign === majSign, '8.3 segno curvatura = tracciato utente',
                'ref=' + refSign + ' maj=' + majSign);
            ok(maxAdj <= 15, '8.4 variazione curvatura campioni adiacenti <= 15gradi (no kink)',
                'maxAdj=' + maxAdj.toFixed(2));
            ok(sh[0].sizes && sh[0].sizes.length === sh[0].pts.length,
                '8.5 sizes per nodo della curva preservate',
                'sizes=' + (sh[0].sizes ? sh[0].sizes.length : 'null') +
                ' pts=' + sh[0].pts.length);
        }

        // ============ 9: ESCLUSIONE bbox < 40px ===========================
        await freshDoc(env);
        ink.setHelp(0.6);
        const tinyC = [];
        for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            tinyC.push([300 + Math.cos(a) * 14, 300 + Math.sin(a) * 14]);  // diag 39.6
        }
        await env0.stroke(env, env0.wc(env, tinyC));
        ok(shapes(env).length === 0 && strokes(env).length === 1,
            '9.0 bbox diagonale < 40px -> resta stroke',
            JSON.stringify(shapes(env).map(s => s.kind)));

        // ============ 10: ESCLUSIONE n punti < 5 ===========================
        await freshDoc(env);
        ink.setHelp(0.6);
        await env0.stroke(env, env0.wc(env, [[100, 100], [115, 101], [130, 102], [145, 103]]));
        ok(shapes(env).length === 0 && strokes(env).length === 1,
            '10.0 meno di 5 punti -> resta stroke',
            'objs=' + env.win.__ink.objects().length);

        // ============ 11: ESCLUSIONE tool testo / overlay aperto ==========
        await freshDoc(env);
        ink.setHelp(0.6);
        const bTxt = env.doc.querySelector('[data-tool="testo"]');
        ok(!!bTxt, '11.0 pulsante tool testo presente');
        if (bTxt) bTxt.click();
        const tCirc = [];
        for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * Math.PI * 2;
            tCirc.push([300 + Math.cos(a) * 60, 300 + Math.sin(a) * 60]);
        }
        await env0.stroke(env, env0.wc(env, tCirc));
        ok(env.win.__ink.objects().length === 0,
            '11.1 tool testo attivo -> nessun tratto/shape snap-pato',
            'objs=' + JSON.stringify(env.win.__ink.objects().map(o => o.t)));
        const ta = env.doc.querySelector('textarea');
        ok(!!ta, '11.2 overlay testo aperto dal tool testo');
        if (ta) {
            ta.value = 'Ciao R20';
            ta.dispatchEvent(new env.win.FocusEvent('blur'));
            await sleep(60);
        }
        ok(env.win.__ink.objects().some(o => o.t === 'text'),
            '11.3 oggetto testo commesso dall overlay');
        const bPen = env.doc.querySelector('[data-tool="penna"]');
        ok(!!bPen, '11.4 pulsante tool penna presente');
        if (bPen) bPen.click();          // chiude l overlay (setTool)
        // riapri l overlay col doppio click sul testo (tool penna attivo)
        const txtObj = env.win.__ink.objects().filter(o => o.t === 'text')[0];
        if (txtObj) {
            const cc = env0.wc(env, [[txtObj.x, txtObj.y]])[0];
            const cv = env0.canvasOf(env);
            cv.dispatchEvent(new env.win.MouseEvent('dblclick',
                { bubbles: true, clientX: cc[0], clientY: cc[1] }));
            await sleep(80);
        }
        ok(!!env.doc.querySelector('textarea'),
            '11.5 overlay testo riaperto con tool penna attivo');
        const oCirc = [];
        for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * Math.PI * 2;
            oCirc.push([560 + Math.cos(a) * 55, 300 + Math.sin(a) * 55]);
        }
        await env0.stroke(env, env0.wc(env, oCirc));
        ok(shapes(env).length === 0,
            '11.6 overlay testo aperto -> nessun snap (resta stroke)',
            JSON.stringify(shapes(env).map(s => s.kind)) +
            ' strokes=' + strokes(env).length);
        ok(strokes(env).length === 1, '11.7 tratto grezzo presente (non snap-pato)');

        // ============ 12: NESSUN RE-SNAP su shape esistente ==============
        await freshDoc(env);
        ink.setHelp(0.6);
        const c1 = [];
        for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            c1.push([300 + Math.cos(a) * 50, 300 + Math.sin(a) * 50]);
        }
        await env0.stroke(env, env0.wc(env, c1));
        ok(shapes(env).length === 1 && shapes(env)[0].kind === 'circle',
            '12.0 primo cerchio snap-pato');
        const c2 = [];
        for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            c2.push([304 + Math.cos(a) * 45, 300 + Math.sin(a) * 45]);
        }
        await env0.stroke(env, env0.wc(env, c2));
        ok(shapes(env).length === 1 && strokes(env).length === 1,
            '12.1 secondo tratto >=60% dentro bbox shape -> resta stroke',
            'shapes=' + shapes(env).length + ' strokes=' + strokes(env).length);

        // ============ 13: TRIANGOLO -> triangle ===========================
        await freshDoc(env);
        ink.setHelp(0.6);
        const rndT = lcg(31);
        const triC = [];
        const tSide = 115, tRot = 10 * Math.PI / 180;
        const tR = tSide / Math.sqrt(3);
        const vc = [];
        for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + k * 2 * Math.PI / 3 + tRot;
            vc.push([300 + Math.cos(a) * tR, 300 + Math.sin(a) * tR]);
        }
        for (let sIdx = 0; sIdx < 3; sIdx++) {
            const a0 = vc[sIdx], b0 = vc[(sIdx + 1) % 3];
            const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
            for (let d = 0; d < len; d += 4) {
                const f = d / len;
                triC.push([a0[0] + (b0[0] - a0[0]) * f + (rndT() - 0.5) * 3,
                           a0[1] + (b0[1] - a0[1]) * f + (rndT() - 0.5) * 3]);
            }
        }
        await env0.stroke(env, env0.wc(env, triC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'triangle',
            '13.0 triangolo chiuso+jitter -> triangle (non rect/curve)',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0] && sh[0].kind === 'triangle') {
            ok(sh[0].pts.length === 3, '13.1 triangolo = 3 vertici',
                'pts=' + sh[0].pts.length);
            let maxT = 0;
            for (let i = 0; i < 3; i++) {
                const pa = sh[0].pts[(i + 2) % 3], pb = sh[0].pts[i],
                      pc = sh[0].pts[(i + 1) % 3];
                const v1 = [pa[0] - pb[0], pa[1] - pb[1]];
                const v2 = [pc[0] - pb[0], pc[1] - pb[1]];
                const cs = (v1[0] * v2[0] + v1[1] * v2[1]) /
                    (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]));
                const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
                const dev = Math.abs(ang - 60);
                if (dev > maxT) maxT = dev;
            }
            ok(maxT <= 15, '13.2 angoli triangolo 60 +/- 15 (spec 60+/-25)',
                'maxDev=' + maxT.toFixed(2));
            ok(sh[0].sizes && sh[0].sizes.length === sh[0].pts.length,
                '13.3 sizes per vertice preservate sul triangolo',
                'sizes=' + (sh[0].sizes ? sh[0].sizes.length : 'null'));
        }

        // ============ Q5: RETTA + jitter + FRECCIA COMPOSTA (F) =========
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);  // pausa 280ms: nessun hold-still (determinismo)
        const rndQ5 = lcg(4242);
        const lineQ = [];
        for (let i = 0; i <= 50; i++) {
            lineQ.push([100 + i * 3 + (rndQ5() - 0.5) * 2,
                        150 + i * 0.6 + (rndQ5() - 0.5) * 2]);
        }
        const endQ = lineQ[lineQ.length - 1];
        const flickQ = [
            [endQ[0], endQ[1]], [endQ[0] + 12, endQ[1] + 4],
            [endQ[0] + 22, endQ[1] + 0], [endQ[0] + 16, endQ[1] + 8],
            [endQ[0] + 4, endQ[1] + 5], [endQ[0] - 6, endQ[1] + 10]
        ];
        await strokePauseFlick(env, lineQ, flickQ, { dt: 1 });
        sh = shapes(env);
        ok(sh.length === 1 && strokes(env).length === 0 && sh[0].kind === 'arrow',
            'Q5.0 retta+flick -> UN oggetto kind arrow',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        const a5 = sh[0];
        if (a5 && a5.kind === 'arrow') {
            ok(a5.params && a5.params.shaft && a5.params.shaft.kind === 'line',
                'Q5.1 params.shaft.kind === line',
                JSON.stringify(a5.params && a5.params.shaft && a5.params.shaft.kind));
            const h5 = a5.params.head;
            ok(!!h5 && h5.angoloAlaDeg >= 30 && h5.angoloAlaDeg <= 45,
                'Q5.2 ali a 30-45 gradi rispetto alla tangente',
                'angolo=' + (h5 && h5.angoloAlaDeg));
            const sz5 = a5.size || 2;
            ok(h5.lunghezza >= 3 * sz5 && h5.lunghezza <= 4 * sz5,
                'Q5.3 lunghezza ali = 3-4x spessore (sizes in coda)',
                'L=' + h5.lunghezza + ' size=' + sz5);
            const sp5 = a5.params.shaft.pts;
            const term5 = sp5[sp5.length - 1];
            const dBase5 = Math.hypot(h5.base[0] - term5[0], h5.base[1] - term5[1]);
            ok(dBase5 <= 2, 'Q5.4 base punta sul terminale asta (<=2px)',
                'd=' + dBase5.toFixed(3));
            // asta = fit retta: residuo perpendicolare grezzo->ideale <= tol
            const preQ = lineQ.slice(0, -1);
            const errQ = maxPerpWorld(preQ, sp5[0], sp5[1]);
            ok(errQ <= TOL, 'Q5.5 asta = fit minimi quadrati residuo <= 2.5+amp*3',
                'perp=' + errQ.toFixed(3) + ' tol=' + TOL.toFixed(2));
            const dv5 = [sp5[1][0] - sp5[0][0], sp5[1][1] - sp5[0][1]];
            ok(angBetween(h5.tangente, dv5) <= 5,
                'Q5.6 tangente punta = verso asta (<=5 gradi)',
                'ang=' + angBetween(h5.tangente, dv5).toFixed(2));
            // triangolo punta ricostruito DAI CAMPI: ali 30-45 e uguali
            const tri5 = headPolyOf(h5);
            const w1 = [tri5[0][0] - tri5[1][0], tri5[0][1] - tri5[1][1]];
            const w2 = [tri5[2][0] - tri5[1][0], tri5[2][1] - tri5[1][1]];
            const aW1 = angAcute(w1, h5.tangente);
            const aW2 = angAcute(w2, h5.tangente);
            ok(aW1 >= 30 && aW1 <= 45 && aW2 >= 30 && aW2 <= 45,
                'Q5.7 ali simmetriche 30-45 gradi (ricostruzione indipendente)',
                'w1=' + aW1.toFixed(1) + ' w2=' + aW2.toFixed(1));
            const lw1 = Math.hypot(w1[0], w1[1]), lw2 = Math.hypot(w2[0], w2[1]);
            ok(Math.abs(lw1 - h5.lunghezza) <= 0.01 &&
               Math.abs(lw2 - h5.lunghezza) <= 0.01,
                'Q5.8 ali entrambe = lunghezza dichiarata',
                'lw1=' + lw1.toFixed(2) + ' lw2=' + lw2.toFixed(2));
        }
        // undo a 2 livelli sull'oggetto arrow
        env0.undoKey(env, 1);
        const q5u1 = env.win.__ink.objects();
        ok(q5u1.length === 1 && q5u1[0].t === 'stroke',
            'Q5.9 undo 1 -> tratto GREZZO pre-flick ripristinato',
            JSON.stringify(q5u1.map(o => o.t)));
        env0.undoKey(env, 1);
        const q5u2 = env.win.__ink.objects();
        ok(q5u2.length === 0, 'Q5.10 undo 2 -> oggetto rimosso',
            'len=' + q5u2.length);

        // ============ Q5b: BACK-STROKE su retta (F1 oltre soglia V) =====
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);  // nessun hold-still durante la pausa
        const rndQ5b = lcg(909);
        const lineB = [];
        for (let i = 0; i <= 30; i++) {
            lineB.push([300 + i * 1.5 + (rndQ5b() - 0.5) * 2,
                        400 + i * 0.2 + (rndQ5b() - 0.5) * 2]);
        }
        const endB = lineB[lineB.length - 1];
        // gamba avanti + ritroso netto (~175 gradi) = back-stroke
        const backB = [
            [endB[0] + 5, endB[1] + 1], [endB[0] + 10, endB[1] + 1],
            [endB[0] + 14, endB[1] + 2], [endB[0] + 7, endB[1] + 1],
            [endB[0] - 1, endB[1] + 1], [endB[0] - 9, endB[1] + 1],
            [endB[0] - 17, endB[1] + 1]
        ];
        await strokePauseFlick(env, lineB, backB, { dt: 1 });
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'arrow' &&
           sh[0].params && sh[0].params.shaft && sh[0].params.shaft.kind === 'line',
            'Q5.11 back-stroke su retta -> arrow (rilevamento F1)',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);

        // ============ Q6: ARCO + jitter + FRECCIA COMPOSTA (F) ==========
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);  // pausa 280ms: nessun hold-still (determinismo)
        const rndQ6 = lcg(555);
        const arcQ = [];
        const aX6 = 260, aW6 = 130, aSag6 = 55;
        for (let x = aX6; x <= aX6 + aW6; x += 3) {
            const t = (x - aX6) / aW6;
            arcQ.push([x + (rndQ6() - 0.5) * 2,
                       300 + aSag6 * Math.sin(Math.PI * t) + (rndQ6() - 0.5) * 2]);
        }
        const endA = arcQ[arcQ.length - 1];
        const flickA = [
            [endA[0], endA[1]], [endA[0] + 12, endA[1] + 4],
            [endA[0] + 20, endA[1] - 2], [endA[0] + 14, endA[1] + 7],
            [endA[0] + 2, endA[1] + 4], [endA[0] - 8, endA[1] + 9]
        ];
        await strokePauseFlick(env, arcQ, flickA, { dt: 1 });
        sh = shapes(env);
        ok(sh.length === 1 && strokes(env).length === 0 && sh[0].kind === 'arrow',
            'Q6.0 arco+flick -> UN oggetto kind arrow',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        const a6 = sh[0];
        if (a6 && a6.kind === 'arrow') {
            ok(a6.params && a6.params.shaft && a6.params.shaft.kind === 'curve',
                'Q6.1 params.shaft.kind === curve',
                JSON.stringify(a6.params && a6.params.shaft && a6.params.shaft.kind));
            const bezQ = a6.params.shaft.bez;
            ok(!!bezQ && bezQ.length >= 1 && !!a6.params.bez,
                'Q6.2 fit Bezier presente (params.shaft.bez + params.bez)',
                'shaft.bez=' + (bezQ ? bezQ.length : 'null'));
            if (bezQ) {
                const idealQ = bezPoly(bezQ, 8);
                const preA = arcQ.slice(0, -1);
                // seam escluso: l'ultimo punto e' la giuntura asta/punta,
                // gia' coperta dall'assert Q6.5 (base <=2px sul terminale)
                const resQ = maxDistToPoly(preA.slice(0, -1), idealQ);
                ok(resQ <= TOL, 'Q6.3 residuo GREZZO->ideale asta curve <= TOL (parita U1, seam escluso)',
                    'res=' + resQ.toFixed(3) + ' tol=' + TOL.toFixed(2));
                // tangente finale = derivata Bezier in t=1 (entro 10 gradi)
                const sgL = bezQ[bezQ.length - 1];
                const der = [3 * (sgL[3][0] - sgL[2][0]),
                             3 * (sgL[3][1] - sgL[2][1])];
                const angT = angBetween(a6.params.head.tangente, der);
                ok(angT <= 10, 'Q6.4 punta = tangente finale Bezier t=1 (<=10 gradi)',
                    'ang=' + angT.toFixed(3));
                const dA6 = Math.hypot(a6.params.head.base[0] - sgL[3][0],
                                       a6.params.head.base[1] - sgL[3][1]);
                ok(dA6 <= 2, 'Q6.5 base punta sul terminale asta (<=2px)',
                    'd=' + dA6.toFixed(3));
            }
            const h6 = a6.params.head;
            ok(h6.angoloAlaDeg >= 30 && h6.angoloAlaDeg <= 45,
                'Q6.6 ali a 30-45 gradi rispetto alla tangente',
                'angolo=' + h6.angoloAlaDeg);
            const sz6 = a6.size || 2;
            ok(h6.lunghezza >= 3 * sz6 && h6.lunghezza <= 4 * sz6,
                'Q6.7 lunghezza ali = 3-4x spessore (sizes in coda)',
                'L=' + h6.lunghezza + ' size=' + sz6);
        }

        // ============ Q7: spostamento + gesti due/tre dita (F4/F5) ======
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);  // nessun hold-still durante pause flick
        const rndQ7 = lcg(1717);
        const line7 = [];
        for (let i = 0; i <= 50; i++) {
            line7.push([120 + i * 3 + (rndQ7() - 0.5) * 2,
                        200 + i * 0.5 + (rndQ7() - 0.5) * 2]);
        }
        const end7 = line7[line7.length - 1];
        const flick7 = [
            [end7[0], end7[1]], [end7[0] + 12, end7[1] + 4],
            [end7[0] + 22, end7[1] + 0], [end7[0] + 16, end7[1] + 8],
            [end7[0] + 4, end7[1] + 5], [end7[0] - 6, end7[1] + 10]
        ];
        await strokePauseFlick(env, line7, flick7, { dt: 1 });
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'arrow', 'Q7.0 freccia composta creata',
            JSON.stringify(sh.map(s => s.kind)));
        const a7 = sh[0];
        // coerenza: head e shaft condividono la posizione nello STESSO oggetto
        if (a7 && a7.kind === 'arrow') {
            const tw7 = a7.params.shaft.pts[a7.params.shaft.pts.length - 1];
            const dW0 = Math.hypot(a7.params.head.base[0] - tw7[0],
                                   a7.params.head.base[1] - tw7[1]);
            ok(dW0 <= 2, 'Q7.1 head.base e terminale asta stessa posizione',
                'd=' + dW0.toFixed(3));
        }

        // gesto 2 dita (pointer events reali, nessun movimento) -> UN undo
        const cv7 = env0.canvasOf(env);
        ptrT(env, cv7, 'pointerdown', 300, 300, 71);
        ptrT(env, cv7, 'pointerdown', 316, 300, 72);
        ptrT(env, cv7, 'pointerup', 300, 300, 71);
        ptrT(env, cv7, 'pointerup', 316, 300, 72);
        await sleep(80);
        let objs7 = env.win.__ink.objects();
        ok(objs7.length === 1 && objs7[0].t === 'stroke',
            'Q7.2 gesto 2 dita -> UN undo solo (tratto grezzo, anti-doppio)',
            JSON.stringify(objs7.map(o => o.t)));
        // gesto 3 dita -> redo
        ptrT(env, cv7, 'pointerdown', 300, 300, 73);
        ptrT(env, cv7, 'pointerdown', 316, 300, 74);
        ptrT(env, cv7, 'pointerdown', 332, 300, 75);
        ptrT(env, cv7, 'pointerup', 300, 300, 73);
        ptrT(env, cv7, 'pointerup', 316, 300, 74);
        ptrT(env, cv7, 'pointerup', 332, 300, 75);
        await sleep(80);
        objs7 = env.win.__ink.objects();
        ok(objs7.length === 1 && objs7[0].kind === 'arrow',
            'Q7.3 gesto 3 dita -> redo (freccia torna)',
            JSON.stringify(objs7.map(o => o.t + ':' + (o.kind || ''))));
        // stessa logica esposta per test minimale (spec F5/Q7)
        const firedU = ink.gestureTapTest(2);
        ok(firedU === true && env.win.__ink.objects()[0].t === 'stroke',
            'Q7.4 gestureTapTest(2) = UN undo (stessa logica del gesto)');
        const firedR = ink.gestureTapTest(3);
        ok(firedR === true && env.win.__ink.objects()[0].kind === 'arrow',
            'Q7.5 gestureTapTest(3) = UN redo (stessa logica del gesto)');

        // spostamento con DRAG reale (tool selezione su canvas)
        const b7 = env.doc.querySelector('[data-tool="selezione"]');
        ok(!!b7, 'Q7.6 pulsante tool selezione presente');
        if (b7) b7.click();
        const before7 = env.win.__ink.objects()[0];
        const sp7 = before7.params.shaft.pts;
        const mid7 = [(sp7[0][0] + sp7[1][0]) / 2, (sp7[0][1] + sp7[1][1]) / 2];
        const midC7 = env0.wc(env, [mid7])[0];
        const base0 = [before7.params.head.base[0], before7.params.head.base[1]];
        const box0 = { x: before7.box.x, y: before7.box.y };
        const tang0 = [before7.params.head.tangente[0], before7.params.head.tangente[1]];
        const wA7 = ink.toWorld(midC7[0], midC7[1]);
        const wB7 = ink.toWorld(midC7[0] + 30, midC7[1] + 20);
        const dxW = wB7.x - wA7.x, dyW = wB7.y - wA7.y;
        ptrT(env, cv7, 'pointerdown', midC7[0], midC7[1], 76);
        ptrT(env, cv7, 'pointermove', midC7[0] + 30, midC7[1] + 20, 76);
        ptrT(env, cv7, 'pointermove', midC7[0] + 30, midC7[1] + 20, 76);
        ptrT(env, cv7, 'pointerup', midC7[0] + 30, midC7[1] + 20, 76);
        await sleep(60);
        const after7 = env.win.__ink.objects()[0];
        ok(!!after7 && after7.kind === 'arrow',
            'Q7.7 drag selezione: oggetto arrow UNICO spostato',
            JSON.stringify(after7 && { t: after7.t, k: after7.kind }));
        if (after7 && after7.kind === 'arrow') {
            const dMove = Math.hypot(
                after7.params.head.base[0] - base0[0] - dxW,
                after7.params.head.base[1] - base0[1] - dyW);
            ok(dMove <= 0.5, 'Q7.8 punta traslata insieme all asta (drag world)',
                'dMove=' + dMove.toFixed(4) + ' dxW=' + dxW.toFixed(2) +
                ' dyW=' + dyW.toFixed(2));
            const twb = after7.params.shaft.pts[after7.params.shaft.pts.length - 1];
            const dW2 = Math.hypot(after7.params.head.base[0] - twb[0],
                                   after7.params.head.base[1] - twb[1]);
            ok(dW2 <= 2, 'Q7.9 saldatura punta/asta preservata dopo il drag',
                'd=' + dW2.toFixed(3));
            ok(Math.abs(after7.box.x - box0.x - dxW) <= 1 &&
               Math.abs(after7.box.y - box0.y - dyW) <= 1,
                'Q7.10 box traslato con l oggetto',
                'dx=' + (after7.box.x - box0.x).toFixed(2) +
                ' dy=' + (after7.box.y - box0.y).toFixed(2));
            ok(angBetween(after7.params.head.tangente, tang0) <= 1,
                'Q7.11 tangente invariata nella traslazione',
                'ang=' + angBetween(after7.params.head.tangente, tang0).toFixed(3));
        }
        // scala coerente asta+punta (stesso scaleObj della maniglia lazo)
        const preS = env.win.__ink.objects()[0];
        const Lpre = preS.params.head.lunghezza;
        ok(ink.scaleSelTest(1.5) === true, 'Q7.12 scaleSelTest esposto ed eseguibile');
        const postS = env.win.__ink.objects()[0];
        if (postS && postS.kind === 'arrow') {
            const ratio = postS.params.head.lunghezza / Lpre;
            ok(Math.abs(ratio - 1.5) <= 0.02,
                'Q7.13 punta scalata con l oggetto (ratio 1.5)', 'ratio=' + ratio.toFixed(3));
            const ts7 = postS.params.shaft.pts[postS.params.shaft.pts.length - 1];
            const dS7 = Math.hypot(postS.params.head.base[0] - ts7[0],
                                   postS.params.head.base[1] - ts7[1]);
            ok(dS7 <= 3, 'Q7.14 saldatura preservata dopo scale (<=3px)',
                'd=' + dS7.toFixed(3));
            ok(postS.params.head.angoloAlaDeg === preS.params.head.angoloAlaDeg,
                'Q7.15 angoli ali invariati nella scala uniforme',
                'ala=' + postS.params.head.angoloAlaDeg);
        }

        // palm rejection intatta (F5: i touch restano ignorati con la penna)
        await freshDoc(env);
        ink.setHelp(0.6);
        ptrT(env, cv7, 'pointerdown', 300, 300, 81, 'pen');
        ok(ink.state().pointers === 1, 'Q7.16 penna attiva: 1 solo pointer',
            'n=' + ink.state().pointers);
        ptrT(env, cv7, 'pointerdown', 320, 310, 82, 'touch');
        ok(ink.state().pointers === 1,
            'Q7.17 touch ignorato con penna attiva (palm rejection)',
            'n=' + ink.state().pointers);
        ptrT(env, cv7, 'pointerup', 320, 310, 82, 'touch');
        ptrT(env, cv7, 'pointerup', 300, 300, 81, 'pen');
        await sleep(60);
        ok(!ink.state().active, 'Q7.18 nessun tratto penna rimasto appeso');

        console.log('\nRISULTATO u20_shaping: ' + pass + ' passati, ' + fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO u20_shaping: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
