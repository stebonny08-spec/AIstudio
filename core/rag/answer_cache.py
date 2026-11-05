# -*- coding: utf-8 -*-
"""core/rag/answer_cache.py - P4: CACHE RISPOSTE PRIMA DI TUTTO.

Cache persistente delle risposte complete, controllata dal router P PRIMA
del semantic router, del retrieval e della generazione.

Dichiarazioni (contratto P4):
  - Persistenza: JSONL su AppData (get_app_data_dir()/answer_cache.jsonl).
  - TTL: 7 GIORNI COSTANTE (TTL_DAYS_DEFAULT = 7, allineato a
    web.cache_ttl_days della config; il valore letto dal router puo'
    sovrascrivere il default a init).
  - Chiave: query normalizzata + model_id + set di stadi attivi.
  - HIT (R16 follow-up): rielaborazione LLM della bozza salvata con
    progress "cache" - MAI il testo identico (guard not_identical);
    risposte marcate SBAGLIATE dall'utente (flag_wrong_answer) sono
    eliminate e mai piu' riusate.
  - Scrittura: SOLO risposte COMPLETE (nessun testo troncato da split/
    stop) CON FONTI (items delle fonti non vuoti).
  - Invalidazione: fingerprint del corpus (doc_versions / coverage) quando
    disponibile; altrimenti TTL + clear dichiarato (nessuna lettura di
    indici proprietari di altri blocchi).

Tutto 100% locale: nessuna rete, nessun LLM.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

# TTL COSTANTE dichiarato (giorni). La config web.cache_ttl_days (default 7)
# puo' sovrascriverlo: resta comunque un valore fisso a runtime per entry.
TTL_DAYS_DEFAULT = 7

_CACHE_FILENAME = "answer_cache.jsonl"
_PRUNE_REWRITE_EVERY = 50   # riscrittura del file ogni N put (anti-grow)


def normalize_query(query: str) -> str:
    """Normalizzazione deterministica della query per la chiave:
    minuscolo, spazi compattati, punteggiatura di confine rimossa."""
    q = str(query or "").replace("\u2019", "'").strip().lower()
    q = " ".join(q.split())
    return q.strip(" .,:;!?\"'()[]{}")


def make_key(query: str, model_id: str, stages: Any) -> str:
    """Chiave = query normalizzata + model_id + set stadi attivi.

    stages: qualunque iterable di stringhe (o stringa) -> unito ordinato.
    """
    if isinstance(stages, str):
        stage_part = stages
    else:
        stage_part = "|".join(sorted(str(s) for s in (stages or [])))
    raw = f"{normalize_query(query)}\n{model_id or ''}\n{stage_part}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


class AnswerCache:
    """Cache JSONL in-memory con persistenza su disco e lock di processo."""

    def __init__(self, path: Optional[Path] = None,
                 ttl_days: int = TTL_DAYS_DEFAULT):
        self.ttl_seconds = int(ttl_days) * 86400
        if path is None:
            try:
                from data.config_manager import get_app_data_dir
                path = Path(get_app_data_dir()) / _CACHE_FILENAME
            except Exception:
                path = Path.home() / "AppData" / "Roaming" / "NovaStudio" / _CACHE_FILENAME
        self.path = Path(path)
        self._lock = threading.Lock()
        self._entries: Dict[str, Dict[str, Any]] = {}
        self._puts_since_rewrite = 0
        self._loaded = False
        self.hits = 0
        self.misses = 0
        self.writes = 0

    # ------------------------------------------------------------ I/O
    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.path.exists():
            return
        try:
            with self.path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except (json.JSONDecodeError, ValueError):
                        continue  # riga corrotta: saltata (dichiarato)
                    if isinstance(rec, dict) and rec.get("key"):
                        self._entries[rec["key"]] = rec
        except OSError as exc:
            print(f"[AnswerCache] lettura non disponibile: {exc}")
        # prune dichiarato a load: scadute e copie incomplete saltate
        self._entries = {k: r for k, r in self._entries.items()
                         if self._is_fresh(r)}

    def _is_fresh(self, rec: Dict[str, Any]) -> bool:
        try:
            ts = float(rec.get("ts", 0.0))
        except (TypeError, ValueError):
            return False
        if time.time() - ts > self.ttl_seconds:
            return False
        if not rec.get("text") or not rec.get("items"):
            return False  # solo risposte complete CON FONTI
        return True

    def _rewrite_file(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".jsonl.tmp")
            with tmp.open("w", encoding="utf-8") as f:
                for rec in self._entries.values():
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            tmp.replace(self.path)
            self._puts_since_rewrite = 0
        except OSError as exc:
            print(f"[AnswerCache] riscrittura non disponibile: {exc}")

    # ------------------------------------------------------------ API
    def get(self, key: str, fingerprint: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Ritorna il record fresco o None (TTL + fingerprint corpus)."""
        with self._lock:
            self._load()
            rec = self._entries.get(key)
            if rec is None or not self._is_fresh(rec):
                self.misses += 1
                return None
            if fingerprint is not None and rec.get("fingerprint") is not None:
                if rec.get("fingerprint") != fingerprint:
                    # corpus cambiato (doc_versions/coverage): entry invalidata
                    del self._entries[key]
                    self._rewrite_file()
                    self.misses += 1
                    return None
            self.hits += 1
            return dict(rec)

    def put(self, key: str, *, query: str, text: str, source: str,
            items: List[dict], model_id: str, stages: Any,
            fingerprint: Optional[str] = None,
            provenance: Optional[List[str]] = None) -> bool:
        """Scritte SOLO risposte complete con fonti. Ritorna True se scritto."""
        text = text or ""
        items = [i for i in (items or []) if isinstance(i, dict)]
        if not text.strip() or not items:
            return False  # incompleta o senza fonti: NON scritta (vincolo P4)
        rec = {
            "key": key,
            "query": query,
            "query_norm": normalize_query(query),
            "model_id": model_id or "",
            "stages": stages if isinstance(stages, str)
                      else "|".join(sorted(str(s) for s in (stages or []))),
            "text": text,
            "source": source or "",
            "items": items,
            "provenance": list(provenance or []),
            "fingerprint": fingerprint,
            "ts": time.time(),
            "ttl_days": self.ttl_seconds // 86400,
        }
        with self._lock:
            self._load()
            self._entries[key] = rec
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                self.writes += 1
                self._puts_since_rewrite += 1
                if self._puts_since_rewrite >= _PRUNE_REWRITE_EVERY:
                    # rewrite periodico con prune (anti-crescita del file)
                    self._entries = {k: r for k, r in self._entries.items()
                                     if self._is_fresh(r)}
                    self._rewrite_file()
            except OSError as exc:
                print(f"[AnswerCache] scrittura non disponibile: {exc}")
                return False
        return True

    def invalidate_text(self, text: str) -> int:
        """R16 follow-up: elimina le entry la cui risposta coincide con
        `text` (risposta marcata sbagliata dall'utente -> MAI piu' riusata).
        Ritorna il numero di entry eliminate."""
        def _norm(s: str) -> str:
            return " ".join(str(s or "").split()).lower()
        target = _norm(text)
        if not target:
            return 0
        with self._lock:
            self._load()
            dead = [k for k, r in self._entries.items()
                    if _norm(r.get("text")) == target]
            for k in dead:
                del self._entries[k]
            if dead:
                self._rewrite_file()
            return len(dead)

    def clear(self) -> None:
        """Svuota cache + file (clear dichiarato, fallback invalidazione)."""
        with self._lock:
            self._entries.clear()
            self._loaded = True
            try:
                if self.path.exists():
                    self.path.unlink()
            except OSError:
                pass

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            self._load()
            return {
                "entries": len(self._entries),
                "hits": self.hits,
                "misses": self.misses,
                "writes": self.writes,
                "ttl_days": self.ttl_seconds // 86400,
                "path": str(self.path),
            }


