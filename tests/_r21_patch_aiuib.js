'use strict';
/* patch mirato: T5b.13 deve leggere .rip-toast (ripasso) e non .ai-toast */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'tests', 'aiUi_smoke.test.js');
let t = fs.readFileSync(p, 'utf8');
const a = "ok(toasts(env).some(t => t.indexOf('coppie aggiunte') >= 0),\n                            'T5b.13 Estrai bozza usa il testo della fonte', toasts(env).join('|'));";
const b = "const ripT = $$(env, '.rip-toast').map(x => x.textContent || '');\n" +
    "                        const allT = ripT.concat(toasts(env));\n" +
    "                        ok(allT.some(x => x.indexOf('coppie aggiunte') >= 0),\n" +
    "                            'T5b.13 Estrai bozza usa il testo della fonte', allT.join('|'));";
if (t.indexOf(a) < 0) {
    // tollera CRLF
    const a2 = a.replace(/\n/g, '\r\n');
    if (t.indexOf(a2) >= 0) { t = t.replace(a2, b.replace(/\n/g, '\r\n')); }
    else { console.log('PATTERN NON TROVATO'); process.exit(1); }
} else t = t.replace(a, b);
fs.writeFileSync(p, t, 'utf8');
console.log('PATCH OK');
