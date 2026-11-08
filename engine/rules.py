"""Clinical-signal rules for Still Kicking. Python stdlib only.

Everything here flags changes for a nurse to review. Nothing here diagnoses,
and nothing here suggests a medication change. Inputs follow the CheckinRecord
and Patient shapes in src/lib/types.ts.
"""

from __future__ import annotations

from datetime import datetime, timedelta

# ---------- red flags ----------

# Types that are always an emergency, whatever severity the voice agent sent.
EMERGENCY_TYPES = {"chest_pain", "breathing", "stroke_signs", "fainting", "bleeding", "safety"}

# Safety net: phrases in the patient's own words that mean "call 911" even if
# the agent did not file a red flag.
EMERGENCY_PHRASES = {
    "chest pain": "chest_pain",
    "chest hurts": "chest_pain",
    "pressure in my chest": "chest_pain",
    "can't breathe": "breathing",
    "cannot breathe": "breathing",
    "can't catch my breath": "breathing",
    "face is drooping": "stroke_signs",
    "can't lift my arm": "stroke_signs",
    "slurred": "stroke_signs",
    "passed out": "fainting",
    "fainted": "fainting",
    "blacked out": "fainting",
    "won't stop bleeding": "bleeding",
    "coughing up blood": "bleeding",
    "end my life": "safety",
    "kill myself": "safety",
}

RED_FLAG_LABELS = {
    "chest_pain": "Chest pain",
    "breathing": "Trouble breathing",
    "fall": "Fall",
    "stroke_signs": "Possible stroke signs",
    "fainting": "Fainting",
    "bleeding": "Bleeding",
    "safety": "Safety concern",
    "confusion": "Sudden confusion",
    "other": "Red flag",
}

SEVERITY_RANK = {"watch": 0, "urgent": 1, "emergency": 2}


def red_flag_title(flag_type: str) -> str:
    return f"{RED_FLAG_LABELS.get(flag_type, 'Red flag')} reported during call"


def red_flags(record: dict) -> list[dict]:
    """Red flags from the record plus any emergency phrase in the patient's words.

    Returns [{type, quote, severity}] with severity raised to "emergency" for
    EMERGENCY_TYPES. Never lowers a severity the agent sent.
    """
    out: dict[str, dict] = {}
    for flag in record.get("red_flags") or []:
        ftype = str(flag.get("type") or "other")
        severity = flag.get("severity") if flag.get("severity") in SEVERITY_RANK else "urgent"
        if ftype in EMERGENCY_TYPES:
            severity = "emergency"
        current = out.get(ftype)
        if current is None or SEVERITY_RANK[severity] > SEVERITY_RANK[current["severity"]]:
            out[ftype] = {"type": ftype, "quote": str(flag.get("quote") or ""), "severity": severity}

    text = " ".join(
        str(record.get(k) or "") for k in ("patient_quote", "patient_message_for_caregiver")
    ).lower()
    for phrase, ftype in EMERGENCY_PHRASES.items():
        if phrase in text and ftype not in out:
            out[ftype] = {"type": ftype, "quote": record.get("patient_quote") or phrase, "severity": "emergency"}
    return list(out.values())


# ---------- signals per record ----------

SW_LABELS = {
    "seems_different": "seems different than usual",
    "talks_less": "talking less",
    "needs_more_help": "needs more help",
    "ate_less": "eating less",
    "bowel_change": "bowel changes",
    "drank_less": "drinking less",
    "weight_or_swelling": "weight change or swelling",
    "agitated": "agitated",
    "tired_weak_confused": "tired, weak or confused",
    "skin_change": "skin changes",
    "walking_toileting_help": "needs help walking or toileting",
}


def _cs(record: dict, key: str):
    return (record.get("condition_specific") or {}).get(key)


def _sw(record: dict, key: str) -> bool:
    return (record.get("stop_and_watch") or {}).get(key) is True


def _truthy(value) -> bool:
    return value is True or (isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0)


def is_confused(record: dict) -> bool:
    return record.get("orientation_correct") is False or _sw(record, "tired_weak_confused") or _cs(record, "new_confusion") is True


def has_urinary(record: dict) -> bool:
    return any(_cs(record, k) is True for k in ("urinary_burning", "urinary_frequency", "urinary_symptoms"))


def has_swelling(record: dict) -> bool:
    return _sw(record, "weight_or_swelling") or _cs(record, "ankle_swelling") is True or _cs(record, "swelling") is True


def has_cough_signs(record: dict) -> bool:
    return any(_cs(record, k) is True for k in ("cough_worse", "sputum_change", "rescue_inhaler_more"))


