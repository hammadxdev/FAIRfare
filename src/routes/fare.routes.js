const { Router } = require("express");
const { compareFaresHandler } = require("../controllers/fare.controller");

const router = Router();

router.post("/compare", compareFaresHandler);

module.exports = router;
