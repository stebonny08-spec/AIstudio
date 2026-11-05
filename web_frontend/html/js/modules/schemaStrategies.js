/* ============================================================
   modules/schemaStrategies.js — REGISTRO STRATEGIE DI SCHEMA
   Architettura a strategie: ogni tipo di schema (Albero, Mappa
   concettuale, Sinistra→destra, Schema libero,
   Riassunto visuale) ha un oggetto Strategy con comportamenti
   REALMENTE diversi:

     initialLayout(nodes, edges)      -> disposizione iniziale
     autoLayout(nodes, edges)         -> targets {id:{x,y}} o null (disabilitato)
     placeNewNode(padre, graph, modo) -> {x,y} per il nuovo nodo
                                         (modo: 'figlio' | 'fratello')
     canConnect(from, to, graph)      -> {ok, motivo}
     edgeStyle()                      -> {forma:'gomito'|'curva'|'dritta',
                                          freccia:bool, etichetta:bool}
     snap()                           -> {attivo:bool, griglia:n}
     ui()                             -> {pulsanti:[...], pannelloTesto:bool,
                                          guide:'colonne'|'righe'|null}

   Extra (opzionali, usati dall'editor):
     nodeSize()      -> {w,h,fontSize?} dimensione default nodo
     asseFlusso      -> 'x' | 'y' | null  (arco "indietro" reso a curva)
     evidenziaRadice -> bool              (destacca la radice dell'albero)
     vistaCard       -> bool              (nodi come card multilinea)

   API: window.SchemaStrategies = { SCHEMA_STRATEGIES, getStrategy, migrateSchema }
   ============================================================ */
