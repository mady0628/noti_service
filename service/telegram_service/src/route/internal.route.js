const express = require("express");

const router = express.Router();

const controller = require("../controller/internal-message.controller");
const internalAuth = require("../middleware/internal-auth.middleware");
const upload = require("../middleware/upload.middleware");

router.post("/messages/send", internalAuth, controller.sendMessage);
router.post("/messages/send-attachment", internalAuth, upload.single("file"), controller.sendAttachment);

module.exports = router;
