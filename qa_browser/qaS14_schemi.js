'use strict';
/* qa_browser/qaS14_schemi.js — QA-T2 round14 (S: ancore fisse, routing senza
   ostacoli, niente overlap) su browser REALE (Chromium/Puppeteer, file://).

   Esecuzione:
     node qa_browser/qaS14_schemi.js prima     <- misura sul codice ATTUALE
     node qa_browser/qaS14_schemi.js dopo      <- misura dopo le modifiche (+ screenshot)

   Misure (nessuna geometria simulata: path DOM campionati con
   getPointAtLength, rettangoli nodo letti dagli attributi SVG):
     1) archi la cui linea interseca il rettangolo di un nodo NON endpoint
        (campionamento 1.5px, interior eps 0.01px, esclusi from/to dell'arco)
     2) coppie nodi con gapX < 24px E gapY < 40px (margine S4 24/40)
     3) punte freccia (translate del <polygon>) con distanza > 2px + 1e-6
        dall'ancora target calcolata con la regola S1 (bbox, senza offset)

   Output: qa/s14_measures.json -> chiave "prima"/"dopo" + "method"
           5 screenshot: qa/s14_{albero,mappa,lr,libero,riassunto}.png

   Seed: 5 doc (uno per tipo) spinti in runtime in window.__QA.store.items
   (NESSUN file condiviso toccato) e aperti con window.__qaHarness.open(id).
   Ogni doc contiene >=1 arco che attraversa un nodo non-endpoint (baseline
   non-zero attesa) e 1 coppia di nodi sovrapposti (gap 24/40 violato). */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const PHASE = (process.argv[2] === 'dopo') ? 'dopo' : 'prima';
const VW = 1366, VH = 900;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const STYLE = {
    palette: 'scura', nodeFill: '#242c40', nodeBorder: '#4a5980',
    edgeColor: '#8ca4ff', fontSize: 14, bold: false, shape: 'round'
};
function N(id, x, y, text, w, h) {
    return { id: id, x: x, y: y, w: w || 170, h: h || 60, text: text || id };
}
function E(id, from, to) { return { id: id, from: from, to: to, color: '#8ca4ff' }; }

