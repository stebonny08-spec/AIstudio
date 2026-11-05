/* ============================================================
   tests/qaF_block.js - QA-F BLOCCO F (Fogli): verifica indipendente
   F1 fill handle | F2 pannello Formato cella | F3 no allineamenti
   F4 popover "?" | F5 scrollbar | F6 ordine toolbar
   Read-only su web_frontend/; eseguire: node tests/qaF_block.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fogli.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' -- ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' -- ' + extra : '')); }
}
function ev(s) { console.log('  EV    ' + s); }
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
    win.document.elementFromPoint = () => null;
    const env = { dom, win, doc, store, errors };
    win.eval(SRC);
    return env;
}

// seme: dati minimi + freeze colonna 0 per la verifica freeze-aware (F1)
const SEEDED = {
    sheets: [{
        cells: { 'A1': { v: '10' }, 'A2': { v: '20' }, 'A3': { v: '30' }, 'B1': { v: 'x' } },
        freeze: { c: 1, r: 0 }
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
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function selectCell(env, ref) {
    const td = env.doc.querySelector('td[data-ref="' + ref + '"]');
    if (!td) throw new Error('td mancante: ' + ref);
    td.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0 }));
}
function shiftClick(env, ref) {
    const td = env.doc.querySelector('td[data-ref="' + ref + '"]');
    if (!td) throw new Error('td mancante: ' + ref);
    td.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12, button: 0, shiftKey: true }));
}
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function cellText(env, ref) {
    const td = env.doc.querySelector('td[data-ref="' + ref + '"]');
    return td && td.firstChild ? td.firstChild.textContent : null;
}

// modello geometrico indipendente (default fogli: col 96, row 26, gutter 44/26)
const colW = new Array(26).fill(96);
function colX(c) { let x = 44; for (let i = 0; i < c; i++) x += colW[i]; return x; }
function rowY(r) { return 26 + 26 * r; }
function posInt(s) { return parseInt(s, 10); }
function coherent(fill, cx, cy) {
    const l = posInt(fill.style.left), t = posInt(fill.style.top);
    // handle 8x8 centrato (entro 5px) sull'angolo: copre l'angolo, non staccato
    const covers = l <= cx && cx <= l + 8 && t <= cy && cy <= t + 8;
    const centered = Math.abs(l + 4 - cx) <= 5 && Math.abs(t + 4 - cy) <= 5;
    return { ok: covers && centered, l: l, t: t, cx: cx, cy: cy };
}

function tokenOf(el) {
    const tag = el.tagName, cls = el.className || '';
    const t = (el.title || '') + ' ' + (el.textContent || '');
    if (tag === 'DIV' && /fg-title/.test(cls)) return 'title';
    if (tag === 'DIV' && /fg-refbox/.test(cls)) return 'ref';
    if (tag === 'INPUT' && /fg-formula/.test(cls)) return 'formula';
    if (tag === 'SPAN' && /fg-sep/.test(cls)) return 'sep';
    if (tag === 'SPAN' && /fg-spacer/.test(cls)) return 'spacer';
    if (tag !== 'BUTTON') return tag + '.' + cls;
    if (/elenco/i.test(el.title || '')) return 'elenco';
    if (/Annulla/.test(t)) return 'undo';
    if (/Ripeti/.test(t)) return 'redo';
    if (/Aiuto formule/.test(t)) return '?';
    if (/valuta euro/.test(t)) return 'eur';
    if (/percentuale/.test(t)) return 'pct';
    if (/Aumenta i decimali/.test(t)) return 'dec+';
    if (/Riduci i decimali/.test(t)) return 'dec-';
    if (/Unisci le celle/.test(t)) return 'unisci';
    if (/Bordi celle/.test(t)) return 'bordi';
    if (/blocca/i.test(t)) return 'blocca';   // titolo diventa "Sblocca ..." con freeze attivo
    if (/Altre azioni/.test(t)) return 'more';
    if (/Esporta o importa/.test(t)) return 'export';
    return 'btn:' + t.trim().slice(0, 24);
}

async function main() {
    try {
        console.log('\n== QA-F BLOCCO F (Fogli): F1-F6 ==');
        const env = makeEnv();
        await openSheet(env);
        const css = $$(env, 'style').map(s => s.textContent).join('\n');
        const fill = $(env, '.fg-fill');
        const wrap = $(env, '.fg-wrap');

        // ================= F1: FILL HANDLE =================
        console.log('\n-- F1 fill handle --');
        ok(!!fill, 'F1 elemento .fg-fill presente');
        ok(!!fill && fill.style.display === 'block', 'F1 handle visibile con selezione iniziale A1');
        // posizione assoluta A1: angolo (44+96, 26+26) - 7 = (133,45)
        let c = coherent(fill, colX(1), rowY(1));
        ok(c.l === 133 && c.t === 45, 'F1 A1: handle a offset 7px dall\'angolo (133,45)', c.l + ',' + c.t);
        ok(c.ok, 'F1 A1: handle copre/centrato sull\'angolo, non staccato', JSON.stringify(c));
        // segue cambi di selezione -> D5
        selectCell(env, 'D5'); await sleep(20);
        c = coherent(fill, colX(4), rowY(5));
        ok(c.l === 421 && c.t === 149 && c.ok, 'F1 segue selezione D5 (421,149 coerente con angolo)', c.l + ',' + c.t + ' ok=' + c.ok);
        selectCell(env, 'A1'); await sleep(20);
        // listener scroll su wrap
        fill.style.left = '9999px'; fill.style.top = '9999px';
        wrap.dispatchEvent(new env.win.Event('scroll'));
        ok(posInt(fill.style.left) === 133 && posInt(fill.style.top) === 45, 'F1 listener scroll su .fg-wrap riposiziona il handle', fill.style.left + ',' + fill.style.top);
        // listener resize finestra
        fill.style.left = '9999px';
        env.win.dispatchEvent(new env.win.Event('resize'));
        ok(posInt(fill.style.left) === 133, 'F1 listener window resize riposiziona il handle', fill.style.left);
        // range con shift+click: handle = angolo basso-destro del rect (.fg-rng)
        shiftClick(env, 'C3'); await sleep(30);
        const rng = $(env, '.fg-rng');
        ok(!!rng && rng.style.display === 'block', 'F1 range overlay attivo');
        const rl = posInt(rng.style.left), rt = posInt(rng.style.top), rw = posInt(rng.style.width), rh = posInt(rng.style.height);
        ev('rect A1:C3 = left:' + rl + ' top:' + rt + ' w:' + rw + ' h:' + rh);
        ok(rl === 44 && rt === 26 && rw === 288 && rh === 78, 'F1 geometria rect A1:C3', [rl, rt, rw, rh].join(','));
        const fl = posInt(fill.style.left), ft = posInt(fill.style.top);
        ok(fl === rl + rw - 7 && ft === rt + rh - 7, 'F1 handle = angolo basso-destro del rect selezione (rect + size - 7)', fl + ',' + ft);
        const cornerX = rl + rw, cornerY = rt + rh;
        ok(fl <= cornerX && cornerX <= fl + 8 && ft <= cornerY && cornerY <= ft + 8, 'F1 angolo del rect coperto dal handle 8x8', cornerX + ',' + cornerY);
        selectCell(env, 'A1'); await sleep(20);
        // z-index sopra gli header sticky
        const fillZ = posInt((css.match(/\.fg-fill\{[^}]*z-index:(\d+)/) || [])[1] || -1);
        const zTh = posInt((css.match(/\.fg thead th\{[^}]*z-index:(\d+)/) || [])[1] || -1);
        const zRh = posInt((css.match(/\.fg th\.rowh\{[^}]*z-index:(\d+)/) || [])[1] || -1);
        const zCorner = posInt((css.match(/\.fg thead th\.corner\{[^}]*z-index:(\d+)/) || [])[1] || -1);
        ev('z-index: fill=' + fillZ + ' thead=' + zTh + ' rowh=' + zRh + ' corner=' + zCorner);
        ok(fillZ === 7 && fillZ > Math.max(zTh, zRh, zCorner), 'F1 z-index handle (7) sopra header sticky (4/5/6)', [fillZ, zTh, zRh, zCorner].join('/'));
        ok(/\.fg-fill\{[^}]*width:8px;height:8px/.test(css) && /\.fg-fill\{[^}]*pointer-events:auto/.test(css), 'F1 CSS handle 8x8 + pointer-events:auto');
        ok(/wrap\.addEventListener\('scroll'/.test(SRC) && /window\.addEventListener\('resize'/.test(SRC), 'F1 listener scroll/resize registrati nel sorgente');
        ok(/getBoundingClientRect\(\)/.test(SRC) && /fz\.c > 0 && rg\.c2 < fz\.c/.test(SRC), 'F1 ramo freeze-aware con getBoundingClientRect presente');
        // freeze-aware dinamico: stub gBCR su td d'angolo e wrap
        const tdA1 = env.doc.querySelector('td[data-ref="A1"]');
        const origTd = tdA1.getBoundingClientRect, origWrap = wrap.getBoundingClientRect;
        tdA1.getBoundingClientRect = function () { return { left: 204, top: 74, right: 300, bottom: 100, width: 96, height: 26 }; };
        wrap.getBoundingClientRect = function () { return { left: 50, top: 40, right: 650, bottom: 440, width: 600, height: 400 }; };
        selectCell(env, 'A1'); await sleep(20);
        const fzL = posInt(fill.style.left), fzT = posInt(fill.style.top);
        tdA1.getBoundingClientRect = origTd; wrap.getBoundingClientRect = origWrap;
        ok(fzL === 243 && fzT === 45, 'F1 freeze-aware: handle da gBCR td(300)-wrap(50)-7 = 243, y da contenuto 45', fzL + ',' + fzT);
        // drag sul handle -> preview + applyFill (serie 10,20 -> 30,40,50)
        shiftClick(env, 'A2'); await sleep(20);
        const fillNow = coherent(fill, colX(1), rowY(2));
        ok(fillNow.l === 133 && fillNow.t === 71 && fillNow.ok, 'F1 range A1:A2: handle angolo (133,71) coerente', fillNow.l + ',' + fillNow.t + ' ok=' + fillNow.ok);
        fill.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointermove', { bubbles: true, clientX: 10, clientY: 70 }));
        const prev = $(env, '.fg-fpreview');
        ok(!!prev && prev.style.display === 'block', 'F1 pointerdown sul handle avvia drag (anteprima visibile)', prev ? prev.style.display : 'assente');
        ok(!!prev && posInt(prev.style.width) === 96 && posInt(prev.style.height) === 130 && posInt(prev.style.left) === 44 && posInt(prev.style.top) === 26,
            'F1 anteprima estensione range A1:A2 -> A1:A5 (44,26,96x130)',
            prev ? [prev.style.left, prev.style.top, prev.style.width, prev.style.height].join(',') : '');
        env.doc.dispatchEvent(new env.win.MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 70 }));
        await sleep(80);
        ok(prev.style.display === 'none', 'F1 anteprima nascosta al drop', prev.style.display);
        ev('A3=' + cellText(env, 'A3') + ' A4=' + cellText(env, 'A4') + ' A5=' + cellText(env, 'A5'));
        ok(cellText(env, 'A3') === '30' && cellText(env, 'A4') === '40' && cellText(env, 'A5') === '50',
            'F1 applyFill collegato: serie 10,20 riempie A3:A5 = 30,40,50',
            [cellText(env, 'A3'), cellText(env, 'A4'), cellText(env, 'A5')].join(','));
        // resize colonna: il handle deve restare agganciato (colWidth change via drag .fg-rh)
        selectCell(env, 'A1'); await sleep(20);
        const rh0 = env.doc.querySelector('span.fg-rh[data-idx="0"]');
        ok(!!rh0, 'F1 handle resize colonna .fg-rh presente');
        rh0.dispatchEvent(new env.win.MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 10, button: 0 }));
        env.doc.dispatchEvent(new env.win.MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 10 }));
        ev('durante resize col0: fill.left=' + fill.style.left + ' (atteso 44+126-7=163)');
        ok(posInt(fill.style.left) === 163, 'F1 handle segue il resize colonna durante il drag (left=163)', fill.style.left);
        env.doc.dispatchEvent(new env.win.MouseEvent('pointerup', { bubbles: true, clientX: 130, clientY: 10 }));
        await sleep(80);
        ok(posInt(fill.style.left) === 163, 'F1 handle resta agganciato dopo render/resize colonna (left=163)', fill.style.left);
        colW[0] = 126; // il modello segue il resize effettuato (angolo A1: 44+126=170)
        const after = coherent(fill, colX(1), rowY(1));
        ok(after.l === 163 && after.t === 45 && after.ok, 'F1 post-resize: handle ancora sull\'angolo della cella A1 (colonna larga 126, angolo 170,52)', JSON.stringify(after));

        // ================= F2: PANNELLO Format cella =================
        console.log('\n-- F2 pannello Formato cella --');
        const body = $(env, '.fg-body'), side = $(env, '.fg-side'), sideTab = $(env, '.fg-side-tab');
        ok(!!side, 'F2 elemento .fg-side presente');
        const kids = body ? Array.from(body.children) : [];
        const iWrap = kids.indexOf(wrap), iSide = kids.indexOf(side);
        ev('ordine .fg-body figli: ' + kids.map(e => e.className).join(' | '));
        ok(iWrap >= 0 && iSide > iWrap, 'F2 pannello a DESTRA della griglia (dopo .fg-wrap in .fg-body flex-row)', iWrap + '<' + iSide);
        ok(/\.fg-body\{[^}]*flex-direction:row/.test(css), 'F2 .fg-body flex-direction:row');
        ok(/\.fg-side\{[^}]*width:260px/.test(css) && /\.fg-side\{[^}]*flex:0 0 260px/.test(css), 'F2 .fg-side largo 260px');
        ok(/Formato cella/.test(side.textContent), 'F2 titolo "Formato cella" nel pannello');
        const bBtn = side.querySelector('button[title="Grassetto cella selezionata"]');
        const cInp = side.querySelector('input[title="Colore testo"]');
        const bgInp = side.querySelector('input[title="Sfondo cella"]');
        ok(!!bBtn, 'F2 B (grassetto) nel pannello');
        ok(!!cInp && cInp.type === 'color', 'F2 colore testo nel pannello');
        ok(!!bgInp && bgInp.type === 'color', 'F2 colore sfondo nel pannello');
        // B applica grassetto (paintCell fontWeight)
        selectCell(env, 'A1'); await sleep(20);
        click(env, bBtn); await sleep(30);
        let sp = env.doc.querySelector('td[data-ref="A1"] > .cin');
        ok(sp && sp.style.fontWeight === '700', 'F2 B applica grassetto (paintCell fontWeight=700)', sp ? sp.style.fontWeight : 'n/a');
        click(env, bBtn); await sleep(30);
        sp = env.doc.querySelector('td[data-ref="A1"] > .cin');
        ok(sp && sp.style.fontWeight === '', 'F2 B toggle off alla seconda pressione', sp ? sp.style.fontWeight : 'n/a');
        // colori applicati
        cInp.value = '#123456'; cInp.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(30);
        sp = env.doc.querySelector('td[data-ref="A1"] > .cin');
        const colStr = ((sp && sp.style.color) || '') + '|' + ((sp && sp.getAttribute('style')) || '');
        ok(/123456|18,\s*52,\s*86/.test(colStr), 'F2 colore testo applicato a A1', colStr);
        bgInp.value = '#654321'; bgInp.dispatchEvent(new env.win.Event('input', { bubbles: true }));
        await sleep(30);
        sp = env.doc.querySelector('td[data-ref="A1"] > .cin');
        const bgStr = ((sp && sp.style.background) || '') + '|' + ((sp && sp.getAttribute('style')) || '');
        ok(/654321|101,\s*67,\s*33/.test(bgStr), 'F2 colore sfondo applicato a A1', bgStr);
        // syncColorInputs dalla selezione
        selectCell(env, 'B1'); await sleep(20);
        ok(cInp.value === '#f5f7fa' && bgInp.value === '#202637', 'F2 syncColorInputs reset su cella senza colori', cInp.value + '/' + bgInp.value);
        selectCell(env, 'A1'); await sleep(20);
        ok(cInp.value === '#123456' && bgInp.value === '#654321', 'F2 syncColorInputs ripristina i colori di A1', cInp.value + '/' + bgInp.value);
        // collasso/riapertura con linguetta
        const sideCol = side.querySelector('button[title="Nascondi il pannello Formato cella"]');
        ok(!!sideCol && !!sideTab, 'F2 bottone collasso + linguetta .fg-side-tab presenti');
        click(env, sideCol); await sleep(20);
        ok(side.style.display === 'none' && sideTab.style.display !== 'none', 'F2 collasso: .fg-side nascosto, linguetta visibile', side.style.display + '/' + sideTab.style.display);
        click(env, sideTab); await sleep(20);
        ok(side.style.display === '' && sideTab.style.display === 'none', 'F2 riapertura dalla linguetta', side.style.display + '/' + sideTab.style.display);

        // ================= F3: NESSUN ALLINEAMENTO =================
        console.log('\n-- F3 allineamenti rimossi --');
        const alignBtns = $$(env, '.fg-top button').filter(b => /allinea/i.test(b.title || '') || /allinea/i.test(b.textContent || ''));
        ok(alignBtns.length === 0, 'F3 0 bottoni allineamento in toolbar', 'trovati=' + alignBtns.length);
        const alignAny = $$(env, 'button').filter(b => /^Allinea/.test(b.title || ''));
        ok(alignAny.length === 0, 'F3 0 bottoni con title Allinea in tutto il DOM', 'trovati=' + alignAny.length);
        ok(!/I_AL_/.test(SRC), 'F3 nessuna icona I_AL_ nel sorgente');
        ok(!/Allinea: /.test(SRC), 'F3 nessuna label "Allinea: " nel sorgente');

        // ================= F5: SCROLLBAR TEMA (statico) =================
        console.log('\n-- F5 scrollbar tema --');
        ok(/\.fg-top::-webkit-scrollbar\{[^}]*display:none/.test(css), 'F5 .fg-top scrollbar webkit nascosta');
        ok(/\.fg-top\{[^}]*scrollbar-width:none/.test(css), 'F5 .fg-top scrollbar-width:none');
        ok(/\.fg-tabs::-webkit-scrollbar\{[^}]*display:none/.test(css), 'F5 .fg-tabs scrollbar webkit nascosta');
        ok(/\.fg-tabs\{[^}]*scrollbar-width:none/.test(css), 'F5 .fg-tabs scrollbar-width:none');
        const wrapRule = (css.match(/\.fg-wrap\{[^}]*\}/) || [''])[0];
        ok(/scrollbar-color:#3a4054/.test(wrapRule), 'F5 .fg-wrap scrollbar-color #3a4054', wrapRule.slice(0, 160));
        ok(/\.fg-wrap::-webkit-scrollbar-thumb\{background:#3a4054/.test(css), 'F5 .fg-wrap thumb webkit #3a4054');
        const sideRule = (css.match(/\.fg-side\{[^}]*\}/) || [''])[0];
        ok(/scrollbar-color:#3a4054/.test(sideRule), 'F5 .fg-side scrollbar-color #3a4054', sideRule.slice(0, 160));
        ok(/\.fg-side::-webkit-scrollbar-thumb\{background:#3a4054/.test(css), 'F5 .fg-side thumb webkit #3a4054');

        // ================= F4: POPOVER "?" =================
        console.log('\n-- F4 popover Formule --');
        ok(!/440px/.test(SRC), 'F4 nessun width fisso 440px nel sorgente');
        const helpBtn = $$(env, '.fg-top button').filter(b => b.title === 'Aiuto formule: regola, funzioni ed esempi')[0];
        ok(!!helpBtn, 'F4 "?" ancora in toolbar');
        click(env, helpBtn); await sleep(40);
        const pop = $(env, '.fg-menu.fg-formulepop');
        ok(!!pop, 'F4 popover Formule aperto');
        if (pop) {
            ok(pop.style.width === '' && pop.style.maxWidth === '', 'F4 nessun width inline (gestito da CSS)', 'width="' + pop.style.width + '"');
            const fpRule = (css.match(/\.fg-menu\.fg-formulepop\{[^}]*\}/) || [''])[0];
            ev('regola popover: ' + fpRule);
            ok(/width:min\(400px,92vw\)/.test(fpRule), 'F4 larghezza min(400px,92vw)', fpRule);
            const mw = posInt((fpRule.match(/max-width:(\d+)px/) || [])[1] || 0);
            ok(mw >= 320 && mw <= 400, 'F4 max-width nel range 320-400 (<=400px)', 'max-width=' + mw);
            ok(/max-height:min\(70vh,560px\)/.test(fpRule) && /overflow-y:auto/.test(fpRule), 'F4 scroll interno max-height min(70vh,560px) + overflow-y:auto');
            ok(/overflow-x:hidden/.test(fpRule), 'F4 nessun overflow orizzontale (overflow-x:hidden)');
            const itemRule = (css.match(/\.fg-pop-item\{[^}]*\}/) || [''])[0];
            ok(/white-space:normal/.test(itemRule), 'F4 .fg-pop-item white-space:normal', itemRule);
            ok(/overflow-wrap:break-word/.test(itemRule) && !/overflow:hidden|text-overflow/.test(itemRule), 'F4 .fg-pop-item wrappa senza troncare', itemRule);
            ok(/\.fg-formulepop code\{[^}]*white-space:pre-wrap/.test(css), 'F4 code del popover white-space:pre-wrap');
            // completezza testo (righe regola/esempi/operatori/errori)
            const txt = pop.textContent || '';
            ['Ogni formula inizia con', 'Argomenti separati', 'Esempi pratici', '=SUM(A1:A5)', '=IF(A1>=6,', 'Operatori:', 'Errori:',
                '#CIRC!', '#DIV/0!', '#REF!', '#NAME?', '#ERR!'].forEach(s => {
                ok(txt.indexOf(s) >= 0, 'F4 testo completo contiene "' + s + '"');
            });
            // tabella 15 funzioni
            const rows = pop.querySelectorAll('.fg-fn-table tbody tr');
            const heads = pop.querySelectorAll('.fg-fn-table thead th');
            ev('tabella funzioni: righe=' + rows.length + ' colonne header=' + heads.length);
            ok(rows.length === 15, 'F4 tabella completa 15 funzioni', 'righe=' + rows.length);
            ok(heads.length === 3, 'F4 header tabella 3 colonne (Funzione/Sintassi/Esempio)', 'th=' + heads.length);
            const fnTableTxt = pop.querySelector('.fg-fn-table').textContent;
            ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'AND', 'OR', 'NOT', 'CONCAT', 'ABS', 'ROUND', 'SQRT', 'POWER']
                .forEach(fn => ok(fnTableTxt.indexOf(fn) >= 0, 'F4 funzione in tabella: ' + fn));
            ok(/table-layout:auto/.test((css.match(/\.fg-fn-table\{[^}]*\}/) || [''])[0]), 'F4 tabella non troncata (table-layout:auto)');
        }

        // ================= F6: ORDINE TOOLBAR =================
        console.log('\n-- F6 ordine toolbar --');
        const top = $(env, '.fg-top');
        const tokens = Array.from(top.children).map(tokenOf);
        ev('toolbar DOM: ' + tokens.join(','));
        const expected = ['elenco', 'undo', 'redo', 'sep', 'title', 'sep', 'ref', 'formula', '?', 'sep',
            'eur', 'pct', 'dec+', 'dec-', 'unisci', 'bordi', 'blocca', 'spacer', 'more', 'export'];
        ok(tokens.join(',') === expected.join(','), 'F6 ordine esatto [Elenco][undo/redo]|titolo+badge|[ref][formula][?]|[EUR,%,Dec+,Dec-,Unisci,Bordi,Blocca]|[...][Export]',
            'atteso=' + expected.join(',') + ' | ottenuto=' + tokens.join(','));
        ok(!!$(env, '.fg-badge') && /^[0-9]+ fogl(i|io)$/.test(($(env, '.fg-badge').textContent || '').trim()), 'F6 badge conteggio fogli', ($(env, '.fg-badge') || {}).textContent);
        const residui = Array.from(top.children).filter(e => /Grassetto|Colore testo|Sfondo|Allinea/i.test((e.title || '') + ' ' + (e.textContent || '')));
        ok(residui.length === 0, 'F6 nessun residuo B/colore/allineamento in toolbar', 'residui=' + residui.length);

        // ================= errori JS =================
        const unexpected = env.errors.filter(e => !/Could not parse CSS|not implemented/i.test(e));
        ok(unexpected.length === 0, 'nessun errore JS non gestito', unexpected.slice(0, 3).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('QA-F RISULTATI: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
