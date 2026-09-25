import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".deps"))

import joblib
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from prepare_dataset import CATEGORICAL_FEATURES, FEATURES, NUMERIC_FEATURES, feature_matrix, load_rows, prepare_rows


def encoder():
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def build_pipeline(model):
    numeric = Pipeline([("imputer", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
    categorical = Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("onehot", encoder())])
    numeric_indices = list(range(len(NUMERIC_FEATURES)))
    categorical_indices = list(range(len(NUMERIC_FEATURES), len(NUMERIC_FEATURES) + len(CATEGORICAL_FEATURES)))
    preprocessor = ColumnTransformer([("numeric", numeric, numeric_indices), ("categorical", categorical, categorical_indices)])
    return Pipeline([("preprocess", preprocessor), ("model", model)])


def metrics(actual, predicted):
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    nonzero = np.abs(actual) > 1e-9
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(np.sqrt(mean_squared_error(actual, predicted))),
        "r2": float(r2_score(actual, predicted)) if len(actual) > 1 else None,
        "mape": float(np.mean(np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero])) * 100) if nonzero.any() else None,
    }


def split_rows(rows, seed=42):
    if len(rows) < 5:
        raise ValueError("At least 5 valid observations are required for a development split")
    groups = np.asarray([row["group"] for row in rows])
    indices = np.arange(len(rows))
    unique_groups = np.unique(groups)
    if len(unique_groups) >= 3:
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
        train_idx, test_idx = next(splitter.split(indices, groups=groups))
        strategy = "grouped_by_comparison_id"
    else:
        train_idx, test_idx = train_test_split(indices, test_size=0.2, random_state=seed)
        strategy = "random_fallback_small_group_count"
    return train_idx, test_idx, strategy


def baseline_predict(train_rows, test_rows):
    means = {}
    for row in train_rows:
        key = (row["features"]["provider"], row["features"]["vehicle_type"])
        means.setdefault(key, []).append(row["target"])
    global_mean = float(np.mean([row["target"] for row in train_rows]))
    return [float(np.mean(means.get((row["features"]["provider"], row["features"]["vehicle_type"]), [global_mean]))) for row in test_rows]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--source", default="SIMULATED", choices=["REAL", "SIMULATED", "TEST", "UNKNOWN", "ALL"])
    parser.add_argument("--artifacts", default=os.path.join(os.path.dirname(__file__), "artifacts"))
    args = parser.parse_args()
    prepared = prepare_rows(load_rows(args.csv), args.source)
    if prepared["accepted"] < 5:
        raise SystemExit(json.dumps({"error": "insufficient_data", "report": prepared}, indent=2))
    rows = prepared["rows"]
    train_idx, test_idx, split_strategy = split_rows(rows)
    train_rows = [rows[index] for index in train_idx]
    test_rows = [rows[index] for index in test_idx]
    X_train, y_train = feature_matrix(train_rows)
    X_test, y_test = feature_matrix(test_rows)
    results = {"Baseline (provider + vehicle mean)": metrics(y_test, baseline_predict(train_rows, test_rows))}
    models = {
        "Linear Regression": LinearRegression(),
        "Random Forest": RandomForestRegressor(n_estimators=150, random_state=42, n_jobs=1),
        "Gradient Boosting": GradientBoostingRegressor(random_state=42, n_estimators=100),
    }
    trained = {}
    for name, estimator in models.items():
        pipeline = build_pipeline(estimator)
        pipeline.fit(X_train, y_train)
        results[name] = metrics(y_test, pipeline.predict(X_test))
        trained[name] = pipeline
    selected_name = min(models, key=lambda name: (results[name]["mae"], results[name]["rmse"]))
    os.makedirs(args.artifacts, exist_ok=True)
    artifact_path = os.path.join(args.artifacts, "fare_model.joblib")
    metadata_path = os.path.join(args.artifacts, "fare_model_metadata.json")
    joblib.dump({"pipeline": trained[selected_name], "features": FEATURES, "model_type": selected_name}, artifact_path)
    raw_dates = [row["raw"].get("observed_at") for row in rows if row["raw"].get("observed_at")]
    metadata = {
        "model_version": "fare-v1-development",
        "model_type": selected_name,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "data_source": args.source,
        "loaded_observations": prepared["loaded"],
        "accepted_observations": prepared["accepted"],
        "rejected_observations": prepared["rejected"],
        "training_observations": len(train_rows),
        "test_observations": len(test_rows),
        "features": FEATURES,
        "target": "fare",
        "split_strategy": split_strategy,
        "random_seed": 42,
        "metrics": {"baseline": results["Baseline (provider + vehicle mean)"], **{key: value for key, value in results.items() if key != "Baseline (provider + vehicle mean)"}},
        "dataset_date_range": {"min_observed_at": min(raw_dates) if raw_dates else None, "max_observed_at": max(raw_dates) if raw_dates else None},
        "providers": sorted({row["features"]["provider"] for row in rows}),
        "vehicle_types": sorted({row["features"]["vehicle_type"] for row in rows}),
        "confidence": None,
    }
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)
    print("MODEL EVALUATION")
    print(f"Data source: {args.source}")
    print(f"Observations: loaded={prepared['loaded']} accepted={prepared['accepted']} test={len(test_rows)}")
    for name, value in results.items():
        print(f"{name}: MAE={value['mae']:.4f} RMSE={value['rmse']:.4f} R2={value['r2'] if value['r2'] is not None else 'n/a'} MAPE={value['mape'] if value['mape'] is not None else 'n/a'}")
    print(f"Selected development model: {selected_name}")
    print(f"Artifact: {artifact_path}")
    print(f"Metadata: {metadata_path}")


if __name__ == "__main__":
    main()
