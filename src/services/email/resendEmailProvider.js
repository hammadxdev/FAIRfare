const { Resend } = require("resend");
const emailConfig = require("../../config/email");

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function send({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = emailConfig.from();
  if (!apiKey) throw providerError("EMAIL_PROVIDER_NOT_CONFIGURED", "Email provider is not configured");
  if (!from) throw providerError("EMAIL_SENDER_NOT_CONFIGURED", "Email sender is not configured");
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to, subject, html, text });
    if (result?.error) throw providerError("EMAIL_PROVIDER_ERROR", "Email provider rejected the message");
    return { accepted: true, id: result?.data?.id || null };
  } catch (error) {
    if (error.code?.startsWith("EMAIL_")) throw error;
    throw providerError("EMAIL_PROVIDER_ERROR", "Email provider request failed");
  }
}

module.exports = { send };
