/* ============================================================
   qa_browser/r18_chat.js — screenshot UI REALE chatbot (R18)

   Carica web_frontend/html/index.html con stub pywebview che riproduce
   le SEQUENZE DI TOKEN REALI di qa/r18_tokens_v{1..4}.json (testi reali
   di qa/r18_verify.json).

   Verifica per screenshot (4 query):
   - riga piccola di provenienza ("Fonte: web" / "Fonte: appunti")
   - NESSUN codice [F1]/[W1], NESSUN blocco "Fonti:" con URL,
     NESSUN marker di troncamento, NESSUN badge/controllo web
   - streaming a blocchi, UNA riga AI
   Eseguire: node qa_browser/r18_chat.js   (rete: NESSUNA)
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('./node_modules/puppeteer');

const ROOT = path.join(__dirname, '..');
const IDX = 'file://' + path.join(ROOT, 'web_frontend', 'html', 'index.html');

const EXPECT = {
    v1: { prov: 'Fonte: web' },
    v2: { prov: 'Fonte: web' },
    v3: { prov: 'Fonte: appunti' },
    v4: { prov: 'Fonte: web' },
};

function loadCase(cid) {
    const tok = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'qa', `r18_tokens_${cid}.json`), 'utf8'));
    const ver = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'qa', 'r18_verify.json'), 'utf8'));
    const c = ver.cases.find(x => x.case === cid);
    if (!c) throw new Error('caso non trovato: ' + cid);
    const pieces = [];
    let off = 0;
    for (const ev of tok.tokens) {
        pieces.push(c.text_full.slice(off, off + ev.n));
        off += ev.n;
    }
    if (off < c.text_full.length) pieces.push(c.text_full.slice(off));
    return { query: c.query, pieces, sources: tok.sources || [],
             stages: tok.stages || [] };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
    let pass = 0, fail = 0;
    const ok = (cond, name, extra) => {
        if (cond) { pass++; console.log('  PASS  ' + name); }
        else { fail++; console.log('  FAIL  ' + name +
               (extra ? ' - ' + extra : '')); }
    };

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1366, height: 860 },
    });

    for (const cid of Object.keys(EXPECT)) {
        const data = loadCase(cid);
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));

        await page.evaluateOnNewDocument((pieces, sources, stages) => {
            let idx = 0;
            const api = {
                async send_message() {
                    return { message_id: 'r18_' + pieces.length,
                             conversation_id: 88 };
                },
                async poll_stream() {
                    if (idx >= pieces.length) {
                        return { tokens: [], total: idx, done: true,
                                 source: 'locale', sources: sources,
                                 source_stages: stages,
                                 reset_count: 0, stopped: false,
                                 generation_active: false,
                                 waiting_continue: false, progress: [],
                                 error: null, part_current: 0,
                                 part_total: 0 };
                    }
                    const batch = pieces.slice(idx, idx + 3);
                    idx += batch.length;
                    return { tokens: batch, total: idx, done: false,
                             source: 'nessuna', sources: [],
                             source_stages: [],
                             reset_count: 0, stopped: false,
                             generation_active: true,
                             waiting_continue: false, progress: [],
                             error: null, part_current: 0,
                             part_total: 0 };
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
                async create_chat() { return 88; },
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
        }, data.pieces, data.sources, data.stages);

        await page.goto(IDX, { waitUntil: 'domcontentloaded',
                               timeout: 30000 });
        await page.evaluate(() => {
            window.dispatchEvent(new Event('pywebviewready'));
        });
        await sleep(800);
        await page.evaluate(() => {
            if (window.App && App.go) App.go('chat-session');
        });
        await sleep(350);

        // statico: nessun controllo web
        const ui = await page.evaluate(() => ({
            chip: !!document.getElementById('webToggleChip'),
            webSel: !!document.getElementById('webModeSelect'),
        }));
        ok(!ui.chip && !ui.webSel,
           `${cid} UI: nessun badge/controllo web`);

        await page.evaluate((q) => {
            const inp = document.getElementById('chatInput');
            inp.value = q;
            document.getElementById('sendBtn').click();
        }, data.query);

        // shot streaming (dopo il primo blocco)
        await page.waitForFunction(
            () => {
                const el = document.querySelector('.msg-row.ai .ai-content');
                return el && el.textContent.trim().length > 20;
            }, { timeout: 15000 });
        await page.screenshot({ path: path.join(ROOT, 'qa',
            `r18_chat_${cid}_streaming.png`) });

        // fine stream
        await page.waitForFunction(
            () => !document.querySelector('.streaming-spinner'),
            { timeout: 60000 });
        await sleep(400);
        await page.screenshot({ path: path.join(ROOT, 'qa',
            `r18_chat_${cid}_finale.png`) });

        const end = await page.evaluate(() => {
            const rows = document.querySelectorAll('.msg-row.ai');
            const el = document.querySelector('.msg-row.ai .ai-content');
            const txt = (el && el.textContent || '');
            const prov = el && el.querySelector('[data-qa="provenienza"]');
            return { rows: rows.length, txt: txt,
                     provText: prov ? prov.textContent : null,
                     provSize: prov ? prov.style.fontSize : null,
                     chips: !!el && !!el.querySelector('[data-qa='
                             + "'source-badges'" + ']'),
                     trunc: txt.indexOf('risposta abbreviata') >= 0,
                     webChip: !!document.getElementById('webToggleChip') };
        });
        const exp = EXPECT[cid];
        ok(end.rows === 1, `${cid} UNA sola riga AI`, String(end.rows));
        ok(end.provText === exp.prov,
           `${cid} riga provenienza "${exp.prov}"`, String(end.provText));
        ok(end.provSize && parseFloat(end.provSize) <= 12,
           `${cid} provenienza in carattere piccolo`, String(end.provSize));
        ok(!end.chips, `${cid} nessuna chip fonti`);
        ok(!/\[(?:F|W)\d+\]/.test(end.txt),
           `${cid} nessun codice [F1]/[W1] nel testo`);
        ok(!end.trunc, `${cid} nessun marker di troncatura`);
        ok(!/Fonti:.*https?:/m.test(end.txt),
           `${cid} nessun blocco Fonti con URL`);
        ok(!end.webChip, `${cid} nessun badge web`);
        ok(errors.length === 0, `${cid} zero errori JS`,
           errors.slice(0, 3).join(' | '));
        await page.close();
        console.log(`-- ${cid} completato`);
    }

    await browser.close();
    console.log(`\nRISULTATO: ${pass} passati, ${fail} falliti`);
    process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error('ECCEZIONE:', e); process.exit(1); });
