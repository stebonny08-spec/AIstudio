'use strict';
const fs = require('fs');
const jobs = JSON.parse(fs.readFileSync('qa/_r31b_jobs.json', 'utf8'));
const NL = String.fromCharCode(10);
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
function count(s, f) { let c = 0, i = 0; while (true) { const k = s.indexOf(f, i); if (k < 0) break; c++; i = k + f.length; } return c; }
let bad = 0;
for (const j of jobs) {
    let s = fs.readFileSync(j.f, 'utf8');
    let find = j.find, repl = j.repl, cnt = count(s, find);
    if (cnt === 0 && find.indexOf(NL) >= 0) {
        const f2 = find.split(NL).join(CRLF), r2 = repl.split(NL).join(CRLF);
        if (count(s, f2) === j.n) { find = f2; repl = r2; cnt = count(s, find); }
    }
    if (cnt !== j.n) { console.log('COUNT ' + j.f + ' got ' + cnt + ' want ' + j.n + ' :: ' + find.slice(0, 60).replace(/\n/g, ' | ')); bad++; continue; }
    fs.writeFileSync(j.f, s.split(find).join(repl));
    console.log('OK ' + j.f + ' x' + cnt);
}
process.exit(bad ? 1 : 0);
