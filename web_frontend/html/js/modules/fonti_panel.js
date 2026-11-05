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
    /* R27 B7.8: i log di errore devono esserci sull'APP REALE (dove servono
       a diagnosticare preview vuote/corrotte), mai nei test jsdom (lì i
       fallback aspettati sono silenziosi per design delle suite T1). */
    function fpLog() {
        try {
            if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return;
            console.error.apply(console, arguments);
        } catch (e) { /* ok */ }
    }
    /* R30 L3.3: contatore ResizeObserver attivi (1 per istanza pannello con
       RO costruito) - il QA reale lo confronta prima/dopo per i leak */
    if (typeof window !== 'undefined') {
        window.FP21_RO = window.FP21_RO || { active: 0 };
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
                /* R24 R1.3/R1.4: min-height fa da "contenitore fisso" per il
                   fill verticale (la .fp21-list flex:1 assorbe lo spazio e
                   il collapso della riga ricerca GUADAGNA px in lista);
                   altezza totale resta auto-contenuto (nessun 169px vuoti).
                   Escluso schemi (mount scoped .sc-side, delegato altro) */
                '.fp21-root:not([data-fp21="schemi"]){min-height:300px}' +
                /* R30 L2.1/L1.3: OGNI immagine della preview al max della
                   larghezza del contenitore; la snapshot manoscritta riempie
                   la larghezza disponibile (height:auto + max-height:100% con
                   object-fit:contain e centratura) - niente dimensioni fisse */
                '.fp21-root .fp21-pb.fp21-pb img{max-width:100%;height:auto}' +
                '.fp21-root .fp21-pb.fp21-pb img.fp21-snap{display:block;width:100%;' +
                'max-width:100%;height:auto;max-height:100%;object-fit:contain;' +
                'object-position:center;margin:6px auto;background:#f7f5ef;' +
                'border:1px solid rgba(255,255,255,.12);border-radius:6px}' +
                /* R28: viewer "come se fosse aperto" dentro la preview */
                '.fp21-filerow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;' +
                'background:#202637;border:1px solid #2a3142;color:#cfd6e4;border-radius:9px;' +
                'padding:8px 10px;margin:6px 0;cursor:pointer;font:inherit;font-size:12.5px;}' +
                '.fp21-filerow:hover{border-color:#f9974a}' +
                '.fp21-filerow .fp21-fileico{flex:0 0 auto;opacity:.85}' +
                '.fp21-filerow .fp21-filemeta{color:#8b95a5;font-size:11px;margin-left:auto}' +
                '.fp21-bub{max-width:92%;padding:7px 10px;border-radius:12px;margin:5px 0;' +
                'font-size:12.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word;}' +
                '.fp21-bub p{margin:3px 0}' +
                '.fp21-bub.me{margin-left:auto;background:rgba(249,151,74,.18);' +
                'border:1px solid rgba(249,151,74,.45);color:#f7e6d5}' +
                '.fp21-bub.ai{background:#202637;border:1px solid #2a3142;color:#dfe5f0}' +
                '.fp21-chatmeta{font-size:10.5px;color:#8b95a5;letter-spacing:.4px;' +
                'text-transform:uppercase;margin:2px 0 6px}' +
                '.fp21-slide{background:#f7f5ef;color:#141824;border-radius:8px;padding:10px 12px;' +
                'margin:7px 0;box-shadow:0 4px 14px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.14)}' +
                '.fp21-slide .fp21-slide-n{font-size:10px;font-weight:800;letter-spacing:.6px;' +
                'color:#8a8f98;text-transform:uppercase}' +
                '.fp21-slide .fp21-slide-t{font-size:15px;font-weight:800;margin:3px 0 5px}' +
                '.fp21-slide .fp21-slide-b{font-size:12.5px;white-space:pre-wrap;line-height:1.45}' +
                '.fp21-slide .fp21-slide-notes{font-size:11px;color:#5c6577;border-top:1px dashed ' +
                'rgba(0,0,0,.2);margin-top:7px;padding-top:5px;white-space:pre-wrap}' +
                /* R30 L2.2: tabella al100% della larghezza, scroll SOLO qui
                   dentro per colonne eccedenti (sticky header dentro il
                   proprio scroll); altezza in min-max (%), niente px */
                '.fp21-root .fp21-pb .fp21-gridwrap{overflow:auto;max-height:100%;' +
                'width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.14);' +
                'border-radius:8px;background:#f7f5ef;margin:6px 0}' +
                '.fp21-grid{border-collapse:collapse;font-size:11.5px;width:100%;color:#1a1f2e}' +
                '.fp21-grid th,.fp21-grid td{border:1px solid rgba(26,31,46,.16);padding:3px 5px;' +
                'white-space:nowrap;max-width:28ch;overflow:hidden;text-overflow:ellipsis}' +
                '.fp21-grid th{background:#e9e6dd;font-weight:700;position:sticky;top:0}' +
                '.fp21-grid td.fp21-rowh{background:#e9e6dd;font-weight:700;color:#4b5563}' +
                '.fp21-tabs{display:flex;gap:5px;flex-wrap:wrap;margin:5px 0}' +
                '.fp21-tab{font-size:11px;padding:3px 9px;border-radius:999px;background:#202637;' +
                'border:1px solid #2a3142;color:#cfd6e4}' +
                '.fp21-tab.active{background:rgba(249,151,74,.16);border-color:#f9974a;color:#ffd9b3}' +
                '.fp21-clip{display:flex;align-items:center;gap:7px;padding:5px 8px;margin:4px 0;' +
                'background:#202637;border:1px solid #2a3142;border-radius:9px;font-size:12px;' +
                'color:#dfe5f0;overflow:hidden}' +
                '.fp21-clip .fp21-clipk{flex:0 0 auto;font-size:10px;font-weight:800;letter-spacing:.5px;' +
                'text-transform:uppercase;color:#f9974a}' +
                '.fp21-clip .fp21-clipt{flex:0 0 auto;font-variant-numeric:tabular-nums;color:#8b95a5;' +
                'font-size:11px}' +
                '.fp21-clip .fp21-clipn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
                '.fp21-clip img{width:16%;max-width:20%;height:auto;aspect-ratio:16/9;' +
                'object-fit:cover;border-radius:5px;flex:0 0 auto}' +
                '.fp21-media{width:100%;max-width:100%;max-height:100%;object-fit:contain;' +
                'border-radius:8px;background:#000;' +
                'border:1px solid rgba(255,255,255,.14);display:block;margin:6px auto;' +
                'box-sizing:border-box}' +
                'iframe.fp21-doc{width:100%;max-width:100%;aspect-ratio:1/1.35;' +
                'border:1px solid rgba(255,255,255,.16);' +
                'border-radius:8px;background:#fff;margin:6px 0;box-sizing:border-box}' +
                '.fp21-pdftext{max-height:50vh;overflow:auto;font-size:12px;color:#cfd6e4;' +
                'background:#161a2a;border:1px solid #2a3142;border-radius:8px;padding:8px 10px;' +
                'white-space:pre-wrap;margin:6px 0}' +
                '.fp21-docblk{margin:4px 0}' +
                '.fp21-docblk.h{font-weight:800;font-size:14px;margin-top:9px;color:#ffd9b3}' +
                '.fp21-docblk.h2{font-size:13px;color:#e8ecf4}' +
                '.fp21-svgwrap{background:#f7f5ef;border:1px solid rgba(255,255,255,.14);' +
                'border-radius:8px;padding:5px;margin:6px 0;overflow:hidden}' +
                '.fp21-svgwrap svg{display:block;width:100%;height:auto;max-height:80vh}' +
                '.fp21-schemelist{font-size:12px;color:#cfd6e4;margin:5px 0;padding-left:16px}' +
                /* R28: la preview puo' essere lunga (chat/documenti/slide):
                   scorre SENZA far crescere il pannello a tutta l'altezza */
                '.fp21-root .fp21-pbody{max-height:46vh;overflow:auto}' +
                /* R30 L1.1/L1.2: STRUTTURA preview = colonna con titolo fisso
                   + AREA CONTENUTO (.fp21-pb) flex:1 overflow:auto. Le classi
                   fp21-pv/fp21-pb hanno specificita' (0,3,0): vincono sugli
                   host (es. documenti preview max-height:38vh/overflow:auto) */
                '.fp21-root .fp21-preview.fp21-pv{display:flex;flex-direction:column;' +
                'min-height:0;max-height:none;overflow:hidden;flex:1 1 auto}' +
                '.fp21-root .fp21-pbody.fp21-pb{flex:1 1 auto;min-height:0;' +
                'max-height:none;overflow:auto}' +
                /* R30 L2.3/L2.4: il contenuto NON sfora mai l'area: lo scroll
                   orizzontale vive solo in wrapper interni (gridwrap/math/pre) */
                '.fp21-root .fp21-pb.fp21-pb>*{max-width:100%;box-sizing:border-box}' +
                '.fp21-root .fp21-pb.fp21-pb p,.fp21-root .fp21-pb.fp21-pb li,' +
                '.fp21-root .fp21-pb.fp21-pb td{overflow-wrap:anywhere}' +
                '.fp21-root .fp21-pb.fp21-pb .fp21-math{display:inline-block;' +
                'max-width:100%;overflow-x:auto;vertical-align:middle}' +
                '.fp21-root .fp21-pb.fp21-pb .fp21-pre{max-width:100%;overflow-x:auto}' +
                '.fp21-root .fp21-pb.fp21-pb .fp21-mathfb code{white-space:pre-wrap;' +
                'word-break:break-word;max-width:100%}' +
                /* R30 L2.4: ROOT UNIFORME dell'adattatore: ogni tipo (testo,
                   html, tabella, media...) passa da un wrapper blocco al100%
                   della larghezza dell'area contenuto */
                '.fp21-root .fp21-pb .fp21-aroot{display:block;width:100%;' +
                'max-width:100%;box-sizing:border-box}' +
                '.fp21-root .fp21-preview details summary{cursor:pointer}' +
                '.fp21-root .fp21-preview details[open] summary{margin-bottom:4px}' +
                /* R27 B2: collasso = RIGA2 (chip) + RIGA3 (lista) nascoste,
                   RIGA1 resta barra sottile (lente + chevron RUOTATO) e la
                   preview si espande; B3: altezza esterna invariata (pin
                   JS su .fp21-root height) */
                '.fp21-root.fp21-collapsed .fp21-list{display:none!important}' +
                '.fp21-chev svg{transition:transform .18s ease}' +
                '.fp21-root.fp21-collapsed .fp21-chev svg{transform:rotate(180deg)}' +
                '.fp21-root.fp21-collapsed .fp21-preview{min-height:0;max-height:none!important}' +
                '.fp21-root.fp21-collapsed .fp21-pbody{max-height:none!important}' +
                /* R27 B7.2: tabella fogli - numeri a destra, prima riga
                   (riga 1 dei dati) in grassetto come intestazione */
                '.fp21-grid td.fp21-num{text-align:right;font-variant-numeric:tabular-nums}' +
                '.fp21-grid tr.fp21-hrow>td{font-weight:700;background:#f1eee6}' +
                /* R27 B1 - ROOT CAUSE REALE: in index.html presentazioni.js e
                   documenti.js (script DOPO notes.js) iniettano
                   `.fp21-root{...display:flex...}` GLOBALE: a parita' di
                   specificita' vinceva su `.fp21-root{display:none}` di notes
                   e il pannello Appunti restava SEMPRE visibile (chiusura ed
                   Esc senza effetto, recorder sempre "aperto"). L'AUTORITA'
                   di visibilita' del mount appunti diventa la classe .show
                   del suo host: !important vince su ogni cascata; gli altri
                   mount (on-demand, senza .show) restano invariati. */
                '.fp21-root[data-fp21="appunti"]:not(.show){display:none!important}' +
                '.fp21-root[data-fp21="appunti"].show{display:flex!important}';
            document.head.appendChild(s);
        } catch (e) { /* ok */ }
    }

    /* ---------- MATEMATICA: KaTeX vendored (window.katex) + fallback ------- */
    /* Fallback (katex assente o parse fallito): badge "formula non
       renderizzabile" + formula in monospace RIPULITA: via $ e via backslash
       dei comandi (\text -> text): MAI \text o $$ come testo nel flusso. */
    function mathFallback(src, display) {
        /* R27 B8.1: monospace PULITO - prima si estrae il contenuto di
           \text{...} (niente parola "text"), poi via $ e via backslash dei
           comandi: MAI \Delta \text $$ come testo grezzo nel flusso. */
        const clean = String(src)
            .replace(/\\text\s*\{([^{}]*)\}/g, '$1')
            .replace(/\\mathrm\s*\{([^{}]*)\}/g, '$1')
            .replace(/\$/g, '')
            .replace(/\\([a-zA-Z]+)/g, '$1')
            .replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();
        return '<span class="fp21-mathfb' + (display ? ' fp21-mathfb-block' : '') + '">' +
            '<span class="fp21-badge">formula non renderizzabile</span>' +
            '<code>' + esc(clean) + '</code></span>';
    }
    /* R27 B8.1: varianti sanificate da provare in ordine quando KaTeX
       fallisce il parse (es. \Delta G^\circ' con apice primo, parentesi
       troncate dalla cattura inline, graffi squilibrati). */
    function mathVariants(s) {
        const v = [s];
        const open = (s.match(/\(/g) || []).length;
        const close = (s.match(/\)/g) || []).length;
        if (open > close) v.push(s + ')'.repeat(Math.min(open - close, 4)));
        if (close > open) v.push('('.repeat(Math.min(close - open, 4)) + s);
        v.push(s.replace(/['\u2019\u02BC]/g, ''));                       // prime omessi
        v.push(s.replace(/(['\u2019\u02BC])/g, '\\prime'));              // prime -> \prime
        const ob = (s.match(/\{/g) || []).length;
        const cb = (s.match(/\}/g) || []).length;
        if (ob !== cb) v.push(s.replace(/[{}]/g, ''));                    // graffi squilibrati
        v.push('\\text{' + s.replace(/[{}$\\]/g, '') + '}');             // avvolge in \text{}
        return v.filter((x, i) => v.indexOf(x) === i);
    }
    function mathRender(src, display) {
        const raw = String(src == null ? '' : src).trim();
        if (typeof window !== 'undefined' && window.katex &&
            typeof window.katex.renderToString === 'function') {
            /* throwOnError:true: un nodo katex-error (rosso col LaTeX grezzo)
               NON deve MAI arrivare in DOM - se cade si provano le varianti
               e in ultimo il fallback monospace pulito. */
            const variants = mathVariants(raw);
            for (let i = 0; i < variants.length; i++) {
                try {
                    const html = window.katex.renderToString(variants[i], {
                        displayMode: !!display, throwOnError: true,
                        output: 'html', strict: false, trust: false
                    });
                    if (html && html.indexOf('katex-error') < 0) {
                        return '<span class="fp21-math">' + html + '</span>';
                    }
                } catch (e) { /* prossima variante */ }
            }
            fpLog('[fp21] KaTeX ha rifiutato tutte le varianti:', raw.slice(0, 120));
        }
        return mathFallback(raw, display);
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
    /* R30 L3.1: l'img espone la risoluzione del canvas sorgente
       (data-cw/data-ch/data-dpr) per le misure del QA reale */
    function snapImgTag(url, cw, ch, dpr) {
        return '<img class="fp21-snap" alt="Anteprima dei tratti disegnati"' +
            (cw ? ' data-cw="' + cw + '" data-ch="' + ch + '" data-dpr="' +
                (dpr || 1) + '"' : '') +
            ' src="' + url + '">';
    }
    /* R30 L1.2/L2.1: render ADATTIVO. Con box (area contenuto reale) il
       canvas viene RIGENERATO alla risoluzione del container (fit contain
       x devicePixelRatio): niente piu' bitmap a dimensione naturale fissa
       (~420x250) dentro aree grandi. Senza box (jsdom/compat T1) resta il
       vecchio fit 300x210 con stessa chiave di cache di prima. */
    function renderInk21(objs, cacheKey, box) {
        const out = { html: '', ok: false };
        if (!objs || !objs.length) return out;
        const hasBox = !!(box && box.w > 0 && box.h > 0);
        const key = hasBox
            ? cacheKey + '|fit' + Math.round(box.w) + 'x' + Math.round(box.h) +
              'd' + (Math.round((Number(box.dpr) || 1) * 10) / 10)
            : cacheKey;
        if (key && snapCache.has(key)) {
            const hit = snapCache.get(key);
            if (hit) {
                out.html = (typeof hit === 'string')
                    ? snapImgTag(hit, 0, 0, 0)
                    : snapImgTag(hit.url, hit.w, hit.h, hit.dpr);
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
            let s, dispW, dispH, dpr;
            if (hasBox) {
                dpr = Math.max(1, Math.min(3, Number(box.dpr) || 1));
                s = Math.max(0.01, Math.min((box.w - 2 * INK_PAD) / bb.w,
                    (box.h - 2 * INK_PAD) / bb.h, 64));
                dispW = Math.max(8, Math.round(bb.w * s + 2 * INK_PAD));
                dispH = Math.max(8, Math.round(bb.h * s + 2 * INK_PAD));
                /* R30 L3.1: il bitmap e' SEMPRE largo containerW x DPR (lato
                   alto = disegno fit "contain"): il canvas sorgente e' quindi
                   sempre >= containerW x devicePixelRatio */
                canvas.width = Math.max(2, Math.round(box.w * dpr));
                canvas.height = Math.max(2, Math.round(dispH * dpr));
            } else {
                dpr = 1;
                s = Math.max(0.05, Math.min((INK_W - 2 * INK_PAD) / bb.w,
                    (INK_H - 2 * INK_PAD) / bb.h, 8));
                dispW = Math.max(2, Math.round(bb.w * s + 2 * INK_PAD));
                dispH = Math.max(2, Math.round(bb.h * s + 2 * INK_PAD));
                canvas.width = dispW;
                canvas.height = dispH;
            }
            ctx = canvas.getContext('2d');
            if (!ctx) {
                fpLog('[fp21] snapshot tratti non generato: canvas 2d context null',
                    'objs=' + (objs ? objs.length : 0));
                return out;                             // jsdom senza canvas
            }
            ctx.save();
            if (dpr !== 1) ctx.scale(dpr, dpr);
            ctx.fillStyle = '#f7f5ef';
            ctx.fillRect(0, 0, hasBox ? box.w : dispW, dispH);
            /* centratura orizzontale del disegno quando limitato in altezza */
            const offX = hasBox ? Math.max(0, (box.w - dispW) / 2) : 0;
            ctx.translate(offX + INK_PAD - bb.x * s, INK_PAD - bb.y * s);
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
            try { url = canvas.toDataURL('image/png'); } catch (e) {
                fpLog('[fp21] snapshot tratti: toDataURL fallito -', e && e.message);
                url = '';
            }
            if (!url) {
                fpLog('[fp21] snapshot tratti vuoto: dataURL assente (canvas ' +
                    canvas.width + 'x' + canvas.height + ')');
                return out;
            }
            if (key) {
                snapCache.set(key, {
                    url: url, w: canvas.width, h: canvas.height, dpr: dpr
                });
            }
            out.html = snapImgTag(url, canvas.width, canvas.height, dpr);
            out.ok = true;
            return out;
        } catch (e) {
            fpLog('[fp21] snapshot tratti NON generato (errore):', e && e.message);
            return out;   // fallback su testo/hint - mai eccezione
        }
    }

    /* ---------- estrazione testo da item study (note/riassunto/doc) ------- */
    /* R22 B2: per gli oggetti delle note ritorna {text, images, blocks
       (ordine oggetti), hasInk, ink (snapshot html), inkOk, empty}:
       blocks preserva l'ordine testo/immagine; empty SOLO se la nota e'
       veramente vuota (ne tratti, ne testo, ne immagini). */
    function itemTexts(content, src, box) {
        const c = String(content == null ? '' : content);
        let o = null;
        try { o = JSON.parse(c); } catch (e) { o = null; }
        if (o && typeof o === 'object') {
            let objs = null;
            /* R27 B7.1: le PAGINE prima di objects - nel quaderno salvato
               (serializableDoc) objects e' la sola pagina corrente (spesso
               assente), le pagine contengono TUTTI i tratti di ogni pagina */
            if (Array.isArray(o.pages) && o.pages.length) {
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
                let nFile = 0;
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
                        return;
                    }
                    // R28: oggetti file (PPT/PDF/asset importati nella nota):
                    // nella preview diventano COLLEGAMENTI cliccabili.
                    if (x.t === 'file' && (x.path || x.src)) {
                        blocks.push({ k: 'file', v: x.path || x.src, n: x.name || '' });
                        nFile++;
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
                if (!texts.length && !nImg && !nFile && !res.hasInk) { res.empty = true; return res; }
                if (res.hasInk) {
                    const idPart = (src && src.id != null) ? String(src.id) : 'c';
                    const snap = renderInk21(inkObjs,
                        idPart + '|' + inkVersion(src || {}), box);
                    res.ink = snap.html;
                    res.inkOk = snap.ok;
                }
                return res;
            }
            if (typeof o.html === 'string' && o.html.trim()) {
                return null; // renderizzato da renderHtmlDoc21 (html non vuoto)
            } else if (Array.isArray(o.nodes)) {
                return { text: o.nodes.map(n => (n && n.text) || '').filter(Boolean).join('\n'), images: '' };
            } else if (typeof o.text === 'string' && o.text.trim()) {
                return { text: o.text, images: '' };
            } else if (typeof o.riassunto === 'string' && o.riassunto.trim()) {
                return { text: o.riassunto, images: '' };
            } else {
                /* R27 B7.3/B7.8: oggetto JSON senza campi renderizzabili ->
                   MAI JSON grezzo in preview: messaggio di vuoto + log */
                fpLog('[fp21] oggetto contenuto non riconosciuto', src && src.id,
                    Object.keys(o));
                return null;
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

    /* ---------- R28: badge per kind + URL file locali ---------------------- */
    const KIND_BADGE = {
        note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento',
        presentazione: 'Presentazione', foglio: 'Foglio', video: 'Video',
        schema: 'Schema', conv: 'Chat', mazzo: 'Flashcard'
    };
    function badgeFor(s) {
        if (!s) return 'Fonte';
        if (s.kind === 'mat') return matKindLabel(s.path);
        return KIND_BADGE[s.kind] || 'Fonte';
    }
    function fileUrl(path) {
        const p = String(path || '');
        if (!p) return '';
        if (/^[a-z]+:\/\//i.test(p)) return p;
        try {
            if (window.StudyStore && typeof window.StudyStore.assetUrl === 'function') {
                const u = window.StudyStore.assetUrl(p);
                if (u) return u;
            }
        } catch (e) { /* fallback sotto */ }
        let s = p.replace(/\\/g, '/');
        if (s.charAt(0) !== '/') s = '/' + s;
        try {
            return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
        } catch (e) { return 'file://' + s; }
    }
    function baseName(p) {
        const s = String(p || '').replace(/\\/g, '/');
        const i = s.lastIndexOf('/');
        return i >= 0 ? s.slice(i + 1) : s;
    }
    async function openFileSafe(path) {
        if (!path) return false;
        try {
            if (window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.study_open_file === 'function') {
                const r = await window.pywebview.api.study_open_file(path);
                if (r && r.success !== false) return true;
            }
        } catch (e) { /* prova sotto */ }
        try {
            if (window.StudyStore && typeof window.StudyStore.openFilePath === 'function') {
                await window.StudyStore.openFilePath(path);
                return true;
            }
        } catch (e) { /* ok */ }
        return false;
    }
    /* R28: riga-collegamento a un file reale (click -> apre il file fuori
       dalla preview, dentro la app). Usata per oggetti file nelle note e
       come azione di riserva di ogni viewer materiale. */
    function fileRowHtml(path, name) {
        const nm = name || baseName(path) || 'File';
        return '<button type="button" class="fp21-filerow" data-fpath="' + esc(path || '') + '">' +
            '<span class="fp21-fileico">&#128196;</span><span>' + esc(nm) + '</span>' +
            '<span class="fp21-filemeta">apri file &#8599;</span></button>';
    }

    /* ---------- R28: render strutturati (strutture dei moduli) ------------ */
    function colName(i) {
        let s = '', n = i;
        while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
        return s;
    }
    function gridTable(rows) {
        if (!rows || !rows.length) return '<p>Foglio vuoto.</p>';
        const nCols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
        let h = '<div class="fp21-gridwrap"><table class="fp21-grid"><thead><tr><th></th>';
        for (let c = 0; c < nCols; c++) h += '<th>' + colName(c) + '</th>';
        h += '</tr></thead><tbody>';
        rows.forEach(function (r, i) {
            /* R27 B7.2: prima riga = intestazione (grassetto), numeri a destra */
            h += '<tr' + (i === 0 ? ' class="fp21-hrow"' : '') + '>' +
                '<td class="fp21-rowh">' + (i + 1) + '</td>';
            for (let c = 0; c < nCols; c++) {
                const v = r[c] == null ? '' : r[c];
                const isNum = String(v) !== '' && /^-?\d+([.,]\d+)?$/.test(String(v));
                h += '<td' + (isNum ? ' class="fp21-num"' : '') + '>' + esc(v) + '</td>';
            }
            h += '</tr>';
        });
        return h + '</tbody></table></div>';
    }
    function lettersToIdx(letters) {
        let n = 0;
        for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
        return n - 1;
    }
    function usedGrid(cells, maxRows, maxCols) {
        const CAP_R = 25, CAP_C = 12;   // R27 B7.2: prime 25 righe x 12 colonne
        let maxR = 0, maxC = 0;
        const parsed = {};
        Object.keys(cells || {}).forEach(function (ref) {
            const m = /^([A-Z]+)(\d+)$/.exec(ref);
            if (!m) return;
            const ci = lettersToIdx(m[1]);
            const ri = parseInt(m[2], 10);
            if (!(ri > 0) || !(ci >= 0)) return;
            const c = cells[ref] || {};
            const v = (c.v !== undefined && c.v !== null) ? c.v
                : (c.f != null ? String(c.f) : '');
            parsed[ri + ':' + ci] = v;
            if (ri > maxR) maxR = ri;
            if (ci + 1 > maxC) maxC = ci + 1;
        });
        if (maxR === 0) {
            maxR = Math.min(Number(maxRows) || 0, CAP_R);
            maxC = Math.min(Number(maxCols) || 0, CAP_C);
        }
        maxR = Math.min(maxR || 1, CAP_R);
        maxC = Math.min(maxC || 1, CAP_C);
        const rows = [];
        for (let r = 1; r <= maxR; r++) {
            const row = [];
            for (let c = 0; c < maxC; c++) {
                const v = parsed[r + ':' + c];
                row.push(v == null ? '' : String(v));
            }
            rows.push(row);
        }
        return rows;
    }
    function previewSlidesItem(content) {
        let d = null;
        try { d = JSON.parse(String(content || '')); } catch (e) { d = null; }
        const slides = (d && Array.isArray(d.slides)) ? d.slides : null;
        if (!slides || !slides.length) return '<p>Nessuna diapositiva disponibile.</p>';
        const total = slides.length;
        const html = slides.slice(0, 10).map(function (s, i) {
            const els = (s && Array.isArray(s.elements)) ? s.elements : [];
            const texts = els.filter(function (e2) {
                return e2 && e2.type === 'text' && e2.text;
            });
            const title = texts.length ? String(texts[0].text) : '';
            const body = texts.slice(1).map(function (e2) { return String(e2.text); });
            /* R27 B7.4: outline slide (max 10) + thumbnail della PRIMA slide
               quando contiene un'immagine renderizzabile */
            let thumb = '';
            if (i === 0) {
                const im = els.filter(function (e2) {
                    return e2 && e2.type === 'image' && e2.src;
                })[0];
                if (im) {
                    thumb = '<img class="fp21-thumb" alt="" src="' +
                        esc(/^data:/i.test(String(im.src)) ? im.src : fileUrl(im.src)) + '">';
                }
            }
            let h = '<div class="fp21-slide"><div class="fp21-slide-n">Diapositiva ' +
                (i + 1) + '/' + total + '</div>' + thumb;
            if (title) h += '<div class="fp21-slide-t">' + esc(title) + '</div>';
            if (body.length) h += '<div class="fp21-slide-b">' + esc(body.join('\n')) + '</div>';
            if (!title && !body.length) h += '<div class="fp21-slide-b">(diapositiva vuota)</div>';
            return h + '</div>';
        }).join('');
        const more = total > 10
            ? '<p class="fp21-hint">... altre ' + (total - 10) + ' diapositive</p>' : '';
        return html + more;
    }
    function previewSheetItem(content) {
        let d = null;
        try { d = JSON.parse(String(content || '')); } catch (e) {
            fpLog('[fp21] foglio non leggibile: JSON.parse fallito -', e && e.message,
                'len=' + String(content == null ? 0 : String(content).length));
            d = null;
        }
        if (!d || typeof d !== 'object') return '<p>Foglio non leggibile.</p>';
        /* R27 B7.2: formato corrente {sheets:[{cells}]} + legacy {cells} in
           radice; "non leggibile" SOLO se la griglia e' vuota/corrotta,
           sempre con console.error */
        let sheets = (Array.isArray(d.sheets) && d.sheets.length) ? d.sheets : null;
        if (!sheets && d.cells && typeof d.cells === 'object') {
            sheets = [{ name: 'Foglio1', cells: d.cells }];
        }
        if (!sheets) {
            fpLog('[fp21] foglio non leggibile: griglia assente/corrotta',
                Object.keys(d));
            return '<p>Foglio non leggibile.</p>';
        }
        const cur = Number(d.current) || 0;
        const order = sheets.slice(cur).concat(sheets.slice(0, cur));
        const out = [];
        order.slice(0, 4).forEach(function (s) {
            const cells = (s && s.cells) || {};
            const keys = Object.keys(cells).filter(k => /^[A-Z]+\d+$/.test(k));
            if (!keys.length) {
                fpLog('[fp21] foglio non leggibile: griglia vuota/corrotta in',
                    (s && s.name) || '?', 'chiavi=' + Object.keys(cells).length);
                out.push('<div class="fp21-chatmeta">' + esc((s && s.name) || 'Foglio') +
                    '</div><p>Foglio non leggibile.</p>');
                return;
            }
            const grid = usedGrid(cells, d.rows, d.cols);
            out.push('<div class="fp21-chatmeta">' + esc((s && s.name) || 'Foglio') + '</div>' +
                gridTable(grid));
        });
        return out.join('');
    }
    /* R27 B7.5: meta progetto video - durata (max start+dur) + n clip */
    function videoMetaHtml(clips) {
        let end = 0;
        (clips || []).forEach(function (c) {
            const e2 = (Number(c.start) || 0) + (Number(c.dur) || 0);
            if (e2 > end) end = e2;
        });
        const mm = Math.floor(end / 60);
        const ss = Math.round(end % 60);
        return '<div class="fp21-chatmeta">Progetto video \u00b7 ' +
            (clips ? clips.length : 0) + ' clip \u00b7 ' + mm + ':' +
            (ss < 10 ? '0' : '') + ss + '</div>';
    }
    function previewVideoItem(content) {
        let d = null;
        try { d = JSON.parse(String(content || '')); } catch (e) { d = null; }
        const clips = (d && Array.isArray(d.clips)) ? d.clips : null;
        if (!clips || !clips.length) {
            const sc = (d && typeof d.script === 'string') ? d.script.trim() : '';
            /* R27 B7.5: anche il progetto vuoto mostra i META (0 clip) */
            return videoMetaHtml([]) +
                (sc ? renderMarkdown21(sc) : '<p>Nessuna clip nel progetto video.</p>');
        }
        const sorted = clips.slice().sort(function (a, b) {
            return (Number(a.start) || 0) - (Number(b.start) || 0);
        });
        const LBL = {
            text: 'Testo', image: 'Immagine', video: 'Video',
            music: 'Musica', audio: 'Audio'
        };
        let h = '';
        /* R27 B7.5: meta progetto in cima (durata totale + numero clip) */
        h += videoMetaHtml(sorted);
        // player nativo sulla prima clip video con sorgente locale
        const vclip = sorted.filter(function (c) { return c.type === 'video' && c.src; })[0];
        if (vclip) {
            h += '<video class="fp21-media" controls preload="metadata" src="' +
                esc(fileUrl(vclip.src)) + '"></video>';
        }
        let media = 0;
        h += sorted.slice(0, 40).map(function (c) {
            const t = (Number(c.start) || 0).toFixed(1) + 's';
            const label = LBL[c.type] || c.type || 'Clip';
            const name = c.type === 'text' ? String(c.text || '').slice(0, 60)
                : (c.src ? baseName(c.src) : '');
            let thumb = '';
            if (c.type === 'image' && c.src && media < 4) {
                thumb = '<img alt="" src="' + esc(fileUrl(c.src)) + '">';
                media++;
            }
            return '<div class="fp21-clip"><span class="fp21-clipk">' + esc(label) + '</span>' +
                '<span class="fp21-clipt">' + esc(t) + '</span>' +
                '<span class="fp21-clipn">' + esc(name || '\u2014') + '</span>' +
                thumb + '</div>';
        }).join('');
        const script = (typeof d.script === 'string' && d.script.trim()) ? d.script.trim() : '';
        if (script) h += '<div class="fp21-chatmeta">Scaletta</div>' + renderMarkdown21(script);
        if (sorted.length > 40) {
            h += '<p class="fp21-hint">... altre ' + (sorted.length - 40) + ' clip</p>';
        }
        return h;
    }
    function previewSchemaItem(content) {
        let d = null;
        try { d = JSON.parse(String(content || '')); } catch (e) { d = null; }
        const nodes = (d && Array.isArray(d.nodes)) ? d.nodes : [];
        const edges = (d && Array.isArray(d.edges)) ? d.edges : [];
        if (!nodes.length) return '<p>Schema vuoto.</p>';
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        nodes.forEach(function (n) {
            const x = Number(n.x) || 0, y = Number(n.y) || 0;
            const w = Number(n.w) || 120, hh = Number(n.h) || 54;
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x + w > x1) x1 = x + w;
            if (y + hh > y1) y1 = y + hh;
        });
        if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 400; y1 = 200; }
        const pad = 16;
        const vw = Math.max(60, x1 - x0 + pad * 2);
        const vh = Math.max(50, y1 - y0 + pad * 2);
        const pos = {};
        nodes.forEach(function (n) { pos[n.id] = n; });
        let lines = '';
        edges.forEach(function (e2) {
            const a = pos[e2.from != null ? e2.from : (e2.source != null ? e2.source : e2.a)];
            const b = pos[e2.to != null ? e2.to : (e2.target != null ? e2.target : e2.b)];
            if (!a || !b) return;
            const ax = (Number(a.x) || 0) + (Number(a.w) || 120) / 2;
            const ay = (Number(a.y) || 0) + (Number(a.h) || 54) / 2;
            const bx = (Number(b.x) || 0) + (Number(b.w) || 120) / 2;
            const by = (Number(b.y) || 0) + (Number(b.h) || 54) / 2;
            lines += '<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by +
                '" stroke="#8a8f98" stroke-width="1.6"/>';
        });
        let rects = '';
        nodes.slice(0, 120).forEach(function (n) {
            const x = (Number(n.x) || 0) - x0 + pad;
            const y = (Number(n.y) || 0) - y0 + pad;
            const w = Number(n.w) || 120, hh = Number(n.h) || 54;
            const label = String(n.text != null ? n.text : (n.label || n.title || ''))
                .split('\n')[0].slice(0, 40);
            rects += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh +
                '" rx="8" fill="#fff" stroke="#141824" stroke-width="1.4"/>' +
                '<text x="' + (x + w / 2) + '" y="' + (y + hh / 2 + 3) +
                '" text-anchor="middle" font-size="11" fill="#141824">' +
                esc(label) + '</text>';
        });
        let h = '<div class="fp21-svgwrap"><svg viewBox="0 0 ' + vw + ' ' + vh +
            '" xmlns="http://www.w3.org/2000/svg">' + lines + rects + '</svg></div>';
        const items = nodes.slice(0, 40).map(function (n) {
            const label = String(n.text != null ? n.text : (n.label || n.title || ''))
                .split('\n')[0];
            return label ? '<li>' + esc(label) + '</li>' : '';
        }).join('');
        if (items) h += '<ul class="fp21-schemelist">' + items + '</ul>';
        if (nodes.length > 40) {
            h += '<p class="fp21-hint">... altri ' + (nodes.length - 40) + ' nodi</p>';
        }
        return h;
    }
    /* R28: CHAT - bolle conversazione (ultimi 80 messaggi) */
    async function previewChat(src) {
        let msgs = [];
        try {
            if (window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.get_messages === 'function') {
                msgs = (await window.pywebview.api.get_messages(src.id)) || [];
            }
        } catch (e) { msgs = []; }
        if (!msgs.length) {
            const prev = (src.raw && src.raw.preview) || '';
            return '<p class="fp21-hint">Nessun messaggio in questa conversazione.</p>' +
                (prev ? '<div class="fp21-bub ai">' + esc(prev) + '</div>' : '');
        }
        const meta = '<div class="fp21-chatmeta">' + msgs.length + ' messaggi' +
            (src.raw && src.raw.materia ? ' \u00b7 ' + esc(src.raw.materia) : '') + '</div>';
        /* R27 B7.6: transcript con ultimi 20 turni + "…" se ce ne sono altri */
        const more = msgs.length > 20
            ? '<div class="fp21-hint">\u2026 ultimi 20 turni di ' + msgs.length + '</div>'
            : '';
        const body = msgs.slice(-20).map(function (m) {
            const me = String(m.role || '').toLowerCase() === 'user';
            const txt = String(m.content || '');
            return '<div class="fp21-bub ' + (me ? 'me' : 'ai') + '">' +
                renderMarkdown21(txt.length > 4000 ? txt.slice(0, 4000) : txt) + '</div>';
        }).join('');
        return meta + body + more;
    }

    /* ---------- R28: viewer REALE per i materiali/files ------------------- */
    async function readPreview(path) {
        try {
            if (window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.read_material_preview === 'function') {
                return await window.pywebview.api.read_material_preview(path);
            }
        } catch (e) { /* fallback sotto */ }
        return null;
    }
    function renderDocBlocks(blocks) {
        if (!Array.isArray(blocks) || !blocks.length) return '<p>Documento vuoto.</p>';
        return blocks.slice(0, 800).map(function (b) {
            if (!b) return '';
            if (b.k === 'tr' && Array.isArray(b.cells)) {
                return '<div class="fp21-docblk" style="font-family:monospace;font-size:11.5px;' +
                    'color:#cfd6e4">' + b.cells.map(esc).join(' \u2502 ') + '</div>';
            }
            const t = String(b.t || '');
            if (b.k === 'h') {
                const cls = (b.l === 2 || b.l === 3) ? 'fp21-docblk h h2' : 'fp21-docblk h';
                return '<div class="' + cls + '">' + esc(t) + '</div>';
            }
            return '<div class="fp21-docblk">' + esc(t) + '</div>';
        }).join('');
    }
    function renderBackendSlides(slides, count) {
        if (!Array.isArray(slides) || !slides.length) return '<p>Nessuna slide.</p>';
        const total = Number(count) || slides.length;
        const html = slides.slice(0, 12).map(function (s) {
            const lines = (s.lines || []).map(String).join('\n');
            let h = '<div class="fp21-slide"><div class="fp21-slide-n">Slide ' +
                (s.i || 0) + '/' + total + '</div>';
            if (s.title) h += '<div class="fp21-slide-t">' + esc(s.title) + '</div>';
            if (lines) h += '<div class="fp21-slide-b">' + esc(lines) + '</div>';
            if (s.notes) {
                h += '<div class="fp21-slide-notes">Note: ' + esc(s.notes) + '</div>';
            }
            return h + '</div>';
        }).join('');
        const more = total > 12
            ? '<p class="fp21-hint">... altre ' + (total - 12) + ' slide</p>' : '';
        return html + more;
    }
    function renderBackendSheets(sheets) {
        if (!Array.isArray(sheets) || !sheets.length) return '<p>Foglio vuoto.</p>';
        return sheets.map(function (s) {
            return '<div class="fp21-chatmeta">' + esc(s.name || 'Foglio') + '</div>' +
                gridTable(s.rows || []);
        }).join('');
    }
    /* R27 B7.7: per un file in originals/ prova PRIMA la copia indicizzata
       rag_stage2/<stem>.md (testo con heading - md = riferimento di
       qualita' R21): se ha contenuto la si usa, altrimenti il file originale. */
    async function readMatBest(p) {
        const s = String(p || '').replace(/\\/g, '/');
        let s2 = '';
        if (s && !/\.(md|markdown|txt)$/i.test(s) && /\/originals\//i.test(s)) {
            s2 = s.replace(/\/originals\//i, '/rag_stage2/').replace(/\.[^.]+$/, '.md');
        }
        if (s2) {
            const r = await readPreview(s2);
            if (r && r.success &&
                (r.viewer !== 'text' || String(r.text || '').trim())) {
                return r;
            }
        }
        return p ? await readPreview(p) : null;
    }
    async function previewMat21(src, badge) {
        const p = src.path || '';
        const title0 = src.title || (p ? baseName(p).replace(/\.[^.]+$/, '') : 'Materiale');
        const r = await readMatBest(p);
        if (r && r.success) {
            const url = fileUrl(r.path || p);
            const tail = fileRowHtml(r.path || p, r.name);
            const title = src.title || (r.name ? String(r.name).replace(/\.[^.]+$/, '') : title0);
            if (r.viewer === 'image') {
                return {
                    title: title, badge: badge,
                    html: '<div class="fp21-imgwrap"><img class="fp21-thumb fp21-big" alt="' +
                        esc(title) + '" src="' + esc(url) + '"></div>' + tail
                };
            }
            if (r.viewer === 'video') {
                return {
                    title: title, badge: badge,
                    html: '<video class="fp21-media" controls preload="metadata" src="' +
                        esc(url) + '"></video>' + tail
                };
            }
            if (r.viewer === 'audio') {
                return {
                    title: title, badge: badge,
                    html: '<audio class="fp21-media" style="background:transparent" controls src="' +
                        esc(url) + '"></audio>' + tail
                };
            }
            if (r.viewer === 'pdf') {
                const fb = r.text
                    ? '<details><summary class="fp21-hint">Testo del PDF (testo di riserva)</summary>' +
                      '<div class="fp21-pdftext">' + esc(r.text) + '</div></details>'
                    : '';
                return {
                    title: title, badge: badge,
                    html: '<iframe class="fp21-doc" title="' + esc(title) +
                        '" src="' + esc(url) + '"></iframe>' + fb + tail
                };
            }
            if (r.viewer === 'doc') {
                return { title: title, badge: badge, html: renderDocBlocks(r.blocks) + tail };
            }
            if (r.viewer === 'slides') {
                return {
                    title: title, badge: badge,
                    html: renderBackendSlides(r.slides, r.count) + tail
                };
            }
            if (r.viewer === 'sheet') {
                return { title: title, badge: badge, html: renderBackendSheets(r.sheets) + tail };
            }
            if (r.viewer === 'html') {
                return { title: title, badge: badge, html: sanitizeHtml(String(r.html || '')) + tail };
            }
            if (r.viewer === 'text') {
                const t = String(r.text || '');
                if (!t.trim()) {
                    fpLog('[fp21] materiale senza testo:', r.path || p,
                        'viewer=' + r.viewer);
                    return {
                        title: title, badge: badge,
                        html: '<p class="fp21-hint">File binario o vuoto: usa "apri file" per ' +
                            'aprirlo nel programma di sistema.</p>' + tail
                    };
                }
                const isMd = /\.(md|markdown)$/i.test(r.name || '') ||
                    r.kind === 'md' || r.kind === 'markdown';
                if (isMd) {
                    return { title: title, badge: badge, html: renderMarkdown21(t) + tail };
                }
                const paras = t.split(/\n{2,}/).filter(Boolean).slice(0, 200)
                    .map(function (pp) {
                        return '<p>' + esc(String(pp).replace(/\n/g, ' ').trim()) + '</p>';
                    }).join('');
                return { title: title, badge: badge, html: (paras || '<p>Testo vuoto.</p>') + tail };
            }
            // viewer 'file': nessuna anteprima nativa -> apri il file
            return {
                title: title, badge: badge,
                html: '<p class="fp21-hint">' +
                    esc(r.error || 'Nessuna anteprima nativa per questo formato.') +
                    '</p>' + tail
            };
        }
        // ---- Fallback legacy: read_material_text (solo testo/md) ----------
        const rr = p ? await readMat(p) : null;
        if (rr && rr.success && typeof rr.text === 'string' && rr.text) {
            const isMd = /\.(md|markdown)$/i.test(p) || rr.kind === 'md' || rr.kind === 'markdown';
            const title = src.title || (rr.name ? String(rr.name).replace(/\.[^.]+$/, '') : title0);
            if (isMd) return { title: title, badge: badge, html: renderMarkdown21(rr.text) };
            const paras = rr.text.split(/\n{2,}/).filter(Boolean).slice(0, 200)
                .map(function (pp) {
                    return '<p>' + esc(String(pp).replace(/\n/g, ' ').trim()) + '</p>';
                }).join('');
            return { title: title, badge: badge, html: paras || '<p>Testo vuoto.</p>' };
        }
        if (p && /\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) {
            return {
                title: title0, badge: badge,
                html: '<div class="fp21-imgwrap"><img class="fp21-thumb fp21-big" alt="' +
                    esc(title0) + '" src="' + esc(fileUrl(p)) + '"></div>' + fileRowHtml(p, src.title)
            };
        }
        return {
            title: title0, badge: badge,
            html: '<p class="fp21-hint">Nessuna anteprima raggiungibile per questa fonte.</p>' +
                (p ? fileRowHtml(p, src.title) : '')
        };
    }

    /* ---------- PREVIEW per sorgente (1.1-1.4) ---------------------------- */
    /* R22 5.2: il testo "markdown-like" include anche le FORMULE ($..$,
       $$..$$, \(..\), \[..\]): nessun LaTeX grezzo nel preview nemmeno per
       note con solo testo formule. */
    const MDLIKE_RE = /(^|\n)#{1,6}\s|\*\*|```|^\s*[-*+] |\n\|.+\||\$\$|\\\(|\\\[|\$[^$\n]+\$/;
    /* ritorna Promise<{title, badge, html}> - preview VISIVA, mai codice
       crudo, mai metadati/percorsi. */
    /* R27 (ROOT CAUSE): study_list restituisce solo `preview`[180] e MAI
       `content` -> la preview vedeva contenuto indefinito: da li i sintomi
       degli screenshot ("Nessun testo disponibile." / "Foglio non
       leggibile.") su note e fogli ESISTENTI. Ogni selezione carica ora il
       contenuto completo via study_get (1 chiamata per click). */
    async function fullContent(src) {
        if (!src || src.kind === 'mat' || src.kind === 'conv') return src;
        if (src.id == null || src.id === '') return src;
        try {
            if (window.StudyStore && typeof window.StudyStore.getItem === 'function') {
                const it = await window.StudyStore.getItem(src.id);
                if (it && typeof it.content === 'string') {
                    return Object.assign({}, src, {
                        content: it.content,
                        raw: Object.assign({}, src.raw || {}, it)
                    });
                }
            }
        } catch (e) {
            fpLog('[fp21] study_get fallito per', src.id, e && e.message);
        }
        return src;
    }

    async function previewFonte21(src, opts) {
        if (!src) return { title: '', badge: '', html: '<p>Nessuna fonte selezionata.</p>' };
        src = await fullContent(src);
        const badge = badgeFor(src);
        /* R28: TUTTI i tipi di fonte si aprono "come se fosse aperto ma solo
           qui dentro" (tranne le flashcard, escluse da fetchSources21). */
        if (src.kind === 'conv') {
            return { title: src.title || 'Chat', badge: badge, html: await previewChat(src) };
        }
        if (src.kind === 'presentazione') {
            return {
                title: src.title || 'Presentazione', badge: badge,
                html: previewSlidesItem(src.content)
            };
        }
        if (src.kind === 'foglio') {
            return { title: src.title || 'Foglio', badge: badge, html: previewSheetItem(src.content) };
        }
        if (src.kind === 'video') {
            return { title: src.title || 'Video', badge: badge, html: previewVideoItem(src.content) };
        }
        if (src.kind === 'schema') {
            return { title: src.title || 'Schema', badge: badge, html: previewSchemaItem(src.content) };
        }
        if (src.kind === 'mat') {
            return await previewMat21(src, badge);
        }
        // 1.2 {"html"}
        if (src.kind !== 'mat') {
            const hd = renderHtmlDoc21(src.content);
            if (hd && hd.html && String(hd.html).trim()) {
                return { title: src.title || hd.title || 'Senza titolo', badge: badge, html: hd.html };
            }
            const ex = itemTexts(src.content, src, opts && opts.box);
            if (ex) {
                // R22 B2.2: "Nessun testo disponibile" SOLO se veramente vuota
                if (ex.empty && !ex.hasInk) {
                    fpLog('[fp21] preview vuota: nota realmente vuota', src.kind, src.id,
                        'contentLen=' + String(src.content == null ? 0 : src.content.length));
                    return { title: src.title || 'Senza titolo', badge: badge, html: '<p>Nessun testo disponibile.</p>' };
                }
                let body;
                const mdLike = MDLIKE_RE;
                if (ex.blocks && ex.blocks.length) {
                    // R22 B2.3: blocchi testo/immagine nell'ORDINE degli oggetti
                    body = ex.blocks.map(b => {
                        if (b.k === 'file') return fileRowHtml(b.v, b.n);
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
            fpLog('[fp21] preview vuota: contenuto non renderizzabile',
                src.kind, src.id, 'len=' +
                String(src.content == null ? 0 : String(src.content).length));
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
    /* R28: QUALSIASI contenuto dell'app entra nelle Fonti - tranne le
       FLASHCARD (kind 'mazzo'), escluse per richiesta esplicita. Ora anche
       presentazioni, documenti, fogli, video, schemi e CHAT. */
    async function fetchSources21() {
        const out = [];
        const INCLUDE = {
            note: 1, riassunto: 1, documento: 1, presentazione: 1,
            foglio: 1, video: 1, schema: 1
        };
        let items = [];
        try { items = await window.StudyStore.listItems('') || []; } catch (e) { items = []; }
        items.forEach(it => {
            if (INCLUDE[it.kind]) {
                out.push({
                    key: 'it:' + it.id, kind: it.kind, id: it.id,
                    title: it.title || 'Senza titolo', materia: it.materia || '',
                    path: '', content: it.content, raw: it
                });
            }
        });
        // R28: CHAT - le conversazioni come fonti visualizzabili
        let convs = [];
        try {
            convs = (typeof window.StudyStore.listConversations === 'function')
                ? (await window.StudyStore.listConversations() || []) : [];
        } catch (e) { convs = []; }
        convs.forEach(c => {
            if (c == null || c.id == null) return;
            out.push({
                key: 'conv:' + c.id, kind: 'conv', id: c.id,
                title: c.title || 'Chat', materia: c.materia || '',
                path: '', content: '', raw: c
            });
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
        // R24 R1.3: altezza = contenuto; padding-bottom ridotto a 4px (inline,
        // vince sul padding host 12px) -> sotto "Inserisci nella nota" resta
        // solo padding 4px + border 1px = 5px (contratto <=8px). maxHeight
        // clamp: con height auto la lista puo' crescere -> 66vh di sicurezza
        // (il resize manuale resta <=60vh da applySize).
        root.style.paddingBottom = '4px';
        root.style.maxHeight = '66vh';

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
        /* R28: chip per TUTTE le categorie richieste: appunti, documenti,
           presentazioni, fogli, video, chat + materiali/libri. */
        ['Tutti', 'Appunti', 'Documenti', 'Presentazioni', 'Fogli', 'Video', 'Chat',
            'Materiali', 'Libri'].forEach(lbl => {
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
        prev.className = 'fp21-preview fp21-pv';   // R30 L1.1: colonna fissa + area scroll
        prev.innerHTML = '<div class="fp21-ptitle">Seleziona una fonte per leggerne l\u2019anteprima.</div>' +
            '<div class="fp21-pbody fp21-pb"></div>';
        root.appendChild(prev);
        // R28: click delegato sui collegamenti-file dentro la preview
        prev.addEventListener('click', function (ev) {
            const t = ev && ev.target;
            const btn = t && t.closest ? t.closest('.fp21-filerow') : null;
            if (!btn) return;
            ev.preventDefault();
            openFileSafe(btn.getAttribute('data-fpath') || '');
        });

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
        // R24 R1.3: default ALTEZZA AUTO-CONTENUTO (h0=0 -> nessun height
        // fisso grande; niente 169px vuoti sotto "Inserisci nella nota").
        // Un resize esplicito dell'utente resta persistito (fp21_h_<ctx>).
        let h0 = Number(lsGet(kH, 0)) || 0;
        const applySize = (w, h) => {
            const maxW = Math.floor(innerWidth * 0.6), maxH = Math.floor(innerHeight * 0.6);
            w = Math.max(240, Math.min(maxW, w));
            if (h > 0) {
                h = Math.max(160, Math.min(maxH, h));
                root.style.height = h + 'px';
            } else {
                h = 0;
                root.style.height = '';   // auto-contenuto (clamp da max-height CSS)
            }
            root.style.width = w + 'px';
            return { w: w, h: h };
        };
        applySize(w0, h0);
        const startDrag = (e, mode) => {
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY;
            const r = root.getBoundingClientRect();
            const move = ev => {
                const w = r.width + (ev.clientX - sx) * (mode !== 'h' ? 1 : 0);
                // drag SOLO larghezza: non congela l'altezza auto-contenuto
                let h = (mode === 'w')
                    ? (Number(lsGet(kH, 0)) || 0)
                    : r.height + (ev.clientY - sy) * (mode !== 'w' ? 1 : 0);
                // R24: in drag verticale l'altezza resta SEMPRE esplicita e
                // >=160 (min applySize). L'auto (h=0) vale solo al mount/reset:
                // base=0 (jsdom/senza layout) o drag verso l'alto non deve
                // ricadere nell'auto (mismatch persistenza h0 vs style).
                if (mode !== 'w' && !(h > 0)) h = 160;
                const s = applySize(w, h);
                w0 = s.w; h0 = s.h;
                /* R27 B3: drag durante il collapso -> ripin dell'altezza e
                   ricalcolo dello spazio della preview */
                if (st.topCollapsed) {
                    if (!pinSaved) measurePin();
                    else {
                        pinSaved.auto = false;
                        pinSaved.rootH = root.style.height;
                        pinSaved.rectH = parseFloat(root.style.height) || pinSaved.rectH;
                    }
                    layoutCollapsed(true);
                }
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
            h0 = 0;   // R24: dopo reset il default torna altezza AUTO-contenuto
            applySize(w0, h0);
            if (st.topCollapsed && st.pinH) {
                // R27 B3: da collassato il reset NON puo' perdere il pin
                if (pinSaved) {
                    pinSaved.auto = false;
                    pinSaved.rootH = st.pinH + 'px';
                }
                root.style.height = st.pinH + 'px';
                layoutCollapsed(true);
            } else {
                try { fitHeight(); } catch (e2) { /* ok */ }
            }
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
            topCollapsed: lsGet(kT, '0') === '1',
            pinH: 0            // R27 B3: altezza esterna pinnata al collasso
        };
        let pinSaved = null;   // snapshot stili per ripristino all'espansione
        if (['tutti', 'appunti', 'documenti', 'presentazioni', 'fogli', 'video', 'chat',
            'materiali', 'libri'].indexOf(st.filter) < 0) st.filter = 'tutti';
        const setSearchOpen = open => {
            st.search = !!open;
            search.style.display = open ? '' : 'none';
            lsSet(kS, open ? '1' : '0');
        };
        setSearchOpen(st.search);
        // R22 B1.2: collapso REALE della riga superiore (chips+ricerca ->
        // una sola riga di icone), stato persistito in fp21_top_<contesto>
        const setCollapsed = c => {
            c = !!c;
            const was = st.topCollapsed;
            if (c && !was) measurePin();   // R27 B3: misura PRIMA di nascondere
            st.topCollapsed = c;
            root.classList.toggle('fp21-collapsed', c);
            chev.setAttribute('aria-expanded', c ? 'false' : 'true');
            chev.title = c ? 'Espandi ricerca e filtri' : 'Comprimi/espandi la riga ricerca+filtri';
            lsSet(kT, c ? '1' : '0');
            if (c && !was) layoutCollapsed(true);
            else if (!c && was) layoutCollapsed(false);
        };
        setCollapsed(st.topCollapsed);
        chev.addEventListener('click', () => setCollapsed(!st.topCollapsed));
        lens.addEventListener('click', () => {
            if (st.topCollapsed) setCollapsed(false);  // aprire la ricerca espande la riga
            setSearchOpen(!st.search);
        });

        /* ---------- R27 B2/B3: layout del collasso -------------------------
           Chip (RIGA2) + lista (RIGA3) spariscono, la barra (RIGA1: lente +
           chevron ruotato via CSS) resta sottile, la PREVIEW (RIGA4) prende
           TUTTO lo spazio liberato fino al bottone (RIGA5) che resta in
           fondo; l'ALTEZZA ESTERNA del pannello resta quella di prima
           (st.pinH su .fp21-root height). Tutto in px per non dipendere
           dalle regole flex dei vari host. jsdom/box nascosto: no-op. */
        function measurePin() {
            const h = root.getBoundingClientRect().height;
            pinSaved = {
                auto: !root.style.height,
                rootH: root.style.height,
                rectH: h,
                prevStyle: {
                    height: prev.style.height, flex: prev.style.flex,
                    display: prev.style.display,
                    flexDirection: prev.style.flexDirection,
                    minHeight: prev.style.minHeight,
                    maxHeight: prev.style.maxHeight,
                    overflow: prev.style.overflow
                },
                pbodyStyle: null
            };
            const pb0 = prev.querySelector('.fp21-pbody');
            if (pb0) {
                pinSaved.pbodyStyle = {
                    flex: pb0.style.flex, maxHeight: pb0.style.maxHeight,
                    overflow: pb0.style.overflow, minHeight: pb0.style.minHeight
                };
            }
        }
        function layoutCollapsed(on) {
            if (!pinSaved) return;
            const pb = prev.querySelector('.fp21-pbody');
            if (!on) {
                st.pinH = 0;
                root.style.height = pinSaved.rootH;
                Object.keys(pinSaved.prevStyle).forEach(k => {
                    prev.style[k] = pinSaved.prevStyle[k];
                });
                if (pb && pinSaved.pbodyStyle) {
                    Object.keys(pinSaved.pbodyStyle).forEach(k => {
                        pb.style[k] = pinSaved.pbodyStyle[k];
                    });
                }
                pinSaved = null;
                return;
            }
            const pinH = pinSaved.auto
                ? pinSaved.rectH
                : (parseFloat(pinSaved.rootH) || 0);
            if (!(pinH > 0)) { pinSaved = null; return; }   // jsdom / nascosto
            if (pinSaved.auto) root.style.height = Math.round(pinH) + 'px';
            st.pinH = Math.round(pinH);
            let topH = 0, insH = 0, padT = 0, padB = 0, gap = 0;
            try {
                const cs = getComputedStyle(root);
                padT = parseFloat(cs.paddingTop) || 0;
                padB = parseFloat(cs.paddingBottom) || 0;
                gap = parseFloat(cs.rowGap || cs.gap) || 0;
                topH = topwrap.getBoundingClientRect().height;
                insH = insert.getBoundingClientRect().height;
            } catch (e) { /* jsdom: pinH 0 di solito */ }
            let pvH = Math.round(pinH - padT - padB - topH - insH - gap * 2);
            if (!(pvH > 40)) pvH = Math.max(40, Math.round(pinH * 0.6));
            prev.style.display = 'flex';
            prev.style.flexDirection = 'column';
            prev.style.height = pvH + 'px';
            prev.style.flex = '0 0 auto';
            prev.style.minHeight = '0';
            prev.style.maxHeight = 'none';
            prev.style.overflow = 'hidden';
            if (pb) {
                pb.style.flex = '1 1 auto';
                pb.style.minHeight = '0';
                pb.style.overflow = 'auto';
                pb.style.maxHeight = 'none';
            }
        }
        /* rientra quando il pannello diventa visibile da collassato (aperto
           tardi, tab schemi attivata, mount on-demand): era nascosto al
           primo pass e la misura non si era potuta fare */
        function reflowCollapse() {
            if (!st.topCollapsed || st.pinH) return;
            measurePin();
            layoutCollapsed(true);
        }

        function syncChips() {
            Array.prototype.forEach.call(chips.querySelectorAll('.fp21-chip'), c =>
                c.classList.toggle('active', c.getAttribute('data-f') === st.filter));
        }
        function filtered() {
            const q = (search.value || '').trim().toLowerCase();
            return st.srcs.filter(s => {
                const f = st.filter;
                if (f === 'appunti' && s.kind !== 'note') return false;
                if (f === 'documenti' && s.kind !== 'documento') return false;
                if (f === 'presentazioni' && s.kind !== 'presentazione') return false;
                if (f === 'fogli' && s.kind !== 'foglio') return false;
                if (f === 'video' && s.kind !== 'video') return false;
                if (f === 'chat' && s.kind !== 'conv') return false;
                if (f === 'libri' && !(s.kind === 'mat' && matKindLabel(s.path) === 'Libro')) return false;
                if (f === 'materiali' && !(s.kind === 'mat' && matKindLabel(s.path) !== 'Libro')) return false;
                if (!q) return true;
                const badge = badgeFor(s);
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
                badge.textContent = badgeFor(s);
                const ttl = document.createElement('span');
                ttl.className = 'fp21-ititle';
                ttl.textContent = s.title || 'Senza titolo';
                b.appendChild(badge);
                b.appendChild(ttl);
                b.addEventListener('click', () => select(s));
                list.appendChild(b);
            });
        }
        /* ---------- R30 L1.2: box contenuto + ResizeObserver (debounce 80ms) --
           A ogni cambio di size (drag pannello, collasso, resize finestra,
           cambio tab) la preview della selezione corrente viene RIESEGUITA
           con il box reale: per la snapshot manoscritta il canvas viene
           RIGENERATO a contenutoW x contenutoH x devicePixelRatio. */
        function previewBox() {
            try {
                const pb = prev.querySelector('.fp21-pbody');
                if (!pb) return null;
                const cs = getComputedStyle(pb);
                const padX = (parseFloat(cs.paddingLeft) || 0) +
                    (parseFloat(cs.paddingRight) || 0);
                const padY = (parseFloat(cs.paddingTop) || 0) +
                    (parseFloat(cs.paddingBottom) || 0);
                const w = pb.clientWidth - padX;
                const h = pb.clientHeight - padY;
                if (!(w > 0) || !(h > 0)) return null;
                let dpr = 1;
                try { dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1)); }
                catch (e) { dpr = 1; }
                return { w: w, h: h, dpr: dpr };
            } catch (e) { return null; }
        }
        let roTimer = null;
        /* R30 L1.2: UNO scatto debounce 80ms condiviso da ResizeObserver,
           watcher DPR e resize della finestra */
        function scheduleRelayout() {
            if (roTimer) clearTimeout(roTimer);
            roTimer = setTimeout(function () {
                roTimer = null;
                try { relayoutPreview(); } catch (e) { /* ok */ }
            }, 80);
        }
        function relayoutPreview() {
            if (!st.sel) return;
            const box = previewBox();
            if (!box) return;
            const my = ++selSeq;
            previewFonte21(st.sel, { box: box }).then(res => {
                if (my !== selSeq) return;   // selezione/relayout intermedio
                const pb = prev.querySelector('.fp21-pbody');
                if (pb) pb.innerHTML = '<div class="fp21-aroot">' + res.html + '</div>';
            }).catch(function (e) {
                fpLog('[fp21] relayout preview fallito:', e && e.message);
            });
        }
        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            try {
                ro = new ResizeObserver(function () {
                    scheduleRelayout();
                });
                const pbObs = prev.querySelector('.fp21-pbody');
                if (pbObs) ro.observe(pbObs);
                if (typeof window !== 'undefined' && window.FP21_RO) {
                    window.FP21_RO.active++;
                }
            } catch (e) { ro = null; }
        }
        /* R30 L3.1: il cambio di devicePixelRatio (zoom di sistema o
           deviceScaleFactor del browser) NON cambia il box CSS e quindi NON
           scatta il ResizeObserver: watcher matchMedia resolution dedicato
           che riarmato a ogni cambio riesegue il layout (canvas a boxW x
           nuovo DPR) */
        let dprMq = null, dprOnChange = null;
        function armDprWatch() {
            if (typeof window.matchMedia !== 'function') return;
            try {
                if (dprMq && dprOnChange) {
                    if (dprMq.removeEventListener) dprMq.removeEventListener('change', dprOnChange);
                    else if (dprMq.removeListener) dprMq.removeListener(dprOnChange);
                }
                const dprNow = window.devicePixelRatio || 1;
                dprMq = window.matchMedia('(resolution: ' + dprNow + 'dppx)');
                dprOnChange = function () {
                    scheduleRelayout();
                    armDprWatch();
                };
                if (dprMq.addEventListener) dprMq.addEventListener('change', dprOnChange);
                else if (dprMq.addListener) dprMq.addListener(dprOnChange);
            } catch (e) { /* ok */ }
        }
        armDprWatch();
        let selSeq = 0;
        function select(s) {
            st.sel = s;
            renderList();
            const my = ++selSeq;
            const pt = prev.querySelector('.fp21-ptitle');
            const pb = prev.querySelector('.fp21-pbody');
            pt.textContent = 'Caricamento...';
            pb.innerHTML = '';
            previewFonte21(s, { box: previewBox() }).then(res => {
                if (my !== selSeq) return;
                pt.textContent = res.title || s.title || 'Senza titolo';
                const bd = document.createElement('span');
                bd.className = 'fp21-badge fp21-ptbadge';
                bd.textContent = res.badge || '';
                pt.appendChild(bd);
                pb.innerHTML = '<div class="fp21-aroot">' + res.html + '</div>';
                insert.disabled = false;
            });
        }
        insert.addEventListener('click', () => {
            if (!st.sel) return;
            const s = st.sel;
            onInsert(s, {
                tipo: badgeFor(s),
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
        /* R24 R1.1: mappa contesti -> toolbar del modulo letta dal DOM reale
           (getBoundingClientRect). Appunti entra nella mappa: nella pagina
           reale la cascade globale index.html (CSS .fp21-root fixed top:58
           z-index:160 di presentazioni/documenti, caricati DOPO notes)
           copriva .fn-pill-left -> 8/8 bottoni non hit (R0). Schemi resta
           fuori (mount scoped .sc-side, delegato altro: zero stili inline). */
        const FLOAT_TB = {
            appunti: ['.fn-pill-left', '.fn-zoom'],
            documenti: ['.doc-bar', '.mod-header'],
            presentazioni: ['.pp-bar', '.mod-header'],
            fogli: ['.fg-top', '.mod-header'],
            video: ['.toolbar', '.mod-header'],
            ripasso: ['.toolbar', '.mod-header']
        };
        /* fallback z SOLO se lo z-index calcolato della toolbar non e' numerico */
        const FLOAT_Z = { appunti: 11, documenti: 20, presentazioni: 5, fogli: 5, video: 5, ripasso: 5 };
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
        /* R24 R1.1: bordo inferiore + left della toolbar reale (x-range del
           pannello) — nessun hardcoded top/left */
        function chromeAnchor(sels, scope, xr) {
            let maxB = -1, left = 0;
            (sels || []).forEach(sel => {
                let nodes = [];
                try { nodes = (scope || document).querySelectorAll(sel); } catch (e) { nodes = []; }
                Array.prototype.forEach.call(nodes, el => {
                    let r = null;
                    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
                    if (!r || r.height <= 0 || r.width <= 0) return;
                    if (Math.min(r.right, xr[1]) - Math.max(r.left, xr[0]) <= 0) return;
                    if (r.bottom > maxB) { maxB = r.bottom; left = r.left; }
                });
            });
            return { b: maxB, left: left };
        }
        /* R24 R1.1: z-index CALCOLATO della toolbar (getComputedStyle), max
           tra le toolbars visibili; -1 se non disponibile (jsdom/CSS assente) */
        function toolbarZ(sels) {
            let best = -1;
            (sels || []).forEach(sel => {
                let nodes = [];
                try { nodes = document.querySelectorAll(sel); } catch (e) { nodes = []; }
                Array.prototype.forEach.call(nodes, el => {
                    let r = null;
                    try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
                    if (!r || r.height <= 0) return;
                    let z = '';
                    try { z = getComputedStyle(el).zIndex; } catch (e) { z = ''; }
                    const n = parseInt(z, 10);
                    if (!isNaN(n) && n > best) best = n;
                });
            });
            return best;
        }
        /* R24 R1.3: default altezza AUTO-contenuto. Con layout reale misurato
           resta height:'' (il contenuto + padding definiscono il box: sotto
           "Inserisci nella nota" resta solo il padding ~8px). Senza layout
           (jsdom) o pannello nascosto: fallback legacy <=60vh (compat T1
           a19_fonti 5.3: height inline in px). Un resize persistito
           (fp21_h_<ctx>) ha la precedenza e non viene toccato. */
        function fitHeight() {
            if (st.pinH) return;    // R27 B3: altezza pinnata dal collasso - non toccare
            if (Number(lsGet(kH, 0)) > 0) return;
            root.style.height = '';
            let h = 0;
            try { h = root.getBoundingClientRect().height; } catch (e) { h = 0; }
            if (!(h > 0)) {
                root.style.height = Math.min(Math.floor(innerHeight * DEFAULT_H),
                    Math.floor(innerHeight * 0.6)) + 'px';
            }
        }
        function fitDock() {
            try { reflowCollapse(); } catch (e) { /* ok */ }   // R27 B3
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
                    const tzW = toolbarZ(sels);
                    wrap.style.zIndex = String(tzW > 0 ? Math.max(1, tzW - 1) :
                        (typeof z === 'number' ? z : 5));
                    fitHeight();
                    return;
                }
                const xr = panelXRange();
                const anc = chromeAnchor(sels, null, xr);
                if (anc.b >= 0) {
                    // R24 R1.1: top = bottom toolbar + 8px, left ALLINEATO
                    // alla toolbar, z-index INLINE < z toolbar: gli stili
                    // inline vincono su TUTTA la cascade (fixed/top:58/z160)
                    const top = Math.round(anc.b + 8);
                    root.style.position = 'fixed';
                    root.style.right = 'auto';
                    root.style.left = Math.round(anc.left) + 'px';
                    root.style.top = top + 'px';
                    const tz = toolbarZ(sels);
                    root.style.zIndex = String(tz > 0 ? Math.max(1, tz - 1) :
                        (typeof z === 'number' ? z : 5));
                    // pannello sempre dentro il viewport sotto la toolbar
                    root.style.maxHeight = Math.max(220,
                        Math.floor(innerHeight - top - 10)) + 'px';
                }
                fitHeight();
            } catch (e) { /* mai eccezione */ }
        }
        const onWinResize = () => { fitDock(); scheduleRelayout(); };   // R30 L1.2

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
        // R24 R1.1: riapertura del pannello (classe .show aggiunta dall'host,
        // es. notes.toggleFonti) -> ri-ancoraggio reale sotto la toolbar
        let mo = null;
        if (typeof MutationObserver !== 'undefined') {
            try {
                mo = new MutationObserver(() => { try { fitDock(); } catch (e) { /* ok */ } });
                mo.observe(root, { attributes: true, attributeFilter: ['class'] });
            } catch (e) { mo = null; }
        }

        return {
            el: root,
            refresh: refresh,
            destroy: function () {
                try {
                    clearTimeout(dockT1);
                    clearTimeout(dockT2);
                    if (roTimer) clearTimeout(roTimer);
                    if (ro) {
                        ro.disconnect();
                        ro = null;
                        if (typeof window !== 'undefined' && window.FP21_RO &&
                            window.FP21_RO.active > 0) {
                            window.FP21_RO.active--;
                        }
                    }
                    if (dprMq && dprOnChange) {
                        if (dprMq.removeEventListener) dprMq.removeEventListener('change', dprOnChange);
                        else if (dprMq.removeListener) dprMq.removeListener(dprOnChange);
                        dprMq = null;
                    }
                    if (mo) mo.disconnect();
                    if (typeof window !== 'undefined' && window.removeEventListener) {
                        window.removeEventListener('resize', onWinResize);
                    }
                } catch (e) { /* ok */ }
                if (root.parentNode) root.parentNode.removeChild(root);
            }
        };
    }

    /* ---------- R27 B1/B4/B5: toggle toolbar, Esc, persistenza APERTO -----
       Owner FE-FONTI: nessun tocco ai moduli. Ogni modulo apre/chiude il
       pannello con il proprio bottone Fonti (gli Schemi con il tab Fonti):
       qui si OSSERVANO quei click per persistere lo stato per modulo
       (fp21_open_<contesto>), si RIPRISTINA a reload riclickando il
       bottone quando il pannello non e' visibile, ed Esc chiude il
       pannello visibile. Stato chiuso = pannello non visibile (per i mount
       on-demand l'host lo distrugge: per quelli resta l'assenza). */
    const FP_BTNS = [
        { c: 'appunti', rec: '[data-fonti]', app: '[data-fonti]' },
        /* stesso title tra documenti e presentazioni: il PROBE del modulo
           attivo evita di scrivere/riclickare la chiave sbagliata */
        { c: 'documenti', rec: '[title="Apri/chiudi il pannello Fonti"]',
          app: '[title="Apri/chiudi il pannello Fonti"]', probe: '.doc-bar' },
        { c: 'presentazioni', rec: '[title="Apri/chiudi il pannello Fonti"]',
          app: '[title="Apri/chiudi il pannello Fonti"]', probe: '.pp-bar' },
        { c: 'fogli',
          rec: '[title^="Apri/chiudi le fonti inseribili nel foglio"]',
          app: '[title^="Apri/chiudi le fonti inseribili nel foglio"]' },
        { c: 'video',
          rec: '[title^="Apri/chiudi le fonti inseribili nella timeline"]',
          app: '[title^="Apri/chiudi le fonti inseribili nella timeline"]' },
        { c: 'ripasso', rec: '[title="Aggiungi una card da una fonte"]',
          app: '[title="Aggiungi una card da una fonte"]' },
        /* Schemi (B5): pannello dentro il tab Fonti della .sc-side - qualsiasi
           click su un tab registra la visibilita' reale; il ripristino
           riclicca il SOLO tab "Fonti" */
        { c: 'schemi', rec: '.sc-side .sc-tab', app: '.sc-side .sc-tab',
          appText: 'Fonti' }
    ];
    function fpPanelEl(c) {
        try {
            return document.querySelector('.fp21-root[data-fp21="' + c + '"]');
        } catch (e) { return null; }
    }
    function fpVisible(el) {
        if (!el) return false;
        try {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        } catch (e) { return false; }
    }
    function fpFind(sel, opts) {
        opts = opts || {};
        let nodes = [];
        try { nodes = document.querySelectorAll(sel); } catch (e) { return null; }
        let fallback = null;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (opts.text &&
                String(n.textContent || '').trim().indexOf(opts.text) < 0) continue;
            let vis = false;
            try { vis = n.getClientRects().length > 0; } catch (e2) { vis = false; }
            if (vis) return n;
            if (!fallback) fallback = n;
        }
        return opts.visibleOnly ? null : fallback;
    }
    function fpRecord(c) {
        try {
            lsSet('fp21_open_' + c, fpVisible(fpPanelEl(c)) ? '1' : '0');
        } catch (e) { /* ok */ }
    }
    function fpApplyPass() {
        FP_BTNS.forEach(function (e) {
            try {
                if (lsGet('fp21_open_' + e.c, '0') !== '1') return;
                if (e.probe && !document.querySelector(e.probe)) return;  // modulo non attivo
                if (fpVisible(fpPanelEl(e.c))) return;
                const b = fpFind(e.app, {
                    text: e.appText, visibleOnly: true
                });
                if (b) b.click();
            } catch (err) { /* ok */ }
        });
    }
    let fpApplyTimer = null;
    function fpScheduleApply() {
        if (fpApplyTimer) clearTimeout(fpApplyTimer);
        fpApplyTimer = setTimeout(function () {
            fpApplyTimer = null;
            try { fpApplyPass(); } catch (e) { /* ok */ }
            /* secondo pass: i mount on-demand (editor) a volte montano un
               po' dopo il primo mutations burst */
            setTimeout(function () {
                try { fpApplyPass(); } catch (e) { /* ok */ }
            }, 1400);
        }, 350);
    }
    function fpBootController() {
        if (typeof document === 'undefined' || !document.addEventListener) return;
        /* registra lo stato DOPO l'handler dell'host (bubble): la visibilita'
           del pannello al momento del record e' la verita' */
        document.addEventListener('click', function (ev) {
            const t = ev && ev.target;
            if (!t || !t.closest) return;
            let el = null;
            for (let i = 0; i < FP_BTNS.length && !el; i++) {
                try { if (t.closest(FP_BTNS[i].rec)) el = true; } catch (e) { /* ok */ }
            }
            if (el !== true) return;
            FP_BTNS.forEach(function (e) {
                try {
                    let hit = false;
                    if (t.closest(e.rec)) hit = true;
                    if (!hit) return;
                    if (e.probe && !document.querySelector(e.probe)) return;
                    fpRecord(e.c);
                } catch (err) { /* ok */ }
            });
        }, false);
        /* B1: Esc chiude il pannello visibile - capture con stopPropagation:
           con Fonti aperto la prioritae' "Esc = chiudi Fonti" */
        document.addEventListener('keydown', function (ev) {
            const k = ev && ev.key;
            if (k !== 'Escape' && k !== 'Esc') return;
            let closed = false;
            try {
                const roots = document.querySelectorAll('.fp21-root');
                for (let i = 0; i < roots.length; i++) {
                    if (!fpVisible(roots[i])) continue;
                    const c = roots[i].getAttribute('data-fp21');
                    if (c === 'schemi') {
                        /* tab: torna al primo tab visibile diverso da Fonti */
                        const tabs = document.querySelectorAll('.sc-side .sc-tab');
                        for (let j = 0; j < tabs.length; j++) {
                            const txt = String(tabs[j].textContent || '').trim();
                            if (txt && txt !== 'Fonti' &&
                                tabs[j].getClientRects().length > 0) {
                                tabs[j].click();
                                closed = true;
                                break;
                            }
                        }
                    } else {
                        const e = FP_BTNS.filter(x => x.c === c)[0];
                        const b = e ? fpFind(e.app, {
                            text: e.appText, visibleOnly: true
                        }) : null;
                        if (b) { b.click(); closed = true; }
                    }
                    break;   // primo pannello visibile gestito
                }
            } catch (e) { /* ok */ }
            if (closed) {
                if (ev.preventDefault) ev.preventDefault();
                if (ev.stopPropagation) ev.stopPropagation();
            }
        }, true);
        try {
            if (document.body && typeof MutationObserver !== 'undefined') {
                new MutationObserver(fpScheduleApply)
                    .observe(document.body, { childList: true, subtree: true });
                fpScheduleApply();
            } else {
                document.addEventListener('DOMContentLoaded', fpScheduleApply, false);
            }
        } catch (e) { /* ok */ }
    }
    fpBootController();

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
