import json
import math
import random
import copy
import datetime
import time
from collections import defaultdict
import pandas as pd

# Import your ML model function (adjust module path as needed)
from ml_predictor import get_faculty_compatibility

# Specialized-labs room matching (lab_cat-aware, replaces the old binary LEC/LAB check)
import lab_matching


# ==============================================================================
# 0. CONTINUOUS TIME & DURATION CONFIGURATION (7:00 AM to 9:00 PM Bounds)
# ==============================================================================
DAY_START_MIN = 7 * 60   # 7:00 AM = 420 mins from midnight
DAY_END_MIN = 21 * 60    # 9:00 PM = 1260 mins from midnight
DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]
DAY_PAIR = {"MON": "THU", "THU": "MON", "TUE": "FRI", "FRI": "TUE", "WED": "SAT", "SAT": "WED"}
MUTATION_RATE = 0.05     # 🟢 Fixed: Safe low mutation rate to prevent schema destruction
MIN_SHORT_REST_MINUTES = 15  # minimum gap between any two back-to-back classes, same teacher or same section
MAX_CONTINUOUS_TEACHING_MINUTES = 3 * 60  # HC-11: teaching beyond this without a real break is a violation
REQUIRED_FACULTY_BREAK_MINUTES = 60       # HC-11: a gap must reach this length to count as the break, not just any gap
MAX_CONTINUOUS_CLASS_MINUTES = int(4.5 * 60)  # student-side: matches the interview's own example (3x1.5hr classes)
REQUIRED_STUDENT_BREAK_MINUTES = 45           # student-side: the floor of the confirmed 45min-2hr range
MAX_SECTION_DAILY_MINUTES = 9 * 60            # a section's whole day at school, breaks included, capped here

DURATION_MAP = {
    "LEC_1.5H": 90,
    "LEC_2H": 120,
    "LAB_3H": 180,
    "LEC": 90,
    "LAB": 180
}

def minutes_to_time_str(mins):
    hours = mins // 60
    minutes = mins % 60
    period = "AM" if hours < 12 else "PM"
    display_hours = hours if hours <= 12 else hours - 12
    if display_hours == 0:
        display_hours = 12
    return f"{display_hours:02d}:{minutes:02d} {period}"

def generate_random_schedule_time(schedtype, step=15, exclude_days=None):
    duration = DURATION_MAP.get(str(schedtype).upper(), 90)
    available_days = [d for d in DAYS if exclude_days is None or d not in exclude_days]
    if not available_days:
        available_days = DAYS
    day = random.choice(available_days)
    
    latest_start = DAY_END_MIN - duration
    if latest_start < DAY_START_MIN:
        raise ValueError(f"Duration {duration} mins exceeds daily operating window!")
        
    possible_starts = list(range(DAY_START_MIN, latest_start + 1, step))
    start_min = random.choice(possible_starts)
    return day, start_min, duration

def _pairing_mode_for_schedtypes(schedtypes):
    """
    Classifies a linked meeting pair for HC-07/HC-08 day-pairing purposes.

    Returns 'lecture_pair' for two non-lab meetings (a pure-lecture or
    General Education course's two LEC_1.5H meetings) -- these pair onto
    MON/THU, TUE/FRI, or WED/SAT, at the same time, in the same room.

    Returns 'split_pair' for a lab + non-lab pair (a SPLIT course's LEC_2H +
    LAB_3H meetings) -- these pair onto the same day-set, but independently
    timed and independently roomed (the LEC half routes to a SPLITLEC room
    via lab_matching.py, the LAB half to an actual lab).

    Returns None for anything that isn't a 2-meeting group (a single LAB_3H
    meeting has no partner to pair against, matching how the original
    Faculty Administrator interview describes pure lab: "wala naman siyang
    partner na lecture" -- no day-pairing constraint applies to it).
    """
    if len(schedtypes) != 2:
        return None
    has_lab = any('LAB' in str(s).upper() for s in schedtypes)
    return 'split_pair' if has_lab else 'lecture_pair'

def _generate_paired_meeting_times(schedtypes, exclude_days=None):
    """
    Generates day/start_minute/duration for both meetings of a linked pair
    together, so the day-pairing invariant (and, for lecture_pair, the
    same-time requirement) holds by construction rather than by chance.

    schedtypes: exactly 2 schedtype strings, same order the caller wants
                the returned list back in.
    Returns a list of two (day, start_minute, duration) tuples, or None if
    schedtypes doesn't describe a pairing-eligible group.
    """
    mode = _pairing_mode_for_schedtypes(schedtypes)
    if mode is None:
        return None

    day0, start0, dur0 = generate_random_schedule_time(schedtypes[0], step=15, exclude_days=exclude_days)
    day1 = DAY_PAIR[day0]
    # Force the second meeting onto its paired day by excluding every other
    # day, rather than modifying generate_random_schedule_time's signature --
    # keeps that function, and every other call site of it, untouched.
    force_day1 = [d for d in DAYS if d != day1]
    _, start1, dur1 = generate_random_schedule_time(schedtypes[1], step=15, exclude_days=force_day1)

    if mode == 'lecture_pair':
        start1 = start0  # same time, matching the same-room requirement handled by the caller

    return [(day0, start0, dur0), (day1, start1, dur1)]

DEGREE_RANK = {"BACHELOR'S DEGREE": 1, "MASTER'S DEGREE": 2, "DOCTORATE": 3}

def _years_of_service(date_of_first_appointment, as_of_year):
    """Years of service as of the target school year's start, computed from
    date_of_first_appointment (an ISO date string like '2010-06-15') rather
    than tracked as a separately-maintained number that could drift out of
    sync with the actual appointment date."""
    if not date_of_first_appointment:
        return 0
    try:
        appt_year = int(str(date_of_first_appointment)[:4])
        return max(0, as_of_year - appt_year)
    except (ValueError, TypeError):
        return 0

def _teacher_priority_score(teacher_name, teacher_priority):
    """(years_of_service, degree_rank) -- compares correctly as a tuple, so
    seniority always wins first and degree only breaks a seniority tie.
    Missing/unranked teachers default to the lowest priority rather than
    guessing, so an unranked teacher never accidentally outranks a ranked one."""
    if not teacher_priority:
        return (0, 0)
    return teacher_priority.get(teacher_name, (0, 0))

def _is_gened_subject(subjcode):
    """
    Is this a General Education / non-SoC subject, as opposed to a School of
    Computing major course? Reuses the same 6-prefix convention already used
    throughout this project to identify SoC major courses (SoC_Major_Courses_
    Curricula.xlsx, cleaned_dataset.xlsx, and every fixture built from them
    all use this filter) -- GenEd and other non-SoC subjects never carry it.
    """
    return not str(subjcode).upper().startswith('6')

def genes_overlap(gene1, gene2):
    if gene1.day != gene2.day:
        return False
    return max(gene1.start_minute, gene2.start_minute) < min(gene1.end_minute, gene2.end_minute)


def _is_teacher_available(teacher_name, day, start_minute, end_minute, teacher_availability):
    """True if the teacher has no recorded availability rows at all (the
    graceful default for anyone without this data yet, consistent with how
    teacher_max_load/teacher_priority already default when absent), or if
    [start_minute, end_minute) falls entirely within at least one of their
    recorded windows for this specific day. A teacher WITH some rows but
    none for this particular day is treated as unavailable that day --
    that's what recording "available_days" actually implies.
    """
    if not teacher_availability:
        return True
    windows = teacher_availability.get(teacher_name)
    if windows is None:
        return True
    day_windows = [w for w in windows if w["day"] == day]
    if not day_windows:
        return False
    return any(
        w["start_minute"] <= start_minute and end_minute <= w["end_minute"]
        for w in day_windows
    )


# ==============================================================================
# 1. CHROMOSOME & GENE STRUCTURE
# ==============================================================================
class Gene:
    def __init__(self, class_id, subjcode, program, year_level, school_year, 
                 semester, schedtype, lab_cat, section, meeting_num,
                 teacher_name, day, start_minute, duration, room, units=1.0):
        self.class_id = class_id
        self.subjcode = str(subjcode).strip()
        self.program = str(program).strip()
        self.year_level = int(year_level)
        self.school_year = str(school_year).strip()
        self.semester = int(semester)
        self.schedtype = str(schedtype).strip()
        self.lab_cat = str(lab_cat).strip()
        self.section = str(section).strip()
        self.meeting_num = int(meeting_num)

        self.teacher_name = teacher_name
        self.day = day
        self.start_minute = start_minute
        self.duration = duration
        self.room = room
        self.units = float(units)  # this meeting's own share of the course's total units,
                                     # not the course's total -- see load_data_from_json /
                                     # database.py's fetch_scheduling_data for how it's split.
                                     # Defaults to 1.0 so any existing code constructing a
                                     # Gene without it keeps the old meeting-count behavior.

    @property
    def end_minute(self):
        return self.start_minute + self.duration

    @property
    def timeslot_str(self):
        return f"{self.day}_{minutes_to_time_str(self.start_minute)}-{minutes_to_time_str(self.end_minute)}"

    def copy(self):
        return Gene(
            self.class_id, self.subjcode, self.program, self.year_level,
            self.school_year, self.semester, self.schedtype, self.lab_cat,
            self.section, self.meeting_num, self.teacher_name, self.day,
            self.start_minute, self.duration, self.room, units=self.units
        )


