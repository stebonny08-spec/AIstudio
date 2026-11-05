'use strict';
/* tests/r27_fonti_toggle.test.js - R27 FE-FONTI (T1, jsdom):
   B1/B4  toggle via bottone Fonti + persistenza fp21_open_<ctx> + ripristino
          (pass applicativi del controller globale) + Esc
   B2/B3  collasso chip+lista via chevron, pin altezza esterna, CSS lista
          nascosta + chevron ruotato; stato fp21_top_* invariato
   B7     ROOT CAUSE: study_list SENZA content (solo preview[180]) ->
          fullContent() carica via getItem: note multi-pagina, fogli,
          documento html vuoto, oggetto sconosciuto = messaggio di vuoto
   B8     math: nessun nodo katex-error; varianti prime/parentesi; fallback
          monospace senza \ e $ con badge.
   Esecuzione: node tests/r27_fonti_toggle.test.js */
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

/* ---- item REALI con la forma del backend: study_list NON ha content ---- */
const STROKE = { t: 'stroke', x: 10, y: 10, pts: [[10, 10], [50, 60], [90, 20]], size: 3, color: '#123456' };
const TXT_P1 = { t: 'text', x: 10, y: 160, w: 400, h: 40, text: 'Testo pagina 1', size: 14, color: '#000' };
const TXT_P2 = { t: 'text', x: 10, y: 220, w: 400, h: 40, text: 'Testo pagina 2', size: 14, color: '#000' };

const LIST_ITEMS = [
    // quaderno: SOLO pages (serializableDoc cancella objects) - 2 pagine con tratti
    { id: 'nMulti', kind: 'note', title: 'Quaderno multi', materia: '',
      preview: '{"sheet":"quadretti","mode":"quaderno","w":1600,"h":1100,"pages":[{"obje' },
    { id: 'fGrid', kind: 'foglio', title: 'Foglio Reale', materia: '',
      preview: '{"rows":60,"cols":26,"v":2,"sheets":[{"name":"Foglio1","color":"#8ca4ff","cells":{"A1"' },
    { id: 'dHtml', kind: 'documento', title: 'Doc html', materia: '', preview: '{"html":"<h1' },
    { id: 'dEmpty', kind: 'documento', title: 'Doc html vuoto', materia: '', preview: '{"html":""}' },
    { id: 'badJson', kind: 'riassunto', title: 'Oggetto sconosciuto', materia: '', preview: '{"foo":1' }
];
const FULL_ITEMS = {
    nMulti: JSON.stringify({
        sheet: 'quadretti', mode: 'quaderno', w: 1600, h: 1100, page: 0,
        pages: [
            { objects: [STROKE, TXT_P1] },
            { objects: [TXT_P2] }
        ]
    }),
    fGrid: JSON.stringify({
        rows: 60, cols: 26, v: 2, current: 0,
        sheets: [{ name: 'Foglio1', color: '#8ca4ff', cells: {
            A1: { v: 'Intestazione' }, B1: { v: 'Valori' },
            A2: { v: 'alpha' }, B2: { v: '27' } } }]
    }),
    dHtml: JSON.stringify({ html: '<h1>Titolo Doc</h1><p>Paragrafo reale</p>' }),
    dEmpty: JSON.stringify({ html: '' }),
    badJson: JSON.stringify({ foo: 1 })
};

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

