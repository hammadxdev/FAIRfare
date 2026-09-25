const db = require("../config/database");
const AppError = require("../utils/AppError");

const VEHICLE_TYPES = new Set(["BIKE", "RICKSHAW", "ECONOMY_CAR", "STANDARD_CAR", "PREMIUM_CAR", "OTHER", "UNKNOWN"]);
const SELECTABLE_VEHICLE_TYPES = new Set(["BIKE", "RICKSHAW", "ECONOMY_CAR", "STANDARD_CAR", "PREMIUM_CAR", "OTHER"]);
const RIDE_PRIORITIES = new Set(["CHEAPEST", "FASTEST_PICKUP", "BALANCED"]);

function defaults() {
  return { preferredVehicleType: null, avoidedVehicleTypes: [], typicalBudget: null, ridePriority: "BALANCED", currency: "PKR" };
}

function parseAvoided(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function mapRow(row) {
  if (!row) return defaults();
  return {
    preferredVehicleType: row.preferred_vehicle_type || null,
    avoidedVehicleTypes: parseAvoided(row.avoided_vehicle_types),
    typicalBudget: row.typical_budget == null ? null : row.typical_budget,
    ridePriority: row.ride_priority || "BALANCED",
    currency: "PKR",
  };
}

function validate(input = {}) {
  const errors = [];
  const preferred = input.preferredVehicleType == null || input.preferredVehicleType === "" ? null : String(input.preferredVehicleType).trim().toUpperCase();
  const avoidedInput = input.avoidedVehicleTypes == null ? [] : input.avoidedVehicleTypes;
  if (!Array.isArray(avoidedInput)) errors.push("avoidedVehicleTypes must be an array");
  const avoided = Array.isArray(avoidedInput) ? [...new Set(avoidedInput.map((value) => String(value).trim().toUpperCase()))] : [];
  if (preferred && !VEHICLE_TYPES.has(preferred)) errors.push("preferredVehicleType is invalid");
  if (preferred === "UNKNOWN") errors.push("preferredVehicleType cannot be UNKNOWN");
  if (avoided.some((value) => !VEHICLE_TYPES.has(value) || value === "UNKNOWN")) errors.push("avoidedVehicleTypes contains an invalid vehicle type");
  if (preferred && avoided.includes(preferred)) errors.push("preferredVehicleType cannot also be avoided");

  let budget = input.typicalBudget;
  if (budget === "" || budget == null) budget = null;
  if (budget !== null && (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0 || budget > 10000000)) errors.push("typicalBudget must be a positive finite number no greater than 10000000");
  const priority = input.ridePriority == null || input.ridePriority === "" ? "BALANCED" : String(input.ridePriority).trim().toUpperCase();
  if (!RIDE_PRIORITIES.has(priority)) errors.push("ridePriority is invalid");
  if (errors.length) throw new AppError("Preference validation failed", 400, errors);
  return { preferredVehicleType: preferred, avoidedVehicleTypes: avoided, typicalBudget: budget, ridePriority: priority };
}

function getPreferences(userId) {
  const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(userId);
  if (!row) {
    db.prepare("INSERT INTO user_preferences (user_id) VALUES (?)").run(userId);
    return defaults();
  }
  return mapRow(row);
}

function updatePreferences(userId, input) {
  const values = validate(input);
  db.prepare(`
    INSERT INTO user_preferences (user_id, preferred_vehicle_type, avoided_vehicle_types, typical_budget, ride_priority, updated_at)
    VALUES (@user_id, @preferred_vehicle_type, @avoided_vehicle_types, @typical_budget, @ride_priority, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      preferred_vehicle_type = excluded.preferred_vehicle_type,
      avoided_vehicle_types = excluded.avoided_vehicle_types,
      typical_budget = excluded.typical_budget,
      ride_priority = excluded.ride_priority,
      updated_at = datetime('now')
  `).run({ user_id: userId, preferred_vehicle_type: values.preferredVehicleType, avoided_vehicle_types: JSON.stringify(values.avoidedVehicleTypes), typical_budget: values.typicalBudget, ride_priority: values.ridePriority });
  return getPreferences(userId);
}

module.exports = { VEHICLE_TYPES, SELECTABLE_VEHICLE_TYPES, RIDE_PRIORITIES, defaults, mapRow, validate, getPreferences, updatePreferences };
