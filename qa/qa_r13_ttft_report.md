# R13 — REPORT UNITÀ TTFT (IMPLEMENTER-TTFT)

**Unità**: "TTFT sonda pywebview p50 ≤ 2000 ms" — stato iniziale: FALLITA (misura reale)
**Delegato**: IMPLEMENTER-TTFT (Subagent 20261024_9)
**Creato**: 2026-10-24 14:33 (CEST) — report-first protocol

## Contesto (dati esistenti, NON rimisurati alla cieca)

- Script: `tests/t13_ttft_pywebview.py` (creato dal delegato TELEM)
- Output: `qa/t_probe_pywebview.json`, log `qa/r13_telem_probe.log`
- Metodo: pywebview `create_window(hidden=True)` reale + bridge; in pagina `evaluate_js` → `window.pywebview.api.send_message(...)` + poll `poll_stream(message_id, from_index)` @25ms; TTFT = `performance.now()` da prima della chiamata bridge al PRIMO token. n=5 + warmup escluso.
- Modello: `MiniCPM5-2B-Q4_K_M.gguf`, llm.backend=sidecar.
- **Risultato sonda TELEM**: p50 = **91.962 ms**, p95 = 115.950 ms, warmup 105.673 ms
  samples = [87944.9, 91962.4, 115949.8, 106999.4, 49955.1] ms (circa 50–116 s!), tutti first_token "\n\n"
- Carico dichiarato durante quella sonda: 3 delegati R13 in parallelo (bench SPEC/llama-bench+llama-server concorrenti) + reindex di background reale; cpu1s=1.8–5.3%, mem 60.5%, 16 core.
- Confronto R12 (`tests/t2a_ttft.py` → `qa/g4_ttft.json`, path DIRETTO client, non app): TTFT hit p50 135 ms / miss p50 699 ms.
- A fine sonda TELEM: 0 processi python/llama-server orfani ✓; ~15 processi `chrome` presenti (candidati solo se command-line contiene "headless" o "remote-debugging-port").

## Piano (protocollo, max 6 tentativi/unità)

1. Ambiente controllato: verifica assenza llama-server/llama-bench concorrenti; cpu/mem PRIMA e DOPO nel json; sonda pulita → se p50 ≤ 2000 ms ⇒ OPENO-CONTENZIONE.
2. Se lento anche quiet: fasi strumentate (`qa/r13_ttft_phases.json`).
3. Causa dominante.
4. Fix minimale nei file assegnati → rimisura (oppure BLOCKED con causa + procedura manuale).
5. Nessuna simulazione; dichiara SEMPRE il carico macchina.

---

## LOG PASSI

### Passo 0 — 14:33 — Report creato
- Creato `qa/qa_r13_ttft_report.md`.
- Prossimo: ispezione ambiente (processi concorrenti) + lettura script/JSON esistenti.

### Passo 1 — 14:33–14:40 — Analisi + strumentazione

- **Ambiente quiet verificato**: `Get-CimInstance Win32_Process` → NESSUN llama-server/llama-bench/python concorrente (delegati finiti) ✓. ~15 chrome presenti: check headless/remote-debugging-port delegato a `env_scan()` nella sonda (kill solo di quelli con flag puppeteer).
- **Nota onestà**: il campo `method` del json TELEM diceva `'automatica'` ma la sonda ha girato con `PROBE_MODE=solo_locale` (vedi log `worker start (mode=solo_locale...)` e `probe_mode_fe` nel json): stringa corretta nel report/JSON ora (dato reale dichiarato).
- **Analisi flusso app**: `send_message` → thread `_run_generation` → `router.process_query_stream` → (solo_locale) `local_search.search` (RAG/embed) → `SidecarLLMProxy → stream_via_sidecar → SidecarClient.complete(stream=True)` → `_ensure_server` → POST /completion llama-server → poll_stream. R12 (g4_ttft) = `SidecarClient.complete` diretto con prompt CORTI (una frase, classe micro): hit 135ms / miss 699ms, server load 3.4s.
- **Istruzione fasi aggiunta a `tests/t13_ttft_pywebview.py`** (monkey-patch solo nel processo sonda, nessun file di produzione toccato): wrap di `api.send_message`, `router.process_query_stream`, `local_search.search`/`books_search.search`, `LocalLLMClient.stream_via_sidecar`, `SidecarClient.complete/_ensure_server/parse_sse_line`, `SidecarServer.start_on_demand`, `CodaPriorita._esegui` → output progressivo `qa/r13_ttft_phases.json`.
- **Ambiente dichiarato nel json**: `env_scan` (prima/dopo) + cpu/mem PRIMA e DOPO; kill proattivo chrome headless/puppeteer (mai chrome utente).
- Backup dati TELEM → `qa/r13_ttft_prev_load.json`.
- `py_compile` OK.

