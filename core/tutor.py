"""core/tutor.py — Tutor FSRS (F04): algoritmo NEL CODICE, nessun servizio.

FSRS
  Implementazione FSRS-4.5 SEMPLIFICATA con pesi w fissi di default
  (nessuna ottimizzazione, nessuna persistenza esterna). Deterministica:
  se si passa `now` (timestamp), gli stessi input danno gli stessi output.

  stato card = {stability, difficulty, due, reps, lapses, last_review}
  gradi      = again | hard | good | easy (anche 0..3)

TutorSession (loop conversazionale F04)
  step(question, answer) ->
    1. run_ai_function('F04', {front, back, risp}) con llm_fn iniettabile;
    2. giudizio (corretto | parziale | errato) + followup;
       se parziale/errato il followup parte con 'perché';
    3. aggiorna la scheda FSRS con il grade mappato dal giudizio;
    4. propone la prossima card per scheduling (due minore, esclusa la corrente).

  FALLBACK DETERMINISTICO (llm_fn=None o AI non disponibile): confronto
  normalizzato answer vs back per sovrapposizione di token
      >= 0.60 -> corretto | >= 0.25 -> parziale | altrimenti errato
  -> il tutor FUNZIONA ANCHE SENZA AI (giudizi deterministici).
"""

from __future__ import annotations

import math
import re
import time as _time
from typing import Any, Dict, List, Optional, Tuple

from .ai_runtime import run_ai_function

__all__ = ["FSRS", "TutorSession"]

_TOKENS_RE = re.compile(r"\w+", re.UNICODE)

JUDGMENTS = ("corretto", "parziale", "errato")
GRADE_FOR_JUDGMENT = {"corretto": "good", "parziale": "hard", "errato": "again"}
MIN_CORRETTO = 0.60     # sovrapposizione token >= 0.60 -> corretto
MIN_PARZIALE = 0.25     # sovrapposizione token >= 0.25 -> parziale


# ======================================================================
# FSRS — semplificazione FSRS-4.5 (w fissi di default)
# ======================================================================
class FSRS:
    """Spaced repetition FSRS-4.5 semplificata, pura e deterministica."""

    # Pesi fissi di default (17, famiglia FSRS-4.5): nessuna ottimizzazione.
    W: Tuple[float, ...] = (
        0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975,
        0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246,
        1.587, 0.2272, 2.8755,
    )
    GRADES: Tuple[str, ...] = ("again", "hard", "good", "easy")
    _DECAY = -0.5
    _FACTOR = 19.0 / 81.0
    _SECONDS_PER_DAY = 86400.0

    # ---------------------------------------------------------- normalizza
    def _now(self, now: Optional[float]) -> float:
        return float(_time.time() if now is None else now)

    @classmethod
    def _grade_index(cls, grade: Any) -> int:
        """again/hard/good/easy (o 0..3, anche stringhe '0'..'3') -> 0..3."""
        if isinstance(grade, bool):
            raise ValueError("grado sconosciuto: %r" % (grade,))
        if isinstance(grade, int):
            g = int(grade)
        else:
            g_s = str(grade).strip().lower()
            if g_s in cls.GRADES:
                return cls.GRADES.index(g_s)
            if g_s in ("0", "1", "2", "3"):
                g = int(g_s)
            else:
                raise ValueError("grado sconosciuto: %r" % (grade,))
        if 0 <= g <= 3:
            return g
        raise ValueError("grado sconosciuto: %r" % (grade,))

    @classmethod
    def _init_difficulty(cls, g: int) -> float:
        # semplificazione: D0 decrescente nel grado (again=7 .. easy=2.5)
        return float(min(10.0, max(1.0, 7.0 - 1.5 * g)))

    @classmethod
    def _retrievability(cls, elapsed_days: float, stability: float) -> float:
        # R = (1 + FACTOR * t / S) ^ DECAY   (curva di dimenticanza FSRS)
        s = max(float(stability), 0.05)
        t = max(0.0, float(elapsed_days))
        try:
            return float((1.0 + cls._FACTOR * t / s) ** cls._DECAY)
        except Exception:
            return 1.0

    # ---------------------------------------------------------- API
    def init_card(self, now: Optional[float] = None) -> Dict[str, Any]:
        """Card nuova: dovuta subito, stabilità iniziale 'good' (w[2])."""
        t = self._now(now)
        return {
            "stability": float(self.W[2]),
            "difficulty": 5.0,
            "due": float(t),
            "reps": 0,
            "lapses": 0,
            "last_review": None,
        }

    def review(self, card: Dict[str, Any], grade: Any,
               now: Optional[float] = None) -> Dict[str, Any]:
        """Applica una recensione e ritorna il NUOVO stato (input invariato).

        again -> la stabilità 'resetta' (cala sempre), lapses += 1
        hard/good/easy -> la stabilità cresce (crescita maggiore se il
        retrievability è sceso abbastanza), difficoltà aggiornata, due = now
        + stability giorni.
        """
        g = self._grade_index(grade)
        t = self._now(now)

        S = float(card.get("stability") or 0.0)
        D = float(card.get("difficulty") or 5.0)
        reps = int(card.get("reps") or 0)
        lapses = int(card.get("lapses") or 0)
        last = card.get("last_review")

        if last is None:
            # prima recensione: stabilità iniziale per grado (w0..w3)
            S_new = float(self.W[g])
            D_new = self._init_difficulty(g)
            if g == 0:
                lapses += 1
        else:
            elapsed_days = max(0.0, (t - float(last)) / self._SECONDS_PER_DAY)
            R = self._retrievability(elapsed_days, S)
            if g == 0:
                # LAPSE (semplificazione FSRS-4.5):
                # S' = w11 * D^-w12 * ((S+1)^w13 - 1) * e^(w14*(1-R))
                lapses += 1
                S_new = (
                    self.W[11]
                    * (max(D, 0.1) ** -self.W[12])
                    * (((S + 1.0) ** self.W[13]) - 1.0)
                    * math.exp(self.W[14] * (1.0 - R))
                )
                S_new = float(max(0.1, min(S_new, S)))   # dopo un forget MAI crescere
                D_new = float(min(10.0, D + 1.0))
            else:
                # SUCCESS (semplificazione FSRS-4.5):
                # S' = S * (1 + e^w8 * (11-D) * S^-w9 * (e^(w10*(1-R))-1)
                #      * penalty_hard * bonus_easy)
                hard_penalty = 0.8 if g == 1 else 1.0
                easy_bonus = 1.25 if g == 3 else 1.0
                growth = (
                    math.exp(self.W[8])
                    * (11.0 - D)
                    * (max(S, 0.05) ** -self.W[9])
                    * (math.exp(self.W[10] * (1.0 - R)) - 1.0)
                    * hard_penalty * easy_bonus
                )
                S_new = float(S * (1.0 + max(0.0, growth)))
                # difficoltà: d = -w6 * (G-3) con G = g+1 (hard +, easy -)
                delta = -self.W[6] * ((g + 1) - 3)
                D_new = float(min(10.0, max(1.0, D + delta * (10.0 - D) / 9.0)))

        reps += 1
        return {
            "stability": float(S_new),
            "difficulty": float(D_new),
            "due": float(t + S_new * self._SECONDS_PER_DAY),
            "reps": int(reps),
            "lapses": int(lapses),
            "last_review": float(t),
        }


