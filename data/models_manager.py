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
#   id:           identificativo stabile R23 X6.1 (le chiavi legacy
#                 "pro"/"base"/"fallback" restano invariate)
#   dest_path:    percorso relativo alla radice del progetto (opzionale;
#                 se assente il file vive in <app_data>/models/)
#   draft:        modello draft associato (solo metadata; None se assente)
#   fallback:     True sulla voce fallback (MiniCPM5-2B)
# ======================================================================

# Ordine del catalogo = ordine del dropdown (R22): il modello pro viene
# PRIMA del base. Ogni voce puo' dichiarare `dest_path` (percorso relativo
# alla radice del progetto): se assente il file finisce in app_data/models.
MODELS_CATALOG = {
    # R23 X6.1: ordine dropdown pro > base > fallback.
    "pro": {
        "id": "spark-pro-4b",
        "display_name": "Modello pro (Spark-4B)",
        "url": (
            "https://huggingface.co/XHToken/Spark-X2.6-4B-GGUF/"
            "resolve/main/Spark-X2.6-4B-Q4_K_M.gguf"
        ),
        "filename": "spark-x2.6-4b.gguf",
        "dest_path": "tools/models/spark-x2.6-4b.gguf",
        # SHA256 LFS pubblicato dall'API HF (api/models/<repo>?blobs=true);
        # il README/model card NON espone il checksum nel testo.
        "sha256": "91cb2811aebb47ac916aa619d27d4cdd7f4143106b7917accb8ead4cd7f5cbd9",
        "size_bytes": 3543441312,
        # R23: draft 1.7B del pro - solo metadata (OFF di default,
        # regola X4.2: acceptance 0.8402 >= 0.70 ok ma speedup
        # 1.240 < 1.30 -> draft OFF motivato, nessuna change config).
        "draft": "spark-base-1.7b",
    },
    "base": {
        "id": "spark-base-1.7b",
        "display_name": "Modello base (Spark-1.7B)",
        "url": (
            "https://huggingface.co/XHToken/Spark-X2.6-1.7B-GGUF/"
            "resolve/main/Spark-X2.6-1.7B-Q4_K_M.gguf"
        ),
        "filename": "spark-x2.6-1.7b.gguf",
        "dest_path": "tools/models/spark-x2.6-1.7b.gguf",
        # SHA256 LFS pubblicato dall'API HF (api/models/<repo>?blobs=true)
        # - verificato MATCH sul disco R23.
        "sha256": "7abd9859c10924be3c583945456fa9b25d0569484876105a7b7376f7938fffb7",
        "size_bytes": 1768720512,
        "draft": None,
    },
    "fallback": {
        "id": "minicpm5-2b",
        "display_name": "MiniCPM5-2B (fallback)",
        "url": (
            "https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/"
            "resolve/main/MiniCPM5-2B-Q4_K_M.gguf"
        ),
        "filename": "MiniCPM5-2B-Q4_K_M.gguf",
        # nessun dest_path: vive in <app_data>/models/ (gia' scaricato R22).
        # SHA256 reale calcolato su disco (Get-FileHash) - R23.
        "sha256": "ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd",
        "size_bytes": 1561318368,
        # R23 X6.1: draft dichiarato come metadata (MiniCPM5-1B NON e'
        # in catalog, solo dichiarato) + marcatura esplicita fallback.
        "draft": "minicpm5-1b",
        "fallback": True,
    },
}

# Log esplicito all'import: se vedi 0, il file non è quello giusto.
print(f"[models_manager] Catalogo caricato: {len(MODELS_CATALOG)} modelli -> "
      f"{list(MODELS_CATALOG.keys())}")


