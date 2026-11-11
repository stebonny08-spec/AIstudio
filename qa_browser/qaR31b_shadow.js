'use strict';
/* qa_browser/qaR31b_shadow.js — R31-bis (PROMPT ROUND 29-bis): OMBRA
   (anteprima live linea/arco) — scenari Q06-Q12 su APP REALE.
   Server static + Puppeteer/CDP, pointer reali, index.html con la stessa
   catena ?v= del build (QA_TS invariato = round29).
   Copre: Q06 linea+sosta+miratura (3 istanti live + post), Q07 arco,
   Q08 no-ombra su freeform/loop, Q09 rilascio senza sosta, Q10 freccia con
   ombra (punta), Q11 non-persistenza (undo/redo + zero grigio), Q12 zoom
   100%/245%. Conferma N02-bis in ogni scenario.
   Output: qa/r31b_shadow_measures.json + qa/r31b_q*.png + tabella.
   Uso: node qa_browser/qaR31b_shadow.js  [porta default 8880] */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8880;
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
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(fs.readFileSync(p));
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise(resolve => srv.listen(PORT, '127.0.0.1', () => resolve(srv)));
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

(async () => {
    const srv = await staticServer();
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
    console.log('BROWSER OK: ' + (await browser.version()));
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const pageErrors = [], httpFails = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    page.on('response', r => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) httpFails.push(r.status() + ' ' + r.url()); });

    const M = { ts: new Date().toISOString(), build: 'QA_TS=2026-11-09T19:30:00+01:00 (invariato round29)', q: {} };

    // ---------- infra (stessa catena di qaR31_ink) ----------
    async function openEditor(tag) {
        console.log('OPEN ' + BASE + '/index.html [' + tag + ']');
        await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
        let ready = false;
        for (let i = 0; i < 60; i++) {
            ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
            if (ready) break;
            await sleep(250);
        }
        if (!ready) throw new Error(tag + ': home non pronta');
        await page.evaluate(() => {
            if (!window.pywebview && window.StudyStore && typeof StudyStore.listSubjects === 'function') {
                const orig = StudyStore.listSubjects.bind(StudyStore);
                StudyStore.listSubjects = function () {
                    return Promise.race([Promise.resolve().then(() => orig()),
                        new Promise(r => setTimeout(() => r([]), 1500))]).then(v => v || []);
                };
                window.__r0patch_listSubjects = true;
            }
        });
        await page.evaluate(() => App.go('notes'));
        let listReady = false;
        for (let i = 0; i < 40; i++) {
            listReady = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
            if (listReady) break;
            await sleep(250);
        }
        if (listReady) await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || ''));
            if (b) b.click();
        });
        let created = false;
        for (let i = 0; i < 30; i++) {
            created = await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || ''));
                if (b) { b.click(); return true; } return false;
            });
            if (created) break;
            await sleep(300);
        }
        let notesReady = false;
        for (let i = 0; i < 96; i++) {
            notesReady = await page.evaluate(() => {
                const pill = document.querySelector('.fn-pill-left');
                const c = document.querySelector('.nt-stage canvas');
                return !!(pill && c && c.width > 0);
            });
            if (notesReady) break;
            await sleep(500);
        }
        if (!notesReady) throw new Error(tag + ': modulo notes non pronto');
        await sleep(500);
    }
    async function freshNote(tag) {
        const back = await page.$('button[title^="Torna"]');
        if (back) { await back.click(); await sleep(450); }
        let listReady = false;
        for (let i = 0; i < 30; i++) {
            listReady = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
            if (listReady) break;
            await sleep(250);
        }
        await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || ''));
            if (b) b.click();
        });
        let created = false;
        for (let i = 0; i < 30; i++) {
            created = await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || ''));
                if (b) { b.click(); return true; } return false;
            });
            if (created) break;
            await sleep(300);
        }
        let notesReady = false;
        for (let i = 0; i < 60; i++) {
            notesReady = await page.evaluate(() => {
                const pill = document.querySelector('.fn-pill-left');
                const c = document.querySelector('.nt-stage canvas');
                return !!(pill && c && c.width > 0);
            });
            if (notesReady) break;
            await sleep(400);
        }
        if (!notesReady) throw new Error(tag + ': fresh note non pronta');
        await sleep(400);
    }
    async function toClients(pts) {
        return page.evaluate((pts) => {
            const ink = window.__ink;
            const a = ink.toWorld(0, 0), b = ink.toWorld(100, 0), d = ink.toWorld(0, 100);
            const kx = (b.x - a.x) / 100, ky = (d.y - a.y) / 100;
            return pts.map(p => ({ x: (p[0] - a.x) / kx, y: (p[1] - a.y) / ky }));
        }, pts);
    }
    async function centerW() {
        return page.evaluate(() => {
            const c = document.querySelector('.nt-stage canvas');
            const r = c.getBoundingClientRect();
            return window.__ink.toWorld(r.left + r.width / 2, r.top + r.height / 2);
        });
    }
    async function sh() {
        return page.evaluate(() => (window.__ink.shadow ? window.__ink.shadow() : null));
    }
    async function ap() {
        return page.evaluate(() => window.__ink.activePts());
    }
    async function objs() { return page.evaluate(() => window.__ink.objects()); }
    async function st() { return page.evaluate(() => window.__ink.state()); }
    async function traceCount(k) {
        return page.evaluate(k => window.__ink.trace.filter(e => e.k === k).length, k);
    }
    async function waitForSwap(prev, timeoutMs) {
        const t0 = Date.now();
        while (Date.now() - t0 < (timeoutMs || 2500)) {
            const n = await traceCount('swap');
            if (n > prev) { await sleep(60); return n; }
            await sleep(40);
        }
        return await traceCount('swap');
    }
    async function waitForIdle(timeoutMs) {
        const t0 = Date.now();
        while (Date.now() - t0 < (timeoutMs || 4000)) {
            const s = await st();
            if (s.pending === 0) { await sleep(80); if ((await st()).pending === 0) return; }
            await sleep(50);
        }
    }
    /* G05: latenza in-page movimento -> aggiornamento piano ombra.
       Il clock nodo (poll CDP) misura anche la latenza CDP/headless di
       quel run; qui si misura performance.now() del pointermove vs il
       cambio di endpoint del piano (poll 10ms in pagina). */
    async function g05Arm() {
        await page.evaluate(() => {
            const G = window.__g05 = { tMove: 0, lats: [], armed: true, prevEnd: null, iv: 0, evN: 0 };
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
        });
    }
    async function g05Read() {
        return page.evaluate(() => {
            const G = window.__g05;
            if (!G) return { lats: [], evN: 0, max: null, avg: null };
            G.armed = false; clearInterval(G.iv);
            window.removeEventListener('pointermove', window.__g05Move, true);
            const lats = G.lats.slice();
            return { lats: lats, evN: G.evN,
                     max: lats.length ? Math.max.apply(null, lats) : null,
                     avg: lats.length ? +(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1) : null };
        });
    }
    /* ---- controllo penna (coordinate mondo -> client batch) ---- */
    async function penDown(pts) {
        const cc = await toClients([pts[0]]);
        await page.mouse.move(cc[0].x, cc[0].y);
        await page.mouse.down();
    }
    async function penMoves(pts, i0, i1, delay) {
        const cc = await toClients(pts.slice(i0, i1));
        const t0 = Date.now();
        for (let i = 0; i < cc.length; i++) {
            await page.mouse.move(cc[i].x, cc[i].y);
            if (delay) await sleep(delay);
        }
        return Date.now() - t0;
    }
    async function penUp(pts) {
        const cc = await toClients([pts[pts.length - 1]]);
        await page.mouse.move(cc[0].x, cc[0].y);
        await page.mouse.up();
    }
    /* stazione di probe: punti presi da un campionamento INTERPOLATO
       dell'ideale (~64 campioni) con dev = distanza punto->polyline GREZZA
       (point-to-polyline, NON per-indice: per una LINEA plan.pts ha solo
       2 punti -> per-indice darebbe 0 stazioni). Coda bagnata esclusa
       (>=60world dalla fine), tangent dai vicini del campione, top3 per
       dev con separazione minima. */
    function ptSeg(px, py, a, b) {
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const L2 = vx * vx + vy * vy;
        if (!(L2 > 0)) return Math.hypot(px - a[0], py - a[1]);
        let t = ((px - a[0]) * vx + (py - a[1]) * vy) / L2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t));
    }
    function stationsOf(ideal, raw, devMin) {
        if (!ideal || ideal.length < 2) return [];
        const NS = 64;
        const segs = [];
        let total = 0;
        for (let i = 1; i < ideal.length; i++) {
            const d = dist(ideal[i - 1], ideal[i]);
            segs.push(d); total += d;
        }
        if (!(total > 0)) return [];
        const tailOff = total > 80 ? 60 : 0;   // coda bagnata (L02)
        const samp = [];
        let k = 0, run = 0;
        for (let j = 0; j < NS; j++) {
            const target = total * j / (NS - 1);
            while (k < segs.length - 1 && run + segs[k] < target) { run += segs[k]; k++; }
            const t = segs[k] > 0 ? (target - run) / segs[k] : 0;
            const a = ideal[k], b = ideal[Math.min(ideal.length - 1, k + 1)];
            const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
            let dev = 0;
            if (raw && raw.length) {
                if (raw.length === 1) dev = dist([x, y], raw[0]);
                else {
                    dev = Infinity;
                    for (let i = 1; i < raw.length; i++) dev = Math.min(dev, ptSeg(x, y, raw[i - 1], raw[i]));
                }
            }
            samp.push({ j: j, x: x, y: y, fromEnd: total - target, dev: dev });
        }
        const cand = samp.filter(s => s.dev >= devMin && s.fromEnd >= tailOff);
        cand.sort((p, q) => q.dev - p.dev);
        const minSep = 8;   // separazione in campioni (di 64)
        const out = [];
        for (const s of cand) {
            if (out.length >= 3) break;
            if (out.some(o => Math.abs(o.j - s.j) < minSep)) continue;
            const a = samp[Math.max(0, s.j - 1)], b = samp[Math.min(NS - 1, s.j + 1)];
            const tx = b.x - a.x, ty = b.y - a.y;
            const L = Math.hypot(tx, ty) || 1;
            out.push({ idx: s.j, x: s.x, y: s.y, ux: tx / L, uy: ty / L, dev: +s.dev.toFixed(2) });
        }
        return out;
    }
    /* probe pixel: scan perpendicolare in spazio MONDO; band grigio ombra
       (blend nero40% su carta ~150-160, croma<=8) + run consecutivo */
    /* diag=1: scarica i campioni RGB(A) reali del PRIMO station + coord
       (serve a tarare la banda grigia sul colore REALE dell'ombra) */
    async function grayProbe(stations, diag) {
        return page.evaluate((stations, diag) => {
            const ink = window.__ink;
            const c = document.querySelector('.nt-stage canvas');
            const ctx = c.getContext('2d');
            const A = ink.toWorld(0, 0), B = ink.toWorld(100, 0), D = ink.toWorld(0, 100);
            const kx = (B.x - A.x) / 100, ky = (D.y - A.y) / 100;
            const rect = c.getBoundingClientRect();
            const dpr = c.width / rect.width;
            const out = [];
            for (const st of stations) {
                const L = Math.hypot(st.ux, st.uy) || 1;
                const nx = -st.uy / L, ny = st.ux / L;
                let run = 0, maxRun = 0, gray = 0, dark = 0;
                const samples = [];
                const isFirst = (out.length === 0);
                for (let s = -10; s <= 10.001; s += 0.25) {
                    const qx = st.x + nx * s, qy = st.y + ny * s;
                    const cxp = (qx - A.x) / kx, cyp = (qy - A.y) / ky;
                    const px = Math.round((cxp - rect.left) * dpr);
                    const py = Math.round((cyp - rect.top) * dpr);
                    if (px < 0 || py < 0 || px >= c.width || py >= c.height) { run = 0; continue; }
                    const d = ctx.getImageData(px, py, 1, 1).data;
                    const r = d[0], g = d[1], b = d[2];
                    if (diag && isFirst) samples.push([r, g, b, d[3]]);
                    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = (r + g + b) / 3;
                    const isGray = (mx - mn <= 8 && v >= 135 && v <= 190);
                    if (isGray) { gray++; run++; if (run > maxRun) maxRun = run; } else run = 0;
                    if (v < 90) dark++;
                }
                const rec = { wrun: +(maxRun * 0.25).toFixed(2), gray: gray, dark: dark };
                if (diag && isFirst) {
                    let ip = 'n/a';
                    try { ip = ink.pageAt(st.x, st.y); } catch (e) { ip = 'err'; }
                    rec.st = { x: +st.x.toFixed(1), y: +st.y.toFixed(1), dev: st.dev, inPage: ip };
                    rec.samples = samples;
                }
                out.push(rec);
            }
            return out;
        }, stations, !!diag);
    }
    function maxRun(arr, key) { return arr.reduce((m, x) => Math.max(m, x[key]), 0); }
    function sumDark(arr) { return arr.reduce((s, x) => s + x.dark, 0); }

    await openEditor('Q06');

    // ================================================================
    // Q06 — LINEA + SOSTA + MIRATURA (zoom 245%)
    // ================================================================
    {
        const tag = 'Q06';
        await page.evaluate(() => window.__ink.setZoom(2.45));
        await sleep(150);
        const C = await centerW();
        const Mq = {};
        Mq.cam = await page.evaluate((Cc) => {
            const s = window.__ink.state();
            return { C: [+Cc.x.toFixed(1), +Cc.y.toFixed(1)], dw: s.dw, dh: s.dh,
                     zoom: s.zoom, inPage: window.__ink.pageAt(Cc.x, Cc.y) };
        }, C);
        console.log('DIAG cam Q06: ' + JSON.stringify(Mq.cam));
        // stroke A pre-commessa (G12: l'ombra su B non tocca A)
        const ptsA = [];
        for (let x = -170; x <= -70; x += 6) ptsA.push([C.x + x, C.y + 110]);
        let sw0 = await traceCount('swap');
        await penDown(ptsA); await penMoves(ptsA, 1, ptsA.length, 4); await penUp(ptsA);
        await waitForSwap(sw0); await waitForIdle();
        const snapA0 = JSON.stringify(await objs());
        // B: linea ondulata span312 con estremi a FASE NULLA (x relativo):
        // dev/garanzia stessa di V01 -> classe line con margine (thr7.8px)
        const ptsB = [];
        for (let x = -252; x <= 60; x += 4) ptsB.push([C.x + x, C.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
        await penDown(ptsB);
        // spec Q06: sosta sulla linea COMPLETA (fino all'estremo x=+60):
        // fermarsi a x=-12 lascia un salto di 76px con l'estensione ->
        // nf=2 -> freeform al rilascio
        const tB = Date.now();
        await penMoves(ptsB, 1, ptsB.length, 5);
        Mq.penMs = Date.now() - tB;
        const tLastMove = Date.now();
        // G01: NON deve apparire prima di ~150ms
        await sleep(140);
        let s0 = await sh();
        ok(s0 && s0.visible === false, 'Q06.1 ombra NON visibile a140ms dalla sosta (G01)',
            JSON.stringify({ visible: s0 && s0.visible }));
        // attesa attivazione (G01: entro ~250ms + slack)
        let s1 = null, tVis = null;
        for (let i = 0; i < 30; i++) {
            s1 = await sh();
            if (s1 && s1.visible) { tVis = Date.now() - tLastMove; break; }
            await sleep(20);
        }
        Mq.actMs = tVis;
        // DIAGNOSTICA classify/pts sul canvas reale (prima degli assert)
        Mq.diag = await page.evaluate(() => {
            const pts = window.__ink.activePts() || [];
            const IC = window.InkCommit;
            const out = { n: pts.length, sp: typeof IC.shadowPlan,
                          p0: pts[0], pn: pts[pts.length - 1] };
            try {
                const r = IC.classify(pts, { ts: null, size: 3, noSnap: false });
                out.clsNoTs = r.cls + '/' + (r.params && r.params.kind);
            } catch (e) { out.clsNoTs = 'THROW:' + e.message; }
            try {
                const r2 = IC.shadowPlan(pts, { ts: null, size: 3, noSnap: false });
                out.spNoTs = r2 ? r2.cls : null;
            } catch (e) { out.spNoTs = 'THROW:' + e.message; }
            let L = 0;
            for (let i = 1; i < pts.length; i++)
                L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            out.pathLen = +L.toFixed(1);
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
            out.bbox = [+(x1 - x0).toFixed(1), +(y1 - y0).toFixed(1)];
            return out;
        });
        console.log('DIAG pts: ' + JSON.stringify(Mq.diag));
        ok(!!(s1 && s1.visible) && tVis !== null && tVis <= 300,
            'Q06.2 ombra visibile entro ~250ms di sosta (G01)',
            'dt=' + tVis + ' s1=' + JSON.stringify(s1));
        ok(s1 && s1.cls === 'line', 'Q06.3 ombra cls=line (G01: solo T01/T02)', s1 ? s1.cls : 'null');
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q06_1_ombra.png') });
        // G09: nessun oggetto commesso dall'ombra (B e A: solo A in doc)
        const objsDuring = await objs();
        ok(objsDuring.length === 1, "Q06.4 G09: l'ombra non commetta (solo A in doc)",
            String(objsDuring.length));
        // G12: tool invariato
        const stA = await st();
        ok(stA.tool === 'penna', 'Q06.5 G12: tool invariato con ombra attiva', stA.tool);
        // N02-bis: il grezzo non morfing durante la sosta
        const holdA = await ap();
        await sleep(600);
        const holdB = await ap();
        ok(JSON.stringify(holdA) === JSON.stringify(holdB),
            'Q06.9 N02-bis: grezzo identico durante la sosta (nessun morfing)', '');
        // G05: miratura — estensione con penna giu
        const s1end = (s1 && s1.pts) ? s1.pts[s1.pts.length - 1].slice() : [0, 0];
        // estensione della STESSA sinusoidale (la classe resta line durante
        // la miratura: G05/G07 — una rampa diritta la farebbe uscire da T01)
        const ext = [];
        for (let x = 64; x <= 164; x += 4) {
            ext.push([C.x + x, C.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
        }
        await g05Arm();
        const tMove0 = Date.now();
        const extMs = await penMoves(ext, 0, ext.length, 5);
        Mq.extMs = extMs;
        console.log('DIAG penMoves Q06 ext: ' + extMs + 'ms /' + ext.length + 'pt');
        let s2 = null, tUpd = null;
        const s2t0 = Date.now();
        for (let i = 0; i < 20; i++) {
            s2 = await sh();
            if (s2 && s2.visible && s2.pts && dist(s2.pts[s2.pts.length - 1], s1end) > 2) {
                tUpd = Date.now() - s2t0;
                break;
            }
            await sleep(20);
        }
        const g05a = await g05Read();
        Mq.updNodeMs = tUpd;
        Mq.updMs = g05a.max;
        Mq.updLats = g05a.lats;
        console.log('DIAG G05 Q06: ' + JSON.stringify(g05a));
        ok(!!(s2 && s2.visible), 'Q06.10 ombra resta visibile durante il movimento (G05/G07)',
            JSON.stringify({ visible: s2 && s2.visible, cls: s2 && s2.cls }));
        ok(g05a.lats.length > 0 && g05a.max !== null && g05a.max <= 100,
            'Q06.11 ombra aggiornata entro100ms dal movimento (G05)',
            'max=' + g05a.max + 'ms n=' + g05a.lats.length + ' node=' + tUpd);
        ok(s2 && s2.pts && dist(s2.pts[s2.pts.length - 1], s1end) >= 2,
            "Q06.12 geometria ombra segue l'estremita (G05)",
            s2 && s2.pts ? dist(s2.pts[s2.pts.length - 1], s1end).toFixed(1) : 'null');
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q06_2_miratura.png') });
        // G07: nuova sosta -> riconferma
        await sleep(300);
        const s3 = await sh();
        ok(!!(s3 && s3.visible) && s3.cls === 'line',
            'Q06.13 ombra riconfermata dopo nuova sosta (G07)',
            JSON.stringify({ visible: s3 && s3.visible, cls: s3 && s3.cls }));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q06_3_reconferma.png') });
        const s3pts = s3 && s3.pts ? s3.pts.map(p => [p[0], p[1]]) : null;
        // G03 pixel: stazioni deviazione ideale-grezzo + coda bagnata esclusa.
        // DOPO la miratura: il probe getImageData sezza il rendering del
        // canvas per il resto della nota (frames31->2/500ms, vedi
        // qa/_r31b_bisect.js) -> la misura G05 deve girare PRIMA.
        const raw1 = await ap();
        const sts = stationsOf(s3pts, raw1, 2.5);
        ok(sts.length >= 1, 'Q06.6 stazioni probe (dev>=2.5px mondo)',
            String(sts.length) + ' ' + JSON.stringify(sts.map(s => [s.idx, s.dev])));
        const gp1 = await grayProbe(sts, true);
        console.log('DIAG gray Q06: ' + JSON.stringify(gp1.map(g => ({ wrun: g.wrun, gray: g.gray, dark: g.dark, st: g.st }))));
        if (gp1[0] && gp1[0].samples) console.log('DIAG rgb Q06: ' + JSON.stringify(gp1[0].samples));
        Mq.liveProbe = gp1; Mq.stations = sts;
        ok(maxRun(gp1, 'wrun') >= 2.5, 'Q06.7 pixel OMBRA grigia in sezione >=2.5px mondo (G02)',
            JSON.stringify(gp1));
        ok(sumDark(gp1) >= 2, 'Q06.8 grezzo NERO ancora visibile sotto (G03)',
            JSON.stringify(gp1));
        // G06: rilascio = geometria ultima ombra (endpoint <=1px)
        const sw1 = await traceCount('swap');
        // rilascio dove la penna e' DOVVERO (x=+164 con ext): penUp(ptsB)
        // scatterebbe l'ultimo punto a x=+60 (snap inkLastRaw) -> teleporto
        // di 104px -> nf esplode -> freeform (endpoint=104.058).
        await penUp(ptsB.concat(ext));
        await waitForSwap(sw1);
        await waitForIdle();
        const post = await objs();
        const lineB = post[post.length - 1];
        let endErr = Infinity;
        if (s3pts && lineB && lineB.pts) {
            endErr = Math.max(dist(s3pts[s3pts.length - 1], lineB.pts[lineB.pts.length - 1]),
                              dist(s3pts[0], lineB.pts[0]));
        }
        Mq.endErr = +endErr.toFixed(3);
        ok(lineB && lineB.vclass === 'line', 'Q06.14 rilascio -> linea commessa (K01-K02 invariati)',
            lineB ? lineB.vclass : 'null');
        ok(endErr <= 1, 'Q06.15 endpoint ombra->commit <=1px (G06)', endErr.toFixed(3));
        // N02-bis post: nessun residuo grigio + nessun elemento ombra
        const sPost = await sh();
        ok(sPost && sPost.visible === false, 'Q06.16 N02-bis: ombra inesistente dopo il rilascio (G10)',
            JSON.stringify(sPost));
        const stsPost = stationsOf(s3pts, null, -1);
        const gpPost = await grayProbe(stsPost);
        Mq.postProbe = gpPost;
        ok(maxRun(gpPost, 'wrun') <= 1.5, 'Q06.17 N02-bis: zero pixel grigi post-commit (<=1.5px mondo)',
            JSON.stringify(gpPost));
        ok(post.length === 2 && JSON.stringify(post.slice(0, 1)) === JSON.stringify(JSON.parse(snapA0).slice(0, 1)),
            "Q06.18 G12/C03: tratto A invariato; doc = A + B (l'ombra non e oggetto)",
            'n=' + post.length);
        const stEnd = await st();
        ok(stEnd.tool === 'penna', 'Q06.19 G12: tool invariato al rilascio', stEnd.tool);
        // Q11: undo/redo -> solo inchiostro, mai elementi ombra
        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        });
        await sleep(150);
        let u = await objs();
        ok(u.length === 1, 'Q11.1 undo rimuove SOLO il tratto B (nessun elemento ombra nello stack)',
            String(u.length));
        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
        });
        await sleep(150);
        u = await objs();
        ok(u.length === 2 && u[1].vclass === 'line', "Q11.2 redo ripristina l'inchiostro identico (G09/G11)",
            JSON.stringify(u.map(o => o.vclass)));
        const gpRedo = await grayProbe(stsPost);
        ok(maxRun(gpRedo, 'wrun') <= 1.5, 'Q11.3 zero grigio anche dopo undo/redo', JSON.stringify(gpRedo));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q06_post.png') });
        M.q06 = Mq;
    }

    // ================================================================
    // Q07 — ARCO + MIRATURA (zoom 245%)
    // ================================================================
    {
        const tag = 'Q07';
        await freshNote(tag);
        await page.evaluate(() => window.__ink.setZoom(2.45));
        await sleep(150);
        const C = await centerW();
        const Mq = {};
        const cx = C.x + 40, cy = C.y - 30, R = 60;
        const arc = [];
        for (let i = 0; i <= 36; i++) {
            const a = -Math.PI / 2 + (i / 36) * (Math.PI * 0.66);   // ~120 gradi
            const wob = 4 * Math.sin((i / 36) * Math.PI * 2);      // onda lenta (stazione pixel)
            arc.push([cx + (R + wob) * Math.cos(a), cy + (R + wob) * Math.sin(a)]);
        }
        await penDown(arc);
        await penMoves(arc, 1, arc.length, 5);
        const tLast = Date.now();
        await sleep(140);
        let s0 = await sh();
        ok(s0 && s0.visible === false, 'Q07.1 nessuna ombra prima dei ~150ms (G01)',
            JSON.stringify({ visible: s0 && s0.visible }));
        let s1 = null, tVis = null;
        for (let i = 0; i < 30; i++) {
            s1 = await sh();
            if (s1 && s1.visible) { tVis = Date.now() - tLast; break; }
            await sleep(20);
        }
        Mq.actMs = tVis;
        ok(!!(s1 && s1.visible) && tVis <= 300, 'Q07.2 ombra arco entro ~250ms (G01)', 'dt=' + tVis);
        ok(s1 && s1.cls === 'arc', 'Q07.3 ombra cls=arc con curvatura preservata (G01)',
            s1 ? s1.cls : 'null');
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q07_1_ombra.png') });
        // miratura: estendere l'arco con penna giu
        const s1end = (s1 && s1.pts) ? s1.pts[s1.pts.length - 1].slice() : [0, 0];
        const ext = [];
        let aa = -Math.PI / 2 + (36 / 36) * (Math.PI * 0.66);
        for (let i = 1; i <= 14; i++) {
            aa += 0.045;
            const wob = 2.5 * Math.sin((1 + i / 2) * Math.PI * 2);
            ext.push([cx + (R + wob) * Math.cos(aa), cy + (R + wob) * Math.sin(aa)]);
        }
        await g05Arm();
        await penMoves(ext, 0, ext.length, 5);
        const tU0 = Date.now();
        let s2 = null, tUpd = null;
        for (let i = 0; i < 20; i++) {
            s2 = await sh();
            if (s2 && s2.visible && s2.pts && dist(s2.pts[s2.pts.length - 1], s1end) > 2) {
                tUpd = Date.now() - tU0; break;
            }
            await sleep(20);
        }
        const g05b = await g05Read();
        Mq.updNodeMs = tUpd;
        Mq.updMs = g05b.max;
        Mq.updLats = g05b.lats;
        console.log('DIAG G05 Q07: ' + JSON.stringify(g05b));
        ok(!!(s2 && s2.visible), 'Q07.7 ombra arco segue il movimento (G05)',
            JSON.stringify({ visible: s2 && s2.visible, cls: s2 && s2.cls }));
        ok(g05b.lats.length > 0 && g05b.max !== null && g05b.max <= 100,
            'Q07.8 aggiornamento <=100ms (G05)',
            'max=' + g05b.max + 'ms n=' + g05b.lats.length + ' node=' + tUpd);
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q07_2_miratura.png') });
        await sleep(300);
        const s3 = await sh();
        ok(!!(s3 && s3.visible) && s3.cls === 'arc', 'Q07.9 riconferma arco dopo sosta (G07)',
            JSON.stringify({ visible: s3 && s3.visible, cls: s3 && s3.cls }));
        const s3pts = s3 && s3.pts ? s3.pts.map(p => [p[0], p[1]]) : null;
        // pixel probe DOPO la misura G05 (getImageData sezza il rendering:
        // vedi qa/_r31b_bisect.js) — stazioni sull'ideale della riconferma
        const raw1 = await ap();
        const sts = stationsOf(s3pts, raw1, 1.5);
        const gp1 = sts.length ? await grayProbe(sts) : [];
        Mq.liveProbe = gp1; Mq.stations = sts;
        ok(sts.length >= 1, 'Q07.4 stazioni probe (dev>=1.5px)', String(sts.length));
        ok(gp1.length && maxRun(gp1, 'wrun') >= 1.5, 'Q07.5 pixel ombra arco >=1.5px mondo (G02)',
            JSON.stringify(gp1));
        ok(sumDark(gp1) >= 2, "Q07.6 grezzo sotto l'ombra ancora visibile (G03)", JSON.stringify(gp1));
        const sw1 = await traceCount('swap');
        await penUp(arc.concat(ext));
        await waitForSwap(sw1);
        await waitForIdle();
        const post = await objs();
        const arcO = post[post.length - 1];
        let endErr = Infinity;
        if (s3pts && arcO && arcO.pts) {
            endErr = Math.max(dist(s3pts[s3pts.length - 1], arcO.pts[arcO.pts.length - 1]),
                              dist(s3pts[0], arcO.pts[0]));
        }
        Mq.endErr = +endErr.toFixed(3);
        ok(arcO && arcO.vclass === 'arc', "Q07.10 rilascio -> arco commesso (G06: identico all'ombra)",
            arcO ? arcO.vclass + '/' + (arcO.params && arcO.params.kind) : 'null');
        ok(endErr <= 1, 'Q07.11 endpoint ombra->commit <=1px (G06)', endErr.toFixed(3));
        const sPost = await sh();
        ok(sPost && sPost.visible === false, 'Q07.12 N02-bis: nessuna ombra post (G10)', JSON.stringify(sPost));
        const stsP = stationsOf(s3pts, null, -1);
        const gpP = stsP.length ? await grayProbe(stsP) : [];
        Mq.postProbe = gpP;
        ok(gpP.length && maxRun(gpP, 'wrun') <= 1.0, 'Q07.13 zero grigio post-commit (<=1px mondo)',
            JSON.stringify(gpP));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q07_post.png') });
        M.q07 = Mq;
    }

    // ================================================================
    // Q08 — NO-OMBRA su freeform (S due flessi) e loop (T03/T04)
    // ================================================================
    {
        const tag = 'Q08';
        await freshNote(tag);
        await page.evaluate(() => window.__ink.setZoom(2.45));
        await sleep(150);
        const C = await centerW();
        const Mq = {};
        // S con due flessi + sosta LUNGA
        const S = [];
        for (let i = 0; i <= 75; i++) {
            const t = i / 75;
            S.push([C.x - 60 + 40 * Math.sin(2 * Math.PI * t), C.y - 140 + 280 * t]);
        }
        await penDown(S);
        await penMoves(S, 1, S.length, 4);
        const holdA = await ap();
        await sleep(400);
        const holdA2 = await ap();
        await sleep(900);   // sosta lunga (ben oltre250ms)
        const sS = await sh();
        Mq.S_visible = sS && sS.visible;
        ok(sS && sS.visible === false,
            'Q08.1 S (2 flessi, T03): NESSUNA ombra con sosta lunga (G04)',
            JSON.stringify(sS));
        ok(JSON.stringify(holdA) === JSON.stringify(holdA2),
            'Q08.2 N02-bis: grezzo S immutato durante la sosta (nessun morfing)', '');
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q08_s_noshadow.png') });
        const sw0 = await traceCount('swap');
        await penUp(S);
        await waitForSwap(sw0); await waitForIdle();
        let po = await objs();
        ok(po[0] && po[0].vclass === 'freeform', 'Q08.3 S comunque commesso come freeform (G11)',
            po[0] ? po[0].vclass : 'null');
        // loop con auto-intersezione + sosta
        await freshNote(tag + '-loop');
        await page.evaluate(() => window.__ink.setZoom(2.45));
        await sleep(150);
        const C2 = await centerW();
        const loop = [];
        for (let x = -150; x <= -80; x += 5) loop.push([C2.x + x, C2.y - 60]);
        for (let i = 0; i <= 48; i++) {
            const a = Math.PI + (i / 48) * Math.PI * 2.3;
            loop.push([C2.x - 55 + 25 * Math.cos(a), C2.y - 60 + 25 * Math.sin(a)]);
        }
        await penDown(loop);
        await penMoves(loop, 1, loop.length, 4);
        await sleep(1200);
        const sL = await sh();
        Mq.loop_visible = sL && sL.visible;
        ok(sL && sL.visible === false,
            'Q08.4 loop (T04): NESSUNA ombra con sosta lunga (G04)', JSON.stringify(sL));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q08_loop_noshadow.png') });
        const sw1 = await traceCount('swap');
        await penUp(loop);
        await waitForSwap(sw1); await waitForIdle();
        po = await objs();
        ok(po[0] && po[0].vclass === 'freeform', 'Q08.5 loop commesso comunque (G11)',
            po[0] ? po[0].vclass : 'null');
        M.q08 = Mq;
    }

    // ================================================================
    // Q09 — RILASCIO SENZA SOSTA (commit come round29, mai ombra)
    // ================================================================
    {
        const tag = 'Q09';
        await freshNote(tag);
        await page.evaluate(() => window.__ink.setZoom(2.45));
        await sleep(150);
        const C = await centerW();
        const Mq = {};
        const pts = [];
        for (let x = -160; x <= 160; x += 5) pts.push([C.x + x, C.y - 50 + 3 * Math.sin(x / 18)]);
        await penDown(pts);
        await penMoves(pts, 1, 20, 4);
        const mid = await sh();
        ok(mid && mid.visible === false, 'Q09.1 NESSUNA ombra durante il movimento normale senza sosta (N02-bis)',
            JSON.stringify(mid));
        await penMoves(pts, 20, pts.length, 4);
        const last = await sh();
        ok(last && last.visible === false, 'Q09.2 ombra mai comparsa fino al rilascio', JSON.stringify(last));
        const sw0 = await traceCount('swap');
        await penUp(pts);
        const swapT0 = Date.now();
        await waitForSwap(sw0);
        await waitForIdle();
        const swapEv = await page.evaluate(() => window.__ink.trace.filter(e => e.k === 'swap').slice(-1)[0]);
        const post = await objs();
        Mq.swapDt = swapEv && swapEv.dt;
        ok(swapEv && swapEv.dt >= 150 && swapEv.dt <= 320,
            'Q09.3 commit identico al round29: swap150-320ms senza ombra (G11/K01)',
            swapEv ? String(swapEv.dt) : 'null');
        ok(post[0] && post[0].vclass === 'line', 'Q09.4 linea commessa normalmente',
            post[0] ? post[0].vclass : 'null');
        const sPost = await sh();
        ok(sPost && sPost.visible === false, 'Q09.5 nessun residuo ombra post (N02-bis)', JSON.stringify(sPost));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q09_post.png') });
        M.q09 = Mq;
    }

    // ================================================================
    // Q10 — FRECCIA CON OMBRA (linea + sosta + flick da giu)
    // ================================================================
    {
        const tag = 'Q10';
        await freshNote(tag);
        await page.evaluate(() => window.__ink.setZoom(2.45));
        await sleep(150);
        const C = await centerW();
        const Mq = {};
        const line = [];
        // asta: sinusoide "line-safe" a FASE NULLA ai due estremi
        // (span 264 = 11 periodi): dev corda ~2.6px con amp 3 -> T01 line
        // con margine ANCHE quando il flick taglia l'ultimo punto della
        // finestra (dev del troncato ~5.1 < 6.5); stazioni pixel G02 con
        // devMin 2.0: dev ideale-grezzo ~2.6 >= 2.0 (l'amp 4 con fase
        // iniziale -1 dava dev 7.9 > 6.7 -> bez 'arc' = Q10.1 FAIL)
        for (let x = -144; x <= 120; x += 4) line.push([C.x + x, C.y - 70 + 3 * Math.sin(2 * Math.PI * x / 24)]);
        await penDown(line);
        await penMoves(line, 1, line.length, 5);
        const tLast = Date.now();
        await sleep(280);
        const s1 = await sh();
        ok(!!(s1 && s1.visible) && s1.cls === 'line',
            'Q10.1 ombra linea dopo sosta (G01)',
            JSON.stringify({ visible: s1 && s1.visible, cls: s1 && s1.cls }));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q10_1_ombra.png') });
        // flick da giu (penna ancora giu): la punta entra nell'ombra (G08)
        const e = line[line.length - 1];
        // F01: V reale di 4 punti dentro la finestra flick 250ms (la sosta
        // 280ms isola la coda: win = fine linea + 4 flick, bbox ~20px).
        // Gambe >= flickMinLegPx=8 e angolo ~169-172 >= flickVAngleDeg=100
        // in ENTRAMBI i casi di bordo finestra (vecchio V a 2 punti: gamba
        // 7.5px < 8 -> sotto soglia spec A01, correttamente non rilevato).
        const flick = [
            [e[0] + 2, e[1] - 2],
            [e[0] + 9, e[1] - 6],
            [e[0] + 16, e[1] - 10],
            [e[0] + 1, e[1] + 2]
        ];
        await penMoves(flick, 0, flick.length, 8);
        await sleep(80);   // lascia aggiornare l'ombra (frame)
        const s2 = await sh();
        Mq.flickShadow = { visible: s2 && s2.visible, cls: s2 && s2.cls, head: s2 && s2.head };
        ok(!!(s2 && s2.visible), 'Q10.2 ombra resta visibile col flick (G08)',
            JSON.stringify(Mq.flickShadow));
        ok(s2 && s2.head === true && s2.cls === 'arrow',
            'Q10.3 ombra include la PUNTA saldata (sagoma asta+punta, G08)',
            JSON.stringify(Mq.flickShadow));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q10_2_con_punta.png') });
        const s2pts = s2 && s2.pts ? s2.pts.map(p => [p[0], p[1]]) : null;
        const rawShaft = await ap();
        const sts = stationsOf(s2pts, rawShaft, 2.0);
        const gp1 = sts.length ? await grayProbe(sts) : [];
        Mq.liveProbe = gp1;
        ok(gp1.length && maxRun(gp1, 'wrun') >= 2.0, 'Q10.4 pixel asta ombra (G02)',
            JSON.stringify(gp1));
        const sw1 = await traceCount('swap');
        await penUp(line.concat(flick));
        await waitForSwap(sw1); await waitForIdle();
        const post = await objs();
        const arr = post[post.length - 1];
        let endErr = Infinity;
        if (s2pts && arr && arr.pts) {
            endErr = Math.max(dist(s2pts[s2pts.length - 1], arr.pts[arr.pts.length - 1]),
                              dist(s2pts[0], arr.pts[0]));
        }
        Mq.endErr = +endErr.toFixed(3);
        ok(arr && arr.vclass === 'arrow' && arr.params && arr.params.head,
            'Q10.5 rilascio -> freccia nera asta+punta (G06/K02)',
            arr ? arr.vclass + ' head=' + !!arr.params.head : 'null');
        ok(endErr <= 1, 'Q10.6 asta ombra->commit <=1px (G06)', endErr.toFixed(3));
        const sPost = await sh();
        ok(sPost && sPost.visible === false, 'Q10.7 nessuna ombra post (G10/N02-bis)', JSON.stringify(sPost));
        const stsP = stationsOf(s2pts, null, -1);
        const gpP = stsP.length ? await grayProbe(stsP) : [];
        Mq.postProbe = gpP;
        ok(gpP.length && maxRun(gpP, 'wrun') <= 1.5, 'Q10.8 zero grigio post-commit (N02-bis/Q11)',
            JSON.stringify(gpP));
        ok(post.length === 1, 'Q10.9 asta+punta = UN oggetto, nessun elemento ombra (G09/F04)',
            String(post.length));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q10_post.png') });
        M.q10 = Mq;
    }

    // ================================================================
    // Q12 — ZOOM: stessi scenari a100% (245% = Q06/Q08 principali)
    // ================================================================
    {
        const tag = 'Q12';
        await freshNote(tag + '-z100');
        await page.evaluate(() => window.__ink.setZoom(1));
        await sleep(150);
        const C = await centerW();
        const Mq = {};
        // linea + sosta a100%
        const pts = [];
        for (let x = -252; x <= 60; x += 4) pts.push([C.x + x, C.y - 80 + 4 * Math.sin(2 * Math.PI * x / 24)]);
        await penDown(pts);
        await penMoves(pts, 1, pts.length, 4);
        const tLast = Date.now();
        await sleep(140);
        const s0 = await sh();
        ok(s0 && s0.visible === false, 'Q12.1 z100: nessuna ombra a140ms (G01/G13)',
            JSON.stringify({ visible: s0 && s0.visible }));
        let s1 = null, tVis = null;
        for (let i = 0; i < 30; i++) {
            s1 = await sh();
            if (s1 && s1.visible) { tVis = Date.now() - tLast; break; }
            await sleep(20);
        }
        Mq.actMs = tVis;
        ok(!!(s1 && s1.visible) && s1.cls === 'line', 'Q12.2 z100: ombra linea visibile (stesso esito del245)',
            JSON.stringify({ visible: s1 && s1.visible, cls: s1 && s1.cls }));
        ok(tVis !== null && tVis <= 300, 'Q12.3 z100: attivazione entro ~250ms (G13 identico)', 'dt=' + tVis);
        const raw1 = await ap();
        const sts = stationsOf(s1.pts, raw1, 2.5);
        const gp1 = sts.length ? await grayProbe(sts) : [];
        Mq.liveProbe = gp1;
        ok(gp1.length && maxRun(gp1, 'wrun') >= 2.5,
            'Q12.4 z100: ombra pixel-verificabile (leggibilita G13)', JSON.stringify(gp1));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q12_z100_ombra.png') });
        await sleep(300);
        const s2 = await sh();
        const s2pts = s2 && s2.pts ? s2.pts.map(p => [p[0], p[1]]) : null;
        const sw0 = await traceCount('swap');
        await penUp(pts);
        await waitForSwap(sw0); await waitForIdle();
        const lineZ = (await objs())[0];
        let endErr = Infinity;
        if (s2pts && lineZ && lineZ.pts) {
            endErr = Math.max(dist(s2pts[s2pts.length - 1], lineZ.pts[lineZ.pts.length - 1]),
                              dist(s2pts[0], lineZ.pts[0]));
        }
        Mq.endErr = +endErr.toFixed(3);
        ok(lineZ && lineZ.vclass === 'line' && endErr <= 1,
            'Q12.5 z100: commit=linea, endpoint ombra->commit <=1px (G06/G13)',
            (lineZ ? lineZ.vclass : 'null') + ' end=' + endErr.toFixed(3));
        const stsP = stationsOf(s2pts, null, -1);
        const gpP = stsP.length ? await grayProbe(stsP) : [];
        ok(gpP.length && maxRun(gpP, 'wrun') <= 1.5,
            'Q12.6 z100: zero grigio post (G10)', JSON.stringify(gpP));
        // S a100%: nessuna ombra (stesso esito del245)
        await freshNote(tag + '-z100S');
        await page.evaluate(() => window.__ink.setZoom(1));
        await sleep(150);
        const C2 = await centerW();
        const S = [];
        for (let i = 0; i <= 75; i++) {
            const t = i / 75;
            S.push([C2.x - 60 + 40 * Math.sin(2 * Math.PI * t), C2.y - 140 + 280 * t]);
        }
        await penDown(S);
        await penMoves(S, 1, S.length, 4);
        await sleep(1100);
        const sS = await sh();
        Mq.S_visible = sS && sS.visible;
        ok(sS && sS.visible === false, 'Q12.7 z100: S senza ombra (stesso esito del245, G04/G13)',
            JSON.stringify(sS));
        await page.screenshot({ path: path.join(QA_DIR, 'r31b_q12_z100_noshadow.png') });
        const sw1 = await traceCount('swap');
        await penUp(S);
        await waitForSwap(sw1);
        M.q12 = Mq;
        // parita esiti con245
        ok(M.q06 && M.q06.endErr !== undefined && M.q12.endErr !== undefined,
            'Q12.8 esiti confrontabili con245 (tabella report)', '');
    }

    // ---------- globali + output ----------
    ok(pageErrors.length === 0, 'GLOBAL: zero pageerror', JSON.stringify(pageErrors.slice(0, 4)));
    ok(httpFails.length === 0, 'GLOBAL: zero HTTP>=400', JSON.stringify(httpFails.slice(0, 4)));
    const stEnd = await st();
    ok(stEnd.pending === 0, 'GLOBAL: nessun pending residuo', String(stEnd.pending));

    M.checks = { pass: pass, fail: fail };
    fs.writeFileSync(path.join(QA_DIR, 'r31b_shadow_measures.json'), JSON.stringify(M, null, 1));

    console.log('================ TABELLA Q06-Q12 ================');
    console.log('Q06 attivazione=' + (M.q06 && M.q06.actMs) + 'ms update=' + (M.q06 && M.q06.updMs) +
        'ms endpoint=' + (M.q06 && M.q06.endErr) + 'px | live ' + JSON.stringify(M.q06 && M.q06.liveProbe) +
        ' | post ' + JSON.stringify(M.q06 && M.q06.postProbe));
    console.log('Q07 attivazione=' + (M.q07 && M.q07.actMs) + 'ms update=' + (M.q07 && M.q07.updMs) +
        'ms endpoint=' + (M.q07 && M.q07.endErr) + 'px');
    console.log('Q08 S_visible=' + (M.q08 && M.q08.S_visible) + ' loop_visible=' + (M.q08 && M.q08.loop_visible));
    console.log('Q09 swapDt=' + (M.q09 && M.q09.swapDt) + 'ms (nessuna ombra)');
    console.log('Q10 shadow=' + JSON.stringify(M.q10 && M.q10.flickShadow) + ' endpoint=' + (M.q10 && M.q10.endErr));
    console.log('Q12 z100 attivazione=' + (M.q12 && M.q12.actMs) + 'ms endpoint=' + (M.q12 && M.q12.endErr) +
        ' S_visible=' + (M.q12 && M.q12.S_visible));

    await browser.close();
    console.log('\n===== TOTALE: ' + pass + '/' + (pass + fail) + ' check OK =====');
    if (failures.length) console.log('FAILED:\n - ' + failures.join('\n - '));
    console.log('Misure -> qa/r31b_shadow_measures.json; screenshot -> qa/r31b_*.png');
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
