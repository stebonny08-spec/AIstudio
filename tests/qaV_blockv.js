/* ============================================================
   tests/qaV_blockv.js - QA-V: verifica indipendente BLOCCO V (Video)
   Read-only su web_frontend/ (jsdom sui moduli REALI + stub App/StudyStore).

   Eseguire con: node tests/qaV_blockv.js
   Checklist: 1 scroll/-layout, 2 preview, 3 timeline, 4 props assente,
              5 ctxbar clip, 6 spazio morto, 7 sidebar, 8 regressione.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { JSDOM } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'video.js');
const CSS_PATH = path.join(ROOT, 'web_frontend', 'html', 'css', 'modules.css');
const TEST_PATH = path.join(ROOT, 'tests', 'videoUi.test.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' -- ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' -- ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- harness (specchio di videoUi.test.js) ----------
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
        pickAsset: async () => ({ path: 'file:///fake/asset' }),
        hasBackend: async () => false
    };
    win.StudyAsk = () => Promise.resolve('Progetto');
    win.prompt = () => null;
    const env = { dom, win, doc, store, confirmCalls: [], confirmResult: true };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
    win.HTMLMediaElement.prototype.play = function () { this.__played = (this.__played || 0) + 1; return Promise.resolve(); };
    win.HTMLMediaElement.prototype.pause = function () { this.__paused = (this.__paused || 0) + 1; };
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
    target.dispatchEvent(new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
}
function key(env, target, init) { target.dispatchEvent(new env.win.KeyboardEvent('keydown', Object.assign({ bubbles: true }, init))); }
function clipNodes(env) { return $$(env, '.vv-tclip[data-cid]').filter(n => n.getAttribute('data-cid') !== '@music'); }

// helper CSS: corpo della prima regola "sel{...}"
function ruleBody(css, sel) {
    const rx = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}';
    const m = css.match(new RegExp(rx));
    return m ? m[1] : null;
}
function hasDecl(css, sel, decl) { const b = ruleBody(css, sel); return !!b && b.indexOf(decl) >= 0; }
function px(rule, prop) { const m = rule && rule.match(new RegExp('(?:^|;)' + prop + ':(\\d+)px')); return m ? parseInt(m[1], 10) : null; }

const CONTENT_BASE = {
    clips: [
        { id: 'c1', type: 'video', src: 'file:///v.mp4', start: 0, dur: 4, lane: 0, transition: 'fade' },
        { id: 'c2', type: 'video', src: 'file:///w.mp4', start: 4, dur: 2, lane: 0, transition: 'fade' }
    ],
    music: { src: 'file:///song.mp3', volume: 70 },
    lanes: { text: 1, media: 1, audio: 1, music: 1 }
};

async function main() {
    console.log('=== QA-V - BLOCCO V (Video) ===');
    const env = makeEnv();
    await openVideo(env, CONTENT_BASE, 'QA-V');
    const doc = env.doc, win = env.win;
    const css = styleText(env);

    // =========================================================
    console.log('\n-- CL1 scroll/layout (editor/body/timeline)');
    const ed = $(env, '.vv-editor');
    ok(!!ed, '1.0 .vv-editor presente (container #main)');
    ok(hasDecl(css, '.vv-editor', 'overflow:hidden'), '1.1 CSS .vv-editor overflow:hidden');
    ok(hasDecl(css, '.vv-editor', 'height:calc(100vh - 44px)'), '1.2 CSS altezza editor calc(100vh - 44px)',
        ruleBody(css, '.vv-editor'));
    ok(hasDecl(css, '.vv-main', 'overflow:hidden'), '1.3 CSS .vv-main overflow:hidden');
    ok(!hasDecl(css, '.vv-main', 'overflow-y:auto'), '1.4 CSS .vv-main senza overflow-y:auto');
    const body = $(env, '.vv-body');
    const bodyKids = body ? Array.from(body.children).map(k => k.className.split(' ')[0]) : [];
    ok(!!body && body.children.length === 2 &&
        body.children[0].classList.contains('vv-split') &&
        body.children[1].classList.contains('vv-tlwrap'),
        '1.5 .vv-body ha esattamente 2 figli [split, tlwrap]', bodyKids.join('|'));
    ok(hasDecl(css, '.vv-tlwrap', 'height:clamp(160px,40vh,40vh)'), '1.6 CSS timeline height clamp(160px,40vh,40vh)');
    ok(hasDecl(css, '.vv-tlwrap', 'overflow:hidden'), '1.7 CSS .vv-tlwrap overflow:hidden');
    ok(hasDecl(css, '.vv-tlbody', 'overflow-y:auto'), '1.8 CSS .vv-tlbody overflow-y:auto');

    // audit: tutte le regole overflow-y:auto - quali elementi live stanno dentro .vv-editor?
    const oySels = [];
    const oyRx = /([^{}"']+)\{[^}]*overflow-y:auto/g;
    let om;
    while ((om = oyRx.exec(SRC)) !== null) {
        om[1].split(',').forEach(s => { const t = s.trim(); if (t) oySels.push(t); });
    }
    const oyInEditor = [];
    oySels.forEach(s => {
        try { $$(env, s).forEach(e => { if (e.closest('.vv-editor')) oyInEditor.push(s + ' => .' + e.className); }); }
        catch (e) { /* selettore non valido */ }
    });
    ok(oyInEditor.length === 1 && /\.vv-tlbody\b/.test(oyInEditor[0]),
        '1.9 scroll verticale in editor SOLO su .vv-tlbody',
        'regole overflow-y:auto=[' + oySels.join(' | ') + '] ; in-editor=[' + oyInEditor.join(' | ') + ']');
    const deadOy = ['.vv-center', '.vv-panel.vv-right'].map(s => s + ' DOM=' + $$(env, s).length);
    const contIds = ['.vv-editor', '.vv-body', '.vv-split', '.vv-main', '.vv-tlwrap']
        .map(s => { const e = $(env, s); return s + '=(inline overflowY:' + (e ? (e.style.overflowY || '-') : 'missing') + ')'; });
    ok(contIds.every(x => x.indexOf('auto') < 0 && x.indexOf('scroll') < 0),
        '1.10 nessun overflow inline auto/scroll sui contenitori principali',
        contIds.join(' ') + ' ; residui CSS morti: ' + deadOy.join(' '));

    // =========================================================
    console.log('\n-- CL2 preview unica e ferma');
    ok($$(env, '.vv-props').length === 0, '2.1 nessun nodo .vv-props nel DOM editor');
    ok(!/\.vv-props/.test(SRC), '2.2 zero regole/CSS .vv-props nel sorgente video.js');
    const stg = $(env, '.vv-main .vv-stage');
    ok(!!stg, '2.3 stage dentro .vv-main');
    const stgRule = ruleBody(css, '.vv-stage');
    ok(!!stgRule && stgRule.indexOf('aspect-ratio:16/9') >= 0 && stgRule.indexOf('max-width:100%') >= 0 &&
        (stgRule.indexOf('margin:0 auto') >= 0 || stgRule.indexOf('align-self:center') >= 0),
        '2.4 CSS stage 16:9 + max-width + centrato', stgRule);
    ok(!!stgRule && !/\bborder:/.test(stgRule), '2.5 stage senza bordo proprio (bordo unico = .vv-main)');
    const tr = $(env, '.vv-transport');
    ok(!!tr, '2.6 transport presente');
    ok(!!stg && !!tr && !!(stg.compareDocumentPosition(tr) & win.Node.DOCUMENT_POSITION_FOLLOWING),
        '2.7 transport DOPO lo stage (sotto)');
    const mainRule = ruleBody(css, '.vv-main');
    ok(!!mainRule && mainRule.indexOf('display:flex') >= 0 && mainRule.indexOf('flex-direction:column') >= 0,
        '2.8 .vv-main flex column (stage centrato)', mainRule);

    // =========================================================
    console.log('\n-- CL3 timeline');
    const tlwrap = $(env, '.vv-tlwrap'), tltools = $(env, '.vv-tltools'),
        ctx = $(env, '.vv-ctxbar'), tlbody = $(env, '.vv-tlbody');
    const wrapKids = tlwrap ? Array.from(tlwrap.children).map(k => k.className.split(' ')[0]) : [];
    ok(wrapKids.length === 3 && wrapKids[0] === 'vv-tltools' && wrapKids[1] === 'vv-ctxbar' && wrapKids[2] === 'vv-tlbody',
        '3.1 .vv-tlwrap = [tltools, ctxbar, tlbody] (ctxbar dopo header, prima del body)', wrapKids.join('|'));
    const labels = $(env, '.vv-tlabels'), tscroll = $(env, '.vv-tscroll');
    ok(!!labels && labels.parentElement === tlbody && !!tscroll && tscroll.parentElement === tlbody,
        '3.2 .vv-tlabels e .vv-tscroll stesso wrapper verticale (.vv-tlbody)');
    // allineamento spaziatori vs righello/header
    const labSp = px(ruleBody(css, '.vv-lab-sp'), 'height');
    const rulRule = ruleBody(css, '.vv-truler');
    const rulH = px(rulRule, 'height');
    const rulBorder = rulRule && rulRule.indexOf('border-bottom:1px') >= 0 ? 1 : 0;
    ok(labSp !== null && rulH !== null && (labSp === rulH || labSp === rulH + rulBorder),
        '3.3 spacer etichette = altezza righello', 'lab-sp=' + labSp + ' truler=' + rulH + '+b' + rulBorder);
    ok(hasDecl(css, '.vv-lhead-sp', 'height:26px') && hasDecl(css, '.vv-lhead', 'height:26px') &&
        hasDecl(css, '.vv-lhead-sp', 'margin-bottom:6px') && hasDecl(css, '.vv-lhead', 'margin-bottom:6px'),
        '3.4 spacer header = altezza header gruppo (26+6)');
    const trkRule = ruleBody(css, '.vv-track'), labRule = ruleBody(css, '.vv-lab');
    const trkH = px(trkRule, 'height'), labH = px(labRule, 'height');
    ok(trkH !== null && labH !== null && trkH === labH && trkH >= 40 && trkH <= 48,
        '3.5 lane e etichetta 40-48px e uguali', 'track=' + trkH + ' lab=' + labH);
    ok(!!trkRule && trkRule.indexOf('margin-bottom:6px') >= 0 && !!labRule && labRule.indexOf('margin-bottom:6px') >= 0,
        '3.6 passo identico (40+6=46px)', 'track: ' + trkRule);
    const lh = $(env, '.vv-lhead');
    ok(!!lh && !!lh.querySelector('.vv-laneadd'), '3.7 header gruppo .vv-lhead contiene .vv-laneadd');
    ok(hasDecl(css, '.vv-laneadd', 'margin-left:auto'), '3.8 .vv-laneadd margin-left:auto (pulsante + a destra)');
    const inner = $(env, '.vv-tinner'), rul = $(env, '.vv-truler'), tracks = $(env, '.vv-ttracks');
    ok(!!inner && inner.parentElement === tscroll, '3.9 .vv-tinner dentro .vv-tscroll (flusso orizzontale)');
    ok(!!rul && rul.parentElement === inner && !!tracks && tracks.parentElement === inner,
        '3.10 righello e lane stesso flusso -> stesso scroller verticale .vv-tlbody');
    ok(hasDecl(css, '.vv-tscroll', 'overflow-x:auto'), '3.11 scorrimento orizzontale su .vv-tscroll');
    const ph = $(env, '.vv-ph');
    ok(!!ph && ph.parentElement === inner, '3.12 playhead dentro .vv-tinner');
    ok(/\.vv-ph\{[^}]*top:0;bottom:0/.test(css), '3.13 playhead top:0;bottom:0 copre tutta l\'altezza');
    ok(!!$(env, '.vv-tltools .vv-zoom'), '3.14 zoom presente in .vv-tltools (header timeline)');

    // =========================================================
    console.log('\n-- CL4 pannello .vv-props assente');
    ok($$(env, '.vv-props').length === 0, '4.1 zero nodi .vv-props nel DOM editor');
    const propsOcc = (SRC.match(/\.vv-props/g) || []).length;
    ok(propsOcc === 0, '4.2 zero occorrenze .vv-props in video.js (CSS compreso)', 'occorrenze=' + propsOcc);

    // =========================================================
    console.log('\n-- CL5 barra contestuale (.vv-ctxbar)');
    ok(!!ctx && ctx.style.display === 'none', '5.1 ctxbar nascosta senza selezione', 'display=' + (ctx && ctx.style.display));
    const c1n = $(env, '.vv-tclip[data-cid="c1"]');
    ok(!!c1n, '5.2 clip c1 presente');
    ptr(env, c1n, 'pointerdown', 100, 0);
    await sleep(30);
    ptr(env, win, 'pointerup', 100, 0);
    await sleep(60);
    ok(!!ctx && ctx.style.display !== 'none', '5.3 ctxbar visibile con clip selezionata', 'display=' + (ctx && ctx.style.display));
    const tC = ctx ? ctx.textContent : '';
    ok(/Inizio/.test(tC) && /Durata/.test(tC), '5.4 ctxbar contiene Inizio + Durata');
    ok(/Volume/.test(tC), '5.5 ctxbar contiene Volume');
    ok(/Scala/.test(tC), '5.6 ctxbar contiene Scala');
    ok(/Pos X/.test(tC) && /Pos Y/.test(tC), '5.7 ctxbar contiene Pos X / Pos Y');
    ok(/Transizione in/.test(tC) && /Transizione out/.test(tC), '5.8 ctxbar contiene Transizioni in/out');
    const corsiaSel = ctx && Array.from(ctx.querySelectorAll('select')).filter(s => /Corsia/.test((s.options[0] && s.options[0].textContent) || ''))[0];
    ok(!!corsiaSel, '5.9 ctxbar contiene selettore Corsia');
    // campo Inizio: sovrapposizione nella stessa corsia rifiutata (vecchio test 2.3 ora su ctxbar)
    const inz = ctx ? ctx.querySelectorAll('input[type=number]')[0] : null;
    ok(!!inz && ctx.contains(inz), '5.10 campo Inizio dentro .vv-ctxbar');
    if (inz) {
        inz.value = '1';   // c1 [0,4] -> [1,5] invade c2 [4,6] stessa corsia
        inz.dispatchEvent(new win.Event('change', { bubbles: true }));
        await sleep(40);
        ok(String(inz.value) === '0', '5.11 Inizio sovrappositivo rifiutato (rimane 0)', 'value=' + inz.value);
        const stt = $(env, '.vv-status');
        ok(!!stt && /sovrapporsi/.test(stt.textContent), '5.12 messaggio di rifiuto nella status', stt && stt.textContent);
    }
    // ramo musica
    const mus = $(env, '.vv-tclip[data-cid="@music"]');
    ok(!!mus, '5.13 blocco musica (sottofondo) presente');
    ptr(env, mus, 'pointerdown', 10, 0);
    await sleep(60);
    ok(!!ctx && ctx.style.display !== 'none', '5.14 ctxbar visibile con ramo @music selezionato');
    const tM = ctx ? ctx.textContent : '';
    const mBtns = ctx ? Array.from(ctx.querySelectorAll('button')).map(b => b.textContent) : [];
    ok(/Volume/.test(tM), '5.15 ramo musica: Volume');
    ok(mBtns.some(x => /Cambia/.test(x)), '5.16 ramo musica: Cambia (traccia)', mBtns.join('|'));
    ok(mBtns.some(x => /Rimuovi/.test(x)), '5.17 ramo musica: Rimuovi', mBtns.join('|'));

    // ---- drag / trim / split / undo (funzionale) ----
    // drag
    const envD = makeEnv();
    await openVideo(envD, {
        clips: [{ id: 'k1', type: 'text', text: 'Ciao', start: 0, dur: 4, lane: 0 }],
        music: { src: '', volume: 70 }, lanes: { text: 1, media: 1, audio: 1, music: 0 }
    }, 'Drag');
    const kn = $(envD, '.vv-tclip[data-cid="k1"]');
    ok(!!kn, '5.18 clip da trascinare presente');
    ptr(envD, kn, 'pointerdown', 100, 0);
    ptr(envD, envD.win, 'pointermove', 160, 0);   // +60px = +1s (pps 60)
    ptr(envD, envD.win, 'pointerup', 160, 0);
    await sleep(80);
    const kn2 = $(envD, '.vv-tclip[data-cid="k1"]');
    ok(!!kn2 && kn2.style.left === '60px', '5.19 drag clip funzionante (start 0 -> 1s)', kn2 && kn2.style.left);

    // trim (bordo destro)
    const envT = makeEnv();
    await openVideo(envT, {
        clips: [{ id: 't1', type: 'text', text: 'Via', start: 0, dur: 4, lane: 0 }],
        music: { src: '', volume: 70 }, lanes: { text: 1, media: 1, audio: 1, music: 0 }
    }, 'Trim');
    const tn = $(envT, '.vv-tclip[data-cid="t1"]');
    const hr = tn && tn.querySelector('.th-r');
    ok(!!hr, '5.20 maniglia trim bordo destro presente');
    ptr(envT, hr, 'pointerdown', 240, 0);          // bordo destro a 4s*60px
    ptr(envT, envT.win, 'pointermove', 300, 0);     // +60px = +1s
    ptr(envT, envT.win, 'pointerup', 300, 0);
    await sleep(80);
    const tn2 = $(envT, '.vv-tclip[data-cid="t1"]');
    ok(!!tn2 && tn2.style.width === '300px', '5.21 trim bordo destro funzionante (dur 4 -> 5s)', tn2 && tn2.style.width);

    // split + undo
    const envS = makeEnv();
    await openVideo(envS, {
        clips: [{ id: 's1', type: 'text', text: 'Parti', start: 0, dur: 4, lane: 0 }],
        music: { src: '', volume: 70 }, lanes: { text: 1, media: 1, audio: 1, music: 0 }
    }, 'Split');
    const sn = $(envS, '.vv-tclip[data-cid="s1"]');
    ptr(envS, sn, 'pointerdown', 10, 0);
    ptr(envS, envS.win, 'pointerup', 10, 0);
    await sleep(60);
    // playhead a 2s cliccando il righello
    const ruler = $(envS, '.vv-truler');
    ptr(envS, ruler, 'pointerdown', 120, 0);
    ptr(envS, envS.win, 'pointerup', 120, 0);
    await sleep(40);
    const splitBtn = $$(envS, 'button').filter(b => /Dividi/.test(b.title || ''))[0];
    ok(!!splitBtn, '5.22 pulsante Dividi presente');
    if (splitBtn) { click(envS, splitBtn); await sleep(80); }
    const nAfterSplit = clipNodes(envS).length;
    ok(nAfterSplit === 2, '5.23 split clip funzionante (1 -> 2 clip)', 'n=' + nAfterSplit);

    // undo: Ctrl+Z + ricerca pulsante/ scorciatoia
    const undoBtns = $$(envS, 'button').filter(b => /annulla|undo|ripristina/i.test((b.title || '') + ' ' + (b.textContent || '')));
    key(envS, envS.win, { key: 'z', ctrlKey: true });
    key(envS, envS.doc.body, { key: 'z', ctrlKey: true });
    key(envS, envS.win, { key: 'Z', ctrlKey: true, shiftKey: true });
    await sleep(80);
    const nAfterUndo = clipNodes(envS).length;
    ok(nAfterUndo < nAfterSplit || undoBtns.length > 0,
        '5.24 undo clip funzionante (Ctrl+Z o pulsante)',
        'clip split=' + nAfterSplit + ' dopo undo=' + nAfterUndo + ' pulsanti undo=' + undoBtns.length);
    // evidenza statica: pushHist deve essere INVOCATO per popolare lo storico
    const pushOcc = (SRC.match(/pushHist\s*\(/g) || []).length;      // 1 = solo la definizione
    const undoOcc = (SRC.match(/doUndo\s*\(/g) || []).length;        // 1 = solo la definizione
    ok(pushOcc > 1, '5.25 pushHist invocato (storico undo realmente alimentato)',
        'occorrenze pushHist( = ' + pushOcc + ' (1 = solo definizione); doUndo( = ' + undoOcc);

    // =========================================================
    console.log('\n-- CL6 spazio morto sotto timeline');
    ok(!!body && body.lastElementChild && body.lastElementChild.classList.contains('vv-tlwrap'),
        '6.1 nessun fratello DOPO .vv-tlwrap in .vv-body');
    ok(hasDecl(css, '.vv-body', 'flex:1') && hasDecl(css, '.vv-body', 'min-height:0'),
        '6.2 CSS .vv-body flex:1 min-height:0 (chiude in altezza)');
    ok(hasDecl(css, '.vv-tlwrap', 'flex:0 0 auto'), '6.3 CSS .vv-tlwrap flex:0 0 auto');
    ok(hasDecl(css, '.vv-tlbody', 'flex:1'), '6.4 CSS .vv-tlbody flex:1 riempie la timeline');
    const edKids = ed ? Array.from(ed.children).map(k => k.className || k.tagName) : [];
    ok(edKids.length === 2 && edKids[0] === 'toolbar' && edKids[1] === 'vv-body',
        '6.5 editor = [toolbar, vv-body] senza elementi extra', edKids.join('|'));
    ok(hasDecl(css, '.vv-editor', 'display:flex') && hasDecl(css, '.vv-editor', 'flex-direction:column'),
        '6.6 altezze coerenti: editor flex column (toolbar auto + body flex:1 + timeline auto)');

    // =========================================================
    console.log('\n-- CL7 sidebar (.vv-pane.vv-side)');
    const split = $(env, '.vv-split');
    const pane = split && split.children[0];
    ok(!!pane && pane.classList.contains('vv-pane') && pane.classList.contains('vv-side'),
        '7.1 classe alias .vv-side sul .vv-pane', pane && pane.className);
    ok(hasDecl(css, '.vv-side.collapsed .vv-panel', 'display:none'),
        '7.2 regola .vv-side.collapsed .vv-panel{display:none}');
    ok(hasDecl(css, '.vv-side.collapsed .vv-lgrab', 'display:none'),
        '7.3 regola .vv-side.collapsed .vv-lgrab{display:none}');
    const vtab = pane && pane.querySelector('.vv-vtab');
    const panel = pane && pane.querySelector('.vv-panel.vv-left');
    ok(!!vtab && !!panel, '7.4 linguetta e pannello presenti');
    if (vtab) {
        click(env, vtab);
        ok(pane.classList.contains('collapsed'), '7.5 collasso reale (classe collapsed applicata)');
        ok($$(env, '.vv-panel.vv-right').length === 0 && $$(env, '.vv-props').length === 0 &&
            Array.from(split.children).length === 2,
            '7.6 nessuna seconda colonna fantasma (anche da aperta)');
        click(env, vtab);
        ok(!pane.classList.contains('collapsed'), '7.7 riapertura pannello');
    }
    ok(!!panel && panel.style.width === '200px', '7.8 larghezza pannello 200px', panel && panel.style.width);

    // =========================================================
    console.log('\n-- CL8 regressione');
    try {
        cp.execSync('node --check "' + SRC_PATH + '"', { stdio: 'pipe' });
        ok(true, '8.1 node --check video.js (sintassi OK)');
    } catch (e) {
        ok(false, '8.1 node --check video.js', String(e.stderr || e.message).slice(0, 300));
    }
    let out = '';
    try {
        out = cp.execSync('node "' + TEST_PATH.replace(/\\/g, '/') + '"', { cwd: ROOT, stdio: 'pipe', timeout: 180000 }).toString('utf8');
    } catch (e) {
        out = String(e.stdout || '') + String(e.stderr || '');
    }
    const rm = out.match(/RISULTATI VIDEO:\s*(\d+)\s*passati,\s*(\d+)\s*falliti/);
    ok(!!rm && Number(rm[1]) === 113 && Number(rm[2]) === 0,
        '8.2 node tests/videoUi.test.js = 113/113', rm ? rm[0] : 'riga risultati non trovata');
    const cssTxt = fs.readFileSync(CSS_PATH, 'utf8');
    const cssVv = (cssTxt.match(/vv-/g) || []).length;
    const statC = fs.statSync(CSS_PATH), statV = fs.statSync(SRC_PATH);
    let gitEv = '';
    try { gitEv = cp.execSync('git ls-files --error-unmatch "' + CSS_PATH.replace(/\\/g, '/') + '" 2>nul || echo untracked', { cwd: ROOT, stdio: 'pipe' }).toString('utf8').trim(); }
    catch (e) { gitEv = 'untracked'; }
    ok(cssVv === 0, '8.3 css/modules.css senza regole vv- (intatto)', 'occorrenze vv-=' + cssVv);
    ok(statC.mtimeMs <= statV.mtimeMs,
        '8.4 modules.css non modificato di recente (mtime <= video.js)',
        'modules.css=' + statC.toISOString() + ' video.js=' + statV.toISOString() + ' git=' + (gitEv || 'n/d'));

    // =========================================================
    console.log('\n=== RIEPILOGO QA-V: ' + pass + ' passati, ' + fail + ' falliti ===');
    failures.forEach(f => console.log('  FAIL: ' + f));
    console.log('VERDETTO: ' + (fail === 0 ? 'PASS' : 'FAIL'));
}

main().catch(e => {
    console.error('ECCEZIONE: ' + (e && e.stack ? e.stack : e));
    console.log('VERDETTO: FAIL (eccezione)');
    process.exit(1);
});
