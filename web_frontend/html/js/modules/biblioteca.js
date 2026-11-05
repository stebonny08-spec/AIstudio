/* ============================================================
   modules/biblioteca.js — modulo Biblioteca.
   Raccoglie in un\u2019unica vista:
     1) elementi study_items (tutti i kind)
     2) conversazioni chatbot
     3) materiali indicizzati nel chatbot
   Con ricerca, filtri (tipo / materia / tag), ordinamento,
   vista griglia o lista e azioni sugli elementi.
   ============================================================ */
(function () {
    'use strict';

    /* ---------- costanti ---------- */
    const KIND_LABEL = {
        note: 'Appunti',
        schema: 'Schema',
        riassunto: 'Riassunto',
        mazzo: 'Mazzo',
        presentazione: 'Presentazione',
        documento: 'Documento',
        foglio: 'Foglio',
        video: 'Progetto video',
        altro: 'Altro',
        conv: 'Conversazione',
        mat: 'Materiale chatbot'
    };
    const KIND_ICON = {
        note: 'notes',
        schema: 'schemi',
        riassunto: 'schemi',
        mazzo: 'ripasso',
        presentazione: 'produttivita',
        documento: 'produttivita',
        foglio: 'produttivita',
        video: 'produttivita',
        altro: 'biblioteca',
        conv: 'chatbot',
        mat: 'biblioteca'
    };
    const ITEM_KINDS = ['note', 'schema', 'riassunto', 'mazzo', 'presentazione', 'documento', 'foglio', 'video', 'altro'];

    /* ---------- stato ---------- */
    let root = null;
    let subjects = [];
    let items = [];
    let convs = [];
    let mats = [];
    let mode = 'grid';
    let area = 'note';   // area con cartelle attiva: 'note' | 'schema' | 'chat' | 'all'
    let filters = { q: '', tipo: '', materia: '', tag: '', sort: 'updated' };

    /* ---------- css extra ---------- */
    App.style(
        '.bib-thumb { width: 100%; height: 116px; border-radius: 10px; overflow: hidden;' +
        ' border: 1px solid var(--border); margin-bottom: 10px; background: var(--dark); }' +
        '.bib-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }' +
        '.bib-list { display: flex; flex-direction: column; gap: 8px; }' +
        '.bib-list .card { display: flex; gap: 14px; align-items: center; padding: 12px 14px; }' +
        '.bib-list .card .bib-col { min-width: 0; flex: 1; }' +
        '.bib-list .card .bib-thumb { width: 52px; height: 52px; flex-shrink: 0; margin-bottom: 0; }' +
        '.bib-list .card .preview { -webkit-line-clamp: 1; margin-top: 4px; }' +
        '.bib-list .card .card-actions { margin-top: 0; flex-shrink: 0; }' +
        '.bib-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }' +
        '.bib-row-actions { display: flex; gap: 14px; align-items: center; flex-shrink: 0; }'
    );

    /* ---------- util ---------- */
    function opt(v, t) {
        const o = App.el('option');
        o.value = v;
        o.textContent = t;
        return o;
    }
    function actBtn(label, fn, danger) {
        const b = App.el('button', danger ? 'danger' : '');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        return b;
    }
    function chip(text, color) {
        if (!text) return '';
        const dot = color ? '<span class="dot" style="background:' + App.esc(color) + '"></span>' : '';
        return '<span class="chip">' + dot + App.esc(text) + '</span>';
    }
    function subjectColor(name) {
        if (!name) return '';
        for (let i = 0; i < subjects.length; i++) {
            if (subjects[i].name === name) return subjects[i].color;
        }
        return '';
    }
    function thumbSrc(t) {
        if (!t) return '';
        if (/^(data|https?):/i.test(t)) return t;
        try { return StudyStore.assetUrl(t); } catch (e) { return t; }
    }
    function fmtIso(iso) {
        if (!iso) return '';
        try {
            const s = String(iso);
            const d = new Date(s.length > 10 ? s : s + 'T00:00:00');
            if (isNaN(d.getTime())) return s;
            return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) { return iso; }
    }
    function stripMd(s) {
        return String(s || '').replace(/[#*_>`\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function allTags() {
        const set = {};
        items.forEach(it => (it.tags || '').split(',').forEach(t => {
            const x = t.trim();
            if (x) set[x] = 1;
        }));
        return Object.keys(set).sort((a, b) => a.localeCompare(b));
    }

    /* ---------- record unificati ---------- */
    function records() {
        const out = [];
        items.forEach(it => out.push({
            rtype: 'item',
            id: it.id,
            kind: it.kind,
            label: KIND_LABEL[it.kind] || it.kind || 'Elemento',
            icon: KIND_ICON[it.kind] || 'biblioteca',
            title: it.title || 'Senza titolo',
            date: it.updated_at || it.created_at || '',
            materia: it.materia || '',
            tags: it.tags || '',
            description: it.description || '',
            preview: it.preview || stripMd(it.content).slice(0, 180),
            thumbnail: it.thumbnail || '',
            raw: it
        }));
        convs.forEach(c => out.push({
            rtype: 'conv',
            id: c.id,
            kind: 'conv',
            label: KIND_LABEL.conv,
            icon: KIND_ICON.conv,
            title: c.title || 'Conversazione',
            date: c.date || '',
            materia: c.materia || '',
            tags: '',
            description: '',
            preview: stripMd(c.preview).slice(0, 180),
            thumbnail: '',
            n: c.n_messages || 0,
            raw: c
        }));
        mats.forEach(m => out.push({
            rtype: 'mat',
            id: m.path,
            kind: 'mat',
            label: KIND_LABEL.mat,
            icon: KIND_ICON.mat,
            title: m.name || 'materiale',
            date: m.indexed_at || '',
            materia: '',
            tags: '',
            description: '',
            preview: 'Indicizzato il ' + fmtIso(m.indexed_at) + ' \u00b7 nessuna apertura diretta',
            thumbnail: '',
            raw: m
        }));
        return out;
    }

    function filtered() {
        let out = records();
        if (filters.tipo) out = out.filter(r => r.kind === filters.tipo);
        if (filters.materia) out = out.filter(r => r.materia === filters.materia);
        if (filters.tag) {
            out = out.filter(r => (r.tags || '').split(',').map(t => t.trim()).indexOf(filters.tag) >= 0);
        }
        if (filters.q) {
            const q = filters.q.toLowerCase();
            out = out.filter(r =>
                (r.title || '').toLowerCase().indexOf(q) >= 0 ||
                (r.description || '').toLowerCase().indexOf(q) >= 0 ||
                (r.preview || '').toLowerCase().indexOf(q) >= 0);
        }
        return sortRecs(out);
    }

    function sortRecs(out) {
        if (filters.sort === 'name') {
            out.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
        } else if (filters.sort === 'kind') {
            out.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
        } else {
            out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        }
        return out;
    }

    function filtersActive() {
        return !!(filters.q || filters.tipo || filters.materia || filters.tag);
    }

    /* elementi della cartella corrente nell'area scelta
       (note/schemi via study_items.folder_id, conversazioni via conv.folder_id) */
    function areaRecords() {
        if (area === 'chat') {
            const cur = Folders.get('chat');
            return sortRecs(records().filter(function (r) {
                return r.rtype === 'conv' && (r.raw.folder_id || '') === cur;
            }));
        }
        const cur = Folders.get(area);
        return sortRecs(records().filter(function (r) {
            return r.rtype === 'item' && r.kind === area && (r.raw.folder_id || '') === cur;
        }));
    }

    /* ---------- caricamento ---------- */
    async function reload() {
        try {
            const r = await Promise.all([
                StudyStore.listSubjects(),
                StudyStore.listItems(''),
                StudyStore.listConversations(),
                StudyStore.listMaterials()
            ]);
            subjects = r[0] || [];
            items = r[1] || [];
            convs = r[2] || [];
            mats = r[3] || [];
        } catch (e) {
            console.error('biblioteca load:', e);
        }
    }

    /* ---------- apertura ---------- */
    function openRecord(r) {
        if (r.rtype === 'item') {
            App.openItem(r.kind, r.id);
        } else if (r.rtype === 'conv') {
            App.go('chat-session');
            try {
                if (typeof openConversation === 'function') openConversation(r.id);
            } catch (e) { console.warn('openConversation:', e); }
        }
        /* i materiali non hanno azione di apertura */
    }

    /* ---------- azioni ---------- */
    async function renameRec(r) {
        const v = prompt('Nuovo titolo:', r.title);
        if (v == null) return;
        const t = v.trim();
        if (!t) return;
        await StudyStore.renameItem(r.id, t);
        await reload();
        render();
    }
    async function duplicateRec(r) {
        try {
            await StudyStore.duplicateItem(r.id);
        } catch (e) { console.error('duplica:', e); }
        await reload();
        render();
    }
    async function deleteRec(r) {
        if (!confirm('Eliminare \u00ab' + r.title + '\u00bb? L\u2019azione non \u00e8 reversibile.')) return;
        await StudyStore.deleteItem(r.id);
        await reload();
        render();
    }
    // ---------- H11: suggerisci etichette (F15) ----------
    function aiTagsFrom(res) {
        const d = res && res.data;
        let arr = [];
        if (Array.isArray(d)) arr = d;
        else if (d && Array.isArray(d.labels)) arr = d.labels;
        else if (d && Array.isArray(d.tags)) arr = d.tags;
        else if (typeof d === 'string') arr = d.split(',');
        else {
            const txt = (window.AIService && window.AIService.previewText) ? window.AIService.previewText(res) : '';
            if (txt) arr = txt.split(',');
        }
        return arr.map(function (t) {
            let s = String(t == null ? '' : t).trim();
            while (s && '-* '.indexOf(s.charAt(0)) >= 0) s = s.slice(1).trim();
            return s;
        }).filter(Boolean);
    }
    async function aiSuggestTags(r) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') {
            try { if (typeof notify === 'function') notify('AI non disponibile'); } catch (e) { /* ok */ }
            return;
        }
        if (!r || !r.raw) { AI.toast('Seleziona un materiale'); return; }
        const res = await AI.runFor(null, 'F15', { vocab: r.raw.tags || r.tags || '', testo: String(r.raw.content || r.raw.description || '').slice(0, 4000),
            titolo: r.raw.title || r.title || '',
            descrizione: r.raw.description || '',
            materia: r.raw.materia || '',
            tags_esistenti: r.raw.tags || r.tags || ''
        });
        if (!res || res.fallback) return;
        AI.showPreview(res, async function (rr) {
            try {
                const nuove = aiTagsFrom(rr);
                if (!nuove.length) { AI.toast('Nessuna etichetta proposta'); return; }
                const old = String(r.raw.tags || r.tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
                const merged = old.slice();
                nuove.forEach(function (t) { if (merged.indexOf(t) < 0) merged.push(t); });
                await StudyStore.saveItem({
                    id: r.raw.id,
                    kind: r.raw.kind,
                    title: r.raw.title,
                    content: r.raw.content || '',
                    materia: r.raw.materia || '',
                    tags: merged.join(','),
                    description: r.raw.description || '',
                    thumbnail: r.raw.thumbnail || ''
                });
                await reload();
                render();
                AI.toast('Etichette aggiornate');
            } catch (e) { AI.toast('Salvataggio etichette non riuscito'); }
        });
    }
    // ---------- G6 (round12): F02 — genera mazzo da materiale+sezione ----------
    // Prima: funzione "zombie" nel registry senza trigger UI. Ora cablata sui
    // record rtype 'mat' della Biblioteca. approval_required per F02 (scrittore):
    // NESSUNA scrittura automatica — solo preview [Accetta]/[Scarta] + toast,
    // esattamente come F01 in notes/documenti.
    async function aiDeckFromMaterial(r) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') {
            try { if (typeof notify === 'function') notify('AI non disponibile'); } catch (e) { /* ok */ }
            return;
        }
        if (!r || !r.raw) { AI.toast('Seleziona un materiale'); return; }
        // TUTTI i placeholder del template F02: materia, doc_id, sezione, n, testo
        const testo = String(r.raw.content || r.raw.description || r.preview || r.title || '').slice(0, 4000);
        if (!testo.trim()) { AI.toast('Materiale senza testo indicizzato'); return; }
        const res = await AI.runFor(null, 'F02', {
            materia: r.raw.materia || r.materia || filters.materia || 'Generale',
            doc_id: String(r.raw.path || r.raw.id || r.id || ''),
            sezione: String(r.raw.sezione || r.raw.section || r.title || 'materiale'),
            n: 4,
            testo: testo
        });
        if (!res || res.fallback) return;
        AI.showPreview(res, function () {
            AI.toast('Mazzo approvato — salva in Ripasso dal pannello Ripasso');
        });
    }
    async function editTags(r) {
        const v = prompt('Tag separati da virgola:', r.tags || '');
        if (v == null) return;
        await StudyStore.saveItem({
            id: r.raw.id,
            kind: r.raw.kind,
            title: r.raw.title,
            content: r.raw.content || '',
            materia: r.raw.materia || '',
            tags: v.split(',').map(t => t.trim()).filter(Boolean).join(','),
            description: r.raw.description || '',
            thumbnail: r.raw.thumbnail || ''
        });
        await reload();
        render();
    }
    async function editDesc(r) {
        const v = prompt('Descrizione:', r.raw.description || '');
        if (v == null) return;
        await StudyStore.saveItem({
            id: r.raw.id,
            kind: r.raw.kind,
            title: r.raw.title,
            content: r.raw.content || '',
            materia: r.raw.materia || '',
            tags: r.raw.tags || '',
            description: v,
            thumbnail: r.raw.thumbnail || ''
        });
        await reload();
        render();
    }
    function editMateria(r) {
        const wrap = buildMateriaField(r.raw.materia || '');
        openModal('Assegna materia', wrap, actions => {
            const sel = wrap._sel;
            const save = App.el('button', 'btn-accent');
            save.type = 'button';
            save.textContent = 'Salva';
            save.addEventListener('click', async () => {
                await StudyStore.saveItem({
                    id: r.raw.id,
                    kind: r.raw.kind,
                    title: r.raw.title,
                    content: r.raw.content || '',
                    materia: sel.value || '',
                    tags: r.raw.tags || '',
                    description: r.raw.description || '',
                    thumbnail: r.raw.thumbnail || ''
                });
                actions.close();
                await reload();
                render();
            });
            const cancel = App.el('button', 'btn-secondary');
            cancel.type = 'button';
            cancel.textContent = 'Annulla';
            cancel.addEventListener('click', actions.close);
            return [cancel, save];
        });
    }
    function buildMateriaField(current) {
        const wrap = App.el('div', '');
        const f = App.el('div', 'field');
        f.innerHTML = '<label>Materia</label>';
        const sel = App.el('select');
        sel.appendChild(opt('', 'Nessuna materia'));
        subjects.forEach(s => sel.appendChild(opt(s.name, s.name)));
        if (current && subjects.every(s => s.name !== current)) sel.appendChild(opt(current, current + ' (attuale)'));
        sel.value = current || '';
        f.appendChild(sel);
        wrap.appendChild(f);
        wrap._sel = sel;
        return wrap;
    }

    /* ---------- modal base (riutilizza le classi di index.html) ---------- */
    function openModal(title, bodyEl, actionsFactory, cls) {
        const ov = App.el('div', 'modal-overlay');
        const m = App.el('div', 'modal' + (cls || ''));
        const head = App.el('div', 'modal-header');
        head.appendChild(App.el('div', 'modal-title', App.esc(title)));
        const closeBtn = App.el('button', 'tool-btn');
        closeBtn.type = 'button';
        closeBtn.textContent = '\u2715';
        head.appendChild(closeBtn);
        m.appendChild(head);

        const body = App.el('div', 'modal-body');
        body.appendChild(bodyEl);
        m.appendChild(body);
        ov.appendChild(m);

        function close() {
            ov.classList.remove('show');
            document.removeEventListener('keydown', onEsc);
            setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 260);
        }
        function onEsc(e) { if (e.key === 'Escape') close(); }
        closeBtn.addEventListener('click', close);
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        document.addEventListener('keydown', onEsc);

        const api = { close: close };
        const btns = actionsFactory(api) || [];
        const acts = App.el('div', 'form-actions');
        btns.forEach(b => acts.appendChild(b));
        body.appendChild(acts);

        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add('show'));
        return api;
    }

    /* ---------- rendering ---------- */
    function render() {
        root.innerHTML = '';

        const toggle = App.el('button', 'tool-btn');
        toggle.type = 'button';
        toggle.innerHTML = mode === 'grid'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg> Lista'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Griglia';
        toggle.addEventListener('click', () => {
            mode = mode === 'grid' ? 'list' : 'grid';
            render();
        });

        const sub = items.length + ' elementi \u00b7 ' + convs.length + ' conversazioni \u00b7 ' + mats.length + ' materiali';
        root.appendChild(App.header('Biblioteca', sub, [toggle]));

        /* --- filtri --- */
        const bar = App.el('div', 'toolbar plain');
        const selArea = App.el('select', 'mini');
        selArea.setAttribute('aria-label', 'Area con cartelle');
        selArea.appendChild(opt('note', 'Area: Appunti'));
        selArea.appendChild(opt('schema', 'Area: Schemi'));
        selArea.appendChild(opt('chat', 'Area: Conversazioni'));
        selArea.appendChild(opt('all', 'Tutti (elenco piano)'));
        selArea.value = area;
        selArea.addEventListener('change', () => { area = selArea.value; render(); });
        bar.appendChild(selArea);
        const search = App.el('input', 'search-input');
        search.type = 'search';
        search.placeholder = 'Cerca in biblioteca\u2026';
        search.value = filters.q;
        search.addEventListener('input', () => { filters.q = search.value; renderBody(); });
        bar.appendChild(search);

        const selTipo = App.el('select', 'mini');
        selTipo.appendChild(opt('', 'Tutti i tipi'));
        ITEM_KINDS.forEach(k => selTipo.appendChild(opt(k, KIND_LABEL[k])));
        selTipo.appendChild(opt('conv', KIND_LABEL.conv));
        selTipo.appendChild(opt('mat', KIND_LABEL.mat));
        selTipo.value = filters.tipo;
        selTipo.addEventListener('change', () => { filters.tipo = selTipo.value; renderBody(); });
        bar.appendChild(selTipo);

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

        const selSort = App.el('select', 'mini');
        selSort.appendChild(opt('updated', 'Ordina: data modifica'));
        selSort.appendChild(opt('name', 'Ordina: nome'));
        selSort.appendChild(opt('kind', 'Ordina: tipo'));
        selSort.value = filters.sort;
        selSort.addEventListener('change', () => { filters.sort = selSort.value; renderBody(); });
        bar.appendChild(selSort);

        const reset = App.el('button', 'tool-btn');
        reset.type = 'button';
        reset.textContent = 'Azzera filtri';
        reset.addEventListener('click', () => {
            filters = { q: '', tipo: '', materia: '', tag: '', sort: 'updated' };
            render();
        });
        bar.appendChild(reset);
        root.appendChild(bar);

        const body = App.el('div', '');
        root.appendChild(body);
        renderBody();

        function renderBody() {
            body.innerHTML = '';

            function drawFlat(list, emptyMsg) {
                if (!list.length) {
                    body.appendChild(App.empty(App.ICONS.biblioteca, emptyMsg));
                    return;
                }
                const cont = App.el('div', mode === 'grid' ? 'grid-cards' : 'bib-list');
                list.forEach(r => cont.appendChild(recCard(r)));
                body.appendChild(cont);
            }

            /* ricerca o filtri attivi -> risultati piatti (nessun elemento perso) */
            if (filtersActive()) {
                drawFlat(filtered(), 'Nessun risultato con i filtri scelti.');
                return;
            }

            /* "Tutti (elenco piano)" -> elenco piatto di tutto, senza cartelle */
            if (area === 'all') {
                drawFlat(filtered(), 'La biblioteca \u00e8 vuota: crea appunti, schemi o conversazioni.');
                return;
            }

            /* vista CARTELLE: barra con breadcrumb + griglia cartelle dell'area
               + elementi della cartella corrente (radice = senza folder_id) */
            const onNav = function () { render(); };
            body.appendChild(Folders.bar(area, onNav));
            body.appendChild(Folders.grid(area, onNav));

            const list = areaRecords();
            const AREA_NAME = { note: 'Appunti', schema: 'Schemi', chat: 'Conversazioni' };
            const label = AREA_NAME[area] || 'Area';
            const sect = App.el('div', null, '');
            sect.style.cssText = 'font-size:12px;font-weight:800;letter-spacing:.5px;' +
                'text-transform:uppercase;color:var(--muted);margin:14px 0 8px';
            body.appendChild(sect);
            Folders.list(area).then(function (fs) {
                sect.textContent = label + ' \u00b7 ' + Folders.nameOf(fs, Folders.get(area)) +
                    ' \u00b7 ' + list.length + ' elementi';
            }).catch(function () {
                sect.textContent = label + ' \u00b7 ' + list.length + ' elementi';
            });

            if (!list.length) {
                body.appendChild(App.empty(
                    App.ICONS.biblioteca,
                    'Cartella vuota: nessun elemento qui. Usa \u00abNuova cartella\u00bb in alto per crearne una oppure torna all\u2019elenco principale.'));
                return;
            }
            const cont = App.el('div', mode === 'grid' ? 'grid-cards' : 'bib-list');
            list.forEach(r => cont.appendChild(recCard(r)));
            body.appendChild(cont);
        }
    }

    function recCard(r) {
        const card = App.el('div', 'card' + (r.rtype === 'mat' ? '' : ' clickable'));
        if (r.rtype !== 'mat') card.tabIndex = 0;

        const thumb = r.thumbnail
            ? '<div class="bib-thumb"><img src="' + App.esc(thumbSrc(r.thumbnail)) + '" alt=""></div>'
            : '<div class="icon-tile ' + (r.rtype === 'conv' ? 'blue' : '') + '">' +
              (App.ICONS[r.icon] || App.ICONS.biblioteca) + '</div>';

        const tagsHtml = r.tags
            ? '<div class="bib-tags">' + r.tags.split(',')
                .map(t => t.trim()).filter(Boolean)
                .map(t => '<span class="chip">' + App.esc(t) + '</span>').join('') + '</div>'
            : '';

        card.innerHTML =
            (r.thumbnail ? thumb : '<div style="margin-bottom:10px">' + thumb + '</div>') +
            '<div class="bib-col">' +
                '<h4>' + App.esc(r.title) + '</h4>' +
                '<div class="meta">' +
                    '<span>' + App.esc(r.label) + '</span>' +
                    (r.date ? '<span>' + App.esc(fmtIso(r.date)) + '</span>' : '') +
                    (r.n ? '<span>\u00b7 ' + r.n + ' messaggi</span>' : '') +
                    (r.materia ? chip(r.materia, subjectColor(r.materia)) : '') +
                '</div>' +
                tagsHtml +
                (r.description || r.preview
                    ? '<div class="preview">' + App.esc(r.description || r.preview) + '</div>'
                    : '') +
            '</div>';

        const actions = App.el('div', 'card-actions');
        if (r.rtype === 'item') {
            actions.appendChild(actBtn('Apri', () => openRecord(r)));
            actions.appendChild(actBtn('Rinomina', () => renameRec(r)));
            actions.appendChild(actBtn('Duplica', () => duplicateRec(r)));
            actions.appendChild(actBtn('Tag', () => editTags(r)));
            actions.appendChild(actBtn('AI etichette', () => aiSuggestTags(r)));
            actions.appendChild(actBtn('Materia', () => editMateria(r)));
            actions.appendChild(actBtn('Descr.', () => editDesc(r)));
            actions.appendChild(actBtn('Elimina', () => deleteRec(r), true));
        } else if (r.rtype === 'conv') {
            actions.appendChild(actBtn('Apri', () => openRecord(r)));
            actions.appendChild(actBtn('Elimina', async () => {
                if (!confirm('Eliminare la conversazione \u00ab' + r.title + '\u00bb?')) return;
                await StudyStore.deleteConversation(r.id);
                await reload();
                render();
            }, true));
        } else if (r.rtype === 'mat') {
            // G6 (round12): F02 cablata — genera mazzo dal materiale+sezione
            actions.appendChild(actBtn('AI mazzo', () => aiDeckFromMaterial(r)));
        }
        if (actions.children.length) card.appendChild(actions);

        if (r.rtype !== 'mat') {
            card.addEventListener('click', e => {
                if (e.target.closest('.card-actions')) return;
                openRecord(r);
            });
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter') openRecord(r);
            });
        } else {
            card.style.opacity = '.85';
        }
        return card;
    }

    /* ============================================================
       Registrazione modulo
       ============================================================ */
    App.registerModule({
        id: 'biblioteca',
        title: 'Biblioteca',
        desc: 'Tutti i tuoi elaborati e materiali in un unico posto, con ricerca e filtri.',
        icon: App.ICONS.biblioteca,
        kinds: [],

        async open(container, params) {
            root = container;
            container.innerHTML = '';
            await reload();
            if (root !== container) return;
            render();
            /* params.open: se la navigazione arriva da qui con un id, non serve fare nulla
               (l\u2019elemento resta visibile nella griglia); la gestione \u00e8 nei moduli destinatari. */
        },

        close() {
            /* nessuna risorsa da rilasciare */
        },

        async recent() {
            try {
                const r = await Promise.all([
                    StudyStore.listItems(''),
                    StudyStore.listConversations(),
                    StudyStore.listMaterials()
                ]);
                const n = (r[0] || []).length;
                const c = (r[1] || []).length;
                const m = (r[2] || []).length;
                return n + ' elementi \u00b7 ' + c + ' conversazioni \u00b7 ' + m + ' materiali';
            } catch (e) {
                return '';
            }
        }
    });
})();
