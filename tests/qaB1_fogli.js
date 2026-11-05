/* ============================================================
   QA-SHEET StudioIA_7 — Subagente 20261016_23 — BLOCCO 1 FOGLI
   Verifica indipendente (read-only su web_frontend/):
     1. Pallino angolo B/D rect (spot indipendenti: resize riga, resize+scroll)
     2. Drag pallino: preview + applyFill live (serie)
     3. Pannello "Formato cella": dimensioni + collasso DOM
     4. Editor cella: geometria + Invio/Esc/blur
     5. Scrollbar verticale a tema su .fg-wrap (grep CSS)
     6. Regressione: node --check + fogliUi.test.js (135/135, baseline 105)
   Eseguire con: node tests/qaB1_fogli.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fogli.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================
   6. REGRESSIONE (indipendente da ogni DOM)
   ============================================================ */
console.log('\n== 6. REGRESSIONE ==');
const chk = cp.spawnSync(process.execPath, ['--check', SRC_PATH], { encoding: 'utf8' });
ok(chk.status === 0, '6.1 node --check web_frontend/html/js/modules/fogli.js', String(chk.stderr || '').slice(0, 200));

const run = cp.spawnSync(process.execPath, [path.join(__dirname, 'fogliUi.test.js')],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const rout = String(run.stdout || '') + String(run.stderr || '');
const rlines = rout.split(/\r?\n/);
const passLines = rlines.filter(l => /^\s{2}PASS\s+/.test(l));
const failLines = rlines.filter(l => /^\s{2}FAIL\s+/.test(l));
const newLines = passLines.filter(l => /^\s{2}PASS\s+1\.[1-4]/.test(l));
const baseLines = passLines.filter(l => !/^\s{2}PASS\s+1\.[1-4]/.test(l));
ok(run.status === 0 && passLines.length === 135 && failLines.length === 0,
    '6.2 totale reale 135/135', 'pass=' + passLines.length + ' fail=' + failLines.length);
ok(baseLines.length === 105,
    '6.3 baseline: 105 asserzioni pre-B1 ancora presenti e verdi (0 rimosse)',
    'baseline_verdi=' + baseLines.length + ' nuove_B1=' + newLines.length);
const summary = rlines.filter(l => /RISULTATI FOGLI/.test(l))[0] || '';
ok(/135 passati,\s*0 falliti/.test(summary), '6.4 riepilogo del runner', summary.trim());

/* evidenza per il punto 1: quali asserzioni del test coprono il pallino */
const cover = {};
function coverKey(re, label) {
    const hit = passLines.some(l => re.test(l));
    cover[label] = hit ? 'verde (test)' : 'ASSENTE';
    return hit;
}

/* ============================================================
   Ambiente jsdom (stesso harness del test ufficiale)
   ============================================================ */
function makeEnv() {
    const vc = new VirtualConsole();
    const errors = [];
    vc.on('jsdomError', e => errors.push(String(e.message)));
    vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window;
    const doc = win.document;
    const store = { items: [], seq: 1 };
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    function el(tag, cls, html) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    win.App = {
        el: el, esc: esc,
        style: css => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); },
        empty: () => el('div', 'app-empty'),
        fmtDate: s => String(s || ''),
        go: () => { },
        header: t => el('div', 'app-header'),
        ICONS: {}
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) { const i = store.items.filter(x => x.id === p.id)[0]; if (i) { Object.assign(i, p); return Object.assign({}, i); } }
            const n = Object.assign({ id: 'f' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async () => { },
        renameItem: async () => { },
        duplicateItem: async () => { },
        pickAsset: async () => null,
        hasBackend: async () => false
    };
    win.StudyAsk = () => Promise.resolve('Foglio');
    win.prompt = () => null;
    win.document.elementFromPoint = () => null;
    const env = { dom, win, doc, store, errors, confirmCalls: [], confirmResult: true };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
    win.eval(SRC);
    return env;
}

const SEED = {
    sheets: [{
        cells: {
            'C1': { v: '5' }, 'C2': { v: '7' },   // sorgente serie per il drag fill
            'K13': { v: 'x' }                      // cella per resize riga / editor
        }
    }]
};

