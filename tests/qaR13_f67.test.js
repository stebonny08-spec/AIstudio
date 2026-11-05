/* ============================================================
   tests/qaR13_f67.test.js — R13 F67: undo dimostrato in jsdom.

   F67a (documenti): menu contestuale "Inserisci citazione da
   materiali" -> F06 (stub pywebview DICHIARATO: read_material_text/
   ai_run_function) -> preview [Accetta]/[Scarta] -> citazione +
   badge nel DOM -> Ctrl+Z (st.undoStack) e AIService.undo()
   riportano innerHTML IDENTICO (confronto stringa).

   F67b (chatbot): "Salva come nota" -> F17 -> preview [Accetta] ->
   item kind 'note' nello store (content = doc notes reale con
   oggetto testo) + badge metadati F17 -> AIService.undo() lo
   RIMUOVE (store identico a prima: 0 note, nessun side-effect).

   AIService e' la SEZIONE REALE estratta da js/app.js; i moduli
   documenti.js/chatbot.js sono i sorgenti REALI.

   NOTA jsdom: le continuation async post-await partono con leggero
   ritardo -> tutti gli assert usano polling (until), mai sleep fisse.

   Eseguire con: node tests/qaR13_f67.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const DOC_SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'documenti.js'), 'utf8');
const CHAT_SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'chatbot.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'app.js'), 'utf8');

/* estrazione della SEZIONE REALE AIService da app.js */
const AIS_START = 'window.AIService = (function () {';
const AIS_END_MARK = 'fine AIService (H10)';
const AIS_S = APP_SRC.indexOf(AIS_START);
const AIS_M = APP_SRC.indexOf(AIS_END_MARK);
if (AIS_S < 0 || AIS_M < 0) { console.error('FAIL: marker AIService non trovato in app.js'); process.exit(1); }
const AIS_E = APP_SRC.indexOf('\n', AIS_M);   // fine della riga del commento finale
const AIS_SRC = APP_SRC.slice(AIS_S, AIS_E > AIS_S ? AIS_E : APP_SRC.length);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
    const t0 = Date.now(); ms = ms || 5000; step = step || 40;
    while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); }
    return fn() ? true : false;
}

/* testo materiale REALISTICO (stesso ruolo di un file in file_AIstudio) */
const MAT = {
    path: 'file_AIstudio/rag_stage2/fotosintesi_clorofilliana.md',
    name: 'fotosintesi_clorofilliana.md',
    text: 'La fotosintesi clorofilliana e il processo con cui le piante verdi convertono la luce solare in energia chimica. ' +
        'Avviene nei cloroplasti, organuli presenti nelle cellule vegetali. ' +
        'Nella fase luminosa si producono ATP e NADPH con liberazione di ossigeno.'
};
const MSG_AI = 'La fotosintesi avviene nei cloroplasti e produce glucosio ed ossigeno nella fase luminosa.';