/* 5 doc: ciascuno con >=1 attraversamento (baseline) + 1 coppia sovrapposta */
const DOCS = [
    {
        id: 's14_albero', type: 'albero',
        nodes: [
            N('a1', 60, 60, 'Radice'),            // ->a2 attraversa a3 (baseline)
            N('a2', 560, 60, 'Figlio destro'),
            N('a3', 300, 60, 'Figlio mezzo'),      // ostacolo sulla riga
            N('a4', 60, 320, 'Nipote'),
            N('a5', 560, 340, 'Nipote 2'),
            N('a6', 860, 320, 'Sovrapposto A'),
            N('a7', 872, 332, 'Sovrapposto B')     // gapX=-158 gapY=-48 -> violazione
        ],
        edges: [E('ea1', 'a1', 'a2'), E('ea2', 'a1', 'a3'), E('ea3', 'a1', 'a4'),
        E('ea4', 'a3', 'a5'), E('ea5', 'a2', 'a6')]
    },
    {
        id: 's14_mappa', type: 'mappa',
        nodes: [
            N('m1', 60, 80, 'Concetto 1'),         // ->m3 attraversa m2 (curva baseline)
            N('m2', 340, 100, 'Ostacolo'),         // 100..160: la curva ci passa dentro
            N('m3', 620, 80, 'Concetto 3'),
            N('m4', 340, 300, 'Concetto 4'),
            N('m5', 900, 80, 'Sovrapposto A'),
            N('m6', 912, 92, 'Sovrapposto B')      // violazione 24/40
        ],
        edges: [E('em1', 'm1', 'm3'), E('em2', 'm1', 'm4'), E('em3', 'm2', 'm4'),
        E('em4', 'm3', 'm5')]
    },
    {
        id: 's14_lr', type: 'lr',
        nodes: [
            N('l1', 60, 60, 'Ingresso'),           // ->l4 attraversa l2 (baseline)
            N('l2', 320, 60, 'Layer 1A'),
            N('l3', 320, 260, 'Layer 1B'),
            N('l4', 580, 60, 'Layer 2A'),
            N('l5', 580, 260, 'Layer 2B'),
            N('l6', 840, 60, 'Uscita'),
            N('l7', 840, 260, 'Sovrapposto A'),
            N('l8', 852, 272, 'Sovrapposto B')     // violazione 24/40
        ],
        edges: [E('el1', 'l1', 'l2'), E('el2', 'l1', 'l4'), E('el3', 'l2', 'l5'),
        E('el4', 'l4', 'l6'), E('el5', 'l2', 'l3'), E('el6', 'l5', 'l7')]
    },
    {
        id: 's14_libero', type: 'libero',
        nodes: [
            N('n1', 60, 60, 'Nodo 1'),             // ->n3 attraversa n2 (baseline)
            N('n2', 400, 60, 'Nodo 2'),
            N('n3', 740, 60, 'Nodo 3'),
            N('n4', 60, 320, 'Nodo 4'),
            N('n5', 400, 320, 'Sovrapposto A'),
            N('n6', 412, 332, 'Sovrapposto B')     // violazione 24/40
        ],
        edges: [E('en1', 'n1', 'n3'), E('en2', 'n1', 'n4'), E('en3', 'n2', 'n5')]
    },
    {
        id: 's14_riassunto', type: 'riassunto',
        nodes: [
            N('r1', 60, 60, 'Titolo 1\nCorpo card 1', 260, 96),   // ->r3 attraversa r2
            N('r2', 60, 240, 'Titolo 2\nCorpo card 2', 260, 96),
            N('r3', 60, 420, 'Titolo 3\nCorpo card 3', 260, 96),
            N('r4', 500, 60, 'Titolo 4\nCorpo card 4', 260, 96),
            N('r5', 500, 240, 'Sovrapposto A', 260, 96),
            N('r6', 512, 252, 'Sovrapposto B', 260, 96)            // violazione 24/40
        ],
        edges: [E('er1', 'r1', 'r3'), E('er2', 'r1', 'r4'), E('er3', 'r5', 'r6')]
    }
];

function baseDoc(d) {
    return {
        type: d.type, nodes: d.nodes, edges: d.edges,
        view: { x: 0, y: 0, zoom: 1 }, riassunto: '', drawings: [],
        style: Object.assign({}, STYLE)
    };
}

