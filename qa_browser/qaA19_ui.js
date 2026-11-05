'use strict';
/* qa_browser/qaA19_ui.js - T2 REALE (Chromium) - BLOCCHI A1+A3 di R19:
   toolbar appunti finale + pannello Fonti usabile.
   - PRIMA: interception serving qa/r19_notes_baseline.js (pre-modifica)
   - DOPO:  notes.js corrente
   Assert geometrici/DOM reali + screenshot:
     qa/r19_a_toolbar_{prima|dopo}.png   (pill sinistra)
     qa/r19_a_fonti_{prima|dopo}.png     (pannello Fonti aperto, filtro, md)
   Output: qa/r19_s_measures.json -> chiave "ui" (merge).
   Uso: node qa_browser/qaA19_ui.js
   EXIT: 0 se tutti gli assert DOPO ok (prima = informativo). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const BASE = fs.readFileSync(path.join(QA_DIR, 'r19_notes_baseline.js'), 'utf8');
const MEAS = path.join(QA_DIR, 'r19_s_measures.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MD_TEXT = '# Titolo MD\n\nParagrafo con **grasso** e *corsivo*.\n\n- elemento uno\n- elemento due';
const TOOLBAR_EXPECT = [
    'Annulla (Ctrl+Z)', 'Ripeti (Ctrl+Y)', 'Immagine', 'Documento',
    'File PPT/PPTX', 'Fonti',
    'Genera flashcard dalla nota/selezione (AI: F01)'
];

async function newPage(browser, useBaseline) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    if (useBaseline) {
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes('modules/notes.js')) {
                req.respond({ status: 200, contentType: 'application/javascript', body: BASE });
            } else req.continue();
        });
    }
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'notes.html')).href,
        { waitUntil: 'load', timeout: 20000 });
    let okR = false;
    for (let i = 0; i < 40; i++) {
        okR = await page.evaluate(() => !!(window.__qaHarnessNotes && window.__qaHarnessNotes.ready &&
            window.__ink && window.__ink.state() && window.__ink.state().tool));
        if (okR) break;
        await sleep(250);
    }
    if (!okR) throw new Error('harness notes non pronto');
    return { page, errs };
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const out = { ui: {} };

    for (const mode of ['prima', 'dopo']) {
        console.log('\n==== UI MODE ' + mode.toUpperCase() + ' ====');
        const { page, errs } = await newPage(browser, mode === 'prima');
        const res = {};

        /* ---------- 1) TOOLBAR ---------- */
        const pillL = await page.$('.fn-pill-left');
        await pillL.screenshot({ path: path.join(QA_DIR, 'r19_a_toolbar_' + mode + '.png') });
        res.toolbar = await page.evaluate(() => {
            const pill = document.querySelector('.fn-pill-left');
            const btns = Array.from(pill.children)
                .filter(el => el.tagName === 'BUTTON' && el.style.display !== 'none')
                .map(b => ({ title: b.title || '', text: (b.textContent || '').trim() }));
            const labels = btns.map(b => b.title || b.text);
            return {
                n: btns.length,
                labels: labels,
                hasAI: btns.some(b => b.text === 'AI'),
                hasMigliora: btns.some(b => b.text === 'Migliora'),
                hasFlashcard: btns.some(b => b.text === 'Flashcard'),
                shaping: document.querySelectorAll('[data-shaping]').length
            };
        });
        // undo ha il title A2.6 esteso (due livelli): match sul prefisso
        res.toolbar.order_ok = res.toolbar.labels.length === TOOLBAR_EXPECT.length &&
            res.toolbar.labels[0].startsWith(TOOLBAR_EXPECT[0]) &&
            res.toolbar.labels.slice(1).every((v, i) => v === TOOLBAR_EXPECT[i + 1]);
        console.log('  toolbar: n=' + res.toolbar.n + ' AI=' + res.toolbar.hasAI +
            ' Migliora=' + res.toolbar.hasMigliora + ' Flashcard=' + res.toolbar.hasFlashcard +
            ' order_ok=' + res.toolbar.order_ok + ' shaping=' + res.toolbar.shaping);

        /* ---------- 2) stato tool SINGOLO ---------- */
        await page.click('[data-tool="gomma"]');
        await sleep(80);
        res.single_tool = await page.evaluate(() =>
            document.querySelectorAll('.fn-pill-right .fn-tb.active').length);
        res.single_tool_ok = res.single_tool === 1;
        await page.click('[data-tool="penna"]');
        await sleep(60);
        console.log('  tool attivi dopo click gomma: ' + res.single_tool +
            (res.single_tool_ok ? ' OK' : ' FAIL'));

        /* ---------- 3) popover click-fuori ---------- */
        await page.click('[data-color]');
        await sleep(120);
        const popOpen = await page.evaluate(() =>
            document.querySelector('.fn-pop-color').classList.contains('show'));
        const cRect = await page.evaluate(() => {
            const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
            const r = c.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.click(cRect.x, cRect.y);
        await sleep(150);
        const popClosed = await page.evaluate(() =>
            !document.querySelector('.fn-pop-color').classList.contains('show'));
        res.popover = { open: popOpen, closed_outside: popClosed, ok: popOpen && popClosed };
        console.log('  popover: aperto=' + popOpen + ' chiuso_outside=' + popClosed);

        /* ---------- 4) PANNELLO FONTI ---------- */
        // polyfill mat + pywebview (env.js non espone listMaterials)
        await page.evaluate((md) => {
            window.StudyStore.listMaterials = async function () {
                return [
                    { path: 'C:/preselected_books/libro-gamma.pdf', name: 'Libro Gamma' },
                    { path: 'C:/file_AIstudio/riassunto-md.md', name: 'riassunto-md.md' }
                ];
            };
            window.pywebview = {
                api: {
                    read_material_text: async function (p) {
                        const isMd = /\.md$/i.test(String(p || ''));
                        return { success: true, kind: isMd ? 'md' : 'pdf', name: 'x', size: 2048,
                                 text: isMd ? md : 'Testo del libro gamma in pagina uno.' };
                    }
                }
            };
        }, MD_TEXT);

        await page.click('[data-fonti]');
        await page.waitForSelector('.fn-side.show', { timeout: 5000 });
        await sleep(350); // loadFontiSources async

        res.fonti = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll('.fn-fchip'))
                .map(c => c.textContent.trim());
            const items = Array.from(document.querySelectorAll('.fn-fitem'))
                .map(b => b.textContent.trim());
            return { chips: chips, n_items: items.length, items: items };
        });
        res.fonti.has_chips =
            JSON.stringify(res.fonti.chips) === JSON.stringify(['Tutti', 'Appunti', 'Materiali', 'Libri']);
        console.log('  chips: ' + JSON.stringify(res.fonti.chips) + ' voci=' + res.fonti.n_items);

        // filtro chip "Materiali" -> solo mat non-libro (visibile anche in screenshot)
        if (res.fonti.has_chips) {
            await page.evaluate(() => {
                const c = Array.from(document.querySelectorAll('.fn-fchip'))
                    .filter(x => x.textContent.trim() === 'Materiali')[0];
                if (c) c.click();
            });
            await sleep(120);
        }

        // preview .md (selezione direttamente dalla lista filtrata)
        const mdClicked = await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('.fn-fitem'))
                .filter(x => /riassunto-md/.test(x.textContent))[0];
            if (!b) return false;
            b.click();
            return true;
        });
        await sleep(400); // read_material_text async
        res.fonti.md = await page.evaluate(() => {
            const prev = document.querySelector('.fn-fprev');
            const html = prev ? prev.innerHTML : '';
            const txt = prev ? prev.textContent : '';
            return {
                clicked: true,
                has_h1: /<h1>Titolo MD<\/h1>/.test(html),
                has_strong: /<strong>grasso<\/strong>/.test(html),
                has_li: /<li>elemento uno<\/li>/.test(html),
                has_badge: !!document.querySelector('.fn-fprev .fn-fbadge'),
                has_path: /Percorso:|Dimensione:|Tipo file:|Indicizzato/.test(txt),
                has_rawpath: /C:\/(preselected_books|file_AIstudio)/.test(html),
                preview_len: txt.length
            };
        });
        res.fonti.md.clicked = mdClicked;
        console.log('  md preview: h1=' + res.fonti.md.has_h1 + ' strong=' + res.fonti.md.has_strong +
            ' li=' + res.fonti.md.has_li + ' path=' + res.fonti.md.has_path +
            ' rawpath=' + res.fonti.md.has_rawpath);

        // screenshot pannello (con filtro + preview md)
        const side = await page.$('.fn-side');
        await side.screenshot({ path: path.join(QA_DIR, 'r19_a_fonti_' + mode + '.png') });

        // inserimento fonte study nella nota
        await page.evaluate(() => {
            const inp = document.querySelector('.fn-side-search');
            if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await sleep(80);
        await page.evaluate(() => {
            const c = Array.from(document.querySelectorAll('.fn-fchip'))
                .filter(x => x.textContent.trim() === 'Tutti')[0];
            if (c) c.click();
        });
        await sleep(120);
        const selOk = await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('.fn-fitem'))
                .filter(x => /Riassunto Storia Romana/.test(x.textContent))[0];
            if (!b) return false;
            b.click();
            return true;
        });
        await sleep(200);
        await page.evaluate(() => {
            const ins = document.querySelector('.fn-finsert');
            if (ins && !ins.disabled) ins.click();
        });
        await sleep(1250); // debounce salvataggio 900ms
        res.fonti.insert = await page.evaluate(() => {
            const it = window.__QA.store.items.filter(x => x.id === 'nt1')[0];
            if (!it) return { ok: false, err: 'nt1 assente' };
            let content = it.content || '';
            let hasRef = false, validJson = true;
            try {
                const d = JSON.parse(content);
                const objs = (d.pages && d.pages[0] && d.pages[0].objects) || d.objects || [];
                hasRef = objs.some(o => o.t === 'text' && /Fonte:/.test(o.text || ''));
            } catch (e) { validJson = false; }
            return { ok: hasRef, validJson: validJson, selected: true };
        });
        res.fonti.insert.selected = selOk;
        res.fonti.insert.ok = selOk && res.fonti.insert.ok;
        console.log('  inserimento fonte: ok=' + res.fonti.insert.ok +
            ' json_valid=' + res.fonti.insert.validJson);

        /* ---------- verdetto DOPO ---------- */
        res.expected = {
            toolbar: 'ordine=undo,redo,immagine,Documento,ppt,fonti,Flashcard; AI/Migliora assenti; nessun [data-shaping]',
            fonti: 'chips Tutti|Appunti|Materiali|Libri; md renderizzato (h1/strong/li); NESSUN metadato/path; insert funzionante',
            single_tool: '1 sollo tool attivo', popover: 'aperto + chiuso da click fuori'
        };
        res.ok_dopo = res.toolbar.order_ok && !res.toolbar.hasAI && !res.toolbar.hasMigliora &&
            res.toolbar.hasFlashcard && res.toolbar.shaping === 0 &&
            res.single_tool_ok && res.popover.ok &&
            res.fonti.has_chips && res.fonti.md.clicked &&
            res.fonti.md.has_h1 && res.fonti.md.has_strong && res.fonti.md.has_li &&
            !res.fonti.md.has_path && !res.fonti.md.has_rawpath && res.fonti.md.has_badge &&
            res.fonti.insert.ok && res.fonti.insert.validJson;
        console.log('  UI[' + mode + '] ok=' + res.ok_dopo);

        out.ui[mode] = res;
        if (errs.length) out.ui[mode].pageerrors = errs.slice(0, 5);
        await page.close();
    }

    fs.writeFileSync(MEAS, JSON.stringify((() => {
        let cur = {};
        try { cur = JSON.parse(fs.readFileSync(MEAS, 'utf8')); } catch (e) { cur = {}; }
        cur.ui = out.ui;
        return cur;
    })(), null, 2));

    const dopoOk = !!(out.ui.dopo && out.ui.dopo.ok_dopo);
    const prima = out.ui.prima || {};
    console.log('\nPRIMA (baseline): toolbar AI=' + (prima.toolbar && prima.toolbar.hasAI) +
        ' chips=' + (prima.fonti && prima.fonti.has_chips) +
        ' md_h1=' + (prima.fonti && prima.fonti.md && prima.fonti.md.has_h1));
    console.log('DOPO  (R19):      ok=' + dopoOk);
    console.log('Screenshot: qa/r19_a_toolbar_{prima,dopo}.png, qa/r19_a_fonti_{prima,dopo}.png');
    await browser.close();
    process.exit(dopoOk ? 0 : 1);
})().catch(e => { console.error('ECCEZIONE: ' + (e && e.stack || e)); process.exit(2); });
