"""W6 - maintenance idle (worker offline H12).

Job di manutenzione a pigro, TUTTO deterministico e senza LLM:

1. refresh W2: i doc_id con versione cambiata (doc_ids_versionati) passati
   dal runner - NESSUN accesso diretto al DB qui (il runner glieli passa
   nell'item o nel ctx);
2. eviction cache: la lista d'uso (ordinata per ultimo uso) la passa il
   runner; si espellono i primi k elementi (i meno usati di recente);
3. health index DETERMINISTICO: sha256 dei conteggi/mtimes -> punteggio
   0-100 (stessi input -> stesso punteggio, nessun LLM).

- LLM: mai usato (llm_fn non viene toccato).
"""

from __future__ import annotations

import hashlib
import json

from .base import BaseWorker

__all__ = ["W6Maintenance"]


def _entry_key(entry):
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        for k in ("key", "id", "cache_key", "name"):
            if entry.get(k) is not None:
                return str(entry[k])
    return str(entry)


def _field(item, ctx, name, default=None):
    """Legge un campo dall'item, in fallback dal ctx (passato dal runner)."""
    if isinstance(item, dict) and name in item:
        return item[name]
    if isinstance(ctx, dict) and name in ctx:
        return ctx[name]
    return default


class W6Maintenance(BaseWorker):
    """W6: refresh W2 + eviction cache + health index deterministico."""

    id = "w6"
    batch_size = 1

    def health_index(self, item, ctx=None):
        """Punteggio 0-100 deterministico: sha256 di conteggi e mtimes."""
        d = item if isinstance(item, dict) else {}
        counts = _field(d, ctx, "counts", {}) or {}
        mtimes = _field(d, ctx, "mtimes", {}) or {}
        docs = _field(d, ctx, "doc_ids_versionati", []) or []
        cache = _field(d, ctx, "cache_usage",
                       _field(d, ctx, "cache_entries", [])) or []
        try:
            canon = json.dumps(
                {"counts": counts, "mtimes": mtimes, "docs": docs,
                 "cache_len": len(cache)},
                sort_keys=True, default=str, ensure_ascii=False,
            )
        except (TypeError, ValueError):
            canon = repr(counts) + repr(mtimes)
        digest = hashlib.sha256(canon.encode("utf-8")).digest()
        return int.from_bytes(digest[:4], "big") % 101

    def run(self, batch, ctx=None):
        out_all = {}
        for item in batch:
            key = self.item_key(item)

            # 1) refresh W2: doc con versione cambiata (passati dal runner)
            raw_docs = _field(item, ctx, "doc_ids_versionati", []) or []
            refresh = []
            for d in raw_docs:
                if isinstance(d, str):
                    refresh.append(d)
                elif isinstance(d, dict):
                    if d.get("changed", True):
                        doc_id = d.get("doc_id") or d.get("id")
                        if doc_id is not None:
                            refresh.append(str(doc_id))
            refresh = [x for x in refresh if x]

            # 2) eviction cache: lista ordinata per ultimo uso -> primi k
            cache_list = (_field(item, ctx, "cache_usage")
                          or _field(item, ctx, "cache_entries") or [])
            try:
                k = int(_field(item, ctx, "evict_count", 0) or 0)
            except (TypeError, ValueError):
                k = 0
            k = max(0, min(k, len(cache_list)))
            evicted = [_entry_key(e) for e in cache_list[:k]]

            # 3) health index deterministico (nessun LLM)
            health = self.health_index(item, ctx)

            out_all[key] = {
                "refresh_doc_ids": refresh,
                "evicted": evicted,
                "health": health,
                "llm_calls": 0,
            }
            self.mark(key, "done")
            self.stats["items"] += 1
            self.advance(1)
        return out_all
