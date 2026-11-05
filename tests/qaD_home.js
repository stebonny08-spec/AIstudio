/* ============================================================
   tests/qaD_home.js — verifica blocco Home (D1 logo + D2 8a card).
   Prefisso qaD_home: NON confonde/ tocca tests/qaD_blockD.js
   (blocco Documenti, di altro ruolo).

   D1: logo vecchio ripristinato da git HEAD:web_frontend/html/index.html
       righe 386-392 (commit intro a4736ec, HEAD c30486d).
   D2: 8a card "Aggiungi materiali" in renderHome() che riapre #materialModal.

   Eseguire con: node tests/qaD_home.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'css', 'modules.css'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' -- ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' -- ' + extra : '')); }
}

/* points completi del polygon, copiati da git HEAD (riga 389) - NON riscritti a mano */
const STAR_POINTS = '50,2 53.4,41.7 68.4,31.6 58.3,46.6 98,50 58.3,53.4 68.4,68.4 53.4,58.3 50,98 46.6,58.3 31.6,68.4 41.7,53.4 2,50 41.7,46.6 31.6,31.6 46.6,41.7';

const iLock = IDX.indexOf('id="brandLockup"');
const iSide = IDX.indexOf('sidebar-title');
const headerBlock = (iLock >= 0)
    ? IDX.slice(iLock, iSide > iLock ? iSide : iLock + 1500)
    : '';

