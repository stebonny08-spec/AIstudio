'use strict';
/* sostituisce schemiWithMaterials() in tests/qaC2_viewer.js con la versione
   R21 basata su FontiPanel (tab Fonti -> componente unico, nessun metadato) */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'tests', 'qaC2_viewer.js');
let t = fs.readFileSync(p, 'utf8');
const start = t.indexOf('async function schemiWithMaterials');
const end = t.indexOf('async function schemiBaseline');
if (start < 0 || end < 0 || end <= start) { console.log('BOUNDARY NON TROVATI', start, end); process.exit(1); }
const newFn = `async function schemiWithMaterials() {
    console.log('== QA-C2-(iii): schemi + FontiPanel (R21) ==');
    const env = makeSchemiEnv(true, true);
    await openIn(env, 's1');
    const tabF = $$('.sc-tab', env).filter(b => b.textContent.trim() === 'Fonti')[0];
    ok(!!tabF, 'iii.0 tab Fonti presente');
    if (!tabF) return;
    click(env, tabF);
    await sleep(320);   // mount + refresh() asincrono del componente
    const fp = env.doc.querySelector('.fp21-root');
    ok(!!fp && fp.getAttribute('data-fp21') === 'schemi',
        'iii.1 FontiPanel montato nel tab Fonti (contesto schemi)',
        fp ? fp.getAttribute('data-fp21') : 'assente');
    const items = Array.from(fp ? fp.querySelectorAll('.fp21-item') : []);
    ok(items.length >= 5, 'iii.2 elenco fonti con voci mat incluse (>=5)', 'n=' + items.length);
    const badges = items.map(b => {
        const e = b.querySelector('.fp21-badge');
        return e ? e.textContent : '';
    });
    ok(badges.some(x => /^Libro/.test(x)), 'iii.3 etichetta "(Libro)" per preselected_books',
        badges.join(' | '));
    ok(badges.some(x => /^Materiale/.test(x)), 'iii.4 etichetta "(Materiale)" per path L1',
        badges.join(' | '));
    const matItem = items.filter(b => /Libro Gamma/.test(b.textContent))[0];
    ok(!!matItem, 'iii.4b voce "Libro Gamma" in lista');
    if (matItem) {
        click(env, matItem);
        await sleep(200);   // previewFonte21 async (read_material_text stub)
        const pb = fp.querySelector('.fp21-pbody');
        const txt = pb ? pb.textContent : '';
        ok(/CONTENUTO LIBRO XYZ/.test(txt), 'iii.5 preview mat contiene "CONTENUTO LIBRO XYZ"',
            txt.slice(0, 80));
        ok(!/Percorso:/.test(txt) && !/Nome:/.test(txt) && !/Dimensione:/.test(txt) &&
           !/Tipo file:/.test(txt) && !/Indicizzato/.test(txt),
            'iii.6 NESSUN metadato nella preview (R21 A3.4', txt.slice(0, 100));
        const ins = fp.querySelector('.fp21-insert');
        ok(!!ins && ins.disabled === false, 'iii.7 insert abilitato dopo selezione',
            ins ? 'disabled=' + ins.disabled : 'assente');
        ok(/yyyyyyyyyy/.test(txt), 'iii.8 testo integrale visibile (nessun cap 2500)',
            'len=' + txt.length);
        // select di un item study: flusso pre-C2 invariato (preview visiva)
        const stItem = items.filter(b => /Riassunto Alfa/.test(b.textContent))[0] || items[0];
        if (stItem) {
            click(env, stItem);
            await sleep(200);
            const pb2 = fp.querySelector('.fp21-pbody');
            const t2 = pb2 ? pb2.textContent : '';
            ok(t2.length > 0 && !/\\{"html/.test(t2),
                'iii.9 preview item study renderizzata (nessun json crudo)', t2.slice(0, 60));
        } else ok(false, 'iii.9 nessuna item study in lista');
    }
    ok(env.consoleErrors.length === 0, 'iii.10 zero eccezioni console',
        env.consoleErrors.slice(0, 3).join(' | '));
    env.mod.close();
    await sleep(60);
}

`;
t = t.slice(0, start) + newFn + t.slice(end);
fs.writeFileSync(p, t, 'utf8');
console.log('III SOSTITUITA OK');
