'use strict';
/* tests/f22_fonti_resize.test.js - R22 FE-FONTI B1.3: resize libero
   confermato (rz-r, rz-b, rz-c), doppio click sul PANNELLO agganciato a
   reset(), persistenza per modulo (fp21_w_/fp21_h_<contesto>).
   Esecuzione: node tests/f22_fonti_resize.test.js */
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

function drag(win, handle, dx, dy, x0, y0) {
    x0 = x0 || 340; y0 = y0 || 100;
    handle.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: y0 }));
    win.document.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }));
    win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }));
}

(async () => {
    try {
        const env = makeEnv();
        const win = env.win;
        const FP = win.FontiPanel;
        const maxW = Math.floor(win.innerWidth * 0.6);
        const maxH = Math.floor(win.innerHeight * 0.6);

        const p = FP.create({ contesto: 'video', onInsert: () => { } });
        win.document.body.appendChild(p.el);
        await sleep(60);

        ok(!!p.el.querySelector('.fp21-rz-r') && !!p.el.querySelector('.fp21-rz-b') &&
            !!p.el.querySelector('.fp21-rz-c'), 'R1 handle rz-r/rz-b/rz-c presenti');

        /* ---- resize LARGHEZZA (rz-r) + persistenza ---- */
        drag(win, p.el.querySelector('.fp21-rz-r'), 300, 0);
        const w1 = parseInt(p.el.style.width, 10);
        ok(w1 >= 240 && w1 <= maxW, 'R2 resize larghezza nei limiti 240..60vw', 'w=' + w1);
        ok(win.localStorage.getItem('fp21_w_video') === String(w1),
            'R3 fp21_w_video persistito', String(win.localStorage.getItem('fp21_w_video')));

        /* ---- resize ALTEZZA (rz-b) + persistenza ---- */
        drag(win, p.el.querySelector('.fp21-rz-b'), 0, 200);
        const h1 = parseInt(p.el.style.height, 10);
        ok(h1 >= 160 && h1 <= maxH, 'R4 resize altezza nei limiti 160..60vh', 'h=' + h1);
        ok(win.localStorage.getItem('fp21_h_video') === String(h1),
            'R5 fp21_h_video persistito', String(win.localStorage.getItem('fp21_h_video')));

        /* ---- resize DIAGONEALE (rz-c) cambia entrambe ---- */
        drag(win, p.el.querySelector('.fp21-rz-c'), -80, -60, 700, 700);
        const w2 = parseInt(p.el.style.width, 10), h2 = parseInt(p.el.style.height, 10);
        ok(w2 !== w1 && h2 !== h1, 'R6 rz-c modifica width e height', 'w=' + w2 + ' h=' + h2);
        ok(win.localStorage.getItem('fp21_w_video') === String(w2) &&
            win.localStorage.getItem('fp21_h_video') === String(h2),
            'R7 persistenza dopo rz-c');

        /* ---- doppio click su UN BOTTONE: NON resetta (guardia) ---- */
        const chev = p.el.querySelector('.fp21-chev');
        chev.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
        ok(win.localStorage.getItem('fp21_w_video') != null,
            'R8 doppio click su .fp21-chev NON azzera (controlli interattivi esclusi)');

        /* ---- doppio click sul PANNELLO: reset() agganciato ---- */
        p.el.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
        ok(win.localStorage.getItem('fp21_w_video') == null &&
            win.localStorage.getItem('fp21_h_video') == null,
            'R9 doppio click sul pannello = reset persistito (fp21_w_/fp21_h_ rimossi)',
            'w=' + win.localStorage.getItem('fp21_w_video'));
        const wDefault = parseInt(p.el.style.width, 10);
        ok(wDefault >= 240 && wDefault <= maxW, 'R10 dopo reset size tornata al default valido',
            'w=' + wDefault);

        /* ---- doppio click su .fp21-list (div non interattivo) = reset ---- */
        drag(win, p.el.querySelector('.fp21-rz-r'), 150, 0);
        ok(win.localStorage.getItem('fp21_w_video') != null, 'R11 rieseguito resize per il test lista');
        p.el.querySelector('.fp21-list').dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
        ok(win.localStorage.getItem('fp21_w_video') == null,
            'R12 doppio click sulla lista = reset');

        /* ---- persistenza PER MODULO: altro contesto intonso ---- */
        const p2 = FP.create({ contesto: 'fogli', onInsert: () => { } });
        win.document.body.appendChild(p2.el);
        await sleep(60);
        drag(win, p2.el.querySelector('.fp21-rz-r'), 120, 0);
        ok(win.localStorage.getItem('fp21_w_fogli') != null &&
            win.localStorage.getItem('fp21_w_video') == null,
            'R13 dimensioni separate per modulo (fp21_w_fogli vs fp21_w_video)');
        p2.destroy();
        p.destroy();

        ok(env.errs.length === 0, 'R14 zero eccezioni jsdom', env.errs.slice(0, 2).join(' | '));

        /* ---- R24 R1.3: altezza AUTO-contenuto (lista vuota e popolata) ----
           Con layout misurato (stub altezza contenuto = 300px) il pannello
           resta height:'' (nessun default hardcoded): l'altezza la define il
           contenuto (lista + preview + bottone) con clamp max-height. Il
           fallback px vale SOLO senza layout (jsdom/nascosto, v. fitHeight). */
        const stubH = (el, h) => {
            el.getBoundingClientRect = () => ({
                top: 0, left: 0, right: 340, bottom: h, width: 340, height: h, x: 0, y: 0
            });
        };
        for (const mode of ['vuota', 'popolata']) {
            const envX = makeEnv();
            const winX = envX.win;
            if (mode === 'popolata') {
                winX.StudyStore.listItems = async () => [{
                    id: 'n1', kind: 'note', title: 'Nota', content: '{"text":"ciao"}',
                    materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
                }];
            }
            const pX = winX.FontiPanel.create({ contesto: 'video', onInsert: () => { } });
            winX.document.body.appendChild(pX.el);
            stubH(pX.el, 300);
            await sleep(80);
            if (mode === 'vuota') {
                ok(!!pX.el.querySelector('.fp21-hint') && !pX.el.querySelector('.fp21-item'),
                    'R15 lista VUOTA renderizzata (hint, nessun item)');
            } else {
                ok(!!pX.el.querySelector('.fp21-item'),
                    'R16 lista POPOLATA renderizzata (item presente)');
            }
            ok(pX.el.style.height === '',
                'R1' + (mode === 'vuota' ? '5b' : '6b') + ' altezza=contenuto lista ' + mode +
                ' (height auto, nessun default fisso)', 'height=' + pX.el.style.height);
            ok(pX.el.style.maxHeight !== '',
                'R1' + (mode === 'vuota' ? '5c' : '6c') + ' max-height clamp presente su lista ' + mode,
                'maxHeight=' + pX.el.style.maxHeight);
            pX.destroy();
            ok(envX.errs.length === 0,
                'R1' + (mode === 'vuota' ? '5d' : '6d') + ' zero eccezioni jsdom (lista ' + mode + ')',
                envX.errs.slice(0, 2).join(' | '));
        }
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO f22_fonti_resize: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
