"""
app.py
Interfaccia utente Streamlit per Appunti2PDF: trasforma le foto degli appunti
scritti a mano in un unico PDF vettoriale pulito, pronto per l'indicizzazione
RAG di un Tutor AI.

NOTA: questo file viene normalmente avviato da 'desktop.py', che lo esegue
come server locale e lo incapsula in una finestra desktop nativa tramite
pywebview. Durante lo sviluppo puo' comunque essere lanciato direttamente
con 'streamlit run app.py' per test rapidi nel browser.

La chiave API Gemini NON e' mai richiesta, mostrata o modificabile
dall'utente finale: viene letta esclusivamente da variabili d'ambiente / file
.env, impostate da chi distribuisce l'applicazione.
"""
from __future__ import annotations

import tempfile
import traceback
from pathlib import Path
from typing import List, Optional, Tuple

import streamlit as st
import streamlit.components.v1 as components

from src.ai_text_cleaner import TextCleanerAI, TextCleanerAIError
from src.ai_vision_analyzer import VisionAnalyzerAI, VisionAnalyzerAIError
from src.config import get_logger, is_ai_configured, is_desktop_mode, write_debug_log
from src.ocr_engine import OCREngine, OCREngineError
from src.pdf_generator import PDFGenerationError, PDFGenerator
from src.ui_i18n import get_menu_translation_script
from src.utils import (
    cleanup_temp_dir,
    collect_images_from_folder,
    extract_zip_to_temp,
    is_supported_image,
    resize_if_needed,
    save_pdf_with_native_dialog,
    sort_images_naturally,
)

logger = get_logger(__name__)

FLOW_TEXT = "text"
FLOW_MAP = "map"

st.set_page_config(
    page_title="Appunti2PDF",
    page_icon="📚",
    layout="wide",
    menu_items={
        # "Get Help" e "Report a bug" puntano di default a pagine di
        # Streamlit in inglese, non pertinenti per questa app: le nascondiamo.
        "Get Help": None,
        "Report a bug": None,
        "About": (
            "### 📚 Appunti2PDF\n"
            "Trasforma le foto dei tuoi appunti scritti a mano in un PDF pulito, "
            "pronto per il tuo Tutor AI."
        ),
    },
)


# --------------------------------------------------------------------------- #
# Stile e traduzione del menu nativo
# --------------------------------------------------------------------------- #
def inject_css() -> None:
    st.markdown(
        """
        <style>
        .main .block-container { padding-top: 2rem; max-width: 900px; }
        .flow-card {
            border: 1px solid #e2e2e2; border-radius: 12px; padding: 1.1rem 1.3rem;
            margin-bottom: 0.6rem; height: 100%;
        }
        .flow-card h4 { margin: 0 0 0.35rem 0; }
        .flow-card p { color: #666; font-size: 0.88rem; margin: 0; }
        .step-title { font-size: 1.05rem; font-weight: 600; margin-top: 1.7rem; margin-bottom: 0.5rem; }
        .stButton>button[kind="primary"] { width: 100%; }
        /* Nasconde la scritta "Made with Streamlit": rende l'app piu' simile
           a un normale programma desktop (il menu "⋮" resta invariato). */
        footer { visibility: hidden; }
        </style>
        """,
        unsafe_allow_html=True,
    )


def inject_menu_translation() -> None:
    """Inietta lo script che traduce in italiano il menu nativo di Streamlit."""
    components.html(get_menu_translation_script(), height=0, width=0)


# --------------------------------------------------------------------------- #
# Risorse pesanti: caricate una sola volta e riutilizzate tra i rerun
# (st.cache_resource e' il meccanismo ufficiale di Streamlit per questo).
# --------------------------------------------------------------------------- #
@st.cache_resource(show_spinner=False)
def get_ocr_engine() -> OCREngine:
    return OCREngine()


@st.cache_resource(show_spinner=False)
def get_text_cleaner() -> TextCleanerAI:
    return TextCleanerAI()


@st.cache_resource(show_spinner=False)
def get_vision_analyzer() -> VisionAnalyzerAI:
    return VisionAnalyzerAI()


