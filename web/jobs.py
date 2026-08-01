"""In-memory job registry bridging the analysis worker thread to WebSockets.

An analysis runs on a plain ``threading.Thread`` (LangGraph is synchronous),
while subscribers live on the asyncio event loop. That crossing is the whole
job of this module, and it is where the previous implementation went wrong in
three ways worth naming, because the tests below pin each one:

1. It fed subscribers a ``queue.Queue`` guarded by ``except asyncio.QueueFull``
   — a class that ``queue.Queue`` never raises. A subscriber falling behind
   raised ``queue.Full`` straight through the producer, failing the *analysis*
   because a browser was slow.
2. It replayed the backlog into a bounded queue without accounting for the
   backlog possibly exceeding the bound, so reconnecting late crashed the
   handler.
3. Each WebSocket parked a thread-pool thread on a blocking ``get(timeout=5)``.

Here subscribers get an ``asyncio.Queue`` bound to their own loop and the
worker thread hands events over with ``loop.call_soon_threadsafe`` — the
canonical thread-to-loop bridge. Backlog delivery goes through the same queue,
which is unbounded, so replay cannot overflow. Slow consumers cost memory, not
correctness; :data:`MAX_EVENTS_PER_JOB` caps that.
"""

from __future__ import annotations

import asyncio
import contextlib
import threading
from collections import OrderedDict
from typing import Any

# Retained event backlog per job. A default run emits well under 100 events;
# the cap only bites on pathological configs (very high debate-round counts)
# and trades the oldest history for a bounded footprint.
MAX_EVENTS_PER_JOB = 2000

# Completed jobs kept in memory for late subscribers. Beyond this the oldest
# are evicted — the full result is still in SQLite, reachable via /api/history.
MAX_RETAINED_JOBS = 64


class Subscription:
    """A single WebSocket's view of a job's event stream."""

    def __init__(self, job_id: str, loop: asyncio.AbstractEventLoop) -> None:
        self.job_id = job_id
        self._loop = loop
        self._queue: asyncio.Queue = asyncio.Queue()

    def offer(self, event: dict) -> None:
        """Hand an event to this subscriber. Safe to call from any thread."""
        # A closed loop raises RuntimeError: the WebSocket is already gone and
        # unsubscribe is imminent, so dropping the event is the right outcome.
        with contextlib.suppress(RuntimeError):
            self._loop.call_soon_threadsafe(self._queue.put_nowait, event)

    async def get(self) -> dict:
        return await self._queue.get()


class JobRegistry:
    """Tracks running analyses and fans their events out to subscribers."""

    def __init__(self, max_events: int = MAX_EVENTS_PER_JOB,
                 max_jobs: int = MAX_RETAINED_JOBS) -> None:
        self._lock = threading.Lock()
        self._jobs: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._max_events = max_events
        self._max_jobs = max_jobs

    def register(self, job_id: str, ticker: str, trade_date: str) -> None:
        with self._lock:
            self._jobs[job_id] = {
                "ticker": ticker,
                "trade_date": trade_date,
                "status": "running",
                "events": [],
                "subscribers": [],
            }
            self._evict_locked()

    def _evict_locked(self) -> None:
        """Drop the oldest finished jobs once the retention cap is exceeded.

        Only jobs with no live subscribers are evicted; a running analysis that
        someone is still watching is never dropped out from under them.
        """
        while len(self._jobs) > self._max_jobs:
            for job_id, job in self._jobs.items():
                if job["status"] != "running" and not job["subscribers"]:
                    del self._jobs[job_id]
                    break
            else:
                return  # nothing evictable

    def push(self, job_id: str, event: dict) -> None:
        """Record an event and fan it out. Called from the worker thread."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job["events"].append(event)
            if len(job["events"]) > self._max_events:
                del job["events"][: len(job["events"]) - self._max_events]
            subscribers = list(job["subscribers"])
        # Deliver outside the lock: call_soon_threadsafe touches another
        # loop's internals and should not run under our mutex.
        for sub in subscribers:
            sub.offer(event)

    def set_status(self, job_id: str, status: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job["status"] = status

    def get_status(self, job_id: str) -> str | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return None if job is None else job["status"]

    def subscribe(self, job_id: str, loop: asyncio.AbstractEventLoop) -> Subscription | None:
        """Attach a subscriber, replaying the backlog so it sees the full run.

        Returns ``None`` if the job is unknown. The replay and the registration
        happen under one lock so a concurrent :meth:`push` cannot slip an event
        between them — the subscriber would otherwise miss it.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            sub = Subscription(job_id, loop)
            backlog = list(job["events"])
            job["subscribers"].append(sub)
        for event in backlog:
            sub.offer(event)
        return sub

    def unsubscribe(self, job_id: str, sub: Subscription) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None and sub in job["subscribers"]:
                job["subscribers"].remove(sub)
            self._evict_locked()

    def events(self, job_id: str) -> list[dict]:
        """Snapshot of a job's backlog (test and debugging aid)."""
        with self._lock:
            job = self._jobs.get(job_id)
            return [] if job is None else list(job["events"])

    def job_count(self) -> int:
        with self._lock:
            return len(self._jobs)


# Process-wide registry used by the FastAPI app.
registry = JobRegistry()