async function openSheet(env) {
    const id = 'f' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'foglio', title: 'Foglio',
        content: JSON.stringify(SEED),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.win.StudyTools.fogli.render(cont, { open: id });
    await sleep(400);
    return id;
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function selectCell(env, ref) {
    const td = env.doc.querySelector('td[data-ref="' + ref + '"]');
    if (!td) throw new Error('td mancante: ' + ref);
    td.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0 }));
}
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function geomOf(env, ref) {
    const m = String(ref).match(/^([A-Z]+)([0-9]+)$/);
    let c = 0;
    for (let i = 0; i < m[1].length; i++) c = c * 26 + (m[1].charCodeAt(i) - 64);
    c -= 1;
    const r = parseInt(m[2], 10) - 1;
    const cols = $$(env, '.fg-wrap colgroup col').map(x => parseInt(x.style.width, 10) || 96);
    const rows = $$(env, '.fg-wrap tbody tr').map(x => parseInt(x.style.height, 10) || 26);
    let x = 0; for (let i = 0; i <= c; i++) x += cols[i];
    let y = 26; for (let i = 0; i < r; i++) y += rows[i];
    const w = cols[c + 1], h = rows[r];
    return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
}

(async function run() {
    const env = makeEnv();
    await openSheet(env);
    const css = $$('style'.length ? env : env, 'style').map(s => s.textContent).join('\n');
    const fill = $(env, '.fg-fill');
    const rng = $(env, '.fg-rng');
    const wrap = $(env, '.fg-wrap');
    const pos = el => ({ l: parseInt(el.style.left, 10), t: parseInt(el.style.top, 10) });

    /* ============================================================
       1. PALLINO — copertura del test + 2 spot indipendenti
       ============================================================ */
    console.log('\n== 1. PALLINO ANGOLO B/D RECT ==');
    const cov = [
        [/1\.1\(a\).*handle = angolo basso-destro del rect della cella/, 'cella singola'],
        [/1\.1\(b\).*handle = angolo esatto del rect \(range\)/, 'range shift+click'],
        [/1\.1\(b\).*handle e rect coerenti dopo scroll/, 'scroll griglia'],
        [/1\.1\(b\).*handle segue resize colonna durante il drag/, 'resize colonna (drag)'],
        [/1\.1\(b\).*handle = angolo del rect dopo render\/resize/, 'resize colonna (dopo)'],
        [/1\.1\(b\).*pallino sull'angolo del rect anche con freeze\+scroll/, 'freeze+scroll'],
        [/1\.1\(b\).*dopo sblocco\/scroll a 0/, 'dopo sblocco'],
        [/1\.1 merge K13:M15.*angolo reale del rettangolo unito/, 'dopo merge (Unisci)'],
        [/1\.1 merge rimosso.*torna sull'angolo di K13/, 'dopo split (Dividi)']
    ];
    for (const [re, label] of cov) ok(coverKey(re, label), '1.copertura ' + label, cover[label]);

    // SPOT indipendente A: resize RIGA → pallino = angolo B/D del nuovo rect
    selectCell(env, 'K13');
    await sleep(30);
    let g = geomOf(env, 'K13');
    let p = pos(fill);
    ok(p.l === g.right - 7 && p.t === g.bottom - 7,
        '1.spotA pre: pallino su angolo K13 prima del resize riga',
        p.l + ',' + p.t + ' vs ' + (g.right - 7) + ',' + (g.bottom - 7));
    const vrh = env.doc.querySelector('span.fg-vrh[data-idx="12"]');
    ok(!!vrh, '1.spotA handle riga .fg-vrh[data-idx=12] presente');
    if (vrh) {
        vrh.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0 }));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 140 }));
        await sleep(20);
        env.doc.dispatchEvent(new env.win.MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 140 }));
        await sleep(80);
        g = geomOf(env, 'K13');
        p = pos(fill);
        ok(g.height === 66, '1.spotA resize riga applicato (26+40=66px)', 'h=' + g.height);
        ok(p.l === g.right - 7 && p.t === g.bottom - 7,
            '1.spotA dopo resize riga: pallino = angolo B/D del rect',
            p.l + ',' + p.t + ' vs ' + (g.right - 7) + ',' + (g.bottom - 7));
        // SPOT B: resize riga + range + scroll → rect visibile e pallino sull'angolo
        selectCell(env, 'K13');
        env.doc.querySelector('td[data-ref="M15"]').dispatchEvent(
            new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
        await sleep(30);
        const gA = geomOf(env, 'K13');
        const gM = geomOf(env, 'M15');
        ok(rng.style.display === 'block', '1.spotB range K13:M15 attivo (rect visibile)');
        wrap.scrollLeft = 120; wrap.scrollTop = 60;
        wrap.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        p = pos(fill);
        ok(parseInt(rng.style.left, 10) === gA.left && parseInt(rng.style.top, 10) === gA.top &&
            parseInt(rng.style.width, 10) === gM.right - gA.left &&
            parseInt(rng.style.height, 10) === gM.bottom - gA.top &&
            p.l === gM.right - 7 && p.t === gM.bottom - 7,
            '1.spotB dopo resize riga + scroll: rect = geometria reale e pallino = angolo B/D',
            'rng=' + [rng.style.left, rng.style.top, rng.style.width, rng.style.height].join(',') +
            ' fill=' + p.l + ',' + p.t + ' atteso=' + (gM.right - 7) + ',' + (gM.bottom - 7));
        wrap.scrollLeft = 0; wrap.scrollTop = 0;
        wrap.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
    }

    /* ============================================================
       2. DRAG PALLINO: preview + applyFill live
       ============================================================ */
    console.log('\n== 2. DRAG PALLINO / applyFill ==');
    selectCell(env, 'C1');
    env.doc.querySelector('td[data-ref="C2"]').dispatchEvent(
        new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
    await sleep(30);
    ok(rng.style.display === 'block', '2.1 range C1:C2 selezionato (rect attivo)');
    const fillPos = pos(fill);
    ok(fillPos.l > 0 && fillPos.t > 0, '2.2 pallino visibile sul range', fillPos.l + ',' + fillPos.t);
    const rowsH = $$(env, '.fg-wrap tbody tr').map(x => parseInt(x.style.height, 10) || 26);
    const dy = rowsH[2] + rowsH[3] + rowsH[4]; // estende di 3 righe (righe 3-5)
    // pointerdown sul pallino
    fill.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
    // pointermove: deve apparire l'anteprima (.fg-fpreview)
    env.doc.dispatchEvent(new env.win.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 + dy }));
    await sleep(20);
    const prev = $(env, '.fg-fpreview');
    ok(!!prev && prev.style.display === 'block',
        '2.3 anteprima drag visibile (.fg-fpreview display:block)',
        prev ? 'display=' + prev.style.display + ' h=' + prev.style.height : 'assente');
    const prevH = prev ? parseInt(prev.style.height, 10) : 0;
    const srcH = rowsH[0] + rowsH[1];
    ok(prevH > srcH, '2.4 anteprima espande il range oltre la sorgente', 'prev=' + prevH + ' src=' + srcH);
    // rilascio: applyFill riempie la serie 5,7 → 9,11,13
    env.doc.dispatchEvent(new env.win.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 + dy }));
    await sleep(120);
    ok(prev && prev.style.display === 'none', '2.5 anteprima nascosta al rilascio', 'display=' + (prev && prev.style.display));
    const cellV = ref => { const td = env.doc.querySelector('td[data-ref="' + ref + '"]'); return td ? td.textContent.trim() : null; };
    ok(cellV('C1') === '5' && cellV('C2') === '7', '2.6 sorgente invariata', 'C1=' + cellV('C1') + ' C2=' + cellV('C2'));
    ok(cellV('C3') === '9' && cellV('C4') === '11' && cellV('C5') === '13',
        '2.7 applyFill: serie numerica 5,7 → C3=9 C4=11 C5=13',
        'C3=' + cellV('C3') + ' C4=' + cellV('C4') + ' C5=' + cellV('C5'));

    /* ============================================================
       3. PANNELLO "Formato cella"
       ============================================================ */
    console.log('\n== 3. PANNELLO Formato cella ==');
    const sideRule = (css.match(/[.]fg-side[{][^}]*}/) || [''])[0];
    const sideW = +((sideRule.match(/width:([0-9]+)px/) || [0, 0])[1]);
    ok(sideW >= 180 && sideW <= 220, '3.1 larghezza 180-220px', 'width=' + sideW);
    const rowRule = (css.match(/[.]fg-side-row[{][^}]*}/) || [''])[0];
    const rowSizes = (rowRule.match(/(?:min-)?height:[0-9]+px/g) || []).map(s => parseInt(s.match(/([0-9]+)px/)[1], 10));
    ok(rowSizes.length > 0 && Math.max.apply(null, rowSizes) <= 36, '3.2 righe <=36px', rowRule);
    const colorRule = (css.match(/[.]fg-color[{][^}]*}/) || [''])[0];
    const cw = +((colorRule.match(/width:([0-9]+)px/) || [0, 0])[1]);
    const chh = +((colorRule.match(/height:([0-9]+)px/) || [0, 0])[1]);
    ok(cw >= 24 && cw <= 28 && chh >= 24 && chh <= 28, '3.3 swatch 24-28px', 'w=' + cw + ' h=' + chh);
    const titleRule = (css.match(/[.]fg-side-title[{][^}]*}/) || [''])[0];
    const tfs = +((titleRule.match(/font-size:([0-9.]+)px/) || [0, 0])[1]);
    ok(tfs > 0 && tfs <= 11, '3.4 titolo piccolo (<=11px)', 'font-size=' + tfs);
    const padTop = +((sideRule.match(/padding:([0-9]+)px/) || [0, 0])[1]);
    ok(padTop > 0 && padTop <= 8, '3.5 contenuto aderente in alto (padding-top<=8)', 'padding-top=' + padTop);
    // collasso a linguetta (toggle DOM)
    const side = $(env, '.fg-side');
    const sideTab = $(env, '.fg-side-tab');
    const collapseBtn = $$(env, '.fg-side-head button').filter(b => /Nascondi il pannello/.test(b.title || b.getAttribute('aria-label') || ''))[0]
        || $$(env, '.fg-side-head .fg-ib')[0];
    ok(!!side && !!sideTab && !!collapseBtn, '3.6 pannello + linguetta + bottone collasso presenti',
        'side=' + !!side + ' tab=' + !!sideTab + ' btn=' + !!collapseBtn);
    if (collapseBtn) {
        click(env, collapseBtn);
        await sleep(20);
        ok(side.style.display === 'none' && sideTab.style.display !== 'none',
            '3.7 collassato: .fg-side display=none e linguetta visibile',
            'side=' + side.style.display + ' tab=' + sideTab.style.display);
        click(env, sideTab);
        await sleep(20);
        ok(side.style.display !== 'none' && sideTab.style.display === 'none',
            '3.8 riaperto dalla linguetta: .fg-side visibile, linguetta nascosta',
            'side=' + side.style.display + ' tab=' + sideTab.style.display);
    }

    /* ============================================================
       4. EDITOR CELLA
       ============================================================ */
    console.log('\n== 4. EDITOR CELLA ==');
    const edRule = (css.match(/[.]fg-editor[{][^}]*}/) || [''])[0];
    const edZ = +((edRule.match(/z-index:([0-9]+)/) || [0, 0])[1]);
    const fillZ = +(((css.match(/[.]fg-fill[{][^}]*}/) || [''])[0].match(/z-index:([0-9]+)/) || [0, 0])[1]);
    ok(edZ > fillZ && edZ >= 10, '4.1 z-index editor sopra overlay/pallino', 'ed=' + edZ + ' fill=' + fillZ);
    ok(!/min-width/.test(edRule), '4.2 editor senza min-width forzato (copre esatto la cella)', edRule.slice(0, 120));

    selectCell(env, 'K13');
    await sleep(20);
    if (env.doc.activeElement && env.doc.activeElement.blur) env.doc.activeElement.blur();
    env.doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    await sleep(30);
    let ed = $(env, '.fg-editor');
    const gK = geomOf(env, 'K13');
    ok(!!ed, '4.3 editor aperto con F2');
    ok(!!ed && parseInt(ed.style.left, 10) === gK.left && parseInt(ed.style.top, 10) === gK.top,
        '4.4 left/top == rettangolo td', ed ? ed.style.left + ',' + ed.style.top + ' vs ' + gK.left + ',' + gK.top : 'n/a');
    ok(!!ed && parseInt(ed.style.width, 10) === gK.width, '4.5 larghezza == cella', ed ? ed.style.width + ' vs ' + gK.width : 'n/a');
    ok(!!ed && parseInt(ed.style.height, 10) >= gK.height, '4.6 altezza >= riga', ed ? ed.style.height + ' vs ' + gK.height : 'n/a');

    // Invio → commit
    ed.value = '999';
    ed.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(60);
    const cellV2 = ref => { const td = env.doc.querySelector('td[data-ref="' + ref + '"]'); return td ? td.textContent.trim() : null; };
    ok(!$(env, '.fg-editor'), '4.7 Invio chiude l\'editor');
    ok(cellV2('K13') === '999', '4.8 Invio committa il valore in cella', 'K13=' + cellV2('K13'));

    // Esc → cancel
    selectCell(env, 'K13');
    await sleep(20);
    if (env.doc.activeElement && env.doc.activeElement.blur) env.doc.activeElement.blur();
    env.doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    await sleep(30);
    ed = $(env, '.fg-editor');
    if (ed) ed.value = 'mai-scritto';
    if (ed) ed.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await sleep(60);
    ok(!$(env, '.fg-editor'), '4.9 Esc chiude l\'editor (cancel)');
    ok(cellV2('K13') === '999', '4.10 Esc NON committa (cella invariata)', 'K13=' + cellV2('K13'));

    // blur → commit
    selectCell(env, 'K13');
    await sleep(20);
    if (env.doc.activeElement && env.doc.activeElement.blur) env.doc.activeElement.blur();
    env.doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    await sleep(30);
    ed = $(env, '.fg-editor');
    if (ed) ed.value = '42';
    if (ed) ed.dispatchEvent(new env.win.FocusEvent('blur'));
    await sleep(60);
    ok(!$(env, '.fg-editor'), '4.11 click fuori (blur) chiude l\'editor');
    ok(cellV2('K13') === '42', '4.12 blur committa il valore', 'K13=' + cellV2('K13'));

    /* ============================================================
       5. SCROLLBAR A TEMA su .fg-wrap (grep CSS)
       ============================================================ */
    console.log('\n== 5. SCROLLBAR .fg-wrap ==');
    const vRule = (css.match(/[.]fg-wrap::?-?webkit-scrollbar:vertical[{][^}]*}/) || [''])[0];
    ok(/width:9px/.test(vRule) && /background:transparent/.test(vRule),
        '5.1 ::-webkit-scrollbar:vertical width9 + track/area trasparente', vRule || 'ASSENTE');
    const vTrack = (css.match(/[.]fg-wrap::?-?webkit-scrollbar-track:vertical[{][^}]*}/) || [''])[0];
    ok(/background:transparent/.test(vTrack), '5.2 track verticale trasparente', vTrack || 'ASSENTE');
    const vThumb = (css.match(/[.]fg-wrap::?-?webkit-scrollbar-thumb:vertical[{][^}]*}/) || [''])[0];
    ok(/background:#3a4054/.test(vThumb), '5.3 thumb verticale scura #3a4054', vThumb || 'ASSENTE');
    ok(/scrollbar-color:#3a4054\s+transparent/.test(sideRule2(css)), '5.4 scrollbar-color standard su .fg-wrap (Firefox)', sideRule2(css).match(/scrollbar-color:[^;]+/) + '');
    // nessuna regola che lasci la verticale bianca di default su .fg-wrap
    const allWrapRules = css.match(/[.]fg-wrap::?-?webkit-scrollbar[^{}]*[{][^}]*}/g) || [];
    const lightRe = /background:\s*(#fff(?:fff)?|white|lightgray|lightgrey|#f[0-9a-f]{5}|#e[0-9a-f]{5}|#d[0-9a-f]{5})/i;
    const whitish = allWrapRules.filter(r => lightRe.test(r));
    ok(whitish.length === 0, '5.5 nessuna regola .fg-wrap con scrollbar verticale chiara/default',
        whitish.length ? whitish.join(' || ') : '0 regole chiare; base=' + (allWrapRules[0] || ''));
    ok(/[.]fg-wrap[{][^}]*overflow:auto/.test(css), '5.6 .fg-wrap è lo scroller reale (overflow:auto)', '');

    function sideRule2(c) { return (c.match(/[.]fg-wrap[{][^}]*}/) || [''])[0]; }

    /* ============================================================
       ESITO
       ============================================================ */
    console.log('\n==================================================');
    console.log('QA BLOCCO 1 FOGLI (subagente 20261016_23): ' + pass + ' passati, ' + fail + ' falliti');
    if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    if (env.errors.length) console.log('jsdom errors: ' + env.errors.slice(0, 5).join(' | '));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH: ' + (e && e.stack || e)); process.exit(2); });
