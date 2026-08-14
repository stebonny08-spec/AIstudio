"""
Server HTTP per la comunicazione tra Tauri e Python
Permette al frontend Tauri di chiamare le API Python via HTTP
"""

import sys
import json
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

# Aggiungi il percorso al path
sys.path.insert(0, str(Path(__file__).parent))

from backend.api import get_api, StudioIAAPI


class StudioIAHandler(BaseHTTPRequestHandler):
    """Gestore delle richieste HTTP per le API"""
    
    api: StudioIAAPI = None
    
    def _set_headers(self, status_code=200):
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_OPTIONS(self):
        self._set_headers(200)
    
    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        query = parse_qs(parsed_path.query)
        
        try:
            if path == '/api/settings':
                result = self.api.get_settings()
            elif path == '/api/books':
                result = self.api.get_database_books()
            elif path == '/api/system':
                result = self.api.get_system_info()
            else:
                result = {'error': 'Endpoint non trovato'}
            
            self._set_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(body) if body else {}
            
            if path == '/api/convert':
                result = self.api.convert_file(
                    data.get('file_path', ''),
                    data.get('file_type', 'pdf')
                )
            elif path == '/api/vectorize':
                result = self.api.vectorize_md_file(
                    data.get('md_file_path', ''),
                    data.get('destination', 'user')
                )
            elif path == '/api/process_image':
                result = self.api.process_image(
                    data.get('image_path', ''),
                    data.get('book_name', ''),
                    data.get('page_num', 0)
                )
            elif path == '/api/chat':
                result = self.api.chat_with_rag(
                    data.get('message', ''),
                    data.get('conversation_id')
                )
            elif path == '/api/upload_book':
                result = self.api.upload_book_to_database(
                    data.get('md_file_path', ''),
                    data.get('book_title', ''),
                    data.get('author', '')
                )
            elif path == '/api/load_model':
                result = self.api.load_model(
                    data.get('model_path', ''),
                    data.get('model_type', 'text')
                )
            elif path == '/api/settings':
                result = self.api.save_settings(data)
            else:
                result = {'error': 'Endpoint non trovato'}
            
            self._set_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self._set_headers(500)
            self.wfile.write(json.dumps({'error': str(e)}).encode())
    
    def log_message(self, format, *args):
        # Silenzia i log
        pass


def run_server(port=8765):
    """Avvia il server HTTP"""
    api = get_api()
    StudioIAHandler.api = api
    
    server = HTTPServer(('127.0.0.1', port), StudioIAHandler)
    print(f"Server API avviato su http://127.0.0.1:{port}")
    
    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()
    
    return server


if __name__ == '__main__':
    server = run_server()
    print("Premi Ctrl+C per fermare il server")
    try:
        while True:
            pass
    except KeyboardInterrupt:
        print("\nFermo il server...")
        server.shutdown()
