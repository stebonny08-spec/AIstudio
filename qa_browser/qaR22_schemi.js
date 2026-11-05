/* qa_browser/qaR22_schemi.js - T2 REALE R22 (FE-SCHEMI 5.1/5.2)
   Verifica sul reale qa_ui/schemi.html che il FontiPanel negli Schemi
   viva DENTRO la tab Fonti del pannello destro (.sc-side) e NON sia un
   overlay flottante sul canvas (.sc-stage), anche simulando la cascade di
   index.html (notes/documenti/presentazioni iniettano CSS GLOBALE
   position:fixed/absolute su .fp21-root - regole copiate identiche in
   SIM_CSS, perche l'harness qa_ui non carica quei moduli).

   ESECUZIONI:
   - PRIMA: interception che serve qa/r22_schemi_baseline.js (schemi.js
     pre-R22) -> con SIM_CSS il pannello diventa fixed sopra il canvas
     (residuo dimostrato, screenshot r22_schemi_prima*.png);
   - DOPO: schemi.js corrente -> resta nel flusso della .sc-side anche con
     SIM_CSS (r22_schemi_dopo*.png) + rect/label/formula.

   Output: qa/r22_schemi_measures.json + qa/r22_schemi_*.png
   Uso: node qa_browser/qaR22_schemi.js
   EXIT: 0 se tutti i check di layout DOPO ok (l'assert math 5.2 e'
   riportato come stato ma NON guida l'exit: dipende da fonti_panel.js). */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const BASELINE = fs.readFileSync(path.join(QA_DIR, 'r22_schemi_baseline.js'), 'utf8');
const KATEX_JS = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'vendor', 'katex', 'katex.min.js'), 'utf8');
let KATEX_CSS = '';
try { KATEX_CSS = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'vendor', 'katex', 'katex.min.css'), 'utf8'); } catch (e) { /* ok */ }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* cascade index.html simulata: regole COPIATE identiche da notes.js (146-149),
   documenti.js (2387) e presentazioni.js (2353) - le stesse che colpiscono
   il .fp21-root degli Schemi nell'app reale (index.html carica TUTTI i moduli). */
const SIM_CSS = [
    '.fp21-root{position:absolute;left:12px;top:152px;bottom:auto;display:none;' +
    'flex-direction:column;gap:8px;background:#1a2030;border:1px solid #2a3142;border-radius:16px;' +
    'padding:12px;z-index:11;box-shadow:0 16px 44px rgba(0,0,0,.5);color:#f5f7fa;font-family:system-ui,sans-serif;}' +
    '.fp21-root.show{display:flex;}',
    '.fp21-root{position:fixed;top:58px;right:14px;z-index:160;box-sizing:border-box;' +
    'display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 72px);padding:8px;' +
    'background:#161a2a;border:1px solid rgba(255,255,255,.14);border-radius:12px;' +
    'box-shadow:0 18px 44px rgba(0,0,0,.5);color:#cfd6e4;font:12px/1.45 system-ui,sans-serif}'
].join('\n');

const READY = "window.__QA && (window.__QA.done===false || window.__QA.harnessReady) && Array.from(document.querySelectorAll('.sc-tab')).length>0";
const OPEN_FONTI = "(Array.from(document.querySelectorAll('.sc-tab')).filter(function(b){return b.textContent.trim()==='Fonti';})[0]).click()";
const MATH_TEXT = '# Fonte R22\n\nMatematica inline $x^2 + \\Delta t$ e parentesi \\(y_i + \\text{OK}\\).';

async function newPage(browser, opts) {
    opts = opts || {};
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    if (opts.baseline) {
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes('modules/schemi.js')) {
                req.respond({ status: 200, contentType: 'application/javascript', body: BASELINE });
            } else req.continue();
        });
    }
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href,
        { waitUntil: 'load', timeout: 20000 });
    let okR = false;
    for (let i = 0; i < 48; i++) {
        try { okR = await page.evaluate(READY); } catch (e) { okR = false; }
        if (okR) break;
        await sleep(250);
    }
    if (!okR) throw new Error('harness non pronto: qa_ui/schemi.html');
    return { page, errs };
}

