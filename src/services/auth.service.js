const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { query, withTransaction } = require("../config/postgres");
const AppError = require("../utils/AppError");
const { signAccessToken, refreshTtlSeconds, createRefreshToken, hashRefreshToken } = require("../config/auth");
const { safeUser, normalizeEmail } = require("../utils/auth");
const emailConfig = require("../config/email");
const USER_SELECT = "SELECT id, name, email, password_hash, email_verified_at, created_at, updated_at FROM users";
async function issueSession(user, client = null) { const token = createRefreshToken(); const now = Math.floor(Date.now()/1000); await (client || { query }).query("INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at, last_used_at) VALUES ($1,$2,to_timestamp($3),to_timestamp($4))", [user.id, hashRefreshToken(token), now+refreshTtlSeconds, now]); return { user: safeUser(user), accessToken: signAccessToken(user), refreshToken: token, expiresIn: refreshTtlSeconds }; }
async function register({name,email,password}) { const r=await query("INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,created_at,updated_at",[name.trim(),normalizeEmail(email),await bcrypt.hash(password,12)]); return {user:safeUser(r.rows[0])}; }
async function login({email,password}) { const r=await query(`${USER_SELECT} WHERE lower(btrim(email))=lower(btrim($1))`,[email]); const user=r.rows[0]; if(!user||!user.password_hash||!(await bcrypt.compare(password,user.password_hash))) throw new AppError("Invalid email or password",401); if(!user.email_verified_at) { const error=new AppError("Please verify your email before signing in",403); error.code="EMAIL_NOT_VERIFIED"; throw error; } return issueSession(user); }
function otpError(message, statusCode, code) { const error = new AppError(message, statusCode); error.code = code; return error; }
async function verifyEmailOtpLogin(email, code) {
  const normalized = normalizeEmail(email);
  const emailAuth = require("./emailAuth.service");
  if (!emailAuth.validCode(code)) throw otpError("That verification code is invalid or expired", 400, "EMAIL_OTP_INVALID");
  const outcome = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [normalized]);
    const challenge = (await client.query(
      "SELECT id,otp_hash,expires_at,attempt_count FROM email_login_challenges WHERE email=$1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [normalized]
    )).rows[0];
    if (!challenge) return { error: otpError("That verification code is invalid or expired", 400, "EMAIL_OTP_INVALID") };
    if (Number(challenge.attempt_count) >= emailConfig.maxAttempts) return { error: otpError("Too many attempts. Request a new code.", 429, "EMAIL_OTP_ATTEMPTS_EXCEEDED") };
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE email_login_challenges SET used_at=now() WHERE id=$1", [challenge.id]);
      return { error: otpError("That verification code has expired", 400, "EMAIL_OTP_EXPIRED") };
    }
    const expected = Buffer.from(challenge.otp_hash, "hex");
    const supplied = Buffer.from(emailAuth.hashOtp(code), "hex");
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      await client.query("UPDATE email_login_challenges SET attempt_count=attempt_count+1 WHERE id=$1", [challenge.id]);
      return { error: otpError("That verification code is invalid", 400, "EMAIL_OTP_INVALID") };
    }
    await client.query("UPDATE email_login_challenges SET used_at=now() WHERE id=$1 AND used_at IS NULL", [challenge.id]);
    let user = (await client.query(`${USER_SELECT} WHERE lower(btrim(email))=$1 FOR UPDATE`, [normalized])).rows[0];
    if (user) {
      user = (await client.query(
        "UPDATE users SET email=$1,email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$2 RETURNING id,name,email,password_hash,email_verified_at,created_at,updated_at",
        [normalized, user.id]
      )).rows[0];
    } else {
      user = (await client.query(
        "INSERT INTO users (name,email,password_hash,email_verified_at) VALUES (NULL,$1,NULL,now()) RETURNING id,name,email,password_hash,email_verified_at,created_at,updated_at",
        [normalized]
      )).rows[0];
    }
    const session = await issueSession(user, client);
    return { session: { ...session, needsName: !String(user.name || "").trim() } };
  });
  if (outcome.error) throw outcome.error;
  return outcome.session;
}
async function refresh(token) {
  if (!token || typeof token !== "string") throw new AppError("Invalid or expired refresh token", 401);
  const hash = hashRefreshToken(token);
  const next = createRefreshToken();
  const now = Math.floor(Date.now() / 1000);

  // Keep lookup, token comparison, sliding expiry, and rotation in one
  // transaction. FOR UPDATE prevents two requests using the same rotated
  // token from both succeeding.
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT u.id, u.name, u.email, u.email_verified_at, u.created_at, u.updated_at,
              s.id AS session_id
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        FOR UPDATE`,
      [hash],
    );
    const row = result.rows[0];
    if (!row) throw new AppError("Invalid or expired refresh token", 401);

    const updated = await client.query(
      `UPDATE user_sessions
          SET refresh_token_hash = $1,
              last_used_at = to_timestamp($2),
              expires_at = to_timestamp($3)
        WHERE id = $4
          AND revoked_at IS NULL
          AND expires_at > NOW()`,
      [hashRefreshToken(next), now, now + refreshTtlSeconds, row.session_id],
    );
    if (updated.rowCount !== 1) throw new AppError("Invalid or expired refresh token", 401);

    return {
      user: safeUser(row),
      accessToken: signAccessToken(row),
      refreshToken: next,
      expiresIn: refreshTtlSeconds,
    };
  });
}
async function logout(token) { if(token) await query("UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE refresh_token_hash=$1",[hashRefreshToken(token)]); }
async function requestPasswordReset(email) { const r=await query("SELECT id FROM users WHERE lower(email)=lower($1)",[email]); if(!r.rows[0]) return {accepted:true}; const raw=crypto.randomBytes(32).toString("base64url"); await withTransaction(async c=>{await c.query("UPDATE password_reset_requests SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",[r.rows[0].id]); await c.query("INSERT INTO password_reset_requests (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '10 minutes')",[r.rows[0].id,hashRefreshToken(raw)]);}); return {accepted:true}; }
async function resetPassword(token,password) { const r=await query("SELECT * FROM password_reset_requests WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() AND attempts<5",[hashRefreshToken(token||"")]); const row=r.rows[0]; if(!row) throw new AppError("Invalid or expired reset code",400); await withTransaction(async c=>{await c.query("UPDATE password_reset_requests SET used_at=now() WHERE id=$1",[row.id]); await c.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2",[await bcrypt.hash(password,12),row.user_id]); await c.query("UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",[row.user_id]);}); return {reset:true}; }
function normalizePhone(value){const n=require("./verificationProvider").normalizeE164(value);if(!n)throw new AppError("Phone number must use E.164 format",400);return n;}
async function setPhone(userId,value){const phone=normalizePhone(value);try{await query("UPDATE users SET phone_number=$1,updated_at=now() WHERE id=$2",[phone,userId]);}catch(e){if(e.code==="23505")throw new AppError("That phone number is already in use",409);throw e;}return phone;}
async function recordPhoneVerification(phoneNumber, purpose) { await query("INSERT INTO phone_verification_attempts (phone_number,purpose,expires_at) VALUES ($1,$2,now()+interval '10 minutes')", [phoneNumber, purpose]); }
async function markPhoneVerified(userId, phoneNumber) { await setPhone(userId, phoneNumber); await query("UPDATE users SET phone_verified_at=now() WHERE id=$1", [userId]); }
function normalizeProfileName(value) {
  if (typeof value !== "string") throw new AppError("Name is required", 400);
  const name = value.normalize("NFKC").trim();
  if (!name) throw new AppError("Name is required", 400);
  if (name.length > 120) throw new AppError("Name must be 120 characters or fewer", 400);
  if ([...name].some((character) => /[<>\u0000-\u001F\u007F]/u.test(character))) throw new AppError("Name contains invalid characters", 400);
  return name;
}
async function updateProfile(userId, changes) {
  const name = normalizeProfileName(changes?.name);
  const result = await query("UPDATE users SET name=$1, updated_at=now() WHERE id=$2 RETURNING id,name,email,email_verified_at,created_at,updated_at", [name, userId]);
  if (!result.rows[0]) throw new AppError("Authenticated user not found", 404);
  return safeUser(result.rows[0]);
}
async function googleLogin(idToken){if(!process.env.GOOGLE_OAUTH_CLIENT_ID)throw new AppError("Google authentication is not configured",503,null,"GOOGLE_NOT_CONFIGURED");const response=await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken||"")}`);const claims=await response.json().catch(()=>({}));if(!response.ok||claims.iss!=="https://accounts.google.com"||claims.aud!==process.env.GOOGLE_OAUTH_CLIENT_ID||Number(claims.exp)<=Math.floor(Date.now()/1000)||!claims.sub||!claims.email_verified)throw new AppError("Invalid Google credential",401);const identity=(await query("SELECT user_id FROM user_identities WHERE provider='GOOGLE' AND provider_subject=$1",[claims.sub])).rows[0];if(identity){const u=(await query(`${USER_SELECT} WHERE id=$1`,[identity.user_id])).rows[0];return issueSession(u);}const email=normalizeEmail(claims.email);if((await query(`${USER_SELECT} WHERE lower(email)=lower($1)`,[email])).rows[0])throw new AppError("This email already has a password account. Sign in with email first to link Google.",409);return withTransaction(async c=>{const u=(await c.query("INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,password_hash,created_at,updated_at",[String(claims.name||claims.email).slice(0,120),email,await bcrypt.hash(crypto.randomBytes(32).toString("hex"),12)])).rows[0];await c.query("INSERT INTO user_identities (user_id,provider,provider_subject) VALUES ($1,'GOOGLE',$2)",[u.id,claims.sub]);return issueSession(u,c);});}
module.exports={register,login,verifyEmailOtpLogin,refresh,logout,requestPasswordReset,resetPassword,normalizePhone,setPhone,recordPhoneVerification,markPhoneVerified,normalizeProfileName,updateProfile,googleLogin};
