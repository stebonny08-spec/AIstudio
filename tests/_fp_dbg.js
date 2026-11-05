'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('./harness/node_modules/jsdom');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
dom.window.eval(SRC);
const A = dom.window.FontiPanel.adapters;
const out = A.renderMarkdown21('# T\n\n- elenco\n- due\n\n1. uno\n2. due');
console.log('LIST TEST =>', out);
const MD = '# Titolo\n\nParagrafo con **grasso** e formula $x^2$.\n\n' +
    '$$\\xrightarrow{\\nu} \\text{ok}$$\n\n' +
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n' +
    '- elenco\n- due\n\n```js\nconst x = 1;\n```';
const out2 = A.renderMarkdown21(MD);
console.log('FULL MD =>', out2);
