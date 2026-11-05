'use strict';
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'tests', 'aiUi_smoke.test.js');
let t = fs.readFileSync(p, 'utf8');
const a = "$(env, '.rip-toast').map";
const b = "$$(env, '.rip-toast').map";
const n = t.split(a).length - 1;
if (n < 1) { console.log('NON TROVATO'); process.exit(1); }
t = t.split(a).join(b);
fs.writeFileSync(p, t, 'utf8');
console.log('PATCH2 OK occ=' + n);
