'use strict';
/* qa_browser/qaS19_routing.js — QA-T2 R19 BLOCCO S: misure geometriche REALI
   (Chromium/puppeteer, file://qa_ui/schemi.html) sui casi C1-C11 + curva + lo
   schema reale (b12 albero). Nessuna geometria simulata: path renderizzati
   (d + getPointAtLength per le Q), rettangoli nodi letti dal DOM SVG.

   Esecuzione:
     node qa_browser/qaS19_routing.js prima   <- render con la COPIA BASELINE
         (request interception: modules/schemi.js <- qa/r19_schemi_baseline.js)
     node qa_browser/qaS19_routing.js dopo    <- render con il codice ATTUALE
     node qa_browser/qaS19_routing.js all     <- prima + dopo (default)

   Per OGNI arco misura:
     (a) ancore == tabella C1-C11 (4 lati, centri, +2px EDGE_OUT)
     (b) intersezioni arco-rettangoli nodi non-endpoint = 0 (Liang-Barsky
         esatto sui segmenti L; campionamento getPointAtLength per le Q)
     (c) punta freccia (translate del polygon) <= 2px dall'ancora target
     (d) segmenti <= 4
     (e) tutti i segmenti ortogonali (|dx|<=0.6 o |dy|<=0.6; le curve Q sono
         esentate dall'assert ma non da (b)(c)(a))
     (f) orientamento dell'ultimo segmento coerente con l'ancora target
     (g) struttura: data-caso == caso atteso (C1..C11)
   Extra: C8 bus (orizzontali condivisi), C11 coppie gap 32/48, curva keep/fall.

   Output: qa/r19_s_measures.json (chiavi "prima"/"dopo")
           screenshot qa/r19_s_prima_<caso>.png + qa/r19_s_dopo_<caso>.png */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const ARG = (process.argv[2] || 'all').toLowerCase();
const DO_PRIMA = (ARG === 'prima' || ARG === 'all');
const DO_DOPO = (ARG === 'dopo' || ARG === 'all');
const VW = 1366, VH = 900;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STYLE = {
    palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980',
    edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round'
};
function N(id, x, y, w, h) { return { id: id, x: x, y: y, w: w || 170, h: h || 60, text: id }; }
function E(id, from, to) { return { id: id, from: from, to: to, color: '#8ca4ff' }; }

