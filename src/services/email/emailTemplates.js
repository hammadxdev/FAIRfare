function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function shell(title, code, expiryMinutes, detail) {
  return `<!doctype html><html><body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#102a43"><div style="max-width:560px;margin:32px auto;padding:32px;background:#ffffff;border-radius:20px"><div style="font-size:24px;font-weight:800;color:#0b6b4f">Fair Fare</div><div style="margin-top:4px;color:#64748b">Ride Smarter</div><h1 style="font-size:22px;margin:28px 0 12px">${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><div style="margin:24px 0;padding:18px;text-align:center;background:#edf8f2;border-radius:12px;font-size:32px;letter-spacing:8px;font-weight:800;color:#0b6b4f">${escapeHtml(code)}</div><p>This code expires in ${expiryMinutes} minutes.</p><p style="color:#64748b;font-size:13px">If you did not request this, you can ignore this email.</p></div></body></html>`;
}

function verificationEmail(code, expiryMinutes) {
  return { subject: "Verify your Fair Fare email", html: shell("Verify your Fair Fare email", code, expiryMinutes, "Your verification code is:") };
}

function passwordResetEmail(code, expiryMinutes) {
  return { subject: "Fair Fare password reset code", html: shell("Fair Fare password reset code", code, expiryMinutes, "Your password reset code is:") };
}

module.exports = { verificationEmail, passwordResetEmail };
