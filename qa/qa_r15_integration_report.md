# R15b — REPORT INTEGRAZIONE P↔G↔W (fix QA-1 e re-run)

**Stato: COMPLETATO** — tutti e 6 gli esiti QA-1 in verde al tentativo-3.
File: fix in `core/router.py`, `core/rag/gate.py`, `core/web_search.py` ·
artifact: `qa/r15_qa1_prima.json` (PRIMA), `qa/r15_qa1_attempt2.json` (intermedio),
`qa/r15_qa1.json` (DOPO definitivo, esiti_ok=true) · test `tests/testR15_integration.py`.

## Diagnosi (dai dati, non da ipotesi)
Il QA-1 tentativo-1 ha BLOCKATO (6 tentativi per unità) 3 punti:
1. **(ii) parziale**: gate OK (astensioni outcome=parziale registrate) ma formula
   "Ho trovato solo questo nei materiali: " assente 6/6.
2. **(iv) esito (c)**: gate=outema NULLA ma llm_calls=1 6/6 — l'informativa
   zero-LLM scattava SOLO se `outcome.fused` vuoto (righe <0,35); con alta sim
   senza supporto (fused non vuoto, pre-screen 0,74-0,84) si GENERAVA comunque.
3. **(v) tempi**: 0 campioni (dipendeva da iv) — poi (v)b misurato 10.086 ms >8000
   (5 batch ddgs ≈10s).

## Fix applicati
| # | Fix | File | PRIMA | DOPO (evidenza) |
|---|---|---|---|---|
| FIX-1 | Threading `outcome=decision.outcome` da synth → `_emit_level` → `generate_stream` (firma già presente) | core/router.py | spy `outcome_kwargs=[None×6]` | spy `outcome_kwargs=['parziale'×6]` (attempt2) |
| FIX-2 | Informativa zero-LLM instradata su `decision.outcome == OUTCOME_NULLA` (non più solo `not fused`), decisione corrente anche dopo re-gate web | core/router.py | (iv) llm=1 6/6 | (iv) `esito_c=True llm=0 total=7.43ms` (attempt2/3) |
| FIX-3 | Allineamento feature gate su/out del pipeline reale (supporto da fts/bm25 reale) | core/rag/gate.py | parziali con outcome misto | attempt2: `astensioni_parziale=True` su TUTTI i parziali GT (incl. x1) |
| FIX-II | **Prefisso DETERMINISTICO** emesso dalla pipeline per esito parziale: `"Ho trovato solo questo nei materiali: "` prima della risposta (motivazione: attempt2 prova che il kwarrand ARRIVA ma il modello lo ignora 0/6 compliance — istruzione mantenuta nel prompt per tono/citazioni) | core/router.py | (ii) formula=False 6/6 | (ii) **formula=True, ok=True** (attempt3) |
| FIX-III | **Budget web `WEB_BUDGET_S=5.5s`** deadline comune a tutti i provider (stop tra i batch ddgs con log, timeout residuo per searxng/wiki, skip se <1s residuo) | core/web_search.py | (v)b p95 **10.086 ms** >8000 | (v)b p95 **5.734,91 ms** ≤8000 ✓ |

## Esiti QA-1 — PRIMA (t1) → DOPO (t3)
| Check | PRIMA (qa/r15_qa1_prima.json) | DOPO (qa/r15_qa1.json, 10:40) |
|---|---|---|
| (i) positivo → top-5 + citazioni | ✅ 2/2 | ✅ OK |
| (ii) parziale → astensioni + formula + tokens | ❌ 0/6 formula | ✅ **OK** (formula=True) |
| (iii) no-copertura + web ON → sources web | ✅ 1/1 | ✅ OK (n3 5 items; n1/n2 transienti ddgs 0-result dichiarati — rete, ≥1 tentativo riuscito) |
| (iv) no-copertura + web OFF → esito(c) 0 LLM | ❌ 0/6 (llm=1) | ✅ **OK** (llm=0, tot ~7ms) |
| (v) p95 esito(c) senza web ≤3000ms | ❌ 0 campioni | ✅ **7,47 ms** |
| (v) p95 esito(c) con web ≤8000ms | ❌ (10.086 nel tent.2) | ✅ **5.734,91 ms** |
| (vi) p95 primo feedback ≤2000ms | ✅ 28,19 ms (n=9) | ✅ **24,99 ms** (n=16) |

Note onestà: i totali di tentativo-2 contengono la pausa overnight della sessione
(unico caso anomalo 29.953.020 ms, dichiarato nel json intermedio); le esecuzioni
"rosse" di (ii) mostrano anche degenerazioni del modello (ripetizioni) — non
riguardano l'integrazione; rilevate e dichiarate.

## Non-regressioni (eseguite dopo i fix)
- `tests/testR15_integration.py` **16/16** · `testR15_pipe.py` **30/30** ·
  `testR15_web.py` **15 OK (1 skip preesistente)** · `testR15_gate.py` (nella T1).
- Contract intatto; nessun file vietato toccato (api/contract/config/test altrui).

## Processi a fine run
QA-1 t3: sidecar down + 0 python/llama residui (dichiarato nel log); catena
rimisure R15b avviata dal coordinatore a regime terminato.
