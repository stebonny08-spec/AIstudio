-- schema.sql
-- Schema del database locale (SQLite). Tutto resta sul PC dell'utente.

CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titolo TEXT NOT NULL,
    data_creazione TEXT NOT NULL,
    materia TEXT NOT NULL DEFAULT '',
    attivita TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    ruolo TEXT NOT NULL CHECK (ruolo IN ('user', 'ai')),
    testo TEXT NOT NULL,
    fonte TEXT,                    -- 'locale' | 'web' | NULL (per i messaggi utente)
    timestamp TEXT NOT NULL,
    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

-- Tiene traccia di quali file locali sono già stati indicizzati nel RAG,
-- con una "firma" leggera (dimensione + data modifica) per capire
-- velocemente se un file è cambiato senza doverlo rileggere per intero
-- a ogni scansione. Questo è il cuore dell'indicizzazione incrementale.
CREATE TABLE IF NOT EXISTS indexed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    percorso_file TEXT NOT NULL UNIQUE,
    dimensione INTEGER NOT NULL,
    data_modifica REAL NOT NULL,
    data_ultima_indicizzazione TEXT NOT NULL,
    num_chunk INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id);

-- =====================================================================
-- NUOVI MODULI DELLA SUITE STUDIO (solo storage locale, nessun cloud)
-- =====================================================================

-- Contenitore generico per tutti gli elementi dei nuovi moduli.
-- 'kind' separa i tipi: note | schema | riassunto | mazzo | presentazione
-- | documento | foglio | video | altro. Il contenuto è JSON salvato localmente.
CREATE TABLE IF NOT EXISTS study_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    materia TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    thumbnail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_items_kind ON study_items (kind);
CREATE INDEX IF NOT EXISTS idx_study_items_updated ON study_items (updated_at);

-- Materie (con colore) usate da chat, note, biblioteca, calendario
CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#8ca4ff',
    created_at TEXT NOT NULL
);

-- Eventi del calendario di studio
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'studio',
    subject_id TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    ricorrenza TEXT NOT NULL DEFAULT 'nessuna',
    link_kind TEXT NOT NULL DEFAULT '',
    link_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events (date);

-- Cartelle per organizzare conversazioni, note e schemi (sistema globale)
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,              -- 'chat' | 'note' | 'schema'
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#f9974a',
    parent_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_kind ON folders (kind);

-- =====================================================================
-- H1 — INDICE RAG IBRIDO (SQLite FTS5 + vettori)
-- Chunk indicizzati: testo puro in chunks (fonte per FTS5 esterno),
-- metadati in meta (JSON): source_file, location_hint, is_image,
-- image_path, mime_type. store_key distingue i due store
-- ("vector_index" per le note, "vector_index_books" per i libri).
-- doc_versions tiene la versione per documento per invalidare le cache
-- di ricerca (H8). La matrice vettoriale (sqlite-vec vec0) NON e' qui:
-- serve l'estensione caricata sulla connessione, quindi viene creata
-- dal backend core/rag/vector_store_sqlite.py a runtime.
-- =====================================================================
CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    parent_id TEXT,
    source_file TEXT NOT NULL DEFAULT '',
    store_key TEXT NOT NULL DEFAULT '',
    testo TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    dim INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chunks_store_source ON chunks (store_key, source_file);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks (doc_id);

-- FTS5 a contenuto esterno: i termini vivono solo in chunks; la tabella
-- virtuale e' tenuta sincronizzata dai trigger sotto (INSERT/DELETE/UPDATE).
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    testo,
    content=chunks,
    content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, testo) VALUES (new.rowid, new.testo);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, testo) VALUES ('delete', old.rowid, old.testo);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, testo) VALUES ('delete', old.rowid, old.testo);
    INSERT INTO chunks_fts(rowid, testo) VALUES (new.rowid, new.testo);
END;

-- Versione per documento: cresce a ogni re-indicizzazione/rimozione del
-- file, cosi' le cache di query (H8) possono invalidarsi in O(1).
CREATE TABLE IF NOT EXISTS doc_versions (
    store_key TEXT NOT NULL DEFAULT '',
    doc_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    ts TEXT NOT NULL,
    PRIMARY KEY (store_key, doc_id)
);
