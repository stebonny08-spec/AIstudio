/* ============================================================
   statistiche.js — G7 "Statistiche AI" (vista dev, metriche per round).
   - registerModule SENZA entrare in App.ORDER -> la home resta a
     8 .home-card (qaD_home 41/41: nessuna 9a card).
   - Accesso: link discreto .dev-link sotto la griglia home
     (aggiunto in app.js renderHome) -> App.go('statistiche').
   - Dati: round11 INLINE = valori REALI di qa/metrics_history.json
     (letti da qa/t2a_measures.json, h8_eval.json, h7_cache_measures.json,
     gate_outputs.json; vedi "method" nel file).
   - Round successivi: append manuale in qa/metrics_history.json
     (schema documentato nel file, validato da tests/testG7_stats.py)
     + window.StatsAI.pushRound(entry) per aggiornare la tabella aperta.
   ============================================================ */
(function () {
    'use strict';
    if (!window.App || typeof window.App.registerModule !== 'function') return;

    var el = window.App.el;
    var esc = window.App.esc || function (s) { return String(s == null ? '' : s); };

    /* ---- round noti: round11 (prima) = misure reali round 11 ---- */
    var ROUNDS = [
        {
            round: '11',
            build: '2026-10-23T16:00:00+02:00',
            metrics: {
                rss_before_mb: 24.5,
                rss_load_mb: 2093.4,
                rss_30req_mb: 2578.2,
                load_sec: 2.01,
                tok_s: { fast: 10.32, think: 9.11, tool: 11.78 },
                latency_p50_ms: 3941.7,
                latency_p95_ms: 4044.9,
                ttft_p50_ms: null,
                ttft_p95_ms: null,
                prompt_cache_hit_rate: 0.45,
                kv_delta_mb: null,
                gate: {
                    total: 60, ok: 45,
                    f01: { n: 15, ok: 15 }, f04: { n: 15, ok: 15 },
                    f10: { n: 15, ok: 10 }, f13: { n: 15, ok: 5 }
                },
                recall5: 1.0,
                recall5_vector: 0.9,
                parity: 1.0,
                router_p95_ms: 0.0107,
                t1_total: 10
            }
        },
        {
            /* Round 12 (dopo): valori reali da qa/metrics_history.json */
            round: '12',
            build: '2026-10-23T19:50:00+02:00',
            metrics: {
                rss_before_mb: 39.5,
                rss_load_mb: 2408.6,
                rss_30req_mb: 39.6,
                load_sec: 2.54,
                tok_s: { fast: 9.53, think: 10.12, tool: 13.86 },
                latency_p50_ms: null,
                latency_p95_ms: null,
                ttft_p50_ms: 699.4,
                ttft_p95_ms: 754.5,
                ttft_hit_p50_ms: 135.0,
                prompt_cache_hit_rate: 0.7767,
                kv_delta_mb: 0.1,
                gate: {
                    total: 60, ok: 58,
                    f01: { n: 15, ok: 15 }, f04: { n: 15, ok: 15 },
                    f10: { n: 15, ok: 15 }, f13: { n: 15, ok: 13 }
                },
                recall5: 1.0,
                recall5_vector: null,
                parity: 1.0,
                router_p95_ms: 0.0108,
                t1_total: 2057
            }
        },
        {
            /* Round 13 (coordinatore): valori reali da qa/metrics_history.json
               (script qa/_add_round13.py, letti da qa/* su disco) */
            round: '13',
            build: '2026-10-24T17:30:00+02:00',
            metrics: {
                rss_before_mb: 39.6,
                rss_load_mb: 2408.3,
                rss_30req_mb: 38.6,
                load_sec: 2.4,
                tok_s: { fast: 11.53, think: 10.07, tool: 13.35 },
                latency_p50_ms: null,
                latency_p95_ms: null,
                ttft_p50_ms: 95972.0,
                ttft_p95_ms: 140964.1,
                prompt_cache_hit_rate: 0.7767,
                kv_delta_mb: -1.0,
                gate: {
                    total: 60, ok: 58,
                    f01: { n: 15, ok: 15 }, f04: { n: 15, ok: 15 },
                    f10: { n: 15, ok: 15 }, f13: { n: 15, ok: 13 }
                },
                recall5: 1.0,
                recall5_vector: null,
                parity: 1.0,
                router_p95_ms: 0.0108,
                t1_total: 2145
            }
        }
    ];

    /* Righe della tabella. dir: -1 = piu' basso e' meglio,
       +1 = piu' alto e' meglio, 0 = solo informativo.
       target (opzionale) = soglia del round 12 (coordinatore). */
    var ROWS = [
        { label: 'RSS a riposo (MB)', path: 'rss_before_mb', dir: -1 },
        { label: 'RSS dopo load modello (MB)', path: 'rss_load_mb', dir: -1 },
        { label: 'RSS dopo 30 richieste (MB)', path: 'rss_30req_mb', dir: -1 },
        { label: 'Tempo load modello (s)', path: 'load_sec', dir: -1, target: 3 },
        { label: 'tok/s profilo fast', path: 'tok_s.fast', dir: 1 },
        { label: 'tok/s profilo think', path: 'tok_s.think', dir: 1 },
        { label: 'tok/s profilo tool', path: 'tok_s.tool', dir: 1 },
        { label: 'Latenza p50 (ms)', path: 'latency_p50_ms', dir: -1 },
        { label: 'Latenza p95 (ms)', path: 'latency_p95_ms', dir: -1 },
        { label: 'TTFT p50 (ms)', path: 'ttft_p50_ms', dir: -1, target: 1500 },
        { label: 'TTFT p95 (ms)', path: 'ttft_p95_ms', dir: -1, target: 2500 },
        { label: 'Prompt cache hit-rate', path: 'prompt_cache_hit_rate', dir: 1, target: 0.7 },
        { label: 'KV cache delta (MB / 30 turni)', path: 'kv_delta_mb', dir: -1, target: 50 },
        { label: 'Gate output validi', path: 'gate.ok', dir: 1, target: 54, gateOf: 'total' },
        { label: 'Gate F01 (flashcard)', path: 'gate.f01.ok', dir: 1, gateOf: 'f01' },
        { label: 'Gate F04 (giudizio tutor)', path: 'gate.f04.ok', dir: 1, gateOf: 'f04' },
        { label: 'Gate F10 (pianifica)', path: 'gate.f10.ok', dir: 1, gateOf: 'f10' },
        { label: 'Gate F13 (script)', path: 'gate.f13.ok', dir: 1, gateOf: 'f13' },
        { label: 'Recall@5 hybrid', path: 'recall5', dir: 1 },
        { label: 'Recall@5 vettoriale', path: 'recall5_vector', dir: 1 },
        { label: 'Parity top-10 (overlap medio)', path: 'parity', dir: 1 },
        { label: 'Router 0-LLM p95 (ms)', path: 'router_p95_ms', dir: -1 },
        { label: 'Test blocco H1 (totale)', path: 't1_total', dir: 0 }
    ];

    var CSS_INJECTED = false;
    function ensureStyle() {
        if (CSS_INJECTED || typeof window.App.style !== 'function') return;
        CSS_INJECTED = true;
        window.App.style(
            '.stats-wrap{padding:4px 8px 24px;max-width:960px}' +
            '.stats-tbl{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}' +
            '.stats-tbl th,.stats-tbl td{border:1px solid #2b3644;padding:6px 9px;text-align:left;vertical-align:top}' +
            '.stats-tbl th{background:#1a222d;font-weight:600;white-space:nowrap}' +
            '.stats-tbl tr:nth-child(even) td{background:#151b23}' +
            '.stats-better{color:#5dd39e;font-weight:600}' +
            '.stats-worse{color:#e57373;font-weight:600}' +
            '.stats-same{color:#9db2c6}' +
            '.stats-na{color:#6b7a8c;font-style:italic}' +
            '.stats-note{margin-top:10px;font-size:12px;color:#8a97a6;line-height:1.5}' +
            /* R13 T3: stili del blocco live (la tabella storica NON cambia) */
            '.stats-live{margin-top:12px;padding:8px 10px;border:1px dashed #2b3644;' +
                'border-radius:6px;font-size:12.5px;color:#9db2c6}' +
            '.stats-live-title{font-weight:700;color:#c6d1de;margin-bottom:4px}' +
            '.stats-live-tag{display:inline-block;font-size:10px;font-weight:800;' +
                'letter-spacing:.04em;text-transform:uppercase;color:#f9974a;' +
                'border:1px solid rgba(249,151,74,.45);background:rgba(249,151,74,.12);' +
                'border-radius:999px;padding:1px 7px;vertical-align:middle}' +
            '.stats-live-row{line-height:1.55}' +
            '.stats-live-k{color:#8a97a6}'
        );
    }

    function roundValue(m, p) {
        if (!m) return null;
        var parts = String(p).split('.'), v = m, i;
        for (i = 0; i < parts.length; i++) {
            if (v == null || typeof v !== 'object') return null;
            v = v[parts[i]];
        }
        return (typeof v === 'number') ? v : null;
    }

    function fmtVal(row, m) {
        var v = roundValue(m, row.path);
        if (v == null) return 'n/d';
        if (row.gateOf) {
            var g = m.gate || {};
            var den = (row.gateOf === 'total') ? g.total : (g[row.gateOf] && g[row.gateOf].n);
            return v + '/' + (den == null ? '?' : den);
        }
        var r = Math.round(v * 100) / 100;
        return String(r).replace('.', ',');
    }

    function deltaCell(row) {
        var td = el('td');
        var lastR = ROUNDS[ROUNDS.length - 1];
        var cur = roundValue(lastR && lastR.metrics, row.path);
        var ref = null, refDesc = '';
        if (row.target != null && typeof row.target === 'number') {
            ref = row.target; refDesc = 'target R12';
        } else if (ROUNDS.length >= 2) {
            ref = roundValue(ROUNDS[ROUNDS.length - 2] && ROUNDS[ROUNDS.length - 2].metrics, row.path);
            refDesc = 'round ' + ROUNDS[ROUNDS.length - 2].round;
        }
        if (cur == null || ref == null) {
            td.className = 'stats-delta stats-na';
            td.textContent = '—';
            return td;
        }
        var diff = cur - ref;
        var good = null;
        if (row.dir === -1) good = diff <= 0;
        else if (row.dir === 1) good = diff >= 0;
        td.className = 'stats-delta ' + (good == null ? 'stats-same' : (good ? 'stats-better' : 'stats-worse'));
        var r = Math.round(diff * 100) / 100;
        td.textContent = (r > 0 ? '+' : '') + String(r).replace('.', ',');
        if (refDesc) td.title = 'rispetto a ' + refDesc;
        return td;
    }

    /* ============================================================
       R13 T3 - BLOCCO LIVE (client DEFENSIVO, stesso pattern di
       AIService in app.js): window.pywebview.api.ai_stats() con
       fallback prudente. La tabella storica sopra resta IDENTICA:
       questo blocco e' un DIV separato sotto la tabella, con sola
       etichetta minima "live". Nessun dato simulato: se l'api manca
       o fallisce -> "n/d (api non disponibile)".
       ============================================================ */
    var _liveRoot = null;    // contenitore del blocco live
    var _liveData = null;    // ultimo payload valido (cache)
    var _liveErr = null;     // ultimo errore/assenza dichiarato
    var _livePending = false;

    function fmtLive(v, dec) {
        if (v == null || typeof v !== 'number' || !isFinite(v)) return 'n/d';
        var d = (dec == null ? 2 : dec);
        var r = Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
        return String(r).replace('.', ',');
    }

    function parseLive(raw) {
        var res = raw;
        if (typeof raw === 'string') {
            try { res = JSON.parse(raw); } catch (e) { return null; }
        }
        if (!res || typeof res !== 'object' || res.error) return null;
        return res;
    }

    function fetchLive() {
        if (_livePending) return;
        _livePending = true;
        try {
            var api = window.pywebview && window.pywebview.api;
            if (!api || typeof api.ai_stats !== 'function') {
                _livePending = false;
                _liveErr = 'api pywebview assente';
                renderLive();
                return;
            }
            var done = function (payload, err) {
                _livePending = false;
                if (payload) { _liveData = payload; _liveErr = null; }
                else { _liveErr = err || 'risposta non valida'; }
                renderLive();
            };
            var p = api.ai_stats();
            if (p && typeof p.then === 'function') {
                p.then(function (r) { done(parseLive(r)); },
                       function (e) { done(null, String((e && e.message) || e)); });
            } else {
                done(parseLive(p));
            }
        } catch (e) {
            _livePending = false;
            _liveErr = String((e && e.message) || e);
            renderLive();
        }
    }

    function liveLine(label, value, title) {
        var line = el('div', 'stats-live-row');
        line.appendChild(el('span', 'stats-live-k', label + ': '));
        var v = el('span', null, value);
        if (title) v.title = title;
        line.appendChild(v);
        return line;
    }

    function renderLive() {
        if (!_liveRoot) return;
        _liveRoot.innerHTML = '';
        var tag = el('span', 'stats-live-tag', 'live');
        var title = el('div', 'stats-live-title');
        title.appendChild(tag);
        title.appendChild(document.createTextNode(' Runtime (questa sessione)'));
        _liveRoot.appendChild(title);

        if (!_liveData) {
            _liveRoot.appendChild(el('div', 'stats-live-row',
                'Dati live non disponibili: ' + esc(_liveErr || 'in attesa...') +
                ' (n/d - nessun valore simulato)'));
            return;
        }
        var d = _liveData;
        var lv = d.live || {};
        var tj = lv.tutor_judgments || d.tutor_judgments || {};

        _liveRoot.appendChild(liveLine('TTFT p50 / p95 (ms)',
            fmtLive(lv.ttft_p50_ms, 1) + ' / ' + fmtLive(lv.ttft_p95_ms, 1) +
            (lv.ttft_n ? ' (n=' + lv.ttft_n + ')' : ''),
            String(lv.ttft_source || '')));
        _liveRoot.appendChild(liveLine('tok/s',
            fmtLive(lv.tok_per_s, 2), String(lv.tok_per_s_source || '')));
        _liveRoot.appendChild(liveLine('Prompt cache hit-rate (runtime)',
            fmtLive(lv.prefix_hit_rate, 4), String(lv.prefix_hit_rate_source || '')));
        _liveRoot.appendChild(liveLine('Acceptance draft',
            lv.acceptance == null ? 'n/d' : fmtLive(lv.acceptance, 3),
            String(lv.acceptance_source || '')));
        _liveRoot.appendChild(liveLine('Chiamate AI (totale)',
            String(d.calls_total != null ? d.calls_total : 'n/d')));
        _liveRoot.appendChild(liveLine('Cache hit (exa/sem/delta)',
            (d.cache_hits ? [d.cache_hits.exact, d.cache_hits.semantic, d.cache_hits.delta].join(' / ') : 'n/d')));
        _liveRoot.appendChild(liveLine('Giudizi tutor (corretto/parziale/errato)',
            [tj.corretto != null ? tj.corretto : 'n/d',
             tj.parziale != null ? tj.parziale : 'n/d',
             tj.errato != null ? tj.errato : 'n/d'].join(' / ')));
        var pr = d.persist;
        _liveRoot.appendChild(liveLine('Persistenza',
            (pr && pr.ok) ? ('ok (' + (pr.writes != null ? pr.writes : 0) + ' scritture)')
                : 'non disponibile',
            (pr && pr.path) ? String(pr.path) : ''));
    }

    var _root = null;

    function render() {
        if (!_root) return;
        ensureStyle();
        _root.innerHTML = '';
        _liveRoot = null;
        var wrap = el('div', 'stats-wrap');
        var head = el('div', 'app-header');
        head.appendChild(el('h2', null, 'Statistiche AI'));
        head.appendChild(el('p', null, 'Metriche per round (OSS G7) — PRIMA→DOPO con delta colorati'));
        wrap.appendChild(head);

        var tbl = el('table', 'stats-tbl');
        var thead = el('thead');
        var trh = el('tr');
        trh.appendChild(el('th', null, 'Metrica'));
        ROUNDS.forEach(function (r, i) {
            trh.appendChild(el('th', null, 'Round ' + esc(String(r.round)) + (i === 0 ? ' (prima)' : ' (dopo)')));
        });
        trh.appendChild(el('th', null, 'Target R12'));
        trh.appendChild(el('th', null, 'Δ'));
        thead.appendChild(trh);
        tbl.appendChild(thead);

        var tbody = el('tbody');
        ROWS.forEach(function (row) {
            var tr = el('tr');
            tr.appendChild(el('td', null, esc(row.label)));
            ROUNDS.forEach(function (r) {
                tr.appendChild(el('td', null, esc(fmtVal(row, r.metrics))));
            });
            tr.appendChild(el('td', null, row.target != null
                ? esc(String(row.target).replace('.', ',')) : '—'));
            tr.appendChild(deltaCell(row));
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);

        /* R13 T3: blocco LIVE separato sotto la tabella (storico INTATTO) */
        _liveRoot = el('div', 'stats-live');
        wrap.appendChild(_liveRoot);

        var note = el('div', 'stats-note',
            'Dati: qa/metrics_history.json (round11 inline = valori reali dei ' +
            'qa/*_measures.json del round 11). Round successivi: append manuale nel ' +
            'file (schema documentato in testa al file, validato da ' +
            'tests/testG7_stats.py) e window.StatsAI.pushRound(entry) a runtime.');
        wrap.appendChild(note);
        _root.appendChild(wrap);

        renderLive();   // mostra cache/attesa senza aspettare la promise
        fetchLive();    // client difensivo: mai eccezione (vedi fetchLive)
    }

    function open(root) {
        _root = root;
        render();
    }

    window.App.registerModule({
        id: 'statistiche',
        title: 'Statistiche AI',
        icon: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 17v-5"/><path d="M12 17V7"/><path d="M17 17v-8"/></svg>',
        desc: 'Metriche per round (RSS, tok/s, cache, gate, recall) — osservabilità G7',
        open: open
    });

    /* API runtime per i round futuri (dopo append in qa/metrics_history.json). */
    window.StatsAI = {
        rounds: function () { return ROUNDS.slice(); },
        pushRound: function (entry) {
            if (!entry || !entry.round || !entry.metrics) return false;
            ROUNDS.push({
                round: String(entry.round),
                build: entry.build || '',
                metrics: entry.metrics,
                method: entry.method || null
            });
            if (_root) render();
            return true;
        }
    };
})();
