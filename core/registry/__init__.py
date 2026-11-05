"""core/registry — Function registry H4 (solo dati + validazione, stdlib).

Pacchetto:
  grammars.py   parse+validazione JSON e grammatiche strutturali
  templates.py  17 template SYSTEM versionati (v1)
  functions.py  REGISTRY: 17 funzioni utente (F01..F17)
  validators.py regole funzione (quote ⊆ testo, conteggi, tolleranze)
  engine.py     validate_output / repair_prompt / render_user / cache key

Esclusioni PERMANENTI:
  - nessuna funzione di riassunto nota lato utente;
  - nessuna generazione di schemi (da nota/materiale/espansione nodi);
  - sum_v1 / paraph_v1 / ctx_v1 esistono SOLO per i worker interni
    (W2/W1/W4) e non compaiono mai in registry_functions().

NESSUN runtime LLM qui: il runtime H10 userà SidecarClient (non toccato).
"""

from .functions import (
    BUDGET_TOKENS,
    REGISTRY,
    clamp_output_tokens,
    get_function,
    registry_functions,
)
from .grammars import (
    ALLOWED_FUNCTIONS,
    GRAMMAR_IDS,
    GRAMMARS,
    normalize,
    parse_json,
    validate_formula,
    validate_grammar,
)
from .templates import SYS_EXTRAS, TEMPLATES, get_template, render_sys_text
from .validators import VALIDATORS
from .engine import (
    build_cache_key,
    placeholders,
    render_sys,
    render_user,
    repair_prompt,
    validate_output,
)

__all__ = [
    "ALLOWED_FUNCTIONS",
    "BUDGET_TOKENS",
    "GRAMMAR_IDS",
    "GRAMMARS",
    "REGISTRY",
    "SYS_EXTRAS",
    "TEMPLATES",
    "VALIDATORS",
    "build_cache_key",
    "clamp_output_tokens",
    "get_function",
    "get_template",
    "normalize",
    "parse_json",
    "placeholders",
    "registry_functions",
    "render_sys",
    "render_sys_text",
    "render_user",
    "repair_prompt",
    "validate_formula",
    "validate_grammar",
    "validate_output",
]
