const { success } = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const { LABEL_TYPES, listSavedRoutes, getSavedRoute, createSavedRoute, updateSavedRoute, deleteSavedRoute } = require("../services/savedRoute.service");
const { isValidLat, isValidLng } = require("../utils/validators");

const MAX_NAME_LENGTH = 100;
function normalizeLocation(location, label, errors) {
  if (!location || typeof location !== "object") { errors.push(`${label} is required`); return null; }
  const latitude = location.latitude ?? location.lat;
  const longitude = location.longitude ?? location.lng;
  if (typeof location.name !== "string" || !location.name.trim()) errors.push(`${label}.name is required`);
  if (!isValidLat(latitude)) errors.push(`${label}.latitude must be between -90 and 90`);
  if (!isValidLng(longitude)) errors.push(`${label}.longitude must be between -180 and 180`);
  return { name: typeof location.name === "string" ? location.name.trim() : "", address: typeof location.address === "string" ? location.address.trim() : null, latitude, longitude };
}
function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const name = body?.name;
  if (!partial || name !== undefined) {
    if (typeof name !== "string" || !name.trim()) errors.push("name is required");
    else if (name.trim().length > MAX_NAME_LENGTH) errors.push(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  if (!partial || body?.labelType !== undefined) {
    if (!LABEL_TYPES.includes(body?.labelType)) errors.push(`labelType must be one of: ${LABEL_TYPES.join(", ")}`);
  }
  if (!partial || body?.pickup !== undefined) normalizeLocation(body?.pickup, "pickup", errors);
  if (!partial || body?.destination !== undefined) normalizeLocation(body?.destination, "destination", errors);
  return errors;
}
function normalizedBody(body) {
  return { name: body.name.trim(), labelType: body.labelType, pickup: normalizeLocation(body.pickup, "pickup", []), destination: normalizeLocation(body.destination, "destination", []) };
}

const list = asyncHandler(async (req, res) => success(res, { message: "Saved routes fetched successfully", data: listSavedRoutes(req.user.id) }));
const read = asyncHandler(async (req, res) => { const id = Number.parseInt(req.params.id, 10); const route = Number.isInteger(id) ? getSavedRoute(id, req.user.id) : null; if (!route) throw new AppError("Saved route not found", 404); return success(res, { data: route }); });
const create = asyncHandler(async (req, res) => { const errors = validatePayload(req.body); if (errors.length) throw new AppError("Validation failed", 400, errors); return success(res, { message: "Route saved", data: createSavedRoute({ userId: req.user.id, ...normalizedBody(req.body) }), statusCode: 201 }); });
const update = asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id)) throw new AppError("Invalid saved route id", 400);
  const existing = getSavedRoute(id, req.user.id); if (!existing) throw new AppError("Saved route not found", 404);
  const body = req.body || {}; const errors = validatePayload(body, { partial: true }); if (errors.length) throw new AppError("Validation failed", 400, errors);
  const changes = { name: body.name?.trim(), labelType: body.labelType };
  if (body.pickup) changes.pickup = normalizeLocation(body.pickup, "pickup", []);
  if (body.destination) changes.destination = normalizeLocation(body.destination, "destination", []);
  return success(res, { message: "Saved route updated", data: updateSavedRoute({ id, userId: req.user.id, changes }) });
});
const remove = asyncHandler(async (req, res) => { const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id)) throw new AppError("Invalid saved route id", 400); if (!deleteSavedRoute(id, req.user.id)) throw new AppError("Saved route not found", 404); return success(res, { message: "Saved route deleted", data: null }); });

module.exports = { list, read, create, update, remove };
