# -*- coding: utf-8 -*-
"""core/rag/hyde.py — P1b.3: HyDE (Hybrid Discriminative Embedding) dietro flag.

Flusso (solo hybrid_search, opt-in via flag ``rag.hyde``):
  1. genera una RISPOSTA IPOTETICA BREVE con il sidecar locale
     (SidecarClient, profile="fast", classe="micro" -> cheap NO-think,
     max_tokens~80);
  2. IL TESTO RISULTANTE viene embeddato con lo stesso embedder del
     pipeline (Embedder.embed_one(..., kind="query")) e usa il vettore
     per la ricerca vettoriale della variante principale;
  3. la ricerca FTS5 resta sulla query originale (le keyword sono piu'
     affidabili dell'hyp per il lexical match).

Budget/onestà (dichiarato, misurato in qa/p1b_rag.json):
  * TIMEOUT ~8s per la generazione (HYDE_TIMEOUT_S): se il sidecar non e'
    disponibile o supera il budget -> FALLBACK SILENZIOSO alla query
    normale con log (nessuna eccezione al caller).
  * Il costo end-to-end (LLM + embed) sara' >>150ms quando il sidecar
    risponde: e' misurato nell'A/B e la regola ON/OFF usa quel numero.

Testabilità: generate_hypothetical accetta `client` iniettabile -> nel
test si usa un client finto, MAI un LLM reale.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, Dict, Optional, Tuple

from core.rag.gate import rag_flag

__all__ = [
    "HYDE_TIMEOUT_S",
    "HYDE_MAX_TOKENS",
    "hyde_enabled",
    "generate_hypothetical",
]

# Budget dichiarato: ~8s per l'intera generazione ipotetica.
HYDE_TIMEOUT_S = 8.0
HYDE_MAX_TOKENS = 80

# Prompt breve, cheap, no-think: 1-2 frasi enciclopediche.
HYDE_PROMPT = (
    "Rispondi in massimo 2 frasi brevi (max 40 parole), tono enciclopedico, "
    "solo fatti, nessuna introduzione.\n"
    "Domanda: {q}\n"
    "Risposta:"
)


def hyde_enabled() -> bool:
    """True se la tecnica HyDE e' attiva (flag rag.hyde / env RAG_TECH)."""
    return rag_flag("rag.hyde")


def _complete(client: Any, query: str, timeout_s: float, max_tokens: int) -> str:
    """Chiamata LLM (worker thread): costruisce il client solo qui."""
    if client is None:
        from core.sidecar.client import SidecarClient
        # auto_start=False: HyDE MAI avvia/ricarica il server (nessuna
        # attesa indefinita); se il sidecar non gira -> AiUnavailable.
        client = SidecarClient(auto_start=False, timeout=timeout_s)
    out = client.complete(
        HYDE_PROMPT.format(q=query),
        profile="fast", classe="micro",
        max_tokens=int(max_tokens), stream=False,
    )
    return str(out or "").strip()


def generate_hypothetical(
    query: str,
    *,
    client: Any = None,
    timeout_s: float = HYDE_TIMEOUT_S,
    max_tokens: int = HYDE_MAX_TOKENS,
) -> Tuple[Optional[str], Dict[str, Any]]:
    """Risposta ipotetica BREVE (HyDE) con budget esplicito.

    Ritorna (testo | None, info):
      info = {"ok": bool, "reason": str, "ms": float, "text_len": int}
    None = fallback silenzioso alla query normale (sidecar giu'/timeout/
    risposta vuota): il caller logga info e continua senza HyDE.
    """
    t0 = time.perf_counter()
    info: Dict[str, Any] = {"ok": False, "reason": "", "ms": 0.0, "text_len": 0}
    if not (query or "").strip():
        info["reason"] = "query_vuota"
        return None, info

    ex = ThreadPoolExecutor(max_workers=1)
    try:
        fut = ex.submit(_complete, client, query, timeout_s, max_tokens)
        try:
            text = fut.result(timeout=float(timeout_s))
        except FutureTimeout:
            info["reason"] = "timeout"
            info["ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
            print(f"[HyDE] budget {timeout_s}s superato -> fallback query "
                  f"normale")
            return None, info
        except Exception as exc:  # sidecar giu'/errore: fallback silenzioso
            info["reason"] = f"llm_down:{type(exc).__name__}"
            info["ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
            print(f"[HyDE] sidecar non disponibile ({info['reason']}) -> "
                  f"fallback query normale")
            return None, info
    finally:
        # Non attende un worker ancora bloccato (il budget resta 8s).
        try:
            ex.shutdown(wait=False)
        except Exception:
            pass

    info["ms"] = round((time.perf_counter() - t0) * 1000.0, 1)
    if not text:
        info["reason"] = "risposta_vuota"
        return None, info
    info["ok"] = True
    info["text_len"] = len(text)
    return text, info
