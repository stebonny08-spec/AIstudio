"""Test R22/R23 - Modelli: catalogo pro/base/fallback X6.1 (3 voci con
id/draft/fallback), verifica SHA256/size, fallback al MiniCPM5-2B su
load fallito, persistenza selezione, override sampling pro, guardia RAM
draft e restart sidecar su cambio modello.

Nessun binario di rete richiesto (unittest stdlib).
"""

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import data.models_manager as mm  # noqa: E402
from data.models_manager import (  # noqa: E402
    MODELS_CATALOG,
    ModelsManager,
    apply_fallback_config,
)
from core.sidecar import SidecarClient, SidecarServer  # noqa: E402
from core.sidecar.profiles import (  # noqa: E402
    PRO_SAMPLING_OVERRIDE,
    apply_model_sampling,
    get_profile,
)


# --------------------------------------------------------------- catalogo
class TestCatalogo(unittest.TestCase):

    def test_ordine_dropdown_pro_base_fallback(self):
        # R23 X6.1: 3 voci, ordine del dropdown pro > base > fallback
        self.assertEqual(list(MODELS_CATALOG.keys()),
                         ["pro", "base", "fallback"])

    def test_display_names(self):
        self.assertEqual(MODELS_CATALOG["pro"]["display_name"],
                         "Modello pro (Spark-4B)")
        self.assertEqual(MODELS_CATALOG["base"]["display_name"],
                         "Modello base (Spark-1.7B)")
        self.assertEqual(MODELS_CATALOG["fallback"]["display_name"],
                         "MiniCPM5-2B (fallback)")

    def test_voce_pro_completa(self):
        pro = MODELS_CATALOG["pro"]
        self.assertEqual(pro["id"], "spark-pro-4b")
        self.assertEqual(
            pro["url"],
            "https://huggingface.co/XHToken/Spark-X2.6-4B-GGUF/"
            "resolve/main/Spark-X2.6-4B-Q4_K_M.gguf")
        self.assertEqual(
            pro["sha256"],
            "91cb2811aebb47ac916aa619d27d4cdd7f4143106b7917accb8ead4cd7f5cbd9")
        self.assertEqual(pro["size_bytes"], 3543441312)
        self.assertEqual(pro["filename"], "spark-x2.6-4b.gguf")
        self.assertEqual(pro["dest_path"], "tools/models/spark-x2.6-4b.gguf")
        # R23: draft 1.7B dichiarato (solo metadata, OFF di default X4.2)
        self.assertEqual(pro["draft"], "spark-base-1.7b")

    def test_voce_base_completa(self):
        # R23 X6.1: il base e' ora Spark-1.7B (MiniCPM5-2B e' fallback)
        base = MODELS_CATALOG["base"]
        self.assertEqual(base["id"], "spark-base-1.7b")
        self.assertEqual(
            base["url"],
            "https://huggingface.co/XHToken/Spark-X2.6-1.7B-GGUF/"
            "resolve/main/Spark-X2.6-1.7B-Q4_K_M.gguf")
        self.assertEqual(
            base["sha256"],
            "7abd9859c10924be3c583945456fa9b25d0569484876105a7b7376f7938fffb7")
        self.assertEqual(base["size_bytes"], 1768720512)
        self.assertEqual(base["filename"], "spark-x2.6-1.7b.gguf")
        self.assertEqual(base["dest_path"], "tools/models/spark-x2.6-1.7b.gguf")
        self.assertIsNone(base["draft"])
        self.assertNotIn("fallback", base)

    def test_voce_fallback_completa(self):
        fb = MODELS_CATALOG["fallback"]
        self.assertEqual(fb["id"], "minicpm5-2b")
        self.assertEqual(
            fb["url"],
            "https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/"
            "resolve/main/MiniCPM5-2B-Q4_K_M.gguf")
        self.assertEqual(
            fb["sha256"],
            "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd")
        self.assertEqual(fb["size_bytes"], 1561318368)
        self.assertEqual(fb["filename"], "MiniCPM5-2B-Q4_K_M.gguf")
        self.assertIsNone(fb.get("dest_path"))        # vive in app_data/models
        self.assertEqual(fb["draft"], "minicpm5-1b")   # dichiarato, non in catalog
        self.assertTrue(fb["fallback"])

    def test_list_models_ordine(self):
        out = ModelsManager().list_models()
        self.assertEqual([m["key"] for m in out],
                         ["pro", "base", "fallback"])
        for m in out:
            self.assertIn("size_bytes", m)
            self.assertIn("downloaded", m)
            self.assertIn("id", m)          # R23 X6.1
            self.assertIn("draft", m)       # R23 X6.1
            self.assertIn("fallback", m)    # R23 X6.1

    def test_dest_path_puntato_a_tools_models(self):
        p = ModelsManager()._model_path("pro")
        self.assertEqual(str(p).replace("\\", "/").lower(),
                         os.path.join(ROOT, "tools", "models",
                                      "spark-x2.6-4b.gguf").replace("\\", "/").lower())

    def test_dest_path_base_puntato_a_tools_models(self):
        # R23: il nuovo base (Spark-1.7B) vive accanto al pro
        p = ModelsManager()._model_path("base")
        self.assertEqual(str(p).replace("\\", "/").lower(),
                         os.path.join(ROOT, "tools", "models",
                                      "spark-x2.6-1.7b.gguf").replace("\\", "/").lower())


