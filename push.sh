#!/bin/bash
# update.sh — aggiorna il repository GitHub di NovaStudio
# Uso: apri Git Bash nella cartella del progetto, poi:
#     bash update.sh
#     bash update.sh "messaggio di commit personalizzato"

set -e  # interrompe lo script al primo errore

# ---------------------------------------------------------------
# 1. Configurazione
# ---------------------------------------------------------------
REPO_URL="https://github.com/stebonny08-spec/AIstudio.git"
BRANCH="main"          # cambia in "master" se il tuo repo usa quel nome

# ---------------------------------------------------------------
# 2. Verifiche preliminari
# ---------------------------------------------------------------
if ! command -v git &> /dev/null; then
    echo "ERRORE: git non è installato o non è nel PATH."
    echo "Installa Git per Windows: https://git-scm.com/download/win"
    exit 1
fi

if [ ! -d ".git" ]; then
    echo "La cartella corrente non è ancora un repository git."
    echo "La inizializzo e collego a $REPO_URL ..."
    git init
    git branch -M "$BRANCH"
    git remote add origin "$REPO_URL"
    echo "Fatto. Al prossimo avvio farà il push vero e proprio."
fi

# Se il remote 'origin' non esiste o punta altrove, lo sistemo
if ! git remote get-url origin &> /dev/null; then
    git remote add origin "$REPO_URL"
else
    CURRENT_REMOTE="$(git remote get-url origin)"
    if [ "$CURRENT_REMOTE" != "$REPO_URL" ]; then
        echo "Il remote 'origin' punta a $CURRENT_REMOTE: lo aggiorno a $REPO_URL"
        git remote set-url origin "$REPO_URL"
    fi
fi

# ---------------------------------------------------------------
# 3. Sincronizzazione con il remoto (pull)
# ---------------------------------------------------------------
# Prima di committare, mi assicuro di essere aggiornato. Se il repo
# remoto è vuoto (primo push in assoluto) il pull fallisce: lo gestisco.
echo ""
echo "==> Sincronizzazione con il remoto..."
if git ls-remote --exit-code --heads origin "$BRANCH" &> /dev/null; then
    git pull --rebase origin "$BRANCH" || {
        echo ""
        echo "ATTENZIONE: il pull ha generato conflitti."
        echo "Risolvili manualmente, poi rilancia lo script."
        exit 1
    }
else
    echo "Il branch '$BRANCH' non esiste ancora sul remoto: salto il pull."
fi

# ---------------------------------------------------------------
# 4. Commit e push
# ---------------------------------------------------------------
# Messaggio di commit: usa l'argomento passato, altrimenti timestamp.
if [ -n "$1" ]; then
    COMMIT_MSG="$1"
else
    COMMIT_MSG="Aggiornamento $(date '+%Y-%m-%d %H:%M:%S')"
fi

echo ""
echo "==> Aggiungo le modifiche..."
git add -A

# Se non c'è nulla da committare, esco con un messaggio chiaro.
if git diff --cached --quiet; then
    echo "Nessuna modifica da committare. Il repository è già aggiornato."
    exit 0
fi

echo "==> Commit: $COMMIT_MSG"
git commit -m "$COMMIT_MSG"

echo ""
echo "==> Push verso $REPO_URL ($BRANCH)..."
git push -u origin "$BRANCH"

echo ""
echo "Fatto! Repository aggiornato."