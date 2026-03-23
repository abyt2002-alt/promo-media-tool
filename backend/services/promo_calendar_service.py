from __future__ import annotations

import json
from pathlib import Path
import math
import os
import random
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from functools import lru_cache
from typing import Any, Callable
import pandas as pd

from backend.schemas.promo_calendar import (
    PromoBestMarkers,
    PromoCalendarRequest,
    PromoCalendarRecalculateRequest,
    PromoCalendarRecalculateResponse,
    PromoCalendarResponse,
    PromoElasticityInsightRow,
    PromoElasticityInsightsResponse,
    PromoHistoricalProductRow,
    PromoHistoricalResponse,
    PromoPortfolioTotals,
    PromoProductImpact,
    PromoScenarioDetail,
    PromoScenarioSummary,
    PromoWeeklyGroupCalendar,
)
from backend.utils.data_loader import load_portfolio_rows, select_month_rows
from backend.utils.elasticity_utils import (
    build_beta_and_gamma,
    build_cross_elasticity_matrix,
    build_own_elasticities,
    convert_to_base_reference,
)


ProgressCallback = Callable[[int, str], None]

PROMO_WEEKS = 27
PROMO_START_WEEK = 16
PROMO_LEVELS = (10.0, 20.0, 30.0, 40.0)
COGS_RATIO = 0.40
SUBTLE_CROSS_WEIGHT = 0.25
CROSS_IMPACT_GLOBAL_SCALE = 0.50
FAMILY_PROFILES: tuple[dict[str, Any], ...] = (
    {
        "name": "Volume Driver",
        "weight": 0.36,
        "no_promo_prob": 0.12,
        "level_weights": (0.10, 0.25, 0.35, 0.30),
        "transition_weights": (0.28, 0.46, 0.26),
    },
    {
        "name": "Revenue Builder",
        "weight": 0.34,
        "no_promo_prob": 0.18,
        "level_weights": (0.22, 0.38, 0.25, 0.15),
        "transition_weights": (0.40, 0.42, 0.18),
    },
    {
        "name": "Profit Guard",
        "weight": 0.30,
        "no_promo_prob": 0.32,
        "level_weights": (0.45, 0.34, 0.16, 0.05),
        "transition_weights": (0.62, 0.30, 0.08),
    },
)
BUCKET_SIZE = 500
TOTAL_TARGET = 1500
OBJECTIVE_BUCKETS: tuple[str, ...] = ("volume", "revenue", "profit")
PROMO_ALLOWED_LEVELS = (0.0, 10.0, 20.0, 30.0, 40.0)
DEFAULT_BUCKET_FAMILY_WEIGHTS: dict[str, list[float]] = {
    "volume": [0.52, 0.30, 0.18],
    "revenue": [0.20, 0.56, 0.24],
    "profit": [0.20, 0.30, 0.50],
}
STEP_UP_PACE_PRESETS: dict[str, tuple[float, float, float]] = {
    "steady": (0.66, 0.26, 0.08),
    "balanced": (0.40, 0.42, 0.18),
    "fast": (0.18, 0.38, 0.44),
}
PACE_LEVEL_SCALE: dict[str, tuple[float, float, float, float]] = {
    "steady": (1.20, 1.05, 0.90, 0.75),
    "balanced": (1.0, 1.0, 1.0, 1.0),
    "fast": (0.75, 0.90, 1.10, 1.25),
}
COVERAGE_NO_PROMO_MULTIPLIER: dict[str, float] = {
    "few_groups": 1.55,
    "balanced": 1.0,
    "broad_groups": 0.45,
}
PROMO_AI_INTENT_FALLBACK = "Fallback default family mix (500 per objective bucket)."
PROMO_CONTEXT_CACHE_FILE = "promo_calendar_context_latest.json"
RAW_PROMO_FILE_NAME = "D0_TShirt_2024_Material_New Launches 1.xlsx"


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed


def _normalize_weights(weights: list[float]) -> list[float]:
    non_negative = [max(0.0, float(item)) for item in weights]
    total = sum(non_negative)
    if total <= 0:
        return [1.0 / max(1, len(weights)) for _ in weights]
    return [item / total for item in non_negative]


