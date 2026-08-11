"""
utils.py
Funzioni di utilita' generiche: ordinamento naturale dei file, validazione
delle immagini, gestione di cartelle temporanee e archivi ZIP caricati
dall'utente, ridimensionamento immagini per contenere i costi/tempi delle
chiamate AI.
"""
from __future__ import annotations

import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import List, Optional

from PIL import Image, UnidentifiedImageError

from .config import MAX_IMAGE_SIDE_PX, SUPPORTED_IMAGE_EXTENSIONS, get_logger

logger = get_logger(__name__)

_DIGIT_RE = re.compile(r"(\d+)")


# --------------------------------------------------------------------------- #
# Ordinamento naturale (pagina2 prima di pagina10)
# --------------------------------------------------------------------------- #
def natural_sort_key(path: Path):
    """Chiave di ordinamento 'naturale': 'pagina2.jpg' precede 'pagina10.jpg'."""
    parts = _DIGIT_RE.split(path.name)
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def sort_images_naturally(paths: List[Path]) -> List[Path]:
    """Ordina una lista di percorsi immagine in ordine naturale, per nome file."""
    return sorted(paths, key=natural_sort_key)


# --------------------------------------------------------------------------- #
# Validazione immagini
# --------------------------------------------------------------------------- #
def is_supported_image(path: Path) -> bool:
    """Controlla solo l'estensione del file (controllo rapido, non apre il file)."""
    return path.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


def validate_image(path: Path) -> bool:
    """Verifica che il file sia effettivamente un'immagine apribile e non corrotta."""
    try:
        with Image.open(path) as img:
            img.verify()
        return True
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        logger.warning("Immagine non valida o corrotta, verra' ignorata: %s (%s)", path.name, exc)
        return False


def resize_if_needed(path: Path, max_side: int = MAX_IMAGE_SIDE_PX) -> Path:
    """
    Se l'immagine supera 'max_side' pixel sul lato maggiore, la ridimensiona e la
    riscrive in-place (mantenendo le proporzioni). Riduce tempi/costi delle
    chiamate AI senza impattare in modo percepibile la leggibilita' del testo.
    """
    try:
        with Image.open(path) as img:
            width, height = img.size
            longest_side = max(width, height)
            if longest_side <= max_side:
                return path

            scale = max_side / float(longest_side)
            new_size = (int(width * scale), int(height * scale))
            resized = img.convert("RGB").resize(new_size, Image.LANCZOS)
            resized.save(path, quality=92)
            logger.info("Immagine ridimensionata: %s (%sx%s -> %sx%s)", path.name, width, height, *new_size)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        logger.warning("Impossibile ridimensionare '%s': %s (uso l'originale)", path.name, exc)
    return path


# --------------------------------------------------------------------------- #
# Gestione ZIP e cartelle
# --------------------------------------------------------------------------- #
def extract_zip_to_temp(zip_bytes: bytes) -> Path:
    """Estrae un archivio ZIP caricato dall'utente in una cartella temporanea dedicata."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="appunti2pdf_zip_"))
    zip_path = tmp_dir / "upload.zip"
    zip_path.write_bytes(zip_bytes)
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_dir)
    except zipfile.BadZipFile as exc:
        raise ValueError("Il file caricato non e' un archivio ZIP valido.") from exc
    finally:
        zip_path.unlink(missing_ok=True)
    return tmp_dir


def collect_images_from_folder(folder: Path) -> List[Path]:
    """Raccoglie ricorsivamente tutte le immagini valide da una cartella, ordinate naturalmente."""
    candidates = [p for p in folder.rglob("*") if p.is_file() and is_supported_image(p)]
    valid_images = [p for p in candidates if validate_image(p)]
    if len(valid_images) < len(candidates):
        logger.warning(
            "%d file su %d sono stati scartati perche' non validi.",
            len(candidates) - len(valid_images), len(candidates),
        )
    return sort_images_naturally(valid_images)


def cleanup_temp_dir(path: Path) -> None:
    """Elimina in modo sicuro una cartella temporanea (nessuna eccezione se gia' assente)."""
    shutil.rmtree(path, ignore_errors=True)


def save_pdf_with_native_dialog(pdf_bytes: bytes, default_filename: str) -> Optional[str]:
    """Apre il dialog nativo del sistema per salvare un PDF (necessario in pywebview)."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update_idletasks()
    root.update()
    try:
        path = filedialog.asksaveasfilename(
            title="Salva PDF",
            defaultextension=".pdf",
            filetypes=[("Documento PDF", "*.pdf"), ("Tutti i file", "*.*")],
            initialfile=default_filename,
        )
    finally:
        root.destroy()

    if not path:
        return None

    dest = Path(path)
    dest.write_bytes(pdf_bytes)
    return str(dest)
