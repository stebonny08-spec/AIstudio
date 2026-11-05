'use strict';
/* tests/f22_fonti_preview.test.js - R22 FE-FONTI B2: preview visiva degli
   appunti scritti a mano.
   2.1 snapshot canvas (stroke/shape -> <img dataURL>) con fit bbox+padding,
       cache id+versione (item.updated_at; fallback content.length);
   2.2 "Nessun testo disponibile" SOLO se la nota e' veramente vuota
       (niente tratti, testo, immagini) - nota solo-tratto NON lo mostra;
   2.3 nota mista = istantanea in cima + blocchi testo/immagine in ordine;
   guardia ctx==null -> fallback su testo/hint, mai eccezione (entrambi i
   rami testati).
   Esecuzione: node tests/f22_fonti_preview.test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STROKE = { t: 'stroke', x: 10, y: 10, pts: [[10, 10], [50, 60], [90, 20], [140, 70]], size: 3, color: '#123456' };
const SHAPE = { t: 'shape', kind: 'circle', color: '#c00', size: 2, box: { x: 100, y: 40, w: 80, h: 60 }, params: null };
const SHAPE_RECT = { t: 'shape', kind: 'rectangle', color: '#080', size: 2, box: { x: 20, y: 90, w: 70, h: 40 }, rot: 0, params: null };
const TXT_A = { t: 'text', x: 10, y: 160, w: 400, h: 40, text: 'Testo A della nota mista', size: 14, color: '#141414' };
const IMG = { t: 'image', x: 10, y: 210, w: 80, h: 60, src: 'data:image/png;base64,QUJD' };
const TXT_B = { t: 'text', x: 10, y: 280, w: 400, h: 40, text: 'Testo B dopo l immagine', size: 14, color: '#141414' };

function makeItem(id, objects, extra) {
    return Object.assign({
        id: id, kind: 'note', title: 'Nota ' + id,
        content: JSON.stringify({ objects: objects }),
        materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
    }, extra || {});
}
const ITEMS = [
    makeItem('nInk', [STROKE, SHAPE], { updated_at: '2026-01-02T03:04:05.000Z' }),   // solo tratti
    makeItem('nMix', [STROKE, TXT_A, IMG, TXT_B]),                                    // mista
    makeItem('nEmpty', []),                                                           // vuota
    makeItem('nRect', [SHAPE_RECT])                                                   // solo shape chiusa
];

function makeFakeCtx() {
    const noop = () => { };
    return {
        save: noop, restore: noop, beginPath: noop, closePath: noop,
        moveTo: noop, lineTo: noop, quadraticCurveTo: noop, arc: noop,
        ellipse: noop, stroke: noop, fill: noop, strokeRect: noop, fillRect: noop,
        translate: noop, rotate: noop, scale: noop,
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
        globalAlpha: 1
    };
}

function makeEnv(canvasMode) {
    const vc = new VirtualConsole();
    const errs = [];
    vc.on('jsdomError', e => errs.push(String((e && e.message) || e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true,
        runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window;
    // canvasMode: 'ok' -> ctx+toDataURL funzionanti (stub); 'null' -> ctx null
    const calls = { toDataURL: 0 };
    if (canvasMode === 'ok') {
        win.HTMLCanvasElement.prototype.getContext = function () { calls.ctx++; return makeFakeCtx(); };
        win.HTMLCanvasElement.prototype.toDataURL = function () {
            calls.toDataURL++;
            return 'data:image/png;base64,STUB';
        };
    } else {
        win.HTMLCanvasElement.prototype.getContext = function () { return null; };
    }
    win.StudyStore = {
        listItems: async () => ITEMS.map(i => Object.assign({}, i)),
        getItem: async id => {
            const i = ITEMS.filter(x => x.id === id)[0];
            return i ? Object.assign({}, i) : null;
        },
        listMaterials: async () => []
    };
    win.eval(SRC);
    return { win, errs, calls };
}

function srcFor(win, id) {
    const it = ITEMS.filter(x => x.id === id)[0];
    return { key: 'it:' + id, kind: 'note', id: id, title: it.title, materia: '', path: '', content: it.content, raw: it };
}

(async () => {
    try {
        /* ============ RAMO A: canvas disponibile (stub ctx ok) ============ */
        let env = makeEnv('ok');
        let A = env.win.FontiPanel.adapters;

        // A1 nota SOLO-tratto: snapshot + NESSUN "Nessun testo disponibile"
        let pv = await A.previewFonte21(srcFor(env.win, 'nInk'));
        ok(/<img[^>]*class="fp21-snap"[^>]*src="data:image\/png;base64,STUB"/.test(pv.html),
            'A1 snapshot <img dataURL> per nota solo-tratto', pv.html.slice(0, 160));
        ok(pv.html.indexOf('Nessun testo disponibile') < 0,
            'A2 nota solo-tratto: NO "Nessun testo disponibile" (2.2)');
        ok(/alt="Anteprima dei tratti disegnati"/.test(pv.html), 'A3 alt istantanea');

        // A4 cache per id + versione (updated_at dello store)
        const nUrl = env.calls.toDataURL;
        pv = await A.previewFonte21(srcFor(env.win, 'nInk'));
        ok(env.calls.toDataURL === nUrl, 'A4 cache: seconda preview senza ridisegnare',
            'toDataURL=' + env.calls.toDataURL + ' (prima ' + nUrl + ')');
        ok(A.inkCache21.has('nInk|2026-01-02T03:04:05.000Z'),
            'A5 chiave cache = id|updated_at (store.js)',
            Array.from(A.inkCache21.keys()).join(','));

        // A6 nota mista: istantanea IN CIMA + blocchi in ordine oggetti
        pv = await A.previewFonte21(srcFor(env.win, 'nMix'));
        const iPng = pv.html.indexOf('fp21-snap');
        const iA = pv.html.indexOf('Testo A della nota mista');
        const iImg = pv.html.indexOf('data:image/png;base64,QUJD');
        const iB = pv.html.indexOf('Testo B dopo l immagine');
        ok(iPng >= 0 && iA > iPng && iImg > iA && iB > iImg,
            'A6 mista: istantanea in cima, poi testo A, immagine, testo B (ordine oggetti)',
            'idx snap=' + iPng + ' A=' + iA + ' img=' + iImg + ' B=' + iB);
        ok(pv.html.indexOf('Nessun testo disponibile') < 0, 'A7 mista: nessun messaggio vuoto');
        ok(/<img[^>]*class="fp21-thumb"/.test(pv.html), 'A8 mista: thumbnail immagine tenuta');

        // A9 nota veramente vuota -> messaggio
        pv = await A.previewFonte21(srcFor(env.win, 'nEmpty'));
        ok(/Nessun testo disponibile/.test(pv.html), 'A9 nota vuota -> "Nessun testo disponibile" (2.2)');

        // A10 solo shape chiusa (rettangolo) -> snapshot ridisegnata dai params
        pv = await A.previewFonte21(srcFor(env.win, 'nRect'));
        ok(/fp21-snap/.test(pv.html), 'A10 nota solo-shape: snapshot presente');

        // A11 versione fallback: senza updated_at -> content.length
        pv = await A.previewFonte21(srcFor(env.win, 'nMix'));
        const expKey = 'nMix|len' + String(srcFor(env.win, 'nMix').content).length;
        ok(A.inkCache21.has(expKey), 'A11 versione fallback = content.length (dichiarata)',
            'attesa ' + expKey + ' - presenti: ' + Array.from(A.inkCache21.keys()).join(','));

        // A12 DOM: selezione nota -> .fp21-pbody con snapshot
        const p = env.win.FontiPanel.create({ contesto: 'appunti', onInsert: () => { } });
        env.win.document.body.appendChild(p.el);
        await sleep(60);
        const item = Array.from(p.el.querySelectorAll('.fp21-item'))
            .filter(b => /nMix|Nota nMix/.test(b.textContent))[0];
        ok(!!item, 'A12a nota mista elencata', item ? 'ok' : 'assente');
        if (item) item.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        await sleep(150);
        const pbody = p.el.querySelector('.fp21-pbody');
        ok(!!pbody && !!pbody.querySelector('img.fp21-snap'),
            'A12b DOM .fp21-pbody contiene img.fp21-snap');
        ok(!!pbody && pbody.textContent.indexOf('Testo A della nota mista') >= 0,
            'A12c DOM: testo sotto l istantanea');
        p.destroy();
        ok(env.errs.length === 0, 'A13 zero eccezioni jsdom (ramo ctx ok)',
            env.errs.slice(0, 2).join(' | '));

        /* ============ RAMO B: ctx==null (jsdom senza canvas) ============ */
        env = makeEnv('null');
        A = env.win.FontiPanel.adapters;
        let threw = false;
        try {
            pv = await A.previewFonte21(srcFor(env.win, 'nInk'));
        } catch (e) {
            threw = true;
        }
        ok(!threw, 'B1 ctx==null nota solo-tratto: NESSUNA eccezione');
        ok(pv && pv.html.indexOf('Nessun testo disponibile') < 0,
            'B2 ctx==null solo-tratto: NO "Nessun testo disponibile" (hint dedicato)',
            pv ? pv.html.slice(0, 160) : 'pv nullo');
        ok(pv && /fp21-inkfb|fp21-hint/.test(pv.html), 'B3 ctx==null: hint fallback presente');

        threw = false;
        try {
            pv = await A.previewFonte21(srcFor(env.win, 'nMix'));
        } catch (e) {
            threw = true;
        }
        ok(!threw, 'B4 ctx==null mista: NESSUNA eccezione');
        ok(pv && pv.html.indexOf('Testo A della nota mista') >= 0 &&
            pv.html.indexOf('Testo B dopo l immagine') >= 0,
            'B5 ctx==null mista: fallback SU TESTO (blocchi comunque renderizzati)',
            pv ? pv.html.slice(0, 200) : 'pv nullo');
        ok(pv && pv.html.indexOf('fp21-snap') < 0, 'B6 ctx==null: nessuna immagine fantasma');

        pv = await A.previewFonte21(srcFor(env.win, 'nEmpty'));
        ok(pv && /Nessun testo disponibile/.test(pv.html),
            'B7 ctx==null nota vuota -> comunque "Nessun testo disponibile"');
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO f22_fonti_preview: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
