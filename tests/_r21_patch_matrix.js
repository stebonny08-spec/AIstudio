'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'qa_browser', 'qaR21_matrix.js');
let t = fs.readFileSync(p, 'utf8');
const a = 'await newPage(browser, { file: cell.file });';
const b = 'await newPage(browser, { file: cell.file, readyExpr: cell.ready() });';
if (t.indexOf(a) < 0) { console.log('NON TROVATO'); process.exit(1); }
t = t.replace(a, b);
fs.writeFileSync(p, t, 'utf8');
console.log('PATCH OK');
