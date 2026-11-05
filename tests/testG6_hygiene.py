"""Test G6 - IGIENE REGISTRY (round12).

(a) F02 (scelta A: cablata): runFor('F02') in biblioteca.js copre TUTTI i
    placeholder del template + showPreview [Accetta/Scarta]; runtime
    run_ai_function con llm_fn stub produce output che passa
    validate_output (validator deck_doc) con approval_required=True.
(b) reranker placeholder: alias backward-compat RerankerInt8,
    attivazione con log "[Reranker] NON ADDESTRATO — usato ordinamento base",
    nessun crash.
(c) audit zombie F01-F17: almeno un riferimento in web_frontend (Fxx
    citato nei moduli JS) OPPURE core/workers+router+sidecar OPPURE
    backend; altre zombie -> SOLO REPORT (nessun fail: non si rimuovono
    funzioni altrui senza conferma).

Esecuzione: python tests/testG6_hygiene.py
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
    placeholders,
    render_user,
    validate_output,
)
from core.ai_runtime import run_ai_function  # noqa: E402
import core.rag.reranker_int8 as rrmod  # noqa: E402

IDS = ["F%02d" % i for i in range(1, 18)]

BIBLIO_JS = os.path.join(ROOT, "web_frontend", "html", "js",
                         "modules", "biblioteca.js")

_FID_RE = re.compile(r"['\"](F\d{2})['\"]")


def _fids_in(path):
    """fid citati come 'Fxx' o "Fxx" in un file di testo."""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
    except OSError:
        return set()
    return set(_FID_RE.findall(text))


class _NoCache:
    """Cache minimale: nessun hit, nessuna scrittura (test isolato)."""

    def get(self, *args, **kwargs):
        return (None, None, False)

    def put(self, *args, **kwargs):
        return None


# --------------------------------------------------------------------------
# (a) F02 cablata
# --------------------------------------------------------------------------
class TestG6F02Cablata(unittest.TestCase):

    F02_KW = {
        "materia": "Biologia",
        "doc_id": "materiale/demo.md",
        "sezione": "Fotosintesi",
        "n": 2,
        "testo": (
            "La fotosintesi converte la luce in energia chimica. "
            "Le piante producono glucosio nei cloroplasti."
        ),
    }

    def _stub_deck(self, kw):
        """Output deck coerente con grammatica G_deck + validator deck_doc."""
        sents = re.split(r"(?<=[.!?])\s+", kw["testo"].strip())
        cards = []
        for k in range(int(kw["n"])):
            quote = sents[k % len(sents)].strip()
            cards.append({
                "front": "Domanda %d: dove avviene la fotosintesi?" % (k + 1),
                "back": "Nei cloroplasti delle cellule vegetali.",
                "hint": "pensa ai cloroplasti",
                "quote": quote,
                "citations": [{"quote": quote, "source": kw["doc_id"]}],
            })
        return json.dumps({"cards": cards})

    def test_a1_template_render_e_validate(self):
        kw = dict(self.F02_KW)
        entry = get_function("F02")
        self.assertEqual(set(placeholders(entry["user_template"])), set(kw))
        out = render_user("F02", **kw)
        self.assertTrue(out.strip())
        for ph in kw:
            self.assertNotIn("{%s}" % ph, out)
        raw = self._stub_deck(kw)
        ok, parsed, errors = validate_output("F02", raw, ctx=kw)
        self.assertTrue(ok, errors)

    def test_a2_runtime_llm_stub_ok_e_approval(self):
        kw = dict(self.F02_KW)
        raw = self._stub_deck(kw)

        def llm_fn(prompt, max_tokens=None, classe=None, fid=None):
            return raw

        res = run_ai_function("F02", dict(kw), ai_cache=_NoCache(),
                              llm_fn=llm_fn)
        self.assertTrue(res.get("ok"), res)
        self.assertFalse(res.get("fallback"), res)
        self.assertEqual(res.get("fid"), "F02")
        # F02 è nella lista writer di ai_cache -> nessun salvataggio automatico
        self.assertTrue(res.get("approval_required"), res)

    def test_a3_ui_cablate_in_biblioteca(self):
        self.assertTrue(os.path.isfile(BIBLIO_JS), BIBLIO_JS)
        with open(BIBLIO_JS, "r", encoding="utf-8", errors="ignore") as fh:
            src = fh.read()
        i = src.find("'F02'")
        self.assertGreater(i, 0, "F02 non cablata in biblioteca.js")
        region = src[max(0, i - 700):i + 900]
        self.assertIn("runFor", region)
        self.assertIn("showPreview", region)
        for ph in placeholders(get_function("F02")["user_template"]):
            self.assertIn(
                ph, region,
                "placeholder {%s} non passato nella chiamata runFor('F02')" % ph,
            )
        # il pulsante esiste sulla card materiale (rtype 'mat')
        self.assertIn("aiDeckFromMaterial", src)
        self.assertIn("rtype === 'mat'", src)


# --------------------------------------------------------------------------
# (b) reranker placeholder
# --------------------------------------------------------------------------
class TestG6RerankerPlaceholder(unittest.TestCase):

    def test_b1_alias_backward_compat(self):
        self.assertIs(rrmod.RerankerInt8, rrmod.RerankerPlaceholder)
        self.assertFalse(rrmod.TRAINED)
        # import storico usato da core/local_search.py (non toccato)
        from core.rag.reranker_int8 import RerankerInt8, get_reranker
        rr = get_reranker()
        self.assertIsInstance(rr, RerankerInt8)
        self.assertFalse(rr.trained)
        self.assertEqual(rrmod.PLACEHOLDER_NAME, "reranker_placeholder")

    def test_b2_log_non_addestrato_e_no_crash(self):
        with self.assertLogs("core.rag.reranker_int8", level="WARNING") as cm:
            rr = rrmod.get_reranker()
            s = rr.score("fotosintesi clorofilliana",
                         "le piante producono energia")
            self.assertGreaterEqual(s, 0.0)
            idx = rr.rerank("fotosintesi", ["cloroplasti", "mitocondri"],
                            top_k=2)
            self.assertEqual(sorted(idx), [0, 1])
        joined = "\n".join(cm.output)
        self.assertIn("[Reranker]", joined)
        self.assertIn("NON ADDESTRATO", joined)
        self.assertIn("ordinamento base", joined)

    def test_b3_attivazione_via_local_search(self):
        # reranker=True in search -> _apply_reranker costruisce l'istanza
        # -> GUARDIA logga "NON ADDESTRATO" senza crashare.
        from core import local_search
        rows = [
            {"id": 1, "text": "fotosintesi clorofilliana piante"},
            {"id": 2, "text": "riscaldamento globale oceani ghiaccio"},
        ]
        with self.assertLogs("core.rag.reranker_int8", level="WARNING") as cm:
            out = local_search._apply_reranker("fotosintesi", rows, top_n=10)
        self.assertEqual(len(out), 2)
        self.assertIn("NON ADDESTRATO", "\n".join(cm.output))


# --------------------------------------------------------------------------
# (c) audit zombie F01-F17 -> solo report
# --------------------------------------------------------------------------
class TestG6AuditZombie(unittest.TestCase):

    USAGE_ROOTS = [
        ("web_frontend", os.path.join("web_frontend", "html", "js")),
        ("workers", os.path.join("core", "workers")),
        ("router", os.path.join("core", "router")),
        ("sidecar", os.path.join("core", "sidecar")),
        ("backend", "backend"),
    ]

    def test_c_audit_f01_f17(self):
        hits = {fid: [] for fid in IDS}
        for _label, rel in self.USAGE_ROOTS:
            root = os.path.join(ROOT, rel)
            if not os.path.isdir(root):
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d != "__pycache__"]
                for fn in filenames:
                    if not fn.endswith((".js", ".py")):
                        continue
                    p = os.path.join(dirpath, fn)
                    for fid in _fids_in(p) & set(IDS):
                        hits[fid].append(os.path.relpath(p, ROOT))
        zombies = [f for f in IDS if not hits[f]]
        # REPORT (le eventuali altre zombie non fanno fallire il test)
        print("\n[G6] audit F01-F17 -> riferimenti FE/workers/router/"
              "sidecar/backend:")
        for f in IDS:
            refs = sorted(set(hits[f]))
            if refs:
                print("  %s -> %s" % (f, ", ".join(refs[:3])
                                      + ("…" if len(refs) > 3 else "")))
            else:
                print("  %s -> ZOMBIE (solo report)" % f)
        print("[G6] zombie totali: %s" % (zombies or "nessuna"))
        # F02 deve essere cablata (compito 6.1, scelta A)
        self.assertTrue(
            hits["F02"],
            "F02 senza riferimenti in FE/workers: %s" % zombies,
        )
        # soglia di sanità: non ci aspettiamo ondate di zombie nuove
        self.assertLessEqual(
            len(zombies), 4,
            "troppe funzioni zombie rispetto alle attese: %s" % zombies,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
