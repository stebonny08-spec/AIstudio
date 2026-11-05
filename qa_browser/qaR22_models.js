/* qa_browser/qaR22_models.js - R22 B4: screenshot dropdown Modelli con
   voce PRO PRIMA della base (menu Modelli di web_frontend/html/index.html).

   - window.pywebview.api STUBBATO: list_models restituisce i due item in
     ordine ["pro", "base"] come da MODELS_CATALOG reale, le altre API
     rispondono con valori generici neutri.
   - Apre il menu "Seleziona modelli", verifica l'ordine delle voci e lo
     stato delle azioni, poi screenshot.

   Output: qa/r22_models_dropdown.png + qa/r22_models_measures.json
   Esecuzione: node qa_browser/qaR22_models.js */
'use strict';
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const QA_DIR = path.join(ROOT, 'qa');
fs.mkdirSync(QA_DIR, { recursive: true });

const VW = 1366, VH = 900;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PRO = {
    key: 'pro',
    display_name: 'Modello pro (Spark-X2.6-4B)',
    filename: 'spark-x2.6-4b.gguf',
    size_bytes: 3543441312,
    downloaded: true,
    active: false,
    loading: false,
};
const BASE = {
    key: 'base',
    display_name: 'Modello base (MiniCPM5-2B)',
    filename: 'MiniCPM5-2B-Q4_K_M.gguf',
    size_bytes: null,
    downloaded: true,
    active: true,
    loading: false,
};

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--allow-file-access-from-files'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH });

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('console', m => {
        if (m.type() === 'error') consoleErrors.push(m.text());
    });

    // ---- stub window.pywebview.api PRIMA di qualunque script della pagina
    await page.evaluateOnNewDocument((pro, base) => {
        const specific = {
            list_models: async () => window.__R22_MODELS,  // ordine pro PRIMA
            get_model_status: async () => ({
                state: 'ready', progress: 1.0, error: null,
                model_key: 'base', rss_before_mb: null, rss_after_mb: null,
            }),
            get_download_progress: async () => ({
                active: false, model_key: '', downloaded_bytes: 0,
                total_bytes: 0, speed_bps: 0, error: null,
            }),
            load_model: async () => ({ success: true, loading: true }),
            download_model: async () => ({ success: true, started: true }),
        };
        const fallback = () => Promise.resolve([]);
        const api = new Proxy(specific, {
            get: (t, k) => (typeof k === 'string' && k in t) ? t[k] : fallback,
        });
        window.__R22_MODELS = [pro, base];
        window.pywebview = { api };
        window.dispatchEvent(new Event('pywebviewready'));
    }, PRO, BASE);

    await page.goto(pathToFileURL(
        path.join(ROOT, 'web_frontend', 'html', 'index.html')).href,
        { waitUntil: 'load', timeout: 60000 });

    // attesa deterministica del menu Modelli
    let found = false;
    for (let i = 0; i < 200; i++) {
        if (await page.$('#modelsBtn')) { found = true; break; }
        await sleep(100);
    }
    if (!found) {
        console.error('BLOCKED: #modelsBtn non trovato');
        process.exit(2);
    }
    await sleep(600); // lascia girare refreshModelsList iniziale

    // click DOM diretto (niente hit-test headless): l'event listener
    // reale del bottone viene comunque invocato
    await page.evaluate(() => document.getElementById('modelsBtn').click());
    await sleep(600);

    const menuVisible = await page.evaluate(() => {
        const m = document.getElementById('modelsMenu');
        return !!(m && m.classList.contains('show'));
    });

    const items = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#modelsList .model-item'))
            .map(it => ({
                name: (it.querySelector('.model-name') || {}).textContent || '',
                action: (it.querySelector('.model-action') || {}).textContent || '',
                actionClass: (it.querySelector('.model-action') || {}).className || '',
                disabled: !!(it.querySelector('.model-name') || {}).disabled,
            })));

    const order = items.map(i => i.name);
    const okOrder = order.length === 2
        && order[0] === 'Modello pro (Spark-X2.6-4B)'
        && order[1] === 'Modello base (MiniCPM5-2B)';

    console.log('menu_visible:', menuVisible, 'ok_order:', okOrder);
    if (pageErrors.length) console.log('pageerror:', pageErrors.slice(0, 5));
    if (consoleErrors.length) console.log('console.error:', consoleErrors.slice(0, 5));
    if (!items.length) console.log('Nessun item nel menu (items vuoto)');

    const shotPath = path.join(QA_DIR, 'r22_models_dropdown.png');
    let menuShot = false;
    try {
        const menu = await page.$('#modelsMenu');
        if (menu && menuVisible) {
            const bb = await menu.boundingBox();
            if (bb && bb.width > 0 && bb.height > 0) {
                await page.screenshot({ path: shotPath,
                    clip: { x: Math.max(0, bb.x - 8), y: Math.max(0, bb.y - 8),
                            width: bb.width + 16, height: bb.height + 16 } });
                menuShot = true;
            }
        }
    } catch (e) {
        console.log('menu screenshot KO:', e.message);
    }
    if (!menuShot) await page.screenshot({ path: shotPath });

    // --- seconda截图: voce pro NON scaricata -> "Scarica… (~3.3 GB)" ---
    let dlLabel = null;
    try {
        await page.evaluate(() => {
            window.__R22_MODELS[0].downloaded = false;
            if (typeof window.refreshModelsList === 'function') {
                return window.refreshModelsList();
            }
        });
        await sleep(500);
        const dlItems = await page.evaluate(() =>
            Array.from(document.querySelectorAll('#modelsList .model-item'))
                .map(it => ({
                    name: (it.querySelector('.model-name') || {}).textContent || '',
                    action: (it.querySelector('.model-action') || {}).textContent || '',
                    actionClass: (it.querySelector('.model-action') || {}).className || '',
                })));
        dlLabel = dlItems[0] || null;
        const dlPath = path.join(QA_DIR, 'r22_models_dropdown_download.png');
        let dlShot = false;
        try {
            const menu2 = await page.$('#modelsMenu');
            if (menu2) {
                const bb2 = await menu2.boundingBox();
                if (bb2 && bb2.width > 0 && bb2.height > 0) {
                    await page.screenshot({ path: dlPath,
                        clip: { x: Math.max(0, bb2.x - 8), y: Math.max(0, bb2.y - 8),
                                width: bb2.width + 16, height: bb2.height + 16 } });
                    dlShot = true;
                }
            }
        } catch (e) { console.log('dl screenshot KO:', e.message); }
        if (!dlShot) await page.screenshot({ path: dlPath });
    } catch (e) {
        dlLabel = { error: String(e) };
    }

    const measures = {
        ts: new Date().toISOString(),
        menu_visible: menuVisible,
        order,
        ok_order: okOrder,
        pro_is_check: items[0] ? /is-check/.test(items[0].actionClass) : false,
        base_is_check: items[1] ? /is-check/.test(items[1].actionClass) : false,
        items,
        page_errors: pageErrors,
        console_errors: consoleErrors,
        screenshot: 'qa/r22_models_dropdown.png',
        screenshot_download_state: 'qa/r22_models_dropdown_download.png',
        download_label_item: dlLabel,
        download_label_ok: !!(dlLabel && /Scarica/.test(dlLabel.action || '')
            && /3\.3 GB/.test(dlLabel.action || '')),
    };
    fs.writeFileSync(path.join(QA_DIR, 'r22_models_measures.json'),
        JSON.stringify(measures, null, 2));

    console.log('ORDINE:', JSON.stringify(order));
    console.log('menu_shot:', menuShot, 'download_label_ok:',
        measures.download_label_ok);
    console.log('download_label_item:',
        JSON.stringify(measures.download_label_item));

    await browser.close();

    if (!okOrder || !menuVisible) {
        console.error('FAIL: dropdown non corretto');
        process.exit(1);
    }
    console.log('OK: qa/r22_models_dropdown.png');
})().catch(e => { console.error('ECCEZIONE:', e); process.exit(1); });
