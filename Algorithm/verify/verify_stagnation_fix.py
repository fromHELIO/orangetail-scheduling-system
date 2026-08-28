"""
Isolates the exact stagnation-tracking decision from run_memetic_algorithm's
main loop (not the whole GA -- just this specific logic), fed a contrived
sequence representing exactly the reported scenario: hard_conflicts stuck at
a fixed value while fitness wobbles slightly from affinity noise. Compares
what the OLD (fitness-based) logic would have done against the NEW
(hard_conflicts-based) logic actually now in scheduler.py.
"""

def old_logic(sequence, stagnation_limit):
    """Exactly mirrors the pre-fix code: reset on ANY fitness improvement."""
    best_fitness = float('-inf')
    stagnation = 0
    for gen, (fitness, hard) in enumerate(sequence, start=1):
        if fitness > best_fitness:
            best_fitness = fitness
            stagnation = 0
        else:
            stagnation += 1
        if stagnation >= stagnation_limit:
            return gen, stagnation
    return None, stagnation


def new_logic(sequence, stagnation_limit):
    """Exactly mirrors the actual fix: reset only when hard_conflicts improves."""
    best_hard = float('inf')
    stagnation = 0
    for gen, (fitness, hard) in enumerate(sequence, start=1):
        if hard < best_hard:
            best_hard = hard
            stagnation = 0
        else:
            stagnation += 1
        if stagnation >= stagnation_limit:
            return gen, stagnation
    return None, stagnation


print("=== Scenario: hard_conflicts stuck at 7 for 1000 generations, fitness wobbles ===")
print("    (a tiny affinity fluctuation every ~40 generations -- sparse, not constant noise)\n")

import random
random.seed(3)
sequence = []
base_fitness = -70000.0
for gen in range(1000):
    # Occasional tiny affinity-driven fitness tick, hard_conflicts never moves
    wobble = random.uniform(0.01, 0.5) if gen % 40 == 0 else 0
    sequence.append((base_fitness + wobble, 7))
    if wobble:
        base_fitness += wobble  # the "best fitness" genuinely does creep up, just from noise

old_stop, old_stag = old_logic(sequence, 200)
new_stop, new_stag = new_logic(sequence, 200)

print(f"OLD logic (fitness-based): {'stopped at gen ' + str(old_stop) if old_stop else 'NEVER stopped within 1000 generations'} (final stagnation={old_stag})")
print(f"NEW logic (hard_conflicts-based): {'stopped at gen ' + str(new_stop) if new_stop else 'NEVER stopped within 1000 generations'} (final stagnation={new_stag})")

failures = []
if old_stop is not None:
    failures.append("OLD logic should NOT have stopped in this scenario (it should exhibit the bug) but did")
if new_stop != 201:
    failures.append(f"NEW logic should stop at generation 201 (200 stagnant gens after gen 1) but stopped at {new_stop}")

print()
print("=== Sanity check: when hard_conflicts genuinely improves, NEW logic still resets correctly ===")
improving_sequence = [(-70000 + g, 7) for g in range(50)] + [(-60000, 5)] + [(-60001, 5)] * 200
stop, stag = new_logic(improving_sequence, 200)
if stop == 251:
    print(f"PASS: correctly resets when hard_conflicts improves (5<7 at position 51), then correctly")
    print(f"      stops 200 generations after THAT point (gen {stop}), not before.")
else:
    failures.append(f"Expected stop at 251 after a genuine hard_conflicts improvement, got {stop}")
    print(f"FAIL: expected 251, got {stop}")

print()
if failures:
    print(f"{len(failures)} FAILURES:")
    for f in failures:
        print(" ", f)
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED -- confirms the old logic exhibits exactly the reported bug,")
    print("and the new logic correctly resolves it while still resetting on genuine progress.")
