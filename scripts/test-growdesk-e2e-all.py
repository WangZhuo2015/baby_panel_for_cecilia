import requests
import json
import hashlib
import subprocess

session = requests.Session()
BASE_URL = "http://127.0.0.1:3089"
ORIGIN = "http://127.0.0.1:3089"
HEADERS = {"Origin": ORIGIN, "Content-Type": "application/json"}

results = []

def record(test_name, passed, detail=""):
    results.append({"name": test_name, "passed": passed, "detail": detail})
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} | {test_name}: {detail}")

# 1. Login
res = session.post(f"{BASE_URL}/api/auth/login", json={"username": "wangzhuo", "password": "123456"}, headers=HEADERS)
for c in session.cookies:
    c.secure = False
login_data = res.json()
baby_id = login_data.get("baby", {}).get("id")
record("Auth: Login", res.status_code == 200 and baby_id is not None, f"Status {res.status_code}, babyId: {baby_id}")

# 2. Auth: Me
res = session.get(f"{BASE_URL}/api/auth/me")
me_data = res.json()
username = me_data.get("user", {}).get("username")
record("Auth: Me", res.status_code == 200 and username == "wangzhuo", f"User: {username}")

# 3. Baby Profile
res = session.get(f"{BASE_URL}/api/baby?id={baby_id}")
baby_data = res.json()
name = baby_data.get("nickname") or baby_data.get("name")
gest_weeks = baby_data.get("gestationalAge") or baby_data.get("gestationalWeeks")
record("Baby Profile", res.status_code == 200 and name == "好好" and gest_weeks == 40, f"Baby nickname: {name}, gestationalAge: {gest_weeks}")

# 4. Family Members
res = session.get(f"{BASE_URL}/api/family/members")
fam_data = res.json()
members = fam_data.get("members", []) if isinstance(fam_data, dict) else fam_data
record("Family Members", res.status_code == 200 and len(members) == 5, f"Count: {len(members)} members")

# 5. Timeline Entries
res = session.get(f"{BASE_URL}/api/records/timeline?babyId={baby_id}")
timeline = res.json()
record("Timeline Entries", res.status_code == 200 and len(timeline) >= 200, f"Count: {len(timeline)} timeline items (limit=200)")

# 6. Feeding Records & CRUD
res = session.get(f"{BASE_URL}/api/records/feeding?babyId={baby_id}&limit=200")
feedings = res.json()
record("Feeding: Read", res.status_code == 200 and len(feedings) >= 82, f"Initial count: {len(feedings)}")

# Test write feeding
post_res = session.post(f"{BASE_URL}/api/records/feeding", json={
    "babyId": baby_id,
    "type": "breast",
    "timestamp": "2026-09-15T07:30:00.000Z",
    "leftMinutes": 10,
    "rightMinutes": 10
}, headers=HEADERS)
created_feeding = post_res.json()
feeding_id = created_feeding.get("id")
del_res = session.delete(f"{BASE_URL}/api/records/feeding?id={feeding_id}&babyId={baby_id}&baseVersion=1", headers=HEADERS)
record("Feeding: Create & Delete", post_res.status_code == 201 and del_res.status_code == 200, f"Create {post_res.status_code}, Delete {del_res.status_code}")

# 7. Sleep Records & CRUD
res = session.get(f"{BASE_URL}/api/records/sleep?babyId={baby_id}&limit=200")
sleeps = res.json()
record("Sleep: Read", res.status_code == 200 and len(sleeps) >= 47, f"Initial count: {len(sleeps)}")

post_res = session.post(f"{BASE_URL}/api/records/sleep", json={
    "babyId": baby_id,
    "type": "nap",
    "startTime": "2026-09-15T01:00:00.000Z",
    "endTime": "2026-09-15T03:00:00.000Z"
}, headers=HEADERS)
created_sleep = post_res.json()
sleep_id = created_sleep.get("id")
del_res = session.delete(f"{BASE_URL}/api/records/sleep?id={sleep_id}&babyId={baby_id}&baseVersion=1", headers=HEADERS)
record("Sleep: Create & Delete", post_res.status_code == 201 and del_res.status_code == 200, f"Create {post_res.status_code}, Delete {del_res.status_code}")

# 8. Diaper Records & CRUD
res = session.get(f"{BASE_URL}/api/records/diaper?babyId={baby_id}&limit=200")
diapers = res.json()
record("Diaper: Read", res.status_code == 200 and len(diapers) >= 46, f"Initial count: {len(diapers)}")

