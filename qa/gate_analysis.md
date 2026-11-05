# Gate Round 11 — Analisi dei 15 output falliti (G5a — sola analisi)

Data: 2026-10-23 · Owner esclusivo: qa/gate_analysis.md · NESSUNA modifica ad altri file
Letture: qa/gate_outputs.json, qa/gate_summary.md, core/registry/functions.py, core/registry/validators.py, core/registry/templates.py, core/registry/grammars.py

## 0. Nota metodologica

- 60 output reali: F01 15/15, F04 15/15, F10 10/15, F13 5/15 → **45/60**.
- Nelle 15 entry con parsed_ok=false il campo **output** di gate_outputs.json conserva il **fallback** della funzione, non l'output grezzo del modello: F10 → "outline 3 slide" (functions.py:186), F13 → "vuoto" (functions.py:233), badge "AI non disponibile". L'output del modello non è recuperabile dai file letti, MA **errors[]** riporta le misurazioni che il validator ha eseguito sull'output reale del modello (conteggi slide/parole) → sufficienti per la classificazione.
- Tutte e 15 le entry fallite hanno **retried=false** con ms compatibili a una singola generazione (F10 42-72s; F13 65-163s) → domanda aperta per G5b: il retry scatta davvero sugli errori di VALIDAZIONE (non solo di parse)?
- NB: nei estratti il segno ± apare mojibake (difetto di estrazione shell, non necessariamente dei file).

## 1. Tabella riepilogo

| fid | pass | falliti | MODELLO | VALIDATOR/SPEC | dettaglio split |
|---|---|---|---|---|---|
| F10 | 10/15 | 5 | **5** | **0** | 3× "4 slide" (near-miss, min 5) + 2× "1 slide" (struttura gravemente corta) |
| F13 | 5/15 | 10 | **10** | **0** (primari) | 10× banda parole ±15%; 7 over / 3 under; errori grezzi 32%–174% |
| **TOT** | 45/60 | **15** | **15** | **0** | 100% classificati ERRORE MODELLO; F13 con fattore spec trasversale (§4) |

## 2. F10 — 5 falliti → 5 MODELLO / 0 VALIDATOR

**Regola richiesta esplicitamente al modello (doppia dichiarazione coerente):**
- sys outline_v1 — templates.py:102-106, riga 103: "- da 5 a 8 slide;"
- user_template — functions.py:179-182, riga 180: "Outline per {arg}: 5-8 slide, titoli in forma azionale, al massimo 4 bullet da 12 parole ciascuno."

**Validator allineato (nessun vincolo nascosto):** check_outline — validators.py:222-250, righe 230-231: "if not (5 <= len(slides) <= 8): errs.append("slides: %d slide (richieste da 5 a 8)" ...)". La grammatica G_outline (grammars.py:9) impone solo la struttura {title, slides:[...]} → nessuna contraddizione template/validator.

### F10 #6 — arg "Funzioni logaritmi", ms 56975, retried false
- errors[]: "output non valido: slides: 4 slide (richieste da 5 a 8)"
- misura modello: 4 slide (minimo richiesto 5); output conservato = fallback "outline 3 slide"
- **ERRORE MODELLO** — il prompt chiede "da 5 a 8 slide" (templates.py:103 + functions.py:180); il modello produce 4 → viola una regola espressa, near-miss a 1 slide dal minimo.

### F10 #9 — arg "Guerra fredda blocchi", ms 42514, retried false
- errors[]: "output non valido: slides: 1 slide (richieste da 5 a 8)"
- misura modello: 1 slide
- **ERRORE MODELLO** — struttura gravemente corta nonostante "da 5 a 8 slide" (templates.py:103, functions.py:180); violazione esplicita (probabile troncamento o singola slide generata, comunque lato modello).

### F10 #11 — arg "Apprendimento automatico neuroni", ms 55913, retried false
- errors[]: "output non valido: slides: 1 slide (richieste da 5 a 8)"
- misura modello: 1 slide
- **ERRORE MODELLO** — stessa dinamica di #9; minimo 5 dichiarato due volte nel prompt (templates.py:103, functions.py:180).

### F10 #12 — arg "Integrazioni sostituzione", ms 71806, retried false
- errors[]: "output non valido: slides: 4 slide (richieste da 5 a 8)"
- misura modello: 4 slide
- **ERRORE MODELLO** — near-miss a 1 slide dal minimo su regola espressa; nessuna tolleranza del validator giustifica 4 < 5 (validators.py:230).

### F10 #14 — arg "Seconda guerra mondiale cause", ms 68462, retried false
- errors[]: "output non valido: slides: 4 slide (richieste da 5 a 8)"
- misura modello: 4 slide
- **ERRORE MODELLO** — identico a #6/#12: il modello tende a fermarsi a 4 slide nonostante il vincolo minimo dichiarato.

