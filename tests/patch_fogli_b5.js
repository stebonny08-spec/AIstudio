/* ============================================================
   tests/patch_fogli_b5.js — BLOCCO 5 (fogli):
   5.2 ^ e booleani; 5.3 funzioni mancanti + separatore ";";
   5.4 errori #CIRC! #REF! #ERR!; 5.5 placeholder + popover "?" Formule
   Eseguire con: node tests/patch_fogli_b5.js [--dry]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'fogli.js');
const DRY = process.argv.indexOf('--dry') >= 0;

const exact = [];
const splice = [];
function E(name, before, after) { exact.push({ name, before, after }); }
function S(name, start, end, after) { splice.push({ name, start, end, after }); }

// 1) tokenizer: '^' e ';' oltre agli operatori esistenti
E('tok-ops',
    `            if ('+-*/()<>=,:%'.indexOf(ch) >= 0) {`,
    `            if ('+-*/()<>=,:%^;'.indexOf(ch) >= 0) {`);

// 2) riferimento fuori griglia → #REF! (ma LOG10( resta una funzione)
E('ref-bounds',
    `            const refM = rest.match(/^([A-Za-z]{1,3})([0-9]{1,5})(?![A-Za-z0-9_])/);
            if (refM) {
                const col = colFromLetters(refM[1].toUpperCase());
                if (col >= 0 && col < COLS) {
                    const row = parseInt(refM[2], 10);
                    if (row >= 1 && row <= ROWS) {
                        out.push({ t: 'ref', c: col, r: row - 1 });
                        i += refM[0].length;
                        continue;
                    }
                }
            }`,
    `            const refM = rest.match(/^([A-Za-z]{1,3})([0-9]{1,5})(?![A-Za-z0-9_])/);
            if (refM) {
                const col = colFromLetters(refM[1].toUpperCase());
                const row = parseInt(refM[2], 10);
                const inGrid = col >= 0 && col < COLS && row >= 1 && row <= ROWS;
                if (inGrid) {
                    out.push({ t: 'ref', c: col, r: row - 1 });
                    i += refM[0].length;
                    continue;
                }
                // fuori griglia: se e' seguito da '(' e' il nome di una funzione
                // (es. LOG10), altrimenti e' un riferimento inesistente -> #REF!
                if (s[i + refM[0].length] !== '(') throw new Error('#REF!');
            }`);

// 3) potenza '^' (parseMul delega a parsePow)
E('parse-pow',
    `        function parseMul() {
            let l = parseUnary();
            let t;
            while ((t = peek()) && t.t === 'op' && (t.v === '*' || t.v === '/')) {
                next();
                const r = parseUnary();`,
    `        function parsePow() {
            let l = parseUnary();
            let t;
            while ((t = peek()) && t.t === 'op' && t.v === '^') {
                next();
                const r = parseUnary();
                const a = toNum(l), b = toNum(r);
                if (isNaN(a) || isNaN(b)) throw new Error('#VALUE!');
                l = Math.pow(a, b);
            }
            return l;
        }
        function parseMul() {
            let l = parsePow();
            let t;
            while ((t = peek()) && t.t === 'op' && (t.v === '*' || t.v === '/')) {
                next();
                const r = parsePow();`);

// 4) separatore argomenti anche ';'
E('sep-semicolon',
    `                            } else if (x.t === 'op' && x.v === ',' && depth === 0) break;`,
    `                            } else if (x.t === 'op' && (x.v === ',' || x.v === ';') && depth === 0) break;`);
E('sep-consume',
    `                        p++;   // consuma la virgola`,
    `                        p++;   // consuma il separatore (',' o ';')`);

// 5) letterali booleani TRUE / FALSE
E('bool-literals',
    `            if (t.t === 'ident') {
                const nx = peek();
                if (!nx || nx.t !== 'op' || nx.v !== '(') throw new Error('#NAME?');`,
    `            if (t.t === 'ident') {
                if (t.v === 'TRUE') return true;
                if (t.v === 'FALSE') return false;
                const nx = peek();
                if (!nx || nx.t !== 'op' || nx.v !== '(') throw new Error('#NAME?');`);

