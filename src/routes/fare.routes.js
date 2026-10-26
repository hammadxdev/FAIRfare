const { Router } = require("express");
const { compareFaresHandler } = require("../controllers/fare.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { createGuestRateLimiter } = require("../middlewares/guestRateLimit.middleware");

const router = Router();

router.post("/compare", requireAuth, createGuestRateLimiter({ bucket: "fare-compare", limit: 20, windowSeconds: 60 }), compareFaresHandler);

module.exports = router;
