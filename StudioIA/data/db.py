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
from typing import Iterator, List, Optional, Tuple

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
    def create_chat(self, titolo: str, ambiente: str) -> int:
        with self._cursor() as cur:
            cur.execute(
                "INSERT INTO chats (titolo, ambiente, data_creazione) VALUES (?, ?, ?)",
                (titolo, ambiente, datetime.now().isoformat()),
            )
            return cur.lastrowid

    def get_chats(self, ambiente: str) -> List[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM chats WHERE ambiente = ? ORDER BY id DESC",
                (ambiente,),
            )
            return cur.fetchall()

    def get_conversations(self, limit: int = 50) -> List[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM chats ORDER BY id DESC LIMIT ?",
                (limit,),
            )
            return cur.fetchall()

    def create_conversation(self, titolo: str) -> int:
        return self.create_chat(titolo, "chat")

    def get_chat(self, chat_id: int) -> Optional[sqlite3.Row]:
        with self._cursor() as cur:
            cur.execute("SELECT * FROM chats WHERE id = ?", (chat_id,))
            return cur.fetchone()

    def rename_chat(self, chat_id: int, nuovo_titolo: str) -> None:
        with self._cursor() as cur:
            cur.execute("UPDATE chats SET titolo = ? WHERE id = ?", (nuovo_titolo, chat_id))

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
