#!/bin/sh
# Demo data for the App Store screenshots (docs/release.md), through the local API only, synthetic names and
# 98000 00xxx-style numbers. Idempotent where it can be: the patient history is built once (it skips when the
# patient already has three closed visits), today's appointments and the desk task are added only when missing,
# and one walk-in is queued for Dr Rao when the patient has no token waiting (the visit shot starts it).
# Prints STORE_PATIENT / STORE_TOKEN lines and writes them to build/store-seed.env for store-shots.sh.
#   API (default http://localhost:8090), CLINIC_HOST (default sunrise.localtest.me:8090)
set -eu
cd "$(dirname "$0")/.."
mkdir -p build
exec python3 -I - "$@" <<'PY'
import json, os, sys, urllib.request, urllib.error, datetime, uuid

API = os.environ.get("API", "http://localhost:8090")
HOST = os.environ.get("CLINIC_HOST", "sunrise.localtest.me:8090")
UID = "a1a1a1a1-0000-4000-8000-00000000000%d"
DR_RAO = "01920000-0000-7000-8000-00000000d101"
DESK_UID = UID % 3

def call(method, path, token=None, body=None, base=None, ok=(200, 201, 204)):
    url = (base or f"http://{HOST}") + path
    req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("content-type", "application/json")
    if token: req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code} {e.read().decode()[:400]}")

def token(n):
    return call("POST", "/api/v1/dev/token", body={"auth_uid": UID % n}, base=API)["access_token"]

doc, desk, owner = token(2), token(3), token(1)
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
today = datetime.datetime.now(IST).date()  # the clinic day, not this machine's

# --- the patient: an adult with a few finished visits -------------------------------------------------
NAME = "Meera Joshi"
found = [p for p in call("POST", "/api/v1/patients/search", doc, {"q": NAME})["items"] if p["full_name"] == NAME]
patient = found[0]["id"] if found else call("POST", "/api/v1/patients", desk, {
    "full_name": NAME, "phone": "9800000123", "sex": "female", "date_of_birth": "1984-03-12", "preferred_language": "en-IN"})["id"]
# The visit shot starts a visit for a second patient, so this one's history stays clean between runs.
kavya = next(p for p in call("POST", "/api/v1/patients/search", doc, {"q": "Kavya Iyer"})["items"] if p["full_name"] == "Kavya Iyer")["id"]

def closed_visits():
    v = call("GET", f"/api/v1/patients/{patient}/visits", doc)
    return [x for x in v.get("items", v if isinstance(v, list) else []) if x.get("status") == "closed"]

HISTORY = [
    dict(complaint="Pain on chewing, lower right", s="Dull ache lower right for two weeks, worse with sweets.",
         o="Deep caries on 46 (MO). Tender to percussion: no.", a="Reversible pulpitis, 46.", p="Composite filling 46, review caries on 16.",
         procedures=[("Composite filling", 46, ["M", "O"], 150000)],
         chart=[dict(tooth=46, finding="filled", surface="O", procedure="filling"), dict(tooth=16, finding="caries", surface="O")],
         note="Review in two weeks"),
    dict(complaint="Sensitivity to cold, lower left", s="Sharp pain to cold on the lower left, lingering.",
         o="Deep caries on 36, vitality test positive and lingering.", a="Irreversible pulpitis, 36.", p="Root canal 36, then crown.",
         procedures=[("Root canal treatment", 36, [], 600000), ("Composite filling", 16, ["O"], 120000)],
         chart=[dict(tooth=36, finding="root_canal", canals=[{"name": "MB", "working_length_mm": 20.5}, {"name": "ML", "working_length_mm": 20.0}, {"name": "D", "working_length_mm": 19.5}]),
                dict(tooth=16, finding="filled", surface="O", procedure="filling"), dict(tooth=47, finding="watch", note="Early fissure caries")],
         note="Crown prep next"),
    dict(complaint="Crown fitting for 36", s="No pain after the root canal.", o="36 obturated, sound. Occlusion checked.", a="Ready for a crown.",
         p="Zirconia crown 36; scaling; recall in six months.",
         procedures=[("Zirconia crown", 36, [], 850000), ("Scaling and polishing", None, [], 100000)],
         chart=[dict(tooth=36, finding="crown", material="zirconia", procedure="crown"), dict(tooth=18, finding="missing"), dict(tooth=26, finding="watch", note="Hairline crack, monitor")],
         note=None),
]

