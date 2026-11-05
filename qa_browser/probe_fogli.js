/* Sondaggio F1: coordinate reali di .fg-fill vs td K13 in fogli.html
   - misura base (dopo lo scroll verticale +100 della harness)
   - misura con scroll ORIZZONTALE del wrap (+500px)
   - coerenza larghezze dichiarate colgroup vs rese dalla tabella */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'fogli.html')).href, { waitUntil: 'load' });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
        const st = await page.evaluate(() => ({
            need: !!(window.__QA && window.__QA.needShot),
            done: !!(window.__QA && window.__QA.done)
        }));
        if (st.need) await page.evaluate(() => { window.__SHOT_OK = true; });
        if (st.done) break;
        await new Promise(r => setTimeout(r, 100));
    }
    const measure = () => page.evaluate(() => {
        const wrap = document.querySelector('.fg-wrap');
        const td = document.querySelector('td[data-ref="K13"]');
        const fill = document.querySelector('.fg-fill');
        const tbl = wrap.querySelector('table');
        const t = td.getBoundingClientRect(), f = fill.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        return {
            scrollLeft: wrap.scrollLeft, scrollTop: wrap.scrollTop,
            scrollW: wrap.scrollWidth, clientW: wrap.clientWidth,
            wrapRect: { l: +w.left.toFixed(1), r: +w.right.toFixed(1) },
            tableW: +tbl.getBoundingClientRect().width.toFixed(1),
            tableStyleW: tbl.style.width,
            tdRect: { l: +t.left.toFixed(1), r: +t.right.toFixed(1), w: +t.width.toFixed(1) },
            tdOffset: { left: td.offsetLeft, w: td.offsetWidth },
            fillStyleLeft: fill.style.left, fillStyleTop: fill.style.top,
            fillRect: { l: +f.left.toFixed(1), r: +f.right.toFixed(1), b: +f.bottom.toFixed(1) },
            dR: +(f.right - t.right).toFixed(1),
            dB: +(f.bottom - t.bottom).toFixed(1),
            fillVisible: f.width > 0 && f.top >= 0 && f.bottom <= window.innerHeight
        };
    });
    const base = await measure();               // dopo lo scroll verticale +100 della harness
    const h = await page.evaluate(() => {       // scroll ORIZZONTALE reale del wrap
        const wrap = document.querySelector('.fg-wrap');
        wrap.scrollLeft = 500;
        return new Promise(r => setTimeout(() => r(wrap.scrollLeft), 250));
    });
    const hscroll = await measure();
    const hdr = await page.evaluate(() => {     // ripristino per lo screenshot
        const wrap = document.querySelector('.fg-wrap');
        wrap.scrollLeft = 0;
        const cols = [].slice.call(wrap.querySelectorAll('colgroup col'));
        const declared = cols.reduce((s, c) => s + (parseInt(c.style.width, 10) || 0), 0);
        return {
            declaredColgroup: declared,
            tableW: +wrap.querySelector('table').getBoundingClientRect().width.toFixed(1)
        };
    });
    console.log(JSON.stringify({ base: base, hscrollApplied: h, hscroll: hscroll, colgroup: hdr }, null, 1));
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
