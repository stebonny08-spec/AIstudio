"""
tests/testR28_preview.py - R28: viewer REALE per il pannello Fonti.

read_material_preview(path) deve restituire il codice viewer giusto per
ogni formato (image/pdf/video/audio/doc/slides/sheet/html/text/file) con le
radici di sicurezza IDENTICHE a read_material_text (nessuna lettura fuori
dalle radici ammesse).

Esecuzione: python -m pytest tests/testR28_preview.py -q
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.study_api import StudyAPI  # noqa: E402


@pytest.fixture()
def api(tmp_path, monkeypatch):
    """StudioAPI senza backend: radici di lettura = tmp_path del test."""
    a = StudyAPI()
    monkeypatch.setattr(a, "_material_roots", lambda: [tmp_path])
    return a, tmp_path


def _write_text(p: Path, text: str, enc="utf-8"):
    p.write_bytes(text.encode(enc))
    return str(p)


def test_text_md(api):
    a, root = api
    p = _write_text(root / "nota.md", "# Titolo MD\n\ncontenuto **negrita**")
    r = a.read_material_preview(p)
    assert r["success"] is True
    assert r["viewer"] == "text"
    assert "Titolo MD" in r["text"]


def test_html(api):
    a, root = api
    p = _write_text(root / "pagina.html", "<h1>Ciao</h1><p>testo</p>")
    r = a.read_material_preview(p)
    assert r["viewer"] == "html"
    assert "<h1>" in r["html"]


def test_image(api):
    a, root = api
    p = root / "figura.png"
    p.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    r = a.read_material_preview(str(p))
    assert r["viewer"] == "image"
    assert r["path"] == str(p)


def test_video_and_audio(api):
    a, root = api
    v = root / "lezione.mp4"
    v.write_bytes(b"\x00\x00\x00\x18ftypmp42fake")
    assert a.read_material_preview(str(v))["viewer"] == "video"
    s = root / "podcast.mp3"
    s.write_bytes(b"ID3fake")
    assert a.read_material_preview(str(s))["viewer"] == "audio"


def test_pdf_con_testo_di_riserva(api):
    pymupdf = pytest.importorskip("pymupdf", reason="PyMuPDF assente")
    a, root = api
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "TESTO PDF R28")
    out = root / "libro.pdf"
    doc.save(str(out))
    doc.close()
    r = a.read_material_preview(str(out))
    assert r["viewer"] == "pdf"
    assert "TESTO PDF R28" in r["text"]
    assert r["path"] == str(out)


def test_docx_blocchi_strutturati(api):
    docx = pytest.importorskip("docx", reason="python-docx assente")
    a, root = api
    d = docx.Document()
    d.add_heading("Titolo Word", level=1)
    d.add_paragraph("Paragrafo Word")
    out = root / "documento.docx"
    d.save(str(out))
    r = a.read_material_preview(str(out))
    assert r["viewer"] == "doc"
    ks = [b["k"] for b in r["blocks"]]
    assert "h" in ks and "p" in ks
    texts = [b.get("t", "") for b in r["blocks"]]
    assert "Titolo Word" in texts and "Paragrafo Word" in texts


def test_pptx_slide(api):
    pptx = pytest.importorskip("pptx", reason="python-pptx assente")
    a, root = api
    prs = pptx.Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "Slide Titolo"
    out = root / "presentazione.pptx"
    prs.save(str(out))
    r = a.read_material_preview(str(out))
    assert r["viewer"] == "slides"
    assert r["count"] == 1
    assert r["slides"][0]["title"] == "Slide Titolo"


def test_xlsx_tabella(api):
    openpyxl = pytest.importorskip("openpyxl", reason="openpyxl assente")
    a, root = api
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Dati"
    ws["A1"] = "Intestazione"
    ws["B2"] = 42
    out = root / "foglio.xlsx"
    wb.save(str(out))
    r = a.read_material_preview(str(out))
    assert r["viewer"] == "sheet"
    assert r["sheets"][0]["name"] == "Dati"
    rows = r["sheets"][0]["rows"]
    assert rows[0][0] == "Intestazione"
    assert rows[1][1] == "42"


def test_binario_sconosciuto_viewer_file(api):
    a, root = api
    p = root / "dati.zip"
    p.write_bytes(b"PK\x03\x04fake")
    r = a.read_material_preview(str(p))
    assert r["success"] is True
    assert r["viewer"] in ("text", "file")   # utf-8 forzato -> text con ""
    assert r["name"] == "dati.zip"


def test_sicurezza_fuori_dalle_radici(api, tmp_path):
    a, _ = api
    # file ESISTENTE ma fuori dalle radici ammesse
    outside = Path(sys.executable)  # python.exe: esistente, fuori radici
    if not outside.is_file():
        pytest.skip("interprete non trovato")
    r = a.read_material_preview(str(outside))
    assert r["success"] is False
    assert "consentito" in r.get("error", "")


def test_percorso_mancante(api):
    a, _ = api
    assert a.read_material_preview("")["success"] is False
    assert a.read_material_preview(None)["success"] is False
