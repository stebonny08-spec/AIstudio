"""
core/ai_cache.py — Cache AI a TRE STRATI (H7)
=============================================

Strati
------
1. ESATTA     : key = sha256(fid + prompt normalizzato) -> risposta.
                Hit immediato, zero calcoli, hit di prima scelta.
2. SEMANTICA  : cosine(embedding domanda, embedding voce) >= 0.92 sulla
                stessa fid -> risposta (stesso significato, parole diverse).
3. DELTA-REUSE: 0.80 <= cosine < 0.92 -> risposta della cache con flag
                needs_revision=True: e' una BOZZA, il caller decide se
                riusarla/revisionarla (nessuna scrittura automatica).
                cosine < 0.80 -> miss (None, None, False).

Embedder INJECTATO
------------------
Il costruttore accetta `embed_fn` (o None): callabile embed_fn(testo) ->
List[float]. SENZA embed_fn lo strato 2/3 e' INERTE: funziona solo la
cache esatta (nessun errore, nessun calcolo). Se il caller passa
esplicitamente `embedding` a get()/put() viene usato quello; embed_fn e'
il fallback per estrarlo dal prompt. Nessuna dipendenza esterna: stdlib
pura (hashlib, time, collections, math).

GATE — output che scrivono dati: badge 'generato da AI' + undo +
approvazione umana
------------------------------------------------------------------
* put() NON scrive dati: aggiorna solo la struttura IN MEMORIA della
  cache. La scrittura effettiva (SQLite, file, study_items, ...) avviene
  SOLO dopo l'approvazione umana del chiamante. Questo modulo non tocca
  data/db.py, non apre file, non esegue commit. get() e' puramente
  calcolo -> nessun side-effect (non inserisce, non muta le risposte).
* approval_required(fid) -> True per i fid che SCRIVONO
    F01, F02, F05, F06, F08, F09, F10, F12, F13, F14, F17
    (output soggetto a badge 'generato da AI' + undo + approvazione
    umana prima della scrittura),
  False per i fid micro/sola lettura
    F03, F04, F07, F11, F15, F16.
  Fid sconosciuti -> True (conservativo: meglio chiedere approvazione).
* Ogni HIT espone la provenienza meta = {layer, source_key, ts} che la UI
  traduce nel badge; helper module-level provenance_badge(layer).

Persistenza: solo in-memory (OrderedDict LRU), cap ~500 voci, nessun file.
"""

from __future__ import annotations

import hashlib
import math
import time
from collections import OrderedDict
from typing import Any, Dict, FrozenSet, Iterable, List, Optional, Sequence, Tuple

__all__ = [
    "AiCache",
    "SEMANTIC_THRESHOLD",
    "DELTA_THRESHOLD",
    "DEFAULT_MAX_ENTRIES",
    "WRITING_FIDS",
    "NON_WRITING_FIDS",
    "normalize_prompt",
    "cache_key",
    "cosine",
    "provenance_badge",
    "approval_required",
]

# ---------------------------------------------------------------------
# Soglie e costanti
# ---------------------------------------------------------------------
SEMANTIC_THRESHOLD = 0.92   # >= 0.92 -> hit semantico (strato 2)
DELTA_THRESHOLD = 0.80      # [0.80, 0.92) -> delta-reuse (strato 3)
DEFAULT_MAX_ENTRIES = 500   # cap LRU ~500 voci

# fid che SCRIVONO dati -> richiedono approvazione umana (gate sopra)
WRITING_FIDS: FrozenSet[str] = frozenset(
    {"F01", "F02", "F05", "F06", "F08", "F09", "F10", "F12", "F13", "F14", "F17"}
)
# fid micro / sola lettura -> nessuna approvazione
NON_WRITING_FIDS: FrozenSet[str] = frozenset(
    {"F03", "F04", "F07", "F11", "F15", "F16"}
)

# Identificativi di strato restituiti da get()
LAYER_EXACT = "exact"
LAYER_SEMANTIC = "semantic"
LAYER_DELTA = "delta"


# ---------------------------------------------------------------------
# Helpers puri (module-level, riusabili dal caller)
# ---------------------------------------------------------------------
def normalize_prompt(prompt: Optional[str]) -> str:
    """Normalizzazione per la chiave esatta: whitespace compattato +
    minuscolo. La punteggiatura resta (parte del contenuto)."""
    return " ".join(str(prompt or "").split()).lower()


def cache_key(fid: str, prompt: Optional[str]) -> str:
    """Strato 1: sha256(fid + SEP + prompt normalizzato)."""
    raw = "%s\x1f%s" % (str(fid or ""), normalize_prompt(prompt))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def cosine(a: Optional[Sequence[float]], b: Optional[Sequence[float]]) -> float:
    """Cosine similarity sicura: dimensioni diverse o vettori vuoti -> 0.0."""
    if not a or not b:
        return 0.0
    if len(a) != len(b):
        return 0.0
    try:
        dot = 0.0
        na = 0.0
        nb = 0.0
        for x, y in zip(a, b):
            fx = float(x)
            fy = float(y)
            dot += fx * fy
            na += fx * fx
            nb += fy * fy
    except (TypeError, ValueError):
        return 0.0
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


