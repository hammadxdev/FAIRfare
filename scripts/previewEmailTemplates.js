/* Development-only preview: renders fake values to stdout and never sends mail. */
const { verificationEmail, passwordResetEmail, passwordChangedEmail, welcomeEmail } = require("../src/services/email/emailTemplates");

for (const email of [
  verificationEmail("123456", 10),
  passwordResetEmail("123456", 10),
  passwordChangedEmail(),
  welcomeEmail("Demo Rider"),
]) {
  console.log(`\n=== ${email.subject} ===\n\n${email.text}\n\nHTML:\n${email.html}`);
}
