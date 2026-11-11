'use strict';
/* v1_release_swap.test.js — suite CONTATORI + ZOOM + CLASSI del motore
   ink-commit R31.
   Copre: (1) struttura contatori window.__ink.counters (classified oggetto
   con chiavi ESATTE sort, stroke sub-oggetto, strokes_live, azzero a
   pointerdown), (2) classi/contatori per generatore (line, arc, freeform,
   closed, arrow, short/raw), (3) log console [ink24] / [inkV], (4)
   zoom-invarianza (setZoom 1 / 2.45 / 1), (5) freccia (head 3-4x, wing
   30-40, base==fine asta, M04 undo/redo), (6) assorbimento F01 (positivo,
   negativo durata>=120ms, pending-attach), (7) stress 10 tratti
   indipendenti, (8) finali (total==somma classi, stato API).
   Fonti: web_frontend/html/js/modules/ink_commit.js + notes.js (R31) +
   ink_cfg.js; pattern copiato da qa/_r31_probe.js (37/37).
   Harness: tests/_ink_env.js. Generatori in coordinate MONDO via env0.wc. */
const env0 = require('./_ink_env');
const sleep = env0.sleep;
let pass = 0, fail = 0;
function ok(c, n, extra) {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; console.log('  FAIL  ' + n + (extra ? ' - ' + extra : '')); }
}
function freshDoc(env) { env.store.items[0].content = ''; return env0.openNote(env, 'n1'); }
function strokes(env) { return env.win.__ink.objects().filter(o => o.t === 'stroke'); }
function relOf(ink) { return ink.trace.filter(e => e.k === 'release'); }
function swOf(ink) { return ink.trace.filter(e => e.k === 'swap'); }
function cntSnap(ink) { return JSON.parse(JSON.stringify(ink.counters)); }
function keysSorted(o) { return Object.keys(o || {}).sort(); }
function resetCounters(ink) {
    const c = ink.counters;
    c.classified = { line: 0, arc: 0, freeform: 0, closed: 0, arrow: 0 };
    c.total = 0; c.n_classified = 0; c.refined = 0; c.discarded = 0; c.byKind = {};
    c.strokes_live = 0; c.perfected_on_release = 0;
    c.swapped_pixels = 0; c.residual_px = 0;
    c.stroke = {
        classified: { line: 0, arc: 0, freeform: 0, closed: 0, arrow: 0 },
        total: 0, n_classified: 0, refined: 0, discarded: 0, byKind: {}
    };
}

async function draw(env, pts, opts) {
    opts = opts || {};
    const canvas = env0.canvasOf(env);
    const b = env0.wc(env, pts);
    env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
    for (let i = 1; i < b.length; i++) {
        if (opts.dt) await sleep(opts.dt);
        env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
    }
    env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
}

