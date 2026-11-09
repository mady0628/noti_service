const crypto = require("node:crypto");
const { getBot } = require("../services/bot-manager.service");
const { publishIncomingMessage } = require("../kafka/incoming.producer");

function secretsMatch(received, expected) {
    if (
        typeof received !== "string" ||
        typeof expected !== "string"
    ) {
        return false;
    }

    const a = Buffer.from(received);
    const b = Buffer.from(expected);

    return (
        a.length === b.length &&
        crypto.timingSafeEqual(a, b)
    );
}

const handleTelegramUpdate = async (req, res) => {
    try {
        const update = req.body;
        const message = update?.message;

        if (!message) {
            return res.sendStatus(200);
        }

        const externalAccountId = req.telegramBotId || req.params?.botId;

        const event = {
            eventId: `${externalAccountId}:${update.update_id}`,
            externalEventId: String(update.update_id),
            externalAccountId: String(externalAccountId),
            externalChatId: String(message.chat.id),
            externalMessageId: String(message.message_id),
            externalSenderId: String(message.from?.id || ''),
            messageType: 'text',
            content: message.text || '',
            payload: message
        };

        await publishIncomingMessage(event);

        return res.sendStatus(200);

    } catch (error) {
        console.error('Telegram Webhook Error:', error);
        return res.sendStatus(503);
    }
};

async function receiveWebhook(req, res) {
    const { botId } = req.params;

    // 1. Tìm bot bằng ID trong URL
    const entry = getBot(botId);

    if (!entry) {
        return res.sendStatus(404);
    }

    // 2. Xác minh secret riêng của bot
    const receivedSecret = req.get(
        "X-Telegram-Bot-Api-Secret-Token"
    );

    if (!secretsMatch(
        receivedSecret,
        entry.webhookSecret
    )) {
        return res.sendStatus(403);
    }

    try {
        const update = req.body;
        const message = update?.message;

        if (!message) {
            return res.sendStatus(200);
        }

        // Tin nhắn text được publish trực tiếp vào Kafka topic
        if (message.text) {
            const externalAccountId = entry.botId;

            const event = {
                eventId: `${externalAccountId}:${update.update_id}`,
                externalEventId: String(update.update_id),
                externalAccountId: String(externalAccountId),
                externalChatId: String(message.chat.id),
                externalMessageId: String(message.message_id),
                externalSenderId: String(message.from?.id || ''),
                messageType: 'text',
                content: message.text || '',
                displayName: message.chat?.title ||
                    [message.chat?.first_name, message.chat?.last_name]
                        .filter(Boolean)
                        .join(" ") ||
                    String(message.chat?.id || ''),
                username: message.chat?.username || message.from?.username || null,
                chatType: message.chat?.type || 'private',
                sentAt: new Date(message.date * 1000).toISOString(),
                payload: message
            };

            await publishIncomingMessage(event);
            return res.sendStatus(200);
        }

        // Các update khác (photo/document) vẫn giao cho Telegraf instance
        await entry.bot.handleUpdate(update);
        return res.sendStatus(200);

    } catch (error) {
        console.error(
            `Webhook processing failed for bot ${botId}:`,
            error.message
        );

        // Báo lỗi 503 để Telegram có thể retry khi Kafka broker tạm ngừng
        return res.sendStatus(503);
    }
}

module.exports = {
    receiveWebhook,
    handleTelegramUpdate
};
