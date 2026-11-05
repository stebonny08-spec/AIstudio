'use strict';
const p = require('puppeteer');
const path = require('path');
(async () => {
    const b = await p.launch({ headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
    const pg = await b.newPage();
    await pg.setViewport({ width: 1440, height: 900 });
    await pg.goto('file:///' + path.resolve(__dirname, '../qa_ui/video.html').replace(/\\/g, '/'));
    await new Promise(r => setTimeout(r, 1200));
    const out = await pg.evaluate(() => {
        const off = [];
        document.querySelectorAll('body *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > window.innerHeight + 1) {
                off.push({ t: el.tagName + '.' + String(el.className || '').slice(0, 44), b: Math.round(r.bottom), h: Math.round(r.height), of: getComputedStyle(el).overflowY });
            }
        });
        const cs = getComputedStyle(document.body);
        return { bodyMargin: cs.margin, htmlH: document.documentElement.scrollHeight, off: off.slice(0, 12) };
    });
    console.log(JSON.stringify(out, null, 1));
    await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
