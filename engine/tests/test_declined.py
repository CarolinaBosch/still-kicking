import unittest

from helpers import SW_KEYS, calm_history, patient, record

from engine import analyze


def declined_record(**kw) -> dict:
    """The patient got frustrated and asked to stop: only the safety question was answered."""
    r = record(cs={"checkin_declined": True}, quote="Stop asking me the same questions.", **kw)
    r["stop_and_watch"] = {k: None for k in SW_KEYS}
    r["orientation_correct"] = None
    r["phq2_score"] = None
    r["medication_adherence"] = {"all_taken": None, "missed": [], "prn_use_increased": None, "running_low": []}
    return r


class DeclinedCheckinTests(unittest.TestCase):
    def test_declined_checkin_is_never_green(self):
        out = analyze(patient(), calm_history(), declined_record())
        self.assertEqual(out["status"], "yellow")
        self.assertIn("check-in short", out["summary"]["today"])
        self.assertIn("check-in cut short at the patient's request", out["trend_flags"])

    def test_frustration_is_not_a_symptom(self):
        out = analyze(patient(), calm_history(), declined_record())
        self.assertEqual(out["alerts"], [])
        self.assertEqual(out["findings"], [])
        text = " ".join([out["summary"]["today"], *out["summary"]["what_changed"]]).lower()
        for word in ("agitat", "abusive", "confus", "depress"):
            self.assertNotIn(word, text)

    def test_red_flag_still_wins_when_declined(self):
        flag = {"type": "chest_pain", "quote": "my chest hurts", "severity": "emergency"}
        out = analyze(patient(), calm_history(), declined_record(red_flags=[flag]))
        self.assertEqual(out["status"], "red")
        self.assertTrue(out["alerts"])


if __name__ == "__main__":
    unittest.main()
