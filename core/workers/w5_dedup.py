"""W5 - dedup (worker offline H12).

Deduplica CROSS-MATERIALE su embedding delle coppie:

- cosine >= 0,92            -> candidate duplicate (nessuna chiamata LLM)
- 0,85 <= cosine < 0,92     -> borderline: conferma LLM micro (llm_fn)
- cosine < 0,85             -> NON duplicato

Output: lista di coppie con AZIONE PROPOSTA e approved=False (mai applicata
direttamente, resta un suggerimento per la pipeline/utente).

- LLM: llm_fn iniettabile, profilo 'fast', classe 'micro'.
- Embedding: embed_fn iniettabile (obbligatorio per le soglie; se manca la
  coppia diventa 'needs_review').
- Limite: le coppie sono calcolate solo fra item dello stesso batch
  (batch_size = 64) e solo fra materiali diversi.
"""

from __future__ import annotations

from .base import BaseWorker, cosine

__all__ = ["W5Dedup"]


def _is_yes(answer):
    s = (answer or "").strip().upper()
    if not s:
        return False
    return (s.startswith("SI") or s.startswith("SÌ") or s.startswith("YES")
            or s in {"S", "Y", "1"})


class W5Dedup(BaseWorker):
    """W5: coppie cross-materiale -> azione proposta (approved=False)."""

    id = "w5"
    batch_size = 64
    TH_CANDIDATE = 0.92
    TH_BORDERLINE = 0.85

    PROMPT_DUP = (
        "Confronta le due varianti: sono duplicati (stesso contenuto)? "
        "Rispondi SOLO con SI o NO.\n\n"
        "A ({ida}):\n{a}\n\nB ({idb}):\n{b}"
    )

    @staticmethod
    def _material_of(item):
        if isinstance(item, dict):
            return str(item.get("material_id") or item.get("material") or "")
        return ""

    def run(self, batch, ctx=None):
        entries = []
        for item in batch:
            entries.append((
                self.item_key(item),
                self._material_of(item),
                self.item_text(item),
            ))

        pairs = []
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                ka, ma, ta = entries[i]
                kb, mb, tb = entries[j]
                if ma and mb and ma == mb:
                    continue  # solo coppie cross-materiale

                va = self.embed(ta)
                vb = self.embed(tb)
                if va is None or vb is None:
                    pairs.append({
                        "a": ka, "b": kb, "cosine": None,
                        "action": "needs_review", "approved": False,
                    })
                    continue

                cos = round(cosine(va, vb), 4)
                if cos >= self.TH_CANDIDATE:
                    action = "candidate_duplicate"
                elif cos >= self.TH_BORDERLINE:
                    # borderline: conferma con il modello micro
                    answer = self.llm(self.PROMPT_DUP.format(
                        ida=ka, idb=kb, a=ta[:2000], b=tb[:2000]))
                    action = ("candidate_duplicate" if _is_yes(answer)
                              else "distinct")
                else:
                    action = "distinct"

                pairs.append({
                    "a": ka, "b": kb, "cosine": cos,
                    "action": action, "approved": False,
                })

        for k, _m, _t in entries:
            self.mark(k, "done")
            self.stats["items"] += 1
            self.advance(1)
        return pairs
