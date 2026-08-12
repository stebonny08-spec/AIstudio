#!/bin/bash

# Script di avvio per StudioIA
# Esegue l'applicazione desktop ibrida con interfaccia web

# Ottieni il percorso dello script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Cambia nella directory del progetto
cd "$SCRIPT_DIR" || exit 1

echo "Avvio di StudioIA - AI per lo Studio..."

# Verifica se Python è disponibile
if ! command -v python3 &> /dev/null; then
    echo "Errore: Python 3 non è installato o non è nel PATH"
    exit 1
fi

# Verifica se il file main.py esiste
if [ ! -f "main.py" ]; then
    echo "Errore: main.py non trovato nella directory corrente"
    exit 1
fi

# Esegui l'applicazione
python3 main.py
