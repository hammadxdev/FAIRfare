const { Router } = require("express");
const { requireAuth } = require("../middlewares/auth.middleware");
const { readPreferences, savePreferences } = require("../controllers/userPreference.controller");

const router = Router();
router.use(requireAuth);
router.get("/", readPreferences);
router.put("/", savePreferences);
module.exports = router;
