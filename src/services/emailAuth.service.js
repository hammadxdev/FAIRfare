const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../config/postgres");
const AppError = require("../utils/AppError");
const { normalizeEmail } = require("../utils/auth");
const emailConfig = require("../config/email");
const { getEmailProvider } = require("./email/emailProvider");
const { verificationEmail, passwordResetEmail, passwordChangedEmail, welcomeEmail } = require("./email/emailTemplates");

function authError(message, statusCode, code, details = null) {
  const error = new AppError(message, statusCode, details);
  error.code = code;
  return error;
}

const MAX_VERIFICATION_RESENDS = 2;

function resendMetadata(resendCount = 0, cooldownSeconds = emailConfig.resendCooldownSeconds()) {
  const count = Math.max(0, Math.min(MAX_VERIFICATION_RESENDS, Number(resendCount) || 0));
  return {
    resendCount: count,
    remainingResends: MAX_VERIFICATION_RESENDS - count,
    resendLimit: MAX_VERIFICATION_RESENDS,
    cooldownSeconds: Math.max(0, Number(cooldownSeconds) || 0),
  };
}

function cooldownRemainingSeconds(lastSentAt, cooldownSeconds = emailConfig.resendCooldownSeconds(), now = Date.now()) {
  if (!lastSentAt) return 0;
  const remaining = Number(cooldownSeconds) * 1000 - (now - new Date(lastSentAt).getTime());
  return Math.max(0, Math.ceil(remaining / 1000));
}

function secureOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function hashOtp(code) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw authError("Authentication is not configured", 500, "AUTH_NOT_CONFIGURED");
  return crypto.createHmac("sha256", secret).update(String(code)).digest("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function validCode(code) {
  return /^\d{6}$/.test(String(code || ""));
}

function expiry(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function providerFailure(error, metadata = null) {
  if (error.code === "EMAIL_PROVIDER_NOT_CONFIGURED" || error.code === "EMAIL_SENDER_NOT_CONFIGURED") {
    return authError("Email delivery is temporarily unavailable", 503, error.code, metadata);
  }
  return authError("Email delivery is temporarily unavailable", 503, "EMAIL_PROVIDER_ERROR", metadata);
}

async function sendInformationalEmail(message) {
  try { await getEmailProvider().send(message); } catch (_) { /* best-effort security/product notification */ }
}

async function findUser(email) {
  return (await query("SELECT id,name,email,email_verified_at FROM users WHERE lower(email)=lower($1)", [normalizeEmail(email)])).rows[0];
}

async function sendVerificationOtp(email) {
  return withTransaction(async (client) => {
    const user = (await client.query("SELECT id,email,email_verified_at FROM users WHERE lower(email)=lower($1) FOR UPDATE", [normalizeEmail(email)])).rows[0];
    if (!user || user.email_verified_at) return { accepted: true, ...resendMetadata(0) };

    const previous = (await client.query(
      "SELECT id,last_sent_at,resend_count FROM email_verification_requests WHERE user_id=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [user.id]
    )).rows[0];
    const currentCount = Number(previous?.resend_count || 0);
    const cooldownSeconds = emailConfig.resendCooldownSeconds();
    const cooldownRemaining = cooldownRemainingSeconds(previous?.last_sent_at, cooldownSeconds);
    const currentMetadata = resendMetadata(currentCount, cooldownRemaining || cooldownSeconds);

    if (cooldownRemaining > 0) {
      throw authError("Please wait before requesting another verification code", 429, "EMAIL_OTP_COOLDOWN", currentMetadata);
    }
    if (previous && currentCount >= MAX_VERIFICATION_RESENDS) {
      throw authError("You have reached the verification resend limit", 429, "EMAIL_OTP_RESEND_LIMIT", currentMetadata);
    }

    const code = secureOtp();
    try {
      await getEmailProvider().send({ to: user.email, ...verificationEmail(code, emailConfig.verificationTtlMinutes()) });
    } catch (error) {
      // The transaction rolls back here: the prior OTP remains active and the
      // successful-send allowance is unchanged when delivery is rejected.
      throw providerFailure(error, currentMetadata);
    }

    const nextCount = previous ? currentCount + 1 : 0;
    if (previous) {
      await client.query("UPDATE email_verification_requests SET used_at=now() WHERE id=$1 AND used_at IS NULL", [previous.id]);
    }
    await client.query(
      "INSERT INTO email_verification_requests (user_id,otp_hash,expires_at,last_sent_at,resend_count) VALUES ($1,$2,$3,now(),$4)",
      [user.id, hashOtp(code), expiry(emailConfig.verificationTtlMinutes()), nextCount]
    );
    return { accepted: true, ...resendMetadata(nextCount, cooldownSeconds) };
  });
}

async function verifyEmailOtp(email, code) {
  if (!validCode(code)) throw authError("Enter a valid 6-digit verification code", 400, "EMAIL_OTP_INVALID");
  const user = await findUser(email);
  const request = user && (await query("SELECT id,otp_hash,expires_at,attempt_count FROM email_verification_requests WHERE user_id=$1 AND used_at IS NULL AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1", [user.id])).rows[0];
  if (!user || !request) throw authError("That verification code is invalid or expired", 400, "EMAIL_OTP_INVALID");
  if (request.attempt_count >= emailConfig.maxAttempts) throw authError("Too many verification attempts. Request a new code.", 429, "EMAIL_OTP_ATTEMPTS_EXCEEDED");
  if (new Date(request.expires_at).getTime() <= Date.now()) throw authError("That verification code has expired. Request a new code.", 400, "EMAIL_OTP_EXPIRED");
  if (!crypto.timingSafeEqual(Buffer.from(request.otp_hash, "hex"), Buffer.from(hashOtp(code), "hex"))) {
    await query("UPDATE email_verification_requests SET attempt_count=attempt_count+1 WHERE id=$1", [request.id]);
    throw authError("That verification code is invalid", 400, "EMAIL_OTP_INVALID");
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE email_verification_requests SET verified_at=now(),used_at=now() WHERE id=$1 AND used_at IS NULL", [request.id]);
    await client.query("UPDATE users SET email_verified_at=now(),updated_at=now() WHERE id=$1", [user.id]);
  });
  await sendInformationalEmail({ to: user.email, ...welcomeEmail(user.name) });
  return { verified: true };
}