// 6) ciclo → #CIRC!
E('circ',
    `            if (busy[name]) throw new Error('#LOOP');`,
    `            if (busy[name]) throw new Error('#CIRC!');`);

// 7) funzioni mancanti
E('fn-extra',
    `        function fn(name, args) {
            switch (name) {
                case 'SUM': { const n = nums(args); return n.reduce(function (a, b) { return a + b; }, 0); }
                case 'AVERAGE': { const n = nums(args); if (!n.length) throw new Error('#DIV/0!'); return n.reduce(function (a, b) { return a + b; }, 0) / n.length; }
                case 'MIN': { const n = nums(args); return n.length ? Math.min.apply(null, n) : 0; }
                case 'MAX': { const n = nums(args); return n.length ? Math.max.apply(null, n) : 0; }
                case 'COUNT': { return nums(args).length; }
                case 'IF': {
                    if (!args.length) throw new Error('#SYNTAX');
                    return truthy(args[0]) ? (args.length > 1 ? args[1] : true) : (args.length > 2 ? args[2] : false);
                }
                case 'CONCAT': {
                    return flatten(args).map(function (v) { return formatValue(v); }).join('');
                }
                case 'TEXT': {
                    const v = args.length ? args[0] : '';
                    return formatValue(v);
                }
                default:
                    throw new Error('#NAME?');
            }
        }`,
    `        function fn(name, args) {
            switch (name) {
                case 'SUM': { const n = nums(args); return n.reduce(function (a, b) { return a + b; }, 0); }
                case 'AVERAGE': { const n = nums(args); if (!n.length) throw new Error('#DIV/0!'); return n.reduce(function (a, b) { return a + b; }, 0) / n.length; }
                case 'MIN': { const n = nums(args); return n.length ? Math.min.apply(null, n) : 0; }
                case 'MAX': { const n = nums(args); return n.length ? Math.max.apply(null, n) : 0; }
                case 'COUNT': { return nums(args).length; }
                case 'COUNTA': {
                    return flatten(args).filter(function (v) { return !(v == null || String(v) === ''); }).length;
                }
                case 'IF': {
                    if (!args.length) throw new Error('#SYNTAX');
                    return truthy(args[0]) ? (args.length > 1 ? args[1] : true) : (args.length > 2 ? args[2] : false);
                }
                case 'AND': {
                    const v = flatten(args);
                    if (!v.length) throw new Error('#SYNTAX');
                    return v.every(truthy);
                }
                case 'OR': {
                    const v = flatten(args);
                    if (!v.length) throw new Error('#SYNTAX');
                    return v.some(truthy);
                }
                case 'NOT': {
                    if (!args.length) throw new Error('#SYNTAX');
                    return !truthy(flatten([args[0]])[0]);
                }
                case 'CONCAT': {
                    return flatten(args).map(function (v) { return formatValue(v); }).join('');
                }
                case 'ABS': {
                    const n = toNum(flatten(args)[0]);
                    if (isNaN(n)) throw new Error('#VALUE!');
                    return Math.abs(n);
                }
                case 'ROUND': {
                    const v = flatten(args);
                    const x = toNum(v[0]);
                    const d = v.length > 1 ? Math.trunc(toNum(v[1])) : 0;
                    if (isNaN(x) || isNaN(d)) throw new Error('#VALUE!');
                    const f = Math.pow(10, d);
                    return Math.round(x * f) / f;
                }
                case 'SQRT': {
                    const n = toNum(flatten(args)[0]);
                    if (isNaN(n)) throw new Error('#VALUE!');
                    if (n < 0) throw new Error('#NUM!');
                    return Math.sqrt(n);
                }
                case 'POWER': {
                    const v = flatten(args);
                    const a = toNum(v[0]), b = toNum(v[1]);
                    if (isNaN(a) || isNaN(b)) throw new Error('#VALUE!');
                    return Math.pow(a, b);
                }
                case 'TEXT': {
                    const v = args.length ? args[0] : '';
                    return formatValue(v);
                }
                default:
                    throw new Error('#NAME?');
            }
        }`);

