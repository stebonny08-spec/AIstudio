'use strict';
/* qa_browser/qaR24_formula.js — cella matrice R4.2: formula INLINE renderizzata
   nella preview Fonti su APP REALE (index.html servita, catena ?v=).
   Flusso noto: Nuova nota -> Crea nota -> editor -> inietta markdown nello
   store -> apre pannello Fonti -> seleziona la nota -> assert .katex + zero raw. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8899;
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
  page.on('pageerror', e => errs.push(String(e.message)));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => !!(window.App && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ok) break; await sleep(250);
  }
  await page.evaluate(() => {
    if (!window.pywebview && window.StudyStore) {
      const orig = StudyStore.listSubjects.bind(StudyStore);
      StudyStore.listSubjects = () => Promise.race([Promise.resolve().then(() => orig()), new Promise(r => setTimeout(() => r([]), 1500))]).then(v => v || []);
      window.__patchListSubjects = true;
    }
    App.go('notes');
  });
  // --- flusso noto: Nuova nota -> Crea nota -> editor ---
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /Nuova nota/.test(b.textContent || '')));
    if (c) break; await sleep(300);
  }
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /Nuova nota/.test(x.textContent || '')); if (b) b.click(); });
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => !!Array.from(document.querySelectorAll('#moduleView button')).find(b => /Crea nota/.test(b.textContent || '')));
    if (c) break; await sleep(300);
  }
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#moduleView button')).find(x => /Crea nota/.test(x.textContent || '')); if (b) b.click(); });
  let inEditor = false;
  for (let i = 0; i < 96; i++) {
    inEditor = await page.evaluate(() => !!(document.querySelector('.fn-pill-left') && document.querySelector('[data-fonti]')));
    if (inEditor) break; await sleep(500);
  }
  console.log('editor=' + inEditor);
  if (!inEditor) throw new Error('editor non aperto');
  // inietta markdown nella PRIMA nota dello store (quella appena creata)
  const inj = await page.evaluate(() => {
    try {
      const all = JSON.parse(localStorage.getItem('ns_items') || '[]');
      if (!all.length) return 'empty';
      all[0].title = 'Nota R24 Formula';
      all[0].content = '# R24\n\nInline $x^2 + \\Delta t$ e parentesi \\(y_i + \\text{OK}\\).\n\nDisplay:\n\n$$\\sum_{i=1}^n x_i$$\n\n\\[\\int_0^1 f\\]';
      localStorage.setItem('ns_items', JSON.stringify(all));
      return 'ok:' + all[0].id;
    } catch (e) { return String(e); }
  });
  console.log('inject=' + inj);
  await sleep(400);
  // apre pannello Fonti e seleziona la nota
  await page.evaluate(() => { const b = document.querySelector('[data-fonti]'); if (b) b.click(); });
  await sleep(1000);
  const picked = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    if (!p) return 'no panel';
    const items = Array.from(p.querySelectorAll('.fp21-item'));
    let target = items.find(i => /Nota R24 Formula/.test(i.textContent || ''));
    if (!target && items.length) target = items[0];
    if (!target) return 'no items(' + items.length + ')';
    target.click();
    return 'clicked:' + (target.textContent || '').slice(0, 30);
  });
  console.log('pick=' + picked);
  await sleep(1500);
  const res = await page.evaluate(() => {
    const p = document.querySelector('.fp21-root');
    const body = p ? p.querySelector('.fp21-pbody') : null;
    if (!body) return { err: 'no pbody' };
    let katex = body.querySelectorAll('.katex').length;
    const texts = [];
    const walk = n => {
      if (n.nodeType === 3) {
        const t = n.textContent || '';
        const insideKatex = n.parentElement && n.parentElement.closest && n.parentElement.closest('.katex');
        if (t && !insideKatex) texts.push(t);
      }
      if (n.childNodes) n.childNodes.forEach(walk);
    };
    walk(body);
    const raw = texts.filter(t => /\\Delta|\\text\b|\$\$|\\\(|\\\)|\\\[|\\\]/.test(t));
    return { katex, rawCount: raw.length, rawSample: raw.slice(0, 2), preview: (body.textContent || '').slice(0, 140) };
  });
  console.log(JSON.stringify(res));
  await page.screenshot({ path: path.join(QA_DIR, 'r24_formula_dopo.png') });
  const ok = res.katex >= 3 && res.rawCount === 0 && errs.length === 0;
  const out = { ts: new Date().toISOString(), tool: 'app reale index.html servita (catena ?v=), patch ambiente listSubjects', katex: res.katex, rawCount: res.rawCount, rawSample: res.rawSample, preview: res.preview, pageErrors: errs, ok };
  fs.writeFileSync(path.join(QA_DIR, 'r24_formula_measures.json'), JSON.stringify(out, null, 1));
  console.log('RISULTATO qaR24_formula: katex=' + res.katex + ' raw=' + res.rawCount + ' pageerr=' + errs.length + ' -> ' + (ok ? 'OK' : 'FAIL'));
  await browser.close(); srv.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL ' + (e.stack || e)); process.exit(1); });
