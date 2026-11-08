"""Generate data/seed/patients.json: 3 synthetic patients, 14 days each.

Synthetic demo data only. Run from the repo root:  python3 scripts/generate_seed.py

Three severities on load:
  - Rosa (COPD, hypertension): managed. Ran out of her daily inhaler mid-fortnight,
    cough and rescue-inhaler use went up, refilled, back to usual. One missed day of calls.
  - Walt (heart failure, hypertension): in the middle. Missed two days of calls (cardiology
    visit), then skipped his water pill before outings: ankles swelling, weight creeping up.
  - Edie (dementia/MCI, hypertension): very sick. Two days without answering, then new
    confusion, drinking less, burning when she pees, missed pills because she forgot,
    a near fall, and a fever yesterday.

Every alert in the file is produced by running engine/engine.py on that day's call
against the calls before it, exactly as the app does after a live call. Older alerts are
marked acknowledged or resolved with a synthetic nurse note; recent ones stay open.
"""

from __future__ import annotations

import copy
import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "engine"))
from engine import analyze  # noqa: E402
from attempts import consecutive_missed, missed_call_alert, should_escalate  # noqa: E402

SEED = os.path.join(ROOT, "data", "seed", "patients.json")
ANCHOR = datetime(2026, 1, 15, tzinfo=timezone.utc)  # "today"; day 14 = yesterday
SW_KEYS = ["seems_different", "talks_less", "needs_more_help", "ate_less", "bowel_change", "drank_less",
           "weight_or_swelling", "agitated", "tired_weak_confused", "skin_change", "walking_toileting_help"]


def day_time(day: int, hhmm: str, plus_min: int = 0) -> str:
    h, m = map(int, hhmm.split(":"))
    t = ANCHOR - timedelta(days=15 - day) + timedelta(hours=h, minutes=m + plus_min)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def rec(pid: str, day: int, hhmm: str, *, sw=(), cs=None, missed=(), weight=None, oriented=True, pain=0,
        prn_more=False, low=(), quote="", msg="", phq2=0) -> dict:
    return {
        "call_id": f"seed-{pid}-d{day}", "patient_id": pid, "timestamp": day_time(day, hhmm),
        "red_flags": [],
        "stop_and_watch": {k: (k in sw) for k in SW_KEYS},
        "pain": {"present": pain > 0, "location": "", "score": pain, "new_or_worse": False},
        "orientation_correct": oriented,
        "medication_adherence": {
            "all_taken": not missed,
            "missed": [{"med": m, "doses_missed": n, "reason": r} for m, n, r in missed],
            "prn_use_increased": prn_more, "running_low": list(low),
        },
        "phq2_score": phq2, "condition_specific": dict(cs or {}), "weight_lb": weight,
        "patient_message_for_caregiver": msg, "patient_quote": quote, "extraction_confidence": 0.9,
    }


# ---------- day plans (None = no answer to any of the 3 attempts that day) ----------

def rosa_days():
    p = "p1"; t = "10:00"
    days = {}
    for d in range(1, 15):
        days[d] = rec(p, d, t, weight=143.0, quote="Still kicking, dear.")
    days[5] = None
    days[7] = rec(p, 7, t, weight=143.0, missed=[("Tiotropium", 1, "ran out, refill not picked up")], low=["Tiotropium"],
                  quote="I'm out of my morning puffer.")
    days[8] = rec(p, 8, t, weight=143.0, missed=[("Tiotropium", 1, "ran out")], cs={"cough_worse": True},
                  prn_more=True, quote="This cough is back, I've used the blue one twice.")
    days[9] = rec(p, 9, t, weight=143.5, missed=[("Tiotropium", 1, "pharmacy delivers tomorrow")],
                  cs={"cough_worse": True, "sputum_change": True, "rescue_inhaler_more": True}, prn_more=True,
                  sw=("tired_weak_confused",), quote="Coughing up some yellow stuff, I'm tired.")
    days[10] = rec(p, 10, t, weight=143.0, cs={"cough_worse": True}, quote="Refill came, feeling a bit better.")
    days[11] = rec(p, 11, t, weight=143.0, quote="Cough's settling down.")
    return days


