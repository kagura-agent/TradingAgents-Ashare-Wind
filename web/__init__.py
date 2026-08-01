"""TradingAgents Web UI backend.

Split into narrow, individually testable pieces:

* :mod:`web.events`  — pure state-machine turning LangGraph snapshots into events
* :mod:`web.jobs`    — thread-safe job registry and WebSocket fan-out
* :mod:`web.store`   — SQLite persistence of finished runs
* :mod:`web.runner`  — graph orchestration on a worker thread
* :mod:`web.demo`    — scripted replay used for UI work without burning API quota
* :mod:`web.server`  — FastAPI routes

Nothing is imported here: ``web.server`` needs FastAPI, which is an optional
extra (``pip install "tradingagents[web]"``), and the other modules must stay
importable without it.
"""
