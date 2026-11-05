'use strict';
/* qa_browser/qaR30_resp.js - R30 (PROMPT 28) QA-REAL: PREVIEW FONTI
   RESPONSIVA su PAGINA REALE servita con la stessa catena ?v= del BUILD
   (seed reale dal SQLite, mock pywebview fedele al backend).

   L3.1 snapshot adattiva: 3 larghezze pannello (drag REALE) + collasso +
        espanso + devicePixelRatio reale (canvas >= boxW x DPR)
   L3.2 resize finestra 1280/1600/1920: nessun sforamento (scrollWidth<=
        clientWidth+2), root adattatore >= 95% dell'area contenuto
   L3.3 drag+toggle coerenti, nessun leak di ResizeObserver
        (window.FP21_RO.active prima/dopo = uguale)
   L3.4 matrice per tipo: root responsivo + screenshot per adattatore

   Output: qa/r30_*.png, qa/r30_measures.json, qa/r30_results.json
   Esecuzione: node qa_browser/qaR30_resp.js */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8886;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SETTLE = 750;   // RO 80ms + previewFonte21 async + margine

let pass = 0, fail = 0;
const failures = [];
function ok(c, n, x) {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; failures.push(n + (x ? ' | ' + x : '')); console.log('  FAIL  ' + n + (x ? ' | ' + x : '')); }
}
const checks = [];
function rec(id, c, expected, evidence) {
    checks.push({ id, ok: !!c, expected: String(expected), evidence: String(evidence).slice(0, 420) });
    ok(c, id, evidence);
}

/* ---------- seed reale ---------- */
console.log('[seed] dump dal SQLite reale...');
const dump = spawnSync('python', [path.join(QA_DIR, '_r27_dump.py')], {
    cwd: ROOT, encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
});
if (!fs.existsSync(path.join(QA_DIR, 'r27_seed.json'))) {
    console.error('SEED MANCANTE:\n' + (dump.stderr || dump.stdout || ''));
    process.exit(1);
}
const SEED = JSON.parse(fs.readFileSync(path.join(QA_DIR, 'r27_seed.json'), 'utf8'));
const M = SEED.meta;
console.log('[seed] items=' + M.items_total, 'ink=' + (M.ink_note && M.ink_note.title));

