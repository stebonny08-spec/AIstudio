"""WorkerRunner - collega i worker offline alla CodaPriorita (prio 2).

Ogni worker e' UNA funzione (niente thread propri): il runner la sottopone
alla CodaPriorita con prio=2 (priorita' MINIMA), cosi' i job interattivi
(prio 0) vengono sempre serviti prima - i worker NON degradano la latenza
interattiva (test: test_01_priorita_worker_non_degrada_interattivo).

API:
- submit_all(coda, llm_fn, embed_fn, work_items) -> lista job prio2
- run_sync(coda, llm_fn, embed_fn, work_items, ...) -> attesa completamento
- snapshot([worker_id]) -> {worker, done, total, running, paused}
- pause() / resume() -> stato 'paused' esposto nello snapshot

Iniezioni: llm_fn(prompt, profile='fast', classe='micro') -> str e
embed_fn(text) -> list[float]. Nessun import di SidecarClient (decoupling).
"""

from __future__ import annotations

import time

from .base import BaseWorker
from .w1_contextualizer import W1Contextualizer
from .w2_summarizer import W2SectionSummarizer
from .w3_flashcards import W3FlashcardPregenerator
from .w4_paraphraser import W4Paraphraser
from .w5_dedup import W5Dedup
from .w6_maintenance import W6Maintenance

__all__ = ["WorkerRunner"]

PRIORA_WORKER = 2  # priorita' minima della coda