# ==============================================================================
# 2. DATA INGESTION & REQUIREMENT EXPANSION
# ==============================================================================
def load_data_from_json(blocks_file, curriculum_file, teachers_file, rooms_file, 
                        target_semester=1, target_school_year="2026-2027"):
    with open(blocks_file, 'r') as f:
        blocks_data = json.load(f)
    with open(curriculum_file, 'r') as f:
        curriculum_raw = json.load(f)
    with open(teachers_file, 'r') as f:
        teachers_data = json.load(f)
    with open(rooms_file, 'r') as f:
        rooms_data = json.load(f)

    curriculum_data = []
    for item in curriculum_raw:
        if "year_levels" in item:
            curr_id = str(item.get("curriculum_id", "")).strip()
            program = str(item.get("program", "")).strip()
            for y_obj in item.get("year_levels", []):
                y_lvl = int(y_obj["year_level"])
                for s_obj in y_obj.get("semesters", []):
                    sem = int(s_obj["semester"])
                    for subj in s_obj.get("subjects", []):
                        curriculum_data.append({
                            "curriculum_id": curr_id,
                            "program": program,
                            "year_level": y_lvl,
                            "semester": sem,
                            "subjcode": str(subj["subjcode"]).strip(),
                            "subjtitle": subj.get("subjtitle", ""),
                            "units": subj.get("units", 3),
                            "schedtype": str(subj.get("schedtype", "LEC")).strip(),
                            "lab_cat": str(subj.get("lab_cat", "NONE")).strip(),
                            "meetings": subj.get("meetings", [])
                        })
        else:
            curriculum_data.append({
                "curriculum_id": str(item.get("curriculum_id", "")).strip(),
                "program": str(item.get("program", "")).strip(),
                "year_level": int(item["year_level"]),
                "semester": int(item["semester"]),
                "subjcode": str(item["subjcode"]).strip(),
                "subjtitle": item.get("subjtitle", ""),
                "units": item.get("units", 3),
                "schedtype": str(item.get("schedtype", "LEC")).strip(),
                "lab_cat": str(item.get("lab_cat", "NONE")).strip(),
                "meetings": item.get("meetings", [])
            })

    available_teachers = []
    teacher_ranked_subjects = {}
    teachers_per_subject = {}
    teacher_max_load = {}
    teacher_priority = {}

    try:
        as_of_year = int(str(target_school_year).split('-')[0])
    except (ValueError, IndexError):
        as_of_year = 2026

    for t in teachers_data:
        t_name = t['name'] if isinstance(t, dict) else t
        available_teachers.append(t_name)

        if isinstance(t, dict):
            etu_raw = t.get('ETU')
            if etu_raw is not None:
                teacher_max_load[t_name] = max(0.0, 24.0 - float(etu_raw))
            else:
                teacher_max_load[t_name] = t.get('max_semester_load', 24)
            years = _years_of_service(t.get('date_of_first_appointment'), as_of_year)
            degree_rank = DEGREE_RANK.get(str(t.get('degree', '')).strip().upper(), 0)
            teacher_priority[t_name] = (years, degree_rank)
            if 'ranked_eligible_subjects' in t:
                ranked_list = [str(s).strip() for s in t['ranked_eligible_subjects']]
                teacher_ranked_subjects[t_name] = ranked_list
                for subj in ranked_list:
                    if subj not in teachers_per_subject:
                        teachers_per_subject[subj] = []
                    teachers_per_subject[subj].append(t_name)

    room_info = {}
    available_rooms = []
    for r in rooms_data:
        r_name = r['room_name'] if isinstance(r, dict) else r
        r_type = r.get('room_type', 'LEC') if isinstance(r, dict) else 'LEC'
        r_lab_cat = r.get('lab_cat', 'NONE') if isinstance(r, dict) else 'NONE'
        r_lec_cat = r.get('lec_cat', 'NONE') if isinstance(r, dict) else 'NONE'
        available_rooms.append(r_name)
        room_info[r_name] = {'room_type': r_type, 'lab_cat': r_lab_cat, 'lec_cat': r_lec_cat}

    class_requirements = []
    class_id_counter = 1

    target_sy_str = str(target_school_year).strip()
    target_sem_int = int(target_semester)

    for block in blocks_data:
        b_id = str(block['block_id']).strip()
        prog = str(block['program']).strip()
        y_level = int(block['year_level'])
        curr_id = str(block.get('curriculum_id', '')).strip()
        sy = str(block.get('school_year', target_sy_str)).strip()
        sem = int(block.get('semester', target_sem_int))

        if sy != target_sy_str or sem != target_sem_int:
            continue

        matching_subjects = [
            c for c in curriculum_data 
            if c['curriculum_id'] == curr_id 
            and c['year_level'] == y_level 
            and c['semester'] == target_sem_int
        ]

        if not matching_subjects:
            matching_subjects = [
                c for c in curriculum_data 
                if c['program'] == prog 
                and c['year_level'] == y_level 
                and c['semester'] == target_sem_int
            ]

        for subj in matching_subjects:
            meetings = subj.get('meetings', [])
            if not meetings:
                stype = str(subj.get('schedtype', 'LEC')).upper()
                if stype == 'SPLIT':
                    meetings = [
                        {'schedtype': 'LEC_2H', 'lab_cat': 'NONE'},
                        {'schedtype': 'LAB_3H', 'lab_cat': subj.get('lab_cat', 'COMPUTER')}
                    ]
                elif stype == 'LEC':
                    meetings = [
                        {'schedtype': 'LEC_1.5H', 'lab_cat': 'NONE'},
                        {'schedtype': 'LEC_1.5H', 'lab_cat': 'NONE'}
                    ]
                elif stype == 'LAB':
                    meetings = [
                        {'schedtype': 'LAB_3H', 'lab_cat': subj.get('lab_cat', 'NONE')}
                    ]
                else:
                    meetings = [{'schedtype': stype, 'lab_cat': subj.get('lab_cat', 'NONE')}]

            total_units = float(subj.get('units', 3))
            meeting_durations = [DURATION_MAP.get(str(m['schedtype']).upper(), 90) for m in meetings]
            total_duration = sum(meeting_durations)

            for meeting_idx, (m, m_duration) in enumerate(zip(meetings, meeting_durations), start=1):
                meeting_units = (
                    total_units * m_duration / total_duration if total_duration > 0
                    else total_units / len(meetings)
                )
                class_requirements.append({
                    'class_id': class_id_counter,
                    'SUBJCODE': subj['subjcode'],
                    'PROGRAM': prog,
                    'YEAR_LEVEL': y_level,
                    'SCHOOL_YEAR': sy,
                    'SEMESTER': sem,
                    'SCHEDTYPE': m['schedtype'],
                    'LAB_CAT': m.get('lab_cat', 'NONE'),
                    'B.SECTION': b_id,
                    'MEETING_NUM': meeting_idx,
                    'UNITS': meeting_units,
                })
                class_id_counter += 1

    return (
        class_requirements, available_teachers, available_rooms, 
        room_info, teacher_ranked_subjects, teachers_per_subject, teacher_max_load,
        teacher_priority
    )


# ==============================================================================
# 3. GRANULAR CONFLICT METRIC & DIAGNOSTICS
# ==============================================================================

def _daily_sequences(chromosome, key_func):
    """Groups (index, gene) pairs by (key_func(gene), day), each group sorted
    by start_minute. Shared foundation for every break/rest rule: HC-11
    (faculty break), the student break + 9-hour cap, and the short-rest
    check right below. key_func extracts which axis to scan -- teacher_name
    for the faculty side, section for the student side.

    Storing (index, gene) rather than bare genes, not just genes, mirrors
    the same shape teacher_schedule/room_schedule/section_schedule already
    use below -- callers that need to report a specific violating gene back
    (get_conflicting_gene_indices) need the original chromosome index, not
    just the gene object.
    """
    groups = defaultdict(list)
    for idx, g in enumerate(chromosome):
        groups[(key_func(g), g.day)].append((idx, g))
    for key in groups:
        groups[key].sort(key=lambda pair: pair[1].start_minute)
    return groups


def _valid_gap(gap, required_break_minutes):
    """A gap is only ever acceptable in one of two forms: exactly
    MIN_SHORT_REST_MINUTES (the short transition between two classes that
    are effectively part of the same stretch), or at least
    required_break_minutes (a genuine, purposeful break). Anything strictly
    between those two values is neither a real transition nor a real break
    -- it's just wasted time, and this rule now forbids it outright rather
    than merely discouraging it.
    """
    return gap == MIN_SHORT_REST_MINUTES or gap >= required_break_minutes


def _short_rest_violation_pairs(chromosome):
    """Yields (later_idx, earlier_idx) for every adjacent same-day pair --
    teacher axis and section axis both, since whoever's moving between two
    different classes needs some minimal transition time, not just students
    -- whose gap is neither exactly MIN_SHORT_REST_MINUTES nor a genuine
    substantial break (REQUIRED_FACULTY_BREAK_MINUTES on the teacher axis,
    REQUIRED_STUDENT_BREAK_MINUTES on the section axis).

    Negative gaps (actual overlaps) are deliberately excluded: those are
    already counted by the teacher/room/section conflict checks below, and
    flagging them again here would penalize the same problem twice under
    two different names.
    """
    for key_func, required_break in (
        (lambda g: g.teacher_name, REQUIRED_FACULTY_BREAK_MINUTES),
        (lambda g: g.section, REQUIRED_STUDENT_BREAK_MINUTES),
    ):
        for seq in _daily_sequences(chromosome, key_func).values():
            for (prev_idx, prev_g), (curr_idx, curr_g) in zip(seq, seq[1:]):
                gap = curr_g.start_minute - prev_g.end_minute
                if gap >= 0 and not _valid_gap(gap, required_break):
                    yield curr_idx, prev_idx


