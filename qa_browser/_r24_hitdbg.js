'use strict';
/* qa_browser\_r24_hitdbg.js - diagnosi: cosa copre "Elimina selezione" nella pill Appunti. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8898;
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
  await sleep(800);
  const dbg = await page.evaluate(() => {
    const pill = document.querySelector('.fn-pill-left');
    const out = [];
    pill.querySelectorAll('button').forEach(b => {
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const h = document.elementFromPoint(cx, cy);
      let n = h, ok = false; while (n) { if (n === b) { ok = true; break; } n = n.parentElement; }
      if (!ok) {
        out.push({
          label: (b.id || b.title || b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40),
          center: [cx, cy], rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          hit: h ? { tag: h.tagName, cls: String(h.className).slice(0, 60), vis: getComputedStyle(h).visibility, disp: getComputedStyle(h).display } : null,
          parentCls: String(b.parentElement.className).slice(0, 50),
          offsetParentCls: b.offsetParent ? String(b.offsetParent.className).slice(0, 60) : null
        });
      }
    });
    return out;
  });
  console.log(JSON.stringify(dbg, null, 1));
  await browser.close(); srv.close(); process.exit(0);
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
