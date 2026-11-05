        function syncChips() {
            Array.prototype.forEach.call(chips.querySelectorAll('.fp21-chip'), c =>
                c.classList.toggle('active', c.getAttribute('data-f') === st.filter));
        }
        function filtered() {
            const q = (search.value || '').trim().toLowerCase();
            return st.srcs.filter(s => {
                if (st.filter === 'appunti' && s.kind === 'mat') return false;
                if (st.filter === 'libri' && !(s.kind === 'mat' && matKindLabel(s.path) === 'Libro')) return false;
                if (st.filter === 'materiali' && !(s.kind === 'mat' && matKindLabel(s.path) !== 'Libro')) return false;
                if (!q) return true;
                const badge = s.kind === 'mat' ? matKindLabel(s.path) : (s.kind || '');
                return (s.title || '').toLowerCase().indexOf(q) >= 0 ||
                    badge.toLowerCase().indexOf(q) >= 0 ||
                    (s.materia || '').toLowerCase().indexOf(q) >= 0;
            });
        }
        function renderList() {
            list.innerHTML = '';
            const srcs = filtered();
            if (!srcs.length) {
                const h = document.createElement('div');
                h.className = 'fp21-hint';
                h.textContent = (st.srcs.length === 0)
                    ? 'Nessuna fonte disponibile.'
                    : 'Nessuna fonte corrisponde alla ricerca.';
                list.appendChild(h);
                return;
            }
            srcs.forEach(s => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'fp21-item' + (st.sel && st.sel.key === s.key ? ' active' : '');
                const badge = document.createElement('span');
                badge.className = 'fp21-badge';
                badge.textContent = s.kind === 'mat' ? matKindLabel(s.path) :
                    ({ note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento' }[s.kind] || 'Fonte');
                const ttl = document.createElement('span');
                ttl.className = 'fp21-ititle';
                ttl.textContent = s.title || 'Senza titolo';
                b.appendChild(badge);
                b.appendChild(ttl);
                b.addEventListener('click', () => select(s));
                list.appendChild(b);
            });
        }
        let selSeq = 0;
        function select(s) {
            st.sel = s;
            renderList();
            const my = ++selSeq;
            const pt = prev.querySelector('.fp21-ptitle');
            const pb = prev.querySelector('.fp21-pbody');
            pt.textContent = 'Caricamento...';
            pb.innerHTML = '';
            previewFonte21(s).then(res => {
                if (my !== selSeq) return;
                pt.textContent = res.title || s.title || 'Senza titolo';
                const bd = document.createElement('span');
                bd.className = 'fp21-badge fp21-ptbadge';
                bd.textContent = res.badge || '';
                pt.appendChild(bd);
                pb.innerHTML = res.html;
                insert.disabled = false;
            });
        }
        insert.addEventListener('click', () => {
            if (!st.sel) return;
            const s = st.sel;
            onInsert(s, {
                tipo: s.kind === 'mat' ? matKindLabel(s.path) :
                    ({ note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento' }[s.kind] || 'Fonte'),
                titolo: s.title, id: s.id, contesto: contesto
            });
        });

        async function refresh() {
            st.srcs = await fetchSources21();
            syncChips();
            renderList();
        }
        refresh();

        return {
            el: root,
            refresh: refresh,
            destroy: function () {
                if (root.parentNode) root.parentNode.removeChild(root);
            }
        };
    }

    window.FontiPanel = {
        create: create,
        adapters: {
            renderMarkdown21: renderMarkdown21,
            renderHtmlDoc21: renderHtmlDoc21,
            sanitizeHtml: sanitizeHtml,
            mathRender: mathRender,
            mathFallback: mathFallback,
            previewFonte21: previewFonte21,
            fetchSources21: fetchSources21,
            matKindLabel: matKindLabel,
            itemTexts: itemTexts
        }
    };
})();
