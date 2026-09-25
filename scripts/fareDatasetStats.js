const readOnly = process.env.FAIRFARE_READ_ONLY === "true";
if (readOnly) process.env.FAIRFARE_READ_ONLY = "true";
else require("../src/db/bootstrap").ensureDatabaseReady();
const db = require("../src/config/database");
const total = db.prepare("SELECT COUNT(*) AS count FROM fare_observations").get().count;
const byProvider = db.prepare("SELECT provider, COUNT(*) AS count FROM fare_observations GROUP BY provider ORDER BY provider").all();
const bySource = db.prepare("SELECT data_source, COUNT(*) AS count FROM fare_observations GROUP BY data_source ORDER BY data_source").all();
const byVehicle = db.prepare("SELECT COALESCE(vehicle_type, 'MISSING') AS vehicle_type, COUNT(*) AS count FROM fare_observations GROUP BY vehicle_type ORDER BY vehicle_type").all();
const byCategory = db.prepare("SELECT provider, COALESCE(provider_category_name, provider_category_id, 'MISSING') AS category, COUNT(*) AS count FROM fare_observations GROUP BY provider, category ORDER BY provider, category").all();
const range = db.prepare("SELECT MIN(observed_at) AS first_observed_at, MAX(observed_at) AS last_observed_at FROM fare_observations").get();
const fareStats = db.prepare("SELECT MIN(fare) AS min_fare, MAX(fare) AS max_fare, AVG(fare) AS average_fare FROM fare_observations WHERE fare IS NOT NULL").get();
const missing = db.prepare(`SELECT
  SUM(CASE WHEN pickup_eta_seconds IS NULL THEN 1 ELSE 0 END) AS eta,
  SUM(CASE WHEN distance_meters IS NULL THEN 1 ELSE 0 END) AS distance,
  SUM(CASE WHEN duration_seconds IS NULL THEN 1 ELSE 0 END) AS duration,
  SUM(CASE WHEN vehicle_type IS NULL OR vehicle_type = '' THEN 1 ELSE 0 END) AS vehicle_type
  FROM fare_observations`).get();

console.log(`Total observations: ${total}`);
console.log("Providers:", byProvider);
console.log("Data sources:", bySource);
console.log("Vehicle types:", byVehicle);
console.log("Provider categories:", byCategory);
console.log("Date range:", { firstObservedAt: range.first_observed_at, lastObservedAt: range.last_observed_at });
console.log("Fare min/avg/max:", fareStats);
console.log("Missing fields:", missing);
