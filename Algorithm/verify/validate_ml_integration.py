import random
from collections import defaultdict

import scheduler as sch
from ml_predictor import get_faculty_compatibility

POP_SIZE = 30
STAGNATION_LIMIT = 60
TARGET_SEMESTER = 1
TARGET_SCHOOL_YEAR = "2026-2027"

print("=" * 78)
print("ML COMPONENT VALIDATION")
print("=" * 78)

# --- 0. Load data ---------------------------------------------------------
class_reqs, teachers, rooms, room_info, ranked_subjs, teachers_per_subj, max_load, teacher_priority = \
    sch.load_data_from_json(
        "blocks.json", "curriculum.json", "teachers.json", "rooms.json",
        target_semester=TARGET_SEMESTER, target_school_year=TARGET_SCHOOL_YEAR,
    )
print(f"\n{len(class_reqs)} class requirements | {len(teachers)} teachers | {len(rooms)} active rooms")

soc_reqs = [r for r in class_reqs if not sch._is_gened_subject(r["SUBJCODE"])]
gened_reqs = [r for r in class_reqs if sch._is_gened_subject(r["SUBJCODE"])]
print(f"{len(soc_reqs)} SoC (major) meetings will consult the ML model | {len(gened_reqs)} GenEd meetings will not")


# --- 1. Confirm the real model is loaded, not the stub used elsewhere in this project ---
print("\n" + "-" * 78)
print("1. MODEL SANITY CHECK")
print("-" * 78)
probe_teacher = teachers[0] if teachers else None
probe_subj = soc_reqs[0]["SUBJCODE"] if soc_reqs else None
if probe_teacher and probe_subj:
    probe_scores = [
        get_faculty_compatibility(
            subjcode=probe_subj, program=soc_reqs[0]["PROGRAM"], year_level=soc_reqs[0]["YEAR_LEVEL"],
            school_year=TARGET_SCHOOL_YEAR, semester=TARGET_SEMESTER,
            schedtype=soc_reqs[0]["SCHEDTYPE"], lab_cat=soc_reqs[0]["LAB_CAT"], teacher_name=t,
        )
        for t in teachers[:8]
    ]
    distinct = len(set(round(s, 4) for s in probe_scores))
    print(f"Sampled {len(probe_scores)} teachers against {probe_subj}: {[round(s, 3) for s in probe_scores]}")
    if distinct <= 1:
        print("\n*** WARNING: every score is identical. Either every one of these teachers is")
        print("*** genuinely unrecognized by the model (falling back to the same default), or")
        print("*** this is running against a stub, not the real trained model. The results")
        print("*** below will not be meaningful until this is resolved. ***")
    else:
        print(f"{distinct} distinct values among {len(probe_scores)} teachers -- genuine, varying inference confirmed.")


# --- 2. Direct predictions for a few real subjects, showing real variation ---
print("\n" + "-" * 78)
print("2. SAMPLE PREDICTIONS ACROSS DIFFERENT SUBJECTS (same teacher)")
print("-" * 78)
sample_subjects = list({r["SUBJCODE"]: r for r in soc_reqs}.values())[:5]
if probe_teacher:
    for req in sample_subjects:
        score = get_faculty_compatibility(
            subjcode=req["SUBJCODE"], program=req["PROGRAM"], year_level=req["YEAR_LEVEL"],
            school_year=TARGET_SCHOOL_YEAR, semester=TARGET_SEMESTER,
            schedtype=req["SCHEDTYPE"], lab_cat=req["LAB_CAT"], teacher_name=probe_teacher,
        )
        print(f"  {probe_teacher:30s} x {req['SUBJCODE']:12s} -> {score:.4f}")


# --- 3. The SC-01 blend itself: ML and rank combined, exactly as evaluate_fitness does it ---
print("\n" + "-" * 78)
print("3. SC-01 BLEND (0.5 x ML + 0.5 x rank), for one real qualified pair")
print("-" * 78)
demo_pair = None
for req in soc_reqs:
    candidates = teachers_per_subj.get(req["SUBJCODE"], [])
    if candidates:
        demo_pair = (candidates[0], req)
        break