function makeEnv() {
    const vc = new VirtualConsole();
    const errs = [];
    vc.on('jsdomError', e => errs.push(String((e && e.message) || e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true,
        runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window;
    const calls = { getItem: 0, toDataURL: 0 };
    win.HTMLCanvasElement.prototype.getContext = function () { return makeFakeCtx(); };
    win.HTMLCanvasElement.prototype.toDataURL = function () {
        calls.toDataURL++;
        return 'data:image/png;base64,STUB';
    };
    win.StudyStore = {
        listItems: async () => LIST_ITEMS.map(i => Object.assign({}, i)),   // SENZA content!
        getItem: async (id) => {
            calls.getItem++;
            if (FULL_ITEMS[id] == null) return null;
            return { id: id, content: FULL_ITEMS[id], updated_at: '2026-11-04T00:00:00.000Z' };
        },
        listMaterials: async () => [],
        listConversations: async () => []
    };
    /* visibility emulata: solo gli elementi nel Set "VIS" hanno rect>0 -
       il controller (B1/B4) e' basato su rettangoli reali */
    const VIS = new Set();
    const RECT_VIS = { width: 340, height: 480, top: 0, left: 0, right: 340, bottom: 480, x: 0, y: 0 };
    const RECT_HID = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
    win.Element.prototype.getBoundingClientRect = function () {
        return VIS.has(this) ? Object.assign({}, RECT_VIS) : Object.assign({}, RECT_HID);
    };
    win.Element.prototype.getClientRects = function () {
        return VIS.has(this) ? [Object.assign({}, RECT_VIS)] : [];
    };
    /* KaTeX finto: rifiuta le apici prime (come il parse reale di
       \Delta G^\circ') salvo che siano \prime o avvolte in \text */
    win.katex = {
        renderToString: function (s, opts) {
            const prime = /['\u2019]/.test(s);
            if (prime && /\\prime/.test(s) === false && s.indexOf('\\text{') !== 0) {
                if (opts && opts.throwOnError) throw new Error('KaTeX parse error');
                return '<span class="katex-error">' + s + '</span>';   // il vecchio nodo rosso
            }
            return '<span class="katex-html">OK</span>';
        }
    };
    win.eval(SRC);
    return { win, errs, calls, VIS };
}

function srcFor(id) {
    const it = LIST_ITEMS.filter(x => x.id === id)[0];
    // forma REALE: niente content dalla list!
    return { key: 'it:' + id, kind: it.kind, id: id, title: it.title,
        materia: '', path: '', content: undefined, raw: it };
}

(async () => {
    try {
        /* ================= B7: root cause + adattatori ================= */
        let env = makeEnv();
        let A = env.win.FontiPanel.adapters;

        let pv = await A.previewFonte21(srcFor('nMulti'));
        ok(env.calls.getItem >= 1, 'B7.1a fullContent: study_get chiamato (root cause fix)', 'n=' + env.calls.getItem);
        ok(pv.html.indexOf('Testo pagina 1') >= 0 && pv.html.indexOf('Testo pagina 2') >= 0,
            'B7.1b TUTTE le pagine renderizzate (pages prima di objects)', pv.html.slice(0, 200));
        ok(/<img[^>]*class="fp21-snap"/.test(pv.html),
            'B7.1c snapshot canvas dei tratti presente (bug silenzioso fissato)');

        pv = await A.previewFonte21(srcFor('fGrid'));
        ok(/<table class="fp21-grid"/.test(pv.html), 'B7.2a foglio: tabella HTML dalla griglia');
        ok(pv.html.indexOf('Intestazione') >= 0 && pv.html.indexOf('27') >= 0,
            'B7.2b celle reali renderizzate (niente "Foglio non leggibile")');
        ok(/<td class="fp21-num">27<\/td>/.test(pv.html), 'B7.2c numeri a destra (fp21-num)');
        ok(/<tr class="fp21-hrow">/.test(pv.html), 'B7.2d prima riga intestazione grassetto (fp21-hrow)');

        pv = await A.previewFonte21(srcFor('dHtml'));
        ok(pv.html.indexOf('Titolo Doc') >= 0 && pv.html.indexOf('Paragrafo reale') >= 0,
            'B7.3a documento html renderizzato');

        pv = await A.previewFonte21(srcFor('dEmpty'));
        ok(pv.html.indexOf('Nessun testo disponibile') >= 0,
            'B7.3b html vuoto -> messaggio di vuoto (mai JSON grezzo)',
            pv.html.slice(0, 160));
        ok(pv.html.indexOf('{"html"') < 0, 'B7.3c nessun JSON grezzo in DOM');

        pv = await A.previewFonte21(srcFor('badJson'));
        ok(pv.html.indexOf('Nessun testo disponibile') >= 0 &&
            pv.html.indexOf('{"foo"') < 0,
            'B7.8 oggetto non riconosciuto -> vuoto+log, MAI JSON grezzo',
            pv.html.slice(0, 160));

        /* ================= B8: matematica ================= */
        const mdBad = 'Delta: $\\Delta G^\\circ\u0027 = +2870 \\text{ kJ/mol}$ fine';
        pv = await A.previewFonte21({ key: 'it:x', kind: 'riassunto', id: 'x',
            title: 'Math', materia: '', path: '', content: JSON.stringify({ text: mdBad }), raw: {} });
        ok(pv.html.indexOf('katex-error') < 0, 'B8.1a ZERO nodi katex-error (niente LaTeX rosso)',
            pv.html.slice(0, 240));
        ok(/fp21-math/.test(pv.html), 'B8.1b formula comunque renderizzata (variante prime)',
            pv.html.slice(0, 200));
        const mdWorse = 'solo $\\Delta G^\\circ\u0027(sconosciuto$ fine';
        pv = await A.previewFonte21({ key: 'it:y', kind: 'riassunto', id: 'y',
            title: 'Math2', materia: '', path: '', content: JSON.stringify({ text: mdWorse }), raw: {} });
        ok(pv.html.indexOf('katex-error') < 0, 'B8.1c nessun errore rosso nemmeno con formula rotta');
        if (/fp21-mathfb/.test(pv.html)) {
            const code = (pv.html.match(/<code>([^<]*)<\/code>/) || ['', ''])[1];
            ok(code.indexOf('$') < 0 && code.indexOf('\\') < 0,
                'B8.1d fallback monospace: senza $ ne backslash', code);
            ok(/formula non renderizzabile/.test(pv.html), 'B8.1e badge discreto presente');
        } else {
            ok(/fp21-math/.test(pv.html), 'B8.1d/e resa con variante invece del fallback',
                pv.html.slice(0, 200));
        }

        /* ================= B2/B3: collasso ================= */
        const styleTag = env.win.document.getElementById('fp21-base-style');
        ok(!!styleTag && styleTag.textContent.indexOf('.fp21-collapsed .fp21-list') >= 0,
            'B2a CSS: collassata la LISTA sparisce');
        ok(!!styleTag && styleTag.textContent.indexOf('.fp21-root.fp21-collapsed .fp21-chev svg{transform:rotate(180deg)}') >= 0,
            'B2b CSS: chevron ruotato di 180°');
        ok(!!styleTag && styleTag.textContent.indexOf('.fp21-grid td.fp21-num') >= 0,
            'B2c CSS numeri/ intestazione fogli presente');

        const p1 = env.win.FontiPanel.create({ contesto: 'appunti', onInsert: () => { } });
        env.win.document.body.appendChild(p1.el);
        await sleep(80);
        const chev = p1.el.querySelector('.fp21-chev');
        ok(!p1.el.classList.contains('fp21-collapsed'), 'B2d default espansa');
        const hBefore = p1.el.style.height;
        chev.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        ok(p1.el.classList.contains('fp21-collapsed'), 'B2e chevron collassa (chip+lista)');
        ok(env.win.localStorage.getItem('fp21_top_appunti') === '1',
            'B2f stato collasso persistito fp21_top_appunti=1');
        ok(p1.el.style.height === hBefore,
            'B3a jsdom (box 0): nessun pin spurio, altezza invariata',
            'prima="' + hBefore + '" dopo="' + p1.el.style.height + '"');
        chev.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        ok(!p1.el.classList.contains('fp21-collapsed') &&
            env.win.localStorage.getItem('fp21_top_appunti') === '0',
            'B2g secondo click espande + ripersiste 0');
        p1.destroy();

        /* ================= B1/B4: toggle + persistenza ================= */
        // bottone Fonti finto (forma reale [data-fonti]) + pannello visibile
        const btn = env.win.document.createElement('button');
        btn.setAttribute('data-fonti', '1');
        btn.addEventListener('click', () => {
            // toggle tipo notes.toggleFonti: aggiunge/rimuove .show
            const p = env.win.document.querySelector('.fp21-root[data-fp21="appunti"]');
            if (!p) return;
            const want = !p.classList.contains('show');
            p.classList.toggle('show', want);
            if (want) env.VIS.add(p); else env.VIS.delete(p);
        });
        env.win.document.body.appendChild(btn);
        env.VIS.add(btn);      // bottone reale = visibile (rect>0) nel browser

        const pA = env.win.FontiPanel.create({ contesto: 'appunti', onInsert: () => { } });
        env.win.document.body.appendChild(pA.el);
        await sleep(60);
        // click1: apre -> deve registrare fp21_open_appunti=1
        btn.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        await sleep(30);
        ok(env.win.localStorage.getItem('fp21_open_appunti') === '1',
            'B4a click apri registra fp21_open_appunti=1',
            String(env.win.localStorage.getItem('fp21_open_appunti')));
        // click2: chiude ->0
        btn.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        await sleep(30);
        ok(env.win.localStorage.getItem('fp21_open_appunti') === '0',
            'B4b click chiudi registra fp21_open_appunti=0');
        ok(!env.VIS.has(pA.el), 'B1a chiuso = pannello non visibile');

        // ripristino: key=1, pannello chiuso, mutation -> pass applica click
        env.win.localStorage.setItem('fp21_open_appunti', '1');
        ok(!env.VIS.has(pA.el), 'B1b pre-condizione chiuso');
        const dummy = env.win.document.createElement('span');
        dummy.textContent = 'mutation';
        env.win.document.body.appendChild(dummy);      // scatena MutationObserver
        await sleep(700);                              // pass a 350ms
        ok(env.win.localStorage.getItem('fp21_open_appunti') === '1' && env.VIS.has(pA.el),
            'B4c reload-state: pass applicativi riaprono il pannello (click bottone)',
            'open=' + env.win.localStorage.getItem('fp21_open_appunti') +
            ' vis=' + env.VIS.has(pA.el));
        // nessun loop: resta stabile (chiave 1, visibile)
        env.win.document.body.appendChild(env.win.document.createElement('i'));
        await sleep(700);
        ok(env.win.localStorage.getItem('fp21_open_appunti') === '1',
            'B4d nessun loop di riapertura (stato stabile)');

        /* Esc: con pannello visibile -> chiude (click bottone) */
        const escEv = new env.win.KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true
        });
        env.win.document.dispatchEvent(escEv);
        await sleep(30);
        ok(!env.VIS.has(pA.el), 'B1c Esc chiude il pannello visibile',
            'vis=' + env.VIS.has(pA.el));
        ok(env.win.localStorage.getItem('fp21_open_appunti') === '0',
            'B1d Esc ha registrato lo stato chiuso');
        pA.destroy();

        ok(env.errs.length === 0, 'X zero eccezioni jsdom', env.errs.slice(0, 2).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO r27_fonti_toggle: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
