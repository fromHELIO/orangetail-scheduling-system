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

# T_SENIOR: high priority (many years, doctorate). T_JUNIOR: low priority.
teacher_priority = {'T_SENIOR': (20, 3), 'T_JUNIOR': (2, 1)}
teachers_per_subject = {'6X': ['T_SENIOR', 'T_JUNIOR']}

print("=== 1. THE BUG SCENARIO: senior teacher is time-free but already at their cap ===")
# T_SENIOR already has 24 units elsewhere (at cap). T_JUNIOR teaches 6X, T_SENIOR is
# time-free for it, but has zero room left.
existing_senior_load = g('T_SENIOR', 'OTHER', 'TUE', 480, 90, '6OTHER', units=24.0)
junior_gene = g('T_JUNIOR', 'A', 'MON', 480, 90, '6X', units=1.0)
chrom = [existing_senior_load, junior_gene]
max_load = {'T_SENIOR': 24.0, 'T_JUNIOR': 24.0}

v = sch.count_total_violations(chrom, teacher_priority=teacher_priority,
                                 teachers_per_subject=teachers_per_subject, teacher_max_load=max_load)
check("Senior at cap, time-free -> NO LONGER a false violation (v=0)", v, 0)

breakdown = sch.count_violations_by_category(chrom, teacher_priority=teacher_priority,
                                                teachers_per_subject=teachers_per_subject, teacher_max_load=max_load)
check("Same fix reflected in count_violations_by_category", breakdown.get('faculty_priority', 0), 0)

idxs = sch.get_conflicting_gene_indices(chrom, teacher_priority=teacher_priority,
                                          teachers_per_subject=teachers_per_subject, teacher_max_load=max_load)
check("Same fix reflected in get_conflicting_gene_indices", 1 in idxs, False)

print("\n=== 2. SANITY CHECK: senior teacher time-free AND has room -> violation STILL correctly fires ===")
existing_senior_light = g('T_SENIOR', 'OTHER', 'TUE', 480, 90, '6OTHER', units=5.0)  # only 5 units, plenty of room
chrom2 = [existing_senior_light, junior_gene]
v2 = sch.count_total_violations(chrom2, teacher_priority=teacher_priority,
                                  teachers_per_subject=teachers_per_subject, teacher_max_load=max_load)
check("Senior has room -> violation correctly still fires (v=1)", v2, 1)

print("\n=== 3. Backward compatibility: no teacher_max_load provided -> old pure-time behavior ===")
v3 = sch.count_total_violations(chrom, teacher_priority=teacher_priority,
                                  teachers_per_subject=teachers_per_subject)  # no teacher_max_load
check("Without teacher_max_load, falls back to old time-only check -> violation fires (v=1)", v3, 1)

print("\n=== 4. Boundary: candidate exactly AT cap after adding this gene -> still fine (not over) ===")
existing_exact = g('T_SENIOR', 'OTHER', 'TUE', 480, 90, '6OTHER', units=23.0)  # 23 + 1(junior's gene units) = 24 exactly
chrom4 = [existing_exact, junior_gene]
v4 = sch.count_total_violations(chrom4, teacher_priority=teacher_priority,
                                  teachers_per_subject=teachers_per_subject, teacher_max_load=max_load)
check("Exactly at cap after hypothetically adding -> still counts as 'has room' -> violation fires", v4, 1)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
