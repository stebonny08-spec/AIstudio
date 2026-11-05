"""core/ai_runtime.py — RUNTIME AI (H13): registry + cache + sidecar + retry.

Collega i pezzi già esistenti SENZA toccarli:
  * registry   : render_user / render_sys / validate_output / repair_prompt /
                 clamp del budget di output (core.registry.*)
  * cache      : AiCache a 3 strati (esatta/semantica/delta) + provenance_badge
                 + approval_required (core.ai_cache)
  * inferenza  : SOLO tramite llm_fn (o sidecar) INIETTABILE — senza di essi si
                 ritorna il fallback del registro, deterministicamente.
  * retry      : UN solo retry con repair_prompt(fid, errors).

CONTRATTO (run_ai_function NON solleva MAI eccezioni):
  * hit cache   -> {ok:True, data, source:'cache_exact|cache_semantic|
                    cache_delta', badge, needs_revision, approval_required}
  * miss + NO   -> {ok:False, fallback:True, data:FALLBACK del registro,
    llm/sidecar     source:'fallback', badge:'AI non disponibile'}
  * miss + llm  -> prompt = TEMPLATES[sys].text + user renderizzato;
                   budget della classe -> max_tokens=clamp;
                   validate_output(fid, raw, ctx=inputs);
                   invalido -> 1 retry con repair_prompt -> ancora invalido ->
                   fallback registro. Validato -> cache.put() SOLO se ok,
                   badge = provenance_badge(None) = 'generato da AI'.
  * approval_required(fid) è SEMPRE nel risultato: il caller decide la
                    scrittura (questo modulo non scrive dati).
  * tool-call   : max 2 run_ai_function concatenati per richiesta ->
                  run_many(pairs) ferma al 2° fallimento (max 2 chiamate).

NOMI CHIAVE API:
  source  : 'cache_*' per gli hit, 'ai' per l'output generato e validato,
            'fallback' quando si torna al registro.
  badge   : provenance_badge(layer) | 'generato da AI' | 'AI non disponibile'.
"""

from __future__ import annotations

import inspect
import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .ai_cache import AiCache, approval_required, provenance_badge
from .registry.engine import render_sys, render_user, repair_prompt, validate_output
from .registry.functions import clamp_output_tokens, get_function
from .registry.templates import TEMPLATES
from .sidecar.profiles import clamp_max_tokens

__all__ = ["run_ai_function", "run_many", "get_default_cache", "DEFAULT_MAX_CALLS",
        "get_stats", "reset_stats", "record_tutor_judgment",
        "record_ttft", "register_sidecar_client"]

# Tool-call massime per richiesta: max 2 run_ai_function concatenati.
DEFAULT_MAX_CALLS = 2

# Badge unico per OGNI percorso di fallback (registro / AI assente / errori).
FALLBACK_BADGE = "AI non disponibile"

# Cache di default del processo (usata solo se il caller non ne passa una).
_DEFAULT_CACHE: Optional[AiCache] = None


def get_default_cache(embed_fn=None) -> AiCache:
    """Cache singleton in-memory del processo (embed_fn solo alla creazione)."""
    global _DEFAULT_CACHE
    if _DEFAULT_CACHE is None:
        _DEFAULT_CACHE = AiCache(embed_fn=embed_fn)
    return _DEFAULT_CACHE


# ----------------------------------------------------------------------
# G7 - telemetria leggera (contatori module-level, JSON-serializzabili)
#   * per fid : {calls, ok, fails, tokens_est, ms_total}
#   * globali : cache_hits per strato, tutor_judgments, calls_total
#   Lettura: get_stats() | Azzeramento: reset_stats() (flag azzerabile)
#   Giudizi tutor: record_tutor_judgment('corretto'|'parziale'|'errato'),
#   hook disponibile qui per non toccare altri moduli (tutor_step puo'
#   chiamarlo).
# ----------------------------------------------------------------------
def _new_stats() -> dict:
    return {
        "calls_total": 0,
        "fids": {},
        "cache_hits": {"exact": 0, "semantic": 0, "delta": 0},
        "tutor_judgments": {"corretto": 0, "parziale": 0, "errato": 0},
    }


_STATS: Dict[str, Any] = _new_stats()


