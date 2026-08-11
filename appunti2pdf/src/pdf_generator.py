"""
pdf_generator.py
Generazione del PDF finale: unico, vettoriale e ben formattato, a partire dal
testo gia' elaborato (Flusso A: paragrafi puliti; Flusso B: markdown
gerarchico), pronto per essere indicizzato da un Tutor AI (RAG).
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import List, Tuple

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)

from .config import get_logger

logger = get_logger(__name__)

_HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)")
_BULLET_RE = re.compile(r"^(\s*)[-*•·◦]\s+(.*)")
_BULLET_HANG_PT = 10  # spazio riservato a "- " per il rientro delle righe successive
_MAX_BULLET_LEVEL = 4


class PDFGenerationError(RuntimeError):
    """Errore durante la generazione del PDF."""


class PDFGenerator:
    """
    Costruisce un PDF vettoriale unico a partire da una sequenza di sezioni
    testuali (una per ogni pagina di appunti originale), con stile coerente,
    margini puliti e numerazione pagine.
    """

    def __init__(self, document_title: str = "Appunti"):
        self.document_title = (document_title or "").strip() or "Appunti"
        self._styles = getSampleStyleSheet()
        self._setup_custom_styles()
        self._story: List = []
        self._section_count = 0
        self._add_cover_page()

    # ------------------------------------------------------------------ #
    # Stili
    # ------------------------------------------------------------------ #
    def _setup_custom_styles(self) -> None:
        self._styles.add(ParagraphStyle(
            name="DocTitle", parent=self._styles["Title"], fontSize=26,
            spaceAfter=18, alignment=TA_CENTER, textColor=colors.HexColor("#1a1a2e"),
        ))
        self._styles.add(ParagraphStyle(
            name="DocSubtitle", parent=self._styles["Normal"], fontSize=11,
            textColor=colors.HexColor("#555555"), spaceAfter=6, alignment=TA_CENTER,
        ))
        self._styles.add(ParagraphStyle(
            name="SectionTitle", parent=self._styles["Heading1"], fontSize=16,
            spaceBefore=14, spaceAfter=8, textColor=colors.HexColor("#16213e"),
        ))
        self._styles.add(ParagraphStyle(
            name="SubHeading", parent=self._styles["Heading2"], fontSize=13,
            spaceBefore=10, spaceAfter=6, textColor=colors.HexColor("#0f3460"),
        ))
        self._styles.add(ParagraphStyle(
            name="SubSubHeading", parent=self._styles["Heading3"], fontSize=11.5,
            spaceBefore=8, spaceAfter=4, textColor=colors.HexColor("#0f3460"),
        ))
        self._styles.add(ParagraphStyle(
            name="BodyClean", parent=self._styles["BodyText"], fontSize=10.5,
            leading=15, spaceAfter=8, alignment=TA_JUSTIFY,
        ))
        self._styles.add(ParagraphStyle(
            name="BulletText", parent=self._styles["BodyText"], fontSize=10.5, leading=14,
        ))
        for level in range(_MAX_BULLET_LEVEL):
            self._styles.add(ParagraphStyle(
                name=f"BulletLevel{level}",
                parent=self._styles["BulletText"],
                leftIndent=6 + 12 * level + _BULLET_HANG_PT,
                firstLineIndent=-_BULLET_HANG_PT,
                spaceAfter=2,
            ))
        self._styles.add(ParagraphStyle(
            name="PageLabel", parent=self._styles["Normal"], fontSize=8,
            textColor=colors.HexColor("#999999"), spaceBefore=2, spaceAfter=10,
        ))
        self._styles.add(ParagraphStyle(
            name="ErrorNote", parent=self._styles["BodyText"], fontSize=9.5,
            textColor=colors.HexColor("#b00020"),
        ))

    # ------------------------------------------------------------------ #
    # Copertina
    # ------------------------------------------------------------------ #
    def _add_cover_page(self) -> None:
        self._story.append(Spacer(1, 6 * cm))
        self._story.append(Paragraph(self._escape(self.document_title), self._styles["DocTitle"]))
        subtitle = f"Documento generato automaticamente il {datetime.now().strftime('%d/%m/%Y alle %H:%M')}"
        self._story.append(Paragraph(subtitle, self._styles["DocSubtitle"]))
        self._story.append(PageBreak())

    # ------------------------------------------------------------------ #
    # Utility
    # ------------------------------------------------------------------ #
    @staticmethod
    def _escape(text: str) -> str:
        """Escaping minimo necessario perche' ReportLab interpreta un piccolo subset di markup XML-like."""
        return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    # ------------------------------------------------------------------ #
    # API pubblica - Flusso A
    # ------------------------------------------------------------------ #
    def add_text_section(self, page_label: str, cleaned_text: str) -> None:
        """Aggiunge una sezione FLUSSO A: paragrafi di testo continuo gia' pulito dall'AI."""
        if not cleaned_text.strip():
            logger.warning("Sezione vuota per '%s': verra' omessa dal PDF.", page_label)
            return

        self._section_count += 1
        self._story.append(Paragraph(self._escape(page_label), self._styles["PageLabel"]))

        paragraphs = [p.strip() for p in cleaned_text.split("\n\n") if p.strip()]
        if len(paragraphs) <= 1:
            # fallback: se l'AI non ha separato in paragrafi doppi, dividiamo per singolo a-capo
            paragraphs = [p.strip() for p in cleaned_text.split("\n") if p.strip()]

        for para in paragraphs:
            self._story.append(Paragraph(self._escape(para), self._styles["BodyClean"]))
        self._story.append(Spacer(1, 0.4 * cm))

    # ------------------------------------------------------------------ #
    # API pubblica - Flusso B
    # ------------------------------------------------------------------ #
    def add_structured_section(self, page_label: str, markdown_text: str) -> None:
        """Aggiunge una sezione FLUSSO B: markdown gerarchico risultante dall'analisi visiva."""
        if not markdown_text.strip():
            logger.warning("Sezione vuota per '%s': verra' omessa dal PDF.", page_label)
            return

        self._section_count += 1
        self._story.append(Paragraph(self._escape(page_label), self._styles["PageLabel"]))
        self._render_markdown(markdown_text)
        self._story.append(Spacer(1, 0.4 * cm))

    def _render_markdown(self, markdown_text: str) -> None:
        """Converte un sottoinsieme semplice di Markdown (titoli + liste annidate) in flowable ReportLab."""
        pending_bullets: List[Tuple[int, str]] = []

        def flush_bullets():
            if not pending_bullets:
                return
            for level, text in pending_bullets:
                style_name = f"BulletLevel{min(level, _MAX_BULLET_LEVEL - 1)}"
                self._story.append(
                    Paragraph(f"- {self._escape(text)}", self._styles[style_name])
                )
            pending_bullets.clear()

        for raw_line in markdown_text.splitlines():
            line = raw_line.rstrip()
            if not line.strip():
                continue

            heading_match = _HEADING_RE.match(line)
            bullet_match = _BULLET_RE.match(line)

            if heading_match:
                flush_bullets()
                level = len(heading_match.group(1))
                text = heading_match.group(2).strip()
                style_name = {1: "SectionTitle", 2: "SubHeading"}.get(level, "SubSubHeading")
                self._story.append(Paragraph(self._escape(text), self._styles[style_name]))
            elif bullet_match:
                indent_str, text = bullet_match.groups()
                indent_level = len(indent_str) // 2
                pending_bullets.append((indent_level, text.strip()))
            else:
                flush_bullets()
                self._story.append(Paragraph(self._escape(line.strip()), self._styles["BodyClean"]))

        flush_bullets()

    # ------------------------------------------------------------------ #
    # Gestione errori per-pagina (l'elaborazione continua comunque)
    # ------------------------------------------------------------------ #
    def add_error_section(self, page_label: str, error_message: str) -> None:
        """Segnala nel PDF che l'elaborazione di una pagina e' fallita, senza interrompere il documento."""
        self._story.append(Paragraph(self._escape(page_label), self._styles["PageLabel"]))
        self._story.append(Paragraph(
            f"Impossibile elaborare questa pagina: {self._escape(error_message)}",
            self._styles["ErrorNote"],
        ))
        self._story.append(Spacer(1, 0.4 * cm))

    # ------------------------------------------------------------------ #
    # Costruzione finale
    # ------------------------------------------------------------------ #
    def build(self, output_path: Path) -> Path:
        """Compila il documento finale e lo salva su disco. Restituisce il percorso del file creato."""
        if self._section_count == 0:
            raise PDFGenerationError(
                "Nessun contenuto valido da inserire nel PDF: l'elaborazione e' fallita per tutte le pagine."
            )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        doc = BaseDocTemplate(
            str(output_path),
            pagesize=A4,
            leftMargin=2 * cm, rightMargin=2 * cm,
            topMargin=2 * cm, bottomMargin=2 * cm,
            title=self.document_title,
            author="Appunti2PDF",
        )
        frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
        template = PageTemplate(id="main", frames=[frame], onPage=self._draw_footer)
        doc.addPageTemplates([template])

        try:
            doc.build(self._story)
        except Exception as exc:  # noqa: BLE001
            raise PDFGenerationError(f"Errore durante la compilazione del PDF: {exc}") from exc

        logger.info("PDF generato correttamente: %s (%d sezioni)", output_path, self._section_count)
        return output_path

    @staticmethod
    def _draw_footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#999999"))
        canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Pagina {doc.page}")
        canvas.drawString(2 * cm, 1.2 * cm, "Generato con Appunti2PDF")
        canvas.restoreState()
