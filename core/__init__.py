"""
core/parsers/__init__.py
--------------------------
Dispatcher dei parser: dato un percorso di file, individua il parser
giusto e ritorna il ParsedDocument corrispondente.

Estensioni supportate:
  Immagini: .jpg .jpeg .png .bmp .tiff .tif
  Documenti: .pdf .docx .pptx .xlsx
  Testo: .txt .md .markdown

Per aggiungere un nuovo formato:
  1. creare un nuovo modulo in questa cartella con una funzione extract()
  2. registrare l'estensione in _EXTENSION_TO_PARSER
"""

from pathlib import Path
from typing import Callable, Dict, Optional, Set

from core.models import ParsedDocument


_SUPPORTED_EXTENSIONS: Set[str] = {
    ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif",
    ".pdf", ".docx", ".pptx", ".xlsx",
    ".txt", ".md", ".markdown",
}


def _parse_image(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    from core.parsers import image_parser
    return image_parser.extract(file_path, ocr_enabled=ocr_enabled)


def _parse_pdf(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    from core.parsers import pdf_parser
    return pdf_parser.extract(file_path)


def _parse_docx(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    from core.parsers import docx_parser
    return docx_parser.extract(file_path)


def _parse_pptx(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    from core.parsers import pptx_parser
    return pptx_parser.extract(file_path)


def _parse_xlsx(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    from core.parsers import xlsx_parser
    return xlsx_parser.extract(file_path)


def _parse_text(file_path: str, ocr_enabled: bool = True) -> ParsedDocument:
    from core.parsers import txt_parser
    return txt_parser.extract(file_path)


_EXTENSION_TO_PARSER: Dict[str, Callable[..., ParsedDocument]] = {
    ".jpg": _parse_image,
    ".jpeg": _parse_image,
    ".png": _parse_image,
    ".bmp": _parse_image,
    ".tiff": _parse_image,
    ".tif": _parse_image,
    ".pdf": _parse_pdf,
    ".docx": _parse_docx,
    ".pptx": _parse_pptx,
    ".xlsx": _parse_xlsx,
    ".txt": _parse_text,
    ".md": _parse_text,
    ".markdown": _parse_text,
}


def is_supported(file_path: str) -> bool:
    """True se l'estensione del file è gestita da un parser."""
    suffix = Path(file_path).suffix.lower()
    return suffix in _SUPPORTED_EXTENSIONS


def parse_file(file_path: str, ocr_enabled: bool = True) -> Optional[ParsedDocument]:
    """Instrada il file al parser giusto. Se non supportato, ritorna None."""
    suffix = Path(file_path).suffix.lower()
    parser = _EXTENSION_TO_PARSER.get(suffix)
    if not parser:
        return None
    return parser(file_path, ocr_enabled=ocr_enabled)