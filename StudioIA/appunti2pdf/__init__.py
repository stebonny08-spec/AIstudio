"""
appunti2pdf/__init__.py
------------------------
Modulo per la conversione di appunti (immagini) in PDF usando OpenCV e OCR locale.
Integrato direttamente nell'app StudioIA senza dipendenze esterne.
"""

from .converter import AppuntiToPDFConverter

__all__ = ["AppuntiToPDFConverter"]
