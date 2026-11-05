# R27 — TOGGLE PANNELLO FONTI + COLLASSO BROWSER + ADATTATORI PREVIEW UNIVERSALI (md = modello)

**STRATEGIA dichiarata**: *"FE-FONTI-first con diagnosi root-cause su dati reali"* — Owner unici:
**FE-FONTI** (`fonti_panel.js` + adattatori) e **QA-REAL** (`qa_browser/qaR27_fonti.js`,
`qa/_r27_dump.py`, artefatti `qa/r27_*`). Zero toccature ad altri moduli o al backend.
Motivazione: la recon sul SQLite reale ha già trovato la causa radice comune dei sintomi
degli screenshot (`study_list` restituisce solo `preview[180]` e mai `content`), quindi
tutto il B1–B8 è risolvibile nel solo owner FE; la chiusura T2 avviene **solo** con evidenza
su `index.html` reale servito con la stessa catena `?v=` (puppeteer/CDP = Chrome reale,
playwright non nel progetto), seed dagli item reali, screenshot stesso viewport (1440×900)
e misure DOM reali. Gli assert su harness jsdom = T1 e non chiudono task.

**Regola T2 rispettata**: ogni claim qui sotto è corroborato da screenshot `qa/r27_*.png` + misure in
`qa/r27_measures.json` + check in `qa/r27_results.json` (T2 **45/45 OK**).

---

## 1. Root cause trovate (bug reali, con fix)

| # | Bug | Sintomo (screenshot utente) | Root cause | Fix (owner) |
|---|-----|------------------------------|------------|-------------|
| RC1 | **Pannello Appunti mai chiudibile** | bottone Fonti/Esc "non chiudono" | `presentazioni.js`/`documenti.js` (script DOPO `notes.js` in index.html) iniettano `.fp21-root{...display:flex...}` GLOBALE: a parità di specificità vinceva su `.fp21-root{display:none}` di notes → il pannello restava visibile anche senza `.show`, recorder sempre "aperto" | `fonti_panel.js` base style: `.fp21-root[data-fp21="appunti"]:not(.show){display:none!important}` + `.show{display:flex!important}` (autorità = classe `.show` del host) |
| RC2 | **"Nessun testo disponibile." / "Foglio non leggibile." fantasma** | nota con tratti e foglio reale mostravano solo vuoto | `study_list` (db `_row_to_item(with_content=False)`) restituisce solo `preview[180]`: `fetchSources21` passava `content=undefined` → `itemTexts('')` → null, `JSON.parse('')` → null | `fullContent()`: ogni selezione carica il contenuto completo via `StudyStore.getItem` (1 chiamata per click) |
| RC3 | **Snapshot tratti non generato sulle note quaderno** | anteprima canvas assente, caduta silenziosa nel vuoto | `serializableDoc` salva solo `pages` (cancella `objects`); `itemTexts` leggeva PRIMA `objects` (pagina corrente, vuota nel salvato) | `itemTexts`: PAGINE prima di `objects` (tutte le pagine con tratti); `console.error` (`fpLog`) su ogni fallback canvas (ctx null / toDataURL / eccezione) |
| RC4 | **Formula inline in nodo rosso con LaTeX grezzo** | `\Delta G^\circ'` + `\text{ kJ/mol}` renderizzati come errore KaTeX rosso | `mathRender` usava `throwOnError:false` → KaTeX produceva `.katex-error` con il sorgente grezzo | `throwOnError:true` + catena di **varianti sanificate** (parentesi bilanciate → prime omessi → `prime→\prime` → graffi squilibrati → wrap `\text{}`) + **fallback monospace pulito** (estrae `\text{...}`, via `$` e backslash) con badge discreto. **Mai** nodo rosso |

