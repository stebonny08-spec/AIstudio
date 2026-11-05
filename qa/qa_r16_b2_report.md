# QA Report — Round 16, blocco B2 (IMPLEMENTER-PIPE: web ultimo layer, budget SLO, allowlist)

**Stato: COMPLETATO** (report-first; tentativi: routing=2, budget=3, allowlist=2, log/reset=1 — nessun BLOCKED).

## Scope (fix da F0: WEB-NON-USATO + TEMPO)

| Unità | Cosa | Evidenza |
|---|---|---|
| 2.1 web ultimo layer | nessun toggle UI (B4); `web_override`: ''/auto/sempre → web attivo come ULTIMO layer (solo gate parziale/nulla), 'mai' esplicito compat R15 (zero rete) | testR15_web 15/15 (mai=zero rete) |
| 2.2 routing fix | `core/router.py`: `final_nulla AND web_results → context_kind="web"` (genera dalle fonti web con citazioni url, MAI informativa con risultati utilizzabili); informativa solo se web vuoto/giù/non eseguito con `build_informativa(..., web_status=...)` | QA-1: **5/5 solo-web con ≥1 url allowlist** (PRIMA q3/q4: informativa nonostante 5 risultati) |
| 2.3 budget | retrieve time-box 1s soft (invariato); **WEB_BUDGET_S=5.0** a fasce: batch ddgs ≤2s/richiesta + cap fase trusted 2s + riserva 1,2s per Wikipedia; generazione `time_budget_s=max(3, SLO-1-elapsed)` passato via `_iter_gen` (param OPPURE **kwargs, TypeError-fallback); troncamento con nota; progress su ogni path (chitchat incluso) | SLO **p95 19.102ms ≤20.000** (QA-1 t3); PRIMA t1: totali 28-57s (budget non passato al proxy — fix misurato) |
| 2.4 allowlist | **`data/web_allowlist.txt`** (22 domini: seed trusted_sources + it/en.wikipedia.org), loader con cache mtime, `_in_allowlist` suffix-match, post-filtro nel funnel unico `_extend` (TUTTI i provider) + log "fuori allowlist - scartato" | 0 url fuori lista su 20 casi (assertato); es. bing/gauthmath/youtube scartati nei log |
| 2.5 rete giù | `R16_WEB_DOWN=1` → web stage `[]` subito, **0 chiamate** | QA-1 gruppo iii: net=0 su 5/5 + informativa onesta |
| 2.6/2.7 reset+log | `_iter_gen` → evento `{"type":"reset"}` (RESET_TOKEN); `contract.log_risposta` per ogni query (cache_hit/chitchat/informativa/generazione) con stadi/score/tempi/esito/len/marker_check | testR16_pipe; `%APPDATA%/risposte.jsonl` scritto durante i QA |
| 2.8 PARTIAL_PREFIX | "Dai tuoi materiali emerge solo questo: " (contract) + istruzione B1 allineata (doppio prefisso del t1 eliminato) | testR16_pipe |

## Verifiche (conteggi)
testR16_pipe **14/14**; testR15_pipe **30/30**, testR15_web **15/15**, testR15_integration **16/16** (1 assertion aggiornato alla policy R16 3.1c, dichiarato), testR15_gate **23/23**, testH8 **20/20**; T1 **2305/0**.

## File toccati (owner)
`core/router.py`, `core/web_search.py`, `data/web_allowlist.txt` (nuovo), `tests/testR16_pipe.py` (nuovo). `core/rag/web_stage.py` non toccato.

## Limiti / BLOCKED
- Risposte troncate dal budget 20s nella maggioranza dei casi (degradazione prevista; nota in coda).
- Sub-SLO primo token non raggiungibile con fetch 1,1-3,3s + pp: **BLOCKED dichiarato a livello round** (NOTE.md / qa_r16_qa1_report.md).
- ddgs transienti a 0 risultati (timeout 2s): mitigato da generico + riserva Wikipedia (0 casi a 0 risultati nel run finale).
