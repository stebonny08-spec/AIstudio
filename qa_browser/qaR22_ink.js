'use strict';
/* qa_browser/qaR22_ink.js - T2 REALE (Chromium) - R22 FE-INK:
   ricostruzione rette/archi DA ZERO + BLOCCO 1.1 dock pannello Fonti.
   - apre qa_ui/notes.html (notes.js reale, harness seed + editor, penna)
   - PRIMA: interception serving qa/r22_notes_baseline.js (pre-R22)
   - DOPO:  notes.js corrente
   Per OGNI caso: stroke sintetico con jitter via PointerEvent reali ->
   misura geometrica su window.__ink.objects() + screenshot canvas
   qa/r22_ink_{prima|dopo}_<caso>.png.
   Casi: retta (deviazione angolare pts renderizzati <=1gradi),
         arco (residuo pts renderizzati vs curva parametrica ideale
         <=0.5px = tick curva ideale), arco+flick (ali 30-45gradi,
         ratio 3-4x spessore, tangente <=10gradi R20, base <=2px),
         C aperta irregolare (intatta: MAI forma chiusa, resta stroke).
   BLOCCO 1.1: click [data-fonti] -> pannello aperto, elementFromPoint
   sul centro del bottone Annulla ritorna il bottone (o discendente),
   overlap rect pannello INTERSECT pill = 0 (o dichiarato non-bloccante:
   z-index pannello < z-index pill) + screenshot qa/r22_ink_*_fonti.png.
   Output: qa/r22_ink_measures.json
   Uso: node qa_browser/qaR22_ink.js
   EXIT: 0 se tutti i casi DOPO ok (+ nessun pageerror); 1 altrimenti
   (PRIMA = informativo, misurato e salvato). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const BASE = fs.readFileSync(path.join(QA_DIR, 'r22_notes_baseline.js'), 'utf8');
const MEAS = path.join(QA_DIR, 'r22_ink_measures.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CASES = ['retta', 'arco', 'arco_flick', 'c_aperta'];

/* LCG determinista (stesso principio di a14/u20) */
function lcg(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---- misure geometriche in Node (pts/params tornati da __ink) ---- */
function bezPoly(bez, sub) {
    const out = [];
    for (let i = 0; i < bez.length; i++) {
        const sg = bez[i];
        for (let j = (i === 0 ? 0 : 1); j <= sub; j++) {
            const t = j / sub, u = 1 - t;
            out.push([u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] +
                      3 * u * t * t * sg[2][0] + t * t * t * sg[3][0],
                      u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] +
                      3 * u * t * t * sg[2][1] + t * t * t * sg[3][1]]);
        }
    }
    return out;
}
/* curva parametrica IDEALE ricostruita da shape.params */
function idealOf(s) {
    if (!s || s.kind === 'arrow') {
        if (s && s.kind === 'arrow' && s.params && s.params.shaft) {
            return idealOf(s.params.shaft);
        }
        return null;
    }
    if (s.kind === 'circle' && s.params && s.params.cx !== undefined) {
        const out = [];
        for (let i = 0; i <= 128; i++) {
            const a = (i / 128) * Math.PI * 2;
            out.push([s.params.cx + s.params.r * Math.cos(a),
                      s.params.cy + s.params.r * Math.sin(a)]);
        }
        return out;
    }
    if (s.params && s.params.arc) {
        const a = s.params.arc;
        const N = Math.max(8, Math.min(400, Math.round(Math.abs(a.a1 - a.a0) * a.r / 2)));
        const out = [];
        for (let i = 0; i <= N; i++) {
            const t = a.a0 + (a.a1 - a.a0) * (i / N);
            out.push([a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t)]);
        }
        return out;
    }
    if (s.params && s.params.bez && s.params.bez.length) return bezPoly(s.params.bez, 16);
    return null;
}
function maxDistToPoly(pts, poly) {
    let m = 0;
    for (const q of pts) {
        let bd = Infinity;
        for (let i = 0; i < poly.length - 1; i++) {
            const a = poly[i], b = poly[i + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const l2 = dx * dx + dy * dy;
            let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
            t = t < 0 ? 0 : (t > 1 ? 1 : t);
            const d = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
            if (d < bd) bd = d;
        }
        if (bd > m) m = bd;
    }
    return m;
}
function angDiffDeg(v1, v2) {
    let d = (Math.atan2(v1[1], v1[0]) - Math.atan2(v2[1], v2[0])) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    d = Math.abs(d);
    if (d > 90) d = 180 - d;
    return d;
}
function angBetween(v1, v2) {
    let d = (Math.atan2(v1[1], v1[0]) - Math.atan2(v2[1], v2[0])) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.abs(d);
}
/* distanza media NN pts renderizzati -> punti grezzi (discrimina
   PRIMA: pts= nodi sul tracciato vs DOPO: pts = campione ideale) */
function meanNN(pts, raw) {
    let s = 0;
    for (const q of pts) {
        let bd = Infinity;
        for (const r of raw) {
            const d = Math.hypot(q[0] - r[0], q[1] - r[1]);
            if (d < bd) bd = d;
        }
        s += bd;
    }
    return pts.length ? s / pts.length : 0;
}

/* ---- driver stroke in pagina (client coords), pattern qaA19 ---- */
async function strokeWorld(page, worldPts, dt, opts) {
    opts = opts || {};
    return await page.evaluate(async ({ worldPts, dt, split, dt2 }) => {
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
            const dly = (split != null && i >= split) ? (dt2 || dt) : dt;
            await new Promise(res => setTimeout(res, dly));
            const c = toC(worldPts[i][0], worldPts[i][1]);
            ev('pointermove', c[0], c[1]);
        }
        const cl = toC(worldPts[worldPts.length - 1][0], worldPts[worldPts.length - 1][1]);
        ev('pointerup', cl[0], cl[1]);
        return { n: worldPts.length, scale: sx };
    }, { worldPts, dt, split: opts.split, dt2: opts.dt2 });
}