console.log('\n== D1: logo vecchio ripristinato (git HEAD righe 386-392) ==');
ok(iLock >= 0, 'index.html contiene id="brandLockup"');
ok(headerBlock.includes('class="logo-star"'), 'blocco header home usa svg.logo-star (non logo-mark)');
ok(headerBlock.includes('id="starGrad"'), 'gradiente id="starGrad" presente');
ok(headerBlock.includes('points="' + STAR_POINTS + '"'), 'polygon points copiato per intero da git HEAD');
ok(!headerBlock.includes('logo-mark'), 'nessun svg logo-mark nel blocco header home');
ok(!IDX.includes('logoGrad'), 'nessun riferimento a logoGrad in index.html');
ok(/\.logo-star\s*\{\s*width:\s*38px/.test(IDX) || /\.logo-star\s*\{[^}]*width:\s*38px/.test(CSS),
    'classe .logo-star sized ~38px');

console.log('\n== D1: titolo/sottotitolo e wiring intatti ==');
ok(IDX.includes('<span class="logo-text">Nova Studio</span>'), '.logo-text "Nova Studio" intatto');
ok(IDX.includes('<span class="logo-sub">La tua suite locale per lo studio</span>'), '.logo-sub intatto');
ok(IDX.includes('<span class="sidebar-title">NovaStudio</span>'), 'sidebar-title (~riga 470) invariato');
ok(IDX.includes('body:not(.view-home) #brandLockup') || CSS.includes('body:not(.view-home) #brandLockup'),
    'regola display #brandLockup (modules.css) intatta');

console.log('\n== D2: window.Materiali in index.html ==');
const iMat = IDX.indexOf('window.Materiali');
ok(iMat >= 0, 'window.Materiali definito in index.html');
const matBlock = iMat >= 0 ? IDX.slice(iMat, iMat + 400) : '';
ok(/open\s*:\s*function/.test(matBlock), 'Materiali.open e una funzione');
ok(matBlock.includes('openModal(materialModal)'), 'Materiali.open usa openModal(materialModal)');
ok(matBlock.includes('resetFile'), 'Materiali.open tenta resetFile() prima di aprire');

console.log('\n== D2: 8a card in renderHome (app.js) ==');
const iRH = APP.indexOf('function renderHome(');
ok(iRH >= 0, 'renderHome presente in app.js');
const iWrap = APP.indexOf('homeEl.appendChild(wrap);', iRH);
const rh = iRH >= 0 ? APP.slice(iRH, iWrap >= 0 ? iWrap + 40 : iRH + 3000) : '';
ok(rh.includes('Aggiungi materiali'), 'card "Aggiungi materiali" dentro renderHome');
ok(rh.includes('window.Materiali') && rh.includes('materialModal'),
    'click card: chiama Materiali.open con fallback su materialModal');
const iFor = rh.indexOf('ORDER.forEach');
const iAdd = rh.indexOf('grid.appendChild(addMatCard');
ok(iFor >= 0 && iAdd > iFor, 'card aggiunta DOPO il forEach ORDER');
ok(iAdd >= 0 && iAdd < rh.indexOf('wrap.appendChild(grid)'), 'card agganciata al grid PRIMA di wrap.appendChild(grid)');
ok(!/registerModule\(\s*['"]materiali/.test(APP), 'nessun registerModule("materiali")');
ok(/plus: '<svg/.test(APP), 'icona plus/upload presente in ICONS');
ok(rh.includes("class=\"home-last\"") || rh.includes("'home-last'"), 'card usa .home-last come le altre');
ok(!rh.includes('data-last=" + ') && !/addMatCard[\s\S]{0,400}data-last=/.test(rh),
    '8a card senza data-last async (label statica)');

console.log('\n== T1: ordine script e invarianti untouched ==');
const iStrat = IDX.indexOf('js/modules/schemaStrategies.js');
const iSchemi = IDX.indexOf('js/modules/schemi.js');
ok(iStrat >= 0, 'index.html carica schemaStrategies.js');
ok(iStrat >= 0 && iSchemi > iStrat, 'schemaStrategies.js precede schemi.js');
ok(APP.includes('home-hero hidden'), 'hero hidden invariato (renderHome)');
ok(/getElementById\('welcomeView'\)/.test(APP), 'welcomeView ancorato invariato (boot)');
ok(/'welcomeView', 'chatView'/.test(APP) || /\['homeView', 'moduleView', 'welcomeView', 'chatView'\]/.test(APP),
    'welcomeView ancora in hideAll');
ok(/getElementById\('brandLockup'\)[\s\S]{0,260}go\('home'\)/.test(APP),
    'click #brandLockup -> go(home) intatto (app.js ~262-266)');

/* ============================================================
   Smoke renderHome con DOM shim minimale (jsdom NON disponibile
   nel progetto: niente package.json/node_modules -> shim mano.
   ============================================================ */
console.log('\n== Smoke renderHome (DOM shim, jsdom non disponibile) ==');
const byId = {};
function mkEl(tag) {
    const e = {
        tagName: tag, children: [], attrs: {}, listeners: {}, style: {},
        className: '', textContent: '', scrollTop: 0, parentElement: null, nextSibling: null,
        _html: '', _id: '',
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k]; },
        appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
        insertBefore(c) { this.children.push(c); c.parentElement = this; return c; },
        addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = String(v); if (v === '') this.children.length = 0; },
    };
    const set = new Set();
    e.classList = {
        add: (...c) => c.forEach(x => set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        toggle: (c, f) => { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else { f ? set.add(c) : set.delete(c); } },
        contains: c => set.has(c),
    };
    Object.defineProperty(e, 'id', {
        get() { return this._id; },
        set(v) { this._id = String(v); byId[this._id] = this; },
    });
    return e;
}
global.window = global;
global.document = {
    readyState: 'complete',
    body: mkEl('body'),
    head: mkEl('head'),
    createElement: mkEl,
    getElementById: id => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
};
const mmEl = mkEl('div');
mmEl.id = 'materialModal';   // registro globale per il fallback

try {
    require(path.join(ROOT, 'web_frontend', 'html', 'js', 'app.js'));
    ok(!!global.App, 'app.js caricato nello shim (window.App definito)');
} catch (e) {
    ok(false, 'app.js caricato nello shim', String(e && e.message));
}

if (global.App) {
    try {
        ['chatbot', 'notes', 'schemi', 'produttivita', 'ripasso', 'biblioteca', 'calendario'].forEach(id => {
            global.App.registerModule({ id: id, title: 'Mod ' + id, desc: 'desc ' + id });
        });
        global.App.go('home');
        const homeView = byId['homeView'];
        ok(!!homeView, 'homeView creata da boot()');
        const wrap = homeView && homeView.children[0];
        ok(!!wrap, 'home-wrap presente');
        const hero = wrap && wrap.children[0];
        ok(!!hero && hero.className === 'home-hero hidden', 'hero = "home-hero hidden" (untouched)');
        const grid = wrap && wrap.children.filter(c => c.className === 'home-grid')[0];
        ok(!!grid, 'griglia .home-grid presente');
        const cards = grid ? grid.children : [];
        ok(cards.length === 8, 'numero card nella home = 8', 'ottenute ' + cards.length);
        const last = cards[7];
        ok(!!last && last.className === 'home-card', '8a card usa classe home-card');
        ok(!!last && last.innerHTML.indexOf('Aggiungi materiali') >= 0, '8a card: testo "Aggiungi materiali"');
        ok(!!last && last.innerHTML.indexOf('ICONS') === -1 && last.innerHTML.indexOf('<svg') >= 0,
            '8a card: icona SVG inline renderizzata');

        // click 1: window.Materiali stub -> deve essere chiamato
        let opened = 0;
        global.Materiali = { open: function () { opened++; } };
        if (last && last.listeners.click && last.listeners.click[0]) last.listeners.click[0]();
        ok(opened === 1, 'click 8a card chiama Materiali.open');

        // click 2: senza Materiali -> fallback .classList.add("show") su #materialModal
        delete global.Materiali;
        if (last && last.listeners.click && last.listeners.click[0]) last.listeners.click[0]();
        ok(!!byId['materialModal'] && byId['materialModal'].classList.contains('show'),
            'fallback: click apre #materialModal (show)');
    } catch (e) {
        ok(false, 'smoke renderHome completato', String(e && e.message));
    }
}

console.log('\n========================================');
console.log('RISULTATO qaD_home: ' + pass + '/' + (pass + fail) + ' passati, ' + fail + ' falliti');
if (fail) {
    console.log('Fallimenti:');
    failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
