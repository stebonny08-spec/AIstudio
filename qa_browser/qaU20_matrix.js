'use strict';
/* qa_browser/qaU20_matrix.js - T2 REALE (Chromium) - MATRICE QA Round 20
   Tratto perfetto U1-U5 + frecce F + ghost U8 + gesti F5.
   - PRIMA: interception che serve qa/r20_notes_baseline.js (pre-R20)
   - DOPO:  notes.js corrente
   Output: qa/r20_qa_measures.json {prima, dopo} + screenshot
   qa/r20_shp_{prima|dopo}_<caso>.png
   EXIT: 0 se TUTTI gli assert DOPO ok (prima = informativo). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const BASE = fs.readFileSync(path.join(QA_DIR, 'r20_notes_baseline.js'), 'utf8');
const MEAS = path.join(QA_DIR, 'r20_qa_measures.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOL = 4.3;   // 2.5 + amp 0.6*3 (paritÃ  U1 asta/retta)

function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---- generatori mondo ---- */
/* perimetro a passi 4px ruotato (clone esatto dei generator u20 Q1/Q2:
   jitter Â±2, angoli preservati) */
function genSkewRect(x, y, w, h, rotDeg, jit, rnd) {
    const pts = [], rad = rotDeg * Math.PI / 180;
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    for (let s = 0; s < 4; s++) {
        const a0 = corners[s], b0 = corners[(s + 1) % 4];
        const len = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
        for (let d = 0; d < len; d += 4) {
            const f = d / len;
            const lx = a0[0] + (b0[0] - a0[0]) * f + (rnd() - 0.5) * jit;
            const ly = a0[1] + (b0[1] - a0[1]) * f + (rnd() - 0.5) * jit;
            pts.push([x + lx * Math.cos(rad) - ly * Math.sin(rad),
                      y + lx * Math.sin(rad) + ly * Math.cos(rad)]);
        }
    }
    return pts;
}
function genLoop(cx, cy, r, n, jit, rnd, sweep) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = (i / n) * (sweep || Math.PI * 2);
        pts.push([cx + r * Math.cos(t) + (rnd() - 0.5) * jit, cy + r * Math.sin(t) + (rnd() - 0.5) * jit]);
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
function genDownArc(x0, w, yc, amp, jit, rnd) {
    const pts = [];
    for (let x = x0; x <= x0 + w; x += 4) {
        const t = (x - x0) / w;
        pts.push([x + (rnd() - 0.5) * jit,
                  yc + amp * Math.sin(Math.PI * t) + (rnd() - 0.5) * jit]);
    }
    return pts;
}
function genLine(x0, y0, n, jit, rnd) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + i * 3 + (rnd() - 0.5) * jit, y0 + i * 0.55 + (rnd() - 0.5) * jit]);
    return pts;
}
function genArcDown(x0, w, yc, sag, jit, rnd) {
    const pts = [];
    for (let x = x0; x <= x0 + w; x += 3) {
        const t = (x - x0) / w;
        pts.push([x + (rnd() - 0.5) * jit, yc + sag * Math.sin(Math.PI * t) + (rnd() - 0.5) * jit]);
    }
    return pts;
}
function flickOf(end, spec) { return spec.map(d => [end[0] + d[0], end[1] + d[1]]); }
const FLICK = [[0, 0], [12, 4], [22, 0], [16, 8], [4, 5], [-6, 10]];

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

