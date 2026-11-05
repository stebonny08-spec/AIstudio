/* modules/fonti_panel.js - R21: componente UNICO FontiPanel.
   Adattatori di rendering (md+KaTeX vendored, {"html"} sanitizzato, libri
   rag_stage2, immagini/testo) + layout compatto ridimensionabile, montato
   da ogni modulo con { contesto, onInsert }. Self-contained: zero dipendenze
   dai moduli ospiti.

   R22 (FE-FONTI):
   - B1 dock mount flottanti: sotto la toolbar del modulo, z-index sotto i
     controlli della toolbar (tranne Appunti/Schemi: delegati altri);
   - B1.2 riga superiore (lente+chips) collassabile via .fp21-chev, stato in
     localStorage 'fp21_top_<contesto>';
   - B1.3 doppio click sul pannello = reset size (test jsdom dedicato);
   - B2 preview "come scritta": snapshot canvas dei tratti (stroke/shape) con
     cache id+versione (item.updated_at o content.length) + blocchi testo/
     immagine in ordine; vuoto reale solo con "Nessun testo disponibile";
   - B5.2 KaTeX inline: \(...\) e \[...\] oltre a $$...$$ e $...$. */
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

    /* ---------- STILE BASE R22 (regole NUOVE, non sovrascrivono host) ----- */
    function injectBaseStyle() {
        if (typeof document === 'undefined' || !document.head) return;
        try {
            if (document.getElementById('fp21-base-style')) return;
            const s = document.createElement('style');
            s.id = 'fp21-base-style';
            s.textContent =
                '.fp21-top{display:flex;flex-direction:column;gap:6px;min-width:0}' +
                '.fp21-chev{flex:0 0 auto;width:26px;height:26px;border-radius:8px;' +
                'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);' +
                'color:#cfd6e4;cursor:pointer;display:inline-flex;align-items:center;' +
                'justify-content:center;padding:0;font:inherit;margin-left:auto}' +
                '.fp21-root.fp21-collapsed .fp21-chips{display:none!important}' +
                '.fp21-root.fp21-collapsed .fp21-search{display:none!important}' +
                '.fp21-pbody img.fp21-snap{display:block;max-width:100%;border-radius:6px;' +
                'margin:4px 0 6px;background:#f7f5ef;border:1px solid rgba(255,255,255,.12)}';
            document.head.appendChild(s);
        } catch (e) { /* ok */ }
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
        // matematica display \[ ... \] e inline \( ... \) (R22 5.2)
        s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, f) => slot(mathRender(f, true)));
        s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, f) => slot(mathRender(f, false)));
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

    /* ---------- R22 B2: SNAPSHOT tratti manoscritti (canvas offscreen) ----- */
    /* "La nota come e' stata scritta": fit del bbox dei tratti dentro la
       larghezza preview (padding incluso), shape chiuse ridisegnate dai
       params (formati in LETTURA da notes.js drawStroke/drawShape, non
       modificati). Cache in-memory Map per id+versione: versione =
       item.updated_at (store.js) e, in mancanza, content.length.
       ctx==null (jsdom senza canvas) -> fallback su testo/hint, MAI eccezione. */
    const snapCache = new Map();
    const INK_W = 300, INK_H = 210, INK_PAD = 8;
    function inkVersion(src) {
        const raw = (src && src.raw) || {};
        const v = raw.updated_at || raw.modified || raw.version;
        if (v) return String(v);
        return 'len' + String((src && src.content) || '').length;
    }
    /* poligono punta freccia (spec notes.js _headPoly: {base,tangente,...}) */
    function inkHeadPoly(head) {
        if (!head || !head.base || !head.tangente) return null;
        const tx = head.tangente[0], ty = head.tangente[1];
        const n = Math.hypot(tx, ty);
        if (!(n > 0)) return null;
        const ux = tx / n, uy = ty / n, nx = -uy, ny = ux;
        const a = ((head.angoloAlaDeg || 35) * Math.PI) / 180;
        const L = head.lunghezza || 8;
        const w = L * Math.sin(a), d = L * Math.cos(a);
        const bx = head.base[0], by = head.base[1];
        return [[bx + w * nx, by + w * ny], [bx + d * ux, by + d * uy],
                [bx - w * nx, by - w * ny]];
    }
    function inkPath(ctx, pts, size, color) {
        if (!pts || !pts.length) return;
        ctx.strokeStyle = color || '#141414';
        ctx.fillStyle = color || '#141414';
        ctx.lineWidth = size || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], Math.max(0.6, (size || 2) / 2), 0, Math.PI * 2);
            ctx.stroke();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
    }
    function inkDrawShape(ctx, o) {
        const box = o.box || null, pr = o.params || {}, kind = o.kind;
        ctx.save();
        ctx.globalAlpha = (o.alpha !== undefined ? o.alpha : 1);
        ctx.strokeStyle = o.color || '#141414';
        ctx.fillStyle = o.color || '#141414';
        const rotBox = () => {
            if (o.rot && box) {
                const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
                ctx.translate(cx, cy);
                ctx.rotate((o.rot || 0) * Math.PI / 180);
                ctx.translate(-cx, -cy);
            }
        };
        if (kind === 'arrow') {
            if (pr.shaft && pr.shaft.pts && pr.shaft.pts.length >= 2) {
                inkPath(ctx, pr.shaft.pts, o.size, o.color);
            } else if (o.pts && o.pts.length >= 2) {
                inkPath(ctx, o.pts, o.size, o.color);
            }
            const tri = inkHeadPoly(pr.head);
            if (tri) {
                ctx.beginPath();
                ctx.moveTo(tri[0][0], tri[0][1]);
                ctx.lineTo(tri[1][0], tri[1][1]);
                ctx.lineTo(tri[2][0], tri[2][1]);
                ctx.closePath();
                ctx.fill();
            }
        } else if ((kind === 'rectangle' || kind === 'square') && box) {
            rotBox();
            ctx.lineWidth = o.size || 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeRect(box.x, box.y, box.w, box.h);
        } else if ((kind === 'circle' || kind === 'ellipse') && box) {
            ctx.lineWidth = o.size || 2;
            ctx.beginPath();
            ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2,
                Math.max(1, box.w / 2), Math.max(1, box.h / 2), 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (kind === 'triangle' && o.pts && o.pts.length >= 3) {
            ctx.lineWidth = o.size || 2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(o.pts[0][0], o.pts[0][1]);
            for (let i = 1; i < o.pts.length; i++) ctx.lineTo(o.pts[i][0], o.pts[i][1]);
            ctx.closePath();
            ctx.stroke();
        } else if (kind === 'triangle' && box) {
            ctx.lineWidth = o.size || 2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(box.x, box.y + box.h);
            ctx.lineTo(box.x + box.w, box.y + box.h);
            ctx.lineTo(box.x + box.w / 2, box.y);
            ctx.closePath();
            ctx.stroke();
        } else if (o.pts && o.pts.length >= 2) {   // line/curve/generic
            inkPath(ctx, o.pts, o.size, o.color);
        } else if (box) {
            ctx.lineWidth = o.size || 2;
            ctx.strokeRect(box.x, box.y, box.w, box.h);
        }
        ctx.restore();
    }
    function inkBBox(objs) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x, y) => {
            if (!isFinite(x) || !isFinite(y)) return;
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        };
        objs.forEach(o => {
            if (o.box && typeof o.box.x === 'number') {
                add(o.box.x, o.box.y);
                add(o.box.x + (o.box.w || 0), o.box.y + (o.box.h || 0));
            }
            if (Array.isArray(o.pts)) o.pts.forEach(p => {
                if (Array.isArray(p)) add(p[0], p[1]);
            });
            if (o.params && o.params.shaft && Array.isArray(o.params.shaft.pts)) {
                o.params.shaft.pts.forEach(p => { if (Array.isArray(p)) add(p[0], p[1]); });
            }
            if (o.params && o.params.cx !== undefined) {
                const r = (o.params.r || (o.box ? Math.max(o.box.w, o.box.h) / 2 : 10));
                add(o.params.cx - r, o.params.cy - r);
                add(o.params.cx + r, o.params.cy + r);
            }
        });
        if (x0 === Infinity) return null;
        return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    }
    function renderInk21(objs, cacheKey) {
        const out = { html: '', ok: false };
        if (!objs || !objs.length) return out;
        if (cacheKey && snapCache.has(cacheKey)) {
            const hit = snapCache.get(cacheKey);
            if (hit) {
                out.html = '<img class="fp21-snap" alt="Anteprima dei tratti disegnati" src="' + hit + '">';
                out.ok = true;
            }
            return out;
        }
        let canvas = null, ctx = null;
        try {
            canvas = document.createElement('canvas');
            if (typeof canvas.getContext !== 'function') throw new Error('getContext assente');
            const bb = inkBBox(objs);
            if (!bb) return out;
            const s = Math.max(0.05, Math.min((INK_W - 2 * INK_PAD) / bb.w,
                (INK_H - 2 * INK_PAD) / bb.h, 8));
            canvas.width = Math.max(2, Math.round(bb.w * s + 2 * INK_PAD));
            canvas.height = Math.max(2, Math.round(bb.h * s + 2 * INK_PAD));
            ctx = canvas.getContext('2d');
            if (!ctx) return out;                      // jsdom senza canvas
            ctx.save();
            ctx.fillStyle = '#f7f5ef';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.translate(INK_PAD - bb.x * s, INK_PAD - bb.y * s);
            ctx.scale(s, s);
            objs.forEach(o => {
                if (o.t === 'stroke') {
                    try {
                        ctx.save();
                        ctx.globalAlpha = (o.alpha !== undefined ? o.alpha : 1);
                        inkPath(ctx, o.pts, o.size, o.color);
                        ctx.restore();
                    } catch (e) { /* oggetto saltato */ }
                } else if (o.t === 'shape') {
                    try { inkDrawShape(ctx, o); } catch (e) { /* oggetto saltato */ }
                }
            });
            ctx.restore();
            let url = '';
            try { url = canvas.toDataURL('image/png'); } catch (e) { url = ''; }
            if (!url) return out;
            if (cacheKey) snapCache.set(cacheKey, url);
            out.html = '<img class="fp21-snap" alt="Anteprima dei tratti disegnati" src="' + url + '">';
            out.ok = true;
            return out;
        } catch (e) {
            return out;   // fallback su testo/hint - mai eccezione
        }
    }

    /* ---------- estrazione testo da item study (note/riassunto/doc) ------- */
    /* R22 B2: per gli oggetti delle note ritorna {text, images, blocks
       (ordine oggetti), hasInk, ink (snapshot html), inkOk, empty}:
       blocks preserva l'ordine testo/immagine; empty SOLO se la nota e'
       veramente vuota (ne tratti, ne testo, ne immagini). */
    function itemTexts(content, src) {
        const c = String(content == null ? '' : content);
        let o = null;
        try { o = JSON.parse(c); } catch (e) { o = null; }
        if (o && typeof o === 'object') {
            let objs = null;
            if (Array.isArray(o.objects) && o.objects.length) {
                objs = o.objects;
            } else if (Array.isArray(o.pages)) {
                objs = [];
                o.pages.forEach(p => {
                    if (p && Array.isArray(p.objects)) objs = objs.concat(p.objects);
                });
                if (!objs.length && Array.isArray(o.objects)) objs = o.objects;
            } else if (Array.isArray(o.objects)) {
                objs = o.objects;
            }
            if (objs) {
                const inkObjs = objs.filter(x => x && (x.t === 'stroke' || x.t === 'shape'));
                const blocks = [];
                let buf = [];
                let nImg = 0;
                const flush = () => {
                    if (buf.length) { blocks.push({ k: 'text', v: buf.join('\n\n') }); buf = []; }
                };
                objs.forEach(x => {
                    if (!x) return;
                    if (x.t === 'text' && x.text) {
                        const t = String(x.text).replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
                        if (t) { buf.push(t); }
                        return;
                    }
                    flush();
                    if (x.t === 'image' && typeof x.src === 'string' && nImg < 6 &&
                        /^(data:image\/|https?:\/\/)/i.test(x.src)) {
                        blocks.push({ k: 'img', v: x.src });
                        nImg++;
                    }
                });
                flush();
                const texts = blocks.filter(b => b.k === 'text').map(b => b.v);
                const imgs = blocks.filter(b => b.k === 'img')
                    .map(b => '<img class="fp21-thumb" alt="" src="' + esc(b.v) + '">').join('');
                const res = {
                    text: texts.join('\n\n'), images: imgs, blocks: blocks,
                    hasInk: inkObjs.length > 0, ink: '', inkOk: false, empty: false
                };
                if (!texts.length && !nImg && !res.hasInk) { res.empty = true; return res; }
                if (res.hasInk) {
                    const idPart = (src && src.id != null) ? String(src.id) : 'c';
                    const snap = renderInk21(inkObjs, idPart + '|' + inkVersion(src || {}));
                    res.ink = snap.html;
                    res.inkOk = snap.ok;
                }
                return res;
            }
            if (typeof o.html === 'string') {
                return null; // gestito da renderHtmlDoc21
            } else if (Array.isArray(o.nodes)) {
                return { text: o.nodes.map(n => (n && n.text) || '').filter(Boolean).join('\n'), images: '' };
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
    /* R22 5.2: il testo "markdown-like" include anche le FORMULE ($..$,
       $$..$$, \(..\), \[..\]): nessun LaTeX grezzo nel preview nemmeno per
       note con solo testo formule. */
    const MDLIKE_RE = /(^|\n)#{1,6}\s|\*\*|```|^\s*[-*+] |\n\|.+\||\$\$|\\\(|\\\[|\$[^$\n]+\$/;
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
            const ex = itemTexts(src.content, src);
            if (ex) {
                // R22 B2.2: "Nessun testo disponibile" SOLO se veramente vuota
                if (ex.empty && !ex.hasInk) {
                    return { title: src.title || 'Senza titolo', badge: badge, html: '<p>Nessun testo disponibile.</p>' };
                }
                let body;
                const mdLike = MDLIKE_RE;
                if (ex.blocks && ex.blocks.length) {
                    // R22 B2.3: blocchi testo/immagine nell'ORDINE degli oggetti
                    body = ex.blocks.map(b => {
                        if (b.k === 'img') return '<img class="fp21-thumb" alt="" src="' + esc(b.v) + '">';
                        const m = MDLIKE_RE.test(b.v);
                        return m ? renderMarkdown21(b.v) :
                            b.v.split(/\n{2,}|\n/).filter(Boolean).map(p => '<p>' + esc(p) + '</p>').join('');
                    }).join('');
                } else {
                    body = (mdLike.test(ex.text) ? renderMarkdown21(ex.text) :
                        ex.text.split(/\n{2,}|\n/).filter(Boolean).map(p => '<p>' + esc(p) + '</p>').join('')) +
                        ex.images;
                }
                // R22 B2.1: istantanea tratti IN CIMA; ctx assente -> fallback
                // su testo (e hint solo se non c'e' proprio testo)
                let top = ex.ink || '';
                if (ex.hasInk && !ex.inkOk && !body) {
                    top = '<p class="fp21-hint fp21-inkfb">Tratti disegnati a mano: ' +
                        'anteprima canvas non disponibile.</p>';
                }
                return { title: src.title || 'Senza titolo', badge: badge, html: top + body };
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
        const kT = 'fp21_top_' + contesto;    // R22 B1.2: collapso riga superiore

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
        // R22 B1.2: chevron dedicato = collassa la riga superiore a una
        // sola riga di icone (lente+chevron); la LENTE resta il toggle della
        // ricerca (invariato rispetto a R21/f21/a19).
        const chev = document.createElement('button');
        chev.type = 'button';
        chev.className = 'fp21-chev';
        chev.title = 'Comprimi/espandi la riga ricerca+filtri';
        chev.setAttribute('aria-label', 'Comprimi/espandi la riga ricerca+filtri');
        chev.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
            'stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
        bar.appendChild(chev);
        // riga superiore in un contenitore dedicato: i CHIPS stanno in una
        // RIGA PROPRIA (fratella della bar icone, non dentro la bar): quando
        // la riga e' collassata (chips+ricerca nascosti) la .fp21-list
        // guadagna tutta l'altezza della riga chips+ricerca (spec 1.2),
        // a prescindere dalla larghezza del pannello
        const topwrap = document.createElement('div');
        topwrap.className = 'fp21-top';
        topwrap.appendChild(bar);
        topwrap.appendChild(chips);
        root.appendChild(topwrap);

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'fp21-search';
        search.placeholder = 'Cerca fonti...';
        search.setAttribute('aria-label', 'Cerca fonti');
        search.style.display = 'none';   // default COLLAPSATA (2.2)
        topwrap.appendChild(search);
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
        const reset = () => {
            try { localStorage.removeItem(kW); localStorage.removeItem(kH); } catch (e) { /* ok */ }
            root.style.width = ''; root.style.height = '';
            // R22: aggiorna w0/h0 altrimenti il mouseup di un drag ancora
            // aperto riscrive SUBITO la vecchia dimensione in localStorage
            w0 = Math.min(DEFAULT_W, Math.floor(innerWidth * 0.6));
            h0 = Math.min(Math.floor(innerHeight * DEFAULT_H), Math.floor(innerHeight * 0.6));
            applySize(w0, h0);
        };
        // Doppio click sull'handle: il 2o mousedown (detail>=2) resetta
        // SUBITO e non avvia il drag (funziona anche dove l'evento dblclick
        // non viene generato, es. automazione via CDP); dblclick resta per
        // i browser standard (reset idempotente)
        const hDown = (e, mode) => {
            if (e && e.detail >= 2) {
                try { e.preventDefault(); } catch (er) { /* ok */ }
                reset();
                return;
            }
            startDrag(e, mode);
        };
        hR.addEventListener('mousedown', e => hDown(e, 'w'));
        hB.addEventListener('mousedown', e => hDown(e, 'h'));
        hC.addEventListener('mousedown', e => hDown(e, 'c'));
        hR.addEventListener('dblclick', reset);
        hB.addEventListener('dblclick', reset);
        hC.addEventListener('dblclick', reset);
        // R22 B1.3: doppio click sul PANNELLO = reset size (gli handle
        // continuano a funzionare; sui controlli interattivi no, per non
        // azzerare la dimensione con un doppio click su chip/lista/bottoni)
        root.addEventListener('dblclick', e => {
            try {
                const t = e && e.target;
                if (t && t.closest && t.closest('button,input,textarea,select,a')) return;
            } catch (er) { /* ok */ }
            reset();
        });

        const st = {
            srcs: [], sel: null, filter: (lsGet('fp21_filter', '') ||
                lsGet('nt_fonti_filter', 'tutti')).toLowerCase(),
            search: lsGet(kS, '0') === '1',
            topCollapsed: lsGet(kT, '0') === '1'
        };
        if (['tutti', 'appunti', 'materiali', 'libri'].indexOf(st.filter) < 0) st.filter = 'tutti';
        const setSearchOpen = open => {
            st.search = !!open;
            search.style.display = open ? '' : 'none';
            lsSet(kS, open ? '1' : '0');
        };
        setSearchOpen(st.search);
        // R22 B1.2: collapso REALE della riga superiore (chips+ricerca ->
        // una sola riga di icone), stato persistito in fp21_top_<contesto>
        const setCollapsed = c => {
            st.topCollapsed = !!c;
            root.classList.toggle('fp21-collapsed', !!c);
            chev.setAttribute('aria-expanded', c ? 'false' : 'true');
            chev.title = c ? 'Espandi ricerca e filtri' : 'Comprimi/espandi la riga ricerca+filtri';
            lsSet(kT, c ? '1' : '0');
        };
        setCollapsed(st.topCollapsed);
        chev.addEventListener('click', () => setCollapsed(!st.topCollapsed));
        lens.addEventListener('click', () => {
            if (st.topCollapsed) setCollapsed(false);  // aprire la ricerca espande la riga
            setSearchOpen(!st.search);
        });

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

        /* ---------- R22 B1: dock sotto la toolbar (mount flottanti) -------- */
        /* Solo mount FLOTTANTI: Appunti e Schemi sono delegati altri e qui
           NON vengono toccati (zero stili inline su quei root). Per gli altri
           5 contesti: il pannello si allinea SOTTO la toolbar del modulo
           (offset = altezza toolbar + 8px) e usa z-index SOTTO i controlli
           della toolbar dove hanno z esplicito (doc-bar 40/pill 30 -> 20;
           mod-header 6 -> 5). Nei wrapper assoluti (fogli/video) lo stacco
           vale per il WRAPPER e il root resta nel flusso del pannello. */
        const FLOAT_TB = {
            documenti: ['.doc-bar', '.mod-header'],
            presentazioni: ['.pp-bar', '.mod-header'],
            fogli: ['.fg-top', '.mod-header'],
            video: ['.toolbar', '.mod-header'],
            ripasso: ['.toolbar', '.mod-header']
        };
        const FLOAT_Z = { documenti: 20, presentazioni: 5, fogli: 5, video: 5, ripasso: 5 };
        const isFloating = Object.prototype.hasOwnProperty.call(FLOAT_TB, contesto);
        function panelXRange() {
            try {
                const r = root.getBoundingClientRect();
                if (r && r.width > 0) return [r.left, r.right];
            } catch (e) { /* ok */ }
            const w = parseFloat(root.style.width) || 340;
            const vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1024;
            return [Math.max(0, vw - 14 - w), vw - 14];
        }
        function chromeBottom(sels, scope, xr) {
            let maxB = -1;
            (sels || []).forEach(sel => {
                let nodes = [];
                try { nodes = (scope || document).querySelectorAll(sel); } catch (e) { nodes = []; }
                Array.prototype.forEach.call(nodes, el => {
                    let r = null;
                    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
                    if (!r || r.height <= 0 || r.width <= 0) return;
                    if (Math.min(r.right, xr[1]) - Math.max(r.left, xr[0]) <= 0) return;
                    if (r.bottom > maxB) maxB = r.bottom;
                });
            });
            return maxB;
        }
        function fitDock() {
            if (!isFloating) return;
            try {
                const sels = FLOAT_TB[contesto];
                const z = FLOAT_Z[contesto];
                const wrap = root.parentElement;
                const isWrap = !!wrap && wrap !== document.body &&
                    /(^|\s)(fg|vv)-fpwrap(\s|$)/.test(String(wrap.className || ''));
                if (isWrap) {
                    // fogli/video: pannello nel flusso del wrapper laterale,
                    // wrapper staccato sotto la toolbar del modulo
                    root.style.position = 'relative';
                    root.style.top = '';
                    root.style.left = '';
                    root.style.right = '';
                    root.style.zIndex = '';
                    const host = wrap.parentElement;
                    const xr = panelXRange();
                    if (host) {
                        const hr = host.getBoundingClientRect();
                        const inHost = chromeBottom([sels[0]], host, xr);
                        const mb = chromeBottom(sels, null, xr);
                        if (inHost >= 0) {
                            wrap.style.top = Math.round(inHost - hr.top + 8) + 'px';
                        } else if (mb >= 0 && hr.height > 0) {
                            wrap.style.top = Math.round(mb - hr.top + 8) + 'px';
                        }
                    }
                    if (typeof z === 'number') wrap.style.zIndex = String(z);
                    return;
                }
                const xr = panelXRange();
                root.style.position = 'fixed';
                root.style.left = 'auto';
                root.style.right = '14px';
                if (typeof z === 'number') root.style.zIndex = String(z);
                const mb = chromeBottom(sels, null, xr);
                if (mb >= 0) root.style.top = Math.round(mb + 8) + 'px';
            } catch (e) { /* mai eccezione */ }
        }
        const onWinResize = () => fitDock();

        async function refresh() {
            st.srcs = await fetchSources21();
            syncChips();
            renderList();
            try { fitDock(); } catch (e) { /* ok */ }
        }
        refresh();
        if (root.isConnected) { try { fitDock(); } catch (e) { /* ok */ } }
        const dockT1 = setTimeout(() => { try { fitDock(); } catch (e) { /* ok */ } }, 0);
        const dockT2 = setTimeout(() => { try { fitDock(); } catch (e) { /* ok */ } }, 350);
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('resize', onWinResize);
        }

        return {
            el: root,
            refresh: refresh,
            destroy: function () {
                try {
                    clearTimeout(dockT1);
                    clearTimeout(dockT2);
                    if (typeof window !== 'undefined' && window.removeEventListener) {
                        window.removeEventListener('resize', onWinResize);
                    }
                } catch (e) { /* ok */ }
                if (root.parentNode) root.parentNode.removeChild(root);
            }
        };
    }

    try { injectBaseStyle(); } catch (e) { /* ok */ }
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
            itemTexts: itemTexts,
            renderInk21: renderInk21,
            inkCache21: snapCache
        }
    };
})();
