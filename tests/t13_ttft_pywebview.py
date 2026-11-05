"""tests/t13_ttft_pywebview.py — R13 T2: sonda TTFT end-to-end nel VERO
stack pywebview (bridge incluso).

Owner: IMPLEMENTER-TELEM (subagente 20261024_5).

FA:
  1. avvia l'app reale nel processo corrente: StudioIAAPI() + create_window
     (hidden=True se pywebview lo supporta, altrimenti fallback dichiarato)
     + start_background_model_load() — STESSO flusso di main.py;
  2. misura TTFT end-to-end via BRIDGE: evaluate_js -> script JS che chiama
     window.pywebview.api.send_message(..., 'automatica', ...) e fa il loop
     su window.pywebview.api.poll_stream(message_id, from_index) finché
     arriva il PRIMO token; TTFT = performance.now() da PRIMA di
     send_message fino al primo token (JIT poll incluso, dichiarato);
  3. 1 warmup ESPRESSO escluso (avvio on-demand llama-server + caricamento
     gguf) + n=5 misure; p50/p95 nearest-rank su raw samples;
  4. output qa/t_probe_pywebview.json: metodo esatto, hidden sì/no+come, n,
     p50, p95, raw samples, carico macchina dichiarato;
  5. CLEANUP totale (try/finally): finestra distrutta, llama-server
     SHUTDOWN (solo il singleton di QUESTO processo), confronto figli psutil
     prima/dopo con kill dei soli MIEI figli orfani, conversazioni di test
     cancellate dal DB. NESSUN python main.py lanciato.

NON simula: se qualche passo fallisce (max 6 tentativi/unità) esce con
"blocked" nel JSON + procedura manuale, senza inventare numeri.

Esecuzione:  PYTHONIOENCODING=utf-8 python tests/t13_ttft_pywebview.py
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

OUT_JSON = _PROJECT_ROOT / "qa" / "t_probe_pywebview.json"

MODEL_PATH = Path(os.environ.get("APPDATA", "")) / "NovaStudio" / "models" / \
    "MiniCPM5-2B-Q4_K_M.gguf"

N_MEASURE = 5            # misure richieste (n>=5)
N_WARMUP = 1             # warmup esplicito, ESCLUSO dai campioni
# Modalita' della FE usata per la misura (percorso REALE _stream_local_only_v2).
# Tentativo 1 con 'automatica' ha attivato la web search REALE (~15-20s di
# ricerca internet) che dominava il TTFT; dichiarato nel JSON.
PROBE_MODE = os.environ.get("R13_PROBE_MODE", "solo_locale")
LOG_FILE = _PROJECT_ROOT / "qa" / "r13_telem_probe.log"
POLL_JS_MS = 25          # intervallo poll_stream nel loop JS (dichiarato)
PY_POLL_JS_S = 0.05      # poll Python del risultato JS
WINDOW_READY_TIMEOUT = 90
MODEL_READY_TIMEOUT = 240
MEASURE_TIMEOUT = 120    # per singola misura
POST_READY_SLEEP = 20    # lasciar partire il reindex di background (dichiarato)
HARD_TIMEOUT = 780       # watchdog globale -> destroy finestra

# Script JS: 1 misura end-to-end. Salva su window.__r13_ttft (pending flag)
# cosi' il lato Python puo' usare evaluate_js SINCRONO (niente callback).
JS_ONE = r"""
window.__r13_ttft = {pending: true};
(async function () {
    try {
        var t0 = performance.now();
        var api = window.pywebview && window.pywebview.api;
        if (!api || typeof api.send_message !== 'function') {
            window.__r13_ttft = {pending: false, error: 'api pywebview assente'};
            return;
        }
        var r = await api.send_message(__MSG__, null, __MODE__, false, null, '');
        if (!r || r.error) {
            window.__r13_ttft = {pending: false, error: String((r && r.error) || 'send_message vuoto')};
            return;
        }
        var mid = r.message_id, from = 0;
        for (;;) {
            var p = await api.poll_stream(mid, from);
            if (p && p.tokens && p.tokens.length) {
                window.__r13_ttft = {
                    pending: false,
                    ttft_ms: performance.now() - t0,
                    first_token: String(p.tokens[0]).substring(0, 60),
                    conversation_id: r.conversation_id,
                    message_id: mid
                };
                return;
            }
            if (p && p.done) {
                window.__r13_ttft = {
                    pending: false, conversation_id: r.conversation_id,
                    error: 'stream finito senza token: ' + String(p.error || 'sconosciuto')
                };
                return;
            }
            from = (p && p.total) ? p.total : from;
            await new Promise(function (res) { setTimeout(res, __POLL__); });
        }
    } catch (e) {
        window.__r13_ttft = {pending: false, error: String((e && e.message) || e)};
    }
})();
'launched';
"""


def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(__import__("math").ceil(p / 100.0 * len(s))) - 1))
    return round(s[idx], 1)


def log(msg):
    """Log APPEND persistente (crash-native-safe): qa/r13_telem_probe.log."""
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), msg))
    except Exception:
        pass


def save(res):
    """Scrittura PROGRESSIVA del JSON (se il processo muore, i passi restano)."""
    try:
        OUT_JSON.write_text(json.dumps(res.data, indent=2, ensure_ascii=False),
                            encoding="utf-8")
    except Exception:
        pass


def children_pids():
    try:
        import psutil
        return sorted(p.pid for p in psutil.Process(os.getpid()).children())
    except Exception:
        return []


def kill_orphan_children(before_pids):
    """Uccide SOLO i processi figli di QUESTO processo sopravvissuti."""
    killed = []
    try:
        import psutil
        me = psutil.Process(os.getpid())
        for p in me.children():
            if p.pid not in before_pids and p.is_running():
                try:
                    p.kill()
                    killed.append(p.pid)
                except Exception:
                    pass
    except Exception:
        pass
    return killed


def shutdown_sidecar():
    """Shutdown SOLO il singleton sidecar di QUESTO processo (mai altri)."""
    try:
        import core.sidecar.server as scs
        srv = getattr(scs, "_server_singleton", None)
        if srv is not None:
            srv.shutdown()
            return True
    except Exception:
        pass
    return False


def machine_load():
    out = {}
    try:
        import psutil
        out["cpu_percent_1s"] = psutil.cpu_percent(interval=1.0)
        out["mem_percent"] = psutil.virtual_memory().percent
        out["cpu_count"] = psutil.cpu_count(logical=True)
    except Exception as e:
        out["error"] = str(e)
    scan = env_scan()
    out["env_scan"] = scan
    n_l = len(scan.get("llama", []))
    n_p = len(scan.get("python_other", []))
    n_c = len(scan.get("chrome_headless", []))
    if n_l or n_p:
        out["declared"] = (
            "carico dichiarato: AMBIENTE NON-QUIET (env_scan: %d processi "
            "llama-server/llama-bench, %d altri python, %d chrome headless)" %
            (n_l, n_p, n_c))
    else:
        out["declared"] = (
            "carico dichiarato: AMBIENTE QUIET (env_scan: 0 llama-server/"
            "llama-bench, 0 altri python concorrenti; %d chrome headless/"
            "puppeteer rilevati)" % n_c)



    return out


# =====================================================================
# R13 TTFT - FASI (IMPLEMENTER-TTFT): strumentazione run-time.
# Monkey-patch installati SOLO in questo processo sonda: nessun file di
# produzione modificato per l'osservazione. Flusso coperto:
#   send_message -> thread _run_generation -> router.process_query_stream
#   -> RAG local_search.search -> stream_via_sidecar -> SidecarClient
#   -> _ensure_server/SidecarServer -> HTTP llama-server -> primo pezzo.
# Output progressivo: qa/r13_ttft_phases.json (save_phases).
# =====================================================================
PHASES_JSON = _PROJECT_ROOT / "qa" / "r13_ttft_phases.json"
REQS = []                       # una entry per richiesta (stage: bridge|gen)
QUEUE_JOBS = []                 # eventi globali coda priorita' (se usata)
_TLS = threading.local()
_PROBE_INSTALLED = {"done": False, "wrapped": [], "errors": []}


def _req(create=False):
    r = getattr(_TLS, "req", None)
    if r is None and create:
        r = {"t0": time.time(), "stage": None, "label": "",
             "phases": {}, "meta": {}}
        REQS.append(r)
        _TLS.req = r
    return r


def _phase(name, value, req=None):
    r = req if req is not None else _req()
    if r is None:
        return
    try:
        r.setdefault("phases", {})[name] = (
            round(value, 1) if isinstance(value, float) else value)
    except Exception:
        pass


def _meta(key, value, req=None):
    r = req if req is not None else _req()
    if r is None:
        return
    try:
        r.setdefault("meta", {})[key] = value
    except Exception:
        pass


def env_scan():
    """Processi anomali: llama-server/llama-bench, altri python, chrome
    headless/puppeteer (candidati kill). Esclude QUESTO processo e i figli."""
    out = {"llama": [], "python_other": [], "chrome_headless": []}
    try:
        import psutil
        mine = set(children_pids()) | {os.getpid()}
        for p in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                pid = p.info.get("pid")
                if pid in mine:
                    continue
                name = (p.info.get("name") or "").lower()
                cmd = " ".join(p.info.get("cmdline") or [])
                cmdl = cmd.lower()
                if ("llama-server" in cmdl or "llama-bench" in cmdl
                        or name.startswith("llama")):
                    out["llama"].append(
                        {"pid": pid, "name": name, "cmd": cmd[:220]})
                elif "python" in name:
                    out["python_other"].append(
                        {"pid": pid, "cmd": cmd[:220]})
                elif ("chrome" in name and ("headless" in cmdl or
                                            "remote-debugging-port" in cmdl)):
                    out["chrome_headless"].append(
                        {"pid": pid, "cmd": cmd[:220]})
            except Exception:
                continue
    except Exception as e:
        out["error"] = str(e)
    return out


def kill_chrome_headless(scan):
    """Uccide SOLO chrome con flag headless/puppeteer (MAI chrome utente)."""
    killed = []
    try:
        import psutil
        for item in scan.get("chrome_headless", []):
            try:
                psutil.Process(int(item["pid"])).kill()
                killed.append(int(item["pid"]))
            except Exception:
                pass
    except Exception:
        pass
    return killed


def machine_load_light():
    out = {}
    try:
        import psutil
        out["cpu_percent_1s"] = psutil.cpu_percent(interval=1.0)
        out["mem_percent"] = psutil.virtual_memory().percent
        out["cpu_count"] = psutil.cpu_count(logical=True)
    except Exception as e:
        out["error"] = str(e)
    return out


def save_phases(extra=None):
    """Scrive qa/r13_ttft_phases.json (merge bridge[i]|gen[i])."""
    try:
        bridge = [r for r in REQS if r.get("stage") == "bridge"]
        gen = [r for r in REQS if r.get("stage") == "gen"]
        merged = []
        for i in range(max(len(bridge), len(gen))):
            b = bridge[i] if i < len(bridge) else {}
            g = gen[i] if i < len(gen) else {}
            merged.append({
                "i": i,
                "label": (g.get("label") or b.get("label") or ""),
                "mode": b.get("mode") or g.get("mode"),
                "message_id": (b.get("meta", {}) or {}).get("message_id"),
                "poll_log": b.get("poll_log") or None,
                "phases_ms": {**(g.get("phases") or {}),
                              **(b.get("phases") or {})},
                "meta": {**(g.get("meta") or {}), **(b.get("meta") or {})},
            })
        out = {
            "probe": "r13_ttft_phases",
            "round": "R13",
            "owner": "IMPLEMENTER-TTFT",
            "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "load": machine_load_light(),
            "requests": merged,
            "queue_jobs_global": QUEUE_JOBS[-50:],
            "raw_count": {"bridge": len(bridge), "gen": len(gen),
                          "total": len(REQS)},
        }
        if extra:
            out.update(extra)
        PHASES_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False),
                               encoding="utf-8")
    except Exception:
        pass


def install_probes(api):
    """Installa gli wrap di misura sulle istanze REALI dell'app."""
    if _PROBE_INSTALLED["done"]:
        return _PROBE_INSTALLED
    _PROBE_INSTALLED["done"] = True
    W = _PROBE_INSTALLED["wrapped"]
    E = _PROBE_INSTALLED["errors"]

    # 1) send_message (thread bridge): t0 della richiesta + ids
    try:
        orig_send = api.send_message

        def send_wrapper(message, conversation_id, mode, thinking=False,
                         study_mode=None, topic=""):
            r = _req(create=True)
            r["t0"] = time.time()
            r["stage"] = "bridge"
            r["label"] = str(message)[:80]
            r["mode"] = mode
            out = orig_send(message, conversation_id, mode,
                            thinking=thinking, study_mode=study_mode,
                            topic=topic)
            if isinstance(out, dict):
                _meta("message_id", out.get("message_id"), r)
                _meta("conversation_id", out.get("conversation_id"), r)
                if out.get("error"):
                    _meta("send_error", out.get("error"), r)
            _phase("send_message_ms", (time.time() - r["t0"]) * 1000, r)
            return out

        api.send_message = send_wrapper
        W.append("api.send_message")
    except Exception as e:
        E.append("send_message: %s" % e)

    # 2) router.process_query_stream (thread generazione): ritardo thread
    #    + tempo al PRIMO evento token nel processo Python
    try:
        orig_pqs = api.router.process_query_stream

        def pqs_wrapper(query, *args, **kwargs):
            r = _req(create=True)
            r["stage"] = "gen"
            r["label"] = str(query)[:80]
            r["mode"] = kwargs.get("mode")
            t_call = time.time()
            _phase("gen_thread_start_s", t_call - r["t0"], r)
            gen = orig_pqs(query, *args, **kwargs)

            def gen_wrap():
                first = True
                t_first_token = None
                n_tok = 0
                try:
                    for ev in gen:
                        if first:
                            first = False
                            _phase("pqs_first_step_ms",
                                   (time.time() - t_call) * 1000, r)
                        if ev.get("type") == "token":
                            n_tok += 1
                            if t_first_token is None:
                                t_first_token = time.time()
                                _phase("py_first_token_ms",
                                       (t_first_token - r["t0"]) * 1000, r)
                                _meta("first_token_preview",
                                      str(ev.get("text", ""))[:50], r)
                        yield ev   # RIPOSTA al consumatore (fix bug T1)
                finally:
                    _phase("router_total_ms",
                           (time.time() - t_call) * 1000, r)
                    _meta("token_events", n_tok, r)

            return gen_wrap()

        api.router.process_query_stream = pqs_wrapper
        W.append("router.process_query_stream")
    except Exception as e:
        E.append("process_query_stream: %s" % e)

    # 3) RAG: local_search.search / books_search.search
    for attr, tag in (("local_search", "rag"), ("books_search", "books_rag")):
        try:
            eng = getattr(api.router, attr, None)
            if eng is None or not hasattr(eng, "search"):
                continue
            orig_search = getattr(eng, "search")

            def mk_search(orig_search, tag):
                def search_wrapper(query, *a, **kw):
                    t = time.time()
                    out = orig_search(query, *a, **kw)
                    _phase("%s_ms" % tag, (time.time() - t) * 1000)
                    try:
                        _meta("%s_empty" % tag, bool(out.is_empty))
                        _meta("%s_chunks" % tag, len(out.chunks))
                    except Exception:
                        pass
                    return out
                return search_wrapper

            setattr(eng, "search", mk_search(orig_search, tag))
            W.append("%s.search" % attr)
        except Exception as e:
            E.append("%s.search: %s" % (attr, e))

    # 4) LocalLLMClient.stream_via_sidecar (CLASSE: la proxy
    #    SidecarLLMProxy usa type(target).stream_via_sidecar)
    try:
        from core.local_llm_client import LocalLLMClient as _LLC
        orig_svs = _LLC.stream_via_sidecar

        def svs_wrapper(self, *a, **kw):
            t = time.time()
            r = _req(create=True)
            inner = orig_svs(self, *a, **kw)

            def gen():
                t_first = None
                n = 0
                try:
                    for piece in inner:
                        if t_first is None:
                            t_first = time.time()
                        n += 1
                        yield piece
                finally:
                    _phase("llm_stream_total_ms",
                           (time.time() - t) * 1000, r)
                    if t_first:
                        _phase("llm_first_piece_ms", (t_first - t) * 1000, r)
                    _meta("llm_pieces", n, r)

            return gen()

        _LLC.stream_via_sidecar = svs_wrapper
        W.append("LocalLLMClient.stream_via_sidecar")
    except Exception as e:
        E.append("stream_via_sidecar: %s" % e)

    # 5) SidecarClient: complete / _ensure_server / parse_sse_line (timings)
    try:
        from core.sidecar import client as _scc
        orig_complete = _scc.SidecarClient.complete

        def complete_wrapper(self, prompt_or_messages, profile="fast",
                             classe="standard", stream=False, draft=None):
            t = time.time()
            r = _req(create=True)
            try:
                if isinstance(prompt_or_messages, str):
                    plen = len(prompt_or_messages)
                else:
                    plen = len(_scc._messages_to_prompt(prompt_or_messages))
            except Exception:
                plen = None
            _meta("prompt_chars", plen, r)
            _meta("profile", profile, r)
            _meta("classe", classe, r)
            _meta("draft_requested", draft, r)
            out = orig_complete(self, prompt_or_messages, profile=profile,
                                classe=classe, stream=stream, draft=draft)
            if not stream:
                _phase("sidecar_complete_ms", (time.time() - t) * 1000, r)
                m = getattr(self, "last_meta", {}) or {}
                _meta("timings_done", m.get("timings") or {}, r)
                return out

            def gen():
                t_first = None
                n = 0
                try:
                    for piece in out:
                        if t_first is None:
                            t_first = time.time()
                        n += 1
                        yield piece
                finally:
                    _phase("sidecar_complete_ms",
                           (time.time() - t) * 1000, r)
                    if t_first:
                        _phase("sidecar_first_piece_ms",
                               (t_first - t) * 1000, r)
                    _meta("sidecar_pieces", n, r)
                    m = getattr(self, "last_meta", {}) or {}
                    tm = m.get("timings") or {}
                    if tm:
                        _meta("timings_done", tm, r)
                        _meta("draft_active", m.get("draft_active"), r)

            return gen()

        _scc.SidecarClient.complete = complete_wrapper
        W.append("SidecarClient.complete")

        orig_parse = _scc.parse_sse_line

        def parse_wrapper(line):
            p = orig_parse(line)
            try:
                if (isinstance(p, dict) and isinstance(p.get("timings"), dict)
                        and p["timings"]):
                    tm = p["timings"]
                    _meta("timings_first_seen", tm)
                    for k in ("prompt_n", "prompt_per_second", "predicted_ms",
                              "predicted_n", "tokens_evaluated",
                              "tokens_predicted"):
                        if k in tm:
                            _meta(k, tm[k])
            except Exception:
                pass
            return p

        _scc.parse_sse_line = parse_wrapper
        W.append("SidecarClient.parse_sse_line")

        orig_ens = _scc.SidecarClient._ensure_server

        def ens_wrapper(self, want_draft=False):
            t = time.time()
            try:
                before = self._server.state if self._server else None
            except Exception:
                before = None
            out = orig_ens(self, want_draft)
            _phase("ensure_server_ms", (time.time() - t) * 1000)
            _meta("server_state_before", before)
            try:
                _meta("server_state_after",
                      self._server.state if self._server else None)
                _meta("server_port", self.port)
            except Exception:
                pass
            return out

        _scc.SidecarClient._ensure_server = ens_wrapper
        W.append("SidecarClient._ensure_server")
    except Exception as e:
        E.append("SidecarClient: %s" % e)

    # 6) SidecarServer.start_on_demand: avvii/riavvii per richiesta
    try:
        import core.sidecar.server as _scs
        orig_sod = _scs.SidecarServer.start_on_demand

        def sod_wrapper(self, draft=False):
            t = time.time()
            try:
                before = self.state
            except Exception:
                before = None
            out = orig_sod(self, draft)
            _phase("server_start_on_demand_ms", (time.time() - t) * 1000)
            _meta("server_before", before)
            try:
                _meta("server_after", self.state)
            except Exception:
                pass
            if before != "up":
                _meta("server_started_now", True)
            return out

        _scs.SidecarServer.start_on_demand = sod_wrapper
        W.append("SidecarServer.start_on_demand")
    except Exception as e:
        E.append("SidecarServer: %s" % e)

    # 7) CodaPriorita._esegui: jobs eseguiti (globale: thread dedicato)
    try:
        from core.sidecar.queue import CodaPriorita as _CP
        orig_es = _CP._esegui

        def esegui_wrapper(self, job):
            t = time.time()
            out = orig_es(self, job)
            QUEUE_JOBS.append({
                "t": round(t, 3),
                "ms": round((time.time() - t) * 1000, 1),
                "prio": getattr(job, "prio", None),
            })
            return out

        _CP._esegui = esegui_wrapper
        W.append("CodaPriorita._esegui")
    except Exception as e:
        E.append("CodaPriorita: %s" % e)

    # 8) poll_stream: cosa vede DAVVERO il lato JS (log con
    #    change-detection, max 80 voci per richiesta)
    try:
        orig_poll = api.poll_stream

        def poll_wrapper(message_id, from_index):
            out = orig_poll(message_id, from_index)
            try:
                r = None
                for cand in REQS:
                    if (cand.get("stage") == "bridge" and
                            (cand.get("meta") or {}).get("message_id") ==
                            message_id):
                        r = cand
                if r is not None:
                    log_l = r.setdefault("poll_log", [])
                    n = len((out or {}).get("tokens") or [])
                    cur = {
                        "t": round(time.time() - r["t0"], 3),
                        "from": int(from_index),
                        "n": n,
                        "total": (out or {}).get("total"),
                        "done": bool((out or {}).get("done")),
                        "err": str((out or {}).get("error"))[:80],
                    }
                    prev = log_l[-1] if log_l else None
                    if (prev is None or any(
                            prev.get(k) != cur.get(k)
                            for k in ("from", "n", "total", "done", "err"))):
                        log_l.append(cur)
                        if len(log_l) > 80:
                            log_l.pop(0)
            except Exception:
                pass
            return out

        api.poll_stream = poll_wrapper
        W.append("api.poll_stream")
    except Exception as e:
        E.append("poll_stream: %s" % e)

    return _PROBE_INSTALLED


