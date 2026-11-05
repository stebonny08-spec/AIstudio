'use strict';
/* qa_browser/qaR24_church_schemi.js - R24 CHURCH T2 REALE (R3.2):
   normFontiWidth verificata sulla PAGINA REALE index.html (stessa catena
   ?v= del BUILD, server static, Puppeteer/CDP reale - pattern identico a
   qa_browser/qaR24_r0_repro.js).

   PRIMA : interception di js/modules/schemi.js -> serve
           qa/r24_schemi_baseline.js (copia pre-fix: manca normFontiWidth,
           MD5 verificato) -> il drag largo + resize viewport 1440->1100
           lascia il pannello TAGLIATO a destra dall'overflow:hidden della
           .sc-side (riproduzione del bug).
   DOPO  : schemi.js fissato (interception off, reload) -> stesso flow ->
           normFontiWidth (hook window resize) riallinea la width inline al
           disponibile PRESERVANDO il valore draggato (fp21_w_schemi, R21):
           ASSERT DOM reale panel.right <= side.right, pannello dentro la
           side anche in verticale, nessun overflow.

   Flow: App.go('schemi') -> creazione schema REALE (Nuovo schema ->
   Crea schema via StudyStore.saveItem fallback localStorage); se non
   parte -> seed minimo localStorage ns_items di uno schema valido
   {"nodes":[...],"edges":[...]} compatibile con parseDoc; altrimenti
   PARZIALE con motivo ESATTO. -> pannello lato (toggleSide: la side di
   default e' aperta, altrimenti click "Pannello") -> tab Fonti ->
   verifica pannello dentro .sc-side -> drag .fp21-rz-r per allargare la
   width verso il bordo (CDP reale fin dentro il viewport + movimenti
   mouse oltre il bordo viewport spediti sul listener document, stessa
   sorgente di evento) -> resize viewport 1440->1100 (page.setViewport).

   Patch AMBIENTE dichiarata (stessa R0, SOLO senza pywebview):
   StudyStore.listSubjects race 1500ms; poll store >=48s (READY 20s del
   fallback localStorage).

   Output: qa/r24_church_measures.json (+ sezione RSS gia' nota da
   qa/r24_church_rss.json: 3 casi + floor teorico + budget 6144) +
   qa/r24_church_schemi_prima.png / qa/r24_church_schemi_dopo.png +
   tabella stdout. Exit 0 SOLO se DOPO ok (e PRIMA ha riprodotto il bug).

   Uso: node qa_browser/qaR24_church_schemi.js  [porta default 8879] */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const BASELINE = path.join(QA_DIR, 'r24_schemi_baseline.js');
const RSS_JSON = path.join(QA_DIR, 'r24_church_rss.json');
const PORT = Number(process.argv[2]) || 8879;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRAG_DELTA = 260;          // px di allargamento oltre il bordo side

