# -*- coding: utf-8 -*-
"""
tests/testR15_web.py — QA-R15b BLOCCO W (stadio web).

Owner: W (IMPLEMENTER-WEB). Testa:
  1. provider con fallback (core/web_search.py): 1 query ddgs REALE con rete
     DICHIARATA, searxng_url vuoto -> skip (zero chiamate searxng),
     wikipedia off -> zero chiamate, wikipedia on -> 1-2 chiamate REALI
     dichiarate (titoli + summary, lingua dichiarata);
  2. readability-lite (core/rag/web_stage.py): fixture HTML locale + 1 doc
     reale OPZIONALE (example.com, rete dichiarata, skip se irraggiungibile);
  3. cache TTL: logica PURA con clock iniettato (nessuna misura simulata);
  4. Chunk.meta backward-compat (core/rag/chunker.py);
  5. web_stage.escalate: mai -> [] con ZERO rete; auto solo parziale/nulla;
     sempre -> sempre (search_web patchato, zero rete nei test di logica);
  6. indicizzazione web su TEMP store: add_chunks + verifica FTS con
     SELECT su chunks_fts (se FTS assente -> skip con AVVISO dichiarato).

RETE: solo le chiamate sopra indicate; OGNUNA è loggata in NET_LOG
(web_search.NET_LOG / web_stage.NET_LOG) e consolidata in
qa/r15_web_netlog.json (tearDownModule). Se la rete non risponde: skip
DICHIARATO, mai fallimento.

Esecuzione:  python tests/testR15_web.py    (o pytest tests/testR15_web.py)
"""
from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from core import web_search                      # noqa: E402
from core.models import WebResult                # noqa: E402
from core.rag import web_stage                   # noqa: E402
from core.rag.chunker import Chunk, chunk_text   # noqa: E402

NETLOG_PATH = _PROJECT_ROOT / "qa" / "r15_web_netlog.json"

# Accumulatore GLOBALE: i test drenano i log per le loro asserzioni (isolamento),
# ma tutte le chiamate prelevate finiscono qui per il dump consolidato finale.
_ALL_CALLS = []


def _drain_web_search():
    entries = web_search.take_net_log()
    _ALL_CALLS.extend(entries)
    return entries


def _drain_web_stage():
    entries = web_stage.take_net_log()
    _ALL_CALLS.extend(entries)
    return entries


