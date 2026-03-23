from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DATA_FILE = PROJECT_ROOT / "src" / "data" / "portfolioMockData.js"


def _parse_js_exported_array(source_text: str, export_name: str) -> list[dict[str, Any]]:
    pattern = rf"export const {re.escape(export_name)} = (\[.*?\])\s*(?:export const|$)"
    match = re.search(pattern, source_text, flags=re.DOTALL)
    if not match:
        raise ValueError(f"Unable to locate export `{export_name}` in {FRONTEND_DATA_FILE}")
    return json.loads(match.group(1))


@lru_cache(maxsize=1)
def load_portfolio_rows() -> list[dict[str, Any]]:
    if not FRONTEND_DATA_FILE.exists():
        raise FileNotFoundError(f"Missing data file: {FRONTEND_DATA_FILE}")

    source_text = FRONTEND_DATA_FILE.read_text(encoding="utf-8")
    rows = _parse_js_exported_array(source_text, "ownBrandMonthlyData")
    if not rows:
        raise ValueError("Portfolio dataset is empty.")
    return rows


def get_available_months(rows: list[dict[str, Any]]) -> list[str]:
    return sorted({str(row.get("yearMonth")) for row in rows if row.get("yearMonth")})


def select_month_rows(rows: list[dict[str, Any]], selected_month: str | None) -> tuple[str, list[dict[str, Any]]]:
    months = get_available_months(rows)
    if not months:
        raise ValueError("No `yearMonth` values found in portfolio data.")

    month = selected_month if selected_month in months else months[-1]
    month_rows = [row for row in rows if str(row.get("yearMonth")) == month]
    if not month_rows:
        raise ValueError(f"No rows found for selected month: {month}")
    return month, month_rows

