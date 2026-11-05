# -*- coding: utf-8 -*-
"""qa/r15_patch_llm.py — patch verificata di core/local_llm_client.py (R15b G0+G2b).

Ogni sostituzione deve matchare ESATTAMENTE 1 volta, altrimenti abort.
  1) istruzione prompt "parziale" (G2b, backward-compat: senza il flag il
     prompt resta IDENTICO)
  2) flag outcome nei passaggi di costruzione del prompt
  3) FIX SIDECAR-DEAD in SidecarLLMProxy (G0)
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "core", "local_llm_client.py")

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

orig_len = len(src)
PATCHES = []  # (old, new)

# ---- R1: costante istruzioni parziale -------------------------------------
PATCHES.append((
    '_THINK_OPEN_RE = re.compile(r"<(?:think|thinking)>", re.IGNORECASE)',
    '# R15b G2b - istruzione SOLO per esito "parziale" del gate precoce\n'
    '# (core/rag/gate.py decide_gate). Backward-compat: senza il flag\n'
    '# outcome="parziale" il prompt di sistema resta IDENTICO a prima.\n'
    '_PARTIAL_OUTCOME_INSTRUCTION = (\n'
    '    "RECUPERO PARZIALE NEI MATERIALI LOCALI: le fonti fornite contengono "\n'
    '    "solo PARTE di cio\' che serve a rispondere. Rispondi usando "\n'
    '    "ESCLUSIVAMENTE le fonti indicate, aprendo con "\n'
    '    "\'Ho trovato solo questo nei materiali: \' e citando ogni "\n'
    '    "affermazione con la sua fonte (e il punteggio di pertinenza, se "\n'
    '    "indicato). NON inventare, NON completare con conoscenze generali e "\n'
    '    "NON fingere completezza: se un dettaglio non e\' nelle fonti, dillo "\n'
    '    "esplicitamente."\n'
    ')\n\n'
    '_THINK_OPEN_RE = re.compile(r"<(?:think|thinking)>", re.IGNORECASE)',
))

# ---- R2: firma _build_system_prompt ---------------------------------------
PATCHES.append((
    'def _build_system_prompt(\n'
    '    study_mode: str,\n'
    '    context_kind: str,\n'
    '    allow_fallback_marker: bool,\n'
    '    chitchat: bool,\n'
    '    part_index: int = 0,\n'
    '    is_last_part: bool = True,\n'
    ') -> str:',
    'def _build_system_prompt(\n'
    '    study_mode: str,\n'
    '    context_kind: str,\n'
    '    allow_fallback_marker: bool,\n'
    '    chitchat: bool,\n'
    '    part_index: int = 0,\n'
    '    is_last_part: bool = True,\n'
    '    outcome: Optional[str] = None,\n'
    ') -> str:',
))

# ---- R3: blocco technical --------------------------------------------------
PATCHES.append((
    '    technical = [_LANGUAGE_INSTRUCTION]\n'
    '    if allow_fallback_marker:\n'
    '        technical.append(_FALLBACK_INSTRUCTION)\n'
    '    elif context_kind == "locale":\n'
    '        technical.append(_NO_FALLBACK_LOCAL_INSTRUCTION)\n'
    '    elif context_kind == "none":\n'
    '        technical.append(_NO_CONTEXT_INSTRUCTION)\n',
    '    technical = [_LANGUAGE_INSTRUCTION]\n'
    '    if allow_fallback_marker:\n'
    '        technical.append(_FALLBACK_INSTRUCTION)\n'
    '    elif context_kind == "locale":\n'
    '        technical.append(_NO_FALLBACK_LOCAL_INSTRUCTION)\n'
    '    elif context_kind == "none":\n'
    '        technical.append(_NO_CONTEXT_INSTRUCTION)\n'
    '    # R15b G2b: SOLO con il flag esplicito il prompt cambia\n'
    '    if outcome == "parziale":\n'
    '        technical.append(_PARTIAL_OUTCOME_INSTRUCTION)\n',
))

# ---- R4: _prepare_messages -------------------------------------------------
PATCHES.append((
    '        parts_summaries,\n'
    '        history_turns=None,\n'
    '    ) -> list:\n'
    '        system_prompt = _build_system_prompt(\n'
    '            study_mode=study_mode,\n'
    '            context_kind=context_kind,\n'
    '            allow_fallback_marker=allow_fallback_marker,\n'
    '            chitchat=chitchat,\n'
    '            part_index=part_index,\n'
    '            is_last_part=is_last_part,\n'
    '        )',
    '        parts_summaries,\n'
    '        history_turns=None,\n'
    '        outcome=None,\n'
    '    ) -> list:\n'
    '        system_prompt = _build_system_prompt(\n'
    '            study_mode=study_mode,\n'
    '            context_kind=context_kind,\n'
    '            allow_fallback_marker=allow_fallback_marker,\n'
    '            chitchat=chitchat,\n'
    '            part_index=part_index,\n'
    '            is_last_part=is_last_part,\n'
    '            outcome=outcome,\n'
    '        )',
))

# ---- R5: firma generate_stream --------------------------------------------
PATCHES.append((
    '    ) -> Generator[str, None, None]:\n'
    '        if parts_summaries is None:\n'
    '            parts_summaries = []\n'
    '\n'
    '        messages = self._prepare_messages(',
    '        outcome: Optional[str] = None,\n'
    '    ) -> Generator[str, None, None]:\n'
    '        if parts_summaries is None:\n'
    '            parts_summaries = []\n'
    '\n'
    '        messages = self._prepare_messages(',
))

# ---- R6: chiamata _prepare_messages in generate_stream ---------------------
PATCHES.append((
    '        messages = self._prepare_messages(\n'
    '            query, context_kind, local_chunks, web_results,\n'
    '            allow_fallback_marker, study_mode, chitchat,\n'
    '            part_index, is_last_part, parts_summaries,\n'
    '            history_turns=history_turns,\n'
    '        )',
    '        messages = self._prepare_messages(\n'
    '            query, context_kind, local_chunks, web_results,\n'
    '            allow_fallback_marker, study_mode, chitchat,\n'
    '            part_index, is_last_part, parts_summaries,\n'
    '            history_turns=history_turns,\n'
    '            outcome=outcome,\n'
    '        )',
))

# ---- R7: firma stream_via_sidecar -----------------------------------------
PATCHES.append((
    '    ) -> Generator[str, None, None]:\n'
    '        """Stream via sidecar con fallback in-process (mai eccezione cruda)."""\n',
    '        outcome: Optional[str] = None,\n'
    '    ) -> Generator[str, None, None]:\n'
    '        """Stream via sidecar con fallback in-process (mai eccezione cruda)."""\n',
))

# ---- R8: chiamata _prepare_messages in stream_via_sidecar ------------------
PATCHES.append((
    '                    messages = self._prepare_messages(\n'
    '                        query, context_kind, local_chunks, web_results,\n'
    '                        allow_fallback_marker, study_mode, chitchat,\n'
    '                        part_index, is_last_part, parts_summaries,\n'
    '                        history_turns=history_turns,\n'
    '                    )',
    '                    messages = self._prepare_messages(\n'
    '                        query, context_kind, local_chunks, web_results,\n'
    '                        allow_fallback_marker, study_mode, chitchat,\n'
    '                        part_index, is_last_part, parts_summaries,\n'
    '                        history_turns=history_turns,\n'
    '                        outcome=outcome,\n'
    '                    )',
))

# ---- R9: SidecarLLMProxy (FIX SIDECAR-DEAD) -------------------------------
NEW_PROXY = '''class SidecarLLMProxy:
    """Delega generate/generate_stream -> sidecar; il resto -> target."""

    def __init__(self, target):
        self._target = target

    def __getattr__(self, name):
        return getattr(self._target, name)

    # ------------------------------------------------------------------
    # R15b G0 - FIX SIDECAR-DEAD (ripertuto con traceback reale in
    # qa/r15_g0_prima.json): il bind partiva da
    # type(target).stream_via_sidecar, cioe' una funzione NON bound ->
    # 'self' assorbe il primo argomento reale ->
    # TypeError "missing a required argument: 'query'" -> catturato in
    # silenzio -> fallback SEMPRE in-process (llama-server mai avviato,
    # state=down misurato).
    # Ora il bind parte dal metodo che il chiamante ha REALMENTE invocato
    # (self esplicito): gli argomenti posizionali sono mappati sui nomi
    # corretti e ripassati come keyword a stream_via_sidecar. Se un
    # parametro non e' accettato dalla destinazione -> strada in-process,
    # esattamente come prima (nessun cambio di comportamento).
    # ------------------------------------------------------------------
    def _sidecar_kwargs(self, method_name, args, kwargs):
        """(ok, kwargs) da usare per stream_via_sidecar sul target."""
        import inspect
        tgt = self._target
        try:
            sig = inspect.signature(getattr(type(tgt), method_name))
            bound = sig.bind(tgt, *args, **kwargs)
            dest = inspect.signature(type(tgt).stream_via_sidecar)
        except (TypeError, ValueError, AttributeError):
            return False, None
        call = dict(bound.arguments)
        call.pop("self", None)
        if method_name == "generate":
            # generate(self, query, **kwargs): il **kwargs va esplicitato
            call.update(call.pop("kwargs", None) or {})
        allowed = set(dest.parameters)
        if any(k not in allowed for k in call):
            return False, None
        return True, call

    def generate_stream(self, *args, **kwargs):
        ok, call = self._sidecar_kwargs("generate_stream", args, kwargs)
        if not ok:
            return self._target.generate_stream(*args, **kwargs)
        return self._target.stream_via_sidecar(**call)

    def generate(self, *args, **kwargs):
        ok, call = self._sidecar_kwargs("generate", args, kwargs)
        if not ok:
            return self._target.generate(*args, **kwargs)
        return self._target.generated_via_sidecar(**call)
'''

# --- applica ---
report = []
for i, (old, new) in enumerate(PATCHES, 1):
    n = src.count(old)
    if n != 1:
        sys.exit("ABORT: patch R%d matcha %d volte (atteso 1)" % (i, n))
    src = src.replace(old, new, 1)
    report.append("R%d ok" % i)

if 'sig.bind(*args, **kwargs)  # TypeError se firme incompatibili' not in src:
    sys.exit("ABORT: testo vecchio del proxy non trovato")
idx = src.index("class SidecarLLMProxy:")
src = src[:idx] + NEW_PROXY
if "type(self._target).stream_via_sidecar" in src:
    sys.exit("ABORT: codice morto residuo nel proxy")
report.append("R9 ok (SidecarLLMProxy riscritto)")

with io.open(PATH, "w", encoding="utf-8", newline="\n") as f:
    f.write(src)

import ast
ast.parse(src)  # sintassi garantita
print("PATCH OK: %d -> %d byte | %s" % (orig_len, len(src), ", ".join(report)))