/* ---------- server statico ---------- */
function staticServer() {
    const srv = http.createServer((req, res) => {
        try {
            const u = decodeURIComponent((req.url || '/').split('?')[0]);
            if (u === '/favicon.ico') { res.writeHead(204); res.end(); return; }
            if (u === '/seed.json') {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(path.join(QA_DIR, 'r27_seed.json')));
                return;
            }
            const p = path.join(APP_DIR, u === '/' ? '/index.html' : u);
            if (!p.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
            const ext = path.extname(p).toLowerCase();
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(fs.readFileSync(p));
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

/* ---------- mock pywebview (identico al backend: study_list senza content) ---------- */
function installMock() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/seed.json', false);
    xhr.send(null);
    const SEED = JSON.parse(xhr.responseText);
    const items = new Map();
    SEED.items.forEach(i => items.set(i.id, i));
    window.__r30 = { saves: 0 };
    const impl = {
        study_list(kind) {
            let out = Array.from(items.values());
            if (kind) out = out.filter(i => i.kind === kind);
            return Promise.resolve(out.map(i => {
                const c = {};
                Object.keys(i).forEach(k => { if (k !== 'content') c[k] = i[k]; });
                c.preview = String(i.content || '').replace(/\n/g, ' ').slice(0, 180);
                delete c.content;
                return c;
            }));
        },
        study_get(id) {
            const i = items.get(id);
            return Promise.resolve(i ? JSON.parse(JSON.stringify(i)) : null);
        },
        study_save(p) {
            let id = p.id;
            if (!id) { window.__r30.saves++; id = 'qa_save_' + window.__r30.saves + '_' + Date.now(); }
            const prev = items.get(id) || { id: id, created_at: new Date().toISOString() };
            const it = Object.assign({}, prev, p, {
                id: id, updated_at: new Date().toISOString(),
                content: p.content != null ? p.content : (prev.content || '')
            });
            items.set(id, it);
            return Promise.resolve({ item: JSON.parse(JSON.stringify(it)) });
        },
        study_delete(id) { items.delete(id); return Promise.resolve({ success: true }); },
        study_rename(id, title) {
            const i = items.get(id);
            if (i) { i.title = title; i.updated_at = new Date().toISOString(); }
            return Promise.resolve({ success: true });
        },
        subjects_list: () => Promise.resolve([]),
        subjects_save: (p) => Promise.resolve({ subject: p }),
        events_list: () => Promise.resolve([]),
        folders_list: () => Promise.resolve([]),
        get_conversations: () => Promise.resolve(SEED.conversations),
        get_messages: (id) => Promise.resolve(SEED.messages[String(id)] || []),
        materials_list: () => Promise.resolve(SEED.materials),
        read_material_text: (p) => Promise.resolve(SEED.matText[p] || { success: false, error: 'no' }),
        read_material_preview: (p) => Promise.resolve(SEED.matPreview[p] || { success: false, error: 'no' }),
        study_open_file: () => Promise.resolve({ success: true }),
        list_models: () => Promise.resolve([]),
        get_model_status: () => Promise.resolve({ state: 'ready', progress: 1 }),
        app_settings_get: () => Promise.resolve({}),
        app_settings_set: () => Promise.resolve({ ok: true }),
        study_pick_asset: () => Promise.resolve(null),
        pick_notes_file: () => Promise.resolve(null)
    };
    window.pywebview = {
        api: new Proxy(impl, {
            get(t, k) { if (k in t) return t[k]; return () => Promise.resolve(null); }
        })
    };
}

/* ---------- helper pagina (copiati/aderenti a qaR27) ---------- */
const EDITOR_SELS = ['.fn-pill-left', '.doc-canvas', '.sc-side', '.fg-top', '.pp-bar'];
async function editorOpen(page) {
    return page.evaluate(sels => sels.some(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }), EDITOR_SELS);
}
async function bootHome(page) {
    await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
    let ready = false;
    for (let i = 0; i < 80; i++) {
        ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' &&
            document.getElementById('homeView') &&
            !document.getElementById('homeView').classList.contains('hidden')));
        if (ready) break;
        await sleep(250);
    }
    if (!ready) throw new Error('home non pronta');
}
async function goModule(page, mod, params) {
    await page.evaluate((m, p) => App.go(m, p || {}), mod, params || {});
    await sleep(500);
}
async function openFirstApri(page) {
    let idxs = [];
    for (let t = 0; t < 20 && !idxs.length; t++) {
        idxs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#moduleView button'))
                .map((x, i) => {
                    const label = ((x.textContent || '').trim()) ||
                        (x.getAttribute('title') || '');
                    const r = x.getBoundingClientRect();
                    return (/^\s*Apri/.test(label) && r.width > 0) ? i : -1;
                })
                .filter(i => i >= 0));
        if (!idxs.length) await sleep(300);
    }
    for (const i of idxs.slice(0, 6)) {
        await page.evaluate(n => {
            const l = Array.from(document.querySelectorAll('#moduleView button')).filter(x => {
                const label = ((x.textContent || '').trim()) ||
                    (x.getAttribute('title') || '');
                return /^\s*Apri/.test(label) && x.getBoundingClientRect().width > 0;
            });
            if (l[n]) l[n].click();
        }, i);
        for (let t = 0; t < 16; t++) {
            if (await editorOpen(page)) return true;
            await sleep(250);
        }
        await page.evaluate(() => {
            document.querySelectorAll('.modal-overlay').forEach(o => {
                if (o.parentNode) o.parentNode.removeChild(o);
            });
        });
    }
    if (!idxs.length) {
        const cardSel = await page.evaluate(() => {
            const sels = ['.dc-card', '.pp-card', '.vl-card', '.nt-card'];
            for (const s of sels) {
                const c = document.querySelector(s);
                if (c && c.getBoundingClientRect().width > 0) { c.click(); return s; }
            }
            return '';
        });
        if (cardSel) {
            for (let t = 0; t < 16; t++) {
                if (await editorOpen(page)) return true;
                await sleep(250);
            }
        }
    }
    return await editorOpen(page);
}
async function waitEditor(page, sel, extra) {
    for (let i = 0; i < 80; i++) {
        const okk = await page.evaluate((s, e) => {
            const el = document.querySelector(s);
            if (!el) return false;
            if (e && !document.querySelector(e)) return false;
            return true;
        }, sel, extra || null);
        if (okk) return true;
        await sleep(250);
    }
    return false;
}
function panelState(page, ctx) {
    return page.evaluate(c => {
        const p = document.querySelector('.fp21-root[data-fp21="' + c + '"]');
        if (!p) return { exists: false, visible: false };
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        return {
            exists: true,
            visible: cs.display !== 'none' && cs.visibility !== 'hidden' &&
                r.width > 0 && r.height > 0
        };
    }, ctx);
}
async function waitPanel(page, ctx, want, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeout || 6000)) {
        const s = await panelState(page, ctx);
        if (s.visible === want) return s;
        await sleep(200);
    }
    return panelState(page, ctx);
}
async function clickFonti(page, ctx) {
    const sel = ctx === 'appunti' ? '[data-fonti]' :
        '[title="Apri/chiudi il pannello Fonti"]';
    await page.evaluate(s => {
        const b = document.querySelector(s);
        if (b) b.click();
    }, sel);
}
async function ensurePanelOpen(page, ctx) {
    let s = await panelState(page, ctx);
    if (!s.visible) {
        await clickFonti(page, ctx);
        s = await waitPanel(page, ctx, true, 6000);
    }
    return s.visible;
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(QA_DIR, name + '.png') });
    console.log('  SHOT qa/' + name + '.png');
}

