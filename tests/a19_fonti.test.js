'use strict';
/* tests/a19_fonti.test.js - R19 (Round 19) BLOCCHI A1+A3 - R21 B1: il
   pannello Fonti degli Appunti e' il COMPONENTE UNICO FontiPanel
   (fonti_panel.js, caricato da _ink_env PRIMA di notes.js): i selettori
   sono ieri .fn-* oggi .fp21-*.
   Copre:
   (A1) toolbar sinistra finale: ordine undo/redo, immagine, Documento, ppt,
        fonti, Flashcard; assenza 'AI' e 'Migliora'; nessun [data-shaping];
   (A3) chip filtro Tutti|Appunti|Materiali|Libri + persistenza in
        localStorage 'fp21_filter' (anche dopo riapertura editor);
        ricerca collassabile (lente .fp21-lens);
        preview .md renderizzata (h1/strong/li, MAI path/codice grezzo);
        preview nota visiva (paragrafi + thumbnail immagini);
        assenza totale metadati (Percorso:/Dimensione:/Tipo file:/Indicizzato);
        pannello ~340px (default componente) entro 60% viewport;
        inserimento nella nota funzionante.
   Esecuzione: node tests/a19_fonti.test.js */
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = env0.sleep;
/* helper variadici: accettano (sel) oppure (env, sel) - entrambi gli stili */
let ENV = null;
function $(a, b) { const sel = (b === undefined) ? a : b; return ENV.doc.querySelector(sel); }
function $$(a, b) { const sel = (b === undefined) ? a : b; return Array.from(ENV.doc.querySelectorAll(sel)); }
function click(a, b) { const elm = b || a; elm.dispatchEvent(new ENV.win.MouseEvent('click', { bubbles: true })); }
function setInput(a, b, c) {
    const input = (c === undefined) ? a : b;
    const v = (c === undefined) ? b : c;
    input.value = v;
    input.dispatchEvent(new ENV.win.Event('input', { bubbles: true }));
}
function noteObjects(env, id) {
    const it = env.store.items.filter(x => x.id === id)[0];
    if (!it || !it.content) return [];
    let d;
    try { d = JSON.parse(it.content); } catch (e) { return []; }
    if (Array.isArray(d.pages) && d.pages.length) return d.pages[0].objects || [];
    return d.objects || [];
}
const META_RE = /Percorso:|Dimensione:|Tipo file:|Indicizzato il/;
const MD_TEXT = '# Titolo MD\n\nParagrafo con **grasso** e *corsivo*.\n\n- elemento uno\n- elemento due';

