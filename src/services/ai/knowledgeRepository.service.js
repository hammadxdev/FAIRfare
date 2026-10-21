const { query: defaultQuery } = require("../../config/postgres");

const MAX_QUERY_LENGTH = 300;
const MAX_RESULTS = 5;
const SAFE_STATUSES = new Set(["verified"]);
const SENSITIVE_KEY = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|cookie|credential|private|raw[_-]?response|user[_-]?id|email|phone|address|latitude|longitude|location)/i;

let queryFn = defaultQuery;

function cleanText(value, max) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text ? text.slice(0, max) : null;
}

function safeMetadata(value, depth = 0) {
  if (depth > 3 || value == null) return {};
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeMetadata(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 300) : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE_KEY.test(key)).slice(0, 40).map(([key, child]) => [key.slice(0, 80), safeMetadata(child, depth + 1)]));
}

function normalizeLanguage(language) {
  return ["english", "roman_urdu", "mixed"].includes(language) ? language : null;
}

function normalizeDocument(input = {}) {
  return {
    slug: cleanText(input.slug, 160),
    documentType: cleanText(input.documentType, 60),
    title: cleanText(input.title, 240),
    language: normalizeLanguage(input.language),
    sourceName: cleanText(input.sourceName, 160),
    sourceLocator: cleanText(input.sourceLocator, 500),
    sourceVersion: cleanText(input.sourceVersion, 120),
    provenance: cleanText(input.provenance, 500),
    verificationStatus: ["draft", "reviewed", "verified", "retired"].includes(input.verificationStatus) ? input.verificationStatus : "draft",
    verifiedAt: input.verifiedAt || null,
    effectiveFrom: input.effectiveFrom || null,
    effectiveUntil: input.effectiveUntil || null,
    contentHash: cleanText(input.contentHash, 128),
    metadata: safeMetadata(input.metadata),
  };
}

async function upsertDocument(input) {
  const document = normalizeDocument(input);
  if (!document.slug || !document.documentType || !document.title || !document.language || !document.sourceName || !document.sourceVersion || !document.provenance || !document.contentHash) {
    const error = new Error("Invalid knowledge document"); error.code = "INVALID_KNOWLEDGE_DOCUMENT"; throw error;
  }
  const result = await queryFn(
    `INSERT INTO fairfare_knowledge_documents
      (slug, document_type, title, language, source_name, source_locator, source_version, provenance,
       verification_status, verified_at, effective_from, effective_until, content_hash, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     ON CONFLICT (slug, source_version) DO UPDATE SET
       document_type=EXCLUDED.document_type, title=EXCLUDED.title, language=EXCLUDED.language,
       source_name=EXCLUDED.source_name, source_locator=EXCLUDED.source_locator,
       provenance=EXCLUDED.provenance, verification_status=EXCLUDED.verification_status,
       verified_at=EXCLUDED.verified_at, effective_from=EXCLUDED.effective_from,
       effective_until=EXCLUDED.effective_until, content_hash=EXCLUDED.content_hash,
       metadata_json=EXCLUDED.metadata_json, updated_at=now()
     RETURNING id, slug, source_version, verification_status, verified_at, effective_from, effective_until, content_hash`,
    [document.slug, document.documentType, document.title, document.language, document.sourceName, document.sourceLocator, document.sourceVersion, document.provenance, document.verificationStatus, document.verifiedAt, document.effectiveFrom, document.effectiveUntil, document.contentHash, JSON.stringify(document.metadata)],
  );
  return result.rows[0];
}

