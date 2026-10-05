const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BACKEND_ROOT = path.resolve(__dirname, "../..");
const MODEL_PATH = process.env.FAIRFARE_MODEL_ARTIFACT || path.join(BACKEND_ROOT, "ml", "artifacts", "fare_model.joblib");
const METADATA_PATH = process.env.FAIRFARE_MODEL_METADATA || path.join(BACKEND_ROOT, "ml", "artifacts", "fare_model_metadata.json");
const PREDICT_SCRIPT = path.join(BACKEND_ROOT, "ml", "predict.py");
const PYTHON = process.env.FAIRFARE_PYTHON || "python";
const TIMEOUT_MS = Number(process.env.FAIRFARE_PREDICTION_TIMEOUT_MS || 3000);

function unavailable(status, reason) {
  return { status, predictedFare: null, currency: "PKR", model: null, confidence: null, reason };
}

function validatePredictionInput(input) {
  const required = ["providerId", "vehicleType", "pickupLatitude", "pickupLongitude", "destinationLatitude", "destinationLongitude", "distanceMeters", "durationSeconds", "hourOfDay", "dayOfWeek", "isWeekend"];
  const missing = required.filter((key) => input?.[key] === undefined || input?.[key] === null || input?.[key] === "");
  if (missing.length) return `Missing prediction fields: ${missing.join(", ")}`;
  const numeric = ["pickupLatitude", "pickupLongitude", "destinationLatitude", "destinationLongitude", "distanceMeters", "durationSeconds", "hourOfDay", "dayOfWeek", "isWeekend"];
  if (numeric.some((key) => !Number.isFinite(Number(input[key])))) return "Prediction numeric fields are invalid";
  if (Number(input.distanceMeters) <= 0 || Number(input.durationSeconds) <= 0) return "Distance and duration must be positive";
  return null;
}

function predictFare(input, options = {}) {
  const invalid = validatePredictionInput(input);
  if (invalid) return Promise.resolve(unavailable("PREDICTION_FAILED", invalid));
  if (process.env.FAIRFARE_DISABLE_PREDICTIONS === "true") return Promise.resolve(unavailable("MODEL_NOT_TRAINED", "Prediction disabled by configuration"));
  const modelPath = options.modelPath || MODEL_PATH;
  const metadataPath = options.metadataPath || METADATA_PATH;
  if (!fs.existsSync(modelPath) || !fs.existsSync(metadataPath)) return Promise.resolve(unavailable("MODEL_NOT_TRAINED", "No trained fare model artifact is available"));

  return new Promise((resolve) => {
    const dependencyPath = path.join(BACKEND_ROOT, "ml", ".deps");
    const child = spawn(PYTHON, [PREDICT_SCRIPT, "--model", modelPath, "--metadata", metadataPath], {
      cwd: BACKEND_ROOT,
      shell: false,
      env: { ...process.env, PYTHONPATH: dependencyPath + path.delimiter + (process.env.PYTHONPATH || "") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill(); finish(unavailable("PREDICTION_FAILED", "Prediction timed out")); }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => finish(unavailable("PREDICTION_FAILED", "Prediction process unavailable")));
    child.on("close", (code) => {
      if (code !== 0) return finish(unavailable("PREDICTION_FAILED", "Prediction process failed"));
      try {
        const parsed = JSON.parse(stdout);
        finish(parsed);
      } catch (error) {
        finish(unavailable("PREDICTION_FAILED", "Prediction response was invalid"));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function modelMetadata() {
  if (!fs.existsSync(METADATA_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(METADATA_PATH, "utf8")); } catch { return null; }
}

module.exports = { MODEL_PATH, METADATA_PATH, validatePredictionInput, predictFare, modelMetadata };