/* ---------- selettore chip/riga + attesa preview ---------- */
async function pickChip(page, label) {
    await page.evaluate(l => {
        const c = Array.from(document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-chip'))
            .find(x => (x.textContent || '').trim() === l);
        if (c) c.click();
    }, label);
    await sleep(300);
}
async function pickRow(page, title) {
    return page.evaluate(t => {
        const rows = Array.from(document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-item'));
        const r = rows.find(x => (x.textContent || '').indexOf(t) >= 0);
        if (r) r.click();
        return !!r;
    }, title);
}
async function previewReady(page, wantSnap) {
    for (let i = 0; i < 40; i++) {
        const h = await page.evaluate((wsnap) => {
            const pb = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-pbody');
            const t = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-ptitle');
            const txt = t ? (t.textContent || '') : '';
            const root = pb ? pb.querySelector('.fp21-aroot') : null;
            const snap = pb ? pb.querySelector('img.fp21-snap') : null;
            const okT = txt && txt.indexOf('Seleziona') < 0 && txt.indexOf('Caricamento') < 0;
            const okR = root && root.innerHTML.trim().length > 0;
            const okS = !wsnap || (snap && Number(snap.getAttribute('data-cw') || 0) > 0);
            return { ok: okT && okR && okS, html: root ? root.innerHTML : '' };
        }, !!wantSnap);
        if (h.ok) return h;
        await sleep(200);
    }
    return { ok: false, html: '' };
}
const settle = () => sleep(SETTLE);

/* ---------- metriche preview (area contenuto + root + snap) ---------- */
function pm(page) {
    return page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        if (!p) return null;
        const pb = p.querySelector('.fp21-pbody');
        if (!pb) return null;
        const cs = getComputedStyle(pb);
        const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const boxW = pb.clientWidth - padX;
        const boxH = pb.clientHeight - padY;
        const root = pb.querySelector('.fp21-aroot');
        const img = pb.querySelector('img.fp21-snap');
        const dpr = window.devicePixelRatio || 1;
        const out = {
            boxW: Math.round(boxW), boxH: Math.round(boxH),
            pbScrollW: pb.scrollWidth, pbClientW: pb.clientWidth,
            rootW: root ? Math.round(root.getBoundingClientRect().width) : 0,
            rootH: root ? Math.round(root.getBoundingClientRect().height) : 0,
            rootCls: root ? root.className : '(assente)',
            dpr: dpr,
            roActive: (window.FP21_RO || {}).active || 0
        };
        if (img) {
            const ir = img.getBoundingClientRect();
            out.imgW = Math.round(ir.width);
            out.imgH = Math.round(ir.height);
            out.cw = Number(img.getAttribute('data-cw') || 0);
            out.ch = Number(img.getAttribute('data-ch') || 0);
            out.idpr = Number(img.getAttribute('data-dpr') || 0);
            out.ofFit = getComputedStyle(img).objectFit;
        } else {
            out.imgW = 0; out.cw = 0; out.ch = 0; out.idpr = 0; out.ofFit = '';
        }
        return out;
    });
}
function snapFits(m) {
    if (!m || !m.imgW) return { fit: false, why: 'nessuna img snap' };
    const wOk = Math.abs(m.imgW - m.boxW) <= 2;
    const hOk = m.imgH <= m.boxH + 2;
    const fitOk = m.ofFit === 'contain';
    const canvasOk = m.cw >= Math.round(m.boxW * m.dpr);
    return {
        fit: wOk && hOk && fitOk && canvasOk,
        why: 'boxW=' + m.boxW + ' imgW=' + m.imgW + ' boxH=' + m.boxH +
            ' imgH=' + m.imgH + ' of=' + m.ofFit +
            ' canvas=' + m.cw + 'x' + m.ch + ' >= ' +
            Math.round(m.boxW * m.dpr) + ' (dpr ' + m.dpr + '/attr ' + m.idpr + ')'
    };
}
function areaOk(m) {
    if (!m) return { ok: false, why: 'null' };
    const scrollOk = m.pbScrollW <= m.pbClientW + 2;
    const rootOk = m.rootW >= Math.round(m.boxW * 0.95) - 2;
    return {
        ok: scrollOk && rootOk,
        why: 'scroll=' + m.pbScrollW + '/' + m.pbClientW +
            ' rootW=' + m.rootW + ' boxW=' + m.boxW
    };
}
/* drag REALE del bordo destro fino alla larghezza target */
async function dragPanelWidth(page, target) {
    const h = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        const hz = p.querySelector('.fp21-rz-r');
        const r = hz.getBoundingClientRect();
        return {
            w: Math.round(p.getBoundingClientRect().width),
            x: r.left + r.width / 2, y: r.top + r.height / 2
        };
    });
    const dx = target - h.w;
    if (Math.abs(dx) < 4) return h.w;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + dx, h.y, { steps: 10 });
    await page.mouse.up();
    await sleep(300);
    return page.evaluate(() =>
        Math.round(document.querySelector('.fp21-root[data-fp21="appunti"]')
            .getBoundingClientRect().width));
}
async function chevron(page) {
    await page.evaluate(() => {
        const c = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-chev');
        if (c) c.click();
    });
    await sleep(250);
}
const measures = { l31: [], l32: [], l33: {}, l34: [] };

