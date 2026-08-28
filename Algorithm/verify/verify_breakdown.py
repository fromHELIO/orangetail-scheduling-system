import scheduler as sch

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

def g(teacher, section, day, start, dur, subj='6CFUN', room='SJH-501'):
    return sch.Gene(class_id=1, subjcode=subj, program='BSCS', year_level=1, school_year='2026-2027',
                     semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section=section, meeting_num=1,
                     teacher_name=teacher, day=day, start_minute=start, duration=dur, room=room)

print("=== Verifying breakdown sum == count_total_violations total, across varied hand-built cases ===\n")

cases = {
    "empty": [],
    "single gene": [g('T1', 'A', 'MON', 480, 90)],
    "room conflict": [g('T1', 'A', 'MON', 480, 90, room='SJH-501'), g('T2', 'B', 'MON', 480, 90, room='SJH-501')],
    "teacher conflict": [g('T1', 'A', 'MON', 480, 90), g('T1', 'B', 'MON', 480, 90, room='SJH-502')],
    "section conflict": [g('T1', 'A', 'MON', 480, 90, subj='6CFUN'), g('T2', 'A', 'MON', 480, 90, subj='6DMS', room='SJH-502')],
    "short-rest violation": [g('T1', 'A', 'MON', 480, 90, room='SJH-501'), g('T1', 'B', 'MON', 600, 90, room='SJH-502')],
    "faculty break violation": [g('T1', 'A', 'MON', 480, 90, room='SJH-501'), g('T1', 'B', 'MON', 585, 90, room='SJH-502'),
                                  g('T1', 'C', 'MON', 690, 90, room='SJH-503')],
    "mixed, multiple types": [
        g('T1', 'A', 'MON', 480, 90, room='SJH-501'),
        g('T1', 'B', 'MON', 480, 90, room='SJH-501'),  # room + teacher conflict
        g('T2', 'C', 'MON', 690, 200, room='SJH-502'),  # ends past DAY_END_MIN? no, fine -- just a normal gene
    ],
}

for name, chrom in cases.items():
    total = sch.count_total_violations(chrom)
    breakdown = sch.count_violations_by_category(chrom)
    breakdown_sum = sum(breakdown.values())
    check(f"'{name}': breakdown sum ({breakdown_sum}) matches total ({total})", breakdown_sum, total)

print("\n=== Testing at real scale against the large fixture ===")
class_reqs, teachers, rooms, room_info, ranked_subjs, teachers_per_subj, max_load, teacher_priority = sch.load_data_from_json(
    'blocks.json', 'curriculum.json', 'teachers.json', 'rooms.json',
    target_semester=1, target_school_year='2026-2027'
)
pop = sch.initialize_population(3, class_reqs, teachers, teachers_per_subj, rooms, room_info)
for i, chrom in enumerate(pop):
    total = sch.count_total_violations(chrom, ranked_subjs, room_info, max_load, teacher_priority, teachers_per_subj)
    breakdown = sch.count_violations_by_category(chrom, ranked_subjs, room_info, max_load, teacher_priority, teachers_per_subj)
    breakdown_sum = sum(breakdown.values())
    check(f"Real-scale chromosome #{i}: breakdown sum ({breakdown_sum}) matches total ({total})", breakdown_sum, total)
    if i == 0:
        print(f"  Sample breakdown: {dict(sorted(breakdown.items(), key=lambda kv: -kv[1]))}")

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED -- the breakdown is a verified, faithful mirror of the total.")
