const MAX_QUERY_LENGTH = 200;
const MAX_ID_LENGTH = 100;
const MAX_PROVIDER_LENGTH = 40;
const MAX_CODE_LENGTH = 80;

function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value, max, nullable = true) { if (value === null && nullable) return true; return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function numberValue(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function objectKeysOnly(value, allowed) { return isPlainObject(value) && Object.keys(value).every((key) => allowed.includes(key)); }
function validateLocation(value) { return objectKeysOnly(value, ["lat", "lng", "placeId", "name"]) && numberValue(value.lat, -90, 90) && numberValue(value.lng, -180, 180) && (!Object.hasOwn(value, "placeId") || stringValue(value.placeId, 150)) && (!Object.hasOwn(value, "name") || stringValue(value.name, 200)); }
const locationSchema = { type: "object", description: "A verified location from search_locations. Use numeric latitude and longitude exactly as returned; do not use place names or invented coordinates.", properties: { lat: { type: "number", description: "Verified latitude from search_locations." }, lng: { type: "number", description: "Verified longitude from search_locations." }, placeId: { type: ["string", "null"], maxLength: 150 }, name: { type: ["string", "null"], maxLength: 200 } }, required: ["lat", "lng"], additionalProperties: false };
const routeSchema = { type: ["object", "null"], properties: { distanceKm: { type: ["number", "null"] }, durationMin: { type: ["number", "null"] }, distanceMeters: { type: ["number", "null"] }, durationSeconds: { type: ["number", "null"] }, compareFaresEligible: { type: "boolean" }, eligibilityReason: { type: ["string", "null"], maxLength: 80 } }, additionalProperties: false };

const schemas = Object.freeze({
  get_current_trip: { type: "object", properties: { conversationId: { type: ["string", "null"], maxLength: MAX_ID_LENGTH } }, additionalProperties: false },
  get_latest_comparison: { type: "object", properties: { comparisonId: { type: ["string", "null"], maxLength: MAX_ID_LENGTH }, includeHistorical: { type: "boolean" } }, additionalProperties: false },
  lookup_provider_service: { type: "object", properties: { comparisonId: { type: ["string", "null"], maxLength: MAX_ID_LENGTH }, provider: { type: ["string", "null"], maxLength: MAX_PROVIDER_LENGTH }, serviceCode: { type: ["string", "null"], maxLength: MAX_CODE_LENGTH } }, additionalProperties: false },
  search_locations: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: MAX_QUERY_LENGTH }, cityHint: { type: ["string", "null"], maxLength: 80 } }, required: ["query"], additionalProperties: false },
  calculate_route: { type: "object", properties: { pickup: locationSchema, dropoff: locationSchema }, required: ["pickup", "dropoff"], additionalProperties: false },
  plan_lahore_transit: { type: "object", properties: { origin: locationSchema, destination: locationSchema, originName: { type: ["string", "null"], maxLength: 200 }, destinationName: { type: ["string", "null"], maxLength: 200 } }, required: ["origin", "destination"], additionalProperties: false },
  compare_live_fares: { type: "object", properties: { pickup: locationSchema, dropoff: locationSchema, vehicleType: { type: ["string", "null"], maxLength: 40 }, route: routeSchema, explicitComparisonIntent: { type: "boolean" } }, required: ["pickup", "dropoff", "explicitComparisonIntent"], additionalProperties: false },
  get_provider_status: { type: "object", properties: { provider: { type: ["string", "null"], maxLength: MAX_PROVIDER_LENGTH } }, additionalProperties: false },
  get_nearby_observation_context: { type: "object", properties: { pickup: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } }, required: ["lat", "lng"], additionalProperties: false }, category: { type: "string", minLength: 3, maxLength: 20, enum: ["bike", "car", "rickshaw", "mini"] }, provider: { type: ["string", "null"], maxLength: MAX_PROVIDER_LENGTH } }, required: ["pickup", "category"], additionalProperties: false },
  get_app_capabilities: { type: "object", properties: {}, additionalProperties: false },
  get_conversation_context: { type: "object", properties: { conversationId: { type: "string", maxLength: MAX_ID_LENGTH }, maxMessages: { type: "integer", minimum: 1, maximum: 12 } }, required: ["conversationId", "maxMessages"], additionalProperties: false },
  search_fairride_knowledge: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 300 }, language: { type: "string", enum: ["english", "roman_urdu"] }, topic: { type: ["string", "null"], maxLength: 80 } }, required: ["query"], additionalProperties: false },
  plan_trip: { type: "object", properties: { message: { type: "string", minLength: 2, maxLength: 1000 }, requestTimestamp: { type: ["string", "null"], maxLength: 80 }, timezone: { type: ["string", "null"], maxLength: 80 }, context: { type: ["object", "null"], properties: { pickup: { type: ["string", "null"], maxLength: 200 }, destination: { type: ["string", "null"], maxLength: 200 }, vehicleType: { type: ["string", "null"], maxLength: 40 }, city: { type: ["string", "null"], maxLength: 80 }, departureAt: { type: ["string", "null"], maxLength: 80 }, timezone: { type: ["string", "null"], maxLength: 80 } }, additionalProperties: false } }, required: ["message"], additionalProperties: false },
  forecast_fare: { type: "object", properties: { providerId: { type: "string", maxLength: MAX_PROVIDER_LENGTH, enum: ["indrive", "yango", "bykea"] }, vehicleType: { type: "string", maxLength: 20, enum: ["bike", "car", "rickshaw", "mini"] }, forecastAt: { type: "string", minLength: 20, maxLength: 40 } }, required: ["providerId", "vehicleType", "forecastAt"], additionalProperties: false },
});

