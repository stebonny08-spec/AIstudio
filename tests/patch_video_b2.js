/* ============================================================
   tests/patch_video_b2.js — BLOCCO 2 (video: corsie multiple e
   sovrapposizioni consentite). Patch verificata: ogni operazione
   deve trovare il suo anchor ESATTAMENTE una volta.

   Eseguire con: node tests/patch_video_b2.js [--dry]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'web_frontend', 'html', 'js', 'modules', 'video.js');
const DRY = process.argv.indexOf('--dry') >= 0;

const exact = [];   // { name, before, after }   — before deve essere unico
const splice = [];  // { name, start, end, after } — replaced = [start, end)

function E(name, before, after) { exact.push({ name, before, after }); }
function S(name, start, end, after) { splice.push({ name, start, end, after }); }

// ---------------------------------------------------------------
// 1) CSS corsie/intestazioni
// ---------------------------------------------------------------
E('css-lhead',
    `        '.vv-lab i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}' +`,
    `        '.vv-lab i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}' +
        /* --- BLOCCO 2: gruppi con più corsie --- */
        '.vv-lhead{height:26px;margin-bottom:6px;display:flex;align-items:center;gap:7px;background:#191f2e;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:11px;font-weight:800;color:#aab3c5;letter-spacing:.4px;box-sizing:border-box;user-select:none}' +
        '.vv-lhead i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:0 0 9px}' +
        '.vv-lhead-sp{height:26px;flex:0 0 26px;margin-bottom:6px}' +
        '.vv-laneadd{margin-left:auto;width:24px;height:20px;padding:0;background:#12151f;border:1px solid var(--border);border-radius:6px;color:#c3cbdb;font:inherit;font-size:13px;font-weight:800;line-height:1;cursor:pointer;transition:border-color .15s,color .15s;flex:0 0 auto}' +
        '.vv-laneadd:hover{border-color:var(--accent);color:var(--accent)}' +
        '.vv-lanedel{margin-left:auto;width:20px;height:18px;padding:0;background:transparent;border:1px solid transparent;border-radius:5px;color:#8b95a5;font:inherit;font-size:12px;font-weight:800;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s,color .15s,border-color .15s;flex:0 0 auto}' +
        '.vv-lab:hover .vv-lanedel{opacity:1}' +
        '.vv-lanedel:hover{color:var(--red);border-color:var(--red)}' +`);

// ---------------------------------------------------------------
// 2) modello: tipo music, corsie
// ---------------------------------------------------------------
E('trackKeyOf-music',
    `    function trackKeyOf(c) {
        if (c.type === 'text') return 'text';
        if (c.type === 'image' || c.type === 'video') return 'media';
        return 'audio';
    }`,
    `    function trackKeyOf(c) {
        if (c.type === 'text') return 'text';
        if (c.type === 'image' || c.type === 'video') return 'media';
        if (c.type === 'music') return 'music';
        return 'audio';
    }`);

E('typeLabel-music',
    `        return t === 'text' ? 'Testo' : t === 'image' ? 'Immagine' : t === 'video' ? 'Video' : 'Audio';`,
    `        return t === 'text' ? 'Testo' : t === 'image' ? 'Immagine' : t === 'video' ? 'Video' : t === 'music' ? 'Musica' : 'Audio';`);

E('newClip-music',
    `        if (type === 'image') return Object.assign(base, { dur: 4 });
        if (type === 'video') return Object.assign(base, { dur: 6 });
        return Object.assign(base, { dur: 5 });   // audio`,
    `        if (type === 'image') return Object.assign(base, { dur: 4 });
        if (type === 'video') return Object.assign(base, { dur: 6 });
        if (type === 'music') return Object.assign(base, { dur: 5, volume: 80 });
        return Object.assign(base, { dur: 5 });   // audio`);

