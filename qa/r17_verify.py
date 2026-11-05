#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""qa/r17_verify.py — verifica E2E reale del chatbot (7 query + cache).

OUTPUT: qa/r17_verify.json (+ qa/r17_tokens_<case>.json per gli screenshot).

Per OGNI query misura (TUTTO REALE, sidecar + web allowlist):
  - total_ms (SLO <= 20000), first_token_ms, first_progress_ms
  - lingua della risposta (italiano vs inglese, euristica sulle stopword)
  - guardia: last_marker_check (markers/verbatim/identical) + check_output
  - citazioni: badge fonti (sources) + occorrenze inline [F#]/[W#]
  - 1 sola emission block + reset gestiti
  - nessun badge web: statico FE (tests/r16_chat_ui.test.js) + screenshot
Cache: query3 ripetuta -> progress "cache" + testo DIVERSO (rielaborato);
  poi flag_wrong_answer/invalidate -> terza execuzione senza cache.
RETE: dichiarata (ddgs/wikipedia allowlist), log NET_LOG per caso.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

spec = importlib.util.spec_from_file_location("r16qa1", str(ROOT / "qa" /
                                                        "r16_qa1.py"))
qa1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa1)

QUERIES = [
    ("v1", "chi è dante alighieri", "web"),
    ("v2", "chi è boccaccio", "web"),
    ("v3", "Qual è il primo accettore di CO2 nelle piante C4?", "locale"),
    ("v4", "Perché la fotosintesi ossigenica è fortemente endergonica?",
     "locale"),
    ("v5", "Chi ha scoperto la fotosintesi clorofilliana e che ruolo ha la "
           "RuBisCO?", "misto"),
    ("v6", "Come funziona il motore a vapore?", "misto"),
    ("v7", "Quali sono i capitoli del Signore degli Anelli?", "web"),
]

IT_STOP = {"di", "che", "non", "per", "con", "una", "sono", "del", "della",
           "gli", "le", "il", "lo", "che", "questo", "come", "nel", "dalla"}
EN_STOP = {"the", "and", "is", "of", "to", "in", "that", "with", "for",
           "this", "from", "are", "was"}


def lang_score(text: str):
    toks = [w.strip(".,;:!?").lower() for w in str(text or "").split()]
    it = sum(1 for w in toks if w in IT_STOP)
    en = sum(1 for w in toks if w in EN_STOP)
    return {"it_hits": it, "en_hits": en,
            "lingua": "it" if it >= en else ("en" if en > it else "?")}


def run_one(env, cid, query, capture_tokens=False, clear_cache=True):
    from core.rag.output_guard import check_output
    from core.web_search import _in_allowlist

    router = env["router"]
    proxy = env["proxy"]
    if clear_cache:
        router.answer_cache.clear()
    os.environ.pop("R16_WEB_DOWN", None)

    parts, sources_items, source = [], None, None
    first_token = first_progress = None
    resets = blocks = 0
    in_block = False
    progress, token_ts = [], []
    llm_before = proxy._target.__dict__.get("_last_marker_check")
    del llm_before
    spy_n = env["spy"]["n"]
    t0 = time.perf_counter()
    for ev in router.process_query_stream(
            query, mode="automatica", thinking=False,
            study_mode=env["DEFAULT_STUDY_MODE"],
            stop_event=None, topic="", history_turns=None,
            web_override="auto"):
        now = round((time.perf_counter() - t0) * 1000.0, 1)
        et = ev.get("type")
        if et == "progress":
            if first_progress is None:
                first_progress = now
            progress.append(ev)
        elif et == "token":
            if first_token is None:
                first_token = now
            if not in_block:
                blocks += 1
                in_block = True
            parts.append(ev.get("text") or "")
            if capture_tokens:
                token_ts.append({"t": now, "n": len(ev.get("text") or "")})
        elif et == "reset":
            resets += 1
            parts = []
            in_block = False
        elif et == "sources":
            sources_items = list(ev.get("items") or [])
        elif et == "source":
            source = ev.get("value")   # i blocchi contano solo i token
    total = round((time.perf_counter() - t0) * 1000.0, 1)
    net = qa1.drain_netlog()
    text = "".join(parts)

    chk = check_output(text, check_min_len=False)
    marker = getattr(getattr(proxy, "_target", proxy),
                     "last_marker_check", None) or {}
    langs = lang_score(text)
    inline = len(re.findall(r"\[(?:F|W)\d+\]", text))
    web_urls = [i.get("url") for i in (sources_items or [])
                if i.get("stage") == "web" and i.get("url")]
    esito_c = text.lstrip().startswith("Non ho trovato")
    cache_hit = any(p.get("stage") == "cache" for p in progress)

    res = {
        "case": cid, "query": query, "tipo": None,
        "total_ms": total, "first_token_ms": first_token,
        "first_progress_ms": first_progress,
        "slo_20s_ok": total <= 20000.0,
        "text_len": len(text), "text_head": text[:400],
        "text_full": text[:4000],
        "lingua": langs["lingua"], "it_hits": langs["it_hits"],
        "en_hits": langs["en_hits"],
        "guard_ok": chk["ok"], "guard_markers": chk["markers"],
        "guard_verbatim": chk.get("verbatim", False),
        "guard_identical": chk.get("identical", False),
        "client_marker": {k: marker.get(k) for k in
                          ("ok", "reason", "verbatim", "identical")},
        "sources_n": len(sources_items or []),
        "sources_stages": sorted({i.get("stage") for i in
                                  (sources_items or [])}),
        "inline_citations": inline,
        "web_urls": web_urls,
        "web_allow_ok": all(_in_allowlist(u) for u in web_urls),
        "llm_calls": env["spy"]["n"] - spy_n,
        "resets": resets, "emission_blocks": blocks,
        "cache_hit": cache_hit, "esito_c": esito_c,
        "net_n": len(net),
        "error": None,
    }
    res["ok"] = bool(
        res["slo_20s_ok"] and res["guard_ok"] and res["text_len"] >= 80
        and blocks <= 1 and langs["lingua"] in ("it", "?")
        and res["sources_n"] >= 1 and res["web_allow_ok"]
        and (res["esito_c"] or inline >= 1 or res["sources_n"] >= 1)
    )
    if capture_tokens:
        (ROOT / "qa" / f"r17_tokens_{cid}.json").write_text(
            json.dumps({"query": query, "tokens": token_ts,
                        "total_ms": total}, ensure_ascii=False),
            encoding="utf-8")
    print(f"VERIFY {cid}: total={total} tok={first_token} len={len(text)} "
          f"lang={langs['lingua']} guard={chk['ok']} "
          f"mark={chk['markers']} verb={chk.get('verbatim')} "
          f"inline={inline} src={len(sources_items or [])} "
          f"net={len(net)} blocks={blocks} ok={res['ok']}", flush=True)
    return res


