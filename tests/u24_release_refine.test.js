'use strict';
/* tests/u24_release_refine.test.js - R24 FE-INK: nuovo setting
   "perfeziona al rilascio" (ed.releaseRefine, DEFAULT ON, persistito in
   localStorage 'nt24_releaseRefine' accanto a nt14_shaping):
   - default ON + toggle nel popover Aiuto ACCANTO a "Fermo per snap";
   - persistenza OFF/ON (rilettura a buildChrome);
   - OFF  -> hold-still STORICO anche per tratti aperti (ghost al fermo,
             commit al rilascio);
   - ON   -> tratti APERTI in hold NESSUN ghost (il perfezionamento e'
             al rilascio); forme CHIUSE ghost hold-still R20 invariato;
   - contatori window.__ink.counters (sessione) + .stroke (per tratto) e
     console.info '[ink24] classificati=N perfezionati=N scartati=N ...'.
   Pattern deterministico u20/a14/u22: dispatch dt=0, holdMs 900 -> clamp
   800 (Math.min(800,..) in setShaping), hold >=800ms per lo hold-still.
   Esecuzione: node tests/u24_release_refine.test.js */
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

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!ink, '0.0 API __ink presente');

        // spy console.info per i log [ink24] (richiesti da R0/R2)
        const logs = [];
        const origInfo = env.win.console.info;
        env.win.console.info = function () {
            try { logs.push(Array.prototype.map.call(arguments, String).join(' ')); }
            catch (e) { /* noop */ }
            try { if (typeof origInfo === 'function') origInfo.apply(env.win.console, arguments); }
            catch (e) { /* noop */ }
        };

        // ============ 1) default ON + toggle nel popover ============
        const st0 = ink.state();
        ok(st0 && st0.releaseRefine === true, '1.0 default releaseRefine ON',
            JSON.stringify(st0 && st0.releaseRefine));
        const tg = env.doc.getElementById('fn-releaseRefine');
        ok(!!tg, '1.1 toggle #fn-releaseRefine presente nel popover Aiuto');
        ok(!!tg && tg.textContent === 'ON' && tg.getAttribute('aria-pressed') === 'true',
            '1.2 toggle ON di default (aria-pressed)',
            tg ? tg.textContent + '/' + tg.getAttribute('aria-pressed') : 'assente');
        const rows = Array.from(env.doc.querySelectorAll('.fn-slider-row'));
        const iHold = rows.findIndex(r => /Fermo per snap/.test(r.textContent || ''));
        const iRR = rows.findIndex(r => /Perfeziona al rilascio/.test(r.textContent || ''));
        ok(iHold >= 0 && iRR === iHold + 1,
            '1.3 riga "Perfeziona al rilascio" ACCANTO a "Fermo per snap"',
            'hold@' + iHold + ' rr@' + iRR);

        // ============ 2) OFF via toggle + persistenza ============
        tg.click();
        ok(ink.state().releaseRefine === false, '2.0 click toggle -> OFF');
        const rrSaved = JSON.parse(env.win.localStorage.getItem('nt24_releaseRefine') || 'null');
        ok(rrSaved && rrSaved.on === false,
            '2.1 persistito localStorage nt24_releaseRefine {on:false}',
            JSON.stringify(rrSaved));
        const s14 = JSON.parse(env.win.localStorage.getItem('nt14_shaping') || 'null');
        ok(!!s14 && !('releaseRefine' in s14) && !('on' in s14),
            '2.2 nt14_shaping INVIOLATO (chiave r24 separata)',
            JSON.stringify(s14));
        await env0.openNote(env, 'n1');   // riapertura -> buildChrome rilegge
        ok(ink.state().releaseRefine === false, '2.3 OFF sopravvive alla riapertura');
        const tg2 = env.doc.getElementById('fn-releaseRefine');
        ok(!!tg2 && tg2.textContent === 'OFF',
            '2.4 toggle mostra OFF dopo riapertura',
            tg2 ? tg2.textContent : 'assente');

        // ==== 3) OFF -> hold-still STORICO anche per tratti APERTI ====
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);   // -> holdMs clamp 800
        ink.setReleaseRefine(false);
        const st3 = ink.state();
        ok(st3.holdMs === 800 && st3.releaseRefine === false,
            '3.0 precondizioni OFF + holdMs 900 -> clamp 800',
            JSON.stringify({ h: st3.holdMs, r: st3.releaseRefine }));
        let c0 = snap(ink.counters);
        const lineC = [];
        for (let i = 0; i <= 40; i++) {
            lineC.push([200 + i * 3 + ((i % 3) - 1) * 0.8, 250 + i * 0.4]);
        }
        let canvas = env0.canvasOf(env);
        let bC = env0.wc(env, lineC);
        env0.ptr(env, canvas, 'pointerdown', bC[0][0], bC[0][1]);
        for (let i = 1; i < bC.length; i++) {
            env0.ptr(env, canvas, 'pointermove', bC[i][0], bC[i][1]);
        }
        await sleep(950);   // dt=0 dispatch + quiete >= hold-still 800ms
        ok(ink.state().ghost === true,
            '3.1 OFF: tratto APERTO in hold -> GHOST (hold-still storico)',
            'ghost=' + ink.state().ghost);
        env0.ptr(env, canvas, 'pointerup', bC[bC.length - 1][0], bC[bC.length - 1][1]);
        await sleep(150);
        ok(ink.state().ghost === false, '3.2 ghost consumata al rilascio');
        let sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line' && strokes(env).length === 0,
            '3.3 OFF: rilascio commetta segmento ideale (line)',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        ok(ink.counters.stroke.total === 1 && ink.counters.stroke.refined === 1 &&
           ink.counters.stroke.discarded === 0,
            '3.4 contatori TRATTO: classificati=1 perfezionati=1 scartati=0',
            JSON.stringify(ink.counters.stroke));
        ok(ink.counters.refined === c0.refined + 1 &&
           ink.counters.total === c0.total + 1,
            '3.5 contatori SESSIONE +1 (cumulati; .total ex .classified)',
            JSON.stringify({ prima: c0, dopo: ink.counters }));
        ok(logs.some(l => /\[ink24\] classificati=1 perfezionati=1 scartati=0/.test(l)),
            '3.6 console.info [ink24] emesso al rilascio',
            JSON.stringify(logs.slice(-2)));

        // ==== 4) ON -> NESSUN ghost per aperti; refined al rilascio ====
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);
        ink.setReleaseRefine(true);
        ok(ink.state().releaseRefine === true, '4.0 ON ristabilito (e persistito)');
        c0 = snap(ink.counters);
        canvas = env0.canvasOf(env);
        bC = env0.wc(env, lineC);
        env0.ptr(env, canvas, 'pointerdown', bC[0][0], bC[0][1]);
        for (let i = 1; i < bC.length; i++) {
            env0.ptr(env, canvas, 'pointermove', bC[i][0], bC[i][1]);
        }
        await sleep(950);
        ok(ink.state().ghost === false && ink.state().active === true,
            '4.1 ON: tratto APERTO in hold -> NESSUN ghost (perfeziona al rilascio)',
            'ghost=' + ink.state().ghost + ' active=' + ink.state().active);
        env0.ptr(env, canvas, 'pointerup', bC[bC.length - 1][0], bC[bC.length - 1][1]);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line' && strokes(env).length === 0,
            '4.2 ON: al RILASCIO -> segmento ideale (line)',
            JSON.stringify(sh.map(s => s.kind)) + ' strokes=' + strokes(env).length);
        if (sh[0] && sh[0].kind === 'line' && sh[0].pts.length === 2) {
            const a = sh[0].pts[0], b = sh[0].pts[1];
            const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
            let m = 0;
            for (const q of sh[0].pts) {
                m = Math.max(m, Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L);
            }
            ok(m <= 0.5, '4.3 residuo punti renderizzati vs segmento ideale <=0.5px',
                'res=' + m.toFixed(4));
        }
        ok(ink.counters.stroke.total === 1 && ink.counters.stroke.refined === 1,
            '4.4 ON: contatori tratto perfezionati=1',
            JSON.stringify(ink.counters.stroke));
        ok(ink.counters.refined === c0.refined + 1, '4.5 ON: sessione refined +1',
            JSON.stringify({ prima: c0.refined, dopo: ink.counters.refined }));
        ok(logs.some(l => /\[ink24\] classificati=1 perfezionati=1 scartati=0/.test(l)),
            '4.6 console.info [ink24] anche con ON');

        // ==== 5) ON -> forme CHIUSE: ghost hold-still R20 invariato ====
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);
        ink.setReleaseRefine(true);
        canvas = env0.canvasOf(env);
        const circ = [];
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            circ.push([400 + Math.cos(a) * 45, 300 + Math.sin(a) * 45]);
        }
        let bE = env0.wc(env, circ);
        env0.ptr(env, canvas, 'pointerdown', bE[0][0], bE[0][1]);
        for (let i = 1; i < bE.length; i++) {
            env0.ptr(env, canvas, 'pointermove', bE[i][0], bE[i][1]);
        }
        await sleep(950);
        ok(ink.state().ghost === true,
            '5.0 ON: forma CHIUSA in hold -> ghost (R20 invariato)',
            'ghost=' + ink.state().ghost);
        env0.ptr(env, canvas, 'pointerup', bE[bE.length - 1][0], bE[bE.length - 1][1]);
        await sleep(150);
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'circle',
            '5.1 ON: rilascio commetta circle dal ghost',
            JSON.stringify(sh.map(s => s.kind)));

        // ==== 6) scarabocchio -> scartati=1, resta stroke ====
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 900);
        ink.setReleaseRefine(true);
        c0 = snap(ink.counters);
        const scrib = [];
        for (let row = 0; row < 8; row++) {
            const y = 300 + row * 16;
            if (row % 2 === 0) {
                for (let x = 0; x <= 220; x += 10) scrib.push([150 + x, y]);
            } else {
                for (let x = 220; x >= 0; x -= 10) scrib.push([150 + x, y]);
            }
        }
        await env0.stroke(env, env0.wc(env, scrib));
        ok(shapes(env).length === 0 && strokes(env).length === 1,
            '6.0 scarabocchio resta stroke',
            JSON.stringify(shapes(env).map(s => s.kind)) +
            ' strokes=' + strokes(env).length);
        ok(ink.counters.stroke.discarded === 1 && ink.counters.stroke.refined === 0,
            '6.1 contatori tratto: scartati=1 perfezionati=0',
            JSON.stringify(ink.counters.stroke));
        ok(ink.counters.discarded === c0.discarded + 1,
            '6.2 sessione discarded +1', 'd=' + ink.counters.discarded);
        ok(logs.some(l => /\[ink24\] classificati=0 perfezionati=0 scartati=1/.test(l)),
            '6.3 console.info [ink24] con scartati=1',
            JSON.stringify(logs.slice(-2)));

        // ============ 7) riepilogo contatori di sessione ============
        ok(ink.counters.total >= 3 && ink.counters.refined >= 3 &&
           ink.counters.discarded >= 1,
            '7.0 contatori sessione cumulati (>=3 classificati, >=1 scartato)',
            JSON.stringify(ink.counters));
        ok(ink.counters.byKind && ink.counters.byKind.line >= 2 &&
           ink.counters.byKind.circle >= 1,
            '7.1 byKind per esito classificazione (line>=2, circle>=1)',
            JSON.stringify(ink.counters.byKind));
        // R25: i log sono [ink24] (invariato, backward-compat) + la riga
        // NUOVA [inkV] con class/perf/swapPx/residuo
        ok(logs.length > 0 &&
           logs.every(l => /^\[ink24\] /.test(l) || /^\[inkV\] /.test(l)),
            '7.2 tutti i log catturati hanno prefisso [ink24] o [inkV]',
            JSON.stringify(logs.length));

        console.log('\nRISULTATO u24_release_refine: ' + pass + ' passati, ' +
            fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO u24_release_refine: ' + pass + ' passati, ' +
            (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
