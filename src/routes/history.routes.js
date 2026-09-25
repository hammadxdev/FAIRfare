const { Router } = require("express");
const { listHistory, readHistory } = require("../controllers/history.controller");
const { requireAuth } = require("../middlewares/auth.middleware");

const router = Router();
router.get("/", requireAuth, listHistory);
router.get("/:id", requireAuth, readHistory);

module.exports = router;