Bug minori pure fixati dentro gli adattatori: documento con `html:""` non cadeva più su
"Nessun testo" senza provare il testo; oggetto JSON non riconosciuto → messaggio di vuoto
+ log **mai JSON grezzo**; fogli con formato legacy `{cells}` in radice supportati;
"non leggibile"/"Nessun testo disponibile" **solo** per sorgenti realmente vuote/corrotte
con `console.error` (log attivo sull'app reale, soppresso solo sotto UA jsdom per le T1).

---

## 2. B1–B8 — stato e evidenza

| Req | Status | Evidenza (T2 reale) |
|-----|--------|---------------------|
| **B1** toggle bottone Fonti (apre/chiude), Esc chiude, chiuso = non visibile | ✅ | `Q1a/Q1b/Q1c` + screenshot `r27_q1_{prima,aperto,chiuso,esc}.png` |
| **B2** chevron nasconde RIGA2 chip + RIGA3 lista; RIGA1 resta barra sottile (lente+chevron **ruotato 180°**); RIGA4 preview espansa fino a RIGA5; 2° click ripristina; selezione resta | ✅ | `Q2.1–Q2.9`, `r27_q2_{collapse,espanso}.png`, misure sotto |
| **B3** altezza ESTERNA invariata al collasso (è la preview a crescere) | ✅ | root **740→740 px (Δ0)**; preview 112→658 = atteso 740−8−4−26−32−12 = **658 (Δ0)** |
| **B4** persistenza per modulo di aperto/chiuso + collasso, reload rispetta | ✅ | chiavi `fp21_open_<ctx>`/`fp21_top_<ctx>`; reload: Appunti `Q3.1+Q3.2` (aperto **e** collassato), Documenti `Q3.4` (auto-ripreso dal pass applicativo), Schemi tab `Q3.7+Q3.8` + screenshot `r27_q3_*` |
| **B5** stesso comportamento in tutti i mount (Appunti, Documenti, Presentazioni, Fogli, Video, Ripasso; Schemi tab) | ✅ con nota | controller globale in `fonti_panel.js`: selettori bottone Fonti per **ogni** mount + tab Fonti Schemi (Esc su Schemi torna al tab Riassunto). Verificato su reale: Appunti, Documenti, Schemi (3 mount richiesti). T1 copre la logica del collasso per qualsiasi `contesto` |
| **B6** non regressire (dock toolbar cliccabile, resize, ricerca, typo) | ✅ | `Q4.1` elementFromPoint **20/20** bottoni toolbar con pannello aperto; `Q4.2` resize drag 340→400; `Q4.3` dblclick reset →340; ricerca/chips/typo invariati (T1 `f22_*` verdi) |
| **B7** adattatori universali (nessun tipo dice "non leggibile" se ha contenuto) | ✅ (7/8 celle reali) | matrice Q6 sotto + `r27_q6_*.png`; **B7.8** zero log di vuoto sulle sorgenti piene (`Q6.9`), vuoto ammesso solo ad hoc (`Q6.10` + log `[fp21]` catturato in console reale) |
| **B8** matematica robusta (mai LaTeX rosso grezzo) | ✅ | `Q7.1` nodi testo `\Delta/\text/$$` = **0**; `Q7.2` nodi `.katex-error` = **0**; `Q7.3` **131 formule renderizzate, 0 fallback**; `Q7.4` testo renderizzato contiene `ΔG∘=+2870 kJ/mol` + CO/H2O; screenshot `r27_q7_math.png` |

### Misure Q2 (reale, viewport 1440×900, nota reale "Nota del 30/10/2026")

| Metrica | Espansa | Collassata | Espansa (2° click) |
|---|---|---|---|
| **Altezza esterna .fp21-root** | 740 px | **740 px (Δ0)** | 740 px |
| RIGA1 `.fp21-top` (lente+chevron) | 76 px | **26 px** (sottile) | 76 px |
| RIGA2 chip | visibili | `display:none` | visibili |
| RIGA3 `.fp21-list` | 486 px | **0 px** | 486 px |
| RIGA4 `.fp21-preview` | 112 px | **658 px** (atteso 658, Δ0) | 112 px |
| RIGA5 `.fp21-insert` | 32 px | 32 px (in fondo) | 32 px |
| chevron svg transform | none | **matrix(-1,0,0,-1) = 180°** | none |
| padding/gap (root) | 8/4/6 | 8/4/6 | 8/4/6 |

### Matrice Q6 — adattatori su sorgenti REALI dell'app (SQLite reale)

| Tipo | Sorgente reale (seed dal DB) | Atteso | Esito | Screenshot |
|---|---|---|---|---|
| Appunti (manoscritto) | "Nota del 30/10/2026", 103 KB, 50 oggetti con tratti | `<img>` snapshot + testo | ✅ PASS | `r27_q6_appunti.png` |
| Documenti | "Documento senza titolo 15/10/2026" (`{"html": blockquote+table}`) | html renderizzato, mai JSON grezzo | ✅ PASS | `r27_q6_documenti.png` |
| Presentazioni | "Presentazione senza titolo 15/10/2026" (2 slide) | outline slide (titolo+bullet, max 10) | ✅ PASS | `r27_q6_presentazioni.png` |
| Fogli | "Foglio senza titolo 15/10/2026" (A1=`bfg`, C2=`27`) | tabella 25×12, num a destra, no "non leggibile" | ✅ PASS | `r27_q6_fogli.png` |
| Video | "Progetto video senza titolo 15/10/2026" (0 clip) | meta progetto (durata+n clip) | ✅ PASS (`Progetto video · 0 clip · 0:00`) | `r27_q6_video.png` |
| Chat | "chi è dante alighieri" (108 messaggi in 37 chat) | transcript bolle (ultimi 20 + "…") | ✅ PASS (≥2 bolle) | `r27_q6_chat.png` |
| Materiali (md) | `file_AIstudio/rag_stage2/fotosintesi_clorofilliana_universitario.md` (28 KB) | render completo con heading | ✅ PASS (h1/h2) | `r27_q6_materiali.png` |
| **Libri** | **`preselected_books/` vuota (0 file)** | testo con capitoli | ⚠️ **PARZIALE**: nessun libro reale esiste nell'app — la cella non è verificabile su sorgente reale (nessuna sorgente inventata). Ramo md implementato (`readMatBest` originals→rag_stage2) | `r27_q6_libri.png` |
| Vuoto ad hoc | nota creata nel run (`study_save` reale del mock) | "Nessun testo disponibile" **+ console.error** | ✅ PASS (log `[fp21]` catturato) | `r27_q6_vuoto.png` |

## 3. Q1–Q8 esiti (T2 = 45/45)

- **Q1** toggle: apre ✅ / chiude (stato chiuso = non visibile) ✅ / Esc chiude ✅ — `r27_q1_*`
- **Q2** collasso + misure: tutti i check (tab. sopra), selezione preservata, "Inserisci nella nota" abilitato e cliccabile ✅
- **Q3** persistenza reload su **3 mount**: Appunti (aperto+collassato) ✅ · Documenti (auto-ripreso) ✅ · Schemi (tab Fonti attivo + collasso) ✅ — `r27_q3_*`
- **Q4** toolbar: 20/20 bottoni cliccabili via elementFromPoint ✅; resize drag + reset ✅ — `r27_q4_toolbar.png`
- **Q5** regressioni: **T1 completo 1990 passati / 0 falliti su 31 suite**; backend light **pytest 96/96** (testR28_preview, testR22_models, testR24_church, testH4_validators); **0 pageerror** e **0 console.error inattesi** su tutta la sessione reale. *Streaming/grounding/latenza NON rimisurati in questo round* (round FE-only: nessun file `backend/`/`core/`/`data/` toccato; T2 strutturale verde, stime storiche r17/r18 invariate per costruzione) → voce **PARZIALE** per assenza di misura nuova
- **Q6** matrice: 8/9 celle PASS + Libri PARZIALE (tab. sopra) ✅ con evidenze
- **Q7** math: 0 grezzi / 0 rossi / 131 formule renderizzate ✅ — `r27_q7_math.png`
- **Q8** B1–B6 su 3 mount con screenshot ✅ (`r27_q1_*`, `r27_q2_*`, `r27_q3_documenti_reload`, `r27_q3_schemi_reload`)

Catena `?v=`: `F0` — tutti i moduli serviti con lo **stesso stamp** (coerenza BUILD) ✅.
*Osservazione pre-esistente (fuori owner)*: in `index.html` gli `?v=` dei src = `2026-10-30T15:49:23+01:00`
mentre `var QA_TS = 2026-10-27T20:03:00+01:00` — drift già presente nel file, non toccato.

## 4. T1 (jsdom, non chiude il T2 ma garantisce le regressioni)

- Nuovo `tests/r27_fonti_toggle.test.js`: **32/0** (fullContent/root-cause, pages-first+snapshot, tabella fogli+num, html doc, oggetto sconosciuto, math varianti+fallback, collasso CSS, pin B3 in jsdom, registrazione `fp21_open_*`, ripristino via pass applicativi, Esc)
- Completo: **1990 passati, 0 falliti su 31 suite** (`tests/*.test.js`)

## 5. File toccati (owner rispettato)

| File | Ruolo |
|---|---|
| `web_frontend/html/js/modules/fonti_panel.js` | FE-FONTI: **unico** file applicativo toccato (B1–B8) |
| `tests/r27_fonti_toggle.test.js` | T1 nuovo |
| `qa_browser/qaR27_fonti.js` | QA-REAL (mock pywebview fedele allo backend, seed reale, misure, screenshot) |
| `qa/_r27_dump.py` + `qa/r27_seed.json` | seed dagli item reali (read-only sul SQLite) |
| `qa/r27_*.png` (22), `qa/r27_results.json`, `qa/r27_measures.json` | evidenze T2 |
| `MODIFICHE.md` | append Round 29 |

Nota: `web_frontend/` **non è tracciato da git** (condizione pre-esistente del repo: `git ls-files`
vuoto su quei path) — l'elenco sopra è dichiarato dal round e verificabile per timestamp.
Nessun tocco a `notes.js`, ai sub-tool, a `backend/`, `core/`, `data/`.

## 6. Cosa resta aperto (dichiarato)

1. **Q6 Libri = PARZIALE**: `preselected_books/` è vuota (0 file) → nessuna sorgente libro reale
   su cui verificare "testo con capitoli"; il ramo (md = modello, `readMatBest` originals→rag_stage2)
   è implementato ed è lo stesso percorso che già rende i materiali md (cella Materiali ✅).
2. **Q5 streaming/grounding/latenza = PARZIALE**: non rimisurati in questo round (FE-only);
   integrità strutturale attestata da 0 toccature backend + T1 1990/0 + pytest 96/96.
3. **Persistenza aperto/chiuso** registrata sui click di bottone/tab (flusso utente): la chiusura
   forzata all'uscita del modulo (host `fpClose`) non riscrive lo stato — al reload lo stato
   ultimo *cliccato* viene ripristinato (scelta dichiarata).
4. **Drift `?v`/QA_TS** pre-esistente in `index.html` (osservato dal check F0, fuori owner FE-FONTI).
5. Log `[fp21]` soppressi con UA jsdom (scelta dichiarata per non rompere le T1): attivi e
   verificati sull'app reale (Q6.10).

## 7. Riproduzione

```bash
python qa/_r27_dump.py            # seed read-only dal SQLite reale
node qa_browser/qaR27_fonti.js     # T2: serve index.html (?v=) + mock pywebview + misure
node tests/r27_fonti_toggle.test.js   # T1
```
