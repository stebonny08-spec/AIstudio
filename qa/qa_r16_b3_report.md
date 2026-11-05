# QA Report — Round 16, blocco B3 (IMPLEMENTER-GATE: politica sempre-risposta)

**Stato: COMPLETATO** (report-first; tentativi: 1 — nessun BLOCKED).

## Scope
- `core/rag/gate.py`: `build_informativa(decision, *, web_status="non_eseguito", web_note="")`:
  - **default** → testo legacy R15 byte-compatibile (testR15_integration/gate verdi);
  - **giu** → intro onesta "Non ho trovato nulla in appunti, libri e web perché il web non è raggiungibile." + badge "[Web: non raggiungibile]" + quasi-corrispondenze + suggerimenti;
  - **vuoto** → "[Web: tentato] Nessun risultato web utilizzabile..." (dicitura storica R15 compat);
  - **ok_con_risultati** → degradazione onesta (B2 non dovrebbe usarla);
  - `web_note` opzionale (es. "timeout ddgs 5.0s").
- Tutti i testi: prosa reale ≥80 char, **zero contract.CANNED_MARKERS** (frase canned screenshot vietata).
- `decide_gate` e soglia **0,70**: NESSUNA modifica (GT R15 18 casi invariato; `qa/gt_set_r15.json` intoccato).
- Astensioni.jsonl: invariato (parziale/nulla).

## Verifiche (conteggi)
- `tests/testR16_gate.py` **10/10** (firma contrattuale, 4 varianti web_status, marker-free, GT reale)
- `tests/testR15_gate.py` **23/23** (asserzione firma aggiornata al contratto R16: dichiarata)
- `tests/testR15_integration.py` **16/16**; T1 **2305/0**

## File toccati (owner)
`core/rag/gate.py`, `tests/testR16_gate.py` (nuovo); `tests/testR15_gate.py` (solo asserzione firma, dichiarato).

## Limiti / BLOCKED
- Nessun BLOCKED. Limite di merito: le quasi-corrispondenze usano gli score del gate (floor web 0.4) — indizi, non risposte.
