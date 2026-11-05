"""
tests/testH9_router.py — H9: router 0-LLM (core/ai_router.py).
Esecuzione:  python tests/testH9_router.py   oppure   pytest tests/testH9_router.py
"""

import importlib
import importlib.util
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load(mod_name: str, rel: str):
    try:
        return importlib.import_module(mod_name)
    except Exception:
        spec = importlib.util.spec_from_file_location(
            mod_name.replace(".", "_") + "_direct", ROOT / rel
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod


ai_router = _load("core.ai_router", "core/ai_router.py")
Router0LLM = ai_router.Router0LLM
compose_subqueries = ai_router.compose_subqueries

P95_MS = None  # riempito dal test di latenza, usato dal report qa/


def test_route_shape():
    out = Router0LLM().route("ciao")
    assert {"intent", "subqueries", "reason"} <= set(out.keys())
    assert out["intent"] in ("chat", "rag", "tool", "cache")
    assert isinstance(out["subqueries"], list)
    assert isinstance(out["reason"], str)


def test_rule_a_cache():
    out = Router0LLM().route("qualunque testo qui", cache_hit={"layer": "exact"})
    assert out["intent"] == "cache"


def test_rule_b_fogli_formula():
    r = Router0LLM()
    out = r.route("=SOMMA(A1:A9)", module="fogli")
    assert out["intent"] == "tool"
    assert out["fid"] == "F07"          # formula eseguibile
    out2 = r.route("qual è la formula della media", module="fogli")
    assert out2["intent"] == "tool"
    assert out2["fid"] == "F08"         # descrizione di formula
    # senza modulo fogli non scatta la regola b
    assert r.route("qual è la formula della media")["intent"] != "tool"


def test_rule_c_selection_doc_appunti():
    r = Router0LLM()
    out = r.route("riassumi", has_selection=True)
    assert out["intent"] == "tool" and out["fid"] == "F05"
    out2 = r.route("salva negli appunti", has_selection=True)
    assert out2["intent"] == "tool" and out2["fid"] == "F01"
    # senza selezione la regola c non scatta
    assert r.route("riassumi", has_selection=False)["intent"] == "chat"


def test_rule_d_rag():
    r = Router0LLM()
    out = r.route("che cos'è la mitosi?")
    assert out["intent"] == "rag"
    long_q = "vorrei sapere qualcosa di particolare sulla mia ultima settimana"
    out2 = r.route(long_q)  # 9 parole (>8)
    assert out2["intent"] == "rag"
    assert "9 parole" in out2["reason"]
    assert r.route("perché cade la foglia?")["intent"] == "rag"
    assert r.route("spiega bene il argomento")["intent"] == "rag"


def test_rule_e_comandi():
    r = Router0LLM()
    o1 = r.route("salva come nota la risposta")
    assert o1["intent"] == "tool" and o1["fid"] == "F01"
    o2 = r.route("crea flashcard")
    assert o2["intent"] == "tool" and o2["fid"] == "F12"
    o3 = r.route("pianifica la settimana")
    assert o3["intent"] == "tool" and o3["fid"] == "F10"


def test_rule_f_default_chat():
    out = Router0LLM().route("ciao!")
    assert out["intent"] == "chat"
    assert out["subqueries"] == []


def test_subqueries_decomposizione():
    r = Router0LLM()
    out = r.route("spiega la mitosi e anche la meiosi inoltre confronta le differenze principali")
    assert out["intent"] == "rag"
    subs = out["subqueries"]
    assert 2 <= len(subs) <= 3
    assert all(isinstance(s, str) and s for s in subs)
    # >2 frasi -> complesse -> sub-query
    out2 = r.route("spiega la cellula. descrivi i mitocondri. confronta i ribosomi.")
    assert out2["intent"] == "rag"
    assert 1 <= len(out2["subqueries"]) <= 3
    # query semplice -> nessuna decomposizione
    out3 = r.route("che cos'è la mitosi")
    assert out3["subqueries"] == []


def test_compose_subqueries():
    r = Router0LLM()
    s = r.compose_subqueries(["parte uno", "parte due"])
    assert isinstance(s, str)
    assert "parte uno" in s and "parte due" in s
    assert compose_subqueries([]) == ""


def test_centroidi_finti():
    centroids = {"scienze": {"vector": [1.0, 0.0], "intent": "chat"}}
    q = "vorrei sapere qualcosa di molto particolare sulla tua ultima settimana di lavoro"
    # 12 parole, no keyword, embed_fn + centroidi -> classificazione tema
    r = Router0LLM(embed_fn=lambda t: [1.0, 0.0], centroids=centroids)
    out = r.route(q)
    assert out["intent"] == "chat"
    assert "centroidi" in out["reason"]
    # senza embed_fn -> solo regole, nessun errore -> >8 parole -> rag
    r2 = Router0LLM(centroids=centroids)
    assert r2.route(q)["intent"] == "rag"
    # senza centroidi -> solo regole -> rag
    r3 = Router0LLM(embed_fn=lambda t: [1.0, 0.0])
    assert r3.route(q)["intent"] == "rag"
    # sotto soglia cosine -> si ricade sulle regole
    r4 = Router0LLM(
        embed_fn=lambda t: [0.0, 1.0], centroids=centroids, centroid_threshold=0.5
    )
    assert r4.route(q)["intent"] == "rag"


def test_centroids_path_assente_nessun_errore():
    r = Router0LLM(centroids_path=str(ROOT / "qa" / "centroidi_non_esistono.json"))
    out = r.route("ciao")  # nessun errore, solo regole
    assert out["intent"] == "chat"


def test_p95_sotto_5ms_1000_chiamate():
    global P95_MS
    r = Router0LLM()
    samples = [
        "ciao",
        "che cos'è la mitosi",
        "=SOMMA(A1:A9)",
        "crea flashcard",
        "vorrei sapere qualcosa di particolare sulla mia ultima settimana",
        "pianifica la settimana",
        "salva come nota",
        "spiega la cellula e anche i mitocondri inoltre confronta i ribosomi",
    ]
    times = []
    for i in range(1000):
        t0 = time.perf_counter()
        r.route(
            samples[i % len(samples)],
            has_selection=(i % 5 == 0),
            module=("fogli" if i % 7 == 0 else None),
        )
        times.append((time.perf_counter() - t0) * 1000.0)
    times.sort()
    p95 = times[int(math.ceil(0.95 * len(times))) - 1]
    P95_MS = round(p95, 4)
    print("p95 = %.4f ms su 1000 chiamate" % p95)
    assert p95 < 5.0


def test_nessuna_dipendenza_llm():
    src = Path(ai_router.__file__).read_text(encoding="utf-8")
    for bad in (
        "openai",
        "anthropic",
        "transformers",
        "sentence_transformers",
        "import torch",
        "requests",
        "urllib",
        "httpx",
    ):
        assert bad not in src, "dipendenza LLM/rete trovata: %s" % bad
    # il router funziona senza che alcun modulo LLM sia importato dal modulo
    out = Router0LLM().route("che cos'è la fotosintesi")
    assert out["intent"] == "rag"


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
    if P95_MS is not None:
        print("P95_MS=%s" % P95_MS)
    sys.exit(1 if failed else 0)
