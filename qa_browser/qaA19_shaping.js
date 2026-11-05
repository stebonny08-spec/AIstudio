'use strict';
/* qa_browser/qaA19_shaping.js - T2 REALE (Chromium) - BLOCCO A2 di R19:
   shape recognition corretta + smussamento totalizzante.
   - apre qa_ui/notes.html (notes.js reale, harness seed + editor, penna)
   - PRIMA: interception serving qa/r19_notes_baseline.js (pre-modifica)
   - DOPO:  notes.js corrente
   Per OGNI caso: stroke sintetico con jitter via PointerEvent reali ->
   assert geometrico su window.__ink.objects() + screenshot canvas
   qa/r19_a_shp_{prima|dopo}_<caso>.png.
   Casi: c_aperta (NO snap), cerchio_chiuso (circle), coloring (NO snap),
   rettangolo_impreciso (rectangle), quadrato (square), arco_flick
   (shape + freccia ricostruita), curva_tremolante (residuo <= 2.5px),
   undo 2 livelli su forma snap.
   Output: qa/r19_s_measures.json -> chiave "shaping" (merge, non sovrascrive).
   Uso: node qa_browser/qaA19_shaping.js
   EXIT: 0 se tutti i casi DOPO ok; 1 altrimenti (prima = informativo). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const BASE = fs.readFileSync(path.join(QA_DIR, 'r19_notes_baseline.js'), 'utf8');
const MEAS = path.join(QA_DIR, 'r19_s_measures.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CASES = ['c_aperta', 'cerchio_chiuso', 'coloring', 'rettangolo_impreciso',
    'quadrato', 'arco_flick', 'curva_tremolante'];

/* LCG determinista (stesso principio di a14) */
function lcg(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---- generatori tratti in coordinate MONDO (x, y) ---- */
function genOpenArc(cx, cy, r, a0, a1, n, jit, rnd) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = a0 + (a1 - a0) * (i / n);
        pts.push([cx + r * Math.cos(t) + (rnd() - 0.5) * jit,
                  cy + r * Math.sin(t) + (rnd() - 0.5) * jit]);
    }
    return pts;
}
function genClosedLoop(cx, cy, r, n, jit, rnd, sweep) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = (i / n) * (sweep || Math.PI * 2);
        pts.push([cx + r * Math.cos(t) + (rnd() - 0.5) * jit,
                  cy + r * Math.sin(t) + (rnd() - 0.5) * jit]);
    }
    return pts;
}
function genLissajous(cx, cy, w, h, n, jit, rnd) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([cx + w * Math.sin(2 * Math.PI * 4 * t) + (rnd() - 0.5) * jit,
                  cy + h * Math.sin(2 * Math.PI * 3 * t + 1) + (rnd() - 0.5) * jit]);
    }
    return pts;
}
/* perimetro a passi 4px (clone esatto del generator a14 4.0/5.0: jitter
   +-1 su bordi dritti -> riconoscimento rettangolo/quadrato deterministico) */
function genRect(x, y, w, h, jit, rnd) {
    const pts = [];
    for (let i = 0; i < w; i += 4) pts.push([x + i + (rnd() - 0.5) * jit, y + (rnd() - 0.5) * jit]);
    for (let i = 0; i < h; i += 4) pts.push([x + w + (rnd() - 0.5) * jit, y + i + (rnd() - 0.5) * jit]);
    for (let i = w; i >= 0; i -= 4) pts.push([x + i + (rnd() - 0.5) * jit, y + h + (rnd() - 0.5) * jit]);
    for (let i = h; i >= 4; i -= 4) pts.push([x + (rnd() - 0.5) * jit, y + i + (rnd() - 0.5) * jit]);
    return pts;
}
/* arco + flick a V (design verificato: angolo ~120°, bbox <=80) */
function genArcFlick(cx, cy, r, a0, a1, n, jit, rnd) {
    const arc = genClosedLoop(cx, cy, r, n, jit, rnd, 0); // placeholder
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = a0 + (a1 - a0) * (i / n);
        pts.push([cx + r * Math.cos(t) + (rnd() - 0.5) * jit,
                  cy + r * Math.sin(t) + (rnd() - 0.5) * jit]);
    }
    const E = pts[pts.length - 1];
    const d = [-Math.sin(a1), Math.cos(a1)];              // tangente CCW
    const nrm = [-d[1], d[0]];
    const c = Math.cos(120 * Math.PI / 180), s = Math.sin(120 * Math.PI / 180);
    const d2 = [d[0] * c + nrm[0] * s, d[1] * c + nrm[1] * s]; // ruota +120
    const flick = [
        [E[0] + d[0] * 10, E[1] + d[1] * 10],
        [E[0] + d[0] * 20, E[1] + d[1] * 20],
        [E[0] + d[0] * 25, E[1] + d[1] * 25],
        [E[0] + d[0] * 30, E[1] + d[1] * 30],             // angolo (~120°)
        [E[0] + d[0] * 30 + d2[0] * 15, E[1] + d[1] * 30 + d2[1] * 15],
        [E[0] + d[0] * 30 + d2[0] * 30, E[1] + d[1] * 30 + d2[1] * 30]
    ];
    return { arc: pts, flick: flick };
}
function genWavy(x0, x1, yc, amp, wl, step, jit, rnd) {
    const pts = [], ideal = [];
    const f = x => yc + amp * Math.sin((x - x0) / wl);
    for (let x = x0; x <= x1; x += step) {
        ideal.push([x, f(x)]);
        pts.push([x + (rnd() - 0.5) * 2, f(x) + (rnd() - 0.5) * 5]);
    }
    return { pts: pts, ideal: ideal };
}

