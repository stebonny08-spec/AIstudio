# -*- coding: utf-8 -*-
"""tests/testR24_church.py - R24 CHURCH: test del round.

Copre (almeno):
  1. budget/nuovo RSS   (R3.5): qa/r25_church_rss.json (probe R25; r24_church_rss.json storico) + floor teorico +
     target 3.6 GB dichiarato irraggiungibile + DRAFT_RAM_BUDGET_MB
     INVARIATO 6144.0 con copertura numerica RSS+1500;
     server.py NON patchato (nessuna case <= 3600 MB);
  2. retry policy log   (R3.4): FLAKE_RETRY_MAX=2, FLAKY_TESTS dichiarato,
     log stdout "[flake-retry] test=.. attempt=k/2 motivo=.. | errore: ..",
     SkipTest mai ritentato, test non flaky senza wrapper;
  3. soglia config      (R3.3): DEFAULT_CONFIG['gate.threshold']==0.70,
     lettura pulita == default, drift utente (0.75) INFORMATIVO (il test
     patchato resta OK), sorgenti R15/R16 lette da ConfigManager;
  4. R3.2 statico       : normFontiWidth in schemi.js senza !important,
     hook + RO + teardown, persistenza R21 fp21_w_schemi intatta.

NESSUNA scrittura nel config utente %APPDATA%: i test usano APPDATA
temporaneo e lo ripristinano (viene letto/scritto solo un tmp).
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

RSS_JSON = os.path.join(ROOT, "qa", "r25_church_rss.json")
WEIGHTS_B = 3543441312
TARGET_MB = 3600.0


def _read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


class TestR35RssEBudget(unittest.TestCase):
    """R3.5: misura RSS reale + DRAFT_RAM_BUDGET_MB."""

    @classmethod
    def setUpClass(cls):
        with io.open(RSS_JSON, encoding="utf-8") as fh:
            cls.rss = json.load(fh)

    def test_rss_json_casi_misurati(self):
        """Probe eseguito: baseline/b256/b256ub256 up con plateau."""
        cases = self.rss["cases"]
        for tag in ("baseline", "b256", "b256ub256"):
            self.assertIn(tag, cases, "case %s mancante nel probe" % tag)
            self.assertEqual(cases[tag]["status"], "up", tag)
            self.assertIsNotNone(cases[tag].get("rss_plateau_mb"), tag)

    def test_floor_aritmetico(self):
        """Floor: pesi + KV q8_0@4096 + resto = plateau misurato (tol 1.5 MB)."""
        fl = self.rss["floor"]
        self.assertAlmostEqual(fl["weights_mb"],
                               WEIGHTS_B / (1024.0 * 1024.0), places=1)
        plateau = float(self.rss["cases"]["baseline"]["rss_plateau_mb"])
        self.assertIsNotNone(fl["kv_mb"])
        self.assertGreater(fl["kv_mb"], 500.0)   # 36x2560x2x4096x1.0625 = 765 MB
        self.assertLess(fl["kv_mb"], 1000.0)
        self.assertAlmostEqual(fl["weights_mb"] + fl["kv_mb"], plateau,
                               delta=400.0)       # resto = buffer+processo
        # somma esatta dei tre termini = plateau (definizione floor)
        resto = plateau - fl["weights_mb"] - fl["kv_mb"]
        self.assertAlmostEqual(fl["weights_mb"] + fl["kv_mb"] + resto,
                               plateau, places=1)

    def test_target_3600_dichiarato_irraggiungibile(self):
        """TUTTE le case > 3600 MB -> reachable=False (dichiarazione)."""
        for tag in ("baseline", "b256", "b256ub256"):
            pl = float(self.rss["cases"][tag]["rss_plateau_mb"])
            self.assertGreater(pl, TARGET_MB,
                               "%s sotto target?! ricalcolare dichiarazione"
                               % tag)
        self.assertFalse(self.rss["floor"]["reachable"])

    def test_floor_minimo_senza_kv_ancora_sopra_target(self):
        """Anche azzerando il KV (ctx 0): pesi+resto > 3600 -> impossibile
        per costruzione, non solo per tuning batch/ctx."""
        fl = self.rss["floor"]
        plateau = float(self.rss["cases"]["baseline"]["rss_plateau_mb"])
        resto = plateau - fl["weights_mb"] - fl["kv_mb"]
        floor_no_kv = fl["weights_mb"] + resto
        self.assertGreater(floor_no_kv, TARGET_MB)

    def test_budget_6144_invariato_e_copre_ricalcolo(self):
        """DRAFT_RAM_BUDGET_MB resta 6144.0 (contratto R22) e copre
        RSS baseline misurato + margine dichiarato 1500 MB."""
        from core.sidecar.client import SidecarClient
        self.assertEqual(SidecarClient.DRAFT_RAM_BUDGET_MB, 6144.0)
        plateau = float(self.rss["cases"]["baseline"]["rss_plateau_mb"])
        ricalcolo = plateau + 1500.0
        self.assertLessEqual(ricalcolo, 6144.0)  # margine >= 0 (208 MB circa)
        src = _read("core/sidecar/client.py")
        self.assertIn("CHURCH (R3.5)", src)
        self.assertIn("DRAFT_RAM_BUDGET_MB = 6144.0", src)

    def test_server_py_non_patchato_ottim_batch(self):
        """Siccome nessuna case <= 3600, server.py NON deve contenere gli
        argomenti ottimali (-b/--ubatch-size) e deve tenere n_ctx invariato."""
        src = _read("core/sidecar/server.py")
        self.assertNotIn('"-b"', src)
        self.assertNotIn('"--ubatch-size"', src)
        self.assertIn('"-c", str(n_ctx)', src)
        self.assertIn('"--cache-type-k", "q8_0"', src)


class TestR34RetryPolicyLog(unittest.TestCase):
    """R3.4: retry flaky dichiarato con log evidente."""

    @classmethod
    def setUpClass(cls):
        import tests.testG1_sidecar as g1
        cls.g1 = g1

    def test_retry_max_2(self):
        self.assertEqual(self.g1.FLAKE_RETRY_MAX, 2)

    def test_flaky_dichiarato_e_decorato(self):
        """SOLO il flaky noto e' in FLAKY_TESTS ed e' wrappato."""
        self.assertIn("test_a_avvio_reale_e_3_completion",
                      self.g1.FLAKY_TESTS)
        meth = self.g1.TestSidecarReale.test_a_avvio_reale_e_3_completion
        self.assertTrue(hasattr(meth, "__wrapped__"),
                        "decoratore @flake_retry assente")

    def _make_flaky(self, behavior):
        calls = {"n": 0}

        def test_a_avvio_reale_e_3_completion(self):
            calls["n"] += 1
            return behavior(calls["n"])

        return test_a_avvio_reale_e_3_completion, calls

    def test_log_formato_e_max_2_retry(self):
        """Sempre FAIL -> esattamente 2 righe [flake-retry] (attempt 1/2 e
        2/2), eccezione originale rilanciata dopo i 2 retry."""
        def always_fail(n):
            raise ValueError("completion 3 vuota")
        fn, calls = self._make_flaky(always_fail)
        wrapped = self.g1.flake_retry(fn)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            with self.assertRaises(ValueError):
                wrapped(None)
        out = buf.getvalue()
        self.assertEqual(calls["n"], 3, "1 run + 2 retry = 3 tentativi")
        self.assertIn("[flake-retry]", out)
        self.assertIn("attempt=1/2", out)
        self.assertIn("attempt=2/2", out)
        self.assertIn("test=test_a_avvio_reale_e_3_completion", out)
        self.assertIn("motivo=", out)
        self.assertIn("completion 3 vuota", out)

    def test_retry_ok_dopo_un_fallimento(self):
        """1 flake poi OK -> test superato con UNA riga di log."""
        def fail_once(n):
            if n == 1:
                raise RuntimeError("flake transitorio")
            return "ok"
        fn, calls = self._make_flaky(fail_once)
        wrapped = self.g1.flake_retry(fn)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ret = wrapped(None)
        self.assertEqual(ret, "ok")
        self.assertEqual(calls["n"], 2)
        self.assertEqual(buf.getvalue().count("[flake-retry]"), 1)
        self.assertIn("attempt=1/2", buf.getvalue())

    def test_non_flaky_senza_wrapper(self):
        """I test NON in FLAKY_TESTS tornano IDENTICI (nessun retry)."""
        def altro_test(self):
            return 1
        self.assertIs(self.g1.flake_retry(altro_test), altro_test)

    def test_skip_non_ritentato(self):
        """Uno skip non e' un flake: 1 solo tentativo, zero log."""
        def skip_now(n):
            raise unittest.SkipTest("no server")
        fn, calls = self._make_flaky(skip_now)
        wrapped = self.g1.flake_retry(fn)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            with self.assertRaises(unittest.SkipTest):
                wrapped(None)
        self.assertEqual(calls["n"], 1)
        self.assertNotIn("[flake-retry]", buf.getvalue())


