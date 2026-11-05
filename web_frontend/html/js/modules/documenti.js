/* ============================================================
   modules/documenti.js - sub-tool Documenti
   kind: 'documento'
   UI a due schermate:
     Elenco: [barra 46px][contenuto flex][status 26px]
     Editor: [barra 46px][contenuto flex] + pill overlay D1 (niente status)
   2A Elenco: griglia card con MINIATURA A4 (mini DOM), ricerca,
      ordinamento, azioni al hover, empty state completo.
   2B Editor: barra riga unica (elenco, undo/redo, titolo+badge
      autosave, stili/font/corpo, caratteri+colori, allineamenti+
      interlinea, liste+indent, immagine/tabella/riga, trova,
      overflow "…" per le azioni secondarie, Export a destra).
   2C Centro: pagina A4 (794x1123 @96dpi) bianca su fondo scuro
      con zoom-to-fit sull'altezza e paginazione visiva.
   2D Trova&sostituisci in POPOVER ancorato al bottone trova.
   2E Status (D1): pill su .doc-main — sinistra "N parole · M
      caratteri · Pagina x/y", destra gruppo zoom [-][%][+][Adatta][100%]
      (la % vive solo nella pill destra; la lista usa ancora .doc-status).
   Logica invariata: autosave debounce ~900ms su
   content={"html":...}, undo/redo nativo + stack snapshot D2, execCommand, export
   Markdown/HTML/Stampa, trova&sostituisci, paginazione, conteggio.
   ============================================================ */
