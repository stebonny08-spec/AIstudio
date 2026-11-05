# QA Report — Round 16: QA-1 matrice 20 query + QA-2 gate + QA-3 regressioni

**Stato: COMPLETATO con 1 sub-SLO BLOCKED (dichiarato)** — script rerunnable: `qa/r16_qa1.py`, `qa/r16_qa2.py`.

## QA-1 (3 tentativi; PRIMA `r16_qa1_prima.json`, t2 `r16_qa1_attempt2.json`, DOPO `r16_qa1.json`)

| Gruppo | n | assert core | primo token p95 | totale p95 | note |
|---|---|---|---|---|---|
| (i) locale | 10 | **10/10** | ~6,1 s | 19.138 ms | 1 LLM/query (mediana), badge fonti appunti, guard PASS |
| (ii) solo-web | 5 | **5/5** | ~13,0 s | 19.099 ms | tutte ≥1 url in allowlist; "chi è dante alighieri" → 5 url, risposta web citata |
| (iii) rete giù (`R16_WEB_DOWN=1`) | 5 | **5/5** | 0,061 s | 61,7 ms | esito (c) informativo, **0 LLM, 0 chiamate di rete** |
| **TOTALE** | **20** | **20/20** | **11.768 ms (MANCATO ≤2 s)** | **19.102 ms (≤20 s ✅)** | guard fail 0 · len fail 0 · blocchi duplicati 0 · net-leak 0 · allowlist fail 0 · UNA emission block per query |

Fix dai dati: t1 = budget non passato al proxy (`_iter_gen`) + totali 28-57 s; t2 = batch ddgs lento 7,1 s + riserva wiki + prebuffer adattivo. PRIMA (screenshot/F0): >30 s, nessuna risposta, leak di template.

## QA-2 (`qa/gate_round16.md` + `qa/r16_gate_raw.json`)

10 risposte revisionate: **OK 1 · PARZIALE 7 · KO 2**; marker template **0/10**; citazioni+badge stadio **10/10**. KO = contenuto (modello MiniCPM5-2B), non pipeline.

## QA-3 regressioni (tutte verdi)

- **T1 2305/0** (baseline ≥2062; JS 1876/0 su 23 suite incl. `r16_chat_ui`; PY 429/0 su 34 file incl. testR16_* = 37 test)
- **GT recall@5 = 1,000** (`r15_recall_gt` rieseguito 9/9); recall reale h8 = 1,000; **parity 1,000** (testH1 + dedupe `NIENTE_DA_FARE` rieseguito)
- TTFT client `r16_ttft_client.json`: **hit p50 82,7 ms / miss p50 465,5 ms** (target 1500/2500 ms; `g4_ttft.json` storico intatto per testG8)
- **hit-rate 0,7767 ≥0,70** (rieseguito); **KV +0,0 MB ≤50**; load 2,26 s ≤3,0; tok/s 10,78/11,19/12,56; gate 58/60 invariato (riconteggio)
- `qa/metrics_history.json` **round16** (`qa/_add_round16.py`, solo file reali + method per metrica); **testG7 12/12 · testG8 8/8** (R15b → costanti storiche, nuovo `test_h_round16`)
- BUILD `QA_TS = 2026-10-25T15:05:00+01:00` == entry round16 (bump 10 occorrenze)

## BLOCKED dichiarati
1. **Sub-SLO "primo token ≤2 s p95"**: p95 misurato **11.768 ms**. Causa fisica: fetch web 1,1-3,3 s + prompt-eval variabile 1,3-6 s (MiniCPM5-2B ~100-200 tok/s) + prebuffer guard. Mitigazioni applicate (thinking-off −13 s, prebuffer 48→12/24 char, fonti 3×220, riuso parziale prefix cache verificato prompt_n=14). Analisi/procedura: NOTE.md "Round 16".
2. **Corpus libri vuoto** (parity/recall libri): BLOCKED R13 invariato (procedura manuale).
