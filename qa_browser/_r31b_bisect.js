'use strict';
/* qa/_r31b_bisect.js — BISEZIONE lentezza G05 (penMoves estensione 600ms/pt):
   misura cadenza pointermove + frame rAF + latenza in-page ombra DOPO ogni
   operazione sospettata (screenshot, burst getImageData) su tratto attivo
   con ombra visibile (condizione Q06/Q07). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8892;
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
    await page.evaluate(() => window.__ink.setZoom(2.45));
    await sleep(150);

    async function toClients(pts) {
        return page.evaluate((pts) => {
            const ink = window.__ink;
            const a = ink.toWorld(0, 0), b = ink.toWorld(100, 0), d = ink.toWorld(0, 100);
            const kx = (b.x - a.x) / 100, ky = (d.y - a.y) / 100;
            return pts.map(p => ({ x: (p[0] - a.x) / kx, y: (p[1] - a.y) / ky }));
        }, pts);
    }
    async function centerW() {
        return page.evaluate(() => { const c = document.querySelector('.nt-stage canvas'); const r = c.getBoundingClientRect(); return window.__ink.toWorld(r.left + r.width / 2, r.top + r.height / 2); });
    }
    // cadenza eventi + rAF/interval in pagina
    await page.evaluate(() => {
        window.__cad = { t: [] };
        window.addEventListener('pointermove', () => { window.__cad.t.push(performance.now()); }, true);
    });
    async function framesIn(ms) {
        return page.evaluate((ms) => new Promise(res => {
            let n = 0; const t0 = performance.now();
            const r = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(r); else res(n); };
            requestAnimationFrame(r);
        }), ms);
    }
    async function cadStats() {
        return page.evaluate(() => {
            const t = window.__cad.t, gaps = [];
            for (let i = 1; i < t.length; i++) gaps.push(+(t[i] - t[i - 1]).toFixed(1));
            window.__cad.t = [];
            gaps.sort((a, b) => a - b);
            return { n: gaps.length, med: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
                     max: gaps.length ? gaps[gaps.length - 1] : null };
        });
    }
    async function penDown(pts) { const cc = await toClients([pts[0]]); await page.mouse.move(cc[0].x, cc[0].y); await page.mouse.down(); }
    async function penMoves(pts, i0, i1, delay) {
        const cc = await toClients(pts.slice(i0, i1));
        const t0 = Date.now();
        for (let i = 0; i < cc.length; i++) { await page.mouse.move(cc[i].x, cc[i].y); if (delay) await sleep(delay); }
        return Date.now() - t0;
    }
    async function penUp(pts) { const cc = await toClients([pts[pts.length - 1]]); await page.mouse.move(cc[0].x, cc[0].y); await page.mouse.up(); }
    async function sh() { return page.evaluate(() => (window.__ink.shadow ? window.__ink.shadow() : null)); }
    // g05 in-page (stessa della QA)
    async function g05Arm() {
        await page.evaluate(() => {
            const G = window.__g05 = { tMove: 0, lats: [], armed: true, prevEnd: null, iv: 0, evN: 0 };
            window.__g05Move = () => { if (G.armed) { G.tMove = performance.now(); G.evN++; } };
            window.addEventListener('pointermove', window.__g05Move, true);
            G.iv = setInterval(() => {
                if (!G.armed) return;
                const s = window.__ink.shadow ? window.__ink.shadow() : null;
                if (!s || !s.visible || !s.pts || !s.pts.length) return;
                const e = s.pts[s.pts.length - 1];
                const key = e[0].toFixed(2) + ',' + e[1].toFixed(2);
                if (G.prevEnd == null) { G.prevEnd = key; return; }
                if (key !== G.prevEnd) { G.prevEnd = key; if (G.tMove) G.lats.push(+(performance.now() - G.tMove).toFixed(1)); }
            }, 10);
        });
    }
    async function g05Read() {
        return page.evaluate(() => {
            const G = window.__g05;
            if (!G) return { lats: [], evN: 0, max: null };
            G.armed = false; clearInterval(G.iv);
            window.removeEventListener('pointermove', window.__g05Move, true);
            const lats = G.lats.slice();
            return { lats: lats, evN: G.evN, max: lats.length ? Math.max.apply(null, lats) : null };
        });
    }

    const C = await centerW();
    let xEnd = -252;
    const pts = [];
    for (let x = -252; x <= 60; x += 4) pts.push([C.x + x, C.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
    xEnd = 60;
    await penDown(pts);
    await penMoves(pts, 1, pts.length, 5);
    // attesa ombra
    let s = null;
    for (let i = 0; i < 30; i++) { s = await sh(); if (s && s.visible) break; await sleep(20); }
    console.log('SHADOW: ' + JSON.stringify({ visible: s && s.visible, cls: s && s.cls }));

    async function phase(tag) {
        // mini-estensione di 8 punti della stessa sinusoide
        const ext = [];
        const x0 = xEnd + 4;
        for (let x = x0; x <= x0 + 28; x += 4) ext.push([C.x + x, C.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
        xEnd = x0 + 28;
        await g05Arm();
        const fr0 = await framesIn(500);
        const d = await penMoves(ext, 0, ext.length, 5);
        const g = await g05Read();
        const cad = await cadStats();
        console.log(tag + ': frames500=' + fr0 + ' penMoves=' + d + 'ms/8pt gaps=' + JSON.stringify(cad) +
            ' g05max=' + g.max + ' n=' + g.lats.length);
        await sleep(200);
    }

    await phase('A baseline      ');
    await page.screenshot({ path: path.join(__dirname, '..', 'qa', '_bisect_shot.png') });
    await sleep(300);
    await phase('B afterScreenshot');
    // burst getImageData identico a grayProbe (324 letture)
    await page.evaluate(() => {
        const c = document.querySelector('.nt-stage canvas');
        const ctx = c.getContext('2d');
        for (let i = 0; i < 324; i++) {
            const px = (i * 37) % Math.max(1, c.width - 2);
            const py = (i * 53) % Math.max(1, c.height - 2);
            ctx.getImageData(px, py, 1, 1);
        }
    });
    await sleep(300);
    await phase('C afterGetImgDat');
    await page.screenshot({ path: path.join(__dirname, '..', 'qa', '_bisect_shot2.png') });
    await sleep(300);
    await phase('D afterShot2    ');
    // bringToFront (rimedio usato in qaR31)
    await page.bringToFront();
    await sleep(300);
    await phase('E afterFront    ');
    await penUp(pts.concat([]));
    await browser.close(); srv.close();
    console.log('DONE');
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1); });
