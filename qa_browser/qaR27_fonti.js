'use strict';
/* qa_browser/qaR27_fonti.js - R27 QA-REAL (T2): pannello Fonti su PAGINA
   REALE servita con la stessa catena ?v= del BUILD, seed dagli item REALI
   del SQLite (study_list replica il backend: solo preview[180], niente
   content -> esercita il fix fullContent sul serio).

   Q1 toggle (bottone Fonti apri/chiudi + Esc)
   Q2 collasso chip+lista -> preview espansa, altezze misurate (±2px)
   Q3 persistenza reload: Appunti + Documenti + Schemi(tab)
   Q4 toolbar cliccabile con pannello aperto + resize drag
   Q6 matrice adattatori per tipo REALE + caso vuoto creato ad hoc
   Q7 math fotosintesi: zero nodi katex-error/grezzi
   Q8 screenshot tre mount (Appunti/Documenti/Schemi)

   Output: qa/r27_*.png, qa/r27_measures.json, qa/r27_results.json
   Esecuzione: node qa_browser/qaR27_fonti.js */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8887;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(c, n, x) {
    if (c) { pass++; console.log('  PASS  ' + n); }
    else { fail++; failures.push(n + (x ? ' | ' + x : '')); console.log('  FAIL  ' + n + (x ? ' | ' + x : '')); }
}
const checks = [];
function rec(id, c, expected, evidence) {
    checks.push({ id, ok: !!c, expected: String(expected), evidence: String(evidence).slice(0, 400) });
    ok(c, id, evidence);
}

/* ---------- seed reale ---------- */
console.log('[seed] dump dal SQLite reale...');
const dump = spawnSync('python', [path.join(QA_DIR, '_r27_dump.py')], {
    cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
});
if (!fs.existsSync(path.join(QA_DIR, 'r27_seed.json'))) {
    console.error('SEED MANCANTE:\n' + (dump.stderr || dump.stdout || ''));
    process.exit(1);
}
const SEED = JSON.parse(fs.readFileSync(path.join(QA_DIR, 'r27_seed.json'), 'utf8'));
const M = SEED.meta;
console.log('[seed] items=' + M.items_total, 'chat=' + M.conversations,
    'msgs=' + M.messages_total, 'mat=' + M.materials, 'books=' + M.books_count);

