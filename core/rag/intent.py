# -*- coding: utf-8 -*-
"""core/rag/intent.py - R18 B3: classificatore INTENT micro (regole +
embedding) e query di retrieval espansa per i follow-up.

Taxonomia (contratto R18b, vedi core/rag/contract.py):
  - stessa-domanda-riformulata : stessa domanda con altre parole
  - sotto-domanda              : follow-up che drill-down sul topic
  - nuova-domanda              : domanda fattuale nuova (senza legame)
  - chit-chat                  : saluti/ringraziamenti/social (0 ricerca)

Regole chiave (dichiarate):
  * marker fattuali (cos'e', chi e', spiega, riassunto, ...) VINCONO il
    fatto che non sia chit-chat (fix F0: "cos'e' la fotosintesi?" era
    classificata chat dal router 0-LLM perche' senza marker "che cos'e'");
  * similarita' vs ULTIMO turno utente: embedding cosine (se disponibile)
    altrimenti jaccard su token >= 4 char; >= 0.92 -> stessa-riformulata;
  * riferimenti anaforici ("questa", "di come", "parlami meglio",
    "approfondisci", ...) o token condivisi -> sotto-domanda;
  * expand_query(): per i follow-up la query di retrieval = entita' del
    topic di conversazione (turni utente precedenti) + termini della
    domanda corrente, MAI la frase letterale da sola.

Zero rete, zero LLM: tutto locale (embedding opzionale del chiamante).
"""
from __future__ import annotations

import re
from typing import Callable, Dict, List, Optional

__all__ = [
    "INTENTS",
    "INTENT_RIFORMULATA",
    "INTENT_SOTTO",
    "INTENT_NUOVA",
    "INTENT_CHITCHAT",
    "SIM_THRESHOLD",
    "classify",
    "expand_query",
    "is_factual",
]

INTENT_RIFORMULATA = "stessa-domanda-riformulata"
INTENT_SOTTO = "sotto-domanda"
INTENT_NUOVA = "nuova-domanda"
INTENT_CHITCHAT = "chit-chat"
INTENTS = (INTENT_RIFORMULATA, INTENT_SOTTO, INTENT_NUOVA, INTENT_CHITCHAT)

SIM_THRESHOLD = 0.92   # soglia B3.2 (>= 0.92 ammessa per riuso cache)

# --- marker FATTUALI: la domanda richiede ricerca/risposta di contenuto --
FACTUAL_MARKERS: tuple = (
    "cos'e", "cos'è", "cosa e", "chi e", "chi è", "che cos", "come",
    "quando", "dove", "perche", "perché", "spiega", "spiegami", "descrivi",
    "definisci", "quali sono", "qual e", "quanto", "differenza",
    "riassunto", "riassumi", "riepilogo", "sintetizza", "approfond",
    "fammi un riassunto", "parlami", "racconta", "spiegami", "chiarisci",
    "meccanismo", "funzionamento", "per quale motivo",
)

# --- marker ANAFORICI: follow-up che referenziano la conversazione --------
REF_MARKERS: tuple = (
    "questa", "questo", "queste", "questi", "di come", "parlami meglio",
    "meglio di", "approfond", "spiega meglio", "piu preciso", "più preciso",
    "la parte", "quel processo", "il processo", "del processo",
    "anch'essa", "esso", "essa", "tale", "sopra citat", "menzionat",
    "riassunto piu", "riassunto più", "piu preciso", "dettagliat",
)

# --- saluti/sociali: chit-chat senza ricerca pesante ----------------------
SOCIAL_FIRST: frozenset = frozenset({
    "ciao", "salve", "buongiorno", "buonasera", "grazie", "grazie!",
    "ok", "okay", "bene", "perfetto", "si", "sì", "no", "quindi",
    "prego", "ayers", "scusa", "scusami", "hey", "hello",
})

_STOP = frozenset("""
il lo la li le gli un uno una di a e o che per con su in da se non piu
più questo questa quello quella suo sua suoi sue questo quei del della
delle dello dei degli al alla alle allo ai agli sul sulla sulle sullo sui
sugli nel nella nelle nello nei negli tra contro oltre verso senza fino
dopo prima come quando dove perche cosa chi qual quali quanto essere sono
era stato avere hanno fa fare fatto bene si no tu io noi voi loro
fammi per favore please the of and to in a is are for on with cose
voglio parlami preciso puntuale meglio dettagliat riepilogo riassunto
vengono viene rilasciato approfondire dimmi racconta rispondi chiedi
""".split())


