from __future__ import annotations

import json
import os
import random
import urllib.error
import urllib.request
from itertools import product
from typing import Any, Callable

from backend.schemas.asp_determination import (
    AspOptimizationRequest,
    AspOptimizationResponse,
    OptimizationModelContext,
    PortfolioTotals,
    ProductOptimizationResult,
    ScenarioDetail,
    ScenarioSummary,
    SummaryMetrics,
)
from backend.utils.asp_result_formatter import build_product_results, build_summary, build_totals
from backend.utils.data_loader import load_portfolio_rows, select_month_rows
from backend.utils.elasticity_utils import (
    build_beta_and_gamma,
    build_cross_elasticity_matrix,
    build_own_elasticities,
    convert_to_base_reference,
)


ProgressCallback = Callable[[int, str], None]

TOP_SCENARIOS_DEFAULT = 1000
TOP_SCENARIOS_MAX = 1000
RAW_POOL_MIN = 8000
RAW_POOL_MAX = 20000
RAW_POOL_MULTIPLIER = 12
CANDIDATE_OFFSETS = (-100.0, -50.0, 0.0, 50.0, 100.0)
FIXED_COGS_PCT = 40.0
MIN_GROSS_MARGIN_PCT = 20.0
MAX_GROSS_MARGIN_PCT = 60.0
FAMILY_SIMILARITY_THRESHOLD = 0.88
SEGMENT_DAILY = "daily_casual"
SEGMENT_CORE = "core_plus"
SEGMENT_PREMIUM = "premium"
SEGMENT_KEYS = (SEGMENT_DAILY, SEGMENT_CORE, SEGMENT_PREMIUM)


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed


def _progress(callback: ProgressCallback | None, pct: int, stage: str) -> None:
    if callback:
        callback(max(0, min(100, int(pct))), str(stage or ""))


def _segment_for_base_price(base_price: float) -> str:
    if base_price <= 599:
        return SEGMENT_DAILY
    if base_price <= 899:
        return SEGMENT_CORE
    return SEGMENT_PREMIUM


def _normalize_segment_constraints(
    raw_constraints: dict[str, dict[str, float | bool]] | None,
) -> dict[str, dict[str, float | bool]]:
    normalized: dict[str, dict[str, float | bool]] = {}
    source = raw_constraints or {}
    for key in SEGMENT_KEYS:
        raw = source.get(key) if isinstance(source, dict) else None
        if not isinstance(raw, dict):
            raw = {}
        no_change = bool(raw.get("no_change", False))
        max_decrease = max(0.0, min(150.0, _safe_float(raw.get("max_decrease"), 100.0)))
        max_increase = max(0.0, min(150.0, _safe_float(raw.get("max_increase"), 100.0)))
        normalized[key] = {
            "no_change": no_change,
            "max_decrease": max_decrease,
            "max_increase": max_increase,
        }
    return normalized


def _allowed_offsets_for_segment(segment_constraint: dict[str, float | bool]) -> list[float]:
    if bool(segment_constraint.get("no_change", False)):
        return [0.0]

    max_decrease = _safe_float(segment_constraint.get("max_decrease"), 100.0)
    max_increase = _safe_float(segment_constraint.get("max_increase"), 100.0)
    offsets = [0.0]
    for offset in CANDIDATE_OFFSETS:
        if offset < 0 and abs(offset) <= max_decrease + 1e-9:
            offsets.append(float(offset))
        elif offset > 0 and offset <= max_increase + 1e-9:
            offsets.append(float(offset))
    unique_sorted = sorted({float(x) for x in offsets})
    return unique_sorted or [0.0]


def _normalize_scenario_filters(raw_filters: dict[str, float] | None) -> dict[str, float]:
    source = raw_filters or {}
    min_volume = _safe_float(source.get("min_volume_uplift_pct"), -9999.0) / 100.0
    min_revenue = _safe_float(source.get("min_revenue_uplift_pct"), -9999.0) / 100.0
    min_profit = _safe_float(source.get("min_profit_uplift_pct"), -9999.0) / 100.0
    return {
        "min_volume_uplift": min_volume,
        "min_revenue_uplift": min_revenue,
        "min_profit_uplift": min_profit,
    }


def _normalize_product_constraints(
    raw_constraints: dict[str, dict[str, float | bool]] | None,
    sorted_rows: list[dict[str, Any]],
    base_prices: list[float],
) -> dict[str, dict[str, float | bool]]:
    source = raw_constraints or {}
    normalized: dict[str, dict[str, float | bool]] = {}
    for idx, row in enumerate(sorted_rows):
        name = str(row.get("productName", ""))
        base_price = max(1.0, float(base_prices[idx]))
        raw = source.get(name) if isinstance(source, dict) else None
        if not isinstance(raw, dict):
            raw = {}
        no_change = bool(raw.get("no_change", False))
        min_price = max(1.0, _safe_float(raw.get("min_price"), base_price - 100.0))
        max_price = max(1.0, _safe_float(raw.get("max_price"), base_price + 100.0))
        if min_price > max_price:
            min_price, max_price = max_price, min_price
        normalized[name] = {
            "no_change": no_change,
            "min_price": float(round(min_price, 2)),
            "max_price": float(round(max_price, 2)),
        }
    return normalized


def _apply_product_constraint_to_offsets(
    base_price: float,
    allowed_offsets: list[float],
    product_constraint: dict[str, float | bool],
) -> list[float]:
    if bool(product_constraint.get("no_change", False)):
        return [0.0]

    min_price = max(1.0, _safe_float(product_constraint.get("min_price"), base_price - 100.0))
    max_price = max(1.0, _safe_float(product_constraint.get("max_price"), base_price + 100.0))
    if min_price > max_price:
        min_price, max_price = max_price, min_price

    filtered: list[float] = []
    for offset in allowed_offsets:
        next_price = base_price + float(offset)
        if next_price + 1e-9 >= min_price and next_price - 1e-9 <= max_price:
            filtered.append(float(offset))
    if not filtered:
        return [0.0]
    return sorted({float(x) for x in filtered})


