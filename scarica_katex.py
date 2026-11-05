"""
scarica_katex.py
----------------
Scarica i file necessari di KaTeX (JS, CSS, fonts) dal CDN jsDelivr
e li mette in web_frontend/html/vendor/katex/.

Esegui una volta sola. Poi puoi anche cancellare questo script.
"""

import urllib.request
from pathlib import Path

VERSION = "0.16.11"
BASE = f"https://cdn.jsdelivr.net/npm/katex@{VERSION}/dist"

DEST = Path("web_frontend/html/vendor/katex")
FONTS_DEST = DEST / "fonts"

# File principali
files = {
    "katex.min.js": f"{BASE}/katex.min.js",
    "katex.min.css": f"{BASE}/katex.min.css",
}

# Font (tutti i .woff2 necessari)
font_names = [
    "KaTeX_AMS-Regular.woff2",
    "KaTeX_Caligraphic-Bold.woff2",
    "KaTeX_Caligraphic-Regular.woff2",
    "KaTeX_Fraktur-Bold.woff2",
    "KaTeX_Fraktur-Regular.woff2",
    "KaTeX_Main-Bold.woff2",
    "KaTeX_Main-BoldItalic.woff2",
    "KaTeX_Main-Italic.woff2",
    "KaTeX_Main-Regular.woff2",
    "KaTeX_Math-BoldItalic.woff2",
    "KaTeX_Math-Italic.woff2",
    "KaTeX_SansSerif-Bold.woff2",
    "KaTeX_SansSerif-Italic.woff2",
    "KaTeX_SansSerif-Regular.woff2",
    "KaTeX_Script-Regular.woff2",
    "KaTeX_Size1-Regular.woff2",
    "KaTeX_Size2-Regular.woff2",
    "KaTeX_Size3-Regular.woff2",
    "KaTeX_Size4-Regular.woff2",
    "KaTeX_Typewriter-Regular.woff2",
]

DEST.mkdir(parents=True, exist_ok=True)
FONTS_DEST.mkdir(parents=True, exist_ok=True)


def download(url: str, dest: Path) -> None:
    print(f"  {dest.name}...", end=" ", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read()
        dest.write_bytes(data)
        print(f"OK ({len(data) // 1024} KB)")
    except Exception as e:
        print(f"ERRORE: {e}")


print(f"Scarico KaTeX {VERSION} in {DEST}...")
print()

print("File principali:")
for name, url in files.items():
    download(url, DEST / name)

print()
print(f"Font ({len(font_names)}):")
for name in font_names:
    download(f"{BASE}/fonts/{name}", FONTS_DEST / name)

print()
print("Verifica:")
print(f"  katex.min.js:  {'OK' if (DEST / 'katex.min.js').exists() else 'MANCANTE'}")
print(f"  katex.min.css: {'OK' if (DEST / 'katex.min.css').exists() else 'MANCANTE'}")
n_fonts = len(list(FONTS_DEST.glob('*.woff2')))
print(f"  fonts/:        {n_fonts} file")
print()
print("Fatto.")