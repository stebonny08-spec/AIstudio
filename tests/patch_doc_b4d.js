/* tests/patch_doc_b4d.js — fix splitElAtRange:
   - confini salvati (le mutazioni DOM ripuntano il range)
   - end-index: il figlio che CONTIENE la fine resta dentro */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'documenti.js');
const DRY = process.argv.indexOf('--dry') >= 0;

const START = '    function boundaryIndex(el, container, offset) {';
const END = '    function removeMarkRange(range, cmd) {';

const NEW = `    function boundaryIndex(el, container, offset) {
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
    // perché le mutazioni DOM ripuntano i range (comportamento di标准 DOM).
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
`;

let src = fs.readFileSync(FILE, 'utf8');
const s = src.indexOf(START);
if (s < 0 || src.indexOf(START, s + 1) >= 0) { console.error('START non ok'); process.exit(1); }
const e = src.indexOf(END, s + START.length);
if (e < 0) { console.error('END non ok'); process.exit(1); }
if (DRY) { console.log('DRY: splice [' + s + ',' + e + ') trovato e unico'); process.exit(0); }
src = src.slice(0, s) + NEW + src.slice(e);
fs.writeFileSync(FILE, src, 'utf8');
console.log('OK: splitElAtRange riscritto');