def _scenario_passes_filters(
    totals: dict[str, float],
    base_totals: dict[str, float],
    scenario_filters: dict[str, float],
) -> bool:
    base_volume = max(1.0, float(base_totals.get("total_volume", 0.0)))
    base_revenue = max(1.0, float(base_totals.get("total_revenue", 0.0)))
    base_profit = float(base_totals.get("total_profit", 0.0))
    if abs(base_profit) < 1e-9:
        base_profit = 1.0

    volume_uplift = (float(totals["total_volume"]) - base_volume) / base_volume
    revenue_uplift = (float(totals["total_revenue"]) - base_revenue) / base_revenue
    profit_uplift = (float(totals["total_profit"]) - base_profit) / abs(base_profit)

    return (
        volume_uplift >= _safe_float(scenario_filters.get("min_volume_uplift"), -9999.0)
        and revenue_uplift >= _safe_float(scenario_filters.get("min_revenue_uplift"), -9999.0)
        and profit_uplift >= _safe_float(scenario_filters.get("min_profit_uplift"), -9999.0)
    )


def _sorted_rows_for_optimization(month_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        month_rows,
        key=lambda row: (
            _safe_float(row.get("basePrice"), _safe_float(row.get("currentPrice"), 0.0)),
            str(row.get("productName", "")),
        ),
    )


def _build_unit_costs(base_prices: list[float]) -> list[float]:
    cost_ratio = FIXED_COGS_PCT / 100.0
    return [price * cost_ratio for price in base_prices]


def _evaluate_prices(
    prices: list[float],
    base_prices: list[float],
    base_volumes: list[float],
    beta_ppu: list[float],
    gamma_matrix: list[list[float]],
    unit_costs: list[float],
) -> tuple[list[float], dict[str, float]]:
    n = len(prices)
    deltas = [prices[i] - base_prices[i] for i in range(n)]

    volumes: list[float] = []
    for i in range(n):
        own_term = beta_ppu[i] * deltas[i]
        cross_term = 0.0
        gamma_row = gamma_matrix[i]
        for j in range(n):
            if i == j:
                continue
            # Cross-response sign convention:
            # with negative cross elasticities for substitutes, an increase in product-j price
            # should increase product-i volume.
            cross_term -= gamma_row[j] * deltas[j]
        predicted = base_volumes[i] + own_term + cross_term
        volumes.append(max(1.0, predicted))

    total_volume = sum(volumes)
    total_revenue = sum(prices[i] * volumes[i] for i in range(n))
    total_profit = sum((prices[i] - unit_costs[i]) * volumes[i] for i in range(n))
    totals = {
        "total_volume": float(total_volume),
        "total_revenue": float(total_revenue),
        "total_profit": float(total_profit),
    }
    return volumes, totals


def _score_state(
    objective: str,
    totals: dict[str, float],
    prices: list[float],
    base_prices: list[float],
) -> tuple[float, float, float, float]:
    primary = totals["total_profit"] if objective == "profit" else totals["total_revenue"]
    secondary = totals["total_revenue"] if objective == "profit" else totals["total_profit"]
    movement_penalty = sum(abs(prices[i] - base_prices[i]) for i in range(len(prices)))
    return (
        float(primary),
        float(secondary),
        float(totals["total_volume"]),
        -float(movement_penalty),
    )


def _gross_margin_pct_from_totals(totals: dict[str, float]) -> float:
    revenue = float(totals.get("total_revenue", 0.0))
    profit = float(totals.get("total_profit", 0.0))
    if revenue <= 0:
        return -1e9
    return (profit / revenue) * 100.0


def _satisfies_min_gross_margin(totals: dict[str, float], min_gross_margin_pct: float) -> bool:
    return _gross_margin_pct_from_totals(totals) >= float(min_gross_margin_pct) - 1e-9


def _normalize_weights(weights: list[float]) -> list[float]:
    non_negative = [max(0.0, float(x)) for x in weights]
    total = sum(non_negative)
    if total <= 0:
        return [1.0 / max(1, len(weights)) for _ in weights]
    return [x / total for x in non_negative]


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
        candidate = text[start : end + 1]
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _default_family_templates(prompt: str, objective: str) -> tuple[str, list[dict[str, Any]]]:
    prompt_lower = str(prompt or "").lower()
    objective_hint = "profit-focused" if objective == "profit" else "revenue-focused"
    intent_summary = (
        f"{objective_hint} balanced base-ladder exploration"
        if not prompt_lower
        else f"{objective_hint} prompt-guided exploration: {prompt.strip()[:120]}"
    )

    if objective == "profit":
        templates = [
            {
                "name": "Margin Guard",
                "weight": 0.36,
                "down_bias": 0.18,
                "hold_bias": 0.44,
                "up_bias": 0.38,
                "volatility": 0.28,
                "extreme_bias": 0.24,
            },
            {
                "name": "Balanced Ladder",
                "weight": 0.38,
                "down_bias": 0.34,
                "hold_bias": 0.32,
                "up_bias": 0.34,
                "volatility": 0.44,
                "extreme_bias": 0.32,
            },
            {
                "name": "Demand Push",
                "weight": 0.26,
                "down_bias": 0.52,
                "hold_bias": 0.24,
                "up_bias": 0.24,
                "volatility": 0.66,
                "extreme_bias": 0.46,
            },
        ]
    else:
        templates = [
            {
                "name": "Revenue Lift",
                "weight": 0.40,
                "down_bias": 0.48,
                "hold_bias": 0.26,
                "up_bias": 0.26,
                "volatility": 0.62,
                "extreme_bias": 0.44,
            },
            {
                "name": "Balanced Ladder",
                "weight": 0.36,
                "down_bias": 0.34,
                "hold_bias": 0.32,
                "up_bias": 0.34,
                "volatility": 0.46,
                "extreme_bias": 0.32,
            },
            {
                "name": "Premium Probe",
                "weight": 0.24,
                "down_bias": 0.22,
                "hold_bias": 0.34,
                "up_bias": 0.44,
                "volatility": 0.38,
                "extreme_bias": 0.28,
            },
        ]

    if any(token in prompt_lower for token in ("increase", "up", "premium", "headroom")):
        templates[2]["up_bias"] = min(0.7, templates[2]["up_bias"] + 0.12)
        templates[2]["down_bias"] = max(0.1, templates[2]["down_bias"] - 0.08)
    if any(token in prompt_lower for token in ("decrease", "down", "volume", "discount")):
        templates[0]["down_bias"] = min(0.72, templates[0]["down_bias"] + 0.14)
        templates[0]["up_bias"] = max(0.1, templates[0]["up_bias"] - 0.08)

    return intent_summary, templates


