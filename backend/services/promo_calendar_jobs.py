from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.schemas.promo_calendar import PromoCalendarRequest
from backend.services.promo_calendar_service import optimize_promo_calendar


_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_job_state(job_id: str, **patch: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(patch)
        job["updated_at"] = _utc_now_iso()


def _run_job(job_id: str, payload: PromoCalendarRequest) -> None:
    def _progress(progress_pct: int, stage: str) -> None:
        _set_job_state(
            job_id,
            status="running",
            progress_pct=max(0, min(100, int(progress_pct))),
            stage=str(stage or ""),
        )

    try:
        _progress(2, "Loading portfolio baseline")
        result = optimize_promo_calendar(payload, progress_callback=_progress)
        _set_job_state(
            job_id,
            status="completed",
            progress_pct=100,
            stage="Completed",
            result=result,
            error=None,
        )
    except Exception as exc:  # pragma: no cover - defensive
        _set_job_state(
            job_id,
            status="failed",
            progress_pct=100,
            stage="Failed",
            error=str(exc),
        )


def create_promo_calendar_job(payload: PromoCalendarRequest) -> str:
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress_pct": 0,
            "stage": "Queued",
            "error": None,
            "result": None,
            "created_at": _utc_now_iso(),
            "updated_at": _utc_now_iso(),
        }

    thread = threading.Thread(target=_run_job, args=(job_id, payload), daemon=True)
    thread.start()
    return job_id


def get_promo_calendar_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        return dict(job)

