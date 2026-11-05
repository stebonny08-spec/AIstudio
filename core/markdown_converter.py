"""
core/markdown_converter.py
---------------------------
Converte immagini, PDF, documenti Word, presentazioni PowerPoint, file
di testo e file Markdown in file Markdown ottimizzati per RAG.

Tutto elaborato in locale usando OpenCV, Tesseract OCR e librerie native.
Tesseract può essere incluso nel bundle (vedi ocr_processor.py).
"""

from __future__ import annotations

import cv2
import numpy as np
import pytesseract
from pathlib import Path
from typing import List, Optional, Tuple
import json
import logging
import re

from core.models import ExtractedImage
from core.ocr_processor import (
    _resolve_tesseract_cmd as _resolve_tess,
    _configure_tessdata,
)

try:
    import pymupdf as fitz
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False
    logging.warning("PyMuPDF non installato. Supporto PDF disabilitato.")

try:
    from docx import Document
    DOCX_SUPPORT = True
except ImportError:
    DOCX_SUPPORT = False
    logging.warning("python-docx non installato. Supporto DOCX disabilitato.")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MarkdownConverter:
    """Converte vari formati in Markdown ottimizzato per AI."""

    def __init__(self, tesseract_cmd: Optional[str] = None):
        resolved = _resolve_tess(tesseract_cmd)
        if resolved:
            pytesseract.pytesseract.tesseract_cmd = resolved
            _configure_tessdata(resolved)
            logger.info(f"Tesseract trovato in: {resolved}")

        try:
            pytesseract.get_tesseract_version()
            logger.info("Tesseract OCR inizializzato per MarkdownConverter")
            self._ocr_available = True
        except Exception as e:
            logger.warning(f"Tesseract non trovato: {e}. OCR disabilitato.")
            self._ocr_available = False

    # ------------------------------------------------------------------
    def preprocess_image_for_ocr(self, image: np.ndarray) -> Tuple[np.ndarray, str]:
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()

        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        denoised = cv2.fastNlMeansDenoising(
            enhanced, None, h=15, templateWindowSize=7, searchWindowSize=21,
        )

        text_blocks = self._detect_text_blocks(denoised)
        if text_blocks:
            full_text = []
            for block in sorted(text_blocks, key=lambda b: (b['y'], b['x'])):
                x, y, w, h = block['x'], block['y'], block['w'], block['h']
                margin = 5
                roi_x = max(0, x - margin)
                roi_y = max(0, y - margin)
                roi_w = min(denoised.shape[1] - roi_x, w + 2 * margin)
                roi_h = min(denoised.shape[0] - roi_y, h + 2 * margin)
                roi = denoised[roi_y:roi_y+roi_h, roi_x:roi_x+roi_w]
                roi_thresh = cv2.adaptiveThreshold(
                    roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                    cv2.THRESH_BINARY, blockSize=11, C=5,
                )
                if not self._ocr_available:
                    continue
                try:
                    text = pytesseract.image_to_string(
                        roi_thresh, lang='ita+eng', config=r'--oem 3 --psm 6',
                    )
                    full_text.append(text.strip())
                except Exception as e:
                    logger.warning(f"OCR fallito su blocco: {e}")
            return denoised, '\n\n'.join(full_text)

        thresh = cv2.adaptiveThreshold(
            denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, blockSize=11, C=5,
        )
        if not self._ocr_available:
            return thresh, ""
        try:
            text = pytesseract.image_to_string(
                thresh, lang='ita+eng', config=r'--oem 3 --psm 6',
            )
        except Exception as e:
            logger.warning(f"OCR fallito: {e}")
            text = ""
        return thresh, text.strip()

    def _detect_text_blocks(self, image: np.ndarray) -> List[dict]:
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        blocks = []
        for contour in contours:
            if cv2.contourArea(contour) > 500:
                x, y, w, h = cv2.boundingRect(contour)
                if w > 20 and h > 20:
                    blocks.append({'x': x, 'y': y, 'w': w, 'h': h})
        return blocks

    # ------------------------------------------------------------------
    def _format_as_markdown(self, text: str, source_type: str = "generic") -> str:
        if not text:
            return ""
        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        lines = []
        in_list = False
        for para in paragraphs:
            if len(para) < 80 and (para.endswith(':') or para.isupper()):
                lines.append(f"\n## {para.rstrip(':')}\n")
                in_list = False
            elif re.match(r'^[\-\*•]\s+', para) or re.match(r'^\d+[\.\)\s]', para):
                if not in_list:
                    lines.append("")
                    in_list = True
                lines.append(f"- {para.lstrip('-*•').strip()}")
            else:
                if in_list:
                    lines.append("")
                    in_list = False
                lines.append(para)
        return '\n'.join(lines).strip()

    # ------------------------------------------------------------------
    # CONVERSIONI SPECIFICHE
    # ------------------------------------------------------------------
    def convert_image_to_markdown(self, image_path, output_path=None) -> str:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Impossibile caricare: {image_path}")
        _, text = self.preprocess_image_for_ocr(image)
        md = self._format_as_markdown(text, "image")
        if output_path:
            out = Path(output_path)
            if out.suffix != '.md':
                out = out.with_suffix('.md')
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding='utf-8')
        return md

    def convert_pdf_to_markdown(self, pdf_path, output_path=None) -> str:
        if not PDF_SUPPORT:
            raise RuntimeError("PyMuPDF non installato.")
        pdf_file = Path(pdf_path)
        if not pdf_file.exists():
            raise FileNotFoundError(f"PDF non trovato: {pdf_path}")
        all_text = []
        doc = fitz.open(pdf_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if len(text.strip()) < 50:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                img_data = pix.tobytes("png")
                img_array = np.frombuffer(img_data, np.uint8).reshape(
                    (pix.height, pix.width, 4)
                )
                img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGBA2BGR)
                _, ocr_text = self.preprocess_image_for_ocr(img_bgr)
                text = ocr_text
            if text.strip():
                all_text.append(f"### Pagina {page_num + 1}\n\n{text}")
        doc.close()
        md = self._format_as_markdown('\n\n'.join(all_text), "pdf")
        if output_path:
            out = Path(output_path)
            if out.suffix != '.md':
                out = out.with_suffix('.md')
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding='utf-8')
        return md

    def convert_docx_to_markdown(self, docx_path, output_path=None) -> str:
        if not DOCX_SUPPORT:
            raise RuntimeError("python-docx non installato.")
        docx_file = Path(docx_path)
        if not docx_file.exists():
            raise FileNotFoundError(f"Documento non trovato: {docx_path}")
        doc = Document(docx_path)
        paragraphs = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue
            style_name = (para.style.name or "").lower() if para.style else ""
            if 'heading 1' in style_name:
                paragraphs.append(f"# {text}")
            elif 'heading 2' in style_name:
                paragraphs.append(f"## {text}")
            elif 'heading 3' in style_name:
                paragraphs.append(f"### {text}")
            elif 'list' in style_name or text.startswith(('-', '*', '•')):
                paragraphs.append(f"- {text.lstrip('-*•').strip()}")
            else:
                paragraphs.append(text)
        for table in doc.tables:
            if not table.rows:
                continue
            paragraphs.append("\n| " + " | ".join(
                c.text for c in table.rows[0].cells) + " |")
            paragraphs.append("|" + "|".join(["---"] * len(table.rows[0].cells)) + "|")
            for row in table.rows[1:]:
                paragraphs.append("| " + " | ".join(c.text for c in row.cells) + " |")
        md = self._format_as_markdown('\n\n'.join(paragraphs), "docx")
        if output_path:
            out = Path(output_path)
            if out.suffix != '.md':
                out = out.with_suffix('.md')
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding='utf-8')
        return md

    # ------------------------------------------------------------------
    # PowerPoint
    # ------------------------------------------------------------------
    def convert_pptx_to_markdown(self, pptx_path, output_path=None) -> str:
        """Converte una presentazione PowerPoint in Markdown.

        Riusa il pptx_parser (che estrae testo delle slide, note del
        relatore e immagini incorporate con nearby_text) per evitare di
        duplicare la logica.
        """
        from core.parsers import pptx_parser

        pptx_file = Path(pptx_path)
        if not pptx_file.exists():
            raise FileNotFoundError(f"Presentazione non trovata: {pptx_path}")

        parsed = pptx_parser.extract(str(pptx_file))
        if parsed.error:
            raise RuntimeError(parsed.error)

        text = parsed.text or ""
        md = self._format_as_markdown(text, "pptx")

        if output_path:
            out = Path(output_path)
            if out.suffix != '.md':
                out = out.with_suffix('.md')
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding='utf-8')
        return md

    # ------------------------------------------------------------------
    # TESTO SEMPLICE E MARKDOWN
    # ------------------------------------------------------------------
    def convert_text_to_markdown(self, text_path, output_path=None) -> str:
        fp = Path(text_path)
        if not fp.exists():
            raise FileNotFoundError(f"File non trovato: {text_path}")

        text: Optional[str] = None
        for enc in ("utf-8", "utf-8-sig", "latin-1"):
            try:
                text = fp.read_text(encoding=enc)
                break
            except (UnicodeDecodeError, OSError):
                continue
        if text is None:
            raise RuntimeError("Impossibile leggere il file di testo")

        suffix = fp.suffix.lower()
        if suffix in (".md", ".markdown"):
            md = text
        else:
            md = self._format_as_markdown(text, "text")

        if output_path:
            out = Path(output_path)
            if out.suffix != '.md':
                out = out.with_suffix('.md')
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(md, encoding='utf-8')
        return md

    # ------------------------------------------------------------------
    # DISPATCHER
    # ------------------------------------------------------------------
    def convert_file_to_markdown(self, file_path, output_folder) -> str:
        fp = Path(file_path)
        of = Path(output_folder)
        of.mkdir(parents=True, exist_ok=True)
        out = of / (fp.stem + ".md")
        suffix = fp.suffix.lower()

        if suffix in ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif']:
            self.convert_image_to_markdown(str(fp), str(out))
        elif suffix == '.pdf':
            self.convert_pdf_to_markdown(str(fp), str(out))
        elif suffix == '.docx':
            self.convert_docx_to_markdown(str(fp), str(out))
        elif suffix == '.pptx':
            self.convert_pptx_to_markdown(str(fp), str(out))
        elif suffix in ('.txt', '.md', '.markdown'):
            self.convert_text_to_markdown(str(fp), str(out))
        else:
            raise ValueError(f"Formato non supportato: {suffix}")
        return str(out)

    def convert_file_with_images(self, file_path, output_folder) -> str:
        md_path = self.convert_file_to_markdown(file_path, output_folder)
        try:
            images = self._extract_images_for_rag(file_path)
        except Exception as e:
            logger.warning(f"Estrazione immagini fallita per {file_path}: {e}")
            images = []
        if images:
            self._write_image_sidecar(md_path, images)
        return md_path

    def _extract_images_for_rag(self, file_path) -> List[ExtractedImage]:
        suffix = Path(file_path).suffix.lower()
        if suffix == '.pdf':
            from core.parsers import pdf_parser
            parsed = pdf_parser.extract(str(file_path))
            return [] if parsed.error else parsed.images
        if suffix == '.docx':
            from core.parsers import docx_parser
            parsed = docx_parser.extract(str(file_path))
            return [] if parsed.error else parsed.images
        if suffix == '.pptx':
            from core.parsers import pptx_parser
            parsed = pptx_parser.extract(str(file_path))
            return [] if parsed.error else parsed.images
        if suffix in ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'):
            return [self._whole_image_as_extracted(file_path)]
        return []

    @staticmethod
    def _whole_image_as_extracted(file_path) -> ExtractedImage:
        from core.parsers.utils import guess_mime_type
        with open(file_path, 'rb') as f:
            data = f.read()
        return ExtractedImage(
            source_file=str(file_path),
            location_hint="immagine intera",
            image_bytes=data,
            mime_type=guess_mime_type(data, default='image/png'),
            nearby_text=f"File immagine: {Path(file_path).name}",
        )

    @staticmethod
    def _write_image_sidecar(md_path, images) -> None:
        from core.rag.image_cache import save_image_to_cache
        entries = []
        for img in images:
            if not img.nearby_text.strip():
                continue
            cached = save_image_to_cache(img)
            entries.append({
                "path": cached,
                "mime_type": img.mime_type,
                "location_hint": img.location_hint,
                "nearby_text": img.nearby_text,
            })
        if not entries:
            return
        sidecar = Path(md_path).with_suffix('').with_suffix('.images.json')
        sidecar.write_text(
            json.dumps({"source_file": md_path, "images": entries},
                       ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        logger.info(f"Sidecar immagini salvato: {sidecar} ({len(entries)} immagini)")


def convert_to_markdown(input_path: str, output_folder: str) -> str:
    return MarkdownConverter().convert_file_to_markdown(input_path, output_folder)