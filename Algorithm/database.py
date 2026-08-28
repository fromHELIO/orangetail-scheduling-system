import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

from ml_predictor import get_faculty_compatibility
from scheduler import DEGREE_RANK, DURATION_MAP, _is_gened_subject


load_dotenv(Path(__file__).resolve().parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and/or SUPABASE_KEY are missing. Open "
        "memetic_engine_3/.env and fill in SUPABASE_KEY with the "
        "service-role secret key from Project Settings > API Keys "
        "(rotate it first if the old one was ever exposed). Do not "
        "hardcode credentials in source — keep them in that .env file only."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_scheduling_data(
    target_school_year: str, target_semester: int, block_requests: list
):
    """Read-only: fetches system master data and builds class requirements
    dynamically from user block selections. Nothing is written to the
    database here -- the frontend saves the returned schedule itself
    (status "Generated") immediately after this responds; approval is a
    separate, later status update the frontend does directly, not an
    algorithm-side action."""

    rooms_res = supabase.table("rooms").select("*").eq("is_active", True).execute().data
    available_rooms = [r["room_name"] for r in rooms_res]
    def _normalize_room_type(descriptive_type: str) -> str:
        """rooms.room_type holds a descriptive label for the UI (e.g. "Regular
        Lecture Room", "CISCO/Networking Laboratory", "Foley Room") --
        lab_matching.py needs a strict "LAB"/"LEC" binary. Every known lab
        category EXCEPT "Foley Room" contains the word "Laboratory", so
        checking for "LECTURE" instead (rather than "LAB") is what actually
        classifies all five correctly, Foley included.
        """
        return "LEC" if "LECTURE" in (descriptive_type or "").upper() else "LAB"

    room_info = {
        r["room_name"]: {
            "room_id": r["room_id"],
            "room_type": _normalize_room_type(r["room_type"]),
            "lab_cat": r.get("lab_cat", "NONE"),
            "lec_cat": r.get("lec_cat", "NONE"),
        }
        for r in rooms_res
    }

    profs_res = supabase.table("professor").select("*").eq("is_active", True).execute().data
    quals_res = supabase.table("professor_qualified_subjects").select("*").execute().data
    availability_res = supabase.table("professor_availability").select("*").execute().data
    courses_res = supabase.table("courses").select("*").execute().data
    curricula_res = supabase.table("curricula").select("*").execute().data
    programs_res = supabase.table("programs").select("*").execute().data
    curr_courses_res = supabase.table("curriculum_courses").select("*").execute().data

    course_id_to_code = {c["course_id"]: c["course_code"] for c in courses_res}
    course_map = {c["course_id"]: c for c in courses_res}
    curr_map = {c["curriculum_id"]: c for c in curricula_res}
    prog_map = {p["program_id"]: p["program_code"] for p in programs_res}

    available_teachers = []
    teacher_id_map = {}
    teacher_max_load = {}
    teacher_ranked_subjects = {}
    teachers_per_subject = {}
    teacher_priority = {}

    try:
        as_of_year = int(str(target_school_year).split("-")[0])
    except (ValueError, IndexError):
        as_of_year = datetime.now().year

    for p in profs_res:
        # Must match the format the ML model was actually trained on: real
        # historical teacher names are "LASTNAME, FIRSTNAME MI" (all-caps),
        # not "Firstname Lastname" -- using the wrong format means
        # get_faculty_compatibility() will never recognize any real teacher.
        last = (p.get("last_name") or "").strip().upper()
        first = (p.get("first_name") or "").strip().upper()
        middle = (p.get("middle_name") or "").strip().upper()
        mi = f" {middle[0]}" if middle else ""
        t_name = f"{last}, {first}{mi}"
        available_teachers.append(t_name)
        teacher_id_map[t_name] = p["professor_id"]
        # ETU (Equivalent Teaching Units) reduces a professor's load from the
        # regular 24-unit baseline -- it is NOT the cap itself. An explicit
        # ETU of 0 must still mean "full 24-unit capacity", so this checks
        # for None specifically rather than using `or`, which would treat a
        # real, recorded 0 the same as "not set".
        etu_raw = p.get("ETU")
        etu = float(etu_raw) if etu_raw is not None else 0.0
        teacher_max_load[t_name] = max(0.0, 24.0 - etu)

        # Faculty priority (Step 5): years of service computed from the real
        # appointment date rather than tracked separately, same reasoning as
        # scheduler.py's own load_data_from_json.
        years = 0
        appt_date = p.get("date_of_first_appointment")
        if appt_date:
            try:
                years = max(0, as_of_year - int(str(appt_date)[:4]))
            except (ValueError, TypeError):
                years = 0
        degree_rank = DEGREE_RANK.get(str(p.get("degree") or "").strip().upper(), 0)
        teacher_priority[t_name] = (years, degree_rank)

    # A teacher with zero recorded rows is unconstrained (graceful default for
    # anyone without this data yet, consistent with how teacher_max_load/
    # teacher_priority already default when absent). A teacher WITH at least
    # one row is only available during their recorded windows -- a day with
    # no window at all for them means unavailable that day, since that's what
    # specifying "available_days" actually implies.
    teacher_availability = {}
    for a in availability_res:
        t_name = next(
            (name for name, pid in teacher_id_map.items() if pid == a.get("professor_id")), None
        )
        if not t_name:
            continue
        start_min = _time_str_to_minutes(a.get("start_time"))
        end_min = _time_str_to_minutes(a.get("end_time"))
        if start_min is None or end_min is None:
            continue
        day = str(a.get("day_of_week") or "").strip().upper()
        if not day:
            continue
        teacher_availability.setdefault(t_name, []).append(
            {"day": day, "start_minute": start_min, "end_minute": end_min}
        )

    for q in quals_res:
        prof_id = q["professor_id"]
        c_code = course_id_to_code.get(q["course_id"])
        prof_name = next(
            (name for name, pid in teacher_id_map.items() if pid == prof_id), None
        )
        if prof_name and c_code:
            teacher_ranked_subjects.setdefault(prof_name, []).append(c_code)
            teachers_per_subject.setdefault(c_code, []).append(prof_name)

    class_requirements = []
    class_id_meta = {}
    class_id_counter = 1

    for req_item in block_requests:
        c_id = req_item.curriculum_id
        y_lvl = req_item.year_lvl
        n_blocks = req_item.num_blocks
        selected_course_ids = req_item.course_ids

        curr_info = curr_map.get(c_id, {})
        program_id = curr_info.get("program_id")
        curriculum_year = curr_info.get("curriculum_year")
        prog_code = prog_map.get(program_id, "GEN")

        matching_curr_courses = [
            cc
            for cc in curr_courses_res
            if cc["curriculum_id"] == c_id
            and cc["year_lvl"] == y_lvl
            and cc["semester"] == target_semester
        ]
        if selected_course_ids:
            matching_curr_courses = [
                cc for cc in matching_curr_courses if cc["course_id"] in selected_course_ids
            ]

        for block_num in range(1, n_blocks + 1):
            block_letter = chr(64 + block_num)
            section_name = f"{prog_code} {y_lvl}-{block_letter}"

            for cc in matching_curr_courses:
                course = course_map.get(cc["course_id"])
                if not course:
                    continue

                lec_hours = course.get("lec_hours") or 0
                lab_hours = course.get("lab_hours") or 0
                meetings = []
                if lec_hours > 0 and lab_hours > 0:
                    meetings = [
                        {"schedtype": "LEC_2H", "lab_cat": "NONE"},
                        {"schedtype": "LAB_3H", "lab_cat": course.get("lab_cat", "COMPUTER")},
                    ]
                elif lab_hours > 0:
                    meetings = [
                        {"schedtype": "LAB_3H", "lab_cat": course.get("lab_cat", "COMPUTER")}
                    ]
                else:
                    meetings = [
                        {"schedtype": "LEC_1.5H", "lab_cat": "NONE"},
                        {"schedtype": "LEC_1.5H", "lab_cat": "NONE"},
                    ]

                total_units = float(course.get("units") or 3)
                meeting_durations = [DURATION_MAP.get(str(m["schedtype"]).upper(), 90) for m in meetings]
                total_duration = sum(meeting_durations)

                for idx, (m, m_duration) in enumerate(zip(meetings, meeting_durations), start=1):
                    meeting_units = (
                        total_units * m_duration / total_duration if total_duration > 0
                        else total_units / len(meetings)
                    )
                    cid = class_id_counter
                    class_requirements.append(
                        {
                            "class_id": cid,
                            "course_id": course["course_id"],
                            "section_id": None,  # no section row exists yet
                            "SUBJCODE": course["course_code"],
                            "PROGRAM": prog_code,
                            "YEAR_LEVEL": y_lvl,
                            "SCHOOL_YEAR": target_school_year,
                            "SEMESTER": target_semester,
                            "SCHEDTYPE": m["schedtype"],
                            "LAB_CAT": m["lab_cat"],
                            "B.SECTION": section_name,
                            "MEETING_NUM": idx,
                            "UNITS": meeting_units,
                        }
                    )
                    class_id_meta[cid] = {
                        "curriculum_id": c_id,
                        "program_id": program_id,
                        "curriculum_year": curriculum_year,
                        "course_name": course.get("course_name"),
                        "course_id": course["course_id"],
                    }
                    class_id_counter += 1

    return (
        class_requirements,
        available_teachers,
        available_rooms,
        room_info,
        teacher_ranked_subjects,
        teachers_per_subject,
        teacher_max_load,
        teacher_id_map,
        class_id_meta,
        teacher_priority,
        teacher_availability,
    )


def build_ml_lookup(class_requirements: list, available_teachers: list, teachers_per_subject: dict = None) -> dict:
    """Precomputes get_faculty_compatibility() for every (teacher, subject,
    program, year_level) combination that could actually influence the
    algorithm's choice -- one real model call per unique combination, cached
    and reused across every meeting that shares it (e.g. a course's LEC and
    LAB meetings share one cache entry, since neither SCHEDTYPE nor LAB_CAT
    is part of the key).

    Two things are deliberately skipped, both because evaluate_fitness could
    never actually use them:

    - GenEd/non-SoC subjects: their genes get a placeholder teacher and
      never touch ml_lookup at all (evaluate_fitness skips them outright via
      _is_gened_subject). Computing predictions for them is pure waste --
      confirmed, not assumed, by reading evaluate_fitness itself.
    - Teachers outside a subject's qualified pool (teachers_per_subject):
      HC-04 makes an unqualified assignment a hard violation worth -10000 in
      the fitness function, which no soft-preference score (capped at +100
      per gene) could ever outweigh. A favorable ML score for an unqualified
      teacher would never change what the algorithm actually selects, so
      computing it buys nothing. Falls back to checking every teacher only
      when a subject has no specifically qualified candidates at all --
      matching initialize_population's own fallback exactly, so the ML
      lookup never has a gap the algorithm might actually need filled.
    """
    ml_lookup = {}
    for req in class_requirements:
        subj = req["SUBJCODE"]
        if _is_gened_subject(subj):
            continue
        candidates = (teachers_per_subject or {}).get(subj) or available_teachers
        for teacher in candidates:
            key = (teacher, subj, req["PROGRAM"], req["YEAR_LEVEL"])
            if key not in ml_lookup:
                ml_lookup[key] = get_faculty_compatibility(
                    subjcode=subj,
                    program=req["PROGRAM"],
                    year_level=req["YEAR_LEVEL"],
                    school_year=req["SCHOOL_YEAR"],
                    semester=req["SEMESTER"],
                    schedtype=req["SCHEDTYPE"],
                    lab_cat=req["LAB_CAT"],
                    teacher_name=teacher,
                )
    return ml_lookup


def _time_str_to_minutes(time_str):
    """Parses 'HH:MM' or 'HH:MM:SS' (Postgres TIME columns commonly return
    the latter) into minutes since midnight. Returns None if unparseable,
    so callers can skip a malformed entry gracefully rather than crash the
    whole request over one bad row."""
    if not time_str:
        return None
    try:
        parts = str(time_str).split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return None


def _minutes_to_hhmmss(mins: int) -> str:
    """The frontend spec calls for 'HH:MM or HH:MM:SS -- seconds are stripped
    by frontend', i.e. a plain 24-hour clock string, not scheduler.py's own
    minutes_to_time_str() (which returns '07:00 AM' for human-readable
    console/Excel output elsewhere and is correct to leave as-is there)."""
    hours = mins // 60
    minutes = mins % 60
    return f"{hours:02d}:{minutes:02d}:00"


def format_schedule_preview(final_schedule, teacher_id_map, room_info, class_id_meta):
    """Turns the algorithm's raw Gene list into plain dicts for the frontend
    to preview. Nothing is written to the database at this point — these
    items round-trip back from the frontend on Approve to actually be saved."""

    preview = []
    for g in final_schedule:
        meta = class_id_meta.get(g.class_id, {})
        curriculum_year = meta.get("curriculum_year")
        preview.append(
            {
                "class_id": g.class_id,
                "course_id": meta.get("course_id"),
                "course_code": g.subjcode,
                "course_name": meta.get("course_name"),
                "curriculum_id": meta.get("curriculum_id"),
                "program_id": meta.get("program_id"),
                "curriculum_label": (
                    f"{g.program} {curriculum_year}" if curriculum_year else g.program
                ),
                "year_lvl": g.year_level,
                "section_name": g.section,
                "school_year": g.school_year,
                "semester": g.semester,
                "schedtype": g.schedtype,
                "professor_id": teacher_id_map.get(g.teacher_name),
                "professor_name": g.teacher_name,
                "room_id": room_info.get(g.room, {}).get("room_id"),
                "room_name": g.room,
                "day": g.day,
                "start_minute": g.start_minute,
                "end_minute": g.end_minute,
                "start_time": _minutes_to_hhmmss(g.start_minute),
                "end_time": _minutes_to_hhmmss(g.end_minute),
            }
        )
    return preview

