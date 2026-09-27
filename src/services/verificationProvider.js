const crypto = require("crypto");

function normalizeE164(value) { const phone = String(value || "").replace(/[\s().-]/g, ""); return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null; }
function configured() { return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID); }
async function send({ channel = "WHATSAPP", phoneNumber, purpose }) {
  if (!configured() && process.env.NODE_ENV === "production") { const error = new Error("OTP provider is not configured"); error.code = "OTP_PROVIDER_NOT_CONFIGURED"; throw error; }
  if (!configured()) { if (process.env.MOCK_VERIFICATION_PROVIDER !== "true") { const error = new Error("OTP provider is not configured"); error.code = "OTP_PROVIDER_NOT_CONFIGURED"; throw error; } return { accepted: true, mock: true }; }
  // Twilio Verify owns code generation, delivery, expiry, retry and attempt limits.
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID; const token = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: phoneNumber, Channel: channel.toLowerCase() === "whatsapp" ? "whatsapp" : "sms", CustomMessage: purpose || "Fair Fare verification" });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${sid}/Verifications`, { method: "POST", headers: { Authorization: `Basic ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params });
  if (!response.ok) { const error = new Error("OTP provider request failed"); error.code = "OTP_PROVIDER_ERROR"; throw error; }
  return { accepted: true };
}
async function verify({ phoneNumber, code }) {
  if (!configured()) { const error = new Error("OTP provider is not configured"); error.code = "OTP_PROVIDER_NOT_CONFIGURED"; throw error; }
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID; const token = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"); const params = new URLSearchParams({ To: phoneNumber, Code: String(code) });
  const response = await fetch(`https://verify.twilio.com/v2/Services/${sid}/VerificationCheck`, { method: "POST", headers: { Authorization: `Basic ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params }); const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== "approved") { const error = new Error("Invalid or expired verification code"); error.code = "OTP_INVALID"; throw error; } return { verified: true };
}
module.exports = { normalizeE164, configured, send, verify, hashCode: (value) => crypto.createHash("sha256").update(String(value)).digest("hex") };