def _fid_slot(fid: Any) -> Dict[str, Any]:
    """Slot del fid (creato al volo) - mai sovrascrivere i contatori."""
    key = str(fid)
    slot = _STATS["fids"].get(key)
    if slot is None:
        slot = {"calls": 0, "ok": 0, "fails": 0, "tokens_est": 0, "ms_total": 0.0}
        _STATS["fids"][key] = slot
    return slot


def _add_tokens(fid: Any, raw: Any) -> None:
    """Stima tokens ~= max(1, len(raw)/4) della risposta grezza."""
    try:
        n = len(str(raw))
    except Exception:
        return
    if n <= 0:
        return
    _ensure_loaded()               # R13: prima il disco, poi la mutazione
    slot = _fid_slot(fid)
    slot["tokens_est"] += max(1, n // 4)


def _record_call(fid: Any, ok: bool, ms: float) -> None:
    """Registra chiamata + esito + durata (ms) per il fid (R13: persiste)."""
    _ensure_loaded()               # R13: prima il disco, poi la mutazione
    _STATS["calls_total"] += 1
    slot = _fid_slot(fid)
    slot["calls"] += 1
    slot["ok" if ok else "fails"] += 1
    slot["ms_total"] += float(ms)
    _persist()                     # snapshot su ai_stats.json (mai eccezione)


def get_stats() -> dict:
    """Snapshot JSON-serializzabile dei contatori G7 (non muta lo stato).

    Include: calls_total, fids{calls,ok,fails,tokens_est,ms_total},
    cache_hits per strato, tutor_judgments e (se istanziata) la stats()
    ESISTENTE di core.ai_cache (AiCache.stats) della cache di processo.

    R13 T3: + chiavi NUOVE `live` (TTFT/tok-s/hit-rate/acceptance, sorgenti
    dichiarate) e `persist` (stato di ai_stats.json). Le chiavi G7 sopra
    restano INVARIATE (solo aggiunte)."""
    _ensure_loaded()
    out: Dict[str, Any] = {
        "calls_total": int(_STATS["calls_total"]),
        "fids": {k: dict(v) for k, v in _STATS["fids"].items()},
        "cache_hits": dict(_STATS["cache_hits"]),
        "tutor_judgments": dict(_STATS["tutor_judgments"]),
        "ai_cache": None,
    }
    if _DEFAULT_CACHE is not None:
        try:
            out["ai_cache"] = _DEFAULT_CACHE.stats()   # stats() gia' esistente
        except Exception:
            out["ai_cache"] = None
    # --- R13 T3: solo CHIAVI NUOVE sotto (payload G7 invariato sopra) ---
    try:
        out["live"] = _live_block()
    except Exception as e:          # mai rompere il payload G7
        out["live"] = {"error": str(e)}
    try:
        out["persist"] = dict(_PERSIST_INFO)
    except Exception:
        out["persist"] = {"ok": False}
    return out


def reset_stats() -> dict:
    """Azzera tutti i contatori (flag azzerabile). Ritorna lo snapshot vuoto.

    R13 T3: azzera ANCHE i campioni live e riscrive la persistenza (file
    vuoto) — nessun ricarico dal disco DOPO l'azzera (flag caricamento
    forzato, altrimenti i contatori vecchi tornerebbero indietro)."""
    global _STATS, _TTFT_SAMPLES, _SIDECAR_CLIENT, _PERSIST_LOADED
    _PERSIST_LOADED = True        # nessun reload: il reset prevale sul disco
    _STATS = _new_stats()
    _TTFT_SAMPLES = []
    _SIDECAR_CLIENT = None
    _persist()
    return get_stats()


# ----------------------------------------------------------------------
# R13 T3 - TELEMETRIA PERSISTENTE + CAMPI LIVE (solo CHIAVI NUOVE)
#   * persistenza: %APPDATA%\\NovaStudio\\ai_stats.json (get_app_data_dir
#     in LETTURA; data/config_manager.py NON modificato). Override env
#     STUDIOIA_TELEM_DIR per i test (mai scrivere l'app reale in test).
#   * live: TTFT p50/p95 (record_ttft: chiamate reali + sonda T2),
#     tok/s (last_meta['timings'] se raggiungibile ALTRIMENTI stima
#     tokens_est/ms_total, sorgente dichiarata), hit-rate prefix (core
#     .prefix_cache in sola lettura), acceptance draft (last_meta se
#     presente, NULL + sorgente dichiarata altrimenti).
#   Il payload ESISTENTE (calls_total/fids/cache_hits/tutor_judgments/
#   ai_cache) resta INVARIATO: qui sotto solo chiavi aggiunte.
# ----------------------------------------------------------------------
_TTFT_MAX = 200                  # ultimi N campioni TTFT mantenuti
_TTFT_SAMPLES: List[float] = []
_SIDECAR_CLIENT: Any = None       # ultimo SidecarClient (osservatore api.py)
_PERSIST_LOCK = threading.Lock()
_PERSIST_LOADED = False
_PERSIST_INFO: Dict[str, Any] = {"path": None, "ok": False, "writes": 0,
                                "loaded": False, "error": None}


def _telem_dir() -> Path:
    """Cartella telemetria: env STUDIOIA_TELEM_DIR (test) oppure APPDATA."""
    env = os.environ.get("STUDIOIA_TELEM_DIR")
    if env:
        return Path(env)
    from data.config_manager import get_app_data_dir   # sola lettura
    return Path(get_app_data_dir())


def _telem_file() -> Path:
    return _telem_dir() / "ai_stats.json"


def register_sidecar_client(client: Any) -> None:
    """Osservatore R13: conserva l'ultimo SidecarClient (lettura last_meta).

    Chiamato dall'osservatore installato in backend/api.py (monkey-patch
    runtime di LocalLLMClient._make_sidecar_client): serve SOLO a leggere
    il contratto TELEM last_meta={timings, acceptance, draft_active, ts};
    nessuna scrittura su core/sidecar/** (file intoccabili)."""
    global _SIDECAR_CLIENT
    try:
        _SIDECAR_CLIENT = client
    except Exception:
        pass


def _last_meta_read() -> Optional[Dict[str, Any]]:
    """Legge last_meta SE disponibile (dove raggiungibile), altrimenti None."""
    c = _SIDECAR_CLIENT
    if c is None:
        return None
    try:
        meta = getattr(c, "last_meta", None)
        if isinstance(meta, dict) and float(meta.get("ts") or 0) > 0:
            return meta
    except Exception:
        return None
    return None


def record_ttft(ms: float, source: str = "runtime") -> None:
    """Registra un campione TTFT end-to-end in ms (R13 T3).

    Chiamato da: (a) backend/api._run_generation sul PRIMO token reale;
    (b) tests/t13_ttft_pywebview.py (sonda T2, bridge pywebview incluso).
    Non solleva mai: campioni fuori range o errori di persistenza vengono
    ignorati. I campioni sopravvivono ai restart via ai_stats.json."""
    try:
        v = float(ms)
        if not math.isfinite(v) or v <= 0 or v > 600000:
            return
    except (TypeError, ValueError):
        return
    with _PERSIST_LOCK:
        _TTFT_SAMPLES.append(v)
        del _TTFT_SAMPLES[:-_TTFT_MAX]
    _persist()


def _percentile(values: List[float], p: float) -> Optional[float]:
    """Percentile nearest-rank sui campioni ordinati (nessuna simulazione)."""
    if not values:
        return None
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(math.ceil(p / 100.0 * len(s))) - 1))
    return round(s[idx], 1)


