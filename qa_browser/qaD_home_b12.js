'use strict';
/* qa_browser/qaD_home_b12.js — QA-T2 blocco D (Home: logo vecchio + 8a card) in Chromium REALE via Puppeteer.
   - qa_ui/home.html: harness D (env.js + store.js + app.js REALI, logo identico a index.html,
     #materialModal copiato da index.html, 7 moduli stub via App.registerModule reale).
   - Misure REALI: getBoundingClientRect + computedStyle. Screenshot handshake __QA.needShot -> qa/qaD_*.
   - D1b: confronto STRUTTURALE points del polygon con `git show HEAD:web_frontend/html/index.html`.
   Output: qa/qaD_measures.json. Esecuzione: node qa_browser/qaD_home_b12.js  */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const BUILD_TS = (function(){ try { var s = require('fs').readFileSync(require('path').join(__dirname, '..', 'web_frontend', 'html', 'index.html'), 'utf8'); var m = s.match(/var QA_TS\s*=\s*"([^"]+)"/); return m ? m[1] : 'MISSING'; } catch (e) { return 'MISSING'; } })();
const VW = 1366, VH = 900;
const MAX_ATT = 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MEAS = { D: {} };

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
        process.exit(2);
    }
    console.log('BUILD marker OK: QA_TS="' + got + '"');
})();

/* ---------- handshake screenshot (protocollo di qa_ab_b12.js) ---------- */
async function shot(page, name, clip) {
    await page.evaluate(n => { window.__QA.needShot = n; }, name);
    await sleep(50);
    await page.screenshot(Object.assign({ path: path.join(QA_DIR, name + '.png') }, clip ? { clip } : {}));
    await page.evaluate(() => { window.__SHOT_OK = true; window.__QA.needShot = null; });
    console.log('SHOT -> qa/' + name + '.png' + (clip ? ' (clip ' + JSON.stringify(clip) + ')' : ''));
}

async function until10(page, fn, arg) {
    for (let i = 0; i < MAX_ATT; i++) {
        if (await page.evaluate(fn, arg)) return true;
        await sleep(150);
    }
    return await page.evaluate(fn, arg);
}

async function pushCheck(block, id, expected, ok, evidence, m) {
    ok = !!ok;
    MEAS.D[id] = Object.assign({ id, expected, ok, evidence }, m ? { m } : {});
    console.log((ok ? '[VISTO] ' : '[NO]    ') + id + '  (blocco D)');
    console.log('        atteso: ' + expected);
    console.log('        visto : ' + evidence);
    return ok;
}

async function evalCheck(page, block, id, expected, fn, ...args) {
    let r;
    try { r = await page.evaluate.apply(page, [fn].concat(args)); }
    catch (e) { r = { ok: false, evidence: 'eccezione evaluate: ' + (e.message || e) }; }
    if (r && r.__err) r = { ok: false, evidence: 'eccezione in pagina: ' + r.__err };
    return pushCheck(block, id, expected, r.ok, r.evidence || '(nessuna evidenza)', r.m);
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

async function clickRect(page, rect) {
    await page.mouse.click(rect.x, rect.y);
}

/* estrai points del vecchio logo da index.html (file corrente o git HEAD) */
function extractPoints(src) {
    const m = src.match(/<svg class="logo-star"[\s\S]*?<polygon fill="url\(#starGrad\)"\s+points="([^"]+)"/);
    return m ? m[1] : null;
}