/* ---------- misura dentro la pagina reale ---------- */
async function measure(page, docDef) {
    return await page.evaluate((def) => {
        const out = { id: def.id, type: def.type, error: null };
        const byId = {};
        def.nodes.forEach(n => { byId[n.id] = n; });
        const edgeOf = {};
        def.edges.forEach(e => { edgeOf[e.id] = e; });

        /* rettangoli REALI dai gruppi nodo renderizzati */
        const rects = {};
        const groups = [].slice.call(document.querySelectorAll('g.sc-node[data-nid]'));
        groups.forEach(g => {
            const nid = g.getAttribute('data-nid');
            const r = g.querySelector('rect');
            if (!r) return;
            rects[nid] = {
                x: +r.getAttribute('x'), y: +r.getAttribute('y'),
                w: +r.getAttribute('width'), h: +r.getAttribute('height')
            };
        });
        out.nodi_renderizzati = groups.length;
        out.nodi_attesi = def.nodes.length;
        const ids = Object.keys(rects);
        out.nodi_mancanti = def.nodes.map(n => n.id).filter(id => !(id in rects));

        /* (2) coppie con gapX < 24 E gapY < 40 */
        const coppie = [];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const A = rects[ids[i]], B = rects[ids[j]];
                const gapX = Math.max(A.x - (B.x + B.w), B.x - (A.x + A.w));
                const gapY = Math.max(A.y - (B.y + B.h), B.y - (A.y + A.h));
                if (gapX < 24 && gapY < 40) coppie.push({ a: ids[i], b: ids[j], gapX: gapX, gapY: gapY });
            }
        }
        out.coppie_violate = coppie.length;
        out.coppie_dettaglio = coppie;

                /* regola S (R19): ancora target secondo la tabella C1-C11
           (prima corrispondenza; sostituisce la vecchia asse dominante che
           non copre i sotto-casi C1/C2/C3 con overlap). */
        function targetAnchor(src, tgt) {
            const acx = src.x + src.w / 2, acy = src.y + src.h / 2;
            const bcx = tgt.x + tgt.w / 2, bcy = tgt.y + tgt.h / 2;
            const dx = bcx - acx, dy = bcy - acy;
            const adx = Math.abs(dx), ady = Math.abs(dy);
            const oH = adx <= (src.w + tgt.w) / 4;
            const oV = ady <= (src.h + tgt.h) / 4;
            if (oH && dy > 0) return { x: bcx, y: tgt.y };
            if (oH && dy < 0) return { x: bcx, y: tgt.y + tgt.h };
            if (oV && dx > 0) return { x: tgt.x, y: bcy };
            if (oV && dx < 0) return { x: tgt.x + tgt.w, y: bcy };
            if (dy > 0 && ady >= adx) return { x: bcx, y: tgt.y };
            if (dy < 0 && ady >= adx) return { x: bcx, y: tgt.y + tgt.h };
            if (dx > 0) return { x: tgt.x, y: bcy };
            if (dx < 0) return { x: tgt.x + tgt.w, y: bcy };
            return adx >= ady
                ? (dx >= 0 ? { x: tgt.x, y: bcy } : { x: tgt.x + tgt.w, y: bcy })
                : (dy >= 0 ? { x: bcx, y: tgt.y } : { x: bcx, y: tgt.y + tgt.h });
        }

        const EPS = 0.01;
        function inRect(pt, r) {
            return pt.x > r.x + EPS && pt.x < r.x + r.w - EPS &&
                pt.y > r.y + EPS && pt.y < r.y + r.h - EPS;
        }

        const edgeGroups = [].slice.call(document.querySelectorAll('.sc-edges .sc-edge'));
        out.archi_renderizzati = edgeGroups.length;
        let conIntersezione = 0, punteTot = 0, punteOltre2 = 0, maxDist = 0;
        let dritti = 0, conVia = 0;
        const archiInterseccati = [], puniDettaglio = [];
        edgeGroups.forEach(g => {
            const eid = g.getAttribute('data-eid');
            const ed = edgeOf[eid];
            const paths = g.querySelectorAll('path');
            const p = paths[paths.length - 1];
            if (!p || !p.getTotalLength) return;
            /* campionamento reale del path renderizzato (M/L/Q tutti inclusi) */
            const len = p.getTotalLength();
            const step = 1.5;
            const n = Math.max(2, Math.min(4000, Math.ceil(len / step)));
            let hits = null;
            for (let k = 0; k <= n; k++) {
                const pt = p.getPointAtLength(len * k / n);
                const P = { x: pt.x, y: pt.y };
                for (let q = 0; q < ids.length; q++) {
                    const nid = ids[q];
                    if (ed && (nid === ed.from || nid === ed.to)) continue;   // endpoint esclusi
                    if (inRect(P, rects[nid])) { hits = nid; break; }
                }
                if (hits) break;
            }
            if (hits) { conIntersezione++; archiInterseccati.push(eid + '->' + hits); }

            /* forma: dritto (2 punti di campionamento della geometria base) */
            const dAttr = p.getAttribute('d') || '';
            const nSeg = (dAttr.match(/[LQqCcSsAa]/g) || []).length;
            if (nSeg <= 1 && dAttr.indexOf('Q') < 0) dritti++; else conVia++;

            /* (3) punta freccia */
            const poly = g.querySelector('polygon');
            if (poly) {
                const tr = poly.getAttribute('transform') || '';
                const m = /^translate\(([-0-9.eE+]+),([-0-9.eE+]+)\)/.exec(tr);
                if (m && ed && rects[ed.from] && rects[ed.to]) {
                    const tip = { x: +m[1], y: +m[2] };
                    const caso = g.getAttribute('data-caso') || '';
                    const T = rects[ed.to], tx = T.x + T.w / 2;
                    let dist;
                    if (caso.indexOf('C9') === 0) {
                        /* U sotto/sopra: la punta va sul lato B o T del target */
                        const dT = Math.hypot(tip.x - tx, tip.y - T.y);
                        const dB = Math.hypot(tip.x - tx, tip.y - (T.y + T.h));
                        dist = Math.min(dT, dB);
                    } else if (caso.indexOf('C8') === 0) {
                        /* bus organigramma: drop sul T.T */
                        dist = Math.hypot(tip.x - tx, tip.y - T.y);
                    } else {
                        const anc = targetAnchor(rects[ed.from], rects[ed.to]);
                        dist = Math.hypot(tip.x - anc.x, tip.y - anc.y);
                    }
                    punteTot++;
                    if (dist > maxDist) maxDist = dist;
                    if (dist > 2 + 1e-6) { punteOltre2++; puniDettaglio.push({ eid: eid, dist: +dist.toFixed(3), caso: caso }); }
                } else if (poly) {                } else if (poly) {
                    /* polygon senza transform interpretabile: punta non misurabile -> conta come oltre */
                    punteTot++; punteOltre2++; puniDettaglio.push({ eid: eid, dist: null, raw: tr });
                }
            }
        });
        out.archi_con_intersezione = conIntersezione;
        out.archi_interseccati = archiInterseccati;
        out.punte_totali = punteTot;
        out.punte_oltre_2px = punteOltre2;
        out.punte_dettaglio = puniDettaglio;
        out.punte_max_dist = +maxDist.toFixed(3);
        out.archi_dritti = dritti;
        out.archi_con_via = conVia;
        return out;
    }, docDef);
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
        console.error('  Alternativa dichiarata: misure geometriche jsdom su DOM reale del modulo (meno ideale).');
        process.exit(2);
    }
    console.log('BROWSER OK: ' + (await browser.version()) + '  fase=' + PHASE);

    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });
    const consoleErrs = [];
    page.on('console', m => { if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrs.push('console.error: ' + m.text()); });
    page.on('pageerror', e => consoleErrs.push('pageerror: ' + e.message));

    const url = pathToFileURL(path.join(ROOT, 'qa_ui', 'schemi.html')).href;
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    /* attesa harness reale */
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
        console.error('BLOCKED — harness qa_ui/schemi.html non pronto. ' + JSON.stringify(consoleErrs.slice(0, 5)));
        await browser.close();
        process.exit(2);
    }

    /* seed dei 5 doc (solo runtime store, nessun file condiviso) */
    const payload = DOCS.map(d => ({
        id: d.id, kind: 'schema', title: 'S14 ' + d.type,
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

    const docsOut = [];
    for (const d of DOCS) {
        const opened = await page.evaluate(id => window.__qaHarness.open(id), d.id);
        if (!opened) { consoleErrs.push('open fallito: ' + d.id); continue; }
        /* attesa nodi renderizzati */
        let nOk = false;
        for (let i = 0; i < 100; i++) {
            const n = await page.evaluate(() => document.querySelectorAll('g.sc-node[data-nid]').length);
            if (n === d.nodes.length) { nOk = true; break; }
            await sleep(60);
        }
        if (!nOk) consoleErrs.push('nodi non tutti renderizzati su ' + d.id);
        await sleep(320);   // settle render + eventuale separation all'apertura
        const m = await measure(page, d);
        docsOut.push(m);
        const fp = path.join(QA_DIR, 's14_' + d.type + '.png');
        await page.screenshot({ path: fp });
        console.log('[' + d.type + '] nodi=' + m.nodi_renderizzati + '/' + m.nodi_attesi +
            ' archi=' + m.archi_renderizzati +
            ' intersezioni=' + m.archi_con_intersezione + JSON.stringify(m.archi_interseccati) +
            ' coppie24/40=' + m.coppie_violate +
            ' punte>2px=' + m.punte_oltre_2px + '/' + m.punte_totali +
            ' (max ' + m.punte_max_dist + 'px)' +
            ' dritti=' + m.archi_dritti + ' via=' + m.archi_con_via +
            ' SHOT s14_' + d.type + '.png');
    }

    const tot = {
        doc: docsOut.length,
        archi: docsOut.reduce((s, d) => s + d.archi_renderizzati, 0),
        archi_con_intersezione: docsOut.reduce((s, d) => s + d.archi_con_intersezione, 0),
        coppie_violate: docsOut.reduce((s, d) => s + d.coppie_violate, 0),
        punte_totali: docsOut.reduce((s, d) => s + d.punte_totali, 0),
        punte_oltre_2px: docsOut.reduce((s, d) => s + d.punte_oltre_2px, 0),
        nodi_mancanti: docsOut.reduce((s, d) => s + (d.nodi_mancanti ? d.nodi_mancanti.length : 0), 0)
    };
    tot.punte_pct_oltre_2px = tot.punte_totali
        ? +(100 * tot.punte_oltre_2px / tot.punte_totali).toFixed(2) : null;

    const METHOD = 'node qa_browser/qaS14_schemi.js [prima|dopo] — Chromium headless (puppeteer) su ' +
        'file://qa_ui/schemi.html; archi campionati con path.getPointAtLength(step 1.5px, interior eps 0.01px, ' +
        'nodi endpoint esclusi); coppie violate = gapX<24px E gapY<40px; punta = translate(<polygon>) vs ancora ' +
        'target su bbox secondo la regola S1 (violazione se dist>2px+1e-6); screenshot qa/s14_<tipo>.png';

    const outPath = path.join(QA_DIR, 's14_measures.json');
    let obj = {};
    try { obj = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { obj = {}; }
    obj.method = METHOD;
    obj[PHASE] = {
        command: 'node qa_browser/qaS14_schemi.js ' + PHASE,
        timestamp: new Date().toISOString(),
        viewport: VW + 'x' + VH,
        totale: tot,
        docs: docsOut,
        errori: consoleErrs.slice(0, 20)
    };
    obj.screenshot = DOCS.map(d => 'qa/s14_' + d.type + '.png');
    fs.writeFileSync(outPath, JSON.stringify(obj, null, 1));

    console.log('\n===== TOTALE ' + PHASE.toUpperCase() + ' =====');
    console.log('archi totali: ' + tot.archi);
    console.log('archi con intersezione (non-endpoint): ' + tot.archi_con_intersezione);
    console.log('coppie nodi violate (24/40): ' + tot.coppie_violate);
    console.log('punte freccia >2px: ' + tot.punte_oltre_2px + '/' + tot.punte_totali +
        ' = ' + tot.punte_pct_oltre_2px + '%');
    console.log('nodi mancanti nel render: ' + tot.nodi_mancanti);
    if (consoleErrs.length) console.log('ERRORI: ' + JSON.stringify(consoleErrs.slice(0, 8)));
    console.log('-> qa/s14_measures.json (chiave "' + PHASE + '")');
    await browser.close();
    process.exit(consoleErrs.length ? 1 : 0);
})().catch(e => { console.error('FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(3); });
