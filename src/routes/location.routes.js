const { Router } = require("express");
const { requireAuth } = require("../middlewares/auth.middleware");
const { indriveAutocompleteHandler } = require("../controllers/location.controller");

const router = Router();
router.post("/indrive/autocomplete", requireAuth, indriveAutocompleteHandler);

module.exports = router;
