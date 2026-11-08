"""Builders for synthetic patients and check-in records used by the tests."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

NOW = datetime(2026, 3, 10, 10, 0, tzinfo=timezone.utc)

SW_KEYS = [
    "seems_different", "talks_less", "needs_more_help", "ate_less", "bowel_change", "drank_less",
    "weight_or_swelling", "agitated", "tired_weak_confused", "skin_change", "walking_toileting_help",
]


def patient(conditions=("hypertension",), meds=(), usual_pain=1) -> dict:
    return {
        "id": "t1", "name": "Test Person", "preferred_name": "Testy", "conditions": list(conditions),
        "medications": [
            {"name": n, "dose": "1", "schedule": "daily", "purpose": "", "med_class": c, "prn": False} for n, c in meds
        ],
        "baseline": {"usual_pain_score": usual_pain, "weight_lb": 170},
        "next_call_time": "tomorrow at 10:00 AM",
    }


def record(days_ago: int = 0, sw=(), cs=None, missed=(), weight=None, oriented=True, pain=None,
           red_flags=(), quote="", phq2=0, prn_more=False, all_taken=None) -> dict:
    t = NOW - timedelta(days=days_ago)
    return {
        "call_id": f"c{days_ago}", "patient_id": "t1", "timestamp": t.isoformat(),
        "red_flags": list(red_flags),
        "stop_and_watch": {k: (k in sw) for k in SW_KEYS},
        "pain": {"present": pain is not None, "location": "", "score": pain, "new_or_worse": None},
        "orientation_correct": oriented,
        "medication_adherence": {
            "all_taken": (not missed) if all_taken is None else all_taken,
            "missed": [{"med": m, "doses_missed": 1, "reason": ""} for m in missed],
            "prn_use_increased": prn_more, "running_low": [],
        },
        "phq2_score": phq2, "condition_specific": dict(cs or {}), "weight_lb": weight,
        "patient_message_for_caregiver": "", "patient_quote": quote, "extraction_confidence": 0.9,
    }


def calm_history(days: int = 14, **kw) -> list[dict]:
    """`days` quiet daily records ending yesterday, oldest first."""
    return [record(days_ago=d, **kw) for d in range(days, 0, -1)]
