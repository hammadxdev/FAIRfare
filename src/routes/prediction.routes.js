const { Router } = require("express");
const { predictFareHandler } = require("../controllers/prediction.controller");

const router = Router();
router.post("/fare", predictFareHandler);

module.exports = router;
