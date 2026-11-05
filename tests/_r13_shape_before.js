/* Snapshot struttura STORICA di statistiche.js PRIMA del wiring live R13.
   Output: qa/r13_telem_shape_before.json (confronto prima/dopo). */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');
const ROOT = path.join(__dirname, '..');
const SRC_APP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'app.js'), 'utf8');
const SRC_STATS = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'statistiche.js'), 'utf8');

const vc = new VirtualConsole();
vc.on('error', () => { });
const dom = new JSDOM('<!DOCTYPE html><html><body><main id="welcomeView"></main></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
const win = dom.window, doc = win.document;
win.alert = () => { }; win.confirm = () => false; win.prompt = () => null;
try { Object.defineProperty(win.Document.prototype, 'readyState', { configurable: true, get: function () { return 'loading'; } }); } catch (e) { }
win.eval(SRC_APP);
win.eval(SRC_STATS);
const App = win.App;
['chatbot', 'notes', 'schemi', 'produttivita', 'ripasso', 'biblioteca', 'calendario'].forEach(id => {
    App.registerModule({ id: id, title: 'Mod ' + id, desc: 'desc ' + id });
});
doc.dispatchEvent(new win.Event('DOMContentLoaded'));
App.go('home');
const dev = doc.getElementById('homeView').querySelector('.dev-link');
dev.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const mv = doc.getElementById('moduleView');
const tbl = mv.querySelector('table');
const shape = {
    when: 'BEFORE live wiring (R13)',
    tables: mv.querySelectorAll('table').length,
    cols: tbl.querySelectorAll('thead th').length,
    rows: tbl.querySelectorAll('tbody tr').length,
    header_texts: Array.from(tbl.querySelectorAll('thead th')).map(t => t.textContent),
    first_data_row: Array.from(tbl.querySelectorAll('tbody tr')[0].cells).map(c => c.textContent),
    has_live_block: !!mv.querySelector('.stats-live')
};
fs.writeFileSync(path.join(ROOT, 'qa', 'r13_telem_shape_before.json'),
    JSON.stringify(shape, null, 2), 'utf8');
console.log(JSON.stringify(shape, null, 2));
