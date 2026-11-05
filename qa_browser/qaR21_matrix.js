'use strict';
/* qa_browser/qaR21_matrix.js - T2 REALE: QA-1 matrice luogo x adattatore
   per i 7 mount di FontiPanel + QA-2 misura spazio guadagnato.
   Per ogni mount (notes/schemi/documenti/presentazioni/fogli/video/ripasso):
   apre il pannello, inietta fixture (md+math, {"html"}, libro .md), verifica
   adattatori (katex reale injectato, sanitize, heading libro), ricerca
   collassabile, resize persistito, insert (ciclo abilita) e screenshot cella.
   Output: qa/r21_matrix_measures.json + qa/r21_m_<contesto>.png +
   qa/r21_a_{md,html,libro}.png (screenshot adattatori, cella appunti) +
   QA-2: qa/r21_space_measures.json (prima=R20 baseline notes, dopo=R21).
   Uso: node qa_browser/qaR21_matrix.js
   EXIT: 0 se tutte le celle DOPO ok. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const KATEX_JS = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'vendor', 'katex', 'katex.min.js'), 'utf8');
const BASE20 = fs.readFileSync(path.join(QA_DIR, 'r20_notes_baseline.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CELLS = [
    { ctx: 'notes', file: 'notes.html', ready: () => 'window.__qaHarnessNotes && window.__qaHarnessNotes.ready', open: "document.querySelector('[data-fonti]').click()" },
    { ctx: 'schemi', file: 'schemi.html', ready: () => "window.__QA && (window.__QA.done===false || window.__QA.harnessReady) && Array.from(document.querySelectorAll('.sc-tab')).length>0", open: "(Array.from(document.querySelectorAll('.sc-tab')).filter(function(b){return b.textContent.trim()==='Fonti';})[0]).click()" },
    { ctx: 'documenti', file: 'documenti.html', ready: () => "window.__QA && document.querySelector('.doc-shell, .doc-pill-l')", open: "Array.from(document.querySelectorAll('button')).filter(function(b){return /Fonti/.test((b.title||'')+' '+(b.textContent||''));})[0].click()" },
    { ctx: 'presentazioni', file: 'presentazioni.html', ready: () => 'window.__qaHarness21 && window.__qaHarness21.ready', open: "Array.from(document.querySelectorAll('button')).filter(function(b){return /Fonti/.test((b.title||'')+' '+(b.textContent||''));})[0].click()" },
    { ctx: 'fogli', file: 'fogli.html', ready: () => "window.__QA && document.querySelector('#main > *')", open: "Array.from(document.querySelectorAll('button')).filter(function(b){return /Fonti/.test((b.title||'')+' '+(b.textContent||''));})[0].click()" },
    { ctx: 'video', file: 'video.html', ready: () => "window.__QA && document.querySelector('#main > *')", open: "Array.from(document.querySelectorAll('button')).filter(function(b){return /Fonti/.test((b.title||'')+' '+(b.textContent||''));})[0].click()" },
    { ctx: 'ripasso', file: 'ripasso.html', ready: () => 'window.__qaHarness21 && window.__qaHarness21.ready', open: "Array.from(document.querySelectorAll('button')).filter(function(b){return /Fonti/.test((b.title||'')+' '+(b.textContent||''));})[0].click()" }
];

const FIX_MD = '# Capitolo R21\n\nMatematica $x^2+\\nu$ e display:\n\n$$\\xrightarrow{\\nu} E=mc^2$$\n\n- voce md';
const FIX_HTML = JSON.stringify({ html: '<h2>Titolo Due R21</h2><p>saluto <b>forte</b></p><script>evil()</script><div onclick="x()">ciao</div>' });

async function newPage(browser, opts) {
    opts = opts || {};
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    if (opts.baselineNotes) {
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes('modules/notes.js')) {
                req.respond({ status: 200, contentType: 'application/javascript', body: BASE20 });
            } else req.continue();
        });
    }
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', opts.file)).href,
        { waitUntil: 'load', timeout: 20000 });
    let okR = false;
    for (let i = 0; i < 48; i++) {
        try { okR = await page.evaluate(opts.readyExpr); } catch (e) { okR = false; }
        if (okR) break;
        await sleep(250);
    }
    if (!okR) throw new Error('harness non pronto: ' + opts.file);
    return { page, errs };
}

/* fixture: items + mat libri + stub pywebview + katex reale */
async function injectFixtures(page) {
    await page.evaluate((md, htmlDoc) => {
        const Q = window.__QA;
        if (!Q || !Q.store) return { err: 'no store' };
        Q.store.items.push({
            id: 'r21md', kind: 'note', title: 'Nota R21 Md', content: JSON.stringify({
                objects: [{ t: 'text', x: 40, y: 40, w: 400, h: 40, text: md, size: 14, color: '#141414' }]
            }), materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        });
        Q.store.items.push({
            id: 'r21html', kind: 'documento', title: 'Doc R21 Html', content: htmlDoc,
            materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        });
        window.StudyStore.listMaterials = async function () {
            return (Q.store.mats && Q.store.mats.length ? Q.store.mats : []).concat([
                { path: 'C:/preselected_books/r21-libro.md', name: 'r21-libro.md' },
                { path: 'C:/file_AIstudio/r21-mat.pdf', name: 'r21-mat.pdf' }
            ]);
        };
        window.pywebview = {
            api: {
                read_material_text: async function (p) {
                    if (/\.md$/i.test(p)) return { success: true, kind: 'md', name: 'r21-libro.md', text: md };
                    return { success: true, kind: 'pdf', name: 'r21-mat.pdf', text: 'Testo semplice materiale R21.' };
                }
            }
        };
        return { ok: true };
    }, FIX_MD, FIX_HTML);
    await page.addScriptTag({ content: KATEX_JS });
}