/* dispatch punti mondo: down+moves (+eventuale pausa+seconda fase), opzionale NO up */
async function strokePts(page, phases, opts) {
    opts = opts || {};
    return await page.evaluate(async ({ phases, dt, dt2, pauseMs, noUp }) => {
        const ink = window.__ink;
        const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
        canvas.setPointerCapture = function () { };
        canvas.releasePointerCapture = function () { };
        const r = canvas.getBoundingClientRect();
        const p0 = ink.toWorld(r.left, r.top);
        const px = ink.toWorld(r.left + 100, r.top);
        const py = ink.toWorld(r.left, r.top + 100);
        const sx = (px.x - p0.x) / 100, sy = (py.y - p0.y) / 100;
        const toC = (wx, wy) => [r.left + (wx - p0.x) / sx, r.top + (wy - p0.y) / sy];
        const ev = (type, x, y, id) => canvas.dispatchEvent(new PointerEvent(type, {
            pointerId: id || 21, pointerType: 'pen', pressure: 0.5, bubbles: true,
            clientX: x, clientY: y
        }));
        let last = null;
        const f0 = phases[0];
        const c0 = toC(f0[0][0], f0[0][1]);
        ev('pointerdown', c0[0], c0[1]);
        last = c0;
        for (let ph = 0; ph < phases.length; ph++) {
            if (ph > 0) await new Promise(res => setTimeout(res, pauseMs || 280));
            const P = phases[ph];
            const dly = ph > 0 ? (dt2 || 4) : dt;
            for (let i = (ph > 0 ? 0 : 1); i < P.length; i++) {
                if (dly > 0) await new Promise(res => setTimeout(res, dly));
                const c = toC(P[i][0], P[i][1]);
                ev('pointermove', c[0], c[1]);
                last = c;
            }
        }
        if (noUp) return { n: 1, last: last, suspended: true };
        ev('pointerup', last[0], last[1]);
        return { n: 1, last: last };
    }, { phases, dt: isFinite(opts.dt) ? opts.dt : 4, dt2: opts.dt2 || 4, pauseMs: opts.pauseMs, noUp: !!opts.noUp });
}
async function liftPen(page, lastC) {
    await page.evaluate((c) => {
        const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
        canvas.dispatchEvent(new PointerEvent('pointerup', {
            pointerId: 21, pointerType: 'pen', pressure: 0.5, bubbles: true,
            clientX: c[0], clientY: c[1]
        }));
    }, lastC);
}
async function objs(page) { return await page.evaluate(() => window.__ink.objects()); }
async function stateOf(page) { return await page.evaluate(() => window.__ink.state()); }
async function freshDoc(page) {
    await page.evaluate(() => {
        const st = window.__QA.store.items.filter(x => x.id === 'nt1')[0];
        st.content = '';
    });
    // riapre l'editor (QA.mod = modulo registrato dall'harness)
    await page.evaluate(() => {
        const main = document.getElementById('main');
        main.innerHTML = '';
        const mod = window.__QA.mod || (window.App && window.App._mod);
        mod.open(main, { open: 'nt1' });
    });
    await sleep(450);
    // buildChrome azzera helpOn: riallinea lo stato dei test u20
    // (setHelp dopo OGNI freshDoc, come fa u20_shaping.test.js)
    await page.evaluate(() => {
        window.__ink.setHelp(0.6);
        window.__ink.setShaping(true, true, 400);
    });
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files', '--font-render-hinting=none']
    });
    console.log('BROWSER OK: ' + (await browser.version()));
    const out = { method: 'qaU20_matrix: stroke sintetico jitter + hold reale, assert geometrici su SVG/canvas, PRIMA=baseline r20_notes_baseline.js' };

    for (const mode of ['prima', 'dopo']) {
        console.log('\n==== MODE ' + mode.toUpperCase() + ' ====');
        const { page, errs } = await newPage(browser, mode === 'prima');
        await page.evaluate(() => window.__ink.setHelp(0.6));
        await page.evaluate(() => window.__ink.setShaping(true, true, 400));
        const res = {};
        const bounds = await page.evaluate(() => {
            const ink = window.__ink;
            const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
            const r = c.getBoundingClientRect();
            const a = ink.toWorld(r.left, r.top), b = ink.toWorld(r.right, r.bottom);
            return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
        });
        const W = bounds.x1 - bounds.x0, H = bounds.y1 - bounds.y0;
        const bandY = i => bounds.y0 + H * (0.09 + i * 0.115);
        const cx0 = k => bounds.x0 + W * (k || 0.22);
        // handle re-interrogato a ogni shot: freshDoc ricrea il canvas
        const shot = async n => {
            const el = await page.$('.nt-stage canvas') || await page.$('canvas');
            await el.screenshot({ path: path.join(QA_DIR, 'r20_shp_' + mode + '_' + n + '.png') });
        };

        /* Q1: rettangolo storto + GHOST during hold */
        {
            await freshDoc(page);
            const rnd = lcg(101);
            const pts = genSkewRect(cx0(0.24), bandY(0), 150, 95, 7, 4, rnd);
            const r = await strokePts(page, [pts], { dt: 0, noUp: true });
            await sleep(600);   // hold 400 + margine, penna GIU
            const st = await stateOf(page);
            const oDuring = await objs(page);
            await shot('q1a_ghost');
            res.q1 = {
                ghost_during_hold: st.ghost === true,
                committed_during_hold: oDuring.length > 0,
                ghost_ok: mode === 'dopo' ? (st.ghost === true && oDuring.length === 0) : null
            };
            await liftPen(page, r.last);
            await sleep(500);
            res.q1.all = (await objs(page)).map(x => x.t + ':' + (x.kind || ''));
            const o = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            const co = o && o.kind === 'rectangle' ? o : null;
            let maxAng = null;
            if (co && co.pts && co.pts.length >= 4) {
                maxAng = 0;
                const P = co.pts;
                for (let i = 0; i < 4; i++) {
                    const a = P[(i + 3) % 4], b = P[i], c = P[(i + 1) % 4];
                    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
                    const cs = (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1])) || 1);
                    const ang = Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI;
                    maxAng = Math.max(maxAng, Math.abs(ang - 90));
                }
            }
            res.q1.kind = o && o.kind;
            res.q1.corner_err_max = maxAng;
            res.q1.corner_ok = maxAng != null && maxAng <= 5;
            await shot('q1b_rect');
            // editabilitÃ : tool selezione + drag su punto medio lato
            let moved = false;
            try {
                await page.click('[data-tool="selezione"]');
                await sleep(60);
                const movedR = await page.evaluate(async (c0) => {
                    const ink = window.__ink;
                    const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
                    const before = ink.objects().filter(x => x.t === 'shape').slice(-1)[0];
                    if (!before) return { moved: false, err: 'no shape' };
                    const bb = before.box;
                    const mid = [bb.x + bb.w / 2, bb.y + bb.h / 2];
                    const r = canvas.getBoundingClientRect();
                    const p0 = ink.toWorld(r.left, r.top);
                    const px = ink.toWorld(r.left + 100, r.top);
                    const sx = (px.x - p0.x) / 100;
                    const toC = (wx, wy) => [r.left + (wx - p0.x) / sx, r.top + (wy - p0.y) / ((ink.toWorld(r.left, r.top + 100).y - p0.y) / 100)];
                    const cA = toC(mid[0], mid[1]);
                    const cB = toC(mid[0] + 28, mid[1] + 18);
                    const ev = (t, x, y) => canvas.dispatchEvent(new PointerEvent(t, {
                        pointerId: 31, pointerType: 'pen', pressure: 0.5, bubbles: true, clientX: x, clientY: y
                    }));
                    ev('pointerdown', cA[0], cA[1]);
                    ev('pointermove', cB[0], cB[1]);
                    ev('pointermove', cB[0], cB[1]);
                    ev('pointerup', cB[0], cB[1]);
                    await new Promise(res2 => setTimeout(res2, 80));
                    const after = ink.objects().filter(x => x.t === 'shape').slice(-1)[0];
                    return { moved: !!after && (Math.abs(after.box.x - before.box.x) + Math.abs(after.box.y - before.box.y)) > 4,
                             dx: after ? after.box.x - before.box.x : null };
                }, null);
                moved = !!movedR.moved;
            } catch (e) { /* prova fallita */ }
            res.q1.editable = moved;
            res.q1.ok = (res.q1.kind === 'rectangle') && res.q1.corner_ok && (mode === 'prima' ? true : res.q1.ghost_ok && moved);
            console.log('  Q1: kind=' + res.q1.kind + ' all=' + JSON.stringify(res.q1.all) + ' angoli_err=' + res.q1.corner_err_max +
                ' ghost=' + res.q1.ghost_during_hold + ' edit=' + res.q1.editable + ' -> ' + (res.q1.ok ? 'PASS' : 'FAIL'));
        }

        /* Q2: quadrato impreciso */
        {
            await freshDoc(page);
            const rnd = lcg(202);
            const pts = genSkewRect(cx0(0.30), bandY(1), 100, 100, 3, 4, rnd);
            await strokePts(page, [pts], { dt: 0 });
            await sleep(450);
            const o = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            const asp = o && o.box ? o.box.w / o.box.h : null;
            res.q2 = { kind: o && o.kind, aspect: asp };
            res.q2.ok = res.q2.kind === 'square' && asp >= 0.9 && asp <= 1.1;
            await shot('q2_square');
            console.log('  Q2: kind=' + res.q2.kind + ' aspect=' + (asp && asp.toFixed(3)) + ' -> ' + (res.q2.ok ? 'PASS' : 'FAIL'));
        }

        /* Q3: cerchi (chiuso, gap, C aperta, coloring) */
        {
            await freshDoc(page);
            let rnd = lcg(303);
            await strokePts(page, [genLoop(cx0(0.18), bandY(2), 50, 130, 3, rnd)], { dt: 3 });
            await sleep(400);
            let o = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            res.q3a = { kind: o && o.kind };
            res.q3a.ok = res.q3a.kind === 'circle';
            await shot('q3a_cerchio');

            await freshDoc(page);
            rnd = lcg(404);
            await strokePts(page, [genLoop(cx0(0.40), bandY(2), 50, 128, 3, rnd, Math.PI * 2 * 0.97)], { dt: 3 });
            await sleep(400);
            o = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            res.q3b = { kind: o && o.kind, r: o && o.params ? o.params.r : null };
            res.q3b.ok = res.q3b.kind === 'circle' && res.q3b.r > 0;
            await shot('q3b_gap');

            await freshDoc(page);
            rnd = lcg(505);
            await strokePts(page, [genLoop(cx0(0.62), bandY(2), 50, 100, 3, rnd, Math.PI * 1.45)], { dt: 3 });
            await sleep(400);
            const os = await objs(page);
            o = os[os.length - 1];
            res.q3c = { t: o && o.t, kind: o && o.kind };
            res.q3c.ok = !(o && o.t === 'shape' && (o.kind === 'circle' || o.kind === 'ellipse'));
            await shot('q3c_C_aperta');

            await freshDoc(page);
            rnd = lcg(606);
            await strokePts(page, [genLissajous(cx0(0.84), bandY(2), 55, 45, 220, 4, rnd)], { dt: 2 });
            await sleep(400);
            const os2 = await objs(page);
            o = os2[os2.length - 1];
            res.q3d = { t: o && o.t, kind: o && o.kind };
            res.q3d.ok = o && o.t === 'stroke';
            await shot('q3d_coloring');
            console.log('  Q3: a=' + res.q3a.kind + ' b=' + res.q3b.kind + ' c=' + res.q3c.t + '/' + res.q3c.kind +
                ' d=' + res.q3d.t + ' -> ' + ([res.q3a, res.q3b, res.q3c, res.q3d].every(x => x.ok) ? 'PASS' : 'FAIL'));
        }

        /* Q4: arco stretto verso il basso -> BÃ©zier liscia */
        {
            await freshDoc(page);
            await page.evaluate(() => window.__ink.setShaping(true, true, 900));
            const rnd = lcg(707);
            // valle identica a u20 sezione8: 130px, sag55, jitter Â±1
            const x0 = cx0(0.10), arcW = 130, yc = bandY(3);
            const pts = genDownArc(x0, arcW, yc, 55, 2, rnd);
            await strokePts(page, [pts], { dt: 0 });
            await sleep(450);
            const o = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            res.q4 = { kind: o && o.kind };
            if (o && o.kind === 'curve' && o.params && o.params.bez) {
                // metriche COPIE ESATTE da u20 sezione8 (bezPoly/stepPoly/turnsOf)
                const m = await page.evaluate((rawPts) => {
                    const oo = window.__ink.objects().filter(x => x.t === 'shape').slice(-1)[0];
                    const bezPoly = (bez, sub) => {
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
                    };
                    const stepPoly = (poly, d) => {
                        const out = [poly[0]];
                        let acc = 0;
                        for (let i = 1; i < poly.length; i++) {
                            acc += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
                            if (acc >= d) { out.push(poly[i]); acc = 0; }
                        }
                        const last = poly[poly.length - 1], l = out[out.length - 1];
                        if (l[0] !== last[0] || l[1] !== last[1]) out.push(last);
                        return out;
                    };
                    const turnsOf = (poly) => {
                        const out = [];
                        for (let i = 1; i < poly.length - 1; i++) {
                            const a1 = Math.atan2(poly[i][1] - poly[i - 1][1], poly[i][0] - poly[i - 1][0]);
                            const a2 = Math.atan2(poly[i + 1][1] - poly[i][1], poly[i + 1][0] - poly[i][0]);
                            let d = (a2 - a1) * 180 / Math.PI;
                            while (d > 180) d -= 360;
                            while (d < -180) d += 360;
                            out.push(d);
                        }
                        return out;
                    };
                    const maxDist = (pts, poly) => {
                        let mx = 0;
                        for (const p of pts) {
                            let best = Infinity;
                            for (let i = 1; i < poly.length; i++) {
                                const a = poly[i - 1], b = poly[i];
                                const dx = b[0] - a[0], dy = b[1] - a[1];
                                const L2 = dx * dx + dy * dy || 1;
                                let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
                                t = Math.max(0, Math.min(1, t));
                                const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
                                if (d < best) best = d;
                            }
                            if (best > mx) mx = best;
                        }
                        return mx;
                    };
                    const ideal = bezPoly(oo.params.bez, 8);
                    const residuo = maxDist(rawPts, ideal);
                    const ts = turnsOf(stepPoly(ideal, 6));
                    const sig = ts.filter(v => Math.abs(v) > 5);
                    const nPos = sig.filter(v => v > 0).length;
                    const frac = sig.length ? Math.max(nPos, sig.length - nPos) / sig.length : 0;
                    let maxAdj = 0;
                    for (let i = 1; i < ts.length; i++) maxAdj = Math.max(maxAdj, Math.abs(ts[i] - ts[i - 1]));
                    return { residuo: residuo, frac: frac, maxAdj: maxAdj };
                }, pts);
                res.q4.residuo = Math.round(m.residuo * 100) / 100;
                res.q4.signFrac = Math.round(m.frac * 1000) / 1000;
                res.q4.maxAdj = Math.round(m.maxAdj * 100) / 100;
                res.q4.ok = res.q4.kind === 'curve' && m.residuo <= 2.5 && m.frac >= 0.9 && m.maxAdj <= 15;
            }
            await shot('q4_arco');
            console.log('  Q4: kind=' + res.q4.kind + ' residuo=' + res.q4.residuo +
                ' sign=' + res.q4.signFrac + ' maxAdj=' + res.q4.maxAdj + ' -> ' + (res.q4.ok ? 'PASS' : 'FAIL'));
        }

        /* Q5: retta + flick -> freccia saldata */
        {
            await freshDoc(page);
            const rnd = lcg(808);
            const line = genLine(cx0(0.10), bandY(4), 50, 2, rnd);
            const end = line[line.length - 1];
            await strokePts(page, [line, flickOf(end, FLICK)], { dt: 2, dt2: 5, pauseMs: 280 });
            await sleep(450);
            const sh = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            res.q5 = { kind: sh && sh.kind };
            if (sh && sh.kind === 'arrow') {
                const h = sh.params.head, sp = sh.params.shaft.pts;
                const term = sp[sp.length - 1];
                res.q5.shaft = sh.params.shaft.kind;
                res.q5.angoloAla = h.angoloAlaDeg;
                res.q5.rapportoL = Math.round((h.lunghezza / sh.size) * 100) / 100;
                res.q5.baseErr = Math.round(Math.hypot(h.base[0] - term[0], h.base[1] - term[1]) * 1000) / 1000;
                res.q5.ok = res.q5.shaft === 'line' && h.angoloAlaDeg >= 30 && h.angoloAlaDeg <= 45 &&
                    res.q5.rapportoL >= 3 && res.q5.rapportoL <= 4 && res.q5.baseErr <= 2;
            }
            await shot('q5_fretta');
            console.log('  Q5: kind=' + res.q5.kind + ' shaft=' + res.q5.shaft + ' ala=' + res.q5.angoloAla +
                ' L/size=' + res.q5.rapportoL + ' base=' + res.q5.baseErr + ' -> ' + (res.q5.ok ? 'PASS' : 'FAIL'));
        }

        /* Q6: arco + flick -> freccia curva */
        {
            await freshDoc(page);
            const rnd = lcg(909);
            const arc = genArcDown(cx0(0.14), W * 0.36, bandY(5), 60, 2, rnd);
            const end = arc[arc.length - 1];
            await strokePts(page, [arc, flickOf(end, FLICK)], { dt: 2, dt2: 5, pauseMs: 280 });
            await sleep(450);
            const sh = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            res.q6 = { kind: sh && sh.kind };
            if (sh && sh.kind === 'arrow') {
                const h = sh.params.head, bez = sh.params.shaft.bez;
                const sg = bez[bez.length - 1];
                const der = [3 * (sg[3][0] - sg[2][0]), 3 * (sg[3][1] - sg[2][1])];
                const n1 = Math.hypot(h.tangente[0], h.tangente[1]) || 1, n2 = Math.hypot(der[0], der[1]) || 1;
                const cs = Math.max(-1, Math.min(1, (h.tangente[0] * der[0] + h.tangente[1] * der[1]) / (n1 * n2)));
                const angT = Math.acos(cs) * 180 / Math.PI;
                res.q6.shaft = sh.params.shaft.kind;
                res.q6.tangenteErr = Math.round(angT * 1000) / 1000;
                res.q6.baseErr = Math.round(Math.hypot(h.base[0] - sg[3][0], h.base[1] - sg[3][1]) * 1000) / 1000;
                res.q6.angoloAla = h.angoloAlaDeg;
                res.q6.ok = res.q6.shaft === 'curve' && res.q6.tangenteErr <= 10 &&
                    res.q6.baseErr <= 2 && h.angoloAlaDeg >= 30 && h.angoloAlaDeg <= 45;
            }
            await shot('q6_acurfreccia');
            console.log('  Q6: kind=' + res.q6.kind + ' shaft=' + res.q6.shaft + ' tangErr=' + res.q6.tangenteErr +
                ' base=' + res.q6.baseErr + ' ala=' + res.q6.angoloAla + ' -> ' + (res.q6.ok ? 'PASS' : 'FAIL'));
        }

        /* Q7: saldatura dopo spostamento + gesti 2/3 dita */
        {
            await freshDoc(page);
            const rnd = lcg(1717);
            const line = genLine(cx0(0.12), bandY(6), 50, 2, rnd);
            const end = line[line.length - 1];
            await strokePts(page, [line, flickOf(end, FLICK)], { dt: 2, dt2: 5, pauseMs: 280 });
            await sleep(450);
            let sh = (await objs(page)).filter(x => x.t === 'shape').slice(-1)[0];
            res.q7 = { built: !!(sh && sh.kind === 'arrow') };
            if (sh && sh.kind === 'arrow') {
                // PRIMA i gesti (stato pulito: arrow -> undo2 -> redo3),
                // POI il drag (altrimenti il gesto 2 dita annullerebbe la MOSSA)
                const g = await page.evaluate(async () => {
                    const ink = window.__ink;
                    const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
                    const r = canvas.getBoundingClientRect();
                    const pt = (t, x, y, id) => canvas.dispatchEvent(new PointerEvent(t, {
                        pointerId: id, pointerType: 'touch', bubbles: true,
                        clientX: r.left + x, clientY: r.top + y
                    }));
                    const n0 = ink.objects().length;
                    pt('pointerdown', 300, 300, 71); pt('pointerdown', 316, 300, 72);
                    pt('pointerup', 300, 300, 71); pt('pointerup', 316, 300, 72);
                    await new Promise(rr => setTimeout(rr, 120));
                    const n1 = ink.objects().length;
                    const t1 = ink.objects()[0] && ink.objects()[0].t;
                    pt('pointerdown', 300, 300, 73); pt('pointerdown', 316, 300, 74); pt('pointerdown', 332, 300, 75);
                    pt('pointerup', 300, 300, 73); pt('pointerup', 316, 300, 74); pt('pointerup', 332, 300, 75);
                    await new Promise(rr => setTimeout(rr, 120));
                    const n2 = ink.objects().length;
                    const k2 = ink.objects()[0] && ink.objects()[0].kind;
                    return { n0: n0, n1: n1, t1: t1, n2: n2, k2: k2 };
                });
                // drag con tool selezione sul mezzo asta
                await page.click('[data-tool="selezione"]');
                await sleep(60);
                const mv = await page.evaluate(async () => {
                    const ink = window.__ink;
                    const canvas = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
                    const before = ink.objects().filter(x => x.t === 'shape').slice(-1)[0];
                    const sp = before.params.shaft.pts;
                    const mid = [(sp[0][0] + sp[sp.length - 1][0]) / 2, (sp[0][1] + sp[sp.length - 1][1]) / 2];
                    const base0 = [before.params.head.base[0], before.params.head.base[1]];
                    const term0 = [sp[sp.length - 1][0], sp[sp.length - 1][1]];
                    const r = canvas.getBoundingClientRect();
                    const p0 = ink.toWorld(r.left, r.top);
                    const px = ink.toWorld(r.left + 100, r.top), py = ink.toWorld(r.left, r.top + 100);
                    const sx = (px.x - p0.x) / 100, sy = (py.y - p0.y) / 100;
                    const toC = (wx, wy) => [r.left + (wx - p0.x) / sx, r.top + (wy - p0.y) / sy];
                    const ev = (t, x, y) => canvas.dispatchEvent(new PointerEvent(t, {
                        pointerId: 41, pointerType: 'pen', pressure: 0.5, bubbles: true, clientX: x, clientY: y
                    }));
                    const cA = toC(mid[0], mid[1]), cB = toC(mid[0] + 30, mid[1] + 20);
                    ev('pointerdown', cA[0], cA[1]);
                    ev('pointermove', cB[0], cB[1]);
                    ev('pointermove', cB[0], cB[1]);
                    ev('pointerup', cB[0], cB[1]);
                    await new Promise(rr => setTimeout(rr, 100));
                    const after = ink.objects().filter(x => x.t === 'shape').slice(-1)[0];
                    if (!after || after.kind !== 'arrow') return { ok: false, err: 'perso dopo drag' };
                    const spA = after.params.shaft.pts;
                    const dTerm = Math.hypot(spA[spA.length - 1][0] - term0[0], spA[spA.length - 1][1] - term0[1]);
                    const dBase = Math.hypot(after.params.head.base[0] - base0[0], after.params.head.base[1] - base0[1]);
                    const weld = Math.hypot(after.params.head.base[0] - spA[spA.length - 1][0],
                                            after.params.head.base[1] - spA[spA.length - 1][1]);
                    return { ok: true, moved: dTerm > 5, weld: weld, dBase: dBase, ang: after.params.head.angoloAlaDeg };
                });
                res.q7.moved = !!(mv.ok && mv.moved);
                res.q7.weldAfterMove = mv.weld;
                res.q7.saldatura_ok = mv.ok && mv.weld <= 3 && Math.abs(mv.ang - sh.params.head.angoloAlaDeg) < 0.01;
                await shot('q7a_mossa');
                // undo 1 di arrow -> 1 stroke; redo -> arrow di nuovo
                res.q7.undo2fing = g.n1 === g.n0 && g.t1 === 'stroke';
                res.q7.redo3fing = g.n2 === g.n0 && g.k2 === 'arrow';
                res.q7.ok = res.q7.built && res.q7.moved && res.q7.saldatura_ok &&
                    res.q7.undo2fing && res.q7.redo3fing;
                await shot('q7b_gesti');
            } else {
                res.q7.ok = false;
            }
            console.log('  Q7: built=' + res.q7.built + ' moved=' + res.q7.moved + ' weld=' + res.q7.weldAfterMove +
                ' undo2=' + res.q7.undo2fing + ' redo3=' + res.q7.redo3fing + ' -> ' + (res.q7.ok ? 'PASS' : 'FAIL'));
        }

        res.pageerrors = errs.slice(0, 5);
        out[mode] = res;
        await page.close();
    }

    fs.writeFileSync(MEAS, JSON.stringify(out, null, 2));

    const dopo = out.dopo || {};
    const keys = ['q1', 'q2', 'q3a', 'q3b', 'q3c', 'q3d', 'q4', 'q5', 'q6', 'q7'];
    let fail = 0;
    for (const k of keys) { if (!dopo[k] || !dopo[k].ok) { fail++; console.log('VERDETTO FAIL: ' + k); } }
    const nOK = k => { const v = (out.prima || {})[k]; return v && v.ok ? 1 : 0; };
    console.log('\nPRIMA (baseline): ' + keys.reduce((a, k) => a + nOK(k), 0) + '/' + keys.length + ' ok (informativo)');
    console.log('DOPO  (R20):      ' + (keys.length - fail) + '/' + keys.length + ' ok');
    await browser.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ECCEZIONE: ' + (e && e.stack || e)); process.exit(2); });
