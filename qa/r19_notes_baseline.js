/* ============================================================
   modules/notes.js — modulo "Appunti" della suite Studio.
   - Griglia note con ricerca e filtri (materia / tag)
   - Scelta foglio (quadretti | righe | puntini | bianco) e
     modalità (pagina singola | foglio infinito)
   - Editor disegno su canvas con Pointer Events: penna
     (3 tipi tratto), evidenziatore, gomma, testo, selezione,
     zoom/pan, undo/redo, import immagini e testi
   - Salvataggio automatico (debounce ~900ms) + thumbnail
   Nessuna dipendenza esterna: solo file locali.
   ============================================================ */
(function () {
    'use strict';

    // ---------- costanti ----------
    const PAPER = '#f7f5ef';
    const OUTER = '#0b0f1a';
    const FAM = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    const SHEET_LABELS = { quadretti: 'Quadretti', righe: 'Righe', puntini: 'Puntini', bianco: 'Bianco' };
    // "singola" resta accettata per retro-compatibilita: trattata come "quaderno"
    const MODE_LABELS = { quaderno: 'Quaderno', infinito: 'Foglio infinito' };

    const PEN_COLORS = [
        { label: 'Nero', hex: '#141414' },
        { label: 'Blu', hex: '#1f5fd6' },
        { label: 'Rosso', hex: '#d63b3b' },
        { label: 'Verde', hex: '#1f9d55' }
    ];
    const HL_COLORS = [
        { label: 'Giallo', hex: '#ffe14d' },
        { label: 'Verde', hex: '#6ee7a0' },
        { label: 'Rosa', hex: '#ff9ecb' },
        { label: 'Azzurro', hex: '#7cd3ff' }
    ];
    const PEN_SIZES = [2, 4, 8];
    const HL_SIZES = [14, 20, 26];
    const PEN_TYPES = [
        { id: 'pen', label: 'Penna tonda' },
        { id: 'pencil', label: 'Matita' },
        { id: 'marker', label: 'Pennarello' }
    ];
    const TOOLS = [
        { id: 'penna', label: 'Penna' },
        { id: 'evidenziatore', label: 'Evidenziatore' },
        { id: 'gomma', label: 'Gomma' },
        { id: 'testo', label: 'Testo' },
        { id: 'lazo', label: 'Lazo' },
        { id: 'selezione', label: 'Sposta' }
    ];

    // ---------- CSS aggiuntivo ----------
    App.style(
        '.nt-topbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center;padding:4px 0 8px;}' +
        '.nt-topbar .subject-input{flex:0 0 auto;flex-direction:row;align-items:center;}' +
        '.nt-topbar .subject-input>label{display:none;}' +
        '.nt-topbar .subject-field{min-width:170px;height:33px;padding:7px 10px;font-size:13.5px;}' +
        '.nt-title{background:var(--dark);border:1px solid var(--border);border-radius:9px;' +
        'padding:7px 10px;color:var(--text);font-size:14px;font-weight:700;min-width:170px;outline:none;font-family:inherit;}' +
        '.nt-title:focus{border-color:var(--accent);}' +
        '.nt-tags{background:var(--dark);border:1px solid var(--border);border-radius:9px;padding:7px 10px;' +
        'color:var(--text);font-size:13px;min-width:130px;outline:none;font-family:inherit;}' +
        '.nt-tags:focus{border-color:var(--accent);}' +
        '.nt-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:2px 0 8px;}' +
        '.nt-swatch{width:26px;height:26px;border-radius:50%;border:2px solid var(--border);cursor:pointer;padding:0;flex-shrink:0;}' +
        '.nt-swatch.active{border-color:var(--accent);box-shadow:0 0 0 2px rgba(249,151,74,.35);}' +
        '.nt-size{min-width:30px;padding:5px 6px;}' +
        '.nt-stage{position:absolute;inset:0;border:none;border-radius:0;background:#f7f5ef;overflow:hidden;}' +
        '.nt-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;}' +
        '.nt-overlay{position:absolute;inset:0;pointer-events:none;}' +
        '.nt-overlay textarea{position:absolute;pointer-events:auto;background:rgba(255,255,255,.97);' +
        'border:1.5px dashed #f9974a;border-radius:4px;padding:2px 4px;outline:none;overflow:hidden;' +
        'resize:both;line-height:1.35;font-family:' + FAM + ';}' +
        '.nt-zoom{position:absolute;right:10px;bottom:10px;background:rgba(14,19,32,.88);' +
        'border:1px solid var(--border);color:var(--muted);font-size:11.5px;padding:3px 9px;' +
        'border-radius:8px;pointer-events:none;}' +
        '#moduleView{position:relative;}' +
        '.nt-editor{position:absolute;inset:0;overflow:hidden;background:#f7f5ef;}' +
        /* ===== CHROME FLOTTANTE (stile FreeNotes) ===== */
        '.fn-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:8px 10px;z-index:10;pointer-events:none;background:linear-gradient(to bottom,rgba(18,21,32,.92),rgba(18,21,32,.55) 65%,rgba(18,21,32,0));}' +
        '.fn-top>*{pointer-events:auto;}' +
        '.fn-ic{width:34px;height:34px;border-radius:50%;background:rgba(28,32,48,.92);border:1px solid rgba(255,255,255,.1);color:#e8ecf4;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0;}' +
        '.fn-ic:hover{border-color:#f9974a;color:#f9974a;}' +
        '.fn-ic svg{width:17px;height:17px;}' +
        '.fn-title{flex:1;min-width:0;text-align:center;background:rgba(28,32,48,.8);border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:7px 16px;font-size:13.5px;font-weight:700;color:#eef1f7;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit;}' +
        '.fn-title:hover{border-color:#f9974a;}' +
        '.fn-pill{position:absolute;display:flex;align-items:center;gap:3px;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:6px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:9;}' +
        '.fn-pill-left{top:56px;left:12px;}' +
        '.fn-pill-right{top:56px;right:12px;}' +
        '.fn-tb{width:34px;height:34px;border-radius:50%;background:transparent;border:none;color:#dfe5f0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;position:relative;}' +
        '.fn-tb:hover{background:rgba(255,255,255,.1);}' +
        '.fn-tb.active{background:#f9974a;color:#141824;}' +
        /* toggle MODALITA' (Migliora scrittura / Fonti): bordo, MAI riempimento pieno (fix B5) */
        '.fn-tb.mode{border:1.5px solid #f9974a;background:transparent;color:#f9974a;}' +
        '.fn-tb.mode:hover{background:rgba(249,151,74,.16);}' +
        '.fn-tb:disabled{opacity:.32;cursor:default;}' +
        '.fn-tb svg{width:18px;height:18px;pointer-events:none;}' +
        '.fn-sep{width:1px;height:20px;background:rgba(255,255,255,.16);margin:0 3px;flex-shrink:0;}' +
        '.fn-dot{position:absolute;right:2px;bottom:2px;width:9px;height:9px;border-radius:50%;border:1.5px solid rgba(20,24,36,.92);pointer-events:none;}' +
        '.fn-zoom{position:absolute;top:106px;left:12px;display:flex;align-items:center;gap:2px;background:rgba(58,64,82,.94);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 5px;z-index:9;color:#e8ecf4;box-shadow:0 6px 16px rgba(0,0,0,.3);}' +
        '.fn-zoom .fn-zpct{background:none;border:none;color:inherit;font-family:inherit;font-size:12px;font-weight:800;padding:4px 8px;cursor:pointer;border-radius:999px;}' +
        '.fn-zoom .fn-zpct:hover{background:rgba(255,255,255,.14);}' +
        '.fn-zoom .fn-lock{width:26px;height:26px;border-radius:50%;background:none;border:none;color:inherit;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}' +
        '.fn-zoom .fn-lock svg{width:14px;height:14px;}' +
        '.fn-zoom .fn-lock.active{background:#f9974a;color:#141824;}' +
        '.fn-pages{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:5px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:9;}' +
        '.fn-pages .fn-tb{width:30px;height:30px;}' +
        '.fn-pages .fn-plabel{font-size:12px;font-weight:700;color:#dfe5f0;min-width:92px;text-align:center;}' +
        '.fn-pages .fn-padd{background:#f9974a;color:#141824;border:none;border-radius:999px;font-size:12px;font-weight:800;padding:6px 13px;cursor:pointer;font-family:inherit;}' +
        '.fn-pages .fn-padd:hover{background:#ffad66;}' +
        '.fn-pop{position:absolute;background:#1a2030;border:1px solid #2a3142;border-radius:16px;padding:14px;box-shadow:0 16px 44px rgba(0,0,0,.5);z-index:12;display:none;max-height:78vh;overflow-y:auto;color:#f5f7fa;}' +
        '.fn-pop.show{display:block;}' +
        '.fn-pop-color{top:106px;right:12px;width:270px;}' +
        '.fn-pop-meta{top:52px;left:50%;transform:translateX(-50%);width:min(560px,94vw);}' +
        '.fn-pop-paper{top:52px;right:12px;width:255px;}' +
        '.fn-pop-zoom{top:106px;left:12px;width:170px;}' +
        '.fn-pop-zoom.show{display:flex;flex-direction:column;gap:6px;}' +
        '.fn-pop h4{font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;color:#8b95a5;margin:2px 0 10px;}' +
        '.fn-block{display:inline-flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}' +
        '.fn-zbtn{background:#202637;border:1px solid #2a3142;color:#f5f7fa;border-radius:9px;padding:8px 0;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;}' +
        '.fn-zbtn:hover{border-color:#f9974a;}' +
        '.fn-hint{font-size:11.5px;color:#8b95a5;margin-top:8px;line-height:1.45;}' +
        '.fn-savestate{font-size:12px;color:#7fc8a9;font-weight:700;margin-top:4px;}' +
        '.fn-pop-help{top:106px;right:12px;width:255px;}' +
        '.fn-slider-row{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;}' +
        '.fn-slider-lab{font-size:11.5px;font-weight:700;color:#8b95a5;text-transform:uppercase;letter-spacing:.5px;}' +
        '.fn-slider-row input[type=range]{width:100%;accent-color:#f9974a;cursor:pointer;}' +
        '.fn-slider-val{font-size:12px;font-weight:800;color:#f9974a;text-align:right;}' +
        '.fn-erasecur{position:absolute;border:1.6px solid rgba(249,151,74,.95);border-radius:50%;background:rgba(249,151,74,.10);pointer-events:none;z-index:8;display:none;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(0,0,0,.35);}' +
        '.nt-thumb{width:100%;height:116px;object-fit:cover;object-position:top center;display:block;' +
        'background:var(--dark);border:1px solid var(--border);border-radius:8px;margin-bottom:9px;}' +
        '.nt-thumb-ph{height:116px;display:flex;align-items:center;justify-content:center;background:var(--dark);' +
        'border:1px dashed var(--border);border-radius:8px;color:var(--muted);margin-bottom:9px;}' +
        '.nt-thumb-ph svg{width:30px;height:30px;opacity:.5;}' +
        '.nt-pages{display:flex;gap:6px;align-items:center;padding:2px 0 7px;flex-wrap:wrap;}' +
        '.nt-pages .nt-pg-label{font-size:12.5px;color:var(--muted);min-width:96px;text-align:center;}' +
        '.nt-size-ctl{display:inline-flex;gap:6px;align-items:center;}' +
        '.nt-size-ctl input[type=range]{width:110px;accent-color:var(--accent);cursor:pointer;}' +
        '.nt-size-ctl input[type=number]{width:58px;background:var(--dark);border:1px solid var(--border);' +
        'border-radius:7px;color:var(--text);padding:4px 5px;font-size:12.5px;outline:none;font-family:inherit;}' +
        '.nt-size-ctl input[type=number]:focus{border-color:var(--accent);}' +
        '.nt-size-ctl .nt-size-unit{font-size:11.5px;color:var(--muted);min-width:36px;}' +
        /* ===== PANNELLO LATERALE "FONTI" (A3): fisso a SINISTRA, NON popover ===== */
        '.fn-side{position:absolute;left:12px;top:152px;bottom:16px;width:300px;display:none;' +
        'flex-direction:column;gap:8px;background:#1a2030;border:1px solid #2a3142;border-radius:16px;' +
        'padding:12px;z-index:11;box-shadow:0 16px 44px rgba(0,0,0,.5);color:#f5f7fa;font-family:' + FAM + ';}' +
        '.fn-side.show{display:flex;}' +
        '.fn-side-head{display:flex;align-items:center;gap:8px;}' +
        '.fn-side-title{flex:1;font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;color:#8b95a5;font-weight:700;}' +
        '.fn-side-search{box-sizing:border-box;width:100%;background:#202637;border:1px solid #2a3142;' +
        'border-radius:9px;color:#f5f7fa;padding:7px 9px;font-size:13px;outline:none;font-family:inherit;}' +
        '.fn-side-search:focus{border-color:#f9974a;}' +
        '.fn-flist{display:flex;flex-direction:column;gap:4px;max-height:38%;overflow-y:auto;}' +
        '.fn-fitem{display:flex;flex-direction:column;gap:2px;text-align:left;background:#202637;' +
        'border:1px solid #2a3142;color:#e8ecf4;border-radius:9px;padding:7px 9px;font-size:12.5px;' +
        'cursor:pointer;font-family:inherit;}' +
        '.fn-fitem:hover{border-color:#f9974a;}' +
        '.fn-fitem.active{border-color:#f9974a;background:rgba(249,151,74,.14);}' +
        '.fn-fkind{font-size:10.5px;color:#8b95a5;text-transform:uppercase;letter-spacing:.5px;}' +
        '.fn-fprev{flex:1;min-height:60px;overflow-y:auto;background:#151a28;border:1px solid #2a3142;' +
        'border-radius:10px;padding:9px;font-size:12.5px;line-height:1.5;color:#cfd6e4;' +
        'white-space:pre-wrap;overflow-wrap:anywhere;}' +
        '.fn-finsert{background:#f9974a;border:none;color:#141824;border-radius:9px;padding:8px 0;' +
        'font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;}' +
        '.fn-finsert:hover{background:#ffad66;}' +
        '.fn-finsert:disabled{opacity:.4;cursor:default;}'
    );

    // ---------- stato modulo ----------
    let container = null;
    let ed = null;

    // R14 L-P0 - strumentazione LATENZA (sola misura, nessun cambio di
    // comportamento): trace raw/evt/paint + controllo intensita' per T2.
    window.__ink = {
        trace: [],
        version: 'p0',
        clear: function () { this.trace.length = 0; },
        setHelp: function (v) {
            if (!ed) return;
            ed.helpAssist = v;
            ed.helpSmooth = v;
            ed.helpOn = true;   // il toggle "migliora scrittura" deve essere
                                // ON per misurare l'effetto dell'intensita'
        },
        state: function () {
            return ed ? { tool: ed.tool, helpOn: !!ed.helpOn,
                          assist: ed.helpAssist, smooth: ed.helpSmooth,
                          active: !!ed.active, shpOn: !!ed.shpOn,
                          arrowOn: !!ed.arrowOn, holdMs: ed.holdMs,
                          dw: ed.doc ? ed.doc.w : 0,
                          dh: ed.doc ? ed.doc.h : 0,
                          pointers: ed.pointers ? ed.pointers.size : -1,
                          tool: ed.tool } : null;
        },
        pageAt: function (wx, wy) {
            try { return inPage({ x: wx, y: wy }); } catch (e) { return 'err'; }
        },
        // R14 A4: setter per test/T2 (persistenza localStorage)
        setShaping: function (shp, arrow, holdMs) {
            if (!ed) return null;
            if (shp !== undefined) ed.shpOn = !!shp;
            if (arrow !== undefined) ed.arrowOn = !!arrow;
            if (holdMs !== undefined) {
                ed.holdMs = Math.min(800, Math.max(200, Number(holdMs) || 350));
            }
            saveShaping();
            return window.__ink.state();
        },
        objects: function () {
            return ed && ed.doc ? JSON.parse(JSON.stringify(ed.doc.objects)) : [];
        },
        // coordinate cliente -> mondo (per i test geometrici in jsdom)
        toWorld: function (x, y) {
            return toWorld({ clientX: x, clientY: y });
        }
    };
    function saveShaping() {
        if (!ed) return;
        try {
            localStorage.setItem('nt14_shaping', JSON.stringify(
                { shpOn: ed.shpOn, arrowOn: ed.arrowOn, holdMs: ed.holdMs }));
        } catch (e) { /* storage non disponibile: stato in memoria */ }
    }
    const measureCtx = document.createElement('canvas').getContext('2d');

    // ---------- utilità ----------
    function uuid() { return StudyStore.uuid(); }

    function btn(cls, html, onClick) {
        const b = App.el('button', cls);
        b.type = 'button';
        b.innerHTML = html;
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    function parseDoc(content) {
        try {
            const d = JSON.parse(content);
            if (d && (Array.isArray(d.objects) || Array.isArray(d.pages))) return d;
        } catch (e) { /* contenuto non valido */ }
        return null;
    }

    // Modalita: "quaderno" (ex "singola", retrocompatibile) oppure "infinito".
    // Il quaderno supporta PIU' pagine: pages:[{objects:[...]}, ...] + page:<indice>.
    // Il foglio infinito resta com'e': solo objects (12000x8000).
    function defaultDoc(sheet, mode) {
        const inf = mode === 'infinito';
        const d = { sheet: sheet || 'quadretti', mode: inf ? 'infinito' : 'quaderno', w: inf ? 12000 : 1600, h: inf ? 8000 : 1100 };
        if (inf) d.objects = [];
        else { d.pages = [{ objects: [] }]; d.page = 0; d.objects = []; }
        return d;
    }

    // Migrazione retrocompatibile + riferimento vivo: doc.objects punta sempre
    // agli oggetti della pagina corrente (cosi' tutto il codice esistente,
    // undo/redo/disegno/salvataggio, continua a funzionare invariato).
    function normalizeDoc(doc) {
        if (!doc) return defaultDoc('quadretti', 'quaderno');
        if (doc.mode === 'infinito') {
            if (!Array.isArray(doc.objects)) doc.objects = [];
            return doc;
        }
        if (!doc.mode || doc.mode === 'singola') doc.mode = 'quaderno';
        if (!Array.isArray(doc.pages) || !doc.pages.length) {
            doc.pages = [{ objects: Array.isArray(doc.objects) ? doc.objects : [] }];
        }
        doc.pages.forEach(p => { if (!Array.isArray(p.objects)) p.objects = []; });
        if (typeof doc.page !== 'number' || doc.page < 0 || doc.page >= doc.pages.length) doc.page = 0;
        doc.objects = doc.pages[doc.page].objects;
        return doc;
    }

    function isQuaderno(doc) { return !!(doc && doc.mode !== 'infinito'); }

    function docObjects(doc) {
        if (!doc) return [];
        if (Array.isArray(doc.pages) && doc.pages.length) {
            const i = (typeof doc.page === 'number' && doc.page >= 0 && doc.page < doc.pages.length) ? doc.page : 0;
            return Array.isArray(doc.pages[i].objects) ? doc.pages[i].objects : [];
        }
        return Array.isArray(doc.objects) ? doc.objects : [];
    }

    // copia del doc pronta per il salvataggio: nel quaderno gli oggetti vivono
    // solo in pages (niente duplicazione objects/pages nel JSON)
    function serializableDoc(doc) {
        const d = {};
        Object.keys(doc).forEach(k => { d[k] = doc[k]; });
        if (d.mode !== 'infinito') delete d.objects;
        return d;
    }

    function noteText(doc) {
        const objs = docObjects(doc);
        if (!objs.length) return '';
        return objs
            .filter(o => o.t === 'text' && o.text)
            .map(o => String(o.text).replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' \u2022 ');
    }

    function itemPreview(item) {
        const doc = parseDoc(item.content);
        const t = noteText(doc);
        if (t) return t.slice(0, 180);
        return String(item.description || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    }

    // ---------- modale testo (rinomina) ----------
    function askText(title, label, value) {
        return new Promise(resolve => {
            const ov = App.el('div', 'modal-overlay');
            const inputId = 'ntIn-' + uuid();
            const m = App.el('div', 'modal modal-sm');
            m.innerHTML =
                '<div class="modal-header"><div class="modal-title">' + App.esc(title) + '</div></div>' +
                '<div class="modal-body"><div class="field"><label for="' + inputId + '">' + App.esc(label) + '</label>' +
                '<input type="text" id="' + inputId + '" value="' + App.esc(value || '') + '"></div>' +
                '<div class="form-actions"></div></div>';
            const actions = m.querySelector('.form-actions');
            let done = false;
            function finish(res) {
                if (done) return;
                done = true;
                ov.classList.remove('show');
                setTimeout(() => { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 180);
                resolve(res);
            }
            const cancel = App.el('button', 'btn-secondary', 'Annulla');
            cancel.type = 'button';
            cancel.addEventListener('click', () => finish(null));
            const ok = App.el('button', 'btn-accent', 'Salva');
            ok.type = 'button';
            ok.addEventListener('click', () => finish(input.value.trim() || null));
            actions.appendChild(cancel);
            actions.appendChild(ok);
            const input = m.querySelector('input');
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); }
                if (e.key === 'Escape') finish(null);
            });
            ov.appendChild(m);
            document.body.appendChild(ov);
            requestAnimationFrame(() => ov.classList.add('show'));
            setTimeout(() => { input.focus(); input.select(); }, 60);
        });
    }

    // ============================================================
    // LISTA NOTE
    // ============================================================
    async function renderList() {
        teardownEditor();
        container.style.overflow = '';
        container.style.padding = '';
        container.innerHTML = '';

        const btnNew = btn('tool-btn',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Nuova nota',
            () => renderChooser());
        container.appendChild(App.header('Appunti', 'Le tue note a mano e con la tastiera', [btnNew]));

        // cartelle: barra "Nuova cartella" + breadcrumb (navigazione -> re-render)
        container.appendChild(Folders.bar('note', () => renderList()));

        const bar = App.el('div', 'toolbar plain');
        const search = App.el('input', 'search-input');
        search.type = 'text';
        search.placeholder = 'Cerca negli appunti\u2026';
        const selMat = App.el('select', 'mini');
        const selTag = App.el('select', 'mini');
        bar.appendChild(search);
        bar.appendChild(selMat);
        bar.appendChild(selTag);
        container.appendChild(bar);

        const wrap = App.el('div', '');
        container.appendChild(wrap);

        let all = [];
        try { all = await StudyStore.listItems('note') || []; } catch (e) { console.error('Elenco note:', e); }

        // opzioni filtri
        let subjects = [];
        try { subjects = await StudyStore.listSubjects() || []; } catch (e) { /* ok */ }
        const colorOf = {};
        subjects.forEach(s => { colorOf[s.name] = s.color; });

        const optAll = App.el('option', null, 'Tutte le materie');
        optAll.value = '';
        selMat.appendChild(optAll);
        subjects.forEach(s => {
            const o = App.el('option', null, App.esc(s.name));
            o.value = s.name;
            selMat.appendChild(o);
        });

        const tags = {};
        all.forEach(it => String(it.tags || '').split(',').forEach(t => { t = t.trim(); if (t) tags[t] = true; }));
        const optTagAll = App.el('option', null, 'Tutti i tag');
        optTagAll.value = '';
        selTag.appendChild(optTagAll);
        Object.keys(tags).sort().forEach(t => {
            const o = App.el('option', null, App.esc(t));
            o.value = t;
            selTag.appendChild(o);
        });

        function refresh() {
            const q = search.value.trim().toLowerCase();
            const mat = selMat.value;
            const tag = selTag.value;
            // solo le note della cartella corrente + filtro materia normalizzato
            let items = Folders.filterItems(all.slice(), 'note');
            if (mat) items = items.filter(i => SubjectInput.normalize(i.materia) === SubjectInput.normalize(mat));
            if (tag) items = items.filter(i => String(i.tags || '').split(',').map(s => s.trim()).indexOf(tag) >= 0);
            if (q) {
                items = items.filter(i =>
                    String(i.title || '').toLowerCase().indexOf(q) >= 0 ||
                    noteText(parseDoc(i.content)).toLowerCase().indexOf(q) >= 0 ||
                    String(i.description || '').toLowerCase().indexOf(q) >= 0);
            }
            items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
            renderGrid(items);
        }

        function renderGrid(items) {
            wrap.innerHTML = '';
            // griglia cartelle (prima della griglia note)
            wrap.appendChild(Folders.grid('note', () => renderList()));
            if (!all.length) {
                wrap.appendChild(App.empty(App.ICONS.notes,
                    'Nessuna nota ancora. Crea il tuo primo appunto: scegli foglio e modalità e inizia a scrivere.',
                    '+ Nuova nota', () => renderChooser()));
                return;
            }
            if (!items.length) {
                wrap.appendChild(App.empty(App.ICONS.notes, 'Nessuna nota corrisponde ai filtri.'));
                return;
            }
            const grid = App.el('div', 'grid-cards');
            items.forEach(it => {
                const card = App.el('div', 'card clickable');
                card.tabIndex = 0;
                const thumb = it.thumbnail
                    ? '<img class="nt-thumb" src="' + App.esc(it.thumbnail) + '" alt="">'
                    : '<div class="nt-thumb-ph">' + (App.ICONS.notes || '') + '</div>';
                const chips = [];
                if (it.materia) {
                    const c = colorOf[it.materia];
                    chips.push('<span class="chip">' + (c ? '<span class="dot" style="background:' + App.esc(c) + '"></span>' : '') + App.esc(it.materia) + '</span>');
                }
                String(it.tags || '').split(',').forEach(t => {
                    t = t.trim();
                    if (t) chips.push('<span class="chip">#' + App.esc(t) + '</span>');
                });
                const prev = itemPreview(it);
                card.innerHTML =
                    thumb +
                    '<h4>' + App.esc(it.title || 'Senza titolo') + '</h4>' +
                    '<div class="meta"><span>' + App.esc(App.fmtDate(it.updated_at || it.created_at)) + '</span></div>' +
                    (chips.length ? '<div class="meta" style="margin-top:7px">' + chips.join('') + '</div>' : '') +
                    (prev ? '<div class="preview">' + App.esc(prev) + '</div>' : '');
                card.addEventListener('click', e => {
                    if (e.target.closest('.card-actions')) return;
                    openEditor(it.id);
                });
                card.addEventListener('keydown', e => { if (e.key === 'Enter') openEditor(it.id); });

                const actions = App.el('div', 'card-actions');
                const bOpen = btn('', 'Apri', () => openEditor(it.id));
                const bRen = btn('', 'Rinomina', async () => {
                    const t = await askText('Rinomina nota', 'Titolo della nota', it.title);
                    if (!t) return;
                    try { await StudyStore.renameItem(it.id, t); } catch (e) { console.error(e); }
                    refresh();
                });
                const bDel = btn('danger', 'Elimina', async () => {
                    if (!confirm('Eliminare la nota \u201c' + (it.title || '') + '\u201d? L\u2019operazione non è annullabile.')) return;
                    try { await StudyStore.deleteItem(it.id); } catch (e) { console.error(e); }
                    all = all.filter(x => x.id !== it.id);
                    refresh();
                });
                // sposta in cartella: recupera l'elemento completo e risalva
                // solo con folder_id aggiunto (niente azzeramenti di content)
                const bMove = Folders.moveSelect('note', it.folder_id || '', async fid => {
                    if (fid === (it.folder_id || '')) return;
                    try {
                        const full = await StudyStore.getItem(it.id);
                        if (full) {
                            full.folder_id = fid;
                            await StudyStore.saveItem(full);
                            const idx = all.findIndex(x => x.id === it.id);
                            if (idx >= 0) all[idx] = full;
                            it.folder_id = fid;
                        }
                    } catch (e) { console.error('Sposta nota:', e); }
                    refresh();
                });
                actions.appendChild(bOpen);
                actions.appendChild(bRen);
                actions.appendChild(bDel);
                actions.appendChild(bMove);
                card.appendChild(actions);
                grid.appendChild(card);
            });
            wrap.appendChild(grid);
        }

        search.addEventListener('input', refresh);
        selMat.addEventListener('change', refresh);
        selTag.addEventListener('change', refresh);
        refresh();
    }

    // ============================================================
    // SCELTA FOGLIO / MODALITÀ
    // ============================================================
    async function renderChooser() {
        teardownEditor();
        container.style.overflow = '';
        container.style.padding = '';
        container.innerHTML = '';
        container.appendChild(App.header('Nuova nota', 'Scegli il tipo di foglio e la modalità'));

        let subjects = [];
        try { subjects = await StudyStore.listSubjects() || []; } catch (e) { /* ok */ }

        const card = App.el('div', 'card');
        card.style.maxWidth = '640px';
        card.style.margin = '10px auto 0';
        card.style.padding = '24px';

        let sheet = 'quadretti';
        let mode = 'quaderno';   // "singola" (retro) viene trattata come quaderno

        const f1 = App.el('div', 'field');
        f1.appendChild(App.el('label', null, 'Tipo di foglio'));
        const row1 = App.el('div', 'choice-row');
        Object.keys(SHEET_LABELS).forEach(k => {
            const c = btn('choice' + (k === sheet ? ' active' : ''), SHEET_LABELS[k], () => {
                sheet = k;
                row1.querySelectorAll('.choice').forEach(x => x.classList.remove('active'));
                c.classList.add('active');
            });
            row1.appendChild(c);
        });
        f1.appendChild(row1);
        card.appendChild(f1);

        const f2 = App.el('div', 'field');
        f2.appendChild(App.el('label', null, 'Modalità'));
        const row2 = App.el('div', 'choice-row');
        Object.keys(MODE_LABELS).forEach(k => {
            const c = btn('choice' + (k === mode ? ' active' : ''), MODE_LABELS[k], () => {
                mode = k;
                row2.querySelectorAll('.choice').forEach(x => x.classList.remove('active'));
                c.classList.add('active');
            });
            row2.appendChild(c);
        });
        f2.appendChild(row2);
        const hint = App.el('div', 'hint');
        hint.style.cssText = 'font-size:12.5px;color:var(--muted);margin-top:8px';
        hint.textContent = 'Quaderno: riquadro 1600\u00d71100 con pi\u00f9 pagine (aggiungine con "+ Pagina" nell\u2019editor); foglio infinito: riquadro 12000\u00d78000 da spostare con il pan.';
        f2.appendChild(hint);
        card.appendChild(f2);

        // materia opzionale già assegnabile nell\u2019editor
        const f3 = App.el('div', 'field');
        const subjCho = SubjectInput.create({ label: 'Materia (facoltativa)', placeholder: 'Inserisci materia\u2026' });
        f3.appendChild(subjCho);
        card.appendChild(f3);

        const actions = App.el('div', 'form-actions');
        actions.appendChild(btn('btn-secondary', 'Annulla', () => renderList()));
        actions.appendChild(btn('btn-accent', 'Crea nota', async () => {
            const doc = defaultDoc(sheet, mode);
            const now = new Date();
            const title = 'Nota del ' + now.toLocaleDateString('it-IT');
            let saved = null;
            const matCho = SubjectInput.normalize(subjCho.getValue());
            try {
                saved = await StudyStore.saveItem({
                    kind: 'note',
                    title: title,
                    content: JSON.stringify(doc),
                    materia: matCho,
                    folder_id: Folders.get('note'),
                    tags: '',
                    description: '',
                    thumbnail: ''
                });
                if (matCho) SubjectInput.remember(matCho).catch(() => { /* ok */ });
            } catch (e) { console.error('Creazione nota:', e); }
            if (saved && saved.id) openEditor(saved);
            else renderList();
        }));
        card.appendChild(actions);

        container.appendChild(card);
    }

    // ============================================================
    // EDITOR
    // ============================================================
    function fontOf(o) {
        return (o.italic ? 'italic ' : '') + (o.bold ? '700 ' : '400 ') + (o.size || 20) + 'px ' + FAM;
    }

    function measureTextObj(o) {
        measureCtx.font = fontOf(o);
        const lines = String(o.text || '').split('\n');
        let w = 10;
        lines.forEach(l => { w = Math.max(w, measureCtx.measureText(l || ' ').width); });
        o.w = Math.ceil(w + 8);
        o.h = Math.ceil(Math.max(1, lines.length) * (o.size || 20) * 1.35);
    }

    function getImage(src) {
        if (!ed) return null;
        if (!ed.images[src]) {
            const img = new Image();
            img.onload = () => { if (ed) drawAll(); };
            img.onerror = () => { /* immagine non caricata */ };
            img.src = src;
            ed.images[src] = img;
        }
        return ed.images[src];
    }

    function drawSheet(ctx, doc, pw, ph, vis) {
        const s = doc.sheet;
        if (s === 'bianco') return;
        // limita il disegno del foglio alla zona visibile (importante
        // per il foglio infinito 6000\u00d74000, altrimenti troppi loop)
        const vx0 = vis ? vis.x0 : 0;
        const vy0 = vis ? vis.y0 : 0;
        const vx1 = vis ? vis.x1 : pw;
        const vy1 = vis ? vis.y1 : ph;
        if (vx1 <= vx0 || vy1 <= vy0) return;
        ctx.save();
        if (s === 'quadretti') {
            ctx.strokeStyle = 'rgba(80,120,180,.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = Math.floor(vx0 / 24) * 24; x <= vx1; x += 24) { ctx.moveTo(x, vy0); ctx.lineTo(x, vy1); }
            for (let y = Math.floor(vy0 / 24) * 24; y <= vy1; y += 24) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
            ctx.stroke();
        } else if (s === 'righe') {
            ctx.strokeStyle = 'rgba(80,120,180,.32)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            let y = Math.ceil(vy0 / 32) * 32;
            for (; y <= vy1; y += 32) { ctx.moveTo(vx0, y); ctx.lineTo(vx1, y); }
            ctx.stroke();
        } else if (s === 'puntini') {
            ctx.fillStyle = 'rgba(60,80,110,.45)';
            const sx = Math.max(12, Math.ceil((vx0 - 12) / 24) * 24 + 12);
            const sy = Math.max(12, Math.ceil((vy0 - 12) / 24) * 24 + 12);
            for (let x = sx; x <= vx1; x += 24) {
                for (let y2 = sy; y2 <= vy1; y2 += 24) {
                    ctx.beginPath();
                    ctx.arc(x, y2, 1.1, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }

    // zoom di adattamento pagina -> viewport: la pagina COVRE lo schermo
    // (stato al limite: sotto/equalo fit la camera e' statica; sopra il fit
    // la pagina e' piu' grande dello schermo e si puo' panare, clampato)
    function zoomFit() {
        if (!ed) return 1;
        const cw = ed.canvas.width / ed.dpr, ch = ed.canvas.height / ed.dpr;
        return Math.max(cw / ed.doc.w, ch / ed.doc.h);
    }

    // STATO CAMERA:
    //  - scale <= fit: pagina centrata e STATICA (pan disabilitato di fatto:
    //    ogni tentativo di trascinare viene ri-centrato all'istante)
    //  - scale > fit: pan abilitato ma clampato: la viewport non esce
    //    mai dai bordi pagina -> il nero non compare ai bordi schermo
    function clampPan() {
        if (!ed) return;
        const cw = ed.canvas.width / ed.dpr, ch = ed.canvas.height / ed.dpr;
        const doc = ed.doc;
        const fit = zoomFit();
        if (ed.scale <= fit + 1e-6) {
            // statico e centrato
            ed.tx = (cw - doc.w * ed.scale) / 2;
            ed.ty = (ch - doc.h * ed.scale) / 2;
            return;
        }
        const pw = doc.w * ed.scale, ph = doc.h * ed.scale;
        if (pw <= cw) ed.tx = (cw - pw) / 2;
        else ed.tx = Math.min(0, Math.max(cw - pw, ed.tx));
        if (ph <= ch) ed.ty = (ch - ph) / 2;
        else ed.ty = Math.min(0, Math.max(ch - ph, ed.ty));
    }

    // il punto (mondo) e' dentro la pagina? fuori = nero = nessun effetto
    function inPage(p) {
        if (!ed) return false;
        return p.x >= 0 && p.y >= 0 && p.x <= ed.doc.w && p.y <= ed.doc.h;
    }

    function visibleWorld() {
        const cw = ed.canvas.width / ed.dpr, ch = ed.canvas.height / ed.dpr;
        return {
            x0: (-ed.tx) / ed.scale,
            y0: (-ed.ty) / ed.scale,
            x1: (cw - ed.tx) / ed.scale,
            y1: (ch - ed.ty) / ed.scale
        };
    }

    // ==================== R14 L - pipeline inchiostro ====================
    // One Euro filter: filtro INCREMENTALE a latenza costante (L1). I
    // parametri sono FISSI: l'Intensita' aiuto NON entra qui (L2: il lag e'
    // identico a intensita' 0/50/100).
    function mkOneEuro(minCutoff, beta, dCutoff) {
        const mc = (minCutoff === undefined) ? 1.5 : minCutoff;
        const bt = (beta === undefined) ? 0.1 : beta;
        const dc = (dCutoff === undefined) ? 1.0 : dCutoff;
        let x = 0, y = 0, dx = 0, dy = 0, tPrev = null, init = false;
        function alpha(cut, dt) {
            const tau = 1 / (2 * Math.PI * cut);
            return 1 / (1 + tau / dt);
        }
        return {
            filter: function (nx, ny, t) {
                if (!init) {
                    x = nx; y = ny; tPrev = t; init = true;
                    return { x: nx, y: ny };
                }
                let dt = (t - tPrev) / 1000;
                if (!(dt > 0) || dt > 0.5) dt = 1 / 60;
                tPrev = t;
                const ndx = (nx - x) / dt, ndy = (ny - y) / dt;
                const ad = alpha(dc, dt);
                dx += ad * (ndx - dx);
                dy += ad * (ndy - dy);
                const cut = mc + bt * Math.sqrt(dx * dx + dy * dy);
                const a = alpha(cut, dt);
                x += a * (nx - x);
                y += a * (ny - y);
                return { x: x, y: y };
            },
            // snap: porta lo stato del filtro sul punto reale (convergenza L3)
            snap: function (nx, ny, t) {
                x = nx; y = ny; dx = 0; dy = 0; tPrev = t; init = true;
            }
        };
    }

    // render del buffer punti SOLO via requestAnimationFrame (L1): un frame
    // per vsync, nessun drawAll sincrono durante il tratto.
    let inkRafId = 0;
    function scheduleInkFrame() {
        if (inkRafId) return;
        inkRafId = requestAnimationFrame(inkFrame);
    }
    function inkFrame() {
        inkRafId = 0;
        if (!ed || !ed.active) return;
        const now = performance.now();
        // L3: puntatore fermo -> la punta renderizzata converge al punto
        // reale ENTRO <=2 frame (snap al primo frame di quiete)
        // R14 A1/A3: hold-still >= holdMs (default 350ms): stabilizzazione
        // del tratto in pausa e, se riconosciuto, snap a shape DURANTE il
        // fermo (il rilascio resta l'altro trigger di riconoscimento)
        if (!ed.inkHeld && ed.inkLastMoveT &&
            (now - ed.inkLastMoveT) >= (ed.holdMs || 350)) {
            ed.inkHeld = true;
            const oAct = ed.active;
            if (ed.helpOn && oAct.pts.length >= 3) {
                inkEndCleanup(oAct);   // A3: rimozione tremolio in pausa
            }
            if (ed.shpOn && oAct.pts.length >= 5) {
                const recH = recognizeStroke(oAct.pts, ed.inkSnapAmp || 0);
                if (recH) {
                    if (window.__ink) {
                        window.__ink.trace.push({ k: 'stop',
                            t: performance.now(), hold: true });
                    }
                    ed.active = null;
                    ed.helpAnchor = null;
                    ed.strokeFromPen = false;
                    ed.inkFx = null;
                    ed.inkLastRaw = null;
                    finalizeStrokeWithShape(oAct, recH);
                    return;
                }
            }
        }
        if (ed.inkFx && ed.inkLastRaw && (now - (ed.inkLastEvt || 0)) > 16) {
            ed.inkFx.snap(ed.inkLastRaw.x, ed.inkLastRaw.y, now);
            const pts = ed.active.pts;
            const l = pts[pts.length - 1];
            if (l) { l[0] = ed.inkLastRaw.x; l[1] = ed.inkLastRaw.y; }
        }
        drawAll();
        if (window.__ink && ed.active && ed.active.pts.length) {
            const l = ed.active.pts[ed.active.pts.length - 1];
            window.__ink.trace.push({ k: 'paint', t: performance.now(),
                                      n: ed.active.pts.length,
                                      x: l[0], y: l[1] });
        }
        // frame continui FINCHE' il tratto e' attivo: senza questo, dopo
        // l'ultimo evento non arrivava piu' nessun frame e lo snap di
        // quiete (L3) non partiva mai (settle=MAI misurato al DOPO t1)
        if (ed.active) scheduleInkFrame();
    }

    // L2: Intensita' aiuto influenza SOLO la pulizia/stabilizzazione di
    // FINE TRATTO (+ ampiezza dello snap, inkSnapAmp usato dallo shaping A).
    // Mai nel percorso live (latenza invariante).
    function inkEndCleanup(o) {
        if (!ed || !o || o.t !== 'stroke' || !o.pts || o.pts.length < 3) return;
        if (o.tool === 'highlighter') return;
        // snap finale: l'ultimo punto diventa il punto REALE (verita')
        if (ed.inkLastRaw) {
            const l = o.pts[o.pts.length - 1];
            l[0] = ed.inkLastRaw.x;
            l[1] = ed.inkLastRaw.y;
        }
        if (!ed.helpOn) return;   // toggle spento -> scrittura grezza
        const a = ed.helpAssist || 0;
        const s = ed.helpSmooth || 0;
        ed.inkSnapAmp = a;        // ampiezza snap per A1 (shaping)
        const pts = o.pts;
        // (b) pulizia/fissaggio di fine tratto con la Forza aiuto (a):
        // rimozione tremolio (media locale sui punti interni)
        if (a > 0) {
            const src = pts.map(pt => [pt[0], pt[1]]);
            for (let i = 1; i < pts.length - 1; i++) {
                const mx = (src[i - 1][0] + src[i][0] + src[i + 1][0]) / 3;
                const my = (src[i - 1][1] + src[i][1] + src[i + 1][1]) / 3;
                pts[i][0] += (mx - pts[i][0]) * (0.3 * a);
                pts[i][1] += (my - pts[i][1]) * (0.3 * a);
            }
        }
        // (a) smussamento righe (helpSmooth): media mobile storica, ora SOLO
        // a fine tratto (prima era live e aggiungeva lag percepito)
        if (s > 0 && pts.length >= 3) {
            const m = 2 + Math.round(s * 6);
            const copy = pts.map(pt => [pt[0], pt[1]]);
            const alpha = 0.25 + s * 0.5;
            for (let i = 0; i < pts.length; i++) {
                const from = Math.max(0, i - m + 1);
                let sx = 0, sy = 0, n = 0;
                for (let j = from; j <= i; j++) { sx += copy[j][0]; sy += copy[j][1]; n++; }
                pts[i][0] += (sx / n - copy[i][0]) * alpha;
                pts[i][1] += (sy / n - copy[i][1]) * alpha;
            }
            const l = pts[pts.length - 1];
            if (ed.inkLastRaw) { l[0] = ed.inkLastRaw.x; l[1] = ed.inkLastRaw.y; }
        }
    }

    // ==================== R14 A - ink shaping ====================
    function _centroid2(pts) {
        let x = 0, y = 0;
        for (const p of pts) { x += p[0]; y += p[1]; }
        return [x / pts.length, y / pts.length];
    }
    function _bbox(pts) {
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const p of pts) {
            if (p[0] < minx) minx = p[0];
            if (p[0] > maxx) maxx = p[0];
            if (p[1] < miny) miny = p[1];
            if (p[1] > maxy) maxy = p[1];
        }
        return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
    }
    function _solve3(A, b) {
        // eliminazione gaussiana 3x3 (matrice simmetrica di Kasa)
        const m = [A[0].slice().concat([b[0]]),
                   A[1].slice().concat([b[1]]),
                   A[2].slice().concat([b[2]])];
        for (let i = 0; i < 3; i++) {
            let piv = i;
            for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
            if (Math.abs(m[piv][i]) < 1e-12) return null;
            const t = m[i]; m[i] = m[piv]; m[piv] = t;
            for (let r = 0; r < 3; r++) {
                if (r === i) continue;
                const f = m[r][i] / m[i][i];
                for (let c = i; c < 4; c++) m[r][c] -= f * m[i][c];
            }
        }
        return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
    }
    // A1: fit algebrico del cerchio (Kasa) su x^2+y^2 + D x + E y + F = 0
    function kasaCircle(pts) {
        let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0,
            Sxxx = 0, Sxyy = 0, Sxxy = 0, Syyy = 0, Sz = 0;
        const n = pts.length;
        for (const q of pts) {
            const x = q[0], y = q[1], z = x * x + y * y;
            Sxx += x * x; Sxy += x * y; Syy += y * y;
            Sx += x; Sy += y; Sz += z;
            Sxxx += x * z; Sxyy += y * z;
            Sxxy += x * x * y; Syyy += y * y * y;
        }
        const sol = _solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]],
                            [-Sxxx, -Sxyy, -Sz]);
        if (!sol) return null;
        const cx = -sol[0] / 2, cy = -sol[1] / 2;
        const F = sol[2];
        const r2 = cx * cx + cy * cy - F;
        if (!(r2 > 0)) return null;
        const r = Math.sqrt(r2);
        if (!(r > 4)) return null;
        return { cx: cx, cy: cy, r: r };
    }
    function _tryRect(pts, rotDeg, tol) {
        const bb = _bbox(pts);
        if (bb.w < 15 || bb.h < 15) return null;
        const aspect = bb.w / bb.h;
        if (aspect < 0.25 || aspect > 4) return null;
        // ortogonalita': frazione di punti vicini (<=tol) al bordo piu' vicino
        let near = 0;
        for (const q of pts) {
            const d = Math.min(Math.abs(q[0] - bb.x), Math.abs(q[0] - (bb.x + bb.w)),
                               Math.abs(q[1] - bb.y), Math.abs(q[1] - (bb.y + bb.h)));
            if (d <= tol) near++;
        }
        if (near / pts.length < 0.85) return null;
        const kind = (aspect >= 0.8 && aspect <= 1.25) ? 'square' : 'rectangle';
        let corners = [[bb.x, bb.y], [bb.x + bb.w, bb.y],
                       [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]];
        if (rotDeg) {
            const th = rotDeg * Math.PI / 180;
            const c = _centroid2(corners);
            corners = corners.map(q => {
                const dx = q[0] - c[0], dy = q[1] - c[1];
                return [c[0] + dx * Math.cos(th) - dy * Math.sin(th),
                        c[1] + dx * Math.sin(th) + dy * Math.cos(th)];
            });
            // ri-estrai il bbox reale dai corner ruotati per il box
            const rb = _bbox(corners);
            return { kind: kind, box: rb, rot: rotDeg, pts: corners, params: {} };
        }
        return { kind: kind, box: bb, rot: 0, pts: corners, params: {} };
    }
    function recognizeStroke(pts, amp) {
        const n = (pts || []).length;
        if (n < 5) return null;
        const bb = _bbox(pts);
        if (Math.hypot(bb.w, bb.h) < 30) return null;   // troppo piccolo
        const tol = 2.5 + (amp || 0) * 3;               // ampiezza snap (L2)
        const cen = _centroid2(pts);
        let sxx = 0, sxy = 0, syy = 0;
        for (const q of pts) {
            const dx = q[0] - cen[0], dy = q[1] - cen[1];
            sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
        }
        sxx /= n; sxy /= n; syy /= n;
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const ux = Math.cos(th), uy = Math.sin(th);
        // --- LINE: fit LSQ (asse principale) + deviazione perpendicolare
        let maxPerp = 0, tmin = Infinity, tmax = -Infinity;
        for (const q of pts) {
            const dx = q[0] - cen[0], dy = q[1] - cen[1];
            const perp = Math.abs(-uy * dx + ux * dy);
            if (perp > maxPerp) maxPerp = perp;
            const t = ux * dx + uy * dy;
            if (t < tmin) tmin = t;
            if (t > tmax) tmax = t;
        }
        if (maxPerp <= tol && (tmax - tmin) >= 40) {
            const a = [cen[0] + ux * tmin, cen[1] + uy * tmin];
            const b = [cen[0] + ux * tmax, cen[1] + uy * tmax];
            const lb = _bbox([a, b]);
            return { kind: 'line', box: lb, rot: th * 180 / Math.PI,
                     pts: [a, b], params: {} };
        }
        // --- RECT/SQUARE: prima assiale, poi nel frame PCA (rotato)
        const r0 = _tryRect(pts, 0, tol);
        if (r0) return r0;
        if (Math.abs(th) > 0.02) {
            const c = cen;
            const rp = pts.map(q => {
                const dx = q[0] - c[0], dy = q[1] - c[1];
                return [dx * Math.cos(-th) - dy * Math.sin(-th),
                        dx * Math.sin(-th) + dy * Math.cos(-th)];
            });
            const rr = _tryRect(rp, th * 180 / Math.PI, tol);
            if (rr) {
                // corner gia' ruotati dentro _tryRect (rotDeg) ma sul frame
                // centrato: trasla sul centroid reale
                rr.pts = rr.pts.map(q => [q[0] + c[0], q[1] + c[1]]);
                const rb = _bbox(rr.pts);
                rr.box = rb;
                return rr;
            }
        }
        // --- CIRCLE (Kasa) / ELLISSE (assi da varianza PCA)
        const kc = kasaCircle(pts);
        if (kc) {
            let rms = 0;
            for (const q of pts) {
                const d = Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r);
                rms += d * d;
            }
            rms = Math.sqrt(rms / n);
            const tr = (sxx + syy) / 2;
            const dt = Math.sqrt(Math.max(0, ((sxx - syy) / 2) * ((sxx - syy) / 2) + sxy * sxy));
            const lam1 = tr + dt, lam2 = Math.max(0, tr - dt);
            const a = 2 * Math.sqrt(lam1), b = 2 * Math.sqrt(lam2);
            const aspect = b > 0.01 ? a / b : 99;
            if (rms <= tol && aspect <= 1.3) {
                return { kind: 'circle', rot: 0,
                         box: { x: kc.cx - kc.r, y: kc.cy - kc.r,
                                w: kc.r * 2, h: kc.r * 2 },
                         pts: [], params: { cx: kc.cx, cy: kc.cy, r: kc.r } };
            }
            if (aspect > 1.3 && aspect <= 5) {
                // assi/centro da ESTREMITA' nel frame PCA: invariante al
                // campionamento (il momento 2x sigma e' gonfiato se i
                // punti sono campionati in angolo uniforme, non in area)
                const rot = Math.atan2(uy, ux);
                const ct = Math.cos(-th), st = Math.sin(-th);
                let umin = Infinity, umax = -Infinity,
                    vmin = Infinity, vmax = -Infinity;
                for (const q of pts) {
                    const dx = q[0] - kc.cx, dy = q[1] - kc.cy;
                    const u = dx * ct - dy * st, v = dx * st + dy * ct;
                    if (u < umin) umin = u;
                    if (u > umax) umax = u;
                    if (v < vmin) vmin = v;
                    if (v > vmax) vmax = v;
                }
                const ea = (umax - umin) / 2, eb = (vmax - vmin) / 2;
                const uc = (umax + umin) / 2, vc = (vmax + vmin) / 2;
                const ecx = kc.cx + uc * Math.cos(th) - vc * Math.sin(th);
                const ecy = kc.cy + uc * Math.sin(th) + vc * Math.cos(th);
                if (ea > 4 && eb > 1) {
                    let acc = 0;
                    for (const q of pts) {
                        const dx = q[0] - ecx, dy = q[1] - ecy;
                        const u = dx * ct - dy * st, v = dx * st + dy * ct;
                        const eN = Math.sqrt((u * u) / (ea * ea) +
                                             (v * v) / (eb * eb)) - 1;
                        acc += eN * eN;
                    }
                    const rmsE = Math.sqrt(acc / n) * ((ea + eb) / 2);
                    if (rmsE <= tol * 1.8) {
                        return { kind: 'ellipse', rot: rot * 180 / Math.PI,
                                 box: { x: ecx - ea, y: ecy - eb,
                                        w: ea * 2, h: eb * 2 },
                                 pts: [],
                                 params: { cx: ecx, cy: ecy, a: ea, b: eb } };
                    }
                }
            }
        }
        return null;
    }
    // A2: flick finale a V = ultimo tratto (<=250ms) con svolta >=100gradi
    function detectFlick(o) {
        const pts = o.pts;
        if (!pts || pts.length < 5) return false;
        const ts = o.ts && o.ts.length === pts.length ? o.ts : null;
        let start = 0;
        if (ts) {
            const endT = ts[ts.length - 1];
            start = 0;
            for (let i = ts.length - 1; i >= 0; i--) {
                if (endT - ts[i] > 250) { start = i; break; }
            }
            start = Math.max(0, start);
        } else {
            start = Math.max(0, pts.length - Math.ceil(pts.length * 0.4));
        }
        const win = pts.slice(start);
        if (win.length < 4) return false;   // R14: micro-V brevi compatibili
        // finestra spaziale contenuta (il flick e' piccolo)
        const wb = _bbox(win);
        if (Math.hypot(wb.w, wb.h) > 80) return false;
        const mid = win[Math.floor(win.length / 2)];
        const v1 = [mid[0] - win[0][0], mid[1] - win[0][1]];
        const v2 = [win[win.length - 1][0] - mid[0], win[win.length - 1][1] - mid[1]];
        const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
        if (n1 < 8 || n2 < 8) return false;
        const cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
        const ang = Math.acos(Math.max(-1, Math.min(1, cosang))) * 180 / Math.PI;
        return ang >= 100;
    }
    function findFlickTarget(o) {
        // linea/arco precedente entro 45px dall'inizio del flick
        const objs = ed.doc.objects;
        const p0 = o.pts[0];
        for (let i = objs.length - 1; i >= 0; i--) {
            const t = objs[i];
            if (t.t !== 'shape') continue;
            if (t.kind !== 'line' && t.kind !== 'circle' && t.kind !== 'ellipse') continue;
            const samples = (t.pts && t.pts.length) ? t.pts :
                (t.params && t.params.cx !== undefined
                    ? [[t.params.cx, t.params.cy]] : []);
            let best = Infinity;
            for (const s of samples) best = Math.min(best, Math.hypot(s[0] - p0[0], s[1] - p0[1]));
            if (t.params && t.params.r) {
                const rr = Math.abs(Math.hypot(p0[0] - t.params.cx, p0[1] - t.params.cy) - t.params.r);
                best = Math.min(best, rr);
            }
            if (best <= 45) return t;
        }
        return null;
    }
    function makeShapeObj(stroke, rec) {
        return {
            t: 'shape', kind: rec.kind,
            color: stroke.color || '#141414',
            size: stroke.size || 2,
            alpha: (stroke.alpha !== undefined ? stroke.alpha : 1),
            box: rec.box, rot: rec.rot || 0, pts: rec.pts || [],
            arrow: !!rec.arrow, params: rec.params || null
        };
    }
    // A5: 1) push tratto grezzo + pushUndo(col grezzo) + sostituisci con
    // shape -> primo undo ripristina il tratto grezzo, secondo lo rimuove
    function finalizeStrokeWithShape(o, rec) {
        ed.doc.objects.push(o);
        pushUndo();
        ed.doc.objects[ed.doc.objects.length - 1] = makeShapeObj(o, rec);
        scheduleSave();
        drawAll();
    }
    function finalizeEndStroke(o) {
        // A2: flick a V -> arrowhead su linea/arco precedente, o linea+arrow
        if (ed.arrowOn) {
            const flick = detectFlick(o);
            if (flick) {
                const tgt = findFlickTarget(o);
                if (tgt) {
                    tgt.arrow = true;
                    scheduleSave();
                    drawAll();
                    return;   // flick scartato: undo torna allo stato pre-flick
                }
                const rl = recognizeStroke(o.pts, ed.inkSnapAmp || 0);
                if (rl && rl.kind === 'line') {
                    rl.arrow = true;
                    finalizeStrokeWithShape(o, rl);
                    return;
                }
            }
        }
        if (ed.shpOn) {
            const rec = recognizeStroke(o.pts, ed.inkSnapAmp || 0);
            if (rec) { finalizeStrokeWithShape(o, rec); return; }
        }
        ed.doc.objects.push(o);
    }

    function drawStroke(ctx, o) {
        const pts = o.pts;
        if (!pts || !pts.length) return;
        ctx.save();
        ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
        ctx.strokeStyle = o.color || '#141414';
        ctx.fillStyle = o.color || '#141414';
        ctx.lineWidth = o.size || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], Math.max(0.6, (o.size || 2) / 2), 0, Math.PI * 2);
            ctx.fill();
        } else if (o.sizes && o.sizes.length === pts.length) {
            // tratto a spessore variabile (pressione penna): segmenti
            // con larghezza interpolata
            for (let i = 1; i < pts.length; i++) {
                ctx.lineWidth = Math.max(0.5, (o.sizes[i - 1] + o.sizes[i]) / 2);
                ctx.beginPath();
                ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
                ctx.lineTo(pts[i][0], pts[i][1]);
                ctx.stroke();
            }
        } else {
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
        ctx.restore();
    }

    function drawTextObj(ctx, o) {
        ctx.save();
        ctx.fillStyle = o.color || '#141414';
        ctx.font = fontOf(o);
        ctx.textBaseline = 'top';
        const lines = String(o.text || '').split('\n');
        const lh = (o.size || 20) * 1.35;
        lines.forEach((ln, i) => {
            const y = o.y + i * lh;
            ctx.fillText(ln, o.x, y);
            if (o.underline) {
                const wpx = ctx.measureText(ln).width;
                ctx.fillRect(o.x, y + (o.size || 20) * 1.08, wpx, Math.max(1, (o.size || 20) / 14));
            }
        });
        ctx.restore();
    }

    function drawImageObj(ctx, o) {
        const img = getImage(o.src);
        if (img && img.complete && img.naturalWidth) {
            ctx.drawImage(img, o.x, o.y, o.w, o.h);
        } else {
            ctx.save();
            ctx.fillStyle = '#e8e4d8';
            ctx.fillRect(o.x, o.y, o.w, o.h);
            ctx.fillStyle = '#8a8478';
            ctx.font = '13px ' + FAM;
            ctx.fillText('Immagine\u2026', o.x + 8, o.y + 8);
            ctx.restore();
        }
    }

    // allegato locale (PPT/PPTX/doc...): riquadro con icona + nome troncato
    function drawFileObj(ctx, o) {
        const w = o.w || 180, h = o.h || 56;
        ctx.save();
        ctx.fillStyle = o.color || '#fff6ea';
        ctx.strokeStyle = '#f9974a';
        ctx.lineWidth = 1.5;
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(o.x, o.y, w, h, 8);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.fillRect(o.x, o.y, w, h);
            ctx.strokeRect(o.x, o.y, w, h);
        }
        // icona documento
        const ix = o.x + 13, iy = o.y + h / 2 - 14;
        ctx.strokeStyle = '#d64545';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(ix, iy, 18, 24);
        ctx.beginPath();
        ctx.moveTo(ix + 12, iy); ctx.lineTo(ix + 18, iy + 6); ctx.lineTo(ix + 12, iy + 6);
        ctx.closePath();
        ctx.stroke();
        // nome file (troncato per capire nel riquadro)
        ctx.fillStyle = '#2a2f3a';
        ctx.font = '600 13px ' + FAM;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const full = String(o.name || 'File');
        const maxW = Math.max(20, w - 56);
        let nm = full;
        while (nm.length > 3 && ctx.measureText(nm + '\u2026').width > maxW) nm = nm.slice(0, -1);
        if (nm !== full) nm += '\u2026';
        ctx.fillText(nm, o.x + 42, o.y + h / 2);
        ctx.restore();
    }

    function drawArrowHead(ctx, a, b, size) {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        ctx.save();
        ctx.translate(b[0], b[1]);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-size, -size * 0.55);
        ctx.lineTo(-size, size * 0.55);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        ctx.restore();
    }
    function drawShape(ctx, o) {
        // R14 A1/A2: shape vettoriale pulita (line/circle/ellipse/square/
        // rectangle) + eventuale arrowhead sull'ultimo segmento
        ctx.save();
        ctx.globalAlpha = (o.alpha !== undefined ? o.alpha : 1);
        ctx.strokeStyle = o.color || '#141414';
        ctx.lineWidth = Math.max(1, o.size || 2);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pr = o.params || {};
        if (o.kind === 'circle' && pr.cx !== undefined) {
            ctx.beginPath();
            ctx.ellipse(pr.cx, pr.cy, pr.r, pr.r, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (o.kind === 'ellipse' && pr.cx !== undefined) {
            ctx.beginPath();
            ctx.ellipse(pr.cx, pr.cy, pr.a, pr.b,
                        (o.rot || 0) * Math.PI / 180, 0, Math.PI * 2);
            ctx.stroke();
        } else if (o.pts && o.pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(o.pts[0][0], o.pts[0][1]);
            for (let i = 1; i < o.pts.length; i++) {
                ctx.lineTo(o.pts[i][0], o.pts[i][1]);
            }
            if (o.kind === 'square' || o.kind === 'rectangle') ctx.closePath();
            ctx.stroke();
            if (o.arrow) {
                drawArrowHead(ctx, o.pts[o.pts.length - 2],
                              o.pts[o.pts.length - 1],
                              Math.max(6, (o.size || 2) * 3.2));
            }
        }
        ctx.restore();
    }
    function drawObj(ctx, o) {
        if (o.t === 'stroke') drawStroke(ctx, o);
        else if (o.t === 'shape') drawShape(ctx, o);
        else if (o.t === 'text') drawTextObj(ctx, o);
        else if (o.t === 'image') drawImageObj(ctx, o);
        else if (o.t === 'file') drawFileObj(ctx, o);
    }

    function drawAll() {
        if (!ed) return;
        const c = ed.canvas, ctx = ed.ctx;
        const cw = c.width / ed.dpr, ch = c.height / ed.dpr;
        ctx.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0);
        // stato camera: <= fit = statico e centrato; > fit = pan clampato
        clampPan();
        // FUORI PAGINA = NERO: il viewport e' solo sfondo scuro
        ctx.fillStyle = OUTER;
        ctx.fillRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(ed.tx, ed.ty);
        ctx.scale(ed.scale, ed.scale);
        const doc = ed.doc;
        const objs = docObjects(doc);
        // bordo-pila: sottili fogli sottostanti (visibili sul nero)
        if (isQuaderno(doc)) {
            const stack = Math.min(3, Math.max(0, (doc.pages || []).length - 1));
            for (let i = stack; i >= 1; i--) {
                ctx.save();
                ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + 0.02 * i) + ')';
                ctx.lineWidth = 1 / ed.scale;
                ctx.strokeRect(-i * 6, -i * 6, doc.w + i * 12, doc.h + i * 12);
                ctx.restore();
            }
        }
        // ---- MONDO = SOLO LA PAGINA: tutto il resto e' nel clip ----
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, doc.w, doc.h);
        ctx.clip();
        // carta (sfondo chiaro) SOLO entro i bordi pagina
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, doc.w, doc.h);
        // texture (quadretti/righe/puntini) SOLO entro la pagina
        drawSheet(ctx, doc, doc.w, doc.h, { x0: 0, y0: 0, x1: doc.w, y1: doc.h });
        // grana della carta (entro il clip)
        drawGrainPage(ctx, doc.w, doc.h);
        // oggetti e tratti in corso (clippati ai bordi pagina)
        objs.forEach(o => drawObj(ctx, o));
        if (ed.active) drawObj(ctx, ed.active);
        // linea di margine rossa opzionale (solo righe)
        if (doc.sheet === 'righe' && doc.margin) {
            ctx.strokeStyle = 'rgba(220,70,70,.55)';
            ctx.lineWidth = 1.5 / ed.scale;
            ctx.beginPath();
            ctx.moveTo(80, 0);
            ctx.lineTo(80, doc.h);
            ctx.stroke();
        }
        ctx.restore();
        // stacco visivo: doppio bordo sottile chiaro attorno alla pagina
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,.05)';
        ctx.lineWidth = 5 / ed.scale;
        ctx.strokeRect(0, 0, doc.w, doc.h);
        ctx.strokeStyle = 'rgba(255,255,255,.17)';
        ctx.lineWidth = 1.4 / ed.scale;
        ctx.strokeRect(0, 0, doc.w, doc.h);
        ctx.restore();
        // selezione
        if (ed.selected && ed.tool === 'selezione') {
            const o = ed.selected;
            let x = o.x, y = o.y, w = o.w, h = o.h;
            if (o.t === 'stroke') {
                let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
                o.pts.forEach(p => {
                    minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
                    maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
                });
                const pad = (o.size || 2) / 2 + 4;
                x = minx - pad; y = miny - pad; w = (maxx - minx) + pad * 2; h = (maxy - miny) + pad * 2;
            }
            ctx.save();
            ctx.strokeStyle = '#f9974a';
            ctx.lineWidth = 1.5 / ed.scale;
            ctx.setLineDash([6 / ed.scale, 4 / ed.scale]);
            ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
            ctx.restore();
        }
        // lazo: percorso freehand in corso (chiusura al rilascio)
        if (ed.tool === 'lazo' && ed.lasso && ed.lasso.pts.length > 1) {
            ctx.save();
            ctx.strokeStyle = '#f9974a';
            ctx.lineWidth = 1.5 / ed.scale;
            ctx.setLineDash([6 / ed.scale, 4 / ed.scale]);
            ctx.beginPath();
            ed.lasso.pts.forEach((pt, i) => {
                if (i === 0) ctx.moveTo(pt[0], pt[1]);
                else ctx.lineTo(pt[0], pt[1]);
            });
            ctx.stroke();
            ctx.restore();
        }
        // lazo: oggetti selezionati -> rettangolo tratteggiato + maniglia angolo
        if (ed.tool === 'lazo' && ed.lasel && ed.lasel.length) {
            ctx.save();
            ctx.strokeStyle = '#3aa0ff';
            ctx.lineWidth = 1.5 / ed.scale;
            ctx.setLineDash([6 / ed.scale, 4 / ed.scale]);
            ed.lasel.forEach(o => {
                const b = objBBox(o);
                ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
            });
            ctx.restore();
            const ub = selUnion();
            if (ub && ub.w > 0 && ub.h > 0) {
                const hr = 7 / ed.scale;
                ctx.save();
                ctx.fillStyle = '#f9974a';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5 / ed.scale;
                ctx.beginPath();
                ctx.arc(ub.x + ub.w, ub.y + ub.h, hr, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }
        ctx.restore();
        syncSelUi();
        const zl = ed.zoomLabel || (ed.stage && ed.stage.querySelector('.nt-zoom'));
        if (zl) zl.textContent = Math.round(ed.scale * 100) + '%';
        if (ed.btnUndo) ed.btnUndo.disabled = !ed.undo.length;
        if (ed.btnRedo) ed.btnRedo.disabled = !ed.redo.length;
    }

    // grana della carta: pattern rumoroso leggerissimo, creato una sola
    // volta e applicato SOLO entro il rettangolo pagina (mai sul nero)
    let GRAIN = null;
    function drawGrainPage(ctx, w, h) {
        try {
            if (!GRAIN) {
                const g = document.createElement('canvas');
                g.width = 96; g.height = 96;
                const gc = g.getContext('2d');
                const id = gc.createImageData(96, 96);
                for (let i = 0; i < id.data.length; i += 4) {
                    const v = 110 + Math.random() * 145;
                    id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v;
                    id.data[i + 3] = Math.random() * 20;
                }
                gc.putImageData(id, 0, 0);
                GRAIN = ctx.createPattern(g, 'repeat');
            }
            if (!GRAIN) return;
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = GRAIN;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        } catch (e) { /* grana opzionale */ }
    }

    function resizeCanvas() {
        if (!ed) return;
        const r = ed.stage.getBoundingClientRect();
        ed.dpr = Math.min(2, window.devicePixelRatio || 1);
        ed.canvas.width = Math.max(1, Math.round(r.width * ed.dpr));
        ed.canvas.height = Math.max(1, Math.round(r.height * ed.dpr));
    }

    function centerView() {
        if (!ed) return;
        const cw = ed.canvas.width / ed.dpr, ch = ed.canvas.height / ed.dpr;
        const doc = ed.doc;
        if (doc.mode === 'infinito') {
            // centro del foglio grande a zoom 100% (poi clampPan assicura
            // che la vista resti entro i bordi del foglio)
            ed.scale = 1;
            ed.tx = cw / 2 - (doc.w / 2) * ed.scale;
            ed.ty = ch / 2 - (doc.h / 2) * ed.scale;
        } else {
            // reset allo stato FIT: la pagina copre lo schermo ed e' statica
            ed.scale = zoomFit();
            ed.tx = (cw - doc.w * ed.scale) / 2;
            ed.ty = (ch - doc.h * ed.scale) / 2;
        }
        drawAll();
    }

    // adatta: l'intera pagina entra nel viewport (dal popover zoom)
    function fitPage() {
        if (!ed) return;
        const cw = ed.canvas.width / ed.dpr, ch = ed.canvas.height / ed.dpr;
        const doc = ed.doc;
        const pad = 24;
        const s = Math.min((cw - pad * 2) / doc.w, (ch - pad * 2) / doc.h, 4);
        ed.scale = Math.max(0.05, s);
        ed.tx = (cw - doc.w * ed.scale) / 2;
        ed.ty = (ch - doc.h * ed.scale) / 2;
        drawAll();
    }

    function toWorld(e) {
        const r = ed.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left - ed.tx) / ed.scale,
            y: (e.clientY - r.top - ed.ty) / ed.scale
        };
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // Sfoca gli input interni attivi: preventDefault sul pointerdown
    // blocca la perdita di focus naturale, quindi la gestiamo a mano
    // (così le caselle di testo si chiudono e salvano con blur).
    function blurActive() {
        const a = document.activeElement;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && container && container.contains(a)) {
            try { a.blur(); } catch (e) { /* ok */ }
        }
    }

    // ---------- undo / redo ----------
    function pushUndo() {
        if (!ed) return;
        ed.undo.push(JSON.stringify(ed.doc.objects));
        if (ed.undo.length > 50) ed.undo.shift();
        ed.redo.length = 0;
    }

    // undo/redo agiscono sulla pagina corrente: dopo il ripristino va
    // riallacciato il riferimento pages[page].objects
    function repointPage() {
        if (ed && ed.doc && Array.isArray(ed.doc.pages) && ed.doc.pages[ed.doc.page]) {
            ed.doc.pages[ed.doc.page].objects = ed.doc.objects;
        }
    }

    function undo() {
        if (!ed || !ed.undo.length) return;
        ed.redo.push(JSON.stringify(ed.doc.objects));
        ed.doc.objects = JSON.parse(ed.undo.pop());
        repointPage();
        ed.selected = null;
        ed.lasel = [];
        drawAll();
        scheduleSave();
    }

    function redo() {
        if (!ed || !ed.redo.length) return;
        ed.undo.push(JSON.stringify(ed.doc.objects));
        ed.doc.objects = JSON.parse(ed.redo.pop());
        repointPage();
        ed.selected = null;
        ed.lasel = [];
        drawAll();
        scheduleSave();
    }

    // ---------- salvataggio ----------
    function buildPayload(st) {
        let thumb = '';
        try { thumb = makeThumb(st.doc); } catch (e) { thumb = ''; }
        return {
            id: st.itemId,
            kind: 'note',
            title: st.title || 'Senza titolo',
            content: JSON.stringify(serializableDoc(st.doc)),
            materia: SubjectInput.normalize(st.materia || ''),
            folder_id: st.folderId || '',
            tags: st.tags || '',
            description: st.desc || '',
            thumbnail: thumb
        };
    }

    function makeThumb(doc) {
        const TW = 200;
        const s = TW / doc.w;
        const c = document.createElement('canvas');
        c.width = TW;
        c.height = Math.max(1, Math.round(doc.h * s));
        const x = c.getContext('2d');
        x.fillStyle = PAPER;
        x.fillRect(0, 0, c.width, c.height);
        x.save();
        x.scale(s, s);
        drawSheet(x, doc, doc.w, doc.h, null);
        x.beginPath();
        x.rect(0, 0, doc.w, doc.h);
        x.clip();
        docObjects(doc).forEach(o => drawObj(x, o));
        x.restore();
        return c.toDataURL('image/jpeg', 0.6);
    }

    function scheduleSave(st) {
        st = st || ed;
        if (!st) return;
        st.dirty = true;
        if (st.saveTimer) clearTimeout(st.saveTimer);
        st.saveTimer = setTimeout(() => {
            st.saveTimer = null;
            doSave(st);
        }, 900);
    }

    async function doSave(st) {
        if (!st) return;
        if (st.saving) { st.again = true; return; }
        st.saving = true;
        const payload = buildPayload(st); // sincrono: cattura subito lo stato
        if (payload.materia) SubjectInput.remember(payload.materia).catch(() => { /* ok */ });
        st.dirty = false;
        try {
            const saved = await StudyStore.saveItem(payload);
            if (saved && saved.id && ed === st) st.itemId = saved.id;
            if (st.saveState) {
                const hh = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                st.saveState.textContent = '\u2713 Salvato alle ' + hh;
            }
        } catch (e) { console.error('Salvataggio nota:', e); }
        st.saving = false;
        // continua la catena se ci sono modifiche in sospeso, anche dopo il teardown
        if ((ed === st || st.pendingClose) && (st.again || st.dirty)) {
            st.again = false;
            scheduleSave(st);
        }
    }

    async function flush() {
        const st = ed;
        if (!st) return;
        if (st.saveTimer) { clearTimeout(st.saveTimer); st.saveTimer = null; }
        let guard = 0;
        while ((st.dirty || st.again || st.saving) && guard++ < 60) {
            if (st.saving) { await new Promise(r => setTimeout(r, 40)); continue; }
            if (!st.dirty && !st.again) break;
            st.again = false;
            await doSave(st);
        }
    }

    // ---------- testo: overlay ----------
    function closeTextOverlay(commit) {
        if (!ed || !ed.textTa) return;
        const ta = ed.textTa;
        const meta = ed.textMeta;
        ed.textTa = null;
        ed.textMeta = null;
        if (commit && meta) {
            const val = ta.value.replace(/\s+$/, '');
            if (meta.obj) {
                if (!val.trim()) {
                    pushUndo();
                    ed.doc.objects = ed.doc.objects.filter(o => o !== meta.obj);
                    repointPage();
                } else if (val !== meta.obj.text) {
                    pushUndo();
                    meta.obj.text = val;
                    measureTextObj(meta.obj);
                }
            } else if (val.trim()) {
                pushUndo();
                const o = {
                    t: 'text',
                    x: meta.x, y: meta.y,
                    w: 10, h: 10,
                    text: val,
                    size: ed.textSize,
                    color: ed.textColor,
                    bold: ed.textBold,
                    italic: ed.textItalic,
                    underline: ed.textUnderline
                };
                measureTextObj(o);
                ed.doc.objects.push(o);
            }
            scheduleSave();
        }
        if (ta.parentNode) ta.parentNode.removeChild(ta);
        drawAll();
    }

    function openTextOverlay(pt, obj) {
        if (!ed) return;
        closeTextOverlay(true);
        const ta = document.createElement('textarea');
        const size = obj ? (obj.size || 20) : ed.textSize;
        let sx, sy;
        if (obj) {
            sx = ed.tx + obj.x * ed.scale;
            sy = ed.ty + obj.y * ed.scale;
        } else {
            sx = ed.tx + pt.x * ed.scale;
            sy = ed.ty + pt.y * ed.scale;
        }
        ta.style.left = Math.max(2, sx) + 'px';
        ta.style.top = Math.max(2, sy) + 'px';
        ta.style.fontSize = Math.max(10, size * ed.scale) + 'px';
        ta.style.color = obj ? (obj.color || '#141414') : ed.textColor;
        ta.style.fontWeight = (obj ? obj.bold : ed.textBold) ? '700' : '400';
        ta.style.fontStyle = (obj ? obj.italic : ed.textItalic) ? 'italic' : 'normal';
        ta.style.minWidth = Math.max(140, (obj ? obj.w : 260) * ed.scale) + 'px';
        ta.style.minHeight = Math.max(28, size * ed.scale * 1.5) + 'px';
        ta.rows = obj ? Math.max(1, String(obj.text || '').split('\n').length) : 2;
        ta.placeholder = 'Scrivi qui\u2026 (Invio per a capo, Esc per confermare)';
        if (obj) ta.value = obj.text || '';
        ed.overlay.appendChild(ta);
        ed.textTa = ta;
        ed.textMeta = { obj: obj, x: pt ? pt.x : 0, y: pt ? pt.y : 0 };
        ta.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); closeTextOverlay(true); }
        });
        ta.addEventListener('blur', () => { closeTextOverlay(true); });
        setTimeout(() => { ta.focus(); if (obj) ta.select(); }, 20);
    }

    // ---------- hit test ----------
    function distSeg(p, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (!len) return Math.hypot(p.x - a[0], p.y - a[1]);
        let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (len * len);
        t = clamp(t, 0, 1);
        return Math.hypot(p.x - (a[0] + t * dx), p.y - (a[1] + t * dy));
    }

    function strokeHit(o, p, tol) {
        const r = ((o.size || 2) / 2) + tol;
        const pts = o.pts;
        if (!pts.length) return false;
        if (pts.length === 1) return Math.hypot(pts[0][0] - p.x, pts[0][1] - p.y) <= r;
        for (let i = 0; i < pts.length - 1; i++) {
            if (distSeg(p, pts[i], pts[i + 1]) <= r) return true;
        }
        return false;
    }

    function objBBox(o) {
        if (o.t === 'shape') {
            const b = o.box || {};
            const pad = (o.size || 2) / 2 + 3;
            return { x: (b.x || 0) - pad, y: (b.y || 0) - pad,
                     w: (b.w || 10) + pad * 2, h: (b.h || 10) + pad * 2 };
        }
        if (o.t === 'stroke') {
            let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
            o.pts.forEach(p => {
                minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
                maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
            });
            const pad = (o.size || 2) / 2 + 3;
            return { x: minx - pad, y: miny - pad, w: (maxx - minx) + pad * 2, h: (maxy - miny) + pad * 2 };
        }
        return { x: o.x, y: o.y, w: o.w || 10, h: o.h || 10 };
    }

    function hitTest(p) {
        if (!ed) return null;
        const tol = 6 / ed.scale;
        const objs = ed.doc.objects;
        for (let i = objs.length - 1; i >= 0; i--) {
            const o = objs[i];
            if (o.t === 'stroke') {
                if (strokeHit(o, p, tol)) return o;
            } else {
                const b = objBBox(o);
                if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return o;
            }
        }
        return null;
    }

    // Gomma come penna cancellante: elimina l'intero stroke (penna, matita,
    // pennarello, evidenziatore) toccato entro il raggio della gomma, cioe'
    // distanza punto-segmento <= sizeGomma/2 + sizeStroke/2.
    // ===== GOMMA PARZIALE: cancella SOLO la porzione colpita =====
    function distPtSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const qx = ax + t * dx, qy = ay + t * dy;
        return Math.hypot(px - qx, py - qy);
    }

    function strokeSizeAt(o, i) {
        if (o.sizes && o.sizes.length === o.pts.length) {
            const s = o.sizes[Math.max(0, Math.min(o.sizes.length - 1, i))];
            return s || o.size || 2;
        }
        return o.size || 2;
    }

    // Cancella l'inchiostro SOLO entro la capsula (segmento P0->P1 con
    // raggio R = eraserSize/2): il tratto colpito viene SPEZZATO nei
    // segmenti sopravvissuti (con spessore/pressione interpolati).
    // - tocca esclusivamente tratti di inchiostro (penna/matita/evidenziatore):
    //   testo, immagini e oggetti PPT non vengono toccati;
    // - prestazioni: bbox test prima di procedere sui soli tratti vicini.
    function eraseCapsule(P0, P1) {
        if (!ed || !ed.doc) return false;
        const R = Math.max(1, (ed.eraserSize || 14) / 2);
        const box = {
            x0: Math.min(P0.x, P1.x) - R - 55,
            y0: Math.min(P0.y, P1.y) - R - 55,
            x1: Math.max(P0.x, P1.x) + R + 55,
            y1: Math.max(P0.y, P1.y) + R + 55
        };
        const objs = docObjects(ed.doc);
        let changed = false;
        const out = [];
        for (let oi = 0; oi < objs.length; oi++) {
            const o = objs[oi];
            // SOLO tratti di inchiostro; testo/immagini/PPT mai toccati
            if (o.t !== 'stroke' || !o.pts || !o.pts.length || o.tool === 'eraser') {
                out.push(o);
                continue;
            }
            // filtro spaziale: solo tratti il cui bbox interseca la capsula
            const b = objBBox(o);
            if (!b || b.x > box.x1 || b.y > box.y1 ||
                b.x + b.w < box.x0 || b.y + b.h < box.y0) {
                out.push(o);
                continue;
            }
            const pts = o.pts;
            const nSeg = pts.length - 1;
            // campionamento fino: copre anche i movimenti gomma veloci
            // (la capsula copre l'intero segmento tra due eventi)
            const step = Math.max(0.3, R / 3);
            const keep = [];
            for (let i = 0; i < pts.length; i++) {
                const A = pts[i];
                if (i === nSeg) {
                    const w = strokeSizeAt(o, Math.max(0, nSeg - 1));
                    keep.push({
                        x: A[0], y: A[1], s: w,
                        free: distPtSeg(A[0], A[1], P0.x, P0.y, P1.x, P1.y) > R + w / 2
                    });
                    break;
                }
                const B = pts[i + 1];
                const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
                const steps = Math.max(1, Math.ceil(len / step));
                const wA = strokeSizeAt(o, i), wB = strokeSizeAt(o, i + 1);
                for (let k = 0; k < steps; k++) {
                    const t = k / steps;
                    const x = A[0] + (B[0] - A[0]) * t;
                    const y = A[1] + (B[1] - A[1]) * t;
                    const w = wA + (wB - wA) * t;
                    keep.push({
                        x: x, y: y, s: w,
                        free: distPtSeg(x, y, P0.x, P0.y, P1.x, P1.y) > R + w / 2
                    });
                }
            }
            let anyErased = false;
            for (let i = 0; i < keep.length; i++) {
                if (!keep[i].free) { anyErased = true; break; }
            }
            if (!anyErased) { out.push(o); continue; }
            changed = true;
            // spezza nei run sopravvissuti
            let cur = null;
            const flush = () => {
                if (!cur) return;
                if (cur.length) {
                    const ns = {
                        t: 'stroke', tool: o.tool, color: o.color, alpha: o.alpha,
                        pts: cur.map(k => [k.x, k.y]),
                        sizes: cur.map(k => Math.max(0.5, k.s))
                    };
                    ns.size = ns.sizes[Math.floor(ns.sizes.length / 2)] || o.size || 2;
                    out.push(ns);
                }
                cur = null;
            };
            for (let i = 0; i < keep.length; i++) {
                if (keep[i].free) {
                    if (!cur) cur = [];
                    cur.push(keep[i]);
                } else {
                    flush();
                }
            }
            flush();
        }
        if (changed) {
            ed.doc.objects = out;
            repointPage();
        }
        return changed;
    }

    // cerchio anteprima gomma: posizione in schermo, diametro =
    // spessore pagina * zoom (l'area reale cancellata resta in pagina)
    function updateEraserCursor(e) {
        if (!ed || !ed.eraseCur) return;
        if (ed.tool !== 'gomma' || ed.pinch) {
            ed.eraseCur.style.display = 'none';
            return;
        }
        const r = ed.canvas.getBoundingClientRect();
        const d = Math.max(6, (ed.eraserSize || 14) * ed.scale);
        ed.eraseCur.style.display = 'block';
        ed.eraseCur.style.width = d + 'px';
        ed.eraseCur.style.height = d + 'px';
        ed.eraseCur.style.left = (e.clientX - r.left) + 'px';
        ed.eraseCur.style.top = (e.clientY - r.top) + 'px';
    }

    // ============================================================
    // LAZO FLUIDO + SELEZIONE MULTIpla (sposta / ridimensiona / elimina)
    // ============================================================
    function selUnion() {
        if (!ed || !ed.lasel || !ed.lasel.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        ed.lasel.forEach(o => {
            const b = objBBox(o);
            x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
            x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
        });
        if (!isFinite(x0)) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    // test punto-in-poligono (ray casting): scelta semplice e stabile per
    // decidere quali oggetti "cadono" nel lazo (centro del bbox dentro il poligono)
    function pointInPoly(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], yi = poly[i][1];
            const xj = poly[j][0], yj = poly[j][1];
            const hit = ((yi > pt.y) !== (yj > pt.y)) &&
                (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
            if (hit) inside = !inside;
        }
        return inside;
    }

    function moveObj(o, dx, dy) {
        if (o.t === 'stroke') o.pts.forEach(pt => { pt[0] += dx; pt[1] += dy; });
        else if (o.t === 'shape') {
            (o.pts || []).forEach(pt => { pt[0] += dx; pt[1] += dy; });
            if (o.box) { o.box.x += dx; o.box.y += dy; }
            if (o.params) {
                if (o.params.cx !== undefined) { o.params.cx += dx; o.params.cy += dy; }
            }
        } else { o.x += dx; o.y += dy; }
    }

    function scaleObj(o, c, k) {
        if (o.t === 'stroke') {
            o.pts.forEach(pt => { pt[0] = c.x + (pt[0] - c.x) * k; pt[1] = c.y + (pt[1] - c.y) * k; });
            o.size = Math.max(1, (o.size || 2) * k);
        } else if (o.t === 'shape') {
            (o.pts || []).forEach(pt => { pt[0] = c.x + (pt[0] - c.x) * k; pt[1] = c.y + (pt[1] - c.y) * k; });
            if (o.box) {
                o.box.x = c.x + (o.box.x - c.x) * k;
                o.box.y = c.y + (o.box.y - c.y) * k;
                o.box.w = Math.max(4, o.box.w * k);
                o.box.h = Math.max(4, o.box.h * k);
            }
            if (o.params) {
                const pr = o.params;
                if (pr.cx !== undefined) {
                    pr.cx = c.x + (pr.cx - c.x) * k;
                    pr.cy = c.y + (pr.cy - c.y) * k;
                }
                if (pr.r !== undefined) pr.r = Math.max(3, pr.r * k);
                if (pr.a !== undefined) pr.a = Math.max(3, pr.a * k);
                if (pr.b !== undefined) pr.b = Math.max(3, pr.b * k);
            }
            o.size = Math.max(1, (o.size || 2) * k);
        } else {
            o.x = c.x + (o.x - c.x) * k;
            o.y = c.y + (o.y - c.y) * k;
            o.w = Math.max(4, (o.w || 10) * k);
            o.h = Math.max(4, (o.h || 10) * k);
            if (o.t === 'text' && o.size) {
                o.size = Math.max(6, (o.size || 20) * k);
                measureTextObj(o);
            }
        }
    }

    function lassoDown(p) {
        if (!ed) return;
        const ub = selUnion();
        const hr = 9 / ed.scale;
        if (ub && ed.lasel && ed.lasel.length && ub.w > 0 && ub.h > 0) {
            // maniglia angolo -> ridimensionamento proporzionale dal centro
            if (Math.abs(p.x - (ub.x + ub.w)) <= hr && Math.abs(p.y - (ub.y + ub.h)) <= hr) {
                ed.selDrag = {
                    mode: 'resize', c: { x: ub.x + ub.w / 2, y: ub.y + ub.h / 2 },
                    d0: Math.max(1, Math.hypot(p.x - (ub.x + ub.w / 2), p.y - (ub.y + ub.h / 2))),
                    k: 1, moved: false
                };
                return;
            }
            // dentro la selezione -> trascina per spostare
            if (p.x >= ub.x && p.x <= ub.x + ub.w && p.y >= ub.y && p.y <= ub.y + ub.h) {
                ed.selDrag = { mode: 'move', last: p, moved: false };
                return;
            }
        }
        // nuovo tracciato: azzera la selezione precedente
        ed.lasel = [];
        ed.selDrag = null;
        ed.lasso = { pts: [[p.x, p.y]] };
        drawAll();
    }

    function lassoUp() {
        const l = ed.lasso;
        ed.lasso = null;
        if (!l) { drawAll(); return; }
        const pts = l.pts;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        pts.forEach(q => {
            minx = Math.min(minx, q[0]); miny = Math.min(miny, q[1]);
            maxx = Math.max(maxx, q[0]); maxy = Math.max(maxy, q[1]);
        });
        const tiny = ((maxx - minx) < 8 / ed.scale && (maxy - miny) < 8 / ed.scale);
        if (tiny) {
            // click: seleziona l'oggetto sotto il cursore, altrimenti deseleziona
            const hit = hitTest({ x: (minx + maxx) / 2, y: (miny + maxy) / 2 });
            ed.lasel = hit ? [hit] : [];
            drawAll();
            return;
        }
        const poly = pts.slice();
        ed.lasel = ed.doc.objects.filter(o => {
            const b = objBBox(o);
            return pointInPoly({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly);
        });
        drawAll();
    }

    function selDragMove(p) {
        const d = ed.selDrag;
        if (!d) return;
        if (d.mode === 'move') {
            const dx = p.x - d.last.x, dy = p.y - d.last.y;
            if (dx || dy) {
                if (!d.moved) { pushUndo(); d.moved = true; }
                ed.lasel.forEach(o => moveObj(o, dx, dy));
                d.last = p;
                drawAll();
            }
        } else if (d.mode === 'resize') {
            const dist = Math.hypot(p.x - d.c.x, p.y - d.c.y);
            const k = clamp(dist / d.d0, 0.05, 20);
            const prev = d.k || 1;
            if (Math.abs(k - prev) > 0.004) {
                if (!d.moved) { pushUndo(); d.moved = true; }
                const kk = k / prev;
                ed.lasel.forEach(o => scaleObj(o, d.c, kk));
                d.k = k;
                drawAll();
            }
        }
    }

    // ---------- H11: AI su selezione testo (F01 flashcard / F05 migliora) ----------
    function aiSelectedText() {
        const objs = [];
        if (ed && ed.lasel && ed.lasel.length) ed.lasel.forEach(function (o) { objs.push(o); });
        else if (ed && ed.selected) objs.push(ed.selected);
        const parts = [];
        objs.forEach(function (o) { if (o && typeof o.text === 'string' && o.text.trim()) parts.push(o.text); });
        if (parts.length) return { kind: 'obj', text: parts.join('\n'), objs: objs };
        try {
            const a = document.activeElement;
            if (a && a.tagName === 'TEXTAREA') {
                const st0 = a.selectionStart, en = a.selectionEnd;
                const sel = (st0 != null && en != null && en > st0) ? a.value.slice(st0, en) : a.value;
                if (sel && sel.trim()) return { kind: 'ta', text: sel, ta: a, start: st0, end: en };
            }
        } catch (e) { /* ok */ }
        return null;
    }

    async function aiSelectionAction(fid, btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') {
            try { if (typeof notify === 'function') notify('AI non disponibile'); } catch (e) { /* ok */ }
            return;
        }
        const src = aiSelectedText();
        if (!src) { AI.toast('Seleziona un testo prima'); return; }
        if (fid === 'F01') {
            const res = await AI.runFor(btn, 'F01', { text: src.text, tipo: 'flashcard', source: 'notes', materia: (ed && ed.doc && ed.doc.materia) || 'Generale', n: 3, testo: src.text });
            if (!res || res.fallback) return;
            AI.showPreview(res, function () {
                AI.toast('Flashcard approvata: salvala nel modulo Ripasso (nessun salvataggio automatico)');
            });
            return;
        }
        const inp = await AI.askInputs('Migliora testo', [
            {
                name: 'intent', label: 'Intento', type: 'select', options: [
                    { value: 'chiaro', label: 'Chiaro' },
                    { value: 'conciso', label: 'Conciso' },
                    { value: 'formale', label: 'Formale' }
                ]
            }
        ], 'Migliora');
        if (!inp) return;
        const res = await AI.runFor(btn, 'F05', { text: src.text, intent: inp.intent || 'chiaro', source: 'notes', bozza: src.text });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const txt = AI.previewText(r);
            if (!txt) return;
            try {
                AI.registerUndo(pushUndo);
                AI.withUndo(function () {
                    if (src.kind === 'ta') {
                        const ta = src.ta;
                        if (typeof ta.setRangeText === 'function') ta.setRangeText(txt, src.start, src.end, 'end');
                        else ta.value = txt;
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        src.objs[0].text = txt;
                        drawAll();
                    }
                    scheduleSave();
                });
            } catch (e) { AI.toast('Scrittura non riuscita'); }
        });
    }

    function deleteSelection() {
        if (!ed || !ed.lasel || !ed.lasel.length) return;
        pushUndo();
        const sel = ed.lasel;
        ed.doc.objects = ed.doc.objects.filter(o => sel.indexOf(o) < 0);
        repointPage();
        ed.lasel = [];
        drawAll();
        scheduleSave();
    }

    // stato bottoni / barra pagine (chiamata a ogni drawAll)
    function syncSelUi() {
        if (!ed) return;
        if (ed.btnDelSel) {
            ed.btnDelSel.style.display =
                (ed.tool === 'lazo' && ed.lasel && ed.lasel.length) ? '' : 'none';
        }
        if (ed.pgBar) {
            const q = isQuaderno(ed.doc) && Array.isArray(ed.doc.pages) && ed.doc.pages.length;
            ed.pgBar.style.display = q ? 'flex' : 'none';
            if (q && ed.pgLabel) {
                ed.pgLabel.textContent = 'Pagina ' + (ed.doc.page + 1) + '/' + ed.doc.pages.length;
            }
        }
    }

    // ---------- pagine del quaderno ----------
    function goToPage(i) {
        if (!ed || !isQuaderno(ed.doc) || !Array.isArray(ed.doc.pages)) return;
        i = clamp(Math.round(i), 0, ed.doc.pages.length - 1);
        if (i === ed.doc.page) return;
        closeTextOverlay(true);
        ed.doc.page = i;
        ed.doc.objects = ed.doc.pages[i].objects;
        ed.undo = []; ed.redo = [];   // undo/redo per pagina
        ed.selected = null;
        ed.lasel = [];
        centerView();   // reset camera: fit statico centrato
        syncSelUi();
        scheduleSave();
    }

    function addPage() {
        if (!ed || !isQuaderno(ed.doc) || !Array.isArray(ed.doc.pages)) return;
        closeTextOverlay(true);
        ed.doc.pages.push({ objects: [] });
        ed.doc.page = ed.doc.pages.length - 1;
        ed.doc.objects = ed.doc.pages[ed.doc.page].objects;
        ed.undo = []; ed.redo = [];
        ed.selected = null;
        ed.lasel = [];
        centerView();   // reset camera: fit statico centrato
        syncSelUi();
        scheduleSave();
    }

    // ---------- allegati (PPT/PPTX e altri file) ----------
    function basename(p) {
        const s = String(p || '').replace(/\\/g, '/');
        const i = s.lastIndexOf('/');
        return i >= 0 ? s.slice(i + 1) : s;
    }

    function addFileObj(path, name) {
        if (!ed) return;
        const cw = ed.canvas.width / ed.dpr, chh = ed.canvas.height / ed.dpr;
        const cx = (cw / 2 - ed.tx) / ed.scale;
        const cy = (chh / 2 - ed.ty) / ed.scale;
        pushUndo();
        ed.doc.objects.push({
            t: 'file',
            x: cx - 90, y: cy - 28, w: 180, h: 56,
            name: name || basename(path) || 'File',
            path: path || ''
        });
        drawAll();
        scheduleSave();
    }

    function importPpt() {
        if (!ed) return;
        StudyStore.hasBackend().then(has => {
            if (!has) { filePptFallback(); return; }
            return StudyStore.pickAsset().then(asset => {
                if (!ed) return;
                if (asset && asset.path) addFileObj(asset.path, asset.name || basename(asset.path));
                else filePptFallback();
            }).catch(() => filePptFallback());
        }).catch(() => filePptFallback());
    }

    function filePptFallback() {
        if (!ed) return;
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';
        inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            addFileObj(f.path || f.name, f.name);
        });
        inp.click();
    }

    function openFileObj(o) {
        if (!o) return;
        if (!o.path) {
            alert('Percorso del file non disponibile: reinserisci l\u2019allegato.');
            return;
        }
        StudyStore.openFilePath(o.path).then(r => {
            if (r && r.success === false) console.warn('Apri file:', r.error || 'errore');
        }).catch(e => console.warn('Apri file:', e));
    }

    // ---------- "migliora scrittura" (semplifica tratti) ----------
    function perpDist(p, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
        return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    }

    function rdp(points, eps, depth) {
        depth = depth || 0;
        if (points.length < 3 || depth > 500) return points.slice();
        let maxD = 0, idx = 1;
        const a = points[0], b = points[points.length - 1];
        for (let i = 1; i < points.length - 1; i++) {
            const d = perpDist(points[i], a, b);
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD <= eps) return [a, b];
        const left = rdp(points.slice(0, idx + 1), eps, depth + 1);
        const right = rdp(points.slice(idx), eps, depth + 1);
        return left.slice(0, -1).concat(right);
    }

    function improveHandwriting() {
        if (!ed) return;
        const strokes = ed.doc.objects.filter(o => o.t === 'stroke' && o.pts.length > 2);
        if (!strokes.length) return;
        pushUndo();
        strokes.forEach(o => {
            // dedupe dei punti troppo vicini
            const ded = [];
            o.pts.forEach(p => {
                const last = ded[ded.length - 1];
                if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.7) ded.push(p);
            });
            if (ded.length > 2) o.pts = rdp(ded, 1.5);
            else o.pts = ded;
        });
        drawAll();
        scheduleSave();
    }

    // ---------- pinza / wheel ----------
    function pinchState() {
        const list = Array.from(ed.pointers.values()).filter(p => p.type !== 'mouse');
        if (list.length < 2) return null;
        const r = ed.canvas.getBoundingClientRect();
        const a = list[0], b = list[1];
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        return { dist: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), mx: mx, my: my };
    }

    function startPinch() {
        if (ed && ed.zoomLock) return;
        const s = pinchState();
        if (!s) return;
        ed.pinch = {
            dist: s.dist,
            scale0: ed.scale,
            wx: (s.mx - ed.tx) / ed.scale,
            wy: (s.my - ed.ty) / ed.scale
        };
    }

    function updatePinch() {
        const s = pinchState();
        if (!s || !ed.pinch) return;
        const k = s.dist / ed.pinch.dist;
        ed.scale = clamp(ed.pinch.scale0 * k, 0.15, 5);
        ed.tx = s.mx - ed.pinch.wx * ed.scale;
        ed.ty = s.my - ed.pinch.wy * ed.scale;
        drawAll();
    }

    function zoomAt(mx, my, factor) {
        if (!ed) return;
        const wx = (mx - ed.tx) / ed.scale;
        const wy = (my - ed.ty) / ed.scale;
        ed.scale = clamp(ed.scale * factor, 0.15, 5);
        ed.tx = mx - wx * ed.scale;
        ed.ty = my - wy * ed.scale;
        drawAll();
    }

    // ---------- gestori pointer ----------
    function onPointerDown(e) {
        if (!ed) return;
        e.preventDefault();
        // palm rejection: se un tratto penna è attivo, ignora i touch
        if (e.pointerType === 'pen') ed.penIds.add(e.pointerId);
        if (e.pointerType === 'touch' && (ed.penIds.size > 0 || ed.strokeFromPen)) {
            return;
        }
        try { ed.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });

        // chiude/committe eventuali caselle di testo aperte
        blurActive();

        if (ed.pointers.size >= 2) {
            // lucchetto zoom: la seconda mano viene ignorata senza
            // interrompere il tratto in corso (disegno sicuro)
            if (ed.zoomLock) {
                ed.pointers.delete(e.pointerId);
                return;
            }
            // annulla eventuale tratto in corso e passa alla pinza
            if (ed.active) { ed.active = null; }
            if (ed.eraserOn) ed.eraserOn = false;
            if (ed.lasso) ed.lasso = null;
            if (ed.selDrag) ed.selDrag = null;
            startPinch();
            drawAll();
            return;
        }
        if (ed.pinch) return;

        const p = toWorld(e);

        // SCRITTURA SOLO IN PAGINA: un click/tratto che inizia sul nero
        // (fuori dai bordi pagina) non ha alcun effetto
        if (!inPage(p)) return;

        if (ed.tool === 'testo') { openTextOverlay(p, null); return; }

        if (ed.tool === 'lazo') { lassoDown(p); return; }

        if (ed.tool === 'selezione') {
            const hit = hitTest(p);
            ed.selected = hit;
            ed.drag = hit ? { last: p, obj: hit } : null;
            drawAll();
            return;
        }

        if (ed.tool === 'gomma') {
            pushUndo();   // una passata di gomma = UN solo passo di undo
            ed.eraserOn = true;
            ed.strokeFromPen = (e.pointerType === 'pen');
            ed.eraserPrev = { x: p.x, y: p.y };
            // cancellazione PARZIALE: si rimuove solo l'inchiostro nel cerchio
            eraseCapsule(ed.eraserPrev, ed.eraserPrev);
            drawAll();
            return;
        }

        // penna / evidenziatore
        pushUndo();
        ed.strokeFromPen = (e.pointerType === 'pen');
        ed.inkHeld = false;
        ed.inkLastMoveT = 0;
        if (ed.tool === 'evidenziatore') {
            ed.active = {
                t: 'stroke', tool: 'highlighter',
                color: ed.hlColor, size: ed.hlSize, alpha: 0.35,
                pts: [[p.x, p.y]]
            };
        } else {
            const alpha = ed.penType === 'pencil' ? 0.55 : (ed.penType === 'marker' ? 0.9 : 1);
            ed.active = {
                t: 'stroke', tool: ed.penType,
                color: ed.penColor, size: ed.penSize, alpha: alpha,
                base: ed.penSize, sizes: [ed.penSize],
                pts: [[p.x, p.y]],
                // R14 A2: timestamp ALINATO con pts[0] (finestra flick)
                ts: [(typeof e.timeStamp === 'number' && e.timeStamp > 0)
                    ? e.timeStamp : performance.now()]
            };
            // "Migliora scrittura": ancora per l'assistenza al tratto
            ed.helpAnchor = ed.helpOn ? { x: p.x, y: p.y } : null;
        }
        drawAll();
    }

    function onPointerMove(e) {
        if (!ed) return;
        // ignora i pointer non tracciati (es. touch scartati dalla palm rejection)
        if (!ed.pointers.has(e.pointerId)) return;
        ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
        if (ed.pointers.size >= 2 && ed.pinch) { updatePinch(); return; }
        if (ed.pinch) return;

        const p = toWorld(e);

        if (ed.lasso) {
            const lpts = ed.lasso.pts;
            const llast = lpts[lpts.length - 1];
            if (Math.hypot(p.x - llast[0], p.y - llast[1]) >= 0.7) {
                lpts.push([p.x, p.y]);
                drawAll();
            }
            return;
        }
        if (ed.eraserOn) {
            // capsula tra il punto precedente e quello attuale: anche i
            // movimenti veloci cancellano in modo continuo, senza buchi
            const prev = ed.eraserPrev || p;
            eraseCapsule(prev, p);
            ed.eraserPrev = { x: p.x, y: p.y };
            drawAll();
            return;
        }
        if (ed.active) {
            const pts = ed.active.pts;
            const __tEvt = performance.now();
            // R14 L1/L2: nessun lag live e nessuna coda live: filtro One
            // Euro a parametri fissi; pulizia solo a fine tratto.
            const smoothOn = ed.helpOn &&
                ed.active.tool !== 'highlighter' && ed.active.tool !== 'eraser';
            if (smoothOn) {
                if (!ed.inkFx) ed.inkFx = mkOneEuro();
            } else {
                ed.inkFx = null;
            }
            ed.inkLastEvt = performance.now();
            // L1: punti COALESCED reali (frequenza della penna); i
            // getPredictedEvents NON usati: il browser puo' ritirarli ->
            // artefatti sul tratto (dichiarato)
            const coals = (typeof e.getCoalescedEvents === 'function')
                ? e.getCoalescedEvents() : null;
            const evList = (coals && coals.length) ? coals : [e];
            for (let ci = 0; ci < evList.length; ci++) {
                const ce = evList[ci];
                const cp = toWorld(ce);
                // clock UNICO performance.now: i timeStamp nativi degli
                // eventi possono vivere su altro dominio (misurato jsdom:
                // raw su epoca, paint su performance.now -> settle mai)
                const ct = performance.now();
                if (window.__ink) {
                    window.__ink.trace.push({ k: 'raw', t: ct, x: cp.x, y: cp.y });
                }
                // spessore: pressione PER EVENTO (i coalesced hanno la
                // pressione reale del campione, non quella dell'ultimo)
                let sz = (ed.active.tool === 'highlighter') ? ed.hlSize : ed.penSize;
                if (ed.strokeFromPen && ce.pointerType === 'pen' &&
                    ce.pressure > 0.02 && ed.active.tool !== 'highlighter' &&
                    ed.active.tool !== 'eraser') {
                    const base = ed.active.base || ed.penSize;
                    sz = Math.max(1, Math.min(
                        Math.round(base * (0.45 + 0.95 * ce.pressure)),
                        Math.round(base * 1.6)));
                }
                ed.active.size = sz;
                let wx = cp.x, wy = cp.y;
                ed.inkLastRaw = { x: cp.x, y: cp.y, t: ct };
                if (smoothOn && ed.inkFx) {
                    const f = ed.inkFx.filter(wx, wy, ct);
                    wx = f.x; wy = f.y;
                }
                const lastP = pts[pts.length - 1];
                if (Math.hypot(wx - lastP[0], wy - lastP[1]) >= 0.7) {
                    pts.push([wx, wy]);
                    if (ed.active.sizes) ed.active.sizes.push(sz);
                    // A2/A3: timestamp per punto (finestra flick) + marcatori
                    // di movimento per l'hold-still
                    if (!ed.active.ts) ed.active.ts = [];
                    ed.active.ts.push(ct);
                    ed.inkLastMoveT = performance.now();
                    ed.inkHeld = false;
                }
            }
            if (window.__ink) {
                const __l = pts[pts.length - 1];
                window.__ink.trace.push({ k: 'evt', t: __tEvt, n: pts.length,
                                          x: __l[0], y: __l[1] });
            }
            // render del buffer punti via rAF (mai drawAll sincrono qui)
            ed.inkDirty = true;
            scheduleInkFrame();
            return;
        }
        if (ed.selDrag) { selDragMove(p); return; }
        if (ed.drag && ed.tool === 'selezione') {
            const o = ed.drag.obj;
            const dx = p.x - ed.drag.last.x, dy = p.y - ed.drag.last.y;
            if (dx || dy) {
                if (!ed.drag.moved) { pushUndo(); ed.drag.moved = true; }
                if (o.t === 'stroke') o.pts.forEach(pt => { pt[0] += dx; pt[1] += dy; });
                else { o.x += dx; o.y += dy; }
                ed.drag.last = p;
                drawAll();
            }
        }
    }

    function endPointer(e) {
        if (!ed) return;
        ed.pointers.delete(e.pointerId);
        ed.penIds.delete(e.pointerId);
        if (e.pointerType === 'pen' && ed.penIds.size === 0) ed.strokeFromPen = false;
        try { ed.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }

        if (ed.pinch && ed.pointers.size < 2) {
            ed.pinch = null;
            return;
        }
        if (ed.lasso) { lassoUp(); return; }
        if (ed.eraserOn) {
            ed.eraserOn = false;
            ed.eraserPrev = null;
            ed.strokeFromPen = false;
            scheduleSave();
            drawAll();
            return;
        }
        if (ed.active) {
            const o = ed.active;
            if (window.__ink) {
                window.__ink.trace.push({ k: 'stop', t: performance.now() });
            }
            ed.active = null;
            ed.helpAnchor = null;
            ed.strokeFromPen = false;
            if (o.pts.length) {
                // R14 L2: qui contano Intensita aiuto/Smussamento (fine
                // tratto + ampiezza snap); R14 A: riconoscimento forme e
                // frecce solo qui (o all'hold-still)
                inkEndCleanup(o);
                finalizeEndStroke(o);
                scheduleSave();
            }
            ed.inkFx = null;
            ed.inkLastRaw = null;
            ed.inkLastEvt = 0;
            drawAll();
            return;
        }
        if (ed.selDrag) {
            const movedSel = ed.selDrag.moved;
            ed.selDrag = null;
            if (movedSel) scheduleSave();
            return;
        }
        if (ed.drag) {
            const moved = ed.drag.moved;
            ed.drag = null;
            if (moved) scheduleSave();
        }
    }

    function onWheel(e) {
        if (!ed) return;
        e.preventDefault();
        // lucchetto zoom: niente pan/zoom accidentali (disegno sicuro)
        if (ed.zoomLock) return;
        const r = ed.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        if (e.ctrlKey || e.metaKey) {
            zoomAt(mx, my, e.deltaY < 0 ? 1.12 : 1 / 1.12);
        } else {
            ed.tx -= e.deltaX;
            ed.ty -= e.deltaY;
            drawAll();
        }
    }

    function onDblClick(e) {
        if (!ed) return;
        const p = toWorld(e);
        const hit = hitTest(p);
        if (!hit) return;
        if (hit.t === 'text') { openTextOverlay(p, hit); return; }
        // doppio click su un allegato (PPT ecc.): apre il file localmente
        if (hit.t === 'file') openFileObj(hit);
    }

    function onKeyDown(e) {
        if (!ed) return;
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
        // Esc (A1): chiude i popover aperti, anche da input contenuti nei
        // popover stessi (funziona "anche dai popover"). L'overlay di testo
        // gestisce Esc in proprio e ferma la propagazione (openTextOverlay):
        // qui non lo tocchiamo -> comportamento esistente invariato.
        if (e.key === 'Escape' && !ed.textTa) {
            if (closeAllPops()) { e.preventDefault(); return; }
        }
        if (typing || ed.textTa) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
            e.preventDefault();
            redo();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') &&
            ed.tool === 'lazo' && ed.lasel && ed.lasel.length) {
            e.preventDefault();
            deleteSelection();
        }
    }

    function onResize() {
        if (!ed) return;
        const oldW = ed.canvas.width / ed.dpr, oldH = ed.canvas.height / ed.dpr;
        resizeCanvas();
        const newW = ed.canvas.width / ed.dpr, newH = ed.canvas.height / ed.dpr;
        ed.tx += (newW - oldW) / 2;
        ed.ty += (newH - oldH) / 2;
        drawAll();
    }

    // ---------- import ----------
    function importImage() {
        if (!ed) return;
        StudyStore.hasBackend().then(has => {
            if (has) {
                StudyStore.pickAsset().then(asset => {
                    if (asset && asset.path) addImageSource(StudyStore.assetUrl(asset.path));
                }).catch(() => { fileImageFallback(); });
            } else {
                fileImageFallback();
            }
        }).catch(() => fileImageFallback());
    }

    function fileImageFallback() {
        if (!ed) return;
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => addImageSource(String(rd.result));
            rd.readAsDataURL(f);
        });
        inp.click();
    }

    function addImageSource(src) {
        if (!ed) return;
        const img = new Image();
        img.onload = () => {
            if (!ed) return;
            const maxW = 520, maxH = 420;
            let w = img.naturalWidth || 320, h = img.naturalHeight || 240;
            const k = Math.min(maxW / w, maxH / h, 1);
            w *= k; h *= k;
            const cw = ed.canvas.width / ed.dpr, chh = ed.canvas.height / ed.dpr;
            const cx = (cw / 2 - ed.tx) / ed.scale;
            const cy = (chh / 2 - ed.ty) / ed.scale;
            pushUndo();
            ed.doc.objects.push({ t: 'image', x: cx - w / 2, y: cy - h / 2, w: w, h: h, src: src });
            drawAll();
            scheduleSave();
        };
        img.onerror = () => { console.warn('Immagine non caricata'); };
        img.src = src;
    }

    function importTextFile() {
        if (!ed) return;
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.txt,.md,text/plain,text/markdown';
        inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
                if (!ed) return;
                let txt = String(rd.result || '').replace(/\r\n/g, '\n');
                if (txt.length > 20000) txt = txt.slice(0, 20000) + '\n\u2026';
                if (!txt.trim()) return;
                const cw = ed.canvas.width / ed.dpr, chh = ed.canvas.height / ed.dpr;
                const cx = (cw / 2 - ed.tx) / ed.scale;
                const cy = (chh / 2 - ed.ty) / ed.scale;
                pushUndo();
                const o = {
                    t: 'text', x: cx - 300, y: cy - 60, w: 10, h: 10,
                    text: txt, size: 17, color: '#141414',
                    bold: false, italic: false, underline: false
                };
                measureTextObj(o);
                ed.doc.objects.push(o);
                drawAll();
                scheduleSave();
            };
            rd.readAsText(f);
        });
        inp.click();
    }

    // ---------- toolbar strumenti ----------
    function setTool(id) {
        if (!ed) return;
        ed.tool = id;
        ed.selected = null;
        if (ed.active && ed.active.tool === 'eraser') ed.active = null;
        if (ed.lasso) ed.lasso = null;
        if (ed.selDrag) ed.selDrag = null;
        if (id !== 'testo') closeTextOverlay(true);
        // FONTE UNICA stato UI (A2, fix B1): syncColorSwatches() chiama a sua
        // volta syncToolActive() -> regola "esattamente UN bottone attivo"
        // su tutti i gruppi (strumenti + preset destri).
        syncColorSwatches();
        syncToolGroups();
        ed.canvas.style.cursor = (id === 'gomma') ? 'none' : (id === 'selezione' ? 'default' : 'crosshair');
        if (ed.eraseCur) ed.eraseCur.style.display = 'none';
        drawAll();
    }

    function syncColorSwatches() {
        if (!ed) return;
        ed.grpPen.querySelectorAll('[data-col]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-col') === ed.penColor);
        });
        ed.grpHl.querySelectorAll('[data-hcol]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-hcol') === ed.hlColor);
        });
        ed.grpPen.querySelectorAll('[data-sz]').forEach(b => {
            b.classList.toggle('active', Number(b.getAttribute('data-sz')) === ed.penSize);
        });
        ed.grpHl.querySelectorAll('[data-hsz]').forEach(b => {
            b.classList.toggle('active', Number(b.getAttribute('data-hsz')) === ed.hlSize);
        });
        ed.grpPen.querySelectorAll('[data-pt]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-pt') === ed.penType);
        });
        if (ed.penCtl) ed.penCtl.paint();
        if (ed.hlCtl) ed.hlCtl.paint();
        if (ed.erCtl) ed.erCtl.paint();
        // PALLINI COLORE VIVI: sempre pari al colore con cui quello
        // strumento disegna; ogni tratto/strumento ha il proprio colore
        if (ed.dotPenna) ed.dotPenna.style.background = ed.penTondaColor || '#141414';
        if (ed.dotEvid) ed.dotEvid.style.background = ed.hlColor || '#ffe14d';
        if (ed.dotGomma) ed.dotGomma.style.background = ERASER_DOT;
        if (ed.dotMatita) ed.dotMatita.style.background = ed.matitaColor || '#5c5c5c';
        if (ed.dotMarker) ed.dotMarker.style.background = ed.markerColor || '#d63b3b';
        // attivita' bottoni (tool + preset): delegata alla FONTE UNICA (A2)
        syncToolActive();
    }

    // ===== REGOLA "ESATTAMENTE UN BOTTONE ACCESO" (A2, fix B1/B2) =====
    // I preset destri (matita/pennarello) sono strumenti a tutti gli effetti:
    // se esiste un preset coerente con lo stato attivo (tool + penType),
    // l'unico bottone acceso e' IL PRESET e il bottone "Penna" resta spento;
    // altrimenti l'unico acceso e' il [data-tool] == ed.tool.
    // "Migliora scrittura" (data-help) NON e' uno strumento: usa la classe
    // .fn-tb.mode e resta fuori da questo sweep (solo data-tool/data-preset).
    function syncToolActive() {
        if (!ed || !ed.bar) return;
        const match = PRESETS.find(ps =>
            ps.tool === ed.tool &&
            (!ps.penType || ps.penType === ed.penType));
        ed.bar.querySelectorAll('[data-tool]').forEach(b =>
            b.classList.toggle('active', !match && b.getAttribute('data-tool') === ed.tool));
        ed.bar.querySelectorAll('[data-preset]').forEach(b =>
            b.classList.toggle('active', !!match && b.getAttribute('data-preset') === match.id));
    }

    // slider range + input number sincronizzati (1..100), valore mostrato "N px"
    function sizeControl(label, get, set) {
        const wrap = App.el('span', 'nt-size-ctl');
        wrap.setAttribute('aria-label', label);
        wrap.title = label;
        const rng = document.createElement('input');
        rng.type = 'range';
        rng.min = 1; rng.max = 100; rng.step = 1;
        const num = document.createElement('input');
        num.type = 'number';
        num.min = 1; num.max = 100; num.step = 1;
        const unit = App.el('span', 'nt-size-unit');
        function val() { return clamp(Math.round(Number(get()) || 1), 1, 100); }
        function paint() {
            const v = val();
            rng.value = String(v);
            num.value = String(v);
            unit.textContent = v + ' px';
        }
        function apply(v) {
            v = clamp(Math.round(Number(v) || 1), 1, 100);
            rng.value = String(v);
            num.value = String(v);
            unit.textContent = v + ' px';
            set(v);          // valore applicato subito (anche al tratto in corso)
            if (ed) drawAll();
        }
        rng.addEventListener('input', () => apply(Number(rng.value)));
        num.addEventListener('input', () => {
            if (num.value === '') return;
            apply(Number(num.value));
        });
        num.addEventListener('blur', paint);
        wrap.appendChild(rng);
        wrap.appendChild(num);
        wrap.appendChild(unit);
        wrap.paint = paint;
        paint();
        return wrap;
    }

    // ============================================================
    // CHROME FLOTTANTE (stile FreeNotes): barra sottile + pillole
    // ============================================================
    const IC = {
        back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
        paper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
        undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
        redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>',
        img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
        txt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
        ppt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6M12 12v6"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
        pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
        hl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-8.5 8.5a2.12 2.12 0 0 1-3-3L19 9l3-3-2-4-6 6"/></svg>',
        eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3L13 19"/></svg>',
        text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>',
        lazo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12c0 4-3.6 7-8 7-1.2 0-2.4-.2-3.4-.7L4 20l1.2-3.6C4.4 15.4 4 14.2 4 13c0-4 3.6-7 8-7s8 3 8 6z" stroke-dasharray="3 3"/></svg>',
        move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>',
        pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/></svg>',
        marker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l6 6-8 8H4v-6l8-8z"/><path d="M3 22h18"/></svg>',
        palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.6-1.4-.4-.4-.6-.9-.6-1.4 0-1.1.9-2 2-2h2.4A4.8 4.8 0 0 0 22 12 10 10 0 0 0 12 2z"/></svg>',
        lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
        unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
        book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
    };

    // preset disponibili nella seconda riga: MATITA e PENNARELLO
    // (penna/evidenziatore/gomma sono gia' nel gruppo strumenti: niente
    // duplicazioni; la gomma ha comunque il suo pallino nella prima riga)
    const ERASER_DOT = '#ff9ecb';
    const PRESETS = [
        { id: 'matita', tool: 'penna', penType: 'pencil', color: '#5c5c5c', size: 3, title: 'Matita grafite',   icon: IC.pencil, dot: '#5c5c5c' },
        { id: 'markR',  tool: 'penna', penType: 'marker', color: '#d63b3b', size: 12, title: 'Pennarello rosso', icon: IC.marker, dot: '#d63b3b' }
    ];

    function fnBtn(icon, title, cls) {
        const b = App.el('button', cls || 'fn-ic');
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = icon;
        return b;
    }

    // costruisce tutta la chrome flottante dell'editor (root = .nt-editor)
    function buildChrome(root, stage) {
        ed.zoomLock = false;
        // stato "Migliora scrittura" (toggle) + colori memorizzati per tratto
        ed.helpOn = false;
        ed.helpAssist = 0.6;    // 0..1 intensita' aiuto
        ed.helpSmooth = 0.5;    // 0..1 smussamento righe
        ed.helpAnchor = null;
        // R14 A4: ink shaping (toggle + hold-still) persistito in
        // localStorage 'nt14_shaping' (default: forme ON, frecce ON, 350ms)
        (function () {
            var s = {};
            try { s = JSON.parse(localStorage.getItem('nt14_shaping') || '{}'); }
            catch (e) { s = {}; }
            ed.shpOn = (s.shpOn !== undefined) ? !!s.shpOn : true;
            ed.arrowOn = (s.arrowOn !== undefined) ? !!s.arrowOn : true;
            ed.holdMs = isFinite(s.holdMs) ? Math.min(800, Math.max(200, s.holdMs)) : 350;
            ed.inkSnapAmp = 0;
        })();
        ed.penTondaColor = '#141414';  // colore memorizzato penna tonda
        ed.matitaColor = '#5c5c5c';    // colore memorizzato matita
        ed.markerColor = '#d63b3b';    // colore memorizzato pennarello
        // cursore anteprima della gomma: cerchio che segue lo zoom
        const eraseCur = App.el('div', 'fn-erasecur');
        stage.appendChild(eraseCur);
        ed.eraseCur = eraseCur;

        // ---------- barra superiore sottile ----------
        const top = App.el('div', 'fn-top');
        const btnBack = fnBtn(IC.back, 'Torna all\u2019elenco');
        btnBack.addEventListener('click', () => backToList());
        const titleBtn = App.el('button', 'fn-title');
        titleBtn.type = 'button';
        titleBtn.textContent = ed.title || 'Senza titolo';
        titleBtn.title = 'Dettagli nota (materia, tag, carta)';
        ed.titleEl = titleBtn;
        titleBtn.setAttribute('data-poptrig', '1');
        titleBtn.addEventListener('click', () => togglePop(ed.popMeta, openMeta));
        const btnPaper = fnBtn(IC.paper, 'Impostazioni carta');
        btnPaper.setAttribute('data-poptrig', '1');
        btnPaper.addEventListener('click', () => togglePop(ed.popPaper, openPaper));
        top.appendChild(btnBack);
        top.appendChild(titleBtn);
        top.appendChild(btnPaper);
        root.appendChild(top);

        // ---------- pill sinistra: azioni ----------
        const pillL = App.el('div', 'fn-pill fn-pill-left');
        ed.btnUndo = fnBtn(IC.undo, 'Annulla (Ctrl+Z)', 'fn-tb');
        // R14 A5: undo a due livelli sugli shape (dichiarato nel tooltip)
        ed.btnUndo.title = 'Annulla (Ctrl+Z): su una forma riconosciuta, '
            + 'il 1° annulla riporta al tratto grezzo, il 2° lo rimuove';
        ed.btnUndo.addEventListener('click', () => undo());
        ed.btnRedo = fnBtn(IC.redo, 'Ripeti (Ctrl+Y)', 'fn-tb');
        ed.btnRedo.addEventListener('click', () => redo());
        const btnImg = fnBtn(IC.img, 'Immagine', 'fn-tb');
        btnImg.addEventListener('click', () => importImage());
        const btnTxtFile = fnBtn(IC.txt, 'Documento', 'fn-tb');
        btnTxtFile.addEventListener('click', () => importTextFile());
        const btnPpt = fnBtn(IC.ppt, 'File PPT/PPTX', 'fn-tb');
        btnPpt.addEventListener('click', () => importPpt());
        // pannello Fonti (A3): laterale collassabile a SINISTRA (NON popover:
        // vedi buildFonti -> motivazione). Aperto/chiudo SOLO da qui.
        const btnFonti = fnBtn(IC.book, 'Fonti', 'fn-tb');
        btnFonti.setAttribute('data-fonti', '1');
        ed.fontiBtn = btnFonti;
        btnFonti.addEventListener('click', () => toggleFonti());
        ed.btnDelSel = fnBtn(IC.trash, 'Elimina selezione', 'fn-tb');
        ed.btnDelSel.style.display = 'none';
        ed.btnDelSel.addEventListener('click', () => deleteSelection());
        pillL.appendChild(ed.btnUndo);
        pillL.appendChild(ed.btnRedo);
        pillL.appendChild(App.el('span', 'fn-sep'));
        pillL.appendChild(btnImg);
        pillL.appendChild(btnTxtFile);
        pillL.appendChild(btnPpt);
        pillL.appendChild(btnFonti);
        pillL.appendChild(ed.btnDelSel);
        // ---- H11: azioni AI sulla selezione testo (F01/F05) ----
        pillL.appendChild(App.el('span', 'fn-sep'));
        const aiCard = App.el('button', 'fn-tb');
        aiCard.type = 'button';
        aiCard.textContent = 'AI';
        aiCard.title = 'Flashcard dalla selezione (AI: F01)';
        aiCard.style.cssText = 'width:auto;height:26px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:800;';
        aiCard.addEventListener('click', function (e) { aiSelectionAction('F01', e.currentTarget); });
        const aiImp = App.el('button', 'fn-tb');
        aiImp.type = 'button';
        aiImp.textContent = 'Migliora';
        aiImp.title = 'Migliora testo (AI: F05) - chiaro / conciso / formale';
        aiImp.style.cssText = 'width:auto;height:26px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:800;';
        aiImp.addEventListener('click', function (e) { aiSelectionAction('F05', e.currentTarget); });
        pillL.appendChild(aiCard);
        pillL.appendChild(aiImp);
        ed.btnAiCard = aiCard;
        ed.btnAiImprove = aiImp;
        root.appendChild(pillL);

        // ---------- pill destra: strumenti + preset + colore ----------
        const pillR = App.el('div', 'fn-pill fn-pill-right');
        const TOOL_ICONS = { penna: IC.pen, evidenziatore: IC.hl, gomma: IC.eraser, testo: IC.text, lazo: IC.lazo, selezione: IC.move };
        // pallino colore vivo sotto gli strumenti che "disegnano"
        const COLOR_DOT_TOOLS = { penna: 'dotPenna', evidenziatore: 'dotEvid', gomma: 'dotGomma' };
        TOOLS.forEach(t => {
            const b = fnBtn(TOOL_ICONS[t.id] || IC.pen, t.label, 'fn-tb');
            b.setAttribute('data-tool', t.id);
            if (t.id === 'penna') b.classList.add('active');
            if (COLOR_DOT_TOOLS[t.id]) {
                const dot = App.el('span', 'fn-dot');
                b.appendChild(dot);
                ed[COLOR_DOT_TOOLS[t.id]] = dot;
            }
            b.addEventListener('click', () => {
                setTool(t.id);
                if (t.id === 'penna') {
                    // la penna tonda usa il SUO colore memorizzato
                    ed.penType = 'pen';
                    ed.penColor = ed.penTondaColor;
                    syncColorSwatches();
                }
            });
            pillR.appendChild(b);
            // "Migliora scrittura" IMMEDIATAMENTE ACCANTO al bottone T
            if (t.id === 'testo') {
                const bHelp = fnBtn(
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>',
                    'Migliora scrittura', 'fn-tb');
                bHelp.setAttribute('data-help', '1');
                bHelp.setAttribute('data-poptrig', '1');
                ed.btnHelp = bHelp;
                bHelp.addEventListener('click', () => {
                    ed.helpOn = !ed.helpOn;
                    // MODALITA', non strumento (fix B5): .mode (bordo 1.5px)
                    // invece del riempimento pieno .active dei tool
                    bHelp.classList.toggle('mode', ed.helpOn);
                    bHelp.classList.remove('active');
                    if (!ed.helpOn) {
                        ed.helpAnchor = null;
                        // disattivato: i popover si chiudono (fonte unica A1)
                        closeAllPops();
                    } else {
                        togglePop(ed.popHelp);
                    }
                });
                pillR.appendChild(bHelp);
        // R14 A4: stato shaping VISIBILE in toolbar (stesso pattern .mode
        // del toggle Aiuto) + persistenza via saveShaping()
        const bShp = fnBtn('▢', 'Riconoscimento forme: attivo/disattivo');
        bShp.addEventListener('click', () => {
            ed.shpOn = !ed.shpOn;
            bShp.classList.toggle('mode', ed.shpOn);
            bShp.title = ed.shpOn
                ? 'Riconoscimento forme: attivo (clicca per spegnere)'
                : 'Riconoscimento forme: spento (clicca per attivare)';
            saveShaping();
        });
        if (ed.shpOn) bShp.classList.add('mode');
        bShp.setAttribute('data-shaping', 'forme');
        pillR.appendChild(bShp);
        const bArr = fnBtn('→', 'Frecce automatiche: attive/disattive');
        bArr.addEventListener('click', () => {
            ed.arrowOn = !ed.arrowOn;
            bArr.classList.toggle('mode', ed.arrowOn);
            bArr.title = ed.arrowOn
                ? 'Frecce automatiche: attive (clicca per spegnere)'
                : 'Frecce automatiche: spente (clicca per attivare)';
            saveShaping();
        });
        if (ed.arrowOn) bArr.classList.add('mode');
        bArr.setAttribute('data-shaping', 'frecce');
        pillR.appendChild(bArr);
            }
        });
        pillR.appendChild(App.el('span', 'fn-sep'));
        PRESETS.forEach(ps => {
            const b = fnBtn(ps.icon, ps.title, 'fn-tb fn-preset');
            b.setAttribute('data-preset', ps.id);
            const dot = App.el('span', 'fn-dot');
            dot.style.background = ps.dot;
            b.appendChild(dot);
            if (ps.id === 'matita') ed.dotMatita = dot;
            if (ps.id === 'markR') ed.dotMarker = dot;
            b.addEventListener('click', () => applyPreset(ps));
            pillR.appendChild(b);
        });
        pillR.appendChild(App.el('span', 'fn-sep'));
        // tavolozza SENZA pallino colore
        const btnColor = fnBtn(IC.palette, 'Colore e spessore', 'fn-tb');
        btnColor.setAttribute('data-color', '1');
        btnColor.setAttribute('data-poptrig', '1');
        ed.colorBtn = btnColor;
        btnColor.addEventListener('click', () => { togglePop(ed.popColor); syncToolGroups(); });
        pillR.appendChild(btnColor);
        ed.bar = pillR;
        root.appendChild(pillR);

        // ---------- pill zoom con lucchetto ----------
        const zoomPill = App.el('div', 'fn-zoom');
        const zpct = App.el('button', 'fn-zpct', '100%');
        zpct.type = 'button';
        zpct.title = 'Controlli zoom';
        zpct.setAttribute('data-poptrig', '1');
        ed.zoomLabel = zpct;
        const zlock = fnBtn(IC.unlock, 'Blocca pan/zoom', 'fn-lock');
        zlock.addEventListener('click', () => {
            ed.zoomLock = !ed.zoomLock;
            zlock.classList.toggle('active', ed.zoomLock);
            zlock.innerHTML = ed.zoomLock ? IC.lock : IC.unlock;
            zlock.title = ed.zoomLock ? 'Zoom sbloccato' : 'Blocca pan/zoom';
        });
        zpct.addEventListener('click', () => togglePop(ed.popZoom));
        zoomPill.appendChild(zpct);
        zoomPill.appendChild(zlock);
        root.appendChild(zoomPill);

        // ---------- pill pagine (quaderno) ----------
        const pgBar = App.el('div', 'fn-pages');
        const pgLabel = App.el('span', 'fn-plabel', 'Pagina 1/1');
        const pgPrev = fnBtn(IC.back, 'Pagina precedente', 'fn-tb');
        pgPrev.addEventListener('click', () => { if (ed) goToPage((ed.doc.page || 0) - 1); });
        const pgNext = fnBtn(IC.back, 'Pagina successiva', 'fn-tb');
        pgNext.style.transform = 'scaleX(-1)';
        pgNext.addEventListener('click', () => { if (ed) goToPage((ed.doc.page || 0) + 1); });
        const pgAdd = App.el('button', 'fn-padd', '+ Pagina');
        pgAdd.type = 'button';
        pgAdd.addEventListener('click', () => addPage());
        pgBar.appendChild(pgPrev);
        pgBar.appendChild(pgLabel);
        pgBar.appendChild(pgNext);
        pgBar.appendChild(pgAdd);
        root.appendChild(pgBar);
        ed.pgBar = pgBar;
        ed.pgLabel = pgLabel;

        // ---------- popover: colore + spessore ----------
        const popColor = App.el('div', 'fn-pop fn-pop-color');
        popColor.appendChild(App.el('h4', null, 'Colore e spessore'));
        const grpPen = App.el('div', 'fn-block');
        PEN_TYPES.forEach(pt => {
            const b = btn('tool-btn nt-size', pt.label, () => { ed.penType = pt.id; syncColorSwatches(); });
            b.setAttribute('data-pt', pt.id);
            grpPen.appendChild(b);
        });
        grpPen.appendChild(App.el('span', 'tool-sep'));
        PEN_COLORS.forEach(c => {
            const b = btn('nt-swatch', '');
            b.title = c.label;
            b.style.background = c.hex;
            b.setAttribute('data-col', c.hex);
            b.addEventListener('click', () => applyPaletteColor(c.hex));
            grpPen.appendChild(b);
        });
        const custom = document.createElement('input');
        custom.type = 'color';
        custom.className = 'color-swatch';
        custom.title = 'Colore personalizzato';
        custom.value = '#141414';
        custom.addEventListener('input', () => applyPaletteColor(custom.value));
        grpPen.appendChild(custom);
        const penCtl = sizeControl('Spessore penna', () => ed.penSize, v => {
            ed.penSize = v;
            if (ed.active && ed.active.tool !== 'eraser' && ed.active.tool !== 'highlighter') ed.active.size = v;
        });
        grpPen.appendChild(penCtl);
        popColor.appendChild(grpPen);

        const grpHl = App.el('div', 'fn-block');
        HL_COLORS.forEach(c => {
            const b = btn('nt-swatch', '');
            b.title = c.label;
            b.style.background = c.hex;
            b.setAttribute('data-hcol', c.hex);
            b.addEventListener('click', () => { ed.hlColor = c.hex; syncColorSwatches(); });
            grpHl.appendChild(b);
        });
        grpHl.appendChild(App.el('span', 'tool-sep'));
        const hlCtl = sizeControl('Spessore pennarello', () => ed.hlSize, v => {
            ed.hlSize = v;
            if (ed.active && ed.active.tool === 'highlighter') ed.active.size = v;
        });
        grpHl.appendChild(hlCtl);
        popColor.appendChild(grpHl);

        const grpEr = App.el('div', 'fn-block');
        const erCtl = sizeControl('Spessore gomma', () => ed.eraserSize, v => {
            ed.eraserSize = v;
            if (ed.active && ed.active.tool === 'eraser') ed.active.size = v;
        });
        grpEr.appendChild(erCtl);
        popColor.appendChild(grpEr);

        const grpTxt = App.el('div', 'fn-block');
        const bColor = document.createElement('input');
        bColor.type = 'color';
        bColor.className = 'color-swatch';
        bColor.value = '#141414';
        bColor.title = 'Colore testo';
        bColor.addEventListener('input', () => { if (ed) ed.textColor = bColor.value; });
        grpTxt.appendChild(bColor);
        [['B', 'bold'], ['I', 'italic'], ['S', 'underline']].forEach(pair => {
            const b = btn('tool-btn nt-size', pair[0], () => {
                if (pair[1] === 'bold') ed.textBold = !ed.textBold;
                else if (pair[1] === 'italic') ed.textItalic = !ed.textItalic;
                else ed.textUnderline = !ed.textUnderline;
                b.classList.toggle('active');
            });
            grpTxt.appendChild(b);
        });
        popColor.appendChild(grpTxt);
        root.appendChild(popColor);
        ed.popColor = popColor;
        ed.grpPen = grpPen;
        ed.grpHl = grpHl;
        ed.grpEr = grpEr;
        ed.grpTxt = grpTxt;
        ed.penCtl = penCtl;
        ed.hlCtl = hlCtl;
        ed.erCtl = erCtl;

        // ---------- popover zoom ----------
        const popZoom = App.el('div', 'fn-pop fn-pop-zoom');
        const zm = (label, title, fn) => {
            const b = App.el('button', 'fn-zbtn', label);
            b.type = 'button'; b.title = title;
            b.addEventListener('click', fn);
            return b;
        };
        popZoom.appendChild(zm('\u2212', 'Riduci zoom', () => zoomAtCenter(1 / 1.15)));
        popZoom.appendChild(zm('+', 'Ingrandisci', () => zoomAtCenter(1.15)));
        popZoom.appendChild(zm('Adatta', 'Adatta la pagina allo schermo', () => fitPage()));
        popZoom.appendChild(zm('100%', 'Zoom reale', () => zoomAtCenter(1 / ed.scale)));
        root.appendChild(popZoom);
        ed.popZoom = popZoom;

        // ---------- popover carta ----------
        const popPaper = App.el('div', 'fn-pop fn-pop-paper');
        root.appendChild(popPaper);
        ed.popPaper = popPaper;

        // ---------- popover metadata ----------
        const popMeta = App.el('div', 'fn-pop fn-pop-meta');
        root.appendChild(popMeta);
        ed.popMeta = popMeta;

        // ---------- popover Migliora scrittura (slider live) ----------
        const popHelp = App.el('div', 'fn-pop fn-pop-help');
        popHelp.appendChild(App.el('h4', null, 'Migliora scrittura'));
        const mkSlider = (label, get, set) => {
            const row = App.el('div', 'fn-slider-row');
            const lab = App.el('span', 'fn-slider-lab', label);
            const rng = document.createElement('input');
            rng.type = 'range';
            rng.min = 0; rng.max = 100; rng.step = 1;
            rng.value = Math.round(get() * 100);
            const val = App.el('span', 'fn-slider-val', rng.value + '%');
            rng.addEventListener('input', () => {
                val.textContent = rng.value + '%';
                set(Number(rng.value) / 100);
            });
            row.appendChild(lab);
            row.appendChild(rng);
            row.appendChild(val);
            return row;
        };
        popHelp.appendChild(mkSlider('Intensita aiuto',
            () => ed.helpAssist, v => { ed.helpAssist = v; }));
        popHelp.appendChild(mkSlider('Smussamento righe',
            () => ed.helpSmooth, v => { ed.helpSmooth = v; }));
        // R14 A4: tempo di fermo per snap (hold-still) 200-800ms, default 350
        (function () {
            const row = App.el('div', 'fn-slider-row');
            const lab = App.el('span', 'fn-slider-lab', 'Fermo per snap (ms)');
            const rng = document.createElement('input');
            rng.type = 'range';
            rng.min = 200; rng.max = 800; rng.step = 50;
            rng.value = ed.holdMs || 350;
            const val = App.el('span', 'fn-slider-val', rng.value + ' ms');
            rng.addEventListener('input', () => {
                val.textContent = rng.value + ' ms';
                ed.holdMs = Number(rng.value);
                saveShaping();
            });
            row.appendChild(lab);
            row.appendChild(rng);
            row.appendChild(val);
            popHelp.appendChild(row);
        })();
        popHelp.appendChild(App.el('div', 'fn-hint',
            'Con il toggle acceso la scrittura viene stabilizzata al rilascio '
            + '(e le forme riconosciute, con frecce automatiche); spento, la '
            + 'scrittura resta grezza.'));
        root.appendChild(popHelp);
        ed.popHelp = popHelp;

        // pannello laterale Fonti (A3)
        buildFonti(root);

        syncColorSwatches();
        syncToolGroups();

        // UNICO listener outside-click dei popover (A1): capture + setTimeout 0
        // (stesso pattern di components/folders.js); rimosso in teardownEditor.
        if (ed.popOutsideT) { clearTimeout(ed.popOutsideT); ed.popOutsideT = null; }
        document.removeEventListener('click', onDocOutside, true);
        ed.popOutsideT = setTimeout(() => {
            ed.popOutsideT = null;
            if (ed) document.addEventListener('click', onDocOutside, true);
        }, 0);
    }

    // ---------- popover: apertura/chiusura unica (A1) ----------
    function allPops() {
        if (!ed) return [];
        return [ed.popColor, ed.popZoom, ed.popPaper, ed.popMeta, ed.popHelp].filter(Boolean);
    }

    function anyPopOpen() {
        return allPops().some(p => p.classList.contains('show'));
    }

    // chiude OGNI popover aperto; ritorna true se qualcosa e' stato chiuso
    function closeAllPops() {
        if (!ed) return false;
        let closed = false;
        allPops().forEach(p => {
            if (p.classList.contains('show')) { p.classList.remove('show'); closed = true; }
        });
        return closed;
    }

    // UNICO handler outside-click dell'editor: chiude i popover aperti se il
    // click e' fuori da OGNI popover e fuori dai trigger ([data-poptrig]),
    // cosi' il toggle del bottone non si incastra. Stesso pattern di
    // components/folders.js (document capture + setTimeout 0). Registrato
    // UNA volta in buildChrome, rimosso in teardownEditor (niente fantasmi).
    function onDocOutside(e) {
        if (!ed || !anyPopOpen()) return;
        const t = e.target;
        const inPop = allPops().some(p => p.contains(t));
        const inTrig = !!(t && t.closest && t.closest('[data-poptrig]'));
        if (inPop || inTrig) return;
        closeAllPops();
    }

    function togglePop(pop, beforeFn) {
        if (!pop || !ed) return;
        const opening = !pop.classList.contains('show');
        closeAllPops();
        if (opening) {
            if (beforeFn) beforeFn();
            pop.classList.add('show');
        }
    }

    function zoomAtCenter(factor) {
        if (!ed) return;
        const cw = ed.canvas.width / ed.dpr, ch = ed.canvas.height / ed.dpr;
        zoomAt(cw / 2, ch / 2, factor);
    }

    function applyPreset(ps) {
        if (!ed) return;
        setTool(ps.tool);
        if (ps.penType) ed.penType = ps.penType;
        // ogni tratto della penna memorizza il proprio colore
        if (ps.tool === 'penna' && ps.id === 'matita') ed.penColor = ed.matitaColor;
        else if (ps.tool === 'penna' && ps.id === 'markR') ed.penColor = ed.markerColor;
        else if (ps.color && ps.tool === 'penna') ed.penColor = ps.color;
        if (ps.color && ps.tool === 'evidenziatore') ed.hlColor = ps.color;
        if (ps.size && ps.tool === 'penna') ed.penSize = ps.size;
        if (ps.size && ps.tool === 'evidenziatore') ed.hlSize = ps.size;
        syncColorSwatches();
        drawAll();
    }

    // colore scelto dalla tavolozza: aggiorna il colore del TRATTO attivo
    // (penna tonda / matita / pennarello / evidenziatore) e il suo pallino
    function applyPaletteColor(hex) {
        if (!ed || !hex) return;
        if (ed.tool === 'evidenziatore') {
            ed.hlColor = hex;
        } else if (ed.tool === 'testo') {
            ed.textColor = hex;
        } else if (ed.tool === 'penna') {
            if (ed.penType === 'pencil') { ed.matitaColor = hex; ed.penColor = hex; }
            else if (ed.penType === 'marker') { ed.markerColor = hex; ed.penColor = hex; }
            else { ed.penTondaColor = hex; ed.penColor = hex; }
        }
        syncColorSwatches();
    }

    // ============================================================
    // PANNELLO "FONTI" (A3) — laterale SINISTRA FISSO, NON popover.
    // Motivazione: richiede spazio persistente mentre disegni e non deve
    // entrare nel sistema popover (allPops/outside-click): lo apre/chiude
    // SOLO il bottone "Fonti" in pillL (bottone esplicito apri/chiudi),
    // come il .sc-side degli Schemi. Ricerca + lista + anteprima ripresi
    // dal pannello Fonti di schemi.js (buildSide/loadSources/loadPreview).
    // ============================================================
    const FONTI_KINDS = ['note', 'riassunto', 'documento'];
    const FONTI_KIND_LABELS = { note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento', mat: 'Materiale' };
    // C2: cap dell'anteprima testo materiali (char). Il testo integrale arriva
    // gia' dalla stessa chiamata read_material_text (cap backend 5MB).
    const FONTI_MAT_CAP = 2500;

    // Etichetta per i materiali: materials_list mescola L1 (file_AIstudio) e
    // L2 (preselected_books) -> distinzione dal percorso, SENZA toccare il
    // backend. preselected_books = "Libro" (secondo livello RAG), altrove "Materiale".
    function matKindLabel(path) {
        return /preselected_books/i.test(String(path || '')) ? 'Libro' : 'Materiale';
    }

    function fonteKindLabel(s) {
        if (!s) return '';
        if (s.kind === 'mat') return matKindLabel(s.path);
        return FONTI_KIND_LABELS[s.kind] || s.kind;
    }

    // C2: lettura testo materiale via study_api.read_material_text.
    // Chiamata DIRETTA su window.pywebview.api (pattern index.html
    // pick_*/add_*): store.js e' off-limits e api() e' una closure interna.
    // Senza pywebview (harness qa) -> null -> fallback "nessun contenuto".
    async function readMaterialText(path) {
        try {
            if (window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.read_material_text === 'function') {
                return await window.pywebview.api.read_material_text(path);
            }
        } catch (e) { /* errore backend -> fallback */ }
        return null;
    }

    function fmtBytes(n) {
        n = Number(n);
        if (!isFinite(n) || n < 0) return '';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function buildFonti(root) {
        const side = App.el('div', 'fn-side');
        const head = App.el('div', 'fn-side-head');
        head.appendChild(App.el('span', 'fn-side-title', 'Fonti'));
        const closeB = fnBtn('&#10005;', 'Chiudi pannello Fonti', 'fn-tb');
        closeB.addEventListener('click', () => toggleFonti(false));
        head.appendChild(closeB);
        side.appendChild(head);

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'fn-side-search';
        search.placeholder = 'Cerca fonti\u2026';
        search.setAttribute('aria-label', 'Cerca fonti');
        side.appendChild(search);

        const list = App.el('div', 'fn-flist');
        side.appendChild(list);

        const prev = App.el('div', 'fn-fprev',
            'Seleziona una fonte per leggerne l\u2019anteprima.');
        side.appendChild(prev);

        const ins = App.el('button', 'fn-finsert', 'Inserisci nella nota');
        ins.type = 'button';
        ins.disabled = true;
        side.appendChild(ins);

        root.appendChild(side);
        ed.sideFonti = side;
        ed.fontiSearch = search;
        ed.fontiList = list;
        ed.fontiPrev = prev;
        ed.fontiInsert = ins;
        ed.fontiSrcs = [];
        ed.fontiSel = null;
        ed.fontiSelKey = null;
        search.addEventListener('input', () => renderFontiList());
        ins.addEventListener('click', () => insertFontiRef(ed.fontiSel));
    }

    function toggleFonti(force) {
        if (!ed || !ed.sideFonti) return;
        const want = (force === undefined)
            ? !ed.sideFonti.classList.contains('show') : !!force;
        ed.sideFonti.classList.toggle('show', want);
        if (ed.fontiBtn) ed.fontiBtn.classList.toggle('mode', want);
        if (want) loadFontiSources();
    }

    // fonti study (note/riassunto/documento, come il pannello Fonti degli
    // Schemi) + materiali/libri del chatbot: stessa sorgente di biblioteca.js
    // (StudyStore.listMaterials). Limite: senza backend pywebview
    // listMaterials ritorna [] (fallback localStorage) -> i "mat" non
    // compaiono, gli study items sì.
    async function loadFontiSources() {
        if (!ed) return;
        let items = [], mats = [];
        try { items = await StudyStore.listItems('') || []; } catch (e) { items = []; }
        try {
            mats = (typeof StudyStore.listMaterials === 'function')
                ? (await StudyStore.listMaterials() || []) : [];
        } catch (e) { mats = []; }
        if (!ed) return;
        const srcs = [];
        items.filter(i => FONTI_KINDS.indexOf(i.kind) >= 0).forEach(it => {
            srcs.push({
                key: 'it:' + it.id, kind: it.kind, id: it.id,
                title: it.title || 'Senza titolo', materia: it.materia || '',
                path: '', raw: it
            });
        });
        mats.forEach(m => {
            srcs.push({
                key: 'mat:' + (m.path || m.name || ''), kind: 'mat',
                id: m.path || m.name || '', title: m.name || 'Materiale',
                materia: '', path: m.path || '', raw: m
            });
        });
        ed.fontiSrcs = srcs;
        renderFontiList();
    }

    function renderFontiList() {
        if (!ed || !ed.fontiList) return;
        const q = ((ed.fontiSearch && ed.fontiSearch.value) || '').trim().toLowerCase();
        ed.fontiList.innerHTML = '';
        const srcs = (ed.fontiSrcs || []).filter(s => !q ||
            (s.title || '').toLowerCase().indexOf(q) >= 0 ||
            (fonteKindLabel(s) || '').toLowerCase().indexOf(q) >= 0 ||
            (s.materia || '').toLowerCase().indexOf(q) >= 0);
        if (!srcs.length) {
            ed.fontiList.appendChild(App.el('div', 'fn-hint',
                q ? 'Nessuna fonte corrisponde alla ricerca.' : 'Nessuna fonte disponibile.'));
            return;
        }
        srcs.forEach(s => {
            const b = App.el('button', 'fn-fitem' + (ed.fontiSelKey === s.key ? ' active' : ''));
            b.type = 'button';
            b.appendChild(App.el('span', 'fn-fkind',
                fonteKindLabel(s) + (s.materia ? ' \u00b7 ' + s.materia : '')));
            b.appendChild(App.el('span', null, s.title));
            b.addEventListener('click', () => selectFonti(s));
            ed.fontiList.appendChild(b);
        });
    }

    function selectFonti(s) {
        if (!ed) return;
        ed.fontiSel = s;
        ed.fontiSelKey = s.key;
        renderFontiList();
        if (ed.fontiInsert) ed.fontiInsert.disabled = false;
        if (!ed.fontiPrev) return;
        ed.fontiPrev.textContent = 'Caricamento\u2026';
        if (s.kind === 'mat' || s.path) {
            // materiali/libri (C2): testo via read_material_text + metadati
            previewFonteFile(s);
            return;
        }
        const key = s.key;
        StudyStore.getItem(s.id).then(full => {
            if (!ed || ed.fontiSelKey !== key) return;
            ed.fontiPrev.textContent =
                (full ? extractFonteText(full) : '') ||
                'Nessun testo disponibile per questo elemento.';
        }).catch(() => {
            if (ed && ed.fontiSelKey === key) ed.fontiPrev.textContent = 'Anteprima non disponibile.';
        });
    }

    // C2: anteprima sorgente con percorso (materiali/libri RAG).
    // - legge il testo con read_material_text(path) (chiamata diretta
    //   pywebview, guard con fallback "nessun contenuto" se assente);
    // - mostra metadati (percorso, data indicizzazione, nome, dimensione, tipo)
    //   + testo con cap FONTI_MAT_CAP; se il testo e' piu' lungo aggiunge il
    //   pulsante "Carica testo completo".
    async function previewFonteFile(s) {
        if (!ed || !ed.fontiPrev) return;
        const key = s.key;
        ed.fontiPrev.textContent = 'Caricamento\u2026';
        const r = s.path ? await readMaterialText(s.path) : null;
        if (!ed || ed.fontiSelKey !== key) return; // selezione cambiata nel frattempo
        const rows = [];
        if (s.path) rows.push('Percorso: ' + s.path);
        if (s.raw && s.raw.indexed_at) rows.push('Indicizzato il ' + s.raw.indexed_at);
        const nm = (r && r.name) || (s.raw && s.raw.name) || '';
        if (nm) rows.push('Nome: ' + nm);
        const sz = r && r.size != null ? fmtBytes(r.size) : '';
        if (sz) rows.push('Dimensione: ' + sz);
        if (r && r.kind) rows.push('Tipo file: ' + r.kind);
        const meta = rows.join('\n');
        if (r && r.success && typeof r.text === 'string') {
            const full = r.text;
            if (!full) {
                ed.fontiPrev.textContent = meta + '\n\nNessun testo leggibile (file vuoto o binario).';
                return;
            }
            ed.fontiMatFull = { key: key, meta: meta, text: full };
            if (full.length <= FONTI_MAT_CAP) {
                ed.fontiPrev.textContent = meta + '\n\n' + full;
                return;
            }
            ed.fontiPrev.textContent = meta + '\n\n' + full.slice(0, FONTI_MAT_CAP) + ' \u2026';
            const b = App.el('button', 'fn-fload', 'Carica testo completo');
            b.type = 'button';
            b.style.display = 'block';
            b.style.marginTop = '8px';
            b.addEventListener('click', () => showFullFonteText(key));
            ed.fontiPrev.appendChild(b);
        } else {
            // nessun pywebview / errore / path non consentito -> vecchio
            // fallback informativo (mantiene "Percorso: ..." invariato)
            const err = (r && r.error) ? ' (' + r.error + ')' : '';
            ed.fontiPrev.textContent = meta +
                '\nMateriale indicizzato dal chatbot: nessun testo raggiungibile' + err + '.';
        }
    }

    // "Carica testo completo": il testo integrale e' gia' arrivato dalla
    // stessa chiamata API -> rimuovo il cap mostrandolo TUTTO nella stessa
    // anteprima (.fn-fprev ha overflow-y:auto -> scroll nativo). Scelta
    // reversibile: nessun overlay/modal nuovo da montare o smontare.
    function showFullFonteText(key) {
        if (!ed || !ed.fontiPrev || !ed.fontiMatFull || ed.fontiMatFull.key !== key) return;
        ed.fontiPrev.textContent = ed.fontiMatFull.meta + '\n\n' + ed.fontiMatFull.text;
    }

    // estrazione testo per anteprima (stesso approccio di extractText di schemi.js)
    function extractFonteText(item) {
        if (!item) return '';
        const c = item.content != null ? item.content : '';
        try {
            const o = JSON.parse(c);
            if (o && typeof o === 'object') {
                if (Array.isArray(o.objects)) {
                    return o.objects.filter(x => x && x.t === 'text' && x.text)
                        .map(x => String(x.text).replace(/\s+/g, ' ').trim())
                        .filter(Boolean).join('\n');
                }
                if (Array.isArray(o.nodes)) {
                    return o.nodes.map(n => (n && n.text) || '').filter(Boolean).join('\n');
                }
                if (typeof o.text === 'string' && o.text.trim()) return o.text;
                if (typeof o.riassunto === 'string' && o.riassunto.trim()) return o.riassunto;
            }
        } catch (e) { /* contenuto testo semplice */ }
        const t = String(c || '').replace(/\s+/g, ' ').trim();
        return t.length > 2500 ? t.slice(0, 2500) + ' \u2026' : t;
    }

    // Inserisce la fonte nella nota in modo reversibile:
    // - con percorso locale -> oggetto canonico t:'file' (addFileObj-like,
    //   apribile con doppio click via openFileObj/StudyStore.openFilePath);
    // - altrimenti -> oggetto t:'text' con riferimento titolo+kind+id.
    // Entrambi sono oggetti standard del doc: undo li toglie e il
    // salvataggio (serializableDoc) resta invariato -> nessuna corruzione.
    function insertFontiRef(src) {
        if (!ed || !src) return;
        const cw = ed.canvas.width / ed.dpr, chh = ed.canvas.height / ed.dpr;
        const cx = (cw / 2 - ed.tx) / ed.scale;
        const cy = (chh / 2 - ed.ty) / ed.scale;
        pushUndo();
        if (src.path) {
            ed.doc.objects.push({
                t: 'file', x: cx - 90, y: cy - 28, w: 180, h: 56,
                name: src.title, path: src.path
            });
        } else {
            const label = 'Fonte: ' + src.title + ' (' +
                (FONTI_KIND_LABELS[src.kind] || src.kind) +
                (src.kind === 'mat' ? '' : ' \u00b7 ' + src.id) + ')';
            const o = {
                t: 'text', x: cx - 170, y: cy - 14, w: 10, h: 10,
                text: label, size: 15, color: '#1f5fd6',
                bold: false, italic: false, underline: false
            };
            measureTextObj(o);
            ed.doc.objects.push(o);
        }
        drawAll();
        scheduleSave();
    }

    // popover carta: tipi + margine rosso (opzionale sulle righe)
    function openPaper() {
        const pop = ed.popPaper;
        pop.innerHTML = '';
        pop.appendChild(App.el('h4', null, 'Tipo di carta'));
        const row = App.el('div', 'choice-row');
        Object.keys(SHEET_LABELS).forEach(k => {
            const c = App.el('button', 'choice' + (ed.doc.sheet === k ? ' active' : ''), SHEET_LABELS[k]);
            c.type = 'button';
            c.addEventListener('click', () => {
                ed.doc.sheet = k;
                drawAll();
                scheduleSave();
                openPaper();
            });
            row.appendChild(c);
        });
        pop.appendChild(row);
        if (ed.doc.sheet === 'righe') {
            const line = App.el('label', 'check-line');
            const cb = App.el('input');
            cb.type = 'checkbox';
            cb.checked = !!ed.doc.margin;
            cb.addEventListener('change', () => {
                ed.doc.margin = cb.checked;
                drawAll();
                scheduleSave();
            });
            line.appendChild(cb);
            line.appendChild(App.el('span', null, 'Linea di margine rossa'));
            pop.appendChild(line);
        }
        const hint = App.el('div', 'fn-hint', 'La carta copre tutto lo schermo: niente bordi scuri.');
        pop.appendChild(hint);
    }

    // popover metadata: rinomina, materia, tag, tipo carta, modalita
    function openMeta() {
        const pop = ed.popMeta;
        pop.innerHTML = '';
        pop.appendChild(App.el('h4', null, 'Dettagli nota'));

        const fT = App.el('div', 'field');
        fT.appendChild(App.el('label', null, 'Titolo'));
        const inT = App.el('input');
        inT.type = 'text';
        inT.value = ed.title || '';
        inT.addEventListener('change', () => {
            ed.title = inT.value.trim() || 'Senza titolo';
            inT.value = ed.title;
            if (ed.titleEl) ed.titleEl.textContent = ed.title;
            scheduleSave();
        });
        fT.appendChild(inT);
        pop.appendChild(fT);

        const fM = App.el('div', 'field');
        const subj = SubjectInput.create({
            label: 'Materia',
            value: ed.materia || '',
            placeholder: 'Inserisci materia\u2026',
            onChange: v => { ed.materia = v; scheduleSave(); SubjectInput.remember(v).catch(() => {}); }
        });
        fM.appendChild(subj);
        pop.appendChild(fM);

        const fG = App.el('div', 'field');
        fG.appendChild(App.el('label', null, 'Tag'));
        const inG = App.el('input');
        inG.type = 'text';
        inG.placeholder = 'tag, separati, da virgole';
        inG.value = ed.tags || '';
        inG.addEventListener('change', () => { ed.tags = inG.value; scheduleSave(); });
        fG.appendChild(inG);
        pop.appendChild(fG);

        const fC = App.el('div', 'field');
        fC.appendChild(App.el('label', null, 'Tipo carta'));
        const selC = App.el('select');
        Object.keys(SHEET_LABELS).forEach(k => {
            const o = App.el('option', null, SHEET_LABELS[k]);
            o.value = k;
            selC.appendChild(o);
        });
        selC.value = ed.doc.sheet || 'quadretti';
        selC.addEventListener('change', () => {
            ed.doc.sheet = selC.value;
            drawAll();
            scheduleSave();
        });
        fC.appendChild(selC);
        pop.appendChild(fC);

        const fMode = App.el('div', 'field');
        fMode.appendChild(App.el('label', null, 'Modalita'));
        const selMode = App.el('select');
        const oQ = App.el('option', null, 'Quaderno (pagine)'); oQ.value = 'quaderno';
        const oI = App.el('option', null, 'Foglio infinito'); oI.value = 'infinito';
        selMode.appendChild(oQ);
        selMode.appendChild(oI);
        selMode.value = ed.doc.mode === 'infinito' ? 'infinito' : 'quaderno';
        selMode.addEventListener('change', () => convertMode(selMode.value));
        fMode.appendChild(selMode);
        pop.appendChild(fMode);

        const saveLine = App.el('div', 'fn-savestate');
        saveLine.id = 'fnSaveState';
        saveLine.textContent = '\u25cf Salvataggio automatico';
        pop.appendChild(saveLine);
        ed.saveState = saveLine;

        const acts = App.el('div', 'form-actions');
        const bImprove = App.el('button', 'btn-secondary', 'Migliora scrittura');
        bImprove.type = 'button';
        bImprove.addEventListener('click', () => { improveHandwriting(); togglePop(ed.popMeta); });
        const bClose = App.el('button', 'btn-accent', 'Fatto');
        bClose.type = 'button';
        bClose.addEventListener('click', () => closeAllPops());
        acts.appendChild(bImprove);
        acts.appendChild(bClose);
        pop.appendChild(acts);
    }

    // quaderno <-> foglio infinito, senza perdere i tratti
    function convertMode(to) {
        if (!ed || ed.doc.mode === to) return;
        const d = ed.doc;
        if (to === 'infinito') {
            d.objects = d.objects || [];
            d.mode = 'infinito';
            d.w = 12000; d.h = 8000;
            delete d.pages;
            delete d.page;
        } else {
            d.objects = d.objects || [];
            d.mode = 'quaderno';
            d.w = 1600; d.h = 1100;
            d.pages = [{ objects: d.objects }];
            d.page = 0;
        }
        ed.undo = []; ed.redo = [];
        ed.selected = null;
        ed.lasel = [];
        centerView();
        syncSelUi();
        scheduleSave();
    }

    function syncToolGroups() {
        if (!ed) return;
        ed.grpPen.style.display = (ed.tool === 'penna') ? 'inline-flex' : 'none';
        ed.grpHl.style.display = (ed.tool === 'evidenziatore') ? 'inline-flex' : 'none';
        ed.grpEr.style.display = (ed.tool === 'gomma') ? 'inline-flex' : 'none';
        ed.grpTxt.style.display = (ed.tool === 'testo') ? 'inline-flex' : 'none';
        syncSelUi();
    }

    // ---------- apertura editor ----------
    async function openEditor(itemOrId) {
        let item = itemOrId;
        if (typeof item === 'string') item = await StudyStore.getItem(item);
        if (!item) { renderList(); return; }
        if (item.content == null || item.content === undefined) {
            const full = await StudyStore.getItem(item.id);
            if (full) item = full;
        }
        // materia sempre normalizzata (maiuscolo) al caricamento
        item.materia = SubjectInput.normalize(item.materia);
        let doc = parseDoc(item.content) || defaultDoc('quadretti', 'quaderno');
        doc = normalizeDoc(doc);

        teardownEditor();
        container.style.overflow = 'hidden';
        container.style.padding = '0';
        container.innerHTML = '';

        const root = App.el('div', 'nt-editor');

        // NESSUN header/topbar fissa: la chrome e' tutta flottante
        // (barra superiore + pillole) costruita da buildChrome(root).

        // stage full-bleed: la carta copre tutto lo schermo
        const stage = App.el('div', 'nt-stage');
        const canvas = document.createElement('canvas');
        const overlay = App.el('div', 'nt-overlay');
        stage.appendChild(canvas);
        stage.appendChild(overlay);
        root.appendChild(stage);
        container.appendChild(root);

        // stato editor
        ed = {
            itemId: item.id,
            title: item.title || 'Senza titolo',
            materia: item.materia || '',
            folderId: item.folder_id || '',
            tags: item.tags || '',
            desc: item.description || '',
            doc: doc,
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            stage: stage,
            overlay: overlay,
            dpr: 1,
            scale: 1, tx: 0, ty: 0,
            tool: 'penna',
            penType: 'pen', penColor: '#141414', penSize: 4,
            hlColor: '#ffe14d', hlSize: 20,
            eraserSize: 14,
            textColor: '#141414', textSize: 20,
            textBold: false, textItalic: false, textUnderline: false,
            active: null, eraserOn: false,
            selected: null, drag: null,
            lasso: null, lasel: [], selDrag: null,
            undo: [], redo: [],
            dirty: false, again: false, saving: false, saveTimer: null,
            images: {},
            pointers: new Map(),
            penIds: new Set(),
            pinch: null, strokeFromPen: false,
            textTa: null, textMeta: null,
            disposed: false
        };

        // chrome flottante: barra, pillole, pill zoom, pill pagine, popover
        // (costruisce anche ed.bar, ed.pgBar, ed.pgLabel, i gruppi colore...)
        buildChrome(root, stage);

        // eventi
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('lostpointercapture', () => { /* gestito da up/cancel */ });
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('dblclick', onDblClick);
        // anteprima cerchio gomma (dimensione in pagina * zoom)
        canvas.addEventListener('pointermove', e => updateEraserCursor(e));
        canvas.addEventListener('pointerenter', e => updateEraserCursor(e));
        canvas.addEventListener('pointerleave', () => {
            if (ed && ed.eraseCur) ed.eraseCur.style.display = 'none';
        });
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onResize);

        syncColorSwatches();
        setTool('penna');
        syncToolGroups();

        requestAnimationFrame(() => {
            if (!ed) return;
            resizeCanvas();
            centerView();
        });
    }

    async function backToList() {
        await flush();
        renderList();
    }

    function teardownEditor() {
        const st = ed;
        if (!st) return;
        st.disposed = true;
        st.pendingClose = true;
        if (st.saveTimer) { clearTimeout(st.saveTimer); st.saveTimer = null; }
        if (st.popOutsideT) { clearTimeout(st.popOutsideT); st.popOutsideT = null; }
        document.removeEventListener('click', onDocOutside, true);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
        ed = null;
        if (container) {
            container.style.overflow = '';
            container.style.padding = '';
        }
    }

    // ---------- registrazione modulo ----------
    App.registerModule({
        id: 'notes',
        title: 'Appunti',
        desc: 'Prendi appunti a mano con penna e evidenziatore, o con la tastiera.',
        icon: App.ICONS.notes,
        kinds: ['note'],
        open(c, params) {
            container = c;
            const pid = params && params.open;
            if (pid) {
                StudyStore.getItem(pid).then(item => {
                    if (item && item.kind === 'note') openEditor(item);
                    else renderList();
                }).catch(() => renderList());
                return;
            }
            renderList();
        },
        close() {
            const st = ed;
            if (st) {
                if (st.saveTimer) { clearTimeout(st.saveTimer); st.saveTimer = null; }
                if (st.dirty || st.again) doSave(st);
            }
            teardownEditor();
        },
        async recent() {
            try {
                const items = await StudyStore.listItems('note') || [];
                if (!items.length) return 'Nessuna nota';
                return 'Ultima: ' + (items[0].title || 'nota');
            } catch (e) { return ''; }
        }
    });
})();
