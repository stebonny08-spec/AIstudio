# QA Report — Round 15b · Blocco W (IMPLEMENTER-WEB)

**Stato**: ✅ COMPLETATO (W1–W5 + T2; nessun BLOCKED)
**Data**: 2026-10-24 · **Owner**: Subagent 20261024_13 (W)
**BUILD**: `QA_TS = 2026-10-24T17:30:00+02:00` (letto dinicamente; **nessun bump** — coordinatore)
**File owner modificati/creati**: `core/web_search.py` (W1), `core/rag/web_stage.py` (NUOVO, W2/W4),
`core/rag/chunker.py` (+`meta`), `web_frontend/html/index.html` (W5), `tests/testR15_web.py` (NUOVO),
`qa_ui/r15.html` (NUOVO), `qa_browser/qaR15_web.js` (NUOVO), output `qa/r15_web_*.{json,png}`,
`qa/r15_web_netlog.json`, questo report. `chatbot.js` **non toccato** (non servito).
**Non toccati (vincolo)**: contract.py, api.py, config_manager.py (solo lettura), vector_store*,
indexer, router/local_search/semantic_router/embedder/answer_cache, gate/local_llm_client,
altri moduli FE, tests esistenti, MODIFICHE/NOTE, metrics_history (mtime invariata), run_t1.

---

## 0. RETE DICHIARATA (protocollo esplicito)

**Cosa ho chiamato io** (nessun LLM cloud; solo documenti/interrogazioni di indice web;
ogni chiamata loggata con **url + ms** in `NET_LOG` → dump `qa/r15_web_netlog.json`,
stampe runtime `[web_search][RETE]` / `[web_stage][RETE]` / `[RETE DICHIARATA]` nei log test):

| provider | endpoint/query dichiarato | ms osservati (run) | ok | scopo test |
|---|---|---|---|---|
| ddgs | `ddgs://text?q=fotosintesi clorofilliana (site:… batch 6 domini)` ×1–4 batch | 1059–2685 ms/batch | ✓ (n=0–3) | **1 query ddgs REALE** (W1 fallback) |
| ddgs | `ddgs://text?q=fotosintesi clorofilliana` (generico, no site:) | 640–1139 ms | ✓ n=3 | fill a k dopo trusted vuoti |
| wikipedia | `https://en.wikipedia.org/w/rest.php/v1/search/page?…` | 503–664 ms | ✓ n=0 | titoli [en] dichiarata |
| wikipedia | `https://it.wikipedia.org/w/rest.php/v1/search/page?…` | 526–714 ms | ✓ n=3 | titoli [it] dichiarata |
| wikipedia | `https://it.wikipedia.org/api/rest_v1/page/summary/Fotosintesi_clorofilliana` | 284–527 ms | ✓ n=1 | summary [it] dichiarata |
| fetch | `GET https://example.com` (timeout 10s dichiarato) | 271–389 ms | ✓ 200 | 1 doc reale readability + HIT cache |
| HF (indiretta) | HEAD/GET `huggingface.co/api/...intfloat/multilingual-e5-small` | ~15 req | ✓ | **pre-esistente** di `tests/t13_ttft_pywebview.py` (lanciato da me per non-regressione; modello locale in cache, **nessun download**) |

- **SearXNG**: `web.searxng_url=""` → **0 chiamate** nel run di test (assertato sul log, "skip dichiarato").
- **Wikipedia off**: `wikipedia=False` → **0 chiamate** (assertato sul log).
- **`web.mode='mai'`**: `escalate(..., 'mai')` → `[]` con **NET_LOG vuoto** (assertato: zero rete).
- **Nessuna pip aggiunta**; solo `requests`, `ddgs` (già in requirements) + stdlib.
- **Nessuna chiamata LLM al cloud**: il web restituisce solo documenti; risposta = modello locale (fuori perimetro W).

Dump consolidato: `qa/r15_web_netlog.json` (accumula `all_calls` tra i run; max 200).

---

## 1. W1 — provider con fallback ✅

`core/web_search.py` riscritto (API storica `search_web(query, max_results)` invariata per router.py):

