"""H12 - Base comune per i worker offline (sub-agenti a priorita' minima).

Regole (spec H12):
- NIENTE thread propri: ogni worker e' UNA funzione `run(batch, ctx)` che il
  WorkerRunner sottopone alla CodaPriorita con prio=2 (priorita' minima), cosi'
  i job interattivi (prio 0) non vengono mai degradati.
- Modello unico: profilo 'fast' (No-Think), budget classe 'micro' (<=200 token
  di output). La generazione passa da un llm_fn INIETTABILE:

      llm_fn(prompt, profile='fast', classe='micro') -> str

  default = stub deterministico (test); in produzione il caller inietta
  SidecarClient.complete. QUI SidecarClient NON viene importato (decoupling).
- Checkpoint opzionale: dict `state` (item_key -> risultato) persistito in
  JSON sotto qa/worker_state/<id>.json -> worker RESUMABLE (resume senza
  doppio lavoro su item gia' fatti).
- progress_callback(done, total): aggiorna lo stato esposto dal runner come
  snapshot() -> {worker, done, total, running, paused}.
- execute(batch, ctx) NON solleva MAI: un llm_fn che esplode produce
  status 'failed' con fallback, la coda sopravvive (test 9b).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time

__all__ = [
    "BaseWorker",
    "default_llm_fn",
    "detect_lang",
    "cosine",
    "PROFILO",
    "CLASSE",
    "DEFAULT_STATE_DIR",
]

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_STATE_DIR = os.path.join(ROOT, "qa", "worker_state")

PROFILO = "fast"   # No-Think
CLASSE = "micro"   # budget <= 200 token di output


# ======================================================================
# STUB LLM DI DEFAULT (test) - deterministico, nessuna rete
# ======================================================================

def default_llm_fn(prompt, profile=PROFILO, classe=CLASSE):
    """Stub deterministico: stesso prompt -> stessa risposta.

    Nei test e' il default; in produzione il caller passa il proprio
    llm_fn (es. SidecarClient.complete).
    """
    if not isinstance(prompt, str):
        prompt = str(prompt)
    digest = hashlib.sha256(
        ("%s|%s|%s" % (profile, classe, prompt)).encode("utf-8")
    ).hexdigest()[:12]
    return "Prefisso contestuale generato (stub): %s" % digest


# ======================================================================
# UTILITA' DETERMINISTICHE (nessuna dipendenza esterna)
# ======================================================================

_STOP_IT = frozenset({
    "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
    "di", "del", "dello", "della", "dei", "degli", "delle",
    "e", "che", "per", "con", "su", "da", "non", "sono", "essere",
    "questo", "questa", "quello", "quando", "dove", "perche", "perché",
    "piu", "più", "anche", "nel", "nella", "nei", "nelle", "suo", "sua",
    "loro", "ogni", "tutto", "tutti", "molto", "altro", "stesso",
    "alla", "allo", "alle", "ai", "agli", "al", "sul", "sulla",
    "risposta", "riassunto", "documento", "sezione",
})

_STOP_EN = frozenset({
    "the", "a", "an", "of", "to", "in", "and", "or", "is", "are",
    "was", "were", "that", "this", "these", "those", "for", "with",
    "on", "by", "as", "be", "been", "from", "it", "not", "which",
    "who", "what", "when", "where", "why", "how", "there", "here",
    "their", "its", "if", "then", "than", "too", "very", "can",
    "will", "just", "about", "into", "over", "after", "before",
    "also", "we", "you", "they", "he", "she", "document", "section",
})


def detect_lang(text):
    """Rileva la lingua ('it' / 'en' / 'unk') con stopword: usato da W1 per
    validare che il prefisso contestuale sia nella stessa lingua del testo."""
    if not text or not isinstance(text, str):
        return "unk"
    tokens = []
    for raw in text.split():
        t = raw.strip(".,;:!?\"'()[]{}«»…").lower()
        if t:
            tokens.append(t)
    if len(tokens) < 3:
        return "unk"
    it = sum(1 for t in tokens if t in _STOP_IT)
    en = sum(1 for t in tokens if t in _STOP_EN)
    if it == 0 and en == 0:
        return "unk"
    if it > en:
        return "it"
    if en > it:
        return "en"
    return "unk"


def cosine(a, b):
    """Coseno tra due vettori (lista/tupla di numeri). 0.0 se non calcolabile."""
    try:
        va = [float(x) for x in a]
        vb = [float(x) for x in b]
    except (TypeError, ValueError):
        return 0.0
    n = min(len(va), len(vb))
    if n == 0:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(n):
        dot += va[i] * vb[i]
        na += va[i] * va[i]
        nb += vb[i] * vb[i]
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / math.sqrt(na * nb)


# ======================================================================
# BASE WORKER
# ======================================================================

class BaseWorker:
    """Worker offline di base: UNA funzione, nessun thread proprio.

    Sottoclassi devono implementare `run(batch, ctx) -> results`.
    """

    id = "base"
    batch_size = 8

    def __init__(self, llm_fn=None, embed_fn=None, state_dir=None,
                 progress_callback=None, persist=True, auto_load_state=True):
        self.llm_fn = llm_fn if llm_fn is not None else default_llm_fn
        self.embed_fn = embed_fn
        self.state_dir = state_dir or DEFAULT_STATE_DIR
        self.persist = persist
        self._ext_progress = progress_callback
        self.state = {}
        if auto_load_state:
            self.load_state()
        self.done = 0
        self.total = 0
        self.running = False
        self.paused = False
        self.last_status = "idle"
        self.last_error = None
        self.stats = {"llm_calls": 0, "llm_errors": 0, "items": 0}
        self._llm_errors = 0
        self._run_llm_errors_base = 0
        self.validation_report = {}

    # ------------------------------------------------------------------
    # CHECKPOINT (resume)
    # ------------------------------------------------------------------
    def state_path(self):
        return os.path.join(self.state_dir, "%s.json" % self.id)

    def load_state(self):
        """Carica il checkpoint da qa/worker_state/<id>.json (opzionale)."""
        try:
            with open(self.state_path(), "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict) and isinstance(data.get("done"), dict):
                self.state = data["done"]
            elif isinstance(data, dict):
                self.state = {}
        except (OSError, ValueError, TypeError):
            self.state = {}
        return self.state

    def save_state(self):
        """Persiste il checkpoint (best-effort: errori IO non fanno fallire)."""
        if not self.persist:
            return False
        try:
            os.makedirs(self.state_dir, exist_ok=True)
            payload = {
                "worker": self.id,
                "updated": time.time(),
                "done": self.state,
            }
            tmp_path = self.state_path() + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, sort_keys=True)
            os.replace(tmp_path, self.state_path())
            return True
        except (OSError, TypeError, ValueError):
            return False

    def clear_state(self):
        self.state = {}
        try:
            os.remove(self.state_path())
        except OSError:
            pass

    def mark(self, key, value=None):
        """Segna un item come fatto e salva il checkpoint."""
        if value is None:
            value = "done"
        self.state[key] = value
        self.save_state()

    # ------------------------------------------------------------------
    # IDENTITA' DEGLI ITEM
    # ------------------------------------------------------------------
    def item_key(self, item):
        """Chiave stabile di un item (per checkpoint e filtro resume)."""
        if isinstance(item, dict):
            for k in ("id", "chunk_id", "key", "doc_id", "section_id"):
                if item.get(k) is not None:
                    return str(item[k])
        else:
            v = getattr(item, "id", None)
            if v is not None:
                return str(v)
        if isinstance(item, str):
            raw = item
        else:
            try:
                raw = json.dumps(item, sort_keys=True, default=str,
                                 ensure_ascii=False)
            except (TypeError, ValueError):
                raw = repr(item)
        return "h:" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    def item_text(self, item):
        """Testo principale di un item (str, dict con 'text'/'front'/..., Chunk)."""
        if isinstance(item, str):
            return item
        if isinstance(item, dict):
            for k in ("text", "front", "chunk", "content", "body"):
                v = item.get(k)
                if isinstance(v, str) and v:
                    return v
            try:
                return json.dumps(item, sort_keys=True, default=str,
                                  ensure_ascii=False)
            except (TypeError, ValueError):
                return str(item)
        v = getattr(item, "text", None)
        if isinstance(v, str) and v:
            return v
        return str(item)

    def filter_pending(self, items):
        """Rimuove gli item gia' presenti nel checkpoint (resume)."""
        return [i for i in items if self.item_key(i) not in self.state]

    # ------------------------------------------------------------------
    # PROGRESSO / SNAPSHOT
    # ------------------------------------------------------------------
    def set_progress_callback(self, callback):
        self._ext_progress = callback

    def progress_callback(self, done, total):
        """Metodo richiesto dalla spec: aggiorna done/total e notifica."""
        self.done = int(done)
        self.total = int(total)
        if self._ext_progress is not None:
            try:
                self._ext_progress(self.done, self.total)
            except Exception:
                pass

    def begin_run(self, total):
        self.progress_callback(0, int(total))

    def advance(self, n=1):
        done = self.done + int(n)
        total = self.total if self.total >= done else done
        self.progress_callback(done, total)

    def snapshot(self):
        """{worker, done, total, running, paused} - esposto anche dal runner."""
        return {
            "worker": self.id,
            "done": self.done,
            "total": self.total,
            "running": bool(self.running),
            "paused": bool(self.paused),
        }

    # ------------------------------------------------------------------
    # LLM / EMBEDDING INIETTABILI
    # ------------------------------------------------------------------
    def llm(self, prompt, fallback=""):
        """Chiama llm_fn(prompt, profile='fast', classe='micro') in sicurezza.

        Se solleva: conta errore, registra last_error e ritorna `fallback`
        (il job diventa 'failed' ma non fa mai crashare la coda).
        """
        self.stats["llm_calls"] += 1
        try:
            out = self.llm_fn(prompt, profile=PROFILO, classe=CLASSE)
        except Exception as exc:
            self.stats["llm_errors"] += 1
            self._llm_errors += 1
            self.last_error = "%s: %s" % (type(exc).__name__, exc)
            return fallback
        if out is None:
            return fallback
        if not isinstance(out, str):
            out = str(out)
        return out

    def embed(self, text):
        """Chiama embed_fn(text) in sicurezza; None se assente o errore."""
        if self.embed_fn is None:
            return None
        try:
            vec = self.embed_fn(text)
        except Exception as exc:
            self.last_error = "%s: %s" % (type(exc).__name__, exc)
            return None
        try:
            return [float(x) for x in vec]
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------
    # CICLO DI VITA
    # ------------------------------------------------------------------
    def run(self, batch, ctx=None):
        """Lavoro reale. Da implementare nelle sottoclassi."""
        raise NotImplementedError

    def fallback(self, batch, ctx=None):
        """Risultati degradati se run solleva (default: vuoto)."""
        return {}

    def execute(self, batch, ctx=None):
        """Esegue un batch SENZA MAI sollevare -> (status, results, error).

        status: 'done' | 'failed' | 'paused'
        - 'failed': llm_fn (o run) ha sollevato -> si usa il fallback
          degradato, il job muore ma la coda sopravvive.
        """
        ctx = ctx or {}
        if self.paused:
            self.last_status = "paused"
            return "paused", {}, None
        self.running = True
        self._run_llm_errors_base = self._llm_errors
        error = None
        try:
            results = self.run(batch, ctx)
        except Exception as exc:
            error = "%s: %s" % (type(exc).__name__, exc)
            self.last_error = error
            try:
                results = self.fallback(batch, ctx)
            except Exception:
                results = {}
        if results is None:
            results = {}
        self.running = False
        if error is not None or self._llm_errors > self._run_llm_errors_base:
            status = "failed"
        else:
            status = "done"
        self.last_status = status
        return status, results, error
