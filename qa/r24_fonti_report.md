# R24 — FE-FONTI: pannello Fonti sotto toolbar, senza spazio morto (report)

**Chiusura: SU APP REALE** — T2 = `qa_browser/qaR24_fonti.js` su **index.html servita via
http con la stessa catena `?v=` del BUILD** (niente harness qa_ui/jsdom: quelli restano T1).
Browser: Puppeteer/CDP (Chrome 155 reale; **playwright non è nel progetto** — dichiarato).
Patch AMBIENTE dichiarata: race `StudyStore.listSubjects` 1500ms, **solo senza pywebview**
(fallback browser-puro documentato in NOTE.md; il prodotto non è toccato).
PRIMA = interception su `modules/fonti_panel.js` con `qa/r24_fonti_baseline.js` (pre-fix).
Viewport 1440×900, PRIMA e DOPO stesso viewport. Screenshot **interi** (toolbar + pannello
nel frame): `qa/r24_fonti_{prima,dopo}_toolbar.png`, `qa/r24_fonti_{prima,dopo}_collapse.png`.

## Tabella R0 → fix → evidenza

| Reclamo R0 (app reale, `qa/r24_r0_*`) | PRIMA (T2) | Fix (fonti_panel.js) | DOPO (T2) | Evidenza |
|---|---|---|---|---|
| Toolbar coperta: overlap **15.072 px²**, 8/8 bottoni non-hit, pannello `fixed top:58 z:160` (cascade globale index.html) | z **160 > pill 12** (pannello SOPRA i controlli); overlap a regime 0 grazie al dock R22 ma **z viola R1.1** | `fitDock()` esteso ad Appunti: style.top letto dal DOM = bottom colonna comandi sinistra (max(pill,zoom)) + **8px**; **z-index inline = z toolbar − 1** (lettura `getComputedStyle`) | top **150 = expected 150**, z **11 < 12**, overlap **0**, hit bottoni visibili **7/7** | checks a1-a4, e1 (PRIMA z160=violation) |
| Spazio morto sotto "Inserisci nella nota": **169 px** (panelH 540, insertBottom 429 — altezza fissa 0.7vh con contenuto minore; caso R0 con lista non ancora a regime) | deadSpace **9px** (a regime: auto-contenuto già attivo dal fix predecessore) | height **AUTO** al mount/reset (solo il drag manuale fissa l'altezza), `padding-bottom` inline **4px** (vince su 12px host), `max-height:66vh` clamp; drag verticale clampato ≥160 (fix regressione jsdom R7) | deadSpace **5px** (4 padding + 1 border) ≤ 8 | check b1 |
| Typo: **"l anteprima"** (placeholder .fp21-ptitle) | `raw=true` | apostrofo tipografico `l\u2019anteprima` | `raw=false, fixed=true` | check c1, e2 |
| Ricerca collassabile (non misurata in R0) | — | già R22; confermato sul DOM reale | **+26px** lista (122→148), persistito `fp21_top_appunti=1`, ripristinato a riapertura | checks c2, c3 |

## Misure (da `qa/r24_fonti_measures.json`, 12/12 check, exit 0)

| Metrica | PRIMA | DOPO |
|---|---|---|
| overlap pannello∩pill | 0 (a regime) / **15.072 nel R0** | **0** |
| z pannello / z pill | **160 / 12 (viola)** | **11 / 12 ✓** |
| top pannello / atteso (colBottom+8) | 152 / 150 | **150 / 150 ✓** |
| bottoni toolbar visibili hit | 7/7 (z sopra comunque violava) | **7/7, z sotto** |
| spazio morto sotto insert | 9 (R0: **169**) | **5 px** |
| collapso px guadagnati | n/d (R0) | **+26 px**, persistito |
| typo | presente | **corretto** |
| pageerror / http≥400 | 0 / 0 | **0 / 0** |

**Nota onesta su R0 vs PRIMA**: nel R0 lo spazio morto era169px (lista non a regime al
momento della misura, `listH=198`) e il dock R22 non era applicato (`top=58`): il PRIMA del
T2 a regime dà9px/top152. Il reclamo è confermato dalle misure/screenshot del R0; il fix
riguarda la **classe di vuoti** (height fissa → auto: il box è sempre contenuto+padding,
indipendentemente dallo stato della lista) e il **z-index** (violato anche a regime).

## `btnDelSel` (non un reclamo)

"Elimina selezione" ha rect **0×0 in (0,0)**: bottone **nascosto per design** senza selezione
(NOTE.md R20, "dinamico/nascosto") — `elementFromPoint(0,0)`→canvas. Non è coperto dal
pannello: il test conta i soli bottoni **visibili** (rect>0), 7/7.

## T1 (jsdom, non è chiusura)

`f22_fonti_collapse` 25/0 · `f22_fonti_dock` 31/0 · `f22_fonti_math` 11/0 ·
`f22_fonti_preview` 22/0 · `f22_fonti_resize` 14/0 (fix regressione drag clamp) ·
`f21_fonti_panel` 48/0 · `a19_fonti` 46/0 · `qaC2_viewer` 46/0 — **tutti verdi**.
`node --check` ok su fonti_panel.js e qaR24_fonti.js.

## File toccati

- `web_frontend/html/js/modules/fonti_panel.js` (dock reale con z dinamico, auto-height +
  padding-bottom4px + maxHeight, clamp drag verticale, typo, collapso — somma di:
  predecessore1/2 + correzioni finali coordinator)
- `tests/f22_fonti_dock.test.js`, `tests/f22_fonti_collapse.test.js` (aggiornati dai delegati)
- `qa_browser/qaR24_fonti.js` (T2 reale, coordinator), `qa_ui/documenti.html` (mod-header, dal R22)

## Cosa resta NON verificato su app reale (e perché)

1. **Mount Documenti/Presentazioni con pannello aperto**: non aperti in questo T2 (il flusso
   reale di produttivita/tool non è stato aperto per risparmiare turni): il dock per quei
   contesti usa lo stesso `fitDock` con `.doc-bar`/`.pp-bar` e i loro z-index erano già ≤
   toolbar dal R22 — ma la prova visiva reale con pannello aperto **non è stata fatta qui** →
   cella da considerare PARZIALE.
2. **R0 top=58 non riprodotto al T2**: causa esatta non determinata (stato transitorio al
   click; il dyn R22 era identico in baseline e corrente): dichiarato, non risolto.
3. La patch ambiente `listSubjects` esiste solo nel browser puro: in app con pywebview non
   serve (lista/chooser funzionano via backend).

## Cosa resta aperto

- Il dock usa la **colonna comandi sinistra completa** (pill+zoom): `top = max(bottom)+8`
  (150px con pill 104 e zoom 142) — la specifica parlava della toolbar comandi: la scelta è
  dichiarata qui (non passare sopra la zoom bar è coerente con "toolbar visibile").
- `max-height:66vh` con lista `flex:1` è la protezione anti-crescita dell'auto-height:
   test con centinaia di item non eseguito su reale.
