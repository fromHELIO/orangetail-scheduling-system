from typing import List, Optional
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


@app.post("/api/generate-schedule")
def generate_schedule_endpoint(req: GenerateRequest):
    """Runs the algorithm and returns the schedule. Nothing is written to the
    database here -- the frontend saves this itself (status "Generated")
    right after receiving it; this endpoint doesn't know or care what happens
    to its response after it's returned."""
    try:
        if not req.block_requests:
            raise HTTPException(
                status_code=400, detail="At least one block request must be provided."
            )

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
            raise HTTPException(
                status_code=400,
                detail="No class requirements generated for the selected parameters.",
            )

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

        return {
            "status": "success",
            "schedule": preview,
            "hard_violations": sum(breakdown.values()) if breakdown else 0,
            "violation_breakdown": breakdown,
            "violation_drilldowns": drilldowns,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
