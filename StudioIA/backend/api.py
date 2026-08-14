"""
StudioIA - Backend API per Tauri
Gestisce la comunicazione tra frontend Tauri e logica Python
"""

import os
import sys
import json
import base64
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List

# Aggiungi il percorso corrente al path di sistema
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.markdown_converter import MarkdownConverter
from core.local_llm_client import LocalLLMClient
from core.qwen_vl_client import QwenVLClient
from core.rag.vector_store import VectorStore
from core.rag.indexer import RAGIndexer
from core.rag.embedder import Embedder
from core.rag.chunker import Chunker
from core.ocr_processor import OCRProcessor
from data.config_manager import ConfigManager


class StudioIAAPI:
    """API per la comunicazione tra frontend Tauri e backend Python"""
    
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent
        self.config = ConfigManager()
        
        # Componenti inizializzati lazy
        self._llm_client = None
        self._vision_client = None
        self._embedder = None
        self._chunker = None
        self._vector_store_user = None
        self._vector_store_db = None
        self._indexer = None
        self._converter = None
        self._ocr_processor = None
        
        # Cartelle
        self.user_files_dir = self.base_dir / 'user_files'
        self.data_base_dir = self.base_dir / 'data_base'
        
        # Assicurati che le cartelle esistano
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Assicura che le cartelle esistano"""
        self.user_files_dir.mkdir(parents=True, exist_ok=True)
        self.data_base_dir.mkdir(parents=True, exist_ok=True)
        (self.user_files_dir / 'vectors').mkdir(exist_ok=True)
        (self.data_base_dir / 'vectors').mkdir(exist_ok=True)
        (self.user_files_dir / 'images').mkdir(exist_ok=True)
        (self.data_base_dir / 'images').mkdir(exist_ok=True)
    
    @property
    def llm_client(self):
        """Lazy initialization del client LLM testuale"""
        if self._llm_client is None:
            config = self.config.get_config()
            model_path = config.get('local_model_path')
            if model_path and os.path.exists(model_path):
                self._llm_client = LocalLLMClient(
                    model_path=model_path,
                    n_ctx=config.get('context_size', 4096)
                )
        return self._llm_client
    
    @property
    def vision_client(self):
        """Lazy initialization del client Vision"""
        if self._vision_client is None:
            config = self.config.get_config()
            vision_model_path = config.get('vision_model_path')
            if vision_model_path and os.path.exists(vision_model_path):
                self._vision_client = QwenVLClient(model_path=vision_model_path)
        return self._vision_client
    
    @property
    def embedder(self):
        """Lazy initialization dell'embedder"""
        if self._embedder is None:
            self._embedder = Embedder()
        return self._embedder
    
    @property
    def chunker(self):
        """Lazy initialization del chunker"""
        if self._chunker is None:
            self._chunker = Chunker(
                chunk_size=config.get('chunk_size', 500),
                overlap=config.get('chunk_overlap', 50)
            )
        return self._chunker
    
    @property
    def converter(self):
        """Lazy initialization del converter"""
        if self._converter is None:
            self._converter = MarkdownConverter()
        return self._converter
    
    @property
    def ocr_processor(self):
        """Lazy initialization dell'OCR processor"""
        if self._ocr_processor is None:
            self._ocr_processor = OCRProcessor()
        return self._ocr_processor
    
    def get_vector_store(self, store_type: str) -> VectorStore:
        """Ottiene lo storage vettoriale appropriato"""
        if store_type == 'user':
            if self._vector_store_user is None:
                self._vector_store_user = VectorStore(
                    index_dir=str(self.user_files_dir / 'vectors')
                )
            return self._vector_store_user
        else:  # database
            if self._vector_store_db is None:
                self._vector_store_db = VectorStore(
                    index_dir=str(self.data_base_dir / 'vectors')
                )
            return self._vector_store_db
    
    def convert_file(self, file_path: str, file_type: str) -> Dict[str, Any]:
        """Converte un file in Markdown"""
        try:
            file_path = Path(file_path)
            if not file_path.exists():
                return {'success': False, 'error': 'File non trovato'}
            
            output_dir = self.user_files_dir
            output_dir.mkdir(exist_ok=True)
            
            md_path = self.converter.convert(
                file_path=str(file_path),
                output_dir=str(output_dir),
                file_type=file_type
            )
            
            return {
                'success': True,
                'path': str(md_path),
                'message': 'Conversione completata'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def vectorize_md_file(self, md_file_path: str, destination: str) -> Dict[str, Any]:
        """Vettorizza un file Markdown e lo salva nella cartella specificata"""
        try:
            md_path = Path(md_file_path)
            if not md_path.exists():
                return {'success': False, 'error': 'File MD non trovato'}
            
            # Leggi il contenuto
            with open(md_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Chunking
            chunks = self.chunker.chunk(content)
            
            # Embedding e salvataggio
            vector_store = self.get_vector_store(destination)
            vectors = []
            
            for i, chunk in enumerate(chunks):
                embedding = self.embedder.embed(chunk)
                chunk_id = f"{md_path.stem}_{i}"
                
                vector_store.add(
                    id=chunk_id,
                    text=chunk,
                    embedding=embedding,
                    metadata={
                        'source': str(md_path),
                        'type': 'text',
                        'chunk_index': i
                    }
                )
                vectors.append(chunk_id)
            
            return {
                'success': True,
                'vectors_created': len(vectors),
                'destination': destination,
                'message': f'Creati {len(vectors)} vettori'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def process_image(self, image_path: str, book_name: str = '', page_num: int = 0) -> Dict[str, Any]:
        """Processa un'immagine con OCR, formule LaTeX e caption"""
        try:
            img_path = Path(image_path)
            if not img_path.exists():
                return {'success': False, 'error': 'Immagine non trovata'}
            
            # Processa con OCR
            ocr_result = self.ocr_processor.process_image(str(img_path))
            
            # Determina il tipo di immagine e genera caption
            caption = ''
            latex = None
            clip_id = None
            
            if ocr_result.get('is_formula', False):
                # È una formula
                latex = ocr_result.get('latex', '')
                caption = f"Formula matematica: {latex}"
            elif ocr_result.get('text_confidence', 0) > 0.7:
                # Abbastanza testo dall'OCR
                ocr_text = ocr_result.get('text', '')
                caption = f"Testo rilevato: {ocr_text}"
            else:
                # Usa il modello vision per descrizione ricca
                if self.vision_client:
                    caption = self.vision_client.describe_image(str(img_path))
                else:
                    caption = "Immagine senza descrizione disponibile"
            
            # Genera embedding per la caption
            embedding = self.embedder.embed(caption)
            
            # Salva metadati
            image_data = {
                'tipo': 'immagine',
                'percorso': f"images/{img_path.name}",
                'libro': book_name or img_path.parent.name,
                'pagina': page_num,
                'caption': caption,
                'testo_ocr': ocr_result.get('text', ''),
                'latex': latex,
                'clip_id': clip_id,
                'embedding': embedding
            }
            
            # Copia l'immagine nella cartella appropriata
            dest_dir = self.user_files_dir / 'images'
            dest_dir.mkdir(exist_ok=True)
            dest_path = dest_dir / img_path.name
            import shutil
            shutil.copy2(str(img_path), str(dest_path))
            
            # Salva metadati JSON
            metadata_path = dest_dir / f"{img_path.stem}.json"
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(image_data, f, ensure_ascii=False, indent=2)
            
            # Aggiungi al vector store
            vector_store = self.get_vector_store('user')
            vector_store.add(
                id=f"img_{img_path.stem}",
                text=caption,
                embedding=embedding,
                metadata=image_data
            )
            
            return {
                'success': True,
                'caption': caption,
                'ocr_text': ocr_result.get('text', ''),
                'latex': latex,
                'metadata_path': str(metadata_path)
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def chat_with_rag(self, message: str, conversation_id: Optional[str] = None) -> Dict[str, Any]:
        """Chat con supporto RAG da entrambe le cartelle"""
        try:
            # Cerca in entrambi i vector store
            user_results = []
            db_results = []
            
            try:
                user_store = self.get_vector_store('user')
                user_results = user_store.search(message, top_k=3)
            except:
                pass
            
            try:
                db_store = self.get_vector_store('database')
                db_results = db_store.search(message, top_k=3)
            except:
                pass
            
            # Combina i risultati
            all_results = user_results + db_results
            
            # Costruisci il contesto
            context_parts = []
            for result in all_results[:5]:  # Max 5 risultati
                if isinstance(result, dict):
                    context_parts.append(result.get('text', ''))
                else:
                    context_parts.append(str(result))
            
            context = '\n\n'.join(context_parts) if context_parts else 'Nessun contesto trovato.'
            
            # Genera risposta
            if self.llm_client:
                prompt = f"""Contesto dalle fonti:
{context}

Domanda dell'utente: {message}

Rispondi in modo chiaro e dettagliato in italiano."""
                
                response = self.llm_client.generate(prompt, max_tokens=1024)
            else:
                response = f"Contesto trovato:\n{context}\n\n[Modello LLM non configurato]"
            
            return {
                'success': True,
                'response': response,
                'conversation_id': conversation_id or datetime.now().isoformat(),
                'context_used': bool(context_parts)
            }
        except Exception as e:
            return {'success': False, 'error': str(e), 'response': 'Errore nella chat'}
    
    def get_database_books(self) -> List[Dict[str, Any]]:
        """Ottiene la lista dei libri nel database"""
        try:
            books = []
            vectors_dir = self.data_base_dir / 'vectors'
            
            if vectors_dir.exists():
                for vector_file in vectors_dir.glob('*.json'):
                    try:
                        with open(vector_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            books.append({
                                'name': vector_file.stem,
                                'path': str(vector_file),
                                'chunks': data.get('chunks_count', 0)
                            })
                    except:
                        pass
            
            return books
        except Exception as e:
            return []
    
    def upload_book_to_database(self, md_file_path: str, book_title: str, author: str) -> Dict[str, Any]:
        """Carica un libro vettorizzato nel database"""
        try:
            return self.vectorize_md_file(md_file_path, 'database')
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def load_model(self, model_path: str, model_type: str = 'text') -> Dict[str, Any]:
        """Carica un modello (testuale o vision)"""
        try:
            config_updates = {}
            
            if model_type == 'text':
                config_updates['local_model_path'] = model_path
                self._llm_client = None  # Reset per ricaricare
            elif model_type == 'vision':
                config_updates['vision_model_path'] = model_path
                self._vision_client = None  # Reset per ricaricare
            
            self.config.update_config(config_updates)
            
            return {'success': True, 'message': f'Modello {model_type} caricato'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_settings(self) -> Dict[str, Any]:
        """Ottiene le impostazioni correnti"""
        return self.config.get_config()
    
    def save_settings(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        """Salva le impostazioni"""
        try:
            self.config.update_config(settings)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_system_info(self) -> Dict[str, Any]:
        """Ottiene informazioni sul sistema"""
        import psutil
        
        ram = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        return {
            'ram_total': round(ram.total / (1024**3), 2),
            'ram_available': round(ram.available / (1024**3), 2),
            'disk_total': round(disk.total / (1024**3), 2),
            'disk_free': round(disk.free / (1024**3), 2),
            'user_files_count': len(list(self.user_files_dir.glob('**/*'))),
            'database_files_count': len(list(self.data_base_dir.glob('**/*')))
        }


# Istanza globale
_api_instance: Optional[StudioIAAPI] = None


def get_api() -> StudioIAAPI:
    """Ottiene l'istanza singleton dell'API"""
    global _api_instance
    if _api_instance is None:
        _api_instance = StudioIAAPI()
    return _api_instance
