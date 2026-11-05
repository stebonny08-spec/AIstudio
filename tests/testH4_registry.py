"""Test H4 - Registry funzioni (unittest stdlib, senza LLM).

(a) 17 funzioni con chiavi complete      (b) budgets nel range
(c) 17 template SYS versionati           (d) sum/paraph/ctx esclusi
(e) build_cache_key deterministica        (f) render_user senza residui
(g) 100 chiamate simulate per FUNZIONE (1700 totali) -> 0 errori
"""

import json
import os
import re
import string
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.registry import (  # noqa: E402
    BUDGET_TOKENS,
    REGISTRY,
    SYS_EXTRAS,
    TEMPLATES,
    build_cache_key,
    clamp_output_tokens,
    get_function,
    placeholders,
    registry_functions,
    render_user,
    validate_output,
)

IDS = ["F%02d" % i for i in range(1, 18)]

REQUIRED_KEYS = {
    "id",
    "trigger_ui",
    "sys",
    "user_template",
    "grammar",
    "validator",
    "cache_key",
    "fallback",
    "budget_classe",
}

EXPECTED_BUDGETS = {
    "F01": "standard", "F02": "standard", "F03": "micro", "F04": "micro",
    "F05": "standard", "F06": "think", "F07": "micro", "F08": "micro",
    "F09": "standard", "F10": "standard", "F11": "micro", "F12": "standard",
    "F13": "standard", "F14": "think", "F15": "micro", "F16": "micro",
    "F17": "micro",
}

EXPECTED_TEMPLATES = {
    "flash_v1", "judge_v1", "tutor_v1", "improve_v1", "explain_v1",
    "nlformula_v1", "outline_v1", "slide_v1", "notes_v1", "script_v1",
    "plan_v1", "cite_v1", "tag_v1", "nextq_v1", "ctx_v1", "sum_v1",
    "paraph_v1",
}

WORKER_ONLY_TEMPLATES = {"sum_v1", "paraph_v1", "ctx_v1"}

TESTI = [
    "La fotosintesi clorofilliana converte la luce solare in energia chimica. "
    "Le piante producono glucosio e liberano ossigeno. Il processo avviene nei "
    "cloroplasti delle foglie.",
    "Il moto uniformemente accelerato ha accelerazione costante nel tempo. La "
    "velocità cresce in modo regolare. La formula fondamentale lega velocità, "
    "accelerazione e tempo.",
    "La Rivoluzione francese iniziò nel 1789 con la presa della Bastiglia. I "
    "suoi principi erano libertà, uguaglianza e fraternità.",
]


# --------------------------------------------------------------------------
# Generatori di input/output finti (coerenti con template e regole)
# --------------------------------------------------------------------------

def _kw_for(fid, i):
    """Input finti per TUTTI i placeholder del template + campi cache_key."""
    entry = get_function(fid)
    names = set(placeholders(entry["user_template"])) | set(entry["cache_key"])
    base = {
        "materia": "Biologia",
        "testo": TESTI[i % len(TESTI)],
        "n": 1 + (i % 4),
        "sezione": "Capitolo 2",
        "doc_id": "doc_17",
        "q": "Che cosa producono le piante durante la fotosintesi?",
        "a": "Le piante producono glucosio e liberano ossigeno.",
        "front": "Che cosa converte la luce in energia nelle piante?",
        "back": "La fotosintesi clorofilliana avviene nei cloroplasti.",
        "risp": "Le piante producono glucosio usando la luce solare.",
        "intent": "chiaro",
        "bozza": TESTI[0],
        "docs": "doc_17",
        "chunks": TESTI[i % len(TESTI)],
        "f": "SUM(A1:A5)",
        "desc": "somma dei valori da A1 a A5",
        "ref": "B2",
        "list": "SUM, AVERAGE, MIN, MAX",
        "arg": "Fotosintesi clorofilliana",
        "o": "OUTLINE",
        "t": "Introduzione",
        "sec": 40 + (i % 5) * 10,
        "titolo": "Introduzione al video",
        "contenuto": TESTI[i % len(TESTI)],
        "gg": 7,
        "stats": "media voti 7.5, 3 ripassi settimanali",
        "events": "gita il giorno 3, lezione il giorno 5",
        "vocab": "fotosintesi, energia, piante, luce",
        "ctx": "il capitolo sulla fotosintesi clorofilliana",
        "payload": "PAYLOAD",
        "meta": "meta=flashcard",
    }
    return {k: base[k] for k in names}


