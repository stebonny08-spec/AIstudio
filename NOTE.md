# NOTE — differenze, funzioni rimandate, ottimizzazioni non implementate

Questo file raccoglie ciò che **non è stato implementato di proposito**,
eventuali limiti noti e le ottimizzazioni individuate ma **lasciate intatte**.

> **Round 2** (cartelle, materia in maiuscolo, home senza hamburger, retrieval
> per argomento, quaderno/lazo/gomma, stile tipi schemi, bottoni centrati
> rimossi, biblioteca per cartelle): riepilogo in `MODIFICHE.md`.
> Aggiunte di questo round sotto, nella sezione "Funzioni rimandate".

## Round 27 (P1-bis) - Acceleratori: scelte dichiarate e aperture

Riepilogo in `MODIFICHE.md` (Round 27); report completo in `qa/p1b_report.md`.

### Scelte dichiarate
- **n-gram ON SOLO long-form** (config spec.ngram_longform): il flag entra in want_draft
 solo dalla CONFIG REALE (gli override `spec` dei test R13/R22 non lo contengono ->
 comportamento storico invariato). Micro/standard restano OFF (regola).
- **mai entrambi gli acceleratori speculativi**: con n-gram ON il draft Spark resta OFF
 (spec.draft_model vuoto; argv senza --model-draft, testato).
- **usearch**: copia di query sola; le scale1k/10k/50k usano vettori random SOLO per la
 latenza (corpus reale =17 vettori dim384); il recall e' misurato solo sul GT reale.
- **HyDE**: auto_start=False e' una scelta di progetto (HyDE non avvia/ricarica il server) ->
 con sidecar non disponibile = fallback completo; con sidecar up il costo reale misurato e'
 **>=8010ms >>150ms**. Entrambi i rammisurati, entrambi portano a OFF.
- **rerank**: modello reale543MB int8 (Samir-j/bge-reranker-v2-m3-onnx) scaricato e
 funzionante (score ordering ok) ma p95 ~25.9s/query su CPU e MRR peggiorato -> OFF.

### Aperture
1. **TTFT RAG <=2000ms**: **MANCATO** - qa/p1b_ttft.json p50 **34699ms** / p95 52439ms
   (n=5, metodo R16 identico) con usearch ON + n-gram long-form attivo e tecniche RAG OFF.
   Stato BLOCKED R13/R16 invariato; il dominante (LLM+web+depth-check fino a28.9s) non e'
   attaccato da nessun acceleratore di questo round.
2. Il GT ha9 positivi: la soglia +0.03 e' risolta come +1 query (+0.111) - dichiarata la
   granularita'; nessun tecniche ha guadagnato anche solo1 query.
3. Le4 varianti n-gram non sono state sweepate oltre D{3,5,8} (26 run): il D ottimale
   per la qualita del long-form potrebbe essere intermedio - il vincolo era speedup>=1.30,
   superato con ampio margine a D5.
4. Le decompose/CrAG con set GT piccolo non sono sensibili (query poco composita): un
   A/B su un GT piu ampio potrebbe cambiare l'esito - con numeri attuali restano OFF.
## Round 26 (PROMPT ROUND 24/25) - Evidenza solo su app reale: scelte, dichiarazioni, aperture

Riepilogo in `MODIFICHE.md` (Round 26); report completo in `qa/r25_report.md`;
riproduzione in `qa/r25_v0_table.txt`/`qa/r25_v0_measures.json`; matrice in
`qa/r25_matrix_measures.json` (33/33) con19 screenshot `qa/r25_matrix_*.png`.

### Scelte dichiarate
- **Evidenza**: T2 solo su index.html servito via http con catena `?v=` del BUILD;
  puppeteer/CDP (playwright non nel progetto); patch ambiente `listSubjects`1500ms SOLO senza
  pywebview (documentata dai round precedenti). Tutto cio' che e' stato chiuso con solo jsdom e'
  dichiarato PARZIALE nel report §6.
- **A8 in doc nuovo**: `_insideExisting` (nessun re-snap) scarta qualsiasi tratto che cada in
  una shape esistente: la cella zoom gira su nota nuova. NON e' un workaround del prodotto ma
  la condizione d'uso corretta; il comportamento 'tratto dentro una forma esistente -> resta
  stroke' e' di design (re-snap vietato).
- **Onde sinusoidali sistematiche vs V3.1**: la soglia1.5px nasce da jitter zero-mean ±2px
  (R22/R24); onde sistematiche danno ~2px strutturali. A2 usa jitter LCG ±2 (classe R22) e
  misura **1.2008px**; il caso onde resta informativo (come nel R24).
- **freeform: nessun assert residuo-vs-generatore** (informativo): V1.2 freeform = topologia
  preservata, non fit; b.2free di u22 logga1.91px (input±1.6).
- **RSS/budget**:6144MB resta il budget dichiarato (formula4471+1500=5971<6144); il testR22
  che lo fissa non e' toccato; il target≤3.6GB e' matematicamente irraggiungibile con ctx4096
  (floor4435.1 misurato).
- **2 aspettative u22 riscritte**: l'arco irregolare R22 ora e' freeform (V1.2 non-monotono) e
  la C sgangherata ora e' una curva APERTA classificata (mai forma chiusa): comportamento V1,
  nessun vincolo R22 violato (d.0: mai circle/line resta assert).

### Aperture (PARZIALE - vedi report §6)
1. geometria punta arrow su reale (ali°/ratio) non leggibile da `sizes`-> T1 u20/v1;
2. OFF->hold-still e undo2 non eseguiti con pointer reali (default ON confermato su reale);
3. R18 depth web ok=1/4 con pro Spark (streaming/encoding/guard verdi su4/4);
4. pywebview desktop non usato per i T2 (stessa dichiarazione R22-R24);
5. la persistenza `fp21_top_appunti` verificata su RELOAD ma non su riapertura modulo completo
   dopo chiusura app (fuori dallo schema del QA).
## Round 25 (PROMPT ROUND 23) - Lineup Spark: scelte, dichiarazioni e aperture

Riepilogo in `MODIFICHE.md` (sezione Round 25); misure in `qa/x1_build.json`,
`qa/x2_download.json`, `qa/x3_compare.json`, `qa/x3_draftbench.json`, `qa/x3_rssbase.json`,
`qa/x_qa1_switch.json`, `qa/x_qa2_slo.json`, `qa/r23_models_measures.json`, entry
`round 23` in `qa/metrics_history.json`.