function validateObject(value, rule) { return isPlainObject(value) && (rule.additionalProperties !== false || Object.keys(value).every((key) => Object.hasOwn(rule.properties || {}, key))) && Object.entries(rule.properties || {}).every(([key, nested]) => !Object.hasOwn(value, key) || validateType(value[key], nested)) && (rule.required || []).every((key) => Object.hasOwn(value, key)); }
function validateType(value, rule) {
  if (Array.isArray(rule.type)) return rule.type.some((type) => type === "null" ? value === null : type === "string" ? stringValue(value, rule.maxLength, false) && (!rule.minLength || value.trim().length >= rule.minLength) && (!rule.enum || rule.enum.includes(value)) : type === "object" ? validateObject(value, rule) : type === "boolean" ? typeof value === "boolean" : type === "integer" ? Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum : type === "number" ? typeof value === "number" && Number.isFinite(value) : false);
  if (rule.type === "string") return stringValue(value, rule.maxLength, false) && (!rule.minLength || value.trim().length >= rule.minLength) && (!rule.enum || rule.enum.includes(value));
  if (rule.type === "boolean") return typeof value === "boolean";
  if (rule.type === "integer") return Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum;
  if (rule.type === "object") return validateObject(value, rule);
  if (rule.type === "number") return typeof value === "number" && Number.isFinite(value);
  return true;
}

function validateToolArguments(name, args) {
  const schema = schemas[name];
  if (!schema) return { ok: false, code: "UNKNOWN_TOOL" };
  if (!isPlainObject(args) || !schema.additionalProperties && Object.keys(args).some((key) => !Object.hasOwn(schema.properties, key))) return { ok: false, code: "INVALID_TOOL_ARGUMENTS" };
  for (const required of schema.required || []) if (!Object.hasOwn(args, required)) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", field: required };
  if (name === "compare_live_fares" && args.route !== null && args.route !== undefined && !validateType(args.route, routeSchema)) return { ok: false, code: "INVALID_ROUTE_ARGUMENTS" };
  if (["calculate_route", "compare_live_fares"].includes(name) && (!validateLocation(args.pickup) || !validateLocation(args.dropoff))) return { ok: false, code: "INVALID_LOCATION_ARGUMENTS" };
  if (name === "plan_lahore_transit" && (!validateLocation(args.origin) || !validateLocation(args.destination))) return { ok: false, code: "INVALID_LOCATION_ARGUMENTS" };
  if (name === "get_nearby_observation_context" && (!objectKeysOnly(args.pickup, ["lat", "lng"]) || !numberValue(args.pickup.lat, -90, 90) || !numberValue(args.pickup.lng, -180, 180))) return { ok: false, code: "INVALID_LOCATION_ARGUMENTS" };
  for (const [key, rule] of Object.entries(schema.properties)) if (Object.hasOwn(args, key) && !validateType(args[key], rule)) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", field: key };
  if (name === "get_nearby_observation_context" && args.provider !== undefined && args.provider !== null && !["indrive", "yango", "bykea"].includes(String(args.provider).toLowerCase())) return { ok: false, code: "INVALID_TOOL_ARGUMENTS", field: "provider" };
  if (name === "forecast_fare" && (Number.isNaN(Date.parse(args.forecastAt)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(args.forecastAt))) return { ok: false, code: "INVALID_FORECAST_TIME", field: "forecastAt" };
  return { ok: true };
}

module.exports = { schemas, validateToolArguments, validateLocation, MAX_QUERY_LENGTH, MAX_ID_LENGTH, MAX_PROVIDER_LENGTH, MAX_CODE_LENGTH };
