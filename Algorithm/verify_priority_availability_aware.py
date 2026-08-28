import scheduler as sch

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

teacher_priority = {'T_SENIOR': (20, 3), 'T_JUNIOR': (2, 1)}
teachers_per_subject = {'6X': ['T_SENIOR', 'T_JUNIOR']}
max_load = {'T_SENIOR': 24.0, 'T_JUNIOR': 24.0}

print("=== 1. THE BUG SCENARIO: senior is time-free and has room, but is genuinely unavailable that day ===")
# T_SENIOR only recorded available on Saturday. T_JUNIOR teaches 6X on Monday.
avail = {'T_SENIOR': [{'day': 'SAT', 'start_minute': 420, 'end_minute': 1260}]}
junior_gene = g('T_JUNIOR', 'A', 'MON', 480, 90, '6X')
v = sch.count_total_violations([junior_gene], teacher_priority=teacher_priority,
                                 teachers_per_subject=teachers_per_subject, teacher_max_load=max_load,
                                 teacher_availability=avail)
check("Senior unavailable that day -> NO LONGER a false violation (v=0)", v, 0)

breakdown = sch.count_violations_by_category([junior_gene], teacher_priority=teacher_priority,
                                                teachers_per_subject=teachers_per_subject, teacher_max_load=max_load,
                                                teacher_availability=avail)
check("Same fix reflected in count_violations_by_category", breakdown.get('faculty_priority', 0), 0)

idxs = sch.get_conflicting_gene_indices([junior_gene], teacher_priority=teacher_priority,
                                          teachers_per_subject=teachers_per_subject, teacher_max_load=max_load,
                                          teacher_availability=avail)
check("Same fix reflected in get_conflicting_gene_indices", 0 in idxs, False)

print("\n=== 2. SANITY CHECK: senior IS available that day -> violation still correctly fires ===")
avail_available = {'T_SENIOR': [{'day': 'MON', 'start_minute': 420, 'end_minute': 1260}]}
v2 = sch.count_total_violations([junior_gene], teacher_priority=teacher_priority,
                                  teachers_per_subject=teachers_per_subject, teacher_max_load=max_load,
                                  teacher_availability=avail_available)
check("Senior available that day -> violation correctly still fires (v=1)", v2, 1)

print("\n=== 3. Backward compatibility: no teacher_availability provided -> old behavior (unaffected by this fix) ===")
v3 = sch.count_total_violations([junior_gene], teacher_priority=teacher_priority,
                                  teachers_per_subject=teachers_per_subject, teacher_max_load=max_load)
check("Without teacher_availability, violation still fires as before (v=1)", v3, 1)

print("\n=== 4. Senior has NO recorded availability at all -> unconstrained, violation still fires ===")
v4 = sch.count_total_violations([junior_gene], teacher_priority=teacher_priority,
                                  teachers_per_subject=teachers_per_subject, teacher_max_load=max_load,
                                  teacher_availability={})
check("Senior with zero rows -> unconstrained -> violation still fires (v=1)", v4, 1)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
