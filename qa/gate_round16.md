# R16 QA-2 — Gate umano: 10 risposte (5 locali + 5 web)

Metodo: run E2E reale `qa/r16_qa2.py` (stesso harness di QA-1, warmup fuori misura, testo COMPLETO in `qa/r16_gate_raw.json`), revisione del revisore su 4 assi: correttezza, citazioni/badge stadio, assenza marker template, completezza percepita.

**Verdetti globali: OK 1 · PARZIALE 7 · KO 2** (marker=0 su 10/10; citazioni/badge presenti su 10/10; truncation SLO presente su 9/10).

Limiti dichiarati (non del gate): modello MiniCPM5-2B (qualità generativa limitata, allucinazioni puntuali già note in R15b), prompt fonti capato a 3x220 char per il SLO first-token, risposte troncate a ~19s dal budget R16 2.4 (degradazione prevista).

## i1 (LOCALE) — Nella fotosintesi clorofilliana qual è il valore di ΔG in kJ/mol della reazione che produce glucosio?

- fonte: `locale` · len=742 · primo token=2367.2 ms · totale=19105.1 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=0 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}]

```
Per rispondere alla tua domanda, è importante distingere due concetti: la fotosintesi *classica* (ossigena) e la fotosintesi *di conservazione energia* (anidra). La fotosintesi che produce glucosio, inoltre, non è una singola reazione, ma un processo complesso.

Ecco i punti chiave:

*   **Reazione classica (ossigena):** Il contesto fornito parla di una reazione "endergonica", con un valore di ΔG°' di +2870 kJ/mol per glucosio. Questo è il calore calcolato per la fotosintesi a livello di reazione pura, ma non è la reazione che produce glucosio direttamente.
*   **Fotosintesi che produce glucosio:** Il processo che genera glucosio è la fotosintesi di Calvin-Benson (o Calvin), che è un

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Valore +2870 kJ/mol presente e corretto, ma la risposta perde il filo (distinzioni confuse) e viene troncata dal budget SLO; cite assenti nel corpo (fonti badge=locale nei sources).

## i4 (LOCALE) — Che ruolo svolge la plastocianina nella catena di trasporto degli elettroni?

- fonte: `locale` · len=613 · primo token=5410.2 ms · totale=19075.4 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=0 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}]

```
La plastocianina svolge un ruolo chiave nella catena di trasporto degli elettroni durante la fotosintesi.

Il primo elettrone emesso dalla luminosità è trasportato lungo la catena di plastocianina. Tuttavia, la plastocianina non è il composto più importante: il secondo elettrone è direttamente redistribuito verso il sito $Q_i$.

Per comprendere meglio questa funzione, è utile ricordare che la plastocianina opera come una **trampa elettrica** all'inizio della catena.

Ecco una semplice analogia:
Immagina una catena di rintocchi. La prima corda (la plastocian

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: KO** — Contenuto in parte inventato/errato: la plastocianina non e' una 'trampa elettrica' iniziale ne' legata al sito Qi; il context cap 3x220 ha amputato la fonte corretta. Nessun marker, badge presenti.

## i5 (LOCALE) — Come funziona l'ATP sintasi plastidiale durante il flusso di protoni?

- fonte: `locale` · len=696 · primo token=3779.2 ms · totale=19094.2 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=0 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}]

```
Per rispondere alla tua domanda, dobbiamo guardare a come il flusso di protoni nel citoplasma accoppiato con un processo che sintetizza ATP. Questo processo è chiamato ATP sintasi plastidiale (o ATP synthase in generale, ma nella chiave della fotosintesi).

La idea semplice è questa: i protoni (H+) che si espandono dal lume verso lo stroma del cloroplasto (o del mitocondrio, nella fotosintesi mitocondriale) sono una fonte di energia. La ATP sintasi usa questi protoni per far sì che l'ATP si formi dal ADP.

Ecco come funziona in termini di reazioni:
- Il flusso di protoni dal lume al stroma è generato dal processo di ossidazione dell'ATP (

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Gradiente H+ lume->stroma e sintesi ADP->ATP corretti; formulazioni spurie ('ossidazione dell'ATP', riferimento mitocondriale) e truncation finale.

## i9 (LOCALE) — Quanta energia libera serve alle piante per trasformare anidride carbonica e acqua in zucchero usando la luce?

- fonte: `locale` · len=726 · primo token=4120.2 ms · totale=19034.8 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=0 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}]

```
Per rispondere a questa domanda, è importante considerare che la fotosintesi non è un processo puramente termodinamico, ma un'adozione energetica di risorse specifiche.

