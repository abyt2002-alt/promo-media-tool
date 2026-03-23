from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


ObjectiveType = Literal["revenue", "profit"]


class AspOptimizationRequest(BaseModel):
    selected_month: Optional[str] = Field(
        default=None,
        description="Portfolio time key, e.g. 2024-W31",
    )
    selected_scenario: Optional[str] = None
    selected_portfolio_slice: Optional[str] = None
    selected_channel: Optional[str] = None

    optimization_objective: ObjectiveType = "revenue"
    gross_margin_pct: float = Field(default=40.0, ge=20.0, le=60.0)
    prompt: str = ""
    scenario_count: int = Field(default=1000, ge=1, le=1000)
    segment_constraints: dict[str, dict[str, float | bool]] = Field(default_factory=dict)
    product_constraints: dict[str, dict[str, float | bool]] = Field(default_factory=dict)
    scenario_filters: dict[str, float] = Field(default_factory=dict)


class ProductOptimizationResult(BaseModel):
    product_id: str
    product_name: str
    base_price: float
    current_price: float
    optimized_price: float
    price_change: float
    price_change_pct: float
    base_price_change: float
    base_price_change_pct: float
    current_volume: float
    new_volume: float
    volume_change_pct: float
    current_revenue: float
    new_revenue: float
    revenue_change_pct: float
    current_profit: float
    new_profit: float
    profit_change_pct: float


class PortfolioTotals(BaseModel):
    total_volume: float
    total_revenue: float
    total_profit: float


class SummaryMetrics(BaseModel):
    revenue_uplift_pct: float
    profit_uplift_pct: float
    volume_uplift_pct: float
    changed_count: int
    increased_count: int
    decreased_count: int


class OptimizationModelContext(BaseModel):
    own_elasticities: list[float]
    beta_ppu: list[float]
    cross_matrix: list[list[float]]
    gamma_matrix: list[list[float]]
    base_prices: list[float]
    base_volumes: list[float]


class ScenarioSummary(BaseModel):
    scenario_id: str
    scenario_name: Optional[str] = None
    scenario_family: Optional[str] = None
    rank: int
    objective_value: float
    total_volume: float
    total_revenue: float
    total_profit: float
    revenue_uplift_pct: float
    profit_uplift_pct: float
    volume_uplift_pct: float


class ScenarioDetail(BaseModel):
    scenario_id: str
    totals: PortfolioTotals
    summary: SummaryMetrics
    product_results: list[ProductOptimizationResult]


class AspOptimizationResponse(BaseModel):
    controls: AspOptimizationRequest
    selected_month: str
    selected_scenario_id: str
    base_totals: PortfolioTotals
    current_totals: PortfolioTotals
    optimized_totals: PortfolioTotals
    product_results: list[ProductOptimizationResult]
    summary: SummaryMetrics
    scenario_summaries: list[ScenarioSummary]
    scenario_details: dict[str, ScenarioDetail]
    model_context: OptimizationModelContext
    ai_metadata: dict[str, object] = Field(default_factory=dict)


JobStatusType = Literal["queued", "running", "completed", "failed"]


class AspOptimizationJobCreateResponse(BaseModel):
    job_id: str
    status: JobStatusType
    message: str


class AspOptimizationJobStatusResponse(BaseModel):
    job_id: str
    status: JobStatusType
    progress_pct: int = Field(default=0, ge=0, le=100)
    stage: str = ""
    error: Optional[str] = None


class AspOptimizationJobResultResponse(BaseModel):
    job_id: str
    status: JobStatusType
    result: Optional[AspOptimizationResponse] = None
    error: Optional[str] = None