(function () {
    'use strict';

    // ============================================================
    // UTILITÀ CONDIVISE
    // ============================================================

    function validEdges(edges) {
        return (edges || []).filter(e => e && !e.extra);
    }

    function nodeOf(graph, id) {
        const ns = (graph && graph.nodes) || [];
        for (let i = 0; i < ns.length; i++) if (ns[i].id === id) return ns[i];
        return null;
    }

    function labelOf(n) {
        if (!n) return 'Nodo';
        const t = String(n.text == null ? '' : n.text).split('\n')[0].trim();
        return t ? (t.length > 26 ? t.slice(0, 25) + '…' : t) : 'Nodo';
    }

    /* Adiacenze con archi non-extra: figli e (primo) padre. */
    function adjacency(graph) {
        const kids = {}, parent = {};
        ((graph && graph.nodes) || []).forEach(n => { kids[n.id] = []; parent[n.id] = null; });
        validEdges(graph && graph.edges).forEach(e => {
            if (kids[e.from] && parent[e.to] !== undefined && parent[e.to] === null) {
                kids[e.from].push(e.to);
                parent[e.to] = e.from;
            }
        });
        return { kids: kids, parent: parent };
    }

    /* Esiste un percorso (via archi validi) da `start` a `target`? */
    function reachable(kids, start, target) {
        if (start === target) return true;
        const seen = {};
        const stack = [start];
        while (stack.length) {
            const cur = stack.pop();
            if (seen[cur]) continue;
            seen[cur] = true;
            const ch = kids[cur] || [];
            for (let i = 0; i < ch.length; i++) {
                if (ch[i] === target) return true;
                stack.push(ch[i]);
            }
        }
        return false;
    }

    function incomingCount(graph, id) {
        return validEdges(graph && graph.edges).filter(e => e.to === id).length;
    }

    function duplicate(graph, from, to) {
        return ((graph && graph.edges) || []).some(e => e.from === from && e.to === to);
    }

    function rectCollides(a, b, pad) {
        pad = pad || 8;
        return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x ||
            a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
    }

    function collidesAny(nodes, r, skipId) {
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.id === skipId) continue;
            if (rectCollides(n, r)) return true;
        }
        return false;
    }

    /* Trova uno spot libero partendo da `hint`, senza toccare gli altri nodi. */
    function freeSpot(nodes, size, hint) {
        let x = Math.round(hint.x), y = Math.round(hint.y);
        let guard = 0;
        while (collidesAny(nodes, { x: x, y: y, w: size.w, h: size.h }) && guard++ < 48) {
            x += 60;
            if (guard % 7 === 0) { x = Math.round(hint.x); y += 110; }
        }
        return { x: x, y: y };
    }

    function contentHint(nodes) {
        if (!nodes || !nodes.length) return { x: 300, y: 120 };
        let maxx = -Infinity, sumy = 0;
        nodes.forEach(n => { maxx = Math.max(maxx, n.x + n.w); sumy += n.y + n.h / 2; });
        return { x: maxx + 70, y: Math.round(sumy / nodes.length) };
    }

    // ============================================================
    // S4 - SEPARAZIONE NODI (collision-resolution)
    // Margini: 32px orizzontale / 48px verticale (C11 R19). Due nodi sono accettabili
    // se gapX >= 32 OPPURE gapY >= 48; la violazione e' solo quando entrambi
    // le soglie sono sotto. Risoluzione sull'asse che richiede il dislocamento
    // minore, monotona (solo +x / +y sul nodo "after"), deterministica e
    // IDEMPOTENTE: rilanciare su un layout gia' separato non sposta nulla.
    // Copre TUTTI i nodi (orfani/disconnessi e righe extra inclusi): la regola
    // e' puramente geometrica, non topologica.
    // ============================================================
    const SEP_MX = 32, SEP_MY = 48, SEP_PASS = 64;

    function separateRects(list) {
        let moved = false;
        for (let pass = 0; pass < SEP_PASS; pass++) {
            let any = false;
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const A = list[i], B = list[j];
                    if (!isFinite(A.x) || !isFinite(A.y) || !isFinite(A.w) || !isFinite(A.h) ||
                        !isFinite(B.x) || !isFinite(B.y) || !isFinite(B.w) || !isFinite(B.h)) continue;
                    const gapX = Math.max(A.x - (B.x + B.w), B.x - (A.x + A.w));
                    const gapY = Math.max(A.y - (B.y + B.h), B.y - (A.y + A.h));
                    if (gapX >= SEP_MX || gapY >= SEP_MY) continue;   // almeno una soglia rispettata
                    const needX = SEP_MX - gapX, needY = SEP_MY - gapY;
                    if (needX <= needY) {
                        const hi = A.x <= B.x ? B : A;   // sposta a destra il nodo destro
                        hi.x = Math.round(hi.x + needX);
                    } else {
                        const dn = A.y <= B.y ? B : A;   // sposta in giu' il nodo inferiore
                        dn.y = Math.round(dn.y + needY);
                    }
                    any = moved = true;
                }
            }
            if (!any) break;
        }
        return moved;
    }

    /* Separa i nodi in place (posizioni editor: apertura/caricamento). */
    function separateNodes(nodes) {
        const list = (nodes || []).filter(n => n &&
            isFinite(n.x) && isFinite(n.y) && isFinite(n.w) && isFinite(n.h));
        return separateRects(list);
    }

    /* Separa i TARGET di un auto-layout ({id:{x,y}}) usando w/h dei nodi:
       nessuna mutazione dei nodi (l'animazione li porta sui target gia' separati). */
    function separateTargets(nodes, targets) {
        if (!targets || !nodes || !nodes.length) return false;
        const list = [];
        nodes.forEach(n => {
            const t = targets[n.id];
            if (!t || !isFinite(t.x) || !isFinite(t.y) || !isFinite(n.w) || !isFinite(n.h)) return;
            list.push({ t: t, x: t.x, y: t.y, w: n.w, h: n.h });
        });
        const moved = separateRects(list);
        if (moved) list.forEach(it => { it.t.x = it.x; it.t.y = it.y; });
        return moved;
    }

    // ============================================================
    // ALGORITMI DI LAYOUT
    // ============================================================

    /* Tidy tree (fratelli centrati sotto il padre, profondità = riga/colonna). */
        function tidyTreeTargets(nodes, edges, dir) {
        const targets = {};
        if (!nodes || !nodes.length) return targets;
        const { kids, parent } = adjacency({ nodes: nodes, edges: edges });
        const byId = {};
        nodes.forEach(n => { byId[n.id] = n; });
        // incidenza su soli archi VALIDI (extra esclusi): orfani = nessun arco incidente
        const incident = {};
        nodes.forEach(n => { incident[n.id] = 0; });
        validEdges(edges).forEach(e => {
            if (byId[e.from] && byId[e.to]) { incident[e.from]++; incident[e.to]++; }
        });
        const orphanSet = {};
        nodes.forEach(n => { if (!incident[n.id]) orphanSet[n.id] = true; });
        // radici = senza genitore valido e con almeno un figlio (gli orfani no)
        let roots = nodes.filter(n => !orphanSet[n.id] && !parent[n.id] && (kids[n.id] || []).length)
            .map(n => n.id);
        if (!roots.length) roots = nodes.filter(n => !orphanSet[n.id]).map(n => n.id);
        const seen = {};
        let leaf = 0, maxDepth = 0;
        function place(id, depth) {
            if (seen[id]) return leaf;
            seen[id] = true;
            if (depth > maxDepth) maxDepth = depth;
            const ch = (kids[id] || []).filter(c => !seen[c] && byId[c]);
            let pos;
            if (!ch.length) { pos = leaf; leaf++; }
            else {
                const vals = ch.map(c => place(c, depth + 1));
                pos = (Math.min.apply(null, vals) + Math.max.apply(null, vals)) / 2;
            }
            if (dir === 'lr') targets[id] = { x: 60 + depth * 260, y: 60 + pos * 110 };
            else targets[id] = { x: 60 + pos * 230, y: 60 + depth * 130 };
            return pos;
        }
        roots.forEach(r => place(r, 0));
        const rowOf = (row, col) => (dir === 'lr')
            ? { x: 60 + row * 260, y: 60 + col * 110 }
            : { x: 60 + col * 230, y: 60 + row * 130 };
        // residui NON visitati (cicli/archi extra): riga sotto l'albero (distanze finite)
        let row = maxDepth + 1, col = 0;
        nodes.forEach(n => {
            if (seen[n.id] || orphanSet[n.id]) return;
            targets[n.id] = rowOf(row, col++);
            seen[n.id] = true;
        });
        // ORFANI (nessun arco): riga separata (spec 2.3)
        row++; col = 0;
        nodes.forEach(n => {
            if (seen[n.id]) return;
            targets[n.id] = rowOf(row, col++);
            seen[n.id] = true;
        });
        return targets;
    }

    /* Livello = lunghezza del cammino massimo dalle sorgenti (Sugiyama
       semplificato), con tetto per i cicli. */
        function layerMap(nodes, edges) {
        const layer = {};
        const ns = nodes || [];
        if (!ns.length) return layer;
        ns.forEach(n => { layer[n.id] = 0; });
        const byId = {};
        ns.forEach(n => { byId[n.id] = n; });
        const adj = {}, indeg = {};
        ns.forEach(n => { adj[n.id] = []; indeg[n.id] = 0; });
        validEdges(edges).forEach(e => {
            if (!byId[e.from] || !byId[e.to]) return;
            adj[e.from].push(e.to);
            indeg[e.to]++;
        });
        const done = {};
        const docOrder = ns.map(n => n.id);
        let progress = true;
        while (progress) {
            progress = false;
            // sorgenti correnti (indeg 0) in ordine di documento: cammino massimo
            const frontier = docOrder.filter(id => !done[id] && indeg[id] === 0);
            frontier.forEach(id => {
                done[id] = true;
                adj[id].forEach(ch => {
                    if (done[ch]) return;   // arco verso nodo gia' processato (ciclo) -> ignorato
                    if (layer[ch] < layer[id] + 1) layer[ch] = layer[id] + 1;
                    indeg[ch]--;
                });
                progress = true;
            });
            if (!progress) {
                // ciclo puro: il primo residuo (ordine doc) diventa sorgente locale
                const rest = docOrder.filter(id => !done[id]);
                if (!rest.length) break;
                const id = rest[0];
                done[id] = true;
                adj[id].forEach(ch => {
                    if (done[ch]) return;
                    if (layer[ch] < layer[id] + 1) layer[ch] = layer[id] + 1;
                    indeg[ch]--;
                });
                progress = true;
            }
        }
        // ORFANI (nessun arco valido incidente): colonna propria dopo gli altri layer
        let maxL = 0;
        docOrder.forEach(id => { if (layer[id] > maxL) maxL = layer[id]; });
        ns.forEach(n => {
            const inc = validEdges(edges).some(e => e.to === n.id && byId[e.from]);
            const out = validEdges(edges).some(e => e.from === n.id && byId[e.to]);
            if (!inc && !out) layer[n.id] = maxL + 1;
        });
        return layer;
    }

    /* Disposizione a colonne (axis 'x') o righe (axis 'y') per layer. */
        function layerTargets(nodes, edges, axis) {
        const targets = {};
        if (!nodes || !nodes.length) return targets;
        const layer = layerMap(nodes, edges);
        const groups = {};
        nodes.forEach(n => {
            const L = layer[n.id] || 0;
            (groups[L] = groups[L] || []).push(n);
        });
        Object.keys(groups).map(Number).sort((p, q) => p - q).forEach(L => {
            const g = groups[L];
            // stack verticale CENTRATO sul layer (spec 2.3 lr)
            g.forEach((n, i) => {
                const off = Math.round((i - (g.length - 1) / 2) * 110);
                if (axis === 'x') targets[n.id] = { x: 60 + L * 260, y: off };
                else targets[n.id] = { x: Math.round((i - (g.length - 1) / 2) * 230), y: 60 + L * 130 };
            });
        });
        return targets;
    }

    /* Mappa: radiale dall'hub (selezionato o di grado massimo), BFS non diretto. */
    function radialTargets(nodes, edges, hubId) {
        const targets = {};
        if (!nodes || !nodes.length) return targets;
        const byId = {};
        nodes.forEach(n => { byId[n.id] = n; });
        // grado (non diretto)
        const deg = {};
        nodes.forEach(n => { deg[n.id] = 0; });
        validEdges(edges).forEach(e => {
            if (byId[e.from] && byId[e.to]) { deg[e.from]++; deg[e.to]++; }
        });
        let hub = byId[hubId];
        if (!hub) {
            let best = null;
            nodes.forEach(n => {
                if (!best || deg[n.id] > deg[best.id]) best = n;
            });
            hub = best;
        }
                // coordinate hub con guardie isFinite: nessun NaN puo' entrare nei target
        const hw = isFinite(hub.w) ? hub.w : 170, hh = isFinite(hub.h) ? hub.h : 60;
        const cx = (isFinite(hub.x) ? hub.x : 0) + hw / 2;
        const cy = (isFinite(hub.y) ? hub.y : 0) + hh / 2;
        // BFS non diretto
        const depth = {};
        depth[hub.id] = 0;
        const q = [hub.id];
        const und = {};
        nodes.forEach(n => { und[n.id] = []; });
        validEdges(edges).forEach(e => {
            if (und[e.from] && und[e.to]) { und[e.from].push(e.to); und[e.to].push(e.from); }
        });
        while (q.length) {
            const cur = q.shift();
            (und[cur] || []).forEach(nb => {
                if (!(nb in depth)) { depth[nb] = depth[cur] + 1; q.push(nb); }
            });
        }
        // anelli per profondita': SOLO nodi raggiungibili (BLOCCO 2.2a: niente depth=9999)
        const rings = {};
        nodes.forEach(n => {
            if (!(n.id in depth)) return;
            (rings[depth[n.id]] = rings[depth[n.id]] || []).push(n);
        });
        targets[hub.id] = { x: Math.round(cx - hw / 2), y: Math.round(cy - hh / 2) };
        let maxR = 170;
        Object.keys(rings).forEach(dk => {
            const d = Number(dk);
            if (d === 0) return;
            const ring = rings[dk];
            // raggio contenuto: il moltiplicatore di profondita' e' limitato (max 8)
            const r = Math.max(170, ring.length * 52) * Math.min(d > 1 ? d : 1, 8);
            if (r > maxR) maxR = r;
            ring.forEach((n, i) => {
                const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, ring.length) + d * 0.35;
                const nw = isFinite(n.w) ? n.w : 170, nh = isFinite(n.h) ? n.h : 60;
                targets[n.id] = {
                    x: Math.round(cx + r * Math.cos(a) - nw / 2),
                    y: Math.round(cy + r * Math.sin(a) - nh / 2)
                };
            });
        });
        // Nodi irraggiungibili dall'hub: righe/griglie LOCALI sotto il contenuto,
        // distanze finite e contenute (prima: 9999 -> +-1.5 milioni di px -> canvas vuoto)
        const unreachable = nodes.filter(n => !(n.id in depth));
        unreachable.forEach((n, i) => {
            const row = Math.floor(i / 8), col = i % 8;
            const nw = isFinite(n.w) ? n.w : 170, nh = isFinite(n.h) ? n.h : 60;
            targets[n.id] = {
                x: Math.round(cx + (col - 3.5) * 230 - nw / 2),
                y: Math.round(cy + maxR + 190 + row * 130 - nh / 2)
            };
        });
        return targets;
    }

    /* Stack verticale (riassunto visuale). */
        /* Stack verticale (riassunto visuale): colonna unica in ordine BFS dalle
       radici, residui di cicli in ordine di creazione e ORFANI accodati per ultimi. */
    function stackTargets(nodes, edges) {
        const targets = {};
        if (!nodes || !nodes.length) return targets;
        const es = validEdges(edges);
        const byId = {};
        nodes.forEach(n => { byId[n.id] = n; });
        const hasIn = {}, hasOut = {};
        nodes.forEach(n => { hasIn[n.id] = false; hasOut[n.id] = false; });
        es.forEach(e => {
            if (byId[e.from] && byId[e.to]) { hasOut[e.from] = true; hasIn[e.to] = true; }
        });
        const ordered = [], placed = {};
        const queue = [];
        nodes.forEach(n => {          // BFS dalle radici (uscite valide, nessuna entrata)
            if (hasOut[n.id] && !hasIn[n.id] && !placed[n.id]) {
                placed[n.id] = true; ordered.push(n); queue.push(n);
            }
        });
        while (queue.length) {
            const cur = queue.shift();
            es.forEach(e => {
                if (e.from !== cur.id || !byId[e.to] || placed[e.to]) return;
                placed[e.to] = true;
                const nn = byId[e.to];
                ordered.push(nn);
                queue.push(nn);
            });
        }
        nodes.forEach(n => {          // residui con archi (cicli): ordine di creazione
            if (!placed[n.id] && (hasIn[n.id] || hasOut[n.id])) { placed[n.id] = true; ordered.push(n); }
        });
        nodes.forEach(n => {          // ORFANI accodati per ultimi (spec 2.3)
            if (!placed[n.id]) { placed[n.id] = true; ordered.push(n); }
        });
        let x = ordered.reduce((m, n) => (isFinite(n.x) ? Math.min(m, n.x) : m), Infinity);
        if (!isFinite(x)) x = 80;
        let y = 80;
        ordered.forEach(n => {
            targets[n.id] = { x: Math.round(x), y: Math.round(y) };
            y += (isFinite(n.h) ? n.h : 60) + 28;
        });
        return targets;
    }

    /* Force deterministico della mappa (BLOCCO 2.2d):
       - 300 iterazioni fisse;
       - seed = posizioni correnti (cerchio di riserva se assenti/NaN);
       - doppio buffer: nessuna mutazione in-place nella stessa sweep;
       - clamp massimo di spostamento per iterazione;
       - orfani inclusi (attrazione al seed + repulsione);
       - al termine il bounding box viene recentrato sul centro (0,0).
       Stesso input -> stessi output (nessun valore casuale). */
    function forceRelax(nodes, edges, seed) {
        const targets = {};
        if (!nodes || !nodes.length) return targets;
        const ids = nodes.map(n => n.id);
        const seedPos = {};
        ids.forEach((id, i) => {
            const s = seed ? seed[id] : null;
            if (s && isFinite(s.x) && isFinite(s.y)) seedPos[id] = { x: s.x, y: s.y };
            else {
                const a = i * 2 * Math.PI / Math.max(1, ids.length);   // cerchio di riserva
                const n = nodes[i];
                const nw = n && isFinite(n.w) ? n.w : 170, nh = n && isFinite(n.h) ? n.h : 60;
                seedPos[id] = { x: Math.round(Math.cos(a) * 300 - nw / 2), y: Math.round(Math.sin(a) * 300 - nh / 2) };
            }
        });
        const A = {}, B = {};
        ids.forEach(id => {
            A[id] = { x: seedPos[id].x, y: seedPos[id].y };
            B[id] = { x: seedPos[id].x, y: seedPos[id].y };
        });
        const es = validEdges(edges).filter(e => A[e.from] && A[e.to]);
        const REP_D2 = 260 * 260, REP_F = 0.012, REST = 230, SPRING = 0.03;
        const ANCHOR = 0.015, MAX_STEP = 40, ITER = 300;
        let cur = A, nxt = B;
        for (let it = 0; it < ITER; it++) {
            ids.forEach(id => { nxt[id].x = cur[id].x; nxt[id].y = cur[id].y; });   // double buffer
            for (let i = 0; i < ids.length; i++) {                                 // repulsione per coppia
                for (let j = i + 1; j < ids.length; j++) {
                    const P = cur[ids[i]], Q = cur[ids[j]];
                    let dx = Q.x - P.x, dy = Q.y - P.y;
                    let d2 = dx * dx + dy * dy;
                    if (d2 < 1) { dx = ((i + j) % 2) ? 1 : -1; dy = 1; d2 = 2; }
                    if (d2 < REP_D2) {
                        const f = REP_D2 * REP_F / d2;
                        nxt[ids[i]].x -= dx * f; nxt[ids[i]].y -= dy * f;
                        nxt[ids[j]].x += dx * f; nxt[ids[j]].y += dy * f;
                    }
                }
            }
            es.forEach(e => {                                                   // molla sugli archi
                const P = cur[e.from], Q = cur[e.to];
                const dx = Q.x - P.x, dy = Q.y - P.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = (d - REST) * SPRING;
                nxt[e.from].x += dx / d * f; nxt[e.from].y += dy / d * f;
                nxt[e.to].x -= dx / d * f; nxt[e.to].y -= dy / d * f;
            });
            ids.forEach(id => {   // attrazione al seed: bounding box stabile, orfani inclusi
                nxt[id].x += (seedPos[id].x - cur[id].x) * ANCHOR;
                nxt[id].y += (seedPos[id].y - cur[id].y) * ANCHOR;
            });
            ids.forEach(id => {   // clamp dello spostamento per iterazione + guardie
                let dx = nxt[id].x - cur[id].x, dy = nxt[id].y - cur[id].y;
                const m = Math.sqrt(dx * dx + dy * dy);
                if (isFinite(m) && m > MAX_STEP) { dx = dx / m * MAX_STEP; dy = dy / m * MAX_STEP; }
                if (!isFinite(dx)) dx = 0;
                if (!isFinite(dy)) dy = 0;
                const nx = cur[id].x + dx, ny = cur[id].y + dy;
                nxt[id].x = isFinite(nx) ? nx : cur[id].x;
                nxt[id].y = isFinite(ny) ? ny : cur[id].y;
            });
            const t = cur; cur = nxt; nxt = t;
        }
        // arrotonda e recentra il bounding box sul centro (0,0)
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        ids.forEach(id => {
            const x = Math.round(cur[id].x), y = Math.round(cur[id].y);
            targets[id] = { x: x, y: y };
            if (x < minx) minx = x;
            if (x > maxx) maxx = x;
            if (y < miny) miny = y;
            if (y > maxy) maxy = y;
        });
        if (isFinite(minx) && isFinite(miny) && isFinite(maxx) && isFinite(maxy)) {
            const ox = Math.round((minx + maxx) / 2), oy = Math.round((miny + maxy) / 2);
            ids.forEach(id => { targets[id].x -= ox; targets[id].y -= oy; });
        }
        return targets;
    }

    // ============================================================
    // STRATEGIE
    // ============================================================

    const pulsantiBase = {
        node: { id: 'node', label: '+ Nodo', tooltip: 'Aggiunge un nodo' },
        child: { id: 'child', label: '+ Figlio', tooltip: 'Aggiunge un figlio sotto il nodo selezionato' },
        sibling: { id: 'sibling', label: '+ Fratello', tooltip: 'Aggiunge un nodo allo stesso livello' },
        del: { id: 'del', label: 'Cancella', tooltip: 'Elimina la selezione' },
        connect: { id: 'connect', label: 'Collega', tooltip: 'Collega due nodi (clic sul primo, clic sul secondo)' },
        layout: { id: 'layout', label: 'Auto-layout', tooltip: 'Disposizione automatica in base al tipo di schema' }
    };

    function P() {
        // clone shallow dei pulsanti base
        const out = {};
        for (let i = 0; i < arguments.length; i++) out[arguments[i]] = Object.assign({}, pulsantiBase[arguments[i]]);
        return Object.keys(out).map(k => out[k]);
    }

    const SCHEMA_STRATEGIES = {};

    // ------------------------------------------------------------
    // 1) ALBERO — gerarchia stretta, tidy tree, archi a gomito
    // ------------------------------------------------------------
    SCHEMA_STRATEGIES.albero = {
        id: 'albero',
        evidenziaRadice: true,
        singolaRadice: true,   // la radice non ha fratelli (l'editor mostra un toast)
        asseFlusso: null,
        vistaCard: false,

        nodeSize: function () { return { w: 170, h: 60 }; },

        initialLayout: function (nodes, edges) {
            const t = tidyTreeTargets(nodes, edges, 'tb');
            (nodes || []).forEach(n => {
                const p = t[n.id];
                if (p) { n.x = p.x; n.y = p.y; }
            });
            return nodes;
        },

        autoLayout: function (nodes, edges) {
            if (!nodes || !nodes.length) return null;
            const t = tidyTreeTargets(nodes, edges, 'tb');
            separateTargets(nodes, t);   // S4: collision-resolution fine layout
            return t;
        },

        placeNewNode: function (padre, graph, modo) {
            const size = this.nodeSize();
            const nodes = (graph && graph.nodes) || [];
            if (!padre) return freeSpot(nodes, size, contentHint(nodes));
            if (modo === 'fratello') {
                // stesso livello (stessa y), a destra dei nodi già presenti sulla riga
                let right = padre.x + padre.w;
                nodes.forEach(n => {
                    if (Math.abs(n.y - padre.y) < 24 && n.id !== padre.id) {
                        right = Math.max(right, n.x + n.w);
                    }
                });
                return { x: Math.round(right + 50), y: Math.round(padre.y) };
            }
            // figlio: centrato sotto il padre; i fratelli già presenti spostano a destra
            const kids = validEdges((graph && graph.edges) || []).filter(e => e.from === padre.id).length;
            let x = padre.x + padre.w / 2 - size.w / 2 + kids * 75;
            const y = padre.y + padre.h + 55;
            let guard = 0;
            while (collidesAny(nodes, { x: x, y: y, w: size.w, h: size.h }) && guard++ < 16) x += 75;
            return { x: Math.round(x), y: Math.round(y) };
        },

        canConnect: function (from, to, graph) {
            if (!from || !to) return { ok: false, motivo: 'Collegamento non valido.' };
            if (from === to) return { ok: false, motivo: 'Un nodo dell’albero non può collegarsi a se stesso.' };
            if (duplicate(graph, from, to)) return { ok: false, motivo: 'Questo collegamento esiste già.' };
            const nTo = nodeOf(graph, to), nFrom = nodeOf(graph, from);
            if (incomingCount(graph, to) > 0) {
                const inc = validEdges(graph.edges).filter(e => e.to === to)[0];
                const np = nodeOf(graph, inc.from);
                return {
                    ok: false,
                    motivo: 'Nell’albero ogni nodo ha un solo padre: «' + labelOf(nTo) +
                        '» è già figlio di «' + labelOf(np) + '».'
                };
            }
            const { kids } = adjacency(graph);
            if (reachable(kids, to, from)) {
                return {
                    ok: false,
                    motivo: 'Collegamento vietato: creerebbe un ciclo («' + labelOf(nTo) +
                        '» è già un antenato di «' + labelOf(nFrom) + '»).'
                };
            }
            return { ok: true, motivo: '' };
        },

        edgeStyle: function () { return { forma: 'gomito', freccia: true, etichetta: false }; },
        snap: function () { return { attivo: true, griglia: 10 }; },
        ui: function () {
            return {
                pulsanti: P('node', 'child', 'sibling', 'del', 'connect', 'layout'),
                pannelloTesto: false,
                guide: null
            };
        }
    };

    // ------------------------------------------------------------
    // 2) MAPPA CONCETTUALE — topologia libera, cicli ammessi,
    //    archi curvi con etichetta, layout radiale/force dall'hub
    // ------------------------------------------------------------
    SCHEMA_STRATEGIES.mappa = {
        id: 'mappa',
        evidenziaRadice: false,
        asseFlusso: null,
        vistaCard: false,
        hubId: null,
        siblingFallback: 'child',

        nodeSize: function () { return { w: 170, h: 60 }; },

        initialLayout: function (nodes, edges) {
            // topologia libera: le posizioni manuali restano valide
            return nodes;
        },

        autoLayout: function (nodes, edges) {
            if (!nodes || !nodes.length) return null;
            // BLOCCO 2.2d: force deterministico (300 iter, doppio buffer, clamp)
            // sul seed radiale — sostituisce il vecchio force in-place a 40 iterazioni.
            const seed = radialTargets(nodes, edges, this.hubId);
            const t = forceRelax(nodes, edges, seed);
            separateTargets(nodes, t);   // S4: collision-resolution fine layout
            return t;
        },

        placeNewNode: function (padre, graph, modo) {
            const size = this.nodeSize();
            const nodes = (graph && graph.nodes) || [];
            if (!padre) return freeSpot(nodes, size, contentHint(nodes));
            // vicino al padre, nella prima direzione libera: il resto resta manuale
            const dirs = [
                [1, 0], [0, 1], [-1, 0], [0, -1],
                [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]
            ];
            const dist = 215;
            for (let i = 0; i < dirs.length; i++) {
                const cand = {
                    x: Math.round(padre.x + dirs[i][0] * dist),
                    y: Math.round(padre.y + dirs[i][1] * dist)
                };
                if (!collidesAny(nodes, { x: cand.x, y: cand.y, w: size.w, h: size.h })) return cand;
            }
            return freeSpot(nodes, size, { x: padre.x + 90, y: padre.y + 90 });
        },

        canConnect: function (from, to, graph) {
            if (!from || !to) return { ok: false, motivo: 'Collegamento non valido.' };
            if (from === to) return { ok: false, motivo: 'Un nodo non può collegarsi a se stesso.' };
            if (duplicate(graph, from, to)) return { ok: false, motivo: 'Questo collegamento esiste già.' };
            return { ok: true, motivo: '' }; // cicli ammessi
        },

        edgeStyle: function () { return { forma: 'curva', freccia: true, etichetta: true }; },
        snap: function () { return { attivo: true, griglia: 10 }; },
        ui: function () {
            return {
                pulsanti: P('child', 'sibling', 'del', 'connect', 'layout'),
                pannelloTesto: false,
                guide: null
            };
        }
    };

    // ------------------------------------------------------------
    // 3) SINISTRA → DESTRA — colonne per layer, frecce a destra,
    //    archi contrari a curva, guide verticali
    // ------------------------------------------------------------
    SCHEMA_STRATEGIES.lr = {
        id: 'lr',
        evidenziaRadice: false,
        asseFlusso: 'x',
        vistaCard: false,

        nodeSize: function () { return { w: 170, h: 60 }; },

        initialLayout: function (nodes, edges) {
            const t = layerTargets(nodes, edges, 'x');
            (nodes || []).forEach(n => { const p = t[n.id]; if (p) { n.x = p.x; n.y = p.y; } });
            return nodes;
        },

        autoLayout: function (nodes, edges) {
            if (!nodes || !nodes.length) return null;
            const t = layerTargets(nodes, edges, 'x');
            separateTargets(nodes, t);   // S4: collision-resolution fine layout
            return t;
        },

        placeNewNode: function (padre, graph, modo) {
            const size = this.nodeSize();
            const nodes = (graph && graph.nodes) || [];
            if (!padre) return freeSpot(nodes, size, contentHint(nodes));
            const layer = layerMap(nodes, graph && graph.edges);
            const L = (modo === 'fratello')
                ? (layer[padre.id] || 0)
                : (layer[padre.id] || 0) + 1;
            const same = nodes.filter(n => (layer[n.id] || 0) === L);
            if (same.length) {
                const x = same.reduce((s, n) => s + n.x + n.w / 2, 0) / same.length - size.w / 2;
                const y = Math.max.apply(null, same.map(n => n.y + n.h)) + 30;
                return { x: Math.round(x), y: Math.round(y) };
            }
            return { x: 60 + L * 260, y: 60 };
        },

        canConnect: function (from, to, graph) {
            if (!from || !to) return { ok: false, motivo: 'Collegamento non valido.' };
            if (from === to) return { ok: false, motivo: 'Un nodo non può collegarsi a se stesso.' };
            if (duplicate(graph, from, to)) return { ok: false, motivo: 'Questo collegamento esiste già.' };
            return { ok: true, motivo: '' };
        },

        edgeStyle: function () { return { forma: 'dritta', freccia: true, etichetta: false }; },
        snap: function () { return { attivo: true, griglia: 10 }; },
        ui: function () {
            return {
                pulsanti: P('node', 'child', 'sibling', 'del', 'connect', 'layout'),
                pannelloTesto: false,
                guide: 'colonne'
            };
        }
    };

    // ------------------------------------------------------------
    // 5) SCHEMA LIBERO — nessun vincolo, auto-layout disabilitato,
    //    snap spento, nessuna guida, archi a scelta utente
    // ------------------------------------------------------------
    SCHEMA_STRATEGIES.libero = {
        id: 'libero',
        evidenziaRadice: false,
        asseFlusso: null,
        vistaCard: false,
        opzioni: {},

        nodeSize: function () { return { w: 170, h: 60 }; },

        initialLayout: function (nodes, edges) {
            // nessun layout automatico: le posizioni restano quelle dell'utente
            return nodes;
        },

        autoLayout: function (nodes, edges) {
            return null; // disabilitato: il pulsante resta grigio
        },

        placeNewNode: function (padre, graph, modo) {
            const size = this.nodeSize();
            const nodes = (graph && graph.nodes) || [];
            if (padre && modo === 'fratello') {
                return freeSpot(nodes, size, { x: padre.x + padre.w + 60, y: padre.y });
            }
            if (padre) {
                return freeSpot(nodes, size, { x: padre.x + padre.w + 60, y: padre.y + 40 });
            }
            return freeSpot(nodes, size, contentHint(nodes));
        },

        canConnect: function (from, to, graph) {
            if (!from || !to) return { ok: false, motivo: 'Collegamento non valido.' };
            if (from === to) return { ok: false, motivo: 'Un nodo non può collegarsi a se stesso.' };
            if (duplicate(graph, from, to)) return { ok: false, motivo: 'Questo collegamento esiste già.' };
            return { ok: true, motivo: '' }; // nessun vincolo topologico
        },

        edgeStyle: function () {
            const f = (this.opzioni && this.opzioni.arco) || 'dritta';
            return { forma: (f === 'curva' || f === 'gomito') ? f : 'dritta', freccia: true, etichetta: false };
        },
        snap: function () { return { attivo: false, griglia: 1 }; },
        ui: function () {
            const lay = P('layout')[0];
            lay.disabilitato = true;
            lay.tooltip = 'Schema libero: l’auto-layout è disabilitato (posizionamento manuale)';
            return {
                pulsanti: [
                    Object.assign({}, pulsantiBase.node),
                    Object.assign({}, pulsantiBase.child),
                    Object.assign({}, pulsantiBase.sibling),
                    Object.assign({}, pulsantiBase.del),
                    Object.assign({}, pulsantiBase.connect),
                    lay,
                    {
                        id: 'arco', tipo: 'select', campo: 'arco', label: 'Arco',
                        opzioni: [['dritta', 'Dritto'], ['curva', 'Curvo'], ['gomito', 'Gomito']],
                        tooltip: 'Forma del collegamento (a scelta dell’utente)'
                    }
                ],
                pannelloTesto: false,
                guide: null
            };
        }
    };

    // ------------------------------------------------------------
    // 6) RIASSUNTO VISUALE — card multilinea (titolo+corpo),
    //    stack verticale, archi semplici/facoltativi,
    //    pannello testo affiancato sincronizzato col nodo selezionato
    // ------------------------------------------------------------
    SCHEMA_STRATEGIES.riassunto = {
        id: 'riassunto',
        evidenziaRadice: false,
        asseFlusso: null,
        vistaCard: true,

        nodeSize: function () { return { w: 260, h: 96, fontSize: 16 }; },

        initialLayout: function (nodes, edges) {
            const t = stackTargets(nodes);
            (nodes || []).forEach(n => { const p = t[n.id]; if (p) { n.x = p.x; n.y = p.y; } });
            return nodes;
        },

        autoLayout: function (nodes, edges) {
            if (!nodes || !nodes.length) return null;
            const t = stackTargets(nodes);
            separateTargets(nodes, t);   // S4: collision-resolution fine layout
            return t;
        },

        placeNewNode: function (padre, graph, modo) {
            const size = this.nodeSize();
            const nodes = (graph && graph.nodes) || [];
            if (!padre) {
                const base = nodes.length
                    ? { x: Math.min.apply(null, nodes.map(n => n.x)), y: Math.max.apply(null, nodes.map(n => n.y + n.h)) + 28 }
                    : { x: 120, y: 100 };
                return freeSpot(nodes, size, base);
            }
            // sotto il nodo di riferimento, senza sovrapposizioni
            return freeSpot(nodes, size, { x: padre.x, y: padre.y + padre.h + 28 });
        },

        canConnect: function (from, to, graph) {
            if (!from || !to) return { ok: false, motivo: 'Collegamento non valido.' };
            if (from === to) return { ok: false, motivo: 'Un nodo non può collegarsi a se stesso.' };
            if (duplicate(graph, from, to)) return { ok: false, motivo: 'Questo collegamento esiste già.' };
            return { ok: true, motivo: '' }; // archi facoltativi e semplici
        },

        edgeStyle: function () { return { forma: 'dritta', freccia: false, etichetta: false }; },
        snap: function () { return { attivo: true, griglia: 10 }; },
        ui: function () {
            return {
                pulsanti: P('child', 'del', 'connect', 'layout'),
                pannelloTesto: true,
                guide: null
            };
        }
    };

    // ============================================================
    // API
    // ============================================================

    function getStrategy(type) {
        return SCHEMA_STRATEGIES[type] || SCHEMA_STRATEGIES.libero;
    }

    /* Migra uno schema a un nuovo tipo conservando nodi e archi:
       - ricalcola la validità di ogni arco con canConnect della nuova
         strategia: gli archi non validi vengono marcati `extra:true`
         (l'editor li mostra tratteggiati e li tiene marcati extra (MAI conferma, MAI rimozione: spec 2.5));
       - gli archi tornati validi perdono il marchio extra;
       - riassegna il tipo (persistito nel documento).
       Ritorna lo stesso schema (mutato in place). */
    function migrateSchema(schema, nuovoTipo) {
        if (!schema || typeof schema !== 'object') return schema;
        const s = getStrategy(nuovoTipo);
        schema.type = (SCHEMA_STRATEGIES[nuovoTipo] ? nuovoTipo : 'libero');
        if (!Array.isArray(schema.nodes)) schema.nodes = [];
        if (!Array.isArray(schema.edges)) schema.edges = [];
        const graph = { nodes: schema.nodes, edges: [] };
        schema.edges.forEach(e => {
            if (!e) return;
            const r = s.canConnect(e.from, e.to, graph);
            if (r.ok) {
                if (e.extra) delete e.extra;
                if (e.extraMotivo) delete e.extraMotivo;   // pulizia completa: nessun residuo sul valido
                graph.edges.push(e);
            } else {
                e.extra = true;
                e.extraMotivo = r.motivo;   // archi non validi restano marcati (mai cancellati qui)
            }
        });
        // Nessun conteggio persistito nel doc: extraCount non viene piu'
        // scritto, e i residui di save vecchi vengono rimossi qui (verrebbe
        // altrimenti re-persistito da buildPayload sia ai save vecchi che nuovi).
        delete schema.extraCount;
        return schema;
    }

    const API = {
        SCHEMA_STRATEGIES: SCHEMA_STRATEGIES,
        getStrategy: getStrategy,
        migrateSchema: migrateSchema,
        separateNodes: separateNodes,      // S4: separazione all'apertura (editor)
        separateTargets: separateTargets,  // S4: separazione dei target di layout
        SEP_MX: SEP_MX, SEP_MY: SEP_MY     // margini 32/48 esposti per i test (C11 R19)
    };

    if (typeof window !== 'undefined') window.SchemaStrategies = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
