from fastapi.testclient import TestClient
import time
import threading

import api
from database import supabase
client = TestClient(api.app)

failures = []
def check(desc, actual, expected):
    ok = actual == expected
    if not ok:
        failures.append(desc)
    print(f"[{'PASS' if ok else 'FAIL'}] {desc} -> got {actual!r}, expected {expected!r}")

TARGET_SEMESTER = 1
_sample = (
    supabase.table("curriculum_courses")
    .select("curriculum_id, year_lvl")
    .eq("semester", TARGET_SEMESTER)
    .limit(1)
    .execute()
    .data
)
if not _sample:
    print(f"No curriculum_courses rows found for semester={TARGET_SEMESTER} in this database.")
    print("Cannot run a real end-to-end job without at least one -- add curriculum data first, or change TARGET_SEMESTER above.")
    raise SystemExit(1)

REAL_CURRICULUM_ID = _sample[0]["curriculum_id"]
REAL_YEAR_LVL = _sample[0]["year_lvl"]
print(f"Using a real, verified combination from your database: curriculum_id={REAL_CURRICULUM_ID}, year_lvl={REAL_YEAR_LVL}, semester={TARGET_SEMESTER}")

BODY = {"school_year": "2026-2027", "semester": TARGET_SEMESTER, "pop_size": 40,
        "block_requests": [{"curriculum_id": REAL_CURRICULUM_ID, "year_lvl": REAL_YEAR_LVL, "num_blocks": 1}]}

print("=== 1. Starting endpoint returns immediately, not after the full ~4s stubbed computation ===")
t0 = time.time()
r = client.post("/api/generate-schedule", json=BODY)
elapsed = time.time() - t0
check("Status code is 200", r.status_code, 200)
check("Response has a job_id", "job_id" in r.json(), True)
check("Initial status is 'running'", r.json()["status"], "running")
check("Returns fast (<1s), not after the ~4s stubbed work", elapsed < 1.0, True)
job_id = r.json()["job_id"]

print("\n=== 2. A second start attempt while the first is still running is rejected IMMEDIATELY, synchronously ===")
t0 = time.time()
r2 = client.post("/api/generate-schedule", json=BODY)
elapsed2 = time.time() - t0
check("Second attempt gets 409", r2.status_code, 409)
check("Clear message, matching the original wording", "already" in r2.json()["detail"] or "in progress" in r2.json()["detail"], True)
check("Rejected fast, not after waiting -- no polling needed to discover this", elapsed2 < 1.0, True)

print("\n=== 3. Polling the status endpoint while running shows 'running', then transitions to 'complete' ===")
r3 = client.get(f"/api/generate-schedule/{job_id}")
check("Status endpoint returns 200 for a known job", r3.status_code, 200)
print(f"  (status right after starting: {r3.json()['status']})")

# Poll until done (the stubbed work takes ~4s total)
final = None
for _ in range(30):
    r = client.get(f"/api/generate-schedule/{job_id}")
    if r.json()["status"] in ("complete", "failed"):
        final = r.json()
        break
    time.sleep(0.3)
check("Job eventually reaches 'complete'", final["status"] if final else None, "complete")

print("\n=== 4. The completed result has the EXACT same shape as the old synchronous response ===")
result = final["result"]
check("Has 'status': 'success'", result.get("status"), "success")
check("Has 'schedule' key", "schedule" in result, True)
check("Has 'hard_violations' key", "hard_violations" in result, True)
check("Has 'violation_breakdown' key", "violation_breakdown" in result, True)
check("Has 'violation_drilldowns' key", "violation_drilldowns" in result, True)

print("\n=== 5. Once the job is done, the lock has released -- a THIRD attempt now succeeds ===")
r5 = client.post("/api/generate-schedule", json=BODY)
check("Third attempt succeeds now that the lock is free", r5.status_code, 200)
job_id_2 = r5.json()["job_id"]
check("Gets a genuinely different job_id", job_id_2 != job_id, True)
# let this one finish too, so it doesn't leave the lock held for later tests
for _ in range(30):
    r = client.get(f"/api/generate-schedule/{job_id_2}")
    if r.json()["status"] in ("complete", "failed"):
        break
    time.sleep(0.3)

print("\n=== 6. Unknown job ID returns 404 ===")
r6 = client.get("/api/generate-schedule/not-a-real-id")
check("Unknown job ID -> 404", r6.status_code, 404)

print("\n=== 7. Empty block_requests: fails via job status, not an immediate HTTP error (a real behavior change worth confirming explicitly) ===")
bad_body = {**BODY, "block_requests": []}
r7 = client.post("/api/generate-schedule", json=bad_body)
check("Starting still succeeds (validation now happens inside the job)", r7.status_code, 200)
job_id_3 = r7.json()["job_id"]
for _ in range(20):
    r = client.get(f"/api/generate-schedule/{job_id_3}")
    if r.json()["status"] in ("complete", "failed"):
        final3 = r.json()
        break
    time.sleep(0.2)
check("Job status is 'failed'", final3["status"], "failed")
check("Error message explains why", "block request" in final3.get("error", "").lower(), True)

print("\n=== 8. Three-way concurrent race -- exactly one start succeeds, the other two get 409 ===")
# wait for any prior job to be fully done first
time.sleep(0.5)
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
    raise SystemExit(1)
else:
    print("ALL CHECKS PASSED.")
