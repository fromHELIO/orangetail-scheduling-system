import scheduler as sch
import lab_matching as lm

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

def g(teacher, section, day, start, dur, subj, schedtype, lab_cat, room):
    return sch.Gene(class_id=1, subjcode=subj, program='BSCS', year_level=1, school_year='2026-2027',
                     semester=1, schedtype=schedtype, lab_cat=lab_cat, section=section, meeting_num=1,
                     teacher_name=teacher, day=day, start_minute=start, duration=dur, room=room)

print("=== 1. Genuine data gap: a lab_cat with ZERO matching rooms anywhere in the pool ===")
room_info_gap = {
    'MGN-202': {'room_type': 'LAB', 'lab_cat': 'COMPUTER'},
    'SJH-501': {'room_type': 'LEC', 'lec_cat': 'GENED'},
}
# Gene needs FOLEY, but no FOLEY room exists in this pool at all -- forced onto a COMPUTER room instead
gene_gap = g('T1', 'A', 'MON', 480, 180, '6SOPMAN', 'LAB_3H', 'FOLEY', 'MGN-202')
check("Correctly flagged as a violation (assigned room doesn't match needed category)",
      lm.is_valid_room(gene_gap.schedtype, gene_gap.lab_cat, room_info_gap.get(gene_gap.room)), False)

import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    sch.diagnose_room_type_violations([gene_gap], room_info_gap)
output = buf.getvalue()
print(output)
check("Correctly identifies this as a data gap (no matching room exists)", "data gap" in output, True)
check("Correctly names the missing category", "FOLEY" in output, True)

print("=== 2. A matching room DOES exist, but this gene wasn't assigned to it ===")
room_info_exists = {
    'PGN-811': {'room_type': 'LAB', 'lab_cat': 'FOLEY'},
    'MGN-202': {'room_type': 'LAB', 'lab_cat': 'COMPUTER'},
}
gene_exists = g('T1', 'A', 'MON', 480, 180, '6SOPMAN', 'LAB_3H', 'FOLEY', 'MGN-202')
buf2 = io.StringIO()
with contextlib.redirect_stdout(buf2):
    sch.diagnose_room_type_violations([gene_exists], room_info_exists)
output2 = buf2.getvalue()
print(output2)
check("Correctly identifies a matching room DOES exist", "DO carry this category" in output2, True)
check("Correctly names the room that should have been used", "PGN-811" in output2, True)

print("=== 3. A correctly-assigned gene produces NO output at all ===")
gene_ok = g('T1', 'A', 'MON', 480, 180, '6SOPMAN', 'LAB_3H', 'FOLEY', 'PGN-811')
buf3 = io.StringIO()
with contextlib.redirect_stdout(buf3):
    sch.diagnose_room_type_violations([gene_ok], room_info_exists)
check("Correctly-assigned gene produces empty output", buf3.getvalue().strip(), "")

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
