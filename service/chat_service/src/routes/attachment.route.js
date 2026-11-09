const express = require("express");

const router = express.Router();
const controller = require("../controllers/attachment.controller");

router.get("/:id", controller.getAttachment);

module.exports = router;

