import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ml"))
from prepare_dataset import load_rows, prepare_rows
from train import split_rows


def main():
    csv_path = os.path.join(os.path.dirname(__file__), "..", "ml", "datasets", "fare_training_synthetic.csv")
    prepared = prepare_rows(load_rows(csv_path), "SIMULATED")
    rows = prepared["rows"]
    _, test_indices, _ = split_rows(rows)
    selected = []
    seen = set()
    for index in test_indices:
        features = rows[index]["features"]
        key = (features["provider"], features["vehicle_type"])
        if key in seen:
            continue
        seen.add(key)
        selected.append({
            "providerId": features["provider_id"], "providerName": features["provider"],
            "providerCategoryId": features["provider_category_id"], "providerCategoryName": features["provider_category_name"],
            "vehicleType": features["vehicle_type"], "pickupLatitude": features["pickup_latitude"], "pickupLongitude": features["pickup_longitude"],
            "destinationLatitude": features["destination_latitude"], "destinationLongitude": features["destination_longitude"],
            "pickupZone": features["pickup_zone"], "destinationZone": features["destination_zone"],
            "distanceMeters": features["distance_meters"], "durationSeconds": features["duration_seconds"],
            "hourOfDay": features["hour_of_day"], "dayOfWeek": features["day_of_week"], "isWeekend": features["is_weekend"],
            "weatherCondition": features["weather_condition"], "weatherSeverity": features["weather_severity"],
            "precipitationMm": features["precipitation_mm"], "temperatureC": features["temperature_c"],
        })
    print(json.dumps(selected))


if __name__ == "__main__":
    main()
