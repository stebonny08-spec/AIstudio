/* ============================================================
   tests/schJourney.js — ANALYST 2.6: viaggio utente completo Schemi
   Script TEMPORANEO (sola lettura prodotto). Stile qa3: jsdom +
   moduli reali + virtualConsole che raccoglie jsdomError/error/warn.
   Percorso: renderList -> renderChooser -> creazione 5 tipi ->
   apertura -> nodi -> collegamento (rifiuto+accettato) -> drag ->
   autoLayout -> etichetta arco (mappa) -> testo nodo -> cambia tipo
   x3 (con/da mappa) -> flush -> chiusura -> riapertura+verifica.
   Eseguire con: node tests/schJourney.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const M = (...p) => path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', ...p);
const SRC_STRAT = fs.readFileSync(M('schemaStrategies.js'), 'utf8');
const SRC_SCHEMI = fs.readFileSync(M('schemi.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Noise jsdom NON correlata a errore reale
const NOISE = /Not implemented|Could not parse CSS/i;
const vcLogs = [];
function realLogs() { return vcLogs.filter(l => !NOISE.test(l.msg)); }

function makeEnv() {
    const vc = new VirtualConsole();
    const push = (type) => (...a) => vcLogs.push({ type: type, msg: a.map(x => (x && x.stack) ? x.stack : String(x)).join(' ') });
    vc.on('jsdomError', push('jsdomError'));
    vc.on('error', push('error'));
    vc.on('warn', push('warn'));
    vc.on('log', push('log'));
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
        virtualConsole: vc
    });
    const win = dom.window;
    const doc = win.document;
    win.addEventListener('error', e => vcLogs.push({ type: 'winError', msg: String(e.message || e) }));

    const store = { items: [], seq: 1 };
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function el(tag, cls, text) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    win.App = {
        el: el, esc: esc,
        style: css => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); },
        header: (t, d, btns) => {
            const h = el('div', 'app-header');
            h.appendChild(el('h2', null, t));
            if (d) h.appendChild(el('p', null, d));
            if (btns && btns.length) {
                const row = el('div', 'header-actions');
                btns.forEach(b => row.appendChild(b));
                h.appendChild(row);
            }
            return h;
        },
        empty: (icon, text, btnText, onClick) => {
            const d = el('div', 'app-empty');
            d.appendChild(el('p', null, text));
            if (btnText) { const b = el('button', 'btn-accent', btnText); if (onClick) b.addEventListener('click', onClick); d.appendChild(b); }
            return d;
        },
        ICONS: { schemi: '' },
        fmtDate: s => String(s || ''),
        go: () => { },
        registerModule: m => { win.App._mod = m; }
    };

    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) {
                const i = store.items.filter(x => x.id === p.id)[0];
                if (i) { Object.assign(i, p); return Object.assign({}, i); }
            }
            const n = Object.assign({ id: 's' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async id => { store.items = store.items.filter(x => x.id !== id); },
        renameItem: async (id, t) => { const i = store.items.filter(x => x.id === id)[0]; if (i) i.title = t; },
        listSubjects: async () => [],
        hasBackend: async () => false,
        pickAsset: async () => null,
        assetUrl: s => s
    };

    win.SubjectInput = {
        normalize: s => String(s || '').trim(),
        remember: () => { },
        create: opts => {
            const wrap = el('div', 'subject-input');
            const inp = doc.createElement('input');
            inp.className = 'subject-field';
            inp.value = (opts && opts.value) || '';
            if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
            wrap.appendChild(inp);
            wrap.getValue = () => inp.value;
            if (opts && opts.onChange) inp.addEventListener('change', () => opts.onChange(inp.value));
            return wrap;
        }
    };

    win.Folders = {
        bar: () => el('div', 'folders-bar'),
        grid: () => el('div', 'folders-grid'),
        filterItems: items => items,
        moveSelect: () => { const b = el('button', 'tool-btn', 'Sposta'); return b; },
        get: () => ''
    };

    win.confirm = () => false;

    win.eval(SRC_STRAT);
    win.eval(SRC_SCHEMI);

    return { dom, win, doc, store, mod: win.App._mod };
}

// ---- helpers ----
const $ = (env, sel) => env.doc.querySelector(sel);
const $$ = (env, sel) => Array.from(env.doc.querySelectorAll(sel));
function click(env, elm) { elm.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true })); }
function ptr(env, target, type, x, y) {
    target.dispatchEvent(new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
}
function nodeGroup(env, nid) { return env.doc.querySelector('g.sc-node[data-nid="' + nid + '"]'); }
function nodeRect(env, nid) {
    const g = nodeGroup(env, nid);
    if (!g) return null;
    const r = g.querySelector('rect');
    if (!r) return null;
    return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') };
}
function edgeGroups(env) { return $$(env, '.sc-edges .sc-edge'); }
function stratButtons(env) { return Array.from(env.doc.querySelectorAll('.sc-btnwrap button, .sc-tools button')).filter(b => b.closest('.sc-btnwrap') || b.classList.contains('tool-btn')); }
function stratButton(env, label) {
    return $$(env, '.sc-btnwrap button').filter(b => b.textContent.trim() === label)[0] ||
        $$(env, '.sc-tools .tool-btn').filter(b => b.textContent.trim() === label)[0] || null;
}
function selType(env) { return env.doc.querySelector('.sc-type-sel'); }
function toastText(env) { const t = env.doc.querySelector('.sc-toast'); return t ? t.textContent : null; }
function headerBtn(env, re) {
    return Array.from(env.doc.querySelectorAll('.app-header button')).filter(b => re.test(b.textContent))[0] || null;
}
async function saveNow(env) {
    const b = headerBtn(env, /Salva/);
    if (b) click(env, b);
    await sleep(200);
}
async function backToList(env) {
    const b = headerBtn(env, /Elenco/);
    if (b) click(env, b);
    await sleep(200);
}
function nodeIds(env) { return $$(env, 'g.sc-node[data-nid]').map(g => g.getAttribute('data-nid')); }
function docOf(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    return JSON.parse(it.content);
}
function yMap(env, ids) {
    const o = {};
    ids.forEach(k => { const r = nodeRect(env, k); o[k] = r ? { x: r.x, y: r.y } : null; });
    return o;
}
function changed(before, after) {
    return Object.keys(after).some(k => before[k] && after[k] && (before[k].x !== after[k].x || before[k].y !== after[k].y));
}
function dragNode(env, nid, dx, dy) {
    const g = nodeGroup(env, nid);
    ptr(env, g, 'pointerdown', 50, 50);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointermove', 50 + dx, 50 + dy);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 50 + dx, 50 + dy);
}
function connectPair(env, fromId, toId) {
    click(env, stratButton(env, 'Collega'));
    ptr(env, nodeGroup(env, fromId), 'pointerdown', 5, 5);
    ptr(env, nodeGroup(env, toId), 'pointerdown', 9, 9);
}

// ===============================================================
async function run() {
    const env = makeEnv();
    const cont = env.doc.getElementById('main');

    // seed 1 item per renderizzare una card in lista
    env.store.items.push({
        id: 'seed1', kind: 'schema', title: 'Seed', materia: '', tags: '', description: '', thumbnail: '', folder_id: '',
        content: JSON.stringify({ type: 'libero', nodes: [{ id: 's1', x: 10, y: 10, w: 170, h: 60, text: 'Seed' }], edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [], style: { palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980', edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round' } })
    });

    // ---------- 1. renderList ----------
    console.log('== 1. renderList ==');
    cont.innerHTML = '';
    env.mod.open(cont, {});
    await sleep(150);
    ok(!!headerBtn(env, /Nuovo schema/), 'lista: header "Nuovo schema" presente');
    ok($$(env, '.card').length >= 1 || $$(env, '.app-empty').length >= 1, 'lista: contenuto renderizzato (card o empty)');

    // ---------- 2. renderChooser ----------
    console.log('== 2. renderChooser ==');
    click(env, headerBtn(env, /Nuovo schema/));
    await sleep(180);
    const choices = $$(env, '.choice');
    const labels = choices.map(c => c.textContent.trim());
    ok(choices.length === 5, 'chooser: 5 .choice', 'n=' + choices.length);
    ok(labels.join('|') === 'Albero|Mappa concettuale|Sinistra → destra|Schema libero|Riassunto visuale',
        'chooser: ordine etichette atteso', JSON.stringify(labels));

    // ---------- 3. creazione dei 5 tipi dal dialog ----------
    console.log('== 3. creazione 5 tipi ==');
    const TIPI = ['albero', 'mappa', 'lr', 'libero', 'riassunto'];
    const created = {};
    for (let i = 0; i < TIPI.length; i++) {
        const tipo = TIPI[i];
        if (!$$(env, '.choice').length) { // siamo in lista: riapri chooser
            click(env, headerBtn(env, /Nuovo schema/));
            await sleep(180);
        }
        click(env, $$(env, '.choice')[i]);
        click(env, $$(env, '.btn-accent').filter(b => /Crea schema/.test(b.textContent))[0]);
        await sleep(220);
        const sel = selType(env);
        ok(!!sel && sel.value === tipo, 'creazione ' + tipo + ': editor aperto col tipo giusto', sel ? sel.value : 'no editor');
        const nItems = env.store.items.length;
        const last = env.store.items[nItems - 1];
        let st = null; try { st = JSON.parse(last.content).type; } catch (e) { st = 'parse-err'; }
        ok(st === tipo, 'creazione ' + tipo + ': content.type salvato === ' + tipo, String(st));
        created[tipo] = last.id;
        await backToList(env);
        ok(!!headerBtn(env, /Nuovo schema/), 'creazione ' + tipo + ': ritorno in lista');
    }

    // ---------- 4. apertura (mappa) + nodi ----------
    console.log('== 4. apertura + aggiunta nodi ==');
    cont.innerHTML = '';
    env.mod.open(cont, { open: created['mappa'] });
    await sleep(200);
    ok(!!selType(env) && selType(env).value === 'mappa', 'apertura: editor mappa montato');
    let ids = nodeIds(env);
    ok(ids.length === 1, 'apertura: nodo iniziale (Idea centrale)', 'n=' + ids.length);
    // BLOCCO 1.1/1.3: matrice mappa con >=1 nodo = + Figlio / + Fratello, NIENTE + Nodo
    const matriceOk = !stratButton(env, '+ Nodo') && !!stratButton(env, '+ Figlio') && !!stratButton(env, '+ Fratello');
    // seleziona il nodo iniziale e crea due nodi connessi con + Figlio
    ptr(env, nodeGroup(env, ids[0]), 'pointerdown', 5, 5);
    ptr(env, env.doc.querySelector('.sc-stage svg'), 'pointerup', 5, 5);
    click(env, stratButton(env, '+ Figlio'));
    await sleep(60);
    click(env, stratButton(env, '+ Figlio'));
    await sleep(60);
    ids = nodeIds(env);
    ok(matriceOk && ids.length === 3, 'nodi: matrice mappa (niente +Nodo) + +Figlio x2 -> 3 nodi', 'n=' + ids.length + ' matrice=' + matriceOk);
    const [A, B] = ids;

    // ---------- 5. collegamento: accettato + rifiuto ----------
    console.log('== 5. collegamento canConnect ==');
    const C = ids[2];   // coppia senza arco esistente (A->B c'e' gia' dopo +Figlio x2)
    connectPair(env, A, C);
    await sleep(60);
    ok(edgeGroups(env).length === 3, 'collegamento accettato: arco creato (tot 3)', 'dom=' + edgeGroups(env).length);
    const t1 = toastText(env);
    connectPair(env, A, C); // duplicato esatto -> rifiuto
    await sleep(60);
    ok(edgeGroups(env).length === 3, 'collegamento rifiutato (duplicato): nessun arco aggiunto', 'dom=' + edgeGroups(env).length);
    const t2 = toastText(env);
    ok(!!t2 && t2.length > 0, 'collegamento rifiutato: toast motivato mostrato', String(t2));

    // ---------- 6. drag nodo ----------
    console.log('== 6. drag nodo ==');
    const before = nodeRect(env, A);
    dragNode(env, A, 60, 40);
    await sleep(60);
    const afterDrag = nodeRect(env, A);
    ok(!!afterDrag && (afterDrag.x !== before.x || afterDrag.y !== before.y),
        'drag: posizione nodo A cambiata', JSON.stringify({ before: before, after: afterDrag }));

    // ---------- 7. auto-layout ----------
    console.log('== 7. auto-layout ==');
    const idsAll = nodeIds(env);
    const pre = yMap(env, idsAll);
    click(env, stratButton(env, 'Auto-layout'));
    await sleep(450);
    const post = yMap(env, idsAll);
    ok(changed(pre, post), 'auto-layout: nodi ridisposti', JSON.stringify({ pre: pre, post: post }));
    ok(edgeGroups(env).length === 3, 'auto-layout: archi invariati', 'dom=' + edgeGroups(env).length);

    // ---------- 8. doppio-click arco -> etichetta (mappa) ----------
    console.log('== 8. etichetta arco ==');
    const eg = edgeGroups(env)[0];
    eg.dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true }));
    await sleep(120);
    let modalInput = env.doc.querySelector('.modal-overlay input');
    ok(!!modalInput, 'etichetta: modale aperta su doppio-click arco (mappa)');
    if (modalInput) {
        modalInput.value = 'Etichetta viaggio';
        const mOk = env.doc.querySelector('.modal-overlay .btn-accent');
        click(env, mOk);
        await sleep(260);
        const lbl = env.doc.querySelector('.sc-elabel text');
        ok(!!lbl && /Etichetta viaggio/.test(lbl.textContent), 'etichetta: salvata e renderizzata', lbl ? lbl.textContent : 'assente');
    }

    // ---------- 9. testo nodo (doppio-click) ----------
    console.log('== 9. testo nodo ==');
    nodeGroup(env, A).dispatchEvent(new env.win.MouseEvent('dblclick', { bubbles: true }));
    await sleep(80);
    const ta = env.doc.querySelector('.sc-stage textarea');
    ok(!!ta, 'testo nodo: textarea overlay aperta');
    if (ta) {
        ta.value = 'Testo nodo J';
        ta.dispatchEvent(new env.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(80);
        const g = nodeGroup(env, A);
        ok(!!g && /Testo nodo J/.test(g.textContent), 'testo nodo: commit + render dopo Escape', g ? g.textContent.slice(0, 60) : 'gruppo assente');
    }

    // ---------- 10. cambia tipo x3 (con/da mappa) ----------
    console.log('== 10. cambia tipo (mappa->albero->lr->mappa) ==');
    const nNodesPre = nodeIds(env).length, nEdgesPre = edgeGroups(env).length;
    const transizioni = ['mappa>albero', 'albero>lr', 'lr>mappa'];
    for (let i = 0; i < transizioni.length; i++) {
        const target = transizioni[i].split('>')[1];
        const sel = selType(env);
        sel.value = target;
        sel.dispatchEvent(new env.win.Event('change', { bubbles: true }));
        await sleep(320);
        ok(!!selType(env) && selType(env).value === target, 'transizione ' + transizioni[i] + ': selType aggiornato');
        ok(nodeIds(env).length === nNodesPre, 'transizione ' + transizioni[i] + ': nodi conservati (' + nNodesPre + ')', 'n=' + nodeIds(env).length);
        ok(edgeGroups(env).length === nEdgesPre, 'transizione ' + transizioni[i] + ': archi conservati (' + nEdgesPre + ')', 'dom=' + edgeGroups(env).length);
    }

    // ---------- 11. flush autosave ----------
    console.log('== 11. flush autosave ==');
    await saveNow(env);
    const saved = docOf(env, created['mappa']);
    ok(saved.type === 'mappa', 'flush: type===mappa nel content', saved.type);
    ok(saved.nodes.length === nNodesPre, 'flush: nodi salvati (' + nNodesPre + ')', 'n=' + saved.nodes.length);
    ok(saved.edges.length === 3 && saved.edges[0].label === 'Etichetta viaggio',
        'flush: etichetta arco salvata nel content',
        saved.edges.length + '/' + (saved.edges[0] && saved.edges[0].label));
    const nA = saved.nodes.filter(n => n.id === A)[0];
    ok(!!nA && nA.text === 'Testo nodo J', 'flush: testo nodo salvato', nA ? String(nA.text) : 'nodo assente');
    ok(saved.extraCount === undefined, 'flush: nessun extraCount residuo nel content');

    // ---------- 12. chiusura ----------
    console.log('== 12. chiusura ==');
    await backToList(env);
    ok(!!headerBtn(env, /Nuovo schema/) && !selType(env), 'chiusura: tornato in lista, editor smontato');

    // ---------- 13. riapertura + verifica ----------
    console.log('== 13. riapertura + verifica ==');
    cont.innerHTML = '';
    env.mod.open(cont, { open: created['mappa'] });
    await sleep(250);
    ok(!!selType(env) && selType(env).value === 'mappa', 'riapertura: tipo mappa persistito');
    ok(nodeIds(env).length === nNodesPre, 'riapertura: nodi presenti (' + nNodesPre + ')', 'n=' + nodeIds(env).length);
    ok(edgeGroups(env).length === 3, 'riapertura: 3 archi', 'dom=' + edgeGroups(env).length);
    const lbl2 = env.doc.querySelector('.sc-elabel text');
    ok(!!lbl2 && /Etichetta viaggio/.test(lbl2.textContent), 'riapertura: etichetta persistita', lbl2 ? lbl2.textContent : 'assente');
    const g2 = nodeGroup(env, A);
    ok(!!g2 && /Testo nodo J/.test(g2.textContent), 'riapertura: testo nodo persistito', g2 ? g2.textContent.slice(0, 60) : 'assente');
    // nessun residuo legacy
    const raw = String(env.store.items.filter(x => x.id === created['mappa'])[0].content);
    ok(!/pendingLegacyLayout|legacyTb/.test(raw), 'riapertura: zero flag legacy nel content');

    // ===============================================================
    // REPORT errori console
    // ===============================================================
    console.log('\n== CONSOLE / ECCEZIONI ==');
    const noise = vcLogs.filter(l => NOISE.test(l.msg));
    const real = realLogs();
    console.log('  log totali catturati: ' + vcLogs.length + ' (noise jsdom escluso: ' + noise.length + ', reali: ' + real.length + ')');
    const realErrors = real.filter(l => l.type === 'jsdomError' || l.type === 'error' || l.type === 'winError');
    const realWarns = real.filter(l => l.type === 'warn');
    console.log('  ECCEZIONI/ERRORI reali: ' + realErrors.length + ' | WARN reali: ' + realWarns.length);
    realErrors.forEach((l, i) => console.log('   [ERR ' + i + '][' + l.type + '] ' + l.msg.slice(0, 500)));
    realWarns.forEach((l, i) => console.log('   [WARN ' + i + '] ' + l.msg.slice(0, 500)));
    const realLogsOnly = real.filter(l => l.type === 'log');
    if (realLogsOnly.length) console.log('  (console.log pagina: ' + realLogsOnly.length + ' — non considerati errore)');
    ok(realErrors.length === 0, 'zero eccezioni/console.error reali durante il viaggio', 'n=' + realErrors.length);

    console.log('\n================================================');
    console.log('JOURNEY: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) { console.log('FAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    process.exitCode = fail ? 1 : 0;
}

run().catch(e => { console.error('CRASH JOURNEY:', e); process.exitCode = 2; });
