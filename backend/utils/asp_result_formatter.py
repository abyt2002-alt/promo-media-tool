from __future__ import annotations

from typing import Any


def build_unit_costs(sorted_rows: list[dict[str, Any]]) -> list[float]:
    if not sorted_rows:
        return []

    denominator = max(1, len(sorted_rows) - 1)
    costs: list[float] = []
    for idx, row in enumerate(sorted_rows):
        base_price = float(row.get("basePrice", row.get("currentPrice", 0.0)))
        # Slightly lower cost share for higher ladder SKUs.
        cost_share = 0.66 - (idx / denominator) * 0.08
        costs.append(base_price * cost_share)
    return costs


def build_product_results(
    sorted_rows: list[dict[str, Any]],
    optimized_prices: list[float],
    optimized_volumes: list[float],
    unit_costs: list[float],
) -> list[dict[str, float | str]]:
    results: list[dict[str, float | str]] = []
    for idx, row in enumerate(sorted_rows):
        base_price = float(row.get("basePrice", row.get("currentPrice", 0.0)))
        # Step 3 baseline must be the base ladder anchor, not observed current month values.
        current_price = base_price
        current_volume = float(row.get("baseVolume", row.get("volume", 0.0)))
        optimized_price = float(optimized_prices[idx])
        optimized_volume = float(max(0.0, optimized_volumes[idx]))
        unit_cost = float(unit_costs[idx])

        current_revenue = current_price * current_volume
        new_revenue = optimized_price * optimized_volume
        current_profit = (current_price - unit_cost) * current_volume
        new_profit = (optimized_price - unit_cost) * optimized_volume

        price_change = optimized_price - current_price
        base_price_change = optimized_price - base_price
        volume_change = optimized_volume - current_volume
        revenue_change = new_revenue - current_revenue
        profit_change = new_profit - current_profit

        results.append(
            {
                "product_id": f"p{idx + 1}",
                "product_name": str(row["productName"]),
                "base_price": base_price,
                "current_price": current_price,
                "optimized_price": optimized_price,
                "price_change": price_change,
                "price_change_pct": 0.0 if current_price == 0 else price_change / current_price,
                "base_price_change": base_price_change,
                "base_price_change_pct": 0.0 if base_price == 0 else base_price_change / base_price,
                "current_volume": current_volume,
                "new_volume": optimized_volume,
                "volume_change_pct": 0.0 if current_volume == 0 else volume_change / current_volume,
                "current_revenue": current_revenue,
                "new_revenue": new_revenue,
                "revenue_change_pct": 0.0 if current_revenue == 0 else revenue_change / current_revenue,
                "current_profit": current_profit,
                "new_profit": new_profit,
                "profit_change_pct": 0.0 if current_profit == 0 else profit_change / current_profit,
            }
        )
    return results


def build_totals(product_results: list[dict[str, float | str]], current: bool) -> dict[str, float]:
    volume_key = "current_volume" if current else "new_volume"
    revenue_key = "current_revenue" if current else "new_revenue"
    profit_key = "current_profit" if current else "new_profit"

    return {
        "total_volume": float(sum(float(row[volume_key]) for row in product_results)),
        "total_revenue": float(sum(float(row[revenue_key]) for row in product_results)),
        "total_profit": float(sum(float(row[profit_key]) for row in product_results)),
    }


def build_summary(
    product_results: list[dict[str, float | str]],
    current_totals: dict[str, float],
    optimized_totals: dict[str, float],
) -> dict[str, float | int]:
    revenue_uplift = (
        0.0
        if current_totals["total_revenue"] == 0
        else (optimized_totals["total_revenue"] - current_totals["total_revenue"])
        / current_totals["total_revenue"]
    )
    profit_uplift = (
        0.0
        if current_totals["total_profit"] == 0
        else (optimized_totals["total_profit"] - current_totals["total_profit"])
        / current_totals["total_profit"]
    )
    volume_uplift = (
        0.0
        if current_totals["total_volume"] == 0
        else (optimized_totals["total_volume"] - current_totals["total_volume"])
        / current_totals["total_volume"]
    )

    changed = sum(1 for row in product_results if abs(float(row["price_change"])) >= 0.5)
    increased = sum(1 for row in product_results if float(row["price_change"]) >= 0.5)
    decreased = sum(1 for row in product_results if float(row["price_change"]) <= -0.5)

    return {
        "revenue_uplift_pct": float(revenue_uplift),
        "profit_uplift_pct": float(profit_uplift),
        "volume_uplift_pct": float(volume_uplift),
        "changed_count": int(changed),
        "increased_count": int(increased),
        "decreased_count": int(decreased),
    }
