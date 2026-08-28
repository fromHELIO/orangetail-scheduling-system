import scheduler as sch
import lab_matching
import random

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

def req(class_id, subj, sec, meeting_num, schedtype, lab_cat='NONE'):
    return {
        'class_id': class_id, 'SUBJCODE': subj, 'PROGRAM': 'BSCS', 'YEAR_LEVEL': 1,
        'SCHOOL_YEAR': '2026-2027', 'SEMESTER': 1, 'SCHEDTYPE': schedtype,
        'LAB_CAT': lab_cat, 'B.SECTION': sec, 'MEETING_NUM': meeting_num, 'UNITS': 1.5,
    }

# room_info with real GENED/SPLITLEC/lab rooms, mirroring the actual live shape
room_info = {
    'SJH-501': {'room_type': 'LEC', 'lab_cat': 'NONE', 'lec_cat': 'GENED'},
    'SJH-502': {'room_type': 'LEC', 'lab_cat': 'NONE', 'lec_cat': 'GENED'},
    'SJH-605': {'room_type': 'LEC', 'lab_cat': 'NONE', 'lec_cat': 'SPLITLEC'},
    'MGN-202': {'room_type': 'LAB', 'lab_cat': 'COMPUTER', 'lec_cat': 'NONE'},
}
available_rooms = list(room_info.keys())
available_teachers = ['T1', 'T2']
teachers_per_subject = {}

print("=== 1. Pure-lecture GenEd gets a REAL room from the GENED pool, not a placeholder ===")
class_reqs = [req(1, '4CONWORLD', 'BSCS-101', 1, 'LEC_1.5H')]
pop = sch.initialize_population(5, class_reqs, available_teachers, teachers_per_subject, available_rooms, room_info)
gene = pop[0][0]
check("Teacher still a placeholder (unchanged)", gene.teacher_name.startswith('TBA-PROF-'), True)
check("Room is NOT a placeholder string anymore", gene.room.startswith('TBA-RM-'), False)
check("Room is a real, known room", gene.room in room_info, True)
check("Room is specifically from the GENED pool", room_info[gene.room]['lec_cat'], 'GENED')

print("\n=== 2. GenEd WITH a lab counterpart stays FULLY placeholder (the exemption) ===")
class_reqs2 = [
    req(2, '4SCIENCE', 'BSCS-101', 1, 'LEC_1.5H'),
    req(2, '4SCIENCE', 'BSCS-101', 2, 'LAB_3H'),
]
pop2 = sch.initialize_population(5, class_reqs2, available_teachers, teachers_per_subject, available_rooms, room_info)
lec_gene = next(g for g in pop2[0] if g.schedtype == 'LEC_1.5H')
lab_gene = next(g for g in pop2[0] if g.schedtype == 'LAB_3H')
check("Lecture half room still placeholder (exemption)", lec_gene.room.startswith('TBA-RM-'), True)
check("Lab half room still placeholder (exemption)", lab_gene.room.startswith('TBA-RM-'), True)
check("Both share the SAME placeholder (first_room reuse still works)", lec_gene.room, lab_gene.room)

print("\n=== 3. Paired pure-lecture GenEd (2 LEC meetings): same real room, different day ===")
class_reqs3 = [
    req(3, '4CONWORLD', 'BSCS-102', 1, 'LEC_1.5H'),
    req(3, '4CONWORLD', 'BSCS-102', 2, 'LEC_1.5H'),
]
pop3 = sch.initialize_population(5, class_reqs3, available_teachers, teachers_per_subject, available_rooms, room_info)
genes3 = [g for g in pop3[0] if g.subjcode == '4CONWORLD' and g.section == 'BSCS-102']
check("Exactly 2 genes for this paired course", len(genes3), 2)
check("Both meetings share the SAME real room (pairing invariant)", genes3[0].room, genes3[1].room)
check("The shared room is a real GENED room", genes3[0].room in room_info and room_info[genes3[0].room]['lec_cat'] == 'GENED', True)
check("The two meetings are on DIFFERENT days", genes3[0].day != genes3[1].day, True)

