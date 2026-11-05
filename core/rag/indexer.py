"""
core/rag/indexer.py
---------------------
Orchestratore dell'indicizzazione: cammina l'albero di cartelle, individua
i file nuovi o modificati, li analizza con il parser giusto, li spezza in
chunk, calcola gli embedding e li salva nell'indice vettoriale.

Arricchimento embedding con titolo del documento:
  Il testo di ogni chunk viene preceduto dal titolo del documento
  (derivato dallo stem del file) SOLO al momento del calcolo dell'embedding.
  Questo permette al retriever di trovare chunk che parlano dell'argomento
  senza ripetere la parola chiave (es. pagine intermedie di un lungo
  documento sulla fotosintesi che non ripetono "fotosintesi" ogni paragrafo).

  Il testo salvato nel DB e mostrato al modello rimane PURO, senza titolo.

Indicizzazione incrementale: l'albero viene esplorato per intero ad ogni
scansione (economico), ma solo i file nuovi o cambiati vengono ri-processati.
"""

import hashlib
import inspect
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from core.models import ExtractedImage, ParsedDocument
from core.parsers import is_supported, parse_file
from core.rag.chunker import Chunk, chunk_text
from core.rag.contract import EMBEDDER_ID
from core.rag.embedder import Embedder
from core.rag.image_cache import save_image_to_cache
from core.rag.vector_store import VectorStore
from data.db import Database

ProgressCallback = Optional[Callable[[str], None]]


def _document_title_from_path(file_path: str) -> str:
    """Deriva un titolo leggibile dal percorso del file.

    Esempi:
      /path/appunti_fotosintesi.md  →  "appunti fotosintesi"
      /path/lezione_3_-_vettori.md  →  "lezione 3 - vettori"
    """
    stem = Path(file_path).stem
    # Sostituisci underscore con spazi, mantieni trattini e altro
    return stem.replace("_", " ").strip()


def _load_image_sidecar(md_path: str) -> List[ExtractedImage]:
    sidecar_path = Path(md_path).with_suffix("").with_suffix(".images.json")
    if not sidecar_path.exists():
        return []

    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

    images = []
    for entry in data.get("images", []):
        image_path = entry.get("path")
        if not image_path or not os.path.isfile(image_path):
            continue
        try:
            with open(image_path, "rb") as img_f:
                image_bytes = img_f.read()
        except OSError:
            continue
        images.append(
            ExtractedImage(
                source_file=md_path,
                location_hint=entry.get("location_hint", ""),
                image_bytes=image_bytes,
                mime_type=entry.get("mime_type", "image/png"),
                nearby_text=entry.get("nearby_text", ""),
            )
        )
    return images


# ======================================================================
# Layout a due livelli delle cartelle RAG (C1/C3)
# ======================================================================
# Ogni cartella base (file_AIstudio/ per le note L1, preselected_books/
# per i libri L2) contiene due sottocartelle:
#   originals/   : originali dell'utente, MAI indicizzati;
#   rag_stage2/  : copie .md convertite, indicizzate e vettorizzate.
# Lo scan dell'indicizzatore punta a rag_stage2/; originals/ e inoltre
# potato da ogni os.walk (doppia difesa, C4).
# La scelta di sottocartelle (e non di rinominare le cartelle base) e
# dettata dai path salvati nel DB indexed_files e nei metadata dei
# vettori (source_file = path assoluto): rinominare file_AIstudio/ o
# preselected_books/ romperebbe ogni riferimento esistente.
ORIGINALS_DIR_NAME = "originals"
STAGE2_DIR_NAME = "rag_stage2"

# Sufissi migrati dalla radice (C3): .md/.markdown + sidecar immagini
_LEGACY_MD_SUFFIXES = {".md", ".markdown"}
_SIDECAR_SUFFIX = ".images.json"


def ensure_rag_layout(base_dir) -> Tuple[Path, Path]:
    """Crea (se mancanti) originals/ e rag_stage2/ sotto `base_dir`.

    Idempotente. Ritorna (originals, stage2).
    """
    base = Path(base_dir)
    originals = base / ORIGINALS_DIR_NAME
    stage2 = base / STAGE2_DIR_NAME
    originals.mkdir(parents=True, exist_ok=True)
    stage2.mkdir(parents=True, exist_ok=True)
    return originals, stage2


