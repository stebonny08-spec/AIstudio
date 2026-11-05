    /* ---------- UI: create(opts) ------------------------------------------ */
    const DEFAULT_W = 340, DEFAULT_H = 0.7;   // defaults stile R19 (340px, 70vh)
    function create(opts) {
        opts = opts || {};
        const contesto = opts.contesto || 'appunti';
        const onInsert = typeof opts.onInsert === 'function' ? opts.onInsert : function () { };
        const kW = 'fp21_w_' + contesto, kH = 'fp21_h_' + contesto;
        const kS = 'fp21_search_' + contesto;

        const root = document.createElement('div');
        root.className = 'fp21-root';
        root.setAttribute('data-fp21', contesto);

        const bar = document.createElement('div');
        bar.className = 'fp21-bar';
        const lens = document.createElement('button');
        lens.type = 'button';
        lens.className = 'fp21-lens';
        lens.title = 'Mostra/nascondi ricerca';
        lens.setAttribute('aria-label', 'Mostra/nascondi ricerca');
        lens.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
            'stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/>' +
            '<line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
        const chips = document.createElement('div');
        chips.className = 'fp21-chips';
        ['Tutti', 'Appunti', 'Materiali', 'Libri'].forEach(lbl => {
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'fp21-chip';
            c.textContent = lbl;
            c.setAttribute('data-f', lbl.toLowerCase());
            c.addEventListener('click', () => { st.filter = lbl.toLowerCase(); lsSet('fp21_filter', st.filter); renderList(); syncChips(); });
            chips.appendChild(c);
        });
        bar.appendChild(lens);
        bar.appendChild(chips);
        root.appendChild(bar);

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'fp21-search';
        search.placeholder = 'Cerca fonti...';
        search.setAttribute('aria-label', 'Cerca fonti');
        search.style.display = 'none';   // default COLLAPSATA (2.2)
        root.appendChild(search);
        search.addEventListener('input', () => renderList());

        const list = document.createElement('div');
        list.className = 'fp21-list';
        root.appendChild(list);

        const prev = document.createElement('div');
        prev.className = 'fp21-preview';
        prev.innerHTML = '<div class="fp21-ptitle">Seleziona una fonte per leggerne l anteprima.</div>' +
            '<div class="fp21-pbody"></div>';
        root.appendChild(prev);

        const insert = document.createElement('button');
        insert.type = 'button';
        insert.className = 'fp21-insert';
        insert.textContent = FIELDS[contesto] || 'Inserisci nella nota';
        insert.disabled = true;
        root.appendChild(insert);

        const hR = document.createElement('div'); hR.className = 'fp21-rz fp21-rz-r';
        const hB = document.createElement('div'); hB.className = 'fp21-rz fp21-rz-b';
        const hC = document.createElement('div'); hC.className = 'fp21-rz fp21-rz-c';
        root.appendChild(hR); root.appendChild(hB); root.appendChild(hC);
        let w0 = Number(lsGet(kW, 0)) || Math.min(DEFAULT_W, Math.floor(innerWidth * 0.6));
        let h0 = Number(lsGet(kH, 0)) || Math.min(Math.floor(innerHeight * DEFAULT_H), Math.floor(innerHeight * 0.6));
        const applySize = (w, h) => {
            const maxW = Math.floor(innerWidth * 0.6), maxH = Math.floor(innerHeight * 0.6);
            w = Math.max(240, Math.min(maxW, w));
            h = Math.max(160, Math.min(maxH, h));
            root.style.width = w + 'px';
            root.style.height = h + 'px';
            return { w: w, h: h };
        };
        applySize(w0, h0);
        const startDrag = (e, mode) => {
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY;
            const r = root.getBoundingClientRect();
            const move = ev => {
                const w = r.width + (ev.clientX - sx) * (mode !== 'h' ? 1 : 0);
                const h = r.height + (ev.clientY - sy) * (mode !== 'w' ? 1 : 0);
                const s = applySize(w, h);
                w0 = s.w; h0 = s.h;
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                lsSet(kW, String(w0)); lsSet(kH, String(h0));
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        };
        hR.addEventListener('mousedown', e => startDrag(e, 'w'));
        hB.addEventListener('mousedown', e => startDrag(e, 'h'));
        hC.addEventListener('mousedown', e => startDrag(e, 'c'));
        const reset = () => {
            try { localStorage.removeItem(kW); localStorage.removeItem(kH); } catch (e) { /* ok */ }
            root.style.width = ''; root.style.height = '';
            applySize(Math.min(DEFAULT_W, Math.floor(innerWidth * 0.6)),
                Math.min(Math.floor(innerHeight * DEFAULT_H), Math.floor(innerHeight * 0.6)));
        };
        hR.addEventListener('dblclick', reset);
        hB.addEventListener('dblclick', reset);
        hC.addEventListener('dblclick', reset);

        const st = {
            srcs: [], sel: null, filter: (lsGet('fp21_filter', '') ||
                lsGet('nt_fonti_filter', 'tutti')).toLowerCase(),
            search: lsGet(kS, '0') === '1'
        };
        if (['tutti', 'appunti', 'materiali', 'libri'].indexOf(st.filter) < 0) st.filter = 'tutti';
        const setSearchOpen = open => {
            st.search = !!open;
            search.style.display = open ? '' : 'none';
            lsSet(kS, open ? '1' : '0');
        };
        setSearchOpen(st.search);
        lens.addEventListener('click', () => setSearchOpen(!st.search));

        // __FP_PART3B__
    }
