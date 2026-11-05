"""Test R13-F67 - 100+ chiamate simulate F06/F17 attraverso il VALIDATOR reale.

Copertura obbligatoria F67:
- >= 50 casi F06 (insert_citation) + >= 50 casi F17 (cross_module_action)
- payload JSON deterministici REALISTICI (materiali/didascrizioni italiane,
  citazioni verbatim dai chunks, messaggi di chat plausibili)
- attraversamento del motore REALE: render_user (nessun residuo) +
  engine.validate_output (parse_json + grammatica G_cite/G_payload +
  validator cite/payload) + repair_prompt per l'unico retry
- esito: 0 parse-error FINALI (ogni caso ok entro 1 retry; i casi "rotti"
  deliberatamente dimostrano il ciclo render -> repair -> re-validate)

Esecuzione: set PYTHONIOENCODING=utf-8 && python tests/testR13_f67.py
"""

import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core.registry import (  # noqa: E402
    get_function,
    repair_prompt,
    render_sys,
    render_user,
    validate_output,
)

# --------------------------------------------------------------------------
# Materiali deterministici (realistici, niente braces nei testi)
# --------------------------------------------------------------------------
DOCS = [
    {
        "name": "fotosintesi_clorofilliana.md",
        "text": (
            "La fotosintesi clorofilliana e il processo con cui le piante "
            "verdi convertono la luce solare in energia chimica. "
            "Avviene nei cloroplasti, organuli presenti nelle cellule "
            "vegetali. La clorofilla assorbe soprattutto la luce rossa e "
            "quella blu, riflettendo la luce verde. "
            "Nella fase luminosa si producono ATP e NADPH con liberazione "
            "di ossigeno dall'acqua. "
            "Nel ciclo di Calvin il biossido di carbonio viene fissato in "
            "glucosio grazie all'energia accumulata. "
            "Le piante di notte non compiono la fotosintesi ma respirano, "
            "consumando parte del glucosio prodotto."
        ),
    },
    {
        "name": "seconda_guerra_mondiale.txt",
        "text": (
            "La seconda guerra mondiale ebbe inizio nel 1939 con "
            "l'invasione della Polonia. "
            "Il conflitto coinvolse la maggior parte delle nazioni del "
            "mondo e si concluse nel 1945. "
            "Il teatro europeo vide lo scontro tra la Germania nazista e "
            "le forze alleate. "
            "Il 6 e il 9 agosto 1945 le bombe atomiche furono lanciate su "
            "Hiroshima e Nagasaki. "
            "La guerra si concluse con la resa incondizionata del "
            "Giappone il 2 settembre 1945. "
            "Le vittime civili e militari furono stimate in decine di "
            "milioni di persone."
        ),
    },
    {
        "name": "renascimento_arte.md",
        "text": (
            "Il Rinascimento nacque in Italia nel XIV secolo e si diffuse "
            "in tutta Europa nei secoli successivi. "
            "Gli artisti studiarono l'anatomia umana per rappresentare "
            "il corpo con maggiore realismo. "
            "La prospettiva lineare fu sistematizzata da Filippo "
            "Brunelleschi agli inizi del quattrocento. "
            "Leonardo da Vinci unì pittura, scienza e ingegneria nelle "
            "sue opere e nei suoi appunti. "
            "Michelangelo lavorò alla Cappella Sistina e al David di "
            "Firenze. "
            "L'arte del Rinascimento influenzò architettura, letteratura "
            "e scienza del mondo moderno."
        ),
    },
    {
        "name": "fisica_mecanica_newton.txt",
        "text": (
            "Il principio di inerzia afferma che un corpo mantiene il "
            "proprio stato di quiete o di moto rettilineo uniforme se non "
            "agiscono forze esterne. "
            "La seconda legge di Newton stabilisce che la forza netta "
            "uguaglia il prodotto della massa per l'accelerazione. "
            "La terza legge afferma che ad ogni azione corrisponde una "
            "reazione uguale e contraria. "
            "La legge di gravitazione universale descrive l'attrazione "
            "tra due masse. "
            "L'unità di forza nel sistema internazionale e il newton, "
            "simbolo N. "
            "Nel moto circolare uniforme l'accelerazione centripeta e "
            "diretta verso il centro della traiettoria."
        ),
    },
]

