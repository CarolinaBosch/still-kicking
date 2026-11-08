"""Plain-language caregiver summary. Python stdlib only.

Never a diagnosis and never medication advice: patterns are phrased as signs
the nurse will review. The whole summary stays under 150 words.
"""

from __future__ import annotations

MAX_WORDS = 150


def _words(summary: dict) -> int:
    parts = [summary["today"], summary["medications"], summary["in_their_words"], summary["next_call"]]
    parts += summary["what_changed"] + summary["patterns_to_watch"]
    return sum(len(str(p).split()) for p in parts)


def _medication_line(record: dict) -> str:
    adherence = record.get("medication_adherence") or {}
    missed = adherence.get("missed") or []
    low = adherence.get("running_low") or []
    if missed:
        names = ", ".join(sorted({str(m.get("med")) for m in missed if m.get("med")}))
        line = f"Said they missed {names}."
    elif adherence.get("all_taken") is True:
        line = "Said they took all their medicines."
    else:
        line = "We could not confirm medicines today."
    if low:
        line += f" Running low on {', '.join(low)}."
    return line


def build_summary(patient: dict, record: dict, status: str, flags: list[str], findings: list[dict], red: list[dict]) -> dict:
    name = patient.get("preferred_name") or patient.get("name") or "Your family member"
    declined = (record.get("condition_specific") or {}).get("checkin_declined") is True
    if red:
        today = f"{name} reported something urgent during today's call and the care team was alerted."
    elif declined:
        today = f"{name} asked to keep today's check-in short, so only a few questions were answered. The nurse may want to follow up."
    elif status == "red":
        today = f"{name} talked with us today and some changes need the nurse's attention soon."
    elif status == "yellow":
        today = f"{name} talked with us today; a few changes are worth watching."
    else:
        today = f"{name} talked with us today and sounded like their usual self."

    summary = {
        "status": status,
        "today": today,
        "what_changed": flags[:4],
        "medications": _medication_line(record),
        "patterns_to_watch": [f"Signs that can go with {f['pattern']}; the nurse will review." for f in findings[:3]],
        "in_their_words": str(record.get("patient_quote") or record.get("patient_message_for_caregiver") or "")[:200],
        "next_call": f"Next check-in {patient.get('next_call_time') or 'tomorrow'}.",
    }
    while _words(summary) > MAX_WORDS and (summary["what_changed"] or summary["patterns_to_watch"]):
        key = "what_changed" if len(summary["what_changed"]) >= len(summary["patterns_to_watch"]) else "patterns_to_watch"
        summary[key] = summary[key][:-1]
    if _words(summary) > MAX_WORDS:
        summary["in_their_words"] = " ".join(summary["in_their_words"].split()[:20])
    return summary
