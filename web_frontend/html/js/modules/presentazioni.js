/* ============================================================
   modules/presentazioni.js — sub-tool Presentazioni
   kind: 'presentazione'
   Editor slide 16:9 (960×540 scalata) — UI ristrutturata:
   - Vista elenco: barra unica 46px, griglia card con miniatura
     REALE 16:9 della prima slide, azioni al hover, empty state
   - Editor: barra unica46px [← Elenco][undo/redo] | titolo+badge |
     [testo/immagine/video/audio/forme ▾] | (slide: layout/sfondo/transizione SOLO in Proprietà)
     | [zoom] || [Presenta][Export ▾][…]
   - Filmstrip 150px collassabile (linguetta verticale "Filmstrip")
   - Canvas zoom-to-fit con 8 maniglie + rotazione + guide magenta
   - Inspector 260px collassabile (linguetta "Proprietà")
   - Presenta: fullscreen con × che sfuma dopo 2s + contatore n/m
   Logica INTACTA: autosave scheduleSave/flush+badge, undo/redo
   snapshot, export JSON/HTML/Stampa, miniature render, drag-reorder
   slide, maniglie, guide, inspector, presentazione. Tutto locale.
   ============================================================ */
(function () {
    'use strict';

    const SW = 960, SH = 540;
    const MINI = 0.12;           // scala miniature filmstrip (task 1.1)
    const GUIDE_TOL = 4;         // soglia guide in px SCHERMO (task 1.3)
    const UNDO_MAX = 50;         // snapshot undo/redo (task 1.5)
    const UNDO_COALESCE = 600;   // ms: raggruppa modifiche ravvicinate

    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/><path d="M6 8h6M6 12h8"/></svg>';
    const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

    // ---------- icone SVG (16-18px via CSS, title = tooltip) ----------
    function ic(body) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
    }
    const IC = {
        back: ic('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
        undo: ic('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
        redo: ic('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
        plus: ic('<path d="M12 5v14M5 12h14"/>'),
        copy: ic('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
        trash: ic('<path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
        pencil: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
        open: ic('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>'),
        text: ic('<path d="M4 7V5h16v2M12 5v14M9 19h6"/>'),
        image: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-6 6-3-3-4 4"/>'),
        video: ic('<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m22 8-6 4 6 4z"/>'),
        audio: ic('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
        rect: ic('<rect x="3" y="5" width="18" height="14" rx="2"/>'),
        circle: ic('<circle cx="12" cy="12" r="9"/>'),
        arrow: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
        palette: ic('<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1.3-1-1.6-1-2.5 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z"/><circle cx="7.5" cy="11.5" r="1.1"/><circle cx="10.5" cy="7.5" r="1.1"/><circle cx="15.5" cy="8" r="1.1"/>'),
        layout: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
        zout: ic('<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-3.6-3.6"/>'),
        zin: ic('<circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-3.6-3.6"/>'),
        play: ic('<polygon points="6 4 20 12 6 20 6 4"/>'),
        dl: ic('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
        chevL: ic('<path d="m14 6-6 6 6 6"/>'),
        chevR: ic('<path d="m10 6 6 6-6 6"/>'),
        dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>'
    };

    // ---------- stile (chrome scuro + superfici carta, barra unica46px) ----------
    App.style([
        // ==== barra superiore UNICA (46px, always una riga) ====
        '.pp-bar{height:46px;flex:0 0 46px;display:flex;flex-wrap:nowrap;align-items:center;gap:6px;padding:0 8px;background:#161a2a;border:1px solid rgba(255,255,255,.09);border-radius:10px;box-sizing:border-box;overflow:hidden;min-width:0}',
        '.pp-tb{width:30px;height:30px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;padding:0;background:#1a2030;border:1px solid rgba(255,255,255,.09);border-radius:8px;color:#e9edf5;cursor:pointer;position:relative;font-family:inherit}',
        '.pp-tb:hover{border-color:#f9974a;color:#fff}',
        '.pp-tb:disabled{opacity:.35;cursor:default}',
        '.pp-tb:disabled:hover{border-color:rgba(255,255,255,.09);color:#e9edf5}',
        '.pp-tb svg{width:17px;height:17px;flex-shrink:0}',
        '.pp-tb-wide{width:auto;min-width:30px;padding:0 9px;gap:6px;font-size:12.5px;font-weight:700;white-space:nowrap}',
        '.pp-tb-accent{background:#f9974a;border-color:#f9974a;color:#161a2a}',
        '.pp-tb-accent:hover{background:#ffab66;border-color:#ffab66;color:#161a2a}',
        '.pp-sep{width:1px;height:22px;flex:0 0 1px;background:rgba(255,255,255,.14);margin:0 2px}',
        '.pp-spacer{flex:1;min-width:0}',
        '.pp-grp{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}',
        // titolo inline + badge autosave
        '.pp-title-inp{height:30px;flex:0 1 190px;min-width:90px;max-width:280px;background:transparent;border:1px solid transparent;border-radius:8px;color:#e9edf5;font-size:14px;font-weight:800;font-family:inherit;padding:0 8px;outline:none;box-sizing:border-box}',
        '.pp-title-inp:hover{border-color:rgba(255,255,255,.16)}',
        '.pp-title-inp:focus{border-color:#f9974a;background:#1a2030}',
        '.pp-save{font-size:11px;font-weight:700;color:#8b95a5;background:#1a2030;border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:3px 9px;white-space:nowrap;flex:0 0 auto}',
        '.pp-save.pending{color:#f9974a;border-color:rgba(249,151,74,.55)}',
        '.pp-save.ok{color:#7fd3a0;border-color:rgba(127,211,160,.35)}',
        // select / ricerca in barra
        '.pp-sel{height:30px;flex:0 0 auto;max-width:124px;border-radius:8px;border:1px solid rgba(255,255,255,.09);background:#1a2030;color:#e9edf5;font-size:12px;padding:0 5px;font-family:inherit;cursor:pointer;outline:none}',
        '.pp-sel:hover,.pp-sel:focus{border-color:#f9974a}',
        '.pp-search{height:30px;flex:0 1 170px;min-width:90px;background:#1a2030;border:1px solid rgba(255,255,255,.09);border-radius:8px;color:#e9edf5;font-size:12.5px;padding:0 9px;font-family:inherit;outline:none;box-sizing:border-box}',
        '.pp-search::placeholder{color:#6f7891}',
        '.pp-search:focus{border-color:#f9974a}',
        '.pp-view-title{font-size:15px;font-weight:800;color:#e9edf5;white-space:nowrap;margin:0 4px 0 6px;flex:0 0 auto}',
        // swatch sfondo in barra
        '.pp-bg-lab{width:30px;height:30px;flex:0 0 30px;position:relative;display:inline-flex;align-items:center;justify-content:center;background:#1a2030;border:1px solid rgba(255,255,255,.09);border-radius:8px;cursor:pointer;overflow:hidden}',
        '.pp-bg-lab:hover{border-color:#f9974a}',
        '.pp-bg-lab input[type="color"]{width:22px;height:20px;padding:0;border:none;background:none;cursor:pointer}',
        // zoom
        '.pp-zoom-lbl{min-width:44px;height:30px;line-height:28px;text-align:center;font-size:11.5px;font-weight:800;color:#8b95a5;background:#1a2030;border:1px solid rgba(255,255,255,.09);border-radius:8px;cursor:pointer;font-family:inherit;padding:0 4px}',
        '.pp-zoom-lbl:hover{border-color:#f9974a;color:#fff}',
        // menu a tendina (Export, forme, overflow "…")
        '.pp-menu-wrap{position:relative;display:inline-flex;flex:0 0 auto}',
        '.pp-menu{position:fixed;background:#1a2030;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:5px;display:flex;flex-direction:column;gap:4px;min-width:178px;max-height:70vh;overflow-y:auto;z-index:460;box-shadow:0 14px 34px rgba(0,0,0,.5)}',
        '.pp-menu button{display:flex;align-items:center;gap:8px;background:none;border:none;color:#e9edf5;font-size:12.5px;padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left;font-family:inherit;width:100%}',
        '.pp-menu button:hover{background:#f9974a;color:#161a2a}',
        '.pp-menu button svg{width:15px;height:15px;flex-shrink:0}',
        '.pp-menu>.pp-tb{width:100%;height:32px;justify-content:flex-start;padding:0 10px;gap:8px;background:#202637}',
        '.pp-menu>.pp-tb-wide{justify-content:flex-start}',
        '.pp-menu>select.pp-sel{width:100%;max-width:none;height:32px}',
        '.pp-menu>.pp-grp{width:100%}',
        '.pp-menu>.pp-zoom-lbl{width:100%}',
        '.pp-menu>.pp-sep,.pp-menu>.pp-spacer{display:none!important}',
        '.pp-menu>label.pp-bg-lab{width:100%;height:32px}',
        '.pp-menu::-webkit-scrollbar{width:8px}',
        '.pp-menu::-webkit-scrollbar-thumb{background:#2c3346;border-radius:8px}',
        // ==== vista: flex column [bar46][contenuto flex:1][status26] ====
        '.pp-view{height:100%;min-height:0;display:flex;flex-direction:column;gap:8px;box-sizing:border-box}',
        '.pp-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:2px}',
        '.pp-status{height:26px;flex:0 0 26px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#161a2a;border:1px solid rgba(255,255,255,.09);border-radius:8px;box-sizing:border-box;font-size:11.5px;color:#8b95a5;overflow:hidden;white-space:nowrap;flex-shrink:0}',
        '.pp-st-part{flex:0 0 auto;font-weight:700}',
        '.pp-st-hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:#6f7891;font-weight:600}',
        // ==== 1A elenco: griglia card con miniatura reale16:9 ====
        '.pp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;align-content:start}',
        '.pp-card{position:relative;background:#f7f5ef;border:1px solid rgba(0,0,0,.10);border-radius:10px;overflow:hidden;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.30);color:#141824;transition:box-shadow .15s,border-color .15s}',
        '.pp-card:hover{border-color:#f9974a;box-shadow:0 12px 28px rgba(0,0,0,.42)}',
        '.pp-card:focus{outline:2px solid #f9974a;outline-offset:1px}',
        '.pp-card-thumb{position:relative;width:100%;aspect-ratio:16/9;background:#fff;overflow:hidden;border-bottom:1px solid rgba(0,0,0,.10)}',
        '.pp-card-thumb .pp-thumb-canvas{position:absolute;left:0;top:0;transform-origin:top left;overflow:hidden}',
        '.pp-card-ov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(18,22,35,.55);opacity:0;transition:opacity .15s;pointer-events:none;z-index:2}',
        '.pp-card:hover .pp-card-ov,.pp-card:focus-within .pp-card-ov{opacity:1;pointer-events:auto}',
        '.pp-ov-btn{width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;background:#1a2030;border:1px solid rgba(255,255,255,.28);border-radius:8px;color:#e9edf5;cursor:pointer;padding:0}',
        '.pp-ov-btn:hover{background:#f9974a;border-color:#f9974a;color:#161a2a}',
        '.pp-ov-btn svg{width:16px;height:16px}',
        '.pp-card-body{padding:8px 10px 10px}',
        '.pp-card-name{font-size:13.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}',
        '.pp-card-meta{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11.5px;color:#6b7280}',
        // empty state: icona + istruzione + azione
        '.pp-empty{min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px 16px;color:#8b95a5}',
        '.pp-empty-ic{width:52px;height:52px;color:#f9974a}',
        '.pp-empty-ic svg{width:52px;height:52px}',
        '.pp-empty .msg{font-size:13.5px;line-height:1.55;max-width:440px;color:#9aa3b5}',
        // ==== editore: [linguetta][filmstrip150][canvas][inspector260][linguetta] ====
        '.pp-edit{flex:1;min-height:0;display:flex;gap:8px}',
        '.pp-tab{width:32px;flex:0 0 32px;align-self:stretch;display:flex;align-items:center;justify-content:center;background:#161a2a;border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#8b95a5;cursor:pointer;padding:0;font-family:inherit}',
        '.pp-tab:hover{border-color:#f9974a;color:#f9974a}',
        '.pp-tab span{writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;white-space:nowrap}',
        // filmstrip (superficie carta)
        '.pp-film{width:150px;flex:0 0 150px;box-sizing:border-box;background:#f7f5ef;border:1px solid rgba(0,0,0,.10);border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.26);padding:8px;overflow-y:auto;overflow-x:hidden;min-height:0}',
        '.pp-pane-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8a8578}',
        '.pp-head-tools{display:inline-flex;gap:4px;align-items:center}',
        // filmstrip: miniature reali + drag&drop
        '.pp-slide-item{display:flex;flex-direction:column;gap:5px;padding:6px;border-radius:9px;cursor:pointer;border:1px solid rgba(0,0,0,.12);background:#fff;margin-bottom:8px;transition:border-color .12s,opacity .12s}',
        '.pp-slide-item:hover{border-color:rgba(249,151,74,.65)}',
        '.pp-slide-item.active{border-color:#f9974a;box-shadow:0 0 0 1px #f9974a}',
        '.pp-slide-item.dragging{opacity:.4;border-color:#f9974a}',
        '.pp-slide-item.drop-target{border-color:#f9974a;box-shadow:0 0 0 2px rgba(249,151,74,.75)}',
        '.pp-thumb{position:relative;aspect-ratio:16/9;background:#f7f5ef;border-radius:6px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.22);border:1px solid rgba(0,0,0,.15);align-self:center}',
        '.pp-thumb-canvas{position:absolute;left:0;top:0;transform-origin:top left;overflow:hidden}',
        '.pp-thumb-item{position:absolute;box-sizing:border-box;overflow:hidden}',
        '.pp-thumb-item img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}',
        '.pp-thumb-item>svg{width:100%;height:100%;display:block;overflow:visible}',
        '.pp-item-row{display:flex;align-items:center;gap:4px;min-height:20px}',
        '.pp-num{font-size:11px;font-weight:800;color:#9ca3af;width:14px;text-align:center;flex-shrink:0}',
        '.pp-slide-item.active .pp-num{color:#f9974a}',
        '.pp-nm{flex:1;font-size:10.5px;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pp-mini-btn{width:21px;height:20px;display:inline-flex;align-items:center;justify-content:center;background:#f0ede4;border:1px solid rgba(0,0,0,.14);border-radius:5px;color:#6b7280;cursor:pointer;padding:0;flex-shrink:0;opacity:.55;transition:opacity .12s}',
        '.pp-slide-item:hover .pp-mini-btn{opacity:1}',
        '.pp-mini-btn:hover{color:#f9974a;border-color:#f9974a}',
        '.pp-mini-btn svg{width:12px;height:12px}',
        '.pp-mini{background:#fff;border:1px solid rgba(0,0,0,.16);color:#4b5563;border-radius:6px;height:22px;min-width:24px;font-size:12px;cursor:pointer;line-height:1;padding:0 6px;font-family:inherit;font-weight:800;display:inline-flex;align-items:center;justify-content:center}',
        '.pp-mini:hover{color:#f9974a;border-color:#f9974a}',
        '.pp-mini svg{width:12px;height:12px}',
        // centro: canvas zoom-to-fit (padding 12px, tutta l'altezza)
        '.pp-canvas{flex:1;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:#1a2030;border:1px solid rgba(255,255,255,.09);border-radius:10px;overflow:auto}',
        '.pp-stage-wrap{position:relative;margin:auto;flex:0 0 auto}',
        '.pp-stage{position:absolute;top:0;left:0;width:960px;height:540px;transform-origin:top left;overflow:hidden;background:#f7f5ef;border-radius:9px;box-shadow:0 12px 34px rgba(0,0,0,.45);user-select:none}',
        '.pp-el{position:absolute;box-sizing:border-box}',
        '.pp-el.sel{outline:2px solid #f9974a;outline-offset:1px}',
        '.pp-txt{width:100%;height:100%;overflow:hidden;word-break:break-word;white-space:pre-wrap;outline:none;line-height:1.3}',
        '.pp-el img,.pp-el video{width:100%;height:100%;object-fit:contain;display:block;background:rgba(0,0,0,.06);pointer-events:none}',
        '.pp-el audio{width:100%}',
        '.pp-el.pp-arrow svg{width:100%;height:100%;display:block;overflow:visible}',
        // 8 maniglie + rotazione (selezione)
        '.pp-h{position:absolute;width:8px;height:8px;background:#fff;border:1.5px solid #233047;border-radius:2px;box-sizing:border-box;z-index:8;display:none}',
        '.pp-el.sel .pp-h{display:block}',
        '.pp-h-nw{left:-5px;top:-5px;cursor:nwse-resize}',
        '.pp-h-n{left:50%;top:-5px;margin-left:-4px;cursor:ns-resize}',
        '.pp-h-ne{right:-5px;top:-5px;cursor:nesw-resize}',
        '.pp-h-e{right:-5px;top:50%;margin-top:-4px;cursor:ew-resize}',
        '.pp-h-se{right:-5px;bottom:-5px;cursor:nwse-resize}',
        '.pp-h-s{left:50%;bottom:-5px;margin-left:-4px;cursor:ns-resize}',
        '.pp-h-sw{left:-5px;bottom:-5px;cursor:nesw-resize}',
        '.pp-h-w{left:-5px;top:50%;margin-top:-4px;cursor:ew-resize}',
        '.pp-rot{position:absolute;left:50%;top:-19px;margin-left:-6px;width:12px;height:12px;background:#fff;border:1.5px solid #233047;border-radius:50%;cursor:grab;z-index:9;display:none;box-sizing:border-box}',
        '.pp-el.sel .pp-rot{display:block}',
        '.pp-rot::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);width:2px;height:6px;background:#f9974a}',
        // guide allineamento magenta
        '.pp-guides{position:absolute;left:0;top:0;pointer-events:none;z-index:40}',
        '.pp-guide{position:absolute;background:#ff2d95;pointer-events:none;z-index:41}',
        // ==== 1D inspector destro260px collassabile (superficie carta) ====
        '.pp-insp{width:260px;flex:0 0 260px;box-sizing:border-box;display:flex;flex-direction:column;background:#f7f5ef;border:1px solid rgba(0,0,0,.10);border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.26);padding:10px;overflow-y:auto;min-height:0;font-size:12.5px;color:#141824}',
        '.pp-props-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px}',
        '.pp-props-title{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#8a8578}',
        '.pp-sec{display:flex;flex-direction:column;gap:6px}',
        '.pp-sec+.pp-sec{border-top:1px solid rgba(0,0,0,.10);padding-top:10px;margin-top:2px}',
        '.pp-sec .lab{font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#8a8578}',
        '.pp-sublab{font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#a09a8b;margin-top:4px}',
        '.pp-row{display:flex;align-items:center;gap:6px;min-height:26px}',
        '.pp-row>label{width:76px;flex-shrink:0;font-size:11.5px;color:#6b7280}',
        '.pp-row input[type="number"]{width:58px;background:#fff;border:1px solid #d9d4c6;border-radius:6px;color:#141824;padding:4px 6px;font-size:12px;outline:none;font-family:inherit}',
        '.pp-row input[type="number"]:focus{border-color:#f9974a}',
        '.pp-row input[type="color"]{width:36px;height:26px;padding:1px;background:#fff;border:1px solid #d9d4c6;border-radius:6px;cursor:pointer}',
        '.pp-row select{flex:1;min-width:0;background:#fff;border:1px solid #d9d4c6;border-radius:6px;color:#141824;padding:4px 6px;font-size:12px;outline:none;font-family:inherit}',
        '.pp-row select:focus{border-color:#f9974a}',
        '.pp-row input[type="range"]{flex:1;min-width:0;accent-color:#f9974a}',
        '.pp-row .rng-val{width:34px;text-align:right;font-size:11.5px;color:#6b7280}',
        '.pp-seg{display:inline-flex;gap:4px}',
        '.pp-seg button{width:28px;height:26px;display:inline-flex;align-items:center;justify-content:center;background:#fff;border:1px solid #d9d4c6;border-radius:6px;color:#141824;cursor:pointer;font-size:12px;font-weight:800;font-family:inherit;padding:0}',
        '.pp-seg button:hover{border-color:#f9974a}',
        '.pp-seg button.active{background:#f9974a;color:#161a2a;border-color:#f9974a}',
        '.pp-hint{font-size:11.5px;line-height:1.5;color:#6b7280}',
        '.pp-danger{margin-top:6px;justify-content:center;background:#fff!important;border-color:rgba(224,82,82,.65)!important;color:#c0392b!important}',
        '.pp-danger:hover{background:#fdeaea!important;border-color:#e05252!important;color:#a5281b!important}',
        // presentazione + transizioni
        '.pp-present{position:fixed;inset:0;background:#000;z-index:400;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer}',
        '.pp-present .holder{position:relative}',
        '.pp-anim-fade{opacity:0}',
        '.pp-anim-fade.pp-run{opacity:1;transition:opacity .3s ease}',
        '.pp-anim-slide{transform:translateX(100%)}',
        '.pp-anim-slide.pp-run{transform:translateX(0);transition:transform .3s ease}',
        '.pp-anim-back{transform:translateX(-100%)}',
        '.pp-present-top{position:fixed;top:12px;right:14px;display:flex;align-items:center;gap:10px;z-index:403}',
        '.pp-present-count{color:rgba(255,255,255,.85);font-size:13.5px;font-weight:800;letter-spacing:.6px;text-shadow:0 1px 4px rgba(0,0,0,.75);font-family:inherit}',
        '.pp-present-close{width:36px;height:36px;min-width:36px;display:inline-flex;align-items:center;justify-content:center;background:rgba(18,22,35,.6);border:1px solid rgba(255,255,255,.3);border-radius:50%;color:#fff;font-size:20px;line-height:1;cursor:pointer;opacity:0;transition:opacity .3s;padding:0;font-family:inherit}',
        '.pp-present-close:hover{background:#f9974a;border-color:#f9974a;color:#161a2a}',
        '.pp-present-nav{position:fixed;bottom:14px;right:16px;display:flex;gap:8px;z-index:401;align-items:center}',
        '.pp-present-hint{position:fixed;bottom:18px;left:18px;color:rgba(255,255,255,.45);font-size:12px;z-index:401;font-family:inherit}',
        // scrollbar webkit sottili scure
        '.pp-view ::-webkit-scrollbar{width:8px;height:8px}',
        '.pp-view ::-webkit-scrollbar-track{background:rgba(0,0,0,.16)}',
        '.pp-view ::-webkit-scrollbar-thumb{background:#2c3346;border-radius:8px}',
        '.pp-view ::-webkit-scrollbar-thumb:hover{background:#f9974a}',
        '@media print{body *{visibility:hidden !important}.pp-print-area,.pp-print-area *{visibility:visible !important}.pp-print-area{position:absolute !important;left:0 !important;top:0 !important;width:100% !important}}'
    ].join(''));

    let root = null;        // contenitore body del tool
    let st = null;          // stato editor
    let saveTimer = null;
    let overlay = null;     // overlay presentazione
    let keyHandler = null;  // handler globale tastiera editor (Ctrl+Z/Y, frecce, Canc)
    let expMenu = null;     // menu Export
    let docClick = null;
    let smallMenu = null, smallMenuBtn = null, smallMenuDoc = null;   // menu forme "▾"
    let barOvf = null, barMenu = null, barMenuDoc = null;             // overflow "…" barra
    let listData = [], listQ = '', listOrd = 'nome';
    let listBody = null, listStatus = null, listResizer = null;

    const uid = function () { return StudyStore.uuid(); };
    const ask = function (title, value) {
        if (typeof window.StudyAsk === 'function') return window.StudyAsk(title, value);
        return Promise.resolve(prompt(title, value == null ? '' : String(value)));
    };

    function mediaUrl(src) {
        if (!src) return '';
        if (/^(data:|blob:|https?:|file:)/i.test(src)) return src;
        return StudyStore.assetUrl(src);
    }

    function download(text, name, mime) {
        const blob = new Blob([text], { type: mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
    }

    function fileToDataUrl(accept) {
        return new Promise(function (res) {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = accept;
            inp.addEventListener('change', function () {
                const f = inp.files && inp.files[0];
                if (!f) { res(null); return; }
                const r = new FileReader();
                r.onload = function () { res(r.result); };
                r.onerror = function () { res(null); };
                r.readAsDataURL(f);
            });
            inp.click();
        });
    }

    // pick dal filesystem (backend) oppure file input locale → src
    async function pickMedia(kind) {
        let a = null;
        try { a = await StudyStore.pickAsset(); } catch (e) { a = null; }
        if (a && a.path) return a.path;
        const accept = kind === 'image' ? 'image/*' : (kind === 'video' ? 'video/*' : 'audio/*');
        return await fileToDataUrl(accept);
    }

    // ---------- modello ----------
    function newSlide() { return { id: uid(), bg: '#f7f5ef', elements: [], transition: 'none', layout: '' }; }

    function normalizeData(d) {
        if (!d || !Array.isArray(d.slides) || !d.slides.length) d = { slides: [newSlide()] };
        d.slides.forEach(function (s) {
            if (!s.id) s.id = uid();
            if (!Array.isArray(s.elements)) s.elements = [];
            if (s.bg == null) s.bg = '#f7f5ef';
            if (!s.transition) s.transition = 'none';
            if (s.layout == null) s.layout = '';
            s.elements.forEach(function (e) { if (!e.id) e.id = uid(); });
        });
        return d;
    }

    function parseContent(item) {
        let d = null;
        try { d = JSON.parse(item.content || '{}'); } catch (e) { d = null; }
        return normalizeData(d);
    }

    // ---------- badge autosave ----------
    function nowHM() {
        const d = new Date();
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }
    function setBadge(mode, time) {
        if (!st || !st.badge) return;
        const b = st.badge;
        b.className = 'pp-save' + (mode === 'pending' ? ' pending' : (mode === 'saved' ? ' ok' : ''));
        if (mode === 'pending') b.textContent = 'Salvataggio…';
        else if (mode === 'saved') b.textContent = 'Salvato ✓' + (time ? ' · ' + time : '');
        else b.textContent = 'Salvataggio non riuscito';
    }

    // ---------- undo/redo: snapshot JSON di st.data (max 50) ----------
    // chiamato da scheduleSave PRIMA di ogni persistenza: conserva lo stato
    // precedente alla modifica (aggiunta/elimina/modifica elemento, riordino,
    // cambio bg, layout, transizione…). Le modifiche ravvicinate (<600ms)
    // vengono raggruppate in un solo passo di undo.
    function syncUndo() {
        if (!st) return;
        const snap = JSON.stringify(st.data);
        if (st.snap == null) { st.snap = snap; return; }
        if (st.snap === snap) return;
        const now = Date.now();
        const canPush = !st.undoStack.length || (now - (st.lastPush || 0)) >= UNDO_COALESCE;
        if (canPush) {
            st.undoStack.push(st.snap);
            if (st.undoStack.length > UNDO_MAX) st.undoStack.shift();
            st.redoStack.length = 0;
            st.lastPush = now;
            updateUndoUI();
        }
        st.snap = snap;
    }
    function updateUndoUI() {
        if (!st) return;
        if (st.btnUndo) st.btnUndo.disabled = !st.undoStack.length;
        if (st.btnRedo) st.btnRedo.disabled = !st.redoStack.length;
    }
    function restoreSnapshot(json) {
        st.data = normalizeData(JSON.parse(json));
        st.snap = JSON.stringify(st.data);
        st.lastPush = Date.now();
        if (st.cur >= st.data.slides.length) st.cur = st.data.slides.length - 1;
        if (st.cur < 0) st.cur = 0;
        if (!curEl()) st.sel = null;
        renderSlidesPane(); renderStage(); renderProps(); updateUndoUI(); updateStatus();
        scheduleSave();
    }
    function undoEdit() {
        if (!st || !st.undoStack.length) return;
        st.redoStack.push(JSON.stringify(st.data));
        if (st.redoStack.length > UNDO_MAX) st.redoStack.shift();
        restoreSnapshot(st.undoStack.pop());
    }
    function redoEdit() {
        if (!st || !st.redoStack.length) return;
        st.undoStack.push(JSON.stringify(st.data));
        if (st.undoStack.length > UNDO_MAX) st.undoStack.shift();
        restoreSnapshot(st.redoStack.pop());
    }

    // ---------- salvataggio (debounce 900ms — NON rimuovere) ----------
    function scheduleSave() {
        if (!st) return;
        syncUndo();
        st.dirty = true;
        setBadge('pending');
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 900);
    }
    async function flush() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (!st || !st.id) return;
        try {
            await StudyStore.saveItem({
                id: st.id, kind: 'presentazione', title: st.title,
                content: JSON.stringify(st.data)
            });
            st.dirty = false;
            setBadge('saved', nowHM());
        } catch (e) {
            console.error('Salvataggio presentazione:', e);
            setBadge('error');
        }
    }

    function detachWin() {
        if (st && st.onResize) { window.removeEventListener('resize', st.onResize); st.onResize = null; }
    }
    function detachKeys() {
        if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    }
    function attachKeys() {
        if (keyHandler) return;
        keyHandler = onEditorKey;
        document.addEventListener('keydown', keyHandler);
    }
    function closeExpMenu() {
        if (docClick) { document.removeEventListener('click', docClick); docClick = null; }
        if (expMenu) { expMenu.remove(); expMenu = null; }
    }
    function closeSmallMenu() {
        if (smallMenuDoc) { document.removeEventListener('click', smallMenuDoc); smallMenuDoc = null; }
        if (smallMenu) { smallMenu.remove(); smallMenu = null; }
        smallMenuBtn = null;
    }
    // menu generico a tendina (forme ▾): items = [[label, title, fn, svg]]
    function openSmallMenu(btn, items) {
        const wasOpen = !!smallMenu;
        const sameBtn = smallMenuBtn === btn;
        closeSmallMenu();
        if (wasOpen && sameBtn) return;
        smallMenu = App.el('div', 'pp-menu');
        smallMenuBtn = btn;
        items.forEach(function (it) {
            const b = App.el('button');
            b.type = 'button';
            b.title = it[1];
            b.innerHTML = (it[3] || '') + '<span></span>';
            b.querySelector('span').textContent = it[0];
            b.addEventListener('click', function () { closeSmallMenu(); it[2](); });
            smallMenu.appendChild(b);
        });
        document.body.appendChild(smallMenu);
        const r = btn.getBoundingClientRect();
        smallMenu.style.top = (r.bottom + 6) + 'px';
        const mw = smallMenu.offsetWidth || 178;
        smallMenu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left)) + 'px';
        smallMenuDoc = function (e) {
            if (smallMenu && !smallMenu.contains(e.target) && !btn.contains(e.target)) closeSmallMenu();
        };
        setTimeout(function () { document.addEventListener('click', smallMenuDoc); }, 0);
    }

    // ---------- overflow barra "…" (secondary nascosti, una riga ≥1280px) ----------
    function wireBarOverflow(bar, more) {
        closeBarMenu();
        barOvf = { bar: bar, more: more, hidden: [] };
    }
    function closeBarMenu() {
        if (barMenuDoc) { document.removeEventListener('click', barMenuDoc); barMenuDoc = null; }
        if (barMenu && barOvf) {
            barOvf.hidden.forEach(function (node) {
                node.style.display = 'none';
                if (node._ph && node._ph.parentNode) {
                    node._ph.parentNode.insertBefore(node, node._ph);
                    node._ph.remove();
                    node._ph = null;
                }
            });
        }
        if (barMenu) { barMenu.remove(); barMenu = null; }
        if (barOvf) barOvf.hidden = barOvf.hidden || [];
    }
    function toggleBarMenu() {
        if (!barOvf || !barOvf.bar || !barOvf.bar.isConnected) return;
        if (barMenu) { closeBarMenu(); return; }
        if (!barOvf.hidden.length) return;
        barMenu = App.el('div', 'pp-menu');
        barOvf.hidden.forEach(function (node) {
            const ph = App.el('i');
            ph.style.display = 'none';
            barOvf.bar.insertBefore(ph, node);
            node._ph = ph;
            node.style.display = '';
            barMenu.appendChild(node);
        });
        document.body.appendChild(barMenu);
        const r = barOvf.more.getBoundingClientRect();
        barMenu.style.top = (r.bottom + 6) + 'px';
        const mw = barMenu.offsetWidth || 178;
        barMenu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
        barMenu.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('button')) setTimeout(closeBarMenu, 0);
        });
        barMenuDoc = function (e) {
            if (barMenu && !barMenu.contains(e.target) && !barOvf.more.contains(e.target)) closeBarMenu();
        };
        setTimeout(function () { document.addEventListener('click', barMenuDoc); }, 0);
    }
    // Nasconde i secondari (data-ovf="1") finché la barra sta in una riga.
    function applyBarOverflow() {
        if (!barOvf || !barOvf.bar || !barOvf.bar.isConnected) return;
        closeBarMenu();
        const bar = barOvf.bar, more = barOvf.more;
        bar.querySelectorAll('[data-ovf]').forEach(function (n) { n.style.display = ''; });
        bar.querySelectorAll('.pp-sep').forEach(function (n) { n.style.display = ''; });
        more.style.display = 'none';
        const GAP = 6;
        const kids = Array.prototype.slice.call(bar.children);
        let total = 0;
        kids.forEach(function (k) { if (k !== more) total += (k.offsetWidth || 0) + GAP; });
        const avail = (bar.clientWidth || 0) - 16 + GAP;
        if (total <= avail) return;
        const hidden = [];
        kids.forEach(function (k) {
            if (k === more || k.dataset.ovf !== '1' || k.style.display === 'none') return;
            if (total <= avail) return;
            total -= ((k.offsetWidth || 0) + GAP);
            k.style.display = 'none';
            hidden.push(k);
        });
        // separatori orfani (prima/dopo tutti nascosti)
        bar.querySelectorAll('.pp-sep').forEach(function (sp) {
            if (sp.style.display === 'none') return;
            let before = false, n = sp.previousSibling;
            while (n) {
                if (n.nodeType === 1 && n !== more && n.style.display !== 'none' && !n.classList.contains('pp-sep')) { before = true; break; }
                n = n.previousSibling;
            }
            let after = false;
            n = sp.nextSibling;
            while (n) {
                if (n.nodeType === 1 && n !== more && n.style.display !== 'none' && !n.classList.contains('pp-sep')) { after = true; break; }
                n = n.nextSibling;
            }
            if (!before || !after) sp.style.display = 'none';
        });
        barOvf.hidden = hidden;
        if (hidden.length) more.style.display = '';
    }

    // ---------- LISTA (1A) ----------
    function fitListThumbs() {
        if (!listBody) return;
        listBody.querySelectorAll('.pp-card-thumb').forEach(function (t) {
            const cv = t.querySelector('.pp-thumb-canvas');
            if (!cv) return;
            const w = t.clientWidth || 240;
            cv.style.transform = 'scale(' + (w / SW) + ')';
        });
    }

    function emptyListState(forSearch) {
        const d = App.el('div', 'pp-empty');
        d.innerHTML = '<div class="pp-empty-ic">' + ICON + '</div>' +
            '<div class="msg">' + (forSearch
                ? 'Nessun risultato per la ricerca corrente: prova un altro termine oppure svuota il campo "Cerca…".'
                : 'Nessuna presentazione ancora: crea la tua prima slide 16:9 con testi, immagini e media locali.') + '</div>';
        const b = App.el('button', 'pp-tb pp-tb-wide pp-tb-accent');
        b.type = 'button';
        b.innerHTML = IC.plus + '<span>Nuova presentazione</span>';
        b.title = 'Crea una nuova presentazione';
        b.addEventListener('click', createNew);
        d.appendChild(b);
        return d;
    }

    function cardFor(it) {
        let n = 1;
        let first = null;
        try {
            const d = JSON.parse(it.content || '{}');
            if (d.slides && d.slides.length) n = d.slides.length;
            first = normalizeData(d).slides[0];
        } catch (e) { first = null; }
        const card = App.el('div', 'pp-card');
        card.tabIndex = 0;
        card.title = it.title || 'Senza titolo';

        // miniatura REALE16:9 della prima slide (riusa il render mini)
        const th = App.el('div', 'pp-card-thumb');
        if (first) {
            const cv = App.el('div', 'pp-thumb-canvas');
            cv.style.width = SW + 'px';
            cv.style.height = SH + 'px';
            cv.style.background = first.bg || '#f7f5ef';
            (first.elements || []).forEach(function (em) { cv.appendChild(miniEl(em)); });
            th.appendChild(cv);
        }
        // azioni al hover: apri, rinomina, duplica, elimina
        const ov = App.el('div', 'pp-card-ov');
        function ob(svg, title, fn) {
            const b = App.el('button', 'pp-ov-btn');
            b.type = 'button';
            b.title = title;
            b.innerHTML = svg;
            b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
            ov.appendChild(b);
        }
        ob(IC.open, 'Apri presentazione', function () { openEditor(root, it.id); });
        ob(IC.pencil, 'Rinomina', async function () {
            const t = await ask('Titolo presentazione', it.title);
            if (t == null) return;
            const nt = t.trim();
            if (!nt) return;
            await StudyStore.renameItem(it.id, nt);
            showList(root);
        });
        ob(IC.copy, 'Duplica', async function () {
            try { await StudyStore.duplicateItem(it.id); } catch (e) { console.error(e); }
            showList(root);
        });
        ob(IC.trash, 'Elimina', async function () {
            if (!confirm('Eliminare la presentazione "' + (it.title || '') + '"?')) return;
            await StudyStore.deleteItem(it.id);
            showList(root);
        });
        th.appendChild(ov);
        card.appendChild(th);

        const bd = App.el('div', 'pp-card-body');
        const nm = App.el('div', 'pp-card-name', App.esc(it.title || 'Senza titolo'));
        nm.title = it.title || 'Senza titolo';
        bd.appendChild(nm);
        const meta = App.el('div', 'pp-card-meta');
        const dt = App.el('span', null, App.esc(App.fmtDate(it.updated_at)));
        const cnt = App.el('span', null, n + ' slide');
        meta.appendChild(dt);
        meta.appendChild(cnt);
        bd.appendChild(meta);
        card.appendChild(bd);

        function openIt() { openEditor(root, it.id); }
        card.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.pp-card-ov')) return;
            openIt();
        });
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); openIt(); } });
        return card;
    }

    function renderList() {
        if (!listBody) return;
        listBody.innerHTML = '';
        const all = listData || [];
        let items = all.slice();
        const q = String(listQ || '').trim().toLowerCase();
        if (q) {
            items = items.filter(function (it) {
                return String(it.title || 'Senza titolo').toLowerCase().indexOf(q) >= 0;
            });
        }
        const ord = listOrd || 'nome';
        items.sort(function (a, b) {
            if (ord === 'nome') return String(a.title || '').localeCompare(String(b.title || ''), 'it');
            const ta = a.updated_at || a.created_at || '';
            const tb = b.updated_at || b.created_at || '';
            return ord === 'vecchi' ? String(ta).localeCompare(String(tb)) : String(tb).localeCompare(String(ta));
        });
        if (!all.length) listBody.appendChild(emptyListState(false));
        else if (!items.length) listBody.appendChild(emptyListState(true));
        else {
            const grid = App.el('div', 'pp-grid');
            items.forEach(function (it) { grid.appendChild(cardFor(it)); });
            listBody.appendChild(grid);
        }
        if (listStatus) {
            let txt;
            if (!all.length) txt = 'Nessuna presentazione · archivio locale';
            else if (items.length === all.length) txt = all.length + (all.length === 1 ? ' presentazione' : ' presentazioni');
            else txt = items.length + ' di ' + all.length + ' risultati';
            listStatus.textContent = txt + ' · salvataggio locale, nessun cloud';
        }
        requestAnimationFrame(fitListThumbs);
    }

    async function showList(container) {
        await flush();
        detachWin();
        detachKeys();
        closeExpMenu();
        closeSmallMenu();
        closePresent();
        closeFp();
        if (listResizer) { window.removeEventListener('resize', listResizer); listResizer = null; }
        st = null;
        root = container;
        container.innerHTML = '';
        container.style.height = '100%';
        container.style.overflow = 'hidden';

        const view = App.el('div', 'pp-view');
        container.appendChild(view);

        // --- barra unica46px ---
        const bar = App.el('div', 'pp-bar');
        const bHub = App.el('button', 'pp-tb pp-tb-wide');
        bHub.type = 'button';
        bHub.title = "Torna all'hub Produttività";
        bHub.innerHTML = IC.back + '<span>Produttività</span>';
        bHub.addEventListener('click', function () { App.go('produttivita'); });
        bar.appendChild(bHub);

        const bNew = App.el('button', 'pp-tb pp-tb-wide pp-tb-accent');
        bNew.type = 'button';
        bNew.title = 'Crea una nuova presentazione';
        bNew.innerHTML = IC.plus + '<span>Nuova presentazione</span>';
        bNew.addEventListener('click', createNew);
        bar.appendChild(bNew);

        bar.appendChild(App.el('span', 'pp-sep'));
        bar.appendChild(App.el('div', 'pp-view-title', 'Presentazioni'));
        bar.appendChild(App.el('span', 'pp-spacer'));

        const q = App.el('input', 'pp-search');
        q.type = 'search';
        q.placeholder = 'Cerca…';
        q.title = 'Cerca una presentazione per titolo';
        q.value = listQ || '';
        q.dataset.ovf = '1';
        q.addEventListener('input', function () { listQ = q.value; renderList(); });
        bar.appendChild(q);

        const sort = App.el('select', 'pp-sel');
        sort.title = 'Ordina elenco';
        sort.dataset.ovf = '1';
        sort.innerHTML = '<option value="" disabled>Ordina</option>' +
            '<option value="nome">Nome</option>' +
            '<option value="recenti">Data recente</option>' +
            '<option value="vecchi">Data antica</option>';
        sort.value = listOrd || 'nome';
        sort.addEventListener('change', function () { if (sort.value) { listOrd = sort.value; renderList(); } });
        bar.appendChild(sort);

        const more = App.el('button', 'pp-tb pp-more');
        more.type = 'button';
        more.title = 'Azioni secondarie (…)';
        more.innerHTML = IC.dots;
        more.style.display = 'none';
        more.addEventListener('click', function (e) { e.stopPropagation(); toggleBarMenu(); });
        bar.appendChild(more);
        view.appendChild(bar);
        wireBarOverflow(bar, more);

        const body = App.el('div', 'pp-list');
        view.appendChild(body);
        listBody = body;

        const status = App.el('div', 'pp-status');
        view.appendChild(status);
        listStatus = status;

        let items = [];
        try { items = await StudyStore.listItems('presentazione'); } catch (e) { console.error(e); }
        if (root !== container || !container.isConnected) return;
        listData = items || [];
        renderList();
        requestAnimationFrame(function () { fitListThumbs(); applyBarOverflow(); });
        listResizer = function () { fitListThumbs(); applyBarOverflow(); };
        window.addEventListener('resize', listResizer);
    }

    async function createNew() {
        const t = await ask('Titolo presentazione',
            'Presentazione senza titolo ' + new Date().toLocaleDateString('it-IT'));
        if (t == null) return;
        let item = null;
        try {
            item = await StudyStore.saveItem({
                kind: 'presentazione',
                title: t.trim() || 'Presentazione senza titolo',
                content: JSON.stringify({ slides: [newSlide()] })
            });
        } catch (e) { console.error(e); }
        if (item && item.id && root) openEditor(root, item.id);
        else if (root) showList(root);
    }

    // ---------- 1E barra unica editor:46px, gruppi separati, "…" ----------
    // ---------- H11: AI presentazioni (F10 outline / F11 bullet / F12 note) ----------
    function aiOutlineData(res) {
        const d = res && res.data;
        let arr = [];
        if (Array.isArray(d)) arr = d;
        else if (d && Array.isArray(d.outline)) arr = d.outline;
        else if (d && Array.isArray(d.sezioni)) arr = d.sezioni;
        else if (d && Array.isArray(d.items)) arr = d.items;
        return (arr || []).map(function (x) {
            if (typeof x === 'string') return { title: x, bullets: '' };
            if (x && typeof x === 'object') {
                const b = x.bullets || x.points || x.punti;
                return {
                    title: String(x.title || x.titolo || x.heading || x.name || ''),
                    bullets: Array.isArray(b) ? b.map(function (z) { return String(typeof z === 'string' ? z : (z && (z.text || z.title)) || ''); }).filter(Boolean).join('\n') : String(b || '')
                };
            }
            return { title: String(x == null ? '' : x), bullets: '' };
        }).filter(function (x) { return x.title || x.bullets; });
    }
    function aiMakeSlide(title, bullets) {
        const s = newSlide();
        const w = (typeof SW === 'number' ? SW - 160 : 1120);
        const h = (typeof SH === 'number' ? SH - 320 : 480);
        if (title) s.elements.push({ id: uid(), type: 'text', x: 80, y: 70, w: w, h: 130, text: String(title), fontSize: 42, bold: true, color: '#141824', align: 'left' });
        if (bullets) s.elements.push({ id: uid(), type: 'text', x: 80, y: 230, w: w, h: h, text: String(bullets), fontSize: 24, color: '#141824', align: 'left' });
        return s;
    }
    function aiPpText(res) {
        const d = res && res.data;
        if (typeof d === 'string') return d;
        if (d && typeof d === 'object') {
            const b = d.bullets || d.punti || d.points;
            if (Array.isArray(b)) return b.map(function (z) { return String(typeof z === 'string' ? z : (z && (z.text || z.title)) || ''); }).filter(Boolean).map(function (z) { return '- ' + z; }).join('\n');
        }
        return (window.AIService && window.AIService.previewText) ? window.AIService.previewText(res) : '';
    }
    async function aiOutline(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const inp = await AI.askInputs('Genera outline', [
            { name: 'argomento', label: 'Argomento della presentazione', placeholder: 'es. La Prima Guerra Mondiale' }
        ], 'Genera outline');
        if (!inp || !inp.argomento) return;
        const res = await AI.runFor(btn, 'F10', { argomento: inp.argomento, arg: inp.argomento });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const items = aiOutlineData(r);
            if (!items.length) { AI.toast('Nessuna slide nell outline'); return; }
            const prev = JSON.stringify(st.data);
            try {
                AI.withUndo(function () {
                    const empty = st.data.slides.length === 1 && !(st.data.slides[0].elements || []).length;
                    if (empty) st.data.slides = [];
                    items.forEach(function (it2) { st.data.slides.push(aiMakeSlide(it2.title, it2.bullets)); });
                    if (!st.data.slides.length) st.data.slides.push(newSlide());
                    st.cur = 0;
                    st.sel = null;
                    rerenderAll();
                    scheduleSave();
                }, function () {
                    try {
                        st.data = JSON.parse(prev);
                        if (st.cur >= st.data.slides.length) st.cur = st.data.slides.length - 1;
                        st.sel = null;
                        rerenderAll();
                        scheduleSave();
                    } catch (e) { /* ok */ }
                });
                AI.toast('Slide create da outline');
            } catch (e) { AI.toast('Creazione slide non riuscita'); }
        });
    }
    async function aiBullets(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const s = curSlide();
        if (!s) return;
        const ctx = (s.elements || []).map(function (em) { return em.text || ''; }).filter(Boolean).join('\n');
        const inp = await AI.askInputs('Genera bullet', [
            { name: 'indicazioni', label: 'Indicazioni (opzionale)', placeholder: 'es. punti chiave in 5 bullet' }
        ], 'Genera bullet');
        if (!inp) return;
        const res = await AI.runFor(btn, 'F11', { contenuto_slide: ctx, indicazioni: inp.indicazioni || '', t: (String(ctx).split('\n').filter(function (z) { return z.trim(); })[0] || 'Slide').trim(), o: ctx });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const txt = aiPpText(r);
            if (!txt) { AI.toast('Nessun bullet generato'); return; }
            const prev = JSON.stringify(st.data);
            try {
                AI.withUndo(function () {
                    const w = (typeof SW === 'number' ? SW - 160 : 1120);
                    s.elements.push({ id: uid(), type: 'text', x: 80, y: 300, w: w, h: (typeof SH === 'number' ? SH - 400 : 380), text: txt, fontSize: 22, color: '#141824', align: 'left' });
                    rerenderAll();
                    scheduleSave();
                }, function () {
                    try { st.data = JSON.parse(prev); rerenderAll(); scheduleSave(); } catch (e) { /* ok */ }
                });
            } catch (e) { AI.toast('Scrittura non riuscita'); }
        });
    }
    async function aiNotes(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const s = curSlide();
        if (!s) return;
        const ctx = (s.elements || []).map(function (em) { return em.text || ''; }).filter(Boolean).join('\n');
        const inp = await AI.askInputs('Note relatore', [
            { name: 'indicazioni', label: 'Indicazioni (opzionale)', placeholder: 'es. tono formale, 30 secondi' }
        ], 'Genera note');
        if (!inp) return;
        const res = await AI.runFor(btn, 'F12', { contenuto_slide: ctx, indicazioni: inp.indicazioni || '', t: (String(ctx).split('\n').filter(function (z) { return z.trim(); })[0] || 'Slide').trim() });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const txt = AI.previewText(r);
            if (!txt) return;
            const prev = JSON.stringify(st.data);
            try {
                AI.withUndo(function () {
                    s.notes = txt;
                    scheduleSave();
                }, function () {
                    try { st.data = JSON.parse(prev); scheduleSave(); } catch (e) { /* ok */ }
                });
                AI.toast('Note relatore salvate sulla slide');
            } catch (e) { AI.toast('Scrittura non riuscita'); }
        });
    }

    function buildToolbar() {
        const bar = App.el('div', 'pp-bar');
        function sep() { bar.appendChild(App.el('span', 'pp-sep')); }
        function tico(svg, title, fn, ovf) {
            const b = App.el('button', 'pp-tb');
            b.type = 'button';
            b.title = title || '';
            b.innerHTML = svg || '';
            if (ovf) b.dataset.ovf = '1';
            b.addEventListener('click', fn);
            bar.appendChild(b);
            return b;
        }
        function tlab(svg, label, title, fn, accent, ovf) {
            const b = App.el('button', 'pp-tb pp-tb-wide' + (accent ? ' pp-tb-accent' : ''));
            b.type = 'button';
            b.title = title || label;
            b.innerHTML = (svg || '') + '<span></span>';
            b.querySelector('span').textContent = label;
            if (ovf) b.dataset.ovf = '1';
            b.addEventListener('click', fn);
            bar.appendChild(b);
            return b;
        }

        // [← Elenco] [undo redo]
        tlab(IC.back, 'Elenco', "Torna all'elenco delle presentazioni", function () { showList(root); });
        st.btnUndo = tico(IC.undo, 'Annulla (Ctrl+Z)', undoEdit);
        st.btnRedo = tico(IC.redo, 'Ripristina (Ctrl+Y)', redoEdit);
        sep();

        // titolo input inline + badge autosave
        const ti = App.el('input', 'pp-title-inp');
        ti.type = 'text';
        ti.value = st.title;
        ti.title = 'Titolo presentazione (Invio per rinominare, Esc per annullare)';
        ti.setAttribute('aria-label', 'Titolo presentazione');
        ti.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); ti.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); ti.value = st.title; ti.blur(); }
        });
        ti.addEventListener('change', function () {
            const nt = String(ti.value || '').trim();
            if (!nt || nt === st.title) { ti.value = st.title; return; }
            st.title = nt;
            StudyStore.renameItem(st.id, st.title);
            scheduleSave();
        });
        bar.appendChild(ti);
        st.titleInp = ti;
        const badge = App.el('span', 'pp-save');
        badge.textContent = 'Salvato';
        bar.appendChild(badge);
        st.badge = badge;
        sep();

        // [testo, immagine, video, audio, forme ▾]
        tico(IC.text, 'Aggiungi un testo', function () { addElement('text'); });
        tico(IC.image, "Aggiungi un'immagine locale", function () { addElement('image'); });
        tico(IC.video, 'Aggiungi un video locale', function () { addElement('video'); }, true);
        tico(IC.audio, 'Aggiungi un audio locale', function () { addElement('audio'); }, true);