# --------------------------------------------------------------------------- #
# Stato di sessione
# --------------------------------------------------------------------------- #
def init_session_state() -> None:
    defaults = {
        "images": [],
        "temp_dirs": [],
        "pdf_bytes": None,
        "pdf_filename": None,
        "page_previews": [],
        "session_reset_key": 0,
    }
    for key, value in defaults.items():
        st.session_state.setdefault(key, value)


def reset_session() -> None:
    next_reset_key = st.session_state.get("session_reset_key", 0) + 1
    for temp_dir in st.session_state.get("temp_dirs", []):
        cleanup_temp_dir(temp_dir)
    for key in list(st.session_state.keys()):
        del st.session_state[key]
    st.session_state["session_reset_key"] = next_reset_key


# --------------------------------------------------------------------------- #
# Caricamento immagini
# --------------------------------------------------------------------------- #
def handle_uploads(uploaded_files, uploaded_zip) -> None:
    new_images: List[Path] = []

    if uploaded_zip is not None:
        try:
            extracted_dir = extract_zip_to_temp(uploaded_zip.read())
            st.session_state["temp_dirs"].append(extracted_dir)
            new_images.extend(collect_images_from_folder(extracted_dir))
        except Exception as exc:  # noqa: BLE001
            st.error(f"Impossibile leggere l'archivio ZIP: {exc}")

    if uploaded_files:
        tmp_dir = Path(tempfile.mkdtemp(prefix="appunti2pdf_files_"))
        st.session_state["temp_dirs"].append(tmp_dir)
        saved_paths = []
        for uploaded in uploaded_files:
            dest = tmp_dir / uploaded.name
            dest.write_bytes(uploaded.getvalue())
            if is_supported_image(dest):
                saved_paths.append(dest)
            else:
                st.warning(f"File ignorato (formato non supportato): {uploaded.name}")
        new_images.extend(sort_images_naturally(saved_paths))

    if not new_images:
        st.warning("Nessuna immagine valida trovata tra i file caricati.")
        return

    st.session_state["images"] = new_images


# --------------------------------------------------------------------------- #
# Elaborazione
# --------------------------------------------------------------------------- #
def sanitize_filename(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in name).strip()
    return safe or "appunti"


def run_pipeline(images: List[Path], flow: str, doc_title: str) -> Tuple[bytes, str, List[Tuple[str, str]]]:
    """Esegue l'intera pipeline (OCR/Vision -> pulizia AI -> generazione PDF) e restituisce il risultato."""
    pdf = PDFGenerator(document_title=doc_title)
    previews: List[Tuple[str, str]] = []

    progress = st.progress(0.0, text="Avvio elaborazione...")
    status_area = st.empty()

    ocr_engine: Optional[OCREngine] = None
    cleaner: Optional[TextCleanerAI] = None
    analyzer: Optional[VisionAnalyzerAI] = None

    if flow == FLOW_TEXT:
        ocr_engine = get_ocr_engine()
        cleaner = get_text_cleaner()
    else:
        analyzer = get_vision_analyzer()

    total = len(images)
    for idx, image_path in enumerate(images, start=1):
        page_label = f"Pagina {idx} — {image_path.name}"
        status_area.info(f"⏳ {page_label}: elaborazione in corso...")
        try:
            resize_if_needed(image_path)

            if flow == FLOW_TEXT:
                raw_text = ocr_engine.extract_text(image_path)
                if not raw_text.strip():
                    pdf.add_error_section(page_label, "nessun testo rilevato dall'OCR.")
                    previews.append((page_label, "[Nessun testo rilevato]"))
                else:
                    cleaned = cleaner.clean_text(raw_text)
                    pdf.add_text_section(page_label, cleaned)
                    previews.append((page_label, cleaned))
            else:
                structured = analyzer.analyze_image(image_path)
                pdf.add_structured_section(page_label, structured)
                previews.append((page_label, structured))

        except (OCREngineError, TextCleanerAIError, VisionAnalyzerAIError) as exc:
            logger.exception("Errore nell'elaborazione di %s", image_path.name)
            pdf.add_error_section(page_label, str(exc))
            previews.append((page_label, f"[ERRORE: {exc}]"))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Errore imprevisto su %s", image_path.name)
            pdf.add_error_section(page_label, f"errore imprevisto ({exc})")
            previews.append((page_label, f"[ERRORE IMPREVISTO: {exc}]"))

        progress.progress(idx / total, text=f"Elaborate {idx}/{total} pagine")

    status_area.empty()

    output_dir = Path(tempfile.mkdtemp(prefix="appunti2pdf_out_"))
    output_path = output_dir / f"{sanitize_filename(doc_title)}.pdf"
    pdf.build(output_path)
    pdf_bytes = output_path.read_bytes()
    cleanup_temp_dir(output_dir)
    return pdf_bytes, output_path.name, previews


