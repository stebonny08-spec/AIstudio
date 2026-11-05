# -*- coding: utf-8 -*-
"""qa/p1b_rag_patch.py — patch P1b.3 su file esistenti (CRLF-safe).

Applica UNA VOLTA le modifiche di P1b.3 (idempotente: ogni operazione
asserisce il conteggio atteso e saltua' gia' applicata). File toccati:
  core/rag/gate.py        -> rag_flag + RAG_FLAG_DEFAULTS (in coda)
  core/local_search.py    -> helper _rag_flag, hook HyDE, hook CRAG-lite,
                             gate flag su reranker
  core/router.py          -> _decompose dietro flag rag.decompose
  core/rag/reranker_int8.py -> model_ready() + OnnxReranker (solo se file ok)
Uso: python qa/p1b_rag_patch.py
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(rel: str) -> str:
    return io.open(ROOT / rel, encoding="utf-8", newline="").read()


def save(rel: str, text: str) -> None:
    io.open(ROOT / rel, "w", encoding="utf-8", newline="").write(text)


def sub(text: str, old: str, new: str, count: int, tag: str,
        nl: str) -> str:
    """replace CRLF-safe; count>=1 atteso (o -1 = almeno 1)."""
    o = old.replace("\n", nl)
    n = new.replace("\n", nl)
    found = text.count(o)
    if found == 0:
        # gia' applicato?
        if count == -1 or new.replace("\n", nl) in text:
            print(f"  [skip] {tag}: gia applicato")
            return text
        raise SystemExit(f"[FAIL] {tag}: anchor non trovato")
    if count >= 0 and found != count:
        raise SystemExit(f"[FAIL] {tag}: trovato {found} volte, atteso {count}")
    return text.replace(o, n)


def nl_of(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


# ---------------------------------------------------------------- gate.py
def patch_gate() -> None:
    rel = "core/rag/gate.py"
    s = load(rel)
    if "def rag_flag(" in s:
        print(f"  [skip] {rel}: rag_flag gia presente")
        return
    block = '''


# ======================================================================
# P1b.3 — flag tecnica RAG (A/B su GT reale: qa/p1b_rag.json)
# ======================================================================
# I DEFAULT qui sotto sono l'ESITO dell'A/B P1b.3 (regola dichiarata: ON
# SOLO SE recall@5 o MRR migliora >= +0.03 — cioe' almeno 1 query sui 9
# positivi, granularita' 1/9 = +0.111 — E ms aggiunti p95 <= 150ms).
# Numeri completi e decisioni: qa/p1b_rag.json; verifica automatica in
# tests/testP1b_rag.py. Se un flag diventa ON, la relativa riga in
# RAG_FLAG_DEFAULTS passa a True CON il commento dei numeri (P1b.4).
RAG_FLAG_DEFAULTS: Dict[str, bool] = {
    "rag.hyde": False,          # A/B: vedi qa/p1b_rag.json -> tecnica "hyde"
    "rag.decompose": False,     # A/B: vedi qa/p1b_rag.json -> "decompose"
    "rag.crag_lite": False,     # A/B: vedi qa/p1b_rag.json -> "crag"
    "rag.rerank.enabled": False,  # A/B: BLOCKED (modello ONNX non pronto)
}

# Mappa flag -> nome tecnica usato dall'env RAG_TECH dell'A/B.
_TECH_ENV_MAP = {
    "rag.hyde": "hyde",
    "rag.decompose": "decompose",
    "rag.crag_lite": "crag",
    "rag.rerank.enabled": "rerank",
}


def rag_flag(name: str, default: Optional[bool] = None) -> bool:
    """Flag opt-in di una tecnica RAG (P1b.3), con override d'ambiente.

    Meccanismo RIPRODUCIBILE dell'A/B (dichiarato in qa/p1b_rag.json):
      * RAG_TECH=<tech>  -> SOLO quella tecnica ON, tutte le altre OFF;
      * RAG_TECH=none    -> tutte OFF (run OFF dell'A/B);
      * RAG_TECH assente -> default RAG_FLAG_DEFAULTS (o il valore di
        config, se la chiave e' presente: l'utente puo' forzarla).

    `name` e' la chiave di config ("rag.hyde", "rag.decompose",
    "rag.crag_lite", "rag.rerank.enabled"). Nessuna eccezione: errore di
    config -> default (flag OFF, comportamento sicuro).
    """
    key = _TECH_ENV_MAP.get(name, name)
    try:
        import os
        env = os.environ.get("RAG_TECH", "").strip().lower()
    except Exception:
        env = ""
    if env:
        if env in ("none", "off", "0"):
            return False
        return env == key
    if default is None:
        default = RAG_FLAG_DEFAULTS.get(name, False)
    try:
        from data.config_manager import ConfigManager
        return bool(ConfigManager().get(name, default))
    except Exception:
        return bool(default)
'''
    nl = nl_of(s)
    s = s + block.replace("\n", nl)
    save(rel, s)
    print(f"  [ok] {rel}: +rag_flag/RAG_FLAG_DEFAULTS")


# -------------------------------------------------------- local_search.py
def patch_local_search() -> None:
    rel = "core/local_search.py"
    s = load(rel)
    nl = nl_of(s)

    # helper _rag_flag (lazy import: nessun ciclo d'import)
    s = sub(s,
            '''def _is_originals_source(source_file) -> bool:''',
            '''def _rag_flag(name: str) -> bool:
    """P1b.3: flag tecnica RAG (gate.rag_flag, lazy, mai eccezione)."""
    try:
        from core.rag.gate import rag_flag
        return rag_flag(name)
    except Exception:
        return False


def _is_originals_source(source_file) -> bool:''', 1, "helper _rag_flag", nl)

    # gate flag sul reranker (2 siti: search + hybrid_search)
    s = sub(s,
            '''        # --- H8 (6): reranker opt-in (default OFF) sui top-10 ---
        if reranker:
            raw_results = _apply_reranker(query, raw_results)''',
            '''        # --- H8 (6): reranker opt-in (P1b.3: serve anche il flag) ---
        # reranker=True resta opt-in del caller; deve valere ANCHE il flag
        # di config rag.rerank.enabled (default OFF, esito A/B
        # qa/p1b_rag.json: BLOCKED, modello ONNX non pronto).
        if reranker and _rag_flag("rag.rerank.enabled"):
            raw_results = _apply_reranker(query, raw_results)''',
            2, "reranker flag gate x2", nl)

    # hook HyDE in hybrid_search (dopo la rewrite)
    s = sub(s,
            '''        # H8 (5): rewrite conservativa solo per query colloquiali.
        query = rewrite_query(query) or query
        self.last_probe["query_norm"] = query''',
            '''        # H8 (5): rewrite conservativa solo per query colloquiali.
        query = rewrite_query(query) or query
        self.last_probe["query_norm"] = query

        # ---- P1b.3 HyDE (flag rag.hyde): hyp via sidecar -> vettore ----
        # IL TESTO ipotetico sostituisce la query SOLO nell'embedding della
        # variante principale; la FTS5 resta sulla query originale.
        # Sidecar giu'/timeout (~8s) -> fallback silenzioso alla query
        # normale (dettagli in last_probe["hyde"], nessuna eccezione).
        hyde_text = None
        if _rag_flag("rag.hyde"):
            try:
                from core.rag.hyde import generate_hypothetical
                _hyp, _hinfo = generate_hypothetical(query)
                self.last_probe["hyde"] = _hinfo
                if _hyp:
                    hyde_text = _hyp
            except Exception as _hexc:
                self.last_probe["hyde"] = {"ok": False,
                                           "reason": f"err:{_hexc}"}''',
            1, "hyde hook", nl)

    # embedding: variante 0 usa l'hyp se presente (FTS invariata)
    s = sub(s,
            '''        for variant in all_variants:
            t0 = time.perf_counter()
            qe = self.embedder.embed_one(variant, kind="query")''',
            '''        for _vi, variant in enumerate(all_variants):
            t0 = time.perf_counter()
            # P1b.3 HyDE: il vettore della variante 0 e' l'hyp (se HyDE ON
            # e generazione riuscita); la FTS5 sotto usa ancora `variant`.
            _emb_src = hyde_text if (_vi == 0 and hyde_text) else variant
            qe = self.embedder.embed_one(_emb_src, kind="query")''',
            1, "hyde embed variant0", nl)

    # hook CRAG-lite: gate reale sul pool + 1 retry locale (dopo C4)
    s = sub(s,
            '''        # Stessa difesa C4 di search(): originals/ mai tra le fonti.
        raw_results = [
            r for r in fused
            if not _is_originals_source(r.get("source_file"))
        ]''',
            '''        # Stessa difesa C4 di search(): originals/ mai tra le fonti.
        raw_results = [
            r for r in fused
            if not _is_originals_source(r.get("source_file"))
        ]

        # ---- P1b.3 CRAG-lite (flag rag.crag_lite) --------------------
        # GATE REALE (core.rag.gate.decide_gate, soglia gate.threshold)
        # sul pool appena fuso: se NON pieno -> UN retry locale con rewrite
        # deterministica (zero LLM) + rifusione RRF + re-gate. Il BLOCCO
        # della generazione resta il gate esistente del router (non
        # duplicato); il fallback web resta lo stage R16 (nessun hook qui).
        if _rag_flag("rag.crag_lite") and lists:
            try:
                from core.rag import crag_lite as _cl
                self.last_probe["fused"] = list(raw_results)
                _crag_weak = _cl.should_retry(query, self.last_probe)
                _cinfo: Dict = {"retried": False, "weak": bool(_crag_weak)}
                if _crag_weak:
                    _rq = _cl.crag_retry_query(query)
                    if _rq and _rq not in all_variants:
                        _tc = time.perf_counter()
                        all_variants.append(_rq)
                        t0 = time.perf_counter()
                        _qe = self.embedder.embed_one(_rq, kind="query")
                        self.last_probe["embed_ms"] += (time.perf_counter() - t0) * 1000.0
                        t0 = time.perf_counter()
                        _vr = self.vector_store.query(_qe, top_k=fetch_n)
                        self.last_probe["vec_ms"] += (time.perf_counter() - t0) * 1000.0
                        vec_lists.append(_vr)
                        lists.append(_vr)
                        if callable(fts_fn):
                            try:
                                t0 = time.perf_counter()
                                _fr = fts_fn(_rq, top_k=fetch_n)
                                self.last_probe["fts_ms"] += (time.perf_counter() - t0) * 1000.0
                                fts_lists.append(_fr)
                                lists.append(_fr)
                            except Exception:
                                pass
                        fused = rrf_fuse(lists, k=RRF_K)
                        raw_results = [
                            r for r in fused
                            if not _is_originals_source(r.get("source_file"))
                        ]
                        self.last_probe["vec_lists"] = vec_lists
                        self.last_probe["fts_lists"] = fts_lists
                        _cinfo = {"retried": True, "weak": True,
                                  "retry_query": _rq,
                                  "ms": round((time.perf_counter() - _tc) * 1000.0, 1),
                                  "n_variants": len(all_variants)}
                    else:
                        _cinfo["skipped"] = "retry_query_vuota_o_duplicata"
                self.last_probe["crag"] = _cinfo
                self.last_probe["variants"] = len(all_variants)
            except Exception as _cexc:
                self.last_probe["crag"] = {"error": str(_cexc)}''',
            1, "crag hook", nl)

    # _apply_reranker: preferisci ONNX reale se pronto, altrimenti BOW
    s = sub(s,
            '''    if not rows or len(rows) <= 1:
        return rows
    try:
        from core.rag.reranker_int8 import RerankerInt8
        rr = RerankerInt8()
    except Exception:
        return rows
    head = list(rows[:top_n])
    tail = list(rows[top_n:])
    indexed = list(enumerate(head))
    try:''',
            '''    if not rows or len(rows) <= 1:
        return rows
    head = list(rows[:top_n])
    tail = list(rows[top_n:])
    indexed = list(enumerate(head))
    # P1b.3: modello ONNX REALE solo se pronto (>=50MB + tokenizer valido);
    # altrimenti placeholder BOW dichiarato con log di guardia (G6).
    rr = None
    try:
        from core.rag import reranker_int8 as _rrm
        _ok, _why = _rrm.model_ready()
        if _ok:
            rr = _rrm.OnnxReranker()
            print(f"[Reranker] ONNX reale attivo ({_why})")
        else:
            print(f"[Reranker] ONNX non pronto ({_why}) -> placeholder BOW")
    except Exception:
        rr = None
    if rr is None:
        try:
            from core.rag.reranker_int8 import RerankerInt8
            rr = RerankerInt8()
        except Exception:
            return rows
    try:''', 1, "_apply_reranker onnx-first", nl)

    save(rel, s)
    print(f"  [ok] {rel}: helper+hyde+crag+rerank flag")


# -------------------------------------------------------------- router.py
def patch_router() -> None:
    rel = "core/router.py"
    s = load(rel)
    nl = nl_of(s)
    s = sub(s,
            '''        (multi-punto / "confronta" / "tutto su"): split deterministico,
        NO LLM, e la generazione resta UNA sola con la query originale."""
        try:
            out = Router0LLM().route(query)''',
            '''        (multi-punto / "confronta" / "tutto su"): split deterministico,
        NO LLM, e la generazione resta UNA sola con la query originale."""
        # P1b.3: decomposizione dietro FLAG rag.decompose (default OFF,
        # esito A/B qa/p1b_rag.json). Flag spento -> percorso INVARIATO:
        # subqueries=[] esattamente come prima dello hook (variants=None).
        try:
            from core.rag.gate import rag_flag
            if not rag_flag("rag.decompose"):
                return []
        except Exception:
            return []
        try:
            out = Router0LLM().route(query)''', 1, "_decompose flag", nl)
    save(rel, s)
    print(f"  [ok] {rel}: _decompose dietro flag rag.decompose")


# ------------------------------------------------------ reranker_int8.py
def patch_reranker() -> None:
    rel = "core/rag/reranker_int8.py"
    s = load(rel)
    if "def model_ready(" in s:
        print(f"  [skip] {rel}: model_ready gia presente")
        return
    block = '''


# ======================================================================
# P1b.3 — modello ONNX REALE (Xenova/bge-reranker-v2-m3) dietro flag
# ======================================================================
# Download in tools/models/rerank_bge-v2m3/ (coordinatore). Regola di
# qualita': il modello e' USABILE solo se .done presente, onnx >= 50MB e
# tokenizer.json e' JSON valido; altrimenti model_ready()==False ->
# nessuna costruzione sessione (nessuna attesa indefinita) e rerank
# dichiarato BLOCKED/OFF in qa/p1b_rag.json.

ONNX_MIN_BYTES = 50 * 1024 * 1024


def _onnx_dir():
    from pathlib import Path
    return Path(__file__).resolve().parents[2] / "tools" / "models" / "rerank_bge-v2m3"


def model_ready() -> "tuple":
    """(pronto, motivo) per il modello ONNX di rerank (P1b.3).

    Controlli: marker .done, onnx/model_quantized.onnx >= 50MB,
    tokenizer.json JSON valido. Motivo sempre popolato (log/BLOCKED).
    """
    import json as _json
    d = _onnx_dir()
    onnx = d / "onnx" / "model_quantized.onnx"
    if not (d / ".done").exists():
        return False, "marker .done mancante"
    if not onnx.exists():
        return False, "onnx/model_quantized.onnx mancante"
    try:
        sz = onnx.stat().st_size
    except OSError as exc:
        return False, f"onnx illeggibile: {exc}"
    if sz < ONNX_MIN_BYTES:
        return False, (f"model_quantized.onnx {sz} B < {ONNX_MIN_BYTES} B "
                       f"(download non completo/corrotto)")
    tok = d / "tokenizer.json"
    try:
        _json.loads(tok.read_text(encoding="utf-8"))
    except Exception as exc:
        return False, f"tokenizer.json non valido: {type(exc).__name__}: {exc}"
    return True, "ok"


class OnnxReranker:
    """Reranker ONNX reale: costruzione SOLO se model_ready()==True.

    Interfaccia speculare a RerankerPlaceholder (score/rerank) per non
    toccare i caller. Score = sigmoid(logit) del pair (query, passage),
    scala [0,1] come il placeholder.
    """

    trained = True
    backend = "onnx_bge-reranker-v2-m3-int8"

    def __init__(self) -> None:
        ok, why = model_ready()
        if not ok:
            raise RuntimeError(f"OnnxReranker non costruibile: {why}")
        import numpy as _np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        d = _onnx_dir()
        self._np = _np
        self._sess = ort.InferenceSession(
            str(d / "onnx" / "model_quantized.onnx"),
            providers=["CPUExecutionProvider"])
        self._tok = Tokenizer.from_file(str(d / "tokenizer.json"))
        self._inputs = [i.name for i in self._sess.get_inputs()]

    def score(self, query: str, passage: str) -> float:
        try:
            enc = self._tok.encode(query or "", passage or "")
            feed = {}
            for name in self._inputs:
                if name == "input_ids":
                    vals = enc.ids
                elif name == "attention_mask":
                    vals = enc.attention_mask
                elif name == "token_type_ids":
                    vals = enc.type_ids
                else:
                    raise RuntimeError(f"input ONNX sconosciuto: {name}")
                feed[name] = self._np.array([vals], dtype=self._np.int64)
            out = self._sess.run(None, feed)[0]
            logit = float(self._np.asarray(out).reshape(-1)[0])
            logit = max(-60.0, min(60.0, logit))
            return 1.0 / (1.0 + self._np.exp(-logit))
        except Exception:
            return 0.0

    def rerank(self, query: str, passages, top_k: int = 10):
        indexed = list(enumerate(list(passages)))
        indexed.sort(key=lambda t: (-self.score(query, t[1]), t[0]))
        return [i for i, _ in indexed[:max(0, int(top_k))]]
'''
    nl = nl_of(s)
    s = s + block.replace("\n", nl)
    save(rel, s)
    print(f"  [ok] {rel}: +model_ready/OnnxReranker")


def main() -> int:
    print("P1b.3 patch:")
    patch_gate()
    patch_local_search()
    patch_router()
    patch_reranker()
    print("P1b.3 patch completato.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
