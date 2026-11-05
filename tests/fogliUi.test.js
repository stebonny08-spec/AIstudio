/* ============================================================
   tests/fogliUi.test.js — BLOCCO 5: motore di calcolo, funzioni,
   errori e documentazione integrata "?" (verifica via UI).

   Nota: in jsdom un recalc della griglia piena (26×60) costa ~6s,
   quindi i dati/formule sono seminati nel content e valutati
   all'apertura (pipeline reale renderGrid+recalcAndPaint); poi solo
   3 modifiche live per verificare il ricalcolo automatico.
   Eseguire con: node tests/fogliUi.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
// R21 B4: FontiPanel caricato PRIMA del modulo ospitante (pattern SRC_PANEL di tests/_ink_env.js)
const SRC_PANEL = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fogli.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    // jsdom non implementa document.elementFromPoint (usato dagli handler di
    // drag range rimasti in attesa di pointerup): shim per non generare errori
    win.document.elementFromPoint = () => null;
    const env = { dom, win, doc, store, errors, confirmCalls: [], confirmResult: true };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
    win.eval(SRC_PANEL);   // R21 B4: pannello Fonti prima del modulo fogli
    win.eval(SRC);
    return env;
}

const SEEDED = {
    sheets: [{
        cells: {
            // dati
            'A1': { v: '10' }, 'A2': { v: '20' }, 'A3': { v: '30' }, 'B1': { v: 'x' },
            // 5.1/5.2/5.3: formule valutate alla pipeline reale di apertura
            'D1': { f: '=SUM(A1:A3)' },
            'D2': { f: '=AVERAGE(A1:A3)' },
            'D3': { f: '=MIN(A1:A3)' },
            'D4': { f: '=MAX(A1:A3)' },
            'D5': { f: '=COUNT(A1:A3)' },
            'D6': { f: '=COUNTA(A1:B3)' },
            'E1': { f: '=IF(A2>=20;"sì";"no")' },
            'E2': { f: '=IF(A2>=25,"sì","no")' },
            'E3': { f: '=AND(A1>0;A2>0)' },
            'E4': { f: '=OR(0>1;A2>0)' },
            'E5': { f: '=NOT(0>1)' },
            'F1': { f: '=CONCAT("Ana";"li")' },
            'F2': { f: '=CONCAT("a","b")' },
            'F3': { f: '=ABS(-5)' },
            'F4': { f: '=ROUND(3.141599;2)' },
            'F5': { f: '=SQRT(9)' },
            'F6': { f: '=POWER(2;10)' },
            'G1': { f: '=sum(A1:A3)' },
            'G2': { f: '=2^3' },
            'G3': { f: '=1<2' },
            'G4': { f: '=(2+3)*5' },
            'G5': { f: '=TRUE' },
            'G6': { f: '=CONCAT("v=";A1)' },
            // 5.4 errori
            'H1': { f: '=1/0' },
            'H2': { f: '=H2+1' },
            'H3': { f: '=ZZ1' },
            'H4': { f: '=NOSUCH()' },
            'H5': { f: '=2+' }
        }
    }]
};

async function openSheet(env) {
    const id = 'f' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'foglio', title: 'Foglio',
        content: JSON.stringify(SEEDED),
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
async function setCell(env, ref, value) {
    selectCell(env, ref);
    const f = $(env, '.fg-formula');
    f.focus();                       // activeElement = barra formula (come nell'uso reale)
    f.value = value;
    f.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(120);
}
function cellText(env, ref) {
    const td = env.doc.querySelector('td[data-ref="' + ref + '"]');
    return td && td.firstChild ? td.firstChild.textContent : null;
}
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }

async function main() {
    try {
        console.log('\n== BLOCCO 5 — Fogli: motore, funzioni, errori, aiuto ==');
        const env = makeEnv();
        await openSheet(env);

        const fbar = $(env, '.fg-formula');
        ok(!!fbar, '5.1 barra formula presente');
        ok(!!fbar && /=2\+2/.test(fbar.placeholder), '5.5 placeholder con esempio funzionante (=2+2)', fbar && fbar.placeholder);

        // ---- 5.1 risultato in cella (valutazione alla pipeline di apertura) ----
        ok(cellText(env, 'D1') === '60', '5.1/5.3 =SUM(A1:A3) → 60 nella cella', cellText(env, 'D1'));

        // ---- 5.3 tutte le funzioni ----
        ok(cellText(env, 'D2') === '20', '5.3 AVERAGE', cellText(env, 'D2'));
        ok(cellText(env, 'D3') === '10', '5.3 MIN', cellText(env, 'D3'));
        ok(cellText(env, 'D4') === '30', '5.3 MAX', cellText(env, 'D4'));
        ok(cellText(env, 'D5') === '3', '5.3 COUNT', cellText(env, 'D5'));
        ok(cellText(env, 'D6') === '4', '5.3 COUNTA', cellText(env, 'D6'));
        ok(cellText(env, 'E1') === 'sì', '5.3 IF con ";"', cellText(env, 'E1'));
        ok(cellText(env, 'E2') === 'no', '5.3 IF con ","', cellText(env, 'E2'));
        ok(cellText(env, 'E3') === 'TRUE', '5.3 AND', cellText(env, 'E3'));
        ok(cellText(env, 'E4') === 'TRUE', '5.3 OR', cellText(env, 'E4'));
        ok(cellText(env, 'E5') === 'TRUE', '5.3 NOT', cellText(env, 'E5'));
        ok(cellText(env, 'F1') === 'Anali', '5.3 CONCAT', cellText(env, 'F1'));
        ok(cellText(env, 'F2') === 'ab', '5.3 CONCAT con ","', cellText(env, 'F2'));
        ok(cellText(env, 'F3') === '5', '5.3 ABS', cellText(env, 'F3'));
        ok(cellText(env, 'F4') === '3.14', '5.3 ROUND(x;n)', cellText(env, 'F4'));
        ok(cellText(env, 'F5') === '3', '5.3 SQRT', cellText(env, 'F5'));
        ok(cellText(env, 'F6') === '1024', '5.3 POWER', cellText(env, 'F6'));
        ok(cellText(env, 'G1') === '60', '5.3 case-insensitive (=sum)', cellText(env, 'G1'));

        // ---- 5.2 operatori/stringhe/booleani ----
        ok(cellText(env, 'G2') === '8', '5.2 potenza ^', cellText(env, 'G2'));
        ok(cellText(env, 'G3') === 'TRUE', '5.2 confronto <', cellText(env, 'G3'));
        ok(cellText(env, 'G4') === '25', '5.2 parentesi', cellText(env, 'G4'));
        ok(cellText(env, 'G5') === 'TRUE', '5.2 letterale TRUE', cellText(env, 'G5'));
        ok(cellText(env, 'G6') === 'v=10', '5.2 stringa + riferimento', cellText(env, 'G6'));

        // ---- 5.4 errori ----
        ok(cellText(env, 'H1') === '#DIV/0!', '5.4 =1/0 → #DIV/0!', cellText(env, 'H1'));
        ok(cellText(env, 'H2') === '#CIRC!', '5.4 ciclo → #CIRC!', cellText(env, 'H2'));
        ok(cellText(env, 'H3') === '#REF!', '5.4 riferimento inesistente → #REF!', cellText(env, 'H3'));
        ok(cellText(env, 'H4') === '#NAME?', '5.4 funzione ignota → #NAME?', cellText(env, 'H4'));
        ok(cellText(env, 'H5') === '#ERR!', '5.4 sintassi errata → #ERR!', cellText(env, 'H5'));

        // ---- 5.1/5.4 interazione live (formula bar + ricalcolo automatico) ----
        await setCell(env, 'I1', '=2+2');
        ok(cellText(env, 'I1') === '4', '5.1 live: =2+2 → 4 nella cella', cellText(env, 'I1'));
        selectCell(env, 'I1');
        await sleep(60);
        ok($(env, '.fg-formula').value === '=2+2', '5.1 live: barra formula = "=2+2"',
            $(env, '.fg-formula').value);

        await setCell(env, 'J1', '=I1*3');
        ok(cellText(env, 'J1') === '12', '5.4 live: J1 dipende da I1 (4*3=12)', cellText(env, 'J1'));

        await setCell(env, 'I1', '5');
        ok(cellText(env, 'J1') === '15', '5.4 live: modificando I1 la formula dipendente si aggiorna (J1=15)',
            cellText(env, 'J1'));
        ok(cellText(env, 'I1') === '5', '5.1 live: valore non-formula grezzo', cellText(env, 'I1'));

        // ---- 5.5 popover "?" con sezione Formule ----
        const helpBtn = $$(env, '.fg-top button').filter(b => b.title === 'Aiuto formule: regola, funzioni ed esempi')[0];
        ok(!!helpBtn, '5.5 pulsante "?" in toolbar');
        if (helpBtn) {
            click(env, helpBtn);
            await sleep(30);
            const pop = $(env, '.fg-menu.fg-formulepop');
            ok(!!pop, '5.5 popover Formule aperto');
            if (pop) {
                const txt = pop.textContent;
                ok(/Formule/.test(txt), '5.5 titolo sezione Formule');
                ok(/ogni formula inizia con/i.test(txt) && /=2\+2/.test(txt), '5.5 regola del prefisso "=" con esempio =2+2');
                ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'AND', 'OR', 'NOT',
                    'CONCAT', 'ABS', 'ROUND', 'SQRT', 'POWER'].forEach(fn => {
                    ok(txt.indexOf(fn) >= 0, '5.5 tabella funzioni: ' + fn);
                });
                ok(/=SUM\(A1:A5\)/.test(txt), '5.5 esempio =SUM(A1:A5)');
                ok(/=IF\(A1>=6,"sì","no"\)/.test(txt), '5.5 esempio =IF(A1>=6,"sì","no")');
                ok(/#CIRC!/.test(txt) && /#DIV\/0!/.test(txt) && /#REF!/.test(txt) && /#NAME\?/.test(txt) && /#ERR!/.test(txt),
                    '5.5 elenco errori');
                const cellsTxt = Array.from(pop.querySelectorAll('td')).map(td => td.textContent);
                ok(cellsTxt.some(t => /IF\(cond;allora;altrimenti\)/.test(t)), '5.5 sintassi per IF nella tabella');
            }
        }

        // ============================================================
        // BLOCCO F — fill handle, pannello Formato cella, toolbar, CSS
        // ============================================================
        const css = $$(env, 'style').map(s => s.textContent).join('\n');

        // ---- F1: fill handle sull'angolo basso-destro del rect ----
        const fill = $(env, '.fg-fill');
        ok(!!fill, 'F1 fill handle presente nel DOM');
        selectCell(env, 'A1');
        await sleep(30);
        ok(!!fill && fill.style.display === 'block', 'F1 fill visibile con selezione');
        let fl = parseInt(fill.style.left, 10), ft = parseInt(fill.style.top, 10);
        ok(fl === 133 && ft === 45, 'F1 angolo cella A1: left=133 top=45 (44+96-7 / 26+26-7)', fl + ',' + ft);
        ok(/\.fg-fill\{[^}]*z-index:7/.test(css), 'F1 fill z-index 7 (sopra header sticky 4/5/6)');

        // range A1:C3 via shift+click su C3: handle = angolo del rect
        const tdC3 = env.doc.querySelector('td[data-ref="C3"]');
        tdC3.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
        await sleep(30);
        const rng = $(env, '.fg-rng');
        ok(!!rng && rng.style.display === 'block', 'F1 range overlay attivo con shift+click');
        if (rng && fill) {
            const rl = parseInt(rng.style.left, 10), rw = parseInt(rng.style.width, 10);
            const rt = parseInt(rng.style.top, 10), rHh = parseInt(rng.style.height, 10);
            ok(rl === 44 && rw === 288 && rt === 26 && rHh === 78, 'F1 geometria rect A1:C3', [rl, rt, rw, rHh].join(','));
            fl = parseInt(fill.style.left, 10); ft = parseInt(fill.style.top, 10);
            ok(fl === rl + rw - 7 && ft === rt + rHh - 7, 'F1 handle sull\'angolo esatto del rect (range)', fl + ',' + ft);
            ok(fl === 325 && ft === 97, 'F1 posizione assoluta angolo range (325,97)', fl + ',' + ft);
        }

        // scroll: handler non deve generare errori (posizionamento automatico
        // dal DOM per celle non-frozen)
        const wrapEl = $(env, '.fg-wrap');
        const errBefore = env.errors.length;
        wrapEl.dispatchEvent(new env.win.Event('scroll'));
        ok(env.errors.length === errBefore, 'F1 dispatch scroll senza errori');

        // resize colonna: updateOverlays agganciato al ridimensionamento
        selectCell(env, 'A1');
        await sleep(20);
        const rhHandle = env.doc.querySelector('span.fg-rh[data-idx="0"]');
        ok(!!rhHandle, 'F1 handle resize colonna presente');
        rhHandle.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 10, button: 0 }));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 10 }));
        fl = parseInt(fill.style.left, 10);
        ok(fl === 163, 'F1 handle segue resize colonna durante il drag (left=163)', String(fill.style.left));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 10 }));
        await sleep(80);
        fl = parseInt(fill.style.left, 10);
        ok(fl === 163, 'F1 handle aggiornato dopo render/resize (left=163)', String(fill.style.left));

        // ---- F2: pannello destro collassabile "Formato cella" ----
        const side = $(env, '.fg-side');
        ok(!!side, 'F2 pannello Formato cella presente');
        ok(!!side && /Formato cella/.test(side.textContent), 'F2 titolo pannello "Formato cella"');
        ok(/\.fg-side\{[^}]*overflow-y:auto/.test(css), 'F2 CSS pannello con overflow-y:auto (stile pp-insp)');
        const top = $(env, '.fg-top');
        ok(!top.querySelector('button[title="Grassetto cella selezionata"]'), 'F2 B rimosso dalla toolbar');
        ok(!top.querySelector('input.fg-color'), 'F2 input colore rimossi dalla toolbar');
        const bBtn2 = side.querySelector('button[title="Grassetto cella selezionata"]');
        const cInp = side.querySelector('input[title="Colore testo"]');
        const bgInp = side.querySelector('input[title="Sfondo cella"]');
        ok(!!bBtn2, 'F2 B nel pannello');
        ok(!!cInp && !!bgInp, 'F2 input colore testo/sfondo nel pannello');

        // B su selezione multi-cella A1:A2 (logica eachSel)
        selectCell(env, 'A1');
        const tdA2 = env.doc.querySelector('td[data-ref="A2"]');
        tdA2.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 40, button: 0, shiftKey: true }));
        await sleep(20);
        click(env, bBtn2);
        await sleep(30);
        const spA1 = env.doc.querySelector('td[data-ref="A1"]').firstChild;
        const spA2 = env.doc.querySelector('td[data-ref="A2"]').firstChild;
        ok(spA1.style.fontWeight === '700' && spA2.style.fontWeight === '700', 'F2 B applicato a tutta la selezione', spA1.style.fontWeight + '/' + spA2.style.fontWeight);
        click(env, bBtn2);
        await sleep(30);
        ok(spA1.style.fontWeight === '' && spA2.style.fontWeight === '', 'F2 B toggle off alla seconda pressione', spA1.style.fontWeight);

        // colore testo applicato + syncColorInputs su cambio selezione
        selectCell(env, 'A1');
        await sleep(20);
        cInp.value = '#123456';
        cInp.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(30);
        const a1span = env.doc.querySelector('td[data-ref="A1"]').firstChild;
        const colStr = (a1span.style.color || '') + '|' + (a1span.getAttribute('style') || '');
        ok(/123456|18,\s*52,\s*86/.test(colStr), 'F2 colore testo applicato alla cella', colStr);
        selectCell(env, 'B1');
        await sleep(20);
        ok(cInp.value === '#f5f7fa', 'F2 syncColorInputs: reset su cella senza colore', cInp.value);
        selectCell(env, 'A1');
        await sleep(20);
        ok(cInp.value === '#123456', 'F2 syncColorInputs: ripristino colore cella selezionata', cInp.value);

        // collasso/riapertura con linguetta
        const sideCol = side.querySelector('button[title="Nascondi il pannello Formato cella"]');
        const sideTab = $(env, '.fg-side-tab');
        ok(!!sideCol && !!sideTab, 'F2 bottone collasso + linguetta presenti');
        click(env, sideCol);
        ok(side.style.display === 'none' && sideTab.style.display !== 'none', 'F2 pannello collassato, linguetta visibile', side.style.display + '/' + sideTab.style.display);
        click(env, sideTab);
        ok(side.style.display === '' && sideTab.style.display === 'none', 'F2 pannello riaperto dalla linguetta', side.style.display + '/' + sideTab.style.display);

        // ---- F3: nessun pulsante allineamento in toolbar ----
        const alignBtns = $$(env, '.fg-top button').filter(b => /^Allinea/.test(b.title || ''));
        ok(alignBtns.length === 0, 'F3 nessun pulsante allineamento in toolbar');
        ok(!/I_AL_L|I_AL_C|I_AL_R/.test(SRC), 'F3 icone allineamento rimosse dal sorgente');
        ok(!/Allinea: /.test(SRC), 'F3 label allineamento assente dal sorgente');

        // ---- F4: popover "?" leggibile ----
        ok(!/440px/.test(SRC), 'F4 nessun width inline fisso 440px nel sorgente');
        const fpRule = (css.match(/\.fg-menu\.fg-formulepop\{[^}]*\}/) || [''])[0];
        ok(/width:min\(400px,92vw\)/.test(fpRule) && /max-width:400px/.test(fpRule), 'F4 popover max-width min(400px,92vw)/400px', fpRule);
        ok(/max-height/.test(fpRule) && /overflow-y:auto/.test(fpRule), 'F4 popover max-height + scroll interno', fpRule);
        ok(/\.fg-pop-item\{[^}]*white-space:normal/.test(css), 'F4 .fg-pop-item white-space:normal');
        ok(/\.fg-pop-item\{[^}]*overflow-wrap:break-word/.test(css), 'F4 .fg-pop-item overflow-wrap:break-word');
        ok(/\.fg-formulepop code\{[^}]*white-space:pre-wrap/.test(css), 'F4 <code> del popover wrappa (pre-wrap)');
        const fnRule = (css.match(/\.fg-fn-table\{[^}]*\}/) || [''])[0];
        ok(/table-layout:auto/.test(fnRule) && !/fixed/.test(fnRule), 'F4 tabella funzioni non tronca (table-layout:auto)', fnRule);
        click(env, helpBtn);
        await sleep(30);
        const pop2 = $(env, '.fg-menu.fg-formulepop');
        ok(!!pop2 && pop2.style.width === '', 'F4 popover senza width inline (gestito da CSS)', pop2 ? String(pop2.style.width) : 'assente');
        ok(!!pop2 && pop2.textContent.indexOf('SUM') >= 0 && pop2.querySelectorAll('td').length >= 15, 'F4 popover riaperto: testo/tabella completi');

        // ---- F5: scrollbar a tema ----
        ok(/\.fg-top::-webkit-scrollbar\{[^}]*display:none/.test(css), 'F5 .fg-top scrollbar nascosta in Chromium');
        ok(/\.fg-tabs::-webkit-scrollbar\{[^}]*display:none/.test(css), 'F5 .fg-tabs scrollbar nascosta in Chromium');
        ok(/\.fg-wrap::-webkit-scrollbar-thumb\{background:#3a4054/.test(css), 'F5 .fg-wrap thumb a tema (#3a4054)');
        ok(/\.fg-side::-webkit-scrollbar-thumb\{background:#3a4054/.test(css), 'F5 .fg-side thumb a tema (#3a4054)');

        // ---- F6: ordine toolbar secondo lo spec ----
        const tb = $$(env, '.fg-top button').map(b => (b.title || b.textContent || '').trim());
        const iBack = tb.findIndex(t => /elenco/i.test(t)); // title: "Torna all'elenco dei fogli"
        const iUndo = tb.findIndex(t => /Annulla ultima/.test(t));
        const iFHelp = tb.findIndex(t => /Aiuto formule/.test(t));
        const iEur = tb.findIndex(t => /Formato valuta euro/.test(t));
        const iMore = tb.findIndex(t => /Altre azioni/.test(t));
        const iExp = tb.findIndex(t => /Esporta o importa CSV/.test(t));
        ok(iBack >= 0 && iBack < iUndo && iUndo < iFHelp && iFHelp < iEur && iEur < iMore && iMore < iExp,
            'F6 ordine toolbar [Elenco|undo|titolo|ref|formula|?|formati|more|export]',
            [iBack, iUndo, iFHelp, iEur, iMore, iExp].join(','));
        ok(tb.filter(t => /Grassetto|Colore testo|Sfondo|Allinea/.test(t)).length === 0,
            'F6 nessun B/colore/allineamento residuo in toolbar');
        const badgeTxt = (($(env, '.fg-badge') || {}).textContent || '').trim();
        ok(/^[0-9]+ fogl(i|io)$/.test(badgeTxt), 'F6 badge conteggio fogli presente', badgeTxt);

        // ============================================================
        // BLOCCO 1.1-1.4: fill handle, pannello compatto, editor, scrollbar
        // ============================================================
        // Geometria attesa dal DOM (colgroup/tr = colX/rowY/colWidth/rowHeight
        // del modulo): in jsdom td.offsetLeft/offsetWidth sono 0 (niente layout),
        // quindi il "rettangolo della td" si legge dalla geometria della griglia
        // (in browser coincide con td.getBoundingClientRect relativizzato).
        function geomOf(ref) {
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
        const fill2 = $(env, '.fg-fill');
        const rng2 = $(env, '.fg-rng');
        const wrap2 = $(env, '.fg-wrap');
        const pos = el => ({ l: parseInt(el.style.left, 10), t: parseInt(el.style.top, 10) });

        // ---- (a) K13: pallino sull'angolo basso-destro del rect della cella ----
        selectCell(env, 'K13');
        await sleep(30);
        let gK = geomOf('K13');
        let p = pos(fill2);
        ok(p.l === gK.right - 7 && p.t === gK.bottom - 7,
            "1.1(a) K13: handle = angolo basso-destro del rect della cella",
            p.l + "," + p.t + " vs " + (gK.right - 7) + "," + (gK.bottom - 7));
        const tdK = env.doc.querySelector('td[data-ref="K13"]');
        ok(tdK.offsetLeft === 0 ||
            (p.l === tdK.offsetLeft + tdK.offsetWidth - 7 && p.t === tdK.offsetTop + tdK.offsetHeight - 7),
            "1.1(a) handle coerente con td.offset* quando il browser espone il layout",
            "td.offset=" + tdK.offsetLeft + "," + tdK.offsetTop);

        // ---- (b) range K13:M15 -> handle = angolo del rect; scroll e resize ----
        selectCell(env, 'K13');
        env.doc.querySelector('td[data-ref="M15"]').dispatchEvent(
            new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
        await sleep(30);
        let gM = geomOf('M15');
        ok(rng2.style.display === 'block' &&
            parseInt(rng2.style.left, 10) === gK.left && parseInt(rng2.style.top, 10) === gK.top &&
            parseInt(rng2.style.width, 10) === gM.right - gK.left &&
            parseInt(rng2.style.height, 10) === gM.bottom - gK.top,
            "1.1(b) rect range K13:M15 = geometria reale",
            [rng2.style.left, rng2.style.top, rng2.style.width, rng2.style.height].join(' '));
        p = pos(fill2);
        ok(p.l === parseInt(rng2.style.left, 10) + parseInt(rng2.style.width, 10) - 7 &&
            p.t === parseInt(rng2.style.top, 10) + parseInt(rng2.style.height, 10) - 7,
            "1.1(b) handle = angolo esatto del rect (range)", p.l + "," + p.t);

        // scroll: rect e pallino restano incollati (coordinate di contenuto)
        wrap2.scrollLeft = 700; wrap2.scrollTop = 300;
        wrap2.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        p = pos(fill2);
        ok(p.l === parseInt(rng2.style.left, 10) + parseInt(rng2.style.width, 10) - 7 &&
            p.t === parseInt(rng2.style.top, 10) + parseInt(rng2.style.height, 10) - 7,
            "1.1(b) handle e rect coerenti dopo scroll", p.l + "," + p.t);
        wrap2.scrollLeft = 0; wrap2.scrollTop = 0;
        wrap2.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);

        // resize colonna K (idx 10): il pallino segue il rect durante e dopo il drag
        const rhK = env.doc.querySelector('span.fg-rh[data-idx="10"]');
        rhK.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 600, clientY: 10, button: 0 }));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointermove', { bubbles: true, clientX: 630, clientY: 10 }));
        await sleep(20);
        gM = geomOf('M15');
        p = pos(fill2);
        ok(p.l === gM.right - 7 && p.t === gM.bottom - 7,
            "1.1(b) handle segue resize colonna durante il drag", p.l + " vs " + (gM.right - 7));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointerup', { bubbles: true, clientX: 630, clientY: 10 }));
        await sleep(80);
        gM = geomOf('M15');
        p = pos(fill2);
        ok(p.l === gM.right - 7 && p.t === gM.bottom - 7 &&
            p.l === parseInt(rng2.style.left, 10) + parseInt(rng2.style.width, 10) - 7,
            "1.1(b) handle = angolo del rect dopo render/resize", p.l + "," + p.t);

        // ---- (b) celle frozen + scroll: un box SOLO condiviso da rect e pallino ----
        selectCell(env, 'K13');
        const fzBtn2 = $$(env, '.fg-top button').filter(b => /^Blocca righe[/]colonne/.test(b.title || ''))[0];
        click(env, fzBtn2);
        await sleep(30);
        let fzItem = $$(env, '.fg-menu button.mi').filter(b => /Blocca fino alla selezione/.test(b.textContent))[0];
        ok(!!fzItem, "1.1(b) voce di menu Blocca fino alla selezione presente");
        if (fzItem) { click(env, fzItem); await sleep(60); }
        selectCell(env, 'K13');
        env.doc.querySelector('td[data-ref="M15"]').dispatchEvent(
            new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
        await sleep(30);
        // simula il layout del browser: td K13 sticky + wrap scrollato
        const tdKFrozen = env.doc.querySelector('td[data-ref="K13"]');
        tdKFrozen.getBoundingClientRect = function () {
            return { left: 100, right: 196, top: 50, bottom: 76, width: 96, height: 26, x: 100, y: 50 };
        };
        wrap2.getBoundingClientRect = function () {
            return { left: 0, top: 0, width: 600, height: 400, x: 0, y: 0 };
        };
        wrap2.scrollLeft = 300; wrap2.scrollTop = 100;
        wrap2.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        const expL = Math.round(100 - 0 - (wrap2.clientLeft || 0) + wrap2.scrollLeft);
        const expT = Math.round(50 - 0 - (wrap2.clientTop || 0) + wrap2.scrollTop);
        gM = geomOf('M15');
        p = pos(fill2);
        ok(parseInt(rng2.style.left, 10) === expL && parseInt(rng2.style.top, 10) === expT,
            "1.1(b) rect con cella frozen+scroll rettificato dal td reale",
            rng2.style.left + "," + rng2.style.top + " vs " + expL + "," + expT);
        ok(p.l === parseInt(rng2.style.left, 10) + parseInt(rng2.style.width, 10) - 7 &&
            p.t === parseInt(rng2.style.top, 10) + parseInt(rng2.style.height, 10) - 7 &&
            p.l === gM.right - 7,
            "1.1(b) pallino sull'angolo del rect anche con freeze+scroll", p.l + "," + p.t);
        // ripristino: rect reali, scroll a 0, sblocco
        delete tdKFrozen.getBoundingClientRect;
        delete wrap2.getBoundingClientRect;
        wrap2.scrollLeft = 0; wrap2.scrollTop = 0;
        wrap2.dispatchEvent(new env.win.Event('scroll'));
        await sleep(20);
        click(env, fzBtn2);
        await sleep(30);
        fzItem = $$(env, '.fg-menu button.mi').filter(b => /Sblocca righe e colonne/.test(b.textContent))[0];
        if (fzItem) { click(env, fzItem); await sleep(60); }
        gK = geomOf('K13'); gM = geomOf('M15');
        p = pos(fill2);
        ok(parseInt(rng2.style.left, 10) === gK.left && p.l === gM.right - 7 &&
            p.l === parseInt(rng2.style.left, 10) + parseInt(rng2.style.width, 10) - 7,
            "1.1(b) dopo sblocco/scroll a 0: rect e pallino tornano sulla geometria",
            [rng2.style.left, p.l, p.t].join(','));

        // ---- 1.1 celle unite: il rect reale include il merge ----
        selectCell(env, 'K13');
        env.doc.querySelector('td[data-ref="M15"]').dispatchEvent(
            new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
        await sleep(30);
        const mgBtn2 = $$(env, '.fg-top button').filter(b => /Unisci le celle/.test(b.title || ''))[0];
        click(env, mgBtn2);
        await sleep(80);
        selectCell(env, 'K13');
        await sleep(30);
        gM = geomOf('M15');
        p = pos(fill2);
        ok(p.l === gM.right - 7 && p.t === gM.bottom - 7,
            "1.1 merge K13:M15: handle sull'angolo reale del rettangolo unito",
            p.l + "," + p.t + " vs " + (gM.right - 7) + "," + (gM.bottom - 7));
        const moreBtn2 = $$(env, '.fg-top button').filter(b => /Altre azioni/.test(b.title || ''))[0];
        click(env, moreBtn2);
        await sleep(30);
        const divItem = $$(env, '.fg-menu button.mi').filter(b => /Dividi celle unite/.test(b.textContent))[0];
        if (divItem) { click(env, divItem); await sleep(80); }
        selectCell(env, 'K13');
        await sleep(30);
        gK = geomOf('K13');
        p = pos(fill2);
        ok(p.l === gK.right - 7 && p.t === gK.bottom - 7,
            "1.1 merge rimosso: handle torna sull'angolo di K13", p.l + "," + p.t);

        // ---- 1.2 pannello Formato cella compatto ----
        const sideRule = (css.match(/[.]fg-side[{][^}]*}/) || [''])[0];
        const sideW = (sideRule.match(/width:([0-9]+)px/) || [0, 0])[1];
        ok(+sideW >= 180 && +sideW <= 220, "1.2 larghezza pannello 180-220px", sideRule);
        const rowRule = (css.match(/[.]fg-side-row[{][^}]*}/) || [''])[0];
        const rowSizes = (rowRule.match(/(?:min-)?height:[0-9]+px/g) || []).map(s => parseInt(s.match(/([0-9]+)px/)[1], 10));
        ok(rowSizes.length > 0 && Math.max.apply(null, rowSizes) <= 36,
            "1.2 righe pannello compatte (<=36px)", rowRule);
        const colorRule = (css.match(/[.]fg-color[{][^}]*}/) || [''])[0];
        const cw = +((colorRule.match(/width:([0-9]+)px/) || [0, 0])[1]);
        const ch = +((colorRule.match(/height:([0-9]+)px/) || [0, 0])[1]);
        ok(cw >= 24 && cw <= 28 && ch >= 24 && ch <= 28, "1.2 swatch colore 24-28px", colorRule);
        const titleRule = (css.match(/[.]fg-side-title[{][^}]*}/) || [''])[0];
        const tfs = +(titleRule.match(/font-size:([0-9.]+)px/) || [0, 0])[1];
        ok(tfs > 0 && tfs <= 11, "1.2 titolo sezione piccolo (<=11px)", titleRule);
        const padTop = +((sideRule.match(/padding:([0-9]+)px/) || [0, 0])[1]);
        ok(padTop > 0 && padTop <= 8, "1.2 contenuto aderente in alto (padding-top <=8px)", sideRule);

        // ---- 1.3 editor cella in posizione ----
        selectCell(env, 'K13');
        if (env.doc.activeElement && env.doc.activeElement.blur) env.doc.activeElement.blur();
        env.doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
        await sleep(30);
        const ed = $(env, '.fg-editor');
        ok(!!ed, "1.3 editor .fg-editor creato con F2");
        const gKe = geomOf('K13');
        ok(!!ed && parseInt(ed.style.left, 10) === gKe.left && parseInt(ed.style.top, 10) === gKe.top,
            "1.3 editor left/top == rettangolo td (content-space, scroll incluso)",
            ed ? ed.style.left + "/" + ed.style.top + " vs " + gKe.left + "/" + gKe.top : "assente");
        ok(!!ed && parseInt(ed.style.width, 10) === gKe.width,
            "1.3 editor width == larghezza td", ed ? ed.style.width + " vs " + gKe.width : "assente");
        ok(!!ed && parseInt(ed.style.height, 10) >= 26,
            "1.3 editor altezza >=26 (>= riga)", ed ? ed.style.height : "assente");
        ok(!!ed && ed.parentNode === wrap2, "1.3 editor dentro lo scroller .fg-wrap");
        ok(/fg-editor[{][^}]*z-index:10/.test(css), "1.3 editor sopra la cella (z-index 10)");
        if (ed) ed.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await sleep(20);
        ok(!$(env, '.fg-editor'), "1.3 Esc chiude l'editor");
        // blur -> commit
        env.doc.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
        await sleep(30);
        const ed2 = $(env, '.fg-editor');
        if (ed2) {
            ed2.value = '777';
            ed2.dispatchEvent(new env.win.Event('blur'));
            await sleep(150);
        }
        ok(!$(env, '.fg-editor') && cellText(env, 'K13') === '777',
            "1.3 blur -> commit del valore in cella", cellText(env, 'K13'));

        // ---- 1.4 scrollbar verticale della griglia a tema ----
        ok(/[.]fg-wrap::-webkit-scrollbar:vertical[{][^}]*width:[0-9]+px/.test(css),
            "1.4 regola scrollbar VERTICALE su .fg-wrap (scroller reale della griglia)");
        ok(/[.]fg-wrap::-webkit-scrollbar-thumb:vertical[{][^}]*background:#3a4054/.test(css),
            "1.4 thumb verticale scura #3a4054",
            (css.match(/[.]fg-wrap::-webkit-scrollbar-thumb:vertical[{][^}]*}/) || [''])[0]);
        ok(/[.]fg-wrap::-webkit-scrollbar-track:vertical[{][^}]*background:transparent/.test(css),
            "1.4 track verticale trasparente");
        ok(/[.]fg-wrap[{][^}]*scrollbar-color:#3a4054 transparent/.test(css),
            "1.4 scrollbar-color standard (asse verticale Firefox) su .fg-wrap");

        // ============ R21 FASE B4: FontiPanel montato nell'editor fogli ============
        const envB4 = makeEnv();
        const contB4 = envB4.doc.getElementById('main');
        contB4.innerHTML = '';
        envB4.win.StudyTools.fogli.render(contB4, {});              // elenco (niente mount)
        await sleep(200);
        const listBtnB4 = $$(envB4, 'button').filter(b => String(b.textContent || '').trim() === 'Fonti');
        ok(!$(envB4, '.fp21-root') && listBtnB4.length === 0,
            'B4 mount solo in editor: elenco senza .fp21-root ne bottone Fonti',
            'root=' + !!$(envB4, '.fp21-root') + ' btn=' + listBtnB4.length);

        // fonte sorgente (appunto) per il pannello
        envB4.store.items.push({
            id: 'srcB4', kind: 'note', title: 'Teorema di Pitagora', materia: 'Mat',
            content: '## Pitagora\n\nIn un triangolo rettangolo vale a^2 + b^2 = c^2.',
            tags: '', description: '', thumbnail: '', folder_id: ''
        });
        await openSheet(envB4);                                       // apre l'editor foglio
        const fontiBtnB4 = $$(envB4, '.fg-top button').filter(b => String(b.textContent || '').trim() === 'Fonti')[0];
        ok(!!fontiBtnB4, 'B4 bottone "Fonti" presente nella toolbar editor', fontiBtnB4 ? 'ok' : 'assente');
        if (fontiBtnB4) click(envB4, fontiBtnB4);
        await sleep(250);                                             // fetch sorgenti async
        const rootB4 = $(envB4, '.fp21-root');
        ok(!!rootB4 && rootB4.getAttribute('data-fp21') === 'fogli',
            'B4 .fp21-root aperto con contesto "fogli"',
            rootB4 ? 'data-fp21=' + rootB4.getAttribute('data-fp21') : 'pannello assente');

        // selezione fonte + insert nella cella attiva A5
        const itemB4 = $(envB4, '.fp21-item');
        if (itemB4) { click(envB4, itemB4); await sleep(120); }       // preview -> abilita insert
        selectCell(envB4, 'A5');
        const insB4 = $(envB4, '.fp21-insert');
        if (insB4 && !insB4.disabled) click(envB4, insB4);
        await sleep(150);
        const refB4 = '\uD83D\uDCCE Teorema di Pitagora (Appunti)';
        ok(!!itemB4 && !!(insB4 && !insB4.disabled) && cellText(envB4, 'A5') === refB4,
            'B4 insert fonte -> riferimento "titolo (tipo)" nella cella attiva A5',
            'item=' + !!itemB4 + ' insert=' + (insB4 ? (insB4.disabled ? 'disabilitato' : insB4.textContent) : 'assente') +
            ' cell=' + JSON.stringify(cellText(envB4, 'A5')));

        // undo (pushUndo PRIMA dell'insert): il riferimento sparisce dalla cella
        const undoB4 = $$(envB4, '.fg-top button').filter(b => /Annulla ultima/.test(b.title || ''))[0];
        const undoReady = !!undoB4 && !undoB4.disabled;
        if (undoReady) click(envB4, undoB4);
        await sleep(150);
        ok(undoReady && !cellText(envB4, 'A5'),
            'B4 undo rimuove il riferimento dalla cella A5',
            'ready=' + undoReady + ' cell=' + JSON.stringify(cellText(envB4, 'A5')));

        // chiusura pulita
        if (fontiBtnB4) click(envB4, fontiBtnB4);
        await sleep(80);
        ok(!$(envB4, '.fp21-root'), 'B4 chiusura pulita: secondo click rimuove .fp21-root');

        const errB4 = envB4.errors.filter(e => !/Could not parse CSS|not implemented/i.test(e));
        ok(errB4.length === 0, 'B4 zero eccezioni console', errB4.slice(0, 3).join(' | '));

        const unexpected = env.errors.filter(e => !/Could not parse CSS|not implemented/i.test(e));
        ok(unexpected.length === 0, 'nessun errore JS non gestito', unexpected.slice(0, 3).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI FOGLI: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
