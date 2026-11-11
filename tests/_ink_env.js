'use strict';
/* tests/_ink_env.js - harness jsdom condiviso per i test L/A (Appunti).
   NON e' una suite (prefisso _ escluso dal glob di run_t1.py).
   Pattern identico a tests/qaA_appunti.js + canvas rect patch (800x600)
   perche' in jsdom getBoundingClientRect e' vuoto e la mappa
   cliente->mondo andrebbe in scala 0. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const SRC_CFG = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'ink_cfg.js'), 'utf8');
const SRC_COMMIT = fs.readFileSync(path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'ink_commit.js'), 'utf8');
const SRC_PANEL = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'fonti_panel.js'), 'utf8');
const SRC_NOTES = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'js', 'modules', 'notes.js'), 'utf8');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeCtx2d(canvas) {
    const grad = { addColorStop() { } };
    const store = { canvas: canvas };
    return new Proxy(store, {
        get(t, p) {
            if (typeof p === 'symbol') return undefined;
            if (p === 'measureText') return s => ({ width: String(s == null ? '' : s).length * 7 });
            if (p === 'getImageData' || p === 'createImageData') {
                return (x, y, w, h) => ({
                    data: new Uint8ClampedArray(Math.max(4, (w || 1) * (h || 1) * 4)),
                    width: w || 1, height: h || 1
                });
            }
            if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
            if (p === 'createPattern') return () => null;
            if (p in t) return t[p];
            return () => undefined;
        },
        set(t, p, v) { t[p] = v; return true; }
    });
}

function makeEnv() {
    const consoleErrors = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.map(String).join(' ')));
    vc.on('jsdomError', e => consoleErrors.push('jsdomError: ' + (e && e.message ? e.message : e)));

    const dom = new JSDOM(
        '<!DOCTYPE html><html><body><div id="main"></div></body></html>', {
            url: 'http://localhost/', pretendToBeVisual: true,
            runScripts: 'outside-only', virtualConsole: vc
        });
    const win = dom.window;
    const doc = win.document;

    win.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx2d) this.__ctx2d = makeCtx2d(this);
        return this.__ctx2d;
    };
    win.HTMLCanvasElement.prototype.toDataURL = function () {
        return 'data:image/png;base64,AAAA';
    };
    // rect realistici: il canvas del mondo usa width/height del rect per
    // resize/centerView; senza rect, scala=0 e i test geometrici collassano
    win.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
        return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
    };
    win.alert = () => { };
    win.confirm = () => false;

    const store = {
        seq: 1,
        items: [
            { id: 'n1', kind: 'note', title: 'Nota Ink', content: '', materia: '', tags: '', description: '', thumbnail: '', folder_id: '' }
        ],
        mats: []
    };
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    function el(tag, cls, text) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    win.App = {
        el: el, esc: esc,
        style: css => { const s = doc.createElement('style'); s.textContent = css; doc.head.appendChild(s); },
        header: (t, d, btns) => {
            const h = el('div', 'app-header');
            h.appendChild(el('h2', null, t));
            if (d) h.appendChild(el('p', null, d));
            if (btns && btns.length) { const row = el('div', 'header-actions'); btns.forEach(b => row.appendChild(b)); h.appendChild(row); }
            return h;
        },
        empty: () => el('div', 'app-empty'),
        ICONS: { notes: '' },
        fmtDate: s => String(s || ''),
        go: () => { },
        registerModule: m => { win.App._mod = m; }
    };
    win.StudyStore = {
        uuid: () => 'id' + (store.seq++),
        listItems: async kind => store.items.filter(i => !kind || i.kind === kind).map(i => Object.assign({}, i)),
        getItem: async id => { const i = store.items.filter(x => x.id === id)[0]; return i ? Object.assign({}, i) : null; },
        saveItem: async p => {
            if (p.id) {
                const i = store.items.filter(x => x.id === p.id)[0];
                if (i) { Object.assign(i, p); return Object.assign({}, i); }
            }
            const n = Object.assign({ id: 's' + (store.seq++) }, p);
            store.items.push(n);
            return Object.assign({}, n);
        },
        deleteItem: async id => { store.items = store.items.filter(i => i.id !== id); },
        renameItem: async () => { },
        listSubjects: async () => [],
        listMaterials: async () => store.mats.map(m => Object.assign({}, m)),
        hasBackend: async () => false,
        pickAsset: async () => null,
        assetUrl: s => s,
        openFilePath: async () => ({ success: true })
    };
    win.SubjectInput = {
        normalize: s => String(s || '').trim(),
        remember: () => Promise.resolve(),
        create: () => {
            const wrap = el('div', 'subject-input');
            const inp = el('input', 'subject-field');
            wrap.appendChild(inp);
            wrap.getValue = () => inp.value;
            return wrap;
        }
    };
    win.Folders = {
        bar: () => el('div', 'folders-bar'),
        grid: () => el('div', 'folders-grid'),
        filterItems: items => items,
        moveSelect: () => el('button', 'tool-btn', 'Sposta'),
        get: () => ''
    };

    win.eval(SRC_PANEL);
    win.eval(SRC_CFG);
    win.eval(SRC_COMMIT);
    win.eval(SRC_NOTES);
    return { dom, win, doc, store, mod: win.App._mod, consoleErrors };
}

async function openNote(env, id) {
    const cont = env.doc.getElementById('main');
    cont.innerHTML = '';
    env.mod.open(cont, { open: id });
    await sleep(260);
}

function canvasOf(env) {
    return env.doc.querySelector('.nt-editor canvas') || env.doc.querySelector('canvas');
}

function ptr(env, canvas, type, x, y) {
    const ev = new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 });
    canvas.dispatchEvent(ev);
}

/* traccia un tratto: pts in coordinate CLIENTE; opts {dt, hold, noUp} */
async function stroke(env, pts, opts) {
    opts = opts || {};
    const canvas = canvasOf(env);
    ptr(env, canvas, 'pointerdown', pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
        if (opts.dt) await sleep(opts.dt);
        ptr(env, canvas, 'pointermove', pts[i][0], pts[i][1]);
    }
    if (opts.hold) await sleep(opts.hold);
    if (!opts.noUp) {
        ptr(env, canvas, 'pointerup', pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
    await sleep(opts.settle != null ? opts.settle : 90);
    return canvas;
}

/* flush dei frame rAF (>= n cicli) */
async function flushRaf(env, n) {
    for (let i = 0; i < (n || 4); i++) {
        await new Promise(r => env.win.requestAnimationFrame(() => r()));
    }
}

function undoKey(env, times) {
    for (let i = 0; i < (times || 1); i++) {
        env.win.dispatchEvent(new env.win.KeyboardEvent('keydown',
            { key: 'z', ctrlKey: true, bubbles: true }));
    }
}

/* cliente <- mondo: calibra su due punti noti (transform assiale) */
function w2c(env, x, y) {
    const ink = env.win.__ink;
    const A = ink.toWorld(0, 0);
    const B = ink.toWorld(1, 0);
    const C = ink.toWorld(0, 1);
    const dx = B.x - A.x, dy = C.y - A.y;
    return [(x - A.x) / dx, (y - A.y) / dy];
}
function wc(env, pts) { return pts.map(p => w2c(env, p[0], p[1])); }

module.exports = { makeEnv, openNote, canvasOf, ptr, stroke, flushRaf, undoKey, sleep, ROOT, w2c, wc };
