'use strict';
/* tests/_r19_rectprobe.js - probe NON-suite: parametri stroke rettangolo/
   quadrato che attivano lo snap in _tryRect R19 (escluso dal glob run_t1). */
const env0 = require('./_ink_env');
const sleep = env0.sleep;
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function rectPts(x, y, w, h, jit, rnd, stepped) {
    const pts = [];
    if (stepped) {
        for (let i = 0; i < w; i += 4) pts.push([x + i + (rnd() - 0.5) * jit, y + (rnd() - 0.5) * jit]);
        for (let i = 0; i < h; i += 4) pts.push([x + w + (rnd() - 0.5) * jit, y + i + (rnd() - 0.5) * jit]);
        for (let i = w; i >= 0; i -= 4) pts.push([x + i + (rnd() - 0.5) * jit, y + h + (rnd() - 0.5) * jit]);
        for (let i = h; i >= 4; i -= 4) pts.push([x + (rnd() - 0.5) * jit, y + i + (rnd() - 0.5) * jit]);
        return pts;
    }
    const per = 2 * (w + h), n = 150;
    for (let i = 0; i <= n; i++) {
        let d = (i / n) * per, px, py;
        if (d < w) { px = x + d; py = y; }
        else if (d < w + h) { px = x + w; py = y + (d - w); }
        else if (d < 2 * w + h) { px = x + w - (d - w - h); py = y + h; }
        else { px = x; py = y + h - (d - 2 * w - h); }
        pts.push([px + (rnd() - 0.5) * jit, py + (rnd() - 0.5) * jit]);
    }
    return pts;
}

(async () => {
    const env = env0.makeEnv();
    await env0.openNote(env, 'n1');
    const ink = env.win.__ink;
    const last = () => { const o = ink.objects(); return o[o.length - 1]; };
    const cases = [
        ['uniform jit2.5', 2.5, false, 150, 75],
        ['uniform jit2', 2, false, 150, 75],
        ['uniform jit1', 1, false, 150, 75],
        ['stepped jit2', 2, true, 150, 90],
        ['stepped jit1', 1, true, 150, 90],
        ['uniform sq jit2.5', 2.5, false, 90, 90],
        ['stepped sq jit2', 2, true, 96, 96]
    ];
    for (let i = 0; i < cases.length; i++) {
        const [name, jit, stepped, w, h] = cases[i];
        const rnd = lcg(50 + i);
        const pts = rectPts(100 + i * 260, 400, w, h, jit, rnd, stepped);
        await env0.stroke(env, env0.wc(env, pts), { dt: 0 });
        await sleep(50);
        const o = last();
        console.log(name.padEnd(22) + ' -> ' + (o ? o.t + '/' + (o.kind || '-') : 'none') +
            ' (n=' + pts.length + ')');
    }
    process.exit(0);
})();
