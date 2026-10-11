const fs = require("fs");

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadModel(modelPath) {
  const raw = fs.readFileSync(modelPath, "utf8");
  const model = JSON.parse(raw);
  if (model.format !== "fairfare-node-gbr-v1" || model.modelType !== "Gradient Boosting") throw new Error("Unsupported Node fare model format");
  if (!Array.isArray(model.trees) || model.trees.length === 0) throw new Error("Node fare model has no trees");
  return model;
}

function inputValue(input, feature) {
  const aliases = {
    provider_id: "providerId", provider: "providerName", provider_category_id: "providerCategoryId",
    provider_category_name: "providerCategoryName", vehicle_type: "vehicleType", pickup_latitude: "pickupLatitude",
    pickup_longitude: "pickupLongitude", pickup_zone: "pickupZone", destination_latitude: "destinationLatitude",
    destination_longitude: "destinationLongitude", destination_zone: "destinationZone", distance_meters: "distanceMeters",
    duration_seconds: "durationSeconds", hour_of_day: "hourOfDay", day_of_week: "dayOfWeek", is_weekend: "isWeekend",
    precipitation_mm: "precipitationMm", temperature_c: "temperatureC", weather_condition: "weatherCondition",
    weather_severity: "weatherSeverity",
  };
  return input[aliases[feature] || feature];
}

function transformedFeatures(input, model) {
  const numeric = model.numeric.features.map((feature, index) => {
    const value = numberOr(inputValue(input, feature), model.numeric.imputerStatistics[index]);
    return (value - model.numeric.mean[index]) / model.numeric.scale[index];
  });
  const categorical = [];
  model.categorical.features.forEach((feature, index) => {
    let value = inputValue(input, feature);
    if (value === undefined || value === null || value === "") value = model.categorical.imputerStatistics[index];
    if (feature === "provider_id" || feature === "provider_category_id") value = String(value);
    const categories = model.categorical.categories[index];
    categories.forEach((category) => categorical.push(String(value) === String(category) ? 1 : 0));
  });
  return numeric.concat(categorical);
}

function treePrediction(tree, features) {
  let node = 0;
  while (tree.feature[node] !== -2) {
    node = features[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

function predict(input, model) {
  const features = transformedFeatures(input, model);
  let result = model.initialPrediction;
  for (const tree of model.trees) result += model.learningRate * treePrediction(tree, features);
  return Math.max(0, result);
}

module.exports = { loadModel, predict, transformedFeatures };
