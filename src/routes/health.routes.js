const { Router } = require("express");
const { success } = require("../utils/apiResponse");
const postgres = require("../config/postgres");

const router = Router();

router.get("/", async (req, res) => {
  const database = await postgres.checkPostgres().catch(() => ({ configured: Boolean(process.env.DATABASE_URL), reachable: false }));
  return success(res, { message: "FairFare backend is running", data: { application: "alive", database: database.reachable ? "connected" : database.configured ? "unreachable" : "not_configured" } });
});

router.get("/config", (req, res) => res.json({ success: true, data: {
  JWT_ACCESS_SECRET: Boolean(process.env.JWT_ACCESS_SECRET), AI_API_KEY: Boolean(process.env.AI_API_KEY),
  GOOGLE_OAUTH: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID), OTP_PROVIDER: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID), MAPS_KEY: Boolean(process.env.GOOGLE_MAPS_API_KEY),
} }));

module.exports = router;
