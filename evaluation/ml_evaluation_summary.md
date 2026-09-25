# Fair Fare Version 1 ML Evaluation Summary

Source artifact: `ml/artifacts/fare_model_metadata.json`

- Data source: `SIMULATED`
- Loaded observations: 346
- Accepted observations used for this model: 96
- Training observations: 75
- Test observations: 21
- Split: grouped by `comparison_id`, random seed 42
- Selected model: Gradient Boosting
- Model version: `fare-v1-development`

| Model | MAE | RMSE | R² | MAPE |
|---|---:|---:|---:|---:|
| Historical mean baseline | 116.9752 | 137.4151 | 0.0653 | 38.1894% |
| Linear Regression | 11.7841 | 16.2841 | 0.9869 | 3.9126% |
| Random Forest | 0.6238 | 1.0044 | 0.99995 | 0.1618% |
| Gradient Boosting | 0.2176 | 0.3165 | 0.999995 | 0.0760% |

These metrics are strong on deterministic simulated fare data. They must not
be presented as evidence of real-world fare forecasting or generalization.
The mobile product labels the output as a development prediction and keeps
the current provider quote separate from the expected fare reference.
