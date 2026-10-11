import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ml", ".deps"))
import joblib


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: exportNodeFareModel.py <joblib> <json>")
    artifact_path, output_path = sys.argv[1:]
    artifact = joblib.load(artifact_path)
    pipeline = artifact["pipeline"]
    preprocessor = pipeline.named_steps["preprocess"]
    model = pipeline.named_steps["model"]
    if type(model).__name__ != "GradientBoostingRegressor" or getattr(model, "loss", None) != "squared_error":
        raise SystemExit("Only squared-error GradientBoostingRegressor is supported")

    numeric = preprocessor.named_transformers_["numeric"]
    categorical = preprocessor.named_transformers_["categorical"]
    scaler = numeric.named_steps["scale"]
    onehot = categorical.named_steps["onehot"]
    exported = {
        "format": "fairfare-node-gbr-v1",
        "modelVersion": "fare-v1-development",
        "modelType": "Gradient Boosting",
        "dataSource": "SIMULATED",
        "supportedProviders": [],
        "supportedVehicleTypes": [],
        "features": artifact["features"],
        "numeric": {
            "features": artifact["features"][: len(scaler.mean_)],
            "imputerStatistics": numeric.named_steps["imputer"].statistics_.tolist(),
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "categorical": {
            "features": artifact["features"][len(scaler.mean_):],
            "imputerStatistics": categorical.named_steps["imputer"].statistics_.tolist(),
            "categories": [values.tolist() for values in onehot.categories_],
        },
        "initialPrediction": float(model.init_.constant_[0][0]),
        "learningRate": float(model.learning_rate),
        "trees": [],
    }
    for estimator in model.estimators_[:, 0]:
        tree = estimator.tree_
        exported["trees"].append({
            "feature": tree.feature.tolist(),
            "threshold": tree.threshold.tolist(),
            "left": tree.children_left.tolist(),
            "right": tree.children_right.tolist(),
            "value": tree.value[:, 0, 0].tolist(),
        })
    exported["supportedProviders"] = onehot.categories_[1].tolist()
    exported["supportedVehicleTypes"] = onehot.categories_[4].tolist()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(exported, handle, separators=(",", ":"))
    print(json.dumps({"path": output_path, "bytes": os.path.getsize(output_path), "trees": len(exported["trees"]), "features": len(exported["features"])}))


if __name__ == "__main__":
    main()
