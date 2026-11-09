const express = require("express");

const router = express.Router();

const controller = require("../controllers/message.controller");
const upload = require("../middlewares/upload.middleware");

router.post("/:conversationId/messages", controller.sendMessage);
router.post("/:id/messages-kafka", controller.sendMessageKafka);
router.post("/:id/attachments", upload.single("file"), controller.sendAttachment);

module.exports = router;
