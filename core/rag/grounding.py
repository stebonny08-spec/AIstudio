# -*- coding: utf-8 -*-
"""core/rag/grounding.py - R18 B2/B5: self-check di GROUNDING (LLM think,
grammatica JSON {ok, violations[]}) + controllo DETERMINISTICO di
profondita' per intent (B5.1).

Flusso (router, dopo la generazione):
  1) depth_check(testo, intent)  -> deterministico, zero LLM;
  2) run_check(...)              -> UNA chiamata (profilo think) che
     verifica che ogni affermazione fattuale sia tracciabile ai chunk/doc
     forniti -> {"ok": bool, "violations": [...]} (grammatica JSON);
  3) violations o depth KO -> UNA rigenerazione vincolata al contesto
     (router inoltra repair_note al client);
  4) se persiste -> il router SOSTITUISCE/APPENDE la frase onesta di
     limite (limit_statement) invece di lasciare affermazioni non verificate.

Tutto il fallback e' non-bloccante: se il backend di check non e'
raggiungibile il check e' dichiarato "skipped" nei log (mai eccezione).
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional, Sequence

__all__ = [
    "GRAMMAR_KEYS",
    "min_words_for",
    "depth_check",
    "build_check_messages",
    "parse_check",
    "run_check",
    "limit_statement",
]

GRAMMAR_KEYS = ("ok", "violations")

# --- B5.1: minimi per intent ---------------------------------------------
_MIN_WORDS = {
    "nuova-domanda": 120,          # explain: >=120 parole o >=3 punti
    "stessa-domanda-riformulata": 80,
    "sotto-domanda": 80,           # deepen: >=80 parole focalizzate
    "chit-chat": 0,
}
_BULLET_MIN_FOR_SHORT = 3          # alternative strutturata per explain
_FACTUAL_ONE_LINER = 40            # risposta fattuale di 1 riga = rosso

_CHECK_SYSTEM = (
    "Sei un verificatore rigoroso. Dato un CONTESTO (fonti) e una RISPOSTA, "
    "decidi se ogni affermazione fattuale della risposta (date, numeri, "
    "nomi, processi, cause-effette, definizioni) e' tracciabile al contesto. "
    "Segnala SOLO invenzioni o affermazioni in netto contrasto con il "
    "contesto: NON segnalare opinioni, riassunti leggermente riformulati o "
    "stili. Rispondi ESCLUSIVAMENTE con un JSON valido della forma "
    '{"ok": true, "violations": []} oppure '
    '{"ok": false, "violations": ["affermazione 1", "affermazione 2"]}. '
    "Nessun testo fuori dal JSON."
)


def min_words_for(intent: str) -> int:
    return int(_MIN_WORDS.get(str(intent or ""), 0))


def _bullets(text: str) -> int:
    n = 0
    for line in (text or "").splitlines():
        s = line.strip()
        if re.match(r"^([-*•]|\d+[.)])\s+\S", s):
            n += 1
    return n


def depth_check(text: str, intent: str) -> Dict[str, Any]:
    """B5.1 - deterministico. ok se:
      * chit-chat -> sempre;
      * nuova-domanda -> parole >= 120 OPPURE >= 3 punti strutturati;
      * sotto-domanda / stessa-riformulata -> parole >= 80;
      * mai risposta fattuale "di una riga" (< 40 parole) per intent
        non-chit-chat.
    """
    words = len(str(text or "").split())
    bullets = _bullets(text)
    intent = str(intent or "")
    if intent == "chit-chat":
        return {"ok": True, "words": words, "bullets": bullets,
                "min": 0, "reason": "chit-chat libera"}
    mn = min_words_for(intent)
    if intent == "nuova-domanda":
        ok = words >= mn or bullets >= _BULLET_MIN_FOR_SHORT
    else:
        ok = words >= mn
    if ok and words < _FACTUAL_ONE_LINER and bullets < _BULLET_MIN_FOR_SHORT:
        ok = False
    return {"ok": bool(ok), "words": words, "bullets": bullets, "min": mn,
            "reason": ("ok" if ok else
                       f"profondita' insufficiente: {words} parole "
                       f"(min {mn}) / {bullets} punti")}


def build_check_messages(query: str, context_texts: Sequence[str],
                         answer: str) -> List[Dict[str, str]]:
    blocks = []
    for i, t in enumerate(list(context_texts or [])[:5], 1):
        blocks.append(f"[fonte {i}] {str(t)[:600]}")
    ctx = "\n".join(blocks) if blocks else "(nessun contesto disponibile)"
    user = (
        f"DOMANDA ORIGINALE:\n{str(query or '')[:400]}\n\n"
        f"CONTESTO (fonti fornite):\n{ctx}\n\n"
        f"RISPOSTA DA VERIFICARE:\n{str(answer or '')[:2000]}\n\n"
    f"REGOLE AGGIUNTIVE: (1) se la domanda richiede date/anni/numeri e il "
        "CONTESTO li contiene ma la RISPOSTA li omette o li riporta "
        "sbagliati -> violation; (2) COMPLETEZZA: se la risposta OMETTE un "
        "fatto centrale per la domanda che e' esplicitamente nel CONTESTO "
        "(es. composti/processi di un processo chimico, autori/opere, "
        "nomi) elencalo come violation dicendo cosa manca; (3) NON "
        "segnalare opinioni o riassunti leggermente riformulati. "
        "Rispondi SOLO col JSON."
    )
    return [
        {"role": "system", "content": _CHECK_SYSTEM},
        {"role": "user", "content": user},
    ]


def parse_check(raw: str) -> Dict[str, Any]:
    """Parsing robusto della grammatica JSON (code-fence, testo attorno)."""
    s = str(raw or "").strip()
    if not s:
        return {"ok": False, "violations": [], "parse_error": "vuoto"}
    s = re.sub(r"^```(?:json)?|```$", "", s.strip(), flags=re.M).strip()
    obj = None
    start = s.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(s)):
            if s[i] == "{":
                depth += 1
            elif s[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(s[start:i + 1])
                    except (json.JSONDecodeError, ValueError):
                        obj = None
                    break
    if obj is None:
        try:
            obj = json.loads(s)
        except (json.JSONDecodeError, ValueError):
            return {"ok": False, "violations": [],
                    "parse_error": "json non interpretabile",
                    "raw_head": s[:200]}
    if not isinstance(obj, dict):
        return {"ok": False, "violations": [], "parse_error": "non-obj"}
    ok = bool(obj.get("ok"))
    viol = obj.get("violations") or []
    if not isinstance(viol, list):
        viol = [str(viol)]
    viol = [str(v) for v in viol if str(v).strip()]
    if viol:
        ok = False
    return {"ok": ok, "violations": viol}


def run_check(query: str, context_texts: Sequence[str], answer: str,
              *, client: Any = None,
              budget_s: Optional[float] = None) -> Dict[str, Any]:
    """UNA chiamata LLM (profilo think) -> {"ok","violations",...}.

    Ordine dichiarato:
      1) sidecar (profile='think', classe='think', max_tokens 350);
      2) client in-process (fallback, stesso messaggio);
      3) backend assente -> {"ok": None, "skipped": motivo} (mai eccezione).
    """
    messages = build_check_messages(query, context_texts, answer)
    # 1) sidecar (maker a livello modulo OPPURE metodo del client)
    sidecar_err = ""
    try:
        mk = None
        try:
            from core.local_llm_client import (
                _make_sidecar_client as _mkside)
            mk = _mkside
        except ImportError:
            mk = None
        if mk is None and client is not None:
            mkc = getattr(client, "_make_sidecar_client", None)
            if callable(mkc):
                mk = mkc
        if mk is None:
            raise RuntimeError("maker sidecar non disponibile")
        sc = mk()
        # R18 fix10: timeout corto sul SOLO check (70s): un blocco
        # lungo qui finiva in doppio path legacy e, se il server
        # moriva, in un fallback in-process (watchdog QA)
        try:
            sc.timeout = min(float(getattr(sc, "timeout", 70.0)
                                       or 70.0), 70.0)
        except Exception:
            pass
        # profilo think (campionamento think, temp 0.6) ma reasoning OFF:
        # grammatica JSON richiesta - con reasoning ON la risposta e' vuota
        raw = sc.complete(messages, profile="think", classe="think",
                          max_tokens=250, thinking=False)
        parsed = parse_check(raw)
        if parsed.get("parse_error"):
            parsed["ok"] = None   # grammatica non ottenuta -> saltato
        parsed["backend"] = "sidecar:think"
        return parsed
    except Exception as exc:
        sidecar_err = f"{type(exc).__name__}: {exc}"
    # 2) R18 fix10: NESSUN fallback in-process (caricare il modello
    #    durante il check provocava blocchi >600s - watchdog QA): se
    #    il check sidecar non va, e' saltato e loggato (mai eccezione).
    return {"ok": None, "violations": [],
            "skipped": "sidecar check non disponibile",
            "errors": [sidecar_err]}


def limit_statement(violations: Sequence[str]) -> str:
    """Frase onesta EMESSA quando la rigenerazione non risolve: dichiara il
    limite invece di affermare (B2.1)."""
    v = [str(x).strip() for x in (violations or []) if str(x).strip()]
    base = ("Non riesco a verificare completamente questa risposta sulle "
            "fonti disponibili, quindi prendila con le dovute cautele.")
    if v:
        return base + f" Punto non confermato: {v[0][:160]}."
    return base
