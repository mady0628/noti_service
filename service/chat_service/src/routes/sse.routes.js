const express = require("express");

const router = express.Router();

const sseController = require("../controllers/sse.controller");

router.get("/events", sseController.subscribe);

module.exports = router;

