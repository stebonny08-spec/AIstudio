/* ============================================================
   tests/telemStatsR13.test.js — R13 T3: wiring LIVE in statistiche.js (jsdom).
   Owner: IMPLEMENTER-TELEM. Pattern: tests/testG7_fe.test.js (JSDOM + harness).

   Verifica:
   * monta app.js + statistiche.js CON pywebview simulato (api.ai_stats
     -> payload live di test) -> ZERO console errori;
   * il blocco LIVE e' mostrato (valori dal payload nel DOM);
   * struttura STORICA invariata: stesse righe/colonne della tabella round
     PRIMA/DOPO l'arrivo del live (snapshot confrontato), identica anche
     senza pywebview (fallback prudente, zero errori);
   * la parte storica resta identica anche rispetto ai conteggi attuali
     attesi (23 righe dati, 5 colonne header) e StatsAI.pushRound funziona.

   Eseguire con: node tests/telemStatsR13.test.js
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

const LIVE_PAYLOAD = {
    calls_total: 42,
    fids: { F01: { calls: 3, ok: 3, fails: 0, tokens_est: 120, ms_total: 450.5 } },
    cache_hits: { exact: 5, semantic: 1, delta: 0 },
    tutor_judgments: { corretto: 7, parziale: 2, errato: 1 },
    ai_cache: { entries: 4 },
    live: {
        ttft_p50_ms: 742.5,
        ttft_p95_ms: 1810.0,
        ttft_n: 6,
        ttft_source: 'runtime/sonda (record_ttft)',
        tok_per_s: 9.87,
        tok_per_s_source: "stima: sum(tokens_est)/sum(ms_total)",
        prefix_hit_rate: 0.77,
        prefix_hit_rate_hits: 80,
        prefix_hit_rate_misses: 23,
        prefix_hit_rate_source: 'core.prefix_cache.stats',
        acceptance: 0.71,
        acceptance_source: "last_meta['acceptance']",
        draft_active: false,
        tutor_judgments: { corretto: 7, parziale: 2, errato: 1 }
    },
    persist: { path: 'x/ai_stats.json', ok: true, writes: 3, loaded: true, error: null }
};

function makeEnv(withPywebview) {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><main id="welcomeView"></main></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window, doc = win.document;
    win.alert = () => { }; win.confirm = () => false; win.prompt = () => null;
    if (withPywebview) {
        win.pywebview = {
            api: {
                ai_stats: function () { return Promise.resolve(JSON.parse(JSON.stringify(LIVE_PAYLOAD))); },
                ai_stats_reset: function () { return Promise.resolve({ calls_total: 0 }); }
            }
        };
    }
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

function shapeOf(mv) {
    /* snapshot struttura storica: colonne header + righe dati + contenuti */
    const tbl = mv && mv.querySelector('table');
    if (!tbl) return null;
    const head = tbl.querySelector('thead');
    const body = tbl.querySelector('tbody');
    return {
        cols: head ? head.querySelectorAll('th').length : 0,
        rows: body ? body.querySelectorAll('tr').length : 0,
        headText: head ? head.textContent : '',
        firstRowText: body && body.rows[0] ? body.rows[0].textContent : '',
        lastRowText: body && body.rows.length ? body.rows[body.rows.length - 1].textContent : ''
    };
}

