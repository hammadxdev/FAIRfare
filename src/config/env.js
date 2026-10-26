const path = require("path");
const dotenv = require("dotenv");

// Load the project-local environment once, before any configuration module is
// imported. dotenv's default override=false preserves Vercel/host-provided
// process.env values.
const envPath = path.resolve(__dirname, "..", "..", ".env");
dotenv.config({ path: envPath, quiet: true });

function environmentDiagnostics() {
  return {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ? "configured" : "missing",
    databaseUrl: process.env.DATABASE_URL ? "configured" : "missing",
    groqApiKey: process.env.GROQ_API_KEY ? "configured" : "missing",
    xaiApiKey: process.env.XAI_API_KEY ? "configured" : "missing",
    aiConfig: (process.env.GROQ_API_KEY || process.env.XAI_API_KEY || process.env.GEMINI_API_KEY) && (process.env.GROQ_MODEL || process.env.XAI_MODEL || process.env.GEMINI_MODEL)
      ? "configured"
      : "missing",
  };
}

module.exports = { envPath, environmentDiagnostics };
