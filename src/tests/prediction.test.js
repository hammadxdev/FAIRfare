const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("./setup");
const { predictFare } = require("../services/farePrediction.service");
const { createAuthenticatedTestUser, authHeader } = require("./helpers/authTestHelper");

let auth;
test.before(async () => { auth = await createAuthenticatedTestUser(app, "Prediction Test User"); });

const input = {
  providerId: 1,
  providerCategoryId: "bike",
  providerCategoryName: "Bike",
  vehicleType: "BIKE",
  pickupLatitude: 31.5,
  pickupLongitude: 74.3,
  destinationLatitude: 31.4,
  destinationLongitude: 74.4,
  distanceMeters: 5800,
  durationSeconds: 900,
  hourOfDay: 18,
  dayOfWeek: 5,
  isWeekend: 0,
};

test("prediction API validates input safely", async () => {
  const response = await request(app).post("/api/predictions/fare").send({ distanceMeters: 0 });
  assert.equal(response.status, 422);
  assert.equal(response.body.data.status, "PREDICTION_FAILED");
});

test("missing model returns MODEL_NOT_TRAINED without throwing", async () => {
  const result = await predictFare(input, { modelPath: "missing/fare_model.joblib", metadataPath: "missing/metadata.json" });
  assert.equal(result.status, "MODEL_NOT_TRAINED");
  assert.equal(result.predictedFare, null);
});

test("Vercel uses the portable model and preserves unavailable fallback", async () => {
  process.env.VERCEL = "1";
  try {
    const result = await predictFare(input, { nodeModelPath: "missing/fare_model.json" });
    assert.equal(result.status, "MODEL_NOT_TRAINED");
    const available = await predictFare(input);
    assert.equal(available.status, "AVAILABLE");
    assert.equal(available.dataSource, "SIMULATED");
  } finally {
    delete process.env.VERCEL;
  }
});

test("prediction smoke path returns a safe structured result when model is available", async () => {
  const response = await request(app).post("/api/predictions/fare").send(input);
  assert.equal(response.status, 200);
  assert.ok(["AVAILABLE", "MODEL_NOT_TRAINED", "UNSUPPORTED_CATEGORY"].includes(response.body.data.status));
  if (response.body.data.status === "AVAILABLE") {
    assert.equal(typeof response.body.data.predictedFare, "number");
    assert.ok(response.body.data.model.type);
  }
});

test("fare comparison keeps current fare and attaches prediction separately", async () => {
  const response = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send({
    pickup: { name: "Prediction Pickup", lat: 31.5, lng: 74.3 },
    dropoff: { name: "Prediction Destination", lat: 31.4, lng: 74.4 },
    vehicleType: "bike",
  });
  assert.equal(response.status, 200);
  const available = response.body.data.results.filter((result) => result.fare != null);
  assert.ok(available.length > 0);
  for (const result of available) {
    assert.equal(typeof result.fare, "number");
    assert.ok(result.prediction);
    assert.ok(["AVAILABLE", "MODEL_NOT_TRAINED", "PREDICTION_FAILED"].includes(result.prediction.status));
    assert.ok(result.recommendation);
    assert.ok(["BOOK_NOW", "WAIT", "NEUTRAL", "INSUFFICIENT_DATA"].includes(result.recommendation.status));
    assert.equal(result.fare, result.recommendation.currentFare);
  }
});

test("fare comparison remains successful when prediction is unavailable", async () => {
  process.env.FAIRFARE_DISABLE_PREDICTIONS = "true";
  try {
    const response = await request(app).post("/api/fares/compare").set("Authorization", authHeader(auth)).send({
      pickup: { name: "Unavailable Model Pickup", lat: 31.5, lng: 74.3 },
      dropoff: { name: "Unavailable Model Destination", lat: 31.4, lng: 74.4 },
      vehicleType: "bike",
    });
    assert.equal(response.status, 200);
    assert.ok(response.body.data.results.some((result) => result.fare != null && result.prediction?.status === "MODEL_NOT_TRAINED"));
    assert.ok(response.body.data.results.filter((result) => result.fare != null).every((result) => result.recommendation?.status === "INSUFFICIENT_DATA"));
  } finally {
    delete process.env.FAIRFARE_DISABLE_PREDICTIONS;
  }
});

test("unsupported vehicle category is reported safely", async () => {
  const response = await request(app).post("/api/predictions/fare").send({ ...input, vehicleType: "RICKSHAW", providerCategoryId: "31", providerCategoryName: "Rickshaw" });
  assert.equal(response.status, 422);
  assert.equal(response.body.data.status, "UNSUPPORTED_CATEGORY");
});
