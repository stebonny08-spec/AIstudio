#!/bin/bash

# Script per avviare StudioIA con frontend Tauri e backend Python

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BACKEND_DIR="$SCRIPT_DIR/StudioIA"
GUI_DIR="$SCRIPT_DIR/studio-ia-gui"
PYTHON_API_SERVER="$BACKEND_DIR/backend/api_server.py"

echo "🚀 Avvio di StudioIA..."

# Controlla se Python è installato
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 non trovato. Installa Python 3.8+ prima di continuare."
    exit 1
fi

# Controlla se Node.js è installato
if ! command -v node &> /dev/null; then
    echo "❌ Node.js non trovato. Installa Node.js 18+ prima di continuare."
    exit 1
fi

# Crea le cartelle necessarie
echo "📁 Creo le cartelle per user_files e data_base..."
mkdir -p "$BACKEND_DIR/user_files/vectors"
mkdir -p "$BACKEND_DIR/user_files/images"
mkdir -p "$BACKEND_DIR/data_base/vectors"
mkdir -p "$BACKEND_DIR/data_base/images"

# Installa le dipendenze Python se necessario
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "📦 Installo le dipendenze Python..."
    cd "$BACKEND_DIR"
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source "$BACKEND_DIR/venv/bin/activate"
fi

# Avvia il server API Python in background
echo "🐍 Avvio del server API Python su http://127.0.0.1:8765..."
cd "$BACKEND_DIR"
python3 "$PYTHON_API_SERVER" &
PYTHON_PID=$!

# Attendi che il server sia pronto
sleep 2

# Controlla se il server è avviato
if ! kill -0 $PYTHON_PID 2>/dev/null; then
    echo "❌ Il server Python non si è avviato correttamente."
    exit 1
fi

echo "✅ Server Python avviato (PID: $PYTHON_PID)"

# Installa le dipendenze Node se necessario
if [ ! -d "$GUI_DIR/node_modules" ]; then
    echo "📦 Installo le dipendenze Node.js..."
    cd "$GUI_DIR"
    npm install
fi

# Avvia l'app Tauri
echo "⚛️  Avvio dell'interfaccia Tauri..."
cd "$GUI_DIR"

# Funzione di cleanup
cleanup() {
    echo ""
    echo "🛑 Arresto in corso..."
    kill $PYTHON_PID 2>/dev/null
    echo "✅ StudioIA arrestato."
    exit 0
}

# Imposta il trap per il cleanup
trap cleanup INT TERM EXIT

# Avvia Tauri in sviluppo o produzione
if [ "$1" == "--build" ]; then
    echo "🔨 Build in corso..."
    npm run tauri build
else
    echo "🔧 Modalità sviluppo..."
    npm run tauri dev
fi

# Ripristina il trap
trap - INT TERM EXIT

# Ferma il server Python
kill $PYTHON_PID 2>/dev/null
echo "✅ StudioIA arrestato."
