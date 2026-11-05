"""
core/rag/usearch_layer.py
---------------------------------------------
P1b.2 — layer HNSW (USEARCH) come sottosistema di QUERY accanto a sqlite-vec.

Ruolo: copia di query IN MEMORIA con persistenza su disco. sqlite resta
l'unica fonte di verita' transazionale: il layer NON scrive mai nello store
(nessun riscrittura di chunks/vec0), si limita a (ri)costruirsi DA sqlite
quando invalidato (add_chunks / delete / reset / reindex).

API usearch REALI verificate con `usearch 2.26.6` (pip, cross-platform,
nessuna dipendenza Intel-specifica) — diversi dal task sketch:
    from usearch.index import Index          # high-level (NON .compiled.add)
    idx = Index(ndim=dim, dtype='f32', metric='cos',
                connectivity=16, expansion_add=200, expansion_search=100)
    idx.add(keys, vectors)                   # keys = rowid sqlite
    m = idx.search(q, count=k)               # m.keys / m.distances (1 - cos)
    idx.save(path)                           # istanza
    idx2 = Index(); idx2.load(path)          # load = metodo ISTANZA
Metric 'cos' di usearch = distanza 1 - cos (self-distance 0 verificata):
stessa semantica di sqlite-vec (distance_metric=cosine), quindi
similarity = 1 - distanza in entrambi i percorsi.

Persistenza (nella cartella dell'indice, es. vector_index/):
    hnsw_<store>.usearch       indice HNSW serializzato
    hnsw_<store>.meta.json     sidecar {dim, embedder_id, n, saved_at}

All'avvio (prima query con flag ON): Index.load + validazione
(dim + EMBEDDER_ID + n) → NESSUN rebuild se tutto combacia, altrimenti
rebuild da sqlite + log. Il flag `usearch.enabled` (config) è letto da
usearch_enabled(): env RAG_USEARCH > config > USEARCH_ENABLED_DEFAULT.

Default: False finché l'A/B P1b.2 (qa/p1b_usearch_bench.py →
qa/p1b_usearch.json) non decide; il default finale è scritto qui sotto
con i numeri a supporto.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, List, Optional, Tuple

# ======================================================================
# FLAG usearch.enabled
# ======================================================================
# Default deciso dall'A/B P1b.2. REGOLA: usearch ON SOLO SE p95 usearch
# <= p95 sqlite-vec sull'indice REALE E recall@5 >= recall_sqlite - 0.01.
# Esito (qa/p1b_usearch.json): vedi "decision" — OFF (nessun regressione):
#   p95 reale sqlite-vec vs usearch + delta recall GT R15b citati lì.
USEARCH_ENABLED_DEFAULT = True   # esito A/B P1b.2 qa/p1b_usearch.json: p95 reale
                                    # sqlite-vec 0.885ms vs usearch 0.0368ms;
                                    # scale 1k 1.186/0.294 - 10k 6.721/0.718 -
                                    # 50k 26.286/1.597 (sv/uc ms);
                                    # recall@5 GT R15 off=1.0 on=1.0 (delta 0)  # ← default = esito A/B P1b.2

_TRUE_VALUES = ("1", "true", "yes", "on")


def usearch_enabled() -> bool:
    """Risoluzione del flag: env RAG_USEARCH > config usearch.enabled >
    USEARCH_ENABLED_DEFAULT (esito A/B P1b.2). Lettura config
    best-effort: qualsiasi errore → default."""
    env = (os.environ.get("RAG_USEARCH") or "").strip().lower()
    if env:
        return env in _TRUE_VALUES
    try:
        from data.config_manager import ConfigManager

        cfg = ConfigManager()
        cfg.load()
        val = cfg.get("usearch.enabled", USEARCH_ENABLED_DEFAULT)
        if isinstance(val, str):
            return val.strip().lower() in _TRUE_VALUES
        return bool(val)
    except Exception:
        return USEARCH_ENABLED_DEFAULT


def _log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


# ======================================================================
# LAYER
# ======================================================================
class UsearchLayer:
    """Copia HNSW in memoria di un sotto-indice sqlite (store_key).

    - ensure(...): carica da disco (Index.load) se valido, altrimenti
      ricostruisce da sqlite via `build()` e salva (save) — MAI rebuild a
      ogni avvio se il file è compatibile (dim, EMBEDDER_ID, n).
    - invalidate(): segnala che sqlite è cambiato (chiamata dagli hook di
      vector_store_sqlite: add/delete/reset/reindex). Nessun lock preso
      qui (assegnazioni atomiche sotto GIL) per non violare l'ordine dei
      lock con il path di query.
    - search(query, k): top-k → [(rowid, distanza_cosine), ...].
    """

    def __init__(self, persist_dir, store_key: str):
        self.persist_dir = Path(persist_dir)
        safe = re.sub(r"[^0-9A-Za-z]+", "_", str(store_key or "default")) or "default"
        self.path = self.persist_dir / f"hnsw_{safe}.usearch"
        self.meta_path = self.persist_dir / f"hnsw_{safe}.meta.json"

        self._index = None
        # stato iniziale: nessun indice in memoria, file forse valido →
        # il PRIMO ensure prova il load (non il rebuild).
        self._dirty = False
        self.failed = False
        self.last_action = "none"   # load | rebuild | cached | failed | skipped
        self.last_error: Optional[str] = None
        self.stats = {"loads": 0, "builds": 0, "load_ms": 0.0, "build_ms": 0.0}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    def invalidate(self) -> None:
        """sqlite è cambiato: prossimo ensure → rebuild (nessun lock)."""
        self._index = None
        self._dirty = True
        self.last_action = "invalidated"

    # ------------------------------------------------------------------
    def _read_meta(self) -> Optional[dict]:
        try:
            return json.loads(self.meta_path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _write_meta(self, meta: dict) -> None:
        try:
            self.meta_path.write_text(
                json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8"
            )
        except OSError as exc:
            _log(f"[usearch] scrittura meta laterale fallita ({exc}) — solo log")

    @staticmethod
    def _info_ok(dim: int, embedder_id: str, count: int) -> bool:
        return int(dim) > 0 and int(count) > 0 and bool(str(embedder_id))

    def _try_load(self, dim: int, embedder_id: str, count: int) -> Optional[Any]:
        """Index.load + validazione (dim, EMBEDDER_ID, n). None → rebuild."""
        if not self.path.exists():
            self._dirty = True
            self.last_action = "rebuild"          # nessun file: si costruisce
            return None
        meta = self._read_meta() or {}
        mismatch = []
        if int(meta.get("dim") or -1) != int(dim):
            mismatch.append(f"dim {meta.get('dim')!r}!={dim}")
        if str(meta.get("embedder_id") or "") != str(embedder_id):
            mismatch.append(
                f"embedder_id {meta.get('embedder_id')!r}!={embedder_id!r}"
            )
        if int(meta.get("n") or -1) != int(count):
            mismatch.append(f"n {meta.get('n')!r}!={count}")
        if mismatch:
            _log(
                f"[usearch] load RIFIUTATO ({', '.join(mismatch)}) "
                f"-> rebuild da sqlite ({self.path.name})"
            )
            self._dirty = True
            self.last_action = "rebuild"
            return None
        t0 = time.perf_counter()
        try:
            from usearch.index import Index

            idx = Index()
            idx.load(str(self.path))
            if idx.size != count or idx.ndim != dim:
                _log(
                    f"[usearch] load incongruente (size={idx.size}/n={count}, "
                    f"ndim={idx.ndim}/dim={dim}) -> rebuild"
                )
                self._dirty = True
                self.last_action = "rebuild"
                return None
        except Exception as exc:
            _log(f"[usearch] Index.load fallito ({exc}) -> rebuild da sqlite")
            self._dirty = True
            self.last_action = "rebuild"
            return None
        self._index = idx
        self._dirty = False
        self.last_action = "load"
        self.stats["loads"] += 1
        self.stats["load_ms"] += (time.perf_counter() - t0) * 1000.0
        _log(
            f"[usearch] Index.load ok: n={idx.size} ndim={idx.ndim} "
            f"({self.path.name}, {self.stats['load_ms']:.1f}ms cumulati)"
        )
        return idx

    def _rebuild(
        self,
        dim: int,
        embedder_id: str,
        count: int,
        build: Callable[[], Optional[Tuple[List[int], Any]]],
    ) -> Optional[Any]:
        t0 = time.perf_counter()
        built = build()
        if built is None:
            # nessun vettore in sqlite: niente indice (query → [] via sqlite)
            self._index = None
            self._dirty = True
            self.last_action = "rebuild"
            return None
        keys, matrix = built
        if not len(keys):
            self._index = None
            self._dirty = True
            self.last_action = "rebuild"
            return None
        from usearch.index import Index

        idx = Index(
            ndim=int(dim),
            dtype="f32",
            metric="cos",
            connectivity=16,
            expansion_add=200,
            expansion_search=100,
        )
        idx.add(keys, matrix)
        try:
            self.persist_dir.mkdir(parents=True, exist_ok=True)
            idx.save(str(self.path))
            self._write_meta(
                {
                    "dim": int(dim),
                    "embedder_id": str(embedder_id),
                    "n": int(len(keys)),
                    "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "usearch_file": self.path.name,
                }
            )
        except OSError as exc:
            _log(f"[usearch] save su disco fallito ({exc}) — indice solo in RAM")
        self._index = idx
        self._dirty = False
        self.last_action = "rebuild"
        self.stats["builds"] += 1
        ms = (time.perf_counter() - t0) * 1000.0
        self.stats["build_ms"] += ms
        _log(
            f"[usearch] REBUILD da sqlite: n={len(keys)} dim={dim} "
            f"in {ms:.1f}ms -> {self.path.name}"
        )
        return idx

    # ------------------------------------------------------------------
    def ensure(
        self,
        *,
        info: Callable[[], Tuple[int, int, str]],
        build: Callable[[], Optional[Tuple[List[int], Any]]],
        force: bool = False,
    ) -> Optional[Any]:
        """Ritorna l'indice pronto (load o rebuild), oppure None se
        indisponibile (il chiamante cade su sqlite-vec — nessun errore).

        `info()` -> (dim, count, embedder_id) e' chiamato SOLO quando serve
        davvero (load/rebuild): sul percorso "cached" nessuna interrogazione
        sqlite extra — latenza della query = solo HNSW search.
        """
        if self.failed:
            return None
        with self._lock:
            try:
                if self._index is not None and not self._dirty and not force:
                    self.last_action = "cached"
                    return self._index
                dim, count, embedder_id = info()
                if not self._info_ok(dim, embedder_id, count):
                    self.last_action = "skipped"
                    return None
                if not self._dirty and not force and self._index is None:
                    idx = self._try_load(dim, embedder_id, count)
                    if idx is not None:
                        return idx
                return self._rebuild(dim, embedder_id, count, build)
            except Exception as exc:
                self.failed = True
                self.last_action = "failed"
                self.last_error = f"{type(exc).__name__}: {exc}"
                _log(f"[usearch] layer NON utilizzabile ({self.last_error}) "
                     "-> fallback permanente a sqlite-vec per questa istanza")
                return None

    # ------------------------------------------------------------------
    def ready(self) -> bool:
        """True se c'e' un indice valido in memoria (nessuna query sqlite)."""
        return self._index is not None and not self._dirty and not self.failed

    # ------------------------------------------------------------------
    def search(self, query_embedding, k: int) -> Optional[List[tuple]]:
        """Top-k [(rowid, distanza_cosine)] o None se il layer non è pronto."""
        idx = self._index
        if idx is None or k <= 0:
            return None
        import numpy as np

        q = np.asarray(query_embedding, dtype=np.float32).reshape(1, -1)
        matches = idx.search(q, count=int(k))
        # usearch 2.26: con1 query puo' ritornare array PIATTO (senza batch):
        # ndim>=2 -> batch [0]; ndim<=1 -> gia' la lista della singola query.
        import numpy as _np
        knd = int(getattr(matches.keys, "ndim", 0) or 0)
        if knd >= 2:
            keys = matches.keys[0]
            dists = matches.distances[0]
        else:
            keys = _np.atleast_1d(matches.keys)
            dists = _np.atleast_1d(matches.distances)
        out: List[tuple] = []
        for key, dist in zip(keys, dists):
            key = int(key)
            if key < 0:
                continue
            out.append((key, float(dist)))
        return out

    # ------------------------------------------------------------------
    def memory_usage(self) -> Optional[int]:
        idx = self._index
        if idx is None:
            return None
        try:
            val = idx.memory_usage
            return int(val() if callable(val) else val)
        except Exception:
            return None

    def stats_snapshot(self) -> dict:
        try:
            disk = int(self.path.stat().st_size) if self.path.exists() else 0
        except OSError:
            disk = 0
        return {
            "path": str(self.path),
            "disk_bytes": disk,
            "memory_bytes": self.memory_usage(),
            "loaded_in_memory": self._index is not None,
            "dirty": self._dirty,
            "failed": self.failed,
            "last_action": self.last_action,
            "last_error": self.last_error,
            "stats": dict(self.stats),
        }
