# F0 — Forensics Round 15b (StudioIA_7)

**Agente**: ANALYST-FORENSICS (subagent 20261024_11) — Round 15b
**Stato**: **COMPLETATO** (F0.1–F0.4)
**Protocollo**: report-first ✅ · max 6 tentativi/unità (usati: 0 BLOCKED) · tutto locale salvo caso q4 (rete dichiarata: 1 batch ddgs) · NESSUNA simulazione — ogni numero da misura reale; le deduzioni sono marcate `code-path`.

## Artefatti

| File | Contenuto |
|------|-----------|
| `qa/f0_probe.py` | script rerunnable (`--no-e2e`, `--no-reindex`, `--postprocess`) |
| `qa/f0_forensics.json` | dump completo F0.1–F0.4 (schema richiesto dal prompt) |
| `qa/f0_probe.log` | log raw del run E2E |
| `qa/f0_forensics.md` | questo report |

## Metodo per caso (dichiarato)

| caso | metodo | nota |
|------|--------|------|
| q1 | **e2e-reale** | flusso completo `Router.process_query_stream(mode=automatica)` con LLM reale in-process (MiniCPM5-2B-Q4_K_M), strumentato (contatore `generate_stream`, timing per stadio) |
| q2 | retrieval-level + code-path | misure reali retrieval/gate/router; generazione dedotta da lettura `router.py` (marchiato) |
| q3 | retrieval-level + code-path | idem |
| q4 | **e2e-reale** | idem q1 + UNICA uscita di rete del probe (ddgs → DuckDuckGo) |
| q5 | retrieval-level + code-path | idem q2; punteggio near-miss MISURATO (non forzato) |

## Tabella casi → root_cause (F0.1/F0.4)

| id | query (testo esatto) | method | root_cause | outcome_oggi (osservato/derivato) | tot_ms | llm_calls |
|----|----------------------|--------|-----------|-----------------------------------|--------|-----------|
| q1 | "Nella fotosintesi clorofilliana qual è il valore di ΔG°' in kJ/mol della reazione che produce glucosio?" | e2e-reale | **OK** | E2E: source=**locale**, risposta "+2870 kJ/mol" ✅ | **85 351** (incl. caricamento modello in-process) | **1** (reale) |
| q2 | "Quanta energia libera serve alle piante per trasformare anidride carbonica e acqua in zucchero usando la luce?" | retrieval+code-path | **OK** | risposta-locale (marker "2870" in top-10 vec, sim 0.8604) | retrieval ~76 ms; generazione non misurata (null) | 1 (dedotto code-path) |
| q3 | "Confronta le vie C4 e CAM: qual è il primo accettore di CO2 in ciascuna e il rapporto ATP:NADPH consumato per CO2?" | retrieval+code-path | **OK** | risposta-locale (marker "PEP (3C)" sim 0.8596; "5.5 - 6.5" presente in indice) | retrieval ~75 ms; gen non misurata | 1 (dedotto) |
| q4 | "Qual è la differenza tra mitosi e meiosi nelle cellule?" | e2e-reale | **NO-WEB** | E2E: source=**web** — 1ª chiamata locale con chunk IRRILEVANTI (sim 0.82) → modello emette `[[NESSUNA_INFORMAZIONE_LOCALE]]` → libri(vuoto) → web(5 risultati) → 2ª chiamata | **132 636** | **2** (reale: 76.6s + 54.2s) |
| q5 | "Quando un vegetale spreca una parte di quello che ha già fissato perché il suo enzima prende l'ossigeno invece del gas giusto, quanto perde in percentuale?" | retrieval+code-path | **OK** | risposta-locale (marker "25%" in top-10; **sim top1 = 0.8502 — near-miss NON atterrato sotto soglia**) | retrieval ~75 ms; gen non misurata | 1 (dedotto) |

`per_root_cause`: **OK×4, NO-WEB×1** — nessun caso MISS-RETRIEVAL / COVERAGE / THRESHOLD / EMBEDDER-MISMATCH osservato su questo corpus (le evidenze qui sotto mostrano perché).

### Dump per stadio (sintesi; dettaglio top-10 completo in JSON `cases[].stages_dump`)

