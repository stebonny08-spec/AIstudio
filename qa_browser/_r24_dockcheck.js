'use strict';
/* qa_browser\_r24_dockcheck.js - diagnosi MINIMALE coordinatore: il fix dock
   di fonti_panel funziona sulla pagina reale? Solo log, nessuna correzione. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8895;
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
(async () => {
  const srv = await staticServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => !!(window.App && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ok) break; await sleep(250);
  }
  await page.evaluate(() => {
    if (!window.pywebview && window.StudyStore) {
      const orig = StudyStore.listSubjects.bind(StudyStore);
      StudyStore.listSubjects = () => Promise.race([Promise.resolve().then(() => orig()), new Promise(r => setTimeout(() => r([]), 1500))]).then(v => v || []);
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
  await page.evaluate(() => { const b = document.querySelector('[data-fonti]'); if (b) b.click(); });
  await sleep(700);
  const m = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    const pill = document.querySelector('.fn-pill-left');
    if (!p || !pill) return { err: 'missing', p: !!p, pill: !!pill };
    const pr = p.getBoundingClientRect(), lr = pill.getBoundingClientRect();
    const cs = getComputedStyle(p);
    const ox = Math.max(0, Math.min(pr.right, lr.right) - Math.max(pr.left, lr.left));
    const oy = Math.max(0, Math.min(pr.bottom, lr.bottom) - Math.max(pr.top, lr.top));
    const hits = [];
    pill.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      let n = h, ok = false; while (n) { if (n === b) { ok = true; break; } n = n.parentElement; }
      hits.push(ok);
    });
    const ins = p.querySelector('.fp21-insert');
    const prev = p.querySelector('.fp21-ptitle');
    return {
      panel: { pos: cs.position, top: Math.round(pr.top), left: Math.round(pr.left), z: cs.zIndex, h: Math.round(pr.height), w: Math.round(pr.width) },
      pill: { top: Math.round(lr.top), bottom: Math.round(lr.bottom), left: Math.round(lr.left), z: getComputedStyle(pill).zIndex },
      overlapPx2: Math.round(ox * oy),
      expectedTop: Math.round(lr.bottom + 8),
      hitOk: hits.filter(Boolean).length + '/' + hits.length,
      deadSpace: ins ? Math.round(pr.bottom - ins.getBoundingClientRect().bottom) : null,
      typo: prev ? /l anteprima/.test(prev.textContent) : null,
      typoFixed: prev ? /l\u2019anteprima|l'anteprima/.test(prev.textContent) : null
    };
  });
  console.log(JSON.stringify(m, null, 1));
  console.log('pageerrors=' + errs.length);
  await page.screenshot({ path: path.join(ROOT, 'qa', 'r24_dockcheck.png') });
  await browser.close(); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
