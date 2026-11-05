"""
core/prefix_cache.py (H3)
--------------------------
PromptPrefixCache: traccia i PREFISSI di prompt gia' visti per il
prompt caching locale.

  hash = sha256(segment1 + segment2 + segment3)   (query ESCLUSA)

I tre segmenti sono: [system profile versionato] -> [header RAG] ->
[storia (turni interi)]. Ogni registrazione logga HIT/MISS in contatori
{hits, misses, hit_rate}. Singleton a livello di modulo.

Niente date/ora/numeri casuali: stesso input -> stesso hash.
"""

from __future__ import annotations

import hashlib
import threading
from typing import Dict

__all__ = ["PromptPrefixCache", "get_prefix_cache"]


class PromptPrefixCache:
    """Contatori HIT/MISS sui prefissi di prompt (thread-safe)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seen = set()
        self._hits = 0
        self._misses = 0

    @staticmethod
    def hash_prefix(seg1: str, seg2: str, seg3: str) -> str:
        """sha256(segment1 + segment2 + segment3) - la query non entra mai."""
        h = hashlib.sha256()
        for seg in (seg1, seg2, seg3):
            h.update((seg or "").encode("utf-8"))
            h.update(b"\x1e")  # separatore di campo (evita ambiguita')
        return h.hexdigest()

    def register(self, seg1: str, seg2: str, seg3: str) -> str:
        """Registra un prefisso. Ritorna 'HIT' o 'MISS'."""
        digest = self.hash_prefix(seg1, seg2, seg3)
        with self._lock:
            if digest in self._seen:
                self._hits += 1
                outcome = "HIT"
            else:
                self._seen.add(digest)
                self._misses += 1
                outcome = "MISS"
        return outcome

    def stats(self) -> Dict[str, float]:
        with self._lock:
            total = self._hits + self._misses
            rate = (self._hits / total) if total else 0.0
            return {
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": rate,
            }

    def hit_rate(self) -> float:
        return self.stats()["hit_rate"]

    def reset(self) -> None:
        with self._lock:
            self._seen.clear()
            self._hits = 0
            self._misses = 0


# Singleton modulo
_PREFIX_CACHE = PromptPrefixCache()


def get_prefix_cache() -> PromptPrefixCache:
    return _PREFIX_CACHE
