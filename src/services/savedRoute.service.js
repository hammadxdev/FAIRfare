const db = require("../config/database");
const AppError = require("../utils/AppError");

const LABEL_TYPES = ["HOME", "WORK", "UNIVERSITY", "FAVORITE", "CUSTOM"];
const COORDINATE_TOLERANCE = 0.0001;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    labelType: row.label_type,
    pickup: { name: row.pickup_name, address: row.pickup_address, latitude: row.pickup_latitude, longitude: row.pickup_longitude },
    destination: { name: row.destination_name, address: row.destination_address, latitude: row.destination_latitude, longitude: row.destination_longitude },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selectById(id, userId) {
  return db.prepare("SELECT * FROM saved_routes WHERE id = ? AND user_id = ?").get(id, userId);
}

function listSavedRoutes(userId) {
  return db.prepare("SELECT * FROM saved_routes WHERE user_id = ? ORDER BY created_at DESC, id DESC").all(userId).map(mapRow);
}

function getSavedRoute(id, userId) { return mapRow(selectById(id, userId)); }

function duplicateExists({ userId, pickup, destination, excludeId = null }) {
  const rows = db.prepare(`SELECT id, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude
    FROM saved_routes WHERE user_id = ? ${excludeId ? "AND id != ?" : ""}`).all(...(excludeId ? [userId, excludeId] : [userId]));
  return rows.find((row) =>
    Math.abs(row.pickup_latitude - pickup.latitude) <= COORDINATE_TOLERANCE &&
    Math.abs(row.pickup_longitude - pickup.longitude) <= COORDINATE_TOLERANCE &&
    Math.abs(row.destination_latitude - destination.latitude) <= COORDINATE_TOLERANCE &&
    Math.abs(row.destination_longitude - destination.longitude) <= COORDINATE_TOLERANCE);
}

function createSavedRoute({ userId, name, labelType, pickup, destination }) {
  if (duplicateExists({ userId, pickup, destination })) throw new AppError("This route is already saved", 409);
  const result = db.prepare(`INSERT INTO saved_routes
    (user_id, name, label_type, pickup_name, pickup_address, pickup_latitude, pickup_longitude,
     destination_name, destination_address, destination_latitude, destination_longitude)
    VALUES (@user_id, @name, @label_type, @pickup_name, @pickup_address, @pickup_latitude, @pickup_longitude,
      @destination_name, @destination_address, @destination_latitude, @destination_longitude)`).run({
    user_id: userId, name, label_type: labelType,
    pickup_name: pickup.name, pickup_address: pickup.address || null, pickup_latitude: pickup.latitude, pickup_longitude: pickup.longitude,
    destination_name: destination.name, destination_address: destination.address || null, destination_latitude: destination.latitude, destination_longitude: destination.longitude,
  });
  return getSavedRoute(result.lastInsertRowid, userId);
}

function updateSavedRoute({ id, userId, changes }) {
  const existing = selectById(id, userId);
  if (!existing) return null;
  const pickup = changes.pickup || { name: existing.pickup_name, address: existing.pickup_address, latitude: existing.pickup_latitude, longitude: existing.pickup_longitude };
  const destination = changes.destination || { name: existing.destination_name, address: existing.destination_address, latitude: existing.destination_latitude, longitude: existing.destination_longitude };
  if (changes.pickup || changes.destination) {
    const duplicate = duplicateExists({ userId, pickup, destination, excludeId: id });
    if (duplicate) throw new AppError("This route is already saved", 409);
  }
  db.prepare(`UPDATE saved_routes SET name = @name, label_type = @label_type,
    pickup_name = @pickup_name, pickup_address = @pickup_address, pickup_latitude = @pickup_latitude, pickup_longitude = @pickup_longitude,
    destination_name = @destination_name, destination_address = @destination_address, destination_latitude = @destination_latitude, destination_longitude = @destination_longitude,
    updated_at = datetime('now') WHERE id = @id AND user_id = @user_id`).run({
    id, user_id: userId, name: changes.name ?? existing.name, label_type: changes.labelType ?? existing.label_type,
    pickup_name: pickup.name, pickup_address: pickup.address || null, pickup_latitude: pickup.latitude, pickup_longitude: pickup.longitude,
    destination_name: destination.name, destination_address: destination.address || null, destination_latitude: destination.latitude, destination_longitude: destination.longitude,
  });
  return getSavedRoute(id, userId);
}

function deleteSavedRoute(id, userId) {
  const result = db.prepare("DELETE FROM saved_routes WHERE id = ? AND user_id = ?").run(id, userId);
  return result.changes > 0;
}

module.exports = { LABEL_TYPES, listSavedRoutes, getSavedRoute, createSavedRoute, updateSavedRoute, deleteSavedRoute };
