const OFFICIAL_SOURCE = {
  name: "Punjab Masstransit Authority",
  url: "https://pma.punjab.gov.pk/index.php/",
  capturedAt: "2026-10-27T00:00:00.000Z",
};

const NETWORKS = [
  { id: "lahore_metrobus", mode: "metrobus", name: "Lahore Metrobus", from: "Gajjumata", to: "Shahdara", operatingHours: "06:00–22:00", fare: { min: 30, max: 30, currency: "PKR" } },
  { id: "lahore_orange_line", mode: "orange_line", name: "Orange Line Metro Train", from: "Dera Gujran", to: "Ali Town", operatingHours: "06:00–22:00", fare: { bands: [{ upToKm: 4, amount: 25 }, { upToKm: 8, amount: 30 }, { upToKm: 12, amount: 35 }, { upToKm: 16, amount: 40 }, { upToKm: 30, amount: 45 }], currency: "PKR" } },
  { id: "lahore_feeder_phase_1", mode: "feeder", name: "Lahore Feeder Routes (Phase I)", from: null, to: null, operatingHours: "06:00–23:00", fare: { bands: [{ journeys: 1, amount: 20 }, { journeys: 2, amount: 25 }, { journeys: 3, amount: 30 }], currency: "PKR" } },
];

function normalize(value) { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " "); }
function near(a, b, radiusKm = 2) {
  if (!a || !b || !Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(a.lng))) return false;
  const dLat = (Number(a.lat) - Number(b.lat)) * 111;
  const dLng = (Number(a.lng) - Number(b.lng)) * 96;
  return Math.sqrt(dLat * dLat + dLng * dLng) <= radiusKm;
}

function fareFor(network, distanceKm) {
  if (network.fare.amount || network.fare.min === network.fare.max) return { amount: network.fare.amount || network.fare.min, currency: network.fare.currency, rule: "single_journey" };
  if (network.mode === "orange_line") {
    const band = network.fare.bands.find((item) => distanceKm <= item.upToKm) || network.fare.bands.at(-1);
    return { amount: band.amount, currency: network.fare.currency, rule: `up_to_${band.upToKm}_km` };
  }
  return { amount: network.fare.bands[0].amount, currency: network.fare.currency, rule: "single_journey" };
}

function planLahoreTransit({ origin, destination, originName = "", destinationName = "" } = {}) {
  const cityText = `${originName} ${destinationName}`.toLowerCase();
  if (cityText && !/lahore|lahore district|gajjumata|shahdara|dera gujran|ali town/i.test(cityText)) {
    return { status: "UNSUPPORTED_CITY", city: "lahore", plans: [], source: OFFICIAL_SOURCE };
  }
  const from = normalize(originName);
  const to = normalize(destinationName);
  const metroMatch = ["gajjumata", "shahdara"].some((name) => from.includes(name) || to.includes(name));
  const orangeMatch = ["dera gujran", "ali town"].some((name) => from.includes(name) || to.includes(name));
  if (!metroMatch && !orangeMatch) {
    return { status: "INSUFFICIENT_VERIFIED_COVERAGE", city: "lahore", plans: [], source: OFFICIAL_SOURCE, message: "I could not verify a public-transport route for these exact locations from the current Lahore dataset." };
  }
  const network = orangeMatch ? NETWORKS[1] : NETWORKS[0];
  const fare = fareFor(network, 0);
  return {
    status: "OK",
    city: "lahore",
    plans: [{
      mode: network.mode,
      summary: `${network.name}: ${network.from} to ${network.to}`,
      segments: [{ mode: network.mode, service: network.name, board: network.from, alight: network.to, walking: null }],
      fare: { ...fare, confidence: "official" },
      duration: { minutes: null, confidence: "unavailable" },
      operatingHours: network.operatingHours,
      warnings: ["Station-to-station coverage is verified; exact first/last-mile routing is not available yet."],
    }],
    source: OFFICIAL_SOURCE,
  };
}

module.exports = { NETWORKS, OFFICIAL_SOURCE, planLahoreTransit };
