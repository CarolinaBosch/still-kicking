"""Still Kicking check-in engine. Python stdlib only.

Runs inside a fresh Daytona sandbox after every finished call:

    python3 -B engine.py input.json

input.json: {"patient": Patient, "history": [CheckinRecord, oldest first],
             "record": CheckinRecord}
stdout: one line "__STILL_KICKING__" + JSON with findings, trend flags,
caregiver summary, status and alert drafts. The host treats that JSON as
untrusted and validates it (src/lib/daytona/engine-output.ts).
"""

from __future__ import annotations

import json
import sys

from rules import SEVERITY_RANK, attribute, pattern_clusters, red_flag_title, red_flags, trend_flags
from summary import build_summary

OUTPUT_MARKER = "__STILL_KICKING__"


def analyze(patient: dict, history: list[dict], record: dict) -> dict:
    red = red_flags(record)
    flags = trend_flags(patient, history, record)

    findings = []
    for cluster in pattern_clusters(patient, history, record):
        attribution, reason = attribute(patient, history, record, cluster)
        findings.append({
            "pattern": cluster["pattern"],
            "evidence": cluster["evidence"],
            "attribution": attribution,
            "reason": reason,
            "severity": cluster["severity"],
        })

    phq2 = record.get("phq2_score")
    if isinstance(phq2, (int, float)) and phq2 >= 3 and not any(f["pattern"] == "possible depression" for f in findings):
        findings.append({
            "pattern": "positive mood screen",
            "evidence": [f"PHQ-2 score {int(phq2)} of 6"],
            "attribution": "unclear",
            "reason": "A PHQ-2 score of 3 or more needs a nurse review.",
            "severity": "watch",
        })
    findings.sort(key=lambda f: -SEVERITY_RANK[f["severity"]])

    alerts = []
    for flag in red:
        alerts.append({
            "severity": flag["severity"],
            "kind": "red_flag",
            "title": red_flag_title(flag["type"]),
            "detail": f"Red flag during the check-in ({flag['type'].replace('_', ' ')}). Follow the emergency plan.",
            "quote": flag["quote"] or None,
        })
    for f in findings:
        if f["severity"] == "urgent" or f["pattern"] == "positive mood screen":
            alerts.append({
                "severity": f["severity"],
                "kind": "pattern",
                "title": f"Nurse review: {f['pattern']}",
                "detail": "; ".join(f["evidence"]) + ". " + f["reason"],
                "quote": record.get("patient_quote") or None,
            })

    # A check-in the patient asked to cut short is never "all clear": missing answers are
    # not good answers. It is recorded as such, not as a symptom (no agitation, no diagnosis).
    declined = (record.get("condition_specific") or {}).get("checkin_declined") is True
    if declined:
        flags = ["check-in cut short at the patient's request"] + flags

    if red or any(f["severity"] in ("urgent", "emergency") for f in findings):
        status = "red"
    elif findings or flags:
        status = "yellow"
    else:
        status = "green"

    return {
        "status": status,
        "findings": findings,
        "trend_flags": flags,
        "summary": build_summary(patient, record, status, flags, findings, red),
        "alerts": alerts,
    }


def main(argv: list[str]) -> int:
    try:
        with open(argv[1], encoding="utf-8") as fh:
            data = json.load(fh)
        result = analyze(data["patient"], data.get("history") or [], data["record"])
    except Exception as exc:  # report as data; the host turns it into a speakable error
        print(OUTPUT_MARKER + json.dumps({"error": f"{type(exc).__name__}: {exc}"[:300]}))
        return 1
    print(OUTPUT_MARKER + json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
