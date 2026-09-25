const { Router } = require("express");
const { getProviders, getProviderStatuses } = require("../controllers/provider.controller");

const router = Router();

router.get("/", getProviders);
router.get("/status", getProviderStatuses);

module.exports = router;
