/* ============================================================
   tests/patch_doc_b4.js — BLOCCO 4 (documenti):
   4.1 zoom manuale [−][%][+][Adatta][100%] nella status bar
   4.2 toggle vero B/I/U/S (rimuovi se presente, applica se assente,
       caret = stato di digitazione, stato da selezione, mousedown
       preventDefault già presente in iconBtn, nessun residuo)
   Eseguire con: node tests/patch_doc_b4.js [--dry]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'documenti.js');
const DRY = process.argv.indexOf('--dry') >= 0;

const exact = [];
function E(name, before, after) { exact.push({ name, before, after }); }

// ---------------------------------------------------------------
// 1) funzioni toggle mark (inserite prima di "trova e sostituisci")
// ---------------------------------------------------------------
const MARK_FUNCS = `    // ---------- BLOCCO 4: toggle vero per B/I/U/S ----------
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
    // stato attuale del mark sulla selezione corrente (o pending sul caret)
    function markState(cmd) {
        try {
            if (typeof document.queryCommandState === 'function') {
                const s = document.queryCommandState(cmd);
                if (typeof s === 'boolean') return s;
            }
        } catch (e) { /* fallback DOM */ }
        const sel0 = window.getSelection();
        const collapsed = !sel0 || !sel0.rangeCount || sel0.getRangeAt(0).collapsed;
        if (collapsed && st && st.typingMarks && st.typingMarks[cmd] != null) return !!st.typingMarks[cmd];
        return selectionHasMark(cmd);
    }
    function stripMarkDeep(node, cmd) {
        if (!node || !node.querySelectorAll) return;
        const all = node.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            if (isMarkedEl(el, cmd)) {
                const p = el.parentNode;
                if (!p) continue;
                while (el.firstChild) p.insertBefore(el.firstChild, el);
                p.removeChild(el);
            }
        }
    }
    function selectRangeSaved(r) {
        try {
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
            savedRange = r.cloneRange();
        } catch (e) { /* ok */ }
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
        const want = !has;
        // 1) dove disponibile, prova il comando nativo e verifica il risultato
        if (typeof document.execCommand === 'function') {
            let nativeOk = false;
            try { nativeOk = document.execCommand(cmd, false, null) === true; } catch (e) { nativeOk = false; }
            if (nativeOk && selectionHasMark(cmd) === want) {
                afterEdit();
                updateStates();
                return;
            }
            // nativo assente/errato → ripristina la selezione e procedi manualmente
            restoreSel();
        }
        // 2) percorso manuale con API Range: estrai → applica/rimuovi → reinserisci
        const cur = sel.getRangeAt(0);
        let frag = null;
        try { frag = cur.extractContents(); } catch (e) { frag = null; }
        if (!frag) { updateStates(); return; }
        if (want) {
            const tag = cmd === 'bold' ? 'b' : cmd === 'italic' ? 'i' : cmd === 'underline' ? 'u' : 's';
            const wrap = document.createElement(tag);
            stripMarkDeep(frag, cmd);        // niente <b> dentro <b>
            wrap.appendChild(frag);
            cur.insertNode(wrap);
            const r2 = document.createRange();
            try { r2.selectNodeContents(wrap); } catch (e) { /* ok */ }
            selectRangeSaved(r2);
        } else {
            stripMarkDeep(frag, cmd);        // nessun residuo di stile
            const first = frag.firstChild, last = frag.lastChild;
            cur.insertNode(frag);
            if (first && last) {
                const r2 = document.createRange();
                try { r2.setStartBefore(first); r2.setEndAfter(last); selectRangeSaved(r2); } catch (e) { /* ok */ }
            }
        }
        afterEdit();
        updateStates();
    }

`;
E('mark-funcs',
    `    // ---------- trova e sostituisci (logica invariata, UI in popover 2D) ----------`,
    MARK_FUNCS + `    // ---------- trova e sostituisci (logica invariata, UI in popover 2D) ----------`);

// ---------------------------------------------------------------
// 2) updateStates: stati dai mark (DOM fallback) oltre a queryCommandState
// ---------------------------------------------------------------
E('updateStates',
    `    function updateStates() {
        if (!st || !st.editor || !st.editor.isConnected) return;
        Object.keys(stateBtns).forEach(function (cmd) {
            const b = stateBtns[cmd];
            if (!b) return;
            let on = false;
            try { on = document.queryCommandState(cmd); } catch (e) { on = false; }
            b.classList.toggle('on', !!on);
        });
    }`,
    `    function updateStates() {
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
    }`);

// ---------------------------------------------------------------
// 3) pulsanti B/I/U/S → toggleMark
// ---------------------------------------------------------------
E('btns-toggle',
    `        stateBtns.bold = iconBtn(cFmt, I_B, 'Grassetto (Ctrl+B)', function () { exec('bold'); });
        stateBtns.italic = iconBtn(cFmt, I_I, 'Corsivo (Ctrl+I)', function () { exec('italic'); });
        stateBtns.underline = iconBtn(cFmt, I_U, 'Sottolineato (Ctrl+U)', function () { exec('underline'); });
        stateBtns.strikeThrough = iconBtn(cFmt, I_S, 'Barrato', function () { exec('strikeThrough'); });`,
    `        stateBtns.bold = iconBtn(cFmt, I_B, 'Grassetto (Ctrl+B)', function () { toggleMark('bold'); });
        stateBtns.italic = iconBtn(cFmt, I_I, 'Corsivo (Ctrl+I)', function () { toggleMark('italic'); });
        stateBtns.underline = iconBtn(cFmt, I_U, 'Sottolineato (Ctrl+U)', function () { toggleMark('underline'); });
        stateBtns.strikeThrough = iconBtn(cFmt, I_S, 'Barrato', function () { toggleMark('strikeThrough'); });`);

