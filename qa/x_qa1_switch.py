# -*- coding: utf-8 -*-
"""qa/x_qa1_switch.py — R23 QA-1: switch modello/motore + fallback KILL, sul
percorso REALE dell'app (backend.api.StudioIAAPI con stub webview, wiring di
qa/r16_qa1.py) + core.sidecar reale (X5/X6 del round R23).

WIRED (dichiarato):
- UNA ConfigManager "cfg" creata PRIMA di tutto, engine impostato su cfg E su
  disco PRIMA di creare api (cosi' api.config lo eredita da disco), singleton
  sidecar fissato con get_server(config=cfg) -> il server legge SEMPRE cfg;
  dopo ogni load_model (che scrive su disco con l'istanza api) -> cfg.load()
  rilegge disco -> il sidecar vede llama.model_path aggiornato.
- shutdown() imposta _stop (irreversibile): dopo ogni fermo il singleton viene
  RICREATO con get_server(config=cfg) (istanza fresca, _stop clear).

Fasi:
  S1  engine=xhtoken (X3.4): base -> pro -> base; ogni step: state ready,
      binario FORK (cmdline), modello atteso, completamento reale non vuoto.
  S2  kill XHToken: shutdown + rinomina binario fork -> nuovo singleton ->
      atteso UPSTREAM con status xhtoken_fallback=True (X5.3 binario mancante).
      Ripristino binario.
  S3  kill Spark: engine=auto, spark-x2.6-4b.gguf sostituito da file CORROTTO
      (8KB, size!=0 => get_downloaded_path passa, load REALE fallisce) ->
      atteso fallback MiniCPM5-2B (X6 apply_fallback -> local_model_key=
      'fallback', log [models] fallback al modello MiniCPM5-2B) + generazione.
      Ripristino file con size verificato.
Cleanup: config snapshot ripristinata su DUE istanze + disco, sidecar shutdown,
file/binari ripristinati (verifiche incluse).
Output: qa/x_qa1_switch.json + qa/x_qa1_switch.log
Uso: PYTHONIOENCODING=utf-8 python qa/x_qa1_switch.py
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys
import time
import types
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HF_HUB_OFFLINE", "1")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

OUT = ROOT / "qa" / "x_qa1_switch.json"
LOG = ROOT / "qa" / "x_qa1_switch.log"
FORK_BIN = ROOT / "tools" / "llama-xhtoken" / "build" / "bin" / "llama-server.exe"
FORK_HIDDEN = FORK_BIN.parent / "llama-server.exe.qahide"
SPARK4 = ROOT / "tools" / "models" / "spark-x2.6-4b.gguf"
SPARK4_ORIG = ROOT / "tools" / "models" / "spark-x2.6-4b.gguf.qaorig"
SPARK4_SIZE = 3543441312

_log_buf = io.StringIO()


def log(msg):
    line = str(msg)
    print(line, flush=True)
    _log_buf.write(line + "\n")


def wait_state(api, want, timeout=900):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        with api._model_state_lock:
            st = api._model_state.get("state")
            er = api._model_state.get("error")
            pr = api._model_state.get("progress")
        if st != last:
            log("  [state] %s (progress=%s err=%s)" % (st, pr, er))
            last = st
        if st == want:
            return True, er
        if want != "error" and st == "error":
            return False, er
        time.sleep(1.0)
    return False, "timeout (stato=%s)" % last


def llama_servers():
    import psutil
    out = []
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if "llama-server" in (p.info.get("name") or ""):
                out.append({"pid": p.info["pid"],
                            "cmd": " ".join(p.info.get("cmdline") or [])})
        except Exception:
            pass
    return out


def server_bin():
    for s in llama_servers():
        c = s["cmd"].lower().replace("/", "\\")
        if "llama-xhtoken" in c:
            return "xhtoken", s
        if "llama-server" in c:
            return "upstream", s
    return None, None


def wait_no_llama(timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not llama_servers():
            return True
        time.sleep(0.5)
    return not llama_servers()


def fresh_singleton(cfg):
    """shutdown() + get_server(config=cfg): istanza fresca (_stop clear)."""
    from core.sidecar import server as srv_mod
    srv = srv_mod.get_server()
    srv.shutdown()
    gone = wait_no_llama()
    log("  [sidecar] shutdown ok, nessun llama-server: %s" % gone)
    time.sleep(0.5)
    return srv_mod.get_server(config=cfg)


def gen_ok(tag, loglist):
    from core.sidecar.client import SidecarClient
    t0 = time.time()
    try:
        c = SidecarClient()
        txt = c.complete("Rispondi con una sola frase: qual e' la capitale d'Italia?",
                         profile="fast", classe="micro", max_tokens=40)
        ok = bool(str(txt).strip())
        loglist.append({"tag": tag, "ok": ok, "n": len(str(txt)),
                        "ms": round((time.time() - t0) * 1000),
                        "engine_bin": server_bin()[0]})
        log("  [gen] %s ok=%s len=%d bin=%s" % (tag, ok, len(str(txt)), server_bin()[0]))
        return ok
    except Exception as exc:
        loglist.append({"tag": tag, "ok": False, "error": str(exc)[:300],
                        "engine_bin": server_bin()[0]})
        log("  [gen] %s FAIL %s" % (tag, str(exc)[:200]))
        return False


def main():
    results = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
               "phases": {}, "gen": [], "checks": []}

    def ok(cond, name, extra=""):
        results["checks"].append({"name": name, "ok": bool(cond),
                                  "extra": str(extra)[:300]})
        log(("PASS  " if cond else "FAIL  ") + name + (" | " + str(extra) if extra else ""))
        return bool(cond)

    # ---- stub webview (stesso pattern di qa/r16_qa1.py: API REALE) ----
    if "webview" not in sys.modules:
        wv = types.ModuleType("webview")

        class _FD:
            OPEN = "open"
            SAVE = "save"
        wv.FileDialog = _FD
        wv.windows = []
        wv.create_window = lambda *a, **k: types.SimpleNamespace(
            destroy=lambda: None, shown=False)
        wv.start = lambda *a, **k: None
        sys.modules["webview"] = wv

    from data.config_manager import ConfigManager
    cfg = ConfigManager()
    SNAP_KEYS = ["llama.engine", "local_model_key", "local_model_path",
                 "llama.model_path", "llama.server_path"]
    snapshot = {k: cfg.get(k) for k in SNAP_KEYS}
    log("SNAPSHOT CONFIG: " + json.dumps(snapshot, ensure_ascii=False))

    # engine PRIMA di api e di get_server (tutte le istanze lo ereditano)
    cfg.set("llama.engine", "xhtoken")
    cfg.save()

    # singleton sidecar con LA MIA istanza cfg (prima di qualunque altro uso)
    from core.sidecar import server as srv_mod
    srv = srv_mod.get_server(config=cfg)
    log("Singleton sidecar fissato con istanza cfg (engine=xhtoken su disco)")

    api = None
    try:
        with redirect_stdout(_log_buf):
            from backend.api import StudioIAAPI
            api = StudioIAAPI()
        log("StudioIAAPI ok (backend reale, stub webview)")
        # api.config ha letto disco DOPO la mia scrittura -> ha engine in memoria
        api.config.set("llama.engine", "xhtoken")
        api.config.save()

        # ================= S1: engine xhtoken, base->pro->base =================
        results["phases"]["s1"] = {"engine": "xhtoken"}

        log("--- S1a: load base con engine xhtoken ---")
        r = api.load_model("base")
        ok(r.get("success"), "S1 load_model(base) accettato", r)
        st, er = wait_state(api, "ready")
        ok(st, "S1 base -> ready", er)
        cfg.load()
        ok(gen_ok("S1_base", results["gen"]), "S1 completamento base")
        b0, s0 = server_bin()
        ok(b0 == "xhtoken", "S1 binario FORK per base", s0 and s0["cmd"][:200])

        log("--- S1b: switch al PRO (xhtoken) ---")
        r = api.load_model("pro")
        ok(r.get("success"), "S1 load_model(pro) accettato", r)
        st, er = wait_state(api, "ready")
        ok(st, "S1 pro -> ready", er)
        cfg.load()
        ok(gen_ok("S1_pro", results["gen"]), "S1 completamento pro")
        b1, s1 = server_bin()
        ok(b1 == "xhtoken", "S1 binario FORK per pro", s1 and s1["cmd"][:200])
        ok(s1 and "spark-x2.6-4b" in s1["cmd"], "S1 modello 4B attivo",
           s1 and s1["cmd"][:300])

        log("--- S1c: switch di RITORNO al base ---")
        r = api.load_model("base")
        ok(r.get("success"), "S1 load_model(base) ritorno accettato", r)
        st, er = wait_state(api, "ready")
        ok(st, "S1 base2 -> ready", er)
        cfg.load()
        ok(gen_ok("S1_base2", results["gen"]), "S1 completamento base2")
        b2, s2 = server_bin()
        ok(b2 == "xhtoken", "S1 binario FORK dopo ritorno", s2 and s2["cmd"][:200])
        ok(s2 and "spark-x2.6-1.7b" in s2["cmd"], "S1 modello 1.7B attivo",
           s2 and s2["cmd"][:300])

        # ============ S2: kill XHToken (binario mancante) -> upstream ============
        log("--- S2: kill XHToken (rename binario) -> atteso fallback upstream ---")
        srv = fresh_singleton(cfg)
        FORK_BIN.rename(FORK_HIDDEN)
        results["phases"]["s2"] = {"renamed": str(FORK_BIN),
                                   "engine_cfg": cfg.get("llama.engine")}
        try:
            ok(not FORK_BIN.exists(), "S2 binario fork rinominato")
            ok(gen_ok("S2_dopo_kill", results["gen"]),
               "S2 generazione dopo kill del fork")
            b3, s3 = server_bin()
            ok(b3 == "upstream", "S2 fallback su UPSTREAM", s3 and s3["cmd"][:300])
            stt = srv.status()
            log("  [s2] status=%s" % json.dumps(stt, ensure_ascii=False))
            ok(stt.get("engine") == "upstream",
               "S2 status.engine == upstream", stt.get("engine"))
            ok(bool(stt.get("xhtoken_fallback")),
               "S2 status.xhtoken_fallback == True (X5.3)",
               stt.get("xhtoken_fallback"))
            msg = str(stt.get("message") or "")
            ok(bool(msg), "S2 message utente di ripiego presente", msg[:200])
        finally:
            if FORK_HIDDEN.exists() and not FORK_BIN.exists():
                FORK_HIDDEN.rename(FORK_BIN)
            ok(FORK_BIN.exists(), "S2 ripristino binario fork")

        # ============ S3: kill Spark (gguf corrotto) -> MiniCPM5 ============
        log("--- S3: kill Spark (gguf corrotto) su load pro -> atteso MiniCPM5 ---")
        cfg.set("llama.engine", "auto")
        cfg.save()
        api.config.set("llama.engine", "auto")
        api.config.save()
        srv = fresh_singleton(cfg)
        shutil.copy2(SPARK4, SPARK4_ORIG)
        SPARK4.write_bytes(b"GGUF_CORROTTO_QA_R23_KILL_SPARK" * 256)
        try:
            ok(SPARK4.exists() and 0 < SPARK4.stat().st_size < 100000,
               "S3 spark-4b sostituito da file corrotto (size!=0 per get_downloaded_path)",
               SPARK4.stat().st_size)
            r = api.load_model("pro")
            ok(r.get("success"),
               "S3 load_model(pro) accettato (file presente, caricamento poi fallisce)", r)
            st, er = wait_state(api, "ready", timeout=600)
            # se il fallback non e' partito in tempo utile, aspetta errore+fallback
            if not st:
                st, er = wait_state(api, "ready", timeout=120)
            cfg.load()
            key = cfg.get("local_model_key")
            results["phases"]["s3"] = {"state": st, "error": str(er)[:300],
                                       "local_model_key": key}
            ok(st, "S3 fallback -> ready", er)
            log("  [s3] local_model_key dopo fallback = %s (api=%s)"
                % (key, api.config.get("local_model_key")))
            ok(key == "fallback",
               "S3 chiave modello == 'fallback' (X6 apply_fallback)",
               key or api.config.get("local_model_key"))
            path = cfg.get("local_model_path") or ""
            ok("minicpm" in path.lower(), "S3 modello fallback = MiniCPM5-2B", path)
            ok(gen_ok("S3_minicpm", results["gen"]),
               "S3 generazione con il fallback MiniCPM5-2B")
        finally:
            SPARK4.unlink(missing_ok=True)
            if SPARK4_ORIG.exists():
                shutil.move(str(SPARK4_ORIG), str(SPARK4))
            size_ok = SPARK4.exists() and SPARK4.stat().st_size == SPARK4_SIZE
            ok(size_ok, "S3 ripristino spark-x2.6-4b.gguf (size uguale)",
               SPARK4.stat().st_size if SPARK4.exists() else "missing")

    finally:
        # ---- cleanup: config su DUE istanze + disco, sidecar, file ----
        try:
            if api is not None:
                for k, v in snapshot.items():
                    api.config.set(k, v)
                api.config.save()
        except Exception as exc:
            log("ATTENZIONE ripristino api.config: %s" % exc)
        try:
            for k, v in snapshot.items():
                cfg.set(k, v)
            cfg.save()
        except Exception as exc:
            log("ATTENZIONE ripristino cfg: %s" % exc)
        log("CONFIG finale disco: " + json.dumps(
            {k: ConfigManager().get(k) for k in SNAP_KEYS}, ensure_ascii=False))
        try:
            srv_mod.get_server().shutdown()
        except Exception:
            pass
        try:
            if FORK_HIDDEN.exists() and not FORK_BIN.exists():
                FORK_HIDDEN.rename(FORK_BIN)
        except Exception:
            pass
        try:
            if SPARK4_ORIG.exists():
                SPARK4.unlink(missing_ok=True)
                shutil.move(str(SPARK4_ORIG), str(SPARK4))
        except Exception:
            pass

    results["ok"] = all(c["ok"] for c in results["checks"])
    results["n_pass"] = sum(1 for c in results["checks"] if c["ok"])
    results["n_fail"] = sum(1 for c in results["checks"] if not c["ok"])
    OUT.write_text(json.dumps(results, indent=1, ensure_ascii=False),
                   encoding="utf-8")
    LOG.write_text(_log_buf.getvalue(), encoding="utf-8")
    print("RISULTATO QA-1: %d passati, %d falliti -> %s"
          % (results["n_pass"], results["n_fail"],
             "PASS" if results["ok"] else "FAIL"))
    return 0 if results["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
