const { Router } = require("express");
const {
  autocompleteHandler,
  placeDetailsHandler,
  reverseGeocodeHandler,
  routeHandler,
  usageHandler,
} = require("../controllers/map.controller");
const mapRateLimit = require("../middlewares/mapRateLimit.middleware");

const router = Router();

router.use(mapRateLimit);

router.get("/autocomplete", autocompleteHandler);
router.get("/place-details", placeDetailsHandler);
router.get("/reverse-geocode", reverseGeocodeHandler);
router.post("/route", routeHandler);
router.get("/usage", usageHandler);

module.exports = router;