/* ---- driver stroke in pagina (client coords) ---- */
async function strokeWorld(page, worldPts, dt, opts) {
    opts = opts || {};
    return await page.evaluate(async ({ worldPts, dt, hold, split, dt2 }) => {
        const ink = window.__ink;
        const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
        canvas.setPointerCapture = function () { };
        canvas.releasePointerCapture = function () { };
        const r = canvas.getBoundingClientRect();
        const p0 = ink.toWorld(r.left, r.top);
        const px = ink.toWorld(r.left + 100, r.top);
        const py = ink.toWorld(r.left, r.top + 100);
        const sx = (px.x - p0.x) / 100, sy = (py.y - p0.y) / 100;
        if (!isFinite(sx) || !isFinite(sy) || Math.abs(sx) < 1e-6 || Math.abs(sy) < 1e-6) {
            return { err: 'trasformata non valida sx=' + sx + ' sy=' + sy };
        }
        const toC = (wx, wy) => [r.left + (wx - p0.x) / sx, r.top + (wy - p0.y) / sy];
        const ev = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
            pointerId: 11, pointerType: 'pen', pressure: 0.5, bubbles: true,
            clientX: x, clientY: y
        }));
        const c0 = toC(worldPts[0][0], worldPts[0][1]);
        ev('pointerdown', c0[0], c0[1]);
        for (let i = 1; i < worldPts.length; i++) {
            // timing differenziato: split/dt2 (arco lento + flick veloce)
            const dly = (split != null && i >= split) ? (dt2 || dt) : dt;
            await new Promise(res => setTimeout(res, dly));
            const c = toC(worldPts[i][0], worldPts[i][1]);
            ev('pointermove', c[0], c[1]);
        }
        const cl = toC(worldPts[worldPts.length - 1][0], worldPts[worldPts.length - 1][1]);
        ev('pointerup', cl[0], cl[1]);
        return { n: worldPts.length, scale: sx };
    }, { worldPts, dt, hold: opts.hold || 0, split: opts.split, dt2: opts.dt2 });
}

async function lastObj(page) {
    return await page.evaluate(() => {
        const o = window.__ink.objects();
        const l = o[o.length - 1] || null;
        return { count: o.length, t: l && l.t, kind: l && l.kind, arrow: !!(l && l.arrow),
                 ptsN: l && l.pts ? l.pts.length : 0 };
    });
}
async function residualVsIdeal(page, ideal) {
    return await page.evaluate((ideal) => {
        const o = window.__ink.objects();
        const st = o[o.length - 1];
        if (!st || st.t !== 'stroke' || !st.pts) return { err: 'non stroke' };
        let maxd = 0;
        for (const p of st.pts) {
            const d = Math.abs(p[1] - (function (x) {
                // ideale: polilinea densa - interpolatione lineare su x
                for (let i = 1; i < ideal.length; i++) {
                    if (x <= ideal[i][0]) {
                        const a = ideal[i - 1], b = ideal[i];
                        const t = (b[0] - a[0]) !== 0 ? (x - a[0]) / (b[0] - a[0]) : 0;
                        return a[1] + (b[1] - a[1]) * t;
                    }
                }
                return ideal[ideal.length - 1][1];
            })(p[0]));
            if (d > maxd) maxd = d;
        }
        return { maxd: Math.round(maxd * 100) / 100 };
    }, ideal);
}

