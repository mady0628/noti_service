const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const client = require('../services/chat-client.service');
const { handleAttachment } = require('./telegram-attachment.handler');

bot.on('text', async (ctx) => {
    try {
        const update = ctx.update;
        const message = ctx.message;
        const chat = ctx.chat;
        const sender = ctx.from;

        const data = {
            eventId: String(update.update_id),
            channel: 'TELEGRAM',
            externalAccountId: String(ctx.botInfo?.id || bot.botInfo?.id || ""),
            externalChatId: String(chat.id),
            externalMessageId: String(message.message_id),
            externalSenderId: String(sender.id),
            displayName: chat.title ||
                [chat.first_name, chat.last_name]
                    .filter(Boolean)
                    .join(" ") ||
                String(chat.id),
            username: chat.username || sender.username || null,
            chatType: chat.type,
            content: message.text,
            sentAt: new Date(message.date * 1000).toISOString()
        };

        const result = await client.sendIncomingMessage(data);
        console.log('Incoming text message saved:', result.data);
    } catch (error) {
        console.error("Telegram update failed:", error);
        throw error;
    }
});

// Nhận ảnh
bot.on("photo", async (ctx) => {
    const externalAccountId = String(ctx.botInfo?.id || bot.botInfo?.id || "");
    await handleAttachment(bot, ctx, externalAccountId);
});

// Nhận tài liệu
bot.on("document", async (ctx) => {
    const externalAccountId = String(ctx.botInfo?.id || bot.botInfo?.id || "");
    await handleAttachment(bot, ctx, externalAccountId);
});

module.exports = bot;
