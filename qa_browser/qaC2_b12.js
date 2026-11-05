'use strict';
/* qa_browser/qaC2_b12.js — QA-T2 BLOCCO C2: viewer Fonti libri/materiali (Chromium REALE).
   Owner unico di questo runner. Harness: qa_ui/notes.html (C2a-C2c, C2f) e
   qa_ui/schemi.html (C2d-C2e), ENTRAMBI INVASI: nessuna modifica ai file harness
   (seeds fatti a runtime dal runner, harness AB conservati intatti).

   STUB DICHIARATO (unico): window.pywebview.api.read_material_text e'
   stubbato dal runner con un ponte che restituisce il contenuto letto dal
   DISCO reale via fs.readFileSync strettamente sullo stesso path passato dal
   modulo (name/size/kind da fs.statSync) — nessun contenuto inventato, e
   StudyStore.listMaterials (assente in env.js) e' patched a runtime con i
   seed dei materiali. NESSUNA geometria stubbata: tutte le misure usano
   getBoundingClientRect/computed style del browser reale.

   File di prova REALI su disco:
   - file_AIstudio/originals/fotosintesi_clorofilliana_universitario.md (file di progetto reale, post-migrazione G3)
   - qa/tmp/qaC2_lungo.md  (~6000 char, creato dal runner prima del launch)
   - qa/tmp/qaC2_corto.md  (~400 char, creato dal runner prima del launch)

   Output: qa/qaC2_measures.json + screenshot qa/qaC2_*.png
   Esecuzione: node qa_browser/qaC2_b12.js  */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
