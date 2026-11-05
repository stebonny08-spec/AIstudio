# -*- coding: utf-8 -*-
"""qa/_r27_dump.py - R27 QA-REAL: seed dagli item REALI dell'app.

Legge il SQLite reale (%APPDATA%/NovaStudio/studioia.db) e produce
qa/r27_seed.json con:
  items          study_items COMPLETI (content incluso) + preview[180]
                 (la mock study_list del QA replica il backend: niente
                 content -> il fix fullContent del FE e' esercitato sul serio)
  conversations   get_chats() in forma API (id/title/preview/...)
  messages        {convId: [{id, role, content, source}]}
  materials       indexed_files + read_material_preview REALI (pdf/docx/...)
  matText         read_material_text per la mock
  meta            titoli/utili per gli assert del QA (nota con tratti,
                  foglio, doc, chat, fotosintesi, conteggi libri)

Solo lettura. Esecuzione: python qa/_r27_dump.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from data.db import Database           # noqa: E402
from data.config_manager import get_app_data_dir  # noqa: E402
from backend.study_api import StudyAPI  # noqa: E402


def main():
    db_path = Path(get_app_data_dir()) / "studioia.db"
    if not db_path.exists():
        raise SystemExit("DB reale non trovato: %s" % db_path)
    db = Database()

    # ---- items (content COMPLETO, study_list ha solo preview) ----
    import sqlite3
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute("""SELECT id, kind, title, content, materia, tags, description,
                          thumbnail, created_at, updated_at, folder_id
                   FROM study_items ORDER BY updated_at DESC""")
    items = []
    for r in cur.fetchall():
        content = r["content"] or ""
        items.append({
            "id": r["id"], "kind": r["kind"], "title": r["title"] or "",
            "materia": r["materia"] or "", "tags": r["tags"] or "",
            "description": r["description"] or "", "thumbnail": r["thumbnail"] or "",
            "created_at": r["created_at"], "updated_at": r["updated_at"],
            "folder_id": r["folder_id"] or "",
            "content": content,
            # FEDELE al backend (_row_to_item senza content):
            "preview": content.replace("\n", " ")[:180],
        })
    con.close()

    # ---- chat (forma identica a StudioIAAPI.get_conversations/get_messages) ----
    conversations = []
    messages = {}
    try:
        for r in db.get_chats():
            conversations.append({
                "id": r["id"], "title": r["titolo"] or "",
                "date": r["data_creazione"], "materia": r["materia"] or "",
                "attivita": r["attivita"] or "",
                "folder_id": (r["folder_id"] if "folder_id" in r.keys() else "") or "",
                "preview": r["anteprima"] or "",
                "n_messages": r["n_messaggi"] or 0,
            })
            messages[str(r["id"])] = [{
                "id": m["id"], "role": m["ruolo"], "content": m["testo"],
                "source": m["fonte"],
            } for m in db.get_messages(r["id"])]
    except Exception as e:
        print("[dump] chat error:", e)

    # ---- materiali: percorsi indicizzati + preview REALI (backend) ----
    api = StudyAPI()
    materials, mat_preview, mat_text = [], {}, {}
    try:
        for row in db.list_indexed_files():
            p = str(row["percorso_file"])
            materials.append({"path": p, "name": Path(p).name})
            try:
                r = api.read_material_preview(p)
                if r and r.get("success"):
                    mat_preview[p] = r
            except Exception as e:
                print("[dump] read_material_preview", p, e)
            try:
                t = api.read_material_text(p)
                if t and t.get("success"):
                    mat_text[p] = t
            except Exception as e:
                print("[dump] read_material_text", p, e)
    except Exception as e:
        print("[dump] materials error:", e)

    # ---- meta per gli assert del QA ----
    def first(kind, pred=lambda it: True):
        for it in items:
            if it["kind"] == kind and pred(it):
                return it
        return None

    ink_note = next((it for it in items
                     if it["kind"] == "note" and '"t":"stroke"' in it["content"]), None)
    foglio = first("foglio")
    doc = first("documento")
    pres = first("presentazione")
    video = first("video")
    schema = first("schema")
    foto = next((m for m in materials
                 if "fotosintesi" in m["name"].lower()), None)
    books_dir = Path(get_app_data_dir()) / "preselected_books"
    books = ([x for x in books_dir.rglob("*") if x.is_file()]
             if books_dir.exists() else [])

    # cella "Libri" richiede un libro reale: se la cartella e' vuota il QA
    # la marca PARZIALE con evidenza (non si inventano sorgenti).
    meta = {
        "db": str(db_path),
        "items_total": len(items),
        "by_kind": {k: sum(1 for i in items if i["kind"] == k)
                    for k in sorted(set(i["kind"] for i in items))},
        "ink_note": ({k: ink_note[k] for k in ("id", "title")} if ink_note else None),
        "ink_note_has_pages": bool(ink_note and '"pages"' in ink_note["content"]),
        "foglio": ({k: foglio[k] for k in ("id", "title")} if foglio else None),
        "foglio_cells": (json.loads(foglio["content"])["sheets"][0].get("cells")
                         if foglio else None),
        "documento": ({k: doc[k] for k in ("id", "title")} if doc else None),
        "presentazione": ({k: pres[k] for k in ("id", "title")} if pres else None),
        "video": ({k: video[k] for k in ("id", "title")} if video else None),
        "video_clips": (len(json.loads(video["content"]).get("clips") or [])
                        if video else 0),
        "schema": ({k: schema[k] for k in ("id", "title")} if schema else None),
        "fotosintesi": foto,
        "conversations": len(conversations),
        "messages_total": sum(len(v) for v in messages.values()),
        "chat_with_msgs": next((c for c in conversations
                                if messages.get(str(c["id"]))), None),
        "materials": len(materials),
        "books_dir": str(books_dir),
        "books_count": len(books),
    }

    seed = {"items": items, "conversations": conversations, "messages": messages,
            "materials": materials, "matPreview": mat_preview, "matText": mat_text,
            "meta": meta}
    out = ROOT / "qa" / "r27_seed.json"
    out.write_text(json.dumps(seed, ensure_ascii=False), encoding="utf-8")
    print("SEED ->", out, out.stat().st_size, "bytes")
    print(json.dumps(meta, ensure_ascii=False, indent=1)[:2500])


if __name__ == "__main__":
    main()