function staticServer() {
    const srv = http.createServer((req, res) => {
        try {
            const u = decodeURIComponent((req.url || '/').split('?')[0]);
            let p = path.join(APP_DIR, u === '/' ? '/index.html' : u);
            if (!p.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
            const ext = path.extname(p).toLowerCase();
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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

function rssSection() {
    try {
        const r = JSON.parse(fs.readFileSync(RSS_JSON, 'utf8'));
        const wMB = r.weights_bytes / (1024 * 1024);
        const plateau = r.cases.baseline.rss_plateau_mb;
        const kv = r.floor.kv_mb;
        const resto = plateau - wMB - kv;
        const ricalcolo = plateau + 1500;
        return {
            source: 'qa/r24_church_rss.json (probe T1, invariato)',
            ctx: r.n_ctx, cache: r.cache,
            cases_plateau_mb: {
                baseline: r.cases.baseline.rss_plateau_mb,
                b256: r.cases.b256.rss_plateau_mb,
                b256ub256: r.cases.b256ub256.rss_plateau_mb
            },
            floor_teorico: {
                pesi_mappati_mb: Math.round(wMB * 10) / 10,
                kv_q8_0_4096_mb: kv,
                resto_buffer_processo_mb: Math.round(resto * 10) / 10,
                baseline_plateau_mb: plateau
            },
            target_mb: 3600,
            verdict: 'NON_RAGGIUNGIBILE',
            reachable: false,
            budget: {
                DRAFT_RAM_BUDGET_MB: 6144,
                invariato: true,
                ricalcolo_mb: Math.round(ricalcolo * 10) / 10,
                motivazione: 'RSS pro 4435.9 + margine draft 1500 = 5936 < 6144 (margine ~208 MB); spec.draft_model vuoto (default R13, draft spentivo) -> nessuna case <= 3600 -> server.py NON patchato'
            }
        };
    } catch (e) { return { error: String(e) }; }
}

(async () => {
    if (!fs.existsSync(BASELINE)) throw new Error('baseline mancante: qa/r24_schemi_baseline.js');
    const baseSrc = fs.readFileSync(BASELINE, 'utf8');
    if (/normFontiWidth/.test(baseSrc)) throw new Error('baseline NON pre-fix: contiene normFontiWidth');
    const srv = await staticServer();
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
    console.log('BROWSER OK: ' + (await browser.version()) + ' (Puppeteer/CDP reale)');
    const page = await browser.newPage();
    let VW = 1440;
    await page.setViewport({ width: VW, height: 900, deviceScaleFactor: 1 });
    const pageErrors = [], httpFails = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    page.on('response', r => {
        if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) httpFails.push(r.status() + ' ' + r.url());
    });

    // ---- INTERCEPTION: PRIMA = baseline pre-fix, DOPO = source reale ----
    let serveBaseline = true;
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        if (serveBaseline && /\/js\/modules\/schemi\.js(\?|$)/.test(u)) {
            req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8',
                          body: fs.readFileSync(BASELINE) });
        } else {
            req.continue();
        }
    });

    async function gotoHome(tag) {
        console.log('OPEN ' + BASE + '/index.html [' + tag + ']');
        await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
        let ready = false;
        for (let i = 0; i < 60; i++) {
            ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
            if (ready) break;
            await sleep(250);
        }
        if (!ready) throw new Error(tag + ': home non pronta');
        // ---- PATCH AMBIENTE (dichiarata, NON prodotto): solo senza pywebview
        await page.evaluate(() => {
            if (!window.pywebview && window.StudyStore && typeof StudyStore.listSubjects === 'function') {
                const orig = StudyStore.listSubjects.bind(StudyStore);
                StudyStore.listSubjects = function () {
                    return Promise.race([
                        Promise.resolve().then(() => orig()),
                        new Promise(r => setTimeout(() => r([]), 1500))
                    ]).then(v => v || []);
                };
                window.__r0patch_listSubjects = true;
            }
        });
    }

    const btnClick = async (re, scope) => page.evaluate((src, sel) => {
        const rx = new RegExp(src);
        const root = sel ? document.querySelector(sel) : document;
        if (!root) return false;
        const b = Array.from(root.querySelectorAll('button')).find(x => rx.test(x.textContent || ''));
        if (b) { b.click(); return true; }
        return false;
    }, re, scope || null);

    const editorReady = () => page.evaluate(() => {
        const ed = document.querySelector('.sc-editor');
        const side = ed ? ed.querySelector('.sc-side') : null;
        return !!(ed && side);
    });

    // ---------- apertura editor: reale -> seed -> PARZIALE ----------
    async function ensureEditor(tag) {
        await page.evaluate(() => App.go('schemi'));
        // elenco: poll >=48s copre READY 20s del fallback store
        let listReady = false;
        for (let i = 0; i < 96; i++) {
            listReady = await page.evaluate(() =>
                !!Array.from(document.querySelectorAll('#moduleView button'))
                    .find(b => /Nuovo schema/.test(b.textContent || '')) ||
                !!document.querySelector('#moduleView .card.clickable'));
            if (listReady) break;
            await sleep(500);
        }
        if (!listReady) return { mode: 'PARZIALE', reason: tag + ': elenco schemi non pronto entro 48s (né bottone "Nuovo schema" né card)' };

        // --- flusso REALE: Nuovo schema -> Crea schema (saveItem) ---
        const openedNew = await btnClick('Nuovo schema', '#moduleView');
        let choosable = false;
        for (let i = 0; i < 40; i++) {
            choosable = await page.evaluate(() =>
                !!Array.from(document.querySelectorAll('#moduleView button'))
                    .find(b => /Crea schema/.test(b.textContent || '')));
            if (choosable) break;
            await sleep(250);
        }
        let realClick = false, editor = false, realReason = '';
        if (openedNew && choosable) {
            realClick = await btnClick('Crea schema', '#moduleView');
            for (let i = 0; i < 60; i++) {   // saveItem attende READY 20s
                editor = await editorReady();
                if (editor) break;
                await sleep(500);
            }
            if (!editor) realReason = 'Crea schema cliccato ma .sc-editor non pronto entro 30s';
        } else {
            realReason = !openedNew ? 'bottone "Nuovo schema" non trovato'
                : 'bottone "Crea schema" non trovato nel chooser entro 10s';
        }
        if (editor) return { mode: 'reale', reason: 'Nuovo schema -> Crea schema -> openEditor' };

        // --- fallback: apri una card esistente (se presente) ---
        const clickedCard = await page.evaluate(() => {
            const c = document.querySelector('#moduleView .card.clickable');
            if (c) { c.click(); return true; }
            return false;
        });
        if (clickedCard) {
            for (let i = 0; i < 40; i++) {
                if (await editorReady()) return { mode: 'reale', reason: 'card esistente aperta (' + realReason + ')' };
                await sleep(250);
            }
        }

        // --- fallback 2: seed minimo localStorage ns_items (parseDoc) ---
        const seeded = await page.evaluate(() => {
            const doc = {
                type: 'libero',
                nodes: [
                    { id: 'seed1', x: 120, y: 120, w: 170, h: 64, text: 'Idea seed', shape: 'round', color: '#3d5afe', border: '#2c3550' },
                    { id: 'seed2', x: 430, y: 260, w: 170, h: 64, text: 'Voce seed', shape: 'round', color: '#3d5afe', border: '#2c3550' }
                ],
                edges: [{ id: 'seedE1', from: 'seed1', to: 'seed2', label: '', color: '#3d5afe' }],
                view: { x: 0, y: 0, zoom: 1 },
                riassunto: '', drawings: [],
                style: { palette: 'scura', nodeFill: '#3d5afe', nodeBorder: '#2c3550', edgeColor: '#3d5afe', fontSize: 14, bold: false, shape: 'round' }
            };
            const item = {
                id: 'seedchurch' + Date.now().toString(16), kind: 'schema',
                title: 'Schema church seed', content: JSON.stringify(doc),
                materia: '', tags: '', description: '', thumbnail: '', folder_id: '',
                created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            try {
                const prev = JSON.parse(localStorage.getItem('ns_items') || '[]');
                localStorage.setItem('ns_items', JSON.stringify([item].concat(prev.filter(x => x.id !== item.id))));
                return { ok: true, id: item.id };
            } catch (e) { return { ok: false, err: String(e) }; }
        });
        if (!seeded.ok) return { mode: 'PARZIALE', reason: realReason + ' | seed localStorage fallito: ' + seeded.err };
        // torna all'elenco (Annulla nel chooser se presente) e riapri
        await btnClick('Annulla', '#moduleView');
        await sleep(300);
        await page.evaluate(() => App.go('schemi'));
        let card = false;
        for (let i = 0; i < 60; i++) {
            card = await page.evaluate(() => {
                const c = document.querySelector('#moduleView .card.clickable');
                if (c) { c.click(); return true; }
                return false;
            });
            if (card) break;
            await sleep(500);
        }
        if (!card) return { mode: 'PARZIALE', reason: realReason + ' | seed applicato (' + seeded.id + ') ma card non trovata/aperta entro 30s' };
        for (let i = 0; i < 60; i++) {
            if (await editorReady()) return { mode: 'seed', reason: realReason + ' | seed ns_items ' + seeded.id + ' -> card -> openEditor' };
            await sleep(500);
        }
        return { mode: 'PARZIALE', reason: realReason + ' | seed ' + seeded.id + ' ma .sc-editor non pronto entro 30s' };
    }

    // ---------- tab Fonti + verifica pannello dentro .sc-side ----------
    async function setupFontiTab() {
        const sideOpen = await page.evaluate(() => {
            const s = document.querySelector('.sc-editor .sc-side');
            return { exists: !!s, visible: !!s && !s.classList.contains('hidden') };
        });
        let toggled = false;
        if (!sideOpen.visible) {
            toggled = await btnClick('Pannello', '.sc-editor');
            await sleep(300);
        }
        const tabOk = await page.evaluate(() => {
            const t = Array.from(document.querySelectorAll('.sc-side .sc-tab'))
                .find(b => /Fonti/.test(b.textContent || ''));
            if (t) { t.click(); return true; }
            return false;
        });
        await sleep(500);
        const info = await page.evaluate(() => {
            const side = document.querySelector('.sc-editor .sc-side');
            const panel = side ? side.querySelector('.fp21-root') : null;
            const fb = side ? side.querySelector('.sc-note') : null;
            return {
                sideExists: !!side,
                sideWasHidden: side ? side.classList.contains('hidden') : null,
                panelExists: !!panel,
                inSide: !!(panel && side && panel.closest('.sc-side') === side),
                fallbackText: fb ? (fb.textContent || '').slice(0, 80) : ''
            };
        });
        info.tabOk = tabOk;
        info.toggled = toggled;
        return info;
    }

    async function readRects() {
        return page.evaluate(() => {
            const side = document.querySelector('.sc-editor .sc-side');
            const panel = side ? side.querySelector('.fp21-root') : null;
            if (!side || !panel) return { error: !side ? 'side assente' : 'panel assente' };
            const host = panel.parentElement;
            const sr = side.getBoundingClientRect();
            const pr = panel.getBoundingClientRect();
            const hr = host ? host.getBoundingClientRect() : null;
            let ls = null;
            try { ls = localStorage.getItem('fp21_w_schemi'); } catch (e) { ls = null; }
            const hs = host ? getComputedStyle(host) : null;
            return {
                side: { left: +sr.left.toFixed(2), top: +sr.top.toFixed(2), right: +sr.right.toFixed(2), bottom: +sr.bottom.toFixed(2), w: +sr.width.toFixed(2), h: +sr.height.toFixed(2), clientW: side.clientWidth, scrollW: side.scrollWidth },
                host: hr ? { left: +hr.left.toFixed(2), top: +hr.top.toFixed(2), right: +hr.right.toFixed(2), bottom: +hr.bottom.toFixed(2), clientW: host.clientWidth, scrollW: host.scrollWidth, padL: parseFloat(hs.paddingLeft) || 0, padR: parseFloat(hs.paddingRight) || 0 } : null,
                panel: { left: +pr.left.toFixed(2), top: +pr.top.toFixed(2), right: +pr.right.toFixed(2), bottom: +pr.bottom.toFixed(2), w: +pr.width.toFixed(2), h: +pr.height.toFixed(2) },
                inlineW: (panel.style.width || '').trim(),
                lsW: ls,
                cutRightPx: +(pr.right - sr.right).toFixed(2),   // >0 = tagliato a destra
                cutLeftPx: +(sr.left - pr.left).toFixed(2),      // >0 = fuori a sinistra
                outTopPx: +(sr.top - pr.top).toFixed(2),         // >0 = fuori sopra
                outBottomPx: +(pr.bottom - sr.bottom).toFixed(2),// >0 = fuori sotto
                overflowX: side.scrollWidth - side.clientWidth,
                hostOverflowX: host ? host.scrollWidth - host.clientWidth : null
            };
        });
    }

    // ---------- drag .fp21-rz-r (handle destro) ----------
    async function dragPanel(delta) {
        const handle = await page.evaluate(() => {
            const h = document.querySelector('.sc-side .fp21-rz-r');
            if (!h) return null;
            const r = h.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
        });
        if (!handle) return { ok: false, reason: 'handle .fp21-rz-r assente' };
        const hit = await page.evaluate((x, y) => {
            const e = document.elementFromPoint(x, y);
            return e ? String(e.className || '') : '';
        }, handle.x, handle.y);
        const hitOk = /fp21-rz-r/.test(hit);
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        const sx = handle.x, sy = handle.y, targetX = sx + delta;
        const edge = VW - 2;
        const realEnd = Math.min(targetX, edge);
        const N = 14;
        for (let i = 1; i <= N; i++) {
            await page.mouse.move(sx + (realEnd - sx) * i / N, sy);
            await sleep(8);
        }
        let synthCount = 0;
        if (targetX > realEnd + 1) {
            const S = 12, xs = [];
            for (let i = 1; i <= S; i++) xs.push(realEnd + (targetX - realEnd) * i / S);
            synthCount = await page.evaluate((arr, y) => {
                arr.forEach(x => document.dispatchEvent(
                    new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y })));
                return arr.length;
            }, xs, sy);
        }
        await page.mouse.up();
        await sleep(250);
        return { ok: true, hitOk: hitOk, hitClass: hit, sx: +sx.toFixed(1), targetX: +targetX.toFixed(1), realEnd: +realEnd.toFixed(1), synthCount: synthCount, vw: VW };
    }

    // ---------- una fase completa (PRIMA o DOPO) ----------
    async function phase(tag, shotName) {
        const out = { tag: tag, env: {} };
        await gotoHome(tag);
        out.env = {
            pywebview: await page.evaluate(() => typeof window.pywebview),
            patch_listSubjects: await page.evaluate(() => !!window.__r0patch_listSubjects)
        };
        out.flow = await ensureEditor(tag);
        out.editor = await editorReady();
        if (out.flow.mode === 'PARZIALE' || !out.editor) {
            if (out.flow.mode !== 'PARZIALE') out.flow = { mode: 'PARZIALE', reason: tag + ': .sc-editor non pronto' };
            return out;
        }
        out.fontiTab = await setupFontiTab();
        if (!out.fontiTab.panelExists) {
            out.flow = { mode: 'PARZIALE', reason: tag + ': tab Fonti aperto ma pannello Fonti non montato nella .sc-side' + (out.fontiTab.fallbackText ? ' (fallback: ' + out.fontiTab.fallbackText + ')' : '') };
            return out;
        }
        out.pre = await readRects();
        out.drag = await dragPanel(DRAG_DELTA);
        await sleep(200);
        out.postDrag = await readRects();
        // resize viewport 1440 -> 1100 (trigger window resize -> normFontiWidth)
        VW = 1100;
        await page.setViewport({ width: VW, height: 900, deviceScaleFactor: 1 });
        await sleep(800);
        out.post = await readRects();
        await page.screenshot({ path: path.join(QA_DIR, shotName) });
        out.screenshot = shotName;
        out.viewportAfter = '1100x900';
        return out;
    }

    const M = {
        ts: new Date().toISOString(),
        tool: 'Puppeteer/CDP reale (stesso pattern qaR24_r0_repro.js)',
        viewport: '1440x900 -> resize 1100x900',
        baseline: { file: 'qa/r24_schemi_baseline.js', md5: require('crypto').createHash('md5').update(fs.readFileSync(BASELINE)).digest('hex').toUpperCase(), hasNormFontiWidth: false },
        dragDeltaPx: DRAG_DELTA
    };

    // =================== PRIMA (baseline pre-fix via interception) ===================
    M.prima = await phase('PRIMA', 'r24_church_schemi_prima.png');
    console.log('PRIMA flow: ' + JSON.stringify(M.prima.flow) +
        ' env=' + JSON.stringify(M.prima.env));
    if (M.prima.pre && !M.prima.pre.error) {
        console.log('PRIMA pre:      ' + JSON.stringify(M.prima.pre));
        console.log('PRIMA postDrag: inline=' + M.prima.postDrag.inlineW + ' cut=' + M.prima.postDrag.cutRightPx + ' ls=' + M.prima.postDrag.lsW);
        console.log('PRIMA post-resize: inline=' + M.prima.post.inlineW + ' cut=' + M.prima.post.cutRightPx + ' overflowX=' + M.prima.post.overflowX);
    }

    // =================== DOPO (schemi.js fissato) ===================
    serveBaseline = false;
    VW = 1440;
    await page.setViewport({ width: VW, height: 900, deviceScaleFactor: 1 });
    M.dopo = await phase('DOPO', 'r24_church_schemi_dopo.png');
    console.log('DOPO flow: ' + JSON.stringify(M.dopo.flow));
    if (M.dopo.pre && !M.dopo.pre.error) {
        console.log('DOPO pre:      ' + JSON.stringify(M.dopo.pre));
        console.log('DOPO postDrag: inline=' + M.dopo.postDrag.inlineW + ' cut=' + M.dopo.postDrag.cutRightPx + ' ls=' + M.dopo.postDrag.lsW);
        console.log('DOPO post-resize: inline=' + M.dopo.post.inlineW + ' cut=' + M.dopo.post.cutRightPx + ' overflowX=' + M.dopo.post.overflowX);
    }

    // =================== ASSERT ===================
    const pm = M.prima.flow ? M.prima.flow.mode : 'PARZIALE';
    const dm = M.dopo.flow ? M.dopo.flow.mode : 'PARZIALE';
    ok(pm !== 'PARZIALE', 'A1 PRIMA: editor schemi aperto (modo=' + pm + ')',
        (M.prima.flow && M.prima.flow.reason) || '');
    ok(dm !== 'PARZIALE', 'A2 DOPO: editor schemi aperto (modo=' + dm + ')',
        (M.dopo.flow && M.dopo.flow.reason) || '');
    if (M.prima.fontiTab) ok(!!M.prima.fontiTab.inSide, 'A3 PRIMA: pannello Fonti dentro .sc-side (tab Fonti)');
    if (M.dopo.fontiTab) ok(!!M.dopo.fontiTab.inSide, 'A4 DOPO: pannello Fonti dentro .sc-side (tab Fonti)');

    if (pm !== 'PARZIALE' && dm !== 'PARZIALE') {
        ok(!!M.prima.drag.ok && M.prima.drag.hitOk,
            'A5 PRIMA: drag reale sul handle .fp21-rz-r (hit=' + (M.prima.drag.hitClass || 'n/d') + ')');
        ok(parseFloat(M.prima.postDrag.inlineW) >= 400,
            'A6 PRIMA: drag allarga il pannello (inline=' + M.prima.postDrag.inlineW + ' >= 400)',
            'pre=' + M.prima.pre.inlineW);
        ok(M.prima.post.cutRightPx > 5,
            'P1 PRIMA baseline: taglio persiste dopo resize 1100 (cut=' + M.prima.post.cutRightPx + 'px)',
            JSON.stringify({ inline: M.prima.post.inlineW, overflowX: M.prima.post.overflowX }));
        ok(!!M.dopo.drag.ok && M.dopo.drag.hitOk,
            'A7 DOPO: drag reale sul handle .fp21-rz-r (hit=' + (M.dopo.drag.hitClass || 'n/d') + ')');
        ok(parseFloat(M.dopo.postDrag.inlineW) >= 400,
            'A8 DOPO: precondizione - drag largo creato (inline=' + M.dopo.postDrag.inlineW + ' >= 400)',
            'pre=' + M.dopo.pre.inlineW);
        ok(M.dopo.post.cutRightPx <= 0.5,
            'D1 DOPO: panel.right <= side.right dopo resize (cut=' + M.dopo.post.cutRightPx + 'px, inline=' + M.dopo.post.inlineW + ')');
        ok(M.dopo.post.cutLeftPx <= 0.5,
            'D2 DOPO: pannello non esce a sinistra (fuori=' + M.dopo.post.cutLeftPx + 'px)');
        ok(M.dopo.post.outTopPx <= 0.5 && M.dopo.post.outBottomPx <= 0.5,
            'D3 DOPO: pannello dentro .sc-side in verticale (top=' + M.dopo.post.outTopPx + ', bottom=' + M.dopo.post.outBottomPx + ')');
        ok(M.dopo.post.overflowX <= 1 && M.dopo.post.hostOverflowX <= 1,
            'D4 DOPO: nessun overflow orizzontale (side=' + M.dopo.post.overflowX + ', host=' + M.dopo.post.hostOverflowX + ')');
        const dragged = parseFloat(M.dopo.postDrag.lsW);
        const lsAfter = parseFloat(M.dopo.post.lsW);
        const inlineAfter = parseFloat(M.dopo.post.inlineW);
        ok(isFinite(lsAfter) && isFinite(dragged) && Math.abs(lsAfter - dragged) <= 2 &&
           lsAfter > inlineAfter,
            'D5 resize R21 preservato: fp21_w_schemi=' + M.dopo.post.lsW +
            ' invariata dal clamp (inline dopo=' + M.dopo.post.inlineW + ')',
            'drag=' + M.dopo.postDrag.lsW);
    }

    ok(pageErrors.length === 0, 'E1 pageerrors 0 (PRIMA+DOPO)', JSON.stringify(pageErrors.slice(0, 3)));
    ok(httpFails.length === 0, 'E2 nessuna risposta HTTP >=400', JSON.stringify(httpFails.slice(0, 3)));

    M.asserts = { pass: pass, fail: fail, failures: failures.slice() };
    M.partial = (pm === 'PARZIALE' || dm === 'PARZIALE');
    if (M.partial) {
        M.partialReason = [pm === 'PARZIALE' ? 'PRIMA: ' + M.prima.flow.reason : null,
                           dm === 'PARZIALE' ? 'DOPO: ' + M.dopo.flow.reason : null]
            .filter(Boolean).join(' || ');
        console.log('PARZIALE: ' + M.partialReason);
    }
    M.rss = rssSection();
    M.pageErrors = pageErrors;
    M.httpFails = httpFails;
    fs.writeFileSync(path.join(QA_DIR, 'r24_church_measures.json'), JSON.stringify(M, null, 1));

    // ---- TABELLA ----
    const ppost = M.prima.post || {}, dpost = M.dopo.post || {};
    console.log('\n==== TABELLA R24 CHURCH T2 (R3.2, PRIMA -> DOPO) ====');
    console.log('1. flow PRIMA/DOPO ...................... ' + pm + ' -> ' + dm);
    console.log('2. PRIMA pre -> postDrag inline .......... ' + (M.prima.pre ? M.prima.pre.inlineW + ' -> ' + M.prima.postDrag.inlineW : 'n/d'));
    console.log('3. PRIMA post-resize cut/overflow ........ ' + ppost.cutRightPx + 'px / ' + ppost.overflowX + 'px (baseline pre-fix)');
    console.log('4. DOPO pre -> postDrag inline ........... ' + (M.dopo.pre ? M.dopo.pre.inlineW + ' -> ' + M.dopo.postDrag.inlineW : 'n/d'));
    console.log('5. DOPO post-resize cut/inline/overflow .. ' + dpost.cutRightPx + 'px / ' + dpost.inlineW + 'px / ' + dpost.overflowX + 'px');
    console.log('6. fp21_w_schemi (drag -> dopo clamp) .... ' + (M.dopo.postDrag ? M.dopo.postDrag.lsW + ' -> ' + M.dopo.post.lsW : 'n/d'));
    console.log('7. RSS floor: pesi ' + (M.rss.floor_teorico ? M.rss.floor_teorico.pesi_mappati_mb : '?') + 'MB + kv ' + (M.rss.floor_teorico ? M.rss.floor_teorico.kv_q8_0_4096_mb : '?') + 'MB, target ' + M.rss.target_mb + 'MB -> ' + M.rss.verdict + ' | budget ' + M.rss.budget.DRAFT_RAM_BUDGET_MB + ' invariato');
    console.log('screenshot: qa/' + (M.prima.screenshot || 'n/d') + ', qa/' + (M.dopo.screenshot || 'n/d'));
    console.log('measures: qa/r24_church_measures.json');
    console.log('\nRISULTATO qaR24_church_schemi: ' + pass + ' passati, ' + fail + ' falliti' + (M.partial ? ' (PARZIALE: ' + M.partialReason + ')' : ''));
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));

    await browser.close();
    srv.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('R24 CHURCH T2 FAIL: ' + (e && e.stack || e)); process.exit(1); });
