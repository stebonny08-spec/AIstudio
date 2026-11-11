'use strict';
/* ============================================================
   ink_cfg.js — UNICO file di config del motore ink-commit
   (PROMPT ROUND 29 / round R31 NovaStudio).
   Tutti i valori sono in coordinate MONDO (pixel mondo):
   zoom-invariati per costruzione (nessun valore dipende da
   ed.scale). Modificare SOLO qui (M02).
   ============================================================ */
window.InkCommitCfg = {
    // --- K: finestra di assestamento al rilascio (K01:150-300ms) ---
    settleMs: 200,            // in mezzo alla finestra osservata <=500ms

    // --- L02: coda "bagnata" grigia dell'ultimo tratto live ---
    wetTailPx: 30,            // 20-40px mondo (L02)
    wetColor: '#a8a8a8',      // grigio chiaro (L02)

    // --- T06: troppo corto / tap (nessun commit di perfezione) ---
    shortMinLenPx: 20,        // lunghezza mondo <20px -> grezzo
    shortMinPts: 3,

    // --- T01: linea (deviazione dalla corda o rapporto dritto) ---
    lineDevRatio: 0.025,      //2.5% della corda (spec: 2-3%)
    lineStraightRatio: 0.95,  // dist(endpoint)/pathLen >=0.95 (spec)
    lineEndTolPx: 3,          // fit endpoint: spostamento max dai
                              // punti stabili (Q01: endpoint +-3px)

    // --- T02: arco semplice ---
    arcFitTolPx: 4.0,         // residuo max cerchio grezzo->modello:
                              // assorbe tremolio fino a 4px; oltre -> bez
    arcFitTolChordRatio: 0.11, // tol cubica singola = max(4px, 11% corda):
                              // l'angolo raccordato e' tagliato entro
                              // ~10% corda dalla cubica; endpoint e
                              // tangenti restano ESATTI (A02/A03)
    arcPerfectTolPx: 1.5,     // se countFlessi>=2 (corda corta = artefatto
                              // anche su "C") il cerchio deve essere
                              // PERFETTO <=1.5px, altrimenti freeform:
                              // una S reale NON viene mai snap (T03),
                              // un arco di280gradi SI (A01)
    arcEndTolPx: 3,           // A02: endpoint +-3px mondo
    arcAngTolDeg: 5,          // A02: ampiezza angolare +-5 gradi
    arcTanTolDeg: 10,         // A03: tangente endpoint +-10 gradi
    arcMinSweepDeg: 12,       // sweep minimo per fit a cerchio

    // --- T05: chiuso (gap punta-coda entro tolleranza) ---
    gapClosedMinPx: 12,
    gapClosedRatio: 0.08,     // 8% della diagonale del bbox

    // --- T07: scarabocchio/coloring (solo smoothing leggero) ---
    scratchSelfIntMin: 3,     // auto-intersezioni >=3
    scratchDenseRatio: 1.6,   // percorso >= 1.6x perimetro bbox

    // --- T03/T04/T05: smoothing topologia-preservante (Taubin) ---
    smoothResamplePx: 4,
    smoothCornerDeg: 50,      // corner-lock su svolte >=50 gradi
    smoothClampPx: 1.5,       // clamp ogni nodo entro 1.5px dal grezzo
    smoothIters: 6,
    smoothLightIters: 3,      // T07: smoothing leggero
    smoothLightClampPx: 0.9,

    // --- F01 stesso tratto: micro-V finale o back-stroke ---
    flickWinMs: 250,          // finestra temporale del micro-V
    flickBboxPx: 80,          // bbox max della finestra di flick
    flickMinLegPx: 8,         // gambe minime del V (mondo)
    flickVAngleDeg: 100,      // angolo V centrale
    flickBackAngleDeg: 120,   // inversione back-stroke non centrale
    flickBackWinMs: 120,      // finestra back-stroke (tempo)
    flickBackWinPx: 35,       // finestra back-sproke (spazio)
    flickBackArcMinPx: 12,    // arco minimo del back-stroke
    flickMinPre: 4,           // punti ASTA minimi
    flickMinTail: 3,          // punti flick minimi

    // --- F01 secondo trattino breve (freccia a due tratti) ---
    flick2Ms: 300,            // parte entro 300ms dal rilascio precedente
    flick2DistPx: 60,         // parte entro ~30-60px dall'estremo
    flick2DurMs: 120,         // durata <120ms
    flick2LenPx: 60,          // "trattino breve" (lunghezza max)

    // --- F03: punta freccia (triangolo pieno, angoli arrotondati) ---
    headLenMul: 3.4,          // lunghezza 3-4x spessore
    headWingDeg: 35,          // semi-apertura ali 30-40 gradi
    headRoundPx: 0.9,         // raggio arrotondamento angoli

    // --- OMBRA: anteprima live linea/arco ideali (PARTE 1-bis) ---
    shadowHoldMs: 200,        // G01 sosta per attivazione (~150-250ms)
    shadowOpacity: 0.40,      // G02 opacita' ~35-45% del nero
    shadowWidthDeltaPx: 0,    // G02 stesso spessore della penna (0, max -1)

    // --- campionamento della curva ideale (K03/M05) ---
    sampleStepPx: 2
};
