/* qa_browser/ai_ui_b12.js — QA-T2 UI AI (H10/H11): screenshot + misure REALI.
   Ponte pywebview stubbato in qa_ui/ai.html (dichiarato): geometrie, DOM e
   interazioni reali del browser. Esecuzione: node qa_browser/ai_ui_b12.js  */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const VW = 1366, VH = 900;
const MEAS = {};
const ATT = 10; /* max 10 tentativi per unita' */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function attachLogs(page) {
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push('console.error: ' + m.text()); });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    return logs;
}
async function waitHarness(page, logs) {
    try {
        await page.waitForFunction('window.__QA && window.__QA.ready === true', { timeout: 15000 });
        await page.waitForFunction('window.__QA.harnessReady === true', { timeout: 15000 });
        return true;
    } catch (e) {
        console.error('BLOCKED - harness non pronto: ' + (logs || []).slice(-5).join(' | '));
        return false;
    }
}
async function shot(page, name) {
    if (!fs.existsSync(path.join(ROOT, 'qa'))) fs.mkdirSync(path.join(ROOT, 'qa'));
    await page.screenshot({ path: path.join(ROOT, 'qa', name + '.png') });
    await page.evaluate(() => { if (window.__QA) { window.__QA.needShot = null; } window.__SHOT_OK = true; });
    console.log('SHOT -> qa/' + name + '.png');
}
async function pushCheck(page, block, id, expected, ok, evidence) {
    ok = !!ok;
    await page.evaluate((id, e, ok, ev) => window.__qaCheck(id, e, ok, ev), id, expected, ok, evidence);
    console.log((ok ? '[VISTO] ' : '[NO]    ') + id + ' (blocco ' + block + ')');
    console.log('        atteso: ' + expected);
    console.log('        visto : ' + evidence);
    return ok;
}
async function until10(page, fn, step, arg) {
    for (let i = 0; i < ATT; i++) {
        if (await page.evaluate(fn, arg)) return true;
        await sleep(step || 150);
    }
    return await page.evaluate(fn, arg);
}
/* click reale (mouse) su un selettore con testo specifico */
async function clickByText(page, scopeSel, text) {
    const rect = await page.evaluate((s, t) => {
        const root = s ? document.querySelector(s) : document;
        if (!root) return null;
        const cand = [].slice.call(root.querySelectorAll('button, .tool-btn'));
        const b = cand.filter(x => (x.textContent || '').indexOf(t) >= 0)
            .filter(x => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[0];
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, scopeSel, text);
    if (!rect) return false;
    await page.mouse.click(rect.x, rect.y);
    return true;
}
async function rectOf(page, sel) {
    return page.evaluate(s => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }, sel);
}

(async function run() {
    /* BUILD marker */
    const idx = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8');
    const m = idx.match(/QA_TS = "([^"]+)"/);
    console.log('BUILD marker: ' + (m ? m[1] : 'ASSENTE'));
    if (!m || m[1] !== '2026-10-23T03:00:00+02:00') {
        console.error('BLOCKED - BUILD marker atteso 2026-10-23T03:00:00+02:00, trovato ' + (m && m[1]));
        process.exit(2);
    }
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    const logs = attachLogs(page);
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'ai.html')).href,
        { waitUntil: 'load', timeout: 20000 });
    if (!(await waitHarness(page, logs))) { process.exit(2); }
    await sleep(300);

    /* ---------- A1: notes F01 preview + Scarta senza scrittura ---------- */
    const objCount = async () => page.evaluate(() => {
        const it = window.__QA.store.items.filter(x => x.id === 'nt1')[0];
        try {
            const d = JSON.parse(it.content);
            return (d.pages || []).reduce((a, p) => a.concat(p.objects || []), []).length;
        } catch (e) { return -1; }
    });
    const nBefore = await objCount();
    const focused = await page.evaluate(() => window.__qaFocusSel());
    const clicked = await clickByText(page, '.fn-pill-left', 'AI');
    const ovShown = await until10(page, () => {
        const o = document.querySelector('.ai-preview-ov');
        return !!(o && o.getBoundingClientRect().width > 0);
    }, 200);
    await sleep(250);
    const rA = await rectOf(page, '.ai-preview-ov');
    const badgeA = await page.evaluate(() => {
        const o = document.querySelector('.ai-preview-ov');
        if (!o) return null;
        const b = o.querySelector('.ai-badge');
        return b ? b.textContent.trim() : null;
    });
    const ovText = await page.evaluate(() => {
        const o = document.querySelector('.ai-preview-ov');
        return o ? (o.textContent || '').trim().slice(0, 500) : '';
    });
    const inVp = !!(rA && rA.l >= -1 && rA.t >= -1 && rA.l + rA.w <= VW + 1 && rA.t + rA.h <= VH + 1 && rA.w > 0);
    const okA1 = ovShown && inVp && badgeA === 'generato da AI' && /DOMANDA QA|flashcard/i.test(ovText);
    await shot(page, 'ai_f01_preview');
    await pushCheck(page, 'A', 'A1', 'click AI (selezione textarea) -> overlay .ai-preview-ov nel viewport con badge "generato da AI" e contenuto F01', okA1,
        'rect=' + JSON.stringify(rA) + ' badge=' + badgeA + ' textLen=' + ovText.length + ' focused=' + focused + ' clicked=' + clicked);
    const scrolled = await clickByText(page, '.ai-preview-ov', 'Scarta');
    const ovGone = await until10(page, () => !document.querySelector('.ai-preview-ov'), 150);
    await sleep(300);
    const nAfter = await objCount();
    MEAS.A1 = { rect: rA, badge: badgeA, objBefore: nBefore, objAfter: nAfter, focused: focused };
    await pushCheck(page, 'A', 'A2', 'Scarta chiude l overlay e NON scrive oggetti nella nota (count invariato)',
        ovGone && nBefore === nAfter && nAfter > 0,
        'ovGone=' + ovGone + ' obj ' + nBefore + '->' + nAfter + ' scrolled=' + scrolled);

    /* ---------- A3: fallback AI non disponibile ---------- */
    await page.evaluate(() => {
        window.__origAIFn = window.pywebview.api.ai_run_function;
        delete window.pywebview.api.ai_run_function;
    });
    await page.evaluate(() => window.__qaFocusSel());
    await clickByText(page, '.fn-pill-left', 'AI');
    const toastShown = await until10(page, () => {
        const t = document.querySelector('.ai-toast');
        return !!(t && /non disponibile/i.test(t.textContent || ''));
    }, 200);
    await sleep(150);
    const ovBlocked = await page.evaluate(() => !!document.querySelector('.ai-preview-ov'));
    await shot(page, 'ai_fallback');
    MEAS.A3 = { toast: toastShown, overlayLeft: ovBlocked };
    await pushCheck(page, 'A', 'A3', 'senza pywebview -> toast "AI non disponibile", nessun overlay bloccato, zero pageerror',
        toastShown && !ovBlocked && logs.length === 0,
        'toast=' + toastShown + ' overlayLeft=' + ovBlocked + ' errors=' + JSON.stringify(logs.slice(0, 3)));
    /* ripristino lo stub per la fase B */
    await page.evaluate(() => {
        if (window.__origAIFn) window.pywebview.api.ai_run_function = window.__origAIFn;
    });

    /* ---------- B1: fogli F07 showResult ---------- */
    const openedF = await page.evaluate(() => window.__qaOpenFoglio());
    await page.evaluate(() => window.__qaSelectCell('D1'));
    await sleep(200);
    await clickByText(page, null, 'Spiega formula');
    const resShown = await until10(page, () => {
        const o = document.querySelector('.ai-preview-ov');
        return !!(o && o.getBoundingClientRect().width > 0 && /punto uno/i.test(o.textContent || ''));
    }, 200);
    await sleep(200);
    const rB = await rectOf(page, '.ai-preview-ov');
    const badgeB = await page.evaluate(() => {
        const o = document.querySelector('.ai-preview-ov'); const b = o && o.querySelector('.ai-badge');
        return b ? b.textContent.trim() : null;
    });
    const inVpB = !!(rB && rB.l >= -1 && rB.t >= -1 && rB.l + rB.w <= VW + 1 && rB.t + rB.h <= VH + 1 && rB.w > 0);
    await shot(page, 'ai_f07_result');
    MEAS.B1 = { rect: rB, badge: badgeB, opened: openedF };
    await pushCheck(page, 'B', 'B1', 'cella D1 selezionata -> "Spiega formula" -> overlay con bullet "punto uno" + badge, rect nel viewport',
        resShown && inVpB && badgeB === 'generato da AI',
        'rect=' + JSON.stringify(rB) + ' badge=' + badgeB);
    await clickByText(page, '.ai-preview-ov', 'Chiudi');
    await until10(page, () => !document.querySelector('.ai-preview-ov'), 150);

    /* ---------- B2: fogli F08 preview -> Accetta -> cella scritta ---------- */
    await page.evaluate(() => window.__qaSelectCell('D1'));
    await sleep(150);
    await clickByText(page, null, 'Descrivi');
    const formShown = await until10(page, () => {
        const inputs = [].slice.call(document.querySelectorAll('input, textarea'))
            .filter(x => x.getBoundingClientRect().width > 0);
        return inputs.length > 0;
    }, 200);
    let filled = false, submitted = false;
    if (formShown) {
        filled = await page.evaluate(() => {
            const inputs = [].slice.call(document.querySelectorAll('input, textarea'))
                .filter(x => x.getBoundingClientRect().width > 0);
            const inp = inputs.filter(x => /calcolare|descriz/i.test(
                (x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || '')))[0] || inputs[inputs.length - 1];
            if (!inp) return false;
            inp.focus();
            inp.value = 'somma da A1 ad A3';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            return document.activeElement === inp;
        });
        if (filled) { await page.keyboard.type(' ', { delay: 30 }); await page.keyboard.press('Backspace', { delay: 30 }); }
        submitted = await clickByText(page, null, 'Genera formula');
    }
    const prevShown = await until10(page, () => {
        const o = document.querySelector('.ai-preview-ov');
        return !!(o && o.getBoundingClientRect().width > 0 && /=SUM\(A1:A3\)/.test(o.textContent || ''));
    }, 250);
    await sleep(150);
    const accepted = prevShown ? await clickByText(page, '.ai-preview-ov', 'Accetta') : false;
    let cellVal = null;
    if (accepted) {
        await sleep(1300); /* debounce save 900ms */
        cellVal = await page.evaluate(() => {
            const it = window.__QA.store.items.filter(x => x.id === 'f1')[0];
            try {
                const c = JSON.parse(it.content).sheets[0].cells['D1'] || {};
                /* le formule si salvano in .f (setCellInput: c.f, delete c.v) */
                return c.f != null ? c.f : c.v;
            } catch (e) { return null; }
        });
    }
    const rC = await rectOf(page, '.ai-preview-ov');
    await shot(page, 'ai_f08_accept');
    MEAS.B2 = { formShown: formShown, filled: filled, submitted: submitted, preview: prevShown, accepted: accepted, cellD1: cellVal };
    await pushCheck(page, 'B', 'B2', 'F08: form -> preview "=SUM(A1:A3)" -> Accetta -> cella D1 salvata con la formula',
        prevShown && accepted && cellVal === '=SUM(A1:A3)',
        JSON.stringify(MEAS.B2) + ' rectPrev=' + JSON.stringify(rC));

    /* ---------- C: esclusioni + errori ---------- */
    const srcNotes = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'notes.js'), 'utf8');
    const srcFogli = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fogli.js'), 'utf8');
    const noSummaryBtn = !/textContent\s*=\s*'Riassunt|>Riassumi nota</i.test(srcNotes) && !/genera schema/i.test(srcNotes + srcFogli);
    const errCount = logs.length;
    MEAS.C = { noSummaryBtn: noSummaryBtn, consoleErrors: errCount };
    await pushCheck(page, 'C', 'C1', 'esclusioni: nessun pulsante "riassumi nota"/"genera schema" nei moduli; zero console error/pageerror per tutto il giro',
        noSummaryBtn && errCount === 0,
        'noSummaryBtn=' + noSummaryBtn + ' errors=' + JSON.stringify(logs.slice(0, 3)));

    fs.writeFileSync(path.join(ROOT, 'qa', 'ai_ui_measures.json'),
        JSON.stringify({ build: m[1], viewport: VW + 'x' + VH, checks: MEAS, logs: logs }, null, 1), 'utf8');
    console.log('Misure -> qa/ai_ui_measures.json');
    await browser.close();
})().catch(e => { console.error('RUNNER FATAL: ' + (e && e.stack || e)); process.exit(1); });
