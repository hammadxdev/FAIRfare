const express = require("express");
const cors = require("cors");

const healthRoutes = require("./routes/health.routes");
const providerRoutes = require("./routes/provider.routes");
const fareRoutes = require("./routes/fare.routes");
const mapRoutes = require("./routes/map.routes");
const historyRoutes = require("./routes/history.routes");
const predictionRoutes = require("./routes/prediction.routes");
const authRoutes = require("./routes/auth.routes");
const preferenceRoutes = require("./routes/userPreference.routes");
const aiRoutes = require("./routes/ai.routes");
const savedRouteRoutes = require("./routes/savedRoute.routes");

const notFoundMiddleware = require("./middlewares/notFound.middleware");
const errorMiddleware = require("./middlewares/error.middleware");
const requestLogger = require("./middlewares/requestLogger.middleware");

const app = express();

app.use(cors());
app.use(requestLogger);
app.use(express.json());

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/preferences", preferenceRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/fares", fareRoutes);
app.use("/api/maps", mapRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/saved-routes", savedRouteRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
