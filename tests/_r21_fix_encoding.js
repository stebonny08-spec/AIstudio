'use strict';
/* tests/_r21_fix_encoding.js - ripristino doppiacodifica UTF8 (artefatto
   della round-trip PS: Get-Content ANSI + Set-Content UTF8). Trasforma solo
   le PAIA/triple (c1 in U+00C0..FF + cont in A0..BF | speciali 1252) che
   decodificano a UTF8 VALIDO: il testo UTF8 corretto (es. 'è'+spazio) non ha
   byte validi e resta intatto. Uso: node tests/_r21_fix_encoding.js [--apply] */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const SPECIALS = new Map([
    [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
    [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93],
    [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
    [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
    [0x0081, 0x81], [0x008D, 0x8D], [0x008F, 0x8F], [0x0090, 0x90], [0x009D, 0x9D]
]);
const dec = new TextDecoder('utf-8', { fatal: true });

function contByte(code) {
    if (code >= 0xA0 && code <= 0xBF) return code;
    return SPECIALS.has(code) ? SPECIALS.get(code) : -1;
}
function repair(str) {
    const chars = Array.from(str);
    let out = '', i = 0, fixed = 0;
    while (i < chars.length) {
        const c1 = chars[i].codePointAt(0);
        if (c1 >= 0xC0 && c1 <= 0xF4) {
            const lead = c1 & 0xFF;
            const need = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : 2;
            const bytes = [lead];
            let j = i + 1, ok = true;
            while (bytes.length < need && j < chars.length) {
                const cb = contByte(chars[j].codePointAt(0));
                if (cb < 0) { ok = false; break; }
                bytes.push(cb);
                j++;
            }
            if (ok && bytes.length === need) {
                try {
                    const s = dec.decode(Uint8Array.from(bytes));
                    if (Array.from(s).length === 1) { out += s; i = j; fixed++; continue; }
                } catch (e) { /* non valido: copia cosi' com'è */ }
            }
        }
        out += chars[i];
        i++;
    }
    return { str: out, fixed: fixed };
}

const FILES = [
    'web_frontend/html/js/modules/presentazioni.js',
    'web_frontend/html/js/modules/documenti.js',
    'web_frontend/html/index.html',
    'qa_ui/schemi.html',
    'NOTE.md'
];
const apply = process.argv.indexOf('--apply') >= 0;
let total = 0;
FILES.forEach(rel => {
    const p = path.join(ROOT, rel);
    const raw = fs.readFileSync(p);
    // decodifica UTF8 (tolera BOM)
    let txt = raw.toString('utf8');
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
    const r = repair(txt);
    total += r.fixed;
    console.log(rel + ': riparati=' + r.fixed);
    if (apply && r.fixed > 0) fs.writeFileSync(p, r.str, 'utf8');
});
console.log((apply ? 'APPLICATO' : 'DRY-RUN') + ' - totale riparati=' + total);
