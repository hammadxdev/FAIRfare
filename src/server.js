const os = require("os");
const http = require("http");
const { environmentDiagnostics } = require("./config/env");
const { validateAuthConfig } = require("./config/auth");
const startupDiagnostics = environmentDiagnostics();
console.log(`[startup] JWT_ACCESS_SECRET: ${startupDiagnostics.jwtAccessSecret}`);
console.log(`[startup] DATABASE_URL: ${startupDiagnostics.databaseUrl}`);
console.log(`[startup] AI config: ${startupDiagnostics.aiConfig}`);
validateAuthConfig();

const app = require("./app");

const PORT = process.env.PORT || 4000;

// Retain the HTTP server for the lifetime of this module. Without a strong
// reference, the listener can be garbage-collected after startup in this
// runtime, causing Node to exit even though the listen callback ran.
// Create and retain the HTTP server explicitly instead of relying on the
// Express convenience wrapper. This keeps the native listener strongly
// referenced for the lifetime of the entrypoint.
const server = http.createServer(app);
server.listen(PORT, "0.0.0.0", () => {
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    entries
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => ({ name, address: entry.address })),
  );
  const lanAddress =
    interfaces.find(({ name }) => !/(virtual|vmware|vbox|hyper-v|vpn|nord|default switch)/i.test(name))?.address ??
    interfaces[0]?.address;

  console.log("FairFare backend listening on:");
  console.log(`Local: http://localhost:${PORT}/api`);
  if (lanAddress) console.log(`LAN:   http://${lanAddress}:${PORT}/api`);
  else console.log(`Listening address: 0.0.0.0:${PORT}`);
});