if demo_pair:
    t_name, req = demo_pair
    ml = get_faculty_compatibility(
        subjcode=req["SUBJCODE"], program=req["PROGRAM"], year_level=req["YEAR_LEVEL"],
        school_year=TARGET_SCHOOL_YEAR, semester=TARGET_SEMESTER,
        schedtype=req["SCHEDTYPE"], lab_cat=req["LAB_CAT"], teacher_name=t_name,
    )
    rank = sch.calculate_rank_score(t_name, req["SUBJCODE"], ranked_subjs)
    blended = 0.5 * ml + 0.5 * rank
    print(f"  Teacher:       {t_name}")
    print(f"  Subject:       {req['SUBJCODE']}")
    print(f"  ML score:      {ml:.4f}")
    print(f"  Rank score:    {rank:.4f}  (from this teacher's own ranked_eligible_subjects)")
    print(f"  SC-01 blend:   {blended:.4f}  (0.5 x {ml:.4f} + 0.5 x {rank:.4f})")
else:
    print("  No teacher had a qualified-subject entry in this fixture to demo against.")


# --- 4. GenEd exclusion, confirmed directly ---
print("\n" + "-" * 78)
print("4. GENED EXCLUSION")
print("-" * 78)
if gened_reqs:
    g = gened_reqs[0]
    print(f"Example GenEd subject: {g['SUBJCODE']} -- _is_gened_subject() = {sch._is_gened_subject(g['SUBJCODE'])}")
    print("build_ml_lookup (below) skips these entirely -- no model calls are ever made for them,")
    print("and evaluate_fitness independently skips any GenEd gene when averaging affinity,")
    print("so this is enforced in two places, not assumed from one.")
else:
    print("No GenEd subjects in this fixture to demonstrate against.")


# --- 5. Build the real ml_lookup and run the full algorithm ---------------
print("\n" + "-" * 78)
print(f"5. FULL ALGORITHM RUN (pop_size={POP_SIZE}, stagnation_limit={STAGNATION_LIMIT})")
print("-" * 78)

def build_ml_lookup(class_requirements, available_teachers, teachers_per_subject):
    """Same logic as database.py's build_ml_lookup, kept inline here so this
    script has no dependency on the live-system database.py module (which
    requires Supabase credentials just to import)."""
    lookup = {}
    for req in class_requirements:
        subj = req["SUBJCODE"]
        if sch._is_gened_subject(subj):
            continue
        candidates = (teachers_per_subject or {}).get(subj) or available_teachers
        for teacher in candidates:
            key = (teacher, subj, req["PROGRAM"], req["YEAR_LEVEL"])
            if key not in lookup:
                lookup[key] = get_faculty_compatibility(
                    subjcode=subj, program=req["PROGRAM"], year_level=req["YEAR_LEVEL"],
                    school_year=req["SCHOOL_YEAR"], semester=req["SEMESTER"],
                    schedtype=req["SCHEDTYPE"], lab_cat=req["LAB_CAT"], teacher_name=teacher,
                )
    return lookup

ml_lookup = build_ml_lookup(class_reqs, teachers, teachers_per_subj)
print(f"ml_lookup built: {len(ml_lookup)} unique (teacher, subject, program, year) predictions cached")

best = sch.run_memetic_algorithm(
    class_requirements=class_reqs, available_teachers=teachers,
    teachers_per_subject=teachers_per_subj, available_rooms=rooms,
    teacher_ranked_subjects=ranked_subjs, room_info=room_info,
    ml_lookup=ml_lookup, teacher_max_load=max_load,
    pop_size=POP_SIZE, stagnation_limit=STAGNATION_LIMIT, teacher_priority=teacher_priority,
)
fitness, hard_violations, avg_affinity = sch.evaluate_fitness(
    best, ranked_subjs, room_info, ml_lookup, max_load,
    teacher_priority=teacher_priority, teachers_per_subject=teachers_per_subj,
)
print(f"\nFinal hard violations: {hard_violations}")
print(f"Final avg_affinity (SC-01, GenEd excluded): {avg_affinity:.4f}")


