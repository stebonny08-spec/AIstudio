"""core/registry/grammars.py — Grammatiche di output del function registry.

Solo stdlib: il JSON viene parsato con ``json`` e la struttura è
convalidata da funzioni scritte a mano (NON un motore JSON-Schema).

Grammatiche disponibili (GRAMMARS):
  G_deck      {cards:[{front,back,hint?,quote,citations?}]}
  G_judge     {judgment: corretto|parziale|errato, feedback, followup?}
  G_outline   {title, slides:[{title,bullets[]}]}
  G_slide     {title, bullets[]}          (slides[1] di G_outline)
  G_formula   stringa EBNF: numeri, ref A1, intervalli A1:B9,
              operatori + - * / ^ (), funzioni
              SUM AVERAGE MIN MAX COUNT IF CONCAT ROUND ABS SQRT POWER
  G_table     {header[], rows[][]}        max 8 colonne x 20 righe
  G_blocks    {sessions:[{day,start,minutes,target}]}
  G_labels    {labels[]}
  G_cite      {answer, citations:[{quote,source}]}
  G_questions {questions[esattamente 3]}
  G_text      stringa non vuoca (output testuali)
  G_payload   G_deck oppure G_text (azioni cross-modulo)

Le regole funzione (quote ⊆ testo, conteggi, vincoli...) stanno in
validators.py; qui vive solo la struttura + i vincoli "locali"
(enum, dimensioni massime, esattamente N, sintassi formula).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

# --------------------------------------------------------------------------
# Formula (EBNF) — costanti e tokenizer/parser ricorsivo discendente
# --------------------------------------------------------------------------

ALLOWED_FUNCTIONS: Tuple[str, ...] = (
    "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "IF",
    "CONCAT", "ROUND", "ABS", "SQRT", "POWER",
)
_ARITY_MIN: Dict[str, int] = {name: 1 for name in ALLOWED_FUNCTIONS}
_ARITY_MIN["CONCAT"] = 2
_ARITY_EXACT: Dict[str, int] = {"IF": 3}

_TOK_INTERVAL = re.compile(r"[A-Za-z]{1,3}[0-9]+:[A-Za-z]{1,3}[0-9]+")
_TOK_REF = re.compile(r"[A-Za-z]{1,3}[0-9]+")
_TOK_NUM = re.compile(r"[0-9]+(?:\.[0-9]+)?")
_TOK_FUNC = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_OPS = frozenset("+-*/^(),")

_JUDGE_ENUM: Tuple[str, ...] = ("corretto", "parziale", "errato")
_TIME_RE = re.compile(r"(?:[01]?[0-9]|2[0-3]):[0-5][0-9]\Z")
_REF_CELL_RE = re.compile(r"[A-Za-z]{1,3}[0-9]+\Z")

MAX_TABLE_COLS = 8
MAX_TABLE_ROWS = 20


def normalize(text: str) -> str:
    """Normalizzazione per i confronti quote ⊆ testo (maiuscole/spazi)."""
    return re.sub(r"\s+", " ", str(text)).strip().lower()


def parse_json(raw: Any) -> Tuple[Any, List[str]]:
    """(1) Parsing JSON. Ritorna (parsed, errors).

    Normalizzazione standard (verificata col modello reale in t2a_gate):
    i modelli producono spesso prosa introduttiva, ```json fenced o testo
    attorno al payload. Prima di dichiarare l'errore si prova, in ordine:
    (a) json.loads sul testo trimmato, (b) strip dei fence markdown,
    (c) estrazione del PRIMO blocco {..}/[..] bilanciato (scan con
    rispetto delle stringhe/escape). Nessuna fabbricazione: si estrae
    solo cio' che il modello ha scritto.
    """
    if isinstance(raw, (dict, list)):
        return raw, []
    if not isinstance(raw, str):
        return None, ["JSON non valido: atteso raw_json come stringa JSON"]
    s = raw.strip()
    try:
        return json.loads(s), []
    except Exception:
        pass
    if "```" in s:
        import re as _re
        m = _re.search(r"```(?:json|JSON)?\s*(.*?)```", s, _re.S)
        cand = m.group(1).strip() if m else s
        try:
            return json.loads(cand), []
        except Exception:
            pass
        cand2 = _re.sub(r"^```(?:json|JSON)?\s*|\s*```$", "",
                        cand.strip(), flags=_re.S)
        try:
            return json.loads(cand2), []
        except Exception:
            pass
    start = min([i for i in (s.find("{"), s.find("[")) if i >= 0], default=-1)
    if start >= 0:
        open_ch = s[start]
        close_ch = "}" if open_ch == "{" else "]"
        depth, in_str, esc = 0, False, False
        for j in range(start, len(s)):
            c = s[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == open_ch:
                depth += 1
            elif c == close_ch:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[start:j + 1]), []
                    except Exception:
                        break
    return None, ["JSON non valido: nessun payload JSON trovato "
                  "(testo iniziale: %r)" % s[:60]]


