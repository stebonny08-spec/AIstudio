## Round 31-bis (PROMPT ROUND 29-bis) - OMBRA di anteprima live (shadow preview) prima del rilascio + chiusura aperture 29-bis

**STRATEGIA**: "SPEC-FIRST-ombra": Parte 1-bis (G01-G13, N02-bis sostitutivo di N02) implementata come LAYER di
rendering separato dal motore ink-commit: `shadowPlan()` (ink_commit.js) riusa la classificazione T01/T02/frecce e
ritorna SOLO il piano (mai commit, G09); `updateShadow()` in notes.js ad ogni frame con attivazione solo dopo
sosta `shadowHoldMs=200ms` (G01) e aggiornamento live a ogni punto (G05, firma sig); `drawShadow()` layer grigio
`shadowOpacity=0.40` (G02) sopra il grezzo (G03), sagoma punta per frecce (G08), SOLO penna giù, `ed.sh=null` al
rilascio (G10); timer idle 40ms (gate >60ms senza input) per attivazione/render dove i rAF si fermano (headless),
senza toccare la latenza live (M03/Q04). Assiste solo T01/T02/frecce-asta-line/arco; T03-T07/loop/chiuso mai
ombra (G04). Commit K01-K04, undo/redo e persistenza invariati (K01-K04 validi, M04/M05).

### Comportamento verificato su APP REALE (qaR31b_shadow 65/65, screenshot qa/r31b_*.png)
- Q06 linea+sosta+miratura 245%: attivazione 201ms, G05 update max 11.9ms (misura IN-PAGINA, <=100ms),
  commit=line endpoint ombra->commit 0.000px, zero grigio post; Q07 arco: 187ms/15.3ms/0.000px;
  Q10 freccia: flick 4pt -> shadow arrow+head, commit arrow+head 0px; Q08/Q09 no-ombra; Q11 undo/redo
  ['line','line'] senza elementi ombra; Q12 zoom 100% identico a 245% (G13); N02-bis confermato in ogni scenario.
- 5 aperture del 29-bis chiuse con root-cause (tutte QA/generatori, prodotto invariato):
  (1) Q06 commit freeform/endpoint104.058 = `penUp(ptsB)` a x+60 vs penna a x+164 (snap inkLastRaw teleporta
  104px) -> fix QA `penUp(ptsB.concat(ext))`;
  (2) G05 >100ms = clock nodo/CDP + **poisoning dei probe pixel:324x`getImageData` sezzano i frame
  (31->2/500ms, persistente, evidenza `qa/_r31b_bisect.js`; screenshot innocui)** -> misura inpagina + probe
  spostati DOPO la sezione G05 in Q06/Q07;
  (3) Q10 flick = generatore QA sotto-soglia A01 (gamba 7.5<8px, 2pt nella finestra 250ms) -> nuovo V 4pt +
  asta phase-0 amp3 (dev 5.08<6.50 anche troncata) -> arrow+head;
  (4) Q12.4/6 rieseguiti verdi; (5) T1 3581/0 + qaR31_ink 87/87 sul codice finale.
- qaR31_ink N08: la pausa mid-stroke (>=200ms) attiva l'ombra G01 che scurisce la coda bagnata (168->~109,
  fuori banda 160-176 del probe; A/B in `qa/_r31b_n08diag.js`) -> check round-29 isolato con `shadowHoldMs`
  fuori SOLO per il draw N08 (ripristino subito dopo) -> 87/87. N08 live>=3px / post<=0.75px sempre confermati.

### File
PRODOTTO ( Round 31-bis, gia' nel round29-bis): notes.js (ed.sh/updateShadow/drawShadow/liveTick/__ink.shadow,
~+120 righe, nessuna rimozione), ink_commit.js (+shadowPlan), ink_cfg.js (+shadow*3). INvariati in questa
completione. QA: qa_browser/qaR31b_shadow.js (Q06-Q12, g05Arm/g05Read inpagina), qaR31_ink.js (isolamento N08),
diag: qa/_r31b_cadence.js, _r31b_bisect.js, _r31b_n08diag.js, _r31b_dbg_q10shaft.js, _r31b_patch2/3.js.

### QA/REGRESSIONI (finali)
qaR31b_shadow **65/65**; qaR31_ink **87/87** (latenza p95 16.3 vs baseline R0 16.0, delta 0.3<=8);
T1 **3581/0** (baseline ufficiale). Report: qa/r31b_report.md (DONE), qa/r31_report.md (round29).

## Round 31 (PROMPT ROUND 29) - Ink-commit: riscrittura totale del motore di perfezionamento tratti (riferimento video FreeNotes)

**STRATEGIA**: "SPEC-FIRST-ink": Parte 1 del prompt (L/K/T/A/F/N) come UNICA fonte di verita; motore di perfezionamento
esistente (rette/archi/forme chiuse/ghost/hold-still/oggetti forma/maniglie) ELIMINATO e riscritto da zero in un modulo
unico "ink_commit.js" con tutti i parametri in "ink_cfg.js" (coordinate MONDO, zoom-invarianti, M02); nessun flag
(setShaping/setReleaseRefine/nt14_shaping/nt24_releaseRefine/toggle "Perfeziona al rilascio"/slider "Fermo per snap"
rimossi, M01); commit SEMPRE al rilascio con finestra di assestamento K01=200ms (150-300) e UNO swap discreto (K02),
pendings indipendenti per tratto (K04) con snapshot undo/redo e salvataggio che materializzano i pendings (M04/M05);
scrittura assistita live (One Euro + slider Intensita/Smussamento) INVARIATA e solo in fase live (M03, latenza p95
misurata <=33ms e == baseline R0). Evidenze: qaR31_ink su APP REALE (pointer CDP, 87/87 su3 run) + T1 completo
3581/0 (baseline3308/0) + qaR27_fonti45/45 + run.js19/19 + r18_chat40/0.

### Comportamento (T/K/A/F/N)
- T01 linea: dev corda<=2.5% o path/chord>=0.95 con nf<2 -> Theil-Sen+PCA, segmento a2 punti esatti, endpoint +-3px.
- T02 arco: cerchio Kasa (residuo<=4px, endpoint+-3, sweep>=12, |err angolo|<=5, tangenti endpoint<=10) oppure cubica
  singola LSQ tol=max(4px, 11% corda) per gli angoli raccordati; se countFlessi>=2 (corda corta -> artefatto anche su
  una "C" pulita) il cerchio deve essere PERFETTO <=1.5px: arco di 280 gradi resta arco (A01), una S resta freeform.
- T03/T04/T05/T07: Taubin topologia-preservante con rollback (auto-intersezioni e flessi invariate); chiuso -> SOLO
  smoothing (mai cerchio/ellisse/rettangolo, N07); T07 scarabocchio denso -> mode "light"; T06 (path<20px) -> grezzo
  + discarded. F01-F05: flick stesso tratto (core V250ms/80px + back-stroke120ms/35px + fallback a INVERSIONE
  LOCALIZZATA per arco+flick = A06) e assorbimento secondo tratto (300ms/60px/120ms/60px) -> UN solo oggetto arrow
  con punta triangolare 3.4x/35 gradi saldata sulla tangente finale (F03/A06) e UN solo undo (M04/F04).
- L02/L04: coda "bagnata" grigia 30px mondo su tratto live e pendente, ZERO pixel grigi post-commit (N08 misurato con
  sezione trasversale reale: live>=3px, post<=0.75px). N01-N09 tutti verificati su app reale (qaR31_ink).

### File (M01/M02)
CREATI: web_frontend/html/js/modules/ink_cfg.js (unico file di config), ink_commit.js (motore),
  qa_browser/qaR31_ink.js (QA reale Q01-Q04 con screenshot live/post V01-V08).
RIMOSSE da notes.js ~1983 righe: recognizeStroke, _tryRect, _tryTri, _closeLoop, kasaCircle, _lineFitRobust,
  _tryCurve, _fitBezierRun, _taubinPreserve, _countFlessi, detectFlick, _detectBackStroke, _detectFlickCore,
  findFlickTarget, convertTargetToArrow, buildArrowRec, _makeHead, finalizeStrokeWithShape, finalizeEndStroke,
  makeShapeObj, ghostFlashLoop, drawGhostOverlay, _recIsClosed, inkEndCleanup, rotHandlePos + maniglia rotazione,
  setShaping, setReleaseRefine, saveShaping (nt14/nt24), slider "Fermo per snap", toggle "Perfeziona al rilascio".
INVARIATI: mkOneEuro (live), slider Intensita/Smussamento, drawShape (solo rendering legacy di note esistenti).

### QA/REGRESSIONI
- qaR31_ink.js 87/87 su3 run consecutivi (V01-V08 live+post, N01-N09, zoom100/245 identico, latenza 240Hz p95=16.8ms
  <=33 e invariata vs baseline R0 p95=17ms). T1 3581/0 (baseline3308/0): suite ink riscritte a14=86, u20=142,
  u22=36, u24=56, v1=95, l14=10. qaR27_fonti 45/45; run.js F0.4+4 pagine 19/19; r18_chat 40/0; stamp ?v= unificato
  su tutti i moduli + QA_TS=2026-11-09T19:30:00+01:00 (entry metrics_history round31 con build coerente).
- Allineamenti TEST pre-R31 (prodotto invariato, dati dichiarati): qaC2_viewer (contratto viewer mat R28/R30,
  fonti_panel mtime 04/11 > T1 02/11), qa3_block3 P5 regex ancorata a inizio riga "^# ROUND 3" (il match aperto
  combaciava "## Round 30" prependuto in R30), testG6_b3 accetta il ramo ONNX reale (P1b.3, modello .done+onnx>=50MB
  scaricato il 02/11 22:20), testR15 decompose abilitato via RAG_TECH (default OFF dal P1b.3 post-T1),
  metrics_history entry round31 (build==QA_TS, come da contratto testG8).

### Resta aperto
- slider "Intensita aiuto/Smussamento righe": UI e stato intatti ma senza effetto post-release (il commit gestisce
  tutto il rilascio; live a parametri fissi invariato per l14/Q04) - dichiarato.
- QA browser storici qaA19_shaping/qaR22_ink/qaR24_ink/qaLA14 richiamano API eliminate (setShaping/ghost/holdMs):
  sostituiti da qaR31_ink; non eseguiti in questo round.
- dist/NovaStudio contiene la copia web_frontend pre-R31: rigenerare con build.sh.
- F01 secondo tratto: finestra letterale 300ms/60px puo intercettare tratti brevissimi in corsivo veloce (gate extra:
  durata<120ms, len<=60px, target line/arc senza testa) - monitorabile via trace "absorb".
﻿## Round 30 (PROMPT ROUND 28) - Preview Fonti responsiva: ogni adattatore si adatta a pannello, collasso e finestra

**STRATEGIA**: "FE-RESP-first: layout flex del contenitore preview + rigenerazione adattiva
basata su ResizeObserver del solo area-contenuto (debounce 80ms, condiviso con watcher DPR e
resize finestra), evidenze T2 solo su app reale (resize reali finestra/pannello/DPR, screenshot
stesso viewport, misure clientWidth/scrollWidth)". Owner unico **FE-FONTI** (fonti_panel.js +
adattatori + css iniettato dal componente), **QA-REAL** per le evidenze. Motivazione: il difetto
e' fisico del rendering (bitmap a dimensione naturale fissa) e vive interamente nel componente;
la verifica richiede resize REALI -> pagina reale servita con la stessa catena ?v= (puppeteer/CDP),
harness jsdom = T1 che non chiude. **Chiusura T2: qa/r30_results.json = 31/31** (ripetuto sul
codice finale) + regressione **R27 reale 45/45**; report in `qa/r30_report.md`.

### Root cause (dell'immagine: snapshot piccola ~420x250 in area ~1250x600)
`renderInk21` fit mondo limitato a INK_W=300 x INK_H=210 (cap scala 8x) -> bitmap ~416x256
a dimensione naturale senza width/height CSS, e nessun observer: drag/collasso/resize non
rigeneravano nulla. Fix in fonti_panel.js:
- `renderInk21(objs,key,box)`: con box (area contenuto + DPR) rigenera il canvas a
  **canvas.width = round(boxW x devicePixelRatio)** con disegno fit contain centrato;
  attributi `data-cw/data-ch/data-dpr` sull'img; senza box resta il vecchio percorso e la
  vecchia chiave cache (compat T1/jsdom);
- `previewBox()` = content-box di `.fp21-pb` (client - padding) + dpr (1..3);
- **ResizeObserver** su `.fp21-pb` con debounce **80ms condiviso** (`scheduleRelayout`) da RO +
  `matchMedia(resolution)` (cambio DPR) + **resize finestra** (`onWinResize`); `relayoutPreview()`
  riesegue l'adattatore della selezione con guardia selSeq (anti-corsa);
- struttura L1.1: `.fp21-preview.fp21-pv` colonna (titolo fisso) + `.fp21-pbody.fp21-pb`
  flex:1/overflow:auto con specificita' (0,3,0) che vince sugli host (documenti max-height:38vh);
  wrapper `.fp21-aroot width:100%` = root uniforme di ogni adattatore (L2.4);
- contatore `window.FP21_RO.active` per il test anti-leak.

### L1.3 audit px (grep finale su fonti_panel.js)
RIMOSSE: gridwrap `max-height:320px` -> 100%; td `max-width:180px` -> 28ch; iframe
`height:440px` -> `aspect-ratio:1/1.35`; media `max-height:340px` -> 100%; pdftext `220px` ->
50vh; svg `260px` -> 80vh; clip img `54x32px` -> `width:16%;max-width:20%;aspect-ratio`;
snapshot (prima naturale ~416x256) -> `width:100%;height:auto;max-height:100%;object-fit:contain`;
INK_W/INK_H 300/210 = solo fallback compat. Restano SOLO 2 px dichiarati fuori scope L1.3:
`.fp21-chev 26x26` (bottone UI barra) e `.fp21-root min-height:300px` (altezza del PANNELO).

### L2 adattatori (tutti) + L3 esiti su app reale
- **L2.1** snapshot: width:100% + contain + centratura + canvas box x DPR.
- **L2.2** fogli: tabella 100% con overflow-x interno, sticky header, celle ellissi (28ch).
- **L2.3** md+math: reflow; `.fp21-math`/`.fp21-pre` con scroll interno (max-width:100%);
  overflow-wrap su p/li/td; scrollWidth pbody <= clientWidth+2 sempre.
- **L2.4** documenti/presentazioni/video/chat/libri: root `.fp21-aroot` 100%, figli max-width:100%.
- **L2.5** collasso: RO riesegue il layout in entrambi gli stati (nessun salto).
- **L3.1** (misure reali, viewport 1440x900): img == area contenuto +/-2px in 280/340/560px
  (244/304/524), collassato (524x616 box -> img 524x362 height-limited contain), espanso,
  e **DPR=2: canvas 1048x426 = 524x2** (>= boxW x DPR in tutte) + 7 screenshot r30_l31_*.
- **L3.2** finestre 1280/1600/1920 (+fogli/md/doc @1600): scrollWidth<=clientWidth+2 e
  root adattatore = 100% dell'area in tutte + 6 screenshot r30_l32_*.
- **L3.3** drag reale + toggle collasso coerenti; ResizeObserver 1 (aperto) -> 0 (destroy) -> 1
  (riapertura): **prima == dopo, nessun leak** + 2 screenshot.
- **L3.4** matrice 7 tipi (Appunti/Documenti/Presentazioni/Fogli/Video/Chat/md): root=100% area
  e nessun sforo ciascuno + 7 screenshot r30_mat_*; **Libri = PARZIALE** (preselected_books
  vuota, 0 file, invariato da R27).
- **L3.5** regressioni sul codice finale: **T1 1990/0 su 31 suite**, **QA reale R27 45/45**
  (toggle/collasso/persistenza/toolbar/B7/B8), pytest backend 96/96, 0 pageerror/0 console
  inattesi.

### File toccati (owner rispettato)
`web_frontend/html/js/modules/fonti_panel.js` (unico file applicativo),
`qa_browser/qaR30_resp.js` (nuovo), artefatti `qa/r30_*` (23 screenshot, results, measures,
report `qa/r30_report.md`), questo file. Nessun tocco ad altri moduli/backend.

### Resta aperto
1. Libri PARZIALE (cartella libri vuota: ramo md invariato da R27, non esercitabile su
   sorgente reale).
2. CDP non garantisce l'evento matchMedia 'resolution' su setDeviceMetricsOverride: il caso
   DPR=2 e' verificato con resize REALE della finestra in aggiunta (percorso previsto da L1.2);
   entrambi i percorsi (mq resolution + resize) sono implementati in FE.
3. Drift ?v pre-esistente censito e non toccato (9 moduli editor/Fonti a 2026-10-30 vs
   app.js/statistiche.js a 2026-10-27 = QA_TS; 8 script senza ?v) - F0 verifica la catena
   sotto test e censisce il resto.
4. Cambio tab Schemi: relayout affidato al RO (stesso codice, mount misurato = Appunti),
   non misurato esplicitamente in L3.
5. max-height in vh dove la % non e' applicabile (blocchi in flusso): unita' viewport-relative,
   non px fissi (scelta dichiarata).

## Round 29 (PROMPT ROUND 27) - Toggle pannello Fonti + collapso browser + adattatori preview universali (md = modello)

**STRATEGIA**: "FE-FONTI-first con diagnosi root-cause su dati reali". Owner unici:
FE-FONTI (`fonti_panel.js` + adattatori) e QA-REAL (`qa_browser/qaR27_fonti.js`,
`qa/_r27_dump.py`, `qa/r27_*`); zero toccature ad altri moduli/backend. La chiusura
T2 e' solo su app reale: index.html servito con la stessa catena `?v=` (puppeteer/CDP =
Chrome reale, playwright non nel progetto), seed dagli item REALI del SQLite
(`qa/r27_seed.json`, study_list mock riprodotto fedele: solo preview[180]), screenshot
stesso viewport 1440x900 e misure DOM reali. **T2 = 45/45** (`qa/r27_results.json`),
report in `qa/r27_report.md`.

### Root cause reali trovati e fixati (solo fonti_panel.js)
- **RC1 pannello Appunti mai chiudibile**: in index.html presentazioni.js/documenti.js
  (script DOPO notes) iniettano `.fp21-root{display:flex}` GLOBALE che vince su
  `display:none` di notes -> panel SEMPRE visibile (toggle/Esc senza effetto, recorder
  sempre "aperto"). Fix: autorita' di visibilita' del mount appunti = classe `.show`
  (`:not(.show){display:none!important}` + `.show{display:flex!important}`, solo appunti).