def visit_history():
    if len(closed_visits()) >= 3:
        print("seed: history exists"); return
    for i, h in enumerate(HISTORY):
        v = call("POST", f"/api/v1/patients/{patient}/visits", doc, {"chief_complaint": h["complaint"]})
        vid = v["id"]
        call("POST", f"/api/v1/visits/{vid}/notes", doc, {"kind": "soap", "sections": {"subjective": h["s"], "objective": h["o"], "assessment": h["a"], "plan": h["p"]}})
        for name, tooth, surfaces, price in h["procedures"]:
            body = {"name": name, "surfaces": surfaces, "price_paise": price}
            if tooth: body["tooth"] = tooth
            call("POST", f"/api/v1/visits/{vid}/procedures", doc, body)
        call("POST", f"/api/v1/patients/{patient}/dental-chart", doc, {"visit_id": vid, "entries": h["chart"]})
        last = i == len(HISTORY) - 1
        if last:
            rx = call("POST", f"/api/v1/patients/{patient}/prescriptions", doc, {
                "encounter_id": vid, "diagnosis_text": "Post-crown care, mild gingivitis",
                "advice": "Soft food for a day. Rinse with warm salt water. Avoid hard food on the right-hand side.",
                "follow_up_on": (today + datetime.timedelta(days=14)).isoformat(),
                "items": [
                    {"drug_name": "AMOXICILLIN", "strength": "500 mg", "form": "capsule", "dose": "1 capsule", "frequency": "1-1-1", "duration_days": 5, "timing": "after_food"},
                    {"drug_name": "IBUPROFEN", "strength": "400 mg", "form": "tablet", "dose": "1 tablet", "frequency": "1-0-1", "duration_days": 3, "timing": "after_food"},
                    {"drug_name": "CHLORHEXIDINE MOUTHWASH", "strength": "0.2%", "form": "mouthwash", "dose": "10 ml", "frequency": "1-0-1", "duration_days": 7, "timing": "as_directed"},
                ]})
            call("POST", f"/api/v1/visits/{vid}/finish", doc, {
                "prescription": {"id": rx["id"], "notify_patient": False}, "follow_up_on": (today + datetime.timedelta(days=14)).isoformat(),
                "note": "Review the crown and gums", "fee_paise": 950000})
        else:
            call("POST", f"/api/v1/visits/{vid}/close", doc, {"note": h["note"]} if h["note"] else None)
        print(f"seed: visit {i + 1} closed")

visit_history()
# A visit left open by an earlier screenshot run would show as "Open" in the history; close it.
v = call("GET", f"/api/v1/patients/{kavya}/visits", doc)
for x in v.get("items", []):
    if x.get("status") == "open":
        call("POST", f"/api/v1/visits/{x['id']}/close", doc, None)
        print("seed: closed a stale open visit")

# --- team chat: a few messages so the thread is not empty (client ids make the posts idempotent) ---------
chan = next(c for c in call("GET", "/api/v1/conversations", owner)["items"] if c["title"] == "Everyone")["id"]
CHAT = [(doc, "Meera Joshi's crown on 36 is ready to fit this afternoon."),
        (desk, "Noted. Chair 1 is free from 2 pm, I will keep the slot for her."),
        (owner, "Thanks both. Lab says the bridge for Rahul Verma ships on Thursday."),
        (desk, "I will call Rahul to book the fitting for next week."),
        (doc, "Please send the Rx reminder to Priya Sharma after her check-up.")]
for who, text in CHAT:
    call("POST", f"/api/v1/conversations/{chan}/messages", who, {"client_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "store-seed/" + text)), "body": text})

# --- today: Dr Rao's appointments (other patients) and one desk task ------------------------------------
def at(h, m): return datetime.datetime(today.year, today.month, today.day, h, m, tzinfo=IST).isoformat()
existing = call("GET", f"/api/v1/appointments?from={today}&to={today}", desk)
rows = existing.get("items", [])
have = {a["patient"]["full_name"] for a in rows if a.get("practitioner", {}).get("id") == DR_RAO} if rows else set()
SLOTS = [("Priya Sharma", 10, 0, "Check-up and cleaning"), ("Arjun Nair", 11, 30, "Root canal, sitting 2"),
         ("Sneha Patil", 14, 0, "Braces adjustment"), ("Rahul Verma", 16, 30, "Crown fitting")]
for name, h, m, reason in SLOTS:
    if name in have: continue
    pid = next(p for p in call("POST", "/api/v1/patients/search", desk, {"q": name})["items"] if p["full_name"] == name)["id"]
    call("POST", "/api/v1/appointments", desk, {"patient_id": pid, "practitioner_id": DR_RAO, "starts_at": at(h, m), "reason": reason})
    print("seed: appointment", name)

tasks = call("GET", "/api/v1/tasks", owner)
if not any(t.get("title") == "Confirm tomorrow's appointments" for t in tasks.get("items", [])):
    farah = next(m for m in call("GET", "/api/v1/staff", owner)["members"] if m["display_name"] == "Farah Shaikh")["id"]
    call("POST", "/api/v1/tasks", owner, {"title": "Confirm tomorrow's appointments", "description": "Call or message everyone booked tomorrow.",
        "assignee_membership_id": farah, "schedule": {"kind": "daily", "due_time": "17:00"}})
    print("seed: task")

# --- walk-ins for Dr Rao today; the visit shot starts Kavya's token --------------------------------------
WALKINS = [(kavya, "Sensitivity to cold, lower left"), (None, "Scaling"), (None, "Crown check, pain on biting")]
queue = call("GET", "/api/v1/queue", desk)["items"]
def waiting_for(pid): return [t for t in queue if t["patient"]["id"] == pid and t["status"] in ("waiting", "called")]
for pid, reason in WALKINS:
    if pid is None:
        pid = next(p for p in call("POST", "/api/v1/patients/search", desk, {"q": "Rahul Verma" if reason == "Scaling" else "Rohan Deshmukh"})["items"])["id"]
    if not waiting_for(pid):
        call("POST", "/api/v1/walk-ins", desk, {"patient_id": pid, "practitioner_id": DR_RAO, "reason": reason, "no_known_allergies": True})
        queue = call("GET", "/api/v1/queue", desk)["items"]
        print("seed: walk-in", reason)
tok = str(waiting_for(kavya)[0]["token_number"])
open("build/store-seed.env", "w").write(f"STORE_PATIENT={patient}\nSTORE_TOKEN={tok}\n")
print(f"STORE_PATIENT={patient}\nSTORE_TOKEN={tok}")
PY
