-- schema.sql
-- Schema del database locale (SQLite). Tutto resta sul PC dell'utente.

CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titolo TEXT NOT NULL,
    ambiente TEXT NOT NULL CHECK (ambiente IN ('chat', 'tutor')),
    data_creazione TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_chats_ambiente ON chats (ambiente);
