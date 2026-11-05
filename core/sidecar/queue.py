"""Coda a priorita' per i job AI - modulo stdlib puro.

Priorita':
  0 = interattivo (servito per primo)
  1 = decomposizione
  2 = worker (estratto SOLO se non ci sono job pending di prio <= 1)

Un singolo worker thread estrae SEMPRE il job con priorita' minore
(0 > 1 > 2); a parita' di priorita' vale l'ordine FIFO (tie-break su seq).
"""

from __future__ import annotations

import threading

__all__ = ["PrioritaJob", "CodaPriorita"]

PRIORITA_VALIDE = (0, 1, 2)


class PrioritaJob:
    """Singolo job della coda a priorita'."""

    __slots__ = ("job_id", "prio", "seq", "payload", "callback", "future",
                 "exception", "done")

    def __init__(self, job_id, prio, seq, payload, callback=None, future=None):
        self.job_id = job_id
        self.prio = prio
        self.seq = seq
        self.payload = payload
        self.callback = callback
        self.future = future
        self.exception = None
        self.done = False

    @property
    def chiave(self):
        """Ordinamento: priorita' minore prima, poi FIFO su seq."""
        return (self.prio, self.seq)

    def __repr__(self):
        return "PrioritaJob(id=%r, prio=%r, seq=%r)" % (self.job_id, self.prio, self.seq)


class CodaPriorita:
    """Coda a priorita' con worker thread unico (list + Condition)."""

    def __init__(self):
        self._cond = threading.Condition()
        self._pending = []       # list[PrioritaJob] in attesa
        self._running = None     # PrioritaJob in esecuzione oppure None
        self._closed = False
        self._seq = 0            # contatore tie-break FIFO
        self._next_id = 0        # contatore job_id
        self._thread = threading.Thread(
            target=self._loop, name="coda-priorita-worker", daemon=True
        )
        self._thread.start()

    # ------------------------------------------------------------------ API

    def submit(self, payload, prio=0, callback=None, future=None):
        """Accoda un job e ritorna il suo job_id.

        Dopo stop() solleva RuntimeError('AI non disponibile').
        """
        if prio not in PRIORITA_VALIDE:
            raise ValueError("priorita' non valida: %r (attese 0, 1, 2)" % (prio,))
        with self._cond:
            if self._closed:
                raise RuntimeError("AI non disponibile")
            self._next_id += 1
            self._seq += 1
            job = PrioritaJob(self._next_id, prio, self._seq, payload,
                              callback=callback, future=future)
            self._pending.append(job)
            self._cond.notify_all()
            return job.job_id

    def stato(self):
        """Ritorna {running, queued, by_priority: {0:n, 1:n, 2:n}}."""
        with self._cond:
            by_priority = {0: 0, 1: 0, 2: 0}
            for job in self._pending:
                by_priority[job.prio] += 1
            return {
                "running": self._running is not None,
                "queued": len(self._pending),
                "by_priority": by_priority,
            }

    def stop(self, timeout=2.0):
        """Chiude la coda: purge dei pending e pulizia del thread worker."""
        with self._cond:
            self._closed = True
            self._pending.clear()
            self._cond.notify_all()
        if self._thread.is_alive():
            self._thread.join(timeout)

    @property
    def closed(self):
        with self._cond:
            return self._closed

    # -------------------------------------------------------------- worker

    def _estrai(self):
        """Scelte: prio 0 > 1 > 2, FIFO a parita'; prio2 solo se nessun
        pending di prio <= 1."""
        for p in (0, 1, 2):
            candidati = [j for j in self._pending if j.prio == p]
            if candidati:
                if p == 2 and any(j.prio <= 1 for j in self._pending):
                    return None  # difensivo: mai estrarre prio2 con prio<=1 pending
                return min(candidati, key=lambda j: j.seq)
        return None

    def _loop(self):
        while True:
            with self._cond:
                while True:
                    if self._closed:
                        return
                    job = self._estrai()
                    if job is not None:
                        self._pending.remove(job)
                        self._running = job
                        break
                    self._cond.wait()
            self._esegui(job)
            with self._cond:
                job.done = True
                self._running = None
                self._cond.notify_all()

    def _esegui(self, job):
        """Esegue callback(payload) e/o consegna il risultato al future."""
        try:
            if job.callback is not None:
                job.callback(job.payload)
            fut = job.future
            if fut is not None:
                if hasattr(fut, "set_result"):
                    fut.set_result(job.payload)
                elif hasattr(fut, "put"):
                    fut.put(job.payload)
        except Exception as exc:  # errore del job, non del worker
            job.exception = exc
            fut = job.future
            if fut is not None and hasattr(fut, "set_exception"):
                try:
                    fut.set_exception(exc)
                except Exception:
                    pass