def walt_days():
    p = "p2"; t = "09:30"
    days = {}
    w = {1: 178, 2: 178, 3: 178.5, 5: 178, 6: 178, 7: 178.5, 8: 178, 9: 178, 10: 178.5, 11: 179, 12: 180.5, 13: 182, 14: 183.5}
    for d in range(1, 15):
        days[d] = rec(p, d, t, weight=w.get(d), quote="Same old, same old.")
    days[4] = None
    days[5] = rec(p, 5, t, weight=178, quote="Sorry I missed you, I was at the heart doctor.")
    days[10] = rec(p, 10, t, weight=178.5, missed=[("Lisinopril", 1, "forgot, busy morning")], quote="Forgot one pill, no big deal.")
    days[12] = rec(p, 12, t, weight=180.5, missed=[("Furosemide", 1, "going out, didn't want bathroom trips")],
                   quote="Skipped the water pill, I had lunch with friends.")
    days[13] = rec(p, 13, t, weight=182, sw=("weight_or_swelling",), cs={"ankle_swelling": True},
                   missed=[("Furosemide", 1, "church in the morning")], quote="Shoes are a bit tight today.")
    days[14] = rec(p, 14, t, weight=183.5, sw=("weight_or_swelling",), cs={"ankle_swelling": True, "pillows": 3},
                   missed=[("Furosemide", 1, "didn't want to be running to the bathroom")],
                   msg="Don't worry, it's just my feet.", quote="My ankles are puffy again.")
    return days


def edie_days():
    p = "p3"; t = "11:00"
    days = {}
    for d in range(1, 15):
        days[d] = rec(p, d, t, weight=121.0, quote="Oh, is it you again? Lovely.")
    days[9] = None
    days[10] = None
    days[11] = rec(p, 11, t, weight=120.5, sw=("seems_different", "drank_less"), cs={"urinary_frequency": True},
                   quote="I keep having to go to the loo.")
    days[12] = rec(p, 12, t, weight=120.0, oriented=False, sw=("seems_different", "drank_less", "tired_weak_confused"),
                   cs={"urinary_burning": True, "new_confusion": True},
                   missed=[("Donepezil", 1, "forgot"), ("Amlodipine", 1, "forgot")],
                   quote="Is it Sunday? I can't find my pills.")
    days[13] = rec(p, 13, t, weight=119.5, oriented=False,
                   sw=("seems_different", "drank_less", "tired_weak_confused", "needs_more_help", "walking_toileting_help"),
                   cs={"urinary_burning": True, "new_confusion": True, "near_fall": True},
                   missed=[("Donepezil", 1, "forgot")],
                   quote="I nearly went over in the kitchen, but I'm fine.")
    days[14] = rec(p, 14, t, weight=119.0, oriented=False,
                   sw=("seems_different", "drank_less", "ate_less", "tired_weak_confused", "agitated",
                       "needs_more_help", "walking_toileting_help"),
                   cs={"urinary_burning": True, "new_confusion": True, "fever": True},
                   missed=[("Donepezil", 1, "forgot"), ("Amlodipine", 1, "forgot")],
                   msg="Tell Paul I'm not hungry.", quote="It burns when I go and I'm not sure what day it is.")
    return days


# Synthetic nurse follow-up on alerts older than the last two days.
NOTES = {
    ("p1", "missed_calls"): ("resolved", "Reached Rosa at 2 pm: she was at her granddaughter's recital. All fine."),
    ("p1", "pattern"): ("resolved", "Pharmacy delivered the Tiotropium refill on day 10. Cough back to usual; will watch."),
    ("p2", "missed_calls"): ("resolved", "Maria says he was at his cardiology appointment all day."),
    ("p3", "missed_calls"): ("acknowledged", "Paul visited: Edie was napping with the phone unplugged. He'll check on her daily."),
}