def _norm(text: str) -> str:
    t = str(text or "").replace("’", "'").strip().lower()
    for a, b in (("à", "a"), ("è", "e"), ("é", "e"), ("ì", "i"),
                 ("ò", "o"), ("ù", "u")):
        t = t.replace(a, b)
    # apostrofi senza spazio: "cos'e" resta un token cercabile
    t = t.replace("'", "")
    return " ".join(t.split())


# marker NORMALIZZATI (stessa trasformazione delle query: senza apostrofi):
# "cos'e" -> "cose", altrimenti "cos'e' la fotosintesi?" non matcha mai
_FACT_NORM: tuple = tuple(_norm(m) for m in FACTUAL_MARKERS)
_REF_NORM: tuple = tuple(_norm(m) for m in REF_MARKERS)
_SOCIAL_NORM: frozenset = frozenset(_norm(m) for m in SOCIAL_FIRST)


def _tokens(text: str) -> List[str]:
    return [w for w in re.findall(r"[a-z0-9]+", _norm(text)) if len(w) >= 4]


def _cosine(a: Optional[List[float]], b: Optional[List[float]]) -> Optional[float]:
    if not a or not b or len(a) != len(b):
        return None
    try:
        dot = na = nb = 0.0
        for x, y in zip(a, b):
            fx, fy = float(x), float(y)
            dot += fx * fy
            na += fx * fx
            nb += fy * fy
    except (TypeError, ValueError):
        return None
    if na <= 0.0 or nb <= 0.0:
        return None
    import math
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _jaccard(a: List[str], b: List[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / float(len(sa | sb))


def _last_user_turn(history_turns) -> str:
    for t in reversed(list(history_turns or [])):
        if not isinstance(t, dict):
            continue
        role = str(t.get("role", "")).lower()
        content = str(t.get("content") or "").strip()
        if content and role in ("user", "utente"):
            return content
    return ""


def is_factual(query: str) -> bool:
    """True se la query e' fattuale (deve eseguire i 3 stadi)."""
    q = _norm(query)
    if any(m in q for m in _FACT_NORM):
        return True
    if len(_tokens(q)) >= 3:
        return True
    return False


def classify(query: str, history_turns=None,
             embed_fn: Optional[Callable[[str], List[float]]] = None
             ) -> Dict:
    """Classifica l'intent della query rispetto alla storia.

    Ritorna {"intent", "similarity", "rule", "metric"} - ogni decisione
    e' descrivibile/loggabile (B3.2: ogni decisione loggata).
    """
    q = str(query or "").strip()
    ql = _norm(q)
    words = ql.split()
    prev_user = _last_user_turn(history_turns)

    # 1) saluto iniziale: "ciao, come stai?" resta chit-chat anche con
    #    parole interrogative generiche; un verbo forte (spiega/dimmi...)
    #    riporta alla classificazione fattuale normale
    if words and words[0].strip(",.!?;:") in _SOCIAL_NORM:
        _interro = {m for m in _FACT_NORM
                    if m in ("come", "quando", "dove", "perche", "chi",
                             "cosa", "qual e", "quali sono")}
        _strong = [m for m in _FACT_NORM
                   if m in ql and m not in _interro]
        if not _strong and len(words) <= 6:
            return {"intent": INTENT_CHITCHAT, "similarity": None,
                    "rule": "saluto-iniziale", "metric": "rules"}

    # 1b) chit-chat: SOLO se non fattuale e social/short o intent0 chat
    if not is_factual(q):
        if (words and words[0] in _SOCIAL_NORM) or (
                len(words) <= 2 and not any(m in ql for m in _REF_NORM)):
            return {"intent": INTENT_CHITCHAT, "similarity": None,
                    "rule": "social/short", "metric": "rules"}
        try:
            from core.ai_router import Router0LLM
            intent0 = Router0LLM().route(q).get("intent")
        except Exception:
            intent0 = None
        if intent0 == "chat":
            return {"intent": INTENT_CHITCHAT, "similarity": None,
                    "rule": f"intent0={intent0}", "metric": "rules"}

    # 1b) containment: la domanda e' un sottoinsieme (con >=2 token
    #     di contenuto) dell'altra -> stessa domanda con specificatore
    #     (es. "cos'e' la fotosintesi?" vs "...clorofilliana")
    if prev_user:
        tq = set(_tokens(q))
        tp = set(_tokens(prev_user))
        if tq and tp and len(tp) >= 2 and tp <= tq:
            return {"intent": INTENT_RIFORMULATA, "similarity": 1.0,
                    "rule": "subset-token", "metric": "containment"}
        if tq and tp and len(tq) >= 2 and tq <= tp:
            return {"intent": INTENT_RIFORMULATA, "similarity": 1.0,
                    "rule": "subset-token", "metric": "containment"}

    # 2) similarita' vs ultimo turno utente (embedding > jaccard)
    sim = None
    metric = "none"
    if prev_user:
        if embed_fn is not None:
            try:
                sim = _cosine(embed_fn(prev_user), embed_fn(q))
                metric = "embedding"
            except Exception:
                sim = None
        if sim is None:
            sim = _jaccard(_tokens(prev_user), _tokens(q))
            metric = "jaccard"

    if sim is not None and sim >= SIM_THRESHOLD:
        return {"intent": INTENT_RIFORMULATA, "similarity": round(sim, 4),
                "rule": f"sim>={SIM_THRESHOLD}", "metric": metric}

    # 3) sotto-domanda: SOLO se c'e' una storia a cui riferirsi
    #    (anafora senza antecedente = domanda a se stante, non follow-up)
    if not prev_user:
        return {"intent": INTENT_NUOVA,
                "similarity": None, "rule": "nessun_legame",
                "metric": "none"}
    ref_hit = [m for m in _REF_NORM if m in ql]
    toks_q, toks_p = set(_tokens(q)), set(_tokens(prev_user))
    shared = toks_q & toks_p
    if ref_hit:
        return {"intent": INTENT_SOTTO,
                "similarity": round(sim, 4) if sim is not None else None,
                "rule": "ref=" + ",".join(ref_hit[:3]), "metric": metric}
    if shared or (sim is not None and sim >= 0.30):
        return {"intent": INTENT_SOTTO,
                "similarity": round(sim, 4) if sim is not None else None,
                "rule": "shared=" + ",".join(sorted(shared)[:4]),
                "metric": metric}

    # 4) nuova domanda
    return {"intent": INTENT_NUOVA,
            "similarity": round(sim, 4) if sim is not None else None,
            "rule": "nessun_legame", "metric": metric}


def _content_tokens(text: str) -> List[str]:
    out = []
    seen = set()
    for w in _tokens(text):
        if w in _STOP or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out


def expand_query(query: str, history_turns) -> str:
    """B3.3: per i follow-up la query di retrieval e' il topic di
    conversazione (entita' dai turni utente precedenti) + la domanda
    corrente - MAI la frase letterale da sola.

    Esempio: follow-up "parlami meglio di questa produzione di ossigeno"
    con storia che contiene "cos'e' la fotosintesi?" ->
    "fotosintesi produzione ossigeno" (max 8 termini, in ordine stabile).
    """
    q = str(query or "").strip()
    if not any(isinstance(t, dict)
               and str(t.get("role", "")).lower() in ("user", "utente")
               and str(t.get("content") or "").strip()
               for t in (history_turns or [])):
        return q   # nessuna storia -> nessun topic: query letterale
    prev_bits: List[str] = []
    for t in reversed(list(history_turns or [])):
        if not isinstance(t, dict):
            continue
        role = str(t.get("role", "")).lower()
        content = str(t.get("content") or "").strip()
        if content and role in ("user", "utente"):
            prev_bits.append(content)
        if len(prev_bits) >= 3:
            break

    cur = _content_tokens(q)
    topic: List[str] = []
    for pb in reversed(prev_bits):
        for w in _content_tokens(pb):
            if w not in topic:
                topic.append(w)

    # termini della frase corrente che NON sono solo anafora/social
    cur_keep = [w for w in cur if w not in _REF_NORM
                and w not in _SOCIAL_NORM and w not in _STOP]
    merged: List[str] = []
    for w in (topic + cur_keep):
        if w not in merged:
            merged.append(w)
    merged = merged[:8]
    expanded = " ".join(merged) if merged else q
    # se l'espansione cancella tutto (frase solo anafora) -> tenere almeno
    # il topic; se non c'e' topic -> query originale (mai vuoto)
    if not expanded.strip():
        expanded = q
    return expanded