E('parseContent-lanes',
    `    function parseContent(item) {
        let d = null;
        try { d = JSON.parse(item.content || '{}'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = null;
        const clips = (d && Array.isArray(d.clips)) ? d.clips : [];
        clips.forEach(function (c) { if (!c.id) c.id = uid(); });
        const music = (d && d.music && typeof d.music === 'object') ? d.music : { src: '', volume: 70 };
        if (music.volume == null) music.volume = 70;
        return { clips: clips, music: music };
    }`,
    `    function normLanes(l) {
        const out = { text: 1, media: 1, audio: 1, music: 0 };
        ['text', 'media', 'audio', 'music'].forEach(function (g) {
            let n = Math.floor(Number(l && l[g]));
            if (!isFinite(n) || n < out[g]) n = out[g];
            out[g] = n;
        });
        return out;
    }
    function parseContent(item) {
        let d = null;
        try { d = JSON.parse(item.content || '{}'); } catch (e) { d = null; }
        if (!d || typeof d !== 'object') d = null;
        const clips = (d && Array.isArray(d.clips)) ? d.clips : [];
        const lanes = normLanes(d && d.lanes);
        clips.forEach(function (c) { if (!c.id) c.id = uid(); });
        clips.forEach(function (c) {
            let lane = Math.floor(Number(c.lane));
            if (!isFinite(lane) || lane < 0) lane = 0;
            c.lane = lane;
        });
        clips.forEach(function (c) {
            if (trackKeyOf(c) === 'music' && c.lane + 1 > lanes.music) lanes.music = c.lane + 1;
        });
        clips.forEach(function (c) {
            const g = trackKeyOf(c);
            const max = (g === 'music' ? lanes.music : lanes[g]) - 1;
            if (c.lane > max) c.lane = Math.max(0, max);
        });
        const music = (d && d.music && typeof d.music === 'object') ? d.music : { src: '', volume: 70 };
        if (music.volume == null) music.volume = 70;
        return { clips: clips, music: music, lanes: lanes };
    }

    // ---- BLOCCO 2: corsie multiple per gruppo traccia ----
    function laneCount(g) { return (st && st.data && st.data.lanes) ? st.data.lanes[g] : 1; }
    function rowCount(g) { return g === 'music' ? 1 + laneCount('music') : laneCount(g); }
    function rowKeyOf(c) {
        const g = trackKeyOf(c);
        return g + ':' + (g === 'music' ? (c.lane || 0) + 1 : (c.lane || 0));
    }
    function laneTitle(g, rowIdx) {
        let label = g;
        for (let i = 0; i < TRACKS.length; i++) if (TRACKS[i].key === g) label = TRACKS[i].label;
        if (g === 'music') return rowIdx === 0 ? 'Musica \\u266a sottofondo' : 'Musica ' + (rowIdx + 1);
        return rowIdx === 0 ? label : label + ' ' + (rowIdx + 1);
    }
    function overlaps(a1, a2, b1, b2) { return a1 < b2 - 1e-6 && b1 < a2 - 1e-6; }
    function laneClips(g, lane, skipId) {
        if (!st) return [];
        return st.data.clips.filter(function (x) {
            return trackKeyOf(x) === g && (x.lane || 0) === lane && x.id !== skipId;
        });
    }
    function laneFree(g, lane, start, dur, skipId) {
        return !laneClips(g, lane, skipId).some(function (x) {
            return overlaps(start, start + dur, num(x.start), num(x.start) + num(x.dur));
        });
    }
    function pickLane(g, start, dur, skipId) {
        const n = laneCount(g);
        for (let i = 0; i < n; i++) if (laneFree(g, i, start, dur, skipId)) return i;
        return -1;
    }
    function assignLane(c) {
        const g = trackKeyOf(c);
        let lane = pickLane(g, num(c.start), num(c.dur), c.id);
        if (lane < 0) {
            st.data.lanes[g] = laneCount(g) + 1;
            lane = laneCount(g) - 1;
        }
        c.lane = lane;
        return lane;
    }
    function clampFree(g, lane, s, d, skipId) {
        s = Math.max(0, s);
        if (laneFree(g, lane, s, d, skipId)) return s;
        const iv = laneClips(g, lane, skipId)
            .map(function (x) { return [num(x.start), num(x.start) + num(x.dur)]; })
            .sort(function (a, b) { return a[0] - b[0]; });
        let cand = s;
        for (let i = 0; i < iv.length; i++) {
            if (overlaps(cand, cand + d, iv[i][0], iv[i][1])) cand = iv[i][1];
        }
        if (laneFree(g, lane, cand, d, skipId)) return cand;
        cand = s;
        for (let i = iv.length - 1; i >= 0; i--) {
            if (overlaps(cand, cand + d, iv[i][0], iv[i][1])) cand = Math.max(0, iv[i][0] - d);
        }
        if (laneFree(g, lane, cand, d, skipId)) return cand;
        return iv.length ? iv[iv.length - 1][1] : 0;
    }
    function addLane(g) { st.data.lanes[g] = laneCount(g) + 1; }
    function removeLane(g, lane) {
        const min = g === 'music' ? 0 : 1;
        const n = laneCount(g);
        if (n <= min) { setStatus('Impossibile eliminare l\\u2019ultima corsia.'); return; }
        const inLane = laneClips(g, lane, null);
        if (inLane.length) {
            const ids = {};
            inLane.forEach(function (x) { ids[x.id] = 1; });
            if (!confirm('La corsia contiene ' + inLane.length + ' clip: eliminarla?')) return;
            st.data.clips = st.data.clips.filter(function (x) { return !ids[x.id]; });
            if (st.sel && ids[st.sel]) st.sel = null;
        }
        st.data.clips.forEach(function (x) {
            if (trackKeyOf(x) === g && (x.lane || 0) > lane) x.lane = (x.lane || 0) - 1;
        });
        st.data.lanes[g] = n - 1;
        applyAll();
        setStatus('Corsia eliminata.');
    }`);

