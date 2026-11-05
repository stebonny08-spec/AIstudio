/* Sondaggio V1a dettagliato: chi e' piu alto del viewport in qa_ui/video.html */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
    const results = {};
    for (const VP of [{ width: 1366, height: 800 }, { width: 1440, height: 900 }]) {
        const page = await browser.newPage();
        await page.setViewport(VP);
        await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'video.html')).href, { waitUntil: 'load' });
        const t0 = Date.now();
        while (Date.now() - t0 < 35000) {
            const st = await page.evaluate(() => ({
                need: !!(window.__QA && window.__QA.needShot),
                done: !!(window.__QA && window.__QA.done)
            }));
            if (st.need) await page.evaluate(() => { window.__SHOT_OK = true; });
            if (st.done) break;
            await new Promise(r => setTimeout(r, 100));
        }
        const d = await page.evaluate(() => {
            const q = s => document.querySelector(s);
            const info = el => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return {
                    tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60),
                    top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1),
                    cssH: cs.height, scrollH: el.scrollHeight, clientH: el.clientHeight,
                    overflow: cs.overflow, flex: cs.flex
                };
            };
            const main = q('.vv-editor');
            const hdr = q('.header') || q('#topBar');
            const kids = [].slice.call(main.children).map(info);
            let maxBottom = 0;
            [].slice.call(main.querySelectorAll('*')).forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.bottom > maxBottom) maxBottom = r.bottom;
            });
            let off = 0, n = main;
            while (n) { off += n.offsetTop; n = n.offsetParent; }
            return {
                innerH: window.innerHeight, scrollY: window.scrollY,
                docScrollH: document.documentElement.scrollHeight,
                header: info(hdr), main: info(main), mainOffsetChain: off,
                kids: kids,
                maxChildInsideMain: +(maxBottom - main.getBoundingClientRect().top).toFixed(1),
                vvBar: info(q('.vv-bar')), vvBody: info(q('.vv-body')), vvTlwrap: info(q('.vv-tlwrap')),
                stage: info(q('.vv-stage')),
                checks: (window.__QA && window.__QA.checks || []).map(c => c.id + '=' + c.ok)
            };
        });
        results[VP.width + 'x' + VP.height] = d;
        await page.close();
    }
    console.log(JSON.stringify(results, null, 1));
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
