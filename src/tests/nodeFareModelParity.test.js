const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadModel, predict } = require("../services/nodeFareModel.service");

const backendRoot = path.resolve(__dirname, "../..");
const nodeArtifact = path.join(backendRoot, "ml", "node_artifacts", "synthetic_600", "fare_model.json");
const pythonArtifact = path.join(backendRoot, "ml", "artifacts", "synthetic_600", "fare_model.joblib");
const pythonMetadata = path.join(backendRoot, "ml", "artifacts", "synthetic_600", "fare_model_metadata.json");
const pythonPredict = path.join(backendRoot, "ml", "predict.py");
const model = loadModel(nodeArtifact);

function heldOutInputs() {
  const result = spawnSync("python", [path.join(backendRoot, "scripts", "exportNodeParityFixtures.py")], { cwd: backendRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function pythonPrediction(input) {
  const result = spawnSync("python", [pythonPredict, "--model", pythonArtifact, "--metadata", pythonMetadata], { cwd: backendRoot, input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).predictedFare;
}

test("portable Node model matches Python predictions across providers and vehicle types", () => {
  assert.deepEqual(model.supportedVehicleTypes, ["BIKE", "ECONOMY_CAR", "RICKSHAW", "STANDARD_CAR"]);
  const inputs = heldOutInputs();
  const coverage = [];
  const providers = new Set();
  const vehicles = new Set();
  for (const input of inputs) {
    if (providers.size < 3 || vehicles.size < model.supportedVehicleTypes.length || !providers.has(input.providerName) || !vehicles.has(input.vehicleType)) {
      coverage.push(input);
      providers.add(input.providerName);
      vehicles.add(input.vehicleType);
    }
    if (providers.size === 3 && vehicles.size === model.supportedVehicleTypes.length) break;
  }
  assert.ok(coverage.length >= 6);
  assert.deepEqual(vehicles, new Set(model.supportedVehicleTypes));
  assert.deepEqual(providers, new Set(["indrive", "quickride", "urbancab"]));
  const errors = coverage.map((input) => {
    const nodePrediction = Number(predict(input, model).toFixed(2));
    const pythonPredictionValue = pythonPrediction(input);
    return Math.abs(nodePrediction - pythonPredictionValue);
  });
  assert.ok(Math.max(...errors) <= 0.01, `maximum parity error was ${Math.max(...errors)}`);
});