def _continuous_hours_violations(chromosome, key_func, max_continuous_minutes, required_break_minutes):
    """Yields the index of every gene that's part of a continuous stretch
    (same key_func-extracted entity, same day) exceeding
    max_continuous_minutes without a real break. A gap only counts as the
    required break once it reaches required_break_minutes -- anything
    shorter, even a gap clearing Step 1's 15-minute short-rest floor, is
    just a breather and doesn't reset the accumulated count. Shared by both
    HC-11 (faculty: 3hr/1hr) and the student break rule (4.5hr/45min) --
    same mechanism, different axis and numbers.

    Yields one index per gene once the stretch has exceeded the limit (not
    the whole stretch from its start), matching how teacher_max_load
    already counts excess rather than merely flagging that excess exists.
    """
    for seq in _daily_sequences(chromosome, key_func).values():
        if not seq:
            continue
        accumulated = seq[0][1].duration
        for (prev_idx, prev_g), (curr_idx, curr_g) in zip(seq, seq[1:]):
            gap = curr_g.start_minute - prev_g.end_minute
            if gap >= required_break_minutes:
                accumulated = curr_g.duration  # a real break was taken -- stretch resets
            else:
                accumulated += curr_g.duration
                if accumulated > max_continuous_minutes:
                    yield curr_idx


def _faculty_break_violations(chromosome):
    """HC-11, grounded directly in the original interview ("Kailangan 3
    hours, after 3 hours bibigyan mo siya ng break na 1 hour"). GenEd's
    placeholder teachers never appear here: each is unique per (section,
    subject), and that course's own meetings are day-paired onto different
    days (Step 3), so no placeholder ever has two same-day genes to even
    form a pair from.
    """
    return _continuous_hours_violations(
        chromosome, lambda g: g.teacher_name,
        MAX_CONTINUOUS_TEACHING_MINUTES, REQUIRED_FACULTY_BREAK_MINUTES,
    )


def _student_break_violations(chromosome):
    """The section-side counterpart to HC-11: a vacant period after
    MAX_CONTINUOUS_CLASS_MINUTES of continuous class time, confirmed at
    4.5 hours -- matching the interview's own example of three 1.5-hour
    classes. Unlike the faculty rule, GenEd genes are deliberately included
    here rather than excluded: a student sitting through a GenEd class is
    still sitting through a class, and it counts toward their fatigue the
    same as any major-course class would.
    """
    return _continuous_hours_violations(
        chromosome, lambda g: g.section,
        MAX_CONTINUOUS_CLASS_MINUTES, REQUIRED_STUDENT_BREAK_MINUTES,
    )


def _daily_span_violations(chromosome):
    """Yields (first_idx, last_idx) for every (section, day) whose total
    span -- first class's start to last class's end, every break in
    between included -- exceeds MAX_SECTION_DAILY_MINUTES. One violation
    per over-limit day, not one per gene in it: the span is a property of
    the whole day, not something that scales per class the way the
    continuous-hours rules do. Closer in spirit to HC-09's simple
    per-instance flagging than to teacher_max_load's excess-count style.

    Only the first and last gene of the day are yielded, not everything in
    between: those are the two endpoints that actually define the span, and
    the only ones whose movement could change it. GenEd genes participate
    normally here too, for the same reason they do in the continuous-hours
    rule above.
    """
    for seq in _daily_sequences(chromosome, lambda g: g.section).values():
        if len(seq) < 2:
            continue
        first_idx, first_g = seq[0]
        last_idx, last_g = seq[-1]
        span = last_g.end_minute - first_g.start_minute
        if span > MAX_SECTION_DAILY_MINUTES:
            yield first_idx, last_idx


def _accumulated_at_each_peer(sorted_peers, required_break):
    """Parallel list of accumulated continuous minutes ending at each peer
    in a sorted same-day, same-entity sequence, using the exact same
    reset-on-real-break logic as _continuous_hours_violations. Kept as one
    shared computation specifically so violation detection and candidate
    generation can never quietly disagree about what counts as 'still
    building up' versus 'already reset by a real break'.
    """
    result = []
    accumulated = None
    prev_g = None
    for peer in sorted_peers:
        if prev_g is None:
            accumulated = peer.duration
        else:
            gap = peer.start_minute - prev_g.end_minute
            accumulated = peer.duration if gap >= required_break else accumulated + peer.duration
        result.append(accumulated)
        prev_g = peer
    return result


def _snap_candidates_for_day(chromosome, exclude_indices, key_func, entity, day, duration, required_break, max_continuous):
    """Valid start_minutes for a new class of the given duration, added to
    `entity`'s schedule on `day`, such that its gap to every existing peer
    (excluding exclude_indices) is either exactly MIN_SHORT_REST_MINUTES or
    at least required_break -- checks only the one axis key_func/entity
    describes; callers needing both axes to hold combine two calls of this.
    Returns an empty list if `entity` has no peers on `day` at all -- there's
    nothing to snap relative to.

    Per peer, only ONE of the two offsets gets proposed, not both: the tight
    15-minute one if joining that peer's existing accumulated stretch would
    still fit under max_continuous, or the substantial-break one only if it
    wouldn't. Offering both unconditionally was the actual bug reported --
    it meant a coin-flip chance of inserting a long break even when nowhere
    near the accumulated-hours limit that's supposed to be the only reason
    for one.
    """
    peers = sorted(
        [g for idx, g in enumerate(chromosome)
         if idx not in exclude_indices and key_func(g) == entity and g.day == day],
        key=lambda gene: gene.start_minute,
    )
    if not peers:
        return []

    accumulated_at = _accumulated_at_each_peer(peers, required_break)

    candidates = set()
    for peer, acc in zip(peers, accumulated_at):
        offset = MIN_SHORT_REST_MINUTES if acc + duration <= max_continuous else required_break
        candidates.add(peer.end_minute + offset)              # placed after this peer
        candidates.add(peer.start_minute - offset - duration)  # placed before this peer

    valid = []
    for start in candidates:
        end = start + duration
        if start < DAY_START_MIN or end > DAY_END_MIN:
            continue
        ok = True
        for peer in peers:
            gap_after = start - peer.end_minute
            gap_before = peer.start_minute - end
            if gap_after >= 0:
                ok = _valid_gap(gap_after, required_break)
            elif gap_before >= 0:
                ok = _valid_gap(gap_before, required_break)
            else:
                ok = False  # overlaps this peer outright
            if not ok:
                break
        if ok:
            valid.append(start)
    return valid


def _smart_time_candidates(chromosome, target_gene, exclude_indices, schedtype):
    """Tries to find (day, start_minute) placements for a replacement gene
    that satisfy the strict short-rest rule relative to its teacher's AND
    section's existing same-day classes at once, not just avoid violating it
    by accident. A day where both axes have peers only counts if some start
    time works for both simultaneously -- fixing the teacher side while
    breaking the section side (or vice versa) isn't a real fix, just a
    relocated problem. Returns an empty list if the target has no peers on
    any day yet at all; the caller falls back to plain random placement.
    """
    duration = DURATION_MAP.get(str(schedtype).upper(), 90)
    teacher_days = {g.day for idx, g in enumerate(chromosome)
                     if idx not in exclude_indices and g.teacher_name == target_gene.teacher_name}
    section_days = {g.day for idx, g in enumerate(chromosome)
                     if idx not in exclude_indices and g.section == target_gene.section}

    results = []
    for day in teacher_days | section_days:
        needs_teacher = day in teacher_days
        needs_section = day in section_days
        t_starts = set(_snap_candidates_for_day(chromosome, exclude_indices, lambda g: g.teacher_name,
                        target_gene.teacher_name, day, duration, REQUIRED_FACULTY_BREAK_MINUTES,
                        MAX_CONTINUOUS_TEACHING_MINUTES)) if needs_teacher else None
        s_starts = set(_snap_candidates_for_day(chromosome, exclude_indices, lambda g: g.section,
                        target_gene.section, day, duration, REQUIRED_STUDENT_BREAK_MINUTES,
                        MAX_CONTINUOUS_CLASS_MINUTES)) if needs_section else None

        if needs_teacher and needs_section:
            starts = t_starts & s_starts
        elif needs_teacher:
            starts = t_starts
        else:
            starts = s_starts
        results.extend((day, s) for s in starts)

    return results


