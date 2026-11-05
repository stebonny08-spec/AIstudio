"""
core/ai_router.py — Router 0-LLM (H9)
======================================

Decide l'intento della richiesta dell'utente — chat | rag | tool | cache —
SENZA alcun LLM: regole deterministiche, riproducibili, p95 < 5 ms.

Perche' 0-LLM: classificare una frase non richiede un modello; ogni
andata in LLM costa latenza e soldi. L'LLM (think/composer) resta il
chiamante: da qui escono solo l'intento, i sub-query e il motivo.

Regole, in ordine (deterministiche):
  (a) cache_hit presente              -> 'cache'
  (b) modulo 'fogli' + formula        -> 'tool'   (F07/F08, euristiche:
       '=' iniziale / riferimenti cella -> F07; descrizione "formula" -> F08)
  (c) selezione testo + azione doc/appunti -> 'tool' (F01 salva/appunti,
       F05 riassumi/evidenzia/commenta)
  (e) comando esplicito               -> 'tool'   "salva come"->F01,
       "crea flashcard"->F12, "pianifica"->F10
  (d*) CENTROIDI (opzionali): solo per query AMBIGUE (10-12 parole e senza
       keyword di nessuna regola): soglia cosine sul vettore tema piu'
       vicino. Se manca centroids o embed_fn -> SOLO REGOLE, nessun errore.
  (d) domanda ("che cos'e/perche'/commenti/spiega/su cosa") oppure
       >8 parole                       -> 'rag'
  (f) default                          -> 'chat'

DECOMPOSIZIONE: query 'rag' complesse (>2 frasi O connettivi "e anche",
"inoltre", "confronta", ...) -> <=3 sub-query parallele, split
DETERMINISTICO (niente LLM). Il composer (LLM think) NON e' di questo
modulo: il caller usa compose_subqueries(subs) -> str per costruire il
prompt.

API: Router0LLM(...).route(text, has_selection=False, module=None,
cache_hit=None) -> {'intent', 'subqueries', 'reason', 'fid'}
Latenza: nessuna rete, nessun modello, stdlib pura (re/json/math/pathlib).
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "Router0LLM",
    "INTENTS",
    "QUESTION_MARKERS",
    "COMMAND_FID_MAP",
    "SELECTION_ACTIONS",
    "COMPLEX_CONNECTORS",
    "compose_subqueries",
]

INTENTS: Tuple[str, ...] = ("chat", "rag", "tool", "cache")

# --- marker di DOMANDA (regola d) -----------------------------------
QUESTION_MARKERS: Tuple[str, ...] = (
    "che cos'è",
    "che cos'e",
    "che cosa",
    "perché",
    "perche",
    "commenti",
    "commento",
    "spiega",
    "spiegami",
    "su cosa",
    "come funziona",
    "in che modo",
    "qual è",
    "qual e",
    "quali sono",
    "cosa significa",
)

# --- comandi -> fid (regola e) --------------------------------------
COMMAND_FID_MAP: Tuple[Tuple[Tuple[str, ...], str], ...] = (
    (("salva come", "salva negli appunti", "salva in appunti"), "F01"),
    (("crea flashcard", "crea flashcards", "genera flashcard", "flash card"), "F12"),
    (("pianifica", "pianificami"), "F10"),
)

# --- azioni con testo selezionato -> fid (regola c) -----------------
SELECTION_ACTIONS: Tuple[Tuple[Tuple[str, ...], str], ...] = (
    (("salva", "appunti", "nota", "annota", "memorizza"), "F01"),
    (
        ("riassumi", "riassunto", "evidenzia", "sottolinea", "commenta", "commenti"),
        "F05",
    ),
)

# --- connettivi per la decomposizione --------------------------------
COMPLEX_CONNECTORS: Tuple[str, ...] = (
    "inoltre confronta",
    "e anche",
    "inoltre",
    "in aggiunta",
    "in più",
    "e poi",
    "confronta",
    "tutto su",   # R15b P1: multi-punto / "confronta" / "tutto su"
)

_CELL_REF = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]{1,3}\d{1,5}(?![A-Za-z0-9])")


# ---------------------------------------------------------------------
# Helpers deterministici
# ---------------------------------------------------------------------
def _normalize(text: Optional[str]) -> str:
    t = str(text or "").replace("\u2019", "'").strip().lower()
    return " ".join(t.split())


def _cosine(a: Optional[Sequence[float]], b: Optional[Sequence[float]]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    try:
        dot = na = nb = 0.0
        for x, y in zip(a, b):
            fx, fy = float(x), float(y)
            dot += fx * fy
            na += fx * fx
            nb += fy * fy
    except (TypeError, ValueError):
        return 0.0
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _is_fogli(module: Optional[str]) -> bool:
    m = str(module or "").strip().lower()
    return m == "fogli" or m.startswith("fogli")


def _looks_like_formula(t: str) -> bool:
    if t.startswith("="):
        return True
    if "formula" in t:
        return True
    if _CELL_REF.search(t):
        return True
    return False


def _formula_fid(t: str) -> str:
    """Euristica F07/F08: formula eseguibile (=/celle) vs descrizione."""
    if t.startswith("=") or _CELL_REF.search(t):
        return "F07"
    return "F08"


def _question_marker(t: str) -> Optional[str]:
    for m in QUESTION_MARKERS:
        if m in t:
            return m
    return None


def _is_complex(t: str) -> bool:
    sents = [s for s in re.split(r"[.!?]+", t) if s.strip()]
    if len(sents) > 2:
        return True
    return any(c in t for c in COMPLEX_CONNECTORS)


def _split_subqueries(t: str) -> List[str]:
    """Split deterministico: frasi (.!?;) poi connettivi. Max 3 pezzi."""
    parts = [p.strip() for p in re.split(r"[.!?;]+", t) if p.strip()]
    out: List[str] = []
    for part in parts:
        chunks = [part]
        for conn in COMPLEX_CONNECTORS:
            nxt: List[str] = []
            for ch in chunks:
                nxt.extend(ch.split(conn))
            chunks = nxt
        out.extend(c.strip() for c in chunks if c.strip())
    seen = set()
    res: List[str] = []
    for x in out:
        k = x.lower()
        if k in seen:
            continue
        seen.add(k)
        res.append(x)
    return res[:3]


def _rag_subqueries(t: str) -> List[str]:
    if not _is_complex(t):
        return []
    subs = _split_subqueries(t)
    return subs if len(subs) > 1 else []


def compose_subqueries(subs: Optional[Sequence[str]]) -> str:
    """Il composer (LLM think) NON e' di questo modulo: qui si espone solo
    il join deterministico dei sub-query per il prompt del caller."""
    return "\n".join("- %s" % s.strip() for s in (subs or []) if s and s.strip())


# ---------------------------------------------------------------------
# Centroidi opzionali
# ---------------------------------------------------------------------
def _parse_centroids(data: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if data is None:
        return out
    if isinstance(data, dict) and "centroids" in data:
        data = data["centroids"]
    if isinstance(data, dict):
        items = list(data.items())
        for name, val in items:
            vec = None
            intent = None
            if isinstance(val, dict):
                vec = val.get("vector") or val.get("vec") or val.get("embedding")
                intent = val.get("intent")
            else:
                vec = val
            if vec:
                out.append(
                    {"name": str(name), "vector": [float(x) for x in vec], "intent": intent}
                )
    elif isinstance(data, (list, tuple)):
        for i, item in enumerate(data):
            if not isinstance(item, dict):
                continue
            vec = item.get("vector") or item.get("vec") or item.get("embedding")
            if not vec:
                continue
            out.append(
                {
                    "name": str(item.get("name") or "centroid_%d" % i),
                    "vector": [float(x) for x in vec],
                    "intent": item.get("intent"),
                }
            )
    return out


def _load_centroids_file(path: Any) -> List[Dict[str, Any]]:
    """Carica centroids.json opzionale. File assente/corrotto -> [] (nessun errore)."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return []
    return _parse_centroids(data)


