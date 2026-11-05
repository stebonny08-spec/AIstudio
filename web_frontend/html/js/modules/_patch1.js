/* Patch 1/2: CSS + helper/list region di video.js (solo UI) */
const fs = require('fs');
const P = 'C:/Users/stebo/Desktop/progetti app/StudioIA_7/web_frontend/html/js/modules/video.js';
let src = fs.readFileSync(P, 'utf8');

function replace(startA, endA, repl, label) {
    const s = src.indexOf(startA);
    if (s < 0) throw new Error('MISS start ' + label);
    if (src.indexOf(startA, s + 1) >= 0) throw new Error('DUP start ' + label);
    const e = src.indexOf(endA, s + startA.length);
    if (e < 0) throw new Error('MISS end ' + label);
    src = src.slice(0, s) + repl + src.slice(e);
}

// ============ 1) CSS ============
const CSS = `    App.style(
        /* ---------- shell schermata: [barra 46][contenuto flex:1][status 26] ---------- */
        '.vv-screen{display:flex;flex-direction:column;gap:8px;height:calc(100vh - 122px);min-height:560px}' +
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
        '.vv-panel.vv-right{width:260px;overflow-y:auto}' +
        '.vv-panel.vv-right::-webkit-scrollbar{width:8px}' +
        '.vv-panel.vv-right::-webkit-scrollbar-thumb{background:#3a4156;border-radius:4px}' +
        '.vv-side.collapsed .vv-panel{display:none}' +
        '.vv-lsect{display:flex;flex-direction:column;gap:6px;min-height:0}' +
        '.vv-sect{font-size:10.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}' +
        '.vv-addgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
        '.vv-addb{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;background:#1d2333;border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:11px;font-weight:700;cursor:pointer;transition:border-color .15s}' +
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
        '.vv-stage{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;flex:0 0 auto;box-shadow:0 6px 18px rgba(0,0,0,.18)}' +
        '.vv-transport{display:flex;gap:8px;align-items:center;flex-wrap:nowrap}' +
        '.vv-cbtn{width:30px;height:30px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;background:#fff;border:1px solid #c9cfda;color:#1a1f2e;border-radius:8px;cursor:pointer;transition:border-color .15s,background-color .15s,color .15s}' +
        '.vv-cbtn:hover{border-color:var(--accent);color:#b4651f}' +
        '.vv-cbtn:disabled{opacity:.45;cursor:not-allowed}' +
        '.vv-cbtn.on{background:var(--accent);border-color:var(--accent);color:#141824}' +
        '.vv-cbtn.on:hover{color:#141824}' +
        '.vv-cbtn svg{width:15px;height:15px;pointer-events:none}' +
        '.vv-time{font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:700;color:#3a4156;white-space:nowrap;min-width:118px;text-align:center}' +
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

        /* ---------- pannello proprieta (contenuto invariato) ---------- */
        '.vv-props .lab{color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}' +
        '.vv-props .prow{display:flex;flex-direction:column;gap:4px}' +
        '.vv-props .pinline{display:flex;gap:8px;align-items:center}' +
        '.vv-props .pinline .lab{flex:0 0 auto}' +
        '.vv-props input[type="number"]{width:100%;background:#0e1320;border:1px solid var(--border);border-radius:7px;color:var(--text);padding:5px 7px;font-size:13px;outline:none;font-family:inherit;box-sizing:border-box}' +
        '.vv-props input[type="range"]{width:100%;accent-color:var(--accent)}' +
        '.vv-props input[type="color"]{width:100%;height:30px;background:#0e1320;border:1px solid var(--border);border-radius:7px;padding:2px;cursor:pointer}' +
        '.vv-props select{width:100%;background:#0e1320;border:1px solid var(--border);border-radius:7px;color:var(--text);padding:5px 7px;font-size:13px;outline:none;font-family:inherit}' +
        '.vv-props textarea{background:#0e1320;border:1px solid var(--border);border-radius:7px;color:var(--text);padding:5px 7px;font-size:13px;outline:none;font-family:inherit;min-height:52px;resize:vertical;width:100%;box-sizing:border-box}' +
        '.vv-props .vallab{font-size:11.5px;color:var(--text);font-weight:700;font-variant-numeric:tabular-nums}' +
        '.vv-note{font-size:12px;color:var(--muted);border:1px dashed var(--border);border-radius:9px;padding:7px 11px}' +

        /* ---------- 4F timeline a tutta larghezza con maniglia altezza ---------- */
        '.vv-tlwrap{height:238px;flex:0 0 auto;background:#161a2a;border:1px solid var(--border);border-radius:10px;padding:0 8px 8px;display:flex;flex-direction:column;gap:6px;overflow:hidden}' +
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
        '.vv-tlbody{display:flex;flex:1;min-height:0;gap:6px}' +
        '.vv-tlabels{flex:0 0 122px;width:122px;display:flex;flex-direction:column}' +
        '.vv-lab-sp{height:23px;flex:0 0 23px}' +
        '.vv-lab{height:36px;margin-bottom:6px;display:flex;align-items:center;gap:6px;background:#12151f;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:11px;font-weight:800;color:#8b95a5;letter-spacing:.3px;white-space:nowrap;overflow:hidden;box-sizing:border-box}' +
        '.vv-lab i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}' +
        '.vv-tscroll{flex:1;min-width:0;background:#161a2a;border:1px solid var(--border);border-radius:8px;overflow-x:auto;overflow-y:hidden;position:relative}' +
        '.vv-tscroll::-webkit-scrollbar{height:9px}' +
        '.vv-tscroll::-webkit-scrollbar-thumb{background:#3a4156;border-radius:4px}' +
        '.vv-tinner{position:relative;height:185px;min-width:100%}' +
        '.vv-truler{position:relative;height:22px;border-bottom:1px solid #2a3145;cursor:pointer;user-select:none;background:#1c2130;touch-action:none}' +
        '.vv-tick{position:absolute;top:0;height:22px;border-left:1px solid #38415a;font-size:9.5px;color:#8b95a5;padding-left:3px;line-height:20px;white-space:nowrap;pointer-events:none}' +
        '.vv-ttracks{position:relative}' +
        '.vv-track{position:relative;height:36px;margin-bottom:6px;background:#12151f;border-radius:6px;border:1px solid rgba(255,255,255,.045)}' +
        '.vv-track:last-child{margin-bottom:0}' +
        '.vv-tclip{position:absolute;top:0;height:36px;border-radius:6px;color:#fff;font-size:12px;padding:3px 8px;cursor:grab;overflow:hidden;border:2px solid transparent;user-select:none;touch-action:none;box-sizing:border-box}' +
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
    );`;