def count_total_violations(chromosome, teacher_ranked_subjects=None, room_info=None, teacher_max_load=None, teacher_priority=None, teachers_per_subject=None, teacher_availability=None):
    """Calculates the exact sum of all individual rule violations (granular metric)."""
    total_violations = 0
    
    teacher_schedule = defaultdict(list)
    room_schedule = defaultdict(list)
    section_schedule = defaultdict(list)
    section_subject = defaultdict(list)
    teacher_counts = defaultdict(float)

    for idx, g in enumerate(chromosome):
        teacher_counts[g.teacher_name] += g.units

        if g.start_minute < DAY_START_MIN or g.end_minute > DAY_END_MIN:
            total_violations += 1

        if teacher_availability and not _is_gened_subject(g.subjcode):
            if not _is_teacher_available(g.teacher_name, g.day, g.start_minute, g.end_minute, teacher_availability):
                total_violations += 1

        if teacher_ranked_subjects:
            ranked = teacher_ranked_subjects.get(g.teacher_name, [])
            if ranked and g.subjcode not in ranked:
                total_violations += 1

        if room_info and not _is_gened_subject(g.subjcode):
            if not lab_matching.is_valid_room(g.schedtype, g.lab_cat, room_info.get(g.room)):
                total_violations += 1

        for _, existing in teacher_schedule[g.teacher_name]:
            if genes_overlap(g, existing):
                total_violations += 1
        teacher_schedule[g.teacher_name].append((idx, g))

        for _, existing in room_schedule[g.room]:
            if genes_overlap(g, existing):
                total_violations += 1
        room_schedule[g.room].append((idx, g))

        for _, existing in section_schedule[g.section]:
            if genes_overlap(g, existing):
                total_violations += 1
        section_schedule[g.section].append((idx, g))

        section_subject[(g.section, g.subjcode)].append((idx, g))

    for (sec, subj), gene_tuples in section_subject.items():
        if len(gene_tuples) > 1:
            teachers = {g.teacher_name for _, g in gene_tuples}
            if len(teachers) > 1:
                total_violations += (len(teachers) - 1) * 5

    if teacher_max_load:
        for t_name, count in teacher_counts.items():
            max_allowed = teacher_max_load.get(t_name, 24)
            if count > max_allowed:
                total_violations += math.ceil(count - max_allowed)

    if teacher_priority and teachers_per_subject:
        # Faculty priority (seniority, then degree) as a hard constraint: if a
        # strictly higher-priority qualified professor was actually free at
        # this exact day/time and wasn't the one assigned, that's a violation.
        # Reuses the now-complete teacher_schedule built above rather than
        # re-scanning the chromosome per candidate.
        #
        # Critically, "free" means both time-available AND has room under
        # their own load cap. Without the load check, this constraint could
        # demand the single highest-priority teacher for every section they
        # were merely time-free for, regardless of how overloaded they
        # already were -- putting this constraint in direct, unresolvable
        # tension with teacher_overload instead of coordinating with it.
        for idx, g in enumerate(chromosome):
            if _is_gened_subject(g.subjcode):
                continue
            my_score = _teacher_priority_score(g.teacher_name, teacher_priority)
            for candidate in teachers_per_subject.get(g.subjcode, []):
                if candidate == g.teacher_name:
                    continue
                if _teacher_priority_score(candidate, teacher_priority) <= my_score:
                    continue
                if any(genes_overlap(g, existing) for _, existing in teacher_schedule[candidate]):
                    continue
                if teacher_max_load is not None:
                    candidate_cap = teacher_max_load.get(candidate, 24)
                    if teacher_counts.get(candidate, 0) + g.units > candidate_cap:
                        continue
                if teacher_availability is not None:
                    if not _is_teacher_available(candidate, g.day, g.start_minute, g.end_minute, teacher_availability):
                        continue
                total_violations += 1
                break

    # Short-rest: every back-to-back pair (same teacher or same section, same
    # day) needs at least MIN_SHORT_REST_MINUTES between them.
    total_violations += sum(1 for _ in _short_rest_violation_pairs(chromosome))

    # HC-11: faculty break after 3 continuous teaching hours.
    total_violations += sum(1 for _ in _faculty_break_violations(chromosome))

    # Student break after 4.5 continuous class hours.
    total_violations += sum(1 for _ in _student_break_violations(chromosome))

    # 9-hour daily cap on a section's whole day at school.
    total_violations += sum(1 for _ in _daily_span_violations(chromosome))

    return total_violations

def count_violations_by_category(chromosome, teacher_ranked_subjects=None, room_info=None,
                                   teacher_max_load=None, teacher_priority=None, teachers_per_subject=None,
                                   teacher_availability=None):
    """Same checks as count_total_violations, broken down by category instead
    of summed into one number -- for diagnosing WHICH specific rules are
    behind a stuck or high violation count, not just seeing the aggregate.

    Deliberately a separate, read-only function rather than a change to
    count_total_violations itself: evaluate_fitness (and everything that
    calls it -- the entire search) keeps using the original, completely
    unchanged. This is meant to be called once on a finished result for
    reporting, not on every fitness evaluation during the search itself.
    """
    breakdown = defaultdict(int)
    teacher_schedule = defaultdict(list)
    room_schedule = defaultdict(list)
    section_schedule = defaultdict(list)
    section_subject = defaultdict(list)
    teacher_counts = defaultdict(float)

    for idx, g in enumerate(chromosome):
        teacher_counts[g.teacher_name] += g.units

        if g.start_minute < DAY_START_MIN or g.end_minute > DAY_END_MIN:
            breakdown['HC09_time_boundary'] += 1

        if teacher_availability and not _is_gened_subject(g.subjcode):
            if not _is_teacher_available(g.teacher_name, g.day, g.start_minute, g.end_minute, teacher_availability):
                breakdown['teacher_unavailable'] += 1

        if teacher_ranked_subjects:
            ranked = teacher_ranked_subjects.get(g.teacher_name, [])
            if ranked and g.subjcode not in ranked:
                breakdown['HC04_qualification'] += 1

        if room_info and not _is_gened_subject(g.subjcode):
            if not lab_matching.is_valid_room(g.schedtype, g.lab_cat, room_info.get(g.room)):
                breakdown['HC05_room_type'] += 1

        for _, existing in teacher_schedule[g.teacher_name]:
            if genes_overlap(g, existing):
                breakdown['HC01_teacher_conflict'] += 1
        teacher_schedule[g.teacher_name].append((idx, g))

        for _, existing in room_schedule[g.room]:
            if genes_overlap(g, existing):
                breakdown['HC02_room_conflict'] += 1
        room_schedule[g.room].append((idx, g))

        for _, existing in section_schedule[g.section]:
            if genes_overlap(g, existing):
                breakdown['HC03_section_conflict'] += 1
        section_schedule[g.section].append((idx, g))

        section_subject[(g.section, g.subjcode)].append((idx, g))

    for (sec, subj), gene_tuples in section_subject.items():
        if len(gene_tuples) > 1:
            teachers_here = {g.teacher_name for _, g in gene_tuples}
            if len(teachers_here) > 1:
                breakdown['linked_teacher_mismatch'] += (len(teachers_here) - 1) * 5

    if teacher_max_load:
        for t_name, count in teacher_counts.items():
            max_allowed = teacher_max_load.get(t_name, 24)
            if count > max_allowed:
                breakdown['teacher_overload'] += math.ceil(count - max_allowed)

    if teacher_priority and teachers_per_subject:
        for idx, g in enumerate(chromosome):
            if _is_gened_subject(g.subjcode):
                continue
            my_score = _teacher_priority_score(g.teacher_name, teacher_priority)
            for candidate in teachers_per_subject.get(g.subjcode, []):
                if candidate == g.teacher_name:
                    continue
                if _teacher_priority_score(candidate, teacher_priority) <= my_score:
                    continue
                if any(genes_overlap(g, existing) for _, existing in teacher_schedule[candidate]):
                    continue
                if teacher_max_load is not None:
                    candidate_cap = teacher_max_load.get(candidate, 24)
                    if teacher_counts.get(candidate, 0) + g.units > candidate_cap:
                        continue
                if teacher_availability is not None:
                    if not _is_teacher_available(candidate, g.day, g.start_minute, g.end_minute, teacher_availability):
                        continue
                breakdown['faculty_priority'] += 1
                break

    breakdown['short_rest'] = sum(1 for _ in _short_rest_violation_pairs(chromosome))
    breakdown['faculty_break'] = sum(1 for _ in _faculty_break_violations(chromosome))
    breakdown['student_break'] = sum(1 for _ in _student_break_violations(chromosome))
    breakdown['daily_span'] = sum(1 for _ in _daily_span_violations(chromosome))

    return dict(breakdown)


