"""
data/db.py
----------
Livello di accesso al database SQLite locale. Nessun altro modulo dell'app
deve aprire connessioni sqlite3 per conto proprio: passano sempre da qui.
Questo isola la GUI e la logica di business dai dettagli dello storage.
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, List, Optional

from data.config_manager import get_app_data_dir

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


class Database:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or (get_app_data_dir() / "studioia.db")
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
                conn.executescript(f.read())
            # Migrazione leggera per database creati prima dell'aggiunta
            # dei nuovi moduli (CREATE TABLE IF NOT EXISTS non altera le tabelle).
            cols = {r[1] for r in conn.execute("PRAGMA table_info(chats)").fetchall()}
            if "materia" not in cols:
                conn.execute("ALTER TABLE chats ADD COLUMN materia TEXT NOT NULL DEFAULT ''")
            if "attivita" not in cols:
                conn.execute("ALTER TABLE chats ADD COLUMN attivita TEXT NOT NULL DEFAULT ''")
            if "folder_id" not in cols:
                conn.execute("ALTER TABLE chats ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''")
            s_cols = {r[1] for r in conn.execute("PRAGMA table_info(study_items)").fetchall()}
            if s_cols and "folder_id" not in s_cols:
                conn.execute("ALTER TABLE study_items ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''")
            f_cols = {r[1] for r in conn.execute("PRAGMA table_info(folders)").fetchall()}
            if f_cols and "color" not in f_cols:
                conn.execute("ALTER TABLE folders ADD COLUMN color TEXT NOT NULL DEFAULT '#f9974a'")
            # H1 — colonne opzionali della tabella RAG `chunks`: se un DB
            # creato da un build parziale manca di qualche colonna, la
            # aggiungiamo qui (stesso pattern PRAGMA table_info sopra).
            r_cols = {r[1] for r in conn.execute("PRAGMA table_info(chunks)").fetchall()}
            if r_cols:
                for col, decl in (
                    ("source_file", "TEXT NOT NULL DEFAULT ''"),
                    ("store_key", "TEXT NOT NULL DEFAULT ''"),
                    ("meta", "TEXT NOT NULL DEFAULT '{}'"),
                    ("dim", "INTEGER NOT NULL DEFAULT 0"),
                    ("doc_id", "TEXT NOT NULL DEFAULT ''"),
                    ("parent_id", "TEXT"),
                ):
                    if col not in r_cols:
                        conn.execute(f"ALTER TABLE chunks ADD COLUMN {col} {decl}")
            conn.commit()

    @contextmanager
    def _cursor(self) -> Iterator[sqlite3.Cursor]:
        conn = self._connect()
        try:
            cur = conn.cursor()
            yield cur
            conn.commit()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # CHAT
    # ------------------------------------------------------------------
    def create_chat(self, titolo: str) -> int:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO chats (titolo, data_creazione) VALUES (?, ?)",
                (titolo, datetime.now().isoformat()),
            )
            return cur.lastrowid

    def get_chats(self, limit: int = 50) -> List[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT c.*,
                       (SELECT testo FROM messages m WHERE m.chat_id = c.id
                        ORDER BY m.id DESC LIMIT 1) AS anteprima,
                       (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS n_messaggi
                FROM chats c
                ORDER BY c.id DESC LIMIT ?
                """,
                (limit,),
            )
            return cur.fetchall()

    def get_chat(self, chat_id: int) -> Optional[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM chats WHERE id = ?", (chat_id,))
            return cur.fetchone()

    def rename_chat(self, chat_id: int, nuovo_titolo: str) -> None:
        with self._cursor() as cur:
            cur.execute("UPDATE chats SET titolo = ? WHERE id = ?", (nuovo_titolo, chat_id))

    def set_chat_meta(self, chat_id: int, materia: str = "", attivita: str = "") -> None:
        with self._cursor() as cur:
            cur.execute(
                "UPDATE chats SET materia = ?, attivita = ? WHERE id = ?",
                (materia or "", attivita or "", chat_id),
            )

    def set_chat_folder(self, chat_id: int, folder_id: str = "") -> None:
        with self._cursor() as cur:
            cur.execute(
                "UPDATE chats SET folder_id = ? WHERE id = ?",
                (folder_id or "", chat_id),
            )

    def delete_chat(self, chat_id: int) -> None:
        with self._cursor() as cur:
            cur.execute("DELETE FROM chats WHERE id = ?", (chat_id,))

    # ------------------------------------------------------------------
    # MESSAGGI
    # ------------------------------------------------------------------
    def add_message(self, chat_id: int, ruolo: str, testo: str, fonte: Optional[str] = None) -> int:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO messages (chat_id, ruolo, testo, fonte, timestamp) VALUES (?, ?, ?, ?, ?)",
                (chat_id, ruolo, testo, fonte, datetime.now().isoformat()),
            )
            return cur.lastrowid

    def get_messages(self, chat_id: int) -> List[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM messages WHERE chat_id = ? ORDER BY id ASC",
                (chat_id,),
            )
            return cur.fetchall()

    # ------------------------------------------------------------------
    # FILE INDICIZZATI (per l'indicizzazione incrementale del RAG)
    # ------------------------------------------------------------------
    def get_indexed_file(self, percorso_file: str) -> Optional[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM indexed_files WHERE percorso_file = ?",
                (percorso_file,),
            )
            return cur.fetchone()

    def upsert_indexed_file(self, percorso_file: str, dimensione: int, data_modifica: float, num_chunk: int) -> None:
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO indexed_files (percorso_file, dimensione, data_modifica, data_ultima_indicizzazione, num_chunk)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(percorso_file) DO UPDATE SET
                    dimensione = excluded.dimensione,
                    data_modifica = excluded.data_modifica,
                    data_ultima_indicizzazione = excluded.data_ultima_indicizzazione,
                    num_chunk = excluded.num_chunk
                """,
                (percorso_file, dimensione, data_modifica, datetime.now().isoformat(), num_chunk),
            )

    def remove_indexed_file(self, percorso_file: str) -> None:
        with self._cursor() as cur:
            cur.execute("DELETE FROM indexed_files WHERE percorso_file = ?", (percorso_file,))

    def get_all_indexed_paths(self) -> List[str]:
        with self._cursor() as cur:
            cur.execute("SELECT percorso_file FROM indexed_files")
            return [row["percorso_file"] for row in cur.fetchall()]

    def list_indexed_files(self) -> List[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute("SELECT percorso_file, data_ultima_indicizzazione FROM indexed_files ORDER BY percorso_file")
            return cur.fetchall()

    # ------------------------------------------------------------------
    # STUDY ITEMS (elementi dei nuovi moduli: note, schemi, mazzi, ...)
    # ------------------------------------------------------------------
    @staticmethod
    def _row_to_item(row: sqlite3.Row, with_content: bool = False) -> dict:
        data = {
            "id": row["id"],
            "kind": row["kind"],
            "folder_id": (row["folder_id"] if "folder_id" in row.keys() else "") or "",
            "title": row["title"],
            "materia": row["materia"] or "",
            "tags": row["tags"] or "",
            "description": row["description"] or "",
            "thumbnail": row["thumbnail"] or "",
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        if with_content:
            data["content"] = row["content"] or ""
        else:
            preview = (row["content"] or "").replace("\n", " ")
            data["preview"] = preview[:180]
        return data

    def study_list(self) -> List[dict]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT id, kind, title, content, materia, tags, description,
                       thumbnail, created_at, updated_at, folder_id
                FROM study_items ORDER BY updated_at DESC
                """
            )
            return [self._row_to_item(r) for r in cur.fetchall()]

    def study_get(self, item_id: str) -> Optional[dict]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM study_items WHERE id = ?", (item_id,))
            row = cur.fetchone()
            return self._row_to_item(row, with_content=True) if row else None

    def study_save(self, payload: dict) -> dict:
        now = datetime.now().isoformat()
        item_id = payload.get("id") or ""
        if not item_id:
            import uuid
            item_id = uuid.uuid4().hex
            created = now
        else:
            existing = self.study_get(item_id)
            created = existing["created_at"] if existing else now
            # Se il payload non tocca la cartella, preserva quella esistente
            if "folder_id" not in payload and existing:
                payload = dict(payload)
                payload["folder_id"] = existing.get("folder_id", "") or ""
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO study_items (id, kind, title, content, materia, tags,
                                         description, thumbnail, created_at, updated_at, folder_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind,
                    title = excluded.title,
                    content = excluded.content,
                    materia = excluded.materia,
                    tags = excluded.tags,
                    description = excluded.description,
                    thumbnail = excluded.thumbnail,
                    folder_id = excluded.folder_id,
                    updated_at = excluded.updated_at
                """,
                (
                    item_id,
                    payload.get("kind", ""),
                    payload.get("title", "Senza titolo"),
                    payload.get("content", ""),
                    payload.get("materia", ""),
                    payload.get("tags", ""),
                    payload.get("description", ""),
                    payload.get("thumbnail", ""),
                    created,
                    now,
                    payload.get("folder_id", "") or "",
                ),
            )
        return self.study_get(item_id)

    def study_delete(self, item_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute("DELETE FROM study_items WHERE id = ?", (item_id,))
            return cur.rowcount > 0

    def study_duplicate(self, item_id: str) -> Optional[dict]:
        item = self.study_get(item_id)
        if not item:
            return None
        item["id"] = ""
        item["title"] = item["title"] + " (copia)"
        return self.study_save(item)

    # ------------------------------------------------------------------
    # MATERIE
    # ------------------------------------------------------------------
    def subjects_list(self) -> List[dict]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM subjects ORDER BY name COLLATE NOCASE")
            return [dict(r) for r in cur.fetchall()]

    def subjects_save(self, payload: dict) -> dict:
        import uuid
        subj_id = payload.get("id") or uuid.uuid4().hex
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO subjects (id, name, color, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color
                """,
                (
                    subj_id,
                    payload.get("name", "Materia"),
                    payload.get("color", "#8ca4ff"),
                    payload.get("created_at") or datetime.now().isoformat(),
                ),
            )
            row = cur.execute("SELECT * FROM subjects WHERE id = ?", (subj_id,)).fetchone()
            return dict(row) if row else {"id": subj_id}

    def subjects_delete(self, subj_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute("DELETE FROM subjects WHERE id = ?", (subj_id,))
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # CALENDARIO
    # ------------------------------------------------------------------
    def events_list(self) -> List[dict]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM calendar_events ORDER BY date ASC")
            return [dict(r) for r in cur.fetchall()]

    def events_save(self, payload: dict) -> dict:
        import uuid
        ev_id = payload.get("id") or uuid.uuid4().hex
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO calendar_events (id, title, date, tipo, subject_id, note,
                                             ricorrenza, link_kind, link_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    date = excluded.date,
                    tipo = excluded.tipo,
                    subject_id = excluded.subject_id,
                    note = excluded.note,
                    ricorrenza = excluded.ricorrenza,
                    link_kind = excluded.link_kind,
                    link_id = excluded.link_id
                """,
                (
                    ev_id,
                    payload.get("title", "Evento"),
                    payload.get("date", ""),
                    payload.get("tipo", "studio"),
                    payload.get("subject_id", ""),
                    payload.get("note", ""),
                    payload.get("ricorrenza", "nessuna"),
                    payload.get("link_kind", ""),
                    payload.get("link_id", ""),
                    payload.get("created_at") or datetime.now().isoformat(),
                ),
            )
            row = cur.execute("SELECT * FROM calendar_events WHERE id = ?", (ev_id,)).fetchone()
            return dict(row) if row else {"id": ev_id}

    def events_delete(self, ev_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute("DELETE FROM calendar_events WHERE id = ?", (ev_id,))
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # CARTELLE (chat | note | schema)
    # ------------------------------------------------------------------
    def folders_list(self, kind: str) -> List[dict]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM folders WHERE kind = ? ORDER BY name COLLATE NOCASE",
                (kind,),
            )
            return [dict(r) for r in cur.fetchall()]

    def folders_save(self, payload: dict) -> dict:
        import uuid
        folder_id = payload.get("id") or uuid.uuid4().hex
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO folders (id, kind, name, color, parent_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    color = excluded.color,
                    parent_id = excluded.parent_id
                """,
                (
                    folder_id,
                    payload.get("kind", "note"),
                    (payload.get("name") or "Cartella").strip() or "Cartella",
                    payload.get("color") or "#f9974a",
                    payload.get("parent_id", "") or "",
                    payload.get("created_at") or datetime.now().isoformat(),
                ),
            )
            row = cur.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
            return dict(row) if row else {"id": folder_id}

    def folders_delete(self, folder_id: str) -> bool:
        """Elimina una cartella SENZA perdere gli elementi:
        gli elementi vanno nella radice, le sottocartelle salgono al padre."""
        with self._cursor() as cur:
            row = cur.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
            if not row:
                return False
            parent = row["parent_id"] or ""
            cur.execute("UPDATE study_items SET folder_id = '' WHERE folder_id = ?", (folder_id,))
            cur.execute("UPDATE chats SET folder_id = '' WHERE folder_id = ?", (folder_id,))
            cur.execute(
                "UPDATE folders SET parent_id = ? WHERE parent_id = ?",
                (parent, folder_id),
            )
            cur.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
            return True