/* ---- seed docs: OGNI caso C1-C11 + curva + schema reale (b12 del harness) ---- */
const DOCS = [
    {
        key: 'c1', id: 's19_c1', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C1 - oH sotto (allineato + offset C1b)',
        nodes: [N('s1', 100, 100), N('t1', 100, 260), N('s2', 500, 100), N('t2', 560, 260)],
        edges: [E('e1a', 's1', 't1'), E('e1b', 's2', 't2')],
        expect: { e1a: { caso: 'C1' }, e1b: { caso: 'C1b' } }
    },
    {
        key: 'c2', id: 's19_c2', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C2 - oH sopra (specchio C1)',
        nodes: [N('s1', 100, 260), N('t1', 100, 100), N('s2', 500, 260), N('t2', 560, 100)],
        edges: [E('e2a', 's1', 't1'), E('e2b', 's2', 't2')],
        expect: { e2a: { caso: 'C2' }, e2b: { caso: 'C2b' } }
    },
    {
        key: 'c3', id: 's19_c3', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C3 - stessa riga a destra (dritto + C3b)',
        nodes: [N('a', 100, 200), N('b', 400, 200), N('c', 100, 400), N('d', 400, 430)],
        edges: [E('e3a', 'a', 'b'), E('e3b', 'c', 'd')],
        expect: { e3a: { caso: 'C3' }, e3b: { caso: 'C3b' } }
    },
    {
        key: 'c4', id: 's19_c4', type: 'libero', opzioni: { arco: 'gomito' },
        title: 'R19 C4 - sotto !oH |dy|>=|dx| (Z verticale, forma gomito)',
        nodes: [N('s', 100, 100), N('t', 300, 350)],
        edges: [E('e4', 's', 't')],
        expect: { e4: { caso: 'C4' } }
    },
    {
        key: 'c5', id: 's19_c5', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C5 - sopra !oH (specchio C4)',
        nodes: [N('s', 100, 350), N('t', 300, 100)],
        edges: [E('e5', 's', 't')],
        expect: { e5: { caso: 'C5' } }
    },
    {
        key: 'c6', id: 's19_c6', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C6 - a destra !oV |dx|>|dy| (Z orizzontale)',
        nodes: [N('s', 100, 100), N('t', 500, 300)],
        edges: [E('e6', 's', 't')],
        expect: { e6: { caso: 'C6' } }
    },
    {
        key: 'c7', id: 's19_c7', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C7 - a sinistra !oV (specchio C6)',
        nodes: [N('s', 500, 100), N('t', 100, 300)],
        edges: [E('e7', 's', 't')],
        expect: { e7: { caso: 'C7' } }
    },
    {
        key: 'c8', id: 's19_c8', type: 'albero',
        title: 'R19 C8 - bus organigramma (3 figli, gapY condiviso)',
        nodes: [N('p', 400, 80), N('k1', 100, 320), N('k2', 400, 320), N('k3', 700, 320)],
        edges: [E('e8a', 'p', 'k1'), E('e8b', 'p', 'k2'), E('e8c', 'p', 'k3')],
        expect: { e8a: { caso: 'C8' }, e8b: { caso: 'C8' }, e8c: { caso: 'C8' } }
    },
    {
        key: 'c9', id: 's19_c9', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C9 - fratello in riga con nodo in mezzo (U)',
        nodes: [N('a', 60, 200), N('m', 360, 200), N('b', 660, 200)],
        edges: [E('e9', 'a', 'b')],
        expect: { e9: { caso: 'C9' } }
    },
    {
        key: 'c10', id: 's19_c10', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C10 - ostacolo nel corridoio (router anti-ostacolo)',
        nodes: [N('s', 60, 80), N('x', 400, 140), N('t', 660, 340)],
        edges: [E('e10', 's', 't')],
        expect: { e10: { caso: 'C10' } }
    },
    {
        key: 'c11', id: 's19_c11', type: 'libero', opzioni: { arco: 'dritta' },
        title: 'R19 C11 - nodi sovrapposti: separation 32/48 PRIMA del routing',
        nodes: [N('o1', 100, 100), N('o2', 150, 130)],
        edges: [E('e11', 'o1', 'o2')],
        expect: { e11: { caso: 'C1b' } }
    },
    {
        key: 'curva', id: 's19_curva', type: 'mappa',
        title: 'R19 curva - Q mantenuta se libera, router se interseca',
        nodes: [N('v1', 100, 100), N('v2', 500, 100), N('v3', 100, 300), N('v5', 50, 208, 134, 60)],
        edges: [E('eq', 'v1', 'v2'), E('eh', 'v1', 'v3')],
        expect: { eq: { caso: 'C3', q: 'keep' }, eh: { caso: 'C1', q: 'fall' } }
    },
    {
        key: 'real', id: 'b12', type: 'albero', preseeded: true,
        title: 'R19 reale - schema albero B12 (9 nodi / 6 archi)',
        nodes: [N('n1', 80, 60), N('n2', 360, 40), N('n3', 360, 170), N('n4', 640, 20),
        N('n5', 640, 150), N('n6', 80, 340), N('n7', 360, 340), N('n8', 640, 340), N('n9', 360, 470)],
        edges: [E('e1', 'n1', 'n2'), E('e2', 'n1', 'n3'), E('e3', 'n2', 'n4'),
        E('e4', 'n2', 'n5'), E('e5', 'n6', 'n7'), E('e6', 'n7', 'n9')],
        expect: { e1: { caso: 'ANY' }, e2: { caso: 'ANY' }, e3: { caso: 'ANY' },
        e4: { caso: 'ANY' }, e5: { caso: 'ANY' }, e6: { caso: 'ANY' } }
    }
];