MESSAGGI_CHAT = [
    "Riassumi: la fotosintesi avviene nei cloroplasti e produce glucosio "
    "e ossigeno, spiegami bene la fase luminosa per l'esame di giovedi.",
    "Ho capito che la seconda guerra mondiale fini nel 1945 con la resa "
    "del Giappone, ma non ricordo le date delle bombe atomiche.",
    "Il tema di arte sul Rinascimento va bene se parlo di prospettiva, "
    "Brunelleschi e Leonardo, oppure devo aggiungere Michelangelo?",
    "Spiegame la differenza tra la seconda e la terza legge di Newton con "
    "un esempio pratico della vita di tutti i giorni, grazie.",
    "Ripeti il concetto di energia libera di Gibbs e quando la reazione e "
    "spontanea, in modo semplice ma preciso.",
    "Vorrei un piano di ripasso per la verifica di storia: ho tre giorni "
    "e devo studiare il novecento, il fascismo e la guerra fredda.",
    "Come si calcola il pH di una soluzione tamponata partendo dalla "
    "concentrazione dell'acido e della sua base coniugata?",
    "Riporta la struttura del tema che devo scrivere sull'antica Roma, "
    "dalla repubblica all'impero, con introductione e conclusione.",
]


def _sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", str(text).strip())
    return [p for p in parts if p.strip()] or [str(text)]


def _quote_variants(sentence, i):
    """Quote verbatim (rispettano normalize(): case/whitespace-insensitive)."""
    if i % 4 == 1:
        # spazio sostituito da a capo: normalize() lo collassa comunque
        return sentence.replace(" ", "\n", 1)
    if i % 4 == 2:
        return sentence.upper()
    if i % 4 == 3:
        return sentence.replace(" ", "  ", 1)
    return sentence


# --------------------------------------------------------------------------
# Caso F06: {docs, chunks, q} -> output G_cite {answer, citations:[{quote,source}]}
# --------------------------------------------------------------------------
def build_f06(i):
    doc = DOCS[i % len(DOCS)]
    chunks = doc["text"]
    sents = _sentences(chunks)
    q = (
        "Che cosa dice il materiale riguardo al punto %d?"
        % (1 + (i % len(sents)))
    )
    inputs = {"docs": doc["name"], "chunks": chunks, "q": q}

    n_cit = 1 + (i % 3)
    citations = []
    for k in range(n_cit):
        s = sents[(i + k) % len(sents)]
        citations.append({
            "quote": _quote_variants(s, i + k),
            "source": doc["name"],
        })
    good = json.dumps({
        "answer": (
            "Dai passaggi forniti emerge che %s"
            % _sentences(chunks)[i % len(sents)].rstrip(". ").lower() + "."
        ),
        "citations": citations,
    }, ensure_ascii=False)

    mode = i % 10
    if mode == 3:      # prosa introduttiva attorno al JSON
        raw = "Ecco la citazione richiesta.\n\n" + good
    elif mode == 4:     # fence markdown
        raw = "```json\n" + good + "\n```"
    elif mode == 5:     # dict passato direttamente (niente stringa)
        raw = json.loads(good)
    elif mode == 6:     # prosa + fence + coda
        raw = "Risposta:\n```JSON\n" + good + "\n```\nSpero ti sia utile."
    else:
        raw = good

    # 8 rotti deliberati (1 su ~7): riparabili in 1 retry
    broken = None
    if i % 7 == 3:
        broken = json.dumps({
            "answer": "Citazione parziale non ancora verificata.",
            "citations": [{
                "quote": "frase inventata che non e nei passaggi",
                "source": doc["name"],
            }],
        }, ensure_ascii=False)
    elif i % 14 == 6:
        broken = json.dumps({"answer": "Solo risposta senza citazioni."},
                            ensure_ascii=False)
    return inputs, raw, broken