def apply_fallback_config(config, reason: str) -> Optional[str]:
    """Fallback dichiarato R23 X6: se Spark (pro/base) non e' disponibile
    o il load fallisce, riporta la config sulla voce FALLBACK
    (MiniCPM5-2B) con log esplicito.

    Aggiorna local_model_path, llama.model_path (sidecar llama-server) e
    local_model_key, salva la config ed emette il log esplicito:
      [models] fallback al modello MiniCPM5-2B: <motivo>
    Ritorna il path del fallback oppure None (fallback non scaricato/config KO).
    """
    meta = MODELS_CATALOG.get("fallback")
    path = ModelsManager()._model_path("fallback") if meta else None
    if path is None or not (path.exists() and path.stat().st_size > 0):
        print(f"[models] fallback al modello MiniCPM5-2B NON ESEGUIBILE: {reason} "
              f"(modello fallback non scaricato)")
        return None
    try:
        config.set("local_model_path", str(path))
        config.set("llama.model_path", str(path))
        config.set("local_model_key", "fallback")
        if hasattr(config, "save"):
            config.save()
    except Exception as exc:
        print(f"[models] fallback al modello MiniCPM5-2B: errore scrittura config: {exc}")
        return None
    print(f"[models] fallback al modello MiniCPM5-2B: {reason}")
    return str(path)


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
                # R23 X6.1: metadati esposti alla UI (dropdown)
                "id": meta.get("id"),
                "draft": meta.get("draft"),
                "fallback": bool(meta.get("fallback")),
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
    # Verifica checksum (R22)
    # ------------------------------------------------------------------
    def verify_checksum(self, model_key: str) -> dict:
        """Calcola lo SHA256 del file di `model_key` e lo confronta con
        l'atteso di catalogo.

        - sha atteso presente -> confronto (ok False su mismatch)
        - sha atteso assente   -> calcola comunque e scrive/aggiorna
          <cartella file>/checksum.txt SENZA bloccare (ok True).
        """
        meta = MODELS_CATALOG.get(model_key)
        if not meta:
            return {"ok": False, "error": f"Modello sconosciuto: {model_key}"}
        path = self._model_path(model_key)
        if not path.exists():
            return {"ok": False, "error": "File non scaricato."}
        expected = (meta.get("sha256") or "").strip().lower()
        actual = self._sha256(path)
        ok = (not expected) or (actual == expected)
        self._write_checksum_txt(path, actual, meta, verified=bool(expected) and ok)
        return {"ok": ok, "actual": actual, "expected": expected,
                "size_bytes": path.stat().st_size}

    @staticmethod
    def _write_checksum_txt(path: Path, sha256: str, meta: dict,
                            verified: bool = False) -> None:
        """Aggiorna/scrive checksum.txt accanto al file .gguf (R22):
        sha256 + fonte + timestamp + url. Mai eccezione (non blocca)."""
        try:
            lines = [
                f"# Checksum {meta.get('filename', path.name)}",
                "# Fonte: Hugging Face API "
                "(api/models/<repo>?blobs=true -> lfs.sha256);",
                "# il README/model card NON pubblica SHA256 nel testo.",
                f"sha256={sha256}",
                f"size_bytes={path.stat().st_size}",
                f"url={meta.get('url', '')}",
                f"file={path.name}",
                "verified_at=" + time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "verification=" + ("MATCH" if verified else
                                   "calcolato (nessun atteso in catalogo)"),
                "",
            ]
            (path.parent / "checksum.txt").write_text(
                "\n".join(lines), encoding="utf-8")
        except OSError:
            pass

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
            # R22: file gia' presente (anche scaricato fuori dall'app) ->
            # verifica checksum PRIMA di dichiararlo pronto.
            chk = self.verify_checksum(model_key)
            if not chk.get("ok"):
                msg = (f"Hash del modello non valido (atteso "
                       f"{str(chk.get('expected'))[:12]}..., ottenuto "
                       f"{str(chk.get('actual'))[:12]}...).")
                with self._lock:
                    self._progress["error"] = msg
                print(f"[models_manager] {msg}")
                return {"success": False, "error": msg}
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
            actual_sha = self._do_download(url, dest, expected_sha, meta)
            if actual_sha:
                self._write_checksum_txt(dest, actual_sha, meta,
                                         verified=bool(expected_sha))
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

    def _do_download(self, url: str, dest: Path, expected_sha256: str,
                     meta: Optional[dict] = None) -> str:
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

        # R22: hash SEMPRE calcolato; se c'e' l'atteso viene confrontato
        # (mismatch -> errore + nessun rename), altrimenti viene solo
        # registrato in checksum.txt senza bloccare.
        actual = self._sha256(tmp)
        if expected_sha256 and actual.lower() != expected_sha256.lower():
            try:
                tmp.unlink()
            except OSError:
                pass
            raise RuntimeError(
                f"Hash del modello non valido (atteso {expected_sha256[:12]}..., "
                f"ottenuto {actual[:12]}...)."
            )

        tmp.replace(dest)
        return actual

    # ------------------------------------------------------------------
    def _model_path(self, model_key: str) -> Path:
        meta = MODELS_CATALOG[model_key]
        dest = str(meta.get("dest_path") or "").strip()
        if dest:
            # dest_path dichiarato nel catalogo: relativo alla radice del
            # progetto (tools/models/... per il modello pro R22).
            root = Path(__file__).resolve().parents[1]
            p = Path(dest)
            return p if p.is_absolute() else (root / p)
        return models_dir() / meta["filename"]

    @staticmethod
    def _sha256(path: Path) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()