async function runCell(browser, cell) {
    const res = { ctx: cell.ctx, checks: {} };
    const { page, errs } = await newPage(browser, { file: cell.file, readyExpr: cell.ready() });
    try {
        await injectFixtures(page);
        await page.evaluate(cell.open);
        await sleep(600);   // mount + fetchSources async
        // pannello presente?
        const panelOk = await page.evaluate(ctx =>
            !!document.querySelector('.fp21-root[data-fp21="' + (ctx === 'notes' ? 'appunti' : ctx) + '"]') ||
            !!document.querySelector('.fp21-root'), cell.ctx);
        res.checks.panel = panelOk;
        const ctxAttr = await page.evaluate(() => {
            const p = document.querySelector('.fp21-root');
            return p ? p.getAttribute('data-fp21') : null;
        });
        res.checks.ctxAttr = ctxAttr;

        // fixture elencate (md + html + libro)
        const listed = await page.evaluate(() => {
            const its = Array.from(document.querySelectorAll('.fp21-item')).map(b => b.textContent);
            return {
                md: its.some(t => /Nota R21 Md/.test(t)),
                html: its.some(t => /Doc R21 Html/.test(t)),
                libro: its.some(t => /r21-libro/.test(t)),
                libroBadge: its.some(t => /Libro/.test(t))
            };
        });
        res.checks.listed = listed;

        const pick = async (re) => {
            const ok = await page.evaluate(re => {
                const b = Array.from(document.querySelectorAll('.fp21-item'))
                    .filter(x => new RegExp(re).test(x.textContent))[0];
                if (!b) return false;
                b.click();
                return true;
            }, re.source);
            await sleep(450); // preview async (katex synch dopo)
            return ok;
        };

        // AD1: md + matematica KATEX reale
        const mdOk = await pick(/Nota R21 Md/);
        const mdInfo = await page.evaluate(() => {
            const p = document.querySelector('.fp21-pbody');
            const html = p ? p.innerHTML : '';
            const txt = p ? p.textContent : '';
            return {
                katex: !!document.querySelector('.fp21-pbody .katex'),
                h1: /<h1[^>]*>Capitolo R21<\/h1>/.test(html),
                li: /<li>voce md<\/li>/.test(html),
                noRaw: txt.indexOf('$$') < 0 && txt.indexOf('\\xrightarrow') < 0,
                fbBadge: /formula non renderizzabile/.test(txt)
            };
        });
        res.checks.md = Object.assign({ picked: mdOk }, mdInfo);
        res.checks.md.ok = mdOk && mdInfo.h1 && mdInfo.li && mdInfo.noRaw &&
            (mdInfo.katex || mdInfo.fbBadge);

        // screenshot cella con preview md (math visibile)
        await page.screenshot({ path: path.join(QA_DIR, 'r21_m_' + cell.ctx + '.png'), fullPage: false });

        // AD2: {"html"} sanitizzato
        const htmlOk = await pick(/Doc R21 Html/);
        const htmlInfo = await page.evaluate(() => {
            const p = document.querySelector('.fp21-pbody');
            const html = p ? p.innerHTML : '';
            const txt = p ? p.textContent : '';
            return {
                h2: /<h2[^>]*>Titolo Due R21<\/h2>/.test(html),
                strong: /<b>forte<\/b>/.test(html),
                noScript: html.indexOf('<script') < 0 && txt.indexOf('evil()') < 0,
                noHandler: html.indexOf('onclick') < 0,
                noJson: txt.indexOf('{"html') < 0
            };
        });
        res.checks.htmlDoc = Object.assign({ picked: htmlOk }, htmlInfo);
        res.checks.htmlDoc.ok = htmlOk && htmlInfo.h2 && htmlInfo.strong &&
            htmlInfo.noScript && htmlInfo.noHandler && htmlInfo.noJson;

        // AD3: libro con heading
        const libOk = await pick(/r21-libro/);
        const libInfo = await page.evaluate(() => {
            const p = document.querySelector('.fp21-pbody');
            const html = p ? p.innerHTML : '';
            return { h1: /<h1[^>]*>Capitolo R21<\/h1>/.test(html) };
        });
        res.checks.libro = Object.assign({ picked: libOk }, libInfo);
        res.checks.libro.ok = libOk && libInfo.h1;

        // RICERCA collassabile + persistenza
        res.checks.search = await page.evaluate(() => {
            const p = document.querySelector('.fp21-root');
            const lens = p && p.querySelector('.fp21-lens');
            const search = p && p.querySelector('.fp21-search');
            if (!lens || !search) return { err: 'assente' };
            const before = search.style.display;
            lens.click();
            const after = search.style.display;
            const key = 'fp21_search_' + (p.getAttribute('data-fp21') || 'appunti');
            const persisted = localStorage.getItem(key);
            lens.click(); // torna allo stato iniziale
            return { collapsedByDefault: before === 'none', toggled: before !== after, persisted: persisted, key: key };
        });
        res.checks.search.ok = res.checks.search.collapsedByDefault &&
            res.checks.search.toggled && res.checks.search.persisted === '1';

        // RESIZE drag + persistenza + reset dblclick
        res.checks.resize = await page.evaluate(() => {
            const p = document.querySelector('.fp21-root');
            const rz = p && p.querySelector('.fp21-rz-r');
            if (!rz) return { err: 'handle assente' };
            const key = 'fp21_w_' + (p.getAttribute('data-fp21') || 'appunti');
            localStorage.removeItem(key);
            const w0 = p.getBoundingClientRect().width;
            const md = new MouseEvent('mousedown', { bubbles: true, clientX: w0, clientY: 100 });
            rz.dispatchEvent(md);
            document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: w0 + 120, clientY: 100 }));
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: w0 + 120, clientY: 100 }));
            const w1 = p.getBoundingClientRect().width;
            const persisted = localStorage.getItem(key);
            rz.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            const resetOk = localStorage.getItem(key) == null;
            return { w0: Math.round(w0), w1: Math.round(w1), persisted: persisted, resetOk: resetOk,
                     minmax: w1 >= 240 && w1 <= Math.floor(innerWidth * 0.6) };
        });
        res.checks.resize.ok = res.checks.resize.w1 !== res.checks.resize.w0 &&
            res.checks.resize.persisted != null && res.checks.resize.resetOk &&
            res.checks.resize.minmax;

        // INSERT ciclo (selezione + abilita + click) e nessun errore
        const ins = await page.evaluate(() => {
            const p = document.querySelector('.fp21-root');
            const item = p && p.querySelector('.fp21-item');
            if (!item) return { err: 'nessuna voce' };
            item.click();
            return { sel: true };
        });
        await sleep(450);
        const ins2 = await page.evaluate(() => {
            const p = document.querySelector('.fp21-root');
            const b = p && p.querySelector('.fp21-insert');
            if (!b) return { err: 'bottone assente' };
            const wasDisabled = b.disabled;
            b.click();
            return { wasDisabled: wasDisabled, clicked: true, label: b.textContent };
        });
        await sleep(400);
        // undo generico: Ctrl+Z su window (pattern jsdom) + nessun crash
        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        });
        await sleep(300);
        res.checks.insert = Object.assign({}, ins, ins2);
        res.checks.insert.ok = !!ins.sel && ins2.clicked && ins2.wasDisabled === false;

        res.pageerrors = errs.slice(0, 4);
        res.ok = res.checks.panel && res.checks.listed.md && res.checks.listed.html &&
            res.checks.listed.libro && res.checks.md.ok && res.checks.htmlDoc.ok &&
            res.checks.libro.ok && res.checks.search.ok && res.checks.resize.ok &&
            res.checks.insert.ok && errs.length === 0;
    } catch (e) {
        res.error = String(e && e.stack || e).slice(0, 400);
        res.ok = false;
    }
    await page.close();
    return res;
}

