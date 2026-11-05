# QA Report — R15b IMPLEMENTER-INDEX (blocco I)

**Stato: COMPLETATO** (report-first creato 2026-10-24 21:56, chiuso 2026-10-24 22:45).
Contesto: 4 delegati paralleli, scope disgiunti, TUTTO LOCALE, VTO simulare,
`PYTHONIOENCODING=utf-8`, nessuna pip nuova, nessun restyling.
Contratto `core/rag/contract.py` letto, **NON modificato**.

---

## 1. API implementate (contratto I — entrambi gli store)

### `core/rag/vector_store_sqlite.py` (backend default, sia `vector_index` che `vector_index_books`)

| API | Comportamento |
|---|---|
| `get_index_meta(key) -> str\|None` | lettura dalla **kv `index_meta`** nuova, con `PRIMARY KEY (store_key, key)` → isolamento per store |
| `set_index_meta(key, value) -> None` | UPSERT con colonna `updated` (timestamp ISO) |
| `ensure_embedder_consistent(embedder_id) -> "ok"\|"reindexing"` | meta assente → **bootstrap** (file legacy `embedding_model.txt` se presente, altrimenti `contract.EMBEDDER_ID` dichiarato per gli indici preesistenti; indice vuoto → id runtime) e scrittura in DB; id diverso dal runtime → avvia **reindex LOW-PRIO in background** e ritorna `"reindexing"`; id uguali → `"ok"`. **Mai bloccante** (nessuna attesa: il thread parte e si ritorna subito) |
| `add_chunks(chunks, embeddings, embedder_id=None)` | firma storica **invariata in coda** (2 argomenti = identico al prima). Con `embedder_id`: `meta["emb_id"]` per-chunk + sync `index_meta` (bootstrap id se assente + bump `"updated"`; una divergenza NON viene sovrascritta qui: deve restare visibile ad `ensure_embedder_consistent`) |
| `count_by_source_file(src)` / `get_source_file_signature(src)` | supporto bookkeeping I2 (chunk per sorgente; firma `file_size/file_mtime/file_hash` dai meta) |

- **meta del chunk (W)**: `getattr(chunk, "meta", None)` → **fuso** con le chiavi dello store
  (`source_file`, `location_hint`, `is_image`, `image_path`, `mime_type`); chiavi esistenti
  (`stage`, `url`, `date`, …) **conservate**, quelle standard prevalgono. Compatibile sia con
  Chunk senza `meta` (W non ancora atterrato) sia con `meta: dict|None = None` di W.
- **reindex low-prio**: thread **daemon** `name="r15-reindex"`, priorità minima best-effort
  (`SetThreadPriority(BELOW_NORMAL)` su Windows / `os.nice(10)` su POSIX), log
  `START`/`DONE ms=… chunks=… dim=…`/`FAIL` con flush. **Idempotente**: il lock di stato è
  mantenuto per tutta la durata del worker → una seconda `ensure…` durante un reindex in corso
  ritorna `"reindexing"` **senza duplicato** (misurato: 1 sola factory-call). Il worker
  re-embeddinga i testi dei chunk di SOLO quel `store_key` e ricostruisce le sole tabelle
  vettoriali di quello store (anche cambio `dim`); **chunk e FTS intatti**; meta allineata in
  stessa transazione; in FAIL la meta resta vecchia → la prossima chiamata riprova.
- `Embedder.model_id`/`warmup()` sono di P: ovunque usato `getattr(embedder, "model_id", contract.EMBEDDER_ID)`
  come da contratto (oggi `Embedder` non ha ancora `model_id` → fallback EMBEDDER_ID).

### `core/rag/vector_store_chroma.py` (copertura rollback `RAG_BACKEND=chroma`)
Stesse 4 API: kv su file `index_meta.json` per-store (chroma non ha kv nativa), stesso
`ensure_embedder_consistent` (bootstrap legacy/contract + thread `r15-reindex` che fa
`collection.update` con nuovi embedding), `add_chunks(..., embedder_id=None)` con fusione meta
(solo scalari: il resto serializzato in JSON — vincolo chroma) e `count_by_source_file`
/ `get_source_file_signature`. **La facciata `vector_store.py` (non toccata) le delega via
`__getattr__`** → nessun AttributeError nel path di rollback. Chroma resta solo rollback:
verificato che le API esistono lì, non solo dichiarato.

