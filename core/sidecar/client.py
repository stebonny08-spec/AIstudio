"""Client HTTP per llama-server (sidecar, T1).

Endpoint: POST http://127.0.0.1:PORT/completion (formato llama-server)
  request : {"prompt", "n_predict", "temperature", "stream", ...}
  stream  : righe SSE  data: {"content": "..."}   ...   data: [DONE]

Ogni errore di connessione o di stream solleva AiUnavailable
('AI non disponibile'): il chiamante puo' quindi intercettarlo e
passare al fallback in-process senza eccezioni non catturate.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from typing import Any, Dict, List, Optional

from .profiles import apply_model_sampling, clamp_max_tokens, get_profile

__all__ = [
    "AiUnavailable",
    "SidecarClient",
    "parse_sse_line",
    "parse_sse_text",
    "CONNECTION_TIMEOUT",
]

class _ChatEndpointError(Exception):
    """Errore di RICHIESTA su /v1/chat/completions (-> fallback legacy)."""


CONNECTION_TIMEOUT = 120.0  # R18:60 -> 120 (prompt 3x950+4x400 char: chat
                            # endpoint con pp grande sforava i 60s e
                            # cascava in doppio path legacy) - R13: era 8.0 ma il
    # prompt REALE della app con RAG (3.700-4.600 tok) richiede ~35-44s di prompt
    # eval a ~105 tok/s: 8s scattava PRIMA del primo byte -> fallback in-process
    # (doppia valutazione + crash NoneType/ggml vedi qa/qa_r13_ttft_report.md).


class AiUnavailable(Exception):
    """AI non disponibile: sidecar irraggiungibile o stream in errore."""

    def __init__(self, message: str = "AI non disponibile"):
        super().__init__(message)


# ---------------------------------------------------------------------------
# Parsing SSE (condiviso: usato dal client e riutilizzabile da chiunque)
# ---------------------------------------------------------------------------

def parse_sse_line(line) -> Optional[Dict[str, Any]]:
    """Parsing di una riga SSE 'data: {...}' -> dict payload oppure None.

    - 'data: [DONE]'      -> {"done": True}
    - righe vuote/other   -> None
    - JSON non valido     -> None (mai eccezione)
    """
    if line is None:
        return None
    if isinstance(line, (bytes, bytearray)):
        try:
            line = line.decode("utf-8")
        except Exception:
            return None
    line = str(line).strip()
    if not line or not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload:
        return None
    if payload == "[DONE]":
        return {"done": True}
    try:
        parsed = json.loads(payload)
    except (ValueError, TypeError):
        return None
    if isinstance(parsed, dict):
        return parsed
    return {"value": parsed}


def parse_sse_text(text) -> List[Dict[str, Any]]:
    """Parsing di un blocco SSE intero (piu' righe) -> lista di payload."""
    out: List[Dict[str, Any]] = []
    if not text:
        return out
    if isinstance(text, (bytes, bytearray)):
        try:
            text = text.decode("utf-8")
        except Exception:
            return out
    for line in str(text).splitlines():
        parsed = parse_sse_line(line)
        if parsed is not None:
            out.append(parsed)
    return out


def _messages_to_prompt(prompt_or_messages) -> str:
    """Stringa -> invariata; lista[dict] -> formattazione chat semplice."""
    if isinstance(prompt_or_messages, str):
        return prompt_or_messages
    if isinstance(prompt_or_messages, (list, tuple)):
        parts: List[str] = []
        for msg in prompt_or_messages:
            if not isinstance(msg, dict):
                parts.append(str(msg))
                continue
            role = str(msg.get("role", "user"))
            content = msg.get("content", "")
            if role == "system":
                parts.append("System: %s" % content)
            else:
                parts.append("%s: %s" % (role.capitalize(), content))
        parts.append("Assistant:")
        return "\n".join(parts)
    return str(prompt_or_messages)


class SidecarClient:
    """POST /completion sul llama-server locale (127.0.0.1)."""

    def __init__(self, port=None, server=None, auto_start: bool = True,
                 timeout: float = CONNECTION_TIMEOUT, spec: Optional[Dict[str, Any]] = None):
        self.timeout = timeout
        self._explicit_port = int(port) if port else None
        self._server = server
        self._auto_start = bool(auto_start)
        # R13 (contratto TELEM): aggiornato DOPO ogni completamento.
        #   timings     : dict raw 'timings' dalla risposta llama-server ({} se assente)
        #   acceptance  : float 0-1 se derivabile dalle timings, altrimenti None
        #   draft_active: True se la richiesta ha girato con modello draft caricato
        #   ts          : epoch del completamento
        # Il ritorno di complete() resta SEMPRE str (backward-compat).
        self.last_meta: Dict[str, Any] = {
            "timings": {},
            "acceptance": None,
            "draft_active": False,
            "ts": 0.0,
        }
        # override test/dryrun dei flag spec.* (None = legge config reale)
        self._spec = dict(spec) if isinstance(spec, dict) else None
        # R16 B1: True se /v1/chat/completions ha fallito e si e' usato il
        # path legacy /completion con la stringa (dichiarato nei report)
        self.last_chat_fallback = False

    # ----------------------------------------------------------- porta/avvio

    @property
    def port(self) -> Optional[int]:
        if self._explicit_port:
            return self._explicit_port
        server = self._server
        if server is None:
            return None
        try:
            return int(getattr(server, "port", 0) or 0) or None
        except Exception:
            return None

    def _default_server(self):
        from .server import get_server  # importo pigro: evita cicli
        return get_server()

    # ------------------------------------------------------- R13: draft

    def _spec_flags(self) -> Dict[str, Any]:
        """Flag spec.* dal config reale (o dall'override iniettato)."""
        if self._spec is not None:
            return self._spec
        try:
            from data.config_manager import ConfigManager
            return ConfigManager().get_config()
        except Exception:
            return {}

    def want_draft(self, profile: str = "fast", classe: str = "standard",
                   draft: Optional[bool] = None) -> bool:
        """True SOLO per lungo (long-form): F10/F13 e classi/profili think, W2.

        Regola (R13 S3):
          - spec.draft_model vuoto/inesistente      -> False
          - spec.draft_longform False               -> False (draft disabilitato)
          - profile == 'think' OR classe == 'think' -> True  (long-form)
          - tutto il resto (micro/standard/tool)    -> False
        `draft` esplicito (True/False) prevale sui flag (uso misure/test).
        """
        if draft is not None:
            return bool(draft)
        cfg = self._spec_flags()
        model = str(cfg.get("spec.draft_model", "") or "").strip()
        if not model or not os.path.exists(model):
            # P1b.1: n-gram draftless su LONG-FORM (esito A/B qa/p1b_ngram.json:
            # ngram-map-k d5 = 3.073x pro / 2.343x base, acceptance 1.0, output
            # identici al greedy). La chiave e' letta SOLO dalla config reale
            # (l'override `spec` dei test R13/R22 non la contiene -> il
            # comportamento storico con draft_model vuoto resta invariato).
            # Nessun costo RAM (draftless) -> nessuna guardia budget RSS.
            if bool(cfg.get("spec.ngram_longform", False)) and (
                    profile == "think" or classe == "think"):
                return True
            return False
        if not bool(cfg.get("spec.draft_longform", True)):
            return False
        if (profile == "think") or (classe == "think"):
            # R22: guardia RAM - con il pro attivo, se il RSS del server
            # supera il budget il draft viene disattivato (log esplicito).
            if not self._draft_within_budget():
                return False
            return True
        return False

    # R22: budget RAM fisso dichiarato per pro+draft+KV (MB).
    # Con spec.draft_model vuoto (default R13, verificato) il draft e'
    # gia' disabilitato dalle regole sopra: questa guardia copre il caso
    # in cui un draft venga configurato CON il modello pro attivo.
    # R25 CHURCH (R3.5): ricalcolo dichiarato su RSS PRO reale misurato
    # (tools/_r24_rss_probe.py -> qa/r25_church_rss.json, tabella in
    # qa/r25_church_report.md): RSS plateau baseline R25 = 4435.1 MB.
    # Range osservato 4435-4471 MB (R25 probe 4435.1, R24 4435.9,
    # dichiarato prompt 4471 -> variabilita ~0.8% per campionamento/
    # thread/OS; stessa procedura, stesso ordine di grandezza).
    # Ricalcolo col valore dichiarato peggiore: 4471 + margine 1500 MB
    # (draft mappato + overhead processo) = 5971 MB; con la misura R25:
    # 4435.1 + 1500 = 5935.1 MB.
    # Copertura: budget 6144.0 copre ricalcolo -> valore INVARIATO 6144.0
    # (margine 173 MB sul worst case 5971; contratto R22:
    # tests/testR22_models.py test_budget_dichiarato_6gb fissa 6144.0;
    # 6144 resta il budget dichiarato che copre RSS+1500 con margine).
    DRAFT_RAM_BUDGET_MB = 6144.0

    def _active_model_key(self) -> str:
        """R22: chiave del modello attivo ('pro'/'base').

        Legge local_model_key dal config reale (o dall'override iniettato
        `_spec`, usato dai test); fallback: path che contiene
        spark-x2.6-4b.gguf -> 'pro'."""
        cfg = self._spec_flags()
        key = str(cfg.get("local_model_key", "") or "").strip()
        if key in ("pro", "base"):
            return key
        path = str(cfg.get("local_model_path", "") or "").strip()
        if "spark-x2.6-4b" in path.lower().replace("\\", "/"):
            return "pro"
        return "base"

    def _draft_within_budget(self) -> bool:
        """R22: False se il modello pro e' attivo ed il RSS del processo
        llama-server supera DRAFT_RAM_BUDGET_MB -> draft disattivato con
        log 'draft disattivato: budget RAM superato'. Server non avviato
        o psutil assente (rss None) -> non bloccare (True)."""
        if self._active_model_key() != "pro":
            return True
        srv = self._server
        if srv is None:
            try:
                srv = self._default_server()
            except Exception:
                return True
        rss = None
        getter = getattr(srv, "rss_mb", None)
        if callable(getter):
            try:
                rss = getter()
            except Exception:
                rss = None
        if rss is None:
            return True
        if float(rss) > self.DRAFT_RAM_BUDGET_MB:
            print("[models] draft disattivato: budget RAM superato "
                  "(RSS %.0f MB > %.0f MB, modello pro attivo)"
                  % (float(rss), self.DRAFT_RAM_BUDGET_MB))
            return False
        return True

    @staticmethod
    def _acceptance_from(timings: Any) -> Optional[float]:
        """Deriva acceptance 0-1 dalle timings di llama-server, se presente.

        Cerca coppie note (draft_n / draft_n_accepted e varianti); se il
        server non espone un dato interpretabile -> None (NON inventato).
        """
        if not isinstance(timings, dict):
            return None
        try:
            accepted = timings.get("draft_n_accepted", timings.get("n_accepted"))
            drafted = timings.get("draft_n")
            if accepted is None or drafted is None:
                return None
            drafted = float(drafted)
            if drafted <= 0:
                return None
            acc = float(accepted) / drafted
            return max(0.0, min(1.0, acc))
        except (TypeError, ValueError):
            return None

    def _publish_meta(self, timings: Any, want_draft: bool) -> None:
        """Aggiorna self.last_meta dopo un completamento (contratto TELEM)."""
        t = timings if isinstance(timings, dict) else {}
        draft_active = bool(want_draft)
        srv = self._server
        if srv is not None:
            mode = getattr(srv, "draft_mode", None)
            if mode is not None:
                draft_active = bool(want_draft) and bool(mode)
        self.last_meta = {
            "timings": t,
            "acceptance": self._acceptance_from(t),
            "draft_active": draft_active,
            "ts": time.time(),
        }

    def _ensure_server(self, want_draft: bool = False) -> None:
        """Porta esplicita -> nessun avvio; altrimenti avvia on-demand.

        `want_draft`: la modalita' draft (long-form) viene richiesta al
        SidecarServer, che ricarica con/-senza -md se la modalita' corrente
        non coincide (micro/standard partono sempre senza draft).
        """
        if self._explicit_port is not None:
            if self._server is not None:
                try:
                    self._server.touch_job()
                except Exception:
                    pass
            return
        if self._server is None:
            try:
                self._server = self._default_server()
            except Exception as exc:
                raise AiUnavailable("AI non disponibile") from exc
        if self._auto_start:
            try:
                self._server.start_on_demand(draft=want_draft)
            except TypeError:
                # server finto/vecchio senza il parametro (test/back-compat)
                try:
                    self._server.start_on_demand()
                except Exception:
                    pass
            except Exception:
                pass  # stato down gestito dal controllo porta sotto
        try:
            self._server.touch_job()
        except Exception:
            pass
        if not self.port:
            raise AiUnavailable("AI non disponibile")

    # ------------------------------------------------------------- API

    def complete(self, prompt_or_messages, profile: str = "fast",
                 classe: str = "standard", stream: bool = False,
                 draft: Optional[bool] = None,
                 max_tokens: Optional[int] = None,
                 thinking: Optional[bool] = None):
        """Ritorna il testo completo, oppure (stream=True) un generatore.

        Solleva AiUnavailable('AI non disponibile') su errore connessione/stream.

        R13: draft (default None) esplicita la modalita' speculativa di
        questa richiesta; None -> calcolata da want_draft(profile, classe).
        In questa build il draft e' un flag di AVVIO del server: se la
        modalita' corrente non coincide, _ensure_server fa riavviare il
        SidecarServer con/-senza --model-draft. Dopo ogni completamento
        riuscito last_meta viene aggiornato (timings/acceptance/draft_active/ts).
        """
        wd = self.want_draft(profile, classe, draft)
        self._ensure_server(wd)
        port = self.port
        if not port:
            raise AiUnavailable("AI non disponibile")

        prof = get_profile(profile)
        # R22: con il modello PRO attivo il profilo fast riceve gli
        # override della card Spark-X2.6-4B (temp 1.0, top_p 0.95,
        # top_k -1, repetition_penalty 1); base/think/tool invariati.
        prof = apply_model_sampling(prof, profile, self._active_model_key())
        # R18: override esplicito (chat: nessun'amputazione; il clamp
        # storico 600 resta per i caller che non passano max_tokens)
        n_predict = (int(max_tokens) if max_tokens
                     else int(clamp_max_tokens(profile, classe)))

        # R16 B1 1.1: messages (lista) -> /v1/chat/completions con chat
        # template del GGUF applicato dal server (fix TEMPLATE-LEAK F0).
        # Stringa -> path legacy /completion INVARIATO (test storici).
        if isinstance(prompt_or_messages, (list, tuple)):
            try:
                return self._complete_chat(
                    prompt_or_messages, prof, n_predict, stream, port, wd,
                    profile=profile, classe=classe, thinking=thinking)
            except AiUnavailable:
                raise
            except _ChatEndpointError as exc:
                # endpoint chat non disponibile/risposta inattesa: fallback
                # dichiarato al path storico (la guardia output B1 intercetta
                # un eventuale leak del path legacy)
                self.last_chat_fallback = True
                print("[SidecarClient] chat endpoint KO (%s): fallback "
                      "/completion legacy" % exc)

        body: Dict[str, Any] = {
            "prompt": _messages_to_prompt(prompt_or_messages),
            "n_predict": n_predict,
            "temperature": float(prof.get("temp", 0.8)),
            "stream": bool(stream),
        }
        if prof.get("top_p") is not None:
            body["top_p"] = float(prof.get("top_p"))
        # R22: extra sampling dichiarati dalla card (solo presenti nel
        # profilo -> nessun cambiamento per i profili base)
        if prof.get("top_k") is not None:
            body["top_k"] = int(prof["top_k"])
        if prof.get("repetition_penalty") is not None:
            body["repetition_penalty"] = float(prof["repetition_penalty"])
        stop = prof.get("stop")
        if stop:
            body["stop"] = list(stop)

        req = urllib.request.Request(
            "http://127.0.0.1:%d/completion" % int(port),
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        if stream:
            try:
                resp = urllib.request.urlopen(req, timeout=self.timeout)
            except Exception as exc:
                raise AiUnavailable("AI non disponibile") from exc
            return self._iter_stream(resp, wd)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
            parsed = json.loads(raw.decode("utf-8", "replace"))
            if isinstance(parsed, dict):
                if parsed.get("error"):
                    raise AiUnavailable("AI non disponibile")
                self._publish_meta(parsed.get("timings"), wd)
                return str(parsed.get("content", "") or "")
            self._publish_meta(None, wd)
            return str(parsed)
        except AiUnavailable:
            raise
        except Exception as exc:
            raise AiUnavailable("AI non disponibile") from exc

    # ------------------------------------------- R16: chat completions
    def _complete_chat(self, messages, prof: dict, n_predict: int,
                       stream: bool, port: int, want_draft: bool = False,
                       profile: str = "fast", classe: str = "standard",
                       thinking: Optional[bool] = None):
        """POST /v1/chat/completions (messages) - chat-template applicato.

        Solleva _ChatEndpointError sugli errori DI RICHIESTA (il caller
        completa con il path legacy); gli errori a stream avviato restano
        AiUnavailable (nessun doppio tentativo a meta' risposta).
        """
        msgs = [{"role": str(m.get("role", "user")),
                 "content": str(m.get("content") or "")}
                for m in messages if isinstance(m, dict)]
        if not msgs:
            msgs = [{"role": "user", "content": str(messages)}]
        # R18: override esplicito (check JSON del grounding: campionamento
        # think ma reasoning OFF - con reasoning ON i 200 token finivano
        # tutti nel thinking e la risposta era VUOTA, misurato)
        if thinking is None:
            enable_thinking = (profile == "think") or (classe == "think")
        else:
            enable_thinking = bool(thinking)
        body: Dict[str, Any] = {
            "messages": msgs,
            "n_predict": int(n_predict),
            "temperature": float(prof.get("temp", 0.8)),
            "stream": bool(stream),
            # R16 SLO: sui profili non-think il thinking va disabilitato,
            # altrimenti i primi content delta arrivano SOLO a fine
            # reasoning (misurato: +13s sul primo token, qa/tmp diag R16)
            "chat_template_kwargs": {
                "enable_thinking": bool(enable_thinking)
            },
        }
        if prof.get("top_p") is not None:
            body["top_p"] = float(prof["top_p"])
        # R22: extra sampling della card Spark-X2.6-4B (solo presenti)
        if prof.get("top_k") is not None:
            body["top_k"] = int(prof["top_k"])
        if prof.get("repetition_penalty") is not None:
            body["repetition_penalty"] = float(prof["repetition_penalty"])
        stop = prof.get("stop")
        if stop:
            body["stop"] = list(stop)
        req = urllib.request.Request(
            "http://127.0.0.1:%d/v1/chat/completions" % int(port),
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        if stream:
            try:
                resp = urllib.request.urlopen(req, timeout=self.timeout)
            except Exception as exc:
                raise _ChatEndpointError(str(exc)) from exc
            return self._iter_stream_chat(resp, want_draft)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
            parsed = json.loads(raw.decode("utf-8", "replace"))
            if (not isinstance(parsed, dict) or parsed.get("error")
                    or not parsed.get("choices")):
                raise _ChatEndpointError("risposta chat inattesa")
            self._publish_meta(parsed.get("timings"), want_draft)
            msg = ((parsed.get("choices") or [{}])[0] or {}).get("message")
            if not isinstance(msg, dict):
                raise _ChatEndpointError("choices[0].message assente")
            return str(msg.get("content") or "")
        except _ChatEndpointError:
            raise
        except Exception as exc:
            raise _ChatEndpointError(str(exc)) from exc

    def _iter_stream_chat(self, resp, want_draft: bool = False):
        """Delta SSE del endpoint chat: choices[0].delta.content."""
        timings = None
        try:
            for raw in resp:
                parsed = parse_sse_line(raw)
                if not parsed:
                    continue
                if parsed.get("error"):
                    raise AiUnavailable("AI non disponibile")
                if isinstance(parsed.get("timings"), dict):
                    timings = parsed["timings"]
                if parsed.get("done"):
                    self._publish_meta(timings, want_draft)
                    break
                choices = parsed.get("choices") or []
                if choices:
                    ch = choices[0] or {}
                    delta = ch.get("delta") or {}
                    content = delta.get("content")
                    if (not content and isinstance(ch.get("message"), dict)):
                        content = ch["message"].get("content")
                    if content:
                        yield str(content)
                    if ch.get("finish_reason"):
                        self._publish_meta(timings, want_draft)
                        break
            else:
                self._publish_meta(timings, want_draft)
        except AiUnavailable:
            raise
        except Exception as exc:
            raise AiUnavailable("AI non disponibile") from exc
        finally:
            try:
                resp.close()
            except Exception:
                pass

    # ----------------------------------------------------------- stream

    def _iter_stream(self, resp, want_draft: bool = False):
        """Generatore di delta SSE: yieda i frammenti 'content'."""
        timings = None
        try:
            for raw in resp:
                parsed = parse_sse_line(raw)
                if not parsed:
                    continue
                if parsed.get("error"):
                    raise AiUnavailable("AI non disponibile")
                if isinstance(parsed.get("timings"), dict):
                    timings = parsed.get("timings")
                if parsed.get("done"):
                    self._publish_meta(timings, want_draft)
                    break
                content = parsed.get("content")
                if content:
                    yield str(content)
            else:
                # stream chiuso senza [DONE]: meta comunque pubblicato
                self._publish_meta(timings, want_draft)
        except AiUnavailable:
            raise
        except Exception as exc:
            raise AiUnavailable("AI non disponibile") from exc
        finally:
            try:
                resp.close()
            except Exception:
                pass