// ---------------------------------------------------------------
// 4) zoom manuale: helper + fit con override utente
// ---------------------------------------------------------------
E('zoom-helpers',
    `    // ---------- ZOOM-TO-FIT sull'altezza (2C) ----------`,
    `    // ---------- BLOCCO 4: zoom manuale [−][%][+][Adatta][100%] ----------
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

    // ---------- ZOOM-TO-FIT sull'altezza (2C) ----------`);

E('fitZoom-user',
    `    function fitZoom() {
        if (!st || !st.canvas || !st.stage || !st.zoom || !st.sheet || !st.canvas.isConnected) return;
        const availH`,
    `    function fitZoom() {
        if (!st || !st.canvas || !st.stage || !st.zoom || !st.sheet || !st.canvas.isConnected) return;
        if (st.zoomUser != null) { applyZoomTo(st.zoomUser); return; }
        const availH`);

E('fitZoom-guard',
    `        if (availH < 80 || availW < 80) return;`,
    `        if (availH < 80 || availW < 80) { applyZoomTo(1); return; }   // spazio misurabile assente → 100%`);

E('fitZoom-tail',
    `        st.zoomLevel = z;
        st.zoom.style.width = PAGE_W + 'px';
        st.zoom.style.transform = 'scale(' + z + ')';
        const sheetH = st.sheet.offsetHeight || PAGE_H;
        st.stage.style.width = Math.round(PAGE_W * z) + 'px';
        st.stage.style.height = Math.round(sheetH * z) + 'px';
        updatePager();
    }`,
    `        applyZoomTo(z);
    }`);

// ---------------------------------------------------------------
// 5) status bar: gruppo zoom tra stats e pager
// ---------------------------------------------------------------
E('status-zoom',
    `        const status = App.el('div', 'doc-status');
        st.status = App.el('span', 'doc-stats', '0 parole \\u00b7 0 caratteri');
        st.pager = App.el('span', 'doc-pager', 'Pagina 1/1 \\u00b7 Zoom 100%');
        status.appendChild(st.status);
        status.appendChild(st.pager);
        shell.appendChild(status);`,
    `        const status = App.el('div', 'doc-status');
        st.status = App.el('span', 'doc-stats', '0 parole \\u00b7 0 caratteri');
        st.pager = App.el('span', 'doc-pager', 'Pagina 1/1 \\u00b7 Zoom 100%');
        // BLOCCO 4: controlli zoom nella status bar
        const zgrp = App.el('span', 'doc-zoomgrp');
        const zbOut = App.el('button', 'doc-zbtn');
        zbOut.type = 'button'; zbOut.title = 'Riduci zoom (\\u2212)'; zbOut.textContent = '\\u2212';
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
        status.appendChild(st.status);
        status.appendChild(zgrp);
        status.appendChild(st.pager);
        shell.appendChild(status);`);

// ---------------------------------------------------------------
// 6) CSS gruppo zoom
// ---------------------------------------------------------------
E('css-zoom',
    `        '.doc-pager{color:#8b95a5;flex-shrink:0}' +`,
    `        '.doc-pager{color:#8b95a5;flex-shrink:0}' +
        '.doc-zoomgrp{display:flex;align-items:center;gap:4px;flex-shrink:0}' +
        '.doc-zbtn{height:18px;min-width:20px;padding:0 6px;background:#1d2333;border:1px solid var(--border);border-radius:6px;color:#c3cbdb;font:inherit;font-size:11px;font-weight:700;cursor:pointer;line-height:1;transition:border-color .15s,color .15s}' +
        '.doc-zbtn:hover{border-color:var(--accent);color:#fff}' +
        '.doc-zoomval{min-width:40px;text-align:center;font-size:11px;font-weight:800;color:#c3cbdb;font-variant-numeric:tabular-nums}' +`);

// ---------------------------------------------------------------
let src = fs.readFileSync(FILE, 'utf8');
let okCount = 0;
for (const op of exact) {
    const i = src.indexOf(op.before);
    if (i < 0) { console.error('non trovato: ' + op.name); process.exit(1); }
    if (src.indexOf(op.before, i + op.before.length) >= 0) { console.error('ambiguo: ' + op.name); process.exit(1); }
    src = src.slice(0, i) + op.after + src.slice(i + op.before.length);
    okCount++;
}
if (DRY) { console.log('DRY: ' + okCount + '/' + exact.length + ' patch trovate e uniche.'); process.exit(0); }
fs.writeFileSync(FILE, src, 'utf8');
console.log('OK: ' + okCount + '/' + exact.length + ' patch applicati a documenti.js');
