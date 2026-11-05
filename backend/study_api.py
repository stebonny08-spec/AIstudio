"""
backend/study_api.py
--------------------
Mixin di API per i nuovi moduli della suite studio (Appunti, Schemi,
Produttività, Ripasso, Biblioteca, Calendario, metadati Chatbot).

Tutto è locale: nessuna chiamata di rete, nessun servizio esterno.
Le chiamate sono esposte a JavaScript attraverso StudioIAAPI (pywebview).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import webview

from data.config_manager import get_app_data_dir

ASSET_FILE_TYPES = (
    "Immagini e media (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.mp4;*.webm;*.mp3;*.wav;*.ogg)",
    "Immagini (*.png;*.jpg;*.jpeg;*.gif;*.webp)",
    "Video (*.mp4;*.webm;*.ogg)",
    "Audio (*.mp3;*.wav;*.ogg;*.m4a)",
    "Tutti i file (*.*)",
)

# Tipi di elemento consentiti (whitelist)
ITEM_KINDS = (
    "note", "schema", "riassunto", "mazzo", "presentazione",
    "documento", "foglio", "video", "altro",
)


class StudyAPI:
    """Metodi esposti a JS per i nuovi moduli. Richiede self.db (Database)."""

    # ------------------------------------------------------------------
    # ELEMENTI GENERALI (study_items)
    # ------------------------------------------------------------------
    def study_list(self, kind: str = "", query: str = "", materia: str = "",
                   tag: str = "", sort: str = "updated"):
        try:
            items = self.db.study_list()
            if kind:
                items = [i for i in items if i["kind"] == kind]
            if materia:
                items = [i for i in items if i.get("materia") == materia]
            if tag:
                items = [i for i in items if tag in (i.get("tags") or "").split(",")]
            if query:
                q = query.lower()
                items = [
                    i for i in items
                    if q in (i.get("title") or "").lower()
                    or q in (i.get("description") or "").lower()
                    or q in (i.get("preview") or "").lower()
                ]
            if sort == "name":
                items.sort(key=lambda i: (i.get("title") or "").lower())
            elif sort == "kind":
                items.sort(key=lambda i: i.get("kind") or "")
            # "updated" è l'ordinamento di default del database
            return items
        except Exception as e:
            print(f"[StudyAPI] study_list error: {e}")
            return []

    def study_get(self, item_id: str):
        try:
            return self.db.study_get(item_id)
        except Exception as e:
            return {"error": str(e)}

    def study_save(self, payload: dict):
        try:
            if not isinstance(payload, dict):
                return {"error": "Payload non valido"}
            if payload.get("kind") not in ITEM_KINDS:
                return {"error": "Tipo di elemento non valido"}
            if not payload.get("title"):
                payload["title"] = "Senza titolo"
            return {"success": True, "item": self.db.study_save(payload)}
        except Exception as e:
            return {"error": str(e)}

    def study_delete(self, item_id: str):
        try:
            return {"success": self.db.study_delete(item_id)}
        except Exception as e:
            return {"error": str(e)}

    def study_duplicate(self, item_id: str):
        try:
            item = self.db.study_duplicate(item_id)
            return {"success": True, "item": item} if item else {"error": "Elemento non trovato"}
        except Exception as e:
            return {"error": str(e)}

    def study_rename(self, item_id: str, title: str):
        try:
            item = self.db.study_get(item_id)
            if not item:
                return {"error": "Elemento non trovato"}
            item["title"] = title or "Senza titolo"
            return {"success": True, "item": self.db.study_save(item)}
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # CARTELLE (sistema globale: chat | note | schema)
    # ------------------------------------------------------------------
    FOLDER_KINDS = ("chat", "note", "schema")

    def folders_list(self, kind: str = "note"):
        try:
            if kind not in self.FOLDER_KINDS:
                return []
            return self.db.folders_list(kind)
        except Exception as e:
            print(f"[StudyAPI] folders_list error: {e}")
            return []

    def folders_save(self, payload: dict):
        try:
            if not isinstance(payload, dict) or payload.get("kind") not in self.FOLDER_KINDS:
                return {"error": "Cartella non valida"}
            if not (payload.get("name") or "").strip():
                return {"error": "Nome cartella mancante"}
            return {"success": True, "folder": self.db.folders_save(payload)}
        except Exception as e:
            return {"error": str(e)}

    def folders_delete(self, folder_id: str):
        try:
            return {"success": self.db.folders_delete(folder_id)}
        except Exception as e:
            return {"error": str(e)}

    def chat_folder_save(self, conversation_id, folder_id: str = ""):
        try:
            self.db.set_chat_folder(int(conversation_id), folder_id or "")
            return {"success": True}
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # APERTURA FILE LOCALE (es. PPT inserito in un appunto)
    # ------------------------------------------------------------------
    def study_open_file(self, path: str):
        try:
            p = Path(path)
            if not p.exists():
                return {"success": False, "error": "File non trovato"}
            if os.name == "nt":
                os.startfile(str(p))  # noqa: S606
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(p)])
            else:
                subprocess.Popen(["xdg-open", str(p)])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # MATERIE
    # ------------------------------------------------------------------
    def subjects_list(self):
        try:
            return self.db.subjects_list()
        except Exception as e:
            print(f"[StudyAPI] subjects_list error: {e}")
            return []

    def subjects_save(self, payload: dict):
        try:
            if not payload.get("name"):
                return {"error": "Nome materia mancante"}
            return {"success": True, "subject": self.db.subjects_save(payload)}
        except Exception as e:
            return {"error": str(e)}

    def subjects_delete(self, subject_id: str):
        try:
            return {"success": self.db.subjects_delete(subject_id)}
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # CALENDARIO
    # ------------------------------------------------------------------
    def events_list(self):
        try:
            return self.db.events_list()
        except Exception as e:
            print(f"[StudyAPI] events_list error: {e}")
            return []

    def events_save(self, payload: dict):
        try:
            if not payload.get("title") or not payload.get("date"):
                return {"error": "Titolo o data mancante"}
            return {"success": True, "event": self.db.events_save(payload)}
        except Exception as e:
            return {"error": str(e)}

    def events_delete(self, event_id: str):
        try:
            return {"success": self.db.events_delete(event_id)}
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # METADATI CONVERSAZIONI CHATBOT
    # ------------------------------------------------------------------
    def chat_meta_save(self, conversation_id, materia: str = "", attivita: str = ""):
        try:
            self.db.set_chat_meta(int(conversation_id), materia or "", attivita or "")
            return {"success": True}
        except Exception as e:
            return {"error": str(e)}

    # ------------------------------------------------------------------
    # MATERIALI CARICATI (lista per la Biblioteca)
    # ------------------------------------------------------------------
    def materials_list(self):
        try:
            out = []
            for row in self.db.list_indexed_files():
                p = Path(row["percorso_file"])
                out.append({
                    "path": row["percorso_file"],
                    "name": p.name,
                    "indexed_at": row["data_ultima_indicizzazione"],
                })
            return out
        except Exception as e:
            print(f"[StudyAPI] materials_list error: {e}")
            return []

    # ------------------------------------------------------------------
    # LETTURA TESTO MATERIALE (API per il viewer "Fonti" — C2-backend)
    # Il frontend la chiamerà in un secondo momento; qui resta solo l'API.
    # ------------------------------------------------------------------
    MAX_MATERIAL_TEXT_BYTES = 5 * 1024 * 1024  # cap di lettura (5 MB)
    _TEXT_SUFFIXES = {".md", ".markdown", ".txt", ".json", ".csv", ".html", ".htm"}

    def _material_roots(self) -> list:
        """Radici ammesse per la lettura: file_AIstudio/ (note L1) e
        preselected_books/ (libri L2), con fallback se gli attributi
        non sono ancora stati inizializzati (test / chiamata precoce)."""
        roots = []
        rag_folder = getattr(self, "rag_folder", None)
        if rag_folder:
            roots.append(Path(rag_folder))
        else:
            roots.append(Path(__file__).resolve().parent.parent / "file_AIstudio")
        books_manager = getattr(self, "books_manager", None)
        if books_manager is not None:
            roots.append(Path(books_manager.get_books_folder_path()))
        else:
            roots.append(get_app_data_dir() / "preselected_books")
        return roots

    @staticmethod
    def _path_is_under(path: str, root: Path) -> bool:
        """True se `path` (risolto) sta sotto `root`. Case-insensitive su
        Windows (normcase) e immune a .. e separatori misti (realpath)."""
        try:
            rp = os.path.normcase(os.path.realpath(str(path)))
            rr = os.path.normcase(os.path.realpath(str(root)))
            return rp == rr or rp.startswith(rr.rstrip("\\/") + os.sep)
        except (OSError, ValueError):
            return False

    def read_material_text(self, path: str):
        """Legge il testo di un materiale RAG per il viewer "Fonti".

        Sicurezza: il path deve risolversi SOLO sotto una delle radici
        ammesse (file_AIstudio/ o preselected_books/). Sono leggibili sia
        rag_stage2/ sia originals/ sia la radice (viewer L1/L2), ma nessun
        file fuori da quelle cartelle (niente lettura arbitraria).
        Ritorna {success, name, text, kind, size, mtime}.
        """
        try:
            if not path:
                return {"success": False, "error": "Percorso mancante"}
            p = Path(path)
            if not any(self._path_is_under(str(p), root) for root in self._material_roots()):
                return {"success": False, "error": "Percorso non consentito"}
            if not p.is_file():
                return {"success": False, "error": "File non trovato"}

            st = p.stat()
            suffix = p.suffix.lower()
            text = ""
            if st.st_size > 0:
                with open(p, "rb") as f:
                    data = f.read(self.MAX_MATERIAL_TEXT_BYTES)
                if suffix in self._TEXT_SUFFIXES or not suffix:
                    # Testo: utf-8 con ripiego (il contenuto mostrato al
                    # frontend resta sempre una stringa JS valida).
                    text = data.decode("utf-8", errors="replace")
                else:
                    try:
                        text = data.decode("utf-8")
                    except UnicodeDecodeError:
                        text = ""  # binario (pdf/immagini): nessun testo leggibile
            return {
                "success": True,
                "name": p.name,
                "text": text,
                "kind": suffix.lstrip(".") or "file",
                "size": st.st_size,
                "mtime": st.st_mtime,
            }
        except Exception as e:
            print(f"[StudyAPI] read_material_text error: {e}")
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # VIEWER REALE PER IL PANNELLO FONTI (R28) - "come se fosse aperto,
    # ma solo li dentro". Ritorna un codice viewer + i dati strutturati:
    #   image | pdf | video | audio | doc | slides | sheet | html |
    #   text  | file
    # Stesse radici (e stessa sicurezza) di read_material_text.
    # ------------------------------------------------------------------
    _IMG_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"}
    _VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"}
    _AUDIO_SUFFIXES = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}
    _MAX_PREVIEW_TEXT = 400 * 1024        # 400 KB di testo per la preview
    _MAX_PREVIEW_SLIDES = 80              # slide esaminate nei .pptx
    _MAX_PREVIEW_SHEETS = 4               # fogli esposti nei .xlsx
    _MAX_PREVIEW_ROWS = 80                # righe per foglio esposte
    _MAX_PREVIEW_COLS = 26                # colonne (A..Z) esposte
    _MAX_PREVIEW_BLOCKS = 4000            # paragrafi .docx esposti

    def read_material_preview(self, path: str):
        """Anteprima REALE di un file materiale per il pannello Fonti.

        Il frontend puo' quindi rendere il file "aperto" dentro la
        preview: PDF nel viewer nativo del browser, .docx come documento
        impaginato, .pptx come slide, .xlsx come tabella, immagini/video/
        audio con i controlli nativi, testo/html come testo formattato.
        """
        try:
            if not path:
                return {"success": False, "error": "Percorso mancante"}
            p = Path(path)
            if not any(self._path_is_under(str(p), root) for root in self._material_roots()):
                return {"success": False, "error": "Percorso non consentito"}
            if not p.is_file():
                return {"success": False, "error": "File non trovato"}

            st = p.stat()
            suffix = p.suffix.lower()
            base = {
                "success": True,
                "path": str(p),
                "name": p.name,
                "suffix": suffix.lstrip("."),
                "size": st.st_size,
                "mtime": st.st_mtime,
            }

            # --- media: il browser li apre direttamente (controlli nativi)
            if suffix in self._IMG_SUFFIXES:
                return dict(base, viewer="image")
            if suffix in self._VIDEO_SUFFIXES:
                return dict(base, viewer="video")
            if suffix in self._AUDIO_SUFFIXES:
                return dict(base, viewer="audio")

            # --- PDF: iframe nel viewer PDF nativo + testo di riserva
            if suffix == ".pdf":
                out = dict(base, viewer="pdf", text="")
                try:
                    try:
                        import pymupdf as fitz  # PyMuPDF (gia' nelle dipendenze)
                    except ImportError:       # compat: vecchio alias fitz
                        import fitz
                    doc = fitz.open(str(p))
                    parts = []
                    total = 0
                    for i, page in enumerate(doc):
                        if i >= 80 or total > self._MAX_PREVIEW_TEXT:
                            break
                        t = page.get_text() or ""
                        total += len(t)
                        parts.append(t)
                    doc.close()
                    out["text"] = "\n\n".join(parts)[: self._MAX_PREVIEW_TEXT]
                except Exception:
                    out["text"] = ""
                return out

            # --- Word: blocchi strutturati (titoli, paragrafi, tabelle)
            if suffix == ".docx":
                blocks = []
                try:
                    from docx import Document
                    wdoc = Document(str(p))
                    for para in wdoc.paragraphs[: self._MAX_PREVIEW_BLOCKS]:
                        t = (para.text or "").strip()
                        if not t:
                            continue
                        style = ""
                        try:
                            style = str(para.style.name or "").lower()
                        except Exception:
                            style = ""
                        lvl = 0
                        if "heading" in style or "titolo" in style or "title" in style:
                            tail = style[-1]
                            lvl = int(tail) if tail.isdigit() else 1
                        blocks.append({"k": "h" if lvl in (1, 2, 3) else "p",
                                       "l": lvl, "t": t[:6000]})
                    for table in wdoc.tables[:40]:
                        for row in table.rows[:200]:
                            cells = [str(c.text or "").strip()[:500] for c in row.cells]
                            if any(cells):
                                blocks.append({"k": "tr", "cells": cells})
                    if not blocks:
                        blk = self._read_text_file(p, suffix)
                        if blk:
                            blocks.append({"k": "p", "l": 0, "t": blk[: self._MAX_PREVIEW_TEXT]})
                except Exception as e:
                    return dict(base, viewer="file", error=f"Word illeggibile: {e}")
                return dict(base, viewer="doc", blocks=blocks[: self._MAX_PREVIEW_BLOCKS])

            # --- PowerPoint: slide con titolo + righe + note relatore
            if suffix in (".pptx", ".ppt"):
                slides = []
                total = 0
                try:
                    from pptx import Presentation
                    prs = Presentation(str(p))
                    total = len(prs.slides)
                    for idx, slide in enumerate(prs.slides):
                        if len(slides) >= self._MAX_PREVIEW_SLIDES:
                            break
                        title, lines, notes = "", [], ""
                        try:
                            ttl = slide.shapes.title
                            if ttl is not None:
                                title = (ttl.text or "").strip()
                        except Exception:
                            title = ""
                        for shape in slide.shapes:
                            try:
                                if not (shape.has_text_frame):
                                    continue
                                txt = (shape.text_frame.text or "").strip()
                                if not txt:
                                    continue
                                if title and txt == title:
                                    continue
                                for ln in txt.splitlines():
                                    ln = ln.strip()
                                    if ln:
                                        lines.append(ln[:500])
                            except Exception:
                                continue
                        try:
                            if slide.has_notes_slide:
                                notes = (slide.notes_slide.notes_text_frame.text or "").strip()
                        except Exception:
                            notes = ""
                        slides.append({
                            "i": idx + 1, "title": title[:500],
                            "lines": lines[:80], "notes": notes[:2000],
                        })
                except Exception as e:
                    return dict(base, viewer="file", error=f"PowerPoint illeggibile: {e}")
                return dict(base, viewer="slides", slides=slides, count=total)

            # --- Excel: celle come tabella (prime righe/fogli)
            if suffix in (".xlsx", ".xlsm", ".xls"):
                sheets = []
                try:
                    import openpyxl
                    wb = openpyxl.load_workbook(str(p), data_only=True, read_only=True)
                    for ws in wb.worksheets[: self._MAX_PREVIEW_SHEETS]:
                        rows = []
                        for row in ws.iter_rows(
                            min_row=1, max_row=self._MAX_PREVIEW_ROWS,
                            max_col=self._MAX_PREVIEW_COLS, values_only=True,
                        ):
                            rows.append(["" if v is None else str(v)[:200] for v in row])
                        sheets.append({"name": str(ws.title), "rows": rows})
                    wb.close()
                except Exception as e:
                    return dict(base, viewer="file", error=f"Excel illeggibile: {e}")
                return dict(base, viewer="sheet", sheets=sheets)

            # --- testo / html (stessa lettura di read_material_text)
            text = self._read_text_file(p, suffix)
            if suffix in (".html", ".htm"):
                return dict(base, viewer="html", html=text)
            if text or suffix in self._TEXT_SUFFIXES or not suffix:
                return dict(base, viewer="text", text=text[: self._MAX_PREVIEW_TEXT],
                            kind=suffix.lstrip(".") or "file")
            # binario sconosciuto: nome + dimensione + apri file
            return dict(base, viewer="file")
        except Exception as e:
            print(f"[StudyAPI] read_material_preview error: {e}")
            return {"success": False, "error": str(e)}

    def _read_text_file(self, p: Path, suffix: str) -> str:
        """Lettura testo con cap (utf-8 con ripiego su binary)."""
        try:
            if not p.is_file() or p.stat().st_size <= 0:
                return ""
            with open(p, "rb") as f:
                data = f.read(self.MAX_MATERIAL_TEXT_BYTES)
            if suffix in self._TEXT_SUFFIXES or not suffix:
                return data.decode("utf-8", errors="replace")
            try:
                return data.decode("utf-8")
            except UnicodeDecodeError:
                return ""
        except Exception:
            return ""

    # ------------------------------------------------------------------
    # ASSET LOCALI (immagini/video/audio importati nei progetti)
    # ------------------------------------------------------------------
    def study_pick_asset(self):
        """Apre un dialogo file, copia il file in %APPDATA%/NovaStudio/assets/
        e ne restituisce il percorso assoluto. Il file resta sul PC."""
        w = self._active_window()
        if not w:
            return None
        try:
            r = w.create_file_dialog(webview.FileDialog.OPEN, file_types=ASSET_FILE_TYPES)
        except Exception:
            try:
                r = w.create_file_dialog(webview.FileDialog.OPEN)
            except Exception:
                return None
        if not r:
            return None
        src = Path(r[0])
        try:
            assets_dir = get_app_data_dir() / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)
            dst = assets_dir / f"{uuid.uuid4().hex}{src.suffix.lower()}"
            shutil.copy2(src, dst)
            return {"path": str(dst), "name": src.name}
        except Exception as e:
            print(f"[StudyAPI] study_pick_asset error: {e}")
            return None

    @staticmethod
    def asset_url(path: str) -> str:
        """Converte un percorso assoluto in un URL file:// utilizzabile nella webview."""
        if not path:
            return ""
        p = Path(path)
        return p.as_uri()
