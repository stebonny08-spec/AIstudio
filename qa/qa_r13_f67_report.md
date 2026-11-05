# QA Report — Round 13 — IMPLEMENTER-F67 (continuazione)

Stato: **COMPLETATO** — tutte le tappe (a)→(d) eseguite, nessun BLOCKED.

## F67a — Documenti → "Inserisci citazione da materiali"
- [x] Voce menu in documenti.js — **menu contestuale** `contextmenu` su `.doc-paper` → `.doc-dd.doc-citemenu` con voce `data-ai-f67="doc-cite"` "Inserisci citazione da materiali" (classi esistenti doc-dd/doc-mi, nessun restyling); contextmenu prevenuto sul solo editor; chiusura su mousedown esterno; detach in `detachGlobal`
- [x] Flusso materiale+query → F06 via `AIService.runFor(el,'F06',{docs,chunks,q})` — materiale da `StudyStore.listMaterials()` (materials_list), chunks da `read_material_text(path)`, form via `AI.askInputs`
- [x] Preview [Accetta]/[Scarta] (`AI.showPreview`) → inserimento citazione al cursore con **undo**: `AI.registerUndo(pushUndo)` → snapshot su `st.undoStack` (stacco prima della mutazione); restore `applySnapshot(preHtml)` → **innerHTML identico**
- [x] Fallback **degradato dichiarato** (AI non disponibile / testo non leggibile / materiali assenti) → `citeManual`: askInputs estratto+fonte → inserimento con badge 'manuale'. **MAI eccezione** (tutto in try/catch + senda comunque verso UI)
- [x] Badge provenienza su citazione inserita: `AI.badgeEl` → `.ai-badge` dentro span `[data-ai-cite]` (data-src, title con fonte)
- Stato: **VERIFICATO** — jsdom 28/28 e T2 browser reale (F1/F2 pass)

## F67b — Chatbot → "Salva come nota / documento / mazzo"
- [x] 3 azioni su `#aiChatBar` (`data-ai-f67="nota|documento|mazzo"`) — nessun menu per-messaggio esistente in chatbot/index → minimo coerente = barra azioni esistente (stesso posto di "Salva come flashcard", design invariato)
- [x] payload = contenuto messaggio (ultima risposta AI, fallback ultimo) + meta {kind, materia=getTopic, conversazione, sorgente} → F17 via `AIService.runFor(btn,'F17',{payload,meta})`
- [x] Su Accetta: `StudyStore.saveItem` con **kind REALI verificati nei sorgenti**: `note` (notes.js:535/1045 — content = doc JSON quaderno `{sheet,mode,pages:[{objects:[{t:'text',...}]}]}`), `documento` (documenti.js:317/1500 — content `{html}`), `mazzo` (ripasso.js:132 — content `{cards:[{id,q,a,color,font,image,seen,yes,no,box}]}` forma reale; deck F17 in `front/back/quote` convertito → `q/a`)
- [x] Toast + **undo** (`AI.registerUndo(null)` + `AI.withUndo` con restore = `StudyStore.deleteItem(id)`) + **badge metadati F17** sulla riga del messaggio (`data-ai-f67-badge`, title = `F17 · kind=… · materia=… · conversazione=…`)
- Stato: **VERIFICATO** — jsdom 28/28 e T2 browser reale (F3 pass)

## Verifiche obbligatorie (esiti)
- [x] **100+ casi 0 parse-error**: `tests/testR13_f67.py` → **55 F06 + 55 F17 = 110 chiamate, 0 parse-error finali** (F06: 43 ok al 1° passo + 12 riparati; F17: 39 + 16 riparati). Attraverso il motore REALE: `render_user` (nessun residuo placeholder) + `engine.validate_output` (parse_json + G_cite/G_payload + validator `cite`/`payload`) + `repair_prompt` per l'unico retry. Casi rotti deliberati dimostrano il ciclo render→repair→re-validate. **Nessuna modifica** a validators/grammars/templates (fix backward-compat non necessario).
- [x] **testH4_registry 8/8 + testH4_validators 38/38 verdi** (eseguiti, assert non modificati): `pytest tests/testH4_registry.py tests/testH4_validators.py` → **46 passed**
- [x] **Undo dimostrato (jsdom)**: `tests/qaR13_f67.test.js` → **28 passati, 0 falliti**:
  - citazione inserita → Ctrl+Z → `innerHTML` IDENTICO (stringa)
  - seconda citazione → `AIService.undo()` → `innerHTML` IDENTICO (stringa)
  - "Salva come nota" → item `kind:'note'` (content doc reale con oggetto testo == messaggio) + badge F17 → `AIService.undo()` → nota rimossa, store identico, 0 side-effect su altri kind
  - usa AIService REALE estratto da app.js + moduli reali; jsdom: continuation async lente → assert con polling
