'use strict';
/* qa_browser/qa_ab_b12.js — QA-T2 verifiche REALI (Chromium/Puppeteer) BLOCCHI A (Appunti) e B (Schemi).
   - qa_ui/notes.html  : harness A1/A2/A3 (notes.js reale)
   - qa_ui/schemi.html : harness B1/B2/B3/B4 (schemi.js reale, doc B12 preservati + doc b1dense)
   Tutte le misure sono REALI (getBoundingClientRect, computed style, elementFromPoint,
   compareDocumentPosition, transform .sc-world): nessuna geometria stubbata.
   Screenshot: handshake __QA.needShot -> page.screenshot -> __SHOT_OK (come run.js), prefisso qa_ab_.
   Output: qa/qa_ab_measures.json (per blocco A e B, per check) + report su console.
   Esecuzione: node qa_browser/qa_ab_b12.js  */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const BUILD_TS = (function(){ try { var s = require('fs').readFileSync(require('path').join(__dirname, '..', 'web_frontend', 'html', 'index.html'), 'utf8'); var m = s.match(/var QA_TS\s*=\s*"([^"]+)"/); return m ? m[1] : 'MISSING'; } catch (e) { return 'MISSING'; } })();
const VW = 1366, VH = 900;
const MAX_ATT = 10;                 // max 10 tentativi per unità

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- ipotesi causa (modulo reale, NON modificato) per check falliti ---------- */
const HYP = {
    A1a: 'onDocOutside/togglePop notes.js:2592/2601 o mancata registrazione capture listener (buildChrome notes.js:2555)',
    A1b: 'onDocOutside notes.js:2592 / togglePop(ed.popZoom) notes.js:2470',
    A1c: 'onDocOutside notes.js:2592 / togglePop(ed.popMeta, openMeta) notes.js:2261',
    A1d: 'bHelp handler notes.js:2331 (togglePop ed.popHelp) / closeAllPops notes.js:2578',
    A1e: 'onKeyDown Escape notes.js:1975 (closeAllPops) o listener keydown non registrato notes.js:3093',
    A2a: 'syncToolActive notes.js:2140 (match preset) / applyPreset notes.js:2617 / fix B1',
    A2b: 'syncToolActive notes.js:2140 (sweep [data-tool]) / setTool notes.js:2084',
    A2c: 'syncToolActive notes.js:2140 / setTool gomma notes.js:2084',
    A2d: 'syncToolActive notes.js:2140 / setTool evidenziatore notes.js:2084',
    A2e: 'syncToolActive notes.js:2140 / setTool lazo notes.js:2084',
    A2f: 'syncToolActive notes.js:2140 / setTool selezione notes.js:2084',
    A2g: 'bHelp handler notes.js:2331 (.mode vs .active) o CSS .fn-tb.mode notes.js:93',
    A3a: 'toggleFonti notes.js:2700 / buildFonti notes.js:2659 o CSS .fn-side notes.js:143',
    A3b: 'renderFontiList notes.js:2742 (filtro ricerca + hint)',
    A3c: 'selectFonti notes.js:2766 / extractFonteText notes.js:2796',
    A3d: 'insertFontiRef notes.js:2824 / scheduleSave debounce 900ms notes.js:1076',
    A3e: 'undo notes.js:1017 (pushUndo notes.js:1002 in insertFontiRef) / repointPage notes.js:1011',
    B1a: 'stage.innerHTML ordine g schemi.js:2363 (guide,nodes,edges,draw,overlay)',
    B1b: 'edgeHtml schemi.js:660 / render gEdges.innerHTML dopo gNodes schemi.js:908-931 (z-order archi)',
    B1c: 'svgDown hit-test nodo schemi.js:1474 (elementFromPoint sopra il nodo) / pointer-events archi',
    B1d: 'edgeHtml curva schemi.js:642 / z-order dopo migrateSchema+autoLayout (changeType schemi.js:1350)',
    B2a: 'buildSide schemi.js:2035 (4 tab) / rebuild laterale in openEditor/applySnapshot',
    B2b: 'syncTestoPanel schemi.js:1381 (hint "Seleziona un nodo" + disabled)',
    B2c: 'select svgDown schemi.js:1474 + syncTestoPanel schemi.js:1381 (editor attivo)',
    B2d: 'inTitolo input handler buildSide schemi.js:2068 + nodeHtml/render schemi.js:752/908 + doSave schemi.js:1838',
    B3a: 'openEditor costruzione bUndo/bRedo fuori .sc-btnwrap schemi.js:2313-2317',
    B3b: 'addNode pushUndoSnapshot schemi.js:996 / undoChangeType schemi.js:1322 / applySnapshot schemi.js:1279',
    B3c: 'changeType pushUndoSnapshot schemi.js:1352 / undoChangeType schemi.js:1322 (1 solo passo)',
    B3d: 'onKey Ctrl+Z schemi.js:1665 (undoChangeType in 1 pressione)',
    B4a: 'bHand "Matita" openEditor schemi.js:2304 (Mano rimosso/rimpiazzato)',
    B4b: 'svgDown onBg pan schemi.js:1470 + svgMove mode pan schemi.js:1516 + gW transform render schemi.js:910',
    B4c: 'onKey SPAZIO grab schemi.js:1655 / onKeyUp schemi.js:1685 / svgDown spacePan schemi.js:1447',
    B4d: 'toggleTool .sc-drawopts.on schemi.js:1801 + CSS schemi.js:68-69'
};

const MEAS = { A: {}, B: {} };

/* ---------- BUILD marker: se non combacia -> BLOCKED ---------- */
(function checkBuild() {
    const idxPath = path.join(ROOT, 'web_frontend', 'html', 'index.html');
    const src = fs.readFileSync(idxPath, 'utf8');
    const m = src.match(/var QA_TS\s*=\s*"([^"]+)"/);
    const got = m ? m[1] : '(assente)';
    // coerenza ?v= : tutti i badge ?v= di index.html devono combaciare con QA_TS (build unica)
    var vs = [], re = /\?v=([^"']+)/g, mm;
    while ((mm = re.exec(src))) vs.push(mm[1]);
    var uniq = Array.from(new Set(vs));
    var badV = uniq.filter(function (v) { return v !== got; });
    if (got === '(assente)' || got === 'MISSING') {
        console.error('BLOCKED - QA_TS assente in web_frontend/html/index.html');
        process.exit(2);
    }
    if (badV.length) {
        console.error('BLOCKED - ?v= incoerenti con QA_TS: ' + badV.join(', '));
        process.exit(2);
    }
    if (got !== BUILD_TS) {
        console.error('BLOCKED — BUILD marker mismatch:');
        console.error('  atteso QA_TS="' + BUILD_TS + '"');
        console.error('  ottenuto QA_TS="' + got + '" in web_frontend/html/index.html');
        console.error('  Alternativa: rilanciare la QA dopo il rebuild con il marker corretto; nessuna misura T2 valida senza build nota.');
        process.exit(2);
    }
    console.log('BUILD marker OK: QA_TS="' + got + '"');
})();

/* ---------- handshake screenshot (stesso protocollo di run.js) ---------- */
async function shot(page, name) {
    await page.evaluate(n => { window.__QA.needShot = n; }, name);
    await sleep(50);
    await page.screenshot({ path: path.join(QA_DIR, name + '.png') });
    await page.evaluate(() => { window.__SHOT_OK = true; window.__QA.needShot = null; });
    console.log('SHOT -> qa/' + name + '.png');
}

/* ---------- attesa con max 10 tentativi per unità (arg opzionale a page.evaluate) ---------- */
async function until10(page, fn, step, arg) {
    step = step || 150;
    for (let i = 0; i < MAX_ATT; i++) {
        if (await page.evaluate(fn, arg)) return true;
        await sleep(step);
    }
    return await page.evaluate(fn, arg);
}

async function pushCheck(page, block, id, expected, ok, evidence, m) {
    ok = !!ok;
    if (!ok && HYP[id]) evidence = evidence + ' | ipotesi causa: ' + HYP[id];
    await page.evaluate((id, e, ok, ev) => window.__qaCheck(id, e, ok, ev), id, expected, ok, evidence);
    if (m) MEAS[block][id] = m;
    console.log((ok ? '[VISTO] ' : '[NO]    ') + id + '  (blocco ' + block + ')');
    console.log('        atteso: ' + expected);
    console.log('        visto : ' + evidence);
    return ok;
}

/* calcola nel browser e registra il check in un colpo solo (fn deve essere autocontenuto) */
async function evalCheck(page, block, id, expected, fn, hyp) {
    let r;
    const args = Array.prototype.slice.call(arguments, 6);
    try { r = await page.evaluate.apply(page, [fn].concat(args)); }
    catch (e) { r = { ok: false, evidence: 'eccezione evaluate: ' + (e.message || e) }; }
    if (r && r.__err) r = { ok: false, evidence: 'eccezione in pagina: ' + r.__err };
    let ev = r.evidence || '(nessuna evidenza)';
    if (!r.ok && hyp) ev += ' | ipotesi causa: ' + hyp;
    return pushCheck(page, block, id, expected, r.ok, ev, r.m);
}

async function centerOf(page, sel) {
    return await page.evaluate(s => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
}

async function clickSel(page, sel) {
    const c = await centerOf(page, sel);
    if (!c) return false;
    await page.mouse.click(c.x, c.y);
    return true;
}

async function centerWhere(page, fn) { // fn restituisce {x,y} o null
    return await page.evaluate(fn);
}

function attachLogs(page) {
    const logs = [];
    page.on('console', m => {
        if (m.type() === 'error') logs.push('console.error: ' + m.text());
    });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    return logs;
}

async function waitHarness(page, logs, tag) {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
        let st = {};
        try { st = await page.evaluate(() => ({ ready: !!(window.__QA && window.__QA.harnessReady), done: !!(window.__QA && window.__QA.done) })); }
        catch (e) { logs.push('evaluate: ' + e.message); break; }
        if (st.ready) return true;
        if (st.done) return false;
        await sleep(120);
    }
    return false;
}

/* punto sul canvas note, fuori da ogni popover e trigger (A1) */
const NOTES_FREE_POINT = () => {
    const cv = document.querySelector('.nt-stage canvas');
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const cands = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + r.width * 0.30, r.top + r.height * 0.55],
        [r.left + r.width * 0.50, r.top + r.height * 0.78],
        [r.left + 90, r.top + 90]
    ];
    const pops = [].slice.call(document.querySelectorAll('.fn-pop.show'));
    const trigs = [].slice.call(document.querySelectorAll('[data-poptrig]'));
    const inRects = (list, x, y) => list.some(t => {
        const b = t.getBoundingClientRect();
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
    });
    for (const c of cands) {
        if (c[0] < 1 || c[1] < 1 || c[0] > innerWidth - 1 || c[1] > innerHeight - 1) continue;
        if (inRects(pops, c[0], c[1]) || inRects(trigs, c[0], c[1])) continue;
        const el = document.elementFromPoint(c[0], c[1]);
        if (el && (el === cv || cv.contains(el))) return { x: c[0], y: c[1], forced: false };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.8, forced: true };
};

/* punto vuoto sullo stage schemi (background, non nodo/arco/pannello) */
const SCHEMI_EMPTY_POINT = () => {
    const stage = document.querySelector('.sc-stage');
    if (!stage) return null;
    const r = stage.getBoundingClientRect();
    const cands = [
        [r.left + 40, r.top + r.height - 40],
        [r.left + r.width - 40, r.top + r.height - 40],
        [r.left + r.width - 40, r.top + 40],
        [r.left + r.width / 2, r.top + r.height - 30],
        [r.left + 40, r.top + 40]
    ];
    for (const c of cands) {
        if (c[0] < 1 || c[1] < 1 || c[0] > innerWidth - 1 || c[1] > innerHeight - 1) continue;
        const el = document.elementFromPoint(c[0], c[1]);
        if (!el) continue;
        if (el.closest('[data-nid],[data-eid],[data-sid]')) continue;
        if (el.closest('.sc-side,.sc-tools,.sc-top,.sc-zoom,.mod-header,.sc-toast')) continue;
        return { x: c[0], y: c[1], tag: el.tagName };
    }
    return null;
};

/* ---------- B1: sampler z-order archi (midpoint segmenti + campioni estesi) ---------- */
const SAMPLER = async (reqMid) => {
    try {
        const item = await window.StudyStore.getItem('b1dense');
        const doc = JSON.parse(item.content);
        const ends = {};
        doc.edges.forEach(e => { ends[e.id] = e; });
        const nodes = [].slice.call(document.querySelectorAll('.sc-nodes g.sc-node[data-nid]'));
        const edges = [].slice.call(document.querySelectorAll('.sc-edges .sc-edge'));
        const nodeRects = nodes.map(g => {
            const r = g.getBoundingClientRect();
            return { nid: g.getAttribute('data-nid'), l: r.left, t: r.top, r: r.right, b: r.bottom };
        });
        const vw = innerWidth, vh = innerHeight;
        let midCount = 0, extCount = 0, outside = 0, hitMid = 0, hitExt = 0;
        const misses = [], sampleHits = [];
        for (const eg of edges) {
            const eid = eg.getAttribute('data-eid');
            const e = ends[eid];
            if (!e) continue;
            const paths = [].slice.call(eg.querySelectorAll('path'));
            const path = paths.find(p => p.getAttribute('stroke') !== 'transparent') || paths[0];
            if (!path) continue;
            const ctm = path.getScreenCTM();
            if (!ctm) continue;
            /* segmenti dal d (M/L/Q) */
            const toks = String(path.getAttribute('d') || '').trim().split(/[\s,]+/);
            let i = 0, cur = null; const segs = [];
            while (i < toks.length) {
                const c = toks[i];
                if (c === 'M') { cur = [+toks[i + 1], +toks[i + 2]]; i += 3; }
                else if (c === 'L') { const p = [+toks[i + 1], +toks[i + 2]]; segs.push({ t: 'L', a: cur, b: p }); cur = p; i += 3; }
                else if (c === 'Q') { const q = [+toks[i + 1], +toks[i + 2], +toks[i + 3], +toks[i + 4]]; segs.push({ t: 'Q', a: cur, c: [q[0], q[1]], b: [q[2], q[3]] }); cur = [q[2], q[3]]; i += 5; }
                else i++;
            }
            const samples = [];
            segs.forEach(s => {
                if (s.t === 'L') {
                    samples.push({ x: (s.a[0] + s.b[0]) / 2, y: (s.a[1] + s.b[1]) / 2, kind: 'mid' });
                    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
                    const steps = Math.floor(len / 12);
                    for (let k = 1; k < steps; k++) {
                        const t = k / steps;
                        samples.push({ x: s.a[0] + (s.b[0] - s.a[0]) * t, y: s.a[1] + (s.b[1] - s.a[1]) * t, kind: 'ext' });
                    }
                } else {
                    const B = t => {
                        const u = 1 - t;
                        return [u * u * s.a[0] + 2 * u * t * s.c[0] + t * t * s.b[0],
                                u * u * s.a[1] + 2 * u * t * s.c[1] + t * t * s.b[1]];
                    };
                    [[0.5, 'mid'], [0.25, 'ext'], [0.75, 'ext']].forEach(p => {
                        const q = B(p[0]); samples.push({ x: q[0], y: q[1], kind: p[1] });
                    });
                }
            });
            for (const s of samples) {
                const sp = new DOMPoint(s.x, s.y).matrixTransform(ctm);
                if (sp.x < 0 || sp.y < 0 || sp.x > vw || sp.y > vh) { outside++; continue; }
                const over = nodeRects.filter(nr => nr.nid !== e.from && nr.nid !== e.to &&
                    sp.x >= nr.l - 1 && sp.x <= nr.r + 1 && sp.y >= nr.t - 1 && sp.y <= nr.b + 1);
                if (!over.length) continue;
                const el = document.elementFromPoint(sp.x, sp.y);
                const hitG = !!(el && el.closest('.sc-edge') === eg);
                if (s.kind === 'mid') { midCount++; if (hitG) hitMid++; }
                else { extCount++; if (hitG) hitExt++; }
                if (sampleHits.length < 4 && hitG) sampleHits.push(eid + ':' + (el.tagName || '?'));
                if (!hitG && misses.length < 10) {
                    misses.push({
                        eid: eid, node: over.map(o => o.nid).join('+'), kind: s.kind,
                        world: [+s.x.toFixed(1), +s.y.toFixed(1)],
                        screen: [+sp.x.toFixed(1), +sp.y.toFixed(1)],
                        hit: el ? (el.tagName + '.' + (el.getAttribute('class') || '') +
                            (el.closest('[data-nid]') ? '|node=' + el.closest('[data-nid]').getAttribute('data-nid') : '')) : 'null'
                    });
                }
            }
        }
        const total = midCount + extCount;
        const hits = hitMid + hitExt;
        const ok = misses.length === 0 && (!reqMid || midCount >= 1) && edges.length >= 5 && nodes.length >= 6;
        return {
            ok: ok,
            evidence: 'nodi=' + nodes.length + ' archi=' + edges.length +
                ' campioni mid in nodo non terminale=' + midCount + ' (hit arco=' + hitMid + ')' +
                ' + estesi=' + extCount + ' (hit=' + hitExt + ')' +
                ' fuori viewport=' + outside + ' misses=' + misses.length +
                (misses.length ? ' -> ' + JSON.stringify(misses.slice(0, 4)) : '') +
                (sampleHits.length ? ' | esempi hit: ' + sampleHits.join(', ') : ''),
            m: { nodes: nodes.length, edges: edges.length, midSamples: midCount, midHits: hitMid, extSamples: extCount, extHits: hitExt, outside: outside, misses: misses }
        };
    } catch (e) {
        return { ok: false, evidence: 'eccezione sampler: ' + (e.message || e) };
    }
};

async function objCount(page) {
    return await page.evaluate(async () => {
        const it = await window.StudyStore.getItem('nt1');
        const d = JSON.parse(it.content);
        let n = 0;
        if (Array.isArray(d.pages)) d.pages.forEach(p => { n += (p.objects || []).length; });
        else n = (d.objects || []).length;
        return n;
    });
}

async function setSchemaType(page, t) {
    await page.evaluate(v => {
        const s = document.querySelector('.sc-type-sel');
        s.value = v;
        s.dispatchEvent(new Event('change', { bubbles: true }));
    }, t);
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));

    /* ============================================================
       BLOCCO A — qa_ui/notes.html (Appunti, notes.js)
       ============================================================ */
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: VW, height: VH });
    const logsA = attachLogs(pageA);
    await pageA.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'notes.html')).href, { waitUntil: 'load', timeout: 20000 });
    if (!(await waitHarness(pageA, logsA, 'notes'))) {
        const er = await pageA.evaluate(() => window.__QA ? window.__QA.errors : ['__QA assente']);
        console.error('BLOCKED — harness notes non pronto.');
        console.error('  Causa: ' + JSON.stringify(er));
        console.error('  Alternativa: verificare qa_ui/notes.html + modulo notes.js caricato (App.registerModule) senza errori runtime.');
        process.exit(2);
    }

    /* --- A1: popover click-fuori + Esc --- */
    async function a1Case(letter, trgSel, popSel, id, shotOpen, shotClosed) {
        const c = await centerOf(pageA, trgSel);
        if (!c) return pushCheck(pageA, 'A', id, 'popover ' + popSel + ' apre e si chiude col click fuori', false,
            'BLOCKED: trigger ' + trgSel + ' non trovato o invisibile; alternativa: ricaricare harness (harnessReady)');
        await pageA.mouse.click(c.x, c.y);
        const opened = await until10(pageA, sel => {
            const p = document.querySelector(sel);
            return !!(p && p.classList.contains('show'));
        }, 120, popSel);
        const openInfo = await pageA.evaluate(sel => {
            const p = document.querySelector(sel);
            if (!p) return null;
            const r = p.getBoundingClientRect(); const cs = getComputedStyle(p);
            return { show: p.classList.contains('show'), w: Math.round(r.width), h: Math.round(r.height), display: cs.display };
        }, popSel);
        if (shotOpen) await shot(pageA, shotOpen);
        const pt = await pageA.evaluate(NOTES_FREE_POINT);
        await pageA.mouse.click(pt.x, pt.y);
        const closed = await until10(pageA, () => document.querySelectorAll('.fn-pop.show').length === 0, 120);
        if (shotClosed) await shot(pageA, shotClosed);
        /* display puo' essere block o flex (popover zoom usa flex): conta visibile != none */
        const visible = openInfo && openInfo.display !== 'none';
        const ok = opened && openInfo && openInfo.show && visible && openInfo.w > 0 && openInfo.h > 0 && closed;
        return pushCheck(pageA, 'A', id,
            'popover aperto (.show + display visibile + rect>0) e chiuso da click sul canvas (.show assente su tutti)',
            ok,
            'aperto=' + opened + ' show=' + (openInfo && openInfo.show) + ' display=' + (openInfo && openInfo.display) +
            ' rect=' + (openInfo ? openInfo.w + 'x' + openInfo.h : 'n/a') + ' click punto=' + (pt ? Math.round(pt.x) + ',' + Math.round(pt.y) : 'null') +
            ' dopo click: .fn-pop.show=' + (await document0(pageA)) + ' closed=' + closed,
            { opened: !!opened, closed: !!closed, rect: openInfo });
    }
    async function document0(p) {
        return await p.evaluate(() => document.querySelectorAll('.fn-pop.show').length);
    }
    /* punto tool selezione: i click sul canvas di A1 non devono tracciare inchiostro */
    await clickSel(pageA, '.fn-pill-right [data-tool="selezione"]');
    await until10(pageA, () => {
        const act = [].slice.call(document.querySelectorAll('.fn-pill-right [data-tool].active'));
        return act.length === 1 && act[0].getAttribute('data-tool') === 'selezione';
    });

    await a1Case('a', '.fn-pill-right [data-color="1"]', '.fn-pop-color', 'A1a', 'qa_ab_a1_pop_open', 'qa_ab_a1_pop_closed');
    await a1Case('b', '.fn-zoom .fn-zpct', '.fn-pop-zoom', 'A1b');
    await a1Case('c', '.fn-top .fn-title', '.fn-pop-meta', 'A1c');
    await a1Case('d', '[data-help="1"]', '.fn-pop-help', 'A1d');
    /* ripristino toggle Migliora scrittura (A1d lo ha acceso) */
    await clickSel(pageA, '[data-help="1"]');
    await until10(pageA, () => !document.querySelector('[data-help="1"]').classList.contains('mode'));

    /* A1e: Esc chiude qualsiasi popover aperto */
    await clickSel(pageA, '.fn-pill-right [data-color="1"]');
    const escOpened = await until10(pageA, () => document.querySelector('.fn-pop-color').classList.contains('show'));
    await pageA.keyboard.press('Escape');
    const escClosed = await until10(pageA, () => document.querySelectorAll('.fn-pop.show').length === 0, 120);
    await pushCheck(pageA, 'A', 'A1e', 'Esc chiude il popover aperto (.fn-pop.show assente)',
        escOpened && escClosed, 'aperto prima di Esc=' + escOpened + ' .fn-pop.show dopo Esc=' +
        await pageA.evaluate(() => document.querySelectorAll('.fn-pop.show').length), { escOpened, escClosed });

    /* --- A2: stato strumento (1 solo attivo) + toggle Migliora scrittura --- */
    async function activeTools() {
        return await pageA.evaluate(() => {
            const bar = document.querySelector('.fn-pill-right');
            const act = [].slice.call(bar.querySelectorAll('[data-tool],[data-preset]'))
                .filter(b => b.classList.contains('active'));
            return { count: act.length, ids: act.map(b => b.getAttribute('data-tool') || b.getAttribute('data-preset')) };
        });
    }
    async function a2Case(id, sel, wantId, label) {
        const c = await centerOf(pageA, sel);
        if (!c) return pushCheck(pageA, 'A', id, 'click ' + label + ' -> esattamente 1 attivo (' + wantId + ')', false,
            'BLOCKED: selettore ' + sel + ' non trovato');
        await pageA.mouse.click(c.x, c.y);
        const ok = await until10(pageA, (w) => {
            const bar = document.querySelector('.fn-pill-right');
            const act = [].slice.call(bar.querySelectorAll('[data-tool],[data-preset]'))
                .filter(b => b.classList.contains('active'));
            return act.length === 1 && (act[0].getAttribute('data-tool') || act[0].getAttribute('data-preset')) === w;
        }, 120, wantId);
        const a = await activeTools();
        return pushCheck(pageA, 'A', id, 'esattamente 1 elemento .active tra [data-tool] e [data-preset] = ' + wantId,
            ok && a.count === 1 && a.ids[0] === wantId,
            'count=' + a.count + ' ids=' + JSON.stringify(a.ids) + ' (regressione B1: prima del fix restavano preset+tool accesi)',
            a);
    }
    /* until10 con argomento extra: ridefinisco qui sotto (JS non ha default params usabili sopra) */
    async function until10Arg(page, fn, arg, step) {
        step = step || 150;
        for (let i = 0; i < MAX_ATT; i++) {
            if (await page.evaluate(fn, arg)) return true;
            await sleep(step);
        }
        return await page.evaluate(fn, arg);
    }
    /* A2a: Matita (preset destro) */
    {
        const c = await centerOf(pageA, '.fn-pill-right [data-preset="matita"]');
        await pageA.mouse.click(c.x, c.y);
        const ok = await until10Arg(pageA, w => {
            const bar = document.querySelector('.fn-pill-right');
            const act = [].slice.call(bar.querySelectorAll('[data-tool],[data-preset]'))
                .filter(b => b.classList.contains('active'));
            return act.length === 1 && (act[0].getAttribute('data-tool') || act[0].getAttribute('data-preset')) === w;
        }, 'matita');
        const a = await activeTools();
        await pushCheck(pageA, 'A', 'A2a', 'Matita: esattamente 1 .active tra [data-tool]/[data-preset] = preset matita',
            ok && a.count === 1 && a.ids[0] === 'matita', 'count=' + a.count + ' ids=' + JSON.stringify(a.ids), a);
        await shot(pageA, 'qa_ab_a2_matita_sola');
    }
    /* A2b..f: strumenti singoli */
    const A2_SEQ = [
        ['A2b', '[data-tool="penna"]', 'penna', 'Penna'],
        ['A2c', '[data-tool="gomma"]', 'gomma', 'Gomma'],
        ['A2d', '[data-tool="evidenziatore"]', 'evidenziatore', 'Evidenziatore'],
        ['A2e', '[data-tool="lazo"]', 'lazo', 'Lazo'],
        ['A2f', '[data-tool="selezione"]', 'selezione', 'Sposta']
    ];
    for (const [id, sel, want, label] of A2_SEQ) {
        const c = await centerOf(pageA, sel);
        await pageA.mouse.click(c.x, c.y);
        const ok = await until10Arg(pageA, w => {
            const bar = document.querySelector('.fn-pill-right');
            const act = [].slice.call(bar.querySelectorAll('[data-tool],[data-preset]'))
                .filter(b => b.classList.contains('active'));
            return act.length === 1 && (act[0].getAttribute('data-tool') || act[0].getAttribute('data-preset')) === w;
        }, want);
        const a = await activeTools();
        await pushCheck(pageA, 'A', id, label + ': esattamente 1 .active = ' + want,
            ok && a.count === 1 && a.ids[0] === want, 'count=' + a.count + ' ids=' + JSON.stringify(a.ids), a);
    }
    /* A2g: toggle "Migliora scrittura" distinto dai tool */
    {
        const c = await centerOf(pageA, '[data-help="1"]');
        await pageA.mouse.click(c.x, c.y);
        await until10(pageA, () => document.querySelector('[data-help="1"]').classList.contains('mode'));
        const r = await pageA.evaluate(() => {
            const help = document.querySelector('[data-help="1"]');
            const ch = getComputedStyle(help);
            const tool = document.querySelector('.fn-pill-right [data-tool="selezione"]');
            const ct = getComputedStyle(tool);
            const bar = document.querySelector('.fn-pill-right');
            const act = [].slice.call(bar.querySelectorAll('[data-tool],[data-preset]'))
                .filter(b => b.classList.contains('active'));
            const bg = ch.backgroundColor;
            const border = ch.borderTopWidth + ' ' + ch.borderTopColor;
            const ok = help.classList.contains('mode') && !help.hasAttribute('data-tool') &&
                bg !== 'rgb(249, 151, 74)' && bg !== ct.backgroundColor &&
                ch.borderTopWidth !== '0px' && ch.borderTopColor === 'rgb(249, 151, 74)' &&
                act.length === 1;
            return {
                ok: ok,
                evidence: 'bgToggle=' + bg + ' bgToolAttivo=' + ct.backgroundColor +
                    ' borderToggle=' + border + ' hasDataTool=' + help.hasAttribute('data-tool') +
                    ' mode=' + help.classList.contains('mode') + ' attivi=' + act.length +
                    ' ids=' + JSON.stringify(act.map(b => b.getAttribute('data-tool') || b.getAttribute('data-preset'))),
                m: { bgToggle: bg, bgToolActive: ct.backgroundColor, borderTop: border, dataTool: help.hasAttribute('data-tool'), activeCount: act.length }
            };
        });
        await pushCheck(pageA, 'A', 'A2g',
            'toggle ON: .mode con background DIVERSO da rgb(249,151,74) e bordo 1.5px colorato, nessun data-tool, tool attivi invariati (1)',
            r.ok, r.evidence, r.m);
        await shot(pageA, 'qa_ab_a2_migliora_vs_tool');
        /* spegni il toggle */
        await pageA.mouse.click(c.x, c.y);
        await until10(pageA, () => !document.querySelector('[data-help="1"]').classList.contains('mode'));
    }

    /* --- A3: pannello Fonti --- */
    await clickSel(pageA, '.fn-pill-left [data-fonti="1"]');
    const sideOpen = await until10(pageA, () => {
        const s = document.querySelector('.fn-side');
        return !!(s && s.classList.contains('show'));
    });
    const a3a = await pageA.evaluate(() => {
        const s = document.querySelector('.fn-side');
        const st = document.querySelector('.nt-stage');
        if (!s || !st) return { ok: false, evidence: 'fn-side/nt-stage assenti' };
        const rs = s.getBoundingClientRect(), rst = st.getBoundingClientRect();
        const items = [].slice.call(document.querySelectorAll('.fn-flist .fn-fitem'));
        const cs = getComputedStyle(s);
        const leftOk = rs.left <= 20 && (rs.left + rs.width / 2) < (rst.left + rst.width / 2);
        const ok = s.classList.contains('show') && cs.display === 'flex' && leftOk && items.length >= 3;
        return {
            ok: ok,
            evidence: 'show=' + s.classList.contains('show') + ' display=' + cs.display +
                ' side.left=' + Math.round(rs.left) + ' side.width=' + Math.round(rs.width) +
                ' stage.left=' + Math.round(rst.left) + ' stage.width=' + Math.round(rst.width) +
                ' voci lista=' + items.length + ' (semate: nota+nf2+rf1+df1=4)',
            m: { left: Math.round(rs.left), width: Math.round(rs.width), display: cs.display, items: items.length, stageCenter: Math.round(rst.left + rst.width / 2), sideCenter: Math.round(rs.left + rs.width / 2) }
        };
    });
    await pushCheck(pageA, 'A', 'A3a', 'bottone Fonti apre .fn-side a SINISTRA (flex, left<=20, centro<centro stage) con >=3 voci reali',
        a3a.ok && sideOpen, a3a.evidence, a3a.m);
    await shot(pageA, 'qa_ab_a3_fonti_aperto');

    /* A3b: ricerca filtra */
    async function fontiSnap() {
        return await pageA.evaluate(() => ({
            q: (document.querySelector('.fn-side-search') || {}).value || '',
            items: document.querySelectorAll('.fn-flist .fn-fitem').length,
            hint: (document.querySelector('.fn-flist .fn-hint') || {}).textContent || ''
        }));
    }
    await clickSel(pageA, '.fn-side-search');
    await pageA.keyboard.down('Control'); await pageA.keyboard.press('a'); await pageA.keyboard.up('Control');
    await pageA.keyboard.type('fisica');
    await until10(pageA, () => document.querySelectorAll('.fn-flist .fn-fitem').length === 1);
    const s1 = await fontiSnap();
    await pageA.keyboard.down('Control'); await pageA.keyboard.press('a'); await pageA.keyboard.up('Control');
    await pageA.keyboard.type('zzqxwj');
    await until10(pageA, () => document.querySelectorAll('.fn-flist .fn-fitem').length === 0);
    const s2 = await fontiSnap();
    await pageA.keyboard.down('Control'); await pageA.keyboard.press('a'); await pageA.keyboard.up('Control');
    await pageA.keyboard.press('Backspace');
    await until10(pageA, () => document.querySelectorAll('.fn-flist .fn-fitem').length === 4);
    const s3 = await fontiSnap();
    await pushCheck(pageA, 'A', 'A3b',
        'ricerca: termine reale riduce le voci (4->1), termine casuale -> 0 voci + hint "Nessuna fonte corrisponde", svuotando -> 4',
        s1.items === 1 && s1.items < s3.items && s2.items === 0 && /Nessuna fonte corrisponde/.test(s2.hint) && s3.items === 4,
        'q1="' + s1.q + '" items=' + s1.items + ' | q2="' + s2.q + '" items=' + s2.items + ' hint="' + s2.hint.slice(0, 60) + '" | q3="" items=' + s3.items,
        { s1, s2, s3 });

    /* A3c: selezione voce -> anteprima contenuto */
    const fisRect = await centerWhere(pageA, () => {
        const items = [].slice.call(document.querySelectorAll('.fn-flist .fn-fitem'));
        const it = items.find(b => /Fisica/.test(b.textContent));
        if (!it) return null;
        const r = it.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    let prevText = '';
    if (fisRect) {
        await pageA.mouse.click(fisRect.x, fisRect.y);
        await until10(pageA, () => /cinematica/i.test((document.querySelector('.fn-fprev') || {}).textContent || ''), 200);
        prevText = await pageA.evaluate(() => (document.querySelector('.fn-fprev') || {}).textContent || '');
    }
    await pushCheck(pageA, 'A', 'A3c', 'selezione fonte -> .fn-fprev mostra il testo reale del doc (contiene "cinematica")',
        !!fisRect && /cinematica/i.test(prevText),
        'voce cliccata=' + !!fisRect + ' anteprima="' + prevText.slice(0, 120) + '"',
        { preview: prevText.slice(0, 200) });

    /* A3d: inserisci -> +1 oggetto nel doc (dopo debounce save) */
    await sleep(1100);
    const before = await objCount(pageA);
    const insEn = await pageA.evaluate(() => { const b = document.querySelector('.fn-finsert'); return b ? { found: true, disabled: b.disabled } : { found: false }; });
    if (insEn.found && !insEn.disabled) await clickSel(pageA, '.fn-finsert');
    await until10(pageA, () => true); // pausa minima
    const afterInserted = (async () => {
        for (let i = 0; i < MAX_ATT; i++) {
            const n = await objCount(pageA);
            if (n === before + 1) return n;
            await sleep(300);
        }
        return await objCount(pageA);
    })();
    const ai = await afterInserted;
    await pushCheck(pageA, 'A', 'A3d', 'bottone "Inserisci nella nota": count oggetti doc (store, dopo debounce save) = before+1',
        insEn.found && !insEn.disabled && ai === before + 1,
        'button disabled=' + insEn.disabled + ' oggetti before=' + before + ' after=' + ai + ' (delta=' + (ai - before) + ')',
        { before, after: ai });
    await shot(pageA, 'qa_ab_a3_fonti_inserito');

    /* A3e: UNDO rimuove l'oggetto inserito */
    const undoC = await pageA.evaluate(() => {
        const b = document.querySelector('button[title="Annulla (Ctrl+Z)"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (undoC) await pageA.mouse.click(undoC.x, undoC.y);
    let afterUndo = -1;
    for (let i = 0; i < MAX_ATT; i++) {
        afterUndo = await objCount(pageA);
        if (afterUndo === before) break;
        await sleep(300);
    }
    await pushCheck(pageA, 'A', 'A3e', 'click Annulla: count oggetti torna al valore before',
        !!undoC && afterUndo === before,
        'undo trovato=' + !!undoC + ' oggetti before=' + before + ' afterUndo=' + afterUndo,
        { before, afterUndo });

    /* A0: console/errore zero */
    const errA = await pageA.evaluate(() => window.__QA.errors);
    await pushCheck(pageA, 'A', 'A0', 'zero QA.errors / pageerror / console.error durante il giro A',
        errA.length === 0 && logsA.length === 0,
        'QA.errors=' + JSON.stringify(errA.slice(0, 4)) + ' logs=' + JSON.stringify(logsA.slice(0, 6)));
    const qaA = await pageA.evaluate(() => ({ checks: window.__QA.checks.length, errors: window.__QA.errors }));
    await pageA.close();

    /* ============================================================
       BLOCCO B — qa_ui/schemi.html (Schemi, schemi.js)
       ============================================================ */
    const pageB = await browser.newPage();
    await pageB.setViewport({ width: VW, height: VH });
    const logsB = attachLogs(pageB);
    await pageB.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href, { waitUntil: 'load', timeout: 20000 });
    if (!(await waitHarness(pageB, logsB, 'schemi'))) {
        const er = await pageB.evaluate(() => window.__QA ? window.__QA.errors : ['__QA assente']);
        console.error('BLOCKED — harness schemi non pronto.');
        console.error('  Causa: ' + JSON.stringify(er));
        console.error('  Alternativa: verificare qa_ui/schemi.html (env.js + schemaStrategies + schemi.js) senza errori runtime.');
        process.exit(2);
    }

    /* apri il doc denso per B1 */
    await pageB.evaluate(() => window.__qaHarness.open('b1dense'));
    const openedB = await until10(pageB, () => !!document.querySelector('.sc-type-sel') &&
        document.querySelectorAll('g.sc-node[data-nid]').length === 6, 200);
    await sleep(350);
    if (!openedB) {
        await pushCheck(pageB, 'B', 'B0open', 'apertura doc b1dense (6 nodi)', false,
            'BLOCKED: __qaHarness.open("b1dense") non ha portato a 6 nodi; alternativa: riprendere dal doc B12 esistente');
    }

    /* --- B1a: ordine DOM layer --- */
    await evalCheck(pageB, 'B', 'B1a',
        'ordine layer: .sc-nodes PRIMA di .sc-edges, .sc-overlay DOPO .sc-edges (compareDocumentPosition)',
        () => {
            const n = document.querySelector('.sc-nodes'), e = document.querySelector('.sc-edges'), o = document.querySelector('.sc-overlay');
            if (!n || !e || !o) return { ok: false, evidence: 'layer mancanti' };
            const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
            const nodesFirst = !!(n.compareDocumentPosition(e) & FOLLOWING);   // edges segue nodes
            const overlayAfter = !!(e.compareDocumentPosition(o) & FOLLOWING); // overlay segue edges
            const kids = [].slice.call(document.querySelector('.sc-world').children).map(c => (c.getAttribute('class') || c.tagName));
            const ok = nodesFirst && overlayAfter;
            return {
                ok: ok,
                evidence: 'nodesPrimaDiEdges=' + nodesFirst + ' overlayDopoEdges=' + overlayAfter +
                    ' ordine .sc-world=[' + kids.join(' > ') + ']',
                m: { nodesFirst, overlayAfter, order: kids }
            };
        }, HYP.B1a);

    /* --- B1b: z-order archi su nodi non terminali (albero denso) --- */
    await evalCheck(pageB, 'B', 'B1b',
        'per ogni .sc-edge: midpoint segmenti dentro bbox nodo NON terminale -> elementFromPoint torna la path del gruppo arco (>=1 campione mid richiesto)',
        SAMPLER, HYP.B1b, true);

    /* screenshot albero (prima del drag) */
    await shot(pageB, 'qa_ab_b1_albero_archi');

    /* --- B1c: nodo ancora draggabile nonostante layer sopra --- */
    {
        const pick = await centerWhere(pageB, () => {
            const nodes = [].slice.call(document.querySelectorAll('.sc-nodes g.sc-node[data-nid]'));
            for (const g of nodes) {
                const r = g.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                if (cx < 1 || cy < 1 || cx > innerWidth - 1 || cy > innerHeight - 1) continue;
                const el = document.elementFromPoint(cx, cy);
                if (el && el.closest('[data-nid]') === g) {
                    return { nid: g.getAttribute('data-nid'), x: cx, y: cy, l: r.left, t: r.top };
                }
            }
            return null;
        });
        if (!pick) {
            await pushCheck(pageB, 'B', 'B1c', 'mousedown+move sul centro nodo cambia la posizione del nodo', false,
                'BLOCKED: nessun nodo con centro cliccabile (elementFromPoint non torna il proprio g.sc-node); alternativa: usare un doc con nodi non coperti');
        } else {
            await pageB.mouse.move(pick.x, pick.y);
            await pageB.mouse.down();
            await pageB.mouse.move(pick.x + 70, pick.y + 45, { steps: 6 });
            await pageB.mouse.up();
            const moved = await until10(pageB, a => {
                const g = document.querySelector('g.sc-node[data-nid="' + a.nid + '"]');
                if (!g) return false;
                const r = g.getBoundingClientRect();
                return Math.abs(r.left - a.l) > 20 || Math.abs(r.top - a.t) > 20;
            }, 150, pick);
            const after = await pageB.evaluate(nid => {
                const g = document.querySelector('g.sc-node[data-nid="' + nid + '"]');
                const r = g.getBoundingClientRect();
                return { l: Math.round(r.left), t: Math.round(r.top) };
            }, pick.nid);
            await pushCheck(pageB, 'B', 'B1c',
                'drag nodo: mousedown centro + mousemove -> rect nodo cambia (>=20px) nonostante .sc-edges/.sc-overlay sopra',
                moved,
                'nid=' + pick.nid + ' before=(' + Math.round(pick.l) + ',' + Math.round(pick.t) + ')' +
                ' after=(' + after.l + ',' + after.t + ')' + ' moved=' + moved,
                { nid: pick.nid, before: { l: Math.round(pick.l), t: Math.round(pick.t) }, after });
        }
    }

    /* --- B2: 4 tab in ogni tipo (ciclo albero->mappa->lr->libero->riassunto->albero) --- */
    async function tabsCheck(tipo) {
        return await evalCheck(pageB, 'B', 'B2a_' + tipo,
            '4 tab SEMPRE presenti e visibili con label esatte [Riassunto, Fonti, Stile, Testo] (tipo ' + tipo + ')',
            () => {
                const tabs = [].slice.call(document.querySelectorAll('.sc-side .sc-tab'));
                const labels = tabs.map(t => t.textContent.trim());
                const want = ['Riassunto', 'Fonti', 'Stile', 'Testo'];
                const visible = tabs.every(t => getComputedStyle(t).display !== 'none' && t.offsetParent !== null);
                const sel = document.querySelector('.sc-type-sel');
                const badge = document.querySelector('.sc-zoom');
                const ok = tabs.length === 4 && labels.join('|') === want.join('|') && visible;
                return {
                    ok: ok,
                    evidence: 'tipoSel=' + (sel ? sel.value : 'n/a') + ' count=' + tabs.length +
                        ' labels=' + JSON.stringify(labels) + ' visibili=' + visible + ' badge=' + (badge ? badge.textContent : 'n/a'),
                    m: { type: sel ? sel.value : null, tabs: labels, visible, badge: badge ? badge.textContent : null }
                };
            }, HYP.B2a);
    }
    await tabsCheck('albero');

    /* passo 1: -> mappa (condiviso con B1d: shot mappa + sampler) */
    await setSchemaType(pageB, 'mappa');
    await sleep(480);
    await tabsCheck('mappa');
    await shot(pageB, 'qa_ab_b1_mappa_archi');
    /* B1d prep: crea un attraversamento REALE — drag di un nodo non-terminale
       esattamente sul punto medio parametrico (B(0.5) per Q, (a+b)/2 per L,
       stessa formula del SAMPLER) di un arco visibile. Interazione vera. */
    const cross = await pageB.evaluate(async () => {
        const item = await window.StudyStore.getItem('b1dense');
        const doc = JSON.parse(item.content);
        const egEls = [].slice.call(document.querySelectorAll('.sc-edges .sc-edge'));
        for (const eg of egEls) {
            const eid = eg.getAttribute('data-eid');
            const e = (doc.edges || []).filter(x => x.id === eid)[0];
            if (!e) continue;
            const paths = [].slice.call(eg.querySelectorAll('path'));
            const path = paths.filter(p => p.getAttribute('stroke') !== 'transparent')[0] || paths[0];
            if (!path || !path.getAttribute) continue;
            const toks = String(path.getAttribute('d') || '').trim().split(/[\s,]+/);
            /* primo segmento != M */
            let i = 0, cur = null, mid = null;
            while (i < toks.length && !mid) {
                const c = toks[i];
                if (c === 'M') { cur = [+toks[i + 1], +toks[i + 2]]; i += 3; }
                else if (c === 'L') { const p = [+toks[i + 1], +toks[i + 2]]; mid = [(cur[0] + p[0]) / 2, (cur[1] + p[1]) / 2]; i += 3; }
                else if (c === 'Q') { const q = [+toks[i + 1], +toks[i + 2], +toks[i + 3], +toks[i + 4]]; mid = [0.25 * cur[0] + 0.5 * q[0] + 0.25 * q[2], 0.25 * cur[1] + 0.5 * q[1] + 0.25 * q[3]]; i += 5; }
                else i++;
            }
            if (!mid) continue;
            const ctm = path.getScreenCTM();
            if (!ctm) continue;
            const sp = new DOMPoint(mid[0], mid[1]).matrixTransform(ctm);
            if (sp.x < 140 || sp.y < 140 || sp.x > innerWidth - 140 || sp.y > innerHeight - 140) continue;
            const cand = [].slice.call(document.querySelectorAll('.sc-nodes g.sc-node[data-nid]'))
                .filter(g => { const n = g.getAttribute('data-nid'); return n !== e.from && n !== e.to; });
            for (const g of cand) {
                const r = g.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                if (cx < 80 || cy < 80 || cx > innerWidth - 80 || cy > innerHeight - 80) continue;
                return { from: { x: cx, y: cy }, to: { x: sp.x, y: sp.y }, nid: g.getAttribute('data-nid'), eid: eid };
            }
        }
        return null;
    });
    if (cross) {
        await pageB.mouse.move(cross.from.x, cross.from.y, { steps: 4 });
        await pageB.mouse.down();
        await pageB.mouse.move(cross.to.x, cross.to.y, { steps: 12 });
        await pageB.mouse.up();
        await sleep(260);
        console.log('        B1d prep: nodo ' + cross.nid + ' trascinato sul midpoint dell\'arco ' + cross.eid);
    } else {
        console.log('        B1d prep: NESSUN attraversamento creato (nessun candidato) — sampler con precondizione vuota');
    }
    await evalCheck(pageB, 'B', 'B1d',
        'z-order anche in MAPPA (curve): mid segmenti sopra nodi non terminali, misses=0 (>=6 nodi)',
        SAMPLER, HYP.B1d, true);

    const CYCLE = ['lr', 'libero', 'riassunto', 'albero'];
    for (const t of CYCLE) {
        await setSchemaType(pageB, t);
        await sleep(480);
        await tabsCheck(t === 'albero' ? 'albero_ritorno' : t);
    }

    /* --- B2: tab Testo (hint senza selezione, editor con nodo) --- */
    /* deseleziona cliccando il background */
    const bg1 = await centerWhere(pageB, SCHEMI_EMPTY_POINT);
    if (bg1) await pageB.mouse.click(bg1.x, bg1.y);
    /* apri tab Testo */
    const tabT = await centerWhere(pageB, () => {
        const t = [].slice.call(document.querySelectorAll('.sc-side .sc-tab')).find(x => x.textContent.trim() === 'Testo');
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (tabT) await pageB.mouse.click(tabT.x, tabT.y);
    const tabActive = await until10(pageB, () => {
        const t = [].slice.call(document.querySelectorAll('.sc-side .sc-tab')).find(x => x.textContent.trim() === 'Testo');
        return !!(t && t.classList.contains('active'));
    });
    const b2b = await pageB.evaluate(() => {
        const tas = [].slice.call(document.querySelectorAll('.sc-side textarea'));
        const taT = tas.find(t => (t.placeholder || '').indexOf('Titolo') >= 0);
        if (!taT) return { ok: false, evidence: 'textarea Testo assente' };
        const bodyT = taT.closest('.sc-body');
        const note = bodyT.querySelector('.sc-note');
        const inT = bodyT.querySelector('input[type=text]');
        const visible = bodyT.style.display !== 'none';
        const hint = note ? note.textContent : '';
        const ok = visible && /Seleziona un nodo/.test(hint) && taT.disabled && inT && inT.disabled;
        return {
            ok: ok,
            evidence: 'bodyT visibile=' + visible + ' hint="' + hint.slice(0, 70) + '" ta.disabled=' + taT.disabled +
                ' input.disabled=' + (inT ? inT.disabled : 'n/a'),
            m: { visible, hint: hint.slice(0, 90), taDisabled: taT.disabled }
        };
    });
    await pushCheck(pageB, 'B', 'B2b', 'tab Testo senza selezione: hint visibile contiene "Seleziona un nodo" + editor disabled',
        b2b.ok && tabActive, b2b.evidence + ' tabActive=' + tabActive, b2b.m);
    await shot(pageB, 'qa_ab_b2_tab_testo');

    /* selezione nodo -> editor attivo valorizzato */
    const pick2 = await centerWhere(pageB, () => {
        const nodes = [].slice.call(document.querySelectorAll('.sc-nodes g.sc-node[data-nid]'));
        for (const g of nodes) {
            const r = g.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            if (cx < 1 || cy < 1 || cx > innerWidth - 1 || cy > innerHeight - 1) continue;
            const el = document.elementFromPoint(cx, cy);
            if (el && el.closest('[data-nid]') === g) return { nid: g.getAttribute('data-nid'), x: cx, y: cy };
        }
        return null;
    });
    let expText = null, b2cOk = false, b2cEv = 'pick assente';
    if (pick2) {
        await pageB.mouse.click(pick2.x, pick2.y);
        expText = await pageB.evaluate(async nid => {
            const it = await window.StudyStore.getItem('b1dense');
            const d = JSON.parse(it.content);
            const n = (d.nodes || []).find(x => x.id === nid);
            return n ? String(n.text == null ? '' : n.text) : null;
        }, pick2.nid);
        b2cOk = await until10(pageB, a => {
            const tas = [].slice.call(document.querySelectorAll('.sc-side textarea'));
            const taT = tas.find(t => (t.placeholder || '').indexOf('Titolo') >= 0);
            return !!(taT && !taT.disabled && a.exp !== null && taT.value === a.exp);
        }, 150, { exp: expText });
        const b2c = await pageB.evaluate(a => {
            const tas = [].slice.call(document.querySelectorAll('.sc-side textarea'));
            const taT = tas.find(t => (t.placeholder || '').indexOf('Titolo') >= 0);
            return { val: taT ? taT.value : null, disabled: taT ? taT.disabled : null };
        }, null);
        b2cEv = 'nid=' + pick2.nid + ' ta.disabled=' + b2c.disabled + ' valore="' + String(b2c.val).slice(0, 60) +
            '" atteso="' + String(expText).slice(0, 60) + '"';
    }
    await pushCheck(pageB, 'B', 'B2c', 'con nodo selezionato: editor attivo (textarea non disabled) valorizzato col testo del nodo',
        b2cOk, b2cEv, { nid: pick2 ? pick2.nid : null, expected: expText });

    /* modifica titolo -> salvato + DOM aggiornato */
    let b2dOk = false, b2dEv = '';
    if (pick2) {
        const inRect = await centerWhere(pageB, () => {
            const tas = [].slice.call(document.querySelectorAll('.sc-side textarea'));
            const taT = tas.find(t => (t.placeholder || '').indexOf('Titolo') >= 0);
            const inT = taT ? taT.closest('.sc-body').querySelector('input[type=text]') : null;
            if (!inT) return null;
            const r = inT.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (inRect) {
            await pageB.mouse.click(inRect.x, inRect.y);
            await pageB.keyboard.down('Control'); await pageB.keyboard.press('a'); await pageB.keyboard.up('Control');
            await pageB.keyboard.type('Titolo Aggiornato QA');
            /* attesa save (debounce 900ms) */
            for (let i = 0; i < MAX_ATT; i++) {
                const t = await pageB.evaluate(async nid => {
                    const it = await window.StudyStore.getItem('b1dense');
                    const d = JSON.parse(it.content);
                    const n = (d.nodes || []).find(x => x.id === nid);
                    return n ? String(n.text || '') : '';
                }, pick2.nid);
                if (/^Titolo Aggiornato QA/.test(t)) { b2dOk = true; b2dEv = 'store text="' + t.slice(0, 60) + '"'; break; }
                await sleep(300);
            }
            const domTxt = await pageB.evaluate(nid => {
                const g = document.querySelector('g.sc-node[data-nid="' + nid + '"]');
                return g ? g.textContent : null;
            }, pick2.nid);
            /* word-wrap SVG: il tspan di riga consuma lo spazio di wrap -> confronto senza whitespace */
            const domNorm = domTxt ? String(domTxt).replace(/\s+/g, '') : '';
            b2dOk = b2dOk && domNorm === 'TitoloAggiornatoQA';
            b2dEv += ' | DOM g.sc-node text="' + String(domTxt).slice(0, 70) + '" norm="' + domNorm.slice(0, 70) + '"';
        } else b2dEv = 'input Titolo non trovato';
    }
    await pushCheck(pageB, 'B', 'B2d', 'modifica titolo -> dopo save il testo del nodo nel DOM (g.sc-node text) e nello store e aggiornato',
        b2dOk, b2dEv || 'nodo non selezionabile', { nid: pick2 ? pick2.nid : null });

    /* --- B3: undo/redo --- */
    const b3a = await pageB.evaluate(() => {
        const u = document.querySelector('.sc-tools button[title="Annulla (Ctrl+Z)"]');
        const r = document.querySelector('.sc-tools button[title="Ripristina (Ctrl+Y)"]');
        const inWrap = b => !!(b && b.closest('.sc-btnwrap'));
        const inTools = b => !!(b && b.closest('.sc-tools'));
        const wrapUndo = [].slice.call(document.querySelectorAll('.sc-btnwrap button'))
            .filter(b => /Annulla|Ripristina/.test((b.title || '') + b.textContent));
        const ok = !!u && !!r && inTools(u) && inTools(r) && !inWrap(u) && !inWrap(r) && wrapUndo.length === 0;
        return {
            ok: ok,
            evidence: 'undoTrovato=' + !!u + ' redoTrovato=' + !!r + ' inScTools=' + inTools(u) + '/' + inTools(r) +
                ' inBtnWrap=' + inWrap(u) + '/' + inWrap(r) + ' undoRedoDentroBtnWrap=' + wrapUndo.length +
                ' glyph undo="' + (u ? u.textContent.trim() : '') + '" redo="' + (r ? r.textContent.trim() : '') + '"',
            m: { undo: !!u, redo: !!r, undoInWrap: inWrap(u), redoInWrap: inWrap(r) }
        };
    });
    await pushCheck(pageB, 'B', 'B3a', 'bottoni ↶ Annulla e ↷ Ripetri presenti nella toolbar .sc-tools FUORI da .sc-btnwrap',
        b3a.ok, b3a.evidence, b3a.m);

    /* B3b: +Nodo -> +1, ↶ -> -1, ↷ -> torna */
    {
        const n0 = await pageB.evaluate(() => document.querySelectorAll('g.sc-node[data-nid]').length);
        const addBtn = await centerWhere(pageB, () => {
            const b = [].slice.call(document.querySelectorAll('.sc-btnwrap .tool-btn'))
                .find(x => /^\+\s*Nodo$/.test(x.textContent.trim()));
            if (!b || b.disabled) return null;
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        let n1 = -1, n2 = -1, n3 = -1;
        if (addBtn) {
            await pageB.mouse.click(addBtn.x, addBtn.y);
            await until10(pageB, a => document.querySelectorAll('g.sc-node[data-nid]').length === a + 1, 150, n0);
            n1 = await pageB.evaluate(() => document.querySelectorAll('g.sc-node[data-nid]').length);
            const uC = await centerWhere(pageB, () => {
                const b = document.querySelector('.sc-tools button[title="Annulla (Ctrl+Z)"]');
                if (!b || b.disabled) return null;
                const r = b.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            });
            if (uC) await pageB.mouse.click(uC.x, uC.y);
            for (let i = 0; i < MAX_ATT; i++) { n2 = await pageB.evaluate(() => document.querySelectorAll('g.sc-node[data-nid]').length); if (n2 === n0) break; await sleep(120); }
            const rC = await centerWhere(pageB, () => {
                const b = document.querySelector('.sc-tools button[title="Ripristina (Ctrl+Y)"]');
                if (!b || b.disabled) return null;
                const r = b.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            });
            if (rC) await pageB.mouse.click(rC.x, rC.y);
            for (let i = 0; i < MAX_ATT; i++) { n3 = await pageB.evaluate(() => document.querySelectorAll('g.sc-node[data-nid]').length); if (n3 === n1) break; await sleep(120); }
        }
        await pushCheck(pageB, 'B', 'B3b',
            '+ Nodo -> nodi+1; ↶ -> nodi-1 in 1 click; ↷ -> torna il valore (sequenza N,N+1,N,N+1)',
            !!addBtn && n0 + 1 === n1 && n2 === n0 && n3 === n1,
            'seq nodi=[' + [n0, n1, n2, n3].join(',') + '] btnTrovato=' + !!addBtn,
            { seq: [n0, n1, n2, n3] });
    }

    /* B3c: cambio tipo via select -> ↶ in 1 click torna al precedente (select+layout+badge) */
    {
        const before3 = await pageB.evaluate(() => {
            const sel = document.querySelector('.sc-type-sel');
            const badge = document.querySelector('.sc-zoom');
            const g = document.querySelector('g.sc-node[data-nid]');
            const r = g.getBoundingClientRect();
            return {
                type: sel.value, badge: badge.textContent, nid: g.getAttribute('data-nid'),
                rect: { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, w: Math.round(r.width) }
            };
        });
        await setSchemaType(pageB, 'mappa');
        await sleep(480);
        const midType = await pageB.evaluate(() => document.querySelector('.sc-type-sel').value);
        const uC = await centerWhere(pageB, () => {
            const b = document.querySelector('.sc-tools button[title="Annulla (Ctrl+Z)"]');
            if (!b || b.disabled) return null;
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        let afterType = null, after3 = null;
        if (uC) {
            await pageB.mouse.click(uC.x, uC.y);
            const okT = await until10(pageB, a => document.querySelector('.sc-type-sel').value === a.type, 150, { type: before3.type });
            afterType = await pageB.evaluate(nid => {
                const sel = document.querySelector('.sc-type-sel');
                const badge = document.querySelector('.sc-zoom');
                const g = document.querySelector('g.sc-node[data-nid="' + nid + '"]');
                const r = g ? g.getBoundingClientRect() : null;
                return {
                    type: sel.value, badge: badge.textContent,
                    rect: r ? { l: Math.round(r.left * 10) / 10, t: Math.round(r.top * 10) / 10, w: Math.round(r.width) } : null
                };
            }, before3.nid);
            after3 = { okT, rect: afterType && afterType.rect };
        }
        const layoutOk = after3 && after3.okT && after3.rect && Math.abs(after3.rect.l - before3.rect.l) <= 2 &&
            Math.abs(after3.rect.t - before3.rect.t) <= 2;
        const ok = !!uC && midType === 'mappa' && afterType && afterType.type === before3.type &&
            afterType.badge === before3.badge && layoutOk;
        await pushCheck(pageB, 'B', 'B3c',
            'cambio tipo albero->mappa poi UN click ↶: select value + layout nodo (rect +/-2px) + badge zoom tornano al precedente',
            ok,
            'before type=' + before3.type + ' badge=' + before3.badge + ' rect=(' + before3.rect.l + ',' + before3.rect.t + ')' +
            ' | dopo change type=' + midType + ' | after 1 undo: type=' + (afterType && afterType.type) +
            ' badge=' + (afterType && afterType.badge) + ' rect=' + (afterType && after3.rect ? JSON.stringify(afterType.rect) : 'n/a') +
            ' btnDisabled=' + (uC ? 'no' : 'SI/disabled'),
            { before: before3, after: afterType });
        await shot(pageB, 'qa_ab_b3_undo_dopo');
    }

    /* B3d: Ctrl+Z via page.keyboard stesso comportamento */
    {
        const t0 = await pageB.evaluate(() => document.querySelector('.sc-type-sel').value);
        await setSchemaType(pageB, 'lr');
        await sleep(480);
        const t1 = await pageB.evaluate(() => document.querySelector('.sc-type-sel').value);
        /* sfuoca input e porta il focus sul body cliccando il background */
        const bg2 = await centerWhere(pageB, SCHEMI_EMPTY_POINT);
        if (bg2) await pageB.mouse.click(bg2.x, bg2.y);
        await pageB.keyboard.down('Control');
        await pageB.keyboard.press('z');
        await pageB.keyboard.up('Control');
        const okD = await until10(pageB, () => document.querySelector('.sc-type-sel').value === 'albero', 150);
        const t2 = await pageB.evaluate(() => document.querySelector('.sc-type-sel').value);
        await pushCheck(pageB, 'B', 'B3d',
            'Ctrl+Z via page.keyboard (focus body, niente input): il cambio tipo torna al precedente in 1 pressione',
            t0 === 'albero' && t1 === 'lr' && okD && t2 === t0,
            'sequenza type=[' + [t0, t1, t2].join(' -> ') + '] bgPoint=' + (bg2 ? bg2.tag : 'null'),
            { seq: [t0, t1, t2] });
    }

    /* --- B4: Mano eliminato, pan, space+drag, slider drawopts --- */
    const b4a = await pageB.evaluate(() => {
        const btns = [].slice.call(document.querySelectorAll('button'));
        const mano = btns.filter(b => /\bMano\b/.test(
            (b.title || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')));
        const matita = btns.filter(b => /Matita/.test((b.title || '') + ' ' + b.textContent) && !b.closest('.sc-btnwrap'));
        return {
            ok: mano.length === 0 && matita.length >= 1,
            evidence: 'bottoni con "Mano"=' + mano.length + ' bottoni "Matita"=' + matita.length +
                (matita.length ? ' title="' + matita[0].title + '" label="' + matita[0].textContent.trim() + '"' : ''),
            m: { mano: mano.length, matita: matita.length }
        };
    });
    await pushCheck(pageB, 'B', 'B4a', 'nessun bottone con title/label "Mano"; bottone "Matita" presente (disegno preservato)',
        b4a.ok, b4a.evidence, b4a.m);

    /* B4b: pan sfondo -> transform .sc-world cambia */
    {
        const pt = await centerWhere(pageB, SCHEMI_EMPTY_POINT);
        const t0 = await pageB.evaluate(() => document.querySelector('.sc-world').getAttribute('transform'));
        if (pt) {
            await pageB.mouse.move(pt.x, pt.y);
            await pageB.mouse.down();
            await pageB.mouse.move(pt.x + 120, pt.y + 70, { steps: 8 });
            await pageB.mouse.up();
        }
        const t1 = await until10(pageB, a => document.querySelector('.sc-world').getAttribute('transform') !== a, 120, t0);
        const tr = await pageB.evaluate(() => document.querySelector('.sc-world').getAttribute('transform'));
        const parse = s => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(s || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
        const p0 = parse(t0), p1 = parse(tr);
        const moved = p0 && p1 && (Math.abs(p1[0] - p0[0]) > 50 || Math.abs(p1[1] - p0[1]) > 40);
        await pushCheck(pageB, 'B', 'B4b',
            'mousedown sfondo vuoto + mousemove -> tutto il contenuto si sposta (transform .sc-world prima/dopo cambia di ~delta)',
            !!pt && moved,
            'punto=' + (pt ? pt.tag : 'null') + ' transform prima="' + t0 + '" dopo="' + tr + '"' +
            ' delta=' + (p0 && p1 ? '(' + (p1[0] - p0[0]) + ',' + (p1[1] - p0[1]) + ')' : 'n/a'),
            { before: t0, after: tr, delta: p0 && p1 ? [p1[0] - p0[0], p1[1] - p0[1]] : null });
        await shot(pageB, 'qa_ab_b4_pan_wheel');
    }

    /* B4c: space+drag con cursor grab */
    {
        const cur0 = await pageB.evaluate(() => getComputedStyle(document.querySelector('.sc-stage svg')).cursor);
        await pageB.keyboard.down('Space');
        const cur1 = await until10(pageB, () => getComputedStyle(document.querySelector('.sc-stage svg')).cursor === 'grab', 120);
        const curDuring = await pageB.evaluate(() => getComputedStyle(document.querySelector('.sc-stage svg')).cursor);
        const t0 = await pageB.evaluate(() => document.querySelector('.sc-world').getAttribute('transform'));
        const pt = await centerWhere(pageB, SCHEMI_EMPTY_POINT);
        if (pt && cur1) {
            await pageB.mouse.move(pt.x, pt.y);
            await pageB.mouse.down();
            await pageB.mouse.move(pt.x + 90, pt.y + 60, { steps: 6 });
            await pageB.mouse.up();
        }
        const t1 = await pageB.evaluate(() => document.querySelector('.sc-world').getAttribute('transform'));
        await pageB.keyboard.up('Space');
        const curAfter = await until10(pageB, () => getComputedStyle(document.querySelector('.sc-stage svg')).cursor !== 'grab', 120);
        const curFinal = await pageB.evaluate(() => getComputedStyle(document.querySelector('.sc-stage svg')).cursor);
        const moved = t1 !== t0;
        await pushCheck(pageB, 'B', 'B4c',
            'Space premuto -> cursor grab; space+drag sposta il contenuto; rilascio Space -> cursore torna (non grab)',
            cur1 && moved && curAfter && curFinal !== 'grab',
            'cursor prima="' + cur0 + '" con Space="' + curDuring + '" dopo rilascio="' + curFinal + '"' +
            ' transform "' + t0 + '" -> "' + t1 + '" spostato=' + moved,
            { cursorBefore: cur0, cursorSpace: curDuring, cursorAfter: curFinal, moved });
    }

    /* B4d: .sc-drawopts visibile SOLO con Matita/disegno attivo */
    {
        const disp0 = await pageB.evaluate(() => getComputedStyle(document.querySelector('.sc-drawopts')).display);
        const matRect = await centerWhere(pageB, () => {
            const b = [].slice.call(document.querySelectorAll('.sc-tools .tool-btn'))
                .find(x => x.textContent.trim() === 'Matita' && !x.closest('.sc-btnwrap'));
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        let disp1 = null, disp2 = null;
        if (matRect) {
            await pageB.mouse.click(matRect.x, matRect.y);
            await until10(pageB, () => document.querySelector('.sc-drawopts').classList.contains('on'));
            disp1 = await pageB.evaluate(() => getComputedStyle(document.querySelector('.sc-drawopts')).display);
            await pageB.mouse.click(matRect.x, matRect.y);
            await until10(pageB, () => !document.querySelector('.sc-drawopts').classList.contains('on'));
            disp2 = await pageB.evaluate(() => getComputedStyle(document.querySelector('.sc-drawopts')).display);
        }
        await pushCheck(pageB, 'B', 'B4d',
            'slider .sc-drawopts: display none senza strumento disegno -> flex con Matita attiva -> none di nuovo',
            !!matRect && disp0 === 'none' && disp1 === 'flex' && disp2 === 'none',
            'sequence display=[' + [disp0, disp1, disp2].join(',') + '] btnMatita=' + !!matRect,
            { sequence: [disp0, disp1, disp2] });
    }

    /* B0: console/errore zero */
    const errB = await pageB.evaluate(() => window.__QA.errors);
    await pushCheck(pageB, 'B', 'B0', 'zero QA.errors / pageerror / console.error durante il giro B',
        errB.length === 0 && logsB.length === 0,
        'QA.errors=' + JSON.stringify(errB.slice(0, 4)) + ' logs=' + JSON.stringify(logsB.slice(0, 6)));
    const qaB = await pageB.evaluate(() => ({ checks: window.__QA.checks.length, errors: window.__QA.errors }));
    await pageB.close();

    await browser.close();

    /* ---------- misure + report ---------- */
    const measures = {
        build: 'BUILD ' + BUILD_TS,
        viewport: VW + 'x' + VH,
        generatedAt: new Date().toISOString(),
        A: MEAS.A, B: MEAS.B,
        console: { A: { logs: logsA, qaErrors: errA }, B: { logs: logsB, qaErrors: errB } },
        harness: { notes: qaA, schemi: qaB }
    };
    fs.writeFileSync(path.join(QA_DIR, 'qa_ab_measures.json'), JSON.stringify(measures, null, 1));

    const all = [].concat(
        Object.keys(MEAS.A).map(k => ({ b: 'A', id: k })),
        Object.keys(MEAS.B).map(k => ({ b: 'B', id: k }))
    );
    console.log('\n===== QA-AB TOTALE: ' + all.length + ' check registrati via __qaCheck =====');
    console.log('Misure -> qa/qa_ab_measures.json');
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