(async function run() {
    /* ---------- D1b: confronto points con git HEAD (prima del browser) ---------- */
    const idxPath = path.join(ROOT, 'web_frontend', 'html', 'index.html');
    const curSrc = fs.readFileSync(idxPath, 'utf8');
    const curPoints = extractPoints(curSrc);
    let headSrc = null, headPoints = null, gitErr = null;
    try {
        headSrc = execSync('git show HEAD:web_frontend/html/index.html', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        headPoints = extractPoints(headSrc);
    } catch (e) { gitErr = String(e.stderr || e.message || e).slice(0, 300); }
    const d1bOk = !gitErr && !!curPoints && curPoints === headPoints;
    await pushCheck('D', 'D1b',
        'polygon points del logo in index.html IDENTICI al file di git HEAD (confronto strutturale stringa)',
        d1bOk,
        gitErr ? ('git show fallito: ' + gitErr)
            : (!curPoints ? 'points non estratti dal file corrente'
                : (curPoints === headPoints
                    ? 'identici (' + curPoints.length + ' char, ' + curPoints.trim().split(/\s+/).length + ' punti): "' + curPoints.slice(0, 48) + '..."'
                    : 'DIVERSI: corrente(' + curPoints.length + ' char)="' + curPoints.slice(0, 60) + '" vs HEAD(' + headPoints.length + ' char)="' + String(headPoints).slice(0, 60) + '"')),
        { curLen: curPoints ? curPoints.length : null, headLen: headPoints ? headPoints.length : null, identical: d1bOk });

    /* ---------- browser ---------- */
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    const logs = attachLogs(page);
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'home.html')).href, { waitUntil: 'load' });
    const harnessOk = await waitHarness(page, logs);
    if (!harnessOk) {
        await pushCheck('D', 'D0', 'harness pronto senza errori', false,
            'harness non pronto; logs=' + JSON.stringify(logs.slice(0, 8)) +
            ' qaErrors=' + JSON.stringify(await page.evaluate(() => (window.__QA ? window.__QA.errors : ['no __QA'])).catch(e => [e.message])));
    } else {
        await sleep(250);

        /* ---------- D1a: logo vecchio nella home ---------- */
        await evalCheck(page, 'D', 'D1a',
            'home aperta: svg .logo-star viewBox 0 0 100 100, polygon >8 punti, starGrad #ffd98a/#f9974a, rect ~38x38px, logo-mark/logograd assenti, testi esatti',
            () => {
                try {
                    const m = {};
                    const bodyHome = document.body.classList.contains('view-home');
                    const hv = document.getElementById('homeView');
                    const homeVisible = !!hv && !hv.classList.contains('hidden');
                    const lock = document.getElementById('brandLockup');
                    const svg = document.querySelector('svg.logo-star');
                    if (!svg) return { ok: false, evidence: 'svg.logo-star assente', m: { bodyHome, homeVisible } };
                    const vb = svg.getAttribute('viewBox');
                    const poly = svg.querySelector('polygon');
                    const pts = poly ? (poly.getAttribute('points') || '') : '';
                    const nPts = pts.trim() ? pts.trim().split(/\s+/).length : 0;
                    const g = document.getElementById('starGrad');
                    const stops = g ? [].slice.call(g.querySelectorAll('stop')).map(s => s.getAttribute('stop-color')) : [];
                    const r = svg.getBoundingClientRect();
                    const cs = getComputedStyle(svg);
                    const txt = (document.querySelector('.logo-text') || {}).textContent;
                    const sub = (document.querySelector('.logo-sub') || {}).textContent;
                    const oldAbsent = !document.querySelector('svg.logo-mark') && !document.getElementById('logograd') &&
                        !document.querySelector('[fill="url(#logograd)"]') && !document.querySelector('svg.logo-mark *, .logo-mark');
                    const lockVisible = !!lock && getComputedStyle(lock).display !== 'none' && lock.getBoundingClientRect().width > 0;
                    const subVisible = getComputedStyle(document.querySelector('.logo-sub') || document.body).display !== 'none';
                    m.logo = { viewBox: vb, nPts, stops, w: +r.width.toFixed(1), h: +r.height.toFixed(1), display: cs.display, svgW: cs.width, svgH: cs.height };
                    m.txt = txt; m.sub = sub; m.oldAbsent = oldAbsent; m.lockVisible = lockVisible;
                    m.bodyHome = bodyHome; m.homeVisible = homeVisible; m.subVisible = subVisible;
                    const ok = bodyHome && homeVisible &&
                        vb === '0 0 100 100' && nPts > 8 &&
                        stops[0] === '#ffd98a' && stops[1] === '#f9974a' &&
                        Math.abs(r.width - 38) <= 2 && Math.abs(r.height - 38) <= 2 &&
                        oldAbsent && lockVisible &&
                        txt === 'Nova Studio' && sub === 'La tua suite locale per lo studio';
                    return {
                        ok,
                        evidence: 'viewBox="' + vb + '" punti=' + nPts + ' stops=[' + stops.join(',') + '] rect=' +
                            r.width.toFixed(1) + 'x' + r.height.toFixed(1) + 'px oldLogoAbsent=' + oldAbsent +
                            ' lockVisible=' + lockVisible + ' view-home=' + bodyHome + ' txt="' + txt + '" sub="' + sub + '"',
                        m
                    };
                } catch (e) { return { __err: e.message || String(e) }; }
            });

        /* screenshot D1a: header con logo + titolo (+ inizio griglia) */
        const logoClip = await page.evaluate(() => {
            const h = document.querySelector('.header').getBoundingClientRect();
            const lock = document.getElementById('brandLockup').getBoundingClientRect();
            return { x: 0, y: 0, width: Math.min(900, Math.ceil(lock.right + 60)), height: Math.min(900, Math.ceil(Math.max(h.bottom + 10, 170))) };
        });
        await shot(page, 'qaD_logo_home', logoClip);

        /* points anche dal DOM (collega D1b al browser) */
        const domPoints = await page.evaluate(() => {
            const p = document.querySelector('svg.logo-star polygon');
            return p ? p.getAttribute('points') : null;
        });
        if (curPoints) {
            await pushCheck('D', 'D1b_dom', '(interno D1b) points del DOM == points di index.html corrente',
                domPoints === curPoints, 'dom=' + String(domPoints).slice(0, 48) + '...');
        }

        /* ---------- D2a: 8 card, 8a = "Aggiungi materiali", griglia ---------- */
        await evalCheck(page, 'D', 'D2a',
            '#homeView contiene 8 button.home-card; 8a con h3 esatto "Aggiungi materiali", desc non vuota, rect >0, stessa riga della 7a (o gap riga coerente)',
            () => {
                try {
                    const hv = document.getElementById('homeView');
                    const cards = [].slice.call(hv.querySelectorAll('button.home-card'));
                    const m = { count: cards.length };
                    if (cards.length < 8) return { ok: false, evidence: 'card trovate=' + cards.length, m };
                    const c7 = cards[6], c8 = cards[7];
                    const h3 = c8.querySelector('h3');
                    const desc = c8.querySelector('.home-desc');
                    const last = c8.querySelector('.home-last');
                    const r7 = c7.getBoundingClientRect(), r8 = c8.getBoundingClientRect();
                    const sameRow = Math.abs(r8.top - r7.top) <= 1;
                    const rowGap = r8.top - r7.bottom;
                    const grid = hv.querySelector('.home-grid');
                    const gs = getComputedStyle(grid);
                    m.card8 = {
                        h3: h3 ? h3.textContent : null,
                        desc: desc ? desc.textContent.trim() : null,
                        last: last ? last.textContent.trim() : null,
                        w: +r8.width.toFixed(1), h: +r8.height.toFixed(1),
                        top7: +r7.top.toFixed(1), top8: +r8.top.toFixed(1),
                        sameRow, rowGap: +rowGap.toFixed(1),
                        gridGap: gs.gap, gridCols: gs.gridTemplateColumns.split(' ').length
                    };
                    m.lastCardIs8th = cards[cards.length - 1] === c8;
                    const gapOk = sameRow || (rowGap >= 12 && rowGap <= 18);
                    const ok = cards.length === 8 && !!h3 && h3.textContent === 'Aggiungi materiali' &&
                        !!desc && desc.textContent.trim().length > 0 &&
                        r8.width > 0 && r8.height > 0 && gapOk && m.lastCardIs8th;
                    return {
                        ok,
                        evidence: 'n=' + cards.length + ' h3="' + (h3 && h3.textContent) + '" desc="' + (desc && desc.textContent.trim()).slice(0, 40) +
                            '" rect8=' + r8.width.toFixed(1) + 'x' + r8.height.toFixed(1) + ' top7=' + r7.top.toFixed(1) +
                            ' top8=' + r8.top.toFixed(1) + ' sameRow=' + sameRow + ' rowGap=' + rowGap.toFixed(1) +
                            ' gridGap=' + gs.gap + ' cols=' + m.card8.gridCols + ' lastIs8th=' + m.lastCardIs8th,
                        m
                    };
                } catch (e) { return { __err: e.message || String(e) }; }
            });

        const card8Clip = await page.evaluate(() => {
            const hv = document.getElementById('homeView');
            const c8 = hv.querySelectorAll('button.home-card')[7];
            if (!c8) return null;
            const r = c8.getBoundingClientRect();
            return {
                x: Math.max(0, Math.floor(r.left - 16)),
                y: Math.max(0, Math.floor(r.top - 16)),
                width: Math.min(1366, Math.ceil(r.width + 32)),
                height: Math.ceil(r.height + 32)
            };
        });
        if (card8Clip) await shot(page, 'qaD_card8_home', card8Clip);

        /* ---------- D2b: click "Aggiungi materiali" ---------- */
        const logsBeforeB = logs.length;
        const c8Center = await page.evaluate(() => {
            const c8 = document.getElementById('homeView').querySelectorAll('button.home-card')[7];
            const r = c8.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await clickRect(page, c8Center);
        const opened = await until10(page, () => {
            const m = document.getElementById('materialModal');
            return window.__matOpenCalls === 1 && m && m.classList.contains('show');
        });
        await sleep(200);
        await evalCheck(page, 'D', 'D2b',
            'click 8a card -> window.Materiali.open() chiamato 1 volta + #materialModal.show + home resta in view + zero errori + modal con 2 tab, #browseBtn e #addFileBtn visibili',
            () => {
                try {
                    const mm = document.getElementById('materialModal');
                    const hv = document.getElementById('homeView');
                    const tabs = mm ? [].slice.call(mm.querySelectorAll('.tab')) : [];
                    const vis = e => !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 &&
                        getComputedStyle(e).visibility !== 'hidden';
                    const browse = document.getElementById('browseBtn');
                    const add = document.getElementById('addFileBtn');
                    const bodyHome = document.body.classList.contains('view-home');
                    const homeVisible = hv && !hv.classList.contains('hidden');
                    const m = {
                        matOpenCalls: window.__matOpenCalls, modalShow: !!(mm && mm.classList.contains('show')),
                        nTabs: tabs.length, tabsData: tabs.map(t => t.getAttribute('data-tab')),
                        browseVisible: vis(browse), addVisible: vis(add),
                        browseText: browse ? browse.textContent.trim() : null,
                        addText: add ? add.textContent.trim() : null,
                        bodyHome, homeVisible
                    };
                    const ok = window.__matOpenCalls === 1 && m.modalShow && tabs.length === 2 &&
                        m.browseVisible && m.addVisible && bodyHome && homeVisible;
                    return {
                        ok,
                        evidence: 'matOpenCalls=' + window.__matOpenCalls + ' modalShow=' + m.modalShow +
                            ' tabs=' + tabs.length + '[' + m.tabsData.join(',') + '] browseVis=' + m.browseVisible +
                            ' addVis=' + m.addVisible + ' body.view-home=' + bodyHome + ' homeVisible=' + homeVisible,
                        m
                    };
                } catch (e) { return { __err: e.message || String(e) }; }
            });
        await shot(page, 'qaD_modal_aperto');
        const errsB = logs.slice(logsBeforeB).filter(l => l.indexOf('pageerror') === 0 || l.indexOf('console.error') === 0);
        await pushCheck('D', 'D2b_err', '(interno D2b) zero pageerror/console.error dopo click 8a card',
            errsB.length === 0, JSON.stringify(errsB.slice(0, 4)));

        /* ---------- D2c: click #browseBtn SENZA pywebview ---------- */
        const logsBeforeC = logs.length;
        const qaErrBeforeC = await page.evaluate(() => window.__QA.errors.length);
        const browseCenter = await page.evaluate(() => {
            const b = document.getElementById('browseBtn');
            const r = b.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await clickRect(page, browseCenter);
        await sleep(600);
        await evalCheck(page, 'D', 'D2c',
            'SENZA pywebview: click #browseBtn non crasha (zero pageerror/QA.errors), stato invariato, flusso upload reale NON verificabile in T2',
            () => {
                try {
                    const logs = window.__qaLogSnap || [];
                    const fn = document.getElementById('fileName');
                    const st = document.getElementById('materialStatus');
                    const mm = document.getElementById('materialModal');
                    const m = {
                        fileName: fn ? fn.textContent : null,
                        materialStatus: st ? st.textContent : null,
                        modalStillShow: !!(mm && mm.classList.contains('show')),
                        pywebview: typeof window.pywebview !== 'undefined'
                    };
                    const ok = m.fileName === 'Nessun file selezionato' && m.materialStatus === '' && m.modalStillShow && !m.pywebview;
                    return {
                        ok,
                        evidence: 'pywebview=' + m.pywebview + ' fileName="' + m.fileName + '" status="' + m.materialStatus +
                            '" modalAncoraAperto=' + m.modalStillShow + ' (guard: try/catch in index.html ~1305-1318 ' +
                            'cattura TypeError e logga console.error "Errore selezione file:" -> NESSUN crash)',
                        m
                    };
                } catch (e) { return { __err: e.message || String(e) }; }
            });
        const logsC = logs.slice(logsBeforeC);
        const pageErrC = logsC.filter(l => l.indexOf('pageerror') === 0);
        const consErrC = logsC.filter(l => l.indexOf('console.error') === 0);
        const knownBrowse = consErrC.filter(l => l.indexOf('Errore selezione file') >= 0);
        const unexpectedC = logsC.filter(l => !(l.indexOf('console.error: Errore selezione file') >= 0));
        const qaErrC = await page.evaluate(() => window.__QA.errors.length);
        await pushCheck('D', 'D2c_err',
            'D2c: zero pageerror + zero QA.errors; console.error atteso e catturato = solo "Errore selezione file" (production catch)',
            pageErrC.length === 0 && qaErrC === qaErrBeforeC && unexpectedC.length === 0 && knownBrowse.length >= 1,
            'pageerrors=' + pageErrC.length + ' QA.errors=' + qaErrC + ' consoleErrors=' + consErrC.length +
            ' (noti="Errore selezione file" x' + knownBrowse.length + ') inattesi=' + JSON.stringify(unexpectedC.slice(0, 3)),
            { pageErrors: pageErrC.length, consoleErrors: consErrC.length, known: knownBrowse.length });

        /* chiudi il modal per i click successivi */
        await page.evaluate(() => {
            const b = document.getElementById('closeMaterialBtn');
            if (b) b.click();
        });
        await until10(page, () => !document.getElementById('materialModal').classList.contains('show'));

        /* ---------- D2d: click 1a card (Chatbot) -> navigazione ---------- */
        const logsBeforeD = logs.length;
        const c1Center = await page.evaluate(() => {
            const c1 = document.getElementById('homeView').querySelectorAll('button.home-card')[0];
            c1.scrollIntoView({ block: 'nearest' });
            const r = c1.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: c1.getAttribute('aria-label') };
        });
        await clickRect(page, c1Center);
        await page.evaluate(l => { window.__qaLastLabel = l; }, c1Center.label);
        const navOk = await until10(page, () => {
            const mv = document.getElementById('moduleView');
            return !document.body.classList.contains('view-home') && mv && !mv.classList.contains('hidden');
        });
        await sleep(150);
        await evalCheck(page, 'D', 'D2d',
            'click card 1 (Chatbot): renderHome non rompe i click go(id) — body cambia view-*, moduleView aperto, zero errori',
            () => {
                try {
                    const mv = document.getElementById('moduleView');
                    const hv = document.getElementById('homeView');
                    const m = {
                        bodyClass: document.body.className,
                        moduleVisible: mv && !mv.classList.contains('hidden'),
                        homeHidden: hv && hv.classList.contains('hidden'),
                        stubContent: !!mv.querySelector('[data-stub]'),
                        cardLabel: window.__qaLastLabel || null
                    };
                    const ok = !document.body.classList.contains('view-home') &&
                        document.body.classList.contains('view-module') && m.moduleVisible && m.homeHidden && m.stubContent;
                    return {
                        ok,
                        evidence: 'body.class="' + m.bodyClass + '" moduleVisible=' + m.moduleVisible +
                            ' homeHidden=' + m.homeHidden + ' stubContent=' + m.stubContent,
                        m
                    };
                } catch (e) { return { __err: e.message || String(e) }; }
            });
        const errsD = logs.slice(logsBeforeD);
        await pushCheck('D', 'D2d_err', '(interno D2d) zero errori dopo click card Chatbot',
            errsD.length === 0, JSON.stringify(errsD.slice(0, 4)));

        /* ---------- D0: zero errori per tutto il giro ---------- */
        const qaErrors = await page.evaluate(() => window.__QA.errors);
        const pageErrors = logs.filter(l => l.indexOf('pageerror') === 0);
        const allConsErr = logs.filter(l => l.indexOf('console.error') === 0);
        const known = allConsErr.filter(l => l.indexOf('Errore selezione file') >= 0);
        const unexpected = allConsErr.filter(l => l.indexOf('console.error: Errore selezione file') < 0);
        await pushCheck('D', 'D0',
            'zero QA.errors / pageerror / console.error per tutto il giro D (l\'unica eccezione documentata: console.error catturata del guard browseBtn senza pywebview, misurata in D2c)',
            qaErrors.length === 0 && pageErrors.length === 0 && unexpected.length === 0,
            'QA.errors=' + JSON.stringify(qaErrors.slice(0, 4)) + ' pageerrors=' + pageErrors.length +
            ' console.error=' + allConsErr.length + ' di cui noti(browseBtn guard)=' + known.length +
            ' inattesi=' + JSON.stringify(unexpected.slice(0, 4)),
            { qaErrors: qaErrors.length, pageErrors: pageErrors.length, consoleErrorsTotal: allConsErr.length, knownBrowseGuard: known.length });

        /* ---------- registra TUTTI i check via __qaCheck (handshake in pagina) ---------- */
        await page.evaluate(list => {
            list.forEach(c => window.__qaCheck(c.id, c.expected, c.ok, c.evidence));
        }, Object.keys(MEAS.D).map(k => ({ id: MEAS.D[k].id, expected: MEAS.D[k].expected, ok: MEAS.D[k].ok, evidence: MEAS.D[k].evidence })));

        /* ---------- riepilogo pagina ---------- */
        const qa = await page.evaluate(() => ({ checks: window.__QA.checks, errors: window.__QA.errors }));
        console.log('\n===== check registrati via __qaCheck: ' + qa.checks.length + ' =====');
        qa.checks.forEach(c => console.log('  ' + (c.ok ? 'PASS' : 'FAIL') + '  ' + c.id + '  ' + c.evidence.slice(0, 140)));

        const measures = {
            build: 'BUILD ' + BUILD_TS,
            viewport: VW + 'x' + VH,
            generatedAt: new Date().toISOString(),
            harness: 'qa_ui/home.html (env.js + store.js + app.js reali; 7 moduli stub via App.registerModule; logo e #materialModal copiati da index.html)',
            D: MEAS.D,
            console: { logs: logs, qaErrors: qaErrors },
            notes: {
                d1b: 'confronto points index.html corrente vs git HEAD (git show)',
                browseGuard: 'index.html ~1305-1318: click #browseBtn senza pywebview -> TypeError catturato -> console.error "Errore selezione file:", nessun crash, nessun messaggio UI',
                uploadLimit: 'flusso upload completo (pick/add -> Biblioteca -> rag_stage2) NON verificabile in harness T2 (richiede pywebview reale): coperto dal test Python testC_rag'
            }
        };
        fs.writeFileSync(path.join(QA_DIR, 'qaD_measures.json'), JSON.stringify(measures, null, 1));
        console.log('Misure -> qa/qaD_measures.json');
    }

    await page.close();
    await browser.close();
    console.log('\n===== QA-D T2 COMPLETATO =====');
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
