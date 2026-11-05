# R22 — Modelli (pro/base): report

Data: 2026-10-30 · Scope BE-MODELS · Round 22

## 1. Quant scelto e motivo

- **Quant: Q4_K_M unico disponibile** per Spark-X2.6-4B-GGUF: nel repo HF
  `XHToken/Spark-X2.6-4B-GGUF` l'unica build Q4 pubblicata è
  `Spark-X2.6-4B-Q4_K_M.gguf` (nessuna variante Q4 alternativa).
- **Fonte checksum: API Hugging Face** — la model card (README) NON espone
  lo SHA256 nel testo: il valore è letto da
  `https://huggingface.co/api/models/XHToken/Spark-X2.6-4B-GGUF?blobs=true`
  → campo `lfs.sha256`.

## 2. Download

| Voce | Valore |
|---|---|
| URL | `https://huggingface.co/XHToken/Spark-X2.6-4B-GGUF/resolve/main/Spark-X2.6-4B-Q4_K_M.gguf` |
| Destinazione | `tools/models/spark-x2.6-4b.gguf` |
| sha256 atteso (API HF) | `91cb2811aebb47ac916aa619d27d4cdd7f4143106b7917accb8ead4cd7f5cbd9` |
| sha256 ottenuto | identico → **MATCH** |
| size | 3.543.441.312 byte (~3.30 GiB) |
| Tempo download | parti 16:42 → file finale 17:11 ≈ **29 min** (~2.0 MB/s) |
| Checksum su disco | `tools/models/checksum.txt` (sha256, fonte, size, url, verified_at, `verification=MATCH`) |

Rete usata **solo** per Hugging Face (nessun altro host).

## 3. Interfaccia

- Ordine dropdown: **pro prima, base dopo**
  (`data/models_manager.py` → `MODELS_CATALOG` ordine `['pro','base']`).
- Etichette: "Modello pro (Spark-X2.6-4B)" / "Modello base (MiniCPM5-2B)".
- Voce non scaricata: etichetta **"Scarica… (~3.3 GB)"** (size_bytes dichiarato).
- Screenshot: `qa/r22_models_dropdown.png`, `qa/r22_models_dropdown_download.png`
  (dati in `qa/r22_models_measures.json`, `ok_order: true`, `download_label_ok: true`).

## 4. 4.4 — Switch base→pro con stato "caricamento"

- `backend/api.py:470-505` `load_model(key)`: scrive `local_model_path`,
  `local_model_key`, **`llama.model_path`** (chiave letta dal sidecar) e
  salva la config → imposta `_model_state = loading` + `model_key` +
  `rss_before_mb`, poi `_prepare_llm_client()` + avvio load in background.
- Riavvio sidecar: `core/sidecar/server.py:206-242` — a ogni
  `start_on_demand()` confronta `llama.model_path` con `_launched_model`
  (impostato a riga 316 con il `-m` effettivo); diverso → stop controllato
  del processo e relaunch col nuovo modello.
- Stato UI: `backend/api.py:456-457` (flag `loading` in `list_models`),
  `backend/api.py:425-437` (`get_model_status` espone `state/model_key/
  rss_before_mb/rss_after_mb`), label JS
  `web_frontend/html/index.html:1207-1218` → **"caricamento modello pro… N%"**.
- **Misurato sul vero sidecar**: switch base→pro **4.01 s** (RSS server
  2419 → 4436 MB), switch pro→base **3.07 s** (4471 → 2408 MB).

## 5. 4.5 — Fallback automatico al base

- `backend/api.py:507-541` `_watch_model_load`: dopo il load, se `state ==
  error` e la richiesta NON era `base` → `apply_fallback_config()`
  (`data/models_manager.py`) che ripristina `local_model_path`,
  `llama.model_path`, `local_model_key=base`, salva la config ed emette
  **`[models] fallback al modello base: <motivo>`**; se il base non esiste →
  log "NON ESEGUIBILE" senza rompere lo stato.
- Coperto da `tests/testR22_models.py::TestFallbackBase` (config ripristinata
  + log esatto) — eseguiti, **25/25 OK**.

## 6. 4.6 — Override sampling pro (solo "fast")

- Valori card: **temp 1.0, top_p 0.95, top_k -1, repetition_penalty 1**
  (`core/sidecar/profiles.py:61-66` `PRO_SAMPLING_OVERRIDE`; applicazione
  `apply_model_sampling` solo se `model_key=='pro' and profile=='fast'`).
- Iniettato nel body di `/completion` e `/v1/chat/completions` in
  `core/sidecar/client.py:359` (calcolo) e `383-399` / `454-471` (body).
