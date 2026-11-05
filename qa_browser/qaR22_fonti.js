'use strict';
/* qa_browser/qaR22_fonti.js - T2 REALE R22 FE-FONTI: verifica in browser
   reale (puppeteer) dei fix del pannello Fonti montato nei moduli.
   Celle:
   (a) dock: pannello aperto in documenti + secondo mount flottante
       presentazioni -> comandi toolbar/pill del modulo restano visibili e
       cliccabili (elementFromPoint sui rect dei bottoni ritorna il bottone)
       e overlap rect pannello vs toolbar = 0. Screenshot PRIMA (interception
       con qa/r22_fonti_baseline.js = stato pre-R22, manca il dock) e DOPO.
   (b) collapso riga superiore: altezza clientHeight .fp21-list PRIMA
       (espansa) e DOPO (collassata via .fp21-chev) -> px guadagnati;
       persistenza localStorage 'fp21_top_<contesto>' con chiusura/riapertura
       e reload.
   (c) resize: drag su handle rz-r -> width cambia e persiste
       (fp21_w_<contesto>); doppio click -> reset al default (kW/kH rimossi).
   (d) snapshot nota manoscritta: inietta note stroke+text (formato come
       tests/f22_fonti_preview.test.js) -> preview con <img dataURL> PRIMA
       del testo; nota solo-tratto SENZA "Nessun testo disponibile"; nota
       vuota CON il messaggio. Screenshot.
   (e) math inline: fixture $x^2$, \(y_i\), $$..$$, \[..\] -> zero nodi testo
       con \Delta/\text/$$/delimitatori non renderizzati nel .fp21-pbody
       (sotto .katex ammesso), katex reale iniettato.
   Output: qa/r22_fonti_measures.json + qa/r22_fonti_{prima,dopo}_*.png
   Uso: node qa_browser/qaR22_fonti.js
   EXIT: 0 se tutti i check DOPO ok (PRIMA = evidenza del problema, non
   gate; l'unica assert di PRIMA e' che l'interception sia davvero attiva). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const KATEX_JS = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'vendor', 'katex', 'katex.min.js'), 'utf8');
const BASE_FP = fs.readFileSync(path.join(QA_DIR, 'r22_fonti_baseline.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const READY_DOC = "window.__QA && document.querySelector('.doc-shell, .doc-pill-l')";
const READY_PP = 'window.__qaHarness21 && window.__qaHarness21.ready';

/* fixture note (formato identico a tests/f22_fonti_preview.test.js) */
const STROKE = { t: 'stroke', x: 10, y: 10, pts: [[10, 10], [50, 60], [90, 20], [140, 70]], size: 3, color: '#123456' };
const SHAPE = { t: 'shape', kind: 'circle', color: '#c00', size: 2, box: { x: 100, y: 40, w: 80, h: 60 }, params: null };
const TXT_A = { t: 'text', x: 10, y: 160, w: 400, h: 40, text: 'Testo A della nota mista R22', size: 14, color: '#141414' };
const MATH_TEXT = 'Inline $x^2$ e parentesi \\(y_i + \\Delta t\\), display:\n\n' +
    '$$\\sum_{i=0}^{n} x_i$$\n\ne quadre \\[\\int_0^1 f(x)\\,dx\\] fine.';
function note(id, title, objects) {
    return {
        id: id, kind: 'note', title: title,
        content: JSON.stringify({ objects: objects }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    };
}
const ITEMS = [
    note('r22mix', 'Nota R22 Mix', [STROKE, TXT_A]),      // mista: tratto + testo
    note('r22ink', 'Nota R22 Ink', [STROKE, SHAPE]),      // solo tratti
    note('r22empty', 'Nota R22 Vuota', []),               // veramente vuota
    note('r22math', 'Nota Math R22', [{ t: 'text', x: 40, y: 40, w: 500, h: 120, text: MATH_TEXT, size: 14, color: '#141414' }])
];
const RAW_TOKENS = ['\\Delta', '\\text', '$$', '\\(', '\\)', '\\[', '\\]', '\\sum', '\\int'];

/* ---------- util ---------- */
const checks = [];
function chk(name, cond, extra) {
    checks.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra).slice(0, 220) });
    console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : ' - ' + String(extra).slice(0, 180)));
    return !!cond;
}