Catena (si ferma a k risultati; **mai eccezioni** al chiamante, lista vuota/parziale):
1. **ddgs trusted** (`site:` batch da 6 domini, `core/trusted_sources.py`, **timeout 10 s/batch**) — priorità qualità;
2. **ddgs generico** (stesso ddgs, senza `site:`) finché non si ha k;
3. **SearXNG self-hosted OPZIONALE** (`web.searxng_url` ≠ "": `GET {base}/search?q=..&format=json`, stesso formato `url/title/content`) — solo se ancora < k;
4. **Wikipedia REST OPZIONALE** (`web.wikipedia`): 1) titoli `w/rest.php/v1/search/page`, 2) summary `api/rest_v1/page/summary`; **lingua dichiarata per chiamata** `[it]/[en]` (euristica query → prova it/en in ordine, fallback incrociato).

Evidenze (test1 + stdout): 1ª run di prova → 4 batch trusted con 0 risultati ("No results found" **normalizzato come esito ok**, non errore) → **fill generico a 3/3**; run finale → 1° batch trusted già n=3 (early-stop). Log `ms` su **ogni** chiamata. Config lette (`web.searxng_url`, `web.wikipedia`) da ConfigManager **in sola lettura** (cache interna + `reset_config_cache()` per i test).

## 2. W2 — pipeline indicizzazione web ✅

`core/rag/web_stage.py` (NUOVO):
- **fetch** `requests` **timeout 10 s** dichiarato, User-Agent dedicato; doc vuoti saltati, mai eccezioni.
- **readability-lite** (TUO, solo stdlib `re`/`html`, ≤**4000 char/doc**). Euristica documentata nel docstring:
  1) via `<script/style/noscript/template/svg/head>` + commenti; 2) se esiste `<article>/<main>` → contenitore **più lungo**; 3) altrimenti blocchi `<h1..h6>` **sempre** + `<p/li/blockquote/pre>` **solo ≥40 char** (scarta nav/menu corti); 4) fallback body intero; 5) strip tag + unescape + collasso spazi; 6) troncatura su confine parola + `…`. Titolo: `<h1>` → `<title>` → fallback.
- **Cache URL persistente** in AppData: `%APPDATA%/NovaStudio/web_cache/` = `cache.json` (indice) + `texts/<sha1>.txt`; **TTL `web.cache_ttl_days` (7)** con **clock iniettato** (`WebCache(now=...)`); `get()` su scaduto → miss + purge. **HIT = zero rete** verificato: refetch dello stesso URL con `fetch_docs` → `from_cache=True` e **0 entry** in `NET_LOG` (assertato).
- **Indicizzazione**: `build_web_chunks`/`index_web(docs, store, embedder)` → `Chunk(meta={"stage":"web","url","title","date"})` (campo `meta` NUOVO in `Chunk`, **backward-compat**: costruttori storici intatti, `chunk_text` → `meta=None`) → **embedder in SOLO LETTURA** (`embedder.embed(..., kind="passage")`; P passerà `local_search.embedder`) → **`vector_store.add_chunks`** (pubblico; non ho toccato vector_store*).
- **FTS ✅ verificato su temp store** (sqlite temp + embedder finto): `SELECT count(*) FROM chunks_fts` > 0 (trigger `chunks_ai` popola FTS), `store.fts_query("fotosintesi clorofilliana")` trova il chunk con `source_file=url`. **Nessun salto necessario** (FTS assente → skip con avviso era previsto, non servito).
- **SEGNALAMENTO per I (risolto in parallelo)**: al primo test `add_chunks` **non mergiava** `chunk.meta` nel JSON `meta` (costruiva meta dai soli campi Chunk) → `meta.stage` non persistito in DB. **Workaround attivo dal W**: `source_file = URL`, `location_hint = titolo` (entrambi persistiti: colonne/JSON). Durante il blocco **I ha aggiunto** `meta = dict(getattr(chunk, "meta", None) or {})` (`vector_store_sqlite.py:599`): rilancio del test → **`meta.stage='web'` presente nel DB** ✅ (la stampa `[SEGNALAMENTO per I]` non compare più). Conferma comunque documentata nel test.

## 3. W3 — fusione a 3 stadi: tagging + fornitura items + render ✅

- **Tagging**: `meta.stage` su ogni chunk web (su indicizzazione) — pesi RRF `web.weight_*` **non toccati** (P), `local_search/router` **non toccati**.
- **Fornitura items**: `web_stage.web_sources(docs)` → `[{"stage":"web","title","url","source":"web"}]` (stessa forma di `poll_stream.sources`) — per P.
- **Citazioni**: `meta.title`/`meta.url` corretti; convenzione robusta `source_file=url`, `location_hint=title` (testata su DB).
- **Render UI (mio)**: `renderSourceBadges(container, sources)` in `index.html` — badge **locale/libri/web** (mappa: `appunti→locale`, `libri→libri`, `web→web`), titolo + `<a href target=_blank>`; chiamata da `finalizeStreamingBubble(refs, text, source, sources)` (4° parametro **opzionale**, backward-compat) sui `p.sources` del poll.

