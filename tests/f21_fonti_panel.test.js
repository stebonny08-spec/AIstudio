'use strict';
/* tests/f21_fonti_panel.test.js - R21: T1 del componente UNICO FontiPanel.
   Adattatori (md+math, {"html"} sanitizzato, libri, immagini), layout
   compatto (ricerca collassabile, chip, resize persistito, insert
   contestuale, nessun header fisso). Esecuzione: node tests/f21_fonti_panel.test.js */
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

const MD = '# Titolo\n\nParagrafo con **grasso** e formula $x^2$.\n\n' +
    '$$\\xrightarrow{\\nu} \\text{ok}$$\n\n' +
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n' +
    '- elenco\n- due\n\n```js\nconst x = 1;\n```';
const HTML_DOC = JSON.stringify({
    html: '<h2>Heading due</h2><p>Testo <b>grassetto</b></p>' +
        '<script>alert(1)</script><div onclick="x()">handler</div>' +
        '<img src="https://evil.example/x.png"><img src="data:image/png;base64,AAAA">' +
        '<table><tr><td>cella</td></tr></table>'
});
const BOOK_MD = '# Capitolo 1 - Energia\n\nTesto del capitolo con $E=mc^2$.\n\n## Sezione 1.1\n\nAltro.';

function makeEnv() {
    const vc = new VirtualConsole();
    const errs = [];
    vc.on('jsdomError', e => errs.push(String(e && e.message || e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true,
        runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window;
    const items = [
        { id: 'n1', kind: 'note', title: 'Nota Q', content: JSON.stringify({ objects: [{ t: 'text', text: 'testo nota' }] }), materia: '', tags: '', description: '', thumbnail: '', folder_id: '' },
        { id: 'd1', kind: 'documento', title: 'Doc Html', content: HTML_DOC, materia: '', tags: '', description: '', thumbnail: '', folder_id: '' },
        { id: 'r1', kind: 'riassunto', title: 'Riassunto Alfa', content: JSON.stringify({ riassunto: 'Contenuto alfa.' }), materia: 'STORIA', tags: '', description: '', thumbnail: '', folder_id: '' }
    ];
    const mats = [
        { path: 'C:/preselected_books/il-libro.md', name: 'il-libro.md' },
        { path: 'C:/file_AIstudio/materiale.pdf', name: 'materiale.pdf' },
        { path: 'C:/file_AIstudio/figura.png', name: 'figura.png' }
    ];
    win.StudyStore = {
        listItems: async () => items.map(i => Object.assign({}, i)),
        getItem: async id => { const i = items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        listMaterials: async () => mats.map(m => Object.assign({}, m)),
        saveItem: async p => p
    };
    win.pywebview = {
        api: {
            read_material_text: async p => {
                if (/il-libro\.md$/i.test(p)) return { success: true, kind: 'md', name: 'il-libro.md', text: BOOK_MD };
                if (/\.png$/i.test(p)) return { success: false, error: 'binario' };
                return { success: true, kind: 'pdf', name: 'materiale.pdf', text: 'Testo semplice del materiale.' };
            }
        }
    };
    win.eval(SRC);
    return { win, errs };
}

(async () => {
    try {
        /* ============ T1: md + matematica (1.1) ============ */
        let env = makeEnv();
        let A = env.win.FontiPanel.adapters;
        // con katex STUBBATO (simula il vendored)
        env.win.katex = { renderToString: s => '<span class="katex-ok">' + String(s).replace(/[\\<>$]/g, '') + '</span>' };
        let h = A.renderMarkdown21(MD);
        ok(/<h1[^>]*>Titolo<\/h1>/.test(h), 'T1.1 md titolo h1', h.slice(0, 80));
        ok(/<strong>grasso<\/strong>/.test(h), 'T1.2 md grassetto');
        ok(/<table/.test(h) && /<td>1<\/td>/.test(h), 'T1.3 md tabella renderizzata');
        ok(/<ul>/.test(h) && /<li>elenco<\/li>/.test(h), 'T1.4 md lista');
        ok(/<pre[^>]*>/.test(h) && /const x = 1/.test(h), 'T1.5 md blocco codice');
        ok((h.match(/katex-ok/g) || []).length >= 2, 'T1.6 matematica display+inline con katex', h.slice(0, 200));
        ok(h.indexOf('$$') < 0 && h.indexOf('\\text') < 0 && h.indexOf('\\xrightarrow') < 0,
            'T1.7 nessun $$ / \\text / \\xrightarrow grezzo (con katex)');
        // SENZA katex -> fallback badge
        delete env.win.katex;
        h = A.renderMarkdown21(MD);
        ok(/formula non renderizzabile/.test(h), 'T1.8 fallback badge senza katex');
        ok(h.indexOf('$$') < 0 && h.indexOf('\\text') < 0,
            'T1.9 fallback: nessun $$ o \\text nel flusso', h.slice(0, 160));
        ok(/class="fp21-mathfb"/.test(h) && /<code>/.test(h), 'T1.10 fallback monospace');
        ok(A.renderMarkdown21('inline $a+b$ fine').indexOf('fp21-mathfb') >= 0 ||
           A.renderMarkdown21('inline $a+b$ fine').indexOf('katex-ok') >= 0, 'T1.11 inline $..$ processato');

        /* ============ T2: {"html"} sanitizzato (1.2) ============ */
        const hd = A.renderHtmlDoc21(HTML_DOC);
        ok(!!hd, 'T2.1 {"html"} riconosciuto');
        if (hd) {
            ok(/<p>Testo <b>grassetto<\/b><\/p>/.test(hd.html), 'T2.2 contenuto reale renderizzato', hd.html.slice(0, 120));
            ok(/<h2>Heading due<\/h2>/.test(hd.html) && hd.title === 'Heading due', 'T2.3 titolo dal primo heading');
            ok(hd.html.indexOf('<script') < 0 && hd.html.indexOf('alert(1)') < 0, 'T2.4 script rimossi');
            ok(hd.html.indexOf('onclick') < 0 && hd.html.indexOf('handler') >= 0, 'T2.5 handler rimossi, testo tenuto');
            ok(hd.html.indexOf('evil.example') < 0 && hd.html.indexOf('data:image/png') >= 0,
                'T2.6 img http rimosse, data: tenute');
            ok(/<td>cella<\/td>/.test(hd.html), 'T2.7 tabella conservata');
            ok(hd.html.indexOf('{"html') < 0, 'T2.8 nessuna stringa {"html nel risultato');
        }
        ok(A.renderHtmlDoc21('testo semplice non json') === null, 'T2.9 non-html -> null (fallback)');

        /* ============ T3: fetch + libri presenti (1.3) ============ */
        const srcs = await A.fetchSources21();
        ok(srcs.length === 6, 'T3.1 fetch: 3 study + 3 mat', 'n=' + srcs.length);
        ok(srcs.some(s => s.kind === 'mat' && A.matKindLabel(s.path) === 'Libro'),
            'T3.2 il LIBRO compare nel fetch');
        ok(srcs.filter(s => s.kind !== 'mat').length === 3, 'T3.3 study items presenti');

        /* ============ T4: preview per adattatore ============ */
        const pBook = await A.previewFonte21(srcs.filter(s => /il-libro/.test(s.path))[0]);
        ok(/<h1[^>]*>Capitolo 1 - Energia<\/h1>/.test(pBook.html), 'T4.1 libro md: heading capitolo renderizzato',
            pBook.html.slice(0, 100));
        ok(pBook.badge === 'Libro', 'T4.2 badge Libro', pBook.badge);
        ok(pBook.html.indexOf('$$') < 0 && pBook.html.indexOf('\\text') < 0, 'T4.3 libro senza md/math grezzi');
        const pDoc = await A.previewFonte21(srcs.filter(s => s.id === 'd1')[0]);
        ok(/<h2>Heading due<\/h2>/.test(pDoc.html) && pDoc.html.indexOf('<script') < 0,
            'T4.4 preview {"html"} via provider', pDoc.html.slice(0, 80));
        const pNote = await A.previewFonte21(srcs.filter(s => s.id === 'n1')[0]);
        ok(/testo nota/.test(pNote.html), 'T4.5 preview nota (testo reale)');
        const pImg = await A.previewFonte21(srcs.filter(s => /figura\.png/.test(s.path))[0]);
        ok(/<img[^>]+figura\.png/.test(pImg.html) || /fp21-thumb/.test(pImg.html), 'T4.6 preview immagine thumbnail+nome',
            pImg.html.slice(0, 100));

        /* ============ T5: ricerca collassabile (2.2) ============ */
        env = makeEnv();
        const FP = env.win.FontiPanel;
        let inserted = null;
        const p1 = FP.create({ contesto: 'appunti', onInsert: (s, i) => { inserted = { s: s, i: i }; } });
        env.win.document.body.appendChild(p1.el);
        await sleep(60);
        const search = p1.el.querySelector('.fp21-search');
        const lens = p1.el.querySelector('.fp21-lens');
        ok(!!search && search.style.display === 'none', 'T5.1 ricerca COLLAPSATA di default', search && search.style.display);
        lens.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        ok(search.style.display !== 'none', 'T5.2 lente mostra la ricerca');
        ok(env.win.localStorage.getItem('fp21_search_appunti') === '1', 'T5.3 stato ricerca persistito');
        const p2 = FP.create({ contesto: 'appunti', onInsert: () => { } });
        await sleep(60);
        ok(p2.el.querySelector('.fp21-search').style.display !== 'none',
            'T5.4 persistenza su nuova istanza (aperta)');
        p2.destroy();

        /* ============ T6: resize persistito (2.4) ============ */
        const rzR = p1.el.querySelector('.fp21-rz-r');
        const md = new env.win.MouseEvent('mousedown', { bubbles: true, clientX: 340, clientY: 100 });
        rzR.dispatchEvent(md);
        env.win.document.dispatchEvent(new env.win.MouseEvent('mousemove', { bubbles: true, clientX: 340 + 300, clientY: 100 }));
        env.win.document.dispatchEvent(new env.win.MouseEvent('mouseup', { bubbles: true, clientX: 640, clientY: 100 }));
        const wStyle = parseInt(p1.el.style.width, 10);
        ok(wStyle >= 240 && wStyle <= Math.floor(env.win.innerWidth * 0.6),
            'T6.1 resize larghezza nei limiti 240..60%vw', 'w=' + wStyle);
        ok(env.win.localStorage.getItem('fp21_w_appunti') === String(wStyle), 'T6.2 larghezza persistita');
        rzR.dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true }));
        ok(env.win.localStorage.getItem('fp21_w_appunti') == null, 'T6.3 doppio click = reset persistito');

        /* ============ T7: chip filtro (2.3) ============ */
        const chipLbl = Array.from(p1.el.querySelectorAll('.fp21-chip')).map(c => c.textContent);
        ok(chipLbl.join(',') === 'Tutti,Appunti,Documenti,Presentazioni,Fogli,Video,Chat,Materiali,Libri',
            'T7.1 9 chip (R28: categorie complete)', chipLbl.join(','));
        const chipLibri = p1.el.querySelector('[data-f="libri"]');
        chipLibri.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        ok(env.win.localStorage.getItem('fp21_filter') === 'libri', 'T7.2 chip persistito');
        ok(chipLibri.classList.contains('active'), 'T7.3 chip attivo evidenziato');
        const nLibri = p1.el.querySelectorAll('.fp21-item').length;
        ok(nLibri === 1, 'T7.4 filtro Libri -> solo il libro', 'n=' + nLibri);

        /* ============ T8: insert contestuale (2.5) ============ */
        const insertBtn = p1.el.querySelector('.fp21-insert');
        ok(insertBtn.disabled === true, 'T8.1 insert disabilitato senza selezione');
        ok(insertBtn.textContent === 'Inserisci nella nota', 'T8.2 label per contesto appunti', insertBtn.textContent);
        p1.el.querySelector('.fp21-item').dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        await sleep(80);
        ok(insertBtn.disabled === false, 'T8.3 insert abilitato dopo selezione');
        insertBtn.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
        ok(!!inserted && !!inserted.s && inserted.i.contesto === 'appunti' && !!inserted.i.titolo,
            'T8.4 onInsert chiamato con fonte+info', JSON.stringify(inserted && inserted.i));

        /* ============ T9: nessun header fisso (2.1) ============ */
        ok(!p1.el.querySelector('.fp21-header'), 'T9.1 nessun riquadro intestazione fisso');
        const pt = p1.el.querySelector('.fp21-ptitle');
        ok(!!pt && !!pt.closest('.fp21-preview'), 'T9.2 titolo dentro il preview (riga compatta)');
        ok(p1.el.querySelector('.fp21-list') && p1.el.querySelector('.fp21-preview'),
            'T9.3 lista + preview struttura');
        ok(env.errs.length === 0, 'T9.4 zero eccezioni jsdom', env.errs.slice(0, 2).join(' | '));
        p1.destroy();

    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO f21_fonti_panel: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