(function () {
    const cs = src.indexOf('    App.style(');
    const ce = src.indexOf('\n    );', cs);
    if (cs < 0 || ce < 0) throw new Error('css anchors');
    src = src.slice(0, cs) + CSS + src.slice(ce + '\n    );'.length);
})();

// ============ 2) helper + vista elenco ============
const LIST = `    // ---------- helper UI (storia, libreria, play button, stato pannelli) ----------
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
    function snapHist() { return JSON.stringify({ clips: st.data.clips, music: st.data.music }); }
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
        st.data = { clips: (d && Array.isArray(d.clips)) ? d.clips : [], music: (d && d.music) ? d.music : { src: '', volume: 70 } };
        st.data.clips.forEach(function (c) { if (!c.id) c.id = uid(); });
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

    // --- apertura/chiusura pannello proprieta ---
    function setPropsOpen(open) {
        if (!st || !st.propsWrap) return;
        st.propsWrap.classList.toggle('collapsed', !open);
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
    async function showList(container) {
        stopAllPlayback();
        await flush();
        releaseKeys();
        st = null;
        root = container;
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
                content: JSON.stringify({ clips: [], music: { src: '', volume: 70 } })
            });
        } catch (e) { console.error(e); }
        if (item && item.id && root) openEditor(root, item.id);
        else if (root) showList(root);
    }

`;
replace('    // ---------- lista ----------', '    // ---------- editor ----------', LIST, 'lista');

fs.writeFileSync(P, src, 'utf8');
console.log('patch1 OK, bytes:', Buffer.byteLength(src, 'utf8'));
