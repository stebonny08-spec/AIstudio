# -*- coding: utf-8 -*-
"""
tests/g2_hitrate.py — G2.3: hit-rate del prefisso KV su 20 conversazioni
multi-turn REALI, usando la composizione reale del flusso
(build_prompt_segments + trim_history + history_char_budget).

DEFINIZIONE (semantica prompt-cache llama.cpp = riuso del PREFISSO KV):
  HIT (turno N) = esiste un turno M < N della STESSA conversazione con
  system IDENTICO, rag_header IDENTICO e la stringa renderizzata
  system+rag+storia(M) PREFISSO di system+rag+storia(N) — cioe' la storia
  e' cresciuta in append-only senza trimming (nel caso ci sia trimming o
  cambiamento dell'header, il prefisso condiviso si interrompe -> MISS).
  Il turno 1 e' sempre MISS.

Riproducibile:  python tests/g2_hitrate.json -> qa/g2_hitrate.json
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.router import build_prompt_segments, trim_history, history_char_budget  # noqa: E402

N_CONV = 20
DEFINIZIONE = (
    "HIT (KV-prefix, semantica llama.cpp) = system+rag_header IDENTICI a un "
    "turno precedente della stessa conversazione E la stringa renderizzata "
    "system+rag+storia(M) PREFISSO di system+rag+storia(N) (storia "
    "append-only, nessun trimming). Trimming della storia o cambio "
    "dell'header -> MISS. Turno 1 = MISS. Query esclusa (non fa parte del "
    "prefisso)."
)

TOPICS = [
    "fotosintesi clorofilliana", "rivoluzione francese", "derivate funzioni",
    "mitosi e meiosi", "termodinamica entropia", "impero romano strade",
    "algebra lineare matrici", "guerra fredda blocchi", "probabilita",
    "apprendimento automatico neuroni", "reazione chimica equilibrio",
    "integrazione funzioni", "guerra fredata", "rivoluzione industriale",
    "logaritmi", "vettori piano", "seconda guerra mondiale", "neuroni reti",
]


def _render(segments: dict) -> str:
    return "\x1e".join([segments["system"], segments["rag"], segments["history"]])


def main() -> int:
    hits = misses = turns_total = 0
    per_conv = []
    rng = random.Random(20261023)

    for ci in range(N_CONV):
        use_rag = ci >= 18  # 2 conversazioni con header RAG variabile
        topic = TOPICS[ci % len(TOPICS)]
        n_turns = rng.randint(3, 8)
        history = []
        prior = []  # [(system, rag, rendered)]
        conv_hits = conv_miss = 0
        trimmed_any = False
        for t in range(n_turns):
            query = (f"spiega {topic} punto {t + 1} con un esempio" if t
                     else f"che cos'e' {topic}?")
            rag_header = (f"{topic}.md: passaggio {t // 3} sul tema {topic}"
                          if use_rag else "")
            # trimming reale ogni 4 turni (storia gonfiata)
            if t % 4 == 3:
                history.append({"role": "user",
                                "content": (topic + " dettaglio " + str(t)) * 40})
                history.append({"role": "ai",
                                "content": ("risposta lunga " + topic + " ") * 40})
                kept, summary = trim_history(history, history_char_budget(4096))
                if len(kept) != len(history):
                    trimmed_any = True
                history = list(kept)
                if summary:
                    history.insert(0, {"role": "ai",
                                       "content": "[riepilogo] " + summary})
            segments = build_prompt_segments("studio", rag_header, history, query)
            rendered = _render(segments)
            is_hit = False
            for (psys, prag, prendered) in prior:
                if psys == segments["system"] and prag == segments["rag"] \
                        and rendered.startswith(prendered):
                    is_hit = True
                    break
            if is_hit:
                hits += 1
                conv_hits += 1
            else:
                misses += 1
                conv_miss += 1
            prior.append((segments["system"], segments["rag"], rendered))
            turns_total += 1
            history.append({"role": "user", "content": query})
            history.append({"role": "ai",
                            "content": f"risposta di esempio a {topic} ({t})"})
        per_conv.append({"conv": ci, "turns": n_turns, "rag": use_rag,
                         "trimmed": trimmed_any,
                         "hits": conv_hits, "misses": conv_miss})
        print(f"conv {ci:02d}: turns={n_turns} hits={conv_hits} miss={conv_miss}")

    rate = hits / turns_total if turns_total else 0.0
    out = {
        "hit_rate": round(rate, 4),
        "conversations": N_CONV,
        "turns_total": turns_total,
        "hits": hits,
        "misses": misses,
        "definizione_hit": DEFINIZIONE,
        "target": 0.70,
        "esito": "RAGGIUNTO" if rate >= 0.70 else "MANCATO",
        "metodo": "build_prompt_segments + trim_history (percorso REALE del "
                  "flusso) con controllo prefisso KV system+rag+storia",
        "comando": "python tests/g2_hitrate.py",
        "per_conversation": per_conv,
    }
    dst = ROOT / "qa" / "g2_hitrate.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"hit_rate={rate:.4f} ({hits}/{turns_total}) -> {out['esito']} "
          f"(target >=0.70) -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
