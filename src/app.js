const express = require("express");
const cors = require("cors");

const { ensureDatabaseReady } = require("./db/bootstrap");
const healthRoutes = require("./routes/health.routes");
const providerRoutes = require("./routes/provider.routes");
const fareRoutes = require("./routes/fare.routes");
const mapRoutes = require("./routes/map.routes");

const notFoundMiddleware = require("./middlewares/notFound.middleware");
const errorMiddleware = require("./middlewares/error.middleware");

const app = express();

app.use(cors());
app.use(express.json());

// Re-verified on every single request, not just at module load — serverless
// platforms (Vercel's Fluid Compute in particular) can reuse a warm JS
// module cache while the underlying /tmp SQLite file was reset independently,
// so relying on "ran once at import time" is not safe. Both calls inside
// ensureDatabaseReady() are idempotent and cheap.
app.use((req, res, next) => {
  ensureDatabaseReady();
  next();
});

app.use("/api/health", healthRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/fares", fareRoutes);
app.use("/api/maps", mapRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
