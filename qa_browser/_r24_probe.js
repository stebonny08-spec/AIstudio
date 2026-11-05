'use strict';
/* qa\_r24_probe.js - sonda diagnostica R0: perche' il modulo notes non
   si apre nella pagina REALE index.html (servita via http). Solo log. */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'web_frontend', 'html');
const PORT = 8891;
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
  page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 220)); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => !!(window.App && document.getElementById('homeView') && !document.getElementById('homeView').classList.contains('hidden')));
    if (ok) break;
    await sleep(250);
  }
  await page.evaluate(() => App.go('notes'));
  await sleep(3500);
  const info = await page.evaluate(() => {
    const mv = document.getElementById('moduleView');
    return {
      mvHidden: mv ? mv.classList.contains('hidden') : 'nomv',
      mvLen: mv ? mv.innerHTML.length : -1,
      mvHead: mv ? mv.innerHTML.slice(0, 700) : '',
      pill: !!document.querySelector('.fn-pill-left'),
      canvasCount: document.querySelectorAll('canvas').length,
      current: App.current
    };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 2400));
  console.log('ERRS(' + errs.length + '): ' + JSON.stringify(errs.slice(0, 12), null, 1));
  await browser.close();
  srv.close();
  process.exit(0);
})().catch(e => { console.error('FAIL ' + e); process.exit(1); });
