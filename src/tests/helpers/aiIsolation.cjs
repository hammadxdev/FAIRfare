// Preload in a dedicated test process. No .env files, sockets or real DB clients.
const Module = require("node:module");
const path = require("node:path");
const blocked = () => { throw Object.assign(new Error("Unmocked I/O blocked by AI test isolation"), { code: "TEST_IO_BLOCKED" }); };
process.env.NODE_ENV = "test";
for (const key of Object.keys(process.env)) {
  if (/DATABASE|SUPABASE|API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^PG|^VERCEL|^AI_|^GROQ_|^FAIRFARE_AI_/.test(key)) delete process.env[key];
}
process.env.JWT_ACCESS_SECRET = "isolated-synthetic-jwt-secret";
const originalLoad = Module._load;
Module._load = function (id, parent, main) {
  if (id === "dotenv") return { config: () => ({ parsed: {} }) };
  if (["pg", "better-sqlite3", "@supabase/supabase-js"].includes(id)) return new Proxy({}, { get: () => blocked });
  return originalLoad.call(this, id, parent, main);
};
for (const id of ["node:http", "node:https"]) {
  const module = require(id);
  module.request = blocked;
  module.get = blocked;
}
require("node:net").Socket.prototype.connect = blocked;
require("node:tls").connect = blocked;
global.fetch = blocked;
let queryHandler = blocked;
const postgres = {
  pool: null, requirePool: blocked, checkPostgres: blocked,
  query: (...args) => queryHandler(...args),
  withTransaction: (work) => work({ query: (...args) => queryHandler(...args) }),
};
const filename = path.resolve(__dirname, "../../config/postgres.js");
require.cache[filename] = { id: filename, filename, loaded: true, exports: postgres };
module.exports = { setQuery: (handler) => { queryHandler = handler || blocked; }, blocked };