// ---------------------------------------------------------------
// 3) storico + salvataggio con lanes
// ---------------------------------------------------------------
E('snapHist',
    `    function snapHist() { return JSON.stringify({ clips: st.data.clips, music: st.data.music }); }`,
    `    function snapHist() { return JSON.stringify({ clips: st.data.clips, music: st.data.music, lanes: st.data.lanes }); }`);

E('applyHist',
    `    function applyHist(s) {
        let d = null;
        try { d = JSON.parse(s); } catch (e) { return; }
        st.data = { clips: (d && Array.isArray(d.clips)) ? d.clips : [], music: (d && d.music) ? d.music : { src: '', volume: 70 } };
        st.data.clips.forEach(function (c) { if (!c.id) c.id = uid(); });
        if (st.sel && st.sel !== '@music' && !clipById(st.sel)) st.sel = null;
        if (st.playhead > totalDur()) st.playhead = totalDur();
        applyAll();
    }`,
    `    function applyHist(s) {
        let d = null;
        try { d = JSON.parse(s); } catch (e) { return; }
        st.data = {
            clips: (d && Array.isArray(d.clips)) ? d.clips : [],
            music: (d && d.music) ? d.music : { src: '', volume: 70 },
            lanes: normLanes(d && d.lanes)
        };
        st.data.clips.forEach(function (c) { if (!c.id) c.id = uid(); });
        st.data.clips.forEach(function (c) {
            if (trackKeyOf(c) === 'music') {
                let lane = Math.floor(Number(c.lane));
                if (!isFinite(lane) || lane < 0) lane = 0;
                if (lane + 1 > st.data.lanes.music) st.data.lanes.music = lane + 1;
            }
        });
        st.data.clips.forEach(function (c) {
            const g = trackKeyOf(c);
            const max = (g === 'music' ? st.data.lanes.music : st.data.lanes[g]) - 1;
            let lane = Math.floor(Number(c.lane));
            if (!isFinite(lane) || lane < 0) lane = 0;
            c.lane = Math.min(lane, Math.max(0, max));
        });
        if (st.sel && st.sel !== '@music' && !clipById(st.sel)) st.sel = null;
        if (st.playhead > totalDur()) st.playhead = totalDur();
        applyAll();
    }`);

E('flush-lanes',
    `                content: JSON.stringify({ clips: st.data.clips, music: st.data.music })`,
    `                content: JSON.stringify({ clips: st.data.clips, music: st.data.music, lanes: st.data.lanes })`);

E('createNew-lanes',
    `                content: JSON.stringify({ clips: [], music: { src: '', volume: 70 } })`,
    `                content: JSON.stringify({ clips: [], music: { src: '', volume: 70 }, lanes: { text: 1, media: 1, audio: 1, music: 0 } })`);