async function measure(page) {
    return await page.evaluate(() => {
        const R = el => { if (!el) return null; const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                     left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
        const panel = document.querySelector('.fp21-root[data-fp21="schemi"]') || document.querySelector('.fp21-root');
        const side = document.querySelector('.sc-side');
        const stage = document.querySelector('.sc-stage');
        const pr = R(panel), sr = R(side), cr = R(stage);
        const cs = panel ? getComputedStyle(panel) : null;
        let overlapCanvas = 0;
        if (pr && cr) {
            const ox = Math.max(0, Math.min(pr.right, cr.right) - Math.max(pr.left, cr.left));
            const oy = Math.max(0, Math.min(pr.bottom, cr.bottom) - Math.max(pr.top, cr.top));
            overlapCanvas = Math.round(ox * oy);
        }
        const ins = document.querySelector('.fp21-root .fp21-insert');
        return {
            roots: document.querySelectorAll('.fp21-root').length,
            inSide: !!(panel && side && panel.closest('.sc-side')),
            position: cs ? cs.position : 'n/d',
            positionInline: panel ? (panel.style.position || '') : 'n/a',
            panel: pr, side: sr, stage: cr,
            overlap_canvas_px2: overlapCanvas,
            panel_x_ge_side_x: !!(pr && sr && pr.left >= sr.left - 1),
            insert_label: ins ? ins.textContent.trim() : null
        };
    });
}

async function openAndPreview(page) {
    await page.evaluate(OPEN_FONTI);
    await sleep(500);   // showTab -> refresh async
    await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('.fp21-item'))
            .filter(x => /Fonte Math S22/.test(x.textContent))[0];
        if (b) b.click();
    });
    await sleep(700);   // preview async + katex
}

async function mathStatus(page) {
    return await page.evaluate(() => {
        const pb = document.querySelector('.fp21-root .fp21-pbody');
        if (!pb) return { err: 'pbody assente' };
        const ptext = pb.textContent || '';
        const visible = [];
        (function walk(n) {
            if (n.nodeType === 3) { visible.push(n.nodeValue); return; }
            if (n.nodeType !== 1) return;
            const cls = n.getAttribute && n.getAttribute('class');
            if (cls && /(^|\s)katex(\s|$)/.test(cls)) return;
            for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
        })(pb);
        const katex = pb.querySelectorAll('.katex').length;
        const fallback = /formula non renderizzabile/.test(ptext);
        const dollar_rendered = (katex > 0 || fallback) && ptext.indexOf('$') < 0;
        const paren_raw = visible.some(t => t.indexOf('\\(') >= 0 || t.indexOf('\\)') >= 0);
        const raw_tokens = visible.filter(t => t.indexOf('\\Delta') >= 0 || t.indexOf('\\text') >= 0 || t.indexOf('$$') >= 0);
        return {
            katex: katex, fallback: fallback,
            dollar_rendered: dollar_rendered,
            paren_rendered: !paren_raw,
            no_raw_tokens: raw_tokens.length === 0,
            raw_sample: raw_tokens[0] ? raw_tokens[0].slice(0, 120) : null
        };
    });
}

