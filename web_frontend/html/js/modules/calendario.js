/* ============================================================
   modules/calendario.js — modulo Calendario.
   - Vista mese (luned\u00ec \u2192 domenica) con griglia 6 settimane
   - Eventi colorati per materia (fallback colore per tipo)
   - Modal evento (nuovo / modifica / elimina) con ricorrenza
   - Legenda materie + gestione materie
   Tutto locale: nessuna rete, nessuna dipendenza esterna.
   ============================================================ */
(function () {
    'use strict';

    /* ---------- costanti ---------- */
    const TIPO_LABEL = {
        verifica: 'Verifica',
        compito: 'Compito',
        studio: 'Studio',
        ripasso: 'Ripasso',
        consegna: 'Consegna',
        promemoria: 'Promemoria'
    };
    const TIPO_COLOR = {
        verifica: '#e05252',
        compito: '#f9974a',
        studio: '#8ca4ff',
        ripasso: '#7fc8a9',
        consegna: '#c9b8e8',
        promemoria: '#ffd98a'
    };
    const KIND_LABEL = {
        note: 'Appunti', schema: 'Schema', riassunto: 'Riassunto', mazzo: 'Mazzo',
        presentazione: 'Presentazione', documento: 'Documento', foglio: 'Foglio',
        video: 'Progetto video', altro: 'Altro'
    };
    const HEAD = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

    /* ---------- stato ---------- */
    let root = null;
    let cursor = null;          // { y, m } (m = 0..11)
    let events = [];
    let subjects = [];
    let linkItems = null;       // cache elementi per il collegamento

    /* ---------- css extra ---------- */
    App.style(
        '.cal-legend { display: flex; gap: 8px; flex-wrap: wrap; align-items: center;' +
        ' margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }' +
        '.cal-legend-label { font-size: 11px; text-transform: uppercase; letter-spacing: .7px;' +
        ' color: var(--muted); font-weight: 700; margin-right: 2px; }' +
        '.cal-more { font-size: 10px; color: var(--muted); font-weight: 700; margin-top: 3px; }' +
        '.cal-hint { font-size: 12.5px; color: var(--muted); line-height: 1.55; }' +
        '.cal-subj-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }' +
        '.cal-subj-row input[type="text"] { flex: 1; min-width: 0; background: var(--dark);' +
        ' border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; color: var(--text);' +
        ' font-size: 13.5px; font-family: inherit; outline: none; }' +
        '.cal-subj-row input[type="text"]:focus { border-color: var(--accent); }' +
        '.cal-mat-dot { width: 11px; height: 11px; border-radius: 50%; flex-shrink: 0;' +
        ' background: var(--muted); display: inline-block; }' +
        '.cal-mat-name { font-size: 13px; color: var(--muted); }'
    );

    /* ---------- util data (calcolo locale) ---------- */
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseISO(s) {
        const p = String(s || '').split('-');
        return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
    }
    function todayIso() { return iso(new Date()); }
    function opt(v, t) {
        const o = App.el('option');
        o.value = v;
        o.textContent = t;
        return o;
    }
    function btn(label, cls, fn) {
        const b = App.el('button', cls || 'tool-btn');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
    }

    function subjectById(id) {
        if (!id) return null;
        for (let i = 0; i < subjects.length; i++) if (subjects[i].id === id) return subjects[i];
        return null;
    }
    function colorOf(ev) {
        const s = subjectById(ev.subject_id);
        if (s && s.color) return s.color;
        return TIPO_COLOR[ev.tipo] || '#8ca4ff';
    }

    /* occorrenza di un evento in un giorno (ricorrenza inclusa) */
    function occursOn(ev, day) {
        if (!ev || !ev.date) return false;
        const base = parseISO(ev.date);
        const rec = ev.ricorrenza || 'nessuna';
        if (rec === 'settimanale') {
            const diff = Math.round((day - base) / 86400000);
            return diff >= 0 && diff % 7 === 0;
        }
        if (rec === 'mensile') {
            return day >= base && day.getDate() === base.getDate();
        }
        return day.getTime() === base.getTime();
    }

    /* prossima occorrenza (per la home) */
    function nextOccurrence(ev, from) {
        if (!ev || !ev.date) return null;
        const base = parseISO(ev.date);
        const rec = ev.ricorrenza || 'nessuna';
        if (rec === 'settimanale') {
            if (base >= from) return iso(base);
            const diff = Math.round((from - base) / 86400000);
            const add = (7 - (diff % 7)) % 7;
            const d = new Date(base.getTime());
            d.setDate(d.getDate() + diff + add);
            return iso(d);
        }
        if (rec === 'mensile') {
            if (base >= from) return iso(base);
            let d = new Date(base.getTime());
            let guard = 0;
            while (d < from && guard < 240) {
                const y = d.getFullYear();
                const mth = d.getMonth() + 1;
                const lastDay = new Date(y, mth + 1, 0).getDate();
                d = new Date(y, mth, Math.min(base.getDate(), lastDay));
                guard++;
            }
            return iso(d);
        }
        return base >= from ? iso(base) : null;
    }

    /* ---------- caricamento ---------- */
    async function reload() {
        try {
            const r = await Promise.all([StudyStore.listEvents(), StudyStore.listSubjects()]);
            events = r[0] || [];
            subjects = r[1] || [];
        } catch (e) {
            console.error('calendario load:', e);
        }
    }
    function ensureLinkItems() {
        if (linkItems) return Promise.resolve(linkItems);
        return StudyStore.listItems('')
            .then(its => { linkItems = its || []; return linkItems; })
            .catch(() => { linkItems = []; return linkItems; });
    }

    /* ============================================================
       RENDER — vista mese
       ============================================================ */
    // ---------- H11: piano di studio (F14) ----------
    async function aiPiano() {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') {
            try { if (typeof notify === 'function') notify('AI non disponibile'); } catch (e) { /* ok */ }
            return;
        }
        const inp = await AI.askInputs('Piano di studio', [
            { name: 'argomento', label: 'Argomento', placeholder: 'es. Rivoluzione Francese' },
            { name: 'giorni', label: 'Giorni', type: 'number', value: 7 }
        ], 'Genera piano');
        if (!inp || !inp.argomento) return;
        const res = await AI.runFor(null, 'F14', { argomento: inp.argomento, giorni: Number(inp.giorni) || 7, gg: Number(inp.giorni) || 7, stats: JSON.stringify({ materie: (typeof subjects !== 'undefined' && subjects) ? subjects.length : 0, eventi: (typeof events !== 'undefined' && events) ? events.length : 0 }), events: JSON.stringify(((typeof events !== 'undefined' && events) ? events : []).slice(0, 30).map(function (e2) { return { title: e2 && e2.title, date: e2 && e2.date, tipo: e2 && e2.tipo }; })) });
        if (!res || res.fallback) return;
        AI.showPreview(res, async function (r) {
            try {
                const d = r && r.data;
                let blocks = [];
                if (Array.isArray(d)) blocks = d;
                else if (d && Array.isArray(d.blocks)) blocks = d.blocks;
                else if (d && Array.isArray(d.items)) blocks = d.items;
                else if (d && Array.isArray(d.piano)) blocks = d.piano;
                if (!blocks.length) { AI.toast('Nessun blocco nel piano'); return; }
                const base = new Date();
                let okc = 0;
                for (let i = 0; i < blocks.length; i++) {
                    const b = blocks[i] || {};
                    let date = b.date || b.giorno || b.data || '';
                    const parts = String(date).split('-');
                    if (parts.length !== 3 || String(parts[0]).length !== 4) {
                        const dd = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
                        date = dd.getFullYear() + '-' + ('0' + (dd.getMonth() + 1)).slice(-2) + '-' + ('0' + dd.getDate()).slice(-2);
                    }
                    const payload = {
                        id: StudyStore.uuid(),
                        title: String(b.title || b.titolo || b.argomento || ('Piano: ' + inp.argomento)).slice(0, 120),
                        date: date,
                        tipo: 'studio',
                        subject_id: '',
                        note: String(b.note || b.dettaglio || b.detail || ''),
                        ricorrenza: 'nessuna',
                        link_kind: '',
                        link_id: ''
                    };
                    try { await StudyStore.saveEvent(payload); okc++; } catch (e) { console.error('saveEvent piano:', e); }
                }
                events = await StudyStore.listEvents() || [];
                render();
                AI.toast(okc ? ('Piano aggiunto: ' + okc + ' blocchi') : 'Salvataggio piano non riuscito');
            } catch (e) { AI.toast('Salvataggio piano non riuscito'); }
        });
    }
    function render() {
        if (!root || !cursor) return;
        root.innerHTML = '';

        const bMat = App.el('button', 'tool-btn');
        bMat.type = 'button';
        bMat.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> Gestisci materie';
        bMat.addEventListener('click', openSubjectsModal);
        root.appendChild(App.header('Calendario', 'Verifiche, compiti e sessioni di studio', [bMat]));

        /* --- toolbar mese --- */
        const tb = App.el('div', 'cal-toolbar');
        const bPrev = btn('\u2190 Prec', 'tool-btn', () => { shiftMonth(-1); });
        const title = App.el('div', 'cal-month',
            new Date(cursor.y, cursor.m, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }));
        const bNext = btn('Succ \u2192', 'tool-btn', () => { shiftMonth(1); });
        const bToday = btn('Oggi', 'tool-btn', () => {
            const n = new Date();
            cursor = { y: n.getFullYear(), m: n.getMonth() };
            render();
        });
        tb.appendChild(bPrev);
        tb.appendChild(title);
        tb.appendChild(bNext);
        tb.appendChild(bToday);
        // ---- H11: piano di studio (F14) ----
        const bPiano = btn('Piano di studio', 'tool-btn', function () { aiPiano(); });
        bPiano.title = 'Genera un piano di studio a blocchi (AI: F14)';
        tb.appendChild(bPiano);
        root.appendChild(tb);

        /* --- intestazione giorni --- */
        const head = App.el('div', 'cal-grid');
        HEAD.forEach(h => head.appendChild(App.el('div', 'cal-head', h)));
        head.style.marginBottom = '6px';
        root.appendChild(head);

        /* --- griglia 6 settimane --- */
        const grid = App.el('div', 'cal-grid');
        const first = new Date(cursor.y, cursor.m, 1);
        const offset = (first.getDay() + 6) % 7;
        const start = new Date(cursor.y, cursor.m, 1 - offset);
        const tIso = todayIso();
        const maxEv = 3;

        for (let i = 0; i < 42; i++) {
            const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const dIso = iso(day);
            const isOther = day.getMonth() !== cursor.m;
            const isToday = dIso === tIso;

            const cell = App.el('div', 'cal-day' + (isOther ? ' other' : '') + (isToday ? ' today' : ''));
            cell.appendChild(App.el('div', 'dnum', String(day.getDate())));

            const occ = [];
            events.forEach(ev => { if (occursOn(ev, day)) occ.push(ev); });

            occ.slice(0, maxEv).forEach(ev => {
                const evEl = App.el('div', 'cal-ev', App.esc(ev.title || '(senza titolo)'));
                evEl.style.background = colorOf(ev);
                evEl.title = (TIPO_LABEL[ev.tipo] || ev.tipo || '') +
                    (ev.ricorrenza && ev.ricorrenza !== 'nessuna' ? ' \u00b7 ' + ev.ricorrenza : '');
                evEl.addEventListener('click', e => {
                    e.stopPropagation();
                    openEventModal(ev, dIso);   /* occorrenza \u2192 modifica evento base */
                });
                cell.appendChild(evEl);
            });
            if (occ.length > maxEv) {
                const more = App.el('div', 'cal-more', '+' + (occ.length - maxEv) + ' altri');
                more.addEventListener('click', e => e.stopPropagation());
                cell.appendChild(more);
            }

            cell.addEventListener('click', () => openEventModal(null, dIso));
            grid.appendChild(cell);
        }
        root.appendChild(grid);

        /* --- legenda --- */
        const legend = App.el('div', 'cal-legend');
        legend.appendChild(App.el('span', 'cal-legend-label', 'Materie'));
        if (!subjects.length) {
            legend.appendChild(App.el('span', 'cal-hint', 'Nessuna materia definita: crea la prima con \u00abGestisci materie\u00bb.'));
        }
        subjects.forEach(s => {
            const c = App.el('span', 'chip');
            c.innerHTML = '<span class="dot" style="background:' + App.esc(s.color || '#8ca4ff') + '"></span>' +
                App.esc(s.name);
            legend.appendChild(c);
        });
        const lbl2 = App.el('span', 'cal-legend-label', 'Tipi');
        lbl2.style.marginLeft = '10px';
        legend.appendChild(lbl2);
        Object.keys(TIPO_LABEL).forEach(k => {
            const c = App.el('span', 'chip');
            c.innerHTML = '<span class="dot" style="background:' + TIPO_COLOR[k] + '"></span>' + TIPO_LABEL[k];
            legend.appendChild(c);
        });
        root.appendChild(legend);
    }

    function shiftMonth(delta) {
        let m = cursor.m + delta;
        let y = cursor.y;
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }
        cursor = { y: y, m: m };
        render();
    }

    /* ============================================================
       MODALE evento
       ============================================================ */
    function openEventModal(ev, dateISO) {
        const isNew = !ev;
        const data = isNew
            ? {
                id: StudyStore.uuid(),
                title: '',
                date: dateISO || todayIso(),
                tipo: 'verifica',
                subject_id: '',
                note: '',
                ricorrenza: 'nessuna',
                link_kind: '',
                link_id: ''
            }
            : Object.assign({}, ev);

        const body = App.el('div', '');

        /* titolo */
        const fT = App.el('div', 'field');
        fT.innerHTML = '<label>Titolo</label>';
        const inT = App.el('input');
        inT.type = 'text';
        inT.value = data.title || '';
        inT.placeholder = 'es. Verifica di biologia';
        fT.appendChild(inT);
        body.appendChild(fT);

        /* data + tipo */
        const row1 = App.el('div', 'form-row');
        const fD = App.el('div', 'field');
        fD.innerHTML = '<label>Data</label>';
        const inD = App.el('input');
        inD.type = 'date';
        inD.value = data.date || todayIso();
        fD.appendChild(inD);
        const fTp = App.el('div', 'field');
        fTp.innerHTML = '<label>Tipo</label>';
        const selTp = App.el('select');
        Object.keys(TIPO_LABEL).forEach(k => selTp.appendChild(opt(k, TIPO_LABEL[k])));
        selTp.value = TIPO_LABEL[data.tipo] ? data.tipo : 'verifica';
        fTp.appendChild(selTp);
        row1.appendChild(fD);
        row1.appendChild(fTp);
        body.appendChild(row1);

        /* materia: campo testuale SubjectInput + dot colorato */
        const curSubj = subjectById(data.subject_id);
        const subjInput = SubjectInput.create({
            id: 'cal_materia',
            label: 'Materia',
            placeholder: 'Inserisci materia\u2026',
            value: curSubj ? curSubj.name : ''
        });
        const fM = App.el('div', 'field');
        fM.appendChild(subjInput);
        const rowM = App.el('div', '');
        rowM.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:6px';
        const dot = App.el('span', 'cal-mat-dot');
        const nameEl = App.el('span', 'cal-mat-name', curSubj ? curSubj.name : '');
        // Voce "Nessuna": selezionabile per indicare nessuna materia
        const btnNess = App.el('button', 'choice');
        btnNess.type = 'button';
        btnNess.textContent = 'Nessuna';
        btnNess.title = 'Nessuna materia';
        btnNess.style.cssText = 'padding:5px 13px;font-size:12.5px;';
        const syncDot = function (nome) {
            const n = SubjectInput.normalize(nome == null ? subjInput.getValue() : nome);
            const s = n ? (subjects.find(function (x) { return SubjectInput.normalize(x.name) === n; }) || null) : null;
            dot.style.background = s && s.color ? s.color : 'var(--muted)';
            nameEl.textContent = n ? (s ? s.name : n) : 'Nessuna materia';
            btnNess.classList.toggle('active', !n);
        };
        btnNess.addEventListener('click', function () {
            subjInput.setValue('');
            const inp = subjInput.getInput();
            try { inp.dispatchEvent(new Event('change')); } catch (e) { /* ok */ }
            syncDot('');
            try { inp.focus(); } catch (e) { /* ok */ }
        });
        subjInput.getInput().addEventListener('change', function () { syncDot(subjInput.getValue()); });
        syncDot();
        rowM.appendChild(dot);
        rowM.appendChild(nameEl);
        rowM.appendChild(btnNess);
        fM.appendChild(rowM);
        body.appendChild(fM);

        /* note */
        const fN = App.el('div', 'field');
        fN.innerHTML = '<label>Note</label>';
        const taN = App.el('textarea');
        taN.value = data.note || '';
        taN.placeholder = 'Dettagli, aula, capitolo\u2026';
        fN.appendChild(taN);
        body.appendChild(fN);

        /* ricorrenza */
        const fR = App.el('div', 'field');
        fR.innerHTML = '<label>Ricorrenza</label>';
        const selR = App.el('select');
        selR.appendChild(opt('nessuna', 'Nessuna'));
        selR.appendChild(opt('settimanale', 'Settimanale'));
        selR.appendChild(opt('mensile', 'Mensile'));
        selR.value = data.ricorrenza || 'nessuna';
        fR.appendChild(selR);
        fR.appendChild(App.el('div', 'hint',
            'Gli eventi ricorrenti compaiono in tutti i giorni coerenti del mese visualizzato.'));
        body.appendChild(fR);

        /* collegamento materiale */
        const fL = App.el('div', 'field');
        fL.innerHTML = '<label>Collegamento materiale (facoltativo)</label>';
        const selL = App.el('select');
        fL.appendChild(selL);
        const chipBox = App.el('div', '');
        chipBox.style.marginTop = '8px';
        fL.appendChild(chipBox);

        function fillLinkOptions(list) {
            const cur = data.link_id || '';
            selL.innerHTML = '';
            selL.appendChild(opt('', 'Nessun collegamento'));
            (list || []).forEach(it => {
                selL.appendChild(opt(it.id,
                    (it.title || 'Senza titolo') + ' (' + (KIND_LABEL[it.kind] || it.kind) + ')'));
            });
            selL.value = cur;
            if (selL.value !== cur) selL.value = '';
        }
        function fillLinkChip() {
            chipBox.innerHTML = '';
            if (!data.link_id) return;
            const item = (linkItems || []).find(i => i.id === data.link_id);
            if (!item) return;
            const c = App.el('button', 'chip');
            c.type = 'button';
            c.style.cursor = 'pointer';
            c.innerHTML = '<span class="dot" style="background:var(--blue)"></span>' +
                App.esc(item.title || 'Elemento') + ' \u2192 apri';
            c.addEventListener('click', () => App.openItem(item.kind, item.id));
            chipBox.appendChild(c);
        }
        selL.addEventListener('change', () => {
            data.link_id = selL.value || '';
            data.link_kind = data.link_id ? 'item' : '';
            fillLinkChip();
        });
        fillLinkOptions(linkItems);
        fillLinkChip();
        ensureLinkItems().then(list => { fillLinkOptions(list); fillLinkChip(); });
        body.appendChild(fL);

        /* --- azioni --- */
        openModal(isNew ? 'Nuovo evento' : 'Modifica evento', body, api => {
            const acts = [];
            if (!isNew) {
                acts.push(btn('Elimina', 'btn-outline', async () => {
                    if (!confirm('Eliminare l\u2019evento \u00ab' + (data.title || '') + '\u00bb?')) return;
                    try {
                        await StudyStore.deleteEvent(data.id);
                        events = await StudyStore.listEvents() || [];
                    } catch (e) { console.error('deleteEvent:', e); }
                    api.close();
                    render();
                }));
            }
            acts.push(btn('Annulla', 'btn-secondary', () => api.close()));
            acts.push(btn('Salva', 'btn-accent', async () => {
                const title = inT.value.trim();
                const date = inD.value;
                if (!title || !date) { alert('Titolo e data sono obbligatori.'); return; }
                const nomeMat = SubjectInput.normalize(subjInput.getValue());
                let s = null;
                if (nomeMat) {
                    try { s = await StudyStore.rememberSubject(nomeMat); } catch (e) { console.error('rememberSubject:', e); s = null; }
                    if (!s || !s.id) s = subjects.find(function (x) { return SubjectInput.normalize(x.name) === nomeMat; }) || null;
                }
                const payload = {
                    id: data.id || StudyStore.uuid(),
                    title: title,
                    date: date,
                    tipo: selTp.value || 'verifica',
                    subject_id: s ? s.id : '',
                    note: taN.value.trim(),
                    ricorrenza: selR.value || 'nessuna',
                    link_kind: data.link_id ? 'item' : '',
                    link_id: data.link_id || ''
                };
                try {
                    await StudyStore.saveEvent(payload);
                    events = await StudyStore.listEvents() || [];
                } catch (e) {
                    console.error('saveEvent:', e);
                    alert('Salvataggio non riuscito: vedi console (F12).');
                    return;
                }
                api.close();
                render();
            }));
            return acts;
        });
    }

    /* ============================================================
       MODALE gestione materie
       ============================================================ */
    function openSubjectsModal() {
        const body = App.el('div', '');

        function draw() {
            body.innerHTML = '';
            if (!subjects.length) {
                body.appendChild(App.el('div', 'cal-hint', 'Nessuna materia: aggiungine una qui sotto.'));
            }
            subjects.forEach(s => {
                const row = App.el('div', 'cal-subj-row');
                const inName = App.el('input');
                inName.type = 'text';
                inName.value = s.name;
                inName.addEventListener('change', async () => {
                    const v = SubjectInput.normalize(inName.value);
                    if (!v) { inName.value = s.name; return; }
                    inName.value = v;
                    await StudyStore.saveSubject({ id: s.id, name: v, color: s.color || '#8ca4ff' });
                    await reload();
                    draw();
                    render();
                });
                const inCol = App.el('input');
                inCol.type = 'color';
                inCol.className = 'color-swatch';
                inCol.value = s.color || '#8ca4ff';
                inCol.addEventListener('change', async () => {
                    await StudyStore.saveSubject({ id: s.id, name: s.name, color: inCol.value });
                    await reload();
                    draw();
                    render();
                });
                const bDel = App.el('button', 'tool-btn');
                bDel.type = 'button';
                bDel.textContent = '\u2715';
                bDel.title = 'Elimina materia';
                bDel.addEventListener('click', async () => {
                    if (!confirm('Eliminare la materia \u00ab' + s.name + '\u00bb?')) return;
                    await StudyStore.deleteSubject(s.id);
                    await reload();
                    draw();
                    render();
                });
                row.appendChild(inName);
                row.appendChild(inCol);
                row.appendChild(bDel);
                body.appendChild(row);
            });

            /* aggiunta */
            const add = App.el('div', '');
            add.style.marginTop = '14px';
            add.style.paddingTop = '12px';
            add.style.borderTop = '1px solid var(--border)';
            add.appendChild(App.el('div', 'cal-legend-label', 'Nuova materia'));
            const row = App.el('div', 'cal-subj-row');
            row.style.marginTop = '8px';
            const inNew = App.el('input');
            inNew.type = 'text';
            inNew.placeholder = 'Nome materia';
            const inNewCol = App.el('input');
            inNewCol.type = 'color';
            inNewCol.className = 'color-swatch';
            inNewCol.value = '#8ca4ff';
            const bAdd = App.el('button', 'btn-accent');
            bAdd.type = 'button';
            bAdd.textContent = 'Aggiungi';
            const doAdd = async () => {
                const v = SubjectInput.normalize(inNew.value);
                if (!v) { alert('Inserisci un nome per la materia.'); return; }
                inNew.value = v;
                try {
                    await StudyStore.saveSubject({ name: v, color: inNewCol.value });
                    await reload();
                    inNew.value = '';
                    draw();
                    render();
                } catch (e) { console.error('saveSubject:', e); }
            };
            bAdd.addEventListener('click', doAdd);
            inNew.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
            row.appendChild(inNew);
            row.appendChild(inNewCol);
            row.appendChild(bAdd);
            add.appendChild(row);
            body.appendChild(add);
        }

        draw();
        openModal('Gestisci materie', body, api => [
            btn('Chiudi', 'btn-secondary', () => api.close())
        ]);
    }

    /* ============================================================
       MODALE base (classi esistenti di index.html)
       ============================================================ */
    function openModal(title, bodyEl, actionsFactory) {
        const ov = App.el('div', 'modal-overlay');
        const m = App.el('div', 'modal');
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
        const acts = App.el('div', 'form-actions');
        (actionsFactory(api) || []).forEach(b => acts.appendChild(b));
        body.appendChild(acts);

        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add('show'));
        return api;
    }

    /* ============================================================
       Registrazione modulo
       ============================================================ */
    App.registerModule({
        id: 'calendario',
        title: 'Calendario',
        desc: 'Verifiche, compiti e sessioni di studio: organizza il tuo mese.',
        icon: App.ICONS.calendario,
        kinds: [],

        async open(container, params) {
            root = container;
            container.innerHTML = '';
            const n = new Date();
            cursor = { y: n.getFullYear(), m: n.getMonth() };
            await reload();
            if (root !== container) return;
            render();
        },

        close() {
            root = null;
        },

        async recent() {
            try {
                const evs = (await StudyStore.listEvents()) || [];
                const from = new Date();
                from.setHours(0, 0, 0, 0);
                let best = null;
                evs.forEach(ev => {
                    const n = nextOccurrence(ev, from);
                    if (n && (!best || n < best.iso)) best = { iso: n, title: ev.title || 'evento' };
                });
                if (!best) return 'Nessun evento in programma';
                return 'Prossimo: ' + best.title + ' (' + App.fmtDate(best.iso) + ')';
            } catch (e) {
                return '';
            }
        }
    });
})();