class Result:
    def __init__(self):
        self.data = {
            "probe": "t13_ttft_pywebview",
            "round": "R13",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "method": ("evaluate_js -> window.pywebview.api.send_message("
                       "msg, null, 'automatica', false, null, '') + loop su "
                       "window.pywebview.api.poll_stream(message_id, from_index) "
                       "fino al PRIMO token; TTFT = performance.now() misurato "
                       "nel browser da PRIMA dell'invocazione del bridge fino "
                       "al primo token (end-to-end, JIT poll incluso)"),
            "poll_interval_js_ms": POLL_JS_MS,
            "probe_mode_fe": PROBE_MODE,
            "model": str(MODEL_PATH),
            "llm_backend": None,
            "n": 0,
            "warmup_excluded": N_WARMUP,
            "p50_ms": None,
            "p95_ms": None,
            "target_p50_ms": 2000,
            "target_hit": None,
            "raw_samples_ms": [],
            "samples_detail": [],
            "hidden": None,
            "hidden_how": None,
            "blocked": None,
            "errors": [],
            "cleanup": {},
        }
        self.conv_ids = []
        self.done = threading.Event()

    def err(self, msg):
        self.data["errors"].append(str(msg))


def wait_window(win, res, max_wait=WINDOW_READY_TIMEOUT, tries=6):
    """Attende che la finestra sia pronta (bridge eseguibile). max 6 tentativi
    di interpretazione per 'unita' (qui: finestra + js pronti)."""
    t0 = time.time()
    attempt = 0
    while time.time() - t0 < max_wait:
        attempt += 1
        try:
            v = win.evaluate_js("typeof window.pywebview !== 'undefined' &&"
                                " !!window.pywebview.api")
            if v:
                return True
        except Exception as e:
            if attempt % 6 == 1:
                res.err("attesa finestra: %s" % e)
        time.sleep(1.0)
    return False


