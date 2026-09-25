// Scores each result on a 70% price / 30% ETA weighting and flags
// cheapest / fastest / recommended. Lower score wins recommendation.
function applyRecommendation(results) {
  if (results.length === 0) return results;

  const fares = results.map((r) => r.fare);
  const etas = results.map((r) => r.etaMin).filter((eta) => typeof eta === "number");

  const lowestFare = Math.min(...fares);
  const highestFare = Math.max(...fares);
  const lowestEta = etas.length ? Math.min(...etas) : null;
  const highestEta = etas.length ? Math.max(...etas) : null;

  const scored = results.map((r) => {
    const normalizedFare = highestFare === 0 ? 0 : r.fare / highestFare;
    const normalizedEta = highestEta === null || r.etaMin === null ? 0.5 : highestEta === 0 ? 0 : r.etaMin / highestEta;
    const score = normalizedFare * 0.7 + normalizedEta * 0.3;
    return { ...r, score };
  });

  const lowestScore = Math.min(...scored.map((r) => r.score));

  const withFlags = scored.map((r) => {
    const isCheapest = r.fare === lowestFare;
    const isFastest = r.etaMin !== null && r.etaMin === lowestEta;
    const isRecommended = r.score === lowestScore;

    const badges = [];
    if (isCheapest) badges.push("Cheapest");
    if (isFastest) badges.push("Fastest");
    if (isRecommended) badges.push("Recommended");

    const { score, ...rest } = r;
    return { ...rest, isCheapest, isFastest, isRecommended, badges };
  });

  return withFlags.sort((a, b) => a.fare - b.fare);
}

module.exports = { applyRecommendation };
