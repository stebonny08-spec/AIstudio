'use strict';
/* qa_browser/qa_schemi_b12.js — QA-T2 (browser reale Chromium/Puppeteer)
   Scenario: doc a 9 nodi / 6 archi (albero parziale + coppia disconnessa a 3 + isolato),
   ciclo albero→mappa→lr→libero→riassunto→albero x3 (15 cambi) via .sc-type-sel.
   A ogni passo: misure REALI (getBoundingClientRect), badge zoom, matrice pulsanti.
   Screenshot: qa/schemi_b12_<tipo>_giro<n>.png  (via handshake __qaShot + page.screenshot)
   Output: qa/schemi_b12_measures.json + qa/schemi_b12_report.json
   Esecuzione: node qa_browser/qa_schemi_b12.js */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const BUILD_TS = (function(){ try { var s = require('fs').readFileSync(require('path').join(__dirname, '..', 'web_frontend', 'html', 'index.html'), 'utf8'); var m = s.match(/var QA_TS\s*=\s*"([^"]+)"/); return m ? m[1] : 'MISSING'; } catch (e) { return 'MISSING'; } })();
const VW = 1366, VH = 900;
const MAX_ATTEMPTS = 6;               // max 6 tentativi per unità (step)
const CYCLE = ['mappa', 'lr', 'libero', 'riassunto', 'albero'];   // 5 cambi per giro
const EXPECT_NODES = 9, EXPECT_EDGES = 6;

/* Matrice pulsanti attesa per tipo (doc non vuoto) — da strategy.ui().pulsanti */
const MATRIX = {
    albero: ['+ Nodo', '+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    lr: ['+ Nodo', '+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    mappa: ['+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    libero: ['+ Nodo', '+ Figlio', '+ Fratello', 'Cancella', 'Collega', 'Auto-layout'],
    riassunto: ['+ Figlio', 'Cancella', 'Collega', 'Auto-layout']
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ipotesi causa (funzione + riga) per i check che falliscono — modulo reale, non modificato */
const HYP = {
    '3a': 'render() schemi.js:887 (gNodes.innerHTML) o parseDoc/normalizeDoc schemi.js:138/175 (perdita nodi al migrate)',
    '3b': 'migrateSchema schemaStrategies.js:844 / changeType schemi.js:1279 (rimozione arco) oppure edgeHtml schemi.js:655',
    '3c': 'centerView schemi.js:923 (fit clamp zoom [0.25,2.0] con pad 40) o animateLayout schemi.js:1110 (centerView al termine)',
    '3d': 'render() schemi.js:887 (guardie isFinite su view/transform) o nodeHtml schemi.js:746 (attr non finiti)',
    '3e': 'centerView schemi.js:923-950 (clamp 0.25..2.0) / badge Math.round(zoom*100) render schemi.js:910',
    '3f': 'buildStrategyButtons schemi.js:1169 o strategy.ui() schemaStrategies.js:572/637/697/750/820',
    '5i': 'buildStrategyButtons schemi.js:1169 (bootstrap 0 nodi → "+ Nodo") o cmdAddNode schemi.js:1009',
    '5ii': 'changeType/migrateSchema (testo nodo non toccato da spec) → nodeHtml schemi.js:746',
    '5iii': 'errore runtime nei moduli reali (pageerror/console.error)'
};

/* ---------- BUILD marker: se non combacia → BLOCKED ---------- */
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
    console.log('BUILD marker OK: QA_TS="' + got + '" (web_frontend/html/index.html)');
})();

/* ---------- misura REALI dentro la pagina (niente stub) ---------- */
async function measure(page) {
    return await page.evaluate(async () => {
        const out = { t: Date.now() };
        const sel = document.querySelector('.sc-type-sel');
        out.tipoSel = sel ? sel.value : null;

        const nodes = [].slice.call(document.querySelectorAll('g.sc-node[data-nid]'));
        const edges = [].slice.call(document.querySelectorAll('.sc-edges .sc-edge'));
        out.nodiRender = nodes.length;
        out.archiRender = edges.length;
        out.domEids = edges.map(e => e.getAttribute('data-eid'));
        out.nids = nodes.map(n => n.getAttribute('data-nid'));
        out.nodeTranslate = nodes.filter(g => g.hasAttribute('transform')).length;

        /* doc di riferimento dallo store reale ( StudyStore, letto da window ) */
        out.doc = null;
        try {
            const item = await window.StudyStore.getItem('b12');
            const d = JSON.parse(item.content);
            out.doc = {
                type: d.type,
                n: (d.nodes || []).length,
                e: (d.edges || []).length,
                eids: (d.edges || []).map(x => x.id),
                texts: (d.nodes || []).map(x => ({ id: x.id, t: String(x.text == null ? '' : x.text) })),
                coordsOk: (d.nodes || []).every(x =>
                    isFinite(Number(x.x)) && isFinite(Number(x.y)) &&
                    isFinite(Number(x.w)) && isFinite(Number(x.h)) &&
                    Number(x.w) > 0 && Number(x.h) > 0)
            };
        } catch (e) { out.docErr = String(e); }

        /* 3c/3d: rect REALI di ogni nodo nel viewport della finestra */
        const vw = window.innerWidth, vh = window.innerHeight;
        out.vw = vw; out.vh = vh;
        let fuori = 0, minM = Infinity, nonFinite = 0;
        const rects = [];
        nodes.forEach(g => {
            const r = g.getBoundingClientRect();
            const finite = [r.left, r.top, r.right, r.bottom, r.width, r.height].every(isFinite);
            if (!finite) nonFinite++;
            const out_ = !finite || r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1 ||
                r.width <= 0 || r.height <= 0;
            if (out_) fuori++;
            if (finite) {
                const mgn = Math.min(r.left, r.top, vw - r.right, vh - r.bottom);
                if (mgn < minM) minM = mgn;
            }
            rects.push({
                nid: g.getAttribute('data-nid'),
                l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1),
                w: +r.width.toFixed(1), h: +r.height.toFixed(1), out: out_
            });
        });
        out.fuoriViewport = fuori;
        out.nonFiniteRects = nonFinite;
        out.minViewportMargins = (minM === Infinity) ? null : +minM.toFixed(1);
        out.rects = rects;

        /* 3d: NaN nei nodi (attr numerici SVG), badge e transform mondo */
        out.nanNodi = nodes.filter(g => {
            const els = [].slice.call(g.querySelectorAll('rect,ellipse,image,text,tspan'));
            return els.some(el => [].slice.call(el.attributes)
                .some(a => /NaN|Infinity|undefined/.test(a.value)));
        }).map(g => g.getAttribute('data-nid'));
        const zEl = document.querySelector('.sc-zoom');
        out.zoomBadge = zEl ? zEl.textContent : null;
        const gw = document.querySelector('.sc-world');
        out.worldTransform = gw ? gw.getAttribute('transform') : null;
        const nums = (out.worldTransform || '').match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/g) || [];
        out.worldFinite = !!out.worldTransform && nums.length >= 3 &&
            !/NaN|Infinity|undefined/.test(out.worldTransform) && nums.map(Number).every(isFinite);

        /* 3f: matrice pulsanti (solo .sc-btnwrap = strategia del tipo) */
        const wrap = document.querySelector('.sc-btnwrap');
        out.btns = wrap ? [].slice.call(wrap.querySelectorAll('button.tool-btn')).map(b => {
            const rr = b.getBoundingClientRect();
            return { label: b.textContent.trim(), disabled: !!b.disabled, w: +rr.width.toFixed(1), h: +rr.height.toFixed(1) };
        }) : null;
        out.selMini = wrap ? [].slice.call(wrap.querySelectorAll('select')).map(s => {
            const rr = s.getBoundingClientRect();
            return {
                value: s.value, w: +rr.width.toFixed(1),
                opts: [].slice.call(s.options).map(o => o.value)
            };
        }) : [];

        /* testi DOM (confronto 5(ii)) */
        out.domTexts = nodes.map(g => ({
            nid: g.getAttribute('data-nid'),
            t: (g.textContent || '').replace(/\s+/g, ' ').trim()
        }));
        return out;
    });
}

/* ---------- valutazione dei check per uno step ---------- */
function evalStep(m, ctx) {
    const tag = 'g' + ctx.giro + '/' + ctx.tipo + (ctx.initial ? ' (inizio)' : '');
    const checks = [];
    const push = (cid, name, ok, exp, got) =>
        checks.push({ cid, id: 'B12 ' + tag + ' — ' + name, ok: !!ok, expected: exp, evidence: got });

    /* 3a nodi renderizzati === nodi salvati === 9 */
    const a = m.nodiRender === EXPECT_NODES && m.doc && m.doc.n === EXPECT_NODES &&
        m.nodiRender === m.doc.n;
    push('3a', 'nodi renderizzati === nodi doc (9)', a,
        'render=9 doc=9',
        'render=' + m.nodiRender + ' doc=' + (m.doc ? m.doc.n : 'ERR:' + m.docErr));

    /* 3b archi renderizzati === doc.edges, set data-eid identico (senza perdite) */
    const domE = m.domEids.slice().sort();
    const docE = (m.doc ? m.doc.eids : []).slice().sort();
    const b = m.doc && m.archiRender === m.doc.e && m.doc.e === EXPECT_EDGES &&
        JSON.stringify(domE) === JSON.stringify(docE);
    push('3b', 'archi renderizzati === doc.edges con data-eid identici (6)', b,
        'render=6 doc=6 set eid identico',
        'render=' + m.archiRender + ' doc=' + (m.doc ? m.doc.e : 'ERR') +
        ' dom=' + JSON.stringify(domE) + ' doc=' + JSON.stringify(docE) +
        (m.doc && m.doc.type ? ' docType=' + m.doc.type : ''));
    const sync = m.doc && m.doc.type === ctx.tipo;

    /* 3c ogni rect dentro il viewport con w/h > 0 */
    const c = m.fuoriViewport === 0 && m.nonFiniteRects === 0 && m.nodiRender === EXPECT_NODES;
    push('3c', 'tutti i rect nodi dentro viewport (rect reali)', c,
        'fuori=0 nonFinite=0 su 9 nodi',
        'fuori=' + m.fuoriViewport + ' nonFinite=' + m.nonFiniteRects +
        ' minMargin=' + m.minViewportMargins + 'px viewport=' + m.vw + 'x' + m.vh +
        ' worst=' + JSON.stringify((m.rects || []).filter(r => r.out).slice(0, 3)));

    /* 3d zero NaN */
    const d = (m.doc && m.doc.coordsOk) && m.nanNodi.length === 0 && m.worldFinite &&
        !/NaN|Infinity/.test(String(m.zoomBadge));
    push('3d', 'zero NaN (coord doc, attr nodi, transform mondo, badge)', d,
        'coordsOk=true nanNodi=0 worldFinite=true badge senza NaN',
        'coordsOk=' + (m.doc ? m.doc.coordsOk : '?') + ' nanNodi=' + JSON.stringify(m.nanNodi) +
        ' world="' + m.worldTransform + '" badge="' + m.zoomBadge + '"' +
        ' nodeTranslateAttr=' + m.nodeTranslate + '/9 (modulo usa coordinate assolute, non transform nodo)');

    /* 3e badge zoom in [25,200] ±0.1 */
    const zv = parseFloat(m.zoomBadge);
    const e = isFinite(zv) && zv >= 25 - 0.1 && zv <= 200 + 0.1 && !/NaN/.test(String(m.zoomBadge));
    push('3e', 'badge zoom parseFloat ∈ [25,200] ±0.1', e, '25 ≤ zoom ≤ 200',
        'badge="' + m.zoomBadge + '" parsed=' + zv);

    /* 3f matrice pulsanti per il tipo corrente */
    let f = false, fGot = '';
    if (m.btns === null) {
        f = false; fGot = '.sc-btnwrap ASSENTE';
    } else {
        const labels = m.btns.map(x => x.label);
        const has = t => labels.indexOf(t) >= 0;
        const visOk = m.btns.every(x => x.w > 0 && x.h > 0);
        let taskOk = false;
        if (ctx.tipo === 'albero' || ctx.tipo === 'lr') taskOk = has('+ Nodo') && has('+ Figlio') && has('+ Fratello');
        else if (ctx.tipo === 'mappa') taskOk = has('+ Figlio') && has('+ Fratello') && !has('+ Nodo');
        else if (ctx.tipo === 'libero') {
            const lay = m.btns.filter(x => x.label === 'Auto-layout')[0];
            taskOk = has('+ Nodo') && m.selMini.length === 1 &&
                !!lay && lay.disabled === true &&
                m.selMini[0].opts.join(',') === 'dritta,curva,gomito' &&
                m.selMini[0].w > 0;
        } else if (ctx.tipo === 'riassunto') taskOk = has('+ Figlio') && !has('+ Nodo') && !has('+ Fratello');
        const exp = MATRIX[ctx.tipo] || [];
        const fullOk = JSON.stringify(labels) === JSON.stringify(exp) &&
            (ctx.tipo === 'libero' ? m.selMini.length === 1 : m.selMini.length === 0) && visOk;
        f = taskOk && fullOk;
        fGot = 'labels=' + JSON.stringify(labels) + ' atteso=' + JSON.stringify(exp) +
            ' selects=' + m.selMini.length + ' taskOk=' + taskOk + ' fullOk=' + fullOk + ' visOk=' + visOk +
            (m.btns.filter(x => x.disabled).length ? ' disabled=' + JSON.stringify(m.btns.filter(x => x.disabled).map(x => x.label)) : '');
    }
    push('3f', 'matrice pulsanti del tipo corrente', f,
        'matrice ' + ctx.tipo + ': ' + JSON.stringify(MATRIX[ctx.tipo]),
        fGot);

    /* store sincronizzato col tipo (evidenza per 3b) */
    push('sync', 'store b12.type === tipo corrente (salvataggio avvenuto)', sync,
        'type=' + ctx.tipo, 'type=' + (m.doc ? m.doc.type : 'ERR'));

    /* testi doc invariati rispetto al baseline */
    const cur = JSON.stringify((m.doc ? m.doc.texts : []).slice().sort((x, y) => x.id < y.id ? -1 : 1));
    const textsOk = ctx.baselineTexts ? (cur === ctx.baselineTexts) : true;
    push('texts', 'testi doc invariati vs baseline', textsOk,
        'set di 9 testi identico', textsOk ? 'identico' : 'baseline=' + ctx.baselineTexts + ' cur=' + cur);

    const all = checks.every(x => x.ok);
    return { checks, all, labels: m.btns ? m.btns.map(x => x.label) : null };
}

/* ---------- screenshot via handshake __qaShot + page.screenshot ---------- */
async function shot(page, name) {
    page.evaluate(n => window.__qaShot(n), name).catch(() => { });
    let fp = null;
    for (let i = 0; i < 400; i++) {
        let need = null;
        try { need = await page.evaluate(() => window.__QA && window.__QA.needShot); } catch (e) { break; }
        if (need === name) {
            fp = path.join(QA_DIR, name + '.png');
            await page.screenshot({ path: fp });
            await page.evaluate(() => { window.__SHOT_OK = true; });
            break;
        }
        await sleep(50);
    }
    return fp;
}

/* ---------- main ---------- */
(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));

    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    const consoleErrs = [];
    page.on('console', m => {
        if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrs.push('console.error: ' + m.text());
    });
    page.on('pageerror', e => consoleErrs.push('pageerror: ' + e.message));

    const url = pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href;
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    /* attesa harness: editor aperto con 9 nodi + fit */
    let harnessOk = false;
    for (let i = 0; i < 200; i++) {
        const st = await page.evaluate(() => ({
            ready: !!(window.__QA && window.__QA.harnessReady),
            errs: (window.__QA && window.__QA.errors) || []
        }));
        if (st.errs.length) { consoleErrs.push.apply(consoleErrs, st.errs); break; }
        if (st.ready) { harnessOk = true; break; }
        await sleep(100);
    }
    if (!harnessOk) {
        console.error('BLOCKED — harness non pronto (editor/fit non raggiunto).');
        console.error('  evidenza: ' + JSON.stringify(consoleErrs.slice(0, 5)));
        console.error('  Alternativa: verificare qa_ui/schemi.html e moduli caricati da file://.');
        await browser.close();
        process.exit(2);
    }

    const allChecks = [];
    const steps = [];
    const shots = [];
    let baselineTexts = null, baselineDom = null, finalDom = null, initialM = null, finalM = null;

    /* --- step iniziale: doc aperto in tipo 'albero' (giro 1 parte da qui) --- */
    async function runStep(giro, tipo, initial) {
        const ctx = { giro, tipo, initial: !!initial, baselineTexts };
        let m = null, res = null, attempts = 0;
        for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
            if (attempts === 1 && !initial) {
                await page.evaluate(t => {
                    const sel = document.querySelector('.sc-type-sel');
                    sel.value = t;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }, tipo);
                await sleep(350);   /* ~200ms animazione layout + margine */
            } else {
                await sleep(attempts === 1 ? 350 : 700);
            }
            m = await measure(page);
            res = evalStep(m, ctx);
            if (res.all) break;
            await sleep(500);
        }
        const failed = res.checks.filter(c => !c.ok);
        allChecks.push.apply(allChecks, res.checks);
        const rec = {
            giro, tipo, initial: !!initial, tentativi: attempts, ok: res.all,
            nodiRender: m.nodiRender, archiRender: m.archiRender,
            docNodi: m.doc ? m.doc.n : null, docArchi: m.doc ? m.doc.e : null,
            docType: m.doc ? m.doc.type : null,
            zoomBadge: m.zoomBadge,
            minViewportMargins: m.minViewportMargins,
            fuoriViewport: m.fuoriViewport, nonFiniteRects: m.nonFiniteRects,
            nodiConNaN: m.nanNodi.length, worldTransform: m.worldTransform,
            pulsanti: res.labels,
            testiOk: (res.checks.filter(c => c.cid === 'texts')[0] || {}).ok !== false,
            fail: failed.map(c => ({ id: c.id, atteso: c.expected, ottenuto: c.evidence }))
        };
        steps.push(rec);
        console.log((rec.ok ? '[OK]  ' : '[FAIL]') + ' giro' + giro + ' ' + tipo +
            (initial ? ' (stato iniziale)' : '') +
            ' nodi=' + rec.nodiRender + '/' + rec.docNodi +
            ' archi=' + rec.archiRender + '/' + rec.docArchi +
            ' zoom=' + rec.zoomBadge + ' marginMin=' + rec.minViewportMargins +
            ' fuori=' + rec.fuoriViewport +
            (rec.ok ? '' : ' tentativi=' + attempts + ' FAIL=' + JSON.stringify(failed.map(c => c.cid))));
        return { m, rec };
    }

    /* step 0: albero iniziale (giro 1) */
    {
        const r = await runStep(1, 'albero', true);
        initialM = r.m;
        baselineTexts = JSON.stringify(r.m.doc.texts.slice().sort((x, y) => x.id < y.id ? -1 : 1));
        baselineDom = r.m.domTexts.slice().sort((a, b) => a.nid < b.nid ? -1 : 1);
        const fp = await shot(page, 'schemi_b12_albero_giro1');
        shots.push(fp); console.log('SHOT schemi_b12_albero_giro1 -> ' + (fp ? 'qa/' + path.basename(fp) : 'MANCATO'));
    }

    /* 3 giri x 5 cambi = 15 cambi */
    for (let giro = 1; giro <= 3; giro++) {
        for (const tipo of CYCLE) {
            const r = await runStep(giro, tipo, false);
            if (giro === 1 && tipo !== 'albero') {
                const fp = await shot(page, 'schemi_b12_' + tipo + '_giro1');
                shots.push(fp); console.log('SHOT schemi_b12_' + tipo + '_giro1 -> ' + (fp ? 'qa/' + path.basename(fp) : 'MANCATO'));
            }
            if (giro === 3 && tipo === 'albero') {
                finalM = r.m;
                finalDom = r.m.domTexts.slice().sort((a, b) => a.nid < b.nid ? -1 : 1);
                const fp = await shot(page, 'schemi_b12_albero_giro3');
                shots.push(fp); console.log('SHOT schemi_b12_albero_giro3 -> ' + (fp ? 'qa/' + path.basename(fp) : 'MANCATO'));
            }
        }
    }

    /* ---------- 5(ii) testi nodo invariati dopo il ciclo (DOM, stesso tipo albero) ---------- */
    const domTextsOk = JSON.stringify(baselineDom) === JSON.stringify(finalDom);
    allChecks.push({
        cid: '5ii', id: 'B12 — 5(ii) testi DOM nodi invariati (albero iniziale vs albero fine ciclo)',
        ok: domTextsOk, expected: 'stesso set di 9 testi (nid→testo)',
        evidence: domTextsOk ? 'identico (9 nodi)' :
            'baseline=' + JSON.stringify(baselineDom) + ' finale=' + JSON.stringify(finalDom)
    });
    console.log((domTextsOk ? '[OK]  ' : '[FAIL]') + ' 5(ii) testi DOM invariati prima/dopo ciclo');

    /* ---------- 5(i) doc vuoto (0 nodi) in tipo mappa → "+ Nodo" visibile e crea 1 nodo ---------- */
    const opened = await page.evaluate(() => window.__qaHarness.open('b12empty'));
    let emptyOk = false, emptyEv = '';
    if (!opened) {
        emptyEv = 'apertura doc vuoto fallita';
        allChecks.push({ cid: '5i', id: 'B12 — 5(i) doc vuoto mappa: "+ Nodo" visibile e crea 1 nodo', ok: false, expected: 'btn visibile + 1 nodo dopo click', evidence: emptyEv });
    } else {
        await sleep(400);
        const before = await page.evaluate(() => {
            const sel = document.querySelector('.sc-type-sel');
            const wrap = document.querySelector('.sc-btnwrap');
            const btns = wrap ? [].slice.call(wrap.querySelectorAll('button.tool-btn')) : [];
            const n = btns.filter(b => b.textContent.trim() === '+ Nodo')[0];
            const r = n ? n.getBoundingClientRect() : null;
            return {
                tipo: sel ? sel.value : null,
                nodi: document.querySelectorAll('g.sc-node[data-nid]').length,
                hasNodeBtn: !!n,
                vis: !!r && r.width > 0 && r.height > 0 && !n.disabled,
                labels: btns.map(b => b.textContent.trim())
            };
        });
        await shot(page, 'schemi_b12_vuoto_mappa'); shots.push(path.join(QA_DIR, 'schemi_b12_vuoto_mappa.png'));
        const clicked = await page.evaluate(() => {
            const wrap = document.querySelector('.sc-btnwrap');
            const b = wrap && [].slice.call(wrap.querySelectorAll('button.tool-btn'))
                .filter(x => x.textContent.trim() === '+ Nodo')[0];
            if (!b) return false; b.click(); return true;
        });
        await sleep(500);
        const after = await page.evaluate(() => ({
            nodi: document.querySelectorAll('g.sc-node[data-nid]').length,
            labels: [].slice.call(document.querySelectorAll('.sc-btnwrap button.tool-btn')).map(b => b.textContent.trim())
        }));
        await shot(page, 'schemi_b12_vuoto_mappa_dopo_click'); shots.push(path.join(QA_DIR, 'schemi_b12_vuoto_mappa_dopo_click.png'));
        emptyOk = before.tipo === 'mappa' && before.nodi === 0 && before.hasNodeBtn && before.vis &&
            clicked && after.nodi === 1;
        emptyEv = 'prima: tipo=' + before.tipo + ' nodi=' + before.nodi + ' btn+ Nodo=' + before.hasNodeBtn +
            ' vis=' + before.vis + ' labels=' + JSON.stringify(before.labels) +
            ' | click=' + clicked + ' dopo: nodi=' + after.nodi + ' labels=' + JSON.stringify(after.labels);
        allChecks.push({
            cid: '5i', id: 'B12 — 5(i) doc vuoto mappa: "+ Nodo" visibile e crea 1 nodo',
            ok: emptyOk, expected: 'tipo=mappa nodi=0 → btn visibile → 1 nodo dopo click', evidence: emptyEv
        });
        console.log((emptyOk ? '[OK]  ' : '[FAIL]') + ' 5(i) doc vuoto mappa: ' + emptyEv);
    }

    /* ---------- 5(iii) zero errori ---------- */
    const pageErrs = await page.evaluate(() => (window.__QA && window.__QA.errors) || []);
    const errs = consoleErrs.concat(pageErrs);
    const errOk = errs.length === 0;
    allChecks.push({
        cid: '5iii', id: 'B12 — 5(iii) zero QA.errors / console.error durante il giro',
        ok: errOk, expected: '0 errori', evidence: errOk ? '0 errori' : JSON.stringify(errs.slice(0, 10))
    });
    console.log((errOk ? '[OK]  ' : '[FAIL]') + ' 5(iii) errori=' + errs.length +
        (errOk ? '' : ' ' + JSON.stringify(errs.slice(0, 5))));

    /* ---------- screenshot 4: tutti i 6 previsti presenti ---------- */
    const expectShots = ['schemi_b12_albero_giro1', 'schemi_b12_mappa_giro1', 'schemi_b12_lr_giro1',
        'schemi_b12_libero_giro1', 'schemi_b12_riassunto_giro1', 'schemi_b12_albero_giro3'];
    const missingShots = expectShots.filter(n => !fs.existsSync(path.join(QA_DIR, n + '.png')));
    allChecks.push({
        cid: '4', id: 'B12 — 4 screenshot giro1 (5 tipi) + albero giro3',
        ok: missingShots.length === 0, expected: '6 PNG in qa/',
        evidence: missingShots.length === 0 ? '6/6 presenti: ' + expectShots.join(', ')
            : 'MANCANTI: ' + missingShots.join(', ')
    });
    console.log((missingShots.length === 0 ? '[OK]  ' : '[FAIL]') + ' 4 screenshot: ' +
        (missingShots.length === 0 ? '6/6' : 'mancanti ' + missingShots.join(',')));

    /* ---------- aggregati per categoria (esito T2) ---------- */
    const cats = ['3a', '3b', '3c', '3d', '3e', '3f', '4', '5i', '5ii', '5iii'];
    const agg = {};
    cats.forEach(c => {
        const list = allChecks.filter(x => x.cid === c);
        agg[c] = { total: list.length, pass: list.filter(x => x.ok).length, fail: list.filter(x => !x.ok) };
    });

    const zooms = steps.map(s => parseFloat(s.zoomBadge)).filter(isFinite);
    const margins = steps.map(s => s.minViewportMargins).filter(x => x !== null && isFinite(x));
    const meta = {
        buildTs: BUILD_TS, viewport: VW + 'x' + VH, stepsTotal: steps.length,
        cambiTotali: steps.filter(s => !s.initial).length,
        zoomMin: zooms.length ? Math.min.apply(null, zooms) : null,
        zoomMax: zooms.length ? Math.max.apply(null, zooms) : null,
        marginMin: margins.length ? Math.min.apply(null, margins) : null,
        marginMax: margins.length ? Math.max.apply(null, margins) : null,
        errori: errs, tentativiMaxUsati: Math.max.apply(null, steps.map(s => s.tentativi))
    };

    fs.writeFileSync(path.join(QA_DIR, 'schemi_b12_measures.json'), JSON.stringify({
        meta, steps,
        emptyTest: { ok: emptyOk, evidence: emptyEv },
        texts: { baselineDom, finalDom, ok: domTextsOk },
        screenshots: shots.filter(Boolean).map(s => 'qa/' + path.basename(s))
    }, null, 1));
    fs.writeFileSync(path.join(QA_DIR, 'schemi_b12_report.json'),
        JSON.stringify({ meta, agg, checks: allChecks }, null, 1));

    /* ---------- report finale ---------- */
    console.log('\n===== REPORT QA-T2 (ciclo tipi schema B12) =====');
    cats.forEach(c => {
        const a = agg[c];
        const status = a.total === 0 ? 'N/A' : (a.pass === a.total ? 'PASS' : 'FAIL');
        console.log('check ' + c + ': ' + status + ' (' + a.pass + '/' + a.total + ')');
        a.fail.forEach(f => {
            console.log('   FAIL id: ' + f.id);
            console.log('     atteso  : ' + f.expected);
            console.log('     ottenuto: ' + f.evidence);
            console.log('     pagina  : qa_ui/schemi.html (viewport ' + VW + 'x' + VH + ')');
            console.log('     ipotesi causa: ' + (HYP[f.cid] || 'n/d'));
        });
    });
    console.log('\nmisure: zoom osservato [' + meta.zoomMin + '%, ' + meta.zoomMax + '%], ' +
        'margini viewport osservati [' + meta.marginMin + ', ' + meta.marginMax + '] px, ' +
        'steps=' + meta.stepsTotal + ' (cambi=' + meta.cambiTotali + '), max tentativi/step=' + meta.tentativiMaxUsati);
    console.log('screenshot: ' + shots.filter(Boolean).map(s => 'qa/' + path.basename(s)).join(', '));
    console.log('-> qa/schemi_b12_measures.json + qa/schemi_b12_report.json');

    const nok = cats.filter(c => agg[c].total > 0 && agg[c].pass !== agg[c].total);
    if (nok.length) {
        console.log('\nESITO T2: FAIL su ' + nok.join(', '));
        console.log('BLOCKED parziale: le categorie ' + nok.join(', ') + ' non passano dopo ' +
            MAX_ATTEMPTS + ' tentativi; NON ho modificato i moduli (solo report).');
        console.log('Alternativa: mantenere il doc aperto e verificare a mano i FAIL sopra; ' +
            'le misure restano valide per le categorie PASS.');
    } else {
        console.log('\nESITO T2: PASS (tutte le categorie)');
    }

    await browser.close();
    process.exit(nok.length ? 1 : 0);
})().catch(e => {
    console.error('RUNNER FATAL:', e);
    process.exit(3);
});