async function waitReady(page, expr) {
    let ok = false;
    for (let i = 0; i < 60; i++) {
        try { ok = await page.evaluate(expr); } catch (e) { ok = false; }
        if (ok) return true;
        await sleep(250);
    }
    return false;
}

async function newPage(browser, opts) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    // handshake __qaShot dell'harness qa_ui: lascia completare il driver
    await page.evaluateOnNewDocument(() => {
        const iv = setInterval(() => {
            try { if (window.__QA && window.__QA.needShot) window.__SHOT_OK = true; }
            catch (e) { /* ok */ }
        }, 80);
        setTimeout(() => clearInterval(iv), 45000);
    });
    if (opts.baseline) {
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes('modules/fonti_panel.js')) {
                req.respond({ status: 200, contentType: 'application/javascript', body: BASE_FP });
            } else req.continue();
        });
    }
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', opts.file)).href,
        { waitUntil: 'load', timeout: 20000 });
    if (!(await waitReady(page, opts.readyExpr))) throw new Error('harness non pronto: ' + opts.file);
    // stato deterministico: azzera le chiavi fp21_* del contesto
    await page.evaluate(() => {
        try {
            Object.keys(localStorage).forEach(k => { if (/^fp21_/.test(k)) localStorage.removeItem(k); });
        } catch (e) { /* ok */ }
    });
    return { page, errs };
}

async function injectFixtures(page) {
    const r = await page.evaluate(items => {
        const Q = window.__QA;
        if (!Q || !Q.store) return { err: 'no store' };
        items.forEach(it => Q.store.items.push(it));
        return { ok: true, n: Q.store.items.length };
    }, ITEMS);
    await page.addScriptTag({ content: KATEX_JS });
    return r;
}

async function openPanel(page) {
    const ok = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button'))
            .filter(x => /Fonti/.test((x.title || '') + ' ' + (x.textContent || '')))[0];
        if (!b) return false;
        b.click();
        return true;
    });
    await sleep(850);   // fetchSources async + fitDock (t+350ms)
    return ok;
}

async function panelPresent(page) {
    return page.evaluate(() => !!document.querySelector('.fp21-root'));
}