# --- 6. The actual validation: achieved assignments vs. a random baseline --
print("\n" + "-" * 78)
print("6. ACHIEVED VS. RANDOM BASELINE -- does the ML signal actually change the outcome?")
print("-" * 78)
print("For every real assignment the algorithm made, compares its ML/rank score against")
print("what a uniform random choice among that subject's qualified candidates would have")
print("scored on average. If the algorithm is genuinely using this signal, its real")
print("choices should consistently beat that random baseline, not just match it.\n")

achieved_ml_total = achieved_rank_total = 0.0
random_ml_total = random_rank_total = 0.0
counted = 0

for g in best:
    if sch._is_gened_subject(g.subjcode):
        continue
    achieved_ml = ml_lookup.get((g.teacher_name, g.subjcode, g.program, g.year_level), 0.0)
    achieved_rank = sch.calculate_rank_score(g.teacher_name, g.subjcode, ranked_subjs)

    candidates = teachers_per_subj.get(g.subjcode, []) or teachers
    if not candidates:
        continue
    rand_ml_scores = [ml_lookup.get((t, g.subjcode, g.program, g.year_level), 0.0) for t in candidates]
    rand_rank_scores = [sch.calculate_rank_score(t, g.subjcode, ranked_subjs) for t in candidates]

    achieved_ml_total += achieved_ml
    achieved_rank_total += achieved_rank
    random_ml_total += sum(rand_ml_scores) / len(rand_ml_scores)
    random_rank_total += sum(rand_rank_scores) / len(rand_rank_scores)
    counted += 1

if counted:
    print(f"Across {counted} real (non-GenEd) assignments:\n")
    print(f"  ML score      -- achieved avg: {achieved_ml_total/counted:.4f}   random baseline avg: {random_ml_total/counted:.4f}")
    print(f"  Rank score    -- achieved avg: {achieved_rank_total/counted:.4f}   random baseline avg: {random_rank_total/counted:.4f}")
    ml_lift = (achieved_ml_total - random_ml_total) / counted
    rank_lift = (achieved_rank_total - random_rank_total) / counted
    print(f"\n  ML lift over random:   {ml_lift:+.4f}")
    print(f"  Rank lift over random: {rank_lift:+.4f}")
    if ml_lift <= 0 and rank_lift <= 0:
        print("\n  No positive lift on either signal -- if this persists with the real model")
        print("  (not the stub), that would mean the affinity signal isn't actually")
        print("  influencing which teacher gets picked, worth investigating directly.")
else:
    print("No non-GenEd assignments with qualified candidates to compare in this fixture.")


# --- 7. Confirm this all holds alongside everything else built on top ------
print("\n" + "-" * 78)
print("7. EVERYTHING ELSE, IN THE SAME RUN")
print("-" * 78)
sr = sum(1 for _ in sch._short_rest_violation_pairs(best))
fb = sum(1 for _ in sch._faculty_break_violations(best))
sb = sum(1 for _ in sch._student_break_violations(best))
span = sum(1 for _ in sch._daily_span_violations(best))
print(f"short_rest={sr}  faculty_break={fb}  student_break={sb}  daily_span={span}")

pairing_ok = True
groups = defaultdict(list)
for g in best:
    groups[(g.section, g.subjcode)].append(g)
for (sec, subj), genes in groups.items():
    if len(genes) == 2:
        mode = sch._pairing_mode_for_schedtypes([g.schedtype for g in genes])
        g0, g1 = genes
        if mode == "lecture_pair" and (sch.DAY_PAIR[g0.day] != g1.day or g0.start_minute != g1.start_minute or g0.room != g1.room):
            pairing_ok = False
        elif mode == "split_pair" and sch.DAY_PAIR[g0.day] != g1.day:
            pairing_ok = False
gened_ok = all(
    g.teacher_name.startswith("TBA-PROF-") and g.room.startswith("TBA-RM-")
    for g in best if sch._is_gened_subject(g.subjcode)
)
print(f"Pairing invariants hold: {pairing_ok}  |  GenEd placeholders correct: {gened_ok}")

print("\n" + "=" * 78)
print("DONE. Sections 1-4 are the ML component in isolation. Section 6 is the real")
print("validation -- whether it's actually doing anything. Section 7 confirms it")
print("isn't stepping on, or being stepped on by, everything else built alongside it.")
print("=" * 78)
