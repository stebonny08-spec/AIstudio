'use strict';
/* qa_browser/qaF67_r13.js — QA-T2 R13 blocco F67 (F67a citazione documenti +
   F67b salva come nota/chat) in Chromium REALE via Puppeteer.
   - qa_ui/f67.html: env.js + store.js + app.js + documenti.js + chatbot.js
     REALI; window.pywebview.api SOLO stub dichiarati; nessuna geometria
     stubbata (solo misure reali getBoundingClientRect).
   - Protocollo handshake identico a qaD_home_b12.js: __QA.needShot ->
     screenshot qa/r13_f67_*.png; check registrati via __qaCheck.
   - BUILD letto DINAMICAMENTE da QA_TS di web_frontend/html/index.html
     (nessuna costante data).
   Check:
     F1  voce menu documenti presente + click senza errori
     F2  F06 stub -> preview [Accetta]/[Scarta] -> Accetta -> inserimento
         + badge .ai-badge nel DOM
     F3  "Salva come nota" chatbot -> item kind 'note' nello store +
         AIService.undo() lo rimuove
     F0  zero pageerror/console.error per tutto il giro
   Output: qa/r13_f67_measures.json + qa/r13_f67_*.png
   Esecuzione: node qa_browser/qaF67_r13.js */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const VW = 1366, VH = 900;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MEAS = { F67: {} };

/* ---------- BUILD marker: letto dinamicamente da index.html (QA_TS) ---------- */
const BUILD_TS = (function () {
    try {
        const s = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8');
        const m = s.match(/var QA_TS\s*=\s*"([^"]+)"/);
        return m ? m[1] : 'MISSING';
    } catch (e) { return 'MISSING'; }
})();

(function checkBuild() {
    const idxPath = path.join(ROOT, 'web_frontend', 'html', 'index.html');
    const src = fs.readFileSync(idxPath, 'utf8');
    const m = src.match(/var QA_TS\s*=\s*"([^"]+)"/);
    const got = m ? m[1] : '(assente)';
    if (got === '(assente)' || got === 'MISSING') {
        console.error('BLOCKED - QA_TS assente in web_frontend/html/index.html');
        process.exit(2);
    }
    /* coerenza ?v=: tutti i ?v= devono combaciare con QA_TS (build unica) */
    const vs = [], re = /\?v=([^"']+)/g;
    let mm;
    while ((mm = re.exec(src))) vs.push(mm[1]);
    const uniq = Array.from(new Set(vs));
    const badV = uniq.filter(v => v !== got);
    if (badV.length) {
        console.error('BLOCKED - ?v= incoerenti con QA_TS: ' + badV.join(', '));
        process.exit(2);
    }
    if (got !== BUILD_TS) {
        console.error('BLOCKED - BUILD marker mismatch');
        process.exit(2);
    }
    console.log('BUILD marker OK: QA_TS="' + got + '"');
})();

/* ---------- handshake screenshot (protocollo qa_ab_b12/qaD_home_b12) ---------- */
async function shot(page, name, clip) {
    await page.evaluate(n => { window.__QA.needShot = n; }, name);
    await sleep(50);
    await page.screenshot(Object.assign({ path: path.join(QA_DIR, name + '.png') }, clip ? { clip } : {}));
    await page.evaluate(() => { window.__SHOT_OK = true; window.__QA.needShot = null; });
    console.log('SHOT -> qa/' + name + '.png' + (clip ? ' (clip)' : ''));
}

async function pushCheck(id, expected, ok, evidence, m) {
    ok = !!ok;
    MEAS.F67[id] = Object.assign({ id, expected, ok, evidence }, m ? { m } : {});
    console.log((ok ? '[VISTO] ' : '[NO]    ') + id);
    console.log('        atteso: ' + expected);
    console.log('        visto : ' + evidence);
    return ok;
}

async function evalCheck(page, id, expected, fn, ...args) {
    let r;
    try { r = await page.evaluate.apply(page, [fn].concat(args)); }
    catch (e) { r = { ok: false, evidence: 'eccezione evaluate: ' + (e.message || e) }; }
    if (r && r.__err) r = { ok: false, evidence: 'eccezione in pagina: ' + r.__err };
    return pushCheck(id, expected, r.ok, r.evidence || '(nessuna evidenza)', r.m);
}

function attachLogs(page) {
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push('console.error: ' + m.text()); });
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    return logs;
}