// ---------------------------------------------------------------
// 4) colonna etichette: rigenerata da renderTimeline
// ---------------------------------------------------------------
E('labels-ref',
    `        const tlBody = App.el('div', 'vv-tlbody');
        const labels = App.el('div', 'vv-tlabels');
        labels.appendChild(App.el('div', 'vv-lab-sp'));
        TRACKS.forEach(function (t) {
            const l = App.el('div', 'vv-lab');
            const dot = App.el('i');
            dot.style.background = t.color;
            l.appendChild(dot);
            l.appendChild(document.createTextNode(t.label));
            labels.appendChild(l);
        });
        tlBody.appendChild(labels);`,
    `        const tlBody = App.el('div', 'vv-tlbody');
        const labels = App.el('div', 'vv-tlabels');
        labels.appendChild(App.el('div', 'vv-lab-sp'));
        tlBody.appendChild(labels);
        st.labelsEl = labels;   // etichette rigenerate da renderTimeline (corsie multiple)`);

// ---------------------------------------------------------------
// 5) renderTimeline: righe per gruppo/corsia, "+" corsia, "×" elimina
// ---------------------------------------------------------------
S('renderTimeline-lanes',
    `        // righe traccia`,
    `        // linea guida (snap durante il trascinamento)`,
    `        // righe traccia per GRUPPO e per CORSIA (BLOCCO 2)
        // - corsie diverse dello stesso gruppo possono sovrapporsi nel tempo
        // - nella stessa corsia le clip non si sovrapposono (vincolo + snap)
        const tracks = App.el('div', 'vv-ttracks');
        const rows = {}; // "gruppo:riga" -> elemento riga
        st.laneRows = {};
        if (st.labelsEl) {
            st.labelsEl.innerHTML = '';
            st.labelsEl.appendChild(App.el('div', 'vv-lab-sp'));
        }
        TRACKS.forEach(function (t) {
            const g = t.key;
            // intestazione gruppo con pulsante "+" (aggiunge una corsia dello stesso tipo)
            const lh = App.el('div', 'vv-lhead');
            const hdot = App.el('i');
            hdot.style.background = t.color;
            lh.appendChild(hdot);
            lh.appendChild(App.el('span', null, t.label));
            const plus = App.el('button', 'vv-laneadd', '+');
            plus.type = 'button';
            plus.title = 'Aggiungi una corsia a "' + t.label + '" (es. "' + t.label + ' 2")';
            plus.addEventListener('click', function (e) {
                e.stopPropagation();
                addLane(g);
                if (g === 'music') {
                    // la nuova corsia musica pu\\u00f2 subito ospitare una traccia locale
                    pickMedia('audio').then(function (src) {
                        if (!st) return;
                        if (src) {
                            const c = newClip('music', r05(st.playhead));
                            c.src = src;
                            c.lane = laneCount('music') - 1;
                            st.data.clips.push(c);
                            st.sel = c.id;
                            setStatus('Corsia "Musica 2" aggiunta con una traccia.');
                        } else {
                            setStatus('Corsia musica aggiunta (vuota).');
                        }
                        applyAll();
                    });
                    return;
                }
                setStatus('Corsia "' + t.label + ' ' + laneCount(g) + '" aggiunta.');
                applyAll();
            });
            lh.appendChild(plus);
            tracks.appendChild(lh);

            if (st.labelsEl) st.labelsEl.appendChild(App.el('div', 'vv-lhead-sp'));

            const nRows = rowCount(g);
            st.laneRows[g] = [];
            for (let li = 0; li < nRows; li++) {
                const row = App.el('div', 'vv-track');
                row.setAttribute('data-track', g);
                row.setAttribute('data-lane', String(li));
                row.title = laneTitle(g, li);
                row.addEventListener('pointerdown', function (e) {
                    if (e.target === row && st.sel !== null) {
                        st.sel = null;
                        syncSelClasses();
                        renderProps();
                    }
                });
                tracks.appendChild(row);
                rows[g + ':' + li] = row;
                const clipLane = g === 'music' ? li - 1 : li;
                if (g !== 'music' || li > 0) st.laneRows[g].push({ lane: clipLane, row: row });

                // etichetta corsia (nome + elimina)
                if (st.labelsEl) {
                    const l = App.el('div', 'vv-lab');
                    const ld = App.el('i');
                    ld.style.background = t.color;
                    l.appendChild(ld);
                    l.appendChild(document.createTextNode(laneTitle(g, li)));
                    if (!(g === 'music' && li === 0)) {
                        const del = App.el('button', 'vv-lanedel', '\\u00d7');
                        del.type = 'button';
                        del.title = 'Elimina questa corsia';
                        del.addEventListener('click', function (e) {
                            e.stopPropagation();
                            removeLane(g, clipLane);
                        });
                        l.appendChild(del);
                    }
                    st.labelsEl.appendChild(l);
                }
            }
        });
        st.rowEls = rows;
        inner.appendChild(tracks);

        // clip nella riga della loro corsia
        st.data.clips.forEach(function (c) {
            const row = rows[rowKeyOf(c)];
            if (!row) return;
            row.appendChild(clipBlock(c));
        });

        // riga "Musica" (sottofondo globale) = st.data.music
        if (st.data.music.src) {
            const b = App.el('div', 'vv-tclip' + (st.sel === '@music' ? ' active' : ''));
            b.setAttribute('data-cid', '@music');
            b.style.left = '0px';
            b.style.width = Math.max(16, total * pps) + 'px';
            b.style.background = '#c9b8e8';
            b.style.cursor = 'pointer';
            b.innerHTML =
                '<div class="tc-in"></div>' +
                '<div class="tc-t">Musica: ' + App.esc(fileName(st.data.music.src)) + '</div>' +
                '<div class="tc-m">sottofondo \\u266a volume ' + (st.data.music.volume == null ? 70 : num(st.data.music.volume)) + '%</div>';
            b.title = 'Traccia musicale di sottofondo \\u2014 clic per le propriet\\u00e0';
            b.addEventListener('pointerdown', function (e) {
                if (e.button) return;
                e.stopPropagation();
                st.sel = '@music';
                syncSelClasses();
                renderProps();
            });
            if (rows['music:0']) rows['music:0'].appendChild(b);
        }

        // icona sui giunti con transizione
        st.data.clips.forEach(function (c) {
            let pred = null;
            for (let i = 0; i < st.data.clips.length; i++) {
                const x = st.data.clips[i];
                if (x.id !== c.id && Math.abs((num(x.start) + num(x.dur)) - num(c.start)) <= 0.05) { pred = x; break; }
            }
            if (!pred) return;
            if (effTrans(pred, c) === 'none') return;
            const row = rows[rowKeyOf(c)];
            if (!row) return;
            const ic = App.el('div', 'vv-jn', '\\u25c6');
            ic.style.left = (num(c.start) * pps) + 'px';
            ic.title = 'Transizione al giunto: ' + (trIn(c) !== 'none' ? trIn(c) : trOut(pred));
            row.appendChild(ic);
        });

`);