/* --- generatori (coordinate MONDO) --- */
function wavy(x0, x1, y, amp, wl, step) {
    const out = [];
    for (let x = x0; x <= x1; x += step) out.push([x, y + amp * Math.sin(2 * Math.PI * x / wl)]);
    return out;
}
function sGen(y) {
    const out = [];
    for (let x = 150; x <= 550; x += 4) out.push([x, y + 45 * Math.sin(2 * Math.PI * (x - 150) / 400)]);
    return out;
}
function semiGen(cx, cy) {
    const out = [];
    for (let i = 0; i <= 60; i++) {
        const a = Math.PI * 0.05 + (i / 60) * Math.PI * 0.9;
        out.push([cx + Math.cos(a) * 60 + Math.sin(i / 3) * 1.2,
                  cy + Math.sin(a) * 60 + Math.cos(i / 4) * 1.2]);
    }
    return out;
}
function circGen(cx, cy) {
    const out = [];
    for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        out.push([cx + Math.cos(a) * (45 + Math.sin(i * 2.1) * 3),
                  cy + Math.sin(a) * (45 + Math.cos(i * 1.7) * 3)]);
    }
    return out;
}
/* freccia stile probe V02: retta + flick finale */
function arrowGen() {
    const lineA = [];
    for (let i = 0; i <= 27; i++) lineA.push([150 + i * 10, 250 + Math.sin(i / 6) * 1.2]);
    const endA = lineA[lineA.length - 1];
    return lineA.concat([[endA[0] + 6, endA[1] + 4.5], [endA[0] - 15, endA[1] + 8]]);
}
/* trattino breve (secondo tratto della freccia a due tratti) */
function flickGen(end) {
    return [[end[0] - 30, end[1] + 22], [end[0] - 8, end[1] + 15], [end[0] + 14, end[1] + 9]];
}
function shaftGen() {
    const ln = [];
    for (let i = 0; i <= 30; i++) ln.push([150 + i * 8, 400 + (i % 3) * 0.4]);
    return ln;
}
function redoKey(env) {
    env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
        { key: 'y', ctrlKey: true, bubbles: true }));
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        const c = ink.counters;
        const d = ink.counters;
        let c0 = null;

        // ============ 1. Struttura contatori ============
        ok(!!c && typeof c === 'object' && !Array.isArray(c),
            'C1.0 counters e un oggetto');
        ok(JSON.stringify(keysSorted(c.classified)) ===
           JSON.stringify(['arc', 'arrow', 'closed', 'freeform', 'line']),
            'C1.1 classified: chiavi ESATTE sort (arc,arrow,closed,freeform,line)',
            JSON.stringify(keysSorted(c.classified)));
        ok(Object.keys(c.classified).length === 5,
            'C1.2 classified ha ESATTAMENTE 5 chiavi',
            String(Object.keys(c.classified).length));
        ok(typeof c.total === 'number', 'C1.3 total numerico', typeof c.total);
        ok(typeof c.n_classified === 'number', 'C1.4 n_classified numerico',
            typeof c.n_classified);
        ok(c.strokes_live === 0, 'C1.5 strokes_live===0 a riposo',
            String(c.strokes_live));
        ok(typeof c.perfected_on_release === 'number',
            'C1.6 perfected_on_release numerico', typeof c.perfected_on_release);
        ok(typeof c.swapped_pixels === 'number',
            'C1.7 swapped_pixels numerico', typeof c.swapped_pixels);
        ok(typeof c.residual_px === 'number',
            'C1.8 residual_px numerico', typeof c.residual_px);
        ok(typeof c.refined === 'number' && typeof c.discarded === 'number' &&
           !!c.byKind && typeof c.byKind === 'object',
            'C1.9 refined / discarded / byKind presenti',
            JSON.stringify({ r: typeof c.refined, dd: typeof c.discarded, bk: typeof c.byKind }));
        ok(!!c.stroke && typeof c.stroke === 'object' &&
           JSON.stringify(keysSorted(c.stroke.classified)) ===
           JSON.stringify(['arc', 'arrow', 'closed', 'freeform', 'line']),
            'C1.10 stroke sotto-oggetto con stesse chiavi classe',
            JSON.stringify(c.stroke ? keysSorted(c.stroke.classified) : null));
        // tratto linea con letture tra down e up
        const canvas = env0.canvasOf(env);
        const b = env0.wc(env, wavy(156, 552, 300, 4, 24, 4));
        env0.ptr(env, canvas, 'pointerdown', b[0][0], b[0][1]);
        ok(d.strokes_live === 1, 'C1.11 strokes_live===1 durante un tratto attivo',
            String(d.strokes_live));
        ok(d.stroke.total === 0, 'C1.12 a pointerdown stroke.total torna 0',
            String(d.stroke.total));
        for (let i = 1; i < b.length; i++) {
            env0.ptr(env, canvas, 'pointermove', b[i][0], b[i][1]);
        }
        env0.ptr(env, canvas, 'pointerup', b[b.length - 1][0], b[b.length - 1][1]);
        await sleep(360);
        const sc = d.stroke;
        ok(sc.total === 1, 'C1.13 stroke.total===1 dopo commit linea',
            String(sc.total));
        ok(sc.classified.line === 1, 'C1.14 stroke.classified.line===1',
            String(sc.classified.line));
        ok(sc.refined === 1, 'C1.15 stroke.refined===1', String(sc.refined));
        ok(sc.perfected_on_release === 1,
            'C1.16 stroke.perfected===1 (perfected_on_release)',
            String(sc.perfected_on_release));
        ok(d.classified.line === 1 && d.perfected_on_release === 1,
            'C1.17 sessione: classified.line===1 e perfected===1',
            JSON.stringify({ l: d.classified.line, p: d.perfected_on_release }));
        ok(d.byKind.line === 1, 'C1.18 byKind.line===1', String(d.byKind.line));
        const b2 = env0.wc(env, [[600, 100], [640, 100]]);
        env0.ptr(env, canvas, 'pointerdown', b2[0][0], b2[0][1]);
        ok(d.stroke.total === 0, 'C1.19 stroke.total azzerato al nuovo pointerdown',
            String(d.stroke.total));
        env0.ptr(env, canvas, 'pointerup', b2[0][0], b2[0][1]);
        await sleep(260);

        // ============ 2. Classi/contatori per generatore ============
        // line
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, wavy(156, 552, 300, 4, 24, 4));
        await sleep(50);
        const nRawL = strokes(env)[0].pts.length;
        await sleep(330);
        ok(d.classified.line === c0.classified.line + 1,
            'G1.0 line: classified.line +1',
            String(d.classified.line - c0.classified.line));
        ok(d.total === c0.total + 1, 'G1.1 line: total +1',
            String(d.total - c0.total));
        ok(d.n_classified === c0.n_classified + 1, 'G1.2 line: n_classified +1',
            String(d.n_classified - c0.n_classified));
        ok(d.refined === c0.refined + 1, 'G1.3 line: refined +1',
            String(d.refined - c0.refined));
        ok(d.discarded === c0.discarded, 'G1.4 line: discarded invariato',
            String(d.discarded - c0.discarded));
        ok(d.byKind.line === c0.byKind.line + 1, 'G1.5 line: byKind.line +1',
            String(d.byKind.line - (c0.byKind.line || 0)));
        ok(d.perfected_on_release === c0.perfected_on_release + 1,
            'G1.6 line: perfected +1',
            String(d.perfected_on_release - c0.perfected_on_release));
        ok(d.swapped_pixels - c0.swapped_pixels >= 0.5 * nRawL,
            'G1.7 line: swapped_pixels >= 0.5*nRaw',
            JSON.stringify({ dPx: d.swapped_pixels - c0.swapped_pixels, nRaw: nRawL }));
        ok(d.residual_px <= 0.5, 'G1.8 line: residual_px <=0.5',
            String(d.residual_px));
        // arc (semicerchio)
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, semiGen(400, 300));
        await sleep(360);
        ok(d.classified.arc === c0.classified.arc + 1, 'G2.0 arc: classified.arc +1',
            String(d.classified.arc - c0.classified.arc));
        ok(d.classified.closed === c0.classified.closed, 'G2.1 arc: closed invariato',
            String(d.classified.closed - c0.classified.closed));
        ok(d.residual_px <= 0.5, 'G2.2 arc: residual_px <=0.5', String(d.residual_px));
        // freeform (S con 2 flessi)
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, sGen(350));
        await sleep(360);
        ok(d.classified.freeform === c0.classified.freeform + 1,
            'G3.0 S: classified.freeform +1',
            String(d.classified.freeform - c0.classified.freeform));
        ok(d.residual_px === 0, 'G3.1 S: residual_px===0 dichiarato',
            String(d.residual_px));
        // closed (cerchio chiuso)
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, circGen(400, 350));
        await sleep(360);
        ok(d.classified.closed === c0.classified.closed + 1,
            'G4.0 cerchio: classified.closed +1',
            String(d.classified.closed - c0.classified.closed));
        const sCl = strokes(env);
        ok(sCl.length === 1 && sCl[0].vclass === 'closed',
            'G4.1 cerchio: vclass closed', JSON.stringify(sCl.map(o => o.vclass)));
        // arrow
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, arrowGen());
        await sleep(360);
        ok(d.classified.arrow === c0.classified.arrow + 1,
            'G5.0 arrow: classified.arrow +1',
            String(d.classified.arrow - c0.classified.arrow));
        ok(d.total === c0.total + 1, 'G5.1 arrow: total +1',
            String(d.total - c0.total));
        const sAr = strokes(env);
        ok(sAr.length === 1 && sAr[0].vclass === 'arrow',
            'G5.2 arrow: vclass arrow', JSON.stringify(sAr.map(o => o.vclass)));
        // short / raw (T06)
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, [[200, 200], [210, 202], [216, 204]]);
        await sleep(360);
        ok(d.discarded === c0.discarded + 1, 'G6.0 tratto corto: discarded +1',
            String(d.discarded - c0.discarded));
        ok(JSON.stringify(d.classified) === JSON.stringify(c0.classified),
            'G6.1 tratto corto: classified INVARIATO',
            JSON.stringify({ now: d.classified, before: c0.classified }));
        const sRaw = strokes(env);
        ok(sRaw.length === 1 && (sRaw[0].vclass === undefined || sRaw[0].vclass === null),
            'G6.2 tratto corto resta GREZZO (T06)',
            JSON.stringify(sRaw.map(o => o.vclass)));

        // ============ 3. Log console ============
        await freshDoc(env);
        resetCounters(ink);
        const logs = [];
        const spy = function () {
            logs.push(Array.prototype.map.call(arguments, String).join(' '));
        };
        env.win.console.info = spy;      // jsdom: window realm della module
        console.info = spy;              // fallback Node realm
        await draw(env, wavy(156, 552, 250, 4, 24, 4));
        await sleep(360);   // primo commit -> sessione line:1
        await draw(env, wavy(156, 552, 450, 4, 24, 4));
        // rilascio appena avvenuto: ink24Log stampa i contatori SESSIONE
        const all = logs.join('\n');
        ok(logs.some(l => l.indexOf('[ink24] ') === 0),
            'L1.0 log [ink24] presente dopo il commit',
            JSON.stringify(logs.slice(0, 3)));
        ok(all.indexOf('[inkV] class=line:1') >= 0,
            'L1.1 log [inkV] class=line:1', JSON.stringify(logs.slice(0, 4)));
        ok(all.indexOf('perf=') >= 0, 'L1.2 log con perf=');
        ok(all.indexOf('swapPx=') >= 0, 'L1.3 log con swapPx=');
        ok(all.indexOf('residuo=') >= 0, 'L1.4 log con residuo=');
        await sleep(360);

        // ============ 4. Zoom-invarianza ============
        await freshDoc(env);
        const z1 = ink.setZoom(1);
        ok(typeof z1 === 'number' && Math.abs(z1 - 1) < 0.01,
            'Z1.0 setZoom(1)', String(z1));
        await draw(env, wavy(156, 552, 250, 4, 24, 4));
        await sleep(360);
        let zs = strokes(env);
        const k1 = zs[0] && zs[0].params ? zs[0].params.kind : '-';
        ok(!!zs[0] && zs[0].vclass === 'line' && k1 === 'line',
            'Z1.1 zoom1: onda -> line (kind line)',
            JSON.stringify([zs[0] && zs[0].vclass, k1]));
        await draw(env, sGen(420));
        await sleep(360);
        zs = strokes(env);
        const k2 = zs[1] && zs[1].params ? zs[1].params.kind : '-';
        ok(!!zs[1] && zs[1].vclass === 'freeform' && k2 === 'smooth',
            'Z1.2 zoom1: S -> freeform (kind smooth)',
            JSON.stringify([zs[1] && zs[1].vclass, k2]));
        const z2 = ink.setZoom(2.45);
        ok(typeof z2 === 'number' && Math.abs(z2 - 2.45) < 0.01,
            'Z2.0 setZoom(2.45)', String(z2));
        await draw(env, wavy(156, 552, 250, 4, 24, 4));
        await sleep(360);
        zs = strokes(env);
        const k3 = zs[2] && zs[2].params ? zs[2].params.kind : '-';
        ok(!!zs[2] && zs[2].vclass === 'line' && k3 === 'line',
            'Z2.1 zoom2.45: STESSO esito onda -> line (vclass+kind)',
            JSON.stringify([zs[2] && zs[2].vclass, k3]));
        await draw(env, sGen(420));
        await sleep(360);
        zs = strokes(env);
        const k4 = zs[3] && zs[3].params ? zs[3].params.kind : '-';
        ok(!!zs[3] && zs[3].vclass === 'freeform' && k4 === 'smooth',
            'Z2.2 zoom2.45: STESSO esito S -> freeform (vclass+kind)',
            JSON.stringify([zs[3] && zs[3].vclass, k4]));
        const snapZ = JSON.stringify(ink.objects());
        const z3 = ink.setZoom(1);
        ok(typeof z3 === 'number' && Math.abs(z3 - 1) < 0.01,
            'Z3.0 ritorno setZoom(1)', String(z3));
        ok(JSON.stringify(ink.objects()) === snapZ,
            'Z3.1 setZoom(1) dopo swap: oggetti DEEP-UGUALI (immutati)');
        await draw(env, wavy(156, 552, 250, 4, 24, 4));
        await sleep(360);
        zs = strokes(env);
        const k5 = zs[4] && zs[4].params ? zs[4].params.kind : '-';
        ok(!!zs[4] && zs[4].vclass === 'line' && k5 === 'line',
            'Z4.0 zoom1 di nuovo: onda -> line',
            JSON.stringify([zs[4] && zs[4].vclass, k5]));
        await draw(env, sGen(420));
        await sleep(360);
        zs = strokes(env);
        const k6 = zs[5] && zs[5].params ? zs[5].params.kind : '-';
        ok(!!zs[5] && zs[5].vclass === 'freeform' && k6 === 'smooth',
            'Z4.1 zoom1 di nuovo: S -> freeform',
            JSON.stringify([zs[5] && zs[5].vclass, k6]));

        // ============ 5. Freccia ============
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, arrowGen());
        await sleep(360);
        let sa = strokes(env);
        ok(sa.length === 1 && sa[0].vclass === 'arrow',
            'A1.0 arrow: vclass arrow', JSON.stringify(sa.map(o => o.vclass)));
        const pa = (sa[0] && sa[0].params) || {};
        ok(pa.shaftKind !== undefined, 'A1.1 params.shaftKind presente',
            String(pa.shaftKind));
        ok(!!pa.head, 'A1.2 params.head presente');
        if (pa.head) {
            const sz = sa[0].size || 2;
            ok(pa.head.len >= 3 * sz && pa.head.len <= 4 * sz,
                'A1.3 head.len in [3,4]x size',
                pa.head.len + '/' + sz);
            ok(pa.head.wing >= 30 && pa.head.wing <= 40,
                'A1.4 head.wing in 30-40', String(pa.head.wing));
            const endPt = sa[0].pts[sa[0].pts.length - 1];
            const dBase = Math.hypot(pa.head.base[0] - endPt[0],
                                     pa.head.base[1] - endPt[1]);
            ok(dBase <= 0.05, 'A1.5 head.base == fine asta (<=0.05px)',
                dBase.toFixed(4));
        } else {
            ok(false, 'A1.3 head.len in [3,4]x size', 'no head');
            ok(false, 'A1.4 head.wing in 30-40', 'no head');
            ok(false, 'A1.5 head.base == fine asta (<=0.05px)', 'no head');
        }
        ok(d.classified.arrow === c0.classified.arrow + 1,
            'A1.6 classified.arrow +1',
            String(d.classified.arrow - c0.classified.arrow));
        const preUndo = JSON.stringify(ink.objects());
        env0.undoKey(env, 1);
        await sleep(60);
        ok(ink.objects().length === 0, 'A1.7 M04: 1 undo -> 0 oggetti',
            'n=' + ink.objects().length);
        redoKey(env);
        await sleep(60);
        ok(JSON.stringify(ink.objects()) === preUndo,
            'A1.8 M04: redo -> arrow IDENTICO (deep JSON)');

        // ============ 6. Assorbimento F01 ============
        // Caso A: asta commessa -> secondo tratto breve assorbito
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, shaftGen());
        await sleep(205);
        let sA = strokes(env);
        let guardA = 0;
        while (sA[0] && sA[0]._wet !== undefined && guardA++ < 20) {
            await sleep(10);   // attende lo swap reale (~200ms)
            sA = strokes(env);
        }
        ok(sA.length === 1 && sA[0].vclass === 'line' && sA[0]._wet === undefined,
            'F1.0 asta COMMessa prima dello swap (line, nessun _wet)',
            JSON.stringify(sA.map(o => o.vclass + ':' + o._wet)));
        const eA = sA[0].pts[sA[0].pts.length - 1];
        // tratto istantaneo: rilascio ben entro la finestra flick2Ms=300
        await draw(env, flickGen(eA));
        await sleep(380);
        let sB = strokes(env);
        ok(sB.length === 1 && sB[0].vclass === 'arrow' && !!sB[0].params.head,
            'F1.1 secondo tratto assorbito: UN oggetto arrow (F01/F02/F04)',
            JSON.stringify(sB.map(o => o.vclass)));
        ok(d.classified.arrow === c0.classified.arrow + 1,
            'F1.2 classified.arrow +1 (absorb)',
            String(d.classified.arrow - c0.classified.arrow));
        env0.undoKey(env, 1);
        await sleep(60);
        ok(ink.objects().length === 0, 'F1.3 undo -> 0 oggetti (M04 asta+punta)',
            'n=' + ink.objects().length);
        redoKey(env);
        await sleep(60);
        let sR2 = ink.objects();
        ok(sR2.length === 1 && sR2[0].vclass === 'arrow' && !!sR2[0].params.head,
            'F1.4 redo -> arrow con punta',
            JSON.stringify(sR2.map(o => o.vclass)));
        // Caso NEGATIVO: durata >=120ms -> nessun assorbimento
        await freshDoc(env);
        await draw(env, shaftGen());
        await sleep(240);
        const c1 = cntSnap(ink);   // asta commessa (line +1)
        const eN = strokes(env)[0].pts.slice(-1)[0];
        await draw(env, flickGen(eN), { dt: 70 });   // durata 140ms >= 120
        await sleep(380);
        const sN2 = strokes(env);
        ok(sN2.length === 2, 'F2.0 negativo durata>=120ms: 2 oggetti',
            'n=' + sN2.length);
        ok(d.classified.line === c1.classified.line + 1,
            'F2.1 secondo tratto: classified.line +1',
            String(d.classified.line - c1.classified.line));
        ok(d.classified.arrow === c1.classified.arrow,
            'F2.2 arrow invariato (nessun absorb)',
            String(d.classified.arrow - c1.classified.arrow));
        ok(!!sN2[1] && sN2[1].vclass === 'line',
            'F2.3 secondo oggetto: vclass line',
            JSON.stringify(sN2.map(o => o.vclass)));
        // pending-attach: asta rilasciata e secondo tratto a 80ms
        await freshDoc(env);
        c0 = cntSnap(ink);
        await draw(env, shaftGen());
        await sleep(80);
        ok(ink.state().pending === 1, 'F3.0 asta ancora pendente a 80ms',
            'p=' + ink.state().pending);
        const eP = strokes(env)[0].pts.slice(-1)[0];
        await draw(env, flickGen(eP), { dt: 15 });
        await sleep(380);
        const sP = strokes(env);
        ok(sP.length === 1 && sP[0].vclass === 'arrow' && !!sP[0].params.head,
            'F3.1 pending-attach: alla fine 1 arrow',
            JSON.stringify(sP.map(o => o.vclass)));
        ok(d.classified.arrow === c0.classified.arrow + 1,
            'F3.2 classified.arrow +1 (attach al pendente)',
            String(d.classified.arrow - c0.classified.arrow));

        // ============ 7. Stress / indipendenza: 10 tratti ============
        await freshDoc(env);
        ink.clear();
        c0 = cntSnap(ink);
        const exp = [];
        for (let k = 0; k < 5; k++) {
            await draw(env, wavy(100, 300, 100 + k * 40, 2, 16, 4));
            exp.push('line');
            await sleep(30);
        }
        for (let k = 0; k < 3; k++) {
            await draw(env, sGen(330 + k * 70));
            exp.push('freeform');
            await sleep(30);
        }
        for (let k = 0; k < 2; k++) {
            await draw(env, circGen(420, 320 + k * 160));
            exp.push('closed');
            await sleep(30);
        }
        ok(ink.state().pending >= 4,
            'S7.0 rilasci rapidi: pendings attivi sovrapposti',
            'p=' + ink.state().pending);
        await sleep(540);
        const ss = strokes(env);
        ok(ss.length === 10, 'S7.1 10 oggetti', 'n=' + ss.length);
        const sw10 = swOf(ink);
        ok(sw10.length === 10, 'S7.2 swap trace === 10', 'n=' + sw10.length);
        ok(relOf(ink).length === 10, 'S7.3 release trace === 10',
            'n=' + relOf(ink).length);
        let mono2 = true;
        for (let i = 1; i < sw10.length; i++) if (sw10[i].t < sw10[i - 1].t) mono2 = false;
        ok(mono2, 'S7.4 ordine swap == ordine rilascio (t crescente)',
            JSON.stringify(sw10.map(e => Math.round(e.t))));
        ok(sw10.map(e => e.cls).join(',') === exp.join(','),
            'S7.5 cls swap in sequenza attesa (5 line, 3 freeform, 2 closed)',
            sw10.map(e => e.cls).join(','));
        ok(d.classified.line === c0.classified.line + 5,
            'S7.6 contatori cumulati: line +5',
            String(d.classified.line - c0.classified.line));
        ok(d.classified.freeform === c0.classified.freeform + 3,
            'S7.7 contatori cumulati: freeform +3',
            String(d.classified.freeform - c0.classified.freeform));
        ok(d.classified.closed === c0.classified.closed + 2,
            'S7.8 contatori cumulati: closed +2',
            String(d.classified.closed - c0.classified.closed));
        ok(d.classified.arc === c0.classified.arc,
            'S7.9 contatori cumulati: arc invariato',
            String(d.classified.arc - c0.classified.arc));
        ok(d.strokes_live === 0, 'S7.10 strokes_live===0 al riposo',
            String(d.strokes_live));
        ok(ink.state().pending === 0, 'S7.11 pending===0 al termine',
            'p=' + ink.state().pending);

        // ============ 8. Finali ============
        const sumCls = d.classified.line + d.classified.arc + d.classified.freeform +
                       d.classified.closed + d.classified.arrow;
        ok(d.total === sumCls, 'E1.0 classified.total == somma delle classi',
            JSON.stringify({ total: d.total, sum: sumCls, cls: d.classified }));
        const stf = ink.state();
        const need = ['tool', 'helpOn', 'assist', 'smooth', 'active', 'settleMs',
                      'pending', 'selected', 'lasel', 'zoom', 'dw', 'dh', 'pointers'];
        const miss = need.filter(k => !Object.prototype.hasOwnProperty.call(stf, k));
        ok(miss.length === 0, 'E1.1 state() campi nuovi presenti',
            JSON.stringify(miss));
        const old = ['shpOn', 'arrowOn', 'holdMs', 'releaseRefine', 'ghost', 'ghostFlash'];
        const present = old.filter(k => stf[k] !== undefined);
        ok(present.length === 0, 'E1.2 state() vecchi campi assenti (shpOn/ghost/...)',
            JSON.stringify(present));
        ok(typeof ink.setShaping === 'undefined' &&
           typeof ink.setReleaseRefine === 'undefined',
            'E1.3 setShaping/setReleaseRefine undefined (M01)');
        ok(relOf(ink).length > 0 && swOf(ink).length > 0,
            'E1.4 ink.trace contiene release e swap',
            JSON.stringify({ r: relOf(ink).length, s: swOf(ink).length }));

        console.log('\nRISULTATO v1_release_swap: ' + pass + ' passati, ' + fail + ' falliti');
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO v1_release_swap: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