- [x] **documentiUi.test.js verde** (eseguito, non modificato): **81 passati, 0 falliti**
- [x] **T2 browser reale**: `qa_ui/f67.html` (env.js + store.js + app.js + documenti.js + chatbot.js REALI; pywebview.api stub SOLO dichiarati; stili chat copiati da index.html; nessuna geometria stubbata) + `qa_browser/qaF67_r13.js` (handshake `__QA.needShot`/`__qaCheck` come qaD_home_b12.js; BUILD letto dinamicamente da `QA_TS` di index.html con check coerenza `?v=`) → **7/7 check PASS**:
  - **F1**: voce menu presente + click senza errori (menu 204x46 aperto, form F06 aperto, 0 errori)
  - **F2**: F06 stub (1 chiamata) → preview [Accetta]/[Scarta] con JSON citations → Accetta → `[data-ai-cite]` + `.ai-badge` nel DOM (rect 427x33)
  - **F3**: "Salva come nota" → preview F17 → item `kind='note'` (obj.t=text, f17=1) → `AIService.undo()` → note=0, badge F17 presente, docs=1 (d1 invariato), mazzi=0
  - **F0**: **zero pageerror / console.error / QA.errors** su tutto il giro

## Output T2
- `qa/r13_f67_measures.json` (3216 bytes, BUILD 2026-10-23T19:50:00+02:00 letto dinamicamente)
- Screenshot: `qa/r13_f67_menu.png`, `qa/r13_f67_preview.png`, `qa/r13_f67_citazione.png` (clip 452x58), `qa/r13_f67_nota.png` (1366x690)

## Modifiche UI (tutta la lista, niente altro toccato)
- `web_frontend/html/js/modules/documenti.js`: vars `onDocCtx`/`citeMenu`; blocco F67a (closeCiteMenu/pickCitation/insertCitation/citeManual/aiDocCite/openCiteMenu); listener `contextmenu` + chiusura in `onDocDown` + detach in `detachGlobal`
- `web_frontend/html/js/modules/chatbot.js`: blocco F67b (F67_KINDS/f67Message/f67Title/f67DocFrom/f67Cards/f67Item/f67Payload/f67AttachBadge/aiChatSaveAs) + 3 button in `ensureChatBar`
- `core/registry/functions.py`: F06 `trigger_ui` + `note`; F17 `note` (soli campi permessi; CRLF preservato via `qa/tmp/_f67_patch.py`)
- Nuovi: `tests/testR13_f67.py`, `tests/qaR13_f67.test.js`, `qa_ui/f67.html`, `qa_browser/qaF67_r13.js`, questo report, output `qa/r13_f67_*`
- **NON toccati**: engine.py, validators/grammars/templates, app.js, store.js, notes/ripasso e altri moduli, index.html, css, testH4_*, documentiUi.test.js, qa_ui/qa_browser esistenti, MODIFICHE/NOTE

## Comandi eseguiti (esiti finali, ultima跑 di conferma)
- `python -m pytest tests/testR13_f67.py tests/testH4_registry.py tests/testH4_validators.py -q` → **50 passed**
- `node tests/qaR13_f67.test.js` → **28 passati, 0 falliti**
- `node tests/documentiUi.test.js` → **81 passati, 0 falliti**
- `node --check documenti.js chatbot.js qaF67_r13.js` → OK
- `node qa_browser/qaF67_r13.js` → **QA-F67 T2 COMPLETATO, 7/7 PASS**

## Limiti / BLOCKED
- **Nessun BLOCKED** (max 6 tentativi/unità non superato: tutte le unità riuscite entro i primi 2-3).
- Nota dichiarata: nessun menu per-messaggio esistente → azioni F67b sulla barra chat esistente (scelta coerente col design attuale).
- Limite T2 dichiarato: flusso backend reale (LLM + indicizzazione materiali) non esercitabile in harness — coperto dai 110 casi python sul validator reale + stub F06/F17 realistici dichiarati.
- jsdom: continuation async post-await ritardate (vm) → test con polling; nel browser reale sono immediate (confermato in T2).