(async () => {
    const srv = await staticServer();
    const browser = await puppeteer.launch({
        headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + await browser.version());
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const consoleErrs = [];
    const pageErrs = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    page.on('pageerror', e => pageErrs.push(String(e.message || e)));
    await page.evaluateOnNewDocument(installMock);

    /* ---------- boot: editor Appunti + nota reale col tratto ---------- */
    await bootHome(page);
    const ts = (fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8')
        .match(/var QA_TS\s*=\s*"([^"]+)"/) || [])[1] || 'MISSING';
    const rawSrcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('script[src]'))
            .map(s => s.getAttribute('src') || '')
            .filter(s => s.indexOf('.js') >= 0));
    const withV = rawSrcs.filter(s => s.indexOf('?v=') >= 0);
    const stampOf = s => (s.split('?v=')[1] || '').split('&')[0];
    /* Catena dichiarata di questo round = i 9 moduli editor/Fonti devono
       girare con LO STESSO stamp (stessa catena ?v= del BUILD); il censimento
       degli altri script con ?v= registra lo drift storico pre-esistente
       (app.js/statistiche.js su un altro stamp) senza dubitarne qui */
    const CHAIN = ['js/modules/fonti_panel.js', 'js/modules/notes.js',
        'js/modules/schemaStrategies.js', 'js/modules/schemi.js',
        'js/modules/presentazioni.js', 'js/modules/documenti.js',
        'js/modules/fogli.js', 'js/modules/video.js', 'js/modules/ripasso.js'];
    const chainSt = CHAIN.map(p => {
        const s = withV.find(x => x.split('?')[0] === p);
        return s ? stampOf(s) : null;
    });
    const otherSt = Array.from(new Set(withV.filter(s =>
        CHAIN.indexOf(s.split('?')[0]) < 0).map(stampOf)));
    const chainOk = chainSt.every(v => v && v === chainSt[0]);
    rec('F0 catena ?v coerente (9 moduli editor/Fonti, stesso stamp)',
        chainOk, 'stesso ?v su 9 moduli',
        'catena v=' + (chainSt[0] || '?') + ' assenti=' +
        chainSt.filter(v => !v).length + ' | drift storico censito=' +
        JSON.stringify(otherSt) + ' | QA_TS=' + ts);
    await goModule(page, 'notes');
    rec('BOOT editor Appunti', await openFirstApri(page), 'editor', '-');
    await waitEditor(page, '.fn-pill-left', '.nt-stage canvas');
    await ensurePanelOpen(page, 'appunti');
    await pickChip(page, 'Appunti');
    const foundInk = await pickRow(page, M.ink_note.title);
    const pv = await previewReady(page, true);
    rec('BOOT snapshot reale caricata (nota con tratti)', foundInk && pv.ok,
        'img.fp21-snap con data-cw', 'row=' + foundInk + ' pv=' + pv.ok);
    await shot(page, 'r30_l31_baseline');

    /* ================= L3.1 snapshot adattiva ================= */
    for (const t of [280, 340, 560]) {
        const got = await dragPanelWidth(page, t);
        await settle();
        const m = await pm(page);
        const s = snapFits(m);
        rec('L3.1 pannello ' + t + 'px: img == larghezza area (±2) + canvas >= boxW x DPR',
            s.fit, t + 'px', 'w=' + got + ' | ' + s.why);
        measures.l31.push(Object.assign({ combo: 'w' + t, gotW: got }, m));
        await shot(page, 'r30_l31_w' + t);
    }
    // collasso / espanso
    await chevron(page);
    await settle();
    let m = await pm(page);
    let s = snapFits(m);
    const chipsHidden = await page.evaluate(() => {
        const c = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-chips');
        return c && getComputedStyle(c).display === 'none';
    });
    rec('L3.1 collasso: layout rieseguito (img riempie area a tutta altezza)',
        s.fit && chipsHidden, 'fit + chip nascosti', s.why);
    measures.l31.push(Object.assign({ combo: 'collapsed' }, m));
    await shot(page, 'r30_l31_collapse');
    await chevron(page);
    await settle();
    m = await pm(page);
    s = snapFits(m);
    rec('L3.1 espanso: layout tornato al precedente', s.fit, 'fit', s.why);
    measures.l31.push(Object.assign({ combo: 'expanded' }, m));
    await shot(page, 'r30_l31_expand');
    // devicePixelRatio reale = 2 (+ resize REALE della finestra: sotto CDP
    // l'evento matchMedia 'resolution' su setDeviceMetrics non e' garantito;
    // il resize finestra e' uno degli scatti previsti da L1.2)
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await sleep(400);
    await page.setViewport({ width: 1439, height: 900, deviceScaleFactor: 2 });
    await sleep(400);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await sleep(700);
    m = await pm(page);
    s = snapFits(m);
    rec('L3.1 DPR=2: canvas sorgente >= area x 2 (rigenerazione adattiva)',
        m.dpr === 2 && m.cw >= Math.round(m.boxW * 2) && s.fit,
        'canvas >= ' + Math.round(m.boxW * 2),
        'canvas=' + m.cw + ' dpr=' + m.dpr + ' attr=' + m.idpr + ' | ' + s.why);
    measures.l31.push(Object.assign({ combo: 'dpr2' }, m));
    await shot(page, 'r30_l31_dpr2');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await sleep(700);

    /* ================= L3.2 resize finestra ================= */
    for (const w of [1280, 1600, 1920]) {
        await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
        await sleep(750);
        const mm = await pm(page);
        const a = areaOk(mm);
        rec('L3.2 finestra ' + w + ': scrollWidth<=clientWidth+2 e root>=95% area',
            a.ok, 'root >= ' + Math.round(mm.boxW * 0.95) + 'px', a.why);
        measures.l32.push(Object.assign({ combo: 'win' + w }, mm));
        await shot(page, 'r30_l32_' + w);
    }
    // 1600: anche altri adattatori sotto resize finestra
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await sleep(750);
    for (const t of [
        { chip: 'Fogli', title: M.foglio.title, slug: 'fogli' },
        { chip: 'Materiali', title: M.fotosintesi.name, slug: 'md' },
        { chip: 'Documenti', title: M.documento.title, slug: 'doc' }
    ]) {
        await pickChip(page, t.chip);
        await pickRow(page, t.title);
        await previewReady(page, false);
        await settle();
        const mm = await pm(page);
        const a = areaOk(mm);
        rec('L3.2 finestra 1600 - adattatore ' + t.slug + ': nessun sforo + root>=95%',
            a.ok, 'root>=95%', a.why);
        measures.l32.push(Object.assign({ combo: 'win1600_' + t.slug }, mm));
        await shot(page, 'r30_l32_' + t.slug);
    }

    /* ================= L3.3 drag + toggle + leak RO ================= */
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await sleep(700);
    await pickChip(page, 'Appunti');
    await pickRow(page, M.ink_note.title);
    await previewReady(page, true);
    await settle();
    const roOpen = (await pm(page)).roActive;
    const gotW = await dragPanelWidth(page, 430);
    await settle();
    m = await pm(page);
    s = snapFits(m);
    const a3 = areaOk(m);
    rec('L3.3 drag pannello -> layout coerente (fit + root + scroll)',
        s.fit && a3.ok, 'w=' + gotW, s.why + ' | ' + a3.why);
    measures.l33.drag = m;
    await shot(page, 'r30_l33_drag');
    await chevron(page);            // collapse
    await settle();
    m = await pm(page);
    rec('L3.3 toggle collasso -> layout coerente', snapFits(m).fit, 'fit',
        snapFits(m).why);
    measures.l33.collapsed = m;
    await chevron(page);            // expand
    await settle();
    m = await pm(page);
    rec('L3.3 toggle espanso -> layout coerente', snapFits(m).fit, 'fit',
        snapFits(m).why);
    measures.l33.expanded = m;
    await shot(page, 'r30_l33_toggle');
    // leak RO: chiusura modulo (destroy) e riapertura
    rec('L3.3 RO attivi col pannello aperto', roOpen >= 1, '>=1', String(roOpen));
    await goModule(page, 'home');
    await sleep(800);
    const roClosed = await page.evaluate(() => (window.FP21_RO || {}).active || 0);
    rec('L3.3 RO rilasciato alla chiusura del modulo (destroy)',
        roClosed === Math.max(0, roOpen - 1),
        'dopo close = ' + Math.max(0, roOpen - 1), String(roClosed));
    await goModule(page, 'notes');
    await openFirstApri(page);
    await waitEditor(page, '.fn-pill-left', '.nt-stage canvas');
    await ensurePanelOpen(page, 'appunti');
    await settle();
    const roAgain = await page.evaluate(() => (window.FP21_RO || {}).active || 0);
    rec('L3.3 NESSUN leak di ResizeObserver (prima == dopo)',
        roAgain === roOpen, 'prima=' + roOpen, 'dopo=' + roAgain);
    measures.l33.ro = { open: roOpen, closed: roClosed, again: roAgain };

    /* ================= L3.4 matrice per tipo ================= */
    await pickChip(page, 'Appunti');
    await pickRow(page, M.ink_note.title);
    await previewReady(page, true);
    const matrix = [
        { chip: 'Appunti', title: M.ink_note.title, slug: 'appunti' },
        { chip: 'Documenti', title: M.documento.title, slug: 'documenti' },
        { chip: 'Presentazioni', title: M.presentazione.title, slug: 'presentazioni' },
        { chip: 'Fogli', title: M.foglio.title, slug: 'fogli' },
        { chip: 'Video', title: M.video.title, slug: 'video' },
        { chip: 'Chat', title: M.chat_with_msgs.title, slug: 'chat' },
        { chip: 'Materiali', title: M.fotosintesi.name, slug: 'md' }
    ];
    for (const t of matrix) {
        await pickChip(page, t.chip);
        const found = await pickRow(page, t.title);
        const ready = await previewReady(page, t.slug === 'appunti');
        await settle();
        const mm = await pm(page);
        const a = areaOk(mm);
        rec('L3.4 ' + t.slug + ': root>=95% area + nessun sforo + screenshot',
            found && ready.ok && a.ok, 'root>=95% e scroll ok',
            'row=' + found + ' ' + a.why);
        measures.l34.push(Object.assign({ combo: t.slug }, mm));
        await shot(page, 'r30_mat_' + t.slug);
    }
    // Libri: nessuna sorgente reale (cartella vuota) - PARZIALE dichiarato
    await pickChip(page, 'Libri');
    const libri = await page.evaluate(() => ({
        rows: document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-item').length,
        hint: (document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-hint') || {}).textContent || ''
    }));
    rec('L3.4 Libri (PARZIALE: preselected_books vuota, 0 file)',
        (M.books_count || 0) === 0 && libri.rows === 0 &&
        libri.hint.indexOf('Nessuna fonte') >= 0,
        '0 libri -> solo hint di lista, nessun crash',
        'books=' + M.books_count + ' rows=' + libri.rows);
    await shot(page, 'r30_mat_libri_parziale');

    /* ---------- errori di sessione ---------- */
    rec('Z1 zero pageerror', pageErrs.length === 0, '0', JSON.stringify(pageErrs.slice(0, 3)));
    const unexpected = consoleErrs.filter(t => t.indexOf('[fp21]') < 0);
    rec('Z2 zero console.error inattesi', unexpected.length === 0, '0',
        JSON.stringify(unexpected.slice(0, 4)));

    fs.writeFileSync(path.join(QA_DIR, 'r30_measures.json'),
        JSON.stringify(measures, null, 1));
    fs.writeFileSync(path.join(QA_DIR, 'r30_results.json'),
        JSON.stringify(checks, null, 1));

    await browser.close();
    srv.close();
    const nok = checks.filter(c => !c.ok);
    console.log('\n===== T2 QA-REAL R30: ' + (checks.length - nok.length) + '/' + checks.length + ' check OK =====');
    if (nok.length) console.log('FAILED:\n - ' + nok.map(n => n.id + ' (' + n.evidence + ')').join('\n - '));
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('RUNNER FATAL:', e);
    process.exit(1);
});
