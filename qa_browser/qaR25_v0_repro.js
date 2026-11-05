'use strict';
/* qa_browser/qaR25_v0_repro.js - V0/R0 (ROUND 24/25): RIPRODUZIONE REALE
   BLOCCANTE. Nessuna correzione prima di questa tabella.

   Pagina REALE index.html servita via http con la STESSA catena ?v= del
   BUILD (niente harness/jsdom). Patch AMBIENTE dichiarata: race
   StudyStore.listSubjects 1500ms SOLO se pywebview assente.

   R0.1 pannello Fonti aperto in Appunti -> screenshot toolbar sinistra
        visibile o coperta.
   R0.2 Otto tratti con eventi pointer REALI rilasciando SENZA pausa:
        retta ondulata, arco ondulato, S a due flessi, loop, C aperta,
        verticale ondulata, diagonale ondulata, retta+flick.
        Dopo OGNI tratto: contatori ink da window.__ink.counters + oggetto
        risultante (t/kind/npts). Screenshot canvas dopo ogni forma.
   R0.3 Tabella fallimenti confermati (nessuna fix).

   Output: qa/r25_v0_measures.json, qa/r25_v0_stroke_*.png,
           qa/r25_v0_table.txt
   Uso: node qa_browser/qaR25_v0_repro.js [porta default 8879] */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8879;
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

