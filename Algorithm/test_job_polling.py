import sys
sys.path.insert(0, "/home/claude/build/job_test")
from fastapi.testclient import TestClient
import time
import threading

import api
client = TestClient(api.app)

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

BODY = {"school_year": "2026-2027", "semester": 1, "pop_size": 40,
        "block_requests": [{"curriculum_id": 1, "year_lvl": 1, "num_blocks": 1}]}

print("=== 1. Starting endpoint returns immediately ===")
t0 = time.time()
r = client.post("/api/generate-schedule", json=BODY)
elapsed = time.time() - t0
check("Status code is 200", r.status_code, 200)
check("Response has a job_id", "job_id" in r.json(), True)
check("Initial status is 'running'", r.json()["status"], "running")
check("Returns fast (<1s)", elapsed < 1.0, True)
job_id = r.json()["job_id"]

print("\n=== 2. A second start attempt while running is rejected immediately ===")
t0 = time.time()
r2 = client.post("/api/generate-schedule", json=BODY)
elapsed2 = time.time() - t0
check("Second attempt gets 409", r2.status_code, 409)
check("Clear message", "already" in r2.json()["detail"] or "in progress" in r2.json()["detail"], True)
check("Rejected fast", elapsed2 < 1.0, True)

print("\n=== 3. Polling status endpoint ===")
r3 = client.get(f"/api/generate-schedule/{job_id}")
check("Status endpoint returns 200", r3.status_code, 200)

# Increased max attempts to 50 (15 seconds total) to prevent NoneType timeouts
final = None
for _ in range(50):
    r = client.get(f"/api/generate-schedule/{job_id}")
    res = r.json()
    if res.get("status") in ("complete", "failed"):
        final = res
        break
    time.sleep(0.3)
print("DEBUG STATUS:", final)
check("Job eventually reaches 'complete'", final.get("status") if final else None, "complete")

print("\n=== 4. Completed result structure ===")
if final and "result" in final:
    result = final["result"]
    check("Has 'status': 'success'", result.get("status"), "success")
    check("Has 'schedule' key", "schedule" in result, True)
    check("Has 'hard_violations' key", "hard_violations" in result, True)
    check("Has 'violation_breakdown' key", "violation_breakdown" in result, True)
    check("Has 'violation_drilldowns' key", "violation_drilldowns" in result, True)
else:
    check("Job finished with result body", False, True)

print("\n=== 5. Lock released after completion ===")
r5 = client.post("/api/generate-schedule", json=BODY)
check("Third attempt succeeds now that lock is free", r5.status_code, 200)
job_id_2 = r5.json()["job_id"]
check("Gets a genuinely different job_id", job_id_2 != job_id, True)

# Ensure job_2 finishes completely before moving on
for _ in range(50):
    r = client.get(f"/api/generate-schedule/{job_id_2}")
    if r.json()["status"] in ("complete", "failed"):
        break
    time.sleep(0.3)

print("\n=== 6. Unknown job ID returns 404 ===")
r6 = client.get("/api/generate-schedule/not-a-real-id")
check("Unknown job ID -> 404", r6.status_code, 404)

print("\n=== 7. Empty block_requests handled inside job ===")
bad_body = {**BODY, "block_requests": []}
r7 = client.post("/api/generate-schedule", json=bad_body)
check("Starting still succeeds", r7.status_code, 200)
job_id_3 = r7.json()["job_id"]

final3 = None
for _ in range(50):
    r = client.get(f"/api/generate-schedule/{job_id_3}")
    res = r.json()
    if res.get("status") in ("complete", "failed"):
        final3 = res
        break
    time.sleep(0.3)

check("Job status is 'failed'", final3.get("status") if final3 else None, "failed")
check("Error message explains why", "block request" in final3.get("error", "").lower() if final3 else False, True)

print("\n=== 8. Three-way concurrent race ===")
# Allow background threads to release locks fully
time.sleep(1.0)

results = []
def attempt():
    r = client.post("/api/generate-schedule", json=BODY)
    results.append(r.status_code)

threads = [threading.Thread(target=attempt) for _ in range(3)]
for t in threads: t.start()
for t in threads: t.join()

successes = [r for r in results if r == 200]
rejections = [r for r in results if r == 409]
print(f"  results: {results}")
check("Exactly one succeeds", len(successes), 1)
check("Exactly two rejected", len(rejections), 2)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
else:
    print("ALL CHECKS PASSED.")