### Scelte dichiarate
- **Draft 1.7B->4B = OFF di default**: regola X4.2 non soddisfatta (acceptance 0.8402 ok,
  speedup max 1.272x < 1.30x). `spec.draft_model` resta vuoto come da R13/R22 (baseline
  intatta). Per attivarlo in futuro: impostare `spec.draft_model` = path di
  `tools/models/spark-x2.6-1.7b.gguf` (il badge UI diventa ATTIVO, verificato).
- **Engine default = upstream** (regola X3.3, speedup xhtoken 1.240 < 1.30);
  `llama.engine=xhtoken` resta il flag manuale di debug (X3.4) che batte
  `llama.server_path`. Fork XHToken **14 stelle / 5 fork / 0 issues**
  (api.github.com 2026-10-31): rischio manutenzione **mitigato dal dual-engine con
  fallback upstream + MiniCPM5-2B** (kill-test 28/28).
- **Lineup Spark = backend sidecar obbligatorio**: llama-cpp-python 0.3.35 non supporta
  l'architettura Spark (`qa/_x_loadprobe.py`: ValueError `Failed to load model from file`).
  Con `llm.backend=inprocess` (rollback storico) Spark NON caricherebbe: con il fix
  R23 il caricamento passa dal sidecar reale. Upgradare llama-cpp-python per il
  supporto in-process = ottimizzazione rimandata.
- **Caricamento modello = sidecar**: `SidecarLLMProxy.load_model_blocking` non costruisce
  piu' `Llama()` in-process (cosi' funziona Spark e si evita il doppio caricamento
  in RAM). Effetto collaterale UI dichiarato: la barra progresso del load si basa sul
  RSS del PADRE (il modello ora vive nel figlio) -> il progresso resta basso e poi
  salta a 100% al ready. Miglioramento rimandato: campionare il RSS del figlio.
- **`minicpm5-1b`**: solo metadata nel catalogo (draft del fallback); non e' una voce di
  catalogo ne' scaricato. La sezione licenze in `index.html` (~riga 880) cita ancora solo
  'MiniCPM5-2B' (testo statico non toccato).
- **Log engine**: `[Sidecar] engine auto -> upstream (regola R23: ...)` viene stampato a
  ogni `start_on_demand` (una chiamata per completamento): verboso ma utile in diagnosi;
  deduplica rimandata.

### Aperture (cosa resta NON verificato / non fatto, e perche')
1. **QA-2 SLO non gira sullo Spark**: le misure TTFT (miss p50 998.5 / hit p50 94.8) sono
   sulla config REALE utente (modello MiniCPM5-2B, engine auto->upstream): e' la baseline
   di confronto diretto con R16/R18. Lo Spark e' validato da QA-1 (generazioni reali su
   tutti e 3 gli switch + fallback) e dal bench, non dai SLO TTFT. Misurare i SLO anche
   con Spark-base richiederebbe un secondo run switchato (non eseguito).
2. **TTFT e2e RAG end-to-end <=2000ms resta BLOCKED R13** (costo prompt RAG, vedi
   qa/qa_r13_ttft_report.md): invariato, fuori scope R23.
3. **Meta-suite T1 escluse: 6 fail legacy** (qaF pre-H11 x4, qaB1 baseline count x1,
   qaV 5.24 x1): escluse dalla baseline dal R11/R12, non toccate dai fix R23.
4. **Draft con motore upstream**: misurato solo per il confronto X3 (1.272x): l'app non
   lo abilita (vedi scelta OFF).
5. **Benchmark llama-bench = run singolo** per combinazione (protocollo H5 'una tantum');
   ±stima dichiarata nelle colonne degli errori di qa/x3_compare.json.
6. **`local_model_key` nella config utente e' assente/vuoto**: lo stato attivo e'
   dedotto da `local_model_path` (MiniCPM5-2B): dopo il QA-1 la config e' stata
   ripristinata esattamente allo snapshot iniziale (verificato nel log).
## Round 24 (PROMPT ROUND 23) - App reale, pannello sotto toolbar, perfezionamento al rilascio: scelte e aperto

Riepilogo in `MODIFICHE.md` (sezione Round 24); report dettagliati in
`qa/r24_{fonti,ink,church}_report.md` (reclamo R0: `qa/r24_r0_measures.json` + `qa/r24_r0_table.txt`).
Qui le scelte e ciò che resta aperto.

