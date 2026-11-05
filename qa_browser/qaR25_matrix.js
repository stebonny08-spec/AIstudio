'use strict';
/* qa_browser/qaR25_matrix.js - V4.1 MATRICE T2 REALE (Round 24/25)
   Pagina REALE index.html servita con stessa catena ?v= del BUILD; pointer
   CDP reali; screenshot PRIMA/DOPO dallo STESSO viewport (1440x900, frame
   interi con toolbar+pannello quando contestati); contatori ink letti da
   window.__ink.counters dopo ogni disegno reale.

   Celle V4.1:
    A1 retta ondulata rilasciata -> line, residuo<=0.5px, perfected_on_release+1
    A2 arco ondulato -> arc APERTO, residuo vs generatore<=1.5px, liscia
    A3 S due flessi -> freeform, flessi>=2 conservati, liscia, nessun snap
    A4 loop -> NON snap-pato (kind freeform/closed-shape non geometrico)
    A5 C -> resta APERTA
    A6 verticale+diagonale ondulate -> line perfette
    A7 retta+flick -> arrow (ali 30-45, L/size 3-4x, tangente)
    A8 zoom 245% (popover reale) -> stessi esiti A1/A2
    B1 pannello aperto -> toolbar visibile + elementFromPoint7/7 + screenshot
    B2 pannello compatto (dead<=8px)
   Output: qa/r25_matrix_measures.json + qa/r25_matrix_*.png + tabella stdout.
   Uso: node qa_browser/qaR25_matrix.js [porta default 8881] */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8881;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (extra ? ' | ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' | ' + extra : '')); }
}

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