post_res = session.post(f"{BASE_URL}/api/records/diaper", json={
    "babyId": baby_id,
    "type": "poop",
    "timestamp": "2026-09-15T07:35:00.000Z",
    "poopColor": "yellow",
    "poopConsistency": "soft"
}, headers=HEADERS)
created_diaper = post_res.json()
diaper_id = created_diaper.get("id")
del_res = session.delete(f"{BASE_URL}/api/records/diaper?id={diaper_id}&babyId={baby_id}&baseVersion=1", headers=HEADERS)
record("Diaper: Create & Delete", post_res.status_code == 201 and del_res.status_code == 200, f"Create {post_res.status_code}, Delete {del_res.status_code}")

# 9. Food Logs
res = session.get(f"{BASE_URL}/api/food/logs?babyId={baby_id}")
foods = res.json()
record("Food Logs: Read", res.status_code == 200 and len(foods) == 13, f"Count: {len(foods)}")

# 10. Growth Measurements
res = session.get(f"{BASE_URL}/api/growth?babyId={baby_id}")
growth = res.json()
record("Growth Measurements", res.status_code == 200 and len(growth) == 7, f"Count: {len(growth)}")

# 11. Nutrition Products & Records
res = session.get(f"{BASE_URL}/api/nutrition/products?babyId={baby_id}")
prod_data = res.json()
formulas = prod_data.get("formulas", [])
supplements = prod_data.get("supplements", [])
total_prods = len(formulas) + len(supplements)
res2 = session.get(f"{BASE_URL}/api/nutrition/records?babyId={baby_id}")
rec_data = res2.json()
nutr_records = rec_data.get("records", []) if isinstance(rec_data, dict) else rec_data
record("Nutrition Products", res.status_code == 200 and total_prods == 5, f"Count: {len(formulas)} formulas + {len(supplements)} supplements = {total_prods} products")
record("Nutrition Records", res2.status_code == 200 and len(nutr_records) == 24, f"Count: {len(nutr_records)} supplement records")

# 12. Medical Reports
res = session.get(f"{BASE_URL}/api/medical/reports?babyId={baby_id}")
reports = res.json()
record("Medical Reports", res.status_code == 200 and len(reports) == 2, f"Count: {len(reports)} reports with items")

# 13. Vaccine Selections
res = session.get(f"{BASE_URL}/api/vaccines/selections?babyId={baby_id}")
vaccines = res.json()
completed_vax = [v for v in vaccines if v.get("completed")]
record("Vaccines Selections", res.status_code == 200 and len(completed_vax) == 5, f"Count: {len(completed_vax)} completed doses / {len(vaccines)} schedule doses")

# 14. Daily Summary
res = session.get(f"{BASE_URL}/api/records/daily-summary?babyId={baby_id}&date=2026-09-11")
summary = res.json()
milk_total = summary.get("totalFeedingMl")
sleep_total = summary.get("totalSleepMinutes")
diaper_total = summary.get("diaperCount")
record("Daily Summary", res.status_code == 200 and milk_total == 595 and sleep_total == 790 and diaper_total == 4, f"2026-09-11 milk: {milk_total} ml, sleep: {sleep_total} mins, diapers: {diaper_total}")

# 15. AI Sessions
res = session.get(f"{BASE_URL}/api/ai/sessions?babyId={baby_id}")
ai_data = res.json()
ai_count = ai_data.get("total", len(ai_data.get("sessions", [])))
record("AI Sessions", res.status_code == 200 and ai_count > 0, f"Count: {ai_count} AI sessions")

# Clean up any leftover test diaper record from earlier
cur_diapers = session.get(f"{BASE_URL}/api/records/diaper?babyId={baby_id}&limit=200").json()
for d in cur_diapers:
    if d.get("timestamp", "").startswith("2026-09-15T07:15"):
        session.delete(f"{BASE_URL}/api/records/diaper?id={d.get('id')}&babyId={baby_id}&baseVersion={d.get('version')}", headers=HEADERS)

# Check leftover test feeding record cab2b222-5056-4b46-a23c-68934a8921a4 from direct test
session.delete(f"{BASE_URL}/api/records/feeding?id=cab2b222-5056-4b46-a23c-68934a8921a4&babyId={baby_id}&baseVersion=1", headers=HEADERS)
session.delete(f"{BASE_URL}/api/records/feeding?id=550aaa98-ace6-433b-8956-ddf82c987686&babyId={baby_id}&baseVersion=1", headers=HEADERS)
session.delete(f"{BASE_URL}/api/records/feeding?id=25ad07de-a518-494e-8503-a18c0e7a69bc&babyId={baby_id}&baseVersion=1", headers=HEADERS)

total = len(results)
passed = sum(1 for r in results if r["passed"])
print(f"\n==========================================")
print(f"Final Test Score: {passed}/{total} Passed")
print(f"==========================================")
