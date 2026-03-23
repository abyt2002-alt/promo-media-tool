from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.schemas.asp_determination import (
    AspOptimizationJobCreateResponse,
    AspOptimizationJobResultResponse,
    AspOptimizationJobStatusResponse,
    AspOptimizationRequest,
    AspOptimizationResponse,
)
from backend.services.asp_optimization_jobs import create_optimization_job, get_optimization_job
from backend.services.asp_optimization_service import optimize_asp_portfolio


router = APIRouter(prefix="/api/asp-determination", tags=["Base Price Detection"])


@router.post("/optimize", response_model=AspOptimizationResponse)
def optimize_asp_ladder(payload: AspOptimizationRequest) -> AspOptimizationResponse:
    try:
        return optimize_asp_portfolio(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Unhandled optimization error: {exc}") from exc


@router.post("/optimize-jobs", response_model=AspOptimizationJobCreateResponse)
def create_optimize_job(payload: AspOptimizationRequest) -> AspOptimizationJobCreateResponse:
    try:
        job_id = create_optimization_job(payload)
        return AspOptimizationJobCreateResponse(
            job_id=job_id,
            status="queued",
            message="Optimization job queued.",
        )
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Failed to create optimization job: {exc}") from exc


@router.get("/optimize-jobs/{job_id}/status", response_model=AspOptimizationJobStatusResponse)
def get_optimize_job_status(job_id: str) -> AspOptimizationJobStatusResponse:
    job = get_optimization_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return AspOptimizationJobStatusResponse(
        job_id=job_id,
        status=job.get("status", "failed"),
        progress_pct=int(job.get("progress_pct", 0)),
        stage=str(job.get("stage", "")),
        error=job.get("error"),
    )


@router.get("/optimize-jobs/{job_id}/result", response_model=AspOptimizationJobResultResponse)
def get_optimize_job_result(job_id: str) -> AspOptimizationJobResultResponse:
    job = get_optimization_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    status = str(job.get("status", "failed"))
    if status == "completed":
        result = job.get("result")
        if result is None:
            return AspOptimizationJobResultResponse(
                job_id=job_id,
                status="failed",
                result=None,
                error="Optimization completed without a result payload.",
            )
        return AspOptimizationJobResultResponse(
            job_id=job_id,
            status="completed",
            result=result,
            error=None,
        )
    if status == "failed":
        return AspOptimizationJobResultResponse(
            job_id=job_id,
            status="failed",
            result=None,
            error=str(job.get("error") or "Optimization job failed."),
        )
    return AspOptimizationJobResultResponse(
        job_id=job_id,
        status=status,  # type: ignore[arg-type]
        result=None,
        error=None,
    )