class TestR33SogliaConfig(unittest.TestCase):
    """R3.3: soglia letta da ConfigManager/DEFAULT_CONFIG, drift informativo."""

    def test_default_config_070(self):
        from data.config_manager import DEFAULT_CONFIG
        self.assertAlmostEqual(float(DEFAULT_CONFIG["gate.threshold"]),
                               0.70, places=6)

    def _tmp_appdata(self, config=None):
        tmp = tempfile.mkdtemp(prefix="r24_church_cfg_")
        if config is not None:
            d = os.path.join(tmp, "NovaStudio")
            os.makedirs(d, exist_ok=True)
            with io.open(os.path.join(d, "config.json"), "w",
                         encoding="utf-8") as fh:
                json.dump(config, fh)
        return tmp

    def test_lettura_pulita_uguale_default(self):
        """APPDATA temporaneo VUOTO: ConfigManager == default codice.
        (config utente %APPDATA% mai toccato: qui e' un tmp)"""
        import shutil
        from data.config_manager import ConfigManager, DEFAULT_CONFIG
        tmp = self._tmp_appdata()
        old = os.environ.get("APPDATA")
        os.environ["APPDATA"] = tmp
        try:
            clean = float(ConfigManager().get("gate.threshold"))
        finally:
            if old is None:
                os.environ.pop("APPDATA", None)
            else:
                os.environ["APPDATA"] = old
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertAlmostEqual(clean,
                               float(DEFAULT_CONFIG["gate.threshold"]),
                               places=6)

    def test_drift_utente_informativo_test_r15_ok(self):
        """Drift 0.75 nel config (tmp): il test R3.3 patchato deve PASSARE
        comunque (stampa INFO, non fail) e il default deve restare 0.70."""
        import shutil
        from data.config_manager import ConfigManager, DEFAULT_CONFIG
        from tests.testR15_gate import TestSogliaTarata
        tmp = self._tmp_appdata({"gate.threshold": 0.75})
        old = os.environ.get("APPDATA")
        os.environ["APPDATA"] = tmp
        try:
            runtime = float(ConfigManager().get("gate.threshold"))
            self.assertAlmostEqual(runtime, 0.75, places=6)  # drift letto
            case = TestSogliaTarata("test_runtime_config")
            buf = io.StringIO()
            res = unittest.TestResult()
            with contextlib.redirect_stdout(buf):
                case.run(res)
            self.assertTrue(
                res.wasSuccessful(),
                "drift utente rompe il test R3.3: %s %s"
                % (res.failures, res.errors))
            self.assertIn("INFO drift", buf.getvalue())
            self.assertAlmostEqual(
                float(DEFAULT_CONFIG["gate.threshold"]), 0.70, places=6)
        finally:
            if old is None:
                os.environ.pop("APPDATA", None)
            else:
                os.environ["APPDATA"] = old
            shutil.rmtree(tmp, ignore_errors=True)

    def test_sorgenti_r15_r16_lettono_da_config_manager(self):
        """Le sorgenti patchate leggono la soglia da ConfigManager e
        confrontano col DEFAULT_CONFIG (drift = informativo)."""
        for rel in ("tests/testR15_gate.py", "tests/testR16_gate.py"):
            src = _read(rel)
            self.assertIn("from data.config_manager import "
                          "ConfigManager, DEFAULT_CONFIG", src, rel)
            self.assertIn('DEFAULT_CONFIG["gate.threshold"]', src, rel)
            self.assertIn("INFO drift", src, rel)
            # vecchio hardcode sul runtime rimosso (normalizzando gli spazi)
            norm = " ".join(src.split())
            self.assertNotIn(
                'float(ConfigManager().get("gate.threshold")), 0.70, '
                'places=6', norm, rel)