| caso | max sim vec | range sim vec (top10) | fts top1 bm25 (più neg.=meglio) | rrf rank del top1 | gate sims seleziate | confidence | should_answer |
|------|-------------|----------------------|--------------------------------|-------------------|---------------------|------------|---------------|
| q1 | 0.9125 | 0.9125–0.8706 (8 su 10 con vettore) | **−15.4257** | 1 | [0.9125, 0.8943, 0.8796, 0.8754, 0.8734] | alta | true |
| q2 | 0.8604 | 0.8604–0.8382 (9 su 10) | **−6.1726** | 1 | [0.8604, 0.8561, 0.8537, 0.8489, 0.8485] | alta | true |
| q3 | 0.8661 | 0.8661–0.8451 (10 su 10) | **−5.9423** | 1 | [0.8661, 0.8637, 0.8603, 0.8596, 0.8593] | alta | true |
| q4 | **0.8200** | 0.8200–0.8024 (9 su 10) | **−2.4629** | 1 | [0.82, 0.8121, 0.8119, 0.8113, 0.8093] | **alta** | **true** |
| q5 | 0.8693 | 0.8693–0.8396 (8 su 10) | **−3.5551** | 1 | [0.8693, 0.8638, 0.8601, 0.8539, 0.8502] | alta | true |

- **Tutte** le query → `semantic_router.use_rag=True` (misurato: q1 sim_rag=0.794 vs sim_no_rag=0.780; margini ≥0.006).
- ⚠️ **q4 irrilevante passa il gate a 0.82 (conf=alta, should_answer=true)**: le soglie 0.45/0.35 non discriminano su questo corpus; l'astensione reale osservata E2E viene dal **marker del modello**, non dal gate H8.
- ⚠️ **FTS5/BM25 e RRF non esistono nel percorso di produzione**: `search(hybrid=False)` (default) → solo vettore. Dump FTS/RRF = **diagnostico** (grep `hybrid=True`: solo definizioni/commenti in `local_search.py`, zero in `backend/`).
- Chunk **sub-0.35 non torna dal caller** (near-miss invisibile): su misura, nessun top-10 scende sotto 0.80 → non osservabile qui.

## F0.2 — Check copertura

| voce | misura |
|------|--------|
| q1/q2 marker "2870" | **2 chunk** nell'indice (store `vector_index`) → COVERAGE OK |
| q3 marker "PEP (3C)" / "5.5 - 6.5" | **3 chunk** / **1 chunk** → OK (tabella intera in indice) |
| q4 marker "mitosi"/"meiosi" | **0 / 0 chunk** → assente dal corpus |
| q5 marker "25%" | **3 chunk** → OK |
| stadio copertura | **appunti** (`vector_index`); libri = **0 chunk** (store partecipante vuoto, misurato count=0); web = solo via query |
| originals/ vs rag_stage2/ | stessi 1 file (`fotosintesi_clorofilliana_universitario.md`); **indicizzato solo `rag_stage2/`** (17 chunk, sorgente DB confermata); `originals/` non indicizzato (per design C4) |
| `indexed_files` | **0 righe con 17 chunk** (anomalia misurata; dopo reindex del probe → 1 riga) |
| **embedding_model_id indice** | **PRESENTE** come file per-store: `%APPDATA%\NovaStudio\vector_index\embedding_model.txt` e `vector_index_books\embedding_model.txt` = `intfloat/multilingual-e5-small`; **ABSENTE** come colonna DB (`PRAGMA table_info(chunks)` = id, doc_id, parent_id, source_file, store_key, testo, meta, dim) |
| **embedding_model_id runtime** | `intfloat/multilingual-e5-small` (`core/rag/embedder._MODEL_NAME`) → **coincide** → EMBEDDER-MISMATCH **non rilevato** (ma il verderesso vive solo in un file, non nei metadati indice/DB: evidenza per blocco I) |

## F0.3 — Check costo (q4, misurato E2E reale con web)