**Osservazione spec (non classificante):** il fallback "outline 3 slide" (functions.py:186) produce 3 slide → violerebbe lui stesso check_outline (validators.py:230); incongruenza di fallback, non del controllore.

## 3. F13 — 10 falliti → 10 MODELLO / 0 VALIDATOR (primari)

**Regola:** sys script_v1 — templates.py:128-138, riga 132: "lunghezza circa secondi × 2,5 parole (tolleranza 15%)" (mojibake nell'estrazione: "secondi ?- 2,5"). Il user_template — functions.py:226-229, righe 227-228: "Script di {sec} secondi per '{titolo}'. Contenuto di riferimento: {contenuto}" — NON ripete il target numerico.
**Validator:** check_script — validators.py:284-302: riga 294 "target = sec_f * 2.5", riga 295 "tol = 0.15 * target", riga 297 "if abs(w - target) > tol" → coerente con templates.py:132. Conteggio: _words — validators.py:24-25 "len(str(text).split())".

| # | sec | target | banda ±15% | parole modello | delta | verso |
|---|---|---|---|---|---|---|
| 2 | 35 | ~88 | 75–101 | 157 | +79% | over |
| 4 | 45 | ~112 | 95–130 | 59 | −47% | under |
| 5 | 50 | 125 | 106–144 | 343 | +174% | over |
| 6 | 55 | ~138 | 117–159 | 94 | −32% | under |
| 7 | 60 | 150 | 128–172 | 271 | +81% | over |
| 10 | 40 | 100 | 85–115 | 157 | +57% | over |
| 11 | 45 | ~112 | 95–130 | 219 | +95% | over |
| 12 | 50 | 125 | 106–144 | 182 | +46% | over |
| 13 | 55 | ~138 | 117–159 | 266 | +93% | over |
| 14 | 60 | 150 | 128–172 | 59 | −61% | under |

### F13 #2 — sec 35, "La Rivoluzione francese in 5 eventi", ms 108994
- errors[]: "script: 157 parole, attese ~88 (tolleranza ±13)" — output conservato: "vuoto" (fallback functions.py:233)
- **ERRORE MODELLO** — la banda (templates.py:132 → validators.py:294-297) è esplicita; 157 vs 88 = +79%, fuori da ogni banda ragionevole.

### F13 #4 — sec 45, "Il ciclo cellulare", ms 64908
- errors[]: "script: 59 parole, attese ~112 (tolleranza ±17)"
- **ERRORE MODELLO** — undershoot grave (−47%); regola comunicata nel sys; nessuna contraddizione con il validator.

### F13 #5 — sec 50, "Strade romane", ms 127263
- errors[]: "script: 343 parole, attese ~125 (tolleranza ±19)"
- **ERRORE MODELLO** — 343 vs 125 (+174%), il caso pegliore; nessuna tolleranza plausibile lo giustifica.

### F13 #6 — sec 55, "Logaritmi: errori comuni", ms 106781
- errors[]: "script: 94 parole, attese ~138 (tolleranza ±21)"
- **ERRORE MODELLO** — undershoot −32% (banda minima era 117); regola espressa in templates.py:132.

### F13 #7 — sec 60, "La macchina a vapore", ms 163466
- errors[]: "script: 271 parole, attese ~150 (tolleranza ±22)"
- **ERRORE MODELLO** — +81%; il modello ha ignorato il target di lunghezza.

### F13 #10 — sec 40, "Equilibrio chimico", ms 78669
- errors[]: "script: 157 parole, attese ~100 (tolleranza ±15)"
- **ERRORE MODELLO** — +57%; stessa misura di #2 (157 parole): possibile script generato "a tempo fisso" indipendente da sec.

### F13 #11 — sec 45, "Reti neurali base", ms 110736
- errors[]: "script: 219 parole, attese ~112 (tolleranza ±17)"
- **ERRORE MODELLO** — +95%, doppio del target.

### F13 #12 — sec 50, "Integrale indefinito", ms 113214
- errors[]: "script: 182 parole, attese ~125 (tolleranza ±19)"
- **ERRORE MODELLO** — +46%, comunque fuori banda (max 144).

### F13 #13 — sec 55, "Matrici 2x2", ms 110542
- errors[]: "script: 266 parole, attese ~138 (tolleranza ±21)"
- **ERRORE MODELLO** — +93%.

### F13 #14 — sec 60, "1929 il crollo", ms 94494
- errors[]: "script: 59 parole, attese ~150 (tolleranza ±22)"
- **ERRORE MODELLO** — −61% (identiche 59 parole di #4): generazione degenerata/precocemente fermata, comunque violazione della regola espressa.

## 4. Sintesi split e fattore spec trasversale (F13)

- **Split globale: 15 MODELLO vs 0 VALIDATOR.** Per fid: F10 = 5/0 · F13 = 10/0.
- Motivo del 100% modello: in entrambe le funzioni la regola violata è dichiarata esplicitamente (templates.py:103 e functions.py:180 per F10; templates.py:132 per F13) e il validator la implementa in modo coerente (validators.py:230-231; validators.py:294-297). Nessun caso di tolleranza eccessiva o attesa contraddittoria.
- **Fattore contribuente SPEC su F13 (10/10, non classificante ma decisivo per i fix):**
  a) il target è solo nel sys come regola indiretta ("secondi × 2,5"): il modello deve leggere {sec} dal messaggio utente e moltiplicare a mente; il user_template (functions.py:227-228) non dà MAI il numero assoluto di parole;
  b) per un 2B quantizzato, stare entro ±15% su un conteggio parole è strutturalmente difficile (errori osservati 32%–174%: non errori "di borda");
  c) stesso vettore di incoerenza fallback/validator in entrambe: "outline 3 slide" (functions.py:186, 3<5) e "vuoto" (functions.py:233, 1 parola vs banda ~100-150) violano sempre i rispettivi validator.

