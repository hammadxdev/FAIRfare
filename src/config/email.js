function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

module.exports = {
  from: () => String(process.env.EMAIL_FROM || "").trim(),
  verificationTtlMinutes: () => positiveInt(process.env.EMAIL_VERIFICATION_OTP_TTL_MINUTES, 10),
  resetTtlMinutes: () => positiveInt(process.env.PASSWORD_RESET_OTP_TTL_MINUTES, 10),
  resendCooldownSeconds: () => positiveInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
  maxAttempts: 5,
};