# --------------------------------------------------- verifica sha256 (R22)
class TestShaVerification(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="r22_sha_")
        self.data = b"spark-x2.6-4b-test-payload"
        self.sha = hashlib.sha256(self.data).hexdigest()
        self.path = os.path.join(self.tmp, "modello_test.gguf")
        with open(self.path, "wb") as f:
            f.write(self.data)
        self._cat = dict(mm.MODELS_CATALOG)
        mm.MODELS_CATALOG["test_r22"] = {
            "display_name": "Test R22",
            "url": "https://example.invalid/m.gguf",
            "filename": "modello_test.gguf",
            "dest_path": self.path,
            "sha256": self.sha,
            "size_bytes": len(self.data),
        }

    def tearDown(self):
        mm.MODELS_CATALOG.clear()
        mm.MODELS_CATALOG.update(self._cat)

    def test_sha_match(self):
        chk = ModelsManager().verify_checksum("test_r22")
        self.assertTrue(chk["ok"], chk)
        self.assertEqual(chk["actual"], self.sha)
        self.assertEqual(chk["expected"], self.sha)

    def test_sha_mismatch(self):
        mm.MODELS_CATALOG["test_r22"]["sha256"] = "0" * 64
        chk = ModelsManager().verify_checksum("test_r22")
        self.assertFalse(chk["ok"])

    def test_download_gia_presente_sha_sbagliato_errore(self):
        mm.MODELS_CATALOG["test_r22"]["sha256"] = "0" * 64
        res = ModelsManager().download("test_r22")
        self.assertFalse(res["success"])
        self.assertIn("Hash", res["error"])

    def test_download_gia_presente_sha_ok(self):
        res = ModelsManager().download("test_r22")
        self.assertTrue(res["success"])
        self.assertTrue(res.get("already_downloaded"))

    def test_checksum_txt_scritto(self):
        ModelsManager().verify_checksum("test_r22")
        txt = os.path.join(self.tmp, "checksum.txt")
        self.assertTrue(os.path.exists(txt))
        with open(txt, encoding="utf-8") as fh:
            body = fh.read()
        self.assertIn(f"sha256={self.sha}", body)
        self.assertIn("verified_at=", body)
        self.assertIn("url=https://example.invalid/m.gguf", body)


# --------------------------------------- fallback al base su load fallito
class _FakeConfig:
    def __init__(self, data=None):
        self.data = dict(data or {})
        self.saved = 0

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value

    def save(self):
        self.saved += 1


