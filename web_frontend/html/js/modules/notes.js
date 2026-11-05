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
        '.fn-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:8px 10px;z-index:12;pointer-events:none;background:linear-gradient(to bottom,rgba(18,21,32,.92),rgba(18,21,32,.55) 65%,rgba(18,21,32,0));}' +
        '.fn-top>*{pointer-events:auto;}' +
        '.fn-ic{width:34px;height:34px;border-radius:50%;background:rgba(28,32,48,.92);border:1px solid rgba(255,255,255,.1);color:#e8ecf4;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex-shrink:0;}' +
        '.fn-ic:hover{border-color:#f9974a;color:#f9974a;}' +
        '.fn-ic svg{width:17px;height:17px;}' +
        '.fn-title{flex:1;min-width:0;text-align:center;background:rgba(28,32,48,.8);border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:7px 16px;font-size:13.5px;font-weight:700;color:#eef1f7;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit;}' +
        '.fn-title:hover{border-color:#f9974a;}' +
        '.fn-pill{position:absolute;display:flex;align-items:center;gap:3px;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:6px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:12;}' +
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
        '.fn-zoom{position:absolute;top:106px;left:12px;display:flex;align-items:center;gap:2px;background:rgba(58,64,82,.94);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 5px;z-index:12;color:#e8ecf4;box-shadow:0 6px 16px rgba(0,0,0,.3);}' +
        '.fn-zoom .fn-zpct{background:none;border:none;color:inherit;font-family:inherit;font-size:12px;font-weight:800;padding:4px 8px;cursor:pointer;border-radius:999px;}' +
        '.fn-zoom .fn-zpct:hover{background:rgba(255,255,255,.14);}' +
        '.fn-zoom .fn-lock{width:26px;height:26px;border-radius:50%;background:none;border:none;color:inherit;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}' +
        '.fn-zoom .fn-lock svg{width:14px;height:14px;}' +
        '.fn-zoom .fn-lock.active{background:#f9974a;color:#141824;}' +
        '.fn-pages{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:5px 7px;box-shadow:0 8px 22px rgba(0,0,0,.38);z-index:12;}' +
        '.fn-pages .fn-tb{width:30px;height:30px;}' +
        '.fn-pages .fn-plabel{font-size:12px;font-weight:700;color:#dfe5f0;min-width:92px;text-align:center;}' +
        '.fn-pages .fn-padd{background:#f9974a;color:#141824;border:none;border-radius:999px;font-size:12px;font-weight:800;padding:6px 13px;cursor:pointer;font-family:inherit;}' +
        '.fn-pages .fn-padd:hover{background:#ffad66;}' +
        /* R28: PARETI COLLABILI - (1) barra superiore col titolo e
           (2) pillole strumenti: ogni collasso ridona TUTTO lo spazio alla
           parte subito sotto (canvas). Stato persistito (nt28_*). */
        '.fn-topbar-fold .fn-top{display:none!important}' +
        '.fn-topbar-fold .fn-pill-left,.fn-topbar-fold .fn-pill-right{top:6px}' +
        '.fn-topbar-fold .fn-zoom{top:56px}' +
        '.fn-topbar-fold .fn-pop-color,.fn-topbar-fold .fn-pop-help,' +
        '.fn-topbar-fold .fn-pop-zoom{top:56px}' +
        '.fn-topbar-fold .fn-pop-meta{top:4px}' +
        '.fn-topbar-fold .fn-foldfab{top:6px}' +
        '.fn-tools-fold .fn-pill-left,.fn-tools-fold .fn-pill-right{display:none!important}' +
        '.fn-foldfab{position:absolute;top:56px;left:12px;width:34px;height:34px;' +
        'border-radius:50%;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.12);' +
        'color:#dfe5f0;display:none;align-items:center;justify-content:center;cursor:pointer;' +
        'padding:0;z-index:13;box-shadow:0 8px 22px rgba(0,0,0,.38)}' +
        '.fn-tools-fold .fn-foldfab{display:inline-flex}' +
        '.fn-foldfab.mode{border-color:#f9974a;color:#f9974a}' +
        '.fn-ic.mode{border-color:#f9974a;color:#f9974a;background:rgba(249,151,74,.16)}' +
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
        /* R24 FE-INK: toggle "Perfeziona al rilascio" nel popover Aiuto */
        '.fn-relref{width:100%;background:#202637;border:1px solid #2a3142;border-radius:8px;padding:7px 10px;color:#cfd6e4;font-size:12.5px;font-weight:800;letter-spacing:.4px;cursor:pointer;font-family:inherit;}' +
        '.fn-relref.on{border-color:#f9974a;color:#f9974a;}' +
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
        /* ===== PANNELLO "FONTI" (R21 B1): componente UNICO FontiPanel =====
           Il componente (fonti_panel.js) e' autocontenuto: qui cambia solo
           il LAYOUT nel contesto Appunti (laterale SINISTRA fisso, come il
           vecchio .fn-side; aperto/chiudo via classe .show su .fp21-root). */
        '.fp21-root{position:absolute;left:12px;top:152px;bottom:auto;display:none;' +
        'flex-direction:column;gap:8px;background:#1a2030;border:1px solid #2a3142;border-radius:16px;' +
        'padding:12px;z-index:11;box-shadow:0 16px 44px rgba(0,0,0,.5);color:#f5f7fa;font-family:' + FAM + ';}' +
        '.fp21-root.show{display:flex;}' +
        '.fp21-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
        '.fp21-lens{width:28px;height:28px;flex-shrink:0;border-radius:50%;background:#202637;' +
        'border:1px solid #2a3142;color:#cfd6e4;display:inline-flex;align-items:center;' +
        'justify-content:center;cursor:pointer;padding:0;}' +
        '.fp21-lens:hover{border-color:#f9974a;color:#f9974a;}' +
        '.fp21-chips{display:flex;gap:4px;flex-wrap:wrap;}' +
        '.fp21-chip{background:#202637;border:1px solid #2a3142;color:#cfd6e4;border-radius:999px;' +
        'padding:4px 10px;font-size:11.5px;cursor:pointer;font-family:inherit;}' +
        '.fp21-chip:hover{border-color:#f9974a;}' +
        '.fp21-chip.active{background:rgba(249,151,74,.16);border-color:#f9974a;color:#ffd9b3;font-weight:700;}' +
        '.fp21-search{box-sizing:border-box;width:100%;background:#202637;border:1px solid #2a3142;' +
        'border-radius:9px;color:#f5f7fa;padding:7px 9px;font-size:13px;outline:none;font-family:inherit;}' +
        '.fp21-search:focus{border-color:#f9974a;}' +
        '.fp21-list{display:flex;flex-direction:column;gap:4px;max-height:38%;overflow-y:auto;}' +
        '.fp21-item{display:flex;flex-direction:column;gap:2px;text-align:left;background:#202637;' +
        'border:1px solid #2a3142;color:#e8ecf4;border-radius:9px;padding:7px 9px;font-size:12.5px;' +
        'cursor:pointer;font-family:inherit;}' +
        '.fp21-item:hover{border-color:#f9974a;}' +
        '.fp21-item.active{border-color:#f9974a;background:rgba(249,151,74,.14);}' +
        '.fp21-badge{font-size:10px;text-transform:uppercase;letter-spacing:.5px;background:rgba(249,151,74,.18);' +
        'color:#f9974a;border:1px solid rgba(249,151,74,.45);border-radius:999px;padding:2px 7px;' +
        'align-self:flex-start;flex-shrink:0;}' +
        '.fp21-ititle{font-size:12.5px;font-weight:700;color:#f5f7fa;}' +
        '.fp21-hint{font-size:11.5px;color:#8b95a5;line-height:1.45;}' +
        '.fp21-preview{flex:1;min-height:60px;display:flex;flex-direction:column;gap:6px;' +
        'overflow-y:auto;background:#151a28;border:1px solid #2a3142;border-radius:10px;padding:9px;' +
        'font-size:12.5px;line-height:1.5;color:#cfd6e4;white-space:normal;overflow-wrap:anywhere;}' +
        '.fp21-ptitle{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13.5px;' +
        'font-weight:800;color:#f5f7fa;}' +
        '.fp21-pbody{font-size:12.5px;}' +
        '.fp21-pbody p{margin:0 0 8px;}' +
        '.fp21-pbody h1,.fp21-pbody h2,.fp21-pbody h3,.fp21-pbody h4{margin:10px 0 6px;color:#f5f7fa;}' +
        '.fp21-pbody h1{font-size:16px;}' +
        '.fp21-pbody h2{font-size:15px;}' +
        '.fp21-pbody h3{font-size:13.5px;}' +
        '.fp21-pbody ul,.fp21-pbody ol{margin:4px 0 8px 18px;padding:0;}' +
        '.fp21-pbody li{margin:2px 0;}' +
        '.fp21-pbody blockquote{margin:6px 0;padding:2px 10px;border-left:3px solid #f9974a;color:#9fa9bb;}' +
        '.fp21-pbody code{background:#202637;border-radius:4px;padding:1px 4px;font-size:12px;}' +
        '.fp21-pbody pre,.fp21-pre{background:#12161f;border:1px solid #2a3142;border-radius:8px;' +
        'padding:8px;overflow-x:auto;white-space:pre-wrap;margin:6px 0;}' +
        '.fp21-pbody pre code{background:none;padding:0;}' +
        '.fp21-table{border-collapse:collapse;margin:6px 0;}' +
        '.fp21-table td,.fp21-table th{border:1px solid #2a3142;padding:3px 7px;}' +
        '.fp21-pbody img.fp21-thumb,.fp21-imgwrap img{display:block;max-width:100%;max-height:120px;' +
        'border-radius:8px;margin:6px 0;}' +
        '.fp21-math{font-size:1.05em;}' +
        '.fp21-mathfb{display:inline-flex;gap:5px;align-items:baseline;flex-wrap:wrap;}' +
        '.fp21-mathfb code{font-size:12px;background:#202637;border-radius:4px;padding:1px 4px;}' +
        '.fp21-insert{background:#f9974a;border:none;color:#141824;border-radius:9px;padding:8px 0;' +
        'font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;}' +
        '.fp21-insert:hover{background:#ffad66;}' +
        '.fp21-insert:disabled{opacity:.4;cursor:default;}' +
        '.fp21-rz{position:absolute;background:transparent;}' +
        '.fp21-rz-r{top:0;right:-3px;width:7px;height:100%;cursor:ew-resize;}' +
        '.fp21-rz-b{left:0;bottom:-3px;height:7px;width:100%;cursor:ns-resize;}' +
        '.fp21-rz-c{right:-3px;bottom:-3px;width:14px;height:14px;cursor:nwse-resize;}'
    );

    // ---------- stato modulo ----------
    let container = null;
    let ed = null;

    // R14 L-P0 - strumentazione LATENZA (sola misura, nessun cambio di
    // comportamento): trace raw/evt/paint + controllo intensita' per T2.
    window.__ink = {
        trace: [],
        version: 'p0',
        // R24/R25 FE-INK: contatori rilascio per il T2 reale.
        // TRANSIZIONE V1 (dichiarata): .classified e ora l'OGGETTO
        // per-classe {line,arc,freeform,closed,arrow} (chiavi ESATTE); lo
        // scalare cumulato ex-R24 vive in .total / .n_classified. Restano
        // invariati (backward-compat): .refined, .discarded, .byKind.
        // Campi NUOVI V0:
        //   strokes_live        tratti attivi/grezzi (+1 pointerdown,
        //                        -1 commit/cancel)
        //   perfected_on_release ogni swap di perfezionamento AL RILASCIO
        //   swapped_pixels      somma per swap di max(punti grezzi,
        //                        punti ideali renderizzati)
        //   residual_px         residuo dell'ULTIMO swap = max distanza
        //                        punti renderizzati vs modello ideale
        //                        (0 dichiarato per freeform)
        // .stroke si azzera a ogni pointerdown penna e riporta i valori
        // letti DOPO il rilascio (stessa struttura della sessione).
        counters: {
            classified: { line: 0, arc: 0, freeform: 0, closed: 0, arrow: 0 },
            total: 0, n_classified: 0,
            refined: 0, discarded: 0, byKind: {},
            strokes_live: 0, perfected_on_release: 0,
            swapped_pixels: 0, residual_px: 0,
            stroke: {
                classified: { line: 0, arc: 0, freeform: 0, closed: 0, arrow: 0 },
                total: 0, n_classified: 0,
                refined: 0, discarded: 0, byKind: {}
            }
        },
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
                          releaseRefine: ed.releaseRefine !== false,
                          zoom: ed.scale,
                          ghost: !!ed.ghost, ghostFlash: !!ed.ghostFlash,
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
        // R24 FE-INK: setter test/T2 del toggle "perfeziona al rilascio"
        setReleaseRefine: function (v) {
            if (!ed) return null;
            ed.releaseRefine = (v === undefined) ? true : !!v;
            saveShaping();
            return window.__ink.state();
        },
        // R25 V1.4: zoom testabile. Tutte le soglie di classificazione
        // vivono su punti MONDO (divise per lo zoom per costruzione):
        // il setter serve ai test 100% / 245%.
        zoom: function () { return ed ? ed.scale : null; },
        setZoom: function (k, cx, cy) {
            if (!ed || !(k > 0)) return null;
            if (cx === undefined || cy === undefined) {
                const r = ed.canvas.getBoundingClientRect();
                cx = r.left + r.width / 2;
                cy = r.top + r.height / 2;
            }
            zoomAt(cx, cy, k / ed.scale);   // clamp interno 0.15..5
            return ed.scale;
        },
        objects: function () {
            return ed && ed.doc ? JSON.parse(JSON.stringify(ed.doc.objects)) : [];
        },
        // coordinate cliente -> mondo (per i test geometrici in jsdom)
        toWorld: function (x, y) {
            return toWorld({ clientX: x, clientY: y });
        },
        // R20 F5/Q7: tap multi-dito testabile direttamente (stessa
        // multiFingerTap del percorso pointer reale): 2=undo, 3=redo,
        // UNA sola volta per chiamata
        gestureTapTest: function (n) {
            if (!ed) return false;
            return multiFingerTap(n);
        },
        // R20 F4/Q7: scala l'oggetto selezionato dal suo centro (stesso
        // scaleObj della maniglia di resize del lazo)
        scaleSelTest: function (k) {
            if (!ed || !ed.selected || !k) return false;
            const b = objBBox(ed.selected);
            pushUndo();
            scaleObj(ed.selected, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, k);
            scheduleSave();
            drawAll();
            return true;
        }
    };
    function saveShaping() {
        if (!ed) return;
        try {
            localStorage.setItem('nt14_shaping', JSON.stringify(
                { shpOn: ed.shpOn, arrowOn: ed.arrowOn, holdMs: ed.holdMs }));
            // R24 FE-INK: toggle "perfeziona al rilascio" in una chiave
            // SEPARATA accanto a nt14_shaping (nt14_shaping invariato)
            localStorage.setItem('nt24_releaseRefine', JSON.stringify(
                { on: ed.releaseRefine !== false }));
        } catch (e) { /* storage non disponibile: stato in memoria */ }
    }
    // ---- R24 FE-INK: strumentazione rilascio (contatori + console) --------
    // A ogni rilascio di un tratto di disegno: console.info '[ink24] ...' +
    // window.__ink.counters (cumulati sessione) / .counters.stroke (questo
    // tratto, azzerato a ogni pointerdown penna). Il T2 legge i contatori
    // DOPO il disegno reale: perfezionati = 0 dopo una retta = FAIL.
    // R25 V1: classi di classificazione (chiavi ESATTE di
    // counters.classified) + mappatura dai kind storici R20/R22/R24
    const V1_CLASSES = ['line', 'arc', 'freeform', 'closed', 'arrow'];
    function _clsOf(kind, vclass) {
        if (vclass && V1_CLASSES.indexOf(vclass) >= 0) return vclass;
        if (kind === 'line') return 'line';
        if (kind === 'arrow') return 'arrow';
        if (kind === 'circle' || kind === 'ellipse' || kind === 'rectangle' ||
            kind === 'square' || kind === 'triangle') return 'closed';
        return 'arc';   // kind 'curve' (params.arc / bez, <=1 flesso)
    }
    // compat: se classified fosse ancora lo scalare ex-R24 lo migra in .total
    function _clsBag(store) {
        if (!store.classified || typeof store.classified === 'number') {
            const old = (typeof store.classified === 'number') ? store.classified : 0;
            store.total = (store.total || 0) + old;
            store.classified = { line: 0, arc: 0, freeform: 0, closed: 0, arrow: 0 };
        }
        if (store.total === undefined) store.total = 0;
        return store.classified;
    }
    function ink24Bump(store, evt, kind, cls) {
        if (!store) return;
        if (evt === 'classified') {
            const bag = _clsBag(store);
            const k = cls || _clsOf(kind);
            bag[k] = (bag[k] || 0) + 1;
            store.total = (store.total || 0) + 1;
            store.n_classified = store.total;   // alias scalare (transizione)
        } else {
            store[evt] = (store[evt] || 0) + 1;
        }
        if (evt === 'classified' && kind) {
            store.byKind[kind] = (store.byKind[kind] || 0) + 1;
        }
    }
    function ink24Add(evt, kind, cls) {
        const c = window.__ink && window.__ink.counters;
        if (!c) return;
        ink24Bump(c, evt, kind, cls);
        ink24Bump(c.stroke, evt, kind, cls);
    }
    function ink24ResetStroke() {
        const c = window.__ink && window.__ink.counters;
        if (!c) return;
        c.stroke = {
            classified: { line: 0, arc: 0, freeform: 0, closed: 0, arrow: 0 },
            total: 0, n_classified: 0,
            refined: 0, discarded: 0, byKind: {}
        };
    }
    // R25 V1: tratti attivi/grezzi - +1 a pointerdown penna/evidenziatore,
    // -1 al commit (rilascio) o all'annullamento (pinch)
    function ink24Live(d) {
        const c = window.__ink && window.__ink.counters;
        if (!c) return;
        c.strokes_live = Math.max(0, (c.strokes_live || 0) + d);
    }
    function ink24Log() {
        const c = window.__ink && window.__ink.counters;
        if (!c || !c.stroke) return;
        const s = c.stroke;
        try {
            // [ink24] resta IDENTICO al R24 (backward-compat test/QA)
            console.info('[ink24] classificati=' + (s.total || 0) +
                ' perfezionati=' + s.refined + ' scartati=' + s.discarded +
                ' byKind=' + JSON.stringify(s.byKind) +
                ' | sessione: classificati=' + (c.total || 0) +
                ' perfezionati=' + c.refined + ' scartati=' + c.discarded);
            // [inkV] riga NUOVA V1: classi, perfezionamenti al rilascio,
            // pixel sostituiti, residuo dell'ultimo swap, live
            const cls = _clsBag(c);
            console.info('[inkV] class=' +
                V1_CLASSES.map(k => k + ':' + (cls[k] || 0)).join(' ') +
                ' perf=' + (c.perfected_on_release || 0) +
                ' swapPx=' + (c.swapped_pixels || 0) +
                ' residuo=' + (c.residual_px || 0) +
                ' live=' + (c.strokes_live || 0));
        } catch (e) { /* console non disponibile */ }
    }
    // R25 V1: residuo dello swap = massima distanza dei punti RENDERIZZATI
    // dal modello ideale (line: segmento; arc: cerchio/bez; closed:
    // modello parametrico; arrow: asta; freeform: 0 dichiarato).
    function _swapResidual(o, cls) {
        if (!o) return 0;
        if (cls === 'freeform') return 0;   // smoothing topologia-preservante
        const pts = o.pts || [];
        if (pts.length < 2) return 0;       // circle/ellipse: render parametrico
        const pr = o.params || {};
        const sf = (o.kind === 'arrow' && pr.shaft) ? pr.shaft : pr;
        const lp = (o.kind === 'line' || sf.kind === 'line') ? (sf.pts || pts) : null;
        if (lp && lp.length === 2) {
            let m = 0;
            for (const q of pts) {
                const d = _distToPoly(q, [lp[0], lp[1]]).d;
                if (d > m) m = d;
            }
            return m;
        }
        if (sf.arc && sf.arc.cx !== undefined) {
            let m = 0;
            for (const q of pts) {
                const d = Math.abs(Math.hypot(q[0] - sf.arc.cx,
                                              q[1] - sf.arc.cy) - sf.arc.r);
                if (d > m) m = d;
            }
            return m;
        }
        if (sf.bez && sf.bez.length) {
            const dense = _bezDense(sf.bez, 16);
            let m = 0;
            for (const q of pts) {
                const d = _distToPoly(q, dense).d;
                if (d > m) m = d;
            }
            return m;
        }
        return 0;   // polilinea ideale (rect/tri/quad): punti sul modello
    }
    // R25 V1: UNO swap singolo al rilascio -> tutta la strumentazione
    // (classified per classe, refined, perfected_on_release, swapped_pixels,
    // residual_px) calcolata in UN punto coerente. nRaw = punti grezzi
    // sostituiti dal tratto appena commesso.
    function ink24Commit(obj, vclass, nRaw) {
        const cls = _clsOf(obj ? obj.kind : null, vclass);
        ink24Add('classified', obj ? obj.kind : null, cls);
        ink24Add('refined', obj ? obj.kind : null);
        ink24Add('perfected_on_release', null);
        const c = window.__ink && window.__ink.counters;
        if (c) {
            const nId = (obj && obj.pts && obj.pts.length) ? obj.pts.length : 0;
            c.swapped_pixels = (c.swapped_pixels || 0) +
                Math.max(nRaw || 0, nId);
            c.residual_px = _swapResidual(obj, cls);   // ultimo valore
        }
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
                // R20: burst di eventi sub-ms (stilo ad alta frequenza o
                // dispatch compresso): passo minimo 4ms. Senza il floor la
                // stima velocita resta ferma, cut resta basso e il filtro
                // resta molto indietro -> traccia strozzata (raggio cerchio
                // ~38 invece di 45). Con dt reale >= 4ms nulla cambia.
                else if (dt < 0.004) dt = 0.004;
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
    // R24 FE-INK: la forma riconosciuta e' CHIUSA? Gate del ghost
    // hold-still. rect/square/triangle/circle/ellipse si; line mai;
    // curve = stessa regola gap R20 di recognizeStroke (gapTol =
    // max(12, 8% della diagonale del bbox del tratto)).
    function _recIsClosed(rec, pts) {
        if (!rec || !pts || pts.length < 2) return false;
        if (rec.kind === 'line') return false;
        if (rec.kind !== 'curve') return true;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of pts) {
            if (q[0] < x0) x0 = q[0];
            if (q[0] > x1) x1 = q[0];
            if (q[1] < y0) y0 = q[1];
            if (q[1] > y1) y1 = q[1];
        }
        const gapTol = Math.max(12, Math.hypot(x1 - x0, y1 - y0) * 0.08);
        const a = pts[0], b = pts[pts.length - 1];
        return Math.hypot(a[0] - b[0], a[1] - b[1]) <= gapTol;
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
                // R24 FE-INK: con "perfeziona al rilascio" ON il ghost vale
                // SOLO per le forme CHIUSE (R20 invariato); i tratti APERTI
                // aspettano il rilascio (settle 150ms). OFF -> hold-still
                // STORICO anche per gli aperti.
                if (recH && (ed.releaseRefine === false ||
                             _recIsClosed(recH, oAct.pts))) {
                    if (window.__ink) {
                        window.__ink.trace.push({ k: 'stop',
                            t: performance.now(), hold: true });
                    }
                    // R20 G/U8: GHOST PREVIEW - la penna e' ancora GIU':
                    // la candidata NON viene commessa, resta in ed.ghost
                    // (overlay tratteggiato in drawAll). Il COMMIT avviene
                    // al RILASCIO (endPointer + flash ~150ms); se la penna
                    // riprende a muoversi il ghost viene annullato
                    // (onPointerMove). Nessun return: il frame continua e
                    // ed.active resta vivo (nessun cambio al percorso
                    // live: riconoscimento solo al momento dell'hold).
                    ed.ghost = { rec: recH,
                                 pts: oAct.pts.map(q => [q[0], q[1]]),
                                 t: performance.now() };
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
        const pts = o.pts;
        // R19 A2.5: riferimento GREZZO (verita' di tracciato) prima di ogni
        // filtraggio: serve per il clamp di tolleranza dello smussamento.
        // R20 lotto 1: ed.inkRawRef e' la base del residuo GREZZO->ideale
        // del gate 'curve' (<=2.5px dichiarati).
        const raw0 = pts.map(pt => [pt[0], pt[1]]);
        ed.inkRawRef = raw0;
        if (!ed.helpOn) return;   // toggle spento -> scrittura grezza
        const a = ed.helpAssist || 0;
        const s = ed.helpSmooth || 0;
        ed.inkSnapAmp = a;        // ampiezza snap per A1 (shaping)
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
        // (a) R19 A2.5: SMUSSAMENTO TOTALIZZANTE a fine tratto
        // - resample UNIFORME (5px) del tracciato grezzo
        // - fit spline: 3 passate Catmull-Rom -> Bézier equispaziata
        //   (media (1,2,1)/4 sui nodi = passata offline forte)
        // - ri-campionamento alla posizione arc-length di OGNI punto grezzo
        //   (n e ts INVARIATI: finestra flick e size map restano allineate)
        // - clamp: ogni punto resta entro 2.4px dal tracciato grezzo =>
        //   tolleranza DICHIARATA A2.5: scostamento max <= 2.5px vs il
        //   tracciato ideale campionato (assertato in a14 15.1 + QA browser)
        if (s > 0 && pts.length >= 5) {
            const rs = _resampleUniform(raw0, 5);
            if (rs.length >= 6) {
                for (let it = 0; it < 3; it++) {
                    const cp = rs.map(p => [p[0], p[1]]);
                    for (let i = 1; i < rs.length - 1; i++) {
                        rs[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
                        rs[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
                    }
                }
                const L = _cumLen(raw0);
                const LR = _cumLen(rs);
                const total = L[L.length - 1] || 0;
                const totalR = LR[LR.length - 1] || 0;
                const clampD = 2.4;   // margine sotto la tolleranza 2.5px
                for (let i = 0; i < pts.length; i++) {
                    const f = total > 0 ? L[i] / total : 0;
                    const q = _evalPolyAt(rs, LR, f * totalR);
                    const d = _distToPoly(q, raw0);
                    if (d.d > clampD && d.d > 0) {
                        const t = (clampD / d.d) * 0.98;
                        q[0] = d.cx + (q[0] - d.cx) * t;
                        q[1] = d.cy + (q[1] - d.cy) * t;
                    }
                    pts[i][0] = q[0];
                    pts[i][1] = q[1];
                }
            }
            const l2 = pts[pts.length - 1];
            if (ed.inkLastRaw) { l2[0] = ed.inkLastRaw.x; l2[1] = ed.inkLastRaw.y; }
        }
    }
    // ---- R19 A2.1/A2.5: utilita' geometriche (chiusura, campionamento) ----
    // intersezione stretta tra segmenti (punti condivisi non contano)
    function _segCross(a, b, c, d) {
        const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
        const o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
        return (o1 * o2 < -1e-9) && (o3 * o4 < -1e-9);
    }
    // auto-intersezioni del polilinea: scarta coppie adiacenti (|i-j|<=2)
    // e la coppia di chiusura (0, ultimo); bound 8 (oltre: "molte")
    function _selfIntersections(pts) {
        const n0 = pts.length;
        if (n0 < 4) return 0;
        const stride = n0 > 500 ? Math.ceil(n0 / 400) : 1;
        const P = [];
        for (let i = 0; i < n0; i += stride) P.push(pts[i]);
        if (P[P.length - 1] !== pts[n0 - 1]) P.push(pts[n0 - 1]);
        const n = P.length;
        let cnt = 0;
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 3; j < n - 1; j++) {
                if (i === 0 && j === n - 2) continue;
                if (_segCross(P[i], P[i + 1], P[j], P[j + 1])) {
                    cnt++;
                    if (cnt >= 8) return cnt;
                }
            }
        }
        return cnt;
    }
    // lunghezze cumulate
    function _cumLen(pts) {
        const L = [0];
        for (let i = 1; i < pts.length; i++) {
            L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        }
        return L;
    }
    // resample UNIFORME a passo fisso (estremi inclusi)
    function _resampleUniform(pts, step) {
        if (!pts || pts.length < 2) return (pts || []).map(p => [p[0], p[1]]);
        const cum = _cumLen(pts);
        const total = cum[cum.length - 1];
        if (!(total > 0)) return [[pts[0][0], pts[0][1]]];
        const out = [];
        let j = 0;
        for (let d = 0; d < total; d += step) {
            while (j < cum.length - 2 && cum[j + 1] < d) j++;
            const seg = (cum[j + 1] - cum[j]) || 1;
            const t = Math.min(1, Math.max(0, (d - cum[j]) / seg));
            out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
                      pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
        }
        out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
        return out;
    }
    // punto del polilinea a distanza arc-length t (cum = _cumLen del poly)
    function _evalPolyAt(poly, cum, t) {
        if (t <= 0) return [poly[0][0], poly[0][1]];
        const total = cum[cum.length - 1];
        if (t >= total) return [poly[poly.length - 1][0], poly[poly.length - 1][1]];
        let i = 0;
        while (i < cum.length - 2 && cum[i + 1] < t) i++;
        const seg = (cum[i + 1] - cum[i]) || 1;
        const f = (t - cum[i]) / seg;
        return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * f,
                poly[i][1] + (poly[i + 1][1] - poly[i][1]) * f];
    }
    // distanza punto->polilinea: {d, cx, cy} (punto piu' vicino sul tracciato)
    function _distToPoly(p, poly) {
        let bd = Infinity, bx = p[0], by = p[1];
        for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i], b = poly[i + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const qx = a[0] + t * dx, qy = a[1] + t * dy;
            const d = Math.hypot(p[0] - qx, p[1] - qy);
            if (d < bd) { bd = d; bx = qx; by = qy; }
        }
        return { d: bd, cx: bx, cy: by };
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
    // R19 A2.2: rettangolo/quadrato = tratto CHIUSO + 4 cluster di curvatura
    // (angoli 90gradi +/-20) + lati rettilinei (deviazione <= tol).
    function _tryRect(pts, rotDeg, tol) {
        const bb = _bbox(pts);
        if (bb.w < 15 || bb.h < 15) return null;
        const aspect0 = bb.w / bb.h;
        if (aspect0 < 0.25 || aspect0 > 4) return null;
        // A2.1: chiusura obbligatoria (stessa regola di recognizeStroke)
        const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0],
                               pts[0][1] - pts[pts.length - 1][1]);
        if (gap > Math.max(12, Math.hypot(bb.w, bb.h) * 0.08)) return null;
        if (_selfIntersections(pts) > 1) return null;
        // dedupe: niente vertici (quasi) duplicati agli angoli
        const P = [];
        for (const q of pts) {
            const last = P[P.length - 1];
            if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.7) {
                P.push([q[0], q[1]]);
            }
        }
        const m = P.length;
        if (m < 12) return null;
        // perimetro + passo medio dei campioni (servono PRIMA delle svolte)
        let per = 0;
        for (let i = 0; i < m; i++) {
            const nx = P[(i + 1) % m];
            per += Math.hypot(nx[0] - P[i][0], nx[1] - P[i][1]);
        }
        // separazione minima dei cluster (~12%, min 8px)
        const minSep = Math.max(8, per * 0.12);
        const cell = per / m;
        // svolta su gambe ~6px (k campioni, ciclica): lo smussamento di
        // fine tratto arrotonda l'angolo e la svolta PUNTUALE cade da 90
        // a ~15-25gradi (cluster di vertice persi -> rect diventava
        // curve/stroke). Su gambe lunghe l'angolo interno resta ~70-90
        // mentre il rumore sui lati resta < 30.
        const kL = Math.max(1, Math.min(4, Math.round(6 / (cell || 1))));
        const turns = new Array(m);
        for (let i = 0; i < m; i++) {
            const a = P[(i - kL + m) % m], b = P[i], c = P[(i + kL) % m];
            const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 1e-9 || n2 < 1e-9) { turns[i] = 0; continue; }
            const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            turns[i] = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
        }
        // 4 angoli = 4 massimi di svolta con soppressione circolare
        const idxs = [];
        for (let c = 0; c < 4; c++) {
            let bi = -1, bs = 0;
            for (let i = 0; i < m; i++) {
                let ok = true;
                for (const j of idxs) {
                    let d = Math.abs(i - j);
                    if (d > m / 2) d = m - d;
                    if (d * cell < minSep) { ok = false; break; }
                }
                if (ok && turns[i] > bs) { bs = turns[i]; bi = i; }
            }
            if (bi < 0) return null;
            idxs.push(bi);
        }
        idxs.sort((a, b) => a - b);
        // nessun angolo piatto: tutti >= 30gradi di svolta
        for (const i of idxs) if (turns[i] < 30) return null;
        // lati: fit LSQ (asse principale) da corner k a corner k+1 (ciclico)
        const sides = [];
        for (let k = 0; k < 4; k++) {
            const a = idxs[k], b = idxs[(k + 1) % 4];
            const seq = [];
            let i = a;
            for (;;) {
                seq.push(P[i]);
                if (i === b) break;
                i = (i + 1) % m;
                if (seq.length > m) break;
            }
            if (seq.length < 3) return null;
            let mx = 0, my = 0;
            for (const q of seq) { mx += q[0]; my += q[1]; }
            mx /= seq.length; my /= seq.length;
            let sxx = 0, sxy = 0, syy = 0;
            for (const q of seq) {
                const dx = q[0] - mx, dy = q[1] - my;
                sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
            }
            const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
            let ux = Math.cos(th), uy = Math.sin(th);
            const ddx = P[b][0] - P[a][0], ddy = P[b][1] - P[a][1];
            if (ux * ddx + uy * ddy < 0) { ux = -ux; uy = -uy; }
            // R20 lotto 1 (parita' col fit cerchio): RMS punti->lato <=
            // tolleranza (2.5+amp*3). Il maxDev puro era troppo severo per
            // il freehand sfalsato (cadeva in stroke/ellisse); gli angoli
            // 90+/-20 e la chiusura restano i vincoli di forma.
            let accDev = 0;
            for (const q of seq) {
                const dev = -uy * (q[0] - mx) + ux * (q[1] - my);
                accDev += dev * dev;
            }
            const rmsSide = Math.sqrt(accDev / seq.length);
            if (rmsSide > tol) return null;   // lato non rettilineo
            sides.push({ mx: mx, my: my, ux: ux, uy: uy });
        }
        // angoli 90 +/- 20: svolta tra lati consecutivi (diretta)
        for (let k = 0; k < 4; k++) {
            const p = sides[(k + 3) % 4], q = sides[k];
            const dot = p.ux * q.ux + p.uy * q.uy;
            const crs = p.ux * q.uy - p.uy * q.ux;
            const ang = Math.abs(Math.atan2(crs, dot) * 180 / Math.PI);
            if (ang < 70 || ang > 110) return null;
        }
        // corner = intersezione tra le rette dei lati adiacenti
        const corners = [];
        for (let k = 0; k < 4; k++) {
            const p = sides[(k + 3) % 4], q = sides[k];
            const den = p.ux * (-q.uy) - p.uy * (-q.ux);
            if (Math.abs(den) < 1e-9) return null;
            const dx = q.mx - p.mx, dy = q.my - p.my;
            const t = (dx * (-q.uy) - dy * (-q.ux)) / den;
            corners.push([p.mx + t * p.ux, p.my + t * p.uy]);
        }
        const cb = _bbox(corners);
        const aspect = cb.w / cb.h;
        const kind = (aspect >= 0.8 && aspect <= 1.25) ? 'square' : 'rectangle';
        if (rotDeg) {
            // R20: rotazione INVERSA sull'origine del frame PCA (i corner
            // sono gia' centrati: sottrarli di nuovo traslava la shape di
            // -R*centroid -> box fuori posto sul rettangolo storto)
            const th2 = rotDeg * Math.PI / 180;
            const cs = Math.cos(th2), sn = Math.sin(th2);
            const rc = corners.map(q => [q[0] * cs - q[1] * sn,
                                         q[0] * sn + q[1] * cs]);
            const rb = _bbox(rc);
            return { kind: kind, box: rb, rot: rotDeg, pts: rc, params: {} };
        }
        return { kind: kind, box: cb, rot: 0, pts: corners, params: {} };
    }
        // ================= R20 lotto 1: classi di fit con parita' ============
    // Nessun re-snap: se >=60% dei punti del nuovo tratto cade dentro il
    // bbox di uno shape esistente, il tratto resta stroke grezzo.
    function _insideExisting(pts) {
        if (!ed || !ed.doc || !ed.doc.objects) return false;
        let inside = 0;
        for (const q of pts) {
            for (const t of ed.doc.objects) {
                if (t.t !== 'shape') continue;
                const b = objBBox(t);
                if (q[0] >= b.x && q[0] <= b.x + b.w &&
                    q[1] >= b.y && q[1] <= b.y + b.h) { inside++; break; }
            }
        }
        return inside >= pts.length * 0.6;
    }
    // Scarabocchio/coloring: riempimento denso del bbox (percorso cumulato
    // >= 1.6x il perimetro del bbox = passate ripetute dentro la scatola)
    function _denseFill(pts) {
        const bb = _bbox(pts);
        const per = 2 * (bb.w + bb.h);
        if (!(per > 0)) return true;
        const L = _cumLen(pts);
        return (L[L.length - 1] || 0) / per >= 1.6;
    }
    // Gap-closing esplicito: campiona di segmento retto il gap punta-coda
    // PRIMA del fit (Kasa/triangolo/rett). Da chiamare SOLO se gap <=
    // tolleranza-gap: la "C" aperta non viene mai chiusa forzatamente.
    function _closeLoop(pts) {
        const n = pts.length;
        const a = pts[n - 1], b = pts[0];
        const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const out = pts.map(q => [q[0], q[1]]);
        // niente COPIA di pts[0] in coda: renderebbe collineari (turn=0)
        // sia l'ultimo punto sia pts[0] e il cluster d'angolo all'avvio
        // sparirebbe (rettangolo -> solo 3 vertici su 4). Il segmento di
        // chiusura esiste comunque via gestione ciclica + punti interni.
        if (gap < 1.4) return out;
        const k = Math.max(1, Math.min(8, Math.round(gap / 6)));
        for (let i = 1; i <= k; i++) {
            const f = i / (k + 1);
            out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        }
        return out;
    }
    // R20 (5): TRIANGOLO - tratto CHIUSO + 3 cluster vertici con angoli
    // interni 60+/-25 (NON 4 lati) -> fit LSQ a 3 segmenti. Stessa struttura
    // di _tryRect: dedupe, svolte cicliche, soppressione circolare dei
    // cluster, RMS punti->lato <= tolleranza del fit cerchio.
    function _tryTri(pts, rotDeg, tol) {
        const bb = _bbox(pts);
        if (bb.w < 20 || bb.h < 20) return null;
        if (_selfIntersections(pts) > 1) return null;
        const P = [];
        for (const q of pts) {
            const last = P[P.length - 1];
            if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.7) {
                P.push([q[0], q[1]]);
            }
        }
        const m = P.length;
        if (m < 10) return null;
        // perimetro + passo medio dei campioni (servono PRIMA delle svolte)
        let per = 0;
        for (let i = 0; i < m; i++) {
            const nx = P[(i + 1) % m];
            per += Math.hypot(nx[0] - P[i][0], nx[1] - P[i][1]);
        }
        const minSep = Math.max(10, per * 0.15);
        const cell = per / m;
        // svolta su gambe ~6px (k campioni, ciclica): stessa motivazione
        // di _tryRect - la svolta puntuale a 1 campione viene arrotondata
        // dallo smussamento di fine tratto (120 -> ~20gradi) e i 3 vertici
        // non superavano piu' la soglia 45. Su gambe lunghe l'angolo
        // interno ~60 resta ben sopra 45, i lati retti restano < 30.
        const kL = Math.max(1, Math.min(4, Math.round(6 / (cell || 1))));
        const turns = new Array(m);
        for (let i = 0; i < m; i++) {
            const a = P[(i - kL + m) % m], b = P[i], c = P[(i + kL) % m];
            const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 1e-9 || n2 < 1e-9) { turns[i] = 0; continue; }
            const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            turns[i] = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
        }
        const idxs = [];
        for (let c = 0; c < 3; c++) {
            let bi = -1, bs = 0;
            for (let i = 0; i < m; i++) {
                let ok = true;
                for (const j of idxs) {
                    let d = Math.abs(i - j);
                    if (d > m / 2) d = m - d;
                    if (d * cell < minSep) { ok = false; break; }
                }
                if (ok && turns[i] > bs) { bs = turns[i]; bi = i; }
            }
            if (bi < 0) return null;
            idxs.push(bi);
        }
        idxs.sort((a, b) => a - b);
        // svolta al vertice: interno 60gradi => svolta ~120; almeno 45
        // (esclude archi/ellissi lisce; i rett cadono sul vincolo angoli)
        for (const i of idxs) if (turns[i] < 45) return null;
        // lati: fit LSQ (asse principale) da corner k a corner k+1 (ciclico)
        const sides = [];
        for (let k = 0; k < 3; k++) {
            const a = idxs[k], b = idxs[(k + 1) % 3];
            const seq = [];
            let i = a;
            for (;;) {
                seq.push(P[i]);
                if (i === b) break;
                i = (i + 1) % m;
                if (seq.length > m) break;
            }
            if (seq.length < 3) return null;
            let mx = 0, my = 0;
            for (const q of seq) { mx += q[0]; my += q[1]; }
            mx /= seq.length; my /= seq.length;
            let sxx = 0, sxy = 0, syy = 0;
            for (const q of seq) {
                const dx = q[0] - mx, dy = q[1] - my;
                sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
            }
            const thl = 0.5 * Math.atan2(2 * sxy, sxx - syy);
            let ux = Math.cos(thl), uy = Math.sin(thl);
            const ddx = P[b][0] - P[a][0], ddy = P[b][1] - P[a][1];
            if (ux * ddx + uy * ddy < 0) { ux = -ux; uy = -uy; }
            let acc = 0;
            for (const q of seq) {
                const dev = -uy * (q[0] - mx) + ux * (q[1] - my);
                acc += dev * dev;
            }
            if (Math.sqrt(acc / seq.length) > tol) return null;
            sides.push({ mx: mx, my: my, ux: ux, uy: uy });
        }
        // angoli INTERNI 60 +/- 25 => 35..85: l'angolo fra le direzioni
        // dei lati vale 180 - interno (svolta di percorso)
        for (let k = 0; k < 3; k++) {
            const pa = sides[(k + 2) % 3], qa = sides[k];
            const dot = pa.ux * qa.ux + pa.uy * qa.uy;
            const crs = pa.ux * qa.uy - pa.uy * qa.ux;
            const defl = Math.abs(Math.atan2(crs, dot) * 180 / Math.PI);
            const interior = 180 - defl;
            if (interior < 35 || interior > 85) return null;
        }
        // corner = intersezione fra le rette dei lati adiacenti
        const corners = [];
        for (let k = 0; k < 3; k++) {
            const pa = sides[(k + 2) % 3], qa = sides[k];
            const den = pa.ux * (-qa.uy) - pa.uy * (-qa.ux);
            if (Math.abs(den) < 1e-9) return null;
            const dx = qa.mx - pa.mx, dy = qa.my - pa.my;
            const tt = (dx * (-qa.uy) - dy * (-qa.ux)) / den;
            corners.push([pa.mx + tt * pa.ux, pa.my + tt * pa.uy]);
        }
        const cb = _bbox(corners);
        if (rotDeg) {
            const th2 = rotDeg * Math.PI / 180;
            const cs = Math.cos(th2), sn = Math.sin(th2);
            const rc = corners.map(q => [q[0] * cs - q[1] * sn,
                                         q[0] * sn + q[1] * cs]);
            return { kind: 'triangle', box: _bbox(rc), rot: rotDeg,
                     pts: rc, params: {} };
        }
        return { kind: 'triangle', box: cb, rot: 0, pts: corners, params: {} };
    }

    // ===== R22 BLOCCO 3: rette/archi ricostruiti DA ZERO ==============
    // Solo tratti APERTI: le forme chiuse (gap-closing/corner/ghost)
    // restano con le regole R20 INVARiate. Il tratto grezzo serve SOLO a
    // stimare i parametri; il rendering riparte ex novo dai parametri
    // (punti della curva parametrica, mai il grezzo smussato).
    //
    // --- 3.1 retta robusta: Theil-Sen (mediana angoli coppie) + PCA,
    // scelta sul minore residuo perpendicolare; endpoint = PROIEZIONE
    // sugli estremi reali dei punti -> segmento ideale perfetto.
    function _lineFitRobust(pts, cen0, th0) {
        const n = (pts || []).length;
        if (n < 2) return null;
        let cen = cen0, th = th0;
        if (!cen || th === undefined) {
            cen = _centroid2(pts);
            let sxx = 0, sxy = 0, syy = 0;
            for (const q of pts) {
                const dx = q[0] - cen[0], dy = q[1] - cen[1];
                sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
            }
            sxx /= n; sxy /= n; syy /= n;
            th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        }
        // Theil-Sen: mediana degli angoli (campionati a max ~48 punti)
        // rispetto alla direzione PCA con wrap +-90gradi (una retta e'
        // una direzione non orientata) -> robusto a jitter/outlier
        const idx = [];
        if (n <= 48) { for (let i = 0; i < n; i++) idx.push(i); }
        else {
            const st = (n - 1) / 47;
            for (let k = 0; k < 48; k++) idx.push(Math.round(k * st));
            if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
        }
        const deltas = [];
        for (let i = 0; i < idx.length; i++) {
            for (let j = i + 1; j < idx.length; j++) {
                const p = pts[idx[i]], q = pts[idx[j]];
                const dx = q[0] - p[0], dy = q[1] - p[1];
                if (dx * dx + dy * dy < 1e-12) continue;
                let d = Math.atan2(dy, dx) - th;
                while (d > Math.PI / 2) d -= Math.PI;
                while (d < -Math.PI / 2) d += Math.PI;
                deltas.push(d);
            }
        }
        const cands = [th];
        if (deltas.length >= 10) {
            deltas.sort((a, b) => a - b);
            cands.push(th + deltas[Math.floor(deltas.length / 2)]);
        }
        let best = null;
        for (const t of cands) {
            const ux = Math.cos(t), uy = Math.sin(t);
            let maxPerp = 0, tmin = Infinity, tmax = -Infinity;
            for (const q of pts) {
                const dx = q[0] - cen[0], dy = q[1] - cen[1];
                const perp = Math.abs(-uy * dx + ux * dy);
                if (perp > maxPerp) maxPerp = perp;
                const tt = ux * dx + uy * dy;
                if (tt < tmin) tmin = tt;
                if (tt > tmax) tmax = tt;
            }
            if (!best || maxPerp < best.maxPerp) {
                best = { a: [cen[0] + ux * tmin, cen[1] + uy * tmin],
                         b: [cen[0] + ux * tmax, cen[1] + uy * tmax],
                         th: t, maxPerp: maxPerp, tlen: tmax - tmin };
            }
        }
        return best;
    }
    // solutore lineare piccolo (gauss con pivoting)
    function _solveLin(A, b) {
        const n = b.length;
        const M = A.map((r, i) => r.concat([b[i]]));
        for (let i = 0; i < n; i++) {
            let p = i;
            for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
            const tmp = M[i]; M[i] = M[p]; M[p] = tmp;
            if (Math.abs(M[i][i]) < 1e-12) return null;
            for (let r = 0; r < n; r++) {
                if (r === i) continue;
                const f = M[r][i] / M[i][i];
                for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
            }
        }
        const x = [];
        for (let i = n - 1; i >= 0; i--) {
            let s = M[i][n];
            for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
            x[i] = s / M[i][i];
        }
        return x;
    }
    // campionatura densa di una lista di segmenti cubici
    function _bezDense(bez, sub) {
        const out = [];
        for (let i = 0; i < bez.length; i++) {
            const sg = bez[i];
            for (let j = (i === 0 ? 0 : 1); j <= sub; j++) out.push(_bezPt(sg, j / sub));
        }
        return out;
    }
    // residui (d, vettore corrente) dei punti run[i0..i1] vs segmento
    function _segResiduals(run, i0, i1, sg) {
        const samp = [];
        for (let j = 0; j <= 32; j++) samp.push(_bezPt(sg, j / 32));
        const out = [];
        for (let i = i0; i <= i1; i++) {
            const q = run[i];
            let m = Infinity, mx = q[0], my = q[1];
            for (let j = 0; j < samp.length - 1; j++) {
                const a = samp[j], b = samp[j + 1];
                const dx = b[0] - a[0], dy = b[1] - a[1];
                const l2 = dx * dx + dy * dy;
                let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
                t = t < 0 ? 0 : (t > 1 ? 1 : t);
                const px = a[0] + t * dx, py = a[1] + t * dy;
                const d = Math.hypot(q[0] - px, q[1] - py);
                if (d < m) { m = d; mx = px; my = py; }
            }
            out.push({ d: m, vx: q[0] - mx, vy: q[1] - my });
        }
        return out;
    }
    // fit LSQ LIBERO del segmento cubico (P0/P3 fissati = nodi, P1/P2
    // incognite) con pesi IRLS (spinge sui residui peggiori)
    function _fitSegFree(run, i0, i1, w) {
        const P0 = run[i0], P3 = run[i1];
        const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
        const b = [0, 0, 0, 0];
        const nseg = i1 - i0;
        for (let i = i0; i <= i1; i++) {
            const wi = w ? w[i - i0] : 1;
            const t = nseg > 0 ? (i - i0) / nseg : 0;
            const u = 1 - t;
            const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
            const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
            const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
            const rows = [[w1, 0, w2, 0], [0, w1, 0, w2]];
            const rhs = [bx, by];
            for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
                for (let d2 = 0; d2 < 4; d2++) A[c][d2] += wi * rows[r][c] * rows[r][d2];
                b[c] += wi * rows[r][c] * rhs[r];
            }
        }
        const x = _solveLin(A, b);
        if (!x) return null;
        return [[P0[0], P0[1]], [x[0], x[1]], [x[2], x[3]], [P3[0], P3[1]]];
    }
    // fit con tangenti unitarie fisse ai due estremi (vincolo G1):
    // incognite lunghezze braccia s0,s1 -> sistema 2x2 lineare
    function _fitSegT(run, i0, i1, T0, T1, w) {
        const P0 = run[i0], P3 = run[i1];
        let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
        const nseg = i1 - i0;
        for (let i = i0; i <= i1; i++) {
            const wi = w ? w[i - i0] : 1;
            const t = nseg > 0 ? (i - i0) / nseg : 0;
            const u = 1 - t;
            const w0 = u * u * u + 3 * u * u * t;
            const w3 = 3 * u * t * t + t * t * t;
            const bv1 = 3 * u * u * t, bv2 = 3 * u * t * t;
            const bx = run[i][0] - (w0 * P0[0] + w3 * P3[0]);
            const by = run[i][1] - (w0 * P0[1] + w3 * P3[1]);
            const vx1 = bv1 * T0[0], vy1 = bv1 * T0[1];
            const vx2 = -bv2 * T1[0], vy2 = -bv2 * T1[1];
            a11 += wi * (vx1 * vx1 + vy1 * vy1);
            a12 += wi * (vx1 * vx2 + vy1 * vy2);
            a22 += wi * (vx2 * vx2 + vy2 * vy2);
            b1 += wi * (vx1 * bx + vy1 * by);
            b2 += wi * (vx2 * bx + vy2 * by);
        }
        const det = a11 * a22 - a12 * a12;
        let s0 = 0, s1 = 0;
        if (Math.abs(det) > 1e-9) {
            s0 = (b1 * a22 - b2 * a12) / det;
            s1 = (a11 * b2 - a12 * b1) / det;
        } else if (a11 > 1e-12) s0 = b1 / a11;
        const Lseg = Math.hypot(P3[0] - P0[0], P3[1] - P0[1]) || 1;
        s0 = Math.max(0.05 * Lseg, Math.min(1.8 * Lseg, s0));
        s1 = Math.max(0.05 * Lseg, Math.min(1.8 * Lseg, s1));
        return [[P0[0], P0[1]], [P0[0] + s0 * T0[0], P0[1] + s0 * T0[1]],
                [P3[0] - s1 * T1[0], P3[1] - s1 * T1[1]], [P3[0], P3[1]]];
    }
    // proiezione G1 sui join (tangenti derivate dal fit libero, media
    // angolare) + tune di curvatura (allinea kappa ai join, 2 iterazioni
    // con REVERT se peggiora la fedelta' eps)
    function _projectG1(bez, idx, run, wsegs) {
        const T = [];
        for (let k = 0; k <= bez.length; k++) {
            if (k === 0) {
                const a = run[idx[0]], b = bez[0][1];
                const v = [b[0] - a[0], b[1] - a[1]];
                const n = Math.hypot(v[0], v[1]) || 1;
                T.push([v[0] / n, v[1] / n]);
            } else if (k === bez.length) {
                const s = bez[k - 1];
                const a = s[2], b = run[idx[k]];
                const v = [b[0] - a[0], b[1] - a[1]];
                const n = Math.hypot(v[0], v[1]) || 1;
                T.push([v[0] / n, v[1] / n]);
            } else {
                const s = bez[k - 1], e = bez[k];
                const v1 = [s[3][0] - s[2][0], s[3][1] - s[2][1]];
                const v2 = [e[1][0] - e[0][0], e[1][1] - e[0][1]];
                let a1 = Math.atan2(v1[1], v1[0]), a2 = Math.atan2(v2[1], v2[0]);
                let d = a2 - a1;
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                const am = a1 + d / 2;
                T.push([Math.cos(am), Math.sin(am)]);
            }
        }
        const out = [];
        for (let k = 0; k < bez.length; k++) {
            out.push(_fitSegT(run, idx[k], idx[k + 1], T[k], T[k + 1],
                              wsegs ? wsegs[k] : null));
        }
        const epsOf = (segs) => {
            const ideal = _bezDense(segs, 8);
            let e = 0;
            for (const q of run) {
                const d = _distToPoly(q, ideal).d;
                if (d > e) e = d;
            }
            return e;
        };
        const preTune = out.map(sg => sg.map(p => [p[0], p[1]]));
        const epsPre = epsOf(out);
        for (let it = 0; it < 2; it++) {
            for (let k = 1; k < out.length; k++) {
                const L = out[k - 1], R = out[k];
                const J = R[0], d = T[k];
                const cL = d[0] * (L[1][1] - J[1]) - d[1] * (L[1][0] - J[0]);
                const cR = d[0] * (R[2][1] - J[1]) - d[1] * (R[2][0] - J[0]);
                if (cL * cR <= 1e-9) continue;   // inflessione al join: skip
                const aL = Math.hypot(L[3][0] - L[2][0], L[3][1] - L[2][1]) || 1;
                const aR = Math.hypot(R[1][0] - R[0][0], R[1][1] - R[0][1]) || 1;
                const kL = cL / (1.5 * aL * aL), kR = cR / (1.5 * aR * aR);
                const kt = (Math.abs(kL) + Math.abs(kR)) / 2 * (cL > 0 ? 1 : -1);
                if (!(Math.abs(kt) > 1e-9)) continue;
                const segL = Math.hypot(L[3][0] - L[0][0], L[3][1] - L[0][1]) || 1;
                const segR = Math.hypot(R[3][0] - R[0][0], R[3][1] - R[0][1]) || 1;
                const sL = Math.sqrt(Math.abs(cL) / (1.5 * Math.abs(kt)));
                const sR = Math.sqrt(Math.abs(cR) / (1.5 * Math.abs(kt)));
                const sLc = Math.max(0.05 * segL, Math.min(1.8 * segL, sL));
                const sRc = Math.max(0.05 * segR, Math.min(1.8 * segR, sR));
                L[2] = [J[0] - d[0] * sLc, J[1] - d[1] * sLc];
                R[1] = [J[0] + d[0] * sRc, J[1] + d[1] * sRc];
            }
        }
        if (epsOf(out) > epsPre + 0.02) {
            for (let k = 0; k < out.length; k++) out[k] = preTune[k];
        }
        return out;
    }
    // fit Bezier cubico pezzo-pezzo: K segmenti crescenti con nodi a
    // lunghezza uniforme; per segmento LSQ libero + IRLS, poi G1+curva.
    // Accettazione: eps (ideale -> run) <= epsT E, se fornito, residuo
    // GREZZO->ideale <= rawT (il gate crudo viene rivalutato a ogni K).
    function _fitBezierRun(run, epsT, rawT, src) {
        const m = run.length;
        if (m < 4) return null;
        const cum = _cumLen(run), total = cum[m - 1];
        if (!(total > 0)) return null;
        const rawOf = (segs) => {
            if (rawT == null || !src) return 0;
            const dense = _bezDense(segs, 16);
            let mr = 0;
            for (const q of src) {
                const d = _distToPoly(q, dense).d;
                if (d > mr) mr = d;
            }
            return mr;
        };
        const Kmax = Math.max(1, Math.min(10, Math.floor(m / 3)));
        for (let K = 1; K <= Kmax; K++) {
            if (K > 1 && m < K * 3 + 2) break;
            const idx = [0];
            let bad = false;
            for (let k = 1; k < K; k++) {
                const target = total * k / K;
                let i = idx[idx.length - 1] + 1;
                while (i < m - 1 && cum[i] < target) i++;
                if (i >= m - 1) { bad = true; break; }
                idx.push(i);
            }
            if (bad || idx.length !== K) continue;
            idx.push(m - 1);
            const bez = [], wsegs = [];
            for (let k = 0; k < K; k++) {
                const i0 = idx[k], i1 = idx[k + 1];
                if (i1 <= i0) { bad = true; break; }
                let sg = _fitSegFree(run, i0, i1, null);
                let w = null;
                for (let ir = 0; ir < 2 && sg; ir++) {
                    const dv = _segResiduals(run, i0, i1, sg);
                    let dmax = 0;
                    for (const t of dv) if (t.d > dmax) dmax = t.d;
                    if (dmax < 0.05) break;
                    w = dv.map(t => {
                        const q = Math.min(1, t.d / dmax);
                        return 1 + 3 * q * q;
                    });
                    sg = _fitSegFree(run, i0, i1, w);
                }
                if (!sg) { bad = true; break; }
                bez.push(sg); wsegs.push(w);
            }
            if (bad || bez.length !== K) continue;
            const proj = _projectG1(bez, idx, run, wsegs);
            const ideal = _bezDense(proj, 8);
            let eps = 0;
            for (const q of run) {
                const d = _distToPoly(q, ideal).d;
                if (d > eps) eps = d;
            }
            if (eps <= epsT && rawOf(proj) <= rawT) {
                return { bez: proj, eps: eps, K: K };
            }
            // fallback: fit libero (senza G1) con kink <= 15gradi
            const freeIdeal = _bezDense(bez, 8);
            let epsF = 0;
            for (const q of run) {
                const d = _distToPoly(q, freeIdeal).d;
                if (d > epsF) epsF = d;
            }
            if (epsF <= epsT && rawOf(bez) <= rawT) {
                let kink = 0;
                for (let i = 1; i < bez.length; i++) {
                    const e = bez[i - 1], s = bez[i];
                    const v1 = [e[3][0] - e[2][0], e[3][1] - e[2][1]];
                    const v2 = [s[1][0] - s[0][0], s[1][1] - s[0][1]];
                    let dd = (Math.atan2(v2[1], v2[0]) - Math.atan2(v1[1], v1[0])) * 180 / Math.PI;
                    while (dd > 180) dd -= 360;
                    while (dd < -180) dd += 360;
                    if (Math.abs(dd) > kink) kink = Math.abs(dd);
                }
                if (kink <= 15) return { bez: bez, eps: epsF, K: K };
            }
        }
        return null;
    }
    // approssimazione cubica dell'arco (segmenti <= 90gradi, k=4/3 tg/4)
    function _bezFromArc(ac) {
        const span = ac.a1 - ac.a0;
        const nSeg = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2)));
        const bez = [];
        for (let i = 0; i < nSeg; i++) {
            const s0 = ac.a0 + span * i / nSeg;
            const s1 = ac.a0 + span * (i + 1) / nSeg;
            const d = s1 - s0;
            const k = 4 / 3 * Math.tan(d / 4);
            const c0 = [ac.cx + ac.r * Math.cos(s0), ac.cy + ac.r * Math.sin(s0)];
            const c3 = [ac.cx + ac.r * Math.cos(s1), ac.cy + ac.r * Math.sin(s1)];
            bez.push([c0,
                      [c0[0] - k * ac.r * Math.sin(s0), c0[1] + k * ac.r * Math.cos(s0)],
                      [c3[0] + k * ac.r * Math.sin(s1), c3[1] - k * ac.r * Math.cos(s1)],
                      c3]);
        }
        return bez;
    }
    // --- 3.2 ARCO: fit algebrico Kasa sui parametri + coerenza della
    // curvatura (monotonia' angolare sul centro fit; gli S si invertono).
    // La curva ideale viene RICAMPIONATA dall'equazione del cerchio.
    function _tryArcFit(rs, src, epsT, rawT) {
        const m = rs.length;
        if (m < 8) return null;
        const kc = kasaCircle(rs);
        if (!kc || kc.r < 12 || kc.r > 4000) return null;
        let eps = 0;
        for (const q of rs) {
            const d = Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r);
            if (d > eps) eps = d;
        }
        if (eps > epsT) return null;
        // passata (1,2,1)/4 SOLO per la stima angolare (mai nel rendering)
        const sm = rs.map(p => [p[0], p[1]]);
        const cp = rs.map(p => [p[0], p[1]]);
        for (let i = 1; i < m - 1; i++) {
            sm[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
            sm[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
        }
        let prev = Math.atan2(sm[0][1] - kc.cy, sm[0][0] - kc.cx);
        const a0 = prev;
        let unw = prev;
        const ds = [];
        for (let i = 1; i < m; i++) {
            const a = Math.atan2(sm[i][1] - kc.cy, sm[i][0] - kc.cx);
            let d = a - prev;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            if (Math.abs(d) > Math.PI / 3) return null;   // salto angolare
            unw += d; ds.push(d);
            prev = a;
        }
        const sig = [];
        for (const d of ds) if (Math.abs(d) > 1.5 * Math.PI / 180) sig.push(d);
        if (sig.length < 4) return null;
        let nPos = 0;
        for (const d of sig) if (d > 0) nPos++;
        const frac = Math.max(nPos, sig.length - nPos) / sig.length;
        let totDeg = 0;
        for (const d of ds) totDeg += Math.abs(d) * 180 / Math.PI;
        if (frac < 0.9) return null;
        if (totDeg < 40 || totDeg > 350) return null;
        const span = Math.abs(unw - a0);
        if (span < 40 * Math.PI / 180 || span > 350 * Math.PI / 180) return null;
        // ricampionatura ideale EX NOVO dall'equazione (passo ~4px)
        const N = Math.max(6, Math.min(400, Math.round(span * kc.r / 4)));
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const a = a0 + (unw - a0) * (i / N);
            pts.push([kc.cx + kc.r * Math.cos(a), kc.cy + kc.r * Math.sin(a)]);
        }
        // gate 2: residuo GREZZO -> arco ideale
        let maxRes = 0;
        for (const q of src) {
            const d = _distToPoly(q, pts).d;
            if (d > maxRes) maxRes = d;
        }
        if (maxRes > rawT) return null;
        const arc = { cx: kc.cx, cy: kc.cy, r: kc.r,
                      a0: a0, a1: unw, ccw: (unw - a0) > 0 };
        return { arc: arc, bez: _bezFromArc(arc), pts: pts,
                 eps: eps, maxRes: maxRes };
    }
    // ===== R22: riconoscimento tratti APERTI ricostruiti DA ZERO =====
    // - rette: _lineFitRobust (da recognizeStroke/_fitShaftPre)
    // - archi coerenti: Kasa + ricampionatura circolare ex novo
    // - curve: fit Bezier cubico LSQ pezzo-pezzo (IRLS) + continuita' G1
    //   ai join + tune di curvatura (revert se peggiora la fedelta')
    // Gate R22: eps (ideale -> tracciato ripulito) <= 2.5px; residuo
    // GREZZO->ideale <= 2.5 + amp*1.5 (a amp=0 resta il gate duro R20).
    function _tryCurve(pts, amp, raw) {
        const n = (pts || []).length;
        if (n < 5) { if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'n', n: n }); return null; }
        const bb = _bbox(pts);
        if (Math.hypot(bb.w, bb.h) < 40) { if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'bb', d: +Math.hypot(bb.w, bb.h).toFixed(1) }); return null; }
        const src = (raw && raw.length === n) ? raw : pts;
        let rs = _resampleUniform(pts, 4);
        if (rs.length < 8) rs = _resampleUniform(pts, 2);
        if (rs.length < 6) { if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'rs', n: rs.length }); return null; }
        const m = rs.length;
        const epsT = 2.5;
        const rawT = 2.5 + (amp || 0) * 1.5;
        // (a) rilevamento ANGOLI: svolta su gambe 8px >= 50gradi (R20,
        //     invariato): il corner viene tagliato e i run fittati a
        //     tratti con continuita' G1 SOLO all'interno del run
        const locked = new Array(m).fill(false);
        locked[0] = true;
        locked[m - 1] = true;
        for (let i = 2; i <= m - 3; i++) {
            const a = rs[i - 2], b = rs[i], c = rs[i + 2];
            const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 1e-9 || n2 < 1e-9) continue;
            const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
            if (ang >= 50) locked[i] = true;
        }
        const cuts = [];
        for (let i = 1; i <= m - 2; i++) if (locked[i]) cuts.push(i);
        const runs = [];
        {
            let start = 0;
            for (const c of cuts) {
                if (c > start) { runs.push(rs.slice(start, c + 1)); start = c; }
            }
            runs.push(rs.slice(start));
        }
        const segs = (runs.length >= 1 && runs.every(r => r.length >= 4))
            ? runs : [rs];
        let bez = null, arc = null, ideal = null;
        // (b) ARCO: solo tratto unico (nessun angolo interno)
        if (segs.length === 1) {
            const A = _tryArcFit(segs[0], src, epsT, rawT);
            if (A) { arc = A.arc; bez = A.bez; ideal = A.pts; }
        }
        if (!bez) {
            bez = [];
            let okFit = true;
            const single = segs.length === 1;
            for (const run of segs) {
                const f = _fitBezierRun(run, epsT,
                    single ? rawT : null, single ? src : null);
                if (!f) { okFit = false; break; }
                for (const sg of f.bez) bez.push(sg);
            }
            if (!okFit) {
                if (window.__ink) window.__ink.trace.push({ k: 'dbgC', g: 'fit', n: n, m: m });
                return null;
            }
            ideal = _bezDense(bez, 16);
            if (ideal.length < 2) return null;
        }
        // gate: residuo GREZZO->ideale (R22: 2.5 + amp*1.5)
        let maxRes = 0, wi = 0;
        for (let i = 0; i < src.length; i++) {
            const d = _distToPoly(src[i], ideal).d;
            if (d > maxRes) { maxRes = d; wi = i; }
        }
        if (maxRes > rawT) {
            if (window.__ink) window.__ink.trace.push({ k: 'dbgC',
                g: 'res', r: +maxRes.toFixed(2), n: n, raw: raw ? 1 : 0,
                m: m, tol: +rawT.toFixed(2), wi: wi });
            return null;
        }
        if (window.__ink) {
            let maxResP = 0;
            for (const q of pts) {
                const d = _distToPoly(q, ideal).d;
                if (d > maxResP) maxResP = d;
            }
            window.__ink.trace.push({ k: 'dbgC',
                g: maxRes > 2.5 ? 'res' : 'ok', r: +maxRes.toFixed(2), n: n,
                raw: raw ? 1 : 0, m: m, rp: +maxResP.toFixed(2), wi: wi,
                arc: arc ? 1 : 0,
                e0: [+pts[0][0].toFixed(1), +pts[0][1].toFixed(1)],
                e1: [+pts[n - 1][0].toFixed(1), +pts[n - 1][1].toFixed(1)],
                r0: [+rs[0][0].toFixed(1), +rs[0][1].toFixed(1)],
                r1: [+rs[rs.length - 1][0].toFixed(1), +rs[rs.length - 1][1].toFixed(1)] });
        }
        const params = arc ? { bez: bez, arc: arc } : { bez: bez };
        return { kind: 'curve', box: _bbox(ideal), rot: 0,
                 pts: ideal, params: params };
    }
    // R20 (7): spessore/pressione del tratto grezzo campionato attorno al
    // perimetro di un cerchio (K=48 settori); a0 = angolo iniziale,
    // dir = verso di traversata del tratto
    function _ringForStroke(stroke, cx, cy) {
        const pts = stroke.pts, sizes = stroke.sizes;
        if (!sizes || !pts || sizes.length !== pts.length || pts.length < 2) return null;
        const K = 48;
        const cum = _cumLen(pts);
        const tot = cum[cum.length - 1];
        if (!(tot > 0)) return null;
        const ring = new Array(K).fill(0), cnt = new Array(K).fill(0);
        for (let i = 0; i < pts.length; i++) {
            const b = Math.max(0, Math.min(K - 1, Math.floor(cum[i] / tot * K)));
            ring[b] += sizes[i]; cnt[b]++;
        }
        let prev = sizes[0];
        for (let i = 0; i < K; i++) {
            if (cnt[i] > 0) { ring[i] = ring[i] / cnt[i]; prev = ring[i]; }
            else ring[i] = prev;
        }
        let first = -1;
        for (let i = 0; i < K; i++) if (cnt[i] > 0) { first = i; break; }
        if (first > 0) for (let i = 0; i < first; i++) ring[i] = ring[first];
        const a0 = Math.atan2(pts[0][1] - cy, pts[0][0] - cx);
        const q25 = _evalPolyAt(pts, cum, tot * 0.25);
        let da = Math.atan2(q25[1] - cy, q25[0] - cx) - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        return { ring: ring, a0: a0, dir: da >= 0 ? 1 : -1 };
    }
    // R20 (7): mappa le sizes per punto del tratto GREZZO sui punti della
    // shape polilinea (corner/curve): indice del punto grezzo piu' vicino
    function _mapSizesToPts(stroke, shapePts) {
        const sp = stroke.pts, sz = stroke.sizes;
        if (!sz || !sp || sz.length !== sp.length || !shapePts || !shapePts.length) return null;
        const out = [];
        for (const q of shapePts) {
            let bi = 0, bd = Infinity;
            for (let i = 0; i < sp.length; i++) {
                const d = (q[0] - sp[i][0]) * (q[0] - sp[i][0]) +
                          (q[1] - sp[i][1]) * (q[1] - sp[i][1]);
                if (d < bd) { bd = d; bi = i; }
            }
            out.push(sz[bi]);
        }
        return out;
    }
    // R25 V1: numero di FLESSI (cambi di curvatura significativi) di un
    // tratto aperto. Proiezione sulla corda + smoothing box (finestra =
    // max(8px, 10% corda) in coordinate MONDO -> zoom-invariante) e
    // conteggio dei cambi segno della derivata con dead-band: il jitter
    // micro NON conta come flesso. Corda degenera (<15px, loop/chiuso)
    // -> 0 (la chiusura e' gestita dal ramo closed di recognizeStroke).
    function _countFlessi(pts) {
        const n = (pts || []).length;
        if (n < 6) return 0;
        const a = pts[0], b = pts[n - 1];
        const cx = b[0] - a[0], cy = b[1] - a[1];
        const L = Math.hypot(cx, cy);
        if (L < 15) return 0;
        const ux = cx / L, uy = cy / L;
        const W = Math.max(8, L * 0.10);          // finestra smoothing (MONDO)
        const eps = Math.max(0.5, L * 0.004);     // dead-band derivata (MONDO)
        const t = [], d = [];
        for (let i = 0; i < n; i++) {
            const dx = pts[i][0] - a[0], dy = pts[i][1] - a[1];
            t.push(dx * ux + dy * uy);
            d.push(-uy * dx + ux * dy);           // distanza con segno dalla corda
        }
        const ds = [];
        for (let i = 0; i < n; i++) {
            let s = 0, k = 0;
            for (let j = 0; j < n; j++) {
                if (Math.abs(t[j] - t[i]) <= W) { s += d[j]; k++; }
            }
            ds.push(k ? s / k : d[i]);
        }
        let last = 0, cnt = 0;
        for (let i = 1; i < n; i++) {
            const dd = ds[i] - ds[i - 1];
            if (Math.abs(dd) < eps) continue;
            const sg = dd > 0 ? 1 : -1;
            if (last && sg !== last) cnt++;
            last = sg;
        }
        return cnt;
    }
    // R25 V1 FREEFORM: smoothing TOPOLOGIA-PRESERVANTE (Taubin
    // corner-preserving, alla Wang et al.): resample 4px, passate Taubin
    // lambda=0.5 / mu=-0.53, corner-lock su svolte >=50gradi (gambe 8px,
    // gate R20) + estremi bloccati, clamp di ogni nodo entro 1.5px dal
    // tracciato GREZZO (mondo -> zoom-invariante). Itera fino a
    // spostamento < 0.2px (max 6 passate). Guard finale: se le
    // auto-intersezioni aumentano o i flessi scendono sotto 2 (quando il
    // grezzo ne aveva >=2) si torna al pulito originale -> MAI snap,
    // MAI cambio di topologia.
    function _taubinPreserve(pts, raw) {
        const srcRaw = (raw && raw.length >= 2) ? raw : pts;
        let sm = _resampleUniform(pts, 4);
        if (sm.length < 5) sm = pts.map(p => [p[0], p[1]]);
        const n = sm.length;
        const lock = new Array(n).fill(false);
        lock[0] = true;
        lock[n - 1] = true;
        for (let i = 2; i <= n - 3; i++) {
            const a = sm[i - 2], b = sm[i], c = sm[i + 2];
            const v1 = [b[0] - a[0], b[1] - a[1]];
            const v2 = [c[0] - b[0], c[1] - b[1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 1e-9 || n2 < 1e-9) continue;
            const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
            if (ang >= 50) lock[i] = true;
        }
        const LAM = 0.5, MU = -0.53;
        const pass = (k) => {
            const cp = sm.map(p => [p[0], p[1]]);
            for (let i = 0; i < n; i++) {
                if (lock[i]) continue;
                let sx = 0, sy = 0, cnt = 0;
                if (i > 0) { sx += cp[i - 1][0]; sy += cp[i - 1][1]; cnt++; }
                if (i < n - 1) { sx += cp[i + 1][0]; sy += cp[i + 1][1]; cnt++; }
                if (!cnt) continue;
                sm[i][0] = cp[i][0] + k * (sx / cnt - cp[i][0]);
                sm[i][1] = cp[i][1] + k * (sy / cnt - cp[i][1]);
            }
        };
        const clampRaw = () => {
            for (let i = 1; i < n - 1; i++) {
                if (lock[i]) continue;
                const d = _distToPoly(sm[i], srcRaw);
                if (d.d > 1.5 && d.d > 0) {
                    const t = 1.5 / d.d;
                    sm[i][0] = d.cx + (sm[i][0] - d.cx) * t;
                    sm[i][1] = d.cy + (sm[i][1] - d.cy) * t;
                }
            }
        };
        for (let it = 0; it < 6; it++) {
            const before = sm.map(p => [p[0], p[1]]);
            pass(LAM); pass(MU); clampRaw();
            let mv = 0;
            for (let i = 0; i < n; i++) {
                const dd = Math.hypot(sm[i][0] - before[i][0],
                                      sm[i][1] - before[i][1]);
                if (dd > mv) mv = dd;
            }
            if (mv < 0.2) break;   // jitter sotto tolleranza
        }
        if (_selfIntersections(sm) > _selfIntersections(pts) ||
            (_countFlessi(pts) >= 2 && _countFlessi(sm) < 2)) {
            return pts.map(p => [p[0], p[1]]);   // rollback: nessun snap
        }
        return sm;
    }
    function recognizeStroke(pts, amp) {
        const n = (pts || []).length;
        if (n < 5) return null;                       // >= 5 punti
        const bb = _bbox(pts);
        if (Math.hypot(bb.w, bb.h) < 40) return null; // R20 (6): bbox < 40px
        // --- R20 (6) ESCLUSIONI: testo, scarabocchio/coloring, re-snap ---
        // inkNoSnap: tratto avviato con overlay testo aperto -> resta stroke
        if (ed && (ed.tool === 'testo' || ed.textTa || ed.inkNoSnap)) return null;
        const si0 = _selfIntersections(pts);
        if (si0 >= 3) return null;                    // auto-inters >= 3
        if (_denseFill(pts)) return null;             // riempimento denso
        if (_insideExisting(pts)) return null;        // nessun re-snap
        const tol = 2.5 + (amp || 0) * 3;             // ampiezza snap (L2)
        const cen = _centroid2(pts);
        let sxx = 0, sxy = 0, syy = 0;
        for (const q of pts) {
            const dx = q[0] - cen[0], dy = q[1] - cen[1];
            sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
        }
        sxx /= n; sxy /= n; syy /= n;
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const ux = Math.cos(th), uy = Math.sin(th);
        // --- LINE (R22): fit robusto Theil-Sen + PCA con proiezione
        //     sugli endpoint reali dei punti -> segmento IDEALE esatto;
        //     residuo perpendicolare grezzo->ideale entro 2.5+amp*3
        const LF = _lineFitRobust(pts, cen, th);
        if (LF && LF.maxPerp <= tol && LF.tlen >= 40) {
            // V1.2 LINEA (gate stretto R20: residuo <= 2.5+amp*3)
            const lb = _bbox([LF.a, LF.b]);
            return { kind: 'line', vclass: 'line', box: lb,
                     rot: LF.th * 180 / Math.PI,
                     pts: [LF.a, LF.b], params: {} };
        }
        // --- R20 (3): CHIUSURA con gap-closing esplicito ---------------
        // gap <= tolleranza-gap -> si chiude il loop col segmento retto
        // (campionato ~6px) PRIMA del fit; gap grande (lettera C) -> il
        // loop NON viene chiuso: mai circle/ellipse/rectangle da li'.
        const gapTol = Math.max(12, Math.hypot(bb.w, bb.h) * 0.08);
        const gap0 = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
        const closed = gap0 <= gapTol;
        if (closed && si0 <= 1) {
            const cps = _closeLoop(pts);
            // --- RETTANGOLO/QUADRATO (R20 4): parita' col cerchio -------
            const r0 = _tryRect(cps, 0, tol);
            if (r0) return r0;
            if (Math.abs(th) > 0.02) {
                const c = cen;
                const rp = cps.map(q => {
                    const dx = q[0] - c[0], dy = q[1] - c[1];
                    return [dx * Math.cos(-th) - dy * Math.sin(-th),
                            dx * Math.sin(-th) + dy * Math.cos(-th)];
                });
                const rr = _tryRect(rp, th * 180 / Math.PI, tol);
                if (rr) {
                    rr.pts = rr.pts.map(q => [q[0] + c[0], q[1] + c[1]]);
                    rr.box = _bbox(rr.pts);
                    return rr;
                }
            }
            // --- TRIANGOLO (R20 5): 3 cluster vertici, angoli 60+/-25 ----
            const t0 = _tryTri(cps, 0, tol);
            if (t0) return t0;
            if (Math.abs(th) > 0.02) {
                const c = cen;
                const rp = cps.map(q => {
                    const dx = q[0] - c[0], dy = q[1] - c[1];
                    return [dx * Math.cos(-th) - dy * Math.sin(-th),
                            dx * Math.sin(-th) + dy * Math.cos(-th)];
                });
                const tr = _tryTri(rp, th * 180 / Math.PI, tol);
                if (tr) {
                    tr.pts = tr.pts.map(q => [q[0] + c[0], q[1] + c[1]]);
                    tr.box = _bbox(tr.pts);
                    return tr;
                }
            }
            // --- CIRCLE (Kasa) / ELLISSE: fit sul loop CHIUSO ------------
            const kc = kasaCircle(cps);
            if (kc) {
                let rms = 0;
                for (const q of cps) {
                    const d = Math.abs(Math.hypot(q[0] - kc.cx, q[1] - kc.cy) - kc.r);
                    rms += d * d;
                }
                rms = Math.sqrt(rms / cps.length);
                const tr2 = (sxx + syy) / 2;
                const dt = Math.sqrt(Math.max(0, ((sxx - syy) / 2) * ((sxx - syy) / 2) + sxy * sxy));
                const lam1 = tr2 + dt, lam2 = Math.max(0, tr2 - dt);
                const aE = 2 * Math.sqrt(lam1), bE = 2 * Math.sqrt(lam2);
                const aspect = bE > 0.01 ? aE / bE : 99;
                if (rms <= tol && aspect <= 1.3) {
                    return { kind: 'circle', rot: 0,
                             box: { x: kc.cx - kc.r, y: kc.cy - kc.r,
                                    w: kc.r * 2, h: kc.r * 2 },
                             pts: [], params: { cx: kc.cx, cy: kc.cy, r: kc.r } };
                }
                if (aspect > 1.3 && aspect <= 5) {
                    // assi/centro da ESTREMITA' nel frame PCA (invariante
                    // al campionamento angolare del tracciato)
                    const rot = Math.atan2(uy, ux);
                    const ct = Math.cos(-th), st = Math.sin(-th);
                    let umin = Infinity, umax = -Infinity,
                        vmin = Infinity, vmax = -Infinity;
                    for (const q of cps) {
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
                        let accE = 0;
                        for (const q of cps) {
                            const dx = q[0] - ecx, dy = q[1] - ecy;
                            const u = dx * ct - dy * st, v = dx * st + dy * ct;
                            const eN = Math.sqrt((u * u) / (ea * ea) +
                                                 (v * v) / (eb * eb)) - 1;
                            accE += eN * eN;
                        }
                        const rmsE = Math.sqrt(accE / cps.length) * ((ea + eb) / 2);
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
        }
        // --- R25 V1: classificazione tratti APERTI (line/arc/freeform) --
        // Ogni soglia e su punti MONDO -> zoom-invariante per costruzione
        // (V1.4); qui si arriva solo con tratti NON stretti-abbastanza per
        // il gate linea R20 e NON fittabili come forme chiuse.
        const nf = _countFlessi(pts);
        if (si0 >= 1 || nf >= 2) {
            // FREEFORM (V1.2): >=2 flessi O auto-intersezioni (si0 1-2;
            // >=3 escluso in cima -> resta stroke) O loop -> SOLO smoothing
            // topologia-preservante (Taubin corner-preserving): forma e
            // numero di flessi conservati, NESSUN snap a modello ideale.
            // Resa come polyline (kind 'curve' compat R20, params.freeform).
            const smF = _taubinPreserve(pts,
                (ed && ed.inkRawRef && ed.inkRawRef.length === n)
                    ? ed.inkRawRef : null);
            return { kind: 'curve', vclass: 'freeform', box: _bbox(smF),
                     rot: 0, pts: smF, params: { freeform: true } };
        }
        // LINEA LASSA (V1.1): deviazione max dalla corda <=2.5+amp*3 GIA'
        // provata sopra; oltre quella, <=3% della lunghezza con <=1 flesso
        // (garantito qui sopra) -> segmento ideale ex novo Theil-Sen.
        if (LF && LF.tlen >= 40 &&
            LF.maxPerp <= Math.max(tol, 0.03 * LF.tlen)) {
            const lb2 = _bbox([LF.a, LF.b]);
            return { kind: 'line', vclass: 'line', box: lb2,
                     rot: LF.th * 180 / Math.PI, pts: [LF.a, LF.b],
                     params: {} };
        }
        // --- R20 (2): CURVA -> ARCO SEMPLICE (V1.2): <=1 flesso, curvatura
        //     monotona, auto-intersezioni 0, APERTO -> Kasa o Bézier cubica
        //     LSQ ritracciati da zero (kind 'curve' compat, vclass 'arc')
        const rc = _tryCurve(pts, amp,
            (ed && ed.inkRawRef && ed.inkRawRef.length === n) ? ed.inkRawRef : null);
        if (rc) rc.vclass = 'arc';
        return rc;
    }
    // A2: flick finale a V = ultimo tratto (<=250ms) con svolta >=100gradi.
    // R19 A2.4: ritorna l'INDICE di inizio del flick (>=0) oppure -1: la
    // porzione PRE-flick viene riconosciuta per ricostruire la freccia.
    function detectFlick(o) {
        const dbg = { n: (o.pts || []).length,
                      tsN: (o.ts && o.pts && o.ts.length === o.pts.length)
                          ? o.ts.length : -1 };
        let r = _detectFlickCore(o, dbg);
        dbg.r = r;
        // R25 V1.2: fallback BACK-STROKE - V0: flick senza pausa (2 move a
        // <5ms) NON scatta col gate 250ms/bbox<=80px. Finestra TEMPo+SPAZIO
        // sul back-stroke finale: <=120ms E <=35px (coordinate MONDO ->
        // zoom-invariante) con inversione >=100gradi rispetto alla direzione
        // in ingresso.
        if (r < 0) r = _detectBackStroke(o, dbg);
        dbg.r2 = r;
        if (window.__ink) window.__ink.trace.push({ k: 'dbgF', d: dbg });
        return r;
    }
    // R25 V1.2: rilevamento flick/back-stroke ROBUSTO (fallback del core).
    // Restituisce l'indice d'inizio della finestra di flick (pre-flick =
    // pts[0..s-1], >=4 punti per l'asta) oppure -1.
    function _detectBackStroke(o, dbg) {
        const pts = o.pts;
        const ts = (o.ts && o.pts && o.ts.length === o.pts.length) ? o.ts : null;
        if (!pts || pts.length < 7) return -1;
        const n = pts.length;
        const T_WIN = 120, S_WIN = 35;   // MONDO (soglie su punti mondo)
        let s = n - 1, arc = 0;
        const endT = ts ? ts[n - 1] : 0;
        while (s > 0) {
            const seg = Math.hypot(pts[s][0] - pts[s - 1][0],
                                   pts[s][1] - pts[s - 1][1]);
            if (arc + seg > S_WIN) break;
            if (ts && endT - ts[s - 1] > T_WIN) break;
            arc += seg;
            s--;
        }
        dbg.bsl = { s: s, arc: +arc.toFixed(1) };
        if (s < 4) return -1;            // pre-flick >= 4 punti (asta)
        if (n - s < 3) return -1;        // flick >= 3 punti (>=2 segmenti)
        if (arc < 12) return -1;         // non un micro-tremolio
        // direzione IN ingresso: baseline ~6 punti PRIMA della finestra
        const i0 = Math.max(0, s - 6);
        const din = [pts[s][0] - pts[i0][0], pts[s][1] - pts[i0][1]];
        const nin = Math.hypot(din[0], din[1]);
        if (nin < 8) return -1;
        // direzione del back-stroke: corda finestra (inizio -> fine)
        const dfx = pts[n - 1][0] - pts[s][0];
        const dfy = pts[n - 1][1] - pts[s][1];
        const nfx = Math.hypot(dfx, dfy);
        if (nfx < 10) return -1;
        const cosang = (din[0] * dfx + din[1] * dfy) / (nin * nfx);
        const ang = Math.acos(Math.max(-1, Math.min(1, cosang))) * 180 / Math.PI;
        dbg.bsl.ang = +ang.toFixed(1);
        if (ang < 100) return -1;
        return s;
    }
    function _detectFlickCore(o, dbg) {
        const pts = o.pts;
        if (!pts || pts.length < 5) return -1;
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
        dbg.start = start;
        const win = pts.slice(start);
        if (win.length < 4) return -1;   // R14: micro-V brevi compatibili
        // finestra spaziale contenuta (il flick e' piccolo)
        const wb = _bbox(win);
        dbg.bw = +wb.w.toFixed(1); dbg.bh = +wb.h.toFixed(1);
        if (Math.hypot(wb.w, wb.h) > 80) return -1;
        // (R20 F1) deflessione: v1 = da inizio finestra a split,
        // v2 = da split a fine finestra; gambe entrambe >= 8px
        const defl = k => {
            const v1 = [win[k][0] - win[0][0], win[k][1] - win[0][1]];
            const v2 = [win[win.length - 1][0] - win[k][0],
                        win[win.length - 1][1] - win[k][1]];
            const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
            if (n1 < 8 || n2 < 8) return -1;
            const cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
            return Math.acos(Math.max(-1, Math.min(1, cosang))) * 180 / Math.PI;
        };
        const mid = Math.floor(win.length / 2);
        const dm = defl(mid);
        dbg.mid = mid; dbg.dm = +dm.toFixed(1);
        if (dm >= 100) return start;     // flick a V classico
        // (R20 F1) BACK-STROKE: inversione di direzione netta in uno split
        // NON centrale (>=120gradi, oltre la soglia angolare del V). Copre
        // l'inversione su tratti retti/curvi; gli archi morbidi restano
        // sotto soglia per costruzione e il gate bbox<=80 li limita gia'.
        let bestA = -1, bestK = -1;
        for (let k = 1; k < win.length - 1; k++) {
            if (k === mid) continue;
            const a = defl(k);
            if (a > bestA) { bestA = a; bestK = k; }
            if (a >= 120) return start;
        }
        dbg.bestA = +bestA.toFixed(1); dbg.bestK = bestK;
        return -1;
    }
    function findFlickTarget(o) {
        // linea/arco precedente entro 45px dall'inizio del flick
        const objs = ed.doc.objects;
        const p0 = o.pts[0];
        for (let i = objs.length - 1; i >= 0; i--) {
            const t = objs[i];
            if (t.t !== 'shape') continue;
            if (['line', 'circle', 'ellipse', 'curve', 'rectangle', 'square', 'triangle'].indexOf(t.kind) < 0) continue;
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
    // R19 A2.3/A2.4: shape "curve" da tratto curvo, SENZA limite di
    // curvatura: polilinea smussata + box. Usata SOLO nella ricostruzione
    // della freccia (flick): le curve libere senza flick restano stroke.
    function _curveRec(pts) {
        if (!pts || pts.length < 4) return null;
        const bb = _bbox(pts);
        if (Math.hypot(bb.w, bb.h) < 20) return null;
        const sm = pts.map(p => [p[0], p[1]]);
        for (let it = 0; it < 2; it++) {
            const cp = sm.map(p => [p[0], p[1]]);
            for (let i = 1; i < sm.length - 1; i++) {
                sm[i][0] = (cp[i - 1][0] + 2 * cp[i][0] + cp[i + 1][0]) / 4;
                sm[i][1] = (cp[i - 1][1] + 2 * cp[i][1] + cp[i + 1][1]) / 4;
            }
        }
        return { kind: 'curve', box: bb, rot: 0, pts: sm, params: {} };
    }
    // ===== R20 FRECCIA COMPOSTA (F1-F4) ================================
    // F2: asta = porzione pre-flick perfezionata con la SUA classe
    function _fitShaftPre(pre, amp, rawPre) {
        const n = pre.length;
        if (n < 3) return null;
        const tol = 2.5 + (amp || 0) * 3;
        // --- LINE (R22): fit robusto Theil-Sen + PCA, endpoint =
        //     proiezione sugli estremi reali; stesse soglie R20 F2
        const LF = _lineFitRobust(pre);
        // R25 V1: stesso gate linea di recognizeStroke (stretto R20 o
        // lasso <=3% corda con <=1 flesso) - soglie su punti MONDO
        const nfPre = LF ? _countFlessi(pre) : 99;
        const lineOK = LF && (LF.maxPerp <= tol ||
            (LF.maxPerp <= 0.03 * LF.tlen && nfPre <= 1));
        if (lineOK &&
            (LF.tlen >= 40 || (LF.tlen >= 24 && LF.maxPerp <= 1.5))) {
            let a = LF.a, b = LF.b;
            // orientamento lungo il verso di disegno (la punta va alla FINE)
            const dtx = pre[n - 1][0] - pre[0][0], dty = pre[n - 1][1] - pre[0][1];
            if ((b[0] - a[0]) * dtx + (b[1] - a[1]) * dty < 0) {
                const tmp = a; a = b; b = tmp;
            }
            if (window.__ink) window.__ink.trace.push({ k: 'dbgfS', out: 'line',
                n: n, mp: +LF.maxPerp.toFixed(2), tR: +LF.tlen.toFixed(1),
                tol: +tol.toFixed(2) });
            return { kind: 'line', pts: [a, b] };
        }
        // --- CURVE: fit Bezier U2 (_tryCurve) con gate residuo GREZZO->
        //     ideale <=2.5px: un arco diventa ARCO PERFETTO con punta ---
        const src = (rawPre && rawPre.length === n) ? rawPre : null;
        let c = _tryCurve(pre, amp, src);
        if (!(c && c.params && c.params.bez && c.params.bez.length) && src) {
            // R20 F2b: lo smussamento di fine tratto scorre i punti lungo
            // il tratto (la coda pre-flick si accorcia rispetto ai grezzi)
            // e il gate grezzo->ideale va oltre 2.5px sulla coda. Retry:
            // fitta i GREZZI pre-flick (copertura piena) con un leggero
            // anti-tremolio (1,2,1)/4 stabile -> residuo = tremolio ~1px
            const lite = src.map(p => [p[0], p[1]]);
            const cp0 = src.map(p => [p[0], p[1]]);
            for (let i = 1; i < src.length - 1; i++) {
                lite[i][0] = (cp0[i - 1][0] + 2 * cp0[i][0] + cp0[i + 1][0]) / 4;
                lite[i][1] = (cp0[i - 1][1] + 2 * cp0[i][1] + cp0[i + 1][1]) / 4;
            }
            c = _tryCurve(lite, amp, src) || _tryCurve(src, amp, src);
        }
        if (c && c.params && c.params.bez && c.params.bez.length) {
            if (window.__ink) window.__ink.trace.push({ k: 'dbgfS', out: 'curve',
                n: n, hasRaw: !!src });
            return { kind: 'curve', pts: c.pts, params: c.params };
        }
        if (window.__ink) window.__ink.trace.push({ k: 'dbgfS', out: 'NULL',
            n: n, mp: LF ? +LF.maxPerp.toFixed(2) : -1,
            tR: LF ? +LF.tlen.toFixed(1) : -1,
            tol: +tol.toFixed(2), curve: c ? 1 : 0, hasRaw: !!src,
            bb: +Math.hypot(_bbox(pre).w, _bbox(pre).h).toFixed(1) });
        return null;
    }
    // F3: punta ricostruita - triangolo pulito, base sul punto terminale
    // dell'asta, ali simmetriche ad angoloAla rispetto alla TANGENTE FINALE
    function _makeHead(base, tangent, size) {
        const n = Math.hypot(tangent[0], tangent[1]);
        if (!(n > 0)) return null;
        const tx = tangent[0] / n, ty = tangent[1] / n;
        const sp = (size > 0 ? size : 2);
        const L = 3.2 * sp;                      // ali = 3-4x spessore
        if (!(L > 1)) return null;
        return { angoloAlaDeg: 35, lunghezza: L, tangente: [tx, ty],
                 base: [base[0], base[1]] };
    }
    function _headPoly(head) {
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
    // F1-F4: porzione pre-flick -> rec per l'oggetto 'arrow' UNICO
    function buildArrowRec(o, fi) {
        // R25 V1.2: flick BREVILE ammesso (>=3 punti = 2 segmenti; V0 ha
        // solo 2 move dopo la linea)
        if (fi < 4 || o.pts.length - fi < 3) return null;
        const pre = o.pts.slice(0, fi);
        if (pre.length < 3) return null;
        const amp = ed.inkSnapAmp || 0;
        const rawPre = (ed.inkRawRef && ed.inkRawRef.length === o.pts.length)
            ? ed.inkRawRef.slice(0, fi) : null;
        const fit = _fitShaftPre(pre, amp,
            (rawPre && rawPre.length === pre.length) ? rawPre : null);
        if (window.__ink) window.__ink.trace.push({ k: 'dbgf2', fi: fi,
            pre: pre.length, fit: fit ? fit.kind : 'NULL' });
        if (!fit) return null;
        const preSizes = (o.sizes && o.sizes.length === o.pts.length)
            ? o.sizes.slice(0, fi) : null;
        // tangente FINALE (derivata Bezier in t=1 per le curve) + terminale
        let terminal, tangent;
        if (fit.kind === 'line') {
            const e = fit.pts[fit.pts.length - 1];
            terminal = [e[0], e[1]];
            const a0 = fit.pts[0];
            tangent = [terminal[0] - a0[0], terminal[1] - a0[1]];
        } else {
            const bez = fit.params.bez;
            const sg = bez[bez.length - 1];
            terminal = [sg[3][0], sg[3][1]];
            tangent = [3 * (sg[3][0] - sg[2][0]), 3 * (sg[3][1] - sg[2][1])];
            if (Math.hypot(tangent[0], tangent[1]) < 1e-6) {
                tangent = [sg[3][0] - sg[0][0], sg[3][1] - sg[0][1]];
            }
        }
        if (!tangent || Math.hypot(tangent[0], tangent[1]) < 1e-6) return null;
        // spessore di coda (sizes in coda) -> lunghezza delle ali
        let tail = o.size || 2;
        if (preSizes && preSizes.length) {
            const k = Math.min(3, preSizes.length);
            let s = 0;
            for (let i = preSizes.length - k; i < preSizes.length; i++) s += preSizes[i];
            if (s > 0) tail = s / k;
        }
        const head = _makeHead(terminal, tangent, tail);
        if (!head) return null;
        // copie profonde: params.shaft.pts NON aliasa o.pts (move/scale)
        const objPts = fit.pts.map(p => [p[0], p[1]]);
        const shaftPts = fit.pts.map(p => [p[0], p[1]]);
        const sizes = preSizes
            ? _mapSizesToPts({ pts: pre, sizes: preSizes }, objPts) : null;
        const bp = fit.pts.map(p => [p[0], p[1]]);
        if (fit.params && fit.params.bez) {
            for (const sg of fit.params.bez) for (const pb of sg) bp.push(pb);
        }
        const tri = _headPoly(head);
        if (tri) bp.push(tri[0], tri[1], tri[2]);
        const shaft = { kind: fit.kind, pts: shaftPts };
        const params = { shaft: shaft, head: head };
        if (fit.params && fit.params.arc) {
            // R22: arco ideale condiviso fra asta e top-level (stesso
            // riferimento: move/scale lo trasformano UNA volta)
            params.arc = fit.params.arc;
            shaft.arc = fit.params.arc;
        }
        if (fit.params && fit.params.bez) {
            // params.bez in cima (spec Q6); shaft.bez stesso riferimento:
            // moveObj/scaleObj traducono UNA sola volta con il guard !=
            params.bez = fit.params.bez;
            shaft.bez = fit.params.bez;
        }
        return { kind: 'arrow', vclass: 'arrow', rot: 0, pts: objPts,
                 box: _bbox(bp), sizes: sizes, params: params };
    }
    // F4 retrocompat: target line/curve esistente CONVERTITO in 'arrow'
    // (il vecchio "flag arrow su shape" resta solo per i target non
    // convertibili: cerchio/ellisse/rettangolo/quadrato/triangolo)
    function convertTargetToArrow(tgt, p0) {
        if (!tgt || tgt.t !== 'shape' || !p0) return null;
        let terminal, tangent, shaft;
        if (tgt.kind === 'line' && tgt.pts && tgt.pts.length === 2) {
            const a = tgt.pts[0], b = tgt.pts[1];
            const da = Math.hypot(p0[0] - a[0], p0[1] - a[1]);
            const db = Math.hypot(p0[0] - b[0], p0[1] - b[1]);
            const end = da <= db ? a : b, st = da <= db ? b : a;
            terminal = [end[0], end[1]];
            tangent = [terminal[0] - st[0], terminal[1] - st[1]];
            shaft = { kind: 'line',
                      pts: [[st[0], st[1]], [terminal[0], terminal[1]]] };
        } else if (tgt.kind === 'curve' && tgt.params && tgt.params.bez &&
                   tgt.params.bez.length) {
            const bez = tgt.params.bez;
            const s0 = bez[0][0], c1 = bez[0][1];
            const e2 = bez[bez.length - 1][2], e0 = bez[bez.length - 1][3];
            const dS = Math.hypot(p0[0] - s0[0], p0[1] - s0[1]);
            const dE = Math.hypot(p0[0] - e0[0], p0[1] - e0[1]);
            if (dE <= dS) {
                terminal = [e0[0], e0[1]];
                tangent = [3 * (e0[0] - e2[0]), 3 * (e0[1] - e2[1])];
            } else {
                terminal = [s0[0], s0[1]];
                tangent = [3 * (s0[0] - c1[0]), 3 * (s0[1] - c1[1])];
                tangent = [-tangent[0], -tangent[1]];   // verso di ARRIVO
            }
            shaft = { kind: 'curve',
                      pts: (tgt.pts || []).map(q => [q[0], q[1]]),
                      bez: tgt.params.bez,
                      arc: tgt.params.arc };
        } else {
            return null;
        }
        if (!tangent || Math.hypot(tangent[0], tangent[1]) < 1e-6) return null;
        // spessore di coda dal target (size/presenza sizes)
        let tail = tgt.size || 2;
        if (tgt.sizes && tgt.sizes.length === (tgt.pts || []).length &&
            tgt.pts && tgt.pts.length) {
            let bi = 0, bd = Infinity;
            for (let i = 0; i < tgt.pts.length; i++) {
                const d = Math.hypot(tgt.pts[i][0] - terminal[0],
                                     tgt.pts[i][1] - terminal[1]);
                if (d < bd) { bd = d; bi = i; }
            }
            if (tgt.sizes[bi] > 0) tail = tgt.sizes[bi];
        }
        const head = _makeHead(terminal, tangent, tail);
        if (!head) return null;
        const pts = (tgt.pts || []).map(q => [q[0], q[1]]);
        const bp = (tgt.pts || []).map(q => [q[0], q[1]]);
        if (shaft.bez) for (const sg of shaft.bez) for (const pb of sg) bp.push(pb);
        const tri = _headPoly(head);
        if (tri) bp.push(tri[0], tri[1], tri[2]);
        const params = { shaft: shaft, head: head };
        if (shaft.bez) params.bez = shaft.bez;
        if (shaft.arc) params.arc = shaft.arc;
        return { t: 'shape', kind: 'arrow', color: tgt.color,
                 size: tgt.size, alpha: tgt.alpha, box: _bbox(bp), rot: 0,
                 pts: pts,
                 sizes: (tgt.sizes && tgt.sizes.length === (tgt.pts || []).length)
                     ? tgt.sizes.slice() : null,
                 params: params };
    }
        function makeShapeObj(stroke, rec) {
        const o = {
            t: 'shape', kind: rec.kind,
            color: stroke.color || '#141414',
            size: stroke.size || 2,
            alpha: (stroke.alpha !== undefined ? stroke.alpha : 1),
            box: rec.box, rot: rec.rot || 0, pts: rec.pts || [],
            arrow: !!rec.arrow, params: rec.params || null,
            // R25 V1: classe di classificazione V1 (line/arc/freeform/
            // closed/arrow) - leggibile anche dal QA su window.__ink
            vclass: rec.vclass || null
        };
        // R20 (7): larghezza/pressione PER PUNTO del tratto grezzo
        // preservata sulla shape: polyline/curve -> per nodo; cerchio ->
        // 48 settori sul perimetro campionati dal tratto
        const hasSz = !!(stroke.sizes && stroke.sizes.length &&
            (stroke.pts || []).length === stroke.sizes.length);
        if (rec.kind === 'arrow') {
            // R20 F4: sizes gia' calcolate sull'asta dal builder (coda fit)
            if (rec.sizes && rec.sizes.length) o.sizes = rec.sizes;
        } else if (hasSz && rec.kind === 'circle' && o.params &&
            o.params.cx !== undefined) {
            const rg = _ringForStroke(stroke, o.params.cx, o.params.cy);
            if (rg) { o.sizes = rg.ring; o.params.a0 = rg.a0; o.params.dir = rg.dir; }
        } else if (hasSz && o.pts && o.pts.length) {
            o.sizes = _mapSizesToPts(stroke, o.pts);
        }
        return o;
    }
    // A5: 1) push tratto grezzo + pushUndo(col grezzo) + sostituisci con
    // shape -> primo undo ripristina il tratto grezzo, secondo lo rimuove
    function finalizeStrokeWithShape(o, rec) {
        // R20 F5: se il push al primo movimento non e' ancora partito
        // (tratto mai mosso), garantisco comunque il pre-push a 2 livelli
        if (ed.penUndoPending) { ed.penUndoPending = false; pushUndo(); }
        ed.doc.objects.push(o);
        pushUndo();
        const shp = makeShapeObj(o, rec);
        ed.doc.objects[ed.doc.objects.length - 1] = shp;
        // R25 V1: UNO swap singolo al rilascio -> tutta la strumentazione
        // (classified per classe, refined, perfected_on_release,
        // swapped_pixels, residual_px) in UN punto coerente
        ink24Commit(shp, rec.vclass, (o.pts || []).length);
        scheduleSave();
        drawAll();
    }
    function finalizeEndStroke(o) {
        // R20 FRECCIA COMPOSTA (F1-F4): flick finale a V o back-stroke ->
        // UN oggetto 'arrow' = asta perfezionata (linea LSQ / curva Bezier
        // con residuo entro tolleranza) + punta saldata sulla tangente
        // finale. Undo: 1 = tratto grezzo pre-flick, 2 = rimosso.
        if (ed.arrowOn) {
            const fi = detectFlick(o);
            if (window.__ink) window.__ink.trace.push({ k: 'dbgf', fi: fi,
                n: (o.pts || []).length, tsN: o.ts ? o.ts.length : -1 });
            if (fi >= 0) {
                // (a) stesso tratto: porzione pre-flick = asta (F2) + punta (F3)
                if (ed.shpOn && fi >= 4 && o.pts.length - fi >= 3) {
                    const recA = buildArrowRec(o, fi);
                    if (recA) {
                        // R24/R25: contatori arrow (classified/refined/
                        // perfected/swapPx/residuo) via ink24Commit dentro
                        // finalizeStrokeWithShape -> UNO swap al rilascio
                        finalizeStrokeWithShape(o, recA);
                        return;   // undo 1 = tratto grezzo, undo 2 = via
                    }
                }
                // (b) due tratti: target line/curve esistente CONVERTITO in
                // 'arrow' (retrocompat dell'attach); altri target ->
                // flag legacy (drawShape con o.arrow sull'ultimo segmento)
                const tgt = findFlickTarget(o);
                if (tgt) {
                    const conv = convertTargetToArrow(tgt, o.pts[0]);
                    if (conv) {
                        const idx = ed.doc.objects.indexOf(tgt);
                        if (idx >= 0) ed.doc.objects[idx] = conv;
                    } else {
                        tgt.arrow = true;
                    }
                    // R24/R25: target convertito in arrow -> swap al
                    // rilascio (contatori V1 tutti in un punto)
                    ink24Commit(conv || tgt, 'arrow', (o.pts || []).length);
                    scheduleSave();
                    drawAll();
                    return;   // flick scartato: undo torna allo stato pre-flick
                }
            }
        }
        if (ed.shpOn) {
            const rec = recognizeStroke(o.pts, ed.inkSnapAmp || 0);
            if (rec) {
                // R24/R25: perfezionamento AL RILASCIO sul percorso
                // pointerup reale (line Theil-Sen / arc Kasa-Bezier /
                // freeform Taubin / closed R20) - contatori V1 dentro
                // finalizeStrokeWithShape (UNO swap singolo)
                finalizeStrokeWithShape(o, rec);
                return;
            }
        }
        // R24: riconoscimento tentato ma nulla passato -> tratto resta grezzo
        ink24Add('discarded', null);
        if (ed.penUndoPending) { ed.penUndoPending = false; pushUndo(); }
        ed.doc.objects.push(o);
    }
    // R20 G/U8: FLASH ~150ms sulla shape appena commessa da ghost preview.
    // Solo un breve ciclo rAF con guard su ed (nessun setTimeout che resti
    // vivo dopo close/teardown): l'id vive in ed.ghostFlashRaf ed e' annullato
    // in teardownEditor.
    function ghostFlashLoop() {
        const st = ed;
        if (!st || !st.ghostFlash || st.ghostFlashRaf) return;
        const t0 = performance.now();
        const step = () => {
            if (!ed || ed !== st || !st.ghostFlash) {
                st.ghostFlashRaf = 0;
                return;
            }
            if (performance.now() - t0 >= 150) {
                st.ghostFlash = 0;
                st.ghostFlashObj = null;
                st.ghostFlashRaf = 0;
                drawAll();
                return;
            }
            drawAll();
            st.ghostFlashRaf = requestAnimationFrame(step);
        };
        st.ghostFlashRaf = requestAnimationFrame(step);
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
        function _bezPt(sg, t) {
        const u = 1 - t;
        return [u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] +
                3 * u * t * t * sg[2][0] + t * t * t * sg[3][0],
                u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] +
                3 * u * t * t * sg[2][1] + t * t * t * sg[3][1]];
    }
    // R20 G/U8: overlay della forma CANDIDATA durante l'hold (ghost
    // preview): outline tratteggiato in trasparenza (alfa ~0.45) sopra il
    // tratto grezzo. Geometria leggera eseguita SOLO quando ed.ghost esiste
    // (penna ferma dopo l'hold): nessun lavoro nel percorso di movimento.
    function drawGhostOverlay(ctx, g) {
        if (!g || !g.rec) return;
        let go = null;
        try {
            go = makeShapeObj({ color: '#141414', size: 3, alpha: 0.45,
                                pts: g.pts || [] }, g.rec);
        } catch (e) { return; }
        if (!go) return;
        ctx.save();
        ctx.setLineDash([6 / (ed.scale || 1), 5 / (ed.scale || 1)]);
        drawShape(ctx, go);
        ctx.restore();
    }
    function drawShape(ctx, o) {
        // R14 A1/A2 + R20: shape vettoriale pulita (line/circle/ellipse/
        // square/rectangle/triangle + curve Bezier in params.bez) con
        // larghezza variabile per punto dove ha senso (polyline/curve con
        // segment-loop come drawStroke; cerchio a 48 settori sul perimetro)
        // + eventuale arrowhead sull'ultimo segmento
        ctx.save();
        ctx.globalAlpha = (o.alpha !== undefined ? o.alpha : 1);
        ctx.strokeStyle = o.color || '#141414';
        ctx.fillStyle = o.color || '#141414';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pr = o.params || {};
        const sz = (o.sizes && o.sizes.length) ? o.sizes : null;
        const vary = !!sz &&
            (Math.max.apply(null, sz) - Math.min.apply(null, sz)) > 0.5;
        const polyPts = (o.pts && o.pts.length >= 2) ? o.pts : null;
        const varyPoly = vary && sz.length === (polyPts ? polyPts.length : 0);
        // R20 G/U7: maniglia di rotazione - polyline (line, curve, triangle,
        // rectangle, square) e arrow ruotano attorno al CENTRO del proprio
        // bbox quando o.rot != 0 (gradi, canvas y-giu -> senso orario):
        // ellipse ha gia' l'angolo in ctx.ellipse, circle e' no-op.
        // Le maniglie/bbox di selezione restano assiali al bbox.
        if (o.rot && o.box && (o.kind === 'line' || o.kind === 'curve' ||
            o.kind === 'triangle' || o.kind === 'rectangle' ||
            o.kind === 'square' || o.kind === 'arrow')) {
            const rcx = o.box.x + o.box.w / 2;
            const rcy = o.box.y + o.box.h / 2;
            ctx.translate(rcx, rcy);
            ctx.rotate((o.rot || 0) * Math.PI / 180);
            ctx.translate(-rcx, -rcy);
        }
        if (o.kind === 'arrow' && pr.shaft && pr.head) {
            // R20 F4: asta + punta come UN solo oggetto. L'asta riprende la
            // renderizzazione del tipo sottostante (line/curve con sizes
            // interpolate), la punta e' il triangolo riempito saldato sul
            // terminale dell'asta (geometria interamente in coordinate
            // mondo dentro l'oggetto: move/scale muovono tutto insieme).
            const sf = pr.shaft;
            const shim = { t: 'shape', kind: (sf.kind === 'curve') ? 'curve' : 'line',
                           color: o.color, size: o.size, alpha: o.alpha,
                           pts: sf.pts, sizes: o.sizes,
                           params: ((sf.bez || sf.arc)
                               ? { bez: sf.bez, arc: sf.arc } : {}) };
            drawShape(ctx, shim);
            const tri = _headPoly(pr.head);
            if (tri) {
                ctx.beginPath();
                ctx.moveTo(tri[0][0], tri[0][1]);
                ctx.lineTo(tri[1][0], tri[1][1]);
                ctx.lineTo(tri[2][0], tri[2][1]);
                ctx.closePath();
                ctx.fillStyle = o.color || '#141414';
                ctx.fill();
            }
            ctx.restore();
            return;
        }
        if (o.kind === 'circle' && pr.cx !== undefined) {
            if (vary && sz.length === 48 && pr.a0 !== undefined) {
                for (let i = 0; i < 48; i++) {
                    const a0 = pr.a0 + pr.dir * (i / 48) * Math.PI * 2;
                    const a1 = pr.a0 + pr.dir * ((i + 1) / 48) * Math.PI * 2;
                    ctx.lineWidth = Math.max(0.5, sz[i]);
                    ctx.beginPath();
                    ctx.ellipse(pr.cx, pr.cy, pr.r, pr.r, 0, a0, a1);
                    ctx.stroke();
                }
            } else {
                ctx.lineWidth = Math.max(1, o.size || 2);
                ctx.beginPath();
                ctx.ellipse(pr.cx, pr.cy, pr.r, pr.r, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else if (o.kind === 'ellipse' && pr.cx !== undefined) {
            ctx.lineWidth = Math.max(1, o.size || 2);
            ctx.beginPath();
            ctx.ellipse(pr.cx, pr.cy, pr.a, pr.b,
                        (o.rot || 0) * Math.PI / 180, 0, Math.PI * 2);
            ctx.stroke();
        } else if (o.kind === 'curve' && pr.arc && pr.arc.cx !== undefined) {
            // R22 B3: arco IDEALE tracciato dall'equazione del cerchio
            // (params.arc), MAI dal grezzo; con spessore variabile si
            // sottocampiona per settori angolari fra i nodi (~4px)
            const ac = pr.arc;
            const R = Math.max(1, ac.r);
            ctx.lineWidth = Math.max(1, o.size || 2);
            if (varyPoly) {
                for (let i = 1; i < polyPts.length; i++) {
                    const a0s = Math.atan2(polyPts[i - 1][1] - ac.cy,
                                           polyPts[i - 1][0] - ac.cx);
                    const a1s = Math.atan2(polyPts[i][1] - ac.cy,
                                           polyPts[i][0] - ac.cx);
                    let dd = a1s - a0s;
                    while (dd > Math.PI) dd -= 2 * Math.PI;
                    while (dd < -Math.PI) dd += 2 * Math.PI;
                    ctx.lineWidth = Math.max(0.5, (sz[i - 1] + sz[i]) / 2);
                    ctx.beginPath();
                    ctx.ellipse(ac.cx, ac.cy, R, R, 0, a0s, a0s + dd, false);
                    ctx.stroke();
                }
            } else {
                let dd = ac.a1 - ac.a0;
                if (ac.ccw) { while (dd < 0) dd += 2 * Math.PI; }
                else { while (dd > 0) dd -= 2 * Math.PI; }
                ctx.beginPath();
                ctx.ellipse(ac.cx, ac.cy, R, R, 0, ac.a0, ac.a0 + dd, false);
                ctx.stroke();
            }
            if (o.arrow && polyPts) {
                ctx.lineWidth = Math.max(1, o.size || 2);
                drawArrowHead(ctx, polyPts[polyPts.length - 2],
                              polyPts[polyPts.length - 1],
                              Math.max(6, (o.size || 2) * 3.2));
            }
        } else if (o.kind === 'curve' && pr.bez && pr.bez.length) {
            // curve Bezier lisce: niente kink/tremolii/segmenti grezzi; con
            // spessore variabile si sottocampiona (passo ~2px) interpolando
            // le sizes fra i nodi
            if (varyPoly) {
                for (let i = 0; i < pr.bez.length; i++) {
                    const sg = pr.bez[i];
                    const len = Math.hypot(sg[3][0] - sg[0][0], sg[3][1] - sg[0][1]) +
                        Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]) +
                        Math.hypot(sg[2][0] - sg[1][0], sg[2][1] - sg[1][1]) +
                        Math.hypot(sg[3][0] - sg[2][0], sg[3][1] - sg[2][1]);
                    const nsub = Math.max(6, Math.min(32, Math.round(len / 2)));
                    let prev = _bezPt(sg, 0);
                    for (let j = 1; j <= nsub; j++) {
                        const ft = j / nsub;
                        const q = _bezPt(sg, ft);
                        const f = i + ft;
                        const i0 = Math.max(0, Math.min(sz.length - 1, Math.floor(f)));
                        const i1 = Math.max(0, Math.min(sz.length - 1, i0 + 1));
                        const ftt = f - Math.floor(f);
                        ctx.lineWidth = Math.max(0.5, sz[i0] * (1 - ftt) + sz[i1] * ftt);
                        ctx.beginPath();
                        ctx.moveTo(prev[0], prev[1]);
                        ctx.lineTo(q[0], q[1]);
                        ctx.stroke();
                        prev = q;
                    }
                }
            } else {
                ctx.lineWidth = Math.max(1, o.size || 2);
                ctx.beginPath();
                ctx.moveTo(pr.bez[0][0][0], pr.bez[0][0][1]);
                for (const sg of pr.bez) {
                    ctx.bezierCurveTo(sg[1][0], sg[1][1], sg[2][0], sg[2][1],
                                      sg[3][0], sg[3][1]);
                }
                ctx.stroke();
            }
            if (o.arrow && polyPts) {
                ctx.lineWidth = Math.max(1, o.size || 2);
                drawArrowHead(ctx, polyPts[polyPts.length - 2],
                              polyPts[polyPts.length - 1],
                              Math.max(6, (o.size || 2) * 3.2));
            }
        } else if (polyPts) {
            const closed = (o.kind === 'square' || o.kind === 'rectangle' ||
                            o.kind === 'triangle');
            if (varyPoly) {
                for (let i = 1; i < polyPts.length; i++) {
                    ctx.lineWidth = Math.max(0.5, (sz[i - 1] + sz[i]) / 2);
                    ctx.beginPath();
                    ctx.moveTo(polyPts[i - 1][0], polyPts[i - 1][1]);
                    ctx.lineTo(polyPts[i][0], polyPts[i][1]);
                    ctx.stroke();
                }
                if (closed && polyPts.length >= 3) {
                    ctx.lineWidth = Math.max(0.5,
                        (sz[sz.length - 1] + sz[0]) / 2);
                    ctx.beginPath();
                    ctx.moveTo(polyPts[polyPts.length - 1][0],
                               polyPts[polyPts.length - 1][1]);
                    ctx.lineTo(polyPts[0][0], polyPts[0][1]);
                    ctx.stroke();
                }
            } else {
                ctx.lineWidth = Math.max(1, o.size || 2);
                ctx.beginPath();
                ctx.moveTo(polyPts[0][0], polyPts[0][1]);
                for (let i = 1; i < polyPts.length; i++) {
                    ctx.lineTo(polyPts[i][0], polyPts[i][1]);
                }
                if (closed) ctx.closePath();
                ctx.stroke();
            }
            if (o.arrow) {
                ctx.lineWidth = Math.max(1, o.size || 2);
                drawArrowHead(ctx, polyPts[polyPts.length - 2],
                              polyPts[polyPts.length - 1],
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
        objs.forEach(o => {
            drawObj(ctx, o);
            // R20 G/U8: evidenziazione ~150ms della shape commessa da ghost
            if (ed.ghostFlash && o === ed.ghostFlashObj) {
                const gb = objBBox(o);
                ctx.save();
                ctx.strokeStyle = '#ffca3a';
                ctx.lineWidth = 3 / ed.scale;
                ctx.strokeRect(gb.x - 4, gb.y - 4, gb.w + 8, gb.h + 8);
                ctx.restore();
            }
        });
        if (ed.active) drawObj(ctx, ed.active);
        // R20 G/U8: overlay GHOST (forma candidata) sopra il tratto grezzo
        if (ed.ghost && ed.active) drawGhostOverlay(ctx, ed.ghost);
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
                // R20 G/U7: maniglia di ROTAZIONE (rombo in cima al centro
                // alto del bbox + connettore) - solo selezioni con shape
                if (ed.lasel.some(o => o.t === 'shape')) {
                    const rh = rotHandlePos(ub);
                    const rr = 6 / ed.scale;
                    ctx.save();
                    ctx.strokeStyle = '#ffffff';
                    ctx.fillStyle = '#3aa0ff';
                    ctx.lineWidth = 1.5 / ed.scale;
                    ctx.beginPath();
                    ctx.moveTo(rh.x, rh.y - rr);
                    ctx.lineTo(rh.x + rr, rh.y);
                    ctx.lineTo(rh.x, rh.y + rr);
                    ctx.lineTo(rh.x - rr, rh.y);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(rh.x, rh.y + rr);
                    ctx.lineTo(rh.x, ub.y - 3 / ed.scale);
                    ctx.stroke();
                    ctx.restore();
                }
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

    // R20 F5: cuore del gesto multi-dito (condiviso fra il rilascio dei
    // pointer e __ink.gestureTapTest): 2 dita = undo, 3 dita = redo
    function multiFingerTap(n) {
        if (!ed) return false;
        if (n === 2) {
            // R20 G/U8: 2 dita su una GHOST preview = ANNULLA la ghost e
            // basta (nessun undo: la forma candidata viene scartata, il
            // tratto resta in corso e si classifica al rilascio)
            if (ed.ghost) { ed.ghost = null; return true; }
            undo(); return true;
        }
        if (n === 3) { redo(); return true; }
        return false;
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

    // R20 G/U7: posizione (mondo) della maniglia di ROTAZIONE = centro alto
    // del bbox union, staccato di 14px SCHERMO (in mondo: 14/scale) verso
    // l'alto. Disegnata in drawAll, colpita in lassoDown (mode 'rotate').
    function rotHandlePos(ub) {
        return { x: ub.x + ub.w / 2, y: ub.y - 14 / (ed.scale || 1) };
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
                if (o.params.arc && o.params.arc.cx !== undefined) {
                    o.params.arc.cx += dx; o.params.arc.cy += dy;
                }
                if (o.params.bez) {
                    for (const sgb of o.params.bez) {
                        for (const pb of sgb) { pb[0] += dx; pb[1] += dy; }
                    }
                }
                // R20 F4: freccia composta - asta e punta saldata si
                // traslano insieme (guard anti-aliasing su refs condivise)
                if (o.params.shaft) {
                    const sf = o.params.shaft;
                    if (sf.pts && sf.pts !== o.pts) {
                        sf.pts.forEach(pt => { pt[0] += dx; pt[1] += dy; });
                    }
                    if (sf.bez && sf.bez !== o.params.bez) {
                        for (const sgb of sf.bez) {
                            for (const pb of sgb) { pb[0] += dx; pb[1] += dy; }
                        }
                    }
                    if (sf.arc && sf.arc !== o.params.arc &&
                        sf.arc.cx !== undefined) {
                        sf.arc.cx += dx; sf.arc.cy += dy;
                    }
                }
                if (o.params.head && o.params.head.base) {
                    o.params.head.base[0] += dx;
                    o.params.head.base[1] += dy;
                }
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
                if (pr.arc && pr.arc.cx !== undefined) {
                    pr.arc.cx = c.x + (pr.arc.cx - c.x) * k;
                    pr.arc.cy = c.y + (pr.arc.cy - c.y) * k;
                    pr.arc.r = Math.max(3, pr.arc.r * k);
                }
                if (pr.a !== undefined) pr.a = Math.max(3, pr.a * k);
                if (pr.b !== undefined) pr.b = Math.max(3, pr.b * k);
                if (pr.bez) {
                    for (const sgb of pr.bez) {
                        for (const pb of sgb) {
                            pb[0] = c.x + (pb[0] - c.x) * k;
                            pb[1] = c.y + (pb[1] - c.y) * k;
                        }
                    }
                }
                // R20 F4: scala coerente di asta + punta saldata
                if (pr.shaft) {
                    const sf = pr.shaft;
                    if (sf.pts && sf.pts !== o.pts) {
                        sf.pts.forEach(pt => {
                            pt[0] = c.x + (pt[0] - c.x) * k;
                            pt[1] = c.y + (pt[1] - c.y) * k;
                        });
                    }
                    if (sf.bez && sf.bez !== pr.bez) {
                        for (const sgb of sf.bez) {
                            for (const pb of sgb) {
                                pb[0] = c.x + (pb[0] - c.x) * k;
                                pb[1] = c.y + (pb[1] - c.y) * k;
                            }
                        }
                    }
                    if (sf.arc && sf.arc !== pr.arc &&
                        sf.arc.cx !== undefined) {
                        sf.arc.cx = c.x + (sf.arc.cx - c.x) * k;
                        sf.arc.cy = c.y + (sf.arc.cy - c.y) * k;
                        sf.arc.r = Math.max(3, sf.arc.r * k);
                    }
                }
                if (pr.head) {
                    if (pr.head.base) {
                        pr.head.base[0] = c.x + (pr.head.base[0] - c.x) * k;
                        pr.head.base[1] = c.y + (pr.head.base[1] - c.y) * k;
                    }
                    if (pr.head.lunghezza) {
                        pr.head.lunghezza = Math.max(2, pr.head.lunghezza * k);
                    }
                }
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
            // R20 G/U7: maniglia di ROTAZIONE (rombo in cima al bbox,
            // solo selezioni con almeno una shape) - PRIORITARIA
            if (ed.lasel.some(o => o.t === 'shape')) {
                const rh = rotHandlePos(ub);
                if (Math.hypot(p.x - rh.x, p.y - rh.y) <= hr) {
                    const rc = { x: ub.x + ub.w / 2, y: ub.y + ub.h / 2 };
                    ed.selDrag = {
                        mode: 'rotate', c: rc,
                        a0: Math.atan2(p.y - rc.y, p.x - rc.x) * 180 / Math.PI,
                        rots: ed.lasel.map(o => (o.t === 'shape' ? (o.rot || 0) : 0)),
                        moved: false
                    };
                    return;
                }
            }
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
        } else if (d.mode === 'rotate') {
            // R20 G/U7: rotazione attorno al centro del bbox (gradi): delta
            // dall'angolo iniziale del drag, SOLO o.rot toccato (nessun
            // cambio di bbox/pts/params -> move/scale delle shape restano
            // saldati come da Q7)
            const a = Math.atan2(p.y - d.c.y, p.x - d.c.x) * 180 / Math.PI;
            let delta = a - d.a0;
            while (delta > 180) delta -= 360;
            while (delta < -180) delta += 360;
            if (Math.abs(delta) > 0.4) {
                if (!d.moved) { pushUndo(); d.moved = true; }
                ed.lasel.forEach((o, i) => {
                    if (o.t !== 'shape') return;
                    let r = (d.rots ? (d.rots[i] || 0) : 0) + delta;
                    while (r > 180) r -= 360;
                    while (r < -180) r += 360;
                    o.rot = r;
                });
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

    // R19 A1: F01 (flashcard) su testo LIBERO: selezione se c'e', altrimenti
    // l'intero testo della nota; testo vuoto -> toast (nessuna azione).
    async function runFlashcard(btn, text) {
        const AI = window.AIService;
        if (!AI || typeof AI.runFor !== 'function') {
            try {
                if (AI && typeof AI.toast === 'function') AI.toast('AI non disponibile');
                else if (typeof notify === 'function') notify('AI non disponibile');
            } catch (e) { /* ok */ }
            return;
        }
        const res = await AI.runFor(btn, 'F01', { text: text, tipo: 'flashcard', source: 'notes', materia: (ed && ed.doc && ed.doc.materia) || 'Generale', n: 3, testo: text });
        if (!res || res.fallback) return;
        AI.showPreview(res, function () {
            AI.toast('Flashcard approvata: salvala nel modulo Ripasso (nessun salvataggio automatico)');
        });
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
            await runFlashcard(btn, src.text);
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
        // R20 F5: pinch REALE (dist/centro si muovono >8px) != tap fermo
        if (ed.gesture && !ed.gesture.moved && ed.gesture.d0 !== undefined) {
            const gl = Array.from(ed.pointers.values())
                .filter(p => p.type !== 'mouse');
            if (gl.length >= 2) {
                const ga = gl[0], gb = gl[1];
                const raw = Math.hypot(ga.x - gb.x, ga.y - gb.y);
                if (Math.abs(raw - ed.gesture.d0) > 8) {
                    ed.gesture.moved = true;
                } else if (Math.hypot((ga.x + gb.x) / 2 - ed.gesture.mx0,
                                      (ga.y + gb.y) / 2 - ed.gesture.my0) > 8) {
                    ed.gesture.moved = true;
                }
            }
        }
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

        // R20 (11): se l'overlay testo e' aperto, il tratto che segue deve
        // restare GREZZO (nessun snap): cattura il flag PRIMA di blurActive
        // (che chiude/committa l'overlay e azzererebbe ed.textTa)
        if (ed) ed.inkNoSnap = !!(ed.textTa);
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
            if (ed.active) { ed.active = null; ink24Live(-1); }
            ed.ghost = null;   // R20 G/U8: pinch -> niente ghost orfana
            if (ed.eraserOn) ed.eraserOn = false;
            if (ed.lasso) ed.lasso = null;
            if (ed.selDrag) ed.selDrag = null;
            startPinch();
            // R20 F5: traccia il gesto multi-dito per il tap undo/redo
            // (2 dita = undo, 3 dita = redo) valutato al rilascio
            const gm = Array.from(ed.pointers.entries())
                .filter(kv => kv[1].type !== 'mouse');
            if (gm.length >= 2) {
                if (!ed.gesture) {
                    const gst = new Map();
                    ed.pointers.forEach((v, k) => gst.set(k, { x: v.x, y: v.y }));
                    ed.gesture = { n: gm.length, moved: false, starts: gst };
                } else if (gm.length > ed.gesture.n) {
                    ed.gesture.n = gm.length;
                }
                const ga = gm[0][1], gb = gm[1][1];
                ed.gesture.d0 = Math.hypot(ga.x - gb.x, ga.y - gb.y);
                ed.gesture.mx0 = (ga.x + gb.x) / 2;
                ed.gesture.my0 = (ga.y + gb.y) / 2;
            }
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
        // R20 F5: il push dell'undo e' RIMANDATO al primo movimento: un tap
        // multi-dito (2/3 dita) non deve inquinare lo stack e la redo deve
        // sopravvivere al tocco del primo dito. Il push resta garantito da
        // finalizeStrokeWithShape/finalizeEndStroke (punti fermi).
        ed.penUndoPending = true;
        ed.strokeFromPen = (e.pointerType === 'pen');
        ed.inkHeld = false;
        ed.inkLastMoveT = 0;
        ed.ghost = null;   // R20 G/U8: nuovo tratto -> ghost eventuale scartata
        ed.inkRawRef = null;   // R20: nessun riferimento grezzo da tratti precedenti
        ink24ResetStroke();   // R24: contatori rilascio azzerati a ogni tratto
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
        ink24Live(1);   // R25 V1: strokes_live +1 a pointerdown penna
        drawAll();
    }

    function onPointerMove(e) {
        if (!ed) return;
        // ignora i pointer non tracciati (es. touch scartati dalla palm rejection)
        if (!ed.pointers.has(e.pointerId)) return;
        ed.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
        // R20 F5: spostamento di un dito nel gesto multi-dito (>8px = no tap)
        if (ed.gesture && !ed.gesture.moved) {
            const g0 = ed.gesture.starts.get(e.pointerId);
            if (g0 && Math.hypot(e.clientX - g0.x, e.clientY - g0.y) > 8) {
                ed.gesture.moved = true;
            }
        }
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
            // R20 F5: push undo al PRIMO movimento (vedi onPointerDown)
            if (ed.penUndoPending) { ed.penUndoPending = false; pushUndo(); }
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
                    // R20 G/U8: la penna riprende -> ghost annullata
                    if (ed.ghost) ed.ghost = null;
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
                // R20 F4: moveObj copre stroke/shape (arrow compreso)/text:
                // la freccia composta si sposta UNA volta con punta saldata
                moveObj(o, dx, dy);
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

        // R20 F5: tap multi-dito -> UNA sola azione all'ultimo dito che si
        // stacca (guard anti-doppio: ed.gesture azzerato subito)
        if (ed.gesture && ed.pointers.size === 0) {
            const g = ed.gesture;
            ed.gesture = null;
            if (!g.moved && !ed.active && (g.n === 2 || g.n === 3)) {
                multiFingerTap(g.n);
            }
        }

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
            ink24Live(-1);   // R25 V1: tratto concluso (commit o scarto)
            ed.helpAnchor = null;
            ed.strokeFromPen = false;
            if (o.pts.length) {
                // R14 L2: qui contano Intensita aiuto/Smussamento (fine
                // tratto + ampiezza snap); R14 A: riconoscimento forme e
                // frecce solo qui (o all'hold-still)
                inkEndCleanup(o);
                const gh = ed.ghost;
                ed.ghost = null;
                if (gh && gh.rec) {
                    // R20 G/U8: CONFERMA della ghost preview al rilascio:
                    // stessa sequenza undo a 2 livelli del vecchio commit
                    // all'hold (1 = tratto grezzo, 2 = rimosso) + FLASH
                    // ~150ms sull'oggetto committato (ciclo rAF breve con
                    // guard su ed, id annullato in teardownEditor: nessun
                    // setTimeout/timer che sopravviva a close)
                    // R24/R25: ghost commessa al rilascio -> contatori V1
                    // (classified/refined/perfected/swapPx/residuo) dentro
                    // finalizeStrokeWithShape
                    finalizeStrokeWithShape(o, gh.rec);
                    ed.ghostFlash = performance.now();
                    ed.ghostFlashObj = ed.doc.objects[ed.doc.objects.length - 1];
                    ghostFlashLoop();
                } else {
                    finalizeEndStroke(o);
                }
                // R24: evidenza console a OGNI rilascio di un tratto
                ink24Log();
                scheduleSave();
            } else if (ed.ghost) {
                ed.ghost = null;
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
        // R24 FE-INK: "perfeziona al rilascio" (DEFAULT ON): localStorage
        // 'nt24_releaseRefine' accanto a nt14_shaping
        (function () {
            var r = null;
            try { r = JSON.parse(localStorage.getItem('nt24_releaseRefine') || 'null'); }
            catch (e) { r = null; }
            ed.releaseRefine = (r && r.on !== undefined) ? !!r.on : true;
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
        /* R28 (1): BARRA SUPERIORE collassabile - il bottone a fine barra
           la apre e la chiude; quando e' chiusa pillole/zoom salgono e il
           canvas prende TUTTO lo spazio sotto. */
        const ICV_DOWN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        const ICV_UP = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>';
        const ICV_LEFT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
        const ICV_RIGHT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
            'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
            'stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
        const foldTopBtn = fnBtn(ICV_DOWN, 'Nascondi la barra superiore');
        foldTopBtn.setAttribute('data-foldtop', '1');
        let topFolded = false;
        try { topFolded = localStorage.getItem('nt28_topbar') === '1'; } catch (errT) { topFolded = false; }
        function applyTopFold() {
            root.classList.toggle('fn-topbar-fold', !!topFolded);
            foldTopBtn.classList.toggle('mode', !!topFolded);
            foldTopBtn.title = topFolded ? 'Mostra la barra superiore' : 'Nascondi la barra superiore';
            foldTopBtn.innerHTML = topFolded ? ICV_UP : ICV_DOWN;
            if (topFolded) {
                try { if (typeof closeAllPops === 'function') closeAllPops(); } catch (errT2) { /* ok */ }
            }
            try {
                if (ed && ed.fontiPanel && typeof ed.fontiPanel.refresh === 'function') {
                    ed.fontiPanel.refresh();
                }
            } catch (errT3) { /* ok */ }
        }
        foldTopBtn.addEventListener('click', function () {
            topFolded = !topFolded;
            try { localStorage.setItem('nt28_topbar', topFolded ? '1' : '0'); } catch (errT4) { /* ok */ }
            applyTopFold();
        });
        top.appendChild(foldTopBtn);
        root.appendChild(top);
        applyTopFold();

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
        // ---- R19 A1: Flashcard (F01): selezione testo, oppure la nota intera ----
        const aiCard = App.el('button', 'fn-tb');
        aiCard.type = 'button';
        aiCard.textContent = 'Flashcard';
        aiCard.title = 'Genera flashcard dalla nota/selezione (AI: F01)';
        aiCard.style.cssText = 'width:auto;height:26px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:800;';
        aiCard.addEventListener('click', function (e) {
            const btn = e.currentTarget;
            const src = aiSelectedText();
            if (src && src.text && src.text.trim()) { runFlashcard(btn, src.text); return; }
            const full = (ed && ed.doc) ? String(noteText(ed.doc) || '').trim() : '';
            if (!full) {
                try {
                    if (window.AIService && typeof window.AIService.toast === 'function') {
                        window.AIService.toast('Nessun testo: seleziona un testo o scrivi la nota');
                    } else if (typeof notify === 'function') {
                        notify('Nessun testo da convertire in flashcard');
                    }
                } catch (err) { /* ok */ }
                return;
            }
            runFlashcard(btn, full);
        });
        pillL.appendChild(aiCard);
        ed.btnAiCard = aiCard;
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
        /* R28 (2): PILLOLE STRUMENTI collassabili - il bottone a fine
           pill destra le apre e le chiude; quando sono chiuse un bottone
           circolare (fn-foldfab) le riapre e TUTTO lo spazio va al canvas
           subito sotto. */
        pillR.appendChild(App.el('span', 'fn-sep'));
        const foldToolsBtn = fnBtn(ICV_LEFT, 'Nascondi la barra strumenti', 'fn-tb');
        foldToolsBtn.setAttribute('data-foldtools', '1');
        let toolsFolded = false;
        try { toolsFolded = localStorage.getItem('nt28_tools') === '1'; } catch (errX) { toolsFolded = false; }
        const fab = App.el('button', 'fn-foldfab');
        fab.type = 'button';
        fab.innerHTML = ICV_RIGHT;
        fab.title = 'Mostra la barra strumenti';
        fab.setAttribute('data-foldtools', '1');
        function applyToolsFold() {
            root.classList.toggle('fn-tools-fold', !!toolsFolded);
            foldToolsBtn.classList.toggle('mode', !!toolsFolded);
            foldToolsBtn.title = toolsFolded
                ? 'Mostra la barra strumenti' : 'Nascondi la barra strumenti';
            foldToolsBtn.innerHTML = toolsFolded ? ICV_RIGHT : ICV_LEFT;
            if (toolsFolded) {
                try { if (typeof closeAllPops === 'function') closeAllPops(); } catch (errX2) { /* ok */ }
            }
            try {
                if (ed && ed.fontiPanel && typeof ed.fontiPanel.refresh === 'function') {
                    ed.fontiPanel.refresh();
                }
            } catch (errX3) { /* ok */ }
        }
        foldToolsBtn.addEventListener('click', function () {
            toolsFolded = !toolsFolded;
            try { localStorage.setItem('nt28_tools', toolsFolded ? '1' : '0'); } catch (errX4) { /* ok */ }
            applyToolsFold();
        });
        pillR.appendChild(foldToolsBtn);
        fab.addEventListener('click', function () {
            toolsFolded = false;
            try { localStorage.setItem('nt28_tools', '0'); } catch (errX5) { /* ok */ }
            applyToolsFold();
        });
        root.appendChild(fab);
        ed.bar = pillR;
        root.appendChild(pillR);
        applyToolsFold();

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
        // R24 FE-INK: "Perfeziona al rilascio" (default ON) ACCANTO a
        // "Fermo per snap": tratti aperti -> classificazione+fit idealizzati
        // AL RILASCIO (settle 150ms); spento -> hold-still storico anche per
        // gli aperti. Persistito in localStorage 'nt24_releaseRefine'.
        (function () {
            const row = App.el('div', 'fn-slider-row');
            const lab = App.el('span', 'fn-slider-lab', 'Perfeziona al rilascio');
            const tg = document.createElement('button');
            tg.type = 'button';
            tg.id = 'fn-releaseRefine';
            const sync = () => {
                const on = ed.releaseRefine !== false;
                tg.className = 'fn-relref' + (on ? ' on' : '');
                tg.textContent = on ? 'ON' : 'OFF';
                tg.setAttribute('aria-pressed', String(on));
            };
            sync();
            tg.addEventListener('click', () => {
                ed.releaseRefine = !(ed.releaseRefine !== false);
                sync();
                saveShaping();
            });
            row.appendChild(lab);
            row.appendChild(tg);
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
    // come il .sc-side degli Schemi.
    // R21 B1: il pannello e' il COMPONENTE UNICO FontiPanel (fonti_panel.js):
    // ricerca/chips/preview/fetch/adattatori vivono dal componente; qui
    // resta solo l'etichetta dei tipi per i riferimenti "Fonte:" inseriti.
    // ============================================================
    const FONTI_KIND_LABELS = { note: 'Appunti', riassunto: 'Riassunto', documento: 'Documento', mat: 'Materiale' };

    function fmtBytes(n) {
        n = Number(n);
        if (!isFinite(n) || n < 0) return '';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    // ---- R19 A3.3/A3.4: anteprime VISIVE (escaping + markdown a mano) ----
    function escHtml(x) {
        return String(x == null ? '' : x)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }




    // R21 B1: il pannello Fonti degli Appunti e' il COMPONENTE UNICO
    // FontiPanel (fonti_panel.js, caricato da index.html/_ink_env PRIMA dei
    // moduli). Qui si monta una sola volta dentro il root dell'editor (al
    // posto del vecchio .fn-side) e si gestisce solo l'apertura: stessa
    // logica show/.mode del bottone [data-fonti] in pillL. Fetch, ricerca,
    // chip, preview e insert vivono dentro il componente (zero duplicati).
    function buildFonti(root) {
        ed.fontiPanel = null;
        ed.fontiRoot = null;
        ed.sideFonti = null;
        if (!window.FontiPanel || typeof window.FontiPanel.create !== 'function') {
            return; // componente non caricato: niente pannello (nota in report)
        }
        let panel = null;
        try {
            panel = window.FontiPanel.create({
                contesto: 'appunti',
                onInsert: function (source, info) { insertFontiRef(source, info); }
            });
        } catch (e) { panel = null; }
        if (!panel || !panel.el) return;
        root.appendChild(panel.el);
        ed.fontiPanel = panel;
        ed.fontiRoot = panel.el;
        ed.sideFonti = panel.el; // stesso nome campo del vecchio pannello
    }
    function toggleFonti(force) {
        if (!ed || !ed.fontiRoot) return;
        const want = (force === undefined)
            ? !ed.fontiRoot.classList.contains('show') : !!force;
        ed.fontiRoot.classList.toggle('show', want);
        if (want) {
            // R22 B1.1: dock SOTTO la toolbar sinistra = offset dinamico
            // bottom(.fn-pill-left)/bottom(.fn-zoom) + 10px (fallback CSS
            // top:152px): il pannello NON copre mai undo/redo e comandi.
            const host = ed.fontiRoot.parentElement;
            const pill = host ? host.querySelector('.fn-pill-left') : null;
            const zoom = host ? host.querySelector('.fn-zoom') : null;
            if (host && pill) {
                const hr = host.getBoundingClientRect();
                const pr = pill.getBoundingClientRect();
                const zr = zoom ? zoom.getBoundingClientRect() : null;
                const bBot = pr.bottom - hr.top;
                const zBot = zr ? (zr.bottom - hr.top) : 0;
                const top = Math.max(bBot, zBot) + 10;
                if (hr.height > 0 && pr.height > 0 && top > 0 && top < hr.height - 40) {
                    ed.fontiRoot.style.top = Math.round(top) + 'px';
                }
            }
        }
        if (ed.fontiBtn) ed.fontiBtn.classList.toggle('mode', want);
        if (want && ed.fontiPanel && typeof ed.fontiPanel.refresh === 'function') {
            try { ed.fontiPanel.refresh(); } catch (e) { /* ok */ }
        }
    }








    // Inserisce la fonte nella nota in modo reversibile:
    // - con percorso locale -> oggetto canonico t:'file' (addFileObj-like,
    //   apribile con doppio click via openFileObj/StudyStore.openFilePath);
    // - altrimenti -> oggetto t:'text' con riferimento titolo+kind+id.
    // Entrambi sono oggetti standard del doc: undo li toglie e il
    // salvataggio (serializableDoc) resta invariato -> nessuna corruzione.
    // R21 B1: firma allargata a (source, info) dall'onInsert di FontiPanel.
    // PROVENIENZA nei metadati: ed.doc.fpSources (serializzato da
    // serializableDoc, che copia tutte le chiavi del doc) + campo `prov`
    // {titolo, tipo} sull'oggetto inserito. pushUndo() prima, come prima.
    function insertFontiRef(src, info) {
        if (!ed || !src) return;
        info = info || {};
        const cw = ed.canvas.width / ed.dpr, chh = ed.canvas.height / ed.dpr;
        const cx = (cw / 2 - ed.tx) / ed.scale;
        const cy = (chh / 2 - ed.ty) / ed.scale;
        pushUndo();
        // tipo di provenienza: dal componente (info) con fallback sul kind
        let tipo = info.tipo || '';
        if (!tipo) {
            tipo = src.kind === 'mat'
                ? (/preselected_books/i.test(String(src.path || '')) ? 'Libro' : 'Materiale')
                : (FONTI_KIND_LABELS[src.kind] || src.kind || 'Fonte');
        }
        const prov = { titolo: info.titolo || src.title || 'Senza titolo', tipo: tipo };
        if (!Array.isArray(ed.doc.fpSources)) ed.doc.fpSources = [];
        ed.doc.fpSources.push({
            tipo: prov.tipo, titolo: prov.titolo,
            fonteId: (info.id != null ? info.id : src.id), ts: Date.now()
        });
        if (src.path) {
            ed.doc.objects.push({
                t: 'file', x: cx - 90, y: cy - 28, w: 180, h: 56,
                name: src.title, path: src.path, prov: prov
            });
        } else {
            const label = 'Fonte: ' + src.title + ' (' +
                (FONTI_KIND_LABELS[src.kind] || src.kind) +
                (src.kind === 'mat' ? '' : ' \u00b7 ' + src.id) + ')';
            const o = {
                t: 'text', x: cx - 170, y: cy - 14, w: 10, h: 10,
                text: label, size: 15, color: '#1f5fd6',
                bold: false, italic: false, underline: false,
                prov: prov
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
        // R20 G/U8: fermare il breve ciclo rAF del flash ghost
        if (st.ghostFlashRaf) {
            try { cancelAnimationFrame(st.ghostFlashRaf); } catch (e) { /* ok */ }
            st.ghostFlashRaf = 0;
        }
        st.ghost = null;
        st.ghostFlash = 0;
        document.removeEventListener('click', onDocOutside, true);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', onResize);
        // R21 B1: smonta il componente FontiPanel (niente nodi/istanze fantasma)
        if (st.fontiPanel) {
            try { if (typeof st.fontiPanel.destroy === 'function') st.fontiPanel.destroy(); }
            catch (e) { /* ok */ }
            st.fontiPanel = null;
        }
        st.fontiRoot = null;
        st.sideFonti = null;
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