def _sentences(texto):
    parts = re.split(r"(?<=[.!?])\s+", str(texto).strip())
    return [p for p in parts if p.strip()] or [str(texto)]


def _deck_json(n, testo, doc_id=None, single=False):
    sents = _sentences(testo)
    count = 1 if single else int(n)
    cards = []
    for k in range(count):
        quote = sents[k % len(sents)].strip()
        card = {
            "front": (
                "Domanda %d: che cosa converte la luce in energia chimica "
                "nelle piante?" % (k + 1)
            ),
            "back": (
                "La fotosintesi clorofilliana, che avviene nei cloroplasti "
                "della cellula vegetale."
            ),
            "hint": "pensa ai cloroplasti e alla luce",
            "quote": quote,
        }
        if doc_id is not None:
            card["citations"] = [{"quote": quote, "source": doc_id}]
        cards.append(card)
    return json.dumps({"cards": cards})


def _fake_output(fid, kw, i):
    """Output JSON ben formato che soddisfa grammatica + regole della funzione."""
    if fid == "F01":
        return _deck_json(kw["n"], kw["testo"])
    if fid == "F02":
        return _deck_json(kw["n"], kw["testo"], doc_id=kw["doc_id"])
    if fid == "F03":
        testo = "%s %s" % (kw["q"], kw["a"])
        return _deck_json(1, testo, single=True)
    if fid == "F04":
        judgment = ("corretto", "parziale", "errato")[i % 3]
        out = {
            "judgment": judgment,
            "feedback": (
                "La risposta è corretta e completa: hai usato il termine "
                "giusto e hai collegato le due idee."
            ),
        }
        if judgment != "corretto":
            out["followup"] = "Perché il processo avviene proprio nei cloroplasti?"
        return json.dumps(out)
    if fid == "F05":
        bozza = kw["bozza"]
        return json.dumps(bozza if i % 2 == 0 else bozza[:100])
    if fid == "F06":
        sents = _sentences(kw["chunks"])
        return json.dumps({
            "answer": "Secondo i passaggi forniti la risposta è chiara.",
            "citations": [{"quote": sents[0].strip(), "source": kw["docs"]}],
        })
    if fid == "F07":
        return json.dumps("\n".join([
            "La formula somma i valori richiesti.",
            "Ignora le celle vuote.",
            "Usa l'intervallo indicato dalla formula.",
            "Il risultato va nella cella di destinazione.",
        ]))
    if fid == "F08":
        return json.dumps("SUM(A1:A5)" if i % 2 == 0
                          else "AVERAGE(B1:B9)+ROUND(C1,2)")
    if fid == "F09":
        cols = 3 + (i % 4)
        header = ["colonna%d" % (c + 1) for c in range(cols)]
        rows = [["r%dc%d" % (r + 1, c + 1) for c in range(cols)]
                for r in range(3)]
        return json.dumps({"header": header, "rows": rows})
    if fid == "F10":
        slides = []
        for k in range(5 + (i % 4)):
            nb = 1 + ((i + k) % 4)
            slides.append({
                "title": "Affrontera il punto %d in modo attivo" % (k + 1),
                "bullets": ["punto chiave %d.%d breve" % (k + 1, j + 1)
                            for j in range(nb)],
            })
        return json.dumps({"title": "Programma di studio", "slides": slides})
    if fid == "F11":
        pool = [
            "primo punto essenziale",
            "secondo punto essenziale",
            "terzo punto di riepilogo",
            "quarto punto di approfondimento",
            "quinto punto conclusivo",
        ]
        return json.dumps({"title": kw["t"], "bullets": pool[:1 + (i % 5)]})
    if fid == "F12":
        nwords = 60 + (i % 31)  # 60..90
        return json.dumps(" ".join(["parola"] * nwords))
    if fid == "F13":
        sec = int(kw["sec"])
        nwords = round(sec * 2.5)
        return json.dumps(" ".join(["voce"] * nwords))
    if fid == "F14":
        sessions = [
            {"day": "giorno-1", "start": "09:00",
             "minutes": 45 + (i % 4) * 10, "target": "ripasso teoria"},
            {"day": "giorno-1", "start": "11:00", "minutes": 60,
             "target": "esercizi pratici"},
            {"day": "giorno-2", "start": "16:30", "minutes": 50,
             "target": "ripasso flashcard"},
        ]
        if i % 2:
            sessions.append({"day": "giorno-3", "start": "10:00",
                             "minutes": 90, "target": "verifica finale"})
        return json.dumps({"sessions": sessions})
    if fid == "F15":
        labels = ["fotosintesi", "energia", "piante", "luce"]
        return json.dumps({"labels": labels[:1 + (i % 3)]})
    if fid == "F16":
        return json.dumps({"questions": [
            "Domanda %d: come si collega l'argomento al capitolo precedente?"
            % (k + 1) for k in range(3)
        ]})
    if fid == "F17":
        if i % 2 == 0:
            return _deck_json(1, TESTO_F17)
        return json.dumps("Testo salvato come flashcard di esempio.")
    raise AssertionError("fid sconosciuto: %s" % fid)