def used_more_prn(record: dict) -> bool:
    return (record.get("medication_adherence") or {}).get("prn_use_increased") is True or _cs(record, "rescue_inhaler_more") is True


def had_fall(record: dict) -> bool:
    return _cs(record, "fall") is True or _cs(record, "near_fall") is True or any(
        (f or {}).get("type") == "fall" for f in record.get("red_flags") or []
    )


def low_mood(record: dict) -> bool:
    phq2 = record.get("phq2_score")
    return (isinstance(phq2, (int, float)) and phq2 >= 3) or _cs(record, "low_mood") is True


# ---------- time helpers ----------


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def window(history: list[dict], record: dict, n: int = 3) -> list[dict]:
    """The last n calls including the new record, oldest first."""
    return (list(history) + [record])[-n:]


# ---------- trend rules ----------


def has_heart_failure(patient: dict) -> bool:
    return any("heart failure" in str(c).lower() for c in patient.get("conditions") or [])


def weight_gain(history: list[dict], record: dict) -> dict:
    """Day-over-day and 7-day weight change from logged weights (lb)."""
    points = []
    for r in list(history) + [record]:
        w = r.get("weight_lb")
        if isinstance(w, (int, float)) and not isinstance(w, bool):
            points.append((parse_ts(r["timestamp"]), float(w)))
    result = {"daily": None, "weekly": None}
    if len(points) < 2:
        return result
    now_t, now_w = points[-1]
    prev_t, prev_w = points[-2]
    if now_t - prev_t <= timedelta(hours=36):
        result["daily"] = round(now_w - prev_w, 1)
    week_ago = [p for p in points[:-1] if now_t - p[0] >= timedelta(days=6)]
    if week_ago:
        result["weekly"] = round(now_w - week_ago[-1][1], 1)
    return result


def trend_flags(patient: dict, history: list[dict], record: dict) -> list[str]:
    flags: list[str] = []
    recent = window(history, record)
    n = len(recent)

    for key, label in SW_LABELS.items():
        hits = sum(1 for r in recent if _sw(r, key))
        if hits >= 2:
            flags.append(f"{label}: positive on {hits} of last {n} calls")

    baseline_pain = (patient.get("baseline") or {}).get("usual_pain_score") or 0
    pain = (record.get("pain") or {}).get("score")
    if isinstance(pain, (int, float)) and pain - baseline_pain >= 2:
        flags.append(f"pain {pain}/10, usual is {baseline_pain}/10")

    if is_new_confusion(history, record):
        flags.append("new confusion compared with usual")

    if has_heart_failure(patient):
        gain = weight_gain(history, record)
        if gain["daily"] is not None and gain["daily"] > 2:
            flags.append(f"weight up {gain['daily']} lb since yesterday")
        if gain["weekly"] is not None and gain["weekly"] > 5:
            flags.append(f"weight up {gain['weekly']} lb this week")

    prn_hits = sum(1 for r in recent if used_more_prn(r))
    if prn_hits >= 2:
        flags.append(f"as-needed medicine used more on {prn_hits} of last {n} calls")

    phq2 = record.get("phq2_score")
    if isinstance(phq2, (int, float)) and phq2 >= 3:
        flags.append(f"mood screen (PHQ-2) score {int(phq2)} of 6")
    return flags


def is_new_confusion(history: list[dict], record: dict) -> bool:
    """Confused today while the earlier baseline period was mostly clear."""
    if not is_confused(record):
        return False
    earlier = list(history)[:-2] or list(history)
    if not earlier:
        return True
    confused_before = sum(1 for r in earlier if is_confused(r))
    return confused_before / len(earlier) < 0.5


# ---------- pattern clusters ----------

# Each cluster: name, med classes whose missed doses can explain it, and the
# component checks. A component is "present" if positive today or on 2+ of the
# last 3 calls.
CLUSTERS = [
    {
        "pattern": "possible urinary infection, delirium or dehydration",
        "med_classes": [],
        "components": [("new confusion", is_confused), ("drinking less", lambda r: _sw(r, "drank_less")), ("urinary burning or frequency", has_urinary)],
    },
    {
        "pattern": "possible heart failure worsening",
        "med_classes": ["diuretic", "heart"],
        "components": [("swelling", has_swelling), ("weight gain", None), ("short of breath lying flat", lambda r: _cs(r, "sob_lying_flat") is True)],
    },
    {
        "pattern": "possible COPD flare",
        "med_classes": ["inhaler"],
        "components": [("cough worse", lambda r: _cs(r, "cough_worse") is True), ("sputum change", lambda r: _cs(r, "sputum_change") is True), ("using rescue inhaler more", used_more_prn)],
    },
    {
        "pattern": "possible dehydration, low blood pressure or medicine side effect",
        "med_classes": ["bp", "diuretic"],
        "components": [("dizzy on standing", lambda r: _cs(r, "dizzy_standing") is True), ("eating or drinking less", lambda r: _sw(r, "ate_less") or _sw(r, "drank_less"))],
    },
    {
        "pattern": "possible depression",
        "med_classes": [],
        "components": [("low mood", low_mood), ("talking less", lambda r: _sw(r, "talks_less")), ("eating less", lambda r: _sw(r, "ate_less"))],
    },
    {
        "pattern": "rising fall risk",
        "med_classes": [],
        "components": [("needs more help walking", lambda r: _sw(r, "needs_more_help") or _sw(r, "walking_toileting_help")), ("fall or near fall", had_fall)],
    },
]


