"""
core/parsers/txt_parser.py
Estrazione da file .txt semplici.
"""

from core.models import ParsedDocument


def extract(file_path: str) -> ParsedDocument:
    # Proviamo prima UTF-8 (lo standard moderno), poi ripieghiamo su latin-1
    # che non fallisce quasi mai (anche se può produrre qualche carattere
    # strano su file molto vecchi) piuttosto che far crashare la scansione.
    text = None
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            with open(file_path, "r", encoding=encoding) as f:
                text = f.read()
            break
        except (UnicodeDecodeError, OSError):
            continue

    if text is None:
        return ParsedDocument(source_file=file_path, error="Impossibile leggere il file di testo")

    return ParsedDocument(source_file=file_path, text=text, images=[])