TESTO_F17 = "Salvataggio cross-modulo di una card già generata in precedenza."


def _vary(value):
    if isinstance(value, bool):
        return not value
    if isinstance(value, int):
        return value + 1
    if isinstance(value, str):
        return value + "~var"
    return [value]


# --------------------------------------------------------------------------

class TestRegistryH4(unittest.TestCase):

    # (a) 17 funzioni, chiavi complete
    def test_a_diciassette_funzioni_e_chiavi(self):
        self.assertEqual(sorted(REGISTRY.keys()), IDS)
        funzioni = registry_functions()
        self.assertEqual(len(funzioni), 17)
        for entry in funzioni:
            mancanti = REQUIRED_KEYS - set(entry.keys())
            self.assertFalse(
                mancanti, "%s chiavi mancanti: %s" % (entry["id"], mancanti)
            )
            self.assertIn(entry["id"], REGISTRY)
            self.assertTrue(entry["trigger_ui"])
            self.assertTrue(entry["user_template"])
            self.assertTrue(entry["grammar"].startswith("G_"))
            self.assertTrue(entry["fallback"])
            self.assertIsInstance(entry["cache_key"], list)

    # (b) budgets nel range (micro<=200, standard<=600, think<=1500)
    def test_b_budget_nel_range(self):
        self.assertEqual(BUDGET_TOKENS, {"micro": 200, "standard": 600,
                                         "think": 1500})
        for fid, entry in REGISTRY.items():
            classe = entry["budget_classe"]
            self.assertIn(classe, BUDGET_TOKENS, fid)
            self.assertEqual(classe, EXPECTED_BUDGETS[fid])
            self.assertEqual(clamp_output_tokens(classe, 10 ** 6),
                             BUDGET_TOKENS[classe], fid)
            self.assertEqual(clamp_output_tokens(classe, 50), 50, fid)
        with self.assertRaises(KeyError):
            clamp_output_tokens("huge", 10)

    # (c) template SYS: 17 voci versionate v1
    def test_c_template_sys_versionati(self):
        self.assertEqual(len(TEMPLATES), 17)
        self.assertEqual(set(TEMPLATES.keys()), EXPECTED_TEMPLATES)
        for tid, tpl in TEMPLATES.items():
            self.assertEqual(tpl.get("version"), "v1", tid)
            self.assertIsInstance(tpl.get("text"), str)
            self.assertGreater(len(tpl["text"]), 40, tid)
        for entry in REGISTRY.values():
            if entry["sys"] is not None:
                self.assertIn(entry["sys"], TEMPLATES, entry["id"])
            if entry.get("sys_extra") is not None:
                self.assertIn(entry["sys_extra"], SYS_EXTRAS, entry["id"])

    # (d) sum_v1 / paraph_v1 / ctx_v1 NON sono funzioni utente
    def test_d_esclusioni_permanenti(self):
        sys_usati = {e["sys"] for e in registry_functions()}
        self.assertEqual(sys_usati & WORKER_ONLY_TEMPLATES, set())
        for e in registry_functions():
            self.assertNotIn(e["sys"], WORKER_ONLY_TEMPLATES, e["id"])
            self.assertNotRegex(
                e["nome"], r"riassunto|summary|schem|outline_nodi",
                "funzione vietata nel registro: %s" % e["nome"],
            )
            self.assertNotIn("riassunto", e["user_template"].lower(), e["id"])
        # i template worker ESISTONO (uso interno W2/W1/W4) ma non sono esposti
        for tid in WORKER_ONLY_TEMPLATES:
            self.assertIn(tid, TEMPLATES)

    # (e) build_cache_key deterministica e distinta per input
    def test_e_cache_key_deterministica(self):
        for fid in IDS:
            kw = _kw_for(fid, 0)
            k1 = build_cache_key(fid, kw)
            k2 = build_cache_key(fid, dict(kw))
            self.assertEqual(k1, k2, fid)
            # campi non dichiarati non influenzano la chiave
            k3 = build_cache_key(fid, {**kw, "campo_non_dichiarato": "x"})
            self.assertEqual(k1, k3, fid)
            # ogni campo dichiarato, variato, produce chiave diversa
            for campo in get_function(fid)["cache_key"]:
                kw2 = dict(kw)
                kw2[campo] = _vary(kw[campo])
                self.assertNotEqual(
                    k1, build_cache_key(fid, kw2),
                    "%s: chiave uguale nonostante %s variato" % (fid, campo),
                )
        self.assertNotEqual(build_cache_key("F01", _kw_for("F01", 1)),
                            build_cache_key("F03", _kw_for("F03", 1)))

    # (f) render_user sostituisce TUTTI i placeholder
    def test_f_render_user_senza_residui(self):
        for fid in IDS:
            entry = get_function(fid)
            names = placeholders(entry["user_template"])
            self.assertTrue(names, fid)
            kw = _kw_for(fid, 0)
            out = render_user(fid, **kw)
            self.assertTrue(out.strip(), fid)
            for nome in names:
                self.assertNotIn("{%s}" % nome, out, "%s: residuo {%s}"
                                 % (fid, nome))
            self.assertIsNone(
                re.search(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}", out),
                "%s: placeholder residuo in %r" % (fid, out),
            )
            for nome in names:
                self.assertIn(str(kw[nome]), out, fid)
            # placeholder mancante -> ValueError esplicito
            ridotto = dict(kw)
            ridotto.pop(names[0])
            with self.assertRaises(ValueError):
                render_user(fid, **ridotto)

    # (g) 100 chiamate simulate per FUNZIONE -> 0 errori (1700 totali)
    def test_g_simulazioni_complete(self):
        totali = 0
        errori = []
        for fid in IDS:
            nomi = placeholders(get_function(fid)["user_template"])
            for i in range(100):
                kw = _kw_for(fid, i)
                try:
                    render_user(fid, **kw)
                except Exception as exc:  # pragma: no cover
                    errori.append((fid, i, "render: %s" % exc))
                    continue
                raw = _fake_output(fid, kw, i)
                ok, parsed, errors = validate_output(fid, raw, ctx=kw)
                totali += 1
                if not ok:
                    errori.append((fid, i, errors))
        self.assertEqual(totali, 1700)
        self.assertEqual(errori, [], "primi errori: %s" % errori[:5])

    # extra: get_function per id e per nome, KeyError se inesistente
    def test_h_get_function(self):
        self.assertEqual(get_function("F01")["id"], "F01")
        self.assertEqual(get_function("flashcard_from_selection")["id"], "F01")
        with self.assertRaises(KeyError):
            get_function("F99")


if __name__ == "__main__":
    unittest.main(verbosity=2)
