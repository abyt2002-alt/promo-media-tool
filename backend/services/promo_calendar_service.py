from __future__ import annotations

import json
from pathlib import Path
import math
import random
import re
import xml.etree.ElementTree as ET
from typing import Any, Callable

from backend.schemas.promo_calendar import (
    PromoBestMarkers,
    PromoCalendarRequest,
    PromoCalendarRecalculateRequest,
    PromoCalendarRecalculateResponse,
    PromoCalendarResponse,
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
PROMO_CONTEXT_CACHE_FILE = "promo_calendar_context_latest.json"


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed


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
    search_dirs = [cwd]
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

    worksheets = root.findall(".//ss:Worksheet", ns)
    for worksheet in worksheets:
        table = worksheet.find("ss:Table", ns)
        if table is None:
            continue
        rows: list[list[str]] = []
        for row in table.findall("ss:Row", ns):
            values: list[str] = []
            for cell in row.findall("ss:Cell", ns):
                data = cell.find("ss:Data", ns)
                values.append("" if data is None or data.text is None else str(data.text).strip())
            rows.append(values)
        if not rows:
            continue

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
            continue

        header = [str(cell).strip().lower() for cell in rows[header_index]]
        product_idx = header.index("product") if "product" in header else -1
        rec_idx = header.index("recommended price") if "recommended price" in header else -1
        base_idx = header.index("base price") if "base price" in header else -1
        base_vol_idx = header.index("base volume") if "base volume" in header else -1
        if product_idx < 0 or (rec_idx < 0 and base_idx < 0):
            continue

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


def _bucket_family_weights(objective: str) -> list[float]:
    if objective == "volume":
        return [0.52, 0.30, 0.18]
    if objective == "profit":
        return [0.20, 0.30, 0.50]
    return [0.20, 0.56, 0.24]


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
    if len(rows) < 2:
        raise ValueError("At least 2 products are required for promo planning.")

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

    _progress(progress_callback, 28, "Generating scenarios")
    seed_value = abs(hash((selected_month, min_gm, request.min_promo_weeks, request.max_promo_weeks))) % (2**31 - 1)
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
        family_weights = _bucket_family_weights(objective)
        bucket: list[dict[str, Any]] = []
        local_signatures: set[Any] = set()

        attempts = 0
        attempt_limit = 1_500_000
        while len(bucket) < BUCKET_SIZE and attempts < attempt_limit:
            attempts += 1
            family = objective_rng.choices(list(FAMILY_PROFILES), weights=family_weights, k=1)[0]
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
    if len(rows) < 2:
        raise ValueError("At least 2 products are required for promo recalculation.")

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
