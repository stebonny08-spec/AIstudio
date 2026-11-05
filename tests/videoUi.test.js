/* ============================================================
   tests/videoUi.test.js — verifica UI dei BLOCCHI 1 e 2 su video.js
   con jsdom (moduli REALI + stub App/StudyStore).

   Eseguire con: node tests/videoUi.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
// R21 B4: FontiPanel caricato PRIMA del modulo ospitante (pattern SRC_PANEL di tests/_ink_env.js)
const SRC_PANEL = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'video.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeEnv() {
    // R21 B4: VirtualConsole che raccoglie gli errori (assert "zero eccezioni")
    const vc = new VirtualConsole();
    const errors = [];
    vc.on('jsdomError', e => errors.push(String((e && e.message) || e)));
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
        if (html != null) e.innerHTML = html;   // come il vero App.el (innerHTML)
        return e;
    }
    win.App = {
        el: el, esc: esc,
        style: css => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); },
        empty: (icon, text, btnText, onClick) => {
            const d = el('div', 'app-empty');
            d.appendChild(el('p', null, text));
            if (btnText) { const b = el('button', 'btn-accent', btnText); if (onClick) b.addEventListener('click', onClick); d.appendChild(b); }
            return d;
        },
        fmtDate: s => String(s || ''),
        go: () => { },
        header: (t, d2, btns) => { const h = el('div', 'app-header'); h.appendChild(el('h2', null, t)); return h; },
        ICONS: {}
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) { const i = store.items.filter(x => x.id === p.id)[0]; if (i) { Object.assign(i, p); return Object.assign({}, i); } }
            const n = Object.assign({ id: 'v' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async id => { store.items = store.items.filter(i => i.id !== id); },
        renameItem: async () => { },
        duplicateItem: async () => { },
        pickAsset: async () => ({ path: 'file:///fake/asset' }),   // evita il dialogo file
        hasBackend: async () => false
    };
    win.StudyAsk = () => Promise.resolve('Progetto');
    win.prompt = () => null;
    // conferma tracciata (test: distingue vuoto/occupato e OK/Annulla)
    const env = { dom, win, doc, store, errors, confirmCalls: [], confirmResult: true };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
    // stub media jsdom: play()/pause() devono essere Promise-safe come nel browser
    win.HTMLMediaElement.prototype.play = function () {
        this.__played = (this.__played || 0) + 1;
        return Promise.resolve();
    };
    win.HTMLMediaElement.prototype.pause = function () {
        this.__paused = (this.__paused || 0) + 1;
    };

    win.eval(SRC_PANEL);   // R21 B4: pannello Fonti prima del modulo video
    win.eval(SRC);
    return env;
}

async function openVideo(env, content, title) {
    const id = 'v' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'video', title: title || 'Progetto',
        content: JSON.stringify(content || { clips: [], music: { src: '', volume: 70 } }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.win.StudyTools.video.render(cont, { open: id });
    await sleep(150);
    return id;
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function styleText(env) {
    return Array.from(env.doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
}
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function ptr(env, target, type, x, y) {
    target.dispatchEvent(new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}
function trackRows(env) { return $$(env, '.vv-ttracks .vv-track'); }
function clipNodes(env) { return $$(env, '.vv-tclip[data-cid]'); }

// mock getBoundingClientRect su un elemento (jsdom non ha layout)
function mockRect(elm, top, height) {
    elm.getBoundingClientRect = function () {
        return { top: top, bottom: top + height, left: 0, right: 900, width: 900, height: height, x: 0, y: top };
    };
}

// ===============================================================
// BLOCCO 1 — pannello "Aggiungi elemento" in colonna stretta a sinistra
// ===============================================================
async function block1() {
    console.log('\n== BLOCCO 1 — Video: colonna sinistra ==');
    const env = makeEnv();
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.win.StudyTools.video.render(cont, {});           // elenco
    await sleep(120);
    // crea un progetto e apre l'editor direttamente
    const id = await openVideo(env);

    ok(cont.classList.contains('vv-editor'), '1.4 container editor con layout dedicato');
    const body = $(env, '.vv-body');
    ok(!!body, '1.4 .vv-body presente');
    const split = $(env, '.vv-split');
    ok(!!split, '1.4 .vv-split presente');
    const kids = split ? Array.from(split.children) : [];
    ok(kids.length === 2, '1.4 split = 2 colonne [sx][preview] (nessuna colonna proprieta)', 'n=' + kids.length);
    ok(kids[0] && kids[0].classList.contains('vv-pane'), '1.1 colonna sinistra per prima (affiancata a sinistra della preview)');
    ok(kids[1] && kids[1].classList.contains('vv-main'), '1.4 preview al centro');
    ok(!!(kids[1] && kids[1].querySelector('.vv-stage')), '1.4 riquadro preview dentro la colonna centrale');
    ok(!$(env, '.vv-props'), 'V1 nessun pannello .vv-props (proprietà a destra');

    // timeline sotto, a tutta larghezza
    const bodyKids = Array.from(body.children);
    ok(bodyKids.length === 2 && bodyKids[0] === split && bodyKids[1].classList.contains('vv-tlwrap'),
        '1.4 timeline sotto a tutta larghezza', bodyKids.map(k => k.className).join('|'));

    // pannello sinistro stretto
    const pane = kids[0];
    const vtab = pane.querySelector('.vv-vtab');
    const panel = pane.querySelector('.vv-panel.vv-left');
    const lgrab = pane.querySelector('.vv-lgrab');
    ok(!!vtab && vtab.textContent === 'ELEMENTI', '1.2 linguetta verticale di collasso');
    ok(pane.classList.contains('vv-side'), 'V5 alias classe .vv-side sul .vv-pane (regola collasso attiva)');
    ok(!!panel, '1.1 pannello .vv-panel.vv-left presente');
    ok(!!lgrab, '1.2 maniglia drag di ridimensionamento presente');
    ok(!!panel && panel.style.width === '200px', '1.2 larghezza default 200px', panel && panel.style.width);

    // CSS chiave
    const css = styleText(env);
    ok(/\.vv-editor\{[^}]*display:flex/.test(css), 'CSS .vv-editor flex');
    ok(/\.vv-split\{[^}]*display:flex/.test(css), 'CSS .vv-split flex (riga di colonne)');
    ok(!/\.vv-props\{/.test(css) && /\.vv-ctxbar\{/.test(css), 'V1 CSS barra contestuale .vv-ctxbar al posto della colonnaproprietà 260px');
    ok(/\.vv-panel\{[^}]*overflow-y:hidden/.test(css), '1.3 pannello sinistro senza scrollbar interna (overflow-y:hidden)');
    ok(/\.vv-addb\{[^}]*height:32px/.test(css), '1.3 bottoni altezza 32px');
    ok(/\.vv-addgrid\{[^}]*grid-template-columns:1fr 1fr/.test(css), '1.3 griglia 2×2');
    ok(/\.vv-side\.collapsed \.vv-panel\{display:none\}/.test(css), '1.2 collasso via linguetta (regola CSS)');
    ok(/\.vv-lsect\.collapsed \.vv-sbody\{display:none\}/.test(css), '1.3 sezioni collassabili (regola CSS)');
    ok(/\.vv-editor\{[^}]*height:calc\(100vh - 44px\)/.test(css), '1.4 altezza editor sul viewport (view-page utile - 44px)');
    ok(/\.vv-editor\{[^}]*overflow:hidden/.test(css), 'V4 editor overflow hidden (nessun scroll di pagina)');
    ok(/\.vv-main\{[^}]*overflow:hidden/.test(css), 'V2 preview senza scroll (.vv-main overflow hidden)');
    ok(/\.vv-stage\{[^}]*aspect-ratio:16\/9/.test(css), 'V2 stage 16:9 scalato sull\'altezza disponibile');
    ok(/\.vv-transport\{[^}]*flex:0 0 auto/.test(css), 'V2 transport non cresce (flex:0 0 auto)');
    ok(/\.vv-tlwrap\{[^}]*height:clamp\(160px,40vh,40vh\)/.test(css), 'V4 altezza timeline adattiva clamp(160px,40vh,40vh)');
    ok(/\.vv-tlbody\{[^}]*overflow-y:auto/.test(css), 'V3 label+lane in un unico scroller verticale (.vv-tlbody)');
    ok(/\.vv-tinner\{[^}]*height:auto/.test(css), 'V3 tinner altezza auto (niente 185px fisso)');
    ok(/\.vv-ph\{[^}]*top:0;bottom:0/.test(css), 'V3 playhead copre tutto l\'altezza del contenuto lane');
    ok(/\.vv-track\{[^}]*height:40px/.test(css), 'V3 lane 40px (passo 46px)');
    ok(/\.vv-lab\{[^}]*height:40px/.test(css), 'V3 etichetta corsia allineata 40px');
    ok(/\.vv-tscroll\{[^}]*min-height:100%/.test(css), 'V3 area lane riempie lo scroller verticale');
    ok(/\.vv-lhead\{[^}]*position:sticky/.test(css), 'V3b header gruppo sticky con + sempre visibile');
    ok(!!$(env, '.vv-tlbody .vv-tlabels'), 'V3 etichette dentro il container scroll (.vv-tlbody)');
    ok(!!$(env, '.vv-tinner .vv-ph'), 'V3 playhead dentro .vv-tinner (altezza contenuto)');
    ok(!!$(env, '.vv-tltools .vv-zoom'), 'V3f zoom nella riga header della timeline (.vv-tltools)');
    const ctx0 = $(env, '.vv-ctxbar');
    ok(!!ctx0 && ctx0.style.display === 'none', 'V1 barra contestuale nascosta senza selezione');
    ok(!$(env, '.vv-props'), 'V1 nessun .vv-props nel DOM');

    // bottoni compatti, non full-width
    const addGrid = panel.querySelector('.vv-addgrid');
    ok(!!addGrid, '1.3 contenitore .vv-addgrid presente');
    const addBtns = addGrid ? Array.from(addGrid.querySelectorAll('.vv-addb')) : [];
    ok(addBtns.length === 4, '1.3 4 bottoni (Testo, Immagine, Video, Audio)', 'n=' + addBtns.length);
    ok(addBtns.every(b => b.style.width !== '100%' && b.className === 'vv-addb'), '1.3 bottoni non full-width');
    ok(addBtns.map(b => b.textContent).join('|').indexOf('Video locale') >= 0, '1.3 etichette bottoni');

    // sezioni: Aggiungi elemento + Musica di sottofondo
    const sects = $$(env, '.vv-lsect');
    ok(sects.length === 2, '1.1 due sezioni: Aggiungi elemento + Musica di sottofondo');
    const heads = $$(env, '.vv-lsect .vv-sect');
    ok(heads.length === 2 && /Aggiungi elemento/.test(heads[0].textContent) && /Musica di sottofondo/.test(heads[1].textContent),
        '1.1 intestazioni sezioni corrette');
    const musRow = panel.querySelector('.vv-musrow');
    ok(!!musRow && !!musRow.querySelector('.vv-mbtn') && musRow.querySelector('.vv-mbtn').textContent === 'Scegli traccia',
        '1.1 Musica: Scegli traccia compatto');
    ok(!!musRow && !!musRow.querySelector('input[type=range]'), '1.1 Musica: Volume slider');
    ok(!!panel.querySelector('.vv-muslabel'), '1.1 etichetta traccia');

    // collasso sezione
    click(env, heads[0]);
    ok(sects[0].classList.contains('collapsed'), '1.3 sezione collassabile (click intestazione)');
    click(env, heads[0]);
    ok(!sects[0].classList.contains('collapsed'), '1.3 sezione riapribile');

    // collasso pannello via linguetta
    click(env, vtab);
    ok(pane.classList.contains('collapsed'), '1.2 pannello collassato dalla linguetta');
    click(env, vtab);
    ok(!pane.classList.contains('collapsed'), '1.2 pannello riaperto dalla linguetta');

    // resize 180–320 (delta rispetto alla posizione iniziale della maniglia)
    ptr(env, lgrab, 'pointerdown', 200, 0);          // maniglia sul bordo destro (x = larghezza 200)
    ptr(env, env.win, 'pointermove', 250, 0);         // +50 → 250
    ok(panel.style.width === '250px', '1.2 resize a 250px', panel.style.width);
    ptr(env, env.win, 'pointermove', 1000, 0);        // clamp max
    ok(panel.style.width === '320px', '1.2 clamp massimo 320px', panel.style.width);
    ptr(env, env.win, 'pointermove', 170, 0);         // 320 → 170+... delta -30 → 180 (startW200 + (170-200)=170→clamp180)
    ok(panel.style.width === '180px', '1.2 clamp minimo 180px', panel.style.width);
    ptr(env, env.win, 'pointerup', 170, 0);
    ptr(env, lgrab, 'pointerdown', 180, 0);           // startW = 180
    ptr(env, env.win, 'pointermove', 210, 0);         // +30 → 210
    ok(panel.style.width === '210px', '1.2 resize stabile dopo pointerup', panel.style.width);
    ptr(env, env.win, 'pointerup', 210, 0);

    // nessuna scrollbar interna: il pannello non ha overflow auto inline
    ok(!/overflow-y:\s*auto/.test(panel.style.cssText), '1.3 nessun overflow auto inline sul pannello');

    // funzionalità preservata: click su + Testo aggiunge una clip
    const btnText = addBtns.filter(b => /Testo/.test(b.textContent))[0];
    click(env, btnText);
    await sleep(60);
    ok(clipNodes(env).length === 1, '1.x +Testo funziona (clip creata)', 'clip=' + clipNodes(env).length);

    return env;
}

// ===============================================================
// BLOCCO 2 — tracce multiple e sovrapposizioni consentite
// ===============================================================
async function block2() {
    console.log('\n== BLOCCO 2 — Video: corsie multiple ==');

    // ---- A) due immagini su due corsie video nello stesso intervallo ----
    const envA = makeEnv();
    const idA = await openVideo(envA, {
        clips: [
            { id: 'i1', type: 'image', src: 'file:///a.png', start: 0, dur: 4, lane: 0, transition: 'fade' },
            { id: 'i2', type: 'image', src: 'file:///b.png', start: 0, dur: 4, lane: 1, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 2, audio: 1, music: 0 }
    }, 'Immagini');

    let mediaRows = $$(envA, '.vv-track[data-track="media"]');
    ok(mediaRows.length === 2, '2.1 gruppo media con 2 corsie', 'n=' + mediaRows.length);
    ok(mediaRows[0].getAttribute('data-lane') === '0' && mediaRows[1].getAttribute('data-lane') === '1',
        '2.1 corsie numerate 0/1');
    const clipI1 = envA.doc.querySelector('.vv-tclip[data-cid="i1"]');
    const clipI2 = envA.doc.querySelector('.vv-tclip[data-cid="i2"]');
    ok(!!clipI1 && !!clipI2, '2.2 entrambe le clip renderizzate (nessuna rimossa)');
    ok(!!clipI1 && !!clipI2 && clipI1.parentNode === mediaRows[0] && clipI2.parentNode === mediaRows[1],
        '2.2 clip su corsie diverse, stesso intervallo [0,4]');
    const headsA = $$(envA, '.vv-lhead');
    ok(headsA.length === 4, '2.1 quattro intestazioni gruppo', 'n=' + headsA.length);
    ok($$(envA, '.vv-laneadd').length === 4, '2.1 pulsante "+" su ogni gruppo');
    const labelsA = $$(envA, '.vv-tlabels .vv-lab').map(l => l.textContent);
    ok(labelsA.some(t => /Video\/Immagini 2/.test(t)), '2.1 etichetta "Video/Immagini 2"', labelsA.join('|'));

    // preview: entrambe montate, corsia più alta sopra
    const rangeA = $(envA, '.vv-range');
    rangeA.value = '1';
    rangeA.dispatchEvent(new envA.win.Event('input', { bubbles: true }));
    await sleep(60);
    ok($$(envA, '.vv-stage img').length === 2, '2.4 due immagini visibili in preview insieme',
        'n=' + $$(envA, '.vv-stage img').length);
    const clipEls = $$(envA, '.vv-stage .vv-clip');
    const zVals = clipEls.map(n => parseInt(n.style.zIndex, 10) || 0).sort((a, b) => a - b);
    ok(zVals.length === 2 && zVals[0] === 100 && zVals[1] === 101,
        '2.4 corsia alta = sopra (zIndex 100/101)', zVals.join(','));

    // ---- B) due corsie audio suonano insieme ----
    const envB = makeEnv();
    await openVideo(envB, {
        clips: [
            { id: 'a1', type: 'audio', src: 'file:///a.mp3', start: 0, dur: 5, lane: 0, transition: 'fade' },
            { id: 'a2', type: 'audio', src: 'file:///b.mp3', start: 0, dur: 5, lane: 1, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 1, audio: 2, music: 0 }
    }, 'Audio');
    const playBtn = $$(envB, 'button').filter(b => b.title === 'Avvia la preview')[0];
    ok(!!playBtn, '2.x pulsante Play presente');
    click(envB, playBtn);
    await sleep(80);
    const audios = $$(envB, '.vv-stage audio');
    ok(audios.length === 2, '2.4 due corsie audio montate insieme in preview', 'n=' + audios.length);
    ok(audios.length === 2 && audios.every(a => (a.__played || 0) >= 1),
        '2.4 entrambe le audio riprodotte contemporaneamente',
        audios.map(a => a.__played || 0).join(','));
    const pauseBtn = $$(envB, 'button').filter(b => b.title === 'Metti in pausa')[0];
    if (pauseBtn) click(envB, pauseBtn);
    await sleep(40);
    ok(audios.every(a => (a.__paused || 0) >= 1), '2.4 pausa su entrambe le corsie audio',
        audios.map(a => a.__paused || 0).join(','));

    // ---- C) stessa corsia: la sovrapposizione viene rifiutata (drag) ----
    const envC = makeEnv();
    await openVideo(envC, {
        clips: [
            { id: 'c1', type: 'audio', src: 'file:///a.mp3', start: 0, dur: 4, lane: 0, transition: 'fade' },
            { id: 'c2', type: 'audio', src: 'file:///b.mp3', start: 4, dur: 2, lane: 0, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 1, audio: 1, music: 0 }
    }, 'StessaCorsia');
    const c2node = envC.doc.querySelector('.vv-tclip[data-cid="c2"]');
    ok(!!c2node, '2.3 clip di partenza presente');
    // trascina c2 a sinistra di 1s (pps=60 → 60px): andrebbe su [3,5] ma c1 occupa [0,4]
    ptr(envC, c2node, 'pointerdown', 100, 0);
    ptr(envC, envC.win, 'pointermove', 40, 0);      // dx = -60px = -1s
    ptr(envC, envC.win, 'pointerup', 40, 0);
    await sleep(60);
    const c2after = envC.doc.querySelector('.vv-tclip[data-cid="c2"]');
    ok(!!c2after && c2after.style.left === '240px', '2.3 stessa corsia rifiuta sovrapposizione (rimane a 4.0s)',
        c2after && 'left=' + c2after.style.left);
    const c1after = envC.doc.querySelector('.vv-tclip[data-cid="c1"]');
    ok(!!c1after && c1after.style.left === '0px', '2.3 clip adiacente invariata');

    // ---- D) "+" sul gruppo aggiunge una corsia ----
    let plusMedia = $$(envA, '.vv-lhead')[1].querySelector('.vv-laneadd');
    click(envA, plusMedia);
    await sleep(60);
    mediaRows = $$(envA, '.vv-track[data-track="media"]');
    ok(mediaRows.length === 3, '2.1 "+" aggiunge la corsia (media 2 → 3)', 'n=' + mediaRows.length);
    let labels2 = $$(envA, '.vv-tlabels .vv-lab').map(l => l.textContent);
    ok(labels2.some(t => /Video\/Immagini 3/.test(t)), '2.1 etichetta "Video/Immagini 3"', labels2.join('|'));

    // ---- E1) corsia vuota: eliminazione senza conferma ----
    envA.confirmCalls = [];
    let lab3 = $$(envA, '.vv-tlabels .vv-lab').filter(l => /Video\/Immagini 3/.test(l.textContent))[0];
    ok(!!lab3 && !!lab3.querySelector('.vv-lanedel'), '2.7 pulsante elimina corsia presente');
    click(envA, lab3.querySelector('.vv-lanedel'));
    await sleep(60);
    mediaRows = $$(envA, '.vv-track[data-track="media"]');
    ok(mediaRows.length === 2, '2.7 corsia vuota eliminata', 'n=' + mediaRows.length);
    ok(envA.confirmCalls.length === 0, '2.7 nessuna conferma per la corsia vuota');

    // ---- E2) corsia occupata: conferma esplicita → rimossa con le clip ----
    envA.confirmCalls = [];
    envA.confirmResult = true;
    let lab2 = $$(envA, '.vv-tlabels .vv-lab').filter(l => /Video\/Immagini 2/.test(l.textContent))[0];
    click(envA, lab2.querySelector('.vv-lanedel'));
    await sleep(60);
    ok(envA.confirmCalls.length === 1 && /clip/i.test(envA.confirmCalls[0]),
        '2.7 conferma esplicita per corsia occupata', envA.confirmCalls[0]);
    mediaRows = $$(envA, '.vv-track[data-track="media"]');
    ok(mediaRows.length === 1, '2.7 corsia occupata rimossa dopo conferma', 'n=' + mediaRows.length);
    ok(!envA.doc.querySelector('.vv-tclip[data-cid="i2"]'), '2.7 clip della corsia rimossa');
    ok(!!envA.doc.querySelector('.vv-tclip[data-cid="i1"]'), '2.7 clip delle corsie rimaste conservate');

    // ---- E3) conferma = Annulla → corsia tenuta ----
    const envE = makeEnv();
    await openVideo(envE, {
        clips: [
            { id: 'e1', type: 'image', src: 'file:///a.png', start: 0, dur: 4, lane: 0, transition: 'fade' },
            { id: 'e2', type: 'image', src: 'file:///b.png', start: 0, dur: 4, lane: 1, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 2, audio: 1, music: 0 }
    }, 'ConfermaNo');
    envE.confirmResult = false;
    envE.confirmCalls = [];
    let labE = $$(envE, '.vv-tlabels .vv-lab').filter(l => /Video\/Immagini 2/.test(l.textContent))[0];
    click(envE, labE.querySelector('.vv-lanedel'));
    await sleep(60);
    ok(envE.confirmCalls.length === 1, '2.7 richiesta conferma (Annulla)');
    ok($$(envE, '.vv-track[data-track="media"]').length === 2, '2.7 corsia tenuta con Annulla');
    ok(!!envE.doc.querySelector('.vv-tclip[data-cid="e2"]'), '2.7 clip conservata con Annulla');

    // ---- F) trascinamento su un’altra corsia dello stesso tipo ----
    const envF = makeEnv();
    await openVideo(envF, {
        clips: [
            { id: 'm1', type: 'image', src: 'file:///a.png', start: 0, dur: 4, lane: 0, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 2, audio: 1, music: 0 }
    }, 'DragCorsia');
    const rowsF = $$(envF, '.vv-track[data-track="media"]');
    ok(rowsF.length === 2, '2.5 due corsie media pronte');
    // jsdom senza layout: rettangoli simulati (corsia0: y 0-42, corsia1: y 42-84)
    mockRect(rowsF[0], 0, 42);
    mockRect(rowsF[1], 42, 42);
    const m1node = envF.doc.querySelector('.vv-tclip[data-cid="m1"]');
    ptr(envF, m1node, 'pointerdown', 100, 0);
    ptr(envF, envF.win, 'pointermove', 100, 60);   // y=60 → dentro la corsia 1
    await sleep(20);
    ok(m1node.parentNode === rowsF[1], '2.5 clip spostata sulla corsia 2 durante il drag',
        m1node.parentNode && m1node.parentNode.getAttribute('data-lane'));
    ptr(envF, envF.win, 'pointerup', 100, 60);
    await sleep(60);
    const row1F = envF.doc.querySelector('.vv-track[data-track="media"][data-lane="1"]');
    const m1after = envF.doc.querySelector('.vv-tclip[data-cid="m1"]');
    ok(!!m1after && m1after.parentNode === row1F, '2.5 clip confermata sulla corsia 2 dopo il drag');

    // ---- G) testo sopra le immagini (compositing) ----
    const envG = makeEnv();
    await openVideo(envG, {
        clips: [
            { id: 'g1', type: 'image', src: 'file:///a.png', start: 0, dur: 4, lane: 0, transition: 'fade' },
            { id: 'g2', type: 'text', text: 'Titolo', start: 0, dur: 4, lane: 0, transition: 'fade', fontSize: 40, color: '#fff' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 1, audio: 1, music: 0 }
    }, 'TestoSopra');
    const rangeG = $(envG, '.vv-range');
    rangeG.value = '1';
    rangeG.dispatchEvent(new envG.win.Event('input', { bubbles: true }));
    await sleep(60);
    const textEl = envG.doc.querySelector('.vv-stage .vv-text');
    ok(!!textEl, '2.4 testo montato in preview');
    const textClip = textEl ? textEl.closest('.vv-clip') : null;
    const imgClip = envG.doc.querySelector('.vv-stage img') ? envG.doc.querySelector('.vv-stage img').closest('.vv-clip') : null;
    ok(!!textClip && !!imgClip && (parseInt(textClip.style.zIndex, 10) || 0) > (parseInt(imgClip.style.zIndex, 10) || 0),
        '2.4 testo sopra l\'immagine', textClip && imgClip ? textClip.style.zIndex + '>' + imgClip.style.zIndex : '?');

    // ---- H) durata totale = fine massima tra tutte le corsie; righello adattato ----
    const envH = makeEnv();
    await openVideo(envH, {
        clips: [
            { id: 'h1', type: 'image', src: 'file:///a.png', start: 0, dur: 3, lane: 0, transition: 'fade' },
            { id: 'h2', type: 'image', src: 'file:///b.png', start: 8, dur: 4, lane: 1, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 2, audio: 1, music: 0 }
    }, 'Durata');
    const durEl = $(envH, '.vv-ok') || $$(envH, 'div').filter(d => /Durata totale/.test(d.textContent))[0];
    ok(!!durEl && /00:12\.0/.test(durEl.textContent), '2.6 durata totale = fine massima (12s su corsia 2)',
        durEl && durEl.textContent);
    const innerH = $(envH, '.vv-tinner');
    ok(!!innerH && parseInt(innerH.style.width, 10) >= 12 * 60, '2.6 righello adattato (≥12s×60px)',
        innerH && innerH.style.width);
    const ticksH = $$(envH, '.vv-tick').map(t => t.textContent);
    ok(ticksH.some(t => /0:12/.test(t)), '2.6 tacca 0:12 presente', ticksH.slice(-3).join(','));

    // ---- I) proprietà: corsia selezionabile + posizione per video + no overlap da input ----
    const envP = makeEnv();
    await openVideo(envP, {
        clips: [
            { id: 'v1', type: 'video', src: 'file:///a.mp4', start: 0, dur: 4, lane: 0, transition: 'fade' },
            { id: 'v2', type: 'video', src: 'file:///b.mp4', start: 4, dur: 2, lane: 0, transition: 'fade' }
        ],
        music: { src: '', volume: 70 },
        lanes: { text: 1, media: 2, audio: 1, music: 0 }
    }, 'Props');
    ok($(envP, '.vv-ctxbar').style.display === 'none', 'V1 barra contestuale nascosta senza selezione (apertura)');
    const v1node = envP.doc.querySelector('.vv-tclip[data-cid="v1"]');
    ptr(envP, v1node, 'pointerdown', 10, 0);
    ptr(envP, envP.doc.querySelector('.vv-stage svg') || envP.doc.body, 'pointerup', 10, 0);
    await sleep(40);
    const propsP = $(envP, '.vv-ctxbar');
    ok(!!propsP && propsP.style.display !== 'none', 'V1 barra contestuale visibile con clip selezionata');
    ok(!$(envP, '.vv-props'), 'V1 nessun .vv-props nel DOM (proprieta in barra)');
    ok(/Inizio/.test(propsP.textContent) && /Durata/.test(propsP.textContent), 'V1 barra: Inizio + Durata');
    ok(/Transizione in/.test(propsP.textContent) && /Transizione out/.test(propsP.textContent), 'V1 barra: Transizioni in/out');
    ok(/Volume/.test(propsP.textContent), 'V1 barra: Volume');
    const corsiaSel = Array.from(propsP.querySelectorAll('select')).filter(s => /Corsia/.test((s.options[0] && s.options[0].textContent) || ''))[0]
        || Array.from(propsP.querySelectorAll('.prow')).filter(r => /Corsia/.test(r.textContent))[0]?.querySelector('select');
    ok(!!corsiaSel, '2.4 pannello proprietà: selettore Corsia');
    if (corsiaSel) ok(corsiaSel.options.length === 2, '2.4 selettore corsia con 2 opzioni', 'n=' + corsiaSel.options.length);
    ok(/Pos X/.test(propsP.textContent), '2.4 proprietà Posizione X/Y per video');
    ok(/Scala/.test(propsP.textContent), '2.4 proprietà Scala per video');

    // input Inizio che creerebbe sovrapposizione → rifiutato
    // (selezionata v1 [0,4]: portandola a 1 [1,5] invaderebbe v2 [4,6])
    const inizio = Array.from(propsP.querySelectorAll('input[type=number]'))[0];
    ok(!!inizio, '2.3 campo Inizio presente');
    if (inizio) {
        inizio.value = '1';
        inizio.dispatchEvent(new envP.win.Event('change', { bubbles: true }));
        await sleep(40);
        ok(String(inizio.value) === '0', '2.3 Inizio sovrappositivo rifiutato (rimane 0)', 'value=' + inizio.value);
        const statusP = $(envP, '.vv-status');
        ok(!!statusP && /sovrapporsi/.test(statusP.textContent), '2.3 messaggio di rifiuto nella status',
            statusP && statusP.textContent);
    }

    // ---- J) corsia Musica: "+" aggiunge corsia con traccia ----
    const envM = makeEnv();
    await openVideo(envM, null, 'Musica');
    const plusMusic = $$(envM, '.vv-lhead')[3].querySelector('.vv-laneadd');
    ok(!!plusMusic, '2.1 pulsante + anche sul gruppo Musica');
    click(envM, plusMusic);
    await sleep(120);
    const musicRows = $$(envM, '.vv-track[data-track="music"]');
    ok(musicRows.length === 2, '2.1 gruppo Musica: riga sottofondo + nuova corsia', 'n=' + musicRows.length);
    ok(!!musicRows[1] && !!musicRows[1].querySelector('.vv-tclip'), '2.1 traccia musicale inserita nella nuova corsia');
    const labM = $$(envM, '.vv-tlabels .vv-lab').map(l => l.textContent);
    ok(labM.some(t => /Musica 2/.test(t)), '2.1 etichetta "Musica 2"', labM.join('|'));

    // ---- persistenza: lanes salvato nel content ----
    await sleep(1000);   // flush debounced 900ms
    const saved = envA.store.items.filter(x => x.id === idA)[0];
    let savedLanes = null;
    try { savedLanes = JSON.parse(saved.content).lanes; } catch (e) { /* ok */ }
    ok(!!savedLanes && savedLanes.media === 1, '2.1 corsie persistite nel contenuto (media=1 dopo eliminazioni)',
        JSON.stringify(savedLanes));
}