La domanda riguarda la quantità di energia libera necessaria per la trasformazione di anidride carbonica (CO₂) e acqua (H₂O) in zucchero, catalizzata dalla luce. Il punto chiave è che la fotosintesi non produce energia libera direttamente; essa utilizza l'energia luminosa per accelerare una reazione che è già legata energeticamente.

Se la domanda è interpretata in senso stretto come "quanta energia libera viene prodotta dal processo", la risposta è nessuna. La fotosintesi non genera energia libera in

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Nega correttamente che la fotosintesi produca energia libera ma non arriva al +2870 kJ/mol atteso; tono contorto, truncation finale.

## i10 (LOCALE) — Qual e' il valore di delta G della reazione che produce glucosio nella fotosintesi?

- fonte: `locale` · len=643 · primo token=5445.5 ms · totale=19039.9 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=0 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}]

```
Per rispondere a questa domanda, è importante distinguere due concetti fondamentali nella fotosintesi olandese: la fotosintesi ossigenica classica (o reazione di Calvin) e il processo di fotosintesi che produce ossigeno.

Ecco una breve spiegazione:

- La **fotosintesi ossigenica classica**, che produce glucosio come alcol, è una reazione **endergonica**. Il valore ΔG°' è positivo, indicando che la reazione richiede energia esterna.
- Il valore menzionato in appunti è **+2870 kJ/mol di glucosio**. Questa è l'energia totale necessaria per la reazione.
- La fotosintesi che produce ossigen

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Valore +2870 kJ/mol citato dagli appunti (corretto) ma contaminato da invenzioni ('fotosintesi olandese', 'glucosio come alcol'); truncation finale.

## ii1 (WEB) — chi è dante alighieri

- fonte: `web` · len=272 · primo token=13737.7 ms · totale=19066.1 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=5 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}, {"stage": "web", "title": "Dante Alighieri", "url": "https://it.wikipedia.org/wiki/Dante_Alighieri", "source": "https://it.wikipedia.org/wiki/Dante_Alighieri"}, {"stage": "web", "title": "Divina Commedia", "url": "https://it.wikipedia.org/wiki/Divina_Commedia", "source": "https://it.wikipedia.org/wiki/Divina_Commedia"}, {"stage": "web", "title": "Inferno (Divina Commedia)", "url": "https://it.wikipedia.org/wiki/Inferno_(Divina_Commedia)", "source": "https://it.wikipedia.

```
Dante Alighieri è riuscito a diventare una figura di grande importanza non solo come poeta, ma anche come scrittore e come politico italiano. [F1] È nato nel 1265 e visse attraverso i secoli, la sua influenza rimane oggi r

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Nato nel 1265 corretto + citazione [F1] web; testo corto (272 char) con frasi generiche ('visse attraverso i secoli'), truncation; domanda risolta con esito web.

## ii2 (WEB) — chi è petrarca?

