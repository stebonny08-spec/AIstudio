/* Diagnosi geometria menu Modelli (qaR22_models*). */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: true,
        args: ['--allow-file-access-from-files'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.evaluateOnNewDocument(() => {
        const specific = {
            list_models: async () => [
                { key: 'pro', display_name: 'Modello pro (Spark-X2.6-4B)',
                  size_bytes: 3543441312, downloaded: true, active: false },
                { key: 'base', display_name: 'Modello base (MiniCPM5-2B)',
                  size_bytes: null, downloaded: true, active: true },
            ],
            get_model_status: async () => ({ state: 'ready', progress: 1 }),
            get_download_progress: async () => ({ active: false }),
        };
        const fb = () => Promise.resolve([]);
        window.pywebview = { api: new Proxy(specific,
            { get: (t, k) => (k in t) ? t[k] : fb }) };
        window.dispatchEvent(new Event('pywebviewready'));
    });
    await page.goto(pathToFileURL(
        path.join(ROOT, 'web_frontend', 'html', 'index.html')).href,
        { waitUntil: 'load', timeout: 60000 });
    await sleep(800);
    await page.evaluate(() => document.getElementById('modelsBtn').click());
    await sleep(500);
    const diag = await page.evaluate(() => {
        const g = s => {
            const e = document.querySelector(s);
            if (!e) return null;
            const r = e.getBoundingClientRect();
            const c = getComputedStyle(e);
            return { rect: { x: r.x, y: r.y, w: r.width, h: r.height },
                     display: c.display, opacity: c.opacity,
                     visibility: c.visibility,
                     cls: e.className.slice(0, 80) };
        };
        return {
            btn: g('#modelsBtn'),
            menu: g('#modelsMenu'),
            header: g('header'),
            bodyFirst: Array.from(document.body.children).slice(0, 6)
                .map(e => e.tagName + '.' + String(e.className).slice(0, 40)),
            anc: (function(){ var e=document.getElementById("modelsBtn"), out=[]; while(e && e!==document.documentElement){ var r=e.getBoundingClientRect(); out.push(e.tagName+"."+String(e.className).slice(0,30)+" ["+Math.round(r.x)+","+Math.round(r.y)+","+Math.round(r.width)+","+Math.round(r.height)+"] disp="+getComputedStyle(e).display); e=e.parentElement; } return out; })(),
            scrollY: window.scrollY,
        };
    });
    console.log(JSON.stringify(diag, null, 1));
    if (errs.length) console.log('pageerrors:', errs.slice(0, 5));
    await browser.close();
})();