_BADGES = {
    LAYER_EXACT: "cache esatta",
    LAYER_SEMANTIC: "cache semantica 92%",
    LAYER_DELTA: "bozza da cache (da revisionare)",
}
_BADGE_ALIASES = {
    "esatta": LAYER_EXACT, "esatto": LAYER_EXACT, "layer1": LAYER_EXACT, "1": LAYER_EXACT,
    "semantica": LAYER_SEMANTIC, "layer2": LAYER_SEMANTIC, "2": LAYER_SEMANTIC,
    "delta": LAYER_DELTA, "layer3": LAYER_DELTA, "3": LAYER_DELTA, "revision": LAYER_DELTA,
}


def provenance_badge(layer: Optional[str]) -> str:
    """Badge UI per la provenienza di un output.

    exact     -> 'cache esatta'
    semantic  -> 'cache semantica 92%'
    delta     -> 'bozza da cache (da revisionare)'
    None/miss -> 'generato da AI'
    """
    if layer is None:
        return "generato da AI"
    key = str(layer).strip().lower()
    key = _BADGE_ALIASES.get(key, key)
    return _BADGES.get(key, "generato da AI")


def approval_required(fid: Optional[str]) -> bool:
    """True se l'output generato per `fid` richiede approvazione umana
    prima di scrivere dati (gate: badge + undo + approvazione).

    True  per F01,F02,F05,F06,F08,F09,F10,F12,F13,F14,F17 (scrivono)
    False per F03,F04,F07,F11,F15,F16 (micro / sola lettura)
    Fid sconosciuto -> True (conservativo).
    """
    f = str(fid or "").strip().upper()
    if f in NON_WRITING_FIDS:
        return False
    return True