/* hit-test toolbar/pill + overlap pannello vs toolbar */
async function measureDock(page, tb, pillBtns) {
    return page.evaluate((tb, pillBtns) => {
        const p = document.querySelector('.fp21-root');
        if (!p) return { err: 'pannello assente' };
        const pr = p.getBoundingClientRect();
        const overlaps = {};
        let overlap = 0;
        let tbBottom = 0;
        const found = [];
        tb.forEach(s => {
            const el = document.querySelector(s);
            if (!el) { overlaps[s] = null; return; }
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) { overlaps[s] = null; return; }
            found.push(s);
            if (r.bottom > tbBottom) tbBottom = r.bottom;
            const w = Math.max(0, Math.min(pr.right, r.right) - Math.max(pr.left, r.left));
            const h = Math.max(0, Math.min(pr.bottom, r.bottom) - Math.max(pr.top, r.top));
            overlaps[s] = Math.round(w * h);
            overlap += w * h;
        });
        // hit-test sui SOLI comandi (button) della toolbar: .doc-bar/.mod-header
        // sono contenitori, non comandi (il rect di .mod-header non e' un bottone)
        const sel = tb.map(s => s + ' button').join(',') + ',' + pillBtns.join(',');
        const btns = Array.from(document.querySelectorAll(sel)).filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        const tested = [];
        btns.forEach(b => {
            const r = b.getBoundingClientRect();
            const x = Math.min(window.innerWidth - 1, Math.max(0, Math.round(r.left + r.width / 2)));
            const y = Math.min(window.innerHeight - 1, Math.max(0, Math.round(r.top + r.height / 2)));
            const hit = document.elementFromPoint(x, y);
            const same = hit === b || (!!hit && b.contains(hit));
            const pe = getComputedStyle(b).pointerEvents !== 'none';
            tested.push({
                label: String(b.title || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36),
                ok: same && pe,
                hit: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ').slice(0, 2).join('.')) : 'null'
            });
        });
        return {
            found: found, overlaps: overlaps, overlapPx2: Math.round(overlap),
            tbBottom: Math.round(tbBottom),
            nBtn: tested.length, hitOk: tested.length > 0 && tested.every(t => t.ok),
            fails: tested.filter(t => !t.ok),
            chev: !!p.querySelector('.fp21-chev'),
            pos: getComputedStyle(p).position, zi: getComputedStyle(p).zIndex,
            panelRect: { t: Math.round(pr.top), b: Math.round(pr.bottom), l: Math.round(pr.left), r: Math.round(pr.right) }
        };
    }, tb, pillBtns);
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const out = {
        method: 'qaR22_fonti: montatura reale qa_ui + fixture iniettate + katex vendored; ' +
            'PRIMA = interception qa/r22_fonti_baseline.js (pre-R22)'
    };
    const shots = [];
    try {
        /* ============ (a) PRIMA: documenti con fonti_panel BASELINE ============ */
        {
            const { page, errs } = await newPage(browser, {
                file: 'documenti.html', readyExpr: READY_DOC, baseline: true
            });
            await injectFixtures(page);
            const opened = await openPanel(page);
            chk('a0 apertura pannello documenti (PRIMA/baseline)', opened && await panelPresent(page));
            const prima = await measureDock(page, ['.doc-bar', '.mod-header'],
                ['.doc-pill-r button', '.doc-pill-l button']);
            prima.pageerrors = errs.slice(0, 4);
            out.toolbar = out.toolbar || {};
            out.toolbar.documenti = { prima: prima };
            // l'interception deve essere davvero attiva: la baseline NON ha .fp21-chev
            chk('a1 interception baseline attiva (PRIMA senza .fp21-chev)', prima.chev === false,
                'chev=' + prima.chev);
            await page.screenshot({ path: path.join(QA_DIR, 'r22_fonti_prima_documenti.png') });
            shots.push('r22_fonti_prima_documenti.png');
            // EVIDENZA (non gate): con la baseline il pannello copre la toolbar
            console.log('  EVIDENZA PRIMA documenti: overlap=' + prima.overlapPx2 +
                'px2 hitOk=' + prima.hitOk + ' top=' + (prima.panelRect && prima.panelRect.t) +
                ' fails=' + (prima.fails || []).length);
            await page.close();
        }

        /* ============ (a/c/d/e/b) DOPO: documenti con codice corrente ============ */
        const { page, errs } = await newPage(browser, {
            file: 'documenti.html', readyExpr: READY_DOC, baseline: false
        });
        const fx = await injectFixtures(page);
        chk('a2 fixture iniettate (store)', !fx.err, fx.err || ('n=' + fx.n));
        const opened = await openPanel(page);
        chk('a3 apertura pannello documenti (DOPO)', opened && await panelPresent(page));

        /* --- (a) dock DOPO --- */
        const dopo = await measureDock(page, ['.doc-bar', '.mod-header'],
            ['.doc-pill-r button', '.doc-pill-l button']);
        out.toolbar.documenti.dopo = dopo;
        chk('a4 DOPO: .fp21-chev presente (codice R22 caricato)', dopo.chev === true);
        chk('a5 DOPO: toolbar trovata (' + (dopo.found || []).join(',') + ')',
            (dopo.found || []).indexOf('.doc-bar') >= 0 && (dopo.found || []).indexOf('.mod-header') >= 0);
        chk('a6 DOPO: overlap pannello vs toolbar = 0px2 (dichiarato in json)',
            dopo.overlapPx2 === 0, 'overlap=' + dopo.overlapPx2 + ' ' + JSON.stringify(dopo.overlaps));
        chk('a7 DOPO: elementFromPoint sui bottoni toolbar/pill ritorna il bottone',
            dopo.hitOk && dopo.nBtn > 0, 'nBtn=' + dopo.nBtn + ' fails=' + JSON.stringify(dopo.fails));
        chk('a8 DOPO: pannello dock SOTTO la toolbar (top=' + (dopo.panelRect && dopo.panelRect.t) +
            ' >= toolbar bottom=' + dopo.tbBottom + ', pos=' + dopo.pos + ' z=' + dopo.zi + ')',
            dopo.pos === 'fixed' && dopo.panelRect &&
            dopo.panelRect.t >= dopo.tbBottom + 6);
        await page.screenshot({ path: path.join(QA_DIR, 'r22_fonti_dopo_documenti.png') });
        shots.push('r22_fonti_dopo_documenti.png');

        /* --- (c) resize: drag rz-r + persistenza + dblclick reset --- */
        {
            const handle = await page.$('.fp21-root .fp21-rz-r');
            let box = handle ? await handle.boundingBox() : null;
            chk('c1 handle rz-r presente', !!box, box ? '' : 'assente');
            if (box) {
                const w0 = await page.evaluate(() => document.querySelector('.fp21-root').getBoundingClientRect().width);
                const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
                await page.mouse.move(cx, cy);
                await page.mouse.down();
                await page.mouse.move(cx + 120, cy, { steps: 12 });
                await page.mouse.up();
                await sleep(120);
                const st1 = await page.evaluate(k => ({
                    w: document.querySelector('.fp21-root').getBoundingClientRect().width,
                    ls: localStorage.getItem(k)
                }), 'fp21_w_documenti');
                const c2 = chk('c2 drag rz-r: width cambia (' + Math.round(w0) + '->' + Math.round(st1.w) + ')',
                    Math.abs(st1.w - w0) > 60, 'w0=' + w0 + ' w1=' + st1.w);
                const c3 = chk('c3 resize persistito in fp21_w_documenti',
                    st1.ls != null && Math.abs(parseFloat(st1.ls) - st1.w) <= 1.5, 'ls=' + st1.ls);
                // doppio click = reset ai default (340 o 60vw).
                // Sequenza CDP esplicita: 1o down/up + 2o down/up con
                // clickCount:2 (con mouse.click({clickCount:2}) questo
                // Chrome non genera dblclick/mousedown detail=2)
                await page.mouse.move(cx, cy);
                await page.mouse.down();
                await page.mouse.up();
                await sleep(40);
                await page.mouse.down({ clickCount: 2 });
                await page.mouse.up({ clickCount: 2 });
                await sleep(150);
                const st2 = await page.evaluate(() => ({
                    w: document.querySelector('.fp21-root').getBoundingClientRect().width,
                    lsW: localStorage.getItem('fp21_w_documenti'),
                    lsH: localStorage.getItem('fp21_h_documenti'),
                    def: Math.min(340, Math.floor(innerWidth * 0.6))
                }));
                const c4 = chk('c4 doppio click: reset al default (' + st2.def + 'px) e kW/kH rimossi',
                    st2.lsW == null && st2.lsH == null && Math.abs(st2.w - st2.def) <= 2,
                    'w=' + st2.w + ' lsW=' + st2.lsW);
                out.resize = {
                    key: 'fp21_w_documenti', w0: Math.round(w0), w1: Math.round(st1.w),
                    persisted: st1.ls, reset_w: Math.round(st2.w), default_w: st2.def,
                    ls_after_reset: st2.lsW, ok: !!(c2 && c3 && c4)
                };
            }
        }

        /* helpers in scope anche per il blocco (b): pick passa una STRINGA
           (un RegExp non sopravvive alla serializzazione di page.evaluate) */
        const pick = async pat => {
            const found = await page.evaluate(re => {
                const b = Array.from(document.querySelectorAll('.fp21-item'))
                    .filter(x => new RegExp(re).test(x.textContent))[0];
                if (!b) return false;
                b.click();
                return true;
            }, String(pat));
            await sleep(550);   // preview async + canvas toDataURL
            return found;
        };

        /* --- (d) snapshot nota manoscritta --- */
        {
            const info = () => page.evaluate(() => {
                const pb = document.querySelector('.fp21-pbody');
                const html = pb ? pb.innerHTML : '';
                const img = pb ? pb.querySelector('img.fp21-snap') : null;
                return {
                    html: html,
                    snap: !!img,
                    dataUrl: !!(img && /^data:image\/png;base64,/.test(img.getAttribute('src') || '')),
                    iSnap: html.indexOf('fp21-snap'),
                    iText: html.indexOf('Testo A della nota mista R22'),
                    noEmpty: html.indexOf('Nessun testo disponibile') < 0,
                    emptyMsg: html.indexOf('Nessun testo disponibile') >= 0
                };
            });
            // mista: snapshot dataURL PRIMA del testo
            const mixFound = await pick('Nota R22 Mix');
            const mix = await info();
            chk('d1 nota mista elencata e selezionata', mixFound);
            chk('d2 mista: <img fp21-snap> con src data:image/png', mix.snap && mix.dataUrl,
                mix.html.slice(0, 140));
            chk('d3 mista: snapshot PRIMA del testo (iSnap=' + mix.iSnap + ' < iText=' + mix.iText + ')',
                mix.iSnap >= 0 && mix.iText > mix.iSnap);
            chk('d4 mista: nessun "Nessun testo disponibile"', mix.noEmpty);
            await page.screenshot({ path: path.join(QA_DIR, 'r22_fonti_dopo_snapshot.png') });
            shots.push('r22_fonti_dopo_snapshot.png');
            // solo tratti
            await pick('Nota R22 Ink');
            const ink = await info();
            chk('d5 nota solo-tratto: snapshot presente', ink.snap && ink.dataUrl,
                ink.html.slice(0, 140));
            chk('d6 nota solo-tratto: SENZA "Nessun testo disponibile"', ink.noEmpty);
            // vuota
            await pick('Nota R22 Vuota');
            const emp = await info();
            chk('d7 nota vuota: CON "Nessun testo disponibile"', emp.emptyMsg);
            out.snapshot = {
                screenshot: 'r22_fonti_dopo_snapshot.png',
                mix: { snap: mix.snap, dataUrl: mix.dataUrl, img_before_text: mix.iSnap >= 0 && mix.iText > mix.iSnap, noEmptyMsg: mix.noEmpty },
                inkOnly: { snap: ink.snap, dataUrl: ink.dataUrl, noEmptyMsg: ink.noEmpty },
                empty: { msg: emp.emptyMsg },
                ok: !!(mixFound && mix.snap && mix.dataUrl && (mix.iText > mix.iSnap) &&
                    mix.noEmpty && ink.snap && ink.noEmpty && emp.emptyMsg)
            };
        }

        /* --- (e) math inline --- */
        {
            const found = await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('.fp21-item'))
                    .filter(x => /Nota Math R22/.test(x.textContent))[0];
                if (!b) return false;
                b.click();
                return true;
            });
            await sleep(550);
            const m = await page.evaluate(tokens => {
                const pb = document.querySelector('.fp21-pbody');
                if (!pb) return { err: 'pbody assente' };
                const texts = [];
                const walk = node => {
                    Array.prototype.forEach.call(node.childNodes || [], n => {
                        if (n.nodeType === 3) {
                            const t = n.nodeValue || '';
                            if (t.trim()) texts.push(t);
                        } else if (n.nodeType === 1) {
                            const cls = String(n.className || '');
                            if (/(^|\s)katex(\s|$)/.test(cls)) return;   // sotto .katex ammesso
                            walk(n);
                        }
                    });
                };
                walk(pb);
                const raw = texts.filter(t => tokens.some(tok => t.indexOf(tok) >= 0));
                return {
                    nText: texts.length, raw: raw.slice(0, 4),
                    katex: pb.querySelectorAll('.katex').length,
                    fb: pb.querySelectorAll('.fp21-mathfb').length
                };
            }, RAW_TOKENS);
            chk('e1 nota math elencata e selezionata', found);
            chk('e2 math: zero nodi testo con \\Delta/\\text/$$/delimitatori fuori .katex',
                m && m.raw && m.raw.length === 0, JSON.stringify(m && m.raw));
            chk('e3 math: katex renderizzato (n=' + (m && m.katex) + ') o fallback ripulito (fb=' + (m && m.fb) + ')',
                m && (m.katex >= 4 || m.fb >= 4), JSON.stringify(m));
            out.math = {
                fixture: '$x^2$, \\(..\\), $$..$$, \\[..\\]',
                katex_nodes: m && m.katex, fallback_nodes: m && m.fb,
                raw_textnodes: m && m.raw, ok: !!(found && m && m.raw && m.raw.length === 0 && (m.katex >= 4 || m.fb >= 4))
            };
            await page.screenshot({ path: path.join(QA_DIR, 'r22_fonti_dopo_math.png') });
            shots.push('r22_fonti_dopo_math.png');
        }

        /* --- (b) collapso riga superiore + persistenza --- */
        {
            const measureList = () => page.evaluate(() => {
                const p = document.querySelector('.fp21-root');
                if (!p) return { err: 'pannello assente' };
                const l = p.querySelector('.fp21-list');
                return {
                    h: l ? l.clientHeight : -1,
                    collapsed: p.classList.contains('fp21-collapsed'),
                    ls: localStorage.getItem('fp21_top_documenti')
                };
            });
            // stato iniziale deterministico: stessa preview selezionata
            // prima e dopo il reload (b7 = altezza lista invariata)
            await pick('Documento');
            const b1 = await measureList();
            chk('b1 riga espansa iniziale (no classe fp21-collapsed)',
                !b1.collapsed && b1.h > 0, JSON.stringify(b1));
            await page.evaluate(() => {
                const c = document.querySelector('.fp21-root .fp21-chev');
                if (c) c.click();
            });
            await sleep(180);
            const b2 = await measureList();
            const gained = b2.h - b1.h;
            chk('b2 collapso via .fp21-chev: .fp21-list ' + b1.h + 'px -> ' + b2.h +
                'px (+' + gained + 'px)', b2.collapsed && gained >= 8, JSON.stringify(b2));
            chk('b3 stato persistito fp21_top_documenti=1', b2.ls === '1', 'ls=' + b2.ls);
            // chiusura + riapertura (stesso pulsante Fonti)
            await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('button'))
                    .filter(x => /Fonti/.test((x.title || '') + ' ' + (x.textContent || '')))
                    .sort((a, z) => ((z.hasAttribute('aria-expanded') ? 1 : 0) - (a.hasAttribute('aria-expanded') ? 1 : 0)))[0];
                if (b) b.click();
            });
            await sleep(300);
            const closed = await page.evaluate(() => !document.querySelector('.fp21-root'));
            chk('b4 chiusura pannello', closed);
            const reopened = await openPanel(page);
            const b3 = await measureList();
            chk('b5 riapertura: collapso ripristinato da localStorage',
                reopened && b3.collapsed && b3.ls === '1', JSON.stringify(b3));
            // reload pagina + riapertura
            await page.reload({ waitUntil: 'load', timeout: 20000 });
            if (!(await waitReady(page, READY_DOC))) throw new Error('harness non pronto dopo reload');
            const reopened2 = await openPanel(page);
            await pick('Documento');   // stessa preview di b2: confronto appaiato
            const b4 = await measureList();
            chk('b6 reload: collapso persistito (fp21_top_documenti=1)',
                reopened2 && b4.collapsed && b4.ls === '1', JSON.stringify(b4));
            chk('b7 reload: altezza lista invariata (' + b4.h + ' ~ ' + b2.h + ')',
                Math.abs(b4.h - b2.h) <= 4, 'b4=' + b4.h + ' b2=' + b2.h);
            await page.screenshot({ path: path.join(QA_DIR, 'r22_fonti_dopo_collapse.png') });
            shots.push('r22_fonti_dopo_collapse.png');
            out.collapse = {
                key: 'fp21_top_documenti',
                prima_list_px: b1.h, dopo_list_px: b2.h, gained_px: gained,
                ls_after_toggle: b2.ls, reopen_ok: !!(reopened && b3.collapsed && b3.ls === '1'),
                reload_list_px: b4.h, reload_ok: !!(reopened2 && b4.collapsed && b4.ls === '1'),
                screenshot: 'r22_fonti_dopo_collapse.png',
                ok: !!(b1 && !b1.collapsed && b2.collapsed && gained >= 8 && b2.ls === '1' &&
                    b3.collapsed && b4.collapsed && Math.abs(b4.h - b2.h) <= 4)
            };
        }

        out.documenti_pageerrors = errs.slice(0, 6);
        chk('z1 zero pageerror nella pagina documenti', errs.length === 0, errs.slice(0, 2).join(' | '));
        await page.close();

        /* ============ (a) secondo mount flottante: presentazioni ============ */
        {
            const { page: pp, errs: pe } = await newPage(browser, {
                file: 'presentazioni.html', readyExpr: READY_PP, baseline: false
            });
            await injectFixtures(pp);
            const op = await openPanel(pp);
            chk('a9 apertura pannello presentazioni (secondo mount)', op && await panelPresent(pp));
            const mdock = await measureDock(pp, ['.pp-bar', '.mod-header'],
                ['.pp-pill-r button', '.pp-pill-l button']);
            out.toolbar.presentazioni = { dopo: mdock };
            chk('a10 presentazioni: toolbar .pp-bar trovata',
                (mdock.found || []).indexOf('.pp-bar') >= 0, JSON.stringify(mdock.found));
            chk('a11 presentazioni: overlap pannello vs toolbar = 0px2',
                mdock.overlapPx2 === 0, 'overlap=' + mdock.overlapPx2);
            chk('a12 presentazioni: elementFromPoint sui bottoni ritorna il bottone',
                mdock.hitOk && mdock.nBtn > 0, 'nBtn=' + mdock.nBtn + ' fails=' + JSON.stringify(mdock.fails));
            await pp.screenshot({ path: path.join(QA_DIR, 'r22_fonti_dopo_presentazioni.png') });
            shots.push('r22_fonti_dopo_presentazioni.png');
            chk('z2 zero pageerror nella pagina presentazioni', pe.length === 0, pe.slice(0, 2).join(' | '));
            await pp.close();
        }
    } catch (e) {
        chk('ECCEZIONE runner', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
        out.runner_error = String(e && e.stack || e).slice(0, 500);
    }

    out.screenshots = shots;
    const fail = checks.filter(c => !c.ok);
    out.checks_total = checks.length;
    out.checks_failed = fail.length;
    out.failed = fail;
    out.all_ok = fail.length === 0;
    fs.writeFileSync(path.join(QA_DIR, 'r22_fonti_measures.json'), JSON.stringify(out, null, 2));
    console.log('\nSCREENSHOT: ' + shots.join(', '));
    console.log('MEASURES: qa/r22_fonti_measures.json');
    console.log('\nRISULTATO qaR22_fonti: ' + (checks.length - fail.length) + '/' + checks.length + ' check ok');
    fail.forEach(f => console.log('  FALLITO: ' + f.name + ' ' + f.extra));
    await browser.close();
    process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('ECCEZIONE: ' + (e && e.stack || e)); process.exit(2); });
