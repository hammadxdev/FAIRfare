const AppError = require("../utils/AppError");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/apiResponse");
const service = require("../services/auth.service");
const emailAuth = require("../services/emailAuth.service");
const { normalizeEmail, basicEmail, safeUser } = require("../utils/auth");

function credentials(body, requireName = false) {
  const errors = []; const name = String(body.name || "").trim(); const email = normalizeEmail(body.email); const password = String(body.password || "");
  if (requireName && !name) errors.push("name is required");
  if (!basicEmail(email)) errors.push("email must be valid");
  if (password.length < 8) errors.push("password must be at least 8 characters");
  if (errors.length) throw new AppError("Validation failed", 400, errors);
  return { name, email, password };
}
function safeDatabaseError(error) {
  const code = String(error?.code || "");
  const messages = {
    "23505": "unique constraint violation",
    "23502": "not-null constraint violation",
    "23503": "foreign-key constraint violation",
    "22P02": "invalid input syntax",
    "42804": "database type mismatch",
    "42703": "undefined column",
    "42P01": "undefined table",
  };
  return {
    code: code || "DATABASE_ERROR",
    constraint: error?.constraint || null,
    table: error?.table || null,
    column: error?.column || null,
    message: messages[code] || "database operation failed",
  };
}
function isEmailDeliveryError(error) { return String(error?.code || "").startsWith("EMAIL_"); }
const register = asyncHandler(async (req, res) => { const data = credentials(req.body, true); let result; try { result = await service.register(data); } catch (e) { if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) { e.suppressRawLog = true; console.error("[DB] register failed", safeDatabaseError(e)); } if (e.code === "23505") throw new AppError("An account with that email already exists", 409); throw e; } let verificationEmailSent = true; try { await emailAuth.sendVerificationOtp(data.email); } catch (e) { if (!isEmailDeliveryError(e)) throw e; verificationEmailSent = false; if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.warn("[EMAIL] verification delivery unavailable", e.code || "EMAIL_PROVIDER_ERROR"); } return success(res, { message: "Account created", data: { ...result, verificationRequired: true, verificationEmailSent } }); });
const login = asyncHandler(async (req, res) => { const email = normalizeEmail(req.body.email); const password = String(req.body.password || ""); if (!basicEmail(email) || !password) throw new AppError("Invalid email or password", 401); return success(res, { message: "Login successful", data: await service.login({ email, password }) }); });
const refresh = asyncHandler(async (req, res) => success(res, { message: "Session refreshed", data: await service.refresh(req.body.refreshToken) }));
const logout = asyncHandler(async (req, res) => { await service.logout(req.body.refreshToken); return success(res, { message: "Logged out successfully", data: null }); });
const me = asyncHandler(async (req, res) => { return success(res, { message: "Authenticated user fetched successfully", data: safeUser(req.user) }); });
const forgotPassword = asyncHandler(async (req, res) => { const email = normalizeEmail(req.body?.email); if (!basicEmail(email)) throw new AppError("Enter a valid email", 400); try { await emailAuth.requestPasswordResetOtp(email); } catch (e) { if (e.code === "RESET_OTP_COOLDOWN") throw e; if (!isEmailDeliveryError(e)) throw e; if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) console.warn("[EMAIL] password reset delivery unavailable", e.code || "EMAIL_PROVIDER_ERROR"); } return success(res, { message: "If an account exists for this email, a verification code has been sent.", data: { accepted: true } }); });
const verifyEmail = asyncHandler(async (req, res) => success(res, { message: "Email verified", data: await emailAuth.verifyEmailOtp(req.body?.email, req.body?.code) }));
const sendVerification = asyncHandler(async (req, res) => { const email = normalizeEmail(req.body?.email); if (!basicEmail(email)) throw new AppError("Enter a valid email", 400); return success(res, { message: "Verification code sent", data: await emailAuth.sendVerificationOtp(email) }); });
const verifyPasswordReset = asyncHandler(async (req, res) => success(res, { message: "Reset code verified", data: await emailAuth.verifyPasswordResetOtp(req.body?.email, req.body?.code) }));
const resetPassword = asyncHandler(async (req, res) => { const resetToken = String(req.body?.resetToken || req.body?.token || ""); const newPassword = String(req.body?.newPassword || req.body?.password || ""); const confirmPassword = String(req.body?.confirmPassword || newPassword); if (!resetToken || newPassword.length < 8 || newPassword !== confirmPassword) throw new AppError("A valid reset token and matching password of at least 8 characters are required", 400); return success(res, { message: "Password updated", data: await emailAuth.resetPassword({ resetToken, newPassword }) }); });
const sendPhoneCode = asyncHandler(async (req, res) => { const phoneNumber = service.normalizePhone(req.body?.phoneNumber); const provider = require("../services/verificationProvider"); await provider.send({ channel: req.body?.channel || "WHATSAPP", phoneNumber, purpose: "Fair Fare phone verification" }); await service.recordPhoneVerification(phoneNumber, "Fair Fare phone verification"); return success(res, { message: "If verification is available, a code has been sent.", data: { accepted: true } }); });
const verifyPhoneCode = asyncHandler(async (req, res) => { const phoneNumber = service.normalizePhone(req.body?.phoneNumber); const provider = require("../services/verificationProvider"); await provider.verify({ phoneNumber, code: req.body?.code }); if (req.user?.id) await service.markPhoneVerified(req.user.id, phoneNumber); return success(res, { message: "Phone verified", data: { verified: true } }); });
const google = asyncHandler(async (req, res) => success(res, { message: "Google sign-in successful", data: await service.googleLogin(req.body?.idToken) }));
module.exports = { register, login, refresh, logout, me, forgotPassword, resetPassword, verifyEmail, sendVerification, verifyPasswordReset, sendPhoneCode, verifyPhoneCode, google };
