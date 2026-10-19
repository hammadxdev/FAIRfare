const { Router } = require("express");
const { getProviders, getProviderStatuses, getIndriveSuggestions, getIndriveRoute, getIndriveFares, getIndriveDrivers, getIndriveStatus } = require("../controllers/provider.controller");

const router = Router();

router.get("/", getProviders);
router.get("/status", getProviderStatuses);
router.get("/indrive/status", getIndriveStatus);
router.get("/indrive/suggestions", getIndriveSuggestions);
router.post("/indrive/route", getIndriveRoute);
router.post("/indrive/fares", getIndriveFares);
router.get("/indrive/drivers", getIndriveDrivers);

module.exports = router;