# ======================================================================
# TutorSession — loop conversazionale F04
# ======================================================================
def _tokens(text: Any) -> List[str]:
    return _TOKENS_RE.findall(str(text or "").lower())


def token_overlap(answer: Any, back: Any) -> Optional[float]:
    """Copertura del back coperta dalla risposta: |back ∩ answer| / |back|.
    back vuoto -> None (confronto non disponibile)."""
    bt = _tokens(back)
    if not bt:
        return None
    aset = set(_tokens(answer))
    hit = sum(1 for tok in bt if tok in aset)
    return hit / float(len(bt))


class TutorSession:
    """Sessione tutor: giudica con F04 (AI se disponibile) e pianifica con FSRS."""

    def __init__(self, cards: Optional[List[Dict[str, Any]]] = None, *,
                 llm_fn: Any = None, ai_cache: Any = None,
                 embed_fn: Any = None) -> None:
        self.fsrs = FSRS()
        self.llm_fn = llm_fn            # None -> fallback deterministico
        self.ai_cache = ai_cache        # None -> cache singleton runtime
        self.embed_fn = embed_fn
        self.cards: List[Dict[str, Any]] = []
        for c in cards or []:
            self.add_card(str((c or {}).get("front", "")),
                          str((c or {}).get("back", "")))
        self.history: List[Dict[str, Any]] = []
        self.current_id: Optional[str] = self.cards[0]["id"] if self.cards else None

    # ---------------------------------------------------------- deck
    def add_card(self, front: str, back: str) -> Dict[str, Any]:
        card = {
            "id": "c%03d" % (len(self.cards) + 1),
            "front": str(front),
            "back": str(back),
            "state": self.fsrs.init_card(),
        }
        self.cards.append(card)
        return card

    def _card_for(self, question: str, back: Optional[str] = None) -> Dict[str, Any]:
        q = str(question)
        for c in self.cards:
            if c["front"] == q:
                if back and not c["back"]:
                    c["back"] = str(back)   # back arrivato dopo il front
                return c
        # domanda sconosciuta: card nuova (back opzionale dal caller)
        return self.add_card(q, str(back or ""))

    def _next_card(self, exclude_id: Optional[str]) -> Optional[Dict[str, Any]]:
        pool = [c for c in self.cards if c["id"] != exclude_id]
        if not pool:
            pool = list(self.cards)
        if not pool:
            return None
        return min(pool, key=lambda c: float(c["state"].get("due") or 0.0))

    # ---------------------------------------------------------- giudizi
    @staticmethod
    def _followup() -> str:
        return "perché manca almeno parte della risposta attesa: da dove ripartiresti?"

    @staticmethod
    def _fallback_judgment(back: str, answer: str) -> Tuple[str, str, str]:
        """Giudizio DETERMINISTICO senza AI (token-overlap)."""
        ov = token_overlap(answer, back)
        if ov is None:
            return (
                "parziale",
                "confronto non disponibile: manca la risposta attesa per questa card.",
                "perché riprovi a spiegare la risposta con parole tue?",
            )
        pct = round(ov * 100.0)
        if ov >= MIN_CORRETTO:
            return (
                "corretto",
                "risposta completa: sovrapposizione %d%% con la risposta attesa." % pct,
                "",
            )
        if ov >= MIN_PARZIALE:
            return (
                "parziale",
                "risposta parziale: sovrapposizione %d%% con la risposta attesa." % pct,
                TutorSession._followup(),
            )
        return (
            "errato",
            "risposta errata: sovrapposizione %d%% con la risposta attesa." % pct,
            TutorSession._followup(),
        )

    @staticmethod
    def _from_ai(data: Any) -> Optional[Tuple[str, str, str]]:
        """Estrae (judgment, feedback, followup) da un output AI valido."""
        if not isinstance(data, dict):
            return None
        j = str(data.get("judgment") or "").strip().lower()
        if j not in JUDGMENTS:
            return None
        fb = str(data.get("feedback") or "").strip()
        fu = str(data.get("followup") or "").strip()
        if not fb:
            fb = "giudizio del tutor."
        if j == "corretto":
            fu = ""          # normalizza: followup solo se non corretto
        elif not fu.lower().startswith("perché"):
            fu = "perché riprovi a rispondere partendo dalla definizione?"
        return j, fb, fu

    # ---------------------------------------------------------- step
    def step(self, question: str, answer: str, *,
             back: Optional[str] = None) -> Dict[str, Any]:
        """Un passo del loop: giudica `answer`, aggiorna FSRS, propone la
        prossima card. MAI eccezioni: con llm_fn=None il giudizio è
        deterministico (token-overlap) e la sessione funziona comunque."""
        card = self._card_for(question, back)
        self.current_id = card["id"]
        card_back = card["back"]

        try:
            res = run_ai_function(
                "F04",
                {"front": card["front"], "back": card_back, "risp": answer},
                ai_cache=self.ai_cache,
                embed_fn=self.embed_fn,
                llm_fn=self.llm_fn,
            )
        except Exception:
            res = {"ok": False, "fallback": True, "data": None,
                   "source": "fallback", "badge": "AI non disponibile"}

        judged = None
        if isinstance(res, dict) and res.get("ok"):
            judged = self._from_ai(res.get("data"))
        source = (res or {}).get("source") or "fallback"
        badge = (res or {}).get("badge") or "AI non disponibile"

        if judged is None:
            # percorso deterministico (AI assente / output non utilizzabile)
            judgment, feedback, followup = self._fallback_judgment(card_back, answer)
            if source != "fallback" and (res or {}).get("ok"):
                source = "fallback"
            badge = "AI non disponibile" if not (res or {}).get("ok") else badge
        else:
            judgment, feedback, followup = judged

        # aggiorna FSRS con il grade mappato dal giudizio
        grade = GRADE_FOR_JUDGMENT[judgment]
        try:
            card["state"] = self.fsrs.review(card["state"], grade)
        except Exception:
            pass  # stato invariato se la recensione non è applicabile

        nxt = self._next_card(exclude_id=card["id"])
        out = {
            "ok": True,
            "judgment": judgment,
            "feedback": feedback,
            "followup": followup,
            "grade": grade,
            "card_id": card["id"],
            "card_state": dict(card["state"]),
            "next_question": nxt["front"] if nxt else None,
            "next_card_id": nxt["id"] if nxt else None,
            "source": source,
            "badge": badge,
            "approval_required": bool((res or {}).get("approval_required", False)),
        }
        self.history.append({
            "card_id": card["id"],
            "question": card["front"],
            "judgment": judgment,
            "grade": grade,
        })
        return out

    # ---------------------------------------------------------- stato
    def state(self) -> Dict[str, Any]:
        """Stato completo della sessione: JSON-serializzabile (per API)."""
        return {
            "cards": [
                {
                    "id": c["id"],
                    "front": c["front"],
                    "back": c["back"],
                    "state": {
                        "stability": float(c["state"]["stability"]),
                        "difficulty": float(c["state"]["difficulty"]),
                        "due": float(c["state"]["due"]),
                        "reps": int(c["state"]["reps"]),
                        "lapses": int(c["state"]["lapses"]),
                        "last_review": c["state"].get("last_review"),
                    },
                }
                for c in self.cards
            ],
            "current_id": self.current_id,
            "n_reviews": len(self.history),
        }
