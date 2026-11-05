"""W2 - section_summarizer (worker offline H12).

USO INTERNO RAG - MAI ESPOSTO COME FEATURE UTENTE.

Questo worker genera riassunti di sezione che alimentano SOLO il retrieval
e la navigazione interna del RAG. I riassunti non vengono registrati come
funzioni utente, non hanno flag/funzioni di esposizione e questo modulo non
importa alcun sistema di registrazione funzioni: e' un passo della pipeline
offline, non un'API.

- LLM: llm_fn iniettabile, profilo 'fast', classe 'micro'.
- Attiva su documenti con piu' di N sezioni (default N=4 sezioni dal chunker).
- Prompt: contiene il testo del chunk/sezione affinche' il riassunto sia fedele.
- Output: dict {section: summary}, ogni summary <= 800 chars.
"""

from __future__ import annotations

import inspect

from .base import BaseWorker

__all__ = ["W2SectionSummarizer"]


def _supports_draft(fn) -> bool:
    """True se llm_fn accetta il kwarg opzionale draft (R13 S3)."""
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return False
    if any(p.kind == inspect.Parameter.VAR_KEYWORD
           for p in sig.parameters.values()):
        return True
    return "draft" in sig.parameters


class W2SectionSummarizer(BaseWorker):
    """W2: per doc con piu' di `min_sections` sezioni -> {section: summary}."""

    id = "w2"
    batch_size = 4
    min_sections = 4      # soglia N: solo doc con > 4 sezioni
    MAX_SUMMARY = 800
    # R13 S3: W2 e' long-form -> vuole il draft speculativo quando il
    # llm_fn lo supporta. Backward-compat: senza kwarg draft nel llm_fn
    # (stub di default o signature vecchia) si segue la strada standard.
    DRAFT_LONGFORM = True

    PROMPT = (
        "Riassumi la seguente sezione in massimo {max} caratteri, in italiano, "
        "mantenendo i concetti chiave. Rispondi SOLO col riassunto.\n\n{testo}"
    )

    def llm(self, prompt, fallback=""):
        """Come BaseWorker.llm ma con draft=True se supportato (R13 S3).

        Firma backward-compat: con llm_fn senza kwarg draft il
        comportamento e' IDENTICO a prima (decorso 100% via base.llm).
        """
        if not self.DRAFT_LONGFORM or not _supports_draft(self.llm_fn):
            return super().llm(prompt, fallback=fallback)
        original = self.llm_fn

        def _wrapped(p, profile="fast", classe="micro", **kw):
            return original(p, profile=profile, classe=classe, draft=True)

        self.llm_fn = _wrapped
        try:
            return super().llm(prompt, fallback=fallback)
        finally:
            self.llm_fn = original

    def run(self, batch, ctx=None):
        out = {}
        for doc in batch:
            if isinstance(doc, dict):
                sections = list(doc.get("sections") or [])
                doc_id = str(doc.get("doc_id") or doc.get("id")
                             or self.item_key(doc))
            else:
                sections = list(getattr(doc, "sections", None) or [])
                doc_id = str(self.item_key(doc))

            # Solo documenti con piu' di N sezioni (uso interno RAG)
            if len(sections) <= self.min_sections:
                continue

            doc_out = {}
            for idx, sec in enumerate(sections):
                if isinstance(sec, dict):
                    sec_label = str(sec.get("id") or sec.get("title") or idx)
                    text = self.item_text(sec)
                else:
                    sec_label = str(idx)
                    text = str(sec)
                label = "%s#%s" % (doc_id, sec_label)

                prompt = self.PROMPT.format(max=self.MAX_SUMMARY, testo=text)
                summary = self.llm(prompt).strip()
                if len(summary) > self.MAX_SUMMARY:
                    summary = summary[: self.MAX_SUMMARY - 3].rstrip() + "..."

                doc_out[label] = summary
                self.stats["items"] += 1

            out.update(doc_out)
            # checkpoint a livello di documento (unita' di progresso = doc)
            self.mark(self.item_key(doc), doc_out)
            self.advance(1)
        return out