# ---------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------
class AiCache:
    """Cache AI a 3 strati, interamente in-memory (dict + LRU cap).

    Uso tipico::

        cache = AiCache(embed_fn=embedder.embed_one)   # None -> solo esatta
        layer, value, rev = cache.get(fid, prompt, embedding=vec)
        if layer is None:
            value = genera_da_llm(...)
            cache.put(fid, prompt, value, embedding=vec, doc_ids=[doc_id])
        badge = provenance_badge(layer)
        if rev:
            # strato 3: bozza, il caller decide
        if approval_required(fid):
            # attendi approvazione umana prima di scrivere (put NON scrive)

    L'embedder e' INJECTATO: senza embed_fn lo strato 2/3 e' inerte.
    """

    def __init__(
        self,
        embed_fn: Optional[Any] = None,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        semantic_threshold: float = SEMANTIC_THRESHOLD,
        delta_threshold: float = DELTA_THRESHOLD,
    ) -> None:
        self._embed_fn = embed_fn
        self._max_entries = max(1, int(max_entries))
        self._semantic_threshold = float(semantic_threshold)
        self._delta_threshold = float(delta_threshold)
        self._entries: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._doc_versions: Dict[str, str] = {}
        # meta dell'ultimo HIT (ergonomia: get() resta un 3-tuple)
        self.last_meta: Optional[Dict[str, Any]] = None

    # ---------------- stat ----------------
    def __len__(self) -> int:
        return len(self._entries)

    def stats(self) -> Dict[str, Any]:
        return {
            "entries": len(self._entries),
            "max_entries": self._max_entries,
            "layer2_active": self._embed_fn is not None,
            "doc_versions": dict(self._doc_versions),
            "semantic_threshold": self._semantic_threshold,
            "delta_threshold": self._delta_threshold,
        }

    # ---------------- lettura ----------------
    def get(self, fid: str, prompt: str, embedding: Optional[Sequence[float]] = None):
        """-> (hit_layer|None, value|None, needs_revision).

        hit_layer: 'exact' | 'semantic' | 'delta' | None (miss).
        needs_revision: True solo per il layer delta (bozza da revisionare).
        NESSUN side-effect: non scrive dati, non inserisce voci, non muta
        le risposte; tocca solo l'ordine LRU in memoria.
        """
        layer, value, rev, _meta = self.get_with_meta(fid, prompt, embedding)
        return layer, value, rev

    def get_with_meta(
        self, fid: str, prompt: str, embedding: Optional[Sequence[float]] = None
    ) -> Tuple[Optional[str], Optional[Any], bool, Optional[Dict[str, Any]]]:
        """Come get() ma restituisce anche meta = {layer, source_key, ts}
        (provenienza per il badge UI). Su miss -> meta None."""
        # --- strato 1: ESATTA ---
        key = cache_key(fid, prompt)
        entry = self._entries.get(key)
        if entry is not None:
            self._entries.move_to_end(key)
            meta = {"layer": LAYER_EXACT, "source_key": key, "ts": entry["ts"]}
            self.last_meta = meta
            return LAYER_EXACT, entry["response"], False, meta

        # --- strati 2/3: INERTI senza embed_fn ---
        if self._embed_fn is None:
            self.last_meta = None
            return None, None, False, None

        query_vec: Optional[Sequence[float]] = embedding
        if query_vec is None:
            try:
                query_vec = self._embed_fn(prompt)
            except Exception:
                query_vec = None
        if not query_vec:
            self.last_meta = None
            return None, None, False, None

        # scansione solo sulla stessa fid, fra le voci con embedding
        best: Optional[Dict[str, Any]] = None
        best_sim = -1.0
        for cand in self._entries.values():
            if cand["fid"] != fid:
                continue
            cand_emb = cand.get("embedding")
            if not cand_emb:
                continue
            sim = cosine(query_vec, cand_emb)
            if sim > best_sim:
                best_sim = sim
                best = cand

        if best is None or best_sim < self._delta_threshold:
            # < 0.80 -> miss
            self.last_meta = None
            return None, None, False, None

        self._entries.move_to_end(best["key"])  # tocca la LRU
        meta = {
            "layer": LAYER_SEMANTIC if best_sim >= self._semantic_threshold else LAYER_DELTA,
            "source_key": best["key"],
            "ts": best["ts"],
            "similarity": round(best_sim, 4),
        }
        self.last_meta = meta
        if meta["layer"] == LAYER_SEMANTIC:
            # >= 0.92 -> hit semantico pieno
            return LAYER_SEMANTIC, best["response"], False, meta
        # 0.80 <= cos < 0.92 -> delta-reuse: bozza, decide il caller
        return LAYER_DELTA, best["response"], True, meta

    # ---------------- scrittura (SOLO in memoria) ----------------
    def put(
        self,
        fid: str,
        prompt: str,
        response: Any,
        embedding: Optional[Sequence[float]] = None,
        doc_ids: Optional[Iterable[str]] = None,
    ) -> str:
        """Inserisce/aggiorna una voce. Restituisce la cache_key.

        GATE: put() NON scrive dati. Nessun accesso a SQLite/file: la
        risposta vive solo in questa struttura in memoria; la scrittura
        effettiva avviene (se mai) dopo approvazione del caller.
        `doc_ids` marca la voce con i documenti da cui deriva, per poterla
        invalidare con invalidate_docs()/register_doc_version().
        """
        key = cache_key(fid, prompt)
        emb: Optional[List[float]] = None
        if embedding is not None:
            try:
                emb = [float(x) for x in embedding]
            except (TypeError, ValueError):
                emb = None
        elif self._embed_fn is not None:
            try:
                emb = [float(x) for x in self._embed_fn(prompt)]
            except Exception:
                emb = None
        docs = [str(d) for d in (doc_ids or []) if d]
        entry: Dict[str, Any] = {
            "key": key,
            "fid": str(fid),
            "prompt_norm": normalize_prompt(prompt),
            "response": response,
            "embedding": emb,
            "docs": docs,
            "ts": time.time(),
        }
        self._entries.pop(key, None)  # reinserimento: va in coda
        self._entries[key] = entry
        while len(self._entries) > self._max_entries:  # eviction LRU
            self._entries.popitem(last=False)
        return key

    # ---------------- invalidazione ----------------
    def register_doc_version(self, doc_id: str, version: Any) -> None:
        """Registra la versione corrente di un documento.

        Se la versione CAMBIA rispetto a quella gia' registrata, tutte le
        voci marcate con quel doc sono obsolete e vengono invalidate.
        """
        doc_id = str(doc_id)
        prev = self._doc_versions.get(doc_id)
        new = str(version)
        self._doc_versions[doc_id] = new
        if prev is not None and prev != new:
            self.invalidate_docs([doc_id])

    def invalidate_docs(self, doc_ids: Iterable[str]) -> int:
        """Rimuove TUTTE le voci marcate con uno dei `doc_ids`.
        Restituisce il numero di voci rimosse."""
        wanted = {str(d) for d in (doc_ids or []) if d}
        if not wanted:
            return 0
        victims = [
            k
            for k, e in self._entries.items()
            if wanted.intersection(e.get("docs") or ())
        ]
        for k in victims:
            del self._entries[k]
        return len(victims)

    def invalidate_negative(self, cache_key_or_pair: Any) -> bool:
        """Feedback negativo sull'output: rimuove la voce ESATTA.

        Accetta la cache_key (es. meta['source_key'] o il valore restituito
        da put()) oppure la coppia (fid, prompt). Restituisce True se la
        voce esisteva ed e' stata rimossa.
        """
        if isinstance(cache_key_or_pair, tuple) and len(cache_key_or_pair) == 2:
            key = cache_key(*cache_key_or_pair)
        else:
            key = cache_key_or_pair
        if not key:
            return False
        return self._entries.pop(str(key), None) is not None
