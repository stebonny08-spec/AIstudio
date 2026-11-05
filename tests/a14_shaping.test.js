'use strict';
/* tests/a14_shaping.test.js - R14 BLOCCO A: ink shaping (A1 forme, A2
   frecce, A3 hold-still, A4 settings, A5 undo a due livelli) - A6 QA-A:
   stroke sintetici con jitter programmato -> tipo riconosciuto + errore
   geometrico entro tolleranza; toggle OFF = nessun snap.
   R19 (A2): pulizia delle ASSENZE in toolbar (nessun [data-shaping], API
   setShaping stabile), C aperta non snap-pa, scarabocchio/coloring non
   snap-pa, frecce su tratto CURVO (undo a 2 livelli), residuo di
   smussamento <= 2.5px dichiarato su curva lunga tremolante.
   Esecuzione: node tests/a14_shaping.test.js */
const env0 = require('./_ink_env');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + (extra ? ' - ' + extra : '')); console.log('  FAIL  ' + name + (extra ? ' - ' + extra : '')); }
}
const sleep = env0.sleep;

/* LCG deterministico per jitter riproducibile */
function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function freshDoc(env) {
    env.store.items[0].content = '';
    return env0.openNote(env, 'n1');
}
function shapes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'shape');
}
function strokes(env) {
    return env.win.__ink.objects().filter(o => o.t === 'stroke');
}
/* errore perpendicolare massimo dei punti (gia' in MONDO: i test
   costruiscono le forme in mondo e le spediscono con wc()) rispetto
   alla linea (a,b) */
function maxPerpWorld(env, pts, a, b) {
    let m = 0;
    for (const q of pts) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        const d = Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L;
        if (d > m) m = d;
    }
    return m;
}

