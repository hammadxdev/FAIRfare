const fs = require("fs");
const path = require("path");

const REQUIRED = ["id", "comparison_id", "data_source", "provider_id", "provider", "provider_category_id", "provider_category_name", "vehicle_type", "pickup_latitude", "pickup_longitude", "pickup_zone", "destination_latitude", "destination_longitude", "destination_zone", "distance_meters", "duration_seconds", "fare", "currency", "fare_type", "pickup_eta_seconds", "observed_at", "hour_of_day", "day_of_week", "is_weekend"];
const NUMERIC = ["pickup_latitude", "pickup_longitude", "destination_latitude", "destination_longitude", "distance_meters", "duration_seconds", "fare", "pickup_eta_seconds", "hour_of_day", "day_of_week", "is_weekend"];

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return { headers, rows: lines.map((line) => { const values = line.split(","); return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])); }) };
}

function validate(filePath, minimumRows = 500) {
  const { headers, rows } = parseCsv(fs.readFileSync(filePath, "utf8"));
  const errors = [];
  for (const field of REQUIRED) if (!headers.includes(field)) errors.push(`missing column: ${field}`);
  if (rows.length < minimumRows) errors.push(`expected at least ${minimumRows} rows, got ${rows.length}`);
  const ids = new Set(); const pairKeys = new Set();
  rows.forEach((row, index) => {
    const line = index + 2;
    if (ids.has(row.id)) errors.push(`duplicate id at line ${line}`); ids.add(row.id);
    const pair = `${row.comparison_id}|${row.provider}|${row.vehicle_type}`;
    if (pairKeys.has(pair)) errors.push(`duplicate comparison/provider/vehicle at line ${line}`); pairKeys.add(pair);
    if (row.data_source !== "SIMULATED") errors.push(`non-simulated source at line ${line}`);
    if (!row.provider || !row.vehicle_type || !row.pickup_zone || !row.destination_zone) errors.push(`missing categorical value at line ${line}`);
    for (const field of NUMERIC) if (!Number.isFinite(Number(row[field]))) errors.push(`invalid numeric ${field} at line ${line}`);
    if (Number(row.distance_meters) <= 0 || Number(row.duration_seconds) <= 0 || Number(row.fare) <= 0) errors.push(`non-positive fare/route value at line ${line}`);
    if (Math.abs(Number(row.pickup_latitude)) > 90 || Math.abs(Number(row.destination_latitude)) > 90 || Math.abs(Number(row.pickup_longitude)) > 180 || Math.abs(Number(row.destination_longitude)) > 180) errors.push(`coordinate out of range at line ${line}`);
    if (Number(row.hour_of_day) < 0 || Number(row.hour_of_day) > 23 || Number(row.day_of_week) < 0 || Number(row.day_of_week) > 6 || ![0, 1].includes(Number(row.is_weekend))) errors.push(`time feature out of range at line ${line}`);
  });
  const report = { file: path.resolve(filePath), rows: rows.length, headers, uniqueIds: ids.size, uniqueComparisonGroups: new Set(rows.map((row) => row.comparison_id)).size, errors };
  if (errors.length) { const error = new Error(`Dataset validation failed with ${errors.length} error(s)`); error.report = report; throw error; }
  return report;
}

if (require.main === module) {
  try { console.log(JSON.stringify(validate(process.argv[2] || path.join(__dirname, "..", "ml", "datasets", "fare_training_synthetic.csv")), null, 2)); }
  catch (error) { console.error(JSON.stringify(error.report || { error: error.message }, null, 2)); process.exitCode = 1; }
}

module.exports = { REQUIRED, validate, parseCsv };
