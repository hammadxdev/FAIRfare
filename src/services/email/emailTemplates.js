const emailConfig = require("../../config/email");

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function escapeText(value) { return String(value).replace(/\r?\n/g, " ").trim(); }

function logoUrl() {
  const configured = String(emailConfig.logoUrl() || "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || ["localhost", "127.0.0.1", "::1"].includes(hostname) || hostname.endsWith(".local")) return null;
    return url.toString();
  } catch (_) { return null; }
}

function brandHeader() {
  const url = logoUrl();
  return url ? `<img src="${escapeHtml(url)}" width="180" alt="Fair Fare" style="display:block;width:180px;max-width:100%;height:auto;border:0">` : `<div style="font-family:Arial,sans-serif;font-size:25px;line-height:30px;font-weight:700;letter-spacing:1px;color:#ffffff">FAIR FARE</div>`;
}

function render({ title, intro, code, codeLabel, expiryMinutes, paragraphs = [], recipientName = "" }) {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeName = recipientName ? `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#243b53">Hi ${escapeHtml(recipientName)},</p>` : "";
  const codeHtml = code ? `<p style="margin:24px 0 8px;font-size:14px;line-height:20px;font-weight:700;color:#486581">${escapeHtml(codeLabel)}</p><div style="display:inline-block;padding:14px 20px;background:#e6f6ef;border:1px solid #b8e3ce;border-radius:8px;font-family:Arial,sans-serif;font-size:32px;line-height:38px;letter-spacing:8px;font-weight:700;color:#087443">${escapeHtml(code)}</div><p style="margin:12px 0 0;font-size:14px;line-height:20px;color:#486581">This code expires in ${escapeHtml(expiryMinutes)} minutes.</p>` : "";
  const paragraphHtml = paragraphs.map((paragraph) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#243b53">${escapeHtml(paragraph)}</p>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>${safeTitle}</title></head><body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#243b53"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${safeTitle}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f3f7f5"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden"><tr><td style="padding:28px 32px;background:#087443">${brandHeader()}<div style="margin-top:5px;font-size:14px;line-height:20px;color:#d8f3e5">Ride Smarter</div></td></tr><tr><td style="padding:32px">${safeName}<h1 style="margin:0 0 16px;font-size:24px;line-height:32px;color:#102a43">${safeTitle}</h1><p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#243b53">${safeIntro}</p>${codeHtml}${paragraphHtml}</td></tr><tr><td style="padding:22px 32px;background:#f7faf9;border-top:1px solid #e6ece9"><div style="font-size:14px;line-height:20px;font-weight:700;color:#102a43">Fair Fare</div><div style="font-size:14px;line-height:20px;color:#486581">Ride Smarter</div><div style="font-size:13px;line-height:20px;color:#627d98">Compare fares. Choose fair.</div></td></tr></table></td></tr></table></body></html>`;
  const textLines = ["FAIR FARE", "Ride Smarter", "Compare fares. Choose fair.", "", safeTitle, "", recipientName ? `Hi ${escapeText(recipientName)},` : "", safeIntro, code ? `${escapeText(codeLabel)} ${escapeText(code)}` : "", code ? `This code expires in ${escapeText(expiryMinutes)} minutes.` : "", ...paragraphs.map(escapeText), "", "If you did not request this email, you can ignore it."];
  return { html, text: textLines.filter((line, index) => line || index === 0).join("\n") };
}

function verificationEmail(code, expiryMinutes) { return { subject: "Verify your Fair Fare email", ...render({ title: "Verify your Fair Fare email", intro: "Email verification is required to finish setting up your Fair Fare account.", code, codeLabel: "Your verification code", expiryMinutes, paragraphs: ["If you did not create this account, you can ignore this email."] }) }; }
function passwordResetEmail(code, expiryMinutes) { return { subject: "Reset your Fair Fare password", ...render({ title: "Reset your Fair Fare password", intro: "We received a request to reset your Fair Fare password.", code, codeLabel: "Your password reset code", expiryMinutes, paragraphs: ["If you did not request a password reset, you can ignore this email."] }) }; }
function passwordChangedEmail() { return { subject: "Your Fair Fare password was changed", ...render({ title: "Your Fair Fare password was changed", intro: "Your Fair Fare password was successfully changed. Existing sessions were revoked for your security.", paragraphs: ["If this was unexpected, use the Fair Fare password-reset flow to secure your account."] }) }; }
function welcomeEmail(name) { return { subject: "Welcome to Fair Fare", ...render({ title: "Welcome to Fair Fare", intro: "Your email is verified and your Fair Fare account is ready.", recipientName: name, paragraphs: ["Compare ride fares, review available options, and choose the option that suits you.", "Booking and handoff continue with the selected ride provider."] }) }; }

module.exports = { escapeHtml, verificationEmail, passwordResetEmail, passwordChangedEmail, welcomeEmail };