/* ---------- server statico (stessa catena ?v= del BUILD) ---------- */
function staticServer() {
    const srv = http.createServer((req, res) => {
        try {
            const u = decodeURIComponent((req.url || '/').split('?')[0]);
            if (u === '/favicon.ico') { res.writeHead(204); res.end(); return; }
            if (u === '/seed.json') {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(fs.readFileSync(path.join(QA_DIR, 'r27_seed.json')));
                return;
            }
            let p = path.join(APP_DIR, u === '/' ? '/index.html' : u);
            if (!p.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
            const ext = path.extname(p).toLowerCase();
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(fs.readFileSync(p));
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

/* ---------- mock pywebview FEDELE al backend ---------- */
function installMock() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/seed.json', false);
    xhr.send(null);
    const SEED = JSON.parse(xhr.responseText);
    const items = new Map();
    SEED.items.forEach(i => items.set(i.id, i));
    window.__r27 = { saves: 0, logs: [] };
    const impl = {
        /* study_list del backend: preview[180], MAI content (root cause) */
        study_list(kind) {
            /* sorgente = la MAPPA viva (study_save ci scrive): identico al
               backend dove study_list rilegge il DB dopo ogni salvataggio */
            let out = Array.from(items.values());
            if (kind) out = out.filter(i => i.kind === kind);
            return Promise.resolve(out.map(i => {
                const c = {};
                Object.keys(i).forEach(k => { if (k !== 'content') c[k] = i[k]; });
                c.preview = String(i.content || '').replace(/\n/g, ' ').slice(0, 180);
                delete c.content;
                return c;
            }));
        },
        study_get(id) {
            const i = items.get(id);
            return Promise.resolve(i ? JSON.parse(JSON.stringify(i)) : null);
        },
        study_save(p) {
            let id = p.id;
            if (!id) { window.__r27.saves++; id = 'qa_save_' + window.__r27.saves + '_' + Date.now(); }
            const prev = items.get(id) || { id: id, created_at: new Date().toISOString() };
            const it = Object.assign({}, prev, p, {
                id: id, updated_at: new Date().toISOString(),
                content: p.content != null ? p.content : (prev.content || '')
            });
            items.set(id, it);
            return Promise.resolve({ item: JSON.parse(JSON.stringify(it)) });
        },
        study_delete(id) { items.delete(id); return Promise.resolve({ success: true }); },
        study_rename(id, title) {
            const i = items.get(id);
            if (i) { i.title = title; i.updated_at = new Date().toISOString(); }
            return Promise.resolve({ success: true });
        },
        study_duplicate(id) {
            const i = items.get(id); if (!i) return Promise.resolve({ success: false });
            const c = JSON.parse(JSON.stringify(i));
            c.id = 'qa_dup_' + Date.now(); c.title = i.title + ' (copia)';
            items.set(c.id, c);
            return Promise.resolve({ success: true, item: c });
        },
        subjects_list: () => Promise.resolve([]),
        subjects_save: (p) => Promise.resolve({ subject: p }),
        subjects_delete: () => Promise.resolve({ success: true }),
        events_list: () => Promise.resolve([]),
        events_save: (p) => Promise.resolve({ event: p }),
        events_delete: () => Promise.resolve({ success: true }),
        folders_list: () => Promise.resolve([]),
        folders_save: (p) => Promise.resolve({ folder: Object.assign({ id: 'f' + Date.now() }, p) }),
        folders_delete: () => Promise.resolve({ success: true }),
        get_conversations: () => Promise.resolve(SEED.conversations),
        get_messages: (id) => Promise.resolve(SEED.messages[String(id)] || []),
        chat_meta_save: () => Promise.resolve(null),
        delete_conversation: () => Promise.resolve({ success: true }),
        materials_list: () => Promise.resolve(SEED.materials),
        read_material_text: (p) => Promise.resolve(
            SEED.matText[p] || { success: false, error: 'non in seed' }),
        read_material_preview: (p) => Promise.resolve(
            SEED.matPreview[p] || { success: false, error: 'non in seed' }),
        study_open_file: () => Promise.resolve({ success: true }),
        list_models: () => Promise.resolve([]),
        get_model_status: () => Promise.resolve({ state: 'ready', progress: 1 }),
        app_settings_get: () => Promise.resolve({}),
        app_settings_set: () => Promise.resolve({ ok: true }),
        get_settings: () => Promise.resolve({}),
        save_settings: () => Promise.resolve({ ok: true }),
        study_pick_asset: () => Promise.resolve(null),
        pick_notes_file: () => Promise.resolve(null),
        pick_library_pdf_file: () => Promise.resolve(null),
        asset_url: (p) => p || ''
    };
    window.pywebview = {
        api: new Proxy(impl, {
            get(t, k) {
                if (k in t) return t[k];
                return () => Promise.resolve(null);
            }
        })
    };
}

/* ---------- helper pagina ---------- */
async function bootHome(page) {
    await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
    let ready = false;
    for (let i = 0; i < 80; i++) {
        ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' &&
            document.getElementById('homeView') &&
            !document.getElementById('homeView').classList.contains('hidden')));
        if (ready) break;
        await sleep(250);
    }
    if (!ready) throw new Error('home non pronta');
}
async function goModule(page, mod, params) {
    await page.evaluate((m, p) => App.go(m, p || {}), mod, params || {});
    await sleep(500);
}
/* .doc-canvas/.doc-page esistono SOLO nell'editor di documenti: anche la
   LISTA ha una sua .doc-bar/.doc-shell e il sentinella "doc-bar" apriva
   l'occhio sulla vista elenco (falso positivo) */
const EDITOR_SELS = ['.fn-pill-left', '.doc-canvas', '.sc-side', '.fg-top', '.pp-bar'];
let lastApri = { n: 0 };
/* visibile = rect>0: App.go nasconde i moduli precedenti SENZA rimuoverli
   dal DOM -> un querySelector "nudo" darebbe falso positivo e aprirebbe
   il bottone sbagliato (o nessuno) */
async function editorOpen(page) {
    return page.evaluate(sels => sels.some(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }), EDITOR_SELS);
}
/* apre il PRIMO editor reale: prova i vari "Apri*" della lista finche'
   non compare il chrome di un editor (evita di beccare bottoni tipo
   "Apri cartella"/menu che non aprono l'editor) */
async function openFirstApri(page) {
    /* "Apri" = testo (notes/schemi) OPPURE title (documenti: icone senza
       textContent, title="Apri il documento"); solo bottoni VISIBILI
       (i moduli precedenti restano nel DOM nascosti) */
    let idxs = [];
    for (let t = 0; t < 20 && !idxs.length; t++) {
        idxs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#moduleView button'))
                .map((x, i) => {
                    const label = ((x.textContent || '').trim()) ||
                        (x.getAttribute('title') || '');
                    const r = x.getBoundingClientRect();
                    return (/^\s*Apri/.test(label) && r.width > 0) ? i : -1;
                })
                .filter(i => i >= 0));
        if (!idxs.length) await sleep(300);
    }
    lastApri = { n: idxs.length };
    for (const i of idxs.slice(0, 6)) {
        await page.evaluate(n => {
            const l = Array.from(document.querySelectorAll('#moduleView button')).filter(x => {
                const label = ((x.textContent || '').trim()) ||
                    (x.getAttribute('title') || '');
                return /^\s*Apri/.test(label) && x.getBoundingClientRect().width > 0;
            });
            if (l[n]) l[n].click();
        }, i);
        for (let t = 0; t < 16; t++) {
            if (await editorOpen(page)) return true;
            await sleep(250);
        }
        // eventuale dialogo aperto dal candidato sbagliato: lo chiude e
        // passa al bottone successivo
        await page.evaluate(() => {
            document.querySelectorAll('.modal-overlay').forEach(o => {
                if (o.parentNode) o.parentNode.removeChild(o);
            });
        });
    }
    /* fallback: apertura cliccando la CARD del primo elemento (le azioni
       "Apri" di alcuni moduli vivono in overlay hover; la card ha
       click -> openEditor) */
    const cardSel = await page.evaluate(() => {
        const sels = ['.dc-card', '.pp-card', '.vl-card', '.nt-card'];
        for (const s of sels) {
            const c = document.querySelector(s);
            if (c && c.getBoundingClientRect().width > 0) { c.click(); return s; }
        }
        return '';
    });
    if (cardSel) {
        for (let t = 0; t < 16; t++) {
            if (await editorOpen(page)) return true;
            await sleep(250);
        }
    }
    return await editorOpen(page);
}
async function waitEditor(page, sel, extra) {
    for (let i = 0; i < 80; i++) {
        const okk = await page.evaluate((s, e) => {
            const el = document.querySelector(s);
            if (!el) return false;
            if (e && !document.querySelector(e)) return false;
            return true;
        }, sel, extra || null);
        if (okk) return true;
        await sleep(250);
    }
    return false;
}
function panelState(page, ctx) {
    return page.evaluate(c => {
        const p = document.querySelector('.fp21-root[data-fp21="' + c + '"]');
        if (!p) return { exists: false, visible: false, collapsed: false, h: 0 };
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        return {
            exists: true,
            visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
            collapsed: p.classList.contains('fp21-collapsed'),
            h: Math.round(r.height)
        };
    }, ctx);
}
async function waitPanel(page, ctx, want, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeout || 6000)) {
        const s = await panelState(page, ctx);
        if (s.visible === want) return s;
        await sleep(200);
    }
    return panelState(page, ctx);
}
/* apre SOLO se chiuso: il pass applicativo (B4) puo' averlo gia' aperto a
   reload - un click cieco lo avrebbe richiuso (toggle) falsando i test */
