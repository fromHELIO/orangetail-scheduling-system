import scheduler as sch
import io
import contextlib
import json

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

def g(teacher, section, day, start, dur, subj, units=1.0, room='SJH-501'):
    return sch.Gene(class_id=1, subjcode=subj, program='BSCS', year_level=1, school_year='2026-2027',
                     semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section=section, meeting_num=1,
                     teacher_name=teacher, day=day, start_minute=start, duration=dur, room=room, units=units)

def capture(fn, *args):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = fn(*args)
    return buf.getvalue(), result

print("=== 1. daily_span: print unchanged, return structured and JSON-serializable ===")
chrom_span = [g('T1', 'A', 'MON', 480, 90, '6C1'), g('T2', 'A', 'MON', 921, 100, '6C2')]
out, findings = capture(sch.diagnose_daily_span_violations, chrom_span)
check("Print output still contains the section", "A" in out, True)
check("Returns a list", isinstance(findings, list), True)
check("Exactly 1 finding", len(findings), 1)
check("Finding has correct span_minutes", findings[0]["span_minutes"], 541)
check("Finding has correct over_by_minutes", findings[0]["over_by_minutes"], 1)
check("Finding has 2 classes listed", len(findings[0]["classes"]), 2)
try:
    json.dumps(findings)
    check("JSON-serializable", True, True)
except Exception as e:
    check(f"JSON-serializable (error: {e})", False, True)

print("\n=== 2. teacher_overload: print unchanged, return structured ===")
chrom_over = [g('T1', 'A', 'MON', 480, 90, '6C1', units=15.0, room='SJH-501'),
              g('T1', 'B', 'TUE', 480, 90, '6C2', units=15.0, room='SJH-502')]
max_load = {'T1': 24.0}
out2, findings2 = capture(sch.diagnose_teacher_overload_violations, chrom_over, max_load)
check("Print output unchanged (still shows the teacher)", "T1" in out2, True)
check("Exactly 1 finding", len(findings2), 1)
check("Correct total_units", findings2[0]["total_units"], 30.0)
check("Correct cap", findings2[0]["cap"], 24.0)
check("Correct over_by", findings2[0]["over_by"], 6.0)
check("2 courses listed", len(findings2[0]["courses"]), 2)
try:
    json.dumps(findings2)
    check("JSON-serializable", True, True)
except Exception as e:
    check(f"JSON-serializable (error: {e})", False, True)

print("\n=== 3. faculty_priority: print unchanged, return structured ===")
teacher_priority = {'T_SENIOR': (20, 3), 'T_JUNIOR': (2, 1)}
teachers_per_subject = {'6X': ['T_SENIOR', 'T_JUNIOR']}
chrom_pri = [g('T_JUNIOR', 'A', 'MON', 480, 90, '6X')]
out3, findings3 = capture(sch.diagnose_faculty_priority_violations, chrom_pri, teacher_priority, teachers_per_subject)
check("Print output unchanged", "T_SENIOR" in out3, True)
check("Exactly 1 finding", len(findings3), 1)
check("Correct assigned_teacher", findings3[0]["assigned_teacher"], "T_JUNIOR")
check("Correct better_candidate", findings3[0]["better_candidate"], "T_SENIOR")
check("Priority tuples converted to lists (JSON needs this)", findings3[0]["assigned_priority"], [2, 1])
try:
    json.dumps(findings3)
    check("JSON-serializable", True, True)
except Exception as e:
    check(f"JSON-serializable (error: {e})", False, True)

print("\n=== 4. qualification: print unchanged, return structured, distinguishes data-gap vs not ===")
ranked = {'T1': ['6A', '6B']}
tps = {'6C': ['T2']}
chrom_q = [g('T1', 'A', 'MON', 480, 90, '6C')]
out4, findings4 = capture(sch.diagnose_qualification_violations, chrom_q, ranked, tps)
check("Exactly 1 finding", len(findings4), 1)
check("Correctly NOT flagged as data gap (T2 is qualified)", findings4[0]["is_data_gap"], False)
check("qualified_teachers lists T2", findings4[0]["qualified_teachers"], ["T2"])

chrom_q2 = [g('T1', 'A', 'MON', 480, 90, '6ZZZ')]
out4b, findings4b = capture(sch.diagnose_qualification_violations, chrom_q2, ranked, {})
check("Correctly flagged as data gap (nobody qualified)", findings4b[0]["is_data_gap"], True)

print("\n=== 5. room_type: print unchanged, return structured ===")
room_info = {'MGN-202': {'room_type': 'LAB', 'lab_cat': 'COMPUTER'}}
gene_gap = g('T1', 'A', 'MON', 480, 180, '6SOPMAN')
gene_gap.schedtype = 'LAB_3H'
gene_gap.lab_cat = 'FOLEY'
gene_gap.room = 'MGN-202'
out5, findings5 = capture(sch.diagnose_room_type_violations, [gene_gap], room_info)
check("Exactly 1 finding", len(findings5), 1)
check("Correctly flagged as data gap (no FOLEY room exists)", findings5[0]["is_data_gap"], True)
try:
    json.dumps(findings5)
    check("JSON-serializable", True, True)
except Exception as e:
    check(f"JSON-serializable (error: {e})", False, True)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