async function newPage(browser, useBaseline) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    if (useBaseline) {
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (req.url().includes('modules/notes.js')) {
                req.respond({ status: 200, contentType: 'application/javascript', body: BASE });
            } else req.continue();
        });
    }
    await page.goto(pathToFileURL(path.join(ROOT, 'qa_ui', 'notes.html')).href,
        { waitUntil: 'load', timeout: 20000 });
    let okR = false;
    for (let i = 0; i < 40; i++) {
        okR = await page.evaluate(() => !!(window.__qaHarnessNotes && window.__qaHarnessNotes.ready &&
            window.__ink && window.__ink.state() && window.__ink.state().tool));
        if (okR) break;
        await sleep(250);
    }
    if (!okR) throw new Error('harness notes non pronto');
    return { page, errs };
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const out = { shaping: {} };

    for (const mode of ['prima', 'dopo']) {
        console.log('\n==== MODE ' + mode.toUpperCase() + ' ====');
        const { page, errs } = await newPage(browser, mode === 'prima');
        const res = {};
        // bounds mondo del canvas visibile
        const bounds = await page.evaluate(() => {
            const ink = window.__ink;
            const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
            const r = canvas.getBoundingClientRect();
            const a = ink.toWorld(r.left, r.top);
            const b = ink.toWorld(r.right, r.bottom);
            return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
        });
        const W = bounds.x1 - bounds.x0, H = bounds.y1 - bounds.y0;
        const band = i => bounds.y0 + H * (0.10 + i * 0.125);   // 7 fasce
        const cx = k => bounds.x0 + W * (k || 0.30);

        const canvasEl = await page.$('.nt-stage canvas') || await page.$('canvas');
        const shot = name => canvasEl.screenshot({
            path: path.join(QA_DIR, 'r19_a_shp_' + mode + '_' + name + '.png')
        });

        const EXPECT = {
            c_aperta: o => o.t === 'stroke',
            cerchio_chiuso: o => o.t === 'shape' && o.kind === 'circle',
            coloring: o => o.t === 'stroke',
            rettangolo_impreciso: o => o.t === 'shape' && o.kind === 'rectangle',
            quadrato: o => o.t === 'shape' && o.kind === 'square',
            arco_flick: o => o.t === 'shape' && o.arrow === true,
            curva_tremolante: o => o.t === 'stroke'
        };
        const EXPECT_TXT = {
            c_aperta: 'stroke (NO snap)',
            cerchio_chiuso: 'shape/circle',
            coloring: 'stroke (NO snap)',
            rettangolo_impreciso: 'shape/rectangle',
            quadrato: 'shape/square',
            arco_flick: 'shape + arrow=true',
            curva_tremolante: 'stroke + residuo<=2.5px'
        };

        for (let ci = 0; ci < CASES.length; ci++) {
            const name = CASES[ci];
            const rnd = lcg(1000 + ci * 7);
            let worldPts = [], dt = 6, parts = null;
            if (name === 'c_aperta') {
                worldPts = genOpenArc(cx(0.3), band(ci), 50, 170 * Math.PI / 180,
                    450 * Math.PI / 180, 110, 4, rnd);
                dt = 6;
            } else if (name === 'cerchio_chiuso') {
                worldPts = genClosedLoop(cx(0.3), band(ci), 50, 130, 3, rnd);
                dt = 6;
            } else if (name === 'coloring') {
                worldPts = genLissajous(cx(0.3), band(ci), 55, 45, 220, 4, rnd);
                dt = 4;
            } else if (name === 'rettangolo_impreciso') {
                // generator clone a14 (seed 5, jitter +-1): snap deterministico
                worldPts = genRect(cx(0.22), band(ci) - 45, 150, 90, 2, lcg(5));
                dt = 4;
            } else if (name === 'quadrato') {
                worldPts = genRect(cx(0.24), band(ci) - 48, 96, 96, 2, lcg(11));
                dt = 4;
            } else if (name === 'arco_flick') {
                // UNICO stroke: arco lento (10ms) + flick veloce (40ms,
                // finestra 250ms di detectFlick copre i 6 punti del flick)
                parts = genArcFlick(cx(0.3), band(ci), 60, 170 * Math.PI / 180,
                    260 * Math.PI / 180, 36, 3, rnd);
                const all = parts.arc.concat(parts.flick);
                const rr = await strokeWorld(page, all, 10, { split: parts.arc.length, dt2: 40 });
                await sleep(1000); // hold-still 350 + finalize
                res[name] = { r: rr, expected: EXPECT_TXT[name] };
                const o = await lastObj(page);
                res[name].obtained = o;
                res[name].ok = EXPECT[name](o);
                // stroke grezzo residuo? (solo shape deve restare in coda)
                res[name].no_raw_residual = o.t === 'shape';
                await shot(name);
                console.log('  ' + (res[name].ok ? 'PASS' : 'FAIL') + '  ' + name +
                    ' -> ' + JSON.stringify(o));
                continue;
            } else if (name === 'curva_tremolante') {
                await page.evaluate(() => window.__ink.setHelp(0.6)); // A2.5: smoothing ON
                const w = genWavy(bounds.x0 + W * 0.10, bounds.x0 + W * 0.62,
                    band(ci), 32, 85, 5, 5, rnd);
                worldPts = w.pts;
                parts = { ideal: w.ideal };
                dt = 3;
            }
            const r = await strokeWorld(page, worldPts, dt);
            await sleep(1000);
            res[name] = { r: r, expected: EXPECT_TXT[name] };
            const o = await lastObj(page);
            res[name].obtained = o;
            res[name].ok = EXPECT[name](o);
            if (name === 'curva_tremolante' && res[name].ok) {
                const rr = await residualVsIdeal(page, parts.ideal);
                res[name].residual_px = rr.maxd;
                res[name].ok = res[name].ok && rr.maxd != null && rr.maxd <= 2.5;
            }
            await shot(name);
            console.log('  ' + (res[name].ok ? 'PASS' : 'FAIL') + '  ' + name +
                ' -> ' + JSON.stringify(o) +
                (res[name].residual_px != null ? ' residuo=' + res[name].residual_px + 'px' : ''));
        }

        // ---- undo a 2 livelli su forma snap (A2.6) ----
        {
            const rnd = lcg(777);
            const y = band(0) + H * 0.045; // banda libera sotto la prima
            await strokeWorld(page, genRect(cx(0.65), y - 30, 90, 60, 2, rnd), 5);
            await sleep(1000);
            const before = await lastObj(page);
            const okShape = before.t === 'shape';
            await page.evaluate(() => {
                const b = document.querySelector('.fn-pill-left [title^="Annulla"]') ||
                          Array.from(document.querySelectorAll('.fn-pill-left button'))
                              .filter(x => /^Annulla/.test(x.title))[0];
                b.click();
            });
            await sleep(150);
            const u1 = await lastObj(page);
            await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('.fn-pill-left button'))
                    .filter(x => /^Annulla/.test(x.title))[0];
                b.click();
            });
            await sleep(150);
            const u2 = await lastObj(page);
            res.undo2 = {
                expected: '1° undo -> stroke grezzo (count invariato), 2° undo -> rimosso',
                shape_before: okShape, u1: u1, u2: u2,
                ok: okShape && u1.t === 'stroke' && u1.count === before.count &&
                    u2.count === before.count - 1
            };
            console.log('  ' + (res.undo2.ok ? 'PASS' : 'FAIL') + '  undo_2livelli ' +
                JSON.stringify({ b: before, u1: u1, u2: u2 }));
        }

        out.shaping[mode] = res;
        if (errs.length) out.shaping[mode].pageerrors = errs.slice(0, 5);
        await page.close();
    }

    fs.writeFileSync(MEAS, JSON.stringify((() => {
        let cur = {};
        try { cur = JSON.parse(fs.readFileSync(MEAS, 'utf8')); } catch (e) { cur = {}; }
        cur.shaping = out.shaping;
        return cur;
    })(), null, 2));

    // verdetto: DOPO deve essere tutto ok; PRIMA informativo
    const dopo = out.shaping.dopo || {};
    let fail = 0, n = 0;
    for (const k of CASES.concat(['undo2'])) {
        n++;
        if (!dopo[k] || !dopo[k].ok) { fail++; console.log('VERDETTO FAIL: ' + k); }
    }
    const prima = out.shaping.prima || {};
    let primaOk = 0, primaN = 0;
    for (const k of CASES) { if (prima[k]) { primaN++; if (prima[k].ok) primaOk++; } }
    console.log('\nPRIMA (baseline): ' + primaOk + '/' + primaN + ' casi ok');
    console.log('DOPO  (R19):      ' + (n - fail) + '/' + n + ' ok');
    console.log('Screenshot: qa/r19_a_shp_{prima,dopo}_<caso>.png');
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ECCEZIONE: ' + (e && e.stack || e)); process.exit(2); });