function baseDoc(d) {
    const doc = {
        type: d.type, nodes: d.nodes, edges: d.edges,
        view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: Object.assign({}, STYLE)
    };
    if (d.opzioni) doc.opzioni = d.opzioni;
    return doc;
}

/* ---------- misura dentro la pagina reale ---------- */
async function measure(page, def) {
    return await page.evaluate((def) => {
        const out = {
            key: def.key, error: null, edges: [], nodi_renderizzati: 0,
            nodi_attesi: def.nodes.length, coppie_violate: [], bus: null
        };

        /* rettangoli REALI dai gruppi nodo renderizzati (mondo) */
        const rects = {};
        [].slice.call(document.querySelectorAll('g.sc-node[data-nid]')).forEach(g => {
            const nid = g.getAttribute('data-nid');
            const el = g.querySelector('rect') || g.querySelector('ellipse');
            if (!el) return;
            if (el.tagName.toLowerCase() === 'ellipse') {
                const cx = +el.getAttribute('cx'), cy = +el.getAttribute('cy');
                const rx = +el.getAttribute('rx'), ry = +el.getAttribute('ry');
                rects[nid] = { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry };
            } else {
                rects[nid] = {
                    x: +el.getAttribute('x'), y: +el.getAttribute('y'),
                    w: +el.getAttribute('width'), h: +el.getAttribute('height')
                };
            }
        });
        out.nodi_renderizzati = Object.keys(rects).length;
        out.nodi_mancanti = def.nodes.map(n => n.id).filter(id => !(id in rects));

        /* C11: coppie con gapX < 32 E gapY < 48 (margini R19) */
        const ids = Object.keys(rects);
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const A = rects[ids[i]], B = rects[ids[j]];
                const gapX = Math.max(A.x - (B.x + B.w), B.x - (A.x + A.w));
                const gapY = Math.max(A.y - (B.y + B.h), B.y - (A.y + A.h));
                if (gapX < 32 && gapY < 48) out.coppie_violate.push({ a: ids[i], b: ids[j], gapX: gapX, gapY: gapY });
            }
        }

        /* ---------- copia indipendente della tabella C1-C11 ---------- */
        function classify(a, b) {
            const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
            const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
            const dx = bcx - acx, dy = bcy - acy;
            const adx = Math.abs(dx), ady = Math.abs(dy);
            const oH = adx <= (a.w + b.w) / 4;
            const oV = ady <= (a.h + b.h) / 4;
            if (oH && dy > 0) return { caso: adx <= 0.5 ? 'C1' : 'C1b', s: 'B', t: 'T' };
            if (oH && dy < 0) return { caso: adx <= 0.5 ? 'C2' : 'C2b', s: 'T', t: 'B' };
            if (oV && dx > 0) return { caso: ady <= 0.5 ? 'C3' : 'C3b', s: 'R', t: 'L' };
            if (oV && dx < 0) return { caso: ady <= 0.5 ? 'C3' : 'C3b', s: 'L', t: 'R' };
            if (dy > 0 && ady >= adx) return { caso: 'C4', s: 'B', t: 'T' };
            if (dy < 0 && ady >= adx) return { caso: 'C5', s: 'T', t: 'B' };
            if (dx > 0) return { caso: 'C6', s: 'R', t: 'L' };
            if (dx < 0) return { caso: 'C7', s: 'L', t: 'R' };
            if (adx >= ady) return { caso: dx >= 0 ? 'C6' : 'C7', s: dx >= 0 ? 'R' : 'L', t: dx >= 0 ? 'L' : 'R' };
            return { caso: dy >= 0 ? 'C4' : 'C5', s: dy >= 0 ? 'B' : 'T', t: dy >= 0 ? 'T' : 'B' };
        }
        function sidePt(n, side, off) {
            off = off || 0;
            if (side === 'B') return { x: n.x + n.w / 2, y: n.y + n.h + off };
            if (side === 'T') return { x: n.x + n.w / 2, y: n.y - off };
            if (side === 'L') return { x: n.x - off, y: n.y + n.h / 2 };
            return { x: n.x + n.w + off, y: n.y + n.h / 2 };
        }
        function expected(caso, A, B) {
            if (caso === 'C8') return { s: [sidePt(A, 'B', 2)], t: [sidePt(B, 'T', 2)], dt: 'T' };
            if (caso === 'C9') return { s: [sidePt(A, 'B', 2), sidePt(A, 'T', 2)], t: [sidePt(B, 'B', 2), sidePt(B, 'T', 2)], dt: null };
            const c = classify(A, B);   // C1..C7 e C10 (ancora di tabella)
            return { s: [sidePt(A, c.s, 2)], t: [sidePt(B, c.t, 2)], dt: c.t };
        }
        function parseD(d) {
            const tok = d.match(/[MLQ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
            const pts = [], cmds = [];
            let i = 0, cur = null;
            while (i < tok.length) {
                const c = tok[i];
                if (c === 'M' || c === 'L' || c === 'Q') {
                    i++;
                    if (c === 'M') { cur = { x: +tok[i++], y: +tok[i++] }; pts.push(cur); }
                    else if (c === 'L') { const p = { x: +tok[i++], y: +tok[i++] }; cmds.push({ t: 'L', from: cur, to: p }); pts.push(p); cur = p; }
                    else { const cx = +tok[i++], cy = +tok[i++], p = { x: +tok[i++], y: +tok[i++] }; cmds.push({ t: 'Q', from: cur, c: { x: cx, y: cy }, to: p }); pts.push(p); cur = p; }
                } else i++;
            }
            return { pts: pts, cmds: cmds };
        }
        function segHitsRect(x1, y1, x2, y2, r) {
            const dx = x2 - x1, dy = y2 - y1;
            let t0 = 0, t1 = 1;
            const px = [-dx, dx, -dy, dy];
            const qx = [x1 - r.x, (r.x + r.w) - x1, y1 - r.y, (r.y + r.h) - y1];
            for (let i = 0; i < 4; i++) {
                if (px[i] === 0) { if (qx[i] < 0) return false; }
                else {
                    const t = qx[i] / px[i];
                    if (px[i] < 0) { if (t > t0) t0 = t; }
                    else { if (t < t1) t1 = t; }
                    if (t0 > t1) return false;
                }
            }
            return (Math.min(t1, 1) - Math.max(t0, 0)) > 1e-6;
        }
        function chkOrient(dst, vx, vy) {
            if (dst === 'T') return vy > 0 && Math.abs(vy) + 0.6 >= Math.abs(vx);
            if (dst === 'B') return vy < 0 && Math.abs(vy) + 0.6 >= Math.abs(vx);
            if (dst === 'L') return vx > 0 && Math.abs(vx) + 0.6 >= Math.abs(vy);
            if (dst === 'R') return vx < 0 && Math.abs(vx) + 0.6 >= Math.abs(vy);
            return false;
        }
        const dmin = (pt, arr) => Math.min.apply(null, arr.map(q => Math.hypot(pt.x - q.x, pt.y - q.y)));
        const EP = 0.01;

        const edgeOf = {};
        def.edges.forEach(e => { edgeOf[e.id] = e; });
        const edgeGroups = [].slice.call(document.querySelectorAll('.sc-edges .sc-edge'));
        out.archi_renderizzati = edgeGroups.length;
        out.archi_attesi = def.edges.length;

        edgeGroups.forEach(g => {
            const eid = g.getAttribute('data-eid');
            const eobj = edgeOf[eid];
            const ex = (def.expect && def.expect[eid]) || { caso: 'ANY' };
            const rec = { eid: eid, caso: g.getAttribute('data-caso') || '', exp: ex.caso, isQ: false, ok: false };
            if (!eobj || !(eobj.from in rects) || !(eobj.to in rects)) {
                rec.error = 'endpoint mancante'; out.edges.push(rec); return;
            }
            const A = rects[eobj.from], B = rects[eobj.to];
            const paths = g.querySelectorAll('path');
            const pe = paths[paths.length - 1];
            const dAttr = pe ? (pe.getAttribute('d') || '') : '';
            const P = parseD(dAttr);
            rec.isQ = P.cmds.some(c => c.t === 'Q');
            rec.d = dAttr;

            /* (g) struttura */
            const casoOk = ex.caso === 'ANY'
                ? /^C([1-7]|8|9|10)b?$/.test(rec.caso)
                : rec.caso === ex.caso;
            rec.casoOk = casoOk;

            /* (a) ancore */
            const casoForAnchor = ex.caso === 'ANY' ? (rec.caso || '') : ex.caso;
            const EA = expected(casoForAnchor, A, B);
            const start = P.pts[0], end = P.pts[P.pts.length - 1];
            rec.anchor = { s: +dmin(start, EA.s).toFixed(3), t: +dmin(end, EA.t).toFixed(3) };
            rec.anchorOk = rec.anchor.s <= 0.75 && rec.anchor.t <= 0.75;

            /* dst per (f) */
            let dst = EA.dt;
            if (!dst) {
                const dT = Math.hypot(end.x - B.x - B.w / 2, end.y - B.y);
                const dB = Math.hypot(end.x - B.x - B.w / 2, end.y - B.y - B.h);
                dst = dT <= dB ? 'T' : 'B';
            }

            /* (d) segmenti */
            rec.segs = P.cmds.filter(c => c.t === 'L' || c.t === 'Q').length;
            rec.segsOk = rec.segs <= 4;

            /* (e) ortogonalità (esente Q) */
            rec.orthoOk = true; rec.nonOrto = 0;
            if (!rec.isQ) {
                P.cmds.forEach(c => {
                    if (c.t !== 'L') return;
                    const dx = Math.abs(c.to.x - c.from.x), dy = Math.abs(c.to.y - c.from.y);
                    if (dx > 0.6 && dy > 0.6) { rec.orthoOk = false; rec.nonOrto++; }
                });
            }

            /* (b) intersezioni con nodi non-endpoint */
            rec.inter = []; 
            if (!rec.isQ) {
                P.cmds.forEach(c => {
                    if (c.t !== 'L') return;
                    ids.forEach(nid => {
                        if (nid === eobj.from || nid === eobj.to) return;
                        const r0 = rects[nid];
                        const r = { x: r0.x + EP, y: r0.y + EP, w: r0.w - 2 * EP, h: r0.h - 2 * EP };
                        if (segHitsRect(c.from.x, c.from.y, c.to.x, c.to.y, r)) {
                            if (rec.inter.indexOf(nid) < 0) rec.inter.push(nid);
                        }
                    });
                });
            } else if (pe && pe.getTotalLength) {
                const len = pe.getTotalLength();
                const n = Math.max(16, Math.min(4000, Math.ceil(len)));
                for (let k = 0; k <= n; k++) {
                    const pt = pe.getPointAtLength(len * k / n);
                    ids.forEach(nid => {
                        if (nid === eobj.from || nid === eobj.to) return;
                        if (rec.inter.indexOf(nid) >= 0) return;
                        const r = rects[nid];
                        if (pt.x > r.x + EP && pt.x < r.x + r.w - EP && pt.y > r.y + EP && pt.y < r.y + r.h - EP) rec.inter.push(nid);
                    });
                }
            }

            /* (c) punta freccia */
            rec.tipDist = null; rec.tipOk = null;
            const poly = g.querySelector('polygon');
            if (poly) {
                const m = /^translate\(([-0-9.eE+]+),([-0-9.eE+]+)\)/.exec(poly.getAttribute('transform') || '');
                if (m) {
                    const tip = { x: +m[1], y: +m[2] };
                    rec.tipDist = +dmin(tip, EA.t).toFixed(3);
                    rec.tipOk = rec.tipDist <= 2 + 1e-6;
                } else rec.tipOk = false;
            }

            /* (f) orientamento ultimo segmento (esente Q) */
            rec.orientOk = null;
            if (!rec.isQ && P.cmds.length) {
                const last = P.cmds[P.cmds.length - 1];
                if (last.t === 'L') rec.orientOk = chkOrient(dst, last.to.x - last.from.x, last.to.y - last.from.y);
                else rec.orientOk = false;
            }

            /* curva: keep/fall */
            rec.qOk = true;
            if (ex.q === 'keep') rec.qOk = dAttr.indexOf('Q') >= 0;
            if (ex.q === 'fall') rec.qOk = dAttr.indexOf('Q') < 0;

            /* orizzontali per il check bus C8 */
            rec.horizYs = [];
            if (!rec.isQ) P.cmds.forEach(c => {
                if (c.t === 'L' && Math.abs(c.to.y - c.from.y) <= 0.6 && Math.abs(c.to.x - c.from.x) > 1)
                    rec.horizYs.push(c.from.y);
            });

            rec.ok = rec.casoOk && rec.anchorOk && rec.inter.length === 0 &&
                (rec.tipOk === null || rec.tipOk === true) && rec.segsOk &&
                (rec.isQ || (rec.orthoOk && rec.orientOk === true)) && rec.qOk;
            out.edges.push(rec);
        });

        /* C8: orizzontali del bus identici + drop allineati contengono busY */
        const busEdges = out.edges.filter(e => e.caso === 'C8');
        if (busEdges.length >= 2) {
            const zs = busEdges.filter(e => e.horizYs && e.horizYs.length);
            const ys = [];
            zs.forEach(e => e.horizYs.forEach(y => ys.push(y)));
            let ok = zs.length >= 2;
            if (ys.length >= 2) ok = ok && (Math.max.apply(null, ys) - Math.min.apply(null, ys) <= 0.1);
            if (ok) {
                const busY = ys[0];
                busEdges.forEach(e => {
                    if (e.horizYs && e.horizYs.length) return;
                    /* figlio allineato: il drop verticale deve contenere busY */
                    const P = parseD(e.d || '');
                    const s = P.pts[0], t = P.pts[P.pts.length - 1];
                    const lo = Math.min(s.y, t.y), hi = Math.max(s.y, t.y);
                    if (!(busY >= lo - 0.1 && busY <= hi + 0.1)) ok = false;
                });
            }
            out.bus = { y: ys.length ? ys[0] : null, ok: ok, n: busEdges.length };
        }
        return out;
    }, def);
}

