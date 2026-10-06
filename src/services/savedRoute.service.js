const { query } = require("../config/postgres");
const AppError = require("../utils/AppError");

const LABEL_TYPES = ["HOME", "WORK", "UNIVERSITY", "FAVORITE", "CUSTOM"];
const COORDINATE_TOLERANCE = 0.0001;

function duplicateError() {
  const error = new AppError("This route is already saved", 409);
  error.code = "ALREADY_SAVED";
  return error;
}

function numericCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    labelType: row.label_type,
    pickup: { name: row.pickup_name, address: row.pickup_address, lat: numericCoordinate(row.pickup_latitude), lng: numericCoordinate(row.pickup_longitude) },
    destination: { name: row.destination_name, address: row.destination_address, lat: numericCoordinate(row.destination_latitude), lng: numericCoordinate(row.destination_longitude) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectById(id, userId) {
  return (await query("SELECT * FROM saved_routes WHERE id = $1 AND user_id = $2", [id, userId])).rows[0] || null;
}

async function listSavedRoutes(userId) {
  return (await query("SELECT * FROM saved_routes WHERE user_id = $1 ORDER BY created_at DESC, id DESC", [userId])).rows.map(mapRow);
}

async function getSavedRoute(id, userId) { return mapRow(await selectById(id, userId)); }

async function duplicateExists({ userId, pickup, destination, excludeId = null }) {
  const params = [userId]; const filter = excludeId ? "AND id != $2" : ""; if (excludeId) params.push(excludeId);
  const rows = (await query(`SELECT id, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude FROM saved_routes WHERE user_id = $1 ${filter}`, params)).rows;
  return rows.find((row) =>
    Math.abs(row.pickup_latitude - pickup.latitude) <= COORDINATE_TOLERANCE &&
    Math.abs(row.pickup_longitude - pickup.longitude) <= COORDINATE_TOLERANCE &&
    Math.abs(row.destination_latitude - destination.latitude) <= COORDINATE_TOLERANCE &&
    Math.abs(row.destination_longitude - destination.longitude) <= COORDINATE_TOLERANCE);
}

async function createSavedRoute({ userId, name, labelType, pickup, destination }) {
  if (await duplicateExists({ userId, pickup, destination })) throw duplicateError();
  const result = await query(`INSERT INTO saved_routes
    (user_id, name, label_type, pickup_name, pickup_address, pickup_latitude, pickup_longitude,
     destination_name, destination_address, destination_latitude, destination_longitude)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [userId,name,labelType,pickup.name,pickup.address || null,pickup.latitude,pickup.longitude,destination.name,destination.address || null,destination.latitude,destination.longitude]);
  return getSavedRoute(result.rows[0].id, userId);
}

async function updateSavedRoute({ id, userId, changes }) {
  const existing = await selectById(id, userId);
  if (!existing) return null;
  const pickup = changes.pickup || { name: existing.pickup_name, address: existing.pickup_address, latitude: existing.pickup_latitude, longitude: existing.pickup_longitude };
  const destination = changes.destination || { name: existing.destination_name, address: existing.destination_address, latitude: existing.destination_latitude, longitude: existing.destination_longitude };
  if (changes.pickup || changes.destination) {
    const duplicate = await duplicateExists({ userId, pickup, destination, excludeId: id });
    if (duplicate) throw duplicateError();
  }
  await query(`UPDATE saved_routes SET name = $1, label_type = $2,
    pickup_name = $3, pickup_address = $4, pickup_latitude = $5, pickup_longitude = $6,
    destination_name = $7, destination_address = $8, destination_latitude = $9, destination_longitude = $10,
    updated_at = now() WHERE id = $11 AND user_id = $12`, [changes.name ?? existing.name,changes.labelType ?? existing.label_type,pickup.name,pickup.address || null,pickup.latitude,pickup.longitude,destination.name,destination.address || null,destination.latitude,destination.longitude,id,userId]);
  return getSavedRoute(id, userId);
}

async function deleteSavedRoute(id, userId) {
  const result = await query("DELETE FROM saved_routes WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount > 0;
}

module.exports = { LABEL_TYPES, listSavedRoutes, getSavedRoute, createSavedRoute, updateSavedRoute, deleteSavedRoute };