## 5. Confronto con i target del round

- Attuale **45/60 = 75%**; target **≥54/60 = 90%** → servono **+9**. F01+F04 = 30 stabili → servono ≥24/30 da F10+F13 (es. 13+11, o 15+12 = 55).
- **F10: 10/15 → ≥13/15** = convertire **≥3 su 5**. I 3 casi "4 slide" sono near-miss a 1 slide dal minimo → molto probabili con template a conteggio fisso + retry col feedback dell'errore. I 2 casi "1 slide" sono piu' ostici (retry o riparazione strutturale).
- **F13: 5/15 → ≥12/15** = convertire **≥7 su 10**. Verifica numerica della sola tolleranza (ricontrollo sulle 10 misure):
  - banda ±20% → passerebbe **0/10**
  - banda ±30% → passerebbe **0/10**
  - banda ±50% → passerebbe **4/10** (solo #4, #6, #12, #14)
  → "tolleranza ±20% con conteggio normalizzato" **da sola NON basta** su questo dataset: servono prompt con target assoluto + retry con feedback + normalizzazione deterministica (trim degli over-shoot, che sono 7/10).
- Vincolo nascosto: tutti i falliti hanno retried=false → se il retry non scatta su validation-failure, nessuna raccomandazione basata sul feedback avra' effetto finche' la pipeline non viene verificata.

## 6. Raccomandazioni numerate per G5b (derivate, NON applicate)

1. **F10 — template a numero fisso di slide:** modificare user_template (functions.py:180) e sys (templates.py:103) per chiedere "esattamente 6 slide" (o "5-6 slide, MINIMO 5" evidenziato), lasciando invariato check_outline (validators.py:230, 5-8). Atteso: ≥+3/5 sui near-miss da 4 slide → F10 ≥13/15.
2. **F10 — allineare fallback e coprire i casi "1 slide":** fallback "outline 3 slide" (functions.py:186) viola il vincolo 5-8 → sostituirla con struttura a ≥5 slide; per i 2 casi da 1 slide attivare retry con feedback esplicito ("l'output contiene 1 slide, richieste da 5 a 8").
3. **F13 — target assoluto nel prompt:** precalcolare N = sec×2,5 e la banda [X,Y] e injettarle nel user_template (functions.py:226-229: "Script di {sec} secondi, circa N parole (tra X e Y)"), eliminando il calcolo indiretto di templates.py:132.
4. **F13 — retry con feedback direttivo + normalizzazione deterministica:** su errore banda, re-inviare "hai scritto W parole, servono X-Y"; in pipeline, trim automatico degli over-shoot (7/10 casi: 157, 343, 271, 157, 219, 182, 266) e sola retry per gli under-shoot (59, 94, 59). Atteso l'unico realistico per ≥+7/10 → F13 ≥12/15.
5. **F13 — tolleranza:** allargare a ±20% con conteggio normalizzato/banda arrotondata (round dei bordi a parole intere) va fatto SOLO accoppiato al punto 4: su questo dataset da sola fissa 0/10.
6. **Pipeline — verificare il retry:** tutte e 15 le entry fallite hanno retried=false; confermare in run_ai_function che il retry (1 tentativo) scatti sugli errori di validazione e che "retried" rifletta il tentativo. Senza retry+feedback, F10 e F13 non raggiungono i target.
7. **Ordine suggerito a G5b:** 6 (verifica) → 1+2 (F10, basso rischio) → 3+4 (F13) → 5 (opzionale).