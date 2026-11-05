'use strict';
/* qa_browser/qaR15_web.js - QA-T2 blocco W (stadio web: settings, progress
   per stadio, badge fonti, toggle web) in Chromium REALE via Puppeteer.
   - qa_ui/r15.html: harness W (stub DICHIARATO pywebview.api con
     app_settings/poll_stream realistici + estrazione a runtime del VERO
     index.html: markup settings/composer, CSS di produzione e corpo delle
     funzioni renderStreamProgress/renderSourceBadges/loadWebSettings/...).
   - Misure REALI: getBoundingClientRect + computedStyle. Screenshot
     handshake __QA.needShot -> qa/r15_web_*.
   - Check nominati via window.__qaCheck (handshake dichiarato) + marker
     sull'source REALE di index.html (wiring poll/send/chip).
   BUILD letto dinamicamente da index.html (var QA_TS), nessun bump.
   Output: qa/r15_web_measures.json
   Esecuzione: node qa_browser/qaR15_web.js  */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const IDX_PATH = path.join(ROOT, 'web_frontend', 'html', 'index.html');
const VW = 1366, VH = 900;
const MAX_ATT = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MEAS = { block: 'W', build: {}, checks: {}, errors: [] };

/* ---------- BUILD marker: letto dinamicamente da index.html ---------- */
(function checkBuild() {
    const src = fs.readFileSync(IDX_PATH, 'utf8');
    const m = src.match(/var QA_TS\s*=\s*"([^"]+)"/);
    const got = m ? m[1] : '(assente)';
    const vs = [], re = /\?v=([^"']+)/g;
    let mm;
    while ((mm = re.exec(src))) vs.push(mm[1]);
    const uniq = Array.from(new Set(vs));
    const badV = uniq.filter(v => v !== got);
    if (got === '(assente)') {
        console.error('BLOCKED - QA_TS assente in web_frontend/html/index.html');
        process.exit(2);
    }
    if (badV.length) {
        console.error('BLOCKED - ?v= incoerenti con QA_TS: ' + badV.join(', '));
        process.exit(2);
    }
    MEAS.build = { qa_ts: got, v_bad: badV.length, v_unique: uniq.length };
    console.log('BUILD letto dinamicamente OK: QA_TS="' + got + '" (?v= coerenti: ' + uniq.length + ' distinti)');
})();

/* ---------- handshake screenshot (protocollo qaD_home_b12.js) ---------- */
async function shot(page, name) {
    await page.evaluate(n => { window.__QA.needShot = n; }, name);
    await sleep(50);
    await page.screenshot({ path: path.join(QA_DIR, name + '.png') });
    await page.evaluate(() => { window.__SHOT_OK = true; window.__QA.needShot = null; });
    console.log('SHOT -> qa/' + name + '.png');
}

async function pushCheck(id, expected, ok, evidence, m) {
    ok = !!ok;
    MEAS.checks[id] = Object.assign({ id, expected, ok, evidence }, m ? { m } : {});
    console.log((ok ? '[VISTO] ' : '[NO]    ') + id + '  (blocco W)');
    console.log('        atteso: ' + expected);
    console.log('        visto : ' + evidence);
    return ok;
}

/* check nominati nel harness (__qaCheck) */
async function checkNamed(page, id, expected, name) {
    let r;
    try {
        r = await page.evaluate(n => window.__qaCheck(n), name);
    } catch (e) {
        r = { ok: false, evidence: 'eccezione evaluate: ' + (e.message || e) };
    }
    return pushCheck(id, expected, r && r.ok,
        (r && r.evidence) || '(nessuna evidenza)', r && r.m);
}

/* marker sul source REALE di index.html (wiring di produzione) */
function srcCheck(id, expected, predicate) {
    const src = fs.readFileSync(IDX_PATH, 'utf8');
    const hit = predicate(src);
    return pushCheck(id, expected, !!hit, hit ? 'marker presente in index.html' : 'marker ASSENTE in index.html');
}

function attachLogs(page) {
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push('console.error: ' + m.text()); });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    return logs;
}

async function waitHarness(page, logs) {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
        let st = {};
        try {
            st = await page.evaluate(() => ({
                ready: !!(window.__QA && window.__QA.harnessReady),
                done: !!(window.__QA && window.__QA.done),
                err: window.__QA ? window.__QA.errors : ['no __QA']
            }));
        } catch (e) { logs.push('evaluate: ' + e.message); break; }
        if (st.ready) return true;
        if (st.done || (st.err && st.err.length)) { logs.push('harness errors=' + JSON.stringify(st.err)); return false; }
        await sleep(150);
    }
    return false;
}

