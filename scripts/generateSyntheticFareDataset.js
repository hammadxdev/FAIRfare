const fs = require("fs");
const path = require("path");

const OUTPUT = process.env.FARE_SYNTHETIC_DATASET_PATH || path.join(__dirname, "..", "ml", "datasets", "fare_training_synthetic.csv");
const SEED = 20261011;
const ROW_COUNT = 600;
const providers = [
  { id: "1", name: "indrive", categories: { BIKE: ["2", "Moto", 60, 20, 1, 120], RICKSHAW: ["31", "Rickshaw", 80, 28, 1.4, 150], ECONOMY_CAR: ["33", "Mini", 100, 34, 1.8, 200], STANDARD_CAR: ["29", "Ride AC", 120, 42, 2.2, 250] } },
  { id: "2", name: "quickride", categories: { BIKE: ["bike", "Bike", 50, 18, 1, 110], RICKSHAW: ["rickshaw", "Rickshaw", 70, 25, 1.3, 140], ECONOMY_CAR: ["mini", "Mini", 90, 30, 1.6, 190], STANDARD_CAR: ["car", "Car", 110, 38, 2, 230] } },
  { id: "3", name: "urbancab", categories: { BIKE: ["bike", "Bike", 70, 22, 1.2, 130], RICKSHAW: ["rickshaw", "Rickshaw", 90, 30, 1.6, 160], ECONOMY_CAR: ["mini", "Mini", 110, 38, 2, 210], STANDARD_CAR: ["car", "Car", 130, 48, 2.6, 270] } },
];
const routes = [
  [31.4700, 74.2800, "Johar Town", 31.5200, 74.3500, "Gulberg", 7.8, 24],
  [31.4650, 74.2650, "Punjab Small Industries", 31.5150, 74.4050, "Lahore Garrison", 14.9, 39],
  [31.5200, 74.3580, "Liberty Market", 31.4700, 74.3450, "Emporium Mall", 8.2, 27],
  [31.4800, 74.4100, "DHA Phase 5", 31.5000, 74.4200, "Lahore Garrison", 5.4, 18],
  [31.5500, 74.3300, "Shalimar", 31.4700, 74.2800, "Model Town", 11.7, 34],
  [31.4300, 74.2500, "Wapda Town", 31.5600, 74.3700, "Allama Iqbal Town", 16.8, 45],
  [31.5000, 74.3000, "Garden Town", 31.5400, 74.4000, "DHA Phase 6", 13.2, 36],
  [31.4600, 74.3000, "Faisal Town", 31.5100, 74.2900, "Gulberg", 6.9, 22],
  [31.4900, 74.2500, "Township", 31.5350, 74.3150, "Mall Road", 9.4, 30],
  [31.4700, 74.3300, "Garden Town", 31.5200, 74.3600, "Liberty Market", 7.1, 23],
];
const headers = ["id", "comparison_id", "data_source", "provider_id", "provider", "provider_category_id", "provider_category_name", "vehicle_type", "pickup_latitude", "pickup_longitude", "pickup_zone", "destination_latitude", "destination_longitude", "destination_zone", "distance_meters", "duration_seconds", "fare", "fare_min", "fare_max", "currency", "fare_type", "pickup_eta_seconds", "observed_at", "hour_of_day", "day_of_week", "is_weekend", "weather_condition", "weather_severity", "precipitation_mm", "temperature_c"];

function random() { let value = SEED; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; }
function csv(value) { const text = String(value ?? ""); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function round(value) { return Math.round(value * 100) / 100; }

function buildRows() {
  const next = random();
  const rows = [];
  for (let comparison = 0; comparison < ROW_COUNT / providers.length; comparison += 1) {
    const route = routes[comparison % routes.length];
    const vehicleType = ["BIKE", "RICKSHAW", "ECONOMY_CAR", "STANDARD_CAR"][comparison % 4];
    const hour = [8, 11, 14, 18, 21][comparison % 5];
    const day = comparison % 7;
    const weather = comparison % 10 === 7 ? ["RAIN", "MODERATE", 3.2, 25] : ["CLEAR", "NONE", 0, 29];
    for (const provider of providers) {
      const [categoryId, categoryName, base, perKm, perMinute, minimum] = provider.categories[vehicleType];
      const duration = route[7] + Math.round(next() * 5);
      const contextFactor = 1 + (hour >= 7 && hour <= 10 || hour >= 16 && hour <= 19 ? 0.02 : 0) + (day === 0 || day === 6 ? 0.008 : 0);
      const weatherFactor = weather[0] === "RAIN" ? 1.05 : 1;
      const deterministicFare = Math.max(minimum, (base + route[6] * perKm + duration * perMinute) * contextFactor * weatherFactor);
      const fare = Math.max(minimum, Math.round(deterministicFare * (0.985 + next() * 0.03)));
      const observedAt = Date.UTC(2026, 0, 5 + comparison, hour - 5, comparison % 60);
      const spread = provider.name === "indrive" ? 0.15 : 0;
      rows.push({
        id: `synthetic-${String(rows.length + 1).padStart(4, "0")}`, comparison_id: `synthetic-comparison-${String(comparison + 1).padStart(4, "0")}`, data_source: "SIMULATED", provider_id: provider.id, provider: provider.name, provider_category_id: categoryId, provider_category_name: categoryName, vehicle_type: vehicleType,
        pickup_latitude: route[0], pickup_longitude: route[1], pickup_zone: route[2], destination_latitude: route[3], destination_longitude: route[4], destination_zone: route[5], distance_meters: Math.round(route[6] * 1000), duration_seconds: duration * 60, fare, fare_min: spread ? Math.max(minimum, Math.round(fare * (1 - spread))) : "", fare_max: spread ? Math.round(fare * (1 + spread)) : "", currency: "PKR", fare_type: provider.name === "indrive" ? "RECOMMENDED" : "ESTIMATE", pickup_eta_seconds: (5 + (vehicleType === "BIKE" ? 0 : 1) + (day === 0 || day === 6 ? 1 : 0)) * 60, observed_at: observedAt, hour_of_day: hour, day_of_week: day, is_weekend: day === 0 || day === 6 ? 1 : 0, weather_condition: weather[0], weather_severity: weather[1], precipitation_mm: weather[2], temperature_c: weather[3],
      });
    }
  }
  return rows;
}

function main() {
  const rows = buildRows();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csv(row[header])).join(",")).join("\n")}\n`, "utf8");
  console.log(`Generated ${rows.length} synthetic observations at ${OUTPUT} using seed ${SEED}`);
}

if (require.main === module) main();
module.exports = { SEED, ROW_COUNT, headers, buildRows };
