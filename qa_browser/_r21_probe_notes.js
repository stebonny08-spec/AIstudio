'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
(async () => {
    const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
    const page = await b.newPage();
    const logs = [];
    page.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('pageerror', e => logs.push('pageerror: ' + String(e.message).slice(0, 400)));
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'notes.html')).href, { waitUntil: 'load', timeout: 20000 });
    await new Promise(r => setTimeout(r, 4000));
    const st = await page.evaluate(() => ({
        ready: !!(window.__qaHarnessNotes && window.__qaHarnessNotes.ready),
        harnessReady: !!(window.__QA && window.__QA.harnessReady),
        errors: (window.__QA && window.__QA.errors || []).slice(0, 6),
        pill: !!document.querySelector('.fn-pill-left'),
        fp21: !!document.querySelector('.fp21-root'),
        FontiPanel: typeof window.FontiPanel
    }));
    console.log(JSON.stringify(st, null, 2));
    console.log('LOGS:\n' + logs.slice(0, 20).join('\n'));
    await b.close();
})();