def _ensure_loaded() -> None:
    """Carica persistenza alla PRIMA chiamata del processo (lazy, una volta).

    Struttura file: {"schema": 1, "stats": {...}, "ttft_samples": [...],
    "sidecar_last_meta": {...}|null}. Ogni errore/struttura ignota -> noop."""
    global _PERSIST_LOADED
    if _PERSIST_LOADED:
        return
    _PERSIST_LOADED = True
    f = _telem_file()
    _PERSIST_INFO["path"] = str(f)
    try:
        if not f.exists():
            return
        data = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return
        st = data.get("stats")
        if isinstance(st, dict):
            # ripristino SOLO chiavi base note (schema difensivo)
            for k in ("calls_total", "fids", "cache_hits", "tutor_judgments"):
                if k in st:
                    _STATS[k] = st[k]
        tt = data.get("ttft_samples")
        if isinstance(tt, list):
            for v in tt:
                try:
                    fv = float(v)
                    if math.isfinite(fv) and 0 < fv <= 600000:
                        _TTFT_SAMPLES.append(fv)
                except (TypeError, ValueError):
                    pass
            del _TTFT_SAMPLES[:-_TTFT_MAX]
        _PERSIST_INFO["loaded"] = True
        _PERSIST_INFO["ok"] = True
    except Exception as e:
        _PERSIST_INFO["error"] = str(e)