## 4. W4 — escalation ✅

`web_stage.escalate(query, gate_outcome="", mode=None, top_k=5) -> list[WebResult]`:
- **`mai` → `[]` SUBITO, ZERO rete** (assertato con NET_LOG vuoto);
- **`auto` → solo `parziale`/`nulla`** (`'piena'` → no; `''` gate non determinato → trattato come parziale, **dichiarato**);
- **`sempre` → sempre**; `mode=None` → legge config `web.mode`;
- decisione **prima** di ogni chiamata → **niente 2ª chiamata LLM locale sprecata** se `mai`/`piena` in auto (la decide il gate/pipe P; fornisco la funzione);
- logica testata con `search_web` **patchato** (zero rete nei test di decisione) + casi `mai`/`piena` reali vuoti.
- **Override per query**: `send_message(..., web_override)` già in api.py → la UI passa `getWebOverride()` (W5.4); cablato in produzione (marker verificato T2 W6d).

## 5. W5 — UI minima in `index.html` ✅

1. **`#settingsModal`** (`.settings-item` + stili esistenti, nessun restyling): **Ricerca web** select `auto/sempre/mai`; **Soglia gate** slider+number **0.05–0.90** (value letta da `app_settings_get("gate.threshold")`, salvataggio su `change`; semantica/GT di G); **SearXNG URL** testo; **Wikipedia** on/off; **Nota privacy** esatta: *"Quando il web è attivo (Auto/Sempre), le tue query di ricerca vengono inviate a DuckDuckGo/SearXNG/Wikipedia: nessun LLM cloud, i documenti tornano qui e il modello locale risponde in locale. Disattiva con Mai."* → letture/scritture via **`app_settings_get/set`** (API congelate in api.py, solo chiavi contratto).
2. **Avanzamento per stadio** nel loop `poll_stream` (~riga 1575): gestione `p.progress` con **dedup per lunghezza crescente** (`refs._progLen`, reset a ogni `startPolling`) → `renderStreamProgress` scrive in `<div class="streaming-spinner stage-progress">` (elemento **compatibile** con `.streaming-spinner`: stessa classe + override minimo; spinner originale resta).
3. **Fonti con badge stadio**: `p.sources` a `done`/errore → badge+titolo+sotto la risposta.
4. **Toggle web per query**: chip `#webToggleChip` nell'`input-row` accanto all'input → cicla auto→sempre→mai, **default = `web.mode`** (sincronizzato al load delle settings) → passato a `send_message(..., getWebOverride())`.
- Wiring: `loadWebSettings()` all'apertura gear + al boot dopo `waitForApi()`; listener `change` idempotenti (`_wiredR15`) dentro `wireWebSettingsControls`.
- **Smoke prod reale** (Chromium, index.html SENZA pywebview): `window.__jsErrors=[]`, chip `Web: auto`, options `auto,sempre,mai`, privacy ok, `getWebOverride()='auto'`; unici console.error = `pollModelStatus` pre-esistenti (fuori perimetro W).

## 6. T2 — harness browser reale ✅

