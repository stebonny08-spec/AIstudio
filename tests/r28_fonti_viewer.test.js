'use strict';
/* tests/r28_fonti_viewer.test.js - R28 FE-FONTI: TUTTI i tipi di fonte
   visualizzabili nella parte Fonti "come se fosse aperto ma solo li
   dentro" (tranne le flashcard):
   1. fetchSources21: include note/documenti/presentazioni/fogli/video/
      schemi/riassunti + CHAT + materiali/libri; ESCLUDE i mazzi (flashcard);
   2. preview per tipo: presentazione (slide), foglio (tabella), video
      (clip+player), chat (bolle), schema (SVG), materiale (viewer reale
      backend read_material_preview: pdf->iframe, docx->blocchi, ...);
   3. oggetti file dentro le note -> collegamento cliccabile (.fp21-filerow);
   4. chip categoria (9) + nessuna eccezione.
   Esecuzione: node tests/r28_fonti_viewer.test.js */
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

const ITEMS = [
    { id: 'kNote', kind: 'note', title: 'Nota R28', content: JSON.stringify({ objects: [{ t: 'text', text: 'Testo nota R28' }] }), materia: '' },
    { id: 'kDoc', kind: 'documento', title: 'Documento R28', content: JSON.stringify({ html: '<h1>Doc h1</h1><p>Paragrafo doc</p>' }), materia: '' },
    { id: 'kPpt', kind: 'presentazione', title: 'Presentazione R28', materia: '', content: JSON.stringify({ slides: [{ elements: [{ type: 'text', text: 'Titolo Slide', fontSize: 42 }, { type: 'text', text: 'Bullet 1', fontSize: 24 }] }] }) },
    { id: 'kFog', kind: 'foglio', title: 'Foglio R28', materia: '', content: JSON.stringify({ rows: 10, cols: 5, current: 0, sheets: [{ name: 'Foglio1', cells: { A1: { v: 'Intestazione' }, B2: { v: '42' } } }] }) },
    { id: 'kVid', kind: 'video', title: 'Video R28', materia: '', content: JSON.stringify({ clips: [{ type: 'text', start: 0, dur: 4, text: 'Titolo video' }, { type: 'image', start: 4, dur: 4, src: 'C:\\img\\a.png' }] }) },
    { id: 'kSch', kind: 'schema', title: 'Schema R28', materia: '', content: JSON.stringify({ nodes: [{ id: 'n1', x: 0, y: 0, w: 120, h: 54, text: 'Nodo A' }, { id: 'n2', x: 200, y: 100, w: 120, h: 54, text: 'Nodo B' }], edges: [{ from: 'n1', to: 'n2' }] }) },
    { id: 'kRia', kind: 'riassunto', title: 'Riassunto R28', content: 'Riassunto in testo puro', materia: '' },
    { id: 'kMazzo', kind: 'mazzo', title: 'Mazzo FLASHCARD (escluso)', content: '[]', materia: '' },
    // nota con oggetto FILE interno -> collegamento
    { id: 'kFile', kind: 'note', title: 'Nota con file', materia: '', content: JSON.stringify({ objects: [{ t: 'file', name: 'slide.pptx', path: 'C:\\app\\slide.pptx' }] }) }
];

const MESSAGES = [
    { id: 1, role: 'user', content: 'Domanda dell utente' },
    { id: 2, role: 'assistant', content: '**Risposta** della chat' }
];

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
        listItems: async () => ITEMS.map(i => Object.assign({}, i)),
        listMaterials: async () => [{ path: 'C:\\lib\\libro.pdf', name: 'libro.pdf' }],
        listConversations: async () => [{ id: 7, title: 'Chat di prova', materia: 'Storia', preview: 'ultimo msg', n_messages: 2 }],
        assetUrl: p => 'file:///' + String(p).replace(/\\/g, '/')
    };
    let previewCall = 0;
    win.pywebview = {
        api: {
            get_messages: async () => MESSAGES.map(m => Object.assign({}, m)),
            read_material_preview: async (p) => {
                previewCall++;
                if (/\.pdf$/i.test(p)) {
                    return { success: true, path: p, name: 'libro.pdf', suffix: 'pdf', viewer: 'pdf', text: 'TESTO PDF RISERVA' };
                }
                if (/\.docx$/i.test(p)) {
                    return {
                        success: true, path: p, name: 'doc.docx', suffix: 'docx', viewer: 'doc',
                        blocks: [{ k: 'h', l: 1, t: 'Titolo Word' }, { k: 'p', l: 0, t: 'Paragrafo Word' }]
                    };
                }
                return { success: false, error: 'formato non previsto nel test' };
            },
            study_open_file: async () => ({ success: true })
        }
    };
    win.eval(SRC);
    return { win, errs, get previewCall() { return previewCall; } };
}

