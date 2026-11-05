"""core/registry/functions.py — REGISTRY delle 17 funzioni utente (H4).

Ogni voce:
  id, trigger_ui, sys (template id), user_template, grammar,
  validator, cache_key, fallback, budget_classe

Budget di output (token, clamp costante):
  micro <= 200, standard <= 600, think <= 1500.

Il registro è solo DATI: nessuna chiamata LLM, nessun sidecar.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List

BUDGET_TOKENS: Dict[str, int] = {
    "micro": 200,
    "standard": 600,
    "think": 1500,
}

REGISTRY: Dict[str, Dict[str, Any]] = {
    "F01": {
        "id": "F01",
        "nome": "flashcard_from_selection",
        "trigger_ui": "Appunti/Doc su selezione",
        "sys": "flash_v1",
        "sys_extra": None,
        "user_template": (
            "Materia: {materia}.\n"
            "Crea esattamente {n} flashcard dal testo: \"\"\"{testo}\"\"\""
        ),
        "grammar": "G_deck",
        "validator": "deck",
        "cache_key": ["materia", "testo", "n"],
        "fallback": "bottone disabilitato",
        "budget_classe": "standard",
        "note": "Salvataggio solo dopo approvazione umana.",
    },
    "F02": {
        "id": "F02",
        "nome": "flashcard_from_material",
        "trigger_ui": "Biblioteca \u00b7 materiale \u2192 \u00abAI mazzo\u00bb (G6 cablato)",
        "sys": "flash_v1",
        "sys_extra": "contest",
        "user_template": (
            "Materia: {materia}. Documento: {doc_id}, sezione: {sezione}.\n"
            "Crea esattamente {n} flashcard dal testo della sezione: "
            "\"\"\"{testo}\"\"\""
        ),
        "grammar": "G_deck",
        "validator": "deck_doc",
        "cache_key": ["doc_id", "sezione", "n"],
        "fallback": "disabilitato",
        "budget_classe": "standard",
        "note": "Salvataggio solo dopo approvazione umana.",
    },
    "F03": {
        "id": "F03",
        "nome": "flashcard_from_conversation",
        "trigger_ui": "chat",
        "sys": "flash_v1",
        "sys_extra": None,
        "user_template": "Trasforma in 1 flashcard: Q:{q} A:{a}",
        "grammar": "G_deck",
        "validator": "deck_chat",
        "cache_key": ["q", "a"],
        "fallback": "disabilitato",
        "budget_classe": "micro",
        "note": None,
    },
    "F04": {
        "id": "F04",
        "nome": "judge_answer",
        "trigger_ui": "Ripasso tutor dopo risposta",
        "sys": "judge_v1",
        "sys_extra": None,
        "user_template": (
            "Card front: {front}. Back: {back}. "
            "Risposta dello studente: {risp}. Giudica la risposta."
        ),
        "grammar": "G_judge",
        "validator": "judge",
        "cache_key": ["front", "back", "risp"],
        "fallback": "mostra back",
        "budget_classe": "micro",
        "note": None,
    },
    "F05": {
        "id": "F05",
        "nome": "improve_text",
        "trigger_ui": "Doc su selezione (intent: chiaro|conciso|formale)",
        "sys": "improve_v1",
        "sys_extra": None,
        "user_template": (
            "Riscrivi in modo {intent} mantenendo tutti i fatti. "
            "BOZZA: \"\"\"{bozza}\"\"\""
        ),
        "grammar": "G_text",
        "validator": "improve",
        "cache_key": ["intent", "bozza"],
        "fallback": "nessun cambio",
        "budget_classe": "standard",
        "note": "Undo disponibile lato UI.",
    },
    "F06": {
        "id": "F06",
        "nome": "insert_citation",
        "trigger_ui": "Documenti \u00ab menu contestuale \u00ab Inserisci citazione da materiali \u00bb (F67a)",
        "sys": "cite_v1",
        "sys_extra": None,
        "user_template": (
            "Documenti: {docs}.\n"
            "Rispondi SOLO dai passaggi forniti: {chunks}.\n"
            "Domanda: {q}"
        ),
        "grammar": "G_cite",
        "validator": "cite",
        "cache_key": ["q", "docs"],
        "fallback": "manuale",
        "budget_classe": "think",
        "note": (
            "UI F67a: preview [Accetta]/[Scarta]; su Accetta inserimento al "
            "cursore con undo + badge; fallback 'manuale' = estratto manuale "
            "con metadati fonte (percorso degradato dichiarato)."
        ),
    },
    "F07": {
        "id": "F07",
        "nome": "explain_formula",
        "trigger_ui": "Fogli cella formula",
        "sys": "explain_v1",
        "sys_extra": None,
        "user_template": "Spiega la formula: {f}",
        "grammar": "G_text",
        "validator": "explain",
        "cache_key": ["f"],
        "fallback": "statico",
        "budget_classe": "micro",
        "note": "Regola: al massimo 5 bullet.",
    },
    "F08": {
        "id": "F08",
        "nome": "nl_to_formula",
        "trigger_ui": "Fogli NL",
        "sys": "nlformula_v1",
        "sys_extra": None,
        "user_template": (
            "Traduci in formula: {desc}. Cella di destinazione: {ref}. "
            "Funzioni ammesse: {list}"
        ),
        "grammar": "G_formula",
        "validator": "formula",
        "cache_key": ["desc"],
        "fallback": "manuale",
        "budget_classe": "micro",
        "note": "VALUTA col motore foglio: errore -> 1 retry con l'errore nel prompt.",
    },
    "F09": {
        "id": "F09",
        "nome": "generate_table",
        "trigger_ui": "Fogli/Doc",
        "sys": "tutor_v1",
        "sys_extra": "tabella",
        "user_template": (
            "Tabella da generare: {desc}. Massimo 8x20 (8 colonne, 20 righe)."
        ),
        "grammar": "G_table",
        "validator": "table",
        "cache_key": ["desc"],
        "fallback": "vuota 3x2",
        "budget_classe": "standard",
        "note": None,
    },
    "F10": {
        "id": "F10",
        "nome": "outline_presentazione",
        "trigger_ui": "Presentazioni",
        "sys": "outline_v1",
        "sys_extra": None,
        "user_template": (
            "Outline per {arg}: esattamente 6 slide (vincolo fisso: ne 5 ne 7), "
            "titoli in forma azionale, al massimo 4 bullet da 12 parole ciascuno."
        ),
        "grammar": "G_outline",
        "validator": "outline",
        "cache_key": ["arg"],
        "fallback": '{"title": "Outline predefinito", "slides": [{"title": "Iniziare", "bullets": ["Introdurre il tema"]}, {"title": "Spiegare", "bullets": ["Sviluppare il concetto"]}, {"title": "Esempi", "bullets": ["Mostrare esempi concreti"]}, {"title": "Approfondire", "bullets": ["Aggiungere dettagli utili"]}, {"title": "Confrontare", "bullets": ["Confrontare punti di vista"]}, {"title": "Concludere", "bullets": ["Riassumere e chiudere"]}]}',
        "budget_classe": "standard",
        "note": None,
    },
    "F11": {
        "id": "F11",
        "nome": "slide_text",
        "trigger_ui": "per slide",
        "sys": "slide_v1",
        "sys_extra": None,
        "user_template": (
            "Genera i bullet per la slide '{t}' a partire da questo outline: {o}"
        ),
        "grammar": "G_slide",
        "validator": "slide",
        "cache_key": ["t", "o"],
        "fallback": "placeholder",
        "budget_classe": "micro",
        "note": None,
    },
    "F12": {
        "id": "F12",
        "nome": "speaker_notes",
        "trigger_ui": "per slide",
        "sys": "notes_v1",
        "sys_extra": None,
        "user_template": "Note per la slide '{t}':",
        "grammar": "G_text",
        "validator": "notes",
        "cache_key": ["t"],
        "fallback": "vuote",
        "budget_classe": "standard",
        "note": None,
    },
    "F13": {
        "id": "F13",
        "nome": "video_script",
        "trigger_ui": "Video",
        "sys": "script_v1",
        "sys_extra": None,
        "user_template": (
            "Script di {sec} secondi per '{titolo}': il testo deve contenere "
            "circa {sec} x 2,5 parole (target = secondi x 2,5, "
            "tolleranza +-20% del target; esempio: 40s -> 100 parole). "
            "Contenuto di riferimento: {contenuto}"
        ),
        "grammar": "G_text",
        "validator": "script",
        "cache_key": ["sec", "titolo", "contenuto"],
        "fallback": "vuoto",
        "budget_classe": "standard",
        "note": None,
    },
    "F14": {
        "id": "F14",
        "nome": "study_plan",
        "trigger_ui": "Calendario",
        "sys": "plan_v1",
        "sys_extra": None,
        "user_template": (
            "Pianifica sessioni entro {gg} giorni. Statistiche: {stats}. "
            "Eventi già fissati: {events}"
        ),
        "grammar": "G_blocks",
        "validator": "plan",
        "cache_key": ["gg", "stats"],
        "fallback": "manuale",
        "budget_classe": "think",
        "note": None,
    },
    "F15": {
        "id": "F15",
        "nome": "tag_suggest",
        "trigger_ui": "Appunti/Biblio",
        "sys": "tag_v1",
        "sys_extra": None,
        "user_template": (
            "Suggerisci al massimo 3 etichette. Vocabolario: {vocab}. "
            "Testo: {testo}"
        ),
        "grammar": "G_labels",
        "validator": "labels",
        "cache_key": ["testo"],
        "fallback": "nessuno",
        "budget_classe": "micro",
        "note": None,
    },
    "F16": {
        "id": "F16",
        "nome": "next_questions",
        "trigger_ui": "chat",
        "sys": "nextq_v1",
        "sys_extra": None,
        "user_template": "Proponi 3 domande successive su: {ctx}",
        "grammar": "G_questions",
        "validator": "questions",
        "cache_key": ["ctx"],
        "fallback": "nascosto",
        "budget_classe": "micro",
        "note": None,
    },
    "F17": {
        "id": "F17",
        "nome": "cross_module_action",
        "trigger_ui": "chat \u00ab salva come \u2026 \u00bb",
        "sys": None,
        "sys_extra": None,
        "user_template": (
            "Azione cross-modulo: salva come. "
            "Payload già generato: {payload}. Metadati: {meta}"
        ),
        "grammar": "G_payload",
        "validator": "payload",
        "cache_key": [],
        "fallback": "undo+badge",
        "budget_classe": "micro",
        "note": (
            "Il payload è già generato dalla funzione sorgente. "
            "UI F67b (chat): barra azioni « Salva come nota/documento/mazzo » "
            "→ su Accetta StudyStore.saveItem con kind reali "
            "('note'|'documento'|'mazzo') + toast + undo (delete) + badge metadati."
        ),
    },
}


def registry_functions() -> List[Dict[str, Any]]:
    """Le 17 funzioni UTENTE (copia difensiva).

    sum_v1 / paraph_v1 / ctx_v1 NON compaiono qui: sono template per
    i worker interni (uso privato, mai esposti come azione utente).
    """
    return [copy.deepcopy(e) for e in REGISTRY.values()]


def get_function(fid: str) -> Dict[str, Any]:
    """Ritorna la voce del registro per id ('F01') o nome ('flashcard_...')."""
    if fid in REGISTRY:
        return REGISTRY[fid]
    for entry in REGISTRY.values():
        if entry.get("nome") == fid:
            return entry
    raise KeyError("funzione sconosciuta: %s" % fid)


def clamp_output_tokens(budget_classe: str, n: int) -> int:
    """Clamp costante sul limite del budget (micro/standard/think)."""
    if budget_classe not in BUDGET_TOKENS:
        raise KeyError("budget_classe sconosciuto: %s" % budget_classe)
    return min(int(n), BUDGET_TOKENS[budget_classe])
