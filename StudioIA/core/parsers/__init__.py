"""
core/parsers/__init__.py
--------------------------
Router dei parser: in base all'estensione del file, richiama il parser
corretto. È l'unico punto che il resto dell'app deve conoscere; se in
futuro si aggiunge un formato, si tocca solo questo file + il nuovo parser.
"""

from pathlib import Path
from typing import Optional

from core.models import ParsedDocument
from core.parsers import docx_parser, image_parser, pdf_parser, pptx_parser, txt_parser, xlsx_parser

SUPPORTED_EXTENSIONS = {
    ".txt": "text",
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
    ".xlsx": "xlsx",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
}


def is_supported(file_path: str) -> bool:
    return Path(file_path).suffix.lower() in SUPPORTED_EXTENSIONS


def parse_file(file_path: str, ocr_enabled: bool = True) -> Optional[ParsedDocument]:
    """Analizza un file richiamando il parser corretto in base all'estensione.
    Ritorna None se il formato non è supportato (il chiamante lo ignora).

    Non solleva mai eccezioni verso il chiamante: qualunque errore imprevisto
    viene incapsulato nel campo `error` di ParsedDocument, così un singolo
    file corrotto non interrompe mai la scansione dell'intera cartella.
    """
    ext = Path(file_path).suffix.lower()
    kind = SUPPORTED_EXTENSIONS.get(ext)
    if kind is None:
        return None

    try:
        if kind == "text":
            return txt_parser.extract(file_path)
        if kind == "pdf":
            return pdf_parser.extract(file_path)
        if kind == "docx":
            return docx_parser.extract(file_path)
        if kind == "pptx":
            return pptx_parser.extract(file_path)
        if kind == "xlsx":
            return xlsx_parser.extract(file_path)
        if kind == "image":
            return image_parser.extract(file_path, ocr_enabled=ocr_enabled)
    except Exception as e:
        return ParsedDocument(source_file=file_path, error=f"Errore imprevisto: {e}")

    return None
