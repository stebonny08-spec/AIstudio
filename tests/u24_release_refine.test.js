'use strict';
/* u24_release_refine.test.js — suite LIFECYCLE del motore ink-commit R31.
   Copre: K01 (rilascio -> tratto GREZZO invariato per settleMs),
   K02 (UNO swap discreto, stati solo grezzo/ideale, dt 150-320),
   K03 (post-commit: punti renderizzati == modello, grezzo non renderizzato),
   K04 (5 pendings indipendenti + classi miste), N03 (rilascio istantaneo),
   N06 (hold 500ms senza ghost/commit), MOMENTO assist (classificazione
   indipendente dall intensita), BONUS (undo/redo durante settle, flush del
   save M05, settleMs, wet tail L02/L04).
   Fonti: web_frontend/html/js/modules/ink_commit.js + notes.js (R31) +
   ink_cfg.js; pattern copiato da qa/_r31_probe.js (37/37).
   Harness: tests/_ink_env.js (makeEnv/openNote/canvasOf/ptr/wc/...).
   Generatori in coordinate MONDO (conv. cliente via env0.wc). */
const env0 = require('./_ink_env');
const sleep = env0.sleep;
let pass = 0, fail = 0;
function ok(c, n, extra) {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; console.log('  FAIL  ' + n + (extra ? ' - ' + extra : '')); }
}
function freshDoc(env) { env.store.items[0].content = ''; return env0.openNote(env, 'n1'); }
function strokes(env) { return env.win.__ink.objects().filter(o => o.t === 'stroke'); }
function wnow(env) { return env.win.performance.now(); }
function relOf(ink) { return ink.trace.filter(e => e.k === 'release'); }
function swOf(ink) { return ink.trace.filter(e => e.k === 'swap'); }

/* tratto in coordinate MONDO; opts.dt = pausa tra i move (ms) */
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

