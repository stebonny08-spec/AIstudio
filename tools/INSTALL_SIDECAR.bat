@echo off
rem ============================================================
rem  G1 - INSTALL_SIDECAR.bat
rem  Installa il binario ufficiale llama-server.exe in tools\
rem  e aggiorna la config (llama.server_path / llama.bench_path).
rem  Fonte: releases ufficiali llama.cpp (ggml-org).
rem ============================================================
setlocal
cd /d "%~dp0\.."

echo [1/3] Download + estrazione in tools\ (asset bin-win-cpu-x64)...
python "%~dp0_install_sidecar.py"
if errorlevel 1 (
    echo.
    echo DOWNLOAD FALLITO (rete assente o URL cambiato).
    echo Procedura manuale completa: tools\README_SIDECAR.md
    pause
    exit /b 1
)

echo [2/3] Verifica binario:
tools\llama-server.exe --version
if errorlevel 1 (
    echo Estrazione non riuscita - vedi tools\README_SIDECAR.md
    pause
    exit /b 1
)

echo [3/3] Aggiornamento config (llama.server_path, llama.bench_path)...
python -c "import os,sys; sys.path.insert(0,'.'); from data.config_manager import ConfigManager; c=ConfigManager(); c.set('llama.server_path', os.path.abspath(r'tools\llama-server.exe')); c.set('llama.bench_path', os.path.abspath(r'tools\llama-bench.exe')); c.save(); print('config aggiornata:', c.get('llama.server_path'))"

echo.
echo Fatto. Verifica: python tests\testG1_sidecar.py
pause
exit /b 0