def _build_gemini_prompt(prompt: str, objective: str) -> str:
    user_prompt = str(prompt or "").strip() or "Balanced ladder improvement."
    return (
        "You are helping with portfolio base-ladder scenario generation for pricing.\n"
        "Return strict JSON only.\n"
        "Output schema:\n"
        "{\n"
        '  "intent_summary": "short text",\n'
        '  "families": [\n'
        "    {\n"
        '      "name": "dynamic family name",\n'
        '      "weight": 0.34,\n'
        '      "down_bias": 0.30,\n'
        '      "hold_bias": 0.30,\n'
        '      "up_bias": 0.40,\n'
        '      "volatility": 0.45,\n'
        '      "extreme_bias": 0.25\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- exactly 3 families.\n"
        "- Families must be meaningfully different in behavior.\n"
        "- weight >= 0 and will be normalized.\n"
        "- down_bias, hold_bias, up_bias each between 0 and 1.\n"
        "- volatility and extreme_bias between 0 and 1.\n"
        "- Do not include commentary outside JSON.\n"
        "Portfolio segments by base price:\n"
        "- daily_casual: <= 599\n"
        "- core_plus: 600 to 899\n"
        "- premium: >= 900\n"
        "When prompt names a segment, prioritize that segment's movement.\n"
        f"Objective: {objective}\n"
        f"User intent: {user_prompt}\n"
    )


def _call_gemini_json(prompt_text: str, temperature: float = 0.2, timeout_seconds: int = 35) -> dict[str, Any] | None:
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

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
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


def _call_gemini_family_plan(prompt: str, objective: str) -> dict[str, Any] | None:
    return _call_gemini_json(_build_gemini_prompt(prompt, objective), temperature=0.2, timeout_seconds=35)


def _build_gemini_family_verifier_prompt(
    prompt: str,
    objective: str,
    planner_payload: dict[str, Any],
    verification_context: dict[str, Any],
) -> str:
    user_prompt = str(prompt or "").strip() or "Balanced ladder improvement."
    planner_json = json.dumps(planner_payload, ensure_ascii=True)
    context_json = json.dumps(verification_context, ensure_ascii=True)
    return (
        "You are a strict verifier for portfolio base-ladder family plans.\n"
        "You MUST validate planner families against constraints and context.\n"
        "Return strict JSON only.\n"
        "Output schema:\n"
        "{\n"
        '  "intent_summary": "short text",\n'
        '  "families": [\n'
        "    {\n"
        '      "name": "family name",\n'
        '      "weight": 0.34,\n'
        '      "down_bias": 0.30,\n'
        '      "hold_bias": 0.30,\n'
        '      "up_bias": 0.40,\n'
        '      "volatility": 0.45,\n'
        '      "extreme_bias": 0.25\n'
        "    }\n"
        "  ],\n"
        '  "changes_made": [\n'
        '    "short bullet describing correction"\n'
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- exactly 3 families.\n"
        "- preserve original intent but correct invalid/unsafe bias mixes.\n"
        "- respect product/segment movement envelopes from context.\n"
        "- weight >= 0; directional biases and volatility/extreme_bias in [0,1].\n"
        "- Do not include commentary outside JSON.\n"
        f"Objective: {objective}\n"
        f"User intent: {user_prompt}\n"
        f"Planner output JSON: {planner_json}\n"
        f"Validation context JSON: {context_json}\n"
    )


def _call_gemini_family_verifier(
    prompt: str,
    objective: str,
    planner_payload: dict[str, Any],
    verification_context: dict[str, Any],
) -> dict[str, Any] | None:
    return _call_gemini_json(
        _build_gemini_family_verifier_prompt(prompt, objective, planner_payload, verification_context),
        temperature=0.1,
        timeout_seconds=35,
    )


def _sanitize_family(raw: dict[str, Any], idx: int, fallback: dict[str, Any]) -> dict[str, Any]:
    name = str(raw.get("name") or fallback.get("name") or f"Family {idx + 1}").strip()
    weight = max(0.0, _safe_float(raw.get("weight"), _safe_float(fallback.get("weight"), 1.0)))
    down_bias = max(0.0, min(1.0, _safe_float(raw.get("down_bias"), _safe_float(fallback.get("down_bias"), 0.33))))
    hold_bias = max(0.0, min(1.0, _safe_float(raw.get("hold_bias"), _safe_float(fallback.get("hold_bias"), 0.34))))
    up_bias = max(0.0, min(1.0, _safe_float(raw.get("up_bias"), _safe_float(fallback.get("up_bias"), 0.33))))
    dir_weights = _normalize_weights([down_bias, hold_bias, up_bias])
    return {
        "name": name,
        "weight": weight,
        "down_bias": dir_weights[0],
        "hold_bias": dir_weights[1],
        "up_bias": dir_weights[2],
        "volatility": max(0.0, min(1.0, _safe_float(raw.get("volatility"), _safe_float(fallback.get("volatility"), 0.45)))),
        "extreme_bias": max(
            0.0, min(1.0, _safe_float(raw.get("extreme_bias"), _safe_float(fallback.get("extreme_bias"), 0.35)))
        ),
    }


def _family_similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    keys = ("down_bias", "hold_bias", "up_bias", "volatility", "extreme_bias")
    distance = sum(abs(_safe_float(a.get(k), 0.0) - _safe_float(b.get(k), 0.0)) for k in keys)
    return max(0.0, 1.0 - distance / len(keys))


