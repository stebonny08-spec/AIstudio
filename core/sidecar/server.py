"""Sidecar llama-server: avvio on-demand, salute, idle-unload, backoff (T1).

Comportamento:
  - start_on_demand(): se llama.server_path e' assente/inesistente o il
    subprocess non parte -> stato 'down' e ritorna False (MAI eccezione);
  - argomenti: -m <model>, -c n_ctx (4096-8192 da config),
    --cache-type-k q8_0 --cache-type-v q8_0, --host 127.0.0.1, --port <random>;
  - idle_unload_sec (default 300): dopo questo tempo dall'ultimo job ->
    terminate del processo;
  - crash: restart con backoff 1,2,4... max 30s; 3 crash -> stato
    'disabled' con messaggio 'AI non disponibile';
  - health(): la porta 127.0.0.1 risponde?

Motore duale (R23/X5):
  - llama.engine: 'upstream' | 'xhtoken' | 'auto' (default 'auto');
    'auto' -> regola R23 = upstream (qa/x3_compare.json); il flag manuale
    forza il motore (X3.4 debug); valore invalido -> log + auto (X5.4);
  - llama.server_path esplicito ha precedenza in auto/upstream (la
    configurazione esistente non viene rotta); engine 'xhtoken' forzato
    batte llama.server_path (altrimenti il forcing non avrebbe effetto);
  - fallback X5.3: xhtoken mancante/KO/crash ripetuto -> ripiego una
    tantum su upstream con message + log espliciti (mai eccezione);
  - lo switch modello (R22) e lo switch engine riusano lo stesso restart
    controllato; l'engine viene risolto a OGNI avvio server (X5.2).

Config letta da data/config_manager (chiavi llama.*).
"""

from __future__ import annotations

import os
import socket
import subprocess
import threading
import time
import urllib.request
from typing import Any, Optional

__all__ = ["SidecarServer", "get_server", "ENGINE_BINARIES"]

DEFAULT_IDLE_UNLOAD_SEC = 300
DEFAULT_N_CTX = 4096
N_CTX_MIN, N_CTX_MAX = 4096, 8192
STARTUP_TIMEOUT = 20.0        # secondi di attesa ready
MAX_BACKOFF = 30              # secondi, rampa 1,2,4..30
MAX_CRASHES = 3               # crash consecutivi -> disabled
CRASH_RESET_WINDOW = 300      # 5 min di stabilita' -> contatore azzerato
_UNLOAD_WAIT = 3.0

# ------------------------------------------------------------ engine (R23)
ENGINE_DEFAULT = "auto"             # X5.1: default config
ENGINE_AUTO_RESOLVED = "upstream"   # regola R23: auto -> upstream
XHTOKEN_MAX_CRASHES = 2             # X5.3: crash consecutivi -> fallback
XHTOKEN_KO_PREFIX = "[Sidecar] engine xhtoken KO -> upstream:"
ENGINE_VALIDI = ("auto", "upstream", "xhtoken")

# Root progetto = core/sidecar/ -> risale 3 livelli; binari relativi alla root
_PROJECT_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
ENGINE_BINARIES = {
    "upstream": os.path.join(_PROJECT_ROOT, "tools", "llama-server.exe"),
    "xhtoken": os.path.join(
        _PROJECT_ROOT, "tools", "llama-xhtoken", "build", "bin",
        "llama-server.exe",
    ),
}

_server_lock = threading.Lock()
_server_singleton: Optional["SidecarServer"] = None


def get_server(config=None) -> "SidecarServer":
    """Singleton del SidecarServer condiviso (thread-safe)."""
    global _server_singleton
    with _server_lock:
        if _server_singleton is None or config is not None:
            _server_singleton = SidecarServer(config=config)
        return _server_singleton