- Verificato in esecuzione: pro+fast → `{temp:1.0, top_p:0.95, top_k:-1,
  repetition_penalty:1.0}`; **base invariato** (`temp 0.8`, nessun top_k);
  pro+tool invariato (`temp 0.1`, `json_mode`); pro+think invariato.

## 7. 4.6 — Guardia RAM draft

- Budget dichiarato **6144 MB (6 GB)**: `core/sidecar/client.py:210`
  `SidecarClient.DRAFT_RAM_BUDGET_MB`, controllo in `_draft_within_budget()`
  (righe 227-254) chiamato da `want_draft()` (righe 198-203).
- RSS reale pro misurato: **4471 MB → sotto budget** (draft consentito se
  configurato; di default `spec.draft_model=""` → draft già spento dalle
  regole R13). Log reale verificato abbassando il budget a runtime:
  `[models] draft disattivato: budget RAM superato (RSS 4471 MB > 1 MB,
  modello pro attivo)`.
- Unit test: `test_draft_disattivato_budget_superato`, `test_draft_ok_sotto_budget`,
  `test_base_non_bloccato`, `test_budget_dichiarato_6gb` → OK.

## 8. Misure reali (sidecar `tools/llama-server.exe`, n_ctx 4096)

| Modello | RSS server | tok/s (64 token, fast) | prompt tok/s | Note |
|---|---|---|---|---|
| base (MiniCPM5-2B-Q4) | 2408 MB | **13.2** (13.17 / 13.19) | 52–92 | prima e dopo lo switch: identico |
| pro (Spark-X2.6-4B-Q4) | **4471 MB** | **6.1** (6.14 / 6.20) | 35–45 | 2 completion |

Switch: base→pro 4.01 s (RSS 2419→4436 MB), pro→base 3.07 s
(4471→2408 MB). Dati grezzi: `qa/r22_models_real.json` +
`qa/r22_models_measures.json` (chiavi `real_*`).

**Leak chat template**: completion chat col pro (64 token) → testo pulito,
marker assenti: `{{`, `{%`, `{#`, ```` ```jinja ````, `<|im_start|>`,
`<|assistant|>`, `<|user|>` → `leaks: []`. Costruzione prompt: i messages
vanno a `/v1/chat/completions` con template applicato dal server GGUF
(`core/sidecar/client.py:365-372`); il path legacy usa solo
"User:/Assistant:" (`client.py:101-119`) — nessun jinja inviato come testo.

## 9. Test eseguiti

- **Nuovi** `python -m unittest tests.testR22_models` → **25/25 OK**.
- **Regressione sidecar**: `testG1_sidecar testH2_server testR13_spec_draft
  testH5_flags testH3_prefix` → **39 test, 1 FAIL**
  (`testG1.TestSidecarReale.test_a_avvio_reale_e_3_completion`,
  "completion 3 vuota"): **flaky confermato** — run singola OK, poi FAIL,
  poi OK, poi FAIL. La path R22 sul base è un no-op (body identico,
  `apply_model_sampling('base')` invariato) → non attribuibile a R22.
- **Extra** `testG4_stream testG6_hygiene testH2_queue testR15_gate` →
  39 test, 1 FAIL: `testR15_gate.test_runtime_config` (atteso 0.70,
  **config utente** `%APPDATA%/NovaStudio/config.json` ha
  `gate.threshold=0.75`, mtime 30/10 **16:08**, prima di questa sessione;
  `DEFAULT_CONFIG` resta 0.70 e `test_default_tarato` passa) → drift
  ambiente/altro delegato, **non R22** (R22 non scrive chiavi `gate.*`).
- BUILD: `python -m py_compile` su `data/models_manager.py`,
  `data/config_manager.py`, `backend/api.py`, `core/sidecar/*.py`,
  `core/local_llm_client.py`, `tests/testR22_models.py` → **OK**.

## 10. Cosa resta aperto

1. `testG1` "completion 3 vuota" flaky (prevalente in run di batch):
   da stabilizzare con retry/seed, non è una regressione R22.
2. `testR15_gate.test_runtime_config` → riportare `gate.threshold` a 0.70
   nel config utente (o confermare il tarato 0.75 e aggiornare il test) —
   decisione del delegato R15/G, fuori scope BE-MODELS.
3. Le misure tok/s sono CPU-only (n_gpu_layers=-1): se HW diverso, ripetere.
4. Il pro con `repetition_penalty 1` (valore di card) produce ripetizioni
   in prompt brevi: comportamento voluto dalla card, non corretto qui.
