import argparse
import json
import os
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=os.path.join(os.path.dirname(__file__), "artifacts", "fare_model.joblib"))
    parser.add_argument("--metadata", default=os.path.join(os.path.dirname(__file__), "artifacts", "fare_model_metadata.json"))
    args = parser.parse_args()
    payload = {
        "providerId": 1, "providerCategoryId": "bike", "providerCategoryName": "Bike", "vehicleType": "BIKE",
        "pickupLatitude": 31.5, "pickupLongitude": 74.3, "destinationLatitude": 31.4, "destinationLongitude": 74.4,
        "distanceMeters": 5800, "durationSeconds": 900, "hourOfDay": 18, "dayOfWeek": 5, "isWeekend": 0,
    }
    result = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "predict.py"), "--model", args.model, "--metadata", args.metadata], input=json.dumps(payload), text=True, capture_output=True, check=False)
    print(result.stdout.strip())
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
