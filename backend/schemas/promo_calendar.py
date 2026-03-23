from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


PromoJobStatus = Literal["queued", "running", "completed", "failed"]


class PromoCalendarRequest(BaseModel):
    selected_month: Optional[str] = Field(default=None, description="Portfolio time key, e.g. 2024-W31")
    base_source_scenario_id: Optional[str] = None
    base_price_overrides: list["PromoBasePriceOverride"] = Field(default_factory=list)
    min_gross_margin_pct: float = Field(default=40.0, ge=20.0, le=60.0)
    min_promo_weeks: int = Field(default=4, ge=0, le=12)
    max_promo_weeks: int = Field(default=12, ge=1, le=12)
    scenario_count: int = Field(default=1500, ge=3, le=1500)
    scenario_filters: dict[str, float] = Field(default_factory=dict)


class PromoBasePriceOverride(BaseModel):
    product_name: str
    base_price: float
    base_volume: Optional[float] = None


class PromoPortfolioTotals(BaseModel):
    total_volume: float
    total_revenue: float
    total_profit: float


class PromoScenarioSummary(BaseModel):
    scenario_id: str
    scenario_name: str
    scenario_family: str
    rank: int
    objective_value: float
    total_volume: float
    total_revenue: float
    total_profit: float
    volume_uplift_pct: float
    revenue_uplift_pct: float
    profit_uplift_pct: float


class PromoWeeklyGroupCalendar(BaseModel):
    group_id: str
    group_name: str
    base_price: float
    product_count: int
    weekly_discounts: list[float]


class PromoProductImpact(BaseModel):
    product_name: str
    base_price: float
    avg_price: float
    current_volume: float
    new_volume: float
    volume_change_pct: float
    current_revenue: float
    new_revenue: float
    revenue_change_pct: float
    current_profit: float
    new_profit: float
    profit_change_pct: float


class PromoScenarioDetail(BaseModel):
    scenario_id: str
    totals: PromoPortfolioTotals
    group_calendars: list[PromoWeeklyGroupCalendar]
    product_impacts: list[PromoProductImpact]


class PromoBestMarkers(BaseModel):
    best_volume_scenario_id: str
    best_revenue_scenario_id: str
    best_profit_scenario_id: str


class PromoCalendarResponse(BaseModel):
    controls: PromoCalendarRequest
    selected_month: str
    selected_scenario_id: str
    base_totals: PromoPortfolioTotals
    selected_totals: PromoPortfolioTotals
    scenario_summaries: list[PromoScenarioSummary]
    scenario_details: dict[str, PromoScenarioDetail]
    best_markers: PromoBestMarkers


class PromoCalendarJobCreateResponse(BaseModel):
    job_id: str
    status: PromoJobStatus
    message: str


class PromoCalendarJobStatusResponse(BaseModel):
    job_id: str
    status: PromoJobStatus
    progress_pct: int = Field(default=0, ge=0, le=100)
    stage: str = ""
    error: Optional[str] = None


class PromoCalendarJobResultResponse(BaseModel):
    job_id: str
    status: PromoJobStatus
    result: Optional[PromoCalendarResponse] = None
    error: Optional[str] = None


class PromoCalendarRecalculateGroupInput(BaseModel):
    group_id: str
    weekly_discounts: list[float]


class PromoCalendarRecalculateRequest(BaseModel):
    selected_month: Optional[str] = Field(default=None, description="Portfolio time key, e.g. 2024-W31")
    base_price_overrides: list[PromoBasePriceOverride] = Field(default_factory=list)
    min_promo_weeks: int = Field(default=0, ge=0, le=12)
    max_promo_weeks: int = Field(default=12, ge=1, le=12)
    group_calendars: list[PromoCalendarRecalculateGroupInput] = Field(default_factory=list)


class PromoCalendarRecalculateResponse(BaseModel):
    selected_month: str
    totals: PromoPortfolioTotals
    volume_uplift_pct: float
    revenue_uplift_pct: float
    profit_uplift_pct: float
    group_calendars: list[PromoWeeklyGroupCalendar]
    product_impacts: list[PromoProductImpact]