- fonte: `web` · len=530 · primo token=7333.3 ms · totale=19070.0 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=5 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}, {"stage": "web", "title": "Petrarca, Francesco - Enciclopedia - Treccani", "url": "https://www.treccani.it/enciclopedia/francesco-petrarca/", "source": "https://www.treccani.it/enciclopedia/francesco-petrarca/"}, {"stage": "web", "title": "PETRARCA, Francesco - Enciclopedia - Treccani", "url": "https://www.treccani.it/enciclopedia/francesco-petrarca_(Dizionario-Biografico)/", "source": "https://www.treccani.it/enciclopedia/francesco-petrarca_(Dizionario-Biografico)/"}, {

```
Petrarca è un nome che appartiene a una letteratura profondamente legata alla riflessione personale e alla poetica dell'amore.

**Il primo passo per capirlo è riconoscere il suo legame con l'amore.** [W3] Non è una figura semplicemente antica, ma un'immagine della felicità che può essere coltivata anche oggi.

**Petrarca è anche un'influenza su tutte le scienze.** [W3] Le sue opere non sono solo parole; il loro messaggio è una sorta di ispirazione che può essere applicata a o

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: KO** — Risposta vaga e in parte falsa ('influenza su tutte le scienze'); citazioni [W3] presenti ma il contenuto non risponde fattualmente a 'chi e' Petrarca'.

## ii3 (WEB) — Chi ha scritto il Decameron?

- fonte: `web` · len=173 · primo token=6081.3 ms · totale=10150.6 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=1 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}, {"stage": "web", "title": "Decameron - Wikipedia", "url": "https://it.wikipedia.org/wiki/Decameron", "source": "https://it.wikipedia.org/wiki/Decameron"}]

```
Il Decameron è stato scritto da **Giovanni Boccaccio** [W1]. 

Questa informazione deriva da fonti storiche che citano il suo lavoro come un'opera importante del XIV secolo.
```

**Verdetto: OK** — 'Giovanni Boccaccio' corretto, conciso, citazione [W1] con url in allowlist; nessun marker; completamento naturale (nessuna truncation).

## ii4 (WEB) — Come si calcola l'IVA sulla fattura elettronica in Italia?

- fonte: `web` · len=526 · primo token=7623.5 ms · totale=19056.0 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=5 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}, {"stage": "web", "title": "La fattura: Gli strumenti degli scambi economici ... - Sapere.it", "url": "https://www.sapere.it/sapere/strumenti/studiafacile/economia-aziendale/L-azienda/Gli-strumenti-degli-scambi-economici/La-fattura.html", "source": "https://www.sapere.it/sapere/strumenti/studiafacile/economia-aziendale/L-azienda/Gli-strumenti-degli-scambi-economici/La-fattura.html"}, {"stage": "web", "title": "Iva - Enciclopedia - Treccani", "url": "https://www.treccani.i

```
Per rispondere alla tua domanda su come calcolare l'IVA sulla fattura elettronica in Italia, dobbiamo distinguere due aspetti fondamentali: il fatto che la fattura elettronica sia un documento obbligatorio [W1], e il principio che l'IVA deve essere applicata nel momento in cui le operazioni si verificano, come definito per l'IVA [W2].

### 1. La fattura elettronica è un documento obbligatorio
La fattura elettronica è essenziale per documentare l'esecuzione di un contratto

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Struttura e citazioni [W1]/[W2] corrette ma non espone l'aliquota ne' la formula di calcolo (contesto wiki generalista); truncation finale.

## ii5 (WEB) — Quali sono le regole del calcio riguardo al fuorigioco?

- fonte: `web` · len=512 · primo token=7448.7 ms · totale=19041.7 ms · guard=PASS · markers=[] · resets=0 · blocchi=1 · web_urls=1 (allowlist=OK)
- fonti: [{"stage": "appunti", "title": "fotosintesi_clorofilliana_universitario.md", "url": "", "source": "C:\\Users\\stebo\\Desktop\\progetti app\\StudioIA_7\\file_AIstudio\\rag_stage2\\fotosintesi_clorofilliana_universitario.md"}, {"stage": "web", "title": "Fuorigioco (calcio) - Wikipedia", "url": "https://it.wikipedia.org/wiki/Fuorigioco_(calcio)", "source": "https://it.wikipedia.org/wiki/Fuorigioco_(calcio)"}]

```
Il fuorigioco (o offside in inglese) è una regola fondamentale nel calcio per evitare che i giocatori appartengono a un lato sbagliato di una rete. Ecco come si applica:

**Sei giocatori** devono essere allineati per il gioco.

**Regola base:**
- Se un giocatore è **fuorigioco** quando si passa il palla a un secondo giocatore, **è fuorigioco** anche il passante.
- Se il giocatore fuorigioco **al momento della passata**, è fuorigioco.
- Se il giocatore fuorig

_[risposta abbreviata: tempo massimo raggiunto]_
```

**Verdetto: PARZIALE** — Concetto base di fuorigioco corretto + citazioni, ma 'sei giocatori allineati' e' un'invenzione; truncation finale.

## Sintesi

| esito | n |
|---|---|
| OK | 1 |
| PARZIALE | 7 |
| KO | 2 |

Nessuna risposta contiene marker template (`User:`/`Assistant:`/`[Fonte`/`</contesto>`/frase canned) e nessuna ripetizione di blocco: i fix F0.2 (chat-template + guardia + dedupe) sono effettivi sulle 10 revisionate; i KO sono di CONTENUTO (modello), non di pipeline.