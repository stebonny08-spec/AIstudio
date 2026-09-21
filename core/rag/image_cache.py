"""
core/rag/image_cache.py
--------------------------
Cartella condivisa dove finiscono i byte reali di ogni immagine estratta.
Sia l'indicizzatore sia il convertitore salvano qui le immagini, così un
chunk immagine nel database vettoriale punta sempre a un percorso stabile
nell'area dati dell'app.

La cartella può accumulare file orfani (immagini di file poi cancellati
o re-indicizzati): `cleanup_orphans()` li rimuove.

ATTENZIONE: `cleanup_orphans()` deve ricevere TUTTE le cartelle che
possono contenere file .md con sidecar .images.json (livello 1, livello 2,
ed eventuali altre). Se si dimentica una cartella, le immagini referenziate
solo dai suoi sidecar risultano "non referenziate" e vengono cancellate.
Per prudenza, se non viene trovato ALCUN sidecar, non viene cancellato
nulla.
"""

import json
import uuid
from pathlib import Path
from typing import List, Optional, Set

from core.models import ExtractedImage
from data.config_manager import get_app_data_dir


def images_cache_dir() -> Path:
    d = get_app_data_dir() / "images_cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_image_to_cache(image: ExtractedImage, chunk_id: str = "") -> str:
    chunk_id = chunk_id or uuid.uuid4().hex
    ext = image.mime_type.split("/")[-1] if "/" in image.mime_type else "png"
    ext = ext.split("+")[0]
    path = images_cache_dir() / f"{chunk_id}.{ext}"
    with open(path, "wb") as f:
        f.write(image.image_bytes)
    return str(path)


def _collect_referenced_paths(extra_search_dirs: Optional[List[Path]] = None) -> Set[Path]:
    """Scansiona tutti i sidecar .images.json nelle cartelle indicate
    (app data dir + eventuali extra) e raccoglie i percorsi di immagine
    ancora referenziati."""
    referenced: Set[Path] = set()

    search_roots: List[Path] = [get_app_data_dir()]
    if extra_search_dirs:
        for d in extra_search_dirs:
            if d is not None:
                search_roots.append(Path(d))

    for root in search_roots:
        if not root.exists():
            continue
        for sidecar in root.rglob("*.images.json"):
            try:
                with open(sidecar, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            for entry in data.get("images", []):
                p = entry.get("path")
                if p:
                    try:
                        referenced.add(Path(p).resolve())
                    except OSError:
                        continue
    return referenced


def cleanup_orphans(extra_search_dirs: Optional[List[Path]] = None) -> int:
    """Rimuove dalla cache le immagini non referenziate da nessun sidecar.

    Ritorna il numero di file rimossi.

    `extra_search_dirs` deve contenere TUTTE le cartelle (oltre a
    get_app_data_dir()) in cui possono esserci file .md con sidecar:
    tipicamente la cartella livello 1 (file_AIstudio/) e la cartella
    livello 2 (preselected_books/). Dimenticarne una significa far
    cancellare le immagini che essa referenzia.

    Se non viene trovato alcun sidecar, la funzione non fa nulla:
    meglio qualche file orfano in più che cancellare dati validi.
    """
    referenced = _collect_referenced_paths(extra_search_dirs)
    if not referenced:
        return 0

    removed = 0
    for f in images_cache_dir().iterdir():
        if not f.is_file():
            continue
        try:
            resolved = f.resolve()
        except OSError:
            continue
        if resolved not in referenced:
            try:
                f.unlink()
                removed += 1
            except OSError:
                continue
    return removed