(async () => {
  const srv = await staticServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
  console.log('BROWSER OK: ' + (await browser.version()) + ' (puppeteer/CDP reale; playwright non nel progetto - dichiarato)');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const pageErrors = [], reqFails = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  page.on('response', r => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) reqFails.push(r.status() + ' ' + r.url()); });

  console.log('OPEN ' + BASE + '/index.html');
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('home non pronta');
  console.log('HOME READY');

  // ---- PATCH AMBIENTE dichiarata (solo senza pywebview) ----
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

  // ---- Appunti -> editor reale ----
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
  if (!notesReady) throw new Error('modulo notes non pronto');
  console.log('NOTES READY created=' + created + ' patch=' + await page.evaluate(() => !!window.__r0patch_listSubjects));
  await sleep(600);

  const M = { ts: new Date().toISOString(), viewport: '1440x900', pageErrors: [] };

  // ================= R0.1 pannello Fonti aperto =================
  const fontiBtn = await page.$('[data-fonti]');
  if (fontiBtn) await fontiBtn.click(); else console.log('WARN: nessun [data-fonti]');
  await sleep(500);
  M.panelOpen = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return { exists: false };
    const cs = getComputedStyle(p);
    return { exists: true, shown: p.classList.contains('show') || cs.display !== 'none', rect: p.getBoundingClientRect().toJSON(), pos: cs.position, z: cs.zIndex };
  });
  M.toolbar = await page.evaluate(() => {
    const pill = document.querySelector('.fn-pill-left');
    if (!pill) return { exists: false };
    const pr = pill.getBoundingClientRect();
    const out = { exists: true, rect: pr.toJSON(), z: getComputedStyle(pill).zIndex, buttons: [] };
    pill.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      let inBtn = false, n = hit;
      while (n) { if (n === b) { inBtn = true; break; } n = n.parentElement; }
      const lbl = (b.id || (b.dataset.fonti !== undefined ? 'data-fonti' : '') || b.title || b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30) || ('btn#' + (b.id || '?'));
      out.buttons.push({ label: lbl, center: [Math.round(cx), Math.round(cy)], visible: r.width > 0 && r.height > 0, hitOk: inBtn, hit: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : 'null' });
    });
    const p = document.querySelector('.fp21-root');
    if (p) {
      const q = p.getBoundingClientRect();
      const ox = Math.max(0, Math.min(pr.right, q.right) - Math.max(pr.left, q.left));
      const oy = Math.max(0, Math.min(pr.bottom, q.bottom) - Math.max(pr.top, q.top));
      out.overlapPx2 = Math.round(ox * oy);
      const hitCenter = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
      out.coveredBy = hitCenter ? (hitCenter.closest && hitCenter.closest('.fp21-root') ? 'PANNELLO_FONTI' : (hitCenter.closest && hitCenter.closest('.fn-pill-left') ? 'pill' : hitCenter.tagName)) : 'null';
    }
    return out;
  });
  console.log('R0.1 PANEL exists=' + M.panelOpen.exists + ' TOOLBAR overlapPx2=' + M.toolbar.overlapPx2 + ' coveredBy=' + M.toolbar.coveredBy);

  // spazio morto + typo (sempre da R0.3)
  M.panel = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return null;
    const pr = p.getBoundingClientRect();
    const ins = p.querySelector('.fp21-insert');
    const ir = ins ? ins.getBoundingClientRect() : null;
    const list = p.querySelector('.fp21-list');
    const prev = p.querySelector('.fp21-preview');
    const body = p.textContent || '';
    return {
      panelH: Math.round(pr.height), panelW: Math.round(pr.width),
      insertBottom: ir ? Math.round(ir.bottom) : null,
      deadSpaceUnderInsertPx: ir ? Math.round(pr.bottom - ir.bottom) : null,
      listH: list ? Math.round(list.getBoundingClientRect().height) : null,
      prevH: prev ? Math.round(prev.getBoundingClientRect().height) : null,
      typo_l_anteprima: /l anteprima/.test(body),
      typo_fix_present: /l\u2019anteprima|l'anteprima/.test(body),
      previewPlaceholder: (p.querySelector('.fp21-ptitle') || {}).textContent || ''
    };
  });
  // screenshot R0.1: toolbar sinistra COMPLETA + pannello nello stesso frame
  await page.screenshot({ path: path.join(QA_DIR, 'r25_v0_1_toolbar_pannello.png') });

  // ================= R0.2 otto tratti con pointer reali =================
  const geom = await page.evaluate(() => {
    const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  console.log('CANVAS geom=' + JSON.stringify(geom));

  async function readInk() {
    return page.evaluate(() => {
      const ink = window.__ink;
      const objs = (ink && ink.objects) ? ink.objects() : [];
      const last = objs[objs.length - 1];
      return {
        n: objs.length,
        last: last ? {
          t: last.t,
          kind: last.kind || (last.params && last.params.kind) || null,
          npts: (last.pts || []).length,
          paramsKeys: last.params ? Object.keys(last.params) : []
        } : null,
        counters: (ink && ink.counters) ? JSON.parse(JSON.stringify(ink.counters)) : null
      };
    });
  }

  // traccia un path: down -> move* -> up SENZA pausa (sleep solo fra move,
  // l'ultimo up arriva ~8ms dopo l'ultimo move = rilascio senza hold)
  async function draw(points, opts) {
    opts = opts || {};
    const gap = opts.gapMs || 7;
    await page.mouse.move(points[0][0], points[0][1]);
    await page.mouse.down();
    for (let i = 1; i < points.length; i++) {
      await page.mouse.move(points[i][0], points[i][1]);
      if (opts.sleep !== false) await sleep(gap);
    }
    if (opts.flick) {
      // flick finale: back-stroke veloce (2 move senza sleep = <5ms)
      const last = points[points.length - 1], prev = points[points.length - 2];
      const dx = last[0] - prev[0], dy = last[1] - prev[1];
      const L = Math.hypot(dx, dy) || 1;
      await page.mouse.move(last[0] - (dx / L) * 26, last[1] - (dy / L) * 26);
      await page.mouse.move(last[0] + (dx / L) * 4, last[1] + (dy / L) * 4);
    }
    await page.mouse.up();
  }

  const strokes = [];
  async function doStroke(name, points, opts) {
    const before = await readInk();
    await draw(points, opts);
    await sleep(750); // settle (>=120ms richiesto + margine)
    const after = await readInk();
    const rec = {
      name, pts: points.length,
      nBefore: before.n, nAfter: after.n,
      delta: after.n - before.n,
      last: after.last,
      counters: after.counters,
      countersNew: after.counters ? {
        strokes_live: after.counters.strokes_live,
        perfected_on_release: after.counters.perfected_on_release,
        swapped_pixels: after.counters.swapped_pixels,
        residual_px: after.counters.residual_px,
        classified: after.counters.classified
      } : null
    };
    strokes.push(rec);
    M[name] = rec;
    console.log('STROKE ' + name + ': delta=' + rec.delta + ' last=' + JSON.stringify(rec.last));
    const safe = name.replace(/[^a-z0-9_]/gi, '_');
    await page.screenshot({ path: path.join(QA_DIR, 'r25_v0_' + safe + '.png') });
    return rec;
  }

  const gx = geom.x, gy = geom.y, gw = geom.w, gh = geom.h;
  // ZONA LIBERA: pannello Fonti = x12-352 y150-450; toolbar/zoom = x<340 y<142.
  // Colonne in x>=480: NESSUN punto di disegno cade sul pannello/toolbar.
  const AX = gx + 480, BX = gx + 940;
  const rowY = i => gy + [170, 330, 530, 760][i];

  // 1) retta ondulata (sinusoide amp 10px) - rilascio senza pausa
  {
    const y = rowY(0), x0 = AX, x1 = AX + 320;
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 4) * 10]); }
    await doStroke('s1_retta_ondulata', pts);
  }
  // 2) arco ondulato (semicerchio + onde)
  {
    const y = rowY(0), x0 = BX, x1 = BX + 320;
    const R = (x1 - x0) / 2, cx = (x0 + x1) / 2, cy = y + 70;
    const pts = [];
    for (let i = 0; i <= 70; i++) { const t = i / 70, ang = Math.PI * (1 - t); pts.push([cx + R * Math.cos(ang), cy - Math.sin(ang) * 70 + Math.sin(t * Math.PI * 5) * 8]); }
    await doStroke('s2_arco_ondulato', pts);
  }
  // 3) S con due flessi (1.5 periodi di seno -> due cambi curvatura)
  {
    const y = rowY(1), x0 = AX, x1 = AX + 320;
    const pts = [];
    for (let i = 0; i <= 70; i++) { const t = i / 70; pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 3) * 42]); }
    await doStroke('s3_s_due_flessi', pts);
  }
  // 4) loop (spira auto-intersecante con coda)
  {
    const cx = BX + 60, cy = rowY(1), R = 46;
    const pts = [];
    for (let i = 0; i <= 110; i++) {
      const t = i / 110, ang = -Math.PI / 2 + t * Math.PI * 2.4; // giro e mezzo
      const r = R * (1 - t * 0.12);
      pts.push([cx + r * Math.cos(ang) + t * 40, cy + r * Math.sin(ang)]);
    }
    await doStroke('s4_loop', pts);
  }
  // 5) C aperta (arco ~240 gradi)
  {
    const cx = AX + 40, cy = rowY(2), R = 52;
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, ang = Math.PI * 0.70 + t * Math.PI * 1.34; pts.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]); }
    await doStroke('s5_c_aperta', pts);
  }
  // 6) verticale ondulata
  {
    const x = BX + 80, y0 = rowY(1) + 70, y1 = rowY(2) + 90;
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([x + Math.sin(t * Math.PI * 4) * 9, y0 + (y1 - y0) * t]); }
    await doStroke('s6_verticale_ondulata', pts);
  }
  // 7) diagonale ondulata
  {
    const x0 = AX, y0 = rowY(2) + 90, x1 = AX + 300, y1 = rowY(1) + 70;
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60; const nx = -(y1 - y0), ny = (x1 - x0); const nl = Math.hypot(nx, ny) || 1; const w = Math.sin(t * Math.PI * 4) * 8; pts.push([x0 + (x1 - x0) * t + (nx / nl) * w, y0 + (y1 - y0) * t + (ny / nl) * w]); }
    await doStroke('s7_diagonale_ondulata', pts);
  }
  // 8) retta + flick finale (freccia)
  {
    const y = rowY(3), x0 = BX, x1 = BX + 320;
    const pts = [];
    for (let i = 0; i <= 55; i++) { const t = i / 55; pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * 4) * 6]); }
    await doStroke('s8_retta_flick', pts, { flick: true });
  }

  // screenshot finale con pannello ancora aperto (elementi contestati nel frame)
  await page.screenshot({ path: path.join(QA_DIR, 'r25_v0_4_finale_viewport.png') });

  M.countsFinal = await page.evaluate(() => {
    const objs = (window.__ink && __ink.objects) ? __ink.objects() : [];
    const by = {};
    objs.forEach(o => { by[o.t + (o.kind ? '/' + o.kind : '')] = (by[o.t + (o.kind ? '/' + o.kind : '')] || 0) + 1; });
    return { by: by, traceLen: (window.__ink && __ink.trace) ? __ink.trace.length : -1, state: __ink.state ? __ink.state() : null };
  });
  console.log('COUNTS FINAL: ' + JSON.stringify(M.countsFinal.by));
  M.envPatch = { listSubjectsTimeoutRace: await page.evaluate(() => !!window.__r0patch_listSubjects), pywebview: await page.evaluate(() => typeof window.pywebview) };
  M.pageErrors = pageErrors;
  M.httpFails = reqFails;
  fs.writeFileSync(path.join(QA_DIR, 'r25_v0_measures.json'), JSON.stringify(M, null, 1));

  // ================= R0.3 TABELLA (nessuna correzione) =================
  const t = [];
  const toolbarCoperta = (M.toolbar.overlapPx2 > 0) ? 'SI' : 'NO';
  const btnNonHit = M.toolbar.buttons.filter(b => !b.hitOk).length;
  t.push('toolbar_coperta=' + toolbarCoperta + ' overlap=' + M.toolbar.overlapPx2 + 'px2 btn_non_hit=' + btnNonHit + '/' + M.toolbar.buttons.length + ' coveredBy=' + M.toolbar.coveredBy);
  const st = n => strokes.find(s => s.name === n);
  const perf = n => { const s = st(n); return s && s.last && s.last.t === 'shape' ? 'SI(shape/' + s.last.kind + ')' : (s && s.last ? 'NO(t=' + s.last.t + ')' : 'N/D'); };
  t.push('retta_perfezionata_al_rilascio=' + perf('s1_retta_ondulata'));
  t.push('arco_perfezionato_al_rilascio=' + perf('s2_arco_ondulato'));
  t.push('verticale=' + perf('s6_verticale_ondulata') + ' diagonale=' + perf('s7_diagonale_ondulata'));
  const s3 = st('s3_s_due_flessi'), s4 = st('s4_loop'), s5 = st('s5_c_aperta');
  const trat = (s, nome) => s && s.last ? (s.last.t === 'shape' ? 'SWAP→' + s.last.kind : 'RESTA_' + s.last.t) : 'N/D';
  t.push('S_due_flessi=' + trat(s3) + ' loop=' + trat(s4) + ' C_aperta=' + trat(s5) + ' (atteso V0: nessun snap forzato su S/loop/C - si classifica: freeform resta stroke curvo, C resta aperta)');
  const s8 = st('s8_retta_flick');
  t.push('retta_flick=' + (s8 && s8.last ? s8.last.t + '/' + (s8.last.kind || '?') : 'N/D') + ' (freccia attesa: t=shape kind=arrow)');
  const cFirst = st('s1_retta_ondulata');
  t.push('contatori_V0=' + (cFirst && cFirst.counters ? JSON.stringify(cFirst.counters) : 'NULL') );
  const cNew = cFirst && cFirst.countersNew;
  t.push('contatori_V0_nuovi_assenti=' + (cNew ? Object.entries(cNew).filter(([k, v]) => v === undefined).map(([k]) => k).join(',') || 'nessuno' : 'counters_null'));
  t.push('perfected_on_release=' + (cNew && cNew.perfected_on_release !== undefined ? cNew.perfected_on_release : 'ASSENTE') + ' dopo retta (atteso>=1 -> FAIL se 0/assente)');
  t.push('dead_space=' + (M.panel ? M.panel.deadSpaceUnderInsertPx : 'n/d') + 'px');
  t.push('typo_l_anteprima=' + (M.panel ? M.panel.typo_l_anteprima : 'n/d'));
  const table = t.join('\n') + '\n';
  console.log('\n==== TABELLA V0/R0 (riproduzione reale, NESSUNA correzione) ====\n' + table);
  fs.writeFileSync(path.join(QA_DIR, 'r25_v0_table.txt'), table);

  await browser.close();
  srv.close();
  console.log('V0 DONE pageerrors=' + pageErrors.length + ' http>=400=' + reqFails.length);
  process.exit(0);
})().catch(e => { console.error('V0 FAIL: ' + (e && e.stack || e)); process.exit(1); });