def _diversify_family(family: dict[str, Any], idx: int) -> dict[str, Any]:
    diversified = dict(family)
    tweak = 0.10 + 0.03 * (idx % 3)
    diversified["name"] = f"{family.get('name', f'Family {idx + 1}')} Variant"
    diversified["volatility"] = max(0.0, min(1.0, _safe_float(family.get("volatility"), 0.4) + tweak - 0.06))
    diversified["extreme_bias"] = max(0.0, min(1.0, _safe_float(family.get("extreme_bias"), 0.3) + tweak))
    diversified["down_bias"] = max(0.0, min(1.0, _safe_float(family.get("down_bias"), 0.33) + (0.12 if idx % 2 == 0 else -0.10)))
    diversified["up_bias"] = max(0.0, min(1.0, _safe_float(family.get("up_bias"), 0.33) + (-0.08 if idx % 2 == 0 else 0.14)))
    diversified["hold_bias"] = max(0.0, min(1.0, _safe_float(family.get("hold_bias"), 0.34)))
    dir_weights = _normalize_weights(
        [
            _safe_float(diversified.get("down_bias"), 0.33),
            _safe_float(diversified.get("hold_bias"), 0.34),
            _safe_float(diversified.get("up_bias"), 0.33),
        ]
    )
    diversified["down_bias"] = dir_weights[0]
    diversified["hold_bias"] = dir_weights[1]
    diversified["up_bias"] = dir_weights[2]
    return diversified


