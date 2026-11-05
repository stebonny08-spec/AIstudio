/* tests/patch_doc_b4b.js — riscrittura del toggle mark dopo la probe
   su semantica Range: la rimozione ora splitta ai confini e unwrapa
   gli elementi marcati nell'albero ORIGINALE (nessun residuo);
   l'applicazione lavora per blocco con confini a livello figlio. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'documenti.js');
const DRY = process.argv.indexOf('--dry') >= 0;

const START = '    function stripMarkDeep(node, cmd) {';
const END = '    // ---------- trova e sostituisci (logica invariata, UI in popover 2D) ----------';

const NEW = `    function stripMarkDeep(node, cmd) {
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
    // divide l'elemento ai confini: la parte fuori finisce in un clone,
    // la parte dentro resta in el (poi può essere scollegata)
    function splitElAtRange(el, range) {
        const parent = el.parentNode;
        if (!parent) return false;
        let changed = false;
        const idxE = boundaryIndex(el, range.endContainer, range.endOffset);
        if (idxE > 0 && idxE < el.childNodes.length) {
            const clone = el.cloneNode(false);
            while (el.childNodes.length > idxE) clone.appendChild(el.childNodes[idxE]);
            parent.insertBefore(clone, el.nextSibling);
            changed = true;
        }
        let idxS = boundaryIndex(el, range.startContainer, range.startOffset);
        if (idxS > 0 && idxS <= el.childNodes.length) {
            const clone = el.cloneNode(false);
            while (idxS > 0) { clone.insertBefore(el.firstChild, clone.firstChild); idxS--; }
            parent.insertBefore(clone, el);
            changed = true;
        }
        return changed;
    }
    // RIMOZIONE senza residui: split ai confini + unwrap nell'albero originale
    function removeMarkRange(range, cmd) {
        splitBoundary(range);
        let guard = 0;
        while (guard++ < 80) {
            const els = markedIntersecting(range, cmd);
            if (!els.length) return;
            let progress = false;
            els.forEach(function (el) {
                if (!el.parentNode) return;
                try { if (!range.intersectsNode(el)) return; } catch (e) { return; }
                if (allContentInRange(el, range)) { unwrapEl(el); progress = true; }
            });
            if (progress) continue;
            for (let i = 0; i < els.length; i++) {
                if (splitElAtRange(els[i], range)) { progress = true; break; }
            }
            if (!progress) return;
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
        if (has) removeMarkRange(range, cmd);
        else applyMarkRange(range, cmd);
        afterEdit();
        updateStates();
    }

`;

let src = fs.readFileSync(FILE, 'utf8');
const s = src.indexOf(START);
if (s < 0 || src.indexOf(START, s + 1) >= 0) { console.error('START non trovato/ambiguo'); process.exit(1); }
const e = src.indexOf(END, s + START.length);
if (e < 0) { console.error('END non trovato'); process.exit(1); }
if (DRY) { console.log('DRY: splice trovato [' + s + ',' + e + ')'); process.exit(0); }
src = src.slice(0, s) + NEW + src.slice(e);
fs.writeFileSync(FILE, src, 'utf8');
console.log('OK: toggle mark riscritto (' + Buffer.byteLength(NEW) + ' bytes)');
