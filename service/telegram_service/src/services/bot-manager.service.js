const { Telegraf } = require("telegraf");
const chatClient = require("./chat-client.service");
const { handleAttachment } = require("../bots/telegram-attachment.handler");

// Key: Telegram Bot ID (String)
// Value: { bot, botId, username, webhookSecret }
const bots = new Map();

function getBotConfigs() {
    const rawConfigs = [
        {
            token: process.env.BOT_A_TOKEN,
            webhookSecret: process.env.BOT_A_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET
        },
        {
            token: process.env.BOT_B_TOKEN,
            webhookSecret: process.env.BOT_B_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET
        },
        {
            token: process.env.BOT_C_TOKEN,
            webhookSecret: process.env.BOT_C_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET
        },
        {
            token: process.env.TELEGRAM_BOT_TOKEN,
            webhookSecret: process.env.WEBHOOK_SECRET
        }
    ];

    // Lọc các config có token hợp lệ và loại bỏ trùng lặp token
    const uniqueTokens = new Set();
    const configs = [];

    for (const item of rawConfigs) {
        if (item.token && typeof item.token === "string" && item.token.trim() && !uniqueTokens.has(item.token.trim())) {
            uniqueTokens.add(item.token.trim());
            configs.push({
                token: item.token.trim(),
                webhookSecret: item.webhookSecret || "default_webhook_secret"
            });
        }
    }

    return configs;
}

function registerMessageHandlers(bot, botId) {
    bot.on("text", async (ctx) => {
        try {
            const update = ctx.update;
            const message = ctx.message;
            const chat = ctx.chat;
            const sender = ctx.from;

            const data = {
                eventId: String(update.update_id),
                channel: "TELEGRAM",
                externalAccountId: botId,
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

            const result = await chatClient.sendIncomingMessage(data);
            console.log(`Incoming text message saved (Bot ${botId}):`, result?.data || result);
        } catch (error) {
            console.error(`Telegram update failed for bot ${botId}:`, error);
        }
    });

    bot.on("photo", async (ctx) => {
        try {
            await handleAttachment(bot, ctx, botId);
        } catch (error) {
            console.error(`Photo handler failed for bot ${botId}:`, error);
        }
    });

    bot.on("document", async (ctx) => {
        try {
            await handleAttachment(bot, ctx, botId);
        } catch (error) {
            console.error(`Document handler failed for bot ${botId}:`, error);
        }
    });
}

async function initializeBots(options = {}) {
    const configs = options.configs || getBotConfigs();

    const baseUrl = (
        process.env.PUBLIC_WEBHOOK_URL ||
        process.env.WEBHOOK_URL ||
        ""
    ).replace(/\/+$/, "");

    for (const config of configs) {
        if (!config.webhookSecret) {
            throw new Error("Missing bot webhook secret");
        }

        const bot = options.botInstance || new Telegraf(config.token);

        let info;
        if (options.mockInfo && options.mockInfo[config.token]) {
            info = options.mockInfo[config.token];
        } else {
            info = await bot.telegram.getMe();
        }

        const botId = String(info.id);

        if (bots.has(botId)) {
            console.warn(`Bot ID already registered: ${botId}, skipping duplicate`);
            continue;
        }

        bot.botInfo = info;

        // Đăng ký handlers cho bot
        registerMessageHandlers(bot, botId);

        // Đồng bộ tài khoản bot sang Chat Service (channel_accounts)
        if (options.syncWithChatService !== false) {
            try {
                await chatClient.registerAccount({
                    channel: "TELEGRAM",
                    externalAccountId: botId,
                    displayName: info.first_name || info.username || `Bot ${botId}`,
                    externalUsername: info.username || null
                });
                console.log(`Registered bot @${info.username} (${botId}) in Chat Service`);
            } catch (err) {
                console.warn(`Could not register bot ${botId} in Chat Service:`, err.message);
            }
        }

        // Đăng ký webhook riêng với Telegram nếu có URL
        if (baseUrl && !options.skipWebhook) {
            const webhookUrl = `${baseUrl}/telegram/webhook/${botId}`;
            try {
                await bot.telegram.setWebhook(webhookUrl, {
                    secret_token: config.webhookSecret,
                    allowed_updates: ["message"]
                });
                console.log(`Webhook registered for bot @${info.username} (${botId}): ${webhookUrl}`);
            } catch (whErr) {
                console.warn(`Failed to setWebhook for bot ${botId}:`, whErr.message);
            }
        }

        bots.set(botId, {
            bot,
            botId,
            username: info.username,
            displayName: info.first_name || info.username,
            webhookSecret: config.webhookSecret
        });

        console.log(`Registered bot @${info.username} (${botId}) in Bot Manager`);
    }

    return bots;
}

function getBot(botId) {
    if (!botId) return null;
    return bots.get(String(botId)) || null;
}

function getAllBots() {
    return [...bots.values()].map(item => ({
        botId: item.botId,
        username: item.username,
        displayName: item.displayName,
        webhookSecret: item.webhookSecret,
        entry: item
    }));
}

function registerBot(botId, data) {
    bots.set(String(botId), data);
}

function clearBots() {
    bots.clear();
}

module.exports = {
    initializeBots,
    getBot,
    getAllBots,
    registerBot,
    clearBots,
    registerMessageHandlers
};

