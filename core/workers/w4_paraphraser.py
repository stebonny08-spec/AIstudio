"""W4 - paraphraser (worker offline H12).

Riformula il front (o il testo) con direttiva SYS paraph_v1-equivalente
inclusa nel prompt, poi VALIDA la riformulazione con embedding:

- cos(embed(parafasi), embed(originale)) >= 0,85 -> validation='accepted'
- cos < 0,85                    -> validation='rejected'
- embed_fn assente (o errore)   -> validation='skipped' e si accetta comunque

- LLM: llm_fn iniettabile, profilo 'fast', classe 'micro'.
- Embedding: embed_fn iniettabile (in produzione l'embedder RAG).
- Output: dict {id: {paraphrase, validation, accepted, cosine, approved}}.
"""

from __future__ import annotations

from .base import BaseWorker, cosine

__all__ = ["W4Paraphraser"]


class W4Paraphraser(BaseWorker):
    """W4: riformula + validazione simile >= 0,85 via embed_fn."""

    id = "w4"
    batch_size = 8
    THRESHOLD = 0.85

    # Equivalente del system prompt paraph_v1
    SYS_PARAPHR = (
        "SYSTEM paraph_v1: riformula il testo sottostante mantenendo identico "
        "il significato, la stessa lingua e una lunghezza simile (+-10%). "
        "Non aggiungere, non omettere, non tradurre, non commentare. "
        "Rispondi SOLO con il testo riformulato."
    )

    def run(self, batch, ctx=None):
        out = {}
        for item in batch:
            key = self.item_key(item)
            if isinstance(item, dict):
                text = str(item.get("front") or item.get("text") or "")
                if not text:
                    text = self.item_text(item)
            else:
                text = self.item_text(item)

            prompt = "%s\n\nTesto:\n%s" % (self.SYS_PARAPHR, text)
            paraphrase = self.llm(prompt).strip()

            if self.embed_fn is None:
                validation = "skipped"
                accepted = True
                cos = None
            else:
                v_orig = self.embed(text)
                v_para = self.embed(paraphrase)
                if v_orig is None or v_para is None:
                    validation = "skipped"
                    accepted = True
                    cos = None
                else:
                    cos = round(cosine(v_orig, v_para), 4)
                    accepted = cos >= self.THRESHOLD
                    validation = "accepted" if accepted else "rejected"

            out[key] = {
                "id": key,
                "paraphrase": paraphrase,
                "validation": validation,
                "accepted": bool(accepted),
                "cosine": cos,
                "approved": False,
            }
            self.mark(key, out[key])
            self.stats["items"] += 1
            self.advance(1)
        return out
