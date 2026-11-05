/* qa_browser/qaR22_schemi_probe.js - Sonda R22: replica SOLO il subcheck
   resize della cella schemi di qaR21_matrix.js (w0 -> drag +120 -> w1,
   persistenza fp21_w_schemi, reset dblclick) su qa_ui/schemi.html dopo il
   cambiamento 5.1 di R22 (mount in tab + width embedded).
   Non scrive/artefatti R21: output solo stdout.
   Uso: node qa_browser/qaR22_schemi_probe.js  (exit 0 se resize ok). */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href, { waitUntil: 'load', timeout: 20000 });
    for (let i = 0; i < 48; i++) {
        const ok = await page.evaluate(() => window.__QA && window.__QA.harnessReady &&
            document.querySelectorAll('.sc-tab').length > 0);
        if (ok) break;
        await sleep(250);
    }
    await page.evaluate(() => (Array.from(document.querySelectorAll('.sc-tab'))
        .filter(b => b.textContent.trim() === 'Fonti')[0]).click());
    await sleep(500);

    const r = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="schemi"]');
        if (!p) return { err: 'root assente' };
        const key = 'fp21_w_schemi';
        localStorage.removeItem(key);
        const w0 = p.getBoundingClientRect().width;
        const rz = p.querySelector('.fp21-rz-r');
        if (!rz) return { err: 'handle assente', w0: w0 };
        rz.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: w0, clientY: 100 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: w0 + 120, clientY: 100 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: w0 + 120, clientY: 100 }));
        const w1 = p.getBoundingClientRect().width;
        const persisted = localStorage.getItem(key);
        rz.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const resetOk = localStorage.getItem(key) == null;
        return {
            w0: Math.round(w0), w1: Math.round(w1), persisted: persisted, resetOk: resetOk,
            resize_ok: w1 !== w0 && persisted != null && resetOk &&
                w1 >= 240 && w1 <= Math.floor(innerWidth * 0.6),
            inline_after_drag: p.style.width, inline_after_reset: p.style.width
        };
    });
    console.log('RESIZE PROBE (cella schemi R21): ' + JSON.stringify(r, null, 2));
    await browser.close();
    process.exit(r && r.resize_ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