// ---- H11: AI presentazioni (menu: outline / bullet / note) ----
        const aiPp = tlab('', 'AI', 'Genera outline, bullet o note slide (AI)', function (e) {
            e.stopPropagation();
            openSmallMenu(aiPp, [
                ['Genera outline', 'Crea le slide dall argomento (AI: F10)', function () { aiOutline(aiPp); }],
                ['Genera bullet', 'Genera i bullet della slide corrente (AI: F11)', function () { aiBullets(aiPp); }],
                ['Note relatore', 'Genera le note relatore della slide (AI: F12)', function () { aiNotes(aiPp); }]
            ]);
        });
        const fb = App.el('button', 'pp-tb');
        fb.type = 'button';
        fb.title = 'Forme (rettangolo, cerchio, freccia)';
        fb.dataset.ovf = '1';
        fb.innerHTML = IC.rect;
        fb.addEventListener('click', function (e) {
            e.stopPropagation();
            openSmallMenu(fb, [
                ['Rettangolo', 'Forma: rettangolo', function () { addElement('shape', 'rect'); }, IC.rect],
                ['Cerchio', 'Forma: cerchio', function () { addElement('shape', 'circle'); }, IC.circle],
                ['Freccia', 'Freccia', function () { addElement('arrow'); }, IC.arrow]
            ]);
        });
        bar.appendChild(fb);
        // ---- R21 B3: pannello Fonti (FontiPanel montato on-demand, solo editor) ----
        st.fpBtn = tlab('', 'Fonti', 'Apri/chiudi il pannello Fonti', function () { toggleFpPanel(); });
        sep();

        // BLOCCO 3: layout/sfondo/transizione vivono SOLO nel pannello Proprietà (sezione Slide)
                // [zoom − % +] (secondario)
        const zg = App.el('span', 'pp-grp');
        zg.dataset.ovf = '1';
        const zOut = App.el('button', 'pp-tb');
        zOut.type = 'button';
        zOut.title = 'Riduci zoom';
        zOut.innerHTML = IC.zout;
        zOut.addEventListener('click', function () { setZoom(st.zoom - 0.1); });
        zg.appendChild(zOut);
        const zl = App.el('button', 'pp-zoom-lbl');
        zl.type = 'button';
        zl.title = 'Zoom: clicca per tornare al 100%';
        zl.textContent = '100%';
        zl.addEventListener('click', function () { setZoom(1); });
        zg.appendChild(zl);
        const zIn = App.el('button', 'pp-tb');
        zIn.type = 'button';
        zIn.title = 'Aumenta zoom';
        zIn.innerHTML = IC.zin;
        zIn.addEventListener('click', function () { setZoom(st.zoom + 0.1); });
        zg.appendChild(zIn);
        bar.appendChild(zg);
        st.zoomLbl = zl;
        sep();

        bar.appendChild(App.el('span', 'pp-spacer'));

        // a destra: Presenta + Export ▾ + overflow "…"
        tlab(IC.play, 'Presenta', 'Modalità presentazione (Esc per uscire)', present, true);
        const wrap = App.el('div', 'pp-menu-wrap');
        const exp = App.el('button', 'pp-tb pp-tb-wide');
        exp.type = 'button';
        exp.title = 'Esporta la presentazione';
        exp.innerHTML = IC.dl + '<span>Export ▾</span>';
        exp.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleExportMenu(exp);
        });
        wrap.appendChild(exp);
        bar.appendChild(wrap);

        const more = App.el('button', 'pp-tb pp-more');
        more.type = 'button';
        more.title = 'Azioni secondarie (…)';
        more.innerHTML = IC.dots;
        more.style.display = 'none';
        more.addEventListener('click', function (e) { e.stopPropagation(); toggleBarMenu(); });
        bar.appendChild(more);

        wireBarOverflow(bar, more);
        updateUndoUI();
        return bar;
    }

    function toggleExportMenu(btn) {
        if (expMenu) { closeExpMenu(); return; }
        expMenu = App.el('div', 'pp-menu');
        [
            ['JSON', 'Scarica il progetto in JSON', exportJSON],
            ['HTML', 'Presentazione HTML standalone', exportHtml],
            ['Stampa/PDF', 'Stampa le slide (salva come PDF)', printSlides]
        ].forEach(function (it) {
            const b = App.el('button');
            b.type = 'button';
            b.innerHTML = IC.dl + '<span></span>';
            b.querySelector('span').textContent = it[0];
            b.title = it[1];
            b.addEventListener('click', function () { closeExpMenu(); it[2](); });
            expMenu.appendChild(b);
        });
        document.body.appendChild(expMenu);
        const r = btn.getBoundingClientRect();
        expMenu.style.top = (r.bottom + 6) + 'px';
        const mw = expMenu.offsetWidth || 170;
        expMenu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
        docClick = function (e) {
            if (expMenu && !expMenu.contains(e.target)) closeExpMenu();
        };
        setTimeout(function () { document.addEventListener('click', docClick); }, 0);
    }

    // ---------- EDITOR (1B/1C/1D) ----------
    function sideTab(label, fn) {
        const t = App.el('button', 'pp-tab');
        t.type = 'button';
        t.title = 'Mostra/nascondi ' + label;
        t.innerHTML = '<span></span>';
        t.querySelector('span').textContent = label;
        t.addEventListener('click', fn);
        return t;
    }

    function togglePanel(which) {
        if (!st) return;
        if (which === 'film') {
            st.filmOpen = !st.filmOpen;
            st.film.style.display = st.filmOpen ? '' : 'none';
            st.filmTab.style.display = st.filmOpen ? 'none' : '';
        } else {
            st.inspOpen = !st.inspOpen;
            st.insp.style.display = st.inspOpen ? '' : 'none';
            st.inspTab.style.display = st.inspOpen ? 'none' : '';
        }
        fitStage();
    }

    async function openEditor(container, id) {
        const item = await StudyStore.getItem(id);
        if (!item) { showList(container); return; }
        detachWin();
        closeExpMenu();
        closeSmallMenu();
        closePresent();
        closeFp();
        if (listResizer) { window.removeEventListener('resize', listResizer); listResizer = null; }
        listBody = null;
        listStatus = null;
        root = container;
        st = {
            id: item.id,
            title: item.title || 'Presentazione senza titolo',
            data: parseContent(item),
            cur: 0, sel: null, scale: 1, zoom: 1,
            undoStack: [], redoStack: [], snap: null, lastPush: 0, dirty: false,
            stage: null, stageWrap: null, slidesPane: null, props: null,
            badge: null, btnUndo: null, btnRedo: null, zoomLbl: null,
            bgInp: null, propsBg: null, laySel: null, dragSid: null,
            titleInp: null, trSel: null, canvas: null, status: null,
            film: null, filmTab: null, filmOpen: true,
            insp: null, inspTab: null, inspOpen: true,
            view: null, fpPanel: null, fpBtn: null
        };
        st.snap = JSON.stringify(st.data);
        container.innerHTML = '';
        container.style.height = '100%';
        container.style.overflow = 'hidden';

        const view = App.el('div', 'pp-view');
        container.appendChild(view);
        st.view = view;

        // --- barra unica editor (46px, una riga) ---
        view.appendChild(buildToolbar());

        // --- riga edit: [tab] filmstrip | canvas | inspector [tab] ---
        const edit = App.el('div', 'pp-edit');
        view.appendChild(edit);

        st.filmTab = sideTab('Filmstrip', function () { togglePanel('film'); });
        st.filmTab.style.display = 'none';
        st.film = App.el('div', 'pp-film');
        st.slidesPane = st.film;

        st.canvas = App.el('div', 'pp-canvas');
        const stageWrap = App.el('div', 'pp-stage-wrap');
        st.canvas.appendChild(stageWrap);
        st.stageWrap = stageWrap;

        st.insp = App.el('div', 'pp-insp');
        st.props = st.insp;
        st.inspTab = sideTab('Proprietà', function () { togglePanel('insp'); });
        st.inspTab.style.display = 'none';

        edit.appendChild(st.filmTab);
        edit.appendChild(st.film);
        edit.appendChild(st.canvas);
        edit.appendChild(st.insp);
        edit.appendChild(st.inspTab);

        // --- status bar26px ---
        const status = App.el('div', 'pp-status');
        st.status = status;
        view.appendChild(status);

        if (item.updated_at) {
            try {
                const d = new Date(item.updated_at);
                setBadge('saved', ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2));
            } catch (e) { /* ok */ }
        }

        st.onResize = function () { fitStage(); applyBarOverflow(); };
        window.addEventListener('resize', st.onResize);
        attachKeys();

        renderSlidesPane();
        renderStage();
        renderProps();
        updateUndoUI();
        updateStatus();
        requestAnimationFrame(function () { fitStage(); applyBarOverflow(); });
    }

    function safeName(t) {
        return String(t || 'presentazione').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    }
    function curSlide() { return st.data.slides[st.cur] || st.data.slides[0]; }
    function curEl() {
        const s = curSlide();
        if (!st || !st.sel || !s) return null;
        for (let i = 0; i < s.elements.length; i++) if (s.elements[i].id === st.sel) return s.elements[i];
        return null;
    }
    function idxOfSid(sid) {
        for (let i = 0; i < st.data.slides.length; i++) if (st.data.slides[i].id === sid) return i;
        return -1;
    }
    function rerenderAll() {
        renderSlidesPane(); renderStage(); renderProps(); updateStatus();
    }

    // ---------- status bar ----------
    function updateStatus() {
        if (!st || !st.status) return;
        const s = st.status;
        s.innerHTML = '';
        function part(text) {
            const e = App.el('span', 'pp-st-part');
            e.textContent = text;
            s.appendChild(e);
        }
        part('Slide ' + (st.cur + 1) + '/' + st.data.slides.length);
        part('· Zoom ' + Math.round((st.zoom || 1) * 100) + '%');
        const em = curEl();
        if (em) part('· ' + (em.type === 'text' ? 'Testo selezionato' : 'Elemento selezionato'));
        s.appendChild(App.el('span', 'pp-spacer'));
        const hint = App.el('span', 'pp-st-hint');
        hint.textContent = 'Doppio click sul testo per modificarlo · Frecce spostano (Shift ×10) · Canc elimina · Ctrl+Z annulla';
        s.appendChild(hint);
    }

    // ---------- operazioni slide ----------
    function addSlide(at) {
        st.data.slides.splice(at + 1, 0, newSlide());
        st.cur = at + 1;
        st.sel = null;
        rerenderAll(); scheduleSave();
    }
    function dupSlideAt(i) {
        if (i < 0 || i >= st.data.slides.length) return;
        const copy = JSON.parse(JSON.stringify(st.data.slides[i]));
        copy.id = uid();
        copy.elements.forEach(function (em) { em.id = uid(); });
        st.data.slides.splice(i + 1, 0, copy);
        st.cur = i + 1;
        st.sel = null;
        rerenderAll(); scheduleSave();
    }
    function delSlideAt(i) {
        if (st.data.slides.length <= 1) { flash('La presentazione deve avere almeno una slide.'); return; }
        if (!confirm('Eliminare la slide ' + (i + 1) + '?')) return;
        st.data.slides.splice(i, 1);
        if (st.cur >= st.data.slides.length) st.cur = st.data.slides.length - 1;
        st.sel = null;
        rerenderAll(); scheduleSave();
    }

    // ---------- pannello slide: miniature reali + drag&drop ----------
    function miniEl(em) {
        const n = App.el('div', 'pp-thumb-item');
        n.style.left = (em.x || 0) + 'px';
        n.style.top = (em.y || 0) + 'px';
        n.style.width = (em.w || 100) + 'px';
        n.style.height = (em.h || 60) + 'px';
        if (em.rot) n.style.transform = 'rotate(' + em.rot + 'deg)';
        if (em.opac != null && em.opac < 100) n.style.opacity = String(Math.max(0, em.opac) / 100);
        if (em.type === 'text') {
            const t = App.el('div', null, App.esc(em.text || ''));
            t.style.cssText = 'font-size:' + (em.fontSize || 24) + 'px;color:' + (em.color || '#141824') +
                ';text-align:' + (em.align || 'left') + ';font-weight:' + (em.bold ? '700' : '400') +
                ';font-style:' + (em.italic ? 'italic' : 'normal') +
                (em.fontFamily ? ';font-family:' + em.fontFamily : '') +
                ';width:100%;height:100%;overflow:hidden;white-space:pre-wrap;word-break:break-word;line-height:1.3;box-sizing:border-box';
            if (em.fill) t.style.background = em.fill;
            n.appendChild(t);
        } else if (em.type === 'image') {
            const img = document.createElement('img');
            img.src = mediaUrl(em.src);
            img.draggable = false;
            n.appendChild(img);
        } else if (em.type === 'video' || em.type === 'audio') {
            const fs = Math.max(10, Math.min(em.w || 60, em.h || 40) * 0.32);
            n.style.background = '#232a3c';
            n.innerHTML = '<div style="position:absolute;left:0;top:0;width:100%;height:100%;display:flex;' +
                'align-items:center;justify-content:center;color:rgba(255,255,255,.65);font-size:' + fs + 'px">' +
                (em.type === 'video' ? '▶' : '♪') + '</div>';
        } else if (em.type === 'shape') {
            n.style.background = em.fill || '#8ca4ff';
            if (em.shape === 'circle' || em.shape === 'ellipse') n.style.borderRadius = '50%';
        } else if (em.type === 'arrow') {
            n.innerHTML = arrowSvg(em.fill || '#f9974a');
        }
        if (em.strokeW > 0 && em.stroke) n.style.border = em.strokeW + 'px solid ' + em.stroke;
        return n;
    }

    function swapNodes(a, b) {
        if (!a || !b || a === b || !a.parentNode) return;
        const pa = a.parentNode;
        const tmp = document.createElement('i');
        pa.insertBefore(tmp, a);
        pa.insertBefore(a, b);
        pa.insertBefore(b, tmp);
        if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
    }

    function renderSlidesPane() {
        const pane = st.slidesPane;
        pane.innerHTML = '';
        const head = App.el('div', 'pp-pane-head');
        head.appendChild(App.el('span', null, 'Slide (' + st.data.slides.length + ')'));
        const tools = App.el('span', 'pp-head-tools');
        const coll = App.el('button', 'pp-mini');
        coll.type = 'button';
        coll.title = 'Riduci filmstrip';
        coll.innerHTML = IC.chevL;
        coll.addEventListener('click', function () { togglePanel('film'); });
        tools.appendChild(coll);
        const add = App.el('button', 'pp-mini');
        add.type = 'button';
        add.textContent = '+';
        add.title = 'Aggiungi slide';
        add.addEventListener('click', function () { addSlide(st.cur); });
        tools.appendChild(add);
        head.appendChild(tools);
        pane.appendChild(head);

        st.data.slides.forEach(function (s, i) {
            const item = App.el('div', 'pp-slide-item' + (i === st.cur ? ' active' : ''));
            item.draggable = true;
            item.dataset.sid = s.id;
            item.title = 'Slide ' + (i + 1) + ' (trascina per riordinare)';

            // miniatura RENDERIZZATA (aspect 16:9, scala MINI=0.12)
            const th = App.el('div', 'pp-thumb');
            th.style.width = (SW * MINI) + 'px';
            th.style.height = (SH * MINI) + 'px';
            const cv = App.el('div', 'pp-thumb-canvas');
            cv.style.width = SW + 'px';
            cv.style.height = SH + 'px';
            cv.style.transform = 'scale(' + MINI + ')';
            cv.style.background = s.bg || '#f7f5ef';
            (s.elements || []).forEach(function (em) { cv.appendChild(miniEl(em)); });
            th.appendChild(cv);
            item.appendChild(th);

            // riga: numero + conteggio + duplica/elimina
            const row = App.el('div', 'pp-item-row');
            row.appendChild(App.el('span', 'pp-num', String(i + 1)));
            row.appendChild(App.el('span', 'pp-nm', s.elements.length ? (s.elements.length + ' el.') : 'vuota'));
            const cp = App.el('button', 'pp-mini-btn');
            cp.type = 'button';
            cp.title = 'Duplica slide';
            cp.innerHTML = IC.copy;
            cp.addEventListener('click', function (e) { e.stopPropagation(); dupSlideAt(idxOfSid(s.id)); });
            const rm = App.el('button', 'pp-mini-btn');
            rm.type = 'button';
            rm.title = 'Elimina slide';
            rm.innerHTML = IC.trash;
            rm.addEventListener('click', function (e) { e.stopPropagation(); delSlideAt(idxOfSid(s.id)); });
            row.appendChild(cp);
            row.appendChild(rm);
            item.appendChild(row);

            // click = seleziona slide
            item.addEventListener('click', function (ev) {
                if (ev.target.closest('.pp-mini-btn')) return;
                if (st.lastDragT && (Date.now() - st.lastDragT) < 350) return;
                const idx = idxOfSid(s.id);
                if (idx < 0) return;
                st.cur = idx;
                st.sel = null;
                renderSlidesPane(); renderStage(); renderProps(); updateStatus();
                if (st.bgInp) st.bgInp.value = (st.data.slides[idx].bg || '#f7f5ef');
            });

            // --- drag & drop per riordinare ---
            item.addEventListener('dragstart', function (e) {
                st.dragSid = s.id;
                st.dragCurSid = curSlide() ? curSlide().id : null;
                item.classList.add('dragging');
                try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); } catch (err) { /* ok */ }
            });
            item.addEventListener('dragover', function (e) {
                if (!st || !st.dragSid) return;
                e.preventDefault();
                try { e.dataTransfer.dropEffect = 'move'; } catch (err) { /* ok */ }
                const from = idxOfSid(st.dragSid);
                const to = idxOfSid(item.dataset.sid);
                if (from < 0 || to < 0) return;
                pane.querySelectorAll('.pp-slide-item').forEach(function (n) { n.classList.remove('drop-target'); });
                item.classList.add('drop-target');
                if (from === to) return;
                // swap live: array + nodi DOM (feedback visivo immediato)
                const arr = st.data.slides;
                const moved = arr.splice(from, 1)[0];
                arr.splice(to, 0, moved);
                const srcNode = pane.querySelector('[data-sid="' + st.dragSid + '"]');
                if (srcNode && srcNode !== item) swapNodes(srcNode, item);
                st.cur = st.dragCurSid ? idxOfSid(st.dragCurSid) : st.cur;
                if (st.cur < 0) st.cur = to;
            });
            item.addEventListener('dragleave', function () {
                item.classList.remove('drop-target');
            });
            item.addEventListener('drop', function (e) {
                if (!st || !st.dragSid) return;
                e.preventDefault();
                finalizeSlideDrag();
            });
            item.addEventListener('dragend', function () {
                if (!st || !st.dragSid) return;
                finalizeSlideDrag();
            });

            pane.appendChild(item);
        });
    }

    function finalizeSlideDrag() {
        st.dragSid = null;
        st.dragCurSid = null;
        st.lastDragT = Date.now();
        if (!st.slidesPane) return;
        st.slidesPane.querySelectorAll('.pp-slide-item').forEach(function (n) {
            n.classList.remove('dragging');
            n.classList.remove('drop-target');
        });
        renderSlidesPane();
        if (st.bgInp) st.bgInp.value = (curSlide().bg || '#f7f5ef');
        scheduleSave();
    }

    let flashTimerLocal = null;
    function flash(msg) {
        if (!root) return;
        let f = document.querySelector('.pp-flash');
        if (!f) {
            f = App.el('div', 'pp-flash');
            f.style.cssText = 'position:fixed;top:74px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--accent);color:var(--text);padding:9px 16px;border-radius:10px;font-size:13px;z-index:500;box-shadow:0 8px 24px rgba(0,0,0,.4)';
            document.body.appendChild(f);
        }
        f.textContent = msg;
        if (flashTimerLocal) clearTimeout(flashTimerLocal);
        flashTimerLocal = setTimeout(function () { if (f) f.remove(); }, 2600);
    }

    // ---------- stage ----------
    function arrowSvg(color) {
        return '<svg viewBox="0 0 100 40" preserveAspectRatio="none">' +
            '<line x1="2" y1="20" x2="78" y2="20" stroke="' + color + '" stroke-width="7" stroke-linecap="round"/>' +
            '<polygon points="74,7 97,20 74,33" fill="' + color + '"/></svg>';
    }

    const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    // geometria + aspetto di un elemento (usato da stage, drag, resize, rotate)
    function applyStyle(n, em) {
        n.style.left = (em.x || 0) + 'px';
        n.style.top = (em.y || 0) + 'px';
        n.style.width = (em.w || 100) + 'px';
        n.style.height = (em.h || 60) + 'px';
        n.style.transform = em.rot ? 'rotate(' + em.rot + 'deg)' : '';
        n.style.opacity = (em.opac == null || em.opac >= 100) ? '' : String(Math.max(0, em.opac) / 100);
        n.style.border = (em.strokeW > 0 && em.stroke) ? (em.strokeW + 'px solid ' + em.stroke) : 'none';
        if (em.type === 'shape') {
            n.style.background = em.fill || '#8ca4ff';
            n.style.borderRadius = (em.shape === 'circle' || em.shape === 'ellipse') ? '50%' : '';
        } else if (em.type === 'arrow') {
            n.style.background = 'transparent';
        } else {
            n.style.background = em.fill || 'transparent';
        }
        n.style.zIndex = (st && st.sel === em.id) ? '20' : '';
    }

    function elNode(em, interactive) {
        const n = App.el('div', 'pp-el pp-' + em.type);
        n.dataset.id = em.id;
        applyStyle(n, em);

        if (em.type === 'text') {
            const t = App.el('div', 'pp-txt', App.esc(em.text || ''));
            t.style.fontSize = (em.fontSize || 24) + 'px';
            t.style.color = em.color || '#141824';
            t.style.textAlign = em.align || 'left';
            t.style.fontWeight = em.bold ? '700' : '400';
            t.style.fontStyle = em.italic ? 'italic' : 'normal';
            if (em.fontFamily) t.style.fontFamily = em.fontFamily;
            n.appendChild(t);
        } else if (em.type === 'image') {
            const img = document.createElement('img');
            img.src = mediaUrl(em.src);
            img.draggable = false;
            n.appendChild(img);
        } else if (em.type === 'video') {
            const v = document.createElement('video');
            v.src = mediaUrl(em.src);
            v.controls = true;
            n.appendChild(v);
        } else if (em.type === 'audio') {
            const a = document.createElement('audio');
            a.src = mediaUrl(em.src);
            a.controls = true;
            n.appendChild(a);
        } else if (em.type === 'shape') {
            /* applyStyle gestisce sfondo/bordi */
        } else if (em.type === 'arrow') {
            n.innerHTML = arrowSvg(em.fill || '#f9974a');
        }

        if (interactive) {
            if (st && st.sel === em.id) n.classList.add('sel');
            // 8 maniglie (4 angoli + 4 mezzi lati) + rotazione
            DIRS.forEach(function (d) {
                const h = App.el('div', 'pp-h pp-h-' + d);
                h.dataset.dir = d;
                n.appendChild(h);
            });
            const rot = App.el('div', 'pp-rot');
            rot.title = 'Ruota (Shift = scatti di 5°)';
            n.appendChild(rot);
            n.addEventListener('mousedown', function (e) { onElMouseDown(e, em, n); });
            n.addEventListener('dblclick', function () {
                if (em.type === 'text') editText(em, n);
            });
        }
        return n;
    }

    function renderStage() {
        if (!st) return;
        const wrap = st.stageWrap;
        wrap.innerHTML = '';
        const s = curSlide();
        const stage = App.el('div', 'pp-stage');
        stage.style.background = s.bg || '#f7f5ef';
        s.elements.forEach(function (em) { stage.appendChild(elNode(em, true)); });
        stage.addEventListener('mousedown', function (e) {
            if (e.target === stage) select(null);
        });
        wrap.appendChild(stage);
        st.stage = stage;
        if (st.bgInp) st.bgInp.value = s.bg || '#f7f5ef';
        if (st.trSel) st.trSel.value = s.transition || 'none';
        fitStage();
    }

    // zoom-to-fit: tutta l'altezza disponibile, padding ≤12px
    function fitStage() {
        if (!st || !st.stageWrap) return;
        const host = st.canvas || st.stageWrap.parentNode;
        const aw = Math.max(60, (host ? host.clientWidth : 640) - 24);
        const ah = Math.max(40, (host ? host.clientHeight : 360) - 24);
        let scale = Math.min(aw / SW, ah / SH) * (st.zoom || 1);
        if (!(scale > 0)) scale = 0.1;
        st.scale = scale;
        if (st.stage) st.stage.style.transform = 'scale(' + scale + ')';
        st.stageWrap.style.width = (SW * scale) + 'px';
        st.stageWrap.style.height = (SH * scale) + 'px';
        if (st.zoomLbl) st.zoomLbl.textContent = Math.round((st.zoom || 1) * 100) + '%';
        updateStatus();
    }
    function setZoom(z) {
        if (!st) return;
        st.zoom = Math.max(0.25, Math.min(3, z));
        fitStage();
    }

    function select(id) {
        if (!st) return;
        if (st.sel === id) { renderProps(); updateStatus(); return; }
        st.sel = id;
        if (st.stage) {
            st.stage.querySelectorAll('.pp-el').forEach(function (n) {
                const on = n.dataset.id === id;
                n.classList.toggle('sel', on);
                n.style.zIndex = on ? '20' : '';
            });
        }
        renderProps();
        updateStatus();
    }

    // ---------- guide allineamento magenta (task 1.3) ----------
    function guidesLayer() {
        if (!st || !st.stageWrap) return null;
        let L = st.stageWrap.querySelector('.pp-guides');
        if (!L) { L = App.el('div', 'pp-guides'); st.stageWrap.appendChild(L); }
        return L;
    }
    function clearGuides() {
        if (st && st.stageWrap) {
            const L = st.stageWrap.querySelector('.pp-guides');
            if (L) L.remove();
        }
    }
    function applyGuides(em) {
        const L = guidesLayer();
        if (!L) return;
        L.innerHTML = '';
        const scale = st.scale || 1;
        const tol = GUIDE_TOL / scale;   // 4px in coordinate schermo
        const s = curSlide();
        const xs = [{ v: SW / 2 }], ys = [{ v: SH / 2 }];
        s.elements.forEach(function (o) {
            if (o.id === em.id) return;
            const x = o.x || 0, y = o.y || 0, w = o.w || 0, h = o.h || 0;
            xs.push({ v: x }, { v: x + w / 2 }, { v: x + w });
            ys.push({ v: y }, { v: y + h / 2 }, { v: y + h });
        });
        // bordi/centri orizzontali
        let bestX = null;
        [em.x, em.x + em.w / 2, em.x + em.w].forEach(function (edge) {
            xs.forEach(function (t) {
                const d = t.v - edge;
                if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d: d, v: t.v };
            });
        });
        if (bestX) em.x = Math.round(em.x + bestX.d);
        // bordi/centri verticali
        let bestY = null;
        [em.y, em.y + em.h / 2, em.y + em.h].forEach(function (edge) {
            ys.forEach(function (t) {
                const d = t.v - edge;
                if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d: d, v: t.v };
            });
        });
        if (bestY) em.y = Math.round(em.y + bestY.d);
        // linee magenta
        if (bestX) {
            const lv = App.el('div', 'pp-guide');
            lv.style.cssText = 'position:absolute;width:1px;top:0;left:' + (bestX.v * scale) + 'px;height:' + (SH * scale) + 'px';
            L.appendChild(lv);
        }
        if (bestY) {
            const lh = App.el('div', 'pp-guide');
            lh.style.cssText = 'position:absolute;height:1px;left:0;top:' + (bestY.v * scale) + 'px;width:' + (SW * scale) + 'px';
            L.appendChild(lh);
        }
    }

    // ---------- gesti: muovi / ridimensiona (8 maniglie) / ruota ----------
    function onElMouseDown(e, em, n) {
        const tgt = e.target;
        if (tgt.classList && tgt.classList.contains('pp-rot')) { startRotate(e, em, n); return; }
        if (tgt.dataset && tgt.dataset.dir) { startResize(e, em, n, tgt.dataset.dir); return; }
        if (tgt.getAttribute && tgt.getAttribute('contenteditable') === 'true') return;
        if (tgt.tagName === 'VIDEO' || tgt.tagName === 'AUDIO') { select(em.id); return; }
        e.preventDefault();
        e.stopPropagation();
        select(em.id);
        startMove(e, em, n);
    }

    function startMove(e, em, n) {
        const scale = st.scale || 1;
        const sx = e.clientX, sy = e.clientY;
        const ox = em.x, oy = em.y;
        let changed = false;
        function mv(ev) {
            let nx = Math.round(ox + (ev.clientX - sx) / scale);
            let ny = Math.round(oy + (ev.clientY - sy) / scale);
            nx = Math.max(-em.w + 20, Math.min(SW - 20, nx));
            ny = Math.max(-em.h + 20, Math.min(SH - 20, ny));
            em.x = nx;
            em.y = ny;
            applyGuides(em);          // snapping + linee magenta durante il drag
            applyStyle(n, em);
            changed = true;
        }
        function up() {
            document.removeEventListener('mousemove', mv);
            document.removeEventListener('mouseup', up);
            clearGuides();
            if (changed) { renderProps(); updateStatus(); scheduleSave(); }
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
    }

    function startResize(e, em, n, dir) {
        e.preventDefault();
        e.stopPropagation();
        select(em.id);
        const scale = st.scale || 1;
        const sx = e.clientX, sy = e.clientY;
        const ox = em.x, oy = em.y, ow = em.w, oh = em.h;
        const ratio = (ow / oh) || 1;
        const corner = dir.length === 2;      // angoli: proporzionale (Shift = libero)
        let changed = false;
        function mv(ev) {
            const dx = (ev.clientX - sx) / scale;
            const dy = (ev.clientY - sy) / scale;
            let w = ow, h = oh, x = ox, y = oy;
            if (dir.indexOf('e') >= 0) w = ow + dx;
            if (dir.indexOf('w') >= 0) { w = ow - dx; x = ox + (ow - w); }
            if (dir.indexOf('s') >= 0) h = oh + dy;
            if (dir.indexOf('n') >= 0) { h = oh - dy; y = oy + (oh - h); }
            if (corner && !ev.shiftKey) {
                const dW = Math.abs(w - ow) / Math.max(1, ow);
                const dH = Math.abs(h - oh) / Math.max(1, oh);
                if (dW >= dH) h = w / ratio; else w = h * ratio;
                if (dir.indexOf('w') >= 0) x = ox + (ow - w);
                if (dir.indexOf('n') >= 0) y = oy + (oh - h);
            }
            w = Math.max(16, w);
            h = Math.max(12, h);
            em.x = Math.round(x);
            em.y = Math.round(y);
            em.w = Math.round(w);
            em.h = Math.round(h);
            applyStyle(n, em);
            changed = true;
        }
        function up() {
            document.removeEventListener('mousemove', mv);
            document.removeEventListener('mouseup', up);
            if (changed) { renderProps(); updateStatus(); scheduleSave(); }
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
    }

    function startRotate(e, em, n) {
        e.preventDefault();
        e.stopPropagation();
        select(em.id);
        const r = n.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
        const rot0 = em.rot || 0;
        let changed = false;
        function mv(ev) {
            const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
            let rot = rot0 + (a - a0);
            if (ev.shiftKey) rot = Math.round(rot / 5) * 5;   // snap 5° con Shift
            rot = Math.round(rot);
            if (rot >= 360) rot -= 360;
            if (rot <= -360) rot += 360;
            em.rot = rot;
            n.style.transform = rot ? 'rotate(' + rot + 'deg)' : '';
            changed = true;
        }
        function up() {
            document.removeEventListener('mousemove', mv);
            document.removeEventListener('mouseup', up);
            if (changed) { renderProps(); updateStatus(); scheduleSave(); }
        }
        document.addEventListener('mousemove', mv);
        document.addEventListener('mouseup', up);
    }

    function removeSelected() {
        const s = curSlide();
        const em = curEl();
        if (!s || !em) return;
        s.elements = s.elements.filter(function (x) { return x.id !== em.id; });
        st.sel = null;
        rerenderAll();
        scheduleSave();
    }

    // ---------- tastiera globale (rimossa in close/showList) ----------
    function onEditorKey(e) {
        if (!st || overlay) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        const meta = e.ctrlKey || e.metaKey;
        if (meta && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            if (e.shiftKey) redoEdit(); else undoEdit();
            return;
        }
        if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoEdit(); return; }
        const em = curEl();
        if (!em) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -1;
        else if (e.key === 'ArrowRight') dx = 1;
        else if (e.key === 'ArrowUp') dy = -1;
        else if (e.key === 'ArrowDown') dy = 1;
        if (!dx && !dy) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;      // frecce →1, Shift →10
        em.x = Math.round(em.x + dx * step);
        em.y = Math.round(em.y + dy * step);
        const n = st.stage && st.stage.querySelector('[data-id="' + em.id + '"]');
        if (n) applyStyle(n, em);
        renderProps();
        updateStatus();
        scheduleSave();
    }

    function editText(em, n) {
        const t = n.querySelector('.pp-txt');
        if (!t) return;
        t.setAttribute('contenteditable', 'true');
        t.focus();
        const range = document.createRange();
        range.selectNodeContents(t);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        function done() {
            t.removeEventListener('blur', done);
            em.text = t.innerText.replace(/\n$/, '');
            t.setAttribute('contenteditable', 'false');
            renderSlidesPane();   // aggiorna le miniature
            scheduleSave();
        }
        t.addEventListener('blur', done);
        t.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); t.blur(); }
        });
    }

    // ---------- layout slide (task 1.6) ----------
    const LAYOUTS = ['', 'titolo', 'titolo-contenuto', 'vuota'];
    function applyLayout(kind) {
        if (!st || LAYOUTS.indexOf(kind) < 0) return;
        const s = curSlide();
        // rimuove i text box predefiniti (marcati preset)
        s.elements = s.elements.filter(function (e) { return !e.preset; });
        if (kind === 'titolo') {
            s.elements.push({
                id: uid(), type: 'text', preset: true,
                x: 70, y: 54, w: 820, h: 74,
                text: 'Titolo della slide', fontSize: 32, bold: true,
                color: '#141824', align: 'left'
            });
        } else if (kind === 'titolo-contenuto') {
            s.elements.push({
                id: uid(), type: 'text', preset: true,
                x: 70, y: 54, w: 820, h: 74,
                text: 'Titolo della slide', fontSize: 32, bold: true,
                color: '#141824', align: 'left'
            });
            s.elements.push({
                id: uid(), type: 'text', preset: true,
                x: 70, y: 160, w: 820, h: 320,
                text: 'Testo del contenuto…', fontSize: 20, bold: false,
                color: '#141824', align: 'left'
            });
        }
        s.layout = kind;
        st.sel = null;
        rerenderAll();
        scheduleSave();
    }

    // ---------- 1D pannello proprietà destro (Slide + Elemento) ----------
    function sec(p, title) {
        const d = App.el('div', 'pp-sec');
        if (title) d.appendChild(App.el('div', 'lab', title));
        p.appendChild(d);
        return d;
    }
    function sub(p, label) {
        const d = App.el('div', 'pp-sublab', label);
        p.appendChild(d);
        return d;
    }
    function row(parent, label) {
        const r = App.el('div', 'pp-row');
        if (label) r.appendChild(App.el('label', null, label));
        parent.appendChild(r);
        return r;
    }
    // aggiorna stage + miniature + autosave (con undo snapshot)
    function touchEl() {
        renderStage();
        scheduleSave();
    }
    function numRow(parent, label, get, set, min, max) {
        const r = row(parent, label);
        const inp = App.el('input');
        inp.type = 'number';
        if (min != null) inp.min = String(min);
        if (max != null) inp.max = String(max);
        inp.value = String(Math.round(get()));
        inp.addEventListener('input', function () {
            let v = parseFloat(inp.value);
            if (isNaN(v)) return;
            if (min != null) v = Math.max(min, v);
            if (max != null) v = Math.min(max, v);
            set(v);
            touchEl();
        });
        inp.addEventListener('change', function () { inp.value = String(Math.round(get())); renderProps(); });
        r.appendChild(inp);
        return r;
    }
    function colorRow(parent, label, get, set, onDone) {
        const r = row(parent, label);
        const c = App.el('input');
        c.type = 'color';
        c.value = get() || '#ffffff';
        c.addEventListener('input', function () { set(c.value); touchEl(); });
        c.addEventListener('change', function () { if (onDone) onDone(); });
        r.appendChild(c);
        return r;
    }

    function renderProps() {
        if (!st || !st.props) return;
        const p = st.props;
        p.innerHTML = '';
        st.propsBg = null;
        // testata con linguetta di riduzione
        const ph = App.el('div', 'pp-props-head');
        ph.appendChild(App.el('span', 'pp-props-title', 'Proprietà'));
        const cb = App.el('button', 'pp-mini');
        cb.type = 'button';
        cb.title = 'Riduci pannello Proprietà';
        cb.innerHTML = IC.chevR;
        cb.addEventListener('click', function () { togglePanel('insp'); });
        ph.appendChild(cb);
        p.appendChild(ph);

        // sempre la sezione Slide (sfondo, layout, transizione)
        renderSlideProps(p);
        // sezione Elemento solo con elemento selezionato
        const em = curEl();
        if (em) renderElProps(p, em);
    }

    function renderSlideProps(p) {
        const s = curSlide();
        const s1 = sec(p, 'Slide');
        // sfondo
        colorRow(s1, 'Sfondo',
            function () { return s.bg || '#f7f5ef'; },
            function (v) {
                s.bg = v;
                if (st.bgInp) st.bgInp.value = v;
                if (st.stage) st.stage.style.background = v;
            },
            function () { renderSlidesPane(); });
        st.propsBg = s1.querySelector('input[type="color"]');
        // layout (task 1.6)
        const rl = row(s1, 'Layout');
        const lsel = App.el('select');
        lsel.innerHTML = '<option value="">Nessuno</option>' +
            '<option value="titolo">Titolo</option>' +
            '<option value="titolo-contenuto">Titolo+Contenuto</option>' +
            '<option value="vuota">Vuota</option>';
        lsel.value = s.layout || '';
        lsel.addEventListener('change', function () { if (lsel.value) applyLayout(lsel.value); });
        rl.appendChild(lsel);
        // transizione (task 1.7)
        const rt = row(s1, 'Transizione');
        const tsel = App.el('select');
        tsel.innerHTML = '<option value="none">Nessuna</option>' +
            '<option value="fade">Fade (300ms)</option>' +
            '<option value="slide">Slide (300ms)</option>';
        tsel.value = s.transition || 'none';
        tsel.addEventListener('change', function () {
            s.transition = tsel.value;
            if (st.trSel) st.trSel.value = tsel.value;
            scheduleSave();
        });
        rt.appendChild(tsel);
    }

    function renderElProps(p, em) {
        const s1 = sec(p, 'Elemento');

        // posizione/dimensione/rotazione
        sub(s1, 'Trasformazione');
        numRow(s1, 'X', function () { return em.x; }, function (v) { em.x = Math.round(v); }, -1000, 3000);
        numRow(s1, 'Y', function () { return em.y; }, function (v) { em.y = Math.round(v); }, -1000, 3000);
        numRow(s1, 'Larghezza', function () { return em.w; }, function (v) { em.w = Math.round(v); }, 16, 4000);
        numRow(s1, 'Altezza', function () { return em.h; }, function (v) { em.h = Math.round(v); }, 12, 4000);
        numRow(s1, 'Rotazione (°)', function () { return em.rot || 0; }, function (v) { em.rot = Math.round(v); }, -360, 360);

        // aspetto: riempimento, bordo, opacità
        sub(s1, 'Aspetto');
        colorRow(s1, 'Riempimento',
            function () { return em.fill || (em.type === 'arrow' ? '#f9974a' : '#ffffff'); },
            function (v) { em.fill = v; });
        const rb = row(s1, 'Bordo');
        const bc = App.el('input');
        bc.type = 'color';
        bc.value = em.stroke || '#141824';
        bc.addEventListener('input', function () { em.stroke = bc.value; if (!em.strokeW) em.strokeW = 2; touchEl(); });
        rb.appendChild(bc);
        const bw = App.el('input');
        bw.type = 'number'; bw.min = '0'; bw.max = '40';
        bw.value = String(em.strokeW || 0);
        bw.title = 'Spessore bordo (px)';
        bw.addEventListener('input', function () {
            let v = parseInt(bw.value, 10);
            if (isNaN(v)) return;
            em.strokeW = Math.max(0, Math.min(40, v));
            if (em.strokeW > 0 && !em.stroke) em.stroke = bc.value || '#141824';
            touchEl();
        });
        rb.appendChild(bw);
        const ro = row(s1, 'Opacità');
        const rng = App.el('input');
        rng.type = 'range'; rng.min = '0'; rng.max = '100';
        rng.value = String(em.opac == null ? 100 : em.opac);
        const rval = App.el('span', 'rng-val', rng.value + '%');
        rng.addEventListener('input', function () {
            em.opac = parseInt(rng.value, 10);
            rval.textContent = rng.value + '%';
            touchEl();
        });
        ro.appendChild(rng);
        ro.appendChild(rval);

        // testo: font / size / colore / allineamento + stile
        if (em.type === 'text') {
            sub(s1, 'Testo');
            const rf = row(s1, 'Font');
            const sel = App.el('select');
            sel.innerHTML = '<option value="system-ui">System UI</option>' +
                '<option value="serif">Serif</option>' +
                '<option value="monospace">Monospace</option>';
            const ff = em.fontFamily || 'system-ui';
            sel.value = ['system-ui', 'serif', 'monospace'].indexOf(ff) >= 0 ? ff : 'system-ui';
            sel.addEventListener('change', function () { em.fontFamily = sel.value; touchEl(); });
            rf.appendChild(sel);

            numRow(s1, 'Dimensione', function () { return em.fontSize || 24; },
                function (v) { em.fontSize = Math.max(8, Math.min(300, Math.round(v))); }, 8, 300);

            colorRow(s1, 'Colore',
                function () { return em.color || '#141824'; },
                function (v) { em.color = v; });

            const ra = row(s1, 'Allineamento');
            const seg = App.el('span', 'pp-seg');
            [['left', 'S', 'Allinea a sinistra'], ['center', 'C', 'Allinea al centro'], ['right', 'D', 'Allinea a destra']].forEach(function (a) {
                const b = App.el('button', (em.align || 'left') === a[0] ? 'active' : '');
                b.type = 'button';
                b.textContent = a[1];
                b.title = a[2];
                b.addEventListener('click', function () {
                    em.align = a[0];
                    touchEl();
                    renderProps();
                });
                seg.appendChild(b);
            });
            ra.appendChild(seg);

            const rs = row(s1, 'Stile');
            const seg2 = App.el('span', 'pp-seg');
            const bb = App.el('button', em.bold ? 'active' : '');
            bb.type = 'button'; bb.textContent = 'G'; bb.title = 'Grassetto';
            bb.style.fontWeight = '800';
            bb.addEventListener('click', function () { em.bold = !em.bold; touchEl(); renderProps(); });
            const ib = App.el('button', em.italic ? 'active' : '');
            ib.type = 'button'; ib.textContent = 'I'; ib.title = 'Corsivo';
            ib.style.fontStyle = 'italic';
            ib.addEventListener('click', function () { em.italic = !em.italic; touchEl(); renderProps(); });
            seg2.appendChild(bb); seg2.appendChild(ib);
            rs.appendChild(seg2);
        }

        const del = App.el('button', 'pp-tb pp-tb-wide pp-danger');
        del.type = 'button';
        del.title = 'Elimina l\'elemento selezionato (Canc)';
        del.innerHTML = IC.trash + '<span>Elimina elemento</span>';
        del.addEventListener('click', removeSelected);
        s1.appendChild(del);
    }

    // ---------- aggiunta elementi ----------
    async function addElement(type, shape) {
        const s = curSlide();
        const base = {
            id: uid(),
            x: 80 + (s.elements.length % 5) * 36,
            y: 80 + (s.elements.length % 5) * 36
        };
        let em = null;
        if (type === 'text') {
            em = Object.assign(base, { type: 'text', w: 420, h: 76, text: 'Nuovo testo', fontSize: 30, color: '#141824', align: 'left', bold: false, italic: false, fontFamily: 'system-ui' });
        } else if (type === 'image') {
            const src = await pickMedia('image');
            if (!src) return;
            em = Object.assign(base, { type: 'image', w: 360, h: 220, src: src });
        } else if (type === 'video') {
            const src = await pickMedia('video');
            if (!src) return;
            em = Object.assign(base, { type: 'video', w: 480, h: 270, src: src });
        } else if (type === 'audio') {
            const src = await pickMedia('audio');
            if (!src) return;
            em = Object.assign(base, { type: 'audio', w: 340, h: 54, src: src });
        } else if (type === 'shape') {
            const dims = shape === 'rect' ? { w: 240, h: 150 } : (shape === 'circle' ? { w: 150, h: 150 } : { w: 220, h: 130 });
            em = Object.assign(base, dims, { type: 'shape', shape: shape, fill: '#8ca4ff' });
        } else if (type === 'arrow') {
            em = Object.assign(base, { type: 'arrow', w: 200, h: 56, fill: '#f9974a' });
        }
        if (!em) return;
        s.elements.push(em);
        st.sel = em.id;
        renderStage(); renderProps(); renderSlidesPane(); updateStatus();
        scheduleSave();
    }

    // ---------- R21 B3: pannello Fonti (FontiPanel) ----------
    function toggleFpPanel() {
        if (!st) return;
        if (st.fpPanel) { closeFp(); return; }
        if (typeof window.FontiPanel === 'undefined' || !window.FontiPanel ||
            typeof window.FontiPanel.create !== 'function') return;
        const panel = window.FontiPanel.create({ contesto: 'presentazioni', onInsert: fpInsert });
        st.fpPanel = panel;
        (st.view || root || document.body).appendChild(panel.el);
        if (st.fpBtn) { st.fpBtn.classList.add('fp-on'); st.fpBtn.setAttribute('aria-expanded', 'true'); }
    }
    function closeFp() {
        if (st && st.fpPanel) { try { st.fpPanel.destroy(); } catch (e) { /* ok */ } st.fpPanel = null; }
        if (st && st.fpBtn) { st.fpBtn.classList.remove('fp-on'); st.fpBtn.setAttribute('aria-expanded', 'false'); }
    }
    // onInsert: oggetto testo 📎 sulla slide corrente (stesso percorso di addElement).
    // scheduleSave -> syncUndo conserva lo snapshot pre-inserimento sullo stack undo;
    // prov {tipo,titolo,fonteId} sull'elemento + fpSources su st.data (-> content JSON).
    function fpInsert(src, info) {
        if (!st) return;
        const titolo = String((info && info.titolo) || (src && src.title) || 'Fonte');
        const tipo = String((info && info.tipo) || 'Fonte');
        const fonteId = (info && info.id != null) ? info.id : (src && src.id != null ? src.id : '');
        const s = curSlide();
        if (!s) return;
        const em = {
            id: uid(),
            x: 80 + (s.elements.length % 5) * 36,
            y: 80 + (s.elements.length % 5) * 36,
            type: 'text', w: 440, h: 60,
            text: '📎 ' + titolo + ' (' + tipo + ')',
            fontSize: 24, color: '#141824', align: 'left',
            bold: false, italic: true, fontFamily: 'system-ui',
            prov: { tipo: tipo, titolo: titolo, fonteId: fonteId }
        };
        s.elements.push(em);
        st.sel = em.id;
        if (!Array.isArray(st.data.fpSources)) st.data.fpSources = [];
        st.data.fpSources.push({ tipo: tipo, titolo: titolo, fonteId: fonteId, ts: Date.now() });
        renderStage(); renderProps(); renderSlidesPane(); updateStatus();
        scheduleSave();   // syncUndo: snapshot PRIMA dell'inserimento sullo stack
    }

    // ---------- presentazione (task 1.7 + 1.8) ----------
    function present() {
        closePresent();
        closeExpMenu();
        let idx = st.cur;
        if (idx < 0) idx = 0;
        const ov = App.el('div', 'pp-present');
        ov.tabIndex = -1;
        let curT = null;

        function armCursor() {
            ov.style.cursor = '';
            const cb = ov.querySelector('.pp-present-close');
            if (cb) cb.style.opacity = '1';
            if (curT) clearTimeout(curT);
            curT = setTimeout(function () {
                ov.style.cursor = 'none';
                const c2 = ov.querySelector('.pp-present-close');
                if (c2) c2.style.opacity = '0';
            }, 2000);
        }
        function draw(dir) {
            const s = st.data.slides[idx];
            ov.innerHTML = '';
            const holder = App.el('div', 'holder');
            const scale = Math.min(window.innerWidth / SW, window.innerHeight / SH);
            const stage = App.el('div', 'pp-stage');
            stage.style.background = s.bg || '#f7f5ef';
            s.elements.forEach(function (em) { stage.appendChild(elNode(em, false)); });
            stage.style.transform = 'scale(' + scale + ')';
            holder.style.width = (SW * scale) + 'px';
            holder.style.height = (SH * scale) + 'px';
            // transizione della slide (1.7)
            const tr = s.transition || 'none';
            if (tr === 'fade') holder.classList.add('pp-anim-fade');
            else if (tr === 'slide') {
                holder.classList.add('pp-anim-slide');
                if (dir < 0) holder.classList.add('pp-anim-back');
            }
            holder.appendChild(stage);
            ov.appendChild(holder);
            if (tr !== 'none') {
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () { holder.classList.add('pp-run'); });
                });
            }
            // cluster alto-destra: contatore n/m + bottone × (sfuma dopo2s)
            const top = App.el('div', 'pp-present-top');
            top.appendChild(App.el('div', 'pp-present-count', (idx + 1) + '/' + st.data.slides.length));
            const closeBtn = App.el('button', 'pp-present-close', '&times;');
            closeBtn.type = 'button';
            closeBtn.title = 'Esci dalla presentazione (Esc)';
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();   // NON avanza slide
                closePresent();
            });
            top.appendChild(closeBtn);
            ov.appendChild(top);
            ov.appendChild(App.el('div', 'pp-present-hint', 'Click avanti · ←/→ · Esc per uscire'));
            const nav = App.el('div', 'pp-present-nav');
            const pv = App.el('button', 'btn-secondary'); pv.type = 'button'; pv.textContent = '‹';
            const nx = App.el('button', 'btn-accent'); nx.type = 'button'; nx.textContent = '›';
            pv.addEventListener('click', function (e) { e.stopPropagation(); prev(); });
            nx.addEventListener('click', function (e) { e.stopPropagation(); next(); });
            nav.appendChild(pv); nav.appendChild(nx);
            ov.appendChild(nav);
            armCursor();
        }
        function next() { if (idx < st.data.slides.length - 1) { idx++; draw(1); } }
        function prev() { if (idx > 0) { idx--; draw(-1); } }
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); closePresent(); }
            else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
            else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
        }
        ov.addEventListener('click', function (e) {
            const t = e.target;
            if (t.closest && t.closest('button')) return;
            if (t.tagName === 'VIDEO' || t.tagName === 'AUDIO') return;
            next();
        });
        ov.addEventListener('mousemove', armCursor);
        document.addEventListener('keydown', onKey);
        overlay = { node: ov, onKey: onKey, cursorTimer: function () { return curT; } };
        document.body.appendChild(ov);
        try {
            if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
                const p = document.documentElement.requestFullscreen();
                if (p && p.catch) p.catch(function () { /* ok */ });
            }
        } catch (e) { /* ok */ }
        ov.focus();
        draw(0);
    }

    function closePresent() {
        if (!overlay) return;
        document.removeEventListener('keydown', overlay.onKey);
        try {
            if (overlay.cursorTimer) { const t = overlay.cursorTimer(); if (t) clearTimeout(t); }
        } catch (e) { /* ok */ }
        overlay.node.remove();
        overlay = null;
        try {
            if (document.fullscreenElement && document.exitFullscreen) {
                const p = document.exitFullscreen();
                if (p && p.catch) p.catch(function () { /* ok */ });
            }
        } catch (e) { /* ok */ }
    }

    // ---------- export / stampa (mantieni) ----------
    function escAttr(s) { return App.esc(s); }

    function exportJSON() {
        download(JSON.stringify(st.data, null, 2), safeName(st.title) + '.json', 'application/json');
    }

    function slideHtml(s, idx) {
        const els = (s.elements || []).map(function (em) {
            const pos = 'position:absolute;left:' + (em.x || 0) + 'px;top:' + (em.y || 0) + 'px;width:' + (em.w || 0) + 'px;height:' + (em.h || 0) + 'px;';
            const extra = (em.rot ? 'transform:rotate(' + em.rot + 'deg);' : '') +
                (em.opac != null && em.opac < 100 ? 'opacity:' + (em.opac / 100) + ';' : '');
            if (em.type === 'text') {
                return '<div style="' + pos + extra + 'font-size:' + (em.fontSize || 24) + 'px;color:' + escAttr(em.color || '#141824') +
                    ';text-align:' + (em.align || 'left') + ';font-weight:' + (em.bold ? '700' : '400') +
                    ';font-style:' + (em.italic ? 'italic' : 'normal') +
                    (em.fontFamily ? ';font-family:' + escAttr(em.fontFamily) : '') +
                    ';white-space:pre-wrap;overflow:hidden;line-height:1.3;box-sizing:border-box;">' + App.esc(em.text || '') + '</div>';
            }
            if (em.type === 'image') return '<img style="' + pos + extra + 'object-fit:contain;" src="' + escAttr(mediaUrl(em.src)) + '" alt="">';
            if (em.type === 'video') return '<video style="' + pos + extra + 'object-fit:contain;" controls src="' + escAttr(mediaUrl(em.src)) + '"></video>';
            if (em.type === 'audio') return '<audio style="' + pos + extra + '" controls src="' + escAttr(mediaUrl(em.src)) + '"></audio>';
            if (em.type === 'shape') {
                const rad = (em.shape === 'circle' || em.shape === 'ellipse') ? 'border-radius:50%;' : '';
                const bd = (em.strokeW > 0 && em.stroke) ? 'border:' + em.strokeW + 'px solid ' + escAttr(em.stroke) + ';' : '';
                return '<div style="' + pos + extra + 'background:' + escAttr(em.fill || '#8ca4ff') + ';' + rad + bd + 'box-sizing:border-box;"></div>';
            }
            if (em.type === 'arrow') {
                const col = escAttr(em.fill || '#f9974a');
                return '<div style="' + pos + extra + '"><svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible">' +
                    '<line x1="2" y1="20" x2="78" y2="20" stroke="' + col + '" stroke-width="7" stroke-linecap="round"/>' +
                    '<polygon points="74,7 97,20 74,33" fill="' + col + '"/></svg></div>';
            }
            return '';
        }).join('');
        return '<div class="slide-wrap"><div class="slide" data-i="' + idx + '" style="background:' + escAttr(s.bg || '#f7f5ef') + '">' + els + '</div></div>';
    }

    function exportHtml() {
        const slides = st.data.slides.map(slideHtml).join('\n');
        const doc =
            '<!DOCTYPE html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
            '<title>' + App.esc(st.title) + '</title>\n' +
            '<style>\n' +
            'body{margin:0;background:#0e1320;color:#f5f7fa;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}\n' +
            '.slide-wrap{margin:18px auto;overflow:hidden;position:relative;}\n' +
            '.slide{width:960px;height:540px;position:relative;overflow:hidden;transform-origin:top left;box-shadow:0 10px 34px rgba(0,0,0,.5);}\n' +
            '.bar{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;background:#1a2030ee;border:1px solid #2a3142;border-radius:12px;padding:8px 14px;z-index:9;}\n' +
            '.bar button{background:#202637;border:1px solid #2a3142;color:#f5f7fa;border-radius:8px;padding:7px 14px;font-size:14px;cursor:pointer;}\n' +
            '.bar button:hover{border-color:#f9974a;}\n' +
            '#cnt{font-size:13px;color:#8b95a5;min-width:56px;text-align:center;}\n' +
            '</style>\n</head>\n<body>\n' +
            slides + '\n' +
            '<div class="bar"><button id="pv">← Indietro</button><span id="cnt"></span><button id="nx">Avanti →</button></div>\n' +
            '<script>\n' +
            '(function(){\n' +
            'var slides=[].slice.call(document.querySelectorAll(".slide"));\n' +
            'var i=0;\n' +
            'function fit(){var s=Math.min((window.innerWidth-40)/960,(window.innerHeight-110)/540,1);if(s<=0)s=1;slides.forEach(function(el){el.style.transform="scale("+s+")";el.parentNode.style.width=(960*s)+"px";el.parentNode.style.height=(540*s)+"px";});}\n' +
            'function show(){slides.forEach(function(el,k){el.parentNode.style.display=(k===i)?"block":"none";});document.getElementById("cnt").textContent=(i+1)+" / "+slides.length;}\n' +
            'document.getElementById("nx").addEventListener("click",function(){i=Math.min(i+1,slides.length-1);show();});\n' +
            'document.getElementById("pv").addEventListener("click",function(){i=Math.max(i-1,0);show();});\n' +
            'document.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key===" "){i=Math.min(i+1,slides.length-1);show();}if(e.key==="ArrowLeft"){i=Math.max(i-1,0);show();}});\n' +
            'window.addEventListener("resize",function(){fit();show();});\n' +
            'fit();show();\n' +
            '})();\n' +
            '<\/script>\n</body>\n</html>\n';
        download(doc, safeName(st.title) + '.html', 'text/html;charset=utf-8');
    }

    function printSlides() {
        if (st && st.stageWrap) {
            st.stageWrap.classList.add('pp-print-area');
            const clean = function () {
                if (st && st.stageWrap) st.stageWrap.classList.remove('pp-print-area');
                window.removeEventListener('afterprint', clean);
            };
            window.addEventListener('afterprint', clean);
            setTimeout(clean, 1500);
        }
        window.print();
    }

    // ---------- R21 B3: stili pannello Fonti flottante (FontiPanel) ----------
    App.style(
        '.fp21-root{position:fixed;top:58px;right:14px;z-index:160;box-sizing:border-box;' +
        'display:flex;flex-direction:column;gap:6px;max-height:calc(100vh - 72px);padding:8px;' +
        'background:#161a2a;border:1px solid rgba(255,255,255,.14);border-radius:12px;' +
        'box-shadow:0 18px 44px rgba(0,0,0,.5);color:#cfd6e4;font:12px/1.45 system-ui,sans-serif}' +
        '.fp21-root .fp21-bar{display:flex;align-items:center;gap:6px}' +
        '.fp21-root .fp21-lens{flex:0 0 auto;width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#cfd6e4;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
        '.fp21-root .fp21-chips{display:flex;gap:4px;flex-wrap:wrap;min-width:0}' +
        '.fp21-root .fp21-chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#aeb8c9;border-radius:999px;padding:2px 8px;font-size:10.5px;cursor:pointer}' +
        '.fp21-root .fp21-chip.active{background:#5b7cfa;border-color:#5b7cfa;color:#fff}' +
        '.fp21-root .fp21-search{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.3);color:#e6ebf5;font-size:12px}' +
        '.fp21-root .fp21-list{flex:1 1 auto;min-height:48px;max-height:54vh;overflow:auto;display:flex;flex-direction:column;gap:4px}' +
        '.fp21-root .fp21-item{display:flex;align-items:center;gap:6px;width:100%;text-align:left;cursor:pointer;padding:6px 8px;border-radius:8px;border:1px solid transparent;background:rgba(255,255,255,.05);color:#dfe6f2;font-size:11.5px}' +
        '.fp21-root .fp21-item.active{border-color:#5b7cfa;background:rgba(91,124,250,.18)}' +
        '.fp21-root .fp21-badge{flex:0 0 auto;font-size:9.5px;padding:1px 6px;border-radius:999px;background:rgba(91,124,250,.22);color:#a9b8ff}' +
        '.fp21-root .fp21-ititle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.fp21-root .fp21-hint{color:#8b95a5;padding:6px 4px}' +
        '.fp21-root .fp21-preview{flex:0 1 auto;max-height:38vh;overflow:auto;background:rgba(0,0,0,.28);border-radius:8px;padding:6px 8px}' +
        '.fp21-root .fp21-ptitle{font-weight:700;font-size:11.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px}' +
        '.fp21-root .fp21-pbody{font-size:11.5px;line-height:1.45}' +
        '.fp21-root .fp21-pbody p{margin:4px 0}' +
        '.fp21-root .fp21-pbody img{max-width:100%;border-radius:6px}' +
        '.fp21-root .fp21-pbody table.fp21-table{border-collapse:collapse;width:100%}' +
        '.fp21-root .fp21-pbody td,.fp21-root .fp21-pbody th{border:1px solid #44506a;padding:3px 5px}' +
        '.fp21-root .fp21-pbody pre.fp21-pre{overflow:auto;background:rgba(0,0,0,.4);border-radius:6px;padding:6px}' +
        '.fp21-root .fp21-insert{margin-top:2px;padding:8px 10px;border-radius:9px;border:0;background:#5b7cfa;color:#fff;font-weight:700;font-size:12px;cursor:pointer}' +
        '.fp21-root .fp21-insert:disabled{opacity:.45;cursor:not-allowed}' +
        '.fp21-root .fp21-rz{position:absolute;background:transparent}' +
        '.fp21-root .fp21-rz-r{top:0;right:0;width:7px;height:100%;cursor:ew-resize}' +
        '.fp21-root .fp21-rz-b{left:0;bottom:0;width:100%;height:7px;cursor:ns-resize}' +
        '.fp21-root .fp21-rz-c{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize}' +
                '.pp-bar .pp-tb.fp-on{background:#5b7cfa;border-color:#5b7cfa;color:#fff}' +
        '@media print{.fp21-root{display:none!important}}'
    );

    // ---------- registrazione ----------
    window.StudyTools = window.StudyTools || {};
    window.StudyTools['presentazioni'] = {
        title: 'Presentazioni',
        icon: ICON,
        desc: 'Slide 16:9 con testi, immagini, media locali e modalità presentazione.',
        kinds: ['presentazione'],
        render: function (container, params) {
            root = container;
            params = params || {};
            if (params.open) return openEditor(container, params.open);
            return showList(container);
        },
        close: function () {
            detachKeys();
            closeExpMenu();
            closeSmallMenu();
            closeBarMenu();
            closePresent();
            closeFp();
            detachWin();
            if (listResizer) { window.removeEventListener('resize', listResizer); listResizer = null; }
            flush();
        }
    };
})();