def diagnose_room_type_violations(chromosome, room_info):
    """For every gene failing the HC05 room-type/category check, shows
    exactly what it needed, what it got instead, and -- the key diagnostic
    question -- whether ANY room in the pool actually carries the category
    it needed at all. If none do, this is a data gap (a category with no
    room registered for it in Supabase), not a scheduling-contention issue;
    get_valid_rooms has no time/day awareness at all, so an empty exact-match
    list can only mean the category itself has zero matching rooms, never
    that they were all busy at that particular time.

    Returns the same findings as a JSON-serializable list, for surfacing in
    the UI -- the print statements are unchanged from before this was added.
    """
    findings = []
    if not room_info:
        print("No room_info provided -- nothing to diagnose.")
        return findings

    for g in chromosome:
        if _is_gened_subject(g.subjcode):
            continue
        if lab_matching.is_valid_room(g.schedtype, g.lab_cat, room_info.get(g.room)):
            continue

        needs_lab = "LAB" in str(g.schedtype).upper()
        if needs_lab:
            needed_category = g.lab_cat
            rooms_with_category = [
                name for name, meta in room_info.items()
                if str(meta.get("room_type", "")).upper() == "LAB"
                and str(meta.get("lab_cat", "")).upper() == str(needed_category).upper()
            ]
        else:
            needed_category = lab_matching._lec_cat_for_session(g.schedtype)
            rooms_with_category = [
                name for name, meta in room_info.items()
                if str(meta.get("room_type", "")).upper() != "LAB"
                and str(meta.get("lec_cat", "")).upper() == needed_category
            ]

        assigned_meta = room_info.get(g.room, {})
        print(f"  {g.section:12s} {g.subjcode:14s} ({g.schedtype}) needs category={needed_category!r}")
        print(f"    -> assigned to {g.room}, whose actual data is: {assigned_meta}")
        if not rooms_with_category:
            print(f"    -> NO room in the pool carries category={needed_category!r} at all -- this is a data gap,")
            print(f"       not room contention. Check the rooms table's lab_cat/lec_cat column for this category.")
        else:
            print(f"    -> {len(rooms_with_category)} room(s) DO carry this category: {rooms_with_category}")
            print(f"       (so a matching room exists -- worth a closer look at why it wasn't used)")

        findings.append({
            "section": g.section,
            "subject": g.subjcode,
            "schedtype": g.schedtype,
            "needed_category": needed_category,
            "assigned_room": g.room,
            "assigned_room_data": assigned_meta,
            "matching_rooms": rooms_with_category,
            "is_data_gap": not bool(rooms_with_category),
        })
    return findings


def diagnose_daily_span_violations(chromosome):
    """For every (section, day) whose total span exceeds the 9-hour cap,
    shows the exact class list for that day -- not just the first-to-last
    span number -- since the same span can come from very different
    situations: one section spread thin by several well-separated,
    individually-legitimate breaks, versus one section with an unnecessary
    idle gap in the middle. The class list makes the difference visible.

    Returns the same findings as a JSON-serializable list, for surfacing in
    the UI -- the print statements are unchanged from before this was added.
    """
    findings = []
    found_any = False
    for seq in _daily_sequences(chromosome, lambda g: g.section).values():
        if len(seq) < 2:
            continue
        first_idx, first_g = seq[0]
        last_idx, last_g = seq[-1]
        span = last_g.end_minute - first_g.start_minute
        if span <= MAX_SECTION_DAILY_MINUTES:
            continue
        found_any = True
        over_by = span - MAX_SECTION_DAILY_MINUTES
        print(f"  {first_g.section:12s} {first_g.day}: span={span}min, over the 540min cap by {over_by}min")
        classes = []
        for idx, g in seq:
            gened = " [GenEd]" if _is_gened_subject(g.subjcode) else ""
            print(f"    {minutes_to_time_str(g.start_minute)}-{minutes_to_time_str(g.end_minute)}  {g.subjcode:12s} ({g.schedtype}){gened}")
            classes.append({
                "start": minutes_to_time_str(g.start_minute),
                "end": minutes_to_time_str(g.end_minute),
                "subject": g.subjcode,
                "schedtype": g.schedtype,
                "is_gened": _is_gened_subject(g.subjcode),
            })
        findings.append({
            "section": first_g.section,
            "day": first_g.day,
            "span_minutes": span,
            "over_by_minutes": over_by,
            "classes": classes,
        })
    if not found_any:
        print("  (none)")
    return findings


def diagnose_teacher_overload_violations(chromosome, teacher_max_load):
    """For every teacher whose total assigned units exceed their own cap,
    shows the excess and every course/section contributing to their load --
    so it's directly visible whether this is a genuine capacity shortfall
    (like the CS department's zero-Regular-faculty case) or just a teacher
    who happens to be everyone's top pick and hasn't been redistributed yet.

    Returns the same findings as a JSON-serializable list, for surfacing in
    the UI -- the print statements are unchanged from before this was added.
    """
    findings = []
    if not teacher_max_load:
        print("No teacher_max_load provided -- nothing to diagnose.")
        return findings

    teacher_courses = defaultdict(list)
    teacher_units = defaultdict(float)
    for g in chromosome:
        teacher_courses[g.teacher_name].append(g)
        teacher_units[g.teacher_name] += g.units

    found_any = False
    for t_name, total in sorted(teacher_units.items(), key=lambda kv: -kv[1]):
        cap = teacher_max_load.get(t_name, 24)
        if total <= cap:
            continue
        found_any = True
        print(f"  {t_name}: {total:.2f} units assigned, cap={cap} (over by {total - cap:.2f})")
        courses = []
        for g in sorted(teacher_courses[t_name], key=lambda g: -g.units):
            print(f"    {g.subjcode:12s} {g.section:12s} {g.units:.2f} units ({g.schedtype})")
            courses.append({
                "subject": g.subjcode,
                "section": g.section,
                "units": round(g.units, 2),
                "schedtype": g.schedtype,
            })
        findings.append({
            "teacher": t_name,
            "total_units": round(total, 2),
            "cap": cap,
            "over_by": round(total - cap, 2),
            "courses": courses,
        })
    if not found_any:
        print("  (none)")
    return findings


def diagnose_faculty_priority_violations(chromosome, teacher_priority, teachers_per_subject, teacher_max_load=None, teacher_availability=None):
    """For every gene flagged by the faculty_priority check, shows who's
    actually assigned and exactly which higher-priority, qualified,
    time-free, has-room candidate the constraint says should have been
    used instead. Mirrors the real check's logic precisely (same
    teacher_schedule/teacher_counts construction) rather than
    approximating it, so what this prints is guaranteed consistent with
    what actually gets counted.

    Returns the same findings as a JSON-serializable list, for surfacing in
    the UI -- the print statements are unchanged from before this was added.
    """
    findings = []
    if not teacher_priority or not teachers_per_subject:
        print("No teacher_priority/teachers_per_subject provided -- nothing to diagnose.")
        return findings

    teacher_schedule = defaultdict(list)
    teacher_counts = defaultdict(float)
    for idx, g in enumerate(chromosome):
        teacher_schedule[g.teacher_name].append((idx, g))
        teacher_counts[g.teacher_name] += g.units

    found_any = False
    for idx, g in enumerate(chromosome):
        if _is_gened_subject(g.subjcode):
            continue
        my_score = _teacher_priority_score(g.teacher_name, teacher_priority)
        for candidate in teachers_per_subject.get(g.subjcode, []):
            if candidate == g.teacher_name:
                continue
            if _teacher_priority_score(candidate, teacher_priority) <= my_score:
                continue
            if any(genes_overlap(g, existing) for _, existing in teacher_schedule[candidate]):
                continue
            if teacher_max_load is not None:
                candidate_cap = teacher_max_load.get(candidate, 24)
                if teacher_counts.get(candidate, 0) + g.units > candidate_cap:
                    continue
            if teacher_availability is not None:
                if not _is_teacher_available(candidate, g.day, g.start_minute, g.end_minute, teacher_availability):
                    continue
            found_any = True
            cand_score = _teacher_priority_score(candidate, teacher_priority)
            print(f"  {g.section:12s} {g.subjcode:12s} currently assigned to {g.teacher_name} (priority {my_score})")
            print(f"    -> {candidate} (priority {cand_score}) was qualified, time-free, and had room, but wasn't used")
            findings.append({
                "section": g.section,
                "subject": g.subjcode,
                "assigned_teacher": g.teacher_name,
                "assigned_priority": list(my_score),
                "better_candidate": candidate,
                "better_priority": list(cand_score),
            })
            break
    if not found_any:
        print("  (none)")
    return findings


def diagnose_qualification_violations(chromosome, teacher_ranked_subjects, teachers_per_subject=None):
    """For every gene whose assigned teacher isn't in that subject's own
    ranked_eligible_subjects list, shows exactly who's assigned and --
    critically -- whether ANY professor is actually listed as qualified for
    that course at all. If none are, this is a genuine data gap (a course
    with zero entries in professor_qualified_subjects), which forces the
    algorithm to fall back to an unqualified assignment since it has no
    other option; that's a different problem from someone qualified simply
    not being used.

    Returns the same findings as a JSON-serializable list, for surfacing in
    the UI -- the print statements are unchanged from before this was added.
    """
    findings = []
    if not teacher_ranked_subjects:
        print("No teacher_ranked_subjects provided -- nothing to diagnose.")
        return findings

    found_any = False
    for g in chromosome:
        ranked = teacher_ranked_subjects.get(g.teacher_name, [])
        if not ranked or g.subjcode in ranked:
            continue
        found_any = True
        qualified = teachers_per_subject.get(g.subjcode, []) if teachers_per_subject else []
        print(f"  {g.section:12s} {g.subjcode:12s} assigned to {g.teacher_name}, who is NOT in this subject's qualified list")
        if qualified:
            print(f"    -> {len(qualified)} professor(s) ARE listed as qualified for {g.subjcode}: {qualified}")
            print(f"       (so a qualified option exists -- worth a closer look at why it wasn't used)")
        else:
            print(f"    -> NO professor at all is listed as qualified for {g.subjcode} -- this is a data gap,")
            print(f"       not a scheduling failure. Check professor_qualified_subjects for this course.")
        findings.append({
            "section": g.section,
            "subject": g.subjcode,
            "assigned_teacher": g.teacher_name,
            "qualified_teachers": qualified,
            "is_data_gap": not bool(qualified),
        })
    if not found_any:
        print("  (none)")
    return findings