// 8) codici errore canonici (#SYNTAX/#VALUE!/#NUM!... → #ERR!)
E('compute-canonical',
    `    function computeAll() {
        const env = makeEnv();
        const disp = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const c = st.data.cells[ref];
            if (c.f != null) {
                try {
                    disp[ref] = formatValue(evalFormula(c.f, env));
                } catch (e) {
                    const m = e && e.message ? String(e.message) : '';
                    disp[ref] = m.charAt(0) === '#' ? m : '#ERR';
                }
            } else {
                disp[ref] = c.v == null ? '' : String(c.v);
            }
        });
        return disp;
    }`,
    `    // codici errore canonici: #CIRC! #DIV/0! #REF! #NAME? #ERR!
    function canonicalErr(m) {
        if (m === '#CIRC!' || m === '#DIV/0!' || m === '#REF!' || m === '#NAME?') return m;
        return '#ERR!';   // sintassi/valore/ogni altro errore → #ERR!
    }
    function computeAll() {
        const env = makeEnv();
        const disp = {};
        Object.keys(st.data.cells).forEach(function (ref) {
            const c = st.data.cells[ref];
            if (c.f != null) {
                try {
                    disp[ref] = formatValue(evalFormula(c.f, env));
                } catch (e) {
                    const m = e && e.message ? String(e.message) : '';
                    disp[ref] = canonicalErr(m);
                }
            } else {
                disp[ref] = c.v == null ? '' : String(c.v);
            }
        });
        return disp;
    }`);

// 9) placeholder con esempio funzionante (splice: la riga contiene un trattino UTF-8)
S('placeholder',
    `        formula.placeholder = '`,
    `        formula.title =`,
    `        formula.placeholder = 'Valore o formula (es. =2+2, =SUM(A1:A3)) \u2013 Invio per confermare';
        `);

// 10) "?" in toolbar → popover Formule
E('toolbar-help',
    `        bar.appendChild(formula);
        st.formula = formula;`,
    `        bar.appendChild(formula);
        st.formula = formula;

        // BLOCCO 5.5: "?" in toolbar → documentazione Formule
        const fHelp = ib('?', 'Aiuto formule: regola, funzioni ed esempi');
        fHelp.classList.add('fg-fhelp');
        fHelp.addEventListener('click', function (e) { e.stopPropagation(); openFormuleHelp(fHelp); });
        bar.appendChild(fHelp);`);