# --------------------------------------------------------------------------
# Caso F17: {payload, meta} -> G_payload (stringa oppure G_deck)
# --------------------------------------------------------------------------
def build_f17(i):
    payload = MESSAGGI_CHAT[i % len(MESSAGGI_CHAT)]
    if i % 5 == 4:
        payload = payload + " Aggiungi anche un esempio." * (1 + i % 2)
    meta = {
        "kind": ("note", "documento", "mazzo")[i % 3],
        "materia": ("Biologia", "Storia", "Arte", "Fisica")[i % 4],
        "conversazione": "conv_%02d" % (i % 9),
        "sorgente": "chatbot",
    }
    inputs = {"payload": payload, "meta": meta}

    mode = i % 10
    if mode in (0, 1, 5):        # payload gia generato -> stringa JSON
        good = json.dumps(payload, ensure_ascii=False)
        if mode == 1:
            # prosa attorno: serve il fence (parse_json strappa i ``` )
            raw = "Salvo il contenuto come richiesto.\n```json\n" + good + "\n```"
        else:
            raw = good
    elif mode in (2, 3, 6):      # mazzo G_deck (front/back/quote)
        cards = [{
            "front": "Domanda %d: ricorda il concetto chiave" % (1 + i % 3),
            "back": payload[:180],
            "quote": _sentences(payload)[0],
            "hint": "ripassa il messaggio originale",
        }]
        if mode == 6:
            cards.append({
                "front": "Seconda domanda di sintesi",
                "back": "Risposta breve sul secondo punto del messaggio.",
                "quote": _sentences(payload)[-1],
            })
        good = json.dumps({"cards": cards}, ensure_ascii=False)
        raw = good if mode != 3 else "Ecco il mazzo:\n```json\n" + good + "\n```"
    elif mode == 4:              # oggetto JSON gia pronto (dict, non stringa)
        raw = {"cards": [{
            "front": "Sintesi del messaggio salvato",
            "back": payload[:180],
            "quote": _sentences(payload)[0],
        }]}
        good = json.dumps(raw, ensure_ascii=False)
    else:                        # payload con markdown/accenti
        md = "**Punto chiave**: " + payload + "\n- dettaglio 1\n- dettaglio 2"
        good = json.dumps(md, ensure_ascii=False)
        raw = good

    broken = None
    if i % 9 == 2:
        broken = ""                       # stringa vuota -> parse-error
    elif i % 9 == 5:
        broken = json.dumps({             # deck incompleto -> errori grammatica
            "cards": [{"front": "manca il resto"}]
        }, ensure_ascii=False)
    elif i % 11 == 7:
        # prosa + stringa JSON SENZA fence: il parser reale non trova
        # blocchi {..}/[..] -> parse-error, recuperato dal retry
        broken = "Ecco il salvataggio.\n" + json.dumps(
            payload, ensure_ascii=False)
    return inputs, raw, broken


