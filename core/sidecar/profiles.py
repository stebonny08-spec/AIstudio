"""Profili di sampling per il sidecar llama-server (T1).

SAMPLING_PROFILES - versione 'v1':
  fast  : chat interattiva rapida (temp 0.8, top_p 0.95)
  think : reasoning esteso   (temp 0.6, classi think/standard)
  tool  : output JSON        (temp 0.1, stop su riga vuota, json_mode)

clamp_max_tokens(profile, classe) ritorna il budget token della classe
(micro 200, standard 600, think 1500; classe sconosciuta -> standard).
build_args(profile, n_ctx) ritorna un dict di parametri per llama.
"""

from __future__ import annotations

__all__ = [
    "SAMPLING_PROFILES",
    "TOKEN_BUDGET",
    "DEFAULT_CLASSE",
    "PRO_SAMPLING_OVERRIDE",
    "get_profile",
    "clamp_max_tokens",
    "build_args",
    "apply_model_sampling",
]

# Budget token per classe (identico ai valori dichiarati nei profili).
TOKEN_BUDGET = {"micro": 200, "standard": 600, "think": 1500}
DEFAULT_CLASSE = "standard"

SAMPLING_PROFILES = {
    "version": "v1",
    "profiles": {
        "fast": {
            "temp": 0.8,
            "top_p": 0.95,
            "classi": {"micro": 200, "standard": 600},
        },
        "think": {
            "temp": 0.6,
            "classi": {"think": 1500, "standard": 600},
        },
        "tool": {
            "temp": 0.1,
            "stop": ["\n\n"],
            "json_mode": True,
            "classi": {"micro": 200, "standard": 600},
        },
    },
}


# ---------------------------------------------------------------------
# R22: override di sampling per il modello PRO (Spark-X2.6-4B).
# Valori dalla model card Hugging Face (esempi llama.cpp/vLLM/SGLang):
#   temperature 1.0, top_p 0.95, top_k -1, repetition_penalty 1,
#   presence/frequency 0 (ultimi due non esposti da llama-server nel
#   body -> non applicati, dichiarati a vuoto).
# L'override vale SOLO per il profilo 'fast' con il pro attivo: il
# modello base (e i profili think/tool) restano IDENTICI a prima.
# ---------------------------------------------------------------------
PRO_SAMPLING_OVERRIDE = {
    "temp": 1.0,
    "top_p": 0.95,
    "top_k": -1,
    "repetition_penalty": 1.0,
}


def apply_model_sampling(prof, profile: str = "", model_key: str = "") -> dict:
    """R22: applica l'override di sampling del pro SOLO al profilo fast.

    - model_key != 'pro'  -> profilo invariato (base, anche in fallback)
    - profile != 'fast'   -> think/tool invariati (output JSON intatto)
    """
    if model_key == "pro" and profile == "fast" and isinstance(prof, dict):
        out = dict(prof)
        out.update(PRO_SAMPLING_OVERRIDE)
        return out
    return prof


def get_profile(profile):
    """Ritorna il dict del profilo.

    Accetta il nome (str) oppure direttamente un dict; per un nome
    sconosciuto ritorna il profilo 'fast' (mai eccezione).
    """
    if isinstance(profile, dict):
        return profile
    profiles = SAMPLING_PROFILES.get("profiles", {}) or {}
    prof = profiles.get(profile) if isinstance(profile, str) else None
    if prof is None:
        prof = profiles.get("fast", {})
    return prof


def clamp_max_tokens(profile, classe) -> int:
    """Budget token per la classe, limitato dal profilo.

    - classe dichiarata nel profilo -> quel valore
    - altrimenti budget generale (micro 200 / standard 600 / think 1500)
    - classe sconosciuta -> standard (600)
    """
    prof = get_profile(profile)
    classi = prof.get("classi") or {}
    if classe in classi:
        return int(classi[classe])
    if classe in TOKEN_BUDGET:
        return int(TOKEN_BUDGET[classe])
    return int(TOKEN_BUDGET[DEFAULT_CLASSE])


def build_args(profile, n_ctx=4096) -> dict:
    """Parametri di sampling/context per llama-server (dict, non lista argv)."""
    prof = get_profile(profile)
    try:
        n_ctx = int(n_ctx)
    except (TypeError, ValueError):
        n_ctx = 4096
    return {
        "n_ctx": n_ctx,
        "temperature": float(prof.get("temp", 0.8)),
        "top_p": float(prof.get("top_p", 1.0)),
        "stop": list(prof.get("stop") or []),
        "json_mode": bool(prof.get("json_mode", False)),
    }