def diagnose_availability_violations(chromosome, teacher_availability):
    """For every gene whose assigned teacher is scheduled outside their
    recorded availability, shows exactly when they were scheduled versus
    what they're actually available for -- distinguishing a teacher with
    SOME recorded windows on that day (just not covering this specific
    time) from a day they have no recorded window for at all.
    """
    findings = []
    if not teacher_availability:
        print("No teacher_availability provided -- nothing to diagnose.")
        return findings

    found_any = False
    for g in chromosome:
        if _is_gened_subject(g.subjcode):
            continue
        if _is_teacher_available(g.teacher_name, g.day, g.start_minute, g.end_minute, teacher_availability):
            continue
        found_any = True
        windows = teacher_availability.get(g.teacher_name, [])
        day_windows = [w for w in windows if w["day"] == g.day]
        print(f"  {g.section:12s} {g.subjcode:12s} scheduled {g.day} {minutes_to_time_str(g.start_minute)}-{minutes_to_time_str(g.end_minute)}, taught by {g.teacher_name}")
        if day_windows:
            windows_str = ", ".join(
                f"{minutes_to_time_str(w['start_minute'])}-{minutes_to_time_str(w['end_minute'])}" for w in day_windows
            )
            print(f"    -> recorded availability for {g.day}: {windows_str} -- this class falls outside it")
        else:
            all_days = sorted({w["day"] for w in windows})
            print(f"    -> no recorded availability for {g.day} at all -- only available: {', '.join(all_days) if all_days else 'nowhere recorded'}")
        findings.append({
            "section": g.section,
            "subject": g.subjcode,
            "teacher": g.teacher_name,
            "day": g.day,
            "scheduled_start": minutes_to_time_str(g.start_minute),
            "scheduled_end": minutes_to_time_str(g.end_minute),
            "recorded_windows_this_day": [
                {"start": minutes_to_time_str(w["start_minute"]), "end": minutes_to_time_str(w["end_minute"])}
                for w in day_windows
            ],
            "available_days": sorted({w["day"] for w in windows}),
        })
    if not found_any:
        print("  (none)")
    return findings


def get_conflicting_gene_indices(chromosome, teacher_ranked_subjects=None, room_info=None, teacher_max_load=None, teacher_priority=None, teachers_per_subject=None, teacher_availability=None):
    conflicting_indices = set()
    teacher_schedule = defaultdict(list)
    room_schedule = defaultdict(list)
    section_schedule = defaultdict(list)
    section_subject = defaultdict(list)
    teacher_counts = defaultdict(float)

    for idx, g in enumerate(chromosome):
        teacher_counts[g.teacher_name] += g.units
        if g.start_minute < DAY_START_MIN or g.end_minute > DAY_END_MIN:
            conflicting_indices.add(idx)

        if teacher_availability and not _is_gened_subject(g.subjcode):
            if not _is_teacher_available(g.teacher_name, g.day, g.start_minute, g.end_minute, teacher_availability):
                conflicting_indices.add(idx)

        if teacher_ranked_subjects:
            ranked = teacher_ranked_subjects.get(g.teacher_name, [])
            if ranked and g.subjcode not in ranked:
                conflicting_indices.add(idx)

        if room_info and not _is_gened_subject(g.subjcode):
            if not lab_matching.is_valid_room(g.schedtype, g.lab_cat, room_info.get(g.room)):
                conflicting_indices.add(idx)

        for other_idx, existing in teacher_schedule[g.teacher_name]:
            if genes_overlap(g, existing):
                conflicting_indices.add(idx)
                conflicting_indices.add(other_idx)
        teacher_schedule[g.teacher_name].append((idx, g))

        for other_idx, existing in room_schedule[g.room]:
            if genes_overlap(g, existing):
                conflicting_indices.add(idx)
                conflicting_indices.add(other_idx)
        room_schedule[g.room].append((idx, g))

        for other_idx, existing in section_schedule[g.section]:
            if genes_overlap(g, existing):
                conflicting_indices.add(idx)
                conflicting_indices.add(other_idx)
        section_schedule[g.section].append((idx, g))

        section_subject[(g.section, g.subjcode)].append((idx, g))

    for (sec, subj), gene_tuples in section_subject.items():
        if len(gene_tuples) > 1:
            teachers = {g.teacher_name for _, g in gene_tuples}
            days = [g.day for _, g in gene_tuples]
            if len(teachers) > 1 or len(days) != len(set(days)):
                for idx, _ in gene_tuples:
                    conflicting_indices.add(idx)

    # teacher_counts was already being built above but never actually
    # consulted here -- meaning overload never got targeted by mutation,
    # only counted toward the overall score. Reuses teacher_schedule
    # (already built above) rather than re-scanning the chromosome.
    if teacher_max_load:
        for t_name, count in teacher_counts.items():
            max_allowed = teacher_max_load.get(t_name, 24)
            if count > max_allowed:
                for idx, _ in teacher_schedule[t_name]:
                    conflicting_indices.add(idx)

    if teacher_priority and teachers_per_subject:
        for idx, g in enumerate(chromosome):
            if _is_gened_subject(g.subjcode):
                continue
            my_score = _teacher_priority_score(g.teacher_name, teacher_priority)
            for candidate in teachers_per_subject.get(g.subjcode, []):
                if candidate == g.teacher_name:
                    continue
                if _teacher_priority_score(candidate, teacher_priority) <= my_score:
                    continue
                if any(genes_overlap(g, existing) for _, existing in teacher_schedule[candidate]):
                    continue
                if teacher_max_load is not None:
                    candidate_cap = teacher_max_load.get(candidate, 24)
                    if teacher_counts.get(candidate, 0) + g.units > candidate_cap:
                        continue
                if teacher_availability is not None:
                    if not _is_teacher_available(candidate, g.day, g.start_minute, g.end_minute, teacher_availability):
                        continue
                conflicting_indices.add(idx)
                break

    for curr_idx, prev_idx in _short_rest_violation_pairs(chromosome):
        conflicting_indices.add(curr_idx)
        conflicting_indices.add(prev_idx)

    for idx in _faculty_break_violations(chromosome):
        conflicting_indices.add(idx)

    for idx in _student_break_violations(chromosome):
        conflicting_indices.add(idx)

    for first_idx, last_idx in _daily_span_violations(chromosome):
        conflicting_indices.add(first_idx)
        conflicting_indices.add(last_idx)

    return list(conflicting_indices)


def calculate_rank_score(teacher_name, subjcode, teacher_ranked_subjects):
    if not teacher_ranked_subjects:
        return 0.0
    ranked_list = teacher_ranked_subjects.get(teacher_name, [])
    if subjcode not in ranked_list:
        return 0.0
    rank_idx = ranked_list.index(subjcode)
    total_ranked = len(ranked_list)
    return (total_ranked - rank_idx) / total_ranked if total_ranked > 0 else 0.0


def evaluate_fitness(chromosome, teacher_ranked_subjects=None, room_info=None, ml_lookup=None, 
                     teacher_max_load=None, w_ml=0.5, w_rank=0.5, teacher_priority=None, teachers_per_subject=None,
                     teacher_availability=None):
    hard_conflicts = count_total_violations(chromosome, teacher_ranked_subjects, room_info, teacher_max_load, teacher_priority, teachers_per_subject, teacher_availability)

    total_affinity_score = 0.0
    affinity_gene_count = 0
    if len(chromosome) == 0:
        return 0.0, 0, 0.0

    for gene in chromosome:
        if _is_gened_subject(gene.subjcode):
            # Placeholder teacher -- not a real preference/fit signal, so it
            # shouldn't count toward (or dilute) the average. Real SoC genes
            # are unaffected either way.
            continue

        ml_score = 0.0
        if ml_lookup:
            key = (gene.teacher_name, gene.subjcode, gene.program, gene.year_level)
            ml_score = ml_lookup.get(key, 0.0)

        rank_score = calculate_rank_score(gene.teacher_name, gene.subjcode, teacher_ranked_subjects)
        composite_gene_score = (w_ml * ml_score) + (w_rank * rank_score)
        total_affinity_score += composite_gene_score
        affinity_gene_count += 1

    avg_affinity = total_affinity_score / affinity_gene_count if affinity_gene_count > 0 else 0.0
    HARD_PENALTY_WEIGHT = 10000.0
    SOFT_REWARD_WEIGHT = 100.0

    fitness = (-hard_conflicts * HARD_PENALTY_WEIGHT) + (avg_affinity * SOFT_REWARD_WEIGHT)
    return fitness, hard_conflicts, avg_affinity


