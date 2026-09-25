process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "performance-only-fairfare-secret";
const request = require("supertest");
const app = require("../src/app");
const { setLlmClientForTests } = require("../src/services/ai/aiRideAssistant.service");

setLlmClientForTests({ complete: async () => "Performance test response" });
const iterations = Number(process.env.FAIRFARE_PERF_ITERATIONS || 3);
const samples = {};
function stats(values) { const sorted = [...values].sort((a, b) => a - b); return { count: values.length, median: sorted[Math.floor(sorted.length / 2)], mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)), min: sorted[0], max: sorted[sorted.length - 1] }; }
async function measure(name, fn) { const values = []; for (let index = 0; index < iterations; index += 1) { const start = performance.now(); await fn(); values.push(Number((performance.now() - start).toFixed(2))); } samples[name] = stats(values); }
async function main() {
  const email = `perf-${Date.now()}@example.com`;
  const registered = await request(app).post("/api/auth/register").send({ name: "Performance User", email, password: "test-password-123" });
  if (registered.status !== 200) throw new Error(`registration failed: ${registered.status}`);
  const token = registered.body.data.accessToken; const headers = { Authorization: `Bearer ${token}` };
  await measure("health", () => request(app).get("/api/health"));
  await measure("preferences", () => request(app).get("/api/preferences").set(headers));
  await measure("history", () => request(app).get("/api/history").set(headers));
  await measure("fareComparison", () => request(app).post("/api/fares/compare").set(headers).send({ pickup: { name: "Gulberg", lat: 31.52, lng: 74.35 }, dropoff: { name: "DHA", lat: 31.47, lng: 74.39 }, vehicleType: "rickshaw", route: { distanceKm: 6, durationMin: 18 } }));
  await measure("prediction", () => request(app).post("/api/predictions/fare").send({ providerId: 1, vehicleType: "BIKE", pickupLatitude: 31.5, pickupLongitude: 74.3, destinationLatitude: 31.4, destinationLongitude: 74.4, distanceMeters: 5800, durationSeconds: 900, hourOfDay: 18, dayOfWeek: 5, isWeekend: 0 }));
  await measure("aiMocked", () => request(app).post("/api/ai/chat").set(headers).send({ message: "What did I compare recently?" }));
  console.log(JSON.stringify({ iterations, samples }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
