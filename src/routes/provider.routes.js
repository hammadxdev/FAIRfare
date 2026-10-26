const { Router } = require("express");
const { getProviders, getProviderStatuses, getIndriveSuggestions, getIndriveRoute, getIndriveFares, getIndriveDrivers, getIndriveStatus, getBykeaDrivers, getYangoDrivers } = require("../controllers/provider.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { createGuestRateLimiter } = require("../middlewares/guestRateLimit.middleware");

const router = Router();

router.get("/", getProviders);
router.get("/status", getProviderStatuses);
router.get("/indrive/status", getIndriveStatus);
router.get("/indrive/suggestions", getIndriveSuggestions);
router.post("/indrive/route", getIndriveRoute);
router.post("/indrive/fares", getIndriveFares);
const driverLimit = createGuestRateLimiter({ bucket: "nearby-drivers", limit: 30, windowSeconds: 60 });
router.get("/indrive/drivers", requireAuth, driverLimit, getIndriveDrivers);
router.get("/yango/drivers", requireAuth, driverLimit, getYangoDrivers);
router.get("/bykea/drivers", requireAuth, driverLimit, getBykeaDrivers);

module.exports = router;