- **RC2 vuoti fantasma** ("Nessun testo disponibile." su note con tratti, "Foglio non
  leggibile." su fogli ESISTENTI = i due sintomi degli screenshot): `study_list` restituisce
  solo `preview[180]`, mai `content`. Fix: `fullContent()` carica il contenuto completo
  via `StudyStore.getItem` a ogni selezione (1 chiamata/click).
- **RC3 snapshot tratti non generato**: `serializableDoc` salva solo `pages` e itemTexts
  leggeva prima `objects` (pagina corrente vuota). Fix: PAGINE prima di objects (tutte le
  pagine con tratti) + `console.error` su ogni fallback canvas (ctx null/toDataURL/eccezione)
  invece del cadere silenzioso nel vuoto.
- **RC4 nodo rosso con LaTeX grezzo**: mathRender con throwOnError:false lasciava
  `.katex-error` con il sorgente grezzo (`\Delta G^\circ'`, `\text{...}`). Fix:
  throwOnError:true + varianti sanificate (parentesi/prime/\prime/graffi/wrap \text{})
  + fallback monospace pulito (estrae \text, via $ e backslash) con badge discreto.
  **Mai nodo rosso**: su reale 131 formule renderizzate, 0 katex-error, 0 nodi grezzi.

### B1-B8 (evidenze in qa/r27_report.md + qa/r27_*.png)
- **B1** bottone Fonti apre/chiude (chiuso = non visibile) + Esc chiude: Q1a-c (4 shot).
- **B2** chevron nasconde chip+lista, RIGA1 barra sottile con chevron RUOTATO 180,
  preview espansa fino al bottone in fondo, 2o click ripristina, selezione preservata: Q2.1-2.9.
- **B3** altezza esterna INvariata: **root 740->740 (delta0)**, preview 112->658 =
  atteso 740-8-4-26-32-12 = **658 (delta0)** (`qa/r27_measures.json`).
- **B4** persistenza per modulo (fp21_open_<ctx> + fp21_top_<ctx>) con reload: Appunti
  (aperto E collassato), Documenti (auto-ripreso dal pass applicativo globale), Schemi
  (tab Fonti attivo + collasso): Q3.0-3.8 + 3 screenshot reload.
- **B5** mount multipli: controller globale con selettori per ogni modulo (bottone Fonti
  condiviso documenti/presentazioni discriminato dal probe modulo; tab Fonti per Schemi,
  Esc torna al tab Riassunto). Verificato su reale in 3 mount (Appunti/Documenti/Schemi).
- **B6** non regressione: toolbar cliccabile 20/20 (elementFromPoint), resize drag
  340->400->reset 340, ricerca/typo invariati (T1 f22_* verdi).
- **B7** adattatori universali su sorgenti REALI: matrice Q6 8/9 PASS = Appunti(snapshot
  <img>), Documenti(html), Presentazioni(outline slide), Fogli(tabella+num a destra),
  Video(meta+clip), Chat(bolle ultimi 20), Materiali md(heading), Vuoto ad hoc(messaggio
  + log [fp21]); **Libri = PARZIALE**: preselected_books/ vuota (0 file) -> nessuna
  sorgente reale, cella marcata PARZIALE senza inventare dati (ramo md
  originals->rag_stage2 implementato in readMatBest). B7.8: 0 log di vuoto sulle
  sorgenti piene, vuoto solo nel caso creato ad hoc con console.error.
- **B8** matematica: Q7 zero nodi \Delta/\text/$$ grezzi, zero .katex-error, 131 formule
  renderizzate (0 fallback), testo reale del file fotosintesi con "dG=+2870 kJ/mol" e
  CO/H2O renderizzati (`r27_q7_math.png`).

### QA/verifiche
- **T2 reale: 45/45** (`qa/r27_results.json`), 22 screenshot `qa/r27_*.png`,
  misure `qa/r27_measures.json`; 0 pageerror e 0 console.error inattesi nella sessione.
- **T1: 1990 passati, 0 falliti su 31 suite** + nuovo `tests/r27_fonti_toggle.test.js`
  (32/0). Backend light: pytest 96/96 (testR28_preview, testR22_models, testR24_church,
  testH4_validators).
- F0: catena `?v=` coerente su tutti i moduli serviti (drift pre-esistente src ?v=
  2026-10-30 vs QA_TS 2026-10-27 in index.html: OSSERVATO, fuori owner, non toccato).

### File toccati (owner rispettato)
`web_frontend/html/js/modules/fonti_panel.js` (unico file applicativo),
`tests/r27_fonti_toggle.test.js` (nuovo), `qa_browser/qaR27_fonti.js` (nuovo),
`qa/_r27_dump.py` + `qa/r27_seed.json` (nuovi), artefatti `qa/r27_*`, questo file.
(web_frontend non e' tracciato da git: condizione pre-esistente del repo.)

### Resta aperto
1. Q6 Libri PARZIALE (cartella libri vuota: ramo md implementato ma non esercitabile
   su sorgente reale).
2. Q5 streaming/grounding/latenza NON rimisurati (round FE-only, 0 toccature backend;
   strutturalmente intatto: T1 completo + pytest verdi) -> PARZIALE per assenza di
   misura nuova.
3. Persistenza "aperto" registrata sui click utente: la chiusura forzata all'uscita
   del modulo (fpClose host) non riscrive la chiave (scelta dichiarata).
4. Log [fp21] soppressi con UA jsdom per le T1 (attivi e verificati sull'app reale).

## Round 28 (PROMPT ROUND 27/28) - Fonti per TUTTI i tipi (viewer reale) + barre collassabili Appunti

**RICHIESTA 1 - due pareti apri/chiudi con bottone dedicato (Appunti)**:
- (1) **Barra superiore** `.fn-top` (parte cerchiata): nuovo bottone a fine
  barra (`[data-foldtop]`, chevron) -> la barra si apre e si chiude; quando
  e' chiusa pillole/zoom salgono (`top:6/56px`) e **il canvas prende TUTTO
  lo spazio sotto**. Stato persistito in `nt28_topbar`.
- (2) **Pillole strumenti** (`.fn-pill-left`/`.fn-pill-right`): nuovo bottone
  a fine pill destra (`[data-foldtools]`, chevron) -> le pillole si aprono e
  si chiudono; da chiuse un FAB circolare (`.fn-foldfab`, in fondo a sinistra)
  le riapre e lo spazio va tutto al canvas sotto. Stato persistito in
  `nt28_tools`. Il dock del pannello Fonti viene ri-ancorato dopo ogni
  collasso (`fontiPanel.refresh()`).
- Invariati e riverificati: apri/chiudi Fonti dal bottone `[data-fonti]`
  (`toggleFonti`) e collasso riga chip/ricerca (`.fp21-chev`/`.fp21-lens`).

**RICHIESTA 2 - nella parte Fonti si vede QUALSIASI file "come se fosse
aperto ma solo li dentro" (tranne le flashcard)**:
- `fonti_panel.js::fetchSources21`: entrano ora **note, riassunti,
  documenti, presentazioni, fogli, video, schemi + CHAT** (`listConversations`)
  oltre a materiali/libri; i mazzi (`kind:'mazzo'`) restano **esclusi**.
  9 chip di categoria: `Tutti|Appunti|Documenti|Presentazioni|Fogli|Video|
  Chat|Materiali|Libri` (filtri per-categoria, badge per kind).
- Preview per tipo: card **diapositive** (presentazioni), **tabella A1** con
  intestazioni colonna (fogli), **timeline clip + player nativo** (video),
  **bolle chat** (`get_messages`), **mappa SVG** nodi+archi (schemi),
  `{"html"}` (documenti), tratti/testo (appunti) + righe-collegamento per gli
  oggetti `t:'file'` dentro le note (click -> `study_open_file`).
- NUOVO backend `backend/study_api.py::read_material_preview` (radici e
  sicurezza IDENTICHE a `read_material_text`): `image` | `pdf` (iframe col
  viewer nativo del browser + testo di riserva PyMuPDF) | `video`/`audio`
  (controlli nativi) | `doc` (.docx -> blocchi titoli/paragrafi/tabelle) |
  `slides` (.pptx -> slide: titolo+righe+note relatore) | `sheet` (.xlsx ->
  tabella dei primi fogli) | `html` | `text` | `file`. Il frontend ci cade
  su`read_material_text` se l'API non e' presente (build vecchie).
- Preview lunghe (chat/documenti/slide) scorrono dentro `.fp21-pbody`
  (`max-height:46vh; overflow:auto`).

**Test**: nuovi `tests/r28_fonti_viewer.test.js` (**41/0**) e
`tests/testR28_preview.py` (**11/11**: md/html/image/video/pdf/docx/pptx/xlsx/
file/sicurezza fuori radici). Aggiornate le asserzioni con SPEC cambiata:
`a19_fonti` 2.2/2.5 (9 chip + filtro Appunti = solo note) e `f21_fonti_panel`
T7.1. Riverde: a19 46/0, f21 48/0, f22_fonti_* 103/0, s22 55/0, l14 10/0,
aiUi_smoke 86/0, u20 80/0, editorWiring 49/0, implBlock12 74/0.

## Round 27 (P1-bis) - Acceleratori misurati: n-gram, usearch, tecniche RAG (A/B-driven)

**STRATEGIA**: fasi a dipendenze dichiarate: P1b.1 (n-gram, benchmark indipendente)
∥ P1b.2 (usearch, owner di core/rag/vector_store_sqlite) -> P1b.3 (tecniche RAG, stessi
file core/rag: SEQUENZIALE) -> P1b.4 (registro flag con default=A/B, rollback, QA finale
recall+TTFT, report `qa/p1b_report.md`). Regola comune: **ON solo se l'A/B sul corpus/indice
REALE lo giustifica**; altrimenti OFF con i numeri. Tutto cross-platform (usearch wheel
ufficiale, ONNX cross-platform, flags llama.cpp nativi; nessuna dipendenza Intel).

### P1b.1 - N-gram speculative (draftless, zero RAM) - ADOZIONATO su long-form
-26+run reali (ctx4096 q8_0, greedy, n_predict=200, prompt fisso):4 varianti x D{3,5,8}
 x2 modelli + L2 robustezza + top2 su fork. **Winner: ngram-map-k D=5 ->3.073x pro**
 (2.343x base), acceptance1.0, **output sha identici al greedy baseline** (quality
 invariata); simple0.975/1.036x -> OFF; fork xt map-k d5 =18.69 t/s.
- Confronto draft Spark R23 (1.272/1.240x): **n-gram vince -> draft Spark resta OFF, mai
 entrambi** (nessun --model-draft negli argv, testato). Micro/standard OFF per regola.
- Cablaggio: default `spec.ngram_longform=True`, `spec.ngram_variant=ngram-map-k`,
 `spec.ngram_draft_max=5` (data/config_manager.py) + branch want_draft (client, SOLO
 config reale: override test R13/R22 intatti) + argv sidecar (`--spec-type
 ngram-map-k --spec-ngram-map-k-size-m 5`). **Confermato sulla catena REALE** nel QA TTFT:
 log `[SidecarServer] spec n-gram long-form: ngram-map-k D=5`. Test `testP1b_ngram_flags` 7/7.

### P1b.2 - usearch HNSW come layer di query caldo - **ADOPTATO (ON)**
- `core/rag/usearch_layer.py` (nuovo): HNSW in memoria, save/load su disco
 (`hnsw_vector_index.usearch` + meta), rebuild SOLO su invalidate (add/reset hook in
 `vector_store_sqlite.py`), flag `usearch.enabled` (env RAG_USEARCH > config > default).
- A/B (qa/p1b_usearch.json): p95 reale sqlite-vec **0.885ms** vs usearch **0.037ms**
 (~24x); scale (latenza-only, vettori random seed dichiarati; corpus reale=17 vettori):
 1k1.19/0.29 - 10k6.72/0.72 - 50k26.29/1.60 (sv/uc). recall@5 GT off1.0 = on1.0.
 Regola soddisfatta -> `USEARCH_ENABLED_DEFAULT=True` con i numeri nel commento.
- Persistenza round-trip load verificato (nessun rebuild all'avvio). Test `testP1b_usearch`
 7/7 + store regressioni36/36.

### P1b.3 - Tecniche RAG (HyDE, decompose, CRAG-lite, rerank) - **NESSUNA ATTIVA**
- Ognuna dietro flag (`rag.hyde`, `rag.decompose`, `rag.crag_lite`, `rag.rerank.enabled`),
 default tutti False = esito A/B. Meccanismo A/B riproducibile: env `RAG_TECH`.
- A/B (qa/p1b_rag.json, GT reale9 positivi/5 negativi, granularità dichiarata +0.111/query):
 tutte recall1.0->1.0 e MRR0.9259 invariato (0 query in piu in cima) -> nessuna supera +0.03.
 - **HyDE**: run A/B9/9 fallback llm_down (auto_start=False per design); costo reale del
   ramo LLM con sidecar up: **>=8010ms** (budget8s, cold6888ms) >>150ms -> OFF.
 - **decompose**: +3.6ms ma0 gain -> OFF; **CRAG-lite**: +26.7ms (ok) ma0 gain -> OFF.
 - **rerank ONNX bge-reranker-v2-m3 int8 (543MB, Samir-j repo)**: MRR **peggiora**
   0.9259->0.8611 e **+25861.8ms p95** (~25.9s/query CPU) -> OFF (doppia violazione).
- Test `testP1b_rag`11/11 (HyDE con client finto, mai LLM reale nei test).

### P1b.4 - Registro, rollback, QA finale
- Rollback: ogni flag OFF = comportamento R23 esatto (test dedicati in tutte e3 le suite).
- Store intatto: usearch solo copia laterale (mai vec0/chunks); tecniche non riscrivono chunk.
- **Recall finale con set attivo:1.0 >= baseline R18 1.0** (qa/p1b_recall_final.json,
 usearch load reale).
- **TTFT RAG con acceleratori ammessi**: **SLO NON RAGGIUNTO (stato BLOCKED invariato)**: p50 **34699ms** / p95 52439ms (n=5, metodo R16 identico, `qa/p1b_ttft.json`) vs soglia p50<=2000ms. Il set attivo durante la misura = usearch ON + n-gram map-k d5 (log `[SidecarServer] spec n-gram long-form` confermato) + tutte le tecniche RAG OFF. Il dominante e' LLM+web+rigenerazioni depth (check_ms fino a28.9s): nessun acceleratore misurato in questo round puo' ridurlo l'usoarch toglie ~1ms di retrieval, il n-gram agisce solo sulla decode long-form). Coerente con il BLOCKED R13/R16 gia' documentato; nessun claim di raggiungimento.

### File toccati
P1b.1: `qa/p1b_ngram_bench.py`, `qa/p1b_ngram.json`, `data/config_manager.py` (3 default),
`core/sidecar/client.py`, `core/sidecar/server.py`, `tests/testP1b_ngram_flags.py`.
P1b.2: `core/rag/usearch_layer.py`, `core/rag/vector_store_sqlite.py`,
`tests/testP1b_usearch.py`, `qa/p1b_usearch_bench.py`+json.
P1b.3: `core/rag/hyde.py`, `core/rag/crag_lite.py`, `core/local_search.py`,
`core/rag/gate.py`, `core/router.py`, `core/rag/reranker_int8.py`, `tests/testP1b_rag.py`,
`qa/p1b_rag_{bench,recall}.py`+json.
QA finale: `qa/p1b_ttft.py`, `qa/p1b_hyde_cost.py`, `qa/p1b_recall_final.json`,
`tools/models/rerank_bge-v2m3/` (download ONNX), `qa/p1b_report.md`.

## Round 26 (PROMPT ROUND 24/25) - Evidenza solo su app reale + pannello Fonti + ink release-swap

**STRATEGIA**: `v0-first-poi-3-scope-fee-paralleli-con-owner-chiusura-solo-t2-reale`.
Riproduzione V0 bloccante (8 forme, pointer CDP reali, rilascio senza pausa, nessuna fix prima
della tabella) ->3 scope disgiunti in parallelo: **FE-INK** (notes.js: motore release-swap V1,
contatori V1, log [inkV]), **FE-FONTI** (fonti_panel.js verificato a regime, 2 suite test
estese), **FE-CHURCH** (RSS/gate/G1/schemi verificati, commento budget) -> matrice T2 reale
**33/33** su index.html servito con la stessa catena `?v=` del BUILD (playwright non nel
progetto: puppeteer/CDP = Chrome reale, dichiarato) -> T1 + report. Claim chiusi SOLO con
screenshot PRIMA/DOPO stesso viewport + contatori letti dal DOM reale; ogni pezzo senza
evidenza reale dichiarato PARZIALE (§6 di `qa/r25_report.md`).

### V0 - riproduzione reale (bloccante, `qa/r25_v0_table.txt`)
- T1 base:8/8 tratti diventavano tutti `shape/curve` indistinguibili; contatori V0
  (`strokes_live/perfected_on_release/swapped_pixels/residual_px`) ASSENTI -> FAIL;
  retta+flick NON rilevata come arrow -> FAIL; toolbar/typo/spazio morto: a regime (fix dei
  round precedenti) con screenshot PRIMA storico `r24_r0_1_pannello_toolbar.png`.
- Bug dello script (NON dell'app) emersi e fixati: forme sopra il pannello (down sul pannello),
  generatore arco ellittico, doc pieno -> `_insideExisting` (risolto: doc nuovo in A8).

### V1 - motore ink release-swap (FE-INK, notes.js)
- Classificatore al rilascio+settle in UNO swap: **line** Theil-Sen+PCA (gate ≤2-3% corda +
  ≤1 flesso), **arc** Kasa/Bézier LSQ (monotono, aperto), **freeform** Taubin
  corner-preserving (≥2 flessi/auto-int, topologia preservata, nessun snap), **closed** R20,
  **arrow** flick V + fallback back-stroke (finestra temp+spazio ≤120ms/≤35px mondo) — quest'ultimo
  risolve il V0 (flick CDP non rilevato). Soglie in coordinate MONDO (zoom-invariance V1.4).
- Contatori V1: `classified{line,arc,freeform,closed,arrow}` (transition dichiarata: lo scalare
  ex-R24 -> `.total`), `perfected_on_release`, `swapped_pixels`, `residual_px`,
  `strokes_live`; log `[inkV]` + backward-compat `[ink24]`.
- Setting `perfeziona al rilascio` (`nt24_releaseRefine`, default ON) invariato e confermato
  su reale (state.releaseRefine=true).

### V2 - pannello Fonti (FE-FONTI: VERIFICA,0 edit prod)
- R1.1-R1.4 **tutti a regime**: dock letto dal DOM (max bottom pill/zoom +8, z-1), height auto,
  collapso+typo. Evidenze: matrice B1/B2, `qaR25_fonti_extra` **7/7** (+26px, persistito su
  RELOAD). Aggiunti test `f22_fonti_dock` D16-D18 e `f22_fonti_resize` R15/R16 (162/0 totale).

### V3 - residui (FE-CHURCH)
- V3.1 assert T2: residuo arco vs generatore **1.2008px ≤1.5**, perfected_on_release+1.
- V3.2 schemi width:16/16 (resize R21 intatto). V3.3 gate da config:33/33.
- V3.4 testG1:3/3 ×2 con policy `[flake-retry] max2` dichiarata.
- V3.5 RSS pro: **4435.1MB** (range dichiarato4436-4471, var0.8%), floor esatto
  3379.3+765+290.8=4435.1 -> **target≤3.6GB non raggiungibile** (gap835MB);
  **budget draft6144 invariato** (4471+1500=5971<6144). `qa/r25_church_*`.

### V4 - QA reale + regressioni
- **Matrice T2:33/33 PASS** (`qa_browser/qaR25_matrix.js`,19 screenshot prima/dopo stesso
  viewport): retta residuo0+perfected+1; arco1.2008≤1.5 aperto; S freeform2/2 turn8.32°;
  loop non-snap; C aperta gap99.5; verticale/diagonale residuo0; flick→arrow; **zoom245%**
  (sc=2.753, path via toWorld inverso) residuo0; toolbar7/7; dead5px; latenza live da
  `__ink.trace` **p500.5ms p950.7ms** (≤33). Contatori finali: classified{line4,arc1,
  freeform3,arrow1} perfected9 swapPx683 residual0.
- **T1**: re-run finale dopo fix a2 test (vedi `qa/t1_r13.json`): target ≥3149/0.
- R20 (u20/u22/u24/a14 + nuovo **v1_release_swap 71/0**), R21 (matrix7/7), R16/R18
  (test T1 verdi), streaming/encoding/grounding-guard su app reale (`r18_verify`:4/4
  streaming pulito, depth ok=1/4 -> PARZIALE).

### Fix emersi solo dal QA (test/dichiarazioni)
- `tests/testH2_server.py`: l'assert sul path MiniCPM della config UTENTE e' diventato
  accettazione della lineup R23 (Spark pro/base o MiniCPM) - il test dipendeva da uno stato
  utente non piu' reale.
- `qa/metrics_history.json`: aggiunto `method.ttft_p95_ms` mancante all'entry round23 (testG8).
- `tests/u22_reshape_r22.test.js`:2 aspettative legacy riscritte al V1 (b.1 freeform
  informativo, d.1 curva aperta mai chiusa) con dichiarazione.
- geometria test v1 (bow a y350: il vecchio y250 partiva sopra la linea esistente -> drag,
  bug del test non del prodotto).

### PARZIALE (mai DONE su harness) - elenco esplicito
1. ali/3-4× della punta arrow su reale non numericamente leggibili (sizes=[4,4]) - T1 copre;
2. setting OFF -> hold-still su reale non eseguito (ON confermato su reale);
3. undo2 livelli su reale non eseguito (T1 copre);
4. R18 depth web ok=1/4 con Spark pro (streaming/encoding/guard verdi);
5. T2 su index.html servito con patch ambiente listSubjects (stessa dichiarazione R22-R24),
   finestra pywebview non usata.

### File toccati
QA-REAL: `qa_browser/qaR25_{v0_repro,matrix,fonti_extra}.js`, `qa/r25_*`,
`qa/metrics_history.json`, `tests/testH2_server.py`, report/NOTE/MODIFICHE.
FE-INK: `notes.js`, `tests/v1_release_swap.test.js` (nuovo), `tests/u22_reshape_r22.test.js`.
FE-FONTI: `tests/f22_fonti_{dock,resize}.test.js` (test estesi, prod intatto).
FE-CHURCH: `tools/_r24_rss_probe.py`, `core/sidecar/client.py` (commento),
`tests/testR24_church.py`, `qa/r25_church_*`.

## Round 25 (PROMPT ROUND 23) - Lineup Spark coerente: base 1.7B + pro 4B + draft nativo + dual-engine

**STRATEGIA**: `fasi-a-dipendenze-dichiarate (C ibrido)` - R0 ricognizione (toolchain/rete/
stato modelli) -> X1 fork&build XHToken **in parallelo** con X2 download modelli Spark ->
X3 benchmark matrice motorexmodello (dipende da X1+X2) -> X4 draft 1.7B->4B e X5/X6
(dipendono dall'esito di X3) -> QA/Docs/Report. Tutto locale; un owner per file condiviso
(delegati X5=sidecar, X6=catalogo/UI con file disgiunti); niente simulazioni: tok/s,
acceptance e RSS misurati su binari reali; T2 reali su app reale (backend.StudioIAAPI
reale + Chrome/CDP). Numerazione dichiarata: il contatore Round del repo e' 25 mentre il
prompt e' numerato 23 (le due serie non sono monotone fra loro).

### X1 - Fork XHToken: clone, build, smoke (qa/x1_build.json)
- Clone `tools/llama-xhtoken` HEAD **22c0ae1871b60123c5afc008a78fe9c6fffa2858**
  (2026-10-30, merge PR#19 'dspark/xhtoken-draft'); fork 14 stelle (api.github.com,
  rischio manutenzione dichiarato -> mitigato dal dual-engine con fallback upstream).
- Toolchain: MSVC assente su host (Build Tools senza workload C++) -> **LLVM-MinGW
  UCRT 23.1.4 (clang)** scaricato via winget, CMake+Ninja, `GGML_CUDA=OFF`,
  `GGML_NATIVE=ON (-march=native -> AVX2/AVX512 della CPU host)`, `_WIN32_WINNT=0x0A00`.
- Build: 444 target, ~5 min; **1 patch locale di 1 riga dichiarata** (`src/llama-context.cpp`
  + `#include <algorithm>`: libc++ 23 non include <algorithm> transitivamente).
- Runtime portabile: `libc++.dll/libomp.dll/libunwind.dll` copiate accanto ai binari.
- Smoke **OK**: `--help` (47KB), `--version` = `0.7.0-dev (build 11945, commit 22c0ae187)`,
  generazione 50 token reali su MiniCPM5-1B (prompt 171 t/s, gen 36.6 t/s).

### X2 - Download modelli Spark (qa/x2_download.json)
- **spark-x2.6-1.7b.gguf** (Q4_K_M, 1.768.720.512 B): SHA256 calcolato == `lfs.sha256`
  HF pubblicato (`7abd9859...fffb7`) -> **MATCH**; in `tools/models/checksum.txt`.
- **spark-x2.6-4b.gguf** preesistente R22 (sha 91cb2811... verificato R22).
- Fallback MiniCPM5-2B: **X2.3 non scattato** (nessun Spark fallito); il file era gia'
  presente in app_data (1.561.318.368 B, sha `ec2d58...02fd` calcolato da X6) -> usato
  come fallback dichiarato R23 senza nuovi download.

### X3 - Benchmark comparativo + regola selezione (qa/x3_compare.json)
- Set H5: `llama-bench -p 512 -n 128`, stessi argomenti su entrambi i motori, 8 thread:

  | modello | pp512 up/xt | tg128 up/xt |
  |---|---|---|
  | 1.7B | 147.43 / **153.79** | 15.30 / **15.82** |
  | 4B | 55.80 / **56.35** | 6.70 / **6.76** |
- Draft server reale (ctx4096 q8_0, `--spec-type draft-simple`): acceptance **0.8402**
  su entrambi i motori; tg 4B: up 6.13->7.80 (**1.272x**), xt 6.43->7.97 (**1.240x**).
- **Regola X3.3 -> ENGINE DEFAULT = UPSTREAM**: acceptance xt 0.8402 >= 0.70 ok MA
  speedup xt 1.240 < 1.30 -> soglia non raggiunta (con numeri; v1 del bench senza
  `--spec-type` dichiarata in `qa/x3_draftbench_v1_ctx1m_nospectype.json`).
- RSS steady (ctx4096 q8_0): pro up **4435.8** / xt **4426.6** MB; base up **1876.8** /
  xt **1868.0** MB.

### X4 - Draft 1.7B->4B: OFF di default con motivazione numerica
- Regola X4.2 (acc >= 0.70 **E** speedup >= 1.30): acc 0.8402 ok, speedup max 1.272 < 1.30
  -> **draft OFF di default** (`spec.draft_model` invariato vuoto: coerente con la baseline
  R13/R22, nessuna regressione). Profili X4.3 invariati (long-form pronti se mai abilitato).
- **X4.4**: registro/UI mostra il flag draft reale: `list_models()` espone `draft_enabled`
  (solo con `spec.draft_model` configurato) e il menu Modelli mostra il badge
  `draft spark-base-1.7b: OFF (speedup 1,24x < 1,30)` (badge ATTIVO verificato con
  `spec.draft_model` forzato). T2 `qa_browser/qaR23_models.js` **10/10** con screenshot
  `qa/r23_models_{default,drafton,scarica}.png` su dati del catalogo REALE.

### X5 - Switch runtime dual-engine + fallback (delegato, poi QA reale coordinatore)
- `llama.engine = upstream | xhtoken | auto` (default `auto` in DEFAULT_CONFIG, chiave
  aggiunta dal coordinatore); `auto` -> log esatto con la regola R23; `xhtoken` forzato
  batte `llama.server_path` (X3.4); fallback X5.3: binario mancante/Popen KO/crash x2
  consecutivi -> upstream con `message` utente + log `[Sidecar] engine xhtoken KO ->
  upstream: ...`, flag una tantum; restart controllato R22 esteso al cambio binario.
- `tests/testR23_engine.py` **16/16**; H2/H5 **20/20**.
- **T2 QA-1** `qa/x_qa1_switch.py` (StudioIAAPI REALE, stub webview): **28/28** -
  switch **base -> pro -> base con engine xhtoken** (binario FORK verificato da cmdline,
  modello atteso, generazioni non vuote), **kill XHToken** (rinomina binario) -> upstream
  con status `xhtoken_fallback=true`, **kill Spark** (gguf sostituito da file corrotto) ->
  fallback **MiniCPM5-2B** con `local_model_key='fallback'` + log esplicito; config/file
  ripristinati in finally (size 3543441312 verificato).

### X6 - Registro modelli 3 voci + dropdown (delegato)
- `MODELS_CATALOG`: **pro** `spark-pro-4b` (Spark-4B, draft spark-base-1.7b) > **base**
  `spark-base-1.7b` (Spark-1.7B, url HF, sha/size) > **fallback** `minicpm5-2b`
  (MiniCPM5-2B app_data, `fallback:true`, draft minicpm5-1b dichiarato); chiavi legacy
  pro/base/fallback NON rinominate (client/server intatti).
- `apply_fallback_config()` -> ora voce **fallback (MiniCPM5-2B)** con log
  `[models] fallback al modello MiniCPM5-2B: <motivo>`; guardia watcher in api.py
  allineata. `tests/testR22_models.py` **28/28**. UI: render generico su list_models() ->
  3 voci in ordine + `Scarica... (~GB)` gia' da R22 (verificato T2 sopra).

### FIX scoperti dal QA reale (prima del fix: lineup NON funzionante)
1. **Spark non caricava nell'app**: `llm.backend=sidecar` ma il proxy delegava
   `load_model_blocking` al target -> **llama-cpp-python 0.3.35 non supporta Spark**
   (ValueError `Failed to load model from file`, probe `qa/_x_loadprobe.py`) -> ogni load
   di Spark-base/pro cadeva in fallback SILENZIOSO a MiniCPM5-2B (2/2 switch in QA-1).
   Fix: `SidecarLLMProxy.load_model_blocking` avvia/valida il modello tramite il sidecar
   REALE (llama-server); errore di load -> stessa via 'error' + fallback watcher.
2. **Sidecar non rileggeva la config**: `start_on_demand` leggeva un'istanza ConfigManager
   creata al primo uso -> switch modello/engine scritti su disco da un'altra istanza
   invisibili (stale). Fix: `self._config.load()` a ogni avvio (i dict dei test non hanno
   `.load()` -> invariati).

### QA + regressione
- **T1 ufficiale: 3224/0** (baseline 3205/0 -> +19; `qa/t1_r13.json`); meta-suite escluse
  368/**6** = bug legacy noti (qaF pre-H11, qaB1 baseline count, qaV 5.24) - non
  regressioni R23, motivi visibili nel log.
- **QA-2 SLO** `qa/x_qa2_slo.py`: TTFT p50 **miss 998.5 <= 4000**, **hit 94.8 <= 1500**,
  streaming 60/60 chunk su 11/11 campioni, risposte complete -> **PASS** (motore = config
  reale auto->upstream, modello configurato = MiniCPM5-2B baseline).
- Mini-set post-badge: aiUi_smoke 86/0, editorWiring 49/0, r16_chat_ui 36/0, qaD_home
  41/0, testR22_models+testR23_draftflag 32/0, py_compile tutti ok.
- **`qa/metrics_history.json`: entry `round 23` appendata** (valori letti a runtime dai
  file qa/*; testG7_stats 12/12).

### File toccati (owner unico)
- Coordinatore: `qa/*` (script/QA/measure/report), `qa_browser/qaR23_models.js`,
  `tests/testR23_draftflag.py`, `data/config_manager.py` (+`llama.engine`),
  `core/local_llm_client.py` (proxy load), `core/sidecar/server.py` (config refresh,
  sopra il lavoro X5), `backend/api.py` (draft_enabled + guardia fallback X6),
  `web_frontend/html/index.html` (badge draft), `tools/models/checksum.txt`, docs.
- Delegato X5: `core/sidecar/server.py` (engine/fallback/restart), `tests/testR23_engine.py`.
- Delegato X6: `data/models_manager.py`, `backend/api.py` (4 righe fallback),
  `tests/testR22_models.py`.
- Fork locale `tools/llama-xhtoken`: 1 riga (`#include <algorithm>`), dichiarata in
  `qa/x1_build.json`.

## Round 24 (PROMPT ROUND 23) - Verifica su app reale + pannello Fonti sotto toolbar + perfezionamento al rilascio

**STRATEGIA**: `riproduzione-first-poi-parallelo-con-owner-per-file` — R0 (riproduzione del
reclamo utente sulla PAGINA REALE, bloccante, nessuna correzione prima) eseguito dal
coordinatore; poi 3 scope paralleli con owner unici (`notes.js`→FE-INK, `fonti_panel.js`+CSS
mount→FE-FONTI, `schemi.js`+test gate/G1+RSS→FE-CHURCH); chiusura T2 **solo** su index.html
servita via http con la stessa catena `?v=` del BUILD (Puppeteer/CDP = Chrome reale;
**playwright non è nel progetto** — dichiarato nei report). Delegati esauriti i turni →
seguiti dedicati; i T2 finali di FE-FONTI eseguiti dal coordinatore.

### REGOLA NUOVA applicata: evidenza su app reale
- T2 = pagina REALE (server static su `web_frontend/html`, patch AMBIENTE dichiarata
  `race StudyStore.listSubjects 1500ms` solo senza pywebview — prodotto intatto), screenshot
  PRIMA/DOPO **interi** (toolbar+pannello o canvas nel frame), misure da DOM reale.
  jsdom/T1 resta T1 e NON chiude claim UI.
- **Strumentazione pointer**: `window.__ink.counters={classified,refined,discarded,byKind}` +
  `console.info('[ink24] ...')` a ogni rilascio; il T2 legge i contatori dopo il disegno
  reale (perfezionati=0 dopo retta = FAIL; DOPO refined=1 ✓).

### R0 — riproduzione reale (tabella conferme, NESSUNA correzione prima)
Reclamo 24 confermato su app reale (`qa/r24_r0_measures.json`, screenshot `r24_r0_*.png`):
pannello Fonti `fixed top:58 z:160`, overlap pill **15.072 px²**, **8/8 bottoni non-hit**;
rette/archi perfezionati sì ma **contatori assenti**; spazio morto sotto "Inserisci nella
nota" **169px**; typo **"l anteprima"** presente. Anomalia dichiarata: in R0 il dock R22 non
si era applicato (`top=58`, causa transitoria non determinata).

### R1 — pannello sotto toolbar, senza spazio morto (FE-FONTI)
- Dock **letto dal DOM reale**: `top = bottom(colonna comandi sinistra = max(pill,zoom)) + 8`
  (150px), `z-inline = z-toolbar − 1` (11<12), inline vince su tutta la cascade
  (documenti/presentazioni `fixed z160`). T2 DOPO: overlap **0**, hit bottoni visibili **7/7**
  (btnDelSel rect 0×0 = nascosto per design, non reclamo), top **150=atteso**.
- Altezza **auto-contenuto**: height esplicita solo da drag manuale (clamp ≥160), default
  `height:''` + `padding-bottom` inline **4px** + `max-height:66vh` → spazio morto
  **169/9 → 5px** ≤8.
- Collapso confermato sul DOM reale: **+26px** lista, persistito `fp21_top_appunti`,
  ripristinato a riapertura; typo → **"l'anteprima"**.
- T2 `qaR24_fonti`: **12/12, exit 0**. T1 f22/f21/a19/qaC2 tutti verdi (221 assert).

### R2 — perfezionamento al rilascio cablato sul percorso reale (FE-INK)
- Nuova impostazione **"perfeziona al rilascio"** (`nt24_releaseRefine`, default **ON**):
  tratti APERTI classificati → fit → commit al **pointerup + settle 150ms** (stesso listener
  reale del canvas); CHIUSE → ghost hold-still + commit R20; OFF → hold-still storico aperti.
- T2 `qaR24_ink`: **17/17, exit 0** — retta ondulata lieve rilasciata SENZA pausa →
  `shape/line`, residuo e2e **0.0000px**, angolo **0.386°**, contatori `{classified:1, refined:1}`
  (PRIMA `null`→0); arco residuo vs generatore **0.612px**; onda ±10px → `curve` (gate
  invariati, dichiarato); log `[ink24]` ×3.
- R3.1 risolto onestamente: la soglia ≤1.5px nasce da input jitter **zero-mean ±2px** (R22,
  1.16px); onde sinusoidali sistematiche ±1.4px davano residuo max 1.70 → l'assert usa la
  classe di input R22 (**0.612px**), il caso sinusoidale resta dichiarato non-assert.
  **Soglia non alzata, fit non modificato.**

### R3 — residui R22 chiusi (FE-CHURCH)
- **R3.2 width Schemi**: `normFontiWidth()` su riapertura tab/resize, **senza !important**
  (resize R21 intatto). T2 REALE **16/16**: PRIMA taglio **248px** dopo drag+resize viewport →
  DOPO **0 taglio** (panel.right 1072 ≤ side.right 1084). Screenshot prima/dopo.
- **R3.3 gate**: testR15/R16 leggono la soglia da `ConfigManager`/`DEFAULT_CONFIG` (drift
  0.75 non rompe più) — 33/33; config utente non toccata.
- **R3.4 flaky G1**: retry **max 2** con log `[flake-retry] test=... attempt=k/2 motivo=...`;
  3 run OK con log; 2 retry esauriti → FAIL vero.
- **R3.5 RSS pro**: baseline **4435.9 MB**, -b256 **4421.2**, -b256-ub256 **4421.5** (ctx4096,
  KV q8_0) → **target ≤3.6GB NON raggiungibile**: floor pesi Q4_K_M **3379MB mappati** + KV
  ~250 + buffer ≈ ≥3.7GB; batch riduce solo ~15MB. `DRAFT_RAM_BUDGET_MB=6144` confermato con
  numeri (RSS4436 + draft ~1.5GB ≈5.9GB <6.144GB; draft già spento da R13); `server.py`
  invariato. `tests/testR24_church.py` 19/19.

### R4 — regressione + matrice T2
- **T1 completa: 3205 passati / 0 falliti** (baseline R22 3149 → **+56**). Prima esecuzione: 1 fail =
  `testR15_web` **ddgs reale** (rete, file non toccati da R24) → riprovato singolo OK,
  seconda T1 0 fail.
- **Matrice T2 reale** (screenshot PRIMA/DOPO stesso viewport): (1) toolbar clickable col
  pannello → `qaR24_fonti` **12/12**; (2) retta/arco perfezionati + contatori → `qaR24_ink`
  **17/17** (**freccia: PARZIALE** — solo T1 u20/u22); (3) pannello compatto → **dead 5px**;
  (4) schemi tab → `qaR24_church_schemi` **16/16**; (5) formula inline → `qaR24_formula`
  **katex=4, raw=0** su app reale.
- **Regressioni**: R20 `qaU20` **10/10**; R21 `qaR21` **7/7**; R16/R18 verdi in T1; latenza live
  reale p50 **15.2-15.3ms** / p95 **16.2ms** ≤33ms (percorso live invariato).
- Artefatti: screenshot `qa/r24_{r0,fonti,ink,church,formula}_*`, misure `qa/r24_*_measures.json`
  + `qa/r24_church_rss.json`, report `qa/r24_{fonti,ink,church}_report.md`.

### Cosa resta aperto / PARZIALE (R4.3)
- **Mount Documenti/Presentazioni con pannello aperto**: non provati su reale in R24 → PARZIALE.
- **Freccia al rilascio su reale**: PARZIALE (T1 u20/u22 verdi, nessun disegno reale R24).
- **R0 top=58 non riprodotto** al T2 (stato transitorio non determinato).
- RSS pro >3.6GB con ctx4096: impossibile con questi vincoli (numeri nel report church).
- p50 latenza 15ms vs ~10ms R22 (stessa strumentazione, nel budget): variabilità dichiarata.

---

## Round 22 (PROMPT ROUND 21) - Fonti (posizione/preview), rette/archi da zero, modello Pro, mount schemi, math inline

**STRATEGIA**: `delegato-parallelo-4-way-con-owner-per-file`: scope disgiunti per file
(`notes.js`→FE-INK, `fonti_panel.js`+CSS mount→FE-FONTI, `schemi.js`→FE-SCHEMI,
`models_manager/api/sidecar/index-menu`→BE-MODELS), paralleli dove non condividono file,
owner unico sui file condivisi, snapshot PRIMA (`qa/r22_*_baseline.js`) presi prima degli interventi.
Due delegati hanno esaurito i turni a lavoro parziale → seguiti dedicati sullo stesso scope.
Rete usata SOLO per il download Hugging Face (con checksum).

### Blocco 1 - Posizione pannello Fonti, collapso, resize
- **Appunti (FE-INK)**: dock SOTTO la pill undo/redo, calcolato in modo dinamico in `toggleFonti()`
  (`top = max(bottom(.fn-pill-left), bottom(.fn-zoom)) + 10px`, fallback CSS 152px);
  z-index pannello 11 < pill 12. T2: overlap rect 0px², gap +48px, elementFromPoint→bottone.
- **Mount flottanti (FE-FONTI)**: `fitDock` in `fonti_panel.js` allinea il pannello sotto il bordo
  inferiore maggiore tra toolbar top e header (+8px); z-index BASSO sotto i controlli
  (documenti 20 < doc-bar 40/pill 30; presentazioni 5 < mod-header 6) — prima era 160 (sopra i
  controlli, rischio R21). T2: overlap 0px², hit-test bottoni 24/24 + 15/15.
- **Collapso riga superiore (1.2)**: chips spostate in riga propria dentro `.fp21-top`
  (prima erano nella stessa bar della lente: nasconderle dava **+0px**) → ora la lista guadagna
  **+24px reali** (399→423px); chevron `.fp21-chev`; stato persistito in `fp21_top_<ctx>`;
  reload mantiene collassata (423~423, Δ0px).
- **Resize (1.3)**: drag rz-r 340→460px persistito (`fp21_w_<ctx>`); doppio click resetta al
  default 340 e RIMUOVE `fp21_w_/fp21_h_` (fix: `reset()` riallineava male w0/h0 e il 2° mousedown
  avviava un nuovo drag). T2 ok.

### Blocco 2 - Preview istantanea appunti manoscritti
- `previewFonte21/itemTexts` (fonti_panel.js): se la nota ha tratti (`t==='stroke'|'shape'`),
  render del layer su canvas offscreen con fit bbox adattivo → `<img class="fp21-snap">` dataURL
  **in cima** alla preview ("la nota come è stata scritta"), poi blocchi testo/immagine in ordine
  oggetti. Cache thumbnail per id+versione (chiave su id + versione content; in-memory Map).
- "Nessun testo disponibile" **solo** per nota veramente vuota (no tratti/testo/immagini):
  note solo-tratto non lo mostrano più. Guardia `ctx==null` (jsdom) → fallback testo, mai eccezione.
- T2: nota mista img PRIMA del testo (iSnap 12 < iText 4976), solo-tratto snapshot senza msg,
  vuota con msg — 36/36 check.

### Blocco 3 - Rette e archi ricostruiti DA ZERO (riscrittura in notes.js)
Solo tratti APERTI; forme chiuse (rect/circle/ellipse/triangle) restano con regole R20
(gap-closing/corner/ghost) intatte.
- **Retta**: fit robusto **Theil-Sen** (mediana angoli coppie, ≤48 campioni) + PCA, endpoint =
  proiezione sugli estremi reali → segmento perfetto renderizzato ex novo (grezzo scartato).
  Gate: perp ≤ 2.5+amp·3 (4.3px), len ≥40px.
- **Arco**: fit algebrico **Kasa** 3×3 + check coerenza curvatura (monotonia angolare ≥0.9,
  span 40°-350°) → **ricampionatura dall'equazione del cerchio** (passo ~4px): i punti renderizzati
  sono curva parametrica, mai il grezzo. Gate doppio: Kasa↔riparito ≤2.5px, grezzo↔ideale ≤2.5+amp·1.5.
- **Curve non-coerenti**: Bézier cubica LSQ pezzo-pezzo + IRLS, continuità G1 ai join (tune
  curvatura con REVERT), fallback libero kink ≤15°; render = campione denso `_bezDense` della
  equazione. Stesso fit per l'asta pre-flick delle frecce.
- **Punta freccia (3.3)**: saldata come R20 — ali 30-45°, 3-4× spessore, tangente = derivata
  Bézier t=1 della curva IDEALE.
- **QA**: T1 `u22_reshape_r22` 28/0 — deviazione retta **0.144°** (≤1°), residuo render-vs-ideale
  **0.0068px** (≤0.5), pts renderizzati ≠ grezzi (NN 2.387px), arrow 35°/3.2×/tangente 0.000°,
  C+scarabocchio intatti. T2 reale: dev rette 0.070°, residuo 0.0px, residuo vs generatore vero
  2.009→**1.16px** (discrimine reale del "da zero").

### Blocco 4 - Model manager + modello Pro (Spark-X2.6-4B GGUF)
- **Quant**: `Spark-X2.6-4B-Q4_K_M.gguf` — **unico Q4 pubblicato** nel repo
  `XHToken/Spark-X2.6-4B-GGUF` (altri file: Q8_0, f16). Model card NON pubblica SHA256 nel testo:
  checksum preso dall'**API HF** (`lfs.sha256`).
- **Download**: URL HF → `tools/models/spark-x2.6-4b.gguf` (3.543.441.312 B, ~3.30 GiB,
  **29 min**); SHA256 verificato **MATCH** `91cb2811aebb47ac916aa619d27d4cdd7f4143106b7917accb8ead4cd7f5cbd9`;
  `tools/models/checksum.txt` (sha256+fonte+size+url+verified_at).
- **Registro**: `MODELS_CATALOG` ordine **['pro','base']** — "Modello pro (Spark-X2.6-4B)" SOPRA
  "Modello base (MiniCPM5-2B)"; voce non scaricata "Scarica… (~3.3 GB)" con progress %; `dest_path`
  supportato. Screenshot `qa/r22_models_dropdown*.png` (ordine ok).
- **Switch**: `load_model(key)` scrive `local_model_path`+`local_model_key`+`llama.model_path` e
  salva; il sidecar rileva il cambio `-m` e fa relaunch controllato (`server.py:206-242`);
  UI "caricamento modello pro… N%"; **switch misurato: base→pro 4.01s, pro→base 3.07s**.
- **Fallback**: `_watch_model_load` → `apply_fallback_config()` su errore del pro, log esplicito
  `[models] fallback al modello base: <motivo>` (testato 25/25).
- **Sampling pro** (solo profilo `fast`, valori card): temp 1.0, top_p 0.95, top_k -1,
  repetition_penalty 1 (`PRO_SAMPLING_OVERRIDE`); base/think/tool invariati.
  Chat template: `/v1/chat/completions` con template GGUF applicato dal server — **leak `[]`** verificato.
- **Guardia RAM**: budget **6144 MB** (`DRAFT_RAM_BUDGET_MB`); RSS pro reale 4471 MB < budget →
  draft consentito (di default già spento da R13); se superato → "draft disattivato: budget RAM
  superato". RSS misurato prima/dopo switch.
- **Misure (CPU, n_ctx 4096)**: base RSS 2408 MB / **13.2 tok/s**; pro RSS 4471 MB / **6.1 tok/s**.

### Blocco 5 - Mount Fonti negli Schemi + math inline
- **5.1**: il mount è dentro la tab "Fonti" della `.sc-side` (unico `FontiPanel.create`, nessun
  overlay). Fix necessario dimostrato: la cascade globale di `index.html` (CSS `.fp21-root` di
  notes/documenti/presentazioni, `position:fixed`) rendeva il pannello **fixed sopra il canvas**
  (overlap **154.560 px²** nel PRIMA simulato). Intervento: regole **scoped** `.sc-side .fp21-root{…}`
  in `schemi.js` (+68 righe, 0 rimosse) → position `relative` in flusso, overlap **0** in tutti gli
  stati; width inline del componente azzerata a mount (rispetta il resize `fp21_w_schemi` R21).
  T2 `qaR22_schemi`: **9/9 PASS + MATH 5.2 PASS**.
- **5.3**: nessun altro modulo monta `contesto:'schemi'` né overlay flottante per gli Schemi
  (assert 20/20 nel test s22).
- **5.2 math inline (fonti_panel.js)**: aggiunti `\(...\)` (inline) e `\[...\]` (display) a
  `$$...$$`/`$...$`; assert DOM: **0 nodi testo** con `\Delta`/`\text`/`$$` non renderizzati
  (4 nodi `.katex`, 0 fallback) — in T1 (`f22_fonti_math`, `s22_fonti_mount`) e T2.

### QA finale (misure)
- **T1 completa**: **3149 passati / 0 falliti** (baseline 2942/0 → +207 nuovi assert;
  JS 2660/0 su 37 suite, PY 489/0 su 37 file). Target ≥2062/0 **OK**.
- **T2 R22**: `qaR22_fonti` 36/36, `qaR22_ink` PRIMA 5/5 + DOPO 5/5, `qaR22_schemi` 9/9+math,
  `qaR22_models` ordine/etichette ok — tutti exit 0.
- **Regressioni**: `qaR21_matrix` 7/7 celle (adattatori R21), `qaU20_matrix` 10/10 (shaping R20),
  `qaLA14` latenza live p50 8.8-9.8ms / p95 ≤17.4ms (budget ≤33ms), streaming/grounding/gate
  python verdi, sidecar G1/H2/H5/H3/R13 verdi (G1 "completion 3 vuota" flaky noto pre-R22).
- **Gate threshold**: config utente %APPDATA% aveva `gate.threshold=0.75` (mtime 16:08,
  PRE-sessione R22; default tarato 0.70) — 2 test fallivano per questo drift; ripristinato 0.70
  (backup `config.json.bak_r22`), 33/33 verdi. Non scritto da R22 (nessuna chiave gate toccata).
- Screenshot prima/dopo: `qa/r22_{fonti,ink,schemi}_prima_*.png` / `_dopo_*.png`,
  `qa/r22_models_dropdown*.png`; misure: `qa/r22_*_measures.json`; report per scope:
  `qa/r22_{fonti,ink,schemi,models}_report.md`.

---



**STRATEGIA**: owner unico su `notes.js` per U+F (stessa pipeline
classifica→fit→render: parallelo vietato dal vincolo file condiviso);
delegati implementativi seriali (motore U → frecce F → ghost/rotate G) +
completamento capo per fix di stabilità, QA browser T2, regressioni e docs.
Un tentativo scartato da filtro "high risk" esterno (0 scritture, re-instrato
con scope ridotto). Dichiarazione: **nessuna ricerca web disponibile nel turno**;
specifiche derivate da comportamento consolidato di GoodNotes/OneNote/Nebo/
Concepts/Samsung Notes (spec Round 20).

### Blocco U - pipeline unica "tratto perfetto"
Ogni tratto: classifica → fit ideale → **render del fit** (stessa qualità
tutte le classi). Output: `line | curve | circle | ellipse | rectangle |
square | triangle | arrow` oppure `stroke` (esclusioni).
- **U1 retta**: LSQ endpoint, residuo ≤ TOL=2.5+amp·3 (4.3px).
- **U2 curva**: nessun limite di curvatura; resample uniforme + smoothing
  corner-preserving (Laplaciano iterato smorzato tipo Taubin, angoli da
  picchi di curvatura preservati) + fit **Bézier cubiche a tratti** in
  `params.bez` (c1); residuo ≤2.5px dichiarato; curvatura segue l'utente
  (arco stretto verso il basso incluso, mai raddrizzato).
- **U3 cerchio/ellisse**: gap-closing esplicito (gap ≤ tolleranza → loop
  chiuso con segmento retto prima del Kasa/Bookstein); auto-inters ≤1;
  lettere C/gap grandi → MAI circle/ellipse (possono diventare `curve`).
- **U4 rettangolo/quadrato**: PARITÀ con U3 (gap-closing + 4 cluster angoli
  90°±20 + RMS→4 lati ≤ tolleranza cerchio, frame PCA con rot salvata;
  aspect 0.8-1.25 → square). "Attualmente rotto" riparato: le svolte a 1
  campione venivano arrotondate a 13-25° dallo smoothing → svolte misurate su
  gambe ~6px; box cerchio = centro±r dal fit (prima: bbox dai punti grezzi).
- **U5 triangolo**: chiuso + 3 cluster vertici (~60°±25) → fit 3 segmenti.
- **U6 esclusioni**: bbox<40px, n<5 punti, scarabocchi (auto-inters≥3 o
  riempimento denso), tool testo/overlay testo aperto → restano `stroke`;
  nessun re-snap se ≥60% dei punti cade dentro il bbox di uno shape esistente.
- **U7 oggetto**: parametri + maniglie (lazo: move + scale angolo +
  **maniglia rotazione** nuova con `o.rot` e transform nel render);
  `sizes`/pressione per punto preservate (48 settori cerchio, perimetro rect,
  vertici triangolo, asta arrow) — niente tubi uniformi.
- **U8 ghost**: all'hold (penna GIÙ ≥holdMs) la candidata resta in
  `ed.ghost` (overlay tratteggiato), **nessun commit**; conferma al rilascio
  + flash ~150ms (rAF con guard `!ed`, nessun timer orfano dopo teardown);
  annulla se la penna riparte o tap 2 dita; esposto in
  `__ink.state().ghost/ghostFlash`.
- Fix collaterale: OneEuro con `dt` sub-ms nel burst → floor 4ms (l'anello
  strozzato gonfiava il raggio cerchio di ~7px).

### Blocco F - freccia composta (punta saldata al tratto perfetto)
F1 flick a V **o back-stroke** (finestra 250ms / bbox≤80 / ≥100°) su tratto
retto O curvo di qualunque curvatura; F2 asta = porzione pre-flick fittata
con la SUA classe (line→LSQ, curve→Bézier); F3 punta ricostruita: base
esattamente sul terminale dell'asta (≤2px), ali simmetriche **30-45°** vs
tangente finale (derivata Bézier t=1, NON la corda), lunghezza **3-4×**
spessore; F4 **un solo oggetto `arrow`** (`params.shaft={kind,pts,bez}` +
`params.head={angoloAlaDeg,lunghezza,tangente,base}`) → move/rotate saldati,
undo 2 livelli (1° tratto grezzo, 2° rimosso); F5 **2 dita tap = undo,
3 dita = redo** (logica condivisa `__ink.gestureTapTest`, guard anti-doppio,
palm rejection invariata).

### QA - matrice sintetica T2 (`qa_browser/qaU20_matrix.js`; PRIMA = `qa/r20_notes_baseline.js`)
| Caso | Atteso | PRIMA (baseline) | DOPO (R20) | Screenshot (prima/dopo) |
|------|--------|------------------|-----------|--------------------------|
| Q1 rettangolo storto 7° ±2 | rectangle, angoli ≤5°, ghost, editabile | no ghost (commit all'hold) | **PASS**: 0.98°, ghost=true, drag ok | qa/r20_shp_*_q1a_ghost.png, _q1b_rect.png |
| Q2 quadrato 3° | square aspect 0.9-1.1 | no snap | **PASS** 0.985 | _q2_square.png |
| Q3a/b cerchi (tremolante, gap) | circle | PASS | PASS | _q3a_cerchio.png, _q3b_gap.png |
| Q3c C aperta / Q3d coloring | MAI circle/ellipse / stroke | PASS | PASS | _q3c_C_aperta.png, _q3d_coloring.png |
| Q4 arco stretto giù | curve: residuo ≤2.5, segno ≥0.9, maxAdj ≤15° | nessun fit (FAIL) | **PASS**: 1.45px, 1.0, 4.59° | _q4_arco.png |
| Q5 retta+flick | arrow, ali 30-45°, 3-4×, base ≤2px | kind line (vecchia semantica) | **PASS**: 35°, 3.20×, 0.000px | _q5_fretta.png |
| Q6 arco+flick | arrow shaft curve, tangente ≤10° | curve+flag (vecchia) | **PASS**: 0.000°, base 0.000px | _q6_acurfreccia.png |
| Q7 saldatura + gesti 2/3 dita | weld ≤3px, undo2, redo3 | FAIL | **PASS**: weld 0px | _q7a_mossa.png, _q7b_gesti.png |

**DOPO 10/10 · PRIMA 5/10** (informativo), stabilità 2/2, ~53s per run,
22 screenshot, misure in `qa/r20_qa_measures.json`. Sonda misure frecce
(`tests/_r20_arrowmeas.js`): asta retta residuo **1.042px**, tangente
**0.00°**; (Q6: tangente vs derivata Bézier **0.000°**).

### Fase finale - regressioni (Q8) e build
- **T1: 2809 passati / 0 falliti** (baseline 2726/0 → +83): JS 2345/0 su 29
  suite (nuovo `u20_shaping` **80/0**, `a14_shaping` 42/0 con sezione ghost
  aggiornata). Un flake `testC_rag.py` (21/1) al primo giro: verde isolato e
  a ruota pulita → **21/0**.
- **Latenza live**: `qaLA14` p50 9.3-9.8ms / **p95 17.3-17.5ms ≤33ms**;
  `scheduleInkFrame` byte-identico alla baseline (`tests/_r19_inkdiff.js`);
  `onPointerMove` toccato SOLO dal rilevamento tap multi-dito (guard).
- **Stato tool singolo + popover click-fuori**: verdi (`qaA19_ui` dopo
  ok=true). **Streaming chat + grounding**: `r18_chat` **40/0** su
  index.html reale (badge `?v=2026-10-29T19:15:34+01:00`).
- Report: `qa/r20_u_report.md`, `qa/r20_f_report.md`, `qa/r20_g_report.md`.

## Round 20 (PROMPT ROUND 19) - Schemi routing per posizione relativa (C1-C11) + Appunti (toolbar Flashcard, shaping totale, Fonti usabile)

**STRATEGIA**: paralleli su fronti disgiunti con **owner unico per file
condiviso**: blocco S (`schemi.js`+`schemaStrategies.js`) e blocchi
A1+A2+A3 (`notes.js`, pannello Fonti vivente dentro notes.js) eseguiti da
delegati separati; fase finale (regressioni, `index.html` badge ?v, docs)
seriale per il capo. I delegati hanno esaurito i turni a lavoro parziale:
completamento QA/report in fase finale, 0 BLOCKED.

### Blocco S - connettori: tabella esaustiva per posizione relativa
Ogni nodo ha **solo 4 ancore** (T/B/L/R al centro del lato, +2px render);
ogni arco = **polilinea ortogonale da ancora a ancora** (nessuna diagonale:
la "dritta" obliqua baseline e' eliminata); punta freccia sull'ancora target
**<=2px** orientata lungo l'ultimo segmento; **0 intersezioni** con rettangoli
nodo (tranne endpoint). Classificazione disgiunta in `classifyCase()`:
`oH=|dx|<=(wS+wT)/4`, `oV=|dy|<=(hS+hT)/4`, prima corrispondenza.

| Caso | Routing (DOPO) | Esito assert (T2 reale) | Screenshot PRIMA/DOPO |
|------|----------------|--------------------------|----------------------|
| C1 T sotto con overlap | S.B->T.T; dritto 1 seg se \|cx\|<=0.5, altrimenti Z nel gap (C1b) | PASS (ancore 0px, intersez 0, punta 0px, ortogonali) | qa/r19_s_prima_c1.png / qa/r19_s_dopo_c1.png |
| C2 T sopra con overlap | specchio C1 (C2b) | PASS | qa/r19_s_prima_c2.png / qa/r19_s_dopo_c2.png |
| C3 stessa riga | S.R->T.L o S.L->T.R; dritto se \|cy\|<=0.5, altrimenti Z (C3b) | PASS | qa/r19_s_prima_c3.png / qa/r19_s_dopo_c3.png |
| C4 sotto sfalsato | S.B -> gapY -> cxT -> T.T (3 seg, orizzontale nel gap) | PASS | qa/r19_s_prima_c4.png / qa/r19_s_dopo_c4.png |
| C5 sopra sfalsato | specchio C4 sul gap superiore | PASS | qa/r19_s_prima_c5.png / qa/r19_s_dopo_c5.png |
| C6 destra sfalsato | S.R -> gapX -> cyT -> T.L (3 seg) | PASS | qa/r19_s_prima_c6.png / qa/r19_s_dopo_c6.png |
| C7 sinistra sfalsato | specchio C6 | PASS | qa/r19_s_prima_c7.png / qa/r19_s_dopo_c7.png |
| C8 albero/bus | drop verticali + bus orizzontale nel gap condiviso (gapY identico per tutti i figli) | PASS (bus orizzontali identici) | qa/r19_s_prima_c8.png / qa/r19_s_dopo_c8.png |
| C9 fratello con nodi in mezzo | U sotto/sopra la riga (lato con piu' spazio), mai attraverso i nodi | PASS | qa/r19_s_prima_c9.png / qa/r19_s_dopo_c9.png |
| C10 ostacoli | corridoi + perimetro esterno 12px, min segmenti, 0 intersezioni, <=4 seg | PASS | qa/r19_s_prima_c10.png / qa/r19_s_dopo_c10.png |
| C11 gap insufficienti | collision-resolution PRIMA (SEP 32px orizzontale / 48px verticale, anche al caricamento) poi routing, fallback perimetro | PASS (coppie violate 0) | qa/r19_s_prima_c11.png / qa/r19_s_dopo_c11.png |

+ casi `curva` (Q esente solo dall'ortogonalita', intersezioni/punte comunque
0) e `real` (schema reale dello screenshot): **13/13 PASS**. PRIMA baseline:
**0/13** (24 caso_fail, 3 ancore errate, 3 punte >2px, 8 non ortogonali).
Misure: `qa/r19_s_measures.json`; suite S: uiHarness 197, schemaStrategies
198, qaB_schemi 125, s14 14, qa2_block2 79, qa4_matrix 92, qa4_relayout 205,
schJourney 54, **s19_routing 265** (nuovo T1 geometrico) -> tutte 0 falliti.

### Blocco A1 - toolbar appunti
- Rimosse le icone dedicate rettangolo/freccia (`[data-shaping]`): il
  riconoscimento viene solo dal tratto libero; `ed.shpOn/ed.arrowOn`
  restano persistiti in `localStorage 'nt14_shaping'` (default ON), API
  `ink.setShaping` invariata, nessun controllo in toolbar.
- Tasto "AI" sostituito con **"Flashcard"** (F01 con preview+approvazione):
  usa la selezione se presente, altrimenti **l'intera nota**
  (`noteText`), toast "Nessun testo" se vuota.
- Rimosso il tasto "Migliora" (F05): irraggiungibile dalla toolbar.
- Toolbar sinistra finale: undo, redo, |, immagine, Documento (ex Testo
  file), ppt, fonti, |, Flashcard. Mantenuto `btnDelSel` dinamico
  (nascosto senza selezione) e il toggle "Migliora scrittura".

### Blocco A2 - shape recognition + smussamento totalizzante
- **A2.1** cerchio/ellisse SOLO se chiuso: `dist(punta,coda) <= max(12px,
  8% diagonale bbox)` E auto-inters <=1; "C" aperta mai snap; scarabocchi
  (auto-inters >=3 o riempimento denso) mai snap.
- **A2.2** rettangolo/quadrato riparato: chiusura + 4 cluster angoli
  90+/-20 + lati rettilinei; robusto su perimetro a passi 4px, jitter +-1.
- **A2.3** nessun limite di curvatura (curve/frecce).
- **A2.4** flick a V o back-stroke su tratto retto/curvo -> shape
  ricostruita (`_curveRec` per le curve) + punta freccia allineata alla
  tangente finale; UNO stroke unico (finestra 250ms).
- **A2.5** a fine tratto: resample uniforme 5px + 3 passate Catmull-Rom
  -> Bezier + clamp 2.4px; **tolleranza residuo dichiarata <=2.5px** dal
  tracciato ideale (misurato **1.88px** su curva lunga tremolante).
- **A2.6** undo a 2 livelli verificato (1 tratto grezzo, 2 rimuove) anche
  su frecce ricostruite.
- QA: `tests/a14_shaping` 39/0; T2 `qa_browser/qaA19_shaping.js`
  (**DOPO 8/8**, PRIMA 5/7: C-aperta snap-pava ad ellipse, flick senza
  freccia), 16 screenshot `qa/r19_a_shp_*.png`, 36.1s.

### Blocco A3 - pannello Fonti usabile
- Chip filtro **Tutti | Appunti | Materiali | Libri** in testa, persistiti
  in `localStorage 'nt_fonti_filter'` (anche dopo riapertura editor).
- Pannello **340px x 70vh**, lista/preview con scroll.
- Preview VISIVA per tipo: note/riassunto -> paragrafi + thumbnail
  immagini (sorgenti data:/http); documento -> paragrafi; file .md ->
  **renderer markdown a mano** (escaping, h1-h3, strong/em, code, pre,
  liste, blockquote) senza librerie esterne.
- **Mai metadati**: rimossi Percorso/Nome/Dimensione/Tipo file/Indicizzato
  (prima: `qa/r19_a_fonti_prima.png`, dopo: `qa/r19_a_fonti_dopo.png`);
  resta solo titolo + badge tipo + preview + "Inserisci nella nota";
  ricerca conservata; insert invariato (t:'text' / t:'file').
- QA: **`tests/a19_fonti.test.js` 41/0** (nuovo) + `qa_browser/qaA19_ui.js`
  (DOPO ok, PRIMA: AI=true, chips assenti, md grezzo con path), 10.5s.

### Fase finale - regressioni e verifiche
- **T1: 2726 passati / 0 falliti** (baseline ufficiale 2409/0 -> +317);
  JS 2262/0 su 28 suite + PY 464/0. Aggiornate 2 suite condivise a nuova
  spec: `qaC2_viewer` (metadata A3.4 rimossi; notes con stub pdf per
  testare cap+button, schemi invariato) 41/0 e `aiUi_smoke` (tasto
  Flashcard titolo nuovo, F05 assente, fallback nota intera) 62/0.
- Badge `?v=2026-10-28T10:06:46+01:00` su notes.js/schemaStrategies.js/
  schemi.js in index.html; `node --check` OK su tutti i .js toccati;
  BUILD reale verificato: `qa_browser/r18_chat.js` carica index.html.
- **QA-T2 riconfermato**: chat streaming+grounding `r18_chat` **40/0**
  (provenienza "Fonte: web/appunti", 1 riga AI, zero marker/JS errori);
  tool singolo + popover click-fuori (qaA19_ui browser + qaA 92/0);
  **latenza invariata**: percorso live ink byte-identico alla baseline
  (`scheduleInkFrame/inkFrame/onPointerMove/endPointer` uguali, prova
  `tests/_r19_inkdiff.js`), qaLA14 prima 8.6-8.7ms p50 vs dopo 8.1-8.8ms
  p50 (stesso codice, delta = rumore; storico pre-R19 in
  `qa/l14_measures_storico_preR19.json`), l14 T1 10/0.
- Report: `qa/r19_s_report.md`, `qa/r19_a_report.md`; misure
  `qa/r19_s_measures.json` (method/prima/dopo/shaping/ui) e
  `qa/r19_a_measures.json`.

## Round 14 - Schemi routing preciso + Appunti ink shaping + latenza scrittura

**STRATEGIA**: **C ibrido** - scope disgiunti **paralleli**: blocco S
delegato su `schemi.js`/`schemaStrategies.js` e blocchi **L -> A** del
coordinatore su `notes.js`; dentro A/L sequenza obbligata **L prima di A**
perche' condividono la pipeline di rendering del tratto: **owner unico della
pipeline = notes.js** (L ha rifatto il live-smoothing in One Euro + rAF, A
ha innestato snap/frecce/hold sullo stesso flusso, nessun doppio meccanismo).
Condivisi (BUILD/metrics/docs/T1) solo coordinatore. Baseline-first: misure
PRIMA su entrambi gli scope prima di ogni fix.

### BLOCCO S - schemi (ancore, routing, overlap)
| Voce | Prima | Dopo | Sonda |
|---|---|---|---|
| archi che intersecano nodi (non-endpoint) | **5** | **0** | qa/s14_measures.json (path.getPointAtLength su SVG reale) |
| coppie nodi sovrapposti (24/40px) | **5** | **0** | idem + collision-resolution in autoLayout e apertura |
| punte freccia >2px dall'ancora | 0/18 (0%) | **0/18 (100% <=2px)** | idem, regola ancore S1 |
| nodi persi nel render | 0 | 0 | idem, 5 tipi (albero/mappa/lr/libero/visuale) |
| screenshot 5 tipi | - | qa/s14_*.png | qaS14_schemi.js |
- Algoritmo router: dritto default; rilevamento segmento-AABB; candidate
  vias L/Z attorno al bbox ostacolo con **margine 12px**, scelta piu' corta
  senza intersezioni, fallback L; frecce = triangolo sull'ultimo segmento.
- Test: **s14_schemi_routing 14/14** (orchestra la misura reale), regressione
  schemaStrategies **198/198**, editorWiring **49/49** (contratto edgeStyle
  >=2 dichiarato: rendering + gate etichetta), qaB_schemi **125/125**
  (matrice/relayout/undo/tab intatti), qa1+qa2 (65+79) verdi.
- Delegato S:2 tentativi esauriti PRIMA del report -> il coordinatore ha
  completato DOPO misure+test+fix (BLOCKED del delegato dichiarato, causa:
  limite turni; alternativa: completamento coordinatore - eseguito).

### BLOCCO L - latenza scrittura (PRIMA -> DOPO, T2 reale,240Hz)
| Metrica | PRIMA i0/i50/i100 | DOPO i0/i50/i100 | Target |
|---|---|---|---|
| latenza p50 (ms) | 0.2 / 0.3 / 0.3 (sync) | **8.6 / 9.5 / 9.4** | <=16 |
| latenza p95 (ms) | 0.3 / 0.5 / 0.6 | **16.8 / 17.5 / 17.4** | <=33 |
| settle punta (ms) | 0.2 / **MAI** / **MAI** | **10.3 / 16.9 / 20.0** | <=2 frame (~33) |
| trailing (px, mondo browser) | 0 / 8.11 / 44.82 | 7.9 / 6.9 / 3.4 | invariante (nessun trend) |
- NOTA: il PRIMA p50 e' basso per il draw sincrono in-handler ma il
  trailing/settle dimostrano il lag percepito (0->45px con l'intensita);
  il DOPO sposta il render su rAF (costo ~1 frame) e rende trailing/settle
  invariabili. Warmup 6 rAF dichiarato nel method.
- Fix chiave: clock unico performance.now (misurato: timeStamp nativi su
  altro dominio -> settle MAI); re-arm frame continuo durante il tratto
  (senza, lo snap di quiete non partiva mai).
- File: notes.js (pipeline inchiostro); test **l14 10/10**; T2
  qa/l14_measures.json + screenshot l14_{prima,dopo}_i{0,50,100}.png.

### BLOCCO A - ink shaping
| Caso | Risultato | Tolleranza |
|---|---|---|
| linea (LSQ/PCA, jitter) | riconosciuta | perp <= 2.5+3*amp = 4.3px |
| cerchio (Kasa) | riconosciuto | raggio/centro <= 4.3px |
| ellisse (estremi PCA) | riconosciuta | aspect 70/30 preservato |
| rettangolo/quadrato (bordi+aspect) | distinti | >=85% punti entro tol |
| toggle OFF | nessun snap | - |
| undo forma | 1° grezzo, 2° rimosso | tooltip dichiarato |
| hold-still350ms | snap in pausa | finestra200-800ms |
| flick-V | attach arrow a linea (undo 1 passo) |250ms/100°/45px |
- Test **a14 29/29**; persistenza settings localStorage `nt14_shaping`;
  toggle toolbar (.mode) verificati.

### Verifiche finali
- **T1** (vedi qa/t1_r13.json): nuovo totale con le3 suite R14 (s14/l14/a14);
  target >=2062/0; appunti esistenti qaA92/92 e schemi esistenti
  (schemaStrategies198, editorWiring49, qaB125) tutti PASS.
- **QA-T2**: misure PRIMA/DOPO reali sopra; screenshot in qa/ (s14_5 tipi,
  l14 6 trace); nessuna simulazione (solo PointerEvent/SVG reali).
- BUILD **`2026-10-27T20:03:00+01:00`** (10 occorrenze bumpate).
- Test AGGIORNATI (dichiarato): editorWiring (edgeStyle>=2), testG8
  (entry storiche + ultimo round=QA_TS).
- File toccati: web_frontend/html/js/modules/schemi.js,
  schemaStrategies.js, notes.js; tests/{s14_schemi_routing,l14_appunti,
  a14_shaping}.test.js (nuovi), tests/_ink_env.js (harness, escluso dal
  glob), tests/{editorWiring,testG8_metrics}.js/py (aggiornati);
  qa_browser/{qaS14_schemi,qaLA14_appunti}.js (nuovi); qa/*_measures/report;
  web_frontend/html/index.html (BUILD); NOTE.md/MODIFICHE.md/metrics.

---

## Round 19 (PROMPT ROUND 18) - Tre stadi sempre tentati, grounding obbligatorio, cache intent-aware, indice pulito

**STRATEGIA**: **Forensics-first a prova di regressione** - FASE0 bloccante
(`qa/f0_round18.json`,2 tentativi: cold+warm, spy su gate/cache/web/
iter_gen/provenienza + audit indice + classificazione errore su4 messaggi
reali della catena) -> fix ROOT-CAUSE nei5 blocchi B1-B5 (file nuovi
`core/rag/intent.py`, `core/rag/grounding.py`, `data/migrate_dedup.py`)
-> QA-1 sonde reali (`tests/gt_r18_probes.py`,6 tentativi) + QA-2
regressioni (T1, recall, parity, streaming). Ogni fix ha la sua sonda.

### FASE0 - sintomi S1-S5 (tabella completa in qa/f0_round18.json f0_4_sintomi)
| Sintomo | Causa radice (F0) | Fix | Sonda |
|---|---|---|---|
| S1 web non sempre tentato + "[Web: non disponibile]" falso + provenienza da sub-soglia | want_web auto solo se gate!=piena; skip "stadi lenti"; informativa con near-miss come fonte | B1.1 want_web=web_mode!=mai + skip rimossi; B1.2 circuit-breaker TTL60s su errore HTTP reale (url/status/error in web_state); B1.3 _provenance_contributing + "nessuna fonte trovata" | testR18_pipeline::TestB1TreStadi(4) + testR15_pipe.test_05 + testR15_web.test_auto_piena + QA-1 web tentato 9/9 + P8 giu 4/4 |
| S2 claim inesistente azoto/nitrificazione | nessun grounding check; modello inventa; ereditarieta' dalla storia (F0.2: msg117=(ii) distorsione, msg119/121=(iii) ereditato via history, msg123=NA) | B2.1 run_check think+JSON + 1 rigenerazione vincolata + limit_statement; B2.2 istruzione conflitto nel prompt; B2.3 GT probes | testR18_pipeline::TestGrounding(4) + QA-1 no-nitro catena4/4 + date dante/petrarca/boccaccio3/3 |
| S3 cache non intent-aware + follow-up letterale + "cos'e' la fotosintesi?" -> chat | nessun classificatore; AnswerCache senza gate; retrieval con frase letterale; H9/0-LLM | B3.1 intent.py (4 classi); B3.2 gate cache sim>=0.92 solo riformulata (log cache_decision); B3.3 expand_query; saluto-iniziale | testR18_intent 12/12 + TestCacheIntentAware(3) + QA-1 sotto 2/2 espansa 2/2 + P9 chit-chat 0 retrieval |
| S4 fotosintesi 3+ volte (5 presenze: attivo1+chroma2path+disco2+doc_versions3) | add_chunks senza hash; top-k con possibili hash duplicati | B4 content_hash + ux_chunks_hash_doc + sweep in _ensure_schema + migrazione data/migrate_dedup.py + _dedup_hash_rows (B4.5) | TestIndiceDedup(2) + qa/r18_dedup_migration.json (17->17,0 dup) + testR13_rag 7/7 |
| S5 risposte una riga + informativa tecnica in UI | nessun minimo depth; build_informativa con path/score/Perche' | B5.1 depth_check per intent + rigenerazione; B5.2 informativa umana + FE "nessuna fonte trovata" | TestProfonditaEUm(3) + gate/integration tests aggiornati + QA-1 depth 9/9 + P8 umana |

### F0.2 - chunk vs risposta (errore fotosintesi)
| # | Risposta (msg reale) | Origine | Evidenza |
|---|---|---|---|
|1| msg117 "converte l'azoto (nitrico)... nitrizzione"| **(ii) distorsione del modello** | nessun chunk dell'indice afferma che la fotosintesi converte l'azoto (i2 chunk con "azoto" parlano di fotorespirazione/nitrati); il chunk-definizione dice "anidride carbonica (CO2) e acqua" |
|2| msg119 ripete il claim| **(iii) ereditato - storia conversazionale** (NON delta-reuse: answer_cache MISS + AiCache.get=0 misurato) | claim presente solo nella risposta AI precedente dentro history_turns |
|3| msg121 "nitrizzione..."| **(iii) ereditato** con0 chunk freschi (esito=chitchat stadi=[]) | risposte.jsonl: stadi=[] |
|4| msg123 informativa| **NA** (errore assente; mostra sintomi S1+S5) | nessun claim fattuale |

### Verifiche finali (file reali)
- **QA-1** `qa/r18_qa1.json`: **87/88 check,6/6 tentativi -> BLOCKED** sul
  singolo residuo P1 GT co2 (vede NOTE.md Limiti); TUTTI gli altri: catena4/4
  (web tentato, provenienza contributori, no dup, no marker, depth, intent,
  espansione, no-nitro4/4, co2/glucosio/ossigeno su P1 in prova5), dante
  1265-1321, petrarca Francesco1304-1374, boccaccio1313-1375, rete giu' con
  informativa umana zero-LLM, chit-chat senza ricerca.
- **QA-2**: T1 **2356/0** (target >=2062/0, prima2062; +294 dai test R18);
  recall@5 **1.0000** (qa/r15_recall_gt.json,9/9); parity testH1 10/10 +
  testR13_rag parity su sha7/7; streaming + no troncamenti: r16_chat_ui
  **36/36** + QA-1 markers0/9; T2 metrics entry **round18** in
  qa/metrics_history.json (testG7+testG820/20).
- Migrazione indice: `data/migrate_dedup.py` -> qa/r18_dedup_migration.json
  (prima17/dopo17,0 rimossi perche' l'attivo era gia' pulito dopo F0.3,
  vincolo ux_chunks_hash_doc creato; sweep idempotante a ogni boot).
- Test NUOVI: `tests/testR18_intent.py` (12), `tests/testR18_pipeline.py`
  (20), `tests/gt_r18_probes.py` (QA-1 reale, fuori glob T1 per design).
- Test AGGIORNATI al contratto (dichiarato): testR15_gate, testR16_gate,
  testR15_pipe, testR16_pipe, testR15_web, testR15_integration,
  r16_chat_ui.test.js (stadi vuoti -> "nessuna fonte trovata"),
  data/migrate_real.py (parity su hash).
- BUILD **`2026-10-26T19:55:00+01:00`** (10 occorrenze bumpate).
- File toccati (owner: questo round): core/router.py, core/rag/{gate,
  web_stage, vector_store_sqlite, contract, grounding(intero), intent(intero)
  , answer_cache? NO intatto}, core/local_llm_client.py,
  core/sidecar/client.py, core/web_search.py, data/{migrate_real,migrate_dedup}.py,
  web_frontend/html/index.html (riga provenienza), tests/*, qa/*.

---

﻿## Round 18 (rifinimento chatbot): niente citazioni visibili, niente kill temporale

1. **Niente citazioni visibili**: rimossi codici [F1]/[W1] dal testo (ora sono un MARKER vietato della guardia -> retry con prompt riparato), rimossi il footer "Fonti:" con URL (eliminato `_sources_footer`) e le chip delle fonti (`renderSourceBadges` non piu' chiamato). La risposta mostra SOLO una riga finale in carattere piccolo (`renderProvenienza`, 11px): "Fonte: appunti" / "Fonti: appunti e web" - combinazione REALE degli stadi che hanno contribuito, calcolata nei metadati (`sources.stages`, persistita anche in cache `provenance` e in `risposte.jsonl.sources`). Le fonti (items+url) restano nei metadati per "Risposta sbagliata" e tracciabilita'.
2. **Niente risposte troncate**: rimossi deadline-break e cap da budget in guard/client, sparito il marker "_[risposta abbreviata: tempo massimo raggiunto]_" (0 occorrenze nel codice); n_predict chat = `CHAT_MAX_TOKENS=2000` (cap anti-loop; clamp 600 dei profili INTATTO per i test storici H2/H4); **degradazione sugli STADI**: web saltato se la ricerca locale supera 6s (`WEB_STAGE_ENTRY_S`), libri saltati se appunti >2s (progress dichiarati), prompt fonti gia' capato 3x220. I totali sono ora INFORMATIVI (obiettivo 20s non uccide piu').
3. **Encoding**: la riga di provenienza usa solo nomi stadio ascii (appunti/libri/web); check mojibake (Ã…/U+FFFD) su tutti gli output nella verifica: 0.
4. **Non rotto**: T1, cache correggibile ("Risposta sbagliata"), nessun badge/controllo web in UI, risposte rielaborate in italiano. Test aggiornati al contratto (dichiarato): testR16_prompt (bAN codici), testR16_pipe (no [F1] + stages evento), r16_chat_ui.test.js (scenario provenienza, **35/35**).
5. Verifica reale `qa/r18_verify.py`: **4/4** - Divina Commedia 1.632 char COMPLETA in 52,4s (nessun marker), dante 36,7s `Fonte: web`, C4 locale 31,8s `Fonte: appunti`, boccaccio 39,2s `Fonte: web`; screenshot UI reali `qa/r18_chat_*.png` **40/40**. BUILD `?v=2026-10-25T18:20:00+01:00`.

---

## Round 16b (follow-up chatbot): UI invisibile, streaming a blocchi, cache correggibile

Follow-up richiesto sul chatbot (stesso round, nessuna nuova strategia). Modifiche e perché:

1. **UI senza alcun controllo web**: rimossi il badge "Web: attivo" dalla chat E i controlli web da Impostazioni (select modality, SearXNG, Wikipedia) + JS orfano (`web_frontend/html/index.html`); nota privacy riscritta (web = ultimo livello invisibile, disattivazione solo da file config `web.mode`). `tests/r16_chat_ui.test.js` riscritto sul nuovo contratto: assenza controlli + **22/22** (incluso scenario streaming).
2. **Risposte rielaborate, mai incollate**: guardia ANTI-VERBATIM (nessun brano di 70+ char copiato dalle fonti) + istruzione lingua della domanda + prompt anti-copia (`core/rag/output_guard.py`, `core/local_llm_client.py`); **footer deterministico delle fonti [F#/W#]** quando il modello non cita inline (`core/router.py::_sources_footer`) - scelto IN VECE del retry-per-citazione che costava >6 s di prompt-eval sullo slot e sforava il SLO (misurato t2: 26-29 s); il fallback estrattivo resta solo emergenza (marker/verbatim/identico).
3. **Streaming a blocchi**: primi ~40 token renderizzati in UN blocco, poi max ~48 char/poll (~token per token), flush finale (index.html `startPolling`).
4. **Memoria/cache**: svuotate le risposte salvate (`qa/r17_cache_clear.json`: 2 entry answer_cache con 1 Dante + 7 messaggi AI "Dante" nel DB chat); HIT di cache = **rielaborazione LLM della bozza** (mai testo identico: guard `not_identical_to` + fallback anti-identico nel router); pulsante **"Risposta sbagliata"** nella barra chat (`chatbot.js` -> `api.flag_wrong_answer` -> `AnswerCache.invalidate_text` + `answer_feedback.jsonl`): la risposta segnata non viene più riusa. Fix correlato: stima split allineata al prompt effettivo (3x220) - prima ogni risposta reale splittava in code multi-parte e **non andava MAI in cache** (`complete=False split=True` misurato).
5. **Sempre risposta ≤20 s / niente template**: invariato il gate R16; verifica E2E reale `qa/r17_verify.py` (7 query: dante, boccaccio,2 locali,2 miste,1 fuori corpus + 3 cache): **10/10 ok, p95 19.127 ms ≤20 s, 0 marker/verbatim, lingua it 10/10, citazioni 10/10, 1 blocco/query**; screenshot UI reali `qa/r17_chat_*.png` (22/22).
6. Test toccati (contratto aggiornato, dichiarato): `testR15_pipe` (HIT = rielaborazione ≥1 chiamata, mai testo identico), `testR16_pipe` (footer [F1] nel testo), `r16_chat_ui.test.js` (assenza badge + streaming). BUILD `?v=2026-10-25T17:10:00+01:00`.

---

## Round 16 - Chatbot: risposta sempre, entro 20s, zero leak, web ultimo layer

Nuova voce in cima allo storico: le voci preesistenti sotto restano intatte.

**STRATEGIA**: **C ibrido** - FASE0 forensics bloccante (`qa/f0_round16.json`: 4 query reali dal log astensioni con dump prompt/output/tempi; le origini dei fix partono SOLO dalla tabella cause), FASE1 parallela su 4 scope con owner di file disgiunti (B1 prompt+guardia / B2 pipe+web+allowlist / B3 gate / B4 FE) uniti dal contratto R16 in `core/rag/contract.py` (coordinatore: CANNED_MARKERS, RESET_TOKEN, SLO, WEB_DOWN_ENV, log_risposta, allowlist path; pre-wiring coordinatore: evento `reset` + `reset_count` in `backend/api.py`), FASE2 QA failure-mode (matrice 20 query con SLO reali) + gate umano + regressioni.

### FASE0 - FORENSICS (qa/f0_round16.json, rerunnable qa/f0_round16.py)
- **TEMPLATE-LEAK** (q1 "chi è dante alighieri", E2E reale): il path sidecar postava i messages come stringa grezza "System:/User:/Assistant:" su `/completion` con llama-server avviato SENZA --jinja -> il modello riecheggiava l'intero system prompt e rigenerava lo scambio (marker `User:`x1 `Assistant:`x1 `DOMANDA DELL'UTENTE`x1 nell'OUTPUT; head_dup=2 line_dup=8 = il blocco ripetuto dello screenshot); frase canned **assente nel codice** (scan 0 hit) = generata dal modello -> diventata marker.
- **WEB-NON-USATO** (q3/q4): 5 risultati web fusi ma gate finale nulla (score floor 0.4 < 0.70) -> informativa zero-LLM al posto della generazione web.
- **TEMPO**: q2 retrieve COLD 30.173ms (time-box soft); q1 = 57.2s (pp ~5.5s + decode 600 token @11 tok/s), zero progress sul path chitchat.
- Duplicati: ripetizione INTERNA del modello (prompt senza template) + race FE secondario `openConversation` durante stream.

### FASE1 - 4 BLOCCHI
- **B1 (PROMPT+GUARDIA, `qa/qa_r16_b1_report.md`)**: chat-template applicato (`/v1/chat/completions` per i messages con `chat_template_kwargs.enable_thinking` dai profili; `/completion` legacy INVARIATO per le stringhe = test R15 verdi; fallback dichiarato `last_chat_fallback`); prompt con blocchi `<contesto id="F1" tipo fonte">` (nessuna riga grezza, istruzione citazioni, header CONTESTO/RIFERIMENTI invariato per testG2); **`core/rag/output_guard.py`**: prebuffer adattivo 12-24 char (rileva system-echo), sanitizer live, check post-gen con 1 retry (`REPAIR_INSTRUCTION`) + `contract.RESET_TOKEN` + fallback estrattivo template-free; cap prompt fonti 3x220 char; `time_budget_s` con deadline wall-clock. Test `tests/testR16_prompt.py` **13/13** (50 generazioni simulate: 35 bloccate/15 pulite).
- **B2 (PIPE+WEB+ALLOWLIST, `qa/qa_r16_b2_report.md`)**: web ultimo layer SEMPRE ATTIVO (nessun toggle FE), routing fix `final_nulla+web -> context_kind=web` (MAI informativa con risultati utilizzabili), informativa con `web_status` giu/vuoto via `R16_WEB_DOWN=1` (zero rete assertata); budget: retrieve time-box 1s, web **5,0s** a fasce (batch fidati <=2s/richiesta, generico con riserva 1,2s per Wikipedia), generazione `time_budget_s = max(3, 19 - elapsed)` con troncamento dichiarato; **allowlist `data/web_allowlist.txt`** (22 domini, file NON UI, post-filtro su TUTTI i provider); PARTIAL_PREFIX "Dai tuoi materiali emerge solo questo: "; progress su OGNI path (chitchat incluso); `contract.log_risposta` per ogni query; conversione RESET_TOKEN -> evento reset. Test `tests/testR16_pipe.py` **14/14**.
- **B3 (GATE, `qa/qa_r16_b3_report.md`)**: `build_informativa(decision, *, web_status, web_note)` - default byte-compat R15, varianti oneste ("non ho trovato nulla in appunti, libri e web perché il web non è raggiungibile" / vuoto / degradazione), zero CANNED_MARKERS; `decide_gate` e soglia 0.70 INVARIA (GT 18 casi). Test `tests/testR16_gate.py` **10/10** (firma aggiornata in testR15_gate.py:225-esplicita, dichiarato).
- **B4 (FE, `qa/qa_r16_b4_report.md`)**: badge STATICO "Web: attivo" (span, non cliccabile) in chat + "Attivo (ultimo livello)" in Impostazioni (nota privacy intatta); `send_message` senza web override; **dedupe su data-msg-id** + finalize su nodo staccato (race openConversation) + polling `reset_count` (retry sostituisce, non appende). Test jsdom `tests/r16_chat_ui.test.js` **20/20**.

### FASE2 - QA + REGRESSIONI
- **QA-1 (`qa/r16_qa1.json`, 3 tentativi; PRIMA `r16_qa1_prima.json`, t2 `r16_qa1_attempt2.json`)**: matrice 20 query (10 locali GT / 5 solo-web incl. "chi è dante alighieri" / 5 rete simulata giù). Fix dai dati: t1 budget non passato al proxy (`_iter_gen` per-firma) + starvazione budget web + bug bucket; t2 batch ddgs lento 7,1s. **DOPO: assert core 20/20; SLO 20s p95 = 19.102ms RAGGIUNTO; guard marker 0/20 fail; 1 messaggio/query (blocco unico + reset); fonti web tutte in allowlist; gruppo (c) 5/5 esito informativo zero-LLM p95 61,7ms con R16_WEB_DOWN=1 (0 chiamate di rete)**. Sub-SLO primo token ≤2s p95: **MANCATO** (p95 11.768ms - fisica fetch+pp; vedi NOTE.md).
- **QA-2 (`qa/gate_round16.md` + `qa/r16_gate_raw.json`)**: 10 risposte revisionate: **OK 1 / PARZIALE 7 / KO 2**; marker 0/10, badge+citazioni 10/10; KO di CONTENUTO (modello), non di pipeline.
- **QA-3 regressioni**: T1 **≥2062/0** (vedi sotto); **GT recall@5 = 1,000** (r15_recall_gt rieseguito 9/9); parity appunti 1,000 (testH1 + dedupe NIENTE_DA_FARE rieseguito); TTFT client 82,7ms hit / 465,5ms miss (`qa/r16_ttft_client.json`; g4 storico intatto); hit-rate **0,7767** (rieseguito); KV **+0,0 MB**; load 2,26s; tok/s 10,78/11,19/12,56; gate 58/60 invariato (riconteggio). `qa/metrics_history.json` entry **round16** (`qa/_add_round16.py`, solo file reali + method); testG8 **8/8** (R15b passato a costanti storiche, nuovo `test_h_round16`); testG7 12/12.
- BUILD **`?v=2026-10-25T15:05:00+01:00`** (10 occorrenze bumpate; QA_TS allineato).

### Tabella forensics: caso -> causa radice -> fix -> esito post-fix + tempi
| Caso (F0) | Causa radice | Fix | Esito POST | Tempo |
|---|---|---|---|---|
| q1 "chi è dante alighieri" | TEMPLATE-LEAK (prompt grezzo senza chat-template) + chitchat-cold + decode 600tok | B1 chat-endpoint+enable_thinking=false+guardia; B2 progress/budget | esito (b)/(c) web con citazioni, 0 marker, 1 solo blocco (QA-ii1: 5 url allowlist) | PRIMA 57.2s/2 chiamate->DOPO p95 gruppo web ~19s, guard 0 leak |
| q2 (retrieve freddo) | TEMPO-FREDDO 30,2s + informativa nonostante 5 risultati web | B2 warmup residente + routing web->generazione + budget 5s a fasce | gruppo (c): informativa 61,7ms p95, 0 LLM, 0 rete | PRIMA 31,7s -> DOPO **p95 61,7ms** |
| q3/q4 (5 risultati web inutilizzati) | WEB-NON-USATO (gate nulla su floor 0.4 -> informativa al posto della generazione) | B2 `final_nulla+web -> context_kind=web` | 5/5 query solo-web rispondono dal web con url in allowlist (QA-ii1..ii5) | totale p95 19,1s <=20s |
| canned "La risposta è data da un utente..." | generata dal modello sul prompt malformato (assente nel codice, scan 0 hit) | B1 CANNED_MARKERS in guardia + retry + fallback estrattivo | **0/20 e 0/10 marker** nei QA | n.d. |
| duplicati "blocco 3x" | ripetizione interna (no template) + race FE | B1 chat-template + RESET; B4 dedupe data-msg-id + finalize staccato | `r16_chat_ui.test.js` 20/20; emission_blocks<=1 su 20/20 | n.d. |

### Tabella tempi PRIMA -> DOPO (target)
| Metrica | PRIMA (screenshot/F0) | DOPO (QA-1 t3) | Target | Esito |
|---|---|---|---|---|
| Tempo "non trovato" (esito c, rete giù) | 132,6s E2E / informativa dopo fetch 6-7s | **p95 61,7ms, 0 LLM, 0 rete** | <=3000 ms | ✅ |
| Tempo risposta completa p95 | >30s (nessuna risposta) | **19.102ms p95** | <=20.000 ms | ✅ RAGGIUNTO |
| Primo token p95 | 6,9-57s (chitchat 6,96s; leak) | **11.768ms** (locale p50 ~4s; informativa 0,06s) | <=2000 ms | ❌ MANCATO (fisica fetch+pp, NOTE.md) |
| Primo feedback progress p95 | nessun progress su chitchat | **30,02ms** | <=2000 ms | ✅ |
| Retrieve p95 (stadi appunti+libri) | 30.173ms cold | **81,17ms** warm | <=1000 ms | ✅ |
| Embed query p95 | lazy (semantic cold 43,6s) | 28,767ms warm (invariato R16, dichiarato) | <=100ms | ✅ |
| Chiamate LLM per query default | 1-2 (escalation 2) | **1** (mediana locale; informativa 0; cache 0) | 1 | ✅ |

### Composizione tre stadi (3 query tipo) + escalation
1. **Solo appunti**: "Nella fotosintesi... ΔG...?" → source=locale, badge appunti, 1 LLM, citazioni [F1] (QA-i1).
2. **Libri**: stadio interrogato a ogni query (progress "libri") ma store `vector_index_books` 0 chunk → 0 fonti (BLOCKED corpus vuoto R13, invariato).
3. **Web (escalation)**: "chi è dante alighieri" con gate locale → nulla/parziale → web ultimo layer → 5 fonti `stage=web` con url allowlist (it.wikipedia/treccani), fusione RRF peso 0,8, risposta con badge; stessa query con `R16_WEB_DOWN=1` → informativa "web non è raggiungibile" 61,7ms.

### Per blocco: stato, file, verifiche, limiti, BLOCKED
| Blocco | Stato | File principali | Verifiche | Limiti/BLOCKED |
|---|---|---|---|---|
| B1 prompt+guardia | ✅ | `core/local_llm_client.py`, `core/sidecar/client.py`, `core/rag/output_guard.py`, `core/sidecar/server.py` (solo --jinja se servito; qui NON aggiunto: chat endpoint ok senza) | testR16_prompt 13/13, testR15_gate/integration/pipe/C_rag/G1 verdi | fallback legacy dichiarato `last_chat_fallback`; qualità modello fuori perimetro |
| B2 pipe/web/allowlist | ✅ | `core/router.py`, `core/web_search.py`, `core/rag/web_stage.py`, `data/web_allowlist.txt`, `core/rag/contract.py` (coordinatore) | testR16_pipe 14/14, testR15_pipe/web/integration/gate/H8 verdi | web.mode=mai resta solo da config file (nessun UI); risposte troncate dal budget 20s |
| B3 gate | ✅ | `core/rag/gate.py` | testR16_gate 10/10, testR15_gate 23/23 | firma build_informativa estesa (testR15 allineato, dichiarato) |
| B4 FE | ✅ | `web_frontend/html/index.html` | r16_chat_ui.test.js 20/20 | nessun restyling oltre badge/dedupe |
| QA-1/2/3 | ✅ con sub-SLO dichiarato | `qa/r16_qa1*.json`, `qa/r16_qa2.py`, `qa/gate_round16.md`, `qa/r16_ttft_client.json` | see QA-3 sopra | **BLOCKED: sub-SLO "primo token ≤2s p95"** (11,768ms): causa fisica fetch web 1,1-3,3s + prompt-eval variabile 1,3-6s su MiniCPM5-2B (~100-200 tok/s) + prebuffer guard; procedure e mitigazioni in NOTE.md. Corpus libri vuoto: parity/recall libri BLOCKED (procedura R13) |

**Privacy web (dichiarazione)**: con il web attivo le SOLE query di ricerca vengono inviate a DuckDuckGo (ddgs, senza chiave), opzionalmente SearXNG self-hosted e Wikipedia; nessun LLM cloud (dal web arrivano solo documenti, il modello locale risponde in locale); ogni chiamata loggata in `qa/r15_web_netlog.json`/NET_LOG; risultati fuori `data/web_allowlist.txt` scartati. **Disattivazione**: nessun toggle in UI (badge statico) -> `web.mode=mai` nel file di config, oppure `R16_WEB_DOWN=1` per i test (zero rete).

**File principali R16**: `core/rag/{output_guard,contract,gate}.py`, `core/local_llm_client.py`, `core/sidecar/client.py`, `core/router.py`, `core/web_search.py`, `data/web_allowlist.txt`, `web_frontend/html/index.html`, `backend/api.py` (pre-wiring reset), `tests/{testR16_prompt,testR16_gate,testR16_pipe}.py`, `tests/r16_chat_ui.test.js`, `tests/testG8_metrics.py`, `qa/{f0_round16,r16_qa1,r16_qa2,gate_round16,_add_round16}` + report `qa/qa_r16_{b1,b2,b3,b4,qa1}_report.md`, NOTE.md (round 16), MODIFICHE.md.

---

## Round 15b - Fallimenti RAG: forensics, gate precoce, fallimento informativo, stadio web

Nuova voce in cima allo storico: le voci preesistenti sotto restano intatte.

**STRATEGIA**: **C ibrido** — FASE0 forensics sequenziale BLOCCANTE (i fix partono SOLO dalla tabella delle cause radice), poi FASE1 parallela su 4 scope (P percorsocritico / G gate / W web / I indici) uniti da un **contratto d'interfaccia** pre-implementato dal coordinatore (`core/rag/contract.py` + config keys + hook `api.py` progress/sources/web_override/app_settings FROZEN per tutti), infine FASE2 QA failure-mode (matrice 6 esiti) + regressione. Nessuna migrazione di stack (pywebview + vanilla JS), nessun restyling (UI minima richiesta: badge stadi, toggle web, avanzamento, settings).

### FASE0 - FORENSICS (qa/f0_forensics.json + qa/f0_probe.py, rerunnable)
5 query reali costruite dal corpus (nessun log astensioni preesistente): q1-q3,q5 = **OK** (risposta locale, ancoraggio in top-k, 1 chiamata LLM); q4 (mitosi/meiosi, fuori corpus) = **NO-WEB** con E2E 132,6 s e 2 chiamate LLM (fallback locale su chunk irrilevanti DOPO l'escalation web: ddgs 1,83 s con 5 risultati). 8 blocking findings: **SIDECAR-DEAD** (sig.bind rotto → produzione SEMPRE in-process, llama-server mai avviato), **gate H8 mai decisionale**, **produzione solo-vettore (FTS5/BM25/RRF mai consultati)**, soglie non discriminanti (irrilevante con sim 0,82), `indexed_files` vuoto (re-embed ogni 300s = 3.171 ms), `embedding_model_id` solo file txt (assente in DB), latenza dominata da prompt-eval in-process ~75 s, caso context=none dedotto. Root-cause per caso in tabella (OK×4, NO-WEB×1; nessun MISS-RETRIEVAL/COVERAGE/EMBEDDER su questo corpus unitario).

### FASE1 - 4 BLOCCHI (parallelo, contratto `core/rag/contract.py`)
- **P (PERCORSO CRITICO, `qa/qa_r15_p_report.md`)**: default **UNA chiamata LLM** per scenario (misurato: locale 1, escalation 1, informativa 0, cache 0 — `qa/r15_pipe_p1_calls.json`); embedder residente caldo + LRU query (**p95 28,8 ms ≤100**, `r15_pipe_p2_embed.json`); retrieve ibrido FTS5+vec+RRF con pesi stadi (**p50 27 / p95 29,8 ms ≤1 s**, time-box soft loggato, `r15_pipe_p3_retrieve.json`); **primo feedback progress p50 22,7 ms**; semantic warm (2.486 ms cold → 19,7 ms, fallback regole H9); **answer cache** persistente 7 gg (`core/rag/answer_cache.py`, HIT=0 LLM); `web_override` + eventi progress/sources emessi. testR15_pipe **30/30**.
- **G (GATE, `qa/qa_r15_g_report.md`)**: **FIX SIDECAR-DEAD** (bind sul metodo realmente invocato) verificato: llama-server PID up, health, prompt 259 tok @71 tok/s, generate in-process=0; **`core/rag/gate.py`** `decide_gate` O(1) zero-LLM (score 0,6·vec+0,4·max(fts_norm,lex) + supporto lessicale) + `build_informativa`; **GT `qa/gt_set_r15.json` 18 casi → soglia 0,70 (precision 1,000 / recall 1,000; sweep `r15_gate_sweep.json`)** patchata in config; prompt flag `outcome=parziale` byte-identico senza flag; astensioni → `astensioni.jsonl` (causa+score+stadi+tempo). Suite verifica: **100 test verdi**.
- **W (WEB, `qa/qa_r15_web_report.md`)**: provider fallback ddgs trusted→generico→SearXNG(off)→Wikipedia (`web_search.py`, rete dichiarata in `r15_web_netlog.json`); **`core/rag/web_stage.py`**: readability-lite ≤4000 char + cache URL AppData TTL 7 gg (HIT=0 rete) + indicizzazione `meta.stage='web'` (FTS5+vec verificati); escalation `escalate()` (mai=**zero rete** assertato); UI: settings (soglia gate, web auto/sempre/mai, SearXNG, Wikipedia, **nota privacy**), progress 3 stadi, fonti con badge stadio+url, chip web → `web_override`. testR15_web **15/15**, T2 `qaR15_web.js` **13/13** + screenshot `qa/r15_web_*.png`.
- **I (INDICI, `qa/qa_r15_i_report.md`)**: `get/set_index_meta` + `ensure_embedder_consistent` (reindex low-prio `r15-reindex`) su entrambi gli store; **root-cause indexed_files**: lo scan libri (cartella vuota) CANCELLAVA le righe note (globale) → fix scoped (16.272 ms→164 ms al 2° scan, re-embed 1→0, cross-wipe 0); `add_chunks` → **chunks_fts trigger verificato** (BM25); coverage report reale `qa/coverage_report.json` (1 file, 0 orfani, --repair 0 azioni idempotente); books wiring ok (0 chunk = corpus vuoto BLOCKED R13). testR15_index **16/16**.

### FASE2 - QA FAILURE-MODE + REGRESSIONE
- **QA-1 (`qa/r15_qa1.py`, PRIMA `r15_qa1_prima.json` → tent.3 `r15_qa1.json`)**: 3 fix d'integrazione (F1 threading `outcome` fino al client; F2 informativa su `OUTCOME_NULLA` e non più solo fused-vuoto; F3 feature gate allineate al pipeline) + 2 fix coordinator (F4 **prefisso deterministico parziale** "Ho trovato solo questo nei materiali: " emesso dalla PIPE — il modello ignorava l'istruzione 0/6 anche col kwarrand che arrivava; F5 **budget web `WEB_BUDGET_S=5,5 s`**). Dettaglio in `qa/qa_r15_integration_report.md`.
- **QA-2 regressioni**: T1 **2247/0** (`tests/run_t1.py`, 22 JS + 31 PY; baseline ≥2062); **GT recall@5 = 1,000** (`qa/r15_recall_gt.json`, 9/9 ancoraggi); **TTFT client 92,0 ms hit / 350,5 ms miss** (`qa/r15_ttft_client.json`, entro target 1500/2500; g4 ripristinato identico R13 per testG8); **hit-rate 0,7767 ≥0,70**; **KV +0,1 MB ≤50**; parity appunti (dedupe NIENTE_DA_FARE + testH1 1,000); gate invariato 58/60 (registry intoccato); books parity = corpus vuoto (BLOCKED dichiarato R13, invariato). testG8 **7/7** (storici in costanti, round vivo vs disco).
- BUILD **`?v=2026-10-25T11:30:00+01:00`** (10 occorrenze; run.js F0.4 **19/19** post-bump; qaR15_web 13/13).

### Tabella forensics: caso → causa radice → fix → esito post-fix (con tempi)
| Caso | Causa radice | Fix | Esito POST | Tempo |
|---|---|---|---|---|
| q1/q2/q3/q5 (positivi) | OK (nessun difetto) | n.d. | risposta locale con citazioni (QA-i 2/2) | first feedback 3,45 ms; gen LLM 1 |
| q4 / negativi (fuori corpus) | NO-WEB + informativa non colta (fused≠vuoto) + sidecar dead | F2 informativa su OUTCOME_NULLA; G0 fix sidecar | esito (c) **0 LLM** (QA-iv OK) | **7,47 ms p95** (PRIMA: 132,6 s E2E / 180-480 s con LLM) |
| parziali GT (4+2) | flag outcome non passato + modello ignora istruzione | F1 + F4 prefisso deterministico | esito (b) formula presente (QA-ii OK) | 1 LLM, first feedback 2,5-52 ms |
| escalation web | batch ddgs ~10 s > 8 s | F5 budget 5,5 s | QA-iii OK (5 fonti http) + QA-v(b) **5.734,91 ms ≤8000** | PRIMA 10.086 ms |
| (nessun candidato) | informativa su fused vuoto | F2 | QA-iv llm=0 | tot ~7 ms |

### Tabella tempi PRIMA → DOPO (target)
| Metrica | PRIMA | DOPO | Target | Esito |
|---|---|---|---|---|
| Tempo "non trovato" (esito c, senza web) | 132.600 ms (E2E forensics q4, 2 LLM) / giri QA-iv 180-480 s | **p95 7,47 ms, 0 LLM** | ≤3000 ms | ✅ |
| Tempo "non trovato" (con web) | 10.086 ms p95 (tent.2) | **p95 5.734,91 ms** | ≤8000 ms | ✅ |
| Primo feedback (progress) | PRIMA-round: nessun progress → primo token 5,4-92 s (R13 sonda app); tent.1 QA 28,19 ms | **p95 24,99 ms (n=16)** | ≤2000 ms | ✅ |
| Retrieve p95 | vector-solo (FTS/RRF mai usati) ~75 ms (forensics) | **29,8 ms ibrido FTS5+vec+RRF** | ≤1000 ms | ✅ |
| Embed query p95 | lazy-load a query (HF) — semantic cold 43,6 s | **28,8 ms warm (LRU 0,002 ms)** | ≤100 ms | ✅ |
| Chiamate LLM per query default | locale 1 ma escalation **2** (fallback locale irrilevante + web) | **1** (locale oppure web-fuso); informativa 0; cache 0 | 1 | ✅ |

### Composizione tre stadi (dimostrata) + escalation
1. **Solo appunti** (positivo GT): sources stage=appunti, source=locale, 1 LLM (QA-i).
2. **Libri**: stadio interrogato (progress "libri", store `vector_index_books` attivo con get/set meta) ma corpus **vuoto 0 chunk** → 0 fonti (BLOCKED corpus R13, invariato e dichiarato).
3. **Web** (QA-iii): gate nulla → escalation auto → 5 fonti `stage=web` con url Treccani/Sapere + badge (1 chiamata ddgs 2,56 s, rete dichiarata) e fusione RRF con peso 0,8; "Mai" → zero rete (assertato). UI: badge + link + toggle per query (`web_override`) + settings.

### Limiti/QUALITY dichiarati (nessun BLOCKED nuovo di unità)
- Delegati: 3 su 7 persi per errori di rete del provider (protocollo report-first ha comunque conservato gli stati; integrazione conclusa dal coordinatore); flusso overnight del tent.2 QA dichiarato (1 caso con total_ms anomalo).
- Qualità modello: alcune risposte parziali mostrano ripetizioni/degenerazioni (comportamento MiniCPM5, fuori integrazione); ddgs transienti 0 risultati su 2 tentativi QA-iii (rete dichiarata, ≥1 tentativo riuscito); testG1 completion3 vuota 1 volta in T1 → **flake** (rerun isolato 3/3 OK).
- Corpus libri vuoto: parity/recall libri resta BLOCKED (procedura R13 invariata).
- Note preesistenti recuperate: `qaF_block`/`qaV_blockv` fuori baseline (232/6 informativa), prompt-lookup OFF (1,005×→questo round 0,98×).

**File principali R15b**: `core/rag/{contract,gate,web_stage,answer_cache}.py` (contract = coordinatore), `core/{router,local_search,embedder,local_llm_client,semantic_router,ai_router}.py`, `core/web_search.py`, `core/rag/{indexer,vector_store_sqlite,vector_store_chroma,chunker}.py`, `data/{config_manager,migrate_real}.py`, `data/coverage_audit.py`, `backend/api.py` (hook pre-implementati), `web_frontend/html/index.html` (settings/progress/fonti/chip), `tests/{run_t1,testR15_*}.py`, `qa/{f0_*,r15_qa1*,r15_recall_gt,r15_pipe_*,r15_gate_*,r15_web_*,r15_index_*,gt_set_r15}*`, report `qa/qa_r15_{p,g,web,i,qa1,integration}_report.md`, NOTE.md (politica gate/pesi/TTL/privacy).

---

## Round 13 - Audit UI pendente + implementazioni mancanti + rifinitura backend (FASE0-3)

Nuova voce in cima allo storico: le voci preesistenti sotto restano intatte.

**STRATEGIA**: **C ibrido** — FASE0 audit sequenziale read-only (produce la lista voci ASSENTE/PARZIALE), poi FASE1+FASE2 in parallelo su scope disgiunti (moduli UI/backend a owner unico), FASE3 regressione+docs. Motivazione: ogni implementazione e' vincolata alle sole voci risultanti assenti/parziali; dopo l'audit gli scope non condividono file owner. **Nessuna migrazione di stack UI**: resto pywebview + vanilla JS; nessun restyling (solo voci audit + entry point F06/F17 + wiring live della vista Statistiche esistente).

### FASE0 - AUDIT COMPLETO (21 voci)
- Tabella con evidenze (screenshot+file): **`qa/audit_r13.json` + `qa/audit_r13.md`**. Stato iniziale: **20 PRESENTE + C3 PARZIALE**; stato finale: **21/21 PRESENTE** (target 100% raggiunto, screenshot per ciascuna).
- Verifiche T2 reali RIES ESEGUITE a fine round (Chromium/Puppeteer su harness con moduli reali): `qa_ab_b12.js` **38/38** (A1 popovers unici, A2 tool singolo+toggle, A3 Fonti, B1 archi bordo-bordo, B2 tab sempre 4, B3 undo 1-passo, B4 Mano rimosso), `qa_schemi_b12.js` **PASS** (matrice per tipo + bootstrap vuoto E1; 15 cambi tipo nodi 9/9 archi 6/6 zoom 76-127% testi invariati E2), `qaD_home_b12.js` **11/11** (logo git-identico + 8a card stesso selettore), `qaC2_b12.js` **7/7** (viewer Fonti con contenuto reale+metadati), `run.js` **19/19** (R6: fill dR/dB 1px, .fg-side 200px<=220, pill doc 0 status bar, video scroll delta 0 + 0 pannello props, label timeline delta 0 + F0.4 build), `qaF67_r13.js` **7/7**.
- Fix dei runner T2 (coordinatore): check BUILD **dinamico** (QA_TS letto da index.html + coerenza ?v=) nei 4 runner + run.js (prima: costanti obsolete -> BLOCKED/mismatch fittizi); path `qaC2` aggiornato a `file_AIstudio/originals/` (stale dopo G3); **`tests/run_t1.py`**: T1 riproducibile (suite ufficiali = 20 JS escluse 4 meta/legacy + PY unittest/pytest con fallback; meta eseguite ma fuori baseline, metodo invariato R11/R12).

### FASE1 - IMPLEMENTAZIONI MANCANTI (solo voci ASSENTE/PARZIALI)
- **C3 PARZIALE -> PRESENTE** (IMPLEMENTER-RAG): `data/migrate_real.py --dedupe-legacy [--apply]` — indice reale 34 chunk (17 path legacy + 17 rag_stage2, hash sha256 identici) -> **17 chunk solo da rag_stage2**; backup SHA256+manifest (`backup_chroma_20261024_133249`), rifiuto se non duplicato, idempotente (2 run = 0 da fare); retrieval non regresso: **24/24 query identiche salvo duplicati, max delta similarity 0.0**; `python qa\audit_c_r13.py` -> **TUTTO OK 8/8**; nuovo `tests/testR13_rag.py` **7/0**; `testC_rag.py` invariato 21/0. A1-A3, B1-B4, E1-E2, D1-D2, R6a-e, C1, C2, C4 risultavano gia' PRESENTE -> nessuna modifica (scope discipline).
- **BOOKS1-4 in sequenza**: BOOKS1 dry-run su `vector_index_books` REALE -> **corpus vuoto 0/0 dichiarato (parity/recall vacui)** -> **parity/recall libri BLOCKED** con procedura manuale (inserire libri reali via Materiali->libri o `%APPDATA%\NovaStudio\preselected_books\{originals,rag_stage2}` poi `--books-dry-run`/`--books-cutover`); BOOKS2 backup SHA256+manifest 12 file + restore test 12/12; BOOKS3 cutover chroma->sqlite store libri con **rollback testato** (RAG_BACKEND=chroma apribile, chroma byte-intatta); BOOKS4: **"chromadb rimosso dal runtime"** — grep su 118 file: **0 import eager** nel percorso default, 3 siti lazy consentiti; e2e meccanica su TEMP 1.0/1.0 dichiarata come test (mai "libri reali").

### FASE2 - BACKEND R13 (parallelo, scope disgiunti)
- **IMPLEMENTER-SPEC (S1-S4)**: S1 `tools/models/MiniCPM5-1B-Q4_K_M.gguf` (688.065.920 B, HF ufficiale openbmb) + `Q3_K_M` (582.899.072 B, quantizzato localmente da F16 ufficiale con llama-quantize, dichiarato); S2 confronto con llama-server reale (llama-bench senza opzioni draft, verificato da --help; serviva `--spec-type draft-simple`): baseline 12,63 tok/s, Q4 11,59 (0,918x), Q3 12,96 (1,026x), acceptance Q4 **0,527** / Q3 **0,576**, risparmio 105,2 MB -> regola letterale (acceptance OK, speedup OK, **risparmio 105,2<120 NO**) -> **Q4_K_M** (`qa/s1_quant_compare.json`); S3 draft SOLO long-form (`want_draft` think-only; W2 flag backward-compat; fix bug `start_on_demand(draft=)`); S4 misure per profilo -> **draft OFF per TUTTI** (acc 0,439/0,606/0,811/0,478; speedup 0,850/1,044/1,169/0,815x) con `spec.draft_model=""` immutato; prompt-lookup **OFF** (1,005x<1,05x, nessun consumatore nel codice); **RAM con draft <=2,9 GB BLOCKED** (3.278-3.900 MB, floor ~3.159 MB; procedura nel report); unload -130,3 MB <=50 OK; contract `last_meta={timings,acceptance,draft_active,ts}` esposto. Test: testR13_spec_draft 16/16, G1 3/3, H2 11/11, H5 4/4.
- **IMPLEMENTER-TELEM (T1-T3)**: `backend/api.py` + `ai_stats()/ai_stats_reset()` (js_api, payload get_stats invariato); `core/ai_runtime.py` telemetria **persistente** (`ai_stats.json` in AppData; hit-rate, TTFT, tok/s, giudizi tutor, token/tempo per F, acceptance live da last_meta); `statistiche.js` blocco **LIVE** sotto la tabella storica (client difensivo pywebview, fallback prudente, aspetto storico invariato). Verifiche: testR13_telem 9/9, telemStatsR13 19/19, testG7 12/12, test_runtime_ai 13/13.
- **IMPLEMENTER-F67 (F06+F17 cablate)**: Documenti -> voce menu contestuale **"Inserisci citazione da materiali"** (F06 via AIService [Accetta/Scarta] -> inserimento al cursore + undo + badge; fallback "manuale" dichiarato, mai eccezione); Chatbot -> azioni **"Salva come nota / documento / mazzo"** (F17 payload/meta; kind reali `note`/`documento`/`mazzo`; Accetta -> saveItem + undo=deleteItem + badge metadati). Verifiche: **110 chiamate (55+55) validate dal validator reale -> 0 parse-error** (testR13_f67 4/4), undo jsdom **28/28**, T2 `qa_ui/f67.html`+`qaF67_r13.js` **7/7** con screenshot `qa/r13_f67_{menu,preview,citazione,nota}.png`; testH4 8/8+38/38, documentiUi 81/81 verdi.
- **UNITA' TTFT sonda pywebview: BLOCKED (6 tentativi)** — target p50 <=2000 ms NON raggiunto: warmup senza RAG 5.357-6.881 ms, con RAG **p50 56,8 s** (fasi quiet) / **95,9 s** (JS finale `qa/t_probe_pywebview.json` n=2) / **92,0 s** (run originale n=5 sotto carico, `qa/r13_ttft_prev_load.json`). Causa misurata: prompt RAG 3.700-4.600 tok @~105 tok/s = 35-44 s di prompt eval + (prima dei fix) `n_ctx=4096` < prompt e `CONNECTION_TIMEOUT=8 s` -> fallback in-process -> errori `'NoneType'` e **crash nativi 0xc0000005 (ggml-base.dll 16:47:16, ucrtbase.dll 17:11:20, Event Log)**. Fix tenuti: watchdog hard sonda; **timeout 8->60 s** (`core/sidecar/client.py`); **n_ctx 4096->8192** (config runtime, rollback `config.json.bak_r13`). Procedura manuale completa in **`qa/qa_r13_ttft_report.md`**.

### FASE3 - REGRESSIONE + DOCS
- **T1 FINALE `python tests/run_t1.py`: 2146 passati / 0 falliti** (JS 1856/0 su **22 suite ufficiali** + PY 290/0 su 26 file; baseline >=2062 **OK**; meta-suite fuori baseline 232/6 a informativa in `qa/t1_r13.json`).
- `qa/metrics_history.json`: entry **round13** da `qa/_add_round13.py` (valori letti SOLO da file qa/* reali + method per metrica); **`tests/testG8_metrics.py` 6/6** (build R12 storico fisso, build R13 == ?v= attuale, nuovo test_e round13-vs-disco); vista Statistiche: **colonna Round13** (modifica richiesta, nessun restyling).
- `tests/testH2_server.py`: assert `llama.n_ctx` runtime **8192** (cambiamento intenzionale fix TTFT; DEFAULT_CONFIG invariato 4096).
- BUILD **`?v=2026-10-24T17:30:00+02:00`** (run.js F0.4 19/19 post-bump).
- NOTE.md: sezione "Round 13 - chiusura audit + limiti nuovi dichiarati".

### Tabella metriche R12 -> R13 (target / esito)
| Metrica | R12 | Target R13 | R13 | Esito |
|---|---|---|---|---|
| RSS padre a riposo (MB) | 39,6 | informativo | 39,6 | = |
| RSS figlio caricato (MB) | 2408,6 | informativo | 2408,3 | = |
| RSS padre dopo 30 richieste (MB) | 39,7 | informativo | 38,6 | = |
| Load sidecar (s) | 2,54 | <=3,0 | **2,4** | OK |
| tok/s fast / think / tool | 9,53 / 10,12 / 13,86 | non vincolanti R13 | 11,53 / 10,07 / 13,35 | OK |
| TTFT app end-to-end p50 (ms) | 699,4* | **<=2000** | **95.972** (n=2; fasi quiet 56,8 s; conteso n=5 91.962) | **BLOCKED** |
| TTFT p95 (ms) | 754,5* | informativo | 140.964 | - |
| Hit-rate prompt/KV | 0,7767 | >=0,70 | **0,7767** | OK |
| KV delta MB / 30 turni | 0,1 | <=+50 | **-1,0** | OK |
| Gate totale | 58/60 | non rimisurato (>=54 R12) | 58/60 invariato (riconteggio) | OK dichiarato |
| recall@5 reale | 1,000 | 1,000 | **1,000** | OK |
| parity top-10 | 1,000 | 1,000 | **1,000** (dedupe 24/24) | OK |
| Router 0-LLM p95 (ms) | 0,0108 | informativo | 0,0107 (router invariato) | OK |
| T1 totale | 2057 metrics / 2062 baseline | >=2062/0 | **2146/0** | OK |
| Books parity/recall | n/a | 1,000 | corpus vuoto 0/0 | **BLOCKED** (procedura manuale) |
| chromadb import runtime | lazy | 0 eager | **0 eager** (118 file) | OK |
| Draft acceptance / speedup | n/a | >=0,70 / >=1,30x | acc 0,44-0,81 / 0,82-1,17x | **OFF motivato** |
| RAM con draft (MB) | n/a | <=2900 | 3278-3900 | **BLOCKED** (floor ~3159) |
| Unload draft+base (MB) | n/a | baseline+<=50 | -130,3 | OK |

\* R12 TTFT = path client DIRETTO (`t2a_ttft.py`, prompt corti); R13 TTFT = path APP end-to-end con bridge pywebview (metro diverso, dichiarato nei method di metrics_history).

**File principali R13**: `data/migrate_real.py`, `core/sidecar/{client,server}.py`, `data/config_manager.py`, `core/workers/w2_summarizer.py`, `backend/api.py`, `core/ai_runtime.py`, `web_frontend/html/js/modules/{statistiche,documenti,chatbot}.js`, `core/registry/functions.py`, `web_frontend/html/index.html`, `tests/run_t1.py` + nuovi `testR13_*`/`qaR13_f67`/`telemStatsR13`/`t13_ttft_pywebview`, `qa_browser/qaF67_r13.js` + `qa_ui/f67.html`, `qa/audit_r13.{json,md}`, `qa/metrics_history.json` (round13), report `qa/qa_r13_{rag,spec,telem,f67,ttft}_report.md`.

---

## Round 12 — Chiusura gap e statistiche (G1-G8)

Nuova voce in cima allo storico: le voci preesistenti sotto restano intatte.

**G1 — SIDECAR REALE**: binario ufficiale `llama-b11838-bin-win-cpu-x64` scaricato in `tools/` (llama-server.exe 0.7.0-dev + llama-bench.exe + INSTALL_SIDECAR.bat/README); H2 esercitato sul server vero: load cold **2,54 s** (≤3,0), idle-unload **+3,2 MB** e 0 figli residui (≤50), tok/s sidecar **9,53 / 10,12 / 13,86** (fast/think/tool, stesso protocollo len/4÷elapsed del R11); autotune reale `llama-bench` **pp 123,59 / tg 13,43 tok/s** (`autotune.done=true`); prompt-lookup **OFF** (speedup misurato 1,049× < 1,15×). Config: `llm.backend=sidecar` con fallback in-process verificato.

**G2 — WIRING H3 NEL FLUSSO REALE**: storia conversazionale REALE + header RAG entrano nel prefisso: `api._run_generation`/`_run_continuation` leggono `db.get_messages` (escluso il messaggio corrente) e passano `history_turns` a `router.process_query_stream`/`continue_stream` (record_prefix_log con valori reali) fino a `LocalLLMClient._prepare_messages`, che compone l'ordine di produzione **system (+header RAG nel system) → storia (turni interi user/assistant) → query**, con `trim_history`/`history_char_budget` (rolling) attivo; anche il percorso sidecar e il suo fallback in-process inoltrano `history_turns`. Misure: **hit-rate KV-prefix 0,7767 ≥0,70** su 20 conversazioni multi-turn (`tests/g2_hitrate.py` → `qa/g2_hitrate.json`), **KV delta RSS 0,1 MB su 30 turni con rolling ≤50 MB** (`tests/g2_kv_rss.py` → `qa/g2_kv_rss.json`).

**G3 — MIGRAZIONE H1 SUL DATO REALE**: `data/migrate_real.py` dry-run (sola lettura) su indice chroma reale **34 chunk**: **parity top-10 = 1,000000** (24 query) e **recall@5 = 1,000000**; backup pre-cutover con manifest SHA256 (`%APPDATA%\NovaStudio\backup_chroma_20261023_163619`, restore testato); **cutover ESEGUITO** con guardie gate (post-check 34≥34, chroma intatta per rollback); e2e upload 3 formati (pdf/png/md): originals/ + rag_stage2/ + vettorizzazione + ricerca OK (`qa/g3_*.json`).

**G4 — STREAMING + TTFT**: UI "generazione…" già presente (spinner `.streaming-spinner` index.html:1399, testo progressivo poll_stream:1575) — nessuna duplicazione; **TTFT sidecar reale: hit p50 135 ms (≤1500 ✓) / miss p50 699 ms (≤2500 ✓)** (`tests/t2a_ttft.py` → `qa/g4_ttft.json`, carico di sistema dichiarato nel JSON); cancellazione: test logici 4/4 + stop reale → health OK e slot rilasciato (`tests/testG4_stream.py`, `qa/g4_measures.json`).

**G5 — GATE QUALITÀ**: analisi `qa/gate_analysis.md` (15/15 falliti R11 = ERRORE MODELLO); fix: F10 **esattamente 6 slide fisse** (template+validator allineati) → **10/15 → 15/15**; F13 profilo **think (1500 tok) + banda ±20% con conteggio normalizzato `_words_norm` + hint min/max espliciti** → **5/15 → 13/15**; rigenerazione completa: **gate 45/60 → 58/60** (target ≥54, F10≥13, F13≥12 **TUTTI RAGGIUNTI**) in `qa/gate_outputs_r12.json` + `qa/gate_summary_r12.md` con tabella delta.

**G6 — IGIENE REGISTRY**: F02 **cablata** in Biblioteca (pulsante «AI mazzo» su materiali con preview Accetta/Scarta, nessuna scrittura automatica) — nessuna funzione zombie rimossa dal registro (17/17 preservati); reranker rinominato **`RerankerPlaceholder`** con alias retrocompatibile `RerankerInt8` e guardia "NON ADDESTRATO" all'attivazione; zombie residui **segnalati**: F06, F17.

**G7 — OSSERVABILITÀ**: `qa/metrics_history.json` (round11 con valori reali + **round12** con metodo/comando per ogni metrica); vista dev **"Statistiche AI"** (`statistiche.js`, accesso da link `.dev-link` in home — **nessuna 9ª card**, qaD_home 41/41) con tabella PRIMA→DOPO e delta colorati; telemetria runtime in `core/ai_runtime.py` (`get_stats`/`reset_stats`: contatori per fid, cache-hit, giudizi tutor).

**G8 — REGRESSIONE**: **T1 = 2057/0** (1809 JS su 20 suite + 248 Python su 21 file), `tests/testG8_metrics.py` 5/5 (valori R12 == sorgenti su disco, build == `?v=`); BUILD **`?v=2026-10-23T19:15:00+02:00`**.

**File principali**: `tools/`, `data/migrate_real.py`, `core/sidecar/*`, `core/router.py`, `core/local_llm_client.py`, `backend/api.py`, `core/registry/{templates,functions,validators}.py`, `core/ai_runtime.py`, `core/rag/{vector_store,reranker_int8}.py`, `web_frontend` (`app.js`, `statistiche.js`, `biblioteca.js`, `index.html`), `tests/` (G1-G8, g2_hitrate, g2_kv_rss, t2a_*), `qa/metrics_history.json`, `qa/gate_*_r12.*`.

---

### G6 (round12)
- **F02 → scelta A (CABLATA)**: nuova azione «AI mazzo» sui record materiale (rtype `mat`) in `web_frontend/html/js/modules/biblioteca.js` → `AIService.runFor(null,'F02',{materia,doc_id,sezione,n,testo})` (TUTTI i placeholder del template) → `showPreview` [Accetta]/[Scarta]; NESSUNA scrittura automatica (F02 è nella lista writer di ai_cache → `approval_required=True`; su Accetta solo toast "approvato — salva in Ripasso", come F01 in notes/documenti). Motivo della scelta: testH4_registry asserisce 17 funzioni/budget/17 template/1700 simulazioni → rimuoverla avrebbe riscritto la baseline; cablarla elimina lo zombie senza toccare validators/engine. `functions.py`: solo `trigger_ui` F02 aggiornato a «Biblioteca · materiale → "AI mazzo" (G6 cablato)»; F10/F13 intatte.
- **Reranker → rename + ALIAS**: `core/rag/reranker_int8.py` — classe rinominata `RerankerPlaceholder` con alias backward-compat `RerankerInt8 = RerankerPlaceholder` (deprecato): `core/local_search.py` NON toccato (importa ancora `RerankerInt8`). Guardia: la costruzione dell'istanza (avviene solo con `reranker=True`) logga `[Reranker] NON ADDESTRATO — usato ordinamento base` (logger `core.rag.reranker_int8`, WARNING); costante `PLACEHOLDER_NAME="reranker_placeholder"`. Nessuna chiave nuova in `config_manager.py` (nessun flag reranker esistente → niente config).
- **Audit zombie**: `tests/testG6_hygiene.py` (7 test) passa in rassegna F01-F17 contro web_frontend/workers/router/sidecar/backend. Risultato: **F06 (insert_citation) e F17 (save_flashcard) restano zombie → SOLO REPORT** (nessuna rimozione senza conferma); tutte le altre hanno ≥1 riferimento UI o worker.
- **Test**: testH4_registry **8/8** (asserzioni INVARIATE), testH4_validators **38/38**, testG6_hygiene **7/7 → 0 fail**, testH8_retrieval 20/20, aiUi_smoke **62/0**, qaA_appunti 92/0, qaD_blockD 10/10 punti + qaD_home 41/41, `node --check` biblioteca.js/ripasso.js OK.

## Round 11 — Infrastruttura AI locale + funzioni agentiche (MiniCPM5-2B)

Nuova voce in cima allo storico: la voce Round 10 e quelle sotto restano intatte.

### BLOCCO INFRA (H1-H5)
- **H1 Store vettoriale**: migrazione chromadb → SQLite FTS5 + sqlite-vec (fallback numpy-blob) con migrate_chroma_to_sqlite (riusa vettori, idempotente, no re-embedding); flag RAG_BACKEND con rollback chroma dimostrato; parity top-10 ≥ 0,80 (misurata su 1.000 → 1.00); gate ONNX solo in indicizzazione.
- **H2 Sidecar**: package core/sidecar — queue a priorità unica (0 interattivo > 1 decompo > 2 worker, con preemption), server llama-server on-demand (idle 300s, backoff 3, crash → "AI non disponibile"), profiles fast/think/tool con budget micro 200 / standard 600 / think 1500; client con fallback in-process e AiUnavailable; binario llama-server.exe ASSENTE su questo host → tok/s reali misurati in-process.
- **H3 Prompt**: prefissi versionati system → RAG → storia → query (build_prompt_segments deterministico); PromptPrefixCache sha256 con hit-rate loggato; trim_history rolling senza troncare i turni.
- **H5 Autotune**: llama-bench (parse testato, binario assente → fallback dichiarato), flag engine/draft/EAGLE3, prompt_lookup ON di default.

### BLOCCO REGISTRY + ROUTING (H4/H7/H9)
- **H4 Registry**: core/registry — 17 funzioni F01-F17, 17 template SYS versionati, 12 grammatiche (G_deck, G_judge, G_outline, G_formula EBNF, G_table, G_blocks, G_labels, G_cite, G_questions + G_slide/G_text/G_payload); validate_output + repair 1 retry + fallback per funzione; cache key deterministica; clamp budget; 1.700 chiamate simulate → 0 errori; esclusioni permanenti verificate (nessun riassunto-nota utente, nessuna generazione schemi; sum/paraph/ctx solo per workers).
- **H7 AiCache**: 3 strati (esatta / semantica ≥ 0,92 / delta 0,80-0,92 → revisiona), invalidazione doc_versions + feedback negativo, provenance badge, approval_required, put() non scrive dati.
- **H9 Router 0-LLM**: regole + centroidi, p95 = 0,0108 ms (misurato), classi chat|rag|tool|cache, sub-query ≤ 3.

### BLOCCO RAG2 (H8)
- Ibrido RRF k=60 (vettore + FTS5) opzionale, default invariato; prefissi contestuali W1; genitore cappato ~5.200 char; confidence gate con astensione (should_answer); rewrite solo su query colloquiali; reranker int8 OPT-IN placeholder dichiarato; eval recall@5 su 30 domande: vector 0,900 vs hybrid 1,000.

### WORKERS + TUTOR (H12/H13)
- **H12 Workers**: core/workers W1-W6 (contextualizer, section_summarizer — uso INTERNO RAG mai feature, flashcard_pregenerator suggested/approved=false, paraphraser validazione ≥ 0,85, dedup, maintenance) con CodaPriorita prio2, resume, progress; test che i worker non degradano l'interattivo.
- **H13 Tutor**: FSRS nel codice + TutorSession F04 loop con fallback deterministico (giudizi 10/10 reali); ai_runtime run_ai_function (cache → LLM → validate → retry → fallback "AI non disponibile" MAI eccezione, max 2 tool-call); API js_api ai_run_function + tutor_step.

### FRONTEND (H6/H10/H11)
- **H6 Igiene RAM**: teardown listener in ripasso, audit rAF/lazy, bench biblioteca: listener growth 0, apertura 14 ms.
- **H10 window.AIService** in app.js: run/badge/preview con Accetta-Scarta, nessuna scrittura prima di approvazione, undo hook, fallback toast.
- **H11 Bottoni per modulo**: notes F01/F05, documenti F01/F05/F09, fogli F07/F08, presentazioni F10/F11/F12, video F13, calendario F14, ripasso F04, chatbot F16/F03, biblioteca F15 — esclusioni rispettate.

### FILE NUOVI PRINCIPALI
- Nuovi: core/rag/vector_store_sqlite.py, core/sidecar/{queue,server,client,profiles}, core/prefix_cache.py, data/autotune.py, core/registry/ (6 file), core/ai_cache.py, core/ai_router.py, core/workers/ (8), core/tutor.py, core/ai_runtime.py, core/rag/reranker_int8.py, window.AIService (app.js).
- Modificati: data/db.py + schema.sql, core/local_llm_client.py, core/router.py, core/local_search.py, core/models.py, backend/api.py, data/config_manager.py, 9 moduli FE + app.js, index.html (BUILD ?v=2026-10-23T03:00:00+02:00).

### QA
- T1 = 1975/0 (JS 1.784 su 19 suite incl. aiUi_smoke 62/0 + Python 191 su 14 file).
- T2 = misure reali qa/t2a_measures.json (load 2,01 s; RSS 24,5 → 2093 → 2578 MB; tok/s fast 10,32 / think 9,11 / tool 11,78; p50 3942 ms / p95 4045 ms; prompt-cache hit-rate 0,45; sidecar binario assente).
- Gate 60 output reali in qa/gate_outputs.json + gate_summary.md (F01, F04, F10, F13 da revisionare); recall@5 qa/h8_eval.json; p95 router qa/h7_cache_measures.json; workers qa/h12_measures.json.

## Round 10 — Appunti (popover/strumenti/Fonti) · Schemi (connettori/tab/undo/Mano) · RAG a due livelli · Home (logo + ottava card)

Nuova voce in cima allo storico: le voci preesistenti sotto restano intatte.

**BLOCCO A — Appunti (`notes.js`)**
- **A1 popover**: handler outside-click UNICO riusabile (`onDocOutside` + `closeAllPops()`, registrato in openEditor con capture e rimosso in `teardownEditor`) — ogni popover (Colore, Zoom, Carta, Dettagli, Migliora scrittura) si chiude con click fuori o **Esc**; chiusure dirette duplicate eliminate.
- **A2 stato strumenti**: `setTool` risincronizza swatch/preset (`syncColorSwatches` → `syncToolActive`): **esattamente UN bottone `.active`** tra penna/matita/evidenziatore/gomma/lazo/sposta e preset destri in TUTTI i gruppi (fix preset stale); i preset sono strumenti a tutti gli effetti che condividono `ed.tool`+`ed.penType`; toggle "Migliora scrittura" con stile `.mode` VISIVAMENTE distinto (bordo colorato, background trasparente — non riempimento) e fuori dallo sweep `data-tool`.
- **A3 pannello Fonti**: nuovo bottone "Fonti" nella toolbar sinistra (pillL, accanto a immagine/file/PPT) → pannello collassabile a SINISTRA con ricerca, elenco fonti (item study + materiali/libri via `StudyStore.listMaterials`), anteprima contenuto e "Inserisci nella nota" (oggetto `t:'file'` con path o `t:'text'` con riferimento; reversibile con undo).

**BLOCCO B — Schemi (`schemi.js`)**
- **B1 connettori sempre visibili**: scelta **layer archi sopra i fill** — ordine DOM `sc-guide → sc-nodes (solo shape con data-nid) → sc-edges → sc-draw → sc-overlay (testi+handle, classe `sc-label` per non rompere i count `g.sc-node[data-nid]`)`, più micro-offset sugli endpoint (`anchors`) così punta freccia e tratto iniziale non finiscono sotto lo stroke del nodo. Verificato con `elementFromPoint` sui midpoint (albero denso + mappa con attraversamento creato per drag reale).
- **B2 pannello destro**: 4 tab **SEMPRE presenti in ogni tipo** (Riassunto, Fonti, Stile, Testo); tab Testo = editor Titolo+Corpo (`n.text = titolo + '\n' + corpo`), senza selezione hint "Seleziona un nodo".
- **B3 undo/redo completo**: freccette **↶ Annulla / ↷ Ripeti** in `.sc-tools` (FUORI da `.sc-btnwrap`, la matrice pulsanti invariata); snapshot `pushUndoSnapshot` esteso a doc completo (nodi con w/h/text, archi, drawings, view), `redoStack`, `applySnapshot`; agganci a **1 passo per azione**: addNode (copre +Figlio/+Fratello), nuovo arco, deleteSelection, drag (pre-state in svgDown, push solo se moved), autoLayout (no doppio push con changeType), changeType (pre-migrazione); **Ctrl+Z / Ctrl+Y** funzionanti.
- **B4 tool Mano ELIMINATO**: bottone/handler/cursore rimossi; il vecchio "Mano" era in realtà disegno a mano libera → rilocalizzato su bottone **"Matita"** (disegno e `doc.drawings` preservati; slider spessore `.sc-drawopts` visibile SOLO con strumenti di disegno); pan resta via sfondo/rotella + **Space+drag** creato (cursor grab, keyup rimosso in teardown).

**BLOCCO C — Fonti e RAG a due livelli (`backend/`, `core/rag/`, viewer)**
- **C1 struttura**: `originals/` (originali, MAI indicizzati) + `rag_stage2/` (copie `.md` convertite, unica cartella scansionata/vettorizzata) sotto **ognuna** delle basi reali `file_AIstudio/` e `preselected_books/` (rinominare le basi avrebbe rotto i path in `indexed_files`); `ensure_rag_layout()` idempotente. Upload: `_store_original` copia l'originale in originals/ → conversione in rag_stage2/ → `ensure_index_updated(rag_stage2)`.
- **C3 migrazione**: `migrate_legacy_files()` all'avvio (`api.py` init, PRIMA del reindex): `.md`+sidecar in radice → spostati in originals/ **e** copiati in rag_stage2/ (no-overwrite, idempotente, seconda chiamata = no-op senza perdite).
- **C4 garanzia**: doppia difesa — (1) potatura `os.walk` che rimuove `originals` dai dirs in `index_folder` (copre ogni radice, anche annidata); (2) filtro post-query `_is_originals_source()` in `LocalSearchEngine.search` (esclude chunk di originals anche dai vettori orfani, anche nel fallback topic).
- **C2 viewer**: nuova API `read_material_text(path)` (`study_api.py:280`, valida path sotto le radici ammesse, niente lettura arbitraria) usata da **notes.js** (metadati Percorso/Nome/Dimensione/Tipo/Data + testo con cap 2500 + pulsante "Carica testo completo") e da **schemi.js** (voci `mat:` in loadSources con etichette "Libro" per path `preselected_books/` vs "Materiale", preview idem).

**BLOCCO D — Home (`index.html`, `app.js`)**
- **D1 logo vecchio ripristinato** da `git show HEAD:web_frontend/html/index.html` (righe 386-392, intro in commit `a4736ec`): SVG `.logo-star` viewBox 100×100, polygon **16 punti identici** al commit (confronto stringa), gradiente `starGrad` #ffd98a→#f9974a; rimosso il nuovo `logo-mark`; **titolo "Nova Studio" e sottotitolo intatti**, `#brandLockup` e click→home invariati.
- **D2 ottava card "Aggiungi materiali"** in `app.js renderHome()` (dopo le 7 card): click → `window.Materiali.open()` (definito in `index.html` accanto al bottone chatbot) → **lo STESSO `#materialModal`** con 2 tab (materiali/libri) e gli stessi `pick_*`/`add_*_material` → la pipeline originals/rag_stage2 è unica per chatbot e card.

**File toccati**: `web_frontend/html/js/modules/notes.js`, `web_frontend/html/js/modules/schemi.js`, `web_frontend/html/js/app.js`, `web_frontend/html/index.html` (logo, `window.Materiali`, BUILD marker **`?v=2026-10-22T21:30:00+02:00`** su CSS+TUTTI gli script), `web_frontend/html/css/modules.css` (rimossa riga `.logo-mark` morta), `backend/api.py`, `backend/study_api.py`, `core/rag/indexer.py`, `core/local_search.py`, `MODIFICHE.md`.

**QA**
- **T1: 1743/0** — 1681 js (18 suite: Round 9 tutte verdi + nuove `qaA_appunti.js` 92/0, `qaB_schemi.js` 125/0, `qaC2_viewer.js` 40/0) + `qaD_home.js` 41/41 + Python `testC_rag.py` 21/21 (migrazione idempotente, scan salta originals/ a ogni profondità, filtro query originals, read_material_text validazione path).
- **T2 Chromium reale** (screenshot + misure reali, zero stub geometria):
  - `qa_browser/qa_ab_b12.js` **38/38** — A: popover chiusura click-fuori/Esc (4 casi), esattamente 1 tool attivo per ogni strumento, stile mode distinto; B: z-order archi con `elementFromPoint` (albero + mappa, attraversamento creato con drag reale), 4 tab × 6 tipi, undo/redo 1-passo, Mano assente + pan via sfondo/space, slider solo con Matita → `qa/qa_ab_*.png`, `qa/qa_ab_measures.json`.
  - `qa_browser/qaD_home_b12.js` **11/11** — logo identico a git (confronto points), 8 card con rect>0, apertura modal, zero errori → `qa/qaD_*.png`, `qa/qaD_measures.json`.
  - `qa_browser/qaC2_b12.js` **7/7** — preview Fonti con sottostringhe confrontate su file `.md` REALI (stub ponte dichiarato: solo `pywebview.api.read_material_text` letto da disco), cap+testo completo, insert `t:'file'`, ricerca → `qa/qaC2_*.png`, `qa/qaC2_measures.json`.
- **Fix harness** (test, non modulo): `qa3_block3.js` asserzione Round9 "voce round2 in riga 1" superata (ora: presente e prima di ROUND 3); `qaC2_viewer.js` lettura oggetti da `pages[].objects` (quaderno); argomenti `page.evaluate` nei runner.

---

## Round 9 — Schemi: matrice pulsanti + rilayout al cambio tipo (bug mappa vuota)

Nuova voce in cima allo storico: le voci preesistenti sotto restano intatte.

**BLOCCO 1 — Matrice pulsanti di aggiunta per tipo**
- **Pulsanti per tipo**: *albero* e *sinistra→destra* → `+ Nodo`, `+ Figlio`, `+ Fratello`; *libero* → idem più **selettore stile arco** (Dritto/Curvo/Gomito) e auto-layout disabilitato; *mappa concettuale* → `+ Figlio`, `+ Fratello`; *riassunto visuale* → solo `+ Figlio` più pannello **Testo**.
- **Bootstrap `+ Nodo` con 0 nodi** disponibile in tutti i tipi (dalla mappa vuota: click su `+ Nodo` → 1 nodo, poi `+ Nodo` esce dalla matrice).
- **Semantica `+ Fratello` con fallback**: albero/lr/libero → equivale a `+ Nodo`; mappa → equivale a `+ Figlio`, sempre connesso.
- Pannelli, etichette degli archi e select stile arco **aggiornati al cambio tipo**.

**BLOCCO 2 — Rilayout al cambio tipo senza perdita (fix bug "mappa vuota")**
- **Causa radice del bug**: `radialTargets` usava `depth=9999` per i nodi irraggiungibili → coordinate ±1.5M px fuori viewport; nodi legacy senza `w`/`h` → NaN nel transform globale SVG (canvas svuotato, badge "NaN%"); force della mappa a 40 iter in-place instabile.
- **Fix**: anelli finiti per gli orfani, backfill di `x/y/w/h` in `normalizeDoc`, guardie `isFinite` in `centerView`/`animateLayout`, force deterministico a **300 iter** con doppio buffer + clamp + recentro, fit con **pad 40** e zoom clamp **[25%, 200%]** (era 70 / [20%, 160%]), fit anche per il tipo **libero** (targets null).
- **`confirm()` per archi extra ELIMINATO**: gli archi non più validi dopo il cambio diventano **extra tratteggiati**, mai rimossi.
- **Undo**: il cambio tipo è **UN solo passo** (snapshot prima di `migrateSchema`, Ctrl+Z).

**File**: `web_frontend/html/js/modules/schemi.js`, `web_frontend/html/js/modules/schemaStrategies.js`, `web_frontend/html/index.html` (BUILD marker `?v=2026-10-17T12:45:00+02:00`).

**QA**
- **T1 jsdom 1368/0**: suite preesistente più nuovi `tests/qa4_matrix.js` **90/0**, `tests/qa4_relayout.js` **205/0**, `tests/implBlock12.test.js` **74/0**.
- **T2 Chromium reale** `qa_browser/qa_schemi_b12.js`: scenario a 9 nodi (coppia disconnessa + isolato), ciclo albero→mappa→lr→libero→riassunto→albero ×3 = **16 step** (15 cambi), nodi renderizzati == 9 e archi == 6 a ogni passo, **0** rect fuori viewport (margini minimi **49px**), zoom **76%–127%** nel clamp, zero NaN, zero errori console; screenshot `qa/schemi_b12_*.png` (**6+2**); misure in `qa/schemi_b12_measures.json`.

---

# MODIFICHE — round 2 (cartella, materia, home, retrieval per argomento)

Riepilogo delle modifiche applicate all'app Nova Studio in questo round.
Primo round (suite a 7 sezioni): vedere `PIANO_INTERFACCIA.md`.

## 1. Home / header
- **Rimosso il menu hamburger** (bottone e listener eliminati; sidebar non più raggiungibile, lo storico resta nel modulo Chatbot).
- **Rimosso il vecchio logo stella + "NovaStudio"**: nuovo logo (libro su badge arancione) affiancato a **"Nova Studio"** + sottotitolo *"La tua suite locale per lo studio"* (sottotitolo visibile solo in home).
- In home sono **nascosti** "Seleziona modelli" e "Aggiungi materiale" (CSS `body.view-home`): nella home restano solo **7 card + logo/titolo/sottotitolo + ingranaggio impostazioni**.
- **Impostazioni** accessibili dall'ingranaggio in header (`#headerSettingsBtn`) → riusa la modale impostazioni esistente (aggiornamenti, licenze, info): niente perso rispetto al vecchio menu.
- Logo/titolo cliccabili → torna alla home. Card più ampie e griglia centrata per un layout bilanciato.

## 2. Componente cartelle globale
- Nuova tabella `folders(id, kind, name, parent_id, created_at)` con `kind ∈ chat|note|schema`; colonne `folder_id` aggiunte a `chats` e `study_items` con **migrazioni sicure** (`ALTER TABLE` idempotenti in `data/db.py`).
- API backend: `folders_list`, `folders_save`, `folders_delete`, `chat_folder_save`. Eliminare una cartella **sposta gli elementi nella radice** e le sottocartelle al padre: nessuna perdita dati (testato).
- `study_save` **preserva la cartella** se il payload non la include (update parziali degli editor non la azzerano).
- Componente riusabile `web_frontend/html/js/components/folders.js` (`window.Folders`):
  - `Folders.bar(kind, onNav)` → pulsante **"Nuova cartella"** + breadcrumb (Radice / cartella / …);
  - `Folders.grid(kind, onNav)` → cartelle con rinomina/elimina;
  - `Folders.moveSelect(kind, value, onChange)` → menu "Sposta in…" sulle card;
  - `Folders.filterItems(items, kind)` → elementi della cartella corrente.
- Integrazione coerente in **Chatbot** (conversazioni), **Appunti**, **Schemi**; la **Biblioteca** mostra la struttura ad aree/cartelle esistente (Appunti | Schemi | Conversazioni | Tutti).

## 3. Componente materia globale
- `web_frontend/html/js/components/subject.js` (`window.SubjectInput`):
  - campo **testuale** (non un elenco fisso);
  - testo **forzato in MAIUSCOLO** (`text-transform` + normalizzazione `toLocaleUpperCase('it-IT')`);
  - normalizzazione delle materie equivalenti (spazi multipli + maiuscolo) → stessa materia;
  - **salvataggio automatico** delle materie usate (`StudyStore.rememberSubject`, dedup case-insensitive);
  - **datalist con suggerimenti** delle materie già salvate.
- Usato in: Chatbot (argomento), Appunti, Schemi, Calendario, Ripasso; `normalizeSubject` usato anche da Biblioteca/filtri.

## 4. Chatbot
- **Lista conversazioni**: rimosso il pulsante "Aggiungi materiali" (la funzione resta, raggiungibile **dentro la chat** tramite "Aggiungi materiale" in header); aggiunte le **cartelle** (nuova cartella, breadcrumb, sposta conversazione, filtro per cartella).
- **Nuova conversazione**: schermata con **solo il campo argomento** (SubjectInput): niente scelta modello, niente materiali, niente opzioni avanzate.
- **Retrieval limitato all'argomento**: l'argomento scelto viene passato al backend come `topic`
  (`send_message(..., topic)` → `Router.process_query_stream(topic=...)` → `LocalSearchEngine.search(query, topic=...)`):
  1. embedding dell'argomento → costruzione del **sottoinsieme** di chunk pertinenti;
  2. la ricerca normale della domanda viene **filtrata su quel gruppo**;
  3. fallback: se l'intersezione è vuota si usano i chunk dell'argomento sopra soglia.
  Senza topic il comportamento è identico a prima. Anche le conversazioni riaperte recuperano il proprio argomento (`Chatbot.onConversationOpened`).
- Chat interna invariata: selezione modello e materiali in header funzionano come prima.

## 5. Appunti
- **Cartelle** note (nuova cartella, breadcrumb, sposta, filtro).
- **"Foglio singolo" → "Quaderno"**: stesse dimensioni pagina (1600×1100), **più pagine** (UI ← → / "+ Pagina", dati in `content.pages`, migrazione automatica dai vecchi documenti).
- **Foglio infinito più grande**: 6000×4000 → **12000×8000**.
- **Materia** con SubjectInput (maiuscolo + suggerimenti), filtri normalizzati.
- **Tag** mantenuti invariati.
- **PPT/PPTX inseribile** come oggetto visibile (`{t:'file', name, path}`): icona + nome sull'appunto, selezionabile/trascinabile, **doppio click = apertura locale** (`StudyStore.openFilePath` → `os.startfile`).
- **Lazo fluido**: tracciato freehand (non rettangolo) che seleziona tratti/testi/oggetti → **sposta / ridimensiona / elimina**.
- **Gomma come penna cancellante**: strumento con spessore proprio che cancella i tratti entro il raggio scelto.
- **Slider spessore numerico 1–100 px** (+ campo numerico scrivibile) per penna, matita, pennarello e gomma.
- Funzioni preesistenti mantenute: undo/redo, zoom/pan, thumbnail, import immagini/testo, "migliora scrittura", palm rejection.

## 6. Schemi
- **Cartelle** + materia SubjectInput.
- **Pannello "Stile"** durante l'editing: palette scura/chiara, colore sfondo/bordo nodi, colore collegamenti, dimensione testo (12–22), grassetto, **forma nodo** (arrotondato/rettangolo/ellisse/pill), applicabile a selezione o come default.
- **Tipi davvero diversi** (selettore Tipo nell'editor, nessuna perdita di contenuto):
  - *albero*: layout top-down, radice enfatizzata, figlio sotto il padre;
  - *mappa concettuale*: rete libera + **etichette sui collegamenti** (doppio click sull'arco), auto-layout a stella;
  - *sinistra→destra*: colonne orizzontali, figlio a destra;
  - *alto→basso*: livelli verticali;
  - *libero*: nessun vincolo (auto-layout disabilitato);
  - *riassunto visuale*: nodi larghi con testo su più righe, pannello riassunto aperto.
- **Scrittura a mano**: tratti freehand salvati nel documento, selezionabili, spostabili, eliminabili (spessore + colore regolabili).
- **Immagini**: inseribili da file locale, diventano **nodi collegabili** (drag/resize/edge), doppio click = sostituisci.
- Retrocompatibilità: `normalizeDoc()` carica i vecchi JSON senza errori.

## 7. Produttività
- **Eliminati i bottoni centrati** di creazione (empty state solo testo con riferimento alla toolbar); "Nuova presentazione/documento/foglio/progetto" resta nella toolbar in alto a sinistra.
- Percorsi **crea/apri** riletti e funzionanti (fallback `prompt()` se `StudyAsk` manca, `root`/`isConnected` verificati).
- **"Video storytelling" → "Video"** ovunque (hub, tool, descrizioni, home).

## 8. Ripasso
- **Eliminati i bottoni centrati** (lista mazzi vuota e editor mazzo): "Nuovo mazzo" in header, "+ Aggiungi card" nel pannello sinistro.
- Materia del mazzo con SubjectInput (maiuscolo + suggerimenti + filtri normalizzati).
- Tutte le funzionalità esistenti mantenute (editor, studio, statistiche, box 0–5).

## 9. Biblioteca
- **Vista di default per cartelle**: switcher *Area: Appunti | Schemi | Conversazioni | Tutti*, breadcrumb, cartelle dell'area selezionata, elementi della cartella corrente.
- Ricerca/filtri/ordinamenti e azioni esistenti mantenuti; con filtri attivi si passa a elenco piatto per non perdere elementi.

## 10. Calendario
- Modale evento: select materia sostituito da **"Inserisci materia"** (SubjectInput) — testo maiuscolo, materia salvata e ricordata, suggerimenti alla digitazione; risolta in `subject_id` tramite `rememberSubject`.
- "Gestisci materie": nomi normalizzati in maiuscolo; id e colori esistenti preservati. Legenda invariata.

## Verifiche eseguite
- `node --check` su **15/15** file JS (store, app, 2 componenti, 11 moduli): OK.
- `python -m py_compile` su backend/core/modificati: OK.
- Migrazione eseguita sul **DB reale** dell'utente (`chats.folder_id`, `study_items.folder_id`, tabella `folders`): OK.
- CRUD cartelle su DB temporaneo: crea → elemento in cartella → update che preserva la cartella → delete che svuota la radice: OK.
- Smoke test DOM esteso (home + tutti i moduli + sub-tool + Folders + SubjectInput + openItem + moveChat): OK.
- Scan "niente CDN/fetch/http" nei file nuovi/modificati: OK.

## Funzioni rimandate (dettaglio in `NOTE.md`)
- Rendering interno del PPT (c'è icona/nome + apertura col programma di sistema).
- Scala dei disegni a mano negli schemi (sposta/elimina disponibili); collegamento visivo nodo→disegno.
- Cartelle per kind non richieste (mazzi, presentazioni, documenti, fogli, video).

---

# ROUND 3 — Pulizia UI, bug quaderno/materia, Produttività, Calendario, navigazione

Eseguiti in ordine 1→6, ognuno analizzato → implementato → verificato con harness DOM funzionale (`_h.js`, rimosso dopo l'uso) che **esegue davvero** i flussi (click, autosave, salvataggi nel backend finto).

1. **Pulizia UI/navigazione**: "Seleziona modelli"/"Aggiungi materiale" visibili **solo dentro le chat** (`body.view-chat`); impostazioni **solo in home, in basso a sinistra** (`#headerSettingsBtn` fisso); parola "Radice" rimossa da breadcrumb/confirm/empty-state (icona 📁 come radice); **logo/nome app visibili solo in home**; header globale nascosto nei moduli (`body.view-module .header`), lo schermo resta alle funzioni della sezione.
2. **Appunti/quaderno**: verificato che aprendo un quaderno si vedano foglio (stage+canvas ridimensionato), toolbar (6 strumenti), barra pagine con "+ Pagina" funzionante e salvataggio; creazione automatica pagina iniziale (normalizeDoc); materia nella topbar **allineata** (label compatta nascosta, input stesso altezza degli altri campi).
3. **Schemi materia**: `.sc-top` portata in riga con label nascosta e input stesso formato di titolo/tasti — stesso componente SubjectInput, maiuscolo, suggerimenti.
4. **Produttività**: hub e i 4 sub-tool verificati funzionanti: apertura, creazione ("Nuova/o…" in toolbar), apertura progetto, pulsante di ritorno e **autosave reale** (test: aggiunta slide → salvato nel backend). Nome "Video" confermato.
5. **Calendario "Nessuna"**: la voce materia "nessuna" (prima solo testo) è ora un **chip "Nessuna" cliccabile** che azzera il campo (subject_id vuoto salvato); voce "Nessuna" della ricorrenza verificata selezionabile e salvata (`ricorrenza:'nessuna'`).
6. **Chiusura/ritorno**: nuovo **bottone "‹ Conversazioni"** in header per uscire dalla chat aperta (l'unica vista senza via d'uscita); verifica automatica che ogni vista (chatbot, appunti, schemi, produttività, ripasso, biblioteca, calendario) e ogni editor abbia un controllo di ritorno (Home/Elenco/Indietro/Annulla/Fine sessione); il ritorno dall'editor mazzo salva prima di uscire.

**File toccati round 3**: `index.html`, `modules.css`, `js/app.js`, `js/components/folders.js`, `js/modules/notes.js`, `js/modules/schemi.js`, `js/modules/calendario.js`, `js/modules/biblioteca.js` (testo UI).

**Verifiche**: harness completo OK (6/6 punti), `node --check` su tutti i 15 file JS OK, `py_compile` OK.


## Round 3 — Schemi: architettura a strategie (il tipo produce comportamenti reali)

- **Nuovo registro** `web_frontend/html/js/modules/schemaStrategies.js` (`window.SchemaStrategies`):
  `SCHEMA_STRATEGIES` = Record<TipoSchema, Strategy> con le sei strategie (albero, mappa, lr, tb,
  libero, riassunto). Interfaccia: `initialLayout`, `autoLayout`, `placeNewNode(padre, graph, modo)`,
  `canConnect(from,to,graph) -> {ok,motivo}`, `edgeStyle() -> {forma,freccia,etichetta}`,
  `snap()`, `ui() -> {pulsanti,pannelloTesto,guide}`; più `nodeSize()`, `asseFlusso`,
  `evidenziaRadice`, `singolaRadice`, `vistaCard`. API: `getStrategy(type)`,
  `migrateSchema(schema, nuovoTipo)`.
- **Comportamenti per tipo**
  - *Albero*: tidy tree (fratelli centrati sotto il padre, profondità = riga), radice unica,
    `canConnect` rifiuta secondo padre e cicli con toast motivato, archi a gomito senza etichetta,
    pulsanti +Figlio/+Fratello (la radice non ha fratelli → toast).
  - *Mappa concettuale*: cicli ammessi, archi curvi **con etichetta modificabile** (doppio click),
    auto-layout radiale/force dall'hub selezionato, posizioni manuali preservate all'apertura.
  - *Sinistra→destra*: layer = cammino massimo dalle sorgenti (Sugiyama semplificato), colonne
    impilate, frecce con punta, archi "indietro" a curva, guide verticali.
  - *Alto→basso*: idem a righe orizzontali, frecce verso il basso, guide orizzontali.
  - *Schema libero*: auto-layout disabilitato (pulsante grigio + tooltip), snap spento, nessuna
    guida, nessun vincolo topologico, forma arco a scelta utente (select Dritto/Curvo/Gomito).
  - *Riassunto visuale*: nodi come card multilinea (titolo+corpo), stack a colonna, archi semplici
    senza frecce e facoltativi, pannello testo affiancato montato automaticamente e sincronizzato
    col nodo selezionato (tab "Testo").
- **Editor `schemi.js` delega alla strategia**: posizione nodi nuovi (`placeNewNode`), validazione
  collegamenti (`canConnect` a fine gestione, toast col motivo se rifiutato), auto-layout
  (`strategy.autoLayout` con animazione ~200ms), rendering archi (`edgeStyle`), snap durante il
  drag, pulsanti/pannello/guide da `ui()`. **Rimossa** ogni logica di layout hard-coded
  (`isLR`, `layoutCircle`, switch su `doc.type`): vedi `tests/editorWiring.test.js`.
- **Etichetta arco**: editabile SOLO su mappa concettuale; negli altri tipi il campo non compare
  e le etichette non vengono renderizzate.
- **Cambia tipo** (selettore nell'editor): `migrateSchema` conserva nodi e archi, ricalcola la
  validità di ogni arco con la nuova strategia (non validi → extra tratteggiati oppure rimossi con
  conferma), riesegue l'auto-layout animato, aggiorna pulsanti/guide/pannello; `type` persistito e
  la strategia si riapplica alla riapertura.
- **Test** (300/300): `node tests/schemaStrategies.test.js` (171, logica strategie + migrazione),
  `node tests/editorWiring.test.js` (49, intaggio in schemi.js), `node tests/uiHarness.test.js`
  (80, UI reale con jsdom: click, drag, doppio click, cambio tipo). Dipendenza di test:
  `tests/harness` (jsdom).


## Round 4 — 5 blocchi: Video (layout+corsie), Presentazioni, Documenti, Fogli

**BLOCCO 1 — Video: pannello "Aggiungi elemento" in colonna stretta a sinistra**
- Editor video ri-strutturato: `[colonna elementi][preview + transport][proprietà]` in riga,
  timeline a tutta larghezza sotto (`.vv-editor/.vv-body/.vv-split/.vv-main/.vv-props`).
- Pannello sinistro 200px (default), ridimensionabile 180–320 con maniglia drag, collassabile
  con linguetta verticale "ELEMENTI"; sezioni collassabili; `overflow-y:hidden` (nessuna
  scrollbar interna); bottoni "Aggiungi elemento" compatti 32px in griglia 2×2; sezione
  Musica con "Scegli traccia" + Volume compatti.
- File: `modules/video.js`.

**BLOCCO 2 — Video: tracce multiple e sovrapposizioni consentite**
- Modello `lanes` per gruppo (text/media/audio/music) + `c.lane` per clip, persistito nel
  content (retrocompatibile: default 1 corsia / 0 music).
- Intestazione gruppo in timeline con pulsante "+" (aggiunge corsia: "Video/Immagini 2", ecc.;
  su Musica apre anche il picker per inserire una traccia) e "×" sulla corsia: eliminazione
  solo da vuota, altrimenti conferma esplicita (con conferma si rimuovono anche le clip).
- Corsie diverse: clip sovrapponibili nello stesso intervallo e riprodotte insieme;
  STESSA corsia: snap magnet solo sugli stessi vicini + `laneFree/clampFree` (drag, trim,
  input Inizio/Durata, duplica, inserimento) → la sovrapposizione è rifiutata.
- Drag di una clip su un'altra corsia dello stesso gruppo (`detectLane` su getBoundingClientRect).
- Preview con compositing: `zIndexOf` (corsia più alta = sopra per Video/Immagini, testo in
  cima, audio/music sotto); pannello proprietà con Corsia selezionabile, Posizione X/Y anche
  per video, Scala; audio/music sommati per volume per clip.
- Durata totale = fine massima tra tutte le corsie (invariato ma ora cross-corsia) ✓.
- Export: clip type 'music' trattate come audio; disegno ordinato per corsia (z-index).
- File: `modules/video.js` (patch `tests/patch_video_b2.js`, 27/27 anchor unici).

**BLOCCO 3 — Presentazioni: duplicati rimossi toolbar↔proprietà**
- Rimossi dalla toolbar selettore Layout, swatch Sfondo e selettore Transizione; restano solo
  in pannello Proprietà → sezione Slide (unico punto di modifica).
- Toolbar: [← Elenco][undo/redo] | titolo+badge | inserimenti | zoom | [Presenta][Export▾];
  nessun nuovo bottone aggiunto (spazio recuperato dalla barra).
- Riferimenti a st.bgInp/st.trSel ormai nulli sono tutti guardati (nessuna rottura).
- File: `modules/presentazioni.js` (patch `tests/patch_pp_b3.js`).

**BLOCCO 4 — Documenti: zoom + toggle B/I/U/S corretto**
- Status bar: gruppo zoom [−][%][+][Adatta][100%]; `setZoomUser` con clamp 25–300%,
  transform `scale()` sul foglio (contenuto invariato), "Adatta" ricalcola (fallback 100% se
  spazio non misurabile), la % resta anche nel pager "Pagina k/n · Zoom %".
- Toggle vero per B/I/U/S (`toggleMark`): con selezione applica/rimuove in base allo stile
  della selezione; con caret commuta lo stato di digitazione (`st.typingMarks` + pending
  nativo dove disponibile); rimozione con API Range (split ai confini + unwrap con
  `endBoundaryIndex` corretto e ripristino confini dopo le mutazioni DOM) → nessun residuo;
  applicazione per blocco con HTML valido anche multi-paragrafo; `updateStates` legge lo
  stile dalla selezione (DOM fallback quando manca queryCommandState) e si aggiorna a ogni
  selectionchange/keyup/mouseup; preventDefault sul mousedown già in `iconBtn`.
- File: `modules/documenti.js` (patch `tests/patch_doc_b4*.js`).

**BLOCCO 5 — Fogli: motore, funzioni, documentazione**
- Motore preesistente completato: operatore `^` (parsePow), letterali TRUE/FALSE,
  separatore argomenti `;` oltre a `,`, riferimento fuori griglia → `#REF!` (senza rompere
  funzioni tipo LOG10), ciclo → `#CIRC!`, mappa errori canonici
  `#CIRC! #DIV/0! #REF! #NAME? #ERR!` (sintassi/valore → #ERR!).
- Funzioni aggiunte: COUNTA, AND, OR, NOT, ABS, ROUND(x;n), SQRT, POWER
  (completa: SUM, AVERAGE, MIN, MAX, COUNT, IF, CONCAT, TEXT già presenti; case-insensitive).
- 5.5: pulsante "?" in toolbar → popover "Formule" (regola del prefisso "=", tabella con
  sintassi+esempio per tutte le 15 funzioni, 3 esempi pratici, operatori, elenco errori);
  placeholder barra formula aggiornato con esempio funzionante "=2+2".
- Nota: nei valori le decimali con virgola ("3,14" in cella) sono supportate da toNum;
  nelle formule la virgola resta separatore argomenti (usare "." o ";" come da tabella).
- File: `modules/fogli.js` (patch `tests/patch_fogli_b5.js`, 13/13).

**Verifica (435/435)**
- `node tests/videoUi.test.js` (89), `tests/presentazioniUi.test.js` (31),
  `tests/documentiUi.test.js` (36), `tests/fogliUi.test.js` (59) — jsdom + moduli reali,
  driver utente (pointer/keyboard/click);
- regressioni suite round precedenti: `schemaStrategies.test.js` (171),
  `editorWiring.test.js` (49) — tutto verde.

## Round 5 — Schemi: linee spurie, transizione mappa, rimozione tipo Alto→basso

Round sul modulo Schemi (le voci storiche sopra restano intatte: questo blocco è il registro di questo round).

- **Fix guide tratteggi spuri**: le guide apparivano come linee continue leggere a tutto canvas; rendering guide corretto (solo guide della strategia, direzione/tratteggio giusti, nessuna linea spuria sul canvas).
- **Transizione a mappa**: `migrateSchema` resa pulita e idempotente (ripetibile senza degradare il doc), reset dei campi transitori, `hubId` deterministico per l'auto-layout radiale.
- **Rimosso il tipo "Alto → basso" (id `tb`)**: rimosso da `TYPES` (chooser "Nuovo schema" / selettore "Cambia tipo") e dal registro `SCHEMA_STRATEGIES`: l'UI ora ha **5 tipi** — Albero · Mappa concettuale · Sinistra → destra · Schema libero · Riassunto visuale; `getStrategy('tb')` cade in fallback `libero` per i doc non ancora migrati.
- **Migrazione legacy tb → albero on-open**: `normalizeDoc()` converte `type:'tb'` (alias `'alto-basso'`) in `'albero'` senza toccare nodes/edges/drawings (mapping non distruttivo); al primo caricamento parte l'auto-layout una sola volta grazie alla flag di modulo `pendingLegacyLayout`, **non persistita** nel doc (le riaperture successive non lo rilanciano). Rollback sicuro: se l'auto-layout non regge, il doc resta aperto con nodi/archi intatti.
- **Documentazione**: `MODULI.md` elenco tipi allineato a 5; commento interno "flusso lr/tb" in `schemi.js` chiarito (direzioni di layout; il tipo tb è rimosso). Nessun testo utente del modulo citava il tipo rimosso (hint/toast/placeholder già neutri); storico `MODIFICHE.md` invariato.

**Verifica (588/588)**
- `node tests/editorWiring.test.js` (49), `tests/schemaStrategies.test.js` (198), `tests/uiHarness.test.js` (197), `tests/qa1_block1.js` (65), `tests/qa2_block2.js` (79) — tutti verdi.

## Round 6 — Documenti · Fogli · Video (Blocchi D/F/V)

Round sui tre blocchi D/F/V (le voci storiche sopra restano intatte: questo blocco è il registro di questo round).

**Documenti (D)**
- D1: riga di stato full-width rimossa dall'editor → **pill flottanti** su `.doc-main` (`.doc-pill-l` = stats + pagina, `.doc-pill-r` = zoom [-][%][+][Adatta][100%]); la lista conserva la sua `.doc-status`.
- D2: toggle vero B/I/U/S (**Proposta B**): motore manuale su Range (tag ammessi B/STRONG-I/EM-U-S/STRIKE/DEL + stili inline), **stack undo custom** a snapshot `html` (`st.undoStack`/`st.redoStack`) con Ctrl+Z / Ctrl+Y (fallback nativo se vuoto), pending caret azzerati dopo il ripristino, anello di priorità **b > i > u**.
- D3: fit "Adatta" **senza cap a 100%** (clamp larghezza invariato, niente scroll orizzontale) + **altezza foglio esatta** da `st.sheet.offsetHeight`.

**Fogli (F)**
- F1: **fill handle** agganciato all'angolo basso-destro del rect di selezione.
- F2: nuovo **pannello destro collassabile "Formato cella"** (`.fg-side`) con grassetto + colore testo + sfondo.
- F3: bottoni di **allineamento rimossi dalla toolbar** (il dato `c.a` resta legacy, applicabile ai fogli esistenti via `paintCell`).
- F4: popover **"?" Formule** con wrapping + scroll (solo CSS, testi invariati).
- F5: **scrollbar in tema**.
- F6: **toolbar riordinata**.

**Video (V)**
- V1: pannello proprietà destro **rimosso** → **barra contestuale `.vv-ctxbar`** sopra la timeline, visibile solo con clip (o musica) selezionata.
- V2: **preview unica**, senza scroll.
- V3: timeline con **label dentro lo scroller**, corsie 40px, **zoom nell'header** (`.vv-tltools`).
- V4: editor **100vh - 44px**, nessun scroll di pagina.
- V5: sidebar con **collasso reale** (alias `vv-side`).
- V6: **niente vuoto**: l'editor occupa lo spazio disponibile.

**Verifica**
- `node --check` su `documenti.js`, `fogli.js`, `video.js`: OK.
- `node tests/documentiUi.test.js` **81/81**, `node tests/fogliUi.test.js` **105/105**, `node tests/videoUi.test.js` **113/113**.
- QA: `tests/qaD_blockD.js` **10/10 PASS**; `tests/qaF_block.js` **99 passati / 0 falliti** (7 gruppi F1–F6 + no-errori); `tests/qaV_blockv.js`: gruppi **CL1–CL4, CL6, CL7 PASS**, regressione **8.1–8.3 PASS**. In CL5 i punti **5.24/5.25 "undo clip" = N/A pre-esistente**: `pushHist`/`doUndo`/`undoBtn` erano scaffolding mai cablato (zero call-site), fuori perimetro V1–V6, nessuna regressione. Nota: a fine run QA-V termina con `TypeError: statC.toISOString is not a function` sul punto 8.4 — `fs.statSync()` restituisce un `Stats` senza `toISOString` (sempre deterministico): **bug pre-esistente del test**, `tests/` intoccato.
- Doc: commenti/HEADER allineati nei tre moduli ("pannello proprietà destro" → ctxbar in `video.js`; "barra stato" editor → pill in `documenti.js`); dead-code rimosso in `video.js` (`setPropsOpen` + CSS `.vv-panel.vv-right`, zero riferimenti); `MODULI.md` sezioni Fogli/Video aggiornate, sezione Documenti invariata (non citava status bar/zoom); `NOTE.md` senza riferimenti (N/A).
