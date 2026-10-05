const fs = require("fs");
const path = require("path");
const readOnly = process.env.FAIRFARE_READ_ONLY === "true";
if (readOnly) process.env.FAIRFARE_READ_ONLY = "true";
else require("../src/db/bootstrap").ensureDatabaseReady();
const db = require("../src/config/database");

const columns = [
  "id", "comparison_id", "data_source", "provider_id", "provider", "provider_category_id", "provider_category_name", "vehicle_type",
  "pickup_latitude", "pickup_longitude", "pickup_zone", "destination_latitude", "destination_longitude", "destination_zone",
  "distance_meters", "duration_seconds", "fare", "fare_min", "fare_max", "currency", "fare_type", "pickup_eta_seconds",
  "observed_at", "hour_of_day", "day_of_week", "is_weekend", "weather_condition", "weather_severity", "precipitation_mm", "temperature_c",
];
const rows = db.prepare(`SELECT ${columns.join(", ")} FROM fare_observations ORDER BY observed_at ASC, id ASC`).all();
const csvValue = (value) => {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\n") + "\n";
const outputPath = process.env.FARE_DATASET_EXPORT_PATH || path.join(__dirname, "..", "data", "exports", "fare_observations.csv");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv, "utf8");
console.log(`Exported ${rows.length} observations to ${outputPath}`);
