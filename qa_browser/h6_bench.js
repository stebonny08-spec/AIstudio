'use strict';
/* qa_browser/h6_bench.js â€” H6 bench REALI (Chromium/Puppeteer) â€” Implementer FE2.
   - qa_ui/biblioteca.html : harness H6 (biblioteca.js REALE + env.js stub, seed 50 item via QA.store)
   Misure richieste da H6:
   1) count listener su window/document (add/remove) DOPO 3 CICLI apri/chiudi vista
      -> atteso: NON cresce linearmente (attivo costante, growth == 0)
   2) count nodi DOM della vista biblioteca
   3) apertura vista in ms (performance.now reale, incl. 2 rAF)
   4) zero console.error / pageerror
   Output: qa/h6_measures.json (numeri REALI) + screenshot qa/h6_biblioteca.png
   Esecuzione: node qa_browser/h6_bench.js */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const MEAS_PATH = path.join(QA_DIR, 'h6_measures.json');
const SHOT_PATH = path.join(QA_DIR, 'h6_biblioteca.png');

const VW = 1366, VH = 900;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snap = o => Object.assign({}, o);

(async () => {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });

    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message)));

    /* contatore listener su window/document PRIMA di ogni script di pagina */
    await page.evaluateOnNewDocument(() => {
        window.__LST = { winAdd: 0, winRem: 0, docAdd: 0, docRem: 0 };
        const proto = EventTarget.prototype;
        const origAdd = proto.addEventListener;
        const origRem = proto.removeEventListener;
        proto.addEventListener = function (type, fn, opts) {
            if (this === window) window.__LST.winAdd++;
            else if (this === document) window.__LST.docAdd++;
            return origAdd.call(this, type, fn, opts);
        };
        proto.removeEventListener = function (type, fn, opts) {
            if (this === window) window.__LST.winRem++;
            else if (this === document) window.__LST.docRem++;
            return origRem.call(this, type, fn, opts);
        };
    });

    const url = pathToFileURL(path.join(ROOT, 'qa_ui', 'biblioteca.html')).href;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('window.__QA && window.__QA.harnessReady === true', { timeout: 20000 });

    const harnessErrors = await page.evaluate(() => (window.__QA && window.__QA.errors) || []);
    const seedItems = await page.evaluate(() => (window.__QA && window.__QA.store && window.__QA.store.items || []).length);

    const baseline = await page.evaluate(() => Object.assign({}, window.__LST));
    function active(s) { return { window: s.winAdd - s.winRem, document: s.docAdd - s.docRem, adds: { window: s.winAdd, document: s.docAdd } }; }

    /* --- 3 CICLI apri/chiudi (la 1Âª apertura misura il tempo "cold") --- */
    const openMs = [];
    const afterOpen = [];
    const afterClose = [];
    for (let c = 1; c <= 3; c++) {
        const ms = await page.evaluate(async () => window.__h6.open());
        openMs.push(Math.round(ms * 100) / 100);
        await sleep(80);
        if (c === 1) { /* 1Â° ciclo: passa a "Tutti" => 50 item piatti nei cicli successivi */
            await page.evaluate(() => window.__h6.showAll());
            await sleep(60);
        }
        afterOpen.push(await page.evaluate(() => ({ lst: Object.assign({}, window.__LST), dom: window.__h6.domCount(), items: window.__h6.renderedItems() })));
        await page.evaluate(() => window.__h6.close());
        await sleep(40);
        afterClose.push(await page.evaluate(() => Object.assign({}, window.__LST)));
    }

    /* stato finale aperto + screenshot reale */
    const finalOpenMs = await page.evaluate(async () => window.__h6.open());
    await sleep(150);
    const final = await page.evaluate(() => ({
        lst: Object.assign({}, window.__LST),
        dom: window.__h6.domCount(),
        items: window.__h6.renderedItems(),
        docTotal: document.querySelectorAll('*').length,
        hasRender: window.__h6.hasRender()
    }));
    await page.screenshot({ path: SHOT_PATH, fullPage: true });

    /* crescita listener: baseline -> dopo ciclo1 -> dopo ciclo3 (close) -> finale */
    const growthOpen3 = (afterOpen[2].lst.winAdd + afterOpen[2].lst.docAdd) - (baseline.winAdd + baseline.docAdd);
    const growthFinal = (final.lst.winAdd + final.lst.docAdd) - (baseline.winAdd + baseline.docAdd);
    const activeFinal = active(final.lst);
    const linear = growthFinal >= 3; /* 3 cicli => crescita lineare = +3 o piÃ¹ per ciclo */

    const MEAS = {
        bench: 'h6_bench',
        ts: new Date().toISOString(),
        page: 'qa_ui/biblioteca.html',
        seed_items: seedItems,
        cycles: 3,
        listeners: {
            baseline: baseline,
            baseline_active: active(baseline),
            after_cycle1_open: afterOpen[0].lst,
            after_cycle3_close: afterClose[2],
            final_open: final.lst,
            final_active: activeFinal,
            growth_after_3_opens: growthOpen3,
            growth_final: growthFinal,
            linear_growth: linear
        },
        open_ms: { cycle1: openMs[0], cycle2: openMs[1], cycle3: openMs[2], final: Math.round(finalOpenMs * 100) / 100 },
        dom: {
            after_cycle1: { biblioteca_nodes: afterOpen[0].dom, rendered_items: afterOpen[0].items },
            after_cycle2: { biblioteca_nodes: afterOpen[1].dom, rendered_items: afterOpen[1].items },
            after_cycle3: { biblioteca_nodes: afterOpen[2].dom, rendered_items: afterOpen[2].items },
            final: { biblioteca_nodes: final.dom, rendered_items: final.items, document_total: final.docTotal }
        },
        console_errors: consoleErrors,
        harness_errors: harnessErrors,
        screenshot: 'qa/h6_biblioteca.png'
    };

    const ok = !linear && consoleErrors.length === 0 && harnessErrors.length === 0 && final.hasRender && seedItems === 50;
    MEAS.ok = ok;
    fs.writeFileSync(MEAS_PATH, JSON.stringify(MEAS, null, 2), 'utf8');

    console.log('=== H6 BENCH (REALI) ===');
    console.log('seed items:', seedItems);
    console.log('listeners baseline:', JSON.stringify(baseline), '-> final:', JSON.stringify(final.lst));
    console.log('growth dopo 3 apertura:', growthOpen3, '| growth finale:', growthFinal, '| linear:', linear);
    console.log('open ms (3 cicli):', openMs.join(' | '), '| final:', MEAS.open_ms.final);
    console.log('nodi DOM biblioteca (finale):', final.dom, '| items renderizzati:', final.items);
    console.log('console.error:', consoleErrors.length, '| harness errors:', harnessErrors.length);
    console.log('screenshot:', SHOT_PATH);
    console.log('RISULTATI H6:', ok ? 'OK â€” 0 falliti' : 'FALLITO', '->', MEAS_PATH);

    await browser.close();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('h6_bench crash:', e); process.exit(2); });

