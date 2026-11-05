'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'web_frontend', 'html', 'index.html');
const stamp = '2026-10-30T15:49:23+01:00';
let html = fs.readFileSync(p, 'utf8');
let n = 0;
['presentazioni.js', 'ripasso.js'].forEach(f => {
    const a = '<script src="js/modules/' + f + '"></script>';
    const b = '<script src="js/modules/' + f + '?v=' + stamp + '"></script>';
    if (html.indexOf(a) >= 0) { html = html.split(a).join(b); n++; }
    else console.log('già con ?v o assente: ' + f);
});
fs.writeFileSync(p, html, 'utf8');
console.log('v aggiunti: ' + n);
// ordine: fonti_panel prima di tutti i moduli
const iPf = html.indexOf('js/modules/fonti_panel.js');
const ord = ['notes.js', 'schemi.js', 'documenti.js', 'presentazioni.js', 'fogli.js', 'video.js', 'ripasso.js'];
let okOrder = iPf >= 0;
ord.forEach(f => {
    const i = html.indexOf('js/modules/' + f);
    if (i >= 0 && i < iPf) { okOrder = false; console.log('ORDINE SBAGLIATO: ' + f + ' prima di fonti_panel'); }
});
console.log('ordine fonti_panel PRIMA di tutti i moduli: ' + okOrder);
