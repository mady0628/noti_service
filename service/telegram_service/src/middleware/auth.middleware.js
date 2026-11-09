const crypto = require('crypto');
const bot = require('../bots/telegram.bot');

const auth = async (req, res) => {
    try {
        const receivedSecret =
            req.headers["x-telegram-bot-api-secret-token"];

        const expectedSecret = process.env.WEBHOOK_SECRET;

        if (
            typeof receivedSecret !== "string" ||
            !expectedSecret
        ) {
            return res.sendStatus(401);
        }

        const received = Buffer.from(receivedSecret);
        const expected = Buffer.from(expectedSecret);

        if (
            received.length !== expected.length ||
            !crypto.timingSafeEqual(received, expected)
        ) {
            return res.sendStatus(401);
        }

        await bot.handleUpdate(req.body);

        return res.sendStatus(200);

    } catch (error) {
        console.error("Webhook processing error:", error);
        return res.sendStatus(500);
    }
}

module.exports = { auth };