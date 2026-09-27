function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function safeUser(row) { return { id: row.id, name: row.name, email: row.email, emailVerifiedAt: row.email_verified_at || null, createdAt: row.created_at, updatedAt: row.updated_at }; }
function basicEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

module.exports = { normalizeEmail, safeUser, basicEmail };
