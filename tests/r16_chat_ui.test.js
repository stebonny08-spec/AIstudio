/* ============================================================
   tests/r16_chat_ui.test.js — R16: NESSUN controllo web in UI +
   rendering a messaggio unico + retry/reset + streaming a blocchi.

   - statico: NESSUN #webToggleChip (badge rimosso), NESSUN select/
     input web nelle Impostazioni, send_message SENZA web override,
     nota privacy presente, streaming con primi ~40 token in un blocco
   - funzionale: estrae le funzioni chat REALI da index.html e verifica
     (a) UNA riga .msg-row ai per data-msg-id (dedupe),
     (b) reset_count crescente -> il testo stream viene AZZERATO e
         riscritto (retry sostituisce, non appende),
     (c) finalize su riga staccata (race openConversation) -> nessun
         duplicato.

   Eseguire con: node tests/r16_chat_ui.test.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('./harness/node_modules/jsdom');

const ROOT = path.join(__dirname, '..');
const IDX = fs.readFileSync(
    path.join(ROOT, 'web_frontend', 'html', 'index.html'), 'utf8');
const SRC = IDX.replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function extract(start, end) {
    const i = SRC.indexOf(start);
    const j = SRC.indexOf(end, i + 1);
    if (i < 0 || j < 0) return null;
    return SRC.slice(i, j);
}

/* ---------------- 1) asserts statici sull'HTML ---------------- */
console.log('== statici index.html ==');
ok(!/id="webToggleChip"/.test(SRC),
   'UI: NESSUN badge web in chat (elemento rimosso)');
ok(!/Web: attivo/.test(SRC),
   'UI: NESSUN testo "Web: attivo" residuo');
ok(!/id="webModeSelect"/.test(SRC) && !/id="webModeBadge"/.test(SRC),
   'UI: nessun controllo modalita web in Impostazioni');
ok(!/id="searxngUrlInput"/.test(SRC) && !/id="wikipediaToggle"/.test(SRC),
   'UI: nessun controllo SearXNG/Wikipedia in Impostazioni');
ok(/privacyWebDesc/.test(SRC) && /Nessun controllo web in UI/.test(SRC),
   'nota privacy web presente e aggiornata');
ok(/_firstBlock/.test(SRC),
   'streaming: politica primi ~40 token in un blocco nel codice');
