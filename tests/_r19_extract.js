'use strict';
/* tests/_r19_extract.js - estrae {shaping,ui} da r19_s_measures.json in
   qa/r19_a_measures.json (deliverable Blocco A) e verifica le chiavi. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const sPath = path.join(ROOT, 'qa', 'r19_s_measures.json');
const m = JSON.parse(fs.readFileSync(sPath, 'utf8'));
console.log('keys r19_s_measures:', Object.keys(m).join(','));
console.log('S prima/dopo presenti:', !!(m.prima && m.dopo),
    '| shaping:', !!m.shaping, '| ui:', !!m.ui);
fs.writeFileSync(path.join(ROOT, 'qa', 'r19_a_measures.json'),
    JSON.stringify({ shaping: m.shaping, ui: m.ui }, null, 2));
console.log('qa/r19_a_measures.json scritto');
const shots = fs.readdirSync(path.join(ROOT, 'qa'))
    .filter(f => /^r19_a_.*\.png$/.test(f)).sort();
console.log('screenshot A (' + shots.length + '):');
shots.forEach(s => console.log('  ' + s));
