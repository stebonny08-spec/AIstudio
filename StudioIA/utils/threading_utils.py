"""
utils/threading_utils.py
---------------------------
Implementa il pattern discusso e concordato per non bloccare mai la GUI:
thread worker + queue.Queue + polling con after().

Nessun'altra parte dell'app deve creare thread "a mano" per operazioni
lente (Gemini, ricerca web, scansione file, microfono): passano tutte da
qui, così il pattern è applicato in modo uniforme e testabile in un solo posto.
"""

import queue
import threading
import traceback
from typing import Any, Callable, Optional


class TaskRunner:
    """Va istanziato una sola volta, agganciato alla finestra principale
    (qualunque widget CustomTkinter/Tkinter che esponga after())."""

    def __init__(self, root_widget):
        self._root = root_widget
        self._queue: "queue.Queue" = queue.Queue()
        self._poll()

    def post(self, callback: Callable[[Any], None], payload: Any = None) -> None:
        """Permette a un thread di background di far eseguire in sicurezza
        `callback(payload)` sul thread della GUI, per aggiornamenti di
        avanzamento intermedi (es. "Indicizzazione file 12/143") che
        avvengono DURANTE un'operazione lunga, non solo al termine.
        `queue.Queue.put` è thread-safe: è l'unica cosa che il thread di
        background tocca direttamente, mai i widget.
        """
        self._queue.put(("progress", callback, payload))

    def run(
        self,
        func: Callable[..., Any],
        on_success: Optional[Callable[[Any], None]] = None,
        on_error: Optional[Callable[[Exception], None]] = None,
        *args,
        **kwargs,
    ) -> None:
        """Esegue `func(*args, **kwargs)` su un thread separato. Il
        risultato (o l'eccezione) viene poi consegnato al thread della GUI
        tramite `on_success`/`on_error`, mai chiamati direttamente dal
        thread di background: i widget Tkinter non sono thread-safe.
        """

        def worker():
            try:
                result = func(*args, **kwargs)
                self._queue.put(("success", on_success, result))
            except Exception as e:
                traceback.print_exc()
                self._queue.put(("error", on_error, e))

        threading.Thread(target=worker, daemon=True).start()

    def _poll(self) -> None:
        try:
            while True:
                _status, callback, payload = self._queue.get_nowait()
                if callback is not None:
                    callback(payload)
        except queue.Empty:
            pass
        finally:
            # Si ricontrolla ogni 100ms: abbastanza reattivo per l'utente,
            # abbastanza raro da non pesare sulla CPU.
            self._root.after(100, self._poll)