### Evidenza su app reale (regola del round)
- T2 = index.html servita via http con **stessa catena \`?v=\` del BUILD** (server static dentro
  ogni script T2), Chrome/CDP reale: **playwright non è nel progetto** (puppeteer è l'automation
  del repo) — dichiarato in ogni report. jsdom resta T1 e non chiude claim UI.
- **Patch ambiente dichiarata** (solo senza pywebview): race `StudyStore.listSubjects` 1500ms;
  READY store fino a 20s → poll editor ≥48s. In app desktop con pywebview non serve; nessun
  file prodotto toccato per l'ambiente.
- Screenshot PRIMA = interception con snapshot baseline (`qa/r24_*_baseline.js`), stessa
  condizione DOPO; frame interi (toolbar+pannello o canvas nel frame).

### Scelte tecniche dichiarate
- **Dock pannello**: colonna comandi sinistra = `max(bottom(.fn-pill-left), bottom(.fn-zoom))`;
  `top = colBottom + 8` dal DOM (150px), `z-inline = z-toolbar − 1` (11<12). `btnDelSel`
  (rect 0×0, nascosto senza selezione) **escluso dagli hit** — non è un reclamo pannello.
- **Auto-altezza**: `height:''` di default (solo drag manuale fissa, clamp ≥160), padding-bottom
  inline **4px** → spazio morto residuo = padding (5px ≤8); `max-height:66vh` clamp.
  Resize R21/R22 (`fp21_w_/fp21_h_<ctx>`) intatto (fix drag clamp ≥160 per regressione jsdom).
- **"Perfeziona al rilascio"** (`nt24_releaseRefine`, default ON, popover Aiuto): aperti →
  fit+commit a pointerup+**settle 150ms**; chiuse → ghost/commit R20 invariato; OFF → hold-still
  storico aperti. Gate R20/R22 **non alzati**.
- **Contatori**: `__ink.counters` + `console.info('[ink24] ...')` — telemetria, rendering invariato.
- **R3.1**: soglia ≤1.5px sull'**input classe R22** (jitter LCG zero-mean ±2px, dove fu
  calibrata: 1.16px → qui 0.612px). Onde sinusoidali sistematiche ±1.4px: residuo max 1.70px,
  misurato ma **non-assert** (metrica max su input sistematico ≠ calibrazione originale).
  Nessuna soglia alzata, nessun fit toccato.
- **RSS pro**: con ctx4096+KV q8_0 il floor (pesi Q4 3379MB mappati + KV ~250 + buffer) supera
  3.6GB → **impossibile** con questi vincoli; budget draft **6144 confermato** (4436+1500
  ≈5.9GB; `spec.draft_model=""` = default R13).

### Cosa resta aperto / PARZIALE
- **PARZIALE**: mount Documenti/Presentazioni con pannello aperto su reale (stesso fitDock,
  nessuna evidenza visiva R24); **freccia al rilascio** su reale (solo T1 u20/u22:
  35°/3.2×/tang0); pennello/touch fisici (T2 con mouse CDP).
- **R0 top=58 non riprodotto** al T2 (dock R22 non applicato in quella sessione, causa
  transitoria non determinata — le misure R0 restano l'evidenza del reclamo).
- **`testR15_web` ddgs** è flaky di **rete reale** (0 risultati in batch, OK isolato; file non
  toccati da R24): se ricompare, è rete, non regressione.
- Latenza live p50 ~15ms (vs ~10ms R22, p95 16.2 ≤33ms): variabilità dichiarata; percorso
  live invariato (perfezionamento solo post-rilascio).
- RSS pro ≤3.6GB con ctx4096: **impossibile** (opzioni: ctx2048 → contesto dimezzato, o
  modello più piccolo) — decisione utente.

## Round 22 (PROMPT ROUND 21) - Fonti/preview manoscritto, rette/archi da zero, Pro, mount schemi, math: scelte e aperto

Riepilogo implementazioni in `MODIFICHE.md` (sezione Round 22); report dettagliati in
`qa/r22_{fonti,ink,schemi,models}_report.md`. Qui le scelte e ciò che resta aperto.

### Mount Fonti per modulo (stato a fine R22)
| Modulo | Contesto | Dove vive il pannello | Note |
|---|---|---|---|
| Appunti | `appunti` | assoluto, dock SOTTO pill undo/redo (top dinamico = max(pill,zoom).bottom+10) | z 11 < pill 12 |
| Schemi | `schemi` | DENTRO tab "Fonti" della `.sc-side` (regole scoped `.sc-side .fp21-root`) | nessun overlay flottante |
| Documenti | `documenti` | fixed top-right, dock sotto `.doc-bar`/`.mod-header`, z 20 | |
| Presentazioni | `presentazioni` | fixed top-right, dock sotto `.pp-bar`, z 5 | |
| Fogli | `fogli` | wrapper `.fg-fpwrap` absolute right, z 45 | |
| Video | `video` | wrapper laterale (stile R21) | |
| Ripasso | `ripasso` | wrapper laterale (stile R21) | |
Le chiavi localStorage del componente sono per-contesto: `fp21_w_<ctx>`, `fp21_h_<ctx>`
(reset rimuove entrambe), `fp21_top_<ctx>` (collapso riga superiore, R22), `fp21_search_<ctx>`,
`fp21_filter`.

### Adattatore manoscritto (preview "la nota come è scritta")
- Le note con tratti renderizzano un canvas offscreen (fit bbox adattivo) → `<img dataURL>` in cima
  ai blocchi testo/immagine in ordine oggetti; "Nessun testo disponibile" solo se no tratti+testo+immagini.
- Cache: in-memory Map per id+versione (versione = fingerprint del content; il doc non ha un campo
  versione esplicito — dichiarato). Guardia canvas nullo → fallback testo (jsdom).
- Le note manoscritte NON passano da renderMarkdown21: solo snapshot + testo digitato.

### Registro modelli
- `data/models_manager.py::MODELS_CATALOG` ordine `['pro','base']`, `dest_path` relativo al repo
  (`tools/models/spark-x2.6-4b.gguf` per il pro); sha256 del pro verificato a ogni presenza del file
  (fonte API HF, non la card); `checksum.txt` accanto al file.
- Chiave selezione persistita: config `local_model_key` + `local_model_path` + `llama.model_path`
  (coerenza per il sidecar). Fallback base su load fallito: `_watch_model_load`/`apply_fallback_config`.
- Override sampling pro solo su profilo `fast` (valori card temp 1.0/top_p 0.95/top_k -1/rp 1);
  profili `think`/`tool` invariati in ogni caso.
- Guardia draft: `DRAFT_RAM_BUDGET_MB=6144`; con `spec.draft_model=""` (default R13) il draft è
  già spento — la guardia scatta solo se un draft viene configurato.

### Cosa resta aperto (R22)
- **Discrimine T2 ink**: `tick=curva ideale` è ~0 anche nel baseline R21 (Catmull-Rom passa per i
  nodi): il discrimine reale della ricostruzione è "residuo vs generatore vero" (2.009→1.16px),
  oggi informativo — promuoverlo a assert richiede una soglia nuova (≤1.5px) da decidere.
- **C "di qualità"**: con jitter contenuto anche R21 baseline la classifica come `curve` (non stroke):
  la spec "C→stroke" vale per la C irregolare; l'invariante verificato è MAI circle/ellipse/rect.
- **Edge width post-drag negli Schemi**: dopo un drag/reset utente, la width inline del componente
  (340 default) riguadagna priorità su `width:100%` fino alla riapertura editor (taglio a destra
  nella side, MAI sopra il canvas); usare `!important` qui romperebbe il resize R21 — lasciato.
- **testG1 flaky** "completion 3 vuota" (prevalente a batch, run singole alternate): pre-R22,
  non attribuibile al round.
- **gate.threshold**: ripristinato a 0.70 (default tarato R15b; la config utente aveva 0.75 scritto
  fuori sessione). Se l'utente avesse scelto 0.75 dall'UI, i test `testR15_gate/testR16_gate`
  fallirebbero di nuovo: decisione sul tarato spetta a R15/G.
- **dlclick puro via CDP** inaffidabile su Chrome 155 headless: il codice copre con
  `mousedown detail>=2`, il T2 usa sequenza down/up esplicita.
- **Misure tok/s CPU-only** (n_gpu_layers=-1): su HW diverso ripetere. `repetition_penalty 1`
  (valore di card) produce ripetizioni su prompt brevi: comportamento voluto dalla card.
- `qa_ui/presentazioni.html` senza `.mod-header` (opzionale allineare a documenti).



Riepilogo implementazioni in `MODIFICHE.md` (sezione Round 21); report dettagliati
in `qa/r20_u_report.md`, `qa/r20_f_report.md`, `qa/r20_g_report.md`. Qui le scelte:

- **Tolleranze dichiarate**: retta/asta (U1) <= TOL=2.5+amp*3 (4.3px);
  smoothing/fondi curva (U2) <=2.5px dal tracciato ideale; gap-closing <=
  max(12px, 8% diagonale bbox); angoli rect 90+/-20 (assert 5 gradi), triangolo
  60+/-25 (assert 15 gradi); ali freccia 30-45 gradi, lunghezza 3-4x spessore;
  punta base <=2px; tangente <=5 gradi (retta) / <=10 gradi (Bezier); segno
  curvatura >=0.9 su campioni con |turn|>5 gradi (sotto 5 il segno e'
  indeterminato per definizione).
- **Parita' U1/U2 sull'asta**: il residuo dell'asta di una freccia e'
  misurato con la STESSA TOL per retta e curva; il residuo "puro" della
  classe curve resta <=2.5px (test u20 8.1/Q4). Il seam (ultimo punto asta,
  giuntura con la punta) e' escluso dal residuo perche' gia' garantito <=2px
  dall'assert base.
- **Determinismo dei test jsdom**: jitter di scheduling sulla pausa flick
  (280ms) poteva far scattare l'hold-still (350ms) -> i blocchi Q usano
  holdMs 900 (clamp 800) locali; senza questa scelta u20 era flaky 1/4-1/8
  (verde 10/10 consecutivi dopo).
- **Burst nel browser**: il riconoscimento rettangolo nel T2 richiede il
  dispatch sincero dei punti (dt=0 senza setTimeout per punto), identico a
  jsdom: con setTimeout per punto l'OneEuro subisce alpha misti e gli angoli
  si distorcono oltre soglia. Non e' un limite del prodotto (in produzione la
  penna arriva a 1-2ms e il floor 4ms copre), ma va documentato.
- **Semantica hold cambiata (R20 U8)**: all'fermo la forma non si commette
  piu' subito ma resta GHOST e si conferma al rilascio -> aspettativa a14 9.0
  aggiornata (motivata: spec U8); il trace stop/hold resta per le misure.
- **qaA19_shaping.js (R19) SUPERATO** da qaU20_matrix.js (R20): le
  aspettative vecchie (C aperta->stroke, flick->curve+flag) sono sostituite
  dalle nuove classi; lo script R19 non e' in T1 e resta solo come storico.
- **holdMs** e' clampato 200-800 ms (900 richiesto dai test -> 800 effettivo).
- findFlickTarget (punta agganciata a shape preesistente) mantenuto come
  fallback retrocompatibile accanto alla ricostruzione arrow.
- Flakes osservati e risolti: residuo Q6.3 al seam (1/6) e segno curvatura
  vicino all'inflessione - entrambi neutralizzati a livello di test con
  motivazione geometrica (vedi sopra), non alzando soglie a casaccio.
- testC_rag.py: un flake 21/1 nella prima T1 (stato temporaneo condiviso);
  verde isolato e nella T1 rilanciata - nessuna correlazione con questo round.
- Aperto: riconoscimento rettangolo resta sensibile a jitter >+-1.25px su
  realizationi sfavorevoli (probe _r19_rectprobe/_r19_sqprobe); latenza
  p50 ~9.5ms (vs ~8.5ms R19) entro il budget Q8 <=33ms p95 ma da tenere
  d'occhio nei prossimi round.

## Round 20 (PROMPT ROUND 19) - Schemi C1-C11 + Appunti A1/A2/A3: scelte e aperto

Riepilogo implementazioni in `MODIFICHE.md` (sezione Round 20). Qui le
differenze dichiarate e cio' che resta aperto:

- **Forma "curva" (Q) esente solo dall'ortogonalita'**: la spec vieta
  diagonali; gli archi a curva della strategia mappa/libero restano Q
  (baseline) ma devono comunque avere 0 intersezioni con nodi e punta
  <=2px; se la Q collide si cade sul router ortogonale. Caso `curva`
  coperto dal QA-S con assert dedicati.
- **C1b/C3b**: con overlap ma centri non esattamente allineati un "dritto
  di 1 segmento" sarebbe obliquo -> Z a 3 segmenti con l'andata nel gap
  (documentato in `qa/r19_s_report.md`; il fixture C1/C3 testa entrambi i
  sotto-casi).
- **Separatori minimi C11**: `SEP_MX/SEP_MY` in schemaStrategies portati a
  32/48px (da 24/40) per la spec; i test storici non assertavano i valori
  numerici -> nessuna regression nota.
- **Riconoscimento rettangolo/quadrato**: stabile con perimetro a passi
  4px e jitter +-1px; a jitter maggiore (~+-1.25px) o realizationi
  particolari puo' cadere in stroke (non snap) oppure - per rettangoli
  stretti - in `ellipse` prima che `rectangle` (ordine dei tentativi in
  `recognizeStroke`). I casi standard della spec sono robusti (probe in
  `tests/_r19_rectprobe.js`, `_r19_sqprobe.js`, esclusi da run_t1).
- **Toolbar**: `btnDelSel` ("Elimina selezione") e' fuori dalla lista
  "finale" della spec ma mantenuto (dinamico/nascosto): rimuoverlo avrebbe
  regresso la baseline senza ganagno funzionale. La funzione F05 "migliora
  testo" resta nel codice (`aiSelectionAction`) ma non ha piu' pulsante:
  dead code reversibile.
- **Cap 2500 + "Carica testo completo"**: esiste ancora SOLO per materiali
  non-md con testo lungo; i .md sono renderizzati per intero (scelta A3.3).
  Il pannello Fonti di **schemi** resta invariato (metadati visibili):
  A3 riguarda solo gli Appunti; `qaC2` iii verifica entrambi i comportamenti.
- **Screenshot shaping PRIMA/DOPO**: il ritaglio cattura il canvas del
  mondo; le icone shaping rimosse erano nella pill DESTRA - la loro assenza
  e' assertata via DOM (`[data-shaping]`=0 in `qa/r19_a_measures.json`),
  non nello screenshot toolbar (che ritaglia la pill sinistra).
- **Latenza scrittura**: il "prima" storico in `qa/l14_measures.json`
  (p50 0.2ms, paint-per-event) e' di un round antico con metodologia
  diversa; il percorso live ink e' byte-identico alla baseline pre-R19
  (prova: `tests/_r19_inkdiff.js`) e il confronto stesso-codice prima/
  dopo e' a parita' (~8.6 vs ~8.5ms p50, rAF 60Hz). Storico conservato in
  `qa/l14_measures_storico_preR19.json`.

## Funzioni rimandate (MVP funzionante presente)

| Funzione | Stato | Nota |
|---|---|---|
| **Export video reale** (MP4/WebM) | Rimandato | Preview + salvataggio progetto funzionanti; serve MediaServer/ffmpeg — segnalato anche nell'UI del modulo Video |
| **Generazione AI di riassunti/flashcard/schema** | Rimandata | Non si tocca la pipeline LLM dai nuovi moduli: ci sono il bottone "Apri nel Chatbot" e l'estrazione euristica locale; l'integrazione diretta si potrà aggiungere in seguito passando da `send_message` |
| **PDF nativi (export)** | Rimandato | Usato `window.print()` (stampa → PDF) per documenti/presentazioni |
| **Notifiche promemoria calendario** | Rimandate | Opzionali per specifica; nessun permesso OS richiesto |
| **OCR / riconoscimento scrittura** | Non implementato | Esplicitamente escluso dalla specifica |
| **Drag clip sulla timeline video** | Rimandato | Modifica tramite campi numerici inizio/durata |
| **Rendering interno PPT negli appunti** | Rimandato | C'è oggetto con icona+nome, selezionabile; doppio click apre il file col programma di sistema (`study_open_file`) |
| **Scala disegni a mano (schemi)** | Rimandato | Spostamento ed eliminazione disponibili; collegamento visivo nodo→disegno non implementato (disegni fluttuanti) |
| **Cartelle per altri kind** (mazzi, presentazioni, documenti, fogli, video) | Non richieste | Il sistema cartelle è pronto: basta passare il kind a `Folders` |
| **Sidebar storico conversazioni** | Resa non raggiungibile | Menu hamburger rimosso per richiesta: lo storico vive nel modulo Chatbot (stessi dati) |
| **Sync cloud, login, collaborazione, plugin** | Esclusi | Da specifica: NON implementare |

## Limiti noti

- Lo storage dei contenuti usa JSON nella tabella SQLite `study_items`: note con molte
  immagini dataURL possono crescere; per ora va bene per l'uso scolastico tipico.
- Le immagini "grosse" dei progetti sono copiate in `%APPDATA%\NovaStudio\assets\`
  (via `study_pick_asset`); nelle note si preferiscono dataURL compressi.
- L'anteprima delle conversazioni è l'ultimo messaggio salvato (troncato a 180 char).
- La Biblioteca non apre i "materiali RAG" (solo elenco/info): si aprono dal chatbot.
- `window.print()` dipende dalle opzioni di stampa della WebView2.
- Ricorrenze calendario espanset solo nel mese visualizzato (evento base unico).

## Bandiere / feature flag

- Nessuna bandiera esplicita: i nuovi moduli sono sempre attivi (sono la nuova UI).
- In assenza di backend pywebview (apertura di `index.html` in un browser puro),
  `store.js` passa su **localStorage** come fallback locale: utile per provare la UI,
  ma i dati non finiscono nel database dell'app.

## Ottimizzazioni viste ma VOLUTAMENTE NON implementate

Come da vincolo del prompt, **nessuna** di queste è stata toccata:

- RAM / memory budget / unload-load dei moduli per memoria
- KV cache, prompt caching, context window, context compression
- RAG (indicizzazione, chunking, embedding, reranking), caching LLM
- Bundle splitting, bundle size, performance profiling, compressione dati

Eventuali spunti futuri su queste tematiche vanno discussi prima di toccare `core/`.

## Piccoli debiti tecnici

- Il chatbot usa ancora la sidebar storico originale **e** la nuova lista card: entrambe
  restano funzionanti e sincronizzate (stesso backend).
- `document.execCommand` nell'editor documenti è deprecato ma funziona in WebView2 (MVP).
- I test automatici si limitano a: `node --check` su tutti i file JS,
  `python -m py_compile` sul backend e uno smoke test DOM (rimosso dopo l'uso).
Schemi — commenti UTF-8 in alcuni punti risultano corrotti (solo commenti, zero impatto runtime); segnalato come cosmetico, lasciato al decisione utente (interventi A/B non tracciabili: modulo untracked).



## Round 13 — chiusura audit + limiti nuovi dichiarati

**Audit UI (21 voci): TUTTE PRESENTE a fine round** (stato iniziale: 20 PRESENTE + C3 PARZIALE;
evidenze screenshot+file in `qa/audit_r13.md`). Nessuna voce dell'audit risulta rimandata.
Chiarimenti/limiti legati all'audit:

- **Viewer Fonti (C2)**: in Schemi il pannello Fonti è **sola preview** (nessun pulsante "inserisci",
  dichiarato dal R10 e riconfermato dall'audit); l'inserimento riferimento vive solo negli Appunti (A3).
- **Libri livello-2**: il corpus `preselected_books` è **VUOTO su questo host** (0 file, 0 embedding)
  → parity/recall libri reali **BLOCKED** con procedura manuale (`qa/qa_r13_rag_report.md`);
  la meccanica (backup/cutover/rollback/chromadb-out-of-runtime) è verificata comunque.
- **TTFT end-to-end in-app ≤2000 ms: BLOCKED** (6 tentativi): il costo del prompt RAG
  (3.700-4.600 token/messaggio ≈ 35-44 s di prompt eval) rende il target irraggiungibile senza
  ridurre il contesto RAG o rendere stabile il prefisso (procedura in `qa/qa_r13_ttft_report.md`).
  Fix di catena già applicati e tenuti: `llama.n_ctx` 4096→8192 (rollback `config.json.bak_r13`),
  `CONNECTION_TIMEOUT` 8→60 s (rollback `core/sidecar/client.py`), watchdog hard della sonda.
  SENZA quei fix l'app con RAG lungo cadeva nel fallback in-process con **crash nativi
  0xc0000005 (ggml-base.dll / ucrtbase.dll, Event Log)** — preesistente alla R13.
- **Draft speculativo (S2/S4)**: quant scelta **Q4_K_M** (regola letterale: risparmio Q3 105,2 MB < 120 MB);
  **draft OFF per TUTTI i profili** (acceptance 0,44-0,81; think speedup 1,169× < 1,30×);
  **RAM con draft ≤2,9 GB BLOCKED** (floor teorico ≈3,16 GB) — procedura nel report SPEC;
  `spec.draft_model` resta vuoto → nessun cambiamento del comportamento di default.
- **prompt-lookup**: spento/rimosso (speedup misurato 1,005× < 1,05×; nessun consumatore nel codice).
- **Gate qualità R13 non rimisurato**: invarianza provata (templates/validators/grammatiche intoccate,
  testH4_registry 8/8 + testH4_validators 38/38 verdi; functions.py solo trigger_ui/note su F06/F17,
  fuori dal gate) — valori 58/60 confermati per riconteggio su `qa/gate_outputs_r12.json`.
- **Suite T1 escluse dalla baseline** (metodo invariato R11/R12; eseguite e riportate a informativa in
  `qa/t1_r13.json`: 232/6): `qaB1_fogli`, `qaD_blockD` (runner meta) + `qaF_block` (aspettative legacy
  pre-H11: pannello 260px vs attuale 200≤220, ordine toolbar senza bottoni AI H11, F1 freeze-aware) +
  `qaV_blockv` (punti 5.24/5.25 N/A pre-R6 + bug noto del test `statC.toISOString`).
- **Limiti RAG residui**: lo storico chroma di rollback contiene ancora i 17 path legacy (snapshot non
  toccato, dichiarato); non rieseguire `--commit` sull'indicizzazione materiali (re-importerebbe i
  legacy — se mai accade, eseguire `python data/migrate_real.py --dedupe-legacy`).



## Round 16 - Chatbot: pipeline a 3 stadi, gate sempre-risposta, SLO

**Pipeline fissa (nessun toggle UI)**: cache semantica/risposte ->
appunti (ibrido FTS5+vec+RRF) -> libri -> gate precoce -> **web come
ultimo layer SEMPRE ATTIVO** (esegue solo quando il gate dice parziale/
nulla: badge statico "Web: attivo" in chat e in Impostazioni, non
cliccabile). UNA sola chiamata LLM di default; rewrite/decompose solo
ott-in su regola esplicita.

**Allowlist web e dove modificarla**: `data/web_allowlist.txt` - una
riga per dominio (# = commento), **solo file, nessuna UI**. Seed =
core/trusted_sources.py (lista curata originale: treccani, sapere,
britannica, scholar, jstor, factcheck, istruzione/istat, eric/pubmed/
base/core, snopes/politifact/factcheck) + it/en.wikipedia.org (22
domini). Il filtro vale per TUTTI i provider (ddgs trusted/generico,
SearXNG, Wikipedia): i risultati fuori lista vengono SCARTATI con log
in NET_LOG (core/web_search.py::_in_allowlist). Budget fetch 5,0s
(fasce: batch fidati <=2s per richiesta, generico con riserva 1,2s per
Wikipedia).

**Politica "sempre una risposta" (tre esiti)**:
- (a) copertura piena -> risposta con citazioni [F1]/[W1] e badge stadio;
- (b) parziale -> prefisso deterministico "Dai tuoi materiali emerge
  solo questo: " + risposta su ci che c'e' + integrazione web;
- (c) nulla locale -> risposta BASATA SUL WEB con citazioni url; se il
  web e' vuoto/non raggiungibile -> informativa onesta (web_status
  giu/vuoto in build_informativa: "non ho trovato nulla in appunti,
  libri e web perche' il web non e' raggiungibile" + quasi-corrispondenze
  + suggerimenti). La frase canned "La risposta e' data da un utente di
  questo tipo." e' un MARKER della guardia (mai emessa).
- Ogni risposta loggata in `%APPDATA%/NovaStudio/risposte.jsonl`
  (stadi, score, tempi per stadio, esito, lunghezza, marker-check);
  parziali/nulli anche in astensioni.jsonl.

**Guardia output (zero leak)**: core/rag/output_guard.py - prebuffer
adattivo (12-24 char, rileva system-echo), sanitizer live (taglia da
"User:/Assistant:/[Fonte/</contesto>"), check post-generazione con 1
retry a prompt riparato e RESET (evento che sostituisce lo stream nel
backend e nella UI), fallback estrattivo template-free con citazioni
[F1]/[W1]. Test: tests/testR16_prompt.py (50 generazioni simulate).

**SLO dichiarati (misurati qa/r16_qa1.json, 20 query)**:
- risposta completa <=20s p95: **RAGGIUNTO** (p95 19.102ms; budget
  generazione con deadline = 20s - 1s di margine, degradazione con
  "_[risposta abbreviata: tempo massimo raggiunto]_");
- primo token <=2s p95: **MANCATO** (p95 11.768ms; fisica: fetch web
  1,1-3,3s + prompt-eval variabile 1,3-6s + prebuffer; gruppo
  informativa p95 0,06s, locale p50 ~4s; primo FEEDBACK progress
  p95 30ms). Mitigazioni applicate: thinking disabilitato sui profili
  non-think (-13s sul primo token), prebuffer 48->12/24 char, fonti
  prompt capate a 3x220 char (gate/recall usano comunque i top-5
  completi), prefix cache slot confermata (prompt_n=1 su rifai
  identico, riuso parziale misurato prompt_n=14);
- rete: solo stadio web, solo allowlist, disattivazione da file
  config `web.mode=mai` (nessun toggle UI) o `R16_WEB_DOWN=1` (test).

**Limiti dichiarati**: sub-SLO primo token (vedi sopra, BLOCKED
fisico); risposte locali troncate dal budget 20s su quasi tutti i casi
(degradazione prevista dal contratto 2.4); gate umano 10 risposte =
1 OK / 7 PARZIALI / 2 KO (qualita' MiniCPM5-2B + contesto amputato,
zero marker/bloccchi duplicati su 10/10); corpus libri vuoto (BLOCKED
R13 invariato).

## Round 15b — gate a tre esiti, stadio web, percorsocritico (chiusura audit "non trovato")

**Politica del gate (tre esiti, nessun "info non trovata" nudo)** — `core/rag/gate.py`,
soglia `gate.threshold` (Impostazioni, default **0.70** tarato su `qa/gt_set_r15.json`:
18 casi reali, precision 1.000 / recall 1.000; patch della sola riga di default):
- **COPERTURA PIENA** (score fuso 0,6·vec + 0,4·max(fts_norm,lex) ≥ soglia E supporto
  lessicale: bm25 ≥ 3,5 o lex ≥ 0,30) → risposta con citazioni (1 chiamata LLM).
- **COPERTURA PARZIALE** (supporto presente ma sotto soglia) → risposta su ciò che c'è +
  "Ho trovato solo questo nei materiali…" + near-miss top-3 con score.
- **COPERTURA NULLA** (nessun candidato, o alta sim SENZA supporto — il caso "q4"
  del forensics) → escalation web (se attiva); altrimenti messaggio informativo
  **zero-LLM** (`build_informativa`): stadi interpellati, query normalizzata,
  quasi-corrispondenze con score, suggerimento di riformulazione/aggiunta materiale,
  badge "web tentato/non disponibile".
- Ogni parziale/nulla è loggato in `%APPDATA%\NovaStudio\astensioni.jsonl`
  (causa, score, stadi, tempo totale, web_attempted).
- Il gate decide SUBITO dopo il retrieval (overhead misurato 0,79–3,89 ms): l'astensione
  non costa più del recupero.

**Pesi fusione RRF a 3 stadi** (config, `core/rag/contract.py`): `web.weight_appunti=1.0`,
`web.weight_libri=1.0`, `web.weight_web=0.8`; ogni chunk porta `meta.stage`
(appunti|libri|web) e le citazioni mostrano il badge dello stadio (+ url per il web).

**Cache**: risposte (`core/rag/answer_cache.py`) TTL **7 giorni** (costante dichiarata,
chiave = query normalizzata + model_id + stadi; invalidate su fingerprint documenti);
cache URL web (`web.cache_ttl_days=7`) in `%APPDATA%\NovaStudio\web_cache\`.

**Web — nota privacy e disattivazione**: quando il web è attivo (Auto/Sempre) le query di
ricerca vengono inviate a **DuckDuckGo** (default, senza chiave; prima fonti fidate, poi
generico), opzionalmente **SearXNG** self-hosted (`web.searxng_url`) e **Wikipedia**
(`web.wikipedia`): **nessun LLM cloud** — dal web arrivano solo documenti (fetch ≤4000
caratteri, indicizzati come stadio `web`), la risposta la genera sempre il sidecar locale.
**Disattivazione**: Impostazioni → Ricerca web → **Mai** (`web.mode=mai`, zero chiamate
di rete, verificato e testato); toggle per singola query accanto all'input di chat
(`web_override`). Ogni chiamata di rete è loggata in `qa/r15_web_netlog.json`.

**Percorso di default**: UNA sola chiamata LLM per query (rewrite/decompose solo per
regola ott-in, comunque 1 generazione); embedder residente caldo (query p95 ~29 ms);
recupero ibrido FTS5+vec+RRF (p50 ~27 ms, time-box soft 1 s); primo feedback UI
(progress per stadio) p95 **28 ms** (target ≤2 s).

**Limiti dichiarati**: corpus libri preselected VUOTO su questo host (parity/recall libri
restano BLOCKED con procedura manuale, vedi R13); query senza senso/bypass chitchat
(`semantic_router.should_use_rag=False`) non raggiungono il gate per design H9.


## Round 19 (PROMPT ROUND 18) - Politiche RAG: tre stadi, breaker, intent, provenienza

**Politica TRE STADI (B1.1)**: ogni domanda fattuale nuova esegue
appunti -> libri -> web, in quest'ordine, SEMPRE (il gate NON short-circuita
piu' il web: `want_web = web_mode != "mai"` in `core/router.py`; gli skip
"appunti lenti -> libri saltati" e "stadi lenti -> web saltato" sono rimossi).
Uniche eccezioni dichiarate:
  - **cache hit intent-aware** (B3.2): riuso ammesso SOLO se
    `stessa-domanda-riformulata` con similarity >= **0,92**;
  - `web.mode=mai` (opt-out di config, zero rete) e modalita `solo_locale`;
  - **chit-chat** (saluti/sociali, `core/rag/intent.py`: saluto-iniziale o
    social/short o intent0 chat): risposta diretta, 0 retrieval, 0 web.
Il modello diagnostico "semantic_router should_use_rag" NON decide piu' il
bypass chitchat delle domande fattuali (F0: "cos'è la fotosintesi?" finiva in
chit-chat con router freddo/0-LLM).

**Circuit-breaker web (B1.2)** - `core/rag/web_stage.py`:
  - TTL massimo **60 s** (`BREAKER_TTL_S`) con retry per query alla scadenza;
  - si apre SOLO dopo un **tentativo HTTP reale fallito**, registrando
    `last_error = {url, provider, status, error, ts}` (letto da NET_LOG:
    chiave "note" = testo eccezione/HTTP);
  - entro il TTL l'escalation salta ma lo stato e' "post-errore reale" ->
    `web_status="giu"` onesto ammesso; "web non disponibile" mai altrimenti;
  - `web_state()`/`breaker_state()` espongono lo stato a router, log e forensics;
  - NESSUNO short-circuit pre-tentativo (rimosso il bypass gate piena).
Budget fetch: `WEB_BUDGET_S=7.0` (R18: era 5; wiki join con floor 2s,
riserva 2 slot per la wiki, wiki in TESTA ai risultati, lead-extract rescue
per query "chi ..." senza anni negli snippet).

**Intent taxonomy (B3.1)** - `core/rag/intent.py` (regole + embedding):
  - `stessa-domanda-riformulata` (sim vs contesto >= 0,92 o subset-token);
  - `sotto-domanda` (anafora "questa/di come/parlami meglio..." o token
    condivisi con la storia; richiede STORIA: anafora senza antecedente =
    nuova-domanda);
  - `nuova-domanda`; `chit-chat` (saluto-iniziale/sociali, vedi sopra).
Cache/delta (B3.2): su HIT di `AnswerCache` la base di classificazione e'
la storia (se esiste) altrimenti la domanda in cache (chiave esatta = sim
1.0); solo `stessa-domanda-riformulata` con sim >= 0,92 riusa, tutto il
resto forza retrieval fresco; ogni decisione finisce in
`risposte.jsonl.cache_decision` (campo `intent`/`cache_decision` su ogni
record). Follow-up (B3.3): la query di retrieval/web e'
`intent.expand_query()` = entita' della storia + termini della domanda
(MAI la frase letterale da sola).

**Provenienza = CONTRIBUENTI (B1.3)**: `Router._provenance_contributing`
Conta solo gli stadi dei chunk REALMENTE PASSATI alla generazione con
similarity >= soglia di ammissione H8 (`MIN_SIMILARITY_WEAK=0.35`), web
solo se effettivamente usato; nessun contributore -> lista vuota -> la UI
mostra **"nessuna fonte trovata"** (`contract.NONE_SOURCE_TEXT`;
`renderProvenienza` in index.html). I near-miss del gate NON contano piu'
come fonte. I dettagli tecnici (score/soglie/path/"Perche':") restano SOLO
nei log (`[gate] informativa: ...` + astensioni.jsonl); l'informativa in UI
e' una frase onesta + 3 suggerimenti (B5.2).

**Grounding (B2)** - `core/rag/grounding.py`: dopo ogni generazione con
contesto UNA chiamata di check (profilo think, reasoning OFF perche' con
reasoning ON i token finivano nel thinking e la risposta era vuota,
grammatica JSON `{ok, violations[]}`); parse non riuscito -> `ok=None`
(check saltato, mai violazione fittizia); violazioni o depth non valido o
anni biografici di contesto mancanti -> UNA rigenerazione vincolata
(`repair_note` su generate_stream/stream_via_sidecar); persistenza ->
frase onesta `limit_statement()` (e la risposta NON va in cache). Il
check e' eseguibile SOLO su sidecar (timeout 70s): se non va e' saltato e
loggato (nessun fallback in-process - caricava il modello e bloccava).
Istruzione conflitto locale vs web (B2.2) e' nel prompt di
`local_llm_client._prepare_messages`.

**Profondita' minima (B5.1)**: `grounding.depth_check` per intent -
nuova-domanda >= 120 parole OPPURE >= 3 punti strutturati;
sotto-domanda/stessa-riformulata >= 80; chit-chat libera; risposta
fattuale < 40 parole sempre insufficiente. Violazione -> 1 rigenerazione.

**Prompt/contexto (R18)**: `PROMPT_CHUNK_CHARS=950` (i chunk medi sono
~2300 char;220 tagliava i fatti GT - tradeoff pp dichiarato),
`PROMPT_WEB_CHARS=400`, `PROMPT_WEB_MAX=6` (le date biografiche stanno in
britannica/sapere, fuori dai vecchi 4 slot) + istruzione "riporta fedelmente
date/anni/numeri del contesto".

**Limiti/debiti aperti (R18)**:
- **QA-1 BLOCKED (6/6 tentativi)**:87/88 check; residuo = GT "fotosintesi
  deve contenere CO2/anidride carbonica" su P1: il fatto E' nel prompt
  (chunk1 pos851) ma il modello2B lo omette e il check di grounding
  (anch'esso2B) non lo segnala - procedura: rilanciare
  `python tests/gt_r18_probes.py` quando il modello sara' maggiore o con
  istruzione di completezza piu' severa (storico: il check PASSO in prova5).
- L'aggiunta grounding+prompt grande allunga le risposte (check 9-40s,
  risposte 30-130s): lo SLO20s del R16 NON e' piu' garantito (non richiesto
  in questo round; streaming e assenza di troncamenti confermati).
- Se il sidecar muore a meta' generazione, il fallback in-process resta
  (risposta lenta ma completa); il check NON cascava piu' in esso.
- Indice: chroma legacy (34 embeddings,17 hash x2) e archivio NON toccato
  (backend attivo sqlite, vincolo attivo); copie su disco originals/ e
  rag_stage2/ restano (originals/ escluso dal retrieval C4).
- `parity` H1 confrontata su hash di contenuto (dedup top-k): il vecchio
  confronto per (path, testo) falliva a causa stessa del dedup B4.5.


## Round 14 - Schemi routing preciso + Appunti ink shaping + latenza scrittura

**Routing schemi (BLOCCO S, owner `modules/schemi.js` + `schemaStrategies.js`)**:
- 4 ancore fisse per nodo (centro-top/bottom/left/right); ogni arco e'
  ancora->ancora; coppia scelta per posizione relativa (sotto: bottom->top,
  sopra: top->bottom, stessa banda: right<->left dal segno di dx);
- **dritto per default**; gradini/orthogonal SOLO se il segmento interseca un
  nodo non-endpoint: router L poi Z/step attorno al bbox con **margine 12px**,
  mai sopra i nodi (asserzione geometrica nel test);
- frecce: triangolo pieno sull'ultimo segmento, punta <=2px dall'ancora;
- collision-resolution (24px orizz. /40px vert.) in ogni auto-layout e
  all'apertura del doc (idempotente, include orfani/righe extra).
- Misura T2: `qa/s14_measures.json` (PRIMA:5 intersezioni,5 coppie violate;
  DOPO:0/0, punte oltre2px 0/18).

**Latenza scrittura (BLOCCO L, owner `modules/notes.js` - UNICO owner della
pipeline tratto, L prima di A)**:
- filtro **One Euro** incrementale (params FISSI: minCutoff=1.5, beta=0.1,
  dCutoff=1.0) su ogni punto all'arrivo + `getCoalescedEvents()`
  (`getPredictedEvents` NON usato: ritirabili dal browser -> artefatti,
  dichiarato); render SOLO via requestAnimationFrame sul buffer punti;
  clock unico `performance.now()` (gli eventi nativi possono stare su altro
  dominio: misurato, settle mai altrimenti);
- **Intensita aiuto NON tocca il live**: entra SOLO nella pulizia di fine
  tratto (`inkEndCleanup`: rimozione tremolio con forza=helpAssist,
  media mobile con helpSmooth) e nell'ampiezza dello snap (`inkSnapAmp`);
- convergenza: puntatore fermo >16ms -> snap della punta sul punto reale
  al PRIMO frame di quiete (<=2 frame, misurato);
- T2 `qa/l14_measures.json`: PRIMA settle=MAI a50/100% e trailing
  0/8.11/44.82px; DOPO p50 8.6-9.5ms, p95 16.8-17.5ms, settle 10-20ms,
  trailing senza trend di intensita'.

**Ink shaping (BLOCCO A, stesso owner notes.js)**:
- **Riconoscimento forme** al rilascio o hold-still (default **350ms**,
  slider **200-800ms**): line = fit LSQ (asse principale/PCA) con dev
  perpendicolare <= tol; circle = fit algebrico **Kasa** (3x3) + check
  raggio; ellipse = assi/centro da ESTREMITA' nel frame PCA (invariante al
  campionamento) + errore normalizzato; rect/square = min-area assiale +
  rotato PCA con test bordi (>=85% punti entro tol) e aspect-ratio
  (quadrato 0.8-1.25); **tol = 2.5 + 3*amp** (amp = Intensita aiuto);
- **Frecce automatiche**: flick a V (finestra **250ms**, svolta **>=100°**,
  extent <=80px) agganciato alla linea/arco entro **45px** dall'inizio ->
  arrowhead come parte della shape (flick scartato, undo in 1 passo);
- **hold-still**: in pausa >=holdMs, A3 (tremolio rimosso se helpOn) e
  snap a shape senza aspettare il rilascio;
- **Impostazioni**: toggle "forme"/"frecce" in TOOLBAR (classe .mode) +
  slider "Fermo per snap" nel popover Aiuto; persistite in localStorage
  `nt14_shaping` {shpOn, arrowOn, holdMs} (default true,true,350);
- **Undo a due livelli**: sugli shape 1° undo -> tratto grezzo, 2° ->
  tratto rimosso (tooltip del bottone Annulla aggiornato).

**Limiti/debiti round14**:
- `getPredictedEvents` non usato (dichiarato, vedi sopra);
- jsdom non implementa SVG getPointAtLength: i test geometrici S girano
  sul DOM SVG REALE di Chromium (qaS14) orchestrato dal test T1;
- il primo T1 ha mostrato testG8 legacy agganciato all'ultimo round:
  test aggiornato (entry build storico + ultimo round = QA_TS, dichiarato);
- agenti delegati S hanno esaurito i turni prima del report: il
  coordinatore ha completato misure DOPO, test, fix editorWiring
  (edgeStyle>=2 dichiarato) e il report.