def _persist() -> None:
    """Scrive snapshot su ai_stats.json (mai eccezione, lock thread-safe)."""
    try:
        _ensure_loaded()
        f = _telem_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        with _PERSIST_LOCK:
            payload = {
                "schema": 1,
                "saved_at": time.time(),
                "stats": {
                    "calls_total": int(_STATS["calls_total"]),
                    "fids": {k: dict(v) for k, v in _STATS["fids"].items()},
                    "cache_hits": dict(_STATS["cache_hits"]),
                    "tutor_judgments": dict(_STATS["tutor_judgments"]),
                },
                "ttft_samples": list(_TTFT_SAMPLES),
                "sidecar_last_meta": _last_meta_read(),
            }
            tmp = f.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False),
                           encoding="utf-8")
            os.replace(str(tmp), str(f))
            _PERSIST_INFO["writes"] = int(_PERSIST_INFO.get("writes", 0)) + 1
            _PERSIST_INFO["path"] = str(f)
            _PERSIST_INFO["ok"] = True
            _PERSIST_INFO["error"] = None
    except Exception as e:
        try:
            _PERSIST_INFO["error"] = str(e)
        except Exception:
            pass


def _live_block() -> Dict[str, Any]:
    """Blocco LIVE (chiavi NUOVE del payload get_stats): solo letture + last_meta."""
    out: Dict[str, Any] = {}

    # --- TTFT p50/p95: campioni reali (runtime/sonda), mai simulati ---
    with _PERSIST_LOCK:
        samples = list(_TTFT_SAMPLES)
    src = "runtime/sonda (record_ttft)"
    if not samples:
        # fallback: campioni della sonda T2 su disco (lettura)
        try:
            probe = Path(__file__).resolve().parent.parent / "qa" / \
                "t_probe_pywebview.json"
            if probe.exists():
                pj = json.loads(probe.read_text(encoding="utf-8"))
                raw = pj.get("raw_samples_ms") or []
                for v in raw:
                    fv = float(v)
                    if math.isfinite(fv) and 0 < fv <= 600000:
                        samples.append(fv)
                if samples:
                    src = "qa/t_probe_pywebview.json (sonda T2)"
        except Exception:
            pass
    out["ttft_p50_ms"] = _percentile(samples, 50)
    out["ttft_p95_ms"] = _percentile(samples, 95)
    out["ttft_n"] = len(samples)
    out["ttft_source"] = src if samples else "assente (nessun campione)"

    # --- tok/s: last_meta['timings'] se raggiungibile, altrimenti stima ---
    meta = _last_meta_read()
    tok = None
    tok_src = None
    if meta:
        t = meta.get("timings")
        if isinstance(t, dict):
            for key in ("predicted_per_second", "tokens_per_second"):
                try:
                    v = t.get(key)
                    if v is not None and float(v) > 0:
                        tok = round(float(v), 2)
                        tok_src = "last_meta['timings'].%s" % key
                        break
                except (TypeError, ValueError):
                    pass
    if tok is None:
        # stima da contatori G7: tokens_est / ms_total (dichiarata)
        try:
            tot_tok = sum(int(v.get("tokens_est") or 0)
                          for v in _STATS["fids"].values())
            tot_ms = sum(float(v.get("ms_total") or 0.0)
                         for v in _STATS["fids"].values())
            if tot_ms > 0 and tot_tok > 0:
                tok = round(tot_tok / (tot_ms / 1000.0), 2)
                tok_src = ("stima: sum(tokens_est)/sum(ms_total) da "
                           "_add_tokens/_record_call (fids runtime)")
            else:
                tok_src = "assente (nessun timing, nessuna chiamata fids)"
        except Exception:
            tok_src = "assente (errore lettura fids)"
    out["tok_per_s"] = tok
    out["tok_per_s_source"] = tok_src

    # --- hit-rate prompt prefix: core.prefix_cache in SOLA LETTURA ---
    try:
        from core.prefix_cache import get_prefix_cache
        pc = get_prefix_cache().stats()
        out["prefix_hit_rate"] = round(float(pc.get("hit_rate") or 0.0), 4)
        out["prefix_hit_rate_hits"] = int(pc.get("hits") or 0)
        out["prefix_hit_rate_misses"] = int(pc.get("misses") or 0)
        out["prefix_hit_rate_source"] = "core.prefix_cache.stats"
    except Exception as e:
        out["prefix_hit_rate"] = None
        out["prefix_hit_rate_hits"] = None
        out["prefix_hit_rate_misses"] = None
        out["prefix_hit_rate_source"] = "non raggiungibile: %s" % e

    # --- acceptance draft: last_meta quando presente, NULL + dichiarato ---
    if meta and meta.get("acceptance") is not None:
        try:
            out["acceptance"] = float(meta["acceptance"])
            out["acceptance_source"] = "last_meta['acceptance']"
        except (TypeError, ValueError):
            out["acceptance"] = None
            out["acceptance_source"] = "last_meta['acceptance'] non numerico"
        out["draft_active"] = bool(meta.get("draft_active"))
    else:
        out["acceptance"] = None
        out["acceptance_source"] = (
            "assente: last_meta non raggiungibile o nessun completamento "
            "(client per-chiamata in stream_via_sidecar; nessun dato)")
        out["draft_active"] = None

    # --- giudizi tutor (copia comoda nel blocco live per la FE) ---
    out["tutor_judgments"] = dict(_STATS["tutor_judgments"])
    return out