async function ensurePanelOpen(page, ctx) {
    let st2 = await panelState(page, ctx);
    if (!st2.visible) {
        await clickFonti(page, ctx);
        st2 = await waitPanel(page, ctx, true, 6000);
    }
    return st2.visible;
}
function fontiSel(ctx) {
    if (ctx === 'appunti') return '[data-fonti]';
    if (ctx === 'documenti') return '[title="Apri/chiudi il pannello Fonti"]';
    return null;
}
async function clickFonti(page, ctx) {
    await page.evaluate(s => {
        const b = document.querySelector(s);
        if (b) b.click();
    }, fontiSel(ctx));
}
async function shot(page, name) {
    await page.screenshot({ path: path.join(QA_DIR, name + '.png') });
    console.log('  SHOT qa/' + name + '.png');
}

(async () => {
    const srv = await staticServer();
    const browser = await puppeteer.launch({
        headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + await browser.version());
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });   // stesso viewport di tutti i round
    const consoleErrs = [];
    const pageErrs = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    page.on('pageerror', e => pageErrs.push(String(e.message || e)));
    await page.evaluateOnNewDocument(installMock);

    const measures = {};

    /* ========== F0: catena ?v= del BUILD (pagina reale) ========== */
    await bootHome(page);
    const f0 = await page.evaluate(() => {
        const want = ['fonti_panel.js', 'notes.js', 'documenti.js', 'schemi.js'];
        return want.map(w => {
            const s = Array.from(document.querySelectorAll('script[src]'))
                .find(x => (x.getAttribute('src') || '').indexOf(w) >= 0);
            return s ? s.getAttribute('src') : (w + ':ASSENTE');
        });
    });
    const ts = (fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8')
        .match(/var QA_TS\s*=\s*"([^"]+)"/) || [])[1] || 'MISSING';
    /* catena ?v: tutti i moduli serviti con LO STESSO stamp (coerenza del
       BUILD); il drift stamp vs QA_TS e' una condizione pre-esistente di
       index.html (fuori owner FE-FONTI) e viene solo OSSERVATO */
    const stamps = f0.map(s => (s.match(/[?&]v=([^&]+)/) || [])[1] || '');
    const chainOk = f0.every(s => s.indexOf('ASSENTE') < 0) &&
        stamps.every(s2 => s2 && s2 === stamps[0]);
    rec('F0 catena ?v coerente su index.html reale (stesso stamp su tutti i moduli)',
        chainOk, 'stesso ?v=' + (stamps[0] || '?'),
        JSON.stringify(f0) + (stamps[0] !== ts
            ? ' | OSSERVATO pre-esistente: srcs ?v=' + stamps[0] + ' vs QA_TS=' + ts
            : ' | QA_TS=' + ts));

    /* ========== apre Appunti con la nota reale col tratto ========== */
    await goModule(page, 'notes');
    const apriOk = await openFirstApri(page);
    rec('BOOT editor Appunti (Apri su nota reale)', apriOk, 'editor aperto', String(apriOk));
    const edOk = await waitEditor(page, '.fn-pill-left', '.nt-stage canvas');
    rec('BOOT chrome Appunti (pill+canvas)', edOk, '.fn-pill-left + canvas', String(edOk));
    await shot(page, 'r27_q1_prima');

    /* ========== Q1 toggle ========== */
    let s = await panelState(page, 'appunti');
    if (s.visible) { await clickFonti(page, 'appunti'); await waitPanel(page, 'appunti', false); }
    await clickFonti(page, 'appunti');
    s = await waitPanel(page, 'appunti', true, 6000);
    rec('Q1a bottone Fonti APRE il pannello', s.visible, 'visible=true', JSON.stringify(s));
    await shot(page, 'r27_q1_aperto');
    await clickFonti(page, 'appunti');
    s = await waitPanel(page, 'appunti', false, 6000);
    rec('Q1b bottone Fonti CHIUDE (stato chiuso = non visibile)', !s.visible,
        'visible=false', JSON.stringify(s));
    await shot(page, 'r27_q1_chiuso');
    await clickFonti(page, 'appunti');
    s = await waitPanel(page, 'appunti', true, 6000);
    await page.keyboard.press('Escape');
    s = await waitPanel(page, 'appunti', false, 6000);
    rec('Q1c Esc CHIUDE il pannello aperto', !s.visible, 'visible=false', JSON.stringify(s));
    await shot(page, 'r27_q1_esc');

    /* ========== Q2 collasso + altezze ========== */
    await clickFonti(page, 'appunti');
    s = await waitPanel(page, 'appunti', true, 6000);
    // seleziona la prima sorgente
    await page.evaluate(() => {
        const it = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-item');
        if (it) it.click();
    });
    let prevTitle = '';
    for (let i = 0; i < 40; i++) {
        prevTitle = await page.evaluate(() => {
            const t = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-ptitle');
            const b = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-pbody');
            const txt = t ? (t.textContent || '') : '';
            return (txt && txt.indexOf('Seleziona') < 0 && txt.indexOf('Caricamento') < 0 &&
                b && b.children.length > 0) ? txt : '';
        });
        if (prevTitle) break;
        await sleep(200);
    }
    rec('Q2.0 selezione popola la preview', !!prevTitle, 'preview popolata', prevTitle.slice(0, 80));

    const m0 = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        const cs = getComputedStyle(p);
        const g = el => Math.round(el.getBoundingClientRect().height);
        return {
            root: Math.round(p.getBoundingClientRect().height),
            top: g(p.querySelector('.fp21-top')),
            list: g(p.querySelector('.fp21-list')),
            prev: g(p.querySelector('.fp21-preview')),
            ins: g(p.querySelector('.fp21-insert')),
            padT: parseFloat(cs.paddingTop) || 0,
            padB: parseFloat(cs.paddingBottom) || 0,
            gap: parseFloat(cs.rowGap || cs.gap) || 0,
            styleH: p.style.height
        };
    });
    // collassa
    await page.evaluate(() => {
        const c = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-chev');
        if (c) c.click();
    });
    await sleep(350);
    const m1 = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        const cs = getComputedStyle(p);
        const g = el => Math.round(el.getBoundingClientRect().height);
        const chips = p.querySelector('.fp21-chips');
        const chev = p.querySelector('.fp21-chev svg');
        return {
            root: Math.round(p.getBoundingClientRect().height),
            top: g(p.querySelector('.fp21-top')),
            list: g(p.querySelector('.fp21-list')),
            prev: g(p.querySelector('.fp21-preview')),
            ins: g(p.querySelector('.fp21-insert')),
            chipsDisplay: chips ? getComputedStyle(chips).display : 'none',
            chevRot: chev ? getComputedStyle(chev).transform : 'none',
            collapsed: p.classList.contains('fp21-collapsed'),
            padT: parseFloat(cs.paddingTop) || 0,
            padB: parseFloat(cs.paddingBottom) || 0,
            gap: parseFloat(cs.rowGap || cs.gap) || 0
        };
    });
    measures.q2 = { m0, m1 };
    const expPrev = Math.round(m0.root - m1.padT - m1.padB - m1.top - m1.ins - m1.gap * 2);
    rec('Q2.1 RIGA2 chip nascosti', m1.chipsDisplay === 'none', 'display:none', m1.chipsDisplay);
    rec('Q2.2 RIGA3 lista altezza 0', m1.list === 0, '0px', m1.list + 'px');
    rec('Q2.3 altezza ESTERNA invariata (B3)', Math.abs(m1.root - m0.root) <= 2,
        m0.root + 'px', m1.root + 'px');
    rec('Q2.4 preview = interna - RIGA1 - RIGA5 (±2px)',
        Math.abs(m1.prev - expPrev) <= 2,
        'atteso ' + expPrev + 'px', 'visto ' + m1.prev + 'px');
    rec('Q2.5 chevron ruotato', m1.chevRot !== 'none' && m1.chevRot !== 'matrix(1, 0, 0, 1, 0, 0)',
        'transform != none', m1.chevRot);
    const titleStill = await page.evaluate(() => {
        const t = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-ptitle');
        return t ? (t.textContent || '') : '';
    });
    rec('Q2.6 selezione corrente ancora in preview da collassato',
        titleStill.indexOf(prevTitle.slice(0, 24)) >= 0 || prevTitle.indexOf(titleStill.slice(0, 24)) >= 0,
        titleStill.slice(0, 60), prevTitle.slice(0, 60));
    const insOk = await page.evaluate(() => {
        const b = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-insert');
        if (!b) return { found: false };
        const was = b.disabled;
        b.click();
        return { found: true, wasEnabled: !was };
    });
    rec('Q2.7 "Inserisci nella nota" abilitato e cliccabile',
        insOk.found && insOk.wasEnabled, 'enabled+click', JSON.stringify(insOk));
    await shot(page, 'r27_q2_collapse');
    // espandi
    await page.evaluate(() => {
        const c = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-chev');
        if (c) c.click();
    });
    await sleep(350);
    const m2 = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        const g = el => Math.round(el.getBoundingClientRect().height);
        return {
            root: Math.round(p.getBoundingClientRect().height),
            list: g(p.querySelector('.fp21-list')),
            prev: g(p.querySelector('.fp21-preview')),
            collapsed: p.classList.contains('fp21-collapsed')
        };
    });
    measures.q2.m2 = m2;
    rec('Q2.8 secondo click: lista tornata visibile', m2.list > 0, '>0', m2.list + 'px');
    rec('Q2.9 altezze precedenti ripristinate (root±2/prev±4)',
        Math.abs(m2.root - m0.root) <= 2 && Math.abs(m2.prev - m0.prev) <= 4,
        'root ' + m0.root + '/prev ' + m0.prev, 'root ' + m2.root + '/prev ' + m2.prev);
    await shot(page, 'r27_q2_espanso');

    /* ========== Q3 persistenza reload: Appunti ========== */
    // stato finale: APERTO + COLLASSATO
    await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        if (p && !p.classList.contains('fp21-collapsed')) {
            p.querySelector('.fp21-chev').click();
        }
    });
    await sleep(250);
    const keysBefore = await page.evaluate(() => ({
        open: localStorage.getItem('fp21_open_appunti'),
        top: localStorage.getItem('fp21_top_appunti')
    }));
    rec('Q3.0 chiavi di stato Appunti prima del reload',
        keysBefore.open === '1' && keysBefore.top === '1',
        'open=1 top=1', JSON.stringify(keysBefore));
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await bootHome(page);   // home visibile
    await goModule(page, 'notes');
    await openFirstApri(page);
    await waitEditor(page, '.fn-pill-left', '.nt-stage canvas');
    s = await waitPanel(page, 'appunti', true, 9000);   // pass applicativi (350ms+1400ms)
    const collapsedAfter = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        return p ? p.classList.contains('fp21-collapsed') : false;
    });
    rec('Q3.1 Appunti: dopo reload pannello APERTO (auto-ripreso)',
        s.visible, 'visible=true', JSON.stringify(s));
    rec('Q3.2 Appunti: dopo reload COLLASSATO (fp21_top)',
        collapsedAfter, 'collapsed=true', String(collapsedAfter));
    await shot(page, 'r27_q3_appunti_reload');

    /* ========== Q3 reload: Documenti ========== */
    /* i sub-tool (documenti/fogli/video/presentazioni) non sono route
       top-level: esistono SOLO come params.tool del modulo produttivita
       (App.go('documenti') finiva sulla home -> lista vuota) */
    await goModule(page, 'produttivita', { tool: 'documenti' });
    const docEd = await openFirstApri(page);
    rec('Q3.3a editor Documenti reale aperto', docEd,
        '.doc-canvas presente (editor, non la lista)',
        'docEd=' + docEd + ' bottoni_Apri_in_lista=' + lastApri.n);
    await waitEditor(page, '.doc-canvas');
    // prima visita: apre a mano (registra open=1)
    await clickFonti(page, 'documenti');
    s = await waitPanel(page, 'documenti', true, 6000);
    const docBtn = await page.evaluate(() => ({
        docBar: !!document.querySelector('.doc-bar'),
        btn: !!document.querySelector('[title="Apri/chiudi il pannello Fonti"]'),
        fp: !!(window.FontiPanel && window.FontiPanel.create),
        nBtn: document.querySelectorAll('.doc-bar button').length,
        titles: Array.from(document.querySelectorAll('.doc-bar button'))
            .map(b => (b.getAttribute('title') || b.textContent || '?').slice(0, 30)),
        anyFonti: document.querySelectorAll('[title*="Fonti"]').length
    }));
    rec('Q3.3 Documenti: bottone Fonti apre', s.visible, 'visible',
        JSON.stringify(s) + ' | ' + JSON.stringify(docBtn));
    await shot(page, 'r27_q8_documenti_aperto');
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await bootHome(page);
    await goModule(page, 'produttivita', { tool: 'documenti' });
    await openFirstApri(page);
    await waitEditor(page, '.doc-canvas');
    s = await waitPanel(page, 'documenti', true, 9000);
    rec('Q3.4 Documenti: dopo reload pannello auto-aperto (B4)',
        s.visible, 'visible=true', JSON.stringify(s));
    await shot(page, 'r27_q3_documenti_reload');

    /* ========== Q3 reload: Schemi tab ========== */
    await goModule(page, 'schemi');
    await openFirstApri(page);
    await waitEditor(page, '.sc-side');
    // tab Fonti
    await page.evaluate(() => {
        const t = Array.from(document.querySelectorAll('.sc-side .sc-tab'))
            .find(x => (x.textContent || '').trim() === 'Fonti');
        if (t) t.click();
    });
    s = await waitPanel(page, 'schemi', true, 6000);
    rec('Q3.5 Schemi: tab Fonti mostra il pannello', s.visible, 'visible', JSON.stringify(s));
    // collassa dentro la tab
    await page.evaluate(() => {
        const c = document.querySelector('.fp21-root[data-fp21="schemi"] .fp21-chev');
        if (c) c.click();
    });
    await sleep(300);
    const schemiKeys = await page.evaluate(() => ({
        open: localStorage.getItem('fp21_open_schemi'),
        top: localStorage.getItem('fp21_top_schemi')
    }));
    rec('Q3.6 Schemi: chiavi tab+collasso registrate',
        schemiKeys.open === '1' && schemiKeys.top === '1',
        'open=1 top=1', JSON.stringify(schemiKeys));
    await shot(page, 'r27_q8_schemi_antes');
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await bootHome(page);
    await goModule(page, 'schemi');
    await openFirstApri(page);
    await waitEditor(page, '.sc-side');
    s = await waitPanel(page, 'schemi', true, 9000);
    const schemiCol = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="schemi"]');
        const tab = Array.from(document.querySelectorAll('.sc-side .sc-tab'))
            .find(x => (x.textContent || '').trim() === 'Fonti');
        return {
            collapsed: p ? p.classList.contains('fp21-collapsed') : false,
            tabActive: tab ? tab.classList.contains('active') : false
        };
    });
    rec('Q3.7 Schemi: dopo reload tab Fonti attivo + pannello aperto',
        s.visible, 'visible=true', JSON.stringify(s));
    rec('Q3.8 Schemi: collasso ripristinato dentro la tab',
        schemiCol.collapsed && schemiCol.tabActive, 'collapsed+tabActive',
        JSON.stringify(schemiCol));
    await shot(page, 'r27_q3_schemi_reload');

    /* ========== Q4 toolbar cliccabile + resize (Appunti) ========== */
    await goModule(page, 'notes');
    await openFirstApri(page);
    await waitEditor(page, '.fn-pill-left', '.nt-stage canvas');
    await ensurePanelOpen(page, 'appunti');
    s = await panelState(page, 'appunti');
    const q4 = await page.evaluate(() => {
        const sel = '.fn-pill-left button, .fn-pill-right button, .fn-zoom button';
        const btns = Array.from(document.querySelectorAll(sel)).filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        let hit = 0;
        const miss = [];
        btns.forEach(b => {
            const r = b.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (el && (el === b || b.contains(el) || el.contains(b))) hit++;
            else miss.push((b.title || b.getAttribute('aria-label') || b.textContent || '?').slice(0, 30));
        });
        return { total: btns.length, hit, miss };
    });
    rec('Q4.1 toolbar cliccabile con pannello aperto (elementFromPoint)',
        q4.total > 0 && q4.hit === q4.total, q4.total + '/' + q4.total,
        q4.hit + '/' + q4.total + (q4.miss.length ? ' miss=' + JSON.stringify(q4.miss) : ''));
    await shot(page, 'r27_q4_toolbar');
    // resize drag sul bordo destro
    const rs = await page.evaluate(() => {
        const p = document.querySelector('.fp21-root[data-fp21="appunti"]');
        const hz = p.querySelector('.fp21-rz-r');
        const r = hz.getBoundingClientRect();
        return { w: p.getBoundingClientRect().width, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(rs.x, rs.y);
    await page.mouse.down();
    await page.mouse.move(rs.x + 60, rs.y, { steps: 6 });
    await page.mouse.up();
    await sleep(200);
    const wAfter = await page.evaluate(() =>
        Math.round(document.querySelector('.fp21-root[data-fp21="appunti"]').getBoundingClientRect().width));
    rec('Q4.2 resize drag larghezza OK', wAfter >= rs.w + 50,
        rs.w + ' +60', wAfter + '');
    // ripristina misura: dblclick sull'handle (dispatch diretto = identico
    // all'handler hDown(detail>=2)/dblclick del componente)
    await page.evaluate(() => {
        const h = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-rz-r');
        if (h) {
            h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, detail: 2 }));
            h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }
    });
    await sleep(250);
    const wReset = await page.evaluate(() =>
        Math.round(document.querySelector('.fp21-root[data-fp21="appunti"]').getBoundingClientRect().width));
    measures.q4 = { total: q4.total, hit: q4.hit, w0: rs.w, wAfter, wReset };
    rec('Q4.3 doppio click = reset size', Math.abs(wReset - 340) <= 2 || wReset < wAfter,
        'reset', wReset + '');

    /* ========== Q6 matrice adattatori per tipo REALE ========== */
    const errBeforeMatrix = consoleErrs.filter(t => t.indexOf('[fp21]') >= 0).length;
    async function pickChip(label) {
        await page.evaluate(l => {
            const c = Array.from(document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-chip'))
                .find(x => (x.textContent || '').trim() === l);
            if (c) c.click();
        }, label);
        await sleep(250);
    }
    async function pickRow(title) {
        return page.evaluate(t => {
            const rows = Array.from(document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-item'));
            const r = rows.find(x => (x.textContent || '').indexOf(t) >= 0);
            if (r) r.click();
            return !!r;
        }, title);
    }
    async function previewHtml() {
        for (let i = 0; i < 40; i++) {
            const h = await page.evaluate(() => {
                const b = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-pbody');
                const t = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-ptitle');
                const txt = t ? (t.textContent || '') : '';
                return { html: b ? b.innerHTML : '', title: txt,
                    loading: txt.indexOf('Caricamento') >= 0 };
            });
            if (!h.loading && h.html) return h;
            await sleep(200);
        }
        return { html: '', title: '', loading: false };
    }
    const matrix = [];

    // --- Appunti/manoscritto ---
    await pickChip('Appunti');
    let found = await pickRow(M.ink_note.title);
    let pv = await previewHtml();
    let c1 = found && /fp21-snap/.test(pv.html) && pv.html.indexOf('Nessun testo disponibile') < 0;
    rec('Q6.1 Appunti(manoscritto) -> <img> snapshot', c1,
        'img.fp21-snap + nessun vuoto',
        'row=' + found + ' snap=' + (/fp21-snap/.test(pv.html)) + ' title=' + pv.title.slice(0, 40));
    matrix.push({ tipo: 'Appunti (manoscritto)', atteso: '<img> snapshot + testo', ok: c1, visto: pv.title.slice(0, 60) });
    await shot(page, 'r27_q6_appunti');

    // --- Documenti ---
    await pickChip('Documenti');
    found = await pickRow(M.documento.title);
    pv = await previewHtml();
    const docHasHtml = /<table|<blockquote|h1|h2|h3|<p>/.test(pv.html) && pv.html.indexOf('{"html') < 0;
    rec('Q6.2 Documenti -> html renderizzato (mai JSON grezzo)',
        found && docHasHtml, 'html renderizzato', 'row=' + found + ' ' + pv.html.slice(0, 100));
    matrix.push({ tipo: 'Documenti', atteso: 'html renderizzato', ok: found && docHasHtml, visto: pv.title.slice(0, 60) });
    await shot(page, 'r27_q6_documenti');

    // --- Presentazioni ---
    await pickChip('Presentazioni');
    found = await pickRow(M.presentazione.title);
    pv = await previewHtml();
    const presOk = found && /fp21-slide/.test(pv.html) && pv.html.indexOf('Nuovo testo') >= 0;
    rec('Q6.3 Presentazioni -> outline slide', presOk, 'card slide + bullet',
        'row=' + found + ' ' + pv.html.slice(0, 100));
    matrix.push({ tipo: 'Presentazioni', atteso: 'outline slide', ok: presOk, visto: pv.title.slice(0, 60) });
    await shot(page, 'r27_q6_presentazioni');

    // --- Fogli ---
    await pickChip('Fogli');
    found = await pickRow(M.foglio.title);
    pv = await previewHtml();
    const fogOk = found && /fp21-grid/.test(pv.html) && pv.html.indexOf('bfg') >= 0 &&
        /fp21-num/.test(pv.html) && pv.html.indexOf('Foglio non leggibile') < 0;
    rec('Q6.4 Fogli -> tabella ( celle + num a destra, no "non leggibile")',
        fogOk, 'table + bfg + fp21-num', 'row=' + found + ' ' + pv.html.slice(0, 120));
    matrix.push({ tipo: 'Fogli', atteso: 'tabella HTML griglia', ok: fogOk, visto: pv.title.slice(0, 60) });
    await shot(page, 'r27_q6_fogli');

    // --- Video ---
    await pickChip('Video');
    found = await pickRow(M.video.title);
    pv = await previewHtml();
    const vidOk = found && /Progetto video/.test(pv.html) &&
        pv.html.indexOf('non leggibile') < 0;
    rec('Q6.5 Video -> meta progetto (durata + clip)',
        vidOk, 'meta Progetto video', 'row=' + found + ' clips=' + M.video_clips +
        ' ' + pv.html.slice(0, 100));
    matrix.push({ tipo: 'Video', atteso: 'meta+elenco clip', ok: vidOk, visto: pv.title.slice(0, 60) + ' clips=' + M.video_clips });
    await shot(page, 'r27_q6_video');

    // --- Chat ---
    await pickChip('Chat');
    const chatTitle = M.chat_with_msgs ? M.chat_with_msgs.title : '';
    found = await pickRow(chatTitle);
    pv = await previewHtml();
    const chatOk = found && (pv.html.match(/fp21-bub/g) || []).length >= 2;
    rec('Q6.6 Chat -> transcript bolle (ruolo utente/assistente)',
        chatOk, '>=2 bolle', 'row=' + found + ' bub=' + (pv.html.match(/fp21-bub/g) || []).length);
    matrix.push({ tipo: 'Chat', atteso: 'transcript turni', ok: chatOk, visto: pv.title.slice(0, 60) });
    await shot(page, 'r27_q6_chat');

    // --- Materiali (md = riferimento) ---
    await pickChip('Materiali');
    found = await pickRow(M.fotosintesi.name);
    pv = await previewHtml();
    const matOk = found && /<h1|<h2/.test(pv.html) &&
        pv.html.indexOf('Nessun testo') < 0 && pv.html.indexOf('non leggibile') < 0;
    rec('Q6.7 Materiali(md) -> render completo con heading', matOk,
        'h1/h2 + nessun vuoto', 'row=' + found + ' ' + pv.html.slice(0, 100));
    matrix.push({ tipo: 'Materiali (md)', atteso: 'render completo (heading)', ok: matOk, visto: pv.title.slice(0, 60) });
    await shot(page, 'r27_q6_materiali');

    // --- Libri (cartella libri reale: vuota -> PARZIALE dichiarato) ---
    await pickChip('Libri');
    const libriState = await page.evaluate(() => ({
        rows: document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-item').length,
        hint: (document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-hint') || {}).textContent || ''
    }));
    const libriOk = M.books_count > 0;   // sorgente reale presente?
    rec('Q6.8 Libri -> testo con capitoli' + (libriOk ? '' : ' (PARZIALE: nessun libro reale)'),
        libriOk ? false : libriState.hint.indexOf('Nessuna fonte') >= 0,   // se vuoto: solo hint di lista, nessun crash
        M.books_count + ' libri in ' + M.books_dir,
        'rows=' + libriState.rows + ' hint=' + libriState.hint.slice(0, 60) +
        ' books_count=' + M.books_count);
    matrix.push({
        tipo: 'Libri', atteso: 'testo con capitoli (md)',
        ok: libriOk, visto: libriOk ? 'libro reale' : 'PARZIALE: preselected_books vuota (0 file) - cella non verificabile su sorgente reale'
    });
    await shot(page, 'r27_q6_libri');

    // --- B7.8: nessun log [fp21] di "vuoto" durante la matrice (sorgenti piene) ---
    const fp21ErrsMatrix = consoleErrs.filter(t => t.indexOf('[fp21]') >= 0);
    const badErrs = fp21ErrsMatrix.filter(t =>
        /preview vuota|non leggibile/.test(t));
    rec('Q6.9 B7.8 zero log di vuoto su sorgenti REALI piene',
        badErrs.length === 0, '0 log vuoto', JSON.stringify(fp21ErrsMatrix).slice(0, 300));

    // --- caso VUOTO creato ad hoc (nota nuova) ---
    await goModule(page, 'notes');
    const created = await (async () => {
        for (let i = 0; i < 30; i++) {
            const step = await page.evaluate(() => {
                const V = b => b && b.getBoundingClientRect().width > 0;
                const nova = Array.from(document.querySelectorAll('#moduleView button'))
                    .find(x => V(x) && /Nuova nota/.test(x.textContent || ''));
                if (nova) { nova.click(); return 1; }
                const crea = Array.from(document.querySelectorAll('#moduleView button'))
                    .find(x => V(x) && /^Crea nota/.test(x.textContent || ''));
                if (crea) { crea.click(); return 2; }
                return 0;
            });
            if (step === 2) return true;
            await sleep(300);
        }
        return false;
    })();
    // attende che il SALVATAGGIO entri davvero nella lista reale (study_list)
    const seedNotes = (M.by_kind && M.by_kind.note) || 7;
    let nNotes = 0;
    for (let i = 0; i < 20; i++) {
        nNotes = await page.evaluate(async () =>
            (await window.StudyStore.listItems('note')).length);
        if (nNotes > seedNotes) break;
        await sleep(300);
    }
    const saves = await page.evaluate(() => (window.__r27 || {}).saves || 0);
    const edReady = await waitEditor(page, '.fn-pill-left', '.nt-stage canvas');
    await ensurePanelOpen(page, 'appunti');
    s = await panelState(page, 'appunti');
    const errIdxBefore = consoleErrs.length;
    await pickChip('Appunti');
    const today = new Date().toLocaleDateString('it-IT');
    found = await pickRow('Nota del ' + today);
    let rowDump = [];
    if (!found) {
        rowDump = await page.evaluate(() => Array.from(
            document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-item'))
            .map(r => (r.textContent || '').slice(0, 36)));
        // la lista e' ordinata per updated_at DESC: la nota appena creata e'
        // la PRIMA riga
        await page.evaluate(() => {
            const rows = document.querySelectorAll('.fp21-root[data-fp21="appunti"] .fp21-item');
            if (rows.length) rows[0].click();
        });
    }
    pv = await previewHtml();
    const emptyOk = created && /Nessun testo disponibile/.test(pv.html);
    const emptyLog = consoleErrs.slice(errIdxBefore).some(t => t.indexOf('[fp21]') >= 0);
    rec('Q6.10 caso vuoto AD HOC -> "Nessun testo disponibile" + console.error',
        emptyOk && emptyLog, 'messaggio + log [fp21]',
        'created=' + created + ' saves=' + saves + ' nNotes=' + nNotes + '/' +
        seedNotes + ' edReady=' + edReady + ' panel=' + s.visible +
        ' foundTitle=' + found + ' msg=' + emptyOk + ' log=' + emptyLog +
        ' pbody=' + pv.html.slice(0, 50) + ' rowsN=' + rowDump.length +
        ' first=' + (rowDump[0] || '(match per titolo)'));
    matrix.push({
        tipo: 'Appunti VUOTO (ad hoc)', atteso: 'solo qui: "Nessun testo disponibile"+log',
        ok: emptyOk && emptyLog, visto: pv.title.slice(0, 60)
    });
    await shot(page, 'r27_q6_vuoto');

    /* ========== Q7 math fotosintesi ========== */
    await pickChip('Materiali');
    found = await pickRow(M.fotosintesi.name);
    pv = await previewHtml();
    const q7 = await page.evaluate(() => {
        const b = document.querySelector('.fp21-root[data-fp21="appunti"] .fp21-pbody');
        if (!b) return { raw: -1, katex: 0, txt: '' };
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        let raw = 0;
        let n;
        while ((n = walker.nextNode())) {
            const t = n.nodeValue || '';
            if (t.indexOf('\\Delta') >= 0 || t.indexOf('\\text') >= 0 ||
                t.indexOf('$$') >= 0) raw++;
        }
        return {
            raw,
            katex: b.querySelectorAll('.katex').length,
            err: b.querySelectorAll('.katex-error').length,
            fb: b.querySelectorAll('.fp21-mathfb').length,
            txt: (b.textContent || '').replace(/\s+/g, ' ')
        };
    });
    measures.q7 = { raw: q7.raw, katex: q7.katex, err: q7.err, fb: q7.fb };
    rec('Q7.1 zero nodi testo con LaTeX grezzo (\\Delta \\text $$)',
        q7.raw === 0, '0 nodi', q7.raw + '');
    rec('Q7.2 zero nodi katex-error (rossi)',
        q7.err === 0, '0 errori', q7.err + '');
    rec('Q7.3 matematica renderizzata (katex) o fallback pulito',
        q7.katex > 0 || q7.fb > 0, 'katex>0 o badge fallback',
        'katex=' + q7.katex + ' fb=' + q7.fb);
    const mathTxt = q7.txt;
    rec('Q7.4 formula e (CO2)/(H2O) nel testo renderizzato',
        /kJ\/mol/.test(mathTxt) && /CO/.test(mathTxt) && /H\s*O|H₂O|H2O/.test(mathTxt),
        'kJ/mol + CO + H2O leggibili',
        (mathTxt.match(/.{0,60}kJ\/mol.{0,20}/) || ['?'])[0]);
    await shot(page, 'r27_q7_math');

    /* ========== errori di console (Q5 FE) ========== */
    const unexpectedErrs = consoleErrs.filter(t => t.indexOf('[fp21]') < 0);
    rec('Q5a zero pageerror durante la sessione', pageErrs.length === 0,
        '0 pageerror', JSON.stringify(pageErrs.slice(0, 3)));
    rec('Q5b zero console.error inattesi (i log [fp21] sono attesi/dichiarati)',
        unexpectedErrs.length === 0, '0 inattesi',
        JSON.stringify(unexpectedErrs.slice(0, 4)));

    measures.matrix = matrix;
    measures.books = { dir: M.books_dir, count: M.books_count };
    fs.writeFileSync(path.join(QA_DIR, 'r27_measures.json'),
        JSON.stringify(measures, null, 1));
    fs.writeFileSync(path.join(QA_DIR, 'r27_results.json'), JSON.stringify(checks, null, 1));

    await browser.close();
    srv.close();
    const nok = checks.filter(c => !c.ok);
    console.log('\n===== T2 QA-REAL R27: ' + (checks.length - nok.length) + '/' + checks.length + ' check OK =====');
    if (nok.length) console.log('FAILED:\n - ' + nok.map(n => n.id + ' (' + n.evidence + ')').join('\n - '));
    console.log('OUTPUT: qa/r27_results.json qa/r27_measures.json qa/r27_*.png');
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('RUNNER FATAL:', e);
    process.exit(1);
});
