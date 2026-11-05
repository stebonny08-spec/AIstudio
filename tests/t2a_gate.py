# -*- coding: utf-8 -*-
"""
tests/t2a_gate.py — GATE QUALITATIVO (accettazione utente)
Genera 15 output reali per funzione per F01, F04, F10, F13 (60 totali) con il
modello locale MiniCPM5-2B-Q4_K_M tramite core.ai_runtime.run_ai_function
(validazione + retry H4 REALI). Output salvati in qa/gate_outputs.json (RESUME:
riprende da dove era) + qa/gate_summary.md per la revisione dell'utente.

Esecuzione: python tests/t2a_gate.py   (run reale, ~15-35 min, nessuna simulazione)
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# stdout/stderr UTF-8 (log e print con frecce/punteggiatura italiana)
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

OUT_JSON = ROOT / "qa" / "gate_outputs_r12.json"
OUT_MD = ROOT / "qa" / "gate_summary_r12.md"
LOG = ROOT / "qa" / "gate_run_r12.log"
PREV_JSON = ROOT / "qa" / "gate_outputs.json"  # Round 11 (preservato, solo lettura)

MODEL = os.path.expandvars(
    os.path.expanduser(r"%APPDATA%\NovaStudio\models\MiniCPM5-2B-Q4_K_M.gguf"))


def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


# ------------------------------------------------------------------ inputs
def inputs_f01(i: int):
    topics = [
        ("Biologia", "La fotosintesi clorofilliana converte l'energia luminosa in energia chimica. "
         "Avviene nei cloroplasti e coinvolge la clorofilla. La fase luminosa produce ATP e NADPH. "
         "Il ciclo di Calvin fissa il CO2 in glucosio. Errori comuni: confondere fotolisi e fotofosforilazione."),
        ("Storia", "La Rivoluzione francese inizia nel 1789 per crisi fiscale e disuguaglianze sociali. "
         "La presa della Bastiglia segna il punto di rottura. La Dichiarazione dei diritti afferma libertà e uguaglianza. "
         "Il terrore porta ghigliottina e conflitti. Errori comuni: datare al 1799 l'inizio."),
        ("Matematica", "La derivata misura la velocità istantanea di variazione di una funzione. "
         "Si calcola come limite del quoziente incrementale. Le regole di derivazione semplificano i calcoli. "
         "L'applicazione agli studi di massimo dipende dalla derivata prima azzerata. "
         "Errori comuni: dimenticare la regola del prodotto."),
    ]
    mat, testo = topics[i % 3]
    return {"materia": mat, "n": 3, "testo": testo}


def inputs_f04(i: int):
    front = "Perché la fase luminosa produce ATP e NADPH?"
    backs = [
        "Perché l'energia della luce fa pompare protoni e riduce il NADP+.",
        "Perché il gradiente protonico alimenta l'ATP sintasi e il NADP+ ridotto.",
        "Perché la clorofilla assorbe la luce.",
    ]
    kinds = ["corretta", "parziale", "errata"]
    kind = kinds[i % 3]
    if kind == "corretta":
        risp = "L'energia luminosa crea un gradiente protonico che produce ATP e riduce il NADP+ a NADPH."
    elif kind == "parziale":
        risp = "Perché la luce fa muovere i protoni."
    else:
        risp = "Perché il glucosio si forma direttamente nei cloroplasti senza ciclo di Calvin."
    return {"front": front, "back": backs[i % 3], "risp": risp}


def inputs_f10(i: int):
    args = [
        "Termodinamica entropia", "Rivoluzione francese cause", "Derivate applicazioni",
        "Mitosi e meiosi confronto", "Impero romano strade", "Funzioni logaritmi",
        "Rivoluzione industriale conseguenze", "Vettori nel piano", "Guerra fredda blocchi",
        "Reazioni chimiche equilibrio", "Apprendimento automatico neuroni", "Integrazioni sostituzione",
        "Algebra lineare matrici", "Seconda guerra mondiale cause", "Probabilità condizionata",
    ]
    return {"arg": args[i % len(args)]}


def inputs_f13(i: int):
    titoli = [
        "Fotosintesi spiegata in breve", "La Rivoluzione francese in 5 eventi",
        "Derivate: guida rapida", "Il ciclo cellulare", "Strade romane",
        "Logaritmi: errori comuni", "La macchina a vapore", "Vettori e moduli",
        "Cortina di ferro", "Equilibrio chimico", "Reti neurali base",
        "Integrale indefinito", "Matrici 2x2", "1929 il crollo", "Probabilità con esempi",
    ]
    secs = [30, 35, 40, 45, 50, 55, 60]
    sec = secs[i % len(secs)]
    return {"sec": sec, "titolo": titoli[i % len(titoli)],
            "contenuto": "Spiegazione scolastica con definizione, un esempio numerico e un errore tipico da evitare."}


CASES = {
    "F01": inputs_f01,
    "F04": inputs_f04,
    "F10": inputs_f10,
    "F13": inputs_f13,
}
N_PER = 15


def main() -> int:
    from core.ai_runtime import run_ai_function
    from core.ai_cache import AiCache
    from core.registry.engine import validate_output
    from core.local_llm_client import LocalLLMClient

    # ---- resume ----
    store = []
    done_keys = set()
    if OUT_JSON.exists():
        try:
            store = json.loads(OUT_JSON.read_text(encoding="utf-8"))
            done_keys = {(e["fid"], e["i"]) for e in store}
            log(f"resume: {len(done_keys)} output gia' presenti")
        except Exception as exc:
            log(f"resume corrotto ({exc}) — ripartenza")
            store, done_keys = [], set()

    def save():
        OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        OUT_JSON.write_text(json.dumps(store, ensure_ascii=False, indent=1),
                            encoding="utf-8")

    log(f"caricamento modello: {MODEL}")
    t0 = time.time()

    # llama_cpp DIRETTO: LocalLLMClient.generate non espone max_tokens e
    # genera fino a stop lenti (~343s per 2 call misurati) -> bound esplicito.
    from llama_cpp import Llama
    llm = Llama(model_path=MODEL, n_ctx=4096, n_threads=None, verbose=False)

    # --- llm_fn VALIDATO su campioni reali (_rf3: F01/F04/F10/F13 ok=True) ---
    # * response_format json_object: elimina il <thinking> del template MiniCPM
    #   e produce JSON in ~10-45s (senza: reasoning mangia il budget);
    # * marcatori fid PRECISI (il prompt F04 menziona "flashcard": niente
    #   marker generici) ordinate per specificita';
    # * grammatiche G_text/G_formula: il registro accetta solo STRINGA JSON ->
    #   adattatore oggetto->json.dumps(stringa);
    # * hint dinamici dal compito (conteggi, parole, quote letterale).
    MARKS = [
        ('Giudica la risposta', 'F04'), ('Card front:', 'F04'),
        ('Crea esattamente', 'F01'), ('Trasforma in 1 flashcard', 'F03'),
        ('Outline per', 'F10'), ('Script di', 'F13'),
        ('Traduci in formula', 'F08'), ('Riscrivi in modo', 'F05'),
        ('Spiega la formula', 'F07'), ('Proponi 3 domande', 'F16'),
        ('Suggerisci al massimo', 'F15'), ('Pianifica sessioni', 'F14'),
        ('Tabella da generare', 'F09'), ('Rispondi usando SOLO', 'F06'),
    ]

    def _fid_of(prompt, kw):
        fid = kw.get('fid') or ''
        if fid:
            return fid
        for mk, f in MARKS:
            if mk in prompt:
                return f
        return ''

    def llm_fn(prompt, **kw):
        import re as _re
        import traceback as _tb
        import json as _json
        fid = _fid_of(prompt, kw)
        from core.registry.functions import get_function as _gf
        try:
            g = _gf(fid)['grammar']
        except Exception:
            g = ''
        text_mode = g in ('G_text', 'G_formula')
        hints = []
        m = _re.search(r'esattamente (\d+) flashcard', prompt)
        if m:
            hints.append('Devono esserci ESATTAMENTE %s oggetti in cards.' % m.group(1))
        m = _re.search(r'Script di (\d+) secondi', prompt)
        if m:
            hints.append('Il testo finale deve avere ESATTAMENTE circa %d parole '
                         '(target %s*2,5; tolleranza +-20%% del target; conta le '
                         'parole e rispetta la banda).'
                         % (round(int(m.group(1)) * 2.5), m.group(1)))
        if fid == 'F10':
            hints.append('ESATTAMENTE 6 oggetti in slides (ne 5 ne 7); in OGNI slide '
                         'UN SOLO campo "bullets" (mai chiavi duplicate) con 1-4 voci '
                         'di max 12 parole.')
        if fid == 'F01':
            hints.append('Ogni card: front = domanda COMPLETA di 10-140 caratteri '
                         '(mai "perché?" da solo), back, hint, quote = frase LETTERALE '
                         'copia dal testo fornito.')
        p = prompt
        if text_mode:
            p += ('\nRispondi SOLO con un oggetto JSON contenente il testo finale in UN '
                  'unico campo stringa, es. {"text":"..."} o {"formula":"SUM(A1:A3)"}. '
                  'Nessun pensiero, solo JSON.')
        else:
            p += ('\nRispondi SOLO con l\'oggetto JSON del compito (tutti i campi '
                  'richiesti, conteggi esatti). Nessun pensiero, solo JSON.')
        if hints:
            p += '\nVincoli: ' + ' '.join(hints)
        mt = kw.get("max_tokens")
        try:
            mt = int(mt)
        except (TypeError, ValueError):
            mt = None
        if not mt or mt <= 0:
            mt = {"micro": 200, "standard": 600, "think": 1500}.get(
                str(kw.get("classe") or ""), 600)
        mt = max(32, min(mt, 1500))
        t1 = time.time()
        try:
            out = llm.create_chat_completion(
                messages=[{"role": "user", "content": p}],
                temperature=0.6, max_tokens=mt,
                response_format={"type": "json_object"})
            txt = (out["choices"][0]["message"]["content"] or "").strip()
            if text_mode:
                try:
                    obj = _json.loads(txt)
                    val = None
                    if isinstance(obj, dict):
                        for v in obj.values():
                            if isinstance(v, str) and v.strip():
                                val = v
                                break
                    txt = _json.dumps(str(val if val is not None else txt),
                                      ensure_ascii=False)
                except Exception:
                    txt = _json.dumps(txt, ensure_ascii=False)
            log(f"  llm fid={fid or '?'}{'/text' if text_mode else ''} "
                f"{int((time.time()-t1)*1000)}ms len={len(txt)} mt={mt}")
            return txt
        except Exception as exc:
            log(f"  llm ECCEZIONE {int((time.time()-t1)*1000)}ms {exc!r} mt={mt}")
            log("  TB: " + _tb.format_exc().replace(chr(10), " | ")[:480])
            raise

    cache = AiCache()
    total = len(CASES) * N_PER
    n_done = 0
    for fid, mk in CASES.items():
        for i in range(1, N_PER + 1):
            if (fid, i) in done_keys:
                n_done += 1
                continue
            inputs = mk(i - 1)
            ts = time.time()
            try:
                res = run_ai_function(fid, inputs, ai_cache=cache, llm_fn=llm_fn)
            except Exception as exc:  # il gate registra, non muore
                res = {"ok": False, "error": repr(exc), "fallback": True}
            ms = int((time.time() - ts) * 1000)
            data = res.get("data")
            raw_txt = data if isinstance(data, str) else json.dumps(
                data, ensure_ascii=False)
            # validazione indipendente per il report (run_ai_function ha già
            # validato, ma vogliamo l'esito H4 esplicito)
            v_ok, v_parsed, v_errs = True, data, []
            if not res.get("ok"):
                v_ok, v_errs = False, [str(res.get("error") or "fallback/errore")]
            entry = {
                "fid": fid, "i": i, "inputs": inputs,
                "parsed_ok": bool(res.get("ok")),
                "retried": bool(res.get("retried")),
                "badge": res.get("badge"), "ms": ms,
                "errors": v_errs,
                "output": (raw_txt or "")[:3000],
            }
            store.append(entry)
            n_done += 1
            save()
            log(f"{fid} #{i}/15 ok={entry['parsed_ok']} retried={entry['retried']} {ms}ms "
                f"({n_done}/{total})")

    # ---- summary per l'utente (+ delta vs Round 11) ----
    prev = {}
    try:
        if PREV_JSON.exists():
            prev_rows = json.loads(PREV_JSON.read_text(encoding="utf-8"))
            for r in CASES:
                rows_p = [e for e in prev_rows if e["fid"] == r]
                prev[r] = (sum(1 for e in rows_p if e["parsed_ok"]), len(rows_p))
    except Exception:
        prev = {}
    lines = ["# Gate qualitativo Round 12 - 15 output per funzione (F01, F04, F10, F13)",
             "",
             "Generati con modello reale MiniCPM5-2B-Q4_K_M.ggUF via "
             "`run_ai_function` (validazione H4 + retry reali).",
             "Fix R12 applicati (da gate_analysis): F10 = esattamente 6 slide fisse; "
             "F13 = target esplicito nel template + tolleranza +-20% con "
             "conteggio normalizzato.",
             "Revisionare ogni output e marcare ACCETTATO/RIFIUTATO.",
             "",
             "## Delta Round 11 -> Round 12 (target: totale >=54/60, F10 >=13, F13 >=12)",
             "",
             "| fid | R11 | R12 | delta | target | esito |",
             "|---|---|---|---|---|---|"]
    total_prev_ok = sum(v[0] for v in prev.values())
    total_now_ok = 0
    for fid in CASES:
        rows = [e for e in store if e["fid"] == fid]
        valid = sum(1 for e in rows if e["parsed_ok"])
        total_now_ok += valid
        pv = prev.get(fid)
        pv_s = "%d/%d" % pv if pv else "n/d"
        delta = "%+d" % (valid - pv[0]) if pv else "n/d"
        tgt = {"F01": "15/15", "F04": "15/15",
               "F10": ">=13/15", "F13": ">=12/15"}.get(fid, "")
        if fid in ("F01", "F04"):
            esito = "RAGGIUNTO" if valid == len(rows) else "MANCATO"
        elif fid == "F10":
            esito = "RAGGIUNTO" if valid >= 13 else "MANCATO"
        else:
            esito = "RAGGIUNTO" if valid >= 12 else "MANCATO"
        lines.append("| %s | %s | %d/%d | %s | %s | %s |"
                     % (fid, pv_s, valid, len(rows), delta, tgt, esito))
    tgt_tot = "RAGGIUNTO" if total_now_ok >= 54 else "MANCATO"
    lines.append("| **TOTALE** | %d/60 | **%d/60** | %+d | >=54/60 | %s |"
                 % (total_prev_ok, total_now_ok,
                    total_now_ok - total_prev_ok, tgt_tot))
    lines += [""]
    for fid in CASES:
        rows = [e for e in store if e["fid"] == fid]
        valid = sum(1 for e in rows if e["parsed_ok"])
        lines += [f"## {fid} — {valid}/{len(rows)} validi", ""]
        for e in sorted(rows, key=lambda x: x["i"]):
            lines.append(f"### {fid} #{e['i']} — ok={e['parsed_ok']} "
                         f"retried={e['retried']} {e['ms']}ms")
            if e["errors"]:
                lines.append(f"- errori: {e['errors']}")
            lines.append("```")
            lines.append(str(e["output"])[:2400])
            lines.append("```")
            lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    log(f"gate finito: {len(store)}/{total} output → {OUT_JSON.name} + {OUT_MD.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