class WorkerRunner:
    """Crea/riusa i worker, li sottopone alla coda a prio 2 e espone la
    progress UI (snapshot) + il resume (checkpoint nei worker)."""

    WORKERS = {
        "w1": W1Contextualizer,
        "w2": W2SectionSummarizer,
        "w3": W3FlashcardPregenerator,
        "w4": W4Paraphraser,
        "w5": W5Dedup,
        "w6": W6Maintenance,
    }

    def __init__(self, state_dir=None, persist=True, progress_callback=None):
        self.state_dir = state_dir
        self.persist = persist
        self._progress = progress_callback
        self.workers = {}
        self.jobs = []            # records di tutti i job sottomessi
        self.execution_log = []   # ordine di esecuzione (worker id)
        self.results = {}         # worker_id -> risultati uniti
        self._paused = False

    # ------------------------------------------------------------------
    def get_worker(self, wid, llm_fn=None, embed_fn=None):
        """Worker singleton per id (mantiene il checkpoint tra le esecuzioni)."""
        worker = self.workers.get(wid)
        if worker is None:
            cls = self.WORKERS.get(wid)
            if cls is None:
                raise KeyError("worker sconosciuto: %r" % (wid,))
            worker = cls(
                llm_fn=llm_fn,
                embed_fn=embed_fn,
                state_dir=self.state_dir,
                progress_callback=self._progress,
                persist=self.persist,
            )
            worker.paused = self._paused
            self.workers[wid] = worker
        else:
            if llm_fn is not None:
                worker.llm_fn = llm_fn
            if embed_fn is not None:
                worker.embed_fn = embed_fn
        return worker

    @staticmethod
    def _normalize(work_items):
        """Accetta {worker_id: items} oppure lista di (worker_id, items)."""
        if isinstance(work_items, dict):
            return [(k, list(v)) for k, v in work_items.items() if v is not None]
        if isinstance(work_items, (list, tuple)):
            out = []
            for entry in work_items:
                if (isinstance(entry, (list, tuple)) and len(entry) == 2
                        and isinstance(entry[0], str)):
                    out.append((entry[0], list(entry[1])))
                else:
                    raise TypeError(
                        "work_items: attesi (worker_id, items), visto %r"
                        % (entry,))
            return out
        raise TypeError("work_items deve essere dict o lista di coppie")

    # ------------------------------------------------------------------
    def _merge(self, wid, results):
        if not results:
            return
        current = self.results.get(wid)
        if current is None:
            current = [] if isinstance(results, list) else {}
            self.results[wid] = current
        if isinstance(current, dict) and isinstance(results, dict):
            current.update(results)
        elif isinstance(current, list) and isinstance(results, list):
            current.extend(results)

    def _make_callback(self, worker, record, ctx):
        def _callback(payload):
            # chiamato dal thread della CodaPriorita; execute non solleva
            self.execution_log.append(worker.id)
            status, results, error = worker.execute(payload, ctx)
            record["status"] = status
            record["results"] = results
            record["error"] = error
            self._merge(worker.id, results)
        return _callback

    # ------------------------------------------------------------------
    def submit_all(self, coda, llm_fn=None, embed_fn=None, work_items=None,
                   ctx=None):
        """Sottomette tutti i batch come job prio=2 e ritorna i record.

        Ogni record: {job_id, worker, prio, batch, n_items, status, results,
        error}; status parte a 'pending' e diventa 'done'/'failed'/'paused'.
        Gli item gia' nel checkpoint (resume) vengono filtrati: nessun
        doppio lavoro.
        """
        records = []
        for wid, items in self._normalize(work_items):
            worker = self.get_worker(wid, llm_fn=llm_fn, embed_fn=embed_fn)
            worker.paused = self._paused
            pending = worker.filter_pending(items)
            if not pending:
                continue
            worker.begin_run(len(pending))
            bs = max(1, int(worker.batch_size or 1))
            for bi in range(0, len(pending), bs):
                batch = pending[bi:bi + bs]
                record = {
                    "job_id": None,
                    "worker": wid,
                    "prio": PRIORA_WORKER,
                    "batch": bi // bs,
                    "n_items": len(batch),
                    "status": "pending",
                    "results": None,
                    "error": None,
                }
                self.jobs.append(record)
                job_id = coda.submit(batch, prio=PRIORA_WORKER,
                                     callback=self._make_callback(
                                         worker, record, ctx))
                record["job_id"] = job_id
                records.append(record)
        return records

    def run_sync(self, coda, llm_fn=None, embed_fn=None, work_items=None,
                 ctx=None, timeout=60.0):
        """submit_all + attesa che tutti i job siano terminati (per test)."""
        records = self.submit_all(coda, llm_fn=llm_fn, embed_fn=embed_fn,
                                  work_items=work_items, ctx=ctx)
        deadline = time.time() + timeout
        while time.time() < deadline:
            if all(r["status"] != "pending" for r in records):
                break
            time.sleep(0.005)
        statuses = {}
        for r in records:
            statuses.setdefault(r["worker"], []).append(r["status"])
        return {
            "jobs": records,
            "results": self.results,
            "statuses": statuses,
            "ok": all(r["status"] == "done" for r in records),
        }

    # ------------------------------------------------------------------
    # PROGRESS UI
    # ------------------------------------------------------------------
    def snapshot(self, worker_id=None):
        """{worker, done, total, running, paused} per la progress UI."""
        if worker_id is not None:
            worker = self.workers.get(worker_id)
            if worker is None:
                return {"worker": worker_id, "done": 0, "total": 0,
                        "running": False, "paused": bool(self._paused)}
            snap = worker.snapshot()
            snap["paused"] = bool(self._paused or worker.paused)
            return snap
        if not self.workers:
            return {"worker": "", "done": 0, "total": 0,
                    "running": False, "paused": bool(self._paused)}
        if len(self.workers) == 1:
            worker = next(iter(self.workers.values()))
            snap = worker.snapshot()
            snap["paused"] = bool(self._paused or worker.paused)
            return snap
        done = 0
        total = 0
        running = False
        paused = bool(self._paused)
        for worker in self.workers.values():
            done += worker.done
            total += worker.total
            running = running or worker.running
            paused = paused or worker.paused
        return {
            "worker": ",".join(sorted(self.workers)),
            "done": done,
            "total": total,
            "running": running,
            "paused": paused,
        }

    def pause(self):
        self._paused = True
        for worker in self.workers.values():
            worker.paused = True

    def resume(self):
        self._paused = False
        for worker in self.workers.values():
            worker.paused = False