# ---------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------
class Router0LLM:
    """Router deterministico chat|rag|tool|cache senza LLM, p95 < 5 ms.

    Parametri opzionali:
      embed_fn          : callabile testo -> vettore (senza: centroidi inerti)
      centroids_path    : path a centroids.json (opzionale)
      centroids         : centroidi iniettati (dict/lista) — usa questi invece
                          del path (comodo per test con centroidi finti)
      centroid_threshold: soglia cosine minima per accettare un tema
    """

    def __init__(
        self,
        embed_fn: Optional[Callable[[str], Sequence[float]]] = None,
        centroids_path: Optional[str] = None,
        centroids: Any = None,
        centroid_threshold: float = 0.5,
    ) -> None:
        self._embed_fn = embed_fn
        if centroids is not None:
            self._centroids = _parse_centroids(centroids)
        elif centroids_path:
            self._centroids = _load_centroids_file(centroids_path)
        else:
            self._centroids = []
        self._centroid_threshold = float(centroid_threshold)

    # ---------------- classificazione ----------------
    def route(
        self,
        text: str,
        has_selection: bool = False,
        module: Optional[str] = None,
        cache_hit: Any = None,
    ) -> Dict[str, Any]:
        """-> {'intent': chat|rag|tool|cache, 'subqueries': [..<=3],
        'reason': str, 'fid': str|None}  — nessuna dipendenza LLM."""
        t = _normalize(text)
        n_words = len(t.split()) if t else 0

        # (a) cache
        if cache_hit:
            return {
                "intent": "cache",
                "subqueries": [],
                "reason": "cache_hit presente: riusa la risposta in cache",
                "fid": None,
            }

        # (b) fogli + formula -> tool (F07/F08)
        if _is_fogli(module) and _looks_like_formula(t):
            fid = _formula_fid(t)
            return {
                "intent": "tool",
                "subqueries": [],
                "reason": "modulo fogli + formula -> %s" % fid,
                "fid": fid,
            }

        # (c) selezione + azione doc/appunti -> tool (F01/F05)
        if has_selection:
            for triggers, fid in SELECTION_ACTIONS:
                hit = next((tr for tr in triggers if tr in t), None)
                if hit:
                    return {
                        "intent": "tool",
                        "subqueries": [],
                        "reason": "selezione + azione '%s' -> %s" % (hit, fid),
                        "fid": fid,
                    }

        # (e) comandi espliciti -> tool con fid mappato
        for triggers, fid in COMMAND_FID_MAP:
            hit = next((tr for tr in triggers if tr in t), None)
            if hit:
                return {
                    "intent": "tool",
                    "subqueries": [],
                    "reason": "comando '%s' -> %s" % (hit, fid),
                    "fid": fid,
                }

        # (d*) centroidi: SOLO query ambigue (10-12 parole, no keyword)
        cen = self._centroid_intent(t, n_words)
        if cen is not None:
            return cen

        # (d) domanda o testo lungo -> rag
        marker = _question_marker(t)
        if marker is not None:
            return {
                "intent": "rag",
                "subqueries": _rag_subqueries(t),
                "reason": "domanda: '%s'" % marker,
                "fid": None,
            }
        if n_words > 8:
            return {
                "intent": "rag",
                "subqueries": _rag_subqueries(t),
                "reason": "%d parole (>8)" % n_words,
                "fid": None,
            }

        # (f) default
        return {
            "intent": "chat",
            "subqueries": [],
            "reason": "default: nessuna regola applicata",
            "fid": None,
        }

    # ---------------- centroidi ----------------
    def _centroid_intent(self, t: str, n_words: int) -> Optional[Dict[str, Any]]:
        if not self._centroids or self._embed_fn is None:
            return None  # opzionale assente -> solo regole, nessun errore
        if not (10 <= n_words <= 12):
            return None  # solo query ambigue
        # "no keyword": se qualcuna delle regole esplicite scatta, non e' ambigua
        if _question_marker(t) is not None:
            return None
        for triggers, _fid in COMMAND_FID_MAP:
            if any(tr in t for tr in triggers):
                return None
        for triggers, _fid in SELECTION_ACTIONS:
            if any(tr in t for tr in triggers):
                return None
        try:
            vec = self._embed_fn(t)
        except Exception:
            return None
        if not vec:
            return None
        best: Optional[Dict[str, Any]] = None
        best_sim = -1.0
        for c in self._centroids:
            sim = _cosine(vec, c.get("vector"))
            if sim > best_sim:
                best_sim = sim
                best = c
        if best is None or best_sim < self._centroid_threshold:
            return None  # sotto soglia -> si ricade sulle regole
        intent = best.get("intent") or "rag"
        if intent not in INTENTS:
            intent = "rag"
        subs = _rag_subqueries(t) if intent == "rag" else []
        return {
            "intent": intent,
            "subqueries": subs,
            "reason": "centroidi: %s (cos=%.2f)" % (best.get("name"), best_sim),
            "fid": None,
        }

    # ---------------- composer (join per il caller) ----------------
    @staticmethod
    def compose_subqueries(subs: Optional[Sequence[str]]) -> str:
        return compose_subqueries(subs)
