import scheduler as sch
import io
import contextlib

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
        fn(*args)
    return buf.getvalue()

print("=== 1. daily_span drill-down ===")
chrom_span = [g('T1', 'A', 'MON', 480, 90, '6C1'), g('T2', 'A', 'MON', 921, 100, '6C2')]  # 541min span
out = capture(sch.diagnose_daily_span_violations, chrom_span)
check("Reports the section", "A" in out, True)
check("Reports the over-by amount (1min)", "over the 540min cap by 1min" in out, True)
check("Lists both classes in the sequence", "6C1" in out and "6C2" in out, True)

real_count = sum(1 for _ in sch._daily_span_violations(chrom_span))
check("Matches actual violation count (1)", real_count, 1)

clean_chrom = [g('T1', 'B', 'MON', 480, 90, '6C1')]
out_clean = capture(sch.diagnose_daily_span_violations, clean_chrom)
check("Clean scenario -> reports none", "(none)" in out_clean, True)

print("\n=== 2. teacher_overload drill-down ===")
chrom_over = [g('T1', 'A', 'MON', 480, 90, '6C1', units=15.0, room='SJH-501'),
              g('T1', 'B', 'TUE', 480, 90, '6C2', units=15.0, room='SJH-502')]
max_load = {'T1': 24.0}
out2 = capture(sch.diagnose_teacher_overload_violations, chrom_over, max_load)
check("Reports the teacher", "T1" in out2, True)
check("Reports correct total (30.00) and cap (24)", "30.00 units assigned, cap=24" in out2, True)
check("Reports the excess (6.00)", "over by 6.00" in out2, True)
check("Lists both contributing courses", "6C1" in out2 and "6C2" in out2, True)

out2_clean = capture(sch.diagnose_teacher_overload_violations, [g('T2', 'C', 'MON', 480, 90, '6C3', units=5.0)], max_load)
check("Clean scenario -> reports none", "(none)" in out2_clean, True)

print("\n=== 3. faculty_priority drill-down ===")
teacher_priority = {'T_SENIOR': (20, 3), 'T_JUNIOR': (2, 1)}
teachers_per_subject = {'6X': ['T_SENIOR', 'T_JUNIOR']}
chrom_pri = [g('T_JUNIOR', 'A', 'MON', 480, 90, '6X')]  # T_SENIOR is free and has room
out3 = capture(sch.diagnose_faculty_priority_violations, chrom_pri, teacher_priority, teachers_per_subject)
check("Reports the current assignment", "T_JUNIOR" in out3, True)
check("Reports the higher-priority candidate who should've been used", "T_SENIOR" in out3, True)

real_pri_count = sch.count_total_violations(chrom_pri, teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subject)
check("Matches actual violation count (1)", real_pri_count, 1)

# Now with T_SENIOR already at cap -- should correctly show NONE (matching the fixed check's logic)
chrom_pri_loaded = [g('T_SENIOR', 'OTHER', 'TUE', 480, 90, '6OTHER', units=24.0), g('T_JUNIOR', 'A', 'MON', 480, 90, '6X')]
out3b = capture(sch.diagnose_faculty_priority_violations, chrom_pri_loaded, teacher_priority, teachers_per_subject, {'T_SENIOR': 24.0, 'T_JUNIOR': 24.0})
check("T_SENIOR at cap -> correctly reports none (consistent with the fix)", "(none)" in out3b, True)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
