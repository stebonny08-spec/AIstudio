'use strict';
/* R21: bump badge ?v= dei moduli changed nel load order di index.html */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'web_frontend', 'html', 'index.html');
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) + '+01:00';
let html = fs.readFileSync(p, 'utf8');
const files = ['fonti_panel.js', 'notes.js', 'schemaStrategies.js', 'schemi.js',
    'documenti.js', 'presentazioni.js', 'fogli.js', 'video.js', 'ripasso.js'];
let n = 0;
files.forEach(f => {
    const re = new RegExp('(' + f.replace('.', '\\.') + '\\?v=)[^"]+');
    const before = html;
    html = html.replace(re, '$1' + stamp);
    if (html !== before) n++;
    else if (html.indexOf(f + '?v=') < 0) console.log('ATTENZIONE: tag assente per ' + f);
});
fs.writeFileSync(p, html, 'utf8');
console.log('bump ?v=' + stamp + ' su ' + n + '/' + files.length + ' tag');
