/* ============================================================
   modules/fogli.js — sub-tool Fogli di calcolo
   kind: 'foglio'
   Griglia 26 colonne (A-Z) × 60 righe, campo formula,
   parser di formule proprio (nessun eval): SUM AVERAGE MIN MAX
   COUNT IF CONCAT TEXT, riferimenti A1 e range A1:B5,
   operatori + - * / confronti, parentesi, stringhe.
   Formattazione celle, import/export CSV, autosave.
   ============================================================ */
(function () {
    'use strict';

    const ROWS = 60, COLS = 26;
    const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
    const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

    App.style(
        '.fg-screen{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}' +
        '.fg-top{display:flex;align-items:center;gap:5px;flex:0 0 46px;height:46px;min-width:0;white-space:nowrap;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--border);padding-bottom:2px;scrollbar-width:none}' +
        '.fg-top::-webkit-scrollbar{width:0;height:0;display:none}' +
        '.fg-ib{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;min-width:30px;box-sizing:border-box;padding:0 8px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;flex-shrink:0;transition:border-color .15s,color .15s,background-color .15s}' +
        '.fg-ib:hover{border-color:var(--accent);color:var(--accent)}' +
        '.fg-ib.active{background:var(--accent);color:#141824;border-color:var(--accent)}' +
        '.fg-ib:disabled{opacity:.4;cursor:default}' +
        '.fg-ib:disabled:hover{border-color:var(--border);color:var(--text)}' +
        '.fg-ib svg{width:15px;height:15px;flex-shrink:0}' +
        '.fg-ib.wide{padding:0 11px}' +
        '.fg-sep{width:1px;height:22px;background:var(--border);flex-shrink:0;margin:0 3px}' +
        '.fg-spacer{flex:1 1 auto;min-width:6px}' +
        '.fg-title{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:56px;max-width:250px;padding:0 2px}' +
        '.fg-title .t{font-size:14px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;cursor:default}' +
        '.fg-badge{flex-shrink:0;font-size:10.5px;font-weight:800;color:var(--accent);background:rgba(249,151,74,.13);border:1px solid rgba(249,151,74,.45);border-radius:999px;padding:1px 7px;white-space:nowrap}' +
        '.fg-refbox{flex:0 0 70px;width:70px;height:30px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-size:12px;font-weight:800;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 4px}' +
        '.fg-formula{flex:1 1 170px;min-width:130px;height:30px;box-sizing:border-box;background:var(--dark);border:1px solid var(--border);border-radius:8px;padding:0 10px;color:var(--text);font-size:13px;outline:none;font-family:inherit;transition:border-color .15s}' +
        '.fg-formula:focus{border-color:var(--accent)}' +
        '.fg-fhelp{font-weight:800}' +
        '.fg-formulepop code{background:rgba(249,151,74,.14);color:var(--accent);border-radius:4px;padding:1px 4px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}' +
        '.fg-fn-table{border-collapse:collapse;width:100%;margin:6px 0;font-size:12px;table-layout:auto}' +
        '.fg-fn-table th,.fg-fn-table td{border:1px solid var(--border);padding:4px 6px;text-align:left;color:var(--text);word-break:break-word}' +
        '.fg-fn-table th{background:rgba(255,255,255,.05);font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}' +
        '.fg-color{width:26px;height:26px;padding:2px;box-sizing:border-box;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;cursor:pointer;flex-shrink:0}' +
        '.fg-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;gap:8px;align-items:stretch;padding-top:8px}' +
        '.fg-wrap{position:relative;overflow:auto;flex:1 1 auto;min-height:0;min-width:0;background:#f7f8fa;border:1px solid var(--border);border-radius:8px;scrollbar-width:thin;scrollbar-color:#3a4054 transparent;outline:none}' +
        '.fg-wrap::-webkit-scrollbar{width:8px;height:8px}' +
        '.fg-wrap::-webkit-scrollbar-track{background:transparent}' +
        '.fg-wrap::-webkit-scrollbar-thumb{background:#3a4054;border-radius:4px}' +
        '.fg-wrap::-webkit-scrollbar-thumb:hover{background:#4a5168}' +
        '.fg-wrap::-webkit-scrollbar-corner{background:transparent}' +
        // 1.4: la striscia verticale della griglia (lo scroller reale è .fg-wrap,
        // la <table> è sua figlia diretta e non ha wrapper interni) → thumb scuro
        // sottile e track trasparente, con regole ESPlicITE per l'asse verticale
        '.fg-wrap::-webkit-scrollbar:vertical{width:9px;height:9px;background:transparent}' +
        '.fg-wrap::-webkit-scrollbar-track:vertical{background:transparent}' +
        '.fg-wrap::-webkit-scrollbar-thumb:vertical{background:#3a4054;border-radius:5px}' +
        '.fg-wrap::-webkit-scrollbar-thumb:vertical:hover{background:#4a5168}' +
        '.fg-wrap::-webkit-scrollbar:horizontal{width:9px;height:9px;background:transparent}' +
        '.fg-wrap::-webkit-scrollbar-track:horizontal{background:transparent}' +
        '.fg-wrap::-webkit-scrollbar-thumb:horizontal{background:#3a4054;border-radius:5px}' +
        'table.fg{border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:13px;user-select:none;color:#1a1f2e}' +
        '.fg thead th{position:sticky;top:0;z-index:4;background:#1c2130;color:#aab5c7;font-weight:700;font-size:11.5px;border-right:1px solid #2a3142;border-bottom:1px solid #2a3142;height:26px;width:96px;box-sizing:border-box}' +
        '.fg th.rowh{position:sticky;left:0;z-index:5;background:#1c2130;color:#aab5c7;font-weight:700;font-size:11.5px;border-right:1px solid #2a3142;border-bottom:1px solid #2a3142;width:44px;min-width:44px;box-sizing:border-box}' +
        '.fg thead th.corner{left:0;z-index:6;width:44px;min-width:44px}' +
        '.fg th.hl{background:#2a3142;color:#ffb277}' +
        '.fg th.fz-edge-r{box-shadow:inset -2px 0 0 #f9974a66}' +
        '.fg th.fz-edge-b{box-shadow:inset 0 -2px 0 #f9974a66}' +
        '.fg .fg-rh{position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:2}' +
        '.fg .fg-vrh{position:absolute;left:0;bottom:-3px;height:7px;width:100%;cursor:row-resize;z-index:2}' +
        '.fg td{border-right:1px solid #dfe3ea;border-bottom:1px solid #dfe3ea;height:26px;white-space:nowrap;overflow:hidden;cursor:cell;position:relative;padding:0;vertical-align:middle;background:#f7f8fa;color:#1a1f2e;box-sizing:border-box}' +
        '.fg td .cin{display:block;padding:4px 7px;height:100%;line-height:17px;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}' +
        '.fg td.sel{outline:2px solid #f9974a;outline-offset:-2px;z-index:1}' +
        '.fg-rng{position:absolute;box-sizing:border-box;background:rgba(249,151,74,.14);border:1.5px solid #f9974a;pointer-events:none;z-index:3}' +
        '.fg-fpreview{position:absolute;box-sizing:border-box;border:1.5px dashed #f9974a;pointer-events:none;z-index:3}' +
        '.fg-fill{position:absolute;width:8px;height:8px;box-sizing:border-box;background:#f9974a;border:1px solid #fff;border-radius:2px;cursor:crosshair;z-index:7;pointer-events:auto}' +
        '.fg-editor{position:absolute;z-index:10;box-sizing:border-box;border:2px solid #f9974a;background:#fff;color:#1a1f2e;padding:2px 6px;font-size:13px;outline:none;font-family:inherit}' +
        '.fg-tabs{display:flex;gap:6px;align-items:center;flex:0 0 auto;height:30px;box-sizing:border-box;padding:4px 0 0;overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;scrollbar-width:none;border-top:1px solid var(--border);margin-top:6px}' +
        '.fg-tabs::-webkit-scrollbar{width:0;height:0;display:none}' +
        '.fg-tab{display:flex;align-items:center;gap:6px;height:24px;box-sizing:border-box;background:var(--panel-2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:0 10px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;font-family:inherit;white-space:nowrap}' +
        '.fg-tab:hover{border-color:var(--accent);color:var(--text)}' +
        '.fg-tab.on{background:var(--accent);border-color:var(--accent);color:#141824}' +
        '.fg-tabdot{width:8px;height:8px;border-radius:50%;display:inline-block}' +
        '.fg-tabmore,.fg-tabadd{background:var(--panel-2);border:1px solid var(--border);color:var(--muted);border-radius:8px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;flex-shrink:0;padding:0;font-family:inherit}' +
        '.fg-tabmore:hover,.fg-tabadd:hover{border-color:var(--accent);color:var(--accent)}' +
        '.fg-tabadd svg{width:13px;height:13px}' +
        '.fg-status{display:flex;align-items:center;gap:10px;flex:0 0 26px;height:26px;box-sizing:border-box;border-top:1px solid var(--border);color:var(--muted);font-size:11.5px;padding:0 2px}' +
        '.fg-status .left{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.fg-status .fg-ib{width:20px;min-width:20px;height:20px;padding:0;font-size:11.5px;border-radius:6px}' +
        '.fg-menu{position:absolute;z-index:80;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:8px;min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,.45);scrollbar-width:thin;scrollbar-color:#3a4054 transparent}' +
        '.fg-menu::-webkit-scrollbar{width:8px;height:8px}' +
        '.fg-menu::-webkit-scrollbar-track{background:transparent}' +
        '.fg-menu::-webkit-scrollbar-thumb{background:#3a4054;border-radius:4px}' +
        '.fg-menu.pop{min-width:250px;gap:5px}' +
        '.fg-menu-row{display:flex;gap:6px;flex-wrap:wrap}' +
        '.fg-swatch{width:20px;height:20px;border-radius:6px;border:2px solid transparent;cursor:pointer;padding:0}' +
        '.fg-swatch:hover{border-color:#fff}' +
        '.fg-menu-sep{height:1px;background:var(--border);margin:1px 0}' +
        '.fg-pop-title{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--muted)}' +
        '.fg-pop-item{font-size:12px;color:var(--text);line-height:1.5;white-space:normal;overflow-wrap:break-word}' +
        '.fg-menu button.mi{background:transparent;border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 8px;font-size:12.5px;cursor:pointer;text-align:left;font-family:inherit}' +
        '.fg-menu button.mi:hover{border-color:var(--accent);color:var(--accent)}' +
        '.fg-menu button.mi.danger{color:#e6778c}' +
        '.fg-ac{position:absolute;z-index:90;background:#171c2a;border:1px solid var(--border);border-radius:8px;padding:4px;min-width:250px;max-width:330px;box-shadow:0 10px 26px rgba(0,0,0,.5);font-size:12.5px;color:var(--text)}' +
        '.fg-ac-item{display:flex;justify-content:space-between;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;align-items:baseline}' +
        '.fg-ac-item b{color:#f9974a;font-weight:800}' +
        '.fg-ac-item span{color:var(--muted);font-size:11.5px;text-align:right}' +
        '.fg-ac-item.on,.fg-ac-item:hover{background:#2a3142}' +
        '.fg-list-title{flex:1 1 auto;min-width:0;text-align:center;font-size:15px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 8px}' +
        '.fg-search{flex:0 0 auto;width:150px;height:30px;box-sizing:border-box;background:var(--dark);border:1px solid var(--border);border-radius:8px;padding:0 10px;color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}' +
        '.fg-search:focus{border-color:var(--accent)}' +
        '.fg-sort{flex:0 0 auto;height:30px;box-sizing:border-box;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12.5px;font-family:inherit;padding:0 8px;cursor:pointer;outline:none}' +
        '.fg-list{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px 4px 8px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}' +
        '.fg-list::-webkit-scrollbar{width:8px}' +
        '.fg-list::-webkit-scrollbar-track{background:transparent}' +
        '.fg-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}' +
        '.fg-card{display:flex;flex-direction:column}' +
        '.fg-card .card-actions{opacity:0;pointer-events:none;transition:opacity .15s}' +
        '.fg-card:hover .card-actions,.fg-card:focus-within .card-actions{opacity:1;pointer-events:auto}' +
        '.fg-mini{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,17px);border:1px solid #dfe3ea;border-radius:8px;overflow:hidden;background:#f7f8fa;margin-bottom:10px}' +
        '.fg-mini i{font-style:normal;font-size:10.5px;color:#1a1f2e;padding:1px 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-right:1px solid #dfe3ea;border-bottom:1px solid #dfe3ea;box-sizing:border-box}' +
        '.fg-mini i:nth-child(3n){border-right:none}' +
        '.fg-mini i:nth-child(n+7){border-bottom:none}' +
        '.fg-mini.fg-mini-empty{display:flex;align-items:center;justify-content:center;background:var(--panel-2);border-color:var(--border);height:55px}' +
        '.fg-mini.fg-mini-empty svg{width:24px;height:24px;color:var(--accent);opacity:.75}' +
        // --- F2: pannello destro collassabile "Formato cella" (stile pp-insp) ---
        '.fg-side{width:200px;flex:0 0 200px;min-width:0;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:7px 8px 8px;overflow-y:auto;color:var(--text);font-size:12.5px;scrollbar-width:thin;scrollbar-color:#3a4054 transparent}' +
        '.fg-side::-webkit-scrollbar{width:8px}' +
        '.fg-side::-webkit-scrollbar-track{background:transparent}' +
        '.fg-side::-webkit-scrollbar-thumb{background:#3a4054;border-radius:4px}' +
        '.fg-side-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px}' +
        '.fg-side-title{font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--muted)}' +
        '.fg-side-head .fg-ib{width:22px;min-width:22px;height:22px;padding:0;font-size:13px}' +
        '.fg-side-row{display:flex;align-items:center;gap:6px;min-height:32px}' +
        '.fg-side-row label{flex:0 0 72px;font-size:11px;color:var(--muted)}' +
        '.fg-side-tab{writing-mode:vertical-rl;flex:0 0 auto;align-self:flex-start;padding:10px 6px;background:var(--panel-2);border:1px solid var(--border);color:var(--muted);border-radius:8px;font-family:inherit;font-size:11.5px;font-weight:800;letter-spacing:.5px;cursor:pointer}' +
        '.fg-side-tab:hover{border-color:var(--accent);color:var(--accent)}' +
        // --- F4: popover "?" Formule leggibile: larghezza limitata e wrap ovunque ---
        '.fg-menu.fg-formulepop{width:min(400px,92vw);max-width:400px;max-height:min(70vh,560px);overflow-y:auto;overflow-x:hidden;overflow-wrap:anywhere}' +
        '.fg-formulepop .fg-pop-item code,.fg-formulepop code{white-space:pre-wrap;overflow-wrap:anywhere}'
    );

    let root = null;
    let st = null;          // { id, title, data, sel, editing, keyHandler }
    let saveTimer = null;

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
        return String(t || 'foglio').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    }

    // ---------- coordinate ----------
    function colName(c) {
        let s = '';
        let n = c + 1;
        while (n > 0) {
            const m = (n - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }
    function colFromLetters(name) {
        let n = 0;
        for (let i = 0; i < name.length; i++) n = n * 26 + (name.charCodeAt(i) - 64);
        return n - 1;   // 0-based
    }

    // ---------- modello ----------
    function normalizeSheet(s, i) {
        s = (s && typeof s === 'object') ? s : {};
        return {
            name: String(s.name || ('Foglio' + (i + 1))).slice(0, 24),
            color: (typeof s.color === 'string') ? s.color : '',
            cells: (s.cells && typeof s.cells === 'object') ? s.cells : {},
            colW: (s.colW && typeof s.colW === 'object') ? s.colW : {},
            rowH: (s.rowH && typeof s.rowH === 'object') ? s.rowH : {},
            freeze: (s.freeze && typeof s.freeze === 'object') ? { c: (+s.freeze.c) || 0, r: (+s.freeze.r) || 0 } : { c: 0, r: 0 },
            sel: (typeof s.sel === 'string' && parseRef(s.sel)) ? s.sel : 'A1',
            // R21 B4: metadati fonte del foglio: array {tipo,titolo,fonteId,ts}
            // pushato da fpLogSource; preservato al load cosi' flush() ->         // content.sheets[i].fpSources resta persistente.
            fpSources: Array.isArray(s.fpSources) ? s.fpSources : []
        };
    }
    function parseContent(item) {
        let d = null;
        try { d = JSON.parse(item.content || '{}'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = null;
        let sheets = null, current = 0;
        if (d && Array.isArray(d.sheets) && d.sheets.length) {
            sheets = d.sheets.map(normalizeSheet);
            current = Math.max(0, Math.min(sheets.length - 1, d.current | 0));
        } else {
            // retro-compat: vecchio content {cells,rows,cols} -> un solo foglio
            sheets = [normalizeSheet({ cells: (d && d.cells) || {} }, 0)];
            current = 0;
        }
        return { rows: ROWS, cols: COLS, sheets: sheets, current: current };
    }
    function curSheet() {
        return (st && st.data && st.data.sheets) ? st.data.sheets[st.data.current] : null;
    }
    function bindSheet() {
        const s = curSheet();
        if (!s) return;
        st.data.cells = s.cells;
        st.data.colW = s.colW;
        st.data.rowH = s.rowH;
        st.data.freeze = s.freeze;
    }

    function cellObj(ref, create) {
        let c = st.data.cells[ref];
        if (!c && create) { c = {}; st.data.cells[ref] = c; }
        return c || null;
    }
    function cleanCell(ref) {
        const c = st.data.cells[ref];
        if (c && Object.keys(c).length === 0) delete st.data.cells[ref];
    }
    function rawOf(ref) {
        const c = st.data.cells[ref];
        if (!c) return '';
        if (c.f != null) return c.f;
        return c.v == null ? '' : String(c.v);
    }
    function setCellInput(ref, raw) {
        raw = String(raw == null ? '' : raw);
        const c = cellObj(ref, true);
        if (raw.charAt(0) === '=') { c.f = raw; delete c.v; }
        else if (raw === '') { delete c.f; delete c.v; }
        else { c.v = raw; delete c.f; }
        cleanCell(ref);
    }

    // ---------- salvataggio ----------
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 900);
    }
    async function flush() {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (!st || !st.id) return;
        try {
            await StudyStore.saveItem({
                id: st.id, kind: 'foglio', title: st.title,
                content: JSON.stringify({ rows: ROWS, cols: COLS, v: 2, sheets: st.data.sheets, current: st.data.current })
            });
        } catch (e) { console.error('Salvataggio foglio:', e); }
    }

    function detachKeys() {
        if (st && st.keyHandler) {
            document.removeEventListener('keydown', st.keyHandler, true);
            st.keyHandler = null;
        }
        if (st && st.onWinResize) {
            window.removeEventListener('resize', st.onWinResize);
            st.onWinResize = null;
        }
    }

    // ============================================================
    // PARSER FORMULE (tokens + recursive descent, nessun eval)
    // ============================================================
    function tokenize(src) {
        const out = [];
        let i = 0;
        const s = src;
        while (i < s.length) {
            const ch = s[i];
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
            if (ch === '"') {
                let j = i + 1, buf = '';
                while (j < s.length) {
                    if (s[j] === '"') {
                        if (s[j + 1] === '"') { buf += '"'; j += 2; continue; }
                        break;
                    }
                    buf += s[j]; j++;
                }
                if (j >= s.length) throw new Error('#SYNTAX');
                out.push({ t: 'str', v: buf });
                i = j + 1;
                continue;
            }
            if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
                let j = i;
                while (j < s.length && /[0-9.]/.test(s[j])) j++;
                const num = parseFloat(s.slice(i, j));
                if (isNaN(num)) throw new Error('#SYNTAX');
                out.push({ t: 'num', v: num });
                i = j;
                continue;
            }
            const rest = s.slice(i);
            const refM = rest.match(/^([A-Za-z]{1,3})([0-9]{1,5})(?![A-Za-z0-9_])/);
            if (refM) {
                const col = colFromLetters(refM[1].toUpperCase());
                const row = parseInt(refM[2], 10);
                const inGrid = col >= 0 && col < COLS && row >= 1 && row <= ROWS;
                if (inGrid) {
                    out.push({ t: 'ref', c: col, r: row - 1 });
                    i += refM[0].length;
                    continue;
                }
                // fuori griglia: se e' seguito da '(' e' il nome di una funzione
                // (es. LOG10), altrimenti e' un riferimento inesistente -> #REF!
                if (s[i + refM[0].length] !== '(') throw new Error('#REF!');
            }
            const idM = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
            if (idM) {
                out.push({ t: 'ident', v: idM[0].toUpperCase() });
                i += idM[0].length;
                continue;
            }
            const two = s.substr(i, 2);
            if (two === '>=' || two === '<=' || two === '<>') {
                out.push({ t: 'op', v: two });
                i += 2;
                continue;
            }
            if ('+-*/()<>=,:%^;'.indexOf(ch) >= 0) {
                out.push({ t: 'op', v: ch });
                i++;
                continue;
            }
            throw new Error('#SYNTAX');
        }
        return out;
    }

    function toNum(v) {
        if (typeof v === 'number') return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (v == null) return 0;
        const s = String(v).trim();
        if (s === '') return 0;
        const n = Number(s.replace(',', '.'));  // tollera "3,5"
        return isNaN(n) ? NaN : n;
    }
    function truthy(v) {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0 && !isNaN(v);
        if (v == null) return false;
        const s = String(v).trim().toUpperCase();
        if (s === '' || s === 'FALSE') return false;
        if (s === 'TRUE') return true;
        return true;
    }
    function formatValue(v) {
        if (v == null || v === '') return '';
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        if (typeof v === 'number') {
            if (!isFinite(v)) return '#NUM!';
            if (Number.isInteger(v)) return String(v);
            return String(Math.round(v * 1e10) / 1e10);
        }
        if (v && v.__range) return '#RANGE!';
        return String(v);
    }

    // valutazione con memo + guardia loop (chiusura su st.data.cells)
    function makeEnv() {
        const memo = {};
        const busy = {};

        function refName(c, r) { return colName(c) + (r + 1); }

        function valueOf(c, r) {
            const name = refName(c, r);
            if (Object.prototype.hasOwnProperty.call(memo, name)) {
                const m = memo[name];
                if (m instanceof Error) throw m;
                return m;
            }
            if (busy[name]) throw new Error('#CIRC!');
            const cell = st.data.cells[name];
            if (!cell) { memo[name] = ''; return ''; }
            let val;
            if (cell.f != null) {
                busy[name] = true;
                try {
                    val = evalFormula(cell.f, env);
                } catch (e) {
                    const err = (e && e.message && String(e.message).charAt(0) === '#') ? e : new Error('#ERR');
                    memo[name] = err;
                    throw err;
                } finally {
                    delete busy[name];
                }
            } else {
                val = cell.v == null ? '' : cell.v;
            }
            memo[name] = val;
            return val;
        }

        function flatten(args) {
            const out = [];
            args.forEach(function (a) {
                if (a && a.__range) {
                    const seen = {};
                    a.__range.forEach(function (pt) {
                        const k = pt[0] + ':' + pt[1];
                        if (!seen[k]) { seen[k] = 1; out.push(valueOf(pt[0], pt[1])); }
                    });
                } else out.push(a);
            });
            return out;
        }
        function nums(args) {
            return flatten(args).map(toNum).filter(function (n) { return !isNaN(n); });
        }
        function fn(name, args) {
            switch (name) {
                case 'SUM': { const n = nums(args); return n.reduce(function (a, b) { return a + b; }, 0); }
                case 'AVERAGE': { const n = nums(args); if (!n.length) throw new Error('#DIV/0!'); return n.reduce(function (a, b) { return a + b; }, 0) / n.length; }
                case 'MIN': { const n = nums(args); return n.length ? Math.min.apply(null, n) : 0; }
                case 'MAX': { const n = nums(args); return n.length ? Math.max.apply(null, n) : 0; }
                case 'COUNT': { return nums(args).length; }
                case 'COUNTA': {
                    return flatten(args).filter(function (v) { return !(v == null || String(v) === ''); }).length;
                }
                case 'IF': {
                    if (!args.length) throw new Error('#SYNTAX');
                    return truthy(args[0]) ? (args.length > 1 ? args[1] : true) : (args.length > 2 ? args[2] : false);
                }
                case 'AND': {
                    const v = flatten(args);
                    if (!v.length) throw new Error('#SYNTAX');
                    return v.every(truthy);
                }
                case 'OR': {
                    const v = flatten(args);
                    if (!v.length) throw new Error('#SYNTAX');
                    return v.some(truthy);
                }
                case 'NOT': {
                    if (!args.length) throw new Error('#SYNTAX');
                    return !truthy(flatten([args[0]])[0]);
                }
                case 'CONCAT': {
                    return flatten(args).map(function (v) { return formatValue(v); }).join('');
                }
                case 'ABS': {
                    const n = toNum(flatten(args)[0]);
                    if (isNaN(n)) throw new Error('#VALUE!');
                    return Math.abs(n);
                }
                case 'ROUND': {
                    const v = flatten(args);
                    const x = toNum(v[0]);
                    const d = v.length > 1 ? Math.trunc(toNum(v[1])) : 0;
                    if (isNaN(x) || isNaN(d)) throw new Error('#VALUE!');
                    const f = Math.pow(10, d);
                    return Math.round(x * f) / f;
                }
                case 'SQRT': {
                    const n = toNum(flatten(args)[0]);
                    if (isNaN(n)) throw new Error('#VALUE!');
                    if (n < 0) throw new Error('#NUM!');
                    return Math.sqrt(n);
                }
                case 'POWER': {
                    const v = flatten(args);
                    const a = toNum(v[0]), b = toNum(v[1]);
                    if (isNaN(a) || isNaN(b)) throw new Error('#VALUE!');
                    return Math.pow(a, b);
                }
                case 'TEXT': {
                    const v = args.length ? args[0] : '';
                    return formatValue(v);
                }
                default:
                    throw new Error('#NAME?');
            }
        }

        const env = { ref: valueOf, fn: fn, refName: refName };
        return env;
    }

    function doCmp(op, l, r) {
        const ln = toNum(l), rn = toNum(r);
        let a = l, b = r;
        if (!isNaN(ln) && !isNaN(rn)) { a = ln; b = rn; }
        else { a = String(l == null ? '' : l); b = String(r == null ? '' : r); }
        switch (op) {
            case '=': return a === b;
            case '<>': return a !== b;
            case '>': return a > b;
            case '<': return a < b;
            case '>=': return a >= b;
            case '<=': return a <= b;
        }
        throw new Error('#SYNTAX');
    }
    function doArith(op, l, r) {
        const a = toNum(l), b = toNum(r);
        if (isNaN(a) || isNaN(b)) throw new Error('#VALUE!');
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': if (b === 0) throw new Error('#DIV/0!'); return a / b;
        }
        throw new Error('#SYNTAX');
    }

    function evalFormula(formula, env) {
        let src = String(formula);
        if (src.charAt(0) === '=') src = src.slice(1);
        if (!src.trim()) throw new Error('#SYNTAX');
        const tk = tokenize(src);
        let p = 0;

        function peek() { return tk[p]; }
        function next() { return tk[p++]; }
        function expect(v) {
            const x = next();
            if (!x || x.t !== 'op' || x.v !== v) throw new Error('#SYNTAX');
            return x;
        }
        const CMP = ['>', '<', '>=', '<=', '=', '<>'];

        function parseCmp() {
            let l = parseAdd();
            let t;
            while ((t = peek()) && t.t === 'op' && CMP.indexOf(t.v) >= 0) {
                next();
                const r = parseAdd();
                l = doCmp(t.v, l, r);
            }
            return l;
        }
        function parseAdd() {
            let l = parseMul();
            let t;
            while ((t = peek()) && t.t === 'op' && (t.v === '+' || t.v === '-')) {
                next();
                const r = parseMul();
                l = doArith(t.v, l, r);
            }
            return l;
        }
        function parsePow() {
            let l = parseUnary();
            let t;
            while ((t = peek()) && t.t === 'op' && t.v === '^') {
                next();
                const r = parseUnary();
                const a = toNum(l), b = toNum(r);
                if (isNaN(a) || isNaN(b)) throw new Error('#VALUE!');
                l = Math.pow(a, b);
            }
            return l;
        }
        function parseMul() {
            let l = parsePow();
            let t;
            while ((t = peek()) && t.t === 'op' && (t.v === '*' || t.v === '/')) {
                next();
                const r = parsePow();
                l = doArith(t.v, l, r);
            }
            return l;
        }
        function parseUnary() {
            const t = peek();
            if (t && t.t === 'op' && t.v === '-') { next(); const v = parseUnary(); const n = toNum(v); if (isNaN(n)) throw new Error('#VALUE!'); return -n; }
            if (t && t.t === 'op' && t.v === '+') { next(); return parseUnary(); }
            return parsePrimary();
        }
        function parsePrimary() {
            const t = next();
            if (!t) throw new Error('#SYNTAX');
            if (t.t === 'num') return t.v;
            if (t.t === 'str') return t.v;
            if (t.t === 'op' && t.v === '(') {
                const v = parseCmp();
                expect(')');
                return v;
            }
            if (t.t === 'ref') {
                const nx = peek();
                if (nx && nx.t === 'op' && nx.v === ':') {
                    next();
                    const r2 = next();
                    if (!r2 || r2.t !== 'ref') throw new Error('#SYNTAX');
                    const c1 = Math.min(t.c, r2.c), c2 = Math.max(t.c, r2.c);
                    const r1 = Math.min(t.r, r2.r), r3 = Math.max(t.r, r2.r);
                    const pts = [];
                    for (let c = c1; c <= c2; c++) for (let r = r1; r <= r3; r++) pts.push([c, r]);
                    return { __range: pts };
                }
                return env.ref(t.c, t.r);
            }
            if (t.t === 'ident') {
                if (t.v === 'TRUE') return true;
                if (t.v === 'FALSE') return false;
                const nx = peek();
                if (!nx || nx.t !== 'op' || nx.v !== '(') throw new Error('#NAME?');
                next();
                // raccolta argomenti come intervalli di token (permette a IF
                // di valutare pigramente solo il ramo scelto)
                const ranges = [];
                if (peek() && peek().t === 'op' && peek().v === ')') {
                    next();
                } else {
                    for (;;) {
                        const start = p;
                        let depth = 0;
                        for (;;) {
                            const x = tk[p];
                            if (!x) throw new Error('#SYNTAX');
                            if (x.t === 'op' && x.v === '(') depth++;
                            else if (x.t === 'op' && x.v === ')') {
                                if (depth === 0) break;
                                depth--;
                            } else if (x.t === 'op' && (x.v === ',' || x.v === ';') && depth === 0) break;
                            p++;
                        }
                        ranges.push([start, p]);
                        const x = tk[p];
                        if (x.t === 'op' && x.v === ')') { p++; break; }
                        p++;   // consuma il separatore (',' o ';')
                    }
                }
                function evalSlice(a, b) {
                    if (b <= a) return '';
                    const save = p;
                    p = a;
                    try {
                        const v = parseCmp();
                        if (p !== b) throw new Error('#SYNTAX');
                        return v;
                    } finally { p = save; }
                }
                if (t.v === 'IF') {
                    if (!ranges.length) throw new Error('#SYNTAX');
                    const cond = evalSlice(ranges[0][0], ranges[0][1]);
                    if (truthy(cond)) return ranges.length > 1 ? evalSlice(ranges[1][0], ranges[1][1]) : true;
                    return ranges.length > 2 ? evalSlice(ranges[2][0], ranges[2][1]) : false;
                }
                const args = ranges.map(function (rg) { return evalSlice(rg[0], rg[1]); });
                return env.fn(t.v, args);
            }
            throw new Error('#SYNTAX');
        }

        const res = parseCmp();
        if (p < tk.length) throw new Error('#SYNTAX');
        if (res && res.__range) throw new Error('#VALUE!');
        return res;
    }

    // codici errore canonici: #CIRC! #DIV/0! #REF! #NAME? #ERR!
    function canonicalErr(m) {
        if (m === '#CIRC!' || m === '#DIV/0!' || m === '#REF!' || m === '#NAME?') return m;
        return '#ERR!';   // sintassi/valore/ogni altro errore → #ERR!
    }
    function computeAll() {
        const env = makeEnv();
        const disp = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const c = st.data.cells[ref];
            if (c.f != null) {
                try {
                    disp[ref] = formatValue(evalFormula(c.f, env));
                } catch (e) {
                    const m = e && e.message ? String(e.message) : '';
                    disp[ref] = canonicalErr(m);
                }
            } else {
                disp[ref] = c.v == null ? '' : String(c.v);
            }
        });
        return disp;
    }

    // ============================================================
    // LISTA FOGLI
    // ============================================================
    async function showList(container) {
        await flush();
        detachKeys();
        fpClose();                 // R21 B4: chiude il pannello Fonti uscendo dall'editor
        st = null;
        root = container;
        container.innerHTML = '';
        container.style.padding = '4px 14px 6px';

        const screen = App.el('div', 'fg-screen');
        container.appendChild(screen);

        // barra unica 46px: [← Produttività][+ Nuovo foglio] | titolo | [Cerca…][Ordina]
        const bar = App.el('div', 'fg-top');
        screen.appendChild(bar);

        const back = ib('&larr; Produttività', 'Torna a Produttività', 'wide');
        back.addEventListener('click', function () { App.go('produttivita'); });
        bar.appendChild(back);

        const btnNew = ib(PLUS + ' Nuovo foglio', 'Crea un nuovo foglio', 'wide');
        btnNew.addEventListener('click', createNew);
        bar.appendChild(btnNew);

        const listTitle = App.el('div', 'fg-list-title', 'Fogli di calcolo');
        bar.appendChild(listTitle);

        const search = App.el('input', 'fg-search');
        search.type = 'text';
        search.placeholder = 'Cerca…';
        search.title = 'Cerca fogli per nome';
        bar.appendChild(search);

        const sort = App.el('select', 'fg-sort');
        sort.title = 'Ordina i fogli';
        [['recent', 'Ordina: data'], ['az', 'Ordina: A-Z'], ['za', 'Ordina: Z-A']].forEach(function (o) {
            const op = App.el('option');
            op.value = o[0];
            op.textContent = o[1];
            sort.appendChild(op);
        });
        bar.appendChild(sort);

        const main = App.el('div', 'fg-list');
        screen.appendChild(main);

        const status = App.el('div', 'fg-status');
        const statusLeft = App.el('span', 'left', '');
        status.appendChild(statusLeft);
        screen.appendChild(status);

        let items = [];
        try { items = await StudyStore.listItems('foglio'); } catch (e) { console.error(e); }

        let query = '';
        function draw() {
            main.innerHTML = '';
            let list = items.slice();
            if (query) {
                list = list.filter(function (it) {
                    return String(it.title || '').toLowerCase().indexOf(query) >= 0;
                });
            }
            if (sort.value === 'az') list.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'it'); });
            else if (sort.value === 'za') list.sort(function (a, b) { return String(b.title || '').localeCompare(String(a.title || ''), 'it'); });
            else list.sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });

            if (!items.length) {
                statusLeft.textContent = 'Nessun foglio';
                main.appendChild(App.empty(ICON, 'Nessun foglio di calcolo ancora: crea il primo con «Nuovo foglio» in alto a sinistra.', 'Nuovo foglio', createNew));
                return;
            }
            statusLeft.textContent = query
                ? list.length + ' di ' + items.length + (items.length === 1 ? ' foglio' : ' fogli')
                : items.length + (items.length === 1 ? ' foglio' : ' fogli');
            if (!list.length) {
                main.appendChild(App.empty(ICON, 'Nessun foglio corrisponde a «' + query + '».', 'Cancella la ricerca', function () {
                    search.value = '';
                    query = '';
                    draw();
                }));
                return;
            }
            const grid = App.el('div', 'grid-cards');
            list.forEach(function (it) { grid.appendChild(cardFor(it, container)); });
            main.appendChild(grid);
        }
        search.addEventListener('input', function () { query = String(search.value || '').trim().toLowerCase(); draw(); });
        sort.addEventListener('change', draw);
        draw();
    }

    function miniPreviewHtml(it) {
        let nSheets = 1;
        const sample = [];
        try {
            const d = JSON.parse(it.content || '{}');
            let sheetsArr = null;
            if (d && Array.isArray(d.sheets) && d.sheets.length) {
                sheetsArr = d.sheets;
                nSheets = d.sheets.length;
            } else if (d && d.cells) {
                sheetsArr = [{ cells: d.cells }];
            }
            if (sheetsArr) {
                let chosen = null;
                sheetsArr.forEach(function (s) {
                    if (!chosen && s && s.cells && Object.keys(s.cells).length) chosen = s.cells;
                });
                if (chosen) {
                    const keys = [];
                    Object.keys(chosen).forEach(function (ref) {
                        const p = parseRef(ref);
                        if (p) keys.push({ ref: ref, r: p.r, c: p.c });
                    });
                    keys.sort(function (a, b) { return (a.r - b.r) || (a.c - b.c); });
                    for (let i = 0; i < keys.length && sample.length < 2; i++) {
                        const cell = chosen[keys[i].ref];
                        let v = '';
                        if (cell && cell.v != null) v = String(cell.v);
                        else if (cell && cell.f != null) v = String(cell.f);
                        if (v !== '') sample.push(v.length > 11 ? v.slice(0, 10) + '…' : v);
                    }
                }
            }
        } catch (e) { /* anteprima non disponibile */ }
        let h = '';
        if (sample.length) {
            h += '<div class="fg-mini">';
            for (let i = 0; i < 9; i++) h += '<i>' + App.esc(sample[i] != null ? sample[i] : '') + '</i>';
            h += '</div>';
        } else {
            h += '<div class="fg-mini fg-mini-empty">' + ICON + '</div>';
        }
        return { html: h, sheets: nSheets };
    }

    function cardFor(it, container) {
        const prev = miniPreviewHtml(it);
        const card = App.el('div', 'card clickable fg-card');
        card.tabIndex = 0;
        card.innerHTML =
            prev.html +
            '<h4>' + App.esc(it.title || 'Senza titolo') + '</h4>' +
            '<div class="meta"><span>' + App.esc(App.fmtDate(it.updated_at)) + '</span>' +
            '<span>' + prev.sheets + (prev.sheets === 1 ? ' foglio' : ' fogli') + '</span></div>';
        function open() { openEditor(container, it.id); }
        card.addEventListener('click', function (e) {
            if (e.target.closest('.card-actions')) return;
            open();
        });
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        card.appendChild(actionsFor(container, it));
        return card;
    }

    function actionsFor(container, it) {
        const actions = App.el('div', 'card-actions');
        const op = App.el('button'); op.type = 'button'; op.textContent = 'Apri';
        op.addEventListener('click', function () { openEditor(container, it.id); });
        const ren = App.el('button'); ren.type = 'button'; ren.textContent = 'Rinomina';
        ren.addEventListener('click', async function () {
            const t = await ask('Titolo foglio', it.title);
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
            if (!confirm('Eliminare il foglio "' + (it.title || '') + '"?')) return;
            await StudyStore.deleteItem(it.id);
            showList(container);
        });
        actions.appendChild(op); actions.appendChild(ren); actions.appendChild(dup); actions.appendChild(del);
        return actions;
    }

    async function createNew() {
        const t = await ask('Titolo foglio',
            'Foglio senza titolo ' + new Date().toLocaleDateString('it-IT'));
        if (t == null) return;
        let item = null;
        try {
            item = await StudyStore.saveItem({
                kind: 'foglio',
                title: t.trim() || 'Foglio senza titolo',
                content: JSON.stringify({ rows: ROWS, cols: COLS, v: 2, current: 0, sheets: [{ name: 'Foglio1', color: '', cells: {}, colW: {}, rowH: {}, freeze: { c: 0, r: 0 }, sel: 'A1' }] })
            });
        } catch (e) { console.error(e); }
        if (item && item.id && root) openEditor(root, item.id);
        else if (root) showList(root);
    }

    // ============================================================
    // EDITOR
    // ============================================================
    async function openEditor(container, id) {
        const item = await StudyStore.getItem(id);
        if (!item) { showList(container); return; }
        detachKeys();
        fpClose(); // R21 B4: pannello Fonti dell'eventuale editor precedente
        root = container;
        st = {
            id: item.id,
            title: item.title || 'Foglio senza titolo',
            data: parseContent(item),
            sel: 'A1',
            range: null,
            acOpen: false,
            editing: null,
            wrap: null, gridEl: null,
            refBox: null, formula: null,
            rangeEl: null, fillEl: null, previewEl: null,
            side: null, sideTab: null, inspOpen: true, onWinResize: null,
            tabsEl: null, freezeBtn: null,
            undoBtn: null, redoBtn: null,
            titleEl: null, badgeEl: null, statusEl: null,
            undo: [], redo: [],
            keyHandler: null
        };
        bindSheet();
        st.sel = curSheet().sel || 'A1';
        if (!parseRef(st.sel)) st.sel = 'A1';
        container.innerHTML = '';
        container.style.padding = '4px 14px 6px';

        const screen = App.el('div', 'fg-screen');
        container.appendChild(screen);

        // --- barra unica (46px, una riga) ---
        const bar = App.el('div', 'fg-top');
        screen.appendChild(bar);

        const back = ib('&larr; Elenco', 'Torna all’elenco dei fogli', 'wide');
        back.addEventListener('click', function () { showList(root); });
        bar.appendChild(back);

        const undoBtn = ib(I_UNDO, 'Annulla ultima modifica delle celle (Ctrl+Z)');
        undoBtn.disabled = true;
        undoBtn.addEventListener('click', doUndo);
        bar.appendChild(undoBtn);
        st.undoBtn = undoBtn;

        const redoBtn = ib(I_REDO, 'Ripeti (Ctrl+Y)');
        redoBtn.disabled = true;
        redoBtn.addEventListener('click', doRedo);
        bar.appendChild(redoBtn);
        st.redoBtn = redoBtn;

        bar.appendChild(App.el('span', 'fg-sep'));

        const titleEl = App.el('div', 'fg-title');
        const tSpan = App.el('span', 't', App.esc(st.title));
        const badge = App.el('span', 'fg-badge', st.data.sheets.length + (st.data.sheets.length === 1 ? ' foglio' : ' fogli'));
        titleEl.appendChild(tSpan);
        titleEl.appendChild(badge);
        titleEl.title = 'Doppio click: rinomina il foglio';
        titleEl.addEventListener('dblclick', function () { renameDoc(); });
        bar.appendChild(titleEl);
        st.titleEl = tSpan;
        st.badgeEl = badge;

        bar.appendChild(App.el('span', 'fg-sep'));

        // box riferimento cella (fisso 70px) + barra formula con autocomplete
        const refBox = App.el('div', 'fg-refbox', st.sel);
        bar.appendChild(refBox);
        st.refBox = refBox;

        const formula = App.el('input');
        formula.type = 'text';
        formula.className = 'fg-formula';
        formula.placeholder = 'Valore o formula (es. =2+2, =SUM(A1:A3)) – Invio per confermare';
                formula.title = 'Valore o formula: Invio per confermare, Esc per annullare';
        formula.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (acHandleKey(formula, e)) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                pushUndo();
                setCellInput(st.sel, formula.value);
                recalcAndPaint();
                scheduleSave();
                refreshFormula();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                refreshFormula();
                if (st.wrap) st.wrap.focus && st.wrap.focus();
            }
        });
        formula.addEventListener('input', function () { acUpdate(formula); });
        formula.addEventListener('blur', function () { acClose(); });
        bar.appendChild(formula);
        st.formula = formula;

        // BLOCCO 5.5: "?" in toolbar → documentazione Formule
        const fHelp = ib('?', 'Aiuto formule: regola, funzioni ed esempi');
        fHelp.classList.add('fg-fhelp');
        fHelp.addEventListener('click', function (e) { e.stopPropagation(); openFormuleHelp(fHelp); });
        bar.appendChild(fHelp);
        // ---- H11: AI contestuale cella (F07/F08) ----
        const fAiExp = App.el('button', 'tool-btn');
        fAiExp.type = 'button';
        fAiExp.textContent = 'Spiega formula';
        fAiExp.title = 'Spiega la formula della cella selezionata (AI: F07)';
        fAiExp.addEventListener('click', function (e) { aiFogliAction('F07', e.currentTarget); });
        bar.appendChild(fAiExp);
        const fAiDesc = App.el('button', 'tool-btn');
        fAiDesc.type = 'button';
        fAiDesc.textContent = 'Descrivi → formula';
        fAiDesc.title = 'Descrivi in linguaggio naturale e ottieni la formula (AI: F08)';
        fAiDesc.addEventListener('click', function (e) { aiFogliAction('F08', e.currentTarget); });
        bar.appendChild(fAiDesc);

        // ---- R21 B4: Fonti (FontiPanel, contesto 'fogli'): toggle laterale ----
        const fpBtn = App.el('button', 'tool-btn');
        fpBtn.type = 'button';
        fpBtn.textContent = 'Fonti';
        fpBtn.title = 'Apri/chiudi le fonti inseribili nel foglio (R21)';
        fpBtn.addEventListener('click', function () { fpToggle(fpBtn); });
        bar.appendChild(fpBtn);
        st.fpBtn = fpBtn;

        bar.appendChild(App.el('span', 'fg-sep'));

        // F2/F3: B + colori spostati nel pannello "Formato cella";
        // allineamenti rimossi dalla toolbar (il dato c.a resta applicabile
        // da undo/vecchie celle via paintCell).
        function colorBtn(label, prop, title) {
            const inp = App.el('input', 'fg-color');
            inp.type = 'color';
            inp.title = title;
            const c0 = cellObj(st.sel, false);
            if (c0 && c0[prop]) inp.value = c0[prop];
            inp.addEventListener('input', function () {
                eachSel(function (ref) {
                    const c = cellObj(ref, true);
                    c[prop] = inp.value;
                });
                recalcAndPaint(); scheduleSave();
            });
            return inp;
        }
        // formati numero, unioni, bordi, blocca
        const nfEur = ib('€', 'Formato valuta euro (it-IT, 2 decimali) sulle celle selezionate');
        nfEur.addEventListener('click', function () { pushUndo(); toggleNf('eur'); });
        bar.appendChild(nfEur);

        const nfPct = ib('%', 'Formato percentuale (15 → 15%, 0,15 → 15%) sulle celle selezionate');
        nfPct.addEventListener('click', function () { pushUndo(); toggleNf('pct'); });
        bar.appendChild(nfPct);

        const nfInc = ib('Dec +', 'Aumenta i decimali visualizzati (max 6)');
        nfInc.addEventListener('click', function () { pushUndo(); changeDecimals(1); });
        bar.appendChild(nfInc);

        const nfDec = ib('Dec −', 'Riduci i decimali visualizzati');
        nfDec.addEventListener('click', function () { pushUndo(); changeDecimals(-1); });
        bar.appendChild(nfDec);

        const mgBtn = ib('Unisci', 'Unisci le celle della selezione (resta il primo valore)');
        mgBtn.addEventListener('click', function () { mergeRange(); });
        bar.appendChild(mgBtn);

        const bdBtn = ib('Bordi' + I_DOWN, 'Bordi celle: nessuno / esterno / completo');
        bdBtn.addEventListener('click', function (e) { e.stopPropagation(); openBorderMenu(bdBtn); });
        bar.appendChild(bdBtn);

        const fzBtn = ib('Blocca' + I_DOWN, 'Blocca righe/colonne sopra e a sinistra della selezione');
        fzBtn.addEventListener('click', function (e) { e.stopPropagation(); openFreezeMenu(fzBtn); });
        bar.appendChild(fzBtn);
        st.freezeBtn = fzBtn;

        bar.appendChild(App.el('span', 'fg-spacer'));

        // secondarie in "…"
        const moreBtn = ib(I_DOTS, 'Altre azioni: dividi celle, rinomina foglio');
        moreBtn.addEventListener('click', function (e) { e.stopPropagation(); openMoreMenu(moreBtn); });
        bar.appendChild(moreBtn);

        const expBtn = ib('Export' + I_DOWN, 'Esporta o importa CSV');
        expBtn.addEventListener('click', function (e) { e.stopPropagation(); openExportMenu(expBtn); });
        bar.appendChild(expBtn);

        // --- centro: griglia + pannello destro collassabile "Formato cella" ---
        const body = App.el('div', 'fg-body');
        screen.appendChild(body);
        const wrap = App.el('div', 'fg-wrap');
        wrap.tabIndex = 0;
        body.appendChild(wrap);
        st.wrap = wrap;
        // overlay selezione range / anteprima fill / fill handle (3.1, 3.2)
        st.rangeEl = App.el('div', 'fg-rng');
        st.rangeEl.style.display = 'none';
        st.previewEl = App.el('div', 'fg-fpreview');
        st.previewEl.style.display = 'none';
        st.fillEl = App.el('div', 'fg-fill');
        st.fillEl.title = 'Trascina per riempire (serie numerica o copia)';
        st.fillEl.style.display = 'none';

        // --- F2: pannello destro collassabile "Formato cella" (stile pp-insp) ---
        // Contiene GRASSETTO + colore testo/sfondo (spostati dalla toolbar);
        // solo i3 richiesti: gli allineamenti sono stati rimossi (F3), il dato
        // c.a delle celle esistenti resta applicato da paintCell/undo.
        function toggleFmtPanel() {
            if (!st || !st.side || !st.sideTab) return;
            st.inspOpen = !st.inspOpen;
            st.side.style.display = st.inspOpen ? '' : 'none';
            st.sideTab.style.display = st.inspOpen ? 'none' : '';
        }
        const side = App.el('div', 'fg-side');
        const sideHead = App.el('div', 'fg-side-head');
        sideHead.appendChild(App.el('span', 'fg-side-title', 'Formato cella'));
        const sideCol = ib('&rsaquo;', 'Nascondi il pannello Formato cella');
        sideCol.addEventListener('click', function () { toggleFmtPanel(); });
        sideHead.appendChild(sideCol);
        side.appendChild(sideHead);

        const rowB = App.el('div', 'fg-side-row');
        rowB.appendChild(App.el('label', '', 'Grassetto'));
        const bBtn = ib('B', 'Grassetto cella selezionata');
        bBtn.style.fontWeight = '800';
        bBtn.addEventListener('click', function () {
            pushUndo();
            const first = cellObj(st.sel, false);
            const bold = !(first && first.b);
            eachSel(function (ref) {
                const c = cellObj(ref, true);
                c.b = bold ? 1 : 0;
            });
            recalcAndPaint(); scheduleSave();
        });
        rowB.appendChild(bBtn);
        side.appendChild(rowB);

        const rowC = App.el('div', 'fg-side-row');
        rowC.appendChild(App.el('label', '', 'Colore testo'));
        const cBtn = colorBtn('c', 'c', 'Colore testo');
        rowC.appendChild(cBtn);
        side.appendChild(rowC);

        const rowBg = App.el('div', 'fg-side-row');
        rowBg.appendChild(App.el('label', '', 'Sfondo'));
        const bgBtn = colorBtn('bg', 'bg', 'Sfondo cella');
        rowBg.appendChild(bgBtn);
        side.appendChild(rowBg);

        st.side = side;
        st.cBtn = cBtn;
        st.bgBtn = bgBtn;
        body.appendChild(side);

        const sideTab = App.el('button', 'fg-side-tab');
        sideTab.type = 'button';
        sideTab.title = 'Mostra il pannello Formato cella';
        sideTab.textContent = 'Formato';
        sideTab.style.display = 'none';
        sideTab.addEventListener('click', function () { toggleFmtPanel(); });
        st.sideTab = sideTab;
        body.appendChild(sideTab);
        st.inspOpen = true;

        renderGrid();
        recalcAndPaint();
        selectCell(st.sel);

        // selezione: click, shift+click, drag range, intestazioni col/riga (3.1)
        wrap.addEventListener('pointerdown', function (e) { onGridPointerDown(e); });
        // F1: con celle frozen sticky la posizione visiva delle celle cambia con
        // lo scorrimento: ricalcola gli overlay anche su scroll (e su resize della
        // finestra, oltre a resize colonne/righe già gestiti da startResize/autoFit)
        wrap.addEventListener('scroll', function () { updateOverlays(); }, { passive: true });
        st.onWinResize = function () { updateOverlays(); };
        window.addEventListener('resize', st.onWinResize);
        wrap.addEventListener('dblclick', function (e) {
            const t = e.target;
            if (!t || !t.closest) return;
            const h = t.closest('.fg-rh,.fg-vrh');
            if (h) { autoFitHandle(h); return; }
            if (t.closest('th[data-c],th[data-r],th.corner')) return;
            const td = t.closest('td[data-ref]');
            if (!td) return;
            selectCell(td.getAttribute('data-ref'));
            startEdit(null);
        });

        // menu contestuale destro sulle celle (3E)
        wrap.addEventListener('contextmenu', function (e) {
            const t = e.target;
            if (!t || !t.closest) return;
            const td = t.closest('td[data-ref]');
            if (!td) return;
            e.preventDefault();
            if (st.editing) commitEdit();
            selectCell(td.getAttribute('data-ref'));
            openCellMenu(e.clientX, e.clientY);
        });

        // tastiera globale (finché l'editor è aperto)
        st.keyHandler = function (e) {
            if (!st) return;
            if (st.editing) return;
            const ae = document.activeElement;
            if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
            if (ae === st.formula) return;
            const k = e.key;
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                const lk = String(k).toLowerCase();
                if (lk === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
                if (lk === 'y') { e.preventDefault(); doRedo(); return; }
                if (lk === 'c') { e.preventDefault(); copySelection(); return; }
                if (lk === 'v') { e.preventDefault(); pasteClip(); return; }
            }
            if (k === 'F2') { e.preventDefault(); startEdit(null); return; }
            if (k === 'Enter') { e.preventDefault(); startEdit(null); return; }
            if (k === 'Delete' || k === 'Backspace') {
                e.preventDefault();
                pushUndo();
                clearSelCells();
                return;
            }
            if (k === 'Escape' && st.range) {
                e.preventDefault();
                clearRange();
                return;
            }
            if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                startEdit(k);
                return;
            }
            if (k.indexOf('Arrow') === 0) {
                e.preventDefault();
                moveSel(k);
            }
        };
        document.addEventListener('keydown', st.keyHandler, true);

        // --- basso: tab fogli (30px) + status bar (26px) ---
        const tabsBar = App.el('div', 'fg-tabs');
        st.tabsEl = tabsBar;
        screen.appendChild(tabsBar);
        renderTabs();

        const status = App.el('div', 'fg-status');
        const statusLeft = App.el('span', 'left', '');
        st.statusEl = statusLeft;
        status.appendChild(statusLeft);
        const helpBtn = ib('?', 'Scorciatoie da tastiera');
        helpBtn.addEventListener('click', function (e) { e.stopPropagation(); openHelpPop(helpBtn); });
        status.appendChild(helpBtn);
        screen.appendChild(status);

        updateFreezeBtn();
        updateStatusBar();
        syncUndoBtns();
    }

    function moveSel(key) {
        const m = st.sel.match(/^([A-Z]+)([0-9]+)$/);
        if (!m) return;
        let c = colFromLetters(m[1]);
        let r = parseInt(m[2], 10) - 1;
        if (key === 'ArrowUp') r--;
        else if (key === 'ArrowDown') r++;
        else if (key === 'ArrowLeft') c--;
        else if (key === 'ArrowRight') c++;
        r = Math.max(0, Math.min(ROWS - 1, r));
        c = Math.max(0, Math.min(COLS - 1, c));
        selectCell(colName(c) + (r + 1));
    }

    // ---------- griglia DOM ----------
    function renderGrid() {
        const fz = st.data.freeze || { c: 0, r: 0 };
        // posizioni coperte dalle celle unite (l'ancora fa da td con colspan/rowspan)
        const cover = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const cell = st.data.cells[ref];
            if (cell && cell.mg) {
                const p = parseRef(ref);
                if (!p) return;
                const c2 = Math.min(COLS - 1, Math.max(p.c, cell.mg.c2 | 0));
                const r2 = Math.min(ROWS - 1, Math.max(p.r, cell.mg.r2 | 0));
                for (let r = p.r; r <= r2; r++) {
                    for (let c = p.c; c <= c2; c++) {
                        if (r === p.r && c === p.c) continue;
                        cover[c + ',' + r] = 1;
                    }
                }
            }
        });
        // FIX F1: la tabella deve rendere ESATTAMENTE le larghezze dichiarate;
        // con width auto (table-layout fixed) Chromium la forza al clientWidth
        // del wrap (1128px) e comprime il colgroup (2540px -> colonne ~43-46px),
        // rompendo colX/rowY, lo sticky delle celle congelate e lo scroll
        // orizzontale del wrap. Larghezza esplicita = somma colgroup -> wrap
        // scorre orizzontalmente e colX coincide con i rect reali.
        let tableW = 44;
        for (let c = 0; c < COLS; c++) tableW += colWidth(c);
        let h = '<table class="fg" style="width:' + tableW + 'px"><colgroup><col style="width:44px">';
        for (let c = 0; c < COLS; c++) h += '<col style="width:' + colWidth(c) + 'px">';
        h += '</colgroup><thead><tr><th class="corner" title="Seleziona tutte le celle"></th>';
        for (let c = 0; c < COLS; c++) {
            const fzLeft = (fz.c > 0 && c < fz.c) ? ';position:sticky;left:' + colX(c) + 'px' : '';
            const edge = (fz.c > 0 && c === fz.c - 1) ? ' fz-edge-r' : '';
            h += '<th class="colh' + edge + '" data-c="' + c + '" style="width:' + colWidth(c) + 'px' + fzLeft +
                '" title="Colonna ' + colName(c) + ' — clic: seleziona la colonna, bordo destro: ridimensiona (doppio click: adatta)">' +
                colName(c) + '<span class="fg-rh" data-idx="' + c + '" title="Ridimensiona colonna — doppio click: adatta al contenuto"></span></th>';
        }
        h += '</tr></thead><tbody>';
        for (let r = 0; r < ROWS; r++) {
            const rh = rowHeight(r);
            const fzTop = (fz.r > 0 && r < fz.r) ? ';position:sticky;top:' + rowY(r) + 'px' : '';
            const redge = (fz.r > 0 && r === fz.r - 1) ? ' fz-edge-b' : '';
            h += '<tr' + (rh !== 26 ? ' style="height:' + rh + 'px"' : '') + '>';
            h += '<th class="rowh' + redge + '" data-r="' + r + '"' + fzTop +
                ' title="Riga ' + (r + 1) + ' — clic: seleziona la riga, bordo inferiore: ridimensiona">' + (r + 1) +
                '<span class="fg-vrh" data-idx="' + r + '" title="Altezza riga — doppio click: altezza automatica"></span></th>';
            let c = 0;
            while (c < COLS) {
                const ref = refAt(c, r);
                if (cover[c + ',' + r]) { c++; continue; }
                const cell = st.data.cells[ref];
                let cs = 1, rs = 1;
                if (cell && cell.mg) {
                    cs = Math.max(1, Math.min(COLS - c, (cell.mg.c2 | 0) - c + 1));
                    rs = Math.max(1, Math.min(ROWS - r, (cell.mg.r2 | 0) - r + 1));
                }
                const fzStyles = [];
                if (fz.c > 0 && c < fz.c) { fzStyles.push('position:sticky', 'left:' + colX(c) + 'px'); }
                if (fz.r > 0 && r < fz.r) { fzStyles.push('position:sticky', 'top:' + rowY(r) + 'px'); }
                const cls = fzStyles.length ? ' class="fg-frozen"' : '';
                const sty = fzStyles.length ? ' style="' + fzStyles.join(';') + '"' : '';
                h += '<td data-ref="' + ref + '"' + cls + sty +
                    (cs > 1 ? ' colspan="' + cs + '"' : '') +
                    (rs > 1 ? ' rowspan="' + rs + '"' : '') +
                    '><span class="cin"></span></td>';
                c += cs;
            }
            h += '</tr>';
        }
        h += '</tbody></table>';
        st.gridEl = null;
        st.wrap.innerHTML = h;
        st.gridEl = st.wrap.querySelector('table.fg');
        // innerHTML ha rimosso gli overlay: li ripristina
        if (st.rangeEl) {
            st.wrap.appendChild(st.rangeEl);
            if (st.previewEl) st.wrap.appendChild(st.previewEl);
            if (st.fillEl) st.wrap.appendChild(st.fillEl);
        }
    }

    function tdOf(ref) {
        if (!st.wrap) return null;
        return st.wrap.querySelector('td[data-ref="' + ref + '"]');
    }

    function paintCell(ref, dispMap) {
        const td = tdOf(ref);
        if (!td) return;
        const span = td.firstChild;
        const c = st.data.cells[ref];
        let text = '';
        if (dispMap && Object.prototype.hasOwnProperty.call(dispMap, ref)) text = dispMap[ref];
        else if (c) text = c.f != null ? '' : (c.v == null ? '' : String(c.v));
        span.textContent = c ? applyNf(c.nf, text) : text;
        span.style.fontWeight = (c && c.b) ? '700' : '';
        span.style.color = (c && c.c) ? c.c : '';
        span.style.background = (c && c.bg) ? c.bg : '';
        span.style.textAlign = (c && c.a) ? c.a : 'left';
        td.style.boxShadow = cellShadow(c, ref);
    }
    function cellShadow(cell, ref) {
        const sh = [];
        const p = parseRef(ref);
        if (cell) {
            if (cell.bd === 'all') sh.push('inset 0 0 0 1.5px #1c2130');
            else if (cell.bd === 'out' && cell.bde) {
                if (cell.bde.indexOf('t') >= 0) sh.push('inset 0 1.5px 0 #1c2130');
                if (cell.bde.indexOf('b') >= 0) sh.push('inset 0 -1.5px 0 #1c2130');
                if (cell.bde.indexOf('l') >= 0) sh.push('inset 1.5px 0 0 #1c2130');
                if (cell.bde.indexOf('r') >= 0) sh.push('inset -1.5px 0 0 #1c2130');
            }
            if (cell.mg && cell.bd !== 'all') sh.push('inset 0 0 0 1.5px #1c2130');
        }
        const fz = st.data.freeze || { c: 0, r: 0 };
        if (p) {
            if (fz.c > 0 && p.c === fz.c - 1) sh.push('inset -2px 0 0 #f9974a33');
            if (fz.r > 0 && p.r === fz.r - 1) sh.push('inset 0 -2px 0 #f9974a33');
        }
        return sh.join(',');
    }

    function recalcAndPaint() {
        if (!st) return;
        const disp = computeAll();
        const tds = st.wrap.querySelectorAll('td[data-ref]');
        for (let i = 0; i < tds.length; i++) paintCell(tds[i].dataset.ref, disp);
        if (st.sel) paintCell(st.sel, disp);
        updateStatusBar();
    }

    function selectCell(ref, keepRange) {
        if (!st) return;
        st.sel = resolveAnchor(ref);
        if (!keepRange) st.range = null;
        const sheet = curSheet();
        if (sheet) sheet.sel = st.sel;
        paintSelection();
        refreshFormula();
        syncColorInputs();
    }

    function refreshFormula() {
        if (st.formula) st.formula.value = rawOf(st.sel);
    }
    function syncColorInputs() {
        const c = cellObj(st.sel, false);
        if (st.cBtn) st.cBtn.value = (c && c.c) ? c.c : '#f5f7fa';
        if (st.bgBtn) st.bgBtn.value = (c && c.bg) ? c.bg : '#202637';
    }

    // ---------- modifica cella ----------
    function startEdit(initial) {
        if (!st) return;
        if (st.editing) commitEdit();
        const ref = st.sel;
        const td = tdOf(ref);
        if (!td) return;
        const inp = App.el('input', 'fg-editor');
        inp.value = initial != null ? initial : rawOf(ref);
        // 1.3: posizione robusta — rettangolo reale della td relativizzato allo
        // scroll del .fg-wrap (come fanno gli overlay); se il layout non è
        // disponibile (jsdom: offset*/getBoundingClientRect a 0) si usa la
        // geometria content-space del modulo (colX/rowY/colWidth/rowHeight),
        // che in browser coincide con la td. Niente min-width forzati:
        // l'editor copre esattamente la cella.
        let edLeft = null, edTop = null, edW = null, edH = null;
        if (td.getBoundingClientRect && st.wrap && st.wrap.getBoundingClientRect) {
            const tr = td.getBoundingClientRect();
            const wr = st.wrap.getBoundingClientRect();
            if (tr.width > 0 && tr.height > 0 && wr.width > 0) {
                edLeft = tr.left - wr.left - (st.wrap.clientLeft || 0) + st.wrap.scrollLeft;
                edTop = tr.top - wr.top - (st.wrap.clientTop || 0) + st.wrap.scrollTop;
                edW = tr.width;
                edH = tr.height;
            }
        }
        if (edLeft == null) {
            const p0 = parseRef(ref) || { c: 0, r: 0 };
            const rr = realRect({ c1: p0.c, r1: p0.r, c2: p0.c, r2: p0.r });
            edLeft = colX(rr.c1);
            edTop = rowY(rr.r1);
            edW = colX(rr.c2 + 1) - edLeft;
            edH = rowY(rr.r2 + 1) - edTop;
        }
        inp.style.left = Math.round(edLeft) + 'px';
        inp.style.top = Math.round(edTop) + 'px';
        inp.style.width = Math.round(edW) + 'px';
        inp.style.height = Math.round(edH) + 'px';
        st.wrap.appendChild(inp);
        st.editing = inp;
        inp.focus();
        if (initial == null) inp.select();
        if (initial != null && String(initial).charAt(0) === '=') acUpdate(inp);

        inp.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (acHandleKey(inp, e)) return;
            if (e.key === 'Enter') { e.preventDefault(); acClose(); commitEdit(); moveSel('ArrowDown'); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        });
        inp.addEventListener('input', function () { acUpdate(inp); });
        inp.addEventListener('blur', function () { acClose(); commitEdit(); });
    }
    function commitEdit() {
        if (!st || !st.editing) return;
        acClose();
        const inp = st.editing;
        const ref = st.sel;
        pushUndo();
        st.editing = null;
        const v = inp.value;
        inp.remove();
        setCellInput(ref, v);
        recalcAndPaint();
        refreshFormula();
        scheduleSave();
    }
    function cancelEdit() {
        if (!st || !st.editing) return;
        acClose();
        const inp = st.editing;
        st.editing = null;
        inp.remove();
        refreshFormula();
    }

    // ---------- CSV ----------
    function importCsv() {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.csv,.txt,text/csv,text/plain';
        inp.addEventListener('change', function () {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = function () {
                const text = String(r.result || '').replace(/^\uFEFF/, '');
                const lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.length; });
                if (!lines.length) return;
                const first = lines[0];
                const cands = [';', ',', '\t'];
                let delim = ';', best = -1;
                cands.forEach(function (d) {
                    const n = first.split(d).length - 1;
                    if (n > best) { best = n; delim = d; }
                });
                if (best <= 0) delim = first.indexOf(';') >= 0 ? ';' : ',';
                if (!confirm('Importare ' + lines.length + ' righe dal CSV (separatore "' + delim + '")? Le celle esistenti verranno sovrascritte.')) return;
                pushUndo();
                Object.keys(st.data.cells).forEach(function (k) { delete st.data.cells[k]; });
                lines.forEach(function (line, ri) {
                    if (ri >= ROWS) return;
                    const parts = line.split(delim);
                    parts.forEach(function (raw, ci) {
                        if (ci >= COLS) return;
                        let v = raw;
                        if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
                            v = v.slice(1, -1).replace(/""/g, '"');
                        }
                        v = v.trim();
                        if (v !== '') setCellInput(colName(ci) + (ri + 1), v);
                    });
                });
                renderGrid();
                recalcAndPaint();
                selectCell('A1');
                scheduleSave();
            };
            r.readAsText(f, 'utf-8');
        });
        inp.click();
    }

    function exportCsv() {
        // limiti usati
        let maxR = 0, maxC = 0;
        Object.keys(st.data.cells).forEach(function (ref) {
            const m = ref.match(/^([A-Z]+)([0-9]+)$/);
            if (!m) return;
            const c = colFromLetters(m[1]);
            const r = parseInt(m[2], 10);
            if (r > maxR) maxR = r;
            if (c + 1 > maxC) maxC = c + 1;
        });
        if (!maxR) { maxR = 1; maxC = 1; }
        const disp = computeAll();
        const rows = [];
        for (let r = 1; r <= maxR; r++) {
            const line = [];
            for (let c = 0; c < maxC; c++) {
                const ref = colName(c) + r;
                let v = '';
                if (Object.prototype.hasOwnProperty.call(disp, ref)) v = disp[ref];
                v = String(v);
                if (/[;"\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
                line.push(v);
            }
            rows.push(line.join(';'));
        }
        download('\uFEFF' + rows.join('\r\n') + '\r\n', safeName(st.title) + '.csv', 'text/csv;charset=utf-8');
    }

    // ============================================================
    // GEOMETRIA E SELEZIONE RANGE (3.1)
    // ============================================================
    function parseRef(ref) {
        const m = String(ref || '').match(/^([A-Z]+)([0-9]+)$/);
        if (!m) return null;
        const c = colFromLetters(m[1]);
        const r = parseInt(m[2], 10) - 1;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
        return { c: c, r: r };
    }
    function refAt(c, r) { return colName(c) + (r + 1); }
    function colWidth(c) {
        const v = st && st.data && st.data.colW ? +st.data.colW[c] : NaN;
        return v >= 16 ? Math.round(v) : 96;
    }
    function rowHeight(r) {
        const v = st && st.data && st.data.rowH ? +st.data.rowH[r] : NaN;
        return v >= 16 ? Math.round(v) : 26;
    }
    function colX(c) { let x = 44; for (let i = 0; i < c && i < COLS; i++) x += colWidth(i); return x; }
    function rowY(r) { let y = 26; for (let i = 0; i < r && i < ROWS; i++) y += rowHeight(i); return y; }

    function setRange(c1, r1, c2, r2) {
        if (!st) return;
        const a = Math.min(c1, c2), b = Math.max(c1, c2);
        const x = Math.min(r1, r2), y = Math.max(r1, r2);
        st.range = { c1: Math.max(0, a), r1: Math.max(0, x), c2: Math.min(COLS - 1, b), r2: Math.min(ROWS - 1, y) };
        paintSelection();
    }
    function clearRange() {
        if (!st) return;
        st.range = null;
        paintSelection();
        refreshFormula();
    }
    function rangeRect() {
        if (st.range) return st.range;
        const p = parseRef(st.sel) || { c: 0, r: 0 };
        return { c1: p.c, r1: p.r, c2: p.c, r2: p.r };
    }
    function eachSel(cb) {
        if (!st) return;
        if (st.range) {
            const rg = st.range;
            for (let r = rg.r1; r <= rg.r2; r++) {
                for (let c = rg.c1; c <= rg.c2; c++) cb(refAt(c, r), c, r);
            }
        } else {
            const p = parseRef(st.sel);
            if (p) cb(st.sel, p.c, p.r);
        }
    }
    function resolveAnchor(ref) {
        if (!st || tdOf(ref)) return ref;
        const cell = st.data.cells[ref];
        if (!cell || !cell.ma) return ref;
        const p = parseRef(ref);
        if (!p) return ref;
        let found = ref;
        forEachMg(function (anchorRef, cell2, rect) {
            if (p.c >= rect.c1 && p.c <= rect.c2 && p.r >= rect.r1 && p.r <= rect.r2) found = anchorRef;
        });
        return found;
    }

    function paintSelection() {
        if (!st || !st.wrap) return;
        const prev = st.wrap.querySelector('td.sel');
        if (prev) prev.classList.remove('sel');
        if (st.sel) {
            const anchor = resolveAnchor(st.sel);
            if (anchor !== st.sel) st.sel = anchor;
            const td = tdOf(st.sel);
            if (td) td.classList.add('sel');
        }
        const hl = st.wrap.querySelectorAll('th.hl');
        for (let i = 0; i < hl.length; i++) hl[i].classList.remove('hl');
        let label = st.sel || '';
        if (st.range) {
            const rg = st.range;
            label = refAt(rg.c1, rg.r1) + ':' + refAt(rg.c2, rg.r2);
            for (let c = rg.c1; c <= rg.c2; c++) {
                const th = st.wrap.querySelector('th[data-c="' + c + '"]');
                if (th) th.classList.add('hl');
            }
            for (let r = rg.r1; r <= rg.r2; r++) {
                const th = st.wrap.querySelector('th[data-r="' + r + '"]');
                if (th) th.classList.add('hl');
            }
        }
        if (st.refBox) st.refBox.textContent = label;
        updateOverlays();
        updateStatusBar();
    }
    // 1.1: rettangolo REALE della selezione — le celle unite hanno l'ancora con
    // colspan/rowspan più grande della cella nominale, quindi l'angolo
    // basso-destro effettivo è quello del merge (clamp ai bordi della griglia).
    function realRect(rg) {
        if (!st || !rg) return rg;
        const anchorRef = resolveAnchor(refAt(rg.c2, rg.r2));
        const cell = st.data.cells[anchorRef];
        if (!cell || !cell.mg) return rg;
        const p = parseRef(anchorRef);
        if (!p) return rg;
        const c2 = Math.min(COLS - 1, Math.max(rg.c2, cell.mg.c2 | 0));
        const r2 = Math.min(ROWS - 1, Math.max(rg.r2, cell.mg.r2 | 0));
        if (c2 === rg.c2 && r2 === rg.r2) return rg;
        return { c1: rg.c1, r1: rg.r1, c2: c2, r2: r2 };
    }
    function edgeTd(c, r) {
        const ref = refAt(c, r);
        return tdOf(ref) || tdOf(resolveAnchor(ref));
    }
    // 1.1: UNO solo box condiviso da .fg-rng e .fg-fill (prima il fill veniva
    // rettificato sui td frozen mentre il rect restava su coordinate di
    // contenuto → con celle congelate + scroll il pallino si staccava
    // dall'angolo del rect reale, spostandosi verso destra es. K13 → Y13).
    // Assi bloccati: angoli letti dal getBoundingClientRect del td d'angolo
    // relativizzato al wrap (+scroll, bordo via wrap.clientLeft, non il rect);
    // in jsdom (rettangoli a 0) o senza freeze valgono le coordinate di
    // contenuto, che con lo scroll regolare seguono le celle automaticamente.
    // FIX F1a/F1b: box in coordinate CONTENUTO del .fg-wrap, stessa formula per
    // X e Y letta dai rettangoli REALI della td d'angolo:
    //   content = viewport - wrapRect - client + scroll
    // Prima X e Y usavano colX/rowY (larghezze DICHIARATE colWidth=96px) e i
    // rect reali solo per gli assi frozen: in Chromium table.fg (table-layout
    // fixed, width auto = clientWidth wrap) comprime il colgroup 44+26*96=2540px
    // in 1128px (colonna reale ~43-46px), quindi l'asse X del pallino finiva a
    // +585.4px dalla td K13 mentre Y restava giusta (le righe hanno altezza
    // fissa e non si comprimono). Fallback colX/rowY solo senza layout (jsdom).
    function cellBox(c, r) {
        const fb = { left: colX(c), top: rowY(r), right: colX(c + 1), bottom: rowY(r + 1) };
        const wrap = st && st.wrap;
        if (!wrap || !wrap.getBoundingClientRect) return fb;
        const wr = wrap.getBoundingClientRect();
        if (!(wr.width > 0 && wr.height > 0)) return fb;
        const t = edgeTd(c, r);
        if (!t || !t.getBoundingClientRect) return fb;
        const tr = t.getBoundingClientRect();
        if (!(tr.width > 0 && tr.height > 0)) return fb;
        const dx = wrap.scrollLeft - wr.left - (wrap.clientLeft || 0);
        const dy = wrap.scrollTop - wr.top - (wrap.clientTop || 0);
        return { left: tr.left + dx, top: tr.top + dy, right: tr.right + dx, bottom: tr.bottom + dy };
    }
    function overlayBox(rgIn) {
        const rg = realRect(rgIn || rangeRect());
        const a = cellBox(rg.c1, rg.r1);
        const b = cellBox(rg.c2, rg.r2);
        return { x: a.left, y: a.top, w: Math.max(1, b.right - a.left), h: Math.max(1, b.bottom - a.top) };
    }
    function updateOverlays() {
        if (!st || !st.rangeEl || !st.fillEl) return;
        if (!st.sel) {
            st.rangeEl.style.display = 'none';
            st.fillEl.style.display = 'none';
            return;
        }
        const box = overlayBox(rangeRect());
        if (st.range) {
            st.rangeEl.style.display = 'block';
            st.rangeEl.style.left = Math.round(box.x) + 'px';
            st.rangeEl.style.top = Math.round(box.y) + 'px';
            st.rangeEl.style.width = Math.round(box.w) + 'px';
            st.rangeEl.style.height = Math.round(box.h) + 'px';
        } else st.rangeEl.style.display = 'none';
        // F1: fill handle sull'angolo basso-destro del rect — box 8px con
        // border-box e offset 7px → 7px dentro il bordo, 1px di sporgenza
        // (offset coerente 0-2px oltre il bordo, prima era -5 con z-index 3).
        // Con celle frozen (sticky) le coordinate di contenuto si staccano dalla
        // posizione visiva reale: per gli assi bloccati si usa il
        // getBoundingClientRect del td d'angolo relativizzato al wrap (+scroll);
        // in jsdom (rettangoli a 0) o senza freeze si usano le coordinate di
        // contenuto, che con lo scroll regolare seguono le celle automaticamente.
        // 1.1: pallino SEMPRE sull'angolo basso-destro dello stesso box del
        // .fg-rng (box 8px border-box, offset 7px → 1px di sporgenza fuori dal bordo)
        st.fillEl.style.display = 'block';
        st.fillEl.style.left = (Math.round(box.x + box.w) - 7) + 'px';
        st.fillEl.style.top = (Math.round(box.y + box.h) - 7) + 'px';
    }

    function selectColumn(c) {
        if (isNaN(c) || c < 0 || c >= COLS) return;
        const p = parseRef(st.sel) || { c: 0, r: 0 };
        st.sel = refAt(c, Math.min(p.r, ROWS - 1));
        st.range = { c1: c, r1: 0, c2: c, r2: ROWS - 1 };
        const sheet = curSheet();
        if (sheet) sheet.sel = st.sel;
        paintSelection(); refreshFormula(); syncColorInputs();
    }
    function selectRow(r) {
        if (isNaN(r) || r < 0 || r >= ROWS) return;
        const p = parseRef(st.sel) || { c: 0, r: 0 };
        st.sel = refAt(Math.min(p.c, COLS - 1), r);
        st.range = { c1: 0, r1: r, c2: COLS - 1, r2: r };
        const sheet = curSheet();
        if (sheet) sheet.sel = st.sel;
        paintSelection(); refreshFormula(); syncColorInputs();
    }
    function selectAllCells() {
        st.range = { c1: 0, r1: 0, c2: COLS - 1, r2: ROWS - 1 };
        paintSelection(); refreshFormula(); syncColorInputs();
    }

    function onGridPointerDown(e) {
        if (!st) return;
        if (e.button != null && e.button !== 0) return;
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.fg-editor,.fg-ac,.fg-menu')) return;
        const fill = t.closest('.fg-fill');
        if (fill) { startFillDrag(e); return; }
        const rh = t.closest('.fg-rh');
        if (rh) { startResize(rh, e); return; }
        const vrh = t.closest('.fg-vrh');
        if (vrh) { startResize(vrh, e); return; }
        if (st.editing) commitEdit();
        const corner = t.closest('th.corner');
        if (corner) { e.preventDefault(); selectAllCells(); return; }
        const thc = t.closest('th[data-c]');
        if (thc) { e.preventDefault(); selectColumn(parseInt(thc.getAttribute('data-c'), 10)); return; }
        const thr = t.closest('th[data-r]');
        if (thr) { e.preventDefault(); selectRow(parseInt(thr.getAttribute('data-r'), 10)); return; }
        const td = t.closest('td[data-ref]');
        if (!td) return;
        const ref = td.getAttribute('data-ref');
        const p = parseRef(ref);
        if (!p) return;
        if (e.shiftKey && st.sel) {
            const a = parseRef(st.sel);
            if (a) { setRange(a.c, a.r, p.c, p.r); refreshFormula(); syncColorInputs(); return; }
        }
        st.sel = ref;
        st.range = null;
        const sheet = curSheet();
        if (sheet) sheet.sel = st.sel;
        paintSelection(); refreshFormula(); syncColorInputs();
        const anchor = { c: p.c, r: p.r };
        let dragging = false;
        if (st.fillEl) st.fillEl.style.pointerEvents = 'none';
        function onMove(ev) {
            const under = document.elementFromPoint(ev.clientX, ev.clientY);
            const cell = under && under.closest ? under.closest('td[data-ref]') : null;
            if (!cell) return;
            const p2 = parseRef(cell.getAttribute('data-ref'));
            if (!p2) return;
            if (!dragging && (p2.c !== anchor.c || p2.r !== anchor.r)) dragging = true;
            if (dragging) setRange(anchor.c, anchor.r, p2.c, p2.r);
        }
        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            if (st && st.fillEl) st.fillEl.style.pointerEvents = '';
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    // ============================================================
    // FILL HANDLE (3.2)
    // ============================================================
    function startFillDrag(e) {
        if (!st) return;
        // 1.1: base = rettangolo REALE (celle unite incluse): la preview parte
        // dall'angolo esatto dove sta il pallino che l'utente ha afferrato
        const rg = realRect(rangeRect());
        const sx = e.clientX, sy = e.clientY;
        // FIX F1: base del drag con la stessa geometria misurata di overlayBox
        // (cellBox = rect reale della td, X e Y insieme; colX/rowY solo in jsdom)
        const b0 = cellBox(rg.c1, rg.r1);
        const x0 = b0.left, y0 = b0.top;
        let tc2 = rg.c2, tr2 = rg.r2;
        function calc(ev) {
            let c2 = rg.c2, r2 = rg.r2;
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (dx > 0) {
                let acc = 0;
                for (let c = rg.c2 + 1; c < COLS; c++) { acc += colWidth(c); c2 = c; if (acc >= dx) break; }
            }
            if (dy > 0) {
                let acc = 0;
                for (let r = rg.r2 + 1; r < ROWS; r++) { acc += rowHeight(r); r2 = r; if (acc >= dy) break; }
            }
            return { c2: c2, r2: r2 };
        }
        function onMove(ev) {
            const n = calc(ev);
            tc2 = n.c2; tr2 = n.r2;
            const nb = cellBox(tc2, tr2);
            st.previewEl.style.display = 'block';
            st.previewEl.style.left = x0 + 'px';
            st.previewEl.style.top = y0 + 'px';
            st.previewEl.style.width = (nb.right - x0) + 'px';
            st.previewEl.style.height = (nb.bottom - y0) + 'px';
        }
        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            st.previewEl.style.display = 'none';
            if (tc2 > rg.c2 || tr2 > rg.r2) {
                pushUndo();
                applyFill(rg, { c1: rg.c1, r1: rg.r1, c2: tc2, r2: tr2 });
                recalcAndPaint(); paintSelection(); scheduleSave();
            }
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }
    function copyCellProps(fromRef, toRef) {
        const from = st.data.cells[fromRef];
        const to = cellObj(toRef, true);
        ['b', 'c', 'bg', 'a', 'nf', 'bd', 'bde'].forEach(function (k) {
            if (from && from[k] != null) to[k] = from[k];
            else delete to[k];
        });
        cleanCell(toRef);
    }
    function applyFill(src, tgt) {
        const disp = computeAll();
        const sw = src.c2 - src.c1 + 1, sh = src.r2 - src.r1 + 1;
        let allNum = true;
        const vals = [];
        for (let r = src.r1; r <= src.r2 && allNum; r++) {
            for (let c = src.c1; c <= src.c2 && allNum; c++) {
                const ref = refAt(c, r);
                const s = Object.prototype.hasOwnProperty.call(disp, ref) ? String(disp[ref]) : '';
                const n = toNum(s);
                if (s === '' || isNaN(n)) { allNum = false; break; }
                vals.push(n);
            }
        }
        let mode = { kind: 'copy' };
        if (allNum && vals.length >= 2) {
            if (sw === 1 && sh >= 2) mode = { kind: 'serV', v0: vals[0], step: vals[1] - vals[0] };
            else if (sh === 1 && sw >= 2) mode = { kind: 'serH', v0: vals[0], step: vals[1] - vals[0] };
        }
        for (let r = tgt.r1; r <= tgt.r2; r++) {
            for (let c = tgt.c1; c <= tgt.c2; c++) {
                if (c >= src.c1 && c <= src.c2 && r >= src.r1 && r <= src.r2) continue;
                const ref = refAt(c, r);
                const existing = st.data.cells[ref];
                if (existing && (existing.mg || existing.ma)) continue;
                if (mode.kind === 'serV') {
                    if (r > src.r2) {
                        const n = mode.v0 + mode.step * (r - src.r1);
                        setCellInput(ref, String(Math.round(n * 1e10) / 1e10));
                        copyCellProps(refAt(src.c1, src.r1 + ((r - src.r1) % sh)), ref);
                    } else {
                        const sRef = refAt(src.c1 + ((c - src.c1) % sw), r);
                        setCellInput(ref, rawOf(sRef));
                        copyCellProps(sRef, ref);
                    }
                } else if (mode.kind === 'serH') {
                    if (c > src.c2) {
                        const n = mode.v0 + mode.step * (c - src.c1);
                        setCellInput(ref, String(Math.round(n * 1e10) / 1e10));
                        copyCellProps(refAt(src.c1 + ((c - src.c1) % sw), src.r1), ref);
                    } else {
                        const sRef = refAt(c, src.r1 + ((r - src.r1) % sh));
                        setCellInput(ref, rawOf(sRef));
                        copyCellProps(sRef, ref);
                    }
                } else {
                    const sRef = refAt(src.c1 + ((c - src.c1) % sw), src.r1 + ((r - src.r1) % sh));
                    setCellInput(ref, rawOf(sRef));
                    copyCellProps(sRef, ref);
                }
            }
        }
    }

    // ============================================================
    // RIDIMENSIONAMENTO COLONNE/RIGHE (3.3)
    // ============================================================
    function startResize(handle, e) {
        if (!st || !handle) return;
        const isCol = handle.classList.contains('fg-rh');
        const idx = parseInt(handle.getAttribute('data-idx'), 10);
        if (isNaN(idx)) return;
        const sx = e.clientX, sy = e.clientY;
        const start = isCol ? colWidth(idx) : rowHeight(idx);
        let changed = false;
        function onMove(ev) {
            if (isCol) {
                const w = Math.max(16, Math.round(start + (ev.clientX - sx)));
                if (w !== start) changed = true;
                st.data.colW[idx] = w;
                const cols = st.gridEl.querySelectorAll('colgroup col');
                if (cols[idx + 1]) cols[idx + 1].style.width = w + 'px';
                const th = st.gridEl.querySelector('th[data-c="' + idx + '"]');
                if (th) th.style.width = w + 'px';
                // FIX F1: durante il drag la tabella segue la nuova somma colgroup
                if (st.gridEl) {
                    let tw = 44;
                    for (let i = 0; i < COLS; i++) tw += colWidth(i);
                    st.gridEl.style.width = tw + 'px';
                }
            } else {
                const hgt = Math.max(16, Math.round(start + (ev.clientY - sy)));
                if (hgt !== start) changed = true;
                st.data.rowH[idx] = hgt;
                const tr = st.gridEl.querySelectorAll('tbody tr')[idx];
                if (tr) tr.style.height = hgt + 'px';
            }
            updateOverlays();
        }
        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            if (changed) { renderGrid(); recalcAndPaint(); paintSelection(); scheduleSave(); }
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }
    function measureCtx() {
        const cv = measureCtx.cv || (measureCtx.cv = document.createElement('canvas'));
        const ctx = cv.getContext('2d');
        let font = '13px sans-serif';
        try { if (st && st.gridEl) font = getComputedStyle(st.gridEl).font || font; } catch (err) { /* ok */ }
        ctx.font = font;
        return ctx;
    }
    function autoFitHandle(handle) {
        if (!handle) return;
        const idx = parseInt(handle.getAttribute('data-idx'), 10);
        if (isNaN(idx)) return;
        if (handle.classList.contains('fg-rh')) autoFitCol(idx);
        else autoFitRow(idx);
    }
    function autoFitCol(c) {
        if (!st || c < 0 || c >= COLS) return;
        const ctx = measureCtx();
        const disp = computeAll();
        let max = ctx.measureText(colName(c)).width;
        for (let r = 0; r < ROWS; r++) {
            const ref = refAt(c, r);
            if (Object.prototype.hasOwnProperty.call(disp, ref)) {
                const cell = st.data.cells[ref];
                const t = applyNf(cell && cell.nf, String(disp[ref]));
                if (t) { const w = ctx.measureText(t).width; if (w > max) max = w; }
            }
        }
        st.data.colW[c] = Math.max(16, Math.min(520, Math.ceil(max) + 16));
        renderGrid(); recalcAndPaint(); paintSelection(); scheduleSave();
    }
    function autoFitRow(r) {
        if (!st || r < 0 || r >= ROWS) return;
        delete st.data.rowH[r];
        renderGrid(); recalcAndPaint(); paintSelection(); scheduleSave();
    }

    // ============================================================
    // TAB FOGLI E MENU (3.4, 3.6)
    // ============================================================
    const TAB_COLORS = ['#f9974a', '#8ca4ff', '#7ed0a0', '#e6778c', '#c792ea', '#ffd98a', '#6fc3d7', '#aab5c7'];
    let openMenuEl = null, menuListener = null;
    function closeMenus() {
        if (menuListener) { document.removeEventListener('mousedown', menuListener, true); menuListener = null; }
        if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
    }
    function showMenu(x, y, build) {
        closeMenus();
        const m = App.el('div', 'fg-menu');
        build(m);
        document.body.appendChild(m);
        const w = m.offsetWidth, h = m.offsetHeight;
        m.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + 'px';
        m.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + 'px';
        openMenuEl = m;
        menuListener = function (ev) {
            if (!openMenuEl) return;
            if (ev.target === openMenuEl || openMenuEl.contains(ev.target)) return;
            closeMenus();
        };
        setTimeout(function () { if (openMenuEl === m) document.addEventListener('mousedown', menuListener, true); }, 0);
    }
    function openBorderMenu(btn) {
        const r = btn.getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, function (m) {
            const opts = [['Nessun bordo', 'none'], ['Bordo esterno', 'out'], ['Bordo completo', 'all']];
            opts.forEach(function (o) {
                const b = App.el('button', 'mi');
                b.type = 'button';
                b.textContent = o[0];
                b.title = 'Applica ai bordi: ' + o[0];
                b.addEventListener('click', function () { closeMenus(); applyBorders(o[1]); });
                m.appendChild(b);
            });
        });
    }
    function openTabMenu(i, x, y) {
        if (!st || !st.data.sheets[i]) return;
        showMenu(x, y, function (m) {
            const row = App.el('div', 'fg-menu-row');
            const lab = App.el('div', null, 'Colore scheda');
            lab.style.cssText = 'font-size:11.5px;color:var(--muted);width:100%';
            row.appendChild(lab);
            TAB_COLORS.forEach(function (col) {
                const b = App.el('button', 'fg-swatch');
                b.type = 'button';
                b.style.background = col;
                b.title = 'Colore scheda: ' + col;
                if (st.data.sheets[i].color === col) b.style.borderColor = '#fff';
                b.addEventListener('click', function () {
                    st.data.sheets[i].color = col;
                    closeMenus(); renderTabs(); scheduleSave();
                });
                row.appendChild(b);
            });
            m.appendChild(row);
            const nc = App.el('button', 'mi');
            nc.type = 'button';
            nc.textContent = 'Nessun colore';
            nc.addEventListener('click', function () {
                st.data.sheets[i].color = '';
                closeMenus(); renderTabs(); scheduleSave();
            });
            m.appendChild(nc);
            const del = App.el('button', 'mi danger');
            del.type = 'button';
            del.textContent = 'Elimina foglio';
            del.addEventListener('click', function () { closeMenus(); deleteSheet(i); });
            m.appendChild(del);
        });
    }
    function renderTabs() {
        if (!st || !st.tabsEl) return;
        const bar = st.tabsEl;
        bar.innerHTML = '';
        st.data.sheets.forEach(function (sheet, i) {
            const t = App.el('button', 'fg-tab' + (i === st.data.current ? ' on' : ''));
            t.type = 'button';
            t.title = 'Foglio ' + (i + 1) + ' — doppio click: rinomina, tasto destro: colore/elimina';
            t.innerHTML = (sheet.color ? '<i class="fg-tabdot" style="background:' + App.esc(sheet.color) + '"></i>' : '') + App.esc(sheet.name);
            t.addEventListener('click', function () { switchSheet(i); });
            t.addEventListener('dblclick', function () { renameSheet(i); });
            t.addEventListener('contextmenu', function (ev) {
                ev.preventDefault();
                openTabMenu(i, ev.clientX, ev.clientY);
            });
            bar.appendChild(t);
            const more = App.el('button', 'fg-tabmore');
            more.type = 'button';
            more.textContent = '▾';
            more.title = 'Colore ed eliminazione foglio';
            more.addEventListener('click', function (ev) {
                ev.stopPropagation();
                const rr = more.getBoundingClientRect();
                openTabMenu(i, rr.left, rr.bottom + 4);
            });
            bar.appendChild(more);
        });
        const add = App.el('button', 'fg-tabadd');
        add.type = 'button';
        add.innerHTML = PLUS;
        add.title = 'Aggiungi foglio (max 12)';
        add.addEventListener('click', addSheet);
        bar.appendChild(add);
        if (st.badgeEl) st.badgeEl.textContent = st.data.sheets.length + (st.data.sheets.length === 1 ? ' foglio' : ' fogli');
    }
    function renameSheet(i) {
        const sheet = st.data.sheets[i];
        if (!sheet) return;
        ask('Nome foglio', sheet.name).then(function (t) {
            if (t == null || !String(t).trim()) return;
            sheet.name = String(t).trim().slice(0, 24) || sheet.name;
            renderTabs(); scheduleSave();
        });
    }
    function switchSheet(i) {
        if (!st || i === st.data.current || !st.data.sheets[i]) return;
        if (st.editing) commitEdit();
        const cur = curSheet();
        if (cur) cur.sel = st.sel;
        st.data.current = i;
        bindSheet();
        st.range = null;
        st.sel = curSheet().sel || 'A1';
        if (!parseRef(st.sel)) st.sel = 'A1';
        renderGrid(); recalcAndPaint();
        paintSelection(); refreshFormula(); syncColorInputs();
        renderTabs(); updateFreezeBtn();
        scheduleSave();
    }
    function addSheet() {
        if (!st) return;
        if (st.data.sheets.length >= 12) { alert('Massimo 12 fogli per documento.'); return; }
        if (st.editing) commitEdit();
        const cur = curSheet();
        if (cur) cur.sel = st.sel;
        st.data.sheets.push({
            name: 'Foglio' + (st.data.sheets.length + 1),
            color: '', cells: {}, colW: {}, rowH: {},
            freeze: { c: 0, r: 0 }, sel: 'A1', fpSources: []
        });
        st.data.current = st.data.sheets.length - 1;
        bindSheet();
        st.range = null;
        st.sel = 'A1';
        renderGrid(); recalcAndPaint();
        paintSelection(); refreshFormula(); syncColorInputs();
        renderTabs(); updateFreezeBtn();
        scheduleSave();
    }
    function deleteSheet(i) {
        if (!st) return;
        if (st.data.sheets.length <= 1) { alert('Non puoi eliminare l’ultimo foglio.'); return; }
        const sheet = st.data.sheets[i];
        if (!sheet) return;
        if (!confirm('Eliminare il foglio "' + sheet.name + '"?')) return;
        if (st.editing) commitEdit();
        st.data.sheets.splice(i, 1);
        if (st.data.current >= st.data.sheets.length) st.data.current = st.data.sheets.length - 1;
        else if (st.data.current > i) st.data.current--;
        bindSheet();
        st.range = null;
        st.sel = curSheet().sel || 'A1';
        if (!parseRef(st.sel)) st.sel = 'A1';
        renderGrid(); recalcAndPaint();
        paintSelection(); refreshFormula(); syncColorInputs();
        renderTabs(); updateFreezeBtn();
        scheduleSave();
    }

    // ============================================================
    // FORMATI NUMERO (3.5) — solo visualizzazione, le formule usano il grezzo
    // ============================================================
    function applyNf(nf, text) {
        if (!nf || text == null || text === '') return text;
        const t = String(text);
        if (t.charAt(0) === '#' || t === 'TRUE' || t === 'FALSE') return t;
        const n = toNum(t);
        if (isNaN(n)) return t;
        try {
            if (nf === 'eur') {
                return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            if (nf === 'pct') {
                const p = Math.abs(n) < 1 ? n * 100 : n;
                return p.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%';
            }
            const m = /^dec:([0-6])$/.exec(nf);
            if (m) {
                const d = parseInt(m[1], 10);
                return n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
            }
        } catch (e) { /* formato non disponibile */ }
        return t;
    }
    function toggleNf(kind) {
        eachSel(function (ref) {
            const c = cellObj(ref, true);
            if (c.nf === kind) delete c.nf;
            else c.nf = kind;
            cleanCell(ref);
        });
        recalcAndPaint(); scheduleSave();
    }
    function changeDecimals(delta) {
        eachSel(function (ref) {
            const c = cellObj(ref, true);
            let n = null;
            const m = (c.nf && c.nf.indexOf('dec:') === 0) ? parseInt(c.nf.split(':')[1], 10) : NaN;
            if (!isNaN(m)) n = m + delta;
            else n = delta > 0 ? 2 : 0;
            if (n < 0) delete c.nf;
            else c.nf = 'dec:' + Math.max(0, Math.min(6, n));
            cleanCell(ref);
        });
        recalcAndPaint(); scheduleSave();
    }

    // ============================================================
    // UNIONI CELLE E BORDI (3.6)
    // ============================================================
    function forEachMg(cb) {
        Object.keys(st.data.cells).forEach(function (ref) {
            const cell = st.data.cells[ref];
            if (cell && cell.mg) {
                const p = parseRef(ref);
                if (p) cb(ref, cell, {
                    c1: p.c, r1: p.r,
                    c2: Math.min(COLS - 1, Math.max(p.c, cell.mg.c2 | 0)),
                    r2: Math.min(ROWS - 1, Math.max(p.r, cell.mg.r2 | 0))
                });
            }
        });
    }
    function rectsIntersect(a, b) {
        return !(a.c2 < b.c1 || b.c2 < a.c1 || a.r2 < b.r1 || b.r2 < a.r1);
    }
    function clearMergeAt(anchorRef, cell) {
        const p = parseRef(anchorRef);
        if (!p || !cell || !cell.mg) return;
        const c2 = Math.min(COLS - 1, Math.max(p.c, cell.mg.c2 | 0));
        const r2 = Math.min(ROWS - 1, Math.max(p.r, cell.mg.r2 | 0));
        delete cell.mg;
        for (let r = p.r; r <= r2; r++) {
            for (let c = p.c; c <= c2; c++) {
                const ref = refAt(c, r);
                const cel = st.data.cells[ref];
                if (cel) { delete cel.ma; cleanCell(ref); }
            }
        }
    }
    function mergeRange() {
        const rg = st.range;
        if (!rg || (rg.c1 === rg.c2 && rg.r1 === rg.r2)) {
            alert('Seleziona un’area di almeno 2 celle da unire.');
            return;
        }
        pushUndo();
        const existing = [];
        forEachMg(function (ref, cell, rect) { existing.push([ref, cell, rect]); });
        let clash = false;
        existing.forEach(function (x) {
            if (rectsIntersect(x[2], rg)) {
                const inside = x[2].c1 >= rg.c1 && x[2].c2 <= rg.c2 && x[2].r1 >= rg.r1 && x[2].r2 <= rg.r2;
                if (!inside) clash = true;
            }
        });
        if (clash) { alert('La selezione tocca altre celle unite: usa prima "Dividi".'); return; }
        existing.forEach(function (x) { clearMergeAt(x[0], x[1]); });
        const anchorRef = refAt(rg.c1, rg.r1);
        const anchor = cellObj(anchorRef, true);
        anchor.mg = { c2: rg.c2, r2: rg.r2 };
        for (let r = rg.r1; r <= rg.r2; r++) {
            for (let c = rg.c1; c <= rg.c2; c++) {
                const ref = refAt(c, r);
                if (ref === anchorRef) continue;
                const cel = cellObj(ref, true);
                delete cel.v; delete cel.f;
                cel.ma = 1;
                cleanCell(ref);
            }
        }
        st.sel = anchorRef;
        st.range = null;
        renderGrid(); recalcAndPaint(); paintSelection(); refreshFormula(); syncColorInputs(); scheduleSave();
    }
    function splitRange() {
        const rg = st.range || rangeRect();
        const existing = [];
        forEachMg(function (ref, cell, rect) { existing.push([ref, cell, rect]); });
        const hit = existing.filter(function (x) { return rectsIntersect(x[2], rg); });
        if (!hit.length) return;
        pushUndo();
        hit.forEach(function (x) { clearMergeAt(x[0], x[1]); });
        renderGrid(); recalcAndPaint(); paintSelection(); scheduleSave();
    }
    function applyBorders(mode) {
        eachSel(function (ref, c, r) {
            const cell = cellObj(ref, true);
            if (mode === 'none') { delete cell.bd; delete cell.bde; }
            else if (mode === 'all') { cell.bd = 'all'; delete cell.bde; }
            else {
                const rg = rangeRect();
                let s = '';
                if (r === rg.r1) s += 't';
                if (r === rg.r2) s += 'b';
                if (c === rg.c1) s += 'l';
                if (c === rg.c2) s += 'r';
                cell.bd = 'out';
                cell.bde = s;
            }
            cleanCell(ref);
        });
        recalcAndPaint(); scheduleSave();
    }

    // ============================================================
    // FREEZE PANES (3.7)
    // ============================================================
    function toggleFreeze() {
        if (!st) return;
        if (st.editing) commitEdit();
        if (!st.data.freeze) {
            const s = curSheet();
            if (s) { s.freeze = { c: 0, r: 0 }; st.data.freeze = s.freeze; }
            else st.data.freeze = { c: 0, r: 0 };
        }
        const fz = st.data.freeze;
        if (fz.c > 0 || fz.r > 0) { fz.c = 0; fz.r = 0; }
        else {
            const rg = rangeRect();
            fz.c = Math.max(0, Math.min(COLS, rg.c2 + 1));
            fz.r = Math.max(0, Math.min(ROWS, rg.r2 + 1));
        }
        renderGrid(); recalcAndPaint(); paintSelection(); updateFreezeBtn(); scheduleSave();
    }
    function updateFreezeBtn() {
        if (!st || !st.freezeBtn) return;
        const fz = st.data.freeze || { c: 0, r: 0 };
        const on = fz.c > 0 || fz.r > 0;
        st.freezeBtn.classList.toggle('active', !!on);
        st.freezeBtn.innerHTML = (on ? 'Sblocca' : 'Blocca') + I_DOWN;
        st.freezeBtn.title = on ? 'Sblocca righe e colonne (clic per il menu)' : 'Blocca righe/colonne sopra e a sinistra della selezione';
    }

    // ============================================================
    // AUTOCOMPLETE FUNZIONI (3.8)
    // ============================================================
    const FUNCS = [
        ['SUM', 'Somma i valori'],
        ['AVERAGE', 'Media aritmetica'],
        ['MIN', 'Valore minimo'],
        ['MAX', 'Valore massimo'],
        ['COUNT', 'Conta i numeri'],
        ['IF', 'Condizione se/allora'],
        ['CONCAT', 'Concatena testi'],
        ['TEXT', 'Valore come testo']
    ];
    let acEl = null, acInput = null, acList = [], acIdx = -1, acStart = -1;
    function acClose() {
        if (acEl) { acEl.remove(); acEl = null; }
        acList = []; acIdx = -1; acStart = -1;
        if (st) st.acOpen = false;
    }
    function acUpdate(input) {
        if (!st || !input) return;
        const v = input.value;
        const pos = input.selectionStart == null ? v.length : input.selectionStart;
        const before = v.slice(0, pos);
        const eq = before.lastIndexOf('=');
        if (eq < 0) { acClose(); return; }
        const tail = before.slice(eq + 1);
        if (/[^A-Za-z0-9_]/.test(tail)) { acClose(); return; }
        const token = tail.toUpperCase();
        const items = FUNCS.filter(function (f) { return f[0].indexOf(token) === 0; }).slice(0, 10);
        if (!items.length) { acClose(); return; }
        acInput = input;
        acList = items;
        acStart = eq + 1;
        acIdx = 0;
        renderAc();
    }
    function renderAc() {
        if (!acInput || !acList.length) { acClose(); return; }
        if (!acEl) {
            acEl = App.el('div', 'fg-ac');
            document.body.appendChild(acEl);
        }
        if (st) st.acOpen = true;
        acEl.innerHTML = '';
        acList.forEach(function (f, i) {
            const it = App.el('div', 'fg-ac-item' + (i === acIdx ? ' on' : ''));
            it.innerHTML = '<b>' + f[0] + '</b><span>' + App.esc(f[1]) + '</span>';
            it.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
            it.addEventListener('click', function () { acPick(i); });
            acEl.appendChild(it);
        });
        const r = acInput.getBoundingClientRect();
        acEl.style.left = (r.left + (window.pageXOffset || 0)) + 'px';
        acEl.style.top = (r.bottom + (window.pageYOffset || 0) + 3) + 'px';
    }
    function acHandleKey(input, e) {
        if (!st || !st.acOpen || !acEl || !acList.length) return false;
        if (e.key === 'ArrowDown') { e.preventDefault(); acIdx = (acIdx + 1) % acList.length; renderAc(); return true; }
        if (e.key === 'ArrowUp') { e.preventDefault(); acIdx = (acIdx - 1 + acList.length) % acList.length; renderAc(); return true; }
        if (e.key === 'Enter' || e.key === 'Tab') {
            if (acIdx >= 0 && acList[acIdx]) { e.preventDefault(); acPick(acIdx); return true; }
            return false;
        }
        if (e.key === 'Escape') { e.preventDefault(); acClose(); return true; }
        return false;
    }
    function acPick(i) {
        const item = acList[i];
        const input = acInput;
        if (!item || !input) { acClose(); return; }
        const v = input.value;
        const pos = input.selectionStart == null ? v.length : input.selectionStart;
        input.value = v.slice(0, acStart) + item[0] + '(' + v.slice(pos);
        const np = acStart + item[0].length + 1;
        input.selectionStart = input.selectionEnd = np;
        acClose();
        input.focus();
    }

    // ---------- icone e pulsanti barra ----------
    const I_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
    const I_REDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>';
    const I_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    const I_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

    function ib(html, title, extra) {
        const b = App.el('button', 'fg-ib' + (extra ? ' ' + extra : ''));
        b.type = 'button';
        b.innerHTML = html;
        b.title = title;
        return b;
    }

    // ---------- R21 B4: pannello Fonti (FontiPanel, contesto 'fogli') ----------
    // Mount SOLO in editor: bottone "Fonti" nella .fg-top, pannello laterale
    // (wrapper assoluto a destra, host reso position:relative al primo apri).
    // onInsert -> fpInsert: riferimento 'titolo (tipo)' (con emoji paperclip)
    // nella cella attiva (st.sel) con pushUndo() PRIMA; provenienza pushata in
    // curSheet().fpSources. DOVE VIVONO I METADATI: l'oggetto foglio corrente
    // dentro st.data.sheets[current] (content.sheets[i].fpSources), salvato da
    // flush() e preservato da normalizeSheet. snapState/applySnap includono
    // fpSources: l'undo ripristina insieme cella e provenienza.
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
        fpWrap = App.el('div', 'fg-fpwrap');
        fpWrap.style.cssText = 'position:absolute;top:0;right:0;bottom:0;z-index:45;display:flex;' +
            'flex-direction:column;align-items:flex-start;background:#151925;border-left:1px solid #2c3245;' +
            'box-shadow:-8px 0 24px rgba(0,0,0,.4);padding:8px;overflow:hidden;';
        fpPanel = window.FontiPanel.create({ contesto: 'fogli', onInsert: fpInsert });
        fpWrap.appendChild(fpPanel.el);
        if (host) host.appendChild(fpWrap);
        if (btn) btn.classList.add('on');
    }
    function fpLogSource(info) {
        const sh = curSheet();
        if (!sh) return;
        if (!Array.isArray(sh.fpSources)) sh.fpSources = [];
        sh.fpSources.push({
            tipo: String((info && info.tipo) || 'Fonte'),
            titolo: String((info && info.titolo) || ''),
            fonteId: (info && info.id != null) ? String(info.id) : '',
            ts: Date.now()
        });
    }
    function fpInsert(source, info) {
        if (!st || !curSheet()) return;
        if (st.editing) commitEdit();
        const ref = st.sel || 'A1';
        const titolo = String((info && info.titolo) || (source && source.title) || 'Fonte');
        const tipo = String((info && info.tipo) || 'Fonte');
        const label = '\uD83D\uDCCE ' + titolo + ' (' + tipo + ')';
        pushUndo();                       // snapshot PRIMA: celle + fpSources
        setCellInput(ref, label);         // riferimento nella cella attiva
        fpLogSource(info || { tipo: tipo, titolo: titolo, id: source && source.id });
        recalcAndPaint(); paintSelection(); refreshFormula(); scheduleSave();
    }

    // ---------- undo/redo celle (snapshot per foglio) ----------
    let clipText = '';
    function syncUndoBtns() {
        if (!st) return;
        if (st.undoBtn) st.undoBtn.disabled = !st.undo.length;
        if (st.redoBtn) st.redoBtn.disabled = !st.redo.length;
    }
    function snapState() {
        // R21 B4: lo snapshot include anche i metadati fonte del foglio
        // (curSheet().fpSources): l'undo toglie insieme ref in cella e provenienza.
        const sh = curSheet();
        const srcs = (sh && Array.isArray(sh.fpSources)) ? sh.fpSources : [];
        return { s: st.data.current, j: JSON.stringify(st.data.cells), f: JSON.stringify(srcs) };
    }
    // ---------- H11: AI cella (F07 spiega / F08 descrivi->formula) ----------
    function aiFogliFormula() {
        if (!st) return '';
        let f = '';
        try { f = rawOf(st.sel) || ''; } catch (e) { f = ''; }
        if (!f) f = (st.formula && st.formula.value) || '';
        return String(f || '');
    }
    async function aiFogliAction(fid, btn) {
        const AI = window.AIService;
        if (!AI || typeof AI.run !== 'function') {
            try { if (typeof notify === 'function') notify('AI non disponibile'); } catch (e) { /* ok */ }
            return;
        }
        const formula = aiFogliFormula();
        if (!formula) { AI.toast('Seleziona una cella con valore o formula'); return; }
        if (fid === 'F07') {
            const res = await AI.runFor(btn, 'F07', { formula: formula, ref: st ? st.sel : '', f: formula });
            if (!res || res.fallback) return;
            AI.showResult(res);
            return;
        }
        const inp = await AI.askInputs('Descrivi → formula', [
            { name: 'descrizione', label: 'Cosa deve calcolare la cella?', placeholder: 'es. somma dei voti da A1 ad A5' }
        ], 'Genera formula');
        if (!inp || !inp.descrizione) return;
        const res = await AI.runFor(btn, 'F08', { descrizione: inp.descrizione, ref: st ? st.sel : '', desc: inp.descrizione, list: 'SUM,AVERAGE,MIN,MAX,COUNT,IF,CONCAT,ROUND,ABS,SQRT,POWER' });
        if (!res || res.fallback) return;
        AI.showPreview(res, function (r) {
            let f = '';
            const d = r && r.data;
            if (typeof d === 'string') f = d;
            else if (d && typeof d === 'object') f = String(d.formula || d.value || d.result || AI.previewText(r) || '');
            f = String(f || '').trim();
            if (!f) return;
            if (f.charAt(0) !== '=') f = '=' + f;
            try {
                AI.registerUndo(pushUndo);
                AI.withUndo(function () {
                    setCellInput(st.sel, f);
                    recalcAndPaint();
                    paintSelection();
                    refreshFormula();
                    scheduleSave();
                });
            } catch (e) { AI.toast('Scrittura non riuscita'); }
        });
    }
    function pushUndo() {
        if (!st) return;
        st.undo.push(snapState());
        if (st.undo.length > 50) st.undo.shift();
        st.redo.length = 0;
        syncUndoBtns();
    }
    function replaceMap(map, obj) {
        if (!map) return;
        Object.keys(map).forEach(function (k) { delete map[k]; });
        Object.keys(obj).forEach(function (k) { map[k] = obj[k]; });
    }
    function applySnap(sp) {
        if (!st || !sp || sp.s !== st.data.current) return false;
        let cells = null;
        try { cells = JSON.parse(sp.j); } catch (e) { return false; }
        if (!cells || typeof cells !== 'object') return false;
        replaceMap(st.data.cells, cells);
        if (sp.f != null) {
            try { const sh = curSheet(); if (sh) sh.fpSources = JSON.parse(sp.f); } catch (e2) { /* snapshot illeggibile: si tiene l'attuale */ }
        }
        st.range = null;
        renderGrid(); recalcAndPaint(); paintSelection(); refreshFormula(); syncColorInputs(); scheduleSave();
        return true;
    }
    function doUndo() {
        if (!st) return;
        while (st.undo.length) {
            const sp = st.undo.pop();
            if (sp.s !== st.data.current) continue;
            const cur = snapState();
            if (applySnap(sp)) st.redo.push(cur);
            break;
        }
        syncUndoBtns();
    }
    function doRedo() {
        if (!st) return;
        while (st.redo.length) {
            const sp = st.redo.pop();
            if (sp.s !== st.data.current) continue;
            const cur = snapState();
            if (applySnap(sp)) st.undo.push(cur);
            break;
        }
        syncUndoBtns();
    }

    // ---------- clipboard: variabile interna + execCommand ----------
    function selectionToText() {
        const disp = computeAll();
        const rg = rangeRect();
        const lines = [];
        for (let r = rg.r1; r <= rg.r2; r++) {
            const line = [];
            for (let c = rg.c1; c <= rg.c2; c++) {
                const ref = refAt(c, r);
                let v = Object.prototype.hasOwnProperty.call(disp, ref) ? String(disp[ref]) : '';
                const cell = cellObj(ref, false);
                v = applyNf(cell && cell.nf, v);
                line.push(v);
            }
            lines.push(line.join('\t'));
        }
        return lines.join('\n');
    }
    function copySelection() {
        if (!st) return;
        clipText = selectionToText();
        try {
            const ta = document.createElement('textarea');
            ta.value = clipText;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e2) { /* la variabile interna resta valida */ }
            ta.remove();
        } catch (e) { /* la variabile interna clipText resta valida */ }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(clipText);
        } catch (e3) { /* ignora */ }
    }
    function pasteClip() {
        if (!st || !clipText) return;
        const p = parseRef(st.sel);
        if (!p) return;
        pushUndo();
        const lines = clipText.split(/\r\n|\n|\r/);
        let maxCols = 1;
        lines.forEach(function (line, ri) {
            const r = p.r + ri;
            const parts = line.split('\t');
            if (parts.length > maxCols) maxCols = parts.length;
            if (r >= ROWS) return;
            parts.forEach(function (v, ci) {
                const c = p.c + ci;
                if (c >= COLS) return;
                setCellInput(refAt(c, r), v);
            });
        });
        const lastR = Math.min(ROWS - 1, p.r + lines.length - 1);
        const lastC = Math.min(COLS - 1, p.c + maxCols - 1);
        setRange(p.c, p.r, lastC, lastR);
        recalcAndPaint(); paintSelection(); refreshFormula(); syncColorInputs(); scheduleSave();
    }
    function clearSelCells() {
        eachSel(function (ref) {
            const c = cellObj(ref, false);
            if (c) { delete c.v; delete c.f; cleanCell(ref); }
        });
        recalcAndPaint(); refreshFormula(); scheduleSave();
    }

    // ---------- inserisci/elimina righe e colonne (3E) ----------
    function rebuildMergeMarks() {
        const cells = st.data.cells;
        Object.keys(cells).forEach(function (k) { if (cells[k]) delete cells[k].ma; });
        Object.keys(cells).forEach(function (k) {
            const cell = cells[k];
            if (!cell || !cell.mg) return;
            const p = parseRef(k);
            if (!p) { delete cell.mg; return; }
            const c2 = Math.min(COLS - 1, Math.max(p.c, cell.mg.c2 | 0));
            const r2 = Math.min(ROWS - 1, Math.max(p.r, cell.mg.r2 | 0));
            if (c2 === p.c && r2 === p.r) { delete cell.mg; return; }
            cell.mg = { c2: c2, r2: r2 };
            for (let r = p.r; r <= r2; r++) {
                for (let c = p.c; c <= c2; c++) {
                    if (r === p.r && c === p.c) continue;
                    const ref = refAt(c, r);
                    if (!cells[ref]) cells[ref] = {};
                    cells[ref].ma = 1;
                }
            }
        });
    }
    function afterStructural() {
        rebuildMergeMarks();
        if (!parseRef(st.sel)) st.sel = 'A1';
        renderGrid(); recalcAndPaint(); paintSelection(); refreshFormula(); syncColorInputs(); scheduleSave();
    }
    function shiftMap(map, idx, dir) {
        if (!map) return;
        const lim = (map === st.data.rowH) ? ROWS : COLS;
        const out = {};
        Object.keys(map).forEach(function (k) {
            const i = +k;
            if (isNaN(i)) return;
            const ni = i >= idx ? i + dir : i;
            if (ni >= 0 && ni < lim) out[ni] = map[k];
        });
        replaceMap(map, out);
    }
    function insertRowAt(r) {
        if (!st || isNaN(r) || r < 0 || r >= ROWS) return;
        pushUndo();
        const nc = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const p = parseRef(ref);
            if (!p) return;
            const cell = st.data.cells[ref];
            const nr = p.r >= r ? p.r + 1 : p.r;
            if (nr >= ROWS) return;
            if (cell && cell.mg) cell.mg = { c2: cell.mg.c2 | 0, r2: Math.min(ROWS - 1, (cell.mg.r2 | 0) + 1) };
            nc[refAt(p.c, nr)] = cell;
        });
        replaceMap(st.data.cells, nc);
        shiftMap(st.data.rowH, r, 1);
        afterStructural();
    }
    function deleteRowAt(r) {
        if (!st || isNaN(r) || r < 0 || r >= ROWS) return;
        pushUndo();
        const nc = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const p = parseRef(ref);
            if (!p || p.r === r) return;
            const cell = st.data.cells[ref];
            const nr = p.r > r ? p.r - 1 : p.r;
            if (cell && cell.mg) {
                const r2 = (cell.mg.r2 | 0) - (r <= (cell.mg.r2 | 0) ? 1 : 0);
                if (r2 > p.r) cell.mg = { c2: cell.mg.c2 | 0, r2: r2 };
                else delete cell.mg;
            }
            nc[refAt(p.c, nr)] = cell;
        });
        replaceMap(st.data.cells, nc);
        shiftMap(st.data.rowH, r, -1);
        afterStructural();
    }
    function insertColAt(c) {
        if (!st || isNaN(c) || c < 0 || c >= COLS) return;
        pushUndo();
        const nc = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const p = parseRef(ref);
            if (!p) return;
            const cell = st.data.cells[ref];
            const nxc = p.c >= c ? p.c + 1 : p.c;
            if (nxc >= COLS) return;
            if (cell && cell.mg) cell.mg = { c2: Math.min(COLS - 1, (cell.mg.c2 | 0) + 1), r2: cell.mg.r2 | 0 };
            nc[refAt(nxc, p.r)] = cell;
        });
        replaceMap(st.data.cells, nc);
        shiftMap(st.data.colW, c, 1);
        afterStructural();
    }
    function deleteColAt(c) {
        if (!st || isNaN(c) || c < 0 || c >= COLS) return;
        pushUndo();
        const nc = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const p = parseRef(ref);
            if (!p || p.c === c) return;
            const cell = st.data.cells[ref];
            const nxc = p.c > c ? p.c - 1 : p.c;
            if (cell && cell.mg) {
                const c2 = (cell.mg.c2 | 0) - (c <= (cell.mg.c2 | 0) ? 1 : 0);
                if (c2 > p.c) cell.mg = { c2: c2, r2: cell.mg.r2 | 0 };
                else delete cell.mg;
            }
            nc[refAt(nxc, p.r)] = cell;
        });
        replaceMap(st.data.cells, nc);
        shiftMap(st.data.colW, c, -1);
        afterStructural();
    }

    // ---------- menu celle, export, blocca, "…", scorciatoie ----------
    function openCellMenu(x, y) {
        if (!st) return;
        const p = parseRef(st.sel);
        if (!p) return;
        showMenu(x, y, function (m) {
            const defs = [
                ['Inserisci riga sopra', function () { insertRowAt(p.r); }],
                ['Inserisci riga sotto', function () { insertRowAt(p.r + 1); }],
                ['Inserisci colonna a sinistra', function () { insertColAt(p.c); }],
                ['Inserisci colonna a destra', function () { insertColAt(p.c + 1); }],
                ['-', null],
                ['Elimina riga', function () { deleteRowAt(p.r); }],
                ['Elimina colonna', function () { deleteColAt(p.c); }],
                ['-', null],
                ['Copia', function () { copySelection(); }],
                ['Incolla', function () { pasteClip(); }],
                ['Cancella contenuto', function () { pushUndo(); clearSelCells(); }]
            ];
            defs.forEach(function (d) {
                if (d[0] === '-') { m.appendChild(App.el('div', 'fg-menu-sep')); return; }
                const b = App.el('button', 'mi');
                b.type = 'button';
                b.textContent = d[0];
                b.addEventListener('click', function () { closeMenus(); d[1](); });
                m.appendChild(b);
            });
        });
    }
    function openExportMenu(btn) {
        const r = btn.getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, function (m) {
            const b1 = App.el('button', 'mi');
            b1.type = 'button';
            b1.textContent = 'Importa CSV';
            b1.title = 'Importa un file CSV nella griglia (sovrascrive le celle)';
            b1.addEventListener('click', function () { closeMenus(); importCsv(); });
            m.appendChild(b1);
            const b2 = App.el('button', 'mi');
            b2.type = 'button';
            b2.textContent = 'Esporta CSV';
            b2.title = 'Scarica i dati della griglia come CSV';
            b2.addEventListener('click', function () { closeMenus(); exportCsv(); });
            m.appendChild(b2);
        });
    }
    function openFreezeMenu(btn) {
        const fz = (st && st.data.freeze) || { c: 0, r: 0 };
        const on = fz.c > 0 || fz.r > 0;
        const r = btn.getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, function (m) {
            const b = App.el('button', 'mi');
            b.type = 'button';
            b.textContent = on ? 'Sblocca righe e colonne' : 'Blocca fino alla selezione';
            b.addEventListener('click', function () { closeMenus(); toggleFreeze(); });
            m.appendChild(b);
        });
    }
    function openMoreMenu(btn) {
        const r = btn.getBoundingClientRect();
        showMenu(Math.max(4, r.right - 170), r.bottom + 4, function (m) {
            const b1 = App.el('button', 'mi');
            b1.type = 'button';
            b1.textContent = 'Dividi celle unite';
            b1.addEventListener('click', function () { closeMenus(); splitRange(); });
            m.appendChild(b1);
            const b2 = App.el('button', 'mi');
            b2.type = 'button';
            b2.textContent = 'Rinomina foglio';
            b2.addEventListener('click', function () { closeMenus(); renameDoc(); });
            m.appendChild(b2);
        });
    }
    // BLOCCO 5.5: documentazione Formule (popover dalla toolbar)
    function openFormuleHelp(btn) {
        const r = btn.getBoundingClientRect();
        showMenu(Math.max(4, r.left - 80), Math.max(4, r.bottom + 6), function (m) {
            m.classList.add('pop');
            m.classList.add('fg-formulepop');
            m.appendChild(App.el('div', 'fg-pop-title', 'Formule'));
            const rule = App.el('div', 'fg-pop-item');
            rule.innerHTML = 'Ogni formula inizia con <b>=</b> (es. <b>=2+2</b> → 4): senza il prefisso il contenuto è un valore. ' +
                'Argomenti separati da <b>;</b> oppure <b>,</b>.';
            m.appendChild(rule);
            const table = App.el('table', 'fg-fn-table');
            let th = '<thead><tr><th>Funzione</th><th>Sintassi</th><th>Esempio</th></tr></thead><tbody>';
            [
                ['SUM', 'SUM(intervalli…)', '=SUM(A1:A5)'],
                ['AVERAGE', 'AVERAGE(intervalli…)', '=AVERAGE(A1:A3)'],
                ['MIN', 'MIN(intervalli…)', '=MIN(A1:A5)'],
                ['MAX', 'MAX(intervalli…)', '=MAX(A1:A5)'],
                ['COUNT', 'COUNT(intervalli…)', '=COUNT(A1:A5)'],
                ['COUNTA', 'COUNTA(intervalli…)', '=COUNTA(A1:A5)'],
                ['IF', 'IF(cond;allora;altrimenti)', '=IF(A1>=6,"sì","no")'],
                ['AND', 'AND(b1;b2;…)', '=AND(A1>0;B1>0)'],
                ['OR', 'OR(b1;b2;…)', '=OR(A1>0;B1>0)'],
                ['NOT', 'NOT(b)', '=NOT(A1>0)'],
                ['CONCAT', 'CONCAT(testi…)', '=CONCAT("Ana";"li")'],
                ['ABS', 'ABS(x)', '=ABS(-5)'],
                ['ROUND', 'ROUND(x;n)', '=ROUND(3.14;2)'],
                ['SQRT', 'SQRT(x)', '=SQRT(9)'],
                ['POWER', 'POWER(a;b)', '=POWER(2;10)']
            ].forEach(function (row) {
                th += '<tr><td><code>' + row[0] + '</code></td><td><code>' + App.esc(row[1]) +
                    '</code></td><td><code>' + App.esc(row[2]) + '</code></td></tr>';
            });
            th += '</tbody>';
            table.innerHTML = th;
            m.appendChild(table);
            const ex = App.el('div', 'fg-pop-item');
            ex.innerHTML = '<b>Esempi pratici:</b> <code>=2+2</code> → 4 · <code>=SUM(A1:A5)</code> · ' +
                '<code>=IF(A1&gt;=6,"sì","no")</code>';
            m.appendChild(ex);
            const ops = App.el('div', 'fg-pop-item');
            ops.innerHTML = '<b>Operatori:</b> + − * / ^ e confronti = &lt;&gt; &lt; &gt; &lt;= &gt;=; booleani TRUE/FALSE.';
            m.appendChild(ops);
            const errs = App.el('div', 'fg-pop-item');
            errs.innerHTML = '<b>Errori:</b> #CIRC! ciclo · #DIV/0! divisione per zero · #REF! riferimento inesistente · ' +
                '#NAME? funzione ignota · #ERR! sintassi errata.';
            m.appendChild(errs);
            // larghezza/max-height/wrap gestiti da CSS (.fg-menu.fg-formulepop)
        });
    }
    function openHelpPop(btn) {
        const r = btn.getBoundingClientRect();
        showMenu(Math.max(4, r.left - 250), Math.max(4, r.top - 12), function (m) {
            m.classList.add('pop');
            m.appendChild(App.el('div', 'fg-pop-title', 'Scorciatoie'));
            [
                'Click: seleziona · Shift+click: intervallo',
                'Digitazione o F2: modifica · Invio: conferma',
                'Canc: cancella celle · Frecce: sposta',
                'Ctrl+Z / Ctrl+Y: annulla / ripeti',
                'Ctrl+C / Ctrl+V: copia / incolla',
                'Tasto destro: righe, colonne e appunti',
                'Doppio click intestazioni: adatta al contenuto',
                'Doppio click sul tab: rinomina foglio'
            ].forEach(function (s) {
                m.appendChild(App.el('div', 'fg-pop-item', App.esc(s)));
            });
        });
    }
    function renameDoc() {
        if (!st) return;
        ask('Titolo foglio', st.title).then(function (t) {
            if (t == null || !String(t).trim()) return;
            st.title = String(t).trim();
            if (st.titleEl) st.titleEl.textContent = st.title;
            StudyStore.renameItem(st.id, st.title);
            scheduleSave();
        });
    }

    // ---------- status bar: aggregati della selezione ----------
    function updateStatusBar() {
        if (!st || !st.statusEl) return;
        const disp = computeAll();
        let count = 0;
        const nums = [];
        eachSel(function (ref) {
            count++;
            if (!Object.prototype.hasOwnProperty.call(disp, ref)) return;
            const raw = String(disp[ref] == null ? '' : disp[ref]).trim();
            if (raw === '') return;
            const n = toNum(raw);
            if (!isNaN(n)) nums.push(n);
        });
        if (nums.length) {
            const sum = nums.reduce(function (a, b) { return a + b; }, 0);
            const avg = sum / nums.length;
            const f = function (n) { return (Math.round(n * 1e6) / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 }); };
            st.statusEl.textContent = 'Somma ' + f(sum) + '  ·  Media ' + f(avg) + '  ·  Conteggio ' + nums.length;
        } else {
            st.statusEl.textContent = count + (count === 1 ? ' cella selezionata' : ' celle selezionate');
        }
    }

        // ---------- registrazione ----------
    window.StudyTools = window.StudyTools || {};
    window.StudyTools['fogli'] = {
        title: 'Fogli di calcolo',
        icon: ICON,
        desc: 'Griglia A-Z × 60 con formule (SUM, IF, …), formati, CSV in/out.',
        kinds: ['foglio'],
        render: function (container, params) {
            root = container;
            params = params || {};
            if (params.open) return openEditor(container, params.open);
            return showList(container);
        },
        close: function () {
            if (st && st.editing) commitEdit();
            acClose();
            closeMenus();
            detachKeys();
            fpClose();               // R21 B4: pannello Fonti chiuso con l'uscita
            if (root) root.style.padding = '';
            flush();
        }
    };
})();
