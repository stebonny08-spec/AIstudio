/* qa_browser/run.js — runner PUPPETEER per la verifica UI REALE (file://).
   Esecuzione: node qa_browser/run.js
   - carica le 4 page qa_ui/* con viewport dedicati
   - fa il handshake screenshot (window.__qaShot -> qa/<nome>.png)
   - raccoglie window.__QA (checks misurati con rect reali)
   - FASE 0.4: verifica badge ?v sul VERO web_frontend/html/index.html */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const PAGES = [
    { file: 'documenti.html', vw: 1440, vh: 1500 },
    { file: 'fogli.html', vw: 1366, vh: 900 },
    { file: 'video.html', vw: 1366, vh: 800 },
    { file: 'schemi.html', vw: 1366, vh: 900 }
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));

    const summary = [];

    for (const p of PAGES) {
        const page = await browser.newPage();
        await page.setViewport({ width: p.vw, height: p.vh });
        const logs = [];
        page.on('console', m => {
            const t = m.type();
            if (t === 'error' || t === 'warning') logs.push(t + ': ' + m.text());
        });
        page.on('pageerror', e => logs.push('pageerror: ' + e.message));

        const url = pathToFileURL(path.join(ROOT, 'qa_ui', p.file)).href;
        await page.goto(url, { waitUntil: 'load', timeout: 20000 });

        // handshake screenshot + attesa done
        const t0 = Date.now();
        let done = false;
        while (Date.now() - t0 < 35000) {
            let st = {};
            try {
                st = await page.evaluate(() => ({
                    need: window.__QA && window.__QA.needShot,
                    done: window.__QA && window.__QA.done
                }));
            } catch (e) {
                logs.push('evaluate: ' + e.message);
                break;
            }
            if (st.need) {
                const fp = path.join(QA_DIR, st.need + '.png');
                await page.screenshot({ path: fp });
                console.log('SHOT ' + p.file + ' -> qa/' + st.need + '.png');
                await page.evaluate(() => { window.__SHOT_OK = true; });
            }
            if (st.done) { done = true; break; }
            await sleep(120);
        }

        let qa = null;
        try { qa = await page.evaluate(() => window.__QA); } catch (e) { logs.push('evalFinal: ' + e.message); }

        console.log('\n===== ' + p.file + ' (viewport ' + p.vw + 'x' + p.vh + ') done=' + done + ' =====');
        if (qa && qa.checks) {
            for (const c of qa.checks) {
                console.log((c.ok ? '[VISTO] ' : '[NO]    ') + c.id);
                console.log('        atteso: ' + c.expected);
                console.log('        visto : ' + c.evidence);
                summary.push({ page: p.file, ...c });
            }
        } else {
            console.log('  NESSUN CHECK (window.__QA assente)');
        }
        if (qa && qa.errors && qa.errors.length) console.log('  ERRORS: ' + JSON.stringify(qa.errors));
        if (logs.length) console.log('  CONSOLE: ' + JSON.stringify(logs.slice(0, 12)));
        await page.close();
    }

    // ---------- FASE 0.4: badge + ?v sul VERO index.html ----------
    console.log('\n===== FASE 0.4 — vero web_frontend/html/index.html =====');
    const page = await browser.newPage();
    const f0logs = [];
    page.on('pageerror', e => f0logs.push('pageerror: ' + e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'web_frontend', 'html', 'index.html')).href,
        { waitUntil: 'load', timeout: 20000 });
    await sleep(1200);
    const f0 = await page.evaluate(() => {
        const want = ['schemaStrategies', 'schemi.js', 'documenti.js', 'fogli.js', 'video.js'];
        const srcs = [];
        want.forEach(w => {
            const s = [].slice.call(document.querySelectorAll('script[src]'))
                .filter(x => x.getAttribute('src').indexOf(w) >= 0)[0];
            srcs.push(s ? s.getAttribute('src') : (w + ':ASSENTE'));
        });
        return {
            mark: (document.getElementById('buildMark') || {}).textContent || null,
            title: document.title.slice(0, 80),
            srcs: srcs,
            // prova che i caricamenti con ?v funzionano davvero (moduli definiti)
            studyToolsDoc: !!(window.StudyTools && window.StudyTools.documenti),
            schemaStrategies: !!window.SchemaStrategies
        };
    });
    const ts = (function () { try { var s = require('fs').readFileSync(require('path').join(__dirname, '..', 'web_frontend', 'html', 'index.html'), 'utf8'); var m = s.match(/var QA_TS\s*=\s*"([^"]+)"/); return m ? m[1] : 'MISSING'; } catch (e) { return 'MISSING'; } })(); /* R13: badge ?v letto dalla build reale (prima: costante obsoleta) */
    const badgeOk = f0.mark === 'BUILD ' + ts;
    const vOk = f0.srcs.every(s => s.indexOf('?v=' + ts) >= 0) && f0.srcs.every(s => s.indexOf(':ASSENTE') < 0);
    const loadOk = f0.studyToolsDoc && f0.schemaStrategies;
    console.log('[badge]  mark="' + f0.mark + '" -> ' + (badgeOk ? 'OK' : 'MISMATCH'));
    console.log('[?v]     srcs=' + JSON.stringify(f0.srcs) + ' -> ' + (vOk ? 'OK' : 'MISMATCH'));
    console.log('[load]   StudyTools.documenti=' + f0.studyToolsDoc + ' SchemaStrategies=' + f0.schemaStrategies +
        ' (moduli caricati con ?v) -> ' + (loadOk ? 'OK' : 'FAIL'));
    console.log('[title]  ' + f0.title);
    if (f0logs.length) console.log('[errors] ' + JSON.stringify(f0logs.slice(0, 6)));
    summary.push({ page: 'index.html', id: 'F0.4 badge BUILD', expected: 'BUILD ' + ts, ok: badgeOk, evidence: String(f0.mark) });
    summary.push({ page: 'index.html', id: 'F0.4 ?v sui 5 moduli', expected: '?v=' + ts + ' su 5 script', ok: vOk, evidence: JSON.stringify(f0.srcs) });
    summary.push({ page: 'index.html', id: 'F0.4 moduli caricati con ?v', expected: 'StudyTools+SchemaStrategies definiti', ok: loadOk, evidence: 'doc=' + f0.studyToolsDoc + ' strat=' + f0.schemaStrategies });
    await page.close();

    await browser.close();

    fs.writeFileSync(path.join(ROOT, 'qa', 'qa_results.json'), JSON.stringify(summary, null, 1));
    const nok = summary.filter(s => !s.ok);
    console.log('\n===== TOTALE: ' + (summary.length - nok.length) + '/' + summary.length + ' check OK =====');
    if (nok.length) console.log('FAILED: ' + nok.map(n => n.page + '::' + n.id).join(' | '));
    console.log('Risultati grezzi -> qa/qa_results.json');
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