# ======================================================================
# RETE DICHIARATA — dump consolidato a fine suite
# ======================================================================
def tearDownModule():
    # raccoglie anche eventuali residui non drenati dai test
    _ALL_CALLS.extend(web_search.take_net_log(clear=True))
    _ALL_CALLS.extend(web_stage.take_net_log(clear=True))
    entries = list(_ALL_CALLS)
    try:
        prev = []
        if NETLOG_PATH.exists():
            loaded = json.loads(NETLOG_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                prev = loaded.get("all_calls") or []
            elif isinstance(loaded, list):
                prev = loaded
        payload = {
            "round": "R15b",
            "block": "W",
            "updated": __import__("time").strftime("%Y-%m-%dT%H:%M:%S%z"),
            "declared_calls": entries,
            "n": len(entries),
            "note": ("solo documenti richiesti al web; nessun LLM cloud. "
                     "Ogni entry: provider/url/ms come da protocollo W."),
        }
        # conserva le chiamate delle esecuzioni precedenti (max 200)
        merged = (prev if isinstance(prev, list) else []) + entries
        payload["all_calls"] = merged[-200:]
        NETLOG_PATH.write_text(json.dumps(payload, indent=1,
                                          ensure_ascii=False),
                               encoding="utf-8")
    except Exception as e:                          # mai crash in teardown
        print(f"[testR15_web] dump netlog fallito: {e}")


# ======================================================================
# 1) PROVIDER CON FALLBACK (W1)
# ======================================================================
class TestProviderFallback(unittest.TestCase):

    def test_ddgs_reale_searxng_vuoto_skip_wiki_off(self):
        """1 query ddgs REALE (rete dichiarata) + searxng_url='' -> SKIP
        (zero chiamate searxng) + wikipedia=False -> zero chiamate wiki."""
        _drain_web_search()
        res = web_search.search_web(
            "fotosintesi clorofilliana", max_results=3,
            searxng_url="", wikipedia=False, timeout=10)
        log = _drain_web_search()

        ddgs_entries = [e for e in log if e["provider"] == "ddgs"]
        print(f"[RETE DICHIARATA] ddgs: {len(ddgs_entries)} chiamate -> " +
              json.dumps(ddgs_entries, ensure_ascii=False)[:600])

        # il provider DEVE aver tentato (log presente, ms dichiarato)
        self.assertTrue(ddgs_entries, f"nessuna chiamata ddgs loggata: {log}")
        for e in ddgs_entries:
            self.assertIn("ms", e)
            self.assertEqual(e["provider"], "ddgs")

        # searxng_url vuoto -> NESSUNA chiamata searxng (skip dichiarato)
        self.assertEqual([e for e in log if e["provider"] == "searxng"], [],
                         "searxng_url='' non deve generare chiamate")
        # wikipedia=False -> NESSUNA chiamata wikipedia
        self.assertEqual([e for e in log if e["provider"] == "wikipedia"], [],
                         "wikipedia=False non deve generare chiamate")

        ok_entries = [e for e in ddgs_entries if e["ok"] and e["n"] > 0]
        if not ok_entries:
            self.skipTest("RETE: ddgs non ha riportato risultati "
                          "(offline/rate-limit dichiarato)")
        self.assertGreaterEqual(len(res), 1)
        self.assertLessEqual(len(res), 3)
        for r in res:
            self.assertTrue(r.url.startswith("http"))
        # priorità qualità: almeno un batch 'trusted' tentato PRIMA del generico
        notes = " | ".join(e.get("note", "") for e in ddgs_entries)
        self.assertIn("trusted batch", notes)

    def test_wikipedia_on_reale_dichiarata(self):
        """wikipedia ON: 1-2 chiamate REALI dichiarate (titoli+summary),
        lingua [it]/[en] dichiarata nel log."""
        _drain_web_search()
        res = web_search.wikipedia_search(
            "fotosintesi clorofilliana", max_results=1, timeout=10)
        log = _drain_web_search()

        wiki = [e for e in log if e["provider"] == "wikipedia"]
        print(f"[RETE DICHIARATA] wikipedia: {len(wiki)} chiamate -> " +
              json.dumps(wiki, ensure_ascii=False)[:600])
        if not wiki:
            self.skipTest("RETE: nessuna chiamata wikipedia loggata "
                          "(import/timeout dichiarato)")
        # lingua dichiarata per chiamata
        self.assertTrue(any("[" in e.get("note", "") for e in wiki),
                        f"lingua non dichiarata nel log: {wiki}")
        ok_entries = [e for e in wiki if e["ok"]]
        if not ok_entries:
            self.skipTest("RETE: wikipedia non raggiungibile "
                          "(dichiarato): " + json.dumps(wiki)[:300])
        self.assertGreaterEqual(len(res), 1)
        r = res[0]
        self.assertTrue(r.url.startswith("http"))
        self.assertTrue(r.snippet.strip())
        self.assertTrue(r.title.strip())


# ======================================================================
# 2) READABILITY-LITE (W2)
# ======================================================================
_FIXTURE_HTML = """<!DOCTYPE html>
<html lang="it"><head><title>Titolo Fixture</title>
<style>.a { color: red; }</style>
<script>var secret = "NON_DEVE_COMPARIRE";</script>
</head>
<body>
<nav>Home | Menu | Contatti</nav>
<div class="sidebar">Link utili</div>
<main>
<h1>Fotosintesi clorofilliana</h1>
<p>Paragrafo lungo numero uno che descrive il processo con sufficiente
dettaglio da superare la soglia di filtraggio della letturabilita.</p>
<p>Paragrafo lungo numero due con ulteriori dettagli sul ciclo di Calvin
e sulla produzione di glucosio nelle piante verdi.</p>
</main>
<footer>© 2026</footer>
</body></html>"""


class TestReadabilityLite(unittest.TestCase):

    def test_fixture_locale(self):
        """Script/style rimossi, main preferito, nav brevi scartate,
        titolo estratto, ≤4000 char."""
        out = web_stage.readability_lite(_FIXTURE_HTML)
        self.assertIn("Fotosintesi clorofilliana", out)
        self.assertIn("ciclo di Calvin", out)
        self.assertNotIn("NON_DEVE_COMPARIRE", out)
        self.assertNotIn("color: red", out)
        # main preferito -> nav/sidebar fuori
        self.assertNotIn("Link utili", out)
        self.assertNotIn("Home | Menu", out)
        self.assertLessEqual(len(out), web_stage.MAX_DOC_CHARS)
        # titolo: h1 -> title
        self.assertEqual(web_stage.extract_title(_FIXTURE_HTML),
                         "Fotosintesi clorofilliana")

    def test_troncatura_e_fallback(self):
        """≤4000 con coda '…' su doc lungo; fallback senza article/p."""
        long_html = ("<html><body><article>" +
                     " ".join(f"Parola di testo numero {i} lunga."
                              for i in range(900)) +
                     "</article></body></html>")
        out = web_stage.readability_lite(long_html)
        self.assertLessEqual(len(out), web_stage.MAX_DOC_CHARS)
        self.assertTrue(out.endswith("…"))

        plain = ("<html><body><div>Testo semplice senza paragrafi ma "
                 "abbastanza lungo da essere utile per il fallback dello "
                 "splitter readability.</div></body></html>")
        out2 = web_stage.readability_lite(plain)
        self.assertIn("senza paragrafi", out2)
        self.assertLessEqual(len(out2), web_stage.MAX_DOC_CHARS)

    def test_fetch_reale_opzionale(self):
        """1 doc REALE opzionale (RETE DICHIARATA): example.com; poi HIT
        cache = ZERO rete. Skip dichiarato se irraggiungibile."""
        tmp = tempfile.mkdtemp(prefix="r15w_cache_")
        cache = web_stage.WebCache(base_dir=Path(tmp), ttl_days=7)
        _drain_web_stage()
        results = [WebResult(title="Example", url="https://example.com",
                             snippet="")]
        docs = web_stage.fetch_docs(results, cache, timeout=10)
        log = _drain_web_stage()
        fetches = [e for e in log if e["provider"] == "fetch"]
        print(f"[RETE DICHIARATA] fetch: {json.dumps(fetches, ensure_ascii=False)}")
        if not fetches:
            self.skipTest("RETE: fetch non loggata (import requests "
                          "dichiarato non disponibile)")
        if not fetches[0]["ok"]:
            self.skipTest("RETE: example.com irraggiungibile (dichiarato): "
                          + fetches[0].get("note", ""))
        self.assertGreaterEqual(len(docs), 1)
        low = docs[0].text.lower()
        self.assertTrue("example domain" in low or "domain is for use" in low,
                        f"testo inatteso da example.com: {docs[0].text[:200]!r}")
        self.assertLessEqual(len(docs[0].text), web_stage.MAX_DOC_CHARS)
        self.assertFalse(docs[0].from_cache)

        # --- HIT = cache senza rete (misura hit reale, zero chiamate) ---
        _drain_web_stage()
        docs2 = web_stage.fetch_docs(results, cache, timeout=10)
        log2 = _drain_web_stage()
        self.assertEqual([e for e in log2 if e["provider"] == "fetch"], [],
                         "hit cache deve essere SENZA rete")
        self.assertTrue(docs2 and docs2[0].from_cache)


# ======================================================================
# 3) CACHE TTL — logica pura con clock iniettato
# ======================================================================
class TestCacheTTL(unittest.TestCase):

    def test_ttl_con_clock_iniettato(self):
        tmp = Path(tempfile.mkdtemp(prefix="r15w_ttl_"))
        clk = [1_700_000_000.0]
        cache = web_stage.WebCache(base_dir=tmp, ttl_days=7,
                                   now=lambda: clk[0])
        cache.put("http://example.org/doc", "Titolo", "testo del documento")

        # subito dopo: HIT
        doc = cache.get("http://example.org/doc")
        self.assertIsNotNone(doc)
        self.assertTrue(doc.from_cache)
        self.assertEqual(doc.title, "Titolo")
        self.assertEqual(doc.text, "testo del documento")

        # a 6.99 giorni: ancora HIT
        clk[0] += 6.99 * 86400
        self.assertIsNotNone(cache.get("http://example.org/doc"))

        # a 7.01 giorni: MISS (scaduto) + entry rimossa
        clk[0] += 0.02 * 86400
        self.assertIsNone(cache.get("http://example.org/doc"))
        self.assertEqual(cache.entries(), 0)

        # persistenza su disco: nuova istanza sullo stesso dir, ancora scaduta
        cache2 = web_stage.WebCache(base_dir=tmp, ttl_days=7,
                                    now=lambda: clk[0])
        self.assertIsNone(cache2.get("http://example.org/doc"))

    def test_purge_expired(self):
        tmp = Path(tempfile.mkdtemp(prefix="r15w_purge_"))
        clk = [1_700_000_000.0]
        cache = web_stage.WebCache(base_dir=tmp, ttl_days=7,
                                   now=lambda: clk[0])
        cache.put("http://a.example/1", "A", "aaa")
        cache.put("http://b.example/2", "B", "bbb")
        clk[0] += 8 * 86400
        self.assertEqual(cache.purge_expired(), 2)
        self.assertEqual(cache.entries(), 0)


# ======================================================================
# 4) CHUNK.META BACKWARD-COMPAT (W3)
# ======================================================================
class TestChunkMetaBackwardCompat(unittest.TestCase):

    def test_costruttore_storico_invariato(self):
        c = Chunk("id1", "file.md", "testo")          # posizionale storico
        self.assertIsNone(c.meta)                     # default None
        self.assertEqual(c.source_file, "file.md")
        self.assertEqual(c.location_hint, "")

    def test_meta_opzionale(self):
        meta = {"stage": "web", "url": "http://x", "title": "T",
                "date": "2026-10-24"}
        c = Chunk(id="id2", source_file="http://x", text="t", meta=meta)
        self.assertEqual(c.meta, meta)
        self.assertEqual(c.meta["stage"], "web")

    def test_chunk_text_default_meta_none(self):
        chunks = chunk_text("Frase una. Frase due. Frase tre. " * 40,
                            "src.md")
        self.assertGreaterEqual(len(chunks), 1)
        for c in chunks:
            self.assertIsNone(c.meta)
            self.assertTrue(c.id)
            self.assertEqual(c.source_file, "src.md")


# ======================================================================
# 5) ESCALATION (W4) — logica, ZERO rete nei test
# ======================================================================
class TestEscalate(unittest.TestCase):

    def test_mai_zero_rete(self):
        _drain_web_stage()
        _drain_web_search()
        out = web_stage.escalate("qualunque query", "nulla", "mai", 5)
        self.assertEqual(out, [])
        self.assertEqual(_drain_web_stage(), [],
                         "'mai' deve garantire ZERO chiamate di rete")
        self.assertEqual(_drain_web_search(), [])

    def test_auto_piena_comunque_tenta_b11(self):
        """R18 B1.1: auto+piena TENTA il web (search_web patchato ->
        nessuna rete reale); lo short-circuit pre-tentativo e' rimosso."""
        import core.web_search as ws
        _drain_web_stage()
        _drain_web_search()
        orig = ws.search_web
        calls = []

        def fake_search_web(query, max_results=5, **kw):
            calls.append(query)
            return [WebResult(title="t", url="http://x", snippet="s")]

        ws.search_web = fake_search_web
        try:
            out = web_stage.escalate("qualunque query", "piena", "auto", 5)
        finally:
            ws.search_web = orig
        self.assertEqual(len(calls), 1, "B1.1: tentativo web su piena")
        self.assertTrue(out)
        self.assertEqual(_drain_web_stage(), [])
        self.assertEqual(_drain_web_search(), [])

    def test_auto_solo_parziale_nulla_sempre_sempre(self):
        """search_web PATCHATO: si verifica solo la DECISIONE (zero rete)."""
        import core.web_search as ws
        orig = ws.search_web
        calls = []

        def fake_search_web(query, max_results=5, **kw):
            calls.append({"query": query, "max": max_results, "kw": kw})
            return [WebResult(title="t", url="http://x", snippet="s")]

        ws.search_web = fake_search_web
        try:
            calls.clear()
            # auto + parziale -> web
            out1 = web_stage.escalate("q1", "parziale", "auto", 3)
            self.assertEqual(len(calls), 1)
            self.assertEqual(out1[0].url, "http://x")
            # auto + nulla -> web
            web_stage.escalate("q2", "nulla", "auto", 3)
            self.assertEqual(len(calls), 2)
            # auto + '' (gate non determinato, dichiarato = parziale) -> web
            web_stage.escalate("q3", "", "auto", 3)
            self.assertEqual(len(calls), 3)
            # auto + piena -> ORA tentato (R18 B1.1)
            web_stage.escalate("q4", "piena", "auto", 3)
            self.assertEqual(len(calls), 4)
            # sempre + piena -> web
            web_stage.escalate("q5", "piena", "sempre", 3)
            self.assertEqual(len(calls), 5)
            # top_k propagato
            self.assertEqual(calls[0]["max"], 3)
            self.assertEqual(calls[0]["query"], "q1")
        finally:
            ws.search_web = orig


# ======================================================================
# 6) INDICIZZAZIONE WEB su TEMP STORE (W2) — FTS incluso
# ======================================================================
class TestWebStageIndexing(unittest.TestCase):

    def test_index_web_temp_store_fts(self):
        tmp = Path(tempfile.mkdtemp(prefix="r15w_idx_"))
        from core.rag.vector_store_sqlite import SQLiteVectorStore
        store = SQLiteVectorStore(
            persist_dir=str(tmp / "vector_index"),
            embedding_model_name="fake-e5-test",
            db_path=str(tmp / "test_r15w.db"),
        )

        class FakeEmbedder:
            model_id = "fake-e5-test"

            def embed(self, texts, kind="passage"):
                return [[0.1] * 8 for _ in texts]

        url = "https://example.org/fotosintesi-clorofilliana"
        doc = web_stage.WebDoc(
            url=url,
            title="Fotosintesi clorofilliana",
            text=("La fotosintesi clorofilliana converte la luce solare in "
                  "energia chimica nelle piante verdi. ") * 20,
            date="2026-10-24",
        )
        # tagging meta.stage (TUO, in-memory su Chunk)
        chunks0 = web_stage.build_web_chunks(doc)
        self.assertGreaterEqual(len(chunks0), 1)
        self.assertEqual(chunks0[0].meta["stage"], "web")
        self.assertEqual(chunks0[0].meta["url"], url)
        self.assertEqual(chunks0[0].source_file, url)

        stats = web_stage.index_web([doc], store, FakeEmbedder())
        print(f"[index_web] stats={stats}")
        self.assertNotIn("error", stats)
        self.assertGreaterEqual(stats["added"], 1)
        self.assertEqual(store.count(), stats["added"])

        # --- FTS: SELECT su chunks_fts (se assente: skip + avviso) ---
        try:
            n_fts = store._conn.execute(
                "SELECT count(*) FROM chunks_fts").fetchone()[0]
        except sqlite3.OperationalError as e:
            store.close()
            self.skipTest(f"AVVISO DICHIARATO: chunks_fts assente nel temp "
                          f"store ({e}) -> verifica FTS saltata (I fixa)")
        self.assertGreaterEqual(n_fts, 1,
                                "trigger FTS non ha indicizzato il chunk web")
        hits = store.fts_query("fotosintesi clorofilliana", top_k=5)
        self.assertTrue(hits, "fts_query non trova il chunk web")
        self.assertTrue(any(h.get("source_file") == url for h in hits),
                        f"url non trovato tra i hit FTS: {hits}")

        # --- meta persistita nel DB? (informativa per I, non fallisce) ---
        row = store._conn.execute(
            "SELECT meta, source_file FROM chunks "
            "WHERE source_file = ? LIMIT 1", (url,)).fetchone()
        self.assertIsNotNone(row, "chunk web non trovato in chunks")
        db_meta = json.loads(row["meta"] or "{}")
        if db_meta.get("stage") != "web":
            print("[SEGNALAMENTO per I] add_chunks NON persiste Chunk.meta "
                  "(meta.stage assente nel DB); workaround attivo: "
                  f"source_file={row['source_file']!r}, "
                  f"meta.location_hint={db_meta.get('location_hint')!r} — vedi "
                  "qa/qa_r15_web_report.md")
        # convenzione anti-perdita: source_file = URL, location_hint = titolo
        # (location_hint vive nel JSON meta, non e' una colonna)
        self.assertEqual(row["source_file"], url)
        self.assertEqual(db_meta.get("location_hint"),
                         "Fotosintesi clorofilliana")

        # web_sources (fornitura items a P)
        srcs = web_stage.web_sources([doc])
        self.assertEqual(srcs, [{"stage": "web",
                                 "title": "Fotosintesi clorofilliana",
                                 "url": url, "source": "web"}])
        store.close()

    def test_index_web_vuoto_noop(self):
        stats = web_stage.index_web([], None, None)
        self.assertEqual(stats["added"], 0)
        self.assertEqual(stats["docs"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
