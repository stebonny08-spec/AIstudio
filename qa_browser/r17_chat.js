/* ============================================================
   qa_browser/r17_chat.js — screenshot UI REALE chatbot (R17)

   Carica web_frontend/html/index.html nel browser reale con stub
   pywebview che riproduce le SEQUENZE DI TOKEN REALI registrate in
   qa/r17_tokens_v1/v2.json + qa/r17_verify.json (testi completi veri).

   Verifica per screenshot:
   - NESSUN badge/controllo web in UI (#webToggleChip assente)
   - streaming a blocchi (primo render dopo ~40 eventi, poi progressivo)
   - risposta finale con badge fonti/citazioni
   Eseguire: node qa_browser/r17_chat.js   (rete: NESSUNA)
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('./node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const IDX = 'file://' + path.join(ROOT, 'web_frontend', 'html', 'index.html');

function loadCase(cid) {
    const tok = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'qa', `r17_tokens_${cid}.json`), 'utf8'));
    const ver = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'qa', 'r17_verify.json'), 'utf8'));
    const c = ver.cases.find(x => x.case === cid);
    if (!c) throw new Error('caso non trovato: ' + cid);
    // ricostruzione dei pezzi REALI dai conteggi n (ordine reale)
    const pieces = [];
    let off = 0;
    for (const ev of tok.tokens) {
        pieces.push(c.text_full.slice(off, off + ev.n));
        off += ev.n;
    }
    if (off < c.text_full.length) pieces.push(c.text_full.slice(off));
    return { query: c.query, pieces, sources: c.sources || [] };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
    let pass = 0, fail = 0;
    const ok = (cond, name) => {
        if (cond) { pass++; console.log('  PASS  ' + name); }
        else { fail++; console.log('  FAIL  ' + name); }
    };

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox',
               '--window-size=1366,860'],
        defaultViewport: { width: 1366, height: 860 },
    });

    for (const cid of ['v1', 'v2']) {
        const data = loadCase(cid);
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        page.on('console', m => {
            if (m.type() === 'error') errors.push('console: ' + m.text());
        });

        // stub pywebview con sequenza reale (cadenza compressa dichiarata:
        // 1 poll x 55ms, batch 3 eventi - comportamento FE reale, tempi
        // veri misurati in qa/r17_verify.json)
        await page.evaluateOnNewDocument((pieces, sources) => {
            let idx = 0, resetCount = 0;
            const api = {
                async send_message() {
                    return { message_id: 'r17m1', conversation_id: 77 };
                },
                async poll_stream(id, from) {
                    if (idx >= pieces.length) {
                        return { tokens: [], total: idx, done: true,
                                 source: 'web', sources: sources,
                                 reset_count: resetCount, stopped: false,
                                 generation_active: false,
                                 waiting_continue: false,
                                 progress: [], error: null,
                                 part_current: 0, part_total: 0 };
                    }
                    const batch = pieces.slice(idx, idx + 3);
                    idx += batch.length;
                    return { tokens: batch, total: idx, done: false,
                             source: 'nessuna', sources: [],
                             reset_count: resetCount, stopped: false,
                             generation_active: true,
                             waiting_continue: false, progress: [],
                             error: null, part_current: 0, part_total: 0 };
                },
                async cleanup_stream() { return { success: true }; },
                async stop_generation() { return { success: true }; },
                async get_conversations() { return []; },
                async get_messages() { return []; },
                async get_model_status() {
                    return { state: 'ready', progress: 1 };
                },
                async app_settings_get() {
                    return { ok: true, settings: {
                        'gate.threshold': 0.7, 'web.mode': 'auto',
                        'web.wikipedia': true, 'web.searxng_url': '' } };
                },
                async app_settings_set() { return { ok: true }; },
                async check_for_updates() { return { configured: false }; },
                async create_chat() { return 77; },
                async list_folders() { return []; },
                async list_conversations() { return []; },
                async save_chat_meta() { return { ok: true }; },
                async get_topic() { return ''; },
                async ai_flag_wrong() { return { ok: true }; },
                async flag_wrong_answer() { return { ok: true, removed: 1 }; },
            };
            window.pywebview = { api: new Proxy(api, {
                get(t, k) {
                    if (k in t) return t[k];
                    return async () => ({ ok: true, success: true,
                                           settings: {}, conversations: [],
                                           state: 'ready',
                                           configured: false });
                },
            }) };
        }, data.pieces, data.sources);

        await page.goto(IDX, { waitUntil: 'domcontentloaded',
                               timeout: 30000 });
        await page.evaluate(() => {
            window.dispatchEvent(new Event('pywebviewready'));
        });
        await sleep(900);
        // navigazione alla vista chat (come farebbe l'utente su
        // "Nuova conversazione") - altrimenti la chat resta fuori viewport
        await page.evaluate(() => {
            if (window.App && App.go) App.go('chat-session');
        });
        await sleep(400);

        // --- asserts statici UI (nessun controllo web) -------------------
        const ui = await page.evaluate(() => ({
            chip: !!document.getElementById('webToggleChip'),
            webModeSel: !!document.getElementById('webModeSelect'),
            searx: !!document.getElementById('searxngUrlInput'),
            wiki: !!document.getElementById('wikipediaToggle'),
            webAttivoText: document.body.innerText.includes('Web: attivo'),
            privacy: !!document.getElementById('privacyWebDesc'),
        }));
        ok(!ui.chip && !ui.webModeSel && !ui.searx && !ui.wiki
           && !ui.webAttivoText,
           `${cid} UI: nessun badge/controllo web (assenza visibile)`);
        ok(ui.privacy, `${cid} UI: nota privacy presente`);

        // --- invio query reale ------------------------------------------
        await page.evaluate((q) => {
            const inp = document.getElementById('chatInput');
            inp.value = q;
            document.getElementById('sendBtn').click();
        }, data.query);
        await sleep(400);

        // shot 1: streaming in corso (dopo il primo blocco ~40 eventi:
        // con batch 3 x 55ms -> ~0.75s) + nessun badge web
        await page.waitForFunction(
            () => {
                const el = document.querySelector('.msg-row.ai .ai-content');
                return el && el.textContent.trim().length > 20;
            }, { timeout: 8000 });
        await page.screenshot({ path: path.join(ROOT, 'qa',
            `r17_chat_${cid}_streaming.png`) });
        const mid = await page.evaluate(() => {
            const rows = document.querySelectorAll('.msg-row.ai');
            const el = document.querySelector('.msg-row.ai .ai-content');
            const r = rows[0] && rows[0].getBoundingClientRect();
            return { rows: rows.length,
                     txt: (el && el.textContent || '').length,
                     spinner: !!document.querySelector('.streaming-spinner'),
                     onScreen: !!r && r.top >= 0
                               && r.top < window.innerHeight,
                     chip: !!document.getElementById('webToggleChip') };
        });
        ok(mid.onScreen, `${cid} chat visibile in viewport (screenshot reale)`,
           JSON.stringify(mid));
        ok(mid.rows === 1, `${cid} 1 sola riga AI durante lo stream`,
           String(mid.rows));
        ok(mid.txt > 20 && mid.txt < data.pieces.join('').length,
           `${cid} streaming PARZIALE visibile (blocco, non tutto insieme)`,
           `${mid.txt}/${data.pieces.join('').length}`);
        ok(!mid.chip, `${cid} nessun badge web in fase di streaming`);

        // fine stream: spinner via, testo completo, badge fonti
        await page.waitForFunction(
            () => !document.querySelector('.streaming-spinner'),
            { timeout: 25000 });
        await sleep(300);
        await page.screenshot({ path: path.join(ROOT, 'qa',
            `r17_chat_${cid}_finale.png`) });
        const end = await page.evaluate(() => {
            const rows = document.querySelectorAll('.msg-row.ai');
            const el = document.querySelector('.msg-row.ai .ai-content');
            const txt = (el && el.textContent || '');
            return { rows: rows.length, len: txt.length,
                     badges: !!el && !!el.querySelector('[data-qa='
                             + "'source-badges'" + ']'),
                     hasFonti: txt.includes('Fonti') ||
                               /\[(?:F|W)\d+\]/.test(txt),
                     chip: !!document.getElementById('webToggleChip') };
        });
        ok(end.rows === 1, `${cid} UNA sola riga AI a fine risposta`,
           String(end.rows));
        ok(end.len >= 80, `${cid} risposta >=80 char (${end.len})`);
        ok(end.badges || end.hasFonti,
           `${cid} citazioni/badge fonti presenti`);
        ok(!end.chip, `${cid} nessun badge web a fine risposta`);
        ok(errors.length === 0, `${cid} zero errori JS`,
           errors.slice(0, 3).join(' | '));
        await page.close();
        console.log(`-- ${cid} completato (errori JS: ${errors.length})`);
    }

    await browser.close();
    console.log(`\nRISULTATO: ${pass} passati, ${fail} falliti`);
    process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ECCEZIONE:', e); process.exit(1); });
