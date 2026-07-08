const { Router } = require("express");
const { success } = require("../utils/apiResponse");

const router = Router();

router.get("/", (req, res) => {
  return success(res, { message: "FAIRfair backend is running" });
});

module.exports = router;