_TUTOR_VERDICTS = {
    "corretto": "corretto", "correct": "corretto", "ok": "corretto",
    "parziale": "parziale", "partial": "parziale", "parz": "parziale",
    "errato": "errato", "wrong": "errato", "sbagliato": "errato",
    "erroneo": "errato",
}


def record_tutor_judgment(verdict: Any) -> None:
    """Incrementa il contatore dei giudizi del tutor (tutor_step).

    Ammessi: 'corretto' | 'parziale' | 'errato' (sinedonimi EN/IT accettati);
    valori sconosciuti confluiscono in 'altro'. Tutte le chiavi restano
    JSON-serializzabili e azzerabili con reset_stats().
    """
    key = _TUTOR_VERDICTS.get(str(verdict or "").strip().lower(), "altro")
    _STATS["tutor_judgments"][key] = _STATS["tutor_judgments"].get(key, 0) + 1


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _fallback(fid: Any, entry: Optional[Dict[str, Any]],
              error: Optional[str] = None) -> dict:
    """Dict di fallback deterministico (MAI eccezione)."""
    data = entry.get("fallback") if entry else None
    out: Dict[str, Any] = {
        "ok": False,
        "fallback": True,
        "data": data,
        "source": "fallback",
        "badge": FALLBACK_BADGE,
        "approval_required": approval_required(fid),
        "fid": str(fid),
    }
    if error is not None:
        out["error"] = str(error)
    return out


def _budget_of(entry: Dict[str, Any]) -> Tuple[str, int]:
    """(classe, max_tokens): budget della classe del registro, clamped due volte
    (profilo sidecar + clamp costante del registro)."""
    classe = str(entry.get("budget_classe") or "standard")
    try:
        n = clamp_max_tokens("fast", classe)          # profili sidecar
    except Exception:
        n = 600
    try:
        n = clamp_output_tokens(classe, n)             # clamp registro (micro<=200...)
    except Exception:
        n = min(n, 600)
    return classe, int(n)


def _call_llm(llm_fn: Any, prompt: str, max_tokens: int,
              classe: str, fid: str) -> Any:
    """Chiama llm_fn in modo prudente: passa max_tokens/classe/fid SOLO se sono
    parametri dichiarati nella firma (nessuna injection tramite **kwargs).
    Qualsiasi eccezione (AiUnavailable compresa) -> None -> fallback."""
    kwargs: Dict[str, Any] = {}
    try:
        params = inspect.signature(llm_fn).parameters
        if "max_tokens" in params:
            kwargs["max_tokens"] = max_tokens
        if "classe" in params:
            kwargs["classe"] = classe
        if "fid" in params:
            kwargs["fid"] = fid
    except (TypeError, ValueError):
        kwargs = {}
    try:
        out = llm_fn(prompt, **kwargs)
    except Exception:
        return None
    if out is not None:
        _add_tokens(fid, out)       # G7: stima token (len/4) per telemetria
    return out


