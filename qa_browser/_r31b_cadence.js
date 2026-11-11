'use strict';
/* qa/_r31b_cadence.js — DIAGNOSTICA aperta R31b:
   1) cadenza reale pointermove CDP (penMoves delay=5) con e senza ombra attiva;
   2) latenza in-page G05: istante del pointermove -> cambio endpoint piano ombra;
   3) gap ts reali nella coda (per capire se la finestra flick 250ms regge).
   Uso: node qa/_r31b_cadence.js */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8891;
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
        if (ok) break;
        await sleep(250);
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
    // listener cadenza in-page
    await page.evaluate(() => {
        window.__cad = { t: [], move: 0 };
        window.addEventListener('pointermove', () => { window.__cad.t.push(performance.now()); window.__cad.move++; }, true);
    });
    async function cadReset() { await page.evaluate(() => { window.__cad.t = []; window.__cad.move = 0; }); }
    async function cadGet() {
        return page.evaluate(() => {
            const t = window.__cad.t, gaps = [];
            for (let i = 1; i < t.length; i++) gaps.push(+(t[i] - t[i - 1]).toFixed(1));
            gaps.sort((a, b) => a - b);
            return { n: t.length, gaps,
                     med: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
                     max: gaps.length ? gaps[gaps.length - 1] : null,
                     span: t.length > 1 ? +(t[t.length - 1] - t[0]).toFixed(1) : 0 };
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

    const C = await centerW();
    console.log('CENTER ' + JSON.stringify(C));

    // ---- 1) cadenza SENZA ombra (stroke veloce) ----
    const s1 = [];
    for (let x = -150; x <= 150; x += 10) s1.push([C.x + x, C.y - 120]);
    await cadReset();
    await penDown(s1);
    const d1 = await penMoves(s1, 1, s1.length, 5);
    await penUp(s1);
    await sleep(400);
    const g1 = await cadGet();
    console.log('CAD no-shadow: penMoves=' + d1 + 'ms/' + (s1.length - 1) + 'pt ' + JSON.stringify(g1));

    // ---- 2) cadenza CON ombra (hold fino a visible, poi ext) ----
    const ptsB = [];
    for (let x = -252; x <= 60; x += 4) ptsB.push([C.x + x, C.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')); });
    // nuova nota pulita
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
    await page.evaluate(() => window.__ink.setZoom(2.45));
    await sleep(150);
    const C2 = await centerW();

    const ptsB2 = [];
    for (let x = -252; x <= 60; x += 4) ptsB2.push([C2.x + x, C2.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
    await cadReset();
    await penDown(ptsB2);
    const d2 = await penMoves(ptsB2, 1, ptsB2.length, 5);
    console.log('CAD with-shadow main: penMoves=' + d2 + 'ms/' + (ptsB2.length - 1) + 'pt ' + JSON.stringify(await cadGet()));
    // sosta -> ombra
    let s = null;
    for (let i = 0; i < 30; i++) { s = await sh(); if (s && s.visible) break; await sleep(20); }
    console.log('SHADOW after hold: ' + JSON.stringify({ visible: s && s.visible, cls: s && s.cls }));

    // ---- 3) G05 in-page: arm poller, poi ext moves ----
    await page.evaluate(() => {
        const G = window.__g05 = { tMove: 0, lats: [], armed: false, prevEnd: null, iv: 0, evN: 0 };
        window.__g05Move = () => { if (G.armed) { G.tMove = performance.now(); G.evN++; } };
        window.addEventListener('pointermove', window.__g05Move, true);
        G.iv = setInterval(() => {
            if (!G.armed) return;
            const sh = window.__ink.shadow ? window.__ink.shadow() : null;
            if (!sh || !sh.visible || !sh.pts || !sh.pts.length) return;
            const e = sh.pts[sh.pts.length - 1];
            const key = e[0].toFixed(2) + ',' + e[1].toFixed(2);
            if (G.prevEnd == null) { G.prevEnd = key; return; }
            if (key !== G.prevEnd) {
                G.prevEnd = key;
                if (G.tMove) G.lats.push(+(performance.now() - G.tMove).toFixed(1));
            }
        }, 10);
        G.armed = true; G.lats = []; G.prevEnd = null;
    });
    await cadReset();
    const ext = [];
    for (let x = 64; x <= 164; x += 4) ext.push([C2.x + x, C2.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
    const d3 = await penMoves(ext, 0, ext.length, 5);
    const g05 = await page.evaluate(() => {
        const G = window.__g05; G.armed = false; clearInterval(G.iv);
        window.removeEventListener('pointermove', window.__g05Move, true);
        return { lats: G.lats, evN: G.evN };
    });
    const g3 = await cadGet();
    console.log('CAD ext-with-shadow: penMoves=' + d3 + 'ms/' + ext.length + 'pt ' + JSON.stringify(g3));
    console.log('G05 in-page lats(' + g05.lats.length + ') evN=' + g05.evN + ': ' + JSON.stringify(g05.lats));
    console.log('G05 max=' + (g05.lats.length ? Math.max(...g05.lats) : 'n/a'));

    // ts gaps reali in coda (ultimo movimento vs precedenti)
    const tsInfo = await page.evaluate(() => {
        const pts = window.__ink.activePts() || [];
        return { n: pts.length, pn: pts[pts.length - 1] };
    });
    console.log('ACTIVE pts: ' + JSON.stringify(tsInfo));

    // classify completo full-line+ext (offline in pagina) — deve essere line
    const clsInfo = await page.evaluate(() => {
        const pts = window.__ink.activePts() || [];
        const IC = window.InkCommit;
        try {
            const r = IC.classify(pts, { ts: null, size: 3, noSnap: false });
            return { cls: r.cls, kind: r.params && r.params.kind, n: pts.length };
        } catch (e) { return { err: e.message }; }
    });
    console.log('CLASSIFY full (ts=null): ' + JSON.stringify(clsInfo));

    await browser.close(); srv.close();
    console.log('DONE');
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1); });
