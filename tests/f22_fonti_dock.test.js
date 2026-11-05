'use strict';
/* tests/f22_fonti_dock.test.js - R22 FE-FONTI B1: posizione del pannello
   nei mount FLOTTANTI (tranne Appunti e Schemi: delegati altri).
   - dock SOTTO la toolbar del modulo (offset = altezza toolbar + 8px);
   - z-index SOTTO i controlli della toolbar dove hanno z esplicito
     (doc-bar 40/pill 30 -> 20; mod-header 6 -> 5);
   - wrapper laterale (fogli/video): wrapper staccato sotto la toolbar,
     root nel flusso del wrapper;
   - appunti/schemi: ZERO stili inline di posizionamento.
   jsdom non fa layout: i rect vengono stubbati (pattern misure T2).
   Esecuzione: node tests/f22_fonti_dock.test.js */
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

function makeEnv() {
    const vc = new VirtualConsole();
    const errs = [];
    vc.on('jsdomError', e => errs.push(String((e && e.message) || e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true,
        runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window;
    win.StudyStore = { listItems: async () => [], getItem: async () => null, listMaterials: async () => [] };
    win.eval(SRC);
    return { win, errs };
}
function stubRect(el, r) {
    const base = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    el.getBoundingClientRect = () => Object.assign({}, base, r);
}
function clearChrome(win) {
    Array.prototype.forEach.call(
        win.document.querySelectorAll('.doc-bar,.pp-bar,.fg-top,.toolbar,.mod-header'),
        el => el.parentNode && el.parentNode.removeChild(el));
}
function refit(win) {
    win.dispatchEvent(new win.Event('resize'));
}

(async () => {
    try {
        const env = makeEnv();
        const win = env.win;
        const FP = win.FontiPanel;
        const DOC = win.document;

        /* ---- 1) mount fixed: documenti/presentazioni/ripasso ---- */
        const cases = [
            { ctx: 'documenti', cls: 'doc-bar', z: '20' },
            { ctx: 'presentazioni', cls: 'pp-bar', z: '5' },
            { ctx: 'ripasso', cls: 'toolbar', z: '5' }
        ];
        for (const c of cases) {
            clearChrome(win);
            const tb = DOC.createElement('div');
            tb.className = c.cls;
            DOC.body.appendChild(tb);
            stubRect(tb, { top: 4, bottom: 60, left: 0, right: 1440, width: 1440, height: 56 });
            const p = FP.create({ contesto: c.ctx, onInsert: () => { } });
            DOC.body.appendChild(p.el);
            stubRect(p.el, { left: 1090, right: 1426, width: 336, top: 58, bottom: 658, height: 600 });
            refit(win);
            await sleep(30);
            ok(p.el.style.position === 'fixed', 'D1.' + c.ctx + ' position:fixed inline');
            ok(p.el.style.left === '0px' && p.el.style.right === 'auto',
                'D2.' + c.ctx + ' R24: left allineato alla toolbar (0px, right:auto)',
                'left=' + p.el.style.left + ' right=' + p.el.style.right);
            ok(p.el.style.top === '68px',
                'D3.' + c.ctx + ' dock sotto toolbar (60+8=68px)', 'top=' + p.el.style.top);
            ok(p.el.style.zIndex === c.z,
                'D4.' + c.ctx + ' z-index=' + c.z + ' sotto i controlli della toolbar',
                'z=' + p.el.style.zIndex);

            // con mod-header PIU' BASSA: si allinea al bordo inferiore maggiore
            const mh = DOC.createElement('div');
            mh.className = 'mod-header';
            DOC.body.appendChild(mh);
            stubRect(mh, { top: 0, bottom: 74, left: 0, right: 1440, width: 1440, height: 74 });
            refit(win);
            await sleep(20);
            ok(p.el.style.top === '82px',
                'D5.' + c.ctx + ' dock usa il bordo inferiore MAGGIORE (mod-header 74+8)',
                'top=' + p.el.style.top);
            p.destroy();
        }
        clearChrome(win);

        /* ---- 2) wrapper laterale (fogli / video): wrapper sotto toolbar ---- */
        for (const c of [
            { ctx: 'fogli', cls: 'fg-top', wrap: 'fg-fpwrap' },
            { ctx: 'video', cls: 'toolbar', wrap: 'vv-fpwrap' }
        ]) {
            clearChrome(win);
            const host = DOC.createElement('div');
            host.className = 'mod-host';
            const tb = DOC.createElement('div');
            tb.className = c.cls;
            const wrap = DOC.createElement('div');
            wrap.className = c.wrap;
            host.appendChild(tb);
            host.appendChild(wrap);
            DOC.body.appendChild(host);
            stubRect(host, { top: 100, bottom: 950, left: 0, right: 1440, width: 1440, height: 850 });
            stubRect(tb, { top: 100, bottom: 146, left: 0, right: 1440, width: 1440, height: 46 });
            const p = FP.create({ contesto: c.ctx, onInsert: () => { } });
            wrap.appendChild(p.el);
            stubRect(p.el, { left: 1090, right: 1426, width: 336, top: 154, bottom: 700, height: 546 });
            refit(win);
            await sleep(30);
            ok(wrap.style.top === '54px',
                'D6.' + c.ctx + ' wrapper staccato sotto .fg-top/.toolbar (146-100+8=54px)',
                'wrap.top=' + wrap.style.top);
            ok(wrap.style.zIndex === '5', 'D7.' + c.ctx + ' wrapper z-index=5', 'z=' + wrap.style.zIndex);
            ok(p.el.style.position === 'relative',
                'D8.' + c.ctx + ' root nel flusso del wrapper (position:relative)',
                'pos=' + p.el.style.position);
            ok(!p.el.style.top && !p.el.style.right,
                'D9.' + c.ctx + ' root senza coordinate fisse residue');
            p.destroy();
        }
        clearChrome(win);

        /* ---- 3) Appunti e Schemi: ZERO stili inline di posizionamento ---- */
        const tb = DOC.createElement('div');
        tb.className = 'doc-bar';
        DOC.body.appendChild(tb);
        stubRect(tb, { top: 4, bottom: 60, left: 0, right: 1440, width: 1440, height: 56 });
        for (const ctx of ['appunti', 'schemi']) {
            const p = FP.create({ contesto: ctx, onInsert: () => { } });
            DOC.body.appendChild(p.el);
            refit(win);
            await sleep(30);
            ok(!p.el.style.position && !p.el.style.top && !p.el.style.zIndex && !p.el.style.right,
                'D10.' + ctx + ' NESSUN stile inline di posizionamento (delegato altro)',
                JSON.stringify({ pos: p.el.style.position, top: p.el.style.top, z: p.el.style.zIndex }));
            p.destroy();
        }

        /* ---- 4) toolbar assente/hidden: nessun crash, nessun top casuale ---- */
        clearChrome(win);
        const pNo = FP.create({ contesto: 'documenti', onInsert: () => { } });
        DOC.body.appendChild(pNo.el);
        refit(win);
        await sleep(30);
        ok(!pNo.el.style.top, 'D11 toolbar assente -> nessun top forzato', 'top=' + pNo.el.style.top);
        pNo.destroy();

        /* ---- 5) R24 R1.1: Appunti dock sotto .fn-pill-left (DOM reale) ---- */
        clearChrome(win);
        const styPill = DOC.createElement('style');
        styPill.textContent = '.fn-pill{z-index:12}';
        DOC.head.appendChild(styPill);
        const pillL = DOC.createElement('div');
        pillL.className = 'fn-pill fn-pill-left';
        DOC.body.appendChild(pillL);
        stubRect(pillL, { top: 56, bottom: 104, left: 12, right: 340, width: 328, height: 48 });
        const pAp = FP.create({ contesto: 'appunti', onInsert: () => { } });
        DOC.body.appendChild(pAp.el);
        stubRect(pAp.el, { left: 12, right: 352, width: 340, top: 112, bottom: 652, height: 540 });
        refit(win);
        await sleep(30);
        ok(pAp.el.style.position === 'fixed', 'D13 appunti position:fixed inline (R24 R1.1)');
        ok(pAp.el.style.top === '112px',
            'D13 appunti dock sotto .fn-pill-left (bottom 104 + 8px, nessun top hardcoded)',
            'top=' + pAp.el.style.top);
        ok(pAp.el.style.left === '12px',
            'D14 appunti left allineato alla toolbar (12px)', 'left=' + pAp.el.style.left);
        ok(pAp.el.style.zIndex === '11',
            'D15 appunti z-index INLINE=11 < z toolbar calcolato (12)', 'z=' + pAp.el.style.zIndex);
        /* R24 R1.1 (zoom bar): la COLONNA comandi = max(bottom pill, bottom
           zoom) letto dal DOM: .fn-zoom (bottom 142, valori V0 reale) vince
           su .fn-pill-left (104) -> top = 142+8 = 150px, NESSUNA costante;
           left resta quello della colonna ancorata. */
        const zoomEl = DOC.createElement('div');
        zoomEl.className = 'fn-zoom';
        DOC.body.appendChild(zoomEl);
        stubRect(zoomEl, { top: 106, bottom: 142, left: 12, right: 340, width: 328, height: 36 });
        refit(win);
        await sleep(30);
        ok(pAp.el.style.top === '150px',
            'D16 appunti colonna=max(pill,zoom): zoom bottom 142 + 8px = 150 (nessuna costante)',
            'top=' + pAp.el.style.top);
        ok(pAp.el.style.left === '12px',
            'D17 appunti left dalla colonna ancorata (12px)', 'left=' + pAp.el.style.left);
        ok(pAp.el.style.zIndex === '11',
            'D18 appunti z invariato sotto toolbar dopo .fn-zoom (11)', 'z=' + pAp.el.style.zIndex);
        zoomEl.parentNode.removeChild(zoomEl);
        pAp.destroy();
        if (styPill.parentNode) styPill.parentNode.removeChild(styPill);
        clearChrome(win);

        ok(env.errs.length === 0, 'D12 zero eccezioni jsdom', env.errs.slice(0, 2).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO f22_fonti_dock: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
