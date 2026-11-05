'use strict';
/* tests/f22_fonti_math.test.js - R22 FE-FONTI B5.2: KaTeX INLINE.
   renderMarkdown21 processa oltre a $$...$$ e $...$ anche \( ... \) (inline)
   e \[ ... \] (display): sia con katex presente (stub) sia in fallback
   (mathFallback ripulisce anche \Delta via \\([a-zA-Z]+)).
   Assert DOM: nessun nodo testo visibile dentro .fp21-pbody con '\Delta',
   '\text', '$$' o delimitatori \( \) \[ \] non renderizzati.
   Esecuzione: node tests/f22_fonti_math.test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// formula con TUTTE le forme: $...$, \(...\), $$...$$, \[...\]
const MATH_TEXT = 'Inline $x^2$ e parentesi \\(y_i + \\Delta t\\), display:\n\n' +
    '$$\\sum_{i=0}^{n} x_i$$\n\ne quadre \\[\\int_0^1 f(x)\\,dx\\] fine.';
const MATH_CONTENT = JSON.stringify({
    objects: [{ t: 'text', x: 40, y: 40, w: 500, h: 120, text: MATH_TEXT, size: 14, color: '#141414' }]
});
const RAW_TOKENS = ['\\Delta', '\\text', '$$', '\\(', '\\)', '\\[', '\\]', '\\sum', '\\int'];

function makeEnv(withKatex) {
    const vc = new VirtualConsole();
    const errs = [];
    vc.on('jsdomError', e => errs.push(String((e && e.message) || e)));
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/', pretendToBeVisual: true,
        runScripts: 'outside-only', virtualConsole: vc
    });
    const win = dom.window;
    win.StudyStore = {
        listItems: async () => [{
            id: 'm1', kind: 'note', title: 'Nota Math R22', content: MATH_CONTENT,
            materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        }],
        getItem: async () => null,
        listMaterials: async () => []
    };
    win.eval(SRC);
    if (withKatex) {
        // stub katex vendored: simula l'output html senza slash grezzi
        win.katex = {
            renderToString: s => '<span class="katex-ok">' + String(s).replace(/[\\$]/g, '') + '</span>'
        };
    }
    return { win, errs };
}

/* raccoglie i nodi testo VISIBILI, saltando le subtree .katex (annotation
   LaTeX di KaTeX contiene il sorgente ma non e' testo renderizzato) */
function visibleTexts(root) {
    const out = [];
    const walk = node => {
        Array.prototype.forEach.call(node.childNodes || [], n => {
            if (n.nodeType === 3) {
                const t = n.nodeValue || '';
                if (t.trim()) out.push(t);
            } else if (n.nodeType === 1) {
                const cls = String(n.className || '');
                if (/(^|\s)katex(\s|$)/.test(cls)) return;
                walk(n);
            }
        });
    };
    walk(root);
    return out;
}

async function previewViaPanel(env, re) {
    const p = env.win.FontiPanel.create({ contesto: 'appunti', onInsert: () => { } });
    env.win.document.body.appendChild(p.el);
    await sleep(60);
    const item = Array.from(p.el.querySelectorAll('.fp21-item'))
        .filter(b => re.test(b.textContent))[0];
    if (item) item.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
    await sleep(120);
    const pbody = p.el.querySelector('.fp21-pbody');
    const html = pbody ? pbody.innerHTML : '';
    const texts = pbody ? visibleTexts(pbody) : [];
    p.destroy();
    return { html: html, texts: texts, found: !!item };
}

(async () => {
    try {
        /* ============ A: ramo KATEX presente (stub) ============ */
        let env = makeEnv(true);
        let A = env.win.FontiPanel.adapters;
        let h = A.renderMarkdown21(MATH_TEXT);
        ok((h.match(/katex-ok/g) || []).length >= 4,
            'A1 quattro formule processate ($, \\(..\\), $$, \\[..\\])',
            'n=' + (h.match(/katex-ok/g) || []).length);
        ok(RAW_TOKENS.every(t => h.indexOf(t) < 0),
            'A2 nessun LaTeX grezzo nel ramo katex', h.slice(0, 200));

        let pv = await previewViaPanel(env, /Nota Math/);
        ok(pv.found, 'A3 fixture nota selezionata');
        const rawInDom = pv.texts.filter(t => RAW_TOKENS.some(tok => t.indexOf(tok) >= 0));
        ok(rawInDom.length === 0,
            'A4 DOM .fp21-pbody: zero nodi testo con \\Delta/\\text/$$/delimitatori',
            JSON.stringify(rawInDom.slice(0, 2)));
        ok(pv.html.indexOf('katex-ok') >= 0, 'A5 preview con .katex-equivalent renderizzato');

        /* ============ B: ramo FALLBACK (katex assente) ============ */
        env = makeEnv(false);
        A = env.win.FontiPanel.adapters;
        h = A.renderMarkdown21(MATH_TEXT);
        ok(/formula non renderizzabile/.test(h), 'B1 fallback badge presente');
        ok(RAW_TOKENS.every(t => h.indexOf(t) < 0),
            'B2 fallback: nessun LaTeX grezzo (\\Delta ripulito via \\\\([a-zA-Z]+))',
            h.replace(/</g, '\n<').split('\n').filter(l => /mathfb|code/.test(l)).slice(0, 4).join(' | '));

        pv = await previewViaPanel(env, /Nota Math/);
        ok(pv.found, 'B3 fixture nota selezionata (fallback)');
        const rawInDomB = pv.texts.filter(t => RAW_TOKENS.some(tok => t.indexOf(tok) >= 0));
        ok(rawInDomB.length === 0,
            'B4 DOM .fp21-pbody fallback: zero nodi testo con \\Delta/\\text/$$',
            JSON.stringify(rawInDomB.slice(0, 2)));
        ok(pv.html.indexOf('fp21-mathfb') >= 0, 'B5 preview con badge fallback');
        ok(env.errs.length === 0, 'B6 zero eccezioni jsdom', env.errs.slice(0, 2).join(' | '));
    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO f22_fonti_math: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
