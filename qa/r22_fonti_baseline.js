/* modules/fonti_panel.js - R21: componente UNICO FontiPanel.
   Adattatori di rendering (md+KaTeX vendored, {"html"} sanitizzato, libri
   rag_stage2, immagini/testo) + layout compatto ridimensionabile, montato
   da ogni modulo con { contesto, onInsert }. Self-contained: zero dipendenze
   dai moduli ospiti. */
(function () {
    'use strict';

    const FIELDS = {  // label inserimento per contesto (2.5)
        appunti: 'Inserisci nella nota',
        schemi: "Inserisci nello schema",
        documenti: 'Inserisci nel documento',
        presentazioni: 'Inserisci nella diapositiva',
        fogli: 'Inserisci nel foglio',
        video: 'Inserisci nel video',
        ripasso: 'Inserisci nel deck'
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function lsGet(k, d) {
        try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
    }
    function lsSet(k, v) {
        try { localStorage.setItem(k, v); } catch (e) { /* ok */ }
    }

    /* ---------- MATEMATICA: KaTeX vendored (window.katex) + fallback ------- */
    /* Fallback (katex assente o parse fallito): badge "formula non
       renderizzabile" + formula in monospace RIPULITA: via $ e via backslash
       dei comandi (\text -> text): MAI \text o $$ come testo nel flusso. */
    function mathFallback(src, display) {
        const clean = String(src).replace(/\$/g, '')
            .replace(/\\([a-zA-Z]+)/g, '$1')
            .replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();
        return '<span class="fp21-mathfb' + (display ? ' fp21-mathfb-block' : '') + '">' +
            '<span class="fp21-badge">formula non renderizzabile</span>' +
            '<code>' + esc(clean) + '</code></span>';
    }
    function mathRender(src, display) {
        if (typeof window !== 'undefined' && window.katex &&
            typeof window.katex.renderToString === 'function') {
            try {
                return '<span class="fp21-math">' + window.katex.renderToString(String(src).trim(), {
                    displayMode: !!display, throwOnError: false,
                    output: 'html', strict: false, trust: false
                }) + '</span>';
            } catch (e) { /* fallback sotto */ }
        }
        return mathFallback(src, display);
    }

    /* ---------- inline md: bold, italic, code, link ----------------------- */
    function mdInline(t) {
        let x = esc(t);
        x = x.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
        x = x.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        x = x.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        x = x.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) =>
            (/^(https?:|data:|#|mailto:)/i.test(url) || true)
                ? '<a href="' + esc(url) + '" rel="noopener">' + txt + '</a>' : txt);
        return x;
    }

    /* ---------- RENDER MARKDOWN COMPLETO + MATEMATICA (1.1) --------------- */
    function renderMarkdown21(text) {
        const src0 = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
        if (!src0.trim()) return '<p>Nessun testo leggibile.</p>';
        const slots = [];
        const slot = html => { slots.push(html); return '\u0000S' + (slots.length - 1) + '\u0000'; };
        let s = src0;
        // blocchi codice ``` (protetti per primi)
        s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) =>
            slot('<pre class="fp21-pre"><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') +
                '>' + esc(code.replace(/\n$/, '')) + '</code></pre>'));
        // matematica display $$...$$
        s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => slot(mathRender(f, true)));
        // matematica inline $...$ (almeno1 char, no spazi subito)
        s = s.replace(/(^|[^$])\$([^$\n][^$\n]*?)\$/g, (m, pre, f) => pre + slot(mathRender(f, false)));
        // tabelle |...|
        s = s.replace(/(?:^\|.+\|\n?)+/gm, block => {
            const rows = block.trim().split('\n')
                .filter(r => /^\s*\|.*\|\s*$/.test(r))
                .map(r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
            if (rows.length < 2) return block;
            const head = rows[0];
            const isSep = Array.isArray(rows[1]) && rows[1].length > 0 && rows[1].every(c => /^:?-{2,}:?$/.test(c));
            const body = rows.slice(isSep ? 2 : 1);
            let h = '<table class="fp21-table"><thead><tr>' +
                head.map(c => '<th>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>';
            body.forEach(r => { h += '<tr>' + r.map(c => '<td>' + mdInline(c) + '</td>').join('') + '</tr>'; });
            return slot(h + '</tbody></table>');
        });
        // riga per riga
        const out = [];
        let listU = false, listO = false, quote = false;
        const closeLists = () => {
            if (listU) { out.push('</ul>'); listU = false; }
            if (listO) { out.push('</ol>'); listO = false; }
        };
        const closeQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };
        s.split('\n').forEach(line => {
            const t = line;
            if (!t.trim()) { closeLists(); closeQuote(); return; }
            if (/^\u0000S\d+\u0000$/.test(t.trim())) { closeLists(); closeQuote(); out.push(t.trim()); return; }
            const h = /^(#{1,6})\s+(.*)$/.exec(t);
            if (h) {
                closeLists(); closeQuote();
                out.push('<h' + h[1].length + ' class="fp21-h' + h[1].length + '">' +
                    mdInline(h[2]) + '</h' + h[1].length + '>');
                return;
            }
            if (/^\s*(-{3,}|\*{3,})\s*$/.test(t)) { closeLists(); closeQuote(); out.push('<hr>'); return; }
            if (/^>\s?/.test(t)) {
                closeLists();
                if (!quote) { out.push('<blockquote>'); quote = true; }
                out.push('<p>' + mdInline(t.replace(/^>\s?/, '')) + '</p>');
                return;
            }
            closeQuote();
            if (/^\s*[-*+]\s+/.test(t)) {
                if (listO) { out.push('</ol>'); listO = false; }
                if (!listU) { out.push('<ul>'); listU = true; }
                out.push('<li>' + mdInline(t.replace(/^\s*[-*+]\s+/, '')) + '</li>');
                return;
            }
            if (/^\s*\d+[.)]\s+/.test(t)) {
                if (listU) { out.push('</ul>'); listU = false; }
                if (!listO) { out.push('<ol>'); listO = true; }
                out.push('<li>' + mdInline(t.replace(/^\s*\d+[.)]\s+/, '')) + '</li>');
                return;
            }
            closeLists();
            out.push('<p>' + mdInline(t) + '</p>');
        });
        closeLists(); closeQuote();
        let html = out.join('');
        html = html.replace(/\u0000S(\d+)\u0000/g, (m, i) => slots[Number(i)] || '');
        return html;
    }

    /* ---------- SANITIZE {"html"} con allowlist (1.2) ---------------------- */
    const ALLOWED_TAGS = ('p br table tr td th blockquote div span b i u ul ol li ' +
        'h1 h2 h3 h4 h5 h6 img').split(' ');
    function sanitizeHtml(html) {
        let doc;
        try {
            doc = new DOMParser().parseFromString(String(html), 'text/html');
        } catch (e) { return '<p>' + esc(String(html)) + '</p>'; }
        const walk = node => {
            const kids = Array.prototype.slice.call(node.childNodes);
            kids.forEach(ch => {
                if (ch.nodeType === 1) {
                    const tag = (ch.tagName || '').toLowerCase();
                    if (tag === 'script' || tag === 'style' || tag === 'iframe' ||
                        tag === 'object' || tag === 'embed' || tag === 'link') {
                        ch.parentNode.removeChild(ch);
                        return;
                    }
                    // strip attributi on* / href javascript / src non-locali
                    Array.prototype.slice.call(ch.attributes || []).forEach(a => {
                        const n = (a.name || '').toLowerCase();
                        if (n.indexOf('on') === 0 || n === 'style' || n === 'class' || n === 'id') {
                            ch.removeAttribute(a.name);
                        }
                    });
                    if (tag === 'img') {
                        const src = ch.getAttribute('src') || '';
                        const okSrc = /^(data:image\/)/i.test(src) ||
                            (/^https?:/i.test(src) === false && /^[^:]+$/.test(src) && src.length > 0);
                        // img SOLO locali (data:) - http(s) rimosso, relativi ok
                        if (!/^(data:image\/)/i.test(src) && (/^https?:/i.test(src) || /^javascript:/i.test(src) || !src)) {
                            ch.parentNode.removeChild(ch);
                            return;
                        }
                        void okSrc;
                    }
                    if (ALLOWED_TAGS.indexOf(tag) < 0) {
                        // unwrap: conserva i figli, toglie il tag
                        const parent = ch.parentNode;
                        while (ch.firstChild) parent.insertBefore(ch.firstChild, ch);
                        parent.removeChild(ch);
                        return;
                    }
                    walk(ch);
                } else if (ch.nodeType === 8) { // comment
                    ch.parentNode.removeChild(ch);
                }
            });
        };
        walk(doc.body || doc.documentElement);
        return (doc.body ? doc.body.innerHTML : '');
    }
    /* {"html":...} -> {html, title} oppure null (1.2). Mai mostrare la
       stringa '{"html' o tag grezzi come testo. */
    function renderHtmlDoc21(content) {
        let o = null;
        try { o = JSON.parse(String(content)); } catch (e) { o = null; }
        if (!o || typeof o.html !== 'string') return null;
        const html = sanitizeHtml(o.html);
        let title = '';
        try {
            const d = new DOMParser().parseFromString(o.html, 'text/html');
            const h = d.querySelector('h1,h2,h3,h4,h5,h6');
            title = h ? (h.textContent || '').trim() : '';
        } catch (e) { /* ok */ }
        return { html: html, title: title };
    }

    /* ---------- estrazione testo da item study (note/riassunto/doc) ------- */
    function itemTexts(content) {
        const c = String(content == null ? '' : content);
        let o = null;
        try { o = JSON.parse(c); } catch (e) { o = null; }
        if (o && typeof o === 'object') {
            if (Array.isArray(o.objects)) {
                const texts = o.objects.filter(x => x && x.t === 'text' && x.text)
                    .map(x => String(x.text).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
                const imgs = o.objects.filter(x => x && x.t === 'image' && typeof x.src === 'string'
                    && /^(data:image\/|https?:\/\/)/i.test(x.src)).slice(0, 6)
                    .map(x => '<img class="fp21-thumb" alt="" src="' + esc(x.src) + '">').join('');
                if (texts.length || imgs) return { text: texts.join('\n\n'), images: imgs };
            } else if (Array.isArray(o.nodes)) {
                return { text: o.nodes.map(n => (n && n.text) || '').filter(Boolean).join('\n'), images: '' };
            } else if (typeof o.html === 'string') {
                return null; // gestito da renderHtmlDoc21
            } else if (typeof o.text === 'string' && o.text.trim()) {
                return { text: o.text, images: '' };
            } else if (typeof o.riassunto === 'string' && o.riassunto.trim()) {
                return { text: o.riassunto, images: '' };
            }
        }
        const t = c.replace(/\s+/g, ' ').trim();
        return t ? { text: t.length > 4000 ? t.slice(0, 4000) + ' â€¦' : t, images: '' } : null;
    }

    async function readMat(path) {
        try {
            if (typeof window !== 'undefined' && window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.read_material_text === 'function') {
                return await window.pywebview.api.read_material_text(path);
            }
        } catch (e) { /* ok */ }
        return null;
    }
    function matKindLabel(path) {
        return /preselected_books/i.test(String(path || '')) ? 'Libro' : 'Materiale';
    }

    /* ---------- PREVIEW per sorgente (1.1-1.4) ---------------------------- */
    /* ritorna Promise<{title, badge, html}> - preview VISIVA, mai codice
       crudo, mai metadati/percorsi. */
    async function previewFonte21(src) {
        if (!src) return { title: '', badge: '', html: '<p>Nessuna fonte selezionata.</p>' };
        const badge = src.kind === 'mat' ? matKindLabel(src.path) :
            ({ note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento' }[src.kind] || 'Fonte');
        // 1.2 {"html"}
        if (src.kind !== 'mat') {
            const hd = renderHtmlDoc21(src.content);
            if (hd) return { title: src.title || hd.title || 'Senza titolo', badge: badge, html: hd.html };
            const ex = itemTexts(src.content);
            if (ex) {
                const mdLike = /(^|\n)#{1,6}\s|\*\*|```|^\s*[-*+] |\n\|.+\|/.test(ex.text);
                const body = mdLike ? renderMarkdown21(ex.text) :
                    ex.text.split(/\n{2,}|\n/).filter(Boolean).map(p => '<p>' + esc(p) + '</p>').join('');
                return { title: src.title || 'Senza titolo', badge: badge, html: body + ex.images };
            }
            return { title: src.title || 'Senza titolo', badge: badge, html: '<p>Nessun testo disponibile.</p>' };
        }
        // mat: libri/materiali via read_material_text
        const r = src.path ? await readMat(src.path) : null;
        if (r && r.success && typeof r.text === 'string' && r.text) {
            const isMd = /\.(md|markdown)$/i.test(String(src.path || '')) ||
                r.kind === 'md' || r.kind === 'markdown';
            const title = src.title || (r.name ? String(r.name).replace(/\.[^.]+$/, '') : 'Materiale');
            if (isMd) return { title: title, badge: badge, html: renderMarkdown21(r.text) };
            const paras = r.text.split(/\n{2,}/).filter(Boolean).slice(0, 200)
                .map(p => '<p>' + esc(String(p).replace(/\n/g, ' ').trim()) + '</p>').join('');
            return { title: title, badge: badge, html: paras || '<p>Testo vuoto.</p>' };
        }
        // immagine: thumbnail + nome (1.4)
        if (src.path && /\.(png|jpe?g|gif|webp|bmp)$/i.test(src.path)) {
            return {
                title: src.title || 'Immagine', badge: badge,
                html: '<div class="fp21-imgwrap"><img class="fp21-thumb fp21-big" alt="' +
                    esc(src.title || '') + '" src="' + esc(src.path) + '"></div>'
            };
        }
        return {
            title: src.title || 'Materiale', badge: badge,
            html: '<p class="fp21-hint">Nessun testo raggiungibile per questa fonte.</p>'
        };
    }

    /* ---------- PROVIDER sorgenti (1.3: libri DEVONO comparire) ------------ */
    async function fetchSources21() {
        const out = [];
        let items = [];
        try { items = await window.StudyStore.listItems('') || []; } catch (e) { items = []; }
        items.forEach(it => {
            if (['note', 'riassunto', 'documento'].indexOf(it.kind) >= 0) {
                out.push({
                    key: 'it:' + it.id, kind: it.kind, id: it.id,
                    title: it.title || 'Senza titolo', materia: it.materia || '',
                    path: '', content: it.content, raw: it
                });
            }
        });
        let mats = [];
        try {
            mats = (typeof window.StudyStore.listMaterials === 'function')
                ? (await window.StudyStore.listMaterials() || []) : [];
        } catch (e) { mats = []; }
        mats.forEach(m => {
            const p = m.path || m.name || '';
            out.push({
                key: 'mat:' + p, kind: 'mat', id: p,
                title: m.name || m.title || 'Materiale', materia: m.materia || '',
                path: p, content: null, raw: m
            });
        });
        return out; // "Nessuna fonte disponibile" solo se out.length===0
    }

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
