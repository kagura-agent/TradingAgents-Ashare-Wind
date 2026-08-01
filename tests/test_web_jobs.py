"""Job registry: the worker-thread → event-loop bridge behind the WebSocket.

Three of these tests exist because the previous implementation got the bridge
wrong in ways that only showed up under load:

* a slow consumer raised ``queue.Full`` straight through the producer and
  failed the analysis (the handler caught ``asyncio.QueueFull``, an unrelated
  class);
* replaying the backlog into a ``maxsize=256`` queue blew up for late joiners
  once a run had emitted more than 256 events;
* eviction did not exist, so ``_jobs`` grew without bound.
"""

import asyncio
import threading

import pytest

from web.jobs import MAX_EVENTS_PER_JOB, JobRegistry, Subscription


def _run(coro):
    return asyncio.run(coro)


async def _drain(sub, count, timeout=2.0):
    return [await asyncio.wait_for(sub.get(), timeout) for _ in range(count)]


@pytest.mark.unit
def test_subscriber_receives_events_pushed_from_a_worker_thread():
    reg = JobRegistry()
    reg.register("j1", "600519.SH", "2026-07-31")

    async def scenario():
        sub = reg.subscribe("j1", asyncio.get_running_loop())
        assert sub is not None
        threading.Thread(
            target=lambda: [reg.push("j1", {"type": "report", "i": i}) for i in range(3)],
        ).start()
        return await _drain(sub, 3)

    assert [e["i"] for e in _run(scenario())] == [0, 1, 2]


@pytest.mark.unit
def test_backlog_is_replayed_to_a_late_subscriber():
    """Pins B2: replay must survive a backlog far past the old 256 bound."""
    reg = JobRegistry()
    reg.register("j1", "600519.SH", "2026-07-31")
    for i in range(500):
        reg.push("j1", {"type": "debate", "i": i})

    async def scenario():
        sub = reg.subscribe("j1", asyncio.get_running_loop())
        return await _drain(sub, 500)

    replayed = _run(scenario())
    assert [e["i"] for e in replayed] == list(range(500))


@pytest.mark.unit
def test_late_subscriber_sees_backlog_then_live_events_in_order():
    reg = JobRegistry()
    reg.register("j1", "600519.SH", "2026-07-31")
    reg.push("j1", {"i": 0})

    async def scenario():
        sub = reg.subscribe("j1", asyncio.get_running_loop())
        reg.push("j1", {"i": 1})
        return await _drain(sub, 2)

    assert [e["i"] for e in _run(scenario())] == [0, 1]


@pytest.mark.unit
def test_slow_consumer_never_raises_into_the_producer():
    """Pins B1: a browser that stops reading must not fail the analysis."""
    reg = JobRegistry()
    reg.register("j1", "600519.SH", "2026-07-31")
    errors = []

    async def scenario():
        reg.subscribe("j1", asyncio.get_running_loop())  # subscribes, never reads

        def produce():
            try:
                for i in range(5000):
                    reg.push("j1", {"i": i})
            except BaseException as exc:  # noqa: BLE001 - the whole point is to see any
                errors.append(exc)

        thread = threading.Thread(target=produce)
        thread.start()
        await asyncio.to_thread(thread.join)

    _run(scenario())
    assert errors == []


@pytest.mark.unit
def test_backlog_is_capped_dropping_the_oldest():
    reg = JobRegistry(max_events=10)
    reg.register("j1", "600519.SH", "2026-07-31")
    for i in range(25):
        reg.push("j1", {"i": i})

    kept = [e["i"] for e in reg.events("j1")]
    assert kept == list(range(15, 25))
    assert len(kept) == 10


@pytest.mark.unit
def test_default_backlog_cap_is_generous_enough_for_a_real_run():
    # A six-analyst run emits well under a hundred events; the cap is a
    # pathological-config backstop, not a routine limit.
    assert MAX_EVENTS_PER_JOB >= 1000


@pytest.mark.unit
def test_unsubscribe_stops_delivery():
    reg = JobRegistry()
    reg.register("j1", "600519.SH", "2026-07-31")

    async def scenario():
        sub = reg.subscribe("j1", asyncio.get_running_loop())
        reg.push("j1", {"i": 0})
        first = await asyncio.wait_for(sub.get(), 2.0)
        reg.unsubscribe("j1", sub)
        reg.push("j1", {"i": 1})
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(sub.get(), 0.05)
        return first

    assert _run(scenario())["i"] == 0


@pytest.mark.unit
def test_subscribing_to_an_unknown_job_returns_none():
    reg = JobRegistry()

    async def scenario():
        return reg.subscribe("nope", asyncio.get_running_loop())

    assert _run(scenario()) is None


@pytest.mark.unit
def test_pushing_to_an_unknown_job_is_a_noop():
    reg = JobRegistry()
    reg.push("nope", {"type": "report"})  # must not raise
    assert reg.events("nope") == []
    assert reg.get_status("nope") is None


@pytest.mark.unit
def test_status_round_trips():
    reg = JobRegistry()
    reg.register("j1", "600519.SH", "2026-07-31")
    assert reg.get_status("j1") == "running"
    reg.set_status("j1", "completed")
    assert reg.get_status("j1") == "completed"
    reg.set_status("nope", "completed")  # must not raise


@pytest.mark.unit
def test_finished_jobs_are_evicted_beyond_the_retention_cap():
    """Pins B7: the registry must not grow with every analysis ever run."""
    reg = JobRegistry(max_jobs=3)
    for i in range(10):
        reg.register(f"j{i}", "600519.SH", "2026-07-31")
        reg.set_status(f"j{i}", "completed")

    assert reg.job_count() <= 3
    assert reg.get_status("j9") is not None      # newest retained
    assert reg.get_status("j0") is None          # oldest evicted


@pytest.mark.unit
def test_running_jobs_are_never_evicted():
    reg = JobRegistry(max_jobs=2)
    reg.register("running", "600519.SH", "2026-07-31")   # stays "running"
    for i in range(5):
        reg.register(f"done{i}", "600519.SH", "2026-07-31")
        reg.set_status(f"done{i}", "completed")

    assert reg.get_status("running") == "running"


@pytest.mark.unit
def test_watched_jobs_are_never_evicted():
    reg = JobRegistry(max_jobs=1)

    async def scenario():
        reg.register("watched", "600519.SH", "2026-07-31")
        reg.subscribe("watched", asyncio.get_running_loop())
        reg.set_status("watched", "completed")
        for i in range(5):
            reg.register(f"j{i}", "600519.SH", "2026-07-31")
            reg.set_status(f"j{i}", "completed")
        return reg.get_status("watched")

    assert _run(scenario()) == "completed"


@pytest.mark.unit
def test_offer_on_a_closed_loop_is_dropped_not_raised():
    loop = asyncio.new_event_loop()
    sub = Subscription("j1", loop)
    loop.close()
    sub.offer({"type": "report"})  # must not raise