(async function run() {
    /* ---------- marker di produzione PRIMA del browser ---------- */
    srcCheck('W6a', 'il poll di produzione passa p.progress a renderStreamProgress',
        s => s.indexOf('renderStreamProgress(streamingRefs, p.progress)') >= 0);
    srcCheck('W6b', 'a done il poll passa p.sources a finalizeStreamingBubble',
        s => s.indexOf('finalizeStreamingBubble(streamingRefs, finalText, p.source, p.sources)') >= 0);
    srcCheck('W6c', 'finalizeStreamingBubble renderizza renderSourceBadges',
        s => s.indexOf('renderSourceBadges(refs.content, sources)') >= 0);
    srcCheck('W6d', 'sendMessage passa getWebOverride() come web_override a send_message',
        s => /api\.send_message\([\s\S]{0,400}?getWebOverride\(\)/.test(s));
    srcCheck('W6e', 'chip web: listener click -> cycleWebOverride',
        s => s.indexOf("chip.addEventListener('click', cycleWebOverride)") >= 0);
    srcCheck('W6f', 'loadWebSettings: apertura gearBtn + boot (waitForApi)',
        s => s.indexOf('refreshUpdateStatus(); loadWebSettings();') >= 0 &&
             s.indexOf('await loadWebSettings();') >= 0);
    srcCheck('W6g', 'Impostazioni usano app_settings_get/set (API contratto)',
        s => s.indexOf('app_settings_get') >= 0 && s.indexOf('app_settings_set') >= 0);
    srcCheck('W6h', 'reset dedup progress a ogni poll ( _progLen = 0 )',
        s => s.indexOf('streamingRefs._progLen = 0;') >= 0);

    /* ---------- browser ---------- */
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    const logs = attachLogs(page);
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'r15.html')).href, { waitUntil: 'load' });
    const harnessOk = await waitHarness(page, logs);
    if (!harnessOk) {
        await pushCheck('W0', 'harness pronto senza errori (estrazione index.html riuscita)', false,
            'harness non pronto; logs=' + JSON.stringify(logs.slice(0, 8)) +
            ' qaErrors=' + JSON.stringify(await page.evaluate(() => (window.__QA ? window.__QA.errors : ['no __QA'])).catch(e => [e.message])));
    } else {
        await sleep(250);
        const extracted = await page.evaluate(() => window.__QA.extracted);
        MEAS.extracted = extracted;
        console.log('Estratto da index.html: ' + JSON.stringify(extracted));

        /* apri il modal di produzione (openModal = add .show) PRIMA dei check
           geometrici: le righe devono avere rect>0 reale */
        await page.evaluate(() => {
            const m = document.getElementById('settingsModal');
            m.classList.add('show');
            const target = document.getElementById('webModeItem');
            if (target) target.scrollIntoView({ block: 'start' });
        });
        await sleep(120);

        /* ---------- W1: righe settings presenti (markup reale) ---------- */
        await checkNamed(page, 'W1',
            '#settingsModal aperto contiene: select web.mode (auto/sempre/mai), soglia gate 0.05-0.90 (range+number), URL SearXNG, toggle Wikipedia, nota privacy con DuckDuckGo/nessun LLM cloud; tutte con rect>0',
            'rows');

        /* screenshot settings aperte */
        await page.evaluate(() => {
            const target = document.getElementById('webModeItem');
            if (target) target.scrollIntoView({ block: 'start' });
        });
        await sleep(80);
        await shot(page, 'r15_web_settings');

        /* ---------- W2: salvataggio settings via stub ---------- */
        await checkNamed(page, 'W2',
            'loadWebSettings riempie i controlli dai valori contratto (gate 0.45, web.mode auto, wiki on); change su select/soglia/searxng/wiki chiama saveWebSetting -> app_settings_set dello STUB (web.mode=sempre, gate.threshold=0.60 numero, url, wiki=false) e il chip si sincronizza su web.mode',
            'settings');

        /* ---------- W3: progress 3 stadi (render estratto) ---------- */
        await checkNamed(page, 'W3',
            'progress di poll_stream (3 stadi appunti/libri/web, lista crescente) renderizzato da renderStreamProgress in elemento .streaming-spinner.stage-progress (rect>0, testo "appunti... libri... web..."), dedup per lunghezza crescente stabile, spinner originale compatibile',
            'progress');
        await page.evaluate(() => {
            const el = document.querySelector('[data-qa="stage-progress"]');
            if (el) el.scrollIntoView({ block: 'center' });
        });
        await sleep(80);
        await shot(page, 'r15_web_progress');

        /* ---------- W4: badge fonti con link ---------- */
        await checkNamed(page, 'W4',
            'sources finali (appunti/libri/web) renderizzate da renderSourceBadges: 3 badge con label locale/libri/web, badge web con href https + target _blank, tutti con rect>0',
            'sources');
        await page.evaluate(() => {
            const el = document.querySelector('[data-qa="source-badges"]');
            if (el) el.scrollIntoView({ block: 'center' });
        });
        await sleep(80);
        await shot(page, 'r15_web_sources');

        /* ---------- W5: toggle web per query ---------- */
        await checkNamed(page, 'W5',
            'chip #webToggleChip accanto all\'input: default = web.mode ("Web: Sempre" dopo il save), ciclo auto->sempre->mai->auto via cycleWebOverride, getWebOverride() passato come web_override a send_message (stub registra "sempre"), rect>0',
            'toggle');
        await page.evaluate(() => {
            const chip = document.getElementById('webToggleChip');
            if (chip) chip.scrollIntoView({ block: 'center' });
        });
        await sleep(80);
        await shot(page, 'r15_web_toggle');

        MEAS.errors = await page.evaluate(() => window.__jsErrors || []).catch(() => []);
    }

    MEAS.console = logs.slice(0, 20);
    await browser.close();

    fs.writeFileSync(path.join(QA_DIR, 'r15_web_measures.json'),
        JSON.stringify(MEAS, null, 1), 'utf8');

    const vals = Object.values(MEAS.checks);
    const nok = vals.filter(c => !c.ok);
    console.log('\n===== TOTALE W: ' + (vals.length - nok.length) + '/' + vals.length + ' check OK =====');
    if (nok.length) console.log('FAILED: ' + nok.map(c => c.id).join(' | '));
    if (logs.length) console.log('CONSOLE: ' + JSON.stringify(logs.slice(0, 10)));
    console.log('Risultati -> qa/r15_web_measures.json');
    process.exit(nok.length ? 1 : 0);
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