async function run(browser, baseline) {
    const tag = baseline ? 'prima' : 'dopo';
    const res = { baseline: baseline, checks: {} };
    const { page, errs } = await newPage(browser, { baseline: baseline });
    try {
        if (KATEX_JS) await page.addScriptTag({ content: KATEX_JS });
        if (KATEX_CSS) await page.addStyleTag({ content: KATEX_CSS });
        // fixture fonte con math inline $...$ e \(...\)
        await page.evaluate(txt => {
            window.__QA.store.items.push({
                id: 'r22math', kind: 'note', title: 'Fonte Math S22',
                content: JSON.stringify({ objects: [{ t: 'text', x: 20, y: 20, w: 320, h: 40, text: txt }] }),
                materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
            });
        }, MATH_TEXT);

        await openAndPreview(page);
        // --- stato HARNESS (solo schemi.js + fonti_panel, nessun CSS fp21 globale)
        res.harness = await measure(page);
        await page.screenshot({ path: path.join(QA_DIR, 'r22_schemi_' + tag + '_harness.png') });

        // --- stato SIMULAZIONE index.html (cascade notes/documenti/presentazioni)
        await page.addStyleTag({ content: SIM_CSS });
        await sleep(120);
        res.sim = await measure(page);
        await page.screenshot({ path: path.join(QA_DIR, 'r22_schemi_' + tag + '.png') });

        // --- 5.2 math (fonti_panel.js invariato: stesso risultato in PRIMA/DOPO)
        res.math52 = await mathStatus(page);

        res.pageerrors = errs.slice(0, 5);
    } catch (e) {
        res.error = String((e && e.stack) || e).slice(0, 400);
    }
    await page.close();
    return res;
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const prima = await run(browser, true);
    const dopo = await run(browser, false);

    const chk = {};
    const s = dopo.sim || {};
    chk.single_mount = s.roots === 1;
    chk.in_side = s.inSide === true;
    chk.not_floating_sim = s.position !== 'fixed' && s.position !== 'absolute';
    chk.not_floating_harness = (dopo.harness || {}).position !== 'fixed' && (dopo.harness || {}).position !== 'absolute';
    chk.panel_x_ge_side_x = s.panel_x_ge_side_x === true;
    chk.zero_overlap_canvas = s.overlap_canvas_px2 === 0 && (dopo.harness || {}).overlap_canvas_px2 === 0;
    chk.insert_label = s.insert_label === 'Inserisci nello schema';
    chk.no_pageerrors = !!(dopo.pageerrors && dopo.pageerrors.length === 0 && !(dopo.error));
    // evidenza residuo PRIMA: con SIM_CSS il pre-R22 era fixed e sovrapponeva
    chk.evidence_prima_floating = (prima.sim || {}).position === 'fixed';

    const m = dopo.math52 || {};
    const math52 = {
        dollar_rendered: m.dollar_rendered === true,
        paren_rendered: m.paren_rendered === true,
        no_raw_tokens: m.no_raw_tokens === true,
        katex: m.katex, fallback: m.fallback, raw_sample: m.raw_sample || null,
        status: (m.dollar_rendered && m.paren_rendered && m.no_raw_tokens) ? 'PASS' : 'FAIL (in attesa fix math in fonti_panel.js - altro delegato)'
    };

    const allOk = Object.keys(chk).every(k => chk[k]);
    const out = {
        method: 'qaR22_schemi: montatura reale su qa_ui/schemi.html; PRIMA = interception r22_schemi_baseline.js; SIM_CSS = cascade index.html (notes/documenti/presentazioni) copiata identica',
        viewport: { w: 1440, h: 950 },
        prima: prima, dopo: dopo, checks: chk, math52: math52,
        verdict_layout: allOk ? 'OK' : 'KO'
    };
    fs.writeFileSync(path.join(QA_DIR, 'r22_schemi_measures.json'), JSON.stringify(out, null, 2));

    console.log('\n--- PRIMA (baseline pre-R22) ---');
    console.log('  harness position=' + (prima.harness || {}).position +
        ' panel=' + JSON.stringify((prima.harness || {}).panel));
    console.log('  sim     position=' + (prima.sim || {}).position +
        ' overlap_canvas=' + (prima.sim || {}).overlap_canvas_px2 + 'px2');
    console.log('--- DOPO (schemi.js corrente) ---');
    console.log('  harness position=' + (dopo.harness || {}).position +
        ' panel=' + JSON.stringify((dopo.harness || {}).panel) + ' side=' + JSON.stringify((dopo.harness || {}).side));
    console.log('  sim     position=' + s.position + ' panel=' + JSON.stringify(s.panel) +
        ' overlap_canvas=' + s.overlap_canvas_px2 + 'px2 insert=' + JSON.stringify(s.insert_label));
    Object.keys(chk).forEach(k => console.log((chk[k] ? '  PASS  ' : '  FAIL  ') + k));
    console.log('  MATH 5.2 dollar=' + math52.dollar_rendered + ' paren=' + math52.paren_rendered +
        ' no_raw=' + math52.no_raw_tokens + ' -> ' + math52.status);
    console.log('verdetto layout: ' + out.verdict_layout + '  (misure: qa/r22_schemi_measures.json)');
    await browser.close();
    process.exit(allOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
