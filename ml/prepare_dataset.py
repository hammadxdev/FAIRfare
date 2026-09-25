import csv
import math
from collections import Counter

NUMERIC_FEATURES = [
    "pickup_latitude", "pickup_longitude", "destination_latitude", "destination_longitude",
    "distance_meters", "duration_seconds", "hour_of_day", "day_of_week", "is_weekend",
]
CATEGORICAL_FEATURES = [
    "provider_id", "provider", "provider_category_id", "provider_category_name",
    "vehicle_type", "pickup_zone", "destination_zone",
]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES


def _number(value):
    if value is None or value == "":
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _category(value):
    return str(value).strip() if value not in (None, "") else "UNKNOWN"


def load_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def prepare_rows(rows, source="SIMULATED"):
    source = source.upper()
    accepted = []
    rejected = Counter()
    loaded = len(rows)
    for row in rows:
        row_source = (row.get("data_source") or "UNKNOWN").upper()
        if source != "ALL" and row_source != source:
            rejected["source_filter"] += 1
            continue
        fare = _number(row.get("fare"))
        if fare is None or fare <= 0:
            rejected["invalid_fare"] += 1
            continue
        distance = _number(row.get("distance_meters"))
        if distance is None or distance <= 0:
            rejected["invalid_distance"] += 1
            continue
        duration = _number(row.get("duration_seconds"))
        if duration is None or duration <= 0:
            rejected["invalid_duration"] += 1
            continue
        features = {}
        for name in NUMERIC_FEATURES:
            features[name] = _number(row.get(name))
        for name in CATEGORICAL_FEATURES:
            features[name] = _category(row.get(name))
        # The split group is used only for evaluation and never reaches the model.
        group = row.get("comparison_id") or f"row-{row.get('id', len(accepted))}"
        accepted.append({"features": features, "target": fare, "group": group, "raw": row})
    return {
        "rows": accepted,
        "loaded": loaded,
        "accepted": len(accepted),
        "rejected": dict(rejected),
        "source": source,
    }


def feature_matrix(prepared_rows):
    import numpy as np
    return np.asarray([[row["features"].get(name) for name in FEATURES] for row in prepared_rows], dtype=object), [row["target"] for row in prepared_rows]