async function requestPasswordResetOtp(email) {
  const user = await findUser(email);
  if (!user) return { accepted: true };
  const previous = (await query("SELECT last_sent_at FROM password_reset_requests WHERE user_id=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [user.id])).rows[0];
  if (previous && previous.last_sent_at && new Date(previous.last_sent_at).getTime() > Date.now() - emailConfig.resendCooldownSeconds() * 1000) {
    throw authError("Please wait before requesting another reset code", 429, "RESET_OTP_COOLDOWN");
  }
  const code = secureOtp();
  try {
    await getEmailProvider().send({ to: user.email, ...passwordResetEmail(code, emailConfig.resetTtlMinutes()) });
  } catch (error) {
    throw providerFailure(error);
  }
  await query("UPDATE password_reset_requests SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
  await query("INSERT INTO password_reset_requests (user_id,token_hash,otp_hash,expires_at,last_sent_at) VALUES ($1,$2,$2,$3,now())", [user.id, hashOtp(code), expiry(emailConfig.resetTtlMinutes())]);
  return { accepted: true };
}

async function verifyPasswordResetOtp(email, code) {
  if (!validCode(code)) throw authError("Enter a valid 6-digit reset code", 400, "RESET_OTP_INVALID");
  const user = await findUser(email);
  const request = user && (await query("SELECT id,otp_hash,expires_at,attempts FROM password_reset_requests WHERE user_id=$1 AND used_at IS NULL AND verified_at IS NULL AND otp_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1", [user.id])).rows[0];
  if (!user || !request) throw authError("That reset code is invalid or expired", 400, "RESET_OTP_INVALID");
  if (request.attempts >= emailConfig.maxAttempts) throw authError("Too many reset attempts. Request a new code.", 429, "RESET_OTP_ATTEMPTS_EXCEEDED");
  if (new Date(request.expires_at).getTime() <= Date.now()) throw authError("That reset code has expired. Request a new code.", 400, "RESET_OTP_EXPIRED");
  if (!crypto.timingSafeEqual(Buffer.from(request.otp_hash, "hex"), Buffer.from(hashOtp(code), "hex"))) {
    await query("UPDATE password_reset_requests SET attempts=attempts+1 WHERE id=$1", [request.id]);
    throw authError("That reset code is invalid", 400, "RESET_OTP_INVALID");
  }
  const resetToken = crypto.randomBytes(32).toString("base64url");
  await query("UPDATE password_reset_requests SET verified_at=now(),otp_hash=NULL,token_hash=$1,reset_token_hash=$1 WHERE id=$2 AND used_at IS NULL", [hashResetToken(resetToken), request.id]);
  return { resetToken };
}

async function resetPassword({ resetToken, newPassword }) {
  const tokenHash = hashResetToken(resetToken || "");
  const row = (await query("SELECT pr.id,pr.user_id,pr.expires_at,pr.verified_at,pr.used_at,u.email,u.name FROM password_reset_requests pr JOIN users u ON u.id=pr.user_id WHERE pr.reset_token_hash=$1", [tokenHash])).rows[0];
  if (!row || !row.verified_at || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) throw authError("That password reset session is invalid or expired", 400, "RESET_TOKEN_INVALID");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [passwordHash, row.user_id]);
    await client.query("UPDATE password_reset_requests SET used_at=now() WHERE id=$1 AND used_at IS NULL", [row.id]);
    await client.query("UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [row.user_id]);
  });
  await sendInformationalEmail({ to: row.email, ...passwordChangedEmail() });
  return { reset: true };
}

module.exports = { sendVerificationOtp, verifyEmailOtp, requestPasswordResetOtp, verifyPasswordResetOtp, resetPassword, resendMetadata, cooldownRemainingSeconds, MAX_VERIFICATION_RESENDS, setEmailProviderForTests: require("./email/emailProvider").setEmailProviderForTests };
