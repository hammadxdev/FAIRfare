const { Router } = require("express");
const { requireAuth } = require("../middlewares/auth.middleware");
const { indriveAutocompleteHandler } = require("../controllers/location.controller");
const { createGuestRateLimiter } = require("../middlewares/guestRateLimit.middleware");

const router = Router();
router.post("/indrive/autocomplete", requireAuth, createGuestRateLimiter({ bucket: "location-query", limit: 60, windowSeconds: 60 }), indriveAutocompleteHandler);

module.exports = router;