// ===============================================================
// R21 FASE B4 - FontiPanel montato nell'editor video (contesto 'video')
// ===============================================================
async function blockFonti() {
    console.log('\n== R21 B4 - Video: pannello Fonti ==');
    const env = makeEnv();
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.win.StudyTools.video.render(cont, {});                    // elenco: nessun mount
    await sleep(150);
    const listBtn = $$(env, 'button').filter(b => String(b.textContent || '').trim() === 'Fonti');
    ok(!$(env, '.fp21-root') && listBtn.length === 0,
        'B4 mount solo in editor: elenco senza .fp21-root ne bottone Fonti',
        'root=' + !!$(env, '.fp21-root') + ' btn=' + listBtn.length);

    // fonte sorgente (appunto) per il pannello
    env.store.items.push({
        id: 'srcB4', kind: 'note', title: 'Teorema di Pitagora', materia: 'Mat',
        content: '## Pitagora\n\nIn un triangolo rettangolo vale a^2 + b^2 = c^2.',
        tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const idB4 = await openVideo(env, null, 'Video B4');         // editor
    const fontiBtn = $$(env, '.toolbar .tool-btn').filter(b => String(b.textContent || '').trim() === 'Fonti')[0];
    ok(!!fontiBtn, 'B4 bottone "Fonti" presente nella toolbar editor', fontiBtn ? 'ok' : 'assente');
    if (fontiBtn) click(env, fontiBtn);
    await sleep(250);                                             // fetch sorgenti async
    const rootB4 = $(env, '.fp21-root');
    ok(!!rootB4 && rootB4.getAttribute('data-fp21') === 'video',
        'B4 .fp21-root aperto con contesto "video"',
        rootB4 ? 'data-fp21=' + rootB4.getAttribute('data-fp21') : 'pannello assente');

    // selezione fonte + insert: marker (clip di testo) al playhead corrente
    const itemB4 = $(env, '.fp21-item');
    if (itemB4) { click(env, itemB4); await sleep(120); }         // preview -> abilita insert
    const insB4 = $(env, '.fp21-insert');
    if (insB4 && !insB4.disabled) click(env, insB4);
    await sleep(150);
    const clips0 = clipNodes(env);
    const tt0 = clips0.length ? clips0[0].querySelector('.tc-t') : null;
    ok(!!itemB4 && !!(insB4 && !insB4.disabled) && clips0.length === 1 &&
        String(tt0 ? tt0.textContent : '').indexOf('Teorema di Pitagora') >= 0,
        'B4 insert: marker con riferimento "titolo (tipo)" sulla timeline',
        'item=' + !!itemB4 + ' clips=' + clips0.length + ' tc=' + JSON.stringify(tt0 ? tt0.textContent : null));

    // provenienza persistita: prov sulla clip + fpSources nel content
    await sleep(1100);                                           // flush debounced 900ms
    const savedB4 = env.store.items.filter(x => x.id === idB4)[0];
    let provB4 = null, fpListB4 = null;
    try {
        const d = JSON.parse(savedB4.content);
        provB4 = d.clips && d.clips[0] && d.clips[0].prov;
        fpListB4 = d.fpSources;
    } catch (e) { /* ok */ }
    ok(!!provB4 && provB4.fonteId === 'srcB4' && provB4.titolo === 'Teorema di Pitagora' &&
        Array.isArray(fpListB4) && fpListB4.length === 1 && fpListB4[0].tipo === 'Appunti',
        'B4 provenienza (prov + fpSources) persistita nel content',
        JSON.stringify({ prov: provB4, fp: fpListB4 }));

    // undo (Ctrl+Z sul keyHandler dell'editor): il marker sparisce
    env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
        { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(200);
    ok(clipNodes(env).length === 0, 'B4 undo (Ctrl+Z) rimuove il marker dalla timeline',
        'n=' + clipNodes(env).length);

    // chiusura pulita
    if (fontiBtn) click(env, fontiBtn);
    await sleep(80);
    ok(!$(env, '.fp21-root'), 'B4 chiusura pulita: secondo click rimuove .fp21-root');

    const errB4 = env.errors.filter(e => !/Could not parse CSS|not implemented/i.test(e));
    ok(errB4.length === 0, 'B4 zero eccezioni console', errB4.slice(0, 3).join(' | '));
}

// ===============================================================
async function main() {
    try {
        await block1();
        await block2();
        await blockFonti();
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI VIDEO: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