ok(!/renderSourceBadges\(refs\.content/.test(SRC),
   'R18: nessuna chip fonti nel finalize');
ok(/function renderProvenienza/.test(SRC),
   'R18: riga di provenienza per stadio nel codice');
const sendIdx = SRC.indexOf('api.send_message(');
const sendBlock = SRC.slice(sendIdx, sendIdx + 420);
ok(sendIdx > 0 && !/getWebOverride\(\)/.test(sendBlock),
   '4.1 send_message senza web override per query');
ok(/reset_count/.test(SRC), '4.2 polling gestisce reset_count');
ok(/data-msg-id/.test(SRC), '4.2 dedupe su data-msg-id');
ok(!/wireWebToggleChip/.test(SRC),
   'nessun listener/elemento chip web residuo');

/* ---------------- 2) estrazione funzioni chat reali ----------- */
const part0 = extract('function renderStreamProgress(',
    'let updateDownloadUrl = null;');
const part1 = extract('function addMessageRow(role, htmlContent, source) {',
    'const showChat = () => {');
const part2 = extract('function startPolling(messageId) {',
    '// ================================================================\n    // INVIA MESSAGGIO');
ok(!!part0 && !!part1 && !!part2,
   'estrazione funzioni chat da index.html',
   [!!part0, !!part1, !!part2].join(','));
if (!part0 || !part1 || !part2) {
    console.log('\n== RISULTATO: %d passati, %d falliti ==', pass, fail);
    process.exit(1);
}

function buildScope() {
    const vc = new VirtualConsole();
    const dom = new JSDOM(
        '<!DOCTYPE html><html><body><div id="chatView"></div></body></html>',
        { pretendToBeVisual: true, virtualConsole: vc });
    const doc = dom.window.document;
    const chatView = doc.getElementById('chatView');
    const scope = {
        document: doc,
        window: { pywebview: { api: null } },
        console: { log() {}, error(...a) { console.log('[poll-err]', ...a); } },
        setInterval, clearInterval, setTimeout, clearTimeout,
        chatView: chatView,
        welcomeView: doc.createElement('div'),
        renderMarkdown: (t) => String(t == null ? '' : t),
        SOURCE_LABELS: { locale: 'Locale', web: 'Web', nessuna: '' },
        scrollChatForced() {}, scrollChatIfAtBottom() {},
        streamingRefs: null,
        streamingText: { value: '' },
        streamIndex: 0,
        streamPollTimer: null,
        currentConversationId: 7,
        currentStreamConvId: 7,
        currentMessageId: 'm1',
        isBusy: true,
        hideContinueButton() {}, exitStopMode() {},
        showContinueButton() {},
    };
    const body = part0 + '\n' + part1 + '\n' + part2 +
        '\nreturn { addMessageRow, createStreamingBubble,' +
        ' updateStreamingBubble, finalizeStreamingBubble, startPolling };';
    const make = () => new Function(...Object.keys(scope), body)(
        ...Object.values(scope));
    let fns = make();
    // refresh(): ri-crea le closure con i parametri ATTUALI di scope
    // (le funzioni estratte leggono streamingRefs/streamingText come
    // parametri: vanno rilegati dopo averli valorizzati)
    return {
        doc, chatView, scope,
        get fns() { return fns; },
        refresh() { fns = make(); return fns; },
    };
}

(async function main() {
    /* -------- (a) + (c) dedupe e riga staccata ---------------- */
    console.log('== funzionali rendering ==');
    {
        const { chatView, scope, fns } = buildScope();
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'm9';
        scope.streamingRefs.row.setAttribute('data-msg-id', 'm9');
        fns.finalizeStreamingBubble(scope.streamingRefs,
            'Risposta finale di prova.', 'locale', []);
        let rows = chatView.querySelectorAll('.msg-row.ai');
        ok(rows.length === 1, '(a) 1 riga ai dopo finalize', rows.length);
        ok(rows[0].getAttribute('data-msg-id') === 'm9',
            '(a) data-msg-id presente');
        // finalize DUPLICATA (stesso refs) -> sempre 1 riga
        fns.finalizeStreamingBubble(scope.streamingRefs,
            'Risposta finale di prova (2).', 'locale', []);
        rows = chatView.querySelectorAll('.msg-row.ai');
        ok(rows.length === 1, '(a) finalize due volte -> ancora 1 riga',
            rows.length);
        // riga STACCATA (race openConversation) -> nuova riga unica
        scope.streamingRefs.row.remove();
        fns.finalizeStreamingBubble(scope.streamingRefs,
            'Testo dopo race openConversation.', 'locale', []);
        rows = chatView.querySelectorAll('.msg-row.ai');
        ok(rows.length === 1, '(c) riga staccata -> 1 riga (nessun doppione)',
            rows.length);
        ok((rows[0].textContent || '').indexOf('Testo dopo race') >= 0,
            '(c) contenuto finale presente');
        // staccata MA testo gia' presente nel DOM -> nessuna aggiunta
        scope.streamingRefs.row.remove();
        fns.finalizeStreamingBubble(scope.streamingRefs,
            'Testo dopo race openConversation.', 'locale', []);
        rows = chatView.querySelectorAll('.msg-row.ai');
        ok(rows.length === 1, '(c) testo identico gia\' in DOM -> no dup',
            rows.length);
        // updateStreamingBubble su nodo staccato -> nessun crash
        scope.streamingRefs.row.remove();
        let threw = false;
        try { fns.updateStreamingBubble(scope.streamingRefs, 'x'); }
        catch (e) { threw = true; }
        ok(!threw, '(c) update su nodo staccato senza eccezione');
    }

    /* -------- (b) reset_count -> testo azzerato e riscritto --- */
    {
        const env = buildScope();
        const { doc, chatView, scope } = env;
        let fns = env.fns;
        let n = 0;
        const polls = [
            { tokens: ['Ciao vecchio'], total: 1, reset_count: 0 },
            { tokens: [], total: 1, reset_count: 1 },          // RETRY
            { tokens: ['Nuovo testo'], total: 1, reset_count: 1 },
            { tokens: [], done: true, total: 1, reset_count: 1,
              source: 'locale', sources: [] },
        ];
        scope.window.pywebview.api = {
            async poll_stream() {
                const p = polls[Math.min(n, polls.length - 1)];
                n++;
                return Object.assign({}, p);
            },
            async cleanup_stream() { return { success: true }; },
        };
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'mB';
        scope.streamingRefs.row.setAttribute('data-msg-id', 'mB');
        scope.streamIndex = 0;
        fns = env.refresh();          // rilegatura parametri (streamingRefs)
        fns.startPolling('mB');
        await sleep(700);
        const final = scope.streamingText.value;
        ok(final.indexOf('Nuovo testo') >= 0,
            '(b) testo dopo reset presente', JSON.stringify(final));
        ok(final.indexOf('Ciao vecchio') < 0,
            '(b) vecchio testo AZZERATO dal reset (retry sostituisce)',
            JSON.stringify(final));
        const rows = chatView.querySelectorAll('.msg-row.ai');
        ok(rows.length === 1, '(b) 1 riga finale', rows.length);
    }

    /* -------- (d) streaming: primi ~40 token in un blocco ------- */
    {
        const env = buildScope();
        const { scope } = env;
        let fns = env.fns;
        let n = 0;
        const tok = (k) => Array.from({ length: 10 },
            (_, i) => 't' + (k * 10 + i) + ' ');
        const polls = [
            { tokens: tok(0), total: 10, reset_count: 0 },
            { tokens: tok(1), total: 20, reset_count: 0 },
            { tokens: tok(2), total: 30, reset_count: 0 },
            { tokens: tok(3), total: 40, reset_count: 0 },
            { tokens: tok(4), total: 50, reset_count: 0 },
            { tokens: [], done: true, total: 50, reset_count: 0,
              source: 'locale', sources: [] },
        ];
        scope.window.pywebview.api = {
            async poll_stream() {
                const p = polls[Math.min(n, polls.length - 1)];
                n++;
                return Object.assign({}, p);
            },
            async cleanup_stream() { return { success: true }; },
        };
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'mD';
        scope.streamIndex = 0;
        fns = env.refresh();
        fns.startPolling('mD');
        await sleep(250);      // ~3 poll (80ms) -> 30 token < 40
        const early = (scope.streamingRefs.content.innerHTML || '').trim();
        ok(!early, '(d) NESSUN render prima dei ~40 token (blocco in attesa)',
           JSON.stringify(early.slice(0, 60)));
        await sleep(450);      // poll4 = primo blocco, poi passi, poi done
        const late = scope.streamingRefs.content.innerHTML || '';
        ok(/t0 /.test(late),
           '(d) dopo 40 token il primo blocco compare', late.slice(0, 80));
        ok(/t49/.test(late),
           '(d) a fine stream il testo completo e renderizzato', late.length);
    }

    /* -------- (e) riga di provenienza (R18, no citazioni) ------- */
    {
        const env = buildScope();
        const { chatView, scope } = env;
        let fns = env.fns;
        // combinazione reale mista
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'e1';
        fns.finalizeStreamingBubble(scope.streamingRefs,
            'Risposta con provenienza mista.', 'web',
            [{ stage: 'appunti' }, { stage: 'web' }], ['appunti', 'web']);
        const prov = chatView.querySelector('[data-qa="provenienza"]');
        ok(!!prov, '(e) riga provenienza presente', prov ? 'si' : 'no');
        ok(prov && prov.textContent === 'Fonti: appunti e web',
           '(e) combinazione reale degli stadi',
           prov && prov.textContent);
        ok(prov && parseFloat(prov.style.fontSize) <= 12,
           '(e) carattere piccolo (<=12px)', prov && prov.style.fontSize);
        ok(!chatView.querySelector('[data-qa="source-badges"]'),
           '(e) nessuna chip fonti');
        ok(!/\[F1\]/.test(chatView.textContent),
           '(e) nessun codice [F1] nel testo');
        // singolo stadio
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'e2';
        fns.finalizeStreamingBubble(scope.streamingRefs,
            'Risposta solo locale.', 'locale',
            [{ stage: 'appunti' }], ['appunti']);
        const provs = chatView.querySelectorAll('[data-qa="provenienza"]');
        ok(provs.length === 2, '(e) righe su due messaggi', provs.length);
        ok(provs[1].textContent === 'Fonte: appunti',
           '(e) Fonte singola', provs[1].textContent);
        // stages assenti (reload/vecchi) -> derive dai sources
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'e3';
        fns.finalizeStreamingBubble(scope.streamingRefs, 'Derivata.', 'web',
            [{ stage: 'web' }], undefined);
        const all = chatView.querySelectorAll('[data-qa="provenienza"]');
        ok(all[all.length - 1].textContent === 'Fonte: web',
           '(e) provenienza derivata dai sources',
           all[all.length - 1].textContent);
        // R18 B1.3: evento con stadi VUOTI -> riga onesta
        // "nessuna fonte trovata" (nessun contributore)
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'e4';
        fns.finalizeStreamingBubble(scope.streamingRefs, 'Chitchat.', 'nessuna',
            [], []);
        let all4 = chatView.querySelectorAll('[data-qa="provenienza"]');
        ok(all4.length === 4 &&
           all4[all4.length - 1].textContent === 'nessuna fonte trovata',
           '(e) stadi vuoti -> "nessuna fonte trovata"',
           all4.length + ':' +
           ((all4[all4.length - 1] || {}).textContent || ''));
        // senza evento stadi (undefined) -> NESSUNA riga
        scope.streamingRefs = fns.createStreamingBubble();
        scope.streamingRefs._msgId = 'e5';
        fns.finalizeStreamingBubble(scope.streamingRefs, 'Salve.', 'nessuna',
            undefined, undefined);
        const n5 = chatView.querySelectorAll('[data-qa="provenienza"]').length;
        ok(n5 === 4, '(e) nessuna riga senza evento stadi', n5);
    }

    console.log('\n== RISULTATO: %d passati, %d falliti ==', pass, fail);
    if (failures.length) {
        console.log('Falliti:\n - ' + failures.join('\n - '));
    }
    process.exit(fail ? 1 : 0);
})().catch(e => {
    console.error('ECCEZIONE:', e);
    process.exit(1);
});
