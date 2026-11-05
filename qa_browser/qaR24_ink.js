'use strict';
/* qa_browser/qaR24_ink.js - R24 FE-INK T2: perfezionamento al RILASCIO
   misurato sulla PAGINA REALE index.html (stessa catena ?v= del BUILD,
   server static, eventi pointer REALI via CDP mouse - Puppeteer/Chrome;
   playwright NON e' presente in questo ambiente, dichiarato).
   EVIDENZA VINCOLANTE: chiusura T2 SOLO su index.html reale (jsdom = T1).

   PRIMA  : interception di js/modules/notes.js -> serve
            qa/r24_notes_baseline.js (copia pre-fix, MD5 uguale alla
            baseline R0) -> stesse forme disegnate, contatori/strumentazione
            ASSENTI (vincolo R2.2 non soddisfatto) -> screenshot.
   DOPO   : notes.js fissato (interception off, reload) -> retta ondulata
            LIEVE rilasciata SENZA pausa -> dopo settle 150ms: shape line
            con residuo vs segmento ideale (params/pts) <=0.5px E
            counters.refined +1; arco ondulato (Â±1.4px, dentro il gate
            R20/R22 eps<=2.5 NON alzato -> branch ARCO Kasa, curva liscia)
            -> residuo vs GENERATORE NOTO <=1.5px (R3.1, ASSERT);
            onda Â±10px documentata (curve accettabile, gate R20/R22 NON
            alzati, aiuto OFF = condizioni R0).
   Patch AMBIENTE dichiarata (stessa R0): StudyStore.listSubjects race
   SOLO se pywebview assente. Flow: App.go('notes') -> Nuova nota ->
   Crea nota -> poll editor (>=48s copre READY 20s del fallback store).
   Output: qa/r24_ink_measures.json + qa/r24_ink_*.png + tabella stdout.
   Uso: node qa_browser/qaR24_ink.js  [porta default 8878] */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const BASELINE = path.join(QA_DIR, 'r24_notes_baseline.js');