# ==============================================================================
# 4. LINKED GENE MUTATION & TABU LOCAL SEARCH
# ==============================================================================
def apply_gene_mutation(chromosome, target_idx, mutation_type, available_teachers, teachers_per_subject, available_rooms, room_info=None):
    target_gene = chromosome[target_idx]
    sec = target_gene.section
    subj = target_gene.subjcode
    linked_indices = [i for i, g in enumerate(chromosome) if g.section == sec and g.subjcode == subj]

    is_gened = _is_gened_subject(subj)

    if mutation_type == 'teacher':
        if is_gened:
            return  # placeholder teacher -- real assignment is out of scope, nothing to mutate
        candidates = teachers_per_subject.get(subj, available_teachers)
        new_teacher = random.choice(candidates) if candidates else random.choice(available_teachers)
        for idx in linked_indices:
            chromosome[idx].teacher_name = new_teacher

    elif mutation_type == 'time':
        linked_schedtypes = [chromosome[idx].schedtype for idx in linked_indices]
        pairing_mode = _pairing_mode_for_schedtypes(linked_schedtypes)

        if pairing_mode is not None:
            # Mutating target_gene alone would break the day-pairing (and, for
            # lecture_pair, same-time) invariant across its sibling -- both
            # linked genes need to move together.
            linked_genes = [chromosome[idx] for idx in linked_indices]
            paired_times = _generate_paired_meeting_times(linked_schedtypes)
            for g, (day, start_min, _dur) in zip(linked_genes, paired_times):
                g.day = day
                g.start_minute = start_min
            if pairing_mode == 'lecture_pair':
                linked_genes[1].room = linked_genes[0].room
        else:
            exclude_set = set(linked_indices)
            candidates = _smart_time_candidates(chromosome, target_gene, exclude_set, target_gene.schedtype)
            if candidates and random.random() < 0.85:
                new_day, new_start = random.choice(candidates)
            else:
                other_days = [chromosome[idx].day for idx in linked_indices if idx != target_idx]
                new_day, new_start, _ = generate_random_schedule_time(target_gene.schedtype, step=15, exclude_days=other_days)
            target_gene.day = new_day
            target_gene.start_minute = new_start

    elif mutation_type == 'room':
        if is_gened:
            return  # placeholder room -- real assignment is out of scope, nothing to mutate
        if room_info:
            valid_rooms = lab_matching.get_valid_rooms(target_gene.schedtype, target_gene.lab_cat, room_info)
            if not valid_rooms:
                valid_rooms = available_rooms
        else:
            valid_rooms = available_rooms
        new_room = random.choice(valid_rooms)
        target_gene.room = new_room

        linked_schedtypes = [chromosome[idx].schedtype for idx in linked_indices]
        if _pairing_mode_for_schedtypes(linked_schedtypes) == 'lecture_pair':
            # Same-room is part of the lecture_pair invariant too -- mutating
            # only target_gene would desync it from its paired sibling.
            for idx in linked_indices:
                chromosome[idx].room = new_room


def tabu_local_search(chromosome, available_teachers, teachers_per_subject, 
                      available_rooms, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load=None,
                      w_ml=0.5, w_rank=0.5, max_tabu_iter=25, tabu_tenure=7, teacher_priority=None,
                      teacher_availability=None):
    if not chromosome:
        return chromosome

    best_chromosome = [g.copy() for g in chromosome]
    best_fitness, best_hard, _ = evaluate_fitness(best_chromosome, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                                                   teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                                   teacher_availability=teacher_availability)

    current_chromosome = [g.copy() for g in chromosome]
    tabu_list = []

    for iteration in range(max_tabu_iter):
        conflicting_indices = get_conflicting_gene_indices(current_chromosome, teacher_ranked_subjects, room_info, teacher_max_load,
                                                             teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                                             teacher_availability=teacher_availability)
        if not conflicting_indices and best_hard == 0:
            break

        neighborhood = []
        for _ in range(20):
            neighbor = [g.copy() for g in current_chromosome]
            if conflicting_indices and random.random() < 0.85:
                gene_idx = random.choice(conflicting_indices)
            else:
                gene_idx = random.randint(0, len(neighbor) - 1)

            mutation_type = random.choice(['teacher', 'time', 'room'])
            apply_gene_mutation(neighbor, gene_idx, mutation_type, available_teachers, teachers_per_subject, available_rooms, room_info)

            target = neighbor[gene_idx]
            move_signature = (gene_idx, mutation_type, target.teacher_name, target.day, target.start_minute, target.room)
            neighbor_fitness, neighbor_hard, _ = evaluate_fitness(neighbor, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                                                                    teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                                                    teacher_availability=teacher_availability)
            
            if move_signature not in tabu_list or neighbor_fitness > best_fitness:
                neighborhood.append((neighbor, neighbor_fitness, move_signature, neighbor_hard))

        if not neighborhood:
            break

        neighborhood.sort(key=lambda x: x[1], reverse=True)
        candidate, candidate_fitness, move, candidate_hard = neighborhood[0]

        current_chromosome = candidate
        tabu_list.append(move)
        if len(tabu_list) > tabu_tenure:
            tabu_list.pop(0)

        if candidate_fitness > best_fitness:
            best_chromosome = [g.copy() for g in candidate]
            best_fitness = candidate_fitness
            best_hard = candidate_hard

    return best_chromosome


# ==============================================================================
# 5. GA OPERATORS (INCLUDING BLOCK-AWARE CROSSOVER)
# ==============================================================================
def initialize_population(pop_size, class_requirements, available_teachers, teachers_per_subject, available_rooms, room_info=None):
    population = []
    grouped_reqs = defaultdict(list)
    for req in class_requirements:
        grouped_reqs[(req['B.SECTION'], req['SUBJCODE'])].append(req)

    for _ in range(pop_size):
        chromosome = []
        for (sec, subj), req_list in grouped_reqs.items():
            is_gened = _is_gened_subject(subj)

            if is_gened:
                # Real professor assignment for GenEd/non-SoC courses is out
                # of scope -- placeholder, unique per (section, subject) so
                # it never collides with another course's placeholder and
                # gets misread as a real double-booking.
                assigned_teacher = f"TBA-PROF-{sec}|{subj}"
            else:
                candidates = teachers_per_subject.get(subj, available_teachers)
                assigned_teacher = random.choice(candidates) if candidates else random.choice(available_teachers)

            schedtypes = [r['SCHEDTYPE'] for r in req_list]
            pairing_mode = _pairing_mode_for_schedtypes(schedtypes)
            paired_times = _generate_paired_meeting_times(schedtypes) if pairing_mode else None

            used_days = []
            first_room = None
            for i, req in enumerate(req_list):
                sched_type = req['SCHEDTYPE']

                if paired_times is not None:
                    day, start_min, duration = paired_times[i]
                else:
                    day, start_min, duration = generate_random_schedule_time(sched_type, step=15, exclude_days=used_days)
                used_days.append(day)

                if pairing_mode == 'lecture_pair' and i == 1:
                    # Same room as the first meeting -- valid by construction,
                    # since both meetings share the same schedtype/lab_cat.
                    room = first_room
                elif is_gened:
                    # Same reasoning as the teacher placeholder above: real
                    # room assignment is out of scope, only the time slot is
                    # actually solved here.
                    room = f"TBA-RM-{sec}|{subj}"
                    if i == 0:
                        first_room = room
                else:
                    if room_info:
                        valid_rooms = lab_matching.get_valid_rooms(sched_type, req['LAB_CAT'], room_info)
                        if not valid_rooms:
                            valid_rooms = available_rooms
                    else:
                        valid_rooms = available_rooms
                    room = random.choice(valid_rooms)
                    if i == 0:
                        first_room = room

                gene = Gene(
                    class_id=req['class_id'],
                    subjcode=subj,
                    program=req['PROGRAM'],
                    year_level=req['YEAR_LEVEL'],
                    school_year=req['SCHOOL_YEAR'],
                    semester=req['SEMESTER'],
                    schedtype=sched_type,
                    lab_cat=req['LAB_CAT'],
                    section=req['B.SECTION'],
                    meeting_num=req['MEETING_NUM'],
                    teacher_name=assigned_teacher,
                    day=day,
                    start_minute=start_min,
                    duration=duration,
                    room=room,
                    units=req.get('UNITS', 1.0)
                )
                chromosome.append(gene)
        
        chromosome.sort(key=lambda g: g.class_id)
        population.append(chromosome)

    return population


def tournament_selection(population, k, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank, teacher_priority=None, teachers_per_subject=None, teacher_availability=None):
    selected = random.sample(population, k)
    selected.sort(key=lambda chrom: evaluate_fitness(chrom, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                                                       teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                                       teacher_availability=teacher_availability)[0], reverse=True)
    return [g.copy() for g in selected[0]]


def block_aware_crossover(parent1, parent2):
    """🟢 Fixed Crossover: Swaps entire section-subject blocks to preserve multi-meeting teacher linkages."""
    block_map = defaultdict(list)
    for idx, gene in enumerate(parent1):
        block_map[(gene.section, gene.subjcode)].append(idx)

    child1 = [None] * len(parent1)
    child2 = [None] * len(parent2)

    for (sec, subj), indices in block_map.items():
        if random.random() < 0.5:
            for idx in indices:
                child1[idx] = parent1[idx].copy()
                child2[idx] = parent2[idx].copy()
        else:
            for idx in indices:
                child1[idx] = parent2[idx].copy()
                child2[idx] = parent1[idx].copy()

    return child1, child2


def mutate(chromosome, available_teachers, teachers_per_subject, available_rooms, 
           teacher_ranked_subjects=None, room_info=None, teacher_max_load=None, mutation_rate=0.05, teacher_priority=None,
           teacher_availability=None):
    conflicting_indices = get_conflicting_gene_indices(chromosome, teacher_ranked_subjects, room_info, teacher_max_load,
                                                         teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                                         teacher_availability=teacher_availability)
    num_mutations = max(1, int(len(chromosome) * mutation_rate))
    
    for _ in range(num_mutations):
        if conflicting_indices and random.random() < 0.85:
            target_idx = random.choice(conflicting_indices)
        else:
            target_idx = random.randint(0, len(chromosome) - 1)
            
        mutation_type = random.choice(['teacher', 'time', 'room'])
        apply_gene_mutation(chromosome, target_idx, mutation_type, available_teachers, teachers_per_subject, available_rooms, room_info)

    return chromosome


