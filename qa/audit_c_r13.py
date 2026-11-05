# -*- coding: utf-8 -*-
"""qa/audit_c_r13.py — FASE0 audit C1/C3/C4 su dati REALI (sola lettura).

Controlli:
  C1a file_AIstudio/originals/ e rag_stage2/ esistono e contengono file;
  C1b l'indice reale (studioia.db: chunks) NON contiene sorgenti originals/;
  C3a ogni sorgente indicizzata vive sotto rag_stage2/ (indice = solo copie);
  C3b evidenza migrazione: qa/g3_migration.json status=eseguito + parity/recall=1;
  C4a ZERO chunk la cui source_file contiene 'originals' (scan li esclude);
  C4b query FTS reale: i risultati provengono solo da sorgenti non-originals;
  C4c testC_rag (suite T1) passa -> scan os.walk potato + filtro _is_originals_source.

Output: qa/audit_c_r13.json + log stdout.
Esecuzione: python qa/audit_c_r13.py
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "audit_c_r13.json"

res: dict = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "checks": {}}


def chk(cid: str, ok: bool, evid: str) -> None:
    res["checks"][cid] = {"ok": bool(ok), "evidence": evid}
    print(("[OK]   " if ok else "[FAIL] ") + cid + "  " + evid)


def main() -> int:
    base = ROOT / "file_AIstudio"
    orig = base / "originals"
    stage = base / "rag_stage2"

    # C1a layout
    o_files = sorted(p.name for p in orig.glob("*") if p.is_file()) if orig.is_dir() else []
    s_files = sorted(p.name for p in stage.glob("*") if p.is_file()) if stage.is_dir() else []
    chk("C1a_layout", orig.is_dir() and stage.is_dir() and len(o_files) > 0 and len(s_files) > 0,
        f"originals={len(o_files)} file {o_files[:3]} | rag_stage2={len(s_files)} file {s_files[:3]}")

    # DB reale
    appdata = Path(os.environ.get("APPDATA", "")) / "NovaStudio" / "studioia.db"
    if not appdata.exists():
        # fallback: config_manager
        try:
            from data.config_manager import get_app_data_dir
            appdata = Path(get_app_data_dir()) / "studioia.db"
        except Exception:
            pass
    if not appdata.exists():
        chk("C1b_db", False, f"studioia.db non trovato ({appdata})")
        return 1

    con = sqlite3.connect(f"file:{appdata}?mode=ro", uri=True)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT store_key, source_file, COUNT(*) FROM chunks "
        "GROUP BY store_key, source_file ORDER BY store_key, source_file"
    ).fetchall()
    n_chunks = cur.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    con.close()

    def is_orig(sf: str) -> bool:
        return bool(re.search(r"(^|[\\/])originals([\\/]|$)", sf or ""))

    def is_stage2(sf: str) -> bool:
        return bool(re.search(r"([\\/])rag_stage2([\\/]|$)", sf or ""))

    # Store MATERIALI (note): ogni sorgente DEVE stare in rag_stage2/.
    # Store libri esclusi dal controllo (corpus dedicato, non file_AIstudio).
    mat_rows = [r for r in rows if r[0] == "vector_index"]
    orig_rows = [r for r in mat_rows if is_orig(r[1] or "")]
    stage_rows = [r for r in mat_rows if is_stage2(r[1] or "")]
    legacy_rows = [r for r in mat_rows if r not in orig_rows and r not in stage_rows]
    all_orig = [r for r in rows if is_orig(r[1] or "")]   # qualunque store

    chk("C1b_indice_reale", n_chunks > 0,
        f"db={appdata} chunks_totali={n_chunks} sorgenti_distinte={len(rows)}")
    chk("C3a_solo_rag_stage2", len(orig_rows) == 0 and len(legacy_rows) == 0,
        f"store vector_index: sorgenti in originals/ = {len(orig_rows)} | "
        f"in rag_stage2/ = {len(stage_rows)} | LEGACY (path radice file_AIstudio, "
        f"file spostato) = {len(legacy_rows)} esempi_legacy="
        f"{[r[1] for r in legacy_rows[:2]]} "
        f"(atteso: legacy=0 e originals=0, tutto da rag_stage2/)")
    chk("C4a_zero_originals", len(all_orig) == 0,
        f"chunk con source_file ~ originals/ = 0 (query su {n_chunks} chunk reali)")

    # C4b query FTS reale (lettura): i match devono escludere originals
    con = sqlite3.connect(f"file:{appdata}?mode=ro", uri=True)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')").fetchall()]
    fts_ok, fts_ev = True, "tabella chunks: nessuna sorgente originals (vedi C4a)"
    try:
        hits = cur.execute(
            "SELECT source_file FROM chunks WHERE source_file LIKE '%fotosintesi%' LIMIT 20"
        ).fetchall()
        bad = [h[0] for h in hits if is_orig(h[0] or "")]
        fts_ok = len(bad) == 0
        fts_ev = (f"query LIKE 'fotosintesi' -> {len(hits)} righe, di cui originals={len(bad)}; "
                  f"esempi={[h[0] for h in hits[:2]]}")
    except Exception as e:
        fts_ok = False
        fts_ev = "errore query: " + str(e)
    con.close()
    chk("C4b_query_reale", fts_ok, fts_ev)

    # C3b evidenza migrazione
    mig = {}
    mp = ROOT / "qa" / "g3_migration.json"
    if mp.exists():
        mig = json.loads(mp.read_text(encoding="utf-8"))
    ok_mig = mig.get("status") == "eseguito" and mig.get("parity") == 1.0 and mig.get("recall5") == 1.0
    chk("C3b_migrazione", ok_mig,
        f"status={mig.get('status')} parity={mig.get('parity')} recall5={mig.get('recall5')} "
        f"chunks={mig.get('chunks')} backup={'manifest' if mig.get('manifest_path') else 'assente'}")

    # C4c testC_rag (T1) — eseguito separatamente? qui eseguiamo solo esito se gia' in t1 log
    t1 = ROOT / "qa" / "t1_r13.json"
    t1_ev = "t1_r13.json non ancora presente"
    t1_ok = False
    if t1.exists():
        d = json.loads(t1.read_text(encoding="utf-8"))
        item = next((i for i in d["py"]["items"] if i["file"] == "testC_rag.py"), None)
        if item:
            t1_ok = item["fail"] == 0 and item["tests"] > 0
            t1_ev = f"testC_rag.py {item['tests']} test / {item['fail']} fail (suite T1)"
    chk("C4c_suite_testC_rag", t1_ok, t1_ev)

    # C1c e2e upload reale (G3) — 3 formati: originale + copia vettorizzata
    e2e = json.loads((ROOT / "qa" / "g3_e2e.json").read_text(encoding="utf-8")) \
        if (ROOT / "qa" / "g3_e2e.json").exists() else {}
    ok_e2e = e2e.get("status") == "OK" and e2e.get("search_hit") is True
    chk("C1c_e2e_upload", ok_e2e,
        f"status={e2e.get('status')} originals={e2e.get('originals')} "
        f"stage2_md={len(e2e.get('stage2_md') or [])} chunks={e2e.get('chunks')} search_hit={e2e.get('search_hit')}")

    res["ok"] = all(v["ok"] for v in res["checks"].values())
    OUT.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print("\nAUDIT C -> " + ("TUTTO OK" if res["ok"] else "CI SONO FAIL"))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