class TestR13F67(unittest.TestCase):
    """100+ chiamate simulate F06+F17 -> 0 parse-error finali."""

    def setUp(self):
        self.f06 = get_function("F06")
        self.f17 = get_function("F17")

    def test_0_registro_f06_f17(self):
        self.assertEqual(self.f06["grammar"], "G_cite")
        self.assertEqual(self.f06["validator"], "cite")
        self.assertEqual(self.f06["fallback"], "manuale")
        self.assertEqual(self.f17["grammar"], "G_payload")
        self.assertEqual(self.f17["validator"], "payload")
        self.assertEqual(self.f17["fallback"], "undo+badge")
        # sys: cite_v1 esiste; F17 ha sys None (payload gia generato)
        self.assertTrue(render_sys("F06").strip())
        self.assertEqual(render_sys("F17"), "")

    def _run(self, fid, inputs, raw, broken, tag):
        """render_user -> validate -> (retry con repair_prompt) -> ok."""
        prompt = render_user(fid, **inputs)
        self.assertNotIn("{%s}" % ("payload" if fid == "F17" else "chunks"),
                         prompt, tag)
        self.assertNotIn("{%s}" % ("meta" if fid == "F17" else "q"), prompt)
        self.assertNotIn("{docs}", prompt)

        first_raw = broken if broken is not None else raw
        ok, parsed, errors = validate_output(fid, first_raw, ctx=inputs)
        if broken is None:
            self.assertTrue(
                ok, "%s: primo passaggio non valido: %s" % (tag, errors))
            return {"first_ok": True, "repaired": False}

        # ciclo di retry REALE: repair_prompt descrive gli errori
        rp = repair_prompt(fid, errors)
        self.assertIn("Errori:", rp, tag)
        for e in errors[:3]:
            self.assertIn(str(e)[:40], rp, tag)
        ok2, parsed2, errors2 = validate_output(fid, raw, ctx=inputs)
        self.assertTrue(
            ok2, "%s: non riparato entro 1 retry: %s" % (tag, errors2))
        return {"first_ok": False, "repaired": True}

    def test_f06_cinquanta_cinque_casi(self):
        stats = {"first_ok": 0, "repaired": 0}
        for i in range(55):
            inputs, raw, broken = build_f06(i)
            r = self._run("F06", inputs, raw, broken, "F06[%02d]" % i)
            stats["first_ok" if r["first_ok"] else "repaired"] += 1
        # 0 parse-error finali: tutti i 55 casi ok (>= 47 ok al primo colpo)
        self.assertEqual(stats["first_ok"] + stats["repaired"], 55)
        self.assertGreaterEqual(stats["first_ok"], 40, stats)
        print("  F06: 55 casi, ok primo passaggio=%d, riparati=%d"
              % (stats["first_ok"], stats["repaired"]))

    def test_f17_cinquanta_cinque_casi(self):
        stats = {"first_ok": 0, "repaired": 0}
        for i in range(55):
            inputs, raw, broken = build_f17(i)
            r = self._run("F17", inputs, raw, broken, "F17[%02d]" % i)
            stats["first_ok" if r["first_ok"] else "repaired"] += 1
        self.assertEqual(stats["first_ok"] + stats["repaired"], 55)
        # 16 rotti deliberatamente (parse vuoto/deck incompleto/prosa senza
        # fence): tutti riparati entro 1 retry, 0 errori finali
        self.assertGreaterEqual(stats["first_ok"], 38, stats)
        print("  F17: 55 casi, ok primo passaggio=%d, riparati=%d"
              % (stats["first_ok"], stats["repaired"]))

    def test_totale_cento_con_zero_parse_error(self):
        """110 chiamate attraverso il motore reale -> 0 errori finali."""
        falliti = []
        n = 0
        for i in range(55):
            inputs, raw, broken = build_f06(i)
            first = broken if broken is not None else raw
            ok, _, errors = validate_output("F06", first, ctx=inputs)
            if not ok:
                ok, _, errors = validate_output("F06", raw, ctx=inputs)
            n += 1
            if not ok:
                falliti.append(("F06", i, errors))
        for i in range(55):
            inputs, raw, broken = build_f17(i)
            first = broken if broken is not None else raw
            ok, _, errors = validate_output("F17", first, ctx=inputs)
            if not ok:
                ok, _, errors = validate_output("F17", raw, ctx=inputs)
            n += 1
            if not ok:
                falliti.append(("F17", i, errors))
        self.assertGreaterEqual(n, 100)
        self.assertEqual(falliti, [], "parse-error finali: %s" % falliti[:5])
        print("  totale: %d chiamate -> 0 parse-error" % n)


if __name__ == "__main__":
    unittest.main(verbosity=2)
