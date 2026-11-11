'use strict';
/* qa/_r31b_n08diag.js — perche' N08 liveCross wrun=0.25 (atteso >=3)?
   A) tratto N08 SENZA screenshot a meta' (nessuna pausa >=200ms -> nessuna ombra)
   B) tratto N08 CON screenshot a meta' (pausa attiva ombra) + shadow() alla probe
   Misura liveCross identica a qaR31_ink. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8893;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function staticServer() {
    const srv = http.createServer((req, res) => {
        try {
            const u = decodeURIComponent((req.url || '/').split('?')[0]);
            let p = path.join(APP_DIR, u === '/' ? '/index.html' : u);
            if (!p.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
            const ext = path.extname(p).toLowerCase();
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(fs.readFileSync(p));
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

(async () => {
    const srv = await staticServer();
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
    for (let i = 0; i < 60; i++) {
        const ok = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
        if (ok) break; await sleep(250);
    }
    await page.evaluate(() => {
        if (!window.pywebview && window.StudyStore && typeof StudyStore.listSubjects === 'function') {
            const orig = StudyStore.listSubjects.bind(StudyStore);
            StudyStore.listSubjects = function () {
                return Promise.race([Promise.resolve().then(() => orig()), new Promise(r => setTimeout(() => r([]), 1500))]).then(v => v || []);
            };
        }
    });
    await page.evaluate(() => App.go('notes'));
    for (let i = 0; i < 40; i++) {
        const ok = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
        if (ok) break; await sleep(250);
    }
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')); if (b) b.click(); });
    for (let i = 0; i < 30; i++) {
        const ok = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || '')); if (b) { b.click(); return true; } return false; });
        if (ok) break; await sleep(300);
    }
    for (let i = 0; i < 96; i++) {
        const ok = await page.evaluate(() => { const p = document.querySelector('.fn-pill-left'); const c = document.querySelector('.nt-stage canvas'); return !!(p && c && c.width > 0); });
        if (ok) break; await sleep(500);
    }
    await sleep(500);

    async function w2c(wx, wy) {
        return page.evaluate((wx, wy) => {
            const ink = window.__ink;
            const A = ink.toWorld(0, 0), B = ink.toWorld(100, 0), D = ink.toWorld(0, 100);
            const kx = (B.x - A.x) / 100, ky = (D.y - A.y) / 100;
            const c = document.querySelector('.nt-stage canvas');
            const r = c.getBoundingClientRect();
            return { x: r.left + (wx - A.x) / kx, y: r.top + (wy - A.y) / ky };
        }, wx, wy);
    }
    async function centerW() {
        return page.evaluate(() => { const c = document.querySelector('.nt-stage canvas'); const r = c.getBoundingClientRect(); return window.__ink.toWorld(r.left + r.width / 2, r.top + r.height / 2); });
    }
    async function crossWetRun(wx, wy, ux, uy) {
        return page.evaluate((wx, wy, ux, uy) => {
            const ink = window.__ink;
            const c = document.querySelector('.nt-stage canvas');
            const ctx = c.getContext('2d');
            const A = ink.toWorld(0, 0), B = ink.toWorld(100, 0), D = ink.toWorld(0, 100);
            const kx = (B.x - A.x) / 100, ky = (D.y - A.y) / 100;
            const rect = c.getBoundingClientRect();
            const dpr = c.width / rect.width;
            const L = Math.hypot(ux, uy) || 1;
            const nx = -uy / L, ny = ux / L;
            let run = 0, maxRun = 0, cnt = 0; const vs = [];
            for (let s = -9; s <= 9.001; s += 0.25) {
                const qx = wx + nx * s, qy = wy + ny * s;
                const cxp = (qx - A.x) / kx, cyp = (qy - A.y) / ky;
                const px = Math.round((cxp - rect.left) * dpr);
                const py = Math.round((cyp - rect.top) * dpr);
                if (px < 0 || py < 0 || px >= c.width || py >= c.height) { run = 0; continue; }
                const d = ctx.getImageData(px, py, 1, 1).data;
                const r = d[0], g = d[1], b = d[2];
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = (r + g + b) / 3;
                vs.push(Math.round(v));
                const wet = (mx - mn <= 6 && v >= 160 && v <= 176);
                if (wet) { run++; cnt++; if (run > maxRun) maxRun = run; } else run = 0;
            }
            return { run: maxRun, wrun: +(maxRun * 0.25).toFixed(2), n: cnt, vs: vs };
        }, wx, wy, ux, uy);
    }
    async function shadowState() {
        return page.evaluate(() => (window.__ink.shadow ? window.__ink.shadow() : null));
    }
    async function freshNote() {
        const back = await page.$('button[title^="Torna"]');
        if (back) { await back.click(); await sleep(450); }
        await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')); if (b) b.click(); });
        for (let i = 0; i < 30; i++) {
            const ok = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || '')); if (b) { b.click(); return true; } return false; });
            if (ok) break; await sleep(300);
        }
        for (let i = 0; i < 60; i++) {
            const ok = await page.evaluate(() => { const p = document.querySelector('.fn-pill-left'); const c = document.querySelector('.nt-stage canvas'); return !!(p && c && c.width > 0); });
            if (ok) break; await sleep(400);
        }
        await sleep(400);
    }

    async function n08Run(tag, withMidShot) {
        await freshNote();
        const C = await centerW();
        const pts = [];
        for (let x = -150; x <= 150; x += 5) pts.push([C.x + x, C.y - 80 + 3 * Math.sin(x / 20)]);
        const n = pts.length;
        const dEnd = [pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]];
        const nrm = Math.hypot(dEnd[0], dEnd[1]) || 1;
        const probe = { wx: pts[n - 1][0] - dEnd[0] / nrm * 12,
                        wy: pts[n - 1][1] - dEnd[1] / nrm * 12,
                        ux: dEnd[0], uy: dEnd[1] };
        const c0 = await w2c(pts[0][0], pts[0][1]);
        await page.mouse.move(c0.x, c0.y);
        await page.mouse.down();
        for (let i = 1; i < n; i++) {
            const c = await w2c(pts[i][0], pts[i][1]);
            await page.mouse.move(c.x, c.y);
            await sleep(5);
            if (withMidShot && i === Math.floor(n / 2)) {
                await page.screenshot({ path: path.join(QA_DIR, '_n08diag_mid.png') });
            }
        }
        await sleep(45);
        const sh = await shadowState();
        const cross = await crossWetRun(probe.wx, probe.wy, probe.ux, probe.uy);
        await page.mouse.up();
        await sleep(500);
        console.log(tag + ': shadow=' + JSON.stringify(sh ? { visible: sh.visible, cls: sh.cls, hold: sh.dbg && sh.dbg.hold } : null) +
            ' cross.wrun=' + cross.wrun + ' n=' + cross.n);
        console.log('   vs=' + JSON.stringify(cross.vs));
    }

    await n08Run('A noMidShot ', false);
    await n08Run('B withMidShot', true);
    await browser.close(); srv.close();
    console.log('DONE');
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1); });
