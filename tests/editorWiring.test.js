/* ============================================================
   tests/editorWiring.test.js — verifica dell'INTAGLIO (TASK 2/3)
   su web_frontend/html/js/modules/schemi.js + index.html.
   Eseguire con: node tests/editorWiring.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'schemi.js'), 'utf8');
const IDX = fs.readFileSync(path.join(__dirname, '..', 'web_frontend', 'html', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('\n== Caricamento del modulo strategie ==');
const iStratTag = IDX.indexOf('js/modules/schemaStrategies.js');
const iSchemiTag = IDX.indexOf('js/modules/schemi.js');
ok(iStratTag >= 0, 'index.html carica schemaStrategies.js');
ok(iStratTag >= 0 && iSchemiTag > iStratTag, 'schemaStrategies.js precede schemi.js in index.html');

console.log('\n== 2.1 Delega alla strategia ==');
ok(/SchemaStrategies\.getStrategy\(/.test(SRC), 'strategy = SchemaStrategies.getStrategy(...)');
ok(/strat\(\)\.placeNewNode\(/.test(SRC), 'placeNewNode per i nodi nuovi');
ok(/strat\(\)\.canConnect\(/.test(SRC) || /s2\.canConnect\(/.test(SRC), 'canConnect per validare i collegamenti');
ok(/canConnect[\s\S]{0,400}toast\(/.test(SRC), 'toast col motivo quando rifiutato');
ok(/animateLayout\(targets, 200\)/.test(SRC), 'auto-layout con transizione ~200ms');
ok((SRC.match(/animateLayout\(targets, 200\)/g) || []).length === 2, 'animateLayout usato da autoLayout e changeType');
ok(/s\.autoLayout\(ed\.doc\.nodes, ed\.doc\.edges\)/.test(SRC), 'strategy.autoLayout(nodes, edges)');
ok(/edgeStyle\(\)/.test(SRC), 'edgeStyle() nel rendering archi');
ok((SRC.match(/edgeStyle\(\)/g) || []).length >= 2, 'edgeStyle() usato anche per etichetta/dblclick (R14: >=2 = rendering archi + gate etichetta dblclick; la 3a chiamata extra e stata rimossa dal router ad ancore)', String((SRC.match(/edgeStyle\(\)/g) || []).length));
ok(/strategy\.snap\(\)|ed\.strategy \? ed\.strategy\.snap\(\)/.test(SRC), 'snap() durante il drag');
ok(/ui\(\)\.pulsanti|uiS\.pulsanti|ui\.pulsanti/.test(SRC), 'pulsanti visibili da ui()');
ok(/pannelloTesto/.test(SRC), 'pannello testo deciso da ui()');
ok(/ui\(\)\.guide|uiS\.guide|\.ui\(\)\.guide/.test(SRC) && /guideHtml\(/.test(SRC), 'guide decise da ui() e renderizzate');
ok(/gGuide/.test(SRC), 'gruppo SVG guide montato');
ok(/strat\(\)\.nodeSize|s\.nodeSize/.test(SRC), 'dimensione nodi da strategy.nodeSize()');

console.log('\n== 2.2 Rimozione logica hard-coded non dipendente dal tipo ==');
ok(!/function isLR\(/.test(SRC), 'isLR() rimossa');
ok(!/function layoutCircle\(/.test(SRC), 'layoutCircle() rimossa');
ok(!/ed\.doc\.type === 'libero'/.test(SRC), 'nessun switch su type===libero');
ok(!/ed\.doc\.type === 'mappa'/.test(SRC), 'nessun switch su type===mappa');
ok(!/ed\.doc\.type === 'albero'/.test(SRC), 'nessun switch su type===albero');
ok(!/ed\.doc\.type === 'riassunto'/.test(SRC), 'nessun switch su type===riassunto');
ok(!/ed\.doc\.type === 'lr'/.test(SRC), 'nessun switch su type===lr');
ok(!/wide \? 250 : 170/.test(SRC), 'posizioni/dimensioni if-type rimossi da addNode');
ok(/bLayout\.disabled = ed\.doc\.type/.test(SRC) === false, 'disabilitazione auto-layout non hard-coded');

console.log('\n== 2.3 Etichetta arco solo su mappa ==');
ok(/edgeStyle\(\)\.etichetta/.test(SRC), 'dblclick su arco gated da edgeStyle().etichetta');
ok(!/doc\.type === 'mappa'/.test(SRC), 'non c’è più il controllo diretto type===mappa');
ok(/if \(es\.etichetta\)/.test(SRC), 'etichetta renderizzata solo se etichetta=true');

console.log('\n== 3 Cambio tipo ==');
ok(/function changeType\(/.test(SRC), 'azione changeType presente');
ok(/SchemaStrategies\.migrateSchema\(ed\.doc, nuovo\)/.test(SRC), 'changeType usa migrateSchema');
ok(!/OK = li rimuovo/.test(SRC) && !/Annulla = li tengo/.test(SRC),
    'nessuna conferma per gli archi extra (solo marcati, mai rimossi)');
ok(/e\.extra/.test(SRC) && /extraMotivo/.test(SRC), 'archi non validi: extra tratteggiati con motivo');
ok(/changeType\(selType\.value\)/.test(SRC), 'selettore tipo collegato a changeType');
ok(/refreshToolbar\(\)/.test(SRC), 'pulsanti aggiornati al cambio tipo');
ok(/showTab\('testo'\)/.test(SRC), 'pannello testo montato per chi lo prevede');
// type persistito: buildPayload serializza doc.type
ok(/content: JSON\.stringify\(st\.doc\)/.test(SRC), 'doc (con type) persistito in salvataggio');
// alla riapertura: strategy derivata da doc.type
ok(/SchemaStrategies\.getStrategy\(doc\.type\)/.test(SRC), 'riapertura: strategia ricalcolata da doc.type');

console.log('\n== Panoramica funzioni nuove ==');
['function strat(', 'function toast(', 'function edgeGeom(', 'function guideHtml(',
    'function nodeCardHtml(', 'function animateLayout(', 'function buildStrategyButtons(',
    'function refreshToolbar(', 'function changeType(', 'function syncTestoPanel(',
    'function onStrategyBtn('].forEach(fn => ok(SRC.indexOf(fn) >= 0, 'definita ' + fn.slice(0, -1)));

console.log('\n================================================');
console.log('RISULTATI: ' + pass + ' passati, ' + fail + ' falliti');
if (failures.length) { console.log('FALLITI:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
