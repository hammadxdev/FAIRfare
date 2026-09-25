const db = require("../config/database");

function createComparisonHistory({ userId, pickup, dropoff, distanceKm, durationMin, vehicleType, results }) {
  const insertComparison = db.prepare(`
    INSERT INTO comparison_history
      (user_id, pickup_label, pickup_latitude, pickup_longitude, destination_label, destination_latitude, destination_longitude, distance_meters, duration_seconds)
    VALUES (@user_id, @pickup_label, @pickup_latitude, @pickup_longitude, @destination_label, @destination_latitude, @destination_longitude, @distance_meters, @duration_seconds)
  `);
  const insertQuote = db.prepare(`
    INSERT INTO comparison_history_quotes
      (comparison_id, provider, category, fare, fare_min, fare_max, currency, fare_type, pickup_eta_seconds, availability)
    VALUES (@comparison_id, @provider, @category, @fare, @fare_min, @fare_max, @currency, @fare_type, @pickup_eta_seconds, @availability)
  `);

  return db.transaction(() => {
    const comparison = insertComparison.run({
      user_id: userId,
      pickup_label: pickup.name,
      pickup_latitude: pickup.lat,
      pickup_longitude: pickup.lng,
      destination_label: dropoff.name,
      destination_latitude: dropoff.lat,
      destination_longitude: dropoff.lng,
      distance_meters: distanceKm == null ? null : distanceKm * 1000,
      duration_seconds: durationMin == null ? null : durationMin * 60,
    });
    const comparisonId = Number(comparison.lastInsertRowid);

    for (const result of results) {
      const quotes = Array.isArray(result.quotes) ? result.quotes : [result];
      for (const quote of quotes) {
        insertQuote.run({
          comparison_id: comparisonId,
          provider: result.provider.name,
          category: quote.categoryName || vehicleType || null,
          fare: quote.fare ?? null,
          fare_min: quote.fareMin ?? null,
          fare_max: quote.fareMax ?? null,
          currency: quote.currency || result.currency || "PKR",
          fare_type: quote.fareType || result.fareType || null,
          pickup_eta_seconds: quote.pickupEtaSeconds ?? (result.etaMin == null ? null : result.etaMin * 60),
          availability: quote.isAvailable === false || result.isAvailable === false ? "unavailable" : "available",
        });
      }
    }
    return comparisonId;
  })();
}

function mapHistoryRow(row) {
  return {
    id: row.id,
    searchedAt: row.created_at,
    pickup: { label: row.pickup_label, latitude: row.pickup_latitude, longitude: row.pickup_longitude },
    destination: { label: row.destination_label, latitude: row.destination_latitude, longitude: row.destination_longitude },
    route: { distanceMeters: row.distance_meters, durationSeconds: row.duration_seconds },
    quotes: row.quotes.map((quote) => ({
      provider: quote.provider,
      category: quote.category,
      fare: quote.fare,
      fareMin: quote.fare_min,
      fareMax: quote.fare_max,
      currency: quote.currency,
      fareType: quote.fare_type,
      pickupEtaSeconds: quote.pickup_eta_seconds,
      availability: quote.availability,
    })),
  };
}

function getHistory({ userId, limit = 20, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT * FROM comparison_history WHERE user_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
  const quoteStmt = db.prepare("SELECT * FROM comparison_history_quotes WHERE comparison_id = ? ORDER BY id ASC");
  return rows.map((row) => mapHistoryRow({ ...row, quotes: quoteStmt.all(row.id) }));
}

function getHistoryById(id, userId) {
  const row = db.prepare("SELECT * FROM comparison_history WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) return null;
  const quotes = db.prepare("SELECT * FROM comparison_history_quotes WHERE comparison_id = ? ORDER BY id ASC").all(id);
  return mapHistoryRow({ ...row, quotes });
}

module.exports = { createComparisonHistory, getHistory, getHistoryById };