def _sidecar_to_llm(sidecar: Any):
    """SidecarClient iniettato -> llm_fn con la firma del runtime."""
    if sidecar is None or not hasattr(sidecar, "complete"):
        return None

    def _fn(prompt: str, max_tokens: int = None, classe: str = None,
            fid: str = None) -> Any:
        return sidecar.complete(prompt, profile="tool",
                                classe=classe or "standard")

    return _fn


# ----------------------------------------------------------------------
# run_ai_function
# ----------------------------------------------------------------------
def _run_ai_function_impl(fid: str, inputs: dict, *, coda: Any = None,
                          ai_cache: Any = None, embed_fn: Any = None,
                          priority: int = 0, llm_fn: Any = None,
                          sidecar: Any = None) -> dict:
    """Esegue una funzione del registro attraverso il runtime AI.

    flusso: render_user -> cache (esatta/semantica/delta) -> miss:
      * nessun llm_fn/sidecar -> fallback registro (deterministico);
      * llm_fn: sys+user -> LLM -> validate_output -> (1 retry con
        repair_prompt) -> cache.put SOLO se ok.

    Ritorna SEMPRE un dict {ok, data, source, badge, approval_required, ...}.
    `coda`/`priority` sono accettati per l'integrazione con la coda a priorità
    (l'esecuzione qui è sincrona; i worker la useranno in modo async).
    """
    entry: Optional[Dict[str, Any]] = None
    try:
        inputs = dict(inputs or {})
    except Exception:
        inputs = {}

    # 1) registro
    try:
        entry = get_function(fid)
        fid = entry["id"]
    except Exception as exc:
        return _fallback(fid, None, error="funzione sconosciuta: %r" % (fid,))

    # 2) render user template
    try:
        user = render_user(fid, **inputs)
    except Exception as exc:
        return _fallback(fid, entry, error="render_user: %s" % exc)

    # 3) cache (istanza fornita o singleton di processo)
    cache = ai_cache
    if cache is None:
        try:
            cache = get_default_cache(embed_fn)
        except Exception:
            cache = None

    layer = value = None
    rev = False
    if cache is not None:
        try:
            layer, value, rev = cache.get(fid, user)
        except Exception:
            layer, value, rev = None, None, False

    # 4) HIT -> ritorna la provenienza (esatta/semantica/delta)
    if layer:
        # G7: contatore hit per strato di cache
        _STATS["cache_hits"][layer] = _STATS["cache_hits"].get(layer, 0) + 1
        return {
            "ok": True,
            "fallback": False,
            "data": value,
            "source": "cache_%s" % layer,     # cache_exact | cache_semantic | cache_delta
            "badge": provenance_badge(layer),
            "needs_revision": bool(rev),
            "approval_required": approval_required(fid),
            "fid": fid,
        }

    # 5) MISS: serve un llm_fn (o sidecar) iniettabile, altrimenti fallback
    if llm_fn is None:
        llm_fn = _sidecar_to_llm(sidecar)
    if llm_fn is None:
        return _fallback(fid, entry)

    classe, max_tokens = _budget_of(entry)

    # 6) prompt = TEMPLATES[sys].text (+ extra) + user renderizzato
    try:
        sys_text = render_sys(fid, **inputs)
    except Exception:
        sys_text = ""
    if not sys_text and entry.get("sys"):
        try:
            sys_text = TEMPLATES[entry["sys"]]["text"]
        except Exception:
            sys_text = ""
    prompt = ("%s\n\n%s" % (sys_text, user)) if sys_text else user

    # 7) chiamata LLM (errore/None -> fallback deterministico)
    raw = _call_llm(llm_fn, prompt, max_tokens, classe, fid)
    if raw is None:
        return _fallback(fid, entry)

    # 8) validazione + UN retry con repair_prompt
    try:
        ok, parsed, errors = validate_output(fid, raw, ctx=inputs)
    except Exception as exc:
        return _fallback(fid, entry, error="validate_output: %s" % exc)

    retried = False
    if not ok:
        retried = True
        # visibilita' degli errori del PRIMO tentativo (diagnosi gate reale)
        print("[AiRuntime] retry %s per: %s" % (fid, "; ".join(str(e) for e in errors[:3])))
        try:
            # Il repair deve includere il COMPITO ORIGINALE: senza gli input
            # (testo/front/argomento...) il modello produce JSON meta-degeneri
            # (bug trovato dal gate reale t2a_gate: {"status":"ok"} e simili).
            repair = repair_prompt(fid, errors)
            repair += ("\n\nCompito originale (input dell'utente, da rispettare "
                       "integralmente):\n" + prompt)
        except Exception as exc:
            return _fallback(fid, entry, error="repair_prompt: %s" % exc)
        raw = _call_llm(llm_fn, repair, max_tokens, classe, fid)
        if raw is None:
            return _fallback(fid, entry)
        try:
            ok, parsed, errors = validate_output(fid, raw, ctx=inputs)
        except Exception as exc:
            return _fallback(fid, entry, error="validate_output: %s" % exc)
        if not ok:
            # ancora invalido -> fallback del registro
            return _fallback(fid, entry, error="output non valido: %s"
                             % "; ".join(str(e) for e in errors[:3]))

    # 9) OK: put in cache SOLO adesso (mai per output invalidi)
    if cache is not None:
        try:
            cache.put(fid, user, parsed)
        except Exception:
            pass  # la cache non deve mai far fallire la chiamata

    return {
        "ok": True,
        "fallback": False,
        "data": parsed,
        "source": "ai",
        "badge": provenance_badge(None),     # miss -> 'generato da AI'
        "needs_revision": False,
        "approval_required": approval_required(fid),
        "fid": fid,
        "max_tokens": max_tokens,
        "classe": classe,
        "retried": retried,
    }


