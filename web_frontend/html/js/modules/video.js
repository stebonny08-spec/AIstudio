/* ============================================================
   modules/video.js — sub-tool Video
   kind: 'video'
   Timeline multitaccia (Testo | Video/Immagini | Audio | Musica)
   con clip trascinabili/trimmabili, snap, playhead+righello+zoom,
   strumenti (dividi/duplica/elimina), barra contestuale (.vv-ctxbar)
    sopra la timeline,
   transizioni in/out ai giunti, preview sincronizzata sul playhead
   ed export reale .webm via MediaRecorder (canvas offscreen).
   ============================================================ */
(function () {
    'use strict';

    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>';
    const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    const I_SPLIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88"/><path d="M14.47 14.48L20 20"/><path d="M8.12 8.12L12 12"/></svg>';
    const I_DUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const I_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
    const I_ZOOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6"/></svg>';
    const I_EXP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M12 8v6"/><path d="M9 11l3 3 3-3"/><path d="M8 21h8"/></svg>';
    const MAX_SECONDS = 7 * 60;   // 7 minuti consigliati
    const PPS_MIN = 10, PPS_MAX = 240, PPS_DEF = 60;

    const TRACKS = [
        { key: 'text', label: 'Testo', color: '#e05252' },
        { key: 'media', label: 'Video/Immagini', color: '#8ca4ff' },
        { key: 'audio', label: 'Audio', color: '#7fc8a9' },
        { key: 'music', label: 'Musica', color: '#c9b8e8' }
    ];

    App.style(
        /* ---------- shell elenco: [barra 46][contenuto flex:1][status 26] - l'editor usa .vv-editor 100vh-44, senza status (V4) ---------- */
        '.vv-screen{display:flex;flex-direction:column;gap:8px;height:calc(100vh - 44px);overflow:hidden}' +
        '.vv-bar{flex:0 0 auto;min-height:46px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 10px;background:#161a2a;border:1px solid var(--border);border-radius:10px}' +
        '.vv-bgrp{display:flex;align-items:center;gap:6px;min-width:0}' +
        '.vv-btitle{flex:1;min-width:0;text-align:center;font-size:16px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px}' +
        '.vv-grow{flex:1;min-width:0}' +
        '.vv-ib{width:30px;height:30px;flex:0 0 auto;padding:0;display:inline-flex;align-items:center;justify-content:center;background:#1d2333;border:1px solid var(--border);border-radius:8px;color:#c3cbdb;cursor:pointer;transition:border-color .15s,color .15s,background-color .15s}' +
        '.vv-ib:hover{border-color:var(--accent);color:#fff}' +
        '.vv-ib:disabled{opacity:.4;cursor:not-allowed}' +
        '.vv-ib:disabled:hover{border-color:var(--border);color:#c3cbdb}' +
        '.vv-ib.on{background:var(--accent);border-color:var(--accent);color:#141824}' +
        '.vv-ib svg{width:16px;height:16px;pointer-events:none}' +
        '.vv-bbtn{height:30px;padding:0 11px;display:inline-flex;align-items:center;gap:6px;background:#1d2333;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:border-color .15s;white-space:nowrap}' +
        '.vv-bbtn:hover{border-color:var(--accent)}' +
        '.vv-bbtn svg{width:15px;height:15px}' +
        '.vv-new{height:32px;padding:0 13px;display:inline-flex;align-items:center;gap:6px;background:var(--accent);border:1px solid var(--accent);border-radius:8px;color:#141824;font:inherit;font-size:13px;font-weight:800;cursor:pointer;transition:background-color .15s}' +
        '.vv-new:hover{background:var(--accent-hover)}' +
        '.vv-new svg{width:15px;height:15px}' +
        '.vv-search{height:32px;width:172px;padding:0 11px;background:#0e1320;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:13px;outline:none}' +
        '.vv-search:focus{border-color:var(--accent)}' +
        '.vv-sort{height:32px;padding:0 9px;background:#1d2333;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:12.5px;font-weight:600;outline:none;cursor:pointer}' +
        '.vv-titlegrp{flex:1;min-width:0;display:flex;align-items:center;gap:8px}' +
        '.vv-titlein{flex:1;min-width:110px;height:32px;padding:0 9px;background:transparent;border:1px solid transparent;border-radius:8px;color:var(--text);font:inherit;font-size:15.5px;font-weight:800;outline:none}' +
        '.vv-titlein:hover{border-color:var(--border)}' +
        '.vv-titlein:focus{border-color:var(--accent);background:#0e1320}' +
        '.vv-badge{flex:0 0 auto;font-size:11px;font-weight:800;padding:4px 9px;border-radius:999px;white-space:nowrap;background:rgba(249,151,74,.14);color:var(--accent);border:1px solid rgba(249,151,74,.4)}' +
        '.vv-badge.saved{background:rgba(103,211,145,.12);color:#67d391;border-color:rgba(103,211,145,.4)}' +
        '.vv-exp{height:32px;padding:0 13px;display:inline-flex;align-items:center;gap:7px;background:var(--accent);border:1px solid var(--accent);border-radius:8px;color:#141824;font:inherit;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;transition:background-color .15s}' +
        '.vv-exp:hover{background:var(--accent-hover)}' +
        '.vv-exp svg{width:16px;height:16px}' +
        '.vv-exp:disabled{background:#1d2333;border-color:var(--border);color:#8b95a5;opacity:1;cursor:not-allowed}' +

        /* ---------- 4A lista ---------- */
        '.vv-list{flex:1;min-height:0;overflow-y:auto;padding:2px 4px 8px 2px}' +
        '.vv-list::-webkit-scrollbar{width:8px}' +
        '.vv-list::-webkit-scrollbar-thumb{background:#3a4156;border-radius:4px}' +
        '.vv-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;min-width:0;cursor:pointer;transition:border-color .15s,transform .12s}' +
        '.vv-card:hover{border-color:var(--accent);transform:translateY(-2px)}' +
        '.vv-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
        '.vv-thumb{position:relative;width:100%;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#0d1017;border:1px solid rgba(255,255,255,.06);margin-bottom:9px}' +
        '.vv-thumb .th-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5d6577}' +
        '.vv-thumb .th-ph svg{width:34px;height:34px}' +
        '.vv-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}' +
        '.vv-thumb .th-dur{position:absolute;right:6px;bottom:6px;font-size:11px;font-weight:800;color:#fff;background:rgba(8,10,18,.78);border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:2px 7px;font-variant-numeric:tabular-nums;z-index:1}' +
        '.vv-card h4{font-size:14.5px;font-weight:700;margin:0 0 5px;word-break:break-word}' +
        '.vv-card .vv-meta{font-size:12px;color:var(--muted);display:flex;gap:7px;flex-wrap:wrap;align-items:center}' +
        '.vv-acts{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap;margin-top:9px;opacity:0;transition:opacity .15s}' +
        '.vv-card:hover .vv-acts,.vv-card:focus-within .vv-acts{opacity:1}' +
        '.vv-acts button{background:var(--panel-2);border:1px solid var(--border);color:var(--muted);border-radius:7px;padding:4px 9px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:color .15s,border-color .15s}' +
        '.vv-acts button:hover{color:var(--text);border-color:var(--accent)}' +
        '.vv-acts button.danger:hover{color:var(--red);border-color:var(--red)}' +

        /* ---------- 4B/4C/4E editor: pannelli laterali con linguetta verticale ---------- */
        '.vv-edit{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}' +
        '.vv-mid{flex:1;min-height:0;display:flex;gap:8px}' +
        '.vv-side{display:flex;gap:8px;min-height:0;flex:0 0 auto}' +
        '.vv-vtab{writing-mode:vertical-rl;text-orientation:mixed;padding:12px 5px;background:#1d2333;border:1px solid var(--border);border-radius:8px;color:#8b95a5;font-size:11px;font-weight:800;letter-spacing:1.5px;cursor:pointer;transition:color .15s,border-color .15s;display:flex;align-items:center;justify-content:center}' +
        '.vv-vtab:hover{color:var(--accent);border-color:var(--accent)}' +
        '.vv-side:not(.collapsed) .vv-vtab{color:var(--accent);border-color:rgba(249,151,74,.5)}' +
        '.vv-panel{background:#161a2a;border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:10px;min-height:0;overflow-y:hidden;flex:0 0 auto}' +
        '.vv-panel.vv-left{width:200px}' +
        '.vv-side.collapsed .vv-panel{display:none}' +
        '.vv-side.collapsed .vv-lgrab{display:none}' +
        '.vv-lsect{display:flex;flex-direction:column;gap:6px;min-height:0}' +
        /* --- BLOCCO 1: layout editor [colonna stretta sx][preview centro] + timeline (proprietà in ctxbar sopra la timeline, colonna dx rimossa - V1) --- */
        '.vv-editor{display:flex;flex-direction:column;gap:8px;height:calc(100vh - 44px);overflow:hidden}' +
        '.vv-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}' +
        '.vv-split{flex:1;min-height:0;display:flex;gap:8px;align-items:stretch}' +
        '.vv-pane{display:flex;gap:8px;min-height:0;flex:0 0 auto}' +
        '.vv-main{flex:1;min-width:0;min-height:0;background:#0d1017;border:1px solid var(--border);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:8px;overflow:hidden}' +
        /* barra proprieta contestuale (V1): sostituisce la vecchia colonna destra fissa */
        '.vv-ctxbar{display:flex;flex:0 0 auto;flex-wrap:wrap;align-items:center;gap:4px 10px;min-height:32px;padding:3px 6px;background:#12151f;border:1px solid var(--border);border-radius:8px}' +
        '.vv-lgrab{width:7px;flex:0 0 7px;cursor:ew-resize;background:transparent;border-radius:4px;touch-action:none;transition:background-color .15s}' +
        '.vv-lgrab:hover{background:rgba(249,151,74,.5)}' +
        '.vv-sbody{display:flex;flex-direction:column;gap:6px}' +
        '.vv-lsect.collapsed .vv-sbody{display:none}' +
        '.vv-lsect .vv-sect{display:flex;align-items:center;justify-content:space-between;gap:6px;cursor:pointer;user-select:none}' +
        '.vv-lsect .vv-sect .vv-caret{font-size:9px;opacity:.75}' +
        '.vv-sect{font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}' +
        '.vv-addgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
        '.vv-addb{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:32px;padding:0 4px;background:#1d2333;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:11px;font-weight:700;cursor:pointer;transition:border-color .15s;min-width:0;overflow:hidden}' +
        '.vv-addb:hover{border-color:var(--accent)}' +
        '.vv-addb svg{width:17px;height:17px;color:var(--accent)}' +
        '.vv-musrow{display:flex;gap:6px;align-items:center}' +
        '.vv-mbtn{flex:1;min-width:0;height:28px;background:#1d2333;border:1px solid var(--border);border-radius:7px;color:var(--text);font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:border-color .15s}' +
        '.vv-mbtn:hover{border-color:var(--accent)}' +
        '.vv-vol{flex:0 0 66px;width:66px;accent-color:var(--accent)}' +
        '.vv-muslabel{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.vv-lib{display:flex;flex-direction:column;gap:4px;overflow:hidden;flex:1;min-height:0}' +
        '.vv-libitem{display:flex;align-items:center;gap:6px;padding:5px 7px;background:#1d2333;border:1px solid var(--border);border-radius:7px;color:#c3cbdb;font-size:11.5px;font-weight:600;cursor:grab;min-width:0;transition:border-color .15s}' +
        '.vv-libitem:hover{border-color:var(--accent)}' +
        '.vv-libitem .li-ico{display:inline-flex;flex:0 0 auto;color:var(--accent)}' +
        '.vv-libitem .li-ico svg{width:14px;height:14px}' +
        '.vv-libitem .li-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}' +
        '.vv-libempty{font-size:11.5px;color:var(--muted);line-height:1.5}' +

        /* ---------- 4D centro: preview su superficie chiara + transport ---------- */
        '.vv-center{flex:1;min-width:0;background:#eceef3;border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto}' +
        '.vv-center::-webkit-scrollbar{width:8px}' +
        '.vv-center::-webkit-scrollbar-thumb{background:#c3c9d6;border-radius:4px}' +
        '.vv-stage{position:relative;flex:1 1 auto;min-height:0;aspect-ratio:16/9;width:auto;max-width:100%;margin:0 auto;align-self:center;background:#000;border-radius:8px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.18)}' +
        '.vv-transport{display:flex;gap:8px;align-items:center;flex-wrap:nowrap;flex:0 0 auto}' +
        '.vv-cbtn{width:30px;height:30px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;background:#fff;border:1px solid #c9cfda;color:#1a1f2e;border-radius:8px;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s}' +
        '.vv-cbtn:hover{border-color:var(--accent);color:#b4651f}' +
        '.vv-cbtn:disabled{opacity:.45;cursor:not-allowed}' +
        '.vv-cbtn.on{background:var(--accent);border-color:var(--accent);color:#141824}' +
        '.vv-cbtn.on:hover{color:#141824}' +
        '.vv-cbtn svg{width:15px;height:15px;pointer-events:none}' +
        '.vv-time{font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:700;color:#c3cbdb;white-space:nowrap;min-width:118px;text-align:center}' +
        '.vv-range{flex:1;min-width:90px;accent-color:var(--accent)}' +
        '.vv-dur{flex:0 0 auto;font-size:12.5px;font-weight:800;color:#1a1f2e;background:#fff;border:1px solid #c9cfda;border-radius:8px;padding:5px 9px;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:default}' +
        '.vv-dur.warn{color:#b4651f;border-color:var(--accent);background:rgba(249,151,74,.12)}' +

        /* ---------- preview clip (invariata) ---------- */
        '.vv-clip{position:absolute;inset:0}' +
        '.vv-box{position:absolute;inset:0;transform-origin:center center}' +
        '.vv-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;white-space:pre-wrap;word-break:break-word;line-height:1.35}' +
        '.vv-clip img{width:100%;height:100%;object-fit:contain;display:block}' +
        '.vv-clip video{width:100%;height:100%;object-fit:contain;display:block;background:#000}' +
        '.vv-clip audio{position:absolute;left:10%;bottom:8%;width:80%}' +
        '.vv-jin-fade{animation:vvJIF .2s ease both}' +
        '.vv-jin-slide{animation:vvJIS .2s ease both}' +
        '.vv-jout-fade{animation:vvJOF .2s ease both}' +
        '.vv-jout-slide{animation:vvJOS .2s ease both}' +
        '@keyframes vvJIF{from{opacity:0}to{opacity:1}}' +
        '@keyframes vvJIS{from{opacity:0;transform:translateX(64px)}to{opacity:1;transform:none}}' +
        '@keyframes vvJOF{from{opacity:1}to{opacity:0}}' +
        '@keyframes vvJOS{from{opacity:1;transform:none}to{opacity:0;transform:translateX(-64px)}}' +

        /* ---------- barra contestuale .vv-ctxbar (stili ex pannello proprieta) ---------- */
        '.vv-ctxbar .lab{color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;flex:0 0 auto}' +
        '.vv-ctxbar .prow{display:flex;flex-direction:row;align-items:center;gap:5px}' +
        '.vv-ctxbar .pinline{display:flex;gap:8px;align-items:center}' +
        '.vv-ctxbar .pinline .lab{flex:0 0 auto}' +
        '.vv-ctxbar input[type="number"]{width:62px;background:#0e1320;border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 5px;font-size:12px;outline:none;font-family:inherit;box-sizing:border-box}' +
        '.vv-ctxbar input[type="range"]{width:92px;accent-color:var(--accent)}' +
        '.vv-ctxbar input[type="color"]{width:36px;height:24px;background:#0e1320;border:1px solid var(--border);border-radius:6px;padding:1px;cursor:pointer}' +
        '.vv-ctxbar select{width:auto;max-width:150px;background:#0e1320;border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 5px;font-size:12px;outline:none;font-family:inherit}' +
        '.vv-ctxbar textarea{background:#0e1320;border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px 5px;font-size:12px;outline:none;font-family:inherit;min-height:24px;height:24px;resize:vertical;width:150px;box-sizing:border-box}' +
        '.vv-ctxbar .vallab{font-size:10.5px;color:var(--text);font-weight:700;font-variant-numeric:tabular-nums;flex:0 0 auto}' +
        '.vv-ctxbar .vv-note{padding:2px 7px;font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.vv-ctxbar .tool-btn{height:24px;padding:2px 9px;font-size:11.5px;gap:4px}' +
        '.vv-ctxbar .vv-sect{font-size:10px}' +
        '.vv-note{font-size:12px;color:var(--muted);border:1px dashed var(--border);border-radius:9px;padding:7px 11px}' +

        /* ---------- 4F timeline a tutta larghezza con maniglia altezza ---------- */
        '.vv-tlwrap{height:clamp(160px,40vh,40vh);flex:0 0 auto;background:#161a2a;border:1px solid var(--border);border-radius:10px;padding:0 8px 8px;display:flex;flex-direction:column;gap:6px;overflow:hidden}' +
        '.vv-tlgrab{height:12px;flex:0 0 12px;margin:0 -8px;display:flex;align-items:center;justify-content:center;cursor:ns-resize;touch-action:none;transition:background-color .15s}' +
        '.vv-tlgrab:after{content:"";width:46px;height:4px;border-radius:2px;background:#38415a;transition:background-color .15s}' +
        '.vv-tlgrab:hover{background:rgba(249,151,74,.08)}' +
        '.vv-tlgrab:hover:after{background:var(--accent)}' +
        '.vv-tltools{display:flex;align-items:center;gap:8px;min-height:30px;flex-wrap:wrap}' +
        '.vv-tltools .tl-title{font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}' +
        '.vv-caret{font-size:9px;opacity:.9}' +
        '.vv-status{flex:1;min-width:0;font-size:11.5px;color:#8b95a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.vv-zoom{width:110px;accent-color:var(--accent)}' +
        '.vv-zoomval{font-size:11px;color:#8b95a5;font-weight:700;min-width:56px;text-align:right;font-variant-numeric:tabular-nums}' +
        '.vv-tlbody{display:flex;flex:1;min-height:0;gap:6px;overflow-y:auto;overflow-x:hidden;align-items:flex-start}' +
        '.vv-tlabels{flex:0 0 122px;width:122px;min-height:100%;display:flex;flex-direction:column}' +
        '.vv-lab-sp{height:23px;flex:0 0 23px}' +
        '.vv-lab{height:40px;margin-bottom:6px;display:flex;align-items:center;gap:6px;background:#12151f;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:11px;font-weight:800;color:#8b95a5;letter-spacing:.3px;white-space:nowrap;overflow:hidden;box-sizing:border-box}' +
        '.vv-lab i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}' +
        /* --- BLOCCO 2: gruppi con più corsie --- */
        '.vv-lhead{height:26px;margin-bottom:6px;display:flex;align-items:center;gap:7px;background:#191f2e;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:11px;font-weight:800;color:#aab3c5;letter-spacing:.4px;box-sizing:border-box;user-select:none;position:sticky;left:0;z-index:4;width:max-content}' +
        '.vv-lhead i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}' +
        '.vv-lhead-sp{height:26px;flex:0 0 26px;margin-bottom:6px}' +
        '.vv-laneadd{margin-left:auto;width:24px;height:20px;padding:0;background:#12151f;border:1px solid var(--border);border-radius:6px;color:#c3cbdb;font:inherit;font-size:13px;font-weight:800;line-height:1;cursor:pointer;transition:border-color .15s,color .15s;flex:0 0 auto}' +
        '.vv-laneadd:hover{border-color:var(--accent);color:var(--accent)}' +
        '.vv-lanedel{margin-left:auto;width:20px;height:18px;padding:0;background:transparent;border:1px solid transparent;border-radius:5px;color:#8b95a5;font:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s,color .15s,border-color .15s;flex:0 0 auto}' +
        '.vv-lab:hover .vv-lanedel{opacity:1}' +
        '.vv-lanedel:hover{color:var(--red);border-color:var(--red)}' +
        '.vv-tscroll{flex:1;min-width:0;min-height:100%;background:#161a2a;border:1px solid var(--border);border-radius:8px;overflow-x:auto;overflow-y:hidden;position:relative}' +
        '.vv-tscroll::-webkit-scrollbar{height:9px}' +
        '.vv-tscroll::-webkit-scrollbar-thumb{background:#3a4156;border-radius:4px}' +
        '.vv-tinner{position:relative;height:auto;min-width:100%}' +
        '.vv-truler{position:relative;height:22px;border-bottom:1px solid #2a3145;cursor:pointer;user-select:none;background:#1c2130;touch-action:none}' +
        '.vv-tick{position:absolute;top:0;height:22px;border-left:1px solid #38415a;font-size:9.5px;color:#8b95a5;padding-left:3px;line-height:20px;white-space:nowrap;pointer-events:none}' +
        '.vv-ttracks{position:relative}' +
        '.vv-track{position:relative;height:40px;margin-bottom:6px;background:#12151f;border-radius:6px;border:1px solid rgba(255,255,255,.045)}' +
        '.vv-track:last-child{margin-bottom:0}' +
        '.vv-tclip{position:absolute;top:0;height:40px;border-radius:6px;color:#fff;font-size:12px;padding:3px 8px;cursor:grab;overflow:hidden;border:2px solid transparent;user-select:none;touch-action:none;box-sizing:border-box}' +
        '.vv-tclip.active{border-color:#f9974a;box-shadow:0 0 0 1px rgba(249,151,74,.65)}' +
        '.vv-tclip .tc-in{position:absolute;left:2px;right:2px;top:2px;bottom:2px;background:rgba(0,0,0,.26);border-radius:4px;pointer-events:none}' +
        '.vv-tclip .tc-t{position:relative;z-index:1;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:14px;text-shadow:0 1px 2px rgba(0,0,0,.6)}' +
        '.vv-tclip .tc-m{position:relative;z-index:1;font-size:10px;opacity:.88;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:12px}' +
        '.vv-tclip .th{position:absolute;top:0;bottom:0;width:7px;z-index:2;cursor:ew-resize}' +
        '.vv-tclip .th::after{content:"";position:absolute;top:10px;bottom:10px;left:3px;width:1px;background:rgba(255,255,255,.6)}' +
        '.vv-tclip .th-l{left:0}' +
        '.vv-tclip .th-r{right:0}' +
        '.vv-tclip .th:hover{background:rgba(255,255,255,.25)}' +
        '.vv-jn{position:absolute;top:9px;font-size:11px;transform:translateX(-50%);z-index:5;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))}' +
        '.vv-ph{position:absolute;top:0;bottom:0;width:2px;background:#f9974a;z-index:7;pointer-events:none}' +
        '.vv-ph .hnd{position:absolute;top:1px;left:-5px;width:12px;height:12px;background:#f9974a;border-radius:3px;pointer-events:auto;cursor:ew-resize;box-shadow:0 0 6px rgba(249,151,74,.85)}' +
        '.vv-guide{position:absolute;top:23px;bottom:0;width:1px;background:#ffd98a;z-index:6;pointer-events:none;display:none;box-shadow:0 0 5px rgba(255,217,138,.95)}' +

        /* ---------- menu transizione in timeline ---------- */
        '.vv-trmenu{position:fixed;z-index:60;min-width:158px;background:#161a2a;border:1px solid var(--border);border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.5);padding:6px;display:flex;flex-direction:column;gap:2px}' +
        '.vv-trmenu .tm-h{font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);padding:5px 7px 2px}' +
        '.vv-trmenu .tm-sep{height:1px;background:var(--border);margin:3px 2px}' +
        '.vv-trmenu button{display:flex;align-items:center;gap:7px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-radius:6px;color:var(--text);font:inherit;font-size:12.5px;font-weight:600;padding:6px 8px;cursor:pointer;transition:background-color .12s,color .12s}' +
        '.vv-trmenu button:hover{background:rgba(249,151,74,.15);color:var(--accent)}' +
        '.vv-trmenu button.on{color:var(--accent);border-color:rgba(249,151,74,.4)}' +

        /* ---------- barra stato 26px ---------- */
        '.vv-statusbar{flex:0 0 26px;height:26px;display:flex;align-items:center;gap:10px;padding:0 11px;background:#161a2a;border:1px solid var(--border);border-radius:8px;font-size:11.5px;color:#8b95a5;overflow:hidden}' +
        '.vv-scount{flex:0 0 auto;color:#c3cbdb;font-weight:700}' +

        /* ---------- dialog export (invariato) ---------- */
        '.vv-modal{position:fixed;inset:0;background:rgba(8,10,18,.74);display:flex;align-items:center;justify-content:center;z-index:9999}' +
        '.vv-mdlg{width:430px;max-width:92vw;background:#1c2130;border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:11px;box-shadow:0 18px 50px rgba(0,0,0,.55)}' +
        '.vv-mdlg h3{margin:0;font-size:15px;color:var(--text)}' +
        '.vv-frow{display:flex;align-items:center;gap:8px;font-size:13px}' +
        '.vv-frow label{flex:0 0 84px;color:var(--muted);font-weight:700;font-size:12px}' +
        '.vv-frow select{flex:1;background:#161a2a;border:1px solid var(--border);border-radius:7px;color:var(--text);padding:6px 8px;font-family:inherit;font-size:13px;outline:none}' +
        '.vv-pbar{height:9px;background:#161a2a;border:1px solid var(--border);border-radius:6px;overflow:hidden;position:relative}' +
        '.vv-pbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f9974a,#ffd98a);transition:width .15s}' +
        '.vv-pct{font-size:12px;color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;min-width:38px;text-align:right}' +
        '.vv-prow{display:flex;align-items:center;gap:8px}' +
        '.vv-stat{font-size:12.5px;color:var(--muted)}' +
        '.vv-err{font-size:12.5px;color:var(--red);border:1px solid var(--red);background:rgba(224,82,82,.1);border-radius:8px;padding:6px 9px}' +
        '.vv-mbtns{display:flex;gap:8px;justify-content:flex-end}' +
        '.vv-hidden-host{position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none}'
    );

    let root = null;
    let st = null;         // stato editor: { id, title, data, sel, playhead, pps, ... }
    let saveTimer = null;
    let pv = null;         // stato preview: { playing, raf, mounted, pending, music }

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
    function num(v) { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; }
    function snum(v, d) { const n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }
    function r05(v) { return Math.round(v / 0.05) * 0.05; }
    function r2(v) { return Math.round(v * 100) / 100; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function fmtT(s) {
        s = Math.max(0, s);
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        const cs = Math.floor((s % 1) * 10);
        return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec + '.' + cs;
    }
    function fmtTick(s) {
        const m = Math.floor(s / 60);
        const sec = Math.round(s - m * 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function fmtBytes(b) {
        if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
        if (b > 1024) return (b / 1024).toFixed(0) + ' KB';
        return b + ' B';
    }
    function sanitizeName(t) {
        const s = String(t || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
        return s || 'progetto-video';
    }

    function download(text, name, mime) {
        const blob = new Blob([text], { type: mime || 'application/octet-stream' });
        downloadBlob(blob, name);
    }
    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
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
    async function pickMedia(kind) {
        let a = null;
        try { a = await StudyStore.pickAsset(); } catch (e) { a = null; }
        if (a && a.path) return a.path;
        const accept = kind === 'image' ? 'image/*' : (kind === 'video' ? 'video/*' : 'audio/*');
        return await fileToDataUrl(accept);
    }

    // ---------- modello ----------
    function newClip(type, start) {
        const base = { id: uid(), type: type, start: Math.round(start * 10) / 10, transition: 'fade' };
        if (type === 'text') return Object.assign(base, { text: 'Nuovo testo', dur: 4, fontSize: 40, color: '#ffffff' });
        if (type === 'image') return Object.assign(base, { dur: 4 });
        if (type === 'video') return Object.assign(base, { dur: 6 });
        if (type === 'music') return Object.assign(base, { dur: 5, volume: 80 });
        return Object.assign(base, { dur: 5 });   // audio
    }
    function normLanes(l) {
        const out = { text: 1, media: 1, audio: 1, music: 0 };
        ['text', 'media', 'audio', 'music'].forEach(function (g) {
            let n = Math.floor(Number(l && l[g]));
            if (!isFinite(n) || n < out[g]) n = out[g];
            out[g] = n;
        });
        return out;
    }
    function parseContent(item) {
        let d = null;
        try { d = JSON.parse(item.content || '{}'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = null;
        const clips = (d && Array.isArray(d.clips)) ? d.clips : [];
        const lanes = normLanes(d && d.lanes);
        clips.forEach(function (c) { if (!c.id) c.id = uid(); });
        clips.forEach(function (c) {
            let lane = Math.floor(Number(c.lane));
            if (!isFinite(lane) || lane < 0) lane = 0;
            c.lane = lane;
        });
        clips.forEach(function (c) {
            if (trackKeyOf(c) === 'music' && c.lane + 1 > lanes.music) lanes.music = c.lane + 1;
        });
        clips.forEach(function (c) {
            const g = trackKeyOf(c);
            const max = (g === 'music' ? lanes.music : lanes[g]) - 1;
            if (c.lane > max) c.lane = Math.max(0, max);
        });
        const music = (d && d.music && typeof d.music === 'object') ? d.music : { src: '', volume: 70 };
        if (music.volume == null) music.volume = 70;
        // R21 B4: provenienza fonti inserite (pushata da fpInsert)
        const fpSources = (d && Array.isArray(d.fpSources)) ? d.fpSources : [];
        return { clips: clips, music: music, lanes: lanes, script: (d && d.script) || '', fpSources: fpSources };
    }

    // ---- BLOCCO 2: corsie multiple per gruppo traccia ----
    function laneCount(g) { return (st && st.data && st.data.lanes) ? st.data.lanes[g] : 1; }
    function rowCount(g) { return g === 'music' ? 1 + laneCount('music') : laneCount(g); }
    function rowKeyOf(c) {
        const g = trackKeyOf(c);
        return g + ':' + (g === 'music' ? (c.lane || 0) + 1 : (c.lane || 0));
    }
    function laneTitle(g, rowIdx) {
        let label = g;
        for (let i = 0; i < TRACKS.length; i++) if (TRACKS[i].key === g) label = TRACKS[i].label;
        if (g === 'music') return rowIdx === 0 ? 'Musica \u266a sottofondo' : 'Musica ' + (rowIdx + 1);
        return rowIdx === 0 ? label : label + ' ' + (rowIdx + 1);
    }
    function overlaps(a1, a2, b1, b2) { return a1 < b2 - 1e-6 && b1 < a2 - 1e-6; }
    function laneClips(g, lane, skipId) {
        if (!st) return [];
        return st.data.clips.filter(function (x) {
            return trackKeyOf(x) === g && (x.lane || 0) === lane && x.id !== skipId;
        });
    }
    function laneFree(g, lane, start, dur, skipId) {
        return !laneClips(g, lane, skipId).some(function (x) {
            return overlaps(start, start + dur, num(x.start), num(x.start) + num(x.dur));
        });
    }
    function pickLane(g, start, dur, skipId) {
        const n = laneCount(g);
        for (let i = 0; i < n; i++) if (laneFree(g, i, start, dur, skipId)) return i;
        return -1;
    }
    function assignLane(c) {
        const g = trackKeyOf(c);
        let lane = pickLane(g, num(c.start), num(c.dur), c.id);
        if (lane < 0) {
            st.data.lanes[g] = laneCount(g) + 1;
            lane = laneCount(g) - 1;
        }
        c.lane = lane;
        return lane;
    }
    function clampFree(g, lane, s, d, skipId) {
        s = Math.max(0, s);
        if (laneFree(g, lane, s, d, skipId)) return s;
        const iv = laneClips(g, lane, skipId)
            .map(function (x) { return [num(x.start), num(x.start) + num(x.dur)]; })
            .sort(function (a, b) { return a[0] - b[0]; });
        let cand = s;
        for (let i = 0; i < iv.length; i++) {
            if (overlaps(cand, cand + d, iv[i][0], iv[i][1])) cand = iv[i][1];
        }
        if (laneFree(g, lane, cand, d, skipId)) return cand;
        cand = s;
        for (let i = iv.length - 1; i >= 0; i--) {
            if (overlaps(cand, cand + d, iv[i][0], iv[i][1])) cand = Math.max(0, iv[i][0] - d);
        }
        if (laneFree(g, lane, cand, d, skipId)) return cand;
        return iv.length ? iv[iv.length - 1][1] : 0;
    }
    function addLane(g) { st.data.lanes[g] = laneCount(g) + 1; }
    function removeLane(g, lane) {
        const min = g === 'music' ? 0 : 1;
        const n = laneCount(g);
        if (n <= min) { setStatus('Impossibile eliminare l\u2019ultima corsia.'); return; }
        const inLane = laneClips(g, lane, null);
        if (inLane.length) {
            const ids = {};
            inLane.forEach(function (x) { ids[x.id] = 1; });
            if (!confirm('La corsia contiene ' + inLane.length + ' clip: eliminarla?')) return;
            st.data.clips = st.data.clips.filter(function (x) { return !ids[x.id]; });
            if (st.sel && ids[st.sel]) st.sel = null;
        }
        st.data.clips.forEach(function (x) {
            if (trackKeyOf(x) === g && (x.lane || 0) > lane) x.lane = (x.lane || 0) - 1;
        });
        st.data.lanes[g] = n - 1;
        applyAll();
        setStatus('Corsia eliminata.');
    }
    function totalDur() {
        if (!st) return 0;
        let t = 0;
        st.data.clips.forEach(function (c) { t = Math.max(t, num(c.start) + num(c.dur)); });
        return Math.round(t * 10) / 10;
    }
    function appendStart() {
        let t = 0;
        st.data.clips.forEach(function (c) { t = Math.max(t, num(c.start) + num(c.dur)); });
        return Math.round(t * 10) / 10;
    }

    // transizioni (in/out) — compat con il vecchio campo `transition`
    function normTr(t) {
        t = String(t == null ? '' : t).toLowerCase();
        if (t === 'cut') return 'none';
        return (t === 'fade' || t === 'slide' || t === 'none') ? t : 'none';
    }
    function trIn(c) {
        if (!c) return 'none';
        if (c.transitionIn != null) return normTr(c.transitionIn);
        if (c.transition != null) return normTr(c.transition);
        return 'fade';
    }
    function trOut(c) {
        if (!c) return 'none';
        if (c.transitionOut != null) return normTr(c.transitionOut);
        return 'none';
    }
    function effTrans(pred, succ) {
        const i = trIn(succ);
        if (i !== 'none') return i;
        return trOut(pred);
    }
    function trackKeyOf(c) {
        if (c.type === 'text') return 'text';
        if (c.type === 'image' || c.type === 'video') return 'media';
        if (c.type === 'music') return 'music';
        return 'audio';
    }
    function colorOf(c) {
        const k = trackKeyOf(c);
        for (let i = 0; i < TRACKS.length; i++) if (TRACKS[i].key === k) return TRACKS[i].color;
        return '#8ca4ff';
    }

    // ---------- salvataggio ----------
    // ---------- H11: genera script (F13) ----------
    async function aiVideoScript(btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') return;
        const inp = await AI.askInputs('Genera script', [
            { name: 'titolo', label: 'Titolo del video', value: (st && st.title) || '' },
            { name: 'secondi', label: 'Durata (secondi)', type: 'number', value: 60 }
        ], 'Genera script');
        if (!inp || !inp.titolo) return;
        const res = await AI.runFor(btn, 'F13', { titolo: inp.titolo, secondi: Number(inp.secondi) || 60, sec: Number(inp.secondi) || 60, contenuto: (st && st.data && st.data.script) || '' });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            const txt = AI.previewText(r);
            if (!txt) return;
            try {
                st.data.script = txt;
                scheduleSave();
                AI.toast('Script salvato nel progetto');
            } catch (e) { AI.toast('Salvataggio script non riuscito'); }
        });
    }

    function scheduleSave() {
        // R21 B4: ogni mutazione registrata in storia (pushHist con dedupe
        // interno): rende utilizzabile doUndo/doRedo (Ctrl+Z/Ctrl+Y).
        pushHist();
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 900);
    }
    async function flush() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (!st || !st.id) return;
        try {
            await StudyStore.saveItem({
                id: st.id, kind: 'video', title: st.title,
                content: JSON.stringify({ clips: st.data.clips, music: st.data.music, lanes: st.data.lanes, script: (st.data && st.data.script) || '', fpSources: (st.data && Array.isArray(st.data.fpSources)) ? st.data.fpSources : [] })
            });
        } catch (e) { console.error('Salvataggio progetto video:', e); }
    }

    // ---------- helper UI (storia, libreria, play button, stato pannelli) ----------
    function fmtMS(s) {
        s = Math.max(0, num(s));
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function releaseKeys() {
        if (st && st.keyHandler) { window.removeEventListener('keydown', st.keyHandler); st.keyHandler = null; }
        if (st && st.closeTrMenu) { try { st.closeTrMenu(); } catch (e) { /* ok */ } }
    }

    // --- storico undo/redo: uno snapshot del modello per salvataggio ---
    function snapHist() { return JSON.stringify({ clips: st.data.clips, music: st.data.music, lanes: st.data.lanes, script: (st.data && st.data.script) || '', fpSources: (st.data && Array.isArray(st.data.fpSources)) ? st.data.fpSources : [] }); }
    function pushHist() {
        if (!st || !st.hist) return;
        const s = snapHist();
        if (st.hist[st.histIdx] === s) return;
        st.hist = st.hist.slice(0, st.histIdx + 1);
        st.hist.push(s);
        if (st.hist.length > 80) st.hist.shift();
        st.histIdx = st.hist.length - 1;
        updateHistBtns();
    }
    function updateHistBtns() {
        if (!st) return;
        if (st.undoBtn) st.undoBtn.disabled = st.histIdx <= 0;
        if (st.redoBtn) st.redoBtn.disabled = st.histIdx >= st.hist.length - 1;
    }
    function applyHist(s) {
        let d = null;
        try { d = JSON.parse(s); } catch (e) { return; }
        st.data = {
            clips: (d && Array.isArray(d.clips)) ? d.clips : [],
            music: (d && d.music) ? d.music: { src: '', volume: 70 },
            lanes: normLanes(d && d.lanes),
            script: (d && d.script) || '',
            fpSources: (d && Array.isArray(d.fpSources)) ? d.fpSources : []
        };
        st.data.clips.forEach(function (c) { if (!c.id) c.id = uid(); });
        st.data.clips.forEach(function (c) {
            if (trackKeyOf(c) === 'music') {
                let lane = Math.floor(Number(c.lane));
                if (!isFinite(lane) || lane < 0) lane = 0;
                if (lane + 1 > st.data.lanes.music) st.data.lanes.music = lane + 1;
            }
        });
        st.data.clips.forEach(function (c) {
            const g = trackKeyOf(c);
            const max = (g === 'music' ? st.data.lanes.music : st.data.lanes[g]) - 1;
            let lane = Math.floor(Number(c.lane));
            if (!isFinite(lane) || lane < 0) lane = 0;
            c.lane = Math.min(lane, Math.max(0, max));
        });
        if (st.sel && st.sel !== '@music' && !clipById(st.sel)) st.sel = null;
        if (st.playhead > totalDur()) st.playhead = totalDur();
        applyAll();
    }
    function doUndo() {
        if (!st || st.histIdx <= 0) return;
        st.histIdx--;
        applyHist(st.hist[st.histIdx]);
        updateHistBtns();
        setStatus('Annullato.');
    }
    function doRedo() {
        if (!st || st.histIdx >= st.hist.length - 1) return;
        st.histIdx++;
        applyHist(st.hist[st.histIdx]);
        updateHistBtns();
        setStatus('Ripristinato.');
    }

    // --- play/pausa nel transport ---
    function syncPlayBtn() {
        if (!st || !st.playBtn) return;
        const on = !!(pv && pv.playing);
        st.playBtn.innerHTML = on ? I_PAUSE : I_PLAY;
        st.playBtn.classList.toggle('on', on);
        st.playBtn.title = on ? 'Metti in pausa' : 'Avvia la preview';
    }

    // --- libreria: asset gia usati nel progetto (click = inserisci al playhead; drag = sulla timeline) ---
    function libAssets() {
        const out = [], seen = {};
        if (!st) return out;
        st.data.clips.forEach(function (c) {
            if (!c.src || c.type === 'text') return;
            const key = c.type + '|' + c.src;
            if (seen[key]) return;
            seen[key] = 1;
            out.push({ type: c.type, src: c.src, name: fileName(c.src) || typeLabel(c.type) });
        });
        return out;
    }
    function insertFromLib(type, src, at) {
        if (!st || !src) return;
        const t = (typeof at === 'number') ? at : st.playhead;
        const c = newClip(type, r05(Math.max(0, t)));
        c.src = src;
        assignLane(c);
        st.data.clips.push(c);
        st.sel = c.id;
        applyAll();
        setStatus('Clip ' + typeLabel(type) + ' inserita al playhead.');
    }
    function renderLibrary() {
        if (!st || !st.libEl) return;
        const box = st.libEl;
        box.innerHTML = '';
        const items = libAssets();
        if (!items.length) {
            box.appendChild(App.el('div', 'vv-libempty', 'Nessun asset: aggiungi un file da riutilizzare qui sotto.'));
            return;
        }
        items.forEach(function (a) {
            const row = App.el('div', 'vv-libitem');
            row.draggable = true;
            row.title = a.name + ' — click: inserisci al playhead · trascina sulla timeline per posizionare';
            row.innerHTML = '<span class="li-ico">' + iconForType(a.type) + '</span><span class="li-nm">' + App.esc(a.name) + '</span>';
            row.addEventListener('click', function () { insertFromLib(a.type, a.src); });
            row.addEventListener('dragstart', function (e) {
                try { e.dataTransfer.setData('text/plain', JSON.stringify({ type: a.type, src: a.src })); } catch (err) { /* ok */ }
            });
            box.appendChild(row);
        });
    }

    // ---------- lista (4A) ----------
    let listQ = '', listSort = 'updated';
    // icone usate in lista/transport (erano mancanti -> ReferenceError a
    // runtime che fermava il render di lista/card/transport)
    const I_BACK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    const I_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
        '<path d="M7 4.5l12 7.5-12 7.5z"/></svg>';
    const I_PAUSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
        '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';
    const I_PLAYCARD = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" ' +
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/>' +
        '<path d="M10 9.2l5 2.8-5 2.8z" fill="currentColor" stroke="none"/></svg>';

    async function showList(container) {
        stopAllPlayback();
        await flush();
        releaseKeys();
        fpClose();                   // R21 B4: chiude il pannello Fonti uscendo dall'editor
        st = null;
        root = container;
        container.classList.remove('vv-editor');
        container.innerHTML = '';

        const screen = App.el('div', 'vv-screen');
        container.appendChild(screen);

        // barra 46px: [← Produttività][+ Nuovo video] | titolo "Video" | [Cerca…][Ordina]
        const bar = App.el('div', 'vv-bar');
        const gl = App.el('div', 'vv-bgrp');
        const back = App.el('button', 'vv-bbtn');
        back.type = 'button';
        back.title = 'Torna alla sezione Produttività';
        back.innerHTML = I_BACK + ' Produttività';
        back.addEventListener('click', function () { App.go('produttivita'); });
        gl.appendChild(back);
        const btnNew = App.el('button', 'vv-new');
        btnNew.type = 'button';
        btnNew.innerHTML = PLUS + ' Nuovo video';
        btnNew.addEventListener('click', createNew);
        gl.appendChild(btnNew);
        bar.appendChild(gl);
        bar.appendChild(App.el('div', 'vv-btitle', 'Video'));
        const gr = App.el('div', 'vv-bgrp');
        const search = App.el('input', 'vv-search');
        search.type = 'search';
        search.placeholder = 'Cerca…';
        search.title = 'Cerca un progetto per titolo';
        search.value = listQ;
        gr.appendChild(search);
        const sort = App.el('select', 'vv-sort');
        sort.title = 'Ordina i progetti';
        [['updated', 'Ordina: ultima modifica'], ['name', 'Ordina: nome A-Z'], ['name-desc', 'Ordina: nome Z-A']].forEach(function (o) {
            const op = App.el('option');
            op.value = o[0];
            op.textContent = o[1];
            sort.appendChild(op);
        });
        sort.value = listSort;
        gr.appendChild(sort);
        bar.appendChild(gr);
        screen.appendChild(bar);

        const list = App.el('div', 'vv-list');
        screen.appendChild(list);

        const sbar = App.el('div', 'vv-statusbar');
        const stMsg = App.el('span', 'vv-status');
        const stCount = App.el('span', 'vv-scount');
        sbar.appendChild(stMsg);
        sbar.appendChild(stCount);
        screen.appendChild(sbar);

        let items = [];
        try { items = await StudyStore.listItems('video'); } catch (e) { console.error(e); }

        // metadati per la card: durata totale (mm:ss) + prima immagine per la miniatura
        const rows = items.map(function (it) {
            let dur = 0, thumb = '';
            try {
                const d = JSON.parse(it.content || '{}');
                (d.clips || []).forEach(function (c) {
                    dur = Math.max(dur, num(c.start) + num(c.dur));
                    if (!thumb && c.type === 'image' && c.src) thumb = mediaUrl(c.src);
                });
            } catch (e) { /* ok */ }
            return { it: it, dur: Math.round(dur * 10) / 10, thumb: thumb };
        });

        function cardFor(r) {
            const it = r.it;
            const card = App.el('div', 'vv-card');
            card.tabIndex = 0;
            const th = App.el('div', 'vv-thumb');
            const ph = App.el('div', 'th-ph');
            ph.innerHTML = I_PLAYCARD;
            th.appendChild(ph);
            if (r.thumb) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = r.thumb;
                img.addEventListener('error', function () { img.remove(); });
                th.appendChild(img);
            }
            const durB = App.el('span', 'th-dur', fmtMS(r.dur));
            th.appendChild(durB);
            card.appendChild(th);
            card.appendChild(App.el('h4', null, App.esc(it.title || 'Senza titolo')));
            const meta = App.el('div', 'vv-meta');
            meta.innerHTML = '<span>' + fmtMS(r.dur) + '</span><span>·</span><span>' + App.esc(App.fmtDate(it.updated_at)) + '</span>';
            card.appendChild(meta);
            card.appendChild(actionsFor(container, it));
            function open() { openEditor(container, it.id); }
            card.addEventListener('click', function (e) {
                if (e.target.closest('.vv-acts')) return;
                open();
            });
            card.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
            return card;
        }

        function paint() {
            const q = (listQ || '').trim().toLowerCase();
            let vis = rows.filter(function (r) { return !q || String(r.it.title || '').toLowerCase().indexOf(q) >= 0; });
            if (listSort === 'name') vis.sort(function (a, b) { return String(a.it.title || '').localeCompare(String(b.it.title || ''), 'it'); });
            else if (listSort === 'name-desc') vis.sort(function (a, b) { return String(b.it.title || '').localeCompare(String(a.it.title || ''), 'it'); });
            list.innerHTML = '';
            if (!rows.length) {
                list.appendChild(App.empty(ICON, 'Nessun progetto video ancora: usa "Nuovo video" per iniziare a montare clip, testi e musica, tutto in locale.', 'Nuovo video', createNew));
                stMsg.textContent = 'Nessun progetto video.';
                stCount.textContent = '0 progetti';
                return;
            }
            if (!vis.length) {
                list.appendChild(App.empty(ICON, 'Nessun risultato per "' + listQ + '". Prova un altro termine.'));
                stMsg.textContent = 'Nessun risultato per la ricerca corrente.';
                stCount.textContent = '0 / ' + rows.length + ' progetti';
                return;
            }
            const grid = App.el('div', 'grid-cards');
            vis.forEach(function (r) { grid.appendChild(cardFor(r)); });
            list.appendChild(grid);
            stMsg.textContent = 'I tuoi progetti video — clip con transizioni, preview e musica.';
            stCount.textContent = (vis.length === rows.length)
                ? rows.length + ' progetti'
                : vis.length + ' / ' + rows.length + ' progetti';
        }

        search.addEventListener('input', function () { listQ = search.value; paint(); });
        sort.addEventListener('change', function () { listSort = sort.value; paint(); });
        paint();
    }

    function actionsFor(container, it) {
        const actions = App.el('div', 'vv-acts');
        const opn = App.el('button'); opn.type = 'button'; opn.textContent = 'Apri';
        opn.addEventListener('click', function () { openEditor(container, it.id); });
        const ren = App.el('button'); ren.type = 'button'; ren.textContent = 'Rinomina';
        ren.addEventListener('click', async function () {
            const t = await ask('Titolo progetto', it.title);
            if (t == null || !t.trim()) return;
            await StudyStore.renameItem(it.id, t.trim());
            showList(container);
        });
        const dup = App.el('button'); dup.type = 'button'; dup.textContent = 'Duplica';
        dup.addEventListener('click', async function () {
            try { await StudyStore.duplicateItem(it.id); } catch (e) { console.error(e); }
            showList(container);
        });
        const del = App.el('button'); del.type = 'button'; del.className = 'danger'; del.textContent = 'Elimina';
        del.addEventListener('click', async function () {
            if (!confirm('Eliminare il progetto "' + (it.title || '') + '"?')) return;
            await StudyStore.deleteItem(it.id);
            showList(container);
        });
        actions.appendChild(opn); actions.appendChild(ren); actions.appendChild(dup); actions.appendChild(del);
        return actions;
    }

    async function createNew() {
        const t = await ask('Titolo progetto',
            'Video senza titolo ' + new Date().toLocaleDateString('it-IT'));
        if (t == null) return;
        let item = null;
        try {
            item = await StudyStore.saveItem({
                kind: 'video',
                title: t.trim() || 'Video senza titolo',
                content: JSON.stringify({ clips: [], music: { src: '', volume: 70 }, lanes: { text: 1, media: 1, audio: 1, music: 0 } })
            });
        } catch (e) { console.error(e); }
        if (item && item.id && root) openEditor(root, item.id);
        else if (root) showList(root);
    }

    // ---------- editor ----------
    function updateMusicLabel() {
        if (!st || !st.musLabelEl) return;
        const s = st.data.music.src;
        let name = 'Nessuna traccia';
        if (s) {
            if (/^(data:|blob:|https?:|file:)/i.test(s)) {
                name = s.length > 44 ? 'Traccia locale…' : s;
            } else {
                const parts = String(s).split(/[\\/]/);
                name = parts[parts.length - 1] || 'Traccia';
            }
        }
        st.musLabelEl.textContent = name;
    }

    // ---------- R21 B4: pannello Fonti (FontiPanel, contesto 'video') ----------
    // Mount SOLO in editor: bottone "Fonti" nella toolbar, pannello laterale
    // (wrapper assoluto a destra sul contenitore reso position:relative).
    // onInsert -> fpInsert: clip di TESTO al playhead corrente con riferimento
    // 'titolo (tipo)' (emoji paperclip) + prov {tipo,titolo,fonteId}; stessa
    // provenienza pushata in st.data.fpSources (content.fpSources, salvato da
    // flush). pushHist e' richiamato da scheduleSave DOPO ogni mutazione:
    // doUndo() (Ctrl+Z) torna allo snapshot precedente e rimuove clip+fpSources.
    let fpPanel = null, fpWrap = null;
    function fpClose() {
        if (fpPanel) { try { fpPanel.destroy(); } catch (e) { /* ok */ } fpPanel = null; }
        if (fpWrap && fpWrap.parentNode) fpWrap.parentNode.removeChild(fpWrap);
        fpWrap = null;
        if (st && st.fpBtn) st.fpBtn.classList.remove('on');
    }
    function fpToggle(btn) {
        if (fpPanel) { fpClose(); return; }
        if (!st || !window.FontiPanel || typeof window.FontiPanel.create !== 'function') return;
        const host = root || document.body;
        if (host && host.style) host.style.position = 'relative';
        fpWrap = App.el('div', 'vv-fpwrap');
        fpWrap.style.cssText = 'position:absolute;top:0;right:0;bottom:0;z-index:45;display:flex;' +
            'flex-direction:column;align-items:flex-start;background:#151925;border-left:1px solid #2c3245;' +
            'box-shadow:-8px 0 24px rgba(0,0,0,.4);padding:8px;overflow:hidden;';
        fpPanel = window.FontiPanel.create({ contesto: 'video', onInsert: fpInsert });
        fpWrap.appendChild(fpPanel.el);
        if (host) host.appendChild(fpWrap);
        if (btn) btn.classList.add('on');
    }
    function fpInsert(source, info) {
        if (!st) return;
        const titolo = String((info && info.titolo) || (source && source.title) || 'Fonte');
        const tipo = String((info && info.tipo) || 'Fonte');
        const fid = (info && info.id != null) ? String(info.id) : ((source && source.id != null) ? String(source.id) : '');
        const label = '\uD83D\uDCCE ' + titolo + ' (' + tipo + ')';
        const c = newClip('text', Math.max(0, num(st.playhead)));   // marker al playhead corrente
        c.text = label;
        c.dur = 3;
        c.prov = { tipo: tipo, titolo: titolo, fonteId: fid };
        assignLane(c);
        st.data.clips.push(c);
        if (!Array.isArray(st.data.fpSources)) st.data.fpSources = [];
        st.data.fpSources.push({ tipo: tipo, titolo: titolo, fonteId: fid, ts: Date.now() });
        st.sel = c.id;
        applyAll();                        // render + scheduleSave -> pushHist (checkpoint)
        setStatus('Fonte inserita al ' + fmtMS(num(st.playhead)) + '.');
    }

    async function openEditor(container, id) {
        const item = await StudyStore.getItem(id);
        if (!item) { showList(container); return; }
        stopAllPlayback();
        releaseKeys();               // R21 B4: stacca listener tastiera del precedente editor
        fpClose();                   // R21 B4: pannello Fonti del precedente editor
        root = container;
        st = {
            id: item.id,
            title: item.title || 'Progetto video senza titolo',
            data: parseContent(item),
            sel: null,
            playhead: 0,
            pps: PPS_DEF,
            stageEl: null, tlEl: null, ctxEl: null,
            innerEl: null, tlScrollEl: null, phEl: null, guideEl: null,
            zoomEl: null, zoomValEl: null, statusEl: null,
            timeEl: null, rangeEl: null, durEl: null, titleEl: null,
            splitBtn: null, dupBtn: null, delBtn: null, exportBtn: null,
            musLabelEl: null,
            exporting: false, exportCancel: false, exportRaf: 0
        };
        // R21 B4: storia undo/redo attiva dall'apertura (snapshot iniziale) +
        // scorciatoie Ctrl+Z/Ctrl+Y: doUndo/doRedo esistevano ma non erano
        // agganciati (releaseKeys e' gia' predisposto a rimuovere st.keyHandler).
        st.hist = [snapHist()];
        st.histIdx = 0;
        st.keyHandler = function (e) {
            if (!st || st.exporting) return;
            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                const lk = String(e.key).toLowerCase();
                if (lk === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
                if (lk === 'y') { e.preventDefault(); doRedo(); return; }
            }
        };
        window.addEventListener('keydown', st.keyHandler);
        pv = { playing: false, raf: 0, last: 0, lastUi: 0, mounted: {}, pending: {}, music: null };
        container.classList.add('vv-editor');
        container.innerHTML = '';

        // toolbar superiore
        const bar = App.el('div');
        bar.className = 'toolbar';
        const back = App.el('button', 'tool-btn');
        back.type = 'button';
        back.innerHTML = '&larr; Elenco';
        back.addEventListener('click', function () { showList(root); });
        bar.appendChild(back);

        const renBtn = App.el('button', 'tool-btn');
        renBtn.type = 'button';
        renBtn.textContent = 'Rinomina';
        renBtn.addEventListener('click', async function () {
            const t = await ask('Titolo progetto', st.title);
            if (t == null || !t.trim()) return;
            st.title = t.trim();
            if (st.titleEl) st.titleEl.textContent = st.title;
            StudyStore.renameItem(st.id, st.title);
            scheduleSave();
        });
        bar.appendChild(renBtn);

        const exportBtn = App.el('button', 'tool-btn');
        exportBtn.type = 'button';
        exportBtn.innerHTML = I_EXP + ' Esporta video';
        exportBtn.title = 'Esporta il progetto in un file video (.webm)';
        exportBtn.addEventListener('click', openExportDialog);
        bar.appendChild(exportBtn);
        st.exportBtn = exportBtn;

        // ---- H11: genera script video (F13) ----
        const aiScript = App.el('button', 'tool-btn');
        aiScript.type = 'button';
        aiScript.textContent = 'Script AI';
        aiScript.title = 'Genera lo script del video (AI: F13)';
        aiScript.addEventListener('click', function () { aiVideoScript(aiScript); });
        bar.appendChild(aiScript);

        // ---- R21 B4: Fonti (FontiPanel, contesto 'video'): toggle laterale ----
        const fpBtn = App.el('button', 'tool-btn');
        fpBtn.type = 'button';
        fpBtn.textContent = 'Fonti';
        fpBtn.title = 'Apri/chiudi le fonti inseribili nella timeline (R21)';
        fpBtn.addEventListener('click', function () { fpToggle(fpBtn); });
        bar.appendChild(fpBtn);
        st.fpBtn = fpBtn;

        const sp = App.el('span'); sp.style.flex = '1'; bar.appendChild(sp);
        const titleEl = App.el('span', null, App.esc(st.title));
        titleEl.style.cssText = 'font-size:14.5px;font-weight:800;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        bar.appendChild(titleEl);
        st.titleEl = titleEl;
        container.appendChild(bar);

        // corpo: split (pannelli) + timeline a tutta larghezza
        const body = App.el('div', 'vv-body');
        container.appendChild(body);

        const split = App.el('div', 'vv-split');
        const pane = App.el('div', 'vv-pane vv-side');   // alias: le regole CSS di collasso puntano a .vv-side (V5)
        const main = App.el('div', 'vv-main');
        split.appendChild(pane);
        split.appendChild(main);
        body.appendChild(split);

        // ---- BLOCCO 1: pannello sinistro = colonna STRETTA a sinistra della preview ----
        // linguetta verticale di collasso
        const vtab = App.el('div', 'vv-vtab', 'ELEMENTI');
        vtab.title = 'Nascondi/mostra il pannello elementi';
        vtab.addEventListener('click', function () { pane.classList.toggle('collapsed'); });
        pane.appendChild(vtab);

        // colonna fissa 200px (default), ridimensionabile 180–320 con maniglia
        st.leftW = 200;
        const lpanel = App.el('div', 'vv-panel vv-left');
        lpanel.style.width = st.leftW + 'px';
        pane.appendChild(lpanel);
        st.leftPanelEl = lpanel;

        // sezioni collassabili (nessuna scrollbar interna: overflow hidden di .vv-panel)
        function vsection(title, buildBody) {
            const sect = App.el('div', 'vv-lsect');
            const head = App.el('div', 'vv-sect');
            const tt = App.el('span', null, title);
            const car = App.el('span', 'vv-caret', '\u25be');
            head.appendChild(tt);
            head.appendChild(car);
            const bodyEl = App.el('div', 'vv-sbody');
            buildBody(bodyEl);
            head.addEventListener('click', function () {
                sect.classList.toggle('collapsed');
                car.textContent = sect.classList.contains('collapsed') ? '\u25b8' : '\u25be';
            });
            sect.appendChild(head);
            sect.appendChild(bodyEl);
            return sect;
        }

        lpanel.appendChild(vsection('Aggiungi elemento', function (box) {
            // bottoni compatti in griglia 2×2 (32px), mai full-width
            const grid = App.el('div', 'vv-addgrid');
            [['text', 'Testo'], ['image', 'Immagine'], ['video', 'Video locale'], ['audio', 'Audio locale']].forEach(function (a) {
                const b = App.el('button', 'vv-addb');
                b.type = 'button';
                b.innerHTML = PLUS + '<span>' + a[1] + '</span>';
                b.addEventListener('click', function () { addClip(a[0]); });
                grid.appendChild(b);
            });
            box.appendChild(grid);
        }));

        lpanel.appendChild(vsection('Musica di sottofondo', function (box) {
            const musRow = App.el('div', 'vv-musrow');
            const musBtn = App.el('button', 'vv-mbtn');
            musBtn.type = 'button';
            musBtn.textContent = 'Scegli traccia';
            musBtn.addEventListener('click', async function () {
                const src = await pickMedia('audio');
                if (!src) return;
                st.data.music.src = src;
                updateMusicLabel();
                renderTimeline();
                scheduleSave();
            });
            musRow.appendChild(musBtn);
            const volLab = App.el('span', null, 'Volume');
            volLab.style.cssText = 'font-size:11.5px;color:var(--muted);font-weight:700;flex:0 0 auto';
            musRow.appendChild(volLab);
            const vol = App.el('input', 'vv-vol');
            vol.type = 'range'; vol.min = '0'; vol.max = '100';
            vol.value = st.data.music.volume == null ? 70 : st.data.music.volume;
            vol.addEventListener('input', function () {
                st.data.music.volume = parseInt(vol.value, 10) || 0;
                if (pv && pv.music) pv.music.volume = st.data.music.volume / 100;
                scheduleSave();
            });
            vol.addEventListener('change', function () { renderTimeline(); });
            musRow.appendChild(vol);
            st.musVolEl = vol;
            box.appendChild(musRow);
            const musLabel = App.el('div', 'vv-muslabel', 'Nessuna traccia');
            box.appendChild(musLabel);
            st.musLabelEl = musLabel;
        }));
        updateMusicLabel();

        const info = App.el('div', 'vv-note');
        info.style.marginTop = 'auto';
        info.innerHTML = 'Ogni clip ha <b>inizio</b> e <b>durata</b> in secondi. ' +
            'Trascina i bordi delle clip per ritagliarle, usa <b>Ctrl+rotella</b> sul tempo per lo zoom.';
        lpanel.appendChild(info);

        // maniglia di ridimensionamento (min 180, max 320)
        const lgrab = App.el('div', 'vv-lgrab');
        lgrab.title = 'Trascina per ridimensionare (180–320px)';
        pane.appendChild(lgrab);
        lgrab.addEventListener('pointerdown', function (e) {
            if (e.button) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = st.leftW;
            function mv(ev) {
                st.leftW = clamp(Math.round(startW + (ev.clientX - startX)), 180, 320);
                lpanel.style.width = st.leftW + 'px';
            }
            function up() {
                window.removeEventListener('pointermove', mv);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
            }
            window.addEventListener('pointermove', mv);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
        });

        // ---- pannello centrale: preview + trasporto ----
        const stage = App.el('div', 'vv-stage');
        main.appendChild(stage);
        st.stageEl = stage;

        const transport = App.el('div', 'vv-transport');
        function tbtn(label, title, fn) {
            const b = App.el('button', 'tool-btn');
            b.type = 'button';
            b.textContent = label;
            b.title = title;
            b.addEventListener('click', fn);
            transport.appendChild(b);
            return b;
        }
        tbtn('▶ Play', 'Avvia la preview', play);
        tbtn('⏸ Pausa', 'Metti in pausa', pause);
        tbtn('⏮ Torna a 0', 'Torna all\'inizio e ferma', stopAllPlayback);

        const timeEl = App.el('span', 'vv-time', '00:00.0 / 00:00.0');
        transport.appendChild(timeEl);
        st.timeEl = timeEl;

        const range = App.el('input', 'vv-range');
        range.type = 'range';
        range.min = '0';
        range.max = '1';
        range.step = '0.05';
        range.value = '0';
        range.title = 'Scrubber sincronizzato con il playhead';
        range.addEventListener('input', function () {
            setPlayhead(parseFloat(range.value) || 0);
        });
        transport.appendChild(range);
        st.rangeEl = range;
        main.appendChild(transport);

        const durEl = App.el('div', 'vv-ok', 'Durata totale: 00:00.0');
        main.appendChild(durEl);
        st.durEl = durEl;

        // ---- timeline in basso, a tutta larghezza ----
        const tlWrap = App.el('div', 'vv-tlwrap');
        const tools = App.el('div', 'vv-tltools');
        const tlTitle = App.el('span', 'tl-title', 'Timeline');
        tools.appendChild(tlTitle);
        const statusEl = App.el('span', 'vv-status', '');
        tools.appendChild(statusEl);
        st.statusEl = statusEl;

        function ttool(icon, title, fn) {
            const b = App.el('button', 'tool-btn');
            b.type = 'button';
            b.innerHTML = icon;
            b.title = title;
            b.addEventListener('click', fn);
            tools.appendChild(b);
            return b;
        }
        st.splitBtn = ttool(I_SPLIT, 'Dividi la clip selezionata al playhead', splitClip);
        st.dupBtn = ttool(I_DUP, 'Duplica la clip selezionata (gap 0.1s)', dupClip);
        st.delBtn = ttool(I_DEL, 'Elimina la clip selezionata', delClip);

        const tsp = App.el('span'); tsp.style.flex = '1'; tools.appendChild(tsp);

        // zoom: vive nella riga HEADER della timeline (.vv-tltools = header di .vv-tlwrap) — V3f
        const zIcon = App.el('span', null, I_ZOOM);
        zIcon.title = 'Zoom timeline (o Ctrl+rotella sul tempo)';
        zIcon.style.cssText = 'display:inline-flex;color:var(--muted);width:15px;height:15px';
        zIcon.querySelector('svg').style.cssText = 'width:15px;height:15px';
        tools.appendChild(zIcon);
        const zoom = App.el('input', 'vv-zoom');
        zoom.type = 'range';
        zoom.min = String(PPS_MIN);
        zoom.max = String(PPS_MAX);
        zoom.step = '1';
        zoom.value = String(PPS_DEF);
        zoom.title = 'Zoom timeline: pixel per secondo (10–240) — Ctrl+rotella sul tempo';
        zoom.addEventListener('input', function () { setZoom(parseInt(zoom.value, 10) || PPS_DEF); });
        tools.appendChild(zoom);
        st.zoomEl = zoom;
        const zVal = App.el('span', 'vv-zoomval', PPS_DEF + ' px/s');
        tools.appendChild(zVal);
        st.zoomValEl = zVal;
        tlWrap.appendChild(tools);

        // barra proprieta contestuale (V1): dopo la riga header (.vv-tltools) e
        // prima di .vv-tlbody; visibile solo con clip o musica selezionata
        const ctx = App.el('div', 'vv-ctxbar');
        ctx.style.display = 'none';
        st.ctxEl = ctx;
        tlWrap.appendChild(ctx);

        const tlBody = App.el('div', 'vv-tlbody');
        const labels = App.el('div', 'vv-tlabels');
        labels.appendChild(App.el('div', 'vv-lab-sp'));
        tlBody.appendChild(labels);
        st.labelsEl = labels;   // etichette rigenerate da renderTimeline (corsie multiple)

        const scroll = App.el('div', 'vv-tscroll');
        const inner = App.el('div', 'vv-tinner');
        scroll.appendChild(inner);
        tlBody.appendChild(scroll);
        tlWrap.appendChild(tlBody);
        body.appendChild(tlWrap);

        st.tlEl = inner;
        st.innerEl = inner;
        st.tlScrollEl = scroll;

        // Ctrl+rotella = zoom (senza interferire con lo scroll verticale)
        scroll.addEventListener('wheel', function (e) {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            setZoom(st.pps * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        }, { passive: false });

        renderTimeline();
        renderCtxBar();
        updateDur();
        updateTime();
        updatePlayhead();
    }

    // ---------- clip ----------
    function clipById(cid) {
        for (let i = 0; i < st.data.clips.length; i++) if (st.data.clips[i].id === cid) return st.data.clips[i];
        return null;
    }
    function typeLabel(t) {
        return t === 'text' ? 'Testo' : t === 'image' ? 'Immagine' : t === 'video' ? 'Video' : t === 'music' ? 'Musica' : 'Audio';
    }
    function fileName(src) {
        if (!src) return '';
        if (/^(data:|blob:|https?:|file:)/i.test(src)) return src.length > 34 ? 'file locale…' : src;
        const parts = String(src).split(/[\\/]/);
        return parts[parts.length - 1] || src;
    }
    function clipTitle(c) {
        if (c.type === 'text') return 'Testo: ' + String(c.text || '').slice(0, 26);
        return typeLabel(c.type) + (c.src ? ' · ' + fileName(c.src) : '');
    }
    function setStatus(msg, sticky) {
        if (!st || !st.statusEl) return;
        st.statusEl.textContent = msg || '';
        if (st.statusTimer) clearTimeout(st.statusTimer);
        if (msg && !sticky) st.statusTimer = setTimeout(function () {
            if (st && st.statusEl) st.statusEl.textContent = '';
        }, 3200);
    }

    async function addClip(type) {
        const src = type === 'text' ? null : await pickMedia(type);
        if (type !== 'text' && !src) return;
        const c = newClip(type, appendStart());
        if (type !== 'text') c.src = src;
        assignLane(c);
        st.data.clips.push(c);
        st.sel = c.id;
        applyAll();
        setStatus('Aggiunta clip ' + typeLabel(type) + '.');
    }

    function updateToolState() {
        if (!st) return;
        const has = !!(st.sel && st.sel !== '@music' && clipById(st.sel));
        if (st.splitBtn) st.splitBtn.disabled = !has;
        if (st.dupBtn) st.dupBtn.disabled = !has;
        if (st.delBtn) st.delBtn.disabled = !has;
    }
    function syncSelClasses() {
        if (!st || !st.innerEl) return;
        const nodes = st.innerEl.querySelectorAll('.vv-tclip[data-cid]');
        Array.prototype.forEach.call(nodes, function (n) {
            n.classList.toggle('active', n.getAttribute('data-cid') === st.sel);
        });
        updateToolState();
    }

    // aggiorna tutto (timeline + barra contestuale + preview + salvataggio)
    function applyAll() {
        renderTimeline();
        renderCtxBar();
        updateDur();
        updatePlayhead();
        if (pv) { clearStage(); syncStage(); }
        scheduleSave();
    }

    // ---------- 4.1/4.2/4.3: timeline multitaccia ----------
    function rulerStep(pps) {
        if (pps >= 60) return 1;
        if (pps >= 25) return 5;
        return 10;
    }

    function renderTimeline() {
        if (!st || !st.innerEl) return;
        const inner = st.innerEl;
        const pps = st.pps;
        const total = Math.max(totalDur(), 10);
        const sc = st.tlScrollEl;
        const w = Math.max(total * pps + 160, sc ? sc.clientWidth : 0, 480);
        inner.innerHTML = '';
        inner.style.width = w + 'px';

        // righello adattivo
        const rul = App.el('div', 'vv-truler');
        const step = rulerStep(pps);
        const maxT = total + step;
        for (let s = 0; s <= maxT; s += step) {
            const x = s * pps;
            if (x > w) break;
            const tk = App.el('div', 'vv-tick', fmtTick(s));
            tk.style.left = x + 'px';
            rul.appendChild(tk);
        }
        inner.appendChild(rul);

        // righe traccia per GRUPPO e per CORSIA (BLOCCO 2)
        // - corsie diverse dello stesso gruppo possono sovrapporsi nel tempo
        // - nella stessa corsia le clip non si sovrapposono (vincolo + snap)
        const tracks = App.el('div', 'vv-ttracks');
        const rows = {}; // "gruppo:riga" -> elemento riga
        st.laneRows = {};
        if (st.labelsEl) {
            st.labelsEl.innerHTML = '';
            st.labelsEl.appendChild(App.el('div', 'vv-lab-sp'));
        }
        TRACKS.forEach(function (t) {
            const g = t.key;
            // intestazione gruppo con pulsante "+" (aggiunge una corsia dello stesso tipo)
            const lh = App.el('div', 'vv-lhead');
            const hdot = App.el('i');
            hdot.style.background = t.color;
            lh.appendChild(hdot);
            lh.appendChild(App.el('span', null, t.label));
            const plus = App.el('button', 'vv-laneadd', '+');
            plus.type = 'button';
            plus.title = 'Aggiungi una corsia a "' + t.label + '" (es. "' + t.label + ' 2")';
            plus.addEventListener('click', function (e) {
                e.stopPropagation();
                addLane(g);
                if (g === 'music') {
                    // la nuova corsia musica pu\u00f2 subito ospitare una traccia locale
                    pickMedia('audio').then(function (src) {
                        if (!st) return;
                        if (src) {
                            const c = newClip('music', r05(st.playhead));
                            c.src = src;
                            c.lane = laneCount('music') - 1;
                            st.data.clips.push(c);
                            st.sel = c.id;
                            setStatus('Corsia "Musica 2" aggiunta con una traccia.');
                        } else {
                            setStatus('Corsia musica aggiunta (vuota).');
                        }
                        applyAll();
                    });
                    return;
                }
                setStatus('Corsia "' + t.label + ' ' + laneCount(g) + '" aggiunta.');
                applyAll();
            });
            lh.appendChild(plus);
            tracks.appendChild(lh);

            if (st.labelsEl) st.labelsEl.appendChild(App.el('div', 'vv-lhead-sp'));

            const nRows = rowCount(g);
            st.laneRows[g] = [];
            for (let li = 0; li < nRows; li++) {
                const row = App.el('div', 'vv-track');
                row.setAttribute('data-track', g);
                row.setAttribute('data-lane', String(li));
                row.title = laneTitle(g, li);
                row.addEventListener('pointerdown', function (e) {
                    if (e.target === row && st.sel !== null) {
                        st.sel = null;
                        syncSelClasses();
                        renderCtxBar();
                    }
                });
                tracks.appendChild(row);
                rows[g + ':' + li] = row;
                const clipLane = g === 'music' ? li - 1 : li;
                if (g !== 'music' || li > 0) st.laneRows[g].push({ lane: clipLane, row: row });

                // etichetta corsia (nome + elimina)
                if (st.labelsEl) {
                    const l = App.el('div', 'vv-lab');
                    const ld = App.el('i');
                    ld.style.background = t.color;
                    l.appendChild(ld);
                    l.appendChild(document.createTextNode(laneTitle(g, li)));
                    if (!(g === 'music' && li === 0)) {
                        const del = App.el('button', 'vv-lanedel', '\u00d7');
                        del.type = 'button';
                        del.title = 'Elimina questa corsia';
                        del.addEventListener('click', function (e) {
                            e.stopPropagation();
                            removeLane(g, clipLane);
                        });
                        l.appendChild(del);
                    }
                    st.labelsEl.appendChild(l);
                }
            }
        });
        st.rowEls = rows;
        inner.appendChild(tracks);

        // clip nella riga della loro corsia
        st.data.clips.forEach(function (c) {
            const row = rows[rowKeyOf(c)];
            if (!row) return;
            row.appendChild(clipBlock(c));
        });

        // riga "Musica" (sottofondo globale) = st.data.music
        if (st.data.music.src) {
            const b = App.el('div', 'vv-tclip' + (st.sel === '@music' ? ' active' : ''));
            b.setAttribute('data-cid', '@music');
            b.style.left = '0px';
            b.style.width = Math.max(16, total * pps) + 'px';
            b.style.background = '#c9b8e8';
            b.style.cursor = 'pointer';
            b.innerHTML =
                '<div class="tc-in"></div>' +
                '<div class="tc-t">Musica: ' + App.esc(fileName(st.data.music.src)) + '</div>' +
                '<div class="tc-m">sottofondo \u266a volume ' + (st.data.music.volume == null ? 70 : num(st.data.music.volume)) + '%</div>';
            b.title = 'Traccia musicale di sottofondo \u2014 clic per le propriet\u00e0';
            b.addEventListener('pointerdown', function (e) {
                if (e.button) return;
                e.stopPropagation();
                st.sel = '@music';
                syncSelClasses();
                renderCtxBar();
            });
            if (rows['music:0']) rows['music:0'].appendChild(b);
        }

        // icona sui giunti con transizione
        st.data.clips.forEach(function (c) {
            let pred = null;
            for (let i = 0; i < st.data.clips.length; i++) {
                const x = st.data.clips[i];
                if (x.id !== c.id && Math.abs((num(x.start) + num(x.dur)) - num(c.start)) <= 0.05) { pred = x; break; }
            }
            if (!pred) return;
            if (effTrans(pred, c) === 'none') return;
            const row = rows[rowKeyOf(c)];
            if (!row) return;
            const ic = App.el('div', 'vv-jn', '\u25c6');
            ic.style.left = (num(c.start) * pps) + 'px';
            ic.title = 'Transizione al giunto: ' + (trIn(c) !== 'none' ? trIn(c) : trOut(pred));
            row.appendChild(ic);
        });

        // linea guida (snap durante il trascinamento)
        const guide = App.el('div', 'vv-guide');
        inner.appendChild(guide);
        st.guideEl = guide;

        // playhead su tutte le righe con maniglia in cima
        const ph = App.el('div', 'vv-ph');
        const hnd = App.el('div', 'hnd');
        hnd.title = 'Trascina il playhead';
        ph.appendChild(hnd);
        inner.appendChild(ph);
        st.phEl = ph;
        hnd.addEventListener('pointerdown', function (e) { beginSeek(e); });

        // click sul righello = seek (con drag)
        rul.addEventListener('pointerdown', function (e) { beginSeek(e); });

        updatePlayhead();
        syncSelClasses();
    }

    function clipBlock(c) {
        const node = App.el('div', 'vv-tclip' + (st.sel === c.id ? ' active' : ''));
        node.setAttribute('data-cid', c.id);
        node.style.left = (num(c.start) * st.pps) + 'px';
        node.style.width = Math.max(16, num(c.dur) * st.pps) + 'px';
        node.style.background = colorOf(c);
        node.innerHTML =
            '<div class="tc-in"></div>' +
            '<div class="tc-t">' + App.esc(clipTitle(c)) + '</div>' +
            '<div class="tc-m">' + fmtT(num(c.start)) + ' → ' + fmtT(num(c.start) + num(c.dur)) +
            ' · ' + App.esc(trIn(c)) + '/' + App.esc(trOut(c)) + '</div>';
        node.title = 'Trascina per spostare · bordi per ritagliare · ' + App.esc(clipTitle(c));

        const hl = App.el('div', 'th th-l');
        hl.title = 'Ritaglia l\'inizio';
        const hr = App.el('div', 'th th-r');
        hr.title = 'Ritaglia la fine';
        node.appendChild(hl);
        node.appendChild(hr);

        node.addEventListener('pointerdown', function (e) {
            if (e.button) return;
            e.preventDefault();
            e.stopPropagation();
            const mode = (e.target === hl) ? 'l' : (e.target === hr) ? 'r' : 'move';
            if (st.sel !== c.id) {
                st.sel = c.id;
                syncSelClasses();
                renderCtxBar();
            }
            startClipDrag(e, c, node, mode);
        });
        return node;
    }

    // ---- 4.2: drag + trim con snap ----
    function startClipDrag(e, c, node, mode) {
        const pps = st.pps;
        const x0 = e.clientX;
        const origStart = num(c.start);
        const origDur = Math.max(0.5, num(c.dur));
        const origEnd = origStart + origDur;

        // target di snap: playhead, 0 e bordi delle altre clip della STESSA corsia
        const g0 = trackKeyOf(c);
        const targets = [st.playhead, 0];
        st.data.clips.forEach(function (x) {
            if (x.id !== c.id && trackKeyOf(x) === g0 && (x.lane || 0) === (c.lane || 0)) {
                targets.push(num(x.start));
                targets.push(num(x.start) + num(x.dur));
            }
        });
        const thr = Math.max(6 / pps, 0.06);   // 6px oppure 0.1s

        function trySnap(v) {
            let best = v, bd = thr, hit = false;
            for (let i = 0; i < targets.length; i++) {
                const d = Math.abs(targets[i] - v);
                if (d < bd) { bd = d; best = targets[i]; hit = true; }
            }
            return { v: best, hit: hit, err: hit ? bd : Infinity };
        }
        function showGuide(t) {
            if (!st.guideEl) return;
            if (t == null) { st.guideEl.style.display = 'none'; return; }
            st.guideEl.style.display = 'block';
            st.guideEl.style.left = (t * pps) + 'px';
        }
        // corsia sotto il puntatore (solo stesso gruppo: tra gruppi diversi niente droppable)
        function detectLane(ev) {
            const list = st.laneRows && st.laneRows[g0];
            if (!list) return c.lane || 0;
            for (let i = 0; i < list.length; i++) {
                const r = list[i].row.getBoundingClientRect();
                if (r && r.height > 0 && ev.clientY >= r.top && ev.clientY < r.bottom) return list[i].lane;
            }
            return c.lane || 0;
        }
        function apply(ev) {
            const dx = (ev.clientX - x0) / pps;
            let s = origStart, d = origDur, guide = null;
            if (mode === 'move') {
                s = Math.max(0, r05(origStart + dx));
                const sa = trySnap(s);
                const endRaw = s + origDur;
                const sb = trySnap(r05(endRaw));
                if (sa.hit && (!sb.hit || sa.err <= sb.err)) { s = Math.max(0, sa.v); guide = s; }
                else if (sb.hit) {
                    const s2 = r05(sb.v - origDur);
                    if (s2 >= 0) { s = s2; guide = sb.v; }
                }
                d = origDur;
                // 2.5: trascinamento su un'altra corsia dello stesso gruppo
                const tl = detectLane(ev);
                if (tl !== (c.lane || 0)) {
                    if (laneFree(g0, tl, s, d, c.id)) {
                        c.lane = tl;
                        const target = st.rowEls && st.rowEls[rowKeyOf(c)];
                        if (target && node.parentNode !== target) target.appendChild(node);
                    }
                }
                // 2.3: nella STESSA corsia niente sovrapposizioni
                if (!laneFree(g0, c.lane || 0, s, d, c.id)) s = clampFree(g0, c.lane || 0, s, d, c.id);
            } else if (mode === 'l') {
                s = clamp(r05(origStart + dx), 0, Math.max(0, origEnd - 0.5));
                const sa = trySnap(s);
                if (sa.hit) s = clamp(sa.v, 0, Math.max(0, origEnd - 0.5));
                guide = sa.hit ? s : null;
                d = origEnd - s;
                if (!laneFree(g0, c.lane || 0, s, d, c.id)) {
                    s = clampFree(g0, c.lane || 0, s, d, c.id);
                    d = origEnd - s;
                }
            } else { // 'r' = trim fine
                let end = Math.max(origStart + 0.5, r05(origEnd + dx));
                const se = trySnap(end);
                if (se.hit) end = Math.max(origStart + 0.5, se.v);
                guide = se.hit ? end : null;
                s = origStart;
                d = end - origStart;
                if (!laneFree(g0, c.lane || 0, s, d, c.id)) {
                    s = clampFree(g0, c.lane || 0, s, d, c.id);
                    d = Math.max(0.5, origEnd - s);
                    if (!laneFree(g0, c.lane || 0, s, d, c.id)) { s = origStart; d = origDur; }
                }
            }
            c.start = r2(Math.max(0, s));
            c.dur = r2(Math.max(0.5, d));
            node.style.left = (c.start * pps) + 'px';
            node.style.width = Math.max(16, c.dur * pps) + 'px';
            showGuide(guide);
        }
        function done() {
            window.removeEventListener('pointermove', apply);
            window.removeEventListener('pointerup', done);
            window.removeEventListener('pointercancel', done);
            showGuide(null);
            c.start = r2(Math.max(0, r05(c.start)));
            c.dur = r2(Math.max(0.5, r05(c.dur)));
            applyAll();
        }
        window.addEventListener('pointermove', apply);
        window.addEventListener('pointerup', done);
        window.addEventListener('pointercancel', done);
        apply(e);
    }

    // ---- 4.3: playhead / seek / zoom ----
    function beginSeek(e) {
        if (!st || e.button) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = st.innerEl.getBoundingClientRect();
        const total = totalDur();
        function pos(ev) {
            return clamp((ev.clientX - rect.left) / st.pps, 0, total);
        }
        setPlayhead(pos(e));
        function mv(ev) { setPlayhead(pos(ev)); }
        function up() {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        }
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    }

    function setPlayhead(t) {
        if (!st) return;
        st.playhead = clamp(num(t), 0, totalDur());
        updatePlayhead();
        updateTime();
        syncStage();
    }
    function updatePlayhead() {
        if (!st || !st.phEl) return;
        st.phEl.style.left = (st.playhead * st.pps) + 'px';
    }
    function setZoom(v) {
        if (!st) return;
        const sc = st.tlScrollEl;
        const old = st.pps || PPS_DEF;
        st.pps = Math.round(clamp(v, PPS_MIN, PPS_MAX));
        const ratio = sc ? sc.scrollLeft / old : 0;
        renderTimeline();
        updatePlayhead();
        if (sc) sc.scrollLeft = ratio * st.pps;
        if (st.zoomEl && parseInt(st.zoomEl.value, 10) !== st.pps) st.zoomEl.value = String(st.pps);
        if (st.zoomValEl) st.zoomValEl.textContent = st.pps + ' px/s';
    }
    function ensureVisible() {
        if (!st || !st.tlScrollEl) return;
        const sc = st.tlScrollEl;
        const x = st.playhead * st.pps;
        if (x > sc.scrollLeft + sc.clientWidth - 80) sc.scrollLeft = Math.max(0, x - (sc.clientWidth - 80));
        else if (x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 20);
    }

    // ---- 4.4: strumenti (dividi / duplica / elimina) ----
    function splitClip() {
        const c = (st.sel && st.sel !== '@music') ? clipById(st.sel) : null;
        if (!c) { setStatus('Seleziona una clip da dividere.'); return; }
        const ph = st.playhead;
        const s = num(c.start), d = Math.max(0.5, num(c.dur));
        if (ph < s + 0.1 || ph > s + d - 0.1) {
            setStatus('Il playhead è fuori dalla clip (serve un margine di 0.1s).');
            return;
        }
        const idx = st.data.clips.indexOf(c);
        const d1 = Math.max(0.5, r05(ph - s));
        const d2 = Math.max(0.5, r05(s + d - ph));
        const tin = trIn(c), tout = trOut(c);
        const p1 = Object.assign({}, c, {
            dur: d1,
            transitionIn: tin, transitionOut: 'none',
            transition: tin === 'none' ? 'cut' : tin
        });
        const p2 = Object.assign({}, c, {
            id: uid(), start: r05(s + d1), dur: d2,
            transitionIn: 'none', transitionOut: tout, transition: 'cut'
        });
        st.data.clips.splice(idx, 1, p1, p2);
        st.sel = p2.id;
        applyAll();
        setStatus('Clip divisa al playhead: parte 1 (in: ' + tin + '), parte 2 (out: ' + tout + ' modificabile).');
    }

    function dupClip() {
        const c = (st.sel && st.sel !== '@music') ? clipById(st.sel) : null;
        if (!c) { setStatus('Seleziona una clip da duplicare.'); return; }
        const idx = st.data.clips.indexOf(c);
        const copy = JSON.parse(JSON.stringify(c));
        copy.id = uid();
        copy.start = r2(r05(num(c.start) + num(c.dur) + 0.1));
        if (!laneFree(trackKeyOf(copy), copy.lane || 0, copy.start, copy.dur, copy.id)) assignLane(copy);
        st.data.clips.splice(idx + 1, 0, copy);
        st.sel = copy.id;
        applyAll();
        setStatus('Clip duplicata (gap 0.1s).');
    }

    function delClip() {
        if (st.sel === '@music') { setStatus('La musica si gestisce dal pannello di sinistra.'); return; }
        const c = st.sel ? clipById(st.sel) : null;
        if (!c) { setStatus('Seleziona una clip da eliminare.'); return; }
        if (!confirm('Eliminare la clip selezionata (' + clipTitle(c) + ')?')) return;
        st.data.clips = st.data.clips.filter(function (x) { return x.id !== c.id; });
        st.sel = null;
        applyAll();
        setStatus('Clip eliminata.');
    }

    // ---------- 4.5: proprietà clip/musica nella barra contestuale .vv-ctxbar (V1) ----------
    function applyProps() {
        renderTimeline();
        updateDur();
        updatePlayhead();
        if (pv) { clearStage(); syncStage(); }
        scheduleSave();
    }

    function renderCtxBar() {
        if (!st || !st.ctxEl) return;
        const p = st.ctxEl;
        p.innerHTML = '';
        // barra contestuale: visibile SOLO con clip o musica selezionata (V1)
        const isSelMusic = st.sel === '@music';
        const selClip = (!isSelMusic && st.sel) ? clipById(st.sel) : null;
        if (!isSelMusic && !selClip) { p.style.display = 'none'; updateToolState(); return; }
        p.style.display = '';
        p.appendChild(App.el('div', 'vv-sect', 'Proprietà'));

        // --- musica ---
        if (st.sel === '@music') {
            p.appendChild(App.el('span', 'lab', 'Musica di sottofondo'));
            const nm = App.el('div', 'vv-note', App.esc(fileName(st.data.music.src) || 'Nessuna traccia'));
            p.appendChild(nm);

            const pv1 = App.el('div', 'prow');
            pv1.appendChild(App.el('span', 'lab', 'Volume'));
            const mv = App.el('input');
            mv.type = 'range'; mv.min = '0'; mv.max = '100'; mv.step = '1';
            mv.value = String(st.data.music.volume == null ? 70 : num(st.data.music.volume));
            mv.addEventListener('input', function () {
                st.data.music.volume = parseInt(mv.value, 10) || 0;
                if (pv && pv.music) pv.music.volume = st.data.music.volume / 100;
                if (st.musVolEl) st.musVolEl.value = mv.value;
                scheduleSave();
            });
            mv.addEventListener('change', function () { renderTimeline(); });
            pv1.appendChild(mv);
            p.appendChild(pv1);

            const ch = App.el('button', 'tool-btn');
            ch.type = 'button';
            ch.textContent = 'Cambia traccia';
            ch.addEventListener('click', async function () {
                const src = await pickMedia('audio');
                if (!src) return;
                st.data.music.src = src;
                updateMusicLabel();
                applyProps();
            });
            p.appendChild(ch);

            const rm = App.el('button', 'tool-btn');
            rm.type = 'button';
            rm.textContent = 'Rimuovi musica';
            rm.style.borderColor = 'var(--red)';
            rm.style.color = 'var(--red)';
            rm.addEventListener('click', function () {
                st.data.music.src = '';
                updateMusicLabel();
                applyProps();
            });
            p.appendChild(rm);
            updateToolState();
            return;
        }

        const c = st.sel ? clipById(st.sel) : null;
        if (!c) { p.style.display = 'none'; updateToolState(); return; }
        function prow(label) {
            const d = App.el('div', 'prow');
            d.appendChild(App.el('span', 'lab', label));
            return d;
        }

        p.appendChild(App.el('span', 'lab', typeLabel(c.type) + (c.type === 'text' ? '' : '')));

        // Inizio
        const rowS = prow('Inizio (s)');
        const si = App.el('input');
        si.type = 'number'; si.min = '0'; si.step = '0.05'; si.value = c.start;
        si.addEventListener('change', function () {
            const nv = r2(Math.max(0, r05(num(si.value))));
            if (!laneFree(trackKeyOf(c), c.lane || 0, nv, num(c.dur), c.id)) {
                setStatus('Nella stessa corsia le clip non possono sovrapporsi.');
                si.value = c.start;
                return;
            }
            c.start = nv;
            si.value = c.start;
            applyProps();
        });
        rowS.appendChild(si);
        p.appendChild(rowS);

        // Durata
        const rowD = prow('Durata (s)');
        const di = App.el('input');
        di.type = 'number'; di.min = '0.5'; di.step = '0.05'; di.value = c.dur;
        di.addEventListener('change', function () {
            const nv = r2(Math.max(0.5, r05(num(di.value))));
            if (!laneFree(trackKeyOf(c), c.lane || 0, num(c.start), nv, c.id)) {
                setStatus('Nella stessa corsia le clip non possono sovrapporsi.');
                di.value = c.dur;
                return;
            }
            c.dur = nv;
            di.value = c.dur;
            applyProps();
        });
        rowD.appendChild(di);
        p.appendChild(rowD);

        // Corsia della clip (BLOCCO 2)
        const rowL = prow(trackKeyOf(c) === 'music' ? 'Corsia musica' : 'Corsia');
        const selLane = App.el('select');
        for (let li2 = 0; li2 < laneCount(trackKeyOf(c)); li2++) {
            const oL = App.el('option');
            oL.value = String(li2);
            oL.textContent = 'Corsia ' + (li2 + 1) + (li2 === 0 ? ' \u00b7 base' : '');
            selLane.appendChild(oL);
        }
        selLane.value = String(c.lane || 0);
        selLane.addEventListener('change', function () {
            const g = trackKeyOf(c);
            const nl = parseInt(selLane.value, 10) || 0;
            if (nl === (c.lane || 0)) return;
            if (!laneFree(g, nl, num(c.start), num(c.dur), c.id)) {
                setStatus('La corsia ' + (nl + 1) + ' \u00e8 gi\u00e0 occupata in quello intervallo.');
                selLane.value = String(c.lane || 0);
                return;
            }
            c.lane = nl;
            applyProps();
        });
        rowL.appendChild(selLane);
        p.appendChild(rowL);

        // Volume (audio/video)
        if (c.type === 'audio' || c.type === 'video' || c.type === 'music') {
            const rowV = prow('Volume');
            const vr = App.el('input');
            vr.type = 'range'; vr.min = '0'; vr.max = '100'; vr.step = '1';
            vr.value = String(c.volume == null ? 100 : num(c.volume));
            const vl = App.el('span', 'vallab', vr.value + '%');
            vr.addEventListener('input', function () {
                c.volume = parseInt(vr.value, 10) || 0;
                vl.textContent = c.volume + '%';
                scheduleSave();
            });
            vr.addEventListener('change', function () { applyProps(); });
            rowV.appendChild(vr);
            rowV.appendChild(vl);
            p.appendChild(rowV);
        }

        // Opacità (image/testo)
        if (c.type === 'image' || c.type === 'text') {
            const rowO = prow('Opacità');
            const or_ = App.el('input');
            or_.type = 'range'; or_.min = '0'; or_.max = '100'; or_.step = '1';
            or_.value = String(c.opacity == null ? 100 : num(c.opacity));
            const ol = App.el('span', 'vallab', or_.value + '%');
            or_.addEventListener('input', function () {
                c.opacity = parseInt(or_.value, 10);
                ol.textContent = c.opacity + '%';
                scheduleSave();
            });
            or_.addEventListener('change', function () { applyProps(); });
            rowO.appendChild(or_);
            rowO.appendChild(ol);
            p.appendChild(rowO);
        }

        // Scala (image/testo/video)
        if (c.type === 'image' || c.type === 'text' || c.type === 'video') {
            const rowSc = prow('Scala (%)');
            const sci = App.el('input');
            sci.type = 'number'; sci.min = '10'; sci.max = '400'; sci.step = '5';
            sci.value = String(c.scale == null ? 100 : num(c.scale));
            sci.addEventListener('change', function () {
                c.scale = clamp(Math.round(num(sci.value) || 100), 10, 400);
                sci.value = c.scale;
                applyProps();
            });
            rowSc.appendChild(sci);
            p.appendChild(rowSc);
        }

        // Posizione X/Y (image/testo/video) — 2.4 composizione in preview
        if (c.type === 'image' || c.type === 'text' || c.type === 'video') {
            const rowXY = App.el('div', 'pinline');
            const g1 = App.el('div', 'prow');
            g1.style.flex = '1';
            g1.appendChild(App.el('span', 'lab', 'Pos X (%)'));
            const xi = App.el('input');
            xi.type = 'number'; xi.min = '-300'; xi.max = '300'; xi.step = '5';
            xi.value = String(snum(c.x, 0));
            xi.addEventListener('change', function () {
                c.x = clamp(Math.round(snum(xi.value, 0)), -300, 300);
                xi.value = c.x;
                applyProps();
            });
            g1.appendChild(xi);
            const g2 = App.el('div', 'prow');
            g2.style.flex = '1';
            g2.appendChild(App.el('span', 'lab', 'Pos Y (%)'));
            const yi = App.el('input');
            yi.type = 'number'; yi.min = '-300'; yi.max = '300'; yi.step = '5';
            yi.value = String(snum(c.y, 0));
            yi.addEventListener('change', function () {
                c.y = clamp(Math.round(snum(yi.value, 0)), -300, 300);
                yi.value = c.y;
                applyProps();
            });
            g2.appendChild(yi);
            rowXY.appendChild(g1);
            rowXY.appendChild(g2);
            p.appendChild(rowXY);
        }

        // Transizioni in / out
        function trSel(label, val, onCh) {
            const row = prow(label);
            const sel = App.el('select');
            [['none', 'Nessuna'], ['fade', 'Fade'], ['slide', 'Slide']].forEach(function (o) {
                const opt = App.el('option');
                opt.value = o[0];
                opt.textContent = o[1];
                if (val === o[0]) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', function () { onCh(sel.value); });
            row.appendChild(sel);
            p.appendChild(row);
        }
        trSel('Transizione in', trIn(c), function (v) {
            c.transitionIn = v;
            c.transition = v === 'none' ? 'cut' : v;   // compat campo legacy
            applyProps();
        });
        trSel('Transizione out', trOut(c), function (v) {
            c.transitionOut = v;
            applyProps();
        });

        if (c.type === 'text') {
            const rowT = prow('Testo');
            const ta = App.el('textarea');
            ta.value = c.text || '';
            ta.addEventListener('input', function () { c.text = ta.value; scheduleSave(); });
            ta.addEventListener('change', function () { applyProps(); });
            rowT.appendChild(ta);
            p.appendChild(rowT);

            const rowF = App.el('div', 'pinline');
            const g1 = App.el('div', 'prow'); g1.style.flex = '1';
            g1.appendChild(App.el('span', 'lab', 'Dim.'));
            const fs = App.el('input');
            fs.type = 'number'; fs.min = '10'; fs.max = '160'; fs.value = c.fontSize || 40;
            fs.addEventListener('change', function () {
                c.fontSize = Math.max(10, Math.min(160, parseInt(fs.value, 10) || 40));
                fs.value = c.fontSize;
                applyProps();
            });
            g1.appendChild(fs);
            const g2 = App.el('div', 'prow'); g2.style.flex = '1';
            g2.appendChild(App.el('span', 'lab', 'Colore'));
            const col = App.el('input');
            col.type = 'color';
            col.value = c.color || '#ffffff';
            col.addEventListener('input', function () { c.color = col.value; scheduleSave(); });
            col.addEventListener('change', function () { applyProps(); });
            g2.appendChild(col);
            rowF.appendChild(g1); rowF.appendChild(g2);
            p.appendChild(rowF);
        } else {
            const rowF = prow('File');
            const nm = App.el('span', null, App.esc(fileName(c.src) || '—'));
            nm.style.cssText = 'font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            rowF.appendChild(nm);
            p.appendChild(rowF);

            const ch = App.el('button', 'tool-btn');
            ch.type = 'button';
            ch.textContent = 'Cambia file';
            ch.addEventListener('click', async function () {
                const src = await pickMedia(c.type);
                if (!src) return;
                c.src = src;
                applyProps();
            });
            p.appendChild(ch);
        }

        const del = App.el('button', 'tool-btn');
        del.type = 'button';
        del.textContent = 'Elimina clip';
        del.style.borderColor = 'var(--red)';
        del.style.color = 'var(--red)';
        del.addEventListener('click', delClip);
        p.appendChild(del);

        updateToolState();
    }

    function updateDur() {
        if (!st || !st.durEl) return;
        const t = totalDur();
        if (t > MAX_SECONDS) {
            st.durEl.className = 'vv-warn';
            st.durEl.textContent = '⚠ Durata totale ' + fmtT(t) + ' — supera i 7 minuti consigliati per lo storytelling.';
        } else {
            st.durEl.className = 'vv-ok';
            st.durEl.textContent = 'Durata totale: ' + fmtT(t) + ' (max consigliato 07:00.0)';
        }
        if (st.rangeEl) st.rangeEl.max = String(Math.max(t, 0.1));
        if (st.playhead > t) { st.playhead = t; updatePlayhead(); updateTime(); }
        if (st.exportBtn) {
            const has = st.data.clips.length > 0 || !!st.data.music.src;
            st.exportBtn.disabled = !has || st.exporting;
            st.exportBtn.title = has ? 'Esporta il progetto in un file video (.webm)' : 'Progetto vuoto: aggiungi almeno una clip';
        }
    }

    // ---------- preview (4.6 transizioni + 4.7 sync sul playhead) ----------
    function clearStage() {
        if (!st || !st.stageEl) return;
        if (pv) {
            Object.keys(pv.pending || {}).forEach(function (id) {
                clearTimeout(pv.pending[id].timer);
            });
            pv.pending = {};
            pv.mounted = {};
        }
        st.stageEl.innerHTML = '';
    }

    function clipNode(c, anim) {
        const n = App.el('div', 'vv-clip');
        if (anim === 'fade') n.classList.add('vv-jin-fade');
        else if (anim === 'slide') n.classList.add('vv-jin-slide');
        const box = App.el('div', 'vv-box');
        box.style.opacity = String(clamp((c.opacity == null ? 100 : snum(c.opacity, 100)) / 100, 0, 1));
        const sc = clamp((c.scale == null ? 100 : snum(c.scale, 100)) / 100, 0.1, 4);
        const tx = snum(c.x, 0), ty = snum(c.y, 0);
        box.style.transform = 'translate(' + tx + '%,' + ty + '%) scale(' + sc + ')';
        if (c.type === 'text') {
            const d = App.el('div', 'vv-text', App.esc(c.text || ''));
            d.style.fontSize = (c.fontSize || 40) + 'px';
            d.style.color = c.color || '#ffffff';
            d.style.fontWeight = '700';
            box.appendChild(d);
        } else if (c.type === 'image') {
            const img = document.createElement('img');
            img.src = mediaUrl(c.src);
            box.appendChild(img);
        } else if (c.type === 'video') {
            const v = document.createElement('video');
            v.src = mediaUrl(c.src);
            v.preload = 'auto';
            v.playsInline = true;
            v.volume = clamp((c.volume == null ? 100 : num(c.volume)) / 100, 0, 1);
            box.appendChild(v);
        } else if (c.type === 'audio' || c.type === 'music') {
            const a = document.createElement('audio');
            a.src = mediaUrl(c.src);
            a.preload = 'auto';
            a.volume = clamp((c.volume == null ? 100 : num(c.volume)) / 100, 0, 1);
            box.appendChild(a);
        }
        n.appendChild(box);
        return n;
    }

    // ordine di sovrapposizione in preview: corsia piu' alta = sopra, testo in cima
    function zIndexOf(c) {
        const g = trackKeyOf(c);
        const lane = c.lane || 0;
        if (g === 'text') return 600 + lane;
        if (g === 'media') return 100 + lane;
        return 50;   // audio/music (non visivi)
    }

    function activeAt(t) {
        const a = {};
        st.data.clips.forEach(function (c) {
            const s = num(c.start), d = Math.max(0.5, num(c.dur));
            if (t >= s && t < s + d) a[c.id] = c;
        });
        return a;
    }
    function predOf(c) {
        let best = null, bestErr = 0.06;
        st.data.clips.forEach(function (x) {
            if (x.id === c.id) return;
            const err = Math.abs((num(x.start) + num(x.dur)) - num(c.start));
            if (err <= bestErr) { bestErr = err; best = x; }
        });
        return best;
    }

    function syncStage() {
        if (!st || !pv || !st.stageEl) return;
        const ph = st.playhead;
        const active = activeAt(ph);

        // clip in attesa di uscita tornate attive → riattiva
        Object.keys(pv.pending).forEach(function (id) {
            if (active[id]) {
                const p = pv.pending[id];
                clearTimeout(p.timer);
                p.node.classList.remove('vv-jout-fade', 'vv-jout-slide');
                p.node.style.zIndex = String(zIndexOf(active[id]));
                delete pv.pending[id];
                if (!pv.mounted[id]) pv.mounted[id] = p.node;
            }
        });

        const entering = [];
        Object.keys(active).forEach(function (id) { if (!pv.mounted[id]) entering.push(id); });

        // uscenti: al giunto con transizione → animazione di uscita (200ms)
        Object.keys(pv.mounted).forEach(function (id) {
            if (active[id]) return;
            const node = pv.mounted[id];
            delete pv.mounted[id];
            const c = clipById(id);
            let handled = false;
            entering.forEach(function (eid) {
                if (handled || !c) return;
                const e = active[eid];
                if (!e) return;
                if (Math.abs((num(c.start) + num(c.dur)) - num(e.start)) > 0.05) return;
                const eff = effTrans(c, e);
                if (eff !== 'fade' && eff !== 'slide') return;
                handled = true;
                node.classList.add(eff === 'fade' ? 'vv-jout-fade' : 'vv-jout-slide');
                node.style.zIndex = String(zIndexOf(c) + 400);
                const timer = setTimeout(function () {
                    node.remove();
                    if (pv.pending[id] && pv.pending[id].node === node) delete pv.pending[id];
                }, 210);
                pv.pending[id] = { node: node, timer: timer };
            });
            if (!handled) {
                const m = node.querySelector('video,audio');
                if (m) { try { m.pause(); } catch (e) { /* ok */ } }
                node.remove();
            }
        });

        // entranti: animazione di transizione solo al giunto (entro 0.2s dall'inizio)
        entering.forEach(function (id) {
            const c = active[id];
            let anim = '';
            const off = ph - num(c.start);
            if (off < 0.2) {
                const pred = predOf(c);
                if (pred) {
                    const eff = effTrans(pred, c);
                    if (eff === 'fade' || eff === 'slide') anim = eff;
                }
            }
            const node = clipNode(c, anim);
            node.style.zIndex = String(zIndexOf(c) + (anim ? 800 : 0));
            st.stageEl.appendChild(node);
            pv.mounted[id] = node;
        });

        syncMedia();
    }

    function eachMountedMedia(cb) {
        if (!pv) return;
        Object.keys(pv.mounted).forEach(function (id) {
            const m = pv.mounted[id].querySelector('video,audio');
            if (m) { try { cb(m); } catch (e) { /* ok */ } }
        });
    }

    // sincronizza i media montati con il playhead (currentTime + play/pausa)
    function syncMedia() {
        if (!st || !pv) return;
        const ph = st.playhead;
        Object.keys(pv.mounted).forEach(function (id) {
            const c = clipById(id);
            if (!c) return;
            const m = pv.mounted[id].querySelector('video,audio');
            if (!m) return;
            const off = ph - num(c.start);
            const inRange = off >= -0.02 && off <= num(c.dur) + 0.3;
            if (inRange) {
                try {
                    if (isFinite(m.duration) && m.duration > 0 && Math.abs((m.currentTime || 0) - Math.max(0, off)) > 0.35) {
                        m.currentTime = Math.max(0, off);
                    }
                } catch (e) { /* ok */ }
                if (pv.playing) { if (m.paused) m.play().catch(function () { /* autoplay */ }); }
                else if (!m.paused) { try { m.pause(); } catch (e) { /* ok */ } }
            } else if (!m.paused) {
                try { m.pause(); } catch (e) { /* ok */ }
            }
        });
        // musica
        const mu = ensureMusic();
        if (mu) {
            if (pv.playing) { if (mu.paused) mu.play().catch(function () { /* autoplay */ }); }
            else if (!mu.paused) { try { mu.pause(); } catch (e) { /* ok */ } }
        }
    }

    function updateTime() {
        if (!st || !pv || !st.timeEl) return;
        st.timeEl.textContent = fmtT(st.playhead) + ' / ' + fmtT(totalDur());
        if (st.rangeEl) st.rangeEl.value = String(st.playhead);
    }

    function ensureMusic() {
        if (!st || !st.data.music.src) return null;
        if (!pv.music) {
            pv.music = document.createElement('audio');
            pv.music.src = mediaUrl(st.data.music.src);
            pv.music.loop = true;
        }
        pv.music.volume = clamp((st.data.music.volume == null ? 70 : st.data.music.volume) / 100, 0, 1);
        return pv.music;
    }

    function play() {
        if (!st || !pv) return;
        const total = totalDur();
        if (!total) { setStatus('Nessuna clip da riprodurre.'); return; }
        if (st.playhead >= total) st.playhead = 0;
        pv.playing = true;
        pv.last = 0;
        pv.lastUi = 0;
        const m = ensureMusic();
        if (m) {
            try {
                if (isFinite(m.duration) && m.duration > 0) m.currentTime = st.playhead % m.duration;
                m.play().catch(function () { /* autoplay bloccato */ });
            } catch (e) { /* ok */ }
        }
        syncStage();
        if (pv.raf) cancelAnimationFrame(pv.raf);
        pv.raf = requestAnimationFrame(tick);
    }

    function pause() {
        if (!pv) return;
        pv.playing = false;
        if (pv.raf) { cancelAnimationFrame(pv.raf); pv.raf = 0; }
        pv.last = 0;
        if (pv.music) { try { pv.music.pause(); } catch (e) { /* ok */ } }
        eachMountedMedia(function (x) { try { x.pause(); } catch (e) { /* ok */ } });
    }

    function stopAllPlayback() {
        if (!pv) return;
        pv.playing = false;
        if (pv.raf) { cancelAnimationFrame(pv.raf); pv.raf = 0; }
        pv.last = 0;
        if (st) st.playhead = 0;
        if (pv.music) { try { pv.music.pause(); pv.music.currentTime = 0; } catch (e) { /* ok */ } }
        clearStage();
        if (st) {
            updatePlayhead();
            if (st.timeEl) updateTime();
        }
    }

    function tick(ts) {
        if (!pv || !pv.playing || !st) return;
        if (!pv.last) pv.last = ts;
        const dt = Math.min(0.5, (ts - pv.last) / 1000);
        pv.last = ts;
        st.playhead += dt;
        const total = totalDur();
        if (st.playhead >= total) {
            st.playhead = total;
            pause();
            syncStage();
            updatePlayhead();
            updateTime();
            clearStage();
            st.playhead = 0;
            updatePlayhead();
            updateTime();
            return;
        }
        syncStage();
        updatePlayhead();
        ensureVisible();
        // scrubber + tempo aggiornati ogni 250ms durante la riproduzione
        if (!pv.lastUi || ts - pv.lastUi >= 250) {
            pv.lastUi = ts;
            updateTime();
        }
        pv.raf = requestAnimationFrame(tick);
    }

    // ============================================================
    // 4.8 — EXPORT VIDEO REALE (canvas offscreen + MediaRecorder)
    // ============================================================
    function ffmpegAvailable() {
        try {
            if (typeof window.fFMpeg !== 'undefined' && window.fFMpeg) return true;
            if (window.pywebview && window.pywebview.api &&
                typeof window.pywebview.api.study_export_ffmpeg === 'function') return true;
        } catch (e) { /* ok */ }
        return false;
    }
    function mrSupported() {
        try {
            return typeof MediaRecorder !== 'undefined' &&
                typeof HTMLCanvasElement !== 'undefined' &&
                typeof HTMLCanvasElement.prototype.captureStream === 'function';
        } catch (e) { return false; }
    }
    function pickMime(hasAudio) {
        const base = hasAudio
            ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
            : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        for (let i = 0; i < base.length; i++) {
            try { if (MediaRecorder.isTypeSupported(base[i])) return base[i]; } catch (e) { /* ok */ }
        }
        return '';
    }

    function openExportDialog() {
        if (!st || document.getElementById('vvExportOv')) return;
        const ov = App.el('div', 'vv-modal');
        ov.id = 'vvExportOv';
        const dlg = App.el('div', 'vv-mdlg');
        dlg.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        ov.addEventListener('pointerdown', function (e) {
            if (e.target === ov && !st.exporting) ov.remove();
        });

        dlg.appendChild(App.el('h3', null, 'Esporta video'));

        function frow(label) {
            const r = App.el('div', 'vv-frow');
            r.appendChild(App.el('label', null, label));
            return r;
        }
        function opt(v, t, disabled) {
            const o = App.el('option');
            o.value = v; o.textContent = t;
            if (disabled) o.disabled = true;
            return o;
        }

        const rowF = frow('Formato');
        const fmt = document.createElement('select');
        fmt.appendChild(opt('webm', '.webm — VP9/VP8 + Opus'));
        const hasFf = ffmpegAvailable();
        fmt.appendChild(opt('mp4', '.mp4 — H.264', !hasFf));
        if (!hasFf) fmt.value = 'webm';
        rowF.appendChild(fmt);
        dlg.appendChild(rowF);
        if (!hasFf) dlg.appendChild(App.el('div', 'vv-note', 'ffmpeg non rilevato (solo .webm)'));

        const rowR = frow('Risoluzione');
        const res = document.createElement('select');
        res.appendChild(opt('720', '720p — 1280×720'));
        res.appendChild(opt('1080', '1080p — 1920×1080'));
        rowR.appendChild(res);
        dlg.appendChild(rowR);

        const rowFps = frow('FPS');
        const fps = document.createElement('select');
        fps.appendChild(opt('24', '24 fps'));
        fps.appendChild(opt('30', '30 fps'));
        fps.value = '30';
        rowFps.appendChild(fps);
        dlg.appendChild(rowFps);

        const err = App.el('div', 'vv-err');
        err.style.display = 'none';
        dlg.appendChild(err);

        const prowWrap = App.el('div', 'vv-prow');
        const bar = App.el('div', 'vv-pbar');
        const fill = App.el('i');
        bar.appendChild(fill);
        prowWrap.appendChild(bar);
        const pct = App.el('span', 'vv-pct', '');
        prowWrap.appendChild(pct);
        dlg.appendChild(prowWrap);

        const stat = App.el('div', 'vv-stat', 'Pronto. L\'esportazione registra in tempo reale.');
        dlg.appendChild(stat);

        const btns = App.el('div', 'vv-mbtns');
        const bExp = App.el('button', 'tool-btn');
        bExp.type = 'button';
        bExp.textContent = 'Esporta';
        const bCan = App.el('button', 'tool-btn');
        bCan.type = 'button';
        bCan.textContent = 'Annulla';
        btns.appendChild(bExp);
        btns.appendChild(bCan);
        dlg.appendChild(btns);

        bExp.disabled = !(st.data.clips.length || st.data.music.src);
        if (bExp.disabled) stat.textContent = 'Progetto vuoto: aggiungi almeno una clip.';

        bCan.addEventListener('click', function () {
            if (st.exporting) {
                st.exportCancel = true;
                stat.textContent = 'Annullamento…';
            } else {
                ov.remove();
            }
        });

        bExp.addEventListener('click', function () {
            err.style.display = 'none';
            startExport({
                fmt: fmt.value,
                w: res.value === '1080' ? 1920 : 1280,
                h: res.value === '1080' ? 1080 : 720,
                fps: parseInt(fps.value, 10) || 30,
                stat: stat, fill: fill, pct: pct, err: err,
                bExp: bExp, bCan: bCan, ov: ov
            });
        });

        ov.appendChild(dlg);
        document.body.appendChild(ov);
    }

    function showExportError(ui, msg) {
        if (ui.err) { ui.err.textContent = msg; ui.err.style.display = 'block'; }
        if (ui.stat) ui.stat.textContent = 'Errore.';
        if (ui.bExp) ui.bExp.disabled = false;
        st.exporting = false;
    }

    function buildExportMedia(actx, dest) {
        const host = App.el('div', 'vv-hidden-host');
        document.body.appendChild(host);
        const items = [];
        let audioCaptured = false;

        function attach(el, vol) {
            el.volume = clamp(vol, 0, 1);
            host.appendChild(el);
            if (actx && dest) {
                try {
                    const src = actx.createMediaElementSource(el);
                    const g = actx.createGain();
                    g.gain.value = 1;
                    src.connect(g);
                    g.connect(dest);
                    g.connect(actx.destination);
                    audioCaptured = true;
                } catch (e) {
                    // CORS/file locale: degrada (audio non registrato)
                    el.muted = true;
                }
            } else {
                el.muted = true;   // nessun AudioContext → solo video visivo
            }
        }

        st.data.clips.forEach(function (c) {
            if ((c.type !== 'video' && c.type !== 'audio' && c.type !== 'music') || !c.src) return;
            const el = document.createElement(c.type === 'video' ? 'video' : 'audio');
            el.src = mediaUrl(c.src);
            el.preload = 'auto';
            el.playsInline = true;
            attach(el, (c.volume == null ? 100 : num(c.volume)) / 100);
            items.push({ el: el, c: c });
        });
        if (st.data.music.src) {
            const m = document.createElement('audio');
            m.src = mediaUrl(st.data.music.src);
            m.loop = true;
            m.preload = 'auto';
            attach(m, (st.data.music.volume == null ? 70 : num(st.data.music.volume)) / 100);
            items.push({ el: m, music: true });
        }
        return { host: host, items: items, audioCaptured: audioCaptured };
    }

    function stopExportMedia(media) {
        if (!media) return;
        media.items.forEach(function (it) { try { it.el.pause(); } catch (e) { /* ok */ } });
        try { if (media.host && media.host.parentNode) media.host.parentNode.removeChild(media.host); } catch (e) { /* ok */ }
    }

    function syncExportMedia(media, t) {
        media.items.forEach(function (it) {
            const el = it.el;
            if (it.music) {
                if (t > 0.05) { if (el.paused) el.play().catch(function () { /* ok */ }); }
                else if (!el.paused) { try { el.pause(); } catch (e) { /* ok */ } }
                return;
            }
            const c = it.c;
            const off = t - num(c.start);
            const active = off >= 0 && off < num(c.dur);
            if (active) {
                try {
                    if (Math.abs((el.currentTime || 0) - Math.max(0, off)) > (el.paused ? 0.2 : 0.4)) {
                        el.currentTime = Math.max(0, off);
                    }
                } catch (e) { /* ok */ }
                if (el.paused) el.play().catch(function () { /* ok */ });
            } else if (!el.paused) {
                try { el.pause(); } catch (e) { /* ok */ }
            }
        });
    }

    function fitBox(w, h, W, H) {
        const s = Math.min(W / w, H / h);
        return { w: w * s, h: h * s };
    }
    function wrapLines(ctx, text, maxW) {
        const out = [];
        String(text == null ? '' : text).split('\n').forEach(function (para) {
            const words = para.split(/\s+/).filter(Boolean);
            if (!words.length) { out.push(''); return; }
            let cur = words[0];
            for (let i = 1; i < words.length; i++) {
                const test = cur + ' ' + words[i];
                if (ctx.measureText(test).width <= maxW) cur = test;
                else { out.push(cur); cur = words[i]; }
            }
            out.push(cur);
        });
        return out;
    }

    function drawClip(ctx, W, H, c, alpha, xoff, media, imgs) {
        const op = (c.opacity == null ? 100 : snum(c.opacity, 100)) / 100;
        const a = clamp(alpha * op, 0, 1);
        if (a <= 0.002) return;
        const sc = clamp((c.scale == null ? 100 : snum(c.scale, 100)) / 100, 0.1, 4);
        const px = snum(c.x, 0) / 100 * W;
        const py = snum(c.y, 0) / 100 * H;
        ctx.save();
        ctx.globalAlpha = a;
        // offset in coordinate schermo, poi scala attorno al centro
        ctx.translate(xoff + px, py);
        ctx.translate(W / 2, H / 2);
        ctx.scale(sc, sc);
        ctx.translate(-W / 2, -H / 2);
        if (c.type === 'text') {
            const ref = (st.stageEl && st.stageEl.clientHeight) ? st.stageEl.clientHeight : 405;
            const fs = Math.max(6, (c.fontSize || 40) * (H / ref));
            ctx.font = '700 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.fillStyle = c.color || '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const lines = wrapLines(ctx, c.text || '', W * 0.9);
            const lh = fs * 1.35;
            const y0 = H / 2 - (lines.length - 1) * lh / 2;
            for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, y0 + i * lh);
        } else if (c.type === 'image') {
            const img = imgs[c.id];
            if (img && img.complete && img.naturalWidth) {
                const r = fitBox(img.naturalWidth, img.naturalHeight, W, H);
                ctx.drawImage(img, (W - r.w) / 2, (H - r.h) / 2, r.w, r.h);
            }
        } else if (c.type === 'video') {
            let el = null;
            for (let i = 0; i < media.items.length; i++) {
                if (media.items[i].c && media.items[i].c.id === c.id) { el = media.items[i].el; break; }
            }
            if (el && el.readyState >= 2 && el.videoWidth) {
                const r = fitBox(el.videoWidth, el.videoHeight, W, H);
                try { ctx.drawImage(el, (W - r.w) / 2, (H - r.h) / 2, r.w, r.h); } catch (e) { /* ok */ }
            }
        }
        ctx.restore();
    }

    function drawFrame(ctx, W, H, t, media, imgs) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);

        const visuals = st.data.clips.filter(function (c) {
            return c.type === 'text' || c.type === 'image' || c.type === 'video';
        });

        // uscite al giunto (crossfade/slide-out 200ms)
        visuals.forEach(function (c) {
            const end = num(c.start) + num(c.dur);
            if (t < end || t - end >= 0.2) return;
            let succ = null, bestErr = 0.05;
            visuals.forEach(function (x) {
                if (x.id === c.id) return;
                const err = Math.abs(num(x.start) - end);
                if (err <= bestErr) { bestErr = err; succ = x; }
            });
            if (!succ) return;
            const eff = effTrans(c, succ);
            if (eff !== 'fade' && eff !== 'slide') return;
            const p = (t - end) / 0.2;
            drawClip(ctx, W, H, c, 1 - p, eff === 'slide' ? -(p * W * 0.25) : 0, media, imgs);
        });

        // attive in ordine di sovrapposizione: corsie piu' alte sopra, testo in cima (BLOCCO 2)
        visuals.slice().sort(function (a, b) { return zIndexOf(a) - zIndexOf(b); }).forEach(function (c) {
                const s = num(c.start), d = Math.max(0.5, num(c.dur));
                if (t < s || t >= s + d) return;
                let a = 1, off = 0;
                const inw = t - s;
                if (inw < 0.2) {
                    const pred = predOf(c);
                    if (pred) {
                        const eff = effTrans(pred, c);
                        if (eff === 'fade' || eff === 'slide') {
                            const p = inw / 0.2;
                            a = p;
                            if (eff === 'slide') off = (1 - p) * W * 0.25;
                        }
                    }
                }
                drawClip(ctx, W, H, c, a, off, media, imgs);
        });
    }

    function startExport(ui) {    }

    function startExport(ui) {
        if (st.exporting) return;
        if (!mrSupported()) {
            showExportError(ui, 'WebGL/MediaRecorder non supportato in questa WebView.');
            return;
        }
        const total = totalDur();
        if (!total) { showExportError(ui, 'Progetto vuoto: nessuna clip da esportare.'); return; }

        const W = ui.w, H = ui.h, FPS = ui.fps;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (!ctx) { showExportError(ui, 'Canvas 2D non disponibile in questa WebView.'); return; }
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        let stream = null;
        try { stream = canvas.captureStream(FPS); } catch (e) {
            showExportError(ui, 'captureStream non supportato: ' + (e && e.message ? e.message : e));
            return;
        }

        // pre-carica le immagini
        const imgs = {};
        st.data.clips.forEach(function (c) {
            if (c.type !== 'image' || !c.src) return;
            const im = new Image();
            im.src = mediaUrl(c.src);
            imgs[c.id] = im;
        });

        // audio condiviso (AudioContext + MediaElementSource), in degrado se fallisce
        let actx = null, dest = null, media = null;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                actx = new AC();
                dest = actx.createMediaStreamDestination();
                if (actx.state === 'suspended' && actx.resume) actx.resume().catch(function () { /* ok */ });
            }
        } catch (e) { actx = null; dest = null; }
        try {
            media = buildExportMedia(actx, dest);
        } catch (e) {
            media = null;
        }
        if (!media) {
            stopExportMedia(media);
            media = { host: null, items: [], audioCaptured: false };
        }

        let full = stream;
        if (media.audioCaptured && dest && dest.stream.getAudioTracks().length) {
            try {
                full = new MediaStream(stream.getVideoTracks().concat(dest.stream.getAudioTracks()));
            } catch (e) { full = stream; }
        }

        let rec = null;
        const mime = pickMime(!!(media.audioCaptured && dest));
        try {
            rec = mime
                ? new MediaRecorder(full, { mimeType: mime, videoBitsPerSecond: Math.round(W * H * 4) })
                : new MediaRecorder(full);
        } catch (e1) {
            try { rec = new MediaRecorder(full); } catch (e2) {
                stopExportMedia(media);
                try { if (actx && actx.close) actx.close(); } catch (e3) { /* ok */ }
                showExportError(ui, 'MediaRecorder non avviabile in questa WebView: ' + (e2 && e2.message ? e2.message : e2));
                return;
            }
        }

        // ferma la preview durante la registrazione
        pause();

        st.exporting = true;
        st.exportCancel = false;
        ui.bExp.disabled = true;
        ui.fill.style.width = '0%';
        ui.pct.textContent = '0%';
        ui.stat.textContent = 'Registrazione… 0%';

        const chunks = [];
        let stopped = false;
        function stopRec() {
            if (stopped) return;
            stopped = true;
            try { rec.stop(); } catch (e) { /* ok */ }
        }

        rec.ondataavailable = function (e) {
            if (e.data && e.data.size) chunks.push(e.data);
        };
        rec.onerror = function (e) {
            st.exportCancel = true;
            ui.stat.textContent = 'Errore di registrazione.';
        };
        rec.onstop = function () {
            try { if (st.exportRaf) cancelAnimationFrame(st.exportRaf); } catch (e) { /* ok */ }
            st.exportRaf = 0;
            stopExportMedia(media);
            try { if (actx && actx.close) actx.close(); } catch (e) { /* ok */ }
            st.exporting = false;
            if (ui.bCan) ui.bCan.textContent = 'Chiudi';
            const cancelled = !!st.exportCancel;
            if (cancelled) {
                ui.fill.style.width = '0%';
                ui.pct.textContent = '';
                ui.stat.textContent = 'Annullato';
            } else {
                try {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    if (blob.size > 0) {
                        const name = sanitizeName(st.title) + '.webm';
                        downloadBlob(blob, name);
                        ui.fill.style.width = '100%';
                        ui.pct.textContent = '100%';
                        ui.stat.textContent = 'Completato — ' + name + ' (' + fmtBytes(blob.size) + ')';
                    } else {
                        ui.stat.textContent = 'Nessun dato registrato: riprova.';
                    }
                } catch (e) {
                    ui.stat.textContent = 'Errore finale: ' + (e && e.message ? e.message : e);
                }
            }
            updateDur();
        };

        let t0 = 0, lastUi = 0;
        function frame(now) {
            if (st.exportCancel) { stopRec(); return; }
            const t = Math.min(total, (now - t0) / 1000);
            try {
                syncExportMedia(media, t);
                drawFrame(ctx, W, H, t, media, imgs);
            } catch (e) {
                console.error('Export frame:', e);
            }
            if (now - lastUi >= 150) {
                lastUi = now;
                const p = Math.round((t / total) * 100);
                ui.fill.style.width = p + '%';
                ui.pct.textContent = p + '%';
                ui.stat.textContent = 'Registrazione… ' + p + '%';
            }
            if (t >= total) {
                ui.fill.style.width = '100%';
                ui.pct.textContent = '100%';
                ui.stat.textContent = 'Finalizzazione…';
                stopRec();
                return;
            }
            st.exportRaf = requestAnimationFrame(frame);
        }

        try {
            rec.start();
        } catch (e) {
            stopExportMedia(media);
            try { if (actx && actx.close) actx.close(); } catch (e2) { /* ok */ }
            st.exporting = false;
            showExportError(ui, 'Impossibile avviare la registrazione: ' + (e && e.message ? e.message : e));
            return;
        }
        t0 = performance.now();
        st.exportRaf = requestAnimationFrame(frame);
    }

    // ---------- registrazione modulo ----------
    window.StudyTools = window.StudyTools || {};
    window.StudyTools['video'] = {
        title: 'Video',
        icon: ICON,
        desc: 'Timeline multitaccia clip con transizioni, preview e export .webm.',
        kinds: ['video'],
        render: function (container, params) {
            root = container;
            params = params || {};
            if (params.open) return openEditor(container, params.open);
            return showList(container);
        },
        close: function () {
            stopAllPlayback();
            fpClose();               // R21 B4: pannello Fonti chiuso con l'uscita
            if (st && st.exporting) st.exportCancel = true;
            flush();
        }
    };
})();