def _str_ok(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""


# --------------------------------------------------------------------------
# G_formula: tokenizer + parser
# --------------------------------------------------------------------------

def _tokenize_formula(src: str) -> Tuple[List[Tuple[str, str]], List[str]]:
    toks: List[Tuple[str, str]] = []
    errs: List[str] = []
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch.isspace():
            i += 1
            continue
        if ch in _OPS:
            toks.append(("op", ch))
            i += 1
            continue
        rest = src[i:]
        m = _TOK_INTERVAL.match(rest)
        if m:
            toks.append(("interval", m.group(0).upper()))
            i += m.end()
            continue
        m = _TOK_REF.match(rest)
        if m:
            toks.append(("ref", m.group(0).upper()))
            i += m.end()
            continue
        m = _TOK_NUM.match(rest)
        if m:
            toks.append(("num", m.group(0)))
            i += m.end()
            continue
        m = _TOK_FUNC.match(rest)
        if m:
            toks.append(("func", m.group(0)))
            i += m.end()
            continue
        errs.append("token illegale: '%s' alla posizione %d" % (ch, i))
        i += 1
    return toks, errs


class _FormulaParser:
    """expr := add; add := mul (('+'|'-') mul)*; mul := pow (('*'|'/') pow)*
    pow := unary ('^' pow)?; unary := '-' unary | primary;
    primary := num | ref | interval | FUNC '(' args ')' | '(' expr ')'"""

    def __init__(self, toks: List[Tuple[str, str]]):
        self.toks = toks
        self.i = 0
        self.errs: List[str] = []

    def peek(self) -> Optional[Tuple[str, str]]:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self) -> Optional[Tuple[str, str]]:
        t = self.peek()
        if t is not None:
            self.i += 1
        return t

    def _op_is(self, chars: str) -> bool:
        t = self.peek()
        return t is not None and t[0] == "op" and t[1] in chars

    def parse(self) -> List[str]:
        if not self.toks:
            self.errs.append("formula vuota")
            return self.errs
        self._expr()
        if self.i < len(self.toks):
            self.errs.append("token inatteso: '%s'" % self.toks[self.i][1])
        return self.errs

    def _expr(self) -> None:
        self._add()

    def _add(self) -> None:
        self._mul()
        while self._op_is("+-"):
            self.take()
            self._mul()

    def _mul(self) -> None:
        self._pow()
        while self._op_is("*/"):
            self.take()
            self._pow()

    def _pow(self) -> None:
        self._unary()
        if self._op_is("^"):
            self.take()
            self._pow()

    def _unary(self) -> None:
        if self._op_is("-"):
            self.take()
            self._unary()
            return
        self._primary()

    def _primary(self) -> None:
        t = self.take()
        if t is None:
            self.errs.append("formula incompleta: atteso un operando")
            return
        kind, val = t
        if kind in ("num", "ref", "interval"):
            return
        if kind == "op" and val == "(":
            self._expr()
            if self._op_is(")"):
                self.take()
            else:
                self.errs.append("attesa parentesi ')'")
            return
        if kind == "func":
            fname = val.upper()
            if not self._op_is("("):
                self.errs.append("attesa '(' dopo la funzione %s" % val)
                return
            self.take()  # '('
            args = 0
            if self._op_is(")"):
                self.take()
            else:
                while True:
                    self._expr()
                    args += 1
                    if self._op_is(","):
                        self.take()
                        continue
                    if self._op_is(")"):
                        self.take()
                        break
                    self.errs.append("attesa ',' o ')' negli argomenti di %s" % val)
                    break
            if fname not in ALLOWED_FUNCTIONS:
                self.errs.append(
                    "funzione non ammessa: %s (consentite: %s)"
                    % (val, ", ".join(ALLOWED_FUNCTIONS))
                )
            elif fname in _ARITY_EXACT and args != _ARITY_EXACT[fname]:
                self.errs.append(
                    "funzione %s richiede esattamente %d argomenti (%d trovati)"
                    % (fname, _ARITY_EXACT[fname], args)
                )
            elif args < _ARITY_MIN.get(fname, 1):
                self.errs.append(
                    "funzione %s richiede almeno %d argomenti (%d trovati)"
                    % (fname, _ARITY_MIN.get(fname, 1), args)
                )
            return
        self.errs.append("token inatteso: '%s'" % val)


