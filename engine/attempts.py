"""Missed-call escalation rule. Python stdlib only.

Canonical spec for the rule; src/lib/daytona/attempts.ts mirrors it in-process
so a missed call never waits for a sandbox, and engine/tests checks both stay
in line with these cases.

Rule: count unanswered attempts since the last answered one. On the 3rd
consecutive miss, escalate with an urgent "Unable to reach" alert, unless a
missed-calls alert for this patient is still open.
"""

from __future__ import annotations

ESCALATE_AFTER = 3


def consecutive_missed(attempts: list[dict]) -> int:
    """Trailing unanswered attempts (attempts ordered oldest first)."""
    count = 0
    for attempt in reversed(attempts):
        if attempt.get("answered"):
            break
        count += 1
    return count


def should_escalate(attempts: list[dict], has_open_missed_alert: bool) -> bool:
    return consecutive_missed(attempts) >= ESCALATE_AFTER and not has_open_missed_alert


def missed_call_alert(patient: dict, count: int) -> dict:
    name = patient.get("preferred_name") or patient.get("name") or "the patient"
    return {
        "severity": "urgent",
        "kind": "missed_calls",
        "title": f"Unable to reach after {count} attempts",
        "detail": f"{name} has not answered {count} check-in calls in a row. Please try to reach them or ask someone to check in person.",
        "quote": None,
    }