def _cfg(config, key: str, default: Any) -> Any:
    """Legge una chiave da dict oppure oggetto tipo ConfigManager."""
    if isinstance(config, dict):
        return config.get(key, default)
    if config is None:
        return default
    getter = getattr(config, "get", None)
    if callable(getter):
        try:
            value = getter(key, default)
        except TypeError:
            value = getter(key)
        return default if value is None else value
    return default


def _free_port() -> int:
    """Porta TCP libera su 127.0.0.1 (best-effort)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])
    finally:
        s.close()


def _popen_flags():
    if os.name == "nt":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {}


class SidecarServer:
    """Gestisce il processo llama-server locale."""

    def __init__(self, config=None):
        if config is None:
            try:
                from data.config_manager import ConfigManager
                config = ConfigManager()
            except Exception:
                config = {}
        self._config = config
        self._lock = threading.Lock()
        self._start_lock = threading.Lock()
        self._stop = threading.Event()
        self._state = "down"          # down | starting | up | disabled
        self._proc: Optional[subprocess.Popen] = None
        self._port: Optional[int] = None
        self._draft_mode = False       # modalita' draft attiva sul processo (R13)
        self._last_want_draft = False  # ultima modalita' richiesta (per restart)
        self._launched_model = ""      # llama.model_path del processo (R22)
        self._launched_server_path = ""  # binario usato dal processo (R23)
        self._launched_engine = ""        # engine effettivo del processo (R23)
        self._xhtoken_fallback = False    # X5.3: flag runtime (una tantum/run)
        self._xhtoken_crashes = 0         # crash consecutivi engine xhtoken
        self._fallback_notice = ""        # avviso utente persistente post-ripiego
        self._crashes = 0
        self._backoff = 1
        self._last_crash = 0.0
        self._last_job = time.time()
        self.message = ""
        self._monitor = threading.Thread(
            target=self._monitor_loop, name="sidecar-monitor", daemon=True
        )
        self._monitor.start()

    # ------------------------------------------------------------ stato

    @property
    def state(self) -> str:
        with self._lock:
            return self._state

    @property
    def port(self) -> Optional[int]:
        with self._lock:
            return self._port

    @property
    def draft_mode(self) -> bool:
        """True se il processo gira con modello draft caricato (R13)."""
        with self._lock:
            return bool(self._draft_mode)

    def status(self) -> dict:
        with self._lock:
            return {
                "state": self._state,
                "port": self._port,
                "crashes": self._crashes,
                "message": self.message,
                "draft": bool(self._draft_mode),
                "engine": str(self._launched_engine or ""),   # R23
                "xhtoken_fallback": bool(self._xhtoken_fallback),  # X5.3
            }

    def rss_mb(self):
        """R22: RSS corrente del processo llama-server in MB (float), oppure
        None se il processo non esiste o psutil non e' disponibile.
        Usato dalla guardia RAM del draft in SidecarClient.want_draft."""
        with self._lock:
            proc = self._proc
        if proc is None:
            return None
        try:
            import psutil
            return psutil.Process(proc.pid).memory_info().rss / (1024.0 * 1024.0)
        except Exception:
            return None

    def touch_job(self) -> None:
        """Segnala attivita': reset del timer di idle-unload."""
        with self._lock:
            self._last_job = time.time()

    def health(self) -> bool:
        """True se la porta del sidecar accetta connessioni."""
        with self._lock:
            port = self._port
        if not port:
            return False
        try:
            conn = socket.create_connection(("127.0.0.1", int(port)), timeout=0.5)
            conn.close()
            return True
        except OSError:
            return False

    # ---------------------------------------------------------- engine

    def _resolve_engine(self):
        """Risolve (engine_effettivo, percorso_binario) - X5.1/X3.4/X5.4.

        Regole dichiarate:
          1) 'llama.engine' assente/vuoto -> 'auto' (comportamento
             preesistente invariato);
          2) valore invalido -> log + 'auto', MAI eccezione (X5.4);
          3) 'auto' -> regola R23 = upstream, con log esplicito; se
             'llama.server_path' e' esplicito (non vuoto) nella config
             utente ha PRECEDENZA (config esistente non toccata);
          4) 'upstream' forzato (X3.4 debug) -> 'llama.server_path' se
             esplicito, altrimenti binario upstream di default;
          5) 'xhtoken' forzato (X3.4 debug) -> binario XHToken: batte
             'llama.server_path' (che di default punta al binario
             upstream, daregli precedenza annullerebbe il forcing);
          6) dopo un fallback X5.3 lo stesso run NON riprova mai xhtoken.
        I percorsi di default sono relativi alla root progetto.
        """
        try:
            raw = _cfg(self._config, "llama.engine", ENGINE_DEFAULT)
            engine = str(raw if raw is not None else "").strip().lower()
            if not engine:
                engine = ENGINE_DEFAULT          # assente/vuoto -> auto
            elif engine not in ENGINE_VALIDI:
                print("[Sidecar] engine %r non valido -> auto "
                      "(X5.4: upstream|xhtoken|auto)" % (raw,))
                engine = ENGINE_DEFAULT
            explicit_path = str(
                _cfg(self._config, "llama.server_path", "") or ""
            ).strip()

            if engine == "auto":
                # regola R23: acceptance 0.8402 >= 0.70 ma speedup xt
                # 1.24 < 1.30 -> DEFAULT = upstream
                engine = ENGINE_AUTO_RESOLVED
                print("[Sidecar] engine auto -> upstream (regola R23: "
                      "speedup xt 1.24 < 1.30, qa/x3_compare.json)")
                if explicit_path:
                    return engine, explicit_path  # precedenza config
                return engine, ENGINE_BINARIES["upstream"]

            if engine == "xhtoken" and not self._xhtoken_fallback:
                print("[Sidecar] engine forzato -> xhtoken (X3.4)")
                if explicit_path:
                    print("[Sidecar] llama.server_path non usato: engine "
                          "xhtoken forzato prevale (X3.4)")
                return "xhtoken", ENGINE_BINARIES["xhtoken"]

            if engine == "xhtoken" and self._xhtoken_fallback:
                # X5.3: nessun retry xhtoken nel run corrente
                print("[Sidecar] engine xhtoken non riprovato: fallback "
                      "upstream gia' attivo (X5.3)")
                # mai ripartire sullo stesso binario KO tramite server_path
                if explicit_path and os.path.normcase(
                    os.path.abspath(explicit_path)
                ) == os.path.normcase(
                    os.path.abspath(ENGINE_BINARIES["xhtoken"])
                ):
                    explicit_path = ""
            else:
                print("[Sidecar] engine forzato -> upstream (X3.4)")
            if explicit_path:
                return "upstream", explicit_path
            return "upstream", ENGINE_BINARIES["upstream"]
        except Exception as exc:  # X5.4: mai eccezione
            print("[Sidecar] risoluzione engine fallita (%s) -> auto/upstream"
                  % exc)
            return ENGINE_AUTO_RESOLVED, ENGINE_BINARIES["upstream"]

    def _trigger_fallback(self, motivo: str) -> None:
        """X5.3: ripiego una tantum da xhtoken a upstream (mai eccezione).

        (a) self.message esplicito per l'utente,
        (b) log console '[Sidecar] engine xhtoken KO -> upstream: <motivo>'.
        Il flag runtime blocca ogni nuovo tentativo xhtoken nel run
        corrente; reset: nuovo sidecar, reset(), shutdown().
        """
        with self._lock:
            if self._xhtoken_fallback:
                return                      # gia' ripiegato: una sola volta
            self._xhtoken_fallback = True
            self._fallback_notice = (
                "motore XHToken non disponibile -> ripiego su upstream (%s)"
                % motivo
            )
            self.message = self._fallback_notice
        print("%s %s" % (XHTOKEN_KO_PREFIX, motivo))

    # ---------------------------------------------------------- avvio

    def _resolve_draft(self, want: bool):
        """Risolve la modalita' draft richiesta -> (attivo: bool, path: str).

        R13: draft=True vale SOLO se spec.draft_model e' impostato ed
        esistente; altrimenti si gira senza draft (identico a prima).
        """
        if not want:
            return False, ""
        path = str(_cfg(self._config, "spec.draft_model", "") or "").strip()
        if not path or not os.path.exists(path):
            return False, ""
        return True, path

    def start_on_demand(self, draft: bool = False) -> bool:
        """Avvia llama-server se necessario. False (mai eccezione) se KO.

        R13: draft=True avvia con --model-draft <path> (solo se
        spec.draft_model e' impostato ed esistente); senza argomento (o con
        draft=False) il comportamento e' identico a prima. Se il server e'
        gia' attivo in modalita' diversa viene riavviato (nessun crash
        conteggiato) con la modalita' richiesta.
        R22: switch modello -> restart controllato con stato ripristinato.
        R23/X5: l'engine (llama.engine) viene risolto a OGNI avvio server
        (X5.2); cambio binario -> stesso restart controllato del cambio
        modello; fallback xhtoken -> upstream senza eccezioni (X5.3).
        """
        with self._start_lock:
            # R23: refresh config da disco a ogni avvio/dinamica. La config
            # viene scritta da backend/api.py su un'ALTRA istanza
            # ConfigManager (non singleton): senza rilettura l'istanza del
            # sidecar resta stale e non vede switch modello/engine (gap
            # rilevato dal QA-1 qa/x_qa1_switch.py; i dict dei test non
            # hanno .load() -> invariati).
            if hasattr(self._config, "load"):
                try:
                    self._config.load()
                except Exception as exc:
                    print("[SidecarServer] refresh config non riuscito: %s" % exc)
            with self._lock:
                if self._state == "disabled":
                    return False
                proc, state = self._proc, self._state
                cur_mode = bool(self._draft_mode)
                launched_model = str(self._launched_model or "")
                launched_bin = str(self._launched_server_path or "")

            # R23/X5.1: engine risolto a ogni avvio server
            engine, server_path = self._resolve_engine()
            if engine == "xhtoken" and not os.path.exists(server_path):
                # X5.3a: binario mancante -> ripiego immediato su upstream
                self._trigger_fallback(
                    "binario xhtoken mancante: %s" % server_path)
                engine, server_path = self._resolve_engine()

            # R22: se il config chiede un modello DIVERSO da quello con cui
            # il processo e' partito (switch base <-> pro), il server va
            # riavviato: llama-server legge -m solo all'avvio.
            # launched_model vuoto (processo 'finto'/vecchio) -> nessun
            # cambio rilevato (backward-compat con test che fabbricano proc).
            want_model = str(_cfg(self._config, "llama.model_path", "") or "").strip()
            model_changed = (bool(want_model) and bool(launched_model)
                             and want_model != launched_model)

            # X5.2: cambio binario/engine (es. engine forzato xhtoken) ->
            # stesso restart controllato del cambio modello (R22)
            bin_changed = bool(launched_bin) and server_path != launched_bin

            want_draft, draft_path = self._resolve_draft(bool(draft))
            # P1b.1: con n-gram long-form attivo (config), la modalita' spec
            # resta True anche senza draft modello: il ramo argv qui sotto
            # applica --spec-type ngram-* (esito A/B qa/p1b_ngram.json).
            if bool(draft) and not want_draft and bool(
                    _cfg(self._config, "spec.ngram_longform", False)):
                want_draft = True

            # Già in esecuzione?
            if proc is not None and proc.poll() is None:
                if cur_mode == want_draft and not model_changed and not bin_changed:
                    if state == "up":
                        self.touch_job()
                        return True
                    # 'starting': attendi brevemente la ready dell'altro giro
                    deadline = time.time() + 5.0
                    while time.time() < deadline:
                        if self.health():
                            self.touch_job()
                            return True
                        time.sleep(0.1)
                    return False
                # Cambio modalita' draft O cambio modello (R22) O cambio
                # engine (R23/X5.2) -> riavvio controllato (no crash)
                with self._lock:
                    self._state = "down"
                    self._proc = None
                    self._port = None
                    self._draft_mode = False
                    self._launched_model = ""
                    self._launched_server_path = ""
                    self._launched_engine = ""
                    if model_changed:
                        self.message = "cambio modello"
                    elif bin_changed:
                        self.message = "cambio engine"
                    else:
                        self.message = "cambio modalita' draft"
                self._terminate(proc)
                proc = None

            if bool(draft) and not want_draft:
                # fallback soft: log SOLO quando si avvia davvero, non a
                # ogni richiesta con il server gia' attivo
                print("[SidecarServer] draft richiesto ma spec.draft_model "
                      "assente/inesistente: avvio senza draft")

            model_path = str(_cfg(self._config, "llama.model_path", "") or "").strip()

            if not server_path or not os.path.exists(server_path):
                with self._lock:
                    self._state = "down"
                    self._proc = None
                    self._port = None
                    self.message = "llama-server non configurato o inesistente"
                return False
            if not model_path or not os.path.exists(model_path):
                with self._lock:
                    self._state = "down"
                    self._proc = None
                    self._port = None
                    self.message = "modello llama inesistente"
                return False

            try:
                n_ctx = int(_cfg(self._config, "llama.n_ctx", DEFAULT_N_CTX))
            except (TypeError, ValueError):
                n_ctx = DEFAULT_N_CTX
            n_ctx = max(N_CTX_MIN, min(N_CTX_MAX, n_ctx))

            port = _free_port()

            # X5.3b: avvio KO con xhtoken -> ripiego upstream + 1 solo retry
            proc = None
            last_exc = None
            for _attempt in range(2):
                args = [
                    server_path,
                    "-m", model_path,
                    "-c", str(n_ctx),
                    "--cache-type-k", "q8_0",
                    "--cache-type-v", "q8_0",
                    "--host", "127.0.0.1",
                    "--port", str(port),
                ]
                if want_draft and draft_path:
                    # R13: speculazione a livello DI AVVIO (verificato da
                    # llama-server.exe --help): --model-draft carica il modello
                    # ma il DEFAULT di --spec-type e' "none" -> senza
                    # --spec-type draft-simple la decodifica speculativa NON si
                    # attiva. Nessun campo draft esiste nel body /completion
                    # (gli argomenti draft sono solo CLI/env in questa build).
                    args += ["--model-draft", draft_path,
                             "--spec-type", "draft-simple"]
                elif want_draft and not draft_path:
                    # P1b.1 - n-gram draftless LONG-FORM: solo con
                    # spec.ngram_longform (default True = esito A/B). Il
                    # draft Spark resta OFF (spec.draft_model vuoto) ->
                    # mai entrambi gli acceleratori insieme.
                    variant = str(_cfg(self._config, "spec.ngram_variant",
                                       "ngram-map-k") or "ngram-map-k")
                    dmax = int(_cfg(self._config, "spec.ngram_draft_max", 5) or 5)
                    if variant == "ngram-mod":
                        args += ["--spec-type", "ngram-mod",
                                 "--spec-ngram-mod-n-max", str(dmax)]
                    elif variant in ("ngram-simple", "ngram-map-k",
                                     "ngram-map-k4v"):
                        args += ["--spec-type", variant,
                                 "--spec-" + variant + "-size-m", str(dmax)]
                    print("[SidecarServer] spec n-gram long-form: %s D=%d"
                          % (variant, dmax))
                try:
                    proc = subprocess.Popen(
                        args,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        **_popen_flags(),
                    )
                    break
                except Exception as exc:
                    last_exc = exc
                    if engine == "xhtoken" and not self._xhtoken_fallback:
                        self._trigger_fallback("avvio fallito: %s" % exc)
                        engine, server_path = self._resolve_engine()
                        if os.path.exists(server_path):
                            continue     # un solo retry con upstream
                    break

            if proc is None:
                with self._lock:
                    self._state = "down"
                    self._proc = None
                    self._port = None
                    self.message = "avvio fallito: %s" % last_exc
                print("[SidecarServer] avvio fallito: %s" % last_exc)
                return False

            with self._lock:
                self._proc = proc
                self._port = port
                self._state = "starting"
                self._last_job = time.time()
                self._draft_mode = want_draft
                self._last_want_draft = want_draft
                self._launched_model = model_path  # R22: -m effettivamente usato
                self._launched_server_path = server_path  # R23
                self._launched_engine = engine             # R23
                self.message = "avvio in corso"

            # Attesa ready: processo vivo + /health 200
            deadline = time.time() + STARTUP_TIMEOUT
            while time.time() < deadline:
                if self._stop.is_set():
                    self._terminate(proc)
                    return False
                rc = proc.poll()
                if rc is not None:
                    self._on_crash(proc, "exit %s" % rc)
                    return False
                if self._http_ready(port):
                    with self._lock:
                        self._state = "up"
                        # avvio riuscito: azzera i crash consecutivi xhtoken
                        self._xhtoken_crashes = 0
                        # "" se nessun ripiego; avviso X5.3 se presente
                        self.message = self._fallback_notice
                    print("[SidecarServer] pronto su 127.0.0.1:%d" % port)
                    return True
                time.sleep(0.2)

            # Timeout: termina e tratta come crash (backoff/disabled)
            self._terminate(proc)
            self._on_crash(proc, "timeout avvio")
            return False

    def _http_ready(self, port: int) -> bool:
        """TCP ok + GET /health con status 200."""
        try:
            conn = socket.create_connection(("127.0.0.1", int(port)), timeout=0.3)
            conn.close()
        except OSError:
            return False
        try:
            req = urllib.request.Request("http://127.0.0.1:%d/health" % int(port))
            with urllib.request.urlopen(req, timeout=0.5) as resp:
                code = getattr(resp, "status", None) or resp.getcode()
            return 200 <= int(code) < 300
        except Exception:
            return False

    # ------------------------------------------------- crash/backoff

    def _on_crash(self, proc, reason: str) -> None:
        """Conta il crash, pianifica il restart con backoff 1,2,4..30s.

        Al 3° crash -> stato 'disabled', messaggio 'AI non disponibile'.

        X5.3: se il processo girava con engine 'xhtoken' e si raggiungono
        XHTOKEN_MAX_CRASHES (2) crash CONSECUTIVI dello stesso motore
        (nessun avvio riuscito/stato 'up' intermedio) -> ripiego una tantum
        su 'upstream': self.message esplicito + log
        '[Sidecar] engine xhtoken KO -> upstream: <motivo>',
        nessuna eccezione, restart immediato che risolve l'engine upstream.
        """
        restart_delay: Optional[float] = None
        with self._lock:
            if self._proc is not proc or self._state not in ("up", "starting"):
                return  # unload intenzionale o crash gia' gestito
            self._proc = None
            self._port = None
            self._draft_mode = False
            now = time.time()
            if now - self._last_crash > CRASH_RESET_WINDOW:
                self._crashes = 0
                self._backoff = 1
                self._xhtoken_crashes = 0
            self._last_crash = now
            self._crashes += 1
            crashes = self._crashes
            delay = min(self._backoff, MAX_BACKOFF)
            self._backoff = min(self._backoff * 2, MAX_BACKOFF * 2)

            fallback = False
            if str(self._launched_engine or "") == "xhtoken":
                self._xhtoken_crashes += 1
                if (not self._xhtoken_fallback
                        and self._xhtoken_crashes >= XHTOKEN_MAX_CRASHES):
                    # X5.3: criterio dichiarato -> 2 crash consecutivi
                    fallback = True
                    self._xhtoken_fallback = True
                    motivo = ("%d crash consecutivi xhtoken (%s)"
                              % (self._xhtoken_crashes, reason))
                    self._fallback_notice = (
                        "motore XHToken non disponibile -> ripiego su "
                        "upstream (%s)" % motivo
                    )
                    self._state = "down"
                    self.message = self._fallback_notice
                    print("%s %s" % (XHTOKEN_KO_PREFIX, motivo))

            if fallback:
                # X5.3: restart immediato, la risoluzione da' upstream
                restart_delay = 0.0
            elif crashes >= MAX_CRASHES:
                self._state = "disabled"
                self.message = "AI non disponibile"
                print("[SidecarServer] %d crash consecutivi -> disabled "
                      "(AI non disponibile)" % crashes)
            else:
                self._state = "down"
                self.message = "crash (%s), restart tra %ds" % (reason, delay)
                print("[SidecarServer] crash (%s): restart tra %ds "
                      "(crash %d/3)" % (reason, delay, crashes))
                restart_delay = delay
        if restart_delay is not None:
            timer = threading.Timer(restart_delay, self._restart_safe)
            timer.daemon = True
            timer.start()

    def _restart_safe(self) -> None:
        if self._stop.is_set():
            return
        if self.state == "disabled":
            return
        try:
            self.start_on_demand(draft=self._last_want_draft)
        except Exception as exc:
            print("[SidecarServer] restart fallito: %s" % exc)

    # ------------------------------------------------- idle / stop

    def _monitor_loop(self) -> None:
        """Polling: crash impliciti + idle-unload (ultimo job > soglia)."""
        while not self._stop.wait(0.5):
            try:
                with self._lock:
                    state = self._state
                    proc = self._proc
                    last_job = self._last_job
                if proc is None:
                    continue
                if state in ("up", "starting") and proc.poll() is not None:
                    self._on_crash(proc, "exit %s" % proc.returncode)
                    continue
                if state == "up":
                    try:
                        idle = int(_cfg(self._config, "llama.idle_unload_sec",
                                        DEFAULT_IDLE_UNLOAD_SEC))
                    except (TypeError, ValueError):
                        idle = DEFAULT_IDLE_UNLOAD_SEC
                    if idle > 0 and (time.time() - last_job) > idle:
                        self._unload_idle()
            except Exception as exc:
                print("[SidecarServer] errore monitor: %s" % exc)

    def _unload_idle(self) -> None:
        """Scarico per inattivita': terminate, nessun conteggio crash."""
        with self._lock:
            if self._state != "up":
                return
            proc = self._proc
            self._state = "down"
            self._proc = None
            self._port = None
            self._draft_mode = False
            self.message = "scaricato per inattivita'"
        self._terminate(proc)
        print("[SidecarServer] scaricato per inattivita'")

    def _terminate(self, proc) -> None:
        if proc is None:
            return
        try:
            proc.terminate()
            try:
                proc.wait(_UNLOAD_WAIT)
            except Exception:
                proc.kill()
        except Exception:
            pass

    def reset(self) -> None:
        """Riabilita' dopo 'disabled' (es. config corretta dall'utente).

        X5.3: azzera anche il flag di fallback engine -> il prossimo avvio
        puo' riprovare xhtoken.
        """
        with self._lock:
            self._state = "down"
            self._crashes = 0
            self._backoff = 1
            self.message = ""
            self._xhtoken_fallback = False
            self._xhtoken_crashes = 0
            self._fallback_notice = ""

    def shutdown(self) -> None:
        """Ferma monitor e processo. X5.3: resetta il flag di fallback."""
        self._stop.set()
        with self._lock:
            proc = self._proc
            self._state = "down"
            self._proc = None
            self._port = None
            self._draft_mode = False
            self._xhtoken_fallback = False
            self._xhtoken_crashes = 0
            self._fallback_notice = ""
        self._terminate(proc)
