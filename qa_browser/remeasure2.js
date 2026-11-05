/* remeasure2.js — verifica post-fix FASE 2 (fill handle + video a 1440) */
'use strict';
const p = require('puppeteer');
const path = require('path');
const fs = require('fs');
(async () => {
    const b = await p.launch({ headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
    const res = { ts: new Date().toISOString() };
    // FOGli: K13 + scroll orizzontale + screenshot
    let pg = await b.newPage();
    await pg.setViewport({ width: 1440, height: 900 });
    await pg.goto('file:///' + path.resolve(__dirname, '../qa_ui/fogli.html').replace(/\\/g, '/'));
    await new Promise(r => setTimeout(r, 900));
    await pg.click('td[data-ref="K13"]').catch(() => { });
    await new Promise(r => setTimeout(r, 250));
    res.fogli_k13 = await pg.evaluate(() => {
        const td = document.querySelector('td[data-ref="K13"]');
        const f = document.querySelector('.fg-fill');
        if (!td || !f) return null;
        const t = td.getBoundingClientRect(), r = f.getBoundingClientRect();
        const wrap = document.querySelector('.fg-wrap');
        return { dR: +(r.right - t.right).toFixed(1), dB: +(r.bottom - t.bottom).toFixed(1), scrollLeft: wrap && wrap.scrollLeft, side: (document.querySelector('.fg-side') || {}).offsetWidth };
    });
    await pg.evaluate(() => { const w = document.querySelector('.fg-wrap'); if (w) { w.scrollLeft += 400; w.scrollTop += 60; } });
    await new Promise(r => setTimeout(r, 250));
    res.fogli_scroll = await pg.evaluate(() => {
        const td = document.querySelector('td[data-ref="K13"]');
        const f = document.querySelector('.fg-fill');
        if (!td || !f) return null;
        const t = td.getBoundingClientRect(), r = f.getBoundingClientRect();
        const wrap = document.querySelector('.fg-wrap');
        return { dR: +(r.right - t.right).toFixed(1), dB: +(r.bottom - t.bottom).toFixed(1), scrollLeft: wrap && wrap.scrollLeft };
    });
    await pg.screenshot({ path: path.resolve(__dirname, '../qa/fogli_fill.png') });
    await pg.close();
    // VIDEO a larghezza reale d'app
    pg = await b.newPage();
    await pg.setViewport({ width: 1440, height: 900 });
    await pg.goto('file:///' + path.resolve(__dirname, '../qa_ui/video.html').replace(/\\/g, '/'));
    await new Promise(r => setTimeout(r, 1200));
    res.video_1440 = await pg.evaluate(() => ({
        scrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
        noScroll: document.documentElement.scrollHeight <= window.innerHeight + 2,
        props: document.querySelectorAll('.vv-props').length,
        labs: document.querySelectorAll('.vv-lab').length,
        tracks: document.querySelectorAll('.vv-track').length
    }));
    await pg.screenshot({ path: path.resolve(__dirname, '../qa/video_editor.png') });
    await pg.close();
    await b.close();
    fs.writeFileSync(path.resolve(__dirname, '../qa/remeasure2.json'), JSON.stringify(res, null, 1));
    console.log(JSON.stringify(res));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
