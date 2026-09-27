// Short-lived server-owned context for the latest enriched comparison. The
// history tables intentionally remain fare snapshots; predictions and product
// recommendations are transient enrichment and must not be rewritten there.
const MAX_ENTRIES = 100;
const TTL_MS = Number(process.env.FAIRFARE_COMPARISON_CONTEXT_TTL_MS || 30 * 60 * 1000);
const entries = new Map();

function rememberComparison({ userId, comparison }) {
  if (!userId || !comparison?.comparisonId) return;
  entries.set(String(comparison.comparisonId), { userId: String(userId), comparison, expiresAt: Date.now() + TTL_MS });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

function getComparisonForUser(comparisonId, userId) {
  const id = String(comparisonId);
  const entry = entries.get(id);
  if (!entry || entry.userId !== String(userId)) return null;
  if (entry.expiresAt < Date.now()) { entries.delete(id); return null; }
  return entry.comparison;
}

function clearComparisonsForTests() { entries.clear(); }

module.exports = { rememberComparison, getComparisonForUser, clearComparisonsForTests };
