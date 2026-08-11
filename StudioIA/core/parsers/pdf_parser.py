"""
core/parsers/pdf_parser.py
Estrazione da file .pdf: testo pagina per pagina e immagini incorporate.

Libreria scelta: PyMuPDF (import fitz). Un'unica libreria gestisce sia il
testo sia l'estrazione delle immagini incorporate in modo affidabile,
riducendo le dipendenze rispetto a usarne due diverse per lo stesso formato.
"""

import fitz  # PyMuPDF

from core.models import ExtractedImage, ParsedDocument


def extract(file_path: str) -> ParsedDocument:
    try:
        doc = fitz.open(file_path)
    except Exception as e:
        return ParsedDocument(source_file=file_path, error=f"PDF illeggibile: {e}")

    full_text_parts = []
    images = []

    try:
        for page_index in range(len(doc)):
            page = doc[page_index]
            page_label = f"pagina {page_index + 1}"

            try:
                page_text = page.get_text("text")
            except Exception:
                page_text = ""

            if page_text.strip():
                full_text_parts.append(f"[{page_label}]\n{page_text.strip()}")

            # Estrazione immagini incorporate nella pagina.
            try:
                image_list = page.get_images(full=True)
            except Exception:
                image_list = []

            for img_index, img_info in enumerate(image_list):
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    ext = base_image.get("ext", "png")
                    mime_type = f"image/{ext}"

                    # Il "testo vicino" è semplicemente il testo della stessa
                    # pagina: è l'euristica più robusta e la meno soggetta a
                    # bug (non richiede calcolare la posizione esatta
                    # dell'immagine nel layout).
                    nearby = page_text.strip()[:1500]

                    images.append(
                        ExtractedImage(
                            source_file=file_path,
                            location_hint=f"{page_label}, immagine {img_index + 1}",
                            image_bytes=image_bytes,
                            mime_type=mime_type,
                            nearby_text=nearby,
                        )
                    )
                except Exception:
                    # Un'immagine corrotta o non estraibile non deve bloccare
                    # il resto della pagina/file.
                    continue
    finally:
        doc.close()

    return ParsedDocument(
        source_file=file_path,
        text="\n\n".join(full_text_parts),
        images=images,
    )