/* ---------- totale per fase ---------- */
function totale(cases) {
    const t = {
        casi: 0, casi_ok: 0, archi: 0,
        intersezioni: 0, intersezioni_tot: 0,
        punte_totali: 0, punte_oltre_2px: 0,
        non_ortogonali: 0, segmenti_oltre4: 0,
        anchor_fail: 0, orient_fail: 0, caso_fail: 0, q_fail: 0,
        coppie_violate: 0, nodi_mancanti: 0, errori: 0
    };
    Object.keys(cases).forEach(k => {
        const c = cases[k];
        if (!c || c.error) { t.errori++; return; }
        t.casi++;
        let ok = true;
        (c.edges || []).forEach(e => {
            t.archi++;
            if (e.inter && e.inter.length) { t.intersezioni++; t.intersezioni_tot += e.inter.length; ok = false; }
            if (e.tipOk === true) { t.punte_totali++; if (e.tipOk !== true) t.punte_oltre_2px++; }
            if (e.tipOk === false) { t.punte_totali++; t.punte_oltre_2px++; }
            if (!e.isQ && e.orthoOk === false) { t.non_ortogonali++; ok = false; }
            if (e.segsOk === false) { t.segmenti_oltre4++; ok = false; }
            if (e.anchorOk === false) { t.anchor_fail++; ok = false; }
            if (e.orientOk === false) { t.orient_fail++; ok = false; }
            if (e.casoOk === false) { t.caso_fail++; ok = false; }
            if (e.qOk === false) { t.q_fail++; ok = false; }
            if (e.ok !== true) ok = false;
        });
        t.coppie_violate += (c.coppie_violate || []).length;
        t.nodi_mancanti += (c.nodi_mancanti || []).length;
        if ((c.coppie_violate || []).length) ok = false;
        if ((c.nodi_mancanti || []).length) ok = false;
        if (c.bus && c.bus.ok === false) ok = false;
        if (ok) t.casi_ok++;
    });
    return t;
}

