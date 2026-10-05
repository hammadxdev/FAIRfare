const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const CACHE_WINDOW_MS = 10 * 60 * 1000;
const CACHE = new Map();

function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }

function emptyWeather(observedAt = new Date().toISOString(), source = "UNAVAILABLE") {
  return { condition: "UNKNOWN", weatherSeverity: "UNKNOWN", precipitationMm: null, temperatureC: null, observedAt, source };
}

function normalizeWeatherResponse(payload, observedAt = new Date().toISOString(), source = "OPEN_METEO") {
  const current = payload?.current || payload?.current_weather || payload;
  if (!current || typeof current !== "object") return emptyWeather(observedAt, "MALFORMED");
  const code = finite(current.weather_code ?? current.weatherCode ?? current.code);
  const precipitationMm = finite(current.precipitation ?? current.precipitation_mm ?? current.rain);
  const temperatureC = finite(current.temperature_2m ?? current.temperatureC ?? current.temperature);
  if (code === null && precipitationMm === null && temperatureC === null) return emptyWeather(observedAt, "MALFORMED");

  let condition = "OTHER";
  if (code === 0 || code === 1) condition = "CLEAR";
  else if (code === 2 || code === 3) condition = "CLOUDY";
  else if (code === 45 || code === 48) condition = "FOG";
  else if (code >= 95) condition = "STORM";
  else if (code >= 80) condition = "RAIN";
  else if (code >= 51 && code <= 67) condition = "RAIN";
  else if (temperatureC !== null && temperatureC >= 35) condition = "HOT";
  if (temperatureC !== null && temperatureC >= 35 && (condition === "CLEAR" || condition === "CLOUDY")) condition = "HOT";

  const rainAmount = precipitationMm ?? 0;
  let weatherSeverity = "NONE";
  if (condition === "RAIN") {
    weatherSeverity = rainAmount >= 7 || code >= 80 && code <= 82 ? "HEAVY" : rainAmount >= 2 ? "MODERATE" : "LIGHT";
    if (weatherSeverity === "HEAVY") condition = "HEAVY_RAIN";
  } else if (condition === "STORM") weatherSeverity = "HEAVY";
  else if (condition === "FOG") weatherSeverity = "MODERATE";
  else if (condition === "HOT") weatherSeverity = "MODERATE";
  else if (condition === "CLEAR" || condition === "CLOUDY") weatherSeverity = "NONE";
  return { condition, weatherSeverity, precipitationMm, temperatureC, observedAt: current.time || observedAt, source };
}

function cacheKey(latitude, longitude, now) {
  return `${Number(latitude).toFixed(2)}:${Number(longitude).toFixed(2)}:${Math.floor(now / CACHE_WINDOW_MS)}`;
}

async function fetchCurrentWeather({ latitude, longitude, observedAt = Date.now(), fetchImpl = globalThis.fetch, timeoutMs = 2500 } = {}) {
  const lat = finite(latitude); const lon = finite(longitude);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return emptyWeather(new Date(observedAt).toISOString(), "INVALID_LOCATION");
  if (typeof fetchImpl !== "function") return emptyWeather(new Date(observedAt).toISOString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code&timezone=UTC`;
    const response = await fetchImpl(url, { method: "GET", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response?.ok) return emptyWeather(new Date(observedAt).toISOString(), "UNAVAILABLE");
    const payload = await response.json();
    return normalizeWeatherResponse(payload, new Date(observedAt).toISOString());
  } catch {
    return emptyWeather(new Date(observedAt).toISOString(), "UNAVAILABLE");
  } finally { clearTimeout(timer); }
}

async function resolveWeatherContext({ latitude, longitude, observedAt = Date.now(), fetchImpl = globalThis.fetch, timeoutMs } = {}) {
  const key = cacheKey(latitude, longitude, observedAt);
  if (CACHE.has(key)) return CACHE.get(key);
  const weather = process.env.FAIRFARE_WEATHER_ENABLED === "false"
    ? emptyWeather(new Date(observedAt).toISOString(), "DISABLED")
    : await fetchCurrentWeather({ latitude, longitude, observedAt, fetchImpl, timeoutMs: timeoutMs ?? Number(process.env.FAIRFARE_WEATHER_TIMEOUT_MS || 2500) });
  CACHE.set(key, weather);
  if (CACHE.size > 100) CACHE.delete(CACHE.keys().next().value);
  return weather;
}

function clearWeatherCache() { CACHE.clear(); }

module.exports = { WEATHER_URL, CACHE_WINDOW_MS, emptyWeather, normalizeWeatherResponse, fetchCurrentWeather, resolveWeatherContext, clearWeatherCache };
