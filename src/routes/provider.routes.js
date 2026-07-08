const { Router } = require("express");
const { getProviders } = require("../controllers/provider.controller");

const router = Router();

router.get("/", getProviders);

module.exports = router;
