'use strict';
/* tests/l14_appunti.test.js - R14 BLOCCO L: latenza scrittura assistita
   (jsdom, meccanismo; le MISURE authoritative di latenza sono nel T2
   qa_browser/qaLA14_appunti.js con p50/p95 reali).
   Copre: (L1) render via rAF del buffer punti; (L2) lag INVARIANTE
   rispetto all'Intensita aiuto (0 vs 100); (L3) convergenza punta
   entro ~2 frame dopo il fermo; snap finale a fine tratto.
   Esecuzione: node tests/l14_appunti.test.js */
'use strict';
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = env0.sleep;

function lastOf(trace, k) {
    for (let i = trace.length - 1; i >= 0; i--) if (trace[i].k === k) return trace[i];
    return null;
}
function lagPx(trace) {
    const e = lastOf(trace, 'evt'), r = lastOf(trace, 'raw');
    if (!e || !r) return null;
    return Math.hypot(e.x - r.x, e.y - r.y);
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!ink, '0.0 API __ink presente');
        ok(!!ink.state() && ink.state().tool === 'penna', '0.1 editor aperto, tool penna');

        // ---- (L2) lag invariante rispetto all'intensita' -----------------
        const pts = [];
        for (let i = 0; i <= 60; i++) {
            pts.push([120 + i * 5, 200 + Math.sin(i / 6) * 6]); // moto uniforme ondulato
        }
        ink.clear();
        ink.setHelp(0);           // intensita' 0 (toggle on)
        await env0.stroke(env, env0.wc(env, pts), { dt: 2, settle: 120 });
        const lag0 = lagPx(ink.trace);

        // stessissimi punti, intensita' 100
        env.store.items[0].content = '';
        await env0.openNote(env, 'n1');
        ink.clear();
        ink.setHelp(1);
        await env0.stroke(env, env0.wc(env, pts), { dt: 2, settle: 120 });
        const lag100 = lagPx(ink.trace);

        ok(lag0 !== null && lag100 !== null, '1.0 tracce complete (evt+raw)',
            'lag0=' + lag0 + ' lag100=' + lag100);
        // PRIMA: lag0=0px, lag100≈45px (misurato T2). DOPO: identico (filtro
        // a parametri fissi, l'Intensita NON entra nel live)
        if (lag0 !== null && lag100 !== null) {
            ok(Math.abs(lag100 - lag0) <= 3,
                '1.1 lag INVARIANTE tra intensita 0 e 100 (<=3px di delta)',
                'lag0=' + lag0.toFixed(2) + ' lag100=' + lag100.toFixed(2));
            ok(lag0 <= 25 && lag100 <= 25,
                '1.2 lag assoluto contenuto (<=25 unita mondo jsdom; T2 browser autoritativo)',
                'lag0=' + lag0.toFixed(2) + ' lag100=' + lag100.toFixed(2));
        }

        // ---- (L3) convergenza punta dopo il fermo (<=2 frame ~40ms) -----
        env.store.items[0].content = '';
        await env0.openNote(env, 'n1');
        ink.clear();
        ink.setHelp(1);
        const pts2 = [];
        for (let i = 0; i <= 40; i++) pts2.push([150 + i * 4, 300 + (i % 5)]);
        const canvas = env0.canvasOf(env);
        const pts2C = env0.wc(env, pts2);
        env0.ptr(env, canvas, 'pointerdown', pts2C[0][0], pts2C[0][1]);
        for (let i = 1; i < pts2C.length; i++) {
            env0.ptr(env, canvas, 'pointermove', pts2C[i][0], pts2C[i][1]);
        }
        // fermo del puntatore (nessun evento) - attesa max 120ms
        const tr = ink.trace;
        const lastRaw = lastOf(tr, 'raw');
        let settle = null;
        for (let w = 0; w < 8 && settle === null; w++) {
            await sleep(20);
            for (const e of tr) {
                if (e.k !== 'paint' || e.t < lastRaw.t) continue;
                if (Math.hypot(e.x - lastRaw.x, e.y - lastRaw.y) <= 2) {
                    settle = e.t - lastRaw.t;
                    break;
                }
            }
        }
        ok(settle !== null && settle <= 40,
            '2.0 punta convergente entro 2 frame dopo il fermo (<=40ms jsdom)',
            'settle=' + settle);
        env0.ptr(env, canvas, 'pointerup', pts2C[pts2C.length - 1][0], pts2C[pts2C.length - 1][1]);
        await sleep(80);

        // ---- (L2 fine tratto) snap finale all'ultimo punto reale ---------
        const objs = ink.objects();
        const last = objs[objs.length - 1];
        const raw = lastOf(ink.trace, 'raw');
        ok(last && last.t === 'stroke' && raw, '3.0 tratto finale presente');
        if (last && raw) {
            const lp = last.pts[last.pts.length - 1];
            // la traccia raw e' gia' in coordinate mondo (cp = toWorld)
            ok(Math.abs(lp[0] - raw.x) <= 1.5 && Math.abs(lp[1] - raw.y) <= 1.5,
                '3.1 ultimo punto == punto REALE (snap di verita a fine tratto)',
                'd=' + Math.hypot(lp[0] - raw.x, lp[1] - raw.y).toFixed(2));
        }

        // ---- (L1) nessun utilizzo di predicted events / buffer+raf ok ----
        ok(ink.trace.some(e => e.k === 'paint'), '4.0 render via rAF (paint registrati)');
        const evN = ink.trace.filter(e => e.k === 'evt').length;
        const rawN = ink.trace.filter(e => e.k === 'raw').length;
        ok(rawN >= evN, '4.1 raw >= evt (punti processati all arrivo)', rawN + '/' + evN);

        console.log('\nRISULTATO l14_appunti: ' + pass + ' passati, ' + fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO l14_appunti: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