// ---------------------------------------------------------------
// 6) drag: snap solo stessa corsia, trascina tra corsie, no sovrapposizioni
// ---------------------------------------------------------------
S('startClipDrag-lanes',
    `        // target di snap: playhead, 0 e bordi delle altre clip`,
    `        function done() {`,
    `        // target di snap: playhead, 0 e bordi delle altre clip della STESSA corsia
        const g0 = trackKeyOf(c);
        const targets = [st.playhead, 0];
        st.data.clips.forEach(function (x) {
            if (x.id !== c.id && trackKeyOf(x) === g0 && (x.lane || 0) === (c.lane || 0)) {
                targets.push(num(x.start));
                targets.push(num(x.start) + num(x.dur));
            }
        });
        const thr = Math.max(6 / pps, 0.06);   // 6px oppure 0.1s

        function trySnap(v) {
            let best = v, bd = thr, hit = false;
            for (let i = 0; i < targets.length; i++) {
                const d = Math.abs(targets[i] - v);
                if (d < bd) { bd = d; best = targets[i]; hit = true; }
            }
            return { v: best, hit: hit, err: hit ? bd : Infinity };
        }
        function showGuide(t) {
            if (!st.guideEl) return;
            if (t == null) { st.guideEl.style.display = 'none'; return; }
            st.guideEl.style.display = 'block';
            st.guideEl.style.left = (t * pps) + 'px';
        }
        // corsia sotto il puntatore (solo stesso gruppo: tra gruppi diversi niente droppable)
        function detectLane(ev) {
            const list = st.laneRows && st.laneRows[g0];
            if (!list) return c.lane || 0;
            for (let i = 0; i < list.length; i++) {
                const r = list[i].row.getBoundingClientRect();
                if (r && r.height > 0 && ev.clientY >= r.top && ev.clientY < r.bottom) return list[i].lane;
            }
            return c.lane || 0;
        }
        function apply(ev) {
            const dx = (ev.clientX - x0) / pps;
            let s = origStart, d = origDur, guide = null;
            if (mode === 'move') {
                s = Math.max(0, r05(origStart + dx));
                const sa = trySnap(s);
                const endRaw = s + origDur;
                const sb = trySnap(r05(endRaw));
                if (sa.hit && (!sb.hit || sa.err <= sb.err)) { s = Math.max(0, sa.v); guide = s; }
                else if (sb.hit) {
                    const s2 = r05(sb.v - origDur);
                    if (s2 >= 0) { s = s2; guide = sb.v; }
                }
                d = origDur;
                // 2.5: trascinamento su un'altra corsia dello stesso gruppo
                const tl = detectLane(ev);
                if (tl !== (c.lane || 0)) {
                    if (laneFree(g0, tl, s, d, c.id)) {
                        c.lane = tl;
                        const target = st.rowEls && st.rowEls[rowKeyOf(c)];
                        if (target && node.parentNode !== target) target.appendChild(node);
                    }
                }
                // 2.3: nella STESSA corsia niente sovrapposizioni
                if (!laneFree(g0, c.lane || 0, s, d, c.id)) s = clampFree(g0, c.lane || 0, s, d, c.id);
            } else if (mode === 'l') {
                s = clamp(r05(origStart + dx), 0, Math.max(0, origEnd - 0.5));
                const sa = trySnap(s);
                if (sa.hit) s = clamp(sa.v, 0, Math.max(0, origEnd - 0.5));
                guide = sa.hit ? s : null;
                d = origEnd - s;
                if (!laneFree(g0, c.lane || 0, s, d, c.id)) {
                    s = clampFree(g0, c.lane || 0, s, d, c.id);
                    d = origEnd - s;
                }
            } else { // 'r' = trim fine
                let end = Math.max(origStart + 0.5, r05(origEnd + dx));
                const se = trySnap(end);
                if (se.hit) end = Math.max(origStart + 0.5, se.v);
                guide = se.hit ? end : null;
                s = origStart;
                d = end - origStart;
                if (!laneFree(g0, c.lane || 0, s, d, c.id)) {
                    s = clampFree(g0, c.lane || 0, s, d, c.id);
                    d = Math.max(0.5, origEnd - s);
                    if (!laneFree(g0, c.lane || 0, s, d, c.id)) { s = origStart; d = origDur; }
                }
            }
            c.start = r2(Math.max(0, s));
            c.dur = r2(Math.max(0.5, d));
            node.style.left = (c.start * pps) + 'px';
            node.style.width = Math.max(16, c.dur * pps) + 'px';
            showGuide(guide);
        }
`);