/* ---------- main ---------- */
(async () => {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--allow-file-access-from-files', '--font-render-hinting=none']
        });
    } catch (e) {
        console.error('BLOCKED — browser reale non avviabile: ' + e.message);
        process.exit(2);
    }
    console.log('BROWSER OK: ' + (await browser.version()) + '  fase=' + ARG);

    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    await page.setCacheEnabled(false);
    const consoleErrs = [];
    page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrs.push('console.error: ' + m.text()); });
    page.on('pageerror', e => consoleErrs.push('pageerror: ' + e.message));

    /* interception: in fase "prima" serviamo la COPIA BASELINE di schemi.js */
    const BASELINE = fs.readFileSync(path.join(QA_DIR, 'r19_schemi_baseline.js'), 'utf8');
    let interceptOn = false;
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        if (interceptOn && /\/web_frontend\/html\/js\/modules\/schemi\.js(\?|$)/.test(u)) {
            req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: BASELINE });
        } else req.continue();
    });

    const url = pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href;
    let anyOpenFail = false;

    async function runPass(phase) {
        interceptOn = (phase === 'prima');
        await page.goto(url, { waitUntil: 'load', timeout: 20000 });
        let ready = false;
        for (let i = 0; i < 200; i++) {
            const st = await page.evaluate(() => ({
                ready: !!(window.__QA && window.__QA.harnessReady),
                errs: (window.__QA && window.__QA.errors) || []
            }));
            if (st.errs.length) { consoleErrs.push.apply(consoleErrs, st.errs); break; }
            if (st.ready) { ready = true; break; }
            await sleep(100);
        }
        if (!ready) {
            console.error('BLOCKED — harness qa_ui/schemi.html non pronto (' + phase + '): ' +
                JSON.stringify(consoleErrs.slice(0, 5)));
            await browser.close();
            process.exit(2);
        }
        /* seed dei doc (runtime store, nessun file condiviso toccato) */
        const payload = DOCS.filter(d => !d.preseeded).map(d => ({
            id: d.id, kind: 'schema', title: d.title,
            content: JSON.stringify(baseDoc(d)),
            materia: '', tags: '', description: '', thumbnail: '', folder_id: ''
        }));
        await page.evaluate((items) => {
            const st = window.__QA.store;
            items.forEach(item => {
                const ex = st.items.filter(x => x.id === item.id)[0];
                if (ex) Object.assign(ex, item); else st.items.push(item);
            });
        }, payload);

        const cases = {};
        for (const d of DOCS) {
            const opened = await page.evaluate(id => window.__qaHarness.open(id), d.id);
            if (!opened) { consoleErrs.push('open fallito: ' + d.id); cases[d.key] = { key: d.key, error: 'open fallito' }; anyOpenFail = true; continue; }
            let nOk = false;
            for (let i = 0; i < 100; i++) {
                const n = await page.evaluate(() => document.querySelectorAll('g.sc-node[data-nid]').length);
                if (n === d.nodes.length) { nOk = true; break; }
                await sleep(60);
            }
            if (!nOk) consoleErrs.push('nodi non tutti renderizzati su ' + d.id);
            await sleep(300);   // settle render + separation all'apertura
            /* fit reale (stessa UX dell'app) */
            await page.evaluate(() => {
                [].slice.call(document.querySelectorAll('.sc-editor button.tool-btn')).forEach(b => {
                    if (/Centra vista/.test(b.textContent)) b.click();
                });
            });
            await sleep(200);
            const m = await measure(page, d);
            m.screenshot = 'qa/r19_s_' + phase + '_' + d.key + '.png';
            cases[d.key] = m;
            await page.screenshot({ path: path.join(QA_DIR, 'r19_s_' + phase + '_' + d.key + '.png') });
            const ev = (m.edges || []).map(e => e.caso + (e.ok ? '' : '!')).join(',');
            console.log('[' + phase + '/' + d.key + '] nodi=' + m.nodi_renderizzati + '/' + m.nodi_attesi +
                ' archi=' + m.archi_renderizzati + ' [' + ev + ']' +
                ' inter=' + (m.edges || []).reduce((s, e) => s + (e.inter ? e.inter.length : 0), 0) +
                ' coppie32/48=' + (m.coppie_violate || []).length +
                ' SHOT r19_s_' + phase + '_' + d.key + '.png');
        }
        const t = totale(cases);
        return { command: 'node qa_browser/qaS19_routing.js ' + phase, timestamp: new Date().toISOString(), viewport: VW + 'x' + VH, totale: t, cases: cases, errori: consoleErrs.slice(0, 20) };
    }

    const outPath = path.join(QA_DIR, 'r19_s_measures.json');
    let obj = {};
    try { obj = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { obj = {}; }
    obj.method = 'node qa_browser/qaS19_routing.js [prima|dopo|all] — Chromium headless (puppeteer) su ' +
        'file://qa_ui/schemi.html; fase PRIMA con request interception su modules/schemi.js ' +
        '(servita la copia baseline qa/r19_schemi_baseline.js); ancore: tabella C1-C11 (4 lati, centri, ' +
        '+2px EDGE_OUT); intersezioni: Liang-Barsky esatto sui segmenti L (eps interiore 0.01, nodi ' +
        'endpoint esclusi) + getPointAtLength(step 1px) per le Q; punta: translate(<polygon>) <= 2px ' +
        'dall\'ancora target; ortogonalità: |dx|<=0.6 o |dy|<=0.6 per segmento (Q esentate); ' +
        'struttura: data-caso == caso atteso; C8 bus: orizzontali identici; C11: coppie gapX<32 E gapY<48. ' +
        'Screenshot qa/r19_s_prima_<caso>.png / qa/r19_s_dopo_<caso>.png';

    if (DO_PRIMA) {
        console.log('\n===== PASS PRIMA (baseline) =====');
        obj.prima = await runPass('prima');
        fs.writeFileSync(outPath, JSON.stringify(obj, null, 1));
        console.log('TOTALE prima: ' + JSON.stringify(obj.prima.totale));
    }
    if (DO_DOPO) {
        console.log('\n===== PASS DOPO (attuale) =====');
        obj.dopo = await runPass('dopo');
        fs.writeFileSync(outPath, JSON.stringify(obj, null, 1));
        console.log('TOTALE dopo: ' + JSON.stringify(obj.dopo.totale));
    }

    if (consoleErrs.length) console.log('ERRORI: ' + JSON.stringify(consoleErrs.slice(0, 8)));
    await browser.close();
    process.exit(anyOpenFail ? 1 : 0);
})().catch(e => { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(3); });
