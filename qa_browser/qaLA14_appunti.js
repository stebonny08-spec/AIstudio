'use strict';
/* qa_browser/qaLA14_appunti.js - T2 REALE (Chromium) - BLOCCO L (latenza
   scrittura assistita) di PROMPT ROUND14.
   - apre qa_ui/notes.html (notes.js reale, harness seed + editor, tool
     di default = penna)
   - per intensita' {0,50,100}: stream sintetico di PointerEvent a ~240Hz
     (1.04s di moto lineare) + fermo 600ms + pointerup; traccia
     window.__ink (raw/evt/paint/stop) e calcola:
       * latenza evento->paint p50/p95 (ms)
       * settle_ms: dal last raw al primo paint con punta entro 2px
       * trailing_px: distanza punta-lastRaw al paint finale del moto
   - usage: node qa_browser/qaLA14_appunti.js [prima|dopo]
   - output: qa/l14_measures.json (chiave prima|dopo) + screenshot
     qa/l14_{prima|dopo}_i{0,50,100}.png
   MISURE REALI: performance.now() in pagina, nessuna simulazione. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const MODE = (process.argv[2] === 'dopo') ? 'dopo' : 'prima';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pct(sorted, q) {
    if (!sorted.length) return null;
    const i = Math.min(sorted.length - 1, Math.max(0,
        Math.ceil(q * sorted.length) - 1));
    return sorted[i];
}

/* calcolo metriche su una traccia (stesso codice per prima e dopo) */
function computeStats(trace) {
    const raw = trace.filter(e => e.k === 'raw');
    const evts = trace.filter(e => e.k === 'evt');
    const paints = trace.filter(e => e.k === 'paint');
    const stops = trace.filter(e => e.k === 'stop');
    // latenza: per ogni evt, primo paint con n >= evt.n
    const lats = [];
    let pi = 0;
    for (const e of evts) {
        while (pi < paints.length && paints[pi].n < e.n) pi++;
        if (pi < paints.length) lats.push(paints[pi].t - e.t);
    }
    lats.sort((a, b) => a - b);
    const p50 = pct(lats, 0.50), p95 = pct(lats, 0.95);
    // settle: dal last raw (fermo del puntatore) al primo paint con punta
    // entro 2px dal last raw
    let settle = null, trailing = null;
    if (raw.length) {
        const lr = raw[raw.length - 1];
        for (const p of paints) {
            if (p.t < lr.t) continue;
            const d = Math.hypot(p.x - lr.x, p.y - lr.y);
            if (d <= 2) { settle = p.t - lr.t; break; }
        }
        // trailing al paint piu' vicino (o subito dopo) l'ultimo raw
        let best = null;
        for (const p of paints) {
            if (best === null || Math.abs(p.t - lr.t) < Math.abs(best.t - lr.t)) best = p;
        }
        if (best) trailing = Math.hypot(best.x - lr.x, best.y - lr.y);
    }
    return {
        n_raw: raw.length, n_evt: evts.length, n_paint: paints.length,
        n_stop: stops.length,
        p50_ms: p50 === null ? null : Math.round(p50 * 100) / 100,
        p95_ms: p95 === null ? null : Math.round(p95 * 100) / 100,
        settle_ms: settle === null ? null : Math.round(settle * 100) / 100,
        trailing_px: trailing === null ? null : Math.round(trailing * 100) / 100
    };
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const logs = [];
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));

    const url = pathToFileURL(path.join(ROOT, 'qa_ui', 'notes.html')).href;
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    // attesa harness + editor + penna + API __ink
    let ok = false;
    for (let i = 0; i < 40; i++) {
        ok = await page.evaluate(() => !!(window.__qaHarnessNotes &&
            window.__qaHarnessNotes.ready && window.__ink &&
            window.__ink.state() && window.__ink.state().tool));
        if (ok) break;
        await sleep(250);
    }
    if (!ok) {
        console.error('BLOCKED - harness/editor non pronto (qa_ui/notes.html)');
        console.error('Alternativa: verificare seed nota + openEditor + tool penna'
            + ' nel page harness; nessuna misura latenza valida.');
        await browser.close();
        process.exit(2);
    }
    console.log('HARNESS OK, stato: ' + JSON.stringify(await page.evaluate(() => window.__ink.state())));

    const results = {};
    for (const inten of [0, 50, 100]) {
        const trace = await page.evaluate(async (v) => {
            const ink = window.__ink;
            ink.clear();
            ink.setHelp(v / 100);
            const canvas = document.querySelector('.fn-editor canvas, .nt-editor canvas, canvas');
            if (!canvas) return { err: 'canvas assente' };
            // niente catture pointer sintetiche (Event synthetici non attivi)
            canvas.setPointerCapture = function () {};
            canvas.releasePointerCapture = function () {};
            const r = canvas.getBoundingClientRect();
            const x0 = r.left + r.width * 0.25, y0 = r.top + r.height * 0.6;
            const x1 = r.left + r.width * 0.75, y1 = r.top + r.height * 0.35;
            const N = 250;               // ~1.04s a 240Hz
            const STEP = 1000 / 240;     // 4.1667ms
            const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
                pointerId: 7, pointerType: 'pen', pressure: 0.5, bubbles: true,
                clientX: x, clientY: y
            }));
            // warmup rAF: drena i frame freddi subito dopo l'apertura
            // (artefatto cold-start del primo stroke, dichiarato nel method)
            for (let w = 0; w < 6; w++) {
                await new Promise(res => requestAnimationFrame(() => res()));
            }
            ev('pointerdown', x0, y0);
            for (let i = 1; i <= N; i++) {
                const x = x0 + (x1 - x0) * (i / N);
                const y = y0 + (y1 - y0) * (i / N);
                await new Promise(res => setTimeout(res, STEP));
                ev('pointermove', x, y);
            }
            // fermo del puntatore (nessun evento) per 600ms
            await new Promise(res => setTimeout(res, 600));
            ev('pointerup', x1, y1);
            await new Promise(res => setTimeout(res, 120));
            return { trace: ink.trace.slice() };
        }, inten);

        if (trace && trace.err) {
            console.error('BLOCKED - ' + trace.err);
            await browser.close();
            process.exit(2);
        }
        const st = computeStats(trace.trace || []);
        results[inten] = st;
        console.log(`i=${inten}% raw=${st.n_raw} evt=${st.n_evt} `
            + `p50=${st.p50_ms}ms p95=${st.p95_ms}ms `
            + `settle=${st.settle_ms === null ? 'MAI' : st.settle_ms + 'ms'} `
            + `trailing=${st.trailing_px === null ? 'n/a' : st.trailing_px + 'px'}`);
        const shot = path.join(QA_DIR, `l14_${MODE}_i${inten}.png`);
        await page.screenshot({ path: shot });
        console.log('SHOT -> qa/' + path.basename(shot));
        await sleep(250);
    }

    const outPath = path.join(QA_DIR, 'l14_measures.json');
    let out = {};
    if (fs.existsSync(outPath)) {
        try { out = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { out = {}; }
    }
    out.method = 'page.evaluate: PointerEvent sintetici reali su canvas '
        + 'qa_ui/notes.html a ~240Hz (250 move + fermo600ms + up); trace '
        + 'window.__ink (performance.now in pagina); latenza = paint.n>=evt.n '
        + '- evt.t (p50/p95); settle = dal last raw al primo paint con punta '
        + 'entro2px; traccia grezza salvata in l14_trace_' + MODE + '.json';
    out[MODE] = results;
    if (MODE === 'dopo') {
        out.delta = {};
        for (const i of ['0', '50', '100']) {
            const a = (out.prima || {})[i] || {};
            const b = results[i] || {};
            out.delta['i' + i] = {
                p50_ms: [a.p50_ms, b.p50_ms],
                p95_ms: [a.p95_ms, b.p95_ms],
                settle_ms: [a.settle_ms, b.settle_ms],
                trailing_px: [a.trailing_px, b.trailing_px]
            };
        }
    }
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    // salva le tracce grezze (integrita' della misura)
    fs.writeFileSync(path.join(QA_DIR, `l14_trace_${MODE}.json`),
        JSON.stringify(results, null, 1));
    console.log('MISURE -> qa/l14_measures.json [' + MODE + ']');
    if (logs.length) console.log('PAGE ERRORS: ' + JSON.stringify(logs.slice(0, 6)));
    await browser.close();
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