- **`qa_ui/r15.html`**: estrae **a runtime dal VERO index.html** (file:// dichiarato): blocchi `<style>` (CSS produzione → geometria reale), markup `#settingsModal` + `.input-row`, e il **corpo identico** di 11 funzioni di produzione (`createStreamingBubble`, `renderStreamProgress`, `renderSourceBadges`, `loadWebSettings`, `saveWebSetting`, `applyWebSettingsToUI`, `wireWebSettingsControls`, `setWebOverrideChip`, `syncWebToggleChip`, `cycleWebOverride`, `getWebOverride`) — "inline stream SOI-estratto". **Stub DICHIARATO** `pywebview.api`: `app_settings_get/set` in-memory, `send_message` (registra `web_override`), `poll_stream` con **progress 3 stadi crescenti + sources realistici** (contratto P). Handshake `__QA.needShot`/`__qaCheck`.
- **`qa_browser/qaR15_web.js`**: BUILD letto **dinamicamente** (`var QA_TS`, nessun bump; `?v=` coerenti 1/1), protocollo qaD (shot/`pushCheck`). Output **`qa/r15_web_measures.json`**.
- **Esito: 13/13 check OK** — W1 settings rows presenti (rect>0, options, privacy) · W2 salvataggio via stub (`web.mode=sempre`, `gate.threshold=0.60` **numero**, url, wiki=false; chip sincronizzato) · W3 progress render 3 stadi (testo `appunti... ok . libri... ok . web...`, dedup stabile, rect 170×21) · W4 badge fonti (3 badge `locale,libri/web`, href https + `_blank`) · W5 toggle (default=web.mode, ciclo completo, `web_override` registrato, rect 104×36) · W6a–h marker di wiring produzione (poll progress, sources→finalize, `getWebOverride()` in send_message, listener chip, boot/gear `loadWebSettings`, app_settings, reset `_progLen`).
- **Screenshot** (misure geometriche reali): `qa/r15_web_settings.png`, `qa/r15_web_progress.png`, `qa/r15_web_sources.png`, `qa/r15_web_toggle.png`.

## 7. Test python ✅

**`tests/testR15_web.py` — Ran 15 tests, OK (15/15)**, `python tests/testR15_web.py`, exit 0:
1 provider ddgs REALE + searxng vuoto→skip + wiki off→0 chiamate · 2 wiki on→chiamate reali dichiarate (lingua nel log) · 3 readability fixture locale · 4 troncatura ≤4000+`…` e fallback · 5 fetch reale opzionale + HIT cache senza rete · 6-7 cache TTL logica pura con clock iniettato (+purge) · 8-10 `Chunk.meta` backward-compat (costruttore storico/nuovo/`chunk_text`) · 11-13 `escalate` (mai=0 rete, piena+auto=0 rete, decision matrix con search patchato) · 14 indicizzazione temp store + **SELECT chunks_fts** + meta DB + `web_sources` · 15 noop vuoto.
Dump rete consolidato in `qa/r15_web_netlog.json` (`tearDownModule`, merge cross-run).

## 8. Non-regressione (T1)

- **`tests/testC_rag.py` → 21/21 OK** (chunker compat). *Nota*: al primo lancio 4 ERROR `Indexer._reconcile_indexed_row` assente = **edit in corso di I** su `indexer.py` (file VIETATO per W); rilancio a edit concluso → verde. Nessuna mia influenza.
- `run_t1` è nella lista **VIETATO** → **non eseguito**; baseline ufficiale intonsa. Impatto atteso sul prossimo run del coordinatore: **2146 + 15 nuovi test testR15_web = ~2161 passati / 0 falliti** (nessuna suite esistente modificata).
- Suite T1 esistenti che leggono `index.html` (regressione indiretta): `editorWiring.test.js` **49/0** · `qaD_home.js` **41/41** · `testG8_metrics.py` **6/6** · `t13_ttft_pywebview.py` **exit 0** (probe "blocked sidecar" = suo stato pre-esistente). `metrics_history.json` e `t1_r13.json` **non scritti** (mtime invariati).
- Sintassi JS: 3/3 inline script di `index.html` passano `node --check`.

## 9. Convenzioni per P / I / G (lettura per gli altri blocchi)

- **Chunk web**: `meta={"stage":"web","url","title","date"}` + `source_file = URL` + `location_hint = titolo`.
- **API per P**: `web_stage.escalate(query, gate_outcome, mode, top_k)`; `fetch_docs(results, cache)`; `index_web(docs, store, embedder)` (embedder = `local_search.embedder`, sola lettura); `web_sources(docs)` per `poll_stream.sources`.
- **UI già pronta** a rendere ciò che P emette: `progress=[{stage,status,ms,note}]`, `sources=[{stage,title,url,source}]`, `web_override` da `send_message`.

## 10. Limiti / BLOCKED

- **BLOCKED: nessuno** (0 unità oltre i 6 tentativi).
- Limiti noti dichiarati: (a) SearXNG validato solo sullo **skip** (`url=""` → 0 chiamate) e sul formato atteso — nessun server SearXNG disponibile per un test live; (b) euristica lingua Wikipedia: query IT senza stopwords/accenti (es. "fotosintesi clorofilliana") prova prima `en` (0 risultati) → poi `it` (costo: 1 chiamata extra, dichiarata); (c) ddgs trusted può restituire 0 risultati (query di nicchia) → fallback generico dimostrato; (d) harness T2 estrae le funzioni dal source di produzione — il **wiring eventi completo** (click sul gear, click sul chip) è verificato via marker sull'source reale + smoke prod, non da un E2E pywebview reale (fuori perimetro T2); (e) test rete: se la rete cade, i test si **saltano con avviso dichiarato** (mai FAIL).
