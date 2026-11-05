/* ============================================================
   tests/documentiUi.test.js — BLOCCO 4 / D1-D3:
   4.1 pill overlay su .doc-main (D1) + zoom [−][%][+][Adatta][100%]
   4.1 Adatta senza cap 100% + foglio ad altezza esatta (D3)
   4.2 toggle vero B/I/U/S + stato dalla selezione + caret (motore B)
   4.2 D2: anello nidificato, Ctrl+Z/Y su stack snapshot, digitazione pulita
   Eseguire con: node tests/documentiUi.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'documenti.js'), 'utf8');
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeEnv() {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
        virtualConsole: vc
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
        empty: (icon, text, btnText, onClick) => {
            const d = el('div', 'app-empty');
            d.appendChild(el('p', null, text));
            return d;
        },
        fmtDate: s => String(s || ''),
        go: () => { },
        header: (t) => { const h = el('div', 'app-header'); h.appendChild(el('h2', null, t)); return h; },
        ICONS: {}
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) { const i = store.items.filter(x => x.id === p.id)[0]; if (i) { Object.assign(i, p); return Object.assign({}, i); } }
            const n = Object.assign({ id: 'd' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async () => { },
        renameItem: async () => { },
        duplicateItem: async () => { },
        pickAsset: async () => ({ path: 'file:///fake/asset' }),
        hasBackend: async () => false
    };
    win.StudyAsk = () => Promise.resolve('Documento');
    win.prompt = () => null;
    const env = { dom, win, doc, store, confirmCalls: [], confirmResult: true, consoleErrors };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
    win.eval(SRC_PANEL);   // R21 B3: FontiPanel PRIMA del modulo (pattern _ink_env SRC_PANEL)
    win.eval(SRC);
    return env;
}

async function openDoc(env, content) {
    const id = 'd' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'documento', title: 'Documento',
        content: JSON.stringify(content || { html: '<p>Seleziona questo testo</p>' }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.win.StudyTools.documenti.render(cont, { open: id });
    await sleep(250);
    return id;
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function setRange(env, r) {
    const s = env.win.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    env.doc.dispatchEvent(new env.win.Event('selectionchange'));
    env.doc.dispatchEvent(new env.win.Event('selectionchange'));
}
function editorOf(env) { return env.doc.querySelector('.doc-paper'); }   // jsdom non riflette contentEditable in attributo
function btnByTitle(env, re) { return $$(env, 'button').filter(b => re.test(b.title || ''))[0] || null; }
function keydown(env, target, key, ctrl) {
    const ev = new env.win.KeyboardEvent('keydown', { key: key, ctrlKey: !!ctrl, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

async function main() {
    try {
        console.log('\n== BLOCCO 4 — Documenti: pill D1 + zoom + toggle stili D2/D3 ==');
        const env = makeEnv();
        await openDoc(env);

        // ---------- 4.1 D1: PILL OVERLAY ----------
        const shellE = $(env, '.doc-shell');
        ok(!!shellE && !shellE.querySelector('.doc-status'), '4.1 nessun .doc-status nel shell dell\'editor',
            shellE && shellE.querySelector('.doc-status') ? 'ancora presente' : '');

        const mainE = $(env, '.doc-main');
        const pillL = $(env, '.doc-pill-l');
        const pillR = $(env, '.doc-pill-r');
        ok(!!pillL && pillL.parentElement === mainE, '4.1 pill sinistra in basso dentro .doc-main',
            pillL ? 'parent=' + (pillL.parentElement && pillL.parentElement.className) : 'assente');
        ok(!!pillR && pillR.parentElement === mainE, '4.1 pill destra dentro .doc-main',
            pillR ? 'parent=' + (pillR.parentElement && pillR.parentElement.className) : 'assente');
        const csL = pillL ? env.win.getComputedStyle(pillL) : null;
        const csR = pillR ? env.win.getComputedStyle(pillR) : null;
        ok(!!csL && csL.position === 'absolute' && csL.bottom === '10px' && csL.left === '12px',
            '4.1 pill sinistra posizionata bottom-left (absolute)',
            csL ? csL.position + ' bottom=' + csL.bottom + ' left=' + csL.left : '');
        ok(!!csR && csR.position === 'absolute' && csR.bottom === '10px' && csR.right === '12px',
            '4.1 pill destra posizionata bottom-right (absolute)',
            csR ? csR.position + ' bottom=' + csR.bottom + ' right=' + csR.right : '');

        const pillText = pillL ? pillL.textContent : '';
        ok(/\d+ parole · \d+ caratteri · Pagina 1\/1/.test(pillText),
            '4.1 pill sinistra: "N parole · M caratteri · Pagina x/y"', pillText);
        ok(pillText.indexOf('Zoom') < 0, '4.1 nessun % di zoom nella pill sinistra', pillText);
        const pager = $(env, '.doc-pager');
        ok(!!pager && pager.textContent === 'Pagina 1/1', '4.1 pager = Pagina k/n (zoom solo a destra)',
            pager && pager.textContent);
        ok(!!pillR && pillR.contains($(env, '.doc-zoomgrp')), '4.1 gruppo zoom presente nella pill destra (.doc-pill-r)');
        const zval = $(env, '.doc-zoomval');
        ok(!!zval && /\d+%$/.test(zval.textContent), '4.1 % zoom visibile in pagina (.doc-zoomval nella pill destra)',
            zval && zval.textContent);
        ok(csL && csL.pointerEvents === 'none', '4.1 pill: pointer-events none sul container', csL && csL.pointerEvents);
        const firstZbtn = $(env, '.doc-zbtn');
        ok(!!firstZbtn && env.win.getComputedStyle(firstZbtn).pointerEvents === 'auto',
            '4.1 pill: pointer-events auto sui bottoni zoom',
            firstZbtn && env.win.getComputedStyle(firstZbtn).pointerEvents);
        ok(SRC.indexOf('.doc-bar,.doc-status,.doc-pill,') >= 0, '4.1 print: .doc-pill nascosta in stampa');

        const bOut = btnByTitle(env, /Riduci zoom/);
        const bIn = btnByTitle(env, /Aumenta zoom/);
        const bFit = btnByTitle(env, /Adatta la pagina/);
        const b100 = btnByTitle(env, /Zoom al 100%/);
        ok(!!bOut && !!bIn && !!bFit && !!b100 && !!zval, '4.1 controlli [−][%][+][Adatta][100%] tutti presenti');

        click(env, bIn);
        await sleep(30);
        ok(zval.textContent === '110%', '4.1 + → 110%', zval.textContent);
        click(env, bIn);
        await sleep(30);
        ok(zval.textContent === '120%', '4.1 + → 120%', zval.textContent);
        const zoomEl = $(env, '.doc-zoom');
        ok(!!zoomEl && /scale\(1\.2/.test(zoomEl.style.transform || ''), '4.1 zoom applicato con transform',
            zoomEl && zoomEl.style.transform);
        click(env, bOut);
        await sleep(30);
        ok(zval.textContent === '110%', '4.1 − → 110%', zval.textContent);
        click(env, b100);
        await sleep(30);
        ok(zval.textContent === '100%' && /scale\(1\)/.test(zoomEl.style.transform || ''), '4.1 100% reset',
            zoomEl.style.transform);
        // clamp massimo
        for (let i = 0; i < 25; i++) click(env, bIn);
        await sleep(40);
        ok(zval.textContent === '300%', '4.1 clamp massimo 300%', zval.textContent);
        for (let i = 0; i < 40; i++) click(env, bOut);
        await sleep(40);
        ok(zval.textContent === '25%', '4.1 clamp minimo 25%', zval.textContent);
        click(env, bFit);
        await sleep(40);
        ok(zval.textContent === '100%', '4.1 Adatta (spazio non misurabile → 100%)', zval.textContent);

        // ---------- 4.1 D3: Adatta riempie l'altezza (cap 100% rimosso) ----------
        const cv = $(env, '.doc-canvas');
        Object.defineProperty(cv, 'clientHeight', { value: 2000, configurable: true });
        Object.defineProperty(cv, 'clientWidth', { value: 1500, configurable: true });
        // availH = 2000-20 = 1980; availW = 1500-16 = 1484
        // z = min(1980/1123 ≈ 1.7631, 1484/794 ≈ 1.8690, 3) = 1.7631 → 176%
        click(env, bFit);
        await sleep(40);
        ok(zval.textContent === '176%', '4.1 Adatta riempie l\'altezza (cap a 100% rimosso → 176%)', zval.textContent);
        const stage = $(env, '.doc-stage');
        ok(!!stage && stage.style.height === '1980px',
            '4.1 stage a piena altezza (1980px = spazio disponibile, nessuna fascia sotto)',
            stage && stage.style.height);
        delete cv.clientHeight; delete cv.clientWidth;   // ripristina misure jsdom (0)
        click(env, b100);
        await sleep(30);
        ok(zval.textContent === '100%', '4.1 ritorno al 100% dopo il test Adatta', zval.textContent);

        // ---------- 4.1 D3: foglio ad altezza esatta (niente fascia bianca fissa) ----------
        const paper0 = editorOf(env);
        Object.defineProperty(paper0, 'scrollHeight', { value: 1500, configurable: true });
        paper0.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(120);   // relayoutSoon → requestAnimationFrame
        const sheet = $(env, '.doc-page');
        // natural = 1500 + 2*70 = 1640 → arrotondamento vecchio a multipli: 2246px
        ok(!!sheet && sheet.style.minHeight === '1640px',
            '4.1 foglio ad altezza esatta (1640px, non 2246px di multipli)',
            sheet && sheet.style.minHeight);
        const brk = $(env, '.doc-break');
        ok($$(env, '.doc-break').length === 1 && !!brk && brk.style.top === '1123px',
            '4.1 paginazione preservata (separatore a 1123px, 2 pagine)',
            brk && brk.style.top);
        ok(/Pagina 1\/2/.test(pillL.textContent), '4.1 pager aggiornato a Pagina 1/2', pillL.textContent);
        // scroll → pager: il listener scroll aggiorna st.pager nella pill sinistra
        const cvScroll = $(env, '.doc-canvas');
        cvScroll.scrollTop = 1500;   // oltre PAGE_H*zoom(1) → pagina 2
        cvScroll.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        ok(/Pagina 2\/2/.test(pillL.textContent), '4.1 scroll canvas → pager aggiornato (Pagina 2/2)',
            pillL.textContent);
        cvScroll.scrollTop = 0;
        cvScroll.dispatchEvent(new env.win.Event('scroll'));
        delete paper0.scrollHeight;   // ripristina

        // ---------- 4.2 TOGGLE B ----------
        const ed = editorOf(env);
        ok(!!ed, '4.2 editor contenteditable presente');
        const p = ed.querySelector('p');
        ok(!!p && p.firstChild, '4.2 paragrafo con testo');
        const boldBtn = btnByTitle(env, /^Grassetto/);
        const italicBtn = btnByTitle(env, /^Corsivo/);
        const underBtn = btnByTitle(env, /^Sottolineato/);
        ok(!!boldBtn && !!italicBtn && !!underBtn, '4.2 pulsanti B/I/U presenti');

        // mousedown preventDefault (non si perde la selezione)
        const md = new env.win.MouseEvent('mousedown', { bubbles: true, cancelable: true });
        boldBtn.dispatchEvent(md);
        ok(md.defaultPrevented === true, '4.2 preventDefault sul mousedown del pulsante stile');

        // seleziona tutto il testo → stato off
        let r = env.doc.createRange();
        r.selectNodeContents(p.firstChild);
        setRange(env, r);
        await sleep(20);
        ok(!boldBtn.classList.contains('on'), '4.2 stato B off su testo non grassetto');

        // click B → applica
        click(env, boldBtn);
        await sleep(30);
        ok(p.innerHTML === '<b>Seleziona questo testo</b>', '4.2 B applica il grassetto', p.innerHTML);
        ok(boldBtn.classList.contains('on'), '4.2 pulsante B attivo dopo applicazione');

        // riseleziona lo stesso testo → stato on (letto dalla selezione)
        const bEl = ed.querySelector('b');
        r = env.doc.createRange();
        r.selectNodeContents(bEl.firstChild);
        setRange(env, r);
        await sleep(20);
        ok(boldBtn.classList.contains('on'), '4.2 stato B on dopo riselezione (aggiornato a ogni cambio selezione)');

        // click B di nuovo → rimuove, senza residui, testo intatto
        click(env, boldBtn);
        await sleep(30);
        ok(p.innerHTML === 'Seleziona questo testo', '4.2 B rimuove e il testo torna normale (nessun residuo)', p.innerHTML);
        ok(!boldBtn.classList.contains('on'), '4.2 pulsante B off dopo rimozione');
        ok(ed.querySelectorAll('b,strong').length === 0, '4.2 nessun tag residuo <b>/<strong>');

        // ---------- I ----------
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        click(env, italicBtn);
        await sleep(30);
        ok(ed.querySelector('i') !== null && ed.querySelector('i').textContent === 'Seleziona questo testo',
            '4.2 I applica il corsivo', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('i').firstChild);
        setRange(env, r);
        click(env, italicBtn);
        await sleep(30);
        ok(ed.querySelector('i') === null && ed.textContent.indexOf('Seleziona questo testo') >= 0,
            '4.2 I rimuove senza residui', ed.innerHTML);

        // ---------- U ----------
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        click(env, underBtn);
        await sleep(30);
        ok(ed.querySelector('u') !== null, '4.2 U applica il sottolineato', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('u').firstChild);
        setRange(env, r);
        click(env, underBtn);
        await sleep(30);
        ok(ed.querySelector('u') === null, '4.2 U rimuove senza residui', ed.innerHTML);

        // ---------- rimozione PARZIALE dentro un marcatore ----------
        ed.innerHTML = '<p>AA<b>BB CC</b>DD</p>';
        const tB = ed.querySelector('b').firstChild;   // "BB CC"
        r = env.doc.createRange();
        r.setStart(tB, 3); r.setEnd(tB, 5);            // "CC"
        setRange(env, r);
        click(env, boldBtn);
        await sleep(30);
        const bAfter = ed.querySelector('b');
        ok(!!bAfter && bAfter.textContent === 'BB ', '4.2 rimozione parziale: il resto resta grassetto', ed.innerHTML);
        ok(ed.textContent === 'AABB CCDD', '4.2 nessuna perdita di testo', ed.textContent);
        ok(!ed.innerHTML.includes('<b>CC') && ed.querySelectorAll('b').length === 1, '4.2 "CC" scollegato dal <b>', ed.innerHTML);

        // ---------- applicazione MULTI-BLOCCO (HTML valido) ----------
        ed.innerHTML = '<p>primo</p><p>secondo</p>';
        const t1 = ed.children[0].firstChild, t2 = ed.children[1].firstChild;
        r = env.doc.createRange();
        r.setStart(t1, 2); r.setEnd(t2, 3);            // "imo" + "sec"
        setRange(env, r);
        click(env, boldBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p>pr<b>imo</b></p><p><b>sec</b>ondo</p>',
            '4.2 applicazione multi-blocco con HTML valido', ed.innerHTML);
        ok(!/<b[^>]*>\s*<p/.test(ed.innerHTML), '4.2 nessun <p> annidato dentro <b>');

        // ---------- caret: stato di digitazione ----------
        ed.innerHTML = '<p>testo caret</p>';
        const tc = ed.querySelector('p').firstChild;
        r = env.doc.createRange();
        r.setStart(tc, tc.length);
        r.collapse(true);
        setRange(env, r);
        await sleep(20);
        ok(!underBtn.classList.contains('on'), '4.2 caret: stato iniziale U off');
        click(env, underBtn);
        await sleep(20);
        ok(underBtn.classList.contains('on'), '4.2 caret: click U attiva lo stato di digitazione');
        click(env, underBtn);
        await sleep(20);
        ok(!underBtn.classList.contains('on'), '4.2 caret: secondo click disattiva lo stato');

        // ---------- stato aggiornato a ogni cambio selezione (senza click) ----------
        ed.innerHTML = '<p><i>corsivo qui</i> e testo normale</p>';
        const iNode = ed.querySelector('i').firstChild;
        const plainNode = ed.querySelector('p').lastChild;
        r = env.doc.createRange();
        r.selectNodeContents(iNode);
        setRange(env, r);
        await sleep(20);
        ok(italicBtn.classList.contains('on'), '4.2 selezione dentro <i> → I attivo');
        r = env.doc.createRange();
        r.selectNodeContents(plainNode);
        setRange(env, r);
        await sleep(20);
        ok(!italicBtn.classList.contains('on'), '4.2 selezione su testo normale → I spento');

        // ---------- 4.2 D2(e): anello nidificato b > i > u ----------
        ed.innerHTML = '<p>anello</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        click(env, boldBtn);
        await sleep(30);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('b'));
        setRange(env, r);
        click(env, italicBtn);
        await sleep(30);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('i'));
        setRange(env, r);
        click(env, underBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p><b><i><u>anello</u></i></b></p>',
            '4.2 anello: applica B>I>U annidati', ed.innerHTML);
        // rimozione singola, una volta alla volta
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p'));
        setRange(env, r);
        click(env, underBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p><b><i>anello</i></b></p>',
            '4.2 anello: U rimosso singolarmente (b>i intatti)', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p'));
        setRange(env, r);
        click(env, italicBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p><b>anello</b></p>',
            '4.2 anello: I rimosso singolarmente (b intatto)', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p'));
        setRange(env, r);
        click(env, boldBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p>anello</p>' && ed.querySelectorAll('b,i,u,strong,em,s').length === 0,
            '4.2 anello: B rimosso → nessun residuo, testo intatto', ed.innerHTML);

        // ---------- 4.2 D2(f): Ctrl+Z annulla un'operazione di stile ----------
        ed.innerHTML = '<p>testo undo</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        click(env, boldBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p><b>testo undo</b></p>', '4.2 setup undo: B applicato', ed.innerHTML);
        const evZ = keydown(env, editorOf(env), 'z', true);
        await sleep(30);
        ok(evZ.defaultPrevented === true, '4.2 Ctrl+Z intercettato (preventDefault)');
        ok(ed.innerHTML === '<p>testo undo</p>',
            '4.2 Ctrl+Z annulla l\'operazione di stile', ed.innerHTML);
        ok(!boldBtn.classList.contains('on'), '4.2 stato B off dopo Ctrl+Z');
        const evY = keydown(env, editorOf(env), 'y', true);
        await sleep(30);
        ok(ed.innerHTML === '<p><b>testo undo</b></p>', '4.2 Ctrl+Y ripristina lo stile', ed.innerHTML);

        // ---------- 4.2 D2(f): bottone Annulla reindirizzato allo stack ----------
        ed.innerHTML = '<p>btn undo</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        click(env, boldBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p><b>btn undo</b></p>', '4.2 setup bottone: B applicato', ed.innerHTML);
        const undoBtn = btnByTitle(env, /^Annulla/);
        const redoBtn = btnByTitle(env, /^Ripeti/);
        ok(!!undoBtn && !!redoBtn, '4.2 bottoni Annulla/Ripeti presenti');
        click(env, undoBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p>btn undo</p>', '4.2 bottone Annulla usa lo stack custom (B annullato)', ed.innerHTML);
        click(env, redoBtn);
        await sleep(30);
        ok(ed.innerHTML === '<p><b>btn undo</b></p>', '4.2 bottone Ripeti usa lo stack custom', ed.innerHTML);

        // ---------- 4.2 D2: colore + interlinea beneficiano dello stesso stack ----------
        ed.innerHTML = '<p>rosso</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        const colorInp = $$(env, 'input[type=color]')[0];
        ok(!!colorInp, '4.2 input colore presente');
        colorInp.value = '#d93a3a';
        colorInp.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(30);
        const spanC = ed.querySelector('span[style]');
        ok(!!spanC && /\bcolor:/i.test(spanC.getAttribute('style') || ''),
            '4.2 colore applicato (fallback manuale)', ed.innerHTML);
        const evZ2 = keydown(env, editorOf(env), 'z', true);
        await sleep(30);
        ok(evZ2.defaultPrevented === true && !ed.querySelector('span[style]'),
            '4.2 Ctrl+Z annulla il colore (stesso stack)', ed.innerHTML);

        ed.innerHTML = '<p>linea</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild);
        setRange(env, r);
        const lhSel = $$(env, 'select').filter(s => s.title === 'Interlinea')[0];
        ok(!!lhSel, '4.2 select Interlinea presente');
        lhSel.value = '1.5';
        lhSel.dispatchEvent(new env.win.Event('change', { bubbles: true }));
        await sleep(30);
        ok(!!ed.querySelector('p') && ed.querySelector('p').style.lineHeight === '1.5',
            '4.2 interlinea applicata', ed.querySelector('p') && ed.querySelector('p').style.lineHeight);
        const evZ3 = keydown(env, editorOf(env), 'z', true);
        await sleep(30);
        ok(evZ3.defaultPrevented === true && (!ed.querySelector('p') || !ed.querySelector('p').style.lineHeight),
            '4.2 Ctrl+Z annulla l\'interlinea (stesso stack)', ed.innerHTML);

        // ---------- 4.2 D2(d): pending caret non stantio dopo cambio selezione ----------
        ed.innerHTML = '<p>alpha</p><p>beta</p>';
        const tBeta = ed.children[1].firstChild;
        r = env.doc.createRange();
        r.setStart(tBeta, tBeta.length);
        r.collapse(true);
        setRange(env, r);
        click(env, underBtn);
        await sleep(20);
        ok(underBtn.classList.contains('on'), '4.2 setup pending: U ON con caret');
        // selezione estesa su testo normale → pending azzerato, stato da DOM
        r = env.doc.createRange();
        r.selectNodeContents(ed.children[0].firstChild);
        setRange(env, r);
        await sleep(20);
        ok(!underBtn.classList.contains('on'), '4.2 selezione estesa → U spento (typingMarks azzerati)');
        // caret di nuovo in testo normale → nessuno stato stantio dal vecchio pending
        r = env.doc.createRange();
        r.setStart(ed.children[0].firstChild, 0);
        r.collapse(true);
        setRange(env, r);
        await sleep(20);
        ok(!underBtn.classList.contains('on'), '4.2 caret successivo: nessun pending U stantio');

        // ---------- 4.2 D2(d): digitazione pulita ----------
        ed.innerHTML = '<p>parola</p>';
        const tP = ed.querySelector('p').firstChild;
        r = env.doc.createRange();
        r.setStart(tP, tP.length);
        r.collapse(true);
        setRange(env, r);
        click(env, boldBtn);
        await sleep(20);
        ok(boldBtn.classList.contains('on'), '4.2 setup digitazione: pending B ON con caret');
        // simula digitazione: inserisce un text node al caret + evento input
        const selNow = env.win.getSelection();
        const rNow = selNow.getRangeAt(0).cloneRange();
        rNow.insertNode(env.doc.createTextNode('X'));
        editorOf(env).dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(30);
        ok(!boldBtn.classList.contains('on'), '4.2 digitazione: input azzera il pending (stato non stantio)');
        ok(!ed.querySelector('b') && ed.textContent.indexOf('parolaX') >= 0,
            '4.2 digitazione pulita: testo inserito senza mark ereditati', ed.innerHTML);

        // ---------- 4.1 D1: la LISTA usa ancora .doc-status ----------
        const cont = env.doc.getElementById('main');
        cont.innerHTML = '';
        env.win.StudyTools.documenti.render(cont);
        await sleep(350);
        ok(!!$(env, '.doc-shell .doc-status'), '4.1 la schermata LISTA usa ancora .doc-status');
        ok(!$(env, '.doc-pill'), '4.1 nessuna pill overlay nella LISTA');

        // ---------- B3 R21: montaggio FontiPanel in DOCUMENTI ----------
        console.log(' == B3 - Documenti: pannello Fonti ==');
        const err0 = env.consoleErrors.length;
        const idFp = await openDoc(env, { html: '<p>Documento per le fonti</p>' });
        const fBtn = $$(env, '.doc-bar button').filter(b => /pannello Fonti/.test(b.title || ''))[0];
        ok(!!fBtn && fBtn.textContent.trim() === 'Fonti', 'B3 bottone "Fonti" nella toolbar dell\'editor',
            fBtn ? fBtn.textContent : 'assente');
        if (fBtn) click(env, fBtn);
        await sleep(60);
        const fpRoot = $(env, '.doc-shell .fp21-root');
        ok(!!fpRoot && fpRoot.getAttribute('data-fp21') === 'documenti',
            'B3 click → .fp21-root montato nel root editor con contesto "documenti"',
            fpRoot ? fpRoot.getAttribute('data-fp21') : 'assente');
        const fpIns = fpRoot ? fpRoot.querySelector('.fp21-insert') : null;
        ok(!!fpIns && fpIns.textContent === 'Inserisci nel documento' && fpIns.disabled === true,
            'B3 insert label "Inserisci nel documento" disabilitato senza selezione',
            fpIns ? fpIns.textContent + ' disabled=' + fpIns.disabled : 'assente');
        const fpItem = fpRoot ? fpRoot.querySelector('.fp21-item') : null;
        ok(!!fpItem, 'B3 lista fonti con almeno una voce');
        if (fpItem && fpIns) {
            click(env, fpItem);
            await sleep(100);
            ok(fpIns.disabled === false, 'B3 selezione prima voce → insert abilitato');
            click(env, fpIns);
            await sleep(50);
            const blk = editorOf(env).querySelector('p[data-fp-src]');
            ok(!!blk && /^📎/.test(blk.textContent) && !!blk.getAttribute('data-fp-tipo'),
                'B3 onInsert → blocco 📎 con data-fp-src/data-fp-tipo nel documento',
                blk ? blk.textContent : 'assente');
            await sleep(1000);   // flush autosave (debounce 900ms)
            let pl1 = null;
            try { pl1 = JSON.parse(env.store.items.filter(x => x.id === idFp)[0].content); } catch (e) { pl1 = null; }
            ok(!!pl1 && /data-fp-src/.test(pl1.html || '') &&
                !!(pl1.fpSources && pl1.fpSources.length && pl1.fpSources[0].tipo && pl1.fpSources[0].fonteId != null),
                'B3 modello: html con ref + metadata fpSources {tipo,titolo,fonteId,ts}',
                pl1 && pl1.fpSources ? JSON.stringify(pl1.fpSources[0]) : 'parse fallito');
            // undo: stack snapshot D2 (push PRIMA dell'inserimento)
            const evFpZ = keydown(env, editorOf(env), 'z', true);
            await sleep(50);
            ok(evFpZ.defaultPrevented === true && !editorOf(env).querySelector('p[data-fp-src]'),
                'B3 undo (Ctrl+Z) rimuove il blocco fonte dal documento');
            await sleep(1000);   // flush dopo undo
            let pl2 = null;
            try { pl2 = JSON.parse(env.store.items.filter(x => x.id === idFp)[0].content); } catch (e) { pl2 = null; }
            ok(!!pl2 && !/data-fp-src/.test(pl2.html || ''),
                'B3 modello dopo undo: ref rimosso (fpSources resta come registro)',
                pl2 ? String(/data-fp-src/.test(pl2.html || '')) : 'parse fallito');
        }
        // chiusura pulita: toggle + navigazione (destroy in detachGlobal)
        if (fBtn) click(env, fBtn);
        await sleep(40);
        ok(!$(env, '.fp21-root'), 'B3 secondo click → pannello chiuso (destroy pulito)');
        if (fBtn) click(env, fBtn);
        await sleep(40);
        ok(!!$(env, '.fp21-root'), 'B3 riapertura del pannello ok');
        const backFp = btnByTitle(env, /Torna all/);
        if (backFp) { click(env, backFp); await sleep(150); }
        ok(!$(env, '.fp21-root') && !btnByTitle(env, /pannello Fonti/),
            'B3 navigazione all\'elenco: pannello distrutto e bottone solo in editor');
        ok(env.consoleErrors.length === err0, 'B3 zero eccezioni console',
            env.consoleErrors.slice(err0).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI DOCUMENTI: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