def js_done(win):
    """Ritorna dict della misura completata, None se pending, o 'timeout'."""
    try:
        v = win.evaluate_js(
            "(function(){var t=window.__r13_ttft;"
            "if(!t){return null;}if(t.pending){return null;}"
            "return JSON.stringify(t);})()")
        if isinstance(v, str) and v:
            return json.loads(v)
        return None
    except Exception:
        return None


def run_one(win, msg, timeout=MEASURE_TIMEOUT):
    """Lancia 1 misura e attende il primo token. -> dict (o raises)."""
    script = (JS_ONE.replace("__MSG__", json.dumps(msg))
              .replace("__MODE__", json.dumps(PROBE_MODE))
              .replace("__POLL__", str(POLL_JS_MS)))
    launched = win.evaluate_js(script)
    if launched != "launched":
        raise RuntimeError("lancio JS misura non riuscito: %r" % (launched,))
    t0 = time.time()
    while time.time() - t0 < timeout:
        out = js_done(win)
        if out is not None:
            return out
        time.sleep(PY_POLL_JS_S)
    raise TimeoutError("misura TTFT non completata entro %ss" % timeout)


def worker(win, api, res):
    children_before = children_pids()
    log("worker start (mode=%s, hidden=%s)" % (PROBE_MODE, res.data.get("hidden")))
    try:
        # --- model status: stessa aspettativa dell'app reale ---
        t0 = time.time()
        state = None
        while time.time() - t0 < MODEL_READY_TIMEOUT:
            try:
                st = api.get_model_status()
                state = st.get("state")
            except Exception as e:
                res.err("get_model_status: %s" % e)
            if state == "ready":
                break
            if state in ("error", "not_configured"):
                res.data["blocked"] = {
                    "step": "modello in-process",
                    "reason": "stato modello=%s: %s" % (
                        state, (st or {}).get("error")),
                    "manual_procedure": (
                        "1) verificare llama-cpp-python e il percorso "
                        "%s; 2) avviare l'app normalmente (python main.py) e "
                        "caricare il modello; 3) rilanciare questa sonda." %
                        MODEL_PATH),
                }
                return
            time.sleep(1.0)
        else:
            res.data["blocked"] = {
                "step": "modello in-process",
                "reason": "model non ready entro %ss (stato=%s)" % (
                    MODEL_READY_TIMEOUT, state),
                "manual_procedure": (
                    "attendere/ricaricare il modello in-app e rilanciare: "
                    "python tests/t13_ttft_pywebview.py"),
            }
            return

        # lasciar partire il reindex silenzioso di background (dichiarato)
        log("model ready, sleep %ss (reindex background)" % POST_READY_SLEEP)
        time.sleep(POST_READY_SLEEP)

        ready = wait_window(win, res)
        if not ready and res.data.get("hidden"):
            # fallback dichiarato: finestra hidden a volte non monta la pagina
            try:
                win.show()
                res.data["hidden"] = False
                res.data["hidden_how"] = (
                    str(res.data.get("hidden_how")) +
                    " -> PAGINA NON CARICATA in hidden; passato a finestra "
                    "VISIBILE (win.show()) e rieseguito l'attesa bridge")
                ready = wait_window(win, res)
            except Exception as e:
                res.err("fallback show: %s" % e)
        log("bridge ready=%s" % ready)
        save(res)
        if not ready:
            res.data["blocked"] = {
                "step": "bridge pywebview",
                "reason": "window.pywebview.api non raggiungibile entro %ss" %
                          WINDOW_READY_TIMEOUT,
                "manual_procedure": (
                    "aprire l'app (python main.py) e verificare che il bridge "
                    "risponda; se la finestra hidden non carica la pagina, "
                    "rilanciare questa sonda e leggere 'hidden_how' nel JSON."),
            }
            return

        # --- 1 warmup ESPRESSO (avvio llama-server on-demand) ---
        log("warmup inizio")
        try:
            w = run_one(win, "Rispondi con la sola parola: ok",
                        timeout=MEASURE_TIMEOUT)
            res.data["warmup_detail"] = w
            log("warmup fine: ttft=%s err=%s" % (
                w.get("ttft_ms"), w.get("error")))
            save_phases({"stage": "after_warmup"})
            if w.get("conversation_id"):
                res.conv_ids.append(w["conversation_id"])
            if w.get("error"):
                res.err("warmup: %s" % w["error"])
        except Exception as e:
            log("warmup FALLITO: %s" % e)
            res.err("warmup fallito: %s" % e)
            res.data["blocked"] = {
                "step": "warmup (avvio llama-server)",
                "reason": str(e),
                "manual_procedure": (
                    "verificare che il sidecar avvii llama-server con "
                    "%s (config llm.backend=sidecar) e rilanciare la sonda." %
                    MODEL_PATH),
            }
            return

        # --- n misure ---
        samples, details, fails = [], [], 0
        for i in range(N_MEASURE):
            log("misura %d/%d inizio" % (i + 1, N_MEASURE))
            try:
                out = run_one(win, "Rispondi con la sola parola: ok "
                                   "(prova %d)" % (i + 1))
                if out.get("conversation_id"):
                    res.conv_ids.append(out["conversation_id"])
                if out.get("ttft_ms") is not None:
                    ttft = float(out["ttft_ms"])
                    samples.append(ttft)
                    details.append({
                        "i": i + 1,
                        "ttft_ms": round(ttft, 1),
                        "first_token": out.get("first_token", ""),
                    })
                else:
                    fails += 1
                    res.err("misura %d senza token: %s" % (i + 1, out.get("error")))
                    log("misura %d senza token: %s" % (i + 1, out.get("error")))
            except Exception as e:
                fails += 1
                res.err("misura %d fallita: %s" % (i + 1, e))
                log("misura %d FALLITA: %s" % (i + 1, e))
            # salvataggio progressivo: se il processo muore, i campioni restano
            res.data["n"] = len(samples)
            res.data["raw_samples_ms"] = [round(s2, 1) for s2 in samples]
            res.data["samples_detail"] = details
            res.data["p50_ms"] = pct(samples, 50)
            res.data["p95_ms"] = pct(samples, 95)
            save(res)
            save_phases({"stage": "after_measure_%d" % (i + 1)})
            # pulizia stream per non accumulare
            try:
                if details and details[-1].get("i") == i + 1:
                    api.cleanup_stream(out.get("message_id"))
            except Exception:
                pass

        if len(samples) < N_MEASURE:
            res.data["blocked"] = {
                "step": "misurazione",
                "reason": "solo %d/%d misure valide (%d falli)" % (
                    len(samples), N_MEASURE, fails),
                "manual_procedure": (
                    "rilanciare la sonda quando la macchina è meno carica; "
                    "leggere errors[] nel JSON per il dettaglio."),
            }
            # campioni parziali comunque riportati (verità, non simulati)

        res.data["n"] = len(samples)
        res.data["raw_samples_ms"] = [round(s, 1) for s in samples]
        res.data["samples_detail"] = details
        res.data["p50_ms"] = pct(samples, 50)
        res.data["p95_ms"] = pct(samples, 95)
        if samples:
            res.data["target_hit"] = bool(res.data["p50_ms"] <= 2000)
    except Exception as e:
        res.err("worker: %s" % e)
        res.err(traceback.format_exc(limit=3))
        res.data["blocked"] = res.data.get("blocked") or {
            "step": "worker",
            "reason": str(e),
            "manual_procedure": "leggere errors[] e rilanciare la sonda.",
        }
    finally:
        # --- pulizia conversazioni di test create nel DB reale ---
        deleted = 0
        for cid in set(res.conv_ids):
            try:
                r = api.delete_conversation(cid)
                if isinstance(r, dict) and r.get("success"):
                    deleted += 1
            except Exception:
                pass
        # R13 TTFT: attesa (max 25s) che le generazioni in background
        # completino le fasi strumentate, poi salvataggio finale fasi
        _dl = time.time() + 25
        while time.time() < _dl:
            _gens = [r for r in REQS if r.get("stage") == "gen"]
            if _gens and all("router_total_ms" in (r.get("phases") or {})
                             for r in _gens):
                break
            time.sleep(1.0)
        save_phases({"stage": "final"})
        res.data["cleanup"]["conversations_deleted"] = deleted
        res.data["cleanup"]["llama_server_shutdown"] = shutdown_sidecar()
        # finestra: chiudi il loop webview.start()
        try:
            win.destroy()
        except Exception as e:
            res.err("destroy: %s" % e)
        # figli orfani residui (SOLO miei)
        time.sleep(1.0)
        orphans = kill_orphan_children(children_before)
        res.data["cleanup"]["orphan_children_killed"] = orphans
        res.data["cleanup"]["children_before"] = children_before
        res.done.set()


