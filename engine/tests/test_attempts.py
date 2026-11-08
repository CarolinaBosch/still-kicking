import unittest

import helpers  # noqa: F401  (puts engine/ on sys.path)

from attempts import consecutive_missed, missed_call_alert, should_escalate


def attempts(*answered):
    return [{"patient_id": "t1", "at": f"2026-03-0{i + 1}T10:00:00Z", "answered": a} for i, a in enumerate(answered)]


class MissedCallTests(unittest.TestCase):
    def test_counts_trailing_misses_only(self):
        self.assertEqual(consecutive_missed(attempts(False, True, False, False)), 2)

    def test_answer_resets_the_count(self):
        self.assertEqual(consecutive_missed(attempts(False, False, False, True)), 0)

    def test_empty_history(self):
        self.assertEqual(consecutive_missed([]), 0)

    def test_two_misses_do_not_escalate(self):
        self.assertFalse(should_escalate(attempts(True, False, False), False))

    def test_third_consecutive_miss_escalates(self):
        self.assertTrue(should_escalate(attempts(True, False, False, False), False))

    def test_misses_split_by_an_answer_do_not_escalate(self):
        self.assertFalse(should_escalate(attempts(False, False, True, False), False))

    def test_no_duplicate_alert_while_one_is_open(self):
        self.assertFalse(should_escalate(attempts(False, False, False, False), True))

    def test_alert_is_urgent_and_speaks_plainly(self):
        alert = missed_call_alert({"preferred_name": "Walt"}, 3)
        self.assertEqual((alert["severity"], alert["kind"]), ("urgent", "missed_calls"))
        self.assertEqual(alert["title"], "Unable to reach after 3 attempts")


if __name__ == "__main__":
    unittest.main()