async function lastObj(page) {
    return await page.evaluate(() => {
        const o = window.__ink.objects();
        const l = o[o.length - 1] || null;
        return {
            count: o.length,
            obj: l ? JSON.parse(JSON.stringify(l)) : null
        };
    });
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

/* ---- generatori tratti in MONDO (coordinate della nota) ---- */
function genRetta(cx, cy, rnd) {
    const pts = [];
    for (let i = 0; i <= 50; i++) {
        pts.push([cx + i * 3 + (rnd() - 0.5) * 4,        // jitter +-2px
                  cy + i * 0.6 + (rnd() - 0.5) * 4]);
    }
    return { pts: pts, dir: [3, 0.6] };
}
function genArco(cx, cy, r, rnd) {
    const pts = [];
    let ang = -20 * Math.PI / 180;
    const spanEnd = 200 * Math.PI / 180;
    let k = 0;
    while (ang < spanEnd) {
        pts.push([cx + r * Math.cos(ang) + (rnd() - 0.5) * 3.2,
                  cy + r * Math.sin(ang) + (rnd() - 0.5) * 3.2]);
        ang += (5.2 + 2.6 * Math.sin(k * 0.9)) * Math.PI / 180;   // passi irregolari
        k++;
    }
    return pts;
}
/* cerchio GENERATORE vero (senza jitter): polilinea densa per le misure
   informative PRIMA/DOPO (fit vs verita') */
function trueCirclePoly(cx, cy, r) {
    const out = [];
    for (let i = 0; i <= 200; i++) {
        const a = (-20 + 220 * i / 200) * Math.PI / 180;
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
}
function genArcoFlick(cx, cy, rnd) {
    const arc = [];
    for (let x = 0; x <= 130; x += 3) {
        const t = x / 130;
        arc.push([cx + x + (rnd() - 0.5) * 3.2,
                  cy + 55 * Math.sin(Math.PI * t) + (rnd() - 0.5) * 3.2]);
    }
    const E = arc[arc.length - 1];
    const flick = [
        [E[0], E[1]], [E[0] + 12, E[1] + 4],
        [E[0] + 20, E[1] - 2], [E[0] + 14, E[1] + 7],
        [E[0] + 2, E[1] + 4], [E[0] - 8, E[1] + 9]
    ];
    return { arc: arc, flick: flick };
}
function genCAperta(cx, cy, rnd) {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
        const a = (30 + (i / 60) * 300) * Math.PI / 180;
        const rr = 60 + 5 * Math.sin(i * 0.7) + (rnd() - 0.5) * 10;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return pts;
}

/* ---- BLOCCO 1.1: dock pannello Fonti non copre la pill undo/redo ---- */
async function checkFontiDock(page) {
    await page.evaluate(() => {
        const b = document.querySelector('[data-fonti]');
        if (b) b.click();
    });
    await sleep(550);   // mount + fetchSources async + dock dinamico
    const r = await page.evaluate(() => {
        const panel = document.querySelector('.fp21-root');
        const pill = document.querySelector('.fn-pill-left');
        const undo = document.querySelector('.fn-pill-left button[title^="Annulla"]') ||
            document.querySelector('#btnUndo') || document.querySelector('[data-undo]') ||
            (pill ? pill.querySelector('button') : null);
        if (!panel || !pill || !undo) {
            return { err: 'assenti: panel=' + !!panel + ' pill=' + !!pill + ' undo=' + !!undo };
        }
        const shown = panel.classList.contains('show') ||
            getComputedStyle(panel).display !== 'none';
        const ur = undo.getBoundingClientRect();
        const cx = ur.left + ur.width / 2, cy = ur.top + ur.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const hitOk = !!hit && (hit === undo || undo.contains(hit));
        const pr = panel.getBoundingClientRect();
        const pl = pill.getBoundingClientRect();
        const ox = Math.max(0, Math.min(pr.right, pl.right) - Math.max(pr.left, pl.left));
        const oy = Math.max(0, Math.min(pr.bottom, pl.bottom) - Math.max(pr.top, pl.top));
        const zP = parseInt(getComputedStyle(panel).zIndex, 10);
        const zL = parseInt(getComputedStyle(pill).zIndex, 10);
        return {
            shown: shown,
            hitOk: hitOk,
            hit: hit ? (hit.tagName + ' cls=' + String(hit.className).slice(0, 40)) : null,
            overlap_px2: Math.round(ox * oy),
            gap_panel_top_vs_pill_bottom: Math.round(pr.top - pl.bottom),
            z_pannello: zP, z_pill: zL,
            z_maggiore_pannello: !(zP < zL),
            non_bloccante: hitOk && (zP < zL)
        };
    });
    await page.screenshot({ path: path.join(QA_DIR, 'r22_ink_' +
        (page.__mode || 'x') + '_fonti.png') });
    if (r.err) { r.ok = false; return r; }
    r.ok = r.shown && r.hitOk &&
        (r.overlap_px2 === 0 || (r.non_bloccante && r.z_maggiore_pannello === false));
    return r;
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const out = { method: 'qaR22_ink: T2 reale R22 - rette/archi ricostruiti + dock B1.1' };

    for (const mode of ['prima', 'dopo']) {
        console.log('\n==== MODE ' + mode.toUpperCase() + ' ====');
        const { page, errs } = await newPage(browser, mode === 'prima');
        page.__mode = mode;
        const res = {};
        await page.evaluate(() => {
            window.__ink.setHelp(0.6);
            window.__ink.setShaping(true, true, 900);   // clamp 800
        });

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
        const band = i => bounds.y0 + H * (0.14 + i * 0.20);   // fasce separate
        const canvasEl = await page.$('.nt-stage canvas') || await page.$('canvas');
        const shot = name => canvasEl.screenshot({
            path: path.join(QA_DIR, 'r22_ink_' + mode + '_' + name + '.png')
        });

        // ---- CASO retta: deviazione angolare pts renderizzati <=1gradi ----
        {
            const g = genRetta(bounds.x0 + W * 0.10, band(0), lcg(2201));
            await strokeWorld(page, g.pts, 3);
            await sleep(1000);
            const lo = await lastObj(page);
            const o = lo.obj;
            const r = { expected: 'shape line, dev angolare <=1gradi' };
            if (o && o.t === 'shape' && o.kind === 'line' && o.pts && o.pts.length === 2) {
                const v = [o.pts[1][0] - o.pts[0][0], o.pts[1][1] - o.pts[0][1]];
                r.dev_deg = Math.round(angDiffDeg(v, g.dir) * 1000) / 1000;
                r.ok = r.dev_deg <= 1;
            } else {
                r.ok = false;
                r.got = o ? (o.t + '/' + (o.kind || '?')) : 'null';
            }
            r.n_raw = g.pts.length;
            res.retta = r;
            await shot('retta');
            console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  retta -> ' +
                (r.got || ('line dev=' + r.dev_deg + 'gradi')));
        }

        // ---- CASO arco: residuo renderizzato vs ideale + tick ----------
        {
            const acx = bounds.x0 + W * 0.45, acy = band(1), acr = 90;
            const g = genArco(acx, acy, acr, lcg(7717));
            await strokeWorld(page, g, 4);
            await sleep(1000);
            const lo = await lastObj(page);
            const o = lo.obj;
            const r = { expected: 'shape curve, residuo render vs curva parametrica ideale <=0.5px (tick)' };
            if (o && o.t === 'shape' && o.kind === 'curve' && o.pts && o.pts.length > 2) {
                const ideal = idealOf(o);
                if (ideal) {
                    r.residuo_render_px = Math.round(maxDistToPoly(o.pts, ideal) * 10000) / 10000;
                    r.tick_curva_ideale = r.residuo_render_px <= 0.5;
                    r.params = Object.keys(o.params || {});
                    // discriminante PRIMA/DOPO: pts ideali NON = grezzi
                    r.meanNN_pts_vs_grezzi = Math.round(meanNN(o.pts, g) * 1000) / 1000;
                    r.residuo_grezzo_vs_render = Math.round(maxDistToPoly(g, o.pts) * 1000) / 1000;
                    // INFORMATIVO (non-assert): residuo renderizzato vs
                    // cerchio GENERATORE vero (fit vs verita')
                    r.residuo_render_vs_genvero_px =
                        Math.round(maxDistToPoly(o.pts, trueCirclePoly(acx, acy, acr)) * 1000) / 1000;
                    r.residuo_grezzo_vs_genvero_px =
                        Math.round(maxDistToPoly(g, trueCirclePoly(acx, acy, acr)) * 1000) / 1000;
                    r.ok = r.tick_curva_ideale;
                } else {
                    r.ok = false; r.err = 'params non ricostruibili';
                }
            } else {
                r.ok = false;
                r.got = o ? (o.t + '/' + (o.kind || '?')) : 'null';
            }
            res.arco = r;
            await shot('arco');
            console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  arco -> ' +
                (r.got || ('residuo=' + r.residuo_render_px + 'px tick=' + r.tick_curva_ideale +
                    ' meanNN=' + r.meanNN_pts_vs_grezzi + 'px rawRes=' + r.residuo_grezzo_vs_render +
                    'px vsGenVero=' + r.residuo_render_vs_genvero_px + 'px')));
        }

        // ---- CASO arco+flick: ali 30-45, ratio 3-4x, tangente <=10 ------
        {
            const g = genArcoFlick(bounds.x0 + W * 0.15, band(2), lcg(555));
            const all = g.arc.concat(g.flick);
            const rr = await strokeWorld(page, all, 10,
                { split: g.arc.length, dt2: 40 });
            await sleep(1200);   // hold/ghost finalize
            const lo = await lastObj(page);
            const o = lo.obj;
            const r = { expected: 'shape arrow, ali 30-45gradi, ratio 3-4x, tangente <=10gradi' };
            if (o && o.t === 'shape' && o.kind === 'arrow' && o.params && o.params.head) {
                const h = o.params.head;
                const sz = o.size || 2;
                r.ali_deg = h.angoloAlaDeg;
                r.ratio = Math.round(h.lunghezza / sz * 1000) / 1000;
                const shaft = o.params.shaft;
                r.shaft_kind = shaft ? shaft.kind : null;
                let tangOk = false, baseD = null;
                if (shaft && shaft.kind === 'line' && shaft.pts) {
                    const v = [shaft.pts[1][0] - shaft.pts[0][0],
                               shaft.pts[1][1] - shaft.pts[0][1]];
                    r.tangente_deg = Math.round(angBetween(h.tangente, v) * 100) / 100;
                    tangOk = r.tangente_deg <= 5;
                    const term = shaft.pts[1];
                    baseD = Math.hypot(h.base[0] - term[0], h.base[1] - term[1]);
                } else if (shaft && shaft.kind === 'curve' && shaft.bez) {
                    const sg = shaft.bez[shaft.bez.length - 1];
                    const der = [3 * (sg[3][0] - sg[2][0]), 3 * (sg[3][1] - sg[2][1])];
                    r.tangente_deg = Math.round(angBetween(h.tangente, der) * 100) / 100;
                    tangOk = r.tangente_deg <= 10;
                    baseD = Math.hypot(h.base[0] - sg[3][0], h.base[1] - sg[3][1]);
                }
                r.base_d = baseD == null ? null : Math.round(baseD * 1000) / 1000;
                r.ali_ok = r.ali_deg >= 30 && r.ali_deg <= 45;
                r.ratio_ok = r.ratio >= 3 && r.ratio <= 4;
                r.base_ok = r.base_d != null && r.base_d <= 2;
                r.tangente_ok = !!tangOk;
                r.ok = r.ali_ok && r.ratio_ok && r.base_ok && r.tangente_ok;
            } else {
                r.ok = false;
                r.got = o ? (o.t + '/' + (o.kind || '?')) : 'null';
            }
            r.stroke_call = rr;
            res.arco_flick = r;
            await shot('arco_flick');
            console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  arco_flick -> ' +
                (r.got || ('ali=' + r.ali_deg + ' ratio=' + r.ratio +
                    ' tang=' + r.tangente_deg + ' base=' + r.base_d)));
        }

        // ---- CASO C aperta irregolare: intatta (mai forma chiusa) ------
        {
            const g = genCAperta(bounds.x0 + W * 0.30, band(3), lcg(31337));
            await strokeWorld(page, g, 4);
            await sleep(1000);
            const lo = await lastObj(page);
            const o = lo.obj;
            const CLOSED = ['circle', 'ellipse', 'rectangle', 'square', 'triangle', 'line'];
            const r = { expected: 'C NON chiusa (intatta) e non riconosciuta: stroke' };
            r.c_intatta = !!o && !(o.t === 'shape' && CLOSED.indexOf(o.kind) >= 0);
            r.rimane_stroke = !!o && o.t === 'stroke';
            r.got = o ? (o.t + '/' + (o.kind || '?')) : 'null';
            r.ok = r.c_intatta && r.rimane_stroke;
            res.c_aperta = r;
            await shot('c_aperta');
            console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  c_aperta -> ' +
                r.got + ' intatta=' + r.c_intatta);
        }

        // ---- BLOCCO 1.1: dock pannello Fonti ----------------------------
        try {
            const dock = await checkFontiDock(page);
            res.fonti_dock = dock;
            console.log('  ' + (dock.ok ? 'PASS' : 'FAIL') + '  fonti_dock -> ' +
                JSON.stringify(dock));
        } catch (e) {
            res.fonti_dock = { ok: false, err: String(e && e.message || e) };
            console.log('  FAIL  fonti_dock -> ' + res.fonti_dock.err);
        }

        if (errs.length) { res.pageerrors = errs.slice(0, 5); console.log('  pageerrors: ' + errs.slice(0, 3).join(' | ')); }
        out[mode] = res;
        await page.close();
    }

    fs.writeFileSync(MEAS, JSON.stringify(out, null, 2));
    console.log('\nMisure salvate: qa/r22_ink_measures.json');

    // verdetto: DOPO deve essere tutto ok; PRIMA informativo
    const dopo = out.dopo || {};
    let fail = 0, n = 0;
    for (const k of CASES.concat(['fonti_dock'])) {
        n++;
        if (!dopo[k] || !dopo[k].ok) { fail++; console.log('VERDETTO FAIL: ' + k); }
    }
    if (dopo.pageerrors && dopo.pageerrors.length) {
        fail++; console.log('VERDETTO FAIL: pageerrors in DOPO');
    }
    const prima = out.prima || {};
    let primaOk = 0, primaN = 0;
    for (const k of CASES.concat(['fonti_dock'])) {
        if (prima[k] !== undefined) { primaN++; if (prima[k].ok) primaOk++; }
    }
    console.log('\nPRIMA (baseline R21): ' + primaOk + '/' + primaN + ' ok');
    console.log('DOPO  (R22):          ' + (n - fail) + '/' + n + ' ok');
    console.log('Screenshot: qa/r22_ink_{prima,dopo}_<caso>.png + _fonti.png');
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ECCEZIONE: ' + (e && e.stack || e)); process.exit(2); });
