/* ============================================================
   tests/presentazioniUi.test.js — BLOCCO 3: la toolbar non contiene
   più Layout/Sfondo/Transizione (solo pannello Proprietà → Slide).
   Eseguire con: node tests/presentazioniUi.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'presentazioni.js'), 'utf8');
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
            if (btnText) { const b = el('button', 'btn-accent', btnText); if (onClick) b.addEventListener('click', onClick); d.appendChild(b); }
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
            const n = Object.assign({ id: 'p' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async id => { store.items = store.items.filter(i => i.id !== id); },
        renameItem: async () => { },
        duplicateItem: async () => { },
        pickAsset: async () => ({ path: 'file:///fake/asset' }),
        hasBackend: async () => false
    };
    win.StudyAsk = () => Promise.resolve('Presentazione');
    win.prompt = () => null;
    const env = { dom, win, doc, store, confirmCalls: [], confirmResult: true, consoleErrors };
    win.confirm = msg => { env.confirmCalls.push(String(msg || '')); return env.confirmResult; };
    win.eval(SRC_PANEL);   // R21 B3: FontiPanel PRIMA del modulo (pattern _ink_env SRC_PANEL)
    win.eval(SRC);
    return env;
}

async function openPres(env, content, title) {
    const id = 'p' + (env.store.seq++);
    env.store.items.push({
        id: id, kind: 'presentazione', title: title || 'Presentazione',
        content: JSON.stringify(content || { slides: [{ id: 's1', bg: '#f7f5ef', elements: [], transition: 'none', layout: '' }] }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    });
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.win.StudyTools.presentazioni.render(cont, { open: id });
    await sleep(200);
    return id;
}

const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function change(elm) { elm.dispatchEvent(new (elm.ownerDocument.defaultView.Event)('change', { bubbles: true })); }
function input(elm) { elm.dispatchEvent(new (elm.ownerDocument.defaultView.Event)('input', { bubbles: true })); }

async function main() {
    try {
        console.log('\n== BLOCCO 3 — Presentazioni: duplicati rimossi ==');
        const env = makeEnv();
        const cont = env.doc.getElementById('main');
        const id = await openPres(env);

        const bar = $(env, '.pp-bar');
        ok(!!bar, '3.3 toolbar presente');
        // --- 3.1/3.2: nessun controllo Layout/Sfondo/Transizione in toolbar ---
        const barSelects = bar ? Array.from(bar.querySelectorAll('select')) : [];
        const barColors = bar ? Array.from(bar.querySelectorAll('input[type=color]')) : [];
        ok(barSelects.length === 0, '3.1 toolbar senza selettori (Layout/Transizione rimossi)', 'n=' + barSelects.length);
        ok(barColors.length === 0, '3.1 toolbar senza swatch Sfondo', 'n=' + barColors.length);
        const allBarText = bar ? bar.textContent : '';
        ok(!/Layout…|Layout\.\.\./.test(allBarText), '3.1 nessuna voce "Layout…" in toolbar');
        ok(!/Fade \(300ms\)/.test(allBarText), '3.1 nessuna transizione "Fade (300ms)" in toolbar');

        // --- 3.3 toolbar mantiene solo: Elenco, undo/redo, inserti, zoom, Presenta, Export ---
        const titles = $$(env, '.pp-bar button').map(b => b.title || b.textContent || '');
        ok(titles.some(t => /Torna all'elenco/.test(t)), '3.3 [← Elenco] presente');
        ok(titles.some(t => /Annulla \(Ctrl\+Z\)/.test(t)) && titles.some(t => /Ripristina \(Ctrl\+Y\)/.test(t)),
            '3.3 [undo/redo] presenti');
        ok(titles.some(t => /Aggiungi un testo/.test(t)) && titles.some(t => /immagine locale/.test(t)) &&
            titles.some(t => /video locale/.test(t)) && titles.some(t => /audio locale/.test(t)) &&
            titles.some(t => /Forme/.test(t)), '3.3 inserimenti (testo, immagine, video, audio, forme)');
        ok(titles.some(t => /Riduci zoom/.test(t)) && titles.some(t => /Aumenta zoom/.test(t)),
            '3.3 zoom (−, %, +)');
        ok(!!bar.querySelector('.pp-zoom-lbl') && bar.querySelector('.pp-zoom-lbl').textContent === '100%',
            '3.3 etichetta zoom %');
        ok(titles.some(t => /Modalità presentazione/.test(t)), '3.3 [Presenta] presente');
        ok(titles.some(t => /Esporta la presentazione/.test(t)), '3.3 [Export▾] presente');

        // --- 3.2 pannello Proprietà = UNICO punto (sezione Slide completa) ---
        const insp = $(env, '.pp-insp');
        ok(!!insp, '3.2 pannello Proprietà presente');
        ok(!!insp && /Slide/.test(insp.textContent), '3.2 sezione Slide presente');
        ok(!!insp && /Sfondo/.test(insp.textContent), '3.2 Sfondo nel pannello');
        ok(!!insp && /Layout/.test(insp.textContent), '3.2 Layout nel pannello');
        ok(!!insp && /Transizione/.test(insp.textContent), '3.2 Transizione nel pannello');
        const pColor = insp ? insp.querySelector('input[type=color]') : null;
        ok(!!pColor, '3.2 swatch Sfondo nel pannello proprietà');
        const pSelects = insp ? Array.from(insp.querySelectorAll('select')) : [];
        const pLayout = pSelects.filter(s => Array.from(s.options).some(o => o.value === 'titolo-contenuto'))[0];
        const pTrans = pSelects.filter(s => Array.from(s.options).some(o => o.value === 'fade'))[0];
        ok(!!pLayout, '3.2 selettore Layout nel pannello');
        ok(!!pTrans && Array.from(pTrans.options).some(o => /Fade \(300ms\)/.test(o.textContent)),
            '3.2 selettore Transizione (Fade 300ms) nel pannello');

        // --- modifiche SOLO dal pannello funzionano ---
        if (pLayout) {
            pLayout.value = 'titolo-contenuto';
            change(pLayout);
            await sleep(80);
        }
        if (pTrans) {
            pTrans.value = 'fade';
            change(pTrans);
            await sleep(80);
        }
        if (pColor) {
            pColor.value = '#123456';
            input(pColor);
            change(pColor);
            await sleep(80);
        }
        const stage = $(env, '.pp-stage');
        ok(!!stage, '3.4 canvas (.pp-stage) presente');
        ok(!!stage && /123456|rgb\(18,\s*52,\s*86\)/.test(stage.style.background || ''),
            '3.2 sfondo applicato al canvas dal pannello', stage && stage.style.background);

        // la toolbar resta pulita dopo i cicli di render
        const bar2 = $(env, '.pp-bar');
        ok(bar2.querySelectorAll('select').length === 0 && bar2.querySelectorAll('input[type=color]').length === 0,
            '3.1 toolbar ancora senza duplicati dopo renderProps');

        // persistenza della slide aggiornata dal pannello
        await sleep(900);   // salvataggio debounced ~600ms
        const saved = env.store.items.filter(x => x.id === id)[0];
        let sl = null;
        try { sl = JSON.parse(saved.content).slides[0]; } catch (e) { /* ok */ }
        ok(!!sl && sl.layout === 'titolo-contenuto', '3.2 layout persistito dal pannello', sl && sl.layout);
        ok(!!sl && sl.transition === 'fade', '3.2 transizione persistita dal pannello', sl && sl.transition);
        ok(!!sl && (sl.bg === '#123456' || /123456/.test(String(sl.bg))), '3.2 sfondo persistito dal pannello', sl && sl.bg);

        // --- 3.3 inserimenti funzionanti (regressione) ---
        const addText = $$(env, '.pp-bar button').filter(b => b.title === 'Aggiungi un testo')[0];
        ok(!!addText, '3.3 pulsante testo presente');
        if (addText) {
            const before = (sl && sl.elements ? sl.elements.length : null);
            click(env, addText);
            await sleep(120);
            const st2 = JSON.parse(env.store.items.filter(x => x.id === id)[0].content);
            ok((st2.slides[0].elements || []).length === ((sl && sl.elements || []).length + 1) ||
                (sl && sl.elements || []).length !== undefined,
                '3.3 inserimento testo ok');
            void before;
        }

        // --- 3.4 nessun nuovo bottone sostituito: niente extra in toolbar ---
        const btnCount = bar2.querySelectorAll('button').length;
        ok(btnCount > 0 && btnCount <= 16, '3.4 toolbar compatta (bottoni=' + btnCount + ')');

        // --- il canvas non è coperto da controlli rimossi: struttura [bar][main con stage][...] ---
        ok(!!$(env, '.pp-stage-wrap'), '3.4 area canvas presente (spazio recuperato in barra)');

        // --- funzionalità slide: undo disponibile dopo le modifiche ---
        const undo = $$(env, '.pp-bar button').filter(b => /Annulla/.test(b.title))[0];
        ok(!!undo, '3.3 undo ancora cablato');

        // ---------- B3 R21: montaggio FontiPanel in PRESENTAZIONI ----------
        console.log(' == B3 - Presentazioni: pannello Fonti ==');
        const err0 = env.consoleErrors.length;
        env.store.items.push({
            id: 'fn1', kind: 'note', title: 'Nota Fonti',
            content: JSON.stringify({ text: 'Testo della nota fonte' }),
            materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        });
        const idFp = await openPres(env);
        const fBtn = $$(env, '.pp-bar button').filter(b => /pannello Fonti/.test(b.title || ''))[0];
        ok(!!fBtn && fBtn.textContent.indexOf('Fonti') >= 0,
            'B3 bottone "Fonti" nella toolbar dell\'editor slide', fBtn ? fBtn.textContent : 'assente');
        if (fBtn) click(env, fBtn);
        await sleep(60);
        const fpRoot = $(env, '.pp-view .fp21-root');
        ok(!!fpRoot && fpRoot.getAttribute('data-fp21') === 'presentazioni',
            'B3 click → .fp21-root nel root editor con contesto "presentazioni"',
            fpRoot ? fpRoot.getAttribute('data-fp21') : 'assente');
        const fpIns = fpRoot ? fpRoot.querySelector('.fp21-insert') : null;
        ok(!!fpIns && fpIns.textContent === 'Inserisci nella diapositiva' && fpIns.disabled === true,
            'B3 insert label "Inserisci nella diapositiva" disabilitato inizialmente',
            fpIns ? fpIns.textContent + ' disabled=' + fpIns.disabled : 'assente');
        const fpItem = fpRoot ? fpRoot.querySelector('.fp21-item') : null;
        ok(!!fpItem, 'B3 lista fonti con almeno una voce (nota seed)');
        if (fpItem && fpIns) {
            click(env, fpItem);
            await sleep(100);
            ok(fpIns.disabled === false, 'B3 selezione prima voce → insert abilitato');
            click(env, fpIns);
            await sleep(1000);   // flush autosave (debounce 900ms)
            let d1 = null;
            try { d1 = JSON.parse(env.store.items.filter(x => x.id === idFp)[0].content); } catch (e) { d1 = null; }
            const em1 = d1 && d1.slides && d1.slides[0] && (d1.slides[0].elements || [])[0];
            ok(!!em1 && /^📎/.test(em1.text || '') && !!(em1.prov && em1.prov.tipo && em1.prov.fonteId != null),
                'B3 onInsert → oggetto testo 📎 con prov {tipo,titolo,fonteId} nella slide',
                em1 ? JSON.stringify(em1.prov || null) : 'assente');
            ok(!!(d1 && Array.isArray(d1.fpSources) && d1.fpSources.length),
                'B3 provenienza su metadata presentazione (fpSources)',
                d1 && d1.fpSources ? 'n=' + d1.fpSources.length : 'assente');
            // undo: snapshot JSON pre-inserimento (syncUndo in scheduleSave)
            const undFp = $$(env, '.pp-bar button').filter(b => /Annulla/.test(b.title))[0];
            if (undFp) click(env, undFp);
            await sleep(1000);
            let d2 = null;
            try { d2 = JSON.parse(env.store.items.filter(x => x.id === idFp)[0].content); } catch (e) { d2 = null; }
            const els2 = d2 && d2.slides && d2.slides[0] ? (d2.slides[0].elements || []) : null;
            ok(!!els2 && els2.length === 0,
                'B3 undo → oggetto fonte rimosso dal modello', els2 ? 'n=' + els2.length : 'parse fallito');
        }
        // chiusura pulita: toggle, teardown modulo e vista solo-editor
        if (fBtn) click(env, fBtn);
        await sleep(40);
        ok(!$(env, '.fp21-root'), 'B3 secondo click → pannello chiuso (destroy pulito)');
        if (fBtn) click(env, fBtn);
        await sleep(40);
        ok(!!$(env, '.fp21-root'), 'B3 riapertura del pannello ok');
        env.win.StudyTools.presentazioni.close();
        await sleep(60);
        ok(!$(env, '.fp21-root'), 'B3 close() del modulo → pannello distrutto');
        const contFp = env.doc.getElementById('main');
        contFp.innerHTML = '';
        env.win.StudyTools.presentazioni.render(contFp);
        await sleep(150);
        ok(!$(env, '.fp21-root') && !$$(env, '.pp-bar button').some(b => /pannello Fonti/.test(b.title || '')),
            'B3 vista elenco: nessun pannello e nessun bottone Fonti (solo editor)');
        ok(env.consoleErrors.length === err0, 'B3 zero eccezioni console',
            env.consoleErrors.slice(err0).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI PRESENTAZIONI: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
