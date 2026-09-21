"""
data/models_manager.py
-----------------------
Gestisce il catalogo dei modelli GGUF, il loro download da Hugging Face,
e lo stato di ciascuno (scaricato / non scaricato).

I file vengono salvati in <app_data_dir>/models/. Il download supporta
la ripresa (HTTP Range) e la verifica hash SHA256 (opzionale: se
sha256 è vuoto nella voce di catalogo, la verifica viene saltata).

Per aggiungere un modello, aggiungi una voce a MODELS_CATALOG: la UI
si aggiorna automaticamente.
"""

import hashlib
import threading
import time
from pathlib import Path
from typing import Optional

import requests

from data.config_manager import get_app_data_dir


# ======================================================================
# CATALOGO MODELLI
# ----------------------------------------------------------------------
# Ogni voce:
#   display_name: etichetta mostrata in UI
#   url:          URL diretto al file .gguf (Hugging Face, resolve/main)
#   filename:     nome del file salvato su disco
#   sha256:       hash atteso (opzionale, vuoto = nessuna verifica)
#   size_bytes:   dimensione attesa in byte (opzionale; se nota, la UI
#                 mostra subito la percentuale senza aspettare l'header)
# ======================================================================

MODELS_CATALOG = {
    "base": {
        "display_name": "Modello base",
        "url": (
            "https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/"
            "resolve/main/MiniCPM5-2B-Q4_K_M.gguf"
        ),
        "filename": "MiniCPM5-2B-Q4_K_M.gguf",
        "sha256": "",
        "size_bytes": None,
    },
}

# Log esplicito all'import: se vedi 0, il file non è quello giusto.
print(f"[models_manager] Catalogo caricato: {len(MODELS_CATALOG)} modelli -> "
      f"{list(MODELS_CATALOG.keys())}")


def models_dir() -> Path:
    d = get_app_data_dir() / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


class ModelsManager:
    """Gestisce il catalogo, il download e lo stato dei modelli locali.

    Un solo download alla volta (protetto da lock). Lo stato di
    avanzamento è leggibile da get_progress() in qualunque momento,
    anche da un altro thread: la UI fa polling su questo.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._progress = {
            "active": False,
            "model_key": "",
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "speed_bps": 0,
            "error": None,
        }

    # ------------------------------------------------------------------
    # Info sul catalogo
    # ------------------------------------------------------------------
    def list_models(self) -> list:
        out = []
        for key, meta in MODELS_CATALOG.items():
            path = self._model_path(key)
            out.append({
                "key": key,
                "display_name": meta["display_name"],
                "filename": meta["filename"],
                "size_bytes": meta.get("size_bytes"),
                "downloaded": path.exists() and path.stat().st_size > 0,
            })
        return out

    def get_downloaded_path(self, model_key: str) -> Optional[str]:
        if model_key not in MODELS_CATALOG:
            return None
        path = self._model_path(model_key)
        if path.exists() and path.stat().st_size > 0:
            return str(path)
        return None

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------
    def get_progress(self) -> dict:
        with self._lock:
            return dict(self._progress)

    def is_downloading(self) -> bool:
        with self._lock:
            return bool(self._progress["active"])

    def download(self, model_key: str) -> dict:
        """Scarica il modello indicato. Bloccante: pensata per essere
        chiamata da un thread di background (l'API lo fa già così)."""
        meta = MODELS_CATALOG.get(model_key)
        if not meta:
            return {"success": False, "error": f"Modello sconosciuto: {model_key}"}

        with self._lock:
            if self._progress["active"]:
                return {"success": False, "error": "Un download è già in corso."}

        dest = self._model_path(model_key)
        if dest.exists() and dest.stat().st_size > 0:
            return {"success": True, "already_downloaded": True}

        url = meta["url"]
        expected_sha = (meta.get("sha256") or "").strip()

        with self._lock:
            self._progress = {
                "active": True,
                "model_key": model_key,
                "downloaded_bytes": 0,
                "total_bytes": meta.get("size_bytes") or 0,
                "speed_bps": 0,
                "error": None,
            }

        try:
            self._do_download(url, dest, expected_sha)
        except Exception as e:
            with self._lock:
                self._progress["active"] = False
                self._progress["error"] = str(e)
            try:
                part = dest.with_suffix(dest.suffix + ".part")
                if part.exists():
                    part.unlink()
            except OSError:
                pass
            return {"success": False, "error": str(e)}

        with self._lock:
            self._progress["active"] = False
        return {"success": True}

    def _do_download(self, url: str, dest: Path, expected_sha256: str) -> None:
        tmp = dest.with_suffix(dest.suffix + ".part")
        resume_from = tmp.stat().st_size if tmp.exists() else 0

        headers = {"User-Agent": "NovaStudio/0.1.0"}
        mode = "wb"
        if resume_from > 0:
            headers["Range"] = f"bytes={resume_from}-"
            mode = "ab"

        with requests.get(url, headers=headers, stream=True, timeout=30, allow_redirects=True) as r:
            # Se il server non supporta Range, si riparte da zero.
            if resume_from > 0 and r.status_code == 200:
                mode = "wb"
                resume_from = 0
            r.raise_for_status()

            total = 0
            if "content-length" in r.headers:
                total = int(r.headers["content-length"]) + resume_from

            with self._lock:
                self._progress["total_bytes"] = total
                self._progress["downloaded_bytes"] = resume_from

            downloaded = resume_from
            last_t = time.time()
            last_b = downloaded

            with open(tmp, mode) as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    f.write(chunk)
                    downloaded += len(chunk)

                    now = time.time()
                    if now - last_t >= 0.5:
                        with self._lock:
                            self._progress["downloaded_bytes"] = downloaded
                            self._progress["speed_bps"] = int((downloaded - last_b) / (now - last_t))
                        last_t = now
                        last_b = downloaded

            with self._lock:
                self._progress["downloaded_bytes"] = downloaded

        if expected_sha256:
            actual = self._sha256(tmp)
            if actual.lower() != expected_sha256.lower():
                try:
                    tmp.unlink()
                except OSError:
                    pass
                raise RuntimeError(
                    f"Hash del modello non valido (atteso {expected_sha256[:12]}..., "
                    f"ottenuto {actual[:12]}...)."
                )

        tmp.replace(dest)

    # ------------------------------------------------------------------
    def _model_path(self, model_key: str) -> Path:
        meta = MODELS_CATALOG[model_key]
        return models_dir() / meta["filename"]

    @staticmethod
    def _sha256(path: Path) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()