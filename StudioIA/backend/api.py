"""
StudioIA - Backend API per pywebview
Gestisce la comunicazione tra frontend web e logica Python
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime

# Aggiungi il percorso corrente al path di sistema
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.local_llm_client import LocalLLMClient
from core.local_search import LocalSearchEngine
from core.markdown_converter import MarkdownConverter
from core.router import Router
from core.rag.vector_store import VectorStore
from data.db import Database
from data.config_manager import ConfigManager, get_app_data_dir


class StudioIAAPI:
    """API per la comunicazione tra frontend e backend"""
    
    def __init__(self):
        self.base_dir = Path(__file__).parent.parent
        self.db = Database()
        self.config = ConfigManager()
        self.llm_client = None
        self.rag_router = None
        self.vector_store = None
        self.local_search = None
        self.converter = None
        self.current_conversation_id = None
        
        # Inizializza i componenti
        self._initialize_components()
    
    def _initialize_components(self):
        """Inizializza LLM e RAG router"""
        try:
            config = self.config.get_config()
            
            # Inizializza client LLM locale
            if config.get('local_model_path'):
                self.llm_client = LocalLLMClient(
                    model_path=config['local_model_path'],
                    n_ctx=config.get('local_model_n_ctx', 4096)
                )

            self.vector_store = VectorStore(str(get_app_data_dir() / "vector_index"))
            self.local_search = LocalSearchEngine(self.db, self.vector_store)
            self.rag_router = Router(
                local_client_provider=self._get_llm_client,
                local_search=self.local_search,
                rag_top_k=config.get('rag_top_k', 5),
            )
            
        except Exception as e:
            print(f"Errore durante l'inizializzazione: {e}")
    
    def get_conversations(self):
        """Ottiene la lista delle conversazioni"""
        try:
            conversations = self.db.get_conversations(limit=50)
            result = []
            for conv in conversations:
                result.append({
                    'id': conv[0],
                    'title': conv[1],
                    'date': self._format_date(conv[3])
                })
            return result
        except Exception as e:
            print(f"Errore nel caricamento conversazioni: {e}")
            return []
    
    def get_messages(self, conversation_id):
        """Ottiene i messaggi di una conversazione"""
        try:
            messages = self.db.get_messages(conversation_id)
            result = []
            for msg in messages:
                result.append({
                    'id': msg[0],
                    'content': msg[3],
                    'role': msg[2],
                    'timestamp': msg[5]
                })
            return result
        except Exception as e:
            print(f"Errore nel caricamento messaggi: {e}")
            return []
    
    def send_message(self, message, conversation_id=None):
        """Invia un messaggio e ottiene la risposta dall'AI"""
        try:
            # Crea o usa conversazione esistente
            if not conversation_id:
                title = message[:50] + "..." if len(message) > 50 else message
                conversation_id = self.db.create_conversation(title)
            
            self.current_conversation_id = conversation_id
            
            # Salva messaggio utente
            self.db.add_message(conversation_id, 'user', message)
            
            # Genera risposta con RAG e LLM
            response = self._generate_response(message)
            
            # Salva risposta AI
            self.db.add_message(conversation_id, 'assistant', response)
            
            return response
            
        except Exception as e:
            print(f"Errore nell'invio messaggio: {e}")
            return "Mi scuso, ma ho riscontrato un errore. Per favore riprova."
    
    def _get_llm_client(self):
        return self.llm_client

    def _generate_response(self, query):
        """Genera una risposta usando RAG e LLM locale"""
        try:
            if not self.llm_client:
                return "Il modello LLM non è stato configurato. Per favore seleziona un modello nelle impostazioni."
            
            if self.rag_router:
                answer = self.rag_router.process_query(query, ambiente="chat", mode="automatica")
                response = answer.text if hasattr(answer, 'text') else str(answer)
            else:
                response = self.llm_client.generate(query, ambiente="chat", context_kind="none")
            
            return response
            
        except Exception as e:
            print(f"Errore nella generazione risposta: {e}")
            return "Ho avuto un problema nell'elaborare la tua richiesta. Riprova."
    
    def convert_file(self, file_info, file_type):
        """Converte un file in Markdown"""
        try:
            # Estrai informazioni dal file
            file_path = file_info if isinstance(file_info, str) else file_info.get('path')
            file_name = file_info if isinstance(file_info, str) else file_info.get('name', 'unknown')
            
            if not file_path or not os.path.exists(file_path):
                raise Exception("File non trovato")
            
            # Determina il tipo effettivo
            actual_type = file_type
            if file_type == 'auto':
                ext = Path(file_path).suffix.lower()
                if ext in ['.jpg', '.jpeg', '.png', '.heic', '.webp']:
                    actual_type = 'image'
                elif ext == '.pdf':
                    actual_type = 'pdf'
                elif ext in ['.doc', '.docx']:
                    actual_type = 'word'
            
            # Converti in Markdown
            if self.converter is None:
                try:
                    self.converter = MarkdownConverter()
                except Exception as e:
                    return {
                        'success': False,
                        'error': f'Markdown converter non disponibile: {e}'
                    }

            output_dir = self.base_dir / 'file_AIstudio'
            output_dir.mkdir(exist_ok=True)
            output_path = str(output_dir / (Path(file_path).stem + '.md'))
            
            if actual_type == 'image':
                self.converter.convert_image_to_markdown(str(file_path), output_path)
            elif actual_type == 'pdf':
                self.converter.convert_pdf_to_markdown(str(file_path), output_path)
            elif actual_type == 'word':
                self.converter.convert_docx_to_markdown(str(file_path), output_path)
            else:
                raise ValueError(f"Formato non supportato: {actual_type}")
            
            # Aggiorna indice RAG
            if self.local_search:
                self.local_search.ensure_index_updated(str(output_dir), ocr_enabled=True)
            
            return {
                'success': True,
                'path': str(output_path),
                'message': 'Conversione completata con successo'
            }
            
        except Exception as e:
            print(f"Errore nella conversione: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _format_date(self, date_str):
        """Formatta la data in modo leggibile"""
        try:
            dt = datetime.fromisoformat(date_str)
            now = datetime.now()
            diff = now - dt
            
            if diff.days == 0:
                return 'Oggi'
            elif diff.days == 1:
                return 'Ieri'
            elif diff.days < 7:
                return f"{diff.days} giorni fa"
            else:
                return dt.strftime('%d/%m/%Y')
        except:
            return date_str
    
    def load_model(self, model_path):
        """Carica un modello LLM"""
        try:
            self.llm_client = LocalLLMClient(model_path=model_path)
            self.config.update_config({'local_model_path': model_path})
            return {'success': True, 'message': 'Modello caricato con successo'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_settings(self):
        """Ottiene le impostazioni correnti"""
        return self.config.get_config()
    
    def save_settings(self, settings):
        """Salva le impostazioni"""
        try:
            self.config.update_config(settings)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}


# Funzione factory per creare l'istanza API
def create_api():
    """Crea e restituisce l'istanza dell'API"""
    return StudioIAAPI()