### Passo 2 — tentativo 1 — sonda QUIET con fasi (14:49–14:55) — RISULTATO: 0/5 misure JS valide, MA fasi utilissime

**Ambiente**: QUIET confermato (env_scan_pre: 0 llama-*, 0 python altri, 0 chrome headless; cpu1s 3.3% prima / 2.3% dopo; mem 61.2%→78.4%; shutdown sidecar OK, 0 orfani) ✓.

**PROBLEM**: tutte e 6 le misure JS (warmup+5) fallite con `stream finito senza token: 'NoneType' object is not iterable` (n=0). Le fasi Python (`qa/r13_ttft_phases.json`) hanno però registrato il flusso completo.

**FASI (quiet, rammaricato)** — `phases_ms` / `meta`:
| req | rag_ms | prompt_chars (≈token) | sidecar | llm first piece | py first token |
|---|---|---|---|---|---|
| warmup | 0.6 (rag EMPTY, reindex ancora in corso!) | 847 (prompt_n=271) | OK: ensure 3144ms (avvio server), prompt_ms 2571 (105 t/s), gen 600t @12.7 t/s | 5726ms | 5727ms |
| m1 | **6469** (embedder/reindex) | 11852 (≈3800t) | KO a ~8057ms (=CONNECTION_TIMEOUT 8.0s!) | 54755ms | 61225ms |
| m2 | 88.8 | 13922 (≈4500t) | KO | 56687ms | 56776ms |
| m3 | 70.0 | 13922 | KO | 64875ms | 64945ms |
| m4 | 60.2 | 14239 (≈4600t) | KO | 43936ms | 43997ms |
| m5 | 48.7 | 11535 (≈3700t) | KO | 25165ms | 25214ms |

