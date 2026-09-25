import unittest
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from prepare_dataset import FEATURES, prepare_rows


def row(source="SIMULATED", fare="250"):
    return {
        "id": "1", "comparison_id": "10", "data_source": source, "fare": fare,
        "distance_meters": "5800", "duration_seconds": "900", "provider_id": "1",
        "provider": "indrive", "provider_category_id": "31", "provider_category_name": "Rickshaw",
        "vehicle_type": "RICKSHAW", "pickup_latitude": "31.5", "pickup_longitude": "74.3",
        "destination_latitude": "31.4", "destination_longitude": "74.4", "hour_of_day": "18",
        "day_of_week": "5", "is_weekend": "0",
    }


class DatasetPreparationTests(unittest.TestCase):
    def test_source_filter_excludes_test_rows(self):
        prepared = prepare_rows([row("SIMULATED"), row("TEST"), row("UNKNOWN")], "SIMULATED")
        self.assertEqual(prepared["accepted"], 1)
        self.assertEqual(prepared["rejected"]["source_filter"], 2)

    def test_invalid_target_is_rejected(self):
        prepared = prepare_rows([row(fare="0"), row(fare="not-a-number")], "SIMULATED")
        self.assertEqual(prepared["accepted"], 0)
        self.assertEqual(prepared["rejected"]["invalid_fare"], 2)

    def test_unknown_category_is_retained_as_category(self):
        item = row()
        item["vehicle_type"] = "UNKNOWN"
        prepared = prepare_rows([item], "SIMULATED")
        self.assertEqual(prepared["rows"][0]["features"]["vehicle_type"], "UNKNOWN")

    def test_leakage_fields_are_not_features(self):
        self.assertNotIn("fare", FEATURES)
        self.assertNotIn("fare_min", FEATURES)
        self.assertNotIn("fare_max", FEATURES)
        self.assertNotIn("raw_response_sanitized", FEATURES)
        self.assertNotIn("comparison_id", FEATURES)


if __name__ == "__main__":
    unittest.main()
