// In-memory Google Maps usage tracking. Resets when the process restarts or
// when the calendar date changes — good enough for FYP-demo safety, not a
// substitute for real Google Cloud quota/billing alerts.
const dailyLimit = Number(process.env.GOOGLE_MAPS_DAILY_REQUEST_LIMIT || 500);

const REQUEST_TYPES = [
  "autocompleteRequests",
  "placeDetailsRequests",
  "reverseGeocodeRequests",
  "routeRequests",
];

const usage = {
  date: new Date().toDateString(),
  autocompleteRequests: 0,
  placeDetailsRequests: 0,
  reverseGeocodeRequests: 0,
  routeRequests: 0,
};

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (usage.date !== today) {
    usage.date = today;
    for (const type of REQUEST_TYPES) usage[type] = 0;
  }
}

function getTotal() {
  return REQUEST_TYPES.reduce((sum, type) => sum + usage[type], 0);
}

// Only call this right before making a real Google API call (not on cache hits).
function recordRequest(type) {
  resetIfNewDay();
  usage[type] += 1;
}

function hasReachedLimit() {
  resetIfNewDay();
  return getTotal() >= dailyLimit;
}

function getUsageSummary() {
  resetIfNewDay();
  return {
    autocompleteRequests: usage.autocompleteRequests,
    placeDetailsRequests: usage.placeDetailsRequests,
    reverseGeocodeRequests: usage.reverseGeocodeRequests,
    routeRequests: usage.routeRequests,
    totalGoogleRequests: getTotal(),
    dailyLimit,
  };
}

module.exports = { recordRequest, hasReachedLimit, getUsageSummary, dailyLimit };
