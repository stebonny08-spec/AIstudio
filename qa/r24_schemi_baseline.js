/* ============================================================
   modules/schemi.js — modulo "Schemi" della suite Studio.
   - Griglia schemi con ricerca e filtro materia
   - Scelta tipo (albero, mappa concettuale, L→R, libero,
     riassunto visuale)
   - Editor SVG: nodi trascinabili/ridimensionabili, collegamenti
     con frecce, auto-layout, zoom/pan, pannelli Riassunto e Fonti
   - Salvataggio automatico (debounce ~900ms) + close()
   Nessuna dipendenza esterna: solo file locali.
   ============================================================ */
(function () {
    'use strict';

    // ---------- costanti ----------
    const TYPES = [
        { id: 'albero', label: 'Albero' },
        { id: 'mappa', label: 'Mappa concettuale' },
        { id: 'lr', label: 'Sinistra \u2192 destra' },
        { id: 'libero', label: 'Schema libero' },
        { id: 'riassunto', label: 'Riassunto visuale' }
    ];
    const TYPE_LABELS = {};
    TYPES.forEach(t => { TYPE_LABELS[t.id] = t.label; });

    const NODE_COLOR = '#242c40';
    const NODE_BORDER = '#4a5980';
    const EDGE_COLOR = '#8ca4ff';
    const KIND_LABELS = { note: 'Nota', riassunto: 'Riassunto', documento: 'Documento' };

    // ---------- CSS aggiuntivo ----------
    App.style(
        '.sc-editor{display:flex;flex-direction:column;height:100%;min-height:0;}' +
        '.sc-top{display:flex;gap:9px;flex-wrap:wrap;align-items:center;padding:4px 0 8px;}' +
        '.sc-title{background:var(--dark);border:1px solid var(--border);border-radius:9px;padding:7px 10px;' +
        'color:var(--text);font-size:14px;font-weight:700;min-width:170px;outline:none;font-family:inherit;}' +
        '.sc-title:focus{border-color:var(--accent);}' +
        '.sc-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:2px 0 8px;}' +
        '.sc-main{flex:1;min-height:0;display:flex;gap:12px;}' +
        '.sc-stage{position:relative;flex:1;min-width:0;background:var(--card);border:1px solid var(--border);' +
        'border-radius:12px;overflow:hidden;}' +
        '.sc-stage svg{display:block;width:100%;height:100%;touch-action:none;cursor:default;}' +
        '.sc-stage textarea{position:absolute;background:rgba(255,255,255,.97);border:1.5px dashed #f9974a;' +
        'border-radius:8px;padding:6px 8px;outline:none;color:#141824;line-height:1.35;resize:none;' +
        'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;z-index:3;}' +
        '.sc-zoom{position:absolute;right:10px;bottom:10px;background:rgba(14,19,32,.88);border:1px solid var(--border);' +
        'color:var(--muted);font-size:11.5px;padding:3px 9px;border-radius:8px;pointer-events:none;}' +
        '.sc-side{width:300px;flex-shrink:0;display:flex;flex-direction:column;background:var(--card);' +
        'border:1px solid var(--border);border-radius:12px;overflow:hidden;}' +
        '.sc-side.hidden{display:none;}' +
        '.sc-side-head{display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid var(--border);}' +
        '.sc-tab{flex:1;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--muted);' +
        'font-size:13px;font-weight:700;padding:7px 4px;cursor:pointer;font-family:inherit;}' +
        '.sc-tab.active{color:var(--text);border-bottom-color:var(--accent);}' +
        '.sc-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:9px;padding:11px;}' +
        '.sc-body textarea{flex:1;min-height:110px;resize:none;background:var(--dark);border:1px solid var(--border);' +
        'border-radius:10px;color:var(--text);padding:10px;font-family:inherit;font-size:13.5px;outline:none;' +
        'line-height:1.5;}' +
        '.sc-body textarea:focus{border-color:var(--accent);}' +
        '.sc-note{font-size:12px;color:var(--muted);line-height:1.55;}' +
        '.sc-cswatch{width:30px;height:30px;padding:2px;border:1px solid var(--border);border-radius:8px;' +
        'background:var(--panel-2);cursor:pointer;}' +
        '.sc-thumb-ph{height:88px;display:flex;align-items:center;justify-content:center;background:var(--dark);' +
        'border:1px dashed var(--border);border-radius:8px;color:var(--muted);margin-bottom:9px;}' +
        '.sc-thumb-ph svg{width:28px;height:28px;opacity:.5;}' +
        '.sc-drawopts{display:none;align-items:center;gap:9px;background:var(--dark);border:1px solid var(--border);border-radius:9px;padding:5px 10px;}' +
        '.sc-drawopts.on{display:flex;}' +
        '.sc-drawopts label{font-size:11.5px;color:var(--muted);font-weight:700;}' +
        '.sc-drawopts input[type=range]{width:110px;accent-color:#f9974a;}' +
        '.sc-drawopts .sc-dval{font-size:11.5px;color:var(--text);min-width:32px;text-align:center;}' +
        '.sc-style-row{display:flex;align-items:center;justify-content:space-between;gap:9px;}' +
        '.sc-style-row>label{font-size:12px;color:var(--muted);font-weight:700;flex:1;}' +
        '.sc-style-row select{background:var(--dark);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:6px 7px;font-size:13px;font-family:inherit;outline:none;max-width:160px;}' +
        '.sc-style-row select:focus{border-color:var(--accent);}' +
        '.sc-style-row input[type=color]{width:46px;height:30px;padding:2px;border:1px solid var(--border);border-radius:8px;background:var(--panel-2);cursor:pointer;}' +
        '.sc-style-row input[type=checkbox]{width:17px;height:17px;accent-color:#f9974a;cursor:pointer;}' +
        '.sc-tools .tool-btn.active{background:rgba(249,151,74,.16);border-color:#f9974a;color:#f9974a;}' +
        '.sc-top .subject-input{flex-direction:row;align-items:center;gap:0;flex:0 0 auto;}' +
        '.sc-top .subject-input>label{display:none;}' +
        '.sc-top .subject-field{min-width:170px;height:33px;padding:7px 10px;font-size:14px;letter-spacing:.4px;}' +
        '.sc-top .subject-field:focus{border-color:var(--accent);}' +
        '.sc-type-sel{background:var(--dark);border:1px solid var(--border);border-radius:9px;color:var(--text);padding:6px 8px;font-size:13px;font-weight:700;font-family:inherit;outline:none;cursor:pointer;}' +
        '.sc-type-sel:focus{border-color:var(--accent);}' +
        '.sc-btnwrap{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
        '.sc-tools .tool-btn:disabled{opacity:.42;cursor:not-allowed;filter:saturate(.45);}' +
        '.sc-tools select.mini{background:var(--dark);border:1px solid var(--border);border-radius:9px;' +
        'color:var(--text);padding:6px 8px;font-size:13px;font-weight:700;font-family:inherit;outline:none;}' +
        '.sc-toast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%) translateY(12px);' +
        'background:#161a2a;color:#f5f7fa;border:1px solid #f9974a;border-radius:9px;padding:10px 16px;' +
        'font-size:13.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.45);z-index:90;opacity:0;' +
        'transition:opacity .18s ease, transform .18s ease;pointer-events:none;' +
        'max-width:min(560px,86vw);text-align:center;line-height:1.45;}' +
        '.sc-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}'
    );

    /* ===== R22 - BLOCCO 5.1: FontiPanel nel tab Fonti = IN FLUSSO, mai float =====
       In index.html notes/documenti/presentazioni iniettano CSS GLOBALE su
       .fp21-root (notes: position:absolute + display:none/show; documenti e
       presentazioni: position:fixed;top:58px;right:14px;z-index:160): senza un
       override scoped QUI, il pannello montato da mountFontiPanel dentro
       .sc-side diventerebbe un overlay flottante sopra il canvas degli Schemi.
       Selettore con specificita piu alta (0,2,0 / 0,3,0) limitato al pannello
       destro: dentro il tab il componente resta nel flusso della .sc-body e usa
       la shell R21 del componente condiviso (regole copiate scoped, non
       reimplementate: servono anche agli harness che caricano solo
       fonti_panel + schemi, es. qa_ui/schemi.html, dove nessun altro modulo
       inietta gli stili fp21). Il solo .fp21-root non scoped e' bandito qui. */
    App.style(
        '.sc-side .fp21-root{position:relative;left:auto;top:auto;right:auto;bottom:auto;' +
        'z-index:auto;display:flex;flex-direction:column;gap:6px;min-width:0;' +
        'width:100%;max-height:100%;box-sizing:border-box;overflow:hidden;padding:8px;' +
        'background:#161a2a;border:1px solid rgba(255,255,255,.14);border-radius:12px;' +
        'color:#cfd6e4;font:12px/1.45 system-ui,sans-serif;}' +
        '.sc-side .fp21-root .fp21-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
        '.sc-side .fp21-root .fp21-lens{flex:0 0 auto;width:26px;height:26px;border-radius:50%;' +
        'border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#cfd6e4;' +
        'display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}' +
        '.sc-side .fp21-root .fp21-chips{display:flex;gap:4px;flex-wrap:wrap;min-width:0}' +
        '.sc-side .fp21-root .fp21-chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);' +
        'color:#aeb8c9;border-radius:999px;padding:2px 8px;font-size:10.5px;cursor:pointer;}' +
        '.sc-side .fp21-root .fp21-chip.active{background:#5b7cfa;border-color:#5b7cfa;color:#fff}' +
        '.sc-side .fp21-root .fp21-search{box-sizing:border-box;width:100%;padding:6px 8px;' +
        'border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.3);' +
        'color:#e6ebf5;font-size:12px;}' +
        '.sc-side .fp21-root .fp21-list{flex:1 1 auto;min-height:48px;overflow:auto;' +
        'display:flex;flex-direction:column;gap:4px;}' +
        '.sc-side .fp21-root .fp21-item{display:flex;align-items:center;gap:6px;width:100%;' +
        'text-align:left;cursor:pointer;padding:6px 8px;border-radius:8px;' +
        'border:1px solid transparent;background:rgba(255,255,255,.05);color:#dfe6f2;font-size:11.5px;}' +
        '.sc-side .fp21-root .fp21-item.active{border-color:#5b7cfa;background:rgba(91,124,250,.18)}' +
        '.sc-side .fp21-root .fp21-badge{flex:0 0 auto;font-size:9.5px;padding:1px 6px;' +
        'border-radius:999px;background:rgba(91,124,250,.22);color:#a9b8ff}' +
        '.sc-side .fp21-root .fp21-ititle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        '.sc-side .fp21-root .fp21-hint{color:#8b95a5;padding:6px 4px;}' +
        '.sc-side .fp21-root .fp21-preview{flex:0 0 auto;max-height:40%;overflow:auto;' +
        'background:rgba(0,0,0,.28);border-radius:8px;padding:6px 8px;}' +
        '.sc-side .fp21-root .fp21-ptitle{font-weight:700;font-size:11.5px;display:flex;' +
        'align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;}' +
        '.sc-side .fp21-root .fp21-pbody{font-size:11.5px;line-height:1.45;}' +
        '.sc-side .fp21-root .fp21-pbody p{margin:4px 0;}' +
        '.sc-side .fp21-root .fp21-pbody img{max-width:100%;border-radius:6px;}' +
        '.sc-side .fp21-root .fp21-pbody table.fp21-table{border-collapse:collapse;width:100%;}' +
        '.sc-side .fp21-root .fp21-pbody td,.sc-side .fp21-root .fp21-pbody th{' +
        'border:1px solid #44506a;padding:3px 5px;}' +
        '.sc-side .fp21-root .fp21-pbody pre.fp21-pre{overflow:auto;background:rgba(0,0,0,.4);' +
        'border-radius:6px;padding:6px;}' +
        '.sc-side .fp21-root .fp21-mathfb{display:inline-flex;gap:5px;align-items:baseline;flex-wrap:wrap;}' +
        '.sc-side .fp21-root .fp21-mathfb code{font-size:12px;background:#202637;border-radius:4px;padding:1px 4px;}' +
        '.sc-side .fp21-root .fp21-insert{margin-top:2px;padding:8px 10px;border-radius:9px;border:0;' +
        'background:#5b7cfa;color:#fff;font-weight:700;font-size:12px;cursor:pointer;}' +
        '.sc-side .fp21-root .fp21-insert:disabled{opacity:.45;cursor:not-allowed;}' +
        '.sc-side .fp21-root .fp21-rz{position:absolute;background:transparent;}' +
        '.sc-side .fp21-root .fp21-rz-r{top:0;right:0;width:7px;height:100%;cursor:ew-resize;}' +
        '.sc-side .fp21-root .fp21-rz-b{left:0;bottom:0;width:100%;height:7px;cursor:ns-resize;}' +
        '.sc-side .fp21-root .fp21-rz-c{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;}'
    );

    // ---------- stato modulo ----------
    let container = null;
    let ed = null;
    // BLOCCO 3.3: doc legacy "Alto -> basso" (id reale 'tb', alias 'alto-basso') appena
    // migrato a 'albero' che deve eseguire l'auto-layout al primo caricamento.
    // E' solo una variabile di modulo: buildPayload NON la persiste nel contenuto.
    let pendingLegacyLayout = false;

    // ---------- strategia corrente + toast ----------
    function strat() {
        if (ed && ed.strategy) return ed.strategy;
        if (typeof SchemaStrategies !== 'undefined') return SchemaStrategies.getStrategy('libero');
        return null;
    }

    let toastEl = null, toastT = null;
    function toast(msg) {
        if (toastEl) { toastEl.remove(); toastEl = null; }
        if (toastT) { clearTimeout(toastT); toastT = null; }
        toastEl = App.el('div', 'sc-toast', App.esc(String(msg || '')));
        document.body.appendChild(toastEl);
        const el = toastEl;
        requestAnimationFrame(() => { if (el === toastEl) el.classList.add('show'); });
        toastT = setTimeout(() => {
            if (toastEl === el) { el.remove(); toastEl = null; }
            toastT = null;
        }, 3600);
    }

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
            if (d && Array.isArray(d.nodes)) return normalizeDoc(d);
        } catch (e) { /* contenuto non valido */ }
        return null;
    }

    // ---------- normalizzazione documento (retrocompatibilita') ----------
    const FONT_SIZES = [12, 14, 16, 18, 22];
    const SHAPES = ['round', 'rect', 'ellipse', 'pill'];

    /* Posizione di riparazione per nodi senza x/y valide (BLOCCO 2.2b):
       griglia deterministica a partire dal bounding box degli altri nodi,
       con controllo collisioni. Nessun NaN entra mai nel documento. */
    function backfillSpot(nodes, n) {
        const w = isFinite(n.w) ? n.w : 170, h = isFinite(n.h) ? n.h : 60;
        let hint = { x: 140, y: 140 };
        const others = (nodes || []).filter(m => m !== n &&
            isFinite(m.x) && isFinite(m.y) && isFinite(m.w) && isFinite(m.h));
        if (others.length) {
            hint.x = others.reduce((mx, m) => Math.max(mx, m.x + m.w), -Infinity) + 70;
            hint.y = Math.round(others.reduce((s, m) => s + m.y + m.h / 2, 0) / others.length - h / 2);
        }
        let x = Math.round(isFinite(hint.x) ? hint.x : 140);
        let y = Math.round(isFinite(hint.y) ? hint.y : 140);
        const hx = x, hy = y;
        let guard = 0;
        const hit = () => others.some(m =>
            !(x + w + 8 <= m.x || m.x + m.w + 8 <= x || y + h + 8 <= m.y || m.y + m.h + 8 <= y));
        while (hit() && guard++ < 48) {
            x += 60;
            if (guard % 7 === 0) { x = hx; y += 110; }
        }
        return { x: x, y: y };
    }

    function normalizeDoc(d) {
        if (!d || !Array.isArray(d.nodes)) return d;
        if (typeof d.type !== 'string' || !d.type) d.type = 'libero';
        if (!Array.isArray(d.edges)) d.edges = [];
        if (!Array.isArray(d.drawings)) d.drawings = [];
        d.drawings = d.drawings.filter(x => x && x.t === 'stroke' && Array.isArray(x.pts) && x.pts.length > 1);
        d.drawings.forEach(x => {
            if (!x.id) x.id = uuid();
            x.color = validHex(x.color, '#f9974a');
            x.size = Math.max(1, Math.min(30, Number(x.size) || 4));
        });
        if (!d.view || typeof d.view !== 'object') d.view = { x: 0, y: 0, zoom: 1 };
        if (!isFinite(Number(d.view.x))) d.view.x = 0;
        if (!isFinite(Number(d.view.y))) d.view.y = 0;
        if (!isFinite(Number(d.view.zoom)) || Number(d.view.zoom) <= 0) d.view.zoom = 1;
        d.view = { x: Number(d.view.x), y: Number(d.view.y), zoom: Number(d.view.zoom) };
        if (typeof d.riassunto !== 'string') d.riassunto = d.riassunto == null ? '' : String(d.riassunto);
        const s = (d.style && typeof d.style === 'object') ? d.style : (d.style = {});
        s.palette = s.palette === 'chiara' ? 'chiara' : 'scura';
        s.nodeFill = validHex(s.nodeFill, s.palette === 'chiara' ? '#ffffff' : NODE_COLOR);
        s.nodeBorder = validHex(s.nodeBorder, s.palette === 'chiara' ? '#2c3550' : NODE_BORDER);
        s.edgeColor = validHex(s.edgeColor, s.palette === 'chiara' ? '#3d5afe' : EDGE_COLOR);
        s.fontSize = FONT_SIZES.indexOf(Number(s.fontSize)) >= 0 ? Number(s.fontSize) : 14;
        s.bold = !!s.bold;
        s.shape = SHAPES.indexOf(s.shape) >= 0 ? s.shape : 'round';
        // BLOCCO 2.2b: backfill geometria con guardie isFinite — nodi legacy senza
        // x/y/w/h riparati al load; MAI cancellati (nessuna perdita per costruzione).
        const sizeB = (typeof SchemaStrategies !== 'undefined')
            ? (SchemaStrategies.getStrategy(d.type).nodeSize() || { w: 170, h: 56 })
            : { w: 170, h: 56 };
        d.nodes.forEach(n => {
            if (!n.id) n.id = uuid();
            const wN = Number(n.w), hN = Number(n.h);
            n.w = (isFinite(wN) && wN > 0) ? wN : sizeB.w;
            n.h = (isFinite(hN) && hN > 0) ? hN : sizeB.h;
            const xN = Number(n.x), yN = Number(n.y);
            if (isFinite(xN) && isFinite(yN)) { n.x = xN; n.y = yN; }
            else {
                const p = backfillSpot(d.nodes, n);
                n.x = p.x; n.y = p.y;
            }
            if (SHAPES.indexOf(n.shape) < 0) n.shape = 'round';
            if (FONT_SIZES.indexOf(Number(n.fontSize)) < 0) delete n.fontSize;
            if (!n.bold) delete n.bold; else n.bold = true;
            if (n.color == null || !/^#[0-9a-f]{6}$/i.test(String(n.color))) n.color = s.nodeFill;
            if (n.border == null || !/^#[0-9a-f]{6}$/i.test(String(n.border))) n.border = s.nodeBorder;
        });
                d.edges.forEach(e => {
            if (!e.id) e.id = uuid();
            if (e.label == null) e.label = '';
            if (!/^#[0-9a-f]{6}$/i.test(String(e.color || ''))) e.color = s.edgeColor;
            if (!e.extra && e.extraMotivo) delete e.extraMotivo;   // BLOCCO 2: nessun motivo su arco valido
        });
        if (d.extraCount != null) delete d.extraCount;   // BLOCCO 2: conteggio non persistito

        // BLOCCO 3.3: migrazione dati schema legacy "Alto -> basso" (id reale 'tb' e alias
        // 'alto-basso') verso il tipo 'albero'. Mapping NON distruttivo: nodes, edges e
        // drawings non vengono toccati -> nessuna perdita per costruzione. La flag qui sotto
        // serve all'auto-layout al primo caricamento e resta nel modulo (non nel doc).
        if (d.type === 'tb' || d.type === 'alto-basso') {
            d.type = 'albero';
            pendingLegacyLayout = true;
        }
        return d;
    }

    function styleDefaults(doc) {
        const s = (doc && doc.style) || {};
        const light = s.palette === 'chiara';
        return {
            palette: light ? 'chiara' : 'scura',
            nodeFill: validHex(s.nodeFill, light ? '#ffffff' : NODE_COLOR),
            nodeBorder: validHex(s.nodeBorder, light ? '#2c3550' : NODE_BORDER),
            edgeColor: validHex(s.edgeColor, light ? '#3d5afe' : EDGE_COLOR),
            fontSize: FONT_SIZES.indexOf(Number(s.fontSize)) >= 0 ? Number(s.fontSize) : 14,
            bold: !!s.bold,
            shape: SHAPES.indexOf(s.shape) >= 0 ? s.shape : 'round'
        };
    }

    function defaultDoc(type) {
        const s = {
            palette: 'scura', nodeFill: NODE_COLOR, nodeBorder: NODE_BORDER,
            edgeColor: EDGE_COLOR, fontSize: 14, bold: false, shape: 'round'
        };
        const stratD = (typeof SchemaStrategies !== 'undefined') ? SchemaStrategies.getStrategy(type) : null;
        const sizeD = (stratD && stratD.nodeSize) ? stratD.nodeSize() : { w: 190, h: 66 };
        const root = {
            id: uuid(),
            x: 520, y: 80, w: sizeD.w, h: Math.max(sizeD.h, 66),
            text: 'Idea centrale',
            color: s.nodeFill, border: s.nodeBorder, shape: 'round'
        };
        return { type: type, nodes: [root], edges: [], view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [], style: s };
    }

    function noteTexts(doc) {
        if (!doc || !Array.isArray(doc.objects)) return '';
        return doc.objects.filter(o => o.t === 'text' && o.text).map(o => String(o.text).trim()).filter(Boolean).join('\n');
    }

    function extractText(item, full) {
        const c = full && full.content != null ? full.content : (item.content || '');
        if (item.kind === 'note') {
            const d = parseDoc2(c);
            if (d) return noteTexts(d);
        }
        try {
            const o = JSON.parse(c);
            if (o && typeof o === 'object') {
                if (Array.isArray(o.objects)) return noteTexts2(o);
                if (Array.isArray(o.nodes)) return o.nodes.map(n => n.text || '').filter(Boolean).join('\n');
                if (typeof o.text === 'string' && o.text.trim()) return o.text;
                if (typeof o.riassunto === 'string' && o.riassunto.trim()) return o.riassunto;
            }
        } catch (e) { /* testo semplice */ }
        return String(c || '').replace(/\s+/g, ' ').trim();
    }

    function parseDoc2(content) {
        try {
            const d = JSON.parse(content);
            if (d && Array.isArray(d.objects)) return d;
        } catch (e) { /* ok */ }
        return null;
    }

    function noteTexts2(o) {
        return o.objects.filter(x => x.t === 'text' && x.text).map(x => String(x.text).trim()).filter(Boolean).join('\n');
    }

    function itemPreview(it) {
        const doc = parseDoc(it.content);
        if (doc && doc.riassunto && String(doc.riassunto).trim()) {
            return String(doc.riassunto).replace(/\s+/g, ' ').trim().slice(0, 170);
        }
        if (doc) {
            const t = (doc.nodes || []).map(n => n.text || '').filter(Boolean).join(' \u2022 ');
            if (t) return t.slice(0, 170);
        }
        return String(it.description || '').replace(/\s+/g, ' ').trim().slice(0, 170);
    }

    // ---------- modale testo (rinomina) ----------
    function askText(title, label, value, keepEmpty) {
        return new Promise(resolve => {
            const ov = App.el('div', 'modal-overlay');
            const inputId = 'scIn-' + uuid();
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
            ok.addEventListener('click', () => {
                const v = input.value.trim();
                finish(keepEmpty ? v : (v || null));
            });
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
    // LISTA SCHEMI
    // ============================================================
    async function renderList() {
        teardownEditor();
        container.style.overflow = '';
        container.style.padding = '';
        container.innerHTML = '';

        const btnNew = btn('tool-btn',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Nuovo schema',
            () => renderChooser());
        container.appendChild(App.header('Schemi', 'Mappe concettuali, alberi e schemi visivi', [btnNew]));

        container.appendChild(Folders.bar('schema', () => renderList()));
        container.appendChild(Folders.grid('schema', () => renderList()));

        const bar = App.el('div', 'toolbar plain');
        const search = App.el('input', 'search-input');
        search.type = 'text';
        search.placeholder = 'Cerca negli schemi\u2026';
        const selMat = App.el('select', 'mini');
        bar.appendChild(search);
        bar.appendChild(selMat);
        container.appendChild(bar);

        const wrap = App.el('div', '');
        container.appendChild(wrap);

        let all = [];
        try { all = await StudyStore.listItems('schema') || []; } catch (e) { console.error('Elenco schemi:', e); }

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

        function refresh() {
            const q = search.value.trim().toLowerCase();
            const mat = selMat.value;
            let items = all.slice();
            if (mat) items = items.filter(i => SubjectInput.normalize(i.materia) === SubjectInput.normalize(mat));
            if (q) {
                items = items.filter(i =>
                    String(i.title || '').toLowerCase().indexOf(q) >= 0 ||
                    itemPreview(i).toLowerCase().indexOf(q) >= 0);
            }
            items = Folders.filterItems(items, 'schema');
            items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
            renderGrid(items);
        }

        function renderGrid(items) {
            wrap.innerHTML = '';
            if (!all.length) {
                wrap.appendChild(App.empty(App.ICONS.schemi,
                    'Nessuno schema ancora. Crea il tuo primo schema: scegli il tipo e inizia a collegare le idee.',
                    '+ Nuovo schema', () => renderChooser()));
                return;
            }
            if (!items.length) {
                wrap.appendChild(App.empty(App.ICONS.schemi, 'Nessuno schema corrisponde ai filtri.'));
                return;
            }
            const grid = App.el('div', 'grid-cards');
            items.forEach(it => {
                const doc = parseDoc(it.content);
                const typeLabel = doc && doc.type && TYPE_LABELS[doc.type] ? TYPE_LABELS[doc.type] : 'Schema';
                const card = App.el('div', 'card clickable');
                card.tabIndex = 0;
                const chips = ['<span class="chip">' + App.esc(typeLabel) + '</span>'];
                const matName = SubjectInput.normalize(it.materia);
                if (matName) {
                    const c = colorOf[matName] || colorOf[it.materia];
                    chips.push('<span class="chip">' + (c ? '<span class="dot" style="background:' + App.esc(c) + '"></span>' : '') + App.esc(matName) + '</span>');
                }
                const prev = itemPreview(it);
                card.innerHTML =
                    '<div class="sc-thumb-ph">' + (App.ICONS.schemi || '') + '</div>' +
                    '<h4>' + App.esc(it.title || 'Senza titolo') + '</h4>' +
                    '<div class="meta"><span>' + App.esc(App.fmtDate(it.updated_at || it.created_at)) + '</span></div>' +
                    '<div class="meta" style="margin-top:7px">' + chips.join('') + '</div>' +
                    (prev ? '<div class="preview">' + App.esc(prev) + '</div>' : '');
                card.addEventListener('click', e => {
                    if (e.target.closest('.card-actions')) return;
                    openEditor(it.id);
                });
                card.addEventListener('keydown', e => { if (e.key === 'Enter') openEditor(it.id); });

                const actions = App.el('div', 'card-actions');
                actions.appendChild(btn('', 'Apri', () => openEditor(it.id)));
                actions.appendChild(btn('', 'Rinomina', async () => {
                    const t = await askText('Rinomina schema', 'Titolo dello schema', it.title);
                    if (!t) return;
                    try { await StudyStore.renameItem(it.id, t); } catch (e) { console.error(e); }
                    refresh();
                }));
                actions.appendChild(btn('danger', 'Elimina', async () => {
                    if (!confirm('Eliminare lo schema \u201c' + (it.title || '') + '\u201d? L\u2019operazione non \u00e8 annullabile.')) return;
                    try { await StudyStore.deleteItem(it.id); } catch (e) { console.error(e); }
                    all = all.filter(x => x.id !== it.id);
                    refresh();
                }));
                actions.appendChild(Folders.moveSelect('schema', it.folder_id || '', async fid => {
                    try {
                        const full = await StudyStore.getItem(it.id);
                        if (!full) return;
                        full.folder_id = fid;
                        await StudyStore.saveItem(full);
                        renderList();
                    } catch (e) { console.error('Sposta schema:', e); }
                }));
                card.appendChild(actions);
                grid.appendChild(card);
            });
            wrap.appendChild(grid);
        }

        search.addEventListener('input', refresh);
        selMat.addEventListener('change', refresh);
        refresh();
    }

    // ============================================================
    // SCELTA TIPO
    // ============================================================
    async function renderChooser() {
        teardownEditor();
        container.style.overflow = '';
        container.style.padding = '';
        container.innerHTML = '';
        container.appendChild(App.header('Nuovo schema', 'Scegli il tipo di schema da creare'));

        let subjects = [];
        try { subjects = await StudyStore.listSubjects() || []; } catch (e) { /* ok */ }

        const card = App.el('div', 'card');
        card.style.maxWidth = '660px';
        card.style.margin = '10px auto 0';
        card.style.padding = '24px';

        let type = 'albero';

        const f1 = App.el('div', 'field');
        f1.appendChild(App.el('label', null, 'Tipo di schema'));
        const row1 = App.el('div', 'choice-row');
        TYPES.forEach(t => {
            const c = btn('choice' + (t.id === type ? ' active' : ''), t.label, () => {
                type = t.id;
                row1.querySelectorAll('.choice').forEach(x => x.classList.remove('active'));
                c.classList.add('active');
            });
            row1.appendChild(c);
        });
        f1.appendChild(row1);
        const hint = App.el('div', 'hint');
        hint.style.cssText = 'font-size:12.5px;color:var(--muted);margin-top:8px';
        hint.textContent = 'Il tipo influenza il layout iniziale e l\u2019auto-layout. Il \u201criassunto visuale\u201d apre anche il pannello testo affiancato.';
        f1.appendChild(hint);
        card.appendChild(f1);

        const f2 = App.el('div', 'field');
        const subjMat = SubjectInput.create({
            label: 'Materia (facoltativa)',
            placeholder: 'Inserisci materia\u2026'
        });
        f2.appendChild(subjMat);
        card.appendChild(f2);

        const actions = App.el('div', 'form-actions');
        actions.appendChild(btn('btn-secondary', 'Annulla', () => renderList()));
        actions.appendChild(btn('btn-accent', 'Crea schema', async () => {
            const doc = defaultDoc(type);
            if (typeof SchemaStrategies !== 'undefined') {
                SchemaStrategies.getStrategy(type).initialLayout(doc.nodes, doc.edges);
            }
            const materia = SubjectInput.normalize(subjMat.getValue());
            if (materia) SubjectInput.remember(materia);
            let saved = null;
            try {
                saved = await StudyStore.saveItem({
                    kind: 'schema',
                    title: 'Schema del ' + new Date().toLocaleDateString('it-IT'),
                    content: JSON.stringify(doc),
                    materia: materia,
                    tags: '',
                    description: '',
                    thumbnail: '',
                    folder_id: Folders.get('schema')
                });
            } catch (e) { console.error('Creazione schema:', e); }
            if (saved && saved.id) openEditor(saved, type === 'riassunto');
            else renderList();
        }));
        card.appendChild(actions);

        container.appendChild(card);
    }

    // ============================================================
    // EDITOR
    // ============================================================
    function nodeById(id) {
        if (!ed) return null;
        for (let i = 0; i < ed.doc.nodes.length; i++) {
            if (ed.doc.nodes[i].id === id) return ed.doc.nodes[i];
        }
        return null;
    }

    function contrast(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
        if (!m) return '#f5f7fa';
        const v = parseInt(m[1], 16);
        const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum > 140 ? '#1a1f2e' : '#f5f7fa';
    }

    function wrapText(text, maxChars) {
        const out = [];
        String(text || '').split('\n').forEach(par => {
            const words = String(par).split(/\s+/).filter(w => w.length);
            if (!words.length) { out.push(''); return; }
            let line = '';
            words.forEach(w => {
                while (w.length > maxChars) {
                    if (line) { out.push(line); line = ''; }
                    out.push(w.slice(0, maxChars));
                    w = w.slice(maxChars);
                }
                if (!line) line = w;
                else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
                else { out.push(line); line = w; }
            });
            if (line) out.push(line);
        });
        return out.length ? out : [''];
    }

    // B1b: micro-offset (~2px) lungo la normale agli endpoint, usato SOLO dalla
    // geometria di render: punta freccia e tratto iniziale restano fuori dallo
    // stroke del nodo. Il check "arco indietro" in edgeHtml resta su anchors(a, b).
    const EDGE_OUT = 2;

    /* ---------- S (R19): classificazione posizione relativa C1-C11 ----------
       Tabella ESAUSTIVA e disgiunta (prima corrispondenza). Ogni nodo ha SOLO
       4 ancore T/B/L/R al centro del lato; ogni arco = polilinea ortogonale
       da ancora a ancora (MAI diagonali):
         oH = |cxT-cxS| <= (wS+wT)/4   (overlap orizzontale)
         oV = |cyT-cyS| <= (hS+hT)/4   (stessa riga), dy>0 = T sotto S
         C1: oH e sotto  -> S.B -> T.T  (|cx|<=0.5 dritto, altrimenti C1b Z)
         C2: oH e sopra  -> S.T -> T.B  (specchio C1; |cx|<=0.5 dritto / C2b)
         C3: oV stessa riga -> destra S.R->T.L | sinistra S.L->T.R
             (|cy|<=0.5 dritto, altrimenti C3b Z con verticale nel gap colonna)
         C4: sotto,  !oH, |dy|>=|dx| -> Z verticale-prima, orizzontale nel gapY
         C5: sopra,  !oH, |dy|>=|dx| -> specchio C4 (gapY superiore)
         C6: destra, !oV, |dx|>|dy|  -> Z orizzontale-prima, verticale in gapX
         C7: sinistra, !oV, |dx|>|dy| -> specchio C6
       C8 (bus figli sotto, gapY condiviso), C9 (fratello in riga con nodo in
       mezzo -> U sopra/giu'), C10 (router anti-ostacolo), C11 (collision
       resolution del layout PRIMA del routing, SEP 32/48 in
       schemaStrategies) sono gestiti in edgeGeom/busGapY/c9Route/routePts. */
    function classifyCase(a, b) {
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const dx = bcx - acx, dy = bcy - acy;
        const adx = Math.abs(dx), ady = Math.abs(dy);
        const oH = adx <= (a.w + b.w) / 4;
        const oV = ady <= (a.h + b.h) / 4;
        if (oH && dy > 0) return { caso: adx <= 0.5 ? 'C1' : 'C1b', s: 'B', t: 'T' };
        if (oH && dy < 0) return { caso: adx <= 0.5 ? 'C2' : 'C2b', s: 'T', t: 'B' };
        if (oV && dx > 0) return { caso: ady <= 0.5 ? 'C3' : 'C3b', s: 'R', t: 'L' };
        if (oV && dx < 0) return { caso: ady <= 0.5 ? 'C3' : 'C3b', s: 'L', t: 'R' };
        if (dy > 0 && ady >= adx) return { caso: 'C4', s: 'B', t: 'T' };
        if (dy < 0 && ady >= adx) return { caso: 'C5', s: 'T', t: 'B' };
        if (dx > 0) return { caso: 'C6', s: 'R', t: 'L' };
        if (dx < 0) return { caso: 'C7', s: 'L', t: 'R' };
        // degenere (stessi centri): fallback asse dominente (dominio C11)
        if (adx >= ady) return { caso: dx >= 0 ? 'C6' : 'C7', s: dx >= 0 ? 'R' : 'L', t: dx >= 0 ? 'L' : 'R' };
        return { caso: dy >= 0 ? 'C4' : 'C5', s: dy >= 0 ? 'B' : 'T', t: dy >= 0 ? 'T' : 'B' };
    }

    /* Punto ancora sul lato (T/B/L/R = centro del lato) + offset verso
       l'esterno (>=0 solo fuori dal rettangolo, mai dentro). */
    function sidePt(n, side, off) {
        off = off || 0;
        if (side === 'B') return { x: n.x + n.w / 2, y: n.y + n.h + off };
        if (side === 'T') return { x: n.x + n.w / 2, y: n.y - off };
        if (side === 'L') return { x: n.x - off, y: n.y + n.h / 2 };
        return { x: n.x + n.w + off, y: n.y + n.h / 2 };
    }

    function anchors(a, b, off) {
        const c = classifyCase(a, b);
        const s = sidePt(a, c.s, off || 0), t = sidePt(b, c.t, off || 0);
        return { x1: s.x, y1: s.y, x2: t.x, y2: t.y, caso: c.caso };
    }

    /* ---------- S2/S3: router anti-ostacolo (C10) ----------
       Candidati SEMPRE ortogonali (max 4 segmenti): dritto solo se assiale,
       L (2 varianti), Z/step con lane attorno a ogni ostacolo (margine 12px,
       approccio finale sull'ancora target 24px), perimetro esterno del
       cluster. Scelta: 0 intersezioni -> orientata -> MENO segmenti ->
       piu' corta -> prima generata (deterministico). Fallback L. */

    const ROUTE_M = 12;      // margine lane attorno ai nodi
    const ROUTE_EPS = 0.01;  // tolleranza intersezione (interiore, come il QA)
    const ROUTE_AP = 24;     // approccio finale sull'ancora target

    /* Rettangoli interni (eps) dei nodi che NON sono endpoint dell'arco. */
    function obstacleRects(a, b) {
        const out = [];
        if (!ed || !Array.isArray(ed.doc.nodes)) return out;
        ed.doc.nodes.forEach(n => {
            if (!n || n.id === a.id || n.id === b.id) return;
            if (!isFinite(n.x) || !isFinite(n.y) || !isFinite(n.w) || !isFinite(n.h)) return;
            out.push({
                x: n.x + ROUTE_EPS, y: n.y + ROUTE_EPS,
                w: n.w - 2 * ROUTE_EPS, h: n.h - 2 * ROUTE_EPS
            });
        });
        return out;
    }

    /* Segmento APERTO vs AABB (Liang-Barsky): true solo se attraversa
       l'interno con lunghezza > 0 (touch di bordo o contenimento totale
       gestiti; eps già applicato al rettangolo). */
    function segHitsRect(x1, y1, x2, y2, r) {
        const dx = x2 - x1, dy = y2 - y1;
        let t0 = 0, t1 = 1;
        const px = [-dx, dx, -dy, dy];
        const qx = [x1 - r.x, (r.x + r.w) - x1, y1 - r.y, (r.y + r.h) - y1];
        for (let i = 0; i < 4; i++) {
            if (px[i] === 0) {
                if (qx[i] < 0) return false;
            } else {
                const t = qx[i] / px[i];
                if (px[i] < 0) { if (t > t0) t0 = t; }
                else { if (t < t1) t1 = t; }
                if (t0 > t1) return false;
            }
        }
        return (Math.min(t1, 1) - Math.max(t0, 0)) > 1e-6;
    }

    function polyHits(pts, obst) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            for (let k = 0; k < obst.length; k++) {
                if (segHitsRect(a.x, a.y, b.x, b.y, obst[k])) return true;
            }
        }
        return false;
    }

    /* Campionamento denso della quadratiche (step <=~3px) per il check. */
    function quadSamples(p1, c, p2) {
        const approx = (Math.hypot(c.x - p1.x, c.y - p1.y) + Math.hypot(p2.x - c.x, p2.y - c.y)) || 1;
        const n = Math.max(16, Math.min(600, Math.ceil(approx / 3)));
        const out = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n, u = 1 - t;
            out.push({
                x: u * u * p1.x + 2 * u * t * c.x + t * t * p2.x,
                y: u * u * p1.y + 2 * u * t * c.y + t * t * p2.y
            });
        }
        return out;
    }

    function polyLen(pts) {
        let L = 0;
        for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return L;
    }

    /* Punto a meta' lunghezza (per l'etichetta). */
    function polyMid(pts) {
        const half = polyLen(pts) / 2;
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const seg = Math.hypot(b.x - a.x, b.y - a.y);
            if (acc + seg >= half && seg > 0) {
                const t = (half - acc) / seg;
                return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            }
            acc += seg;
        }
        return pts[pts.length - 1];
    }

    /* Ultimo segmento orientato verso il nodo target (S3: la punta deve
       "entrare" dall'esterno sull'ancora scelta da S1). */
    function oriented(pts, b, horiz, dir) {
        if (pts.length < 2) return false;
        const a = pts[pts.length - 2], z = pts[pts.length - 1];
        const dx = z.x - a.x, dy = z.y - a.y;
        if (horiz) return Math.abs(dx) > Math.abs(dy) && (dx > 0 ? 1 : -1) === dir;
        return Math.abs(dy) >= Math.abs(dx) && (dy > 0 ? 1 : -1) === dir;
    }

    /* Router: dritto -> L -> Z/step (lane ostacolo +-12px, approccio 24px).
       Ritorna la polilinea punti. */
    function routePts(p1, p2, b, obst) {
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const horiz = Math.abs(p2.y - bcy) <= 0.5;                 // ancora su lato sx/dx?
        const dir = horiz ? (p2.x < bcx ? 1 : -1) : (p2.y < bcy ? 1 : -1);
        const cands = [];
        const add = pts => { if (pts.length >= 2) cands.push(pts); };
        if (p1.x === p2.x || p1.y === p2.y) add([p1, p2]);         // dritto SOLO assiale
        add([p1, { x: p2.x, y: p1.y }, p2]);                       // L orizzonte-prima
        add([p1, { x: p1.x, y: p2.y }, p2]);                       // L verticale-prima
        obst.forEach(O => {
            const lanesY = [O.y - ROUTE_M, O.y + O.h + ROUTE_M];
            const lanesX = [O.x - ROUTE_M, O.x + O.w + ROUTE_M];
            lanesY.forEach(ly => {
                add([p1, { x: p1.x, y: ly }, { x: p2.x, y: ly }, p2]);   // Z semplice
                if (horiz) {
                    const fx = p2.x - dir * ROUTE_AP;               // approccio orizzontale
                    add([p1, { x: p1.x, y: ly }, { x: fx, y: ly }, { x: fx, y: p2.y }, p2]);
                } else {
                    const fy = p2.y - dir * ROUTE_AP;               // approccio verticale
                    add([p1, { x: p1.x, y: ly }, { x: p2.x, y: ly }, { x: p2.x, y: fy }, p2]);
                }
            });
            lanesX.forEach(lx => {
                add([p1, { x: lx, y: p1.y }, { x: lx, y: p2.y }, p2]);   // Z semplice
                if (!horiz) {
                    const fy = p2.y - dir * ROUTE_AP;
                    add([p1, { x: lx, y: p1.y }, { x: lx, y: fy }, { x: p2.x, y: fy }, p2]);
                } else {
                    const fx = p2.x - dir * ROUTE_AP;
                    add([p1, { x: lx, y: p1.y }, { x: lx, y: p2.y }, { x: fx, y: p2.y }, p2]);
                }
            });
        });
        /* C10: perimetro esterno del cluster (bbox ostacoli + margine 12px) */
        if (obst.length) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            obst.forEach(O => {
                x0 = Math.min(x0, O.x); y0 = Math.min(y0, O.y);
                x1 = Math.max(x1, O.x + O.w); y1 = Math.max(y1, O.y + O.h);
            });
            [y0 - ROUTE_M, y1 + ROUTE_M].forEach(ly => {
                add([p1, { x: p1.x, y: ly }, { x: p2.x, y: ly }, p2]);
            });
            [x0 - ROUTE_M, x1 + ROUTE_M].forEach(lx => {
                add([p1, { x: lx, y: p1.y }, { x: lx, y: p2.y }, p2]);
            });
        }
        let bestOriented = null, bestO = null;
        let bestFree = null, bestF = null;
        for (let k = 0; k < cands.length; k++) {
            const pts = cands[k];
            if (polyHits(pts, obst)) continue;
            const L = polyLen(pts), S = pts.length - 1;
            if (!bestF || S < bestF.seg || (S === bestF.seg && L < bestF.len - 1e-9)) {
                bestFree = pts; bestF = { seg: S, len: L };
            }
            if (oriented(pts, b, horiz, dir) &&
                (!bestO || S < bestO.seg || (S === bestO.seg && L < bestO.len - 1e-9))) {
                bestOriented = pts; bestO = { seg: S, len: L };
            }
        }
        if (bestOriented) return bestOriented;   // preferenza: orientata + libera + compatta
        if (bestFree) return bestFree;
        const v1 = [p1, { x: p2.x, y: p1.y }, p2];   // fallback L (spec)
        const v2 = [p1, { x: p1.x, y: p2.y }, p2];
        return polyLen(v1) <= polyLen(v2) ? v1 : v2;
    }

    function ptsToD(pts) {
        let d = '';
        for (let i = 0; i < pts.length; i++) {
            d += (i === 0 ? 'M ' : ' L ') +
                (Math.round(pts[i].x * 10) / 10) + ' ' + (Math.round(pts[i].y * 10) / 10);
        }
        return d;
    }

        /* Polilinea ORTOGONALE della tabella C1-C7 (1 segmento se i centri sono
       allineati, altrimenti Z di 3 segmenti con l'asse trasversale ESATTAMENTE
       nel corridoio gapY/gapX fra righe/colonne). gapYOverride = C8 (bus). */
    function tablePolyline(a, b, cls, gapYOverride) {
        const p = anchors(a, b, EDGE_OUT);
        const p1 = { x: p.x1, y: p.y1 }, p2 = { x: p.x2, y: p.y2 };
        if (cls.caso === 'C1' || cls.caso === 'C2' || cls.caso === 'C3') return [p1, p2];
        if (cls.caso === 'C1b' || cls.caso === 'C4') {
            const gapY = (gapYOverride != null) ? gapYOverride : (a.y + a.h + b.y) / 2;
            return [p1, { x: p1.x, y: gapY }, { x: p2.x, y: gapY }, p2];
        }
        if (cls.caso === 'C2b' || cls.caso === 'C5') {
            const gapY = (b.y + b.h + a.y) / 2;
            return [p1, { x: p1.x, y: gapY }, { x: p2.x, y: gapY }, p2];
        }
        // C3b | C6 | C7: Z orizzontale-prima con verticale nel gap di colonna
        const gapX = (cls.s === 'R') ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2;
        return [p1, { x: gapX, y: p1.y }, { x: gapX, y: p2.y }, p2];
    }

    /* C8 (albero/bus): se S ha >=2 archi verso figli tutti sotto nello stesso
       corridoio (riga figli = min top, tolleranza 24px), ogni arco usa il gapY
       IDENTICO per tutti: l'unione degli orizzontali copre i cx dei figli e i
       drop verticali scendono sui T.T (pattern organigramma, solo nel corridoio
       vuoto; MAI sopra i nodi). Ritorna il gapY condiviso o null. */
    function busGapY(a, b) {
        if (!ed || !ed.doc || !Array.isArray(ed.doc.edges)) return null;
        const bottomS = a.y + a.h;
        if (!(b.y > bottomS)) return null;                  // b non e' un figlio sotto
        let minTop = b.y, n = 1;
        ed.doc.edges.forEach(e => {
            if (!e || e.from !== a.id) return;
            const t = nodeById(e.to);
            if (!t || t.id === b.id || !isFinite(t.y)) return;
            if (t.y <= bottomS) return;                     // non nel corridoio sotto
            if (t.y < minTop) minTop = t.y;
            n++;
        });
        if (n < 2) return null;                             // figlio singolo: caso base
        if (b.y - minTop > 24) return null;                 // b non e' nella riga del bus
        return (bottomS + minTop) / 2;
    }

    /* C9: fratello->fratello stessa riga con nodo/ostacolo in mezzo (dritto C3
       o jog C3b intersecano): U sotto o sopra la riga, scegliendo il lato con
       piu' spazio (confronto corridoio sopra vs sotto; se manca corridoio ->
       perimetro esterno via C10). Sotto: S.B -> (cxS,corrY) -> (cxT,corrY) ->
       T.B (ultimo segmento SALE, punta su T.B); sopra: S.T -> ... -> T.T.
       Mai attraversare i nodi intermedi (polyHits su ogni variante). */
    function c9Route(a, b, obst) {
        const yTop = Math.min(a.y, b.y), yBot = Math.max(a.y + a.h, b.y + b.h);
        const xL = Math.min(a.x, b.x), xR = Math.max(a.x + a.w, b.x + b.w);
        let spBelow = Infinity, spAbove = Infinity;
        obst.forEach(O => {
            if (!(O.x < xR && O.x + O.w > xL)) return;    // fuori dallo span del percorso
            if (O.y >= yBot - 0.01) spBelow = Math.min(spBelow, O.y - yBot);
            else if (O.y + O.h <= yTop + 0.01) spAbove = Math.min(spAbove, yTop - (O.y + O.h));
        });
        const MIN_C = 10;
        const sp = { below: spBelow, above: spAbove };
        const sides = (spBelow >= spAbove ? ['below', 'above'] : ['above', 'below'])
            .filter(sd => sp[sd] >= MIN_C);
        for (let i = 0; i < sides.length; i++) {
            const below = sides[i] === 'below';
            const s1 = sidePt(a, below ? 'B' : 'T', EDGE_OUT);
            const t1 = sidePt(b, below ? 'B' : 'T', EDGE_OUT);
            const corrY = below
                ? (sp.below === Infinity ? yBot + 44 : yBot + sp.below / 2)
                : (sp.above === Infinity ? yTop - 44 : yTop - sp.above / 2);
            const pts = [s1, { x: s1.x, y: corrY }, { x: t1.x, y: corrY }, t1];
            if (!polyHits(pts, obst)) return pts;
        }
        return null;
    }

    /* Geometria dell'arco (R19): 'dritta' e 'gomito' producono SEMPRE la
       polilinea ortogonale della tabella C1-C11 (la diagonale "dritta" e'
       eliminata); 'curva' (Q) si MANTIENE quando non interseca nodi (feature
       esistente: strategia mappa/libero) e cade sul router ortogonale quando
       interseca. Collisioni: C9 (riga con nodo in mezzo) poi C10 (router, max
       4 segmenti, 0 intersezioni, fallback L). Ogni arco espone il caso via
       data-caso sul gruppo SVG (usato dai QA S). */
    function edgeGeom(a, b, forma) {
        const cls = classifyCase(a, b);
        const p = anchors(a, b, EDGE_OUT);
        const p1 = { x: p.x1, y: p.y1 }, p2 = { x: p.x2, y: p.y2 };
        const obst = obstacleRects(a, b);
        const mk = (pts, caso) => {
            const first = pts[0], last = pts[pts.length - 2], z = pts[pts.length - 1];
            return {
                d: ptsToD(pts),
                ang: Math.atan2(z.y - last.y, z.x - last.x) * 180 / Math.PI,
                mid: polyMid(pts),
                p: { x1: first.x, y1: first.y, x2: z.x, y2: z.y },
                caso: caso
            };
        };

        if (forma === 'curva') {
            const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
            const len = Math.hypot(dx, dy) || 1;
            const off = Math.max(22, Math.min(84, len * 0.22));
            const cx = (p.x1 + p.x2) / 2 + (-dy / len) * off;
            const cy = (p.y1 + p.y2) / 2 + (dx / len) * off;
            if (!polyHits(quadSamples(p1, { x: cx, y: cy }, p2), obst)) {
                return {
                    d: 'M ' + p.x1 + ' ' + p.y1 + ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + p.x2 + ' ' + p.y2,
                    ang: Math.atan2(p.y2 - cy, p.x2 - cx) * 180 / Math.PI,
                    mid: { x: (p.x1 + 2 * cx + p.x2) / 4, y: (p.y1 + 2 * cy + p.y2) / 4 },
                    p: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
                    caso: cls.caso, curva: true
                };
            }
            // la Q interseca un nodo: cade sul router ortogonale della tabella
        }

        /* C8: bus condiviso (anche per figli non allineati, anche se la
           classificazione geometrica darebbe C6/C7: il bus prevale) */
        const bus = busGapY(a, b);
        if (bus != null) {
            const s1 = sidePt(a, 'B', EDGE_OUT), t1 = sidePt(b, 'T', EDGE_OUT);
            const aligned = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) <= 0.5;
            const pts = aligned ? [s1, t1]
                : [s1, { x: s1.x, y: bus }, { x: t1.x, y: bus }, t1];
            if (!polyHits(pts, obst)) return mk(pts, 'C8');
        }

        const base = tablePolyline(a, b, cls, null);
        if (!polyHits(base, obst)) return mk(base, cls.caso);

        if (cls.caso === 'C3' || cls.caso === 'C3b') {
            const u = c9Route(a, b, obst);
            if (u) return mk(u, 'C9');
        }
        return mk(routePts(p1, p2, b, obst), 'C10');
    }

    function edgeHtml(e) {
        const a = nodeById(e.from), b = nodeById(e.to);
        if (!a || !b) return '';
        const s = strat();
        const es = s ? s.edgeStyle() : { forma: 'dritta', freccia: true, etichetta: false };
        let forma = es.forma;
        const pr = anchors(a, b);
        // flusso lr/tb (direzioni di layout; il tipo tb è rimosso dall'UI): un arco "indietro" viene reso come curva
        if (forma === 'dritta' && s && s.asseFlusso === 'x' && pr.x2 < pr.x1 - 1) forma = 'curva';
        else if (forma === 'dritta' && s && s.asseFlusso === 'y' && pr.y2 < pr.y1 - 1) forma = 'curva';
        const g = edgeGeom(a, b, forma);
        const col = e.extra ? '#7f879c' : (e.color || styleDefaults(ed.doc).edgeColor);
        const selected = ed.sel && ed.sel.t === 'edge' && ed.sel.id === e.id;
        const sw = selected ? 3.4 : 2.2;
        let h = '<g class="sc-edge' + (e.extra ? ' sc-edge-extra' : '') + '" data-eid="' + e.id + '"' + (g.caso ? ' data-caso="' + g.caso + '"' : '') + '>';
        h += '<path d="' + g.d + '" stroke="transparent" stroke-width="8" pointer-events="stroke" fill="none"/>';
        h += '<path d="' + g.d + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '"' +
            (e.extra ? ' stroke-dasharray="7 5"' : '') + '/>';
        if (es.freccia) {
            h += '<polygon points="0,0 -11,5 -11,-5" fill="' + col + '" transform="translate(' + g.p.x2 + ',' + g.p.y2 + ') rotate(' + g.ang.toFixed(2) + ')"/>';
        }
        if (es.etichetta) {
            const txt = String(e.label == null ? '' : e.label).trim();
            if (txt) {
                const mx = g.mid.x, my = g.mid.y;
                const lw = Math.max(28, txt.length * 6.6 + 16);
                h += '<g class="sc-elabel" pointer-events="none">' +
                    '<rect x="' + (mx - lw / 2).toFixed(1) + '" y="' + (my - 9.5).toFixed(1) + '" width="' + lw.toFixed(1) + '" height="19" rx="9.5" fill="#ffffff" fill-opacity="0.93" stroke="' + col + '" stroke-width="1"/>' +
                    '<text x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="600" fill="#141824" font-family="system-ui, -apple-system, sans-serif">' + App.esc(txt) + '</text>' +
                    '</g>';
            }
        }
        h += '</g>';
        return h;
    }

    /* Card multilinea (Riassunto visuale): prima riga = titolo, resto = corpo. */
    function nodeCardHtml(n, fs, fill, stroke, sw, dash, handle, labelOnly) {
        const raw = String(n.text == null ? '' : n.text);
        const parts = raw.split('\n');
        const title = parts[0] || '';
        const body = parts.slice(1).join('\n');
        const innerW = Math.max(30, n.w - 24);
        const tMax = Math.max(6, Math.floor(innerW / (fs * 0.56)));
        let tLines = wrapText(title, tMax);
        if (tLines.length > 2) {
            tLines = tLines.slice(0, 2);
            const l = tLines[1];
            tLines[1] = (l.length > tMax ? l.slice(0, tMax - 1) : l) + '\u2026';
        }
        const bFs = Math.max(11, fs - 2);
        const bMax = Math.max(6, Math.floor(innerW / (bFs * 0.54)));
        let bLines = wrapText(body, bMax);
        const lhT = Math.max(15, Math.round(fs * 1.3));
        const lhB = Math.max(13, Math.round(bFs * 1.3));
        let cursor = n.y + 14 + fs;
        let tSpans = '';
        tLines.forEach(ln => {
            tSpans += '<tspan x="' + (n.x + n.w / 2).toFixed(1) + '" y="' + cursor.toFixed(1) + '">' + App.esc(ln) + '</tspan>';
            cursor += lhT;
        });
        cursor += 6;
        const divY = cursor - lhT * 0.55;
        const avail = (n.y + n.h - 12) - cursor;
        const maxB = Math.max(0, Math.floor(avail / lhB));
        if (bLines.length > maxB) {
            bLines = bLines.slice(0, maxB);
            if (maxB > 0) {
                const l = bLines[maxB - 1] || '';
                bLines[maxB - 1] = (l.length > bMax ? l.slice(0, bMax - 1) : l) + '\u2026';
            }
        }
        let bSpans = '';
        bLines.forEach(ln => {
            bSpans += '<tspan x="' + (n.x + n.w / 2).toFixed(1) + '" y="' + cursor.toFixed(1) + '">' + App.esc(ln) + '</tspan>';
            cursor += lhB;
        });
        const fg = contrast(fill);
        const shapeEl = '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="12" ' +
            'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + '/>';
        const divider = '<line x1="' + (n.x + 13) + '" y1="' + divY.toFixed(1) + '" x2="' + (n.x + n.w - 13) +
            '" y2="' + divY.toFixed(1) + '" stroke="' + fg + '" stroke-opacity="0.3" stroke-width="1.2" pointer-events="none"/>';
        const tEl = '<text text-anchor="middle" font-size="' + fs + '" font-weight="700" fill="' + fg +
            '" font-family="system-ui, -apple-system, sans-serif" pointer-events="none">' + tSpans + '</text>';
        const bEl = bSpans
            ? '<text text-anchor="middle" font-size="' + bFs + '" fill="' + fg + '" fill-opacity="0.82" ' +
            'font-family="system-ui, -apple-system, sans-serif" pointer-events="none">' + bSpans + '</text>'
            : '';
        if (labelOnly) return divider + tEl + bEl;
        return '<g class="sc-node sc-card" data-nid="' + n.id + '">' + shapeEl + divider + tEl + bEl + handle + '</g>';
    }

    function nodeHtml(n, labelOnly) {
        const selected = ed.sel && ed.sel.t === 'node' && ed.sel.id === n.id;
        const from = ed.connectFrom === n.id;
        const st = styleDefaults(ed.doc);
        const fs = FONT_SIZES.indexOf(Number(n.fontSize)) >= 0 ? Number(n.fontSize) : st.fontSize;
        const bold = (n.bold === undefined || n.bold === null) ? st.bold : !!n.bold;
        const shape = SHAPES.indexOf(n.shape) >= 0 ? n.shape : st.shape;
        const isImage = !!n.image && !!n.src;
        const fill = n.color || st.nodeFill;
        const border = n.border || st.nodeBorder;
        const isRoot = !from && strat() && strat().evidenziaRadice && ed.rootSet && ed.rootSet[n.id];
        const stroke = (from || isRoot) ? '#f9974a' : border;
        const sw = selected ? (isRoot ? 3.2 : 2.5) : (isRoot ? 2.4 : 1.6);
        const dash = from ? ' stroke-dasharray="6 4"' : '';
        const handle = selected
            ? '<rect class="sc-handle" data-nid="' + n.id + '" x="' + (n.x + n.w - 7) + '" y="' + (n.y + n.h - 7) +
            '" width="14" height="14" rx="3" fill="#f9974a" stroke="#141824" stroke-width="1"/>'
            : '';
        if (isImage) {
            if (labelOnly) return '';   // nodo immagine: nessun testo in overlay
            return '<g class="sc-node" data-nid="' + n.id + '">' +
                '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="10" ' +
                'fill="#ffffff" fill-opacity="0.05" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + '/>' +
                '<image href="' + App.esc(n.src) + '" x="' + (n.x + 4) + '" y="' + (n.y + 4) +
                '" width="' + Math.max(8, n.w - 8) + '" height="' + Math.max(8, n.h - 8) +
                '" preserveAspectRatio="xMidYMid meet" pointer-events="none"/>' +
                handle +
                '</g>';
        }
        if (strat() && strat().vistaCard) return nodeCardHtml(n, fs, fill, stroke, sw, dash, handle, labelOnly);
        const maxChars = Math.max(6, Math.floor((n.w - 18) / (fs * 0.56)));
        let lines = wrapText(n.text, maxChars);
        const lh = Math.max(14, Math.round(fs * 1.34));
        const maxLines = Math.max(1, Math.floor((n.h - 10) / lh));
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            const last = lines[maxLines - 1] || '';
            lines[maxLines - 1] = (last.length > maxChars ? last.slice(0, maxChars - 1) : last) + '\u2026';
        }
        const startY = n.y + n.h / 2 - (lines.length - 1) * lh / 2 + fs * 0.35;
        let tspans = '';
        lines.forEach((ln, i) => {
            tspans += '<tspan x="' + (n.x + n.w / 2).toFixed(1) + '" y="' + (startY + i * lh).toFixed(1) + '">' + App.esc(ln) + '</tspan>';
        });
        let shapeEl;
        if (shape === 'ellipse') {
            shapeEl = '<ellipse cx="' + (n.x + n.w / 2) + '" cy="' + (n.y + n.h / 2) +
                '" rx="' + (n.w / 2) + '" ry="' + (n.h / 2) +
                '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + '/>';
        } else {
            let rx = 10;
            if (shape === 'rect') rx = 0;
            else if (shape === 'pill') rx = Math.max(1, n.h / 2);
            shapeEl = '<rect x="' + n.x + '" y="' + n.y + '" width="' + n.w + '" height="' + n.h + '" rx="' + rx + '" ' +
                'fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + '/>';
        }
        const textEl = '<text text-anchor="middle" font-size="' + fs + '"' + (bold ? ' font-weight="700"' : '') +
            ' fill="' + contrast(fill) + '" font-family="system-ui, -apple-system, sans-serif" pointer-events="none">' +
            tspans + '</text>';
        if (labelOnly) return textEl;
        return '<g class="sc-node" data-nid="' + n.id + '">' +
            shapeEl +
            textEl +
            handle +
            '</g>';
    }

    /* B1a - overlay (.sc-overlay): COPIA dei testi nodo, painted SOPRA gli archi.
       I gruppi .sc-node restano identici (i test ne leggono textContent/conteggi e
       il primo [data-nid] in ordine DOM deve restare il gruppo fill): l'overlay usa
       class "sc-label" SENZA data-nid e pointer-events:none, quindi non altera i
       conteggi g.sc-node[data-nid] ne' la selezione. */
    function nodeLabelHtml(n) {
        if (!ed || !n) return '';
        const inner = nodeHtml(n, true);
        if (!inner) return '';
        return '<g class="sc-label" pointer-events="none">' + inner + '</g>';
    }

    function strokePts(d) {
        let s = '';
        for (let i = 0; i < d.pts.length; i++) {
            s += (i ? ' ' : '') + (Math.round(d.pts[i][0] * 10) / 10) + ',' + (Math.round(d.pts[i][1] * 10) / 10);
        }
        return s;
    }

    function drawHtml() {
        if (!ed || !Array.isArray(ed.doc.drawings)) return '';
        let h = '';
        ed.doc.drawings.forEach(d => {
            const sel = ed.sel && ed.sel.t === 'stroke' && ed.sel.id === d.id;
            const pts = strokePts(d);
            let box = '';
            if (sel) {
                let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
                d.pts.forEach(p => {
                    x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
                    x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
                });
                const pad = d.size / 2 + 6;
                box = '<rect x="' + (x1 - pad).toFixed(1) + '" y="' + (y1 - pad).toFixed(1) +
                    '" width="' + (x2 - x1 + pad * 2).toFixed(1) + '" height="' + (y2 - y1 + pad * 2).toFixed(1) +
                    '" rx="5" fill="none" stroke="#f9974a" stroke-width="1.4" stroke-dasharray="5 4" pointer-events="none"/>';
            }
            h += '<g class="sc-stroke" data-sid="' + d.id + '">' +
                '<polyline points="' + pts + '" fill="none" stroke="rgba(0,0,0,0)" stroke-width="' + (d.size + 8) +
                '" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"/>' +
                '<polyline points="' + pts + '" fill="none" stroke="' + d.color + '" stroke-width="' + (sel ? d.size + 1 : d.size) +
                '" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>' +
                box + '</g>';
        });
        if (ed.drawing) {
            h += '<polyline points="' + strokePts(ed.drawing) + '" fill="none" stroke="' + ed.drawing.color +
                '" stroke-width="' + ed.drawing.size + '" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>';
        }
        return h;
    }

    /* Guide leggere (colonne/righe) decise da strategy.ui().guide. */
    function guideHtml() {
        if (!ed || !ed.strategy) return '';
        const modo = ed.strategy.ui().guide;
        if (!modo) return '';
        const ns = ed.doc.nodes;
        if (ns.length < 2) return '';
        const verticali = modo === 'colonne';
        const vals = ns.map(n => verticali ? (n.x + n.w / 2) : (n.y + n.h / 2)).sort((a, b) => a - b);
        const groups = [];
        vals.forEach(v => {
            const g = groups[groups.length - 1];
            if (g && v - g[g.length - 1] <= 44) g.push(v);
            else groups.push([v]);
        });
        let h = '';
        // B1: linee continue, leggerissime, estese a tutto il mondo SVG (±50000)
        // così coprono sempre tutta la vista; nessun tratteggio, nessun segmento
        // dai bordi dei nodi (niente overshoot ±18px), resta solo la posizione
        // (centro del gruppo) calcolata con la tolleranza esistente (44).
        const SPAN = 50000;
        const col = 'rgba(140,164,255,.11)';
        groups.forEach(g => {
            const c = g.reduce((s, v) => s + v, 0) / g.length;
            if (verticali) {
                h += '<line x1="' + c.toFixed(1) + '" y1="' + (-SPAN) +
                    '" x2="' + c.toFixed(1) + '" y2="' + SPAN +
                    '" stroke="' + col + '" stroke-width="1" pointer-events="none"/>';
            } else {
                h += '<line x1="' + (-SPAN) + '" y1="' + c.toFixed(1) +
                    '" x2="' + SPAN + '" y2="' + c.toFixed(1) +
                    '" stroke="' + col + '" stroke-width="1" pointer-events="none"/>';
            }
        });
        return h;
    }

    function render() {
        if (!ed) return;
        // BLOCCO 2.2c: un solo NaN qui svuoterebbe tutto il canvas (transform globale)
        if (!isFinite(ed.view.x)) ed.view.x = 0;
        if (!isFinite(ed.view.y)) ed.view.y = 0;
        if (!isFinite(ed.view.zoom) || ed.view.zoom <= 0) ed.view.zoom = 1;
        ed.gW.setAttribute('transform',
            'translate(' + ed.view.x.toFixed(2) + ',' + ed.view.y.toFixed(2) + ') scale(' + ed.view.zoom.toFixed(4) + ')');
        const hasIn = {};
        ed.doc.edges.forEach(e => { hasIn[e.to] = true; });
        ed.rootSet = hasIn;
        let eh = '';
        ed.doc.edges.forEach(e => { eh += edgeHtml(e); });
        ed.gEdges.innerHTML = eh;
        if (ed.gGuide) ed.gGuide.innerHTML = guideHtml();
        if (ed.gDraw) ed.gDraw.innerHTML = drawHtml();
        let nh = '', lh = '';
        ed.doc.nodes.forEach(n => { nh += nodeHtml(n); lh += nodeLabelHtml(n); });
        ed.gNodes.innerHTML = nh;
        if (ed.gOverlay) ed.gOverlay.innerHTML = lh;
        const zl = ed.stage.querySelector('.sc-zoom');
        if (zl) zl.textContent = Math.round(ed.view.zoom * 100) + '%';
        updateChrome();
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // Sfoca gli input interni attivi: preventDefault sul pointerdown
    // blocca la perdita di focus naturale, quindi la gestiamo a mano
    // (la textarea del nodo e quelle del pannello si chiudono con blur).
    function blurActive() {
        const a = document.activeElement;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && container && container.contains(a)) {
            try { a.blur(); } catch (e) { /* ok */ }
        }
    }

    function centerView() {
        if (!ed) return;
        const cw = ed.stage.clientWidth, ch = ed.stage.clientHeight;
        // SOLO nodi con geometria finita: un NaN nei bounds propagherebbe al transform
        const ns = ed.doc.nodes.filter(n =>
            isFinite(n.x) && isFinite(n.y) && isFinite(n.w) && isFinite(n.h));
        if (!ns.length) {
            ed.view = { x: 0, y: 0, zoom: 1 };
            render();
            return;
        }
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        ns.forEach(n => {
            if (n.x < minx) minx = n.x;
            if (n.y < miny) miny = n.y;
            if (n.x + n.w > maxx) maxx = n.x + n.w;
            if (n.y + n.h > maxy) maxy = n.y + n.h;
        });
        const pad = 40;   // BLOCCO 2.4: era 70
        const w = Math.max(1, maxx - minx), h = Math.max(1, maxy - miny);
        let z = clamp(Math.min((cw - pad * 2) / w, (ch - pad * 2) / h), 0.25, 2.0);   // clamp [0.25, 2.0]
        if (!isFinite(z)) z = 1;
        let vx = (cw - w * z) / 2 - minx * z;
        let vy = (ch - h * z) / 2 - miny * z;
        if (!isFinite(vx)) vx = 0;
        if (!isFinite(vy)) vy = 0;
        ed.view.zoom = z;
        ed.view.x = vx;
        ed.view.y = vy;
        render();
    }

        function zoomAt(mx, my, factor) {
        if (!ed) return;
        const wx = (mx - ed.view.x) / ed.view.zoom;
        const wy = (my - ed.view.y) / ed.view.zoom;
        ed.view.zoom = clamp(ed.view.zoom * factor, 0.25, 2.0);
        ed.view.x = mx - wx * ed.view.zoom;
        ed.view.y = my - wy * ed.view.zoom;
        render();
    }

    // ---------- selezione / comandi ----------
    function select(t, id) {
        if (!ed) return;
        ed.sel = t ? { t: t, id: id } : null;
        ed.textPushedFor = null;
        ed.stylePushedFor = null;
        render();
    }

    function addNode(x, y) {
        pushUndoSnapshot();   // B3: aggiunta nodo = UN solo passo (l'arco subito dopo e' lo stesso passo)
        const st = styleDefaults(ed.doc);
        const s = strat();
        const size = (s && s.nodeSize) ? s.nodeSize() : { w: 170, h: 60 };
        const n = {
            id: uuid(),
            x: Math.round(x), y: Math.round(y),
            w: size.w, h: size.h,
            text: 'Nuovo nodo',
            color: st.nodeFill, border: st.nodeBorder,
            shape: st.shape,
            fontSize: (size.fontSize != null) ? Math.max(st.fontSize, size.fontSize) : st.fontSize,
            bold: st.bold
        };
        ed.doc.nodes.push(n);
        if (ed.doc.nodes.length === 1) refreshToolbar();   // BLOCCO 1.3: bootstrap 0 -> 1 nodo
        select('node', n.id);
        scheduleSave();
        return n;
    }

    function viewCenterWorld() {
        const cw = ed.stage.clientWidth, ch = ed.stage.clientHeight;
        return {
            x: (cw / 2 - ed.view.x) / ed.view.zoom,
            y: (ch / 2 - ed.view.y) / ed.view.zoom
        };
    }

    function screenToWorld(cx, cy) {
        const r = ed.svg.getBoundingClientRect();
        return {
            x: (cx - r.left - ed.view.x) / ed.view.zoom,
            y: (cy - r.top - ed.view.y) / ed.view.zoom
        };
    }

    function cmdAddNode() {
        if (!ed) return;
        if (!ed.doc.nodes.length) {
            const c = viewCenterWorld();
            addNode(c.x - 85, c.y - 30);
            return;
        }
        const pos = strat().placeNewNode(null, ed.doc, 'figlio');
        addNode(pos.x, pos.y);
    }

    function cmdAddChild() {
        if (!ed || !ed.sel || ed.sel.t !== 'node') return;
        const p = nodeById(ed.sel.id);
        if (!p) return;
        const pos = strat().placeNewNode(p, ed.doc, 'figlio');
        const n = addNode(pos.x, pos.y);
        const r = strat().canConnect(p.id, n.id, ed.doc);
        if (r.ok) ed.doc.edges.push({ id: uuid(), from: p.id, to: n.id, color: styleDefaults(ed.doc).edgeColor });
        else toast(r.motivo);
        render();
        scheduleSave();
    }

    function cmdAddSibling() {
        if (!ed || !ed.sel || ed.sel.t !== 'node') return;
        const ref = nodeById(ed.sel.id);
        if (!ref) return;
        let parent = null;
        for (let i = 0; i < ed.doc.edges.length; i++) {
            const e = ed.doc.edges[i];
            if (!e.extra && e.to === ref.id) { parent = nodeById(e.from); break; }
        }
        const s2 = strat();
        // BLOCCO 1.2: nessun genitore -> FALLBACK (sostituisce il vecchio toast+blocco
        // dell'albero): in mappa ci si comporta come "+ Figlio" (nodo SEMPRE connesso),
        // in albero/lr/libero come "+ Nodo" (nodo isolato). Il riassunto non ha il pulsante.
        if (!parent) {
            if (s2 && s2.siblingFallback === 'child') cmdAddChild();
            else cmdAddNode();
            return;
        }
        const pos = s2.placeNewNode(ref, ed.doc, 'fratello');
        const s = addNode(pos.x, pos.y);
        const r = s2.canConnect(parent.id, s.id, ed.doc);
        if (r.ok) ed.doc.edges.push({ id: uuid(), from: parent.id, to: s.id, color: styleDefaults(ed.doc).edgeColor });
        else toast(r.motivo);
        render();
        scheduleSave();
    }

        function deleteSelection() {
        if (!ed || !ed.sel) return;
        pushUndoSnapshot();   // B3: cancellazione = UN solo passo
        if (ed.sel.t === 'edge') {
            ed.doc.edges = ed.doc.edges.filter(e => e.id !== ed.sel.id);
        } else if (ed.sel.t === 'stroke') {
            ed.doc.drawings = ed.doc.drawings.filter(d => d.id !== ed.sel.id);
        } else {
            const id = ed.sel.id;
            ed.doc.nodes = ed.doc.nodes.filter(n => n.id !== id);
            ed.doc.edges = ed.doc.edges.filter(e => e.from !== id && e.to !== id);
            if (!ed.doc.nodes.length) refreshToolbar();   // BLOCCO 1.3: 1 -> 0 nodo: matrice bootstrap
        }
        ed.sel = null;
        render();
        scheduleSave();
    }

    function toggleConnect() {
        if (!ed) return;
        ed.connecting = !ed.connecting;
        ed.connectFrom = null;
        if (ed.connecting && ed.tool === 'draw') toggleTool('normal');
        render();
    }

    function handleConnectClick(id) {
        if (!ed.connectFrom) {
            ed.connectFrom = id;
            render();
            return;
        }
        if (ed.connectFrom === id) { ed.connectFrom = null; render(); return; }
        const from = ed.connectFrom;
        // validazione con la strategia del tipo: rifiuto con toast motivato
        const res = strat().canConnect(from, id, ed.doc);
        if (!res.ok) {
            toast(res.motivo);
            ed.connectFrom = null;
            ed.connecting = false;
            render();
            return;
        }
        pushUndoSnapshot();   // B3: collegamento = UN solo passo
        ed.doc.edges.push({ id: uuid(), from: from, to: id, color: styleDefaults(ed.doc).edgeColor });
        ed.connectFrom = null;
        ed.connecting = false;
        select('node', id);
        scheduleSave();
    }

    // ---------- auto-layout (delegato alla strategia del tipo) ----------
    function animateLayout(targets, dur) {
        if (!ed || !targets) return;
        if (ed.animTimer) { cancelAnimationFrame(ed.animTimer); ed.animTimer = null; }
        const starts = [];
        ed.doc.nodes.forEach(n => {
            const t = targets[n.id];
            // BLOCCO 2.2c: target non finito -> saltalo (la posizione resta quella attuale)
            if (!t || !isFinite(t.x) || !isFinite(t.y)) return;
            const x0 = isFinite(n.x) ? n.x : t.x;
            const y0 = isFinite(n.y) ? n.y : t.y;
            starts.push({ n: n, x0: x0, y0: y0, x1: t.x, y1: t.y });
        });
        if (!starts.length) return;
        const t0 = performance.now();
        function step(ts) {
            if (!ed) return;
            const k = Math.max(0, Math.min(1, (ts - t0) / dur));
            const e = 1 - Math.pow(1 - k, 3);
            starts.forEach(f => {
                f.n.x = Math.round(f.x0 + (f.x1 - f.x0) * e);
                f.n.y = Math.round(f.y0 + (f.y1 - f.y0) * e);
            });
            render();
            if (k < 1) ed.animTimer = requestAnimationFrame(step);
            else {
                ed.animTimer = null;
                render();
                centerView();
                scheduleSave();
            }
        }
        ed.animTimer = requestAnimationFrame(step);
    }

    function autoLayout() {
        if (!ed || !ed.doc.nodes.length) return;
        const s = ed.strategy;
        if (!s) return;
        s.hubId = (ed.sel && ed.sel.t === 'node') ? ed.sel.id : null;   // hub selezionato (mappa), oppure null => grado massimo
        const targets = s.autoLayout(ed.doc.nodes, ed.doc.edges);
        if (!targets) {
            toast('Auto-layout non disponibile: lo schema libero usa solo posizionamento manuale.');
            return;
        }
        pushUndoSnapshot();   // B3: auto-layout da pulsante = UN solo passo (changeType NON passa da qui)
        animateLayout(targets, 200);
    }

    // ---------- strategia: pulsanti, cambio tipo, pannello testo ----------
    function onStrategyBtn(id) {
        if (!ed) return;
        if (id === 'node') cmdAddNode();
        else if (id === 'child') cmdAddChild();
        else if (id === 'sibling') cmdAddSibling();
        else if (id === 'del') deleteSelection();
        else if (id === 'connect') toggleConnect();
        else if (id === 'layout') autoLayout();
    }

    /* Costruisce i pulsanti richiesti da strategy.ui().pulsanti. */
    function buildStrategyButtons(wrap, strategy, doc) {
        wrap.innerHTML = '';
        const btns = {};
        if (!strategy) return btns;
        let list = strategy.ui().pulsanti;
        // BLOCCO 1.3: bootstrap — con 0 nodi TUTTI i tipi mostrano "+ Nodo";
        // da 1 nodo in su vale la matrice del tipo (spec 1.1).
        if (doc && Array.isArray(doc.nodes) && doc.nodes.length === 0 &&
            !list.some(p => p && p.id === 'node')) {
            list = [{ id: 'node', label: '+ Nodo', tooltip: 'Aggiunge un nodo' }].concat(list);
        }
        list.forEach(p => {
            if (p.tipo === 'select') {
                const sel = App.el('select', 'mini');
                sel.title = p.tooltip || p.label || '';
                p.opzioni.forEach(o => {
                    const op = App.el('option', null, App.esc(o[1]));
                    op.value = o[0];
                    sel.appendChild(op);
                });
                const cur = (doc && doc.opzioni && doc.opzioni[p.id]) ||
                    (strategy.opzioni && strategy.opzioni[p.campo]) || p.opzioni[0][0];
                sel.value = cur;
                strategy.opzioni = strategy.opzioni || {};
                strategy.opzioni[p.campo] = cur;
                sel.addEventListener('change', () => {
                    if (!ed) return;
                    ed.strategy.opzioni = ed.strategy.opzioni || {};
                    ed.strategy.opzioni[p.campo] = sel.value;
                    ed.doc.opzioni = ed.doc.opzioni || {};
                    ed.doc.opzioni[p.id] = sel.value;
                    render();
                    scheduleSave();
                });
                wrap.appendChild(sel);
                btns[p.id] = sel;
                return;
            }
            const b = btn('tool-btn', p.label, () => onStrategyBtn(p.id));
            b.title = p.tooltip || '';
            if (p.disabilitato) b.disabled = true;
            wrap.appendChild(b);
            btns[p.id] = b;
        });
        return btns;
    }

    function refreshToolbar() {
        if (!ed || !ed.btnWrap) return;
        ed.btns = buildStrategyButtons(ed.btnWrap, ed.strategy, ed.doc);
        updateChrome();
    }

    /* BLOCCO 2.6 — undo minimo del cambio tipo.
       Snapshot PRIMA del changeType: {type, posizioni nodi, archi, view};
       stack capped a 30; Ctrl+Z ripristina TUTTO in un solo passo. */
    const UNDO_CAP = 30;
    function makeSnapshot() {
        if (!ed) return null;
        const d = ed.doc;
        return {
            type: d.type,
            nodes: JSON.parse(JSON.stringify(d.nodes || [])),
            edges: JSON.parse(JSON.stringify(d.edges || [])),
            drawings: JSON.parse(JSON.stringify(d.drawings || [])),
            style: d.style ? JSON.parse(JSON.stringify(d.style)) : null,
            riassunto: d.riassunto,
            view: { x: ed.view.x, y: ed.view.y, zoom: ed.view.zoom }
        };
    }
    function pushSnapshotObj(snap) {
        if (!ed || !snap) return;
        if (!Array.isArray(ed.undoStack)) ed.undoStack = [];
        ed.undoStack.push(snap);
        if (ed.undoStack.length > UNDO_CAP) ed.undoStack.shift();
        if (Array.isArray(ed.redoStack)) ed.redoStack.length = 0;
    }
    function pushUndoSnapshot() {
        pushSnapshotObj(makeSnapshot());
    }

    /* B3 - applica uno snapshot COMPLETO in UN passo (usato da undo e redo). */
    function applySnapshot(snap) {
        if (!ed || !snap) return false;
        // ferma un'eventuale animazione di layout ancora in corso
        if (ed.animTimer) { cancelAnimationFrame(ed.animTimer); ed.animTimer = null; }
        const d = ed.doc;
        d.type = snap.type;
        if (Array.isArray(snap.nodes)) d.nodes = snap.nodes;
        if (Array.isArray(snap.edges)) d.edges = snap.edges;
        if (Array.isArray(snap.drawings)) d.drawings = snap.drawings;
        if (snap.style) d.style = snap.style;
        if (snap.riassunto !== undefined) d.riassunto = snap.riassunto;
        ed.connecting = false;
        ed.connectFrom = null;
        ed.drawing = null;
        ed.textPushedFor = null;
        ed.stylePushedFor = null;
        // selezione pendente su un elemento non piu' presente -> azzerala
        if (ed.sel) {
            if (ed.sel.t === 'node' && !nodeById(ed.sel.id)) ed.sel = null;
            else if (ed.sel.t === 'edge' && !d.edges.some(e => e.id === ed.sel.id)) ed.sel = null;
            else if (ed.sel.t === 'stroke' && !(d.drawings || []).some(x => x.id === ed.sel.id)) ed.sel = null;
        }
        if (snap.view && isFinite(snap.view.x) && isFinite(snap.view.y) &&
            isFinite(snap.view.zoom) && snap.view.zoom > 0) {
            ed.view = { x: snap.view.x, y: snap.view.y, zoom: snap.view.zoom };
        } else {
            centerView();
        }
        ed.strategy = (typeof SchemaStrategies !== 'undefined')
            ? SchemaStrategies.getStrategy(d.type) : ed.strategy;
        if (ed.strategy && d.opzioni) {
            ed.strategy.opzioni = Object.assign({}, ed.strategy.opzioni || {}, d.opzioni);
        }
        refreshToolbar();
        // auto-apertura del pannello Testo SOLO per il tipo che lo prevede
        if (ed.strategy && ed.strategy.ui().pannelloTesto) { toggleSide(true); showTab('testo'); }
        if (ed.risTa && document.activeElement !== ed.risTa) ed.risTa.value = d.riassunto || '';
        render();
        scheduleSave();
        return true;
    }
    /* Undo: toglie l'ultimo snapshot e lo applica in UN passo (lo stato corrente
       va sul redoStack per il Ctrl+Y / Ctrl+Shift+Z). */
    function undoChangeType() {
        if (!ed || !Array.isArray(ed.undoStack) || !ed.undoStack.length) return false;
        const snap = ed.undoStack.pop();
        const cur = makeSnapshot();
        if (cur) {
            if (!Array.isArray(ed.redoStack)) ed.redoStack = [];
            ed.redoStack.push(cur);
        }
        return applySnapshot(snap);
    }
    /* Redo: ripristina lo stato annullato in UN passo. */
    function redo() {
        if (!ed || !Array.isArray(ed.redoStack) || !ed.redoStack.length) return false;
        const snap = ed.redoStack.pop();
        const cur = makeSnapshot();
        if (cur) {
            if (!Array.isArray(ed.undoStack)) ed.undoStack = [];
            ed.undoStack.push(cur);
            if (ed.undoStack.length > UNDO_CAP) ed.undoStack.shift();
        }
        return applySnapshot(snap);
    }

    /* TASK 3 — "Cambia tipo" su schema esistente:
       conserva SEMPRE nodi e archi (fonte di verita' = grafo salvato), valida ogni
       arco con canConnect della nuova strategia (gli invalidi restano marcati extra
       tratteggiati: NESSUNA conferma, NESSUNA rimozione — spec 2.1/2.5), aggiorna
       pulsanti/pannelli, riesegue l'auto-layout con animazione ~200ms e fit. */
    function changeType(nuovo) {
        if (!ed || ed.doc.type === nuovo) return;
        pushUndoSnapshot();   // BLOCCO 2.6: il cambio tipo e' UN solo passo di undo
        if (typeof SchemaStrategies === 'undefined') { ed.doc.type = nuovo; scheduleSave(); return; }
        const s = SchemaStrategies.getStrategy(nuovo);
        SchemaStrategies.migrateSchema(ed.doc, nuovo);   // nodi/archi conservati; extra = non validi (MAI rimossi)
        ed.strategy = s;
        if (s && ed.doc.opzioni) s.opzioni = Object.assign({}, s.opzioni || {}, ed.doc.opzioni);

        // BLOCCO 2 (strategia): azzera gli artefatti di rendering transitori —
        // bordo nodo tratteggiato (connectFrom) e polilinea pending (drawing):
        // non devono sopravvivere alla transizione di tipo ("linee spurie").
        ed.connecting = false;
        ed.connectFrom = null;
        ed.drawing = null;
        // Hub deterministico del layout radiale (lo legge solo la strategia
        // mappa): nodo selezionato, oppure null => grado massimo.
        if (s) s.hubId = (ed.sel && ed.sel.t === 'node') ? ed.sel.id : null;

        // BLOCCO 2.5: gli archi non validi restano SOLO marcati extra (tratteggiati):
        // nessun confirm(), nessuna rimozione (il confirm di prima e' stato eliminato).
        refreshToolbar();   // pulsanti (matrice del tipo, letta da ed.doc.nodes)
        if (s.ui().pannelloTesto) { toggleSide(true); showTab('testo'); }   // auto-apertura SOLO per il tipo col pannello Testo
        scheduleSave();
        render();           // guide aggiornate
        const targets = s.autoLayout(ed.doc.nodes, ed.doc.edges);
        if (targets) animateLayout(targets, 200);   // ~200ms + centerView al termine (fit pad 40)
        else centerView();                          // libero (targets null): fit comunque
    }

        /* Pannello testo (riassunto visuale): sincronizzato col nodo selezionato. */
    function syncTestoPanel() {
        if (!ed || !ed.taTesto || ed.sideTab !== 'testo') return;
        const n = (ed.sel && ed.sel.t === 'node') ? nodeById(ed.sel.id) : null;
        const full = n ? String(n.text || '') : '';
        if (document.activeElement !== ed.taTesto) ed.taTesto.value = full;
        if (ed.inTitolo && document.activeElement !== ed.inTitolo) ed.inTitolo.value = full ? full.split('\n')[0] : '';
        // senza selezione: hint VISIBILE + editor in attesa (disabled, non urticante)
        ed.taTesto.disabled = !n;
        if (ed.inTitolo) ed.inTitolo.disabled = !n;
        if (ed.testoNote) ed.testoNote.textContent = n
            ? 'Card selezionata: prima riga = titolo, le righe successive sono il corpo.'
            : 'Seleziona un nodo per scrivere qui il suo testo (titolo + corpo).';
    }

    // ---------- testo nodo: overlay ----------
    function closeNodeText(commit) {
        if (!ed || !ed.textTa) return;
        const ta = ed.textTa, n = ed.textNode;
        ed.textTa = null;
        ed.textNode = null;
        if (commit && n) {
            const v = ta.value.replace(/\s+$/, '').trim();
            if (v && v !== n.text) {
                if (ed && ed.textSnap) pushSnapshotObj(ed.textSnap);   // B3: edit testo overlay = UN passo
                n.text = v;
                scheduleSave();
            }
        }
        if (ed) ed.textSnap = null;
        if (ta.parentNode) ta.parentNode.removeChild(ta);
        render();
    }

    function openNodeText(n) {
        if (!ed) return;
        closeNodeText(true);
        ed.textSnap = makeSnapshot();   // B3: pre-stato dell'edit (pushato solo se il testo cambia)
        const z = ed.view.zoom;
        const ta = document.createElement('textarea');
        ta.style.left = (ed.view.x + n.x * z) + 'px';
        ta.style.top = (ed.view.y + n.y * z) + 'px';
        ta.style.width = Math.max(60, n.w * z) + 'px';
        ta.style.height = Math.max(30, n.h * z) + 'px';
        ta.style.fontSize = Math.max(10, 13 * z) + 'px';
        ta.value = n.text || '';
        ed.stage.appendChild(ta);
        ed.textTa = ta;
        ed.textNode = n;
        ta.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); closeNodeText(true); }
        });
        ta.addEventListener('blur', () => closeNodeText(true));
        setTimeout(() => { ta.focus(); ta.select(); }, 20);
    }

    // ---------- interazioni SVG ----------
    function svgDown(e) {
        if (!ed) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        // chiude/committe la casella di testo del nodo o gli input del pannello
        blurActive();
        try { ed.svg.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        const tgt = e.target;
        const handle = tgt.closest ? tgt.closest('.sc-handle') : null;
        const nodeG = tgt.closest ? tgt.closest('[data-nid]') : null;
        const edgeG = tgt.closest ? tgt.closest('[data-eid]') : null;
        const strokeG = tgt.closest ? tgt.closest('[data-sid]') : null;

        // B4: SPAZIO premuto = pan provvisorio (cursor grab), priorita' su tutto
        if (ed.spacePan) {
            ed.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: ed.view.x, vy: ed.view.y, moved: false };
            if (ed.svg) ed.svg.style.cursor = 'grabbing';
            return;
        }

        // strumento Matita: tracciato a mano libera (coordinate mondo)
        if (ed.tool === 'draw') {
            const wp = screenToWorld(e.clientX, e.clientY);
            ed.drawing = { t: 'stroke', id: null, color: ed.drawColor, size: ed.drawSize, pts: [[wp.x, wp.y]] };
            ed.drag = { mode: 'drawstroke' };
            render();
            return;
        }

        if (ed.connecting) {
            if (nodeG) handleConnectClick(nodeG.getAttribute('data-nid'));
            else { ed.connecting = false; ed.connectFrom = null; render(); }
            return;
        }

        if (handle) {
            const n = nodeById(handle.getAttribute('data-nid'));
            if (n) {
                ed.sel = { t: 'node', id: n.id };
                ed.drag = { mode: 'resize', id: n.id, sx: e.clientX, sy: e.clientY, ow: n.w, oh: n.h, moved: false, snap: makeSnapshot() };
                render();
            }
            return;
        }
        if (nodeG) {
            const id = nodeG.getAttribute('data-nid');
            const n = nodeById(id);
            if (!n) return;
            ed.sel = { t: 'node', id: id };
            ed.drag = { mode: 'move', id: id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false, snap: makeSnapshot() };
            render();
            return;
        }
        if (strokeG) {
            const sid = strokeG.getAttribute('data-sid');
            const dr = (ed.doc.drawings || []).filter(x => x.id === sid)[0];
            if (dr) {
                ed.sel = { t: 'stroke', id: sid };
                ed.drag = {
                    mode: 'moveStroke', id: sid, sx: e.clientX, sy: e.clientY,
                    pts0: dr.pts.map(p => [p[0], p[1]]), moved: false, snap: makeSnapshot()
                };
                render();
            }
            return;
        }
        if (edgeG) {
            ed.sel = { t: 'edge', id: edgeG.getAttribute('data-eid') };
            ed.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: ed.view.x, vy: ed.view.y, moved: false };
            render();
            return;
        }
        // sfondo: pan (e deselezione al click fermo)
        ed.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: ed.view.x, vy: ed.view.y, moved: false, onBg: true };
    }

    function svgMove(e) {
        if (!ed || !ed.drag) return;
        const d = ed.drag;
        const z = ed.view.zoom;
        if (d.mode === 'pan') {
            const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            ed.view.x = d.vx + dx;
            ed.view.y = d.vy + dy;
            render();
        } else if (d.mode === 'move') {
            const n = nodeById(d.id);
            if (!n) return;
            const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
            if (!d.moved && Math.hypot((e.clientX - d.sx), (e.clientY - d.sy)) > 3) d.moved = true;
            if (d.moved) {
                let nx = d.ox + dx, ny = d.oy + dy;
                const sn = ed.strategy ? ed.strategy.snap() : null;
                if (sn && sn.attivo) {
                    const g = sn.griglia || 10;
                    nx = Math.round(nx / g) * g;
                    ny = Math.round(ny / g) * g;
                } else {
                    nx = Math.round(nx);
                    ny = Math.round(ny);
                }
                n.x = nx;
                n.y = ny;
                render();
            }
        } else if (d.mode === 'resize') {
            const n = nodeById(d.id);
            if (!n) return;
            const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
            if (!d.moved && Math.hypot((e.clientX - d.sx), (e.clientY - d.sy)) > 3) d.moved = true;
            if (d.moved) {
                n.w = Math.max(80, Math.round(d.ow + dx));
                n.h = Math.max(36, Math.round(d.oh + dy));
                render();
            }
        } else if (d.mode === 'drawstroke') {
            if (ed.drawing) {
                const p = screenToWorld(e.clientX, e.clientY);
                const pts = ed.drawing.pts;
                const last = pts[pts.length - 1];
                if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 1.2 / z) {
                    pts.push([p[0], p[1]]);
                    render();
                }
            }
        } else if (d.mode === 'moveStroke') {
            const dr = (ed.doc.drawings || []).filter(x => x.id === d.id)[0];
            if (!dr) return;
            const mdx = (e.clientX - d.sx) / z, mdy = (e.clientY - d.sy) / z;
            if (!d.moved && Math.hypot((e.clientX - d.sx), (e.clientY - d.sy)) > 3) d.moved = true;
            if (d.moved) {
                dr.pts = d.pts0.map(p => [p[0] + mdx, p[1] + mdy]);
                render();
            }
        }
    }

    function svgUp(e) {
        if (!ed || !ed.drag) return;
        const d = ed.drag;
        ed.drag = null;
        try { ed.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ok */ }
        if (d.mode === 'pan' && ed.spacePan && ed.svg) ed.svg.style.cursor = 'grab';
        if (d.mode === 'drawstroke') {
            const dr = ed.drawing;
            ed.drawing = null;
            if (dr) {
                let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
                dr.pts.forEach(p => {
                    x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]);
                    x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]);
                });
                // scarta micro-clic accidentali (es. doppio click su un nodo)
                if (dr.pts.length >= 3 && Math.hypot(x2 - x1, y2 - y1) >= 3) {
                    dr.id = uuid();
                    if (!Array.isArray(ed.doc.drawings)) ed.doc.drawings = [];
                    ed.doc.drawings.push(dr);
                    scheduleSave();
                }
            }
            render();
            return;
        }
        if (d.moved && d.snap) pushSnapshotObj(d.snap);   // B3: drag = UN solo passo (pre-stato da svgDown)
        if (d.moved) scheduleSave();
        else if (d.onBg && ed.sel) { ed.sel = null; render(); }
    }

    function onWheel(e) {
        if (!ed) return;
        e.preventDefault();
        const r = ed.svg.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        // B4: shift+rotella = pan orizzontale, rotella sola = zoom (pan anche su sfondo/SPAZIO)
        if (e.shiftKey) {
            ed.view.x -= (e.deltaY || e.deltaX || 0);
            render();
            return;
        }
        zoomAt(mx, my, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }

    function onDblClick(e) {
        if (!ed) return;
        const tgt = e.target;
        const nodeG = tgt.closest ? tgt.closest('[data-nid]') : null;
        if (nodeG) {
            const n = nodeById(nodeG.getAttribute('data-nid'));
            if (!n) return;
            if (n.image) { replaceImage(n); return; }
            openNodeText(n);
            return;
        }
        const edgeG = tgt.closest ? tgt.closest('[data-eid]') : null;
        // etichetta editabile SOLO dove la strategia la prevede (mappa concettuale)
        if (edgeG && ed.strategy && ed.strategy.edgeStyle().etichetta) {
            const eid = edgeG.getAttribute('data-eid');
            const edge = ed.doc.edges.filter(x => x.id === eid)[0];
            if (!edge) return;
            askText('Etichetta collegamento', 'Testo dell\u2019etichetta', edge.label || '', true)
                .then(v => {
                    if (v === null || !ed) return;
                    if (edge.label !== v) pushUndoSnapshot();   // B3: etichetta = UN passo
                    edge.label = v;
                    render();
                    scheduleSave();
                });
        }
    }

    function onKey(e) {
        if (!ed) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        if (ed.textTa) return;
        // B4: SPAZIO premuto -> pan provvisorio con cursor grab (rilascio in onKeyUp)
        if (e.key === ' ' || e.code === 'Space') {
            if (!ed.spacePan) {
                ed.spacePan = true;
                if (ed.svg && ed.tool !== 'draw') ed.svg.style.cursor = 'grab';
            }
            e.preventDefault();
            return;
        }
        // BLOCCO 2.6: Ctrl+Z = annulla l'ultimo cambio tipo in UN passo.
        // Solo ctrl+z (nessun shift): non tocca ctrl+s, ctrl+y o altre scorciatoie.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey &&
            String(e.key).toLowerCase() === 'z') {
            if (undoChangeType()) e.preventDefault();
            return;
        }
        // B3: Ctrl+Y (e Ctrl+Shift+Z) = ripristina in UN passo
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey &&
            String(e.key).toLowerCase() === 'y') {
            if (redo()) e.preventDefault();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey &&
            String(e.key).toLowerCase() === 'z') {
            if (redo()) e.preventDefault();
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (ed.sel) { e.preventDefault(); deleteSelection(); }
        } else if (e.key === 'Escape') {
            ed.spacePan = false;
            if (ed.svg && ed.tool !== 'draw') ed.svg.style.cursor = '';
            if (ed.tool === 'draw') { toggleTool('normal'); }
            else if (ed.connecting) { ed.connecting = false; ed.connectFrom = null; render(); }
            else if (ed.sel) select(null);
        }
    }

    // B4: rilascio SPAZIO -> fine del pan provvisorio (cursor torna a default/matita)
    function onKeyUp(e) {
        if (!ed) return;
        if (e.key === ' ' || e.code === 'Space') {
            ed.spacePan = false;
            if (ed.svg) ed.svg.style.cursor = ed.tool === 'draw' ? 'crosshair' : '';
        }
    }

        // ---------- colori ----------
    function validHex(v, fallback) {
        return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : fallback;
    }

    // Applica uno stile: aggiorna il default del documento e,
    // se c'e' una selezione, anche quell'elemento.
    function applyStyle(which, value) {
        if (!ed) return;
        const styleKey = which + ':' + (ed.sel ? ed.sel.t + ed.sel.id : '-');   // B3: coalescenza undo
        if (ed.stylePushedFor !== styleKey) { pushUndoSnapshot(); ed.stylePushedFor = styleKey; }
        const s = ed.doc.style || (ed.doc.style = {});
        if (which === 'palette') {
            s.palette = value === 'chiara' ? 'chiara' : 'scura';
            const light = s.palette === 'chiara';
            s.nodeFill = light ? '#ffffff' : NODE_COLOR;
            s.nodeBorder = light ? '#2c3550' : NODE_BORDER;
            s.edgeColor = light ? '#3d5afe' : EDGE_COLOR;
        } else if (which === 'fill') s.nodeFill = validHex(value, s.nodeFill);
        else if (which === 'border') s.nodeBorder = validHex(value, s.nodeBorder);
        else if (which === 'edge') s.edgeColor = validHex(value, s.edgeColor);
        else if (which === 'fontSize') s.fontSize = FONT_SIZES.indexOf(Number(value)) >= 0 ? Number(value) : 14;
        else if (which === 'bold') s.bold = !!value;
        else if (which === 'shape') s.shape = SHAPES.indexOf(value) >= 0 ? value : 'round';

        if (ed.sel && ed.sel.t === 'node') {
            const n = nodeById(ed.sel.id);
            if (n) {
                if (which === 'fill') n.color = s.nodeFill;
                else if (which === 'border') n.border = s.nodeBorder;
                else if (which === 'fontSize') n.fontSize = s.fontSize;
                else if (which === 'bold') n.bold = s.bold;
                else if (which === 'shape') n.shape = s.shape;
            }
        } else if (ed.sel && ed.sel.t === 'edge' && which === 'edge') {
            ed.doc.edges.forEach(e => { if (e.id === ed.sel.id) e.color = s.edgeColor; });
        }
        applyPaletteBg();
        syncStyleCtl();
        render();
        scheduleSave();
    }

    // Applica i valori attuali del pannello Stile alla selezione corrente
    function applyStyleToSelection() {
        if (!ed || !ed.sel || !ed.styleCtl) return;
        const asKey = 'asel:' + ed.sel.t + ed.sel.id;   // B3: coalescenza undo
        if (ed.stylePushedFor !== asKey) { pushUndoSnapshot(); ed.stylePushedFor = asKey; }
        const c = ed.styleCtl;
        if (ed.sel.t === 'node') {
            const n = nodeById(ed.sel.id);
            if (!n) return;
            n.color = validHex(c.fill.value, n.color);
            n.border = validHex(c.border.value, n.border);
            n.fontSize = FONT_SIZES.indexOf(Number(c.fontSize.value)) >= 0 ? Number(c.fontSize.value) : 14;
            n.bold = !!c.bold.checked;
            n.shape = SHAPES.indexOf(c.shape.value) >= 0 ? c.shape.value : 'round';
        } else if (ed.sel.t === 'edge') {
            ed.doc.edges.forEach(e => { if (e.id === ed.sel.id) e.color = validHex(c.edge.value, e.color); });
        } else {
            return;
        }
        render();
        scheduleSave();
    }

    // Sincronizza i controlli del pannello Stile con default/selezione
    function syncStyleCtl() {
        if (!ed || !ed.styleCtl) return;
        const st = styleDefaults(ed.doc);
        let vFill = st.nodeFill, vBorder = st.nodeBorder, vEdge = st.edgeColor;
        let vFs = String(st.fontSize), vBold = st.bold, vShape = st.shape;
        if (ed.sel && ed.sel.t === 'node') {
            const n = nodeById(ed.sel.id);
            if (n) {
                vFill = validHex(n.color, vFill);
                vBorder = validHex(n.border, vBorder);
                vFs = String(FONT_SIZES.indexOf(Number(n.fontSize)) >= 0 ? Number(n.fontSize) : st.fontSize);
                vBold = (n.bold === undefined || n.bold === null) ? st.bold : !!n.bold;
                vShape = SHAPES.indexOf(n.shape) >= 0 ? n.shape : st.shape;
            }
        } else if (ed.sel && ed.sel.t === 'edge') {
            const e = ed.doc.edges.filter(x => x.id === ed.sel.id)[0];
            if (e) vEdge = validHex(e.color, vEdge);
        }
        const c = ed.styleCtl;
        if (document.activeElement !== c.fill) c.fill.value = vFill;
        if (document.activeElement !== c.border) c.border.value = vBorder;
        if (document.activeElement !== c.edge) c.edge.value = vEdge;
        c.fontSize.value = vFs;
        c.bold.checked = vBold;
        c.shape.value = vShape;
        c.palette.value = st.palette;
    }

    function applyPaletteBg() {
        if (!ed || !ed.stage) return;
        ed.stage.style.background = styleDefaults(ed.doc).palette === 'chiara' ? '#f4f6fb' : '';
    }

    function toggleTool(tool) {
        if (!ed) return;
        ed.tool = tool === 'draw' ? 'draw' : 'normal';
        if (ed.tool !== 'draw') ed.drawing = null;
        if (ed.tool === 'draw' && ed.connecting) { ed.connecting = false; ed.connectFrom = null; }
        if (ed.bHand) ed.bHand.classList.toggle('active', ed.tool === 'draw');
        if (ed.drawOpts) ed.drawOpts.classList.toggle('on', ed.tool === 'draw');
        if (ed.svg) ed.svg.style.cursor = ed.tool === 'draw' ? 'crosshair' : '';
        render();
    }

    // ---------- salvataggio ----------
    function buildPayload(st) {
        st.doc.view = { x: st.view.x, y: st.view.y, zoom: st.view.zoom };
        return {
            id: st.itemId,
            kind: 'schema',
            title: st.title || 'Senza titolo',
            content: JSON.stringify(st.doc),
            materia: st.materia || '',
            tags: st.tags || '',
            description: st.desc || '',
            thumbnail: st.thumb || ''
        };
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
        st.dirty = false;
        try {
            const saved = await StudyStore.saveItem(payload);
            if (saved && saved.id && ed === st) st.itemId = saved.id;
        } catch (e) { console.error('Salvataggio schema:', e); }
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

    // ---------- pannello laterale ----------
    function updateChrome() {
        if (!ed) return;
        const selNode = !!(ed.sel && ed.sel.t === 'node');
        const selEdge = !!(ed.sel && ed.sel.t === 'edge');
        const selStroke = !!(ed.sel && ed.sel.t === 'stroke');
        // pulsanti decisi da strategy.ui().pulsanti
        const uiS = ed.strategy ? ed.strategy.ui() : { pulsanti: [] };
        uiS.pulsanti.forEach(p => {
            const b = ed.btns && ed.btns[p.id];
            if (!b || p.tipo === 'select') return;
            if (p.id === 'del') b.disabled = !(selNode || selEdge || selStroke);
            else if (p.id === 'child' || p.id === 'sibling') b.disabled = !selNode;
            else if (p.id === 'layout') b.disabled = !!p.disabilitato;
            if (p.id === 'connect') b.classList.toggle('active', !!ed.connecting);
            if (p.tooltip) b.title = p.tooltip;
        });
        if (ed.bUndo) ed.bUndo.disabled = !Array.isArray(ed.undoStack) || !ed.undoStack.length;
        if (ed.bRedo) ed.bRedo.disabled = !Array.isArray(ed.redoStack) || !ed.redoStack.length;
        if (ed.bHand) ed.bHand.classList.toggle('active', ed.tool === 'draw');
        if (ed.drawOpts) ed.drawOpts.classList.toggle('on', ed.tool === 'draw');
        if (ed.selType && ed.selType.value !== ed.doc.type) ed.selType.value = ed.doc.type;
        if (ed.styleCtl && ed.styleCtl.apply) ed.styleCtl.apply.disabled = !(selNode || selEdge);
        syncTestoPanel();
        syncStyleCtl();
    }

    function toggleSide(show) {
        if (!ed) return;
        ed.sideVisible = show;
        ed.side.classList.toggle('hidden', !show);
        if (show && ed.sideTab === 'fonti') refreshFontiPanel();
        render();
    }

    function showTab(which) {
        if (!ed) return;
        ed.sideTab = which;
        ed.tabR.classList.toggle('active', which === 'riassunto');
        ed.tabF.classList.toggle('active', which === 'fonti');
        if (ed.tabS) ed.tabS.classList.toggle('active', which === 'stile');
        if (ed.tabT) ed.tabT.classList.toggle('active', which === 'testo');
        ed.bodyR.style.display = which === 'riassunto' ? '' : 'none';
        ed.bodyF.style.display = which === 'fonti' ? '' : 'none';
        if (ed.bodyS) ed.bodyS.style.display = which === 'stile' ? '' : 'none';
        if (ed.bodyT) ed.bodyT.style.display = which === 'testo' ? '' : 'none';
        if (which === 'fonti') refreshFontiPanel();
        if (which === 'stile') syncStyleCtl();
        if (which === 'testo') syncTestoPanel();
    }


    // ============================================================
    // R21 B2 - tab Fonti = FontiPanel (componente unico CONGELATO,
    // window.FontiPanel, caricato in index.html PRIMA dei moduli).
    // Il vecchio tab (select .mini + .sc-preview + loadSources/loadPreview/
    // previewMatFile) e' rimosso del tutto: nessuna reimplementazione di
    // preview/ricerca (3.3). Scelta ciclo di vita: il pannello viene CREATO
    // a ogni apertura editor (dentro buildSide) e DISTRUTTO in
    // teardownEditor — nessuno stato DOM sopravvive tra editor diversi;
    // i soli dati persistenti sono le chiavi localStorage del componente
    // (fp21_filter / fp21_search_schemi / fp21_w_schemi / fp21_h_schemi).
    // Senza window.FontiPanel (harness che non lo caricano) il tab mostra
    // un fallback testuale: ZERO eccezioni a runtime.
    // ============================================================
    function refreshFontiPanel() {
        if (!ed || !ed.fontiPanel || typeof ed.fontiPanel.refresh !== 'function') return;
        try {
            const p = ed.fontiPanel.refresh();
            if (p && typeof p.catch === 'function') p.catch(function () { /* ok */ });
        } catch (e) { /* ok */ }
    }

    function mountFontiPanel(host) {
        if (!host || !ed) return;
        let fp = null;
        if (window.FontiPanel && typeof window.FontiPanel.create === 'function') {
            try {
                fp = window.FontiPanel.create({ contesto: 'schemi', onInsert: onFontiInsert });
            } catch (e) { fp = null; }   // componente congelato -> fallback sotto
        }
        if (fp && fp.el) {
            ed.fontiPanel = fp;
            host.appendChild(fp.el);
            // R22 5.1: il pannello vive nel tab (embedded), non come overlay:
            // si azzera la misura flottante INLINE del componente (340px di
            // default, pensata per il float di documenti/presentazioni) che
            // qui sfonderebbe i bordi della .sc-body; senza width inline vince
            // .sc-side .fp21-root{width:100%} e il pannello riempie la colonna.
            fp.el.style.width = '';
            return;
        }
        const fb = App.el('div', 'sc-note');
        fb.textContent = 'Pannello Fonti non disponibile.';
        host.appendChild(fb);
    }

    /* R21 B2 - onInsert(source, info): il vecchio tab NON aveva inserimento
       (solo select + preview), quindi si crea un nodo testo con il
       riferimento "Fonte: <titolo> (<tipo>)" vicino al centro della vista.
       - pushUndoSnapshot() PRIMA dell'inserimento (UN solo passo di undo);
       - provenienza: nodo.prov = {fonteId, tipo, titolo, ts} e
         doc.fpSources.push({tipo, titolo, fonteId, ts}).
       fpSources e' un campo DOC: buildPayload fa JSON.stringify(st.doc)
       -> si serializza con il salvataggio; normalizeDoc non tocca i campi
       sconosciuti e makeSnapshot/applySnapshot non lo includono -> l'undo
       rimuove il nodo ma lascia l'entry di provenienza (metadata del doc,
       mai duplicato e' un push per inserimento) e sopravvive alle riaperture. */
    function onFontiInsert(source, info) {
        if (!ed || !source) return;
        info = info || {};
        const titolo = info.titolo || source.title || 'Senza titolo';
        const tipo = info.tipo ||
            (source.kind === 'mat' ? 'Materiale' : (KIND_LABELS[source.kind] || 'Fonte'));
        const fonteId = (info.id != null) ? info.id : source.id;
        const ts = Date.now();
        pushUndoSnapshot();   // PRIMA dell'inserimento: un solo passo di undo
        const c = viewCenterWorld();
        const st = styleDefaults(ed.doc);
        const n = {
            id: uuid(),
            x: Math.round(c.x - 95), y: Math.round(c.y - 30),
            w: 190, h: 60,
            text: 'Fonte: ' + titolo + ' (' + tipo + ')',
            color: st.nodeFill, border: st.nodeBorder, shape: st.shape,
            fontSize: st.fontSize, bold: st.bold,
            prov: { fonteId: fonteId, tipo: tipo, titolo: titolo, ts: ts }
        };
        ed.doc.nodes.push(n);
        if (!Array.isArray(ed.doc.fpSources)) ed.doc.fpSources = [];
        ed.doc.fpSources.push({ tipo: tipo, titolo: titolo, fonteId: fonteId, ts: ts });
        select('node', n.id);
        render();
        scheduleSave();
    }

    function styleRow(labelText, control) {
        const r = App.el('div', 'sc-style-row');
        r.appendChild(App.el('label', null, labelText));
        r.appendChild(control);
        return r;
    }

    function buildStyleBody() {
        const body = App.el('div', 'sc-body');
        const st = styleDefaults(ed.doc);

        // Palette (tema colori dello schema)
        const selPal = App.el('select');
        [['scura', 'Scura (default)'], ['chiara', 'Chiara']].forEach(p => {
            const o = App.el('option', null, p[1]);
            o.value = p[0];
            selPal.appendChild(o);
        });
        selPal.value = st.palette;
        selPal.addEventListener('change', () => applyStyle('palette', selPal.value));
        body.appendChild(styleRow('Palette', selPal));

        function mkColor(val, which) {
            const c = document.createElement('input');
            c.type = 'color';
            c.value = validHex(val, '#ffffff');
            c.addEventListener('input', () => applyStyle(which, c.value));
            return c;
        }
        const cFill = mkColor(st.nodeFill, 'fill');
        const cBorder = mkColor(st.nodeBorder, 'border');
        const cEdge = mkColor(st.edgeColor, 'edge');
        body.appendChild(styleRow('Sfondo nodo', cFill));
        body.appendChild(styleRow('Bordo nodo', cBorder));
        body.appendChild(styleRow('Collegamento', cEdge));

        // Dimensione testo
        const selFs = App.el('select');
        FONT_SIZES.forEach(f => {
            const o = App.el('option', null, f + ' px');
            o.value = String(f);
            selFs.appendChild(o);
        });
        selFs.value = String(st.fontSize);
        selFs.addEventListener('change', () => applyStyle('fontSize', Number(selFs.value)));
        body.appendChild(styleRow('Dimensione testo', selFs));

        // Grassetto
        const chkBold = document.createElement('input');
        chkBold.type = 'checkbox';
        chkBold.checked = st.bold;
        chkBold.addEventListener('change', () => applyStyle('bold', chkBold.checked));
        body.appendChild(styleRow('Testo in grassetto', chkBold));

        // Forma nodo
        const selShape = App.el('select');
        [['round', 'Rettangolo arrotondato'], ['rect', 'Rettangolo'], ['ellipse', 'Ellisse'], ['pill', 'Pill']].forEach(p => {
            const o = App.el('option', null, p[1]);
            o.value = p[0];
            selShape.appendChild(o);
        });
        selShape.value = st.shape;
        selShape.addEventListener('change', () => applyStyle('shape', selShape.value));
        body.appendChild(styleRow('Forma nodo', selShape));

        const note = App.el('div', 'sc-note');
        note.textContent = 'Le modifiche diventano il default per nuovi nodi e archi; con un nodo o un arco selezionati vengono applicate anche a quello. La palette cambia lo sfondo dello schema e i colori di default.';
        body.appendChild(note);

        const bApply = btn('btn-secondary', 'Applica alla selezione', () => applyStyleToSelection());
        body.appendChild(bApply);

        ed.styleCtl = {
            palette: selPal, fill: cFill, border: cBorder, edge: cEdge,
            fontSize: selFs, bold: chkBold, shape: selShape, apply: bApply
        };
        return body;
    }

    function buildSide(openRiassunto) {
        const side = App.el('div', 'sc-side');
        const head = App.el('div', 'sc-side-head');
        const tabR = btn('sc-tab active', 'Riassunto', () => showTab('riassunto'));
        const tabF = btn('sc-tab', 'Fonti', () => showTab('fonti'));
        const tabS = btn('sc-tab', 'Stile', () => showTab('stile'));
        const tabT = btn('sc-tab', 'Testo', () => showTab('testo'));
        const hide = btn('tool-btn', '&#10005;', () => toggleSide(false));
        hide.title = 'Nascondi pannello';
        // SPEC B2: tab Testo SEMPRE presente/visibile (4 tab in ogni tipo di schema)
        head.appendChild(tabR);
        head.appendChild(tabF);
        head.appendChild(tabS);
        head.appendChild(tabT);
        head.appendChild(hide);
        side.appendChild(head);

        // pannello riassunto
        const bodyR = App.el('div', 'sc-body');
        const note = App.el('div', 'sc-note');
        note.textContent = 'Annota qui il riassunto dello schema. La generazione con AI non \u00e8 disponibile in questo pannello: usa \u201cApri nel Chatbot\u201d e chiedila l\u00ec (il testo qui resta salvato nello schema).';
        const ta = App.el('textarea');
        ta.placeholder = 'Riassunto dello schema\u2026';
        ta.value = ed.doc.riassunto || '';
        ta.addEventListener('input', () => {
            if (!ed) return;
            ed.doc.riassunto = ta.value;
            scheduleSave();
        });
        const chat = btn('btn-secondary', 'Apri nel Chatbot', () => { App.go('chatbot'); });
        bodyR.appendChild(note);
        bodyR.appendChild(ta);
        bodyR.appendChild(chat);
        side.appendChild(bodyR);

        // pannello testo card: SPEC B2 - input Titolo (prima riga) + textarea Corpo.
        // La textarea contiene il testo completo (titolo + corpo) e n.text viene
        // scritto come titolo + '\n' + corpo; senza selezione resta l'hint
        // "Seleziona un nodo" e gli editor restano in attesa (disabled).
        const bodyT = App.el('div', 'sc-body');
        bodyT.style.display = 'none';
        const noteT = App.el('div', 'sc-note');
        noteT.textContent = 'Seleziona un nodo per scrivere qui il suo testo (titolo + corpo).';
        const inTitolo = App.el('input');
        inTitolo.type = 'text';
        inTitolo.placeholder = 'Titolo della card\u2026';
        inTitolo.style.width = '100%';
        inTitolo.style.marginBottom = '6px';
        const taT = App.el('textarea');
        taT.placeholder = 'Titolo della card\u2026\nCorpo del riassunto\u2026';
        function panelPush(nsel) {   // B3: coalescenza - UN solo passo di undo per nodo
            if (ed.textPushedFor !== nsel.id) { pushUndoSnapshot(); ed.textPushedFor = nsel.id; }
        }
        inTitolo.addEventListener('input', () => {
            if (!ed || !ed.sel || ed.sel.t !== 'node') return;
            const nsel = nodeById(ed.sel.id);
            if (!nsel) return;
            panelPush(nsel);
            const lines = taT.value.split('\n');
            const corpo = lines.slice(1).join('\n');
            const full = corpo ? inTitolo.value + '\n' + corpo : inTitolo.value;
            if (document.activeElement !== taT) taT.value = full;
            nsel.text = full;
            render();
            scheduleSave();
        });
        taT.addEventListener('input', () => {
            if (!ed || !ed.sel || ed.sel.t !== 'node') return;
            const nsel = nodeById(ed.sel.id);
            if (!nsel) return;
            panelPush(nsel);
            const lines = taT.value.split('\n');
            if (document.activeElement !== inTitolo) inTitolo.value = lines[0] || '';
            nsel.text = taT.value;
            render();
            scheduleSave();
        });
        bodyT.appendChild(noteT);
        bodyT.appendChild(inTitolo);
        bodyT.appendChild(taT);
        side.appendChild(bodyT);

        // pannello fonti — R21 B2: il corpo del tab ospita FontiPanel
        // (componente unico congelato): select/preview/ricerca locali
        // rimossi, dentro bodyF vive fp.el (montato/ricreato a ogni
        // apertura editor, distrutto in teardownEditor).
        const bodyF = App.el('div', 'sc-body');
        bodyF.style.display = 'none';
        mountFontiPanel(bodyF);
        side.appendChild(bodyF);

        // pannello stile (accessibile anche senza selezione)
        const bodyS = buildStyleBody();
        bodyS.style.display = 'none';
        side.appendChild(bodyS);

        ed.side = side;
        ed.tabR = tabR;
        ed.tabF = tabF;
        ed.tabS = tabS;
        ed.tabT = tabT;
        ed.bodyR = bodyR;
        ed.bodyF = bodyF;
        ed.bodyS = bodyS;
        ed.bodyT = bodyT;
        ed.taTesto = taT;
        ed.inTitolo = inTitolo;
        ed.testoNote = noteT;
        ed.risTa = ta;
        if (openRiassunto) showTab('riassunto');
        return side;
    }

    // ---------- immagini ----------
    function pickImageFile() {
        return new Promise(resolve => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'image/*';
            let done = false;
            const finish = v => { if (!done) { done = true; resolve(v); } };
            inp.addEventListener('change', () => {
                const f = inp.files && inp.files[0];
                if (!f) return finish(null);
                const rd = new FileReader();
                rd.onload = () => finish(String(rd.result || '') || null);
                rd.onerror = () => finish(null);
                rd.readAsDataURL(f);
            });
            window.addEventListener('focus', () => { setTimeout(() => finish(null), 800); });
            inp.click();
        });
    }

    async function resolveImageSrc() {
        try {
            const has = await StudyStore.hasBackend();
            if (has) {
                const asset = await StudyStore.pickAsset();
                if (asset && asset.path) return StudyStore.assetUrl(asset.path);
                return null;
            }
        } catch (e) { console.error('pickAsset:', e); }
        return await pickImageFile();
    }

    async function cmdAddImage() {
        if (!ed) return;
        const src = await resolveImageSrc();
        if (!src || !ed) return;
        const c = viewCenterWorld();
        const st = styleDefaults(ed.doc);
        const n = {
            id: uuid(),
            x: Math.round(c.x - 110), y: Math.round(c.y - 80),
            w: 220, h: 160,
            text: '',
            image: true, src: src,
            color: '#ffffff',
            border: st.nodeBorder,
            shape: 'round', fontSize: st.fontSize, bold: st.bold
        };
        ed.doc.nodes.push(n);
        select('node', n.id);
        render();
        scheduleSave();
    }

    async function replaceImage(n) {
        if (!ed || !n) return;
        const src = await resolveImageSrc();
        if (!src || !ed) return;
        n.src = src;
        n.image = true;
        render();
        scheduleSave();
    }

    // ---------- apertura editor ----------
    async function openEditor(itemOrId, openRiassunto) {
        // BLOCCO 3.3: azzera la flag PRIMA del parseDoc di questo item, cosi' le parse
        // di anteprima/elenco che precedono l'apertura non sporcano l'editor.
        pendingLegacyLayout = false;
        let item = itemOrId;
        if (typeof item === 'string') item = await StudyStore.getItem(item);
        if (!item) { renderList(); return; }
        if (item.content == null || item.content === undefined) {
            const full = await StudyStore.getItem(item.id);
            if (full) item = full;
        }
        let doc = parseDoc(item.content);
        if (!doc) doc = defaultDoc('libero');
        // BLOCCO 3.3: cattura (e azzera) la flag dopo il parse di quest'item
        const legacyTb = pendingLegacyLayout;
        pendingLegacyLayout = false;

        teardownEditor();
        container.style.overflow = 'hidden';
        container.style.padding = '4px 16px 8px';
        container.innerHTML = '';

        const root = App.el('div', 'sc-editor');

        // header
        const btnList = btn('tool-btn',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg> Elenco',
            () => backToList());
        const btnSave = btn('tool-btn',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Salva',
            () => { if (ed) { if (ed.saveTimer) { clearTimeout(ed.saveTimer); ed.saveTimer = null; } doSave(ed); } });
        const btnCenter = btn('tool-btn',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg> Centra vista',
            () => centerView());
        root.appendChild(App.header('Schemi', 'Modifica schema \u2014 salvataggio automatico', [btnList, btnSave, btnCenter]));

        // barra titolo/materia/pannello
        const top = App.el('div', 'sc-top');
        const titleIn = App.el('input', 'sc-title');
        titleIn.type = 'text';
        titleIn.value = item.title || 'Senza titolo';
        titleIn.addEventListener('input', () => { if (ed) { ed.title = titleIn.value; scheduleSave(); } });
        titleIn.addEventListener('change', () => { if (ed) { ed.title = titleIn.value.trim() || 'Senza titolo'; titleIn.value = ed.title; scheduleSave(); } });

        const subjMat = SubjectInput.create({
            label: 'Materia',
            placeholder: 'Inserisci materia\u2026',
            value: item.materia || '',
            onChange: v => { if (ed) { ed.materia = v; scheduleSave(); } }
        });

        const btnSide = btn('tool-btn',
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg> Pannello',
            () => toggleSide(!(ed && ed.sideVisible)));
        top.appendChild(titleIn);
        top.appendChild(subjMat);
        top.appendChild(btnSide);
        root.appendChild(top);

        // toolbar: i pulsanti sono DECISI DALLA STRATEGIA del tipo (ui().pulsanti)
        const bar = App.el('div', 'sc-tools');
        const strategy = (typeof SchemaStrategies !== 'undefined') ? SchemaStrategies.getStrategy(doc.type) : null;
        if (strategy && doc.opzioni) strategy.opzioni = Object.assign({}, strategy.opzioni || {}, doc.opzioni);

        // selettore Tipo = azione "Cambia tipo": migra lo schema SENZA perdere nodi/archi
        const selType = App.el('select', 'sc-type-sel');
        selType.title = 'Cambia tipo di schema (conserva nodi e archi)';
        TYPES.forEach(t => {
            const o = App.el('option', null, App.esc(t.label));
            o.value = t.id;
            selType.appendChild(o);
        });
        selType.value = doc.type;
        selType.addEventListener('change', () => { changeType(selType.value); });

        const btnWrap = App.el('div', 'sc-btnwrap');
        const btns = buildStrategyButtons(btnWrap, strategy, doc);

        // B4: il vecchio "Mano" NON era pan ma disegno a mano libera: rilocalizzato
        // come "Matita" (strumento di disegno reale: lo slider .sc-drawopts resta
        // legato a lui e visibile solo con lo strumento attivo). Il pan resta su
        // sfondo, rotella, shift+rotella e SPAZIO+drag. doc.drawings resta intatto.
        const bHand = btn('tool-btn', 'Matita', () => toggleTool(ed && ed.tool === 'draw' ? 'normal' : 'draw'));
        bHand.title = 'Disegna a matita sullo schema (strumento di disegno)';

        // B3: undo/redo FUORI da .sc-btnwrap (la matrice strategia conta solo
        // i bottoni dentro .sc-btnwrap)
        const bUndo = btn('tool-btn', '&#8630;', () => { undoChangeType(); });
        bUndo.title = 'Annulla (Ctrl+Z)';
        const bRedo = btn('tool-btn', '&#8631;', () => { redo(); });
        bRedo.title = 'Ripristina (Ctrl+Y)';
        const bImage = btn('tool-btn', 'Immagine', () => cmdAddImage());
        bImage.title = 'Inserisci un\u2019immagine come nodo collegabile';
        const bStyle = btn('tool-btn', 'Stile', () => { toggleSide(true); showTab('stile'); });
        bStyle.title = 'Pannello Stile: colori, forma, testo, palette';

        bar.appendChild(selType);
        bar.appendChild(bUndo);
        bar.appendChild(bRedo);
        bar.appendChild(btnWrap);
        bar.appendChild(App.el('span', 'tool-sep'));
        bar.appendChild(bHand);
        bar.appendChild(bImage);
        bar.appendChild(bStyle);
        bar.appendChild(App.el('span', 'tool-sep'));

        // opzioni strumento Matita: spessore + colore
        const drawOpts = App.el('div', 'sc-drawopts');
        const lblSize = App.el('label', null, 'Spessore');
        const rngSize = document.createElement('input');
        rngSize.type = 'range';
        rngSize.min = '1';
        rngSize.max = '30';
        rngSize.value = '4';
        const valSize = App.el('span', 'sc-dval', '4');
        rngSize.addEventListener('input', () => {
            if (ed) { ed.drawSize = Number(rngSize.value); valSize.textContent = rngSize.value; }
        });
        const colDraw = document.createElement('input');
        colDraw.type = 'color';
        colDraw.value = '#f9974a';
        colDraw.title = 'Colore tracciato';
        colDraw.addEventListener('input', () => { if (ed) ed.drawColor = colDraw.value; });
        drawOpts.appendChild(lblSize);
        drawOpts.appendChild(rngSize);
        drawOpts.appendChild(valSize);
        drawOpts.appendChild(colDraw);
        bar.appendChild(drawOpts);
        root.appendChild(bar);

        // area principale: SVG + pannello
        const main = App.el('div', 'sc-main');
        const stage = App.el('div', 'sc-stage');
        stage.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg">' +
            '<g class="sc-world"><g class="sc-guide"></g><g class="sc-nodes"></g><g class="sc-edges"></g><g class="sc-draw"></g><g class="sc-overlay"></g></g>' +
            '</svg>' +
            '<div class="sc-zoom">100%</div>';
        main.appendChild(stage);
        container.appendChild(root);

        const svg = stage.querySelector('svg');
        const gW = stage.querySelector('.sc-world');
        const gEdges = stage.querySelector('.sc-edges');
        const gGuide = stage.querySelector('.sc-guide');
        const gDraw = stage.querySelector('.sc-draw');
        const gNodes = stage.querySelector('.sc-nodes');
        const gOverlay = stage.querySelector('.sc-overlay');

        // stato
        ed = {
            itemId: item.id,
            title: item.title || 'Senza titolo',
            materia: SubjectInput.normalize(item.materia || ''),
            tags: item.tags || '',
            desc: item.description || '',
            thumb: item.thumbnail || '',
            doc: doc,
            svg: svg, gW: gW, gEdges: gEdges, gGuide: gGuide, gDraw: gDraw, gNodes: gNodes, gOverlay: gOverlay,
            stage: stage,
            view: (doc.view && doc.view.zoom)
                ? { x: doc.view.x || 0, y: doc.view.y || 0, zoom: doc.view.zoom }
                : { x: 0, y: 0, zoom: 1 },
            sel: null,
            connecting: false, connectFrom: null,
            drag: null,
            textTa: null, textNode: null,
            dirty: false, again: false, saving: false, saveTimer: null,
            undoStack: [], redoStack: [],
            spacePan: false, textSnap: null, textPushedFor: null, stylePushedFor: null,
            disposed: false,
            sideVisible: true, sideTab: 'riassunto',
            bChild: null, bSib: null, bDel: null, bConnect: null,
            bLayout: null, bHand: bHand, bStyle: bStyle, bUndo: bUndo, bRedo: bRedo,
            strategy: strategy, btns: btns, btnWrap: btnWrap, animTimer: null,
            selType: selType, drawOpts: drawOpts,
            tool: 'normal', drawColor: colDraw.value, drawSize: Number(rngSize.value),
            drawing: null, rootSet: {},
            styleCtl: null,
            fontiPanel: null
        };

        // materia normalizzata (MAIUSCOLO) e ricordata
        if (ed.materia !== String(item.materia || '')) scheduleSave();
        if (ed.materia) SubjectInput.remember(ed.materia);

        // pannello laterale: la strategia decide se montare il pannello testo affiancato
        const side = buildSide(openRiassunto === true);
        if (ed.strategy && ed.strategy.ui().pannelloTesto) { toggleSide(true); showTab('testo'); }

        applyPaletteBg();
        syncStyleCtl();
        main.appendChild(side);
        root.appendChild(main);

        // eventi
        svg.addEventListener('pointerdown', svgDown);
        svg.addEventListener('pointermove', svgMove);
        svg.addEventListener('pointerup', svgUp);
        svg.addEventListener('pointercancel', svgUp);
        svg.addEventListener('wheel', onWheel, { passive: false });
        svg.addEventListener('dblclick', onDblClick);
        window.addEventListener('keydown', onKey);
        window.addEventListener('keyup', onKeyUp);

        // S4: collision-resolution ALL'APERTURA/CARICAMENTO (margini 32/48,
        // idempotente, include orfani/disconnessi; nessuno snapshot di undo:
        // e' normalizzazione del caricamento, non un'azione dell'utente).
        if (typeof SchemaStrategies !== 'undefined' && SchemaStrategies.separateNodes) {
            try { SchemaStrategies.separateNodes(doc.nodes); }
            catch (e) { console.warn('Separazione nodi apertura:', e); }
        }
        // vista iniziale: ripristina la vista salvata, altrimenti centra
        render();
        if (!doc.view || !doc.view.zoom) {
            requestAnimationFrame(() => { if (ed) centerView(); });
        }

        // BLOCCO 3.3: auto-layout al primo caricamento per lo schema legacy migrato
        // tb -> albero. setTimeout per lasciar finire il rendering iniziale; try/catch
        // = rollback sicuro: se auto-layout non regge, il doc resta aperto e navigabile
        // con nodi/archi intatti (nessun dato viene buttato mai).
        if (legacyTb) {
            setTimeout(function () {
                try { autoLayout(); }
                catch (e) { console.warn('Auto-layout schema legacy tb:', e); }
            }, 60);
        }
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
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKeyUp);
        // R21 B2: FontiPanel e' CREATO a ogni apertura (buildSide) e
        // DISTRUTTO qui: nessun pannello sopravvive ad altro editor.
        if (st.fontiPanel && typeof st.fontiPanel.destroy === 'function') {
            try { st.fontiPanel.destroy(); } catch (e) { /* ok */ }
        }
        st.fontiPanel = null;
        ed = null;
        if (container) {
            container.style.overflow = '';
            container.style.padding = '';
        }
    }

    // ---------- registrazione modulo ----------
    App.registerModule({
        id: 'schemi',
        title: 'Schemi',
        desc: 'Crea mappe concettuali, alberi e schemi visivi per organizzare gli argomenti.',
        icon: App.ICONS.schemi,
        kinds: ['schema'],
        open(c, params) {
            container = c;
            const pid = params && params.open;
            if (pid) {
                StudyStore.getItem(pid).then(item => {
                    // app.js instrada qui anche i "riassunti": si apre se il
                    // contenuto \u00e8 uno schema valido, altrimenti si torna all\u2019elenco
                    if (item && (item.kind === 'schema' || parseDoc(item.content))) openEditor(item);
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
                const items = await StudyStore.listItems('schema') || [];
                if (!items.length) return 'Nessuno schema';
                return 'Ultimo: ' + (items[0].title || 'schema');
            } catch (e) { return ''; }
        }
    });
})();