/* --- geometria --- */
function dPtSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function maxDevFromPoly(pts, poly) {
    let m = 0;
    for (const p of pts) {
        let d = Infinity;
        for (let i = 0; i < poly.length - 1; i++) {
            const dd = dPtSeg(p, poly[i], poly[i + 1]);
            if (dd < d) d = dd;
        }
        if (d > m) m = d;
    }
    return m;
}
/* stato osservato di un oggetto in finestra: SOLO grezzo o ideale */
function stateOf(o) {
    if (!o) return 'missing';
    if (o.vclass === undefined && o._wet === true) return 'grezzo';
    if (o.vclass !== undefined && o._wet === undefined) return 'ideale';
    return 'ibrido';
}
function savedObjects(env) {
    try {
        const d = JSON.parse(env.store.items[0].content);
        if (d && Array.isArray(d.pages) && d.pages.length) {
            const pg = d.pages[typeof d.page === 'number' ? d.page : 0];
            return (pg && Array.isArray(pg.objects)) ? pg.objects : null;
        }
        return (d && Array.isArray(d.objects)) ? d.objects : null;
    } catch (e) { return null; }
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;

        // ================= K01: rilascio -> grezzo invariato =================
        ink.clear();
        await draw(env, wavy(156, 552, 250, 4, 24, 4));
        const t0 = wnow(env);
        let so = strokes(env);
        ok(so.length === 1, 'K01.0 rilascio: UN oggetto nel doc', 'n=' + so.length);
        ok(!!so[0] && so[0]._wet === true, 'K01.1 _wet true al rilascio (L02)',
            so[0] ? String(so[0]._wet) : 'missing');
        ok(!!so[0] && so[0].vclass === undefined && !so[0].params,
            'K01.2 grezzo: nessuna classe e nessun params',
            so[0] ? JSON.stringify({ v: so[0].vclass, p: !!so[0].params }) : '-');
        const nRaw = so[0].pts.length;
        const snap0 = JSON.stringify(so[0].pts);
        ok(relOf(ink).length === 1, 'K01.3 trace release presente',
            'n=' + relOf(ink).length);
        ok(swOf(ink).length === 0, 'K01.4 NESSUNO swap durante settle',
            'n=' + swOf(ink).length);
        ok(ink.state().pending === 1, 'K01.5 state().pending===1',
            'p=' + ink.state().pending);
        async function at(ms) {
            const d = ms - (wnow(env) - t0);
            if (d > 0) await sleep(d);
        }
        await at(40);
        so = strokes(env);
        const snapA = JSON.stringify(so[0].pts);
        ok(snapA === snap0 && so[0]._wet === true,
            'K01.6 campione 40ms: pts IDENTICI allo snapshot (nessun morphing)',
            'n=' + (so[0].pts ? so[0].pts.length : -1) + ' vs nRaw=' + nRaw);
        await at(90);
        so = strokes(env);
        const snapB = JSON.stringify(so[0].pts);
        ok(snapB === snap0 && snapB === snapA && so[0].vclass === undefined,
            'K01.7 campione 90ms: ancora IDENTICO (tutti i campioni uguali)');

        // ================= K02: intorno allo swap =================
        await at(150);
        const o150 = strokes(env)[0];
        ok(stateOf(o150) === 'grezzo' && o150.pts.length === nRaw,
            'K02.0 a 150ms: ancora GREZZO (n==nRaw)',
            JSON.stringify({ s: stateOf(o150), n: o150.pts.length, nRaw: nRaw }));
        await at(190);
        const o190 = strokes(env)[0];
        ok(stateOf(o190) === 'grezzo' && o190.pts.length === nRaw,
            'K02.1 a 190ms: ancora GREZZO (entro settleMs=200)',
            JSON.stringify({ s: stateOf(o190), n: o190.pts.length }));
        await at(220);
        const o220 = strokes(env)[0];
        await at(260);
        const o260 = strokes(env)[0];
        // tutti i campioni devono essere SOLO grezzo o ideale, MAI ibrido
        const samples = [
            { t: 150, o: o150 }, { t: 190, o: o190 },
            { t: 220, o: o220 }, { t: 260, o: o260 }
        ];
        let hybrid = null;
        for (const s of samples) {
            const st = stateOf(s.o);
            const n = s.o ? s.o.pts.length : -1;
            if (st === 'ibrido' || st === 'missing' || (n !== nRaw && n !== 2)) {
                hybrid = { t: s.t, st: st, n: n };
                break;
            }
        }
        ok(!hybrid, 'K02.2 stati SOLO {grezzo,ideale}, mai ibrido (n==nRaw OR n==2)',
            hybrid ? JSON.stringify(hybrid) : 'ok');
        ok(!!o260 && stateOf(o260) === 'ideale',
            'K02.3 a 260ms: swap avvenuto (ideale)',
            o260 ? JSON.stringify({ s: stateOf(o260), n: o260.pts.length, v: o260.vclass }) : '-');
        const sws = swOf(ink);
        ok(sws.length === 1 && sws[0].dt >= 150 && sws[0].dt <= 320,
            'K02.4 ESATTAMENTE 1 swap con dt in 150-320', JSON.stringify(sws));
        ok(!!o260 && o260._wet === undefined,
            'K02.5 _wet rimosso dopo lo swap', String(o260 && o260._wet));
        ok(ink.state().pending === 0, 'K02.6 pending torna a 0',
            'p=' + ink.state().pending);
        ok(!!sws[0] && sws[0].cls === 'line', 'K02.7 swap cls=line',
            sws[0] ? sws[0].cls : '-');

        // ============ K03: post-commit punti renderizzati == modello ============
        await freshDoc(env);
        ink.clear();
        await draw(env, wavy(156, 552, 300, 4, 24, 4));
        await sleep(50);   // ancora in finestra: catturo il grezzo
        const rawLine = strokes(env)[0].pts.map(p => [p[0], p[1]]);
        await sleep(350);
        const sl = strokes(env);
        ok(sl.length === 1 && sl[0].vclass === 'line' && sl[0].pts.length === 2,
            'K03.0 linea commessa: vclass line + 2 pts',
            JSON.stringify(sl.map(o => o.vclass + ':' + (o.pts || []).length)));
        const L = sl[0];
        ok(!!L.params && L.params.kind === 'line' &&
           JSON.stringify(L.params.p0) === JSON.stringify(L.pts[0]) &&
           JSON.stringify(L.params.p1) === JSON.stringify(L.pts[1]),
            'K03.1 (params.p0, params.p1) == pts (deep)',
            JSON.stringify({ p0: L.params && L.params.p0, pts: L.pts }));
        let mxSeg = 0;
        for (const p of L.pts) {
            const dd = dPtSeg(p, L.params.p0, L.params.p1);
            if (dd > mxSeg) mxSeg = dd;
        }
        ok(mxSeg <= 0.05, 'K03.2 ogni pt renderizzato sulla segmento <=0.05',
            mxSeg.toFixed(4));
        const devRaw = maxDevFromPoly(rawLine, L.pts);
        ok(devRaw > 1,
            'K03.3 il grezzo NON e piu renderizzato (dev raw->render >1px su onda 4px)',
            'dev=' + devRaw.toFixed(2));
        await freshDoc(env);
        await draw(env, semiGen(400, 300));
        await sleep(360);
        const sc = strokes(env);
        ok(sc.length === 1 && sc[0].vclass === 'arc' &&
           !!sc[0].params && sc[0].params.kind === 'circle',
            'K03.4 semicerchio -> arc (kind circle)',
            JSON.stringify(sc.map(o => o.vclass + '/' + (o.params ? o.params.kind : '-'))));
        if (sc[0] && sc[0].params && sc[0].params.kind === 'circle') {
            const p = sc[0].params;
            let mr = 0;
            for (const q of sc[0].pts) {
                const dd = Math.abs(Math.hypot(q[0] - p.cx, q[1] - p.cy) - p.r);
                if (dd > mr) mr = dd;
            }
            ok(mr <= 0.5, 'K03.5 circle: radial punti render vs modello <=0.5',
                mr.toFixed(4));
        } else {
            ok(false, 'K03.5 circle: radial punti render vs modello <=0.5', 'no circle');
        }

        // ======= K04: 5 tratti a 25ms -> pendings indipendenti =======
        await freshDoc(env);
        ink.clear();
        for (let k = 0; k < 5; k++) {
            await draw(env, wavy(100, 300, 120 + k * 55, 2, 16, 8));
            if (k < 4) await sleep(25);
        }
        const pend5 = ink.state().pending;
        ok(pend5 === 5, 'K04.0 5 rilasci a 25ms: 5 pendings SOVRAPPOSTI',
            'p=' + pend5);
        await sleep(520);
        const s5 = strokes(env);
        ok(s5.length === 5, 'K04.1 5 oggetti commessi', 'n=' + s5.length);
        const rel5 = relOf(ink), sw5 = swOf(ink);
        ok(rel5.length === 5, 'K04.2 5 trace release', 'n=' + rel5.length);
        ok(sw5.length === 5, 'K04.3 ESATTAMENTE 5 trace swap', 'n=' + sw5.length);
        let mono = true;
        for (let i = 1; i < sw5.length; i++) if (sw5[i].t < sw5[i - 1].t) mono = false;
        ok(mono, 'K04.4 ordine swap == ordine rilascio (t crescente)',
            JSON.stringify(sw5.map(e => Math.round(e.t))));
        const relCls = rel5.map(e => e.cls).join(',');
        const swCls = sw5.map(e => e.cls).join(',');
        ok(relCls === 'line,line,line,line,line' && swCls === relCls,
            'K04.5 cls swap == cls release (seq identica)', relCls + ' | ' + swCls);
        ok(s5.every(o => o.vclass === 'line' && o._wet === undefined),
            'K04.6 tutti commessi (vclass line, nessun _wet)',
            JSON.stringify(s5.map(o => o.vclass + ':' + o._wet)));
        ok(ink.state().pending === 0, 'K04.7 pending 0 al termine',
            'p=' + ink.state().pending);
        // 3 tratti con geometrie miste -> classi rispettive indipendenti
        await freshDoc(env);
        ink.clear();
        await draw(env, wavy(150, 450, 200, 3, 20, 4));
        await sleep(30);
        await draw(env, sGen(350));
        await sleep(30);
        await draw(env, circGen(400, 500));
        await sleep(460);
        const sm = strokes(env);
        ok(sm.length === 3 && sm.map(o => o.vclass).join(',') === 'line,freeform,closed',
            'K04.8 3 classi indipendenti (line,freeform,closed)',
            JSON.stringify(sm.map(o => o.vclass)));
        const swM = swOf(ink);
        ok(swM.length === 3 && swM.map(e => e.cls).join(',') === 'line,freeform,closed',
            'K04.9 swap seq == classi attese',
            swM.map(e => e.cls).join(','));
        ok(relOf(ink).map(e => e.cls).join(',') === 'line,freeform,closed',
            'K04.10 release seq == classi attese',
            relOf(ink).map(e => e.cls).join(','));

        // ================= N03: rilascio ISTANTANEO =================
        await freshDoc(env);
        ink.clear();
        await draw(env, wavy(100, 400, 520, 2, 20, 5));   // nessuna pausa
        await sleep(350);
        const sw3 = swOf(ink);
        ok(sw3.length === 1 && sw3[0].dt >= 150,
            'N03.0 rilascio istantaneo: swap comunque con dt>=150',
            JSON.stringify(sw3));
        ok(!!sw3[0] && sw3[0].dt <= 320, 'N03.1 dt entro 320ms',
            sw3.length ? String(sw3[0].dt) : 'none');
        const sN = strokes(env);
        ok(sN.length === 1 && sN[0].vclass !== undefined && sN[0]._wet === undefined,
            'N03.2 tratto istantaneo COMMESSO (nessun _wet)',
            JSON.stringify(sN.map(o => o.vclass + ':' + o._wet)));

        // ======= N06: 500ms di hold col tratto vivo =======
        await freshDoc(env);
        ink.clear();
        const canvasH = env0.canvasOf(env);
        const bh = env0.wc(env, wavy(120, 320, 260, 3, 20, 8));
        env0.ptr(env, canvasH, 'pointerdown', bh[0][0], bh[0][1]);
        for (let i = 1; i < bh.length; i++) {
            await sleep(25);
            env0.ptr(env, canvasH, 'pointermove', bh[i][0], bh[i][1]);
        }
        await sleep(500);   // HOLD: nessun pointerup
        ok(strokes(env).length === 0, 'N06.0 hold 500ms: oggetti doc VUOTI',
            'n=' + strokes(env).length);
        ok(relOf(ink).length === 0 && swOf(ink).length === 0,
            'N06.1 NESSUN trace release/swap durante l hold',
            'r=' + relOf(ink).length + ' s=' + swOf(ink).length);
        ok(ink.state().ghost === undefined, 'N06.2 state().ghost undefined',
            String(ink.state().ghost));
        ok(ink.state().active === true, 'N06.3 tratto ancora attivo durante l hold',
            String(ink.state().active));
        env0.ptr(env, canvasH, 'pointerup', bh[bh.length - 1][0], bh[bh.length - 1][1]);
        await sleep(350);
        const swH = swOf(ink);
        ok(swH.length === 1 && swH[0].dt >= 150 && swH[0].dt <= 320,
            'N06.4 dopo l hold: swap normale (dt 150-320)', JSON.stringify(swH));
        const sH = strokes(env);
        ok(sH.length === 1 && sH[0].vclass === 'line' && sH[0]._wet === undefined,
            'N06.5 tratto commesso dopo l hold',
            JSON.stringify(sH.map(o => o.vclass + ':' + o._wet)));

        // ======= MOMENTO assist: classificazione NON dipende dall intensita =======
        await freshDoc(env);
        ink.setHelp(0);
        ok(ink.state().assist === 0, 'MOM.0 setHelp(0) -> state().assist===0',
            String(ink.state().assist));
        await draw(env, wavy(156, 552, 250, 4, 24, 4));
        await sleep(360);
        const mA = strokes(env);
        ink.setHelp(1);
        ok(ink.state().assist === 1, 'MOM.1 setHelp(1) -> state().assist===1',
            String(ink.state().assist));
        await draw(env, wavy(156, 552, 420, 4, 24, 4));
        await sleep(360);
        const mB = strokes(env);
        ok(mA.length === 1 && mB.length === 2 &&
           mA[0].vclass === 'line' && mB[1].vclass === mA[0].vclass,
            'MOM.2 assist 0 e 1 -> swap IDENTICO, stessa classe (line)',
            JSON.stringify([mA[0] && mA[0].vclass, mB[1] && mB[1].vclass]));
        // live trace raw/evt/paint durante il drag (assist accesa)
        ink.clear();
        const cLive = env0.canvasOf(env);
        const bl = env0.wc(env, wavy(156, 456, 520, 4, 24, 8));
        env0.ptr(env, cLive, 'pointerdown', bl[0][0], bl[0][1]);
        for (let i = 1; i < bl.length; i++) {
            await sleep(25);
            env0.ptr(env, cLive, 'pointermove', bl[i][0], bl[i][1]);
        }
        await env0.flushRaf(env, 4);
        const ks = ink.trace.map(e => e.k);
        ok(ks.indexOf('raw') >= 0 && ks.indexOf('evt') >= 0 && ks.indexOf('paint') >= 0,
            'MOM.3 live trace raw/evt/paint presenti durante il drag',
            JSON.stringify(ks.slice(0, 14)));
        env0.ptr(env, cLive, 'pointerup', bl[bl.length - 1][0], bl[bl.length - 1][1]);
        await sleep(360);

        // ================= BONUS =================
        // 1) undo durante settle -> 0 oggetti, pending0, redo ripristina
        await freshDoc(env);
        ink.clear();
        await draw(env, wavy(156, 552, 300, 4, 24, 4));
        await sleep(100);   // ancora in finestra di settle
        ok(ink.state().pending === 1 && !!strokes(env)[0] && strokes(env)[0]._wet === true,
            'BON.0 durante settle: pending 1 + _wet presente',
            'p=' + ink.state().pending);
        env0.undoKey(env, 1);
        await sleep(60);
        ok(ink.objects().length === 0, 'BON.1 undo durante settle -> 0 oggetti',
            'n=' + ink.objects().length);
        await sleep(400);
        ok(ink.state().pending === 0, 'BON.2 pending 0 dopo 400ms (commit annullato)',
            'p=' + ink.state().pending);
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'y', ctrlKey: true, bubbles: true }));
        await sleep(60);
        const sR = ink.objects();
        ok(sR.length === 1 && sR[0].t === 'stroke' && sR[0].vclass === 'line' &&
           sR[0]._wet === undefined && sR[0].pts.length === 2,
            'BON.3 redo ripristina il tratto COMMESSO (deep)',
            JSON.stringify(sR.map(o => o.vclass + ':' + (o.pts || []).length)));
        // 2) flush su save (M05): il salvataggio materializza i pendings
        await freshDoc(env);
        await draw(env, wavy(156, 552, 350, 4, 24, 4));
        await sleep(80);
        ok(ink.state().pending === 1, 'BON.4 rilascio+80ms: pendente ancora attivo',
            'p=' + ink.state().pending);
        await sleep(1400);   // debounce save 900ms (+commit 200ms)
        const so2 = savedObjects(env);
        ok(!!so2 && so2.length === 1 && so2[0].vclass === 'line' &&
           so2[0]._wet === undefined && so2[0].pts.length === 2,
            'BON.5 oggetto gia COMMITTITO nel salvato (M05 buildPayload/flush)',
            JSON.stringify(so2 ? so2.map(o => o.vclass + ':' + (o.pts || []).length) : so2));
        await env0.openNote(env, 'n1');
        const sRe = strokes(env);
        ok(sRe.length === 1 && sRe[0].vclass === 'line' && sRe[0]._wet === undefined,
            'BON.6 riapertura nota: oggetto commesso caricato dal salvato',
            JSON.stringify(sRe.map(o => o.vclass + ':' + o._wet)));
        // 3) settleMs dentro 150-300 (K01)
        const stx = ink.state();
        ok(typeof stx.settleMs === 'number' && stx.settleMs >= 150 && stx.settleMs <= 300,
            'BON.7 state().settleMs in 150-300', String(stx.settleMs));
        // 4) wet tail: _wet al rilascio, assente dopo lo swap (L02/L04)
        await freshDoc(env);
        await draw(env, wavy(156, 552, 420, 4, 24, 4));
        const oWet = strokes(env)[0];
        ok(!!oWet && oWet._wet === true, 'BON.8 coda bagnata presente al rilascio (L02)',
            oWet ? String(oWet._wet) : 'missing');
        await sleep(360);
        const oDry = strokes(env)[0];
        ok(!!oDry && oDry._wet === undefined, 'BON.9 coda bagnata sparita allo swap (L04)',
            oDry ? String(oDry._wet) : 'missing');

        console.log('\nRISULTATO u24_release_refine: ' + pass + ' passati, ' + fail + ' falliti');
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO u24_release_refine: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
