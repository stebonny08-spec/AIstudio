/* ============================================================
   modules/ripasso.js — modulo Ripasso (mazzi di flashcard).
   - Griglia mazzi con ricerca e filtri (materia / tag)
   - Form nuovo / modifica mazzo
   - Editor split: lista card a sinistra, editor card a destra
   - "Genera da appunti": bozza euristica LOCALE (no pipeline LLM)
   - Modalita studio con ripetizione spaziata semplice (box 0..5)
   Tutto locale: nessuna rete, nessuna dipendenza esterna.
   ============================================================ */
(function () {
    'use strict';

    /* ---------- costanti ---------- */
    const FONTS = [
        { v: 'system', label: 'Di sistema', css: 'system-ui, -apple-system, sans-serif' },
        { v: 'sans-serif', label: 'Sans-serif', css: 'sans-serif' },
        { v: 'serif', label: 'Serif', css: 'serif' },
        { v: 'monospace', label: 'Monospazio', css: 'monospace' }
    ];
    const GEN_KINDS = ['note', 'riassunto', 'documento'];
    const KIND_LABEL = { note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento' };

    /* ---------- stato ---------- */
    let root = null;
    let subjects = [];
    let decks = [];
    let filters = { q: '', materia: '', tag: '' };
    let editorDeck = null;
    let selIdx = 0;
    let study = null;
    let dirty = false;
    let genOpen = false;
    let genItems = [];
    let genLoaded = false;

    /* ---------- css extra (solo classi nuove) ---------- */
    App.style(
        '.flashcard { position: relative; }' +
        '.fc-answer { width: 100%; border-top: 1px dashed var(--border); margin-top: 16px;' +
        ' padding-top: 14px; font-size: 16px; color: #c7cdd8; line-height: 1.6; text-align: left; }' +
        '.rip-bar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }' +
        '.rip-deck-dot { width: 13px; height: 13px; border-radius: 4px; flex-shrink: 0; display: inline-block; }' +
        '.rip-gen { background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px;' +
        ' padding: 14px; margin-bottom: 14px; }' +
        '.rip-gen .rip-gen-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }' +
        '.rip-hint { font-size: 12.5px; color: var(--muted); line-height: 1.55; }' +
        '.rip-right { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; }' +
        '.rip-right::-webkit-scrollbar { width: 7px; }' +
        '.rip-right::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }' +
        '.rip-img-preview { max-width: 240px; max-height: 160px; border-radius: 10px;' +
        ' border: 1px solid var(--border); margin-top: 10px; display: block; }' +
        '.rip-sum { max-width: 520px; margin: 30px auto; padding: 24px; }' +
        '.rip-sum-row { display: flex; justify-content: space-between; padding: 10px 4px;' +
        ' border-bottom: 1px solid var(--border); font-size: 14.5px; }' +
        '.rip-sum-row strong { color: var(--accent); }' +
        '.rip-toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%) translateY(14px);' +
        ' background: var(--panel); border: 1px solid var(--accent); color: var(--text); padding: 10px 18px;' +
        ' border-radius: 10px; font-size: 13.5px; opacity: 0; transition: all .25s; z-index: 200; pointer-events: none; }' +
        '.rip-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }'
    );

    /* ---------- piccoli util ---------- */
    function opt(v, t) {
        const o = App.el('option');
        o.value = v;
        o.textContent = t;
        return o;
    }
    function btn(label, cls, disabled, fn) {
        const b = App.el('button', cls || 'tool-btn');
        b.type = 'button';
        b.textContent = label;
        b.disabled = !!disabled;
        b.addEventListener('click', fn);
        return b;
    }
    function actBtn(label, fn, danger) {
        const b = App.el('button', danger ? 'danger' : '');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        return b;
    }
    function toast(msg) {
        const t = App.el('div', 'rip-toast', App.esc(msg));
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
        }, 1600);
    }
    function fontCss(v) {
        for (let i = 0; i < FONTS.length; i++) if (FONTS[i].v === v) return FONTS[i].css;
        return 'sans-serif';
    }

    /* ---------- modello dati ---------- */
    function parseContent(str) {
        try {
            const o = JSON.parse(str || '{}');
            if (o && Array.isArray(o.cards)) {
                return {
                    cards: o.cards,
                    color: o.color || '#8ca4ff',
                    fpSources: Array.isArray(o.fpSources) ? o.fpSources : []
                };
            }
        } catch (e) { /* content non valido */ }
        return { cards: [], color: '#8ca4ff', fpSources: [] };
    }
    function deckFromItem(it) {
        const c = parseContent(it.content);
        return {
            id: it.id,
            title: it.title || 'Senza titolo',
            materia: it.materia || '',
            tags: it.tags || '',
            description: it.description || '',
            color: c.color,
            cards: c.cards,
            fpSources: c.fpSources
        };
    }
    function newCard(color) {
        return {
            id: StudyStore.uuid(),
            q: '', a: '',
            color: color || '#8ca4ff',
            font: 'system',
            image: '',
            seen: 0, yes: 0, no: 0, box: 0
        };
    }
    function persistDeck(d) {
        if (!d.id) d.id = StudyStore.uuid();
        return StudyStore.saveItem({
            id: d.id,
            kind: 'mazzo',
            title: d.title || 'Senza titolo',
            content: JSON.stringify({ cards: d.cards, color: d.color, fpSources: d.fpSources || [] }),
            materia: d.materia || '',
            tags: d.tags || '',
            description: d.description || '',
            thumbnail: ''
        });
    }

    /* ---------- R21 B5: stato/integrazione FontiPanel (congelato) ---------- */
    let fpPanel = null;    // istanza { el, refresh, destroy } o null
    let fpCtx = null;      // contesto pannello aperto: 'editor' | 'form' | 'gen'
    let fpUndo = null;     // { deck, idx } ultima card inserita da una fonte
    let genFonte = null;   // fonte per "Genera da appunti": {titolo,tipo,fonteId,text}

    function fpAdapters() {
        try {
            if (typeof window !== 'undefined' && window.FontiPanel && window.FontiPanel.adapters) {
                return window.FontiPanel.adapters;
            }
        } catch (e) { /* ok */ }
        return null;
    }
    /* testo plain della fonte: itemTexts (adattatore) oppure extractText locale */
    function fonteTextsSync(source) {
        if (!source) return '';
        const A = fpAdapters();
        try {
            if (A && typeof A.itemTexts === 'function') {
                const ex = A.itemTexts(source.content);
                if (ex && ex.text) return String(ex.text);
            }
        } catch (e) { /* fallback sotto */ }
        const raw = String(source.content == null ? '' : source.content);
        if (!raw) return '';
        try { return extractText(raw); } catch (e) { return raw; }
    }
    function htmlToPlain(h) {
        return String(h == null ? '' : h)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
    }
    /* fallback asincrono: {"html"} e materiali via adapters.previewFonte21 */
    function fonteTextsAsync(source) {
        const A = fpAdapters();
        if (A && typeof A.previewFonte21 === 'function') {
            return Promise.resolve()
                .then(() => A.previewFonte21(source))
                .then(pv => {
                    const t = pv && htmlToPlain(pv.html);
                    return (t && t !== 'Nessun testo leggibile.') ? t : fonteTextsSync(source);
                })
                .catch(() => fonteTextsSync(source));
        }
        return Promise.resolve(fonteTextsSync(source));
    }
    function plainPreview(t, max) {
        const lim = max || 200;
        const s = String(t == null ? '' : t)
            .replace(/[*_`#>|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!s) return 'Anteprima non disponibile.';
        return s.length > lim ? s.slice(0, lim - 1).trim() + '\u2026' : s;
    }
    function destroyFonti() {
        if (fpPanel) {
            try { fpPanel.destroy(); } catch (e) { /* ok */ }
        }
        fpPanel = null;
        fpCtx = null;
    }
    /* toggle: stesso contesto aperto -> chiude; contesto diverso -> ricrea */
    function toggleFonti(ctx, onInsert) {
        if (fpPanel && fpCtx === ctx) { destroyFonti(); return; }
        destroyFonti();
        try {
            if (typeof window === 'undefined' || !window.FontiPanel ||
                typeof window.FontiPanel.create !== 'function') {
                toast('Pannello fonti non disponibile');
                return;
            }
            fpCtx = ctx;
            fpPanel = window.FontiPanel.create({ contesto: 'ripasso', onInsert: onInsert });
            document.body.appendChild(fpPanel.el);
        } catch (e) {
            fpPanel = null;
            fpCtx = null;
            toast('Apertura fonti non riuscita');
        }
    }
    /* card di partenza derivata da una fonte: q "Da: <titolo> (<tipo>)" + fp */
    function pushCardFromFonte(d, source, info, text) {
        const tipo = (info && info.tipo) || 'Fonte';
        const titolo = (info && info.titolo) || (source && source.title) || 'Fonte';
        const fonteId = (info && info.id != null) ? info.id
            : ((source && source.id != null) ? source.id : '');
        const c = newCard(d.color);
        c.q = 'Da: ' + titolo + ' (' + tipo + ')';
        c.a = plainPreview(text, 200);
        c.fp = { tipo: tipo, titolo: titolo, fonteId: fonteId };
        d.cards.push(c);
        if (!Array.isArray(d.fpSources)) d.fpSources = [];
        d.fpSources.push({ tipo: tipo, titolo: titolo, fonteId: fonteId, ts: Date.now() });
        fpUndo = { deck: d, idx: d.cards.length - 1 };
        return c;
    }
    function undoCardFromFonte(d) {
        if (!fpUndo || fpUndo.deck !== d || !d.cards || fpUndo.idx >= d.cards.length) {
            fpUndo = null;
            return false;
        }
        const removed = d.cards.splice(fpUndo.idx, 1)[0];
        if (Array.isArray(d.fpSources)) {
            const last = d.fpSources[d.fpSources.length - 1];
            if (last && removed && removed.fp && last.fonteId === removed.fp.fonteId) {
                d.fpSources.pop();
            }
        }
        fpUndo = null;
        if (editorDeck === d && selIdx >= d.cards.length) {
            selIdx = Math.max(0, d.cards.length - 1);
        }
        return true;
    }
    async function loadDecks() {
        try {
            const items = await StudyStore.listItems('mazzo');
            decks = (items || []).map(deckFromItem);
        } catch (e) {
            console.error('ripasso load:', e);
            decks = [];
        }
    }
    function filteredDecks() {
        let out = decks.slice();
        if (filters.materia) out = out.filter(d => SubjectInput.normalize(d.materia) === SubjectInput.normalize(filters.materia));
        if (filters.tag) {
            out = out.filter(d => (d.tags || '').split(',').map(t => t.trim()).indexOf(filters.tag) >= 0);
        }
        if (filters.q) {
            const q = filters.q.toLowerCase();
            out = out.filter(d =>
                (d.title || '').toLowerCase().indexOf(q) >= 0 ||
                (d.description || '').toLowerCase().indexOf(q) >= 0 ||
                (d.materia || '').toLowerCase().indexOf(q) >= 0);
        }
        return out;
    }
    function allTags() {
        const set = {};
        decks.forEach(d => (d.tags || '').split(',').forEach(t => {
            const x = t.trim();
            if (x) set[x] = 1;
        }));
        return Object.keys(set).sort((a, b) => a.localeCompare(b));
    }

    /* ============================================================
       VISTA 1 — griglia mazzi
       ============================================================ */
    function renderGrid() {
        if (!root) return;
        destroyFonti();
        root.innerHTML = '';

        const btnNuovo = App.el('button', 'tool-btn');
        btnNuovo.type = 'button';
        btnNuovo.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Nuovo mazzo';
        btnNuovo.addEventListener('click', () => openForm(null));
        root.appendChild(App.header('Ripasso', 'Mazzi di flashcard per fissare gli argomenti', [btnNuovo]));

        const bar = App.el('div', 'toolbar plain');
        const search = App.el('input', 'search-input');
        search.type = 'search';
        search.placeholder = 'Cerca mazzi\u2026';
        search.value = filters.q;
        search.addEventListener('input', () => { filters.q = search.value; renderBody(); });
        bar.appendChild(search);

        const selMat = App.el('select', 'mini');
        selMat.appendChild(opt('', 'Tutte le materie'));
        subjects.forEach(s => selMat.appendChild(opt(s.name, s.name)));
        selMat.value = filters.materia;
        selMat.addEventListener('change', () => { filters.materia = selMat.value; renderBody(); });
        bar.appendChild(selMat);

        const selTag = App.el('select', 'mini');
        selTag.appendChild(opt('', 'Tutti i tag'));
        allTags().forEach(t => selTag.appendChild(opt(t, t)));
        selTag.value = filters.tag;
        selTag.addEventListener('change', () => { filters.tag = selTag.value; renderBody(); });
        bar.appendChild(selTag);

        const reset = App.el('button', 'tool-btn');
        reset.type = 'button';
        reset.textContent = 'Azzera filtri';
        reset.addEventListener('click', () => {
            filters = { q: '', materia: '', tag: '' };
            renderGrid();
        });
        bar.appendChild(reset);
        root.appendChild(bar);

        const body = App.el('div', '');
        root.appendChild(body);
        renderBody();

        function renderBody() {
            body.innerHTML = '';
            const list = filteredDecks();
            if (!list.length) {
                body.appendChild(App.empty(
                    App.ICONS.ripasso,
                    decks.length
                        ? 'Nessun mazzo corrisponde ai filtri scelti.'
                        : 'Nessun mazzo ancora: usa il pulsante «Nuovo mazzo» in alto a sinistra per iniziare a ripassare.'));
                return;
            }
            const grid = App.el('div', 'grid-cards');
            list.forEach(d => grid.appendChild(deckCard(d)));
            body.appendChild(grid);
        }
    }

    function deckCard(d) {
        const card = App.el('div', 'card clickable');
        card.tabIndex = 0;
        let dot = 'var(--muted)';
        for (let i = 0; i < subjects.length; i++) {
            if (SubjectInput.normalize(subjects[i].name) === SubjectInput.normalize(d.materia)) { dot = subjects[i].color; break; }
        }
        card.innerHTML =
            '<div style="display:flex;align-items:center;gap:9px">' +
                '<span class="rip-deck-dot" style="background:' + App.esc(d.color || '#8ca4ff') + '"></span>' +
                '<h4 style="margin:0">' + App.esc(d.title) + '</h4>' +
            '</div>' +
            '<div class="meta" style="margin-top:7px">' +
                (d.materia
                    ? '<span class="chip"><span class="dot" style="background:' + App.esc(dot) + '"></span>' +
                      App.esc(d.materia) + '</span>'
                    : '') +
                '<span>' + d.cards.length + ' flashcard</span>' +
            '</div>' +
            (d.description ? '<div class="preview">' + App.esc(d.description) + '</div>' : '');

        const actions = App.el('div', 'card-actions');
        actions.appendChild(actBtn('Avvia studio', () => startStudy(d)));
        actions.appendChild(actBtn('Apri editor', () => openEditor(d)));
        actions.appendChild(actBtn('Rinomina', async () => {
            const v = prompt('Nuovo nome del mazzo:', d.title);
            if (v == null) return;
            const t = v.trim();
            if (!t) return;
            await StudyStore.renameItem(d.id, t);
            await loadDecks();
            renderGrid();
        }));
        actions.appendChild(actBtn('Elimina', async () => {
            if (!confirm('Eliminare il mazzo \u00ab' + d.title + '\u00bb con ' + d.cards.length + ' flashcard?')) return;
            await StudyStore.deleteItem(d.id);
            await loadDecks();
            renderGrid();
        }, true));
        card.appendChild(actions);

        card.addEventListener('click', e => {
            if (e.target.closest('.card-actions')) return;
            openEditor(d);
        });
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter') openEditor(d);
        });
        return card;
    }

    /* ============================================================
       VISTA 2 — form nuovo / modifica mazzo
       ============================================================ */
    function openForm(existing) {
        const d = existing
            ? Object.assign({}, existing)
            : { id: null, title: '', materia: '', tags: '', description: '', color: '#8ca4ff', cards: [] };

        const hActs = [];
        const bFontiF = App.el('button', 'tool-btn');
        bFontiF.type = 'button';
        bFontiF.textContent = 'Fonti';
        bFontiF.title = 'Aggiungi una card da una fonte';
        bFontiF.addEventListener('click', () => toggleFonti('form', (s, i) => insertFormFonte(s, i)));
        hActs.push(bFontiF);
        root.innerHTML = '';
        root.appendChild(App.header(
            existing ? 'Modifica mazzo' : 'Nuovo mazzo',
            existing ? existing.title : 'Crea un mazzo di flashcard',
            hActs));

        const body = App.el('div', 'card');
        body.style.maxWidth = '640px';
        body.style.margin = '0 auto';
        body.style.padding = '24px';

        const fName = App.el('div', 'field');
        fName.innerHTML = '<label>Nome del mazzo</label>';
        const inName = App.el('input');
        inName.type = 'text';
        inName.value = d.title;
        inName.placeholder = 'es. Fotosintesi clorofilliana';
        fName.appendChild(inName);
        body.appendChild(fName);

        const subjInput = SubjectInput.create({
            label: 'Materia',
            placeholder: 'Inserisci materia\u2026',
            value: d.materia || ''
        });
        body.appendChild(subjInput);

        const fCol = App.el('div', 'field');
        fCol.innerHTML = '<label>Colore del mazzo</label>';
        const inColor = App.el('input', 'color-swatch');
        inColor.type = 'color';
        inColor.value = d.color || '#8ca4ff';
        fCol.appendChild(inColor);
        body.appendChild(fCol);

        const fDesc = App.el('div', 'field');
        fDesc.innerHTML = '<label>Descrizione</label>';
        const inDesc = App.el('textarea');
        inDesc.value = d.description;
        inDesc.placeholder = 'Di cosa parla questo mazzo?';
        fDesc.appendChild(inDesc);
        body.appendChild(fDesc);

        const fTags = App.el('div', 'field');
        fTags.innerHTML = '<label>Tag</label>';
        const inTags = App.el('input');
        inTags.type = 'text';
        inTags.value = d.tags;
        inTags.placeholder = 'es. biologia, verifica, unit\u00e0 3';
        fTags.appendChild(inTags);
        fTags.appendChild(App.el('div', 'hint', 'Separa i tag con la virgola.'));
        body.appendChild(fTags);

        const hintF = App.el('div', 'rip-hint');
        body.appendChild(hintF);
        function updFormFp() {
            const n = (d.cards || []).length;
            hintF.textContent = n
                ? (n + ' flashcard pronte \u00b7 ultima da fonte \u00ab' + (d.cards[n - 1].q || '') + '\u00bb')
                : 'Nessuna flashcard: aggiungine una da una fonte oppure crea il mazzo e usa l\u2019editor.';
            bUndoF.style.display = (fpUndo && fpUndo.deck === d && n) ? '' : 'none';
        }
        function insertFormFonte(source, info) {
            const apply = txt => {
                try {
                    pushCardFromFonte(d, source, info, txt);
                    updFormFp();
                    toast('Card da fonte aggiunta al mazzo');
                } catch (e) { toast('Inserimento non riuscito'); }
            };
            let t = '';
            try { t = fonteTextsSync(source); } catch (e) { t = ''; }
            if (t) { apply(t); return; }
            fonteTextsAsync(source).then(x => apply(x || '')).catch(() => apply(''));
        }
        const acts = App.el('div', 'form-actions');
        const bUndoF = App.el('button', 'btn-secondary');
        bUndoF.type = 'button';
        bUndoF.textContent = 'Annulla inserimento';
        bUndoF.style.display = 'none';
        bUndoF.addEventListener('click', () => {
            if (undoCardFromFonte(d)) { updFormFp(); toast('Inserimento annullato'); }
        });
        const bCancel = App.el('button', 'btn-secondary');
        bCancel.type = 'button';
        bCancel.textContent = 'Annulla';
        bCancel.addEventListener('click', async () => {
            destroyFonti();
            if (fpUndo && fpUndo.deck === d) fpUndo = null;
            if (existing) openEditor(existing);
            else { await loadDecks(); renderGrid(); }
        });
        const bSave = App.el('button', 'btn-accent');
        bSave.type = 'button';
        bSave.textContent = existing ? 'Salva modifiche' : 'Crea mazzo';
        bSave.addEventListener('click', async () => {
            const title = inName.value.trim();
            if (!title) { alert('Inserisci un nome per il mazzo.'); return; }
            d.title = title;
            const nomeMat = SubjectInput.normalize(subjInput.getValue());
            d.materia = nomeMat;
            if (nomeMat) { try { await SubjectInput.remember(nomeMat); } catch (e) { /* best effort */ } }
            d.color = inColor.value;
            d.description = inDesc.value.trim();
            d.tags = inTags.value.trim();
            try {
                await persistDeck(d);
                await loadDecks();
                const saved = decks.find(x => x.id === d.id) || d;
                if (fpUndo && fpUndo.deck === d) fpUndo = { deck: saved, idx: fpUndo.idx };
                destroyFonti();
                openEditor(saved);
            } catch (e) {
                console.error('salvataggio mazzo:', e);
                alert('Salvataggio non riuscito: vedi console (F12).');
            }
        });
        acts.appendChild(bUndoF);
        acts.appendChild(bCancel);
        acts.appendChild(bSave);
        body.appendChild(acts);
        updFormFp();
        root.appendChild(body);
        setTimeout(() => { try { inName.focus(); } catch (e) { /* ok */ } }, 40);
    }

    /* ============================================================
       VISTA 3 — editor mazzo (split)
       ============================================================ */
    function openEditor(d) {
        editorDeck = d;
        selIdx = 0;
        genOpen = false;
        renderEditor();
    }

    async function saveEditor() {
        if (!editorDeck) return;
        try {
            await persistDeck(editorDeck);
            dirty = false;
        } catch (e) {
            console.error('salvataggio mazzo:', e);
        }
    }

    function renderEditor() {
        const d = editorDeck;
        if (!d) { if (root) renderGrid(); return; }
        if (!root) return;
        if (selIdx >= d.cards.length) selIdx = Math.max(0, d.cards.length - 1);
        root.innerHTML = '';

        if (genOpen && !genLoaded) {
            genLoaded = true;
            StudyStore.listItems('')
                .then(its => {
                    genItems = (its || []).filter(i => GEN_KINDS.indexOf(i.kind) >= 0);
                    if (editorDeck === d) renderEditor();
                })
                .catch(() => { genItems = []; });
        }

        const acts = [];
        const bBack = App.el('button', 'tool-btn');
        bBack.type = 'button';
        bBack.textContent = '\u2190 Indietro';
        bBack.addEventListener('click', async () => {
            await saveEditor();
            editorDeck = null;
            await loadDecks();
            renderGrid();
        });
        const bGen = App.el('button', 'tool-btn');
        bGen.type = 'button';
        bGen.textContent = 'Genera da appunti';
        bGen.addEventListener('click', () => { genOpen = !genOpen; renderEditor(); });
        /* R21 B5: FontiPanel nel contesto editor (creazione/titolazione mazzo) */
        const bFonti = App.el('button', 'tool-btn');
        bFonti.type = 'button';
        bFonti.textContent = 'Fonti';
        bFonti.title = 'Aggiungi una card da una fonte';
        bFonti.addEventListener('click', () => toggleFonti('editor', (s, i) => {
            const deck = editorDeck || d;
            const apply = txt => {
                try {
                    pushCardFromFonte(deck, s, i, txt);
                    saveEditor();
                    renderEditor();
                    toast('Card da fonte aggiunta al deck');
                } catch (e) { toast('Inserimento non riuscito'); }
            };
            let t = '';
            try { t = fonteTextsSync(s); } catch (e) { t = ''; }
            if (t) { apply(t); return; }
            fonteTextsAsync(s).then(x => apply(x || '')).catch(() => apply(''));
        }));
        const bStudy = App.el('button', 'tool-btn');
        bStudy.type = 'button';
        bStudy.textContent = 'Avvia studio';
        bStudy.addEventListener('click', () => startStudy(d));
        const bSave = App.el('button', 'btn-accent');
        bSave.type = 'button';
        bSave.textContent = 'Salva';
        bSave.addEventListener('click', async () => { await saveEditor(); toast('Mazzo salvato'); });
        acts.push(bBack, bGen, bFonti, bStudy, bSave);
        root.appendChild(App.header(d.title || 'Editor mazzo', d.cards.length + ' flashcard', acts));

        const split = App.el('div', 'split');
        const left = App.el('div', 'pane');
        const right = App.el('div', 'pane main');
        split.appendChild(left);
        split.appendChild(right);
        root.appendChild(split);

        /* --- pannello sinistro: lista card --- */
        const bAdd = App.el('button', 'tool-btn');
        bAdd.type = 'button';
        bAdd.style.width = '100%';
        bAdd.style.justifyContent = 'center';
        bAdd.textContent = '+ Aggiungi card';
        bAdd.addEventListener('click', () => {
            d.cards.push(newCard(d.color));
            selIdx = d.cards.length - 1;
            saveEditor();
            renderEditor();
        });
        left.appendChild(bAdd);

        /* undo dell'ultimo inserimento da fonte (stesso meccanismo di addCard) */
        if (fpUndo && fpUndo.deck === d && d.cards[fpUndo.idx]) {
            const bUndoI = App.el('button', 'tool-btn');
            bUndoI.type = 'button';
            bUndoI.style.width = '100%';
            bUndoI.style.justifyContent = 'center';
            bUndoI.textContent = 'Annulla inserimento';
            bUndoI.addEventListener('click', () => {
                if (undoCardFromFonte(d)) {
                    saveEditor();
                    renderEditor();
                    toast('Inserimento annullato');
                }
            });
            left.appendChild(bUndoI);
        }

        if (!d.cards.length) {
            left.appendChild(App.el('div', 'rip-hint',
                'Nessuna flashcard: aggiungine una oppure genera una bozza dagli appunti.'));
        }
        d.cards.forEach((c, i) => {
            const li = App.el('div', 'pane-list-item' + (i === selIdx ? ' active' : ''));
            const tot = (c.yes || 0) + (c.no || 0);
            li.innerHTML =
                '<div class="pli-title">' + App.esc(c.q || 'Card ' + (i + 1)) + '</div>' +
                '<div class="pli-meta">Livello ' + (c.box || 0) + ' \u00b7 ' +
                (c.yes || 0) + '/' + tot + ' corrette</div>';
            li.addEventListener('click', () => { selIdx = i; renderEditor(); });
            left.appendChild(li);
        });

        /* --- pannello destro: editor --- */
        const rightWrap = App.el('div', 'rip-right');
        right.appendChild(rightWrap);
        renderRight(rightWrap, d);
    }

    function renderRight(wrap, d) {
        wrap.innerHTML = '';

        /* pannello "Genera da appunti" */
        if (genOpen) {
            const gp = App.el('div', 'rip-gen');
            gp.appendChild(App.el('div', 'rip-hint',
                'Seleziona un appunto, un riassunto o un documento e estrai una bozza di coppie ' +
                'domanda/risposta con un\u2019euristica locale. La generazione AI completa \u00e8 ' +
                'rimandata: vedi NOTE.md.'));

            const fSrc = App.el('div', 'field');
            fSrc.innerHTML = '<label>Elemento della Biblioteca</label>';
            const selSrc = App.el('select');
            selSrc.appendChild(opt('', genItems.length ? 'Scegli un elemento\u2026' : 'Nessun elemento disponibile'));
            genItems.forEach(it => {
                selSrc.appendChild(opt(it.id, (it.title || 'Senza titolo') + ' (' + (KIND_LABEL[it.kind] || it.kind) + ')'));
            });
            fSrc.appendChild(selSrc);
            gp.appendChild(fSrc);

            /* R21 B5: fonte scelta per la generazione (precede la Biblioteca) */
            if (genFonte) {
                const chip = App.el('div', 'rip-fp-src');
                chip.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
                    'margin-top:8px;padding:8px 10px;border:1px dashed var(--accent);' +
                    'border-radius:10px;font-size:13px;';
                chip.innerHTML = '<strong>Fonte:</strong> ' + App.esc(genFonte.titolo) +
                    ' (' + App.esc(genFonte.tipo) + ')';
                const bRmF = App.el('button', 'tool-btn');
                bRmF.type = 'button';
                bRmF.textContent = 'Rimuovi fonte';
                bRmF.addEventListener('click', () => { genFonte = null; renderEditor(); });
                chip.appendChild(bRmF);
                gp.appendChild(chip);
            }

            const row = App.el('div', 'rip-gen-actions');
            const bEst = App.el('button', 'btn-accent');
            bEst.type = 'button';
            bEst.textContent = 'Estrai bozza';
            bEst.addEventListener('click', async () => {
                let text = '';
                if (genFonte) {
                    text = genFonte.text || '';
                } else {
                    const id = selSrc.value;
                    if (!id) { alert('Seleziona prima un elemento della Biblioteca.'); return; }
                    try {
                        const it = await StudyStore.getItem(id);
                        if (!it) { alert('Elemento non trovato.'); return; }
                        text = extractText(it.content);
                    } catch (e) {
                        console.error('estrazione bozza:', e);
                        alert('Estrazione non riuscita: vedi console (F12).');
                        return;
                    }
                }
                try {
                    const pairs = estraiCoppie(text);
                    if (!pairs.length) {
                        alert('Nessuna coppia estratta: il testo non contiene frasi utili.');
                        return;
                    }
                    pairs.forEach(p => {
                        const c = newCard(d.color);
                        c.q = p.q;
                        c.a = p.a;
                        d.cards.push(c);
                    });
                    selIdx = Math.max(0, d.cards.length - pairs.length);
                    await saveEditor();
                    renderEditor();
                    toast(pairs.length + ' coppie aggiunte');
                } catch (e) {
                    console.error('estrazione bozza:', e);
                    alert('Estrazione non riuscita: vedi console (F12).');
                }
            });
            /* R21 B5: accesso alle FONTI nel flusso di generazione */
            const bFontiGen = App.el('button', 'btn-secondary');
            bFontiGen.type = 'button';
            bFontiGen.textContent = 'Usa una fonte\u2026';
            bFontiGen.title = 'Porta il testo di una fonte al generatore di flashcard';
            bFontiGen.addEventListener('click', () => toggleFonti('gen', (s, i) => {
                const apply = txt => {
                    genFonte = {
                        titolo: (i && i.titolo) || s.title || 'Fonte',
                        tipo: (i && i.tipo) || 'Fonte',
                        fonteId: (i && i.id != null) ? i.id : ((s && s.id != null) ? s.id : ''),
                        text: txt || ''
                    };
                    destroyFonti();
                    renderEditor();
                    toast('Fonte caricata: ' + genFonte.titolo);
                };
                let t = '';
                try { t = fonteTextsSync(s); } catch (e) { t = ''; }
                if (t) { apply(t); return; }
                fonteTextsAsync(s).then(x => apply(x || '')).catch(() => apply(''));
            }));
            const bChat = App.el('button', 'btn-secondary');
            bChat.type = 'button';
            bChat.textContent = 'Apri nel Chatbot';
            bChat.addEventListener('click', () => App.go('chatbot'));
            row.appendChild(bEst);
            row.appendChild(bFontiGen);
            row.appendChild(bChat);
            gp.appendChild(row);
            wrap.appendChild(gp);
        }

        if (!d.cards.length) {
            wrap.appendChild(App.empty(
                App.ICONS.ripasso,
                'Questo mazzo non ha ancora flashcard: usa il pulsante «+ Aggiungi card» in alto nel pannello sinistro.'));
            return;
        }

        const c = d.cards[selIdx];

        const fQ = App.el('div', 'field');
        fQ.innerHTML = '<label>Domanda</label>';
        const inQ = App.el('input');
        inQ.type = 'text';
        inQ.value = c.q || '';
        inQ.placeholder = 'es. Qual \u00e8 il ruolo del clorofillo?';
        inQ.addEventListener('input', () => { c.q = inQ.value; });
        inQ.addEventListener('change', () => {
            saveEditor();
            const titles = leftTitles();
            if (titles[selIdx]) titles[selIdx].textContent = c.q || 'Card ' + (selIdx + 1);
        });
        fQ.appendChild(inQ);
        wrap.appendChild(fQ);

        const fA = App.el('div', 'field');
        fA.innerHTML = '<label>Risposta</label>';
        const taA = App.el('textarea');
        taA.value = c.a || '';
        taA.placeholder = 'Scrivi la risposta\u2026';
        taA.addEventListener('input', () => { c.a = taA.value; });
        taA.addEventListener('change', () => saveEditor());
        fA.appendChild(taA);
        wrap.appendChild(fA);

        const fStyle = App.el('div', 'form-row');

        const fCol = App.el('div', 'field');
        fCol.innerHTML = '<label>Colore card</label>';
        const inCol = App.el('input', 'color-swatch');
        inCol.type = 'color';
        inCol.value = c.color || d.color || '#8ca4ff';
        inCol.addEventListener('input', () => { c.color = inCol.value; });
        inCol.addEventListener('change', () => saveEditor());
        fCol.appendChild(inCol);

        const fFont = App.el('div', 'field');
        fFont.innerHTML = '<label>Carattere</label>';
        const selFont = App.el('select');
        FONTS.forEach(f => selFont.appendChild(opt(f.v, f.label)));
        selFont.value = c.font || 'system';
        selFont.addEventListener('change', () => { c.font = selFont.value; saveEditor(); });
        fFont.appendChild(selFont);

        fStyle.appendChild(fCol);
        fStyle.appendChild(fFont);
        wrap.appendChild(fStyle);

        const fImg = App.el('div', 'field');
        fImg.innerHTML = '<label>Immagine (facoltativa)</label>';
        const inImg = App.el('input');
        inImg.type = 'file';
        inImg.accept = 'image/*';
        inImg.addEventListener('change', () => {
            const f = inImg.files && inImg.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                c.image = String(r.result || '');
                saveEditor().then(() => renderEditor());
            };
            r.onerror = () => alert('Lettura immagine non riuscita.');
            r.readAsDataURL(f);
        });
        fImg.appendChild(inImg);
        if (c.image) {
            const prev = App.el('img', 'rip-img-preview');
            prev.src = c.image;
            prev.alt = 'Anteprima card';
            fImg.appendChild(prev);
            const bRm = App.el('button', 'tool-btn');
            bRm.type = 'button';
            bRm.textContent = 'Rimuovi immagine';
            bRm.style.marginTop = '8px';
            bRm.addEventListener('click', () => {
                c.image = '';
                saveEditor().then(() => renderEditor());
            });
            fImg.appendChild(bRm);
        }
        wrap.appendChild(fImg);

        /* materia / tag ereditati dal mazzo (sola lettura) */
        const info = App.el('div', 'field');
        info.innerHTML = '<label>Ereditato dal mazzo</label>';
        const infoRow = App.el('div', 'meta');
        infoRow.style.gap = '8px';
        if (d.materia) infoRow.appendChild(App.el('span', 'chip', App.esc(d.materia)));
        if (d.tags) infoRow.appendChild(App.el('span', 'chip', App.esc(d.tags)));
        if (!d.materia && !d.tags) infoRow.appendChild(App.el('span', 'rip-hint', 'Nessuna materia o tag sul mazzo.'));
        info.appendChild(infoRow);
        wrap.appendChild(info);

        /* operazioni sulla card */
        const ops = App.el('div', 'toolbar plain');
        const bUp = App.el('button', 'tool-btn');
        bUp.type = 'button';
        bUp.textContent = '\u2191 Su';
        bUp.disabled = selIdx === 0;
        bUp.addEventListener('click', () => moveCard(selIdx, -1));
        const bDown = App.el('button', 'tool-btn');
        bDown.type = 'button';
        bDown.textContent = '\u2193 Gi\u00f9';
        bDown.disabled = selIdx >= d.cards.length - 1;
        bDown.addEventListener('click', () => moveCard(selIdx, 1));
        const bDup = App.el('button', 'tool-btn');
        bDup.type = 'button';
        bDup.textContent = 'Duplica';
        bDup.addEventListener('click', () => {
            const copy = JSON.parse(JSON.stringify(c));
            copy.id = StudyStore.uuid();
            d.cards.splice(selIdx + 1, 0, copy);
            selIdx = selIdx + 1;
            saveEditor();
            renderEditor();
        });
        const bDel = App.el('button', 'tool-btn');
        bDel.type = 'button';
        bDel.textContent = 'Elimina card';
        bDel.addEventListener('click', () => {
            if (!confirm('Eliminare questa flashcard?')) return;
            d.cards.splice(selIdx, 1);
            if (selIdx >= d.cards.length) selIdx = Math.max(0, d.cards.length - 1);
            saveEditor();
            renderEditor();
        });
        ops.appendChild(bUp);
        ops.appendChild(bDown);
        ops.appendChild(bDup);
        ops.appendChild(bDel);
        wrap.appendChild(ops);
    }

    function leftTitles() {
        return root.querySelectorAll('.pane .pane-list-item .pli-title');
    }

    function moveCard(i, delta) {
        const d = editorDeck;
        const j = i + delta;
        if (!d || j < 0 || j >= d.cards.length) return;
        const t = d.cards[i];
        d.cards[i] = d.cards[j];
        d.cards[j] = t;
        selIdx = j;
        saveEditor();
        renderEditor();
    }

    /* ---------- estrazione euristica (locale, nessun LLM) ---------- */
    function flattenStrings(v, acc) {
        if (typeof v === 'string') acc.push(v);
        else if (Array.isArray(v)) v.forEach(x => flattenStrings(x, acc));
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => flattenStrings(v[k], acc));
        return acc;
    }
    function extractText(raw) {
        const s = String(raw || '');
        try {
            const o = JSON.parse(s);
            if (o && typeof o === 'object') return flattenStrings(o, []).join('\n');
        } catch (e) { /* testo grezzo */ }
        return s;
    }
    function estraiCoppie(text) {
        const out = [];
        const seen = {};
        const push = (q, a) => {
            q = String(q || '').trim();
            a = String(a || '').trim();
            if (!q || !a || a.length < 8 || seen[a]) return;
            seen[a] = 1;
            out.push({ q: /[?]$/.test(q) ? q : q + '?', a: a });
        };

        /* 1) righe del tipo "argomento: spiegazione" */
        String(text).split(/\r?\n/).forEach(line => {
            if (out.length >= 30) return;
            const t = line.replace(/^[#>\-*\s]+/, '').replace(/\*\*/g, '').trim();
            if (t.length < 15) return;
            const c = t.indexOf(':');
            if (c >= 4 && c <= 70 && t.length - c >= 20) push(t.slice(0, c), t.slice(c + 1));
        });

        /* 2) frasi definitive "X è/sono Y" */
        if (out.length < 8) {
            const flat = String(text).replace(/[#*_>`]+/g, ' ').replace(/\s+/g, ' ');
            const sents = flat.match(/[^.!?]+[.!?]+/g) || [];
            const re = /^(.{3,70}?)\s+(?:\u00e8|sono)\s+(.{15,})$/i;
            sents.forEach(s => {
                if (out.length >= 30) return;
                const st = s.trim();
                if (st.length < 25) return;
                const m = st.match(re);
                if (m) {
                    const subj = m[1].trim().replace(/^(il|lo|la|i|gli|le|un|una|uno)\s+/i, '');
                    push('Che cosa \u00e8 ' + subj, st);
                }
            });
        }

        /* 3) fallback: le frasi pi\u00f9 lunghe diventano domande di ripasso */
        if (!out.length) {
            const flat = String(text).replace(/[#*_>`]+/g, ' ').replace(/\s+/g, ' ').trim();
            const sents = (flat.match(/[^.!?]+[.!?]+/g) || [flat])
                .map(s => s.trim()).filter(s => s.length > 20);
            sents.slice(0, 12).forEach((s, i) => push('Ripassa il punto ' + (i + 1), s));
        }
        return out;
    }

    /* ============================================================
       VISTA 4 — modalita studio
       ============================================================ */
    function startStudy(d) {
        destroyFonti();
        if (!d.cards.length) {
            alert('Aggiungi almeno una flashcard prima di avviare lo studio.');
            return;
        }
        const order = d.cards.map((c, i) => i);
        order.sort((a, b) => (d.cards[a].box || 0) - (d.cards[b].box || 0));
        study = { deck: d, order: order, pos: 0, revealed: false, yes: 0, no: 0, finished: false };
        renderStudy();
    }

    function renderStudy() {
        const s = study;
        if (!s) return;
        if (s.finished) { renderSummary(); return; }
        if (s.pos >= s.order.length) { finishStudy(); return; }

        root.innerHTML = '';
        root.appendChild(App.header('Studio: ' + s.deck.title, 'Sessione di ripasso', []));

        const stage = App.el('div', 'study-stage');
        const prog = App.el('div', 'study-progress');
        prog.textContent = (s.pos + 1) + ' / ' + s.order.length;
        stage.appendChild(prog);

        const c = s.deck.cards[s.order[s.pos]];
        const fc = App.el('div', 'flashcard');
        fc.style.fontFamily = fontCss(c.font);
        if (c.color) fc.style.borderTop = '4px solid ' + App.esc(c.color);
        let inner = '<span class="fc-label">' + (s.revealed ? 'Risposta' : 'Domanda') +
            ' \u00b7 livello ' + (c.box || 0) + '</span>';
        inner += '<div style="width:100%"><div style="font-weight:600">' +
            App.esc(c.q || '(domanda vuota)') + '</div>';
        if (s.revealed) {
            inner += '<div class="fc-answer">' + App.esc(c.a || '(risposta vuota)');
            if (c.image) {
                inner += '<div style="text-align:center"><img class="rip-img-preview" src="' +
                    App.esc(c.image) + '" alt=""></div>';
            }
            inner += '</div>';
        } else {
            inner += '<div class="rip-hint" style="margin-top:14px">Clicca sulla card per rivelare la risposta</div>';
        }
        inner += '</div>';
        fc.innerHTML = inner;
        fc.addEventListener('click', () => {
            if (!s.revealed) { s.revealed = true; renderStudy(); }
        });
        stage.appendChild(fc);

        const bar = App.el('div', 'rip-bar');
        bar.appendChild(btn('So', 'btn-accent', !s.revealed, () => answer(true)));
        bar.appendChild(btn('Non so', 'btn-secondary', !s.revealed, () => answer(false)));
        bar.appendChild(btn('Precedente', 'tool-btn', s.pos === 0, () => move(-1)));
        bar.appendChild(btn('Prossima', 'tool-btn', s.pos >= s.order.length - 1, () => move(1)));
        bar.appendChild(btn('Mischia', 'tool-btn', false, shuffleStudy));
        bar.appendChild(btn('Fine sessione', 'btn-outline', false, finishStudy));
        // ---- H11: tutor mode (F04) ----
        bar.appendChild(btn('Valuta con AI', 'tool-btn', !s.lastEval, function () { aiEvaluate(); }));
        stage.appendChild(bar);

        const hint = App.el('div', 'rip-hint',
            'Scorciatoie: Spazio rivela \u00b7 1 = Non so \u00b7 2 = So \u00b7 frecce sinistra/destra');
        stage.appendChild(hint);
        root.appendChild(stage);
    }

    // ---------- H11: tutor mode (F04) — valuta con AI l'ultima risposta ----------
    async function aiEvaluate() {
        const AI = window.AIService;
        const s = study;
        if (!AI || typeof AI.run !== 'function') {
            try { if (typeof notify === 'function') notify('AI non disponibile'); } catch (e) { /* ok */ }
            return;
        }
        if (!s || !s.lastEval) { AI.toast('Rispondi a una card prima'); return; }
        const res = await AI.runFor(null, 'F04', { front: s.lastEval.domanda, back: s.lastEval.risposta, risp: s.lastEval.scelta,
            domanda: s.lastEval.domanda,
            risposta: s.lastEval.risposta,
            scelta_utente: s.lastEval.scelta
        });
        if (!res || res.fallback) return;
        AI.showResult(res);
    }

    function answer(ok) {
        const s = study;
        if (!s || s.finished || !s.revealed) return;
        const c = s.deck.cards[s.order[s.pos]];
        c.seen = (c.seen || 0) + 1;
        c.last = new Date().toISOString();
        if (ok) {
            c.yes = (c.yes || 0) + 1;
            s.yes++;
            c.box = Math.min(5, (c.box || 0) + 1);
        } else {
            c.no = (c.no || 0) + 1;
            s.no++;
            c.box = 0;
        }
        dirty = true;
        s.lastEval = { domanda: c.q || '', risposta: c.a || '', scelta: ok ? 'So' : 'Non so' };
        if (s.pos >= s.order.length - 1) finishStudy();
        else { s.pos++; s.revealed = false; renderStudy(); }
    }

    function move(delta) {
        const s = study;
        if (!s || s.finished) return;
        const n = s.pos + delta;
        if (n < 0 || n >= s.order.length) return;
        s.pos = n;
        s.revealed = false;
        renderStudy();
    }

    function shuffleStudy() {
        const s = study;
        if (!s) return;
        for (let i = s.order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = s.order[i];
            s.order[i] = s.order[j];
            s.order[j] = t;
        }
        s.pos = 0;
        s.revealed = false;
        renderStudy();
    }

    async function finishStudy() {
        const s = study;
        if (!s || s.finished) return;
        s.finished = true;
        try {
            await persistDeck(s.deck);
            dirty = false;
        } catch (e) {
            console.error('salvataggio statistiche:', e);
        }
        renderSummary();
    }

    function renderSummary() {
        const s = study;
        if (!s) { if (root) renderGrid(); return; }
        if (!root) return;
        root.innerHTML = '';
        root.appendChild(App.header('Sessione completata', s.deck.title, []));

        const card = App.el('div', 'card rip-sum');
        card.innerHTML =
            '<h4 style="text-align:center">Riepilogo della sessione</h4>' +
            '<div class="rip-sum-row"><span>So</span><strong>' + s.yes + '</strong></div>' +
            '<div class="rip-sum-row"><span>Non so</span><strong>' + s.no + '</strong></div>' +
            '<div class="rip-sum-row"><span>Card totali</span><strong>' + s.order.length + '</strong></div>' +
            '<div class="rip-hint" style="margin-top:12px;text-align:center">' +
            'Statistiche salvate su ogni card: visto / s\u00ec / no / livello (box 0\u20135).</div>';
        const acts = App.el('div', 'form-actions');
        acts.style.justifyContent = 'center';
        acts.appendChild(btn('Ripeti sessione', 'btn-accent', false, () => startStudy(s.deck)));
        acts.appendChild(btn('Torna ai mazzi', 'btn-secondary', false, async () => {
            study = null;
            editorDeck = null;
            await loadDecks();
            renderGrid();
        }));
        card.appendChild(acts);
        root.appendChild(card);
    }

    /* ---------- scorciatoie tastiera ---------- */
    function onKey(e) {
        if (!study || study.finished) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        if (e.key === ' ') {
            e.preventDefault();
            if (!study.revealed) { study.revealed = true; renderStudy(); }
        } else if (e.key === '1') {
            answer(false);
        } else if (e.key === '2') {
            answer(true);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            move(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            move(1);
        }
    }
    /* keydown globale NON registrato a module-load: fatto in open(), rimosso in close() (niente duplicati) */

    /* ============================================================
       Registrazione modulo
       ============================================================ */
    App.registerModule({
        id: 'ripasso',
        title: 'Ripasso',
        desc: 'Mazzi di flashcard per fissare gli argomenti con sessioni di studio veloci.',
        icon: App.ICONS.ripasso,
        kinds: ['mazzo'],

        async open(container, params) {
            root = container;
            container.innerHTML = '';
            document.removeEventListener('keydown', onKey);
            document.addEventListener('keydown', onKey);
            try { subjects = (await StudyStore.listSubjects()) || []; }
            catch (e) { subjects = []; }
            await loadDecks();
            if (root !== container) return;
            if (params && params.open) {
                const d = decks.find(x => x.id === params.open);
                if (d) { openEditor(d); return; }
            }
            renderGrid();
        },

        close() {
            destroyFonti();
            document.removeEventListener('keydown', onKey);
            if (dirty) {
                const d = editorDeck || (study && study.deck);
                if (d) persistDeck(d).catch(e => console.warn('ripasso close save:', e));
            }
            study = null;
            editorDeck = null;
            genOpen = false;
            root = null;
        },

        async recent() {
            try {
                const items = await StudyStore.listItems('mazzo');
                const n = (items || []).length;
                if (!n) return 'Nessun mazzo';
                let cards = 0;
                (items || []).forEach(it => {
                    try {
                        const c = JSON.parse(it.content || '{}');
                        cards += (c.cards || []).length;
                    } catch (e) { /* skip */ }
                });
                return n + ' mazzi \u00b7 ' + cards + ' flashcard';
            } catch (e) {
                return '';
            }
        }
    });
})();
