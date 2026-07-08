// Simple in-memory TTL cache used to avoid repeat Google Maps calls for the
// same input. No external cache (Redis etc.) needed for FYP-demo scale.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

class TTLCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, enabled = true } = {}) {
    this.ttlMs = ttlMs;
    this.enabled = enabled;
    this.store = new Map();
  }

  get(key) {
    if (!this.enabled) return undefined;

    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key, value, ttlMs) {
    if (!this.enabled) return;
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
  }

  clear() {
    this.store.clear();
  }
}

const cacheEnabled = process.env.GOOGLE_MAPS_ENABLE_CACHE !== "false";

// One cache per endpoint so keys/TTLs can differ and a clear() on one
// doesn't wipe the others.
const autocompleteCache = new TTLCache({ enabled: cacheEnabled, ttlMs: 2 * 60 * 1000 });
const placeDetailsCache = new TTLCache({ enabled: cacheEnabled, ttlMs: 30 * 60 * 1000 });
const reverseGeocodeCache = new TTLCache({ enabled: cacheEnabled, ttlMs: 30 * 60 * 1000 });
const routeCache = new TTLCache({ enabled: cacheEnabled, ttlMs: 10 * 60 * 1000 });

module.exports = {
  TTLCache,
  autocompleteCache,
  placeDetailsCache,
  reverseGeocodeCache,
  routeCache,
};
