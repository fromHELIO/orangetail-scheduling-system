import scheduler as sch

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

def close(a, b, tol=1e-9):
    return abs(a - b) < tol

print("=== 1. Backward compatibility: Gene constructed WITHOUT units gets the safe default ===")
g_old_style = sch.Gene(class_id=1, subjcode='6CFUN', program='BSCS', year_level=1, school_year='2026-2027',
                        semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section='A', meeting_num=1,
                        teacher_name='T1', day='MON', start_minute=480, duration=90, room='SJH-501')
check("Gene built the old way (no units kwarg) defaults to 1.0", g_old_style.units, 1.0)

print("\n=== 2. Gene.copy() correctly preserves a non-default units value ===")
g_weighted = sch.Gene(class_id=2, subjcode='6DMS', program='BSCS', year_level=1, school_year='2026-2027',
                       semester=1, schedtype='LAB_3H', lab_cat='COMPUTER', section='A', meeting_num=1,
                       teacher_name='T1', day='MON', start_minute=480, duration=180, room='MGN-202', units=2.7)
g_copy = g_weighted.copy()
check("copy() preserves the exact units value, not the default", g_copy.units, 2.7)
check("copy() is still a genuinely independent object", g_copy is not g_weighted, True)

print("\n=== 3. Unit-distribution math via load_data_from_json, using a synthetic fixture ===")
import json, os
os.makedirs('/tmp/units_test', exist_ok=True)
os.chdir('/tmp/units_test')

curriculum = [
    {"curriculum_id": "C1", "program": "BSCS", "year_level": 1, "semester": 1,
     "subjcode": "6SPLIT3", "subjtitle": "Split course, 3 units", "units": 3, "schedtype": "SPLIT", "lab_cat": "COMPUTER"},
    {"curriculum_id": "C1", "program": "BSCS", "year_level": 1, "semester": 1,
     "subjcode": "6LEC3", "subjtitle": "Pure lecture, 3 units", "units": 3, "schedtype": "LEC", "lab_cat": "NONE"},
    {"curriculum_id": "C1", "program": "BSCS", "year_level": 1, "semester": 1,
     "subjcode": "6LAB3", "subjtitle": "Pure lab, 3 units", "units": 3, "schedtype": "LAB", "lab_cat": "COMPUTER"},
]
blocks = [{"block_id": "B1", "program": "BSCS", "year_level": 1, "semester": 1, "curriculum_id": "C1", "school_year": "2026-2027"}]
teachers = [{"name": "T1", "ranked_eligible_subjects": ["6SPLIT3", "6LEC3", "6LAB3"]}]
rooms = [{"room_name": "SJH-501", "room_type": "LEC", "lab_cat": "NONE", "lec_cat": "GENED"},
         {"room_name": "MGN-202", "room_type": "LAB", "lab_cat": "COMPUTER", "lec_cat": "NONE"}]

json.dump(curriculum, open('curriculum.json', 'w'))
json.dump(blocks, open('blocks.json', 'w'))
json.dump(teachers, open('teachers.json', 'w'))
json.dump(rooms, open('rooms.json', 'w'))

class_reqs, avail_teachers, avail_rooms, room_info, ranked, per_subj, max_load, priority = sch.load_data_from_json(
    'blocks.json', 'curriculum.json', 'teachers.json', 'rooms.json',
    target_semester=1, target_school_year='2026-2027'
)

split_reqs = [r for r in class_reqs if r['SUBJCODE'] == '6SPLIT3']
lec_reqs = [r for r in class_reqs if r['SUBJCODE'] == '6LEC3']
lab_reqs = [r for r in class_reqs if r['SUBJCODE'] == '6LAB3']

check("SPLIT course produces 2 meetings", len(split_reqs), 2)
lec_half = next(r for r in split_reqs if r['SCHEDTYPE'] == 'LEC_2H')
lab_half = next(r for r in split_reqs if r['SCHEDTYPE'] == 'LAB_3H')
check("SPLIT: LEC half (120min of 300min total) gets 1.2 units", close(lec_half['UNITS'], 1.2), True)
check("SPLIT: LAB half (180min of 300min total) gets 1.8 units", close(lab_half['UNITS'], 1.8), True)
check("SPLIT: the two halves sum back to the course's real 3 units",
      close(lec_half['UNITS'] + lab_half['UNITS'], 3.0), True)

check("Pure LEC course produces 2 meetings", len(lec_reqs), 2)
check("Pure LEC: both meetings equal duration -> equal 1.5 units each",
      all(close(r['UNITS'], 1.5) for r in lec_reqs), True)
check("Pure LEC: sums back to 3 units", close(sum(r['UNITS'] for r in lec_reqs), 3.0), True)

check("Pure LAB course produces 1 meeting", len(lab_reqs), 1)
check("Pure LAB: the single meeting gets the FULL 3 units", close(lab_reqs[0]['UNITS'], 3.0), True)

print("\n=== 4. End-to-end: initialize_population correctly threads UNITS into the actual Genes ===")
pop = sch.initialize_population(1, class_reqs, avail_teachers, per_subj, avail_rooms, room_info)
chrom = pop[0]
split_genes = [g for g in chrom if g.subjcode == '6SPLIT3']
lec_genes = [g for g in chrom if g.subjcode == '6LEC3']
lab_genes = [g for g in chrom if g.subjcode == '6LAB3']

lec_gene = next(g for g in split_genes if g.schedtype == 'LEC_2H')
lab_gene = next(g for g in split_genes if g.schedtype == 'LAB_3H')
check("Real Gene for SPLIT's LEC half carries 1.2 units", close(lec_gene.units, 1.2), True)
check("Real Gene for SPLIT's LAB half carries 1.8 units", close(lab_gene.units, 1.8), True)
check("Real Genes for pure LEC each carry 1.5 units", all(close(g.units, 1.5) for g in lec_genes), True)
check("Real Gene for pure LAB carries the full 3.0 units", close(lab_genes[0].units, 3.0), True)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