function srcFor(kind, id) {
    const it = ITEMS.filter(x => x.id === id)[0];
    return { key: 'it:' + id, kind: kind, id: id, title: it.title, materia: '', path: '', content: it.content, raw: it };
}

(async () => {
    try {
        const env = makeEnv();
        const A = env.win.FontiPanel.adapters;

        /* ============ 1. fetch: tutti i tipi, MAI le flashcard ============ */
        const srcs = await A.fetchSources21();
        const kinds = {};
        srcs.forEach(s => { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });
        ['note', 'documento', 'presentazione', 'foglio', 'video', 'schema', 'riassunto', 'conv', 'mat']
            .forEach(k => ok(kinds[k] >= 1, '1.' + k + ' presente nelle fonti', 'kinds=' + JSON.stringify(kinds)));
        ok(!kinds.mazzo, '1. flashcard (mazzo) ESCLUSE dalle fonti', JSON.stringify(kinds));
        const conv = srcs.filter(s => s.kind === 'conv')[0];
        ok(conv && conv.title === 'Chat di prova', '1.chat titolo dal backend', conv && conv.title);

        /* ============ 2. preview per tipo ================================ */
        let pv = await A.previewFonte21(srcFor('presentazione', 'kPpt'));
        ok(/Diapositiva 1\/1/.test(pv.html), '2.presentazione: card diapositiva', pv.html.slice(0, 120));
        ok(pv.html.indexOf('Titolo Slide') >= 0 && pv.html.indexOf('Bullet 1') >= 0,
            '2.presentazione: titolo + bullet renderizzati');
        ok(pv.badge === 'Presentazione', '2.presentazione badge', pv.badge);

        pv = await A.previewFonte21(srcFor('foglio', 'kFog'));
        ok(/<table class="fp21-grid"/.test(pv.html), '2.foglio: tabella reale');
        ok(pv.html.indexOf('Intestazione') >= 0 && pv.html.indexOf('42') >= 0,
            '2.foglio: celle renderizzate');
        ok(/<th>A<\/th>/.test(pv.html), '2.foglio: intestazioni colonna A');

        pv = await A.previewFonte21(srcFor('video', 'kVid'));
        ok(/fp21-clip/.test(pv.html), '2.video: righe clip');
        ok(pv.html.indexOf('Titolo video') >= 0, '2.video: testo clip');
        ok(/Immagine/.test(pv.html) && /file:\/\/\//.test(pv.html),
            '2.video: thumb immagine con URL file locale');

        pv = await A.previewFonte21({ key: 'conv:7', kind: 'conv', id: 7, title: 'Chat di prova', materia: 'Storia', path: '', content: '', raw: { id: 7, materia: 'Storia' } });
        ok(/fp21-bub me/.test(pv.html) && pv.html.indexOf('Domanda dell utente') >= 0,
            '2.chat: bolla utente');
        ok(/fp21-bub ai/.test(pv.html) && pv.html.indexOf('Risposta') >= 0,
            '2.chat: bolla assistente');
        ok(pv.badge === 'Chat', '2.chat badge', pv.badge);

        pv = await A.previewFonte21(srcFor('schema', 'kSch'));
        ok(/<svg/.test(pv.html) && /<rect/.test(pv.html), '2.schema: mappa SVG con nodi');
        ok(pv.html.indexOf('Nodo A') >= 0 && pv.html.indexOf('Nodo B') >= 0, '2.schema: etichette nodi');
        ok(/<line /.test(pv.html), '2.schema: archi come linee');

        pv = await A.previewFonte21(srcFor('documento', 'kDoc'));
        ok(pv.html.indexOf('Doc h1') >= 0 && pv.html.indexOf('Paragrafo doc') >= 0,
            '2.documento: {"html"} renderizzato');

        pv = await A.previewFonte21(srcFor('note', 'kNote'));
        ok(pv.html.indexOf('Testo nota R28') >= 0, '2.nota: testo renderizzato');

        pv = await A.previewFonte21(srcFor('riassunto', 'kRia'));
        ok(pv.html.indexOf('Riassunto in testo puro') >= 0, '2.riassunto: testo renderizzato');

        /* ---- materiale con viewer REALE dal backend ---- */
        const matPdf = { key: 'mat:C:\\lib\\libro.pdf', kind: 'mat', id: 'C:\\lib\\libro.pdf', title: 'libro', materia: '', path: 'C:\\lib\\libro.pdf', content: null, raw: null };
        pv = await A.previewFonte21(matPdf);
        ok(/<iframe class="fp21-doc"/.test(pv.html), '2.pdf: iframe (viewer nativo dentro la preview)');
        ok(/TESTO PDF RISERVA/.test(pv.html), '2.pdf: testo di riserva nei dettagli');
        ok(/fp21-filerow/.test(pv.html), '2.pdf: collegamento "apri file"');

        const matDoc = { key: 'mat:C:\\app\\doc.docx', kind: 'mat', id: 'C:\\app\\doc.docx', title: 'doc', materia: '', path: 'C:\\app\\doc.docx', content: null, raw: null };
        pv = await A.previewFonte21(matDoc);
        ok(pv.html.indexOf('Titolo Word') >= 0 && pv.html.indexOf('Paragrafo Word') >= 0,
            '2.docx: documento impaginato (titolo+paragrafo)');

        /* ---- oggetto FILE dentro la nota -> collegamento ---- */
        pv = await A.previewFonte21(srcFor('note', 'kFile'));
        ok(/fp21-filerow/.test(pv.html) && pv.html.indexOf('slide.pptx') >= 0,
            '3.nota con file: collegamento cliccabile renderizzato', pv.html.slice(0, 200));

        /* ============ 4. pannello montato: chip 9 + lista ================ */
        const panel = env.win.FontiPanel.create({
            contesto: 'appunti',
            onInsert: function () { }
        });
        await sleep(120);
        const chips = Array.from(panel.el.querySelectorAll('.fp21-chip'))
            .map(c => c.textContent.trim());
        ok(chips.join(',') === 'Tutti,Appunti,Documenti,Presentazioni,Fogli,Video,Chat,Materiali,Libri',
            '4.chip 9 categorie (R28)', chips.join(','));
        const rowTitles = Array.from(panel.el.querySelectorAll('.fp21-item'))
            .map(b => b.textContent);
        ok(rowTitles.some(t => /Chat di prova/.test(t)), '4.lista contiene la CHAT', JSON.stringify(rowTitles));
        ok(rowTitles.some(t => /Presentazione R28/.test(t)), '4.lista contiene la presentazione');
        ok(rowTitles.some(t => /Foglio R28/.test(t)), '4.lista contiene il foglio');
        ok(rowTitles.some(t => /Video R28/.test(t)), '4.lista contiene il video');
        ok(!rowTitles.some(t => /FLASHCARD/.test(t)), '4.lista SENZA mazzo flashcard', JSON.stringify(rowTitles));
        panel.destroy();

        ok(env.errs.length === 0, '4.zero eccezioni jsdom', env.errs.join(' | '));
    } catch (e) {
        fail++;
        console.log('  FAIL  eccezione run - ' + (e && e.stack ? e.stack.split('\n')[0] : e));
    }
    console.log('='.repeat(50));
    console.log('RISULTATO r28_fonti_viewer: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