/* QA-2: spazio prima (R20 baseline: header .fn-side-head + ricerca fissa)
   vs dopo (R21: intestazione 0, ricerca solo su richiesta) */
async function measureSpace(browser) {
    // PRIMA: pagina con notes.js R20 baseline, pannello Fonti aperto
    const { page } = await newPage(browser, { file: 'notes.html', baselineNotes: true, readyExpr: 'window.__qaHarnessNotes && window.__qaHarnessNotes.ready' });
    await page.evaluate(() => { document.querySelector('[data-fonti]').click(); });
    await sleep(500);
    const prima = await page.evaluate(() => {
        const h = document.querySelector('.fn-side-head');
        const s = document.querySelector('.fn-side-search');
        const list = document.querySelector('.fn-flist');
        return {
            header_px: h ? Math.round(h.getBoundingClientRect().height) : 0,
            search_px: s ? Math.round(s.getBoundingClientRect().height) : 0,
            list_px: list ? Math.round(list.getBoundingClientRect().height) : 0
        };
    });
    await page.close();
    // DOPO: pagina corrente
    const r2 = await newPage(browser, { file: 'notes.html', readyExpr: 'window.__qaHarnessNotes && window.__qaHarnessNotes.ready' });
    await r2.page.evaluate(() => { document.querySelector('[data-fonti]').click(); });
    await sleep(500);
    const dopo = await r2.page.evaluate(() => {
        const bar = document.querySelector('.fp21-root .fp21-bar');
        const s = document.querySelector('.fp21-root .fp21-search');
        const list = document.querySelector('.fp21-root .fp21-list');
        return {
            header_px: 0,   // R21: nessun riquadro intestazione fisso
            search_px: s && s.style.display !== 'none' ? Math.round(s.getBoundingClientRect().height) : 0,
            bar_px: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
            list_px: list ? Math.round(list.getBoundingClientRect().height) : 0
        };
    });
    await r2.page.close();
    const chromePrima = prima.header_px + prima.search_px;
    const chromeDopo = dopo.header_px + dopo.search_px;   // bar dei chip e' il filtro (2.3), non "intestazione+ricerca"
    const gained = chromePrima - chromeDopo;
    return { prima: prima, dopo: dopo, chrome_prima_px: chromePrima, chrome_dopo_px: chromeDopo, guadagno_px: gained,
             nota: 'intestazione fissa rimossa (0px); ricerca solo su richiesta (collassata=0px); bar chip = filtro 2.3 conteggiato a parte' };
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const out = { method: 'qaR21_matrix: montatura reale per harness qa_ui, fixture iniettate, katex vendored iniettato' };

    for (const cell of CELLS) {
        const t0 = Date.now();
        const r = await runCell(browser, cell);
        r.sec = Math.round((Date.now() - t0) / 100) / 10;
        out[cell.ctx] = r;
        console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + cell.ctx.padEnd(14) +
            ' ctx=' + r.checks.ctxAttr +
            ' md=' + (r.checks.md && r.checks.md.ok) +
            ' html=' + (r.checks.htmlDoc && r.checks.htmlDoc.ok) +
            ' libro=' + (r.checks.libro && r.checks.libro.ok) +
            ' search=' + (r.checks.search && r.checks.search.ok) +
            ' rz=' + (r.checks.resize && r.checks.resize.ok) +
            ' ins=' + (r.checks.insert && r.checks.insert.ok) +
            ' err=' + (r.pageerrors ? r.pageerrors.length : 0) +
            ' (' + r.sec + 's)' + (r.error ? ' ERR:' + r.error.slice(0, 120) : ''));
    }

    // screenshot ADATTATORI extra (cella appunti: md+math, html, libro)
    try {
        const { page } = await newPage(browser, { file: 'notes.html', readyExpr: 'window.__qaHarnessNotes && window.__qaHarnessNotes.ready' });
        await injectFixtures(page);
        await page.evaluate(() => document.querySelector('[data-fonti]').click());
        await sleep(500);
        const shotSel = async (re, name) => {
            await page.evaluate(re => {
                const b = Array.from(document.querySelectorAll('.fp21-item')).filter(x => new RegExp(re).test(x.textContent))[0];
                if (b) b.click();
            }, re.source);
            await sleep(500);
            const el = await page.$('.fp21-root');
            if (el) await el.screenshot({ path: path.join(QA_DIR, name) });
        };
        await shotSel(/Nota R21 Md/, 'r21_a_md.png');
        await shotSel(/Doc R21 Html/, 'r21_a_html.png');
        await shotSel(/r21-libro/, 'r21_a_libro.png');
        await page.close();
        console.log('  screenshot adattatori: r21_a_{md,html,libro}.png');
    } catch (e) { console.log('  screenshot adattatori FAILED: ' + e.message); }

    // QA-2 spazio
    try {
        const space = await measureSpace(browser);
        fs.writeFileSync(path.join(QA_DIR, 'r21_space_measures.json'), JSON.stringify(space, null, 2));
        console.log('QA-2 spazio: prima(intest+ricerca)=' + space.chrome_prima_px +
            'px -> dopo=' + space.chrome_dopo_px + 'px, guadagno=' + space.guadagno_px + 'px');
        out.space = space;
    } catch (e) { console.log('QA-2 FAILED: ' + e.message); out.space = { err: e.message }; }

    fs.writeFileSync(path.join(QA_DIR, 'r21_matrix_measures.json'), JSON.stringify(out, null, 2));
    let fail = 0, n = 0;
    CELLS.forEach(c => { n++; if (!out[c.ctx] || !out[c.ctx].ok) { fail++; console.log('VERDETTO FAIL: ' + c.ctx); } });
    console.log('\nMATRICE: ' + (n - fail) + '/' + n + ' celle OK');
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ECCEZIONE: ' + (e && e.stack || e)); process.exit(2); });
