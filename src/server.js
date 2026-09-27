const os = require("os");
const { environmentDiagnostics } = require("./config/env");
const { validateAuthConfig } = require("./config/auth");
const startupDiagnostics = environmentDiagnostics();
console.log(`[startup] JWT_ACCESS_SECRET: ${startupDiagnostics.jwtAccessSecret}`);
console.log(`[startup] DATABASE_URL: ${startupDiagnostics.databaseUrl}`);
console.log(`[startup] AI config: ${startupDiagnostics.aiConfig}`);
validateAuthConfig();

const app = require("./app");

const PORT = process.env.PORT || 4000;

app.listen(PORT, "0.0.0.0", () => {
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    entries
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => ({ name, address: entry.address })),
  );
  const lanAddress =
    interfaces.find(({ name }) => !/(virtual|vmware|vbox|hyper-v|vpn|nord|default switch)/i.test(name))?.address ??
    interfaces[0]?.address;

  console.log("Fair Fare backend listening on:");
  console.log(`Local: http://localhost:${PORT}/api`);
  if (lanAddress) console.log(`LAN:   http://${lanAddress}:${PORT}/api`);
  else console.log(`Listening address: 0.0.0.0:${PORT}`);
});
