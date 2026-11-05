/* ============================================================
   store.js — wrapper del bridge pywebview per i nuovi moduli.
   Se il backend non è disponibile (apertura in browser puro),
   usa localStorage come fallback locale: mai rete, mai cloud.
   ============================================================ */
window.StudyStore = (function () {
    const READY = new Promise(resolve => {
        const t0 = Date.now();
        (function poll() {
            if (window.pywebview && window.pywebview.api) return resolve(true);
            if (Date.now() - t0 > 20000) return resolve(false);
            setTimeout(poll, 120);
        })();
    });

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
        return 'x' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
    }

    async function hasBackend() {
        await READY;
        return !!(window.pywebview && window.pywebview.api);
    }

    function api(name, ...args) {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api[name] === 'function') {
            return window.pywebview.api[name](...args);
        }
        return Promise.reject(new Error('Backend non disponibile'));
    }

    // ---------- fallback localStorage ----------
    const LS = { items: 'ns_items', subjects: 'ns_subjects', events: 'ns_events' };
    function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage pieno */ } }
    function withPreview(it) {
        const c = (it.content || '').replace(/\n/g, ' ');
        return Object.assign({}, it, { preview: c.slice(0, 180) });
    }

    function lsFilterSort(items, opts) {
        opts = opts || {};
        if (opts.kind) items = items.filter(i => i.kind === opts.kind);
        if (opts.materia) items = items.filter(i => i.materia === opts.materia);
        if (opts.tag) items = items.filter(i => (i.tags || '').split(',').indexOf(opts.tag) >= 0);
        if (opts.query) {
            const q = opts.query.toLowerCase();
            items = items.filter(i =>
                (i.title || '').toLowerCase().includes(q) ||
                (i.description || '').toLowerCase().includes(q) ||
                ((i.preview || '') + (i.content || '')).toLowerCase().includes(q));
        }
        items = items.slice();
        if (opts.sort === 'name') items.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
        else if (opts.sort === 'kind') items.sort((a, b) => (a.kind || '').localeCompare(b.kind || ''));
        else items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        return items;
    }

    const store = {
        ready: READY,
        uuid,
        hasBackend,

        // ---------- elementi generici ----------
        async listItems(kind, opts) {
            opts = opts || {};
            opts.kind = kind || opts.kind || '';
            if (await hasBackend()) {
                try {
                    const r = await api('study_list', opts.kind, opts.query || '', opts.materia || '', opts.tag || '', opts.sort || 'updated');
                    return r || [];
                } catch (e) { console.error('study_list:', e); return []; }
            }
            return lsFilterSort(lsGet(LS.items, []).map(withPreview), opts);
        },
        async getItem(id) {
            if (await hasBackend()) {
                try { return await api('study_get', id); } catch (e) { return null; }
            }
            const it = lsGet(LS.items, []).find(i => i.id === id);
            return it || null;
        },
        async saveItem(p) {
            if (await hasBackend()) {
                const r = await api('study_save', p);
                if (r && r.error) throw new Error(r.error);
                return r.item;
            }
            const all = lsGet(LS.items, []);
            const now = new Date().toISOString();
            let it = p.id ? all.find(i => i.id === p.id) : null;
            if (it) {
                Object.assign(it, p, { updated_at: now });
            } else {
                it = Object.assign({ id: uuid(), created_at: now, updated_at: now,
                    materia: '', tags: '', description: '', thumbnail: '', content: '' }, p);
                all.unshift(it);
            }
            lsSet(LS.items, all);
            return it;
        },
        async deleteItem(id) {
            if (await hasBackend()) return api('study_delete', id);
            lsSet(LS.items, lsGet(LS.items, []).filter(i => i.id !== id));
            return { success: true };
        },
        async duplicateItem(id) {
            if (await hasBackend()) return api('study_duplicate', id);
            const all = lsGet(LS.items, []);
            const src = all.find(i => i.id === id);
            if (!src) throw new Error('Elemento non trovato');
            const now = new Date().toISOString();
            const copy = Object.assign({}, src, { id: uuid(), title: src.title + ' (copia)', created_at: now, updated_at: now });
            all.unshift(copy);
            lsSet(LS.items, all);
            return { success: true, item: copy };
        },
        async renameItem(id, title) {
            if (await hasBackend()) return api('study_rename', id, title);
            const it = lsGet(LS.items, []).find(i => i.id === id);
            if (it) { it.title = title; it.updated_at = new Date().toISOString(); lsSet(LS.items, lsGet(LS.items, [])); }
            return { success: true };
        },

        // ---------- materie ----------
        async listSubjects() {
            if (await hasBackend()) { try { return (await api('subjects_list')) || []; } catch (e) { return []; } }
            return lsGet(LS.subjects, []);
        },
        async saveSubject(p) {
            if (await hasBackend()) { const r = await api('subjects_save', p); if (r.error) throw new Error(r.error); return r.subject; }
            const all = lsGet(LS.subjects, []);
            let s = p.id ? all.find(x => x.id === p.id) : null;
            if (s) Object.assign(s, p);
            else { s = Object.assign({ id: uuid(), created_at: new Date().toISOString(), color: '#8ca4ff' }, p); all.push(s); }
            lsSet(LS.subjects, all);
            return s;
        },
        async deleteSubject(id) {
            if (await hasBackend()) return api('subjects_delete', id);
            lsSet(LS.subjects, lsGet(LS.subjects, []).filter(s => s.id !== id));
            return { success: true };
        },

        // ---------- calendario ----------
        async listEvents() {
            if (await hasBackend()) { try { return (await api('events_list')) || []; } catch (e) { return []; } }
            return lsGet(LS.events, []);
        },
        async saveEvent(p) {
            if (await hasBackend()) { const r = await api('events_save', p); if (r.error) throw new Error(r.error); return r.event; }
            const all = lsGet(LS.events, []);
            let e = p.id ? all.find(x => x.id === p.id) : null;
            if (e) Object.assign(e, p);
            else { e = Object.assign({ id: uuid(), created_at: new Date().toISOString(), tipo: 'studio', subject_id: '', note: '', ricorrenza: 'nessuna', link_kind: '', link_id: '' }, p); all.push(e); }
            lsSet(LS.events, all);
            return e;
        },
        async deleteEvent(id) {
            if (await hasBackend()) return api('events_delete', id);
            lsSet(LS.events, lsGet(LS.events, []).filter(e => e.id !== id));
            return { success: true };
        },

        // ---------- chatbot ----------
        async listConversations() {
            if (await hasBackend()) { try { return (await api('get_conversations')) || []; } catch (e) { return []; } }
            return [];
        },
        async deleteConversation(id) {
            if (await hasBackend()) return api('delete_conversation', id);
            return { success: false };
        },
        async saveChatMeta(chatId, meta) {
            if (await hasBackend()) { try { return await api('chat_meta_save', chatId, meta.materia || '', meta.attivita || ''); } catch (e) { return null; } }
            return null;
        },
        async listModels() {
            if (await hasBackend()) { try { return (await api('list_models')) || []; } catch (e) { return []; } }
            return [];
        },

        // ---------- materiali / biblioteca ----------
        async listMaterials() {
            if (await hasBackend()) { try { return (await api('materials_list')) || []; } catch (e) { return []; } }
            return [];
        },

        // ---------- cartelle (sistema globale: chat | note | schema) ----------
        async listFolders(kind) {
            if (await hasBackend()) {
                try { return (await api('folders_list', kind)) || []; } catch (e) { return []; }
            }
            return lsGet('ns_folders', []).filter(f => f.kind === kind);
        },
        async saveFolder(p) {
            if (await hasBackend()) {
                const r = await api('folders_save', p);
                if (r && r.error) throw new Error(r.error);
                return r.folder;
            }
            const all = lsGet('ns_folders', []);
            let f = p.id ? all.find(x => x.id === p.id) : null;
            if (f) Object.assign(f, p);
            else {
                f = Object.assign({ id: uuid(), kind: 'note', name: 'Cartella', parent_id: '', created_at: new Date().toISOString() }, p);
                all.push(f);
            }
            lsSet('ns_folders', all);
            return f;
        },
        async deleteFolder(id) {
            if (await hasBackend()) return api('folders_delete', id);
            // fallback: elementi tornati alla radice, sottocartelle salite al padre
            const all = lsGet('ns_folders', []);
            const target = all.find(f => f.id === id);
            if (target) {
                lsSet('ns_items', lsGet(LS.items, []).map(i => i.folder_id === id ? Object.assign({}, i, { folder_id: '' }) : i));
                all.forEach(f => { if (f.parent_id === id) f.parent_id = target.parent_id || ''; });
                lsSet('ns_folders', all.filter(f => f.id !== id));
            }
            return { success: true };
        },
        async moveChat(conversationId, folderId) {
            if (await hasBackend()) return api('chat_folder_save', conversationId, folderId || '');
            return { success: false };
        },

        // ---------- materie: normalizzazione + salvataggio ----------
        normalizeSubject(name) {
            return String(name == null ? '' : name)
                .replace(/\s+/g, ' ').trim()
                .toLocaleUpperCase('it-IT');
        },
        async rememberSubject(name, color) {
            const norm = store.normalizeSubject(name);
            if (!norm) return null;
            const subs = await store.listSubjects();
            let found = null;
            for (const s of subs) {
                if (String(s.name || '').toLocaleUpperCase('it-IT') === norm) { found = s; break; }
            }
            if (found) {
                if (found.name !== norm) {
                    try {
                        found = await store.saveSubject({ id: found.id, name: norm, color: found.color || color || '#8ca4ff' });
                    } catch (e) { /* tieni quella vecchia */ }
                }
                return found;
            }
            return await store.saveSubject({ name: norm, color: color || '#8ca4ff' });
        },

        // ---------- apertura file locale (es. PPT negli appunti) ----------
        async openFilePath(path) {
            if (await hasBackend()) {
                try { return await api('study_open_file', path); } catch (e) { return { success: false, error: String(e) }; }
            }
            return { success: false, error: 'Non disponibile fuori dall’app desktop' };
        },

        // ---------- asset locali ----------
        async pickAsset() {
            if (await hasBackend()) { try { return await api('study_pick_asset'); } catch (e) { return null; } }
            return null;
        },
        assetUrl(path) {
            if (!path) return '';
            if (/^[a-z]+:\/\//i.test(path)) return path;
            let p = String(path).replace(/\\/g, '/');
            if (!p.startsWith('/')) p = '/' + p;
            return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
        }
    };

    return store;
})();
