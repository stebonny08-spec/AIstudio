## Round 21 (PROMPT ROUND 20) - Tratto perfetto + freccia: scelte dichiarate e aperto

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