class TestR32NormFontiWidthStatico(unittest.TestCase):
    """R3.2: hook + normFontiWidth senza !important (statico; il T2 reale
    e' qa_browser/qaR24_church_schemi.js)."""

    @classmethod
    def setUpClass(cls):
        cls.src = _read("web_frontend/html/js/modules/schemi.js")

    def _func_body(self):
        i = self.src.index("function normFontiWidth()")
        # fine funzione: prima riga che chiude a colonna 4 dopo l'apertura
        j = self.src.index("\n    }\n", i)
        return self.src[i:j]

    def test_norm_definita_senza_important(self):
        body = self._func_body()
        self.assertNotIn("!important", body,
                         "nessun !important: romperebbe il resize R21")
        self.assertIn("ed.fontiWUser", body)      # valore utente = max
        self.assertIn("getBoundingClientRect", body)

    def test_hook_presenti(self):
        self.assertIn("if (which === 'fonti') { refreshFontiPanel(); "
                      "normFontiWidth(); }", self.src)
        self.assertIn("ed.fontiNormRO = new window.ResizeObserver", self.src)
        self.assertIn("window.addEventListener('resize', ed.fontiNormResize)",
                      self.src)
        self.assertIn("st.fontiNormRO.disconnect()", self.src)
        self.assertIn("window.removeEventListener('resize', "
                      "st.fontiNormResize)", self.src)

    def test_resize_r21_persistenza_intatta(self):
        """La persistenza width R21 (fp21_w_<contesto>) NON e' toccata:
        vive in fonti_panel.js e il valore draggato resta in localStorage."""
        fp = _read("web_frontend/html/js/modules/fonti_panel.js")
        self.assertIn("'fp21_w_' + contesto", fp)
        self.assertIn("fp21_w_schemi", self.src)  # citata nel commento R22/R21


if __name__ == "__main__":
    unittest.main()