def validate_formula(value: Any) -> List[str]:
    """Valida la sintassi EBNF di una formula di foglio."""
    if not isinstance(value, str):
        return ["formula: atteso una stringa"]
    src = value.strip()
    if src.startswith("="):
        src = src[1:].strip()
    if not src:
        return ["formula vuota"]
    toks, errs = _tokenize_formula(src)
    if errs:
        return errs
    return _FormulaParser(toks).parse()


# --------------------------------------------------------------------------
# Validatori strutturali
# --------------------------------------------------------------------------

def _g_deck(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON con chiave 'cards'"]
    cards = obj.get("cards")
    if not isinstance(cards, list) or not cards:
        return ["struttura: 'cards' deve essere una lista non vuota"]
    errs: List[str] = []
    for i, c in enumerate(cards):
        if not isinstance(c, dict):
            errs.append("cards[%d]: atteso oggetto {front,back,quote}" % i)
            continue
        for k in ("front", "back", "quote"):
            if not _str_ok(c.get(k)):
                errs.append("cards[%d].%s: stringa non vuota obbligatoria" % (i, k))
        if "hint" in c and c.get("hint") is not None and not isinstance(c.get("hint"), str):
            errs.append("cards[%d].hint: deve essere stringa o null" % i)
        cit = c.get("citations")
        if cit is not None:
            if not isinstance(cit, list):
                errs.append("cards[%d].citations: attesa lista" % i)
            else:
                for j, ct in enumerate(cit):
                    if not isinstance(ct, dict):
                        errs.append("cards[%d].citations[%d]: atteso oggetto {quote,source}" % (i, j))
                        continue
                    for k in ("quote", "source"):
                        if not _str_ok(ct.get(k)):
                            errs.append(
                                "cards[%d].citations[%d].%s: stringa non vuota obbligatoria"
                                % (i, j, k)
                            )
    return errs


def _g_judge(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON {judgment,feedback}"]
    errs: List[str] = []
    if obj.get("judgment") not in _JUDGE_ENUM:
        errs.append(
            "judgment: valore non valido %r (ammessi: %s)"
            % (obj.get("judgment"), "|".join(_JUDGE_ENUM))
        )
    if not _str_ok(obj.get("feedback")):
        errs.append("feedback: stringa non vuota obbligatoria")
    if "followup" in obj and obj.get("followup") is not None and not _str_ok(obj.get("followup")):
        errs.append("followup: se presente deve essere una stringa non vuota")
    return errs


def _g_outline(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON {title,slides}"]
    errs: List[str] = []
    if not _str_ok(obj.get("title")):
        errs.append("title: stringa non vuota obbligatoria")
    slides = obj.get("slides")
    if not isinstance(slides, list) or not slides:
        return errs + ["slides: deve essere una lista non vuota"]
    for i, s in enumerate(slides):
        if not isinstance(s, dict):
            errs.append("slides[%d]: atteso oggetto {title,bullets}" % i)
            continue
        if not _str_ok(s.get("title")):
            errs.append("slides[%d].title: stringa non vuota obbligatoria" % i)
        bullets = s.get("bullets")
        if not isinstance(bullets, list):
            errs.append("slides[%d].bullets: attesa lista" % i)
            continue
        for j, b in enumerate(bullets):
            if not _str_ok(b):
                errs.append("slides[%d].bullets[%d]: stringa non vuota obbligatoria" % (i, j))
    return errs


def _g_slide(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON {title,bullets}"]
    errs: List[str] = []
    if not _str_ok(obj.get("title")):
        errs.append("title: stringa non vuota obbligatoria")
    bullets = obj.get("bullets")
    if not isinstance(bullets, list) or not bullets:
        return errs + ["bullets: deve essere una lista non vuota"]
    for j, b in enumerate(bullets):
        if not _str_ok(b):
            errs.append("bullets[%d]: stringa non vuota obbligatoria" % j)
    return errs


def _g_formula(obj: Any, ctx: Optional[dict]) -> List[str]:
    return validate_formula(obj)


def _g_table(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON {header,rows}"]
    errs: List[str] = []
    header = obj.get("header")
    if not isinstance(header, list) or not header:
        return ["header: deve essere una lista non vuota"]
    for j, h in enumerate(header):
        if not _str_ok(h):
            errs.append("header[%d]: stringa non vuota obbligatoria" % j)
    if len(header) > MAX_TABLE_COLS:
        errs.append(
            "header: massimo %d colonne (%d trovate)" % (MAX_TABLE_COLS, len(header))
        )
    rows = obj.get("rows")
    if not isinstance(rows, list) or not rows:
        return errs + ["rows: deve essere una lista non vuota"]
    if len(rows) > MAX_TABLE_ROWS:
        errs.append("rows: massimo %d righe (%d trovate)" % (MAX_TABLE_ROWS, len(rows)))
    for i, r in enumerate(rows):
        if not isinstance(r, list):
            errs.append("rows[%d]: attesa lista di celle" % i)
            continue
        if len(r) != len(header):
            errs.append(
                "rows[%d]: %d celle, ma header ne ha %d" % (i, len(r), len(header))
            )
        for j, cell in enumerate(r):
            if not isinstance(cell, str):
                errs.append("rows[%d][%d]: attesa stringa" % (i, j))
    return errs


def _g_blocks(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON con chiave 'sessions'"]
    sessions = obj.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        return ["sessions: deve essere una lista non vuota"]
    errs: List[str] = []
    for i, s in enumerate(sessions):
        if not isinstance(s, dict):
            errs.append("sessions[%d]: atteso oggetto {day,start,minutes,target}" % i)
            continue
        if not _str_ok(s.get("day")):
            errs.append("sessions[%d].day: stringa non vuota obbligatoria" % i)
        start = s.get("start")
        if not isinstance(start, str) or not _TIME_RE.match(start.strip()):
            errs.append("sessions[%d].start: atteso orario HH:MM (trovato %r)" % (i, start))
        minutes = s.get("minutes")
        if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes <= 0:
            errs.append("sessions[%d].minutes: atteso intero positivo" % i)
        if not _str_ok(s.get("target")):
            errs.append("sessions[%d].target: stringa non vuota obbligatoria" % i)
    return errs


def _g_labels(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON con chiave 'labels'"]
    labels = obj.get("labels")
    if not isinstance(labels, list) or not labels:
        return ["labels: deve essere una lista non vuota"]
    errs: List[str] = []
    for j, lab in enumerate(labels):
        if not _str_ok(lab):
            errs.append("labels[%d]: stringa non vuota obbligatoria" % j)
    return errs


def _g_cite(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON {answer,citations}"]
    errs: List[str] = []
    if not _str_ok(obj.get("answer")):
        errs.append("answer: stringa non vuota obbligatoria")
    citations = obj.get("citations")
    if not isinstance(citations, list) or not citations:
        return errs + ["citations: deve essere una lista non vuota"]
    for j, c in enumerate(citations):
        if not isinstance(c, dict):
            errs.append("citations[%d]: atteso oggetto {quote,source}" % j)
            continue
        for k in ("quote", "source"):
            if not _str_ok(c.get(k)):
                errs.append("citations[%d].%s: stringa non vuota obbligatoria" % (j, k))
    return errs


def _g_questions(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not isinstance(obj, dict):
        return ["struttura: atteso oggetto JSON con chiave 'questions'"]
    qs = obj.get("questions")
    if not isinstance(qs, list):
        return ["questions: deve essere una lista"]
    errs: List[str] = []
    if len(qs) != 3:
        errs.append("questions: esattamente 3 domande (%d trovate)" % len(qs))
    for j, q in enumerate(qs):
        if not _str_ok(q):
            errs.append("questions[%d]: stringa non vuota obbligatoria" % j)
    return errs


def _g_text(obj: Any, ctx: Optional[dict]) -> List[str]:
    if not _str_ok(obj):
        return ["testo: attesa una stringa non vuota"]
    return []


def _g_payload(obj: Any, ctx: Optional[dict]) -> List[str]:
    if isinstance(obj, str):
        return [] if obj.strip() else ["payload: stringa vuota"]
    if isinstance(obj, dict) and "cards" in obj:
        return _g_deck(obj, ctx)
    return ["payload: atteso un mazzo G_deck oppure una stringa di testo"]


GRAMMARS: Dict[str, Any] = {
    "G_deck": _g_deck,
    "G_judge": _g_judge,
    "G_outline": _g_outline,
    "G_slide": _g_slide,
    "G_formula": _g_formula,
    "G_table": _g_table,
    "G_blocks": _g_blocks,
    "G_labels": _g_labels,
    "G_cite": _g_cite,
    "G_questions": _g_questions,
    "G_text": _g_text,
    "G_payload": _g_payload,
}

GRAMMAR_IDS: Tuple[str, ...] = tuple(GRAMMARS.keys())


def validate_grammar(gid: str, obj: Any, ctx: Optional[dict] = None) -> List[str]:
    """(2) Validazione struttura. Ritorna la lista di errori (vuota = ok)."""
    fn = GRAMMARS.get(gid)
    if fn is None:
        return ["grammatica sconosciuta: %s" % gid]
    try:
        return list(fn(obj, ctx))
    except Exception as exc:  # difensivo: mai far esplodere il caller
        return ["errore interno grammatica %s: %s" % (gid, exc)]