| stadio | ms (reale) | nota |
|--------|-----------|------|
| semantic_router (query calda) | 26.9 | q4; q1 **43 631 ms a FREDDO** = import torch/ST + caricamento pesi E5 + encode 115 esempi (prima query del processo); 115 esempi puri ≈ 428 ms (E2E q1) |
| embed query | ~0.01 | cache LRU (la query è già embeddata dal semantic_router) — embed effettivo ≈ nei ~30 ms del semantic_router |
| vec (top-10) | 4.7 | q1 41 ms (primo accesso store), poi 3.5–4.4 |
| fts5 (top-10, diagnostico) | 1.5 | 1.5–6.9 ms |
| local_search totale | 4.15 | 4.15–4.4 ms |
| books search | 0.12 | count=0 → empty immediato |
| **web (ddgs)** | **1 832.5** | **1 solo batch** (6 domini, break a 5 risultati; 4 batch possibili × timeout 10s) — rete dichiarata |
| reindex (background, NON in path) | 3 171.1 | 1 misura reale: 17→17 chunk; prima era full re-embed ogni 300s (`indexed_files` vuoto) |
| **LLM generate_stream** | **q4 = 130 800** (76 618 + 54 183) | **2 chiamate** (contatore reale); q1 = 84 917 (1 chiamata, include caricamento modello) |
| **TOTALE query→messaggio finale** | **q4 = 132 636 ms** · q1 = 85 351 ms | first-token: q4 = 74 983 ms; q1 = 81 306 ms |
| token & velocità | q1: 35 token, gen post-first-token 3.61 s → **9.7 tok/s**; q4: **321 token totali** (call1 ≈ marker fallback in 1.63 s, call2 = 54.2 s totali pp+gen non separabili senza ulteriore strumentazione) | prompt-eval: q4 ~75 s a prompt stima code-path ~2.4–2.8k token → pp implicita ≈32–37 tok/s (derivata, non strumentata) |

**Chiamate LLM — conteggio reale**: q1=**1**, q4=**2** (strumentato su `generate_stream`).
**Caso web-off (deduzione code-path, NON misurato — veto su simulazione)**: web vuoto → 2ª chiamata con `context_kind="none"` → stessa 2 chiamate, ultima genera "non ho abbastanza informazioni" **senza contesto**; se il retrieval locale fosse stato vuoto da subito → 1 sola chiamata context=none.

## Blocking findings (per la FASE1)

1. **SIDECAR-DEAD** (misurato): `SidecarLLMProxy.generate_stream` fa `sig.bind` su metodo non-bound → `TypeError: missing a required argument: 'query'` → **fallback silenzioso in-process** con `llm.backend=sidecar`; llama-server **non parte mai** (state=down misurato). Stesso percorso in produzione. *(E2E F0 eseguito quindi in-process = rollback documentato.)*
2. **Gate H8 non decisionale**: consumatori `should_answer/confidence` = solo `core/local_search.py` + `core/models.py` (grep mio, conferma coordinatore) → **l'astensione non decide nulla**; E2E q4: conf=alta su chunk irrilevanti, escalation solo via marker del modello.
3. **Percorso produzione solo-vettore**: FTS5/BM25/RRF mai consultati in query (`hybrid=False` ovunque in backend) → i nuovi stadi FTS/RRF del contratto vanno collegati loro (oggi sono morti nel flusso).
4. **Soglie non discriminanti** su corpus unitario: tutte le sim top-10 ≥ 0.80 (q4 irrilevante 0.82) → THRESHOLD non osservabile; near-miss q5 misurato a 0.85 → **nessun caso THRESHOLD/MISS-RETRIEVAL su 5 query**.
5. **`indexed_files` vuoto con 17 chunk**: ogni reindex background (300s) rifull re-parse+re-embed (misurato 3 171 ms); dopo il probe è 1 riga (allineato).
6. **`embedding_model_id`**: PRESENTE solo come file `embedding_model.txt` per store; **ABSENTE nei metadati DB** (colonna/champ) — per il blocco I: servono id nei metadati indice.
7. **Latenza prompt-eval**: prima risposta calda ~75 s a prompt 2.4–2.8k token (pp ≈37–40 tok/s impliciti vs gen ~10 tok/s); q1 include ~caricamento modello (first token 81.3 s).
8. **Caso "non abbastanza informazioni"**: dedotto code-path (web-off, non simulato) — 2ª chiamata context=none SENZA contesto; il messaggio è generato dal modello, non da una regola.

## Verifiche finali

- **Processi residui**: 0 python/llama residui dopo il run (verifica `Get-Process` → nessun llama/python; sidecar mai avviato, `sidecar_shutdown: state=down`).
- **Rete**: usata SOLO per lo stadio web di q4 (1 chiamata ddgs, 1829.57 ms, 5 risultati, batch `site:` su 6 domini trusted); `HF_HUB_OFFLINE=1` forzato; nessun LLM cloud.
- **Tentativi**: unità F0.1–F0.4 completate entro i limiti (0 BLOCKED).
- **Scritture**: solo `qa/f0_probe.py`, `qa/f0_forensics.json`, `qa/f0_forensics.md`, `qa/f0_probe.log` + scritture di boot/idempotenti dell'app su `%APPDATA%\NovaStudio` (embedding_model.txt riscritto uguale, chroma_migrated.flag, reindex 1× = comportamento standard dell'app) — dichiarate.
