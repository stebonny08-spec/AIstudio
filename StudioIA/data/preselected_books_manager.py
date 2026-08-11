"""
data/preselected_books_manager.py
----------------------------------
Gestisce i libri e documenti pre-selezionati (livello 2 del RAG).
Questi sono materiali didattici gratuiti selezionati dagli sviluppatori
e inclusi nell'applicazione nella cartella data/preselected_books/.
"""

import os
from pathlib import Path
from typing import List, Optional

from core.parsers import is_supported
from data.config_manager import get_app_data_dir


class PreselectedBooksManager:
    """Gestisce l'accesso ai libri pre-selezionati nel livello 2 del RAG."""
    
    def __init__(self):
        self.books_dir = get_app_data_dir() / "preselected_books"
        self.books_dir.mkdir(parents=True, exist_ok=True)
    
    def get_books_folder_path(self) -> str:
        """Restituisce il percorso della cartella dei libri pre-selezionati."""
        return str(self.books_dir)
    
    def has_books(self) -> bool:
        """Controlla se ci sono libri nella cartella pre-selezionata."""
        if not self.books_dir.exists():
            return False
        
        for root, _dirs, files in os.walk(self.books_dir):
            for filename in files:
                full_path = os.path.join(root, filename)
                if is_supported(full_path):
                    return True
        return False
    
    def get_book_count(self) -> int:
        """Conta quanti file supportati ci sono nella cartella."""
        count = 0
        if not self.books_dir.exists():
            return 0
        
        for root, _dirs, files in os.walk(self.books_dir):
            for filename in files:
                full_path = os.path.join(root, filename)
                if is_supported(full_path):
                    count += 1
        return count
