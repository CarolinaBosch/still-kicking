import unittest

from helpers import calm_history, patient, record

from engine import analyze
from rules import trend_flags

HF = patient(conditions=("heart failure",), meds=(("Furosemide", "diuretic"), ("Lisinopril", "bp")))


class TrendTests(unittest.TestCase):
    def test_same_stop_and_watch_item_on_two_of_three_calls(self):
        hist = calm_history(12) + [record(days_ago=2, sw=("ate_less",)), record(days_ago=1)]
        flags = trend_flags(patient(), hist, record(sw=("ate_less",)))
        self.assertIn("eating less: positive on 2 of last 3 calls", flags)

    def test_single_positive_is_not_a_trend(self):
        flags = trend_flags(patient(), calm_history(), record(sw=("ate_less",)))
        self.assertFalse(any(f.startswith("eating less") for f in flags))

    def test_pain_two_points_above_baseline(self):
        self.assertTrue(any(f.startswith("pain 4/10") for f in trend_flags(patient(usual_pain=2), calm_history(), record(pain=4))))
        self.assertFalse(any(f.startswith("pain") for f in trend_flags(patient(usual_pain=2), calm_history(), record(pain=3))))

    def test_new_confusion_against_clear_baseline(self):
        self.assertIn("new confusion compared with usual", trend_flags(patient(), calm_history(), record(oriented=False)))

    def test_confusion_that_is_usual_is_not_new(self):
        hist = calm_history(oriented=False)
        self.assertNotIn("new confusion compared with usual", trend_flags(patient(), hist, record(oriented=False)))

    def test_heart_failure_daily_weight_gain(self):
        hist = calm_history(weight=170)
        flags = trend_flags(HF, hist, record(weight=172.5))
        self.assertIn("weight up 2.5 lb since yesterday", flags)

    def test_heart_failure_weekly_weight_gain(self):
        # +1 lb a day: never more than 2 lb/day, but +7 lb over the week.
        hist = [record(days_ago=d, weight=170 + (7 - d)) for d in range(7, 0, -1)]
        flags = trend_flags(HF, hist, record(weight=177))
        self.assertFalse(any("since yesterday" in f for f in flags), flags)
        self.assertTrue(any("this week" in f for f in flags), flags)

    def test_weight_rule_only_for_heart_failure(self):
        flags = trend_flags(patient(), calm_history(weight=170), record(weight=175))
        self.assertFalse(any("weight up" in f for f in flags))

    def test_rising_prn_use(self):
        hist = calm_history(12) + [record(days_ago=2), record(days_ago=1, prn_more=True)]
        self.assertTrue(any(f.startswith("as-needed medicine") for f in trend_flags(patient(), hist, record(prn_more=True))))

    def test_phq2_three_or_more_needs_nurse_review(self):
        out = analyze(patient(), calm_history(), record(phq2=4))
        self.assertTrue(any(f["pattern"] == "positive mood screen" for f in out["findings"]))
        self.assertTrue(any(a["title"] == "Nurse review: positive mood screen" for a in out["alerts"]))


class SummaryTests(unittest.TestCase):
    def test_summary_under_150_words_and_never_diagnoses(self):
        hist = calm_history(11) + [record(days_ago=d, sw=("drank_less", "tired_weak_confused", "ate_less", "talks_less"), oriented=False, cs={"urinary_burning": True}) for d in (3, 2, 1)]
        out = analyze(patient(), hist, record(sw=("drank_less", "tired_weak_confused", "ate_less", "talks_less"), oriented=False, cs={"urinary_burning": True}, phq2=4, quote="I feel muddled"))
        s = out["summary"]
        parts = [s["today"], s["medications"], s["in_their_words"], s["next_call"]] + s["what_changed"] + s["patterns_to_watch"]
        self.assertLess(sum(len(p.split()) for p in parts), 150)
        for p in s["patterns_to_watch"]:
            self.assertIn("the nurse will review", p)
        self.assertNotIn("diagnos", " ".join(parts).lower())


if __name__ == "__main__":
    unittest.main()
