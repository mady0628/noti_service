const { Input } = require("telegraf");
const { getBot, getAllBots } = require("./bot-manager.service");

const resolveBotEntry = (externalAccountId) => {
    let entry = getBot(externalAccountId);
    if (!entry) {
        // Fallback: nếu không truyền externalAccountId và có bot đang chạy
        const all = getAllBots();
        if (!externalAccountId && all.length > 0) {
            entry = all[0].entry;
        }
    }

    if (!entry) {
        const error = new Error(`Telegram bot not found: ${externalAccountId || "default"}`);
        error.statusCode = 404;
        throw error;
    }

    return entry;
};

// Gửi tin nhắn text
const sendMessage = async (chatIdOrPayload, contentArg, externalAccountIdArg) => {
    let chatId, content, externalAccountId;

    if (typeof chatIdOrPayload === "object" && chatIdOrPayload !== null) {
        chatId = chatIdOrPayload.chatId;
        content = chatIdOrPayload.content;
        externalAccountId = chatIdOrPayload.externalAccountId;
    } else {
        chatId = chatIdOrPayload;
        content = contentArg;
        externalAccountId = externalAccountIdArg;
    }

    try {
        const entry = resolveBotEntry(externalAccountId);
        const result = await entry.bot.telegram.sendMessage(chatId, content);

        return {
            externalMessageId: String(result.message_id),
            externalChatId: String(result.chat.id),
            externalAccountId: entry.botId,
            sentAt: new Date(result.date * 1000).toISOString()
        };
    } catch (error) {
        console.error("Telegram send error:", error);
        throw error;
    }
};

// Gửi ảnh
const sendPhoto = async (
    chatId,
    fileBuffer,
    fileName,
    caption,
    externalAccountId
) => {
    try {
        const entry = resolveBotEntry(externalAccountId);
        const result = await entry.bot.telegram.sendPhoto(
            chatId,
            Input.fromBuffer(fileBuffer, fileName),
            {
                caption: caption || undefined
            }
        );

        const photos = result.photo || [];
        const largestPhoto = photos[photos.length - 1];

        return {
            externalMessageId: String(result.message_id),
            externalChatId: String(result.chat.id),
            externalFileId: largestPhoto?.file_id || null,
            externalAccountId: entry.botId,
            sentAt: new Date(result.date * 1000).toISOString()
        };
    } catch (error) {
        console.error("Telegram send photo error:", error);
        throw error;
    }
};

// Gửi tài liệu
const sendDocument = async (
    chatId,
    fileBuffer,
    fileName,
    caption,
    externalAccountId
) => {
    try {
        const entry = resolveBotEntry(externalAccountId);
        const result = await entry.bot.telegram.sendDocument(
            chatId,
            Input.fromBuffer(fileBuffer, fileName),
            {
                caption: caption || undefined
            }
        );

        return {
            externalMessageId: String(result.message_id),
            externalChatId: String(result.chat.id),
            externalFileId: result.document?.file_id || null,
            externalAccountId: entry.botId,
            sentAt: new Date(result.date * 1000).toISOString()
        };
    } catch (error) {
        console.error("Telegram send document error:", error);
        throw error;
    }
};

const getTelegramClient = (externalAccountId) => {
    const entry = getBot(externalAccountId);

    if (!entry || !entry.bot) {
        const error = new Error('Telegram bot not found');
        error.code = 'BOT_NOT_FOUND';
        throw error;
    }

    return entry.bot.telegram;
};

const sendTextMessage = async ({
    externalAccountId,
    externalChatId,
    content
}) => {
    const telegram = getTelegramClient(externalAccountId);

    const result = await telegram.sendMessage(
        externalChatId,
        content
    );

    return {
        externalMessageId: String(result.message_id),
        sentAt: new Date(
            result.date * 1000
        ).toISOString()
    };
};

// Gửi ảnh
const sendPhotoMessage = async ({
    externalAccountId,
    externalChatId,
    buffer,
    fileName,
    caption
}) => {
    const telegram = getTelegramClient(externalAccountId);

    const result = await telegram.sendPhoto(
        externalChatId,
        {
            source: buffer,
            filename: fileName
        },
        {
            caption: caption || undefined
        }
    );

    return {
        externalMessageId: String(result.message_id),
        sentAt: new Date(
            result.date * 1000
        ).toISOString()
    };
};

// Gửi tài liệu
const sendDocumentMessage = async ({
    externalAccountId,
    externalChatId,
    buffer,
    fileName,
    caption
}) => {
    const telegram = getTelegramClient(externalAccountId);

    const result = await telegram.sendDocument(
        externalChatId,
        {
            source: buffer,
            filename: fileName
        },
        {
            caption: caption || undefined
        }
    );

    return {
        externalMessageId: String(result.message_id),
        sentAt: new Date(
            result.date * 1000
        ).toISOString()
    };
};

module.exports = {
    sendMessage,
    sendText: sendMessage,
    sendTextMessage,
    sendPhotoMessage,
    sendDocumentMessage,
    sendDocument,
    sendPhoto
};
