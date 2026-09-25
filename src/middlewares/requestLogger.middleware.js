function requestLogger(req, res, next) {
  if (process.env.NODE_ENV === "production") return next();

  const startedAt = Date.now();
  res.on("finish", () => {
    const pathname = req.originalUrl.split("?", 1)[0];
    console.log(`[HTTP] ${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
}

module.exports = requestLogger;