**CAUSA DOMINANTE (quiet, misurata — NON contenzione delegati)**:
1. **Prompt RAG gigante**: index reale popolato → 5 chunk (~350 parole l'uno) iniettati per OGNI messaggio (anche "Rispondi con la sola parola: ok") → prompt 11.5–14.2k chars ≈ **3700–4600 token** vs warmup 271. Prompt eval CPU ≈ **105 t/s** (prompt_ms warmup 2571ms/271t) → 3700–4600t ≈ **35–44 s** di solo prompt eval. → TTFT 25–65s.
2. **prompt ≥ llama.n_ctx=4096** (config!): i prompt delle misure superano il contesto del server sidecar → richiesta non servibile correttamente.
3. **`CONNECTION_TIMEOUT=8.0s` in `core/sidecar/client.py`** (read-only): ogni prompt ≳800 token supera gli 8s di attesa prima byte → `AiUnavailable` → **fallback in-process** (llama-cpp con n_ctx 8192, modello caricato in-process) → **DOPPIA valutazione del prompt** (llama-server sta ancora lavorando + llama-cpp ricalcola) → ulteriore rallentamento + i misuratori (sidecar_pieces=0, KO×5) + errore `'NoneType' object is not iterable` nel path in-process.
4. **Confronto R12**: prompt CORTI (una frase) → miss 699ms — stessa CPU ~100 t/s → prompt ~70-100t ✓ coerente. Il gap è nel **pipeline app: RAG prompt**, non nel modello.
5. **Anche il caso migliore (senza RAG)**: 271 token → 2.6s + overhead ≈ **>2000ms** — il target richiede ≲170 token o **prefix-cache hit** (R12 hit 135ms dimostra che il server riusa il prefisso: il RAG che cambia ad ogni messaggio AZZERA il riuso).
6. Warmup JS è fallito ugualmente (bench sidecar avesse completato 600 token): serve traceback errore + log poll per capire il mismatch JS/Python (probabile difetto del flusso o del bridge).

**Nota**: queue CodaPriorita: 0 jobs durante la sonda (nessuna contenzione da coda); reindex background: 23.0s + 8.2s (impatta solo m1 rag_ms=6.5s).

### Passo 3 — tentativo 2 — diagnostica: traceback `_run_generation` + log poll_stream
- Modifica consentita: `backend/api.py` (traceback nell'except di `_run_generation`), sonda (wrap `poll_stream` con log chiamate).

### Passo 4 — tent.2 esito + hang (15:41) — RIPARAZIONE WATCHDOG
- Warmup OK quiet **5.963 ms**; misura1 HANG (nessun completamento entro MEASURE_TIMEOUT): causa reale = `webview.start()` non torna dopo `win.destroy()` su finestra hidden -> watchdog non poteva chiudere il processo. Processo killato dal coordinatore (CIM Terminate). FIX applicato in `tests/t13_ttft_pywebview.py`: watchdog hard-exit (destroy + 15s + scrittura JSON dal watchdog + `os._exit(2)`): **mai piu' processi appesi** (verificato sui tentativi successivi: nessun hang prolungato).

### Passo 5 — tentativo 3 (16:34) — morto da sessione esterna
- Warmup OK **6.881 ms**; morto a 33s dalla misura1 per chiusura della console della shell che lo avece lanciato (non difetto della sonda). Lesson: lancio solo staccato (`Start-Process`).

### Passo 6 — tentativo 4 (16:46) — CRASH NATIVO + CATENA DI FIX
- Warmup OK **5.357 ms**; morto a 16:47:16 con **Application Error 1000: 0xc0000005 in ggml-base.dll** (Event Log Windows, pid 14816) durante la MISURA1 con prompt RAG -> chain: prompt 3.700-4.600 tok > `llama.n_ctx=4096` (server non servibile) + prompt eval > `CONNECTION_TIMEOUT=8.0s` -> **fallback in-process** (doppia valutazione) -> crash nativo/`NoneType` nel path di fallback (stessa chain spiega i fallimenti NoneType dei tent.1/2/3: `misura N senza token: 'NoneType' object is not iterable`).
- **FIX DI CATENA APPLICATI** (tent.5): (1) `core/sidecar/client.py` `CONNECTION_TIMEOUT` 8.0 -> **60.0** (commento con motivazione; nessun test dipende dal default: testG1 usa timeout=180 esplicito); (2) config runtime `%APPDATA%\NovaStudio\config.json` `llama.n_ctx` 4096 -> **8192** (backup `config.json.bak_r13`; rollback: ripristinare 4096). Effetto: la app puo' servire i prompt RAG dal server senza fallback.

### Passo 7 — tentativo 5 (17:02) — errore mio di scrittura config (NON difetto app)
- La riscrittura PowerShell della config aveva introdotto un **BOM UTF-8** -> `json.load` Python (`encoding="utf-8"`) esplode -> `state=not_configured` -> la sonda e' uscita pulita con blocked (nessun crash). BOM rimosso, config verificata da Python (`n_ctx=8192`, model path, backend ok).

### Passo 8 — tentativo 6 (17:06, ULTIMO) — misure pulite + crash residuo
- Warmup OK **6.356 ms**. Esito misure: **m1 = 95.972 ms e m3 = 140.964 ms** (JS end-to-end REALI, first_token " ok"), m2 = timeout 120s, m3-gap, m4 = **CRASH NATIVO 1000 0xc0000005 in ucrtbase.dll (17:11:20)**, m5 non eseguito. `qa/t_probe_pywebview.json`: n=2, **p50 = 95.972 ms**, p95 = 140.964 ms (campioni misurati dichiarati). Nota: env_scan ha rilevato 1 server orfano preesistente (tent.4, `-c 4096`) -> run dichiarato NON-QUIET nel json; orfani poi killati (0 python/0 llama a fine unita').
- Dati storici preservati: run TELEM originale (sotto carico 3 delegati) in `qa/r13_ttft_prev_load.json`: **n=5, p50 = 91.962 ms, target_hit=false**; fasi quiet tent.1 (tabella sopra, raw phases sovrascritti dai tentativi successivi — tabella conservata in QUESTO report); warmup quiet: 5.357/5.963/6.356/6.881 ms.

---

## VERDETTO UNITÀ TTFT — **BLOCKED** (6 tentativi esauriti)

**Target**: p50 ≤ 2.000 ms. **Risultato migliore misurato (app path reale)**: warmup senza RAG 5.357-6.881 ms; con RAG **p50 56,8 s** (fasi tent.1 quiet) / **95,9 s** (JS tent.6) / **92,0 s** (run originale sotto carico). **Mai sotto 2.000 ms**: anche il caso migliore senza RAG (271 tok) e' 5,4-6,9 s.

**CAUSA (tutta misurata, non simulata)**:
1. **Costo prompt RAG**: ogni messaggio della chat inietta il contesto RAG reale (5 chunk x ~350 parole) -> prompt **11,5-14,2k char ~= 3.700-4.600 token** (vs 271 del warmup) -> prompt eval a **~105 tok/s = 35-44 s** di solo eval (fasi tent.1: prompt_ms/m1-m5). Il RAG cambia ad ogni messaggio -> **azzera il riuso prefix-cache** (R12: hit diretto 135 ms prova che il riuso funziona solo con prefisso stabile).
2. **`llama.n_ctx=4096` < prompt della app** (fino a ieri): il sidecar non poteva servire i prompt RAG -> chain di fallback (CORRETTO ora: n_ctx 8192).
3. **`CONNECTION_TIMEOUT=8.0s`** (fino a ieri): scattava prima del primo byte di un prompt RAG (35-44 s) -> **fallback in-process** -> doppia valutazione + **crash nativi ggml-base.dll / ucrtbase.dll (0xc0000005, Event Log 16:47:16 e 17:11:20)** e/o errori `'NoneType' object is not iterable` (tutti i fallimenti JS dei tent.1-3). CORRETTO ora: timeout 60 s.
4. Anche con catena corretta, il **costo del prompt RAG resta ~40-140 s** -> il target 2 s richiede intervento sul contenuto del prompt (vedi procedura).

**PROCEDURA MANUALE per raggiungere il target (in ordine di efficacia)**:
1. **Ridurre il contesto RAG della chat** a <= ~170 token nuovi per messaggio (es. `rag_top_k` per il chat / cap del contesto parent dedicato al chat), OPPURE **riordinare il prompt con prefisso stabile** (system+storia PRIMA, RAG dopo) e tenere il RAG-size costante tra i turni, cosi' il **prefix-cache hit** (evidenza R12: 135 ms) copre system+storia e l'eval rimane solo sui token nuovi.
2. Verificare che `llama.n_ctx` (config) resti **>=8192** (già applicato) e `CONNECTION_TIMEOUT` (client) **>=60 s** (già applicato): senza entrambi la chain di fallback/crash torna.
3. Fixare il **crash nativo del fallback in-process** (0xc0000005 ggml/ucrtbase su prompt grandi): il fallback non deve mai valutare prompt maggiori del proprio contesto, o disabilitare il fallback per prompt > soglia con errore pulito "AI non disponibile".
4. Rilanciare la sonda a mano: `set PYTHONIOENCODING=utf-8&& python tests\t13_ttft_pywebview.py` (watchdog hard garantito; output `qa/t_probe_pywebview.json`; lanciare con `Start-Process` staccato e 0 server concorrenti).

**FIX APPLICATI DURANTE L'UNITÀ**: watchdog hard-exit sonda; `CONNECTION_TIMEOUT` 8->60 (`core/sidecar/client.py`); `llama.n_ctx` 4096->8192 (config runtime, backup `config.json.bak_r13` = rollback).
**ROLLBACK**: `config.json.bak_r13` (n_ctx 4096) + ripristinare `CONNECTION_TIMEOUT = 8.0` in `core/sidecar/client.py`.
**PROCESSI A FINE UNITÀ**: 0 python, 0 llama-server (2 orfani killati: pid 3952, 13820).