print("\n=== 4. HC02 (room conflict) correctly catches two GenEd sections sharing the same real room ===")
g1 = sch.Gene(class_id=1, subjcode='4CONWORLD', program='BSCS', year_level=1, school_year='2026-2027',
              semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='A', meeting_num=1,
              teacher_name='TBA-PROF-A|4CONWORLD', day='MON', start_minute=480, duration=90, room='SJH-501', units=1.5)
g2 = sch.Gene(class_id=2, subjcode='4CONWORLD', program='BSCS', year_level=1, school_year='2026-2027',
              semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='B', meeting_num=1,
              teacher_name='TBA-PROF-B|4CONWORLD', day='MON', start_minute=480, duration=90, room='SJH-501', units=1.5)
v = sch.count_total_violations([g1, g2])
check("Two GenEd sections double-booking the same real room -> HC02 correctly fires (v=1)", v, 1)

print("\n=== 5. apply_gene_mutation, room type: GenEd-with-lab is still skipped entirely ===")
chrom5 = [
    sch.Gene(class_id=1, subjcode='4SCIENCE', program='BSCS', year_level=1, school_year='2026-2027',
             semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='A', meeting_num=1,
             teacher_name='TBA-PROF-A|4SCIENCE', day='MON', start_minute=480, duration=90, room='TBA-RM-A|4SCIENCE', units=1.5),
    sch.Gene(class_id=2, subjcode='4SCIENCE', program='BSCS', year_level=1, school_year='2026-2027',
             semester=1, schedtype='LAB_3H', lab_cat='NONE', section='A', meeting_num=2,
             teacher_name='TBA-PROF-A|4SCIENCE', day='TUE', start_minute=480, duration=180, room='TBA-RM-A|4SCIENCE', units=3.0),
]
original_room = chrom5[0].room
sch.apply_gene_mutation(chrom5, 0, 'room', available_teachers, teachers_per_subject, available_rooms, room_info)
check("Room-with-lab-counterpart: room unchanged after mutation attempt (still exempt)", chrom5[0].room, original_room)

print("\n=== 6. apply_gene_mutation, room type: pure-lecture GenEd IS now mutatable ===")
random.seed(1)
chrom6 = [
    sch.Gene(class_id=1, subjcode='4CONWORLD', program='BSCS', year_level=1, school_year='2026-2027',
             semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='A', meeting_num=1,
             teacher_name='TBA-PROF-A|4CONWORLD', day='MON', start_minute=480, duration=90, room='SJH-501', units=1.5),
]
sch.apply_gene_mutation(chrom6, 0, 'room', available_teachers, teachers_per_subject, available_rooms, room_info)
check("Pure-lecture GenEd room is still a real room after mutation", chrom6[0].room in room_info, True)
check("Still specifically from the GENED pool after mutation", room_info[chrom6[0].room]['lec_cat'], 'GENED')

print("\n=== 7. apply_gene_mutation: paired pure-lecture GenEd stays synced through room mutation ===")
chrom7 = [
    sch.Gene(class_id=1, subjcode='4CONWORLD', program='BSCS', year_level=1, school_year='2026-2027',
             semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='B', meeting_num=1,
             teacher_name='TBA-PROF-B|4CONWORLD', day='MON', start_minute=480, duration=90, room='SJH-501', units=1.5),
    sch.Gene(class_id=2, subjcode='4CONWORLD', program='BSCS', year_level=1, school_year='2026-2027',
             semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='B', meeting_num=2,
             teacher_name='TBA-PROF-B|4CONWORLD', day='THU', start_minute=480, duration=90, room='SJH-501', units=1.5),
]
sch.apply_gene_mutation(chrom7, 0, 'room', available_teachers, teachers_per_subject, available_rooms, room_info)
check("Paired sibling's room stays synced after mutating the target gene", chrom7[0].room, chrom7[1].room)

print("\n=== 8. Backward compatibility: no room_info at all -> falls back to available_rooms, no crash ===")
class_reqs8 = [req(8, '4CONWORLD', 'BSCS-103', 1, 'LEC_1.5H')]
try:
    pop8 = sch.initialize_population(3, class_reqs8, available_teachers, teachers_per_subject, available_rooms, room_info=None)
    gene8 = pop8[0][0]
    check("No room_info: still gets SOME real room from available_rooms, no crash", gene8.room in available_rooms, True)
except Exception as e:
    check(f"No room_info: crashed unexpectedly ({e})", False, True)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
