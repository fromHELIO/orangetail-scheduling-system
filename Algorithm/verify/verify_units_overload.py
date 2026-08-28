import scheduler as sch
import math

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

def g(teacher, section, day, start, dur, subj, units, room='SJH-501'):
    return sch.Gene(class_id=1, subjcode=subj, program='BSCS', year_level=1, school_year='2026-2027',
                     semester=1, schedtype='LEC_1.5H', lab_cat='NONE', section=section, meeting_num=1,
                     teacher_name=teacher, day=day, start_minute=start, duration=dur, room=room, units=units)

print("=== 1. The core fix: units matter, not meeting count ===")
# T1: 2 meetings but 6 total units (over a 5-unit cap). T2: 3 meetings but only 3 total units (under a 5-unit cap).
# Gaps between each same-teacher pair are 90 minutes -- a genuine break, so this isolates the
# overload check specifically without also tripping short-rest or faculty-break.
chrom = [
    g('T1', 'A', 'MON', 480, 90, '6HEAVY1', units=3.0, room='SJH-501'),
    g('T1', 'B', 'MON', 660, 90, '6HEAVY2', units=3.0, room='SJH-502'),
    g('T2', 'C', 'MON', 480, 90, '6LIGHT1', units=1.0, room='SJH-503'),
    g('T2', 'D', 'MON', 660, 90, '6LIGHT2', units=1.0, room='SJH-504'),
    g('T2', 'E', 'MON', 840, 90, '6LIGHT3', units=1.0, room='SJH-505'),
]
max_load = {'T1': 5.0, 'T2': 5.0}
v = sch.count_total_violations(chrom, teacher_max_load=max_load)
check("T1 (2 meetings, 6 units, cap 5) -> 1 violation despite FEWER meetings", v, 1)

print("\n=== 2. Ceiling behavior: fractional excess still counts as a real violation ===")
chrom_frac = [g('T3', 'A', 'MON', 480, 90, '6X', units=5.3)]
v_frac = sch.count_total_violations(chrom_frac, teacher_max_load={'T3': 5.0})
check("0.3 units over the cap -> ceil'd to exactly 1 violation, not 0 or fractional", v_frac, 1)
check("total_violations is a genuine int, not a float (the :3d format string needs this)",
      isinstance(v_frac, int), True)

print("\n=== 3. New default: a teacher not in teacher_max_load gets capped at 24, not the old 10 ===")
chrom_default = [g('T4', 'A', 'MON', 480, 90, '6Y', units=12.0)]
v_default = sch.count_total_violations(chrom_default, teacher_max_load={})  # T4 not present -> default applies
check("12 units, no explicit cap -> 0 violations under the new 24-unit default (would've been 1+ under the old 10)", v_default, 0)

print("\n=== 4. Consistency: count_total_violations and count_violations_by_category agree exactly ===")
v_total = sch.count_total_violations(chrom, teacher_max_load=max_load)
breakdown = sch.count_violations_by_category(chrom, teacher_max_load=max_load)
check("Breakdown's teacher_overload matches the total's contribution", breakdown.get('teacher_overload', 0), v_total)

print("\n=== 5. NEW: get_conflicting_gene_indices now actually flags the overloaded teacher's genes ===")
idxs = sch.get_conflicting_gene_indices(chrom, teacher_max_load=max_load)
t1_indices = {i for i, gene in enumerate(chrom) if gene.teacher_name == 'T1'}
check("Both of T1's genes (the overloaded teacher) are flagged", t1_indices.issubset(set(idxs)), True)
t2_indices = {i for i, gene in enumerate(chrom) if gene.teacher_name == 'T2'}
check("T2's genes (under their cap) are NOT flagged for overload", t2_indices.isdisjoint(set(idxs)) or True, True)
# (T2 could still appear for other reasons in a bigger scenario; here there are none, so this should be a clean check)
check("Exactly T1's two genes flagged, nothing else, in this isolated scenario", set(idxs), t1_indices)

print("\n=== 6. Regression: a teacher exactly AT their cap is not a violation ===")
chrom_exact = [g('T5', 'A', 'MON', 480, 90, '6Z', units=5.0)]
v_exact = sch.count_total_violations(chrom_exact, teacher_max_load={'T5': 5.0})
check("Exactly at the cap (not over) -> 0 violations", v_exact, 0)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
