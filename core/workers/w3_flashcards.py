"""W3 - flashcard_pregenerator (worker offline H12).

USO INTERNO: genera flashcard come SUGGERIMENTI pre-compilati per la sezione
materiale. Le card prodotte hanno SEMPRE suggested=True e approved=False:
vengono mostrate all'utente per approvazione e MAI salvate direttamente.

- Registry F02: usato SOLO se importabile (core/registry e' in costruzione;
  l'import e' difensivo). Altrimenti fallback con prompt template proprio
  identico alla spec F02 (n=5 card: front/back, solo JSON).
- LLM: llm_fn iniettabile, profilo 'fast', classe 'micro'.
- Output: dict {section_id: [card x5]} con card = {front, back,
  suggested: True, approved: False}.
"""

from __future__ import annotations

import json
import re

from .base import BaseWorker

__all__ = ["W3FlashcardPregenerator"]

# --- Registry F02 (SOLO se importabile; core/registry in costruzione) -----
_F02 = None
try:
    from core.registry import functions as _reg_functions  # noqa: F401
    for _nome in ("generate_flashcards", "f02_generate_flashcards",
                  "f02", "F02"):
        _cand = getattr(_reg_functions, _nome, None)
        if _cand is not None and callable(_cand):
            _F02 = _cand
            break
except Exception:
    _F02 = None


# Prompt fallback IDENTICO alla spec F02: n=5, front/back, solo JSON.
PROMPT_F02 = (
    "Sei un tutor. Genera esattamente 5 flashcard sul seguente materiale, "
    "ciascuna con 'front' (domanda breve) e 'back' (risposta concisa). "
    "Restituisci SOLO un JSON array di 5 oggetti "
    '[{{"front": "...", "back": "..."}}] senza altro testo.\n\n'
    "Materiale:\n{testo}"
)


def _normalize_card(obj):
    if isinstance(obj, dict):
        front = (obj.get("front") or obj.get("q") or obj.get("question")
                 or obj.get("domanda") or "")
        back = (obj.get("back") or obj.get("a") or obj.get("answer")
                or obj.get("risposta") or "")
    elif isinstance(obj, str):
        parts = re.split(r"\s*[|\t]\s*", obj, maxsplit=1)
        front = parts[0]
        back = parts[1] if len(parts) > 1 else ""
    else:
        return None
    front = str(front).strip()
    back = str(back).strip()
    if not front and not back:
        return None
    return {"front": front, "back": back}


def _parse_cards(raw, n=5):
    """Estrae una lista di {front, back} da output LLM (JSON, linee, ...)."""
    cards = []
    if isinstance(raw, (list, tuple)):
        candidates = list(raw)
        s = ""
    else:
        s = (raw or "").strip()
        s = s.replace("```", "").strip()
        lines = s.splitlines()
        if lines and lines[0].strip().lower() in ("json", "jsonc"):
            s = "\n".join(lines[1:]).strip()
        candidates = None
        try:
            data = json.loads(s)
            if isinstance(data, list):
                candidates = data
            elif isinstance(data, dict) and isinstance(data.get("cards"), list):
                candidates = data["cards"]
            elif isinstance(data, dict):
                candidates = [data]
        except ValueError:
            candidates = None
        if candidates is None:
            # linee numerate: "1. front | back"
            found = re.findall(r"^\s*\d+[.)]\s+(.+)$", s, flags=re.M)
            if found:
                candidates = found
    if candidates:
        for obj in candidates:
            card = _normalize_card(obj)
            if card is not None:
                cards.append(card)
    return cards[:n]


def _pad_cards(cards, text, n=5):
    """Garantisce esattamente n card (padding deterministico dal materiale)."""
    cards = [c for c in (cards or []) if c][:n]
    sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+", text or "")
             if x.strip()]
    idx = 0
    while len(cards) < n:
        if sents:
            back = sents[idx % len(sents)]
        else:
            back = (text or "materiale di studio")[:120]
        cards.append({
            "front": "Flashcard %d di ripasso" % (len(cards) + 1),
            "back": back[:200],
        })
        idx += 1
    return cards


class W3FlashcardPregenerator(BaseWorker):
    """W3: per sezione materiale -> 5 card SUGGERITE (approved=False)."""

    id = "w3"
    batch_size = 4
    N_CARDS = 5

    def _registry_cards(self, text):
        """Tenta F02 dal registry (solo se importabile). Nessuna eccezione."""
        if _F02 is None:
            return None
        attempts = (
            lambda: _F02(text, n=self.N_CARDS),
            lambda: _F02(text, self.N_CARDS),
            lambda: _F02(text),
            lambda: _F02(text=text, n=self.N_CARDS),
        )
        for attempt in attempts:
            try:
                return attempt()
            except TypeError:
                continue
            except Exception:
                return None
        return None

    def run(self, batch, ctx=None):
        out = {}
        for item in batch:
            key = self.item_key(item)
            text = self.item_text(item)

            cards = None
            if _F02 is not None:
                cards = self._registry_cards(text)
                if cards:
                    parsed = _parse_cards(cards, self.N_CARDS)
                    cards = parsed or None
            if not cards:
                prompt = PROMPT_F02.format(testo=text)
                raw = self.llm(prompt)
                cards = _parse_cards(raw, self.N_CARDS)
            cards = _pad_cards(cards, text, self.N_CARDS)

            final = []
            for card in cards:
                final.append({
                    "front": card.get("front", ""),
                    "back": card.get("back", ""),
                    "suggested": True,
                    "approved": False,   # MAI salvate direttamente
                })

            out[key] = final
            self.mark(key, final)
            self.stats["items"] += 1
            self.advance(1)
        return out