// ---------------------------------------------------------------
// 7) inserimento clip su corsia libera
// ---------------------------------------------------------------
E('addClip-lane',
    `        const c = newClip(type, appendStart());
        if (type !== 'text') c.src = src;
        st.data.clips.push(c);`,
    `        const c = newClip(type, appendStart());
        if (type !== 'text') c.src = src;
        assignLane(c);
        st.data.clips.push(c);`);

E('insertFromLib-lane',
    `        const c = newClip(type, r05(Math.max(0, t)));
        c.src = src;
        st.data.clips.push(c);`,
    `        const c = newClip(type, r05(Math.max(0, t)));
        c.src = src;
        assignLane(c);
        st.data.clips.push(c);`);

E('dupClip-lane',
    `        const copy = JSON.parse(JSON.stringify(c));
        copy.id = uid();
        copy.start = r2(r05(num(c.start) + num(c.dur) + 0.1));
        st.data.clips.splice(idx + 1, 0, copy);`,
    `        const copy = JSON.parse(JSON.stringify(c));
        copy.id = uid();
        copy.start = r2(r05(num(c.start) + num(c.dur) + 0.1));
        if (!laneFree(trackKeyOf(copy), copy.lane || 0, copy.start, copy.dur, copy.id)) assignLane(copy);
        st.data.clips.splice(idx + 1, 0, copy);`);