def _extract_first_json_object(raw_text: str) -> dict[str, Any] | None:
    text = str(raw_text or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _call_gemini_json(prompt_text: str, temperature: float = 0.15, timeout_seconds: int = 35) -> dict[str, Any] | None:
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        return None

    model_name = (os.getenv("GEMINI_MODEL") or "gemini-2.5-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
        "generationConfig": {
            "temperature": float(temperature),
            "responseMimeType": "application/json",
        },
    }
    req = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None

    candidates = parsed.get("candidates") or []
    if not candidates:
        return None
    parts = ((candidates[0].get("content") or {}).get("parts") or [])
    text = ""
    for part in parts:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text += part["text"]
    return _extract_first_json_object(text)


def _normalize_objective_key(value: Any) -> str | None:
    text = str(value or "").strip().lower().replace(" ", "_")
    aliases = {
        "volume": "volume",
        "max_volume": "volume",
        "revenue": "revenue",
        "max_revenue": "revenue",
        "profit": "profit",
        "max_profit": "profit",
    }
    return aliases.get(text)


def _normalize_step_up_pace(value: Any) -> str:
    text = str(value or "").strip().lower().replace(" ", "_")
    if text in ("steady", "slow", "gradual"):
        return "steady"
    if text in ("fast", "aggressive", "rapid"):
        return "fast"
    return "balanced"


def _normalize_coverage_bias(value: Any) -> str:
    text = str(value or "").strip().lower().replace(" ", "_")
    if text in ("few", "few_groups", "focused", "narrow"):
        return "few_groups"
    if text in ("broad", "broad_groups", "wide", "aggressive_coverage"):
        return "broad_groups"
    return "balanced"


def _build_promo_gemini_prompt(prompt: str) -> str:
    user_prompt = str(prompt or "").strip()
    return (
        "You are tuning promo-calendar scenario generation biases.\n"
        "Return strict JSON only.\n"
        "You are ONLY allowed to control these fields:\n"
        "1) Family mix weights for each objective bucket (volume/revenue/profit)\n"
        "2) Step-up pace bias (steady|balanced|fast)\n"
        "3) Coverage bias (few_groups|balanced|broad_groups)\n"
        "Do not output anything else.\n"
        "Family order for weights is fixed as:\n"
        "[Volume Driver, Revenue Builder, Profit Guard]\n"
        "Output schema:\n"
        "{\n"
        '  "intent_summary": "short text",\n'
        '  "bucket_mix": {\n'
        '    "volume": [0.52, 0.30, 0.18],\n'
        '    "revenue": [0.20, 0.56, 0.24],\n'
        '    "profit": [0.20, 0.30, 0.50]\n'
        "  },\n"
        '  "step_up_pace_bias": "balanced",\n'
        '  "coverage_bias": "balanced"\n'
        "}\n"
        "Rules:\n"
        "- Keep all weights >= 0; they will be normalized.\n"
        "- Keep step_up_pace_bias in {steady, balanced, fast}.\n"
        "- Keep coverage_bias in {few_groups, balanced, broad_groups}.\n"
        "- No commentary outside JSON.\n"
        f"User intent: {user_prompt}\n"
    )


def _resolve_ai_generation_controls(prompt: str | None) -> dict[str, Any]:
    fallback_mix = {key: list(value) for key, value in DEFAULT_BUCKET_FAMILY_WEIGHTS.items()}
    fallback = {
        "ai_source": "fallback_default",
        "intent_summary": PROMO_AI_INTENT_FALLBACK,
        "bucket_mix": fallback_mix,
        "step_up_pace_bias": "balanced",
        "coverage_bias": "balanced",
    }
    user_prompt = str(prompt or "").strip()
    if not user_prompt:
        return fallback

    gemini_payload = _call_gemini_json(_build_promo_gemini_prompt(user_prompt), temperature=0.15, timeout_seconds=35)
    if not isinstance(gemini_payload, dict):
        return fallback

    raw_mix = gemini_payload.get("bucket_mix")
    if not isinstance(raw_mix, dict):
        raw_mix = {}

    resolved_mix: dict[str, list[float]] = {key: list(value) for key, value in fallback_mix.items()}
    for raw_key, raw_weights in raw_mix.items():
        objective = _normalize_objective_key(raw_key)
        if objective is None or not isinstance(raw_weights, (list, tuple)):
            continue
        if len(raw_weights) < len(FAMILY_PROFILES):
            continue
        resolved_mix[objective] = _normalize_weights(
            [_safe_float(raw_weights[0], 0.0), _safe_float(raw_weights[1], 0.0), _safe_float(raw_weights[2], 0.0)]
        )

    return {
        "ai_source": "gemini",
        "intent_summary": str(gemini_payload.get("intent_summary") or user_prompt).strip() or user_prompt,
        "bucket_mix": resolved_mix,
        "step_up_pace_bias": _normalize_step_up_pace(gemini_payload.get("step_up_pace_bias")),
        "coverage_bias": _normalize_coverage_bias(gemini_payload.get("coverage_bias")),
    }


def _apply_family_generation_biases(
    family: dict[str, Any],
    *,
    step_up_pace_bias: str,
    coverage_bias: str,
) -> dict[str, Any]:
    paced = _normalize_step_up_pace(step_up_pace_bias)
    coverage = _normalize_coverage_bias(coverage_bias)
    pace_target = STEP_UP_PACE_PRESETS[paced]
    pace_level_scale = PACE_LEVEL_SCALE[paced]
    coverage_multiplier = COVERAGE_NO_PROMO_MULTIPLIER[coverage]

    transition_weights = tuple(_safe_float(value, 0.0) for value in family.get("transition_weights", (0.4, 0.4, 0.2)))
    transition_blend = _normalize_weights(
        [0.55 * transition_weights[idx] + 0.45 * pace_target[idx] for idx in range(len(pace_target))]
    )
    level_weights = tuple(_safe_float(value, 0.0) for value in family.get("level_weights", (0.25, 0.25, 0.25, 0.25)))
    level_blend = _normalize_weights(
        [level_weights[idx] * pace_level_scale[idx] for idx in range(min(len(level_weights), len(pace_level_scale)))]
    )

    no_promo_prob = _safe_float(family.get("no_promo_prob"), 0.15)
    no_promo_prob = max(0.02, min(0.75, no_promo_prob * coverage_multiplier))

    return {
        **family,
        "no_promo_prob": no_promo_prob,
        "transition_weights": tuple(transition_blend),
        "level_weights": tuple(level_blend),
    }


def _parse_excel_numeric(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip()
    if not text:
        return float("nan")
    text = text.replace(",", "")
    text = re.sub(r"(?i)\binr\b", "", text).strip()
    return _safe_float(text, float("nan"))


def _load_local_base_ladder_overrides() -> tuple[list[dict[str, Any]], str | None]:
    cwd = Path.cwd()
    result_dir = cwd / "result file"
    search_dirs = [result_dir]
    files: list[Path] = []
    for directory in search_dirs:
        if not directory.exists():
            continue
        files.extend(directory.glob("base_ladder_saved_scenarios_*.xls"))
        files.extend(directory.glob("base_ladder_saved_scenarios_*.xlsx"))

    candidates = sorted(files, key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        return [], None

    source_file = candidates[0]
    ns = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
    try:
        root = ET.parse(source_file).getroot()
    except Exception:
        return [], None

    overrides: list[dict[str, Any]] = []
    seen: set[str] = set()
    detected_month: str | None = None

    # Only first worksheet is used (if workbook has multiple sheets).
    worksheet = root.find(".//ss:Worksheet", ns)
    if worksheet is None:
        return [], None

    table = worksheet.find("ss:Table", ns)
    if table is None:
        return [], None

    rows: list[list[str]] = []
    for row in table.findall("ss:Row", ns):
        values: list[str] = []
        for cell in row.findall("ss:Cell", ns):
            data = cell.find("ss:Data", ns)
            values.append("" if data is None or data.text is None else str(data.text).strip())
        rows.append(values)
    if not rows:
        return [], None

    if detected_month is None:
        for row in rows:
            if len(row) >= 2 and str(row[0]).strip().lower() == "month":
                detected_month = str(row[1]).strip() or None
                break

    header_index = -1
    for idx, row in enumerate(rows):
        first = str(row[0]).strip().lower() if row else ""
        has_rec = any(str(cell).strip().lower() == "recommended price" for cell in row)
        if first == "product" and has_rec:
            header_index = idx
            break
    if header_index < 0:
        return [], detected_month

    header = [str(cell).strip().lower() for cell in rows[header_index]]
    product_idx = header.index("product") if "product" in header else -1
    rec_idx = header.index("recommended price") if "recommended price" in header else -1
    base_idx = header.index("base price") if "base price" in header else -1
    base_vol_idx = header.index("base volume") if "base volume" in header else -1
    if product_idx < 0 or (rec_idx < 0 and base_idx < 0):
        return [], detected_month

    for row in rows[header_index + 1 :]:
        if not row or product_idx >= len(row):
            continue
        product_name = str(row[product_idx]).strip()
        if not product_name:
            continue
        rec_val = _parse_excel_numeric(row[rec_idx] if rec_idx >= 0 and rec_idx < len(row) else None)
        base_val = _parse_excel_numeric(row[base_idx] if base_idx >= 0 and base_idx < len(row) else None)
        base_vol = _parse_excel_numeric(row[base_vol_idx] if base_vol_idx >= 0 and base_vol_idx < len(row) else None)
        chosen = rec_val if math.isfinite(rec_val) and rec_val > 0 else base_val
        if not math.isfinite(chosen) or chosen <= 0:
            continue
        key = _normalize_product_key(product_name)
        if key in seen:
            continue
        seen.add(key)
        item = {"product_name": product_name, "base_price": float(chosen)}
        if math.isfinite(base_vol) and base_vol > 0:
            item["base_volume"] = float(base_vol)
        overrides.append(item)

    return overrides, detected_month


def _normalize_product_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = text.replace(" | ", "|").replace("| ", "|").replace(" |", "|")
    return " ".join(text.split())


def _resolve_anchor_base_prices(rows: list[dict[str, Any]], overrides: list[Any] | None) -> list[float]:
    defaults = [max(1.0, _safe_float(row.get("basePrice"), row.get("currentPrice"))) for row in rows]
    if not overrides:
        return defaults

    override_map: dict[str, float] = {}
    for item in overrides:
        if isinstance(item, dict):
            product_name = item.get("product_name")
            base_price_raw = item.get("base_price")
        else:
            product_name = getattr(item, "product_name", None)
            base_price_raw = getattr(item, "base_price", None)
        key = _normalize_product_key(product_name)
        value = _safe_float(base_price_raw, float("nan"))
        if not key or not math.isfinite(value):
            continue
        override_map[key] = max(1.0, value)

    if not override_map:
        return defaults

    resolved: list[float] = []
    for idx, row in enumerate(rows):
        key = _normalize_product_key(row.get("productName"))
        resolved.append(float(override_map.get(key, defaults[idx])))
    return resolved


def _resolve_anchor_base_volumes(
    rows: list[dict[str, Any]],
    defaults: list[float],
    overrides: list[Any] | None,
) -> list[float]:
    if not overrides:
        return defaults

    override_map: dict[str, float] = {}
    for item in overrides:
        if isinstance(item, dict):
            product_name = item.get("product_name")
            base_volume_raw = item.get("base_volume")
        else:
            product_name = getattr(item, "product_name", None)
            base_volume_raw = getattr(item, "base_volume", None)
        key = _normalize_product_key(product_name)
        value = _safe_float(base_volume_raw, float("nan"))
        if not key or not math.isfinite(value) or value <= 0:
            continue
        override_map[key] = float(value)

    if not override_map:
        return defaults

    resolved: list[float] = []
    for idx, row in enumerate(rows):
        key = _normalize_product_key(row.get("productName"))
        resolved.append(float(override_map.get(key, defaults[idx])))
    return resolved


def _scope_keys_from_overrides(overrides: list[Any] | None) -> set[str]:
    keys: set[str] = set()
    for item in overrides or []:
        if isinstance(item, dict):
            product_name = item.get("product_name")
        else:
            product_name = getattr(item, "product_name", None)
        key = _normalize_product_key(product_name)
        if key:
            keys.add(key)
    return keys


def _filter_rows_by_scope(rows: list[dict[str, Any]], scope_keys: set[str]) -> list[dict[str, Any]]:
    if not scope_keys:
        return rows
    return [row for row in rows if _normalize_product_key(row.get("productName")) in scope_keys]


def _persist_context_snapshot(
    *,
    selected_month: str,
    rows: list[dict[str, Any]],
    base_prices: list[float],
    base_volumes: list[float],
    own_base: list[float],
    cross_base: list[list[float]],
    beta_ppu: list[float],
    gamma_matrix: list[list[float]],
) -> None:
    payload = {
        "selected_month": selected_month,
        "products": [str(row.get("productName", f"P{idx + 1}")) for idx, row in enumerate(rows)],
        "base_prices": [float(v) for v in base_prices],
        "base_volumes": [float(v) for v in base_volumes],
        "own_elasticity_base": [float(v) for v in own_base],
        "cross_elasticity_base": [[float(cell) for cell in row] for row in cross_base],
        "beta_ppu": [float(v) for v in beta_ppu],
        "gamma_matrix": [[float(cell) for cell in row] for row in gamma_matrix],
    }
    try:
        Path.cwd().joinpath(PROMO_CONTEXT_CACHE_FILE).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def _progress(callback: ProgressCallback | None, pct: int, stage: str) -> None:
    if callback:
        callback(max(0, min(100, int(pct))), str(stage or ""))


def _sorted_rows(month_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        month_rows,
        key=lambda row: (
            _safe_float(row.get("basePrice"), _safe_float(row.get("currentPrice"), 0.0)),
            str(row.get("productName", "")),
        ),
    )


def _normalize_filters(raw_filters: dict[str, float] | None) -> dict[str, float]:
    source = raw_filters or {}
    return {
        "min_volume_uplift": _safe_float(source.get("min_volume_uplift_pct"), -9999.0) / 100.0,
        "min_revenue_uplift": _safe_float(source.get("min_revenue_uplift_pct"), -9999.0) / 100.0,
        "min_profit_uplift": _safe_float(source.get("min_profit_uplift_pct"), -9999.0) / 100.0,
    }


def _passes_filters(
    volume_uplift: float,
    revenue_uplift: float,
    profit_uplift: float,
    filters: dict[str, float],
) -> bool:
    return (
        volume_uplift >= _safe_float(filters.get("min_volume_uplift"), -9999.0)
        and revenue_uplift >= _safe_float(filters.get("min_revenue_uplift"), -9999.0)
        and profit_uplift >= _safe_float(filters.get("min_profit_uplift"), -9999.0)
    )


def _build_price_groups(base_prices: list[float]) -> list[dict[str, Any]]:
    grouped: dict[int, list[int]] = {}
    for idx, price in enumerate(base_prices):
        key = int(round(price))
        grouped.setdefault(key, []).append(idx)
    groups = []
    for order, key in enumerate(sorted(grouped)):
        groups.append(
            {
                "group_id": f"g{order + 1}",
                "group_name": f"INR {key}",
                "base_price": float(key),
                "indices": grouped[key],
            }
        )
    return groups


def _normalize_weeks(min_weeks: int, max_weeks: int) -> tuple[int, int]:
    min_w = max(0, min(12, int(min_weeks)))
    max_w = max(1, min(12, int(max_weeks)))
    if min_w > max_w:
        min_w, max_w = max_w, min_w
    return min_w, max_w


def _promo_start_candidates(min_weeks: int, max_weeks: int) -> list[int]:
    starts: list[int] = []
    for start in range(PROMO_START_WEEK, PROMO_WEEKS + 1):
        duration = PROMO_WEEKS - start + 1
        if min_weeks <= duration <= max_weeks:
            starts.append(start)
    return starts


def _weighted_choice(rng: random.Random, values: list[Any], weights: tuple[float, ...]) -> Any:
    return rng.choices(values, weights=weights, k=1)[0]


def _sample_group_path(
    rng: random.Random,
    family: dict[str, Any],
    start_candidates: list[int],
    min_weeks: int,
    max_weeks: int,
    allow_no_promo: bool = True,
) -> list[float]:
    weekly = [0.0] * PROMO_WEEKS
    if not start_candidates:
        return weekly
    if allow_no_promo and rng.random() < float(family["no_promo_prob"]):
        return weekly

    start_week = int(rng.choice(start_candidates))
    promo_duration = PROMO_WEEKS - start_week + 1
    if not (min_weeks <= promo_duration <= max_weeks):
        return weekly

    transitions = int(_weighted_choice(rng, [0, 1, 2], family["transition_weights"]))
    pivot_weeks = sorted(rng.sample(range(start_week, PROMO_WEEKS + 1), k=min(transitions, promo_duration - 1)))
    current_level = float(_weighted_choice(rng, list(PROMO_LEVELS), family["level_weights"]))

    for week in range(start_week, PROMO_WEEKS + 1):
        if week in pivot_weeks:
            higher = [lvl for lvl in PROMO_LEVELS if lvl >= current_level]
            if higher:
                step_weights = tuple(range(1, len(higher) + 1))
                current_level = float(_weighted_choice(rng, list(higher), step_weights))
        weekly[week - 1] = current_level
    return weekly


def _build_group_template_pool(
    start_candidates: list[int],
    min_weeks: int,
    max_weeks: int,
    include_no_promo_template: bool = True,
) -> list[list[float]]:
    templates: list[list[float]] = []
    seen: set[tuple[float, ...]] = set()

    def add_template(path: list[float]) -> None:
        duration = _promo_duration(path)
        if duration > 0 and not (min_weeks <= duration <= max_weeks):
            return
        signature = tuple(float(v) for v in path)
        if signature in seen:
            return
        seen.add(signature)
        templates.append(list(signature))

    if include_no_promo_template:
        add_template([0.0] * PROMO_WEEKS)
    if not start_candidates:
        return templates

    for start_week in start_candidates:
        for level in PROMO_LEVELS:
            path = [0.0] * PROMO_WEEKS
            for week in range(start_week - 1, PROMO_WEEKS):
                path[week] = float(level)
            add_template(path)

        for low_idx in range(len(PROMO_LEVELS) - 1):
            low_level = float(PROMO_LEVELS[low_idx])
            for high_level in PROMO_LEVELS[low_idx + 1 :]:
                for step_week in range(start_week + 1, PROMO_WEEKS + 1):
                    path = [0.0] * PROMO_WEEKS
                    for week in range(start_week - 1, PROMO_WEEKS):
                        path[week] = low_level
                    for week in range(step_week - 1, PROMO_WEEKS):
                        path[week] = float(high_level)
                    add_template(path)

    return templates


def _top_up_candidates_with_templates(
    *,
    candidates: list[dict[str, Any]],
    signatures: set[Any],
    groups: list[dict[str, Any]],
    start_candidates: list[int],
    min_weeks: int,
    max_weeks: int,
    min_gm: float,
    base_prices: list[float],
    base_volumes: list[float],
    beta_ppu: list[float],
    gamma_matrix: list[list[float]],
    unit_costs: list[float],
    raw_target: int,
    seed_value: int,
    include_no_promo_template: bool,
    enforce_all_groups_active: bool,
) -> None:
    if len(candidates) >= raw_target:
        return

    template_pool = _build_group_template_pool(
        start_candidates,
        min_weeks,
        max_weeks,
        include_no_promo_template=include_no_promo_template,
    )
    # Need at least one promo template plus base template.
    if len(template_pool) <= 1:
        return

    rng = random.Random(seed_value + 104729)
    attempts = 0
    attempt_limit = max(raw_target * 80, 200000)

    while len(candidates) < raw_target and attempts < attempt_limit:
        attempts += 1
        group_paths: dict[str, list[float]] = {}
        signature_parts = []
        for group in groups:
            path = template_pool[rng.randrange(len(template_pool))]
            group_paths[group["group_id"]] = list(path)
            signature_parts.append(tuple(path))
        signature = tuple(signature_parts)

        if signature in signatures:
            continue
        if not _candidate_has_valid_promo(
            group_paths,
            min_weeks,
            max_weeks,
            enforce_all_groups_active=enforce_all_groups_active,
        ):
            continue

        evaluated = _evaluate_candidate(
            group_paths,
            groups,
            base_prices,
            base_volumes,
            beta_ppu,
            gamma_matrix,
            unit_costs,
        )
        if evaluated["totals"]["gross_margin_pct"] < min_gm:
            continue

        signatures.add(signature)
        family_name = FAMILY_PROFILES[(attempts - 1) % len(FAMILY_PROFILES)]["name"]
        candidates.append(
            {
                "family": family_name,
                "group_paths": group_paths,
                "eval": evaluated,
                "signature": signature,
            }
        )


def _promo_duration(path: list[float]) -> int:
    start_idx = next((idx for idx, value in enumerate(path) if value > 0), None)
    if start_idx is None:
        return 0
    return len(path) - start_idx


def _candidate_has_valid_promo(
    group_paths: dict[str, list[float]],
    min_weeks: int,
    max_weeks: int,
    enforce_all_groups_active: bool = False,
) -> bool:
    any_active = False
    allowed_levels = set(PROMO_ALLOWED_LEVELS)
    for path in group_paths.values():
        if any(float(value) not in allowed_levels for value in path):
            return False
        duration = _promo_duration(path)
        if duration == 0:
            if enforce_all_groups_active:
                return False
            continue
        any_active = True
        if duration < min_weeks or duration > max_weeks:
            return False
        start_idx = next((idx for idx, value in enumerate(path) if value > 0), None)
        if start_idx is None:
            return False
        active_slice = path[start_idx:]
        # Promo-active weeks must be real promo levels (>=10%), not 0%.
        if any(float(value) < 10.0 for value in active_slice):
            return False
    return any_active


def _snap_promo_level(value: Any) -> float:
    parsed = _safe_float(value, 0.0)
    return min(PROMO_ALLOWED_LEVELS, key=lambda allowed: abs(float(allowed) - parsed))


def _evaluate_candidate(
    group_paths: dict[str, list[float]],
    groups: list[dict[str, Any]],
    base_prices: list[float],
    base_volumes: list[float],
    beta_ppu: list[float],
    gamma_matrix: list[list[float]],
    unit_costs: list[float],
) -> dict[str, Any]:
    n = len(base_prices)
    weekly_base_volumes = [max(1e-6, base_volumes[i] / PROMO_WEEKS) for i in range(n)]
    weekly_beta = [beta_ppu[i] / PROMO_WEEKS for i in range(n)]
    weekly_gamma = [[gamma_matrix[i][j] / PROMO_WEEKS for j in range(n)] for i in range(n)]

    total_volume = 0.0
    total_revenue = 0.0
    total_profit = 0.0

    product_volume = [0.0] * n
    product_revenue = [0.0] * n
    product_profit = [0.0] * n

    for week_idx in range(PROMO_WEEKS):
        prices = base_prices.copy()
        for group in groups:
            discount = float(group_paths[group["group_id"]][week_idx])
            factor = max(0.01, 1.0 - discount / 100.0)
            for p_idx in group["indices"]:
                prices[p_idx] = max(1.0, base_prices[p_idx] * factor)

        deltas = [prices[i] - base_prices[i] for i in range(n)]
        volumes_week = [0.0] * n
        has_any_price_change = any(abs(delta) > 1e-9 for delta in deltas)
        for i in range(n):
            own_term = weekly_beta[i] * deltas[i]
            cross_term = 0.0
            if has_any_price_change:
                for j in range(n):
                    if i == j:
                        continue
                    cross_term -= weekly_gamma[i][j] * deltas[j] * SUBTLE_CROSS_WEIGHT
            predicted = weekly_base_volumes[i] + own_term + cross_term
            volumes_week[i] = max(0.01, predicted)

        for i in range(n):
            q = volumes_week[i]
            p = prices[i]
            revenue = p * q
            profit = (p - unit_costs[i]) * q

            product_volume[i] += q
            product_revenue[i] += revenue
            product_profit[i] += profit

            total_volume += q
            total_revenue += revenue
            total_profit += profit

    gross_margin_pct = 0.0 if total_revenue <= 0 else (total_profit / total_revenue) * 100.0
    return {
        "totals": {
            "total_volume": float(total_volume),
            "total_revenue": float(total_revenue),
            "total_profit": float(total_profit),
            "gross_margin_pct": float(gross_margin_pct),
        },
        "product_volume": product_volume,
        "product_revenue": product_revenue,
        "product_profit": product_profit,
    }


def _enrich_candidate(
    candidate: dict[str, Any],
    *,
    base_totals: dict[str, float],
    objective: str,
) -> dict[str, Any]:
    totals = candidate["eval"]["totals"]
    base_volume = max(1e-6, base_totals["total_volume"])
    base_revenue = max(1e-6, base_totals["total_revenue"])
    base_profit = max(1e-6, abs(base_totals["total_profit"]))
    volume_uplift = (totals["total_volume"] - base_totals["total_volume"]) / base_volume
    revenue_uplift = (totals["total_revenue"] - base_totals["total_revenue"]) / base_revenue
    profit_uplift = (totals["total_profit"] - base_totals["total_profit"]) / base_profit
    if objective == "volume":
        objective_value = totals["total_volume"]
    elif objective == "profit":
        objective_value = totals["total_profit"]
    else:
        objective_value = totals["total_revenue"]
    return {
        **candidate,
        "objective": objective,
        "volume_uplift_pct": volume_uplift,
        "revenue_uplift_pct": revenue_uplift,
        "profit_uplift_pct": profit_uplift,
        "objective_value": objective_value,
    }


def _bucket_family_weights(objective: str, ai_controls: dict[str, Any] | None = None) -> list[float]:
    normalized_objective = _normalize_objective_key(objective) or "revenue"
    if isinstance(ai_controls, dict):
        bucket_mix = ai_controls.get("bucket_mix")
        if isinstance(bucket_mix, dict):
            candidate = bucket_mix.get(normalized_objective)
            if isinstance(candidate, (list, tuple)) and len(candidate) >= len(FAMILY_PROFILES):
                return _normalize_weights(
                    [_safe_float(candidate[0], 0.0), _safe_float(candidate[1], 0.0), _safe_float(candidate[2], 0.0)]
                )
    return _normalize_weights(list(DEFAULT_BUCKET_FAMILY_WEIGHTS.get(normalized_objective, DEFAULT_BUCKET_FAMILY_WEIGHTS["revenue"])))


def _signature_distance_ratio(signature_a: Any, signature_b: Any) -> float:
    if not signature_a or not signature_b:
        return 1.0
    total = 0
    diff = 0
    for group_a, group_b in zip(signature_a, signature_b):
        for week_a, week_b in zip(group_a, group_b):
            total += 1
            if float(week_a) != float(week_b):
                diff += 1
    if total == 0:
        return 0.0
    return diff / total


def _pick_diverse_anchor(
    bucket: list[dict[str, Any]],
    already_selected: list[dict[str, Any]],
    *,
    min_distance_ratio: float = 0.08,
) -> dict[str, Any] | None:
    if not bucket:
        return None
    if not already_selected:
        return bucket[0]

    selected_signatures = [item.get("signature") for item in already_selected]
    relaxed_thresholds = [min_distance_ratio, min_distance_ratio * 0.75, min_distance_ratio * 0.5, 0.0]

    for threshold in relaxed_thresholds:
        for candidate in bucket:
            signature = candidate.get("signature")
            if not signature:
                continue
            distances = [
                _signature_distance_ratio(signature, selected_signature)
                for selected_signature in selected_signatures
            ]
            if distances and min(distances) >= threshold:
                return candidate

    return bucket[0]


def optimize_promo_calendar(
    request: PromoCalendarRequest,
    progress_callback: ProgressCallback | None = None,
) -> PromoCalendarResponse:
    local_overrides, local_month = _load_local_base_ladder_overrides()
    effective_overrides = request.base_price_overrides or local_overrides
    effective_month = request.selected_month or local_month

    _progress(progress_callback, 8, "Loading portfolio baseline")
    all_rows = load_portfolio_rows()
    selected_month, month_rows = select_month_rows(all_rows, effective_month)
    rows = _sorted_rows(month_rows)
    scope_keys = _scope_keys_from_overrides(effective_overrides)
    rows = _filter_rows_by_scope(rows, scope_keys)
    if len(rows) < 2:
        raise ValueError("At least 2 scoped products are required for promo planning. Check result input product mapping.")

    _progress(progress_callback, 18, "Preparing elasticity context")
    own_current = build_own_elasticities(rows)
    cross_current = build_cross_elasticity_matrix(rows)
    cross_current = [
        [0.0 if i == j else float(value) * CROSS_IMPACT_GLOBAL_SCALE for j, value in enumerate(row_values)]
        for i, row_values in enumerate(cross_current)
    ]
    own_base, cross_base, base_volumes = convert_to_base_reference(rows, own_current, cross_current)
    base_prices = _resolve_anchor_base_prices(rows, effective_overrides)
    base_volumes = _resolve_anchor_base_volumes(rows, [float(v) for v in base_volumes], effective_overrides)
    beta_ppu, gamma_matrix = build_beta_and_gamma(
        rows,
        own_elasticities=own_base,
        cross_elasticity_matrix=cross_base,
        reference_prices=base_prices,
        reference_volumes=base_volumes,
    )
    _persist_context_snapshot(
        selected_month=selected_month,
        rows=rows,
        base_prices=base_prices,
        base_volumes=base_volumes,
        own_base=own_base,
        cross_base=cross_base,
        beta_ppu=beta_ppu,
        gamma_matrix=gamma_matrix,
    )
    unit_costs = [price * COGS_RATIO for price in base_prices]
    groups = _build_price_groups(base_prices)

    min_weeks, max_weeks = _normalize_weeks(request.min_promo_weeks, request.max_promo_weeks)
    start_candidates = _promo_start_candidates(min_weeks, max_weeks)
    requested_count = int(_safe_float(request.scenario_count, TOTAL_TARGET))
    target_count = max(3, min(TOTAL_TARGET, requested_count))
    min_gm = max(20.0, min(60.0, float(request.min_gross_margin_pct)))
    enforce_all_groups_active = min_weeks > 0
    ai_controls = _resolve_ai_generation_controls(getattr(request, "prompt", None))

    _progress(progress_callback, 28, "Generating scenarios")
    seed_value = abs(
        hash(
            (
                selected_month,
                min_gm,
                request.min_promo_weeks,
                request.max_promo_weeks,
                ai_controls.get("step_up_pace_bias"),
                ai_controls.get("coverage_bias"),
                tuple(round(weight, 6) for weight in ai_controls["bucket_mix"]["volume"]),
                tuple(round(weight, 6) for weight in ai_controls["bucket_mix"]["revenue"]),
                tuple(round(weight, 6) for weight in ai_controls["bucket_mix"]["profit"]),
            )
        )
    ) % (2**31 - 1)
    rng = random.Random(seed_value)

    baseline_paths = {group["group_id"]: [0.0] * PROMO_WEEKS for group in groups}
    baseline_eval = _evaluate_candidate(
        baseline_paths,
        groups,
        base_prices,
        base_volumes,
        beta_ppu,
        gamma_matrix,
        unit_costs,
    )
    base_totals = baseline_eval["totals"]

    global_signatures: set[Any] = set()
    bucket_results: dict[str, list[dict[str, Any]]] = {objective: [] for objective in OBJECTIVE_BUCKETS}

    for objective_idx, objective in enumerate(OBJECTIVE_BUCKETS):
        _progress(progress_callback, 36 + objective_idx * 12, f"Sampling {objective.title()} scenarios")
        objective_rng = random.Random(seed_value + (objective_idx + 1) * 1009)
        family_weights = _bucket_family_weights(objective, ai_controls)
        pace_bias = _normalize_step_up_pace(ai_controls.get("step_up_pace_bias"))
        coverage_bias = _normalize_coverage_bias(ai_controls.get("coverage_bias"))
        bucket: list[dict[str, Any]] = []
        local_signatures: set[Any] = set()

        attempts = 0
        attempt_limit = 1_500_000
        while len(bucket) < BUCKET_SIZE and attempts < attempt_limit:
            attempts += 1
            sampled_family = objective_rng.choices(list(FAMILY_PROFILES), weights=family_weights, k=1)[0]
            family = _apply_family_generation_biases(
                sampled_family,
                step_up_pace_bias=pace_bias,
                coverage_bias=coverage_bias,
            )
            group_paths: dict[str, list[float]] = {}
            signature_parts = []
            for group in groups:
                path = _sample_group_path(
                    objective_rng,
                    family,
                    start_candidates,
                    min_weeks,
                    max_weeks,
                    allow_no_promo=not enforce_all_groups_active,
                )
                group_paths[group["group_id"]] = path
                signature_parts.append(tuple(path))
            signature = tuple(signature_parts)
            if signature in global_signatures or signature in local_signatures:
                continue

            if not _candidate_has_valid_promo(
                group_paths,
                min_weeks,
                max_weeks,
                enforce_all_groups_active=enforce_all_groups_active,
            ):
                continue

            evaluated = _evaluate_candidate(
                group_paths,
                groups,
                base_prices,
                base_volumes,
                beta_ppu,
                gamma_matrix,
                unit_costs,
            )
            if evaluated["totals"]["gross_margin_pct"] < min_gm:
                continue

            candidate = _enrich_candidate(
                {
                    "family": family["name"],
                    "group_paths": group_paths,
                    "eval": evaluated,
                    "signature": signature,
                },
                base_totals=base_totals,
                objective=objective,
            )
            bucket.append(candidate)
            local_signatures.add(signature)
            global_signatures.add(signature)

        bucket_sorted = sorted(
            bucket,
            key=lambda item: (
                item["objective_value"],
                item["revenue_uplift_pct"],
                item["profit_uplift_pct"],
                item["volume_uplift_pct"],
            ),
            reverse=True,
        )
        bucket_results[objective] = bucket_sorted[:BUCKET_SIZE]

    _progress(progress_callback, 74, "Ranking scenarios")

    volume_bucket = bucket_results["volume"]
    revenue_bucket = bucket_results["revenue"]
    profit_bucket = bucket_results["profit"]

    selected: list[dict[str, Any]] = []
    seen_signatures: set[Any] = set()

    def add_anchor(bucket: list[dict[str, Any]], anchor_label: str) -> None:
        candidate = _pick_diverse_anchor(bucket, selected, min_distance_ratio=0.08)
        if candidate is None:
            return
        signature = candidate.get("signature")
        if signature in seen_signatures:
            for fallback in bucket:
                fallback_signature = fallback.get("signature")
                if fallback_signature in seen_signatures:
                    continue
                seen_signatures.add(fallback_signature)
                selected.append({**fallback, "_anchor_label": anchor_label})
                return
            return
        seen_signatures.add(signature)
        selected.append({**candidate, "_anchor_label": anchor_label})

    # Ensure first 3 anchors are objective-specific and calendar-diverse.
    add_anchor(volume_bucket, "Max Volume")
    add_anchor(revenue_bucket, "Max Revenue")
    add_anchor(profit_bucket, "Max Profit")

    max_len = max(len(volume_bucket), len(revenue_bucket), len(profit_bucket))
    for idx in range(max_len):
        for bucket in (volume_bucket, revenue_bucket, profit_bucket):
            if idx >= len(bucket):
                continue
            candidate = bucket[idx]
            signature = candidate.get("signature")
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)
            selected.append(candidate)
            if len(selected) >= target_count:
                break
        if len(selected) >= target_count:
            break

    if len(selected) < target_count:
        combined_sorted = sorted(
            [*volume_bucket, *revenue_bucket, *profit_bucket],
            key=lambda item: (
                item["revenue_uplift_pct"] + item["profit_uplift_pct"] + item["volume_uplift_pct"],
                item["revenue_uplift_pct"],
                item["profit_uplift_pct"],
                item["volume_uplift_pct"],
            ),
            reverse=True,
        )
        for candidate in combined_sorted:
            signature = candidate.get("signature")
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)
            selected.append(candidate)
            if len(selected) >= target_count:
                break

    if not selected:
        raise ValueError(
            "No feasible promo scenarios under current constraints. "
            "Relax min gross margin or promo-week limits and retry."
        )

    # Final hard gate before formatting: never return scenarios violating promo constraints.
    validated_selected: list[dict[str, Any]] = []
    for item in selected:
        if _candidate_has_valid_promo(
            item["group_paths"],
            min_weeks,
            max_weeks,
            enforce_all_groups_active=enforce_all_groups_active,
        ):
            validated_selected.append(item)

    if not validated_selected:
        raise ValueError(
            "No feasible promo scenarios after applying min/max promo-week constraints."
        )
    selected = validated_selected

    _progress(progress_callback, 90, "Formatting output")
    scenario_summaries: list[PromoScenarioSummary] = []
    scenario_details: dict[str, PromoScenarioDetail] = {}
    best_volume_id = None
    best_revenue_id = None
    best_profit_id = None

    for rank, item in enumerate(selected, start=1):
        scenario_id = str(rank)
        anchor_label = item.get("_anchor_label")
        name = str(anchor_label) if anchor_label else f"{item['family']} {scenario_id}"
        totals = item["eval"]["totals"]
        if anchor_label == "Max Volume":
            best_volume_id = scenario_id
        if anchor_label == "Max Revenue":
            best_revenue_id = scenario_id
        if anchor_label == "Max Profit":
            best_profit_id = scenario_id

        scenario_summaries.append(
            PromoScenarioSummary(
                scenario_id=scenario_id,
                scenario_name=name,
                scenario_family=str(item["family"]),
                rank=rank,
                objective_value=float(totals["total_revenue"]),
                total_volume=float(totals["total_volume"]),
                total_revenue=float(totals["total_revenue"]),
                total_profit=float(totals["total_profit"]),
                volume_uplift_pct=float(item["volume_uplift_pct"]),
                revenue_uplift_pct=float(item["revenue_uplift_pct"]),
                profit_uplift_pct=float(item["profit_uplift_pct"]),
            )
        )

        product_impacts: list[PromoProductImpact] = []
        for idx, row in enumerate(rows):
            base_q = float(base_volumes[idx])
            base_p = float(base_prices[idx])
            new_q = float(item["eval"]["product_volume"][idx])
            new_revenue = float(item["eval"]["product_revenue"][idx])
            new_profit = float(item["eval"]["product_profit"][idx])
            base_revenue_product = base_p * base_q
            base_profit_product = (base_p - unit_costs[idx]) * base_q
            avg_price = base_p if new_q <= 1e-6 else new_revenue / new_q
            product_impacts.append(
                PromoProductImpact(
                    product_name=str(row.get("productName", f"P{idx + 1}")),
                    base_price=base_p,
                    avg_price=float(avg_price),
                    current_volume=base_q,
                    new_volume=new_q,
                    volume_change_pct=0.0 if base_q <= 1e-9 else (new_q - base_q) / base_q,
                    current_revenue=base_revenue_product,
                    new_revenue=new_revenue,
                    revenue_change_pct=0.0 if base_revenue_product <= 1e-9 else (new_revenue - base_revenue_product) / base_revenue_product,
                    current_profit=base_profit_product,
                    new_profit=new_profit,
                    profit_change_pct=0.0 if abs(base_profit_product) <= 1e-9 else (new_profit - base_profit_product) / abs(base_profit_product),
                )
            )

        group_calendars = [
            PromoWeeklyGroupCalendar(
                group_id=group["group_id"],
                group_name=group["group_name"],
                base_price=float(group["base_price"]),
                product_count=len(group["indices"]),
                weekly_discounts=[float(v) for v in item["group_paths"][group["group_id"]]],
            )
            for group in groups
        ]
        scenario_details[scenario_id] = PromoScenarioDetail(
            scenario_id=scenario_id,
            totals=PromoPortfolioTotals(
                total_volume=float(totals["total_volume"]),
                total_revenue=float(totals["total_revenue"]),
                total_profit=float(totals["total_profit"]),
            ),
            group_calendars=group_calendars,
            product_impacts=product_impacts,
        )

    selected_scenario_id = scenario_summaries[0].scenario_id

    if not best_volume_id:
        best_volume_id = max(scenario_summaries, key=lambda row: row.volume_uplift_pct).scenario_id
    if not best_revenue_id:
        best_revenue_id = max(scenario_summaries, key=lambda row: row.revenue_uplift_pct).scenario_id
    if not best_profit_id:
        best_profit_id = max(scenario_summaries, key=lambda row: row.profit_uplift_pct).scenario_id

    _progress(progress_callback, 98, "Completed")
    return PromoCalendarResponse(
        controls=request,
        selected_month=selected_month,
        selected_scenario_id=selected_scenario_id,
        base_totals=PromoPortfolioTotals(
            total_volume=float(base_totals["total_volume"]),
            total_revenue=float(base_totals["total_revenue"]),
            total_profit=float(base_totals["total_profit"]),
        ),
        selected_totals=scenario_details[selected_scenario_id].totals,
        scenario_summaries=scenario_summaries,
        scenario_details=scenario_details,
        best_markers=PromoBestMarkers(
            best_volume_scenario_id=best_volume_id,
            best_revenue_scenario_id=best_revenue_id,
            best_profit_scenario_id=best_profit_id,
        ),
    )


def recalculate_promo_calendar(payload: PromoCalendarRecalculateRequest) -> PromoCalendarRecalculateResponse:
    local_overrides, local_month = _load_local_base_ladder_overrides()
    effective_overrides = payload.base_price_overrides or local_overrides
    effective_month = payload.selected_month or local_month

    all_rows = load_portfolio_rows()
    selected_month, month_rows = select_month_rows(all_rows, effective_month)
    rows = _sorted_rows(month_rows)
    scope_keys = _scope_keys_from_overrides(effective_overrides)
    rows = _filter_rows_by_scope(rows, scope_keys)
    if len(rows) < 2:
        raise ValueError("At least 2 scoped products are required for promo recalculation. Check result input product mapping.")

    own_current = build_own_elasticities(rows)
    cross_current = build_cross_elasticity_matrix(rows)
    cross_current = [
        [0.0 if i == j else float(value) * CROSS_IMPACT_GLOBAL_SCALE for j, value in enumerate(row_values)]
        for i, row_values in enumerate(cross_current)
    ]
    own_base, cross_base, base_volumes = convert_to_base_reference(rows, own_current, cross_current)
    base_prices = _resolve_anchor_base_prices(rows, effective_overrides)
    base_volumes = _resolve_anchor_base_volumes(rows, [float(v) for v in base_volumes], effective_overrides)
    beta_ppu, gamma_matrix = build_beta_and_gamma(
        rows,
        own_elasticities=own_base,
        cross_elasticity_matrix=cross_base,
        reference_prices=base_prices,
        reference_volumes=base_volumes,
    )
    _persist_context_snapshot(
        selected_month=selected_month,
        rows=rows,
        base_prices=base_prices,
        base_volumes=base_volumes,
        own_base=own_base,
        cross_base=cross_base,
        beta_ppu=beta_ppu,
        gamma_matrix=gamma_matrix,
    )
    unit_costs = [price * COGS_RATIO for price in base_prices]
    groups = _build_price_groups(base_prices)

    baseline_paths = {group["group_id"]: [0.0] * PROMO_WEEKS for group in groups}
    baseline_eval = _evaluate_candidate(
        baseline_paths,
        groups,
        base_prices,
        base_volumes,
        beta_ppu,
        gamma_matrix,
        unit_costs,
    )
    base_totals = baseline_eval["totals"]

    incoming_map: dict[str, list[float]] = {
        str(item.group_id): [float(_snap_promo_level(level)) for level in (item.weekly_discounts or [])]
        for item in payload.group_calendars
    }

    group_paths: dict[str, list[float]] = {}
    for group in groups:
        group_id = str(group["group_id"])
        raw = incoming_map.get(group_id, [])
        padded = (raw + [0.0] * PROMO_WEEKS)[:PROMO_WEEKS]
        normalized: list[float] = [float(_snap_promo_level(level)) for level in padded]
        group_paths[group_id] = normalized

    evaluated = _evaluate_candidate(
        group_paths,
        groups,
        base_prices,
        base_volumes,
        beta_ppu,
        gamma_matrix,
        unit_costs,
    )
    totals = evaluated["totals"]

    product_impacts: list[PromoProductImpact] = []
    for idx, row in enumerate(rows):
        base_q = float(base_volumes[idx])
        base_p = float(base_prices[idx])
        new_q = float(evaluated["product_volume"][idx])
        new_revenue = float(evaluated["product_revenue"][idx])
        new_profit = float(evaluated["product_profit"][idx])
        base_revenue_product = base_p * base_q
        base_profit_product = (base_p - unit_costs[idx]) * base_q
        avg_price = base_p if new_q <= 1e-6 else new_revenue / new_q
        product_impacts.append(
            PromoProductImpact(
                product_name=str(row.get("productName", f"P{idx + 1}")),
                base_price=base_p,
                avg_price=float(avg_price),
                current_volume=base_q,
                new_volume=new_q,
                volume_change_pct=0.0 if base_q <= 1e-9 else (new_q - base_q) / base_q,
                current_revenue=base_revenue_product,
                new_revenue=new_revenue,
                revenue_change_pct=0.0 if base_revenue_product <= 1e-9 else (new_revenue - base_revenue_product) / base_revenue_product,
                current_profit=base_profit_product,
                new_profit=new_profit,
                profit_change_pct=0.0 if abs(base_profit_product) <= 1e-9 else (new_profit - base_profit_product) / abs(base_profit_product),
            )
        )

    group_calendars = [
        PromoWeeklyGroupCalendar(
            group_id=group["group_id"],
            group_name=group["group_name"],
            base_price=float(group["base_price"]),
            product_count=len(group["indices"]),
            weekly_discounts=[float(v) for v in group_paths[group["group_id"]]],
        )
        for group in groups
    ]

    base_volume = max(1e-6, base_totals["total_volume"])
    base_revenue = max(1e-6, base_totals["total_revenue"])
    base_profit = max(1e-6, abs(base_totals["total_profit"]))
    volume_uplift_pct = (totals["total_volume"] - base_totals["total_volume"]) / base_volume
    revenue_uplift_pct = (totals["total_revenue"] - base_totals["total_revenue"]) / base_revenue
    profit_uplift_pct = (totals["total_profit"] - base_totals["total_profit"]) / base_profit

    return PromoCalendarRecalculateResponse(
        selected_month=selected_month,
        totals=PromoPortfolioTotals(
            total_volume=float(totals["total_volume"]),
            total_revenue=float(totals["total_revenue"]),
            total_profit=float(totals["total_profit"]),
        ),
        volume_uplift_pct=float(volume_uplift_pct),
        revenue_uplift_pct=float(revenue_uplift_pct),
        profit_uplift_pct=float(profit_uplift_pct),
        group_calendars=group_calendars,
        product_impacts=product_impacts,
    )


def _resolve_raw_promo_file() -> Path:
    cwd = Path.cwd()
    exact = cwd / RAW_PROMO_FILE_NAME
    if exact.exists():
        return exact
    candidates = sorted(
        [path for path in cwd.glob("*.xlsx") if "base_ladder_saved_scenarios" not in path.name.lower()],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if candidates:
        return candidates[0]
    raise FileNotFoundError(f"Raw promo file not found in {cwd}. Expected `{RAW_PROMO_FILE_NAME}`.")


@lru_cache(maxsize=4)
def _load_raw_promo_dataframe_cached(file_path: str, file_mtime: float) -> pd.DataFrame:
    df = pd.read_excel(file_path, sheet_name=0)
    required = {"Brand", "PPG", "Year", "Week", "Channel", "BasePrice", "Price", "Volume"}
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise ValueError(f"Raw promo file is missing required columns: {', '.join(missing)}")

    clean = df.copy()
    clean["Brand"] = pd.to_numeric(clean["Brand"], errors="coerce")
    clean["Year"] = pd.to_numeric(clean["Year"], errors="coerce")
    clean["Week"] = pd.to_numeric(clean["Week"], errors="coerce")
    clean["BasePrice"] = pd.to_numeric(clean["BasePrice"], errors="coerce")
    clean["Price"] = pd.to_numeric(clean["Price"], errors="coerce")
    clean["Volume"] = pd.to_numeric(clean["Volume"], errors="coerce")
    clean["Channel"] = clean["Channel"].astype(str).str.strip()
    clean["PPG"] = clean["PPG"].astype(str).str.strip()

    clean = clean.dropna(subset=["Brand", "Year", "Week", "BasePrice", "Price", "Volume"])
    clean = clean[(clean["BasePrice"] > 0) & (clean["Price"] > 0) & (clean["Volume"] >= 0)]
    clean["Brand"] = clean["Brand"].astype(int)
    clean["Year"] = clean["Year"].astype(int)
    clean["Week"] = clean["Week"].astype(int)
    clean["product_name"] = clean.apply(lambda row: f"Brand {int(row['Brand'])} | {row['PPG']}", axis=1)
    clean["product_key"] = clean["product_name"].map(_normalize_product_key)
    clean["discount_pct"] = ((clean["BasePrice"] - clean["Price"]) / clean["BasePrice"]) * 100.0
    clean["discount_pct"] = clean["discount_pct"].clip(lower=0.0, upper=95.0)
    return clean


def _load_raw_promo_dataframe() -> tuple[pd.DataFrame, Path]:
    source = _resolve_raw_promo_file()
    df = _load_raw_promo_dataframe_cached(str(source), source.stat().st_mtime)
    return df.copy(), source


def _get_result_input_scope_keys() -> set[str]:
    overrides, _ = _load_local_base_ladder_overrides()
    return {
        _normalize_product_key(item.get("product_name"))
        for item in overrides
        if _normalize_product_key(item.get("product_name"))
    }


def _apply_raw_filters(df: pd.DataFrame, selected_year: int | None, selected_channel: str | None) -> tuple[pd.DataFrame, int, str, list[int], list[str]]:
    if df.empty:
        raise ValueError("Raw promo dataset is empty.")
    years = sorted(int(year) for year in df["Year"].dropna().unique().tolist())
    channels = sorted(str(channel) for channel in df["Channel"].dropna().unique().tolist())
    year = int(selected_year) if selected_year in years else years[-1]
    channel = str(selected_channel) if selected_channel in channels else (channels[0] if channels else "ALLINDIA")
    filtered = df[(df["Year"] == year) & (df["Channel"] == channel)].copy()
    if filtered.empty:
        raise ValueError(f"No raw promo rows found for Year={year}, Channel={channel}.")
    return filtered, year, channel, years, channels


def _regression_elasticity(prices: list[float], volumes: list[float]) -> float:
    pairs = [(math.log(p), math.log(v)) for p, v in zip(prices, volumes) if p > 0 and v > 0]
    if len(pairs) < 3:
        return -1.2
    xs = [x for x, _ in pairs]
    ys = [y for _, y in pairs]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    denom = sum((x - mean_x) ** 2 for x in xs)
    if abs(denom) <= 1e-12:
        return -1.2
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
    if not math.isfinite(slope):
        return -1.2
    slope = -abs(float(slope))
    return max(-5.0, min(-0.2, slope))


def _bucket_elasticity(
    *,
    df: pd.DataFrame,
    target_discount: int,
    base_price: float,
    base_volume: float,
    fallback: float,
) -> float:
    bucket = df[df["discount_pct"].between(target_discount - 5, target_discount + 5)]
    if bucket.empty:
        return max(-5.0, min(-0.2, fallback * (1.0 + (target_discount / 100.0) * 0.25)))

    price_at_bucket = float(bucket["Price"].mean())
    volume_at_bucket = float(bucket["Volume"].mean())
    if base_price <= 0 or base_volume <= 0 or price_at_bucket <= 0 or volume_at_bucket <= 0:
        return max(-5.0, min(-0.2, fallback))

    pct_p = (price_at_bucket - base_price) / base_price
    if abs(pct_p) <= 1e-9:
        return max(-5.0, min(-0.2, fallback))
    pct_q = (volume_at_bucket - base_volume) / base_volume
    value = pct_q / pct_p
    if not math.isfinite(value):
        value = fallback
    value = -abs(float(value))
    return max(-5.0, min(-0.2, value))


def _fit_linear_demand(prices: list[float], volumes: list[float]) -> tuple[float, float] | None:
    pairs = [(float(p), float(v)) for p, v in zip(prices, volumes) if float(p) > 0 and float(v) > 0]
    if len(pairs) < 2:
        return None
    n = float(len(pairs))
    sum_x = sum(p for p, _ in pairs)
    sum_y = sum(v for _, v in pairs)
    sum_xx = sum(p * p for p, _ in pairs)
    sum_xy = sum(p * v for p, v in pairs)
    denom = n * sum_xx - (sum_x * sum_x)
    if abs(denom) <= 1e-9:
        return None
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    if not (math.isfinite(slope) and math.isfinite(intercept)):
        return None
    return float(intercept), float(slope)


def _point_elasticity_series(
    *,
    prices: list[float],
    volumes: list[float],
    base_price: float,
    base_volume: float,
    fallback: float,
) -> tuple[float, float, float, float, float]:
    # Point elasticity definition: E(P) = (dQ/dP) * (P / Q(P)).
    fit = _fit_linear_demand(prices, volumes)

    if fit is not None:
        intercept, slope = fit
    else:
        slope = (float(fallback) * max(float(base_volume), 1.0)) / max(float(base_price), 1e-6)
        intercept = max(float(base_volume), 1.0) - slope * float(base_price)

    # Force economically sensible own-price response.
    if slope >= 0:
        slope = -abs((float(fallback) * max(float(base_volume), 1.0)) / max(float(base_price), 1e-6))
        intercept = max(float(base_volume), 1.0) - slope * float(base_price)

    # Keep base point feasible.
    q_base = intercept + slope * float(base_price)
    if q_base <= 1e-6:
        intercept = max(float(base_volume), 1.0) - slope * float(base_price)

    levels = [0, 10, 20, 30, 40]
    values: list[float] = []
    prev = None
    for discount in levels:
        price_point = max(1e-6, float(base_price) * (1.0 - discount / 100.0))
        volume_point = max(1.0, intercept + slope * price_point)
        elasticity = slope * price_point / volume_point
        if not math.isfinite(elasticity):
            elasticity = float(fallback)
        elasticity = -abs(float(elasticity))
        elasticity = max(-5.0, min(-0.2, elasticity))
        # With higher discount (lower P), elasticity should move toward zero (non-decreasing numerically).
        if prev is not None and elasticity < prev:
            elasticity = prev
        prev = elasticity
        values.append(elasticity)

    return float(values[0]), float(values[1]), float(values[2]), float(values[3]), float(values[4])


def get_historical_promo_calendar(
    selected_year: int | None = None,
    selected_channel: str | None = None,
) -> PromoHistoricalResponse:
    raw_df, source_file = _load_raw_promo_dataframe()
    scope_keys = _get_result_input_scope_keys()
    if scope_keys:
        raw_df = raw_df[raw_df["product_key"].isin(scope_keys)].copy()
    filtered, year, channel, years, channels = _apply_raw_filters(raw_df, selected_year, selected_channel)
    weeks = sorted(int(week) for week in filtered["Week"].dropna().unique().tolist())
    grouped = (
        filtered.groupby(["product_name", "Brand", "PPG", "Week"], as_index=False)
        .agg(
            discount_pct=("discount_pct", "mean"),
            price=("Price", "mean"),
            base_price=("BasePrice", "mean"),
            volume=("Volume", "sum"),
        )
    )

    products: list[PromoHistoricalProductRow] = []
    for (product_name, brand, ppg), chunk in grouped.groupby(["product_name", "Brand", "PPG"], as_index=False):
        by_week = {int(row["Week"]): row for _, row in chunk.iterrows()}
        weekly_discount = [float(by_week[week]["discount_pct"]) if week in by_week else 0.0 for week in weeks]
        weekly_price = [float(by_week[week]["price"]) if week in by_week else float(chunk["base_price"].mean()) for week in weeks]
        products.append(
            PromoHistoricalProductRow(
                product_name=str(product_name),
                brand=int(brand),
                ppg=str(ppg),
                base_price=float(chunk["base_price"].mean()),
                total_volume=float(chunk["volume"].sum()),
                avg_discount_pct=float(chunk["discount_pct"].mean()),
                weekly_discount_pct=weekly_discount,
                weekly_price=weekly_price,
            )
        )
    products.sort(key=lambda row: (row.base_price, row.product_name))
    return PromoHistoricalResponse(
        source_file=str(source_file.name),
        selected_year=int(year),
        selected_channel=str(channel),
        available_years=years,
        available_channels=channels,
        weeks=weeks,
        products=products,
    )


def get_promo_elasticity_insights(
    selected_year: int | None = None,
    selected_channel: str | None = None,
) -> PromoElasticityInsightsResponse:
    raw_df, source_file = _load_raw_promo_dataframe()
    scope_keys = _get_result_input_scope_keys()
    if scope_keys:
        raw_df = raw_df[raw_df["product_key"].isin(scope_keys)].copy()
    filtered, year, channel, years, channels = _apply_raw_filters(raw_df, selected_year, selected_channel)

    products: list[PromoElasticityInsightRow] = []
    for (product_name, brand, ppg), chunk in filtered.groupby(["product_name", "Brand", "PPG"], as_index=False):
        prices = [float(value) for value in chunk["Price"].tolist()]
        volumes = [float(value) for value in chunk["Volume"].tolist()]
        base_price = float(chunk["BasePrice"].median())
        base_rows = chunk[chunk["discount_pct"] <= 2.0]
        base_volume = float(base_rows["Volume"].mean()) if not base_rows.empty else float(chunk["Volume"].mean())
        base_elasticity = _regression_elasticity(prices, volumes)
        e0, e10, e20, e30, e40 = _point_elasticity_series(
            prices=prices,
            volumes=volumes,
            base_price=base_price,
            base_volume=base_volume,
            fallback=base_elasticity,
        )

        products.append(
            PromoElasticityInsightRow(
                product_name=str(product_name),
                brand=int(brand),
                ppg=str(ppg),
                base_price=base_price,
                base_elasticity=float(e0),
                elasticity_10=float(e10),
                elasticity_20=float(e20),
                elasticity_30=float(e30),
                elasticity_40=float(e40),
            )
        )

    products.sort(key=lambda row: (row.base_price, row.product_name))
    return PromoElasticityInsightsResponse(
        source_file=str(source_file.name),
        selected_year=int(year),
        selected_channel=str(channel),
        available_years=years,
        available_channels=channels,
        products=products,
    )
