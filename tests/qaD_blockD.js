/* ============================================================
   tests/qaD_blockD.js — QA-D (Coordinatore StudioIA_7)
   Verifica indipendente del BLOCCO D (Documenti) — punti 1-10.
   Read-only su web_frontend/; uno solo script tests/qaD_*.js.
   Eseguire con: node tests/qaD_blockD.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_REL = path.join('web_frontend', 'html', 'js', 'modules', 'documenti.js');
const SRC = fs.readFileSync(path.join(ROOT, SRC_REL), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- risultati per punto ---------- */
const points = {};
function P(no, title) { points[no] = { title: title, pass: true, ev: [] }; }
function ev(no, msg) { msg = String(msg); points[no].ev.push(msg); console.log('  [E' + no + '] ' + msg); }
function chk(no, cond, msg, extra) {
    if (!cond) {
        points[no].pass = false;
        const e = msg + (extra ? ' -> ' + extra : '');
        points[no].ev.push('FAIL: ' + e);
        console.log('  [FAIL P' + no + '] ' + e);
    }
    return !!cond;
}
function lineOf(substr) {
    const i = SRC.indexOf(substr);
    if (i < 0) return -1;
    return SRC.slice(0, i).split('\n').length;
}

/* ---------- harness jsdom (stesso boot di documentiUi.test.js) ---------- */
function makeEnv() {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only'
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
        empty: (icon, text, btnText, onClick) => { const d = el('div', 'app-empty'); d.appendChild(el('p', null, text)); return d; },
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
    const env = { dom: dom, win: win, doc: doc, store: store, confirmCalls: [], confirmResult: true };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
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
function editorOf(env) { return env.doc.querySelector('.doc-paper'); }
function btnByTitle(env, re) { return $$(env, 'button').filter(b => re.test(b.title || ''))[0] || null; }
function keydown(env, target, key, ctrl) {
    const ev = new env.win.KeyboardEvent('keydown', { key: key, ctrlKey: !!ctrl, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}

/* ============================================================ */
async function main() {
    console.log('== QA-D: verifica BLOCCO D (Documenti) — punti 1..10 ==');

    P(1, 'Pill basso-sx stats+pagina (senza %), pill basso-dx zoom completo, absolute in .doc-main');
    P(2, 'Nessuna fascia .doc-status nel SHELL editor; LISTA conserva il suo .doc-status');
    P(3, 'Area documento fino al bordo inferiore: nessun margin/morto/fascia sotto il canvas');
    P(4, 'Toggle B/I/U/S: selezione non marcata→applica, marcata→rimuove; caret=pending ON/OFF coerente');
    P(5, 'Sync bottoni: .on = stile della selezione corrente dopo ogni selectionchange');
    P(6, 'Digitazione pulita: pending non eredita mark indesiderati (typingMarks azzerati)');
    P(7, 'Mark nidificati b>i>u: rimozione singola per livello senza residui');
    P(8, 'Ctrl+Z annulla operazione di stile, Ctrl+Y ripristina; anche bottone Annulla');
    P(9, 'D3: Adatta scala oltre 100%; altezza foglio = contenuto (niente multipli); pager/zoom % aggiornati');
    P(10, 'Regressione: node --check + documentiUi.test.js -> 0 falliti (totale reale)');

    try {
        const env = makeEnv();
        await openDoc(env);

        const shellE = $(env, '.doc-shell');
        const mainE = $(env, '.doc-main');
        const canvasE = $(env, '.doc-canvas');
        const pillL = $(env, '.doc-pill-l');
        const pillR = $(env, '.doc-pill-r');
        const zval = $(env, '.doc-zoomval');
        const zoomEl = $(env, '.doc-zoom');
        const stage = $(env, '.doc-stage');
        const ed = editorOf(env);

        // ===== PUNTO 1: PILL =====
        console.log('\n--- PUNTO 1 (D1: pill overlay) ---');
        chk(1, !!shellE, 'shell editor presente');
        chk(1, !!pillL && pillL.parentElement === mainE, 'pill sinistra dentro .doc-main',
            pillL ? 'parent=' + (pillL.parentElement && pillL.parentElement.className) : 'assente');
        chk(1, !!pillR && pillR.parentElement === mainE, 'pill destra dentro .doc-main',
            pillR ? 'parent=' + (pillR.parentElement && pillR.parentElement.className) : 'assente');
        const csL = pillL ? env.win.getComputedStyle(pillL) : null;
        const csR = pillR ? env.win.getComputedStyle(pillR) : null;
        chk(1, !!csL && csL.position === 'absolute' && csL.bottom === '10px' && csL.left === '12px',
            'pill-L assoluta bottom-left',
            csL ? 'position=' + csL.position + ' bottom=' + csL.bottom + ' left=' + csL.left : '');
        chk(1, !!csR && csR.position === 'absolute' && csR.bottom === '10px' && csR.right === '12px',
            'pill-R assoluta bottom-right',
            csR ? 'position=' + csR.position + ' bottom=' + csR.bottom + ' right=' + csR.right : '');
        const ptL = (pillL && pillL.textContent) || '';
        chk(1, /\d+ parole/.test(ptL) && /·/.test(ptL) && /Pagina \d+\/\d+/.test(ptL),
            'pill-L: "N parole . M caratteri . Pagina x/y"', JSON.stringify(ptL));
        chk(1, !/\d+\s*%/.test(ptL), 'pill-L senza % di zoom', JSON.stringify(ptL));
        ev(1, 'pill-L text = ' + JSON.stringify(ptL.trim()));

        const zgrp = $(env, '.doc-zoomgrp');
        chk(1, !!zgrp && pillR.contains(zgrp), 'gruppo zoom presente in pill-R');
        const bOut = btnByTitle(env, /Riduci zoom/);
        const bIn = btnByTitle(env, /Aumenta zoom/);
        const bFit = btnByTitle(env, /Adatta la pagina/);
        const b100 = btnByTitle(env, /Zoom al 100%/);
        chk(1, !!(bOut && bIn && bFit && b100 && zval), 'controlli [−][%][+][Adatta][100%] tutti presenti');
        function zinfo() {
            const t = (zval && zval.textContent) || '';
            const m = ((zoomEl && zoomEl.style.transform) || '').match(/scale\(([\d.]+)\)/);
            return { pct: parseInt(t, 10), scale: m ? parseFloat(m[1]) : 1, raw: t, tf: (zoomEl && zoomEl.style.transform) || '' };
        }
        click(env, bIn); await sleep(30);
        let z = zinfo();
        chk(1, z.pct === 110 && Math.round(z.scale * 100) === 110,
            '+ cambia st.zoomLevel: zoomval=110% e transform=scale(1.1)', 'zoomval=' + z.raw + ' tf=' + z.tf);
        click(env, bOut); await sleep(30);
        z = zinfo();
        chk(1, z.pct === 100, '- ritorna a 100%', 'zoomval=' + z.raw);
        // Adatta con spazio misurabile (stub): scala st.zoomLevel oltre 100%
        Object.defineProperty(canvasE, 'clientHeight', { value: 2000, configurable: true });
        Object.defineProperty(canvasE, 'clientWidth', { value: 1500, configurable: true });
        click(env, bFit); await sleep(40);
        z = zinfo();
        chk(1, z.pct > 100 && Math.round(z.scale * 100) === z.pct,
            'Adatta cambia st.zoomLevel/zoomval (zoomval coerente con transform)', 'zoomval=' + z.raw + ' tf=' + z.tf);
        ev(1, 'Adatta: zoomval=' + z.raw + ' transform=' + z.tf + ' (st.zoomLevel=' + z.scale + ')');
        click(env, b100); await sleep(30);
        z = zinfo();
        chk(1, z.pct === 100, '100% resetta lo zoom', 'zoomval=' + z.raw);
        delete canvasE.clientHeight; delete canvasE.clientWidth;
        chk(1, csL.pointerEvents === 'none' && env.win.getComputedStyle(bOut).pointerEvents === 'auto',
            'pointer-events: container pill=none, bottoni=auto',
            csL.pointerEvents + ' / ' + env.win.getComputedStyle(bOut).pointerEvents);
        const cssPill = (SRC.match(/\.doc-pill\{[^}]*\}/) || [''])[0];
        chk(1, cssPill.indexOf('position:absolute') >= 0 && cssPill.indexOf('bottom:10px') >= 0,
            'CSS .doc-pill: position:absolute;bottom:10px', cssPill.slice(0, 90) + '...');
        chk(1, lineOf('.doc-pill-l{left:12px') > 0 && lineOf('.doc-pill-r{right:12px') > 0,
            'CSS .doc-pill-l{left:12px...} e .doc-pill-r{right:12px...}',
            'righe ' + lineOf('.doc-pill-l{left:12px') + '/' + lineOf('.doc-pill-r{right:12px'));
        chk(1, SRC.indexOf('.doc-bar,.doc-status,.doc-pill,') >= 0,
            'print: .doc-pill + .doc-status nascoste (riga ' + lineOf('.doc-bar,.doc-status,.doc-pill,') + ')');

        // ===== PUNTO 2: .doc-status solo nella LISTA =====
        console.log('\n--- PUNTO 2 (D1: .doc-status rimossa dal shell editor) ---');
        const stCountEditor = shellE.querySelectorAll('.doc-status').length;
        const stCountContainer = env.doc.getElementById('main').querySelectorAll('.doc-status').length;
        chk(2, stCountEditor === 0, 'zero .doc-status dentro .doc-shell dell\'editor',
            'count=' + stCountEditor);
        chk(2, stCountContainer === 0, 'zero .doc-status nel container dell\'editor',
            'count=' + stCountContainer);
        ev(2, 'openEditor: .doc-status in .doc-shell=' + stCountEditor +
            ', .doc-pill=' + shellE.querySelectorAll('.doc-pill').length +
            ', .doc-pill-l=' + shellE.querySelectorAll('.doc-pill-l').length +
            ', .doc-pill-r=' + shellE.querySelectorAll('.doc-pill-r').length);

        // ===== PUNTO 3: area documento senza fascia sotto =====
        console.log('\n--- PUNTO 3 (D1: nessuna fascia/morto sotto il canvas) ---');
        const csMain = env.win.getComputedStyle(mainE);
        const csCanvas = env.win.getComputedStyle(canvasE);
        // jsdom restituisce "0" (unitless) per margini di default: 0, 0px o vuoto = nessun margine
        const norm = v => (v == null ? '' : String(v)).trim().replace(/px$/, '');
        chk(3, norm(csMain.marginBottom) === '' || norm(csMain.marginBottom) === '0',
            '.doc-main senza margin-bottom', 'marginBottom=' + JSON.stringify(csMain.marginBottom));
        chk(3, norm(csCanvas.marginBottom) === '' || norm(csCanvas.marginBottom) === '0',
            '.doc-canvas senza margin-bottom', 'marginBottom=' + JSON.stringify(csCanvas.marginBottom));
        ev(3, 'marginBottom computati: .doc-main=' + JSON.stringify(csMain.marginBottom) +
            ', .doc-canvas=' + JSON.stringify(csCanvas.marginBottom));
        chk(3, mainE.style.marginBottom === '' && canvasE.style.marginBottom === '',
            'nessun margin-bottom inline su .doc-main/.doc-canvas');
        const kids = Array.from(mainE.children);
        const idxC = kids.indexOf(canvasE);
        const after = idxC >= 0 ? kids.slice(idxC + 1) : [];
        const inflow = after.filter(el => {
            const p = env.win.getComputedStyle(el).position;
            return p !== 'absolute' && p !== 'fixed';
        });
        chk(3, idxC >= 0, '.doc-canvas è figlio di .doc-main');
        chk(3, inflow.length === 0, 'nessun fratello in-flusso dopo .doc-canvas (le pill sono absolute)',
            after.map(e => e.className + '[' + env.win.getComputedStyle(e).position + ']').join(', '));
        ev(3, 'fratelli dopo .doc-canvas: ' +
            (after.length ? after.map(e => e.className + '[' + env.win.getComputedStyle(e).position + ']').join(', ') : '(nessuno)'));
        ev(3, 'figli di .doc-shell (editor): ' + Array.from(shellE.children).map(e => e.className).join(' | '));
        chk(3, Array.from(shellE.children).filter(e => String(e.className).indexOf('doc-status') >= 0).length === 0,
            'nessun figlio status/banda nel shell editor');
        const cssMain = (SRC.match(/\.doc-main\{[^}]*\}/) || [''])[0];
        const cssCanvas = (SRC.match(/\.doc-canvas\{[^}]*\}/) || [''])[0];
        chk(3, !!cssMain && !/margin/.test(cssMain), 'CSS .doc-main senza margini fissi (riga ' + lineOf('.doc-main{flex') + ')', cssMain);
        chk(3, !!cssCanvas && !/margin-bottom/.test(cssCanvas) && !(/margin:/.test(cssCanvas) && !/margin:0/.test(cssCanvas)),
            'CSS .doc-canvas senza margin-bottom', cssCanvas.slice(0, 120) + '...');
        ev(3, 'CSS: ' + cssMain);
        ev(3, 'CSS: ' + cssCanvas.slice(0, 150) + '...');

        // ===== PUNTO 4: toggle B/I/U/S (selezione + caret) =====
        console.log('\n--- PUNTO 4 (D2: toggle mark B/I/U/S) ---');
        // jsdom non riflette contentEditable in attributo/proprietà (nota in documentiUi.test.js):
        // editor presente + set contentEditable in sorgente; i test funzionali P4-P7 provano l'editing
        const ceAttr = ed ? ed.getAttribute('contenteditable') : null;
        const ceProp = ed ? ed.contentEditable : null;
        chk(4, !!ed && lineOf("paper.contentEditable = 'true'") > 0 &&
            (ceAttr === 'true' || ceProp === 'true' || ceAttr == null || ceProp == null),
            'editor contenteditable presente (set su .doc-paper riga ' + lineOf("paper.contentEditable = 'true'") + ')',
            'attr=' + ceAttr + ' prop=' + ceProp);
        ev(4, 'contenteditable: attr=' + JSON.stringify(ceAttr) + ' prop=' + JSON.stringify(ceProp) +
            ' (jsdom: non riflessa — editing provato dai toggle sotto)');
        const bB = btnByTitle(env, /^Grassetto/);
        const bI = btnByTitle(env, /^Corsivo/);
        const bU = btnByTitle(env, /^Sottolineato/);
        const bS = btnByTitle(env, /^Barrato/);
        chk(4, !!(bB && bI && bU && bS), 'pulsanti B/I/U/S presenti',
            [!!bB, !!bI, !!bU, !!bS].join(','));
        const selCases = [
            { n: 'B', btn: bB, txt: 'testoB', sel: 'b', any: 'b,strong' },
            { n: 'I', btn: bI, txt: 'testoI', sel: 'i', any: 'i,em' },
            { n: 'U', btn: bU, txt: 'testoU', sel: 'u', any: 'u' },
            { n: 'S', btn: bS, txt: 'testoS', sel: 's', any: 's,strike,del' }
        ];
        for (const c of selCases) {
            if (!c.btn) { chk(4, false, c.n + ': pulsante assente'); continue; }
            ed.innerHTML = '<p>' + c.txt + '</p>';
            let r = env.doc.createRange();
            r.selectNodeContents(ed.querySelector('p').firstChild);
            setRange(env, r); await sleep(20);
            chk(4, !c.btn.classList.contains('on'), c.n + ': selezione non marcata -> stato off');
            click(env, c.btn); await sleep(30);
            const applied = ed.querySelector(c.any);
            chk(4, !!applied && ed.textContent === c.txt, c.n + ': selezione non marcata -> APPLICA', ed.innerHTML);
            chk(4, c.btn.classList.contains('on'), c.n + ': bottone .on dopo applicazione');
            if (applied && applied.firstChild) {
                r = env.doc.createRange();
                r.selectNodeContents(applied.firstChild);
                setRange(env, r); await sleep(20);
            }
            click(env, c.btn); await sleep(30);
            chk(4, !ed.querySelector(c.any) && ed.textContent === c.txt, c.n + ': selezione marcata -> RIMUOVE (no residui)', ed.innerHTML);
            chk(4, !c.btn.classList.contains('on'), c.n + ': bottone off dopo rimozione');
            chk(4, ed.querySelectorAll('b,strong,i,em,u,s,strike,del').length === 0, c.n + ': zero tag residui');
        }
        for (const c of selCases) {
            if (!c.btn) continue;
            ed.innerHTML = '<p>caret ' + c.n + '</p>';
            const tn = ed.querySelector('p').firstChild;
            let r = env.doc.createRange();
            r.setStart(tn, tn.length); r.collapse(true);
            setRange(env, r); await sleep(20);
            chk(4, !c.btn.classList.contains('on'), c.n + ' caret: stato iniziale off');
            click(env, c.btn); await sleep(25);
            chk(4, c.btn.classList.contains('on'), c.n + ' caret: click ON (pending coerente)');
            click(env, c.btn); await sleep(25);
            chk(4, !c.btn.classList.contains('on'), c.n + ' caret: secondo click OFF (pending coerente)');
        }
        ev(4, '4 toggle con selezione (apply/remove) + 4 toggle caret (pending ON/OFF) su B/I/U/S');

        // ===== PUNTO 5: sync bottoni su selectionchange =====
        console.log('\n--- PUNTO 5 (D2: sync .on = stato selezione) ---');
        ed.innerHTML = '<p><b>BB CC</b>DD</p>';
        const bNode = ed.querySelector('b').firstChild;
        const dNode = ed.querySelector('p').lastChild;
        let r = env.doc.createRange();
        r.selectNodeContents(bNode); setRange(env, r); await sleep(20);
        chk(5, bB.classList.contains('on'), 'selezione dentro <b> -> B .on (solo selectionchange, senza click)');
        r = env.doc.createRange();
        r.selectNodeContents(dNode); setRange(env, r); await sleep(20);
        chk(5, !bB.classList.contains('on'), 'selezione su testo normale -> B off');
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p')); setRange(env, r); await sleep(20);
        chk(5, !bB.classList.contains('on'), 'selezione PARZIALMENTE grassetta -> B off (coerente con "click applicherebbe")');
        ed.innerHTML = '<p><i>ii</i>uu</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('i').firstChild); setRange(env, r); await sleep(20);
        chk(5, bI.classList.contains('on'), 'selezione dentro <i> -> I .on');
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').lastChild); setRange(env, r); await sleep(20);
        chk(5, !bI.classList.contains('on'), 'selezione su testo normale -> I off');
        // pending caret cancellato da selezione estesa
        ed.innerHTML = '<p>alpha beta</p>';
        const tEnd = ed.querySelector('p').firstChild;
        r = env.doc.createRange();
        r.setStart(tEnd, tEnd.length); r.collapse(true); setRange(env, r); await sleep(20);
        click(env, bU); await sleep(20);
        chk(5, bU.classList.contains('on'), 'caret: U pending ON');
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild); setRange(env, r); await sleep(20);
        chk(5, !bU.classList.contains('on'), 'selezione estesa su plain -> U off (pending azzerato su selectionchange)');
        ev(5, 'stati osservati: B on/<b>, off/DD, off/parziale; I on/<i>, off/uu; U pending on -> off');

        // ===== PUNTO 6: digitazione pulita =====
        console.log('\n--- PUNTO 6 (D2: digitazione senza mark ereditati) ---');
        ed.innerHTML = '<p>parola</p>';
        const tP = ed.querySelector('p').firstChild;
        r = env.doc.createRange();
        r.setStart(tP, tP.length); r.collapse(true);
        setRange(env, r); await sleep(20);
        click(env, bB); await sleep(25);
        chk(6, bB.classList.contains('on'), 'caret: pending B ON');
        const selN = env.win.getSelection();
        const rNow = selN.getRangeAt(0).cloneRange();
        rNow.insertNode(env.doc.createTextNode('X'));
        ed.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(30);
        chk(6, !bB.classList.contains('on'), 'dopo input: pending azzerato (bottone non stantio)');
        chk(6, !ed.querySelector('b,strong') && ed.textContent.indexOf('parolaX') >= 0,
            'testo inserito SENZA mark ereditati', ed.innerHTML);
        r = env.doc.createRange();
        r.setStart(ed.querySelector('p').firstChild, 0); r.collapse(true);
        setRange(env, r); await sleep(20);
        chk(6, !bB.classList.contains('on'), 'caret spostato + selectionchange: nessun pending B stantio');
        ev(6, 'HTML dopo digitazione: ' + ed.innerHTML);
        ev(6, 'sorgente: input->typingMarks=null riga ' + lineOf('D2(d): niente pending stantio dopo la digitazione') +
            '; selectionchange->typingMarks=null riga ' + lineOf('D2(d): niente pending caret stantio'));

        // ===== PUNTO 7: anello b>i>u =====
        console.log('\n--- PUNTO 7 (D2: anello nidificato) ---');
        ed.innerHTML = '<p>anello</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild); setRange(env, r);
        click(env, bB); await sleep(30);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('b')); setRange(env, r);
        click(env, bI); await sleep(30);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('i')); setRange(env, r);
        click(env, bU); await sleep(30);
        chk(7, ed.innerHTML === '<p><b><i><u>anello</u></i></b></p>', 'applicazione b>i>u annidati', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p')); setRange(env, r);
        click(env, bU); await sleep(30);
        chk(7, ed.innerHTML === '<p><b><i>anello</i></b></p>', 'rimozione U: b>i intatti (nessun residuo)', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p')); setRange(env, r);
        click(env, bI); await sleep(30);
        chk(7, ed.innerHTML === '<p><b>anello</b></p>', 'rimozione I: b intatto', ed.innerHTML);
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p')); setRange(env, r);
        click(env, bB); await sleep(30);
        chk(7, ed.innerHTML === '<p>anello</p>' && ed.querySelectorAll('b,strong,i,em,u,s,strike').length === 0,
            'rimozione B: nessun residuo, testo intatto', ed.innerHTML);
        ev(7, 'HTML finale anello: ' + ed.innerHTML);

        // ===== PUNTO 8: Ctrl+Z / Ctrl+Y / bottone Annulla =====
        console.log('\n--- PUNTO 8 (D2: undo/redo custom) ---');
        ed.innerHTML = '<p>testo undo</p>';
        r = env.doc.createRange();
        r.selectNodeContents(ed.querySelector('p').firstChild); setRange(env, r);
        click(env, bB); await sleep(30);
        chk(8, ed.innerHTML === '<p><b>testo undo</b></p>', 'setup: B applicato', ed.innerHTML);
        const evZ = keydown(env, ed, 'z', true); await sleep(30);
        chk(8, evZ.defaultPrevented === true, 'Ctrl+Z intercettato (preventDefault)');
        chk(8, ed.innerHTML === '<p>testo undo</p>', 'Ctrl+Z ANNULLA l\'operazione di stile', ed.innerHTML);
        chk(8, !bB.classList.contains('on'), 'Ctrl+Z: stato B off dopo annullamento');
        const evY = keydown(env, ed, 'y', true); await sleep(30);
        chk(8, evY.defaultPrevented === true, 'Ctrl+Y intercettato');
        chk(8, ed.innerHTML === '<p><b>testo undo</b></p>', 'Ctrl+Y RIPRISTINA lo stile', ed.innerHTML);
        const undoBtn = btnByTitle(env, /^Annulla/);
        const redoBtn = btnByTitle(env, /^Ripeti/);
        chk(8, !!(undoBtn && redoBtn), 'bottoni Annulla/Ripristina presenti');
        click(env, undoBtn); await sleep(30);
        chk(8, ed.innerHTML === '<p>testo undo</p>', 'bottone Annulla usa lo stack custom (B annullato)', ed.innerHTML);
        click(env, redoBtn); await sleep(30);
        chk(8, ed.innerHTML === '<p><b>testo undo</b></p>', 'bottone Ripristina', ed.innerHTML);
        ev(8, 'keydown listener Ctrl+Z/Y riga ' + lineOf("shell.addEventListener('keydown'") +
            '; undoCmd riga ' + lineOf('function undoCmd()') +
            '; bottone Annulla riga ' + lineOf("'Annulla (Ctrl+Z)'") +
            '; pushUndo su serializeHtml riga ' + lineOf('st.undoStack.push(serializeHtml())'));

        // ===== PUNTO 9: D3 — Adatta >100%, altezza esatta, pager/zoom =====
        console.log('\n--- PUNTO 9 (D3: fitZoom senza cap + foglio ad altezza esatta) ---');
        const fitLine = SRC.match(/let z = Math\.min\(availH \/ PAGE_H[^\n]*/);
        ev(9, 'sorgente fitZoom: ' + (fitLine ? fitLine[0].trim() : '(non trovato)') + ' (riga ' + lineOf('let z = Math.min(availH / PAGE_H') + ')');
        chk(9, SRC.indexOf('let z = Math.min(availH / PAGE_H, availW / PAGE_W, 3)') >= 0 &&
            SRC.indexOf('/ PAGE_H, 1)') < 0,
            'fitZoom: cap 100% rimosso (nessun min(...,1))', fitLine ? fitLine[0].trim() : '');
        Object.defineProperty(canvasE, 'clientHeight', { value: 2000, configurable: true });
        Object.defineProperty(canvasE, 'clientWidth', { value: 1500, configurable: true });
        click(env, bFit); await sleep(40);
        z = zinfo();
        chk(9, z.pct > 100, 'Adatta scala la pagina OLTRE 100%', 'zoomval=' + z.raw);
        chk(9, z.pct === 176, 'Adatta -> 176% atteso = min(1980/1123, 1484/794, 3)', 'zoomval=' + z.raw);
        chk(9, !!stage && stage.style.height === '1980px',
            'stage a piena altezza disponibile (nessuna fascia morta sotto)', stage && stage.style.height);
        ev(9, 'Adatta: zoomval=' + z.raw + ' transform=' + z.tf + ' stage.height=' + (stage && stage.style.height));
        // altezza foglio esatta
        const paper = editorOf(env);
        Object.defineProperty(paper, 'scrollHeight', { value: 1500, configurable: true });
        paper.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(150);
        const sheet = $(env, '.doc-page');
        chk(9, !!sheet && sheet.style.minHeight === '1640px',
            'foglio ad altezza ESATTA al contenuto (1640px, non 2246px di multipli)', sheet && sheet.style.minHeight);
        ev(9, 'natural=scrollHeight 1500 + 2*70 = 1640 -> minHeight=' + (sheet && sheet.style.minHeight) +
            '; la vecchia formula a multipli di PAGE_H avrebbe dato 2246px');
        const brks = $$(env, '.doc-break');
        chk(9, brks.length === 1 && brks[0].style.top === '1123px',
            'paginazione preservata (1 separatore a 1123px, 2 pagine)', brks.map(b => b.style.top).join(','));
        chk(9, /Pagina 1\/2/.test(pillL.textContent), 'pager aggiornato -> Pagina 1/2', pillL.textContent);
        chk(9, /176%/.test(zval.textContent), 'zoom % aggiornato dopo relayout', zval.textContent);
        // secondo caso: contenuto non multipla di PAGE_H
        Object.defineProperty(paper, 'scrollHeight', { value: 1124, configurable: true });
        paper.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(150);
        chk(9, !!sheet && sheet.style.minHeight === '1264px',
            'altezza non arrotondata a multipli (1264px, non 2246px)', sheet && sheet.style.minHeight);
        ev(9, 'natural=1124+140=1264 -> minHeight=' + (sheet && sheet.style.minHeight));
        // pager via scroll
        click(env, b100); await sleep(30);
        canvasE.scrollTop = 1500;
        canvasE.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        chk(9, /Pagina 2\/2/.test(pillL.textContent), 'scroll canvas -> pager Pagina 2/2', pillL.textContent);
        canvasE.scrollTop = 0;
        canvasE.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        // pulizia stub
        delete canvasE.clientHeight; delete canvasE.clientWidth; delete paper.scrollHeight;
        paper.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(120);

        // ===== PUNTO 2 (fine): la LISTA conserva .doc-status =====
        console.log('\n--- PUNTO 2b (LISTA con .doc-status) ---');
        const cont = env.doc.getElementById('main');
        cont.innerHTML = '';
        env.win.StudyTools.documenti.render(cont);
        await sleep(400);
        const listStatus = cont.querySelectorAll('.doc-shell .doc-status').length;
        const listPills = cont.querySelectorAll('.doc-pill').length;
        chk(2, listStatus >= 1, 'schermata LISTA conserva il suo .doc-status', 'count=' + listStatus);
        chk(2, listPills === 0, 'nessuna pill overlay nella LISTA', 'count=' + listPills);
        ev(2, 'LISTA: .doc-status=' + listStatus + ', .doc-pill=' + listPills +
            ' (sorgente creazione status riga ' + lineOf("App.el('div', 'doc-status')") + ')');

        // ===== PUNTO 10: regressione =====
        console.log('\n--- PUNTO 10 (regressione) ---');
        try {
            execSync('node --check "' + path.join(ROOT, SRC_REL) + '"', { cwd: ROOT, stdio: 'pipe' });
            chk(10, true, 'node --check documenti.js -> OK');
        } catch (e) {
            chk(10, false, 'node --check documenti.js -> ERRORE',
                String((e && e.stdout) || (e && e.message) || '').slice(0, 300));
        }
        let out = '';
        try {
            out = execSync('node "' + path.join(ROOT, 'tests', 'documentiUi.test.js') + '"',
                { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) {
            out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
        }
        const mm = out.match(/RISULTATI DOCUMENTI: (\d+) passati, (\d+) falliti/);
        chk(10, !!mm && parseInt(mm[2], 10) === 0,
            'node tests\\documentiUi.test.js -> 0 falliti (totale reale)',
            mm ? 'passati=' + mm[1] + ' falliti=' + mm[2] : 'output non letto: ' + out.slice(-300));
        if (mm) ev(10, 'totale reale: ' + mm[1] + ' passati / ' +
            (parseInt(mm[1], 10) + parseInt(mm[2], 10)) + ' totali, ' + mm[2] + ' falliti');

    } catch (e) {
        const n = 0; // eccezione imprevista: marchia il primo punto ancora aperto come fallito
        console.log('ECCEZIONE QA-D: ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e));
        for (const k of Object.keys(points)) {
            if (points[k].ev.length === 0 || points[k].pass) {
                if (!points[k].ev.some(x => x.indexOf('FAIL: ECCEZIONE') === 0)) {
                    points[k].pass = false;
                    points[k].ev.push('FAIL: ECCEZIONE -> ' + e);
                }
                break;
            }
        }
    }

    console.log('\n===== QA-D: ESITO PER PUNTO =====');
    let allPass = true, nPass = 0;
    for (const no of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const p = points[no];
        if (!p) { console.log('FAIL P' + no + ' — punto non eseguito'); allPass = false; continue; }
        console.log((p.pass ? 'PASS' : 'FAIL') + '  P' + no + ' — ' + p.title);
        if (p.pass) nPass++; else allPass = false;
    }
    console.log('\nVERDETTO FINALE QA-D: ' + (allPass ? 'PASS' : 'FAIL') + ' (' + nPass + '/10 punti)');
    process.exit(allPass ? 0 : 1);
}
main();
