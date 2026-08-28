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

def g(teacher, section, day, start, dur, subj, room='SJH-501'):
    return sch.Gene(class_id=1, subjcode=subj, program='BSCS', year_level=1, school_year='2026-2027',
                     semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section=section, meeting_num=1,
                     teacher_name=teacher, day=day, start_minute=start, duration=dur, room=room, units=1.5)

def capture(fn, *args):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = fn(*args)
    return buf.getvalue(), result

print("=== 1. _is_teacher_available: core cases ===")
avail = {
    'CABRERA': [
        {'day': 'TUE', 'start_minute': 780, 'end_minute': 1140},   # 1pm-7pm
        {'day': 'THU', 'start_minute': 780, 'end_minute': 1140},
    ],
}
check("No teacher_availability at all -> unconstrained (True)",
      sch._is_teacher_available('ANYONE', 'MON', 480, 570, None), True)
check("Teacher with zero recorded rows -> unconstrained (True)",
      sch._is_teacher_available('NOBODY_RECORDED', 'MON', 480, 570, avail), True)
check("Within recorded window (TUE 1-3pm, inside 1-7pm) -> True",
      sch._is_teacher_available('CABRERA', 'TUE', 780, 960, avail), True)
check("Outside recorded window (TUE 8-10am, before 1pm) -> False",
      sch._is_teacher_available('CABRERA', 'TUE', 480, 570, avail), False)
check("Day with NO recorded window at all (MON, only TUE/THU recorded) -> False",
      sch._is_teacher_available('CABRERA', 'MON', 780, 960, avail), False)
check("Exactly matching window boundaries -> True (inclusive)",
      sch._is_teacher_available('CABRERA', 'TUE', 780, 1140, avail), True)
check("Extends 1 minute past the window end -> False",
      sch._is_teacher_available('CABRERA', 'TUE', 780, 1141, avail), False)

print("\n=== 2. Wired into count_total_violations, count_violations_by_category, get_conflicting_gene_indices ===")
bad_gene = g('CABRERA', 'A', 'MON', 780, 90, '6X')  # Monday -- CABRERA has no Monday window at all
v = sch.count_total_violations([bad_gene], teacher_availability=avail)
check("count_total_violations flags it", v, 1)

breakdown = sch.count_violations_by_category([bad_gene], teacher_availability=avail)
check("count_violations_by_category flags it under teacher_unavailable", breakdown.get('teacher_unavailable', 0), 1)

idxs = sch.get_conflicting_gene_indices([bad_gene], teacher_availability=avail)
check("get_conflicting_gene_indices flags it", 0 in idxs, True)

good_gene = g('CABRERA', 'B', 'TUE', 800, 90, '6Y')  # Tuesday 1:20pm -- within 1-7pm window
v2 = sch.count_total_violations([good_gene], teacher_availability=avail)
check("A correctly-scheduled gene produces 0 violations", v2, 0)

print("\n=== 3. GenEd genes are correctly exempt (placeholder teachers shouldn't be checked) ===")
gened_gene = g('TBA-PROF-A|CWTS1', 'A', 'MON', 780, 90, 'CWTS1')
v3 = sch.count_total_violations([gened_gene], teacher_availability=avail)
check("GenEd gene with a placeholder teacher never gets flagged", v3, 0)

print("\n=== 4. Backward compatibility: no teacher_availability provided at all -> no new violations ===")
v4 = sch.count_total_violations([bad_gene])  # no teacher_availability kwarg
check("Without teacher_availability, this check is simply skipped (v=0)", v4, 0)

print("\n=== 5. Drill-down: print output and structured return ===")
out, findings = capture(sch.diagnose_availability_violations, [bad_gene], avail)
check("Print output mentions the teacher", "CABRERA" in out, True)
check("Exactly 1 finding", len(findings), 1)
check("Correct day", findings[0]['day'], 'MON')
check("recorded_windows_this_day is empty (no MON window)", findings[0]['recorded_windows_this_day'], [])
check("available_days correctly lists TUE and THU", findings[0]['available_days'], ['THU', 'TUE'])
try:
    json.dumps(findings)
    check("JSON-serializable", True, True)
except Exception as e:
    check(f"JSON-serializable (error: {e})", False, True)

print("\n=== 6. Drill-down: 'some window this day, just wrong time' case shows the actual window ===")
wrong_time_gene = g('CABRERA', 'A', 'TUE', 480, 90, '6X')  # Tuesday 8am -- has a TUE window, just not this early
out2, findings2 = capture(sch.diagnose_availability_violations, [wrong_time_gene], avail)
check("Shows the actual recorded TUE window, not empty", len(findings2[0]['recorded_windows_this_day']), 1)
check("The window shown is the real one (13:00-19:00)",
      (findings2[0]['recorded_windows_this_day'][0]['start'], findings2[0]['recorded_windows_this_day'][0]['end']),
      ('01:00 PM', '07:00 PM'))

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
