from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.schemas.promo_calendar import (
    PromoCalendarJobCreateResponse,
    PromoCalendarJobResultResponse,
    PromoCalendarJobStatusResponse,
    PromoCalendarRecalculateRequest,
    PromoCalendarRecalculateResponse,
    PromoCalendarRequest,
    PromoCalendarResponse,
)
from backend.services.promo_calendar_jobs import create_promo_calendar_job, get_promo_calendar_job
from backend.services.promo_calendar_service import optimize_promo_calendar, recalculate_promo_calendar


router = APIRouter(prefix="/api/promo-calendar", tags=["Promo Calendar"])


@router.post("/optimize", response_model=PromoCalendarResponse)
def optimize_promo(payload: PromoCalendarRequest) -> PromoCalendarResponse:
    try:
        return optimize_promo_calendar(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Unhandled promo optimization error: {exc}") from exc


@router.post("/recalculate", response_model=PromoCalendarRecalculateResponse)
def recalculate_promo(payload: PromoCalendarRecalculateRequest) -> PromoCalendarRecalculateResponse:
    try:
        return recalculate_promo_calendar(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Unhandled promo recalculation error: {exc}") from exc


@router.post("/optimize-jobs", response_model=PromoCalendarJobCreateResponse)
def create_promo_job(payload: PromoCalendarRequest) -> PromoCalendarJobCreateResponse:
    try:
        job_id = create_promo_calendar_job(payload)
        return PromoCalendarJobCreateResponse(
            job_id=job_id,
            status="queued",
            message="Promo optimization job queued.",
        )
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Failed to create promo job: {exc}") from exc


@router.get("/optimize-jobs/{job_id}/status", response_model=PromoCalendarJobStatusResponse)
def promo_job_status(job_id: str) -> PromoCalendarJobStatusResponse:
    job = get_promo_calendar_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return PromoCalendarJobStatusResponse(
        job_id=job_id,
        status=job.get("status", "failed"),
        progress_pct=int(job.get("progress_pct", 0)),
        stage=str(job.get("stage", "")),
        error=job.get("error"),
    )


@router.get("/optimize-jobs/{job_id}/result", response_model=PromoCalendarJobResultResponse)
def promo_job_result(job_id: str) -> PromoCalendarJobResultResponse:
    job = get_promo_calendar_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    status = str(job.get("status", "failed"))
    if status == "completed":
        result = job.get("result")
        if result is None:
            return PromoCalendarJobResultResponse(
                job_id=job_id,
                status="failed",
                result=None,
                error="Promo optimization completed without result payload.",
            )
        return PromoCalendarJobResultResponse(
            job_id=job_id,
            status="completed",
            result=result,
            error=None,
        )
    if status == "failed":
        return PromoCalendarJobResultResponse(
            job_id=job_id,
            status="failed",
            result=None,
            error=str(job.get("error") or "Promo optimization job failed."),
        )
    return PromoCalendarJobResultResponse(
        job_id=job_id,
        status=status,  # type: ignore[arg-type]
        result=None,
        error=None,
    )
