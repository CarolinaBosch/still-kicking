import unittest

from helpers import calm_history, patient, record

from engine import analyze

HF = patient(conditions=("heart failure",), meds=(("Furosemide", "diuretic"), ("Lisinopril", "bp")))
SWELL = {"ankle_swelling": True, "sob_lying_flat": True}


def hf_finding(out):
    return next(f for f in out["findings"] if f["pattern"] == "possible heart failure worsening")


class AttributionTests(unittest.TestCase):
    def test_missed_diuretic_explains_heart_failure_signs(self):
        hist = calm_history(11, weight=178) + [
            record(days_ago=d, sw=("weight_or_swelling",), cs=SWELL, missed=("Furosemide",), weight=w)
            for d, w in ((3, 180.5), (2, 182.5), (1, 184))
        ]
        out = analyze(HF, hist, record(sw=("weight_or_swelling",), cs=SWELL, missed=("furosemide",), weight=186.5))
        f = hf_finding(out)
        self.assertEqual(f["attribution"], "likely_adherence_related")
        self.assertEqual(f["severity"], "urgent")
        self.assertIn("Furosemide", f["reason"])
        self.assertEqual(out["status"], "red")

    def test_same_signs_with_meds_taken_is_clinical_change(self):
        hist = calm_history(11, weight=178) + [record(days_ago=d, sw=("weight_or_swelling",), cs=SWELL, weight=w) for d, w in ((3, 180.5), (2, 182.5), (1, 184))]
        f = hf_finding(analyze(HF, hist, record(sw=("weight_or_swelling",), cs=SWELL, weight=186.5)))
        self.assertEqual(f["attribution"], "likely_clinical_change")

    def test_missed_dose_older_than_72_hours_does_not_count(self):
        hist = calm_history(11, weight=178) + [
            record(days_ago=5, missed=("Furosemide",), weight=178),
            record(days_ago=2, sw=("weight_or_swelling",), cs=SWELL, weight=181),
            record(days_ago=1, sw=("weight_or_swelling",), cs=SWELL, weight=183),
        ]
        f = hf_finding(analyze(HF, hist, record(sw=("weight_or_swelling",), cs=SWELL, weight=185.5)))
        self.assertEqual(f["attribution"], "likely_clinical_change")

    def test_unrelated_missed_med_does_not_explain_pattern(self):
        hist = calm_history(11, weight=178) + [record(days_ago=d, sw=("weight_or_swelling",), cs=SWELL, missed=("Lisinopril",), weight=w) for d, w in ((3, 180.5), (2, 182.5), (1, 184))]
        f = hf_finding(analyze(HF, hist, record(sw=("weight_or_swelling",), cs=SWELL, missed=("Lisinopril",), weight=186.5)))
        self.assertNotEqual(f["attribution"], "likely_adherence_related")

    def test_uti_like_cluster_is_clinical_change(self):
        signs = dict(sw=("drank_less", "tired_weak_confused"), oriented=False, cs={"urinary_burning": True})
        hist = calm_history(11) + [record(days_ago=d, **signs) for d in (3, 2, 1)]
        out = analyze(patient(conditions=("dementia/MCI",)), hist, record(**signs))
        f = next(f for f in out["findings"] if f["pattern"].startswith("possible urinary infection"))
        self.assertEqual((f["attribution"], f["severity"]), ("likely_clinical_change", "urgent"))
        self.assertTrue(any(a["kind"] == "pattern" for a in out["alerts"]))

    def test_copd_flare_with_missed_inhaler(self):
        copd = patient(conditions=("COPD",), meds=(("Tiotropium", "inhaler"),))
        cs = {"cough_worse": True, "sputum_change": True}
        hist = calm_history(12) + [record(days_ago=d, cs=cs, missed=("Tiotropium",), prn_more=True) for d in (2, 1)]
        out = analyze(copd, hist, record(cs=cs, prn_more=True, missed=("Tiotropium",)))
        f = next(f for f in out["findings"] if f["pattern"] == "possible COPD flare")
        self.assertEqual(f["attribution"], "likely_adherence_related")

    def test_unknown_adherence_is_unclear(self):
        hist = calm_history(11, weight=178) + [record(days_ago=d, sw=("weight_or_swelling",), cs=SWELL, weight=w) for d, w in ((3, 180.5), (2, 182.5), (1, 184))]
        f = hf_finding(analyze(HF, hist, record(sw=("weight_or_swelling",), cs=SWELL, weight=186.5, all_taken=None) | {"medication_adherence": {"all_taken": None, "missed": [], "prn_use_increased": None, "running_low": []}}))
        self.assertEqual(f["attribution"], "unclear")


if __name__ == "__main__":
    unittest.main()
