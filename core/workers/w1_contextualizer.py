"""W1 - contextualizer (worker offline H12).

Per ogni chunk genera un prefisso contestuale di 1-2 frasi (documento,
sezione, argomento) da anteporre al chunk per migliorare il retrieval RAG
interno. Worker a priorita' minima (prio 2): nessun thread proprio, il
runner lo sottopone alla CodaPriorita.

- LLM: llm_fn iniettabile, profilo 'fast', classe 'micro'.
- Batch: 16 chunk per job.
- Output: dict {chunk_id: prefix}.
- Validazione: prefisso <= 300 chars (truncation) + lingua testo (stessa
  lingua del chunk, rilevata con stopword).
"""

from __future__ import annotations

from .base import BaseWorker, detect_lang

__all__ = ["W1Contextualizer"]


class W1Contextualizer(BaseWorker):
    """W1: per chunk -> prefisso contestuale (dict {chunk_id: prefix})."""

    id = "w1"
    batch_size = 16
    PREFIX_MAX = 300

    PROMPT = ("In 1-2 frasi: documento, sezione, argomento di questo chunk: {chunk}")

    def run(self, batch, ctx=None):
        out = {}
        for item in batch:
            key = self.item_key(item)
            text = self.item_text(item)
            prompt = self.PROMPT.format(chunk=text)
            prefix = self.llm(prompt).strip()

            truncated = False
            if len(prefix) > self.PREFIX_MAX:
                prefix = prefix[: self.PREFIX_MAX - 3].rstrip() + "..."
                truncated = True

            lang_text = detect_lang(text)
            lang_prefix = detect_lang(prefix)
            lang_ok = (
                lang_prefix == "unk"
                or lang_text == "unk"
                or lang_prefix == lang_text
            )
            self.validation_report[key] = {
                "len": len(prefix),
                "len_ok": len(prefix) <= self.PREFIX_MAX,
                "truncated": truncated,
                "lang_text": lang_text,
                "lang_prefix": lang_prefix,
                "lang_ok": lang_ok,
                "ok": len(prefix) <= self.PREFIX_MAX and lang_ok,
            }

            out[key] = prefix
            self.mark(key, prefix)
            self.stats["items"] += 1
            self.advance(1)
        return out

    def fallback(self, batch, ctx=None):
        out = {}
        for item in batch:
            out[self.item_key(item)] = ""
        return out