(async () => {
    try {
        const env = env0.makeEnv();
        ENV = env;

        // ---- seed fonti aggiuntive (study + materiali) ----
        env.store.items.push({
            id: 'r1', kind: 'riassunto', title: 'Riassunto Alfa',
            content: JSON.stringify({
                objects: [
                    { t: 'text', x: 40, y: 40, w: 300, h: 30, text: 'Contenuto riassunto alfa.', size: 14, color: '#141414' },
                    { t: 'image', x: 40, y: 90, w: 120, h: 80, src: 'data:image/png;base64,AAAA' }
                ]
            }),
            materia: 'STORIA', tags: '', description: '', thumbnail: '', folder_id: ''
        });
        env.store.items.push({
            id: 'd1', kind: 'documento', title: 'Documento Beta',
            content: 'Dispensa di geologia: le rocce magmatiche.', materia: '', tags: '',
            description: '', thumbnail: '', folder_id: ''
        });
        env.store.mats.push({ path: 'C:/preselected_books/libro-gamma.pdf', name: 'Libro Gamma' });
        env.store.mats.push({ path: 'C:/file_AIstudio/riassunto-md.md', name: 'riassunto-md.md' });

        // stub pywebview: read_material_text (i .md restituiscono markdown)
        env.win.pywebview = {
            api: {
                read_material_text: async function (p) {
                    const isMd = /\.md$/i.test(String(p || ''));
                    return {
                        success: true, kind: isMd ? 'md' : 'pdf',
                        name: 'x', size: 2048,
                        text: isMd ? MD_TEXT : 'Testo del libro gamma in pagina uno.'
                    };
                }
            }
        };

        await env0.openNote(env, 'n1');
        ok(!!$('.fn-pill-left'), '0.0 editor appunti aperto (pill presente)');

        // ===========================================================
        // 1) A1 - TOOLBAR SINISTRA FINALE
        // ===========================================================
        console.log('== A19-1: toolbar sinistra finale ==');
        const pillL = $('.fn-pill-left');
        ok(!!pillL, '1.0 pill sinistra presente');
        if (pillL) {
            const visBtns = Array.from(pillL.children)
                .filter(el => el.tagName === 'BUTTON' && el.style.display !== 'none');
            const titles = visBtns.map(b => b.title || (b.textContent || '').trim());
            // undo ha il title A2.6 esteso (due livelli): match sul prefisso
            ok(titles.length === 7 &&
                titles[0].startsWith('Annulla (Ctrl+Z)') &&
                titles[1] === 'Ripeti (Ctrl+Y)' &&
                titles[2] === 'Immagine' &&
                titles[3] === 'Documento' &&
                titles[4] === 'File PPT/PPTX' &&
                titles[5] === 'Fonti' &&
                titles[6] === 'Genera flashcard dalla nota/selezione (AI: F01)',
                '1.1 ordine finale: undo, redo, immagine, Documento, ppt, fonti, Flashcard',
                titles.join(' | '));
            const texts = visBtns.map(b => (b.textContent || '').trim());
            const allLabels = texts.concat(titles);
            ok(!allLabels.some(x => x === 'AI'), '1.2 tasto "AI" assente dalla toolbar', JSON.stringify(allLabels));
            ok(!allLabels.some(x => x === 'Migliora'), '1.3 tasto "Migliora" (F05) assente dalla toolbar', JSON.stringify(allLabels));
            ok(texts.includes('Flashcard'), '1.4 tasto "Flashcard" presente');
            const docBtn = visBtns.filter(b => b.title === 'Documento')[0];
            ok(!!docBtn, '1.5 tasto "Documento" presente (ex Testo file)');
            ok($$(env, '[data-shaping]').length === 0,
                '1.6 nessuna icona dedicata rettangolo/freccia ([data-shaping] assente)');
            // il toggle "Migliora scrittura" (modalita aiuto) resta
            ok(!!$('[data-help]'), '1.7 toggle "Migliora scrittura" (aiuto) invariato presente');
        }

        // ===========================================================
        // 2) A3 - CHIP FILTRO + FILTRAGGIO + PERSISTENZA
        // ===========================================================
        console.log('== A19-2: chip filtro Fonti (FontiPanel) ==');
        const btnFonti = $('[data-fonti]');
        ok(!!btnFonti, '2.0 bottone Fonti presente');
        click(env, btnFonti);
        await sleep(240); // refresh() async del componente
        ok(!!$('.fp21-root.show'), '2.1 pannello Fonti aperto (classe .show su .fp21-root)');
        ok(!!$('.fp21-root[data-fp21="appunti"]'), '2.1b componente montato con contesto appunti');

        let chips = $$('.fp21-chip');
        const labels = chips.map(c => c.textContent.trim());
        ok(labels.join(',') === 'Tutti,Appunti,Documenti,Presentazioni,Fogli,Video,Chat,Materiali,Libri',
            '2.2 chip R28: Tutti|Appunti|Documenti|Presentazioni|Fogli|Video|Chat|Materiali|Libri',
            labels.join(','));
        ok(chips.length > 0 && chips[0].classList.contains('active'),
            '2.3 chip "Tutti" attivo di default');

        const itemsTitle = () => $$('.fp21-item').map(b => b.textContent);
        let t = itemsTitle();
        ok(t.length === 5, '2.4 elenco completo (3 study + 2 mat) = 5 voci', 'n=' + t.length);

        // Appunti -> solo le NOTE (R28: i chip ora sono per-categoria:
        // Riassunti/Documenti hanno chip/sezioni proprie in "Tutti")
        const chipApp = chips.filter(c => c.textContent.trim() === 'Appunti')[0];
        click(env, chipApp);
        await sleep(60);
        t = itemsTitle();
        ok(t.length === 1 && /Nota Ink/.test(t[0]),
            '2.5 filtro Appunti -> solo le note (1 voce, R28)', JSON.stringify(t));
        ok(env.win.localStorage.getItem('fp21_filter') === 'appunti',
            '2.6 persistenza localStorage filtro appunti (fp21_filter)',
            String(env.win.localStorage.getItem('fp21_filter')));

        // Libri -> solo preselected_books
        chips = $$('.fp21-chip');
        click(env, chips.filter(c => c.textContent.trim() === 'Libri')[0]);
        await sleep(60);
        t = itemsTitle();
        ok(t.length === 1 && /Libro Gamma/.test(t[0]),
            '2.7 filtro Libri -> solo Libro Gamma', JSON.stringify(t));
        ok(env.win.localStorage.getItem('fp21_filter') === 'libri',
            '2.8 persistenza filtro libri');

        // Materiali -> solo mat non-libro
        chips = $$('.fp21-chip');
        click(env, chips.filter(c => c.textContent.trim() === 'Materiali')[0]);
        await sleep(60);
        t = itemsTitle();
        ok(t.length === 1 && /riassunto-md/.test(t[0]),
            '2.9 filtro Materiali -> solo materiale .md', JSON.stringify(t));

        // Tutti -> ripristino completo
        chips = $$('.fp21-chip');
        click(env, chips.filter(c => c.textContent.trim() === 'Tutti')[0]);
        await sleep(60);
        ok($$('.fp21-item').length === 5, '2.10 filtro Tutti -> elenco completo');

        // persistenza su riapertura editor
        chips = $$('.fp21-chip');
        click(env, chips.filter(c => c.textContent.trim() === 'Libri')[0]);
        await sleep(60);
        await env0.openNote(env, 'n1');   // riapre l'editor da zero
        await sleep(240);
        click(env, $('[data-fonti]'));
        await sleep(240);
        chips = $$('.fp21-chip');
        const activeChip = chips.filter(c => c.classList.contains('active'))[0];
        ok(!!activeChip && activeChip.textContent.trim() === 'Libri',
            '2.11 filtro persistito dopo riapertura editor (chip Libri attivo)',
            activeChip ? activeChip.textContent : 'nessuno');
        t = itemsTitle();
        ok(t.length === 1 && /Libro Gamma/.test(t[0]),
            '2.12 lista gia filtrata su Libri dopo riapertura', JSON.stringify(t));

        // ===========================================================
        // 3) A3.3 - PREVIEW .md RENDERIZZATA (mai codice grezzo/path)
        // ===========================================================
        console.log('== A19-3: preview markdown (adapter fonti_panel) ==');
        chips = $$('.fp21-chip');
        click(env, chips.filter(c => c.textContent.trim() === 'Tutti')[0]);
        await sleep(60);
        // ricerca collassata di default: lente .fp21-lens per aprirla
        const searchEl = $('.fp21-search');
        ok(!!searchEl && searchEl.style.display === 'none', '3.0a ricerca COLLASSATA di default (spec 2.2)');
        click(env, $('.fp21-lens'));
        ok(!!searchEl && searchEl.style.display !== 'none', '3.0b lente .fp21-lens APRE la ricerca');
        setInput(env, searchEl, 'md');
        await sleep(60);
        let mdItem = $$('.fp21-item').filter(b => /riassunto-md/.test(b.textContent))[0];
        ok(!!mdItem, '3.0 materiale .md trovato con la ricerca');
        if (mdItem) {
            click(env, mdItem);
            await sleep(200); // read_material_text stub async
            const prev = $('.fp21-preview');
            const pbody = $('.fp21-pbody');
            const html = pbody ? pbody.innerHTML : '';
            ok(/<h1[^>]*>Titolo MD<\/h1>/.test(html), '3.1 md: h1 renderizzato', html.slice(0, 120));
            ok(/<strong>grasso<\/strong>/.test(html), '3.2 md: strong renderizzato');
            ok(/<li>elemento uno<\/li>/.test(html) && /<li>elemento due<\/li>/.test(html),
                '3.3 md: lista <li> renderizzata');
            ok(/<em>corsivo<\/em>/.test(html), '3.4 md: em renderizzato');
            ok(!META_RE.test(prev.textContent), '3.5 md: NESSUN metadato in preview (A3.4)',
                prev.textContent.slice(0, 100));
            ok(!/C:\/file_AIstudio/.test(html) && !/\.md['"\s]/.test(html.replace(/riassunto-md\.md/g, '')),
                '3.6 md: NESSUN path grezzo nel preview', html.slice(0, 120));
            const badge = prev.querySelector('.fp21-ptitle .fp21-badge');
            ok(!!badge && badge.textContent.trim() === 'Materiale',
                '3.7 badge tipo "Materiale" (solo etichetta)', badge ? badge.textContent : 'assente');
            const ftitle = prev.querySelector('.fp21-ptitle');
            ok(!!ftitle && ftitle.textContent.indexOf('riassunto-md.md') >= 0,
                '3.8 titolo fonte in testata preview', ftitle ? ftitle.textContent : 'assente');
            // inserimento .md -> oggetto t:'file'
            const ins = $('.fp21-insert');
            ok(ins && !ins.disabled, '3.9 bottone "Inserisci nella nota" abilitato');
            if (ins) {
                click(env, ins);
                await sleep(1150); // debounce salvataggio 900ms
                const objs = noteObjects(env, 'n1');
                ok(objs.some(o => o.t === 'file' && /riassunto-md\.md$/.test(String(o.path || ''))),
                    '3.10 inserimento .md -> oggetto t:file salvato',
                    JSON.stringify(objs.map(o => o.t)));
            }
        }

        // ===========================================================
        // 4) A3.3 - PREVIEW NOTA VISIVA (paragrafi + thumbnail)
        // ===========================================================
        console.log('== A19-4: preview visiva nota/riassunto ==');
        setInput(env, $('.fp21-search'), 'Alfa');
        await sleep(60);
        const rItem = $$('.fp21-item').filter(b => /Riassunto Alfa/.test(b.textContent))[0];
        ok(!!rItem, '4.0 riassunto trovato con la ricerca');
        if (rItem) {
            click(env, rItem);
            await sleep(150);
            const prev = $('.fp21-preview');
            const pbody = $('.fp21-pbody');
            ok(!!pbody && !!pbody.querySelector('p') && /Contenuto riassunto alfa/.test(prev.textContent),
                '4.1 contenuto renderizzato in paragrafo <p>', pbody ? pbody.innerHTML.slice(0, 100) : '');
            const thumb = prev.querySelector('img.fp21-thumb');
            ok(!!thumb && /^data:image\//.test(thumb.getAttribute('src') || ''),
                '4.2 thumbnail immagine presente (img.fp21-thumb)');
            ok(!META_RE.test(prev.textContent), '4.3 preview nota: nessun metadato');
            ok(!!prev.querySelector('.fp21-ptitle'), '4.4 testata titolo+badge in preview (.fp21-ptitle)');
        }
        setInput(env, $('.fp21-search'), '');
        await sleep(40);

        // ===========================================================
        // 5) A3.2 - DIMENSIONI PANNELLO (default del componente)
        // ===========================================================
        console.log('== A19-5: dimensioni pannello ==');
        const fpRoot = $('.fp21-root');
        ok(!!fpRoot, '5.1 pannello montato (.fp21-root) con width/height inline');
        const w = fpRoot ? String(fpRoot.style.width) : '';
        const h = fpRoot ? String(fpRoot.style.height) : '';
        ok(w === '340px', '5.2 larghezza default 340px (DEFAULT_W del componente)', 'w=' + w);
        const maxH = Math.floor((ENV.win.innerHeight || 768) * 0.6);
        ok(/^\d+px$/.test(h) && Number(h.replace('px', '')) <= maxH,
            '5.3 altezza entro il 60% del viewport (resize 240..60%)', 'h=' + h + ' max=' + maxH);
        const css = Array.from(env.doc.head.querySelectorAll('style'))
            .map(s => s.textContent).join('\n');
        ok(/\.fp21-root\{[^}]*position:absolute/.test(css),
            '5.4 layout host per .fp21-root fornito da notes.js (CSS fp21)');

        // ===========================================================
        // 6) igiene: zero eccezioni console
        // ===========================================================
        ok(env.consoleErrors.length === 0, '6.0 zero eccezioni console/jsdom',
            env.consoleErrors.slice(0, 2).join(' | '));

    } catch (e) {
        fail++;
        failures.push('ECCEZIONE: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
        console.error(e);
    }
    console.log('\nRISULTATO a19_fonti: ' + pass + ' passati, ' + fail + ' falliti');
    if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
    process.exit(fail ? 1 : 0);
})();
