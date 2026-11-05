/* tests/patch_pp_b3.js — BLOCCO 3: rimuove i duplicati toolbar↔proprietà */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'presentazioni.js');
const DRY = process.argv.indexOf('--dry') >= 0;

let src = fs.readFileSync(FILE, 'utf8');

// 1) rimozione blocco toolbar [layout ▾, sfondo, transizione ▾]
const START = '        // [layout';
const END = '        // [zoom';
const REPL = '        // BLOCCO 3: layout/sfondo/transizione vivono SOLO nel pannello Proprietà (sezione Slide)\n        ';
let s = src.indexOf(START);
if (s < 0 || src.indexOf(START, s + 1) >= 0) { console.error('START non trovato/ambiguo'); process.exit(1); }
let e = src.indexOf(END, s + START.length);
if (e < 0 || src.indexOf(END, e + 1) >= 0) { console.error('END non trovato/ambiguo'); process.exit(1); }
src = src.slice(0, s) + REPL + src.slice(e);

// 2) aggiorna commento di testa
const H = '[layout/sfondo/transizione]';
const hi = src.indexOf(H);
if (hi < 0 || src.indexOf(H, hi + 1) >= 0) { console.error('HEADER non trovato/ambiguo'); process.exit(1); }
src = src.slice(0, hi) + '(slide: layout/sfondo/transizione SOLO in Proprietà)' + src.slice(hi + H.length);

if (DRY) { console.log('DRY: 2/2 patch trovate e uniche.'); process.exit(0); }
fs.writeFileSync(FILE, src, 'utf8');
console.log('OK: 2/2 patch applicati a presentazioni.js');
