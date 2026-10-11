import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".deps"))
import joblib


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--metadata", required=True)
    args = parser.parse_args()
    payload = json.load(sys.stdin)
    with open(args.metadata, encoding="utf-8") as handle:
        metadata = json.load(handle)
    represented_types = metadata.get("vehicle_types") or []
    if payload.get("vehicleType") and represented_types and payload["vehicleType"] not in represented_types:
        print(json.dumps({"status": "UNSUPPORTED_CATEGORY", "predictedFare": None, "confidence": None, "reason": "Vehicle type is not represented in the selected training data"}))
        return
    artifact = joblib.load(args.model)
    aliases = {
        "provider_id": "providerId", "provider": "providerName", "provider_category_id": "providerCategoryId",
        "provider_category_name": "providerCategoryName", "vehicle_type": "vehicleType",
        "pickup_latitude": "pickupLatitude", "pickup_longitude": "pickupLongitude",
        "pickup_zone": "pickupZone", "destination_latitude": "destinationLatitude",
        "destination_longitude": "destinationLongitude", "destination_zone": "destinationZone",
        "distance_meters": "distanceMeters", "duration_seconds": "durationSeconds",
        "hour_of_day": "hourOfDay", "day_of_week": "dayOfWeek", "is_weekend": "isWeekend",
        "weather_condition": "weatherCondition", "weather_severity": "weatherSeverity",
        "precipitation_mm": "precipitationMm", "temperature_c": "temperatureC",
    }
    row = {key: payload.get(aliases.get(key, key)) for key in artifact["features"]}
    if row.get("provider") in (None, ""):
        row["provider"] = row.get("provider_id", "UNKNOWN")
    # Training treats provider IDs/category IDs as categorical values.
    for key in ("provider_id", "provider_category_id"):
        if row.get(key) is not None:
            row[key] = str(row[key])
    ordered_row = [[row.get(key) for key in artifact["features"]]]
    prediction = float(artifact["pipeline"].predict(ordered_row)[0])
    print(json.dumps({
        "status": "AVAILABLE",
        "predictedFare": round(max(0.0, prediction), 2),
        "currency": "PKR",
        "model": {"version": metadata.get("model_version"), "type": metadata.get("model_type")},
        "confidence": metadata.get("confidence"),
        "dataSource": metadata.get("data_source", "UNKNOWN"),
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "PREDICTION_FAILED", "predictedFare": None, "confidence": None, "error": str(error)}))
        sys.exit(1)
