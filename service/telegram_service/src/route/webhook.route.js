const express = require("express");
const router = express.Router();

const controller = require("../controller/webhook.controller");
const { getAllBots } = require("../services/bot-manager.service");

// Endpoint nhận webhook riêng cho từng Bot
router.post("/webhook/:botId", controller.receiveWebhook);

// Fallback endpoint cho webhook không kèm botId trong path
router.post("/webhook", (req, res, next) => {
    const botId = req.query.botId;
    if (botId) {
        req.params.botId = botId;
        return controller.receiveWebhook(req, res);
    }
    const all = getAllBots();
    if (all.length > 0) {
        req.params.botId = all[0].botId;
        return controller.receiveWebhook(req, res);
    }
    return res.sendStatus(404);
});

module.exports = router;
