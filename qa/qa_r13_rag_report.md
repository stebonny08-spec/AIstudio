# QA Report R13 — RAG (IMPLEMENTER-RAG)

Data: 2026-10-24
Owner: subagent 20261024_8 (IMPLEMENTER-RAG, Round 13 continuation)
Scope: C3 fix (dedupe legacy), BOOKS1-4, verifiche, limiti/BLOCKED.

## C3 — Dedupe chunk legacy (indice SOLO da rag_stage2/)
**Stato: DRY-RUN COMPLETATO (apply in corso)**

Conteggi PRIMA (studioia.db, store 'vector_index'): 34 totali = 17 LEGACY
(path radice `file_AIstudio\fotosintesi_...md`) + 17 da `rag_stage2/` + 0 originals.
Verifica sha256: 17/17 testi legacy IDENTICI a un testo rag_stage2 (duplicato
esatto, 17 sha distinti) → cancellabili=17, non_duplicati=0.

- Dry-run: `set PYTHONIOENCODING=utf-8&& python data\migrate_real.py --dedupe-legacy`
  → STATUS=DRY_RUN, legacy=17, stage2=17, originals=0, deleted=0
  → `qa/r13_rag_dedupe_dryrun.json` (0 scrittura su %APPDATA%).
- Metodo verifica retrieval (baseline): ranking COMPLETO (top_k=tutti i chunk)
  su copia read-only del DB (sqlite backup API), 24 query derivate da
  `file_AIstudio/rag_stage2/*.md`, DeterministicEmbedder (tests/testH1_parity.py,
  dim=384 letta dall'indice), identità hit = sha256(testo)|source_file;
  incluso ranking FTS informativo. Baseline: ok=True, n_chunks=34, dim=384.

**APPLY (eseguito):**
- `set PYTHONIOENCODING=utf-8&& python data\migrate_real.py --dedupe-legacy --apply`
  → STATUS=eseguito, deleted=17/17, backup=`%APPDATA%\NovaStudio\backup_chroma_20261024_133249`
  (manifest SHA256 verificato `_verify_backup`=True), post-check:
  **legacy=0, originals=0, stage2=17, totale=17** (prima: 34 = 17 legacy + 17 stage2).
- Parity retrieval PRIMA/DOPO: **24/24 query OK, ordine STRETTO identico
  (strict_all=True), max delta similarity = 0.0** (identico salvo i 17
  duplicati rimossi); FTS: set dei documenti matchati uguale in 24/24.
- 2° run (idempotenza): STATUS=NIENTE_DA_FARE, legacy=0, deleted=0, nessun
  secondo backup → `qa/r13_rag_dedupe.json` (record del 2° run).
- Replay dell'apply su copia temporanea ripristinata dal backup pre-dedupe
  (evidenza "eseguito" duplicata, meccanica, su TEMP): STATUS=eseguito,
  deleted=17, parity OK, post 0/17 → `qa/r13_rag_dedupe_replay.json`.
- Tests: `python tests\testR13_rag.py` → **6 test / 0 fail** (rilevamento
  legacy, rifiuto se non duplicato, apply+idempotenza, originals esclusi,
  BOOKS4 AST + dinamico). testC_rag.py invariato: **21 test / 0 fail**.
- Audit oggettivo: `python qa\audit_c_r13.py` → **TUTTO OK** (8/8 check,
  incluso C3a legacy=0) → copia in `qa/r13_rag_audit_c.json` (ok=true).

**Stato finale C3: COMPLETATO.**

## BOOKS1 — Parity/recall vector_index_books (REALE)
**Stato: COMPLETATO (corpus vuoto dichiarato con numeri reali).**

- Comando: `set PYTHONIOENCODING=utf-8&& python data\migrate_real.py --books-dry-run`
  → `qa/r13_rag_books1_dryrun.json`
- Misura REALE su `%APPDATA%\NovaStudio\vector_index_books\chroma.sqlite3`
  (copia read-only su TEMP, 0 scrittura su %APPDATA%): **chroma_count=0
  embedding, n_chunks=0, n_queries=0, parity_top10=0.0, recall5=0.0**
  (nessun embedding reale da confrontare).
- **DICHIARAZIONE: "corpus vuoto, parity/recall vacui (0/0 misurati)"** —
  status=VACUO, `corpus_vuoto=true`. Nessun valore inventato.

## BOOKS2 — Backup SHA256+manifest + test restore (checksum)
**Stato: COMPLETATO.**

- Comando: `python data\migrate_real.py --books-backup-verify`
  → `qa/r13_rag_books2_backup.json`, backup=`backup_chroma_20261024_134602`
- 12 file nel manifest (di cui 3 sotto `vector_index_books/` con sha256
  registrati: chroma.sqlite3 `55eef4cbe367…`, chroma_migrated.flag,
  embedding_model.txt); `_verify_backup` manifest SHA256 = **True**.
- Sorgente %APPDATA% vs backup: 11/12 identici **byte**, `studioia.db`
  verificato a livello **logico** (dump SHA256 identico; header sqlite
  riscritto dalla backup-API: change counter) → nessun mismatch.
- **Test restore su cartella TEMP** (0 scrittura su %APPDATA%): tutti i 12
  file ripristinati; 10 byte-identici + 2 file `.sqlite3` (i due
  chroma.sqlite3) verificati **logicamente** (dump di contenuto SHA256
  IDENTICO; la backup-API sqlite riscrive solo 5-7 byte d'header:
  change counter/schema version — dati intatti). `checksum_mismatch=[]`,
  `status=eseguito`.
  NOTA: `restore()` stesso restituisce ok=false su quei 2 file per il
  confronto strettamente byte: comportamento atteso e documentato (il test
  G3 esistente usa file random non-sqlite, da cui la scoperta).

## BOOKS3 — Cutover chroma→sqlite store 'vector_index_books' + rollback
**Stato: COMPLETATO.**

- Comando: `python data\migrate_real.py --books-cutover`
  → `qa/r13_rag_books3_cutover.json`, backup=`backup_chroma_20261024_135015`
- Gate: **vacuo dichiarato** (chroma_count=0, n_chunks=0 → parity/recall
  VACUI 0/0, migrazione 0→0, nessun dato da perdere).
- Migrazione dalla COPIA temporanea (la sorgente reale non viene aperta
  dalla API chromadb durante la migrazione): `migrate ok, migrated=0, total=0`.
- **Sorgente byte-intatta dopo il cutover: True** (sha256 di ogni file
  invariato, flag escluso). Flag `chroma_migrated.flag` **scritto** con
  `{"source": "...--books-cutover", "vacuo": true, "chunks": 0, ...}`.
- Post-check: **0 chunk** nello store sqlite `vector_index_books`
  (0 legacy/0 originals/0 stage2 — corpus vuoto) → `zero_dichiarato=True`.
- **Rollback testato**: (a) selettore backend default=**sqlite**,
  con `RAG_BACKEND=chroma`→**chroma**; (b) apertura REALE dell'indice con la
  classe legacy `ChromaVectorStore` → **apribile, count()=0**; (c) analisi
  riga-per-riga del contenuto logico pre/post apertura: **+1 riga SOLO in
  `acquire_write`** (tabella lock interna di chromadb) e contatori header
  sqlite, 0 righe rimosse, nessun dato utente toccato
  (`solo_bookkeeping_chromadb=True`). Lo sha byte cambia per quella riga —
  normale all'apertura della API chroma, non dovuto al cutover.
- Backup SHA256 del cutover verificato (`backup_sha_verified=True`).

## BOOKS4 — Import chromadb nel runtime (eager=0)
**Stato: COMPLETATO — "chromadb rimosso dal runtime (import default=0)".**

- Comando: `python data\migrate_real.py --books4-imports`
  → `qa/r13_rag_books4_imports.json` (STATUS=eseguito)
- Scan AST di **118 file** runtime+test (`core/`, `backend/`, `data/`,
  `main.py`, `tests/`, `qa/`, root `*.py`): **0 import EAGER** nel percorso
  default (livello modulo o corpo classe).
- Unici **3 siti function-level (LAZY)**, tutti consentiti:
  1. `core/rag/vector_store_chroma.py:30` — scope `class.function`
     (`ChromaVectorStore.__init__`, eseguito SOLO sotto RAG_BACKEND=chroma
     o fallback);
  2. `core/rag/vector_store_sqlite.py:647` — `migrate_chroma_to_sqlite`
     (solo migrazione una-tantum);
  3. `data/migrate_real.py:228` — strumenti di migrazione (tool, non runtime).
- Check **dinamico** (sottoprocesso, `RAG_BACKEND` non impostato): import di
  `core.rag.vector_store`, `core.rag.indexer`, `core.local_search`,
  `data.migrate_real`, `backend.api`, `main` → tutti caricati senza errori e
  **`chromadb` ASSENTE da sys.modules**; `_resolve_backend()` → **sqlite**.
- Fix in codice NON necessari (il vincolo era già rispettato): nessuna
  modifica a `core/rag/**` o `core/local_search.py`.

## Verifiche oggettive (riepilogo finale)
| Verifica | Comando | Esito |
|---|---|---|
| Audit C (coordinatore, non modificato) | `set PYTHONIOENCODING=utf-8&& python qa\audit_c_r13.py` | **TUTTO OK 8/8** (C3a legacy=0; C4a 0 originals su 17 chunk; C4b 17/17 non-originals; C4c 21/0) |
| Copia audit | `qa/r13_rag_audit_c.json` | `ok=true`, 8 checks |
| Test R13 RAG (nuovi) | `python tests\testR13_rag.py` | **7 test / 0 fail** |
| Test C RAG (invariato) | `python tests\testC_rag.py` | **21 test / 0 fail** |
| C3 dry-run | `python data\migrate_real.py --dedupe-legacy` | DRY_RUN: legacy=17, cancellabili=17, non_duplicati=0 |
| C3 apply | `python data\migrate_real.py --dedupe-legacy --apply` | eseguito: deleted=17, post legacy=0/stage2=17/originals=0, parity 24/24 strict, delta 0.0 |
| C3 idempotenza | 2° `--dedupe-legacy --apply` | NIENTE_DA_FARE (0 da fare, nessun 2° backup) |
| BOOKS1 | `python data\migrate_real.py --books-dry-run` | VACUO: 0/0 reali |
| BOOKS2 | `python data\migrate_real.py --books-backup-verify` | eseguito: manifest SHA ok, restore 12/12 (10 byte + 2 logico), mismatch=[] |
| BOOKS3 | `python data\migrate_real.py --books-cutover` | eseguito: 0→0, sorgente byte-intatta, flag scritto, rollback ok |
| BOOKS4 | `python data\migrate_real.py --books4-imports` | eseguito: eager=0, lazy=3, dinamico chromadb absent, backend=sqlite |

Conteggi indice materiali (studioia.db, store `vector_index`):
**PRIMA 34 (17 legacy + 17 rag_stage2 + 0 originals) → DOPO 17
(0 legacy + 17 rag_stage2 + 0 originals)**.

## Limiti / BLOCKED
1. **BLOCKED — parity/recall reale libri ≥1.000 non misurabile (corpus vuoto).**
   - CAUSA: `preselected_books\{originals,rag_stage2}` vuoti e
     `vector_index_books` = 0 embedding REALE → misura **VACUA 0/0**
     (BOOKS1: chroma_count=0, n_chunks=0, parity=0.0, recall5=0.0).
     Nessun valore inventato; nessuna simulazione.
   - PROCEDURA MANUALE: (1) inserire libri reali: **tab Materiali → libri**
     (l'app crea originals/+rag_stage2/ e indicizza) **OPPURE** copiare i .md
     in `%APPDATA%\NovaStudio\preselected_books\originals\` **E** in
     `%APPDATA%\NovaStudio\preselected_books\rag_stage2\`;
     (2) `set PYTHONIOENCODING=utf-8&& python data\migrate_real.py --books-dry-run`
     → atteso `parity_top10>=1.000` e `recall5>=1.000` (gate reale);
     (3) `python data\migrate_real.py --books-cutover` (gate reale G3,
     non più vacuo);
     (4) verifica: post-check `n_chunks>0` + rilancio `qa\audit_c_r13.py`.
   - E2E **MECCANICA** (opzionale, svolto) su cartella TEMP con corpus
     sintetico: il pipeline misura **parity_top10=1.000000 e
     recall5=1.000000** (12 chunk, 2 md) → `qa/r13_rag_books_e2e_temp.json`
     (test `TestBooks1E2eTemp` in tests/testR13_rag.py). **Vale come test di
     meccanica, MAI come misura su libri reali.**
2. **L1 — indice chroma legacy ancora con path legacy**: l'indice cromadb
   storico `%APPDATA%\NovaStudio\vector_index\chroma.sqlite3` (34 embedding:
   17 path radice + 17 rag_stage2) NON e' stato toccato (design H1/G3: "i
   dati chroma non vengono mai cancellati dalla migrazione", sono lo snapshot
   di rollback). Backend DEFAULT = sqlite ed e' pulito (audit OK). Se mai si
   attivasse `RAG_BACKEND=chroma`, i path legacy risulterebbero da lì →
   procedura: restare su sqlite (default) oppure re-indicizzare da
   `rag_stage2/` con `ChromaVectorStore`.
3. **L2 — NON rieseguire `python data/migrate_real.py --commit` sui
   materiali**: re-importerebbe i 34 chunk da chroma **inclusi i 17 legacy**
   (il `chroma_migrated.flag` blocca solo la migrazione automatica, non il
   `--commit` manuale). Se mai servisse: prima pulizia dell'indice chroma o
   rieseguire poi `--dedupe-legacy --apply`.
4. **L3 — file di altro delegato con errore**: lo scan AST (BOOKS4) rileva
   `SyntaxError` in `tests/testR13_telem.py:151` (proprietà di altro
   delegato R13, in scrittura). **Non modificato** (file vietato): riportato
   qui.
5. **N4 — nota C3b**: `qa/g3_migration.json` riporta `chunks=34`: è
   l'evidenza STORICA della migrazione G3 (all'epoca 34), non è un conteggio
   corrente; l'audit non usa quel valore per C3a (usa i conteggi live di
   studioia.db).

## File toccati / non toccati
TOCCATI (nei limiti assegnati):
- `data/migrate_real.py` — aggiunti `--dedupe-legacy [--apply]`,
  `--books-dry-run`, `--books-backup-verify`, `--books-cutover`,
  `--books4-imports` + funzioni (scan_store_chunks, retrieval_snapshot,
  compare_snapshots, _delete_legacy_rows, dedupe_legacy, books_*,
  _sqlite_dump_sha/_identity_vs_manifest); `dry_run()` esteso con
  `store_key` (default invariato). **Comportamenti G3 preesistenti
  invariati** (backup/restore/commit/dry-run signature estese solo con
  default; testG3_dryrun intatto).
- `tests/testR13_rag.py` — NUOVO, 7 test (C3 ×4, BOOKS4 ×2, e2e books ×1).
- Output miei: `qa/qa_r13_rag_report.md`, `qa/r13_rag_dedupe_dryrun.json`,
  `qa/r13_rag_dedupe.json`, `qa/r13_rag_dedupe_replay.json`,
  `qa/r13_rag_audit_c.json`, `qa/r13_rag_books1_dryrun.json`,
  `qa/r13_rag_books2_backup.json`, `qa/r13_rag_books3_cutover.json`,
  `qa/r13_rag_books4_imports.json`, `qa/r13_rag_books_e2e_temp.json`.
- Dati %APPDATA% (necessari al fix): 17 chunk legacy rimossi da
  `studioia.db` (+vettori vec0 +FTS +doc_versions); backup SHA256
  `backup_chroma_20261024_{133249,134602,134659,135015}`; flag
  `vector_index_books\chroma_migrated.flag` riscritto dal cutover; +1 riga
  interna `acquire_write` in chroma.sqlite3 libri (apertura di rollback
  test, documentato).

NON TOCCATI (nessuna modifica richiesta lì): `backend/**`,
`core/ai_runtime.py`, `core/sidecar/**`, `core/local_llm_client.py`,
`core/router.py`, `core/registry/**`, `core/workers/**`,
`data/config_manager.py`, `data/autotune.py`, `data/db.py`,
`web_frontend/**`, `qa/metrics_history.json`, `qa/audit_r13.json`,
`qa/audit_c_r13.py`, `tests/run_t1.py`, `qa_browser/**`, `qa_ui/**`,
`tests/testC_rag.py` e tutti i test esistenti, `MODIFICHE.md`, `NOTE.md`,
`index.html`, `core/rag/**`, `core/local_search.py` (BOOKS4 non ha
richiesto fix). Unica segnalazione di intervento altrui: SyntaxError in
`tests/testR13_telem.py` (vedi L3).
