# QA Report — Round 16, blocco B4 (IMPLEMENTER-FE: badge statico + rendering unico)

**Stato: COMPLETATO** (report-first; tentativi: 3 sull'harness jsdom — nessun BLOCKED; NESSUN bump build fatto da B4, eseguito dal coordinatore).

## Scope (solo `web_frontend/html/index.html`)
- **4.1** chip per-query `webToggleChip` BUTTON → **span statico "Web: attivo"** (role=status, non cliccabile, listener di ciclo rimosso con guard `tagName==='BUTTON'`); select Impostazioni `webModeSelect` → **span "Attivo (ultimo livello)"** + descrizione "nessun toggle in UI (disattivazione da file config)"; nota privacy **intatta**; `send_message` senza `getWebOverride()` (default backend); `getWebOverride()` → ritorna '' (compat residua).
- **4.2** `data-msg-id` su riga di streaming + dedupe (rimozione doppioni, una sola riga a fine stream); **reset_count** nel polling → `streamingText.value=''` (retry SOSTITUISCE, non appende); `updateStreamingBubble` skip su nodo staccato; `finalizeStreamingBubble`: reattach/unica riga sul race `openConversation` (testo identico già in DOM → nessuna aggiunta).
- **4.3** nessun altro cambiamento UI.

## Verifiche (conteggi)
- **NUOVO** `tests/r16_chat_ui.test.js` **20/20** (9 statici su index.html + 11 funzionali con le funzioni chat REALI estratte e montate su jsdom: dedupe 1 riga, finalize doppio, riga staccata, reset che sostituisce il testo);
- `node tests/aiUi_smoke.test.js` verde in T1;
- T1 finale **2305/0** (suite inclusa: JS 1876/0 su 23 suite).

## File toccati (owner)
`web_frontend/html/index.html`, `tests/r16_chat_ui.test.js` (nuovo).

## Limiti / BLOCKED
- La copia renderizzata dal DB (openConversation) non porta `data-msg-id` (id DB ≠ id stream): il dedupe testa anche l'uguaglianza di testo — copertura dichiarata.
- Nessun BLOCKED.
