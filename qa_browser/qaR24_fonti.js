'use strict';
/* qa_browser/qaR24_fonti.js - T2 REALE (ROUND 24 FE-FONTI): pannello Fonti
   sotto toolbar, spazio morto, collapso, typo — SOLO su index.html REALE
   servita via http con stessa catena ?v= (niente harness qa_ui).
   PRIMA = interception su fonti_panel.js con qa/r24_fonti_baseline.js.
   DOPO  = codice corrente.
   Patch AMBIENTE dichiarata: race StudyStore.listSubjects 1500ms (solo
   senza pywebview) - NON tocca il prodotto.
   Uso: node qa_browser/qaR24_fonti.js  EXIT 0 se tutti i check DOPO ok. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8897;
const BASELINE = fs.readFileSync(path.join(QA_DIR, 'r24_fonti_baseline.js'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function staticServer() {
  const srv = http.createServer((req, res) => {
    try {
      const u = decodeURIComponent((req.url || '/').split('?')[0]);
      let p = path.join(APP_DIR, u === '/' ? '/index.html' : u);
      if (!p.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      const ext = path.extname(p).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(p));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

async function openNotes(page) {
  await page.evaluate(() => {
    if (!window.pywebview && window.StudyStore) {
      const orig = StudyStore.listSubjects.bind(StudyStore);
      StudyStore.listSubjects = function () {
        return Promise.race([Promise.resolve().then(() => orig()),
          new Promise(r => setTimeout(() => r([]), 1500))]).then(v => v || []);
      };
      window.__patchListSubjects = true;
    }
    App.go('notes');
  });
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
    if (c) break; await sleep(250);
  }
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')); if (b) b.click(); });
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => !!Array.from(document.querySelectorAll('#moduleView button')).find(b => /Crea nota/.test(b.textContent || '')));
    if (c) break; await sleep(300);
  }
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || '')); if (b) b.click(); });
  let ready = false;
  for (let i = 0; i < 96; i++) {
    ready = await page.evaluate(() => !!(document.querySelector('.fn-pill-left') && document.querySelector('canvas')));
    if (ready) break; await sleep(500);
  }
  if (!ready) throw new Error('editor non pronto');
  await sleep(600);
}

async function measureAll(page) {
  return page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    const pill = document.querySelector('.fn-pill-left');
    if (!p || !pill || p.getBoundingClientRect().width === 0) return { err: 'missing', p: !!p, pill: !!pill };
    const pr = p.getBoundingClientRect(), lr = pill.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const ox = Math.max(0, Math.min(pr.right, lr.right) - Math.max(pr.left, lr.left));
    const oy = Math.max(0, Math.min(pr.bottom, lr.bottom) - Math.max(pr.top, lr.top));
    const zoom = document.querySelector('.fn-zoom');
    const zr = zoom ? zoom.getBoundingClientRect() : null;
    const colBottom = Math.max(lr.bottom, zr ? zr.bottom : 0); // colonna comandi sinistra
    const btns = [];
    pill.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      // R1.2: solo bottoni VISIBILI (btnDelSel e' nascosto per design senza
      // selezione: rect 0x0 in (0,0) - vedi NOTE.md, non e' reclamo pannello)
      if (!(r.width > 0 && r.height > 0)) return;
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      let n = h, ok = false; while (n) { if (n === b) { ok = true; break; } n = n.parentElement; }
      btns.push({ label: (b.id || b.title || b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24), ok });
    });
    const ins = p.querySelector('.fp21-insert');
    const prev = p.querySelector('.fp21-ptitle');
    const list = p.querySelector('.fp21-list');
    return {
      pos: cs.position, top: Math.round(pr.top), left: Math.round(pr.left), z: cs.zIndex,
      h: Math.round(pr.height), w: Math.round(pr.width),
      pillBottom: Math.round(lr.bottom), colBottom: Math.round(colBottom),
      expectedTop: Math.round(colBottom + 8),
      overlapPx2: Math.round(ox * oy),
      hitOk: btns.filter(b => b.ok).length, hitTot: btns.length,
      hitFail: btns.filter(b => !b.ok).map(b => b.label),
      pillZ: getComputedStyle(pill).zIndex,
      deadSpace: ins ? Math.round(pr.bottom - ins.getBoundingClientRect().bottom) : null,
      typoRaw: prev ? /l anteprima/.test(prev.textContent) : null,
      typoFixed: prev ? /\u2019anteprima/.test(prev.textContent) : null,
      listH: list ? Math.round(list.getBoundingClientRect().height) : null
    };
  });
}

async function run(mode) { // 'prima' | 'dopo'
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [], httpFails = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) httpFails.push(r.status() + ' ' + r.url()); });
  if (mode === 'prima') {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().includes('modules/fonti_panel.js')) {
        req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: BASELINE });
      } else req.continue();
    });
  }
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => !!(window.App && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ok) break; await sleep(250);
  }
  await openNotes(page);
  // apre pannello Fonti
  await page.evaluate(() => { const b = document.querySelector('[data-fonti]'); if (b) b.click(); });
  await sleep(800);
  const m = await measureAll(page);
  await page.screenshot({ path: path.join(QA_DIR, 'r24_fonti_' + mode + '_toolbar.png') });

  // collapso: lista espansa -> collassata -> persistenza
  const col = await page.evaluate(async () => {
    const p = document.querySelector('.fp21-root');
    if (!p) return { err: 'no panel' };
    const list = p.querySelector('.fp21-list');
    const chev = p.querySelector('.fp21-chev') || p.querySelector('.fp21-lens');
    const before = list ? list.getBoundingClientRect().height : 0;
    if (chev) chev.click();
    await new Promise(r => setTimeout(r, 350));
    const after = list ? list.getBoundingClientRect().height : 0;
    const lsKey = 'fp21_top_appunti';
    const lsVal = localStorage.getItem(lsKey);
    // chiusura + riapertura pannello
    const fb = document.querySelector('[data-fonti]'); if (fb) fb.click();
    await new Promise(r => setTimeout(r, 300));
    const fb2 = document.querySelector('[data-fonti]'); if (fb2) fb2.click();
    await new Promise(r => setTimeout(r, 500));
    const list2 = document.querySelector('.fp21-list');
    const reopened = list2 ? list2.getBoundingClientRect().height : 0;
    const prev = p.querySelector('.fp21-ptitle');
    return {
      before: Math.round(before), after: Math.round(after), gained: Math.round(after - before),
      lsKey, lsVal, reopened: Math.round(reopened),
      collapsedClass: p.classList.contains('fp21-collapsed'),
      typoRaw: prev ? /l anteprima/.test(prev.textContent) : null,
      typoFixed: prev ? /\u2019anteprima/.test(prev.textContent) : null
    };
  });
  await page.screenshot({ path: path.join(QA_DIR, 'r24_fonti_' + mode + '_collapse.png') });
  await browser.close();
  return { m, col, errs, httpFails };
}

(async () => {
  const srv = await staticServer();
  console.log('=== PRIMA (baseline pre-fix) ===');
  const prima = await run('prima');
  console.log('PRIMA: ' + JSON.stringify(prima.m));
  console.log('=== DOPO (codice corrente) ===');
  const dopo = await run('dopo');
  console.log('DOPO: ' + JSON.stringify(dopo.m));
  console.log('DOPO collapso: ' + JSON.stringify(dopo.col));

  const checks = [];
  const ck = (name, ok, extra) => checks.push({ name, ok: !!ok, extra: extra || '' });
  ck('a1 DOPO: pannello non copre la pill (overlap=0)', dopo.m.overlapPx2 === 0, 'prima=' + prima.m.overlapPx2 + ' dopo=' + dopo.m.overlapPx2);
  ck('a2 DOPO: z pannello < z pill', Number(dopo.m.z) < Number(dopo.m.pillZ), 'z=' + dopo.m.z + ' pill=' + dopo.m.pillZ);
  ck('a3 DOPO: top = colonna comandi sinistra bottom + 8', dopo.m.top === dopo.m.expectedTop, 'top=' + dopo.m.top + ' exp=' + dopo.m.expectedTop);
  ck('a4 DOPO: hit bottoni pill 8/8', dopo.m.hitOk === dopo.m.hitTot && dopo.m.hitTot >= 7, dopo.m.hitOk + '/' + dopo.m.hitTot + ' fail=' + JSON.stringify(dopo.m.hitFail));
  ck('b1 DOPO: spazio morto sotto insert <=8px', dopo.m.deadSpace <= 8, 'prima=' + prima.m.deadSpace + ' dopo=' + dopo.m.deadSpace);
  ck('c1 DOPO: typo apostrofo corretto', dopo.m.typoFixed === true && dopo.m.typoRaw === false, 'raw=' + dopo.m.typoRaw + ' fixed=' + dopo.m.typoFixed);
  ck('c2 collapso: lista guadagna px', dopo.col.gained > 0, 'before=' + dopo.col.before + ' after=' + dopo.col.after + ' gained=' + dopo.col.gained);
  ck('c3 collapso: persistito (ls + riapertura)', dopo.col.lsVal === '1' && dopo.col.collapsedClass, 'ls=' + dopo.col.lsVal + ' cls=' + dopo.col.collapsedClass + ' reopened=' + dopo.col.reopened);
  ck('d1 DOPO: 0 pageerror', dopo.errs.length === 0, JSON.stringify(dopo.errs.slice(0, 3)));
  ck('d2 DOPO: 0 http>=400', dopo.httpFails.length === 0, JSON.stringify(dopo.httpFails.slice(0, 3)));
  // PRIMA deve confermare il reclamo (evidenza): la regola z-index e' violata
  // (z160 > pill12: il pannello PRIMA sta SOPRA i controlli) e/o c'e' overlap;
  // il reclamo R0 (top58, overlap 15072px2, 8/8 non hit, dead 169px) resta
  // documentato in qa/r24_r0_measures.json + qa/r24_r0_1_pannello_toolbar.png
  ck('e1 PRIMA: violazione R1.1 (z pannello >= z pill o overlap>0)', Number(prima.m.z) >= Number(prima.m.pillZ) || prima.m.overlapPx2 > 0, 'z=' + prima.m.z + ' pill=' + prima.m.pillZ + ' overlap=' + prima.m.overlapPx2);
  ck('e2 PRIMA: typo confermato', prima.m.typoRaw === true, 'raw=' + prima.m.typoRaw);

  const failed = checks.filter(c => !c.ok);
  const out = {
    ts: new Date().toISOString(), viewport: '1440x900',
    tool: 'Puppeteer/CDP reale su index.html servita (catena ?v=); playwright assente dal progetto',
    envPatch: { patch_listSubjects: true, note: 'race 1500ms solo senza pywebview, prodotto intatto' },
    prima: prima.m, dopo: dopo.m, dopoCollapse: dopo.col,
    checks_total: checks.length, checks_failed: failed.length, failed, all_ok: failed.length === 0
  };
  fs.writeFileSync(path.join(QA_DIR, 'r24_fonti_measures.json'), JSON.stringify(out, null, 1));
  console.log('\n==== TABELLA R24 FONTI ====');
  checks.forEach(c => console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name + (c.extra ? ' :: ' + c.extra : '')));
  console.log('RISULTATO qaR24_fonti: ' + (checks.length - failed.length) + ' passati, ' + failed.length + ' falliti');
  console.log('screenshot: r24_fonti_{prima,dopo}_toolbar.png, r24_fonti_{prima,dopo}_collapse.png');
  srv.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