// ---------------------------------------------------------------
// 8) proprietà: corsia + no sovrapposizione da input + posizione video
// ---------------------------------------------------------------
E('props-corsia',
    `        rowD.appendChild(di);
        p.appendChild(rowD);`,
    `        rowD.appendChild(di);
        p.appendChild(rowD);

        // Corsia della clip (BLOCCO 2)
        const rowL = prow(trackKeyOf(c) === 'music' ? 'Corsia musica' : 'Corsia');
        const selLane = App.el('select');
        for (let li2 = 0; li2 < laneCount(trackKeyOf(c)); li2++) {
            const oL = App.el('option');
            oL.value = String(li2);
            oL.textContent = 'Corsia ' + (li2 + 1) + (li2 === 0 ? ' \\u00b7 base' : '');
            selLane.appendChild(oL);
        }
        selLane.value = String(c.lane || 0);
        selLane.addEventListener('change', function () {
            const g = trackKeyOf(c);
            const nl = parseInt(selLane.value, 10) || 0;
            if (nl === (c.lane || 0)) return;
            if (!laneFree(g, nl, num(c.start), num(c.dur), c.id)) {
                setStatus('La corsia ' + (nl + 1) + ' \\u00e8 gi\\u00e0 occupata in quello intervallo.');
                selLane.value = String(c.lane || 0);
                return;
            }
            c.lane = nl;
            applyProps();
        });
        rowL.appendChild(selLane);
        p.appendChild(rowL);`);

E('props-inizio-nosovrap',
    `        si.addEventListener('change', function () {
            c.start = r2(Math.max(0, r05(num(si.value))));
            si.value = c.start;
            applyProps();
        });`,
    `        si.addEventListener('change', function () {
            const nv = r2(Math.max(0, r05(num(si.value))));
            if (!laneFree(trackKeyOf(c), c.lane || 0, nv, num(c.dur), c.id)) {
                setStatus('Nella stessa corsia le clip non possono sovrapporsi.');
                si.value = c.start;
                return;
            }
            c.start = nv;
            si.value = c.start;
            applyProps();
        });`);

E('props-durata-nosovrap',
    `        di.addEventListener('change', function () {
            c.dur = r2(Math.max(0.5, r05(num(di.value))));
            di.value = c.dur;
            applyProps();
        });`,
    `        di.addEventListener('change', function () {
            const nv = r2(Math.max(0.5, r05(num(di.value))));
            if (!laneFree(trackKeyOf(c), c.lane || 0, num(c.start), nv, c.id)) {
                setStatus('Nella stessa corsia le clip non possono sovrapporsi.');
                di.value = c.dur;
                return;
            }
            c.dur = nv;
            di.value = c.dur;
            applyProps();
        });`);

E('props-volume-music',
    `        if (c.type === 'audio' || c.type === 'video') {`,
    `        if (c.type === 'audio' || c.type === 'video' || c.type === 'music') {`);

E('props-pos-video',
    `        // Posizione X/Y (image/testo)
        if (c.type === 'image' || c.type === 'text') {`,
    `        // Posizione X/Y (image/testo/video) — 2.4 composizione in preview
        if (c.type === 'image' || c.type === 'text' || c.type === 'video') {`);

// ---------------------------------------------------------------
// 9) preview: clip music + ordine di sovrapposizione (corsia alta = sopra)
// ---------------------------------------------------------------
E('clipNode-music',
    `        } else if (c.type === 'audio') {
            const a = document.createElement('audio');`,
    `        } else if (c.type === 'audio' || c.type === 'music') {
            const a = document.createElement('audio');`);

