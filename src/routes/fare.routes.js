const { Router } = require("express");
const { compareFaresHandler } = require("../controllers/fare.controller");
const { requireAuth } = require("../middlewares/auth.middleware");

const router = Router();

router.post("/compare", requireAuth, compareFaresHandler);

module.exports = router;
