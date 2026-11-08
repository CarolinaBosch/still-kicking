import unittest

from helpers import calm_history, patient, record

from engine import analyze
from rules import red_flags


class RedFlagTests(unittest.TestCase):
    def test_chest_pain_is_always_emergency(self):
        flags = red_flags(record(red_flags=[{"type": "chest_pain", "quote": "my chest hurts", "severity": "watch"}]))
        self.assertEqual(flags[0]["severity"], "emergency")

    def test_phrase_in_patient_words_raises_flag_without_agent_flag(self):
        flags = red_flags(record(quote="I have chest pain since this morning"))
        self.assertEqual([f["type"] for f in flags], ["chest_pain"])
        self.assertEqual(flags[0]["severity"], "emergency")

    def test_breathing_phrase(self):
        self.assertEqual(red_flags(record(quote="I can't breathe well"))[0]["type"], "breathing")

    def test_no_red_flag_on_calm_call(self):
        self.assertEqual(red_flags(record(quote="Feeling fine, had my tea")), [])

    def test_fall_keeps_agent_severity(self):
        flags = red_flags(record(red_flags=[{"type": "fall", "quote": "I slipped", "severity": "urgent"}]))
        self.assertEqual(flags[0]["severity"], "urgent")

    def test_red_flag_makes_status_red_and_creates_alert(self):
        out = analyze(patient(), calm_history(), record(red_flags=[{"type": "stroke_signs", "quote": "my face feels droopy", "severity": "emergency"}]))
        self.assertEqual(out["status"], "red")
        alert = out["alerts"][0]
        self.assertEqual((alert["kind"], alert["severity"]), ("red_flag", "emergency"))
        self.assertEqual(alert["quote"], "my face feels droopy")

    def test_calm_call_is_green_with_no_alerts(self):
        out = analyze(patient(), calm_history(), record(quote="all good"))
        self.assertEqual((out["status"], out["alerts"], out["findings"]), ("green", [], []))


if __name__ == "__main__":
    unittest.main()