---

## 2. Forensics (fix SOLO da `qa/f0_forensics.json`)

### F0.1 — `indexed_files` VUOTO (0 righe) con 17 chunk → **ROOT CAUSE REALE TROVATA E FIXATA**

**Root cause reale (non solo "bookkeeping non scritto")**: `index_folder` rimuoveva le righe
non trovate usando `db.get_all_indexed_paths()` che è **GLOBALE** (note + libri condividono lo
stesso DB in `backend/api.py`). Il ciclo reale ogni 300s è:

1. scan note (`file_AIstudio/rag_stage2`) → riscrive le righe (re-parse+re-embed ~3.1s);
2. scan **libri** (`preselected_books/rag_stage2`, vuoto → `found=0`) → **cancellava TUTTE le
   righe delle note** (non le faceva parte del suo albero) → DB tornava a 0 righe;
3. al ciclo successivo tutto da rifare… **per sempre** (esattamente il `reindex 3171 ms` ogni
   scan misurato da f0; i chunk non sparivano perché `delete_by_source_file` è scoped per
   `store_key` → lo scan libri era inoffensivo sui vettori, ma distruggeva il bookkeeping).

**Fix (owner `core/rag/indexer.py`)**:
- **rimozione scoped alla base scansionata**: un scan possiede solo i path dentro la cartella
  scansionata (+ il livello base sopra per i path legacy in radice della base); i path di un
  altro albero (es. l'altro store) sono **intoccabili**. La pulizia file-cancellati-dalla-stessa-base
  continua a funzionare (test dedicato).
- **per-file error isolation**: un file in errore non abortisce più lo scan (le altre righe
  vengono comunque scritte, errore contato in `stats["errors"]`, retry al prossimo scan).
- **swap delete→add**: i vecchi chunk restano interrogabili finché il batch nuovo non è pronto;
  sui rami parse-fallito/0-chunk delete esplicita (nessun chunk orfano con riga a 0).
- **`index_folder` ritorna stats** `{"found","changed","reconciled","removed","errors","ms"}`
  (backward-compat: i caller esistenti ignorano il valore).
- **reconcile senza re-embed**: ogni chunk indicizzato riceve nei meta la firma
  `file_size`+`file_mtime`+`file_hash` (sha256). Se una riga `indexed_files` viene persa ma la
  firma nei meta combacia col file su disco → la riga viene **riscritta senza re-embed**.

**Esito misurato (artefatti `qa/r15_index_scans.json`, `tmp/r15_probe_real.py`, `tmp/r15_probe_full.py`)**:

| Scenario | 1° scan | 2° scan | contatore re-embed | riga dopo scan |
|---|---|---|---|---|
| Run A (stato f0: riga cancellata, chunk legacy senza firma) | **16 272 ms** full re-process (`changed=1`, 1 batch embed) | **163.7 ms**, `changed=0` | **1 → 0** | presente (17 chunk) |
| Run B (post-fix, riga persa ma firma nei meta) | reconcile **1 550 ms**, `changed=0`, `reconciled=1`, **0 embed** | **47 ms** `changed=0` | **0 → 0** | ristabilita |
| Forced (file reso stale, mtime+120) | **135 032 ms** full (`changed=1`, 1 embed) — di cui **~49 s = caricamento modello** (micro-bench: first embed 49 319 ms, warm embed 70 ms) + contenzione 4 delegati paralleli | **971.7 ms**, `changed=0` | **1 → 0** | presente |
| Forced scan3 (riga di nuovo rimossa) | reconcile **660 ms**, `reconciled=1` | — | **0** | ristabilita |
| **Cross-wipe check (fix)**: scan libri (`found=0`, stesso DB) dopo scan note | `removed=0`, **riga note sopravvissuta ✓**, scan note subito dopo: `changed=0` | | **0** | presente |

Riferimento f0 pre-fix: **3171 ms ad OGNI ciclo 300s** (ora: ciclo ripetuto = **0 re-embed**,
scan di solo-stat ~40-500 ms). Nota onesta: i tempi "full" includono il reload del modello
(H1 `release_model()` a fine scan) e la contenzione CPU dei 4 delegati paralleli — il contatore
di re-embed (1→0→0) è la misura robusta dell'idempotenza.

### F0.2 — `embedding_model_id` assente nei metadati DB → PRESENTE

- Nuova tabella **`index_meta (store_key, key, value, updated)`** creata da
  `_ensure_schema` dello store (nessuna modifica a `schema.sql`/`db.py`, che non sono miei).
- Stato reale dopo il run (doppia verifica):
  `vector_index: embedding_model_id=intfloat/multilingual-e5-small + updated=…`,
  `vector_index_books: embedding_model_id=… + updated=…` → **da "ABSENTE" (f0) a PRESENTE**.
- Confronto **query-time** con id runtime: `ensure_embedder_consistent(EMBEDDER_ID)` reale su
  entrambi gli store → **`"ok"` 1ª e 2ª chiamata** (bootstrap da file legacy dichiarato,
  nessun reindex spurio); mismatch → reindex (coperto da test con embedder finto controllato).
- `qa/r15_index_scans.json → db_index_meta` contiene le righe DB come evidenza.

### F0.3 — Books (corpus vuoto, BLOCKED noto — NON affrontato)

- **Wiring runtime presente** e verificato per lettura codice: `core/router.py` costruisce con
  `books_search` e lo interroga (`books_search.search(...)` — righe 404/408/550/604/699/704 al
  momento della verifica; il file è di P e può aver cambiato righe in parallelo, il wiring è
  invariato); `backend/api.py` passa `books_search` al Router.
- **Query reale → 0 risultati SENZA errori** (due livelli, `qa/r15_index_books_wiring.json`):
  - store: `count=0`, `query()=[]`, `query(hybrid=True, text=…)=[]`, `fts_query=[]` (nessuna eccezione);
  - `LocalSearchEngine.search("quando Roma combatté Cartagine…")` → **0.09 ms, 0 chunk,
    `is_empty=True`, `error=None`**.
- **Store books supporta `get/set_index_meta`** ✓ (`ensure` → `"ok"`, kv scritte; test unit dedicato).
- Corpus vuoto: **non toccato** (BLOCKED dichiarato).

---

## 3. Compiti

### I1 — embedding_model_id + reindex automatico → **FATTO**
Come da §1/§2 (F0.2). Copertura chroma: API implementate (non solo dichiarate) — §1.

### I2 — audit coverage + riparazione one-click → **FATTO** (`data/coverage_audit.py`)
- (a) originals→rag_stage2 copia mancante = orfano; (b) chunk ≥1 per file supportato in
  rag_stage2 (match `source_file`, per `store_key`); (c) stato `indexed_files` vs reale
  (riga assente / stale size+mtime / riga per file inesistente) + chunk per file inesistente.
- `qa/coverage_report.json` (per-file: `original/stage2/supported/chunks/indexed/status/issues`
  + orfani per base + summary):
  **reale**: `files=1 ok=1 chunks=17 indexed_rows=1 orfani=0`, `db_ok=True`, `index_meta` leggibile.
  (`originals/` e `rag_stage2/` allineati; base libri assente/vuota → 0 file, non toccata.)
- `--repair`: copia originals→rag_stage2 no-overwrite (.md + sidecar; non-.md → `needs_converter`
  segnalato, nessuna conversione automatica fuori dal converter dell'app) + rimozione righe/chunk
  orfani + **reindex controllato solo di file mancanti/parziali** tramite `Indexer.index_folder`
  (incrementale; ripristino righe anche via reconcile). Nessun costruttore di store viene
  avviato quando non serve.
- **Test idempotenza**: orfano creato → repair1 (`copied=1, reindexed≥1, orphans_after=0`) →
  repair2 = **tutte le azioni a 0, 0 re-embed** (test autom.); su **ambiente reale**
  `--repair` → `copied=0 reindexed=0 rows_reconciled=0 rows_removed=0 chunks_removed=0
  orphans_after=0` (`qa/r15_index_repair_real.json`).

### I3 — FTS5 per tutti → **OK (verificato, nessun fix necessario ai trigger)**
- `add_chunks` popola `chunks_fts` già per via dei trigger `chunks_ai/ad/au` di `data/schema.sql`
  (INSERT di `add_chunks` → trigger → FTS): **test reale** `INSERT → MATCH ritorna il chunk`
  (API `fts_query` con `bm25` + `SELECT … FROM chunks_fts WHERE chunks_fts MATCH` = 1 riga) e
  **scope per store** (store B non vede i chunk di A).
- Su indice di produzione: `fts_query("fotosintesi clorofilliana")` → **3 hit** (`fts_real` in
  `qa/r15_index_scans.json`) → a P (ibrido/RRF) e W (stadio web) il FTS è disponibile.
- Books: `fts_query` su corpus vuoto → `[]` senza errori.

---

## 4. Verifiche (verdi)

| Suite | Esito |
|---|---|
| `tests/testC_rag.py` | **21/0 OK** |
| `tests/testH1_parity.py` | **10/0 OK** (overlap top-10 = 1.000) |
| `tests/testR13_rag.py` | **7/0 OK** (books4/parity invariati) |
| `tests/testH8_retrieval.py` | **20/0 OK** |
| `tests/testR15_index.py` (NUOVO) | **16/0 OK** |
| extra: `tests/testG3_dryrun.py` | **8/0 OK** (regression su `ensure_index_updated`) |

`testR15_index.py` copre: meta persist (reopen + isolamento per `store_key`), bootstrap
vuoto/legacy → `ok`, **mismatch → lancio reindex controllato** (gate: 1 solo thread
`r15-reindex` daemon, nessun dup, meta allineata, dim 4→8 ricostruita, FTS intatto,
3ª chiamata `ok`), `add_chunks → FTS MATCH` (+scope), `emb_id` + fusione meta W,
backward-compat 2 argomenti, **scan 1°/2° con contatore (2° = 0 re-embed)** + reconcile senza
re-embed, **isolamento cross-scan libri/non-wipe righe note** (regression del root cause f0),
pulizia file-cancellato nella stessa base, **coverage repair idempotente (2° run = 0 azioni)**,
books store meta + query vuota.
Tutti i test su **temp dirs/temp DB**: mai `%APPDATA%`, mai `file_AIstudio/` (tranne i due
probe di misura dichiarati che toccano l'ambiente reale dirottando su report `qa/r15_index_*`).

Baseline T1 ufficiale attuale 2146/0: **non rieseguita** (`run_t1`/`metrics_history` vietati);
le5 suite di verifica richieste sono verdi sul codice finale.

---

## 5. File toccati (owner)

**Modificati**: `core/rag/indexer.py`, `core/rag/vector_store_sqlite.py`,
`core/rag/vector_store_chroma.py` (+ invariati: `core/rag/vector_store.py` — solo delega,
`core/rag/contract.py` — letto e basta).
**Nuovi**: `data/coverage_audit.py`, `tests/testR15_index.py`.
**Output**: `qa/qa_r15_i_report.md`, `qa/coverage_report.json`,
`qa/r15_index_scans.json`, `qa/r15_index_books_wiring.json`,
`qa/r15_index_repair_real.json`; probe di misura in `tmp/r15_probe_*.py`.
**Vietati intoccati**: `backend/api.py`, `contract.py`, `config_manager.py`, `core/router.py`
+ `local_search.py` + `semantic_router.py` + `ai_router.py` + `embedder.py` + `answer_cache.py`
(P), `gate.py`/`local_llm_client`/`models` (G), `web_search.py`/`web_stage.py`/`chunker.py` (W),
`web_frontend/**`, test esistenti, MODIFICHE/NOTE, `metrics_history`, `run_t1`.

## 6. Note / limiti dichiarati

1. **Tempi di scan "full"** contengono reload modello H1 (`release_model` a fine scan;
   micro-bench: 49.3 s cold / 70 ms warm) e contenzione CPU con i 4 delegati paralleli —
   i valori puntuali variano tra run; il **contatore di re-embed** (1→0→0) è la prova
   dell'idempotenza.
2. **Righe legacy fuori dalle due base** (path in radice progetto pre-C3, se mai esistenti):
   non più rimosse dagli scan (scoped) → ripulibili con `python data/coverage_audit.py --repair`
   (rimuove `indexed_rows_missing_file` per base). Sul DB reale attuale: nessuna riga del genere.
3. **Chroma**: `index_meta` su file JSON per-store (non tabella) — equivalente funzionale per
   il solo rollback.
4. Books: corpus vuoto **BLOCKED noto, non affrontato** (solo wiring/meta/query verificati).
5. `qa/coverage_report.json` include la chiave `index_meta` del solo store della base
   (lette direttamente dal DB read-only; nessuno store viene costruito durante l'audit).
