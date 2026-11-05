/* tests/patch_doc_b4c.js — fix residui: nodi di testo vuoti dopo
   l'applicazione + riselena dopo la rimozione */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'documenti.js');
const DRY = process.argv.indexOf('--dry') >= 0;

let src = fs.readFileSync(FILE, 'utf8');

// 1) removeMarkRange: split → unwrap → pulizia vuoti → riselena
const RSTART = '    // RIMOZIONE senza residui: split ai confini + unwrap nell\'albero originale\n    function removeMarkRange(range, cmd) {';
// nota: l'apostrofo è un carattere reale ' nel file (escape JS \u2019 nel sorgente?)
// usiamo un marcatore sicuro:
const SAFE_START = '    function removeMarkRange(range, cmd) {';
const SAFE_END = '    // APPLICAZIONE per blocco';

const NEW = `    // elimina i nodi di testo vuoti lasciati dalle operazioni Range
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
`;
let s = src.indexOf(SAFE_START);
if (s < 0 || src.indexOf(SAFE_START, s + 1) >= 0) { console.error('removeMarkRange START non ok'); process.exit(1); }
let e = src.indexOf(SAFE_END, s + SAFE_START.length);
if (e < 0) { console.error('removeMarkRange END non ok'); process.exit(1); }
src = src.slice(0, s) + NEW + src.slice(e);

// 2) applyMarkRange: dopo l'inserimento, toglie i vuoti del blocco
const A = '                r.insertNode(wrap);\n                lastWrap = wrap;';
const A2 = '                r.insertNode(wrap);\n                dropEmptyTexts(block);   // niente nodi vuoti residue\n                lastWrap = wrap;';
const ai = src.indexOf(A);
if (ai < 0 || src.indexOf(A, ai + A.length) >= 0) { console.error('apply insert non ok'); process.exit(1); }
src = src.slice(0, ai) + A2 + src.slice(ai + A.length);

if (DRY) { console.log('DRY: 2/2 patch trovate e uniche.'); process.exit(0); }
fs.writeFileSync(FILE, src, 'utf8');
console.log('OK: 2/2 patch applicati');
