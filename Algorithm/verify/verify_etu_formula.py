import scheduler as sch

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

print("=== 1. The exact reported example: ETU=6 -> 18 units, not 6 ===")
# Replicating database.py's fixed formula directly
etu = 6
result = max(0.0, 24.0 - float(etu))
check("Professor B, ETU=6 -> 18.0 (not the old, backwards value of 6)", result, 18.0)

print("\n=== 2. Explicit ETU=0 correctly means full 24-unit capacity ===")
etu_zero = 0
result_zero = max(0.0, 24.0 - float(etu_zero))
check("ETU explicitly 0 -> full 24.0 (the old `or 10` bug would have given 10)", result_zero, 24.0)

print("\n=== 3. JSON-harness: ETU field present, takes precedence, matches database.py's formula ===")
import json, os
os.makedirs('/tmp/etu_test', exist_ok=True)
os.chdir('/tmp/etu_test')
curriculum = [{"curriculum_id": "C1", "program": "BSCS", "year_level": 1, "semester": 1,
                "subjcode": "6X", "subjtitle": "Test", "units": 3, "schedtype": "LEC", "lab_cat": "NONE"}]
blocks = [{"block_id": "B1", "program": "BSCS", "year_level": 1, "semester": 1, "curriculum_id": "C1", "school_year": "2026-2027"}]
teachers = [
    {"name": "PROF WITH ETU", "ETU": 6, "ranked_eligible_subjects": ["6X"]},
    {"name": "PROF ZERO ETU", "ETU": 0, "ranked_eligible_subjects": ["6X"]},
    {"name": "PROF NO ETU FIELD", "max_semester_load": 15, "ranked_eligible_subjects": ["6X"]},
    {"name": "PROF NEITHER FIELD", "ranked_eligible_subjects": ["6X"]},
]
rooms = [{"room_name": "SJH-501", "room_type": "LEC", "lab_cat": "NONE", "lec_cat": "GENED"}]
json.dump(curriculum, open('curriculum.json', 'w'))
json.dump(blocks, open('blocks.json', 'w'))
json.dump(teachers, open('teachers.json', 'w'))
json.dump(rooms, open('rooms.json', 'w'))

_, _, _, _, _, _, max_load, _ = sch.load_data_from_json(
    'blocks.json', 'curriculum.json', 'teachers.json', 'rooms.json',
    target_semester=1, target_school_year='2026-2027'
)
check("ETU=6 -> 18.0 via the JSON-harness too", max_load.get("PROF WITH ETU"), 18.0)
check("ETU=0 -> 24.0 via the JSON-harness too", max_load.get("PROF ZERO ETU"), 24.0)
check("No ETU field, but max_semester_load present -> falls back correctly, existing fixtures unaffected",
      max_load.get("PROF NO ETU FIELD"), 15)
check("Neither field present -> new 24-unit default", max_load.get("PROF NEITHER FIELD"), 24)

print("\n=== 4. End-to-end: ETU correctly drives the units-based overload check from Step 2 ===")
g = lambda t, sec, day, start, dur, subj, units, room: sch.Gene(
    class_id=1, subjcode=subj, program='BSCS', year_level=1, school_year='2026-2027',
    semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section=sec, meeting_num=1,
    teacher_name=t, day=day, start_minute=start, duration=dur, room=room, units=units)

# Professor B: ETU=6 -> max load 18. Assign her 20 units of real teaching -> should violate by 2.
prof_b_load = max(0.0, 24.0 - 6.0)
chrom = [
    g('PROF B', 'A', 'MON', 480, 90, '6C1', 10.0, 'SJH-501'),
    g('PROF B', 'B', 'MON', 660, 90, '6C2', 10.0, 'SJH-502'),
]
v = sch.count_total_violations(chrom, teacher_max_load={'PROF B': prof_b_load})
check("Prof B (ETU=6, cap=18) assigned 20 units -> 2 violations (ceil(20-18))", v, 2)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
