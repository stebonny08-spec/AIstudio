/* ============================================================
   tests/testG7_fe.test.js — G7 vista "Statistiche AI" (jsdom).
   Pattern: tests/aiUi_smoke.test.js (JSDOM + readyState=loading).
   Verifica:
   * monta app.js + statistiche.js -> renderHome genera esattamente
     8 .home-card e 8 button (NESSUNA 9a card, qaD_home invariato);
   * link discreto .dev-link presente (NON .home-card, NON button);
   * click link -> App.go('statistiche') con tabella >= 8 righe;
   * window.StatsAI.pushRound aggiunge la colonna del round successivo;
   * delta colorate (.stats-better/.stats-worse) e zero console error.
   Eseguire con: node tests/testG7_fe.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_APP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'app.js'), 'utf8');
const SRC_STATS = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'statistiche.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}

function makeEnv() {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><main id="welcomeView"></main></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window, doc = win.document;
    win.alert = () => { }; win.confirm = () => false; win.prompt = () => null;
    // boot differito (pattern aiUi_smoke): dispatch manuale di DOMContentLoaded
    try {
        Object.defineProperty(win.Document.prototype, 'readyState', {
            configurable: true, get: function () { return 'loading'; }
        });
    } catch (e) { consoleErrors.push('override readyState: ' + e); }
    let appErr = '';
    try { win.eval(SRC_APP); } catch (e) { appErr = String(e && e.message ? e.message : e); }
    try { win.eval(SRC_STATS); } catch (e) { appErr += ' | stats: ' + String(e && e.message ? e.message : e); }
    return { dom, win, doc, consoleErrors, appErr };
}

function main() {
    console.log('\n== G7 FE: vista Statistiche AI (jsdom) ==');
    const env = makeEnv();
    ok(!env.appErr, 'eval app.js + statistiche.js senza eccezioni', env.appErr);
    const App = env.win && env.win.App;
    ok(!!App, 'window.App definito');
    if (!App) {
        finish(env);
        return;
    }
    ok(Array.isArray(App.ORDER) && App.ORDER.indexOf('statistiche') < 0,
        'statistiche NON in App.ORDER (nessuna 9a card dalla home)');

    // moduli stub (come qaD_home) + API runtime
    ['chatbot', 'notes', 'schemi', 'produttivita', 'ripasso', 'biblioteca', 'calendario'].forEach(id => {
        App.registerModule({ id: id, title: 'Mod ' + id, desc: 'desc ' + id });
    });
    ok(!!env.win.StatsAI && typeof env.win.StatsAI.pushRound === 'function',
        'window.StatsAI.pushRound esposto');

    // boot manuale (readyState forzato a "loading")
    try { env.doc.dispatchEvent(new env.win.Event('DOMContentLoaded')); }
    catch (e) { ok(false, 'dispatch DOMContentLoaded', String(e)); }
    try { App.go('home'); } catch (e) { ok(false, 'App.go(home)', String(e && e.message)); }

    const homeView = env.doc.getElementById('homeView');
    ok(!!homeView, 'homeView creata da boot()');
    if (homeView) {
        const cards = homeView.querySelectorAll('.home-card');
        ok(cards.length === 8, 'esattamente 8 .home-card (nessuna 9a)', 'ottenute ' + cards.length);
        const btns = homeView.querySelectorAll('button');
        ok(btns.length === 8, 'nessun 9o button nel homeView', 'ottenuti ' + btns.length);

        const dev = homeView.querySelector('.dev-link');
        ok(!!dev, 'link discreto .dev-link presente sotto la griglia');
        ok(!!dev && !dev.classList.contains('home-card'), 'dev-link NON ha classe home-card');
        ok(!!dev && (dev.textContent || '').indexOf('Statistiche AI') >= 0,
            'dev-link con testo "Statistiche AI"', dev ? dev.textContent : 'assente');
        ok(!!dev && !!dev.querySelector('a'), 'dev-link usa una <a> (non un button)');
        ok(!!dev && (!dev.closest || !dev.closest('.home-grid')),
            'dev-link fuori dalla .home-grid');
        ok(env.consoleErrors.length === 0, 'zero console error dopo renderHome',
            env.consoleErrors.join(' | '));

        // click -> apre il modulo statistiche
        if (dev) {
            dev.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        ok(App.current === 'statistiche', 'click dev-link -> modulo statistiche aperto',
            'current=' + App.current);
        ok(env.doc.body.className.indexOf('view-module') >= 0,
            'body in view-module', env.doc.body.className);

        const mv = env.doc.getElementById('moduleView');
        ok(!!mv, 'moduleView creata');
        const tbl = mv && mv.querySelector('table');
        ok(!!tbl, 'vista Statistiche AI con tabella');
        if (tbl) {
            const rows = tbl.querySelectorAll('tbody tr');
            ok(rows.length >= 8, 'tabella con >= 8 righe', 'righe=' + rows.length);
            const head = (tbl.querySelector('thead') && tbl.querySelector('thead').textContent) || '';
            ok(head.indexOf('Round 11') >= 0, 'colonna "Round 11 (prima)" presente', head);
            const colored = tbl.querySelectorAll('.stats-better, .stats-worse').length;
            ok(colored >= 1, 'celle delta colorate (green/red) presenti', 'n=' + colored);
        }

        // round successivi via pushRound
        const pushed = env.win.StatsAI.pushRound({
            round: '12',
            build: '2026-10-24T10:00:00+02:00',
            metrics: {
                rss_before_mb: 25, rss_load_mb: 2100, rss_30req_mb: 2600,
                load_sec: 2.0,
                tok_s: { fast: 11.5, think: 9.8, tool: 12.2 },
                latency_p50_ms: 3500, latency_p95_ms: 3900,
                ttft_p50_ms: 1400, ttft_p95_ms: 2400,
                prompt_cache_hit_rate: 0.75, kv_delta_mb: 40,
                gate: { total: 60, ok: 56, f01: { n: 15, ok: 15 }, f04: { n: 15, ok: 15 }, f10: { n: 15, ok: 14 }, f13: { n: 15, ok: 12 } },
                recall5: 1.0, recall5_vector: 1.0, parity: 1.0,
                router_p95_ms: 0.01, t1_total: 10
            }
        });
        ok(pushed === true, 'StatsAI.pushRound accetta il round12');
        const head2 = (mv && mv.querySelector('table thead') && mv.querySelector('table thead').textContent) || '';
        ok(head2.indexOf('Round 12') >= 0, 'colonna "Round 12 (dopo)" aggiunta', head2);

        // ritorno home: sempre 8 card, sempre 0 extra
        App.go('home');
        const cards2 = homeView.querySelectorAll('.home-card');
        ok(cards2.length === 8, 'ritorno home: ancora 8 .home-card', 'ottenute ' + cards2.length);
        ok(homeView.querySelectorAll('button').length === 8,
            'ritorno home: ancora 8 button', 'ottenuti ' + homeView.querySelectorAll('button').length);
        ok(env.consoleErrors.length === 0, 'zero console error finale',
            env.consoleErrors.join(' | '));
    }
    finish(env);
}

function finish(env) {
    console.log('================================================');
    console.log('RISULTATI G7_FE: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}

main();
