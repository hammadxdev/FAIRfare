const path = require("path");
const dotenv = require("dotenv");

// Load the project-local environment once, before any configuration module is
// imported. dotenv's default override=false preserves Vercel/host-provided
// process.env values.
const envPath = path.resolve(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath, quiet: true });

function environmentDiagnostics() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
  return {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ? "configured" : "missing",
    databaseUrl: process.env.DATABASE_URL ? "configured" : "missing",
    groqApiKey: process.env.GROQ_API_KEY ? "configured" : "missing",
    openRouterApiKey: process.env.OPENROUTER_API_KEY
      ? "configured"
      : process.env.AI_API_KEY ? "configured_legacy" : "missing",
    aiConfig: (process.env.GROQ_API_KEY || openRouterApiKey) && process.env.AI_MODEL
      ? "configured"
      : "missing",
  };
}

module.exports = { envPath, environmentDiagnostics };