def migrate_legacy_files(base_dir) -> dict:
    """Migrazione one-shot (C3): sposta i file legacy in radice di
    `base_dir` in originals/ e ne crea la copia in rag_stage2/.

    - Interessa solo .md/.markdown e sidecar .images.json in radice (iterdir
      non ricorsivo): tutto ciò che è già dentro originals/ o rag_stage2/
      non viene toccato, così come i file di altri formati in radice.
    - Ordine di sicurezza: PRIMA la copia in rag_stage2/ (se mancante),
      POI lo spostamento dell'originale in originals/ (solo se la
      destinazione non esiste; in caso di conflitto si lascia stare e si
      logga). Nessun file utente viene mai cancellato senza copia.
    - Idempotente per condizione naturale ("ci sono file in radice?"):
      dopo la migrazione la radice e vuota → la seconda chiamata e un
      no-op. Nessun marker di stato in config.json: niente marker da
      far uscire o da sincronizzare, e file lasciati in radice per
      conflitto vengono riprovati automaticamente al prossimo avvio.
    """
    stats = {"moved": 0, "copied": 0, "skipped": 0, "errors": 0}
    base = Path(base_dir)
    if not base.is_dir():
        return stats
    originals, stage2 = ensure_rag_layout(base)

    for entry in sorted(base.iterdir()):
        if not entry.is_file():
            continue  # sottocartelle (originals/, rag_stage2/, ...) intoccabili
        name = entry.name
        is_md = entry.suffix.lower() in _LEGACY_MD_SUFFIXES
        if not is_md and not name.endswith(_SIDECAR_SUFFIX):
            continue

        # 1) copia in rag_stage2/ PRIMA dello spostamento: se la copia
        #    fallisce l'originale resta intatto in radice (dati al sicuro).
        stage_dst = stage2 / name
        if not stage_dst.exists():
            try:
                shutil.copy2(str(entry), str(stage_dst))
                stats["copied"] += 1
            except OSError as e:
                print(f"[Indexer] Migrazione: copia in rag_stage2/ fallita per {name}: {e}")
                stats["errors"] += 1
                continue  # riprovato al prossimo avvio

        # 2) sposta l'originale in originals/ solo se la destinazione non esiste
        orig_dst = originals / name
        if orig_dst.exists():
            print(f"[Indexer] Migrazione: {name} già presente in originals/: file lasciato in radice.")
            stats["skipped"] += 1
            continue
        try:
            shutil.move(str(entry), str(orig_dst))
            stats["moved"] += 1
        except OSError as e:
            print(f"[Indexer] Migrazione: spostamento in originals/ fallito per {name}: {e}")
            stats["errors"] += 1
    return stats


