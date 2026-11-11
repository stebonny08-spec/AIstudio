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
        // 29-bis: stato OMBRA per QA (G01-G12) — non e' un tratto, non e'
        // persistita; pts = copia del piano ideale corrente
        shadow: function () {
            if (!ed) return null;
            const sh = ed.sh;
            const dbg = {
                has: !!sh,
                tick: !!ed.liveTick,
                age: sh ? Math.round(performance.now() - sh.lastMoveT) : -1,
                evtAge: Math.round(performance.now() - (ed.inkLastEvt || 0)),
                n: ed.active ? ed.active.pts.length : -1,
                tool: ed.active ? ed.active.tool : null,
                hold: (window.InkCommit && InkCommit.CFG.shadowHoldMs) || 200,
                plan: sh && sh.plan ? sh.plan.cls : null,
                noSnap: !!ed.inkNoSnap,
                sp: typeof (window.InkCommit && window.InkCommit.shadowPlan)
            };
            if (!sh) return { visible: false, cls: null, head: false, pts: null, dbg: dbg };
            return {
                visible: !!sh.visible,
                cls: sh.plan ? sh.plan.cls : null,
                head: !!(sh.plan && sh.plan.params && sh.plan.params.head),
                pts: (sh.visible && sh.plan && sh.plan.pts)
                    ? sh.plan.pts.map(p => [p[0], p[1]]) : null,
                dbg: dbg
            };
        },
        // 29-bis: punti GREZZI del tratto attivo (N02-bis: nessun morfing)
        activePts: function () {
            return (ed && ed.active && ed.active.pts)
                ? JSON.parse(JSON.stringify(ed.active.pts)) : null;
        },
        state: function () {
            return ed ? { tool: ed.tool, helpOn: !!ed.helpOn,
                          assist: ed.helpAssist, smooth: ed.helpSmooth,
                          active: !!ed.active,
                          settleMs: (window.InkCommit
                              ? InkCommit.CFG.settleMs : 200),
                          pending: ed.inkPendings
                              ? ed.inkPendings.length : 0,
                          selected: !!ed.selected,
                          lasel: !!(ed.lasel && ed.lasel.length),
                          zoom: ed.scale,
                          dw: ed.doc ? ed.doc.w : 0,
                          dh: ed.doc ? ed.doc.h : 0,
                          pointers: ed.pointers ? ed.pointers.size : -1,
                          tool: ed.tool } : null;
        },
        pageAt: function (wx, wy) {
            try { return inPage({ x: wx, y: wy }); } catch (e) { return 'err'; }
        },
        // R31 (PROMPT R29): setShaping/setReleaseRefine ELIMINATI —
        // il motore ink-commit e' sempre attivo (nessun flag, M01).
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
    // R31: saveShaping/nt14_shaping/nt24_releaseRefine ELIMINATI (M01:
    // nessun flag di shaping persistito — il motore dipende solo da
    // ink_cfg.js)
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
    // R25 V1: UNO swap singolo al rilascio -> tutta la strumentazione
    // (classified per classe, refined, perfected_on_release, swapped_pixels,
    // residual_px) calcolata in UN punto coerente. nRaw = punti grezzi
    // sostituiti dal tratto appena commesso.
    // R31: UNO swap discreto al termine della finestra di assestamento
    // (K01/K02): tutta la strumentazione (classified per classe,
    // refined, perfected_on_release, swapped_pixels, residual_px) in UN
    // punto coerente. residPx = distanza punti renderizzati -> modello
    // parametrico (InkCommit.residualOf; Q01: <=0.5px).
    function ink24Commit(obj, vclass, nRaw, residPx) {
        const cls = V1_CLASSES.indexOf(vclass) >= 0
            ? vclass : _clsOf(obj ? obj.kind : null, vclass);
        ink24Add('classified', cls, cls);
        ink24Add('refined', cls);
        ink24Add('perfected_on_release', null);
        const c = window.__ink && window.__ink.counters;
        if (c) {
            const nId = (obj && obj.pts && obj.pts.length) ? obj.pts.length : 0;
            c.swapped_pixels = (c.swapped_pixels || 0) +
                Math.max(nRaw || 0, nId);
            c.residual_px = (typeof residPx === 'number') ? residPx : 0;
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

    // ---- 29-bis: OMBRA (anteprima live linea/arco, PARTE 1-bis) ----
    // Chiamata a ogni frame finche' la penna e' giu (la catena rAF vive
    // finche' ed.active): attivazione dopo sosta >=shadowHoldMs (G01),
    // aggiornamento continuo su ogni movimento con latenza <=1 frame
    // (~16ms <= 80-100ms di G05), sparizione immediata se la classe esce
    // da T01/T02 (G07). Layer separato: NON tocca mai i punti grezzi
    // (N02-bis) e NON commetta mai (G09).
    function shadowPlanFor(o) {
        try {
            if (!window.InkCommit) return null;
            const plan = InkCommit.shadowPlan(o.pts, {
                ts: o.ts,
                size: o.base || o.size || 3,
                noSnap: !!ed.inkNoSnap
            });
            return plan || null;
        } catch (e) { return null; }
    }
    function updateShadow() {
        if (!ed || !ed.active || !ed.sh) return;
        const o = ed.active;
        if (o.tool === 'highlighter') { ed.sh.visible = false; ed.sh.plan = null; return; }
        const pts = o.pts;
        if (!pts.length) { ed.sh.visible = false; return; }
        const last = pts[pts.length - 1];
        const sig = pts.length + '|' + last[0].toFixed(2) + '|' + last[1].toFixed(2);
        const now = performance.now();
        const hold = (window.InkCommit && InkCommit.CFG.shadowHoldMs) || 200;
        if (ed.sh.visible) {
            if (sig !== ed.sh.sig) {
                ed.sh.sig = sig;
                const p = shadowPlanFor(o);
                if (p) { ed.sh.plan = p; }          // G05: aggiornamento live
                else { ed.sh.visible = false; ed.sh.plan = null; }  // G07
            }
            return;
        }
        // G01/G07: attivazione SOLO dopo una sosta >= hold
        if (ed.sh.lastMoveT && (now - ed.sh.lastMoveT) >= hold) {
            const p = shadowPlanFor(o);
            if (p) {
                ed.sh.visible = true;
                ed.sh.plan = p;
                ed.sh.sig = sig;
            }
        }
    }
    function inkFrame() {
        inkRafId = 0;
        if (!ed || !ed.active) return;
        const now = performance.now();
        // L3: puntatore fermo -> la punta renderizzata converge al punto
        // reale ENTRO <=2 frame (snap al primo frame di quiete)
        if (ed.inkFx && ed.inkLastRaw && (now - (ed.inkLastEvt || 0)) > 16) {
            ed.inkFx.snap(ed.inkLastRaw.x, ed.inkLastRaw.y, now);
            const pts = ed.active.pts;
            const l = pts[pts.length - 1];
            if (l) { l[0] = ed.inkLastRaw.x; l[1] = ed.inkLastRaw.y; }
        }
        updateShadow();   // 29-bis: ombra live (G01-G07)
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

    // ==================== R31: MOTORE INK-COMMIT ====================
    // Parte 1 (PROMPT R29): al RILASCIO il tratto resta visibile e
    // INVARIATO per InkCommit.CFG.settleMs (K01, 150-300ms); poi UNO
    // swap discreto (K02) sostituisce i punti grezzi con la curva
    // ideale del piano (K03, modulo ink_commit.js - M02). Ogni tratto
    // ha il SUO pending con timer indipendente (K04: dieci tratti =
    // dieci commit separati, nell'ordine disegnato).
    // Nessun ghost/hold-still: il commit parte SOLO dal rilascio (N03).
    function snapshotObjects() {
        if (!ed) return '[]';
        const objs = ed.doc.objects;
        const pend = ed.inkPendings || [];
        if (!pend.length || !window.InkCommit) return JSON.stringify(objs);
        // i commit in finestra vengono materializzati nello snapshot:
        // undo/redo e salvataggio contengono SEMPRE la versione ideale
        return JSON.stringify(objs.map(o => {
            for (let i = 0; i < pend.length; i++) {
                if (pend[i].obj === o) {
                    return InkCommit.materialize(o, pend[i].plan);
                }
            }
            return o;
        }));
    }
    function applyCommit(e) {
        if (!e) return false;
        if (e.timer) { clearTimeout(e.timer); e.timer = 0; }
        if (!ed || !ed.doc || !window.InkCommit) return false;
        const pi = (ed.inkPendings || []).indexOf(e);
        if (pi >= 0) ed.inkPendings.splice(pi, 1);
        if (ed.doc.objects.indexOf(e.obj) < 0) return false;  // annullato
        const ok = InkCommit.applyPlan(e.obj, e.plan);
        if (!ok) return false;
        ink24Commit(e.obj, e.plan.cls, e.nRaw,
                    InkCommit.residualOf(e.obj));
        if (window.__ink) {
            window.__ink.trace.push({ k: 'swap', cls: e.plan.cls,
                t: performance.now(), dt: performance.now() - e.t0 });
        }
        drawAll();
        scheduleSave();
        return true;
    }
    function flushPendings() {
        if (!ed || !ed.inkPendings || !ed.inkPendings.length) return;
        ed.inkPendings.slice().forEach(e => applyCommit(e));
    }
    // F01 secondo tratto breve: assorbito come PUNTA della freccia sul
    // tratto appena commesso (F02/F03/F04: UN oggetto, un solo undo).
    // Finestra e soglie sono in ink_cfg.js (parte da 300ms/60px/120ms).
    function tryAbsorbFlick(o2) {
        if (!window.InkCommit || !ed.lastCommit || ed.inkNoSnap) return false;
        const lc = ed.lastCommit;
        const now = performance.now();
        const C = InkCommit.CFG;
        if (now - lc.t > C.flick2Ms) return false;
        const ts = o2.ts;
        if (!ts || ts.length !== o2.pts.length || ts.length < 2) return false;
        if (ts[ts.length - 1] - ts[0] >= C.flick2DurMs) return false;
        const len = InkCommit.pathLen(o2.pts);
        if (len < 3 || len > C.flick2LenPx) return false;
        if (!lc.ref || !lc.ref.obj || !lc.ref.plan) return false;
        if (ed.doc.objects.indexOf(lc.ref.obj) < 0) return false;
        const tgt = lc.ref.obj, plan1 = lc.ref.plan;
        const p1 = tgt.params || plan1.params || {};
        if (p1.head) return false;                  // una sola punta (F05)
        // F03: asta = retta o arco (la punta segue la tangente finale)
        if (['line', 'arc'].indexOf(plan1.cls) < 0) return false;
        const d0 = Math.hypot(o2.pts[0][0] - lc.end[0],
                              o2.pts[0][1] - lc.end[1]);
        if (d0 > C.flick2DistPx) return false;
        const ei = InkCommit.endInfo(plan1);
        if (!ei) return false;
        const head = InkCommit.planHead(ei.end, ei.tangent,
                                        tgt.base || tgt.size || 3);
        if (!head) return false;
        // attach: pending -> punta dentro il piano (scatta al SUO swap);
        // commesso -> muta in posto (N05: nessun ri-fit del vecchio)
        let entry = null;
        for (const e of ed.inkPendings) if (e.obj === tgt) { entry = e; break; }
        if (entry) {
            entry.plan.params = entry.plan.params || {};
            entry.plan.params.head = head;
            entry.plan.params.shaftKind = entry.plan.cls;
            entry.plan.params.cls = 'arrow';
            entry.plan.cls = 'arrow';
        } else {
            tgt.params = tgt.params || {};
            tgt.params.head = head;
            tgt.params.shaftKind = tgt.params.cls || plan1.cls;
            tgt.params.cls = 'arrow';
            tgt.vclass = 'arrow';
            ink24Commit(tgt, 'arrow', o2.pts.length, 0);
        }
        // F04/M04: UN solo undo rimuove asta+punta insieme -> tolgo dal
        // stack lo snapshot creato al PRIMO movimento di o2
        if (!ed.penUndoPending && ed.undo.length) ed.undo.pop();
        ed.penUndoPending = false;
        ed.lastCommit = { t: now, end: ei.end.slice(), ref: lc.ref };
        if (window.__ink) {
            window.__ink.trace.push({ k: 'absorb', t: now, by: plan1.cls });
        }
        return true;
    }
    // rilascio di un tratto penna/evidenziatore -> piano + settle + swap
    function commitStroke(o) {
        if (!ed || !o || !o.pts || !o.pts.length) return;
        // snap di verita' dell'assist: l'ultimo punto diventa il punto
        // REALE del puntatore (la punta live era gia' convergente L3)
        if (ed.inkLastRaw && o.tool !== 'highlighter') {
            const lp = o.pts[o.pts.length - 1];
            lp[0] = ed.inkLastRaw.x;
            lp[1] = ed.inkLastRaw.y;
        }
        // F01: il secondo tratto breve viene assorbito PRIMA della
        // classificazione (diventa punta, mai oggetto separato)
        if (tryAbsorbFlick(o)) return;
        let plan = null;
        try {
            plan = (window.InkCommit) ? InkCommit.classify(o.pts, {
                ts: o.ts,
                size: o.base || o.size || 3,
                noSnap: !!ed.inkNoSnap
            }) : null;
        } catch (err) { plan = null; }
        if (!plan) plan = { raw: true, cls: 'raw', pts: null,
                            params: null, nRaw: o.pts.length };
        if (window.__ink) {
            window.__ink.trace.push({ k: 'release', cls: plan.cls,
                                      t: performance.now() });
        }
        // push UNO snapshot pre-tratto (M04: un solo undo rimuove tutto)
        if (ed.penUndoPending) { ed.penUndoPending = false; pushUndo(); }
        ed.doc.objects.push(o);
        const nRaw = o.pts.length;
        if (plan.raw || !plan.pts) {
            // T06 / forceRaw: nessun commit di perfezione (grezzo com'e')
            delete o._wet;
            ink24Add('discarded');
            ed.lastCommit = null;
            return;
        }
        // K01: il grezzo resta visibile invariato per settleMs con la
        // coda grigia (L02); L04: la coda sparisce allo swap (N08)
        o._wet = true;
        const e = { obj: o, plan: plan, nRaw: nRaw,
                    t0: performance.now(), timer: 0 };
        e.timer = setTimeout(() => { e.timer = 0; applyCommit(e); },
                             InkCommit.CFG.settleMs);
        ed.inkPendings.push(e);
        ed.lastCommit = { t: e.t0,
            end: plan.end ? plan.end.slice()
                : [o.pts[nRaw - 1][0], o.pts[nRaw - 1][1]],
            ref: { obj: o, plan: plan } };
    }
    // ---- rendering di un tratto di inchiostro ----
    function isWet(o) {
        if (o._wet) return true;
        return !!(ed && ed.active === o && o.tool !== 'highlighter');
    }
    function wetColor() {
        return (window.InkCommit && InkCommit.CFG.wetColor) || '#a8a8a8';
    }
    // F03: punta freccia — triangolo pieno con angoli leggermente
    // arrotondati, base saldata esattamente sull'estremo dell'asta,
    // orientata lungo la tangente finale (retta o arco); asta+punta =
    // UN solo oggetto (F04 -> drawStroke + params.head).
    function drawHead(ctx, o) {
        const p = o.params;
        if (!p || !p.head || !window.InkCommit) return;
        const tri = InkCommit.headPoly(p.head);
        if (!tri) return;
        ctx.save();
        ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
        ctx.fillStyle = o.color || '#141414';
        ctx.strokeStyle = o.color || '#141414';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const r = (InkCommit.CFG.headRoundPx || 0.9) *
                  Math.max(1, (o.size || 2) / 2);
        ctx.lineWidth = r * 2;
        ctx.beginPath();
        ctx.moveTo(tri[0][0], tri[0][1]);
        ctx.lineTo(tri[1][0], tri[1][1]);
        ctx.lineTo(tri[2][0], tri[2][1]);
        ctx.closePath();
        ctx.fill();    // corpo pieno
        ctx.stroke();  // angoli leggermente arrotondati (round join)
        ctx.restore();
    }
    // 29-bis: render dell'OMBRA (G02: grigio ~40% opacita', stesso
    // spessore, estremities arrotondate; G08: sagoma della punta se
    // l'asta ha un flick). Sopra il grezzo con alpha: il nero sotto resta
    // leggibile (G03). Nessun handle/etichetta/badge.
    function drawShadow(ctx, sh) {
        const o = ed.active;
        if (!o || !sh || !sh.visible || !sh.plan || !sh.plan.pts) return;
        const p = sh.plan;
        const CFGs = (window.InkCommit && InkCommit.CFG) || {};
        const op = (CFGs.shadowOpacity != null) ? CFGs.shadowOpacity : 0.40;
        const wDelta = (CFGs.shadowWidthDeltaPx != null) ? CFGs.shadowWidthDeltaPx : 0;
        ctx.save();
        ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * op;
        ctx.strokeStyle = o.color || '#141414';
        ctx.fillStyle = o.color || '#141414';
        ctx.lineWidth = Math.max(1, (o.size || 2) - wDelta);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const pts = p.pts;
        if (pts.length === 1) {
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], Math.max(0.6, ctx.lineWidth / 2),
                    0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length - 1; i++) {
                const a = pts[i], b = pts[i + 1];
                ctx.quadraticCurveTo(a[0], a[1],
                    (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
            }
            ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
            ctx.stroke();
        }
        // G08: sagoma della punta (stessa geometria F03, colore ombra)
        if (p.params && p.params.head && window.InkCommit) {
            const tri = InkCommit.headPoly(p.params.head);
            if (tri) {
                ctx.beginPath();
                ctx.moveTo(tri[0][0], tri[0][1]);
                ctx.lineTo(tri[1][0], tri[1][1]);
                ctx.lineTo(tri[2][0], tri[2][1]);
                ctx.closePath();
                ctx.fill();
                ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.5);
                ctx.stroke();
            }
        }
        ctx.restore();
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
            // puntino (tap): grigio finche' non commesso (L02/L04/N08)
            if (isWet(o)) ctx.fillStyle = wetColor();
            ctx.beginPath();
            ctx.arc(pts[0][0], pts[0][1], Math.max(0.6, (o.size || 2) / 2), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            drawHead(ctx, o);
            return;
        }
        // L02: coda "bagnata" grigia = porzione non ancora commitata
        // (ultimi CFG.wetTailPx mondo, ~20-40px); sparisce al commit.
        const wet = isWet(o);
        let split = pts.length - 1;   // indice d'inizio della coda
        if (wet) {
            const tail = (window.InkCommit ? InkCommit.CFG.wetTailPx : 30);
            let acc = 0;
            split = pts.length - 1;
            for (let i = pts.length - 1; i > 0; i--) {
                acc += Math.hypot(pts[i][0] - pts[i - 1][0],
                                  pts[i][1] - pts[i - 1][1]);
                split = i - 1;
                if (acc >= tail) break;
            }
            if (split < 0) split = 0;
        }
        const drawRange = (i0, i1, color) => {
            if (i1 <= i0) return;
            ctx.strokeStyle = color;
            if (o.sizes && o.sizes.length === pts.length) {
                // spessore variabile (pressione, SOLO live)
                for (let i = i0 + 1; i <= i1; i++) {
                    ctx.lineWidth = Math.max(0.5,
                        (o.sizes[i - 1] + o.sizes[i]) / 2);
                    ctx.beginPath();
                    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
                    ctx.lineTo(pts[i][0], pts[i][1]);
                    ctx.stroke();
                }
            } else {
                ctx.lineWidth = Math.max(0.5, o.size || 2);
                ctx.beginPath();
                ctx.moveTo(pts[i0][0], pts[i0][1]);
                for (let i = i0 + 1; i < i1; i++) {
                    const a = pts[i], b = pts[i + 1];
                    ctx.quadraticCurveTo(a[0], a[1],
                        (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                }
                ctx.lineTo(pts[i1][0], pts[i1][1]);
                ctx.stroke();
            }
        };
        if (!wet || split <= 0) {
            drawRange(0, pts.length - 1, o.color || '#141414');
        } else {
            drawRange(0, split, o.color || '#141414');       // corpo nero
            drawRange(split, pts.length - 1, wetColor());    // coda grigia
        }
        ctx.restore();
        drawHead(ctx, o);
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
        objs.forEach(o => { drawObj(ctx, o); });
        if (ed.active) drawObj(ctx, ed.active);
        // 29-bis: OMBRA live — layer SEPARATO sopra il grezzo (G03), mai
        // un tratto/ghost (N02-bis): solo con sosta e solo su T01/T02;
        // sparisce con ed.active al rilascio (G10).
        if (ed.active && ed.sh && ed.sh.visible && ed.sh.plan) {
            drawShadow(ctx, ed.sh);
        }
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
                // R31: maniglia di rotazione ELIMINATA (N04: nessuna
                // maniglia su tratti commessi; le shape non esistono piu')
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
        ed.undo.push(snapshotObjects());
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
        ed.redo.push(snapshotObjects());
        ed.doc.objects = JSON.parse(ed.undo.pop());
        repointPage();
        ed.selected = null;
        ed.lasel = [];
        drawAll();
        scheduleSave();
    }

    function redo() {
        if (!ed || !ed.redo.length) return;
        ed.undo.push(snapshotObjects());
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
            undo(); return true;
        }
        if (n === 3) { redo(); return true; }
        return false;
    }

    // ---------- salvataggio ----------
    function buildPayload(st) {
        // i commit in finestra di assestamento vengono applicati PRIMA
        // di serializzare/thumbnail: il salvataggio contiene SEMPRE la
        // versione perfezionata (M05: reload senza ondulazioni grezze)
        flushPendings();
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
            if (ed.liveTick) { clearInterval(ed.liveTick); ed.liveTick = null; }
            ed.sh = null;
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
        // commitStroke al rilascio (snap singolo -> M04 un solo undo).
        ed.penUndoPending = true;
        ed.strokeFromPen = (e.pointerType === 'pen');
        // 29-bis: pump IDLE (batteria di sicurezza): con la penna ferma in
        // ambienti dove i frame rAF si fermano (headless/compositore a
        // frequenza variabile) quiet-snap e OMBRA non partirebbero mai.
        // Un timer a40ms gira SOLO da >60ms senza input: NON tocca la
        // latenza live (L1/Q04) e ridisegna con la stessa passata di
        // inkFrame finche' la penna e' giu.
        if (ed.liveTick) clearInterval(ed.liveTick);
        ed.liveTick = setInterval(() => {
            if (ed && ed.active &&
                performance.now() - (ed.inkLastEvt || 0) > 60) inkFrame();
        }, 40);
        ink24ResetStroke();   // R24: contatori rilascio azzerati a ogni tratto
        // 29-bis: stato OMBRA per questo tratto (G01: sosta ~150-250ms)
        ed.sh = { lastMoveT: performance.now(), sig: '', visible: false,
                  plan: null };
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
                // R31: timestamp SEMPRE performance.now() — domini coerenti
                // con i ts dei move (finestra flick + durata F01 funzionano
                // anche in jsdom dove e.timeStamp e' un'epoca; nei browser
                // reali timeStamp condivide comunque il time-origin)
                ts: [performance.now()]
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
                    if (ed.sh) ed.sh.lastMoveT = performance.now();
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
            ed.sh = null;   // 29-bis: l'ombra cessa istantaneamente (G10)
            if (ed.liveTick) { clearInterval(ed.liveTick); ed.liveTick = null; }
            ink24Live(-1);   // R25 V1: tratto concluso (commit o scarto)
            ed.helpAnchor = null;
            ed.strokeFromPen = false;
            if (o.pts.length) {
                // R31 (PROMPT R29): NESSUNA pulizia/ricostruzione qui.
                // Il tratto resta grezzo e visibile per la finestra di
                // assestamento (K01) e poi viene sostituito in UN frame
                // (K02/K03) dal piano del modulo ink_commit (M02).
                // Nessun ghost, nessun hold-still (N02/N03/N06).
                commitStroke(o);
                // R24: evidenza console a OGNI rilascio di un tratto
                ink24Log();
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
        // R31 (PROMPT R29): nessun flag shaping (M01). Il motore
        // ink-commit e' sempre attivo con i parametri di ink_cfg.js;
        // ogni tratto ha il SUO pending di commit indipendente (K04).
        ed.inkPendings = [];
        ed.lastCommit = null;
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
        ed.btnUndo.title = 'Annulla (Ctrl+Z): rimuove l\'ultimo tratto '
            + 'perfezionato (asta + punta insieme se freccia)';
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
        // R31 (PROMPT R29): via "Fermo per snap" (hold-still eliminato,
        // N03) e via "Perfeziona al rilascio" (flag eliminato, M01):
        // il commit avviene SEMPRE al rilascio con la finestra di
        // assestamento di ink_cfg.js. La scrittura assistita (slider
        // sopra) resta invariata e agisce solo in fase live (M03).
        popHelp.appendChild(App.el('div', 'fn-hint',
            'La scrittura assistita resta fluida mentre disegni; al '
            + 'rilascio ogni tratto viene perfezionato all\'istante '
            + '(linee, archi, frecce) senza ghost ne maniglie.'));
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
        // R31: stop dei commit in finestra (buildPayload/flush ha gia'
        // materializzato i pendings prima del salvataggio — M05)
        if (st.liveTick) { clearInterval(st.liveTick); st.liveTick = null; }
        if (st.inkPendings) {
            st.inkPendings.forEach(e => { if (e.timer) clearTimeout(e.timer); });
            st.inkPendings.length = 0;
        }
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