async function waitHarness(page, logs) {
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

/* polling in pagina (fino a ~10s per step async) */
async function until(page, fn, ...args) {
    for (let i = 0; i < 100; i++) {
        if (await page.evaluate.apply(page, [fn].concat(args))) return true;
        await sleep(100);
    }
    return await page.evaluate.apply(page, [fn].concat(args));
}

async function clickRect(page, rect) { await page.mouse.click(rect.x, rect.y); }

(async function run() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    const logs = attachLogs(page);
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'f67.html')).href, { waitUntil: 'load' });
    const harnessOk = await waitHarness(page, logs);
    if (!harnessOk) {
        await pushCheck('F0', 'harness pronto senza errori', false,
            'harness non pronto; logs=' + JSON.stringify(logs.slice(0, 8)) +
            ' qaErrors=' + JSON.stringify(await page.evaluate(() => (window.__QA ? window.__QA.errors : ['no __QA'])).catch(e => [e.message])));
        fs.writeFileSync(path.join(QA_DIR, 'r13_f67_measures.json'), JSON.stringify({
            build: 'BUILD ' + BUILD_TS, viewport: VW + 'x' + VH,
            generatedAt: new Date().toISOString(), harness: 'qa_ui/f67.html',
            F67: MEAS.F67, console: { logs: logs, qaErrors: [] },
            notes: { blocked: 'harness non pronto' }
        }, null, 1));
        console.log('Misure -> qa/r13_f67_measures.json (harness non pronto)');
        await page.close(); await browser.close();
        process.exit(1);
    } else {
        await sleep(300);

        /* ========== F1: voce menu documenti + click senza errori ========== */
        const logsF1 = logs.length;
        const qaErrF1 = await page.evaluate(() => window.__QA.errors.length);
        const ctx = await page.evaluate(() => {
            try {
                const ed = document.querySelector('.doc-paper');
                if (!ed) return { ok: false, evidence: 'nessun .doc-paper', m: {} };
                const r = ed.getBoundingClientRect();
                const x = r.left + 60, y = r.top + 80;
                ed.dispatchEvent(new MouseEvent('contextmenu',
                    { bubbles: true, cancelable: true, clientX: x, clientY: y }));
                return { ok: true, evidence: 'contextmenu dispatch a ' + Math.round(x) + ',' + Math.round(y) +
                    ' su .doc-paper ' + Math.round(r.width) + 'x' + Math.round(r.height),
                    m: { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) } };
            } catch (e) { return { __err: e.message }; }
        });
        await sleep(150);
        const menuInfo = await page.evaluate(() => {
            try {
                const m = document.querySelector('.doc-citemenu');
                if (!m) return { ok: false, evidence: 'menu .doc-citemenu assente', m: {} };
                const v = m.querySelector('[data-ai-f67="doc-cite"]');
                const r = m.getBoundingClientRect();
                return {
                    ok: !!v && m.classList.contains('open') && r.width > 0 && r.height > 0 &&
                        /Inserisci citazione da materiali/.test(v.textContent || ''),
                    evidence: 'open=' + m.classList.contains('open') +
                        ' voce="' + (v ? v.textContent : 'ASSENTE') + '" rect=' +
                        Math.round(r.width) + 'x' + Math.round(r.height),
                    m: { open: m.classList.contains('open'), w: Math.round(r.width), h: Math.round(r.height) }
                };
            } catch (e) { return { __err: e.message }; }
        });
        const menuRect = await page.evaluate(() => {
            const m = document.querySelector('.doc-citemenu');
            if (!m) return null;
            const r = m.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.left - 8)), y: Math.max(0, Math.floor(r.top - 8)),
                width: Math.ceil(r.width + 16), height: Math.ceil(r.height + 16) };
        });
        if (menuRect) await shot(page, 'r13_f67_menu', menuRect);

        /* click sulla voce (mouse reale, coordinate reali) */
        const voiceRect = await page.evaluate(() => {
            const v = document.querySelector('.doc-citemenu [data-ai-f67="doc-cite"]');
            if (!v) return null;
            const r = v.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (voiceRect) await clickRect(page, voiceRect);
        const formOk = await until(page, () => {
            const b = document.querySelector('.ai-preview-ov .ai-preview');
            return !!b && /Inserisci citazione da materiali/.test((b.querySelector('h3') || {}).textContent || '');
        });
        const errsF1 = logs.slice(logsF1).filter(l => l.indexOf('pageerror') === 0 || l.indexOf('console.error') === 0);
        const qaErrF1b = await page.evaluate(() => window.__QA.errors.length);
        await pushCheck('F1',
            '(1) voce menu documenti presente + click senza errori (menu contestuale .doc-citemenu -> form F06)',
            ctx.ok && menuInfo.ok && formOk && errsF1.length === 0 && qaErrF1b === qaErrF1,
            'ctx=' + ctx.evidence + ' | menu=' + menuInfo.evidence + ' | formAperto=' + formOk +
            ' | errori=' + errsF1.length + ' qaErrors=' + qaErrF1b,
            Object.assign({ formOk }, ctx.m || {}, menuInfo.m || {}));
        await pushCheck('F1_err', '(interno F1) zero pageerror/console.error dopo click voce menu',
            errsF1.length === 0 && qaErrF1b === qaErrF1, JSON.stringify(errsF1.slice(0, 4)));

        /* ========== F2: F06 -> preview -> Accetta -> inserimento + badge ========== */
        const logsF2 = logs.length;
        /* compila il form (materiale select pre-popolato, query testo) */
        await page.evaluate(() => {
            const b = document.querySelector('.ai-preview-ov .ai-preview');
            const inp = b.querySelector('input');
            inp.value = 'Dove avviene la fotosintesi?';
        });
        const formAccept = await page.evaluate(() => {
            const b = document.querySelector('.ai-preview-ov .ai-preview');
            const r = b.querySelector('.ai-pv-accept').getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await clickRect(page, formAccept);
        const previewOk = await until(page, () => {
            const b = document.querySelector('.ai-preview-ov .ai-preview');
            return !!b && /Anteprima AI/.test((b.querySelector('h3') || {}).textContent || '');
        });
        const pvInfo = await page.evaluate(() => {
            try {
                const b = document.querySelector('.ai-preview-ov .ai-preview');
                if (!b) return { ok: false, evidence: 'overlay assente', m: {} };
                const acc = b.querySelector('.ai-pv-accept');
                const rej = b.querySelector('.ai-pv-reject');
                const pre = b.querySelector('pre');
                const txt = pre ? pre.textContent : '';
                return {
                    ok: !!acc && !!rej && /Accetta/.test(acc.textContent) && /Scarta/.test(rej.textContent) &&
                        /citations/.test(txt),
                    evidence: 'accetto="' + (acc ? acc.textContent : '-') + '" scarto="' +
                        (rej ? rej.textContent : '-') + '" pre=' + txt.slice(0, 70).replace(/\s+/g, ' '),
                    m: { preLen: txt.length }
                };
            } catch (e) { return { __err: e.message }; }
        });
        const pvRect = await page.evaluate(() => {
            const b = document.querySelector('.ai-preview-ov .ai-preview');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.left - 8)), y: Math.max(0, Math.floor(r.top - 8)),
                width: Math.min(window.innerWidth, Math.ceil(r.width + 16)),
                height: Math.min(window.innerHeight, Math.ceil(r.height + 16)) };
        });
        if (pvRect) await shot(page, 'r13_f67_preview', pvRect);

        /* click Accetta */
        const accRect = await page.evaluate(() => {
            const b = document.querySelector('.ai-preview-ov .ai-preview .ai-pv-accept');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (accRect) await clickRect(page, accRect);
        const insertedOk = await until(page, () => {
            const ed = document.querySelector('.doc-paper');
            const c = ed ? ed.querySelector('[data-ai-cite]') : null;
            return !!(c && c.querySelector('.ai-badge'));
        });
        const citeInfo = await page.evaluate(() => {
            try {
                const ed = document.querySelector('.doc-paper');
                const c = ed ? ed.querySelector('[data-ai-cite]') : null;
                if (!c) return { ok: false, evidence: 'citazione assente', m: {} };
                const b = c.querySelector('.ai-badge');
                const calls = window.__qaF67.calls;
                const r = c.getBoundingClientRect();
                return {
                    ok: !!b && /generato da AI/.test(b.textContent || '') && calls.f06 >= 1 && r.width > 0,
                    evidence: 'cite="' + (c.textContent || '').slice(0, 60).replace(/\s+/g, ' ') +
                        '" badge="' + (b ? b.textContent : 'ASSENTE') + '" f06=' + calls.f06 +
                        ' rect=' + Math.round(r.width) + 'x' + Math.round(r.height),
                    m: { f06: calls.f06, w: Math.round(r.width), h: Math.round(r.height) }
                };
            } catch (e) { return { __err: e.message }; }
        });
        const citeRect = await page.evaluate(() => {
            const c = document.querySelector('.doc-paper [data-ai-cite]');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.left - 12)), y: Math.max(0, Math.floor(r.top - 12)),
                width: Math.min(window.innerWidth, Math.ceil(r.width + 24)),
                height: Math.ceil(r.height + 24) };
        });
        if (citeRect) await shot(page, 'r13_f67_citazione', citeRect);
        else await shot(page, 'r13_f67_citazione');
        const errsF2 = logs.slice(logsF2).filter(l => l.indexOf('pageerror') === 0 || l.indexOf('console.error') === 0);
        await pushCheck('F2',
            '(2) F06 stub -> preview [Accetta]/[Scarta] -> Accetta -> inserimento citazione + badge .ai-badge nel DOM',
            previewOk && pvInfo.ok && insertedOk && citeInfo.ok && errsF2.length === 0,
            'preview=' + previewOk + ' | ' + pvInfo.evidence + ' | inserito=' + insertedOk +
            ' | ' + citeInfo.evidence + ' | errori=' + errsF2.length,
            Object.assign({ previewOk, insertedOk }, pvInfo.m || {}, citeInfo.m || {}));
        await pushCheck('F2_err', '(interno F2) zero pageerror/console.error nel flusso F06',
            errsF2.length === 0, JSON.stringify(errsF2.slice(0, 4)));

        /* ========== F3: "Salva come nota" -> store + undo lo rimuove ========== */
        const logsF3 = logs.length;
        const qaErrF3 = await page.evaluate(() => window.__QA.errors.length);
        /* switch fase B: nascondi modulo, mostra chatView (view management reale) */
        await page.evaluate(() => {
            const mv = document.getElementById('moduleView');
            if (mv) mv.classList.add('hidden');
            const cv = document.getElementById('chatView');
            if (cv) cv.classList.remove('hidden');
            document.body.classList.remove('view-chat');
            document.body.classList.add('view-module');
        });
        await sleep(250);
        const btnRect = await page.evaluate(() => {
            const b = document.querySelector('[data-ai-f67="nota"]');
            if (!b) return null;
            b.scrollIntoView({ block: 'center' });
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        const btnPresent = !!btnRect;
        if (btnRect) await clickRect(page, btnRect);
        const pv17Ok = await until(page, () => {
            const b = document.querySelector('.ai-preview-ov .ai-preview');
            return !!b && /Anteprima AI/.test((b.querySelector('h3') || {}).textContent || '');
        });
        const acc17Rect = await page.evaluate(() => {
            const b = document.querySelector('.ai-preview-ov .ai-preview .ai-pv-accept');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (acc17Rect) await clickRect(page, acc17Rect);
        const savedOk = await until(page, () => {
            return window.pywebview.api.study_list('note').then(l => l.length === 1);
        });
        const noteInfo = await page.evaluate(() => {
            return window.pywebview.api.study_list('note').then(list => {
                try {
                    const n = list[0];
                    if (!n) return { ok: false, evidence: 'nessuna nota', m: {} };
                    const doc = JSON.parse(n.content);
                    const obj = doc.pages && doc.pages[0] && doc.pages[0].objects &&
                        doc.pages[0].objects[0];
                    const f17 = window.__qaF67.calls.f17;
                    return {
                        ok: n.kind === 'note' && !!obj && obj.t === 'text' &&
                            /fotosintesi avviene nei cloroplasti/.test(obj.text || '') && f17 === 1,
                        evidence: 'kind=' + n.kind + ' title="' + String(n.title).slice(0, 40) +
                            '" obj.t=' + (obj ? obj.t : '-') + ' f17=' + f17,
                        m: { f17, kind: n.kind }
                    };
                } catch (e) { return { __err: e.message }; }
            });
        });
        const chatRect = await page.evaluate(() => {
            const cv = document.getElementById('chatView');
            const r = cv.getBoundingClientRect();
            return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)),
                width: Math.min(window.innerWidth, Math.ceil(r.width)),
                height: Math.min(window.innerHeight, Math.ceil(r.height)) };
        });
        if (chatRect && chatRect.width > 0 && chatRect.height > 0) await shot(page, 'r13_f67_nota', chatRect);
        else await shot(page, 'r13_f67_nota');

        /* undo: AIService.undo() -> la nota sparisce */
        await page.evaluate(() => { window.AIService.undo(); });
        const undoneOk = await until(page, () => {
            return window.pywebview.api.study_list('note').then(l => l.length === 0);
        });
        const afterInfo = await page.evaluate(() => {
            return Promise.all([
                window.pywebview.api.study_list('note'),
                window.pywebview.api.study_list('documento'),
                window.pywebview.api.study_list('mazzo')
            ]).then(r => ({
                notes: r[0].length, docs: r[1].length, mazzi: r[2].length,
                badgeF17: document.querySelectorAll('[data-ai-f67-badge]').length
            }));
        });
        const errsF3 = logs.slice(logsF3).filter(l => l.indexOf('pageerror') === 0 || l.indexOf('console.error') === 0);
        const qaErrF3b = await page.evaluate(() => window.__QA.errors.length);
        await pushCheck('F3',
            '(3) "Salva come nota" chatbot -> item kind "note" creato nello store + AIService.undo() lo rimuove (badge F17 presente)',
            btnPresent && pv17Ok && savedOk && noteInfo.ok && undoneOk &&
                afterInfo.notes === 0 && afterInfo.badgeF17 >= 1 &&
                errsF3.length === 0 && qaErrF3b === qaErrF3,
            'btn=' + btnPresent + ' preview17=' + pv17Ok + ' salvato=' + savedOk + ' | ' +
            noteInfo.evidence + ' | undo=' + undoneOk + ' dopo(note=' + afterInfo.notes +
            ', badgeF17=' + afterInfo.badgeF17 + ', docs=' + afterInfo.docs +
            ', mazzi=' + afterInfo.mazzi + ') | errori=' + errsF3.length,
            Object.assign({ btnPresent, pv17Ok, savedOk, undoneOk }, noteInfo.m || {}, afterInfo));
        await pushCheck('F3_err', '(interno F3) zero pageerror/console.error nel flusso F17',
            errsF3.length === 0 && qaErrF3b === qaErrF3,
            JSON.stringify(errsF3.slice(0, 4)));

        /* ========== F0: zero errori per tutto il giro ========== */
        const qaErrors = await page.evaluate(() => window.__QA.errors);
        const pageErrors = logs.filter(l => l.indexOf('pageerror') === 0);
        const consErrors = logs.filter(l => l.indexOf('console.error') === 0);
        await pushCheck('F0',
            '(4) zero pageerror/console.error/QA.errors per tutto il giro F67',
            qaErrors.length === 0 && pageErrors.length === 0 && consErrors.length === 0,
            'QA.errors=' + JSON.stringify(qaErrors.slice(0, 4)) + ' pageerrors=' + pageErrors.length +
            ' console.error=' + consErrors.length + ' ' + JSON.stringify(consErrors.slice(0, 3)),
            { qaErrors: qaErrors.length, pageErrors: pageErrors.length, consoleErrors: consErrors.length });

        /* ---------- registra tutti i check via __qaCheck (handshake in pagina) ---------- */
        await page.evaluate(list => {
            list.forEach(c => window.__qaCheck(c.id, c.expected, c.ok, c.evidence));
        }, Object.keys(MEAS.F67).map(k => ({
            id: MEAS.F67[k].id, expected: MEAS.F67[k].expected,
            ok: MEAS.F67[k].ok, evidence: MEAS.F67[k].evidence
        })));

        const qa = await page.evaluate(() => ({ checks: window.__QA.checks, errors: window.__QA.errors }));
        console.log('\n===== check registrati via __qaCheck: ' + qa.checks.length + ' =====');
        qa.checks.forEach(c => console.log('  ' + (c.ok ? 'PASS' : 'FAIL') + '  ' + c.id + '  ' + String(c.evidence).slice(0, 140)));

        const measures = {
            build: 'BUILD ' + BUILD_TS,
            viewport: VW + 'x' + VH,
            generatedAt: new Date().toISOString(),
            harness: 'qa_ui/f67.html (env.js + store.js + app.js + documenti.js + chatbot.js REALI; pywebview.api stub SOLO dichiarati; stili chat copiati da index.html)',
            F67: MEAS.F67,
            console: { logs: logs, qaErrors: qaErrors },
            notes: {
                f67a: 'menu contestuale .doc-paper -> .doc-citemenu (classi doc-dd/doc-mi esistenti) -> F06 {docs,chunks,q} via AIService.runFor',
                f67b: 'barra #aiChatBar esistente -> 3 button data-ai-f67 -> F17 {payload,meta} -> saveItem kind ' +
                    "'note' (notes.js) + undo delete + badge data-ai-f67-badge",
                undo: 'uguaglianze stringa/DOM dimostrate in jsdom: tests/qaR13_f67.test.js (28/28)',
                contatti: 'quote F06 verbatim dai chunks (validator cite _in_text); mazzo F17 convertito front/back -> q/a (forma ripasso.js)'
            }
        };
        fs.writeFileSync(path.join(QA_DIR, 'r13_f67_measures.json'), JSON.stringify(measures, null, 1));
        console.log('Misure -> qa/r13_f67_measures.json');

        const allOk = Object.keys(MEAS.F67).every(k => MEAS.F67[k].ok);
        if (!allOk) {
            console.error('QA-F67: ALMENO UN CHECK FALLITO');
            await page.close(); await browser.close();
            process.exit(1);
        }
    }

    await page.close();
    await browser.close();
    console.log('\n===== QA-F67 T2 COMPLETATO =====');
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
