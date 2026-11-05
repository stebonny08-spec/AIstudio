/* ============================================================
   components/subject.js — componente MATERIA globale.
   - campo di testo (non un elenco fisso)
   - testo forzato in MAIUSCOLO
   - normalizzazione delle materie equivalenti
   - salvataggio automatico delle materie usate
   - tendina con suggerimenti (datalist) delle materie già salvate
   Usato in: Appunti, Schemi, Chatbot, Calendario, Ripasso, Biblioteca.
   ============================================================ */
window.SubjectInput = (function () {
    'use strict';

    let uidCounter = 0;

    function normalize(name) {
        return StudyStore.normalizeSubject(name);
    }

    function remember(name) {
        return StudyStore.rememberSubject(name);
    }

    /**
     * Crea il campo materia.
     * opts: { value, id, placeholder, onChange(normalizedValue), label }
     * Ritorna l'elemento da inserire nel DOM.
     */
    function create(opts) {
        opts = opts || {};
        const uid = 'subj_' + (++uidCounter) + '_' + Math.random().toString(16).slice(2, 6);

        const wrap = App.el('div', 'subject-input');
        if (opts.label) wrap.appendChild(App.el('label', null, App.esc(opts.label)));

        const row = App.el('div', 'subject-row');
        const inp = App.el('input');
        inp.type = 'text';
        inp.className = 'subject-field';
        inp.id = opts.id || uid;
        inp.placeholder = opts.placeholder || 'Inserisci materia…';
        inp.setAttribute('autocomplete', 'off');
        inp.spellcheck = false;
        inp.value = normalize(opts.value || '');
        row.appendChild(inp);

        const dl = App.el('datalist');
        dl.id = uid + '_list';
        inp.setAttribute('list', dl.id);
        row.appendChild(dl);
        wrap.appendChild(row);

        function fillSuggestions(prefix) {
            StudyStore.listSubjects().then(function (subs) {
                const p = String(prefix || '').toLocaleUpperCase('it-IT');
                dl.innerHTML = '';
                (subs || []).forEach(function (s) {
                    const n = normalize(s.name);
                    if (!n) return;
                    if (p && n.indexOf(p) < 0) return;
                    const o = App.el('option');
                    o.value = n;
                    dl.appendChild(o);
                });
            }).catch(function () { /* niente suggerimenti */ });
        }
        fillSuggestions('');

        let lastCommitted = inp.value;
        inp.addEventListener('input', function () {
            // in digitazione si mostra la tendina; il valore viene normalizzato
            // all'uscita dal campo (change/blur) per non disturbare la scrittura
            fillSuggestions(inp.value);
        });
        function commit() {
            const norm = normalize(inp.value);
            inp.value = norm;
            if (norm && norm !== lastCommitted) {
                lastCommitted = norm;
                remember(norm).then(function () { fillSuggestions(''); });
            }
            if (typeof opts.onChange === 'function') opts.onChange(norm);
        }
        inp.addEventListener('change', commit);
        inp.addEventListener('blur', commit);

        wrap.getInput = function () { return inp; };
        wrap.getValue = function () { return normalize(inp.value); };
        wrap.setValue = function (v) { inp.value = normalize(v); };
        return wrap;
    }

    return { create: create, normalize: normalize, remember: remember };
})();
