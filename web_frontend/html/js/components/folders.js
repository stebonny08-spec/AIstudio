/* ============================================================
   components/folders.js — sistema di CARTELLE globale.
   Usato da Chatbot (kind 'chat'), Appunti ('note'), Schemi ('schema')
   e visualizzato dalla Biblioteca. Tutto locale via StudyStore.
   ============================================================ */
window.Folders = (function () {
    'use strict';

    const state = {};   // kind -> id cartella corrente ('' = radice)

    function get(kind) { return state[kind] || ''; }
    function set(kind, id) { state[kind] = id || ''; }
    function normalizeName(n) {
        return String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
    }
    function list(kind) { return StudyStore.listFolders(kind); }
    function byId(folders, id) {
        for (let i = 0; i < folders.length; i++) if (folders[i].id === id) return folders[i];
        return null;
    }
    function nameOf(folders, id) {
        if (!id) return 'Principale';
        const f = byId(folders, id);
        return f ? f.name : 'Principale';
    }

    // palette di 8 colori per le cartelle
    const FOLDER_COLORS = ['#f9974a', '#e05252', '#8ca4ff', '#7fc8a9',
                           '#c9b8e8', '#ffd98a', '#ff9ecb', '#4ecdc4'];

    // ---------- dialog creazione/rinomina: nome OBBLIGATORIO + colore ----------
    // FIX: la classe "show" va aggiunta altrimenti l'overlay resta
    // invisibile (opacity:0) e inerte — era il bug di "Nuova cartella".
    function askFolderDialog(title, value, color) {
        return new Promise(function (resolve) {
            const ov = App.el('div', 'modal-overlay');
            const m = App.el('div', 'modal modal-sm');
            const head = App.el('div', 'modal-header');
            head.appendChild(App.el('span', 'modal-title', App.esc(title)));
            m.appendChild(head);
            const body = App.el('div', 'modal-body');

            const field = App.el('div', 'field');
            field.appendChild(App.el('label', null, 'Nome cartella'));
            const inp = App.el('input');
            inp.type = 'text';
            inp.value = value == null ? '' : String(value);
            inp.placeholder = 'Nome cartella (obbligatorio)';
            field.appendChild(inp);
            const err = App.el('div');
            err.style.cssText = 'color:#e05252;font-size:12px;display:none;margin-top:5px';
            err.textContent = 'Il nome della cartella e\u00f9 obbligatorio.';
            field.appendChild(err);
            body.appendChild(field);

            const fC = App.el('div', 'field');
            fC.appendChild(App.el('label', null, 'Colore'));
            const row = App.el('div');
            row.style.cssText = 'display:flex;gap:9px;flex-wrap:wrap';
            let picked = color || FOLDER_COLORS[0];
            FOLDER_COLORS.forEach(function (hex) {
                const c = App.el('button', 'folder-color');
                c.type = 'button';
                c.title = hex;
                c.style.cssText = 'width:28px;height:28px;border-radius:50%;border:2px solid ' +
                    (hex === picked ? '#fff' : 'rgba(255,255,255,.18)') +
                    ';background:' + hex + ';cursor:pointer;padding:0;';
                c.addEventListener('click', function () {
                    picked = hex;
                    row.querySelectorAll('.folder-color').forEach(function (x) {
                        x.style.borderColor = 'rgba(255,255,255,.18)';
                    });
                    c.style.borderColor = '#fff';
                });
                row.appendChild(c);
            });
            fC.appendChild(row);
            body.appendChild(fC);

            const actions = App.el('div', 'form-actions');
            const cancel = App.el('button', 'btn-secondary');
            cancel.type = 'button'; cancel.textContent = 'Annulla';
            const ok = App.el('button', 'btn-accent');
            ok.type = 'button'; ok.textContent = 'Salva';
            actions.appendChild(cancel); actions.appendChild(ok);
            body.appendChild(actions);
            m.appendChild(body); ov.appendChild(m);
            document.body.appendChild(ov);
            // rende il dialog VISIBILE (bug fix)
            requestAnimationFrame(function () { ov.classList.add('show'); });

            let done = false;
            function submit() {
                const name = String(inp.value || '').trim();
                if (!name) {
                    err.style.display = 'block';
                    inp.focus();
                    return;
                }
                finish({ name: name, color: picked });
            }
            function finish(v) {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                ov.classList.remove('show');
                setTimeout(function () { ov.remove(); }, 200);
                resolve(v);
            }
            function onKey(e) {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(null); }
                e.stopPropagation();
            }
            document.addEventListener('keydown', onKey, true);
            ok.addEventListener('click', submit);
            cancel.addEventListener('click', function () { finish(null); });
            ov.addEventListener('click', function (e) { if (e.target === ov) finish(null); });
            setTimeout(function () { inp.focus(); inp.select(); }, 60);
        });
    }

    // ---------- operazioni ----------
    async function create(kind, parent) {
        const res = await askFolderDialog('Nuova cartella', '', null);
        if (!res) return null;
        const name = normalizeName(res.name);
        if (!name) return null;
        try {
            const f = await StudyStore.saveFolder({
                kind: kind, name: name, color: res.color,
                parent_id: parent !== undefined ? parent : get(kind)
            });
            return f;
        } catch (e) {
            console.error('Crea cartella:', e);
            alert('Impossibile creare la cartella: ' + (e.message || e));
            return null;
        }
    }

    async function rename(folder) {
        const res = await askFolderDialog('Modifica cartella', folder.name, folder.color);
        if (!res) return null;
        const name = normalizeName(res.name);
        if (!name) return null;
        if (name === folder.name && res.color === folder.color) return null;
        try {
            return await StudyStore.saveFolder({
                id: folder.id, kind: folder.kind, name: name, color: res.color,
                parent_id: folder.parent_id || ''
            });
        } catch (e) { console.error('Modifica cartella:', e); return null; }
    }

    async function remove(folder) {
        if (!confirm('Eliminare la cartella "' + folder.name + '"?\n\n' +
                'Gli elementi al suo interno NON vengono eliminati: tornano all\u2019elenco principale.')) {
            return false;
        }
        try {
            await StudyStore.deleteFolder(folder.id);
            if (get(folder.kind) === folder.id) set(folder.kind, folder.parent_id || '');
            return true;
        } catch (e) { console.error('Elimina cartella:', e); return false; }
    }

    // ---------- UI: barra "Nuova cartella" + breadcrumb ----------
    function bar(kind, onNavigate) {
        const wrap = App.el('div', 'folder-bar');

        const btn = App.el('button', 'tool-btn');
        btn.type = 'button';
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Nuova cartella';
        btn.addEventListener('click', async function () {
            const f = await create(kind);
            if (f) onNavigate();
        });
        wrap.appendChild(btn);

        const crumb = App.el('nav', 'folder-crumb');
        crumb.setAttribute('aria-label', 'Percorso cartelle');
        wrap.appendChild(crumb);

        // aggiorna breadcrumb in base alle cartelle disponibili
        list(kind).then(function (folders) {
            crumb.innerHTML = '';
            function link(label, id, current) {
                const a = App.el('button', 'folder-crumb-item' + (current ? ' current' : ''));
                a.type = 'button';
                a.textContent = label;
                if (!current) a.addEventListener('click', function () {
                    set(kind, id);
                    onNavigate();
                });
                crumb.appendChild(a);
            }
            function sep() { crumb.appendChild(App.el('span', 'folder-crumb-sep', '/')); }

            link('\uD83D\uDCC1', '', get(kind) === '');   // icona cartella, senza testo
            // catena dei padri fino alla corrente
            const chain = [];
            let cur = byId(folders, get(kind));
            while (cur) { chain.unshift(cur); cur = byId(folders, cur.parent_id || ''); }
            chain.forEach(function (f) {
                sep();
                const isLast = f.id === get(kind);
                link(f.name, f.id, isLast);
            });
            wrap._folders = folders;
        }).catch(function () { /* barra base */ });

        return wrap;
    }

    // ---------- UI: griglia cartelle ----------
    function grid(kind, onOpen) {
        const wrap = App.el('div', 'folder-grid');
        list(kind).then(function (folders) {
            const parent = get(kind);
            const visible = folders.filter(function (f) { return (f.parent_id || '') === parent; });
            if (!visible.length) { wrap._folders = folders; return; }
            visible.forEach(function (f) {
                const card = App.el('div', 'folder-card');
                card.tabIndex = 0;
                const openIt = function () { set(kind, f.id); onOpen(); };
                const head = App.el('div', 'folder-card-head');
                head.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
                    '<span class="folder-card-name">' + App.esc(f.name) + '</span>';
                // cartella COLORATA: icona + dot del suo colore
                if (f.color) {
                    const svgEl = head.querySelector('svg');
                    if (svgEl) svgEl.style.color = f.color;
                    const nameEl = head.querySelector('.folder-card-name');
                    if (nameEl) {
                        const dot = App.el('span');
                        dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:' +
                            f.color + ';flex-shrink:0';
                        nameEl.parentNode.insertBefore(dot, nameEl);
                    }
                }
                head.addEventListener('click', openIt);
                card.appendChild(head);

                const acts = App.el('div', 'card-actions');
                const ren = App.el('button'); ren.type = 'button'; ren.textContent = 'Rinomina';
                ren.addEventListener('click', async function (e) {
                    e.stopPropagation();
                    if (await rename(f)) onOpen();
                });
                const del = App.el('button'); del.type = 'button'; del.className = 'danger'; del.textContent = 'Elimina';
                del.addEventListener('click', async function (e) {
                    e.stopPropagation();
                    if (await remove(f)) onOpen();
                });
                acts.appendChild(ren); acts.appendChild(del);
                card.appendChild(acts);

                card.addEventListener('keydown', function (e) { if (e.key === 'Enter') openIt(); });
                wrap.appendChild(card);
            });
            wrap._folders = folders;
        }).catch(function (e) { console.error('Folders.grid:', e); });
        return wrap;
    }

    // ---------- UI: menu "Sposta in…" (cartelle colorate + Principale) ----------
    function moveSelect(kind, currentValue, onChange) {
        const btn = App.el('button', 'tool-btn folder-move-btn');
        btn.type = 'button';
        btn.textContent = 'Sposta in\u2026';
        btn.title = 'Sposta in una cartella o nella lista principale';
        let menu = null;

        function closeMenu() {
            if (!menu) return;
            menu.remove();
            menu = null;
            document.removeEventListener('click', onDoc, true);
        }
        function onDoc(e) {
            if (menu && !menu.contains(e.target) && e.target !== btn) closeMenu();
        }
        function mkItem(label, id, color) {
            const it = App.el('button', 'folder-move-item');
            it.type = 'button';
            it.style.cssText = 'display:flex;gap:9px;align-items:center;width:100%;background:none;' +
                'border:none;color:#e8ecf4;font-family:inherit;font-size:13px;padding:8px 10px;' +
                'border-radius:8px;cursor:pointer;text-align:left;';
            const dot = App.el('span');
            dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex-shrink:0;background:' +
                (color || (id ? '#f9974a' : '#8b95a5'));
            it.appendChild(dot);
            it.appendChild(App.el('span', null, label));
            it.addEventListener('mouseenter', function () { it.style.background = 'rgba(255,255,255,.08)'; });
            it.addEventListener('mouseleave', function () { it.style.background = 'none'; });
            it.addEventListener('click', function (e) {
                e.stopPropagation();
                closeMenu();
                onChange(id || '');
            });
            return it;
        }

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (menu) { closeMenu(); return; }
            list(kind).then(function (folders) {
                menu = App.el('div', 'folder-move-menu');
                menu.style.cssText = 'position:fixed;z-index:120;background:#1a2030;' +
                    'border:1px solid #2a3142;border-radius:12px;padding:6px;min-width:200px;' +
                    'box-shadow:0 12px 30px rgba(0,0,0,.5);';
                // voce per tornare alla lista principale (radice)
                menu.appendChild(mkItem('Principale', '', null));
                folders.forEach(function (f) {
                    menu.appendChild(mkItem(f.name, f.id, f.color));
                });
                const r = btn.getBoundingClientRect();
                menu.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 216)) + 'px';
                menu.style.top = Math.min(r.bottom + 6, window.innerHeight - 40 - 44 * (folders.length + 1)) + 'px';
                document.body.appendChild(menu);
                setTimeout(function () { document.addEventListener('click', onDoc, true); }, 0);
            }).catch(function () { /* solo Principale */ });
        });
        return btn;
    }

    // ---------- helper dati ----------
    function filterItems(items, kind) {
        const cur = get(kind);
        return (items || []).filter(function (i) { return (i.folder_id || '') === cur; });
    }

    return {
        get: get, set: set, list: list, create: create, rename: rename, remove: remove,
        bar: bar, grid: grid, moveSelect: moveSelect, filterItems: filterItems,
        nameOf: nameOf, byId: byId, normalizeName: normalizeName
    };
})();
