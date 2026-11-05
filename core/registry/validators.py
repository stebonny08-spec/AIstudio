"""core/registry/validators.py — Regole FUNZIONE (livello 3 di validate_output).

Dopo il parse JSON (1) e la grammatica (2), queste funzioni applicano i
vincoli specifici di ogni voce del registro (quote ⊆ testo, conteggi,
tolleranze...). Ogni validator riceve (parsed, ctx) e ritorna una lista
di errori (vuota = ok). Nessuna chiamata LLM: solo controlli locali.

ctx è il dizionario passato dal caller a validate_output(fid, raw, ctx);
serve ad esempio come testo di confronto per le quote. I controlli che
dipendono da un elemento di ctx assente vengono saltati (il caller che
vuole il controllo deve passare il dato).
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

from .grammars import MAX_TABLE_COLS, MAX_TABLE_ROWS, normalize

_REF_CELL_RE = re.compile(r"[A-Za-z]{1,3}[0-9]+\Z")


def _words(text: str) -> int:
    return len(str(text).split())


_EDGE_STRIP = ".,;:!?\u2026\u00b7\u00b0%\"'\u201c\u201d\u2018\u2019\u00ab\u00bb()[]{}`-\u2013\u2014"


def _words_norm(text: str) -> int:
    """Conteggio parole NORMALIZZATO (F13 - check_script).

    Regole deterministiche (documentate):
    1) split sui soli spazi bianchi;
    2) per ogni token si rimuove la punteggiatura di BORDO (iniziale e
       finale): . , ; : ! ? " ' parentesi, virgolette, trattini, ecc.
       (insieme _EDGE_STRIP);
    3) i token rimasti vuoti (solo punteggiatura) NON contano;
    4) la punteggiatura INTERNa al token resta intatta: "2,5" e
       "l'idea" contano 1 parola ciascuna.

    Es.: "Ciao.   Mondo!!" -> 2 ; "parola parola ..." -> 2.
    """
    n = 0
    for tok in str(text).split():
        if tok.strip(_EDGE_STRIP):
            n += 1
    return n



def _in_text(quote: str, source: str) -> bool:
    return normalize(quote) in normalize(source)


# --------------------------------------------------------------------------
# Flashcard (F01/F02/F03)
# --------------------------------------------------------------------------

def _deck_cards(parsed: Any) -> List[dict]:
    if isinstance(parsed, dict) and isinstance(parsed.get("cards"), list):
        return [c for c in parsed["cards"] if isinstance(c, dict)]
    return []


def _check_deck_base(parsed: Any, ctx: dict) -> List[str]:
    errs: List[str] = []
    cards = _deck_cards(parsed)
    testo = ctx.get("testo")
    n = ctx.get("n")
    if n is not None:
        try:
            n_int = int(n)
        except (TypeError, ValueError):
            errs.append("ctx['n'] non convertibile in intero: %r" % (n,))
            n_int = None
        if n_int is not None and len(cards) != n_int:
            errs.append("attese %d flashcard, trovate %d" % (n_int, len(cards)))
    if isinstance(testo, str) and testo.strip():
        for i, c in enumerate(cards):
            if not _in_text(str(c.get("quote", "")), testo):
                errs.append(
                    "cards[%d]: quote non presente nel testo fornito (%r)"
                    % (i, str(c.get("quote", ""))[:60])
                )
    for i, c in enumerate(cards):
        front = str(c.get("front", ""))
        back = str(c.get("back", ""))
        if front.strip() == back.strip():
            errs.append("cards[%d]: front e back identici" % i)
        if not (10 <= len(front) <= 140):
            errs.append(
                "cards[%d].front: %d caratteri (richiesti tra 10 e 140)"
                % (i, len(front))
            )
    return errs


def check_deck(parsed: Any, ctx: dict) -> List[str]:
    """F01 — quote ⊆ testo, front≠back, 10≤|front|≤140, n esatto."""
    return _check_deck_base(parsed, ctx)


def check_deck_doc(parsed: Any, ctx: dict) -> List[str]:
    """F02 — regole deck + citations.source = doc_id."""
    errs = _check_deck_base(parsed, ctx)
    doc_id = ctx.get("doc_id")
    testo = ctx.get("testo")
    for i, c in enumerate(_deck_cards(parsed)):
        cit = c.get("citations")
        if not isinstance(cit, list) or not cit:
            errs.append("cards[%d]: citations obbligatorie per il materiale" % i)
            continue
        for j, ct in enumerate(cit):
            if not isinstance(ct, dict):
                continue
            if doc_id is not None and ct.get("source") != doc_id:
                errs.append(
                    "cards[%d].citations[%d].source: atteso %r (trovato %r)"
                    % (i, j, doc_id, ct.get("source"))
                )
            if isinstance(testo, str) and testo.strip():
                if not _in_text(str(ct.get("quote", "")), testo):
                    errs.append(
                        "cards[%d].citations[%d]: quote non presente nel testo"
                        % (i, j)
                    )
    return errs


def check_deck_chat(parsed: Any, ctx: dict) -> List[str]:
    """F03 — esattamente 1 card, niente "come sopra", quote ⊆ Q+A."""
    errs: List[str] = []
    cards = _deck_cards(parsed)
    if len(cards) != 1:
        errs.append("attesa esattamente 1 flashcard, trovate %d" % len(cards))
    testo = ctx.get("testo")
    if not (isinstance(testo, str) and testo.strip()):
        q, a = ctx.get("q"), ctx.get("a")
        if q is not None and a is not None:
            testo = "%s\n%s" % (q, a)
    sub_ctx = dict(ctx)
    if isinstance(testo, str) and testo.strip():
        sub_ctx["testo"] = testo
    sub_ctx.pop("n", None)
    errs.extend(_check_deck_base(parsed, sub_ctx))
    for i, c in enumerate(cards):
        if "come sopra" in str(c.get("front", "")).lower():
            errs.append(
                "cards[%d].front: riferimenti 'come sopra' non ammessi" % i
            )
    return errs


# --------------------------------------------------------------------------
# Giudizio / testi
# --------------------------------------------------------------------------

def check_judge(parsed: Any, ctx: dict) -> List[str]:
    """F04 — feedback ≤ 30 parole (enum gestito dalla grammatica)."""
    errs: List[str] = []
    if isinstance(parsed, dict):
        fb = parsed.get("feedback")
        if isinstance(fb, str):
            w = _words(fb)
            if w > 30:
                errs.append("feedback: %d parole (massimo 30)" % w)
    return errs


def check_improve(parsed: Any, ctx: dict) -> List[str]:
    """F05 — testo ≤ 1,3× la bozza originale."""
    errs: List[str] = []
    orig = ctx.get("bozza") or ctx.get("testo")
    if isinstance(parsed, str) and isinstance(orig, str) and orig.strip():
        limit = int(1.3 * len(orig))
        if len(parsed) > limit:
            errs.append(
                "testo lungo %d caratteri (massimo 1,3× l'originale: %d)"
                % (len(parsed), limit)
            )
    return errs


def check_cite(parsed: Any, ctx: dict) -> List[str]:
    """F06 — ogni citation.quote ⊆ chunks."""
    errs: List[str] = []
    chunks = ctx.get("chunks")
    if not (isinstance(chunks, str) and chunks.strip()):
        return errs
    if isinstance(parsed, dict) and isinstance(parsed.get("citations"), list):
        for j, c in enumerate(parsed["citations"]):
            if isinstance(c, dict) and not _in_text(str(c.get("quote", "")), chunks):
                errs.append(
                    "citations[%d]: quote non presente nei passaggi forniti (%r)"
                    % (j, str(c.get("quote", ""))[:60])
                )
    return errs


def check_explain(parsed: Any, ctx: dict) -> List[str]:
    """F07 — 1..5 righe/bullet."""
    errs: List[str] = []
    if isinstance(parsed, str):
        lines = [ln for ln in parsed.splitlines() if ln.strip()]
        if not (1 <= len(lines) <= 5):
            errs.append("spiegazione: %d bullet (richiesti da 1 a 5)" % len(lines))
    return errs


def check_formula(parsed: Any, ctx: dict) -> List[str]:
    """F08 — ref di destinazione stile A1 (sintassi in grammatica)."""
    errs: List[str] = []
    ref = ctx.get("ref")
    if isinstance(ref, str) and ref.strip():
        if not _REF_CELL_RE.match(ref.strip()):
            errs.append("ctx['ref']: riferimento cella non valido: %r" % ref)
    return errs


def check_table(parsed: Any, ctx: dict) -> List[str]:
    """F09 — dimensioni ≤ 8 colonne × 20 righe e larghezze coerenti."""
    errs: List[str] = []
    if isinstance(parsed, dict):
        header = parsed.get("header")
        rows = parsed.get("rows")
        if isinstance(header, list) and len(header) > MAX_TABLE_COLS:
            errs.append(
                "header: massimo %d colonne (%d trovate)"
                % (MAX_TABLE_COLS, len(header))
            )
        if isinstance(rows, list) and len(rows) > MAX_TABLE_ROWS:
            errs.append(
                "rows: massimo %d righe (%d trovate)" % (MAX_TABLE_ROWS, len(rows))
            )
        if isinstance(header, list) and isinstance(rows, list):
            for i, r in enumerate(rows):
                if isinstance(r, list) and len(r) != len(header):
                    errs.append(
                        "rows[%d]: %d celle, ma header ne ha %d"
                        % (i, len(r), len(header))
                    )
    return errs


def check_outline(parsed: Any, ctx: dict) -> List[str]:
    """F10 — 5..8 slide, 1..4 bullet, bullet ≤ 12 parole."""
    errs: List[str] = []
    if not isinstance(parsed, dict):
        return errs
    slides = parsed.get("slides")
    if not isinstance(slides, list):
        return errs
    if not (5 <= len(slides) <= 8):
        errs.append("slides: %d slide (richieste da 5 a 8)" % len(slides))
    for i, s in enumerate(slides):
        if not isinstance(s, dict):
            continue
        bullets = s.get("bullets")
        if not isinstance(bullets, list):
            continue
        if not (1 <= len(bullets) <= 4):
            errs.append(
                "slides[%d]: %d bullet (richiesti da 1 a 4)" % (i, len(bullets))
            )
        for j, b in enumerate(bullets):
            if isinstance(b, str):
                w = _words(b)
                if w > 12:
                    errs.append(
                        "slides[%d].bullets[%d]: %d parole (massimo 12)"
                        % (i, j, w)
                    )
    return errs


def check_slide(parsed: Any, ctx: dict) -> List[str]:
    """F11 — ≤ 5 bullet, ≤ 15 parole, niente paragrafi."""
    errs: List[str] = []
    if not isinstance(parsed, dict):
        return errs
    bullets = parsed.get("bullets")
    if not isinstance(bullets, list):
        return errs
    if len(bullets) > 5:
        errs.append("bullets: %d (massimo 5)" % len(bullets))
    for j, b in enumerate(bullets):
        if not isinstance(b, str):
            continue
        if "\n" in b:
            errs.append("bullets[%d]: niente paragrafi/a capo" % j)
        w = _words(b)
        if w > 15:
            errs.append("bullets[%d]: %d parole (massimo 15)" % (j, w))
    return errs


def check_notes(parsed: Any, ctx: dict) -> List[str]:
    """F12 — 60..90 parole."""
    errs: List[str] = []
    if isinstance(parsed, str):
        w = _words(parsed)
        if not (60 <= w <= 90):
            errs.append("note: %d parole (richieste da 60 a 90)" % w)
    return errs


def check_script(parsed: Any, ctx: dict) -> List[str]:
    """F13 - |parole - sec x 2,5| <= 20% di sec x 2,5 (banda +-20%).

    Conteggio NORMALIZZATO via _words_norm (regole documentate nella sua
    docstring: punteggiatura di bordo e spazi multipli non contano).
    Tolleranza alzata 15% -> 20%: deviazione G5b motivata (gate Round 11:
    per un 2B quantizzato +-15% su conteggio parole era strutturalmente
    irraggiungibile, errori osservati 32%-174%).
    """
    errs: List[str] = []
    sec = ctx.get("sec")
    if sec is None or not isinstance(parsed, str):
        return errs
    try:
        sec_f = float(sec)
    except (TypeError, ValueError):
        return errs
    target = sec_f * 2.5
    tol = 0.20 * target
    w = _words_norm(parsed)
    if abs(w - target) > tol:
        errs.append(
            "script: %d parole, attese ~%d (tolleranza +/-%.0f)"
            % (w, round(target), tol)
        )
    return errs


def check_plan(parsed: Any, ctx: dict) -> List[str]:
    """F14 — sessioni ≤ 90 min e senza sovrapposizioni nello stesso giorno."""
    errs: List[str] = []
    sessions = parsed.get("sessions") if isinstance(parsed, dict) else None
    if not isinstance(sessions, list):
        return errs
    by_day: Dict[str, List[tuple]] = {}
    for i, s in enumerate(sessions):
        if not isinstance(s, dict):
            continue
        minutes = s.get("minutes")
        if isinstance(minutes, int) and not isinstance(minutes, bool) and minutes > 90:
            errs.append("sessions[%d]: %d minuti (massimo 90)" % (i, minutes))
        day = str(s.get("day", ""))
        start = s.get("start")
        if isinstance(start, str) and re.fullmatch(
            r"(?:[01]?[0-9]|2[0-3]):[0-5][0-9]", start.strip()
        ):
            h, m = start.strip().split(":")
            start_min = int(h) * 60 + int(m)
            dur = minutes if isinstance(minutes, int) and minutes > 0 else 0
            by_day.setdefault(day, []).append((start_min, start_min + dur, i))
    for day, ivals in by_day.items():
        ivals.sort()
        prev_end, prev_i = -1, None
        for start_min, end_min, i in ivals:
            if prev_end is not None and start_min < prev_end:
                errs.append(
                    "sessions[%d]: sovrapposizione nel giorno %s con sessions[%d]"
                    % (i, day, prev_i)
                )
            if end_min > prev_end:
                prev_end, prev_i = end_min, i
    return errs


def check_labels(parsed: Any, ctx: dict) -> List[str]:
    """F15 — al massimo 3 etichette."""
    errs: List[str] = []
    if isinstance(parsed, dict) and isinstance(parsed.get("labels"), list):
        n = len(parsed["labels"])
        if n > 3:
            errs.append("labels: %d etichette (massimo 3)" % n)
    return errs


def check_questions(parsed: Any, ctx: dict) -> List[str]:
    """F16 — esattamente 3 domande (duplicato difensivo della grammatica)."""
    errs: List[str] = []
    if isinstance(parsed, dict) and isinstance(parsed.get("questions"), list):
        n = len(parsed["questions"])
        if n != 3:
            errs.append("questions: esattamente 3 domande (%d trovate)" % n)
    return errs


def check_payload(parsed: Any, ctx: dict) -> List[str]:
    """F17 — payload già generato: la validità è tutta nella grammatica."""
    return []


VALIDATORS: Dict[str, Callable[[Any, dict], List[str]]] = {
    "deck": check_deck,
    "deck_doc": check_deck_doc,
    "deck_chat": check_deck_chat,
    "judge": check_judge,
    "improve": check_improve,
    "cite": check_cite,
    "explain": check_explain,
    "formula": check_formula,
    "table": check_table,
    "outline": check_outline,
    "slide": check_slide,
    "notes": check_notes,
    "script": check_script,
    "plan": check_plan,
    "labels": check_labels,
    "questions": check_questions,
    "payload": check_payload,
}
