'use strict';
/* qa_browser/qaR25_fonti_extra.js - V4.1 celle extra R1.4 su APP REALE:
   - px guadagnati dal collapso della riga ricerca (DOM reale);
   - persistenza fp21_top_appunti su RELOAD (riapertura pannello);
   - screenshot pannello aperto + toolbar (stesso viewport1440x900).
   Output: qa/r25_fonti_extra_measures.json + qa/r25_fonti_collapse.png */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = Number(process.argv[2]) || 8883;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const failures = [];
function ok(c, n, x) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; failures.push(n + (x ? ' | ' + x : '')); console.log('  FAIL  ' + n + (x ? ' | ' + x : '')); } }

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

async function boot(page) {
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
      window.__patch = true;
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
  await sleep(500);
}

async function openPanel(page) {
  const b = await page.$('[data-fonti]');
  if (b) await b.click();
  await sleep(500);
}

(async () => {
  const srv = await staticServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  const M = { ts: new Date().toISOString(), viewport: '1440x900' };

  await boot(page);
  await openPanel(page);

  // stato iniziale: ricerca aperta? lista height
  const st0 = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return null;
    const list = p.querySelector('.fp21-list');
    const search = p.querySelector('.fp21-search');
    const chev = p.querySelector('.fp21-chev');
    return { collapsed: p.classList.contains('fp21-collapsed'),
      listH: list ? Math.round(list.getBoundingClientRect().height) : null,
      searchVisible: search ? getComputedStyle(search).display !== 'none' : null,
      hasChev: !!chev,
      lsTop: localStorage.getItem('fp21_top_appunti') };
  });
  M.st0 = st0;
  console.log('st0=' + JSON.stringify(st0));

  if (st0 && !st0.collapsed && st0.hasChev) {
    // collassa via click reale sul chevron
    const gained = await page.evaluate(() => {
      const p = document.querySelector('.fp21-root');
      const list = p.querySelector('.fp21-list');
      const before = list ? Math.round(list.getBoundingClientRect().height) : 0;
      const chev = p.querySelector('.fp21-chev');
      if (chev) chev.click();
      return { before };
    });
    await sleep(350);
    const st1 = await page.evaluate(() => {
      const p = document.querySelector('.fp21-root');
      const list = p.querySelector('.fp21-list');
      const search = p.querySelector('.fp21-search');
      return { collapsed: p.classList.contains('fp21-collapsed'),
        listH: list ? Math.round(list.getBoundingClientRect().height) : null,
        searchHidden: search ? getComputedStyle(search).display === 'none' : null,
        lsTop: localStorage.getItem('fp21_top_appunti') };
    });
    M.gained = { before: gained.before, after: st1.listH, px: (st1.listH || 0) - (gained.before || 0) };
    M.st1 = st1;
    ok(st1.collapsed, 'R1.4 classe collapsed applicata al click reale');
    ok(st1.searchHidden, 'R1.4 riga ricerca nascosta (px guadagnati)');
    ok(M.gained.px > 0, 'R1.4 px guadagnati sulla lista (' + M.gained.px + ')', JSON.stringify(M.gained));
    ok(st1.lsTop === '1', 'R1.4 persistito fp21_top_appunti=1', String(st1.lsTop));
  } else if (st0 && st0.collapsed) {
    M.gained = { note: 'gia collassato da sessione precedente (persistenza gia dimostrata)', st0 };
    ok(st0.lsTop === '1', 'R1.4 persistito da sessione precedente fp21_top_appunti=1', String(st0.lsTop));
  }

  // screenshot pannello (collassato o meno) + toolbar nel frame
  await page.screenshot({ path: path.join(QA_DIR, 'r25_fonti_collapse.png') });

  // RELOAD: persistenza su riapertura
  await boot(page);
  await openPanel(page);
  const st2 = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return null;
    const list = p.querySelector('.fp21-list');
    return { collapsed: p.classList.contains('fp21-collapsed'),
      listH: list ? Math.round(list.getBoundingClientRect().height) : null,
      lsTop: localStorage.getItem('fp21_top_appunti'),
      dead: (() => { const ins = p.querySelector('.fp21-insert'); const pr = p.getBoundingClientRect();
        const ir = ins ? ins.getBoundingClientRect() : null; return ir ? Math.round(pr.bottom - ir.bottom) : null; })() };
  });
  M.st2_reload = st2;
  ok(st2 && st2.lsTop === '1', 'R1.4 persistenza SU RELOAD (fp21_top_appunti=1)', st2 && String(st2.lsTop));
  ok(st2 && st2.collapsed, 'R1.4 pannello riaperto ancora collassato', st2 && String(st2.collapsed));
  ok(st2 && st2.dead !== null && st2.dead <= 8, 'R1.3 dead <=8px anche collassato', st2 && String(st2.dead));
  await page.screenshot({ path: path.join(QA_DIR, 'r25_fonti_reload.png') });

  M.checks = { pass, fail, failures };
  M.ok = fail === 0;
  M.pageErrors = pageErrors;
  fs.writeFileSync(path.join(QA_DIR, 'r25_fonti_extra_measures.json'), JSON.stringify(M, null, 1));
  console.log('\nRISULTATO fonti_extra: ' + pass + ' passati, ' + fail + ' falliti');
  if (failures.length) console.log(' - ' + failures.join('\n - '));
  await browser.close();
  srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FONTI EXTRA FAIL: ' + (e && e.stack || e)); process.exit(1); });
