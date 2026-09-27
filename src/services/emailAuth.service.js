const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../config/postgres");
const AppError = require("../utils/AppError");
const { normalizeEmail } = require("../utils/auth");
const emailConfig = require("../config/email");
const { getEmailProvider } = require("./email/emailProvider");
const { verificationEmail, passwordResetEmail } = require("./email/emailTemplates");

function authError(message, statusCode, code) {
  const error = new AppError(message, statusCode);
  error.code = code;
  return error;
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

function providerFailure(error) {
  if (error.code === "EMAIL_PROVIDER_NOT_CONFIGURED" || error.code === "EMAIL_SENDER_NOT_CONFIGURED") {
    return authError("Email delivery is temporarily unavailable", 503, error.code);
  }
  return authError("Email delivery is temporarily unavailable", 503, "EMAIL_PROVIDER_ERROR");
}

async function findUser(email) {
  return (await query("SELECT id,name,email,email_verified_at FROM users WHERE lower(email)=lower($1)", [normalizeEmail(email)])).rows[0];
}

async function sendVerificationOtp(email) {
  const user = await findUser(email);
  if (!user || user.email_verified_at) return { accepted: true };
  const previous = (await query("SELECT last_sent_at FROM email_verification_requests WHERE user_id=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1", [user.id])).rows[0];
  if (previous && previous.last_sent_at && new Date(previous.last_sent_at).getTime() > Date.now() - emailConfig.resendCooldownSeconds() * 1000) {
    throw authError("Please wait before requesting another verification code", 429, "EMAIL_OTP_COOLDOWN");
  }
  const code = secureOtp();
  try {
    await getEmailProvider().send({ to: user.email, ...verificationEmail(code, emailConfig.verificationTtlMinutes()) });
  } catch (error) {
    throw providerFailure(error);
  }
  await query("UPDATE email_verification_requests SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
  await query("INSERT INTO email_verification_requests (user_id,otp_hash,expires_at,last_sent_at) VALUES ($1,$2,$3,now())", [user.id, hashOtp(code), expiry(emailConfig.verificationTtlMinutes())]);
  return { accepted: true };
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
  const row = (await query("SELECT id,user_id,expires_at,verified_at,used_at FROM password_reset_requests WHERE reset_token_hash=$1", [tokenHash])).rows[0];
  if (!row || !row.verified_at || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) throw authError("That password reset session is invalid or expired", 400, "RESET_TOKEN_INVALID");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [passwordHash, row.user_id]);
    await client.query("UPDATE password_reset_requests SET used_at=now() WHERE id=$1 AND used_at IS NULL", [row.id]);
    await client.query("UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [row.user_id]);
  });
  return { reset: true };
}

module.exports = { sendVerificationOtp, verifyEmailOtp, requestPasswordResetOtp, verifyPasswordResetOtp, resetPassword, setEmailProviderForTests: require("./email/emailProvider").setEmailProviderForTests };