# --------------------------------------------------------------------------- #
# UI principale
# --------------------------------------------------------------------------- #
def main() -> None:
    inject_css()
    inject_menu_translation()
    init_session_state()

    st.title("📚 Appunti2PDF")
    st.caption(
        "Trasforma le foto dei tuoi appunti scritti a mano in un unico PDF pulito, "
        "pronto per essere usato dal tuo Tutor AI."
    )

    with st.sidebar:
        st.markdown("### 📚 Appunti2PDF")
        st.caption("Da foto di appunti a PDF, in pochi passaggi.")
        st.divider()
        if st.button("🗑️ Nuova sessione", use_container_width=True):
            reset_session()
            st.rerun()

    ai_ready = is_ai_configured()
    # #region agent log
    import json, time
    from pathlib import Path as _Path
    try:
        _log_path = _Path(__file__).resolve().parent / "debug-cb680a.log"
        with _log_path.open("a", encoding="utf-8") as _f:
            _f.write(json.dumps({
                "sessionId": "cb680a",
                "runId": "post-fix",
                "hypothesisId": "D",
                "location": "app.py:main",
                "message": "ai_ready check at startup",
                "data": {"ai_ready": ai_ready},
                "timestamp": int(time.time() * 1000),
            }, ensure_ascii=False) + "\n")
    except OSError:
        pass
    # #endregion

    # STEP 1 — Caricamento
    st.markdown('<div class="step-title">1. Carica i tuoi appunti</div>', unsafe_allow_html=True)
    reset_key = st.session_state["session_reset_key"]
    upload_mode = st.radio(
        "Modalità di caricamento",
        ["Singole immagini", "Cartella (file ZIP)"],
        horizontal=True,
        label_visibility="collapsed",
        key=f"upload_mode_{reset_key}",
    )
    uploaded_files, uploaded_zip = None, None
    if upload_mode == "Singole immagini":
        uploaded_files = st.file_uploader(
            "Carica una o più foto (JPG, PNG...)",
            type=["png", "jpg", "jpeg", "webp", "bmp", "tiff"],
            accept_multiple_files=True,
            key=f"upload_images_{reset_key}",
        )
    else:
        uploaded_zip = st.file_uploader(
            "Carica un archivio ZIP della cartella di foto",
            type=["zip"],
            key=f"upload_zip_{reset_key}",
        )

    if st.button("📥 Carica appunti", disabled=not (uploaded_files or uploaded_zip), key=f"load_uploads_{reset_key}"):
        with st.spinner("Caricamento e validazione immagini..."):
            handle_uploads(uploaded_files, uploaded_zip)

    if st.session_state["images"]:
        st.success(f"{len(st.session_state['images'])} pagine caricate e ordinate.")
        with st.expander("Anteprima ordine pagine"):
            st.caption(
                "L'ordine segue il nome del file (es. pagina1, pagina2, ...). "
                "Rinomina i file prima del caricamento per controllare l'ordine finale."
            )
            for i, img in enumerate(st.session_state["images"], start=1):
                st.write(f"{i}. {img.name}")

    if not st.session_state["images"]:
        st.info("Carica delle immagini per continuare.")
        return

    # STEP 2 — Scelta del flusso
    st.markdown('<div class="step-title">2. Che tipo di appunti sono?</div>', unsafe_allow_html=True)
    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown(
            '<div class="flow-card"><h4>📝 Testo continuo</h4>'
            '<p>Pagine scritte a righe, riassunti, brani di testo tradizionali.</p></div>',
            unsafe_allow_html=True,
        )
    with col_b:
        st.markdown(
            '<div class="flow-card"><h4>🗺️ Mappe / Schemi</h4>'
            '<p>Diagrammi, concetti in riquadri, frecce di collegamento, layout non lineare.</p></div>',
            unsafe_allow_html=True,
        )
    flow_choice = st.radio(
        "Scegli il tipo di elaborazione",
        ["Testo continuo / Riassunto", "Mappe / Schemi a blocchi"],
        label_visibility="collapsed",
        key=f"flow_choice_{reset_key}",
    )
    flow = FLOW_TEXT if flow_choice.startswith("Testo") else FLOW_MAP

    # STEP 3 — Titolo documento
    st.markdown('<div class="step-title">3. Dai un titolo al documento</div>', unsafe_allow_html=True)
    doc_title = st.text_input(
        "Titolo del PDF",
        value="Appunti",
        label_visibility="collapsed",
        key=f"doc_title_{reset_key}",
    )

    # STEP 4 — Generazione
    st.markdown('<div class="step-title">4. Genera il PDF</div>', unsafe_allow_html=True)

    if st.button("🚀 Genera PDF", type="primary", disabled=not ai_ready, key=f"generate_pdf_{reset_key}"):
        try:
            with st.spinner("Elaborazione in corso... può richiedere qualche minuto in base al numero di pagine."):
                pdf_bytes, pdf_name, previews = run_pipeline(st.session_state["images"], flow, doc_title)
            st.session_state["pdf_bytes"] = pdf_bytes
            st.session_state["pdf_filename"] = pdf_name
            st.session_state["page_previews"] = previews
            st.success("✅ PDF generato con successo!")
        except PDFGenerationError as exc:
            st.error(f"Errore nella generazione del PDF: {exc}")
        except (TextCleanerAIError, VisionAnalyzerAIError) as exc:
            logger.error("Errore di configurazione AI: %s", exc)
            st.error("⚠️ Il servizio non è al momento disponibile. Riprova più tardi.")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Errore imprevisto nella pipeline")
            st.error(f"Errore imprevisto: {exc}")
            with st.expander("Dettagli tecnici"):
                st.code(traceback.format_exc())

    if st.session_state["pdf_bytes"]:
        pdf_bytes = st.session_state["pdf_bytes"]
        pdf_filename = st.session_state["pdf_filename"] or "appunti.pdf"
        desktop_mode = is_desktop_mode()
        # #region agent log
        write_debug_log(
            "app.py:download",
            "pdf ready for download",
            {
                "pdf_bytes_len": len(pdf_bytes),
                "pdf_filename": pdf_filename,
                "desktop_mode": desktop_mode,
            },
            "A",
        )
        # #endregion

        if desktop_mode:
            if st.button("⬇️ Scarica il PDF", key=f"save_pdf_native_{reset_key}", type="primary"):
                # #region agent log
                write_debug_log(
                    "app.py:download",
                    "native save button clicked",
                    {"pdf_bytes_len": len(pdf_bytes), "pdf_filename": pdf_filename},
                    "B",
                )
                # #endregion
                try:
                    saved_path = save_pdf_with_native_dialog(pdf_bytes, pdf_filename)
                    # #region agent log
                    write_debug_log(
                        "app.py:download",
                        "native save dialog result",
                        {"saved_path": saved_path, "cancelled": saved_path is None},
                        "C",
                    )
                    # #endregion
                    if saved_path:
                        st.success(f"✅ PDF salvato in: {saved_path}")
                    else:
                        st.info("Salvataggio annullato.")
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Errore nel salvataggio nativo del PDF")
                    # #region agent log
                    write_debug_log(
                        "app.py:download",
                        "native save failed",
                        {"error": str(exc)},
                        "D",
                    )
                    # #endregion
                    st.error(f"Impossibile salvare il PDF: {exc}")
        else:
            st.download_button(
                "⬇️ Scarica il PDF",
                data=pdf_bytes,
                file_name=pdf_filename,
                mime="application/pdf",
                key=f"save_pdf_browser_{reset_key}",
            )
        with st.expander("Anteprima testo estratto per pagina"):
            for label, text in st.session_state["page_previews"]:
                st.markdown(f"**{label}**")
                preview = text[:2000] + ("…" if len(text) > 2000 else "")
                st.text(preview)
                st.divider()


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        logger.exception("Errore fatale non gestito nell'app")
        st.error(
            "Si è verificato un errore imprevisto. Prova a riavviare l'applicazione. "
            "Se il problema persiste, contatta il supporto."
        )
