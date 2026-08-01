from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
import requests
from dateutil.relativedelta import relativedelta
from stockstats import wrap

from .symbol_utils import NoMarketDataError

# Wind MCP server endpoints (JSON-RPC over HTTP)
WIND_SERVERS = {
    "stock_data": "https://mcp.wind.com.cn/vserver_stock_data/mcp/",
    "fund_data": "https://mcp.wind.com.cn/vserver_fund_data/mcp/",
    "index_data": "https://mcp.wind.com.cn/vserver_index_data/mcp/",
    "bond_data": "https://mcp.wind.com.cn/vserver_bond_data/mcp/",
    "financial_docs": "https://mcp.wind.com.cn/vserver_financial_docs/mcp/",
    "economic_data": "https://mcp.wind.com.cn/vserver_economic_data/mcp/",
    "analytics_data": "https://mcp.wind.com.cn/vserver_analytics_data/mcp/",
}

# Client version reported to Wind MCP during initialize handshake
_CLIENT_VERSION = "0.1.0"
_CLIENT_NAME = "tradingagents-python"

WIND_INDEX_CODES = {
    "000001.SH",  # 上证指数
    "000300.SH",  # 沪深300
    "000905.SH",  # 中证500
    "000852.SH",  # 中证1000
    "399001.SZ",  # 深证成指
    "399006.SZ",  # 创业板指
}

WIND_CACHE_DIR = Path(
    os.environ.get(
        "TRADINGAGENTS_WIND_CACHE_DIR",
        str(Path.cwd() / ".cache" / "wind_api"),
    )
)
WIND_CACHE_ENABLED = os.environ.get("TRADINGAGENTS_WIND_CACHE_ENABLED", "1").lower() not in {
    "0",
    "false",
    "no",
}
WIND_CACHE_TTL_SECONDS = int(os.environ.get("TRADINGAGENTS_WIND_CACHE_TTL_SECONDS", "86400"))
WIND_ERROR_CACHE_TTL_SECONDS = int(os.environ.get("TRADINGAGENTS_WIND_ERROR_CACHE_TTL_SECONDS", "21600"))
WIND_CALL_LOG = Path(
    os.environ.get(
        "TRADINGAGENTS_WIND_CALL_LOG",
        str(Path.cwd() / ".cache" / "wind_calls.jsonl"),
    )
)
_WIND_MEMORY_CACHE: dict[str, dict[str, Any]] = {}
_WIND_ERROR_MEMORY_CACHE: dict[str, str] = {}
_OHLCV_FRAME_CACHE: list[tuple[str, str, str, pd.DataFrame]] = []