function openStats(env) {
    const App = env.win.App;
    ['chatbot', 'notes', 'schemi', 'produttivita', 'ripasso', 'biblioteca', 'calendario'].forEach(id => {
        App.registerModule({ id: id, title: 'Mod ' + id, desc: 'desc ' + id });
    });
    env.doc.dispatchEvent(new env.win.Event('DOMContentLoaded'));
    App.go('home');
    const homeView = env.doc.getElementById('homeView');
    const dev = homeView && homeView.querySelector('.dev-link');
    if (dev) dev.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true, cancelable: true }));
    return env.doc.getElementById('moduleView');
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function main() {
    console.log('\n== R13 T3: statistiche.js LIVE (jsdom) ==');

    /* ---- scenario A: con pywebview simulato ---- */
    const envA = makeEnv(true);
    ok(!envA.appErr, 'A: eval app.js + statistiche.js senza eccezioni', envA.appErr);
    const mvA = openStats(envA);
    ok(!!mvA && !!mvA.querySelector('table'), 'A: vista statistiche aperta con tabella');
    const shapeBefore = shapeOf(mvA);
    ok(!!shapeBefore, 'A: snapshot struttura storica catturato');
    /* attende risoluzione della promise live + re-render */
    await tick(); await tick(); await tick();
    const shapeAfter = shapeOf(mvA);
    ok(!!shapeAfter, 'A: struttura storica ancora leggibile dopo live');
    ok(shapeBefore && shapeAfter &&
        shapeBefore.cols === shapeAfter.cols &&
        shapeBefore.rows === shapeAfter.rows &&
        shapeBefore.headText === shapeAfter.headText &&
        shapeBefore.firstRowText === shapeAfter.firstRowText &&
        shapeBefore.lastRowText === shapeAfter.lastRowText,
        'A: struttura storica INVARIATA dopo arrivo live (stesse righe/colonne/testi)',
        JSON.stringify({ before: shapeBefore, after: shapeAfter }));
    /* conteggi attuali attesi (storicamente: 23 righe dati, 5 colonne ->
       R13: 6 colonne con la colonna Round13 aggiunta dal coordinatore) */
    ok(shapeAfter && shapeAfter.rows === 23, 'A: 23 righe dati nella tabella round (invariate)', 'rows=' + (shapeAfter && shapeAfter.rows));
    ok(shapeAfter && shapeAfter.cols === 6, 'A: 6 colonne header (Metrica+3 round+Target+?)', 'cols=' + (shapeAfter && shapeAfter.cols));
    /* live mostrato */
    const mvText = mvA.textContent || '';
    ok(mvText.indexOf('742,5') >= 0 || mvText.indexOf('742.5') >= 0, 'A: TTFT p50 live nel DOM (742.5)', '');
    ok(/live/i.test(mvText), 'A: etichetta "live" presente');
    ok(mvText.indexOf('0,77') >= 0 || mvText.indexOf('0.77') >= 0, 'A: prefix hit-rate live (0.77)');
    ok(mvText.indexOf('42') >= 0, 'A: calls_total live (42)');
    /* zero errori console */
    ok(envA.consoleErrors.length === 0, 'A: zero console errori', envA.consoleErrors.join(' | '));

    /* pushRound storico ancora integro */
    const pushed = envA.win.StatsAI.pushRound({
        round: '13x', build: 'test',
        metrics: { rss_before_mb: 25, tok_s: { fast: 1 }, ttft_p50_ms: 1, ttft_p95_ms: 2, prompt_cache_hit_rate: 0.5 }
    });
    ok(pushed === true, 'A: StatsAI.pushRound funziona ancora (storico intatto)');
    const head2 = (mvA.querySelector('table thead') || {}).textContent || '';
    ok(head2.indexOf('13x') >= 0, 'A: colonna round13x aggiunta da pushRound', head2);

    /* ---- scenario B: SENZA pywebview (fallback prudente) ---- */
    const envB = makeEnv(false);
    ok(!envB.appErr, 'B: eval senza pywebview senza eccezioni', envB.appErr);
    const mvB = openStats(envB);
    await tick(); await tick(); await tick();
    const shapeB = shapeOf(mvB);
    ok(shapeB && shapeB.rows === 23 && shapeB.cols === 6,
        'B: struttura storica identica anche senza pywebview',
        JSON.stringify(shapeB));
    ok(shapeB && shapeBefore &&
        shapeB.rows === shapeBefore.rows && shapeB.cols === shapeBefore.cols &&
        shapeB.headText === shapeBefore.headText,
        'B: struttura == scenario A (stesso numero righe/colonne)');
    ok((envB.consoleErrors || []).length === 0, 'B: zero console errori con fallback',
        (envB.consoleErrors || []).join(' | '));
    /* il live senza api deve mostrare un fallback, non lanciare errori */
    const txtB = (mvB.textContent || '');
    ok(!/undefined\s*NaN/.test(txtB), 'B: nessun valore difettoso nel DOM');

    console.log('================================================');
    console.log('RISULTATI telemStatsR13: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('ERRORE FATALE: ' + (e && e.stack || e)); process.exit(1); });
