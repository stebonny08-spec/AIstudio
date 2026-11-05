'use strict';
/* qa_browser/qaR24_r0_repro.js - R0 (ROUND 24): RIPRODUZIONE REALE, bloccante.
   Apre la PAGINA REALE dell'app: index.html servita via http con la STESSA
   catena ?v= del BUILD (niente harness qa_ui, niente jsdom), apre il modulo
   Appunti via App.go('notes'), riproduce lo screenshot utente 24:
     - pannello Fonti aperto + toolbar sinistra (visibile o coperta?)
     - disegna a mano (eventi pointer REALI via CDP mouse) una retta
       ondulata e un arco ondulato RILACCIANDO senza pausa
     - contatori ink letti da window.__ink.objects()/state() dopo rilascio
     - spazio morto sotto "Inserisci nella nota"
     - typo "l anteprima"
   Output: qa/r24_r0_measures.json + qa/r24_r0_*.png + tabella stdout.
   NESSUNA correzione: solo misura (le fix arrivano dopo, in altri scope).
   Uso: node qa_browser/qaR24_r0_repro.js  [porta default 8877] */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8877;
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
  console.log('BROWSER OK: ' + (await browser.version()));
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));

  console.log('OPEN ' + BASE + '/index.html (stessa catena ?v= del BUILD)');
  const reqFails = [];
  page.on('response', r => { if (r.status() >= 400) reqFails.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await page.evaluate(() => !!(window.App && typeof App.go === 'function' && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('home non pronta');
  console.log('HOME READY');

  // ---- PATCH AMBIENTE (dichiarata, NON prodotto): nel browser puro senza
  // pywebview store.js usa il fallback localStorage (documentato NOTE.md),
  // ma StudyStore.listSubjects() pendente blocca renderChooser -> l'editor
  // non parte. In app reale con pywebview listSubjects funziona. La patch
  // vale SOLO se pywebview e' assente e non cambia nessun codice moduli.
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
  // ---- apre modulo Appunti via API reale + editor (Nuova nota) ----
  await page.evaluate(() => App.go('notes'));
  // la vista reale mostra la LISTA note con "Nuova nota": serve entrare
  // nell'editor (pill + canvas) come farebbe l'utente
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
    console.log('NUOVA NOTA cliccato');
  } else {
    console.log('WARN: bottone "Nuova nota" non trovato (già in editor?)');
  }
  // chooser: poll "Crea nota" (defaultDoc) per entrare nell'editor reale
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
  if (!created) {
    const dump = await page.evaluate(() => (document.getElementById('moduleView') || {}).innerHTML.slice(0, 900));
    console.log('WARN: Crea nota non trovato; DOM=' + dump);
  }
  console.log('CREA NOTA cliccato=' + created + ' patch_listSubjects=' +
    await page.evaluate(() => !!window.__r0patch_listSubjects));
  let notesReady = false;
  // READY del fallback store attende fino a 20s senza pywebview (store.js):
  // il polling deve coprire quell'attesa reale
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
  console.log('NOTES READY');
  await sleep(600);

  const M = { ts: new Date().toISOString(), viewport: '1440x900', pageErrors: [] };

  // ---- 1. pannello Fonti aperto ----
  const fontiBtn = await page.$('[data-fonti]');
  if (fontiBtn) await fontiBtn.click(); else console.log('WARN: nessun [data-fonti]');
  await sleep(500);
  M.panelOpen = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return { exists: false };
    const cs = getComputedStyle(p);
    return { exists: true, shown: p.classList.contains('show') || cs.display !== 'none', rect: p.getBoundingClientRect().toJSON(), pos: cs.position, z: cs.zIndex };
  });
  console.log('PANEL: ' + JSON.stringify(M.panelOpen));

  // ---- 2. toolbar: visibile/coprerta con pannello aperto ----
  M.toolbar = await page.evaluate(() => {
    const pill = document.querySelector('.fn-pill-left');
    if (!pill) return { exists: false };
    const pr = pill.getBoundingClientRect();
    const out = { exists: true, rect: pr.toJSON(), z: getComputedStyle(pill).zIndex, buttons: [] };
    const names = [];
    pill.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      let inBtn = false;
      let n = hit;
      while (n) { if (n === b) { inBtn = true; break; } n = n.parentElement; }
      const lbl = (b.id || b.dataset.fonti !== undefined && 'data-fonti' || b.title || b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30) || ('btn#' + (b.id || '?'));
      names.push({ label: lbl, center: [Math.round(cx), Math.round(cy)], visible: r.width > 0 && r.height > 0, hitOk: inBtn, hit: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : 'null' });
    });
    out.buttons = names;
    // overlap pannello vs pill
    const p = document.querySelector('.fp21-root');
    if (p) {
      const q = p.getBoundingClientRect();
      const ox = Math.max(0, Math.min(pr.right, q.right) - Math.max(pr.left, q.left));
      const oy = Math.max(0, Math.min(pr.bottom, q.bottom) - Math.max(pr.top, q.top));
      out.overlapPx2 = Math.round(ox * oy);
      const hitCenter = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
      out.pillCenterCovered = !!(hitCenter && (hitCenter.closest && hitCenter.closest('.fn-pill-left')));
      out.coveredBy = hitCenter ? (hitCenter.closest('.fp21-root') ? 'PANNELLO_FONTI' : (hitCenter.closest('.fn-pill-left') ? 'pill' : hitCenter.tagName)) : 'null';
    }
    return out;
  });
  console.log('TOOLBAR overlapPx2=' + M.toolbar.overlapPx2 + ' coveredBy=' + M.toolbar.coveredBy);
  M.toolbar.buttons.forEach(b => console.log('  btn ' + b.label + ' hitOk=' + b.hitOk + ' hit=' + b.hit));

  // screenshot PRIMA reclamo 24: viewport intera con toolbar + pannello
  await page.screenshot({ path: path.join(QA_DIR, 'r24_r0_1_pannello_toolbar.png') });

  // ---- 3. spazio morto sotto "Inserisci nella nota" + typo ----
  M.panel = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return null;
    const pr = p.getBoundingClientRect();
    const ins = p.querySelector('.fp21-insert');
    const list = p.querySelector('.fp21-list');
    const prev = p.querySelector('.fp21-preview');
    const body = p.textContent || '';
    const ir = ins ? ins.getBoundingClientRect() : null;
    const gapUnderInsert = ir ? Math.round(pr.bottom - ir.bottom) : null;
    return {
      panelH: Math.round(pr.height), panelW: Math.round(pr.width),
      insertBottom: ir ? Math.round(ir.bottom) : null,
      deadSpaceUnderInsertPx: gapUnderInsert,
      listH: list ? Math.round(list.getBoundingClientRect().height) : null,
      prevH: prev ? Math.round(prev.getBoundingClientRect().height) : null,
      typo_l_anteprima: /l anteprima/.test(body),
      typo_fix_present: /l\u2019anteprima|l'anteprima/.test(body),
      previewPlaceholder: (p.querySelector('.fp21-ptitle') || {}).textContent || ''
    };
  });
  console.log('PANEL metri: ' + JSON.stringify(M.panel));

  // ---- 4. disegno reale: retta ondulata, rilascio SENZA pausa ----
  const geom = await page.evaluate(() => {
    const c = document.querySelector('.nt-stage canvas') || document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const yc = geom.y + geom.h * 0.35;
  const x0 = geom.x + geom.w * 0.30, x1 = geom.x + geom.w * 0.62;
  // retta ondulata: 60 move con sinusoide ±10px, poi up SUBITO (gap ~10ms)
  await page.mouse.move(x0, yc);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    const t = i / 60;
    const x = x0 + (x1 - x0) * t;
    const y = yc + Math.sin(t * Math.PI * 4) * 10;
    await page.mouse.move(x, y);
    await sleep(8);
  }
  await page.mouse.up();            // rilascio SENZA pausa (~8ms)
  await sleep(700);                 // settle
  M.inkRetta = await page.evaluate(() => {
    const objs = (window.__ink && __ink.objects) ? __ink.objects() : [];
    const last = objs[objs.length - 1];
    return { n: objs.length, last: last ? { t: last.t, kind: last.kind || (last.params && last.params.kind) || null, npts: (last.pts || []).length } : null };
  });
  console.log('INK dopo retta: ' + JSON.stringify(M.inkRetta));
  await page.screenshot({ path: path.join(QA_DIR, 'r24_r0_2_retta_rilasciata.png') });

  // arco ondulato: semicerchio "a onde", rilascio senza pausa
  const ya = geom.y + geom.h * 0.68;
  const ax0 = geom.x + geom.w * 0.30, ax1 = geom.x + geom.w * 0.62;
  await page.mouse.move(ax0, ya + 40);
  await page.mouse.down();
  for (let i = 1; i <= 70; i++) {
    const t = i / 70;
    const ang = Math.PI * (1 - t);            // semicerchio
    const R = (ax1 - ax0) / 2;
    const x = (ax0 + ax1) / 2 + R * Math.cos(ang);
    const y = ya + 40 - Math.sin(ang) * 70 + Math.sin(t * Math.PI * 5) * 8; // onde
    await page.mouse.move(x, y);
    await sleep(8);
  }
  await page.mouse.up();
  await sleep(700);
  M.inkArco = await page.evaluate(() => {
    const objs = (window.__ink && __ink.objects) ? __ink.objects() : [];
    const last = objs[objs.length - 1];
    return { n: objs.length, last: last ? { t: last.t, kind: last.kind || (last.params && last.params.kind) || null, npts: (last.pts || []).length } : null };
  });
  console.log('INK dopo arco: ' + JSON.stringify(M.inkArco));
  await page.screenshot({ path: path.join(QA_DIR, 'r24_r0_3_arco_rilasciato.png') });

  // conteggi finali per classe (contatori "perfezionati" = t==='shape')
  M.counts = await page.evaluate(() => {
    const objs = (window.__ink && __ink.objects) ? __ink.objects() : [];
    const by = {};
    objs.forEach(o => { by[o.t] = (by[o.t] || 0) + 1; });
    const trace = (window.__ink && __ink.trace) ? __ink.trace.length : -1;
    return { byType: by, traceLen: trace, state: __ink.state ? __ink.state() : null };
  });
  console.log('COUNTS: ' + JSON.stringify(M.counts.byType));

  // screenshot con pannello aperto + tratti: elemento esatto del reclamo
  await page.screenshot({ path: path.join(QA_DIR, 'r24_r0_4_finale_viewport.png') });

  M.pageErrors = pageErrors;
  M.httpFails = reqFails;
  M.envPatch = { listSubjectsTimeoutRace: await page.evaluate(() => !!window.__r0patch_listSubjects), pywebview: await page.evaluate(() => typeof window.pywebview) };
  fs.writeFileSync(path.join(QA_DIR, 'r24_r0_measures.json'), JSON.stringify(M, null, 1));

  // ---- TABELLA R0.2 ----
  const toolbarCoperta = (M.toolbar.overlapPx2 > 0) ? 'SI' : 'NO';
  const btnCoperti = M.toolbar.buttons.filter(b => !b.hitOk).length;
  const perfRetta = (M.inkRetta.last && M.inkRetta.last.t === 'shape') ? 'SI (shape/' + M.inkRetta.last.kind + ')' : 'NO (t=' + (M.inkRetta.last ? M.inkRetta.last.t : '?') + ')';
  const perfArco = (M.inkArco.last && M.inkArco.last.t === 'shape') ? 'SI (shape/' + M.inkArco.last.kind + ')' : 'NO (t=' + (M.inkArco.last ? M.inkArco.last.t : '?') + ')';
  console.log('\n==== TABELLA R0 (riproduzione reale, NESSUNA correzione) ====');
  console.log('1. toolbar coperta dal pannello ........... ' + toolbarCoperta + ' (overlap ' + M.toolbar.overlapPx2 + ' px2; coveredBy=' + M.toolbar.coveredBy + '; bottoni non hit=' + btnCoperti + '/' + M.toolbar.buttons.length + ')');
  console.log('2. retta ondulata perfezionata al rilascio  ' + perfRetta);
  console.log('3. arco ondulato perfezionato al rilascio   ' + perfArco);
  console.log('4. contatori ink (byType) .................. ' + JSON.stringify(M.counts.byType));
  console.log('5. spazio morto sotto Inserisci ............ ' + (M.panel ? M.panel.deadSpaceUnderInsertPx + 'px (panelH=' + M.panel.panelH + ', list=' + M.panel.listH + ', prev=' + M.panel.prevH + ')' : 'n/d'));
  console.log('6. typo "l anteprima" presente ............. ' + (M.panel ? M.panel.typo_l_anteprima : 'n/d') + (M.panel && M.panel.typo_l_anteprima ? '  <- CONFERMATO' : ''));
  console.log('screenshot: qa/r24_r0_1_pannello_toolbar.png, r24_r0_2_retta_rilasciata.png, r24_r0_3_arco_rilasciato.png, r24_r0_4_finale_viewport.png');
  console.log('pageerrors: ' + pageErrors.length);
  console.log('http>=400: ' + JSON.stringify(reqFails.slice(0, 6)));
  fs.writeFileSync(path.join(QA_DIR, 'r24_r0_table.txt'),
    'toolbar_coperta=' + toolbarCoperta + ' overlap=' + M.toolbar.overlapPx2 + ' btn_non_hit=' + btnCoperti + '/' + M.toolbar.buttons.length + '\n' +
    'retta_perfezionata=' + perfRetta + '\n' + 'arco_perfezionato=' + perfArco + '\n' +
    'contatori=' + JSON.stringify(M.counts.byType) + '\n' +
    'dead_space=' + (M.panel ? M.panel.deadSpaceUnderInsertPx : 'n/d') + 'px\n' +
    'typo_l_anteprima=' + (M.panel ? M.panel.typo_l_anteprima : 'n/d') + '\n');

  await browser.close();
  srv.close();
  console.log('R0 DONE');
  process.exit(0);
})().catch(e => { console.error('R0 FAIL: ' + (e && e.stack || e)); process.exit(1); });
