const express = require("express");
const cors = require("cors");

const healthRoutes = require("./routes/health.routes");
const providerRoutes = require("./routes/provider.routes");
const fareRoutes = require("./routes/fare.routes");
const mapRoutes = require("./routes/map.routes");

const notFoundMiddleware = require("./middlewares/notFound.middleware");
const errorMiddleware = require("./middlewares/error.middleware");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/health", healthRoutes);
app.use("/api/providers", providerRoutes);
app.use("/api/fares", fareRoutes);
app.use("/api/maps", mapRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