def _blend_balanced_anchor(
    families: list[dict[str, Any]],
    defaults: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not families:
        return families

    balanced_default = _sanitize_family(
        defaults[1] if len(defaults) > 1 else defaults[0],
        1,
        defaults[1] if len(defaults) > 1 else defaults[0],
    )
    keywords = ("balance", "balanced", "normal", "steady")
    balanced_idx = -1
    for idx, family in enumerate(families):
        name = str(family.get("name", "")).lower()
        if any(token in name for token in keywords):
            balanced_idx = idx
            break
    if balanced_idx < 0:
        balanced_idx = max(0, min(len(families) - 1, 1))

    source = dict(families[balanced_idx])
    blended = dict(source)
    blended["name"] = "Balanced Ladder"
    blended["weight"] = max(0.16, min(0.45, _safe_float(source.get("weight"), balanced_default["weight"])))
    blended["down_bias"] = 0.6 * _safe_float(source.get("down_bias"), 0.33) + 0.4 * _safe_float(
        balanced_default.get("down_bias"), 0.33
    )
    blended["hold_bias"] = 0.6 * _safe_float(source.get("hold_bias"), 0.34) + 0.4 * _safe_float(
        balanced_default.get("hold_bias"), 0.34
    )
    blended["up_bias"] = 0.6 * _safe_float(source.get("up_bias"), 0.33) + 0.4 * _safe_float(
        balanced_default.get("up_bias"), 0.33
    )
    dir_weights = _normalize_weights([blended["down_bias"], blended["hold_bias"], blended["up_bias"]])
    blended["down_bias"], blended["hold_bias"], blended["up_bias"] = dir_weights
    blended["volatility"] = max(
        0.18,
        min(
            0.62,
            0.6 * _safe_float(source.get("volatility"), 0.45)
            + 0.4 * _safe_float(balanced_default.get("volatility"), 0.45),
        ),
    )
    blended["extreme_bias"] = max(
        0.10,
        min(
            0.55,
            0.6 * _safe_float(source.get("extreme_bias"), 0.35)
            + 0.4 * _safe_float(balanced_default.get("extreme_bias"), 0.35),
        ),
    )
    families[balanced_idx] = blended
    return families


def _resolve_families(
    prompt: str,
    objective: str,
    verification_context: dict[str, Any],
) -> tuple[str, str, list[dict[str, Any]], dict[str, Any]]:
    default_intent, defaults = _default_family_templates(prompt, objective)
    gemini_payload = _call_gemini_family_plan(prompt, objective)
    if not gemini_payload:
        weights = _normalize_weights([f["weight"] for f in defaults])
        for idx, family in enumerate(defaults):
            family["weight"] = weights[idx]
        return "fallback_default", default_intent, defaults, {
            "planner_status": "fallback_default",
            "verifier_status": "skipped_no_planner",
            "changes_made": [],
        }

    raw_families = gemini_payload.get("families")
    if not isinstance(raw_families, list) or not raw_families:
        weights = _normalize_weights([f["weight"] for f in defaults])
        for idx, family in enumerate(defaults):
            family["weight"] = weights[idx]
        return "fallback_default", default_intent, defaults, {
            "planner_status": "fallback_default_invalid_planner_payload",
            "verifier_status": "skipped_invalid_planner",
            "changes_made": [],
        }

    planner_families: list[dict[str, Any]] = []
    for idx in range(3):
        source = raw_families[idx] if idx < len(raw_families) and isinstance(raw_families[idx], dict) else {}
        planner_families.append(_sanitize_family(source, idx, defaults[idx]))

    for i in range(len(planner_families)):
        for j in range(i + 1, len(planner_families)):
            if _family_similarity(planner_families[i], planner_families[j]) >= FAMILY_SIMILARITY_THRESHOLD:
                planner_families[j] = _diversify_family(planner_families[j], j)

    weights = _normalize_weights([f["weight"] for f in planner_families])
    for idx, family in enumerate(planner_families):
        family["weight"] = weights[idx]

    planner_intent = str(gemini_payload.get("intent_summary") or default_intent).strip() or default_intent

    verifier_payload = _call_gemini_family_verifier(
        prompt=prompt,
        objective=objective,
        planner_payload={
            "intent_summary": planner_intent,
            "families": planner_families,
        },
        verification_context=verification_context,
    )
    if not verifier_payload:
        planner_families = _blend_balanced_anchor(planner_families, defaults)
        weights = _normalize_weights([f["weight"] for f in planner_families])
        for idx, family in enumerate(planner_families):
            family["weight"] = weights[idx]
        return "gemini_planner_only", planner_intent, planner_families, {
            "planner_status": "gemini_ok",
            "verifier_status": "fallback_planner_verifier_unavailable",
            "changes_made": [],
        }

    verifier_raw_families = verifier_payload.get("families")
    if not isinstance(verifier_raw_families, list) or not verifier_raw_families:
        planner_families = _blend_balanced_anchor(planner_families, defaults)
        weights = _normalize_weights([f["weight"] for f in planner_families])
        for idx, family in enumerate(planner_families):
            family["weight"] = weights[idx]
        return "gemini_planner_only", planner_intent, planner_families, {
            "planner_status": "gemini_ok",
            "verifier_status": "fallback_planner_invalid_verifier_payload",
            "changes_made": [],
        }

    verified_families: list[dict[str, Any]] = []
    for idx in range(3):
        source = (
            verifier_raw_families[idx]
            if idx < len(verifier_raw_families) and isinstance(verifier_raw_families[idx], dict)
            else {}
        )
        verified_families.append(_sanitize_family(source, idx, planner_families[idx]))

    for i in range(len(verified_families)):
        for j in range(i + 1, len(verified_families)):
            if _family_similarity(verified_families[i], verified_families[j]) >= FAMILY_SIMILARITY_THRESHOLD:
                verified_families[j] = _diversify_family(verified_families[j], j)

    verified_weights = _normalize_weights([f["weight"] for f in verified_families])
    for idx, family in enumerate(verified_families):
        family["weight"] = verified_weights[idx]
    verified_families = _blend_balanced_anchor(verified_families, defaults)
    verified_weights = _normalize_weights([f["weight"] for f in verified_families])
    for idx, family in enumerate(verified_families):
        family["weight"] = verified_weights[idx]

    verified_intent = str(verifier_payload.get("intent_summary") or planner_intent).strip() or planner_intent
    changes_made = verifier_payload.get("changes_made")
    if not isinstance(changes_made, list):
        changes_made = []

    return "gemini_verified", verified_intent, verified_families, {
        "planner_status": "gemini_ok",
        "verifier_status": "gemini_ok",
        "changes_made": [str(item) for item in changes_made if str(item).strip()],
        "planner_families": planner_families,
    }


def _pick_weighted_index(rng: random.Random, normalized_weights: list[float]) -> int:
    draw = rng.random()
    cumulative = 0.0
    for idx, weight in enumerate(normalized_weights):
        cumulative += weight
        if draw <= cumulative:
            return idx
    return max(0, len(normalized_weights) - 1)


def _infer_target_segments(prompt: str) -> set[str]:
    text = str(prompt or "").lower()
    targets: set[str] = set()
    if any(token in text for token in ("daily", "casual", "entry", "value", "low")):
        targets.add(SEGMENT_DAILY)
    if any(token in text for token in ("core", "plus", "mid", "mainstream")):
        targets.add(SEGMENT_CORE)
    if any(token in text for token in ("premium", "high", "upscale", "top")):
        targets.add(SEGMENT_PREMIUM)
    return targets


def _sample_offset_for_product(
    rng: random.Random,
    family: dict[str, Any],
    own_elasticity: float,
    allowed_offsets: list[float],
    segment_name: str,
    targeted_segments: set[str],
) -> float:
    allowed = sorted({float(x) for x in (allowed_offsets or [0.0])})
    if len(allowed) == 1:
        return allowed[0]

    negative_offsets = [offset for offset in allowed if offset < 0]
    positive_offsets = [offset for offset in allowed if offset > 0]

    down_bias = _safe_float(family.get("down_bias"), 0.33)
    hold_bias = _safe_float(family.get("hold_bias"), 0.34)
    up_bias = _safe_float(family.get("up_bias"), 0.33)

    if targeted_segments and segment_name not in targeted_segments:
        hold_bias += 0.22
        down_bias -= 0.10
        up_bias -= 0.10

    # Elasticity-aware directional nudge at base.
    if own_elasticity <= -1.6:
        down_bias += 0.12
        up_bias -= 0.08
    elif own_elasticity >= -0.85:
        up_bias += 0.12
        down_bias -= 0.08
    else:
        hold_bias += 0.04

    dir_weights = _normalize_weights([max(0.0, down_bias), max(0.0, hold_bias), max(0.0, up_bias)])
    direction_draw = rng.random()
    if direction_draw <= dir_weights[0]:
        direction = "down"
    elif direction_draw <= dir_weights[0] + dir_weights[1]:
        direction = "hold"
    else:
        direction = "up"

    if direction == "hold" or (direction == "down" and not negative_offsets) or (direction == "up" and not positive_offsets):
        return 0.0

    volatility = max(0.0, min(1.0, _safe_float(family.get("volatility"), 0.45)))
    extreme_bias = max(0.0, min(1.0, _safe_float(family.get("extreme_bias"), 0.35)))
    p_extreme = max(0.0, min(1.0, (0.45 * volatility) + (0.55 * extreme_bias)))

    pool = positive_offsets if direction == "up" else negative_offsets
    if len(pool) == 1:
        return pool[0]

    sorted_by_abs = sorted(pool, key=lambda item: abs(item))
    if rng.random() <= p_extreme:
        return sorted_by_abs[-1]
    return sorted_by_abs[0]


def _allocate_family_quotas(
    family_names: list[str],
    family_weights: list[float],
    available_counts: dict[str, int],
    target_count: int,
) -> dict[str, int]:
    quotas = {name: 0 for name in family_names}
    if target_count <= 0:
        return quotas

    available = [name for name in family_names if int(available_counts.get(name, 0)) > 0]
    if not available:
        return quotas

    guaranteed = min(target_count, len(available))
    for idx in range(guaranteed):
        quotas[available[idx]] = 1

    remaining = target_count - sum(quotas.values())
    if remaining <= 0:
        return quotas

    weight_map = {
        name: max(0.0, family_weights[idx] if idx < len(family_weights) else 0.0)
        for idx, name in enumerate(family_names)
    }
    priority = sorted(available, key=lambda name: weight_map.get(name, 0.0), reverse=True)
    if not priority:
        return quotas

    while remaining > 0:
        progressed = False
        for name in priority:
            if quotas[name] >= int(available_counts.get(name, 0)):
                continue
            quotas[name] += 1
            remaining -= 1
            progressed = True
            if remaining <= 0:
                break
        if not progressed:
            break
    return quotas


def _select_diverse_final_states(
    valid_states: list[dict[str, Any]],
    families: list[dict[str, Any]],
    family_weights: list[float],
    target_count: int,
) -> list[dict[str, Any]]:
    if target_count <= 0 or not valid_states:
        return []

    family_names = [str(family.get("name", f"Family {idx + 1}")) for idx, family in enumerate(families)]
    family_buckets: dict[str, list[dict[str, Any]]] = {name: [] for name in family_names}
    for state in valid_states:
        name = str(state.get("family", "Unknown"))
        family_buckets.setdefault(name, []).append(state)
    for bucket in family_buckets.values():
        bucket.sort(
            key=lambda item: (
                item["score"][0],
                item["score"][1],
                item["score"][2],
                item["score"][3],
                tuple(item["prices"]),
            ),
            reverse=True,
        )

    available_counts = {name: len(items) for name, items in family_buckets.items()}
    quotas = _allocate_family_quotas(family_names, family_weights, available_counts, target_count)

    selected: list[dict[str, Any]] = []
    selected_keys: set[tuple[float, ...]] = set()
    for name in family_names:
        bucket = family_buckets.get(name, [])
        take = int(quotas.get(name, 0))
        for state in bucket[:take]:
            key = tuple(float(x) for x in state["prices"])
            if key in selected_keys:
                continue
            selected.append(state)
            selected_keys.add(key)

    if len(selected) < target_count:
        for state in valid_states:
            key = tuple(float(x) for x in state["prices"])
            if key in selected_keys:
                continue
            selected.append(state)
            selected_keys.add(key)
            if len(selected) >= target_count:
                break

    selected.sort(
        key=lambda item: (
            item["score"][0],
            item["score"][1],
            item["score"][2],
            item["score"][3],
            tuple(item["prices"]),
        ),
        reverse=True,
    )
    return selected[:target_count]


def _estimate_combination_space(allowed_offsets_by_product: list[list[float]]) -> int:
    total = 1
    for offsets in allowed_offsets_by_product:
        choices = max(1, len(offsets))
        total *= choices
        if total > 10_000_000_000:
            return total
    return total


def _enumerate_price_keys_from_offsets(
    base_prices: list[float],
    allowed_offsets_by_product: list[list[float]],
) -> list[tuple[float, ...]]:
    option_lists = [
        [round(max(1.0, base_prices[idx] + float(offset)), 2) for offset in (offsets or [0.0])]
        for idx, offsets in enumerate(allowed_offsets_by_product)
    ]
    keys: list[tuple[float, ...]] = []
    for combo in product(*option_lists):
        keys.append(tuple(combo))
    return keys


def _generate_mc_states(
    objective: str,
    scenario_count: int,
    base_prices: list[float],
    own_elasticities_base: list[float],
    base_volumes: list[float],
    beta_ppu: list[float],
    gamma_matrix: list[list[float]],
    unit_costs: list[float],
    min_gross_margin_pct: float,
    families: list[dict[str, Any]],
    product_segments: list[str],
    allowed_offsets_by_product: list[list[float]],
    scenario_filters: dict[str, float],
    base_totals: dict[str, float],
    prompt: str,
    run_seed: int,
    progress_callback: ProgressCallback | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, int]]:
    rng = random.Random(run_seed)
    target_count = max(1, min(TOP_SCENARIOS_MAX, int(scenario_count)))
    raw_target = max(RAW_POOL_MIN, min(RAW_POOL_MAX, target_count * RAW_POOL_MULTIPLIER))
    draw_limit = max(raw_target, min(220000, target_count * 220))
    target_unique_pool = max(target_count * 4, target_count + 800)
    family_weights = _normalize_weights([_safe_float(f.get("weight"), 0.0) for f in families])
    targeted_segments = _infer_target_segments(prompt)
    combination_space = _estimate_combination_space(allowed_offsets_by_product)

    unique_candidates: dict[tuple[float, ...], str] = {}
    family_usage_raw: dict[str, int] = {str(f.get("name", f"Family {idx+1}")): 0 for idx, f in enumerate(families)}

    draw_idx = 0
    if combination_space <= target_count:
        _progress(progress_callback, 36, "Enumerating constrained combination space")
        keys = _enumerate_price_keys_from_offsets(base_prices, allowed_offsets_by_product)
        default_family_name = str(families[0].get("name", "Balanced Ladder")) if families else "Balanced Ladder"
        for idx, key in enumerate(keys, start=1):
            unique_candidates[key] = default_family_name
            draw_idx = idx
            if idx % 1000 == 0:
                pct = 36 + int((idx / max(1, len(keys))) * 20)
                _progress(progress_callback, pct, f"Enumerated {idx} / {len(keys)} combinations")
    else:
        _progress(progress_callback, 36, "Generating Monte Carlo candidate scenarios")
        stagnant_rounds = 0
        previous_unique = 0
        while draw_idx < draw_limit and (draw_idx < raw_target or len(unique_candidates) < target_unique_pool):
            family_idx = _pick_weighted_index(rng, family_weights)
            family = families[family_idx]
            family_name = str(family.get("name", f"Family {family_idx + 1}"))
            family_usage_raw[family_name] = family_usage_raw.get(family_name, 0) + 1

            sampled_prices: list[float] = []
            for p_idx, base_price in enumerate(base_prices):
                offset = _sample_offset_for_product(
                    rng=rng,
                    family=family,
                    own_elasticity=own_elasticities_base[p_idx],
                    allowed_offsets=allowed_offsets_by_product[p_idx],
                    segment_name=product_segments[p_idx],
                    targeted_segments=targeted_segments,
                )
                sampled_prices.append(round(max(1.0, base_price + offset), 2))

            key = tuple(sampled_prices)
            unique_candidates[key] = family_name
            draw_idx += 1

            if draw_idx % 1000 == 0 and draw_idx > 0:
                pct = 36 + int((draw_idx / max(1, draw_limit)) * 20)
                _progress(progress_callback, pct, f"Generated {draw_idx} candidates")
            if draw_idx % 4000 == 0 and draw_idx > raw_target:
                if len(unique_candidates) == previous_unique:
                    stagnant_rounds += 1
                else:
                    stagnant_rounds = 0
                previous_unique = len(unique_candidates)
                if stagnant_rounds >= 3:
                    break

    base_key = tuple(round(p, 2) for p in base_prices)
    unique_candidates[base_key] = "Base Anchor"

    _progress(progress_callback, 58, "Evaluating candidate scenarios")
    valid_states: list[dict[str, Any]] = []
    family_usage_valid: dict[str, int] = {}
    keys = list(unique_candidates.keys())
    total_unique = len(keys)
    for idx, price_key in enumerate(keys):
        prices = list(price_key)
        volumes, totals = _evaluate_prices(
            prices=prices,
            base_prices=base_prices,
            base_volumes=base_volumes,
            beta_ppu=beta_ppu,
            gamma_matrix=gamma_matrix,
            unit_costs=unit_costs,
        )
        if not _satisfies_min_gross_margin(totals, min_gross_margin_pct):
            continue
        if not _scenario_passes_filters(totals, base_totals, scenario_filters):
            continue
        state = {
            "prices": prices,
            "volumes": volumes,
            "totals": totals,
            "score": _score_state(objective, totals, prices, base_prices),
            "family": unique_candidates.get(price_key, "Unknown"),
        }
        valid_states.append(state)
        family_name = str(state["family"])
        family_usage_valid[family_name] = family_usage_valid.get(family_name, 0) + 1

        if idx % 1000 == 0 and idx > 0:
            pct = 58 + int((idx / max(1, total_unique)) * 22)
            _progress(progress_callback, pct, f"Evaluated {idx} / {total_unique} unique candidates")

    if not valid_states:
        raise RuntimeError(
            f"No feasible scenarios meet the minimum gross margin constraint ({min_gross_margin_pct:.1f}%)."
        )

    _progress(progress_callback, 82, "Ranking scenarios")
    valid_states.sort(
        key=lambda item: (
            item["score"][0],
            item["score"][1],
            item["score"][2],
            item["score"][3],
            tuple(item["prices"]),
        ),
        reverse=True,
    )
    final_target = min(target_count, len(valid_states))
    final_states = _select_diverse_final_states(valid_states, families, family_weights, final_target)
    capped_by_constraints = len(valid_states) < target_count

    return (
        final_states,
        {
            "requested_candidates": int(target_count),
            "raw_generated": int(draw_idx),
            "combination_space_estimate": int(combination_space),
            "unique_candidates": int(total_unique),
            "valid_candidates": int(len(valid_states)),
            "final_candidates": int(len(final_states)),
            "capped_by_constraints": bool(capped_by_constraints),
        },
        family_usage_valid,
    )


