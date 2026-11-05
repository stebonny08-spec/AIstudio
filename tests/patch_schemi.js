/* ============================================================
   tests/patch_schemi.js — patch documentato e verificato di
   web_frontend/html/js/modules/schemi.js (TASK 2 + TASK 3).

   Ogni sostituzione deve essere trovata ESATTAMENTE una volta;
   altrimenti lo script fallisce senza scrivere nulla.

   Eseguire con: node tests/patch_schemi.js [--dry]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'schemi.js');
const DRY = process.argv.indexOf('--dry') >= 0;

const edits = [];

function E(name, before, after) { edits.push({ name, before, after }); }

// ---------------------------------------------------------------
// P1 — CSS: toast, wrapper pulsanti strategia, stato disabled
// ---------------------------------------------------------------
E('P1-CSS', String.raw`        '.sc-type-sel:focus{border-color:var(--accent);}'
    );`,
String.raw`        '.sc-type-sel:focus{border-color:var(--accent);}' +
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
    );`);

// ---------------------------------------------------------------
// P2 — helper strategia + toast
// ---------------------------------------------------------------
E('P2-helpers', String.raw`    // ---------- stato modulo ----------
    let container = null;
    let ed = null;`,
String.raw`    // ---------- stato modulo ----------
    let container = null;
    let ed = null;

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
    }`);

// ---------------------------------------------------------------
// P3 — defaultDoc: dimensione nodo dalla strategia
// ---------------------------------------------------------------
E('P3-defaultDoc', String.raw`        const wide = type === 'riassunto';
        const root = {
            id: uuid(),
            x: 520, y: 80, w: wide ? 280 : 190, h: wide ? 84 : 66,
            text: 'Idea centrale',`,
String.raw`        const stratD = (typeof SchemaStrategies !== 'undefined') ? SchemaStrategies.getStrategy(type) : null;
        const sizeD = (stratD && stratD.nodeSize) ? stratD.nodeSize() : { w: 190, h: 66 };
        const root = {
            id: uuid(),
            x: 520, y: 80, w: sizeD.w, h: Math.max(sizeD.h, 66),
            text: 'Idea centrale',`);

// ---------------------------------------------------------------
// P4 — creazione: initialLayout della strategia scelta
// ---------------------------------------------------------------
E('P4-chooser-initialLayout', String.raw`            const doc = defaultDoc(type);
            const materia = SubjectInput.normalize(subjMat.getValue());`,
String.raw`            const doc = defaultDoc(type);
            if (typeof SchemaStrategies !== 'undefined') {
                SchemaStrategies.getStrategy(type).initialLayout(doc.nodes, doc.edges);
            }
            const materia = SubjectInput.normalize(subjMat.getValue());`);

// ---------------------------------------------------------------
// P5 — rendering archi delegato a edgeStyle(): gomito/curva/dritta,
//      freccia opzionale, etichetta solo dove la strategia lo prevede,
//      archi "extra" tratteggiati
// ---------------------------------------------------------------
E('P5-edgeHtml', String.raw`    function edgeHtml(e) {
        const a = nodeById(e.from), b = nodeById(e.to);
        if (!a || !b) return '';
        const p = anchors(a, b);
        const col = e.color || styleDefaults(ed.doc).edgeColor;
        const selected = ed.sel && ed.sel.t === 'edge' && ed.sel.id === e.id;
        const ang = Math.atan2(p.y2 - p.y1, p.x2 - p.x1) * 180 / Math.PI;
        let lbl = '';
        const txt = String(e.label == null ? '' : e.label).trim();
        if (txt) {
            const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2;
            const lw = Math.max(28, txt.length * 6.6 + 16);
            lbl = '<g class="sc-elabel" pointer-events="none">' +
                '<rect x="' + (mx - lw / 2).toFixed(1) + '" y="' + (my - 9.5).toFixed(1) + '" width="' + lw.toFixed(1) + '" height="19" rx="9.5" fill="#ffffff" fill-opacity="0.93" stroke="' + col + '" stroke-width="1"/>' +
                '<text x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="600" fill="#141824" font-family="system-ui, -apple-system, sans-serif">' + App.esc(txt) + '</text>' +
                '</g>';
        }
        return '<g class="sc-edge" data-eid="' + e.id + '">' +
            '<line x1="' + p.x1 + '" y1="' + p.y1 + '" x2="' + p.x2 + '" y2="' + p.y2 + '" stroke="transparent" stroke-width="16"/>' +
            '<line x1="' + p.x1 + '" y1="' + p.y1 + '" x2="' + p.x2 + '" y2="' + p.y2 + '" stroke="' + col + '" stroke-width="' + (selected ? 3.4 : 2.2) + '"/>' +
            '<polygon points="0,0 -11,5 -11,-5" fill="' + col + '" transform="translate(' + p.x2 + ',' + p.y2 + ') rotate(' + ang.toFixed(2) + ')"/>' +
            lbl +
            '</g>';
    }`,
String.raw`    /* Geometria dell'arco secondo edgeStyle(): gomito | curva | dritta */
    function edgeGeom(a, b, forma) {
        const p = anchors(a, b);
        const dx = p.x2 - p.x1, dy = p.y2 - p.y1;
        let d, ang, mid;
        if (forma === 'gomito') {
            if (Math.abs(dx) >= Math.abs(dy)) {
                const mx = Math.round((p.x1 + p.x2) / 2);
                d = 'M ' + p.x1 + ' ' + p.y1 + ' L ' + mx + ' ' + p.y1 + ' L ' + mx + ' ' + p.y2 + ' L ' + p.x2 + ' ' + p.y2;
                ang = dx >= 0 ? 0 : 180;
                mid = { x: mx, y: (p.y1 + p.y2) / 2 };
            } else {
                const my = Math.round((p.y1 + p.y2) / 2);
                d = 'M ' + p.x1 + ' ' + p.y1 + ' L ' + p.x1 + ' ' + my + ' L ' + p.x2 + ' ' + my + ' L ' + p.x2 + ' ' + p.y2;
                ang = dy >= 0 ? 90 : -90;
                mid = { x: (p.x1 + p.x2) / 2, y: my };
            }
        } else if (forma === 'curva') {
            const mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2;
            const len = Math.hypot(dx, dy) || 1;
            const off = Math.max(22, Math.min(84, len * 0.22));
            const cx = mx + (-dy / len) * off, cy = my + (dx / len) * off;
            d = 'M ' + p.x1 + ' ' + p.y1 + ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + p.x2 + ' ' + p.y2;
            ang = Math.atan2(p.y2 - cy, p.x2 - cx) * 180 / Math.PI;
            mid = { x: (p.x1 + 2 * cx + p.x2) / 4, y: (p.y1 + 2 * cy + p.y2) / 4 };
        } else {
            d = 'M ' + p.x1 + ' ' + p.y1 + ' L ' + p.x2 + ' ' + p.y2;
            ang = Math.atan2(dy, dx) * 180 / Math.PI;
            mid = { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2 };
        }
        return { d: d, ang: ang, mid: mid, p: p };
    }

    function edgeHtml(e) {
        const a = nodeById(e.from), b = nodeById(e.to);
        if (!a || !b) return '';
        const s = strat();
        const es = s ? s.edgeStyle() : { forma: 'dritta', freccia: true, etichetta: false };
        let forma = es.forma;
        const pr = anchors(a, b);
        // flusso lr/tb: un arco "indietro" viene reso come curva
        if (forma === 'dritta' && s && s.asseFlusso === 'x' && pr.x2 < pr.x1 - 1) forma = 'curva';
        else if (forma === 'dritta' && s && s.asseFlusso === 'y' && pr.y2 < pr.y1 - 1) forma = 'curva';
        const g = edgeGeom(a, b, forma);
        const col = e.extra ? '#7f879c' : (e.color || styleDefaults(ed.doc).edgeColor);
        const selected = ed.sel && ed.sel.t === 'edge' && ed.sel.id === e.id;
        const sw = selected ? 3.4 : 2.2;
        let h = '<g class="sc-edge' + (e.extra ? ' sc-edge-extra' : '') + '" data-eid="' + e.id + '">';
        h += '<path d="' + g.d + '" stroke="transparent" stroke-width="16" fill="none"/>';
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
    }`);

// ---------------------------------------------------------------
// P6 — nodo radice evidenziato solo se lo prevede la strategia
// ---------------------------------------------------------------
E('P6-isRoot', String.raw`        const isRoot = !from && ed.doc.type === 'albero' && ed.rootSet && ed.rootSet[n.id];`,
String.raw`        const isRoot = !from && strat() && strat().evidenziaRadice && ed.rootSet && ed.rootSet[n.id];`);

// ---------------------------------------------------------------
// P7 — nodo "card multilinea" per il riassunto visuale
// ---------------------------------------------------------------
E('P7-card-branch', String.raw`        const maxChars = Math.max(6, Math.floor((n.w - 18) / (fs * 0.56)));`,
String.raw`        if (strat() && strat().vistaCard) return nodeCardHtml(n, fs, fill, stroke, sw, dash, handle);
        const maxChars = Math.max(6, Math.floor((n.w - 18) / (fs * 0.56)));`);

E('P7b-card-fn', String.raw`    function nodeHtml(n) {`,
String.raw`    /* Card multilinea (Riassunto visuale): prima riga = titolo, resto = corpo. */
    function nodeCardHtml(n, fs, fill, stroke, sw, dash, handle) {
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
        return '<g class="sc-node sc-card" data-nid="' + n.id + '">' + shapeEl + divider + tEl + bEl + handle + '</g>';
    }

    function nodeHtml(n) {`);

// ---------------------------------------------------------------
// P8 — guide (colonne/righe) decise dalla strategia
// ---------------------------------------------------------------
E('P8-guideHtml', String.raw`    function render() {`,
String.raw`    /* Guide leggere (colonne/righe) decise da strategy.ui().guide. */
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
        groups.forEach(g => {
            const c = g.reduce((s, v) => s + v, 0) / g.length;
            let a1 = Infinity, a2 = -Infinity;
            ns.forEach(n => {
                const nc = verticali ? (n.x + n.w / 2) : (n.y + n.h / 2);
                if (Math.abs(nc - c) > 44) return;
                const s1 = verticali ? n.y : n.x;
                const s2 = verticali ? (n.y + n.h) : (n.x + n.w);
                a1 = Math.min(a1, s1); a2 = Math.max(a2, s2);
            });
            if (!isFinite(a1)) return;
            const col = 'rgba(140,164,255,.30)';
            if (verticali) {
                h += '<line x1="' + c.toFixed(1) + '" y1="' + (a1 - 18).toFixed(1) +
                    '" x2="' + c.toFixed(1) + '" y2="' + (a2 + 18).toFixed(1) +
                    '" stroke="' + col + '" stroke-width="1.5" stroke-dasharray="7 8" pointer-events="none"/>';
            } else {
                h += '<line x1="' + (a1 - 18).toFixed(1) + '" y1="' + c.toFixed(1) +
                    '" x2="' + (a2 + 18).toFixed(1) + '" y2="' + c.toFixed(1) +
                    '" stroke="' + col + '" stroke-width="1.5" stroke-dasharray="7 8" pointer-events="none"/>';
            }
        });
        return h;
    }

    function render() {`);

E('P8b-render-guide', String.raw`        ed.gEdges.innerHTML = eh;
        if (ed.gDraw) ed.gDraw.innerHTML = drawHtml();`,
String.raw`        ed.gEdges.innerHTML = eh;
        if (ed.gGuide) ed.gGuide.innerHTML = guideHtml();
        if (ed.gDraw) ed.gDraw.innerHTML = drawHtml();`);

// ---------------------------------------------------------------
// P9 — addNode: dimensioni dalla strategia (card large per riassunto)
// ---------------------------------------------------------------
E('P9-addNode', String.raw`    function addNode(x, y) {
        const st = styleDefaults(ed.doc);
        const wide = ed.doc.type === 'riassunto';
        const n = {
            id: uuid(),
            x: Math.round(x), y: Math.round(y),
            w: wide ? 250 : 170, h: wide ? 78 : 60,
            text: 'Nuovo nodo',
            color: st.nodeFill, border: st.nodeBorder,
            shape: st.shape,
            fontSize: wide ? Math.max(st.fontSize, 16) : st.fontSize,
            bold: st.bold
        };`,
String.raw`    function addNode(x, y) {
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
        };`);

// ---------------------------------------------------------------
// P10 — cmdAddNode: posizione da placeNewNode
// ---------------------------------------------------------------
E('P10-cmdAddNode', String.raw`    function cmdAddNode() {
        if (!ed) return;
        const c = viewCenterWorld();
        addNode(c.x - 85, c.y - 30);
    }

    function isLR() { return ed && ed.doc.type === 'lr'; }

    function cmdAddChild() {`,
String.raw`    function cmdAddNode() {
        if (!ed) return;
        if (!ed.doc.nodes.length) {
            const c = viewCenterWorld();
            addNode(c.x - 85, c.y - 30);
            return;
        }
        const pos = strat().placeNewNode(null, ed.doc, 'figlio');
        addNode(pos.x, pos.y);
    }

    function cmdAddChild() {`);

// ---------------------------------------------------------------
// P11 — cmdAddChild: placeNewNode + canConnect
// ---------------------------------------------------------------
E('P11-cmdAddChild', String.raw`    function cmdAddChild() {
        if (!ed || !ed.sel || ed.sel.t !== 'node') return;
        const p = nodeById(ed.sel.id);
        if (!p) return;
        let x, y;
        const cw = ed.doc.type === 'riassunto' ? 250 : 170;
        if (isLR()) { x = p.x + p.w + 70; y = p.y; }
        else { x = p.x + p.w / 2 - cw / 2; y = p.y + p.h + 55; }
        const n = addNode(x, y);
        ed.doc.edges.push({ id: uuid(), from: p.id, to: n.id, color: styleDefaults(ed.doc).edgeColor });
        render();
        scheduleSave();
    }`,
String.raw`    function cmdAddChild() {
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
    }`);

// ---------------------------------------------------------------
// P12 — cmdAddSibling: placeNewNode(modalita' fratello) + canConnect
// ---------------------------------------------------------------
E('P12-cmdAddSibling', String.raw`    function cmdAddSibling() {
        if (!ed || !ed.sel || ed.sel.t !== 'node') return;
        const n = nodeById(ed.sel.id);
        if (!n) return;
        let parent = null;
        for (let i = 0; i < ed.doc.edges.length; i++) {
            if (ed.doc.edges[i].to === n.id) { parent = nodeById(ed.doc.edges[i].from); break; }
        }
        let x, y;
        if (isLR()) { x = n.x; y = n.y + n.h + 45; }
        else { x = n.x + n.w + 60; y = n.y; }
        const s = addNode(x, y);
        if (parent) ed.doc.edges.push({ id: uuid(), from: parent.id, to: s.id, color: styleDefaults(ed.doc).edgeColor });
        render();
        scheduleSave();
    }`,
String.raw`    function cmdAddSibling() {
        if (!ed || !ed.sel || ed.sel.t !== 'node') return;
        const ref = nodeById(ed.sel.id);
        if (!ref) return;
        let parent = null;
        for (let i = 0; i < ed.doc.edges.length; i++) {
            const e = ed.doc.edges[i];
            if (!e.extra && e.to === ref.id) { parent = nodeById(e.from); break; }
        }
        const s2 = strat();
        if (!parent && s2 && s2.singolaRadice) {
            toast('La radice dell\u2019albero non ha fratelli: usa \u00ab+ Figlio\u00bb.');
            return;
        }
        const pos = s2.placeNewNode(ref, ed.doc, 'fratello');
        const s = addNode(pos.x, pos.y);
        if (parent) {
            const r = s2.canConnect(parent.id, s.id, ed.doc);
            if (r.ok) ed.doc.edges.push({ id: uuid(), from: parent.id, to: s.id, color: styleDefaults(ed.doc).edgeColor });
            else toast(r.motivo);
        }
        render();
        scheduleSave();
    }`);

// ---------------------------------------------------------------
// P13 — handleConnectClick: canConnect + toast col motivo
// ---------------------------------------------------------------
E('P13-handleConnectClick', String.raw`        if (ed.connectFrom === id) { ed.connectFrom = null; render(); return; }
        const from = ed.connectFrom;
        const dup = ed.doc.edges.some(e => e.from === from && e.to === id);
        if (!dup) ed.doc.edges.push({ id: uuid(), from: from, to: id, color: styleDefaults(ed.doc).edgeColor });
        ed.connectFrom = null;
        ed.connecting = false;
        select('node', id);
        scheduleSave();`,
String.raw`        if (ed.connectFrom === id) { ed.connectFrom = null; render(); return; }
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
        ed.doc.edges.push({ id: uuid(), from: from, to: id, color: styleDefaults(ed.doc).edgeColor });
        ed.connectFrom = null;
        ed.connecting = false;
        select('node', id);
        scheduleSave();`);

// ---------------------------------------------------------------
// P14 — auto-layout: rimosso il layout hard-coded, delegato alla
//        strategia con animazione ~200ms + pulsanti/migrazione/pannello
// ---------------------------------------------------------------
E('P14-autoLayout', String.raw`    // ---------- auto-layout ----------
    function layoutCircle() {
        const ns = ed.doc.nodes;
        if (!ns.length) return;
        const hasIn = {};
        ns.forEach(n => { hasIn[n.id] = false; });
        ed.doc.edges.forEach(e => { if (hasIn[e.to] !== undefined) hasIn[e.to] = true; });
        let cx = 0, cy = 0;
        ns.forEach(n => { cx += n.x + n.w / 2; cy += n.y + n.h / 2; });
        cx /= ns.length; cy /= ns.length;
        const roots = ns.filter(n => !hasIn[n.id]);
        let ring = ns;
        if (roots.length === 1) {
            const r = roots[0];
            r.x = Math.round(cx - r.w / 2);
            r.y = Math.round(cy - r.h / 2);
            ring = ns.filter(n => n.id !== r.id);
        }
        const R = Math.max(210, ring.length * 58);
        ring.forEach((n, i) => {
            const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, ring.length);
            n.x = Math.round(cx + R * Math.cos(a) - n.w / 2);
            n.y = Math.round(cy + R * Math.sin(a) - n.h / 2);
        });
        render();
        centerView();
        scheduleSave();
    }

    function autoLayout() {
        if (!ed || ed.doc.type === 'libero' || !ed.doc.nodes.length) return;
        if (ed.doc.type === 'mappa') { layoutCircle(); return; }
        const dir = ed.doc.type === 'lr' ? 'lr' : 'tb';
        const kids = {};
        const hasIn = {};
        ed.doc.nodes.forEach(n => { kids[n.id] = []; hasIn[n.id] = false; });
        ed.doc.edges.forEach(e => {
            if (kids[e.from] && nodeById(e.to)) {
                kids[e.from].push(e.to);
                hasIn[e.to] = true;
            }
        });
        let roots = ed.doc.nodes.filter(n => !hasIn[n.id]).map(n => n.id);
        if (!roots.length) roots = [ed.doc.nodes[0].id];
        const seen = {};
        let leaf = 0;
        function place(id, depth) {
            if (seen[id]) return leaf;
            seen[id] = true;
            const n = nodeById(id);
            if (!n) return leaf;
            const ch = (kids[id] || []).filter(c => !seen[c]);
            let pos;
            if (!ch.length) { pos = leaf; leaf++; }
            else {
                const vals = ch.map(c => place(c, depth + 1));
                pos = (Math.min.apply(null, vals) + Math.max.apply(null, vals)) / 2;
            }
            if (dir === 'lr') { n.x = 60 + depth * 260; n.y = 60 + pos * 110; }
            else { n.x = 60 + pos * 230; n.y = 60 + depth * 130; }
            return pos;
        }
        roots.forEach(r => place(r, 0));
        ed.doc.nodes.forEach(n => {
            if (!seen[n.id]) {
                n.x = 60 + leaf * 230;
                n.y = 60;
                leaf++;
                seen[n.id] = true;
            }
        });
        render();
        centerView();
        scheduleSave();
    }`,
String.raw`    // ---------- auto-layout (delegato alla strategia del tipo) ----------
    function animateLayout(targets, dur) {
        if (!ed || !targets) return;
        if (ed.animTimer) { cancelAnimationFrame(ed.animTimer); ed.animTimer = null; }
        const starts = [];
        ed.doc.nodes.forEach(n => {
            const t = targets[n.id];
            if (t) starts.push({ n: n, x0: n.x, y0: n.y, x1: t.x, y1: t.y });
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
        if (ed.sel && ed.sel.t === 'node') s.hubId = ed.sel.id;   // hub selezionato (mappa)
        const targets = s.autoLayout(ed.doc.nodes, ed.doc.edges);
        if (!targets) {
            toast('Auto-layout non disponibile: lo schema libero usa solo posizionamento manuale.');
            return;
        }
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
        const ui = strategy.ui();
        ui.pulsanti.forEach(p => {
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
        if (ed.tabT) ed.tabT.style.display = ed.strategy.ui().pannelloTesto ? '' : 'none';
        updateChrome();
    }

    /* TASK 3 — "Cambia tipo" su schema esistente:
       conserva nodi e archi, valida ogni arco con canConnect della nuova
       strategia (gli invalidi diventano extra tratteggiati oppure vengono
       rimossi dopo conferma), riesegue l'auto-layout con animazione e
       aggiorna pulsanti, guide e pannello. */
    function changeType(nuovo) {
        if (!ed || ed.doc.type === nuovo) return;
        if (typeof SchemaStrategies === 'undefined') { ed.doc.type = nuovo; scheduleSave(); return; }
        const s = SchemaStrategies.getStrategy(nuovo);
        SchemaStrategies.migrateSchema(ed.doc, nuovo);   // nodi/archi conservati; extra = non validi
        ed.strategy = s;
        if (s && ed.doc.opzioni) s.opzioni = Object.assign({}, s.opzioni || {}, ed.doc.opzioni);

        const extras = ed.doc.edges.filter(e => e.extra);
        if (extras.length) {
            const one = extras.length === 1
                ? '1 collegamento non \u00e8 valido nel tipo \u00ab' + TYPE_LABELS[nuovo] + '\u00bb:\n\u00ab' + (extras[0].extraMotivo || '') + '\u00bb'
                : extras.length + ' collegamenti non sono validi nel tipo \u00ab' + TYPE_LABELS[nuovo] + '\u00bb.';
            const rm = confirm(one + '\n\nOK = li rimuovo\nAnnulla = li tengo come collegamenti extra (tratteggiati)');
            if (rm) ed.doc.edges = ed.doc.edges.filter(e => !e.extra);
        }
        refreshToolbar();   // pulsanti
        if (s.ui().pannelloTesto) { toggleSide(true); showTab('testo'); }
        else if (ed.sideTab === 'testo') showTab('riassunto');
        scheduleSave();
        render();           // guide aggiornate
        const targets = s.autoLayout(ed.doc.nodes, ed.doc.edges);
        if (targets) animateLayout(targets, 200);   // layout del nuovo tipo, animato ~200ms
    }

    /* Pannello testo (riassunto visuale): sincronizzato col nodo selezionato. */
    function syncTestoPanel() {
        if (!ed || !ed.taTesto || ed.sideTab !== 'testo') return;
        const n = (ed.sel && ed.sel.t === 'node') ? nodeById(ed.sel.id) : null;
        if (document.activeElement !== ed.taTesto) ed.taTesto.value = n ? String(n.text || '') : '';
        ed.taTesto.disabled = !n;
        if (ed.testoNote) ed.testoNote.textContent = n
            ? 'Card selezionata: prima riga = titolo, le righe successive sono il corpo.'
            : 'Seleziona un nodo per scrivere qui il suo testo (titolo + corpo).';
    }`);

// ---------------------------------------------------------------
// P15 — snap durante il drag deciso dalla strategia (spento per libero)
// ---------------------------------------------------------------
E('P15-snap', String.raw`        } else if (d.mode === 'move') {
            const n = nodeById(d.id);
            if (!n) return;
            const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
            if (!d.moved && Math.hypot((e.clientX - d.sx), (e.clientY - d.sy)) > 3) d.moved = true;
            if (d.moved) {
                n.x = Math.round(d.ox + dx);
                n.y = Math.round(d.oy + dy);
                render();
            }`,
String.raw`        } else if (d.mode === 'move') {
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
            }`);

// ---------------------------------------------------------------
// P16 — etichetta arco editabile SOLO dove edgeStyle().etichetta (mappa)
// ---------------------------------------------------------------
E('P16-dblclick-label', String.raw`        const edgeG = tgt.closest ? tgt.closest('[data-eid]') : null;
        if (edgeG && ed.doc.type === 'mappa') {`,
String.raw`        const edgeG = tgt.closest ? tgt.closest('[data-eid]') : null;
        // etichetta editabile SOLO dove la strategia la prevede (mappa concettuale)
        if (edgeG && ed.strategy && ed.strategy.edgeStyle().etichetta) {`);

// ---------------------------------------------------------------
// P17 — updateChrome: pulsanti guidati da ui()
// ---------------------------------------------------------------
E('P17-updateChrome', String.raw`    function updateChrome() {
        if (!ed) return;
        const selNode = !!(ed.sel && ed.sel.t === 'node');
        const selEdge = !!(ed.sel && ed.sel.t === 'edge');
        const selStroke = !!(ed.sel && ed.sel.t === 'stroke');
        if (ed.bChild) ed.bChild.disabled = !selNode;
        if (ed.bSib) ed.bSib.disabled = !selNode;
        if (ed.bDel) ed.bDel.disabled = !(selNode || selEdge || selStroke);
        if (ed.bConnect) ed.bConnect.classList.toggle('active', !!ed.connecting);
        if (ed.bHand) ed.bHand.classList.toggle('active', ed.tool === 'draw');
        if (ed.drawOpts) ed.drawOpts.classList.toggle('on', ed.tool === 'draw');
        if (ed.bLayout) ed.bLayout.disabled = ed.doc.type === 'libero';
        if (ed.selType && ed.selType.value !== ed.doc.type) ed.selType.value = ed.doc.type;
        if (ed.styleCtl && ed.styleCtl.apply) ed.styleCtl.apply.disabled = !(selNode || selEdge);
        syncStyleCtl();
    }`,
String.raw`    function updateChrome() {
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
        if (ed.bHand) ed.bHand.classList.toggle('active', ed.tool === 'draw');
        if (ed.drawOpts) ed.drawOpts.classList.toggle('on', ed.tool === 'draw');
        if (ed.selType && ed.selType.value !== ed.doc.type) ed.selType.value = ed.doc.type;
        if (ed.styleCtl && ed.styleCtl.apply) ed.styleCtl.apply.disabled = !(selNode || selEdge);
        syncTestoPanel();
        syncStyleCtl();
    }`);

// ---------------------------------------------------------------
// P18 — showTab: gestione tab "testo" (pannello card)
// ---------------------------------------------------------------
E('P18-showTab', String.raw`    function showTab(which) {
        if (!ed) return;
        ed.sideTab = which;
        ed.tabR.classList.toggle('active', which === 'riassunto');
        ed.tabF.classList.toggle('active', which === 'fonti');
        if (ed.tabS) ed.tabS.classList.toggle('active', which === 'stile');
        ed.bodyR.style.display = which === 'riassunto' ? '' : 'none';
        ed.bodyF.style.display = which === 'fonti' ? '' : 'none';
        if (ed.bodyS) ed.bodyS.style.display = which === 'stile' ? '' : 'none';
        if (which === 'fonti') loadSources();
        if (which === 'stile') syncStyleCtl();
    }`,
String.raw`    function showTab(which) {
        if (!ed) return;
        if (which === 'testo' && !(ed.strategy && ed.strategy.ui().pannelloTesto)) which = 'riassunto';
        ed.sideTab = which;
        ed.tabR.classList.toggle('active', which === 'riassunto');
        ed.tabF.classList.toggle('active', which === 'fonti');
        if (ed.tabS) ed.tabS.classList.toggle('active', which === 'stile');
        if (ed.tabT) ed.tabT.classList.toggle('active', which === 'testo');
        ed.bodyR.style.display = which === 'riassunto' ? '' : 'none';
        ed.bodyF.style.display = which === 'fonti' ? '' : 'none';
        if (ed.bodyS) ed.bodyS.style.display = which === 'stile' ? '' : 'none';
        if (ed.bodyT) ed.bodyT.style.display = which === 'testo' ? '' : 'none';
        if (which === 'fonti') loadSources();
        if (which === 'stile') syncStyleCtl();
        if (which === 'testo') syncTestoPanel();
    }`);

// ---------------------------------------------------------------
// P19 — buildSide: tab + corpo pannello testo card
// ---------------------------------------------------------------
E('P19a-side-head', String.raw`        const head = App.el('div', 'sc-side-head');
        const tabR = btn('sc-tab active', 'Riassunto', () => showTab('riassunto'));
        const tabF = btn('sc-tab', 'Fonti', () => showTab('fonti'));
        const tabS = btn('sc-tab', 'Stile', () => showTab('stile'));
        const hide = btn('tool-btn', '&#10005;', () => toggleSide(false));
        hide.title = 'Nascondi pannello';
        head.appendChild(tabR);
        head.appendChild(tabF);
        head.appendChild(tabS);
        head.appendChild(hide);
        side.appendChild(head);`,
String.raw`        const head = App.el('div', 'sc-side-head');
        const tabR = btn('sc-tab active', 'Riassunto', () => showTab('riassunto'));
        const tabF = btn('sc-tab', 'Fonti', () => showTab('fonti'));
        const tabS = btn('sc-tab', 'Stile', () => showTab('stile'));
        const tabT = btn('sc-tab', 'Testo', () => showTab('testo'));
        const hide = btn('tool-btn', '&#10005;', () => toggleSide(false));
        hide.title = 'Nascondi pannello';
        const uiSide = (ed.strategy && ed.strategy.ui()) || { pannelloTesto: false };
        tabT.style.display = uiSide.pannelloTesto ? '' : 'none';
        head.appendChild(tabR);
        head.appendChild(tabF);
        head.appendChild(tabS);
        head.appendChild(tabT);
        head.appendChild(hide);
        side.appendChild(head);`);

E('P19b-side-testo', String.raw`        // pannello fonti
        const bodyF = App.el('div', 'sc-body');`,
String.raw`        // pannello testo card (riassunto visuale): sincronizzato col nodo selezionato
        const bodyT = App.el('div', 'sc-body');
        bodyT.style.display = 'none';
        const noteT = App.el('div', 'sc-note');
        noteT.textContent = 'Seleziona un nodo per scrivere qui il suo testo: prima riga = titolo della card, righe successive = corpo.';
        const taT = App.el('textarea');
        taT.placeholder = 'Titolo della card\u2026\nCorpo del riassunto\u2026';
        taT.addEventListener('input', () => {
            if (!ed || !ed.sel || ed.sel.t !== 'node') return;
            const nsel = nodeById(ed.sel.id);
            if (!nsel) return;
            nsel.text = taT.value;
            render();
            scheduleSave();
        });
        bodyT.appendChild(noteT);
        bodyT.appendChild(taT);
        side.appendChild(bodyT);

        // pannello fonti
        const bodyF = App.el('div', 'sc-body');`);

E('P19c-side-refs', String.raw`        ed.side = side;
        ed.tabR = tabR;
        ed.tabF = tabF;
        ed.tabS = tabS;
        ed.bodyR = bodyR;
        ed.bodyF = bodyF;
        ed.bodyS = bodyS;`,
String.raw`        ed.side = side;
        ed.tabR = tabR;
        ed.tabF = tabF;
        ed.tabS = tabS;
        ed.tabT = tabT;
        ed.bodyR = bodyR;
        ed.bodyF = bodyF;
        ed.bodyS = bodyS;
        ed.bodyT = bodyT;
        ed.taTesto = taT;
        ed.testoNote = noteT;`);

// ---------------------------------------------------------------
// P20 — gruppo SVG per le guide
// ---------------------------------------------------------------
E('P20-stage-guide', String.raw`            '<g class="sc-world"><g class="sc-edges"></g><g class="sc-draw"></g><g class="sc-nodes"></g></g>' +`,
String.raw`            '<g class="sc-world"><g class="sc-guide"></g><g class="sc-edges"></g><g class="sc-draw"></g><g class="sc-nodes"></g></g>' +`);

E('P20b-gGuide-ref', String.raw`        const gEdges = stage.querySelector('.sc-edges');
        const gDraw = stage.querySelector('.sc-draw');`,
String.raw`        const gEdges = stage.querySelector('.sc-edges');
        const gGuide = stage.querySelector('.sc-guide');
        const gDraw = stage.querySelector('.sc-draw');`);

// ---------------------------------------------------------------
// P21 — toolbar costruita da ui(): + "Cambia tipo" che migra lo schema
// ---------------------------------------------------------------
E('P21-toolbar', String.raw`        // toolbar nodi + tipo + strumenti
        const bar = App.el('div', 'sc-tools');
        const bNode = btn('tool-btn', '+ Nodo', () => cmdAddNode());
        const bChild = btn('tool-btn', '+ Figlio', () => cmdAddChild());
        const bSib = btn('tool-btn', '+ Fratello', () => cmdAddSibling());
        const bDel = btn('tool-btn', 'Cancella', () => deleteSelection());
        const bConnect = btn('tool-btn', 'Collega', () => toggleConnect());
        const bLayout = btn('tool-btn', 'Auto-layout', () => autoLayout());
        bLayout.title = 'Disposizione automatica in base al tipo di schema';
        bLayout.disabled = doc.type === 'libero';

        // selettore Tipo: cambia il comportamento di layout SENZA perdere nodi/archi
        const selType = App.el('select', 'sc-type-sel');
        selType.title = 'Tipo di schema';
        TYPES.forEach(t => {
            const o = App.el('option', null, App.esc(t.label));
            o.value = t.id;
            selType.appendChild(o);
        });
        selType.value = doc.type;
        selType.addEventListener('change', () => {
            if (!ed) return;
            ed.doc.type = selType.value;
            if (ed.doc.type === 'riassunto') { toggleSide(true); showTab('riassunto'); }
            scheduleSave();
            render();
        });

        const bHand = btn('tool-btn', 'Mano', () => toggleTool(ed && ed.tool === 'draw' ? 'normal' : 'draw'));
        bHand.title = 'Disegna a mano libera sullo schema';
        const bImage = btn('tool-btn', 'Immagine', () => cmdAddImage());
        bImage.title = 'Inserisci un\u2019immagine come nodo collegabile';
        const bStyle = btn('tool-btn', 'Stile', () => { toggleSide(true); showTab('stile'); });
        bStyle.title = 'Pannello Stile: colori, forma, testo, palette';

        bar.appendChild(selType);
        bar.appendChild(bNode);
        bar.appendChild(bChild);
        bar.appendChild(bSib);
        bar.appendChild(bDel);
        bar.appendChild(App.el('span', 'tool-sep'));
        bar.appendChild(bConnect);
        bar.appendChild(bLayout);
        bar.appendChild(bHand);
        bar.appendChild(bImage);
        bar.appendChild(bStyle);
        bar.appendChild(App.el('span', 'tool-sep'));`,
String.raw`        // toolbar: i pulsanti sono DECISI DALLA STRATEGIA del tipo (ui().pulsanti)
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

        const bHand = btn('tool-btn', 'Mano', () => toggleTool(ed && ed.tool === 'draw' ? 'normal' : 'draw'));
        bHand.title = 'Disegna a mano libera sullo schema';
        const bImage = btn('tool-btn', 'Immagine', () => cmdAddImage());
        bImage.title = 'Inserisci un\u2019immagine come nodo collegabile';
        const bStyle = btn('tool-btn', 'Stile', () => { toggleSide(true); showTab('stile'); });
        bStyle.title = 'Pannello Stile: colori, forma, testo, palette';

        bar.appendChild(selType);
        bar.appendChild(btnWrap);
        bar.appendChild(App.el('span', 'tool-sep'));
        bar.appendChild(bHand);
        bar.appendChild(bImage);
        bar.appendChild(bStyle);
        bar.appendChild(App.el('span', 'tool-sep'));`);

// ---------------------------------------------------------------
// P22 — stato editor: strategy/btns/gGuide
// ---------------------------------------------------------------
E('P22a-ed-svg', String.raw`            svg: svg, gW: gW, gEdges: gEdges, gDraw: gDraw, gNodes: gNodes,`,
String.raw`            svg: svg, gW: gW, gEdges: gEdges, gGuide: gGuide, gDraw: gDraw, gNodes: gNodes,`);

E('P22b-ed-btns', String.raw`            bChild: bChild, bSib: bSib, bDel: bDel, bConnect: bConnect,
            bLayout: bLayout, bHand: bHand, bStyle: bStyle,
            selType: selType, drawOpts: drawOpts,`,
String.raw`            bChild: null, bSib: null, bDel: null, bConnect: null,
            bLayout: null, bHand: bHand, bStyle: bStyle,
            strategy: strategy, btns: btns, btnWrap: btnWrap, animTimer: null,
            selType: selType, drawOpts: drawOpts,`);

// ---------------------------------------------------------------
// P23 — pannello laterale: montaggio automatico del pannello testo
//        quando lo prevede la strategia (riassunto visuale)
// ---------------------------------------------------------------
E('P23-open-side', String.raw`        // pannello laterale: il "riassunto visuale" apre il testo affiancato di default
        const side = buildSide(openRiassunto === true || doc.type === 'riassunto');`,
String.raw`        // pannello laterale: la strategia decide se montare il pannello testo affiancato
        const side = buildSide(openRiassunto === true);
        if (ed.strategy && ed.strategy.ui().pannelloTesto) { toggleSide(true); showTab('testo'); }`);

// ---------------------------------------------------------------
// Esecuzione con verifica
// ---------------------------------------------------------------
let src = fs.readFileSync(FILE, 'utf8');
const crlf = src.indexOf('\r\n') >= 0;
let okCount = 0;
for (const ed of edits) {
    let b = ed.before, a = ed.after;
    if (crlf) { b = b.replace(/\n/g, '\r\n'); a = a.replace(/\n/g, '\r\n'); }
    const idx = src.indexOf(b);
    if (idx < 0) {
        console.error('FALLITO (non trovato): ' + ed.name);
        process.exit(1);
    }
    if (src.indexOf(b, idx + b.length) >= 0) {
        console.error('FALLITO (ambiguo): ' + ed.name);
        process.exit(1);
    }
    src = src.slice(0, idx) + a + src.slice(idx + b.length);
    okCount++;
}
if (DRY) {
    console.log('DRY: ' + okCount + '/' + edits.length + ' patch trovate e uniche. Nessuna scrittura.');
} else {
    fs.writeFileSync(FILE, src, 'utf8');
    console.log('OK: ' + okCount + '/' + edits.length + ' patch applicati a schemi.js');
}
