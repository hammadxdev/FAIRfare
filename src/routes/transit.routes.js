const { Router } = require("express");
const { planLahoreTransit } = require("../services/transit/lahoreTransit.service");
const router = Router();

router.post("/plan", (req, res) => {
  const body = req.body || {};
  if (!body.origin || !body.destination) return res.status(400).json({ success: false, code: "ORIGIN_DESTINATION_REQUIRED" });
  return res.json({ success: true, data: planLahoreTransit({ origin: body.origin, destination: body.destination, originName: body.origin.name, destinationName: body.destination.name }) });
});

module.exports = router;
