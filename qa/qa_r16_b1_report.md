# QA Report — Round 16, blocco B1 (IMPLEMENTER-PROMPT + guardia output)

**Stato: COMPLETATO** (report-first; tentativi unità: 1.1=2, 1.2=2, 1.3=3, budget=2 — nessun BLOCKED operazionale).

## Scope e fix (F0.2a/b: TEMPLATE-LEAK + frase canned)

| Unità | Cosa | Evidenza |
|---|---|---|
| 1.1 chat-template | `core/sidecar/client.py`: messages (lista) → POST `/v1/chat/completions` con `chat_template_kwargs.enable_thinking` (solo profili think) → template del GGUF applicato dal server; stringa → path `/completion` LEGACY invariato (testG1/t2a verdi); fallback dichiarato `last_chat_fallback` | E2E `qa/tmp/_r16_b1_smoke.py`: output reale "chi è dante alighieri" **0 marker** (PRIMA: User:/Assistant:/DOMANDA nel testo); diag: thinking-off −13s sul primo token (15.851→3.731 ms misurati) |
| 1.1b prompt assembly | `core/local_llm_client.py`: blocchi `<contesto id="F1" tipo="appunti" fonte="...">` (+W# web), istruzione citazioni, NESSUNA riga grezza "[Fonte locale:"/"User:" nel contenuto; header "CONTESTO/RIFERIMENTI" invariato (testG2_wiring 5/5) | grep: 0 residui "[Fonte locale" nei formati; cap **3x220 char** (budget pp) |
| 1.2 guardia | **NUOVO** `core/rag/output_guard.py`: `check_output` (contract.CANNED_MARKERS incl. frase canned screenshot + system-echo 20char + <80char), prebuffer adattivo 12-24 char, sanitizer live (taglia da User:/Assistant:/System:/marker), 1 retry con `REPAIR_INSTRUCTION`, `contract.RESET_TOKEN`, fallback estrattivo `compose_fallback` (bullet [F1]/[W1], ≥80char, template-free); wiring in `generate_stream` + `stream_via_sidecar` + `time_budget_s` (deadline wall-clock) | guard su output reali QA-1: **0/20 fail**; retry testati |
| 1.3 test | `tests/testR16_prompt.py` | **13/13 verdi**: 50 generazioni simulate (35 bloccate / 15 pulite), sanitizer spezzato, fallback marker-free, retry+RESET, zero rete |

## Verifiche eseguite (conteggi)
- tests/testR16_prompt.py **13/13**
- tests/testR15_gate.py **23/23**, testR15_integration.py **16/16**, testR15_pipe.py **30/30**, testC_rag.py **21/21**, testG1_sidecar.py **3/3** (server reale), testG2_wiring **5/5**
- T1 finale: **2305/0** (incl. questa suite)

## File toccati (owner)
`core/local_llm_client.py`, `core/sidecar/client.py`, `core/rag/output_guard.py` (nuovo), `tests/testR16_prompt.py` (nuovo). `core/sidecar/server.py` **NON toccato** (--jinja non servito: chat endpoint ok senza).

## Limiti / BLOCKED
- Output troncati dal `time_budget_s` (degradazione prevista R16 2.4, nota "_[risposta abbreviata...]" emessa dal client).
- Fallback legacy `/completion` solo su errore endpoint chat (flag dichiarato, mai osservato nei run R16).
- Qualità del contenuto (allucinazioni puntuali) = modello, NON pipeline (gate umano).
- Nessun BLOCKED.