def _yyyymmdd(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%Y%m%d")


def _wind_cache_key(server_type: str, tool_name: str, params: dict[str, Any]) -> str:
    payload = {
        "server_type": server_type,
        "tool_name": tool_name,
        "params": params,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _wind_cache_path(key: str) -> Path:
    return WIND_CACHE_DIR / key[:2] / f"{key}.json"


def _wind_error_cache_path(key: str) -> Path:
    return WIND_CACHE_DIR / key[:2] / f"{key}.error.json"


def _read_wind_cache(key: str) -> dict[str, Any] | None:
    if not WIND_CACHE_ENABLED:
        return None
    if key in _WIND_MEMORY_CACHE:
        return _WIND_MEMORY_CACHE[key]
    path = _wind_cache_path(key)
    if not path.exists():
        return None
    if WIND_CACHE_TTL_SECONDS > 0:
        age = time.time() - path.stat().st_mtime
        if age > WIND_CACHE_TTL_SECONDS:
            return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    _WIND_MEMORY_CACHE[key] = data
    return data


def _read_wind_error_cache(key: str) -> str | None:
    if not WIND_CACHE_ENABLED:
        return None
    if key in _WIND_ERROR_MEMORY_CACHE:
        return _WIND_ERROR_MEMORY_CACHE[key]
    path = _wind_error_cache_path(key)
    if not path.exists():
        return None
    if WIND_ERROR_CACHE_TTL_SECONDS > 0:
        age = time.time() - path.stat().st_mtime
        if age > WIND_ERROR_CACHE_TTL_SECONDS:
            return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        message = str(payload.get("error") or "")
    except Exception:
        return None
    if not message:
        return None
    _WIND_ERROR_MEMORY_CACHE[key] = message
    return message


def _write_wind_cache(key: str, data: dict[str, Any]) -> None:
    if not WIND_CACHE_ENABLED:
        return
    try:
        path = _wind_cache_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
        _WIND_MEMORY_CACHE[key] = data
    except Exception:
        _WIND_MEMORY_CACHE[key] = data


def _should_cache_wind_error(message: str) -> bool:
    upper = message.upper()
    if "NETWORK_ERROR" in upper or "RATE" in upper or "HTTP 5" in upper or "FETCH FAILED" in upper:
        return False
    return any(token in upper for token in ("QUERY_FAILED", "MARKET_TARGET_NOT_FOUND", "NO DATA", "UNKNOWN"))


def _write_wind_error_cache(key: str, message: str) -> None:
    if not WIND_CACHE_ENABLED or not _should_cache_wind_error(message):
        return
    _WIND_ERROR_MEMORY_CACHE[key] = message
    try:
        path = _wind_error_cache_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"error": message}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except Exception:
        pass


def _log_wind_call(
    server_type: str,
    tool_name: str,
    params: dict[str, Any],
    *,
    cache_hit: bool,
    ok: bool,
    error: str | None = None,
) -> None:
    try:
        WIND_CALL_LOG.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "server_type": server_type,
            "tool_name": tool_name,
            "cache_hit": cache_hit,
            "ok": ok,
            "params": params,
        }
        if error:
            record["error"] = error[:500]
        with WIND_CALL_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _get_wind_api_key() -> str:
    """Resolve Wind API key from config files or environment.

    Search order: project config.json → global config → env var.
    """
    # Project-level config.json (relative to cwd)
    project_config = Path.cwd() / ".agents" / "skills" / "wind-mcp-skill" / "config.json"
    if project_config.exists():
        try:
            cfg = json.loads(project_config.read_text(encoding="utf-8"))
            key = cfg.get("wind_api_key", "").strip()
            if key:
                return key
        except Exception:
            pass

    # Global config
    global_config = Path.home() / ".wind-aifinmarket" / "config"
    if global_config.exists():
        try:
            for line in global_config.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("#") or not line:
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if line.startswith("WIND_API_KEY="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
        except Exception:
            pass

    # Global skill config.json
    global_skill_config = Path.home() / ".agents" / "skills" / "wind-mcp-skill" / "config.json"
    if global_skill_config.exists():
        try:
            cfg = json.loads(global_skill_config.read_text(encoding="utf-8"))
            key = cfg.get("wind_api_key", "").strip()
            if key:
                return key
        except Exception:
            pass

    # Environment variable
    env_key = os.environ.get("WIND_API_KEY", "").strip()
    if env_key:
        return env_key

    raise RuntimeError(
        "WIND_API_KEY not configured. Set it in .agents/skills/wind-mcp-skill/config.json, "
        "~/.wind-aifinmarket/config, or the WIND_API_KEY environment variable."
    )


def _parse_sse_response(text: str) -> dict:
    """Parse Wind MCP response which may be SSE or plain JSON."""
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)
    # SSE format: find the last "data: " line
    last_data = None
    for line in text.split("\n"):
        if line.startswith("data: "):
            last_data = line[6:]
    if last_data:
        return json.loads(last_data)
    raise RuntimeError(f"Wind MCP response format unrecognized. First 200 chars: {text[:200]}")


def _wind_mcp_request(
    server_type: str,
    method: str,
    params: dict[str, Any],
    timeout: int = 60,
) -> dict[str, Any]:
    """Send a JSON-RPC request to a Wind MCP server."""
    endpoint = WIND_SERVERS.get(server_type)
    if not endpoint:
        raise RuntimeError(f"Unknown Wind server_type: {server_type}. Available: {list(WIND_SERVERS)}")

    api_key = _get_wind_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    body = {
        "jsonrpc": "2.0",
        "id": int(time.time() * 1000),
        "method": method,
        "params": params,
    }

    resp = requests.post(endpoint, json=body, headers=headers, timeout=timeout)
    if not resp.ok:
        raise RuntimeError(
            f"Wind MCP HTTP {resp.status_code} for {server_type}.{method}: {resp.text[:300]}"
        )

    payload = _parse_sse_response(resp.text)

    if payload.get("error"):
        msg = payload["error"].get("message") or json.dumps(payload["error"])
        raise RuntimeError(f"Wind MCP error for {server_type}.{method}: {msg}")

    return payload.get("result", {})