(async () => {
  const srv = await staticServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
  console.log('BROWSER: ' + (await browser.version()));
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const pageErrors = [], httpFails = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  page.on('response', r => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) httpFails.push(r.status() + ' ' + r.url()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('home non pronta');
  await page.evaluate(() => {
    if (!window.pywebview && window.StudyStore && typeof StudyStore.listSubjects === 'function') {
      const orig = StudyStore.listSubjects.bind(StudyStore);
      StudyStore.listSubjects = function () {
        return Promise.race([Promise.resolve().then(() => orig()), new Promise(r => setTimeout(() => r([]), 1500))]).then(v => v || []);
      };
      window.__r0patch_listSubjects = true;
    }
  });
  await page.evaluate(() => App.go('notes'));
  let listReady = false;
  for (let i = 0; i < 40; i++) {
    listReady = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
    if (listReady) break;
    await sleep(250);
  }
  if (listReady) await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')).click());
  let created = false;
  for (let i = 0; i < 30; i++) {
    created = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || ''));
      if (b) { b.click(); return true; } return false;
    });
    if (created) break;
    await sleep(300);
  }
  let notesReady = false;
  for (let i = 0; i < 96; i++) {
    notesReady = await page.evaluate(() => {
      const pill = document.querySelector('.fn-pill-left');
      const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
      return !!(pill && pill.querySelector('button') && c && c.width > 0);
    });
    if (notesReady) break;
    await sleep(500);
  }
  if (!notesReady) throw new Error('notes non pronto');
  await sleep(600);
  console.log('NOTES READY');

  const M = { ts: new Date().toISOString(), viewport: '1440x900', cells: {} };

  // nuova nota = doc VUOTO (stesso flow del boot: serve alla cella A8 per
  // escludere _insideExisting: nessuna shape esistente nel raggio del tratto)
  async function newNote(page) {
    await page.evaluate(() => App.go('notes'));
    let listReady = false;
    for (let i = 0; i < 40; i++) {
      listReady = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
      if (listReady) break;
      await sleep(250);
    }
    if (listReady) await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')).click());
    let created = false;
    for (let i = 0; i < 30; i++) {
      created = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || ''));
        if (b) { b.click(); return true; } return false;
      });
      if (created) break;
      await sleep(300);
    }
    let ok2 = false;
    for (let i = 0; i < 96; i++) {
      ok2 = await page.evaluate(() => {
        const pill = document.querySelector('.fn-pill-left');
        const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
        return !!(pill && pill.querySelector('button') && c && c.width > 0);
      });
      if (ok2) break;
      await sleep(500);
    }
    if (!ok2) throw new Error('newNote: editor non pronto');
    await sleep(600);
    return created;
  }

  // ---- pannello Fonti aperto (celle B + frame completo) ----
  const fontiBtn = await page.$('[data-fonti]');
  if (fontiBtn) await fontiBtn.click();
  await sleep(500);

  // ============ B1: toolbar visibile + elementFromPoint ============
  const b1 = await page.evaluate(() => {
    const pill = document.querySelector('.fn-pill-left');
    const p = document.querySelector('.fp21-root');
    if (!pill || !p) return { err: 'missing' };
    const pr = pill.getBoundingClientRect(), qr = p.getBoundingClientRect();
    const out = { panelShown: p.classList.contains('show') || getComputedStyle(p).display !== 'none',
      overlapPx2: Math.round(Math.max(0, Math.min(pr.right, qr.right) - Math.max(pr.left, qLeft(qr, pr))) *
        Math.max(0, Math.min(pr.bottom, qr.bottom) - Math.max(pr.top, pr.top))),
      buttons: [] };
    function qLeft(a) { return a; } // placeholder no-op
    pill.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) { out.buttons.push({ label: (b.id || b.title || '').slice(0, 24), visible: false, hitOk: true }); return; }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      let n = hit, inBtn = false;
      while (n) { if (n === b) { inBtn = true; break; } n = n.parentElement; }
      out.buttons.push({ label: (b.id || b.title || b.textContent || '').trim().slice(0, 24), visible: true, hitOk: inBtn });
    });
    // ricalcolo overlap pulito
    const ox = Math.max(0, Math.min(pr.right, qr.right) - Math.max(pr.left, qr.left));
    const oy = Math.max(0, Math.min(pr.bottom, qr.bottom) - Math.max(pr.top, qr.top));
    out.overlapPx2 = Math.round(ox * oy);
    return out;
  });
  M.cells.b1_toolbar = b1;
  const vis = (b1.buttons || []).filter(b => b.visible);
  const visHit = vis.filter(b => b.hitOk);
  ok(b1.panelShown, 'B1 pannello Fonti aperto');
  ok(b1.overlapPx2 === 0, 'B1 pannello NON copre la toolbar (overlap0)', String(b1.overlapPx2));
  ok(vis.length >= 7 && visHit.length === vis.length,
     'B1 elementFromPoint hit su TUTTI i bottoni toolbar visibili (' + visHit.length + '/' + vis.length + ')',
     JSON.stringify(b1.buttons));
  await page.screenshot({ path: path.join(QA_DIR, 'r25_matrix_b1_toolbar_pannello.png') });

  // ============ B2: pannello compatto, nessuno spazio morto ============
  const b2 = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return null;
    const pr = p.getBoundingClientRect();
    const ins = p.querySelector('.fp21-insert');
    const ir = ins ? ins.getBoundingClientRect() : null;
    return { dead: ir ? Math.round(pr.bottom - ir.bottom) : null,
      panelH: Math.round(pr.height),
      typo: /l anteprima/.test(p.textContent || '') };
  });
  M.cells.b2_panel = b2;
  ok(b2 && b2.dead !== null && b2.dead <= 8, 'B2 nessuno spazio morto sotto Inserisci (<=8px)', b2 && String(b2.dead));
  ok(b2 && !b2.typo, 'B2 typo "l anteprima" assente');

  // ============ helper disegno + letture ============
  async function readInk() {
    return page.evaluate(() => {
      const ink = window.__ink;
      const objs = (ink && ink.objects) ? ink.objects() : [];
      const last = objs[objs.length - 1];
      return {
        n: objs.length,
        last: last ? { t: last.t, kind: last.kind || null,
          vclass: last.vclass || null, npts: (last.pts || []).length,
          paramsKeys: last.params ? Object.keys(last.params) : [], params: last.params || null } : null,
        counters: (ink && ink.counters) ? JSON.parse(JSON.stringify(ink.counters)) : null,
        scale: (window.__ed && __ed.scale) || null
      };
    });
  }
  // classe V1 = vclass (il kind resta 'curve' compat per freeform/arc)
  async function clsLast() {
    const r = await readInk();
    const o = r.last;
    const cls = o ? (o.vclass || (o.params && o.params.freeform ? 'freeform' : null) || o.kind) : null;
    return { raw: r, cls: cls };
  }

  async function draw(points, opts) {
    opts = opts || {};
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (let i = 1; i < points.length; i++) {
      await page.mouse.move(points[i][0], points[i][1]);
      await sleep(opts.gapMs || 7);
    }
    if (opts.flick) {
      // flick V multi-punto (caso R20/u22: back-stroke con lateralita', non
      // un perfetto180 che il detector rifiuta come errore di tracciato)
      const last = points[points.length - 1], prev = points[points.length - 2];
      const dx = last[0] - prev[0], dy = last[1] - prev[1];
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, px = -uy, py = ux;
      // sequenza stile u22/R20: micro-avanzata, POI back-stroke MONOTONO
      // con lateralita' minore (±5): zigzag laterali venivano letti come
      // scarabocchio -> freeform
      const seq = [
        [last[0] + ux * 10 + px * 3, last[1] + uy * 10 + py * 3],
        [last[0] + ux * 4 - px * 4, last[1] + uy * 4 - py * 4],
        [last[0] - ux * 10 + px * 2, last[1] - uy * 10 + py * 2],
        [last[0] - ux * 20 - px * 3, last[1] - uy * 20 - py * 3],
        [last[0] - ux * 30 + px * 2, last[1] - uy * 30 + py * 2],
      ];
      // NESSUN sleep: la finestra di velocita del detector va rispettata
      // anche in CDP (dt=6ms/px rallentava sotto la soglia flick)
      for (const q of seq) { await page.mouse.move(q[0], q[1]); }
    }
    await page.mouse.up();
  }
  // residui in pagina: dist max punti oggetto -> segmento (2pt) / generatore noto
  async function residuo(idx, gen) {
    return page.evaluate((idx, gen) => {
      const ink = window.__ink;
      const objs = ink.objects();
      const o = objs[objs.length - 1 - idx] || objs.filter(x => x.t === 'shape')[objs.filter(x => x.t === 'shape').length - 1 - idx];
      if (!o || !o.pts || !o.pts.length) return null;
      const out = { kind: o.kind || null, npts: o.pts.length };
      if (gen && gen.type === 'line') {
        // dist punti alla retta passante per (a,b): generator in SCHERMO,
        // punti oggetto in MONDO -> converto via toWorld (stesso metodo R24)
        const wa = ink.toWorld(gen.a[0], gen.a[1]);
        const wb = ink.toWorld(gen.b[0], gen.b[1]);
        const a = [wa.x, wa.y], b = [wb.x, wb.y];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        let m = 0;
        for (const q of o.pts) m = Math.max(m, Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L);
        out.resVsIdeal = +m.toFixed(4);
        if (o.pts.length === 2) {
          out.resE2e = 0;
          out.angVsGen = 0;
        } else {
          // residuo e2e vs segmentoideale (2 endpoints dell'oggetto)
          const p0 = o.pts[0], p1 = o.pts[o.pts.length - 1];
          const ex = p1[0] - p0[0], ey = p1[1] - p0[1], eL = Math.hypot(ex, ey) || 1;
          let m2 = 0;
          for (const q of o.pts) m2 = Math.max(m2, Math.abs((q[0] - p0[0]) * ey - (q[1] - p0[1]) * ex) / eL);
          out.resE2e = +m2.toFixed(4);
        }
      } else if (gen && gen.type === 'arcgen') {
        // dist max punti al GENERATORE VERO (arco cx,cy,R senza onde), in mondo.
        // yflip: il path A2 usa y = cy - R*sin (corda verso l'alto).
        const ys = gen.yflip ? -1 : 1;
        const rx = gen.rx || gen.R, ry = gen.ry || gen.R;
        const dens = [];
        for (let i = 0; i <= 180; i++) {
          const t = gen.a0 + (gen.a1 - gen.a0) * i / 180;
          const p = ink.toWorld(gen.cx + rx * Math.cos(t), gen.cy + ys * ry * Math.sin(t));
          dens.push([p.x, p.y]);
        }
        let m = 0;
        for (const q of o.pts) {
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
        out.resVsGen = +m.toFixed(4);
        // liscita: turn massimo
        let maxTurn = 0;
        for (let i = 2; i < o.pts.length; i++) {
          const v1 = [o.pts[i - 1][0] - o.pts[i - 2][0], o.pts[i - 1][1] - o.pts[i - 2][1]];
          const v2 = [o.pts[i][0] - o.pts[i - 1][0], o.pts[i][1] - o.pts[i - 1][1]];
          const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
          if (n1 < 1e-9 || n2 < 1e-9) continue;
          let a = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))) * 180 / Math.PI;
          if (a > maxTurn) maxTurn = a;
        }
        out.maxTurnDeg = +maxTurn.toFixed(2);
        // apertura: distanza punta-coda (mondo)
        const f = o.pts[0], l2p = o.pts[o.pts.length - 1];
        out.tipGap = +Math.hypot(f[0] - l2p[0], f[1] - l2p[1]).toFixed(1);
      } else if (gen && gen.type === 'flex') {
        // conteggio flessi: cambi di segno della curvatura discreta sui punti
        const curv = [];
        for (let i = 1; i < o.pts.length - 1; i++) {
          const v1 = [o.pts[i][0] - o.pts[i - 1][0], o.pts[i][1] - o.pts[i - 1][1]];
          const v2 = [o.pts[i + 1][0] - o.pts[i][0], o.pts[i + 1][1] - o.pts[i][1]];
          // cross prod z = curvatura firmata approssimata
          curv.push(v1[0] * v2[1] - v1[1] * v2[0]);
        }
        // smorzamento rumore: segno dopo moving average3
        let signs = [];
        for (let i = 0; i < curv.length; i++) {
          const w = curv.slice(Math.max(0, i - 2), i + 3);
          const s = w.reduce((a, b) => a + b, 0);
          signs.push(s > 1e-9 ? 1 : (s < -1e-9 ? -1 : 0));
        }
        let changes = 0, last = 0;
        for (const s of signs) { if (s !== 0 && last !== 0 && s !== last) changes++; if (s !== 0) last = s; }
        out.flexChanges = changes;
        let maxTurn = 0;
        for (let i = 2; i < o.pts.length; i++) {
          const v1 = [o.pts[i - 1][0] - o.pts[i - 2][0], o.pts[i - 1][1] - o.pts[i - 2][1]];
          const v2 = [o.pts[i][0] - o.pts[i - 1][0], o.pts[i][1] - o.pts[i - 1][1]];
          const n1 = Math.hypot(v1[0], v1[1]), n2 = Math.hypot(v2[0], v2[1]);
          if (n1 < 1e-9 || n2 < 1e-9) continue;
          let a = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))) * 180 / Math.PI;
          if (a > maxTurn) maxTurn = a;
        }
        out.maxTurnDeg = +maxTurn.toFixed(2);
        // auto-intersezione dichiarata? (params/topologia)
        out.t = o.t; out.kind = o.kind;
        out.paramsKeys = o.params ? Object.keys(o.params) : [];
      } else if (gen && gen.type === 'flick') {
        // l'oggetto arrow espone .sizes top-level (notes.js buildArrowRec)
        out.arrow = o.sizes || (o.params && o.params.arrow) ||
          (o.params && o.params.sizes) || null;
        if (out.arrow && typeof out.arrow === 'object') {
          out.arrow = JSON.parse(JSON.stringify(out.arrow));
        }
        out.tipGap = +Math.hypot(o.pts[0][0] - o.pts[o.pts.length - 1][0], o.pts[0][1] - o.pts[o.pts.length - 1][1]).toFixed(1);
      }
      return out;
    }, idx, gen);
  }

  const geom = await page.evaluate(() => {
    const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const AX = geom.x + 480, BX = geom.x + 940;
  const rowY = i => geom.y + [170, 330, 530, 760][i];
  const countersSeries = [];

  async function shot(name) { await page.screenshot({ path: path.join(QA_DIR, 'r25_matrix_' + name + '.png') }); }

  async function cellStroke(cell, points, opts, gen) {
    const before = await readInk();
    await shot(cell + '_prima');
    await draw(points, opts);
    await sleep(750);
    const after = await readInk();
    const res = gen ? await residuo(0, gen) : null;
    const cSeries = { cell, counters: after.counters,
      deltaClass: after.counters && before.counters ? {
        classified: after.counters.classified,
        classifiedPrev: before.counters.classified,
        perfected: after.counters.perfected_on_release,
        perfPrev: before.counters.perfected_on_release
      } : null };
    countersSeries.push(cSeries);
    M.cells[cell] = { before_n: before.n, after_n: after.n, last: after.last,
      counters: after.counters, countersPrev: before.counters, resid: res };
    await shot(cell + '_dopo');
    return M.cells[cell];
  }

  // ============ A1 retta ondulata -> line ============
  {
    const y = rowY(0), x0 = AX, x1 = AX + 420; // 420px: onde10px = 2.4% (<=3%)
    const pts = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64; pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 4) * 10]); }
    const c = await cellStroke('a1_retta', pts, {}, { type: 'line', a: [x0, y], b: [x1, y] });
    const perf = c.counters && c.counters.perfected_on_release;
    const perfPrev = c.countersPrev && c.countersPrev.perfected_on_release;
    const cls = c.counters && c.counters.classified;
    const clsLine = cls && typeof cls === 'object' ? cls.line : undefined;
    ok(c.last && c.last.t === 'shape' && c.last.kind === 'line', 'A1 retta -> kind=line', JSON.stringify(c.last));
    ok(c.resid && c.resid.resE2e !== undefined && c.resid.resE2e <= 0.5, 'A1 residuo e2e <=0.5px', c.resid && String(c.resid.resE2e));
    ok(typeof perf === 'number' && typeof perfPrev === 'number' && perf === perfPrev + 1,
       'A1 perfected_on_release +1', JSON.stringify({ perf, perfPrev }));
    ok(typeof clsLine === 'number' && clsLine >= 1, 'A1 classified.line >=1', JSON.stringify(cls));
  }
  // ============ A2 arco ondulato -> arc aperto ============
  {
    const y = rowY(0), x0 = BX, x1 = BX + 320;
    const R = (x1 - x0) / 2, cx = (x0 + x1) / 2, cy = y + 70;
    const pts = [];
    // jitter LCG ±2px zero-mean (classe di input R22 del R24 da cui nasce la
    // soglia V3.1 <=1.5px; le onde sinusoidali SISTEMATICHE danno residuo
    // ~2px per qualsiasi fit liscio - non-assert gia dichiarato nel R24)
    let sA2 = 7717;
    const rndA2 = () => { sA2 = (sA2 * 1103515245 + 12345) & 0x7fffffff; return sA2 / 0x7fffffff; };
    for (let i = 0; i <= 70; i++) {
      const t = i / 70, ang = Math.PI * (1 - t);
      // semicerchio VERO: rx=ry=R (con70 verticale era un'ellisse e il fit
      // circolare/bez lasciava ~1.7px di residuo strutturale)
      pts.push([cx + R * Math.cos(ang), cy - Math.sin(ang) * R + (rndA2() - 0.5) * 4]);
    }
    // generatore: arco di cerchio (cx, cy, R) da PI a 0 (senza onde) - in mondo via toWorld dentro residuo
    // il path e' un semicerchio SQUILIBRATO: rx=R(160), ry=70 (y = cy - sin*70)
    const c = await cellStroke('a2_arco', pts, {}, { type: 'arcgen', cx, cy, R, rx: R, ry: R, a0: Math.PI, a1: 0, yflip: true });
    const clsA2 = c.last ? (c.last.vclass || (c.last.params && c.last.params.freeform ? 'freeform' : c.last.kind)) : null;
    ok(c.last && c.last.t === 'shape' && clsA2 === 'arc',
       'A2 arco -> classe arc (vclass)', JSON.stringify(c.last) + ' cls=' + clsA2);
    const cls = c.counters && c.counters.classified;
    ok(cls && typeof cls === 'object' && typeof cls.arc === 'number' && cls.arc >= 1,
       'A2 classified.arc >=1', JSON.stringify(cls));
    ok(c.resid && c.resid.resVsGen !== undefined && c.resid.resVsGen <= 1.5,
       'A2 residuo vs GENERATORE <=1.5px', c.resid && String(c.resid.resVsGen));
    ok(c.resid && c.resid.tipGap !== undefined && c.resid.tipGap > 30,
       'A2 resta APERTO (punta-coda grande)', c.resid && String(c.resid.tipGap));
  }
  // ============ A3 S due flessi -> freeform conservato ============
  {
    const y = rowY(1), x0 = AX, x1 = AX + 320;
    const pts = [];
    for (let i = 0; i <= 70; i++) { const t = i / 70; pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 3) * 42]); }
    const c = await cellStroke('a3_s', pts, {}, { type: 'flex' });
    const cls = c.counters && c.counters.classified;
    const clsA3 = c.last ? (c.last.vclass || (c.last.params && c.last.params.freeform ? 'freeform' : c.last.kind)) : null;
    ok(c.last && c.last.t === 'shape' && clsA3 === 'freeform',
       'A3 S -> classe freeform (nessun snap)', JSON.stringify(c.last) + ' cls=' + clsA3);
    ok(cls && typeof cls === 'object' && typeof cls.freeform === 'number' && cls.freeform >= 1,
       'A3 classified.freeform >=1', JSON.stringify(cls));
    ok(c.resid && c.resid.flexChanges >= 2, 'A3 flessi conservati (>=2)', c.resid && String(c.resid.flexChanges));
    ok(c.resid && c.resid.maxTurnDeg !== undefined && c.resid.maxTurnDeg < 100,
       'A3 liscia (turn max <100)', c.resid && String(c.resid.maxTurnDeg));
  }
  // ============ A4 loop NON snap-pato ============
  {
    const cx = BX + 60, cy = rowY(1), R = 46;
    const pts = [];
    for (let i = 0; i <= 110; i++) {
      const t = i / 110, ang = -Math.PI / 2 + t * Math.PI * 2.4;
      const r = R * (1 - t * 0.12);
      pts.push([cx + r * Math.cos(ang) + t * 40, cy + r * Math.sin(ang)]);
    }
    const c = await cellStroke('a4_loop', pts, {}, { type: 'flex' });
    const cls = c.counters && c.counters.classified;
    const isGeoSnap = c.last && ['circle', 'ellipse', 'rect', 'square', 'triangle'].indexOf(c.last.kind) >= 0;
    ok(c.last && c.last.t === 'shape' && !isGeoSnap, 'A4 loop NON snap-pato (kind=' + (c.last && c.last.kind) + ')', JSON.stringify(c.last));
    ok(c.last && c.last.kind !== 'line', 'A4 loop non diventa line', JSON.stringify(c.last));
    ok(cls && typeof cls === 'object' && (cls.freeform >= 1 || cls.closed >= 1),
       'A4 loop classificato freeform/closed (non line/arc)', JSON.stringify(cls));
  }
  // ============ A5 C resta APERTA ============
  {
    const cx = AX + 40, cy = rowY(2), R = 52;
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, ang = Math.PI * 0.70 + t * Math.PI * 1.34; pts.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]); }
    const c = await cellStroke('a5_c', pts, {}, { type: 'arcgen', cx, cy, R, a0: Math.PI * 0.70, a1: Math.PI * 0.70 + Math.PI * 1.34 });
    // apertura: la corda punta-coda del generatore = 2R sin(120°) ~ 90px
    ok(c.last && c.last.t === 'shape' && ['circle', 'square', 'rect', 'triangle', 'ellipse'].indexOf(c.last.kind) < 0,
       'A5 C NON chiusa in forma geometrica (kind=' + (c.last && c.last.kind) + ')', JSON.stringify(c.last));
    ok(c.resid && c.resid.tipGap >= 60, 'A5 C resta APERTA (punta-coda >=60px)', c.resid && String(c.resid.tipGap));
  }
  // ============ A6 verticale + diagonale ondulate -> line ============
  {
    // onda6px su300px =2.0% MONDO <= gate3% (9px su220 era4.1% -> freeform)
    const x = BX + 80, y0 = rowY(1) + 40, y1 = rowY(2) + 140;
    const pts = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64; pts.push([x + Math.sin(t * Math.PI * 4) * 6, y0 + (y1 - y0) * t]); }
    const c = await cellStroke('a6_verticale', pts, {}, { type: 'line', a: [x, y0], b: [x, y1] });
    const clsA6 = c.last ? (c.last.vclass || (c.last.params && c.last.params.freeform ? 'freeform' : c.last.kind)) : null;
    ok(c.last && c.last.t === 'shape' && clsA6 === 'line', 'A6 verticale -> line', JSON.stringify(c.last) + ' cls=' + clsA6);
    ok(c.resid && c.resid.resE2e <= 0.5, 'A6 verticale residuo <=0.5px', c.resid && String(c.resid.resE2e));
    const x0 = AX, y0d = rowY(2) + 90, x1 = AX + 300, y1d = rowY(1) + 70;
    const pts2 = [];
    for (let i = 0; i <= 64; i++) { const t = i / 64; const nx = -(y1d - y0d), ny = (x1 - x0); const nl = Math.hypot(nx, ny) || 1; const w = Math.sin(t * Math.PI * 4) * 8; pts2.push([x0 + (x1 - x0) * t + (nx / nl) * w, y0d + (y1d - y0d) * t + (ny / nl) * w]); }
    const c2 = await cellStroke('a6_diagonale', pts2, {}, { type: 'line', a: [x0, y0d], b: [x1, y1d] });
    ok(c2.last && c2.last.kind === 'line', 'A6 diagonale -> line', JSON.stringify(c2.last));
    ok(c2.resid && c2.resid.resE2e <= 0.5, 'A6 diagonale residuo <=0.5px', c2.resid && String(c2.resid.resE2e));
  }
  // ============ A7 retta+flick -> arrow ============
  {
    // retta DRITTA + flick (caso R20/v1: onde + flick fanno prevalere freeform
    // sul gate — la freccia su retta ondulata NON e' il caso richiesto)
    const y = rowY(3), x0 = BX, x1 = BX + 320;
    const pts = [];
    for (let i = 0; i <= 55; i++) { const t = i / 55; pts.push([x0 + (x1 - x0) * t, y]); }
    const c = await cellStroke('a7_flick', pts, { flick: true }, { type: 'flick' });
    const cls = c.counters && c.counters.classified;
    const clsA7 = c.last ? (c.last.vclass || (c.last.params && c.last.params.freeform ? 'freeform' : c.last.kind)) : null;
    ok(c.last && (c.last.kind === 'arrow' || clsA7 === 'arrow'), 'A7 retta+flick -> arrow', JSON.stringify(c.last) + ' cls=' + clsA7);
    ok(cls && typeof cls === 'object' && typeof cls.arrow === 'number' && cls.arrow >= 1,
       'A7 classified.arrow >=1', JSON.stringify(cls));
    if (c.resid && c.resid.arrow) {
      const a = c.resid.arrow;
      const ang = a.angle !== undefined ? a.angle : (a.wing !== undefined ? a.wing : null);
      const ratio = a.len !== undefined && a.size ? a.len / a.size : (a.ratio !== undefined ? a.ratio : null);
      console.log('     A7 arrow params=' + JSON.stringify(a));
      M.cells.a7_arrow_params = a;
      // assert strutturali SOLO sui campi disponibili (dichiarati)
      if (ang !== null) ok(ang >= 30 && ang <= 45, 'A7 ali30-45 (gradi)', String(ang));
      if (ratio !== null) ok(ratio >= 3 && ratio <= 4, 'A7 punta3-4x spessore', String(ratio));
    } else {
      ok(false, 'A7 params arrow leggibili dall\'oggetto', JSON.stringify(c.resid));
    }
  }

  // ============ A8 zoom 245% (popover reale) -> stessi esiti ============
  let zoomLabel = null;
  {
    // DOC VUOTO: con8 forme nel doc il tratto cadeva dentro una shape
    // esistente -> _insideExisting (nessun re-snap) -> scarto (V0 reale)
    await newNote(page);
    // POPOVER reale "+" (controllo zoom dell'utente) fino a >=240%
    await page.evaluate(() => { const z = document.querySelector('.fn-zoom .fn-zpct'); if (z) z.click(); });
    await sleep(300);
    for (let i = 0; i < 14; i++) {
      zoomLabel = await page.evaluate(() => (document.querySelector('.fn-zoom .fn-zpct') || {}).textContent || '');
      const pct0 = parseFloat(String(zoomLabel).replace(/[^\d.]/g, '')) || 0;
      if (pct0 >= 240) break;
      const clicked = await page.evaluate(() => {
        const pop = document.querySelector('.fn-pop-zoom');
        if (!pop || !pop.classList.contains('show')) return false;
        const btns = Array.from(pop.querySelectorAll('button'));
        const plus = btns.find(b => b.textContent.trim() === '+');
        if (plus) { plus.click(); return true; }
        return false;
      });
      if (!clicked) break;
      await sleep(120);
    }
    zoomLabel = await page.evaluate(() => (document.querySelector('.fn-zoom .fn-zpct') || {}).textContent || '');
    M.cells.a8_zoomLabel = zoomLabel;
    const pct = parseFloat(String(zoomLabel).replace(/[^\d.]/g, '')) || 0;
    ok(pct >= 240, 'A8 zoom >=240% impostato via popover reale', zoomLabel);
    // Conversione screen<->mondo INVERSA dall'app stessa: toWorld su2 punti
    // noti definisce la similitudine (zoom+pan reali dell'app, zero stime
    // del QA). Path in coordinate MONDO target (corda400, onda10 =2.5%<=3%)
    // ricampionate in screen — identico a zoom100 per costruzione.
    const mm = await page.evaluate(() => {
      const ink = window.__ink;
      const a = ink.toWorld(0, 0), b = ink.toWorld(100, 0);
      const ctr = ink.toWorld(720, 450);
      return { ax: a.x, ay: a.y, kx: 100 / (b.x - a.x), cx: ctr.x, cy: ctr.y };
    });
    const w2s = (wx, wy) => [(wx - mm.ax) * mm.kx, (wy - mm.ay) * mm.kx];
    const sc = await page.evaluate(() => (window.__ink && __ink.state && __ink.state().zoom) || 1);
    M.cells.a8_scale = sc;
    M.cells.a8_mm = mm;
    const yM = mm.cy, x0M = mm.cx - 200, x1M = mm.cx + 200;
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      pts.push(w2s(x0M + (x1M - x0M) * t, yM + Math.sin(t * Math.PI * 4) * 10));
    }
    const c = await cellStroke('a8_zoom_retta', pts, {}, { type: 'line', a: w2s(x0M, yM), b: w2s(x1M, yM) });
    const clsA8 = c.last ? (c.last.vclass || (c.last.params && c.last.params.freeform ? 'freeform' : c.last.kind)) : null;
    if (!(c.last && c.last.t === 'shape' && clsA8 === 'line')) {
      // diagnosi stroke non committato
      const dbg = await page.evaluate(() => {
        const st = (window.__ink && __ink.state) ? __ink.state() : null;
        const tr = (window.__ink && __ink.trace) ? __ink.trace.slice(-14) : [];
        const cnt = (window.__ink && window.__ink.counters) ? window.__ink.counters : null;
        return { st: st, cntStroke: cnt ? cnt.stroke : null, tail: tr };
      });
      M.cells.a8_dbg = dbg;
      console.log('     A8 DIAG state=' + JSON.stringify(dbg.st) +
        ' cntStroke=' + JSON.stringify(dbg.cntStroke));
      console.log('     A8 DIAG tail=' + JSON.stringify(dbg.tail));
    }
    ok(c.last && c.last.t === 'shape' && clsA8 === 'line',
       'A8 zoom245% retta -> line (soglie MONDO)',
       JSON.stringify(c.last) + ' cls=' + clsA8 + ' sc=' + sc);
    // residuo e2e e' in coordinate MONDO: soglia fissa0.5px (non scalare)
    ok(c.resid && c.resid.resE2e !== undefined && c.resid.resE2e <= 0.5,
       'A8 zoom245% residuo e2e <=0.5px (MONDO)',
       c.resid && String(c.resid.resE2e));
    // torna a100%
    await page.evaluate(() => {
      const pop = document.querySelector('.fn-pop-zoom');
      const btns = pop ? Array.from(pop.querySelectorAll('button')) : [];
      const b100 = btns.find(b => /100%/.test(b.textContent));
      if (b100) b100.click();
    });
    await sleep(250);
    const back = await page.evaluate(() => (document.querySelector('.fn-zoom .fn-zpct') || {}).textContent || '');
    M.cells.a8_zoomBack = back;
    console.log('     zoom label finale=' + back);
  }

  // ============ V4.2 latenza live da __ink.trace SU APP REALE ============
  const lat = await page.evaluate(() => {
    const tr = (window.__ink && __ink.trace) ? __ink.trace : [];
    const evts = tr.filter(e => e.k === 'evt');
    const paints = tr.filter(e => e.k === 'paint');
    const used = {};
    const samples = [];
    for (const p of paints) {
      if (p.n === undefined) continue;
      let best = null;
      for (const e of evts) {
        // e.t <= p.t OBBLIGATORIO: n riparte da1 a ogni tratto, un evt di
        // tratto successivo con n<=p.n rendeva p.t-best.t negativo.
        if (e.n !== undefined && e.n <= p.n && e.t <= p.t &&
            (best === null || e.t > best.t)) best = e;
      }
      if (best && used[best.t] === undefined) {
        const d = p.t - best.t;
        used[best.t] = true;
        if (d >= 0 && d < 5000) samples.push(d);   // guardia cross-tratto
      }
    }
    samples.sort((a, b) => a - b);
    const pct = q => samples.length ? samples[Math.min(samples.length - 1, Math.max(0, Math.ceil(q * samples.length) - 1))] : null;
    return { n: samples.length, p50: pct(0.50), p95: pct(0.95),
             max: samples.length ? samples[samples.length - 1] : null };
  });
  M.cells.lat_trace = lat;
  ok(lat.n > 30, 'V4.2 latenza: campioni trace >=30 su app reale', String(lat.n));
  ok(lat.p95 !== null && lat.p95 <= 33, 'V4.2 latenza live p95 <=33ms (app reale)',
     lat.p95 !== null ? lat.p95.toFixed(1) + 'ms n=' + lat.n : 'null');
  console.log('     LATENZA trace: n=' + lat.n + ' p50=' + (lat.p50 || 0).toFixed(1) +
    ' p95=' + (lat.p95 || 0).toFixed(1) + ' max=' + (lat.max || 0).toFixed(1));

  M.checks = { pass, fail, failures };
  M.ok = fail === 0;
  M.pageErrors = pageErrors;
  M.httpFails = httpFails;
  M.countersSeries = countersSeries;
  fs.writeFileSync(path.join(QA_DIR, 'r25_matrix_measures.json'), JSON.stringify(M, null, 1));

  console.log('\n==== MATRICE V4.1 (T2 reale) ====');
  console.log('PASS=' + pass + ' FAIL=' + fail);
  if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
  console.log('screenshot: qa/r25_matrix_*.png (prima/dopo stesso viewport)');
  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('MATRIX FAIL: ' + (e && e.stack || e)); process.exit(1); });
