from __future__ import annotations

from typing import Any


ELASTICITY_CEILING = -0.5
ELASTICITY_FLOOR = -2.5
INTERACTION_WINDOW = 100.0

FIXED_OWN_ELASTICITY_BY_KEY = {
    "1199|cotton": -0.7376,
    "1199|cottonpolyester": -0.5734,
    "1199|polyester": -0.91,
    "299|notavailable": -1.5004953336891085,
    "349|cotton": -1.31,
    "399|cotton": -0.70,
    "399|viscoserayon": -3.4832414804981617,
    "549|cotton": -2.6152722167154243,
    "599|cotton": -1.33,
    "599|cottonslub": -4.468131189288543,
    "599|polyester": -1.02,
    "599|viscoserayon": -0.808,
    "699|cotton": -1.493,
    "699|polyester": -1.32,
    "799|cotton": -1.618,
    "799|cottonspandex": -1.88,
    "799|polyester": -1.52411,
    "899|cotton": -1.05966,
    "899|cottonblend": -0.83002,
    "899|cottonelastane": -1.537,
    "899|polyester": -8.97,
    "999|cotton": -0.804,
    "999|cottonblend": -0.828,
    "999|polyester": -1.098,
}


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed


def _normalize_ppg(value: str) -> str:
    return str(value or "").lower().replace(" ", "")


def _elasticity_key(row: dict[str, Any]) -> str:
    product_name = str(row.get("productName", ""))
    ppg_raw = ""
    if "|" in product_name:
        ppg_raw = product_name.split("|", 1)[1].strip()
    return f"{int(_safe_float(row.get('basePrice'), 0))}|{_normalize_ppg(ppg_raw)}"


def _fallback_own_elasticity(row: dict[str, Any], rank: float) -> float:
    current_price = _safe_float(row.get("currentPrice"), 1.0)
    distribution = _safe_float(row.get("distribution"), 70.0)
    rpi_effect = abs(_safe_float(row.get("rpiEffect"), 0.0))
    price_factor = 1 + ((current_price - 700.0) / 700.0) * 0.15
    distribution_factor = 1 + (70.0 - distribution) / 220.0
    rpi_factor = 1 + rpi_effect * 0.08
    base = (ELASTICITY_CEILING + (ELASTICITY_FLOOR - ELASTICITY_CEILING) * rank) * price_factor
    return base * distribution_factor * rpi_factor


def build_own_elasticities(sorted_rows: list[dict[str, Any]]) -> list[float]:
    own = []
    denominator = max(1, len(sorted_rows) - 1)
    for index, row in enumerate(sorted_rows):
        mapped = FIXED_OWN_ELASTICITY_BY_KEY.get(_elasticity_key(row))
        candidate = mapped if mapped is not None else _fallback_own_elasticity(row, index / denominator)
        own.append(round(clamp(candidate, ELASTICITY_FLOOR, ELASTICITY_CEILING), 4))
    return own


def build_cross_elasticity_matrix(sorted_rows: list[dict[str, Any]]) -> list[list[float]]:
    matrix: list[list[float]] = []
    for i, row_i in enumerate(sorted_rows):
        p_i = _safe_float(row_i.get("currentPrice"), 0.0)
        row_values: list[float] = []
        for j, row_j in enumerate(sorted_rows):
            if i == j:
                row_values.append(0.0)
                continue

            p_j = _safe_float(row_j.get("currentPrice"), 0.0)
            gap = abs(p_i - p_j)
            if gap > INTERACTION_WINDOW:
                row_values.append(0.0)
                continue

            closeness = 1 - gap / INTERACTION_WINDOW
            base_value = 0.08 + closeness * 0.32
            cross = -clamp(base_value, 0.05, 0.45)
            row_values.append(round(cross, 4))
        matrix.append(row_values)
    return matrix


def build_beta_and_gamma(
    sorted_rows: list[dict[str, Any]],
    own_elasticities: list[float],
    cross_elasticity_matrix: list[list[float]],
    reference_prices: list[float] | None = None,
    reference_volumes: list[float] | None = None,
) -> tuple[list[float], list[list[float]]]:
    prices = reference_prices or [_safe_float(row.get("currentPrice"), 1.0) for row in sorted_rows]
    volumes = reference_volumes or [_safe_float(row.get("volume"), 1.0) for row in sorted_rows]

    beta_ppu = []
    gamma_matrix: list[list[float]] = []

    for i in range(len(sorted_rows)):
        p_i = max(1.0, prices[i])
        q_i = max(1.0, volumes[i])
        beta_ppu.append(own_elasticities[i] * (q_i / p_i))

        gamma_row: list[float] = []
        for j in range(len(sorted_rows)):
            if i == j:
                gamma_row.append(0.0)
                continue
            p_j = max(1.0, prices[j])
            gamma_row.append(cross_elasticity_matrix[i][j] * (q_i / p_j))
        gamma_matrix.append(gamma_row)

    return beta_ppu, gamma_matrix


def convert_to_base_reference(
    sorted_rows: list[dict[str, Any]],
    own_elasticities_current: list[float],
    cross_elasticity_matrix_current: list[list[float]],
) -> tuple[list[float], list[list[float]], list[float]]:
    current_prices = [max(1.0, _safe_float(row.get("currentPrice"), 1.0)) for row in sorted_rows]
    base_prices = [max(1.0, _safe_float(row.get("basePrice"), row.get("currentPrice", 1.0))) for row in sorted_rows]
    current_volumes = [max(1.0, _safe_float(row.get("volume"), 1.0)) for row in sorted_rows]

    beta_current, gamma_current = build_beta_and_gamma(
        sorted_rows,
        own_elasticities_current,
        cross_elasticity_matrix_current,
        reference_prices=current_prices,
        reference_volumes=current_volumes,
    )

    base_volumes: list[float] = []
    for i in range(len(sorted_rows)):
        own_backcast = beta_current[i] * (current_prices[i] - base_prices[i])
        cross_backcast = sum(
            gamma_current[i][j] * (current_prices[j] - base_prices[j])
            for j in range(len(sorted_rows))
            if j != i
        )
        # Keep base-reference conversion aligned with response model sign convention:
        # q_current = q_base + own_term - cross_term
        # => q_base = q_current - own_term + cross_term
        q_base = current_volumes[i] - own_backcast + cross_backcast
        base_volumes.append(max(1.0, q_base))

    own_elasticities_base: list[float] = []
    cross_elasticity_matrix_base: list[list[float]] = []
    for i in range(len(sorted_rows)):
        p_i_base = base_prices[i]
        q_i_base = base_volumes[i]
        own_base = beta_current[i] * (p_i_base / q_i_base)
        own_elasticities_base.append(round(clamp(own_base, ELASTICITY_FLOOR, ELASTICITY_CEILING), 4))

        cross_row: list[float] = []
        for j in range(len(sorted_rows)):
            if i == j:
                cross_row.append(0.0)
                continue
            p_j_base = base_prices[j]
            cross_base = gamma_current[i][j] * (p_j_base / q_i_base)
            cross_row.append(round(cross_base, 4))
        cross_elasticity_matrix_base.append(cross_row)

    return own_elasticities_base, cross_elasticity_matrix_base, base_volumes
