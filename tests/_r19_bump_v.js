'use strict';
/* tests/_r19_bump_v.js - FASE FINALE R19: aggiorna il badge ?v= di
   index.html per i moduli modificati in questo round
   (notes.js, schemi.js, schemaStrategies.js). Owner unico: capo finale. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = path.join(ROOT, 'web_frontend', 'html', 'index.html');
const now = new Date();
// stesso formato storico: YYYY-MM-DDTHH:MM:SS+01:00 (ora locale +01:00)
const pad = n => String(n).padStart(2, '0');
const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + '+01:00';
let html = fs.readFileSync(P, 'utf8');
let n = 0;
['notes.js', 'schemaStrategies.js', 'schemi.js'].forEach(f => {
    const re = new RegExp('(' + f.replace('.', '\\.') + '\\?v=)[^"]+');
    const before = html;
    html = html.replace(re, '$1' + stamp);
    if (html !== before) n++;
});
fs.writeFileSync(P, html);
console.log('bump ?v=' + stamp + ' su ' + n + ' script tag');
// verifica
['notes.js', 'schemaStrategies.js', 'schemi.js'].forEach(f => {
    const m = new RegExp(f.replace('.', '\\.') + '\\?v=([^"]+)').exec(html);
    console.log('  ' + f + ' -> ' + (m ? m[1] : 'ASSENTE'));
});
