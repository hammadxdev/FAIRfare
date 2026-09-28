const test = require("node:test");
const assert = require("node:assert/strict");
const { verificationEmail, passwordResetEmail, passwordChangedEmail, welcomeEmail } = require("../services/email/emailTemplates");

test("verification email has branded HTML/text, subject, OTP, expiry, and escaped content", () => {
  const email = verificationEmail("123456", 17);
  assert.equal(email.subject, "Verify your Fair Fare email");
  assert.match(email.html, /role="presentation"/);
  assert.match(email.html, /FAIR FARE/);
  assert.match(email.html, /123456/);
  assert.match(email.html, /expires in 17 minutes/);
  assert.match(email.text, /123456/);
  assert.match(email.text, /expires in 17 minutes/);
  assert.match(verificationEmail("<123&", 10).html, /&lt;123&amp;/);
});

test("password reset email uses the required subject and text fallback", () => {
  const email = passwordResetEmail("654321", 12);
  assert.equal(email.subject, "Reset your Fair Fare password");
  assert.match(email.html, /password reset code/);
  assert.match(email.html, /654321/);
  assert.match(email.text, /654321/);
  assert.match(email.text, /expires in 12 minutes/);
});

test("valid HTTPS logo is used and missing or invalid logo falls back to text branding", () => {
  const original = process.env.EMAIL_LOGO_URL;
  process.env.EMAIL_LOGO_URL = "https://cdn.example.com/fair-fare.png";
  assert.match(verificationEmail("123456", 10).html, /https:\/\/cdn\.example\.com\/fair-fare\.png/);
  process.env.EMAIL_LOGO_URL = "http://cdn.example.com/fair-fare.png";
  const invalid = verificationEmail("123456", 10).html;
  assert.doesNotMatch(invalid, /cdn\.example\.com/);
  assert.match(invalid, />FAIR FARE<\/div>/);
  if (original === undefined) delete process.env.EMAIL_LOGO_URL;
  else process.env.EMAIL_LOGO_URL = original;
});

test("password-changed and welcome emails contain no OTP or token material", () => {
  const changed = passwordChangedEmail();
  const welcome = welcomeEmail("<Rider>");
  assert.equal(changed.subject, "Your Fair Fare password was changed");
  assert.doesNotMatch(changed.html, /123456|654321/);
  assert.doesNotMatch(changed.text, /123456|654321/);
  assert.match(changed.text, /Existing sessions were revoked/);
  assert.match(welcome.html, /&lt;Rider&gt;/);
  assert.doesNotMatch(welcome.html, /token|otp|hash/i);
  assert.doesNotMatch(welcome.text, /token|otp|hash/i);
});