E('zIndexOf',
    `    function activeAt(t) {`,
    `    // ordine di sovrapposizione in preview: corsia piu' alta = sopra, testo in cima
    function zIndexOf(c) {
        const g = trackKeyOf(c);
        const lane = c.lane || 0;
        if (g === 'text') return 600 + lane;
        if (g === 'media') return 100 + lane;
        return 50;   // audio/music (non visivi)
    }

    function activeAt(t) {`);

E('sync-pending-z',
    `                p.node.classList.remove('vv-jout-fade', 'vv-jout-slide');
                p.node.style.zIndex = '';`,
    `                p.node.classList.remove('vv-jout-fade', 'vv-jout-slide');
                p.node.style.zIndex = String(zIndexOf(active[id]));`);

E('sync-exit-z',
    `                node.classList.add(eff === 'fade' ? 'vv-jout-fade' : 'vv-jout-slide');
                node.style.zIndex = '2';`,
    `                node.classList.add(eff === 'fade' ? 'vv-jout-fade' : 'vv-jout-slide');
                node.style.zIndex = String(zIndexOf(c) + 400);`);

E('sync-enter-z',
    `            const node = clipNode(c, anim);
            if (anim) node.style.zIndex = '3';
            st.stageEl.appendChild(node);`,
    `            const node = clipNode(c, anim);
            node.style.zIndex = String(zIndexOf(c) + (anim ? 800 : 0));
            st.stageEl.appendChild(node);`);

// ---------------------------------------------------------------
// 10) export: clip music come audio + ordine per corsia
// ---------------------------------------------------------------
E('export-music-audio',
    `            if ((c.type !== 'video' && c.type !== 'audio') || !c.src) return;`,
    `            if ((c.type !== 'video' && c.type !== 'audio' && c.type !== 'music') || !c.src) return;`);

S('drawFrame-order',
    `        // attive in ordine di traccia: Testo`,
    `    }

    function startExport(ui) {`,
    `        // attive in ordine di sovrapposizione: corsie piu' alte sopra, testo in cima (BLOCCO 2)
        visuals.slice().sort(function (a, b) { return zIndexOf(a) - zIndexOf(b); }).forEach(function (c) {
                const s = num(c.start), d = Math.max(0.5, num(c.dur));
                if (t < s || t >= s + d) return;
                let a = 1, off = 0;
                const inw = t - s;
                if (inw < 0.2) {
                    const pred = predOf(c);
                    if (pred) {
                        const eff = effTrans(pred, c);
                        if (eff === 'fade' || eff === 'slide') {
                            const p = inw / 0.2;
                            a = p;
                            if (eff === 'slide') off = (1 - p) * W * 0.25;
                        }
                    }
                }
                drawClip(ctx, W, H, c, a, off, media, imgs);
        });
    }

    function startExport(ui) {`);

// ---------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------
let src = fs.readFileSync(FILE, 'utf8');
let okCount = 0;

for (const op of splice) {
    const s = src.indexOf(op.start);
    if (s < 0) { console.error('SPLICE non trovato: ' + op.name); process.exit(1); }
    if (src.indexOf(op.start, s + 1) >= 0) { console.error('SPLICE ambiguo: ' + op.name); process.exit(1); }
    const e = src.indexOf(op.end, s + op.start.length);
    if (e < 0) { console.error('SPLICE end non trovato: ' + op.name); process.exit(1); }
    src = src.slice(0, s) + op.after + src.slice(e);
    okCount++;
}
for (const op of exact) {
    const i = src.indexOf(op.before);
    if (i < 0) { console.error('EXACT non trovato: ' + op.name); process.exit(1); }
    if (src.indexOf(op.before, i + op.before.length) >= 0) { console.error('EXACT ambiguo: ' + op.name); process.exit(1); }
    src = src.slice(0, i) + op.after + src.slice(i + op.before.length);
    okCount++;
}

const total = exact.length + splice.length;
if (DRY) {
    console.log('DRY: ' + okCount + '/' + total + ' patch trovate e uniche. Nessuna scrittura.');
} else {
    fs.writeFileSync(FILE, src, 'utf8');
    console.log('OK: ' + okCount + '/' + total + ' patch applicati a video.js');
}
