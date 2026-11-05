#!/bin/bash
# build.sh — costruisce l'eseguibile desktop di NovaStudio con PyInstaller.
#
# Cosa fa:
#   1. Verifica di essere dentro un venv (per non sporcare il Python di sistema)
#   2. Installa/aggiorna PyInstaller
#   3. Lancia PyInstaller con il file NovaStudio.spec
#   4. Ti dice dove trovare il risultato
#
# Uso:
#   bash build.sh

set -e

echo "==============================================================="
echo " NovaStudio — Build eseguibile desktop"
echo "==============================================================="
echo ""

# ---------------------------------------------------------------
# 1. Verifica venv
# ---------------------------------------------------------------
if [ -z "$VIRTUAL_ENV" ]; then
    echo "ATTENZIONE: non sembri essere in un ambiente virtuale Python."
    echo "Consigliato attivare il venv prima di buildare, per non"
    echo "inquinare il Python di sistema:"
    echo ""
    echo "    source .venv/Scripts/activate   # Git Bash su Windows"
    echo ""
    read -p "Continuare comunque? [s/N] " risposta
    if [[ ! "$risposta" =~ ^[sS]$ ]]; then
        echo "Build annullata."
        exit 1
    fi
fi

# ---------------------------------------------------------------
# 2. Verifica presenza main.py
# ---------------------------------------------------------------
if [ ! -f "main.py" ]; then
    echo "ERRORE: main.py non trovato. Esegui questo script dalla root del progetto."
    exit 1
fi

# ---------------------------------------------------------------
# 3. Installa/aggiorna PyInstaller
# ---------------------------------------------------------------
echo "==> Installo/aggiorno PyInstaller..."
python -m pip install --upgrade pip
python -m pip install --upgrade pyinstaller

# ---------------------------------------------------------------
# 4. Pulisci build precedenti
# ---------------------------------------------------------------
echo "==> Pulisco build precedenti (dist/, build/, *.spec temporanei)..."
rm -rf build dist

# ---------------------------------------------------------------
# 5. Build
# ---------------------------------------------------------------
echo "==> Avvio PyInstaller (può richiedere 5-15 minuti)..."
echo "    NON interrompere. Vedrai molti warning: la maggior parte"
echo "    sono innocui. Aspetta il messaggio finale."
echo ""

python -m PyInstaller --clean --noconfirm NovaStudio.spec

# ---------------------------------------------------------------
# 6. Report finale
# ---------------------------------------------------------------
echo ""
echo "==============================================================="
echo " BUILD COMPLETATA"
echo "==============================================================="
echo ""
echo "Risultato:  dist/NovaStudio/"
echo "Eseguibile: dist/NovaStudio/NovaStudio.exe"
echo ""
echo "Per testare:"
echo "    cd dist/NovaStudio"
echo "    ./NovaStudio.exe"
echo ""
echo "Per distribuire:"
echo "    Comprimi l'intera cartella dist/NovaStudio/ in uno ZIP."
echo "    Chi lo riceve estrae lo ZIP e lancia NovaStudio.exe."
echo ""
echo "Prima di avviare su un altro PC, assicurati che abbia:"
echo "  - Windows 10/11 64-bit"
echo "  - WebView2 Runtime (di solito già presente su Windows 10+ aggiornati)"
echo "  - Tesseract OCR installato (per l'OCR)"
echo ""