async function replaceChunks(documentId, chunks = []) {
  if (!documentId || !Array.isArray(chunks) || chunks.length > 500) {
    const error = new Error("Invalid knowledge chunks"); error.code = "INVALID_KNOWLEDGE_CHUNKS"; throw error;
  }
  return transactionFn(async (client) => {
    await client.query("DELETE FROM fairfare_knowledge_chunks WHERE document_id=$1", [documentId]);
    const results = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] || {};
      const body = cleanText(chunk.body, 12000);
      if (!body) continue;
      const heading = cleanText(chunk.heading, 240);
      const aliases = Array.isArray(chunk.aliases) ? chunk.aliases.map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 50) : [];
      const result = await client.query(
        `INSERT INTO fairfare_knowledge_chunks
          (document_id, chunk_index, heading, body, aliases, search_vector, token_count)
         VALUES ($1,$2,$3,$4,$5,
           setweight(to_tsvector('simple', coalesce($3,'')), 'A') ||
           setweight(to_tsvector('simple', $4), 'B') ||
           setweight(to_tsvector('simple', array_to_string($5::text[], ' ')), 'A'), $6)
         RETURNING id, document_id, chunk_index`,
        [documentId, index, heading, body, aliases, Number.isFinite(Number(chunk.tokenCount)) ? Math.max(1, Math.min(3000, Math.floor(Number(chunk.tokenCount)))) : null],
      );
      results.push(result.rows[0]);
    }
    return results;
  });
}

async function searchVerifiedKnowledge({ query, language = null, topic = null, limit = MAX_RESULTS } = {}) {
  const cleanQuery = cleanText(query, MAX_QUERY_LENGTH);
  if (!cleanQuery) return [];
  const boundedLimit = Math.max(1, Math.min(MAX_RESULTS, Number(limit) || MAX_RESULTS));
  const languageFilter = normalizeLanguage(language);
  const topicFilter = cleanText(topic, 80);
  const result = await queryFn(
    `SELECT c.id AS chunk_id, c.document_id, c.chunk_index, c.heading, c.body, c.aliases,
            d.slug, d.document_type, d.title, d.language, d.source_name, d.source_locator,
            d.source_version, d.provenance, d.verification_status, d.verified_at,
            d.effective_from, d.effective_until, d.content_hash,
            ts_rank_cd(c.search_vector, plainto_tsquery('simple', $1)) AS rank
       FROM fairfare_knowledge_chunks c
       JOIN fairfare_knowledge_documents d ON d.id = c.document_id
      WHERE d.verification_status = ANY($2::text[])
        AND (d.effective_from IS NULL OR d.effective_from <= now())
        AND (d.effective_until IS NULL OR d.effective_until > now())
        AND ($3::text IS NULL OR d.language = $3 OR d.language = 'mixed')
        AND ($4::text IS NULL OR d.document_type = $4 OR d.slug ILIKE '%' || $4 || '%')
        AND c.search_vector @@ plainto_tsquery('simple', $1)
      ORDER BY rank DESC, d.verified_at DESC NULLS LAST, c.chunk_index ASC
      LIMIT $5`,
    [cleanQuery, [...SAFE_STATUSES], languageFilter, topicFilter, boundedLimit],
  );
  return result.rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    heading: row.heading,
    body: String(row.body || "").slice(0, 12000),
    aliases: Array.isArray(row.aliases) ? row.aliases.slice(0, 50) : [],
    score: Number(row.rank) || 0,
    source: {
      slug: row.slug,
      type: row.document_type,
      title: row.title,
      language: row.language,
      name: row.source_name,
      locator: row.source_locator,
      version: row.source_version,
      provenance: row.provenance,
      verificationStatus: row.verification_status,
      verifiedAt: row.verified_at,
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
      contentHash: row.content_hash,
    },
  }));
}

async function retireDocument({ slug, sourceVersion } = {}) {
  const result = await queryFn("UPDATE fairfare_knowledge_documents SET verification_status='retired', updated_at=now() WHERE slug=$1 AND ($2::text IS NULL OR source_version=$2) RETURNING id, slug, source_version, verification_status", [cleanText(slug, 160), cleanText(sourceVersion, 120)]);
  return result.rows;
}

function setQueryForTests(fn) { queryFn = fn || defaultQuery; }
function resetQueryForTests() { queryFn = defaultQuery; }

module.exports = { upsertDocument, replaceChunks, searchVerifiedKnowledge, retireDocument, normalizeDocument, safeMetadata, setQueryForTests, resetQueryForTests, MAX_QUERY_LENGTH, MAX_RESULTS };