def corpus_fingerprint(stores: Optional[List[Any]] = None,
                       db: Any = None) -> Optional[str]:
    """Fingerprint del corpus per invalidare la cache (P4).

    Ordine dichiarato:
      1) tabelle doc_versions / conteggio chunks degli store SQLite
         (indice versioni esistente - lettura sola via URI mode=ro);
      2) fallback: indice indexed_files del Database (count + max ts);
      3) altrimenti None -> invalidazione solo TTL + clear dichiarato.
    """
    parts: List[str] = []
    seen_db: set = set()
    for store in stores or []:
        db_path = getattr(store, "db_path", None)
        if db_path is None:
            continue
        try:
            db_path = str(db_path)
        except Exception:
            continue
        if db_path in seen_db:
            continue
        seen_db.add(db_path)
        try:
            import sqlite3
            from pathlib import Path as _P
            if not _P(db_path).exists():
                continue
            con = sqlite3.connect(f"file:{_P(db_path).resolve().as_posix()}?mode=ro",
                                  uri=True, timeout=3.0)
            try:
                try:
                    row = con.execute(
                        "SELECT COUNT(*), COALESCE(MAX(ts), 0) FROM doc_versions"
                    ).fetchone()
                    parts.append(f"dv:{row[0]}:{row[1]}")
                except Exception:
                    parts.append("dv:none")
                try:
                    row = con.execute("SELECT COUNT(*) FROM chunks").fetchone()
                    parts.append(f"ch:{row[0]}")
                except Exception:
                    pass
            finally:
                con.close()
        except Exception:
            continue
    if parts:
        return "|".join(parts)
    # fallback indice versioni/coverage dichiarato dal Database
    try:
        rows = db.list_indexed_files() if db is not None else None
        if rows is not None:
            sig = ";".join(
                f"{r['percorso_file']}:{r['data_ultima_indicizzazione']}"
                for r in rows
            )
            return "idx:" + hashlib.sha1(sig.encode("utf-8")).hexdigest()[:16]
    except Exception:
        pass
    return None
