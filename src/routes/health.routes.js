const { Router } = require("express");
const { success } = require("../utils/apiResponse");
const AppError = require("../utils/AppError");

const router = Router();

router.get("/", async (req, res) => {
  return success(res, { message: "FairFare backend is running", data: { application: "alive" } });
});

router.get("/config", (req, res, next) => {
  const configuredToken = String(process.env.HEALTH_DIAGNOSTICS_TOKEN || "");
  if (!configuredToken || req.get("x-health-diagnostics-token") !== configuredToken) return next(new AppError("Not found", 404));
  return res.json({ success: true, data: {
  JWT_ACCESS_SECRET: Boolean(process.env.JWT_ACCESS_SECRET),
  XAI_API_KEY: Boolean(process.env.XAI_API_KEY),
  GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
  GROQ_API_KEY: Boolean(process.env.GROQ_API_KEY),
  GOOGLE_OAUTH: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID), OTP_PROVIDER: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID), MAPS_KEY: Boolean(process.env.GEOAPIFY_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
  } });
});

module.exports = router;
