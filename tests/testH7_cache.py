"""
tests/testH7_cache.py — H7: cache a 3 strati (core/ai_cache.py).
Esecuzione:  python tests/testH7_cache.py   oppure   pytest tests/testH7_cache.py
"""

import importlib
import importlib.util
import inspect
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load(mod_name: str, rel: str):
    """Importa il modulo; se il package 'core' e' in costruzione (init
    rotto), cade su un caricamento diretto da file."""
    try:
        return importlib.import_module(mod_name)
    except Exception:
        spec = importlib.util.spec_from_file_location(
            mod_name.replace(".", "_") + "_direct", ROOT / rel
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod


ai_cache = _load("core.ai_cache", "core/ai_cache.py")
AiCache = ai_cache.AiCache
cache_key = ai_cache.cache_key
provenance_badge = ai_cache.provenance_badge
approval_required = ai_cache.approval_required
WRITING_FIDS = ai_cache.WRITING_FIDS
NON_WRITING_FIDS = ai_cache.NON_WRITING_FIDS


def _vec_for(sim: float):
    """Vettore unitario che ha cosine = `sim` con [1, 0]."""
    th = math.acos(max(-1.0, min(1.0, float(sim))))
    return [math.cos(th), math.sin(th)]


def test_exact_hit():
    c = AiCache()
    key = c.put("F03", "Che cos'è la mitosi??", "RISPOSTA-ESATTA")
    layer, value, rev = c.get("F03", "  CHE cos'è   la mitosi??  ")  # solo case/spazi
    assert layer == "exact"
    assert value == "RISPOSTA-ESATTA"
    assert rev is False
    assert key == cache_key("F03", "Che cos'è la mitosi??")


def test_miss():
    c = AiCache()
    layer, value, rev = c.get("F03", "domanda mai vista")
    assert layer is None
    assert value is None
    assert rev is False


def test_semantic_delta_miss():
    def fake_embed(text):
        return [1.0, 0.0]

    c = AiCache(embed_fn=fake_embed)
    c.put("F03", "spiega la fotosintesi clorofilliana", "RISP")
    # 0.95 >= 0.92 -> hit semantico
    l1, v1, r1 = c.get("F03", "spiega la respirazione cellulare", embedding=_vec_for(0.95))
    assert (l1, v1, r1) == ("semantic", "RISP", False)
    # 0.85 in [0.80, 0.92) -> delta-reuse con needs_revision
    l2, v2, r2 = c.get("F03", "spiega il ciclo di krebs", embedding=_vec_for(0.85))
    assert (l2, v2, r2) == ("delta", "RISP", True)
    # 0.70 < 0.80 -> miss
    l3, v3, r3 = c.get("F03", "racconta una barzelletta", embedding=_vec_for(0.70))
    assert l3 is None and v3 is None and r3 is False


def test_layer2_inert_without_embed_fn():
    c = AiCache()  # embed_fn=None -> strato 2/3 inerte
    c.put("F03", "domanda A", "R")
    l, v, r = c.get("F03", "domanda B", embedding=_vec_for(0.99))
    assert l is None and v is None and r is False
    l2, v2, _ = c.get("F03", "domanda A")  # la esatta funziona comunque
    assert l2 == "exact" and v2 == "R"
    assert c.stats()["layer2_active"] is False


def test_meta_provenance():
    c = AiCache()
    c.put("F04", "qual è il teorema di pitagora", "V")
    layer, value, rev, meta = c.get_with_meta("F04", "qual è il teorema di pitagora")
    assert {"layer", "source_key", "ts"} <= set(meta.keys())
    assert meta["layer"] == "exact"
    assert meta["source_key"] == cache_key("F04", "qual è il teorema di pitagora")
    assert c.last_meta == meta
    # miss -> meta None
    _, _, _, meta_miss = c.get_with_meta("F04", "mai vista")
    assert meta_miss is None


def test_invalidate_docs():
    c = AiCache()
    c.put("F03", "sintesi clorofilliana spiegata bene", "V1", doc_ids=["doc-17"])
    assert c.get("F03", "sintesi clorofilliana spiegata bene")[0] == "exact"
    n = c.invalidate_docs(["doc-17"])
    assert n == 1
    assert c.get("F03", "sintesi clorofilliana spiegata bene")[0] is None


def test_register_doc_version_invalida_su_bump():
    c = AiCache()
    c.register_doc_version("doc-9", "v1")
    c.put("F03", "analisi del testo di gabbiano", "OLD", doc_ids=["doc-9"])
    assert c.get("F03", "analisi del testo di gabbiano")[0] == "exact"
    c.register_doc_version("doc-9", "v2")  # versione cambia -> stale
    assert c.get("F03", "analisi del testo di gabbiano")[0] is None
    # stessa versione: nessuna invalidazione
    c.put("F03", "analisi del testo di gabbiano", "NEW", doc_ids=["doc-9"])
    c.register_doc_version("doc-9", "v2")
    assert c.get("F03", "analisi del testo di gabbiano")[1] == "NEW"


def test_invalidate_negative():
    c = AiCache()
    key = c.put("F03", "risposta brutta", "SBAGLIATA")
    assert c.get("F03", "risposta brutta")[0] == "exact"
    assert c.invalidate_negative(key) is True
    assert c.get("F03", "risposta brutta")[0] is None
    assert c.invalidate_negative(key) is False  # gia' rimossa
    # accetta anche la coppia (fid, prompt)
    k2 = c.put("F03", "altra risposta brutta", "X")
    assert c.invalidate_negative(("F03", "altra risposta brutta")) is True
    assert k2 == cache_key("F03", "altra risposta brutta")


def test_badge_strings():
    assert provenance_badge("exact") == "cache esatta"
    assert provenance_badge("semantic") == "cache semantica 92%"
    assert provenance_badge("delta") == "bozza da cache (da revisionare)"
    assert provenance_badge(None) == "generato da AI"
    assert provenance_badge("esatta") == "cache esatta"  # alias IT


def test_approval_required():
    writing = ("F01", "F02", "F05", "F06", "F08", "F09", "F10", "F12", "F13", "F14", "F17")
    reading = ("F03", "F04", "F07", "F11", "F15", "F16")
    assert all(approval_required(f) is True for f in writing)
    assert all(approval_required(f) is False for f in reading)
    assert set(writing) == set(WRITING_FIDS)
    assert set(reading) == set(NON_WRITING_FIDS)
    assert approval_required("F99") is True  # sconosciuto -> conservativo


def test_lru_cap():
    c = AiCache(max_entries=5)
    for i in range(6):
        c.put("F03", "domanda numero %d" % i, "v%d" % i)
    assert len(c) == 5
    assert c.get("F03", "domanda numero 0")[0] is None   # evict piu' vecchia
    assert c.get("F03", "domanda numero 5")[0] == "exact"  # piu' recente


def test_get_no_side_effect_e_put_non_scrive():
    c = AiCache()
    c.put("F03", "domanda stabile", "VALORE")
    n_before = len(c)
    r1 = c.get("F03", "domanda stabile")
    r2 = c.get("F03", "domanda stabile")
    assert r1 == r2 == ("exact", "VALORE", False)
    # una miss non inserisce nulla
    c.get("F03", "mai vista prima")
    assert len(c) == n_before
    # il valore non viene mutato in-place
    assert c.get("F03", "domanda stabile")[1] == "VALORE"
    # nessuna scrittura dati: il modulo non tocca sqlite/db/embedder
    src = inspect.getsource(ai_cache)
    assert "sqlite3" not in src
    assert "import data" not in src
    assert "core.rag" not in src
    assert "open(" not in src


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print("PASS %s" % name)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL %s: %r" % (name, e))
    total = len(tests)
    print("RESULT %d/%d test funzioni" % (total - failed, total))
    sys.exit(1 if failed else 0)