# ----------------------------------------------------------------------
# run_ai_function - wrapper pubblico G7 (telemetria)
#   Stessa firma e stesso contratto di _run_ai_function_impl
#   (MAI eccezioni, stessi dict di ritorno) + contatori per fid:
#   chiamate / ok / fails / tokens_est / ms_total leggibili con
#   get_stats() e azzerabili con reset_stats().
# ----------------------------------------------------------------------
def run_ai_function(fid: str, inputs: dict, *, coda: Any = None,
                    ai_cache: Any = None, embed_fn: Any = None,
                    priority: int = 0, llm_fn: Any = None,
                    sidecar: Any = None) -> dict:
    """Wrapper con telemetria: vedi _run_ai_function_impl per il flusso."""
    t0 = time.perf_counter()
    try:
        res = _run_ai_function_impl(fid, inputs, coda=coda, ai_cache=ai_cache,
                                    embed_fn=embed_fn, priority=priority,
                                    llm_fn=llm_fn, sidecar=sidecar)
    except Exception as exc:  # difensivo: il contratto e' "mai eccezioni"
        _record_call(fid, False, time.perf_counter() - t0)
        return _fallback(fid, None, error=str(exc))
    _record_call(fid, bool(isinstance(res, dict) and res.get("ok")),
                 time.perf_counter() - t0)
    return res


# ----------------------------------------------------------------------
# run_many — max 2 tool-call per richiesta
# ----------------------------------------------------------------------
def run_many(pairs: List[Tuple[str, dict]], *, coda: Any = None,
             ai_cache: Any = None, embed_fn: Any = None, priority: int = 0,
             llm_fn: Any = None, sidecar: Any = None,
             max_calls: int = DEFAULT_MAX_CALLS) -> List[dict]:
    """Esegue una lista di coppie (fid, inputs) in serie.

    Regole H13:
      * al massimo `max_calls` (default 2) run_ai_function concatenati;
      * si ferma anche al 2° fallimento (ok=False).
    Nessuna eccezione: ogni elemento è un dict di risultato.
    """
    results: List[dict] = []
    failures = 0
    limit = max(1, int(max_calls))
    for pair in pairs:
        if len(results) >= limit:
            break
        if failures >= 2:
            break
        try:
            fid, inputs = pair
        except Exception:
            results.append(_fallback(None, None,
                                     error="coppia (fid, inputs) non valida"))
            failures += 1
            continue
        try:
            res = run_ai_function(fid, inputs, coda=coda, ai_cache=ai_cache,
                                  embed_fn=embed_fn, priority=priority,
                                  llm_fn=llm_fn, sidecar=sidecar)
        except Exception as exc:  # difensivo: run_ai_function non alza mai
            res = _fallback(fid, None, error=str(exc))
        if not isinstance(res, dict):
            res = _fallback(fid, None, error="risultato non dict")
        results.append(res)
        if not res.get("ok"):
            failures += 1
    return results
