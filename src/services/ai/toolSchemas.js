const MAX_QUERY_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const MAX_PROVIDER_LENGTH = 40;
const MAX_CODE_LENGTH = 80;

function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value, max, nullable = true) { if (value === null && nullable) return true; return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function numberValue(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function objectKeysOnly(value, allowed) { return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key)); }
function validateLocation(value) { return objectKeysOnly(value, ["lat", "lng", "placeId"]) && numberValue(value.lat, -90, 90) && numberValue(value.lng, -180, 180) && stringValue(value.placeId, 150); }

const schemas = Object.freeze({
  get_current_trip: { type: "object", properties: { conversationId: { type: ["string", "null"], maxLength: MAX_ID_LENGTH } }, additionalProperties: false },
  get_latest_comparison: { type: "object", properties: { comparisonId: { type: ["string", "null"], maxLength: MAX_ID_LENGTH }, includeHistorical: { type: "boolean" } }, additionalProperties: false },
  lookup_provider_service: { type: "object", properties: { comparisonId: { type: ["string", "null"], maxLength: MAX_ID_LENGTH }, provider: { type: ["string", "null"], maxLength: MAX_PROVIDER_LENGTH }, serviceCode: { type: ["string", "null"], maxLength: MAX_CODE_LENGTH } }, additionalProperties: false },
  search_locations: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: MAX_QUERY_LENGTH }, cityHint: { type: ["string", "null"], maxLength: 80 } }, required: ["query"], additionalProperties: false },
  calculate_route: { type: "object", properties: { pickup: { type: "object" }, dropoff: { type: "object" } }, required: ["pickup", "dropoff"], additionalProperties: false },
  compare_live_fares: { type: "object", properties: { pickup: { type: "object" }, dropoff: { type: "object" }, vehicleType: { type: ["string", "null"], maxLength: 40 }, route: { type: ["object", "null"] }, explicitComparisonIntent: { type: "boolean" } }, required: ["pickup", "dropoff", "explicitComparisonIntent"], additionalProperties: false },
  get_provider_status: { type: "object", properties: { provider: { type: ["string", "null"], maxLength: MAX_PROVIDER_LENGTH } }, additionalProperties: false },
  get_conversation_context: { type: "object", properties: { conversationId: { type: "string", maxLength: MAX_ID_LENGTH }, maxMessages: { type: "integer", minimum: 1, maximum: 12 } }, required: ["conversationId", "maxMessages"], additionalProperties: false },
  search_fairride_knowledge: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 300 }, language: { type: "string", enum: ["english", "roman_urdu"] }, topic: { type: ["string", "null"], maxLength: 80 } }, required: ["query"], additionalProperties: false },
  plan_trip: { type: "object", properties: { message: { type: "string", minLength: 2, maxLength: 1000 }, requestTimestamp: { type: ["string", "null"], maxLength: 80 }, timezone: { type: ["string", "null"], maxLength: 80 }, context: { type: ["object", "null"] } }, required: ["message"], additionalProperties: false },
  forecast_fare: { type: "object", properties: { providerId: { type: ["string", "null"], maxLength: 40 }, vehicleType: { type: ["string", "null"], maxLength: 40 }, route: { type: ["object", "null"] }, forecastAt: { type: ["string", "null"], maxLength: 80 } }, additionalProperties: false },
});

function validateType(value, rule) {
  if (Array.isArray(rule.type)) return rule.type.some((type) => type === "null" ? value === null : type === "string" ? stringValue(value, rule.maxLength, false) : type === "object" ? isPlainObject(value) : type === "boolean" ? typeof value === "boolean" : type === "integer" ? Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum : true);
  if (rule.type === "string") return stringValue(value, rule.maxLength, false) && (!rule.minLength || value.trim().length >= rule.minLength) && (!rule.enum || rule.enum.includes(value));
  if (rule.type === "boolean") return typeof value === "boolean";
  if (rule.type === "integer") return Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum;
  if (rule.type === "object") return isPlainObject(value);
  return true;
}

function validateToolArguments(name, args) {
  const schema = schemas[name];
  if (!schema) return { ok: false, code: "UNKNOWN_TOOL" };
  if (!isPlainObject(args) || !schema.additionalProperties && Object.keys(args).some((key) => !Object.hasOwn(schema.properties, key))) return { ok: false, code: "INVALID_TOOL_ARGUMENTS" };
  for (const required of schema.required || []) if (!Object.hasOwn(args, required)) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", field: required };
  for (const [key, rule] of Object.entries(schema.properties)) if (Object.hasOwn(args, key) && !validateType(args[key], rule)) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", field: key };
  if (["calculate_route", "compare_live_fares"].includes(name) && (!validateLocation(args.pickup) || !validateLocation(args.dropoff))) return { ok: false, code: "INVALID_LOCATION_ARGUMENTS" };
  if (name === "compare_live_fares" && args.route !== null && args.route !== undefined && (!isPlainObject(args.route) || Object.keys(args.route).some((key) => !["distanceKm", "durationMin", "distanceMeters", "durationSeconds", "compareFaresEligible", "eligibilityReason"].includes(key)))) return { ok: false, code: "INVALID_ROUTE_ARGUMENTS" };
  return { ok: true };
}

module.exports = { schemas, validateToolArguments, validateLocation, MAX_QUERY_LENGTH, MAX_ID_LENGTH, MAX_PROVIDER_LENGTH, MAX_CODE_LENGTH };