class Indexer:
    def __init__(self, db: Database, vector_store: VectorStore, embedder: Optional[Embedder] = None):
        self.db = db
        self.vector_store = vector_store
        self.embedder = embedder or Embedder()

    def index_folder(
        self,
        folder_path: str,
        ocr_enabled: bool = True,
        progress_callback: ProgressCallback = None,
    ) -> dict:
        """Scansiona `folder_path` e indicizza i file nuovi/modificati.

        Ritorna stats {"found","changed","reconciled","removed","errors","ms"}
        (backward-compat: i caller esistenti ignorano il valore di ritorno).

        I2 (fix forensics f0): ogni file indicizzato finisce in
        indexed_files; un file in errore NON abortisce lo scan; se la riga
        manca ma lo store ha gia' chunk freschi (firma file_* nei meta) la
        riga viene riscritta senza re-embed (reconcile). Idempotenza:
        2a scansione = 0 file re-processati.
        """
        stats = {"found": 0, "changed": 0, "reconciled": 0, "removed": 0,
                 "errors": 0, "ms": 0.0}
        t_start = time.time()
        if not folder_path or not os.path.isdir(folder_path):
            stats["ms"] = round((time.time() - t_start) * 1000, 2)
            return stats

        def report(msg: str) -> None:
            if progress_callback:
                progress_callback(msg)

        all_files: List[str] = []
        for root, _dirs, files in os.walk(folder_path):
            # C4: originals/ non deve essere indicizzato MAI, a nessun livello
            # della scansione (doppia difesa: il target dello scan e gia
            # rag_stage2/, che non contiene originals/; questa potatura copre
            # lo scan della cartella base, se mai venisse fatto).
            if ORIGINALS_DIR_NAME in _dirs:
                _dirs.remove(ORIGINALS_DIR_NAME)
            for filename in files:
                full_path = os.path.join(root, filename)
                if is_supported(full_path):
                    all_files.append(full_path)

        total = len(all_files)
        stats["found"] = total
        report(f"Trovati {total} file supportati. Controllo modifiche...")

        found_paths = set()
        processed = 0
        changed = 0

        for full_path in all_files:
            found_paths.add(full_path)
            processed += 1
            try:
                stat = os.stat(full_path)
            except OSError:
                continue

            existing = self.db.get_indexed_file(full_path)
            if existing is not None:
                unchanged = (
                    existing["dimensione"] == stat.st_size
                    and abs(existing["data_modifica"] - stat.st_mtime) < 1.0
                )
                if unchanged:
                    # idempotenza: 2a scansione = 0 file re-processati
                    continue
            elif self._reconcile_indexed_row(full_path, stat):
                # I2: riga indexed_files mancante ma chunk gia' presenti e
                # freschi nello store → riscrive SOLO la riga (no re-embed)
                stats["reconciled"] += 1
                continue

            changed += 1
            stats["changed"] = changed
            report(f"Indicizzazione ({processed}/{total}): {os.path.basename(full_path)}")
            try:
                self._index_single_file(full_path, stat.st_size, stat.st_mtime, ocr_enabled)
            except Exception as exc:
                # I2: un file in errore NON abortisce lo scan (le altre righe
                # vengono comunque scritte); il file resta "da fare" e viene
                # riprovato al prossimo scan.
                stats["errors"] += 1
                print(
                    f"[Indexer] Indicizzazione fallita per {full_path}: "
                    f"{type(exc).__name__}: {exc}"
                )

        removed = 0
        stats["changed"] = changed
        # SCOPE della rimozione (fix forensics f0 — root cause reale):
        # get_all_indexed_paths() e' GLOBALE (note + libri nello stesso DB).
        # In produzione lo scan dei libri (cartella vuota, found={}) vedeva
        # le righe delle note e le cancellava ad ogni ciclo dei 300s →
        # indexed_files tornava a 0 e il ciclo successivo rifaceva full
        # re-parse+re-embed (f0: reindex 3171ms ogni scan).
        # Ora un scan "possiede" solo i path dentro la cartella scansionata
        # (+ il livello base sopra, per i path legacy in radice della base):
        # le righe di un altro albero non vengono mai toccate.
        scan_root = Path(folder_path)
        owner_root = (
            scan_root.parent if scan_root.name == STAGE2_DIR_NAME else scan_root
        )
        owner_abs = os.path.normcase(os.path.abspath(str(owner_root)))
        owner_prefix = owner_abs + os.sep
        for known_path in self.db.get_all_indexed_paths():
            known_abs = os.path.normcase(os.path.abspath(known_path))
            if known_abs != owner_abs and not known_abs.startswith(owner_prefix):
                continue  # path di un altro albero (es. l'altro store): intoccabile
            if known_path not in found_paths:
                try:
                    self.vector_store.delete_by_source_file(known_path)
                    self.db.remove_indexed_file(known_path)
                    removed += 1
                except Exception as exc:
                    stats["errors"] += 1
                    print(
                        f"[Indexer] Rimozione fallita per {known_path}: "
                        f"{type(exc).__name__}: {exc}"
                    )
        stats["removed"] = removed
        if stats["reconciled"]:
            report(
                f"Righe indexed_files riconciliate senza re-embed: "
                f"{stats['reconciled']}."
            )

        if changed or removed:
            report(f"Indice aggiornato: {changed} file elaborati, {removed} rimossi.")
        else:
            report("Indice già aggiornato.")

        # H1 — "modello solo in indicizzazione": a fine ciclo l'embedder
        # viene rilasciato (del + gc) e non resta residente; le query
        # successive lo ricaricano in lazy con la piccola cache LRU delle
        # query (core/rag/embedder.py).
        try:
            from core.rag.embedder import release_model
            release_model()
        except Exception:
            pass
        stats["ms"] = round((time.time() - t_start) * 1000, 2)
        return stats

    def _index_single_file(self, full_path: str, size: int, mtime: float, ocr_enabled: bool) -> None:
        # NB: la DELETE del vecchio file NON e' piu' in testa: i chunk
        # esistenti restano interrogabili finche' il nuovo batch non e'
        # pronto (swap alla fine). Sui rami di errore/parse-fallito si
        # elimina esplicitamente (stessa semantica storica: riga a 0 chunk
        # senza chunk orfani nello store).
        parsed: Optional[ParsedDocument] = parse_file(full_path, ocr_enabled=ocr_enabled)
        if parsed is None:
            self.vector_store.delete_by_source_file(full_path)
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        if parsed.error:
            self.vector_store.delete_by_source_file(full_path)
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        if Path(full_path).suffix.lower() in (".md", ".markdown"):
            parsed.images = list(parsed.images) + _load_image_sidecar(full_path)

        all_chunks: List[Chunk] = []

        if parsed.text and parsed.text.strip():
            all_chunks.extend(chunk_text(parsed.text, source_file=full_path))

        for image in parsed.images:
            if not image.nearby_text.strip():
                continue
            chunk_id = uuid.uuid4().hex
            image_chunk = Chunk(
                id=chunk_id,
                source_file=full_path,
                text=image.nearby_text,
                location_hint=image.location_hint,
                is_image=True,
                mime_type=image.mime_type,
            )
            image_chunk.image_path = save_image_to_cache(image, chunk_id)
            all_chunks.append(image_chunk)

        if not all_chunks:
            self.vector_store.delete_by_source_file(full_path)
            self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=0)
            return

        # I2: firma del file (size+mtime+sha256) nei meta di ogni chunk →
        # il prossimo scan potra' riconciliare la riga indexed_files senza
        # re-embed se la riga andasse perduta (coverage_audit la verifica).
        signature = self._file_signature(full_path, size, mtime)
        for c in all_chunks:
            merged = dict(getattr(c, "meta", None) or {})
            merged.update(signature)
            c.meta = merged

        # --- Arricchimento con titolo del documento (solo per l'embedding) ---
        # Il testo salvato nel vettore resta puro; il titolo viene anteposto
        # solo al testo su cui calcoliamo il vettore.
        doc_title = _document_title_from_path(full_path)
        texts_for_embedding = [
            f"{doc_title} — {c.text}" if doc_title else c.text
            for c in all_chunks
        ]

        embeddings = self.embedder.embed(texts_for_embedding, kind="passage")
        # Swap: i vecchi chunk vivono ancora mentre il batch nuovo e'
        # pronto; la DELETE qui elimina il file precedente in modo atomico
        # rispetto alla scrittura dei nuovi chunk.
        self.vector_store.delete_by_source_file(full_path)
        self._add_chunks_with_embedder_id(all_chunks, embeddings)
        self.db.upsert_indexed_file(full_path, size, mtime, num_chunk=len(all_chunks))

    # ------------------------------------------------------------------
    # I2 — bookkeeping indexed_files (fix forensics f0)
    # ------------------------------------------------------------------
    @staticmethod
    def _file_signature(full_path: str, size: int, mtime: float) -> dict:
        """Firma leggera del file da persistere nei meta dei chunk:
        size + mtime (match veloce a ogni scan) + sha256 (verifica audit)."""
        sig = {"file_size": int(size), "file_mtime": float(mtime)}
        try:
            h = hashlib.sha256()
            with open(full_path, "rb") as f:
                for block in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(block)
            sig["file_hash"] = h.hexdigest()
        except OSError:
            pass
        return sig

    def _reconcile_indexed_row(self, full_path: str, stat) -> bool:
        """Riga indexed_files MANCANTE ma chunk gia' presenti e freschi
        nello store (firma file_* nei meta) → riscrive la riga SENZA
        re-embed/re-parse.

        Ritorna False se il reconcile non e' applicabile (store senza API di
        bookkeeping — stub dei test — , chunk assenti o firma divergente):
        in quel caso si fa il pieno re-process, come prima.
        """
        count_fn = getattr(self.vector_store, "count_by_source_file", None)
        sig_fn = getattr(self.vector_store, "get_source_file_signature", None)
        if not callable(count_fn) or not callable(sig_fn):
            return False
        try:
            n = int(count_fn(full_path) or 0)
            if n <= 0:
                return False
            sig = sig_fn(full_path) or {}
        except Exception:
            return False
        try:
            size_ok = int(sig.get("file_size", -1)) == int(stat.st_size)
            mtime_ok = abs(float(sig.get("file_mtime", -1.0)) - float(stat.st_mtime)) < 1.0
        except (TypeError, ValueError):
            return False
        if not (size_ok and mtime_ok):
            return False  # firma assente/diversa → potrebbe essere cambiato
        try:
            self.db.upsert_indexed_file(
                full_path, stat.st_size, stat.st_mtime, num_chunk=n
            )
        except Exception:
            return False
        return True

    def _add_chunks_with_embedder_id(self, chunks: List[Chunk], embeddings: List[List[float]]) -> None:
        """add_chunks(..., embedder_id=...) SOLO se il backend lo accetta
        (backward-compat: gli stub/fake dei test esistenti hanno firma a 2
        parametri). L'id e' model_id dell'embedder con fallback
        contract.EMBEDDER_ID (dichiarato per gli indici preesistenti)."""
        embedder_id = getattr(self.embedder, "model_id", None) or EMBEDDER_ID
        try:
            params = inspect.signature(self.vector_store.add_chunks).parameters
            supports = "embedder_id" in params or any(
                p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()
            )
        except (TypeError, ValueError):
            supports = False
        if supports:
            self.vector_store.add_chunks(chunks, embeddings, embedder_id=embedder_id)
        else:
            self.vector_store.add_chunks(chunks, embeddings)