def _present(recent: list[dict], check) -> int:
    """Number of recent calls with the sign; 0 unless positive today or on 2+ calls."""
    hits = sum(1 for r in recent if check(r))
    today = check(recent[-1])
    return hits if (today or hits >= 2) else 0


def _hf_weight_gain(patient: dict, history: list[dict], record: dict) -> str | None:
    gain = weight_gain(history, record)
    if gain["daily"] is not None and gain["daily"] > 2:
        return f"weight up {gain['daily']} lb since yesterday"
    if gain["weekly"] is not None and gain["weekly"] > 5:
        return f"weight up {gain['weekly']} lb this week"
    reported = _cs(record, "weight_gain_lb")
    if isinstance(reported, (int, float)) and not isinstance(reported, bool) and reported >= 2:
        return f"reports gaining {reported} lb"
    return None


def pattern_clusters(patient: dict, history: list[dict], record: dict) -> list[dict]:
    recent = window(history, record)
    n = len(recent)
    found = []
    for cluster in CLUSTERS:
        evidence = []
        for name, check in cluster["components"]:
            if check is None:  # weight gain uses logged weights, not a per-record flag
                gain = _hf_weight_gain(patient, history, record)
                if gain:
                    evidence.append(gain)
                continue
            hits = _present(recent, check)
            if hits:
                evidence.append(f"{name} on {hits} of last {n} calls")
        total = len(cluster["components"])
        needed = 2 if total >= 2 else 1
        if len(evidence) >= needed:
            severity = "urgent" if len(evidence) == total else "watch"
            found.append({"pattern": cluster["pattern"], "med_classes": cluster["med_classes"], "evidence": evidence, "severity": severity})
    return found


# ---------- medication attribution ----------


def missed_in_window(patient: dict, history: list[dict], record: dict, hours: int = 72) -> dict[str, dict]:
    """Missed doses per medication in the `hours` before (and including) this call.

    Returns {med_name: {"med_class", "doses", "days"}} matched against the
    patient's medication list (case-insensitive, by name prefix).
    """
    meds = {m["name"].lower(): m for m in patient.get("medications") or []}
    now = parse_ts(record["timestamp"])
    out: dict[str, dict] = {}
    for r in list(history) + [record]:
        t = parse_ts(r["timestamp"])
        if not (now - timedelta(hours=hours) <= t <= now):
            continue
        for miss in (r.get("medication_adherence") or {}).get("missed") or []:
            said = str(miss.get("med") or "").lower().strip()
            med = meds.get(said) or next((m for name, m in meds.items() if said and (name.startswith(said) or said.startswith(name))), None)
            if med is None:
                continue
            entry = out.setdefault(med["name"], {"med_class": med["med_class"], "doses": 0, "days": 0})
            entry["doses"] += max(1, int(miss.get("doses_missed") or 1))
            entry["days"] += 1
    return out


def attribute(patient: dict, history: list[dict], record: dict, cluster: dict) -> tuple[str, str]:
    """(attribution, one-sentence reason) for a worsening pattern."""
    classes = set(cluster.get("med_classes") or [])
    missed = missed_in_window(patient, history, record)
    related = {name: m for name, m in missed.items() if m["med_class"] in classes}
    if related:
        name, m = max(related.items(), key=lambda kv: kv[1]["doses"])
        days = "day" if m["days"] == 1 else "days"
        return (
            "likely_adherence_related",
            f"{name} ({m['med_class']}) was missed on {m['days']} {days} in the last 72 hours, which can explain these signs.",
        )
    adherence = (record.get("medication_adherence") or {}).get("all_taken")
    if classes and adherence is None:
        return ("unclear", "We could not confirm whether the related medicines were taken.")
    if classes:
        return ("likely_clinical_change", "Related medicines were reported taken, so this looks like a change in health.")
    return ("likely_clinical_change", "No medicine explains these signs and they are new compared with the usual pattern.")
