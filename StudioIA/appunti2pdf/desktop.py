"""
desktop.py
Punto di ingresso dell'applicazione desktop.

Avvia il server Streamlit in background (su una porta locale libera,
scelta automaticamente) e lo incapsula in una finestra nativa tramite
pywebview: nessuna scheda del browser, nessuna barra degli indirizzi,
nessuna dipendenza da un browser esterno gia' aperto. L'app si comporta a
tutti gli effetti come un normale programma desktop.

Avvio:
    python desktop.py
"""
from __future__ import annotations

import atexit
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

APP_DIR = Path(__file__).resolve().parent
APP_SCRIPT = APP_DIR / "app.py"
WINDOW_TITLE = "Appunti2PDF"
STARTUP_TIMEOUT_SECONDS = 40
DEBUG = os.getenv("APPUNTI2PDF_DEBUG", "false").strip().lower() in {"1", "true", "yes"}


def get_python_executable(base_dir: Optional[Path] = None) -> str:
    """Restituisce l'interprete Python del virtual environment del progetto, se presente."""
    base_path = (base_dir or APP_DIR).resolve()
    candidates = []

    if sys.platform == "win32":
        candidates.extend([
            base_path / ".venv" / "Scripts" / "python.exe",
            base_path / "venv" / "Scripts" / "python.exe",
        ])
    else:
        candidates.extend([
            base_path / ".venv" / "bin" / "python",
            base_path / "venv" / "bin" / "python",
        ])

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return sys.executable

_streamlit_process: Optional[subprocess.Popen] = None
_process_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Utility di rete
# --------------------------------------------------------------------------- #
def find_free_port() -> int:
    """Chiede al sistema operativo una porta locale libera: evita conflitti tra istanze/altre app."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_server(url: str, process: subprocess.Popen, timeout: float = STARTUP_TIMEOUT_SECONDS) -> bool:
    """Attende che il server Streamlit risponda, con timeout massimo. Si interrompe se il processo muore."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False  # il processo Streamlit e' terminato in modo anomalo
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
            pass
        time.sleep(0.2)
    return False


# --------------------------------------------------------------------------- #
# Gestione del processo Streamlit
# --------------------------------------------------------------------------- #
def start_streamlit(port: int) -> subprocess.Popen:
    """Avvia il server Streamlit come processo separato, in modalita' headless."""
    if not APP_SCRIPT.exists():
        raise FileNotFoundError(f"File dell'app non trovato: {APP_SCRIPT}")

    python_executable = get_python_executable()
    command = [
        python_executable, "-m", "streamlit", "run", str(APP_SCRIPT),
        "--server.port", str(port),
        "--server.address", "127.0.0.1",
    ]

    popen_kwargs = {}
    if sys.platform == "win32":
        # Evita che si apra una finestra di console nera insieme alla app
        popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    env = os.environ.copy()
    env["APPUNTI2PDF_DESKTOP"] = "1"

    process = subprocess.Popen(
        command,
        cwd=str(APP_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
        **popen_kwargs,
    )
    return process


def stop_streamlit() -> None:
    """Termina in modo pulito il processo Streamlit, se ancora attivo. Sicura da chiamare piu' volte."""
    global _streamlit_process
    with _process_lock:
        process, _streamlit_process = _streamlit_process, None
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def _stream_logs(process: subprocess.Popen) -> None:
    """Inoltra l'output del server Streamlit sulla console: utile in fase di sviluppo/debug."""
    if process.stdout is None:
        return
    try:
        for line in process.stdout:
            if DEBUG:
                print(f"[streamlit] {line.rstrip()}")
    except (ValueError, OSError):
        pass  # pipe chiusa durante lo spegnimento: non e' un errore


# --------------------------------------------------------------------------- #
# Schermata di avvio (splash), mostrata subito mentre Streamlit si avvia
# --------------------------------------------------------------------------- #
_SPLASH_HTML = """
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<style>
  html, body {
      margin: 0; height: 100%; display: flex; align-items: center; justify-content: center;
      background: #1a1a2e; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #eaeaea;
  }
  .box { text-align: center; }
  .spinner {
      width: 42px; height: 42px; margin: 0 auto 18px auto; border-radius: 50%;
      border: 4px solid rgba(255,255,255,0.15); border-top-color: #4dabf7;
      animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1.2rem; font-weight: 600; margin: 0 0 6px 0; }
  p { font-size: 0.85rem; color: #a0a0b8; margin: 0; }
</style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <h1>📚 Appunti2PDF</h1>
    <p>Avvio dell'applicazione in corso...</p>
  </div>
</body>
</html>
"""

_ERROR_HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8">
<style>
  html, body {{
      margin: 0; height: 100%; display: flex; align-items: center; justify-content: center;
      background: #1a1a2e; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #eaeaea;
  }}
  .box {{ text-align: center; max-width: 440px; padding: 0 24px; }}
  h1 {{ font-size: 1.15rem; color: #ff6b6b; margin: 0 0 10px 0; }}
  p {{ font-size: 0.88rem; color: #cfcfe0; line-height: 1.5; margin: 0; }}
</style>
</head>
<body>
  <div class="box">
    <h1>⚠️ Impossibile avviare l'applicazione</h1>
    <p>{message}</p>
  </div>
</body>
</html>
"""


def _render_error(message: str) -> str:
    return _ERROR_HTML_TEMPLATE.format(message=message)


# --------------------------------------------------------------------------- #
# Avvio dell'applicazione desktop
# --------------------------------------------------------------------------- #
def main() -> None:
    try:
        import webview
    except ImportError:
        print(
            "ERRORE: la libreria 'pywebview' non e' installata.\n"
            "Esegui: pip install pywebview",
            file=sys.stderr,
        )
        sys.exit(1)

    global _streamlit_process
    port = find_free_port()
    server_url = f"http://127.0.0.1:{port}"

    try:
        with _process_lock:
            _streamlit_process = start_streamlit(port)
    except Exception as exc:  # noqa: BLE001
        print(f"ERRORE: impossibile avviare il server Streamlit: {exc}", file=sys.stderr)
        sys.exit(1)

    atexit.register(stop_streamlit)
    threading.Thread(target=_stream_logs, args=(_streamlit_process,), daemon=True).start()

    window = webview.create_window(
        WINDOW_TITLE,
        html=_SPLASH_HTML,
        width=1200,
        height=820,
        min_size=(900, 600),
    )

    def load_app_when_ready() -> None:
        process = _streamlit_process
        if process is None:
            return

        if process.poll() is not None:
            window.load_html(_render_error(
                "Il server dell'applicazione si e' interrotto in modo imprevisto. "
                "Riavvia l'app. Se il problema persiste, contatta il supporto."
            ))
            return

        if not wait_for_server(server_url, process):
            window.load_html(_render_error(
                "L'avvio sta impiegando troppo tempo oppure il server si e' interrotto. "
                "Chiudi e riapri l'applicazione. Se il problema persiste, contatta il supporto."
            ))
            return

        window.load_url(server_url)

    import webview
    webview.settings["ALLOW_DOWNLOADS"] = True

    try:
        webview.start(load_app_when_ready, debug=DEBUG)
    finally:
        stop_streamlit()


if __name__ == "__main__":
    main()
