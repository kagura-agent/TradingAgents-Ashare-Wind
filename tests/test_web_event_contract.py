"""The Python/TypeScript contract for the analysis stream.

Nothing in the toolchain connects ``web/events.py`` to the frontend's type
definitions: the wire format is JSON, so a rename on one side simply produces
events the other side quietly ignores. F2 in the rebuild plan was exactly that
failure — the old UI classified decisions on a four-tier scale of its own while
the backend sent five — and it shipped because no test compared the two.

These tests parse the TypeScript literally. That keeps them honest (no
generated file to fall out of date) at the cost of requiring the arrays stay
plain literal lists; the source files carry comments saying so.
"""

import json
import re
from pathlib import Path

import pytest

from tradingagents.agents.utils.rating import RATINGS_5_TIER
from web.events import EVENT_TYPES, NODE_LABELS, REPORT_KEYS, TIMELINE_NODES

FRONTEND = Path(__file__).resolve().parent.parent / "web" / "frontend" / "src"

pytestmark = pytest.mark.skipif(
    not FRONTEND.is_dir(),
    reason="frontend sources not present (source-only checkout of web/)",
)


def _read(relative: str) -> str:
    return (FRONTEND / relative).read_text(encoding="utf-8")


def _string_array(source: str, name: str) -> list[str]:
    """Extract ``export const <name> = ['a', 'b'] as const``."""
    match = re.search(rf"export const {name} = \[(.*?)\]", source, re.DOTALL)
    assert match, f"{name} not found, or no longer a plain literal array"
    return re.findall(r"'([^']*)'", match.group(1))


def _object_array(source: str, name: str) -> list[dict]:
    """Extract an ``export const <name> ... = [{ k: 'v' }, ...]`` literal."""
    match = re.search(rf"export const {name}[^=]*= \[(.*?)\n\]", source, re.DOTALL)
    assert match, f"{name} not found, or no longer a plain literal array"
    entries = []
    for line in match.group(1).splitlines():
        line = line.strip().rstrip(",")
        if not line.startswith("{"):
            continue
        # `{ node: 'x', label: 'y' }` -> JSON, then parse.
        as_json = re.sub(r"(\w+):", r'"\1":', line).replace("'", '"')
        entries.append(json.loads(as_json))
    return entries


def _record_literal(source: str, name: str) -> dict[str, str]:
    """Extract ``export const <name>: Record<...> = { A: 'a', ... }``."""
    match = re.search(rf"export const {name}[^=]*= \{{(.*?)\n\}}", source, re.DOTALL)
    assert match, f"{name} not found, or no longer a plain object literal"
    pairs = re.findall(r"^\s*'?([\w ]+?)'?:\s*'([^']*)',", match.group(1), re.MULTILINE)
    return dict(pairs)


# ---------------------------------------------------------------------------
# Event types
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_event_types_match():
    ts = _string_array(_read("types/events.ts"), "EVENT_TYPES")

    assert ts == list(EVENT_TYPES)


@pytest.mark.unit
def test_every_event_type_has_a_member_in_the_union():
    source = _read("types/events.ts")
    union = re.search(r"export type AnalysisEvent =(.*?)\n\n", source, re.DOTALL)
    assert union, "AnalysisEvent union not found"
    members = re.findall(r"\| (\w+)", union.group(1))

    # Each union member is an interface whose `type` field is one of EVENT_TYPES.
    discriminants = []
    for member in members:
        body = re.search(rf"export interface {member} \{{(.*?)\n\}}", source, re.DOTALL)
        assert body, f"interface {member} not found"
        literal = re.search(r"type: '([^']+)'", body.group(1))
        assert literal, f"interface {member} has no literal `type` field"
        discriminants.append(literal.group(1))

    assert discriminants == list(EVENT_TYPES)


@pytest.mark.unit
def test_ping_is_not_an_analysis_event():
    source = _read("types/events.ts")

    # The keepalive is transport-level; treating it as an analysis event would
    # shift the replay index the reducer relies on.
    assert "ping" not in EVENT_TYPES
    assert "ping" not in _string_array(source, "EVENT_TYPES")
    assert re.search(r"export interface PingEvent \{\s*type: 'ping'", source)


# ---------------------------------------------------------------------------
# Timeline nodes and labels
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_timeline_nodes_match_in_order():
    ts = _object_array(_read("lib/nodes.ts"), "TIMELINE_NODES")

    assert [n["node"] for n in ts] == list(TIMELINE_NODES)


@pytest.mark.unit
def test_timeline_labels_match():
    ts = _object_array(_read("lib/nodes.ts"), "TIMELINE_NODES")

    assert {n["node"]: n["label"] for n in ts} == NODE_LABELS


@pytest.mark.unit
def test_python_labels_cover_exactly_the_timeline():
    # Internal consistency, which the frontend comparison above then inherits.
    assert set(NODE_LABELS) == set(TIMELINE_NODES)


@pytest.mark.unit
def test_report_sections_match_report_keys_in_order():
    ts = _object_array(_read("lib/nodes.ts"), "REPORT_SECTIONS")

    assert [s["key"] for s in ts] == list(REPORT_KEYS)


@pytest.mark.unit
def test_report_section_titles_are_distinct():
    ts = _object_array(_read("lib/nodes.ts"), "REPORT_SECTIONS")
    titles = [s["title"] for s in ts]

    assert len(set(titles)) == len(titles)


@pytest.mark.unit
def test_every_stage_used_by_the_timeline_has_a_label():
    source = _read("lib/nodes.ts")
    stages = {n["stage"] for n in _object_array(source, "TIMELINE_NODES")}

    assert stages <= set(_record_literal(source, "STAGE_LABELS"))


# ---------------------------------------------------------------------------
# Rating vocabulary
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_rating_scale_matches():
    source = _read("lib/rating.ts")

    assert _string_array(source, "RATINGS_5_TIER") == list(RATINGS_5_TIER)


@pytest.mark.unit
def test_every_rating_has_a_label_and_a_tone():
    source = _read("lib/rating.ts")

    assert list(_record_literal(source, "RATING_LABELS")) == list(RATINGS_5_TIER)
    assert list(_record_literal(source, "RATING_TONE")) == list(RATINGS_5_TIER)


# ---------------------------------------------------------------------------
# The demo fixture, which the frontend is developed against
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_demo_signal_is_a_valid_rating():
    from web.demo import DEMO_SIGNAL

    assert DEMO_SIGNAL in RATINGS_5_TIER


@pytest.mark.unit
def test_parsers_reject_a_non_literal_array():
    # If someone rewrites EVENT_TYPES as a computed value, the helper must fail
    # loudly rather than silently compare an empty list.
    with pytest.raises(AssertionError):
        _string_array("export const EVENT_TYPES = buildTypes()", "EVENT_TYPES")


@pytest.mark.unit
def test_ts_sources_name_the_python_module_they_mirror():
    # A cheap guard that the cross-references in the comments survive edits.
    assert "web/events.py" in _read("types/events.ts")
    assert "web/events.py" in _read("lib/nodes.ts")
    assert "rating.py" in _read("lib/rating.ts")
