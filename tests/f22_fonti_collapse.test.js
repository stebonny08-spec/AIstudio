'use strict';
/* tests/f22_fonti_collapse.test.js - R22 FE-FONTI B1.2: la riga superiore
   (ricerca + chip filtri) e' COLLASSABILE davvero via icona dedicata
   (.fp21-chev) a una sola riga di icone; stato persistito in
   localStorage 'fp21_top_<contesto>' (chiave NUOVA; fp21_search_<ctx>
   resta il toggle della lente, invariato). La misura in px dello spazio
   guadagnato dalla .fp21-list si fa in browser (qa/r22_fonti_measures.json);
   qui si verifica la struttura/lo stato.
   Esecuzione: node tests/f22_fonti_collapse.test.js */
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
    win.StudyStore = {
        listItems: async () => [{
            id: 'n1', kind: 'note', title: 'Nota C', content: JSON.stringify({
                objects: [{ t: 'text', x: 10, y: 10, w: 300, h: 40, text: 'testo', size: 14, color: '#000' }]
            }), materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        }],
        getItem: async () => null,
        listMaterials: async () => []
    };
    win.eval(SRC);
    return { win, errs };
}

(async () => {
    try {
        const env = makeEnv();
        const win = env.win;
        const FP = win.FontiPanel;

        /* ---- struttura: contenitore .fp21-top + chevron dedicato ---- */
        const p1 = FP.create({ contesto: 'documenti', onInsert: () => { } });
        win.document.body.appendChild(p1.el);
        await sleep(60);
        const top = p1.el.querySelector('.fp21-top');
        ok(!!top, 'C1 riga superiore in contenitore .fp21-top');
        const chev = p1.el.querySelector('.fp21-chev');
        const lens = p1.el.querySelector('.fp21-lens');
        const bar = p1.el.querySelector('.fp21-bar');
        const chips = p1.el.querySelector('.fp21-chips');
        const search = p1.el.querySelector('.fp21-search');
        ok(!!chev && chev.tagName === 'BUTTON', 'C2 chevron .fp21-chev dedicato');
        ok(!!top && !!bar && bar.contains(lens) && bar.contains(chev) && !bar.contains(chips),
            'C3 bar = lente + chevron dentro .fp21-top (chips fuori dalla bar)');
        ok(!!top && chips && chips.parentElement === top,
            'C3b chips in riga PROPRIA dentro .fp21-top: collassata la lista guadagna tutta la sua altezza');
        ok(!!top && top.contains(search), 'C4 ricerca dentro la riga superiore');
        ok(!!p1.el.querySelector('.fp21-list'), 'C5 lista presente');
        const styleTag = win.document.getElementById('fp21-base-style');
        ok(!!styleTag && styleTag.textContent.indexOf('.fp21-collapsed .fp21-chips') >= 0 &&
            styleTag.textContent.indexOf('.fp21-collapsed .fp21-search') >= 0,
            'C6 regole base: collassata = chips+ricerca nascosti, lista a tutta altezza');

        /* ---- default ESPANSA, poi collassa/espandi con persistenza ---- */
        ok(!p1.el.classList.contains('fp21-collapsed'), 'C7 default espansa');
        ok(win.localStorage.getItem('fp21_top_documenti') == null ||
            win.localStorage.getItem('fp21_top_documenti') === '0',
            'C7b fp21_top_documenti di default 0/assente',
            String(win.localStorage.getItem('fp21_top_documenti')));

        // apre la ricerca, poi collassa la riga
        lens.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(search.style.display !== 'none', 'C8 lente apre la ricerca (comportamento R21 invariato)');
        chev.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(p1.el.classList.contains('fp21-collapsed'), 'C9 chevron collassa la riga (.fp21-collapsed)');
        ok(win.localStorage.getItem('fp21_top_documenti') === '1',
            'C10 stato persistito fp21_top_documenti=1',
            String(win.localStorage.getItem('fp21_top_documenti')));
        ok(chev.getAttribute('aria-expanded') === 'false', 'C11 aria-expanded=false quando collassata');

        chev.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(!p1.el.classList.contains('fp21-collapsed'), 'C12 secondo click espande');
        ok(win.localStorage.getItem('fp21_top_documenti') === '0', 'C13 stato ripersistito a 0');

        /* ---- lente mentre collassata: espande + apre ricerca ---- */
        // prima chiude la ricerca (st.search=false) per testare l'apertura
        lens.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(search.style.display === 'none', 'C13b seconda lente richiude la ricerca');
        chev.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(p1.el.classList.contains('fp21-collapsed'), 'C14 ricollassata per il test lente');
        ok(win.localStorage.getItem('fp21_top_documenti') === '1', 'C14b fp21_top=1 prima della lente');
        lens.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(!p1.el.classList.contains('fp21-collapsed'),
            'C15 lente mentre collassata -> espande la riga');
        ok(search.style.display !== 'none', 'C16 e apre la ricerca');
        ok(win.localStorage.getItem('fp21_search_documenti') === '1',
            'C17 fp21_search_documenti=1 (chiave preesistente invariata)');
        // ricollassa e chiude: la prossima istanza documenti nasce collassata
        chev.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        ok(p1.el.classList.contains('fp21-collapsed') &&
            win.localStorage.getItem('fp21_top_documenti') === '1',
            'C17b ricollassata + fp21_top=1 per il test persistenza');
        p1.destroy();

        /* ---- persistenza su NUOVA istanza (chiave per modulo) ---- */
        const p2 = FP.create({ contesto: 'documenti', onInsert: () => { } });
        win.document.body.appendChild(p2.el);
        await sleep(60);
        ok(p2.el.classList.contains('fp21-collapsed'),
            'C18 nuova istanza documenti nasce collassata (persistenza fp21_top_documenti)');
        p2.destroy();
        const p3 = FP.create({ contesto: 'ripasso', onInsert: () => { } });
        win.document.body.appendChild(p3.el);
        await sleep(60);
        ok(!p3.el.classList.contains('fp21-collapsed'),
            'C19 chiave per modulo: ripasso indipendente da documenti');
        p3.destroy();

        ok(env.errs.length === 0, 'C20 zero eccezioni jsdom', env.errs.slice(0, 2).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO f22_fonti_collapse: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
