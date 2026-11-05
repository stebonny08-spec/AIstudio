'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let n = 0;
function patch(rel, pairs) {
    const p = path.join(ROOT, rel);
    let t = fs.readFileSync(p, 'utf8');
    pairs.forEach(([a, b]) => {
        if (t.indexOf(a) < 0) { console.log('NON TROVATO in ' + rel + ': ' + a.slice(0, 60)); return; }
        const c = t.split(a).length - 1;
        t = t.split(a).join(b);
        n += c;
        console.log('ok ' + rel + ': ' + c + 'x ' + a.slice(0, 50));
    });
    fs.writeFileSync(p, t, 'utf8');
}
// 1) harness notes: ready compatibile baseline (fn-side) e R21 (fp21-root)
patch('qa_ui/notes.html', [[
    "document.querySelector('.fp21-root'));",
    "(document.querySelector('.fp21-root') || document.querySelector('.fn-side')));"
]]);
// 2) matrice: RegExp ricostruite dentro evaluate
patch('qa_browser/qaR21_matrix.js', [[
    'const b = Array.from(document.querySelectorAll(\'.fp21-item\'))\n                    .filter(x => re.test(x.textContent))[0];',
    'const b = Array.from(document.querySelectorAll(\'.fp21-item\'))\n                    .filter(x => new RegExp(re).test(x.textContent))[0];'
], [
    'const b = Array.from(document.querySelectorAll(\'.fp21-item\')).filter(x => re.test(x.textContent))[0];',
    'const b = Array.from(document.querySelectorAll(\'.fp21-item\')).filter(x => new RegExp(re).test(x.textContent))[0];'
], [
    'const b = Array.from(document.querySelectorAll(\'.fp21-item\')).filter(x => re.test(x.textContent))[0];\n                if (b) b.click();',
    'const b = Array.from(document.querySelectorAll(\'.fp21-item\')).filter(x => new RegExp(re).test(x.textContent))[0];\n                if (b) b.click();'
]]);
// 3) ripasso harness: apri direttamente il mazzo (Fonti e' nell'editor)
patch('qa_ui/ripasso.html', [[
    'await mod.open(main, {});',
    'await mod.open(main, { open: \'m1\' });'
]]);
console.log('TOTALE sostituzioni=' + n);