// 11) openFormuleHelp (prima di openHelpPop)
E('formule-help-fn',
    `    function openHelpPop(btn) {`,
    `    // BLOCCO 5.5: documentazione Formule (popover dalla toolbar)
    function openFormuleHelp(btn) {
        const r = btn.getBoundingClientRect();
        showMenu(Math.max(4, r.left - 80), Math.max(4, r.bottom + 6), function (m) {
            m.classList.add('pop');
            m.classList.add('fg-formulepop');
            m.appendChild(App.el('div', 'fg-pop-title', 'Formule'));
            const rule = App.el('div', 'fg-pop-item');
            rule.innerHTML = 'Ogni formula inizia con <b>=</b> (es. <b>=2+2</b> \u2192 4): senza il prefisso il contenuto \u00e8 un valore. ' +
                'Argomenti separati da <b>;</b> oppure <b>,</b>.';
            m.appendChild(rule);
            const table = App.el('table', 'fg-fn-table');
            let th = '<thead><tr><th>Funzione</th><th>Sintassi</th><th>Esempio</th></tr></thead><tbody>';
            [
                ['SUM', 'SUM(intervalli\u2026)', '=SUM(A1:A5)'],
                ['AVERAGE', 'AVERAGE(intervalli\u2026)', '=AVERAGE(A1:A3)'],
                ['MIN', 'MIN(intervalli\u2026)', '=MIN(A1:A5)'],
                ['MAX', 'MAX(intervalli\u2026)', '=MAX(A1:A5)'],
                ['COUNT', 'COUNT(intervalli\u2026)', '=COUNT(A1:A5)'],
                ['COUNTA', 'COUNTA(intervalli\u2026)', '=COUNTA(A1:A5)'],
                ['IF', 'IF(cond;allora;altrimenti)', '=IF(A1>=6,"s\u00ec","no")'],
                ['AND', 'AND(b1;b2;\u2026)', '=AND(A1>0;B1>0)'],
                ['OR', 'OR(b1;b2;\u2026)', '=OR(A1>0;B1>0)'],
                ['NOT', 'NOT(b)', '=NOT(A1>0)'],
                ['CONCAT', 'CONCAT(testi\u2026)', '=CONCAT("Ana";"li")'],
                ['ABS', 'ABS(x)', '=ABS(-5)'],
                ['ROUND', 'ROUND(x;n)', '=ROUND(3,141599;2)'],
                ['SQRT', 'SQRT(x)', '=SQRT(9)'],
                ['POWER', 'POWER(a;b)', '=POWER(2;10)']
            ].forEach(function (row) {
                th += '<tr><td><code>' + row[0] + '</code></td><td><code>' + App.esc(row[1]) +
                    '</code></td><td><code>' + App.esc(row[2]) + '</code></td></tr>';
            });
            th += '</tbody>';
            table.innerHTML = th;
            m.appendChild(table);
            const ex = App.el('div', 'fg-pop-item');
            ex.innerHTML = '<b>Esempi pratici:</b> <code>=2+2</code> \u2192 4 \u00b7 <code>=SUM(A1:A5)</code> \u00b7 ' +
                '<code>=IF(A1&gt;=6,"s\u00ec","no")</code>';
            m.appendChild(ex);
            const ops = App.el('div', 'fg-pop-item');
            ops.innerHTML = '<b>Operatori:</b> + \u2212 * / ^ e confronti = &lt;&gt; &lt; &gt; &lt;= &gt;=; booleani TRUE/FALSE.';
            m.appendChild(ops);
            const errs = App.el('div', 'fg-pop-item');
            errs.innerHTML = '<b>Errori:</b> #CIRC! ciclo \u00b7 #DIV/0! divisione per zero \u00b7 #REF! riferimento inesistente \u00b7 ' +
                '#NAME? funzione ignota \u00b7 #ERR! sintassi errata.';
            m.appendChild(errs);
            m.style.width = '440px';
        });
    }
    function openHelpPop(btn) {`);

// 12) CSS
E('css',
    `        '.fg-formula:focus{border-color:var(--accent)}' +`,
    `        '.fg-formula:focus{border-color:var(--accent)}' +
        '.fg-fhelp{font-weight:800}' +
        '.fg-formulepop code{background:rgba(249,151,74,.14);color:var(--accent);border-radius:4px;padding:1px 4px;font-size:12px}' +
        '.fg-fn-table{border-collapse:collapse;width:100%;margin:6px 0;font-size:12px;table-layout:fixed}' +
        '.fg-fn-table th,.fg-fn-table td{border:1px solid var(--border);padding:4px 6px;text-align:left;color:var(--text);word-break:break-word}' +
        '.fg-fn-table th{background:rgba(255,255,255,.05);font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)}' +`);

// ---------------------------------------------------------------
let src = fs.readFileSync(FILE, 'utf8');
let okCount = 0;
for (const op of splice) {
    const s = src.indexOf(op.start);
    if (s < 0 || src.indexOf(op.start, s + 1) >= 0) { console.error('SPLICE non ok: ' + op.name); process.exit(1); }
    const e = src.indexOf(op.end, s + op.start.length);
    if (e < 0 || src.indexOf(op.end, e + 1) >= 0) { console.error('SPLICE end non ok: ' + op.name); process.exit(1); }
    src = src.slice(0, s) + op.after + src.slice(e);
    okCount++;
}
for (const op of exact) {
    const i = src.indexOf(op.before);
    if (i < 0) { console.error('EXACT non trovato: ' + op.name); process.exit(1); }
    if (src.indexOf(op.before, i + op.before.length) >= 0) { console.error('EXACT ambiguo: ' + op.name); process.exit(1); }
    src = src.slice(0, i) + op.after + src.slice(i + op.before.length);
    okCount++;
}
const total = exact.length + splice.length;
if (DRY) { console.log('DRY: ' + okCount + '/' + total + ' patch trovate e uniche.'); process.exit(0); }
fs.writeFileSync(FILE, src, 'utf8');
console.log('OK: ' + okCount + '/' + total + ' patch applicati a fogli.js');