class TestFallbackBase(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="r22_fb_")
        # R23 X6: il fallback e' MiniCPM5-2B in <app_data>/models/
        self.fb_path = os.path.join(self.tmp, "MiniCPM5-2B-Q4_K_M.gguf")
        with open(self.fb_path, "wb") as f:
            f.write(b"fallback-model-stub")
        patcher = mock.patch.object(mm, "models_dir",
                                    lambda: __import__("pathlib").Path(self.tmp))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_fallback_aggiorna_config_e_logga(self):
        # R23 X6: fallback = MiniCPM5-2B (voce "fallback"), NON Spark
        cfg = _FakeConfig({"local_model_path": "C:/x/spark-x2.6-4b.gguf",
                           "local_model_key": "pro",
                           "llama.model_path": "C:/x/spark-x2.6-4b.gguf"})
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            out = apply_fallback_config(cfg, "llama-server crash exit 1")
        log = buf.getvalue()
        self.assertIsNotNone(out)
        self.assertEqual(out, self.fb_path)
        self.assertTrue(str(out).endswith("MiniCPM5-2B-Q4_K_M.gguf"))
        self.assertEqual(cfg.data["local_model_path"], self.fb_path)
        self.assertEqual(cfg.data["llama.model_path"], self.fb_path)
        self.assertEqual(cfg.data["local_model_key"], "fallback")
        self.assertGreaterEqual(cfg.saved, 1)
        self.assertIn("[models] fallback al modello MiniCPM5-2B: "
                      "llama-server crash exit 1", log)

    def test_fallback_assente(self):
        os.remove(self.fb_path)
        cfg = _FakeConfig({"local_model_key": "pro"})
        out = apply_fallback_config(cfg, "motivo")
        self.assertIsNone(out)
        self.assertEqual(cfg.data.get("local_model_key"), "pro")
        self.assertEqual(cfg.saved, 0)


# ------------------------------------------- persistenza selezione modello
class TestPersistenzaSelezione(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="r22_cfg_")
        self._old_appdata = os.environ.get("APPDATA")
        os.environ["APPDATA"] = self.tmp

    def tearDown(self):
        if self._old_appdata is None:
            os.environ.pop("APPDATA", None)
        else:
            os.environ["APPDATA"] = self._old_appdata

    def test_selezione_pro_persistita(self):
        from data.config_manager import ConfigManager
        cfg = ConfigManager()
        pro_path = os.path.join(ROOT, "tools", "models", "spark-x2.6-4b.gguf")
        cfg.set("local_model_path", pro_path)
        cfg.set("local_model_key", "pro")
        cfg.set("llama.model_path", pro_path)   # sync sidecar (R22)
        cfg.save()

        cfg2 = ConfigManager()                  # rilettura da disco
        self.assertEqual(cfg2.get("local_model_key"), "pro")
        self.assertEqual(cfg2.get("local_model_path"), pro_path)
        self.assertEqual(cfg2.get("llama.model_path"), pro_path)

        # file config.json contiene le chiavi dichiarate
        with open(os.path.join(self.tmp, "NovaStudio", "config.json"),
                  encoding="utf-8") as fh:
            raw = json.load(fh)
        self.assertEqual(raw["local_model_key"], "pro")


# ------------------------------------------- override sampling pro (card)
class TestSamplingOverridePro(unittest.TestCase):

    def test_override_fast_pro(self):
        prof = get_profile("fast")
        out = apply_model_sampling(prof, "fast", "pro")
        self.assertEqual(out["temp"], 1.0)
        self.assertEqual(out["top_p"], 0.95)
        self.assertEqual(out["top_k"], -1)
        self.assertEqual(out["repetition_penalty"], 1.0)
        # il profilo originale NON viene mutato
        self.assertEqual(prof.get("temp"), 0.8)

    def test_base_invariato(self):
        prof = get_profile("fast")
        out = apply_model_sampling(prof, "fast", "base")
        self.assertEqual(out, prof)
        self.assertEqual(out.get("temp"), 0.8)

    def test_think_tool_invariati_anche_col_pro(self):
        for name in ("think", "tool"):
            prof = get_profile(name)
            out = apply_model_sampling(prof, name, "pro")
            self.assertEqual(out, prof, name)
        # tool resta 0.1 (output JSON) anche con pro attivo
        self.assertEqual(apply_model_sampling(get_profile("tool"),
                                              "tool", "pro")["temp"], 0.1)

    def test_override_valori_card(self):
        self.assertEqual(PRO_SAMPLING_OVERRIDE["temp"], 1.0)
        self.assertEqual(PRO_SAMPLING_OVERRIDE["top_p"], 0.95)
        self.assertEqual(PRO_SAMPLING_OVERRIDE["top_k"], -1)
        self.assertEqual(PRO_SAMPLING_OVERRIDE["repetition_penalty"], 1.0)


