# -*- mode: python ; coding: utf-8 -*-
"""
NovaStudio.spec — versione per la DISTRIBUZIONE
"""

import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

PROJECT_ROOT = Path(os.path.abspath(SPECPATH))

# ------------------------------------------------------------------
# DATI
# ------------------------------------------------------------------
datas = [
    (str(PROJECT_ROOT / "web_frontend"), "web_frontend"),
    (str(PROJECT_ROOT / "file_AIstudio"), "file_AIstudio"),
    (str(PROJECT_ROOT / "data" / "schema.sql"), "data"),
    (str(PROJECT_ROOT / "tesseract"), "tesseract"),
]

binaries = []
hiddenimports = []

# ------------------------------------------------------------------
# COLLECT_ALL
# ------------------------------------------------------------------
_packages_to_collect = [
    "llama_cpp",            # ← AGGIUNTO: include la cartella lib/ con llama.dll
    "webview",
    "clr",
    "chromadb",
    "sentence_transformers",
    "transformers",
    "huggingface_hub",
    "sklearn",
    "ddgs",
    "pdfplumber",
    "pdfminer",
    "docx",
    "pptx",
    "openpyxl",
    "PIL",
    "cv2",
    "pytesseract",
]

for _pkg in _packages_to_collect:
    try:
        d, b, h = collect_all(_pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:
        print(f"[spec] collect_all fallita per '{_pkg}': {e}")

# ------------------------------------------------------------------
# HIDDEN IMPORTS AGGIUNTIVI
# ------------------------------------------------------------------
hiddenimports += [
    "webview",
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "webview.platforms.mshtml",
    "transformers.models.bert",
    "transformers.models.auto",
    "transformers.tokenization_utils",
    "transformers.tokenization_utils_fast",
    "sklearn.utils._typedefs",
    "sklearn.neighbors._partition_nodes",
    "sqlite3", "uuid", "json",
]

# ------------------------------------------------------------------
# ESCLUSIONI
# ------------------------------------------------------------------
excludes = [
    "tkinter", "matplotlib", "PyQt5", "PyQt6", "PySide2", "PySide6",
    "wx", "IPython", "jupyter", "notebook", "pytest", "nose",
    "webview.platforms.gtk", "webview.platforms.qt",
    "webview.platforms.cocoa", "webview.platforms.android",
    "tensorflow", "tensorboard",
]

# ------------------------------------------------------------------
# BUILD
# ------------------------------------------------------------------
block_cipher = None

a = Analysis(
    ["main.py"],
    pathex=[str(PROJECT_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NovaStudio",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(PROJECT_ROOT / "assets" / "icon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="NovaStudio",
)