(async () => {
    try {
        const env = env0.makeEnv();
        await env0.openNote(env, 'n1');
        const ink = env.win.__ink;
        ok(!!ink, '0.0 API __ink presente');
        // default A4: forme ON, frecce ON, hold 350ms
        const st0 = ink.state();
        ok(st0.shpOn === true && st0.arrowOn === true && st0.holdMs === 350,
            '0.1 default shaping (forme/frecce ON, 350ms)', JSON.stringify(st0));

        const TOL = 2.5 + 0.6 * 3;   // amp default 0.6 (helpAssist)
        ink.setHelp(0.6);            // toggle ON + intensita' default

        // ================= A1: LINE (rette con jitter) =====================
        await freshDoc(env);
        const rnd = lcg(42);
        const lineC = [];
        for (let i = 0; i <= 50; i++) {
            lineC.push([100 + i * 3 + (rnd() - 0.5) * 1.6,
                        150 + i * 0.6 + (rnd() - 0.5) * 1.6]);
        }
        await env0.stroke(env, env0.wc(env, lineC));
        let sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line', '1.0 linea riconosciuta',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0]) {
            const err = maxPerpWorld(env, lineC, sh[0].pts[0], sh[0].pts[1]);
            ok(err <= TOL, '1.1 errore geometrico linea <= tolleranza',
                'perp=' + err.toFixed(2) + ' tol=' + TOL.toFixed(2));
        }

        // ================= A1: CIRCLE (cerchio tremolante) =================
        await freshDoc(env);
        const rnd2 = lcg(7);
        const circC = [];
        const cx = 300, cy = 300, R = 45;
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            const rr = R + (rnd2() - 0.5) * 2;      // jitter +-1px
            circC.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
        }
        await env0.stroke(env, env0.wc(env, circC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'circle', '2.0 cerchio riconosciuto',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0] && sh[0].params) {
            // i punti del cerchio sono gia' definiti in MONDO
            const wc = { x: cx, y: cy };
            const Rw = R;   // raggio atteso in mondo
            const rErr = Math.abs(sh[0].params.r - Rw);
            const cErr = Math.hypot(sh[0].params.cx - wc.x, sh[0].params.cy - wc.y);
            ok(rErr <= TOL, '2.1 raggio cerchio entro tolleranza',
                'rErr=' + rErr.toFixed(2) + ' (atteso ' + Rw.toFixed(2) + ')');
            ok(cErr <= TOL, '2.2 centro cerchio entro tolleranza', 'cErr=' + cErr.toFixed(2));
        }

        // ================= A1: ELLISSE =====================================
        await freshDoc(env);
        const rnd3 = lcg(99);
        const ellC = [];
        for (let i = 0; i < 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            ellC.push([430 + Math.cos(a) * (70 + (rnd3() - 0.5) * 2),
                       320 + Math.sin(a) * (30 + (rnd3() - 0.5) * 2)]);
        }
        await env0.stroke(env, env0.wc(env, ellC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'ellipse', '3.0 ellisse riconosciuta',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0] && sh[0].params) {
            const aspectShape = sh[0].params.a / sh[0].params.b;
            ok(Math.abs(aspectShape - 70 / 30) <= 0.6,
                '3.1 aspect-ratio ellisse corretto (70/30)',
                'aspect=' + aspectShape.toFixed(2));
        }

        // ================= A1: RECTANGLE / SQUARE ==========================
        await freshDoc(env);
        const rnd4 = lcg(5);
        const rectC = [];
        const rx = 120, ry = 380, rw = 150, rh = 90;   // aspect 1.67 -> rectangle
        for (let i = 0; i < rw; i += 4) rectC.push([rx + i + (rnd4() - 0.5) * 2, ry + (rnd4() - 0.5) * 2]);
        for (let i = 0; i < rh; i += 4) rectC.push([rx + rw + (rnd4() - 0.5) * 2, ry + i + (rnd4() - 0.5) * 2]);
        for (let i = rw; i >= 0; i -= 4) rectC.push([rx + i + (rnd4() - 0.5) * 2, ry + rh + (rnd4() - 0.5) * 2]);
        for (let i = rh; i >= 4; i -= 4) rectC.push([rx + (rnd4() - 0.5) * 2, ry + i + (rnd4() - 0.5) * 2]);
        await env0.stroke(env, env0.wc(env, rectC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'rectangle', '4.0 rettangolo riconosciuto',
            JSON.stringify(sh.map(s => s.kind)));
        if (sh[0]) {
            const aspect = sh[0].box.w / sh[0].box.h;
            ok(Math.abs(aspect - rw / rh) <= 0.35,
                '4.1 aspect rettangolo (non scambiato con quadrato)',
                'aspect=' + aspect.toFixed(2));
        }

        await freshDoc(env);
        const rnd5 = lcg(11);
        const sqC = [];
        const sx = 420, sy = 400, ss = 96;             // quasi quadrato
        for (let i = 0; i <= ss; i += 4) sqC.push([sx + i + (rnd5() - 0.5) * 2, sy + (rnd5() - 0.5) * 2]);
        for (let i = 4; i <= ss; i += 4) sqC.push([sx + ss + (rnd5() - 0.5) * 2, sy + i + (rnd5() - 0.5) * 2]);
        for (let i = ss; i >= 0; i -= 4) sqC.push([sx + i + (rnd5() - 0.5) * 2, sy + ss + (rnd5() - 0.5) * 2]);
        for (let i = ss; i >= 4; i -= 4) sqC.push([sx + (rnd5() - 0.5) * 2, sy + i + (rnd5() - 0.5) * 2]);
        await env0.stroke(env, env0.wc(env, sqC));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'square', '5.0 quadrato riconosciuto',
            JSON.stringify(sh.map(s => s.kind)));

        // ================= A5: undo a due livelli ==========================
        undo1: {
            env0.undoKey(env, 1);
            const after1 = env.win.__ink.objects();
            ok(after1.length === 1 && after1[0].t === 'stroke',
                '6.1 primo undo -> tratto GREZZO ripristinato',
                JSON.stringify(after1.map(o => o.t)));
            env0.undoKey(env, 1);
            const after2 = env.win.__ink.objects();
            ok(after2.length === 0, '6.2 secondo undo -> tratto RIMOSSO',
                'len=' + after2.length);
        }
        // tooltip dichiarato
        const btnUndo = env.doc.querySelector('[title*="grezzo"]');
        ok(!!btnUndo, '6.3 tooltip undo dichiara i due livelli');

        // ================= A2: flick a V -> arrow su linea =================
        await freshDoc(env);
        // R20 lotto F (FRECCIA COMPOSTA): il vecchio "flag arrow su shape
        // esistente" e' sostituito dalla CONVERTITO in UN oggetto 'arrow'
        // (asta = geometria del target, punta ricostruita e saldata con
        // params.head) - motivazione in qa/r20_f_report.md
        // linea retta (si snap come shape)
        const ln = [];
        for (let i = 0; i <= 30; i++) ln.push([120 + i * 3, 180]);
        await env0.stroke(env, env0.wc(env, ln));
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'line', '7.0 linea di riferimento snap');
        // flick V agganciato alla fine della linea
        const flick = [[210, 180], [222, 183], [232, 180],
                       [226, 187], [214, 184], [206, 189]];
        await env0.stroke(env, env0.wc(env, flick), { dt: 4 });
        sh = shapes(env);
        ok(sh.length === 1 && sh[0].kind === 'arrow' &&
           sh[0].params && sh[0].params.shaft && sh[0].params.shaft.kind === 'line' &&
           sh[0].params.head,
            '7.1 flick a V -> UN oggetto arrow (asta line + params.head)',
            JSON.stringify(sh.map(s => ({ k: s.kind,
                sk: s.params && s.params.shaft && s.params.shaft.kind }))));
        if (sh.length === 1 && sh[0].kind === 'arrow') {
            const h7 = sh[0].params.head;
            const db7 = Math.hypot(h7.base[0] - 210, h7.base[1] - 180);
            ok(db7 <= 2, '7.1b punta saldata sulla fine della linea (base <=2px)',
                'd=' + db7.toFixed(3));
            ok(h7.angoloAlaDeg >= 30 && h7.angoloAlaDeg <= 45 &&
               h7.lunghezza >= 3 * sh[0].size && h7.lunghezza <= 4 * sh[0].size,
                '7.1c ali 30-45 gradi, lunghezza 3-4x spessore',
                'ala=' + h7.angoloAlaDeg + ' L=' + h7.lunghezza +
                ' size=' + sh[0].size);
        }
        ok(env.win.__ink.objects().length === 1,
            '7.2 stroke del flick NON aggiunto come oggetto separato',
            'objs=' + env.win.__ink.objects().length);
        // undo dell'arrow torna alla linea pre-flick (stato pulito)
        env0.undoKey(env, 1);
        const afterAttachUndo = shapes(env);
        ok(afterAttachUndo.length === 1 && afterAttachUndo[0].kind === 'line',
            '7.3 undo -> torna la linea senza frecce (attach rimosso)',
            JSON.stringify(afterAttachUndo.map(s => s.kind)));

        // ================= A4: toggle OFF = nessun snap ====================
        await freshDoc(env);
        ink.setShaping(false, true, 350);
        ok(ink.state().shpOn === false, '8.0 toggle forme OFF');
        const rnd6 = lcg(3);
        const lineOff = [];
        for (let i = 0; i <= 50; i++) lineOff.push([100 + i * 3 + (rnd6() - 0.5) * 1.4, 500]);
        await env0.stroke(env, env0.wc(env, lineOff));
        ok(shapes(env).length === 0 && strokes(env).length === 1,
            '8.1 toggle OFF: nessun snap, resta stroke',
            'shapes=' + shapes(env).length + ' strokes=' + strokes(env).length);
        ink.setShaping(true, true, 350);

        // ================= A1+A3: hold-still -> snap in pausa ==============
        await freshDoc(env);
        const holdC = [];
        for (let i = 0; i < 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            holdC.push([300 + Math.cos(a) * 40, 300 + Math.sin(a) * 40]);
        }
        // disegna SENZA pointerup e con fermo >= holdMs (350)
        await env0.stroke(env, env0.wc(env, holdC), { dt: 1, hold: 480, noUp: true, settle: 120 });
        const objsHold = env.win.__ink.objects();
        // R20 U8: durante il fermo la forma NON e' piu' commessa subito:
        // resta GHOST (overlay candidato) e si conferma al rilascio
        ok(env.win.__ink.state().ghost === true && objsHold.length === 0,
            '9.0 hold-still >=350ms -> GHOST candidato, nessun commit (R20 U8)',
            'ghost=' + env.win.__ink.state().ghost +
            ' objs=' + JSON.stringify(objsHold.map(o => o.t + ':' + (o.kind || ''))));
        // pointerup: conferma del ghost -> 1 oggetto, nessuna duplicazione
        const cv = env0.canvasOf(env);
        const upC = env0.wc(env, [[300, 260]])[0];
        env0.ptr(env, cv, 'pointerup', upC[0], upC[1]);
        await sleep(90);
        const objsUp = env.win.__ink.objects();
        ok(objsUp.length === 1 && objsUp[0].t === 'shape'
            && objsUp[0].kind === 'circle' && env.win.__ink.state().ghost === false,
            '9.1 pointerup conferma il ghost: 1 circle, nessun duplicato',
            JSON.stringify(objsUp.map(o => o.t + ':' + (o.kind || ''))));

        // ================= A4: persistenza =================================
        ink.setShaping(true, false, 500);
        let saved = {};
        try { saved = JSON.parse(env.win.localStorage.getItem('nt14_shaping') || '{}'); } catch (e) { saved = {}; }
        ok(saved.holdMs === 500 && saved.arrowOn === false,
            '10.0 settings persistiti in localStorage', JSON.stringify(saved));
        await freshDoc(env);   // riapri -> buildChrome rilegge
        ok(ink.state().holdMs === 500 && ink.state().arrowOn === false,
            '10.1 settings sopravvivono alla riapertura editor',
            JSON.stringify(ink.state()));
        ink.setShaping(true, true, 350);
        await freshDoc(env);   // ricostruisce la toolbar senza toggle shaping

        // ============ A1 R19: NESSUN controllo shaping in toolbar =========
        const bShp = env.doc.querySelector('[data-shaping="forme"]');
        const bArr = env.doc.querySelector('[data-shaping="frecce"]');
        ok(!bShp, '11.0 pulsante [data-shaping="forme"] ASSENTE in toolbar (A1)');
        ok(!bArr, '11.1 pulsante [data-shaping="frecce"] ASSENTE in toolbar (A1)');
        // l'API setShaping resta STABILE per test/suonatore (MANTENERE)
        const stBack = ink.setShaping(true, true, 350);
        ok(stBack && stBack.shpOn === true && stBack.arrowOn === true,
            '11.2 setShaping(funzione) ancora stabile dopo rimozione pulsanti',
            JSON.stringify(stBack));
        ink.setShaping(false, false, 350);
        ok(ink.state().shpOn === false && ink.state().arrowOn === false,
            '11.3 setShaping(false,false) spegne comunque forme/frecce');
        // e lo snap funziona SENZA toggle UI (forme ON di default)
        ink.setShaping(true, true, 350);
        await freshDoc(env);
        ink.setHelp(0.6);
        const line2 = [];
        for (let i = 0; i <= 40; i++) line2.push([200 + i * 3, 250 + i * 0.4]);
        await env0.stroke(env, env0.wc(env, line2));
        ok(shapes(env).filter(s => s.kind === 'line').length === 1,
            '11.4 snap attivo di default senza alcun pulsante in toolbar',
            JSON.stringify(shapes(env).map(s => s.kind)));
        const holdSlider = Array.from(env.doc.querySelectorAll('.fn-slider-row input[type=range]'))
            .some(r => r.min == 200 && r.max == 800);
        // (slider dentro popover: aprire popHelp e' coperto da qaA; qui
        // cerchiamo nel DOM anche se non montato - se assente, fallisce)
        ok(holdSlider, '11.5 slider "Fermo per snap" 200-800ms nel popover');

        // ============ R19 A2.1: "C" aperta NON deve snap-pare =============
        await freshDoc(env);
        ink.setHelp(0.6);
        const cOpen = [];
        for (let i = 0; i <= 55; i++) {
            const a = (40 + (i / 55) * 280) * Math.PI / 180;   // arco di 280gradi
            cOpen.push([320 + Math.cos(a) * 55, 320 + Math.sin(a) * 55]);
        }
        await env0.stroke(env, env0.wc(env, cOpen));
        // R20 lotto 1 (spec 2, aspettativa SUPERATA): la C aperta PUO'
        // diventare 'curve' ma MAI circle/ellipse - il loop non viene
        // chiuso forzatamente (gap grande => nessun fit Kasa/ellisse).
        const sh12 = shapes(env);
        const bad12 = sh12.filter(s => s.kind !== 'curve');
        ok(bad12.length === 0,
            '12.0 C aperta (280gradi) -> MAI circle/ellipse (curve o stroke)',
            JSON.stringify(sh12.map(s => s.kind)) + ' strokes=' + strokes(env).length);

        // ============ R19 A2.1: scarabocchio/coloring NO snap =============
        await freshDoc(env);
        const rnd7 = lcg(77);
        const scribble = [];
        // coloring a passate parallele dentro una scatola (L/D grande + riempimento)
        for (let row = 0; row < 8; row++) {
            const y = 300 + row * 16;
            if (row % 2 === 0) {
                for (let x = 0; x <= 220; x += 10) scribble.push([150 + x + (rnd7() - 0.5) * 6, y + (rnd7() - 0.5) * 10]);
            } else {
                for (let x = 220; x >= 0; x -= 10) scribble.push([150 + x + (rnd7() - 0.5) * 6, y + (rnd7() - 0.5) * 10]);
            }
        }
        await env0.stroke(env, env0.wc(env, scribble));
        ok(shapes(env).length === 0,
            '13.0 coloring/scarabocchio -> NESSUN snap a nessuna forma',
            JSON.stringify(shapes(env).map(s => s.kind)));

        // ============ R19 A2.4/A2.6: freccia su curva + undo 2 livelli =====
        await freshDoc(env);
        ink.setHelp(0.6);
        // tratto CURVO stretto (nessuna soglia di curvatura) + flick a V
        const curve = [];
        for (let i = 0; i <= 26; i++) {
            const t = i / 26;
            curve.push([180 + t * 200, 480 - Math.sin(t * Math.PI) * 70]);
        }
        // pausa temporale >250ms: isola il flick dalla finestra temporale
        const curvePts = env0.wc(env, curve);
        const canvas = env0.canvasOf(env);
        env0.ptr(env, canvas, 'pointerdown', curvePts[0][0], curvePts[0][1]);
        for (let i = 1; i < curvePts.length; i++) {
            await sleep(2);
            env0.ptr(env, canvas, 'pointermove', curvePts[i][0], curvePts[i][1]);
        }
        await sleep(300);   // < holdMs(350): nessun snap hold, >250ms finestra flick
        const fl = env0.wc(env, [[380, 480], [396, 492], [404, 484],
                                 [396, 500], [382, 494], [372, 502]]);
        for (let i = 0; i < fl.length; i++) {
            await sleep(4);
            env0.ptr(env, canvas, 'pointermove', fl[i][0], fl[i][1]);
        }
        env0.ptr(env, canvas, 'pointerup', fl[fl.length - 1][0], fl[fl.length - 1][1]);
        await sleep(120);
        sh = shapes(env);
        // R20 lotto F: attesa aggiornata - UN oggetto 'arrow' con asta =
        // fit Bezier della porzione pre-flick + punta saldata (params.head)
        const curSh = sh.filter(s => s.kind === 'arrow');
        ok(curSh.length === 1 && curSh[0].params && curSh[0].params.shaft &&
           curSh[0].params.shaft.kind === 'curve' && curSh[0].params.head,
            '14.0 flick su tratto CURVO -> UN oggetto arrow (shaft curve + head)',
            JSON.stringify(sh.map(s => ({ k: s.kind,
                sk: s.params && s.params.shaft && s.params.shaft.kind }))));
        console.log('PRB14 ' + JSON.stringify(env.win.__ink.trace.filter(
            e => e.k === 'dbgF' || e.k === 'dbgf' || e.k === 'dbgf2' || e.k === 'dbgfS' || e.k === 'dbgC')));
        ok(curSh.length === 1 &&
           !!(curSh[0].params.shaft.bez && curSh[0].params.shaft.bez.length),
            '14.0b asta = fit Bezier (params.shaft.bez, residuo <=2.5px)',
            'bez=' + (curSh.length === 1 && curSh[0].params.shaft.bez
                ? curSh[0].params.shaft.bez.length : 'null'));
        ok(strokes(env).length === 0,
            '14.1 nessun tratto grezzo residuo dopo ricostruzione',
            'strokes=' + strokes(env).length);
        // A2.6: undo a 2 livelli su freccia ricostruita
        env0.undoKey(env, 1);
        const u1 = env.win.__ink.objects();
        ok(u1.length === 1 && u1[0].t === 'stroke',
            '14.2 primo undo -> tratto GREZZO (pre-flick) ripristinato',
            JSON.stringify(u1.map(o => o.t + ':' + (o.kind || ''))));
        env0.undoKey(env, 1);
        const u2 = env.win.__ink.objects();
        ok(u2.length === 0, '14.3 secondo undo -> tratto RIMOSSO',
            'len=' + u2.length);

        // ============ R19 A2.5: residuo su curva lunga tremolante =========
        await freshDoc(env);
        ink.setHelp(0.6);
        ink.setShaping(true, true, 350);
        const rnd8 = lcg(2024);
        const ideal = x => 300 + 45 * Math.sin(x / 90);
        const wavy = [];
        for (let x = 80; x <= 700; x += 6) {
            wavy.push([x + (rnd8() - 0.5) * 2, ideal(x) + (rnd8() - 0.5) * 5]);
        }
        await env0.stroke(env, env0.wc(env, wavy), { dt: 1, settle: 140 });
        // R20 lotto 1 (spec 2, aspettativa SUPERATA): la classe 'curve' e'
        // ora l'uscita per i tratti curvi di QUALITA' (residuo grezzo->
        // ideale <=2.5px): la curva lunga tremolante snap-pa a 'curve'
        // (prima restava stroke perche' la classe non esisteva ancora).
        const sh15 = shapes(env).filter(s => s.kind === 'curve');
        ok(sh15.length === 1, '15.0 curva lunga -> shape curve (classe R20)',
            JSON.stringify(shapes(env).map(s => s.kind)));
        if (sh15.length === 1 && sh15[0].params && sh15[0].params.bez) {
            // Tolleranza DICHIARATA R20: residuo curva->ideale <= 2.5px
            // (campionamento Bezier denso vs funzione seno del tracciato)
            const bez = sh15[0].params.bez;
            let maxd = 0;
            for (const sg of bez) {
                for (let j = 0; j <= 16; j++) {
                    const t = j / 16, u = 1 - t;
                    const x = u * u * u * sg[0][0] + 3 * u * u * t * sg[1][0] +
                              3 * u * t * t * sg[2][0] + t * t * t * sg[3][0];
                    const y = u * u * u * sg[0][1] + 3 * u * u * t * sg[1][1] +
                              3 * u * t * t * sg[2][1] + t * t * t * sg[3][1];
                    const d = Math.abs(y - ideal(x));
                    if (d > maxd) maxd = d;
                }
            }
            ok(maxd <= 2.5, '15.1 residuo curva->ideale <= 2.5px (R20 dichiarato)',
                'maxd=' + maxd.toFixed(2) + 'px');
        }
        // ==== R25 V1: la stessa curva (>=2 flessi) puo' essere FREEFORM ====
        // (classificatore V1): SOLO smoothing topologia-preservante Taubin,
        // NESSUN snap a bezier ideale -> params.freeform, vclass freeform.
        if (sh15.length === 1 && sh15[0].params && sh15[0].params.freeform) {
            ok(sh15[0].vclass === 'freeform' && !sh15[0].params.bez,
                '15.2 V1 freeform: vclass freeform + params.bez ASSENTE (no snap)',
                'vclass=' + sh15[0].vclass + ' bez=' + (!!sh15[0].params.bez));
            // oracolo indipendente: flessi = cambi segno della derivata del
            // profilo rispetto alla corda (dead-band 0.8px)
            const P15 = sh15[0].pts;
            const a15 = P15[0], b15 = P15[P15.length - 1];
            const L15 = Math.hypot(b15[0] - a15[0], b15[1] - a15[1]);
            const ux15 = (b15[0] - a15[0]) / L15, uy15 = (b15[1] - a15[1]) / L15;
            const d15 = [];
            for (let i = 0; i < P15.length; i++) {
                d15.push(-uy15 * (P15[i][0] - a15[0]) + ux15 * (P15[i][1] - a15[1]));
            }
            let last15 = 0, f15 = 0;
            for (let i = 1; i < d15.length; i++) {
                const dv = d15[i] - d15[i - 1];
                if (Math.abs(dv) < 0.8) continue;
                const sg = dv > 0 ? 1 : -1;
                if (last15 && sg !== last15) f15++;
                last15 = sg;
            }
            ok(f15 >= 2, '15.3 V1 freeform: >=2 flessi PRESERVATI', 'flessi=' + f15);
            // fedelta: i punti renderizzati restano vicini al seno VERO
            const sine15 = [];
            for (let x = 80; x <= 700; x += 6) sine15.push([x, ideal(x)]);
            let dev15 = 0;
            for (const q of P15) {
                let bd = Infinity;
                for (let i = 0; i < sine15.length - 1; i++) {
                    const a = sine15[i], b = sine15[i + 1];
                    const dx = b[0] - a[0], dy = b[1] - a[1];
                    const l2 = dx * dx + dy * dy;
                    let t = l2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2 : 0;
                    t = t < 0 ? 0 : (t > 1 ? 1 : t);
                    const dd = Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy));
                    if (dd < bd) bd = dd;
                }
                if (bd > dev15) dev15 = bd;
            }
            console.log('      MEASURE 15.4 freeform dev vs seno = ' +
                dev15.toFixed(2) + 'px');
            ok(dev15 <= 6, '15.4 V1 freeform: fedelta vs seno <=6px (smoothing non stravolge)',
                'dev=' + dev15.toFixed(2) + 'px');
        }

        console.log('\nRISULTATO a14_shaping: ' + pass + ' passati, ' + fail + ' falliti');
        if (failures.length) console.log('Falliti:\n - ' + failures.join('\n - '));
        process.exit(fail ? 1 : 0);
    } catch (e) {
        console.error('ECCEZIONE:', e);
        console.log('\nRISULTATO a14_shaping: ' + pass + ' passati, ' + (fail + 1) + ' falliti');
        process.exit(1);
    }
})();
