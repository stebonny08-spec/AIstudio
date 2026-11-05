'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let n = 0;
function patch(rel, a, b) {
    const p = path.join(ROOT, rel);
    let t = fs.readFileSync(p, 'utf8');
    if (t.indexOf(a) < 0) { console.log('NON TROVATO ' + rel + ': ' + a.slice(0, 70)); return; }
    const c = t.split(a).length - 1;
    fs.writeFileSync(p, t.split(a).join(b), 'utf8');
    n += c;
    console.log('ok ' + rel + ' x' + c);
}
// 1) fonti_panel itemTexts: PRESERVA i newline (il md deve restare multiriga)
patch('web_frontend/html/js/modules/fonti_panel.js',
    "const texts = o.objects.filter(x => x && x.t === 'text' && x.text)\n                    .map(x => String(x.text).replace(/\\s+/g, ' ').trim()).filter(Boolean);",
    "const texts = o.objects.filter(x => x && x.t === 'text' && x.text)\n                    .map(x => String(x.text).replace(/\\r/g, '').replace(/[ \\t]+/g, ' ').trim()).filter(Boolean);");
// 2) matrice: il fixture html usa <b> (allowlist) e non <strong>
patch('qa_browser/qaR21_matrix.js',
    'strong: /<strong>forte<\\/strong>/.test(html),',
    'strong: /<b>forte<\\/b>/.test(html),');
patch('qa_browser/qaR21_matrix.js',
    'htmlInfo.strong', 'htmlInfo.strong');
console.log('TOT=' + n);
