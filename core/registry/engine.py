"""core/registry/engine.py — Solo DATI + VALIDAZIONE. NESSUN LLM.

L'engine del registry NON esegue mai inferenza: il runtime (H10) usa il
SidecarClient per le chiamate al modello (qui NON toccato). Questo modulo
fornisce:

  registry_functions() / get_function(id)   — il registro delle 17 voci
  render_user(fid, **kwargs)                — user template con placeholder
  render_sys(fid, **kwargs)                 — sys template (+ extra contesto)
  validate_output(fid, raw_json, ctx)       — (ok, parsed, errors):
      (1) parse JSON  (2) grammatica  (3) regole funzione
  repair_prompt(fid, errors)                — prompt per 1 retry (lo fa il
      caller; in fallback si applica il 'fallback' del registro)
  build_cache_key(fid, kwargs)              — chiave deterministica sha256
"""

from __future__ import annotations

import hashlib
import json
import re
import string
from typing import Any, Dict, List, Optional, Tuple

from .functions import (
    BUDGET_TOKENS,
    REGISTRY,
    clamp_output_tokens,
    get_function,
    registry_functions,
)
from .grammars import parse_json, validate_grammar
from .templates import SYS_EXTRAS, TEMPLATES, render_sys_text
from .validators import VALIDATORS

_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def placeholders(user_template: str) -> List[str]:
    """Estrae i nomi dei placeholder {x} da un template."""
    names: List[str] = []
    for _, fname, _, _ in string.Formatter().parse(user_template):
        if fname:
            names.append(fname)
    return names


def render_user(fid: str, **kwargs: Any) -> str:
    """Sostituisce TUTTI i placeholder dell'user template (nessuno residuo)."""
    entry = get_function(fid)
    tpl = entry["user_template"]
    missing = [n for n in placeholders(tpl) if n not in kwargs]
    if missing:
        raise ValueError(
            "render_user(%s): placeholder mancante/i: %s"
            % (fid, ", ".join(sorted(missing)))
        )
    return tpl.format(**kwargs)


def render_sys(fid: str, **kwargs: Any) -> str:
    """Sys template (eventuale extra: contest/tabella) con placeholder fixati."""
    entry = get_function(fid)
    sys_id = entry.get("sys")
    if not sys_id:
        return ""
    return render_sys_text(sys_id, entry.get("sys_extra"), **kwargs)


def validate_output(
    fid: str, raw_json: Any, ctx: Optional[dict] = None
) -> Tuple[bool, Any, List[str]]:
    """(1) parse JSON -> (2) grammatica -> (3) regole funzione.

    Ritorna (ok, parsed, errors). Su errore il caller può costruire
    repair_prompt(fid, errors) per 1 solo retry e, in ultima istanza,
    applicare il fallback dichiarato nella voce del registro.
    """
    ctx = ctx if ctx is not None else {}
    try:
        entry = get_function(fid)
    except KeyError as exc:
        return False, None, [exc.args[0] if exc.args else str(exc)]

    parsed, errors = parse_json(raw_json)
    if errors:
        return False, None, errors

    errors = list(validate_grammar(entry["grammar"], parsed, ctx))
    if errors:
        return False, parsed, errors

    check = VALIDATORS.get(entry["validator"])
    if check is None:
        return False, parsed, [
            "validator mancante per %s: %s" % (fid, entry["validator"])
        ]
    try:
        errors = list(check(parsed, ctx))
    except Exception as exc:  # mai far esplodere il caller
        errors = ["regola interna '%s': %s" % (entry["validator"], exc)]
    return (not errors), parsed, errors


def repair_prompt(fid: str, errors: List[str]) -> str:
    """Prompt per il 1° (e ultimo) retry: elenca tutti gli errori trovati."""
    entry = get_function(fid)
    lines = "\n".join("- %s" % e for e in errors) or "- (nessun errore dettagliato)"
    sys_id = entry.get("sys") or "nessuno"
    return (
        "Il tuo ultimo output per la funzione '%s' (%s) NON è valido.\n"
        "Correggi SOLO gli errori elencati e ritorna di nuovo SOLO il JSON "
        "senza alcun altro testo.\n"
        "Errori:\n%s\n"
        "Template system: %s.\n"
        "Se non riesci a correggere, non inventare: rispondi con il JSON "
        "minimo valido più vicino."
        % (fid, entry["nome"], lines, sys_id)
    )


def build_cache_key(fid: str, kwargs: Dict[str, Any]) -> str:
    """Chiave di cache deterministica sui campi dichiarati in cache_key.

    sha256 del JSON ordinato dei soli campi elencati (nessun hash() di
    Python: sale tra le sessioni e non sarebbe deterministico).
    """
    entry = get_function(fid)
    fields = entry.get("cache_key") or []
    payload = {f: kwargs.get(f) for f in fields}
    blob = json.dumps(
        payload, sort_keys=True, ensure_ascii=False, default=str, separators=(",", ":")
    )
    digest = hashlib.sha256(("%s|%s" % (fid, blob)).encode("utf-8")).hexdigest()
    return "%s:%s" % (fid, digest[:32])


__all__ = [
    "BUDGET_TOKENS",
    "REGISTRY",
    "SYS_EXTRAS",
    "TEMPLATES",
    "VALIDATORS",
    "build_cache_key",
    "clamp_output_tokens",
    "get_function",
    "parse_json",
    "placeholders",
    "registry_functions",
    "render_sys",
    "render_user",
    "repair_prompt",
    "validate_output",
]