# ==============================================================================
# 6. MAIN MEMETIC ALGORITHM LOOP
# ==============================================================================
def run_memetic_algorithm(class_requirements, available_teachers, teachers_per_subject, 
                         available_rooms, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load=None,
                         w_ml=0.5, w_rank=0.5, pop_size=60, stagnation_limit=200, 
                         base_mutation_rate=0.05, tabu_frequency=3, teacher_priority=None,
                         teacher_availability=None):

    print(f"🚀 Initializing Population (Continuous Time | Granular Evaluation Active)...")
    population = initialize_population(pop_size, class_requirements, available_teachers, teachers_per_subject, available_rooms, room_info)

    best_overall_chromosome = None
    best_overall_fitness = float('-inf')
    best_hard_conflicts = float('inf')
    stagnation_counter = 0
    gen = 0
    start_time = time.time()

    while gen < 1000:
        gen += 1
        scored_pop = [(chrom, evaluate_fitness(chrom, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                                                teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                                teacher_availability=teacher_availability)) for chrom in population]
        scored_pop.sort(key=lambda x: x[1][0], reverse=True)

        current_best_chrom, (current_best_fit, hard_conflicts, avg_affinity) = scored_pop[0]

        if current_best_fit > best_overall_fitness:
            best_overall_fitness = current_best_fit
            best_overall_chromosome = [g.copy() for g in current_best_chrom]

        # Stagnation is tracked against hard_conflicts specifically, not the
        # blended fitness score. avg_affinity is continuous and can wobble
        # generation to generation even while hard_conflicts is completely
        # stuck -- and since fitness blends both, a tiny affinity fluctuation
        # is enough to reset stagnation_counter without any real progress on
        # what actually determines whether a schedule is valid. At larger
        # scale this compounds: only one such reset needs to land inside any
        # given 200-generation stretch to keep the counter from ever reaching
        # the limit, which is what let a run reach generation 1000 without
        # the stagnation break ever firing, despite hard_conflicts having
        # been flat for a long stretch before that.
        if hard_conflicts < best_hard_conflicts:
            best_hard_conflicts = hard_conflicts
            stagnation_counter = 0
        else:
            stagnation_counter += 1

        # Clean progress log without detailed diagnostics
        print(f"Gen {gen:04d} | Fitness: {current_best_fit:9.2f} | Hard Violations: {hard_conflicts:3d} | Stagnation: {stagnation_counter:3d}/{stagnation_limit}")

        if stagnation_counter >= stagnation_limit:
            print(f"\n⚠️ Fitness stagnation limit ({stagnation_limit}) hit at Generation {gen}. Returning best found schedule.")
            break

        elite_count = max(2, int(pop_size * 0.10))
        new_population = [[g.copy() for g in chrom] for chrom, _ in scored_pop[:elite_count]]

        while len(new_population) < pop_size:
            p1 = tournament_selection(population, 3, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                                       teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                       teacher_availability=teacher_availability)
            p2 = tournament_selection(population, 3, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                                       teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject,
                                       teacher_availability=teacher_availability)
            
            c1, c2 = block_aware_crossover(p1, p2)

            new_population.append(mutate(c1, available_teachers, teachers_per_subject, available_rooms, teacher_ranked_subjects, room_info, teacher_max_load, base_mutation_rate,
                                          teacher_priority=teacher_priority, teacher_availability=teacher_availability))
            if len(new_population) < pop_size:
                new_population.append(mutate(c2, available_teachers, teachers_per_subject, available_rooms, teacher_ranked_subjects, room_info, teacher_max_load, base_mutation_rate,
                                              teacher_priority=teacher_priority, teacher_availability=teacher_availability))

        population = new_population

        if gen % tabu_frequency == 0:
            population[0] = tabu_local_search(
                population[0], available_teachers, teachers_per_subject,
                available_rooms, teacher_ranked_subjects, room_info, ml_lookup, teacher_max_load, w_ml, w_rank,
                teacher_priority=teacher_priority, teacher_availability=teacher_availability
            )

    elapsed = time.time() - start_time
    elapsed_str = f"{int(elapsed // 60)}m {elapsed % 60:.1f}s"
    if gen >= 1000:
        print(f"\n⏱️ Reached the 1000-generation cap without hitting the stagnation limit. Returning best found schedule.")
    print(f"⏱️ Total generation time: {elapsed_str} ({gen} generations)")

    return best_overall_chromosome


# ==============================================================================
# 7. EXECUTION PIPELINE
# ==============================================================================
if __name__ == "__main__":
    blocks_fn = "blocks.json"
    curriculum_fn = "curriculum.json"
    teachers_fn = "teachers.json"
    rooms_fn = "rooms.json"
    output_excel = "generated_schedule.xlsx"

    TARGET_SEMESTER = 1
    TARGET_SCHOOL_YEAR = "2026-2027"

    print(f"📂 Loading datasets for Semester {TARGET_SEMESTER} ({TARGET_SCHOOL_YEAR})...")
    try:
        class_reqs, teachers, rooms, room_info, teacher_ranked_subjs, teachers_per_subj, teacher_max_load, teacher_priority = load_data_from_json(
            blocks_fn, curriculum_fn, teachers_fn, rooms_fn,
            target_semester=TARGET_SEMESTER,
            target_school_year=TARGET_SCHOOL_YEAR
        )

        print(f"   ✔ Class Meetings Generated : {len(class_reqs)}")
        print(f"   ✔ Teachers Pool            : {len(teachers)}")
        print(f"   ✔ Rooms Pool               : {len(rooms)}")

        if len(class_reqs) == 0:
            print(f"\n❌ ERROR: Zero class demands generated. Check 'curriculum.json'.")
            exit(1)

        print("\n⚡ Pre-computing ML Compatibility Scores...")
        ml_lookup = {}
        for teacher in teachers:
            for req in class_reqs:
                key = (teacher, req['SUBJCODE'], req['PROGRAM'], req['YEAR_LEVEL'])
                if key not in ml_lookup:
                    ml_lookup[key] = get_faculty_compatibility(
                        subjcode=req['SUBJCODE'],
                        program=req['PROGRAM'],
                        year_level=req['YEAR_LEVEL'],
                        school_year=req['SCHOOL_YEAR'],
                        semester=req['SEMESTER'],
                        schedtype=req['SCHEDTYPE'],
                        lab_cat=req['LAB_CAT'],
                        teacher_name=teacher
                    )

        final_schedule = run_memetic_algorithm(
            class_requirements=class_reqs,
            available_teachers=teachers,
            teachers_per_subject=teachers_per_subj,
            available_rooms=rooms,
            teacher_ranked_subjects=teacher_ranked_subjs,
            room_info=room_info,
            ml_lookup=ml_lookup,
            teacher_max_load=teacher_max_load,
            w_ml=0.5,
            w_rank=0.5,
            pop_size=60,
            stagnation_limit=200,
            base_mutation_rate=0.05,
            tabu_frequency=3,
            teacher_priority=teacher_priority
        )

        final_fitness, final_conflicts, final_affinity = evaluate_fitness(
            final_schedule, teacher_ranked_subjs, room_info, ml_lookup, teacher_max_load, w_ml=0.5, w_rank=0.5,
            teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subj
        )

        print("\n" + "="*50)
        print("🏆 OPTIMIZATION COMPLETE")
        print("="*50)
        print(f"Final Hard Violations    : {final_conflicts}")
        print(f"Combined Affinity Score  : {final_affinity * 100:.2f}%")
        print("="*50)

        export_list = []
        for g in final_schedule:
            ml_compat = ml_lookup.get((g.teacher_name, g.subjcode, g.program, g.year_level), 0.0)
            rank_score = calculate_rank_score(g.teacher_name, g.subjcode, teacher_ranked_subjs)
            composite_score = (0.5 * ml_compat) + (0.5 * rank_score)

            export_list.append({
                "Class_ID": g.class_id,
                "School_Year": g.school_year,
                "Semester": g.semester,
                "Block_Section": g.section,
                "Program": g.program,
                "Year_Level": g.year_level,
                "Subject_Code": g.subjcode,
                "Meeting_Num": g.meeting_num,
                "Sched_Type": g.schedtype,
                "Lab_Category": g.lab_cat,
                "Assigned_Teacher": g.teacher_name,
                "Day": g.day,
                "Start_Time": minutes_to_time_str(g.start_minute),
                "End_Time": minutes_to_time_str(g.end_minute),
                "Timeslot": g.timeslot_str,
                "Room": g.room,
                "ML_Prediction": f"{ml_compat * 100:.2f}%",
                "UI_Rank_Score": f"{rank_score * 100:.2f}%",
                "Composite_Affinity": f"{composite_score * 100:.2f}%"
            })

        df_out = pd.DataFrame(export_list)
        df_out.sort_values(by=["Block_Section", "Day", "Start_Time"], inplace=True)
        df_out.to_excel(output_excel, index=False)
        print(f"🎉 Saved to '{output_excel}'")

    except FileNotFoundError as e:
        print(f"❌ File Loading Error: {e}. Check file paths.")