function makeEnv() {
    const vc = new VirtualConsole();
    vc.forwardTo(console);
    const dom = new JSDOM(
        '<!DOCTYPE html><html><body><div id="main"></div>' +
        '<section id="chatView" class="chat-view"></section></body></html>',
        { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
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
    const calls = { f06: 0, f17: 0 };
    win.App = {
        el: el, esc: esc,
        style: css => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); return s; },
        empty: (icon, text) => { const d = el('div', 'app-empty'); d.appendChild(el('p', null, text)); return d; },
        fmtDate: s => String(s || ''),
        go: () => { },
        header: (t) => { const h = el('div', 'app-header'); h.appendChild(el('h2', null, t)); return h; },
        ICONS: { chatbot: '', notes: '' },
        registerModule: () => { },
        registerNewConversationFlow: () => { }
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.find(x => x.id === id); return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) { const i = store.items.find(x => x.id === p.id); if (i) { Object.assign(i, p); return Object.assign({}, i); } }
            const n = Object.assign({ id: 's' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async id => { store.items = store.items.filter(i => i.id !== id); return { success: true }; },
        listMaterials: async () => [Object.assign({}, MAT)],
        listConversations: async () => [],
        saveChatMeta: async () => null,
        hasBackend: async () => false
    };
    win.SubjectInput = { normalize: s => String(s || '').trim(), remember: async () => { }, create: () => el('div') };
    win.Folders = { bar: () => el('div'), grid: () => el('div'), get: () => '', moveSelect: () => el('button') };
    win.StudyAsk = (t, v) => Promise.resolve(v == null ? 'Voce' : v);
    win.prompt = () => null;
    win.confirm = () => true;

    /* stub SOLO dichiarato di window.pywebview.api (consentito in harness) */
    win.pywebview = {
        api: {
            read_material_text: async (p) => ({
                success: p === MAT.path, name: MAT.name, text: MAT.text, kind: 'md',
                size: MAT.text.length, mtime: 0
            }),
            ai_run_function: async (fid, inputsJson) => {
                let inputs = {};
                try { inputs = JSON.parse(inputsJson || '{}'); } catch (e) { inputs = {}; }
                if (fid === 'F06') {
                    calls.f06++;
                    const chunks = String(inputs.chunks || '');
                    const m = chunks.match(/[^.!?]+[.!?]*/);
                    return {
                        ok: true, badge: 'generato da AI',
                        data: {
                            answer: 'Dai passaggi forniti: la fotosintesi avviene nei cloroplasti.',
                            citations: [{
                                quote: (m ? m[0].trim() : chunks.slice(0, 60)),
                                source: String(inputs.docs || MAT.name)
                            }]
                        }
                    };
                }
                if (fid === 'F17') {
                    calls.f17++;
                    return { ok: true, badge: 'generato da AI \u00b7 cross-modulo', data: String(inputs.payload || '') };
                }
                return { ok: false, fallback: true, data: null, badge: 'AI non disponibile' };
            }
        }
    };

    win.eval(AIS_SRC);        // AIService REALE (sezione estratta da app.js)
    win.eval(DOC_SRC);        // documenti.js REALE
    win.eval(CHAT_SRC);       // chatbot.js REALE
    return { dom, win, doc, store, calls };
}

function click(win, elm) { elm.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
function setRange(win, doc, r) {
    const s = win.getSelection();
    s.removeAllRanges(); s.addRange(r);
    doc.dispatchEvent(new win.Event('selectionchange'));
    doc.dispatchEvent(new win.Event('selectionchange'));
}
function keydown(win, target, key, ctrl) {
    const ev = new win.KeyboardEvent('keydown', { key, ctrlKey: !!ctrl, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
}
function overlayBox(doc) {
    const ov = doc.querySelector('.ai-preview-ov');
    return ov ? ov.querySelector('.ai-preview') : null;
}
async function fillAsk(doc, win, q) {
    const box = overlayBox(doc);
    if (!box) return false;
    const inp = box.querySelector('input');
    if (inp && q != null) inp.value = q;
    click(win, box.querySelector('.ai-pv-accept'));
    return true;
}

async function main() {
    try {
        console.log('\n== R13 F67 — undo dimostrato (jsdom) ==');
        const env = makeEnv();
        const { win, doc, store, calls } = env;

        /* ---------- apertura documento REALE ---------- */
        const id = 'd1';
        store.items.push({
            id, kind: 'documento', title: 'Documento F67',
            content: JSON.stringify({ html: '<p>Paragrafo iniziale del documento.</p>' }),
            materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        });
        const cont = doc.getElementById('main');
        win.StudyTools.documenti.render(cont, { open: id });
        const opened = await until(() => !!doc.querySelector('.doc-paper'), 8000);
        await sleep(300);
        ok(opened, 'F67a: documento aperto (.doc-paper presente)');

        const ed = doc.querySelector('.doc-paper');
        const p = ed.querySelector('p');

        /* caret reale dentro il primo paragrafo */
        const r0 = doc.createRange();
        r0.setStart(p.firstChild, 0); r0.collapse(true);
        setRange(win, doc, r0);
        const before = ed.innerHTML;

        /* ---------- F67a-1: voce menu contestuale ---------- */
        const ctxEv = new win.MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 120, clientY: 90
        });
        ed.dispatchEvent(ctxEv);
        const menu = doc.querySelector('.doc-citemenu');
        ok(!!menu && menu.classList.contains('open'), 'F67a-1: menu contestuale aperto su .doc-paper',
            menu ? 'menu presente' : 'menu assente');
        const voice = menu ? menu.querySelector('[data-ai-f67="doc-cite"]') : null;
        ok(!!voice && /Inserisci citazione da materiali/.test(voice.textContent || ''),
            'F67a-1: voce "Inserisci citazione da materiali" presente',
            voice ? voice.textContent : 'voce assente');
        ok(ctxEv.defaultPrevented, 'F67a-1: contextmenu prevenuto (niente menu nativo)');

        /* ---------- F67a-2: click voce -> form materiale+query ---------- */
        click(win, voice);
        const formShown = await until(() => {
            const b = overlayBox(doc);
            return !!b && /Inserisci citazione da materiali/.test(b.querySelector('h3').textContent);
        });
        ok(formShown, 'F67a-2: form (materiale + query) aperto senza errori');
        const box = overlayBox(doc);
        const sel = box ? box.querySelector('select') : null;
        ok(!!sel && sel.options.length === 1 && sel.value === MAT.path,
            'F67a-2: select materiale da materials_list',
            sel ? 'n options=' + sel.options.length : 'select assente');
        await fillAsk(doc, win, 'Dove avviene la fotosintesi?');

        /* ---------- F67a-3: preview F06 [Accetta]/[Scarta] ---------- */
        const pvShown = await until(() => {
            const b = overlayBox(doc);
            return !!b && /Anteprima AI/.test(b.querySelector('h3').textContent);
        });
        ok(pvShown, 'F67a-3: preview F06 mostrata dopo runFor');
        ok(calls.f06 === 1, 'F67a-3: ai_run_function chiamata con F06', 'f06=' + calls.f06);
        const pv = overlayBox(doc);
        const bAcc = pv.querySelector('.ai-pv-accept');
        const bRej = pv.querySelector('.ai-pv-reject');
        ok(!!bAcc && /Accetta/.test(bAcc.textContent) && !!bRej && /Scarta/.test(bRej.textContent),
            'F67a-3: preview con [Accetta] e [Scarta]');
        click(win, bAcc);
        const inserted = await until(() => !!ed.querySelector('[data-ai-cite]'), 3000);

        /* ---------- F67a-4: inserimento + badge ---------- */
        ok(inserted, 'F67a-4: citazione inserita al cursore ([data-ai-cite])');
        const cite = ed.querySelector('[data-ai-cite]');
        const badge = cite ? cite.querySelector('.ai-badge') : null;
        ok(!!badge && /generato da AI/.test(badge.textContent || ''),
            'F67a-4: badge provenienza .ai-badge dentro la citazione',
            badge ? badge.textContent : 'badge assente');
        ok(ed.innerHTML !== before, 'F67a-4: innerHTML cambiato dopo Accetta');

        /* ---------- F67a-5: Ctrl+Z su st.undoStack -> IDENTICO ---------- */
        const evZ = keydown(win, ed, 'z', true);
        ok(evZ.defaultPrevented, 'F67a-5: Ctrl+Z intercettato dallo stack modulo');
        await until(() => ed.innerHTML === before, 2000);
        ok(ed.innerHTML === before, 'F67a-5: Ctrl+Z -> innerHTML IDENTICO al pre-inserimento',
            'len before=' + before.length + ' after=' + ed.innerHTML.length);

        /* ---------- F67a-6: AIService.undo() -> IDENTICO ---------- */
        click(win, voice);   // seconda passata (voce riusata, menu richiuso)
        await until(() => {
            const b = overlayBox(doc);
            return !!b && /Inserisci citazione/.test(b.querySelector('h3').textContent);
        }, 4000);
        await fillAsk(doc, win, 'Dove avviene la fotosintesi?');
        const pv2 = await until(() => {
            const b = overlayBox(doc);
            return !!b && /Anteprima AI/.test(b.querySelector('h3').textContent);
        }, 4000);
        if (pv2) click(win, overlayBox(doc).querySelector('.ai-pv-accept'));
        const inserted2 = await until(() => !!ed.querySelector('[data-ai-cite]'), 3000);
        ok(inserted2, 'F67a-6: seconda citazione inserita (per test AIService.undo)');
        const undone = win.AIService.undo();
        ok(undone === true, 'F67a-6: AIService.undo() restituisce true');
        await until(() => ed.innerHTML === before, 2000);
        ok(ed.innerHTML === before, 'F67a-6: AIService.undo() -> innerHTML IDENTICO al pre-inserimento',
            'len before=' + before.length + ' after=' + ed.innerHTML.length);

        /* ---------- F67b: salva come nota + undo ---------- */
        const cv = doc.getElementById('chatView');
        const rowU = doc.createElement('div'); rowU.className = 'msg-row user';
        const bubU = doc.createElement('div'); bubU.className = 'bubble-user';
        bubU.textContent = 'Puoi riassumere la fotosintesi?';
        rowU.appendChild(bubU); cv.appendChild(rowU);
        const rowA = doc.createElement('div'); rowA.className = 'msg-row ai';
        const bubA = doc.createElement('div'); bubA.className = 'bubble-ai';
        bubA.textContent = MSG_AI;
        rowA.appendChild(bubA); cv.appendChild(rowA);

        const btnNota = await until(() => doc.querySelector('[data-ai-f67="nota"]'), 6000)
            ? doc.querySelector('[data-ai-f67="nota"]') : null;
        ok(!!btnNota && /Salva come nota/.test(btnNota.textContent || ''),
            'F67b-1: pulsante "Salva come nota" presente nella barra chat');
        ok(!!doc.querySelector('[data-ai-f67="documento"]') &&
            !!doc.querySelector('[data-ai-f67="mazzo"]'),
            'F67b-1: pulsanti "Salva come documento" e "Salva come mazzo" presenti');

        const notesBefore = store.items.filter(i => i.kind === 'note').length;      // 0
        const docBefore = store.items.filter(i => i.kind === 'documento').length;   // solo d1
        const deckBefore = store.items.filter(i => i.kind === 'mazzo').length;      // 0
        click(win, btnNota);
        const pvF17 = await until(() => {
            const b = overlayBox(doc);
            return !!b && /Anteprima AI/.test(b.querySelector('h3').textContent);
        });
        ok(pvF17, 'F67b-2: preview F17 [Accetta]/[Scarta]');
        ok(calls.f17 === 1, 'F67b-2: ai_run_function chiamata con F17', 'f17=' + calls.f17);
        click(win, overlayBox(doc).querySelector('.ai-pv-accept'));
        const saved = await until(() =>
            store.items.filter(i => i.kind === 'note').length === notesBefore + 1, 4000);
        ok(saved, 'F67b-3: item kind "note" creato nello store',
            'note count=' + store.items.filter(i => i.kind === 'note').length);

        const note = store.items.filter(i => i.kind === 'note')[0];
        let noteDoc = null;
        try { noteDoc = JSON.parse(note.content); } catch (e) { noteDoc = null; }
        ok(!!noteDoc && noteDoc.mode === 'quaderno' &&
            noteDoc.pages && noteDoc.pages[0] && noteDoc.pages[0].objects &&
            noteDoc.pages[0].objects[0] && noteDoc.pages[0].objects[0].t === 'text' &&
            noteDoc.pages[0].objects[0].text === MSG_AI,
            'F67b-3: content = doc notes reale con oggetto testo == messaggio');

        /* badge metadati F17 (polling: le continuation jsdom sono lente) */
        const badgeShown = await until(() =>
            rowA.querySelector('[data-ai-f67-badge]') !== null, 4000);
        ok(badgeShown, 'F67b-4: badge metadati F17 sulla riga del messaggio');
        const bmeta = rowA.querySelector('[data-ai-f67-badge]');
        ok(!!bmeta && /kind=note/.test(bmeta.title || ''),
            'F67b-4: badge title riporta kind=note',
            bmeta ? bmeta.title : 'badge assente');

        /* ---------- F67b-5: undo -> store IDENTICO (0 note) ---------- */
        const undone2 = win.AIService.undo();
        ok(undone2 === true, 'F67b-5: AIService.undo() restituisce true');
        await until(() => store.items.filter(i => i.kind === 'note').length === 0, 3000);
        const notesAfter = store.items.filter(i => i.kind === 'note').length;
        ok(notesAfter === notesBefore, 'F67b-5: undo -> la nota e rimossa (store identico a prima)',
            'before=' + notesBefore + ' after=' + notesAfter);
        ok(store.items.filter(i => i.kind === 'documento').length === docBefore &&
            store.items.filter(i => i.kind === 'mazzo').length === deckBefore,
            'F67b-5: nessun side-effect su altri kind',
            'documenti=' + store.items.filter(i => i.kind === 'documento').length +
            ' mazzi=' + store.items.filter(i => i.kind === 'mazzo').length);
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
        console.log('  ECCEZIONE: ' + e);
    }
    console.log('\n================================================');
    console.log('RISULTATI F67 (jsdom): ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exit(fail ? 1 : 0);
}
main();