def _call_wind(server_type: str, tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Call a Wind MCP tool via direct HTTP (no Node.js dependency).

    Handles caching, error caching, and call logging.
    """
    cache_key = _wind_cache_key(server_type, tool_name, params)
    cached = _read_wind_cache(cache_key)
    if cached is not None:
        _log_wind_call(server_type, tool_name, params, cache_hit=True, ok=True)
        return cached
    cached_error = _read_wind_error_cache(cache_key)
    if cached_error is not None:
        _log_wind_call(server_type, tool_name, params, cache_hit=True, ok=False, error=cached_error)
        raise RuntimeError(cached_error)

    try:
        # MCP protocol: initialize handshake then tools/call
        _wind_mcp_request(server_type, "initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": _CLIENT_NAME, "version": _CLIENT_VERSION},
        }, timeout=30)

        result = _wind_mcp_request(server_type, "tools/call", {
            "name": tool_name,
            "arguments": params,
            "_meta": {"clientVersion": _CLIENT_VERSION},
        }, timeout=600)
    except Exception as exc:
        detail = str(exc)
        _write_wind_error_cache(cache_key, detail)
        _log_wind_call(server_type, tool_name, params, cache_hit=False, ok=False, error=detail)
        raise RuntimeError(detail) from exc

    # Extract result: result.content[0].text → JSON → data
    if result.get("isError"):
        detail = f"Wind MCP error for {server_type}.{tool_name}: {result}"
        _write_wind_error_cache(cache_key, detail)
        _log_wind_call(server_type, tool_name, params, cache_hit=False, ok=False, error=detail)
        raise RuntimeError(detail)

    content = result.get("content") or []
    if not content:
        raise RuntimeError(f"Wind MCP returned no content for {server_type}.{tool_name}")

    text = content[0].get("text", "")
    inner = json.loads(text)
    if inner.get("error"):
        detail = f"Wind backend error for {server_type}.{tool_name}: {inner['error']}"
        _write_wind_error_cache(cache_key, detail)
        _log_wind_call(server_type, tool_name, params, cache_hit=False, ok=False, error=str(inner["error"]))
        raise RuntimeError(detail)

    data = inner.get("data") or {}
    _write_wind_cache(cache_key, data)
    _log_wind_call(server_type, tool_name, params, cache_hit=False, ok=True)
    return data


def _table_to_frame(data: dict[str, Any]) -> pd.DataFrame:
    columns = [col["name"] for col in data.get("columns", [])]
    return pd.DataFrame(data.get("rows", []), columns=columns)


def _get_cached_ohlcv_frame(symbol: str, start_date: str, end_date: str) -> pd.DataFrame | None:
    sym = symbol.upper()
    for cached_symbol, cached_start, cached_end, frame in reversed(_OHLCV_FRAME_CACHE):
        if cached_symbol != sym:
            continue
        if cached_start <= start_date and cached_end >= end_date:
            sliced = frame[(frame["Date"] >= start_date) & (frame["Date"] <= end_date)]
            if not sliced.empty:
                return sliced.copy()
    return None


def _remember_ohlcv_frame(symbol: str, start_date: str, end_date: str, frame: pd.DataFrame) -> None:
    _OHLCV_FRAME_CACHE.append((symbol.upper(), start_date, end_date, frame.copy()))
    # Keep the cache tiny; it only needs to dedupe calls inside the current run.
    del _OHLCV_FRAME_CACHE[:-8]


def get_wind_ohlcv_frame(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    cached_frame = _get_cached_ohlcv_frame(symbol, start_date, end_date)
    if cached_frame is not None:
        _log_wind_call(
            "memory",
            "get_wind_ohlcv_frame",
            {"symbol": symbol, "start_date": start_date, "end_date": end_date},
            cache_hit=True,
            ok=True,
        )
        return cached_frame

    server_type = "index_data" if symbol.upper() in WIND_INDEX_CODES else "stock_data"
    tool_name = "get_index_kline" if server_type == "index_data" else "get_stock_kline"
    data = _call_wind(
        server_type,
        tool_name,
        {
            "windcode": symbol,
            "begin_date": _yyyymmdd(start_date),
            "end_date": _yyyymmdd(end_date),
            "period": "10",
        },
    )
    raw = _table_to_frame(data)
    if raw.empty:
        raise NoMarketDataError(symbol, symbol, f"Wind returned no rows between {start_date} and {end_date}")

    dates = pd.to_datetime(raw["TIME"], errors="coerce", utc=True).dt.tz_convert("Asia/Shanghai")
    frame = pd.DataFrame(
        {
            "Date": dates.dt.strftime("%Y-%m-%d"),
            "Open": pd.to_numeric(raw["OPEN"], errors="coerce"),
            "High": pd.to_numeric(raw["HIGH"], errors="coerce"),
            "Low": pd.to_numeric(raw["LOW"], errors="coerce"),
            "Close": pd.to_numeric(raw["MATCH"], errors="coerce"),
            "Volume": pd.to_numeric(raw["VOLUME"], errors="coerce"),
            "Turnover": pd.to_numeric(raw.get("TURNOVER"), errors="coerce"),
        }
    )
    frame = frame.dropna(subset=["Date", "Close"]).sort_values("Date")
    if frame.empty:
        raise NoMarketDataError(symbol, symbol, "Wind returned rows but no usable OHLCV values")
    _remember_ohlcv_frame(symbol, start_date, end_date, frame)
    return frame


def get_stock(
    symbol: Annotated[str, "Wind code, e.g. 600519.SH"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
) -> str:
    data = get_wind_ohlcv_frame(symbol, start_date, end_date)
    header = f"# Wind A-share stock data for {symbol} from {start_date} to {end_date}\n"
    header += f"# Total records: {len(data)}\n"
    header += f"# Data retrieved on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    return header + data.to_csv(index=False)


_INDICATOR_DESCRIPTIONS = {
    "close_50_sma": "50 SMA: medium-term trend direction and dynamic support/resistance.",
    "close_200_sma": "200 SMA: long-term trend benchmark.",
    "close_10_ema": "10 EMA: short-term momentum and trend shifts.",
    "macd": "MACD: momentum from EMA differences.",
    "macds": "MACD signal line.",
    "macdh": "MACD histogram.",
    "rsi": "RSI: overbought/oversold momentum indicator.",
    "boll": "Bollinger middle band.",
    "boll_ub": "Bollinger upper band.",
    "boll_lb": "Bollinger lower band.",
    "atr": "ATR: volatility measure for stop placement and position sizing.",
    "vwma": "VWMA: volume-weighted moving average.",
}


def get_indicator(
    symbol: Annotated[str, "Wind code, e.g. 600519.SH"],
    indicator: Annotated[str, "technical indicator name"],
    curr_date: Annotated[str, "The current trading date, YYYY-mm-dd"],
    look_back_days: Annotated[int, "how many calendar days to render"],
) -> str:
    if indicator not in _INDICATOR_DESCRIPTIONS:
        raise ValueError(f"Indicator {indicator} is not supported. Choose from: {list(_INDICATOR_DESCRIPTIONS)}")

    end_dt = datetime.strptime(curr_date, "%Y-%m-%d")
    # Fetch a wider warm-up window so moving averages have enough history.
    start_dt = end_dt - relativedelta(days=max(260, int(look_back_days) + 220))
    data = get_wind_ohlcv_frame(symbol, start_dt.strftime("%Y-%m-%d"), curr_date)
    df = wrap(data.copy())
    df["Date"] = pd.to_datetime(df["Date"]).dt.strftime("%Y-%m-%d")
    df[indicator]

    render_start = end_dt - relativedelta(days=int(look_back_days))
    recent = df[pd.to_datetime(df["Date"]) >= pd.Timestamp(render_start)]
    lines = []
    for _, row in recent.iterrows():
        value = row[indicator]
        lines.append(f"{row['Date']}: {'N/A' if pd.isna(value) else value}")

    return (
        f"## {indicator} values from {render_start.strftime('%Y-%m-%d')} to {curr_date}\n\n"
        + "\n".join(lines)
        + "\n\n"
        + _INDICATOR_DESCRIPTIONS[indicator]
    )


def _wind_nl(tool_name: str, question: str, *, tolerate_failure: bool = False) -> str:
    try:
        data = _call_wind("stock_data", tool_name, {"question": question, "lang": "zh"})
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception as exc:
        if not tolerate_failure:
            raise
        return (
            "DATA_UNAVAILABLE: Wind did not return usable data for this query. "
            f"Query: {question}. Error: {exc}. Do not fabricate missing values."
        )


def _wind_doc(
    tool_name: str,
    query: str,
    *,
    top_k: int = 10,
    as_of_date: str | None = None,
    tolerate_failure: bool = False,
) -> str:
    try:
        data = _call_wind(
            "financial_docs",
            tool_name,
            {"query": _compact_query(query), "top_k": int(top_k)},
        )
        if as_of_date:
            data = _filter_doc_data_as_of(data, as_of_date)
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception as exc:
        if not tolerate_failure:
            raise
        return (
            "DATA_UNAVAILABLE: Wind did not return usable documents for this query. "
            f"Query: {query}. Error: {exc}. Do not fabricate missing documents."
        )


def _filter_doc_data_as_of(data: dict[str, Any], as_of_date: str) -> dict[str, Any]:
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return data
    try:
        cutoff = datetime.strptime(as_of_date, "%Y-%m-%d").date()
    except ValueError:
        return data
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_date = str(item.get("date") or "")
        if not item_date:
            filtered.append(item)
            continue
        try:
            if datetime.strptime(item_date[:10], "%Y-%m-%d").date() <= cutoff:
                filtered.append(item)
        except ValueError:
            filtered.append(item)
    new_data = dict(data)
    new_data["items"] = filtered
    return new_data


def _wind_doc_compact(
    tool_name: str,
    query: str,
    *,
    top_k: int = 8,
    max_chars_per_item: int = 1600,
    as_of_date: str | None = None,
    tolerate_failure: bool = False,
) -> str:
    try:
        data = _call_wind(
            "financial_docs",
            tool_name,
            {"query": _compact_query(query), "top_k": int(top_k)},
        )
    except Exception as exc:
        if not tolerate_failure:
            raise
        return (
            "DATA_UNAVAILABLE: Wind did not return usable documents for this query. "
            f"Query: {query}. Error: {exc}. Do not fabricate missing documents."
        )

    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return json.dumps(data, ensure_ascii=False, indent=2)[: max_chars_per_item * max(1, top_k)]

    if not as_of_date:
        as_of_date = datetime.now().strftime("%Y-%m-%d")
    data = _filter_doc_data_as_of(data, as_of_date)
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return json.dumps(data, ensure_ascii=False, indent=2)[: max_chars_per_item * max(1, top_k)]
    compact_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or "")
        if len(content) > max_chars_per_item:
            content = content[:max_chars_per_item].rstrip() + "\n...[TRUNCATED]"
        compact_items.append(
            {
                "title": item.get("title"),
                "announcement_date": item.get("date"),
                "inferred_report_period": _infer_report_period(str(item.get("title") or "") + " " + content[:300]),
                "doc_type": item.get("doc_type"),
                "relevance": item.get("relevance"),
                "key_evidence_hint": _summarize_key_evidence(content),
                "missing_or_unavailable_hint": "Full original document text may be truncated; verify exact figures against Wind disclosure when needed.",
                "content_excerpt": content,
            }
        )
        if len(compact_items) >= int(top_k):
            break

    if not compact_items:
        return (
            "DATA_UNAVAILABLE: Wind returned documents, but none matched the "
            f"as-of date filter ({as_of_date}). Do not fabricate missing documents."
        )
    return _format_doc_coverage(compact_items) + "\n\n" + json.dumps({"items": compact_items}, ensure_ascii=False, indent=2)


def _summarize_key_evidence(content: str, max_chars: int = 120) -> str:
    cleaned = " ".join(str(content).split())
    if not cleaned:
        return "content unavailable"
    keywords = ("营业收入", "净利润", "现金流", "资本开支", "应收", "存货", "研发", "风险", "管理层", "客户", "供应商")
    for keyword in keywords:
        idx = cleaned.find(keyword)
        if idx >= 0:
            start = max(0, idx - 20)
            return cleaned[start : start + max_chars]
    return cleaned[:max_chars]


def _infer_report_period(text: str) -> str:
    for year in range(datetime.now().year + 1, 2010, -1):
        y = str(year)
        if f"{y}年年度报告" in text or f"{y}年度报告" in text:
            return f"{y} annual report"
        if f"{y}年度业绩快报" in text or f"{y}年业绩快报" in text:
            return f"{y} preliminary results"
        if f"{y}年半年度报告" in text or f"{y}半年度报告" in text:
            return f"{y} semiannual report"
        if f"{y}年半年度业绩预告" in text or f"{y}半年度业绩预告" in text:
            return f"{y} H1 earnings preannouncement"
        if f"{y}年第一季度业绩预告" in text or f"{y}年一季度业绩预告" in text:
            return f"{y} Q1 earnings preannouncement"
        if f"{y}年第一季度" in text or f"{y}年一季度" in text or f"{y}一季度" in text:
            return f"{y} Q1 report"
        if f"{y}年第三季度业绩预告" in text or f"{y}年三季度业绩预告" in text:
            return f"{y} Q3 earnings preannouncement"
        if f"{y}年第三季度" in text or f"{y}年三季度" in text or f"{y}三季度" in text:
            return f"{y} Q3 report"
    return "period not inferred"


def _format_doc_coverage(items: list[dict[str, Any]]) -> str:
    lines = [
        "### Periodic-report evidence coverage",
        "",
        "| # | Title | Announcement date | Inferred period | Key evidence hint | Missing/unavailable hint |",
        "|---:|---|---|---|---|---|",
    ]
    for idx, item in enumerate(items, 1):
        title = str(item.get("title") or "").replace("|", "/")
        date = str(item.get("announcement_date") or "")
        period = str(item.get("inferred_report_period") or "")
        evidence = str(item.get("key_evidence_hint") or "").replace("|", "/")
        missing = str(item.get("missing_or_unavailable_hint") or "").replace("|", "/")
        lines.append(f"| {idx} | {title} | {date} | {period} | {evidence} | {missing} |")
    lines.append("")
    lines.append("Use only the reports listed above as retrieved disclosure evidence. If a needed period or statement is absent, mark it as DATA_UNAVAILABLE.")
    return "\n".join(lines)


def _section(title: str, body: str) -> str:
    return f"## {title}\n\n{body}"


def _compact_query(value: str) -> str:
    return "".join(str(value).split())


def get_fundamentals(ticker: str, curr_date: str | None = None) -> str:
    suffix = f"，截至{curr_date}" if curr_date else ""
    parts = [
        _section(
            "公司档案与主营业务",
            _wind_nl(
                "get_stock_basicinfo",
                f"{ticker} 公司档案、主营业务、所属行业、上市板块、核心产品{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "核心财务、估值与成长性",
            _wind_nl(
                "get_stock_fundamentals",
                f"{ticker} 主要财务指标、盈利能力、估值、成长性、现金流、同行业估值对比{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "股东结构与股本",
            _wind_nl(
                "get_stock_equity_holders",
                f"{ticker} 前十大股东、实际控制人、机构持股、限售解禁、股本结构{suffix}",
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_periodic_reports(ticker: str, curr_date: str | None = None, years: int = 3) -> str:
    """Return an A-share periodic-report evidence pack from Wind.

    Wind's document endpoint is used as the primary source for disclosed
    annual/semiannual/quarterly reports. Targeted fundamentals queries add
    cross-period financial context so the LLM can write a report-reading
    section even when full PDF text is not available from the document search.
    """
    try:
        year = datetime.strptime(curr_date, "%Y-%m-%d").year if curr_date else datetime.now().year
    except ValueError:
        year = datetime.now().year
    lookback_years = max(1, min(int(years or 3), 5))
    start_year = year - lookback_years
    suffix = f"，截至{curr_date}" if curr_date else ""

    parts = [
        _section(
            "定期报告披露文件索引",
            _wind_doc_compact(
                "get_company_announcements",
                f"{ticker}{start_year}年以来年度报告半年度报告季度报告审计报告财务报告管理层讨论与分析",
                top_k=8,
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
        _section(
            "近三年与最近一期经营和盈利趋势",
            _wind_nl(
                "get_stock_fundamentals",
                f"{ticker}{start_year}年以来年报半年报季报营业收入净利润扣非净利润毛利率净利率ROE同比环比增长趋势{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "现金流、资本开支与资产质量",
            _wind_nl(
                "get_stock_fundamentals",
                f"{ticker}{start_year}年以来年报半年报季报经营现金流投资现金流自由现金流资本开支在建工程应收账款存货合同负债减值准备{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "负债、融资与偿债压力",
            _wind_nl(
                "get_stock_fundamentals",
                f"{ticker}{start_year}年以来资产负债率有息负债短期借款长期借款货币资金流动比率速动比率担保质押偿债能力{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "业务结构、客户供应商、研发和风险提示",
            _wind_doc_compact(
                "get_company_announcements",
                f"{ticker}{start_year}年以来年报主营业务产品结构客户供应商研发投入重大风险管理层讨论经营计划",
                top_k=8,
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_ashare_event_context(ticker: str, curr_date: str | None = None) -> str:
    suffix = f"，截至{curr_date}" if curr_date else ""
    parts = [
        _section(
            "融资融券、龙虎榜、涨跌停与技术事件",
            _wind_nl(
                "get_stock_technicals",
                f"{ticker} 近60日融资融券、龙虎榜、涨跌停、换手率、成交额、MACD、RSI、BOLL、量价异动{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "公司事件、股东变化与资本运作",
            _wind_nl(
                "get_stock_events",
                f"{ticker} 近一年回购、分红、增发、并购、重组、ST风险、高管增减持、股东增减持、股本变动{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "机构调研、互动问答与市场关注代理",
            _wind_nl(
                "get_stock_events",
                f"{ticker} 近一年机构调研、投资者关系活动、业绩说明会、互动易问答、交易所问询函、监管函、市场关注度变化{suffix}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "风险指标",
            _wind_nl(
                "get_risk_metrics",
                f"{ticker} 过去1年Beta、波动率、Sharpe、VaR、相对沪深300风险收益特征{suffix}",
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_balance_sheet(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    suffix = f"，截至{curr_date}" if curr_date else ""
    return _wind_nl(
        "get_stock_fundamentals",
        f"{ticker} {freq} 资产负债表和偿债能力{suffix}",
        tolerate_failure=True,
    )


def get_cashflow(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    suffix = f"，截至{curr_date}" if curr_date else ""
    return _wind_nl(
        "get_stock_fundamentals",
        f"{ticker} {freq} 现金流量表和自由现金流{suffix}",
        tolerate_failure=True,
    )


def get_income_statement(ticker: str, freq: str = "quarterly", curr_date: str | None = None) -> str:
    suffix = f"，截至{curr_date}" if curr_date else ""
    return _wind_nl(
        "get_stock_fundamentals",
        f"{ticker} {freq} 利润表、收入、毛利率、净利润{suffix}",
        tolerate_failure=True,
    )


def get_news(ticker: str, start_date: str, end_date: str) -> str:
    parts = [
        _section(
            "Wind财经新闻",
            _wind_doc(
                "get_financial_news",
                f"{ticker}{start_date}至{end_date}新闻",
                top_k=10,
                as_of_date=end_date,
                tolerate_failure=True,
            ),
        ),
        _section(
            "交易所公告与监管披露",
            _wind_doc(
                "get_company_announcements",
                f"{ticker}{start_date}至{end_date}公告年报季报监管披露",
                top_k=10,
                as_of_date=end_date,
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_earnings_preannouncements(ticker: str, curr_date: str, look_back_days: int = 180) -> str:
    start_dt = datetime.strptime(curr_date, "%Y-%m-%d") - relativedelta(days=int(look_back_days))
    start_date = start_dt.strftime("%Y-%m-%d")
    parts = [
        _section(
            "业绩预告、业绩快报与业绩修正公告",
            _wind_doc_compact(
                "get_company_announcements",
                f"{ticker}{start_date}至{curr_date}业绩预告业绩快报业绩修正盈利预告半年度业绩预告一季度业绩预告三季度业绩预告",
                top_k=10,
                max_chars_per_item=1400,
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
        _section(
            "预告区间与正式财务趋势交叉验证",
            _wind_nl(
                "get_stock_fundamentals",
                f"{ticker}{start_date}至{curr_date}业绩预告净利润区间扣非净利润区间营业收入增长业绩快报正式财报差异单季度同比环比",
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_industry_chain_context(ticker: str, curr_date: str, look_back_days: int = 180) -> str:
    start_dt = datetime.strptime(curr_date, "%Y-%m-%d") - relativedelta(days=int(look_back_days))
    start_date = start_dt.strftime("%Y-%m-%d")
    parts = [
        _section(
            "公司行业归属、主营产品与产业链位置",
            _wind_nl(
                "get_stock_basicinfo",
                f"{ticker} 所属Wind行业、主营产品、产业链位置、上游原材料、下游应用、主要客户行业、主要竞争对手，截至{curr_date}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "行业景气度、政策主题与需求驱动",
            _wind_doc(
                "get_financial_news",
                f"{ticker}{start_date}至{curr_date}所属行业景气度产业政策需求驱动AI服务器汽车智能化出口制裁国产替代",
                top_k=12,
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
        _section(
            "同业对比、估值与盈利能力",
            _wind_nl(
                "get_stock_fundamentals",
                f"{ticker} 所属行业同业公司对比、行业平均PE PB PS、收入增长、净利润增长、毛利率、ROE、估值分位、龙头公司，截至{curr_date}",
                tolerate_failure=True,
            ),
        ),
        _section(
            "产业链事件、公司公告与订单产能线索",
            _wind_doc_compact(
                "get_company_announcements",
                f"{ticker}{start_date}至{curr_date}产业链订单客户供应商产能扩张投资项目海外基地原材料价格行业政策公告",
                top_k=10,
                max_chars_per_item=1200,
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
        _section(
            "A股主题热度、资金关注与可比映射",
            _wind_nl(
                "get_stock_events",
                f"{ticker} 近{look_back_days}日所属行业板块热度、主题概念、龙虎榜、融资融券、机构调研、可比公司、海外映射标的、资金关注变化，截至{curr_date}",
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_global_news(curr_date: str, look_back_days: int = 7, limit: int = 10) -> str:
    parts = [
        _section(
            "A股市场、政策与行业热点",
            _wind_doc(
                "get_financial_news",
                f"A股市场宏观政策行业热点资金面截至{curr_date}",
                top_k=int(limit),
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
        _section(
            "监管公告与市场制度变化",
            _wind_doc(
                "get_company_announcements",
                f"A股监管政策交易所公告市场制度变化截至{curr_date}",
                top_k=max(3, min(int(limit), 8)),
                as_of_date=curr_date,
                tolerate_failure=True,
            ),
        ),
    ]
    return "\n\n".join(parts)


def get_insider_transactions(symbol: str) -> str:
    return get_ashare_event_context(symbol)


def get_macro_data(indicator: str, curr_date: str, look_back_days: int = 90) -> str:
    end_dt = datetime.strptime(curr_date, "%Y-%m-%d")
    start_dt = end_dt - relativedelta(days=int(look_back_days))
    data = _call_wind(
        "economic_data",
        "natural_language_get_edb_data",
        {
            "executionMode": "searchFetch",
            "question": f"中国 {indicator}",
            "beginDate": start_dt.strftime("%Y%m%d"),
            "endDate": end_dt.strftime("%Y%m%d"),
        },
    )
    return json.dumps(data, ensure_ascii=False, indent=2)