def optimize_asp_portfolio(
    request: AspOptimizationRequest,
    progress_callback: ProgressCallback | None = None,
) -> AspOptimizationResponse:
    _progress(progress_callback, 5, "Loading portfolio data")
    all_rows = load_portfolio_rows()
    selected_month, month_rows = select_month_rows(all_rows, request.selected_month)
    sorted_rows = _sorted_rows_for_optimization(month_rows)
    if len(sorted_rows) < 2:
        raise ValueError("At least 2 products are required for ladder optimization.")

    _progress(progress_callback, 14, "Building elasticity and cross-effects")
    own_elasticities_current = build_own_elasticities(sorted_rows)
    cross_matrix_current = build_cross_elasticity_matrix(sorted_rows)

    current_prices = [_safe_float(row.get("currentPrice"), 0.0) for row in sorted_rows]
    current_volumes = [max(1.0, _safe_float(row.get("volume"), 1.0)) for row in sorted_rows]
    base_prices = [max(1.0, _safe_float(row.get("basePrice"), row.get("currentPrice", 1.0))) for row in sorted_rows]

    own_elasticities_base, cross_matrix_base, base_volumes = convert_to_base_reference(
        sorted_rows,
        own_elasticities_current=own_elasticities_current,
        cross_elasticity_matrix_current=cross_matrix_current,
    )
    rows_with_base_anchor = [
        {
            **sorted_rows[index],
            "baseVolume": float(base_volumes[index]),
        }
        for index in range(len(sorted_rows))
    ]
    beta_ppu, gamma_matrix = build_beta_and_gamma(
        sorted_rows,
        own_elasticities=own_elasticities_base,
        cross_elasticity_matrix=cross_matrix_base,
        reference_prices=base_prices,
        reference_volumes=base_volumes,
    )

    min_gross_margin_pct = max(MIN_GROSS_MARGIN_PCT, min(MAX_GROSS_MARGIN_PCT, float(request.gross_margin_pct)))
    unit_costs = _build_unit_costs(base_prices)
    segment_constraints = _normalize_segment_constraints(request.segment_constraints)
    scenario_filters = _normalize_scenario_filters(request.scenario_filters)
    product_constraints = _normalize_product_constraints(request.product_constraints, sorted_rows, base_prices)
    product_segments = [_segment_for_base_price(price) for price in base_prices]
    allowed_offsets_by_product = [
        _apply_product_constraint_to_offsets(
            base_price=base_prices[index],
            allowed_offsets=_allowed_offsets_for_segment(segment_constraints.get(product_segments[index], {})),
            product_constraint=product_constraints.get(str(sorted_rows[index].get("productName", "")), {}),
        )
        for index in range(len(sorted_rows))
    ]

    current_product_results = build_product_results(
        sorted_rows=rows_with_base_anchor,
        optimized_prices=current_prices,
        optimized_volumes=current_volumes,
        unit_costs=unit_costs,
    )
    current_totals = build_totals(current_product_results, current=True)
    base_totals = {
        "total_volume": float(sum(base_volumes)),
        "total_revenue": float(sum(base_prices[i] * base_volumes[i] for i in range(len(base_prices)))),
        "total_profit": float(sum((base_prices[i] - unit_costs[i]) * base_volumes[i] for i in range(len(base_prices)))),
    }

    _progress(progress_callback, 24, "Preparing AI intent families")
    verification_context = {
        "selected_month": selected_month,
        "objective": request.optimization_objective,
        "min_gross_margin_pct": float(min_gross_margin_pct),
        "segment_constraints": segment_constraints,
        "scenario_filters": scenario_filters,
        "product_constraints": product_constraints,
        "products": [
            {
                "product_name": str(sorted_rows[index].get("productName", f"P{index+1}")),
                "base_price": float(base_prices[index]),
                "base_volume": float(base_volumes[index]),
                "own_elasticity_base": float(own_elasticities_base[index]),
                "segment": product_segments[index],
                "allowed_offsets": [float(x) for x in allowed_offsets_by_product[index]],
            }
            for index in range(len(sorted_rows))
        ],
    }
    ai_source, intent_summary, families, family_validation_meta = _resolve_families(
        request.prompt,
        request.optimization_objective,
        verification_context,
    )
    run_seed = random.SystemRandom().randint(1, 2_147_483_647)

    final_states, generation_counts, family_usage_valid = _generate_mc_states(
        objective=request.optimization_objective,
        scenario_count=request.scenario_count or TOP_SCENARIOS_DEFAULT,
        base_prices=base_prices,
        own_elasticities_base=own_elasticities_base,
        base_volumes=base_volumes,
        beta_ppu=beta_ppu,
        gamma_matrix=gamma_matrix,
        unit_costs=unit_costs,
        min_gross_margin_pct=min_gross_margin_pct,
        families=families,
        product_segments=product_segments,
        allowed_offsets_by_product=allowed_offsets_by_product,
        scenario_filters=scenario_filters,
        base_totals=base_totals,
        prompt=request.prompt or "",
        run_seed=run_seed,
        progress_callback=progress_callback,
    )

    _progress(progress_callback, 92, "Formatting optimization output")
    scenario_summaries: list[ScenarioSummary] = []
    scenario_details: dict[str, ScenarioDetail] = {}
    scenario_family_by_id: dict[str, str] = {}
    scenario_name_by_id: dict[str, str] = {}

    for rank, state in enumerate(final_states, start=1):
        scenario_id = str(rank)
        scenario_family = str(state.get("family", "Balanced Ladder"))
        scenario_name = f"{scenario_family} {scenario_id}"
        scenario_family_by_id[scenario_id] = scenario_family
        scenario_name_by_id[scenario_id] = scenario_name
        prices = [float(x) for x in state["prices"]]
        volumes = [float(x) for x in state["volumes"]]

        product_rows = build_product_results(
            sorted_rows=rows_with_base_anchor,
            optimized_prices=prices,
            optimized_volumes=volumes,
            unit_costs=unit_costs,
        )
        scenario_totals = build_totals(product_rows, current=False)
        scenario_summary = build_summary(product_rows, base_totals, scenario_totals)
        objective_value = (
            scenario_totals["total_profit"]
            if request.optimization_objective == "profit"
            else scenario_totals["total_revenue"]
        )
        scenario_summaries.append(
            ScenarioSummary(
                scenario_id=scenario_id,
                scenario_name=scenario_name,
                scenario_family=scenario_family,
                rank=rank,
                objective_value=float(objective_value),
                total_volume=float(scenario_totals["total_volume"]),
                total_revenue=float(scenario_totals["total_revenue"]),
                total_profit=float(scenario_totals["total_profit"]),
                revenue_uplift_pct=float(scenario_summary["revenue_uplift_pct"]),
                profit_uplift_pct=float(scenario_summary["profit_uplift_pct"]),
                volume_uplift_pct=float(scenario_summary["volume_uplift_pct"]),
            )
        )
        scenario_details[scenario_id] = ScenarioDetail(
            scenario_id=scenario_id,
            totals=PortfolioTotals(**scenario_totals),
            summary=SummaryMetrics(**scenario_summary),
            product_results=[ProductOptimizationResult(**row) for row in product_rows],
        )

    selected_scenario_id = scenario_summaries[0].scenario_id
    selected_detail = scenario_details[selected_scenario_id]

    family_summaries: list[dict[str, Any]] = []
    normalized_family_weights = _normalize_weights([_safe_float(f.get("weight"), 0.0) for f in families])
    for idx, family in enumerate(families):
        name = str(family.get("name", f"Family {idx + 1}"))
        family_summaries.append(
            {
                "name": name,
                "weight": float(normalized_family_weights[idx]),
                "down_bias": float(_safe_float(family.get("down_bias"), 0.33)),
                "hold_bias": float(_safe_float(family.get("hold_bias"), 0.34)),
                "up_bias": float(_safe_float(family.get("up_bias"), 0.33)),
                "volatility": float(_safe_float(family.get("volatility"), 0.45)),
                "extreme_bias": float(_safe_float(family.get("extreme_bias"), 0.35)),
                "valid_count": int(family_usage_valid.get(name, 0)),
            }
        )

    _progress(progress_callback, 98, "Finalizing response")
    return AspOptimizationResponse(
        controls=request,
        selected_month=selected_month,
        selected_scenario_id=selected_scenario_id,
        base_totals=PortfolioTotals(**base_totals),
        current_totals=PortfolioTotals(**current_totals),
        optimized_totals=selected_detail.totals,
        product_results=selected_detail.product_results,
        summary=selected_detail.summary,
        scenario_summaries=scenario_summaries,
        scenario_details=scenario_details,
        model_context=OptimizationModelContext(
            own_elasticities=own_elasticities_base,
            beta_ppu=[float(x) for x in beta_ppu],
            cross_matrix=[[float(x) for x in row] for row in cross_matrix_base],
            gamma_matrix=[[float(x) for x in row] for row in gamma_matrix],
            base_prices=[float(x) for x in base_prices],
            base_volumes=[float(x) for x in base_volumes],
        ),
        ai_metadata={
            "ai_source": ai_source,
            "prompt_used": str(request.prompt or ""),
            "intent_summary": intent_summary,
            "family_summaries": family_summaries,
            "family_validation": family_validation_meta,
            "run_seed": int(run_seed),
            "generation_counts": generation_counts,
            "scenario_family_by_id": scenario_family_by_id,
            "scenario_name_by_id": scenario_name_by_id,
            "segment_constraints": segment_constraints,
            "product_constraints": product_constraints,
            "scenario_filters": {
                "min_volume_uplift_pct": _safe_float(request.scenario_filters.get("min_volume_uplift_pct"), 0.0)
                if isinstance(request.scenario_filters, dict)
                else 0.0,
                "min_revenue_uplift_pct": _safe_float(request.scenario_filters.get("min_revenue_uplift_pct"), 0.0)
                if isinstance(request.scenario_filters, dict)
                else 0.0,
                "min_profit_uplift_pct": _safe_float(request.scenario_filters.get("min_profit_uplift_pct"), 0.0)
                if isinstance(request.scenario_filters, dict)
                else 0.0,
            },
            "product_segments": [
                {"product_name": sorted_rows[index].get("productName", f"P{index+1}"), "segment": product_segments[index]}
                for index in range(len(sorted_rows))
            ],
        },
    )