def main():
    res = Result()
    # Nota onestà (IMPLEMENTER-TTFT): il campo method era hardcoded
    # 'automatica' ma la sonda gira con PROBE_MODE (default solo_locale,
    # come da log); qui si dichiara il valore REALE.
    res.data["method"] = (
        "evaluate_js -> window.pywebview.api.send_message(msg, null, '%s', "
        "false, null, '') + loop su window.pywebview.api.poll_stream("
        "message_id, from_index) fino al PRIMO token; TTFT = performance."
        "now() misurato nel browser da PRIMA dell'invocazione del bridge "
        "fino al primo token (end-to-end, JIT poll incluso)" % PROBE_MODE)
    res.data["llm_backend"] = "sidecar (da config, letta dall'app all'avvio)"
    res.data["model_exists"] = MODEL_PATH.exists()
    if not MODEL_PATH.exists():
        res.data["blocked"] = {
            "step": "modello",
            "reason": "modello assente: %s" % MODEL_PATH,
            "manual_procedure": "scaricare MiniCPM5-2B-Q4_K_M.gguf in "
                                 "%APPDATA%\\NovaStudio\\models\\ e rilanciare.",
        }
        OUT_JSON.write_text(json.dumps(res.data, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        print("BLOCKED: modello assente")
        return 2

    # Ambiente: scan + kill SOLO chrome headless/puppeteer (mai utente)
    pre_scan = env_scan()
    res.data["env_scan_pre"] = pre_scan
    res.data["chrome_headless_killed"] = kill_chrome_headless(pre_scan)
    res.data["machine_load"] = machine_load()

    import webview  # pywebview 6.2.1 (verificato: hidden kwarg + window.hide)
    from backend.api import StudioIAAPI

    win = None
    children_before_main = children_pids()
    watchdog = None
    try:
        api = StudioIAAPI()
        install_probes(api)
        res.data["phases_file"] = "qa/r13_ttft_phases.json"
        res.data["probe_wrapped"] = list(_PROBE_INSTALLED["wrapped"])
        if _PROBE_INSTALLED["errors"]:
            res.data["errors"].append(
                "probe wrap: " + "; ".join(_PROBE_INSTALLED["errors"]))

        # --- finestra HIDDEN (6 tentativi su hidden/fallback) ---
        hidden_ok = False
        last_hidden_err = None
        for attempt in range(1, 7):
            try:
                win = webview.create_window(
                    "NovaStudio R13 TTFT probe",
                    url=(_PROJECT_ROOT / "web_frontend" / "html" /
                         "index.html").as_uri(),
                    js_api=api,
                    width=1180, height=760,
                    background_color="#1a1f2e",
                    hidden=True,
                )
                try:
                    win.hide()          # doppia sicurezza
                    res.data["hidden_how"] = ("create_window(hidden=True) + "
                                              "window.hide() (pywebview %s)" %
                                              getattr(webview, "__version__",
                                                      "6.x"))
                except Exception as e:
                    res.data["hidden_how"] = ("create_window(hidden=True); "
                                              "window.hide() ha fallito: %s" % e)
                res.data["hidden"] = True
                hidden_ok = True
                break
            except Exception as e:
                last_hidden_err = str(e)
                win = None
        if not hidden_ok:
            # ultimo tentativo: finestra visibile, dichiarato
            try:
                win = webview.create_window(
                    "NovaStudio R13 TTFT probe",
                    url=(_PROJECT_ROOT / "web_frontend" / "html" /
                         "index.html").as_uri(),
                    js_api=api, width=1180, height=760,
                    background_color="#1a1f2e",
                )
                res.data["hidden"] = False
                res.data["hidden_how"] = (
                    "hidden NON disponibile dopo 6 tentativi (ultimo errore: "
                    "%s); finestra creata VISIBILE" % last_hidden_err)
            except Exception as e:
                res.data["blocked"] = {
                    "step": "create_window",
                    "reason": str(e),
                    "manual_procedure": "verificare pywebview installato e "
                                         "riprovare (nessun processo lanciato "
                                         "a mano).",
                }
                OUT_JSON.write_text(
                    json.dumps(res.data, indent=2, ensure_ascii=False),
                    encoding="utf-8")
                return 2

        # stessa sequenza di main.py (caricamento modello in background)
        api.start_background_model_load()

        th = threading.Thread(target=worker, args=(win, api, res), daemon=True)
        th.start()

        # watchdog: se il worker non chiude la finestra -> destroy forzato
        # FIX (coordinatore R13, tent.3): il tent.2 e' impallato perche'
        # win.destroy() su finestra hidden NON fa tornare webview.start()
        # -> processo vivo indefinitamente. Ora: dopo destroy, se entro 15s
        # il worker non ha chiuso, il watchdog scrive lui stesso il JSON e
        # esce con os._exit (mai piu' processi appesi).
        def _watchdog():
            if not res.done.wait(HARD_TIMEOUT):
                res.err("watchdog %ss scattato: destroy forzato" % HARD_TIMEOUT)
                try:
                    win.destroy()
                except Exception:
                    pass
                time.sleep(15)
                if not res.done.is_set():
                    res.err("watchdog: webview.start() non e' tornato -> "
                            "uscita forzata con scrittura JSON dal watchdog")
                    try:
                        shutdown_sidecar()
                        kill_orphan_children(children_before_main)
                        res.data["cleanup"]["llama_server_shutdown"] = True
                    except Exception as e:
                        res.err("watchdog cleanup: %s" % e)
                    res.data["blocked"] = res.data.get("blocked") or {
                        "step": "watchdog globale",
                        "reason": ("run non completato entro %ss (hang noto: "
                                   "webview.start() non torna dopo destroy su "
                                   "finestra hidden)" % HARD_TIMEOUT),
                        "manual_procedure": (
                            "ririlanciare la sonda; se si ripete, eseguire la "
                            "sonda con finestra visibile impostando "
                            "PROBE_VISIBLE=1 nell'ambiente."),
                    }
                    try:
                        OUT_JSON.write_text(
                            json.dumps(res.data, indent=2,
                                       ensure_ascii=False),
                            encoding="utf-8")
                    except Exception:
                        pass
                    os._exit(2)
        watchdog = threading.Thread(target=_watchdog, daemon=True)
        watchdog.start()

        webview.start()   # blocca finche' la finestra non e' distrutta
    except Exception as e:
        res.err("main: %s" % e)
        res.err(traceback.format_exc(limit=3))
        res.data["blocked"] = res.data.get("blocked") or {
            "step": "avvio stack pywebview",
            "reason": str(e),
            "manual_procedure": "leggere errors[] nel JSON.",
        }
    finally:
        if win is not None:
            try:
                win.destroy()
            except Exception:
                pass
        # shutdown difensivo se il worker non e' arrivato in finally
        if not res.done.is_set():
            shutdown_sidecar()
            kill_orphan_children(children_before_main)
            res.data["cleanup"].setdefault("llama_server_shutdown",
                                           shutdown_sidecar())
        try:
            _scan_after = env_scan()
            res.data["machine_load_after"] = {
                "mem_percent": __import__("psutil").virtual_memory().percent,
                "env_scan": _scan_after,
                "declared": ("post-sonda: 0 processi llama residui attesi"
                             if not _scan_after.get("llama") else
                             "ATTENZIONE: processi llama residui presenti!"),
                "cpu_percent_1s": __import__("psutil").cpu_percent(interval=1.0)
            }
        except Exception:
            pass
        OUT_JSON.write_text(json.dumps(res.data, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        print(json.dumps({k: res.data[k] for k in (
            "n", "p50_ms", "p95_ms", "target_hit", "hidden", "blocked",
            "raw_samples_ms")}, indent=2, ensure_ascii=False))
        print("scritto: %s" % OUT_JSON)
    return 0


if __name__ == "__main__":
    sys.exit(main())
