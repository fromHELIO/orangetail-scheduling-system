import sys
import os
import io

# Force UTF-8 encoding for standard streams on Windows to prevent 'charmap' crashes with emojis
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    os.environ["PYTHONIOENCODING"] = "utf-8"

from typing import List, Optional
import threading
import time
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import (
    build_ml_lookup,
    fetch_scheduling_data,
    format_schedule_preview,
)
from scheduler import (
    count_violations_by_category,
    diagnose_room_type_violations,
    diagnose_qualification_violations,
    diagnose_daily_span_violations,
    diagnose_teacher_overload_violations,
    diagnose_faculty_priority_violations,
    diagnose_availability_violations,
    run_memetic_algorithm,
)

app = FastAPI(title="Schedule Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Generation is CPU-bound and can take up to an hour; running two at once on
# one machine doesn't parallelize meaningfully (Python's GIL means they just
# share one CPU's worth of real work), so both end up far slower than either
# alone. Rather than let that happen silently, a second request while one is
# already running is rejected immediately with a clear message instead of
# competing for the same CPU.
_generation_lock = threading.Lock()

# In-memory job store: job_id -> {"status": "running"|"complete"|"failed",
# "result": {...}, "error": "...", "created_at": float}. Fine for a single
# process; if this is ever deployed behind multiple worker processes, this
# would need to move to something shared (Redis, a DB table), since each
# worker would otherwise have its own separate, inconsistent copy.
_jobs = {}
_jobs_lock = threading.Lock()
_JOB_MAX_AGE_SECONDS = 6 * 60 * 60  # 6 hours


def _prune_old_jobs():
    """Opportunistic cleanup, run each time a new job starts, rather than a
    separate timer thread -- keeps the in-memory store from growing
    unbounded over a long-lived deployment without adding any new moving
    parts."""
    cutoff = time.time() - _JOB_MAX_AGE_SECONDS
    with _jobs_lock:
        stale = [jid for jid, job in _jobs.items() if job.get("created_at", 0) < cutoff]
        for jid in stale:
            del _jobs[jid]


# --- Pydantic Models ---

class BlockRequest(BaseModel):
    curriculum_id: int
    year_lvl: int
    num_blocks: int
    course_ids: Optional[List[int]] = None  # Optional subset of specific course IDs


class GenerateRequest(BaseModel):
    school_year: str = "2026-2027"
    semester: int = 1
    pop_size: int = 40
    block_requests: List[BlockRequest]


# --- Endpoints ---

@app.get("/health")
def health():
    return {"status": "ok"}


def _run_generation_job(job_id: str, req: GenerateRequest):
    """Runs in a background thread, started by start_generate_schedule below.
    The generation lock is already held by the time this starts -- acquired
    synchronously in the endpoint, before the thread was spawned -- and this
    function is responsible for releasing it once done, success or failure,
    via its finally block. This must never exit without going through that
    finally block, or the lock would stay held forever.

    The actual body here is unchanged from what used to run directly inside
    the request handler -- only where it runs, and how the result gets
    delivered, has changed."""
    try:
        if not req.block_requests:
            with _jobs_lock:
                _jobs[job_id]["status"] = "failed"
                _jobs[job_id]["error"] = "At least one block request must be provided."
            return

        (
            reqs,
            teachers,
            rooms,
            room_info,
            ranked_subjs,
            teachers_per_subj,
            max_load,
            teacher_id_map,
            class_id_meta,
            teacher_priority,
            teacher_availability,
        ) = fetch_scheduling_data(req.school_year, req.semester, req.block_requests)

        if not reqs:
            with _jobs_lock:
                _jobs[job_id]["status"] = "failed"
                _jobs[job_id]["error"] = "No class requirements generated for the selected parameters."
            return

        ml_lookup = build_ml_lookup(reqs, teachers, teachers_per_subj)

        best_schedule = run_memetic_algorithm(
            class_requirements=reqs,
            available_teachers=teachers,
            teachers_per_subject=teachers_per_subj,
            available_rooms=rooms,
            teacher_ranked_subjects=ranked_subjs,
            room_info=room_info,
            ml_lookup=ml_lookup,
            teacher_max_load=max_load,
            pop_size=req.pop_size,
            teacher_priority=teacher_priority,
            teacher_availability=teacher_availability,
        )

        breakdown = count_violations_by_category(
            best_schedule, ranked_subjs, room_info, max_load, teacher_priority, teachers_per_subj,
            teacher_availability=teacher_availability,
        )
        if breakdown:
            print("\n--- Violation breakdown by category (final result) ---")
            for category, count in sorted(breakdown.items(), key=lambda kv: -kv[1]):
                print(f"  {category:28s} {count}")
            print(f"  {'TOTAL':28s} {sum(breakdown.values())}")
            print("--------------------------------------------------------\n")

        drilldowns = {}

        if breakdown.get("HC05_room_type", 0) > 0:
            print("--- HC05_room_type drill-down: which genes, and is this a data gap? ---")
            drilldowns["HC05_room_type"] = diagnose_room_type_violations(best_schedule, room_info)
            print("--------------------------------------------------------\n")

        if breakdown.get("HC04_qualification", 0) > 0:
            print("--- HC04_qualification drill-down: who's assigned, and is anyone qualified at all? ---")
            drilldowns["HC04_qualification"] = diagnose_qualification_violations(best_schedule, ranked_subjs, teachers_per_subj)
            print("--------------------------------------------------------\n")

        if breakdown.get("daily_span", 0) > 0:
            print("--- daily_span drill-down: which sections/days, and the full class list ---")
            drilldowns["daily_span"] = diagnose_daily_span_violations(best_schedule)
            print("--------------------------------------------------------\n")

        if breakdown.get("teacher_overload", 0) > 0:
            print("--- teacher_overload drill-down: which teachers, by how much, and what's on their plate ---")
            drilldowns["teacher_overload"] = diagnose_teacher_overload_violations(best_schedule, max_load)
            print("--------------------------------------------------------\n")

        if breakdown.get("faculty_priority", 0) > 0:
            print("--- faculty_priority drill-down: who's assigned vs. who should've been used instead ---")
            drilldowns["faculty_priority"] = diagnose_faculty_priority_violations(best_schedule, teacher_priority, teachers_per_subj, max_load, teacher_availability)
            print("--------------------------------------------------------\n")

        if breakdown.get("teacher_unavailable", 0) > 0:
            print("--- teacher_unavailable drill-down: scheduled when vs. what they're actually available for ---")
            drilldowns["teacher_unavailable"] = diagnose_availability_violations(best_schedule, teacher_availability)
            print("--------------------------------------------------------\n")

        preview = format_schedule_preview(best_schedule, teacher_id_map, room_info, class_id_meta)

        with _jobs_lock:
            _jobs[job_id]["status"] = "complete"
            _jobs[job_id]["result"] = {
                "status": "success",
                "schedule": preview,
                "hard_violations": sum(breakdown.values()) if breakdown else 0,
                "violation_breakdown": breakdown,
                "violation_drilldowns": drilldowns,
            }

    except Exception as e:
        with _jobs_lock:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = str(e)
    finally:
        _generation_lock.release()


@app.post("/api/generate-schedule")
def start_generate_schedule(req: GenerateRequest):
    """Starts generation in a background thread and returns immediately with
    a job ID to poll, instead of holding one HTTP request open for up to an
    hour. Rejects immediately and synchronously -- no polling needed to
    discover this -- if another generation is already running, matching the
    exact same behavior this endpoint had before this change."""
    if not _generation_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="Another schedule generation is currently in progress on this server. Please wait for it to finish, then try again.",
        )

    _prune_old_jobs()

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {"status": "running", "created_at": time.time()}

    try:
        thread = threading.Thread(target=_run_generation_job, args=(job_id, req), daemon=True)
        thread.start()
    except Exception:
        # Extremely unlikely (thread creation failing means the system is
        # already in serious trouble), but if it happens, the lock must
        # still be released here, since _run_generation_job never got to run
        # its own finally block.
        with _jobs_lock:
            del _jobs[job_id]
        _generation_lock.release()
        raise

    return {"job_id": job_id, "status": "running"}


@app.get("/api/generate-schedule/{job_id}")
def get_generation_status(job_id: str):
    """Polled by the frontend every few seconds. Returns the job's current
    status, and once complete, the exact same result shape the old
    synchronous endpoint used to return directly."""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Unknown job ID -- it may have expired, or the server may have restarted since it was created.",
        )
    return job

if __name__ == "__main__":
    import uvicorn
    # Force binding to localhost on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)