def build(patient: dict, days: dict[int, dict | None], call_time: str) -> dict:
    history, attempts, alerts = [], [], []
    nurse, caregiver = patient["nurse"]["name"], patient["caregiver"]["name"]

    def add_alert(a: dict, day: int, idx: int) -> None:
        # A repeated alert keeps only its latest occurrence (the nurse sees one card per issue).
        key = (a["kind"], a["title"])
        alerts[:] = [x for x in alerts if (x["kind"], x["title"]) != key]
        at = day_time(day, call_time, 5)
        status, note = ("open", None)
        if day <= 12:
            status, note = NOTES.get((patient["id"], a["kind"]), ("resolved", "Reviewed by the nurse; back to usual."))
        alerts.append({
            "id": f"seed-{patient['id']}-d{day}-{idx}", "patient_id": patient["id"],
            "severity": a["severity"], "kind": a["kind"], "title": a["title"], "detail": a["detail"],
            "quote": a.get("quote") or None, "created_at": at, "status": status,
            "acknowledged_by": nurse if status != "open" else None,
            "notes": [f"{nurse}: {note}"] if note else [],
            "sms_log": [
                {"to": "nurse", "name": nurse, "at": at,
                 "text": f"Still Kicking {a['severity'].upper()}: {a['title']} ({patient['preferred_name']}). Please follow up today."},
                {"to": "caregiver", "name": caregiver, "at": at,
                 "text": f"Still Kicking {a['severity'].upper()}: {a['title']} ({patient['preferred_name']}). The nurse has been alerted and will follow up today."},
            ],
        })

    for day in range(1, 15):
        r = days[day]
        if r is None:
            for k in range(3):
                attempts.append({"patient_id": patient["id"], "at": day_time(day, call_time, 15 * k), "answered": False})
                open_missed = any(a["kind"] == "missed_calls" and a["status"] != "resolved" for a in alerts)
                if should_escalate(attempts, open_missed):
                    add_alert(missed_call_alert(patient, consecutive_missed(attempts)), day, 90 + k)
            continue
        attempts.append({"patient_id": patient["id"], "at": r["timestamp"], "answered": True})
        out = analyze(patient, copy.deepcopy(history), r)
        for i, a in enumerate(out["alerts"]):
            add_alert(a, day, i)
        history.append(r)

    alerts.sort(key=lambda a: a["created_at"], reverse=True)
    return {"patient": patient, "history": history, "attempts": attempts, "alerts": alerts}


def main() -> None:
    seed = json.load(open(SEED))
    by_id = {p["patient"]["id"]: p["patient"] for p in seed["patients"]}
    plans = {"p1": (rosa_days(), "10:00"), "p2": (walt_days(), "09:30"), "p3": (edie_days(), "11:00")}
    out = {
        "anchor": ANCHOR.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("Synthetic demo data only, generated by scripts/generate_seed.py. Timestamps are shifted at load so "
                 "the last seeded day is yesterday. Every alert was produced by running engine/engine.py on that day's call."),
        "patients": [build(by_id[pid], days, t) for pid, (days, t) in plans.items()],
    }
    json.dump(out, open(SEED, "w"), indent=2)
    open(SEED, "a").write("\n")
    for p in out["patients"]:
        opened = [a["title"] for a in p["alerts"] if a["status"] == "open"]
        closed = [a["title"] for a in p["alerts"] if a["status"] != "open"]
        print(p["patient"]["preferred_name"], f"{len(p['history'])} calls,",
              sum(1 for a in p["attempts"] if not a["answered"]), "missed attempts")
        print("   open:", opened)
        print("   closed:", closed)


if __name__ == "__main__":
    main()