# ---------------------------------------------- guardia RAM draft (R22)
class _FakeServer:
    def __init__(self, rss=None):
        self._rss = rss

    def rss_mb(self):
        return self._rss

    def touch_job(self):
        pass


class TestGuardiaRamDraft(unittest.TestCase):

    def _client(self, key, rss):
        fd, path = tempfile.mkstemp(suffix=".gguf")
        os.close(fd)
        self.addCleanup(os.remove, path)
        c = SidecarClient(auto_start=False, spec={
            "spec.draft_model": path,          # draft esistente
            "spec.draft_longform": True,
            "local_model_key": key,
        })
        c._server = _FakeServer(rss)
        return c

    def test_draft_disattivato_budget_superato(self):
        c = self._client("pro", 7000.0)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            got = c.want_draft("think", "think")
        self.assertFalse(got)
        self.assertIn("draft disattivato: budget RAM superato", buf.getvalue())

    def test_draft_ok_sotto_budget(self):
        c = self._client("pro", 3000.0)
        self.assertTrue(c.want_draft("think", "think"))

    def test_base_non_bloccato(self):
        c = self._client("base", 9000.0)
        self.assertTrue(c.want_draft("think", "think"))

    def test_budget_dichiarato_6gb(self):
        self.assertEqual(SidecarClient.DRAFT_RAM_BUDGET_MB, 6144.0)

    def test_draft_model_vuoto_default(self):
        # default R13: spec.draft_model vuoto -> mai draft
        c = SidecarClient(auto_start=False,
                          spec={"local_model_key": "pro"})
        self.assertFalse(c.want_draft("think", "think"))


# --------------------------------- restart sidecar su cambio modello (R22)
class TestSidecarModelSwitch(unittest.TestCase):

    def _server(self, launched, want):
        cfg = {
            "llama.server_path": "",          # relaunch KO voluto (no exe)
            "llama.model_path": want,
            "llama.n_ctx": 4096,
            "llama.idle_unload_sec": 300,
        }
        srv = SidecarServer(config=cfg)
        self.addCleanup(srv.shutdown)
        proc = mock.MagicMock()
        proc.poll.return_value = None
        srv._proc = proc
        srv._state = "up"
        srv._port = 12345
        srv._launched_model = launched
        return srv, proc

    def test_stesso_modello_nessun_restart(self):
        srv, proc = self._server("C:/m/base.gguf", "C:/m/base.gguf")
        ok = srv.start_on_demand()
        self.assertTrue(ok)
        proc.terminate.assert_not_called()

    def test_cambio_modello_restart(self):
        srv, proc = self._server("C:/m/base.gguf", "C:/m/spark-x2.6-4b.gguf")
        ok = srv.start_on_demand()
        self.assertFalse(ok)                      # relaunch senza exe -> down
        proc.terminate.assert_called_once()       # ma il vecchio e' stato stoppato
        self.assertEqual(srv.status()["state"], "down")

    def test_rss_mb_senza_processo_none(self):
        srv = SidecarServer(config={"llama.server_path": "",
                                    "llama.model_path": "x"})
        self.addCleanup(srv.shutdown)
        self.assertIsNone(srv.rss_mb())


if __name__ == "__main__":
    unittest.main(verbosity=2)