(function () {
    'use strict';

    // ---------- pagina A4 (96dpi) ----------
    const PAGE_W = 794;                       // larghezza A4
    const PAGE_H = 1123;                      // altezza A4
    const PAGE_PAD = 70;                      // margini interni
    const CONTENT_MIN = PAGE_H - PAGE_PAD * 2 - 2;   // 981px: testo minimo nella 1a pagina
    const CANVAS_PAD_X = 8;                   // padding orizzontale del fondo scuro
    const CANVAS_PAD_Y = 10;                  // padding verticale del fondo scuro

    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>';
    const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

    // ---------- icone SVG 16px (stroke, title = tooltip) ----------
    function sv(inner) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    }
    const I_UNDO = sv('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>');
    const I_REDO = sv('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>');
    const I_B = sv('<text x="12" y="17.5" text-anchor="middle" font-family="Georgia,serif" font-size="15" font-weight="700" fill="currentColor" stroke="none">B</text>');
    const I_I = sv('<text x="12" y="17.5" text-anchor="middle" font-family="Georgia,serif" font-size="15" font-style="italic" fill="currentColor" stroke="none">I</text>');
    const I_U = sv('<path d="M7 4.5v6.5a5 5 0 0 0 10 0V4.5"/><path d="M6 19.5h12"/>');
    const I_S = sv('<text x="12" y="17.5" text-anchor="middle" font-family="Georgia,serif" font-size="15" font-weight="700" fill="currentColor" stroke="none">S</text><path d="M5.5 12.4h13"/>');
    const I_FG = sv('<text x="12" y="13.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="12.5" font-weight="700" fill="currentColor" stroke="none">A</text><path class="doc-fg-bar" d="M6.5 19.5h11" stroke-width="3"/>');
    const I_HL = sv('<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M4.8 12.2h14.4v7.1a1.7 1.7 0 0 1-1.7 1.7H6.5a1.7 1.7 0 0 1-1.7-1.7z" fill="currentColor" stroke="none"/>');
    const I_AL = sv('<path d="M4 6h16M4 12h11M4 18h14"/>');
    const I_AC = sv('<path d="M4 6h16M6.5 12h11M5 18h14"/>');
    const I_AR = sv('<path d="M4 6h16M9 12h11M6 18h14"/>');
    const I_UL = sv('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.6" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4.6" cy="18" r="1.5" fill="currentColor" stroke="none"/>');
    const I_OL = sv('<text x="2.4" y="8.4" text-anchor="start" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">1.</text><text x="2.4" y="14.6" text-anchor="start" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">2.</text><text x="2.4" y="20.8" text-anchor="start" font-size="7.5" font-weight="700" fill="currentColor" stroke="none">3.</text><path d="M10.5 6h11M10.5 12h11M10.5 18h11"/>');
    const I_OUTDENT = sv('<path d="M4 6h16M8 12h12M8 18h12"/><path d="M7 10.8 3.9 13.2 7 15.6Z" fill="currentColor" stroke="none"/>');
    const I_INDENT = sv('<path d="M4 6h16M12 12h8M12 18h8"/><path d="M3.9 10.8 7 13.2 3.9 15.6Z" fill="currentColor" stroke="none"/>');
    const I_IMG = sv('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>');
    const I_TABLE = sv('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9.5 4v16M15.5 4v16"/>');
    const I_HR = sv('<path d="M4 12h16"/><path d="M7 6.5h10M7 17.5h10" stroke-dasharray="3 3" opacity=".65"/>');
    const I_SEARCH = sv('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>');
    const I_OPEN = sv('<path d="M7 17 17 7"/><path d="M8 7h9v9"/>');
    const I_PEN = sv('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>');
    const I_COPY = sv('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
    const I_TRASH = sv('<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>');
    const I_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

    App.style(
        /* ---------- shell comune: [barra46][contenuto flex][status26] - status26 solo in Elenco; Editor: pill overlay D1 ---------- */
        '.doc-shell{display:flex;flex-direction:column;gap:8px;min-height:430px;height:100%}' +
        '.doc-bar{position:relative;flex:0 0 46px;height:46px;display:flex;align-items:center;gap:8px;flex-wrap:nowrap;background:#161a2a;border:1px solid var(--border);border-radius:10px;padding:0 8px;z-index:40}' +
        '.doc-main{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative}' +
        '.doc-status{flex:0 0 26px;height:26px;display:flex;align-items:center;justify-content:space-between;gap:8px;background:#161a2a;border:1px solid var(--border);border-radius:8px;padding:0 10px;font-size:11.5px;font-weight:600;color:#8b95a5;white-space:nowrap;overflow:hidden}' +
        '.doc-stats{color:#c3cbdb;overflow:hidden;text-overflow:ellipsis}' +
        '.doc-pager{color:#8b95a5;flex-shrink:0}' +
        '.doc-zoomgrp{display:flex;align-items:center;gap:4px;flex-shrink:0}' +
        '.doc-zbtn{height:18px;min-width:20px;padding:0 6px;background:#1d2333;border:1px solid var(--border);border-radius:6px;color:#c3cbdb;font:inherit;font-size:11px;font-weight:700;cursor:pointer;line-height:1;transition:border-color .15s,color .15s}' +
        '.doc-zbtn:hover{border-color:var(--accent);color:#fff}' +
        '.doc-zoomval{min-width:40px;text-align:center;font-size:11px;font-weight:800;color:#c3cbdb;font-variant-numeric:tabular-nums}' +

        /* ---------- D1: pill overlay su .doc-main (niente fascia full-width) ---------- */
        '.doc-pill{position:absolute;bottom:10px;z-index:30;display:flex;align-items:center;gap:8px;max-width:calc(100% - 24px);background:rgba(22,26,42,.86);border:1px solid var(--border);border-radius:999px;padding:5px 14px;font-size:11.5px;font-weight:600;color:#8b95a5;white-space:nowrap;overflow:hidden;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.35);backdrop-filter:blur(4px)}' +
        '.doc-pill-l{left:12px}' +
        '.doc-pill-r{right:12px;gap:4px}' +
        '.doc-pill button{pointer-events:auto}' +
        '.doc-pillsep{color:#5c6577}' +

        /* ---------- barra: pulsanti, icone 30px, select, separatori ---------- */
        '.doc-btn{height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;background:#202637;border:1px solid var(--border);color:var(--text);border-radius:8px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:border-color .15s,color .15s,background-color .15s;flex:0 0 auto}' +
        '.doc-btn:hover{border-color:#f9974a;color:#f9974a}' +
        '.doc-btn svg{width:15px;height:15px;flex-shrink:0}' +
        '.doc-btn.accent{background:rgba(249,151,74,.16);border-color:rgba(249,151,74,.55);color:#f9974a}' +
        '.doc-btn.accent:hover{background:#f9974a;border-color:#f9974a;color:#141824}' +
        '.doc-track{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:nowrap}' +
        '.doc-grp{display:flex;align-items:center;gap:4px;flex:0 0 auto;min-width:0;flex-wrap:nowrap}' +
        '.doc-track>.doc-grp+.doc-grp{border-left:1px solid #2a3142;padding-left:8px;margin-left:2px}' +
        '.doc-track>.doc-grp+.doc-grp.doc-mg0{border-left:none;padding-left:0;margin-left:0}' +
        '.doc-ib{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:8px;color:#c3cbdb;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s;flex:0 0 auto}' +
        '.doc-ib:hover{border-color:#f9974a;color:#fff}' +
        '.doc-ib.on{background:#f9974a;border-color:#f9974a;color:#141824}' +
        '.doc-ib svg{width:16px;height:16px;pointer-events:none;flex-shrink:0}' +
        '.doc-isep{width:1px;height:18px;background:#2a3142;flex:0 0 auto;margin:0 2px}' +
        '.doc-sel{height:30px;max-width:132px;background:#0e1320;border:1px solid var(--border);color:var(--text);border-radius:8px;font:inherit;font-size:12px;font-weight:600;padding:0 6px;font-family:inherit;cursor:pointer;flex:0 0 auto}' +
        '.doc-sel:focus{outline:none;border-color:#f9974a}' +
        '.doc-swatch{position:relative;width:30px;height:30px;border:1px solid transparent;border-radius:8px;background:transparent;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;flex:0 0 auto;transition:border-color .15s}' +
        '.doc-swatch:hover{border-color:#f9974a}' +
        '.doc-swatch svg{width:16px;height:16px;pointer-events:none;position:relative;z-index:1}' +
        '.doc-swatch input[type=color]{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;border:none;padding:0;margin:0;cursor:pointer;z-index:2}' +

        /* ---------- titolo documento + badge autosave (in barra) ---------- */
        '.doc-titlecell{flex:1 1 auto !important;min-width:171px}' +
        '.doc-title{flex:1 1 auto;min-width:110px;height:30px;background:transparent;border:1px solid transparent;color:var(--text);border-radius:8px;font:inherit;font-size:14px;font-weight:800;padding:0 8px}' +
        '.doc-title:hover{border-color:#2a3142}' +
        '.doc-title:focus{outline:none;border-color:#f9974a;background:#0e1320}' +
        '.doc-save{flex:0 1 auto;min-width:56px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;background:rgba(249,151,74,.14);color:#f9974a;border:1px solid rgba(249,151,74,.4)}' +
        '.doc-save.saved{background:rgba(103,211,145,.12);color:#67d391;border-color:rgba(103,211,145,.4)}' +

        /* ---------- overflow "…" (azioni secondarie) + export ---------- */
        '.doc-ovwrap,.doc-export-wrap{position:relative;flex:0 0 auto}' +
        '.doc-ovmenu{position:absolute;right:0;top:calc(100% + 9px);display:none;flex-direction:column;align-items:flex-start;gap:5px;min-width:120px;max-height:60vh;overflow-y:auto;background:#161a2a;border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.5);padding:6px;z-index:70}' +
        '.doc-ovmenu.open{display:flex}' +
        '.doc-ovmenu .doc-grp{width:auto;border-left:none !important;padding-left:0 !important;margin-left:0 !important;flex-wrap:wrap}' +
        '.doc-ovmenu::-webkit-scrollbar{width:6px}' +
        '.doc-ovmenu::-webkit-scrollbar-thumb{background:#3a4156;border-radius:3px}' +
        '.doc-export-menu{position:absolute;right:0;top:calc(100% + 9px);display:none;flex-direction:column;gap:4px;min-width:190px;background:#161a2a;border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.5);padding:6px;z-index:70}' +
        '.doc-export-menu.open{display:flex}' +
        '.doc-mi{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:6px;color:var(--text);font:inherit;font-size:12.5px;font-weight:600;padding:7px 9px;cursor:pointer;transition:background-color .12s,color .12s}' +
        '.doc-mi:hover{background:rgba(249,151,74,.15);color:#f9974a}' +
        '.doc-ddsep{height:1px;background:#2a3142;margin:3px 2px}' +
        '.doc-caret{font-size:9px;opacity:.85}' +

        /* ---------- dropdown tabella (posizione fissa) ---------- */
        '.doc-dd{position:fixed;display:none;flex-direction:column;gap:4px;min-width:190px;background:#161a2a;border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.5);padding:6px;z-index:90}' +
        '.doc-dd.open{display:flex}' +

        /* ---------- trova&sostituisci: POPOVER ancorato al bottone ---------- */
        '.doc-findwrap{position:relative}' +
        '.doc-find{position:absolute;top:calc(100% + 9px);right:0;display:none;gap:6px;align-items:center;flex-wrap:wrap;width:max-content;max-width:min(92vw,560px);background:#161a2a;border:1px solid var(--border);border-radius:10px;padding:8px;box-shadow:0 14px 34px rgba(0,0,0,.5);z-index:70}' +
        '.doc-find.open{display:flex}' +
        '.doc-finput{height:30px;background:#0e1320;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:13px;padding:0 10px;min-width:150px;flex:1 1 150px}' +
        '.doc-finput:focus{outline:none;border-color:#f9974a}' +
        '.doc-fbtn{height:30px;padding:0 11px;background:#202637;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:border-color .15s,color .15s;flex:0 0 auto}' +
        '.doc-fbtn:hover{border-color:#f9974a;color:#f9974a}' +

        /* ---------- centro: fondo scuro + foglio A4 con zoom-to-fit ---------- */
        '.doc-canvas{position:relative;flex:1 1 auto;min-height:0;overflow:auto;background:#0e1320;border:1px solid var(--border);border-radius:10px;padding:' + CANVAS_PAD_Y + 'px ' + CANVAS_PAD_X + 'px}' +
        '.doc-canvas::-webkit-scrollbar{width:8px;height:8px}' +
        '.doc-canvas::-webkit-scrollbar-thumb{background:#3a4156;border-radius:4px}' +
        '.doc-stage{position:relative;margin:0 auto}' +
        '.doc-zoom{position:absolute;left:0;top:0;transform-origin:top left;width:' + PAGE_W + 'px}' +
        '.doc-page{position:relative;box-sizing:border-box;width:' + PAGE_W + 'px;min-height:' + PAGE_H + 'px;margin:0 auto;padding:' + PAGE_PAD + 'px;background:#ffffff;border-radius:4px;box-shadow:0 16px 44px rgba(0,0,0,.55)}' +
        '.doc-paper{box-sizing:border-box;min-height:' + CONTENT_MIN + 'px;outline:none;font-size:15.5px;line-height:1.72;color:#1a1a1a;caret-color:#f9974a;word-wrap:break-word;overflow-wrap:break-word}' +
        '.doc-paper:empty:before{content:"Inizia a scrivere.";color:#8a8f98}' +
        '.doc-paper h1{font-size:29px;margin:.7em 0 .35em;line-height:1.25;color:#1a1a1a}' +
        '.doc-paper h2{font-size:23px;margin:.65em 0 .3em;line-height:1.3;color:#1a1a1a}' +
        '.doc-paper h3{font-size:18.5px;margin:.6em 0 .3em;color:#1a1a1a}' +
        '.doc-paper p{margin:.45em 0}' +
        '.doc-paper ul,.doc-paper ol{padding-left:26px;margin:.5em 0}' +
        '.doc-paper li{margin:.22em 0}' +
        '.doc-paper img{max-width:100%;border-radius:6px;margin:10px 0;display:block}' +
        '.doc-paper a{color:#3f63d6}' +
        '.doc-paper table{border-collapse:collapse;width:100%;margin:12px 0}' +
        '.doc-paper td,.doc-paper th{border:1px solid #c9cfda;padding:7px 10px;min-width:64px}' +
        '.doc-paper hr{border:none;border-top:1px solid #b9c0cc;margin:16px 0}' +

        /* ---------- paginazione visiva ---------- */
        '.doc-breaks{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:3;overflow:hidden;border-radius:4px}' +
        '.doc-break{position:absolute;left:0;right:0;height:0}' +
        '.doc-break:before{content:"";position:absolute;left:0;right:0;top:0;border-top:1.5px dashed rgba(249,151,74,.9)}' +
        '.doc-break span{position:absolute;left:14px;top:-9px;background:#fff;color:#b4651f;font-size:10.5px;font-weight:800;letter-spacing:.03em;padding:1px 8px;border:1px solid rgba(249,151,74,.65);border-radius:999px;line-height:1.6}' +

        /* ---------- stato attivo trova ---------- */
        'mark.doc-hit{background:#ffe9b8;color:#1a1a1a;border-bottom:1.5px solid #f9974a}' +
        'mark.doc-hit.doc-cur{background:#f9974a;color:#141824}' +

        /* ---------- elenco: titolo centrale, ricerca, ordinamento ---------- */
        '.doc-bartitle{position:absolute;left:50%;transform:translateX(-50%);font-size:15px;font-weight:800;color:var(--text);pointer-events:none;white-space:nowrap}' +
        '.doc-barright{margin-left:auto;gap:8px}' +
        '.doc-search{height:30px;width:150px;background:#0e1320;border:1px solid var(--border);color:var(--text);border-radius:8px;font:inherit;font-size:12.5px;padding:0 9px;flex:0 0 auto}' +
        '.doc-search::placeholder{color:#8b95a5}' +
        '.doc-search:focus{outline:none;border-color:#f9974a}' +
        '.doc-sort{max-width:150px}' +

        /* ---------- elenco: contenuto scrollabile + griglia card ---------- */
        '.doc-content{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 2px 16px}' +
        '.doc-content::-webkit-scrollbar{width:8px}' +
        '.doc-content::-webkit-scrollbar-thumb{background:#3a4156;border-radius:4px}' +
        '.dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:14px}' +
        '.dc-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;min-width:0;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.22);transition:border-color .15s,transform .12s;position:relative}' +
        '.dc-card:hover,.dc-card:focus-visible{border-color:#f9974a;transform:translateY(-2px);outline:none}' +

        /* miniatura: pagina bianca A4 in scala con 1-2 righe di testo */
        '.dc-thumb{position:relative;aspect-ratio:794/1123;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.4);padding:10% 11%;display:flex;flex-direction:column;gap:7px}' +
        '@supports not (aspect-ratio: 794 / 1123){.dc-thumb{height:250px}}' +
        '.dc-thumb .ln{font-family:Georgia,"Times New Roman",serif;font-size:8.5px;line-height:1.55;color:#9aa3b2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.dc-acts{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transform:translateY(-3px);transition:opacity .15s,transform .15s;pointer-events:none}' +
        '.dc-card:hover .dc-acts,.dc-card:focus-within .dc-acts{opacity:1;transform:none;pointer-events:auto}' +
        '.dc-act{width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:rgba(22,26,42,.94);border:1px solid rgba(255,255,255,.16);border-radius:7px;color:#e7ebf3;cursor:pointer;transition:border-color .15s,color .15s}' +
        '.dc-act:hover{border-color:#f9974a;color:#f9974a}' +
        '.dc-act svg{width:14px;height:14px;pointer-events:none}' +
        '.dc-name{font-size:14px;font-weight:700;margin-top:9px;word-break:break-word;color:var(--text)}' +
        '.dc-sub{display:flex;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-top:4px}' +

        /* ---------- notifica ---------- */
        '.doc-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);background:#161a2a;color:#f5f7fa;border:1px solid #f9974a;border-radius:8px;padding:10px 16px;font-size:13.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:80}' +

        /* ---------- stampa: solo il foglio ---------- */
        '@media print{' +
        'body *{visibility:hidden !important}' +
        '.doc-print-area,.doc-print-area *{visibility:visible !important}' +
        '.doc-bar,.doc-status,.doc-pill,.doc-find,.doc-export-menu,.doc-ovmenu,.doc-dd,.doc-breaks,.doc-toast{display:none !important}' +
        '.doc-shell,.doc-main,.doc-canvas,.doc-stage,.doc-zoom,.doc-page{position:static !important;transform:none !important;overflow:visible !important;width:auto !important;height:auto !important;min-height:0 !important;max-height:none !important;margin:0 !important;padding:0 !important;border:none !important;box-shadow:none !important;background:#fff !important;border-radius:0 !important}' +
        '.doc-print-area{position:absolute !important;left:0 !important;top:0 !important;width:100% !important;max-width:100% !important;margin:0 !important;border:none !important;box-shadow:none !important;padding:10px 24px !important;background:#fff !important;color:#1a1a1a !important;min-height:0 !important;caret-color:transparent !important}' +
        '}'
    );

    // ---------- stato modulo ----------
    let root = null;
    let st = null;            // stato editor (vedi openEditor)
    let saveTimer = null;
    let savedRange = null;    // selezione salvata (per select/colori)
    let stateBtns = {};       // cmd -> bottone (stato attivo arancione)
    let rafId = null;
    let onResize = null, onSel = null, onDocDown = null, onDocCtx = null, onScroll = null, ro = null;
    let expMenu = null, findPanel = null, findBtn = null;
    let citeMenu = null;       // F67a: menu contestuale "Inserisci citazione da materiali"
    let fq = null, fr = null; // input trova / sostituisci
    let findCount = 0, findIdx = 0;
    let toastEl = null, toastT = null;
    let shellEl = null, hostEl = null;   // shell corrente + host (container del tool)
    let listQ = '', listSort = 'date-desc';   // stato ricerca/ordinamento elenco

    const BLOCK_SEL = 'p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th';
    const BLOCK_TAGS = { P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, TD: 1, TH: 1 };

    const ask = function (title, value) {
        if (typeof window.StudyAsk === 'function') return window.StudyAsk(title, value);
        return Promise.resolve(prompt(title, value == null ? '' : String(value)));
    };

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

    function safeName(t) {
        return String(t || 'documento').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
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

    async function pickImage() {
        let a = null;
        try { a = await StudyStore.pickAsset(); } catch (e) { a = null; }
        if (a && a.path) return StudyStore.assetUrl(a.path);
        return await fileToDataUrl('image/*');
    }

    function parseContent(item) {
        try {
            const d = JSON.parse(item.content || '{}');
            return {
                html: typeof d.html === 'string' ? d.html : '',
                // R21 B3: registro provenienza fonti (il doc non ha metadata:
                // fpSources vive nel payload content del doc - vedi flush)
                fpSources: Array.isArray(d.fpSources) ? d.fpSources : []
            };
        } catch (e) { return { html: '', fpSources: [] }; }
    }

    // testo in plain text da HTML (conteggi, miniatura, ricerca)
    function stripHtml(html) {
        return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // ---------- salvataggio (debounce ~900ms, invariato) ----------
    function scheduleSave() {
        setBadgeSaving();
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 900);
    }

    // html pulito per la persistenza/export (toglie i mark di evidenziazione temporanea)
    function serializeHtml() {
        if (!st || !st.editor) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = st.editor.innerHTML;
        const ms = tmp.querySelectorAll('mark.doc-hit');
        for (let i = 0; i < ms.length; i++) {
            const m = ms[i], p = m.parentNode;
            if (!p) continue;
            while (m.firstChild) p.insertBefore(m.firstChild, m);
            p.removeChild(m);
        }
        return tmp.innerHTML;
    }

    async function flush() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (!st || !st.id || !st.editor) return;
        try {
            st.data.html = serializeHtml();
            // R21 B3: il doc seed non ha metadata -> provenienza fonti nel
            // payload content stesso: { html, fpSources:[{tipo,titolo,fonteId,ts}] }
            const payload = { html: st.data.html };
            if (Array.isArray(st.data.fpSources) && st.data.fpSources.length) {
                payload.fpSources = st.data.fpSources;
            }
            await StudyStore.saveItem({
                id: st.id, kind: 'documento', title: st.title,
                content: JSON.stringify(payload)
            });
            setBadgeSaved(null);
        } catch (e) { console.error('Salvataggio documento:', e); }
    }

    // ---------- badge autosave (2.3) ----------
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function fmtTime(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        } catch (e) { return ''; }
    }
    function setBadge(cls, text) {
        if (!st || !st.badge) return;
        st.badge.className = 'doc-save ' + cls;
        st.badge.textContent = text;
    }
    function setBadgeSaving() { setBadge('', 'Salvataggio.'); }
    function setBadgeSaved(t) {
        const d = new Date();
        const hhmm = t || (pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
        setBadge('saved', 'Salvato \u2713 ' + hhmm);
    }

    // ---------- notifiche ----------
    function notify(msg) {
        if (toastEl) { toastEl.remove(); toastEl = null; }
        if (toastT) clearTimeout(toastT);
        toastEl = App.el('div', 'doc-toast', App.esc(msg));
        document.body.appendChild(toastEl);
        toastT = setTimeout(function () {
            if (toastEl) { toastEl.remove(); toastEl = null; }
            toastT = null;
        }, 1800);
    }

    // ---------- 2E/D1: pill sinistra (.doc-pill-l) - parole/caratteri ----------
    function updateStats() {
        if (!st || !st.editor || !st.status || !st.editor.isConnected) return;
        const txt = (st.editor.innerText != null ? st.editor.innerText : (st.editor.textContent || '')) || '';
        const t = txt.replace(/\u00a0/g, ' ').trim();
        const words = t ? t.split(/\s+/).length : 0;
        const chars = (st.editor.textContent || '').length;
        st.status.textContent =
            words.toLocaleString('it-IT') + ' parole \u00b7 ' +
            chars.toLocaleString('it-IT') + ' caratteri';
    }

    // ---------- 2E/D1: pill sinistra - Pagina k/n (il % zoom vive nella pill destra) ----------
    function updatePager() {
        if (!st || !st.pager) return;
        const z = st.zoomLevel || 1;
        const n = st.pageCount || 1;
        let k = 1;
        if (st.canvas) k = Math.floor(st.canvas.scrollTop / (PAGE_H * z)) + 1;
        if (k < 1) k = 1;
        if (k > n) k = n;
        st.pager.textContent = 'Pagina ' + k + '/' + n;
    }

    // ---------- shell: altezza esatta = spazio disponibile nel .view-page ----------
    function fitShell() {
        if (!shellEl || !shellEl.isConnected || !hostEl) return;
        const page = hostEl.parentElement;
        if (!page || !page.clientHeight) return;
        let used = 0;
        const kids = page.children;
        for (let i = 0; i < kids.length; i++) if (kids[i] !== hostEl) used += kids[i].offsetHeight;
        const cs = window.getComputedStyle(page);
        const avail = page.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - used;
        if (isFinite(avail) && avail >= 200) shellEl.style.height = Math.round(avail) + 'px';
        else shellEl.style.height = '';
    }

    // ---------- BLOCCO 4: zoom manuale [−][%][+][Adatta][100%] ----------
    function applyZoomTo(z) {
        if (!st || !st.zoom) return;
        st.zoomLevel = z;
        st.zoom.style.width = PAGE_W + 'px';
        st.zoom.style.transform = 'scale(' + z + ')';
        if (st.stage && st.sheet) {
            const sheetH = st.sheet.offsetHeight || PAGE_H;
            st.stage.style.width = Math.round(PAGE_W * z) + 'px';
            st.stage.style.height = Math.round(sheetH * z) + 'px';
        }
        updateZoomUI();
    }
    function updateZoomUI() {
        if (!st) return;
        const pc = Math.round((st.zoomLevel || 1) * 100) + '%';
        if (st.zoomVal) st.zoomVal.textContent = pc;
        updatePager();
    }
    function setZoomUser(z) {
        if (!st) return;
        z = Math.max(0.25, Math.min(3, z));
        st.zoomUser = z;
        applyZoomTo(z);
    }
    function zoomIn() { setZoomUser((st.zoomLevel || 1) + 0.1); }
    function zoomOut() { setZoomUser((st.zoomLevel || 1) - 0.1); }
    function zoom100() { setZoomUser(1); }
    function zoomFit() { if (!st) return; st.zoomUser = null; fitZoom(); }

    // ---------- ZOOM-TO-FIT sull'altezza (2C) ----------
    function fitZoom() {
        if (!st || !st.canvas || !st.stage || !st.zoom || !st.sheet || !st.canvas.isConnected) return;
        if (st.zoomUser != null) { applyZoomTo(st.zoomUser); return; }
        const availH = st.canvas.clientHeight - CANVAS_PAD_Y * 2;
        const availW = st.canvas.clientWidth - CANVAS_PAD_X * 2;
        if (availH < 80 || availW < 80) { applyZoomTo(1); return; }   // spazio misurabile assente → 100%
        // una pagina riempie l'altezza disponibile (niente scroll verticale se il
        // contenuto ci sta); col contenuto lungo il container scorre. Clamp anche
        // sull'larghezza: margini laterali scuri minimi, mai scroll orizzontale.
        // D3: NESSUN cap a 100% — "Adatta" porta la pagina a piena altezza
        // anche su schermi più alti dell'A4. La larghezza resta clamped (mai
        // scroll orizzontale); il limite 3 coincide col clamp dello zoom
        // manuale (setZoomUser), non genera la fascia (servirebbe >3369px
        // di altezza utile) e anti-sfarfallio su misure estreme.
        let z = Math.min(availH / PAGE_H, availW / PAGE_W, 3);
        if (!(z > 0)) z = 1;
        if (z < 0.12) z = 0.12;
        applyZoomTo(z);
    }

    // ---------- paginazione visiva (2.5) ----------
    function relayoutSoon() {
        if (!st || !st.sheet) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(function () { rafId = null; relayoutPages(); });
    }

    function relayoutPages() {
        if (!st || !st.editor || !st.sheet || !st.breaks || !st.editor.isConnected) return;
        const sheet = st.sheet, paper = st.editor, box = st.breaks;
        // altezza naturale del foglio = contenuto + margini
        const natural = paper.scrollHeight + PAGE_PAD * 2;
        let pages = Math.ceil((natural - 0.01) / PAGE_H);
        if (!isFinite(pages) || pages < 1) pages = 1;
        // D3: altezza ESATTA al contenuto (min una pagina): l'arrotondamento a
        // multipli di PAGE_H creava una fascia bianca fissa sotto il contenuto
        sheet.style.minHeight = Math.max(PAGE_H, Math.ceil(natural)) + 'px';
        st.pageCount = pages;
        // ricalcolo al caricamento delle immagini
        const imgs = paper.querySelectorAll('img');
        for (let i = 0; i < imgs.length; i++) {
            if (!imgs[i].__docRL) {
                imgs[i].__docRL = true;
                imgs[i].addEventListener('load', relayoutSoon);
                imgs[i].addEventListener('error', relayoutSoon);
            }
        }
        // separatori "fine pagina N →"
        if (box.getAttribute('data-pages') !== String(pages)) {
            box.setAttribute('data-pages', String(pages));
            box.innerHTML = '';
            for (let k = 1; k < pages; k++) {
                const d = App.el('div', 'doc-break');
                d.style.top = (k * PAGE_H) + 'px';
                d.innerHTML = '<span>fine pagina ' + k + ' &rarr;</span>';
                box.appendChild(d);
            }
        }
        fitZoom();
    }

    // ---------- selezione (fix per non perdere la selezione) ----------
    function saveSelNow() {
        if (!st || !st.editor || !st.editor.isConnected) return;
        const s = window.getSelection();
        if (!s || !s.rangeCount) return;
        const a = s.anchorNode, f = s.focusNode;
        if (a && f && st.editor.contains(a) && st.editor.contains(f)) {
            savedRange = s.getRangeAt(0).cloneRange();
        }
    }
    function restoreSel() {
        if (!savedRange || !st || !st.editor || !st.editor.isConnected) return;
        try {
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(savedRange);
        } catch (e) { /* selezione non più valida */ }
    }

    function blockOf(node) {
        let n = node;
        while (n && n !== st.editor) {
            if (n.nodeType === 1 && BLOCK_TAGS[n.tagName]) return n;
            n = n.parentNode;
        }
        return null;
    }

    function collectSelBlocks() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return [];
        const range = sel.getRangeAt(0);
        let blocks = [];
        const all = st.editor.querySelectorAll(BLOCK_SEL);
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (el === st.editor) continue;
            let hit = false;
            try { hit = range.intersectsNode(el); } catch (e) { hit = false; }
            if (hit) blocks.push(el);
        }
        // tiene solo i blocchi più profondi (evita doppiettI su wrapper)
        blocks = blocks.filter(function (el) {
            return !blocks.some(function (o) { return o !== el && el.contains(o); });
        });
        if (!blocks.length) {
            const b = blockOf(range.startContainer);
            if (b) blocks.push(b);
        }
        return blocks;
    }

    // ---------- comandi editor (invariati) ----------
    function exec(cmd, val) {
        if (!st || !st.editor) return;
        st.editor.focus();
        restoreSel();
        if (cmd !== 'undo' && cmd !== 'redo') pushUndo();   // D2: stack condiviso
        try {
            if (cmd === 'formatBlock') document.execCommand('formatBlock', false, val);
            else document.execCommand(cmd, false, val == null ? '' : val);
        } catch (e) { console.warn('execCommand ' + cmd + ':', e); }
        afterEdit();
    }

    function afterEdit() {
        scheduleSave();
        updateStats();
        relayoutSoon();
        updateStates();
    }

    // ---------- R21 B3: pannello Fonti (FontiPanel) ----------
    function toggleFpPanel() {
        if (!st) return;
        if (st.fpPanel) { closeFpPanel(); return; }
        if (typeof window.FontiPanel === 'undefined' || !window.FontiPanel ||
            typeof window.FontiPanel.create !== 'function') return;
        const panel = window.FontiPanel.create({ contesto: 'documenti', onInsert: fpInsert });
        st.fpPanel = panel;
        if (shellEl) shellEl.appendChild(panel.el);
        if (st.fpBtn) { st.fpBtn.classList.add('fp-on'); st.fpBtn.setAttribute('aria-expanded', 'true'); }
    }
    function closeFpPanel() {
        if (st && st.fpPanel) { try { st.fpPanel.destroy(); } catch (e) { /* ok */ } st.fpPanel = null; }
        if (st && st.fpBtn) { st.fpBtn.classList.remove('fp-on'); st.fpBtn.setAttribute('aria-expanded', 'false'); }
    }
    // onInsert: blocco 📎 nel documento. Snapshot PRIMA via pushUndo (stack D2),
    // provenienza in st.data.fpSources -> persistita da flush in content.fpSources.
    function fpInsert(src, info) {
        if (!st || !st.editor || !st.editor.isConnected) return;
        const titolo = String((info && info.titolo) || (src && src.title) || 'Fonte');
        const tipo = String((info && info.tipo) || 'Fonte');
        const fonteId = (info && info.id != null) ? info.id : (src && src.id != null ? src.id : '');
        pushUndo();   // PRIMA dell'inserimento: stack snapshot condiviso (D2)
        const p = document.createElement('p');
        p.setAttribute('data-fp-src', String(fonteId));
        p.setAttribute('data-fp-tipo', tipo);
        p.innerHTML = '📎 <i>' + App.esc(titolo) + '</i> (' + App.esc(tipo) + ')';
        st.editor.appendChild(p);
        if (!Array.isArray(st.data.fpSources)) st.data.fpSources = [];
        st.data.fpSources.push({ tipo: tipo, titolo: titolo, fonteId: fonteId, ts: Date.now() });
        afterEdit();
    }

    // corpo carattere 11-48px (execCommand fontSize accetta solo 1-7)
    function setFontSizePx(px) {
        if (!st || !st.editor) return;
        st.editor.focus();
        restoreSel();
        pushUndo();   // D2
        try { document.execCommand('styleWithCSS', false, 'false'); } catch (e) { /* ok */ }
        try { document.execCommand('fontSize', false, '7'); } catch (e) { console.warn('fontSize:', e); }
        fixFontSizes(px);
        afterEdit();
    }
    function fixFontSizes(px) {
        const ed = st.editor;
        const olds = ed.querySelectorAll('font[size="7"]');
        for (let i = 0; i < olds.length; i++) {
            const f = olds[i];
            const span = document.createElement('span');
            span.style.fontSize = px + 'px';
            while (f.firstChild) span.appendChild(f.firstChild);
            if (f.parentNode) f.parentNode.replaceChild(span, f);
        }
        // eventuali span generati in modalità CSS
        const spans = ed.querySelectorAll('span');
        for (let i = 0; i < spans.length; i++) {
            const fs = (spans[i].style.fontSize || '').toLowerCase();
            if (fs.indexOf('xxx-large') >= 0) spans[i].style.fontSize = px + 'px';
        }
    }

    // applica l'interlinea ai paragrafi della selezione
    function applyLineHeight(lh) {
        if (!st || !st.editor) return;
        st.editor.focus();
        restoreSel();
        let blocks = collectSelBlocks();
        if (!blocks.length) {
            try { document.execCommand('formatBlock', false, '<p>'); } catch (e) { /* ok */ }
            blocks = collectSelBlocks();
        }
        if (!blocks.length) {
            notify('Seleziona il testo a cui applicare l\u2019interlinea');
            return;
        }
        pushUndo();   // D2: snapshot solo quando c\u2019 una mutazione da registrare
        blocks.forEach(function (b) { b.style.lineHeight = lh; });
        afterEdit();
    }

    // colore testo / evidenziatore con fallback manuale
    function manualSpan(styleProps, cmd) {
        try {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return false;
            const range = sel.getRangeAt(0);
            if (range.collapsed) return false;
            const span = document.createElement('span');
            Object.keys(styleProps).forEach(function (k) { span.style[k] = styleProps[k]; });
            range.surroundContents(span);
            sel.removeAllRanges();
            const r = document.createRange();
            r.selectNodeContents(span);
            sel.addRange(r);
            return true;
        } catch (e) { return false; }
    }
    function applyColor(cmd, val) {
        if (!st || !st.editor) return;
        st.editor.focus();
        restoreSel();
        pushUndo();   // D2
        let ok = false;
        try { ok = document.execCommand(cmd, false, val); } catch (e) { ok = false; }
        if (!ok && cmd === 'hiliteColor') {
            try { ok = document.execCommand('backColor', false, val); } catch (e) { ok = false; }
        }
        if (!ok) {
            ok = manualSpan(cmd === 'foreColor' ? { color: val } : { backgroundColor: val }, cmd);
        }
        if (!ok) {
            if (st.undoStack && st.undoStack.length) st.undoStack.pop();   // niente mutazione → niente snapshot
            notify('Selezione non valida per il colore');
        }
        afterEdit();
    }

    // stati attivi (arancione) dei pulsanti
    function updateStates() {
        if (!st || !st.editor || !st.editor.isConnected) return;
        Object.keys(stateBtns).forEach(function (cmd) {
            const b = stateBtns[cmd];
            if (!b) return;
            let on = false;
            if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline' || cmd === 'strikeThrough') {
                on = markState(cmd);   // stato letto dalla selezione corrente
            } else {
                try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
            }
            b.classList.toggle('on', !!on);
        });
    }

    // ---------- BLOCCO 4: toggle vero per B/I/U/S ----------
    const MARK_TAG = { bold: ['B', 'STRONG'], italic: ['I', 'EM'], underline: ['U'], strikeThrough: ['S', 'STRIKE', 'DEL'] };
    function isMarkedEl(el, cmd) {
        if (!el || el.nodeType !== 1) return false;
        const t = (el.tagName || '').toUpperCase();
        if ((MARK_TAG[cmd] || []).indexOf(t) >= 0) return true;
        const stl = el.style;
        if (!stl) return false;
        if (cmd === 'bold') {
            const fw = String(stl.fontWeight || '');
            return fw === 'bold' || fw === 'bolder' || (parseInt(fw, 10) || 0) >= 600;
        }
        if (cmd === 'italic') return String(stl.fontStyle || '') === 'italic';
        if (cmd === 'underline') {
            return (String(stl.textDecoration || '') + ' ' + String(stl.textDecorationLine || '')).indexOf('underline') >= 0;
        }
        if (cmd === 'strikeThrough') {
            return (String(stl.textDecoration || '') + ' ' + String(stl.textDecorationLine || '')).indexOf('line-through') >= 0;
        }
        return false;
    }
    function ancestorMarked(node, cmd) {
        let el = node && node.nodeType === 3 ? node.parentNode : node;
        const root = st && st.editor;
        let guard = 0;
        while (el && el !== root && el.nodeType === 1 && guard++ < 60) {
            if (isMarkedEl(el, cmd)) return true;
            el = el.parentNode;
        }
        return false;
    }
    function textsInRange(range) {
        const out = [];
        const root = range.commonAncestorContainer;
        const host = root.nodeType === 1 ? root : root.parentNode;
        if (!host || !host.createTreeWalker && !host.ownerDocument) return out;
        const doc = host.ownerDocument || document;
        try {
            const w = doc.createTreeWalker(root.nodeType === 1 ? root : host, 4 /* SHOW_TEXT */, null, false);
            let n = w.nextNode();
            while (n) {
                let inside = false;
                try { inside = range.intersectsNode(n); } catch (e) { inside = false; }
                if (inside && String(n.nodeValue || '').length) out.push(n);
                n = w.nextNode();
            }
        } catch (e) { /* ok */ }
        return out;
    }
    function selectionHasMark(cmd) {
        try {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return false;
            const range = sel.getRangeAt(0);
            if (range.collapsed) return ancestorMarked(sel.anchorNode, cmd);
            const texts = textsInRange(range);
            if (!texts.length) return ancestorMarked(range.commonAncestorContainer, cmd);
            for (let i = 0; i < texts.length; i++) {
                if (!ancestorMarked(texts[i], cmd)) return false;   // non tutti marcati → il click applica
            }
            return true;
        } catch (e) { return false; }
    }
    // stato del mark sulla selezione corrente (D2): selezione estesa → DOM
    // (queryCommandState resta stale dopo i wrap JS del motore manuale),
    // caret → pending locale, poi nativo, poi DOM.
    function markState(cmd) {
        try {
            const sel0 = window.getSelection();
            const collapsed = !sel0 || !sel0.rangeCount || sel0.getRangeAt(0).collapsed;
            if (!collapsed) return selectionHasMark(cmd);
            if (st && st.typingMarks && st.typingMarks[cmd] != null) return !!st.typingMarks[cmd];
            if (typeof document.queryCommandState === 'function') {
                try { const s = document.queryCommandState(cmd); if (typeof s === 'boolean') return s; } catch (e) { /* fallback DOM */ }
            }
            return selectionHasMark(cmd);
        } catch (e) { return false; }
    }
    function stripMarkDeep(node, cmd) {
        if (!node || !node.querySelectorAll) return;
        const all = node.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (isMarkedEl(el, cmd)) unwrapEl(el);
        }
    }
    function unwrapEl(el) {
        const p = el.parentNode;
        if (!p) return;
        while (el.firstChild) p.insertBefore(el.firstChild, el);
        p.removeChild(el);
    }
    function selectRangeSaved(r) {
        try {
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
            savedRange = r.cloneRange();
        } catch (e) { /* ok */ }
    }

    // confini del range portati a bordo dei nodi figlio (serve a split/unwrap)
    function splitBoundary(range) {
        const sc = range.startContainer, so = range.startOffset;
        const ec = range.endContainer, eo = range.endOffset;
        if (ec && ec.nodeType === 3 && eo > 0 && eo < ec.length) ec.splitText(eo);
        if (sc && sc.nodeType === 3 && so > 0 && so < sc.length) {
            const tail = sc.splitText(so);
            if (range.startContainer === sc) { try { range.setStart(tail, 0); } catch (e) { /* ok */ } }
            if (range.endContainer === sc) { try { range.setEnd(tail, Math.max(0, eo - so)); } catch (e) { /* ok */ } }
        }
    }
    function pointIn(range, node, off) {
        try { return range.comparePoint(node, off) === 0; } catch (e) { return false; }
    }
    // true se tutto il contenuto dell'elemento cade dentro il range (o è vuoto)
    function allContentInRange(el, range) {
        const doc = el.ownerDocument || document;
        let w;
        try { w = doc.createTreeWalker(el, 4 /* SHOW_TEXT */, null, false); } catch (e) { return false; }
        let n = w.nextNode();
        while (n) {
            if (String(n.nodeValue || '').length) {
                if (!pointIn(range, n, 0) || !pointIn(range, n, n.length)) return false;
            }
            n = w.nextNode();
        }
        return true;
    }
    function markedIntersecting(range, cmd) {
        const root = range.commonAncestorContainer;
        const host = root.nodeType === 1 ? root : root.parentNode;
        const out = [];
        if (!host) return out;
        const sel = 'b,strong,i,em,u,s,strike,del,span';
        let list = [];
        try { list = Array.prototype.slice.call(host.querySelectorAll(sel)); } catch (e) { list = []; }
        if (isMarkedEl(host, cmd)) out.push(host);
        let a = host, g = 0;
        while (a && a !== st.editor && a.nodeType === 1 && g++ < 40) {
            if (out.indexOf(a) < 0 && isMarkedEl(a, cmd)) out.push(a);
            a = a.parentNode;
        }
        list.forEach(function (el) {
            if (isMarkedEl(el, cmd) && out.indexOf(el) < 0) out.push(el);
        });
        return out.filter(function (el) {
            try { return range.intersectsNode(el); } catch (e) { return false; }
        });
    }
    function boundaryIndex(el, container, offset) {
        if (container === el) return offset;
        let node = container, g = 0;
        while (node && node.parentNode !== el && g++ < 40) node = node.parentNode;
        if (!node || node.parentNode !== el) return -1;
        return Array.prototype.indexOf.call(el.childNodes, node);
    }
    // indice del PRIMO figlio DOPO la fine del range: il figlio che contiene
    // la fine resta dentro l'elemento (la parte fuori inizia dopo di esso)
    function endBoundaryIndex(el, container, offset) {
        if (container === el) return offset;
        let node = container, g = 0;
        while (node && node.parentNode !== el && g++ < 40) node = node.parentNode;
        if (!node || node.parentNode !== el) return -1;
        return Array.prototype.indexOf.call(el.childNodes, node) + 1;
    }
    // divide l'elemento ai confini: la parte fuori finisce in un clone,
    // la parte dentro resta in el. I confini del range sono salvati prima
    // perché le mutazioni DOM ripuntano i range (comportamento standard del DOM).
    function splitElAtRange(el, range) {
        const parent = el.parentNode;
        if (!parent) return false;
        const sN = range.startContainer, sO = range.startOffset;
        const eN = range.endContainer, eO = range.endOffset;
        let changed = false;
        const idxE = endBoundaryIndex(el, eN, eO);
        if (idxE > 0 && idxE < el.childNodes.length) {
            const clone = el.cloneNode(false);
            while (el.childNodes.length > idxE) clone.appendChild(el.childNodes[idxE]);
            parent.insertBefore(clone, el.nextSibling);
            changed = true;
        }
        const idxS = boundaryIndex(el, sN, sO);
        if (idxS > 0 && idxS <= el.childNodes.length) {
            const clone = el.cloneNode(false);
            let k = idxS;
            while (k > 0) { clone.insertBefore(el.firstChild, clone.firstChild); k--; }
            parent.insertBefore(clone, el);
            changed = true;
        }
        if (changed) {
            // ripristina i confini sui nodi salvati (i contenuti in range non si spostano)
            try {
                range.setStart(sN, sN.nodeType === 3 ? Math.min(sO, sN.length) : sO);
            } catch (e) { /* nodo non più valido */ }
            try {
                range.setEnd(eN, eN.nodeType === 3 ? Math.min(eO, eN.length) : eO);
            } catch (e) { /* nodo non più valido */ }
        }
        return changed;
    }
    // elimina i nodi di testo vuoti lasciati dalle operazioni Range
    function dropEmptyTexts(el) {
        if (!el || !el.childNodes) return;
        const kids = Array.prototype.slice.call(el.childNodes);
        kids.forEach(function (n) {
            if (n.nodeType === 3 && !String(n.nodeValue || '')) {
                if (n.parentNode) n.parentNode.removeChild(n);
            }
        });
    }
    function removeMarkRange(range, cmd) {
        splitBoundary(range);
        const affected = textsInRange(range);   // nodi coinvolti DOPO lo split ai confini
        let guard = 0;
        while (guard++ < 80) {
            const els = markedIntersecting(range, cmd);
            if (!els.length) break;
            let progress = false;
            els.forEach(function (el) {
                if (!el.parentNode) return;
                try { if (!range.intersectsNode(el)) return; } catch (e) { return; }
                if (allContentInRange(el, range)) { unwrapEl(el); progress = true; }
            });
            if (progress) continue;
            let splitOk = false;
            for (let i = 0; i < els.length; i++) {
                if (splitElAtRange(els[i], range)) { splitOk = true; break; }
            }
            if (!splitOk) break;
        }
        // pulizia residui vuoti + riselena (i pulsanti riflettono subito lo stato)
        affected.forEach(function (t) { if (t.parentNode) dropEmptyTexts(t.parentNode); });
        if (affected.length) {
            try {
                const lastA = affected[affected.length - 1];
                const r2 = document.createRange();
                r2.setStart(affected[0], 0);
                r2.setEnd(lastA, lastA.length);
                selectRangeSaved(r2);
            } catch (e) { /* ok */ }
        }
    }
    // APPLICAZIONE per blocco (P/H/LI/TD/DIV…): confini a livello figlio,
    // HTML valido anche su selezioni multi-blocco
    function applyMarkRange(range, cmd) {
        const tag = cmd === 'bold' ? 'b' : cmd === 'italic' ? 'i' : cmd === 'underline' ? 'u' : 's';
        splitBoundary(range);
        const texts = textsInRange(range);
        const blocks = [];
        texts.forEach(function (t) {
            let b = t.parentNode;
            while (b && b !== st.editor && !(b.nodeType === 1 && /^(P|H1|H2|H3|LI|DIV|TD|BLOCKQUOTE)$/.test(b.tagName))) {
                b = b.parentNode;
            }
            if (b && b !== st.editor && blocks.indexOf(b) < 0) blocks.push(b);
        });
        if (!blocks.length) {
            const ca = range.commonAncestorContainer;
            blocks.push(ca.nodeType === 1 ? ca : ca.parentNode);
        }
        const s = window.getSelection();
        let lastWrap = null;
        blocks.forEach(function (block) {
            if (!block || !block.parentNode) return;
            const r = document.createRange();
            try {
                if (block === range.startContainer || block.contains(range.startContainer)) {
                    r.setStart(range.startContainer, range.startOffset);
                } else r.setStart(block, 0);
                if (block === range.endContainer || block.contains(range.endContainer)) {
                    r.setEnd(range.endContainer, range.endOffset);
                } else r.setEnd(block, block.childNodes.length);
                if (r.collapsed) return;
                const frag = r.extractContents();
                stripMarkDeep(frag, cmd);      // niente <b> dentro <b>
                const wrap = document.createElement(tag);
                wrap.appendChild(frag);
                r.insertNode(wrap);
                dropEmptyTexts(block);   // niente nodi vuoti residue
                lastWrap = wrap;
            } catch (e) { /* blocco non gestibile */ }
        });
        if (lastWrap) {
            try {
                const r2 = document.createRange();
                r2.selectNodeContents(lastWrap);
                s.removeAllRanges();
                s.addRange(r2);
                savedRange = r2.cloneRange();
            } catch (e) { /* ok */ }
        }
    }
    // toggle: rimuove se la selezione ha già lo stile, lo applica se non lo ha;
    // con caret commuta lo stato di digitazione per il testo successivo.
    function toggleMark(cmd) {
        if (!st || !st.editor) return;
        st.editor.focus();
        restoreSel();
        const sel = window.getSelection();
        const collapsed = !sel || !sel.rangeCount || sel.getRangeAt(0).collapsed;
        const has = markState(cmd);
        if (collapsed) {
            st.typingMarks = st.typingMarks || {};
            st.typingMarks[cmd] = !has;
            try {
                if (typeof document.execCommand === 'function') {
                    document.execCommand(cmd, false, null);   // pending nativo dove disponibile
                    if (typeof document.queryCommandState === 'function') st.typingMarks[cmd] = !!document.queryCommandState(cmd);
                }
            } catch (e) { /* solo pending locale */ }
            updateStates();
            return;
        }
        const range = sel.getRangeAt(0);
        pushUndo();                                    // D2: snapshot prima della mutazione
        st.typingMarks = null;                         // D2(d): niente pending caret stantio
        if (has) removeMarkRange(range, cmd);
        else applyMarkRange(range, cmd);
        afterEdit();
        updateStates();
    }

    // ---------- D2: undo/redo custom su snapshot HTML (serializeHtml) ----------
    // Le mutazioni fatte via JS (wrap Range, colore, interlinea, dimensione,
    // execCommand) non entrano nello stack nativo: snapshot ad ogni azione di
    // stile/struttura. Ctrl+Z/Ctrl+Y e i bottoni Annulla/Ripeti usano questo
    // stack; con lo stack vuoto si cade sull'undo nativo (digitazione).
    // ---------- H11: AI documenti (F01/F05 selezione, F09 tabella) ----------
    function docSelectionText() {
        try {
            if (savedRange) return savedRange.toString();
            const s = window.getSelection();
            return s ? s.toString() : '';
        } catch (e) { return ''; }
    }
    function docAfterWrite() {
        try {
            const pp = document.querySelector('.doc-paper');
            if (pp) pp.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) { /* ok */ }
        try { scheduleSave() } catch (e) { /* ok */ }
    }
    function docTableHtmlFrom(r) {
        const d = r && r.data;
        if (typeof d === 'string') return d.indexOf('<table') >= 0 ? d : '';
        if (d && typeof d === 'object') {
            if (typeof d.html === 'string' && d.html.indexOf('<table') >= 0) return d.html;
            const rows = d.rows || d.righe || (Array.isArray(d.table) ? d.table : null);
            if (Array.isArray(rows) && rows.length) {
                let html = '<table><tbody>';
                rows.forEach(function (row) {
                    const cells = Array.isArray(row) ? row : (row && (row.cells || row.valori)) || [];
                    html += '<tr>';
                    cells.forEach(function (c2) { html += '<td>' + App.esc(String(c2 == null ? '' : c2)) + '</td>'; });
                    html += '</tr>';
                });
                html += '</tbody></table><p><br></p>';
                return html;
            }
        }
        return '';
    }
    async function aiDocSelection(fid, btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') { notify('AI non disponibile'); return; }
        const text = docSelectionText();
        if (!text || !String(text).trim()) { notify('Seleziona il testo prima'); return; }
        if (fid === 'F01') {
            const res = await AI.runFor(btn, 'F01', { text: text, tipo: 'flashcard', source: 'documenti', materia: (st && st.materia) || 'Generale', n: 3, testo: text });
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
        const res = await AI.runFor(btn, 'F05', { text: text, intent: inp.intent || 'chiaro', source: 'documenti', bozza: text });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const txt = AI.previewText(r);
            if (!txt) return;
            try {
                AI.registerUndo(pushUndo);
                AI.withUndo(function () {
                    const range = savedRange ? savedRange.cloneRange() : null;
                    if (!range) { notify('Selezione non valida'); return; }
                    const sel = window.getSelection();
                    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
                    range.deleteContents();
                    range.insertNode(document.createTextNode(txt));
                    savedRange = null;
                    docAfterWrite();
                });
            } catch (e) { AI.toast('Scrittura non riuscita'); }
        });
    }
    async function aiDocTable(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') { notify('AI non disponibile'); return; }
        const inp = await AI.askInputs('Genera tabella (AI)', [
            { name: 'descrizione', label: 'Descrizione della tabella', placeholder: 'es. confronto tra le due guerre mondiali' }
        ], 'Genera');
        if (!inp || !inp.descrizione) return;
        const res = await AI.runFor(btn, 'F09', { descrizione: inp.descrizione, desc: inp.descrizione });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const html = docTableHtmlFrom(r);
            if (!html) { AI.toast('Nessuna tabella generata'); return; }
            try {
                exec('insertHTML', html);
                docAfterWrite();
            } catch (e) { AI.toast('Inserimento non riuscito'); }
        });
    }

    // ============================================================
    // F67a (R13) - Inserisci citazione da materiali (AI: F06)
    // Menu contestuale sull'editor -> scelta materiale + query ->
    // AIService.runFor('F06', {docs, chunks, q}) -> preview
    // [Accetta]/[Scarta] -> inserimento al cursore con UNDO
    // (registerUndo -> st.undoStack + snapshot html) e badge
    // provenienza (.ai-badge). AI non disponibile / testo non
    // leggibile -> percorso degradata DICHIARATO: estratto manuale
    // con metadati di fonte. MAI eccezione non catturata.
    // ============================================================
    function closeCiteMenu() {
        if (citeMenu) citeMenu.classList.remove('open');
    }

    function pickCitation(r, fallbackSource) {
        const d = r && r.data;
        let obj = d;
        if (typeof d === 'string') {
            try { obj = JSON.parse(d); } catch (e) { obj = null; }
        }
        if (obj && typeof obj === 'object' && Array.isArray(obj.citations) && obj.citations.length) {
            const c = obj.citations[0] || {};
            const quote = String(c.quote || '').trim();
            if (quote) return { quote: quote, source: String(c.source || '').trim() || fallbackSource || '' };
        }
        return null;
    }

    function insertCitation(AI, cit, badgeTxt) {
        if (!st || !st.editor || !st.editor.isConnected) { notify('Nessun documento aperto'); return false; }
        const uid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        let badgeHtml = '';
        try { badgeHtml = AI.badgeEl({ badge: badgeTxt || 'generato da AI' }).outerHTML; } catch (e) { badgeHtml = ''; }
        const html =
            '<span class="ai-cite" data-ai-cite="' + uid + '" data-src="' + App.esc(cit.source || '') + '"' +
            ' title="' + App.esc('Citazione da ' + (cit.source || 'fonte sconosciuta')) + '">' +
            App.esc('\u201c' + cit.quote + '\u201d') +
            (cit.source ? ' <cite>' + App.esc(cit.source) + '</cite>' : '') +
            (badgeHtml ? ' ' + badgeHtml : '') + '</span>';
        const before = st.editor.querySelectorAll('[data-ai-cite]').length;
        const pre = serializeHtml();          // stato identico da ripristinare in undo
        let written = false;
        AI.registerUndo(pushUndo);            // stacco snapshot su st.undoStack
        AI.withUndo(function () {
            try {
                let range = null;
                const sel = window.getSelection();
                if (sel && sel.rangeCount) {
                    const r0 = sel.getRangeAt(0);
                    if (st.editor.contains(r0.commonAncestorContainer)) range = r0.cloneRange();
                }
                if (!range && savedRange && st.editor.contains(savedRange.commonAncestorContainer)) {
                    range = savedRange.cloneRange();
                }
                if (range) {
                    range.deleteContents();
                    const tmp = document.createElement('div');
                    tmp.innerHTML = html;
                    const frag = document.createDocumentFragment();
                    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
                    range.insertNode(frag);
                    written = true;
                }
            } catch (e) { written = false; }
            if (!written) {
                // fallback: coda del documento (selectione assente/collasse)
                const p = document.createElement('p');
                p.innerHTML = html;
                st.editor.appendChild(p);
            }
            written = st.editor.querySelectorAll('[data-ai-cite]').length > before;
            docAfterWrite();
        }, function () {
            // undo: ripristino byte-identico dello stato pre-inserimento
            try { applySnapshot(pre); docAfterWrite(); } catch (e) { /* snapshot non disponibile */ }
        });
        notify(written ? 'Citazione inserita (Ctrl+Z per annullare)' : 'Citazione inserita in coda al documento');
        return written;
    }

    // Percorso degradata: inserimento manuale dell'estratto con metadati
    // di fonte (badge 'manuale'), stesso undo. Nessuna eccezione.
    async function citeManual(AI, docs, q) {
        const inp = await AI.askInputs('Citazione manuale (AI non disponibile)', [
            { name: 'quote', label: 'Estratto da citare', placeholder: 'testo esatto presente nel materiale' },
            { name: 'source', label: 'Fonte (materiale)', value: docs || '' },
            { name: 'q', label: 'Riferimento (opzionale)', value: q || '' }
        ], 'Inserisci');
        if (!inp) return;
        const quote = String(inp.quote || '').trim();
        if (!quote) { notify('Inserisci l\u2019estratto da citare'); return; }
        insertCitation(AI, { quote: quote, source: String(inp.source || '').trim() || 'manuale' }, 'manuale');
    }

    async function aiDocCite(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') { notify('AI non disponibile'); return; }
        if (!st || !st.editor) { notify('Apri un documento prima'); return; }
        // 1) materiali indicizzati (materials_list via StudyStore)
        let mats = [];
        try { mats = (await StudyStore.listMaterials()) || []; } catch (e) { mats = []; }
        if (!mats.length) {
            notify('Nessun materiale: inserisci la citazione manualmente');
            await citeManual(AI, '', '');
            return;
        }
        const inp = await AI.askInputs('Inserisci citazione da materiali', [
            {
                name: 'materiale', label: 'Materiale', type: 'select',
                options: mats.map(function (m) { return { value: m.path, label: m.name || m.path }; })
            },
            { name: 'q', label: 'Domanda / tema della citazione', placeholder: 'es. cosa dice sulle cellule vegetali?' }
        ], 'Cerca citazione');
        if (!inp) return;
        const q = String(inp.q || '').trim();
        if (!q) { notify('Inserisci una domanda per la citazione'); return; }
        const mat = mats.filter(function (m) { return m.path === inp.materiale; })[0] || mats[0];
        const docs = String((mat && (mat.name || mat.path)) || 'materiale');
        // 2) testo materiale -> chunks (read_material_text, cap 5MB lato backend)
        let chunks = '';
        try {
            if (window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.read_material_text === 'function') {
                const rr = await window.pywebview.api.read_material_text(mat.path);
                if (rr && rr.success && rr.text) chunks = String(rr.text);
            }
        } catch (e) { chunks = ''; }
        if (!chunks) {
            notify('Testo materiale non leggibile: inserimento manuale');
            await citeManual(AI, docs, q);
            return;
        }
        // 3) F06 via AIService.runFor -> badge + preview [Accetta]/[Scarta]
        const res = await AI.runFor(btn, 'F06', { docs: docs, chunks: chunks, q: q });
        if (!res) return;
        if (res.fallback || res.data == null) {
            await citeManual(AI, docs, q);   // degradato dichiarato, mai eccezione
            return;
        }
        AI.showPreview(res, function (r) {
            const cit = pickCitation(r, docs);
            if (!cit) { AI.toast('Nessuna citazione valida generata'); return; }
            insertCitation(AI, cit, (r && r.badge) || 'generato da AI');
        });
    }

    function openCiteMenu(x, y) {
        if (!st || !st.editor) return;
        if (!citeMenu) {
            citeMenu = App.el('div', 'doc-dd doc-citemenu');
            const item = App.el('button', 'doc-mi');
            item.type = 'button';
            item.textContent = 'Inserisci citazione da materiali';
            item.title = 'Inserisci citazione da materiali (AI: F06)';
            item.setAttribute('data-ai-f67', 'doc-cite');
            item.addEventListener('click', function () { closeCiteMenu(); aiDocCite(item); });
            citeMenu.appendChild(item);
            document.body.appendChild(citeMenu);
        }
        citeMenu.classList.add('open');
        const mw = citeMenu.offsetWidth, mh = citeMenu.offsetHeight;
        citeMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - mw - 8)) + 'px';
        citeMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - mh - 8)) + 'px';
    }

    function pushUndo() {
        if (!st || !st.editor || !st.undoStack) return;
        try {
            st.undoStack.push(serializeHtml());
            if (st.undoStack.length > 80) st.undoStack.shift();
            st.redoStack.length = 0;
        } catch (e) { /* snapshot non disponibile */ }
    }
    function applySnapshot(html) {
        if (!st || !st.editor) return;
        st.editor.innerHTML = html;
        st.typingMarks = null;
        try {
            const r = document.createRange();
            r.selectNodeContents(st.editor);
            r.collapse(true);
            savedRange = r;
            restoreSel();
        } catch (e) { savedRange = null; }
        afterEdit();
    }
    function undoCmd() {
        if (!st || !st.editor) return;
        if (st.undoStack && st.undoStack.length) {
            st.redoStack.push(serializeHtml());
            applySnapshot(st.undoStack.pop());
        } else {
            exec('undo');   // stack vuoto: undo nativo (digitazione)
        }
    }
    function redoCmd() {
        if (!st || !st.editor) return;
        if (st.redoStack && st.redoStack.length) {
            st.undoStack.push(serializeHtml());
            applySnapshot(st.redoStack.pop());
        } else {
            exec('redo');
        }
    }

    // ---------- trova e sostituisci (logica invariata, UI in popover 2D) ----------
    function clearMarks() {
        if (!st || !st.editor) return;
        const ms = st.editor.querySelectorAll('mark.doc-hit');
        for (let i = 0; i < ms.length; i++) {
            const m = ms[i], p = m.parentNode;
            if (!p) continue;
            while (m.firstChild) p.insertBefore(m.firstChild, m);
            p.removeChild(m);
        }
        if (st.editor.normalize) st.editor.normalize();
        findCount = 0;
        findIdx = 0;
    }

    function markAll(q) {
        clearMarks();
        if (!q || !st || !st.editor) return 0;
        const lower = q.toLowerCase();
        const walker = document.createTreeWalker(st.editor, NodeFilter.SHOW_TEXT, null);
        const nodes = [];
        let n;
        while ((n = walker.nextNode())) nodes.push(n);
        let hits = 0;
        nodes.forEach(function (node) {
            const parent = node.parentNode;
            if (!parent) return;
            const txt = node.nodeValue || '';
            const low = txt.toLowerCase();
            let i = low.indexOf(lower);
            if (i < 0) return;
            const frag = document.createDocumentFragment();
            let last = 0;
            while (i >= 0) {
                if (i > last) frag.appendChild(document.createTextNode(txt.slice(last, i)));
                const mk = document.createElement('mark');
                mk.className = 'doc-hit';
                mk.textContent = txt.slice(i, i + q.length);
                frag.appendChild(mk);
                hits++;
                last = i + q.length;
                i = low.indexOf(lower, last);
            }
            if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
            parent.replaceChild(frag, node);
        });
        findCount = hits;
        return hits;
    }

    function focusHit(idx) {
        const marks = st.editor.querySelectorAll('mark.doc-hit');
        if (!marks.length) return;
        for (let i = 0; i < marks.length; i++) marks[i].classList.remove('doc-cur');
        const j = Math.max(0, Math.min(idx, marks.length - 1));
        marks[j].classList.add('doc-cur');
        try { marks[j].scrollIntoView({ block: 'center' }); } catch (e) { /* ok */ }
        findIdx = j;
    }

    function doFind(cycle) {
        if (!st || !st.editor || !fq) return;
        const q = fq.value;
        if (!q) { clearMarks(); relayoutSoon(); return; }
        const existing = st.editor.querySelectorAll('mark.doc-hit').length;
        if (!(cycle && existing)) {
            const n = markAll(q);
            if (!n) {
                notify('Nessuna occorrenza trovata');
                findIdx = 0;
                relayoutSoon();
                return;
            }
            findCount = n;
            findIdx = 0;
        } else {
            findIdx = (findIdx + 1) % Math.max(existing, 1);
        }
        focusHit(findIdx);
        notify(findCount === 1 ? '1 occorrenza' : findCount + ' occorrenze');
    }

    function replaceMark(m, rep) {
        if (!m || !m.parentNode) return;
        m.parentNode.replaceChild(document.createTextNode(rep), m);
        if (st.editor.normalize) st.editor.normalize();
    }

    function replaceOne() {
        if (!st || !st.editor || !fq) return;
        const q = fq.value;
        const rep = fr ? fr.value : '';
        if (!q) { notify('Inserisci il testo da cercare'); return; }
        let marks = st.editor.querySelectorAll('mark.doc-hit');
        if (!marks.length) {
            markAll(q);
            marks = st.editor.querySelectorAll('mark.doc-hit');
            findIdx = 0;
        }
        if (!marks.length) { notify('Nessuna occorrenza trovata'); return; }
        const target = marks[Math.min(findIdx, marks.length - 1)];
        replaceMark(target, rep);
        findCount = st.editor.querySelectorAll('mark.doc-hit').length;
        if (findCount && findIdx >= findCount) findIdx = 0;
        notify('1 sostituzione');
        afterEdit();
        if (findCount) focusHit(findIdx);
    }

    function replaceAll() {
        if (!st || !st.editor || !fq) return;
        const q = fq.value;
        const rep = fr ? fr.value : '';
        if (!q) { notify('Inserisci il testo da cercare'); return; }
        let marks = st.editor.querySelectorAll('mark.doc-hit');
        if (!marks.length) {
            markAll(q);
            marks = st.editor.querySelectorAll('mark.doc-hit');
        }
        if (!marks.length) { notify('Nessuna occorrenza trovata'); return; }
        const n = marks.length;
        for (let i = 0; i < marks.length; i++) replaceMark(marks[i], rep);
        findCount = 0;
        findIdx = 0;
        notify(n === 1 ? '1 sostituzione' : n + ' sostituzioni');
        afterEdit();
    }

    function toggleFind(open) {
        if (!findPanel || !findBtn) return;
        const willOpen = open == null ? !findPanel.classList.contains('open') : open;
        findPanel.classList.toggle('open', willOpen);
        findBtn.classList.toggle('on', willOpen);
        if (willOpen) {
            if (fq) { fq.focus(); fq.select(); }
        } else {
            clearMarks();
            if (fq) fq.value = '';
            if (fr) fr.value = '';
            updateStats();
            relayoutSoon();
        }
    }

    // ---------- distacco dei listener globali ----------
    function detachGlobal() {
        if (onResize) { window.removeEventListener('resize', onResize); onResize = null; }
        if (onSel) { document.removeEventListener('selectionchange', onSel); onSel = null; }
        if (onDocDown) { document.removeEventListener('mousedown', onDocDown); onDocDown = null; }
        if (onDocCtx) { document.removeEventListener('contextmenu', onDocCtx); onDocCtx = null; }
        if (citeMenu) { try { citeMenu.remove(); } catch (e) { /* ok */ } citeMenu = null; }
        if (onScroll && st && st.canvas) { st.canvas.removeEventListener('scroll', onScroll); }
        onScroll = null;
        if (ro) { try { ro.disconnect(); } catch (e) { /* ok */ } ro = null; }
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (toastEl) { toastEl.remove(); toastEl = null; }
        if (toastT) { clearTimeout(toastT); toastT = null; }
        if (st && st.tMenu) { try { st.tMenu.remove(); } catch (e) { /* ok */ } }
        closeFpPanel();   // R21 B3: destroy() del pannello Fonti (torna all'elenco / close / nuovo doc)
        expMenu = null; findPanel = null; findBtn = null; fq = null; fr = null;
        stateBtns = {};
        savedRange = null;
        shellEl = null; hostEl = null;
    }

    function closeExport() { if (expMenu) expMenu.classList.remove('open'); }
    function closeTableMenu() { if (st && st.tMenu) st.tMenu.classList.remove('open'); }
    function closeOvMenu() { if (st && st.ovMenu) st.ovMenu.classList.remove('open'); }

    // ============================================================
    // 2A - VISTA ELENCO
    // ============================================================

    // righe fittizie per la miniatura (1-2 righe prese dal contenuto)
    function thumbLines(text) {
        if (!text) return [];
        const out = [];
        let rest = text;
        while (out.length < 2 && rest) {
            let cut = rest.length;
            if (rest.length > 44) {
                cut = rest.lastIndexOf(' ', 44);
                if (cut < 10) cut = 44;
            }
            out.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut).trim();
        }
        return out;
    }

    function actBtn(svg, title, fn) {
        const b = App.el('button', 'dc-act');
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = svg;
        b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
        return b;
    }

    function cardFor(container, it) {
        const text = stripHtml(parseContent(it).html);
        const words = text ? text.split(/\s+/).length : 0;

        const card = App.el('div', 'dc-card');
        card.tabIndex = 0;

        // miniatura: pagina bianca A4 in scala con 1-2 righe di testo
        const thumb = App.el('div', 'dc-thumb');
        thumbLines(text).forEach(function (ln) {
            thumb.appendChild(App.el('div', 'ln', App.esc(ln)));
        });
        const acts = App.el('div', 'dc-acts');
        acts.appendChild(actBtn(I_OPEN, 'Apri il documento', function () { openEditor(container, it.id); }));
        acts.appendChild(actBtn(I_PEN, 'Rinomina', function () { renItem(container, it); }));
        acts.appendChild(actBtn(I_COPY, 'Duplica', function () { dupItem(container, it); }));
        acts.appendChild(actBtn(I_TRASH, 'Elimina', function () { delItem(container, it); }));
        thumb.appendChild(acts);
        card.appendChild(thumb);

        card.appendChild(App.el('div', 'dc-name', App.esc(it.title || 'Senza titolo')));
        const sub = App.el('div', 'dc-sub');
        sub.innerHTML =
            '<span>' + App.esc(App.fmtDate(it.updated_at)) + '</span>' +
            '<span>' + words.toLocaleString('it-IT') + ' parole</span>';
        card.appendChild(sub);

        function open() { openEditor(container, it.id); }
        card.addEventListener('click', open);
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        return card;
    }

    async function renItem(container, it) {
        const t = await ask('Titolo documento', it.title);
        if (t == null || !t.trim()) return;
        await StudyStore.renameItem(it.id, t.trim());
        showList(container);
    }
    async function dupItem(container, it) {
        try { await StudyStore.duplicateItem(it.id); } catch (e) { console.error(e); }
        showList(container);
    }
    async function delItem(container, it) {
        if (!confirm('Eliminare il documento "' + (it.title || '') + '"?')) return;
        await StudyStore.deleteItem(it.id);
        showList(container);
    }

    async function showList(container) {
        await flush();
        detachGlobal();
        st = null;
        root = container;
        hostEl = container;
        container.innerHTML = '';

        // ---------- shell: [barra46][contenuto][status26] ----------
        const shell = App.el('div', 'doc-shell');
        shellEl = shell;
        container.appendChild(shell);

        // ===== 2A: BARRA =====
        const bar = App.el('div', 'doc-bar');
        shell.appendChild(bar);

        const left = App.el('div', 'doc-grp');
        const back = App.el('button', 'doc-btn');
        back.type = 'button';
        back.innerHTML = '&larr; Produttività';
        back.title = 'Torna alla sezione Produttività';
        back.addEventListener('click', function () { App.go('produttivita'); });
        left.appendChild(back);

        const btnNew = App.el('button', 'doc-btn accent');
        btnNew.type = 'button';
        btnNew.innerHTML = PLUS + ' Nuovo documento';
        btnNew.title = 'Crea un nuovo documento';
        btnNew.addEventListener('click', createNew);
        left.appendChild(btnNew);
        bar.appendChild(left);

        bar.appendChild(App.el('div', 'doc-bartitle', 'Documenti'));

        const right = App.el('div', 'doc-grp doc-barright');
        const search = App.el('input', 'doc-search');
        search.type = 'search';
        search.placeholder = 'Cerca…';
        search.title = 'Cerca nei tuoi documenti';
        search.value = listQ;
        right.appendChild(search);

        const sort = App.el('select', 'doc-sel doc-sort');
        sort.title = 'Ordina i documenti';
        [['name', 'Nome'], ['date-desc', 'Data recente'], ['date-asc', 'Data antica']].forEach(function (o) {
            const op = document.createElement('option');
            op.value = o[0];
            op.textContent = o[1];
            sort.appendChild(op);
        });
        sort.value = listSort;
        right.appendChild(sort);
        bar.appendChild(right);

        // ===== contenuto (griglia / empty state) =====
        const main = App.el('div', 'doc-main');
        shell.appendChild(main);
        const content = App.el('div', 'doc-content');
        main.appendChild(content);

        // ===== status 26px =====
        const status = App.el('div', 'doc-status');
        const stLeft = App.el('span', 'doc-stats');
        const stRight = App.el('span', 'doc-pager');
        status.appendChild(stLeft);
        status.appendChild(stRight);
        shell.appendChild(status);

        let items = [];
        try { items = await StudyStore.listItems('documento'); } catch (e) { console.error(e); }

        const SORT_LABEL = { 'name': 'Nome', 'date-desc': 'Data recente', 'date-asc': 'Data antica' };

        function filtered() {
            const q = (listQ || '').trim().toLowerCase();
            let arr = items.filter(function (it) {
                return !q || String(it.title || 'Senza titolo').toLowerCase().indexOf(q) >= 0;
            });
            arr = arr.slice();
            if (listSort === 'name') {
                arr.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'it'); });
            } else if (listSort === 'date-asc') {
                arr.sort(function (a, b) { return String(a.updated_at || '').localeCompare(String(b.updated_at || '')); });
            } else {
                arr.sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
            }
            return arr;
        }

        function renderGrid() {
            content.innerHTML = '';
            const arr = filtered();
            if (!items.length) {
                content.appendChild(App.empty(ICON,
                    'Nessun documento ancora: usa "Nuovo documento" per iniziare a scrivere.',
                    'Nuovo documento', createNew));
            } else if (!arr.length) {
                content.appendChild(App.empty(I_SEARCH,
                    'Nessun documento corrisponde alla ricerca "' + listQ.trim() + '".'));
            } else {
                const grid = App.el('div', 'dc-grid');
                arr.forEach(function (it) { grid.appendChild(cardFor(container, it)); });
                content.appendChild(grid);
            }
            stLeft.textContent = arr.length === items.length
                ? (items.length === 1 ? '1 documento' : items.length.toLocaleString('it-IT') + ' documenti')
                : arr.length.toLocaleString('it-IT') + ' di ' + items.length.toLocaleString('it-IT') + ' documenti';
            stRight.textContent = 'Ordina: ' + (SORT_LABEL[listSort] || 'Data recente');
        }

        search.addEventListener('input', function () { listQ = search.value; renderGrid(); });
        sort.addEventListener('change', function () { listSort = sort.value; renderGrid(); });
        renderGrid();

        fitShell();
        requestAnimationFrame(function () { fitShell(); });
        onResize = function () { fitShell(); };
        window.addEventListener('resize', onResize);
    }

    async function createNew() {
        const t = await ask('Titolo documento',
            'Documento senza titolo ' + new Date().toLocaleDateString('it-IT'));
        if (t == null) return;
        let item = null;
        try {
            item = await StudyStore.saveItem({
                kind: 'documento',
                title: t.trim() || 'Documento senza titolo',
                content: JSON.stringify({ html: '' })
            });
        } catch (e) { console.error(e); }
        if (item && item.id && root) openEditor(root, item.id);
        else if (root) showList(root);
    }

    // ============================================================
    // 2B - BARRA DELL'EDITORE (riga unica + overflow "…")
    // ============================================================

    function isep(parent) {
        const s = App.el('span', 'doc-isep');
        s.setAttribute('aria-hidden', 'true');
        parent.appendChild(s);
        return s;
    }

    function iconBtn(parent, svg, title, handler) {
        const b = App.el('button', 'doc-ib');
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = svg;
        // mousedown preventDefault: non si perde la selezione nel paper
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', handler);
        parent.appendChild(b);
        return b;
    }
    function mkSel(parent, title, opts, onChange) {
        const s = App.el('select', 'doc-sel');
        s.title = title;
        s.setAttribute('aria-label', title);
        opts.forEach(function (o) {
            const op = document.createElement('option');
            op.value = o[0];
            op.textContent = o[1];
            s.appendChild(op);
        });
        s.addEventListener('change', function () { restoreSel(); onChange(s.value); });
        parent.appendChild(s);
        return s;
    }
    function colorBtn(parent, title, cmd, initial, iconHtml, colorizeBar) {
        const w = App.el('span', 'doc-swatch');
        w.title = title;
        w.innerHTML = iconHtml;
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = initial;
        inp.title = title;
        w.appendChild(inp);
        inp.addEventListener('input', function () {
            applyColor(cmd, inp.value);
            if (colorizeBar) {
                const bar = w.querySelector('.doc-fg-bar');
                if (bar) bar.setAttribute('stroke', inp.value);
            }
        });
        parent.appendChild(w);
        return w;
    }

    // overflow: sposta le celle secondarie (prio crescente = prima da nascondere)
    // nel menu "…" finché la riga entra in una sola riga
    function manageOverflow() {
        if (!st || !st.track || !st.cells || !st.track.isConnected || !st.ovMenu || !st.ovBtn) return;
        const track = st.track;
        // 1) ripristina l'ordine originale (svuota il menu)
        st.cells.forEach(function (c) { track.appendChild(c.el); });
        st.ovMenu.classList.remove('open');
        // 2) misura: somma larghezze reali + gap
        function overflowed() {
            const kids = track.children;
            let sum = 0;
            for (let i = 0; i < kids.length; i++) sum += kids[i].offsetWidth;
            if (kids.length > 1) sum += 6 * (kids.length - 1);
            return sum - track.clientWidth > 1;
        }
        // 3) sposta le secondarie finché non entra (una riga)
        let guard = st.cells.length + 2;
        while (overflowed() && guard-- > 0) {
            let best = null;
            for (let i = 0; i < st.cells.length; i++) {
                const c = st.cells[i];
                if (!c.sec || c.prio <= 0 || c.el.parentNode !== track) continue;
                if (!best || c.prio < best.prio) best = c;
            }
            if (!best) break;
            st.ovMenu.appendChild(best.el);
        }
        const has = st.ovMenu.children.length > 0;
        st.ovBtn.style.display = has ? '' : 'none';
        if (!has) st.ovMenu.classList.remove('open');
    }

    async function openEditor(container, id) {
        const item = await StudyStore.getItem(id);
        if (!item) { showList(container); return; }
        detachGlobal();
        root = container;
        hostEl = container;
        st = {
            id: item.id, title: item.title || 'Documento senza titolo', data: parseContent(item),
            editor: null, sheet: null, breaks: null, badge: null, status: null, pager: null,
            undoStack: [], redoStack: [],
            canvas: null, stage: null, zoom: null, zoomLevel: 1, pageCount: 1,
            bar: null, track: null, cells: [], ovBtn: null, ovMenu: null, ovWrap: null,
            tBtn: null, tMenu: null, tWrap: null,
            fpPanel: null, fpBtn: null
        };
        container.innerHTML = '';

        // ---------- shell: [barra46][contenuto flex] + pill overlay D1 (niente status) ----------
        const shell = App.el('div', 'doc-shell');
        shellEl = shell;
        container.appendChild(shell);
        // cattura la selezione prima che barra/popover rubino il focus
        shell.addEventListener('mousedown', saveSelNow, true);
        // D2: Ctrl+Z / Ctrl+Y sullo stack custom (fallback nativo se vuoto)
        shell.addEventListener('keydown', function (e) {
            if (!st || !st.editor) return;
            if (!e.ctrlKey && !e.metaKey) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
            const k = String(e.key || '').toLowerCase();
            if (k === 'z' && !e.shiftKey) {
                if (st.undoStack && st.undoStack.length) { e.preventDefault(); undoCmd(); }
            } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
                if (st.redoStack && st.redoStack.length) { e.preventDefault(); redoCmd(); }
            }
        });

        // ===== BARRA UNICA (2B) =====
        const bar = App.el('div', 'doc-bar');
        st.bar = bar;
        shell.appendChild(bar);

        const track = App.el('div', 'doc-track');
        st.track = track;
        bar.appendChild(track);
        const cells = st.cells;
        function cell(sec, prio, noSep) {
            const c = App.el('div', 'doc-grp');
            if (noSep) c.classList.add('doc-mg0');
            track.appendChild(c);
            cells.push({ el: c, sec: !!sec, prio: prio || 0 });
            return c;
        }

        // [← Elenco][undo/redo]
        const cNav = cell(0, 0);
        const back = App.el('button', 'doc-btn');
        back.type = 'button';
        back.innerHTML = '&larr; Elenco';
        back.title = 'Torna all\u2019elenco documenti';
        back.addEventListener('click', function () { showList(root); });
        cNav.appendChild(back);
        isep(cNav);
        iconBtn(cNav, I_UNDO, 'Annulla (Ctrl+Z)', function () { undoCmd(); });
        iconBtn(cNav, I_REDO, 'Ripeti (Ctrl+Y)', function () { redoCmd(); });

        // [titolo input + badge autosave]
        const cTitle = cell(0, 0);
        cTitle.classList.add('doc-titlecell');
        const tInp = App.el('input', 'doc-title');
        tInp.type = 'text';
        tInp.value = st.title;
        tInp.placeholder = 'Titolo documento';
        tInp.title = 'Titolo del documento (modificalo qui per rinominare)';
        tInp.addEventListener('input', function () { st.title = tInp.value; scheduleSave(); });
        tInp.addEventListener('change', function () {
            const v = tInp.value.trim() || 'Documento senza titolo';
            tInp.value = v;
            st.title = v;
            try { StudyStore.renameItem(st.id, v); } catch (e) { console.error(e); }
            scheduleSave();
        });
        tInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tInp.blur(); } });
        cTitle.appendChild(tInp);
        const badge = App.el('span', 'doc-save saved');
        const t0 = fmtTime(item.updated_at) || fmtTime(new Date().toISOString());
        badge.textContent = 'Salvato \u2713 ' + t0;
        st.badge = badge;
        cTitle.appendChild(badge);

        // [blocco ▾][font ▾][size ▾]
        const cBlocks = cell(0, 0);
        mkSel(cBlocks, 'Stile del testo', [
            ['', 'Paragrafo'], ['<h1>', 'Titolo 1'], ['<h2>', 'Titolo 2'], ['<h3>', 'Titolo 3']
        ], function (v) { exec('formatBlock', v || '<p>'); });

        const cFont = cell(1, 5, true);
        mkSel(cFont, 'Carattere del testo', [
            ['', 'Carattere'], ['Arial', 'Arial'], ['Georgia', 'Georgia'],
            ['Consolas', 'Consolas'], ['system-ui', 'system-ui']
        ], function (v) { if (v) exec('fontName', v); });

        const cSize = cell(1, 6, true);
        mkSel(cSize, 'Corpo del testo (11-48)', (function () {
            const o = [['', 'Corpo']];
            for (let s = 11; s <= 48; s++) o.push([String(s), String(s)]);
            return o;
        })(), function (v) { if (v) setFontSizePx(parseInt(v, 10)); });

        // [B, I, U, S, colore testo ▦, evidenziatore ▨]
        const cFmt = cell(0, 0);
        stateBtns.bold = iconBtn(cFmt, I_B, 'Grassetto (Ctrl+B)', function () { toggleMark('bold'); });
        stateBtns.italic = iconBtn(cFmt, I_I, 'Corsivo (Ctrl+I)', function () { toggleMark('italic'); });
        stateBtns.underline = iconBtn(cFmt, I_U, 'Sottolineato (Ctrl+U)', function () { toggleMark('underline'); });
        stateBtns.strikeThrough = iconBtn(cFmt, I_S, 'Barrato', function () { toggleMark('strikeThrough'); });
        colorBtn(cFmt, 'Colore del testo selezionato', 'foreColor', '#d93a3a', I_FG, true);
        colorBtn(cFmt, 'Evidenziatore (colore evidenziazione)', 'hiliteColor', '#ffe36e', I_HL, false);

        // [allinea sx / centro / dx][interlinea ▾]
        const cAlign = cell(0, 0);
        stateBtns.justifyLeft = iconBtn(cAlign, I_AL, 'Allinea a sinistra', function () { exec('justifyLeft'); });
        stateBtns.justifyCenter = iconBtn(cAlign, I_AC, 'Allinea al centro', function () { exec('justifyCenter'); });
        stateBtns.justifyRight = iconBtn(cAlign, I_AR, 'Allinea a destra', function () { exec('justifyRight'); });

        const cLh = cell(1, 4, true);
        mkSel(cLh, 'Interlinea', [
            ['', 'Interlinea'], ['1', '1.0'], ['1.5', '1.5'], ['2', '2.0']
        ], function (v) { if (v) applyLineHeight(v); });

        // [lista puntata, lista numerata, indent −/+]
        const cLists = cell(1, 7);
        iconBtn(cLists, I_UL, 'Lista puntata', function () { exec('insertUnorderedList'); });
        iconBtn(cLists, I_OL, 'Lista numerata', function () { exec('insertOrderedList'); });
        iconBtn(cLists, I_OUTDENT, 'Riduci rientro', function () { exec('outdent'); });
        iconBtn(cLists, I_INDENT, 'Aumenta rientro', function () { exec('indent'); });

        // [immagine]
        const cImg = cell(1, 3);
        iconBtn(cImg, I_IMG, 'Inserisci un\u2019immagine locale', async function () {
            const url = await pickImage();
            if (!url) return;
            exec('insertImage', url);
        });

        // [tabella ▾] (menu a dimensioni + riga orizzontale secondaria)
        const cTable = cell(1, 2, true);
        st.tWrap = cTable;
        const tBtn = iconBtn(cTable, I_TABLE + '<span class="doc-caret">&#9662;</span>', 'Inserisci una tabella', function (e) {
            e.stopPropagation();
            if (st.tMenu && st.tMenu.classList.contains('open')) { closeTableMenu(); return; }
            openTableMenu();
        });
        tBtn.style.width = 'auto';
        tBtn.style.padding = '0 7px';
        tBtn.style.gap = '3px';
        st.tBtn = tBtn;

        const tMenu = App.el('div', 'doc-dd');
        function insertTable(rows, cols) {
            let html = '<table><tbody>';
            for (let r = 0; r < rows; r++) {
                html += '<tr>';
                for (let c = 0; c < cols; c++) html += '<td><br></td>';
                html += '</tr>';
            }
            html += '</tbody></table><p><br></p>';
            exec('insertHTML', html);
        }
        [['Tabella 2\u00d72', 2, 2], ['Tabella 3\u00d72 (predefinita)', 3, 2], ['Tabella 4\u00d73', 4, 3]].forEach(function (a) {
            const b = App.el('button', 'doc-mi');
            b.type = 'button';
            b.textContent = a[0];
            b.addEventListener('click', function () { closeTableMenu(); insertTable(a[1], a[2]); });
            tMenu.appendChild(b);
        });
        const tSep = App.el('div', 'doc-ddsep');
        tMenu.appendChild(tSep);
        const tHr = App.el('button', 'doc-mi');
        tHr.type = 'button';
        tHr.textContent = 'Riga orizzontale';
        tHr.title = 'Inserisci una riga orizzontale';
        tHr.addEventListener('click', function () { closeTableMenu(); exec('insertHorizontalRule'); });
        tMenu.appendChild(tHr);
        // ---- H11: genera tabella (F09) ----
        const tAi = App.el('button', 'doc-mi');
        tAi.type = 'button';
        tAi.textContent = 'Tabella AI';
        tAi.title = 'Genera una tabella dalla descrizione (AI: F09)';
        tAi.addEventListener('click', function () { closeTableMenu(); aiDocTable(tAi); });
        tMenu.appendChild(tAi);
        document.body.appendChild(tMenu);
        st.tMenu = tMenu;

        // ---- H11: azioni AI su selezione testo (F01/F05) ----
        const cAiSel = cell(0, 0);
        const aiCard = App.el('button', 'doc-btn');
        aiCard.type = 'button';
        aiCard.textContent = 'Flashcard';
        aiCard.title = 'Flashcard dalla selezione (AI: F01)';
        aiCard.addEventListener('click', function (e) { aiDocSelection('F01', e.currentTarget); });
        cAiSel.appendChild(aiCard);
        const aiImp = App.el('button', 'doc-btn');
        aiImp.type = 'button';
        aiImp.textContent = 'Migliora';
        aiImp.title = 'Migliora testo selezionato (AI: F05): chiaro / conciso / formale';
        aiImp.addEventListener('click', function (e) { aiDocSelection('F05', e.currentTarget); });
        cAiSel.appendChild(aiImp);

        // ---- R21 B3: pannello Fonti (FontiPanel montato on-demand, solo editor) ----
        const cFp = cell(0, 0);
        const fpBtn = App.el('button', 'doc-btn');
        fpBtn.type = 'button';
        fpBtn.textContent = 'Fonti';
        fpBtn.title = 'Apri/chiudi il pannello Fonti';
        fpBtn.addEventListener('click', function () { toggleFpPanel(); });
        cFp.appendChild(fpBtn);
        st.fpBtn = fpBtn;

        function openTableMenu() {
            if (!st || !st.tMenu || !st.tBtn) return;
            st.tMenu.classList.add('open');
            const r = st.tBtn.getBoundingClientRect();
            const mw = st.tMenu.offsetWidth, mh = st.tMenu.offsetHeight;
            let left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
            let top = r.bottom + 6;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
            st.tMenu.style.left = left + 'px';
            st.tMenu.style.top = top + 'px';
        }

        // [riga ─]
        const cHr = cell(1, 1, true);
        iconBtn(cHr, I_HR, 'Riga orizzontale', function () { exec('insertHorizontalRule'); });

        // [trova 🔍] + POPOVER trova&sostituisci (2D)
        const cFind = cell(0, 0);
        cFind.classList.add('doc-findwrap');
        findBtn = iconBtn(cFind, I_SEARCH, 'Trova e sostituisci', function () { toggleFind(); });

        const findP = App.el('div', 'doc-find');
        fq = App.el('input', 'doc-finput');
        fq.type = 'search';
        fq.placeholder = 'Trova…';
        fq.title = 'Testo da cercare';
        fr = App.el('input', 'doc-finput');
        fr.type = 'text';
        fr.placeholder = 'Sostituisci con…';
        fr.title = 'Testo di sostituzione';
        const bFind = App.el('button', 'doc-fbtn', 'Trova');
        bFind.type = 'button'; bFind.title = 'Trova la prossima occorrenza';
        const bRep = App.el('button', 'doc-fbtn', 'Sostituisci');
        bRep.type = 'button'; bRep.title = 'Sostituisci la corrispondenza corrente';
        const bAll = App.el('button', 'doc-fbtn', 'Tutti');
        bAll.type = 'button'; bAll.title = 'Sostituisci tutte le occorrenze';
        const bCls = App.el('button', 'doc-fbtn', '\u2715');
        bCls.type = 'button'; bCls.title = 'Chiudi trova e sostituisci';
        bFind.addEventListener('mousedown', function (e) { e.preventDefault(); });
        bRep.addEventListener('mousedown', function (e) { e.preventDefault(); });
        bAll.addEventListener('mousedown', function (e) { e.preventDefault(); });
        bCls.addEventListener('mousedown', function (e) { e.preventDefault(); });
        bFind.addEventListener('click', function () { doFind(true); });
        bRep.addEventListener('click', function () { replaceOne(); });
        bAll.addEventListener('click', function () { replaceAll(); });
        bCls.addEventListener('click', function () { toggleFind(false); });
        fq.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); doFind(true); }
            if (e.key === 'Escape') { e.preventDefault(); toggleFind(false); }
        });
        fr.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
            if (e.key === 'Escape') { e.preventDefault(); toggleFind(false); }
        });
        findP.appendChild(fq); findP.appendChild(fr);
        findP.appendChild(bFind); findP.appendChild(bRep); findP.appendChild(bAll); findP.appendChild(bCls);
        cFind.appendChild(findP);
        findPanel = findP;

        // [⋯ overflow "…" per le azioni secondarie]
        const ovWrap = App.el('div', 'doc-ovwrap');
        st.ovWrap = ovWrap;
        const ovBtn = App.el('button', 'doc-ib');
        ovBtn.type = 'button';
        ovBtn.title = 'Altre azioni';
        ovBtn.setAttribute('aria-label', 'Altre azioni');
        ovBtn.innerHTML = I_DOTS;
        ovBtn.style.display = 'none';
        ovBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (st.ovMenu) st.ovMenu.classList.toggle('open');
        });
        const ovMenu = App.el('div', 'doc-ovmenu');
        ovWrap.appendChild(ovBtn);
        ovWrap.appendChild(ovMenu);
        bar.appendChild(ovWrap);
        st.ovBtn = ovBtn;
        st.ovMenu = ovMenu;

        // [Export ▾] a destra (le tre azioni esistenti, stesso codice)
        const expWrap = App.el('div', 'doc-export-wrap');
        const expBtn = App.el('button', 'doc-btn');
        expBtn.type = 'button';
        expBtn.title = 'Esporta il documento';
        expBtn.innerHTML = 'Export <span class="doc-caret">&#9662;</span>';
        const menu = App.el('div', 'doc-export-menu');
        [['Markdown', 'Esporta in Markdown', exportMd],
         ['HTML', 'Esporta HTML standalone', exportHtml],
         ['Stampa/PDF', 'Stampa o salva come PDF', printDoc]].forEach(function (a) {
            const b = App.el('button', 'doc-mi');
            b.type = 'button';
            b.textContent = a[0];
            b.title = a[1];
            b.addEventListener('click', function () { closeExport(); a[2](); });
            menu.appendChild(b);
        });
        expBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.classList.toggle('open');
        });
        expWrap.appendChild(expBtn);
        expWrap.appendChild(menu);
        bar.appendChild(expWrap);
        expMenu = menu;

        // ===== 2C: CENTRO - foglio A4 bianco su fondo scuro con zoom-to-fit =====
        const main = App.el('div', 'doc-main');
        shell.appendChild(main);
        const canvas = App.el('div', 'doc-canvas');
        const stage = App.el('div', 'doc-stage');
        const zoom = App.el('div', 'doc-zoom');
        stage.appendChild(zoom);
        canvas.appendChild(stage);
        main.appendChild(canvas);
        st.canvas = canvas;
        st.stage = stage;
        st.zoom = zoom;

        const sheet = App.el('div', 'doc-page');
        const paper = App.el('div', 'doc-paper');
        paper.contentEditable = 'true';
        paper.spellcheck = true;
        paper.setAttribute('role', 'textbox');
        paper.setAttribute('aria-label', 'Contenuto del documento');
        paper.innerHTML = st.data.html || '';
        const breaks = App.el('div', 'doc-breaks');
        breaks.setAttribute('data-pages', '1');
        sheet.appendChild(paper);
        sheet.appendChild(breaks);
        zoom.appendChild(sheet);
        st.editor = paper;
        st.sheet = sheet;
        st.breaks = breaks;

        // clic fuori dal testo ma dentro il foglio → caret a fine documento
        sheet.addEventListener('mousedown', function (e) {
            if (e.target === sheet) {
                e.preventDefault();
                paper.focus();
                try {
                    const r = document.createRange();
                    r.selectNodeContents(paper);
                    r.collapse(false);
                    const s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(r);
                    savedRange = r.cloneRange();
                } catch (err) { /* ok */ }
            }
        });

        paper.addEventListener('input', function () {
            if (st) st.typingMarks = null;   // D2(d): niente pending stantio dopo la digitazione
            afterEdit();
        });
        paper.addEventListener('blur', function () { saveSelNow(); scheduleSave(); });
        paper.addEventListener('keyup', function () { updateStates(); saveSelNow(); });
        paper.addEventListener('mouseup', function () { updateStates(); saveSelNow(); });

        // ===== 2E/D1: PILL OVERLAY su .doc-main (niente fascia full-width) =====
        // pill sinistra: parole . caratteri . Pagina x/y
        // (la % di zoom vive solo nella pill destra, col gruppo zoom)
        const pillL = App.el('div', 'doc-pill doc-pill-l');
        st.status = App.el('span', 'doc-stats', '0 parole \u00b7 0 caratteri');
        st.pager = App.el('span', 'doc-pager', 'Pagina 1/1');
        pillL.appendChild(st.status);
        pillL.appendChild(App.el('span', 'doc-pillsep', ' \u00b7 '));
        pillL.appendChild(st.pager);
        // BLOCCO 4/D1: controlli zoom nella pill destra
        const zgrp = App.el('span', 'doc-zoomgrp');
        const zbOut = App.el('button', 'doc-zbtn');
        zbOut.type = 'button'; zbOut.title = 'Riduci zoom (\u2212)'; zbOut.textContent = '\u2212';
        zbOut.addEventListener('click', zoomOut);
        const zv = App.el('span', 'doc-zoomval', '100%');
        zv.title = 'Zoom corrente';
        const zbIn = App.el('button', 'doc-zbtn');
        zbIn.type = 'button'; zbIn.title = 'Aumenta zoom (+)'; zbIn.textContent = '+';
        zbIn.addEventListener('click', zoomIn);
        const zbFit = App.el('button', 'doc-zbtn');
        zbFit.type = 'button'; zbFit.title = 'Adatta la pagina allo spazio disponibile'; zbFit.textContent = 'Adatta';
        zbFit.addEventListener('click', zoomFit);
        const zb100 = App.el('button', 'doc-zbtn');
        zb100.type = 'button'; zb100.title = 'Zoom al 100%'; zb100.textContent = '100%';
        zb100.addEventListener('click', zoom100);
        zgrp.appendChild(zbOut);
        zgrp.appendChild(zv);
        zgrp.appendChild(zbIn);
        zgrp.appendChild(zbFit);
        zgrp.appendChild(zb100);
        st.zoomVal = zv;
        st.zoomUser = null;
        const pillR = App.el('div', 'doc-pill doc-pill-r');
        pillR.appendChild(zgrp);
        main.appendChild(pillL);
        main.appendChild(pillR);

        // ===== listener globali =====
        onResize = function () {
            fitShell();
            relayoutSoon();
            manageOverflow();
        };
        window.addEventListener('resize', onResize);

        onScroll = function () { updatePager(); };
        canvas.addEventListener('scroll', onScroll, { passive: true });

        onSel = function () {
            if (!st || !st.editor || !st.editor.isConnected) return;
            const selNow = window.getSelection();
            if (selNow && selNow.rangeCount && !selNow.getRangeAt(0).collapsed) st.typingMarks = null;
            saveSelNow();
            updateStates();
        };
        document.addEventListener('selectionchange', onSel);

        onDocDown = function (e) {
            if (expMenu && expWrap && !expWrap.contains(e.target)) closeExport();
            if (st && st.tMenu && st.tMenu.classList.contains('open') &&
                !(st.tWrap && st.tWrap.contains(e.target)) && !st.tMenu.contains(e.target)) closeTableMenu();
            if (st && st.ovMenu && st.ovMenu.classList.contains('open') &&
                st.ovWrap && !st.ovWrap.contains(e.target)) closeOvMenu();
            if (citeMenu && citeMenu.classList.contains('open') && !citeMenu.contains(e.target)) closeCiteMenu();
        };
        document.addEventListener('mousedown', onDocDown);

        // F67a: menu contestuale "Inserisci citazione da materiali" sull'editor
        onDocCtx = function (e) {
            if (!st || !st.editor || !st.editor.isConnected) { closeCiteMenu(); return; }
            const t = e.target;
            if (!t || !st.editor.contains(t)) { closeCiteMenu(); return; }
            if (e.preventDefault) e.preventDefault();
            openCiteMenu(e.clientX || 0, e.clientY || 0);
        };
        document.addEventListener('contextmenu', onDocCtx);

        if (window.ResizeObserver) {
            try {
                ro = new ResizeObserver(function () {
                    relayoutSoon();
                    if (st && st.track) manageOverflow();
                });
                ro.observe(paper);
                ro.observe(canvas);
                if (st.bar) ro.observe(st.bar);
            } catch (e) { ro = null; }
        }

        // ===== inizializzazione =====
        fitShell();
        updateStats();
        updateStates();
        relayoutPages();
        manageOverflow();
        requestAnimationFrame(function () {
            fitShell();
            relayoutPages();
            manageOverflow();
        });
        setTimeout(function () {
            fitShell();
            relayoutPages();
            updateStats();
            manageOverflow();
        }, 150);
    }

    // ---------- export (2.6: nel menu "Export ▾", stesso codice) ----------
    function htmlToMd(html) {
        let s = String(html || '');

        // blocchi strutturali
        s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
        s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
        s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
        s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

        // liste
        s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, function (m, inner) {
            const items = inner.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
            return '\n' + items.map(function (li) {
                return '- ' + li.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '$1');
            }).join('\n') + '\n';
        });
        s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, function (m, inner) {
            const items = inner.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
            return '\n' + items.map(function (li, i) {
                return (i + 1) + '. ' + li.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '$1');
            }).join('\n') + '\n';
        });
        s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

        // formattazione
        s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**');
        s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
        s = s.replace(/<u>([\s\S]*?)<\/u>/gi, '<u>$1</u>');
        s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
        s = s.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
        s = s.replace(/<br\s*\/?>/gi, '\n');
        s = s.replace(/<\/(p|div|tr|table|h[1-6]|li)>/gi, '\n');
        s = s.replace(/<td[^>]*>/gi, ' | ');
        s = s.replace(/<[^>]+>/g, '');

        // entità
        s = s.replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        s = s.replace(/[ \t]+\n/g, '\n');
        s = s.replace(/\n{3,}/g, '\n\n');
        return s.trim() + '\n';
    }

    function exportMd() {
        const md = '# ' + st.title + '\n\n' + htmlToMd(serializeHtml());
        download(md, safeName(st.title) + '.md', 'text/markdown;charset=utf-8');
    }

    function exportHtml() {
        const doc =
            '<!DOCTYPE html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
            '<title>' + App.esc(st.title) + '</title>\n' +
            '<style>\n' +
            'body{max-width:780px;margin:44px auto;padding:0 22px;font-family:Georgia,"Times New Roman",serif;' +
            'line-height:1.7;color:#1a1f2e;background:#fff;font-size:16px;}\n' +
            'h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25;}\n' +
            'img{max-width:100%;border-radius:8px;}\n' +
            'table{border-collapse:collapse;width:100%;margin:12px 0;}\n' +
            'td,th{border:1px solid #cbd2de;padding:7px 10px;}\n' +
            'ul,ol{padding-left:26px;}\n' +
            'a{color:#5b7cfa;}\n' +
            '</style>\n</head>\n<body>\n' +
            serializeHtml() +
            '\n</body>\n</html>\n';
        download(doc, safeName(st.title) + '.html', 'text/html;charset=utf-8');
    }

    function printDoc() {
        if (st && st.editor) {
            clearMarks();
            st.editor.classList.add('doc-print-area');
            const clean = function () {
                if (st && st.editor) st.editor.classList.remove('doc-print-area');
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
                '.doc-bar .doc-btn.fp-on{background:#5b7cfa;border-color:#5b7cfa;color:#fff}' +
        '@media print{.fp21-root{display:none!important}}'
    );

    // ---------- registrazione ----------
    window.StudyTools = window.StudyTools || {};
    window.StudyTools['documenti'] = {
        title: 'Documenti',
        icon: ICON,
        desc: 'Editor di testo a pagina A4 con stili, liste, tabelle, immagini ed export Markdown/HTML.',
        kinds: ['documento'],
        render: function (container, params) {
            root = container;
            params = params || {};
            if (params.open) return openEditor(container, params.open);
            return showList(container);
        },
        close: function () { flush(); detachGlobal(); }
    };
})();
