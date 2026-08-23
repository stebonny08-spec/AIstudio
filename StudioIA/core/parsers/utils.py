"""
core/parsers/utils.py
Funzioni di supporto condivise tra i parser.
"""

import io

from PIL import Image


def guess_mime_type(image_bytes: bytes, default: str = "image/png") -> str:
    """Rileva il formato reale di un'immagine leggendo i suoi byte (tramite Pillow),
    invece di fidarsi ciecamente dell'estensione del file o di un valore fisso.
    Usato principalmente per Excel, dove openpyxl non espone il mime type in modo pulito.
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            fmt = (img.format or "").upper()
            mapping = {
                "JPEG": "image/jpeg",
                "JPG": "image/jpeg",
                "PNG": "image/png",
                "GIF": "image/gif",
                "BMP": "image/bmp",
                "WEBP": "image/webp",
                "TIFF": "image/tiff",
            }
            return mapping.get(fmt, default)
    except Exception:
        return default