const TMP_DIR = path.join(QA_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const BUILD_TS = (function(){ try { var s = require('fs').readFileSync(require('path').join(__dirname, '..', 'web_frontend', 'html', 'index.html'), 'utf8'); var m = s.match(/var QA_TS\s*=\s*"([^"]+)"/); return m ? m[1] : 'MISSING'; } catch (e) { return 'MISSING'; } })();
const VW = 1366, VH = 900;
const MAX_ATT = 10;                 // max 10 tentativi per unita'
const CAP = 2500;                   // FONTI_MAT_CAP / MAT_CAP dichiarati nei moduli

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- ipotesi causa (moduli reali NON toccati) per check falliti ---------- */
const HYP = {
    C2a: 'selectFonti notes.js:2804 / previewFonteFile notes.js:2834 (guard ed.fontiSelKey notes.js:2839) o readMaterialText guard notes.js:2679-2687',
    C2b: 'cap previewFonteFile notes.js:2860 / showFullFonteText notes.js:2880-2883 / FONTI_MAT_CAP notes.js:2660',
    C2c: 'insertFontiRef branch src.path (t:file) notes.js:2920-2924 / scheduleSave debounce 900ms notes.js:1076',
    C2d: 'showTab schemi.js:1904-1915 / loadSources branch listMaterials schemi.js:1962-1983 / previewMatFile schemi.js:2014-2053',
    C2e: 'buildSide schemi.js:2216-2226 (bodyF = solo select + .sc-preview, nessun pulsante inserimento)',
    C2f: 'renderFontiList filtro ricerca notes.js:2780-2791 / listener input notes.js:2734',
    C2g: 'errore runtime modulo/harness o eccezione JS nel giro C2'
};

const MEAS = { C: {} };
const RESULTS = [];

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

/* ---------- file di prova REALI ---------- */
function makeTempFiles() {
    const lungoPath = path.join(TMP_DIR, 'qaC2_lungo.md');
    const cortoPath = path.join(TMP_DIR, 'qaC2_corto.md');
    let lungo = '# Materiale lungo QA — file .md temporaneo REALE creato dal runner qaC2\n\n';
    let i = 1;
    while (lungo.length < 6000) {
        lungo += '## Sezione ' + i + '\n\n' +
            'La fotosintesi clorofilliana converte l\'energia luminosa in energia chimica, producendo glucosio e ossigeno; ' +
            'il processo si svolge nei cloroplasti e coinvolge le reazioni luminose dipendenti dalla luce e il ciclo di Calvin. ' +
            'Paragrafo di prova numero ' + i + ' scritto per superare la soglia dei 2500 caratteri e verificare il cap dell\'anteprima del viewer Fonti.\n\n';
        i++;
    }
    const corto = '# Materiale corto QA — file .md temporaneo REALE creato dal runner qaC2\n\n' +
        'Questo e il file corto usato per verificare che l anteprima mostri il testo completo ' +
        'senza il pulsante Carica testo completo quando la lunghezza resta sotto i 2500 caratteri.\n' +
        'Riga finale del file corto QA usato nel blocco C2.\n';
    fs.writeFileSync(lungoPath, lungo, 'utf8');
    fs.writeFileSync(cortoPath, corto, 'utf8');
    return { lungoPath, cortoPath };
}
function loadFile(p) {
    const buf = fs.readFileSync(p);
    return {
        path: p, url: pathToFileURL(p).href, name: path.basename(p),
        text: buf.toString('utf8'), size: buf.length,
        kind: path.extname(p).slice(1) || 'file',
        sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    };
}
/* fmtBytes identico a notes.js:2689 / schemi.js:1945 (per atteso metadato Dimensione) */
function fmtBytes(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
}
/* finestra di ~40 char SENZA \r\n vicino a center (robusto a differenze CR/LF).
   opts.uniq    -> la sottostringa deve comparire SOLO a start (assert negativi)
   opts.minStart/maxStart -> vincoli sullo start (es. oltre il cap, o dentro il cap) */
function pickSub(text, center, len, opts) {
    len = len || 40; opts = opts || {};
    const Ls = [len, 30, 24];
    for (const L of Ls) {
        const half = Math.floor(L / 2);
        for (let d = 0; d <= 800; d++) {
            for (const s of [center - half + d, center - half - d]) {
                if (s < 0 || s + L > text.length) continue;
                if (opts.minStart != null && s < opts.minStart) continue;
                if (opts.maxStart != null && s > opts.maxStart) continue;
                const sub = text.slice(s, s + L);
                if (/[\r\n]/.test(sub)) continue;
                if (opts.uniq && text.indexOf(sub) !== s) continue;
                return { sub, start: s, len: L, unique: !!opts.uniq };
            }
        }
    }
    return null;
}
function pickTail(text, len, opts) {
    len = len || 40; opts = opts || {};
    for (let s = text.length - len; s >= Math.max(0, text.length - 800); s--) {
        const sub = text.slice(s, s + len);
        if (sub.length !== len || /[\r\n]/.test(sub)) continue;
        if (opts.uniq && text.indexOf(sub) !== s) continue;
        return { sub, start: s, len, unique: !!opts.uniq };
    }
    return null;
}

/* ---------- handshake screenshot (protocollo __qaShot/__SHOT_OK di run.js) ---------- */
async function shot(page, name) {
    await page.evaluate(n => { window.__QA.needShot = n; }, name);
    await sleep(50);
    await page.screenshot({ path: path.join(QA_DIR, name + '.png') });
    await page.evaluate(() => { window.__SHOT_OK = true; window.__QA.needShot = null; });
    console.log('SHOT -> qa/' + name + '.png');
}

/* ---------- attesa con max 10 tentativi per unita' (arg opzionale a page.evaluate) ---------- */
async function until10(page, fn, step, arg) {
    step = step || 150;
    for (let i = 0; i < MAX_ATT; i++) {
        if (await page.evaluate(fn, arg)) return true;
        await sleep(step);
    }
    return await page.evaluate(fn, arg);
}

function logCheck(id, ok) {
    const r = RESULTS[RESULTS.length - 1];
    console.log((ok ? '[VISTO] ' : '[NO]    ') + id);
    console.log('        atteso: ' + r.expected);
    console.log('        visto : ' + r.evidence);
}
async function pushCheck(page, id, expected, ok, evidence, m) {
    ok = !!ok;
    if (!ok && HYP[id]) evidence = evidence + ' | ipotesi causa: ' + HYP[id];
    await page.evaluate((id, e, ok, ev) => window.__qaCheck(id, e, ok, ev), id, expected, ok, evidence);
    RESULTS.push({ id, expected, ok, evidence });
    if (m) MEAS.C[id] = m;
    logCheck(id, ok);
    return ok;
}
/* fatti calcolati in pagina (fn autocontenuto, argomenti serializzabili) */
async function facts(page, fn, arg) {
    try {
        const r = await page.evaluate(fn, arg);
        if (r && r.__err) return { __fail: 'eccezione in pagina: ' + r.__err };
        return r;
    } catch (e) {
        return { __fail: 'eccezione evaluate: ' + (e.message || e) };
    }
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
/* centro reale del PRIMO elemento di sel il cui textContent contiene text (scrolla in vista) */
async function centerByText(page, sel, text) {
    return await page.evaluate((s, t) => {
        const els = [].slice.call(document.querySelectorAll(s));
        const el = els.filter(e => (e.textContent || '').indexOf(t) >= 0)[0];
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, vpOk: r.top >= 0 && r.bottom <= innerHeight };
    }, sel, text);
}
async function clickItem(page, sel, text) {
    const c = await centerByText(page, sel, text);
    if (!c) return false;
    await page.mouse.click(c.x, c.y);
    return true;
}

function attachLogs(page) {
    const logs = [];
    page.on('console', m => { if (m.type() === 'error') logs.push('console.error: ' + m.text()); });
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

/* ---------- STUB BRIDGE + SEED MATERIALI (runtime, harness intatti) ---------- */
async function seedBridge(page, mats, db) {
    await page.evaluate((matsArg, dbArg) => {
        window.__qaFileDB = {};
        dbArg.forEach(e => { window.__qaFileDB[e.path] = { name: e.name, size: e.size, kind: e.kind, text: e.text }; });
        window.__qaMech = {};
        /* STUB DICHIARATO: solo il ponte backend pywebview (come StudyStore in env.js).
           Il testo e' quello letto dal DISCO reale sullo stesso path (fs del runner),
           name/size/kind da stat del file reale. Nessuna geometria toccata. */
        window.pywebview = {
            api: {
                read_material_text: async function (p) {
                    window.__qaMech[p] = 'fs.readFileSync(file reale) -> bridge';
                    const meta = (window.__qaFileDB || {})[p];
                    if (!meta) return { success: false, error: 'File non trovato (stub qa: path non nel DB)' };
                    return { success: true, name: meta.name, text: meta.text, kind: meta.kind, size: meta.size, mtime: 0 };
                }
            }
        };
        /* env.js non espone listMaterials -> lo si patcha a runtime con i seed */
        window.StudyStore.listMaterials = async function () {
            return matsArg.map(m => Object.assign({}, m));
        };
    }, mats, db);
}

/* ---------- FATTI PREVIEW NOTE (.fn-fprev) ---------- */
/* a: {path, indexed, name, sizeStr, sub, full} -> fatti; ok lo compone il runner */
const FN_NOTE_PREV = a => {
    try {
        const prev = document.querySelector('.fn-fprev');
        if (!prev) return { absent: true };
        const norm = s => String(s == null ? '' : s).replace(/\uFEFF/g, '').replace(/\r/g, '');
        const t = norm(prev.textContent);
        const r = prev.getBoundingClientRect();
        const cs = getComputedStyle(prev);
        const exp = [
            'Percorso: ' + a.path,
            'Indicizzato il ' + a.indexed,
            'Nome: ' + a.name,
            'Dimensione: ' + a.sizeStr,
            'Tipo file: md'
        ];
        const meta = {};
        exp.forEach(k => { meta[k] = t.indexOf(k) >= 0; });
        return {
            rect: { w: Math.round(r.width), h: Math.round(r.height) },
            display: cs.display, visibility: cs.visibility,
            meta: meta, metaAll: exp.every(k => meta[k]),
            subOk: a.sub ? t.indexOf(a.sub) >= 0 : null,
            subIdx: a.sub ? t.indexOf(a.sub) : -1,
            fullOk: a.full ? t.indexOf(norm(a.full)) >= 0 : null,
            textLen: t.length
        };
    } catch (e) { return { __err: String(e && e.message || e) }; }
};

/* ---------- FATTI STATO CAP / COMPLETO (note) ---------- */
const FN_NOTE_STATES = a => {
    try {
        const prev = document.querySelector('.fn-fprev');
        if (!prev) return { absent: true };
        const norm = s => String(s == null ? '' : s).replace(/\uFEFF/g, '').replace(/\r/g, '');
        const t = norm(prev.textContent);
        const btn = prev.querySelector('.fn-fload');
        return {
            btn: !!btn,
            hasCapEnd: a.capEnd ? t.indexOf(a.capEnd) >= 0 : null,
            hasTail: a.tail ? t.indexOf(a.tail) >= 0 : null,
            hasMid: a.mid ? t.indexOf(a.mid) >= 0 : null,
            hasEllipsis: t.indexOf('\u2026') >= 0,
            textLen: t.length
        };
    } catch (e) { return { __err: String(e && e.message || e) }; }
};
const FN_NOTE_FULL = a => {
    try {
        const prev = document.querySelector('.fn-fprev');
        if (!prev) return { absent: true };
        const norm = s => String(s == null ? '' : s).replace(/\uFEFF/g, '').replace(/\r/g, '');
        const t = norm(prev.textContent);
        return {
            hasFull: a.full ? t.indexOf(norm(a.full)) >= 0 : null,
            hasTail: a.tail ? t.indexOf(a.tail) >= 0 : null,
            hasMid: a.mid ? t.indexOf(a.mid) >= 0 : null,
            btn: !!prev.querySelector('.fn-fload'),
            textLen: t.length,
            expectLen: a.full ? norm(a.full).length : null
        };
    } catch (e) { return { __err: String(e && e.message || e) }; }
};

/* ---------- oggetti doc nota (store, dopo debounce) ---------- */
async function noteObjCount(page) {
    return await page.evaluate(async () => {
        const it = await window.StudyStore.getItem('nt1');
        const d = JSON.parse(it.content);
        let n = 0;
        if (Array.isArray(d.pages)) d.pages.forEach(p => { n += (p.objects || []).length; });
        else n = (d.objects || []).length;
        return n;
    });
}
const FN_LAST_OBJ = {
    read: async () => {
        const it = await window.StudyStore.getItem('nt1');
        const d = JSON.parse(it.content);
        const objs = (Array.isArray(d.pages) && d.pages[0] && d.pages[0].objects) || d.objects || [];
        const o = objs.length ? objs[objs.length - 1] : null;
        return { count: objs.length, last: o };
    }
};

/* ---------- FATTI PANNELLO SCHEMI (.sc-preview + .sc-side) ---------- */
const FN_SCH_PREV = a => {
    try {
        const prev = document.querySelector('.sc-preview');
        if (!prev) return { absent: true };
        const norm = s => String(s == null ? '' : s).replace(/\uFEFF/g, '').replace(/\r/g, '');
        const t = norm(prev.textContent);
        const r = prev.getBoundingClientRect();
        const cs = getComputedStyle(prev);
        const exp = [
            'Percorso: ' + a.path,
            'Indicizzato il ' + a.indexed,
            'Nome: ' + a.name,
            'Dimensione: ' + a.sizeStr,
            'Tipo file: md'
        ];
        const meta = {};
        exp.forEach(k => { meta[k] = t.indexOf(k) >= 0; });
        const body = prev.parentNode;
        return {
            rect: { w: Math.round(r.width), h: Math.round(r.height) },
            display: cs.display, visibility: cs.visibility,
            bodyDisplay: body ? body.style.display : null,
            meta: meta, metaAll: exp.every(k => meta[k]),
            subOk: a.sub ? t.indexOf(a.sub) >= 0 : null,
            subIdx: a.sub ? t.indexOf(a.sub) : -1,
            fullOk: a.full ? t.indexOf(norm(a.full)) >= 0 : null,
            btn: !!prev.querySelector('.sc-fload'),
            textLen: t.length
        };
    } catch (e) { return { __err: String(e && e.message || e) }; }
};
const FN_SCH_SIDE = () => {
    try {
        const side = document.querySelector('.sc-side');
        if (!side) return { absent: true };
        const r = side.getBoundingClientRect();
        const cs = getComputedStyle(side);
        const tabs = [].slice.call(side.querySelectorAll('.sc-tab'));
        const fontiTab = tabs.filter(t => (t.textContent || '').trim() === 'Fonti')[0] || null;
        const prev = side.querySelector('.sc-preview');
        const sel = prev ? prev.parentNode.querySelector('select') : null;
        const opts = sel ? [].slice.call(sel.options).map(o => ({ v: o.value, l: o.textContent })) : [];
        const studyOpts = opts.filter(o => o.v && o.v.indexOf('mat:') !== 0);
        const matOpts = opts.filter(o => o.v.indexOf('mat:') === 0);
        return {
            rect: { w: Math.round(r.width), h: Math.round(r.height) },
            hiddenClass: side.classList.contains('hidden'),
            display: cs.display,
            fontiActive: !!(fontiTab && fontiTab.classList.contains('active')),
            bodyDisplay: prev && prev.parentNode ? prev.parentNode.style.display : null,
            optTotal: opts.length, studyOpts: studyOpts.length, matOpts: matOpts.length,
            matLabels: matOpts.map(o => o.l),
            studyLabels: studyOpts.map(o => o.l)
        };
    } catch (e) { return { __err: String(e && e.message || e) }; }
};

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));

    /* ---------- file REALI di prova ---------- */
    const t = makeTempFiles();
    const F = {
        /* R13: percorso aggiornato dopo la migrazione G3 -> l'originale vive in
           file_AIstudio/originals/ (la copia indicizzata e' in rag_stage2/) */
        foto: loadFile(path.join(ROOT, 'file_AIstudio', 'originals', 'fotosintesi_clorofilliana_universitario.md')),
        lungo: loadFile(t.lungoPath),
        corto: loadFile(t.cortoPath)
    };
    if (F.lungo.text.length <= CAP) {
        console.error('BLOCKED — qaC2_lungo.md lunghezza ' + F.lungo.text.length + ' <= ' + CAP);
        process.exit(2);
    }
    const MATS = [
        { name: 'Fotosintesi', path: F.foto.path, indexed_at: '2026-10-16' },
        { name: 'Materiale Lungo QA', path: F.lungo.path, indexed_at: '2026-10-17' },
        { name: 'Materiale Corto QA', path: F.corto.path, indexed_at: '2026-10-17' }
    ];
    const DB = [F.foto, F.lungo, F.corto].map(f => ({ path: f.path, name: f.name, size: f.size, kind: f.kind, text: f.text }));

    /* finestre di confronto (~40 char) lette dai file REALI su disco */
    const pickCortoMid = pickSub(F.corto.text, Math.floor(F.corto.text.length / 2));
    const pickFotoCap = pickSub(F.foto.text, Math.floor(CAP / 2));      // middle della regione renderizzata (cap)
    const pickLungoCapEnd = pickSub(F.lungo.text, CAP - 20, 40, { maxStart: CAP - 40 }); // dentro la finestra cap
    const pickLungoMid = pickSub(F.lungo.text, Math.floor(F.lungo.text.length / 2), 40,
        { uniq: true, minStart: CAP });  // middle del file, unico e OLTRE il cap (assert negativo pre-click)
    const pickLungoTail = pickTail(F.lungo.text, 40, { uniq: true });
    console.log('FILE REALI: fotosintesi=' + F.foto.text.length + 'char sha=' + F.foto.sha256 +
        ' lungo=' + F.lungo.text.length + 'char sha=' + F.lungo.sha256 +
        ' corto=' + F.corto.text.length + 'char sha=' + F.corto.sha256);
    console.log('PICKS: cortoMid@' + (pickCortoMid && pickCortoMid.start) + ' fotoCap@' + (pickFotoCap && pickFotoCap.start) +
        ' lungoCapEnd@' + (pickLungoCapEnd && pickLungoCapEnd.start) + ' lungoMid@' + (pickLungoMid && pickLungoMid.start) +
        ' lungoTail@' + (pickLungoTail && pickLungoTail.start));

    /* ============================================================
       PAGINA 1 — qa_ui/notes.html (C2a, C2b, C2c, C2f)
       ============================================================ */
    const pageN = await browser.newPage();
    await pageN.setViewport({ width: VW, height: VH });
    const logsN = attachLogs(pageN);
    await pageN.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'notes.html')).href, { waitUntil: 'load', timeout: 20000 });
    if (!(await waitHarness(pageN, logsN, 'notes'))) {
        const er = await pageN.evaluate(() => window.__QA ? window.__QA.errors : ['__QA assente']);
        console.error('BLOCKED — harness notes non pronto: ' + JSON.stringify(er));
        process.exit(2);
    }
    await seedBridge(pageN, MATS, DB);

    /* --- apri pannello Fonti --- */
    const cFonti = await centerOf(pageN, '.fn-pill-left [data-fonti="1"]');
    let opened = false;
    if (cFonti) {
        await pageN.mouse.click(cFonti.x, cFonti.y);
        opened = await until10(pageN, () => {
            const s = document.querySelector('.fn-side');
            return !!(s && s.classList.contains('show') &&
                document.querySelectorAll('.fn-flist .fn-fitem').length >= 7);
        }, 150);
    }
    const listInfo = await pageN.evaluate(() => {
        const items = [].slice.call(document.querySelectorAll('.fn-flist .fn-fitem'));
        const mats = items.filter(b => {
            const k = b.querySelector('.fn-fkind');
            return k && /^(Materiale|Libro)/.test((k.textContent || '').trim());
        });
        return { all: items.length, mat: mats.length, matLabels: mats.map(b => (b.textContent || '').trim().slice(0, 80)) };
    });

    /* ============ C2a: preview materiale con tratto IDENTICO al file reale ============ */
    let rCorto = { __fail: 'non eseguito' };
    if (opened && listInfo.mat >= 1 && pickCortoMid) {
        const clicked = await clickItem(pageN, '.fn-flist .fn-fitem', 'Materiale Corto QA');
        const appeared = clicked && await until10(pageN, sub =>
            ((document.querySelector('.fn-fprev') || {}).textContent || '').indexOf(sub) >= 0,
            150, pickCortoMid.sub);
        rCorto = await facts(pageN, FN_NOTE_PREV, {
            path: F.corto.path, indexed: '2026-10-17', name: F.corto.name,
            sizeStr: fmtBytes(F.corto.size), sub: pickCortoMid.sub, full: F.corto.text
        });
        rCorto.__pre = { clicked, appeared };
    }
    /* selezione Fotosintesi (file reale di progetto) -> screenshot qaC2_notes_preview */
    let rFoto = { __fail: 'non eseguito' };
    if (opened && pickFotoCap) {
        const clicked = await clickItem(pageN, '.fn-flist .fn-fitem', 'Fotosintesi');
        const appeared = clicked && await until10(pageN, sub =>
            ((document.querySelector('.fn-fprev') || {}).textContent || '').indexOf(sub) >= 0,
            150, pickFotoCap.sub);
        rFoto = await facts(pageN, FN_NOTE_PREV, {
            path: F.foto.path, indexed: '2026-10-16', name: F.foto.name,
            sizeStr: fmtBytes(F.foto.size), sub: pickFotoCap.sub, full: null
        });
        rFoto.__pre = { clicked, appeared };
        await shot(pageN, 'qaC2_notes_preview');
    }
    {
        const prevOk = f => !f.__fail && !f.__err && !f.absent &&
            f.rect && f.rect.w > 0 && f.rect.h > 0 &&
            f.display !== 'none' && f.visibility !== 'hidden' && f.metaAll && f.subOk === true;
        const ok = opened && listInfo.mat >= 1 && prevOk(rCorto) && prevOk(rFoto) &&
            rCorto.__pre && rCorto.__pre.appeared && rFoto.__pre && rFoto.__pre.appeared;
        const ev = 'pannelloAperto=' + opened + ' vociLista=' + listInfo.all + ' vociMateriale=' + listInfo.mat +
            ' [' + listInfo.matLabels.join(' | ') + ']' +
            ' || CORTO: sub="' + (pickCortoMid ? pickCortoMid.sub : 'null') + '"@' + (pickCortoMid ? pickCortoMid.start : -1) +
            ' match=' + (rCorto.subOk) + '@' + (rCorto.subIdx == null ? -1 : rCorto.subIdx) +
            ' fullFileInDOM=' + rCorto.fullOk + ' metaAll=' + rCorto.metaAll +
            ' rect=' + (rCorto.rect ? rCorto.rect.w + 'x' + rCorto.rect.h : 'n/a') +
            ' textLen=' + rCorto.textLen + '/' + F.corto.text.length +
            ' || FOTO(cap): sub="' + (pickFotoCap ? pickFotoCap.sub : 'null') + '"@' + (pickFotoCap ? pickFotoCap.start : -1) +
            ' match=' + (rFoto.subOk) + '@' + (rFoto.subIdx == null ? -1 : rFoto.subIdx) +
            ' metaAll=' + rFoto.metaAll + ' rect=' + (rFoto.rect ? rFoto.rect.w + 'x' + rFoto.rect.h : 'n/a') +
            ' textLen=' + rFoto.textLen + ' (cap ' + CAP + ') meta=' + JSON.stringify(rFoto.meta || {});
        await pushCheck(pageN, 'C2a',
            'pannello Fonti con >=1 voce materiale; click -> preview .fn-fprev rect>0 con sottostringa ~40char IDENTICA al file .md reale su disco + metadati Percorso/Indicizzato/Nome/Dimensione/Tipo',
            ok, ev,
            { opened, list: listInfo, corto: rCorto, foto: rFoto, picks: { cortoMid: pickCortoMid, fotoCap: pickFotoCap } });
    }

    /* ============ C2b: cap >2500 + "Carica testo completo" + ramo corto (<=2500) ============ */
    {
        let cap = { __fail: 'non eseguito' }, full = { __fail: 'non eseguito' }, short = { __fail: 'non eseguito' };
        if (pickLungoCapEnd && pickLungoTail && pickLungoMid) {
            const clicked = await clickItem(pageN, '.fn-flist .fn-fitem', 'Materiale Lungo QA');
            const capShown = clicked && await until10(pageN, a => {
                const p = document.querySelector('.fn-fprev');
                if (!p) return false;
                return p.textContent.indexOf(a.capEnd) >= 0 && !!p.querySelector('.fn-fload');
            }, 150, { capEnd: pickLungoCapEnd.sub });
            cap = await facts(pageN, FN_NOTE_STATES, {
                capEnd: pickLungoCapEnd.sub, tail: pickLungoTail.sub, mid: pickLungoMid.sub
            });
            cap.__pre = { clicked, capShown, fileLen: F.lungo.text.length, cap: CAP };

            /* click REALE su "Carica testo completo" (scroll in vista) */
            await pageN.evaluate(() => {
                const b = document.querySelector('.fn-fprev .fn-fload');
                if (b) b.scrollIntoView({ block: 'center' });
            });
            const btnC = await centerOf(pageN, '.fn-fprev .fn-fload');
            let btnClicked = false;
            if (btnC) { await pageN.mouse.click(btnC.x, btnC.y); btnClicked = true; }
            const fullShown = btnClicked && await until10(pageN, a => {
                const p = document.querySelector('.fn-fprev');
                if (!p) return false;
                return p.textContent.indexOf(a.tail) >= 0 && !p.querySelector('.fn-fload');
            }, 150, { tail: pickLungoTail.sub });
            full = await facts(pageN, FN_NOTE_FULL, {
                full: F.lungo.text, tail: pickLungoTail.sub, mid: pickLungoMid.sub
            });
            full.__pre = { btnClicked, fullShown };

            /* ramo corto: file <=2500 -> pulsante NON deve esserci */
            const clickedS = await clickItem(pageN, '.fn-flist .fn-fitem', 'Materiale Corto QA');
            const shortShown = clickedS && await until10(pageN, sub => {
                const p = document.querySelector('.fn-fprev');
                if (!p) return false;
                return p.textContent.indexOf(sub) >= 0;
            }, 150, pickCortoMid.sub);
            short = await facts(pageN, FN_NOTE_FULL, {
                full: F.corto.text, tail: null, mid: null
            });
            short.__pre = { clickedS, shortShown, fileLen: F.corto.text.length };
        }
        const capOk = !cap.__fail && !cap.__err && cap.btn === true && cap.hasCapEnd === true &&
            cap.hasTail === false && cap.hasMid === false && cap.hasEllipsis === true;
        const fullOk = !full.__fail && !full.__err && full.hasFull === true && full.hasTail === true &&
            full.hasMid === true && full.btn === false;
        const shortOk = !short.__fail && !short.__err && short.btn === false && short.hasFull === true;
        const ok = capOk && fullOk && shortOk;
        const ev = 'LUNGO(' + F.lungo.text.length + 'char >' + CAP + '): capShow=' + (cap.__pre && cap.__pre.capShown) +
            ' btnCarica=' + cap.btn +
            ' capEnd@' + (pickLungoCapEnd ? pickLungoCapEnd.start : -1) +
            ' present=' + cap.hasCapEnd +
            ' tail40@' + (pickLungoTail ? pickLungoTail.start : -1) + '(uniq=' + !!(pickLungoTail && pickLungoTail.unique) + ')' +
            ' present=' + cap.hasTail +
            ' mid@' + (pickLungoMid ? pickLungoMid.start : -1) + '(uniq=' + !!(pickLungoMid && pickLungoMid.unique) + ')' +
            ' present=' + cap.hasMid +
            ' ellipsis=' + cap.hasEllipsis + ' textLen=' + cap.textLen +
            ' -> CLICK btn(' + (full.__pre && full.__pre.btnClicked) + ') fullShow=' + (full.__pre && full.__pre.fullShown) +
            ' fileCompletoInDOM=' + full.hasFull + ' tail=' + full.hasTail + ' mid=' + full.hasMid +
            ' btnDopo=' + full.btn + ' textLen=' + full.textLen + '/' + full.expectLen +
            ' || CORTO(' + F.corto.text.length + 'char <= ' + CAP + '): btnCarica=' + short.btn +
            ' fileCompletoInDOM=' + short.hasFull + ' textLen=' + short.textLen + ' shown=' + (short.__pre && short.__pre.shortShown);
        await pushCheck(pageN, 'C2b',
            'file >2500 -> anteprima cap (2500char + ellipsis) con pulsante "Carica testo completo"; click -> testo TUTTO del file nella preview; file corto <=2500 -> testo completo e pulsante ASSENTE',
            ok, ev,
            { cap, full, short, picks: { capEnd: pickLungoCapEnd, tail: pickLungoTail, mid: pickLungoMid } });
    }

    /* ============ C2c: inserisci riferimento materiale -> oggetto t:'file' con path ============ */
    {
        const selFoto = await clickItem(pageN, '.fn-flist .fn-fitem', 'Fotosintesi');
        const prevReady = selFoto && await until10(pageN, p =>
            ((document.querySelector('.fn-fprev') || {}).textContent || '').indexOf(p) >= 0, 150, 'Percorso: ' + F.foto.path);
        const before = await noteObjCount(pageN);
        await pageN.evaluate(() => {
            const b = document.querySelector('.fn-finsert');
            if (b) b.scrollIntoView({ block: 'center' });
        });
        const cIns = await centerOf(pageN, '.fn-finsert');
        let clicked = false, disabled = null;
        if (cIns) {
            disabled = await pageN.evaluate(() => document.querySelector('.fn-finsert').disabled);
            if (!disabled) { await pageN.mouse.click(cIns.x, cIns.y); clicked = true; }
        }
        /* attesa DEBOUNCE (scheduleSave 900ms) + scrittura store, max 10 tentativi */
        const afterOk = clicked && await until10(pageN, async exp => {
            const it = await window.StudyStore.getItem('nt1');
            const d = JSON.parse(it.content);
            const objs = (d.pages && d.pages[0] && d.pages[0].objects) || [];
            return objs.length === exp;
        }, 200, before + 1);
        const lastInfo = await facts(pageN, FN_LAST_OBJ.read);
        const last = lastInfo && lastInfo.last;
        const ok = prevReady && clicked && afterOk && last && last.t === 'file' &&
            last.path === F.foto.path && lastInfo.count === before + 1;
        const ev = 'previewPronta=' + prevReady + ' btnDisabled=' + disabled + ' click=' + clicked +
            ' oggetti store: ' + before + ' -> ' + (lastInfo && lastInfo.count) + ' (debounceOk=' + afterOk + ')' +
            ' ultimo=' + JSON.stringify(last ? { t: last.t, name: last.name, path: last.path, w: last.w, h: last.h } : null);
        await pushCheck(pageN, 'C2c',
            'click "Inserisci nella nota" -> count oggetti doc nt1 +1 (store dopo debounce 900ms) e nuovo oggetto t:\'file\' con il path del materiale',
            ok, ev,
            { before, after: lastInfo && lastInfo.count, last, previewReady: prevReady, clicked });
        await shot(pageN, 'qaC2_notes_insert');
    }

    /* ============ C2f: ricerca nel pannello Fonti filtra le voci ============ */
    {
        const n0 = await pageN.evaluate(() => document.querySelectorAll('.fn-flist .fn-fitem').length);
        const cS = await centerOf(pageN, '.fn-side-search');
        let typed = false;
        if (cS) {
            await pageN.mouse.click(cS.x, cS.y);
            await pageN.keyboard.type('fotosintesi');
            typed = true;
        }
        const n1ok = await until10(pageN, () => document.querySelectorAll('.fn-flist .fn-fitem').length === 1, 150);
        const n1 = await pageN.evaluate(() => document.querySelectorAll('.fn-flist .fn-fitem').length);
        await pageN.keyboard.down('Control');
        await pageN.keyboard.press('KeyA');
        await pageN.keyboard.up('Control');
        await pageN.keyboard.press('Backspace');
        const n2ok = await until10(pageN, exp => document.querySelectorAll('.fn-flist .fn-fitem').length === exp, 150, n0);
        const n2 = await pageN.evaluate(() => document.querySelectorAll('.fn-flist .fn-fitem').length);
        const q = await pageN.evaluate(() => (document.querySelector('.fn-side-search') || {}).value || '');
        const ok = typed && n1ok && n1 === 1 && n1 < n0 && n2ok && n2 === n0;
        await pushCheck(pageN, 'C2f',
            'input ricerca "fotosintesi" riduce le voci della lista Fonti; rimozione termine -> lista torna al conteggio iniziale',
            ok, 'termineInserito=' + typed + ' count prima=' + n0 + ' conTermine=' + n1 + ' dopoCancella=' + n2 +
                ' (valore input="' + q + '")',
            { n0, n1, n2, typed });
    }

    /* ============================================================
       PAGINA 2 — qa_ui/schemi.html (C2d, C2e)
       ============================================================ */
    const pageS = await browser.newPage();
    await pageS.setViewport({ width: VW, height: VH });
    const logsS = attachLogs(pageS);
    await pageS.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href, { waitUntil: 'load', timeout: 20000 });
    if (!(await waitHarness(pageS, logsS, 'schemi'))) {
        const er = await pageS.evaluate(() => window.__QA ? window.__QA.errors : ['__QA assente']);
        console.error('BLOCKED — harness schemi non pronto: ' + JSON.stringify(er));
        process.exit(2);
    }
    /* seed study item (per la select "oltre gli item study") + bridge materiali */
    await pageS.evaluate(() => {
        window.__QA.store.items.push({
            id: 'riass1', kind: 'riassunto', title: 'Riassunto QA schemi',
            content: JSON.stringify({ riassunto: 'Riassunto di prova per il pannello Fonti degli schemi (item study).' }),
            materia: 'STORIA', tags: '', description: '', thumbnail: '', folder_id: ''
        });
    });
    await seedBridge(pageS, MATS, DB);

    /* apri tab Fonti */
    const tabC = await centerByText(pageS, '.sc-side .sc-tab', 'Fonti');
    if (tabC) await pageS.mouse.click(tabC.x, tabC.y);
    const tabOk = await until10(pageS, () => {
        const side = document.querySelector('.sc-side');
        if (!side) return false;
        const tab = [].slice.call(side.querySelectorAll('.sc-tab')).filter(t => (t.textContent || '').trim() === 'Fonti')[0];
        const prev = side.querySelector('.sc-preview');
        const sel = prev ? prev.parentNode.querySelector('select') : null;
        return !!(tab && tab.classList.contains('active') && sel && sel.options.length >= 5);
    }, 150);

    /* ============ C2d: select con voci materiali + preview con tratto identico + metadati ============ */
    let side = await facts(pageS, FN_SCH_SIDE);
    let pCorto = { __fail: 'non eseguito' }, pFoto = { __fail: 'non eseguito' };
    const setMat = async (p) => {
        await pageS.evaluate(pathArg => {
            const prev = document.querySelector('.sc-preview');
            const sel = prev.parentNode.querySelector('select');
            sel.value = 'mat:' + pathArg;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, p);
    };
    if (tabOk && pickCortoMid) {
        await setMat(F.corto.path);
        const okC = await until10(pageS, sub =>
            ((document.querySelector('.sc-preview') || {}).textContent || '').indexOf(sub) >= 0, 150, pickCortoMid.sub);
        pCorto = await facts(pageS, FN_SCH_PREV, {
            path: F.corto.path, indexed: '2026-10-17', name: F.corto.name,
            sizeStr: fmtBytes(F.corto.size), sub: pickCortoMid.sub, full: F.corto.text
        });
        pCorto.__pre = { okC };
    }
    if (tabOk && pickFotoCap) {
        await setMat(F.foto.path);
        const okF = await until10(pageS, sub =>
            ((document.querySelector('.sc-preview') || {}).textContent || '').indexOf(sub) >= 0, 150, pickFotoCap.sub);
        pFoto = await facts(pageS, FN_SCH_PREV, {
            path: F.foto.path, indexed: '2026-10-16', name: F.foto.name,
            sizeStr: fmtBytes(F.foto.size), sub: pickFotoCap.sub, full: null
        });
        pFoto.__pre = { okF };
        await shot(pageS, 'qaC2_schemi_fonti');
    }
    side = await facts(pageS, FN_SCH_SIDE); // riesume dopo le selezioni
    {
        const prevOk = f => !f.__fail && !f.__err && !f.absent &&
            f.rect && f.rect.w > 0 && f.rect.h > 0 &&
            f.display !== 'none' && f.visibility !== 'hidden' && f.metaAll && f.subOk === true;
        const sideOk = !side.__fail && !side.__err && !side.absent &&
            side.rect.w > 0 && side.rect.h > 0 && !side.hiddenClass &&
            side.display !== 'none' && side.fontiActive && side.bodyDisplay !== 'none';
        const matLabelOk = side.matOpts >= 1 && (side.matLabels || []).every(l => /\((Materiale|Libro)\)/.test(l));
        const ok = tabOk && sideOk && side.matOpts >= 1 && side.studyOpts >= 1 && matLabelOk &&
            prevOk(pCorto) && prevOk(pFoto);
        const ev = 'tabFontiAttivo=' + tabOk +
            ' select: tot=' + side.optTotal + ' study=' + side.studyOpts + ' mat=' + side.matOpts +
            ' matLabels=' + JSON.stringify(side.matLabels) + ' studyLabels=' + JSON.stringify(side.studyLabels) +
            ' side rect=' + (side.rect ? side.rect.w + 'x' + side.rect.h : 'n/a') + ' hidden=' + side.hiddenClass + ' display=' + side.display +
            ' || CORTO: match=' + pCorto.subOk + '@' + (pCorto.subIdx == null ? -1 : pCorto.subIdx) +
            ' sub="' + (pickCortoMid ? pickCortoMid.sub : 'null') + '" fullFile=' + pCorto.fullOk +
            ' metaAll=' + pCorto.metaAll + ' rect=' + (pCorto.rect ? pCorto.rect.w + 'x' + pCorto.rect.h : 'n/a') +
            ' || FOTO: match=' + pFoto.subOk + '@' + (pFoto.subIdx == null ? -1 : pFoto.subIdx) +
            ' sub="' + (pickFotoCap ? pickFotoCap.sub : 'null') + '" metaAll=' + pFoto.metaAll +
            ' rect=' + (pFoto.rect ? pFoto.rect.w + 'x' + pFoto.rect.h : 'n/a') +
            ' meta=' + JSON.stringify(pFoto.meta || {});
        await pushCheck(pageS, 'C2d',
            'tab Fonti schemi: select con >=1 voce materiale (label Materiale/Libro a path) oltre agli item study; selezione -> .sc-preview rect>0 con tratto IDENTICO al file reale + metadati',
            ok, ev,
            { tabOk, side, corto: pCorto, foto: pFoto, picks: { cortoMid: pickCortoMid, fotoCap: pickFotoCap } });
    }

    /* ============ C2e: inserimento dal pannello schemi (verifica cosa esiste) ============ */
    {
        const ins = await pageS.evaluate(() => {
            const side = document.querySelector('.sc-side');
            if (!side) return { absent: true };
            const btns = [].slice.call(side.querySelectorAll('button'))
                .filter(b => /inserisci/i.test(b.textContent || ''));
            const prev = side.querySelector('.sc-preview');
            return {
                insertButtons: btns.length,
                labels: btns.map(b => (b.textContent || '').trim()),
                previewTextLen: prev ? (prev.textContent || '').length : -1,
                hasPreviewFileText: !!(prev && /Percorso: /.test(prev.textContent))
            };
        });
        /* Il pannello Fonti di schemi.js NON prevede inserimento: buildSide
           schemi.js:2216-2226 bodyF = solo select + .sc-preview (nessun
           pulsante "Inserisci"): C2e = verifica preview (gia' provata in C2d). */
        const ok = !ins.__fail && !ins.absent && ins.insertButtons === 0 && ins.hasPreviewFileText === true;
        await pushCheck(pageS, 'C2e',
            'pannello Fonti schemi: verificata la presenza/assenza del pulsante inserimento; se assente -> C2e = sola preview (dichiarato), che deve contenere il materiale selezionato',
            ok, 'pulsantiInserisciInSide=' + ins.insertButtons +
                (ins.insertButtons ? ' labels=' + JSON.stringify(ins.labels) + ' (inaspettati: da investigare)' : ' (assenti come da buildSide schemi.js:2216-2226 -> C2e=solo preview, DICHIARATO)') +
                ' previewTextLen=' + ins.previewTextLen + ' previewConPercorsoFile=' + ins.hasPreviewFileText,
            { insertButtons: ins.insertButtons, previewTextLen: ins.previewTextLen });
    }

    /* ============ C2g: zero errori (entrambe le pagine) ============ */
    {
        const errN = await pageN.evaluate(() => window.__QA.errors);
        const errS = await pageS.evaluate(() => window.__QA.errors);
        const ok = errN.length === 0 && errS.length === 0 && logsN.length === 0 && logsS.length === 0;
        await pushCheck(pageS, 'C2g',
            'zero QA.errors / pageerror / console.error durante il giro C2 (notes + schemi)',
            ok, 'notes: QA.errors=' + JSON.stringify(errN.slice(0, 4)) + ' logs=' + JSON.stringify(logsN.slice(0, 4)) +
                ' | schemi: QA.errors=' + JSON.stringify(errS.slice(0, 4)) + ' logs=' + JSON.stringify(logsS.slice(0, 4)),
            { notesErrors: errN.length, notesLogs: logsN.length, schemiErrors: errS.length, schemiLogs: logsS.length });
    }

    /* ---------- meccanismo bridge usato (dichiarazione) ---------- */
    const mech = await pageN.evaluate(() => window.__qaMech || {});
    const qaN = await pageN.evaluate(() => ({ checks: window.__QA.checks.length, errors: window.__QA.errors }));
    const qaS = await pageS.evaluate(() => ({ checks: window.__QA.checks.length, errors: window.__QA.errors }));
    await pageN.close();
    await pageS.close();
    await browser.close();

    /* ---------- misure + report ---------- */
    const measures = {
        build: 'BUILD ' + BUILD_TS,
        viewport: VW + 'x' + VH,
        generatedAt: new Date().toISOString(),
        stub: {
            declared: 'STUB UNICO: window.pywebview.api.read_material_text (ponte backend) + StudyStore.listMaterials (patch runtime). ' +
                'Il testo restituito e\' letto da fs.readFileSync sul file .md REALE dello stesso path (name/size da fs.statSync). ' +
                'NESSUNA geometria stubbata: rect/DOM reali del browser.',
            mechanismByPath: mech
        },
        files: {
            fotosintesi: { path: F.foto.path, chars: F.foto.text.length, bytes: F.foto.size, sha256_16: F.foto.sha256 },
            lungo: { path: F.lungo.path, chars: F.lungo.text.length, bytes: F.lungo.size, sha256_16: F.lungo.sha256 },
            corto: { path: F.corto.path, chars: F.corto.text.length, bytes: F.corto.size, sha256_16: F.corto.sha256 }
        },
        picks: {
            cortoMid: pickCortoMid, fotoCap: pickFotoCap,
            lungoCapEnd: pickLungoCapEnd, lungoMid: pickLungoMid, lungoTail: pickLungoTail
        },
        cap: CAP,
        C: MEAS.C,
        checks: RESULTS,
        console: { notes: { logs: logsN }, schemi: { logs: logsS } },
        harness: { notes: qaN, schemi: qaS }
    };
    fs.writeFileSync(path.join(QA_DIR, 'qaC2_measures.json'), JSON.stringify(measures, null, 1));

    const pass = RESULTS.filter(r => r.ok).length;
    console.log('\n===== QA-C2 TOTALE: ' + RESULTS.length + ' check, ' + pass + ' PASS, ' + (RESULTS.length - pass) + ' FAIL =====');
    console.log('Misure -> qa/qaC2_measures.json');
    RESULTS.forEach(r => console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.id));
    if (pass !== RESULTS.length) process.exitCode = 1;
})().catch(e => { console.error('RUNNER FATAL:', e); process.exit(1); });