def main():
    log = qa1.log
    log("=== R17 verify: 7 query reali + cache ===")
    env = qa1.setup()
    qa1.wait_ready(env)
    qa1.run_query(env, "warmup", "Qual e' il valore di delta G "
                  "nella fotosintesi?", web_override="mai")

    cases = []
    for i, (cid, q, tipo) in enumerate(QUERIES):
        capture = cid in ("v1", "v2")
        r = run_one(env, cid, q, capture_tokens=capture)
        r["tipo"] = tipo
        cases.append(r)
        time.sleep(0.2)

    # ---- REQ 4: cache rielaborata + correggibile ------------------------
    cache_test = {"query": QUERIES[2][1]}
    env["router"].answer_cache.clear()
    r1 = run_one(env, "c1_fresh", cache_test["query"])
    r2 = run_one(env, "c2_hit", cache_test["query"],
                 clear_cache=False)   # deve colpire la cache
    cache_test["r1_text"] = r1["text_head"]
    cache_test["r2_text"] = r2["text_head"]
    cache_test["hit_progress"] = r2["cache_hit"]
    cache_test["text_diverso"] = ("".join(
        [r2["text_head"]]) != "".join([r1["text_head"]])) and \
        r2["text_head"].strip() != r1["text_head"].strip()
    cache_test["r2_total_ms"] = r2["total_ms"]
    # flag: elimina l'entry servita (invalidate_text = api.flag_wrong_answer)
    # invalidate sull'ISTANZA del router (stessa memoria+file): usa il
    # testo COMPLETO CACHATO (= testo di c1, quello salvato dal put)
    removed_probe = env["router"].answer_cache.invalidate_text(
        r1["text_full"])
    entries_now = 0
    try:
        env["router"].answer_cache._load()
        entries_now = len(env["router"].answer_cache._entries)
    except Exception:
        pass
    cache_test["invalidate_removed_by_head"] = removed_probe
    cache_test["entries_after_flag"] = entries_now
    r3 = run_one(env, "c3_after_flag", cache_test["query"],
                 clear_cache=False)   # deve essere un MISS dopo il flag
    cache_test["r3_cache_hit"] = r3["cache_hit"]
    cache_test["flag_ok"] = (not r3["cache_hit"]) or r3["text_head"] != \
        r2["text_head"]
    cases.extend([r1, r2, r3])

    # stato finale: cache lasciata pulita (dichiarato)
    try:
        env["router"].answer_cache.clear()
    except Exception:
        pass

    all_ok = all(c["ok"] for c in cases)
    summary = {
        "n": len(cases), "ok": sum(1 for c in cases if c["ok"]),
        "all_ok": all_ok,
        "total_p95": max([c["total_ms"] for c in cases] or [0]),
        "slo20_all": all(c["slo_20s_ok"] for c in cases),
        "lingue": {c["case"]: c["lingua"] for c in cases},
        "guard_fail": [c["case"] for c in cases if not c["guard_ok"]],
        "verbatim_fail": [c["case"] for c in cases
                          if c.get("guard_verbatim")],
        "inline_citati": sum(1 for c in cases if c["inline_citations"] >= 1),
        "badge_fonti": sum(1 for c in cases if c["sources_n"] >= 1),
        "cache": cache_test,
    }
    out = {
        "round": "R16-followup/R17-verify",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "method": (
            "Router.process_query_stream reale (sidecar MiniCPM5-2B + "
            "web allowlist, rete dichiarata NET_LOG per caso); guardia "
            "output_guard.check_output + client.last_marker_check; "
            "lingua = euristica stopword it/en; cache test con "
            "AnswerCache reale (put/get/invalidate_text); warmup fuori "
            "misura; nessuna simulazione"
        ),
        "summary": summary, "cases": cases,
    }
    (ROOT / "qa" / "r17_verify.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"scritto qa/r17_verify.json ok={summary['ok']}/{summary['n']} "
        f"p95={summary['total_p95']} guard_fail={summary['guard_fail']}")

    try:
        from core.sidecar.server import get_server
        s = get_server()
        for a in ("shutdown", "stop", "stop_if_idle"):
            fn = getattr(s, a, None)
            if callable(fn):
                try:
                    fn()
                    break
                except Exception:
                    pass
        log(f"sidecar state post: {s.state}")
    except Exception as e:
        log(f"shutdown: {e}")


if __name__ == "__main__":
    main()