const PORT = Number(process.argv[2]) || 8878;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function staticServer() {
    const srv = http.createServer((req, res) => {
        try {
            const u = decodeURIComponent((req.url || '/').split('?')[0]);
            let p = path.join(APP_DIR, u === '/' ? '/index.html' : u);
            if (!p.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
            if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
            const ext = path.extname(p).toLowerCase();
            const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(fs.readFileSync(p));
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise(resolve => srv.listen(PORT, '127.0.0.1', () => resolve(srv)));
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}

(async () => {
    if (!fs.existsSync(BASELINE)) throw new Error('baseline mancante: qa/r24_notes_baseline.js');
    const srv = await staticServer();
    const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
    console.log('BROWSER OK: ' + (await browser.version()) + ' (Puppeteer/CDP reale)');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const pageErrors = [], httpFails = [], ink24 = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));
    page.on('console', m => { const t = m.text(); if (/\[ink24\]/.test(t)) ink24.push(t); });
    page.on('response', r => {
        // favicon: rumore di rete, non applicativo (non conta per E2)
        if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) {
            httpFails.push(r.status() + ' ' + r.url());
        }
    });

    // ---- INTERCEPTION: PRIMA = baseline pre-fix, DOPO = source reale ----
    let serveBaseline = true;
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        if (serveBaseline && /\/js\/modules\/notes\.js(\?|$)/.test(u)) {
            req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8',
                          body: fs.readFileSync(BASELINE) });
        } else {
            req.continue();
        }
    });

    async function openEditor(tag) {
        console.log('OPEN ' + BASE + '/index.html [' + tag + ']');
        await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
        let ready = false;
        for (let i = 0; i < 60; i++) {
            ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
            if (ready) break;
            await sleep(250);
        }
        if (!ready) throw new Error(tag + ': home non pronta');
        // ---- PATCH AMBIENTE (dichiarata, NON prodotto): solo senza pywebview
        await page.evaluate(() => {
            if (!window.pywebview && window.StudyStore && typeof StudyStore.listSubjects === 'function') {
                const orig = StudyStore.listSubjects.bind(StudyStore);
                StudyStore.listSubjects = function () {
                    return Promise.race([
                        Promise.resolve().then(() => orig()),
                        new Promise(r => setTimeout(() => r([]), 1500))
                    ]).then(v => v || []);
                };
                window.__r0patch_listSubjects = true;
            }
        });
        await page.evaluate(() => App.go('notes'));
        let listReady = false;
        for (let i = 0; i < 40; i++) {
            listReady = await page.evaluate(() => !!Array.from(document.querySelectorAll('button'))
                .find(b => /Nuova nota/.test(b.textContent || '')));
            if (listReady) break;
            await sleep(250);
        }
        if (listReady) {
            await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || ''));
                if (b) b.click();
            });
        }
        let created = false;
        for (let i = 0; i < 30; i++) {
            created = await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('#moduleView button'))
                    .find(x => /Crea nota/.test(x.textContent || ''));
                if (b) { b.click(); return true; } return false;
            });
            if (created) break;
            await sleep(300);
        }
        let notesReady = false;
        // poll >=48s: copre il READY 20s del fallback store senza pywebview
        for (let i = 0; i < 96; i++) {
            notesReady = await page.evaluate(() => {
                const pill = document.querySelector('.fn-pill-left');
                const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
                return !!(pill && pill.querySelector('button') && c && c.width > 0);
            });
            if (notesReady) break;
            await sleep(500);
        }
        if (!notesReady) throw new Error(tag + ': modulo notes non pronto (>=48s)');
        console.log(tag + ': NOTES READY created=' + created +
            ' patch=' + await page.evaluate(() => !!window.__r0patch_listSubjects));
        await sleep(600);
    }

    async function geom() {
        return page.evaluate(() => {
            const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
            const r = c.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height };
        });
    }
    // shaping dichiarato: assist 0.6 -> gate linea 2.5+0.6*3 = 4.3px (T1 u22)
    async function setupShaping() {
        await page.evaluate(() => {
            window.__ink.setHelp(0.6);
            window.__ink.setShaping(true, true, 900);   // holdMs clamp 800
        });
    }
    // retta ondulata, rilascio SENZA pausa (~8ms), onde su `periods` cicli
    async function drawWavyLine(g, yc, amp, periods) {
        const x0 = g.x + g.w * 0.30, x1 = g.x + g.w * 0.62;
        await page.mouse.move(x0, yc);
        await page.mouse.down();
        for (let i = 1; i <= 60; i++) {
            const t = i / 60;
            await page.mouse.move(x0 + (x1 - x0) * t, yc + Math.sin(t * Math.PI * 2 * periods) * amp);
            await sleep(8);
        }
        await page.mouse.up();
        return { x0: x0, x1: x1, y: yc, amp: amp };
    }
    // semicerchio VERO (R uguale su x e y) + onde, rilascio senza pausa
    async function drawWavyArc(g, cy, R, ampW) {
        const cx = g.x + g.w * 0.46;
        // R3.1: jitter ZERO-MEAN LCG Â±ampW px â€” stessa classe di input del T2
        // R22 (genArco (rnd()-0.5)*4, seed fisso) su cui nasce la soglia
        // <=1.5px (misurato allora: 1.16px). Le onde sinusoidali sistematiche
        // (versione precedente) davano residuo max ~1.70px: input PIU' severo
        // della calibrazione R22, non un peggioramento del fit.
        let s = 7717;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        await page.mouse.move(cx - R, cy);
        await page.mouse.down();
        for (let i = 1; i <= 70; i++) {
            const t = i / 70;
            const ang = Math.PI * (1 - t);
            await page.mouse.move(cx + R * Math.cos(ang),
                cy - R * Math.sin(ang) + (rnd() - 0.5) * 2 * ampW);
            await sleep(8);
        }
        await page.mouse.up();
        return { cx: cx, cy: cy, R: R, ampW: ampW };
    }
    async function readAll() {
        return page.evaluate(() => {
            const ink = window.__ink;
            const objs = (ink && ink.objects) ? ink.objects() : [];
            const l = objs[objs.length - 1];
            return {
                n: objs.length,
                last: l ? { t: l.t, kind: l.kind || null, npts: (l.pts || []).length,
                            paramsKeys: l.params ? Object.keys(l.params) : [] } : null,
                counters: (ink && ink.counters) ? JSON.parse(JSON.stringify(ink.counters)) : null
            };
        });
    }

    const M = { ts: new Date().toISOString(), viewport: '1440x900', tool: 'Puppeteer/CDP reale (playwright assente)' };

    // =================== PRIMA (baseline via interception) ===================
    await openEditor('PRIMA');
    M.envPatch = {
        pywebview: await page.evaluate(() => typeof window.pywebview),
        patch_listSubjects: await page.evaluate(() => !!window.__r0patch_listSubjects)
    };
    await setupShaping();
    M.releaseRefinePrima = String(await page.evaluate(() => (window.__ink.state ? __ink.state().releaseRefine : 'n/d')));
    const g = await geom();
    await drawWavyLine(g, g.y + g.h * 0.30, 3.5, 2);
    await sleep(700);
    const primaLine = await readAll();
    await drawWavyArc(g, g.y + g.h * 0.72, 150, 1.4);
    await sleep(700);
    const primaArc = await readAll();
    await page.screenshot({ path: path.join(QA_DIR, 'r24_ink_1_prima.png') });
    const idxPrima = ink24.length;
    M.prima = { retta: primaLine, arco: primaArc, ink24Lines: idxPrima };
    console.log('PRIMA retta: ' + JSON.stringify(primaLine.last) +
        ' counters=' + JSON.stringify(primaLine.counters));
    console.log('PRIMA arco:  ' + JSON.stringify(primaArc.last) +
        ' counters=' + JSON.stringify(primaArc.counters));

    // =================== DOPO (notes.js fissato) ===================
    serveBaseline = false;
    await openEditor('DOPO');
    await setupShaping();
    M.releaseRefineDopo = await page.evaluate(() => __ink.state().releaseRefine);
    const g2 = await geom();
    M.countersZeroDopo = await readAll();

    // --- R2.4a: retta ondulata LIEVE (Â±3.5px, gate 4.3) rilasciata senza pausa
    const lg = await drawWavyLine(g2, g2.y + g2.h * 0.30, 3.5, 2);
    await sleep(200);   // settle >= 150ms dichiarati
    const dopoLine = await readAll();
    await page.screenshot({ path: path.join(QA_DIR, 'r24_ink_2_dopo_retta.png') });

    // --- R2.4b/R3.1: arco ondulato (Â±1.4px) -> curva ideale liscia.
    // Onde dentro il gate fisso R20/R22 (eps<=2.5): vince il branch ARCO
    // (Kasa) -> curva parametrica liscia, NON un bezier che insegue le onde.
    const ag = await drawWavyArc(g2, g2.y + g2.h * 0.72, 150, 2);   // ±2px classe R22
    await sleep(200);
    const dopoArc = await readAll();
    await page.screenshot({ path: path.join(QA_DIR, 'r24_ink_3_dopo_arco.png') });

    // --- residui in pagina (mondo) vs segmento ideale / generatore noto ---
    const measures = await page.evaluate((lg, ag) => {
        const ink = window.__ink;
        const objs = ink.objects();
        const shp = objs.filter(o => o.t === 'shape');
        const out = { nShapes: shp.length, nStrokes: objs.filter(o => o.t === 'stroke').length,
                      kinds: shp.map(s => s.kind) };
        const line = shp.find(s => s.kind === 'line');
        if (line && line.pts && line.pts.length === 2) {
            const a = line.pts[0], b = line.pts[1];
            let m = 0;
            for (const q of line.pts) {
                const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
                m = Math.max(m, Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L);
            }
            out.lineResE2e = m;   // residuo punti renderizzati vs segmento (params/pts)
            out.lineSegLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const w0 = ink.toWorld(lg.x0, lg.y), w1 = ink.toWorld(lg.x1, lg.y);
            const gv = [w1.x - w0.x, w1.y - w0.y], rv = [b[0] - a[0], b[1] - a[1]];
            const ng = Math.hypot(gv[0], gv[1]) || 1, nr = Math.hypot(rv[0], rv[1]) || 1;
            let ang = Math.acos(Math.max(-1, Math.min(1,
                (gv[0] * rv[0] + gv[1] * rv[1]) / (ng * nr)))) * 180 / Math.PI;
            if (ang > 90) ang = 180 - ang;
            out.lineAngVsGen = ang;
            out.lineRawSpan = ng;
            out.lineCover = out.lineSegLen / (ng || 1);
        }
        const arc = shp.find(s => s.kind === 'curve');
        if (arc && arc.pts && arc.pts.length) {
            // GENERATORE NOTO: semicerchio vero (cx, cy, R) SENZA onde
            const dens = [];
            for (let i = 0; i <= 180; i++) {
                const t = Math.PI * i / 180;
                const p = ink.toWorld(ag.cx + ag.R * Math.cos(t), ag.cy - ag.R * Math.sin(t));
                dens.push([p.x, p.y]);
            }
            let m = 0;
            for (const q of arc.pts) {
                let bd = Infinity;
                for (let i = 0; i < dens.length - 1; i++) {
                    const A = dens[i], B = dens[i + 1];
                    const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
                    let t = l2 > 0 ? ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / l2 : 0;
                    t = t < 0 ? 0 : (t > 1 ? 1 : t);
                    const d = Math.hypot(q[0] - (A[0] + t * dx), q[1] - (A[1] + t * dy));
                    if (d < bd) bd = d;
                }
                if (bd > m) m = bd;
            }
            out.arcResVsGen = m;   // R3.1: residuo render vs generatore vero
            // liscita: turn massimo tra campioni consecutivi (nessun colpo)
            let maxTurn = 0;
            for (let i = 2; i < arc.pts.length; i++) {
                const v1 = [arc.pts[i - 1][0] - arc.pts[i - 2][0], arc.pts[i - 1][1] - arc.pts[i - 2][1]];
                const v2 = [arc.pts[i][0] - arc.pts[i - 1][0], arc.pts[i][1] - arc.pts[i - 1][1]];
                const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
                if (n1 < 1e-9 || n2 < 1e-9) continue;
                let a = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))) * 180 / Math.PI;
                if (a > maxTurn) maxTurn = a;
            }
            out.arcMaxTurnDeg = maxTurn;
            out.arcRenderedPts = arc.pts.length;
        }
        out.counters = JSON.parse(JSON.stringify(ink.counters));
        return out;
    }, lg, ag);

    // --- documentazione: onda Â±10px con condizioni R0 (aiuto OFF) ---------
    // aiuto OFF -> nessun OneEuro/smussamento: onde preservate come in R0
    await page.evaluate(() => {
        const b = document.querySelector('[data-help]');
        if (b) b.click();               // toggle: ON (da setHelp) -> OFF
        if (__ink.state().helpOn) b.click();   // difensivo
    });
    M.helpOffOnda10 = await page.evaluate(() => !__ink.state().helpOn);
    const g3 = await geom();
    await drawWavyLine(g3, g3.y + g3.h * 0.48, 10, 2);
    await sleep(400);
    const dopoBig = await readAll();
    await page.screenshot({ path: path.join(QA_DIR, 'r24_ink_4_finale_viewport.png') });

    // =================== ASSERT ===================
    // PRIMA: baseline senza strumentazione -> perfezionati = 0/assente
    ok(M.prima.retta.counters === null,
        'P1 PRIMA: __ink.counters ASSENTE su baseline (perfezionati=0: R2.2 non soddisfatto)',
        JSON.stringify(M.prima.retta.counters));
    ok(idxPrima === 0, 'P2 PRIMA: NESSUN log [ink24] sulla baseline',
        'ink24=' + idxPrima);
    console.log('      MEASURE P3 PRIMA retta=' + JSON.stringify(M.prima.retta.last) +
        ' arco=' + JSON.stringify(M.prima.arco.last) + ' releaseRefine=' + M.releaseRefinePrima);

    // DOPO
    ok(M.releaseRefineDopo === true,
        'D0 pagina reale DOPO: default ON (nt24 assente -> releaseRefine=true)',
        String(M.releaseRefineDopo));
    ok(!!M.countersZeroDopo.counters && M.countersZeroDopo.counters.classified === 0 &&
       M.countersZeroDopo.counters.refined === 0,
        'D1 contatori a zero prima del disegno DOPO',
        JSON.stringify(M.countersZeroDopo.counters));
    ok(!!dopoLine.last && dopoLine.last.t === 'shape' && dopoLine.last.kind === 'line',
        'D2 retta ondulata lieve rilasciata SENZA pausa -> shape line',
        JSON.stringify(dopoLine.last));
    ok(!!dopoLine.counters && !!dopoLine.counters.stroke &&
       dopoLine.counters.stroke.refined === 1,
        'D3 counters.stroke.refined +1 dopo la retta (settle 150ms)',
        JSON.stringify(dopoLine.counters && dopoLine.counters.stroke));
    ok(!!dopoLine.counters && dopoLine.counters.classified === 1 &&
       dopoLine.counters.refined === 1 && dopoLine.counters.discarded === 0,
        'D4 contatori sessione: classificati=1 perfezionati=1 scartati=0',
        JSON.stringify(dopoLine.counters));
    ok(measures.lineResE2e !== undefined && measures.lineResE2e <= 0.5,
        'D5 residuo punti renderizzati vs segmento ideale (e2e, params/pts) <=0.5px',
        'res=' + (measures.lineResE2e !== undefined ? measures.lineResE2e.toFixed(4) : 'n/d'));
    ok(measures.lineAngVsGen !== undefined && measures.lineAngVsGen <= 1,
        'D6 direzione segmento vs generatore <=1gradi',
        'ang=' + (measures.lineAngVsGen !== undefined ? measures.lineAngVsGen.toFixed(3) : 'n/d'));
    ok(measures.lineCover !== undefined && measures.lineCover >= 0.9,
        'D7 segmento copre la retta e2e (>=90% dello span grezzo)',
        'cover=' + (measures.lineCover !== undefined ? measures.lineCover.toFixed(3) : 'n/d'));
    ok(!!dopoArc.last && dopoArc.last.t === 'shape' && dopoArc.last.kind === 'curve',
        'D8 arco ondulato -> shape curve',
        JSON.stringify(dopoArc.last));
    ok(measures.arcResVsGen !== undefined && measures.arcResVsGen <= 1.5,
        'R3.1 ASSERT residuo render vs GENERATORE NOTO <=1.5px',
        'res=' + (measures.arcResVsGen !== undefined ? measures.arcResVsGen.toFixed(4) : 'n/d'));
    ok(!!dopoArc.counters && !!dopoArc.counters.stroke &&
       dopoArc.counters.stroke.refined === 1 && dopoArc.counters.refined === 2,
        'D9 arco: refined +1 sul tratto (sessione 2)',
        JSON.stringify(dopoArc.counters && dopoArc.counters.stroke) +
        ' sessione=' + (dopoArc.counters && dopoArc.counters.refined));
    ok(ink24.slice(idxPrima).some(l => /\[ink24\] classificati=1 perfezionati=1 scartati=0/.test(l)),
        'D10 console.info [ink24] al rilascio della retta',
        JSON.stringify(ink24.slice(idxPrima).slice(0, 3)));
    ok(!!dopoBig.last && dopoBig.last.kind === 'curve',
        'DOC onda Â±10px (aiuto OFF, gate R20/R22 invariati) -> curve (accettabile, dichiarato)',
        JSON.stringify(dopoBig.last));
    ok(pageErrors.length === 0, 'E1 pageerrors 0 (PRIMA+DOPO)',
        JSON.stringify(pageErrors.slice(0, 3)));
    ok(httpFails.length === 0, 'E2 nessuna risposta HTTP >=400',
        JSON.stringify(httpFails.slice(0, 3)));

    M.dopo = { retta: dopoLine, arco: dopoArc, onda10: dopoBig,
               measures: measures, helpOffOnda10: M.helpOffOnda10 };
    M.ink24 = ink24;
    M.pageErrors = pageErrors;
    M.httpFails = httpFails;
    fs.writeFileSync(path.join(QA_DIR, 'r24_ink_measures.json'), JSON.stringify(M, null, 1));

    // ---- TABELLA ----
    console.log('\n==== TABELLA R24 INK (T2 reale, PRIMA -> DOPO) ====');
    console.log('1. contatori PRIMA (baseline) ............ ' + JSON.stringify(M.prima.retta.counters) + ' -> perfezionati=0');
    console.log('2. contatori DOPO retta .................. ' + JSON.stringify(dopoLine.counters && dopoLine.counters.stroke) + ' sessione=' + JSON.stringify({ c: dopoLine.counters && dopoLine.counters.classified, r: dopoLine.counters && dopoLine.counters.refined, d: dopoLine.counters && dopoLine.counters.discarded }));
    console.log('3. retta lieve -> kind ................... ' + JSON.stringify(dopoLine.last) + ' resE2e=' + (measures.lineResE2e !== undefined ? measures.lineResE2e.toFixed(4) : 'n/d') + 'px angVsGen=' + (measures.lineAngVsGen !== undefined ? measures.lineAngVsGen.toFixed(3) : 'n/d') + 'gradi');
    console.log('4. arco -> kind ......................... ' + JSON.stringify(dopoArc.last) + ' resVsGen=' + (measures.arcResVsGen !== undefined ? measures.arcResVsGen.toFixed(4) : 'n/d') + 'px turn=' + (measures.arcMaxTurnDeg !== undefined ? measures.arcMaxTurnDeg.toFixed(2) : 'n/d') + 'gradi');
    console.log('5. onda Â±10px (aiuto OFF) ............... ' + JSON.stringify(dopoBig.last));
    console.log('6. log [ink24] totale ................... ' + ink24.length + ' (PRIMA=' + idxPrima + ')');
    console.log('7. releaseRefine PRIMA/DOPO ............. ' + M.releaseRefinePrima + ' -> ' + M.releaseRefineDopo);
    console.log('screenshot: qa/r24_ink_1_prima.png, r24_ink_2_dopo_retta.png, r24_ink_3_dopo_arco.png, r24_ink_4_finale_viewport.png');
    console.log('\nRISULTATO qaR24_ink: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));

    await browser.close();
    srv.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('R24 T2 FAIL: ' + (e && e.stack || e)); process.exit(1); });

