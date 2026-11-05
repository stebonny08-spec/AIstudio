/* qa_browser/qaR23_models.js — R23 X6.2/X4.4: T2 dropdown Modelli REALE.
   Dati = list_models() DEL CATALOGO REALE (python: tests.testR23_draftflag.
   _make_api -> ModelsManager reale + disco), NON inventati:
   - passata 1: default reale (spec.draft_model vuoto -> badge OFF);
   - passata 2: spec.draft_model impostato -> badge ATTIVO (ramo X4.4);
   - passata 3: copia con downloaded:false su pro -> render "Scarica… (~GB)"
     (campo dichiarato finto SOLO per questo render; identico al resto).
   Verifiche: 3 voci in ordine pro>base>fallback, nomi R23, badge, stato.
   Output: qa/r23_models_{default,drafton,scarica}.png +
           qa/r23_models_measures.json
   Esecuzione: node qa_browser/qaR23_models.js */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' | ' + extra : '')); }
}

function realModels(specDraft) {
    // dati REALI del catalogo via python (stesso accessor del test T1)
    const out = execFileSync('python', [
        '-c',
        'import sys,json; sys.path.insert(0,".");' +
        'from tests.testR23_draftflag import _make_api;' +
        'print(json.dumps(_make_api(' + JSON.stringify(specDraft) + ').list_models()))'
    ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    return JSON.parse(out.trim().split('\n').pop());
}

async function runPass(browser, models, tag, screenshot) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));

    await page.evaluateOnNewDocument((items) => {
        const specific = {
            list_models: async () => items,
            get_model_status: async () => ({
                state: 'ready', progress: 1.0, error: null,
                model_key: '', rss_before_mb: null, rss_after_mb: null,
            }),
            get_download_progress: async () => ({
                active: false, model_key: '', downloaded_bytes: 0,
                total_bytes: 0, speed_bps: 0, error: null,
            }),
            load_model: async () => ({ success: true, loading: true }),
            download_model: async () => ({ success: true, started: true }),
        };
        const fallback = () => Promise.resolve([]);
        const api = new Proxy(specific, {
            get: (t, k) => (typeof k === 'string' && k in t) ? t[k] : fallback,
        });
        window.pywebview = { api };
        window.dispatchEvent(new Event('pywebviewready'));
    }, models);

    await page.goto(pathToFileURL(
        path.join(ROOT, 'web_frontend', 'html', 'index.html')).href,
        { waitUntil: 'load', timeout: 60000 });
    let found = false;
    for (let i = 0; i < 200; i++) {
        if (await page.$('#modelsBtn')) { found = true; break; }
        await sleep(100);
    }
    if (!found) throw new Error(tag + ': #modelsBtn non trovato');
    await sleep(600);
    await page.evaluate(() => document.getElementById('modelsBtn').click());
    await sleep(600);

    const data = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('#modelsList .model-item'));
        return {
            visible: !!(document.getElementById('modelsMenu') &&
                document.getElementById('modelsMenu').classList.contains('show')),
            names: items.map(it => (it.querySelector('.model-name') || {}).textContent || ''),
            badges: items.map(it => {
                const b = it.querySelector('.model-draft-flag');
                return b ? b.textContent : null;
            }),
            actions: items.map(it => {
                const a = it.querySelector('.model-action');
                return a ? (a.textContent || '').trim() : '';
            }),
            jsErrors: window.__jsErrors || [],
        };
    });
    await page.screenshot({ path: path.join(QA_DIR, screenshot) });
    data.pageErrors = pageErrors;
    await page.close();
    return data;
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files'],
    });
    const M = { ts: new Date().toISOString(), viewport: '1366x900',
                data_source: 'python list_models REALE (catalog R23 + disco)' };

    // ---- 1: default reale (draft OFF) ----
    const real = realModels('');
    M.models_default = real;
    console.log('MODELS: ' + real.map(m => m.key + '/' + m.display_name).join(' | '));
    ok(real.length === 3, 'P1 catalogo reale = 3 voci', String(real.length));
    const d1 = await runPass(browser, real, 'default', 'r23_models_default.png');
    M.pass_default = d1;
    ok(d1.visible, 'P2 menu visibile');
    ok(d1.names[0] === 'Modello pro (Spark-4B)' &&
       d1.names[1] === 'Modello base (Spark-1.7B)' &&
       d1.names[2] === 'MiniCPM5-2B (fallback)',
       'P3 ordine/nomi pro>base>fallback', JSON.stringify(d1.names));
    ok(d1.badges[0] && /OFF/.test(d1.badges[0]) && /1,24/.test(d1.badges[0]),
       'P4 badge pro OFF con speedup', String(d1.badges[0]));
    ok(d1.badges[1] === null, 'P5 base SENZA badge (draft null)',
       String(d1.badges[1]));
    ok(d1.badges[2] && /draft/.test(d1.badges[2]),
       'P6 badge fallback presente', String(d1.badges[2]));
    ok(real.every(m => m.downloaded === true),
       'P7 tutte le voci scaricate (disco reale)');

    // ---- 2: spec.draft_model impostato -> badge ATTIVO ----
    const on = realModels('/qualche/spark-draft.gguf');
    M.models_draft_on = on;
    const d2 = await runPass(browser, on, 'drafton', 'r23_models_drafton.png');
    M.pass_drafton = d2;
    ok(d2.badges[0] && /ATTIVO/.test(d2.badges[0]),
       'P8 badge pro ATTIVO con spec.draft_model configurato',
       String(d2.badges[0]));
    ok(d2.badges[1] === null, 'P9 base sempre senza badge (ON)',
       String(d2.badges[1]));

    // ---- 3: render "Scarica… (~GB)" su voce non scaricata ----
    const dl = real.map(m => ({ ...m }));
    dl[0] = { ...dl[0], downloaded: false, active: false };
    const d3 = await runPass(browser, dl, 'scarica', 'r23_models_scarica.png');
    M.pass_scarica = d3;
    ok(/Scarica/.test(d3.actions[0]) && /GB/.test(d3.actions[0]),
       'P10 voce non scaricata -> "Scarica… (~GB)"', String(d3.actions[0]));

    M.checks = { pass, fail, failures };
    M.ok = fail === 0;
    fs.writeFileSync(path.join(QA_DIR, 'r23_models_measures.json'),
        JSON.stringify(M, null, 1));
    console.log('\nRISULTATO qaR23_models: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('QA R23 MODELS FAIL: ' + (e && e.stack || e)); process.exit(1); });
