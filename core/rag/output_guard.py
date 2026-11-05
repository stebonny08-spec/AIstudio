# -*- coding: utf-8 -*-
"""core/rag/output_guard.py — R16 B1: guardia output + fallback estrattivo.

Causa F0 (qa/f0_round16.json, TEMPLATE-LEAK): sul path sidecar il modello
parlava senza chat-template e produceva output con marker di template
("User:", "Assistant:", "[Fonte ...]", "DOMANDA DELL'UTENTE"), riecheggiava
il system prompt e ripeteva i blocchi; la frase canned "La risposta è data
da un utente di questo tipo." e' generata dal modello sullo stesso prompt
(non esiste nel codice: scan F0 a 0 hit) -> vietata come marker.

API (contratto R16 in core/rag/contract.py):

    check_output(text, *, system_text="", check_min_len=True, phase="full")
        -> {"ok", "markers", "too_short", "system_echo", "canned", "reason"}
    compose_fallback(chunks, web_results, query) -> str
    guarded_stream(first_factory, *, system_text, fallback_text, ...)
        -> genera token ripuliti; su FAIL post-generazione: RESET_TOKEN +
           1 retry con prompt riparato; se ancora FAIL: RESET_TOKEN +
           fallback estrattivo (mai un output con marker verso la UI).

Nessuna rete, nessuna LLM, zero eccezioni verso il chiamante.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional

from core.rag import contract

__all__ = [
    "check_output",
    "compose_fallback",
    "guarded_stream",
    "sanitize_stream",
    "REPAIR_INSTRUCTION",
    "PREBUFFER_CHARS",
    "OUTPUT_GUARD_VERSION",
]

OUTPUT_GUARD_VERSION = "r16.1"
PREBUFFER_CHARS = 24          # R16: era 48 (~1.4s di decode in più sul primo token); 24 bastano per l'echo-check a 20 char
_ROLE_PREFIXES = ("User:", "Assistant:", "System:")
# marker "duri": se presenti l'output viene tagliato da li' (live)
_HARD_MARKERS = tuple(m for m in contract.CANNED_MARKERS
                      if m not in ("La risposta è data",
                                   "La risposta è data da un utente"))
_MARKER_WINDOW = 16           # finestra tenuta in riserva per marker spezzati

def _has_code_citation(text: str) -> bool:
    import re as _re
    return bool(_re.search(r"\[(?:F|W)\d+\]", str(text or "")))


REPAIR_INSTRUCTION = (
    "\n\nIMPORTANTE - INSTRUZIONE FINALE: Rispondi SOLO con il testo della "
    "risposta finale all'utente, nella lingua della domanda, con prosa "
    "TUA: rielabora i contenuti con parole tue, NON copiare i brani "
    "delle fonti e NON elencare i chunk. NON ripetere il messaggio di "
    "sistema, NON scrivere etichette come 'User:', 'Assistant:' o "
    "'System:', NON includere la domanda, marcatori come [Fonte ...] o "
    "</contesto>, NON usare codici di citazione come [F1]/[W1], NON "
    "elencare URL e NON creare blocchi 'Fonti:': la provenienza la "
    "mostra l'interfaccia. NON ripetere la risposta piu' di una volta. "
    "Se non hai informazioni, dillo chiaramente in una sola frase."
)

_FALLBACK_NO_MATERIAL = (
    "Non ho trovato elementi utilizzabili nei materiali locali ne' sul web "
    "per rispondere a questa domanda. Prova a riformulare usando i termini "
    "dei tuoi materiali, oppure aggiungi alla biblioteca il documento che "
    "contiene l'argomento e riprova."
)


# ======================================================================
# CHECK (post-generazione e pre-emissione)
# ======================================================================
def _collapse(s: str) -> str:
    return " ".join(str(s or "").split()).lower()


def _verbatim_hit(out: str, source_texts) -> bool:
    """True se un brano di 70+ char dell'output e' copiato DA UNA FONTE
    (risposte rielaborate, non incollate - R16 follow-up)."""
    if not source_texts:
        return False
    norm_out = _collapse(out)
    if len(norm_out) < 70:
        return False
    shingles = [norm_out[i:i + 70] for i in
                range(0, len(norm_out) - 70 + 1, 35)]
    if not shingles:
        return False
    for s in source_texts:
        ns = _collapse(s)
        if len(ns) < 70:
            continue
        for sh in shingles:
            if sh in ns:
                return True
    return False


def check_output(text: str, *, system_text: str = "",
                 check_min_len: bool = True,
                 phase: str = "full",
                 source_texts=None,
                 not_identical_to: str = None) -> Dict[str, Any]:
    """Valida un output (o un inizio di output) contro i marker R16.

    R16 follow-up:
      - source_texts: se un brano di output e' copiato verbatim da una
        fonte -> FAIL "verbatim" (le risposte si rielaborano, non si
        incollano; il fallback estrattivo resta solo emergenza);
      - not_identical_to (bozza di cache): se l'output coincide (o ne'
        ripete l'inizio di 120+ char) -> FAIL "identical" (mai riservire
        lo stesso testo identico).
    """
    t = text or ""
    markers = [m for m in contract.CANNED_MARKERS if m and m in t]
    canned = [m for m in ("La risposta è data da un utente",
                          "La risposta è data",
                          "utente di questo tipo") if m in t]
    system_echo = False
    ss = (system_text or "").strip()
    ts = t.strip()
    if ss and ts and len(ts) >= 20:
        head_s, head_t = ss[:60], ts[:60]
        system_echo = (head_s == head_t or head_t[:40] == head_s[:40]
                       or head_t[:20] == head_s[:20])
    too_short = bool(check_min_len) and len(ts) < contract.OUTPUT_MIN_LEN
    if phase == "early":
        # pre-emissione: contano solo marker/system-echo (il testo e' corto
        # per costruzione: troppo corto si giudica a fine generazione)
        too_short = False
    verbatim = False
    if phase != "early":
        verbatim = _verbatim_hit(ts, source_texts)
    # R18: i codici [F1]/[W1] NON devono piu' comparire nel testo
    # (la provenienza e' una riga piccola dell'UI dai metadati)
    code_cite = _has_code_citation(ts)
    identical = False
    if not_identical_to and phase != "early":
        ref = _collapse(not_identical_to)
        out = _collapse(ts)
        if ref and out and (out == ref
                            or (len(ref) > 120 and out[:120] == ref[:120])):
            identical = True
    ok = (not markers and not system_echo and not too_short and not canned
          and not verbatim and not identical and not code_cite)
    if markers:
        reason = "markers:" + ",".join(markers[:4])
    elif system_echo:
        reason = "system_echo"
    elif identical:
        reason = "identical"
    elif verbatim:
        reason = "verbatim"
    elif code_cite:
        reason = "citation_code"
    elif canned:
        reason = "canned:" + ",".join(canned[:2])
    elif too_short:
        reason = "too_short"
    else:
        reason = "ok"
    return {"ok": ok, "markers": markers, "too_short": too_short,
            "system_echo": system_echo, "canned": canned,
            "verbatim": verbatim, "identical": identical,
            "code_citation": code_cite,
            "reason": reason,
            "phase": phase, "len": len(ts),
            "version": OUTPUT_GUARD_VERSION}


# ======================================================================
# SANITIZER LIVE (durante lo stream: taglia appena un marker compare)
# ======================================================================
class _LiveSanitizer:
    """Taglia lo stream dal primo marker/ruolo: niente junk verso la UI.

    - line-start: tiene i primi ~12 char di riga per distinguere un
      ruolo reale ("User:") da testo innocuo ("Usa il ...");
    - hard marker ovunque ("\nUser:", "[Fonte", "</contesto>", ...) ->
      kill immediato;
    - finestra di riserva di _MARKER_WINDOW char per marker spezzati tra
      due chunk.
    """

    def __init__(self) -> None:
        self.killed = False
        self.buf = ""
        self.at_line_start = True

    def feed(self, tok: str) -> str:
        if self.killed:
            return ""
        self.buf += tok or ""
        out = ""
        while self.buf and not self.killed:
            if self.at_line_start:
                ls = self.buf.lstrip(" \t")
                if not ls:
                    if len(self.buf) > 10:      # riga di soli spazi
                        out += self.buf
                        self.buf = ""
                    break
                probe = ls[:12]
                related = any(rp.startswith(probe) or probe.startswith(rp)
                              for rp in _ROLE_PREFIXES)
                if related and len(ls) < 12:
                    break                        # ambiguo: trattieni
                if any(ls.startswith(rp) for rp in _ROLE_PREFIXES):
                    self.killed = True
                    self.buf = ""
                    break
                self.at_line_start = False
            # ruolo esplicito dopo newline
            for rp in _ROLE_PREFIXES:
                j = self.buf.find("\n" + rp)
                if j >= 0:
                    out += self.buf[:j]
                    self.buf = ""
                    self.killed = True
                    break
            if self.killed:
                break
            # hard marker (con tolleranza per marker spezzati in coda)
            cut = -1
            for m in _HARD_MARKERS:
                j = self.buf.find(m)
                if j >= 0:
                    cut = j
                    break
            if cut >= 0:
                out += self.buf[:cut]
                self.buf = ""
                self.killed = True
                break
            hold = self._partial_suffix_hold()
            if len(self.buf) > _MARKER_WINDOW + hold:
                n = len(self.buf) - (_MARKER_WINDOW + hold)
                chunk = self.buf[:n]
                self.buf = self.buf[n:]
                out += chunk
                if chunk.endswith("\n"):
                    self.at_line_start = True
                    continue
            break
        return out

    def _partial_suffix_hold(self) -> int:
        """Quanti char finali non si possono ancora emettere (marker a meta)."""
        hold = 0
        cand = list(_HARD_MARKERS) + ["\n" + rp for rp in _ROLE_PREFIXES]
        for m in cand:
            for k in range(1, min(len(m), 12)):
                if self.buf.endswith(m[:k]):
                    hold = max(hold, k)
        return hold

    def flush(self) -> str:
        if self.killed:
            self.buf = ""
            return ""
        out = self.buf
        self.buf = ""
        return out


def _prebuffer_ready(buf: str, system_text: str,
                      min_chars: int = 12) -> bool:
    """R16 t3: emetti NON APPENA i primi 12 char escludono un system-echo.

    - i primi 12 char DIVERSI dal system -> echo impossibile: emetti subito
      (risparmia ~0.3-0.7s sul primo token, misurati);
    - i primi 12 char uguali al system -> aspetta fino a PREBUFFER_CHARS
      per la conferma echo (zero leak).
    """
    if len(buf) < min_chars:
        return False
    ss = (system_text or "").strip()
    ts = buf.strip()
    if ss and ts and ss[:min_chars] == ts[:min_chars]:
        return len(ts) >= PREBUFFER_CHARS
    return True


def sanitize_stream(src: Iterable) -> Iterator[str]:
    """Wrappa uno stream di token (str o dict) applicando il sanitizer live.

    I dict (esposito contract.RESET_TOKEN) passano invariati.
    """
    san = _LiveSanitizer()
    for tok in src:
        if isinstance(tok, dict):
            yield tok
            continue
        piece = san.feed(tok)
        if piece:
            yield piece
    tail = san.flush()
    if tail:
        yield tail


# ======================================================================
# FALLBACK ESTRATTIVO (template-free, con citazioni)
# ======================================================================
def _bullet(text: str, limit: int = 260) -> str:
    t = " ".join(str(text or "").split())
    if len(t) > limit:
        t = t[:limit].rsplit(" ", 1)[0] + "..."
    return t


def compose_fallback(chunks, web_results, query: str) -> str:
    """Risposta estrattIVA dai top-k (e/o snippet web), zero marker, >=80 char."""
    parts: List[str] = []
    cites: List[str] = []
    intro = ("Ecco ciò che ho trovato nei materiali per questa domanda:"
             if (chunks or web_results) else "")
    if intro:
        parts.append(intro)
        parts.append("")
    n = 0
    for c in (chunks or [])[:5]:
        txt = getattr(c, "text", "") or ""
        if not txt.strip():
            continue
        n += 1
        parts.append(f"- {_bullet(txt)}")
    m = 0
    for r in (web_results or [])[:3]:
        snip = getattr(r, "snippet", "") or ""
        if not snip.strip():
            continue
        m += 1
        parts.append(f"- {_bullet(snip)}")
    if not parts or n + m == 0:
        return _FALLBACK_NO_MATERIAL
    out = "\n".join(parts).strip()
    if len(out) < contract.OUTPUT_MIN_LEN:
        out = (_FALLBACK_NO_MATERIAL + "\n\n" + out).strip()
    return out


# ======================================================================
# STREAM GUARDITO (buffer iniziale -> live -> check post -> retry -> fb)
# ======================================================================
def guarded_stream(
    first_factory: Callable[[], Iterator],
    *,
    system_text: str = "",
    fallback_text: str = "",
    repair_factory: Optional[Callable[[], Iterator]] = None,
    deadline: Optional[float] = None,
    check_min_len: bool = True,
    on_final: Optional[Callable[[Dict[str, Any]], None]] = None,
    on_truncate: Optional[Callable[[], None]] = None,
    source_texts=None,
    not_identical_to: Optional[str] = None,
) -> Iterator:
    """Produce lo stream finale validato (vedi docstring modulo).

    - i dict (RESET_TOKEN) passano invariati;
    - niente marker verso la UI (live sanitizer);
    - check post-generazione: FAIL -> RESET + 1 retry (repair_factory) ->
      FAIL -> RESET + fallback_text (composto da compose_fallback).
    """
    from core.rag.contract import RESET_TOKEN  # import locale anti-ciclo

    # ---------------- passata 1 (con pre-buffer e live sanitize) --------
    san = _LiveSanitizer()
    collected: List[str] = []
    primed = False
    prebuf = ""
    emitted_any = False
    early_fail = False

    def _emit(piece: str) -> Iterator[str]:
        nonlocal emitted_any
        if piece:
            emitted_any = True
            yield piece

    for tok in first_factory():
        if isinstance(tok, dict):
            yield tok
            continue
        # R18: NESSUN kill temporale - la risposta iniziata si completa
        # (il 20s resta obiettivo informativo; si degradano gli STADI)
        if not primed:
            prebuf += tok or ""
            if not _prebuffer_ready(prebuf, system_text):
                continue
            early = check_output(prebuf[:PREBUFFER_CHARS],
                                 system_text=system_text, phase="early")
            if not early["ok"]:
                # abort PRIMA di mostrare junk (caso F0 q1: system-echo)
                early_fail = True
                break
            primed = True
            piece = san.feed(prebuf)
            prebuf = ""
            for p in _emit(piece) if piece else []:
                collected.append(p)
                yield p
            continue
        piece = san.feed(tok)
        if piece:
            collected.append(piece)
            yield piece
    if primed:
        tail = san.flush()
        if tail:
            collected.append(tail)
            yield tail
    elif prebuf and not early_fail:
        # stream finito prima di PREBUFFER_CHARS: valida e rilascia comunque
        early_end = check_output(prebuf, system_text=system_text,
                                 phase="early")
        primed = True
        if early_end["ok"]:
            piece = san.feed(prebuf)
            prebuf = ""
            if piece:
                collected.append(piece)
                yield piece
            tail = san.flush()
            if tail:
                collected.append(tail)
                yield tail
        else:
            early_fail = True

    text1 = "".join(collected)
    final = check_output(text1, system_text=system_text,
                         check_min_len=check_min_len,
                         source_texts=source_texts,
                         not_identical_to=not_identical_to)

    if (final["ok"] and not early_fail
            and not final.get("identical")
            and not final.get("verbatim")):
        if on_final:
            try:
                on_final(final)
            except Exception:
                pass
        return

    # ---------------- FAIL -> RESET + 1 retry ---------------------------
    if repair_factory is None:
        yield RESET_TOKEN
        yield from _chunked(fallback_text or _FALLBACK_NO_MATERIAL)
        if on_final:
            try:
                on_final(dict(final, retried=False, fallback=True))
            except Exception:
                pass
        return

    yield RESET_TOKEN
    san2 = _LiveSanitizer()
    collected2: List[str] = []
    primed2 = False
    prebuf2 = ""
    for tok in repair_factory():
        if isinstance(tok, dict):
            yield tok
            continue
        if not primed2:
            prebuf2 += tok or ""
            if not _prebuffer_ready(prebuf2, system_text):
                continue
            early2 = check_output(prebuf2[:PREBUFFER_CHARS],
                                  system_text=system_text, phase="early")
            if not early2["ok"]:
                break
            primed2 = True
            piece = san2.feed(prebuf2)
            prebuf2 = ""
            if piece:
                collected2.append(piece)
                yield piece
            continue
        piece = san2.feed(tok)
        if piece:
            collected2.append(piece)
            yield piece
    if primed2:
        tail2 = san2.flush()
        if tail2:
            collected2.append(tail2)
            yield tail2

    text2 = "".join(collected2)
    final2 = check_output(text2, system_text=system_text,
                          check_min_len=check_min_len,
                          source_texts=source_texts,
                          not_identical_to=not_identical_to)
    if (final2["ok"]
            and not final2.get("identical")
            and not final2.get("verbatim")):
        if on_final:
            try:
                on_final(dict(final2, retried=True))
            except Exception:
                pass
        return

    # ---------------- retry FALLITO -> RESET + fallback estrattivo ------
    yield RESET_TOKEN
    yield from _chunked(fallback_text or _FALLBACK_NO_MATERIAL)
    if on_final:
        try:
            on_final(dict(final2, retried=True, fallback=True,
                          first=final))
        except Exception:
            pass


def _chunked(text: str, size: int = 120) -> Iterator[str]:
    t = str(text or "")
    for i in range(0, len(t), size):
        yield t[i:i + size]
