'use strict';
/* tests/_r19_inkdiff.js - confronta le funzioni di frame live ink tra
   qa/r19_notes_baseline.js (pre-R19) e notes.js corrente. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
function src(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function ext(text, name) {
    const i = text.indexOf('function ' + name + '(');
    if (i < 0) return null;
    let d = 0, started = false;
    for (let j = i; j < text.length; j++) {
        if (text[j] === '{') { d++; started = true; }
        else if (text[j] === '}') { d--; if (started && d === 0) return text.slice(i, j + 1); }
    }
    return null;
}
const b = src('qa/r19_notes_baseline.js');
const c = src('web_frontend/html/js/modules/notes.js');
['scheduleInkFrame', 'inkFrame', 'onPointerMove', 'endPointer'].forEach(fn => {
    const eb = ext(b, fn), ec = ext(c, fn);
    if (eb === null || ec === null) {
        console.log(fn + ': baseline=' + (eb ? 'ok' : 'ASSENTE') + ' current=' + (ec ? 'ok' : 'ASSENTE'));
        return;
    }
    const norm = s => s.replace(/\r\n/g, '\n').trim();
    const eq = norm(eb) === norm(ec);
    console.log(fn + ': ' + (eq ? 'UGUALE' : 'DIVERSO') +
        ' (len ' + eb.length + ' -> ' + ec.length + ')');
    if (!eq) {
        // prime righe diverse
        const lb = norm(eb).split('\n'), lc = norm(ec).split('\n');
        for (let k = 0; k < Math.max(lb.length, lc.length); k++) {
            if (lb[k] !== lc[k]) {
                console.log('  prima riga diversa @' + k);
                console.log('  B: ' + (lb[k] || '').trim());
                console.log('  C: ' + (lc[k] || '').trim());
                break;
            }
        }
    }
});
