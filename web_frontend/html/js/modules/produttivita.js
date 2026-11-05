/* ============================================================
   modules/produttivita.js — hub del modulo Produttività.
   4 sub-tool registrati in window.StudyTools dai file:
   presentazioni.js, documenti.js, fogli.js, video.js.
   - open() → hub a 4 card oppure il tool richiesto
     (params.tool) oppure l'elemento richiesto (params.open).
   - Ogni tool torna all'hub; l'hub torna alla Home.
   ============================================================ */
(function () {
    'use strict';

    const TOOLS = [
        {
            id: 'presentazioni', title: 'Presentazioni',
            desc: 'Slide 16:9 con testi, immagini, media locali e modalità presentazione.',
            kinds: ['presentazione'],
            iconClass: '',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M8 21h8"/><path d="M6 8h6M6 12h8"/></svg>'
        },
        {
            id: 'documenti', title: 'Documenti',
            desc: 'Editor di testo con stili, liste, tabelle, immagini ed export Markdown/HTML.',
            kinds: ['documento'],
            iconClass: 'blue',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/></svg>'
        },
        {
            id: 'fogli', title: 'Fogli di calcolo',
            desc: 'Griglia A-Z × 60 con formule (SUM, IF, …), formati, CSV in/out.',
            kinds: ['foglio'],
            iconClass: 'green',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>'
        },
        {
            id: 'video', title: 'Video',
            desc: 'Timeline di clip testo/immagini/media con transizioni, preview e musica.',
            kinds: ['video'],
            iconClass: 'pink',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>'
        }
    ];

    let active = null;   // id del tool attualmente aperto

    function toolDef(id) {
        return (window.StudyTools && window.StudyTools[id]) || null;
    }

    function flushActive() {
        if (!active) return;
        const def = toolDef(active);
        if (def && typeof def.close === 'function') {
            try { def.close(); } catch (e) { console.error('close tool ' + active + ':', e); }
        }
        active = null;
    }

    // ---------- dialogo testo condiviso (usato dai sub-tool) ----------
    window.StudyAsk = function (title, value, placeholder) {
        return new Promise(function (resolve) {
            const ov = App.el('div', 'modal-overlay');
            const m = App.el('div', 'modal');
            const head = App.el('div', 'modal-header');
            head.appendChild(App.el('span', 'modal-title', App.esc(title || 'Inserisci un valore')));
            m.appendChild(head);
            const body = App.el('div', 'modal-body');
            const field = App.el('div', 'field');
            const inp = App.el('input');
            inp.type = 'text';
            inp.value = value == null ? '' : String(value);
            if (placeholder) inp.placeholder = placeholder;
            field.appendChild(inp);
            body.appendChild(field);
            const actions = App.el('div', 'form-actions');
            const cancel = App.el('button', 'btn-secondary');
            cancel.type = 'button';
            cancel.textContent = 'Annulla';
            const ok = App.el('button', 'btn-accent');
            ok.type = 'button';
            ok.textContent = 'OK';
            actions.appendChild(cancel);
            actions.appendChild(ok);
            body.appendChild(actions);
            m.appendChild(body);
            ov.appendChild(m);
            document.body.appendChild(ov);
            // rende il dialog VISIBILE (bug fix: senza "show" resta invisibile)
            requestAnimationFrame(function () { ov.classList.add('show'); });

            let done = false;
            function finish(v) {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                ov.remove();
                resolve(v);
            }
            function onKey(e) {
                if (e.key === 'Enter') { e.preventDefault(); finish(inp.value); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
                e.stopPropagation();
            }
            document.addEventListener('keydown', onKey, true);
            ok.addEventListener('click', function () { finish(inp.value); });
            cancel.addEventListener('click', function () { finish(null); });
            ov.addEventListener('click', function (e) { if (e.target === ov) finish(null); });
            setTimeout(function () { inp.focus(); inp.select(); }, 60);
        });
    };

    // fallback se il sub-tool viene caricato prima dell'hub
    function askFallback(title, value) {
        const r = prompt(title, value == null ? '' : String(value));
        return Promise.resolve(r);
    }
    if (!window.StudyAskPromise) window.StudyAskPromise = window.StudyAsk || askFallback;

    // ---------- HUB ----------
    function renderHub(container) {
        flushActive();
        container.innerHTML = '';
        container.appendChild(App.header(
            'Produttività',
            'Presentazioni, documenti, fogli di calcolo e video: tutto in locale.'));

        const grid = App.el('div', 'grid-cards');
        TOOLS.forEach(function (t) {
            const def = toolDef(t.id) || {};
            const card = App.el('div', 'card clickable');
            card.tabIndex = 0;
            card.innerHTML =
                '<div style="display:flex;gap:12px;align-items:center">' +
                '<div class="icon-tile ' + t.iconClass + '">' + (def.icon || t.icon) + '</div>' +
                '<div style="min-width:0">' +
                '<h4>' + App.esc(def.title || t.title) + '</h4>' +
                '<div style="font-size:12.5px;color:var(--muted);line-height:1.45">' +
                App.esc(def.desc || t.desc) + '</div>' +
                '</div></div>' +
                '<div class="preview" data-recent="' + t.id + '" style="margin-top:10px">…</div>';
            function open() { App.go('produttivita', { tool: t.id }); }
            card.addEventListener('click', open);
            card.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
            grid.appendChild(card);

            const kind = t.kinds[0];
            StudyStore.listItems(kind).then(function (items) {
                const box = card.querySelector('[data-recent="' + t.id + '"]');
                if (!box) return;
                box.textContent = (items && items.length)
                    ? 'Ultimo: ' + (items[0].title || 'senza titolo') +
                      (items.length > 1 ? '  ·  ' + items.length + ' elementi' : '')
                    : 'Nessun elemento ancora';
            }).catch(function () {
                const box = card.querySelector('[data-recent="' + t.id + '"]');
                if (box) box.textContent = '';
            });
        });
        container.appendChild(grid);
    }

    // ---------- TOOL ----------
    function renderTool(container, toolId, params) {
        const def = toolDef(toolId);
        if (!def) { renderHub(container); return; }
        flushActive();
        active = toolId;
        container.innerHTML = '';

        const back = App.el('button', 'tool-btn');
        back.type = 'button';
        back.innerHTML = '&larr; Produttività';
        back.addEventListener('click', function () { App.go('produttivita'); });

        // Nessun header Home/titolo/sottotitolo: ogni tool usa la SUA
        // barra unica (la specifica vieta l'header di modulo qui dentro).
        const body = App.el('div');
        container.appendChild(body);
        try {
            const r = def.render(body, params || {});
            if (r && typeof r.catch === 'function') r.catch(function (e) { console.error('render tool:', e); });
        } catch (e) {
            console.error('render tool ' + toolId + ':', e);
            body.appendChild(App.empty(App.ICONS.notes, 'Errore nell’apertura del tool. Vedi console (F12).'));
        }
    }

    // ---------- registrazione modulo ----------
    App.registerModule({
        id: 'produttivita',
        title: 'Produttività',
        desc: 'Presentazioni, documenti, fogli di calcolo e video: tutto in locale.',
        icon: App.ICONS.produttivita || App.ICONS.notes,
        kinds: ['presentazione', 'documento', 'foglio', 'video'],
        open: function (container, params) {
            params = params || {};
            container.innerHTML = '';

            if (params.open) {
                // elemento richiesto (es. dalla biblioteca): trova il tool dal kind
                StudyStore.getItem(params.open).then(function (item) {
                    if (!container.isConnected) return;
                    if (item) {
                        let tid = null;
                        for (let i = 0; i < TOOLS.length; i++) {
                            if (TOOLS[i].kinds.indexOf(item.kind) >= 0) { tid = TOOLS[i].id; break; }
                        }
                        if (!tid && params.tool && toolDef(params.tool)) tid = params.tool;
                        if (tid) { renderTool(container, tid, { open: item.id }); return; }
                    }
                    renderHub(container);
                }).catch(function () {
                    if (container.isConnected) renderHub(container);
                });
                return;
            }

            if (params.tool && toolDef(params.tool)) {
                renderTool(container, params.tool, params);
                return;
            }
            renderHub(container);
        },
        close: function () {
            flushActive();
        },
        recent: async function () {
            try {
                let last = null;
                for (let i = 0; i < TOOLS.length; i++) {
                    const items = await StudyStore.listItems(TOOLS[i].kinds[0]);
                    if (items && items.length) {
                        const it = items[0];
                        if (!last || String(it.updated_at || '') > String(last.updated_at || '')) last = it;
                    }
                }
                return last ? 'Ultimo: ' + last.title : '';
            } catch (e) { return ''; }
        }
    });
})();
